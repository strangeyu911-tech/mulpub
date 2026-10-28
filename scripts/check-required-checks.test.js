'use strict'
// CLI 档的行为锁：全部经注入的 fetch 跑，不碰网络、不碰真实 gh。
// 为什么必须是行为锁而不是"读源码里有没有某句话"：本文件要防的是"CLI 把取不到读数控成合规"
// 与"外部输入被拼进命令行"这两类真实后果，只有真跑一次才看得见。
const test = require('node:test').test
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CLI = require('./check-required-checks.js')

function mkFixtureRepo (workflows, registry, debt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reqchk-cli-'))
  const wd = path.join(dir, '.github', 'workflows')
  fs.mkdirSync(wd, { recursive: true })
  for (const [name, src] of Object.entries(workflows)) fs.writeFileSync(path.join(wd, name), src)
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  // registry 传 null = 故意不落盘登记面（"登记面缺席"这一档必须能被测到）
  if (registry !== null) fs.writeFileSync(path.join(dir, 'scripts', 'required-checks.json'), JSON.stringify(registry, null, 2))
  fs.writeFileSync(path.join(dir, 'scripts', 'required-check-debt.json'), JSON.stringify(debt || { _comment: '夹具' }, null, 2))
  return dir
}
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true })

const TWO_JOBS = ['on:', '  pull_request:', 'jobs:', '  a:', '    name: A', '  b:', '    name: B', ''].join('\n')
const REG2 = { required: [
  { context: 'A', producedBy: { workflow: 'q.yml', job: 'a' }, mechanisms: ['classic'], why: '锁 A' },
  { context: 'B', producedBy: { workflow: 'q.yml', job: 'b' }, mechanisms: ['classic'], why: '锁 B' },
] }

/**
 * 造一个只认固定 endpoint 形态的假 gh：`runs` 决定该 workflow 的 run 列表，
 * `jobOf(runId)` 决定每条 run 里两个 job 的结论。`calls` 记录每次调用的 args 数组（注入面判据要看它）。
 */
function makeFetch ({ runs = [], jobOf = () => ({ A: 'success', B: 'success' }), protection, rulesets = [{ id: 1 }], rulesetDetail, throwOn }) {
  const calls = []
  const fetch = (args) => {
    calls.push(args)
    const ep = args[0]
    if (throwOn && ep.includes(throwOn.on)) throw new Error(throwOn.message)
    if (/actions\/workflows\/[^/]+\/runs/.test(ep)) {
      const m = ep.match(/per_page=(\d+)/)
      const per = m ? Number(m[1]) : 20
      return { workflow_runs: runs.slice(0, per) }
    }
    if (/actions\/runs\/\d+\/jobs/.test(ep)) {
      const id = Number(ep.match(/actions\/runs\/(\d+)\/jobs/)[1])
      const run = runs.find((r) => r.id === id)
      const concl = jobOf(run)
      return { jobs: Object.entries(concl).map(([name, conclusion]) => ({ name, conclusion })) }
    }
    if (/branches\/main\/protection$/.test(ep)) return protection === undefined ? { required_status_checks: { contexts: ['A', 'B'] } } : protection
    if (/\/rulesets$/.test(ep)) return rulesets
    if (/\/rulesets\/\d+$/.test(ep)) return rulesetDetail || { rules: [{ parameters: { required_status_checks: [] } }] }
    if (/^repos\/[^/]+\/[^/]+$/.test(ep)) return { full_name: 'someone/repo' }
    throw new Error('夹具没准备这个 endpoint：' + ep)
  }
  fetch.calls = calls
  return fetch
}

// status 必须是真实 API 会给的值：缺席证据只能由已完成的 run 给出（见 lib 侧同名缺陷的锁）。
const PUSH_RUNS = [{ id: 101, event: 'push', status: 'completed', created_at: '2026-10-27T00:00:00Z' }, { id: 102, event: 'pull_request', status: 'completed', created_at: '2026-10-26T00:00:00Z' }]

