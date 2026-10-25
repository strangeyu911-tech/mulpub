'use strict'
/* check-schedule-heartbeat.js 的行为锁（node --test，只用内置模块，零真实出站、零网络）
 *
 * 这把锁防的是"心跳判据自己变成装饰"，所以每一档都必须**可达**且**互不合并**：
 *   OK / LATE / NEVER_RAN / SCANNER_FAULT —— 四个出口各有一条用例，两个退出码（1 与 2）各有一条用例。
 * 合规形态必须绿（H1）：只测"能红"的锁会把自己的修复路径也焊死（本仓反复踩过的同一条）。
 * 采集一律注入：本仓 network-egress-guard 会拦真实出站，任何"在测试里打 GitHub"的写法当场变红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const HB = require('./check-schedule-heartbeat.js')
const { loadWorkflows } = require('./check-schedule-failure-watch.js')

const REPO = process.env.HB_REPO || path.resolve(__dirname, '..')
const NOW = Date.parse('2026-10-23T12:00:00Z')
const HOUR = 3600 * 1000

const NOOP = () => {}
const y = (lines) => lines.join('\n') + '\n'
const wf = (file, crons) => ({ file, name: file, scheduled: true, crons })
/** 相对 NOW 往回推 h 小时的一次「已完成的定时 run」。 */
const beat = (h) => ({ created_at: new Date(NOW - h * HOUR).toISOString(), status: 'completed', event: 'schedule', conclusion: 'success' })
const runsOf = (runs) => () => ({ ok: true, runs })
const judge = (opts) => HB.judge({ now: NOW, env: {}, warn: NOOP, ...opts })
const runMain = (opts) => {
  const lines = []
  const warns = []
  const rc = HB.main({ argv: [], now: NOW, env: {}, log: (s) => lines.push(s), warn: (s) => warns.push(s), ...opts })
  return { rc, lines, warns }
}

function fixture (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbfix-'))
  const wd = path.join(dir, '.github', 'workflows')
  fs.mkdirSync(wd, { recursive: true })
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(wd, name), body, 'utf8')
  return dir
}
const SCHED_DAILY = (title) => y(['name: ' + title, 'on:', '  schedule:', "    - cron: '23 3 * * *'", 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps: []'])

/* ===== 两趟取证的夹具（2026-10-25 现场逼出，H6/H17-H23 共用） =====
 * 动因（三份真实读数，全部当场重取）：`dep-audit.yml` 的最近 100 条窗口只覆盖 **14.4 小时**
 * （`pull_request=100`），而 `--event=schedule` 查得到 **4 条 completed schedule run**（最近
 * 2026-10-19，weekly，age 6.0 天 < 阈值 176h）—— 判据把"我的窗口里没看见"读成了"它从来没跑过"，
 * 于是每天报一次假 NEVER_RAN。这是本仓「截断的输出不构成证据」「零命中先证明坐标是旧的」的同型。
 * 第二份现场是巡检作业自己：唯一一条 schedule run 就是此刻这条（扫描时 status=in_progress），
 * 旧判据一律 NEVER_RAN ⇒ 首跑必假红一次；而"长期排队永不 completed"是它**刻意要抓**的成因
 * （文件头第 4 条）⇒ 不能一律放行，必须用**同一把周期时钟**把两种情况分开。
 */

/** 同时扮演主查询与 witness 查询的假采集器：只有带 `event` 的那一趟走 witness 数据。 */
const twoTier = (primary, witness) => (file, opts) => {
  if (opts && opts.event === 'schedule') return { ok: true, runs: witness, truncated: witness.length >= 100 }
  return { ok: true, runs: primary, truncated: primary.length >= 100 }
}
/** 造 n 条与心跳无关的 run（模拟繁忙作业把窗口填满）。 */
const filler = (n, event) => Array.from({ length: n }, (_, i) => ({
  created_at: new Date(NOW - (i + 1) * 60000).toISOString(), status: 'completed', event, conclusion: 'success',
}))
const pendingBeat = (h) => ({ created_at: new Date(NOW - h * HOUR).toISOString(), status: 'in_progress', event: 'schedule', conclusion: null })
const WEEKLY = '0 6 * * 1'

test('H1 新鲜绿控：daily 作业 3 小时前跑过 ⇒ OK 且退出码 0（合规形态不得红）', () => {
  const workflows = [wf('cleanup-artifacts.yml', ['23 3 * * *'])]
  const r = judge({ workflows, runsOf: runsOf([beat(3)]) })
  assert.equal(r.verdict, 'OK')
  assert.deepEqual(r.faults, [])
  const { rc, lines } = runMain({ workflows, runsOf: runsOf([beat(3)]) })
  assert.equal(rc, 0, '合规形态必须 0，否则每天都是自己咬自己的假红')
  assert.match(lines[0], /判定=OK/)
  assert.match(lines[0], /workflows=1 late=0 never=0 faults=0/)
  assert.match(lines[0], /slack_hours=8\(default\)/)
})

test('H2 LATE：daily 作业 40 小时前跑过 ⇒ 红并点名文件 + age_hours + 阈值', () => {
  const workflows = [wf('cleanup-artifacts.yml', ['23 3 * * *'])]
  const { rc, lines } = runMain({ workflows, runsOf: runsOf([beat(40)]) })
  assert.equal(rc, 1)
  const late = lines.find((l) => l.startsWith('  LATE'))
  assert.ok(late, '必须有一行 LATE 明细：' + lines.join(' / '))
  assert.match(late, /LATE cleanup-artifacts\.yml/)
  assert.match(late, /period=daily/)
  assert.match(late, /age_hours=40\.0/)
  assert.match(late, /阈值_hours=32\.0/)
})

test('H3 边界：阈值取「严格大于」——正好 32h 绿、多 1 秒红（差 1 秒即翻转）', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const exact = judge({ workflows, runsOf: runsOf([{ created_at: new Date(NOW - (24 * HOUR + 8 * HOUR)).toISOString(), status: 'completed', event: 'schedule' }]) })
  assert.equal(exact.rows[0].verdict, 'OK', '正好等于阈值不得算迟到（>=/> 取向必须由用例钉住）')
  const over = judge({ workflows, runsOf: runsOf([{ created_at: new Date(NOW - (24 * HOUR + 8 * HOUR + 1000)).toISOString(), status: 'completed', event: 'schedule' }]) })
  assert.equal(over.rows[0].verdict, 'LATE')
})

test('H4 NEVER_RAN 与 SCANNER_FAULT 是两个档、两个退出码（不得合并）', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const never = runMain({ workflows, runsOf: runsOf([]) })
  assert.equal(never.rc, 1)
  assert.match(never.lines[0], /判定=FAIL/)
  assert.match(never.lines.find((l) => l.startsWith('  NEVER_RAN')), /completed_schedule_run=0/)
  const blind = runMain({ workflows, runsOf: () => ({ ok: false, error: 'gh api 失败：HTTP 404' }) })
  assert.equal(blind.rc, 2, '工具失明必须走 2；并进 1 会让下一个人以为"那天真的没跑"')
  assert.match(blind.lines[0], /判定=SCANNER_FAULT/)
  assert.match(blind.lines.find((l) => l.startsWith('  SCANNER_FAULT')), /HTTP 404/)
})

