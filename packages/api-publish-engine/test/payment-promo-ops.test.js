'use strict'
/**
 * 促销相关的两个运维判据：
 *   ① `payment-preflight.js` 的 `promo-config` 自检（上线前把「配错但静默」变成红灯）；
 *   ② `payment-reconcile.js` 的 INFO `promo-order-amount-mismatch`（三列账务口径不自洽）。
 *
 * 为什么这两条必须一起测：预检证明「配置读得懂」，对账证明「钱算得对」——
 * 只做前者会在「配置合法但订单列写错」时全绿；只做后者则要等用户付完钱才发现活动没开。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const P = require('../scripts/payment-preflight')
const R = require('../scripts/payment-reconcile')

const byId = (result, id) => result.checks.find((c) => c.id === id)

test('payment-preflight：promo-config 自检', async (t) => {
  await t.test('未开启 → SKIP（不阻断上线，但显式留一行）', async () => {
    const r = await P.runPreflight({ env: {}, skipDb: true })
    assert.equal(r.ok, true)
    const check = byId(r, 'promo-config')
    assert.ok(check, '促销自检项必须存在（缺项会被读成「查过了」）')
    assert.equal(check.status, P.SKIP)
  })

  await t.test('开启且合法 → PASS，明细带实收金额与窗口', async () => {
    const r = await P.runPreflight({
      env: { PROMO_STANDARD_MONTHLY_ENABLED: '1', PROMO_STANDARD_MONTHLY_PRICE_CENTS: '2900' },
      skipDb: true,
    })
    const check = byId(r, 'promo-config')
    assert.equal(check.status, P.PASS)
    assert.match(check.detail, /2900/)
    assert.match(check.detail, /2026-11-01/)
  })

  await t.test('价格为 0 / 高于标价 → FAIL（rc 非 0，上线被挡）', async () => {
    for (const price of ['0', '5900', '6900']) {
      const r = await P.runPreflight({
        env: { PROMO_STANDARD_MONTHLY_ENABLED: '1', PROMO_STANDARD_MONTHLY_PRICE_CENTS: price },
        skipDb: true,
      })
      const check = byId(r, 'promo-config')
      assert.equal(check.status, P.FAIL, `价格 ${price} 必须判 FAIL`)
      assert.equal(r.ok, false)
    }
  })

  await t.test('窗口倒置 → FAIL', async () => {
    const r = await P.runPreflight({
      env: {
        PROMO_STANDARD_MONTHLY_ENABLED: '1',
        PROMO_STANDARD_MONTHLY_STARTS_AT: '2027-02-01T00:00:00+08:00',
        PROMO_STANDARD_MONTHLY_ENDS_AT: '2026-11-01T00:00:00+08:00',
      },
      skipDb: true,
    })
    assert.equal(byId(r, 'promo-config').status, P.FAIL)
  })

  await t.test('PAYMENT_PROVIDER=none 的早退分支也必须带 promo-config（否则关支付时永远不查）', async () => {
    const r = await P.runPreflight({ env: { PAYMENT_PROVIDER: 'none' }, skipDb: true })
    assert.ok(byId(r, 'promo-config'), 'provider=none 早退把促销自检吞掉了')
  })
})

test('payment-reconcile：promo-order-amount-mismatch（INFO）', async (t) => {
  const check = R.CHECKS.find((c) => c.id === 'promo-order-amount-mismatch')

  await t.test('判据存在且为 INFO（不阻断灰度）', () => {
    assert.ok(check, '缺少 promo-order-amount-mismatch')
    assert.equal(check.severity, R.INFO)
  })

  await t.test('SQL 检查 payable_cents <> amount - discount_cents 且只读', () => {
    assert.match(check.sql, /payable_cents/)
    assert.match(check.sql, /discount_cents/)
    assert.match(check.sql, /<>/)
    assert.ok(String(check.sql).trim().toUpperCase().startsWith('SELECT'))
    for (const verb of ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ']) {
      assert.equal(String(check.sql).toUpperCase().includes(verb), false)
    }
  })

  await t.test('运行时真的执行（假 client 收到该 SQL）', async () => {
    const calls = []
    const client = {
      async query(sql) {
        calls.push(sql)
        if (sql.includes('to_regclass')) {
          return { rows: [{ identity_orders: 'x', identity_webhook_events: 'x', identity_subscriptions: 'x' }] }
        }
        return { rows: [] }
      },
    }
    await R.runReconcile({ client })
    assert.ok(calls.some((sql) => /payable_cents <>/.test(sql)), '促销对账 SQL 没有被执行')
  })
})
