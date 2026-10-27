'use strict'
/**
 * subscription-horizon.js — 会员期限上限（1095 天）的**单一真源**。
 *
 * 口径（写进 PRD §13，改口径必须同时改这里与文档）：
 *   · 按**天**计：1095 = 3 × 365。
 *   · 跨闰年时与「3 个自然年」相差 1 天（例如 2028-02-29 前后）。本上限不按日历月/年
 *     顺延，避免同一笔购买在不同年份得到不同天数。
 *
 * 为什么必须是共享模块：两条写入路径都要拦，且**不得各写一份**——
 *   ① `SubscriptionService.createCheckout` 预检：让用户在付款前看到原因，不生成二维码；
 *   ② `PostgresCommerceTransaction.applySubscription` 兜底：兑换码与后台授予不经过
 *      checkout，只能在仓储层拦；支付回调最终也复用这里（同一事务内再校验一次）。
 *
 * 语义：`prospectiveEnd = max(现有 current_period_end, now) + durationDays`；
 * `prospectiveEnd > now + 1095 天` ⇒ 拒绝。**只拦新增写入**，绝不回滚用户已有权益。
 */

const MAX_SUBSCRIPTION_HORIZON_DAYS = 1095
const MS_PER_DAY = 24 * 60 * 60 * 1000
const HORIZON_EXCEEDED_CODE = 'SUBSCRIPTION_HORIZON_EXCEEDED'
const HORIZON_EXCEEDED_MESSAGE = '会员到期时间最多可延长至 3 年后，当前购买会超过上限'

function invalid (message) {
  return Object.assign(new Error(`subscription-horizon: ${message}`), {
    code: 'DURATION_INVALID',
    status: 400,
  })
}

function toDate (value, field) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalid(`${field} is an invalid Date`)
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw invalid(`${field} is not a parseable timestamp`)
    return parsed
  }
  throw invalid(`${field} must be a Date or timestamp string`)
}

/**
 * 计算并校验一次续叠后的到期时间。
 *
 * @param {object} input
 * @param {Date|string|number|null} [input.currentPeriodEnd] 现有 active 订阅的到期时间；无订阅传 null
 * @param {Date|string|number} input.now 本次写入的应用时钟
 * @param {number} input.durationDays 本次新增天数（正整数）
 * @returns {{base: Date, periodEnd: Date, limit: Date}}
 * @throws {Error & {code: 'DURATION_INVALID'|'SUBSCRIPTION_HORIZON_EXCEEDED', status: number}}
 */
function assertWithinSubscriptionHorizon ({ currentPeriodEnd = null, now, durationDays } = {}) {
  const nowDate = toDate(now, 'now')
  if (!Number.isInteger(durationDays) || durationDays <= 0) {
    throw invalid('durationDays must be a positive integer')
  }
  const current = currentPeriodEnd === null || currentPeriodEnd === undefined
    ? null
    : toDate(currentPeriodEnd, 'currentPeriodEnd')
  const baseMs = current && current.getTime() > nowDate.getTime()
    ? current.getTime()
    : nowDate.getTime()
  const endMs = baseMs + durationDays * MS_PER_DAY
  // Date 的合法上限是 ±8.64e15 ms；溢出时 toISOString 会抛裸 RangeError → 500。
  if (!Number.isFinite(endMs) || Math.abs(endMs) > 8640000000000000) {
    throw invalid('durationDays overflows the Date range')
  }
  const limitMs = nowDate.getTime() + MAX_SUBSCRIPTION_HORIZON_DAYS * MS_PER_DAY
  if (endMs > limitMs) {
    throw Object.assign(new Error(HORIZON_EXCEEDED_MESSAGE), {
      code: HORIZON_EXCEEDED_CODE,
      status: 409,
    })
  }
  return {
    base: new Date(baseMs),
    periodEnd: new Date(endMs),
    limit: new Date(limitMs),
  }
}

module.exports = {
  MAX_SUBSCRIPTION_HORIZON_DAYS,
  MS_PER_DAY,
  HORIZON_EXCEEDED_CODE,
  HORIZON_EXCEEDED_MESSAGE,
  assertWithinSubscriptionHorizon,
}
