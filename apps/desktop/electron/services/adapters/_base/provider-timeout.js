// @ts-check
'use strict'
/**
 * provider-timeout.js — 把「超时」拆成**两类**（2026-10-25 实测落地）
 *
 * ## 动因（PRD-FILM-AUTO-LONGFORM §3.2.5.2 缺陷 ②）
 *
 * 现状：`agnes-multimodal.js::_request` 与 `agnes-video.js::_request` 把
 * **客户端等待超时**与**连接层超时**混成同一个 `ERROR_CODES.TIMEOUT`，
 * 而视频提交的可重试判据里 `TIMEOUT` **在列**
 * ⇒ 每次客户端等待超时都会退避 20/30/45/60/60 秒后**再投一次**
 * ⇒ 每次重投都在「服务端仍在生成」的通道上再加一个请求 ⇒ **队列雪崩**。
 *
 * ## 实测形态（本仓沙箱 Node 实跑，2026-10-25；不是照抄文档）
 *
 * | 场景 | 抛出对象 | 关键字段 | `e.message` |
 * |---|---|---|---|
 * | **客户端等待超时**（我们自己的 AbortController 放弃） | `DOMException` | `name === 'AbortError'`、`code === 20`、**无 cause** | `"This operation was aborted"` |
 * | **连接层失败**（DNS/拒连/连接超时/对端断开） | `TypeError` | `cause.code ∈ {ENOTFOUND, ECONNREFUSED, ETIMEDOUT, UND_ERR_SOCKET, …}` | ⚠ **`"fetch failed"`** |
 *
 * ⭐ **两条由此得出的硬事实**：
 *
 * 1. **`e.message` 里永远没有 `ETIMEDOUT`** —— undici 把真实错误放进 `e.cause`，
 *    `e.message` 只是一句 `"fetch failed"`。
 *    ⇒ 现有代码的 `msg.includes('ETIMEDOUT')` **对 undici 永远匹配不到**
 *    ⇒ 连接层错误其实**从未**被识别成 `TIMEOUT`，而是掉进 `NETWORK_ERROR` 分支
 *    （行为上仍可重试，所以没炸；但**错误码是错的** ⇒ 「两类超时被混成一个码」的真实机制在此）。
 *    ⇒ **判据必须走 `e.cause`**（`cause.code` 与 `cause.message` 都要看）。
 *
 * 2. **客户端等待超时只能靠 `e.name === 'AbortError'` 识别** ——
 *    它没有 `cause`、没有 `ETIMEDOUT`、message 也不含 timeout 字样。
 *
 * ## 两条语义（本模块存在的理由）
 *
 * | 类 | 识别 | 语义 | 是否可立即重投 |
 * |---|---|---|---|
 * | `client-wait` | 我们自己的计时器放弃（`AbortError` 家族） | **请求已被受理，服务端很可能仍在生成** | ❌ **不可重投**（重投只会加长队列） |
 * | `connect` | TCP/DNS 层失败（请求**根本没到**） | 连接层错误 | ✅ **可重投** |
 *
 * ⚠ **不可判定时不要瞎猜**：分类不出来就返回 `null`，
 * 由调用方沿用既有行为（`NETWORK_ERROR`，可重试）——**不因为「分不清」就拒绝重试**，
 * 也不因为「分不清」就当成客户端超时（那会砍掉正常的网络重试）。
 */

/** 客户端等待超时（我们的 AbortController 放弃） */
const CLIENT_WAIT = 'client-wait'
/** 连接层失败（请求根本没到服务端） */
const CONNECT = 'connect'

/**
 * 连接层错误码白名单（来自 undici / Node 的 `cause.code`）。
 * ⚠ 只收**连接建立阶段**的错误；请求一旦发出（收到过响应头）就不算。
 */
const CONNECT_CODES = new Set([
  'ETIMEDOUT',        // TCP 连接超时
  'ESOCKETTIMEDOUT',  // socket 超时
  'ECONNREFUSED',     // 对端拒连
  'ECONNRESET',       // 连接被重置
  'ENOTFOUND',        // DNS 解析失败
  'EAI_AGAIN',        // DNS 临时失败
  'EHOSTUNREACH',     // 主机不可达
  'ENETUNREACH',      // 网络不可达
  'EPIPE',            // 管道关闭
  'UND_ERR_CONNECT_TIMEOUT', // undici：连接超时
  'UND_ERR_SOCKET',   // undici：对端关闭
])

/** 属于「超时」语义（而不只是「网络错误」）的连接层码 */
const CONNECT_TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
])