function run (argv, fetch, repoRoot) {
  const out = []
  const rc = CLI.main(argv, { fetch, repoRoot, log: (s) => out.push(s) })
  return { rc, out: out.join('\n') }
}

test('未知旗标 ⇒ rc=2 并点名旗标，绝不静默按默认档跑（"我传了旗标"不能靠记忆）', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const r = run(['--reprot'], makeFetch({ runs: PUSH_RUNS }), dir)
    assert.equal(r.rc, 2, r.out)
    assert.match(r.out, /SELF-FAULT.*未知旗标.*--reprot/)
    assert.ok(!/verdict=PASS/.test(r.out), '参数都没认全就不能报合规：' + r.out)
  } finally { rm(dir) }
})

test('非法 --mode= 一律 rc=2，不得回落到 advisory（回落等于把打错的阻断档读成不阻断）', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const r = run(['--mode=enforces'], makeFetch({ runs: PUSH_RUNS }), dir)
    assert.equal(r.rc, 2, r.out)
    assert.match(r.out, /非法 --mode=/)
  } finally { rm(dir) }
})

test('仓库标识的形态白名单作用在"解析后的值"上：默认档从 gh 取回的脏值同样被拒', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const dirty = (args) => (args[0] === 'repos/{owner}/{repo}' ? { full_name: 'someone/not a repo' } : makeFetch({ runs: PUSH_RUNS })(args))
    // 校验必须发生在"解析后的值"上；退出码按档分（advisory 恒 0、enforce 交回 2），
    // 所以这里的可观测物是**出声**，不是 rc —— 原实现只断了 rc=2，那是把"档"当成了"判据"。
    const dirtyAdv = run(['--report'], dirty, dir)
    assert.match(dirtyAdv.out, /SELF-FAULT/, '默认档从 gh 取回的脏值必须被拒并出声：' + dirtyAdv.out)
    assert.equal(dirtyAdv.rc, 0, 'advisory 档即使拒了脏值也不得阻断：' + dirtyAdv.out)
    assert.equal(run(['--mode=enforce', '--report'], dirty, dir).rc, 2, '脏值在 enforce 档必须是未证实档 rc=2')
    assert.ok(CLI.REPO_SHAPE.test('some/repo'), '合法形态必须放行，否则判据自己跑不起来')
    assert.ok(!CLI.REPO_SHAPE.test('a/b; rm -rf /'), '分号形态必须整串拒绝')
    assert.ok(!CLI.REPO_SHAPE.test('a/b/c'), '多一段也算脏（拼进 endpoint 会换仓库）')
    assert.equal(run(['--repo=ok/repo', '--report'], makeFetch({ runs: PUSH_RUNS }), dir).rc, 0)
  } finally { rm(dir) }
})

