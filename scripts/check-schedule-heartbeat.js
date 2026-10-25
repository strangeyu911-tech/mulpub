'use strict'
/* 判据本体：定时作业的「心跳」——专抓上一刀明确记为遗留的那一类：**根本没有 run**。
 *
 * `workflow_run`（`check-schedule-failure-watch.js` 走的报警通道）只在**有 run 完成时**才触发。
 * 于是四种成因全都表现为"Actions 页面一片空白而没有任何东西出声"：
 * cron 写错（GitHub 根本不排）、作业被删/禁用而定义还在、runner 长期排队永不 completed、仓库迁移后错位。
 * 所以本判据量的不是"有没有报错"，而是"**上一次真的跑过没有**"，并把
 *   没跑过（NEVER_RAN）/ 跑迟了（LATE）/ 我不知道（SCANNER_FAULT）
 * 三档分开——把 2 并进 1 会让下一个修判据的人以为"那天真的没跑"，那是把工具的失明读成结论。
 *
 * 三条硬约束（每条在行为锁里各有一条用例钉着）：
 *  1. 周期由 cron 自己推（复用 loadWorkflows 的 `crons`，**不写第二份手抄清单**——那正是上一刀要消灭的形状）；
 *     推不出来一律 SCANNER_FAULT，禁止"未知就当 daily"。
 *  2. 阈值 = 周期 + 宽限（默认 8h），**不是周期 ×2**：实测最大相邻间隔只有周期 ×1.04，
 *     而 run 起跑时刻相对 cron 可漂 5.68h（GitHub 排队是常态不是抖动）；×2 等于把"漏一天"的发现推到第三天。
 *  3. 采集由调用方注入（`runsOf`），判据本体零出站；真采集器另有一条"字段名写错必须判为取不到数"的行为锁
 *     （本仓踩过把 `status` 猜成 `state`、把 `.id` 猜成 `.databaseId` 那一族）。
 */
const { execFileSync } = require('node:child_process')
const { loadWorkflows } = require('./check-schedule-failure-watch.js')

const HOUR = 3600 * 1000
const PERIODS = { daily: 24 * HOUR, weekly: 7 * 24 * HOUR, monthly: 31 * 24 * HOUR }
const DEFAULT_SLACK_HOURS = 8
const MIN_SAMPLES = 3
const SLACK_ENV = 'MP_SCHEDULE_HEARTBEAT_SLACK_HOURS'
const COLLECT_TIMEOUT_MS = 20000
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const WORKFLOW_FILE_RE = /^[A-Za-z0-9._-]+\.ya?ml$/
// 下界取 1：正则**不放行**空串。"不带过滤"是哨兵语义，由 undefined 表达并在调用点单独判，
// 不靠这里 {0,32} 的宽容——那等于把"缺失"和"写坏成空"合并成一个取值（QM-6 i2）。
const EVENT_RE = /^[a-z_]{1,32}$/

/* 出处必须是**可重跑**的读数，不是写进注释的死数（本仓定性过"量过一次之后没人再量"这一类）。
 * monthly 的 31 天是按最长月取的保守上界，**没有实测样本**——这一条逐字写在 unmeasuredKinds 里，
 * 否则下一个人会以为整张表都是量出来的。 */
const HEARTBEAT_PROVENANCE = {
  measuredAt: '2026-10-23',
  maxIntervalRatio: 1.04,
  maxDriftHours: 5.68,
  slackHours: DEFAULT_SLACK_HOURS,
  minSamples: MIN_SAMPLES,
  samplesPerWorkflow: {
    'cleanup-artifacts.yml': 20,
    'clock-shift-oracle.yml': 2,
    'dep-audit.yml': 4,
    'sidecar-parity.yml': 4,
  },
  unmeasuredKinds: ['monthly'],
  remeasure: 'gh api "repos/<repo>/actions/workflows/<file>/runs?per_page=100" --jq "[.workflow_runs[]|select(.status==\\"completed\\")|.created_at]"  # 自己算相邻间隔与相对 cron 的漂移',
}

