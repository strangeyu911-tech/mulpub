#!/usr/bin/env node
'use strict'

/**
 * required 清单对账面 + 「恒 skipped」探测的 CLI 档。
 *
 * 本体一行判定逻辑都不写：全部在 `scripts/lib/required-checks.js`（可注入、可单测）。
 * 本文件只做四件事：解析参数、注入 `gh` 取数、把五档读数打成现场可复算的文本、给退出码。
 *
 * 三条口径：
 * ① **spawn 一律 argv 数组、`shell: false`**：外部输入（`--repo=`、workflow 文件名）只作为参数元素
 *    出现，永远不拼进 shell 命令串。所以这里不存在命令注入面，`gh` 收到的 endpoint 也不会被二次解释。
 * ② **`--repo=` 的形态白名单作用在"解析后的值"上**，不只看旗标 —— 默认档要从 gh 自己取仓库名，
 *    只校验旗标等于给默认路径开后门。白名单还须挡住"整段是点"的形态（`..`）：注入面已被
 *    shell:false 挡住，但 endpoint 指向哪一段仍可被输入改写，而本锁的身份是对账面。
 * ③ **advisory 恒 rc=0，但绝不打印"全部合规"**：本刀读的是平台状态，runner 侧 gh 瞬断与令牌scope 不足
 *    都是真实存在的新失败面；把它们混进"合规"就是装饰性门禁。取不到数一律 `UNPROVEN` 并点名缺哪一步。
 * ④ **每次 `gh api` 带硬超时、且不自动重试**：挂死的 gh 会吃掉整个作业预算；重试则是把"这一轮没取到数"
 *    用更多时间换一个不确定的读数，而本锁的动作出口本来就要求"没取到 ⇒ 未证实"，重试只是在掩盖它。
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const RC = require('./lib/required-checks.js')

// 仓库标识的形态白名单。字符类里**含点**是必要的（`my.repo` 是合法仓库名），
// 但因此必须另外挡住"整段是点"的形态：`..` 逐字符都合法，而它拼进 endpoint 之后
// 改指的是**另一个 API 段**（`repos/a/..`）——注入面早就被 shell:false 挡住了，
// 这一格要防的是"取的是哪个端点"被输入改写，与本锁"对账面"的身份不相容。
// 段首段尾必须是非点字符 ⇒ `.` / `..` / `.foo` 全进不来；段内的点照常放行。
const SEG = '[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?'
const REPO_SHAPE = new RegExp('^' + SEG + '/' + SEG + '$')
const EVENTS = new Set(['push', 'pull_request'])

/**
 * 单次 `gh api` 的硬超时（毫秒）。默认 20s：本机实测一次完整判据跑约 65 秒 / 45 次调用，
 * 单次 20s 足够宽，又保证"挂死的 gh"不会吃掉整个作业预算。
 * 可经 MP_REQCHECK_GH_TIMEOUT_MS 覆盖（排障用），非法值回落默认**并出声**——
 * 静默回落等于让"我明明设了 5000"这件事永远查不出来。
 */
const GH_TIMEOUT_MS = 20000
const GH_TIMEOUT_ENV = 'MP_REQCHECK_GH_TIMEOUT_MS'
let ghTimeoutNoticeSent = false
function ghTimeoutMs (env) {
  const raw = env && env[GH_TIMEOUT_ENV]
  if (raw === undefined || raw === '') return GH_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1000 || n > 120000) {
    if (!ghTimeoutNoticeSent) {
      ghTimeoutNoticeSent = true
      console.warn('[required-checks] ' + GH_TIMEOUT_ENV + '=' + raw + ' 非法（须为 1000..120000 的整数毫秒），按默认 ' + GH_TIMEOUT_MS + ' 走')
    }
    return GH_TIMEOUT_MS
  }
  return n
}

function parseArgs (argv) {
  const opts = { repo: null, report: false, json: false, mode: 'advisory', help: false }
  const unknown = []
  for (const a of argv) {
    if (a === '--report') { opts.report = true; continue }
    if (a === '--json') { opts.json = true; opts.report = true; continue }
    if (a === '--help' || a === '-h') { opts.help = true; continue }
    if (a.startsWith('--repo=')) { opts.repo = a.slice(7); continue }
    if (a.startsWith('--mode=')) {
      const m = a.slice(7)
      if (m !== 'advisory' && m !== 'enforce') throw new Error('非法 --mode=' + m + '（只认 advisory|enforce）')
      opts.mode = m
      continue
    }
    unknown.push(a)
  }
  if (unknown.length) throw new Error('未知旗标：' + unknown.join(' ') + '（本判据只认 --repo= --mode= --report --json）')
  return opts
}

