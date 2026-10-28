import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * 审计 3.7 收敛锁：把"整块自绘错误态 + 重试"的站点迁进共享 `UiErrorState`，并把剩余欠账钉成只能缩小的登记表。
 *
 * 为什么先做"带重试的那一批"：审计实测 35 处整块错误态里只有 9 处给了出口；
 * 一个只会说"失败了"而不给"再来一次"的界面，用户唯一的自救手段是刷新整个应用。
 *
 * 口径来自本仓两条被实测打红过的教训：
 *  - 禁令必须按**语法位置**切，不能按"字符串是否出现"切 —— 迁移后 `class="pi-error"` 仍留在
 *    `<UiErrorState>` 上做钩子，所以"旧块已消失"的判据只能认 `<div|section|p>` 开标签上的该 class；
 *  - 按"目录里有什么"迭代的门禁，永远看不见"该有什么" —— 所以这里既查未登记新增，也查陈旧登记。
 */

const SRC = path.resolve(process.cwd(), 'src')
const REPO = path.resolve(process.cwd(), '..')
// ESM 测试文件里不能用 require —— 上面已按仓库既有写法 import
function gitBase (relPath) {
  try {
    return execFileSync('git', ['show', 'origin/main:' + relPath], { cwd: REPO, encoding: 'utf8' })
  } catch (e) {
    return null
  }
}
const VIEWS = path.join(SRC, 'views')

function readAbs (abs) {
  if (!fs.existsSync(abs)) throw new Error('测试前提不成立：读不到 ' + abs + '（cwd=' + process.cwd() + '）')
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
}

function walkVue (dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkVue(p))
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const TAG_RE = /<(div|section|p|span)\b([^>]*)>/g
const CLASS_RE = /\bclass="([^"]*)"/
const ERROR_TOKEN_RE = /(^|[\s-])(error|is-error|error-state)(?=$|[\s-"])/

/** 单一实现：整块（div/section）自绘错误态站点清点。棘轮与探针都必须用它，禁止第二份口径。 */
function scanBespokeBlockErrors () {
  const files = walkVue(VIEWS)
  const perFile = {}
  let total = 0
  for (const abs of files) {
    const src = readAbs(abs)
    const tpl = src.slice(0, src.indexOf('<script'))
    let m
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(tpl))) {
      if (m[1] !== 'div' && m[1] !== 'section') continue
      const cm = CLASS_RE.exec(m[2])
      if (!cm || !ERROR_TOKEN_RE.test(cm[1])) continue
      const rel = path.relative(VIEWS, abs).replace(/\\/g, '/')
      perFile[rel] = (perFile[rel] || 0) + 1
      total++
    }
  }
  return { perFile, total, scannedFiles: files.length }
}

/** 单一实现：导入了却没在任何标签上用到（死导入）。迁移批次用它防止 #4424 同型事故。 */
function deadImports (src) {
  const bad = []
  const re = /^import\s+(\w+)\s+from\s+['"][^'"]+['"]/gm
  let m
  while ((m = re.exec(src))) {
    const name = m[1]
    const rest = src.slice(0, m.index) + src.slice(m.index + m[0].length)
    if (new RegExp('^\\s*(?:function|const|let|var|class)\\s+' + name + '\\b', 'm').test(rest)) {
      bad.push(name + '（与本地同名声明撞车：rollup 会报 already been declared）')
      continue
    }
    // 死导入的定义就按字面：摘掉 import 语句后，标识符在文件里一次都不出现。
    // 不得用"是否被某几种语法形式使用"的正则枚举 —— 漏一种写法就把活导入报成死导入（假阳）。
    const used = new RegExp('\\b' + name + '\\b').test(rest)
    if (!used) bad.push(name + '（导入了却没有任何使用点）')
  }
  return bad
}

/**
 * 本批迁移的站点。marker = 旧自绘块所在 div 的 class（判据只认 div/section/p/span 开标签上的它，
 * 所以迁移后把同名 class 留在 <UiErrorState> 上不会误报）。
 */
const MIGRATED_SITES = [
  { file: 'PerformanceInsights.vue', marker: 'pi-error', testId: 'pi-error' },
  { file: 'ProjectLibrary.vue', marker: 'error-state', testId: 'project-library-error' },
  { file: 'ContactSheetView.vue', marker: 'cs-error', testId: 'contact-sheet-error' },
  { file: 'CreateHistory.vue', marker: 'history-error', testId: 'renders-error' },
  // 同文件第二处同型站点：只迁第一处时，本条判据（marker=history-error 出现在块级开标签上）当场变红，
  // 逼这一批把同形缺陷一次清干净，而不是留下"改了名字没改干净"的第二处。
  { file: 'CreateHistory.vue', marker: 'history-error pipeline-history-error', testId: 'pipelines-error' },
  { file: 'video-creation/PipelineSelector.vue', marker: 'error-state', testId: 'pipeline-selector-error' },
  { file: 'video-creation/QuickRenderPanel.vue', marker: 'result-banner error', testId: 'quick-error' }
]

