// @vitest-environment node
'use strict'

const {
  POLICY,
  DEFAULT_CAP,
  resolveModelQuotaAction,
  normalizePolicy,
  normalizeCap,
} = require('./model-quota-policy')

function failure (state, fallbackEligible = true) {
  return { state, fallbackEligible, quotaKind: 'unknown' }
}

const officialOk = { available: true, reason: 'ok', balance: 1000, currency: 'credit' }
const estimate = { credits: 10 }

describe('model-quota-policy：12 条决策优先级', () => {
  it('1. official_failed → stop / official_failed', () => {
    expect(resolveModelQuotaAction({ failure: failure('official_failed'), policy: 'official', officialStatus: officialOk, estimate, cap: 500 }).reason).toBe('official_failed')
  })

  it('2a. rate_limited 不可兜底 → retry_later', () => {
    expect(resolveModelQuotaAction({ failure: failure('rate_limited', false), policy: 'official', officialStatus: officialOk, estimate, cap: 500 }).action).toBe('retry_later')
  })

  it('2b. transient 不可兜底 → retry_later', () => {
    expect(resolveModelQuotaAction({ failure: failure('transient', false), policy: 'official', officialStatus: officialOk, estimate, cap: 500 }).action).toBe('retry_later')
  })

  it('2c. content_policy / provider_error / unknown 不可兜底 → stop', () => {
    for (const state of ['content_policy', 'provider_error', 'unknown']) {
      expect(resolveModelQuotaAction({ failure: failure(state, false), policy: 'official', officialStatus: officialOk, estimate, cap: 500 }).action).toBe('stop')
    }
  })

  it('3. runOverride.officialAttempts >= 1 → stop / official_failed（不循环）', () => {
    const result = resolveModelQuotaAction({
      failure: failure('quota_exhausted'), policy: 'official', officialStatus: officialOk, estimate, cap: 500,
      runOverride: { source: 'official', officialAttempts: 1 },
    })
    expect(result.action).toBe('stop')
    expect(result.reason).toBe('official_failed')
  })

  it('4. alreadyDeclined → stop / already_declined', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'ask', officialStatus: officialOk, estimate, cap: 500, alreadyDeclined: true })
    expect(result.action).toBe('stop')
    expect(result.reason).toBe('already_declined')
  })

  it('5. policy byok → stop / policy_byok', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'byok', officialStatus: officialOk, estimate, cap: 500 })
    expect(result.action).toBe('stop')
    expect(result.reason).toBe('policy_byok')
  })

  it('6. official 不可用 → stop / official_unavailable', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'official', officialStatus: { available: false, reason: 'not_configured' }, estimate, cap: 500 })
    expect(result.action).toBe('stop')
    expect(result.reason).toBe('official_unavailable')
  })

  it('7. credential_invalid 永远 ask（即使 policy=official）', () => {
    const result = resolveModelQuotaAction({ failure: failure('credential_invalid'), policy: 'official', officialStatus: officialOk, estimate, cap: 500 })
    expect(result.action).toBe('ask')
    expect(result.reason).toBe('credential_ask_only')
    expect(result.showDialog).toBe(true)
  })

  it('8. estimate 为 null → ask / estimate_unknown', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'official', officialStatus: officialOk, estimate: { credits: null }, cap: 500 })
    expect(result.action).toBe('ask')
    expect(result.reason).toBe('estimate_unknown')
  })

  it('9. estimate 超 cap → ask / cap_exceeded', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'official', officialStatus: officialOk, estimate: { credits: 501 }, cap: 500 })
    expect(result.action).toBe('ask')
    expect(result.reason).toBe('cap_exceeded')
  })

  it('10. 余额不足 → stop / insufficient_credit', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'official', officialStatus: { ...officialOk, balance: 5 }, estimate, cap: 500 })
    expect(result.action).toBe('stop')
    expect(result.reason).toBe('insufficient_credit')
  })

  it('11. policy official + 余额足够 → use_official / policy_official', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'official', officialStatus: officialOk, estimate, cap: 500 })
    expect(result.action).toBe('use_official')
    expect(result.reason).toBe('policy_official')
    expect(result.showDialog).toBe(false)
  })

  it('12. 默认 ask → ask / policy_ask', () => {
    const result = resolveModelQuotaAction({ failure: failure('quota_exhausted'), policy: 'ask', officialStatus: officialOk, estimate, cap: 500 })
    expect(result.action).toBe('ask')
    expect(result.reason).toBe('policy_ask')
    expect(result.showDialog).toBe(true)
  })
})

describe('model-quota-policy：设置归一', () => {
  it('policy 非法值归一为 ask 并标记 invalid', () => {
    for (const value of [undefined, null, '', 'ASK', 123, {}]) {
      const result = normalizePolicy(value)
      expect(result.value).toBe(POLICY.ASK)
      expect(result.valid).toBe(false)
    }
    expect(normalizePolicy(' official ')).toEqual({ value: POLICY.OFFICIAL, valid: true, reason: 'ok' })
    expect(normalizePolicy('official')).toEqual({ value: POLICY.OFFICIAL, valid: true, reason: 'ok' })
    expect(normalizePolicy('byok')).toEqual({ value: POLICY.BYOK, valid: true, reason: 'ok' })
  })

  it('cap 非法值回落 500 并标记 invalid', () => {
    for (const value of [0, -1, 1.5, null, 100001, '', 'abc']) {
      expect(normalizeCap(value)).toEqual({ value: DEFAULT_CAP, valid: false, reason: 'invalid' })
    }
    expect(normalizeCap(500)).toEqual({ value: 500, valid: true, reason: 'ok' })
    expect(normalizeCap('500')).toEqual({ value: 500, valid: true, reason: 'ok' })
    expect(normalizeCap(1).value).toBe(1)
    expect(normalizeCap(100000).value).toBe(100000)
  })
})
