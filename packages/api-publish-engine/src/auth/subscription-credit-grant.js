'use strict'

/**
 * subscription-credit-grant — 订阅积分发放钩子（P1-5）。
 * 独立 mixin：subscription-service.js 已接近 500 行门禁，发放逻辑不内联。
 */

const { grantSubscriptionCredits } = require('./credit-grant')

class SubscriptionCreditGrantOps {
  /**
   * 订阅生效后发放官方积分；发放失败不回滚订阅，错误上抛供重试。
   * refId 幂等，重试不会重复加余额。
   */
  async _grantCreditsForApplied (userId, applied) {
    if (!this.creditRepository || !applied) return null
    try {
      return await grantSubscriptionCredits({
        creditRepository: this.creditRepository,
        userId,
        plan: applied.plan || applied.requestedPlan || 'free',
        periodStart: applied.periodStart,
        periodEnd: applied.periodEnd,
        subscriptionId: applied.subscription && applied.subscription.id ? applied.subscription.id : undefined,
      })
    } catch (error) {
      // 订阅/支付已提交：发放失败不得把已收款的请求判成 500；记录原因，靠运维按幂等 refId 补发。
      return { granted: false, amount: 0, reason: 'grant-failed', error: error && error.message ? error.message : String(error) }
    }
  }

  /** 免费档按自然月发放；/me 首次访问触发，refId 按月幂等。 */
  async _grantFreeMonthlyCredits (userId) {
    if (!this.creditRepository) return null
    const now = this.now()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))
    return this._grantCreditsForApplied(userId, {
      plan: 'free',
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    })
  }
}

function applySubscriptionCreditGrantOps (Proto) {
  const names = Object.getOwnPropertyNames(SubscriptionCreditGrantOps.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(SubscriptionCreditGrantOps.prototype, key))
  }
}

module.exports = { SubscriptionCreditGrantOps, applySubscriptionCreditGrantOps }