/**
 * 唯一的 spawn 出口：argv 数组、不经 shell、stdout 当 JSON 解析、非零一律抛错（错误文本含 stderr）。
 * `spawn` 可注入 —— 这条接缝存在是为了让"不经 shell、输入只占一个参数元素"这件事**能被测**，
 * 而不是只能靠读源码字符串相信它（本仓把"记录性断言"当装饰性门禁的同型教训已不止一次）。
 */
function ghJson (args, spawnImpl) {
  const run = spawnImpl || spawnSync
  const ms = ghTimeoutMs(process.env)
  const r = run('gh', ['api', ...args], { encoding: 'utf8', shell: false, timeout: ms, maxBuffer: 64 * 1024 * 1024 })
  // 两支文案必须分开：本机实测（Node v22.23.1、shell:false）超时与"没装"这两档的
  // status 都是 null、stderr 都是空，**唯一可分辨的就是 error.code**。
  // 合成一句"gh 不可用"会把"这一轮取数挂了"指使人去重装 gh——动作对象完全不同。
  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') throw new Error('gh 取数超时（>' + ms + ' ms，' + GH_TIMEOUT_ENV + ' 可覆盖）：' + args[0])
    throw new Error('gh 不可用（' + r.error.code + '）：没装或不在 PATH')
  }
  if (r.status !== 0) throw new Error(String(r.stderr || '').trim().slice(0, 300) + ' (gh rc=' + r.status + ')')
  try {
    return JSON.parse(r.stdout)
  } catch (e) {
    throw new Error('gh api 返回不可解析（' + args[0] + '）：' + e.message)
  }
}

function resolveRepo (explicit, fetch) {
  const value = explicit || String(fetch(['repos/{owner}/{repo}']).full_name || '')
  if (!REPO_SHAPE.test(value)) {
    throw new Error('仓库标识不符合 owner/name 形态：' + JSON.stringify(value) + '（校验作用在解析后的值上，默认档同样过闸）')
  }
  return value
}

/** 取该 producer workflow 的窗口：扫 MAX_SCAN 条最近 run，只留 push/PR 事件，取最新 RUN_WINDOW 条。 */
function windowFor (repo, workflow, cache, fetch) {
  if (cache.has(workflow)) return cache.get(workflow)
  let w
  try {
    const list = fetch(['repos/' + repo + '/actions/workflows/' + encodeURIComponent(workflow) + '/runs?per_page=' + RC.MAX_SCAN])
    const all = Array.isArray(list.workflow_runs) ? list.workflow_runs : []
    const matched = all.filter((r) => r && EVENTS.has(r.event))
    const picked = matched.slice(0, RC.RUN_WINDOW)
    const runs = []
    for (const run of picked) {
      const jobs = fetch(['repos/' + repo + '/actions/runs/' + run.id + '/jobs'])
      const map = {}
      for (const j of (Array.isArray(jobs.jobs) ? jobs.jobs : [])) {
        if (j && typeof j.name === 'string' && j.name) map[j.name] = j.conclusion === undefined ? null : j.conclusion
      }
      runs.push({ id: run.id, event: run.event, status: run.status, created: run.created_at, jobs: map })
    }
    w = { workflow, runs, fetched: true, scanned: all.length, lastRun: matched[0] ? matched[0].created_at : (all[0] ? '(最近一条是 ' + all[0].event + ')' : '(该 workflow 没有任何 run)') }
  } catch (e) {
    w = { workflow, runs: null, fetched: false, scanned: 0, error: e.message }
  }
  cache.set(workflow, w)
  return w
}

/**
 * 判据自身取不到数的出口 —— 是否阻断由 mode 决定，不得恒 2。
 *
 * 动因是首档 CI 现场（run 40621967491 / job 122597885269）：那一步没接 GH_TOKEN，gh 直接 rc=4，
 * 判据走本出口返回 2，而 run 块是 `bash -e -o pipefail` ⇒ 整步中止 ⇒ 本 PR 的 required 红，
 * 并连带把后面 21 个 gate 全读成 skipped ——「这条判据到底跑没跑」这个唯一证据源被它自己掐掉了。
 * advisory 的语义是"不阻断任何 PR"，出声是它的义务，所以这里打印 verdict=SELF_FAULT rc=2 但返回 0。
 * （命令行本身打错的那一格不走这里：那时 mode 无从得知，见 main 里的注释。）
 */