const SINGLE = /^\d{1,2}$/
const DOW_LIST = /^\d{1,2}(,\d{1,2})*$/

/**
 * cron（5 位）→ 周期。只认三种能确定的形状，其余返回 null（调用方必须落 SCANNER_FAULT）。
 * 为什么宁可判失明也不肯猜：猜成 daily 会让周报被天天判 LATE（假红），猜成 weekly 会让日报漏三天才响
 * （漏报）——两个方向都错，且错得不可归因。
 * dow 允许逗号列表（`1,3` 的实际间隔 ≤ 4 天，用 7 天做阈值只会更松，不产生假红）；
 * 带步进或区间的形状（每天每 N 日、工作日一类）刻意不认：那种形状的真实周期不唯一，值得让人来看一眼。
 */
function periodFromCron (cron) {
  if (typeof cron !== 'string') return null
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return null
  const [min, hour, dom, mon, dow] = f
  if (!SINGLE.test(min) || !SINGLE.test(hour)) return null
  if (Number(min) > 59 || Number(hour) > 23) return null
  if (mon !== '*') return null
  if (dom === '*' && dow === '*') return { kind: 'daily', ms: PERIODS.daily }
  if (dom === '*' && DOW_LIST.test(dow)) return { kind: 'weekly', ms: PERIODS.weekly }
  if (dow === '*' && SINGLE.test(dom) && Number(dom) >= 1 && Number(dom) <= 31) return { kind: 'monthly', ms: PERIODS.monthly }
  return null
}

/** 多行 cron ⇒ 取最短周期（任一条按时兑现过就说明这个作业有心跳）。任一推不出 ⇒ 整体推不出。 */
function shortestPeriod (crons) {
  if (!Array.isArray(crons) || crons.length === 0) return { fault: '声明了 schedule 却采不到任何 cron' }
  let best = null
  for (const c of crons) {
    const p = periodFromCron(c)
    if (!p) return { fault: `cron 形状推不出周期：${JSON.stringify(c)}` }
    if (!best || p.ms < best.ms) best = p
  }
  return { period: best }
}

/**
 * env 覆盖：非数字 / ≤0 / 非有限 ⇒ 回落默认**并出声**。静默回落是本仓点名的"把配置错误变成永久沉默"。
 * 未设置该变量是正常态，不 warn。
 */
function resolveSlackHours (env, warn) {
  const raw = env[SLACK_ENV]
  if (raw === undefined || raw === '') return { hours: DEFAULT_SLACK_HOURS, warned: false, source: 'default' }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    if (warn) warn(`[schedule-heartbeat] ${SLACK_ENV}=${JSON.stringify(raw)} 非法（须为正小时数），回落默认 ${DEFAULT_SLACK_HOURS}h`)
    return { hours: DEFAULT_SLACK_HOURS, warned: true, source: 'invalid-fallback' }
  }
  return { hours: n, warned: false, source: 'env' }
}

const REQUIRED_RUN_FIELDS = ['created_at', 'status', 'event']

/* 两趟取证共用的形状校验 + 时间戳收集。抽成一份**不是**"顺手收敛"：上一轮 m7 的锚点在本文件里命中 2 次
 * 并拒绝动手——两份逐字相同的校验，对变异判据就是歧义锚点，对下一个改判据的人就是"改一侧忘另一侧"。
 * 顺序与旧实现逐字一致：先对**所有** run 校验形状（不分 event），再按 event/status 挑，
 * 最后只对被挑中的那条解析 created_at——非 schedule 的 run 时间戳坏了，不该把整档抬成失明。 */
