'use strict'
/**
 * 促销期兑换码禁用（决策表第 12 行）。
 *
 * 语义边界：这是**活动级**开关 —— 只判「开关 + 时间窗」，不判该用户已买几单。
 * 若按用户计数放开，则「已买满 3 单的用户」会成为唯一能用兑换码的人群，
 * 正好把囤积上限的收益让给最会套利的那批人。
 */

const test = require('node:test')
const assert = require('node:assert')

const { SubscriptionService } = require('../src/auth/subscription-service')
const { buildStandardMonthlyPromoConfig } = require('../src/auth/plan-matrix')

const IN_WINDOW = new Date('2026-12-01T00:00:00+08:00')
const OUT_OF_WINDOW = new Date('2027-03-01T00:00:00+08:00')

function makeService({ now = IN_WINDOW, enabled = '1' } = {}) {
  let touched = false
  const repository = {
    async commerceTransaction() { touched = true; throw new Error('促销期不应进入核销事务') },
  }
  const service = new SubscriptionService({
    repository,
    now: () => now,
    promoConfig: buildStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: enabled }, null),
  })
  return { service, touched: () => touched }
}

test('redeem：促销期（窗口内 + 开关开）→ REDEEM_DISABLED_DURING_PROMO', async (t) => {
  await t.test('窗口内 → 409，且不进入核销事务（连码都不查）', async () => {
    const { service, touched } = makeService()
    await assert.rejects(
      service.redeem({ userId: 'u-1', code: 'ABCD-EFGH-JKMN' }),
      (err) => err.code === 'REDEEM_DISABLED_DURING_PROMO' && err.status === 409,
    )
    assert.strictEqual(touched(), false, '促销期必须在触达仓储之前拒绝')
  })

  await t.test('窗口外 → 不拦截（落到格式校验分支，证明守卫按时间窗放开）', async () => {
    const { service } = makeService({ now: OUT_OF_WINDOW })
    await assert.rejects(
      service.redeem({ userId: 'u-1', code: 'bad' }),
      (err) => err.code === 'REDEEM_CODE_FORMAT',
    )
  })

  await t.test('开关关闭 → 不拦截', async () => {
    const { service } = makeService({ enabled: '0' })
    await assert.rejects(
      service.redeem({ userId: 'u-1', code: 'bad' }),
      (err) => err.code === 'REDEEM_CODE_FORMAT',
    )
  })

  await t.test('未注入促销配置（旧部署）→ 不拦截（向后兼容）', async () => {
    const service = new SubscriptionService({ repository: {}, now: () => IN_WINDOW })
    await assert.rejects(
      service.redeem({ userId: 'u-1', code: 'bad' }),
      (err) => err.code === 'REDEEM_CODE_FORMAT',
    )
  })
})