/**
 * 剩余欠账登记表（开工前实测 35 处 → 本批迁 7 处后的现状 28 处，14 个文件）。
 * ⛔ 只能缩小：新增未登记站点 ⇒ 红；就地减少却不改本表 ⇒ 陈旧登记 ⇒ 红（逼下一次批次同次销账）。
 *
 * **2026-10-28 随主干 rebase 的下调（28 → 21，仍 14 个文件）**：主干把本视图拆成了
 * `film-engineering/` 下的若干面板（change `film-view-split-debt` / `kit-import-rollback-and-template-health`），
 * `FilmEngineeringView.vue` 里原来登记的 8 处自绘错误态**在拆分后已不存在**（该文件现在一处都没有，
 * 拆分出的面板也没有块级 `error` 类站点），同时主干新增了 `video-creation/HiflyExtraPanel.vue` 1 处
 * （`<div class="inline-error">`）。⇒ 按「实测即真相」下调本表：删 `FilmEngineeringView.vue=8`、
 * 增 `video-creation/HiflyExtraPanel.vue=1`，合计 21。这不是放宽判据：现状实测就是 21，
 * 而本判据逐文件双向对账，任何"少登记一处"或"多留一条陈旧项"都会当场红。
 */
const REGISTRY = {
  'AutoPipelineView.vue': 2,
  'AutomationView.vue': 1,
  'CloudPublish.vue': 1,
  'Collection.vue': 3,
  'CreateView.vue': 1,
  'MemberCenter.vue': 1,
  'PromptEvalView.vue': 1,
  'PublishHistory.vue': 3,
  'ReplayTimeline.vue': 1,
  'RewriteView.vue': 1,
  'ViralAnalysis.vue': 2,
  'video-creation/ErrorDialog.vue': 2,
  'video-creation/HiflyExtraPanel.vue': 1,
  'video-creation/SceneAssetSelection.vue': 1
}

describe('UiErrorState 迁移接线（审计 3.7）', () => {
  let visited = 0
  for (const site of MIGRATED_SITES) {
    it(site.file + ' 必须真的用共享组件渲染错误态，而不是留着自绘块', () => {
      visited++
      const src = readAbs(path.join(VIEWS, site.file))
      const tpl = src.slice(0, src.indexOf('<script'))

      expect(tpl, site.file + ' 模板里找不到 <UiErrorState').toMatch(/<UiErrorState\b/)
      expect(src, site.file + ' 必须以未注释的整行 import 装载组件（注释里的同名串不算）')
        .toMatch(/^\s*import\s+UiErrorState\s+from\s+['"]@\/components\/UiErrorState\.vue['"]/m)
      // 旧块判据按语法位置切：只认块级开标签带该 class，留在 <UiErrorState class="..."> 上不算残留
      expect(tpl, site.file + ' 仍保留自绘块 <div class="' + site.marker + '">').not.toMatch(
        new RegExp('<(?:div|section|p|span)\\b[^>]*\\bclass="[^"]*' + site.marker.replace(/ /g, '[\\s-]+') + '[^"]*"')
      )
      expect(tpl, site.file + ' 迁移后必须保住 data-testid=' + site.testId + '（远处用例与像素门禁靠它锚定）')
        .toContain('test-id="' + site.testId + '"')
      // Options API 里"import 了"不等于"能用"：没进 components: 就是一个解析不到的自定义标签，
      // Vue 只在运行时 warn 并渲染成**空节点**，`.text()` 拿到 ''。本批就是被这条实测抓出来的
      // （CreateHistory.vue 用 `<script>` + `components:`，迁移后用例报 expected '' to contain '加载超时'）。
      const scriptBlock = src.slice(src.indexOf('<script'))
      const isOptionsApi = /<script>/.test(src) && !/<script\s+setup/.test(src)
      if (isOptionsApi) {
        expect(scriptBlock, site.file + ' 是 Options API，必须把 UiErrorState 注册进 components:（只 import 不注册 = 渲染成空节点）')
          .toMatch(/components:\s*\{[^}]*\bUiErrorState\b[^}]*\}/)
      } else {
        expect(scriptBlock.slice(0, scriptBlock.indexOf('</script>'))).toMatch(/<script\s+setup/)
      }
      expect(deadImports(src), site.file + ' 存在死导入/撞车声明').toEqual([])
    })
  }

  it('迁移站点清单必须被逐条遍历（登记数与实际遍历数相等，防"清单非空但一条没跑"）', () => {
    expect(visited, '遍历条数必须等于清单条数').toBe(MIGRATED_SITES.length)
    expect(MIGRATED_SITES.length, '清单塌空 ⇒ 本文件所有判据都会恒真').toBeGreaterThanOrEqual(6)
  })

  it('迁移不得静默丢掉改动前存在的任何 data-testid（第二轮评审 i1：容器保了、按钮锚点丢了）', () => {
    // 判据由 git 的改动前 blob 派生，不是手抄清单 —— 手抄清单本身会成为第二个矛盾源（同 PRD §1 的 83/93）。
    const lost = []
    let checked = 0
    for (const site of MIGRATED_SITES) {
      const rel = 'apps/desktop/src/views/' + site.file
      const before = gitBase(rel)
      if (before === null) { console.log('[ERR-ANCHOR] UNVERIFIED :: 取不到 origin/main:' + rel); continue }
      const now = readAbs(path.join(VIEWS, site.file))
      const ids = new Set([...before.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]))
      for (const id of ids) {
        // 迁移后该锚点必须仍在**同一文件**里（落在组件的 test-id / retry-test-id 上），
        // 否则远处用例与像素基线会在无人察觉的情况下失锚。
        if (!now.includes('"' + id + '"')) lost.push(site.file + ' :: ' + id)
        checked++
      }
    }
    console.log('[ERR-ANCHOR] 已核对锚点 ' + checked + ' 个（取自 origin/main 的改动前 blob）')
    expect(checked, '一个锚点都没核对＝采集断了，不是通过').toBeGreaterThan(0)
    expect(lost, '迁移丢掉的 data-testid：\n' + lost.join('\n')).toEqual([])
  })

  it('PipelineSelector 的 emoji 图标已随迁移消失（audit-44 退化形态）', () => {
    const tpl = readAbs(path.join(VIEWS, 'video-creation/PipelineSelector.vue')).slice(0, 4000)
    expect(tpl.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu), '仍含 emoji：' + JSON.stringify(tpl.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu)))
      .toBeNull()
  })
})

