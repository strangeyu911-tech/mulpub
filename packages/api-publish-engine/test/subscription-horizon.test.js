'use strict'
/**
 * 1095 天会员期限护栏（A）的判据。
 *
 * 三条不可让的语义：
 *   ① 口径是**天**：`prospectiveEnd = max(现有 current_period_end, now) + durationDays`，
 *      `> now + 1095 天` 即拒绝；正好 1095 天必须通过，1096 天必须拒绝。
 *   ② 两层都要拦：createCheckout 预检（付款前、不生成二维码）与
 *      PostgresCommerceTransaction.applySubscription 兜底（兑换码 / 后台授予不经过 checkout）。
 *   ③ 已有超限用户**不受影响**：只拒绝新增写入，绝不回滚其现有权益。
 */

const test = require('node:test')
const assert = require('node:assert')

const {
  MAX_SUBSCRIPTION_HORIZON_DAYS,
  assertWithinSubscriptionHorizon,
} = require('../src/auth/subscription-horizon')
const { SubscriptionService } = require('../src/auth/subscription-service')
const { PostgresCommerceTransaction } = require('../src/auth/postgres-commerce-store')

const NOW = new Date('2026-12-01T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (days) => new Date(NOW.getTime() + days * DAY)

function fakeClient(queue = []) {
  const calls = []
  return {
    calls,
    queue: [...queue],
    async query(text, values) {
      calls.push({ text, values })
      if (this.queue.length) return this.queue.shift()
      return { rows: [] }
    },
    release() {},
  }
}

function isHorizonError(error) {
  return error && error.code === 'SUBSCRIPTION_HORIZON_EXCEEDED' && error.status === 409
}

test('1095 天护栏：纯函数边界与口径', async (t) => {
  await t.test('正好 1095 天通过、1096 天拒绝（已有 2 年 + 买 1 年 / 1 年零 1 天）', () => {
    const pass = assertWithinSubscriptionHorizon({
      currentPeriodEnd: at(730), now: NOW, durationDays: 365,
    })
    assert.strictEqual(pass.base.getTime(), at(730).getTime())
    assert.strictEqual(pass.periodEnd.getTime(), at(1095).getTime())

    assert.throws(
      () => assertWithinSubscriptionHorizon({ currentPeriodEnd: at(731), now: NOW, durationDays: 365 }),
      isHorizonError,
    )
  })

  await t.test('无存量订阅：1095 天通过、1096 天拒绝', () => {
    assert.doesNotThrow(() => assertWithinSubscriptionHorizon({ currentPeriodEnd: null, now: NOW, durationDays: 1095 }))
    assert.throws(
      () => assertWithinSubscriptionHorizon({ currentPeriodEnd: null, now: NOW, durationDays: 1096 }),
      isHorizonError,
    )
  })

  await t.test('已有 2 年 + 买 1 年通过；已有 2 年 + 买 2 年拒绝', () => {
    assert.doesNotThrow(() => assertWithinSubscriptionHorizon({ currentPeriodEnd: at(730), now: NOW, durationDays: 365 }))
    assert.throws(
      () => assertWithinSubscriptionHorizon({ currentPeriodEnd: at(730), now: NOW, durationDays: 730 }),
      isHorizonError,
    )
  })

  await t.test('已过期的旧订阅按 now 起算，而不是按陈旧到期时间起算', () => {
    const out = assertWithinSubscriptionHorizon({ currentPeriodEnd: at(-400), now: NOW, durationDays: 365 })
    assert.strictEqual(out.base.getTime(), NOW.getTime())
    assert.strictEqual(out.periodEnd.getTime(), at(365).getTime())
  })

  await t.test('已有超限用户再买 1 个月 ⇒ 拒绝；且输入日期不被改写（不回滚现有权益）', () => {
    const current = at(1200)
    const before = current.getTime()
    assert.throws(
      () => assertWithinSubscriptionHorizon({ currentPeriodEnd: current, now: NOW, durationDays: 30 }),
      isHorizonError,
    )
    assert.strictEqual(current.getTime(), before)
  })

  await t.test('错误消息是可读中文，且口径常量 = 3 × 365', () => {
    assert.strictEqual(MAX_SUBSCRIPTION_HORIZON_DAYS, 1095)
    try {
      assertWithinSubscriptionHorizon({ currentPeriodEnd: at(1200), now: NOW, durationDays: 30 })
      assert.fail('应当抛错')
    } catch (error) {
      assert.strictEqual(error.message, '会员到期时间最多可延长至 3 年后，当前购买会超过上限')
    }
  })

  await t.test('非法时长 / 溢出时间仍归 DURATION_INVALID（不冒充 409）', () => {
    for (const durationDays of [0, -1, 1.5, '30']) {
      assert.throws(
        () => assertWithinSubscriptionHorizon({ currentPeriodEnd: null, now: NOW, durationDays }),
        (error) => error.code === 'DURATION_INVALID' && error.status === 400,
      )
    }
    assert.throws(
      () => assertWithinSubscriptionHorizon({ currentPeriodEnd: null, now: NOW, durationDays: Number.MAX_SAFE_INTEGER }),
      (error) => error.code === 'DURATION_INVALID' && error.status === 400,
    )
  })
})

test('createCheckout 预检：付款前拒绝，不落订单、不生成二维码', async (t) => {
  function makeRepo(existingEnd) {
    const calls = { pending: 0, customer: 0 }
    return {
      calls,
      async getActiveSubscription() {
        return existingEnd ? { current_period_end: existingEnd.toISOString() } : null
      },
      async createPendingOrder(row) {
        calls.pending += 1
        return { ...row, user_id: row.userId, status: 'pending' }
      },
      async upsertPaymentCustomer() { calls.customer += 1 },
    }
  }

  function makeService(repo) {
    const providerCalls = []
    const service = new SubscriptionService({
      repository: repo,
      now: () => NOW,
      planOverrides: null,
      promoConfig: null,
      paymentProvider: {
        async createCheckout(args) {
          providerCalls.push(args)
          return { codeUrl: `weixin://x/${args.orderId}:${args.amountCents}`, expiresAt: null }
        },
      },
    })
    return { service, providerCalls }
  }

  await t.test('已有 2 年 + 买 1 年（正好 1095 天）→ 通过并生成订单', async () => {
    const repo = makeRepo(at(730))
    const { service, providerCalls } = makeService(repo)
    const out = await service.createCheckout({ userId: 'u-1', plan: 'standard', period: 'year' })
    assert.match(out.codeUrl, /:59000$/)
    assert.strictEqual(repo.calls.pending, 1)
    assert.strictEqual(providerCalls.length, 1)
  })

  await t.test('已有 2 年零 1 天 + 买 1 年（1096 天）→ 409，零订单、零二维码', async () => {
    const repo = makeRepo(at(731))
    const { service, providerCalls } = makeService(repo)
    await assert.rejects(
      service.createCheckout({ userId: 'u-1', plan: 'standard', period: 'year' }),
      (error) => isHorizonError(error) && /3 年/.test(error.message),
    )
    assert.strictEqual(repo.calls.pending, 0, '预检拒绝不得落 pending 订单')
    assert.strictEqual(repo.calls.customer, 0)
    assert.strictEqual(providerCalls.length, 0, '预检拒绝不得调用支付供应商（不生成二维码）')
  })
})

test('applySubscription 兜底：兑换码 / 后台授予均被拦，且不回滚既有权益', async (t) => {
  function makeService(client) {
    const repository = {
      async commerceTransaction(callback) {
        return callback(new PostgresCommerceTransaction(client))
      },
    }
    return new SubscriptionService({
      repository,
      now: () => NOW,
      planOverrides: null,
      promoConfig: null,
    })
  }

  await t.test('兑换码：已有 2 年零 65 天 + 365 天 → 409，且不写订阅/订单/快照', async () => {
    const existingEnd = at(800)
    const client = fakeClient([
      { rows: [{ code: 'AAAA-BBBB-CCCC', plan: 'standard', duration_days: 365, status: 'active', expires_at: at(30).toISOString(), used_by: null, used_at: null }] },
      { rows: [{ pg_advisory_xact_lock: null }] },
      { rows: [{ id: 'sub-u1', user_id: 'u-1', plan: 'standard', status: 'active', current_period_start: NOW.toISOString(), current_period_end: existingEnd.toISOString() }] },
    ])
    const service = makeService(client)
    await assert.rejects(
      service.redeem({ userId: 'u-1', code: 'AAAA-BBBB-CCCC' }),
      isHorizonError,
    )
    assert.strictEqual(client.calls.length, 3, '锁 + SELECT 后即拒绝，不得写订阅/订单/快照')
    assert.ok(!client.calls.some((call) => /INSERT INTO identity_subscriptions/.test(call.text)))
    assert.strictEqual(existingEnd.getTime(), at(800).getTime(), '既有到期时间不得被改写（不回滚权益）')
  })

  await t.test('后台授予：已有 2 年零 65 天 + 365 天 → 409，且不写订阅/订单/快照', async () => {
    const client = fakeClient([
      { rows: [{ pg_advisory_xact_lock: null }] },
      { rows: [{ id: 'sub-u1', user_id: 'u-1', plan: 'standard', status: 'active', current_period_start: NOW.toISOString(), current_period_end: at(800).toISOString() }] },
    ])
    const service = makeService(client)
    await assert.rejects(
      service.grant({ userId: 'u-1', plan: 'standard', durationDays: 365 }),
      isHorizonError,
    )
    assert.strictEqual(client.calls.length, 2)
    assert.ok(!client.calls.some((call) => /INSERT INTO identity_subscriptions/.test(call.text)))
  })

  await t.test('兑换码正好 1095 天 → 放行（边界不能误杀）', async () => {
    const client = fakeClient([
      { rows: [{ code: 'DDDD-EEEE-FFFF', plan: 'standard', duration_days: 365, status: 'active', expires_at: at(30).toISOString(), used_by: null, used_at: null }] },
      { rows: [{ pg_advisory_xact_lock: null }] },
      { rows: [{ id: 'sub-u1', user_id: 'u-1', plan: 'standard', status: 'active', current_period_start: NOW.toISOString(), current_period_end: at(730).toISOString() }] },
      { rows: [{ id: 'sub-u1', plan: 'standard' }] },
      { rows: [{ id: 'ord-1' }] },
      { rows: [{ version: 1 }] },
      { rows: [{ code: 'DDDD-EEEE-FFFF' }] },
    ])
    const service = makeService(client)
    const result = await service.redeem({ userId: 'u-1', code: 'DDDD-EEEE-FFFF' })
    assert.strictEqual(result.idempotent, false)
    const upsert = client.calls.find((call) => /INSERT INTO identity_subscriptions/.test(call.text))
    assert.ok(upsert, '应当写入订阅')
    assert.strictEqual(upsert.values[4], at(1095).toISOString())
  })
})
