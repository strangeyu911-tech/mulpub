// @ts-check
'use strict'
/**
 * provider-status.js — 视频 provider 的**运行态**投影（供面板显示）
 *
 * ## 为什么要有这一层
 *
 * PRD §3.2.5.3 缺陷③：provider 饱和（熔断）期间，面板**不得**显示「失败」或「0/N」
 * ⇒ 必须有一条「服务商繁忙」的可见状态 ⇒ 否则用户只看到「卡住不动」，不知道系统在等什么。
 *
 * ## 分层纪律（与 `provider-saturation.js` 呼应）
 *
 * - `provider-saturation.js`（适配器侧）：**检测**（是否饱和）+ **估计**（排空时间）；
 * - 本模块（出片侧）：把检测结果**投影成面板能直接消费的形状**；
 * - `auto-runner.js`：**动作**（停止派发 / 等待 / 判未提交）。
 *
 * ⚠ 三处**不得**各写一份口径 ⇒ 显示用的字段全部来自 `readSaturation()` 的同一份快照。
 */

const { readSaturation } = require('../adapters/_base/provider-saturation')

/**
 * provider 运行态投影。
 *
 * @param {string} providerId
 * @returns {{
 *   state: 'normal'|'saturated',
 *   pending: number,
 *   estimatedRecoveryMinutes: number,
 *   consecutiveClientTimeouts: number,
 *   timeoutRate: number
 * }}
 */
function describeProviderStatus (providerId) {
  const s = readSaturation(providerId)
  return {
    state: s.saturated ? 'saturated' : 'normal',
    pending: s.pendingEstimate,
    estimatedRecoveryMinutes: s.estimatedRecoveryMinutes,
    consecutiveClientTimeouts: s.consecutiveClientTimeouts,
    timeoutRate: s.timeoutRate,
  }
}

module.exports = { describeProviderStatus }
