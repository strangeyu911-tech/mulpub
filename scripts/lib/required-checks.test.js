'use strict'
// 判据「required 清单对账面 + 恒 skipped 探测」的行为锁。
// 夹具一律注入（不落真实 gh、不读真实仓），真实仓那份读数由 CLI 的 --report 现跑给出。
const test = require('node:test').test
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const RC = require('./required-checks.js')

function mkRepo (workflows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reqchk-'))
  const wd = path.join(dir, '.github', 'workflows')
  fs.mkdirSync(wd, { recursive: true })
  for (const [name, src] of Object.entries(workflows)) fs.writeFileSync(path.join(wd, name), src)
  return dir
}
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true })
const first = (d, ctx) => (d.producers.get(ctx) || [])[0]

const QG = [
  'name: Quality Gate',
  'on:',
  '  pull_request:',
  '    branches: [main]',
  '  schedule:',
  '    - cron: "0 3 * * *"',
  'jobs:',
  '  changes:',
  '    name: QG Changes',
  '    runs-on: ubuntu-latest',
  '  coverage:',
  '    name: QG Coverage',
  '    steps:',
  '      - name: QG Coverage 不该被当成 job 名',
  '        uses: actions/checkout@v4',
  '        with:',
  '          name: 嵌套里的 name 不是 check 名',
  '  static-gates:',
  '    name: QG Static',
  '',
].join('\n')

const ELECTRON = ['on: push', 'jobs:', '  electron-tests:', '    runs-on: windows-latest', ''].join('\n')

test('派生：显式 name 与 job id 两条来源都要认出（只认 name 会漏 electron-tests / build）', () => {
  const repo = mkRepo({ 'quality-gate.yml': QG, 'electron-ci.yml': ELECTRON })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    assert.equal(d.selfFault, null, JSON.stringify(d))
    assert.equal(first(d, 'QG Changes').workflow, 'quality-gate.yml')
    assert.equal(first(d, 'QG Changes').job, 'changes')
    assert.equal(first(d, 'QG Static').job, 'static-gates')
    assert.equal(first(d, 'QG Coverage').job, 'coverage', '显式 name 与 job id 同时存在时，check 名取 name、产出者仍指到该 job')
    assert.equal(first(d, 'electron-tests').workflow, 'electron-ci.yml', '没有显式 name 的 job 必须回落到 job id')
  } finally { rm(repo) }
})

test('派生：steps 的 name、with 里嵌套的 name 都不许成为 check 名（缩进锚必须按层）', () => {
  const repo = mkRepo({ 'quality-gate.yml': QG })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    assert.equal(d.selfFault, null, '派生必须成功，否则下面两句断言是在空集合上恒真：' + JSON.stringify(d))
    assert.ok(!d.producers.has('QG Coverage 不该被当成 job 名'), '8 空格缩进的 step name 被当成 check 名')
    assert.ok(!d.producers.has('嵌套里的 name 不是 check 名'), 'with: 里的嵌套 name 被当成 check 名')
  } finally { rm(repo) }
})

test('派生：on: 的触发器名绝不允许进 job 集（朴素两空格解析正是这样失明的）', () => {
  const repo = mkRepo({ 'quality-gate.yml': QG })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    assert.equal(d.selfFault, null, '派生必须成功，否则下面那句断言是在空集合上恒真：' + JSON.stringify(d))
    for (const t of RC.TRIGGER_NAMES) assert.ok(!d.producers.has(t), `触发器 ${t} 混进了派生 job 集`)
  } finally { rm(repo) }
})

test('派生退化（一个 job 都派生不出）必须报 selfFault，不得报"没有产出者"', () => {
  const repo = mkRepo({ 'odd.yml': 'name: X\njobs:\n' })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    assert.ok(d.selfFault, '空派生集必须是 selfFault，实得 ' + JSON.stringify(d))
    assert.equal(d.count, 0)
  } finally { rm(repo) }
})

