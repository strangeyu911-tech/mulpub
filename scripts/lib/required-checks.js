'use strict'

/**
 * 「required 检查清单」的对账面与「恒 skipped」探测 —— 判定真源（零第三方依赖）。
 *
 * 为什么要这把尺：required 清单只存在 GitHub 侧，仓内没有任何字承载"现在到底谁算 required"；
 * 而 GitHub 把 `skipped` 当满足 required ⇒ 一条永不产出结论的检查可以长期顶着"required"这个名字，
 * 比缺这条更坏（看起来在守、实际从不发火）。本仓对同型问题已有「空转条目锁」，那把管路径前缀，管不到这里。
 *
 * 三条口径要记住：
 * ① **producer 映射是派生的**（上一刀刚被"两份手抄清单各漏一次"打过），
 *    手抄的只有"我们打算要求哪些名字"——那本身就是被审计对象，双向差集才会红。
 * ② **一个 check 名可以有多个产出者**（实测 `build.yml#changes` 与 `electron-ci.yml#changes` 都叫 `Changes`），
 *    所以派生索引用「名 → 产出者数组」而不是「名 → 唯一产出者」。取后者会把第二个产出者的 run 整批看不见，
 *    于是"窗口里全是另一个 workflow 的 run"被读成 absent。
 * ③ **本模块不 spawn 任何进程**：平台读数由调用方注入的 `fetcher` 提供。注入面必须存在，
 *    否则这把尺在 CI 上跑不起来（`changes` 作业里 `gh` 可用，但判据本体要能在无 gh 的环境里被单测跑）。
 */

const fs = require('node:fs')
const path = require('node:path')

/** `on:` 下的这些键是触发器，不是 job。派生结果里出现它们 = 解析没框住 `jobs:` 区间。 */
const TRIGGER_NAMES = Object.freeze([
  'push', 'pull_request', 'workflow_dispatch', 'schedule', 'repository_dispatch', 'workflow_call', 'workflow_run',
])

/**
 * 每个 producer workflow 往回看几条 run（**push 与 pull_request 两种事件都算**）。
 * 域的选择是被实测逼出来的：只看 main push 会把 `doc-gate.yml`（根本没有 push 触发器、
 * 只在 PR 上产出 required 检查）判成"从不产出结论"，而它恰恰是本仓守 PR 合并的那道闸。
 */
const RUN_WINDOW = 6

/** 往回扫多少条该 workflow 的 run 再做事件过滤；扫到顶仍一条 push/PR 都没有 ⇒ 探针失明（不判 no-run）。 */
const MAX_SCAN = 50

/**
 * 恒 skipped / absent / no-run 的存量欠账上限。调大它＝放宽「谁来守门」，只能人工改。
 * 起始 `0`：本刀实测现读 10/10 全部 produced（见 design.md D5 的否证链——立项时以为
 * `QG Coverage` 恒 skipped，那是"只看 main push"这个错域造出来的假病灶）。
 */
const MAX_DEBT = 0

const REGISTRY_REL = 'scripts/required-checks.json'
const DEBT_REL = 'scripts/required-check-debt.json'

/**
 * 从 `.github/workflows/**` 派生「check 名 → 产出它的 workflow + job」的**多值**索引。
 * 只认两空格缩进会把 `on:` 的触发器当 job（实测：`build.yml` 会得出
 * `["pull_request","push","workflow_dispatch","changes","build","release"]`），
 * 所以先框 `jobs:` 区间；显式 `name:` 优先，没有 `name:` 的取 job id
 * （`electron-tests` / `build` 就是只有 job id 的那两条）。
 */
