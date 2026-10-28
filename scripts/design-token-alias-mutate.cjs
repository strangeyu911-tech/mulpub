'use strict'
// 阶段 3.5 第一步（令牌双轨别名化）的变异反证驱动
// 本地同口径：node scripts/design-token-alias-mutate.cjs
//
// 与同仓其它驱动一致的三条纪律（都是被外部评审打回后定下的）：
//  ① 一刀只允许一份 original 快照（多处改动走同一快照上的 steps 顺序替换）；
//  ② 归因只取失败行（× / ✖ / FAIL），开局自检探针必须能区分 ✓ 与 ×，否则 rc=2 拒绝汇报；
//  ③ 锚点不焊行尾；锚点失配/语法错抛 ERROR，绝不算反证。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex')

const TOK = 'apps/desktop/src/styles/tokens.css'
const COH = 'apps/desktop/src/styles/cohere-design-system.css'
const SING = 'apps/desktop/src/styles/design-token-single-track.test.js'
const SLOT = 'apps/desktop/src/styles/tokens.slots.test.js'
const SUITE = ['src/styles/design-token-single-track.test.js', 'src/styles/tokens.slots.test.js']

const KNIVES = [
  {
    id: 'T1', what: '把一条别名改回字面 px（双轨复活，两侧值将来可各自漂移）',
    file: COH, red: ['别名侧不得出现字面 px'],
    steps: [{ from: '  --r-sm: var(--radius-sm);', to: '  --r-sm: 8px;' }],
  },
  {
    id: 'T2', what: '反向别名（存活侧也指向别处 ⇒ 悬空/环形引用）',
    file: TOK, red: ['存活侧仍是字面值'],
    steps: [{ from: '  --radius-sm: 8px;', to: '  --radius-sm: var(--r-sm);' }],
  },
  {
    id: 'T3', what: '掏空刻度冲突清单（逐条校验对空集恒真 ⇒ 必须有下界才测得出）',
    file: SING, red: ['刻度冲突清单'],
    steps: [{ from: 'const CONFLICTS = new Map([', to: 'const CONFLICTS = new Map() || new Map([' }],
  },
  {
    id: 'T3b', what: '登记项与源不符（陈旧登记必须被点名，不得静默放行）',
    file: SING, red: ['刻度冲突清单'],
    steps: [{ from: "'（无对应）/ --spacing-5: 20px'", to: "'（无对应）/ --spacing-5: 99px'" }],
  },
  {
    id: 'T4', what: '棘轮遍历域塌成空集合（存量数不再被量）',
    file: SING, red: ['存量棘轮'],
    steps: [{ from: 'for (const [dep] of ALIASES) {', to: 'for (const [dep] of []) {' }],
  },
  {
    // 评审 i1 的专属刀：把棘轮退回"只遍历 radius 一族"。
    // 不补这一刀，T4（整域塌空）证不出"一族有一族没"这种**更常见**的退化形态。
    id: 'T6', what: '把棘轮退回只量 radius 一族（spacing 侧留成进度条空白）',
    file: SING, red: ['两侧被废弃名都要被量'],
    steps: [{ from: 'for (const [dep] of ALIASES) {', to: "for (const [dep] of ALIASES.filter(([d]) => d.startsWith('--r-'))) {" }],
  },
  {
    // 评审 i2 的专属刀：取"只装载一份令牌文件"这一真实风险形态（不是把判据改弱）。
    id: 'T7', what: '注释掉 main.js 里的 cohere 装载（别名在此上下文中悬空）',
    file: 'apps/desktop/src/main.js', red: ['装配锁'],
    steps: [{ from: "import './styles/cohere-design-system.css'", to: "// import './styles/cohere-design-system.css'（T7：模拟只装载 tokens.css 的上下文）" }],
  },
  {
    // 评审 i3 的专属刀：**对称**抄错冻结表（两侧同改成同一个错值）—— 只有从 git 复现基线才抓得住。
    id: 'T8', what: '把冻结表两侧同改成同一个错值（自洽但与历史不符）',
    file: SING, red: ['零回归基线必须能从 git'],
    steps: [{ from: "'--r-lg': '16px',", to: "'--r-lg': '17px'," }, { from: "'--radius-lg': '16px',", to: "'--radius-lg': '17px'," }],
  },
  {
    id: 'T5', what: '把快照的 var 解析摘掉（既有快照锁退回"按字面文本断言"）',
    file: SLOT, red: ['品牌色/圆角/字号/间距快照不变'],
    steps: [{ from: 'const light = resolveVars(readVarBlock(tokensCss, \'root\'), readVarBlock(cohereCss, \'root\'))', to: 'const light = readVarBlock(tokensCss, \'root\')' }],
  },
]

