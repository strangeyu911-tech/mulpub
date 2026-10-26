'use strict'
/**
 * model-quota-policy.js — 模型额度兜底的产品级决策器（P1b，纯函数）。
 *
 * 只回答「这次额度失败应该怎么走」：
 *   - use_official：policy=official、官方可用、预估 ≤ cap、余额足够；
 *   - ask：需要用户选择（默认 ask / credential 永远 ask / 预估未知或超 cap）；
 *   - stop：不该兜底（byok 档、官方不可用、余额不足、已拒绝、不可兜底状态）；
 *   - retry_later：限流/瞬时错误，走原有重试。
 *
 * 不读写 store、不发 IPC、不落检查点；这些由 coordinator 负责。
 */

const POLICY = Object.freeze({
  ASK: 'ask',
  OFFICIAL: 'official',
  BYOK: 'byok',
})

const DEFAULT_CAP = 500
const MIN_CAP = 1
const MAX_CAP = 100000

function normalizePolicy (value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === POLICY.ASK || raw === POLICY.OFFICIAL || raw === POLICY.BYOK) {
    return { value: raw, valid: true, reason: 'ok' }
  }
  return { value: POLICY.ASK, valid: false, reason: 'invalid' }
}

function normalizeCap (value) {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value)
  if (!Number.isInteger(num) || num < MIN_CAP || num > MAX_CAP) {
    return { value: DEFAULT_CAP, valid: false, reason: 'invalid' }
  }
  return { value: num, valid: true, reason: 'ok' }
}

function makeDecision (action, reason) {
  return {
    action,
    reason,
    showDialog: action === 'ask',
    messageKey: `modelQuota.reason.${reason}`,
  }
}

/**
 * @param {object} args
 * @param {{state:string, fallbackEligible?:boolean}} args.failure
 * @param {'ask'|'official'|'byok'} args.policy
 * @param {{available:boolean, balance?:number|null}} args.officialStatus
 * @param {{credits:number|null}} args.estimate
 * @param {number} args.cap
 * @param {{source:string, officialAttempts?:number}|null} [args.runOverride]
 * @param {boolean} [args.alreadyDeclined]
 */
function resolveModelQuotaAction ({
  failure,
  policy,
  officialStatus,
  estimate,
  cap,
  runOverride = null,
  alreadyDeclined = false,
} = {}) {
  const normalizedPolicy = normalizePolicy(policy).value
  const normalizedCap = normalizeCap(cap).value

  // 1. 官方调用本身失败 → 停止，不循环
  if (failure && failure.state === 'official_failed') return makeDecision('stop', 'official_failed')

  // 2. 不可兜底状态：限流/瞬时走重试；内容/供应商/未知直接停
  if (!failure || failure.fallbackEligible !== true) {
    if (failure && (failure.state === 'rate_limited' || failure.state === 'transient')) {
      return makeDecision('retry_later', 'not_fallback_eligible')
    }
    return makeDecision('stop', 'not_fallback_eligible')
  }

  // 3. 本 run 已经尝试过官方且仍失败 → 不再循环
  if (runOverride && Number(runOverride.officialAttempts) >= 1) {
    return makeDecision('stop', 'official_failed')
  }

  // 4. 同一 run 已经拒绝过 → 不再重复问
  if (alreadyDeclined === true) return makeDecision('stop', 'already_declined')

  // 5. 用户明确选择只使用 BYOK
  if (normalizedPolicy === POLICY.BYOK) return makeDecision('stop', 'policy_byok')

  // 6. 官方不可用（未登录/无权益/未配置/无价卡/余额不可读）
  if (officialStatus == null || officialStatus.available !== true) {
    return makeDecision('stop', 'official_unavailable')
  }

  // 7. 凭据错误永远询问（即使 policy=official）——安全关键
  if (failure.state === 'credential_invalid') {
    return makeDecision('ask', 'credential_ask_only')
  }

  // 8. 预估未知 → 不自动切；null/undefined/空串不能被 Number() 当成 0
  const rawCredits = estimate && estimate.credits
  const credits = rawCredits === null || rawCredits === undefined || rawCredits === ''
    ? null
    : Number(rawCredits)
  if (credits === null || !Number.isFinite(credits)) return makeDecision('ask', 'estimate_unknown')

  // 9. 预估超任务上限 → 降级为询问
  if (credits > normalizedCap) return makeDecision('ask', 'cap_exceeded')

  // 10. 余额不足 → 停止（不自动切）
  if (officialStatus.balance != null && Number(officialStatus.balance) < credits) {
    return makeDecision('stop', 'insufficient_credit')
  }

  // 11. policy=official 且全部条件满足 → 自动切官方
  if (normalizedPolicy === POLICY.OFFICIAL) return makeDecision('use_official', 'policy_official')

  // 12. 默认 ask
  return makeDecision('ask', 'policy_ask')
}

module.exports = {
  POLICY,
  DEFAULT_CAP,
  MIN_CAP,
  MAX_CAP,
  normalizePolicy,
  normalizeCap,
  resolveModelQuotaAction,
}