describe('整块自绘错误态存量棘轮', () => {
  const measured = scanBespokeBlockErrors()
  const keys = Object.keys(measured.perFile).sort()

  it('测试自身前提：扫描域非空且真的读到了文件', () => {
    expect(measured.scannedFiles, 'views 下应扫到 .vue 文件；0 说明坐标错了').toBeGreaterThan(40)
    expect(measured.total, '存量塌成 0 与"扫描没跑到"同形，一律视为失明').toBeGreaterThan(0)
    expect(keys.length).toBeGreaterThanOrEqual(Object.keys(REGISTRY).length)
  })

  it('逐文件读数必须与登记表逐项相等（新增未登记 ⇒ 红；减少不销账 ⇒ 陈旧红）', () => {
    console.log('[ERR-RATCHET] files=' + keys.length + ' total=' + measured.total
      + ' 清单=' + keys.map((k) => k + '=' + measured.perFile[k]).join(' '))
    const problems = []
    for (const k of keys) {
      if (!(k in REGISTRY)) problems.push(k + '：未登记的自绘错误态站点（新增或换了文件名）')
      else if (REGISTRY[k] !== measured.perFile[k]) {
        problems.push(k + '：登记 ' + REGISTRY[k] + ' 实测 ' + measured.perFile[k]
          + (measured.perFile[k] < REGISTRY[k] ? '（已改善，必须在同一次提交里下调本表销账）' : '（变差）'))
      }
    }
    for (const k of Object.keys(REGISTRY)) {
      if (!(k in measured.perFile)) problems.push(k + '：登记表里的站点已不存在，登记项必须删除')
    }
    expect(problems, '存量棘轮不一致：\n' + problems.join('\n')).toEqual([])
  })

  it('总存量不得高于登记总数（21）——每迁一处必须同次把表改小', () => {
    const registered = Object.values(REGISTRY).reduce((a, b) => a + b, 0)
    expect(measured.total, '实测 ' + measured.total + ' > 登记 ' + registered).toBeLessThanOrEqual(registered)
    expect(registered).toBe(21)
  })
})

describe('errorStates 文案配对（Gate 7 的同源前置）', () => {
  const zh = readAbs(path.join(SRC, 'locales/error-states/zh.js'))
  const en = readAbs(path.join(SRC, 'locales/error-states/en.js'))
  const used = new Set()
  for (const site of MIGRATED_SITES) {
    const src = readAbs(path.join(VIEWS, site.file))
    for (const m of src.matchAll(/errorStates\.(\w+)/g)) used.add(m[1])
  }

  it('模板里用到的每个 errorStates.* 键必须 zh/en 成对存在', () => {
    expect(used.size, '一个键都没取到 ⇒ 判据失明，而不是通过').toBeGreaterThan(0)
    const missing = []
    for (const k of used) {
      const re = new RegExp('^\\s*' + k + '\\s*:', 'm')
      if (!re.test(zh)) missing.push(k + '@zh')
      if (!re.test(en)) missing.push(k + '@en')
    }
    expect(missing, '缺键：' + missing.join(',')).toEqual([])
  })

  it('两份 locale 必须都接进 zh.js / en.js 的聚合入口（导了文件没接线 = 运行时取不到）', () => {
    for (const [f, side] of [['locales/zh.js', 'zh'], ['locales/en.js', 'en']]) {
      const src = readAbs(path.join(SRC, f))
      expect(src).toMatch(new RegExp("from '\\./error-states/" + side + "'"))
      expect(src).toMatch(/errorStates:\s*\{\s*\.\.\.errorStates(?:Zh|En)\s*\}/)
    }
  })
})
