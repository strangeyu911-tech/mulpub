/**
 * 采集契约层 —— 纯函数（不碰 Electron / DOM / 网络）
 *
 * 存在理由（2026-10-25，PR #4435 收尾轮取证）：
 *   采集通道要跑在**主进程**（`DataSyncService` 注册在 `core/container.setup.js:349`），
 *   而旧的 `_rpaFetchStats()` 走 `window.electronAPI` / `ipcRenderer`
 *   —— 两者只存在于渲染进程 ⇒ 主进程必然落空 ⇒ 落到「返回一组 0」的兜底。
 *   PR #4435 把兜底改成抛错（治住「假 0」），但真正的缺口是**采集通道从未存在**
 *   （`rpaFetchData` / `rpa:fetchData` 全仓只出现在注释里）。
 *
 *   这一层把「页面里跑出来的结果」翻译成**可判定的结论**，
 *   使主进程侧不必碰 DOM 也能对「取到了 / 没取到 / 取坏了」做区分，
 *   并且**能区分「页面还没就绪」与「选择器过期」**（后者是平台改版，后者是慢）。
 *
 * 契约（采集脚本在页面里跑，返回给主进程）：
 *   成功      → { ok: true,  data: { <指标>: <非负有限数>, ... } }
 *   未就绪    → { ok: false, reason: 'not-ready' }              （页面还没渲染出容器 ⇒ 继续等）
 *   字段缺失  → { ok: false, reason: 'missing', field: '<名>' } （容器在但字段缺 ⇒ 选择器可能过期）
 *   其余形状  → 不合契约 ⇒ invalid（**不得**当成「没数据」静默放过）
 *
 * ⛔ 旧脚本返回**裸对象**（`{ views, followers }`）且字段用 `parseInt(x || '0')` 兜底
 *    ⇒ 契约层必须把它判为 invalid，而不是「收下这组数」。
 *    （`0` 与「缺失」必须可区分：0 是合法值，缺失是 invalid。）
 *
 * 契约说明与用例：`src/__tests__/collector-contract.test.js`
 */

/** 采集失败的错误码（主进程侧按此分型，渲染端据此显示不同原因） */
const COLLECT_ERRORS = {
  /** 页面始终没就绪（容器始终没出现） */
  NOT_READY: 'COLLECT_NOT_READY',
  /** 容器出现了但目标字段取不到（选择器可能已过期） */
  FIELD_MISSING: 'COLLECT_FIELD_MISSING',
  /** 取到了但不是合法数值（形状错 / 负数 / NaN / 非数） */
  VALUE_INVALID: 'COLLECT_VALUE_INVALID',
  /** 返回的平台与请求的平台不一致（拿错了账号或串了缓存） */
  PLATFORM_MISMATCH: 'COLLECT_PLATFORM_MISMATCH',
}

/** data 里**不是指标**的字段（标识符，不参与数值校验） */
const NON_METRIC_KEYS = ['platform']

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 「可展示的数」：必须是**有限非负数**。
 * ⚠️ 不能用 `Number.isFinite(Number(v))`：`Number(null)===0`、`Number('')===0`
 *    ⇒ 「缺失」会被折成 0（这正是 PR #4435 治掉的病）。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isCountableNumber (value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * 判读一次采集观测（页面里脚本的返回值）。
 *
 * @param {unknown} raw
 * @returns {{ok: true, data: Record<string, unknown>}
 *          | {ok: false, reason: 'not-ready'|'missing'|'invalid', retryable: boolean, field?: string}}
 */
function evaluateCollectorObservation (raw) {
  if (!isRecord(raw)) return { ok: false, reason: 'invalid', retryable: false }
  if (raw.ok === false) {
    if (raw.reason === 'not-ready') return { ok: false, reason: 'not-ready', retryable: true }
    if (raw.reason === 'missing') {
      return {
        ok: false,
        reason: 'missing',
        retryable: false,
        field: typeof raw.field === 'string' ? raw.field : undefined,
      }
    }
    // 采集脚本自报「值不可解析」（reason: 'invalid'）⇒ 同样点名字段，
    // 否则界面只能显示「值无效」，用户不知道是哪个指标出的问题。
    if (raw.reason === 'invalid') {
      return {
        ok: false,
        reason: 'invalid',
        retryable: false,
        field: typeof raw.field === 'string' ? raw.field : undefined,
      }
    }
    return { ok: false, reason: 'invalid', retryable: false }
  }
  // ⛔ raw.ok !== true（含**旧式裸对象** `{ views, followers }`）⇒ 不合契约 ⇒ invalid
  if (raw.ok !== true) return { ok: false, reason: 'invalid', retryable: false }

  const data = raw.data
  if (!isRecord(data)) return { ok: false, reason: 'invalid', retryable: false }
  const metricKeys = Object.keys(data).filter((k) => !NON_METRIC_KEYS.includes(k))
  if (metricKeys.length === 0) return { ok: false, reason: 'invalid', retryable: false }
  for (const key of metricKeys) {
    if (!isCountableNumber(data[key])) {
      return { ok: false, reason: 'invalid', retryable: false, field: key }
    }
  }
  return { ok: true, data: Object.assign({}, data) }
}