test('H5 别的 event 不算心跳：只有 push run 的作业必须判 NEVER_RAN（形状判据的反例夹具）', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const runs = [
    { created_at: new Date(NOW - 1 * HOUR).toISOString(), status: 'completed', event: 'push', conclusion: 'success' },
    { created_at: new Date(NOW - 2 * HOUR).toISOString(), status: 'completed', event: 'workflow_dispatch', conclusion: 'success' },
    { created_at: new Date(NOW - 3 * HOUR).toISOString(), status: 'completed', event: 'pull_request', conclusion: 'failure' },
  ]
  const r = judge({ workflows, runsOf: runsOf(runs) })
  assert.equal(r.rows[0].verdict, 'NEVER_RAN')
  assert.equal(r.rows[0].last, null, 'last 不得被 push run 的时间顶替（顶替了就等于把"没兑现"读成"很新鲜"）')
  assert.equal(r.rows[0].collected, 3)
})

test('H6 心跳的资格：completed 才算兑现（conclusion=failure 也算），排队在途另成两档', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  // conclusion=failure **算**一次心跳：本判据问"跑没跑"，"跑失败"归报警那一刀管
  const failed = [{ created_at: new Date(NOW - 3 * HOUR).toISOString(), status: 'completed', event: 'schedule', conclusion: 'failure' }]
  assert.equal(judge({ workflows, runsOf: runsOf(failed) }).rows[0].verdict, 'OK')
  // 2026-10-25 改写：原来这里断言"queued/in_progress ⇒ NEVER_RAN"，与文件头第 4 条成因
  // （"runner 长期排队永不 completed"要被抓）**只在一种情况下**一致：卡了多久没查。
  // 一律 NEVER_RAN 会把"巡检作业第一天看见自己这条在途 run"判成假红，
  // 一律放行又会把真卡死放走 ⇒ 拆成两档，由 H18（预算内 PENDING_FIRST）与 H19（超预算 NEVER_COMPLETED）分别钉。
  assert.equal(judge({ workflows, runsOf: twoTier(filler(3, 'push'), [pendingBeat(1)]) }).rows[0].verdict, 'PENDING_FIRST')
  assert.equal(judge({ workflows, runsOf: twoTier(filler(3, 'push'), [pendingBeat(40)]) }).rows[0].verdict, 'NEVER_COMPLETED')
})

test('H7 多行 cron 取最短周期：daily+weekly 同作业按 daily 判迟到（与声明顺序无关）', () => {
  const both = (crons) => [wf('a.yml', crons)]
  for (const crons of [['0 18 * * 3', '23 3 * * *'], ['23 3 * * *', '0 18 * * 3']]) {
    const r = judge({ workflows: both(crons), runsOf: runsOf([beat(33)]) })
    assert.equal(r.rows[0].period, 'daily', JSON.stringify(crons) + ' 应按最短周期判')
    assert.equal(r.rows[0].verdict, 'LATE')
    assert.equal(judge({ workflows: both(crons), runsOf: runsOf([beat(30)]) }).rows[0].verdict, 'OK')
  }
})

test('H8 cron 推不出周期 ⇒ SCANNER_FAULT 且退出码 2（禁止"未知就当 daily"）', () => {
  const cases = [
    ['0 3 * 1 1', 'mon 非星号'],
    ['30 6 * *', '只有 4 段'],
    ['0 3 1,15 * *', 'dom 是逗号列表'],
    ['*/15 * * * *', '分钟是步进'],
  ]
  for (const [cron, why] of cases) {
    const { rc, lines } = runMain({ workflows: [wf('a.yml', [cron])], runsOf: runsOf([beat(1)]) })
    assert.equal(rc, 2, why + ' 必须走"我不知道"档，拿到 ' + lines[0])
    assert.ok(lines.some((l) => l.startsWith('  SCANNER_FAULT') && l.includes(JSON.stringify(cron))), why + ' 必须点名原串：' + lines.join(' / '))
  }
})

