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

const PROMO_TTL_MS = 30 * 60 * 1000

function makeRepository({ paidPromoCount = 0 } = {}) {
  const orders = new Map()
  const applied = []
  const counts = []
  const paidPromoOrders = Array.from({ length: paidPromoCount }, (_, i) => ({
    id: `seed-${i}`,
    user_id: 'u-1',
    promotion_id: 'standard-monthly-half',
    status: 'paid',
    amount: 5900,
    payable_cents: 2900,
  }))
  let seq = 0
  // 模拟 PostgreSQL 的 `pg_advisory_xact_lock('promo:<user>')`：同一用户的
  // 「计数 → 定价 → 落 pending」必须串行。没有它，js 单线程的微任务交错会让
  // 5 个并发请求都读到 count=0（这正是线上多开窗口的形态）。
  let promoLock = Promise.resolve()

  function rowOf(row, createdAt) {
    seq += 1
    return {
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
      created_at: (createdAt || IN_WINDOW).toISOString(),
      seq,
    }
  }

  async function countPromo(userId, { now: at = IN_WINDOW, includePending = true } = {}) {
    const atMs = at instanceof Date ? at.getTime() : new Date(at).getTime()
    const cutoff = atMs - PROMO_TTL_MS
    let count = paidPromoOrders.filter((order) => order.user_id === userId).length
    for (const order of orders.values()) {
      if (order.user_id !== userId || !order.promotion_id) continue
      if (order.status === 'paid') count += 1
      else if (includePending && order.status === 'pending') {
        const created = new Date(order.created_at).getTime()
        if (Number.isFinite(created) && created >= cutoff) count += 1
      }
    }
    return count
  }

  return {
    orders,
    applied,
    counts,
    async createPendingOrder(row) {
      const stored = rowOf(row)
      orders.set(row.id, stored)
      return stored
    },
    async createPendingOrderWithPromoQuota({ userId, now = IN_WINDOW, resolvePendingOrder }) {
      const previous = promoLock
      let release
      promoLock = new Promise((resolve) => { release = resolve })
      await previous
      try {
        counts.push(userId)
        const promoPurchaseCount = await countPromo(userId, { now, includePending: true })
        const resolved = resolvePendingOrder(promoPurchaseCount)
        const stored = rowOf(resolved.order, now instanceof Date ? now : new Date(now))
        orders.set(stored.id, stored)
        return { order: stored, pricing: resolved.pricing, promoPurchaseCount }
      } finally {
        release()
      }
    },
    async countPromoPurchases(userId, options = {}) {
      counts.push(userId)
      return countPromo(userId, options)
    },
    async getActiveSubscription() { return null },
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
        async countPromoPurchases(userId, options = {}) {
          counts.push(userId)
          return countPromo(userId, options)
        },
        async createNotification() {},
      })
    },
  }
}