function validateRunShape (runs) {
  if (!Array.isArray(runs)) throw new Error(`runs 不是数组（拿到 ${runs === null ? 'null' : typeof runs}）`)
  for (const [i, r] of runs.entries()) {
    if (!r || typeof r !== 'object') throw new Error(`run[${i}] 不是对象`)
    for (const k of REQUIRED_RUN_FIELDS) {
      if (typeof r[k] !== 'string' || r[k] === '') throw new Error(`run[${i}] 缺必需字段 ${k}（采集器与 API 契约漂移）`)
    }
  }
  return runs
}

/**
 * 索引保持原样 ⇒ 错误文案指得回那一条 run；返回**条目**（ts + status），新→旧。
 * 带 status 是为了让「排队」与「在跑」可分辨：queued（没抢到 runner）与 in_progress（跑起来没跑完）
 * 是两种成因，只报一条 NEVER_COMPLETED 会把运维支使去查错方向（QM-6 i4）。
 */
function scanSchedule (runs, statusKeep) {
  const validated = validateRunShape(runs)
  const out = []
  for (const [i, r] of validated.entries()) {
    if (r.event !== 'schedule' || !statusKeep(r.status)) continue
    const ts = Date.parse(r.created_at)
    if (!Number.isFinite(ts)) throw new Error(`run[${i}].created_at 解析不动：${JSON.stringify(r.created_at)}`)
    out.push({ ts, status: r.status })
  }
  return out.sort((a, b) => b.ts - a.ts)
}

/**
 * 心跳时间戳（新→旧）：`event=schedule` 且 `status=completed`。
 * `conclusion=failure` **算一次心跳**：本判据问"跑没跑"，"跑失败"归 `ci-failure-handler` 那一刀管。
 */
function heartbeatStamps (runs) { return scanSchedule(runs, (s) => s === 'completed').map((e) => e.ts) }

/**
 * 「cron 兑现了，但那一次还没跑完」的证据：schedule 事件、status 不是 completed 的最近起跑时刻（新→旧）。
 * 为什么单列一档而不是并回 NEVER_RAN：本判据问的是"**定时触发有没有兑现**"。
 * 一条正在跑的 schedule run 就是兑现的证据；把它读成"从来没跑过"会让巡检作业第一天自己咬自己
 * （2026-10-25 现场：它是全仓唯一一条 schedule run，扫描那一刻 status=in_progress）。
 * 但也不能一律放行——文件头第 4 条成因就是"runner 长期排队永不 completed"。
 * 分档不用新常量，用**同一把周期时钟**：age ≤ 阈值 ⇒ PENDING_FIRST（出声不阻断），超阈值 ⇒ NEVER_COMPLETED（红）。
 */
function pendingScheduleAttempts (runs) { return scanSchedule(runs, (s) => s !== 'completed') }

