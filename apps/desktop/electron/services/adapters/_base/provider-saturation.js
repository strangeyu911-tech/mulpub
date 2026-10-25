// @ts-check
'use strict'
/**
 * provider-saturation.js — 视频 provider 的**饱和度**观测与队列排空估计
 * （PRD-FILM-AUTO-LONGFORM §3.2.5.2 缺陷 ①③）
 *
 * ## 为什么需要它（动因来自 M0 取证实测，见
 * `01-docs/evidence/film-auto-m0-evidence-2026-10-24/M0-取证实测结果-F1-F2-F3.md`）
 *
 * ① **批内并发 2 × 串行 provider**：实测「成功提交之间的时间重叠率 **0/6**（近窗口）」
 *    ⇒ provider 近似**互斥受理** ⇒ 第二个请求只是在 provider 队列里**排队**
 *    ⇒ 撞上我们 120s 的客户端等待上限 ⇒ 抛超时。
 * ④ **客户端超时「放弃」≠ 服务端停止**：请求变成留在 provider 队列里的「**幽灵请求**」，
 *    仍占着串行受理通道；重投再叠一层 ⇒ 实测「**单镜最多往队列里投 78 个请求**」
 *    ⇒ 队列被自己灌满 ⇒ 退火 120s 后仍然零成功。
 *
 * ⇒ 本模块提供两件事：
 *   1. **饱和检测**（连续客户端超时 / 近窗口超时率）；
 *   2. **队列排空时间估计**（滞留请求数 × 单请求平均服务时间）—— **不得写死常数**。
 *
 * ## 三条口径纪律
 *
 * 1. ⚠️ **本模块只做「观测 + 估计」，不做「决策」**：
 *    检测在**适配器侧**（那里才知道错误类别，见 `provider-timeout.js`），
 *    动作（熔断 / 等待 / 停止派发）在**批执行器侧**（那里才知道该不该派发）。
 * 2. ⚠️ **排空时间是估计值**：只能用「滞留请求数 × 单请求平均服务时间」推。
 *    实测口径：102 个幽灵请求 × **26.6s** ≈ **45 分钟**才排空
 *    ⇒ 固定 90–120s 退火**恢复不了**（实测退火 120s 后仍零成功）。
 * 3. ⚠️ **窗口有界**：只看最近 N 次提交 + 最近 T 分钟 ⇒
 *    半小时前的客户端超时不该继续让今天的批次熔断。
 *
 * ## 「单请求平均服务时间」用哪个数（口径必须钉死）
 *
 * 实测（M0 取证，`model_provider_logs` 最近 215 次 `generateVideo`）：
 * 成功请求耗时分布 `<20s` 66 条、`20-50s` 21 条、`50-95s` 10 条、`95-120s` 9 条、`>=120s` 6 条
 * ⇒ **中位数 725ms**（提交即返回、生成异步轮询）、**P90 95.7s**、**最大 218.5s**、**均值 26.6s**。
 *
 * ⇒ 排空估计**用均值 26.6s**（与「102 × 26.6s ≈ 45 分钟」这条实测结论同源）。
 * ⚠️ **不用中位数 725ms**：那是「提交往返」的快路径，provider 忙时提交要排队 ⇒ 会严重低估。
 * ⚠️ **不用 P90 95.7s**：会高估 3.6 倍 ⇒ 白等。
 */

const { CLIENT_WAIT } = require('./provider-timeout')

/** 近窗口保留的提交条数（PRD：近 20 次） */
const WINDOW_SIZE = 20
/** 窗口的最长有效期（毫秒）—— 超过就不算「近窗口」 */
const WINDOW_MAX_AGE_MS = 30 * 60 * 1000
/** 连续客户端超时达到该次数 ⇒ 判饱和 */
const CONSECUTIVE_THRESHOLD = 3
/** 近窗口客户端超时占比达到该值 ⇒ 判饱和 */
const RATE_THRESHOLD = 0.5
/** 成功提交耗时的滚动平均样本数 */
const DURATION_SAMPLE_SIZE = 20
/**
 * 「滞留请求」的**过期阈值**口径（毫秒）。
 *
 * ## 为什么需要它（2026-10-25 独立复核抓到的阻断缺陷）
 *
 * 「客户端等待超时」= 客户端放弃了、**服务端可能还在做** ⇒ 这是一条**滞留**请求。
 * ⇒ 它**不会因为时间流逝而消失，但服务端会把它做完** ⇒ 过一段时间它就不再是「滞留」。
 *
 * ⚠ **原设计把「滞留」和「速率」混成了一个量**：滞留数取自「近 20 条窗口」⇒
 *   ① 被窗口封顶 ⇒ 「102 条滞留 ≈ 45 分钟」这个实测结论**永远算不出来**（最多 8.9 分钟）；
 *   ② 窗口内容在熔断等待期间**完全不变**（熔断时不派发 ⇒ 没有新记录）
 *      ⇒ 「等完再重新判定」永远判成「仍饱和」⇒ **等待纯空转**、剩余镜头全灭、恢复提示永不出现。
 *
 * ⇒ **拆成两个量**：
 *   - **速率视角**（窗口：近 20 条 + 30 分钟）⇒ 只用于**超时率**判据；
 *   - **累积视角**（本轮所有「未过期」的客户端超时）⇒ 用于**滞留数与排空估计**。
 *
 * ## 过期阈值怎么取
 *
 * 单条滞留请求在服务端的**剩余时间**上界 ≈ 该 provider 的单请求服务时间。
 * 实测分布：均值 26.6s / **P90 95.7s** / 最大 218.5s。
 * ⇒ 阈值取「2 × 观测均值」，并夹在 [53.2s（2×实测均值）, 218.5s（实测最大）] 之间
 *   ⇒ provider 变慢时阈值跟着涨（不会过早判「已恢复」）。
 */