test('派生退化（某个文件声明了 jobs: 却一条 job 没认出）要点名该文件，不得只给残缺集合', () => {
  const repo = mkRepo({
    'good.yml': ['on: push', 'jobs:', '  a:', '    name: A', ''].join('\n'),
    'broken.yml': ['on: push', 'jobs:', '    indented_job:', '      runs-on: x', ''].join('\n'),
  })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    assert.ok(d.selfFault, 'jobs 用四空格缩进的文件必须报退化，实得 ' + JSON.stringify(d))
    assert.match(d.selfFault, /broken\.yml/, '退化文案必须点名是哪个文件断了')
  } finally { rm(repo) }
})

test('顶格注释不得结束 jobs 区间（实测 doc-gate.yml:96 就有零缩进注释；两个 job 之间夹一行就会静默吃掉后面全部 job）', () => {
  const repo = mkRepo({
    'c.yml': ['on: push', 'jobs:', '  a:', '    name: A', '', '# ===== 说明 =====', '# 顶格注释', '', '  b:', '    name: B', ''].join('\n'),
  })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    assert.equal(d.selfFault, null, JSON.stringify(d))
    assert.ok(d.producers.has('A') && d.producers.has('B'), '注释后的 job 丢了：' + [...d.producers.keys()].join(','))
  } finally { rm(repo) }
})

test('一个 check 名可以有多个产出者：派生必须留全部，否则第二个产出者的 run 整批看不见', () => {
  const repo = mkRepo({
    'build.yml': 'on: push\njobs:\n  changes:\n    name: Changes\n',
    'electron-ci.yml': 'on: push\njobs:\n  changes:\n    name: Changes\n',
  })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    const list = d.producers.get('Changes') || []
    assert.equal(list.length, 2, JSON.stringify(list))
    assert.deepEqual(list.map((p) => p.workflow + '#' + p.job).sort(), ['build.yml#changes', 'electron-ci.yml#changes'])
  } finally { rm(repo) }
})

const D = (entries) => ({
  selfFault: null,
  count: entries.length,
  producers: new Map(entries.map(([ctx, ps]) => [ctx, ps.map((p) => ({ explicitName: true, ...p }))])),
})
const REG = (ctxs) => ({ required: ctxs.map((c) => ({ context: c.context, producedBy: c.producedBy, mechanisms: c.mechanisms || ['classic'], why: '锁 ' + c.context })) })

test('双向差集：平台多出来的一条要红（有人在平台加了闸而仓内无人知道）', () => {
  const derived = D([['A', [{ workflow: 'x.yml', job: 'a' }]], ['B', [{ workflow: 'x.yml', job: 'b' }]]])
  const r = RC.judge({
    derived,
    registry: REG([{ context: 'A', producedBy: { workflow: 'x.yml', job: 'a' } }]),
    platform: { union: ['A', 'B'], selfFault: null },
    debt: {}, debtViolations: [],
    presence: { A: { form: 'produced' }, B: { form: 'produced' } },
  })
  assert.equal(r.rc, 1)
  assert.ok(r.violations.some((v) => /平台要求而仓内未登记/.test(v) && /\bB\b/.test(v)), JSON.stringify(r.violations))
})

test('双向差集：登记有而平台没有也要红（那是"闸被摘了"唯一的机械出口）', () => {
  const r = RC.judge({
    derived: D([['A', [{ workflow: 'x.yml', job: 'a' }]], ['其它', [{ workflow: 'x.yml', job: 'o' }]]]),
    registry: REG([{ context: 'A', producedBy: { workflow: 'x.yml', job: 'a' } }]),
    // 平台侧非空但**不含 A**才是"摘了 A"；并集整体为空走上面那条未证实档（两者动作不同）。
    platform: { union: ['其它'], selfFault: null, notes: [], sources: { classic: ['其它'], rulesets: [] } },
    debt: {}, debtViolations: [],
    presence: { A: { form: 'produced' } },
  })
  assert.equal(r.rc, 1)
  assert.ok(r.violations.some((v) => /仓内登记而平台没有/.test(v)), JSON.stringify(r.violations))
})