function judge (opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const warn = opts.warn || ((m) => console.warn(m))
  const { hours: slackHours, warned, source: slackSource } = resolveSlackHours(opts.env || process.env, warn)
  const out = {
    verdict: null, rows: [], faults: [],
    counts: { ok: 0, late: 0, never: 0, thin: 0, pending: 0, neverCompleted: 0, witness: 0 },
    now, slackHours, slackSource, slackWarned: warned,
  }

  let workflows
  if (Array.isArray(opts.workflows)) workflows = opts.workflows
  else {
    try { workflows = loadWorkflows(opts.root || process.cwd()) } catch (e) {
      out.verdict = 'SCANNER_FAULT'; out.faults.push({ file: '(loader)', reason: e.message }); return out
    }
  }
  const scheduled = workflows.filter((w) => w.scheduled)
  if (scheduled.length === 0) {
    out.verdict = 'SCANNER_FAULT'
    out.faults.push({ file: '(domain)', reason: '一条带 schedule 的作业都没扫到（判据域为空 ≠ 全部按时跑了）' })
    return out
  }

  for (const w of scheduled) {
    const row = { file: w.file, name: w.name, crons: Array.isArray(w.crons) ? w.crons : [], verdict: null, reason: null, period: null, thresholdHours: null, last: null, ageHours: null, collected: 0, heartbeats: 0 }
    out.rows.push(row)
    const sp = shortestPeriod(row.crons)
    if (sp.fault) { row.verdict = 'SCANNER_FAULT'; row.reason = sp.fault; out.faults.push({ file: w.file, reason: sp.fault }); continue }
    row.period = sp.period.kind
    row.thresholdHours = (sp.period.ms + slackHours * HOUR) / HOUR

    let res
    try { res = opts.runsOf(w.file) } catch (e) {
      row.verdict = 'SCANNER_FAULT'; row.reason = `采集抛错：${e.message}`; out.faults.push({ file: w.file, reason: row.reason }); continue
    }
    if (!res || res.ok !== true) {
      row.verdict = 'SCANNER_FAULT'; row.reason = `取不到数：${res && res.error ? res.error : '采集器未返回 ok'}`
      out.faults.push({ file: w.file, reason: row.reason }); continue
    }
    let stamps
    try { stamps = heartbeatStamps(res.runs) } catch (e) {
      row.verdict = 'SCANNER_FAULT'; row.reason = `读数形状不合：${e.message}`; out.faults.push({ file: w.file, reason: row.reason }); continue
    }
    row.collected = res.runs.length
    row.windowFull = res.truncated === true
    row.heartbeats = stamps.length
    if (stamps.length === 0) {
      // 「我扫到的窗口里没有」不是「它从来没跑过」。先做一次带 event 过滤的 witness 取证，
      // 再按 witness 的三种答案分档；witness 自己取不到数 ⇒ SCANNER_FAULT（rc=2）——
      // 把工具的失明落成运维事实（NEVER_RAN）或落成通过（OK），是本仓点名的同一种错。
      let wit
      try { wit = opts.runsOf(w.file, { event: 'schedule' }) } catch (e) {
        row.verdict = 'SCANNER_FAULT'; row.reason = `witness 采集抛错：${e.message}`; out.faults.push({ file: w.file, reason: row.reason }); continue
      }
      if (!wit || wit.ok !== true) {
        row.verdict = 'SCANNER_FAULT'; row.reason = `witness 取不到数：${wit && wit.error ? wit.error : '采集器未返回 ok'}`
        out.faults.push({ file: w.file, reason: row.reason }); continue
      }
      let wstamps
      try { wstamps = heartbeatStamps(wit.runs) } catch (e) {
        row.verdict = 'SCANNER_FAULT'; row.reason = `witness 读数形状不合：${e.message}`; out.faults.push({ file: w.file, reason: row.reason }); continue
      }
      row.witnessCollected = wit.runs.length
      // 第二趟取证也可能自己被截断。档位不受它影响（runs 按 created_at 降序，截断砍不掉最新那条），
      // 但「这一趟同样只看了最近 perPage 条」必须可见——否则 witness 会被下一个读者当成完整历史（QM-6 i3）。
      row.witnessWindowFull = wit.truncated === true
      // 「这一行的结论是谁给的」只由这一个字段承载：有心跳 ⇒ 走 OK/LATE（打「心跳来源」），
      // witness 里只有未完成的 run ⇒ 走两档在途（打「证据来源」）。两种都是第二趟定的案，
      // 所以首行的 witness= 计数也按同一个字段投影（QM-6 i3 采纳后的第二落点：在途档原本不出声）。
      row.heartbeatSource = 'witness'
      out.counts.witness++
      if (wstamps.length > 0) {
        stamps = wstamps
        row.heartbeats = wstamps.length
      } else {
        // 这一趟**必须自己带保护**：completed 档把未完成的 run 过滤掉、从不解析它的 created_at，
        // 而在途档恰恰要解析它——同一份校验在两趟里触发的输入集不同，所以不能靠上一趟兜（QM-6 第四轮 i1）。
        let pending
        try { pending = pendingScheduleAttempts(wit.runs) } catch (e) {
          row.verdict = 'SCANNER_FAULT'; row.reason = `witness 在途读数形状不合：${e.message}`; out.faults.push({ file: w.file, reason: row.reason }); continue
        }
        if (pending.length > 0) {
          const age = (now - pending[0].ts) / HOUR
          row.lastAttempt = new Date(pending[0].ts).toISOString()
          row.lastAttemptStatus = pending[0].status
          row.attemptAgeHours = age
          if (age > row.thresholdHours) { row.verdict = 'NEVER_COMPLETED'; out.counts.neverCompleted++ }
          else { row.verdict = 'PENDING_FIRST'; out.counts.pending++ }
          continue
        }
        row.verdict = 'NEVER_RAN'; out.counts.never++
        continue
      }
    }
    // 样本薄 ≠ 失明：数据在、只是少，所以**出声但不改退出码**（每周作业实测只有 2 条样本）。
    if (row.heartbeats < MIN_SAMPLES) out.counts.thin++
    row.last = new Date(stamps[0]).toISOString()
    row.ageHours = (now - stamps[0]) / HOUR
    if (row.ageHours > row.thresholdHours) { row.verdict = 'LATE'; out.counts.late++ } else { row.verdict = 'OK'; out.counts.ok++ }
  }

  // 退出码优先级：2 > 1 > 0。"我不知道"必须先于"运维事实"被解决（见文件头第 3 条）。
  if (out.faults.length) out.verdict = 'SCANNER_FAULT'
  else if (out.counts.late || out.counts.never) out.verdict = 'FAIL'
  else out.verdict = 'OK'
  return out
}

