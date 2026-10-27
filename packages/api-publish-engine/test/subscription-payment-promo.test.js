'use strict'
/**
 * 促销期下单 / 结算的账务判据（决策表第 8 行 + 技术要点 3）。
 *
 * 三条不可让的判据：
 *   ① **传给微信的是实收**：`amount=5900`（标价）、`discount_cents=3000`、`payable_cents=2900`，
 *      provider 收到的 `amountCents` 必须是 2900 —— 传 5900 就是多收 30 元（资损+客诉）。
 *   ② **回调校验的是实收**：`amountCents === order.payable_cents`，不等即
 *      `PAYMENT_AMOUNT_MISMATCH` 且**不得发权益**（原实现 `void amountCents` 等于不校验）。
 *   ③ **第 4 单按原价**：计数含 3 单已支付促销单时，第 4 单不再落 promotion_id。
 */

const test = require('node:test')
const assert = require('node:assert')

const { SubscriptionService } = require('../src/auth/subscription-service')
const { buildStandardMonthlyPromoConfig } = require('../src/auth/plan-matrix')

const PROMO_ENABLED = { PROMO_STANDARD_MONTHLY_ENABLED: '1' }
const IN_WINDOW = new Date('2026-12-01T00:00:00+08:00')

function makeRepository({ paidPromoCount = 0 } = {}) {
  const orders = new Map()
  const applied = []
  const paidPromoOrders = Array.from({ length: paidPromoCount }, (_, i) => ({
    id: `seed-${i}`,
    user_id: 'u-1',
    promotion_id: 'standard-monthly-half',
    status: 'paid',
    amount: 5900,
    payable_cents: 2900,
  }))
  let seq = 0

  return {
    orders,
    applied,
    async createPendingOrder(row) {
      seq += 1
      const stored = {
        id: row.id,
        user_id: row.userId,
        plan: row.plan,
        amount: row.amount,
        payable_cents: row.payableCents,
        discount_cents: row.discountCents || 0,
        promotion_id: row.promotionId || null,
        currency: row.currency || 'CNY',
        channel: 'payment',
        status: 'pending',
        period: row.period,
        paid_at: null,
        created_at: new Date().toISOString(),
        seq,
      }
      orders.set(row.id, stored)
      return stored
    },
    async countPromoPurchases(userId) {
      return paidPromoOrders.filter((order) => order.user_id === userId).length
    },
    async getOrderById(orderId) {
      return orders.get(orderId) || null
    },
    async markOrderPaid(orderId, { paidAt }) {
      const row = orders.get(orderId)
      if (!row || row.status !== 'pending') return null
      row.status = 'paid'
      row.paid_at = paidAt
      return row
    },
    async upsertPaymentCustomer() { return null },
    async commerceTransaction(callback) {
      return callback({
        async applySubscription(args) {
          applied.push(args)
          const row = orders.get(args.order.id)
          if (row) row.status = 'paid'
          return { plan: args.plan, periodEnd: null }
        },
        async createNotification() {},
      })
    },
  }
}

function makeService(repo, promoEnv = PROMO_ENABLED) {
  return new SubscriptionService({
    repository: repo,
    now: () => IN_WINDOW,
    planOverrides: null,
    promoConfig: promoEnv === null ? null : buildStandardMonthlyPromoConfig(promoEnv, null),
    paymentProvider: {
      async createCheckout({ orderId, amountCents }) {
        return { codeUrl: `weixin://x/${orderId}:${amountCents}`, expiresAt: null }
      },
    },
  })
}