test('登记的产出者不在派生集合里要红；派生出多个产出者时登记命中其中之一即算对', () => {
  const derived = D([
    ['A', [{ workflow: 'new.yml', job: 'a' }]],
    ['M', [{ workflow: 'p.yml', job: 'one' }, { workflow: 'q.yml', job: 'two' }]],
  ])
  const wrong = RC.judge({
    derived,
    registry: REG([{ context: 'A', producedBy: { workflow: 'old.yml', job: 'a' } }, { context: 'M', producedBy: { workflow: 'p.yml', job: 'one' } }]),
    platform: { union: ['A', 'M'], selfFault: null },
    debt: {}, debtViolations: [],
    presence: { A: { form: 'produced' }, M: { form: 'produced' } },
  })
  assert.equal(wrong.rc, 1)
  assert.ok(wrong.violations.some((v) => /产出者不在派生集合里/.test(v) && /派生 \[new\.yml#a\]/.test(v)), JSON.stringify(wrong.violations))
  assert.equal(wrong.counts.multi, 1, '多产出者要计数可见（M）')
})

test('恒 skipped / absent / no-run 三档各自违规，红文案要能分辨是哪一档', () => {
  const derived = D([
    ['A', [{ workflow: 'x.yml', job: 'a' }]],
    ['B', [{ workflow: 'y.yml', job: 'b' }]],
    ['C', [{ workflow: 'z.yml', job: 'c' }]],
  ])
  const reg = REG([
    { context: 'A', producedBy: { workflow: 'x.yml', job: 'a' } },
    { context: 'B', producedBy: { workflow: 'y.yml', job: 'b' } },
    { context: 'C', producedBy: { workflow: 'z.yml', job: 'c' } },
  ])
  const base = { derived, registry: reg, platform: { union: ['A', 'B', 'C'], selfFault: null }, debt: {}, debtViolations: [] }
  const r = RC.judge({ ...base, presence: {
    A: { form: 'always-skipped', runs: 6 },
    B: { form: 'absent', runs: 6 },
    C: { form: 'no-run', runs: 0 },
  } })
  assert.equal(r.rc, 1)
  assert.ok(r.violations.some((v) => /恒 skipped/.test(v) && /\bA\b/.test(v)), JSON.stringify(r.violations))
  assert.ok(r.violations.some((v) => /从未出现/.test(v) && /\bB\b/.test(v)), JSON.stringify(r.violations))
  assert.ok(r.violations.some((v) => /不在合并路径上/.test(v) && /\bC\b/.test(v)), JSON.stringify(r.violations))
  assert.ok(r.lines.join('\n').includes('noRun=1'), 'no-run 必须单独计数可见：' + r.lines.join(' | '))
})

test('欠账指向一条已经产出过结论的 check 要红（陈旧登记不删＝免检牌发错人）', () => {
  const r = RC.judge({
    derived: D([['A', [{ workflow: 'x.yml', job: 'a' }]]]),
    registry: REG([{ context: 'A', producedBy: { workflow: 'x.yml', job: 'a' } }]),
    platform: { union: ['A'], selfFault: null },
    debt: { A: '曾经恒 skipped' }, debtViolations: [],
    presence: { A: { form: 'produced' } },
  })
  assert.equal(r.rc, 1)
  assert.ok(r.violations.some((v) => /不再成立/.test(v)), JSON.stringify(r.violations))
})

test('取不到读数 ⇒ rc=2（未证实档），不得与"发现违规"同档也不得读成合规', () => {
  const r = RC.judge({
    derived: D([['A', [{ workflow: 'x.yml', job: 'a' }]]]),
    registry: REG([{ context: 'A', producedBy: { workflow: 'x.yml', job: 'a' } }]),
    platform: { union: ['A'], selfFault: null },
    debt: {}, debtViolations: [],
    presence: { A: { form: 'selfFault', detail: 'gh api rc=1' } },
  })
  assert.equal(r.rc, 2, `实得 rc=${r.rc} lines=${r.lines.join(' | ')}`)
  assert.equal(r.violations.length, 0, '故障档不得顺手造违规（一个修工具、一个修清单）')
  assert.ok(r.lines.join('\n').includes('unproven=1'))
})

test('窗口分类五档：fetched 没给＝失明；0 条且未扫到顶＝no-run；0 条且扫到顶＝失明；只有未定论读数＝失明；有 run 没这个名字＝absent', () => {
  const W = (o) => ({ windows: [o] })
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [{ jobs: { A: 'skipped' } }, { jobs: { A: 'skipped' } }], fetched: true }), 'A').form, 'always-skipped')
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [], fetched: true, scanned: 3 }), 'A').form, 'no-run')
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [], fetched: true, scanned: RC.MAX_SCAN }), 'A').form, 'selfFault', '扫到上限仍没样本＝扫描面不够，不能判"它不跑"')
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [{ status: 'completed', jobs: { A: 'success' } }, { status: 'completed', jobs: {} }], fetched: true }), 'A').form, 'produced')
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [{ status: 'completed', jobs: {} }], fetched: true }), 'A').form, 'absent')
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [{ jobs: { A: null } }], fetched: true }), 'A').form, 'selfFault', 'in_progress/queued 不是结论，不得当成"产出过"')
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [{ jobs: { A: 'skipped' } }, { jobs: { A: null } }], fetched: true }), 'A').form, 'always-skipped', '未定论的那条不得把已有结论洗掉')
  assert.equal(RC.judgePresence(W({ workflow: 'x.yml', runs: [], fetched: false }), 'A').form, 'selfFault', '没证明取到数就是失明，不是"没跑"')
  assert.equal(RC.judgePresence({ windows: [] }, 'A').form, 'selfFault', '没有产出者可探测＝失明，不是合规')
})