test('唯一的 spawn 出口：argv 数组、shell 必须为 false、外部输入只占一个参数元素', () => {
  const seen = []
  const fakeSpawn = (cmd, args, opts) => {
    seen.push({ cmd, args, opts })
    return { status: 0, stdout: '{"ok":true}', stderr: '' }
  }
  assert.deepEqual(CLI.ghJson(['repos/o/r', 'q.yml; rm -rf /'], fakeSpawn), { ok: true })
  assert.equal(seen[0].cmd, 'gh')
  assert.deepEqual(seen[0].args, ['api', 'repos/o/r', 'q.yml; rm -rf /'], '输入必须原样留在数组元素里，不拼串')
  assert.equal(seen[0].opts.shell, false, 'shell:true 会把数组重新拼成一条命令串＝注入面回来了')
  // 逗号 / 换行 / 分号同族：只要它们留在**同一个数组元素**里，gh 就只能当一个参数读。
  CLI.ghJson(['repos/o/r', 'a,b\nc'], fakeSpawn)
  assert.deepEqual(seen[1].args, ['api', 'repos/o/r', 'a,b\nc'], '逗号与换行不得把一条 endpoint 拆成两个参数')
  const boom = () => ({ status: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)' })
  assert.throws(() => CLI.ghJson(['repos/o/r'], boom), /403/)
  const garbage = () => ({ status: 0, stdout: '<html>登录页</html>', stderr: '' })
  assert.throws(() => CLI.ghJson(['repos/o/r'], garbage), /不可解析/)
})

test('workflow 名进 endpoint 前被编码，且一次调用只送一个 endpoint 元素', () => {
  const fetch = makeFetch({ runs: PUSH_RUNS })
  CLI.windowFor('o/r', 'q.yml; rm -rf /', new Map(), fetch)
  const ep = fetch.calls[0][0]
  assert.ok(ep.includes(encodeURIComponent(';')), '分号必须被编码：' + ep)
  assert.equal(fetch.calls[0].length, 1, 'endpoint 之外的多余元素会被 gh 当独立参数解释')
})

test('恒 skipped 的 required：advisory 打印违规但 rc=0；enforce 交回 rc=1', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const f = makeFetchWithConclusions(dir, { A: 'skipped', B: 'success' })
    const adv = run(['--repo=o/r', '--mode=advisory', '--report'], f, dir)
    assert.equal(adv.rc, 0, adv.out)
    assert.match(adv.out, /恒 skipped.*\bA\b/s)
    assert.match(adv.out, /MODE=advisory verdict=VIOLATIONS rc=1/)
    assert.ok(!/全部合规/.test(adv.out), 'advisory 不得把违规念成合规：' + adv.out)
    const enf = run(['--repo=o/r', '--mode=enforce', '--report'], f, dir)
    assert.equal(enf.rc, 1, enf.out)
    assert.match(enf.out, /MODE=enforce verdict=VIOLATIONS rc=1/)
  } finally { rm(dir) }
})

test('producer workflow 只跑 schedule ⇒ no-run 违规（required 却不在合并路径上），文案要点名扫了几条', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const f = makeFetch({ runs: [{ id: 9, event: 'schedule', created_at: '2026-10-27T00:00:00Z' }] })
    const r = run(['--repo=o/r', '--mode=enforce', '--report'], f, dir)
    assert.equal(r.rc, 1, r.out)
    assert.match(r.out, /不在合并路径上/)
    assert.match(r.out, /noRun=2/)
    assert.match(r.out, /最近 1 条 run/, '必须把扫描面留痕，否则"没跑"与"没扫到"无法区分：' + r.out)
  } finally { rm(dir) }
})

test('平台清单 403（令牌没 administration 档）⇒ rc=2 未证实 + 出声指路，绝不读成"平台没要求"', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const f = makeFetch({ runs: PUSH_RUNS, throwOn: { on: 'branches/main/protection', message: 'gh: Resource not accessible by integration (HTTP 403)' } })
    const adv = run(['--repo=o/r', '--report'], f, dir)
    assert.match(adv.out, /UNPROVEN 平台清单取不到/)
    assert.match(adv.out, /UNPROVEN-HINT/)
    assert.match(adv.out, /verdict=UNPROVEN rc=2/)
    assert.equal(adv.rc, 0, 'advisory 恒 0，但上面三行必须已经把未证实说清楚')
    assert.equal(run(['--repo=o/r', '--mode=enforce'], f, dir).rc, 2)
  } finally { rm(dir) }
})

test('登记面缺席 ⇒ rc=2 SELF-FAULT，绝不读成"零漂移"（缺席与"没有漂移"必须可区分）', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, null)
  try {
    const f = makeFetch({ runs: PUSH_RUNS })
    const r = run(['--repo=o/r', '--mode=enforce', '--report'], f, dir)
    assert.equal(r.rc, 2, r.out)
    assert.match(r.out, /SELF-FAULT/)
    assert.match(r.out, /required-checks\.json/, '必须点名缺的是哪个登记面文件：' + r.out)
    assert.ok(!/verdict=PASS/.test(r.out), '登记面缺席不得被念成合规：' + r.out)
    assert.equal(f.calls.length, 0, '登记面缺席应在取平台数据之前就停：一个字都没取才对：' + JSON.stringify(f.calls))
  } finally { rm(dir) }
})

