import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// 阶段 4.7 ①「展示口径统一为 Unicode 码点」的**防回退锁**（UX 审计阶段 5 家族：把一次修复变成判据）。
//
// 为什么必须有这条：本批把 19 处「按 UTF-16 码元计数/截断」收敛到 shared-utils 的唯一实现（16 个文件），
// 但没有任何东西阻止下一个会话再写一处 t.slice(0, 60) + 省略号 —— 那类写法在 ASCII 测试夹具下
// 永远绿，只在 emoji/国旗进文案时把代理对切成半片（用户侧是豆腐块）。
//
// 五把锁各管一格，缺一格就有一类退化读起来像通过：
//   ① 扫描域规模下界（域塌成空集时"零违规"与"什么都没扫"同形）；
//   ② 形态判据 + 例外清单只能缩小、每条必须当场仍有命中（陈旧登记红）；
//   ③ 反失明锚点对判据本体做正控，**不**依赖"仓库里还得有违规"（见评审 i4 那一段）；
//   ④ 已迁移站点逐条回查（评审 i2：x.length 这一族无法按形态全域禁，只能按站点钉住）；
//   ⑤ 导入必须被真正调用且不得与本地同名声明撞车（评审 i1：本批真实踩过一次
//      Identifier "truncate" has already been declared —— vite build 当场红，而单测与
//      "文件里出现过 import"那条锁都抓不到，只有构建暴露它）。

const SRC_ROOT = 'apps/desktop/src'
// 仓库根由 __dirname 逐级上溯求得，**不数 .. 也不假设 cwd**：
// vitest 的 process.cwd() 是 apps/desktop，用相对 cwd 的 git pathspec 与文件读取会得到
// "0 个匹配、rc=0、零报错"——正是这条锁要防的那类失明（本文件第一版就踩了，被自己的下界断言当场抓出）。
const REPO = path.resolve(__dirname, '..', '..', '..')

// 省略号字面量：1~3 个非引号字符
const ELLIPSIS = "(['\"])[^'\"]{1,3}\\1"

// 判据形态是**当场量出来的**，不是设想：把新形态加进来之前先跑了一遍全域计数，
// 新增命中恰好 3 条，逐条核对为同一缺陷（SceneCard / CreateHistory / CreateViewHistory，
// 形状都是 x.length > N ? x.slice/substring(0, N) + 省略号 : x），已随本批一起迁移。
// 右参允许 max - 1 这类带运算符的表达式（第一版只认标识符字符，把 slice(0, max - 1) 整个放过）。
// 刻意**不做**的两族（写了就是假覆盖，须如实声明）：
//   ① 省略号来自变量而非字面量；
//   ② 把 x.length / Array.from(x).length 当计数用 —— 全域 .length 命中数以千计且绝大多数合法，
//      按形态禁不了，由下面第 ④ 把锁（逐站点回查）代偿：把已迁移站点退回 .length 会让该锚点找不到 ⇒ 当场红。
function forbiddenRe () {
  return new RegExp(
    '\\.(?:slice|substring)\\(\\s*0\\s*,\\s*[\\w.$[\\]()\\s+\\-*]+\\)\\s*(?:\\+\\s*' + ELLIPSIS +
      '|\\.concat\\(\\s*' + ELLIPSIS + ')',
    'g',
  )
}

// 刻意留下的例外（只能缩小）。每条必须写清为什么不在这次收敛，写不出理由的不得登记。
const ALLOWED = new Map([
  ['apps/desktop/src/views/Collection.vue',
    '模板里直接对 collectedResult.description 做 slice + 省略号（不在函数体内，改成调用要新增渲染层 helper 并动模板结构）；本批不动模板，留作第二批与卡片布局重排（审计 3.9）同做。'],
  ['apps/desktop/src/views/FilmEngineeringView.vue',
    't2.slice(0, max) + " …" 前已有本地归一，且该视图在像素判定域内（film-engineering 基线），改可见宽度要与基线刷新同批。'],
])

