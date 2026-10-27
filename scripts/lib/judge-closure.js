'use strict'

/**
 * 「谁来守门」的高危面的**输入域真源**（change: ci-judge-surface-coverage，2026-10-26）。
 *
 * 为什么要有这个模块：`HIGH_RISK_SURFACES` 是一张**按路径前缀**匹配的清单，而判据的实质内容
 * 大量住在 `scripts/lib/` 下 —— 实测 47 个判据入口沿相对 `require` 可达 67 个仓内脚本，
 * 其中 **19 个不在任何前缀上**，含 `scripts/lib/main-red.js`（「主干红就停合并」的判定本体）、
 * `scripts/classify-docs-only.js`（决定哪些重型门**根本没跑**）、
 * `scripts/lib/ccg-external-review-honor.js`（决定高危阻断该不该扣）。
 * 于是「只改这些文件的 PR」会被读成与守门无关 —— 改它可以静默放宽收口口径而**没有任何东西会红**。
 * 这不是设想：清单里 `scripts/lib/ccg-review-` 那条的 `why` 原文写着
 * 「跨家族轴 X2-9 实测这条此前落在清单外，改它不触发任何收口要求」，即同一个坑上一轮踩过一次。
 *
 * 默认方向因此是 **fail-closed**：落在闭包里就算高危面成员；想不算，必须写进豁免清单并给 reason。
 *
 * ⚠ 三条实现边界（必须如实，不得宣称"完整覆盖"）：
 *  1. 跟**字面量**相对 `require` / `import`，以及分段全为字面量的 `require(path.join(__dirname, 'lib', 'x.js'))`
 *     （这种写法在静态上就是可定的；2026-10-26 实测 `scripts/lib/gate-timeout-registry.js` 唯一入边就是它，
 *     放过＝把一条真实的判定依赖读成"没人引用"）。含变量的拼装（`path.join(root, …)`、`require(f)`）
 *     结构性看不见，由 `dynamicRequireLike` 计数出声 —— 当场实测为 **6 处**（不是 0），
 *     逐条列在 `node scripts/check-judge-surface-coverage.js --report` 里。
 *  2. 测试文件既不算入口、也不作为闭包节点展开。第一版探针没排测试，把 `check-x.test.js`
 *     当入口 ⇒ 入口数从 47 虚报成 90，并把纯测试夹具拖进分类域。**探针犯过的错由用例钉住**
 *     （见 `judge-closure.test.js` 同名那条）。
 *  3. 入口只认 `scripts/` **顶层**：`scripts/lib/ccg-review-backends.js` 是数据真源、不是入口
 *     （它经由前缀 `scripts/lib/ccg-review-` 单独在清单上），把它当入口会让闭包反向膨胀到不可解释。
 *
 * 另有两条从实测里长出来的收口：注释行整行剥掉（散文里的 `require('./x')` 不是依赖边，
 * 第一版造出 3 条假 `unresolved`）；`unresolved` 只该有"真解析不到"这一种成因。
 *
 * 本模块只 require node 内置：它会被 `check-pr-exec-record.js`（CI 每次 PR 的入口）require，
 * 也会被 `changes` job 里无依赖安装的判据 require。
 */

const fs = require('node:fs')
const path = require('node:path')

/** 判据入口的文件名前缀（与 HIGH_RISK_SURFACES 里那三条同源，但这里问的是"文件名"不是"路径"） */
const ENTRY_PREFIXES = Object.freeze(['check-', 'ccg-review-', 'deep-review'])
/** 入口/可达文件的扩展名集合。`.sh` / `.ps1` 也在内：`deep-review.sh` 就是评审链入口本体。 */
const SOURCE_EXTS = Object.freeze(['.js', '.mjs', '.cjs', '.sh', '.ps1'])

const TEST_RE = /\.test\.[cm]?js$/
const TEST_SCRIPT_RE = /\.test\.(sh|ps1)$/

/**
 * 闭包规模的**下界**（唯一一份：清点判据与回归锁都引用这里，各抄一遍必然漂移）。
 * 方向只有一个：覆盖变窄是事故，变宽不是 —— 所以是下界而非等值。
 * 为什么必须有：解析退化会让"零违规"与"什么都没扫到"逐字同形，那是恒绿门禁的标准死法。
 * 数值取自 2026-10-26 的实测（entries 47 / files 67 / lib 17）留出的余量，
 * **不是**精确期望 —— 精确等值会被任何一次无关的判据新增打红。
 */
const MIN_ENTRIES = 40
const MIN_FILES = 60
const MIN_LIB_FILES = 15
/** 豁免清单的上限：本片起始为 0（fail-closed：闭包内即高危面）。抬上限属人工裁决。 */
const MAX_WAIVERS = 0