const EXPIRY_MIN_MS = 53200
const EXPIRY_MAX_MS = 218500
const EXPIRY_FACTOR = 2
/** 累计滞留记录的上限（防无界增长；过期记录会被剪掉） */
const PENDING_HISTORY_MAX = 2000
/**
 * 兜底的「单请求平均服务时间」。
 * ⚠️ 取实测**均值 26.6s**（与「102 × 26.6s ≈ 45 分钟」同源），不是中位数 725ms、也不是 P90 95.7s。
 */
const DEFAULT_AVG_SERVICE_MS = 26600
/** 排空等待的下限（毫秒）—— 太短会让熔断形同虚设 */
const MIN_DRAIN_MS = 15000
/** 排空等待的上限（毫秒）—— 单次等待封顶，避免无限挂起 */
const MAX_DRAIN_MS = 15 * 60 * 1000

/**
 * providerId → {
 *   outcomes:  近窗口的提交结果（速率视角；只用于超时率判据）
 *   durations: 成功提交耗时样本（用于算单请求服务时间）
 *   pending:   **累计**的客户端超时记录（累积视角；用于滞留数与排空估计）
 * }
 */
const windows = new Map()

function stateOf (providerId) {
  const key = String(providerId || '')
  if (!key) return null
  let st = windows.get(key)
  if (!st) {
    st = { outcomes: [], durations: [], pending: [] }
    windows.set(key, st)
  }
  // 兼容旧结构（热重载/测试里手搓的对象）
  if (!Array.isArray(st.pending)) st.pending = []
  if (!Array.isArray(st.durations)) st.durations = []
  if (!Array.isArray(st.outcomes)) st.outcomes = []
  return st
}

/**
 * 记录一次**视频提交尝试**的结果。
 *
 * ⚠️ 每次**尝试**都记（含重试）—— 因为「往队列里投了几个请求」正是要度量的东西。
 *
 * @param {string} providerId
 * @param {'client-wait'|'other'|'ok'} kind
 * @param {{durationMs?:number, now?:number}} [opts]
 */
function recordSubmitOutcome (providerId, kind, opts) {
  const st = stateOf(providerId)
  if (!st) return
  const o = opts || {}
  const at = Number.isFinite(Number(o.now)) ? Number(o.now) : Date.now()
  const normalized = kind === 'ok' ? 'ok' : (kind === CLIENT_WAIT ? CLIENT_WAIT : 'other')
  st.outcomes.push({ kind: normalized, at })
  // 只保留窗口内 + 最近 N 条（**速率视角**）
  const cutoff = at - WINDOW_MAX_AGE_MS
  st.outcomes = st.outcomes.filter((x) => x.at >= cutoff).slice(-WINDOW_SIZE)
  // ⭐ **累计视角**：客户端超时单独记一份（**不受窗口条数封顶**）⇒ 排空估计才可达
  //   「102 条滞留 ≈ 45 分钟」这个实测结论（否则最多只能算到 8.9 分钟）。
  if (normalized === CLIENT_WAIT) {
    st.pending.push({ at })
    if (st.pending.length > PENDING_HISTORY_MAX) {
      st.pending = st.pending.slice(-PENDING_HISTORY_MAX)
    }
  }
  // 成功提交的耗时样本（用于排空估计）
  const ms = Number(o.durationMs)
  if (normalized === 'ok' && Number.isFinite(ms) && ms > 0) {
    st.durations.push(ms)
    if (st.durations.length > DURATION_SAMPLE_SIZE) {
      st.durations = st.durations.slice(-DURATION_SAMPLE_SIZE)
    }
  }
}

/**
 * 读取当前饱和度快照（纯读，不改状态）。
 * @param {string} providerId
 * @param {number} [now]
 * @returns {{
 *   providerId: string, state: 'normal'|'saturated', saturated: boolean,
 *   consecutiveClientTimeouts: number, timeoutRate: number, windowSize: number,
 *   pendingEstimate: number, avgServiceMs: number,
 *   estimatedDrainMs: number, estimatedRecoveryMinutes: number
 * }}
 */