test('探测域含 pull_request：只在 PR 上跑的 workflow（本仓 doc-gate.yml 正是这样）必须算 produced', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const f = makeFetch({ runs: [
      { id: 201, event: 'pull_request', created_at: '2026-10-27T00:00:00Z' },
      { id: 202, event: 'pull_request', created_at: '2026-10-26T00:00:00Z' },
    ] })
    const r = run(['--repo=o/r', '--mode=enforce', '--report'], f, dir)
    assert.equal(r.rc, 0, '把域缩回"只看 push"就会给这种 workflow 造两条假违规：' + r.out)
    assert.match(r.out, /A form=produced runs=2/)
  } finally { rm(dir) }
})

test('取数失败不得被兜成"一条 run 都没扫到"：窗口失明走 UNPROVEN，no-run 只在证明取到数之后才允许出现', () => {
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const f = makeFetch({ runs: PUSH_RUNS, throwOn: { on: '/jobs', message: 'gh: bad gateway (HTTP 502)' } })
    const r = run(['--repo=o/r', '--mode=enforce', '--report'], f, dir)
    assert.equal(r.rc, 2, r.out)
    assert.match(r.out, /没取到/)
    assert.ok(!/不在合并路径上/.test(r.out), '把工具失明念成"这个作业不跑"就是把红改成假结论：' + r.out)
  } finally { rm(dir) }
})