test('多产出者聚合：任一产出者跑出结论即 produced；一个 workflow 的 run 里没有该名字不得把另一个的真结论抹成 absent', () => {
  const two = { windows: [
    { workflow: 'build.yml', runs: [{ jobs: { Changes: 'skipped' } }], fetched: true },
    { workflow: 'electron-ci.yml', runs: [{ jobs: { Changes: 'success' } }], fetched: true },
  ] }
  assert.equal(RC.judgePresence(two, 'Changes').form, 'produced')
  const allSkipped = { windows: [
    { workflow: 'build.yml', runs: [{ jobs: { Changes: 'skipped' } }], fetched: true },
    { workflow: 'electron-ci.yml', runs: [], fetched: true },
  ] }
  assert.equal(RC.judgePresence(allSkipped, 'Changes').form, 'always-skipped', '另一个产出者 no-run 不得把恒 skipped 洗白')
  const oneFault = { windows: [
    { workflow: 'build.yml', runs: [{ jobs: { Changes: 'success' } }], fetched: true },
    { workflow: 'electron-ci.yml', runs: null, fetched: false },
  ] }
  assert.equal(RC.judgePresence(oneFault, 'Changes').form, 'selfFault', '任一产出者取不到数就整体未证实（produced 只答了半个问题）')
})

test('欠账四条：空 reason / 超上限 / 陈旧键 / 文件缺席，各自指名红或按零欠账放行', () => {
  const req = ['A', 'B']
  const empty = RC.validateDebt({ debt: { A: '  ' }, required: req, max: RC.MAX_DEBT })
  assert.ok(empty.violations.some((v) => /理由不成立/.test(v)), JSON.stringify(empty.violations))
  const over = RC.validateDebt({ debt: { A: '甲', B: '乙' }, required: req, max: 1 })
  assert.ok(over.violations.some((v) => /上限/.test(v)), JSON.stringify(over.violations))
  assert.equal(over.counted, 2, '求和域必须自己报分母')
  const stale = RC.validateDebt({ debt: { GONE: '曾经' }, required: req, max: RC.MAX_DEBT })
  assert.ok(stale.violations.some((v) => /不再是 required/.test(v)), JSON.stringify(stale.violations))
  const missingFile = RC.validateDebt({ debt: null, required: req, max: RC.MAX_DEBT })
  assert.equal(missingFile.violations.length, 0, '文件缺席＝零欠账（安全方向）')
})

