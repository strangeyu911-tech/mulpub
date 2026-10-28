import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 阶段 3.5「令牌双轨收敛」**第一步**的判据：别名只能是指针，不得是第二份字面值。
//
// 为什么需要锁而不是改完就算：双轨的病根不是"有两个名字"，而是"两个名字各自写着一个数字"。
// 这一步把值收敛到一侧之后，任何后来者在被别名那一侧**重新写回 px**（为了"这个组件的圆角差 2px"
// 这种局部诉求）都会让双轨复活，而且复活时两边值不同 —— 表现为"同名不同圆角"的偶发视觉 bug，
// 排查成本极高（本仓已为同类问题立过规矩：单一实现 + 形状锁）。
//
// 四把判据各管一格：
//  ① 漂移锁：被别名侧的声明右侧必须是 `var(--存活令牌)`，出现字面 px 即红；
//  ② 零回归锁：别名建立**之前**两侧的值必须逐字相同（下表 FROZEN_PAIRS 是本批改动前从两份文件
//     当场读出来的，不是设想值）—— 它保证"我做的是别名，不是改刻度"；
//  ③ 冲突清单只能缩小：两侧无等值对应的档位必须逐条带理由登记；
//  ④ 存量下界 + 棘轮：被废弃侧的 `var()` 消费者数量当场可测，只准降不准升（升了说明新代码在用旧名）。

const DIR = path.dirname(fileURLToPath(import.meta.url))
// DIR = <repo>/apps/desktop/src/styles ⇒ 上溯 **4** 级才是仓库根。
// 曾经算成 3 级（得到 apps/），那里没有 `apps/desktop/src` 这个 pathspec ⇒ `git grep` 以"命令失败"抛出，
// 读起来像判据红、实际是路径算错 —— 所以下面 ROOT_OK 是硬前置，不允许把工具失配读成"存量超标"。
const REPO_ROOT = path.resolve(DIR, '..', '..', '..', '..')
if (!fs.existsSync(path.join(REPO_ROOT, 'apps', 'desktop', 'src'))) {
  throw new Error('仓库根算错了：' + REPO_ROOT + ' 下找不到 apps/desktop/src')
}
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8')

/** 从一个 CSS 文本里抽 :root 内的字面量声明（用于从 git 的改动前 blob 复现零回归基线） */
function readVarLiterals (css) {
  const i = css.indexOf(':root {')
  if (i < 0) return {}
  const block = css.slice(i, i + css.slice(i).indexOf('\n}'))
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)]
      .filter((m) => !/var\(/.test(m[2]))
      .map((m) => [m[1], m[2].trim()]),
  )
}

const TOKENS = read('tokens.css')
const COHERE = read('cohere-design-system.css')

/** 别名方向：deprecate → survivor（值在本批之前逐字相同，见 FROZEN_PAIRS） */
/** 与 readVarLiterals 同一根块坐标、只收 var() 引用侧：用来区分"该名已合并成别名"与"读法漏了这一族" */
function readVarRefs (css) {
  const i = css.indexOf(':root {')
  if (i < 0) return {}
  const block = css.slice(i, i + css.slice(i).indexOf('\n}'))
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)]
      .filter((m) => /var\(/.test(m[2]))
      .map((m) => [m[1], m[2].trim()]),
  )
}

// 独立锚点（评审 i3）：判据域不能只由被它保护的那张表自己声明——否则"把 spacing 一族整族删掉"
// 会让 6 条锁一起变恒真。ALIASES 的废弃名侧必须与本名录逐项相等，且每族各有成员下界。
const ALIAS_ROSTER = [
  '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill', '--r-full',
  '--spacing-2', '--spacing-3', '--spacing-4', '--spacing-6', '--spacing-8'
]