test('H9 env 纪律：abc / 0 / -5 各回落 8 并打印 warn；24 生效并被首行读到', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  for (const bad of ['abc', '0', '-5', 'NaN']) {
    const { rc, lines, warns } = runMain({ workflows, runsOf: runsOf([beat(3)]), env: { MP_SCHEDULE_HEARTBEAT_SLACK_HOURS: bad } })
    assert.equal(rc, 0, bad + ' 应回落默认 8（33h 迟到才该红，这里 3h 是绿的）')
    assert.match(lines[0], /slack_hours=8\(invalid-fallback\)/, bad + ' 的回落必须被标出来')
    assert.equal(warns.filter((l) => /MP_SCHEDULE_HEARTBEAT_SLACK_HOURS/.test(l)).length, 1, bad + '：静默回落＝配置错误永远不被知道')
  }
  const wide = runMain({ workflows, runsOf: runsOf([beat(40)]), env: { MP_SCHEDULE_HEARTBEAT_SLACK_HOURS: '24' } })
  assert.equal(wide.rc, 0, 'slack=24 时 40h 仍在 48h 阈值内')
  assert.match(wide.lines[0], /slack_hours=24\(env\)/)
  assert.match(wide.lines.find((l) => l.startsWith('  OK')), /阈值_hours=48\.0/)
})

test('H10 provenance：预算必须 ≥ 实测最大间隔，样本量与重测命令都要在册', () => {
  const P = HB.HEARTBEAT_PROVENANCE
  assert.ok(typeof P.remeasure === 'string' && P.remeasure.includes('gh api'), '出处必须是一条能原样重跑的取数命令，不是死数')
  assert.ok(Number.isInteger(P.minSamples) && P.minSamples >= 3, '样本量下界必须写出来')
  for (const kind of ['daily', 'weekly']) {
    const budget = HB.PERIODS[kind] + P.slackHours * HOUR
    assert.ok(budget >= P.maxIntervalRatio * HB.PERIODS[kind], `${kind} 阈值 ${budget / HOUR}h 低于实测 ×${P.maxIntervalRatio}`)
  }
  for (const [file, n] of Object.entries(P.samplesPerWorkflow)) {
    assert.ok(Number.isInteger(n) && n > 0, `${file} 的样本数必须是正整数（低于下界也要写数量）`)
  }
  assert.ok(P.unmeasuredKinds.includes('monthly'), 'monthly 是 31 天的保守上界、没有实测样本，必须逐字承认')
})

test('H11 真仓规模下界：带 schedule 的作业 ≥ 4 且每条都推得出周期（推不出即红，不许"未知就跳过"）', () => {
  const scheduled = loadWorkflows(REPO).filter((w) => w.scheduled)
  assert.ok(scheduled.length >= 4, `真仓只扫到 ${scheduled.length} 条带 schedule 的作业 ⇒ 判据域退化`)
  const r = judge({ workflows: scheduled, runsOf: runsOf([beat(1)]) })
  assert.deepEqual(r.faults.map((f) => `${f.file}: ${f.reason}`), [], '真仓里每条作业的 cron 都必须推得出周期')
  assert.equal(r.rows.length, scheduled.length)
  assert.ok(r.rows.every((row) => ['daily', 'weekly', 'monthly'].includes(row.period)), JSON.stringify(r.rows.map((x) => [x.file, x.period])))
})

test('H12 接线锁：心跳作业自带 schedule、点名跑判据与行为锁，且被报警名单收走（两把锁互咬）', () => {
  const rows = loadWorkflows(REPO)
  const hb = rows.find((r) => r.file === 'schedule-heartbeat.yml')
  assert.ok(hb, 'schedule-heartbeat.yml 必须存在')
  assert.equal(hb.scheduled, true, '心跳作业自己必须带 on.schedule —— 它正是被本判据守的那类作业')
  assert.ok(HB.periodFromCron(hb.crons[0]), `心跳作业的 cron 必须推得出周期，拿到 ${JSON.stringify(hb.crons)}`)
  // 行尾先归一再匹配：这些 workflow 在工作副本里是 CRLF（i/lf w/crlf），而 `/bash$/m` 里的 `$`
  // 不会跨过 \r —— 不归一的话同一份文件在"检出成 CRLF 的机器"上是假红、在"直接写 LF 的机器"上是绿。
  const txt = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'schedule-heartbeat.yml'), 'utf8').replace(/\r\n/g, '\n')
  // 接线判据必须**剥掉注释行**再匹配执行体：本文件第 38 行的说明文字里原样出现了脚本名，
  // 按"文件里有没有这个串"判，摘掉真正的 run 那一行照样绿（AGENTS 点名的"注释对门禁算正文"同型，
  // 本刀由变异 m12 实测打红过第一次）。
  const code = txt.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.ok(code.includes('node scripts/check-schedule-heartbeat.js'), '判据本体必须在这个作业里被点名执行（否则锁存在但没有执行体）')
  assert.ok(code.includes('node --test scripts/check-schedule-heartbeat.test.js'), '行为锁也要在同一作业里跑一遍（防"只有 PR 侧跑"）')
  assert.match(txt, /^[ \t]*shell:[ \t]*bash[ \t]*$/m, '多条测试命令的 run 块必须 fail-fast（bash -e -o pipefail）')
  assert.match(txt, /^[ \t]*timeout-minutes:[ \t]*\d+/m)
  assert.match(txt, /actions:[ \t]*read/)
  const handler = rows.find((r) => r.file === 'ci-failure-handler.yml')
  assert.ok(handler && handler.runList, '读不到 handler 名单 ⇒ 这条接线锁无从判定')
  assert.ok(handler.runList.includes(hb.name), `心跳作业没进报警名单 ⇒ Gate 2b13 会红；名单="${handler.runList.join(',')}"`)
  // 预算格：登记必须在册，且**登记数 == 声明数**。为什么要这一格（m17/m18/m19 三条变异各测一半）：
  // Gate 2b7 能抓"登记数与声明数分叉"（m18 实测两边都红），也能抓"登记了但 jobId 写错"（m17 同上）；
  // 但它的**枚举域取自注册表自己的 workflow 列表**（check-coverage-budget.js:239），
  // 所以"新增一整个 workflow 文件而压根没登记"对它不可见 —— m19 实测：删掉整格后 Gate 2b7 照绿，只有这条红。
  const reg = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'gate-timeout-registry.json'), 'utf8'))
  const cell = reg.jobs.find((x) => x.workflow === '.github/workflows/schedule-heartbeat.yml' && x.jobId === 'schedule-heartbeat')
  assert.ok(cell, '新作业的 timeout-minutes 必须在注册表里有格；漏登记不会被 Gate 2b7 抓到（枚举域来自注册表自身），只能由这条补')
  assert.ok(['measured', 'seeded'].includes(cell.state), 'state 必须是闭集，实际 ' + cell.state)
  const declared = Number(txt.match(/^[ \t]*timeout-minutes:[ \t]*(\d+)/m)[1])
  assert.equal(cell.timeoutMinutes, declared, `登记数(${cell.timeoutMinutes}) 与 workflow 声明数(${declared}) 不一致 ⇒ 两处各说一套`)
})