test('登记面读不到必须抛错，不得返回空集合（"零漂移"与"没登记面"必须可区分）', () => {
  const repo = mkRepo({ 'x.yml': ['on: push', 'jobs:', '  a:', '    name: A', ''].join('\n') })
  try {
    assert.throws(() => RC.readRegistry(repo), /缺 scripts\/required-checks\.json/)
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(repo, RC.REGISTRY_REL), '{ not json')
    assert.throws(() => RC.readRegistry(repo), /不是合法 JSON/)
    fs.writeFileSync(path.join(repo, RC.REGISTRY_REL), JSON.stringify({ required: [{ context: 'A' }] }))
    assert.throws(() => RC.readRegistry(repo), /缺 producedBy/)
    fs.writeFileSync(path.join(repo, RC.REGISTRY_REL), JSON.stringify({ required: [{ context: 'A', producedBy: { workflow: 'x.yml', job: 'a' }, why: '  ' }] }))
    assert.throws(() => RC.readRegistry(repo), /缺 why/)
  } finally { rm(repo) }
})

test('三档退出码不得混档：合规 0 / 违规 1 / 未证实 2，且首行自带全部分母', () => {
  const derived = D([['A', [{ workflow: 'x.yml', job: 'a' }]]])
  const ok = RC.judge({
    derived,
    registry: REG([{ context: 'A', producedBy: { workflow: 'x.yml', job: 'a' } }]),
    platform: { union: ['A'], selfFault: null },
    debt: {}, debtViolations: [],
    presence: { A: { form: 'produced' } },
  })
  assert.equal(ok.rc, 0)
  assert.match(ok.head, /^REQUIRED-CHECKS-SCAN required=\d+ derived=\d+ multi=\d+ drift=\d+ dead=\d+ noRun=\d+ unproven=\d+ debtAck=\d+ verdict=/, ok.head)
  const nums = ok.head.match(/required=(\d+) derived=(\d+)/)
  assert.equal(nums[1], '1'); assert.equal(nums[2], '1', '首行必须自带分母，否则"0 违规"读起来像什么都没扫')
})

test('真实仓的登记面必须与派生结果自洽（防"登记漂了而只有临时夹具知道"）', () => {
  const repo = path.join(__dirname, '..', '..')
  const d = RC.deriveWorkflowChecks(repo)
  assert.equal(d.selfFault, null, JSON.stringify(d))
  assert.ok(d.count >= 50, `派生规模退化：${d.count}`)
  const reg = RC.readRegistry(repo)
  assert.ok(reg.required.length >= 8, `登记面规模退化：${reg.required.length}`)
  for (const e of reg.required) {
    const list = RC.producersOf(d, e.context)
    assert.ok(list.length > 0, `登记的 ${e.context} 在任何 workflow 里都派生不出产出者`)
    assert.ok(list.some((p) => p.workflow === e.producedBy.workflow && p.job === e.producedBy.job),
      `${e.context} 的登记产出者不在派生集合里：` + JSON.stringify(list))
  }
  // 现场事实（本刀实测）：`Changes` 这个 check 名有两个产出者。多产出者索引若退回单值，这条会当场红。
  const changes = RC.producersOf(d, 'Changes')
  assert.deepEqual(changes.map((p) => p.workflow + '#' + p.job).sort(), ['build.yml#changes', 'electron-ci.yml#changes'],
    '派生对同名多产出者的读数变了：' + JSON.stringify(changes))
})

test('欠账清单起始为空、上限为 0，且被否证的那条必须原样留档（不许静默改写）', () => {
  const repo = path.join(__dirname, '..', '..')
  const debt = RC.readDebt(repo)
  assert.equal(RC.MAX_DEBT, 0, '现读 10/10 produced ⇒ 起始零欠账；抬上限＝人工放宽谁来守门')
  assert.equal(Object.keys(debt).length, RC.MAX_DEBT, `欠账条数 ${Object.keys(debt).length} != MAX_DEBT ${RC.MAX_DEBT}`)
  const raw = JSON.parse(fs.readFileSync(path.join(repo, RC.DEBT_REL), 'utf8'))
  const note = raw._否证记录
  assert.ok(typeof note === 'string' && note.includes('QG Coverage'), '否证记录必须点名被撤的那条')
  assert.match(note, /取数域|错域/, '必须写清错在哪（只删登记不写原因＝下一个会话会重新长出同一条）')
})