const ALIASES = [
  ['--r-xs', '--radius-xs', COHERE],
  ['--r-sm', '--radius-sm', COHERE],
  ['--r-md', '--radius-md', COHERE],
  ['--r-lg', '--radius-lg', COHERE],
  ['--r-xl', '--radius-xl', COHERE],
  ['--r-pill', '--radius-pill', COHERE],
  ['--r-full', '--radius-full', COHERE],
  ['--spacing-2', '--space-sm', TOKENS],
  ['--spacing-3', '--space-md', TOKENS],
  ['--spacing-4', '--space-lg', TOKENS],
  ['--spacing-6', '--space-xl', TOKENS],
  ['--spacing-8', '--space-xxl', TOKENS],
]

/** 本批改动**之前**两侧的字面值（当场从 git 里的旧版读出并抄在此处，用于证"零视觉回归"） */
const FROZEN_PAIRS = {
  '--r-xs': '4px', '--r-sm': '8px', '--r-md': '12px', '--r-lg': '16px', '--r-xl': '20px',
  '--r-pill': '32px', '--r-full': '9999px',
  '--radius-xs': '4px', '--radius-sm': '8px', '--radius-md': '12px', '--radius-lg': '16px',
  '--radius-xl': '20px', '--radius-pill': '32px', '--radius-full': '9999px',
  '--spacing-2': '8px', '--spacing-3': '12px', '--spacing-4': '16px', '--spacing-6': '24px', '--spacing-8': '32px',
  '--space-sm': '8px', '--space-md': '12px', '--space-lg': '16px', '--space-xl': '24px', '--space-xxl': '32px',
}

/** 刻度冲突（两侧无等值对应，本批刻意不合并）。清单只能缩小，每条必须带理由。 */
const CONFLICTS = new Map([
  ['--space-xxs: 2px / --spacing-1: 4px',
    '最小档刻度不同（2 vs 4）。合并要改 45 处 --spacing-1 消费者的实际间距，属可见宽度变化，须与视觉基线刷新同批（AGENTS：基线只能取同一次 CI 渲染）。'],
  ['--space-xs: 6px / （无对应）',
    '6px 在 --spacing-* 数值刻度里不存在（4/8/12…）。要造 spacing-1.5 属设计令牌扩展，不是收敛，单独走设计评审。'],
  ['--space-section: 80px / --spacing-16: 64px',
    '区块间距两处刻度不一致（80 vs 64）。谁胜属设计决策（影响所有大区块留白），不在"零回归第一步"里做。'],
  ['（无对应）/ --spacing-5: 20px',
    '20px 在 --space-* 里落在 lg(16) 与 xl(24) 之间；有 18 处消费者，硬并会改可见间距。'],
  ['（无对应）/ --spacing-10: 40px',
    '40px 在 --space-* 里落在 xxl(32) 与 section(80) 之间，同理保留。'],
])