test('H13 采集器：argv 带 --jq 与三个必需字段；gh 抛错/非数组/字段缺席一律"取不到数"', () => {
  const calls = []
  const exec = (cmd, args) => { calls.push({ cmd, args }); return JSON.stringify([beat(1)]) }
  const runsOf2 = HB.makeGhCollector({ repo: 'o/r', exec })
  const res = runsOf2('cleanup-artifacts.yml')
  assert.equal(res.ok, true)
  assert.deepEqual(calls.length, 1)
  assert.equal(calls[0].cmd, 'gh')
  assert.ok(calls[0].args.includes('--jq'), '必须让 gh 自己剥壳，判据侧只认扁平数组')
  const joined = calls[0].args.join(' ')
  for (const f of HB.REQUIRED_RUN_FIELDS) assert.ok(joined.includes(f), `jq 投影里少了 ${f} ⇒ 判据永远读不到它`)
  assert.ok(!calls[0].args[1].includes('event=schedule'), '查询里带 event=schedule 会让判据侧的 event 过滤变成死码，并丢掉"只有 push run"这一现场信息')

  const boom = HB.makeGhCollector({ repo: 'o/r', exec: () => { throw new Error('ETIMEDOUT') } })
  assert.equal(boom('a.yml').ok, false, '采集挂死必须是取不到数，不是静默跳过')

  assert.equal(HB.parseRunsJson('{"workflow_runs":[]}', 'a.yml').ok, false, '忘记 --jq 时 gh 返回的是信封对象 ⇒ 必须判失明而不是空列表')
  const wrongField = () => ({ ok: true, runs: [{ created_at: new Date(NOW - HOUR).toISOString(), state: 'completed', event: 'schedule' }] })
  const r = judge({ workflows: [wf('a.yml', ['23 3 * * *'])], runsOf: wrongField })
  assert.equal(r.verdict, 'SCANNER_FAULT')
  assert.match(r.faults[0].reason, /缺必需字段 status/, '字段名写错必须落"取不到数"，不得读成"没有 run"')

  const noCalls = []
  const guarded = HB.makeGhCollector({ repo: 'o/r', exec: (cmd, args) => { noCalls.push(args); return '[]' } })
  for (const bad of ['../evil.yml', 'a.sh', '']) assert.equal(guarded(bad).ok, false, `${bad} 不该被拼进 API 路径`)
  assert.deepEqual(noCalls, [], '文件名不合时必须 fail closed，一次调用都不发')
  assert.throws(() => HB.makeGhCollector({ repo: '' }), /GITHUB_REPOSITORY/)
})

test('H15 参数面：--limit N 与 --limit=N 两种写法都要生效，且判定只按被限定的那一组算', () => {
  // 第 3 条作业是迟到的：limit=2 时它不进判定域（smoke 档），不传 limit 时必须红。
  const workflows = [
    wf('a.yml', ['23 3 * * *']),
    wf('b.yml', ['23 3 * * *']),
    wf('c.yml', ['23 3 * * *']),
  ]
  const runsOf = (file) => ({ ok: true, runs: [file === 'c.yml' ? beat(100) : beat(2)] })
  for (const argv of [['--limit', '2'], ['--limit=2']]) {
    const { rc, lines } = runMain({ argv, workflows, runsOf })
    assert.equal(rc, 0, JSON.stringify(argv) + ' 未被生效解析时，c.yml 的迟到会把 smoke 档判成红：' + lines[0])
    assert.match(lines[0], /workflows=3 late=0 never=0 faults=0/)
    assert.equal(lines.filter((l) => /^  (OK|LATE|NEVER_RAN|SCANNER_FAULT) /.test(l)).length, 2, JSON.stringify(argv) + ' 的明细行数必须真的被限定')
  }
  const full = runMain({ argv: [], workflows, runsOf })
  assert.equal(full.rc, 1, '不带 limit 时同一条迟到作业必须红（否则上面的绿是探针失明）')
  for (const argv of [['--limit', '0'], ['--limit', 'x'], ['--limit'], ['--nope'], ['a.yml', 'b.yml']]) {
    const { rc, lines } = runMain({ argv, workflows, runsOf })
    assert.equal(rc, 2, JSON.stringify(argv) + ' 必须走自身故障档而不是被静默忽略：' + lines.join(' / '))
  }
})