/**
 * 客户端等待超时的判定。
 *
 * 三个信号任一命中即成立（实测覆盖 Node 18/20/22 的 DOMException 与 undici 包装）：
 *   - `name === 'AbortError'`（DOMException，最常见）
 *   - `code === 'ABORT_ERR'`（部分实现）
 *   - `code === 20`（DOMException 的 legacy code，AbortError 的标准值）
 *
 * @param {any} e
 * @returns {boolean}
 */
function isClientWaitAbort (e) {
  if (!e || typeof e !== 'object') return false
  if (e.name === 'AbortError') return true
  const code = e.code
  if (code === 'ABORT_ERR' || code === 20 || code === '20') return true
  return false
}

/**
 * 连接层失败的判定：看 `cause.code` / `cause.message` / 自身的 `code`。
 * ⚠ **必须穿透 `cause`**：undici 把真实错误放在 `e.cause` 里，`e.message` 只是 `"fetch failed"`。
 *
 * @param {any} e
 * @returns {boolean}
 */
function isConnectFailure (e) {
  if (!e || typeof e !== 'object') return false
  // ① 自身带连接层码
  const own = String(e.code || '')
  if (CONNECT_CODES.has(own)) return true
  // ② cause 带连接层码（undici 的真实形态）
  const cause = e.cause
  if (cause && typeof cause === 'object') {
    const cc = String(cause.code || '')
    if (CONNECT_CODES.has(cc)) return true
    const cm = String(cause.message || '')
    if (/(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)/.test(cm)) return true
  }
  // ③ 自身 message（少数实现不包装 cause）
  const msg = String(e.message || '')
  if (/(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)/.test(msg)) return true
  return false
}

/**
 * 连接层错误里，哪些属于「超时」语义（→ 应报 `ERROR_CODES.TIMEOUT` 而不是 `NETWORK_ERROR`）。
 * @param {any} e
 * @returns {boolean}
 */
function isConnectTimeout (e) {
  if (!e || typeof e !== 'object') return false
  const own = String(e.code || '')
  if (CONNECT_TIMEOUT_CODES.has(own)) return true
  const cause = e.cause
  if (cause && typeof cause === 'object') {
    const cc = String(cause.code || '')
    if (CONNECT_TIMEOUT_CODES.has(cc)) return true
    const cm = String(cause.message || '')
    if (/(ETIMEDOUT|ESOCKETTIMEDOUT)/.test(cm)) return true
  }
  const msg = String(e.message || '')
  if (/(ETIMEDOUT|ESOCKETTIMEDOUT)/.test(msg)) return true
  return false
}

/**
 * 超时分类（主入口）。
 * @param {any} e 捕获到的错误对象
 * @returns {'client-wait'|'connect'|null} 分类；`null` = 不是超时类错误
 */
function classifyProviderTimeout (e) {
  if (isClientWaitAbort(e)) return CLIENT_WAIT
  if (isConnectFailure(e)) return CONNECT
  return null
}

/**
 * 这个错误是不是「客户端等待超时」⇒ **不可立即重投**。
 * @param {any} e
 * @returns {boolean}
 */
function isClientWaitTimeout (e) {
  return classifyProviderTimeout(e) === CLIENT_WAIT
}

/**
 * 从 ProviderError 上取超时类别。
 * 适配器把类别写进 `error.context.timeoutKind`（随 ProviderError 一起传）。
 * @param {any} error
 * @returns {'client-wait'|'connect'|null}
 */
function timeoutKindOf (error) {
  if (!error || typeof error !== 'object') return null
  const ctx = error.context
  if (ctx && typeof ctx === 'object') {
    const k = ctx.timeoutKind
    if (k === CLIENT_WAIT || k === CONNECT) return k
  }
  // 兼容：直接挂在错误对象上的写法
  const direct = error.timeoutKind
  if (direct === CLIENT_WAIT || direct === CONNECT) return direct
  return null
}

/**
 * 该错误是否**可以立即重投**。
 *
 * ⚠ 这是本模块最关键的一条判据：**客户端等待超时不可重投**。
 * （服务端很可能仍在生成 ⇒ 重投 = 在同一条通道上再加一个请求。）
 *
 * @param {any} error
 * @returns {boolean}
 */
function isRetryableTimeout (error) {
  return timeoutKindOf(error) !== CLIENT_WAIT
}

module.exports = {
  CLIENT_WAIT,
  CONNECT,
  CONNECT_CODES,
  CONNECT_TIMEOUT_CODES,
  isClientWaitAbort,
  isConnectFailure,
  isConnectTimeout,
  classifyProviderTimeout,
  isClientWaitTimeout,
  timeoutKindOf,
  isRetryableTimeout,
}