function makeService(repo, promoEnv = PROMO_ENABLED, now = IN_WINDOW) {
  return new SubscriptionService({
    repository: repo,
    now: () => now,
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

  await t.test('第 1/2/3 单（已支付 0/1/2 单）→ 都是 2900、都落 promotion_id', async () => {
    for (const paidPromoCount of [0, 1, 2]) {
      const repo = makeRepository({ paidPromoCount })
      const svc = makeService(repo)
      const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
      const order = repo.orders.get(out.orderId)
      assert.strictEqual(order.payable_cents, 2900, `第 ${paidPromoCount + 1} 单必须按促销价`)
      assert.strictEqual(order.discount_cents, 3000)
      assert.strictEqual(order.promotion_id, 'standard-monthly-half')
      assert.match(out.codeUrl, /:2900$/)
    }
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

  await t.test('额度预占（B）：3 个 pending 后第 4 个直接按 5900', async () => {
    const repo = makeRepository()
    const svc = makeService(repo)
    for (let i = 0; i < 3; i += 1) {
      await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    }
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const rows = Array.from(repo.orders.values())
    assert.strictEqual(rows.length, 4)
    assert.deepStrictEqual(rows.slice(0, 3).map((row) => row.payable_cents), [2900, 2900, 2900])
    assert.strictEqual(repo.orders.get(out.orderId).payable_cents, 5900, '第 4 个 pending 不得再按促销价')
    assert.strictEqual(repo.orders.get(out.orderId).promotion_id, null)
    assert.match(out.codeUrl, /:5900$/)
  })

  await t.test('额度预占（B）：pending 超过 30 分钟后自动释放，赌单不永久锁死用户', async () => {
    const repo = makeRepository()
    const svc = makeService(repo)
    for (let i = 0; i < 3; i += 1) {
      await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    }
    const stale = new Date(IN_WINDOW.getTime() - 31 * 60 * 1000).toISOString()
    for (const row of repo.orders.values()) row.created_at = stale
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    assert.strictEqual(repo.orders.get(out.orderId).payable_cents, 2900, '过期 pending 不得继续占用额度')
    assert.match(out.codeUrl, /:2900$/)
  })

  await t.test('额度预占（B）：并发 5 单最多 3 单 2900（事务锁串行化）', async () => {
    const repo = makeRepository()
    const svc = makeService(repo)
    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })),
    )
    const payable = results.map((item) => repo.orders.get(item.orderId).payable_cents)
    assert.strictEqual(payable.filter((value) => value === 2900).length, 3, '促销价不得超过 3 单')
    assert.strictEqual(payable.filter((value) => value === 5900).length, 2, '其余并发单必须按原价')
  })

  await t.test('并发下不得绕过限购：已满 3 单时 5 个并发下单全部 5900', async () => {
    const repo = makeRepository({ paidPromoCount: 3 })
    const svc = makeService(repo)
    // 关键点：`countPromoPurchases` 是 DB 侧 count(*)，不是进程内缓存；
    // 已满 3 单后无论并发多少请求，读到的事实都是「已满」，第 4 单起只能原价。
    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })),
    )
    const orders = results.map((item) => repo.orders.get(item.orderId))
    assert.strictEqual(orders.length, 5)
    for (const order of orders) {
      assert.strictEqual(order.payable_cents, 5900, '并发请求不得拿到促销价')
      assert.strictEqual(order.promotion_id, null)
    }
    assert.strictEqual(repo.counts.length, 5, '每次下单都必须以 DB 计数为准（不允许进程内缓存）')
  })

  await t.test('年付不受促销影响：窗口内 59000 且无 promotion_id、不查计数', async () => {
    for (const paidPromoCount of [0, 3]) {
      const repo = makeRepository({ paidPromoCount })
      const svc = makeService(repo)
      const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'year' })
      const order = repo.orders.get(out.orderId)
      assert.strictEqual(order.amount, 59000)
      assert.strictEqual(order.payable_cents, 59000)
      assert.strictEqual(order.discount_cents, 0)
      assert.strictEqual(order.promotion_id, null)
      assert.match(out.codeUrl, /:59000$/)
      assert.strictEqual(repo.counts.length, 0, '年付不参与促销，不应查询限购计数')
    }
  })

  await t.test('年付在窗口外同样是 59000', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, PROMO_ENABLED, new Date('2027-03-01T00:00:00+08:00'))
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'year' })
    const order = repo.orders.get(out.orderId)
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

  await t.test('促销超卖兜底（B）：已支付 3 单后第 4 单仍结算，但返回可对账字段', async () => {
    const repo = makeRepository({ paidPromoCount: 3 })
    const svc = makeService(repo)
    const orderId = 'wpoversold1'
    repo.orders.set(orderId, {
      id: orderId,
      user_id: 'u-1',
      plan: 'standard',
      amount: 5900,
      payable_cents: 2900,
      discount_cents: 3000,
      promotion_id: 'standard-monthly-half',
      currency: 'CNY',
      channel: 'payment',
      status: 'pending',
      period: 'month',
      paid_at: null,
      created_at: IN_WINDOW.toISOString(),
      seq: 99,
    })
    const out = await svc.settlePaymentWebhook({
      orderId,
      providerReference: `wechat:${orderId}`,
      amountCents: 2900,
    })
    assert.strictEqual(out.promoQuotaOversold, true, '第 4 笔促销单必须被标记超卖')
    assert.strictEqual(out.paidPromoCount, 3)
    assert.strictEqual(out.maxPromoPurchases, 3)
    assert.strictEqual(repo.applied.length, 1, '钱已收：超卖也必须结算，不得拒付')
    assert.strictEqual(repo.orders.get(orderId).status, 'paid')
  })

  await t.test('促销超卖兜底（B）：原价第 4 单不误报超卖', async () => {
    const repo = makeRepository({ paidPromoCount: 3 })
    const svc = makeService(repo)
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const out = await svc.settlePaymentWebhook({
      orderId,
      providerReference: `wechat:${orderId}`,
      amountCents: 5900,
    })
    assert.strictEqual(out.promoQuotaOversold, false)
    assert.strictEqual(out.paidPromoCount, 0)
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
