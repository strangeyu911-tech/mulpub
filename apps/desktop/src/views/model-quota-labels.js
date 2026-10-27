/**
 * 模型额度兜底的展示标签映射（纯函数，供设置卡片/弹窗复用）。
 * 只返回 i18n key，不在这里写用户文案；文案统一在 locales/model-quota/。
 */

export const STATE_LABEL_KEYS = Object.freeze({
  quota_exhausted: 'modelQuota.states.quota_exhausted',
  credential_invalid: 'modelQuota.states.credential_invalid',
  rate_limited: 'modelQuota.states.rate_limited',
  transient: 'modelQuota.states.transient',
  content_policy: 'modelQuota.states.content_policy',
  provider_error: 'modelQuota.states.provider_error',
  unknown: 'modelQuota.states.unknown',
  official_failed: 'modelQuota.states.official_failed',
})

export const REASON_LABEL_KEYS = Object.freeze({
  policy_ask: 'modelQuota.reasons.policy_ask',
  policy_official: 'modelQuota.reasons.policy_official',
  policy_byok: 'modelQuota.reasons.policy_byok',
  official_unavailable: 'modelQuota.reasons.official_unavailable',
  credential_ask_only: 'modelQuota.reasons.credential_ask_only',
  estimate_unknown: 'modelQuota.reasons.estimate_unknown',
  cap_exceeded: 'modelQuota.reasons.cap_exceeded',
  insufficient_credit: 'modelQuota.reasons.insufficient_credit',
  official_failed: 'modelQuota.reasons.official_failed',
  already_declined: 'modelQuota.reasons.already_declined',
  not_fallback_eligible: 'modelQuota.reasons.not_fallback_eligible',
  user_official: 'modelQuota.reasons.user_official',
  user_cancel: 'modelQuota.reasons.user_cancel',
  user_settings: 'modelQuota.reasons.user_settings',
  timeout: 'modelQuota.reasons.timeout',
})

export function stateLabelKey (state) {
  return STATE_LABEL_KEYS[state] || STATE_LABEL_KEYS.unknown
}

/**
 * @returns {string|null} 未知 reason 返回 null；调用方应省略该行或回落到
 * `stateLabelKey(failure.state)`，**不要**把 null 直接传给 `t()`。
 */
export function reasonLabelKey (reason) {
  return REASON_LABEL_KEYS[reason] || null
}