test('H16 判据域为空 ⇒ SCANNER_FAULT（"没扫到作业"绝不等于"作业都按时跑了"）', () => {
  const workflows = [{ file: 'push-only.yml', name: 'push-only', scheduled: false, crons: [] }]
  const r = judge({ workflows, runsOf: runsOf([]) })
  assert.equal(r.verdict, 'SCANNER_FAULT')
  assert.equal(r.rows.length, 0)
  assert.match(r.faults[0].reason, /一条带 schedule 的作业都没扫到/)
  const { rc, lines } = runMain({ workflows, runsOf: runsOf([]) })
  assert.equal(rc, 2, '域级失明不在 rows 里，退出码必须另加回来')
  assert.match(lines[0], /判定=SCANNER_FAULT/)
  assert.ok(lines.some((l) => l.includes('一条带 schedule 的作业都没扫到')), lines.join(' / '))
})

test('H14 loader 的 crons：块内全收、块外一律不收、行尾注释剥掉（精确数组断言）', () => {
  const dir = fixture({
    'multi.yml': y(['name: Multi', 'on:', '  schedule:', "    - cron: '23 3 * * *'", "    - cron: '0 18 * * 3'", 'jobs:', '  a:', '    steps: []']),
    'outside.yml': y(['name: Outside', 'on:', '  schedule:', "    - cron: '23 3 * * *'", '  workflow_dispatch:', 'env:', '  CRON_TABLE: |', "    - cron: '0 0 1 1 *'", 'jobs:', '  a:', '    steps: []']),
    'comment.yml': y(['name: Comment', 'on:', '  schedule:', "    - cron: '10 22 * * *' # 每天 22:10 UTC", 'jobs:', '  a:', '    steps: []']),
    'plain.yml': SCHED_DAILY('Plain'),
  })
  try {
    const by = Object.fromEntries(loadWorkflows(dir).map((r) => [r.file, r]))
    assert.deepEqual(by['multi.yml'].crons, ['23 3 * * *', '0 18 * * 3'], '两行 cron 必须全收，否则周报被读成日报')
    assert.deepEqual(by['outside.yml'].crons, ['23 3 * * *'], 'schedule 块之外出现的 cron 字样不得被当成一次定时声明')
    assert.deepEqual(by['comment.yml'].crons, ['10 22 * * *'], '行尾注释必须剥掉，否则周期推导拿到的是带注释的串')
    assert.deepEqual(by['plain.yml'].crons, ['23 3 * * *'])
    assert.equal(by['plain.yml'].name, 'Plain')
    assert.deepEqual(by['plain.yml'].scheduled, true)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('H17 窗口截断不得读成 NEVER_RAN：主窗口被 PR run 填满、witness 查到心跳 ⇒ OK 且降级可见', () => {
  const workflows = [wf('dep-audit.yml', [WEEKLY])]
  const { rc, lines } = runMain({ workflows, runsOf: twoTier(filler(100, 'pull_request'), [beat(144)]) })
  assert.equal(rc, 0, '窗口满了不等于没跑过；把它判成 NEVER_RAN 就是每天一次的假红')
  assert.match(lines[0], /判定=OK/)
  assert.match(lines[0], /late=0 never=0 faults=0/)
  assert.match(lines[0], /witness=1/, '命令行面的降级读数：首行只说 OK 而计数留 0，等于把「换了坐标」这件事藏起来（本刀第一版就是这么坏的）')
  assert.equal(judge({ workflows, runsOf: twoTier(filler(100, 'pull_request'), [beat(144)]) }).counts.witness, 1,
    '判据面的同一格也必须等于 1：两个投影各有一条断言，坏掉任意一边都指名红（m30 打判据面、m31 打命令行面）')
  const ok = lines.find((l) => l.startsWith('  OK'))
  assert.ok(ok, '必须有一行 OK 明细：' + lines.join(' / '))
  assert.match(ok, /心跳来源=witness/, '换了取证来源必须说出来，否则读日志的人以为看的是同一份数据')
  assert.match(ok, /采集窗口=满/, '"窗口被填满"这个事实本身必须进读数')
  assert.match(ok, /age_hours=144\.0/)
})

test('H18 首跑在途 ⇒ PENDING_FIRST（出声但不阻断），不得塌回 NEVER_RAN', () => {
  const workflows = [wf('schedule-heartbeat.yml', ['17 2 * * *'])]
  const r = judge({ workflows, runsOf: twoTier(filler(3, 'push'), [pendingBeat(1)]) })
  assert.equal(r.rows[0].verdict, 'PENDING_FIRST', 'cron 已兑现、只是那一次还没跑完 ⇒ 与"从未跑过"是两件事')
  assert.equal(r.verdict, 'OK')
  const { rc, lines } = runMain({ workflows, runsOf: twoTier(filler(3, 'push'), [pendingBeat(1)]) })
  assert.equal(rc, 0, '首跑在途不得红——那会让巡检作业第一天自己咬自己')
  assert.match(lines.find((l) => /PENDING_FIRST/.test(l)), /cron 已兑现/, '文案要说出为什么不算欠账')
  assert.match(lines[0], /pending=1/)
  assert.match(lines.find((l) => l.startsWith('  PENDING_FIRST')), /状态=in_progress/,
    'queued（没抢到 runner）与 in_progress（跑起来没完）是两种成因，日志必须能分辨（QM-6 i4）')
  assert.match(lines.find((l) => l.startsWith('  PENDING_FIRST')), /证据来源=witness/,
    '这一行的结论完全来自第二趟取证（主窗口那时是零心跳），读数里必须说出来——QM-6 i3 采纳后的第二落点')
  assert.match(lines[0], /pending=1 never_completed=0 witness=1/,
    'witness= 必须把「靠第二趟定案」的行都算进来；在途档漏计就是首行说谎')
})

test('H19 排队超预算 ⇒ NEVER_COMPLETED 必须红（文件头第 4 条成因不得被 H18 放走）', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const { rc, lines } = runMain({ workflows, runsOf: twoTier(filler(2, 'push'), [pendingBeat(40)]) })
  assert.equal(rc, 1, 'daily 作业的一次 schedule run 卡了 40 小时还没完成 = 运维事实，不是"我不知道"')
  const row = lines.find((l) => /NEVER_COMPLETED/.test(l))
  assert.ok(row, '必须点名这一档：' + lines.join(' / '))
  assert.match(row, /阈值_hours=32\.0/)
  assert.match(row, /上次尝试=40\.0h/)
  assert.match(row, /状态=in_progress/, '红的那一条也要说清该查 runner 还是查作业自己')
  assert.match(row, /证据来源=witness/)
  assert.equal(judge({ workflows, runsOf: twoTier(filler(2, 'push'), [pendingBeat(30)]) }).rows[0].verdict, 'PENDING_FIRST',
    '同一把时钟：30h < 32h 仍算在途（阈值两侧的取向由本条与 H3 分别钉住）')
})

test('H20 witness 明确零条 schedule run ⇒ NEVER_RAN 成立（dep-audit-refresh 真形：有 push/dispatch、cron 从未兑现）', () => {
  const workflows = [wf('dep-audit-refresh.yml', ['17 3 * * *'])]
  const primary = [{ created_at: new Date(NOW - HOUR).toISOString(), status: 'completed', event: 'push', conclusion: 'success' }]
  const { rc, lines } = runMain({ workflows, runsOf: twoTier(primary, []) })
  assert.equal(rc, 1)
  assert.match(lines.find((l) => l.startsWith('  NEVER_RAN')), /completed_schedule_run=0/)
  assert.match(lines[0], /never=1/)
})

test('H21 witness 取不到数 ⇒ SCANNER_FAULT（rc=2），既不得塌回 NEVER_RAN 也不得放行成 OK', () => {
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const blind = (file, opts) => (opts && opts.event === 'schedule')
    ? { ok: false, error: 'gh api 失败：HTTP 502' }
    : { ok: true, runs: filler(100, 'pull_request'), truncated: true }
  const { rc, lines } = runMain({ workflows, runsOf: blind })
  assert.equal(rc, 2, '工具的失明必须是"我不知道"这一档，不是"它没跑"也不是"它跑了"')
  assert.match(lines.find((l) => /SCANNER_FAULT/.test(l)), /witness/, '要点名是 witness 那一趟失败，否则修的人去找主查询')
})

test('H22 witness 只在主窗口无心跳时发，且必须带 event=schedule（零多余出站 + 坐标不能是旧的）', () => {
  const calls = []
  const exec = (cmd, args) => { calls.push(args.join(' ')); return JSON.stringify([beat(2)]) }
  const runsOf2 = HB.makeGhCollector({ repo: 'o/r', exec })
  assert.equal(runsOf2('a.yml').ok, true)
  assert.deepEqual(calls.length, 1, '主窗口已经取到心跳 ⇒ 一次 witness 都不该发')
  assert.ok(!calls[0].includes('event=schedule'), '主查询刻意不带 event 过滤（它要能看见"有 push run 但 cron 没兑现"）')

  calls.length = 0
  const emptyExec = (cmd, args) => { calls.push(args.join(' ')); return JSON.stringify(args.join(' ').includes('event=schedule') ? [] : filler(100, 'pull_request')) }
  const emptyRuns = HB.makeGhCollector({ repo: 'o/r', exec: emptyExec })
  const j = judge({ workflows: [wf('a.yml', ['23 3 * * *'])], runsOf: emptyRuns })
  assert.equal(j.rows[0].verdict, 'NEVER_RAN', 'witness 也报零条 ⇒ 这一次 NEVER_RAN 是被证明的，不是被假设的')
  assert.equal(calls.length, 2, '应当正好一次主查询 + 一次 witness：' + JSON.stringify(calls))
  assert.match(calls[1], /event=schedule/, 'witness 不带 event 过滤就是拿同一个截断窗口自证，等于没查')
})

test('H23 窗口未满时不得打「采集窗口=满」（读数的两个方向都要真）', () => {
  const workflows = [wf('sidecar-parity.yml', ['30 1 * * *'])]
  const { lines } = runMain({ workflows, runsOf: twoTier([beat(5)], []) })
  assert.match(lines[0], /判定=OK/)
  assert.match(lines.find((l) => l.startsWith('  OK')), /采集窗口=否/)
})

test('H24 采集器的 truncated 读数：填满 per_page 报满、没填满报否（两个方向都要真，且绑 per_page 不绑死 100）', () => {
  // 这一格是本刀的**起因**：主窗口的"截断"读数一旦恒 false，下游就再也分不开"我没看见"与"确实没有"，
  // 而 witness 回退正是靠这个读数触发的。所以它必须先有一条自己的锁，而不是靠夹具里的 twoTier 顶罪。
  const mk = (n, perPage) => HB.makeGhCollector({
    repo: 'o/r',
    perPage,
    exec: () => JSON.stringify(Array.from({ length: n }, (_, i) => beat(i))),
  })
  assert.equal(mk(100)('a.yml').truncated, true, '恰好填满 100 条就是窗口截断的信号；恒 false 等于把假阳性重新造回来')
  assert.equal(mk(99)('a.yml').truncated, false, '差一条就不算满——判的是"取到的条数是否顶到上限"，不是"有没有取到东西"')
  assert.equal(mk(3)('a.yml').truncated, false)
  assert.equal(mk(2, 2)('a.yml').truncated, true, '读数必须跟着 per_page 走：写死 100 会让 --perPage 调小后的窗口截断看不见')
})

test('H25 witness 那一趟抛错 ⇒ SCANNER_FAULT（rc=2）并点名 witness 采集抛错，不得塌回 NEVER_RAN', () => {
  // 与 H21 分开：H21 测的是「witness 返回 not-ok」，这一条测的是「witness **抛错**」——
  // 两条各守 catch 与 !ok 两个分支，合并成一条就会留下一格没人守（本仓点名的"两个出口一条锁"）。
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const throwsOnWitness = (file, opts) => {
    if (opts && opts.event === 'schedule') throw new Error('gh api 挂了')
    return { ok: true, runs: filler(100, 'pull_request'), truncated: true }
  }
  const { rc, lines } = runMain({ workflows, runsOf: throwsOnWitness })
  assert.equal(rc, 2, '取证第二趟挂了就是"我不知道"，不是"它没跑"（rc=1）也不是"它跑了"（rc=0）')
  const fault = lines.find((l) => l.startsWith('  SCANNER_FAULT'))
  // 必须按明细行的两空格缩进取：首行结尾也写着 判定=SCANNER_FAULT，用裸正则 find 会先命中它，于是断言测的是汇总行。
  assert.ok(fault, '必须点名这一格：' + lines.join(' / '))
  assert.match(fault, /witness 采集抛错/)
  assert.match(lines[0], /faults=1/, '失明必须进 faults 桶，不得被读成 never 或 pending')
  assert.match(lines[0], /pending=0 never_completed=0 witness=0/, '这三格连续出现在首行：新档不得互相顶罪')
})

test('H26 witness 自己的窗口也必须报满/否——「第二趟取证」不等于「无限取证」', () => {
  // 采纳 QM-6 i3。档位结论**不受** witness 截断影响：GitHub 的 runs 列表按 created_at 降序返回，
  // 截断只砍得掉**更旧**的 run ⇒ 最新那条心跳（或 pending）一定在窗口里。
  // 但"witness 自己也顶到了上限"这个事实必须可见——否则下一个读者会把 witness 当成完整历史，
  // 而 13.4 小时那种现场正是在"看起来取全了"的读数上翻的车。
  const manyBeats = (n, back) => Array.from({ length: n }, (_, i) => ({
    created_at: new Date(NOW - (back + i) * HOUR).toISOString(), status: 'completed', event: 'schedule', conclusion: 'success',
  }))
  const { lines } = runMain({ workflows: [wf('busy.yml', [WEEKLY])], runsOf: twoTier(filler(100, 'pull_request'), manyBeats(120, 40)) })
  const ok = lines.find((l) => l.startsWith('  OK'))
  assert.ok(ok, 'witness 有心跳就必须是 OK：' + lines.join(' / '))
  assert.match(ok, /心跳来源=witness/)
  assert.match(ok, /witness采集窗口=满/)

  // 迟到 + 换坐标是两件同时成立的事：只在 OK 行出声，「迟到的那条其实是 witness 查到的」就会从日志里消失。
  const late = runMain({ workflows: [wf('late.yml', [WEEKLY])], runsOf: twoTier(filler(100, 'pull_request'), manyBeats(120, 200)) })
  const lateRow = late.lines.find((l) => l.startsWith('  LATE'))
  assert.ok(lateRow, '200h 前的 weekly 心跳必须落 LATE：' + late.lines.join(' / '))
  assert.match(lateRow, /心跳来源=witness/)
  assert.match(lateRow, /witness采集窗口=满/)

  const few = runMain({ workflows: [wf('quiet.yml', [WEEKLY])], runsOf: twoTier(filler(100, 'pull_request'), [beat(144)]) })
  assert.ok(!few.lines.some((l) => l.includes('witness采集窗口=满')), '未满时不得报满——读数的两个方向都要真（同 H23）')
})

test('H27 采集预算不得倒挂：声明的 timeout-minutes 必须容得下「每条作业最多两趟 × 单趟硬超时」', () => {
  // 采纳 QM-6 i4。witness 把最坏情况的出站量从"每条一次"抬成"每条两次"（H22 已锁住"有心跳时一次都不发"，
  // 所以常态不是翻倍，翻倍只发生在零心跳的那一组）。这一条不庆祝"今天够用"，它锁的是
  // **"够用"这件事会不会悄悄不成立**：作业数或单趟超时涨上去时先在这里红，
  // 而不是等 CI 被 600s 掐掉只剩一行 timeout 而看不出是谁的预算。
  const src = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'schedule-heartbeat.yml'), 'utf8').replace(/\r\n/g, '\n')
  const m = src.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m)
  assert.ok(m, '心跳作业必须声明 timeout-minutes，否则预算无从对账')
  const declaredSec = Number(m[1]) * 60
  const scheduled = loadWorkflows(REPO).filter((w) => w.scheduled)
  const worstSec = scheduled.length * 2 * HB.COLLECT_TIMEOUT_MS / 1000
  console.log(`[heartbeat-budget] 声明=${declaredSec}s 最坏=${worstSec}s（作业 ${scheduled.length} 条 × 2 趟 × 单趟 ${HB.COLLECT_TIMEOUT_MS / 1000}s）`)
  assert.ok(declaredSec >= worstSec,
    `预算倒挂：声明 ${declaredSec}s < 最坏 ${worstSec}s ⇒ 抬 timeout-minutes，或把"单页 100 + witness"换成翻页聚合并同步改这条判据`)
  assert.ok(scheduled.length >= 4, '判据域退化时这条也必须出声——0 条作业会让上面那个不等式恒成立（假绿）')
  // 同一个数还必须在**每天真跑的那一次**里出现：只在锁里算，现场对自己的成本永远是瞎的（QM-6 第四轮 i2）。
  const run = runMain({ workflows: scheduled, runsOf: () => ({ ok: true, runs: [], truncated: false }) })
  assert.match(run.lines[0], new RegExp('采集最坏秒数=' + (scheduled.length * 2 * HB.COLLECT_TIMEOUT_MS / 1000)),
    '首行的最坏采集成本必须由同一个公式现算——期望值不写死，作业数变了它跟着变')
})
test('H28 显式 event 空串必须被拒——它不等于「不传 event」（QM-6 i6 采纳）', () => {
  const calls = []
  const coll = HB.makeGhCollector({ repo: 'o/r', exec: (cmd, args) => { calls.push(args[1]); return '[]' } })
  const main = coll('a.yml')
  assert.equal(main.ok, true, '主查询用「不传 event」表达，那是合法哨兵')
  assert.ok(!calls[0].includes('event='), '主查询不得带 event 过滤（H5/H13/H22 的同一条口径）')
  const bad = coll('a.yml', { event: '' })
  assert.equal(bad.ok, false, '显式空串是调用方写坏了：它想指定某一趟坐标却没指定出来。静默退化成主查询，等于把 witness 偷偷换成主查询——正是本刀要消灭的那个形状')
  assert.match(bad.error, /event 给了空串/)
  assert.equal(calls.length, 1, '被拒时一次额外出站都不发')
  for (const wrong of ['Schedule', 'a b', 'pull_request!', 'a'.repeat(40)]) {
    assert.equal(coll('a.yml', { event: wrong }).ok, false, wrong + ' 不该被拼进查询串')
  }
  assert.equal(calls.length, 1, '四类坏值也一次都不发')
})