test('平台侧两套机制取并集：列表接口 rules 恒空 ⇒ 必须按 id 逐个取详情；404 与 403 动作不同', () => {
  const fetcher = (args) => {
    if (/branches\/main\/protection$/.test(args[0])) return { required_status_checks: { contexts: ['Gate Result', 'QG Unit Tests', 'build'] } }
    if (/\/rulesets$/.test(args[0])) return [{ id: 23749994, name: 'main-ci-gate' }, { id: 7, name: '另一份' }]
    if (/rulesets\/23749994$/.test(args[0])) return { rules: [{ parameters: { required_status_checks: [{ context: 'QG Static' }, { context: '文档同步检查' }] } }] }
    if (/rulesets\/7$/.test(args[0])) return { rules: [{ parameters: {} }] }
    throw new Error('不该取：' + args[0])
  }
  const p = RC.platformSets({ fetcher, repo: 'o/r' })
  assert.equal(p.selfFault, null, JSON.stringify(p))
  assert.deepEqual([...p.union].sort(), ['Gate Result', 'QG Static', 'QG Unit Tests', 'build', '文档同步检查'].sort())
  assert.equal(p.sources.rulesets.length, 2, '两份 ruleset 都要取详情（列表的 rules 恒空，按 id 逐个取才有读数）')
  const twoMechanisms = p.sources.classic.length > 0 && p.sources.rulesets.some((r) => r.contexts.length > 0)
  assert.ok(twoMechanisms, '只查一套机制正是本仓出过的假结论')

  const fourOhFour = RC.platformSets({
    repo: 'o/r',
    fetcher: (args) => {
      if (/protection$/.test(args[0])) throw new Error('gh: Not Found (HTTP 404)')
      if (/\/rulesets$/.test(args[0])) return []
      throw new Error('不该取：' + args[0])
    },
  })
  assert.equal(fourOhFour.selfFault, null, '404 是合法状态（该机制没配），不得当取数失败')
  assert.match(fourOhFour.notes.join(' '), /classic protection 不存在/)

  const fourOhThree = RC.platformSets({ repo: 'o/r', fetcher: () => { throw new Error('gh: Resource not accessible by integration (HTTP 403)') } })
  assert.match(fourOhThree.selfFault, /classic protection 取不到.*403/, JSON.stringify(fourOhThree))
})

test('平台并集为空而登记面非空 ⇒ 按未证实，不得把"取不到"读成"十道闸都被摘"', () => {
  const derived = D([['A', [{ workflow: 'x.yml', job: 'a' }]]])
  const r = RC.judge({
    derived,
    registry: REG([{ context: 'A', producedBy: { workflow: 'x.yml', job: 'a' } }]),
    platform: { union: [], selfFault: null, notes: ['平台并集为空'], sources: { classic: [], rulesets: [] } },
    debt: {}, debtViolations: [],
    presence: { A: { form: 'produced' } },
  })
  assert.equal(r.rc, 2, JSON.stringify(r.violations) + ' ' + JSON.stringify(r.unproven))
  assert.ok(r.unproven.some((v) => /平台并集为空/.test(v)), JSON.stringify(r.unproven))
})

// 编号约定：这条必须留在**文件末尾**（`lib#23`）。插到中间会让 D7 台账里所有 `lib#N` 引用位移，
// 而那份台账是按**实测时**的序号写的——序号错位等于把每条变异指到的锁点全写错。