// 已迁移站点台账：[仓库相对路径, 该文件里必须存在的共享实现调用, 最少出现次数]。
// 语义是"这些位置已经按码点了，退回码元就红"。只能增长、不得缩小；新增收敛站点时应在此登记。
// 锚点刻意只取「函数名 + 前两个实参前缀」，不带省略号字面量 —— 否则改一个省略号字符就会把台账打红，
// 而台账要防的是"退回码元"，不是"改标点"。
const MIGRATED_SITES = [
  ['apps/desktop/src/components/ConfigProfileManager.vue', 'codePointLength(value)', 1],
  ['apps/desktop/src/components/ConfigProfileManager.vue', 'codePointLength(name)', 2],
  ['apps/desktop/src/components/PublishProgressTaskRow.vue', 'truncate(text, 120', 1],
  ['apps/desktop/src/components/PublishProgressTaskRow.vue', 'truncate(text, 16', 1],
  ['apps/desktop/src/components/film-canvas/ShotNode.vue', 'truncate(text, 90', 1],
  ['apps/desktop/src/components/SceneCard.vue', 'truncate(p, 80', 1],
  ['apps/desktop/src/composables/useCollectionDrafts.js', 'truncate(text, max', 1],
  ['apps/desktop/src/composables/useCopyLibrary.js', 'codePointLength(it.content)', 1],
  ['apps/desktop/src/composables/useCopyLibrary.js', 'truncate(entry && entry.title, TITLE_LIMIT', 1],
  ['apps/desktop/src/composables/useCopyLibrarySources.js', 'codePointLength(it.content)', 1],
  ['apps/desktop/src/composables/useFeatureFlag.js', 'truncate(rawValue, 24', 1],
  ['apps/desktop/src/composables/usePipelineHistory.js', 'truncateWithin(msg, 60', 1],
  ['apps/desktop/src/features/collection/QuickCollectPanel.vue', 'truncate(text, 70', 1],
  ['apps/desktop/src/features/hot-topics/gen-video-view-model.js', 'truncate(topic, 30', 1],
  ['apps/desktop/src/views/CreateHistory.vue', 'truncate(name, 10', 1],
  ['apps/desktop/src/views/CreateViewHistory.vue', 'truncate(text, max - 1', 1],
  ['apps/desktop/src/views/HotTopics.vue', 'truncate(topic, 60', 1],
  ['apps/desktop/src/views/ResultView.vue', 'truncateWithin(text, 60', 1],
  ['apps/desktop/src/views/video-creation/StageProgress.vue', 'truncateWithin(stage.error, 50', 1],
]

const IMPORT_LINE_RE = /import\s*\{([^}]*)\}\s*from\s*'@multi-publish\/shared-utils\/src\/text-length'/

// 两个谓词各自**只有一份实现**：既被接线锁调用，也被下面的"判据本体正控"直接喂历史文本。
// 抽出来不是为好看：变异实测（M2）过一版"探针自带一份正则"的写法，把锁里的撞车分支改成 `if (false)`
// 后测试照绿 —— 探针测的是它自己抄的那份，不是锁用的那份。单一实现才让"削弱锁"必然红。
function deadImports (names, rest) {
  // 只认「被当函数调用」—— 对象字面量的键 truncate: 与属性名不是使用（ResultView.vue 实测踩过）
  return names.filter((n) => !new RegExp('\\b' + n + '\\s*\\(').test(rest))
}
function collidedDecls (names, rest) {
  return names.filter((n) => new RegExp('^\\s*(?:function|const|let|var|class)\\s+' + n + '\\b', 'm').test(rest))
}