function selfFaultExit (out, opts, message) {
  out('REQUIRED-CHECKS SELF-FAULT: ' + message)
  if (opts && opts.mode === 'advisory') {
    out('MODE=advisory verdict=SELF_FAULT rc=2（不阻断；判据自身取不到数不是本次变更的问题。' +
        '转 enforce 的前置条件见 openspec/changes/required-checks-ledger/design.md D6）')
    return 0
  }
  return 2
}

function main (argv, deps) {
  const d = deps || {}
  const fetch = d.fetch || ghJson
  const root = d.repoRoot || path.join(__dirname, '..')
  const out = d.log || ((s) => console.log(s))

  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    // 这一档刻意**不**走 selfFaultExit：命令行打错时 mode 无从得知，按默认档放行
    // 等于把「我明明传了 --mode=enforce」读成「没传」。调用方写错，不是判据取不到数。
    out('REQUIRED-CHECKS SELF-FAULT: ' + e.message)
    return 2
  }
  if (opts.help) {
    out('用法：node scripts/check-required-checks.js [--repo=owner/name] [--mode=advisory|enforce] [--report] [--json]')
    out('退出码：0 合规 / 1 发现违规 / 2 判据自身取不到读数（三档不得混）。advisory 档恒 0 但照样打印 verdict。')
    return 0
  }

  let registry
  let debt
  let derived
  try {
    derived = RC.deriveWorkflowChecks(root)
    registry = RC.readRegistry(root)
    debt = RC.readDebt(root)
  } catch (e) {
    return selfFaultExit(out, opts, e.message)
  }

  let repo
  let platform
  try {
    repo = resolveRepo(opts.repo, fetch)
    platform = RC.platformSets({ fetcher: fetch, repo })
  } catch (e) {
    return selfFaultExit(out, opts, e.message)
  }

  const cache = new Map()
  const presence = {}
  for (const e of registry.required) {
    const producers = RC.producersOf(derived, e.context)
    presence[e.context] = RC.judgePresence({ windows: producers.map((p) => windowFor(repo, p.workflow, cache, fetch)) }, e.context)
  }

  const requiredNames = registry.required.map((e) => e.context)
  const debtViolations = RC.validateDebt({ debt, required: requiredNames, max: RC.MAX_DEBT }).violations
  const r = RC.judge({ derived, registry, platform, debt, debtViolations, presence })

  if (opts.json) {
    out(JSON.stringify({
      head: r.head, rc: r.rc, verdict: r.verdict, violations: r.violations, unproven: r.unproven,
      platform: platform.sources, platformNotes: platform.notes,
      presence: Object.fromEntries(Object.entries(presence).map(([k, v]) => [k, {
        form: v.form, runs: v.runs, detail: v.detail || null,
        windows: (v.windows || []).map((w) => ({ workflow: w.workflow, form: w.form, runs: w.runs, scanned: w.scanned === undefined ? null : w.scanned, lastRun: w.lastRun === undefined ? null : w.lastRun, error: w.error || null })),
      }])),
    }, null, 2))
  } else {
    out(r.head)
    for (const n of platform.notes || []) out('NOTE 平台侧: ' + n)
    if (opts.report) {
      for (const e of registry.required) {
        const p = presence[e.context] || { form: 'selfFault' }
        const producers = RC.producersOf(derived, e.context).map((x) => x.workflow + '#' + x.job).join(',') || '(无)'
        out('  ' + e.context + ' form=' + p.form + ' runs=' + (p.runs || 0) + ' producers=' + producers + (p.detail ? ' :: ' + p.detail : ''))
      }
    }
    for (const v of r.violations) out('VIOLATION ' + v)
    for (const u of r.unproven) {
      out('UNPROVEN ' + u)
      if (/403|Resource not accessible by integration/i.test(u)) {
        out('UNPROVEN-HINT 该档多半是 GITHUB_TOKEN 没有读分支保护/规则集的权限（缺 administration 档），' +
          '不是"平台没要求"。转 enforce 的前置条件 ⓪ 就是这一格必须能读到数。')
      }
    }
  }

  if (opts.mode === 'advisory') {
    out('MODE=advisory verdict=' + r.verdict + ' rc=' + r.rc + '（不阻断；转 enforce 的前置条件见 openspec/changes/required-checks-ledger/design.md D6）')
    return 0
  }
  out('MODE=enforce verdict=' + r.verdict + ' rc=' + r.rc)
  return r.rc
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { parseArgs, main, REPO_SHAPE, windowFor, resolveRepo, ghJson, ghTimeoutMs, GH_TIMEOUT_MS, GH_TIMEOUT_ENV }