function declRe (name) {
  return new RegExp('\\' + name + '\\s*:\\s*([^;]+);', 'g')
}
function declsOf (src, name) {
  return [...src.matchAll(declRe(name))].map((m) => m[1].trim())
}
function countConsumers (name) {
  // DIR = <repo>/apps/desktop/src/styles ⇒ 上溯 **4** 级才是仓库根（上溯 3 级会得到 apps/，
  // 那里没有 `apps/desktop/src` 这个 pathspec，git grep 会以"命令失败"抛出 —— 看着像判据红，其实是路径算错）
  const REPO_ROOT = path.resolve(DIR, '..', '..', '..', '..')
  if (!fs.existsSync(path.join(REPO_ROOT, 'apps', 'desktop', 'src'))) {
    throw new Error('仓库根算错了：' + REPO_ROOT + ' 下找不到 apps/desktop/src')
  }
  const files = execFileSync('git',
    ['grep', '-l', '--', `var(${name}`, '--', 'apps/desktop/src'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).filter((f) => !/\.test\.|__tests__/.test(f))
  let n = 0
  for (const f of files) {
    const t = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
    n += [...t.matchAll(new RegExp('var\\(' + name + '\\s*[,)]', 'g'))].length
  }
  return n
}

describe('设计令牌双轨收敛第一步（阶段 3.5）', () => {
  it('别名侧不得出现字面 px（漂移锁：重新写死就等于把双轨复活）', () => {
    const offenders = []
    for (const [dep, survivor, src] of ALIASES) {
      const values = declsOf(src, dep)
      expect(values.length, dep + ' 必须在样式源里恰好声明一次（0 次=被删，>1 次=又开了一处真源）').toBe(1)
      const v = values[0]
      if (!new RegExp('^var\\(' + survivor + '\\s*\\)$').test(v)) {
        offenders.push(dep + ' = ' + v + '（应为 var(' + survivor + ')）')
      }
    }
    expect(offenders, '以下令牌已不再是纯别名：\n' + offenders.join('\n')).toEqual([])
  })

  it('零回归锁：别名建立前两侧字面值必须逐字相同（证这一步没改刻度）', () => {
    const mismatched = []
    for (const [dep, survivor] of ALIASES) {
      const a = FROZEN_PAIRS[dep]
      const b = FROZEN_PAIRS[survivor]
      if (!a || !b || a !== b) mismatched.push(dep + '=' + a + ' vs ' + survivor + '=' + b)
    }
    expect(mismatched, '这些档位两侧原值本就不同，别名会改像素 ⇒ 必须退回冲突清单而不是合并：\n'
      + mismatched.join('\n')).toEqual([])
    // 夹具自证：FROZEN 表若被掏空，本条会恒真地通过 —— 所以先证明它确实非空且成对。
    expect(Object.keys(FROZEN_PAIRS).length, '冻结值表规模下界（被删空 ⇒ 本锁失效）').toBeGreaterThanOrEqual(24)
  })

  it('存活侧仍是字面值（别名方向不得反向：两侧都是 var 就是悬空引用）', () => {
    const dangling = []
    for (const [, survivor] of ALIASES) {
      const v = [...declsOf(TOKENS, survivor), ...declsOf(COHERE, survivor)]
      expect(v.length, survivor + ' 必须恰好声明一次').toBe(1)
      if (/var\(/.test(v[0])) dangling.push(survivor + ' = ' + v[0])
    }
    expect(dangling, '存活侧不能也指向别处（会形成链/环）：\n' + dangling.join('\n')).toEqual([])
  })

  it('刻度冲突清单：只能缩小、每条带理由、且登记项必须当场仍成立（清单不得被掏空）', () => {
    // 反失明：这条判据的"逐条校验"对**空清单恒真**，而"把冲突登记全删了"看起来像"冲突都解决了"。
    // 所以下界必须与实测冲突档位数一致 —— 真正减少冲突时，必须同时删掉对应的令牌声明并过零回归锁。
    expect(CONFLICTS.size, '冲突登记规模下界（被掏空 ⇒ 逐条校验恒真，锁变装饰）').toBeGreaterThanOrEqual(5)
    for (const [key, reason] of CONFLICTS) {
      expect(reason.trim().length, key + ' 缺理由').toBeGreaterThan(20)
      // 登记形如「--a: Xpx / --b: Ypx」；两半都必须在现网源里仍能读到该字面值，否则属陈旧登记
      const halves = key.split('/').map((s) => s.trim()).filter((s) => s.startsWith('--'))
      for (const h of halves) {
        const name = h.split(':')[0].trim()
        const lit = h.split(':')[1].trim()
        const found = [...declsOf(TOKENS, name), ...declsOf(COHERE, name)]
        expect(found, '登记项指向的令牌已不在源里：' + name).toContain(lit)
      }
    }
    // 刻意不再钉"恰好 5"（评审 i4）：合法收敛（5→4）必须只改实现、不改这条；
    // 偷渡新档由上面那条**逐条当场校验**（两侧都得是字面值且真不等）拦，而不是靠手写常量。
  })

  it('存量棘轮：两侧被废弃名都要被量（只测一族等于把另一族留成进度条空白）', () => {
    // 上界是**当场量出来的**（非测试域 var() 引用数），不是设想值；每次跑都打印读数，
    // 这样"随第二阶段下调"在日志里可见，而不是只改一个常量。
    // 评审 i1：第一版只遍历 --r-*，于是新代码继续写 var(--spacing-2) 能过全部判据 —— 一族有牙一族没牙。
    const UPPER_BOUND = {
      '--r-xs': 23, '--r-sm': 33, '--r-md': 4, '--r-lg': 7, '--r-xl': 1, '--r-pill': 12, '--r-full': 13,
      '--spacing-2': 127, '--spacing-3': 69, '--spacing-4': 20, '--spacing-6': 12, '--spacing-8': 2,
    }
    const rows = []
    for (const [dep] of ALIASES) {
      // hasOwnProperty 而非 truthy：某名完全迁移后上界合法地为 0，toBeTruthy 会把 0 读成"漏登记"
      expect(Object.prototype.hasOwnProperty.call(UPPER_BOUND, dep), dep + ' 未登记棘轮上界 ⇒ 判据域漏了这一名').toBe(true)
      const n = countConsumers(dep)
      expect(n, dep + ' 的消费者数超过登记上界 ⇒ 有新代码在用废弃名').toBeLessThanOrEqual(UPPER_BOUND[dep])
      rows.push(dep + '=' + n)
    }
    console.log('[TOKEN-RATCHET] 废弃名存量：' + rows.join(' '))
    expect(rows.length, '棘轮必须遍历到全部 12 个别名（少于 ALIASES 条数＝判据域塌了）').toBe(ALIASES.length)
    // 域完整性不得只对着 ALIASES 自证（i3）：先与独立名录逐项相等，再逐族给成员下界
    expect(ALIASES.map((a) => a[0]).sort(), '废弃名侧与独立锚点 ALIAS_ROSTER 不符 ⇒ 有整族静默退出保护')
      .toEqual([...ALIAS_ROSTER].sort())
    expect(ALIAS_ROSTER.filter((d) => d.startsWith('--r-')).length, 'radius 族成员下界').toBeGreaterThanOrEqual(7)
    expect(ALIAS_ROSTER.filter((d) => d.startsWith('--spacing-')).length, 'spacing 族成员下界').toBeGreaterThanOrEqual(5)
  })

  it('装配锁（评审 i2）：两份令牌文件必须由同一入口装载，且存活令牌都定义在 :root', () => {
    // 别名引入了一份文件到另一份文件的**运行时依赖**：若某上下文只装载 tokens.css 而不装载
    // cohere-design-system.css，`--spacing-2: var(--space-sm)` 就是 guaranteed-invalid，
    // 消费者静默回落到初始值而所有文本级判据照绿。这一条把"装载"与"作用域"两格补上。
    const MAIN = read('../main.js')
    // ⚠️ 必须是**未被注释的整行**：第一版用 `/import\s+['"]...['"]/ ` 在全文里找，
    // 于是 `// import './styles/cohere-design-system.css'` 也算"已装载"—— 变异 T7 实测 rc=0，
    // 这正是本仓记过的老坑（文本级判据看见注释里的同名串）。判据按语法位置切：只认行首 import。
    const loaded = (file) => MAIN.split(/\r?\n/).some((l) => new RegExp('^\\s*import\\s+[\'"]\\./styles/' + file + '[\'"]\\s*;?\\s*$').test(l))
    expect(loaded('tokens.css'), 'main.js 必须以未注释的 import 装载 tokens.css（别名链的一半在那儿）').toBe(true)
    expect(loaded('cohere-design-system.css'), 'main.js 必须以未注释的 import 装载 cohere-design-system.css（另一半在那儿）').toBe(true)
    // 存活侧必须落在 :root 内（落在别的选择器上 ⇒ 在部分元素上不可继承 ⇒ var 悬空）
    const rootBlock = (src) => {
      const i = src.indexOf(':root {')
      return src.slice(i, i + src.slice(i).indexOf('\n}'))
    }
    const rT = rootBlock(TOKENS), rC = rootBlock(COHERE)
    const missing = []
    for (const [, survivor] of ALIASES) {
      const declared = [...declsOf(rT, survivor), ...declsOf(rC, survivor)]
      if (declared.length !== 1) missing.push(survivor + ' 在 :root 内出现 ' + declared.length + ' 次')
    }
    expect(missing, '存活令牌不在 :root 单一声明 ⇒ 别名可能取不到值：\n' + missing.join('\n')).toEqual([])
  })

  it('零回归基线必须能从 git 里的**改动前 blob** 复现（评审 i3：手抄表会对称抄错）', () => {
    // FROZEN_PAIRS 是给人读的，不能是自证循环。这里独立地从 origin/main 的旧 blob 读出字面值，
    // 与表逐项比对：抄错（哪怕两侧同错）会当场暴露，因为 git 里的值只有一个来源。
    // 若 origin/main 已含本批改动（合并之后），blob 里读不到字面值 ⇒ 本条**出声说明退化**，
    // 而不是静默通过（此时防回归靠快照锁按生效值断言 + 别名形状锁）。
    const ref = 'origin/main'
    let derived = null
    let refs = {}
    let reason = ''
    try {
      const oldT = execFileSync('git', ['show', ref + ':apps/desktop/src/styles/tokens.css'],
        { cwd: REPO_ROOT, encoding: 'utf8' })
      const oldC = execFileSync('git', ['show', ref + ':apps/desktop/src/styles/cohere-design-system.css'],
        { cwd: REPO_ROOT, encoding: 'utf8' })
      derived = { ...readVarLiterals(oldT), ...readVarLiterals(oldC) }
      refs = { ...readVarRefs(oldT), ...readVarRefs(oldC) }
    } catch (e) {
      reason = 'git show 失败（' + e.message.slice(0, 60) + '）⇒ 无从比对，本条按未证实出声'
    }
    const diffs = []
    let compared = 0
    let mergedAway = 0
    if (reason) {
      // i2：取不到基准时的"未证实"必须与"通过"分档出声，但不冒充新的失败原因
      console.log('[TOKEN-BASELINE] UNVERIFIED :: ' + reason)
      return
    }
    for (const [name, expected] of Object.entries(FROZEN_PAIRS)) {
      const got = derived[name]
      if (got === undefined) {
        if (Object.prototype.hasOwnProperty.call(refs, name)) { mergedAway++; continue }
        diffs.push(name + ' 在基准 blob 里既不是字面值、也不是 var() 引用 ⇒ 采集断了，不得当通过')
        continue
      }
      compared++
      if (got !== expected) diffs.push(name + '：表=' + expected + ' git=' + got)
    }
    expect(diffs, '冻结表与 git 基准不符 ⇒ "零回归"的论据被抄错：\n' + diffs.join('\n')).toEqual([])
    if (compared === 0) {
      console.log('[TOKEN-BASELINE] 基准 blob 已无待比对字面值（本批已合并）⇒ 交快照锁负责，mergedAway=' + mergedAway)
      expect(mergedAway, 'compared=0 且 mergedAway=0 ＝ 一个名字都没读到，那是采集断了、不是合并完成').toBeGreaterThan(0)
      return
    }
    console.log('[TOKEN-BASELINE] 逐项比对通过（比对 ' + compared + ' 项 = git 值；已合并让位 ' + mergedAway + ' 项）')
  })

  it('四族都必须还在源里被声明（防止"为了过锁而删掉令牌"这种交账方式）', () => {
    for (const f of ['tokens.css', 'cohere-design-system.css']) {
      const src = read(f)
      expect(src.length, f).toBeGreaterThan(1000)
    }
    expect(TOKENS).toMatch(/--radius-full:\s*9999px;/)
    expect(COHERE).toMatch(/--space-section:\s*80px;/)
  })
})
