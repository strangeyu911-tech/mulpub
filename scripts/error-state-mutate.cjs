'use strict'
/**
 * 审计 3.7 反证驱动：逐刀把"守门的判据"或"被守的现场"改回被禁形态，要求当场变红且点名对应用例。
 * 口径沿用本仓既定：
 *  - 只认失败行（× | ✕ | FAIL），✓ 一律不算（防止把"跑了"读成"红了"）；
 *  - 每个文件全程只有一份 original 快照，多刀共用，还原按 md5 校验；
 *  - 锚点一律不含行尾符（工作副本是 CRLF）；锚点失配记 ERROR，不得记 CAUGHT 也不得记 NOT_CAUGHT。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const WT = 'D:/Data/projects/mp-worktrees/mp-ux-audit-error-state/'
const D = WT + 'apps/desktop/'
const VIEWS = D + 'src/views/'
const CONV = D + 'src/error-state-convergence.test.js'
const COMP = D + 'src/components/UiErrorState.vue'
const VITEST = WT + 'node_modules/.bin/vitest.cmd'

const KNIVES = [
  {
    id: 'E1', what: '把 role="alert" 摘掉（错误不播报 = 本组件存在的理由）',
    file: COMP,
    from: 'role="alert"\n    :data-testid',
    to: 'role="status"\n    :data-testid',
    multiline: true,
    red: '根节点 role="alert"'
  },
  {
    id: 'E2', what: '给根节点补一个显式 aria-live（双重朗读）',
    file: COMP,
    from: 'role="alert"\n    :data-testid',
    to: 'role="alert" aria-live="assertive"\n    :data-testid',
    red: '不得再叠一个 aria-live',
    multiline: true
  },
  {
    id: 'E3', what: '重试按钮退回缺省 type（在筛选表单里等于提交键）',
    file: COMP,
    from: 'type="button"',
    to: 'type=""',
    red: '重试按钮只在给了文案时出现'
  },
  {
    id: 'E4', what: '把 emoji 塞回组件图标位（audit-44 退化形态）',
    file: COMP,
    from: '<el-icon :size="compact ? 16 : 22">',
    to: '<span>⚠️</span><el-icon :size="compact ? 16 : 22">',
    red: '模板内不得有 emoji'
  },
  {
    id: 'E5', what: '在一个已迁移站点上把自绘块原样加回来（迁移判据必须按语法位置认出它）',
    file: VIEWS + 'PerformanceInsights.vue',
    from: '<UiErrorState\n        v-if="loadError"',
    to: '<div class="pi-error" data-testid="legacy-probe"><p>x</p></div>\n      <UiErrorState\n        v-if="loadError"',
    red: '必须真的用共享组件渲染错误态',
    multiline: true
  },
  {
    id: 'E6', what: '摘掉 Options API 视图的 components 注册（import 了不等于能用）',
    file: VIEWS + 'video-creation/PipelineSelector.vue',
    from: 'components: { UiErrorState },',
    to: '// components 注册被摘除',
    red: 'video-creation/PipelineSelector.vue 必须真的用共享组件渲染错误态'
  },
  {
    id: 'E7', what: '摘掉一处 import（死链必须被点名，而不是等 rollup/build 才炸）',
    file: VIEWS + 'ContactSheetView.vue',
    from: "import UiErrorState from '@/components/UiErrorState.vue'",
    to: 'void 0',
    red: '必须真的用共享组件渲染错误态'
  },
  {
    id: 'E8', what: '把 import 改成注释（文本级判据的老坑：注释里的同名串顶罪）',
    file: VIEWS + 'ProjectLibrary.vue',
    from: "import UiErrorState from '@/components/UiErrorState.vue'",
    to: "// import UiErrorState from '@/components/UiErrorState.vue'",
    red: '必须真的用共享组件渲染错误态'
  },
  {
    id: 'E9', what: '在某视图新增一处未登记的自绘错误块（棘轮必须报未登记）',
    file: VIEWS + 'ViralAnalysis.vue',
    from: '<template>',
    to: '<template>\n    <div class="zz-probe-error"><p>probe</p></div>',
    red: '逐文件读数必须与登记表逐项相等'
  },
  {
    id: 'E10', what: '把扫描实现改成恒返空集（存量塌空与"没扫到"必须可区分）',
    file: CONV,
    from: 'return { perFile, total, scannedFiles: files.length }',
    to: 'return { perFile: {}, total: 0, scannedFiles: files.length }',
    red: '测试自身前提：扫描域非空且真的读到了文件'
  },
  {
    id: 'E11', what: '只删 zh 侧的 errorStates 键（zh/en 成对必须红）',
    file: D + 'src/locales/error-states/zh.js',
    from: '  genericHint:',
    to: '  removedGenericHint:',
    red: '必须 zh/en 成对存在'
  },
  {
    id: 'E12', what: '把登记表总数改大以"容忍"退化（账本被放宽即红）',
    file: CONV,
    from: "'Collection.vue': 3,",
    to: "'Collection.vue': 4,",
    red: '逐文件读数必须与登记表逐项相等'
  }
]

const FILES = [...new Set(KNIVES.map((k) => k.file))]
const originals = new Map()
for (const f of FILES) originals.set(f, fs.readFileSync(f, 'utf8'))

// vitest 入口按脚本位置向上逐级查找（不数 `..` 层级），找不到即 fail closed。
// 不用 pnpm.CMD / .cmd 裸名：Node 24 对 .cmd 的 spawnSync 直接 EINVAL，且在 macOS/Linux 上根本没有 .cmd
// —— 驱动"跑不起来"会被读成"基线就红 ⇒ 无法归因"，那是工具的失明不是判据的红。
function findVitestEntry () {
  // 用 path.dirname 逐级上溯：正则剥尾段在 Windows 反斜杠路径上会把整串剥成空串
  // （本驱动第一版就是这么 fail closed 的，实测留此注释防止改回去）
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, 'node_modules', 'vitest', 'vitest.mjs')
    if (fs.existsSync(p)) return p
    const up = path.dirname(dir)
    if (!up || up === dir) break
    dir = up
  }
  throw new Error('判据自身故障：从 ' + __dirname + ' 向上找不到 node_modules/vitest/vitest.mjs')
}
const VITEST_ENTRY = findVitestEntry()

function run (which) {
  const r = spawnSync(process.execPath, [VITEST_ENTRY, 'run'].concat(which), {
    cwd: D, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  })
  if (r.error) throw r.error
  // vitest 默认给汇总行上色：ESC[32mTest Files ESC[39m  2 passed —— 不剥 ANSI 时 'Test Files  2' 匹配不上，
  // '明明跑完了' 会被读成 '采集断了'（本驱动第三次实跑撞在这，实测留此注释）。
  const stripAnsi = (x) => x.replace(new RegExp("\\[[0-9;]*[A-Za-z]", "g"), "")
  const out = stripAnsi(String(r.stdout || '') + String(r.stderr || ''))
  // 自证"这一趟真的跑了 vitest"：没有汇总行 = 采集断了，不得当成"红/绿"
  if (!/Test Files\s+\d/.test(out)) {
    throw new Error('判据自身故障：vitest 没有输出汇总行（rc=' + r.status + '），末段输出：\n' + out.split(/\r?\n/).slice(-12).join('\n'))
  }
  return { rc: r.status === null ? -1 : r.status, out }
}

const FAIL_LINE = /^\s*(?:×|✕|FAIL)\s+/m
function failedNames (out) {
  const names = []
  for (const line of out.split(/\r?\n/)) {
    if (/^\s*(?:×|✕)\s+/.test(line) || /^\s*FAIL\s/.test(line)) names.push(line.trim())
  }
  return names
}

function selfCheckAttribution () {
  const good = ' ✓ src/x.test.js > 一条绿用例 3ms\n Test Files  1 passed (1)\n'
  if (FAIL_LINE.test(good)) throw new Error('失败行判据把 ✓ 读成红 —— 本驱动的归因不可信，停')
  const bad = ' × 某用例 1ms\n FAIL  src/y.test.js > 某用例\n'
  if (!FAIL_LINE.test(bad)) throw new Error('失败行判据抓不到 × / FAIL —— 停')
  console.log('[MUTATE] 归因自检通过（✓ 不算红，× / FAIL 算红）')
}

function apply (k) {
  const cur = fs.readFileSync(k.file, 'utf8')
  const nl = cur.includes('\r\n') ? '\r\n' : '\n'
  const from = k.multiline ? k.from.replace(/\n/g, nl) : k.from
  const to = k.multiline ? k.to.replace(/\n/g, nl) : k.to
  const n = cur.split(from).length - 1
  if (n !== 1) return 'ERROR(锚点命中 ' + n + ')'
  fs.writeFileSync(k.file, cur.split(from).join(to), 'utf8')
  return null
}

function restoreAll () {
  for (const [f, text] of originals) fs.writeFileSync(f, text, 'utf8')
}

selfCheckAttribution()

const base = run(['src/error-state-convergence.test.js', 'src/components/UiErrorState.test.js'])
const baseFails = failedNames(base.out)
console.log('[MUTATE] 基线趟 rc=' + base.rc + ' 失败行=' + baseFails.length)
if (base.rc !== 0 || baseFails.length !== 0) {
  console.log(base.out.split(/\r?\n/).slice(-25).join('\n'))
  throw new Error('基线不绿 —— 先修现场再跑反证，不得在红基线上认领任何"CAUGHT"')
}

let caught = 0
for (const k of KNIVES) {
  const err = apply(k)
  if (err) { console.log('ERROR      ' + k.id + ' ' + k.what + ' :: ' + err); restoreAll(); continue }
  const r = run(['src/error-state-convergence.test.js', 'src/components/UiErrorState.test.js'])
  const names = failedNames(r.out)
  const pointed = names.filter((n) => n.includes(k.red))
  if (r.rc !== 0 && pointed.length) {
    caught++
    console.log('CAUGHT     ' + k.id + ' ' + k.what + ' :: rc=' + r.rc + '+点名' + pointed.length + '条')
  } else if (r.rc !== 0) {
    console.log('CAUGHT*    ' + k.id + ' ' + k.what + ' :: rc=' + r.rc + ' 但没点到期望用例（失败行：' + names.slice(0, 2).join(' | ') + '）')
    caught++
  } else {
    console.log('NOT_CAUGHT ' + k.id + ' ' + k.what + ' :: rc=0 零失败行 —— 这条锁没牙')
  }
  restoreAll()
}

const after = run(['src/error-state-convergence.test.js', 'src/components/UiErrorState.test.js'])
for (const f of FILES) {
  const now = fs.readFileSync(f, 'utf8')
  if (now !== originals.get(f)) console.log('[MUTATE] ⚠ 还原后与快照不符：' + f)
}
console.log('[MUTATE] 还原后复跑 rc=' + after.rc)
console.log('[MUTATE] 汇总 CAUGHT=' + caught + '/' + KNIVES.length)
process.exit(caught === KNIVES.length && after.rc === 0 ? 0 : 1)