const JQ_RUNS = '[.workflow_runs[]|{created_at:.created_at,status:.status,event:.event,conclusion:.conclusion}]'

/**
 * 真采集器：一次 HTTP 读一个作业的 run 列表。
 * **查询里刻意不带 `event=schedule`**：那样"cron 从未兑现、只有 push run"的作业会被服务端过滤成空列表，
 * 判据侧的 event 过滤就永远是死码，"有 push run"这一现场信息也一并丢掉（NEVER_RAN 仍然判对，但不可归因）。
 * repo 必须过 REPO_RE——它要拼进 API 路径；取不到时 fail closed，不猜。
 * exec 可注入：行为锁用假 exec 断言 argv 与"gh 抛错 ⇒ 取不到数"，零真实出站。
 */
function makeGhCollector (opts = {}) {
  const repo = opts.repo
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new Error(`GITHUB_REPOSITORY 不可用或形状不合：${JSON.stringify(repo)}`)
  const exec = opts.exec || ((cmd, args, o) => execFileSync(cmd, args, o))
  const perPage = opts.perPage || 100
  // 超过 100 时 GitHub **静默截到 100**，于是"取到的条数 >= perPage"永远不成立——
  // 本刀最要紧的那个读数（truncated，窗口是否被填满）就会说谎。宁可当场拒绝构造（QM-6 i6）。
  if (perPage > 100) throw new Error(`per_page 上限是 100，拿到 ${perPage}：API 会静默截断，truncated 读数随之失真 ⇒ 要更多历史只能翻页聚合`)
  const timeoutMs = opts.timeoutMs || COLLECT_TIMEOUT_MS
  return function runsOf (file, qopts) {
    if (!WORKFLOW_FILE_RE.test(String(file))) return { ok: false, error: `作业文件名形状不合，不拼进 API 路径：${JSON.stringify(file)}` }
    const q = qopts || {}
    // 两趟查询语义不同，必须分形状：
    //   主查询 **不带** event 过滤 —— 只有不带它，才看得见"有 push run 而 cron 从未兑现"这一格（H5/H20 的现场）；
    //   witness 查询 **必须带** event=schedule —— 主查询是"最近 per_page 条"，繁忙作业会把它自己的
    //     schedule run 挤出窗口（2026-10-25 实测 dep-audit.yml：100 条窗口只覆盖 14.4 小时，全是 pull_request，
    //     而按 event 过滤查得到 4 条 completed schedule run）。带过滤才是换了坐标去问，而不是拿同一个截断窗口自证。
    const event = q.event === undefined ? '' : String(q.event)
    // 「不带过滤」的哨兵**只能**是 undefined：显式空串是调用方写坏，必须单独一条文案（QM-6 i2——
    // 把它并进"形状不合"等于把人支使去改一个没写错的正则）。两条成因、两种修法，不合并。
    if (event === '') {
      if (q.event !== undefined) return { ok: false, error: `event 给了空串：${JSON.stringify(q.event)} ⇒ 主查询用「不传 event」表达，显式空串是调用方写坏，拒绝而不是静默退化` }
    } else if (!EVENT_RE.test(event)) {
      return { ok: false, error: `event 取值形状不合，不拼进查询串：${JSON.stringify(q.event)}` }
    }
    const qs = `per_page=${perPage}${event ? `&event=${encodeURIComponent(event)}` : ''}`
    const args = ['api', `repos/${repo}/actions/workflows/${file}/runs?${qs}`, '--jq', JQ_RUNS]
    let stdout
    try {
      stdout = exec('gh', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 })
    } catch (e) {
      return { ok: false, error: `gh api 失败（${file}）：${e.message}` }
    }
    const parsed = parseRunsJson(stdout, file)
    if (!parsed.ok) return parsed
    // 「窗口被填满」必须作为一个读数回报：否则下游无法区分"我没看见"与"确实没有"，
    // 而 truncation 恰恰是这条判据第一个真实假阳性的来源。
    return { ok: true, runs: parsed.runs, truncated: parsed.runs.length >= perPage }
  }
}

