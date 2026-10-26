// @vitest-environment node
'use strict'
/**
 * 双分类器「额度语义」parity 契约（P1a follow-up）。
 *
 * 背景：`classifyProviderFailure`（重试/熔断）与 `classifyModelAccessFailure`（用户提示）
 * 是两套独立枚举，但「这是不是额度问题」必须对同一组文案给出相同答案；否则会出现
 * 「熔断已开、界面说网络错误」或「界面说额度不足、重试仍打上游」的自相矛盾。
 *
 * 这里锁的是**共享语义交集**，不要求两个分类器所有状态完全相等：
 * - 额度 fixture：两边都必须判 quota；
 * - 非额度 fixture：两边都不得判 quota；
 * - 认证/限流只断言各自方向，不强行拉平（产品级 credential/rate 与重试 rate/other 是刻意分层）。
 */
const { classifyProviderFailure } = require('./provider-error')
const { classifyModelAccessFailure, ACCESS_STATES } = require('./model-access-failure')

function makeError (message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

describe('model-access parity：额度语义双分类器对拍', () => {
  const quotaCases = [
    ['You have exceeded your usage limit', 400],
    ['insufficient_quota', 429],
    ['insufficient_balance', 400],
    ['insufficientbalance', 400],
    ['insufficient  balance', 400],
    ['billing hard limit reached', 400],
    ['billing exceeded quota', 400],
    ['余额不足，请充值', 402],
  ]

  for (const [message, statusCode] of quotaCases) {
    it(`额度 fixture 两边都判 quota：${message}`, () => {
      const error = makeError(message, statusCode)
      expect(classifyProviderFailure(error)).toBe('quota')
      expect(classifyModelAccessFailure(error).state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    })
  }

  const nonQuotaCases = [
    ['billing portal unavailable', 400],
    ['billing configuration failed', 500],
    ['billingportal', 400],
    ['Usage exceeds budget', 400],
    ['reinsufficient_quota', 400],
    ['rate limit exceeded', 429],
    ['invalid api key', 401],
  ]

  for (const [message, statusCode] of nonQuotaCases) {
    it(`非额度 fixture 两边都不判 quota：${message}`, () => {
      const error = makeError(message, statusCode)
      expect(classifyProviderFailure(error)).not.toBe('quota')
      expect(classifyModelAccessFailure(error).state).not.toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    })
  }

  it('429 + 明确限流文本仍判 rate（不被 quota 文本误伤）', () => {
    const error = makeError('Rate limit reached for quota', 429)
    expect(classifyProviderFailure(error)).toBe('rate')
    expect(classifyModelAccessFailure(error).state).toBe(ACCESS_STATES.RATE_LIMITED)
  })
})
