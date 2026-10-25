/**
 * 看板新增区块的「IPC 信封 → 视图模型」转换（dash-full-entitlement）。
 *
 * 核心纪律：**三态必须分开** —— empty（合法无数据）/ error（取数失败）/
 * auth（不认识我）。前两种在界面上都表现为"空"，但含义相反：
 * 渲染成同一个空态，用户会把「功能坏了」读成「我还没发过东西」
 * （本项目既有教训：performance-loop.js 注释明写「把查询失败渲染成
 * 从未发布，用户不会报障」）。
 *
 * 这里全部是纯函数：不 import 任何 API，不做 IPC 调用，
 * 便于单测且不依赖 Electron 环境。
 */

/** 未登录门禁态。与 empty/error 并列，绝不退化成 0。 */
export const AUTH_GATE = 'auth'

const READY = 'ready'
const EMPTY = 'empty'
const ERROR = 'error'

/** 三态判定的唯一出口：门禁 > 错误 > 数据。顺序不可调换。 */
function gateOf(res) {
  if (!res) return ERROR
  if (res.code === -3 || res.errorCode === 'AUTH_REQUIRED') return AUTH_GATE
  if (res.code !== 0) return ERROR
  return null
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// ─── 账号健康度 ───────────────────────────────────────────────
const ACCOUNT_BAD_DISPLAY_LIMIT = 5

/**
 * @param {object} res accountBatchCheckLogin 的信封
 * @returns {{state:string, ok:number, bad:number, unknown:number, badAccounts:string[], badOverflow:number}}
 */
export function toAccountHealthModel(res) {
  // res 为 null/undefined 按「无数据」处理而非错误：IPC 不可用（浏览器环境、
  // preload 未就绪）是合法降级路径，不是取数失败。把它判成 error 会让
  // 用户在纯降级场景下看到"账号状态暂时无法获取"——那是谎。
  if (!res) return { state: EMPTY, ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 }
  const gate = gateOf(res)
  if (gate) return { state: gate, ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 }

  const rows = Array.isArray(res.data) ? res.data : []
  if (rows.length === 0) {
    return { state: EMPTY, ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 }
  }

  let ok = 0
  let bad = 0
  let unknown = 0
  const badAccounts = []
  for (const row of rows) {
    const status = String((row && row.status) || '').toLowerCase()
    if (status === 'ok' || status === 'online' || status === 'logged_in') {
      ok += 1
      continue
    }
    if (status === 'failed' || status === 'offline' || status === 'expired' || status === 'error') {
      bad += 1
      badAccounts.push(String((row && row.accountId) || ''))
      continue
    }
    // 除明确正常/异常外一律计 unknown：未知状态不得默认成"正常"
    // （把"没检测"渲染成"都正常"与把"失败"渲染成"没数据"是同一类谎）
    unknown += 1
  }

  return {
    state: READY,
    ok,
    bad,
    unknown,
    badAccounts: badAccounts.slice(0, ACCOUNT_BAD_DISPLAY_LIMIT),
    badOverflow: Math.max(0, badAccounts.length - ACCOUNT_BAD_DISPLAY_LIMIT),
  }
}

// ─── 发布队列 ─────────────────────────────────────────────────
/**
 * @param {object} statusRes getQueueStatus 信封
 * @param {object} historyRes getQueueHistory 信封
 * @returns {{state:string, running:number, pending:number, failed:number, failedTitles:string[]}}
 */
export function toQueueStatusModel(statusRes, historyRes) {
  // 任意一个被门禁挡住即 auth：半套数据比没有数据更难解释
  const gate = gateOf(statusRes) || gateOf(historyRes)
  if (gate) return { state: gate, running: 0, pending: 0, failed: 0, failedTitles: [] }

  // 两路都必须成功：不允许"状态有了、历史没有"当成功渲染
  if (gateOf(statusRes) === ERROR || gateOf(historyRes) === ERROR) {
    return { state: ERROR, running: 0, pending: 0, failed: 0, failedTitles: [] }
  }

  const s = (statusRes && statusRes.data) || {}
  const running = num(s.running)
  const pending = num(s.pending)

  const history = Array.isArray(historyRes && historyRes.data) ? historyRes.data : []
  const failedRows = history.filter((r) => String((r && r.status) || '').toLowerCase() === 'failed')
  const failedTitles = failedRows
    .map((r) => String((r && (r.title || r.articleTitle)) || ''))
    .filter(Boolean)
    .slice(0, 3)

  // 「没有进行中的任务」是合法空态，但仍要显示最近失败——
  // 失败数是历史信息，不因当前队列为空而消失
  const state = running === 0 && pending === 0 ? EMPTY : READY
  return { state, running, pending, failed: failedRows.length, failedTitles }
}

// ─── 题材表现榜（full 专属） ────────────────────────────────────
const UNKNOWN_LABEL = '—'

/**
 * @param {object} res listPatternPerformance 信封
 * @param {number} [limit] Top N
 * @returns {{state:string, rows:Array<{value:string, score:number}>}}
 */
export function toPatternBoardModel(res, limit = 5) {
  const gate = gateOf(res)
  if (gate) return { state: gate, rows: [] }

  const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : []
  if (items.length === 0) return { state: EMPTY, rows: [] }

  const rows = items
    .map((it) => ({
      value: String((it && it.value) || '').trim() || UNKNOWN_LABEL,
      score: num(it && it.engagement_score),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))

  return { state: READY, rows }
}

// ─── 各平台数据（2026-10-25 数据真实性修复）────────────────────────
/**
 * 唯一真源：发布记录（`dashboard:stats`）+ 作品回采（`performance:overview`）。
 *
 * ## 为什么不再用 `sync:cached`
 *
 * 旧数据源 `packages/shared-utils/src/data-sync.js` 在主进程里**永远返回常量 0**：
 * `DataSyncService._rpaFetchStats()` 走 `window.electronAPI` / `ipcRenderer`，
 * 两者都只存在于渲染进程，而该服务跑在主进程 ⇒ 必落兜底 `{articles:0, views:0, …}`，
 * 且被盖上 `syncedAt: now` 写进缓存 ⇒ 界面显示「0阅读 · 更新于 10:51」，
 * **看上去是刚采到的真数据，实际是常量**。（`rpa:fetchData` 这个 IPC 通道全仓不存在。）
 *
 * ## 三态纪律（沿用本文件既有约定）
 *
 * 每个指标是 `number`（真值，含真实的 0）还是 `null`（**没有这项数据**），
 * 二者必须能区分：
 *   · `number` → 界面显示数字（真实的 0 就显示 0）
 *   · `null`   → 界面显示「—」，**不得回落成 0**
 * 「没有数据」渲染成「0」会让用户把「没采到」读成「账号真的是 0」——
 * 这与本文件顶部「把查询失败渲染成从未发布，用户不会报障」是同一类谎。
 */

/**
 * 把 `dashboard:stats` 的 perPlatform、`performance:overview` 的 byPlatform
 * 与**可信的** `sync:cached` 记录合并成按平台分行的模型。
 *
 * ## 三个来源，三种口径，互不混淆
 *
 * | 槽位 | 来源 | 口径 |
 * |------|------|------|
 * | 作品 | `stats.perPlatform[p].total` | 发布记录：累计发布数 |
 * | 阅读 / 点赞 / 评论 | `perf.byPlatform[p]` | **作品级**：发布后回采的作品互动合计 |
 * | 粉丝 | 可信 `sync:cached` 记录 | **账号级**：平台粉丝数（账号维度指标） |
 *
 * 为什么粉丝单独来自 sync、而阅读/点赞/评论来自回采：
 * 回采拿的是**作品维度**的指标，账号粉丝数不在回采口径内；而 `sync:cached`
 * 拿的是**账号维度**的指标（粉丝/阅读/评论/点赞）。
 * 两套口径混在同一张卡片的同一个指标位上，用户读不出「这个数是账号的还是作品的」
 * —— 与其混同，不如按来源分开：作品级指标一律取回采，账号级指标（粉丝）取 sync。
 *
 * ## 「可信的 sync 记录」是什么
 *
 * `sync:cached` 的历史实现会写入占位记录 `{articles:0, views:0, …, _note:'RPA 不可用'}`
 * （主进程永远走不到 RPA，见文件头注），它被盖上 `syncedAt: now` 后
 * 在界面上显示成「0阅读 · 更新于 10:51」——**假数据**。
 * ⇒ 本模型只接受**既无 `error`、也无遗留 `_note` 标记**的记录；
 *   占位记录与失败记录一律不参与数字计算（但可用于「哪些平台同步失败」的提示）。
 *
 * @param {object} input
 * @param {object|null} [input.stats] dashboard:stats 的 data（perPlatform / total / …）
 * @param {object|null} [input.perf] performance:overview 的 data（byPlatform / totals / health）
 * @param {Array<object>} [input.syncRows] sync:cached 的记录数组（整包传入，逐条判定可信度）
 * @returns {{rows: Array<object>, hasData: boolean, syncFailed: number, syncTotal: number}}
 */
export function toPlatformDataModel (input) {
  const stats = (input && input.stats) || null
  const perf = (input && input.perf) || null
  const syncRows = (input && Array.isArray(input.syncRows)) ? input.syncRows : []

  const perPlatformStats = (stats && stats.perPlatform && typeof stats.perPlatform === 'object')
    ? stats.perPlatform
    : {}
  const perfRows = (perf && Array.isArray(perf.byPlatform)) ? perf.byPlatform : []
  const perfByPlatform = new Map()
  for (const row of perfRows) {
    if (row && typeof row.platform === 'string' && row.platform) {
      perfByPlatform.set(row.platform, row)
    }
  }

  // 可信 sync 记录：既没有 error，也没有遗留占位标记（判据见 trustedSyncRows）
  const trustedSync = trustedSyncRows(syncRows)
  const syncFailed = syncRows.length - trustedSync.size

  // 平台全集 = 发布记录出现过的 ∪ 回采有数据的 ∪ sync 记录过的
  const platforms = new Set([
    ...Object.keys(perPlatformStats),
    ...perfByPlatform.keys(),
    ...trustedSync.keys(),
  ])

  const lastCapturedAt = (perf && perf.health && typeof perf.health.lastCapturedAt === 'string')
    ? perf.health.lastCapturedAt
    : null

  const rows = [...platforms].sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0))).map((platform) => {
    const statRow = perPlatformStats[platform]
    const perfRow = perfByPlatform.get(platform)
    const syncRow = trustedSync.get(platform)
    return {
      platform,
      // 作品数：发布记录口径（累计发布）
      articles: statRow ? numOrNull(statRow.total) : null,
      // 互动指标：作品回采口径（每篇取最近一次采集）
      views: metricOf(perfRow, 'views'),
      likes: metricOf(perfRow, 'likes'),
      comments: metricOf(perfRow, 'comments'),
      favorites: metricOf(perfRow, 'favorites'),
      shares: metricOf(perfRow, 'shares'),
      interactions: metricOf(perfRow, 'interactions'),
      // 粉丝：账号级口径，只可能来自可信的 sync 记录
      fans: metricOf(syncRow, 'followers'),
      // 已回采作品数：说明「这个平台的数字覆盖了几篇」
      contents: perfRow ? numOrNull(perfRow.contents) : null,
      // 该平台是否拿到过账号级指标
      hasAccountMetrics: Boolean(syncRow),
      lastCapturedAt,
    }
  })

  return { rows, hasData: rows.length > 0, syncFailed, syncTotal: syncRows.length }
}

