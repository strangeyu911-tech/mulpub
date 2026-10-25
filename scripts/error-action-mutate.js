// 反证驱动：阶段 1.10b「错误卡片要有直达动作」。
// 每一刀都必须让**分配给它的那条**测试变红；collected 不等判 PROBE_BLIND 而不是 MISSED。
// 本地跑：node scripts/error-action-mutate.js [--only=E1,E3]
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const VUE = 'apps/desktop/src/components/AiWriterPanel.vue'
const SUITE = 'src/components/AiWriterPanel.error-action.test.js'
const VITEST = path.join(REPO, 'node_modules', 'vitest', 'vitest.mjs')

const MUTATIONS = [
  {
    id: 'E1',
    label: '动作行永不渲染（把错误卡退回"只有一句话"）',
    edits: [{ file: VUE, from: 'v-if="panelError && panelErrorActionLabel"', to: 'v-if="false"' }],
  },
  {
    id: 'E2',
    label: '动作由原生 button 降级为 div（键盘不可达）',
    edits: [
      { file: VUE, from: '      <button\n        type="button"\n        class="panel-error-action cohere-btn-primary"', to: '      <div\n        role="button"\n        class="panel-error-action cohere-btn-primary"' },
      { file: VUE, from: '      >{{ t(panelErrorActionLabel) }}</button>', to: '      >{{ t(panelErrorActionLabel) }}</div>' },
    ],
  },
  {
    id: 'E3',
    label: '码表放宽到 TIMEOUT（给没有直达意义的错误也挂「前往模型设置」）',
    edits: [{ file: VUE, from: '  API_KEY_NOT_CONFIGURED: "rewritePage.goToModelSettings",', to: '  API_KEY_NOT_CONFIGURED: "rewritePage.goToModelSettings",\n  TIMEOUT: "rewritePage.goToModelSettings",' }],
  },
  {
    id: 'E4b',
    label: '同时摘掉两层防御（合取 + 清码）——证明"动作不得在错误消失后残留"这条不变式真有牙',
    // 单摘任何一层都是**等价变异**（实测 E4 与 E4b 的第一版各报 MISSED）：
    // 该不变式由 `panelError &&` 合取与 clearPanelError() 清码两处冗余实现。
    // 所以这一刀同时摘两层，红才归因到测试；冗余本身也在记录里写明，不假装是测试强。
    edits: [
      { file: VUE, from: 'v-if="panelError && panelErrorActionLabel"', to: 'v-if="panelErrorActionLabel"' },
      { file: VUE, from: 'function clearPanelError() {\n  panelError.value = ""\n  panelErrorCode.value = ""\n}', to: 'function clearPanelError() {\n  panelError.value = ""\n}' },
    ],
  },
  {
    id: 'E5',
    label: '动作按钮的点击不调 goToProviders（点了没反应）',
    edits: [{ file: VUE, from: '        @click="goToProviders"', to: '        @click="void 0"' }],
  },
  {
    id: 'E7',
    label: '删掉 en 侧的 goToModelSettings 键（按钮会静默变成 key 原文）',
    edits: [{ file: 'apps/desktop/src/locales/rewrite-page/en.js', from: '    goToModelSettings: "Open model settings",', to: '' }],
  },
  {
    id: 'E8',
    label: 'res.data.error 分支绕过清码出口 —— 必须**同时**摘掉 doRewrite 开头的 clearPanelError() 才可见',
    // 实测单摘 setPanelErrorText 是**等价变异**（MISSED）：doRewrite 在每次开始处还调了一次
    // clearPanelError()，那是同一不变式的第三层实现。三层里摘任一层都无观测差异。
    // 处置不是删掉这一刀，而是把它做成复合刀并同时把「三层冗余」写进执行记录 ——
    // 单行变异不红不等于测试弱；但也绝不为凑红去编一条本来不存在的可观测行为。
    edits: [
      { file: VUE, from: '      setPanelErrorText(res.data.error)', to: '      panelError.value = res.data.error' },
      { file: VUE, from: '  clearPanelError()\n  rewriting.value = true', to: '  rewriting.value = true' },
    ],
  },
  {
    id: 'E6',
    label: 'formatUserError 的 errorCode 被再次丢弃（回到本项立项时的形态）',
    edits: [{ file: VUE, from: '  panelErrorCode.value = formatted.errorCode || ""', to: '  panelErrorCode.value = ""' }],
  },
]

// （原先这里有一段对 MUTATIONS[3] 的覆盖赋值，用来给 E4 找真实锚点。
//  E4 已换成 E4b（打模板合取），覆盖块若留着会把新锚点顶回去，故整段删除。）