function parseRunsJson (text, file) {
  let parsed
  try { parsed = JSON.parse(text) } catch (e) {
    return { ok: false, error: `JSON 解析不动（${file}）：${e.message}` }
  }
  if (!Array.isArray(parsed)) return { ok: false, error: `返回值不是数组（${file}）` }
  return { ok: true, runs: parsed }
}

function parseArgs (argv) {
  const o = { root: null, repo: null, limit: null, explain: false }
  const posInt = (label, v) => {
    if (!/^\d+$/.test(String(v)) || Number(v) <= 0) throw new Error(`${label} 需要正整数，拿到 ${JSON.stringify(v)}`)
    return Number(v)
  }
  let positionalUsed = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} 后面没有取值`)
      return argv[++i]
    }
    if (a === '--limit') o.limit = posInt('--limit', next())
    else if (a.startsWith('--limit=')) o.limit = posInt('--limit', a.slice(8))
    else if (a === '--root') o.root = next()
    else if (a.startsWith('--root=')) o.root = a.slice(7)
    else if (a === '--repo') o.repo = next()
    else if (a.startsWith('--repo=')) o.repo = a.slice(7)
    else if (a === '--explain') o.explain = true
    else if (a.startsWith('-')) throw new Error(`未知旗标 ${a}`)
    else if (!positionalUsed) { positionalUsed = true; o.root = a }
    else throw new Error(`多余的位置参数 ${a}`)
  }
  if (!o.root) o.root = process.cwd()
  return o
}

function main (opts = {}) {
  const argv = opts.argv || process.argv.slice(2)
  const env = opts.env || process.env
  const log = opts.log || ((s) => console.log(s))
  const warn = opts.warn || ((s) => console.warn(s))
  let parsed
  try { parsed = parseArgs(argv) } catch (e) { log(`SCANNER_FAULT 参数不合：${e.message}`); return 2 }

  let runsOf = opts.runsOf
  if (!runsOf) {
    try { runsOf = makeGhCollector({ repo: parsed.repo || env.GITHUB_REPOSITORY }) } catch (e) {
      log(`SCANNER_FAULT 采集器不可用：${e.message}`); return 2
    }
  }
  const r = judge({ root: parsed.root, now: typeof opts.now === 'number' ? opts.now : Date.now(), env, warn, runsOf, workflows: opts.workflows })
  const scoped = parsed.limit === null ? r.rows : r.rows.slice(0, parsed.limit)
  const counts = { ok: 0, late: 0, never: 0, faults: 0, pending: 0, neverCompleted: 0, witness: 0 }
  // 新增档必须在这里显式领自己的桶：落进 `else counts.faults++` 会把"首跑在途"抬成 rc=2（把没红过的东西判成工具坏了）。
  for (const row of scoped) {
    if (row.verdict === 'OK') counts.ok++
    else if (row.verdict === 'LATE') counts.late++
    else if (row.verdict === 'NEVER_RAN') counts.never++
    else if (row.verdict === 'PENDING_FIRST') counts.pending++
    else if (row.verdict === 'NEVER_COMPLETED') counts.neverCompleted++
    else counts.faults++
  }
  counts.thin = scoped.filter((row) => row.heartbeats > 0 && row.heartbeats < MIN_SAMPLES).length
  // witness 这一格不是 judge 里那个计数：CLI 面的读数必须由**被限定的那一组行**投影出来，否则 --limit 档与全量档同形。
  // 第一版这里恒 0（main 从不回填它、judge 的计数被整丢掉），是 H17 新加的那条首行断言当场抓出来的 ⇒ 变异 m31 钉住。
  counts.witness = scoped.filter((row) => row.heartbeatSource === 'witness').length
  // --limit 是"只跑前 N 条"的 smoke 档：判定一律按**被限定的那一组**算，不得让未采样的作业影响退出码。
  // 但域级失明（判据域为空 / loader 抛错）根本不在 rows 里，必须另加回来——
  // 否则"什么都没扫到"会被读成全绿（本仓把"按目录里有什么迭代"的门禁看不见"该有什么"点名为同型缺陷）。
  const domainFaults = r.faults.filter((f) => !r.rows.some((row) => row.file === f.file))
  // PENDING_FIRST 不进 FAIL：它是"这一刻还在跑"，不是欠账（超预算的那一档已经换成 NEVER_COMPLETED 进 FAIL）。
  const verdict = (counts.faults + domainFaults.length) ? 'SCANNER_FAULT' : (counts.late + counts.never + counts.neverCompleted ? 'FAIL' : 'OK')
  // 运行面同源读数：witness 让最坏出站量变成「每条两趟」，这个数必须每天自己说出来，
  // 而不是只在 PR 侧的锁（H27）里算一次（QM-6 第四轮 i2）。
  const worstCollectSec = r.rows.length * 2 * COLLECT_TIMEOUT_MS / 1000

  // 新增的三个计数放在 thin 之后、slack 之前：既有锁（H1/H17）钉的是 `late= never= faults= thin=` 这段连续形状，
  // 往中间插字段会让它们假红——红得没有意义，还会诱导下一个人去放宽断言。
  log(`SCHEDULE-HEARTBEAT now=${new Date(r.now).toISOString()} workflows=${r.rows.length} late=${counts.late} never=${counts.never} faults=${counts.faults} thin=${counts.thin} pending=${counts.pending} never_completed=${counts.neverCompleted} witness=${counts.witness} slack_hours=${r.slackHours}(${r.slackSource}) 采集最坏秒数=${worstCollectSec} 判定=${verdict}`)
  if (parsed.explain) {
    for (const row of r.rows) log(`  EXPLAIN ${row.file} crons=${JSON.stringify(row.crons)} period=${row.period || '-'} 阈值_hours=${row.thresholdHours === null ? '-' : row.thresholdHours.toFixed(1)}`)
  }
  for (const row of scoped) {
    const win = ` 采集窗口=${row.windowFull ? '满' : '否'}`
    // 同一个字段、两种说法，各自只在自己的语义成立时使用：在途档没有心跳，硬打「心跳来源」
    // 等于造出一条假证据；OK/LATE 打「证据来源」则把已经拿到手的心跳降级成旁证。
    const src = row.heartbeatSource !== 'witness' ? '' : (row.verdict === 'OK' || row.verdict === 'LATE' ? ' 心跳来源=witness' : ' 证据来源=witness')
    const wwin = row.witnessWindowFull === true ? ' witness采集窗口=满' : ''
    if (row.verdict === 'OK') log(`  OK ${row.file} name=${row.name} period=${row.period} last=${row.last} age_hours=${row.ageHours.toFixed(1)} 阈值_hours=${row.thresholdHours.toFixed(1)} 心跳样本=${row.heartbeats} 采集条数=${row.collected}${src}${win}${wwin}`)
    // LATE 行也必须带「心跳来源/采集窗口」两个标签：降级与「迟到了」是两件同时成立的事，
    // 只在 OK 行出声会让「迟到的那条其实是换坐标查到的」这一格在日志里消失（采纳 QM-6 i3 时实测到的第二格）。
    else if (row.verdict === 'LATE') log(`  LATE ${row.file} name=${row.name} period=${row.period} last=${row.last} age_hours=${row.ageHours.toFixed(1)} 阈值_hours=${row.thresholdHours.toFixed(1)}${src}${win}${wwin}`)
    else if (row.verdict === 'NEVER_RAN') log(`  NEVER_RAN ${row.file} name=${row.name} period=${row.period} completed_schedule_run=0 采集条数=${row.collected} witness_schedule_run=0${win}${wwin}`)
    // 在途两档的结论**完全**来自第二趟取证（主窗口那时是零心跳），所以标签一个都不能少：
    else if (row.verdict === 'PENDING_FIRST') log(`  PENDING_FIRST ${row.file} name=${row.name} period=${row.period} 上次尝试=${row.attemptAgeHours.toFixed(1)}h 状态=${row.lastAttemptStatus} 阈值_hours=${row.thresholdHours.toFixed(1)}${src}${win}${wwin} ⇒ cron 已兑现、那一次尚未 completed，不计欠账`)
    else if (row.verdict === 'NEVER_COMPLETED') log(`  NEVER_COMPLETED ${row.file} name=${row.name} period=${row.period} 上次尝试=${row.attemptAgeHours.toFixed(1)}h 状态=${row.lastAttemptStatus} 阈值_hours=${row.thresholdHours.toFixed(1)}${src}${win}${wwin} ⇒ schedule run 超预算仍未完成（文件头第 4 条成因；状态是 queued 就查 runner/配额，是 in_progress 就查作业自己）`)
    else log(`  SCANNER_FAULT ${row.file} name=${row.name} 原因=${row.reason}`)
  }
  for (const f of domainFaults) log(`  SCANNER_FAULT ${f.file} 原因=${f.reason}`)
  log(`HEARTBEAT-PROVENANCE measuredAt=${HEARTBEAT_PROVENANCE.measuredAt} maxIntervalRatio=${HEARTBEAT_PROVENANCE.maxIntervalRatio} maxDriftHours=${HEARTBEAT_PROVENANCE.maxDriftHours} minSamples=${HEARTBEAT_PROVENANCE.minSamples} unmeasured=${HEARTBEAT_PROVENANCE.unmeasuredKinds.join(',') || '-'}`)
  log(`HEARTBEAT-SAMPLES ${Object.entries(HEARTBEAT_PROVENANCE.samplesPerWorkflow).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  return verdict === 'SCANNER_FAULT' ? 2 : (verdict === 'FAIL' ? 1 : 0)
}

if (require.main === module) process.exit(main())

module.exports = {
  judge, main, periodFromCron, shortestPeriod, resolveSlackHours, heartbeatStamps,
  makeGhCollector, parseRunsJson, parseArgs, pendingScheduleAttempts, scanSchedule,
  HEARTBEAT_PROVENANCE, JQ_RUNS, PERIODS, DEFAULT_SLACK_HOURS, MIN_SAMPLES, SLACK_ENV, REQUIRED_RUN_FIELDS, COLLECT_TIMEOUT_MS,
}