test('促销下单：三列账务口径 + 传给微信的是实收', async (t) => {
  await t.test('促销期首单 → amount 5900 / discount 3000 / payable 2900 / promotion_id 落库', async () => {
    const repo = makeRepository()
    const svc = makeService(repo)
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const order = repo.orders.get(out.orderId)
    assert.strictEqual(order.amount, 5900, 'amount 记标价（合同/退款参照）')
    assert.strictEqual(order.discount_cents, 3000, 'discount_cents 记让利')
    assert.strictEqual(order.payable_cents, 2900, 'payable_cents 记实收')
    assert.strictEqual(order.promotion_id, 'standard-monthly-half')
    assert.match(out.codeUrl, /:2900$/, '⛔ provider 必须收到实收 2900；传 5900 会多收 30 元')
  })

  await t.test('促销关闭 → 5900/0/null（不回归旧行为）', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { PROMO_STANDARD_MONTHLY_ENABLED: '0' })
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const order = repo.orders.get(out.orderId)
    assert.strictEqual(order.amount, 5900)
    assert.strictEqual(order.discount_cents, 0)
    assert.strictEqual(order.payable_cents, 5900)
    assert.strictEqual(order.promotion_id, null)
    assert.match(out.codeUrl, /:5900$/)
  })

  await t.test('第 4 单（已支付 3 单促销）→ 原价 5900、promotion_id 为空', async () => {
    const repo = makeRepository({ paidPromoCount: 3 })
    const svc = makeService(repo)
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const order = repo.orders.get(out.orderId)
    assert.strictEqual(order.amount, 5900)
    assert.strictEqual(order.payable_cents, 5900, '第 4 单按原价收')
    assert.strictEqual(order.discount_cents, 0)
    assert.strictEqual(order.promotion_id, null, '原价单不得计入促销额度')
    assert.match(out.codeUrl, /:5900$/)
  })

  await t.test('年付不受促销影响：59000 且无 promotion_id', async () => {
    const repo = makeRepository()
    const svc = makeService(repo)
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'year' })
    const order = repo.orders.get(out.orderId)
    assert.strictEqual(order.amount, 59000)
    assert.strictEqual(order.payable_cents, 59000)
    assert.strictEqual(order.promotion_id, null)
  })

  await t.test('继续支付复用 pending：按订单实收重取 codeUrl，不重算', async () => {
    const repo = makeRepository()
    const svc = makeService(repo)
    const first = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const again = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month', orderId: first.orderId })
    assert.strictEqual(again.orderId, first.orderId)
    assert.match(again.codeUrl, /:2900$/, '复用路径也必须用 payable_cents')
    assert.strictEqual(repo.orders.size, 1)
  })
})

test('结算回调：金额校验', async (t) => {
  async function seed() {
    const repo = makeRepository()
    const svc = makeService(repo)
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    return { repo, svc, orderId }
  }

  await t.test('回调金额 = 2900（实收）→ 正常发放权益', async () => {
    const { repo, svc, orderId } = await seed()
    const out = await svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 2900 })
    assert.strictEqual(out.plan, 'standard')
    assert.strictEqual(repo.applied.length, 1)
    // 发给 applySubscription 的订单金额必须是**落库的标价**（合同口径），不是回调声称值
    assert.strictEqual(repo.applied[0].order.amount, 5900)
  })

  await t.test('回调金额 = 5900（标价）→ PAYMENT_AMOUNT_MISMATCH，不发放权益', async () => {
    const { repo, svc, orderId } = await seed()
    await assert.rejects(
      svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 5900 }),
      (err) => err.code === 'PAYMENT_AMOUNT_MISMATCH' && err.status === 409,
    )
    assert.strictEqual(repo.applied.length, 0, '金额不符绝不能发权益')
    assert.strictEqual(repo.orders.get(orderId).status, 'pending', '订单保持 pending 等人工核对')
  })

  await t.test('回调缺失金额 → 同样拒绝（不可验证 = 不可信任）', async () => {
    const { svc, orderId } = await seed()
    await assert.rejects(
      svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}` }),
      (err) => err.code === 'PAYMENT_AMOUNT_MISMATCH',
    )
  })

  await t.test('非促销单：回调 5900 通过、2900 拒绝（校验通用，不只促销）', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { PROMO_STANDARD_MONTHLY_ENABLED: '0' })
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    await assert.rejects(
      svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 2900 }),
      (err) => err.code === 'PAYMENT_AMOUNT_MISMATCH',
    )
    const ok = await svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 5900 })
    assert.strictEqual(ok.plan, 'standard')
  })
})