/**
 * 取一个数值字段：拿不到就 null（**不回落成 0**）。
 *
 * ⚠️ 判定必须是「类型 + 有限性」双条件：`Number(null)` 是 0、`Number('')` 也是 0
 * ⇒ 只判 `Number.isFinite(Number(v))` 会把「没有这项数据」变成**假 0**
 * （这正是本次要消灭的那类谎：界面显示 0，用户读成「真的是 0」）。
 */
function metricOf (row, key) {
  if (!row) return null
  return numOrNull(row[key])
}

/** 数值或 null。null / undefined / 非数字 / 非有限数 一律 null。 */
function numOrNull (value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

/**
 * 顶部 KPI 行的模型。
 *
 * 口径逐项标注（界面上必须能看出每个数字从哪来）：
 *   · published ← `dashboard:stats.total`（发布记录）
 *   · reads     ← `performance:overview.totals.views`（**作品级**：发布后回采）
 *   · comments  ← `performance:overview.totals.comments`（**作品级**：发布后回采）
 *   · fans      ← 可信 `sync:cached` 记录求和（**账号级**：平台粉丝数）
 *
 * 「作品级」与「账号级」在 KPI 行与平台卡片里**各自成对一致**：
 * 同一页面上「阅读」永远是作品口径、「粉丝」永远是账号口径，不出现同名不同义。
 *
 * @param {object} input
 * @param {object|null} [input.stats]
 * @param {object|null} [input.perf]
 * @param {Array<object>} [input.syncRows]
 * @returns {{published:number|null, reads:number|null, comments:number|null, fans:number|null}}
 */
export function toKpiModel (input) {
  const stats = (input && input.stats) || null
  const perf = (input && input.perf) || null
  const totals = (perf && perf.totals) || null
  const trusted = trustedSyncRows((input && input.syncRows) || [])

  // 账号级粉丝：只有拿到**可信**记录才有值；一个都没有 ⇒ null（界面显示「—」）
  let fansSum = 0
  let hasFans = false
  for (const row of trusted.values()) {
    const value = numOrNull(row.followers)
    if (value !== null) { fansSum += value; hasFans = true }
  }

  return {
    published: stats ? numOrNull(stats.total) : null,
    reads: metricOf(totals, 'views'),
    comments: metricOf(totals, 'comments'),
    fans: hasFans ? fansSum : null,
  }
}

/**
 * 挑出**可信**的 sync 记录：既没有 `error`，也没有遗留占位标记 `_note`。
 *
 * 为什么单列一个函数：KPI 行与平台卡片都要用这条判据，
 * 两处各写一遍就会口径分裂（历史上「看板是另一条紫路径」就是这么来的）。
 */
function trustedSyncRows (syncRows) {
  const trusted = new Map()
  for (const row of syncRows) {
    if (!row || typeof row.platform !== 'string' || !row.platform) continue
    if (row.error) continue
    if (row._note) continue // 遗留占位记录（恒 0），不可信
    trusted.set(row.platform, row)
  }
  return trusted
}