/**
 * 轮询到超时后，按**最后一次观测**给错误分类。
 *
 * 为什么用最后一次而不是第一次：页面可能先「容器都没出现」（not-ready）、
 * 后来「容器在了但字段取不到」（missing）—— 后者才是真正要报给用户的结论。
 *
 * @param {Array<{ok: boolean, reason?: string, field?: string}>} observations
 * @returns {{code: string, reason: string, field?: string}}
 */
function classifyCollectorTimeout (observations) {
  const list = Array.isArray(observations) ? observations : []
  if (list.length === 0) {
    return { code: COLLECT_ERRORS.NOT_READY, reason: 'no-observation' }
  }
  const last = list[list.length - 1]
  if (!last || last.ok === true) {
    // 有成功观测却仍走到超时分类 ⇒ 异常路径，保守按「取到了坏数据」报
    return { code: COLLECT_ERRORS.VALUE_INVALID, reason: 'success-observation-at-timeout' }
  }
  if (last.reason === 'missing') {
    return {
      code: COLLECT_ERRORS.FIELD_MISSING,
      reason: 'field-missing',
      field: last.field,
    }
  }
  if (last.reason === 'invalid') {
    return { code: COLLECT_ERRORS.VALUE_INVALID, reason: 'value-invalid', field: last.field }
  }
  return { code: COLLECT_ERRORS.NOT_READY, reason: 'not-ready' }
}

/**
 * 平台归属校验：返回的 `platform` 与请求平台不一致 ⇒ 判失败。
 * （拿错账号 / 串了缓存都会这样；同名指标在错平台出现比不出现更危险。）
 *
 * @param {string} platform - 请求的平台
 * @param {unknown} data - 采集返回的 data
 * @returns {{ok: true} | {ok: false, code: string, expected?: string, actual?: unknown}}
 */
function assertCollectorPlatform (platform, data) {
  if (!isRecord(data)) {
    return { ok: false, code: COLLECT_ERRORS.VALUE_INVALID }
  }
  const actual = data.platform
  if (actual === undefined || actual === null) return { ok: true }
  if (typeof actual === 'string' && actual === platform) return { ok: true }
  return { ok: false, code: COLLECT_ERRORS.PLATFORM_MISMATCH, expected: platform, actual }
}

/**
 * 节流判定：距上次采集未达最小间隔 ⇒ 不发起请求（**零请求**）。
 *
 * ⚠️ 非法时间戳（NaN / 非数）⇒ 视为「从未采集过」⇒ 允许采集：
 *    静默跳过会把「时间戳坏了」读成「不需要采」，数据永远停在旧值。
 *
 * @param {number|string|null|undefined} lastCollectedAtMs
 * @param {number} nowMs
 * @param {number} minIntervalMs - 最小间隔（0 = 关闭节流）
 * @returns {boolean}
 */
function isCollectDue (lastCollectedAtMs, nowMs, minIntervalMs) {
  const rawInterval = Number(minIntervalMs)
  const interval = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 0
  if (interval === 0) return true
  if (lastCollectedAtMs === null || lastCollectedAtMs === undefined) return true
  const last = Number(lastCollectedAtMs)
  if (!Number.isFinite(last)) return true
  const now = Number(nowMs)
  if (!Number.isFinite(now)) return true
  // ⛔ 时钟回拨（now <= last）⇒ 允许采集。
  //   按 (now-last) >= interval 判 ⇒ 恒假 ⇒ 该平台**永远不再采集**（数据停在旧值），
  //   而界面上看不出任何异常（只是数字不再更新）。时间戳异常时重新采一次是安全侧。
  if (now <= last) return true
  return (now - last) >= interval
}

module.exports = {
  COLLECT_ERRORS,
  evaluateCollectorObservation,
  classifyCollectorTimeout,
  assertCollectorPlatform,
  isCollectDue,
}