function deriveWorkflowChecks (repoRoot) {
  const dir = path.join(repoRoot, '.github', 'workflows')
  let files
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()
  } catch (e) {
    return fail(0, 0, '读不到 .github/workflows：' + ((e && e.code) || e.message))
  }
  if (files.length === 0) return fail(0, 0, 'workflow 集合为空（目录被移走？），无从派生')

  const producers = new Map()
  let decls = 0
  for (const f of files) {
    let src
    try {
      src = fs.readFileSync(path.join(dir, f), 'utf8')
    } catch (e) {
      return fail(files, decls, '读不到 ' + f + '：' + ((e && e.code) || e.message))
    }
    const before = decls
    const lines = src.split(/\r?\n/)
    let inJobs = false
    let hasJobs = false
    let currentJob = null
    for (const ln of lines) {
      if (!inJobs) {
        if (/^jobs:\s*$/.test(ln)) { inJobs = true; hasJobs = true }
        continue
      }
      // 注释不结束区间、也不许当 job 名（实测 doc-gate.yml:96 有一行**零缩进**的 `# ===== 说明 =====`
      // 躺在 jobs 区间之后；把它当区间结束虽然此刻无害，但"两个 job 之间夹一行顶格注释"就会
      // 静默吃掉后面所有 job —— 而下游的差集只会报"没有产出者"，看不出是解析断了）。
      if (/^\s*#/.test(ln)) continue
      if (ln.trim() === '') continue
      if (!/^[ \t]/.test(ln)) {
        // 零缩进的非空非注释行 = 顶层下一个键 ⇒ jobs 块结束。
        // 空行不算区间尾（实测第一版把空行当块尾，jobs 里第一条空行之后全部丢失）。
        inJobs = false
        currentJob = null
        continue
      }
      const id = ln.match(/^ {2}([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/)
      if (id) {
        currentJob = id[1]
        decls += 1
        if (!TRIGGER_NAMES.includes(currentJob)) push(producers, currentJob, { workflow: f, job: currentJob, explicitName: false })
        continue
      }
      const nm = ln.match(/^ {4}name:\s*["']?([^"'\n]+?)["']?\s*$/)
      if (nm && currentJob) {
        const ctx = nm[1].trim()
        if (ctx) { push(producers, ctx, { workflow: f, job: currentJob, explicitName: true }); decls += 1 }
      }
    }
    if (hasJobs && decls === before) {
      return fail(files, decls, f + ' 声明了 jobs: 却没派生出任何 job（解析在该文件里断了；不许拿残缺集合去判"某条 required 没有产出者"）')
    }
  }

  const leaked = TRIGGER_NAMES.filter((t) => producers.has(t))
  if (leaked.length) return fail(files, decls, '派生退化：触发器名进了 job 集 [' + leaked.join(',') + ']，jobs: 区间没框住')
  if (producers.size === 0) return fail(files, decls, '一条 job 都没派生出来，本锁会空转')
  return { producers, count: producers.size, files, decls, selfFault: null }
}

function fail (files, decls, selfFault) {
  return { producers: new Map(), count: 0, files, decls: decls || 0, selfFault }
}
function push (producers, ctx, entry) {
  const list = producers.get(ctx) || []
  if (!list.some((e) => e.workflow === entry.workflow && e.job === entry.job)) list.push(entry)
  producers.set(ctx, list)
}

/** 某 check 名的全部产出者（多个是事实，不是错误：`Changes` 实测就有两份）。 */
function producersOf (derived, ctx) {
  const got = derived && derived.producers ? derived.producers.get(ctx) : null
  return Array.isArray(got) ? got : []
}

function readJsonAt (repoRoot, rel) {
  const abs = path.join(repoRoot, rel)
  let raw
  try {
    raw = fs.readFileSync(abs, 'utf8')
  } catch (e) {
    return { data: null, error: null, missing: ['ENOENT'].includes(e.code) ? true : '读不到 ' + rel + '：' + (e.code || e.message) }
  }
  try {
    return { data: JSON.parse(raw), error: null, missing: false }
  } catch (e) {
    return { data: null, error: rel + ' 不是合法 JSON：' + e.message, missing: false }
  }
}

/**
 * 登记面：「我们打算要求哪些 check 是 required」。唯一允许手抄的那一份，漂移由双向差集兜。
 * 读不到一律**抛错**（不返回空集合）：登记面缺席时"零漂移"与"什么都没登记"完全同形。
 */
function readRegistry (repoRoot) {
  const r = readJsonAt(repoRoot, REGISTRY_REL)
  if (r.missing === true) throw new Error('缺 ' + REGISTRY_REL + '：登记面缺席时无从对账，不得判"没有漂移"')
  if (r.error) throw new Error(r.error)
  const list = r.data && Array.isArray(r.data.required) ? r.data.required : null
  if (!list) throw new Error(REGISTRY_REL + ' 缺 required 数组')
  for (const e of list) {
    if (!e || typeof e.context !== 'string' || !e.context) throw new Error(REGISTRY_REL + ' 有条目缺 context')
    if (!e.producedBy || typeof e.producedBy.workflow !== 'string' || typeof e.producedBy.job !== 'string') {
      throw new Error(REGISTRY_REL + ' 的 ' + e.context + ' 缺 producedBy{workflow,job}')
    }
    if (typeof e.why !== 'string' || !e.why.trim()) throw new Error(REGISTRY_REL + ' 的 ' + e.context + ' 缺 why（登记必须写清为什么要求它）')
  }
  return { required: list, selfFault: null }
}

/** 欠账面：恒 skipped 的存量，起始只含既成事实那一条。文件缺席＝零欠账（安全方向）。 */
function readDebt (repoRoot) {
  const r = readJsonAt(repoRoot, DEBT_REL)
  if (r.missing === true) return {}
  if (r.error) throw new Error(r.error)
  if (r.data === null || typeof r.data !== 'object' || Array.isArray(r.data)) throw new Error(DEBT_REL + ' 必须是键→reason 字符串的对象')
  const out = {}
  for (const [k, v] of Object.entries(r.data)) if (!k.startsWith('_')) out[k] = v
  return out
}

function validateDebt ({ debt, required, max }) {
  const violations = []
  // 文件缺席＝零欠账（安全方向）：不得反过来为"清单没落盘"造一条红（上一刀的豁免清单同口径）。
  // 同理，"上限没用满"也不红——否则等于逼人为了消红去调小 MAX_DEBT，那是一次无意义的守门面改动。
  for (const [k, v] of Object.entries(debt || {})) {
    if (k.startsWith('_')) continue
    if (typeof v !== 'string' || !v.trim()) violations.push('欠账 ' + k + ' 的理由不成立（必须是非空字符串，写清重取命令与证据）')
    if (!required.includes(k)) violations.push('欠账 ' + k + ' 不再是 required 名单里的名字 ⇒ 陈旧登记，删掉它')
  }
  const n = Object.keys(debt || {}).filter((k) => !k.startsWith('_')).length
  if (n > max) violations.push('欠账条数 ' + n + ' > 上限 ' + max + '（抬上限是在放宽「谁来守门」）')
  return { violations, counted: n }
}

/**
 * 单个产出者的窗口分类。**`fetched` 必须由调用方显式给 true**——
 * 缺省即 selfFault：「我没证明取到了数」与「取到了但一条都没有」是两个动作相反的对象。
 * `scanned` 是过滤前扫到的条数（用来区分"真没跑"与"扫得不够"）；`lastRun` 供 --report 留痕。
 */
function classifyWindow ({ workflow, runs, fetched, scanned }, ctx) {
  if (fetched !== true || !Array.isArray(runs)) {
    return { workflow, form: 'selfFault', runs: 0, detail: ctx + '：' + (workflow || '?') + ' 的 run 窗口没取到（探针失明，不得读成"没跑"）' }
  }
  if (runs.length === 0) {
    if ((scanned || 0) >= MAX_SCAN) {
      return { workflow, form: 'selfFault', runs: 0, detail: ctx + '：' + workflow + ' 扫到 ' + MAX_SCAN + ' 条上限仍没有一条 push/PR run（扫描面不够，不能判"它不跑"）' }
    }
    return { workflow, form: 'no-run', runs: 0, scanned: scanned || 0, detail: ctx + '：' + workflow + ' 最近 ' + (scanned || 0) + ' 条 run 里没有一条是 push/PR 触发 ⇒ required 却不在合并路径上' }
  }
  const seen = []
  let undetermined = 0
  let completedWithout = 0
  let inFlight = 0
  for (const r of runs) {
    const jobs = (r && r.jobs) || {}
    const c = Object.prototype.hasOwnProperty.call(jobs, ctx) ? jobs[ctx] : undefined
    if (typeof c === 'string' && c) { seen.push(c); continue }
    if (c === null || c === '') { undetermined += 1; continue }
    // 名字不在清单里 ≠ 这个 job 不存在：GitHub 对**没跑完的 run** 只给部分作业清单，
    // 排在后面的作业还没长出来。只有 status=completed 的那条才构成"缺席证据"，
    // 其余一律计入未定论（含 status 本身没给 —— 探针没抄全不是"跑完了"的证据）。
    if (r && r.status === 'completed') completedWithout += 1
    else inFlight += 1
  }
  if (seen.length === 0 && undetermined === 0 && completedWithout === 0 && inFlight > 0) {
    return {
      workflow, form: 'selfFault', runs: runs.length,
      detail: ctx + '：' + workflow + ' 窗口 ' + runs.length + ' 条 run 有 ' + inFlight +
        ' 条未跑完（queued/in_progress 一类），作业清单尚未长全 ⇒ 缺席无从判定（不得读成"它不存在"）',
    }
  }
  if (seen.length === 0 && undetermined === 0) {
    return {
      workflow, form: 'absent', runs: runs.length,
      detail: ctx + '：' + workflow + ' 扫了 ' + runs.length + ' 条 run（已完成 ' + completedWithout +
        ' 条、未跑完 ' + inFlight + ' 条不计入缺席证据），里面根本没有这个名字的 job' +
        '（派生说它在该文件里，已完成的现场却不认识它）',
    }
  }
  if (seen.length === 0) {
    return { workflow, form: 'selfFault', runs: runs.length, detail: ctx + '：' + workflow + ' 窗口内该 job 只有未定论读数（in_progress/queued 一类 ' + undetermined + ' 次），无从判定' }
  }
  if (seen.some((c) => c !== 'skipped')) return { workflow, form: 'produced', runs: runs.length, conclusions: seen }
  return { workflow, form: 'always-skipped', runs: runs.length, detail: ctx + '：' + workflow + ' 最近 ' + runs.length + ' 次 run 里每一次都是 skipped ⇒ 一条 required 却永不产出结论的门禁' }
}

/**
 * 多产出者聚合（逐档动作不同，不得合并）：
 * 任一产出者取不到数 ⇒ selfFault；任一产出者真跑出过非 skipped 结论 ⇒ produced；
 * 有 run 但都不认识这个名字 ⇒ absent；全都"没跑" ⇒ no-run；余下 ⇒ always-skipped。
 * 优先级写成"先真结论、后坏消息"：一个产出者 no-run 不得把另一个的恒 skipped 洗白，
 * 反之一个产出者 no-run 也不得把另一个的真 produced 抹掉（`Changes` 实测就有两个产出者）。
 */
function judgePresence (spec, ctx) {
  const windows = spec && Array.isArray(spec.windows) ? spec.windows : null
  if (!windows || windows.length === 0) {
    return { form: 'selfFault', detail: ctx + '：没有产出者可探测（派生没给出 producer，或调用方没把窗口传进来）', runs: 0 }
  }
  const cls = windows.map((w) => classifyWindow(w, ctx))
  const fault = cls.find((c) => c.form === 'selfFault')
  if (fault) return { form: 'selfFault', detail: fault.detail, runs: 0, windows: cls }
  if (cls.some((c) => c.form === 'produced')) return { form: 'produced', runs: cls.reduce((a, c) => a + c.runs, 0), windows: cls }
  const absent = cls.find((c) => c.form === 'absent')
  if (absent) return { form: 'absent', runs: cls.reduce((a, c) => a + c.runs, 0), detail: absent.detail, windows: cls }
  const skipped = cls.find((c) => c.form === 'always-skipped')
  if (skipped) return { form: 'always-skipped', runs: skipped.runs, detail: cls.filter((c) => c.form === 'always-skipped').map((c) => c.detail).join('；'), windows: cls }
  return { form: 'no-run', runs: 0, detail: cls.map((c) => c.detail).join('；'), windows: cls }
}

function judge ({ derived, registry, platform, debt, debtViolations, presence }) {
  const violations = []
  const unproven = []
  let drift = 0
  let dead = 0
  let noRun = 0
  let debtAck = 0
  let multi = 0

  for (const v of (debtViolations || [])) violations.push(v)

  if (derived && derived.selfFault) unproven.push('派生退化：' + derived.selfFault)
  if (platform && platform.selfFault) unproven.push('平台清单取不到：' + platform.selfFault)

  const regNames = registry && registry.required ? registry.required.map((e) => e.context) : []
  const platNames = platform && Array.isArray(platform.union) ? platform.union : []

  if (!(derived && derived.selfFault) && !(platform && platform.selfFault)) {
    if (platNames.length === 0 && regNames.length > 0) {
      unproven.push('平台并集为空而登记面有 ' + regNames.length + ' 条 ⇒ 按未证实处理（十闸同摘不是常见事故，令牌读不到才是）')
    } else {
      for (const c of platNames) {
        if (!regNames.includes(c)) { violations.push('平台要求而仓内未登记的 check：' + c + '（有人在平台侧加了闸，仓内没人知道它是什么）'); drift += 1 }
      }
      for (const c of regNames) {
        if (!platNames.includes(c)) { violations.push('仓内登记而平台没有的 check：' + c + '（闸被摘了——这是这条唯一的机械出口）'); drift += 1 }
      }
    }
    for (const e of registry.required) {
      const list = producersOf(derived, e.context)
      if (list.length === 0) { violations.push('登记的 ' + e.context + ' 在任何 workflow 里都派生不出产出者（登记漂了）'); drift += 1; continue }
      if (list.length > 1) multi += 1
      if (!list.some((p) => p.workflow === e.producedBy.workflow && p.job === e.producedBy.job)) {
        violations.push('登记的产出者不在派生集合里：' + e.context + ' 登记 ' + e.producedBy.workflow + '#' + e.producedBy.job +
          '，派生 [' + list.map((p) => p.workflow + '#' + p.job).join(', ') + ']')
        drift += 1
      }
    }
    for (const c of regNames) {
      const p = (presence && presence[c]) || { form: 'selfFault', detail: c + '：没有探测器读数' }
      const acked = debt && Object.prototype.hasOwnProperty.call(debt, c)
      if (p.form === 'selfFault') { unproven.push(p.detail || c); continue }
      if (p.form === 'produced') {
        if (acked) { violations.push('欠账 ' + c + ' 已经不再成立（窗口内它产出过结论）⇒ 删掉这条登记'); drift += 1 }
        continue
      }
      if (p.form === 'no-run') noRun += 1
      if (acked) { debtAck += 1; continue }
      const label = p.form === 'absent' ? '从未出现' : p.form === 'no-run' ? '不在合并路径上' : '恒 skipped'
      violations.push(label + '：' + (p.detail || c))
      dead += 1
    }
  }

  const rc = unproven.length ? 2 : violations.length ? 1 : 0
  const verdict = rc === 2 ? 'UNPROVEN' : rc === 1 ? 'VIOLATIONS' : 'PASS'
  const head = 'REQUIRED-CHECKS-SCAN required=' + regNames.length + ' derived=' + ((derived && derived.count) || 0) +
    ' multi=' + multi + ' drift=' + drift + ' dead=' + dead + ' noRun=' + noRun + ' unproven=' + unproven.length +
    ' debtAck=' + debtAck + ' verdict=' + verdict
  return { rc, verdict, violations, unproven, lines: [head], head, counts: { drift, dead, noRun, debtAck, multi } }
}

/**
 * 平台侧 required：两套机制并存，只查其一必得假结论。
 * `/rulesets` **列表**接口的 `rules` 恒为空，所以列表只用来取 id，required 一律按 id 逐个取详情。
 * `fetcher` 由调用方注入并返回**已解析的 JSON**（本模块不 spawn 进程；注入面存在是因为
 * 这把尺要能在没有 gh 的环境里被单测跑，也让"取不到"与"取到但为空"在接缝处就是两档）。
 * 404 与 403 动作不同：404＝该机制不存在（合法状态，记 note 后当空集）；403/其它＝取不到 ⇒ selfFault。
 */
function platformSets ({ fetcher, repo }) {
  if (typeof fetcher !== 'function') throw new Error('platformSets 需要 fetcher')
  if (!repo || typeof repo !== 'string') throw new Error('platformSets 需要 owner/repo（不写死在本仓，换仓/换 fork 会指错地方）')
  const out = { union: [], selfFault: null, notes: [], sources: { classic: [], rulesets: [] } }
  const seen = new Set()

  let classic
  try {
    classic = fetcher(['repos/' + repo + '/branches/main/protection'])
  } catch (e) {
    if (isNotFound(e)) { out.notes.push('classic protection 不存在（404）⇒ 该机制为空'); classic = null }
    else { out.selfFault = 'classic protection 取不到：' + msgOf(e); return out }
  }
  out.sources.classic = contextsFromProtection(classic)

  let list
  try {
    list = fetcher(['repos/' + repo + '/rulesets'])
  } catch (e) {
    if (isNotFound(e)) { out.notes.push('rulesets 列表为空/不存在（404）⇒ 该机制为空'); list = [] }
    else { out.selfFault = 'rulesets 列表取不到：' + msgOf(e); return out }
  }
  if (!Array.isArray(list)) { out.selfFault = 'rulesets 列表返回的不是数组，无法逐个按 id 取详情'; return out }
  for (const rs of list) {
    if (!rs || typeof rs.id !== 'number') { out.selfFault = 'rulesets 列表里有条目没有数字 id：' + JSON.stringify(rs); return out }
    let one
    try {
      one = fetcher(['repos/' + repo + '/rulesets/' + rs.id])
    } catch (e) {
      if (isNotFound(e)) { out.notes.push('ruleset ' + rs.id + ' 详情 404 ⇒ 跳过'); continue }
      out.selfFault = 'ruleset ' + rs.id + ' 详情取不到：' + msgOf(e); return out
    }
    const ctxs = contextsFromRuleset(one)
    out.sources.rulesets.push({ id: rs.id, name: typeof rs.name === 'string' ? rs.name : '', contexts: ctxs })
  }

  const all = out.sources.classic.slice()
  for (const r of out.sources.rulesets) all.push(...r.contexts)
  for (const c of all) if (c && !seen.has(c)) { seen.add(c); out.union.push(c) }
  if (out.union.length === 0) out.notes.push('平台并集为空（两套机制都没读到任何 required 上下文）')
  return out
}

function msgOf (e) { return (e && (e.stderr || e.message)) || String(e) }
function isNotFound (e) { return /404|Not Found/i.test(msgOf(e)) }
function contextsFromProtection (obj) {
  if (!obj || typeof obj !== 'object') return []
  const rsc = obj.required_status_checks
  return rsc && Array.isArray(rsc.contexts) ? rsc.contexts.filter((c) => typeof c === 'string' && c) : []
}
function contextsFromRuleset (obj) {
  const rules = obj && Array.isArray(obj.rules) ? obj.rules : []
  const out = []
  for (const r of rules) {
    const list = r && r.parameters && Array.isArray(r.parameters.required_status_checks) ? r.parameters.required_status_checks : []
    for (const item of list) {
      const ctx = typeof item === 'string' ? item : item && item.context
      if (typeof ctx === 'string' && ctx) out.push(ctx)
    }
  }
  return out
}

module.exports = {
  TRIGGER_NAMES,
  RUN_WINDOW,
  MAX_SCAN,
  MAX_DEBT,
  REGISTRY_REL,
  DEBT_REL,
  deriveWorkflowChecks,
  producersOf,
  readRegistry,
  readDebt,
  validateDebt,
  classifyWindow,
  judgePresence,
  judge,
  platformSets,
}