function run () {
  const r = spawnSync('pnpm.CMD', ['exec', 'vitest', 'run'].concat(SUITE), {
    cwd: DESKTOP, encoding: 'utf8', shell: true, windowsHide: true,
  })
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const FAIL_LINE = /^\s*(?:×|✕|✖|FAIL\b)/
function failedTestNames (out) {
  const clean = out.replace(/\u001B\[[0-9;]*m/g, '')
  const names = []
  for (const line of clean.split(/\r?\n/)) {
    if (!FAIL_LINE.test(line)) continue
    const seg = line.split('>').pop().replace(/\s+\d+ms\s*$/, '').trim()
    if (seg && !/^(FAIL|×|✕|✖)/i.test(seg)) names.push(seg)
  }
  return names
}
function selfCheckAttribution () {
  const s = [' ✓ a > 通过的用例  12ms', ' × a > 失败的用例  3ms', ' FAIL  b > 另一个失败'].join('\n')
  const got = failedTestNames(s)
  return got.includes('失败的用例') && got.includes('另一个失败') && !got.includes('通过的用例')
}

function applyAndProbe (k) {
  const abs = path.join(REPO, k.file)
  const original = fs.readFileSync(abs)
  let text = original.toString('utf8')
  for (const s of k.steps) {
    const n = text.split(s.from).length - 1
    if (n !== 1) {
      fs.writeFileSync(abs, original)
      throw new Error(k.id + ' 锚点命中 ' + n + ' 次，期望 1：' + s.from.slice(0, 44))
    }
    text = text.split(s.from).join(s.to)
  }
  fs.writeFileSync(abs, text, 'utf8')
  try {
    const r = run()
    const names = failedTestNames(r.out)
    const missing = k.red.filter((w) => !names.some((n) => n.includes(w)))
    return {
      caught: r.rc !== 0 && missing.length === 0,
      detail: 'rc=' + r.rc + (missing.length === 0
        ? '+点名' + k.red.length + '条'
        : '+未点名：缺[' + missing.join(',') + ']，红在别处：' + (names.join('|') || '(无失败行 ⇒ 可能是转换失败)')),
    }
  } finally {
    fs.writeFileSync(abs, original)
    if (md5(fs.readFileSync(abs)) !== md5(original)) throw new Error('还原后字节不一致（' + k.id + '）—— 停止后续刀')
  }
}

if (!selfCheckAttribution()) { console.error('[MUTATE] 归因探针自检不过 ⇒ 拒绝汇报 CAUGHT'); process.exit(2) }
const base = run()
console.log('[MUTATE] 基线趟 rc=' + base.rc + ' 失败行=' + (failedTestNames(base.out).length || 0))
if (base.rc !== 0) { console.error('[MUTATE] 基线就红 ⇒ 无法归因'); process.exit(2) }
let caught = 0
for (const k of KNIVES) {
  try {
    const r = applyAndProbe(k)
    console.log((r.caught ? 'CAUGHT     ' : 'NOT_CAUGHT ') + k.id + ' ' + k.what + ' :: ' + r.detail)
    if (r.caught) caught++
  } catch (e) { console.log('ERROR      ' + k.id + ' ' + e.message) }
}
const after = run()
console.log('[MUTATE] 还原后复跑 rc=' + after.rc)
console.log('[MUTATE] 汇总 CAUGHT=' + caught + '/' + KNIVES.length)
process.exit(caught === KNIVES.length && after.rc === 0 ? 0 : 1)