test('窗口按 workflow 缓存：同名多产出者各取一次，绝不按 check 名重复取数（成本必须能被复算）', () => {
  const dir = mkFixtureRepo({
    'q.yml': ['on:', '  pull_request:', 'jobs:', '  a:', '    name: A', '  b:', '    name: B', ''].join('\n'),
  }, REG2)
  try {
    const f = makeFetch({ runs: PUSH_RUNS })
    const r = run(['--repo=o/r', '--report'], f, dir)
    assert.equal(r.rc, 0, r.out)
    const runListCalls = f.calls.filter((a) => /actions\/workflows\//.test(a[0]))
    assert.equal(runListCalls.length, 1, '两个 check 名共用一个 workflow ⇒ 列表只该取一次：' + JSON.stringify(runListCalls))
    const jobCalls = f.calls.filter((a) => /\/jobs$/.test(a[0]))
    assert.equal(jobCalls.length, PUSH_RUNS.length, '每条 run 取一次 jobs：' + jobCalls.length)
  } finally { rm(dir) }
})

/** 让某个 job 在整个窗口里恒取同一结论（其它 job 一律 success）。 */
function makeFetchWithConclusions (_dir, concl) {
  return makeFetch({ runs: PUSH_RUNS, jobOf: () => ({ ...concl }) })
}

test('接线锁：Gate 2b17 必须在 changes 作业的**可执行正文**里点名判据与两把回归锁', () => {
  const root = path.join(__dirname, '..')
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  const start = wf.indexOf('\n  changes:')
  const end = wf.indexOf('\n  static-gates:')
  assert.ok(start > -1 && end > start, '找不到 changes 作业区间（workflow 结构变了要同步这条）')
  const body = wf.slice(start, end).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  for (const cmd of [
    'node scripts/check-required-checks.js',
    'node --test scripts/lib/required-checks.test.js',
    'node --test scripts/check-required-checks.test.js',
  ]) assert.ok(body.includes(cmd), '未接线（注释里提一句不算）：' + cmd)
  assert.match(body, /- name: "Gate 2b17[\s\S]{0,200}?shell: bash/, 'Gate 2b17 必须 shell: bash —— 一个 run 块里多条命令，pwsh 不会在中间失败时中止')
  assert.match(body, /--mode=advisory/, '首档必须 advisory：本判据读平台状态，令牌 scope/瞬断不得变成 required 红')
})

test('形态白名单还须挡住「点段」：`..` 逐字符都在字符类里，却能改指另一个 API 段', () => {
  // 实测：旧写法 /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/ 对 'a/..' 与 '../x' 都返回 true，
  // 而拼出来的 endpoint 是 repos/a/.. —— 值虽然仍只占一个 argv 元素（注入面已被 shell:false 挡住），
  // 但"取的是哪个端点"被输入改写了，与本锁"清单对账面"的身份不相容。
  assert.ok(!CLI.REPO_SHAPE.test('a/..'), '点段必须整串拒绝')
  assert.ok(!CLI.REPO_SHAPE.test('..'), '连一段都不给')
  assert.ok(!CLI.REPO_SHAPE.test('a/../b'), '中间段也不能是点')
  assert.ok(CLI.REPO_SHAPE.test('my.repo/my-name'), '段内的点与连字符是合法仓库名，不得一起杀掉')
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const r = run(['--repo=a/..', '--report'], makeFetch({ runs: PUSH_RUNS }), dir)
    assert.match(r.out, /SELF-FAULT/, '文案要指回仓库标识：' + r.out)
    assert.equal(r.rc, 0, 'advisory 档不得因"判据自身拒了脏值"而阻断（首档 CI 实测过的正是这一格）：' + r.out)
    assert.equal(run(['--repo=a/..', '--mode=enforce', '--report'], makeFetch({ runs: PUSH_RUNS }), dir).rc, 2,
      '脏值在 enforce 档必须走未证实档，不得静默按默认档跑')
  } finally { rm(dir) }
})

test('gh 取数必须有硬超时，且「超时」与「gh 没装」不得共用一句文案', () => {
  // 形状取自本机实测（Node v22.23.1、shell:false）：
  //   超时 ⇒ status=null、signal='SIGTERM'、error.code='ETIMEDOUT'、stderr 为空
  //   没装 ⇒ status=null、signal=null、error.code='ENOENT'、stderr 为空
  // 两支的 status 都是 null、stderr 都是空，**唯一可分辨的就是 error.code**；
  // 合成一句"gh 不可用"会把"网络/取数挂了"指使人去重装 gh。
  const seen = []
  const ok = (cmd, args, opts) => { seen.push(opts); return { status: 0, stdout: '{}', stderr: '' } }
  CLI.ghJson(['repos/o/r'], ok)
  assert.equal(typeof seen[0].timeout, 'number', '不传 timeout 就没有任何硬超时，挂死的 gh 会吃掉整个作业预算')
  assert.ok(seen[0].timeout >= 1000, '超时预算必须是个有意义的毫秒数：' + seen[0].timeout)

  const timedOut = () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' }) })
  assert.throws(() => CLI.ghJson(['repos/o/r'], timedOut), /超时/)
  assert.throws(() => CLI.ghJson(['repos/o/r'], timedOut), (e) => !/不可用|没装/.test(e.message), '超时不得读成 gh 没装')

  const notInstalled = () => ({ status: null, signal: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' }) })
  assert.throws(() => CLI.ghJson(['repos/o/r'], notInstalled), /没装|不可用/)
  assert.throws(() => CLI.ghJson(['repos/o/r'], notInstalled), (e) => !/超时/.test(e.message), '没装不得读成超时')

  // 覆盖变量的三档：合法生效、非法回落、没设按默认（静默回落等于让"我明明设了"永远查不出来）。
  assert.equal(CLI.ghTimeoutMs({ [CLI.GH_TIMEOUT_ENV]: '5000' }), 5000, '合法覆盖必须生效，否则排障时改不动预算')
  assert.equal(CLI.ghTimeoutMs({ [CLI.GH_TIMEOUT_ENV]: 'abc' }), CLI.GH_TIMEOUT_MS, '非法值回落默认')
  assert.equal(CLI.ghTimeoutMs({ [CLI.GH_TIMEOUT_ENV]: '1' }), CLI.GH_TIMEOUT_MS, '小于 1s 的预算只会把每次取数都变成超时')
  assert.equal(CLI.ghTimeoutMs({}), CLI.GH_TIMEOUT_MS, '没设变量时按默认')

  // 超时最终必须落在"未证实"档：窗口取不到 ⇒ fetched=false ⇒ UNPROVEN，不得兜成 no-run。
  // 两档都要测：advisory 恒 rc=0 但必须把 verdict=UNPROVEN rc=2 念出来；enforce 才把 2 交回退出码。
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const adv = run(['--mode=advisory', '--report'], makeFetch({ throwOn: { on: 'runs', message: 'spawnSync gh ETIMEDOUT' } }), dir)
    assert.equal(adv.rc, 0, adv.out)
    assert.match(adv.out, /MODE=advisory verdict=UNPROVEN rc=2/, '超时档必须被念出来：' + adv.out)
    assert.match(adv.out, /UNPROVEN/, '超时必须是未证实档：' + adv.out)
    assert.doesNotMatch(adv.out, /no-run/, '失明不得被兜成"该 workflow 没跑"')
    const enf = run(['--mode=enforce', '--report'], makeFetch({ throwOn: { on: 'runs', message: 'spawnSync gh ETIMEDOUT' } }), dir)
    assert.equal(enf.rc, 2, '取数超时在 enforce 档必须是"未证实"，不得与"发现违规"同档：' + enf.out)
  } finally { rm(dir) }
})

test('advisory 档的 SELF-FAULT 也必须退出 0（首档 CI 实测：rc=2 把自己接线的作业掐红，并连带 skipped 掉之后全部 gate）', () => {
  // 现场 run 40621967491 / job 122597885269 的 Gate 2b17 那一步，日志原文：
  //   REQUIRED-CHECKS SELF-FAULT: gh: To use GitHub CLI in a GitHub Actions workflow, set the
  //   GH_TOKEN environment variable. …… (gh rc=4) → ##[error]Process completed with exit code 2.
  // advisory 的语义就是"这一档不阻断任何 PR"；而 run 块是 bash -e -o pipefail，非 0 即中止 ——
  // 判据自身取不到数时它**阻断**了，还把后面的 gate 整批读成 skipped（包括"这条判据到底跑没跑"的唯一证据源）。
  // 修法只能是"照实出声 + 退出 0"，不得反过来把 advisory 那一格改成 2 迁就实现。
  const faultFetch = makeFetch({ runs: PUSH_RUNS })

  // 仓内侧（登记面缺席）与平台侧（resolveRepo 抛错）两条出口分别测：两档动作对象不同（修文件 vs 修接线）。
  const dirRepo = mkFixtureRepo({ 'q.yml': TWO_JOBS }, null)
  try {
    const adv = run(['--repo=o/r', '--mode=advisory', '--report'], faultFetch, dirRepo)
    assert.equal(adv.rc, 0, '登记面缺席在 advisory 档不得阻断：' + adv.out)
    assert.match(adv.out, /SELF-FAULT/, '不阻断绝不等于不出声：' + adv.out)
    assert.match(adv.out, /MODE=advisory verdict=SELF_FAULT rc=2/, '内部 rc 必须被念出来，否则"没阻断"读起来像"没问题"：' + adv.out)
    assert.doesNotMatch(adv.out, /verdict=PASS|全部合规/, 'SELF-FAULT 不得被念成合规：' + adv.out)
    assert.equal(run(['--repo=o/r', '--mode=enforce', '--report'], faultFetch, dirRepo).rc, 2,
      'enforce 档照旧交回 2 —— 三档退出码（0/1/2）不得混档')
  } finally { rm(dirRepo) }

  const dirOk = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const bad = run(['--repo=o/r/extra', '--mode=advisory'], faultFetch, dirOk)
    assert.equal(bad.rc, 0, '平台侧取不到数在 advisory 档不得阻断：' + bad.out)
    assert.match(bad.out, /SELF-FAULT/)
    assert.match(bad.out, /MODE=advisory verdict=SELF_FAULT rc=2/)
    assert.equal(run(['--repo=o/r/extra', '--mode=enforce'], faultFetch, dirOk).rc, 2)
  } finally { rm(dirOk) }

  // 刻意保留的那一格：命令行本身打错了（旗标不认识 / --mode= 非法）时 mode 无从得知，
  // 按默认档放行等于把"我明明传了 --mode=enforce"读成"没传"。这一档必须仍是 2。
  const dirThree = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    assert.equal(run(['--repo=o/r', '--mode=advisory', '--nope'], faultFetch, dirThree).rc, 2,
      '未知旗标即使在 advisory 档也必须 rc=2 —— 它不是"取不到数"，是调用方写错了')
    assert.equal(run(['--mode=enforc'], faultFetch, dirThree).rc, 2)
  } finally { rm(dirThree) }
})