const arg = process.argv.find((a) => a.startsWith('--only=')) || ''
const only = arg ? arg.split('=')[1].split(',') : null
const targets = only ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS
if (only && targets.length !== only.length) {
  console.error('MUTATION_ID_UNKNOWN requested=' + only.join(',') + ' known=' + MUTATIONS.map((m) => m.id).join(','))
  process.exit(2)
}
const dupCheck = new Set()
for (const m of targets) {
  if (dupCheck.has(m.id)) { console.error('重复的变异 id: ' + m.id); process.exit(2) }
  dupCheck.add(m.id)
}

const touched = [...new Set(targets.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = new Map(touched.map((f) => [f, fs.readFileSync(path.join(REPO, f), 'utf8')]))
const restoreAll = () => { for (const [f, t] of originals) fs.writeFileSync(path.join(REPO, f), t, 'utf8') }

function runSuite () {
  let out = ''
  let rc = 0
  let spawnErr = ''
  if (!fs.existsSync(VITEST)) throw new Error('找不到 vitest 入口：' + VITEST)
  try {
    out = execFileSync(process.execPath, [VITEST, 'run', SUITE], { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    rc = typeof e.status === 'number' ? e.status : 99
    spawnErr = typeof e.status === 'number' ? '' : String(e.message || e).slice(0, 200)
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const plain = out.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
  const failed = Number((plain.match(/Tests\s+(\d+) failed/) || [])[1] || 0)
  const passedM = plain.match(/Tests[^\n]*?(\d+) passed/)
  const passed = passedM ? Number(passedM[1]) : 0
  const totalM = plain.match(/Tests\s+[^\n]*?\((\d+)\)/)
  const red = plain.split(/\r?\n/).filter((l) => /^\s*(?:×|FAIL)\s/.test(l)).slice(0, 3)
  return { rc, failed, passed, total: totalM ? Number(totalM[1]) : 0, spawnErr, red }
}

try {
  const base = runSuite()
  if (base.rc !== 0 || base.failed !== 0 || base.passed === 0) {
    console.error('[BASELINE] 基线未成立 rc=' + base.rc + ' failed=' + base.failed + ' passed=' + base.passed + ' spawnErr=' + base.spawnErr)
    console.error(base.red.join('\n'))
    process.exit(3)
  }
  console.log('[BASELINE] 全绿 passed=' + base.passed + ' collected=' + base.total)
  const results = []
  for (const m of targets) {
    const working = new Map(originals)
    let anchorProblem = null
    for (const e of m.edits) {
      const src = working.get(e.file)
      const eol = src.includes('\r\n') ? '\r\n' : '\n'
      const from = eol === '\n' ? e.from : e.from.replace(/\n/g, eol)
      const to = eol === '\n' ? e.to : e.to.replace(/\n/g, eol)
      const hits = src.split(from).length - 1
      if (hits !== 1) { anchorProblem = 'ANCHOR_' + (hits === 0 ? 'NOT_FOUND' : 'AMBIGUOUS') + '(hits=' + hits + ')'; break }
      working.set(e.file, src.replace(from, to))
    }
    if (anchorProblem) { results.push({ id: m.id, verdict: anchorProblem }); continue }
    try {
      for (const [f, t] of working) fs.writeFileSync(path.join(REPO, f), t, 'utf8')
      const r = runSuite()
      if (r.total !== base.total) results.push({ id: m.id, verdict: 'PROBE_BLIND', detail: 'collected=' + r.total + ' ≠ ' + base.total + ' spawnErr=' + r.spawnErr })
      else if (r.failed > 0) results.push({ id: m.id, verdict: 'CAUGHT', red: r.red.join(' ⏎ ').slice(0, 190) })
      else if (r.rc !== 0 && !(r.passed > 0)) results.push({ id: m.id, verdict: 'PROBE_BLIND', detail: 'rc=' + r.rc + ' 无汇总 spawnErr=' + r.spawnErr })
      else results.push({ id: m.id, verdict: 'MISSED', rc: r.rc, passed: r.passed })
    } finally { restoreAll() }
  }
  let restoreBad = 0
  for (const [f, t] of originals) if (fs.readFileSync(path.join(REPO, f), 'utf8') !== t) { restoreBad++; console.error('[RESTORE_FAIL] ' + f) }
  for (const r of results) console.log(r.id + ' ' + r.verdict + ' ' + (r.red || r.detail || ''))
  const caught = results.filter((r) => r.verdict === 'CAUGHT').length
  console.log('[SUMMARY] 共 ' + results.length + ' 条：CAUGHT=' + caught + ' 其余=' + (results.length - caught) + ' 还原失败=' + restoreBad)
  process.exit(restoreBad > 0 ? 4 : results.length > 0 && caught === results.length ? 0 : 1)
} catch (e) {
  restoreAll()
  console.error('[DRIVER_ERROR] 已尽力还原：' + (e && e.message ? e.message : String(e)))
  process.exit(2)
}