function readSaturation (providerId, now) {
  const key = String(providerId || '')
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const st = windows.get(key)
  if (!st) {
    return {
      providerId: key,
      state: 'normal',
      saturated: false,
      consecutiveClientTimeouts: 0,
      timeoutRate: 0,
      windowSize: 0,
      pendingEstimate: 0,
      pendingCumulative: 0,
      avgServiceMs: DEFAULT_AVG_SERVICE_MS,
      expiryMs: Math.min(EXPIRY_MAX_MS, Math.max(EXPIRY_MIN_MS, DEFAULT_AVG_SERVICE_MS * EXPIRY_FACTOR)),
      estimatedDrainMs: 0,
      estimatedRecoveryMinutes: 0,
    }
  }

  const durations = st.durations.filter((ms) => Number.isFinite(ms) && ms > 0)
  const avgServiceMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : DEFAULT_AVG_SERVICE_MS

  // ⭐ **过期阈值**：单条滞留请求在服务端大概率已完成的时刻。
  //   「2 × 观测均值」并夹在 [53.2s, 218.5s]（实测均值×2 与实测最大值）之间。
  const expiryMs = Math.min(EXPIRY_MAX_MS, Math.max(EXPIRY_MIN_MS, avgServiceMs * EXPIRY_FACTOR))

  const cutoff = at - WINDOW_MAX_AGE_MS
  // ⭐ **过期的客户端超时不再是「近期失败」**：服务端大概率已把它做完 ⇒ 它既不该算滞留，
  //   也不该继续拉高近窗口超时率 ⇒ 否则熔断等待后**永远**判成「仍饱和」（等待纯空转）。
  const recent = st.outcomes.filter((x) => (
    x.at >= cutoff && (x.kind !== CLIENT_WAIT || at - x.at < expiryMs)
  ))
  const windowSize = recent.length
  const clientWaits = recent.filter((x) => x.kind === CLIENT_WAIT)
  // **速率视角**：近窗口超时率（判据之一）
  const timeoutRate = windowSize > 0 ? clientWaits.length / windowSize : 0

  // ⭐ **累积视角**：滞留请求数 = **累计**且**未过期**的客户端超时次数。
  //   - 累计 ⇒ 不被「近 20 条」封顶 ⇒ 排空估计可达「102 条 ≈ 45 分钟」；
  //   - 未过期 ⇒ 随等待时间自然下降 ⇒ 熔断等待后**能真的判定为已恢复**
  //     （否则等待期间没有新记录 ⇒ 窗口内容不变 ⇒ 永远判成「仍饱和」⇒ 等待纯空转）。
  const livePending = st.pending.filter((x) => at - x.at < expiryMs)
  const pendingEstimate = livePending.length

  // 连续客户端超时（**只数未过期的**）：过期的那些「服务端大概率已经做完」，不该再算「连续失败」
  let consecutive = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].kind !== CLIENT_WAIT) break
    if (at - recent[i].at >= expiryMs) break
    consecutive++
  }

  // 饱和判定：**两条任一命中**（PRD §3.2.5.2）
  //   ① 连续客户端超时 ≥ N
  //   ② 近窗口超时率 ≥ 50%
  // ⚠ ② 需要窗口至少 N 条，否则「1 次超时 / 1 次成功」= 50% 会误判、
  //   「1 次超时 / 0 次其他」= 100% 也会误判 ⇒ 样本不足时只认 ①。
  const rateDecided = windowSize >= CONSECUTIVE_THRESHOLD
  const saturated = consecutive >= CONSECUTIVE_THRESHOLD || (rateDecided && timeoutRate >= RATE_THRESHOLD)

  const estimatedDrainMs = pendingEstimate > 0
    ? Math.min(MAX_DRAIN_MS, Math.max(MIN_DRAIN_MS, Math.round(pendingEstimate * avgServiceMs)))
    : 0

  return {
    providerId: key,
    state: saturated ? 'saturated' : 'normal',
    saturated,
    consecutiveClientTimeouts: consecutive,
    timeoutRate,
    windowSize,
    pendingEstimate,
    // 累计（未过期）的客户端超时总数 —— 与 `pendingEstimate` 同值，单独命名以便调用方表达意图
    pendingCumulative: pendingEstimate,
    avgServiceMs,
    expiryMs,
    estimatedDrainMs,
    estimatedRecoveryMinutes: estimatedDrainMs > 0 ? Math.max(1, Math.ceil(estimatedDrainMs / 60000)) : 0,
  }
}

/**
 * 清空某个 provider 的观测窗口（新任务开始 / 测试用）。
 * @param {string} providerId
 */
function resetProviderSaturation (providerId) {
  const key = String(providerId || '')
  if (!key) return
  windows.delete(key)
}

/** 清空全部（测试用）。 */
function resetAllProviderSaturation () {
  windows.clear()
}

module.exports = {
  WINDOW_SIZE,
  WINDOW_MAX_AGE_MS,
  CONSECUTIVE_THRESHOLD,
  RATE_THRESHOLD,
  DURATION_SAMPLE_SIZE,
  DEFAULT_AVG_SERVICE_MS,
  EXPIRY_MIN_MS,
  EXPIRY_MAX_MS,
  EXPIRY_FACTOR,
  PENDING_HISTORY_MAX,
  MIN_DRAIN_MS,
  MAX_DRAIN_MS,
  recordSubmitOutcome,
  readSaturation,
  resetProviderSaturation,
  resetAllProviderSaturation,
}