test('空行不得结束 jobs 区间（这一格与顶格注释分属两道守卫，必须各有指名自己的锁）', () => {
  // 「顶格注释不得结束 jobs 区间」那条的夹具里**同时**有顶格注释和空行（那是 doc-gate.yml:96 的真实
  // 形状：实测 95 行是空行、96 行是零缩进 `# ===== 说明 =====`），所以它变红时分不清是哪道守卫被摘。
  // 本夹具只有空行、没有注释 ⇒ 摘掉「空行不结束区间」这一道，红点名在这里；
  // 摘掉「注释不结束区间」那一道，本条保持绿（红只落在上一条锁）。
  const repo = mkRepo({
    'b.yml': ['on: push', 'jobs:', '  a:', '    name: A', '', '', '  b:', '    name: B', ''].join('\n'),
  })
  try {
    const d = RC.deriveWorkflowChecks(repo)
    assert.equal(d.selfFault, null, JSON.stringify(d))
    assert.ok(d.producers.has('A') && d.producers.has('B'), '空行后的 job 丢了：' + [...d.producers.keys()].join(','))
  } finally { rm(repo) }
})

test('窗口里的 run 没跑完时，"这个名字不在作业清单里"是未定论而不是缺席（2026-10-28 本机现取的假红）', () => {
  // 现场：REQUIRED-CHECKS-SCAN 报 `Gate Result form=absent runs=6`，而 gh pr checks 里该 job 正在跑。
  // 按代码路径反推只有一种可能：那 6 条 run 当时**全部**是 queued/in_progress —— GitHub 对未完成的
  // run 只给出部分作业清单（本机两次现取窗口构成：`2 completed + 3 queued + 1 in_progress` 与
  // `4 completed + 2 in_progress`，每条 completed 都列出该名字，未完成的只列出 1–9 条作业）。
  // 于是"还没跑到"被读成"它不存在"⇒ 一条会自己消失的假红：比恒红更坏，因为它教人忽略红。
  const W = (o) => ({ windows: [o] })

  // ① 全在飞 ⇒ 未证实（不得是 absent，也不得是 no-run）
  const allInFlight = W({ workflow: 'x.yml', fetched: true, scanned: 6, runs: [
    { status: 'in_progress', jobs: { Changes: 'success' } },
    { status: 'queued', jobs: {} },
    { status: 'queued', jobs: {} },
  ] })
  const f1 = RC.judgePresence(allInFlight, 'Gate X')
  assert.equal(f1.form, 'selfFault', '窗口全在飞时缺席无从判定：' + JSON.stringify(f1))
  assert.match(String(f1.detail || ''), /3 条未跑完|未跑完/, '文案必须说出"有几条还没跑完"：' + f1.detail)

  // ② 混合：已完成的 run 里确实没有这个名字 ⇒ 缺席是真证据，但必须把两侧计数都写出来
  const mixed = W({ workflow: 'x.yml', fetched: true, scanned: 6, runs: [
    { status: 'completed', jobs: { Changes: 'success' } },
    { status: 'completed', jobs: {} },
    { status: 'queued', jobs: {} },
  ] })
  const f2 = RC.judgePresence(mixed, 'Gate X')
  assert.equal(f2.form, 'absent', '已完成且不含该名字＝真缺席，不得被在飞的那条洗成未证实：' + JSON.stringify(f2))
  assert.match(String(f2.detail || ''), /已完成 2/, '缺席文案必须交代证据面（几条已完成、几条在飞）：' + f2.detail)

  // ③ 名字出现在未完成的 run 里且已有结论 ⇒ 仍算产出过（不得因 run 整体未结束而丢读数）
  const producedWhileRunning = W({ workflow: 'x.yml', fetched: true, scanned: 1, runs: [
    { status: 'in_progress', jobs: { 'Gate X': 'success' } },
  ] })
  assert.equal(RC.judgePresence(producedWhileRunning, 'Gate X').form, 'produced')

  // ④ 没给 status（旧夹具形状 / 探针没抄全）一律按未定论处理，不得默认"跑完了"
  const noStatus = W({ workflow: 'x.yml', fetched: true, scanned: 1, runs: [{ jobs: {} }] })
  assert.equal(RC.judgePresence(noStatus, 'Gate X').form, 'selfFault', 'status 缺席不是"已完成"的证据')
})