function sourceFiles () {
  const out = execFileSync('git', ['ls-files', '--', `${SRC_ROOT}/**/*.vue`, `${SRC_ROOT}/**/*.js`], {
    cwd: REPO, encoding: 'utf8',
  })
  const files = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((p) => !/\.test\.|\.contract\.|__tests__\//.test(p))
  if (files.length === 0) throw new Error('git ls-files 取到 0 个源文件 ⇒ 扫描域塌了，拒绝出"零违规"结论')
  return files
}

function read (rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

function hitsIn (rel) {
  return (read(rel).match(forbiddenRe()) || []).length
}

describe('按码元截断 + 追省略号的写法不得回退（阶段 4.7 ① 防再犯锁）', () => {
  const files = sourceFiles()

  it('扫描域非空且达到本仓规模下界（域塌了必须红，不得读成"零违规=通过"）', () => {
    expect(files.length, 'apps/desktop/src 下源文件数').toBeGreaterThan(300)
  })

  it('违规只允许出现在例外清单里，且清单只能缩小', () => {
    const offenders = []
    for (const rel of files) {
      const n = hitsIn(rel)
      if (n > 0) offenders.push([rel, n])
    }
    const unexpected = offenders.filter(([rel]) => !ALLOWED.has(rel))
    expect(unexpected, '新增按码元截断的站点：' + JSON.stringify(unexpected)).toEqual([])
  })

  it('反失明锚点：判据本体必须真的认得四种被禁形态（不得靠"仓库里还有违规"自证）', () => {
    // 评审 i4：原先这里写的是 offenders.length > 0。例外清单的合法终点是**空集**，
    // 那条断言会在收尾当天必然变红，于是"为了保绿而保留一条没必要的例外"成了唯一出路 —— 逆向激励。
    // 改成给判据喂合成样本做正控：判据退化（正则被改宽、被改成恒不匹配）当场红。
    const cases = [
      ["const a = t.slice(0, 60) + '\u2026'", 'slice + 单字符省略号'],
      ["const a = t.substring(0, 60) + '...'", 'substring + 三点省略号'],
      ["const a = t.slice(0, max - 1) + '\u2026'", '右参带运算符的 slice'],
      ["const a = t.slice(0, 60).concat('\u2026')", 'concat 形态'],
    ]
    for (const [src, what] of cases) {
      expect(forbiddenRe().test(src), '判据必须认「' + what + '」这一形态').toBe(true)
    }
    // 反向正控：合法写法不得被误伤（否则锁会把人推回"自己再抄一份截断"）
    for (const ok of [
      'const b = arr.slice(0, 3)',
      'const c = s.slice(0, 10)',
      "const e = parts.slice(0, n).join('-')",
      'const f = list.slice(0, 5).map(render)',
    ]) {
      expect(forbiddenRe().test(ok), '合法写法不得命中：' + ok).toBe(false)
    }
  })

  it('例外清单不得陈旧：每条登记必须当场仍有命中', () => {
    const stale = [...ALLOWED.keys()].filter((rel) => {
      if (!fs.existsSync(path.join(REPO, rel))) return true
      return hitsIn(rel) === 0
    })
    expect(stale, '这些例外已经没有命中了，必须从清单删除（登记与修复不同次发生即红）：' + stale.join(', ')).toEqual([])
  })

  it('每条例外必须带实质理由（空手登记不算放行）', () => {
    for (const [rel, reason] of ALLOWED) {
      expect(typeof reason, rel).toBe('string')
      expect(reason.trim().length, rel + ' 的 reason 过短').toBeGreaterThan(20)
    }
  })

  it('已迁移站点必须逐条仍然按码点（把站点退回 .length / Array.from 时该锚点就找不到）', () => {
    const missing = []
    let visited = 0
    for (const [rel, call, times] of MIGRATED_SITES) {
      visited++
      if (!fs.existsSync(path.join(REPO, rel))) { missing.push(rel + ' 文件不在'); continue }
      const n = read(rel).split(call).length - 1
      if (n < times) missing.push(rel + ' :: ' + call + ' 现读到 ' + n + ' 次，台账要求 ' + times)
    }
    expect(missing, '这些已收敛的站点不再调用共享实现（退回码元计数即回归）：\n' + missing.join('\n')).toEqual([])
    // 遍历计数必须等于台账长度：变异实测（M5）把循环改成 `of []` 时，missing 恒空、totalSites 仍从台账
    // 数组算出 19 ⇒ 两条判据全程静默。"我数了台账"与"我逐条量了台账"是两件事，这条补的是后者。
    expect(visited, '实际遍历条数必须等于台账条数（循环换了集合就是装饰）').toBe(MIGRATED_SITES.length)
    const totalSites = MIGRATED_SITES.reduce((a, [, , times]) => a + times, 0)
    expect(totalSites, '台账站点总数下界（台账被删空 ⇒ 这条锁自己失效）').toBeGreaterThanOrEqual(19)
  })

  it('导入必须被真正调用，且不得与本地同名声明撞车（vite build 真踩过重复声明）', () => {
    const importers = files.filter((rel) => read(rel).includes('shared-utils/src/text-length'))
    expect(importers.length, '引用 text-length 的源文件数').toBeGreaterThanOrEqual(15)
    const problems = []
    for (const rel of importers) {
      const lines = read(rel).split(/\r?\n/)
      const importLines = lines.filter((l) => IMPORT_LINE_RE.test(l))
      if (importLines.length === 0) continue
      const rest = lines.filter((l) => !importLines.includes(l)).join('\n')
      for (const line of importLines) {
        const names = line.match(IMPORT_LINE_RE)[1].split(',').map((s) => s.trim()).filter(Boolean)
        // 只认「被当函数调用」—— 判据本体在 deadImports / collidedDecls，正控探针与锁共用同一份实现
        for (const n of deadImports(names, rest)) problems.push(rel + ' :: 导入了 ' + n + ' 但没有任何调用点（死导入）')
        for (const n of collidedDecls(names, rest)) problems.push(rel + ' :: 本地已声明同名 ' + n + '，与共享实现重复声明（rollup: already been declared）')
      }
    }
    expect(problems, '导入接线问题：\n' + problems.join('\n')).toEqual([])
  })

  it('撞车谓词必须认得本案历史文本（模块作用域重复声明无法做成可运行变异，故直接喂判据）', () => {
    // 为什么这条不写成"把仓库改坏再跑"：`import { truncate }` 与同作用域 `function truncate` 并存是
    // **语法错误**，注入回去红在 rollup/vitest 转换器而不是红在这把锁上（本 PR 的 CI 就是这么红的：
    // Identifier "truncate" has already been declared (71:9)，build rc=1）。那种红不构成锁的证据，
    // 所以这里用判据本体做正控：历史文本必须被点名，干净的形状不得被点名。
    const NAME_RE = (n) => new RegExp('^\\s*(?:function|const|let|var|class)\\s+' + n + '\\b', 'm')
    const HIST = "function truncate (value, limit) {\n  return String(value == null ? '' : value).slice(0, limit)\n}"
    expect(NAME_RE('truncate').test(HIST), '本案历史形态必须被点名').toBe(true)
    expect(NAME_RE('truncate').test("  const truncate = cached"), '缩进的本地声明同样必须被点名').toBe(true)
    expect(NAME_RE('truncate').test("  truncate: 'x'"), '对象键不是声明，不得误伤').toBe(false)
    expect(NAME_RE('truncate').test('  truncate(text, 60)'), '调用不是声明，不得误伤').toBe(false)
    // 邻键不得替它顶罪：声明的是 truncateWithin，查 truncate 时必须放行
    expect(NAME_RE('truncate').test('  function truncateWithin (v) {}'), '前缀同名不得算撞车').toBe(false)
    // ⛔ 上面五条喂的是**探针自己那份正则**，它红了不代表锁在跑。下面两条才是"锁与探针同源"的判据：
    // 把 collidedDecls/deadImports 改成恒返回空集，本用例必须跟着红（变异 M2/M6 实测）。
    expect(collidedDecls(['truncate'], HIST), '锁用的撞车谓词必须认得本案历史形态').toEqual(['truncate'])
    expect(deadImports(['truncateWithin'], "const x = truncate(text, 60, '…')"), '锁用的死导入谓词必须点名').toEqual(['truncateWithin'])
  })

  it('正向对偶：共享实现本身能挡住代理对切半（否则这条锁只是在禁形式）', async () => {
    const { truncate, truncateWithin, hasDanglingSurrogate } = await import(
      '@multi-publish/shared-utils/src/text-length'
    )
    const s = 'a'.repeat(19) + '🎉尾巴'
    expect(hasDanglingSurrogate(s.slice(0, 20))).toBe(true)
    expect(hasDanglingSurrogate(truncate(s, 20, '...'))).toBe(false)
    expect(truncateWithin('abcdefgh', 5, '…')).toBe('abcd…')
    // 数据字段钳制（第三参显式传空串）：不追加省略号、按码点钳制 —— 落库字段必须走这一档
    expect(truncate('🎉abc', 1, '')).toBe('🎉')
    expect(truncate('🎉abc', 1)).toBe('🎉…')
  })
})