test('接线锁的行为补半：Gate 2b17 那一步必须自带 GH_TOKEN，否则 CI 里 gh 一个字都取不到', () => {
  // 上一条测的是"取不到数不要阻断"，这条测"根本不该取不到数"。
  // 判据只在那一步的正文里找，不看整份文件——别的步骤早就有 GH_TOKEN，全文件匹配会恒真。
  const root = path.join(__dirname, '..')
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  const start = wf.indexOf('- name: "Gate 2b17')
  assert.ok(start > 0, '找不到 Gate 2b17 那一步（步骤名变了要同步这条锁）')
  const rest = wf.slice(start)
  const next = rest.indexOf('\n      - name: ', 4)
  assert.ok(next > 0, 'Gate 2b17 之后还有别的步骤 —— 区间取不到说明 workflow 结构变了')
  const step = rest.slice(0, next).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.match(step, /env:\s*\r?\n\s*GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/,
    '那一步没有 GH_TOKEN 时 gh 在 CI 里 rc=4（实测），判据永远只能打印 SELF-FAULT')
  assert.doesNotMatch(step, /secrets\.GITHUB_TOKEN/,
    '写 secrets.GITHUB_TOKEN 是另一个形状（本仓两种都有人写）；统一到 github.token 一处，避免两份口径漂移')
})

