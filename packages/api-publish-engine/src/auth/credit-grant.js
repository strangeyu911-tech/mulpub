'use strict'

/**
 * credit-grant — 订阅周期发放官方积分（P1-5）。
 *
 * 口径：`officialCreditMonthly` 是唯一额度字段（plan-matrix 真源）。
 * 月付发 1 个月，年付按 12 个月发放（PRD-CREDIT-PRICING：年付 = 月付 × 12）。
 * 幂等键 = `subscription:<subscriptionId>:<periodStart>`：
 *   - 同一订阅同一周期重复调用只发一次；
 *   - 续费/顺延时 periodStart 变为上一周期结束，产生新键，正常再发。
 */

const { getPlanEntitlement } = require('./plan-matrix')

const DAY_MS = 24 * 60 * 60 * 1000

function periodMonths (periodStart, periodEnd) {
  const start = Date.parse(periodStart)
  const end = Date.parse(periodEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  const days = (end - start) / DAY_MS
  // 30 天 = 1 个月；365 天 = 12 个月（round 12.17）；三个月 90 天 = 3。
  return Math.max(1, Math.min(12, Math.round(days / 30)))
}

function resolveGrantAmount (plan, periodStart, periodEnd) {
  let entitlement
  try { entitlement = getPlanEntitlement(plan) } catch (_) { return 0 }
  const monthly = entitlement && entitlement.quota ? entitlement.quota.official_credit_monthly : 0
  if (!Number.isInteger(monthly) || monthly <= 0) return 0
  const months = periodMonths(periodStart, periodEnd)
  if (months <= 0) return 0
  return monthly * months
}

/**
 * @param {{creditRepository:object,userId:string,plan:string,periodStart:string,periodEnd:string,subscriptionId?:string}} input
 * @returns {Promise<{granted:boolean,amount:number,reason?:string,result?:object}>}
 */
async function grantSubscriptionCredits (input = {}) {
  const { creditRepository, userId, plan, periodStart, periodEnd } = input
  if (!creditRepository || typeof creditRepository.grantCredit !== 'function') {
    return { granted: false, amount: 0, reason: 'credit-repository-unavailable' }
  }
  if (typeof userId !== 'string' || !userId) {
    return { granted: false, amount: 0, reason: 'user-required' }
  }
  const startMs = Date.parse(periodStart)
  const endMs = Date.parse(periodEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { granted: false, amount: 0, reason: 'period-invalid' }
  }
  const amount = resolveGrantAmount(plan, periodStart, periodEnd)
  if (amount <= 0) return { granted: false, amount: 0, reason: 'no-credit-quota' }
  const subscriptionId = input.subscriptionId || `sub-${userId}`
  const refId = `subscription:${subscriptionId}:${new Date(startMs).toISOString()}`
  const result = await creditRepository.grantCredit({
    userId,
    amount,
    reason: `subscription:${plan}`,
    refType: 'subscription_period',
    refId,
    periodStart,
    periodEnd,
  })
  return { granted: true, amount, refId, result }
}

module.exports = { DAY_MS, periodMonths, resolveGrantAmount, grantSubscriptionCredits }
