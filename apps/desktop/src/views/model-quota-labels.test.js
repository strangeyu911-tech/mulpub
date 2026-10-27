import { describe, it, expect } from 'vitest'
import { stateLabelKey, reasonLabelKey, STATE_LABEL_KEYS, REASON_LABEL_KEYS } from './model-quota-labels'

describe('model-quota-labels', () => {
  it('7 个失败状态都有映射', () => {
    expect(Object.keys(STATE_LABEL_KEYS).sort()).toEqual([
      'content_policy', 'credential_invalid', 'official_failed', 'provider_error',
      'quota_exhausted', 'rate_limited', 'transient', 'unknown',
    ].sort())
  })

  it('未知状态回落到 unknown，不返回 undefined', () => {
    expect(stateLabelKey('mystery')).toBe('modelQuota.states.unknown')
    expect(stateLabelKey(undefined)).toBe('modelQuota.states.unknown')
  })

  it('已知状态返回对应 key', () => {
    expect(stateLabelKey('quota_exhausted')).toBe('modelQuota.states.quota_exhausted')
    expect(stateLabelKey('credential_invalid')).toBe('modelQuota.states.credential_invalid')
  })

  it('已知 reason 返回 key，未知 reason 返回 null', () => {
    expect(reasonLabelKey('cap_exceeded')).toBe('modelQuota.reasons.cap_exceeded')
    expect(reasonLabelKey('user_official')).toBe('modelQuota.reasons.user_official')
    expect(reasonLabelKey('mystery')).toBeNull()
    expect(reasonLabelKey(undefined)).toBeNull()
  })

  it('reason 映射覆盖决策器全部 reason', () => {
    for (const reason of [
      'policy_ask', 'policy_official', 'policy_byok', 'official_unavailable',
      'credential_ask_only', 'estimate_unknown', 'cap_exceeded', 'insufficient_credit',
      'official_failed', 'already_declined', 'not_fallback_eligible', 'user_official',
      'user_cancel', 'user_settings', 'timeout',
    ]) {
      expect(REASON_LABEL_KEYS[reason]).toBe(`modelQuota.reasons.${reason}`)
    }
  })
})