test('窗口必须把每条 run 的 status 一起带回来 —— lib 侧"缺席只能由已完成的 run 给出"这条判据全靠它喂', () => {
  // 少传一个字段就没人红：这类"接缝上的字段"是本仓"接线锁"最常漏的一格（判据在 lib 里对，
  // 采集层没把 status 送进来 ⇒ 真实路径上永远走未定论档，而单元层因为自造夹具看不见这件事）。
  const dir = mkFixtureRepo({ 'q.yml': TWO_JOBS }, REG2)
  try {
    const w = CLI.windowFor('o/r', 'q.yml', new Map(), makeFetch({ runs: PUSH_RUNS }))
    assert.equal(w.fetched, true, JSON.stringify(w))
    // 只断"每一条都带 status"，不断窗口条数：条数属于**探测域**那一格（M-D 管的），
    // 把两个维度捆在同一行断言里，会让两条互不相干的红名集互相吞并（本仓按红集分档）。
    assert.ok(w.runs.length >= 1, '窗口是空的，这条锁等于没测：' + JSON.stringify(w))
    assert.equal(w.runs[0].status, 'completed', '窗口里必须带 status：' + JSON.stringify(w.runs[0]))
    assert.ok(w.runs.every((r) => typeof r.status === 'string' && r.status), '每一条 run 都要带 status')
  } finally { rm(dir) }
})