function isTestArtifactName (name) {
  return TEST_RE.test(name) || TEST_SCRIPT_RE.test(name)
}

/**
 * 是不是判据入口。**只看 `scripts/` 顶层的文件名**：传相对路径时含 `/` 一律 false。
 * @param {string} nameOrRel `check-a.js` / `deep-review.sh` 为真；`check-a.test.js`、`lib/x.js` 为假
 */
function isJudgeEntryName (nameOrRel) {
  const s = String(nameOrRel === undefined || nameOrRel === null ? '' : nameOrRel)
  if (s.includes('/') || s.includes('\\')) return false
  if (isTestArtifactName(s)) return false
  const ext = path.extname(s)
  if (!SOURCE_EXTS.includes(ext)) return false
  const base = path.basename(s)
  return ENTRY_PREFIXES.some((p) => base.startsWith(p))
}

// 字面量相对依赖：`require('./x')` / `import y from '../z.js'`。
// 动态形态由 classifyJoinRequires + DYNAMIC_REQUIRE_RE 单独抓，不混进这里 ——
// 混在一起会让"解析失败"与"根本不是字面量"两种成因同形。
const LITERAL_DEP_RE = /(?:require|from)\s*\(?\s*(['"])(\.\.?\/[^'"]*)\1/g
const JOIN_REQ_RE = /require\s*\(\s*(?:path\s*\.\s*)?join\s*\(([^)]*)\)/g
const DYNAMIC_REQUIRE_RE = /require\s*\(\s*[^'")\s]/g
/**
 * 整行注释的形态。**刻意不含 `/*` 起始行**：那归块注释状态机管，
 * 在整行分支里顺手吞掉它会让 `inBlock` 永不被置位（第一版就是这么漏掉跨行块的）。
 */
const COMMENT_LINE_RE = /^(?:\/\/|\*|#)/
/** shell / PowerShell 的整行注释只有 `#`。 */
const HASH_LINE_RE = /^#/
/** 注释规则按语言决定：只有 JS 家族才有 `//` 与跨行块注释。 */
const JS_EXT_RE = /\.(?:js|mjs|cjs|jsx|ts)$/

/** 行内注释起点：不在引号内、且前面是行首或空白的那个 `//`。字符串里的 `//`（URL）一律不切。 */
function inlineCommentStart (ln) { return outsideStringStart(ln, '//') }
/** 块注释起点：同样要求"在引号外 + 前面是行首或空白"，避免把除法/正则里的 `/*` 当注释。 */
function blockCommentStart (ln) { return outsideStringStart(ln, '/*') }

/**
 * 找 token 在该行里**第一次出现在字符串外**的位置；找不到返回 -1。
 * 字符串内的 token 不算：`'https://example.com/a//b'` 里的 `//` 是 URL 的一部分，
 * 从它切会把同行后面的真依赖一起吃掉（正控用例就长这样）。
 */
function outsideStringStart (ln, token) {
  let quote = ''
  for (let i = 0; i < ln.length; i++) {
    const c = ln.charAt(i)
    if (quote) {
      if (c === '\\') { i += 1; continue }
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === '\'' || c === '`') { quote = c; continue }
    if (c === token.charAt(0) && ln.substr(i, token.length) === token && (i === 0 || /\s/.test(ln.charAt(i - 1)))) return i
  }
  return -1
}

/**
 * 剥掉注释（整行 + 行内 + **跨行块注释**），替换成等长空格以保持字符偏移不变
 * （`dynamic` 计数器的 spans 靠偏移，改成删除字符会让 spans 全部错位）。
 * 动因一：实测 `unresolved` 里的三条（`scripts\$REC`、`scripts\lib\x`、`scripts\z.js`）**全部**
 * 来自整行散文里的示例写法。留着它们，「unresolved>0」这条读数就永远是噪声。
 * 动因二（QM-6 轮 1 i3，采纳）：`const x = 1 // require('./fake.js')` 这种**行内**注释在第一版里
 * 会造出一条假的 `unresolved` —— 而清点判据现在断言真实仓该数为 0，假信号会把下一次真漏网埋掉。
 * 动因三（QM-6 轮 2 i4，采纳）：`/*` 块注释的**中间行不以 `*` 开头**时，整行规则抓不到它，
 * 实测同样造出假 `unresolved`（`scripts\doc-example.js`）⇒ 必须按文件跟踪块注释状态。
 * ⚠ 但**规则按语言分档**：只有 JS 家族才用整行 `//`·`*`、行内 `//`、跨行块注释；
 * `.sh`/`.ps1` 只认整行 `#` —— shell 里 `/*` 与 `//` 是**普通字符**（`case` 分支 `/*)`、
 * 参数展开 `${x%/*}`），把它们当注释起点会从那一行起把整个文件读成"在块注释里"。
 * 这条不是理论：i4 修完之后当场读数 `dynamic` 从 6 掉到 **5**，逐行复算发现
 * `scripts/deep-review.sh:620` 的 `require(f)` 被第 386 行的 `/*)` 起点吃掉了
 * —— **读数的意外变化就是线索**（design §D25）。
 * 其余边界如实：shell 的**行尾** `#` 未处理（当场实测闭包内该形态 0 处）；
 * JS 正则字面量里出现 `/*` 时会被当注释起点（方向是"少收依赖"，宁可漏一条边也不多算一条）。
 */
function stripCommentLines (src, isJs) {
  if (isJs !== true) {
    // 非 JS：只有整行 `#` 是注释，行内与块都不猜。
    return String(src).split('\n').map((ln) => (HASH_LINE_RE.test(ln.trim()) ? ' '.repeat(ln.length) : ln)).join('\n')
  }
  let inBlock = false
  const cutLine = (ln) => {
    const l = inlineCommentStart(ln)
    return l < 0 ? ln : ln.slice(0, l) + ' '.repeat(ln.length - l)
  }
  return String(src).split('\n')
    .map((raw) => {
      let ln = raw
      if (inBlock) {
        const close = ln.indexOf('*/')
        if (close < 0) return ' '.repeat(ln.length)
        inBlock = false
        ln = ' '.repeat(close + 2) + ln.slice(close + 2)
      }
      const t = ln.trim()
      if (t === '') return ln
      if (COMMENT_LINE_RE.test(t)) return ' '.repeat(ln.length)
      const b = blockCommentStart(ln)
      if (b >= 0) {
        const close = ln.indexOf('*/', b + 2)
        if (close < 0) {
          inBlock = true
          return ' '.repeat(ln.length)
        }
        return cutLine(ln.slice(0, b) + ' '.repeat(close + 2 - b) + ln.slice(close + 2))
      }
      return cutLine(ln)
    })
    .join('\n')
}

/**
 * `require(path.join(__dirname, 'lib', 'x.js'))` 这类**分段字面量**在静态上就是可定的，
 * 放过它就是把一条真实存在的判定依赖读成"没人引用"。
 * 实测的洞：`scripts/lib/gate-timeout-registry.js`（每条 gate 的超时预算登记）唯一入边就是这种写法。
 * 口径：只有「除 `__dirname` 外全是相对字面量」才算可定；混进别的变量（`root`、`DESKTOP`）
 * 一律退回动态计数 —— 那确实是静态上定不下来的，不得假装能。
 * @returns {{requests:string[], spans:Array<[number, number]>}} `spans` 只含**已判定可定**的那些
 */
function classifyJoinRequires (src) {
  const requests = []
  const spans = []
  const re = JOIN_REQ_RE
  re.lastIndex = 0
  let m
  while ((m = re.exec(src)) !== null) {
    const parts = String(m[1] || '').split(',').map((s) => s.trim()).filter((s) => s !== '')
    const lit = []
    let determinable = parts.length > 0
    for (const p of parts) {
      if (p === '__dirname') continue
      const q = p.match(/^(['"])(.*)\1$/)
      // 绝对路径 / 盘符 / 变量名：都不是"相对本文件拼装"，这一格就交回动态账
      if (!q || q[2].length === 0 || q[2].charAt(0) === '/' || /^[A-Za-z]:/.test(q[2]) || q[2].indexOf('\\') >= 0) {
        determinable = false
        break
      }
      lit.push(q[2])
    }
    if (determinable && lit.length > 0) {
      spans.push([m.index, m.index + m[0].length])
      requests.push('./' + lit.join('/'))
    }
  }
  return { requests, spans }
}

/** 动态 require 计数：已被拼装解析掉的那些不重复记账（否则"能解析"与"看不见"混在一个数里）。 */
function countDynamicRequires (src, spans) {
  let n = 0
  DYNAMIC_REQUIRE_RE.lastIndex = 0
  let m
  while ((m = DYNAMIC_REQUIRE_RE.exec(src)) !== null) {
    const at = m.index
    let inResolved = false
    for (const [s, e] of spans) {
      if (at >= s && at < e) { inResolved = true; break }
    }
    if (!inResolved) n += 1
  }
  return n
}

/** 把一个相对请求解析成仓内真实文件路径；解析不到返回 null（计入 unresolved，不静默跳过）。 */
function resolveRequest (fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request)
  const candidates = [base]
  for (const ext of SOURCE_EXTS) candidates.push(base + ext)
  candidates.push(path.join(base, 'index.js'))
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c
    } catch { /* 试下一个候选 */ }
  }
  return null
}

/**
 * 计算判据闭包。
 * @param {string} rootDir 仓库根或 worktree 根
 * @returns {{entries:number, files:string[], libFiles:number, dynamicRequireLike:number,
 *            unresolved:string[], selfFault:string|null}}
 *   `files` 含入口自身，按字典序；读不到目录时返回零读数 **且** 带 `selfFault`，
 *   因为"一个都没扫到"与"这个仓没有判据"必须可区分（否则零违规是假绿）。
 */
function computeJudgeClosure (rootDir) {
  const out = { entries: 0, files: [], libFiles: 0, dynamicRequireLike: 0, unresolved: [], selfFault: null }
  const scriptsDir = path.join(String(rootDir || ''), 'scripts')
  let top = []
  try {
    top = fs.readdirSync(scriptsDir, { withFileTypes: true })
  } catch (e) {
    out.selfFault = 'scripts/ 目录读不到：' + String((e && e.message) || e).split('\n')[0]
    return out
  }
  const seen = new Set()
  const queue = []
  for (const e of top) {
    if (!e.isFile()) continue
    if (!isJudgeEntryName(e.name)) continue
    const abs = path.join(scriptsDir, e.name)
    out.entries += 1
    if (!seen.has(abs)) { seen.add(abs); queue.push(abs) }
  }
  while (queue.length > 0) {
    const abs = queue.shift()
    let src = ''
    try { src = fs.readFileSync(abs, 'utf8') } catch (e) {
      // 读不动已入队的文件 ⇒ 这是**部分退化**，必须出声：静默跳过会让"少扫到文件"读成"没有"。
      out.selfFault = (out.selfFault ? out.selfFault + ' | ' : '') +
        '已入队文件读不动 ' + relOf(rootDir, abs) + '：' + String((e && e.message) || e).split('\n')[0]
      continue
    }
    const scannable = stripCommentLines(src, JS_EXT_RE.test(abs))
    const joins = classifyJoinRequires(scannable)
    out.dynamicRequireLike += countDynamicRequires(scannable, joins.spans)
    const requests = joins.requests.slice()
    LITERAL_DEP_RE.lastIndex = 0
    let m
    while ((m = LITERAL_DEP_RE.exec(scannable)) !== null) requests.push(m[2])
    for (const request of requests) {
      const target = resolveRequest(abs, request)
      if (target === null) { out.unresolved.push(relOf(rootDir, path.resolve(path.dirname(abs), request))); continue }
      const rel = relOf(rootDir, target)
      if (!rel.startsWith('scripts' + path.sep) && !rel.startsWith('scripts/')) continue
      const norm = rel.split(path.sep).join('/')
      const name = path.basename(target)
      if (isTestArtifactName(name)) continue // 测试不进域、也不展开
      if (seen.has(target)) continue
      seen.add(target)
      queue.push(target)
    }
  }
  out.files = [...seen].map((p) => relOf(rootDir, p).split(path.sep).join('/')).sort()
  out.libFiles = out.files.filter((f) => f.startsWith('scripts/lib/')).length
  out.unresolved = [...new Set(out.unresolved)].sort()
  return out
}

function relOf (rootDir, abs) {
  return path.relative(String(rootDir || ''), abs)
}

/**
 * 豁免清单的形状校验。**唯一一份**：清点判据与运行时判据都调它，两处各抄一遍必然漂移。
 * 规则：值必须是非空且去空白后非空的字符串 —— `true` / `42` / `{}` / 空串一律拒。
 * 「没填理由」与「填了但很短」要分开：后者是质量问题（人判），前者是形状问题（这里拦）。
 * @param {unknown} waivers
 * @returns {{ok:boolean, bad:Array<{key:string, why:string}>}}
 */
function validateWaivers (waivers) {
  if (!waivers || typeof waivers !== 'object' || Array.isArray(waivers)) {
    return { ok: false, bad: [{ key: '(整份清单)', why: '不是对象或缺失 —— 按故障处理，不按"没有豁免"处理' }] }
  }
  const bad = []
  for (const key of Object.keys(waivers)) {
    const v = waivers[key]
    if (typeof v !== 'string') { bad.push({ key, why: 'reason 不是字符串（实得 ' + (v === null ? 'null' : typeof v) + '）' }); continue }
    if (v.trim() === '') bad.push({ key, why: 'reason 为空或全空白' })
  }
  return { ok: bad.length === 0, bad }
}

module.exports = {
  ENTRY_PREFIXES,
  SOURCE_EXTS,
  MIN_ENTRIES,
  MIN_FILES,
  MIN_LIB_FILES,
  MAX_WAIVERS,
  isTestArtifactName,
  isJudgeEntryName,
  computeJudgeClosure,
  validateWaivers,
}