test('H29 perPage 不得超过 GitHub 单页上限——越界会让 truncated 这个读数说谎（QM-6 i6）', () => {
  // GitHub 对 per_page>100 是**静默截到 100**，不报错。于是 `取到的条数 >= perPage` 永远不成立，
  // "窗口被填满"这个本刀最要紧的读数会恒说"否"——那不是"未满"，是工具在谎报。
  assert.throws(() => HB.makeGhCollector({ repo: 'o/r', perPage: 500 }), /per_page 上限是 100/)
  const at100 = HB.makeGhCollector({
    repo: 'o/r',
    perPage: 100,
    exec: () => JSON.stringify(Array.from({ length: 100 }, (_, i) => beat(i))),
  })
  assert.equal(at100('a.yml').truncated, true, '恰好取满 100 仍要报满')
  const small = HB.makeGhCollector({ repo: 'o/r', perPage: 30, exec: () => '[]' })
  assert.equal(small('a.yml').ok, true, '小于上限是合法配置')
  assert.equal(small('a.yml').truncated, false)
})

test('H30 witness 里「未完成的 run」时间戳坏了 ⇒ SCANNER_FAULT（rc=2），不得抛出也不得塌回 NEVER_RAN', () => {
  // 采纳 QM-6 第四轮 i1（Critical，且是真的）：completed 档把这条 run **过滤掉**所以从不解析它的
  // created_at；在途档恰恰要解析它。两趟共用同一份校验，却只有第一趟被 try/catch 包住 ⇒
  // 第二趟的异常会一路抛出 judge()，用户看到的是崩，而不是"我不知道"这一档。
  const workflows = [wf('a.yml', ['23 3 * * *'])]
  const brokenPending = (file, opts) => (opts && opts.event === 'schedule')
    ? { ok: true, truncated: false, runs: [{ created_at: 'not-a-date', status: 'in_progress', event: 'schedule', conclusion: null }] }
    : { ok: true, truncated: true, runs: filler(100, 'pull_request') }
  const { rc, lines } = runMain({ workflows, runsOf: brokenPending })
  assert.equal(rc, 2, '坏形状的第二趟必须是"我不知道"，不是异常外抛')
  const fault = lines.find((l) => l.startsWith('  SCANNER_FAULT'))
  assert.ok(fault, '要点名这一格：' + lines.join(' / '))
  assert.match(fault, /witness 在途读数形状不合/)
  assert.match(lines[0], /faults=1 thin=0 pending=0 never_completed=0/, '四个桶各领各的：坏形状只进 faults')
})
