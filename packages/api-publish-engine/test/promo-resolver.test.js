'use strict'
/**
 * 标准版月付「上市期半价」定价解析（promo-resolver）的判据。
 *
 * 为什么单独立文件：这是**唯一**决定「向微信收多少钱」的纯函数。它的每一条分支都对应
 * 资损或客诉面：
 *   · 窗口边界差 1 秒 ⇒ 活动价在活动开始前/结束后仍然生效（资损）；
 *   · plan/period 过滤漏一条 ⇒ 年付或专业版被打折；
 *   · 计数判断写反 ⇒ 用户能无限囤促销价，或第 1 单就按原价收（客诉）；
 *   · 配置非法静默回退 ⇒ 部署期配错（endsAt ≤ startsAt、price ≥ listPrice）永远不报错。
 *
 * 因此每条判据都配一条**变异反证**（见 openspec/records/standard-plan-promo.md）：
 * 把实现改坏必须红、还原后必须绿。
 */

const test = require('node:test')
const assert = require('node:assert')

const {
  PROMO_ID,
  resolvePrice,
  loadStandardMonthlyPromoConfig,
  PROMO_STANDARD_MONTHLY_DEFAULTS,
} = require('../src/auth/promo-resolver')

const STARTS_AT = '2026-11-01T00:00:00+08:00'
const ENDS_AT = '2027-02-01T00:00:00+08:00'

/** 基准配置：标准版月付，标价 5900 ⇒ 实收 2900，最多 3 单。 */
function makeConfig(overrides = {}) {
  return {
    enabled: true,
    id: PROMO_ID,
    plan: 'standard',
    period: 'month',
    listPriceCents: 5900,
    priceCents: 2900,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    maxPurchasesPerUser: 3,
    ...overrides,
  }
}

function priceAt(now, overrides = {}, count = 0) {
  return resolvePrice({
    plan: 'standard',
    period: 'month',
    now: new Date(now),
    config: makeConfig(overrides),
    promoPurchaseCount: count,
  })
}

test('promo-resolver：时间窗边界（左闭右开）', async (t) => {
  await t.test('窗口开始前 1 秒 → 原价、无 promotion', () => {
    const out = priceAt('2026-10-31T23:59:59+08:00')
    assert.strictEqual(out.listPriceCents, 5900)
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.discountCents, 0)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('窗口开始时刻（含）→ 2900、discount 3000、剩余 92 天', () => {
    const out = priceAt('2026-11-01T00:00:00+08:00')
    assert.strictEqual(out.listPriceCents, 5900)
    assert.strictEqual(out.payableCents, 2900)
    assert.strictEqual(out.discountCents, 3000)
    assert.ok(out.promotion, '窗口内必须带 promotion')
    assert.strictEqual(out.promotion.id, 'standard-monthly-half')
    assert.strictEqual(out.promotion.endsAt, '2027-01-31T16:00:00.000Z')
    assert.strictEqual(out.promotion.remainingDays, 92)
    assert.strictEqual(out.promotion.exhausted, false)
  })

  await t.test('窗口结束前 1 毫秒 → 仍生效，剩余天数向上取整为 1', () => {
    const out = priceAt('2027-01-31T23:59:59.999+08:00')
    assert.strictEqual(out.payableCents, 2900)
    assert.ok(out.promotion)
    assert.strictEqual(out.promotion.remainingDays, 1)
  })

  await t.test('窗口结束时刻（不含）→ 原价、无 promotion', () => {
    const out = priceAt('2027-02-01T00:00:00+08:00')
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('活动结束后 promotion 彻底消失（不是 exhausted）', () => {
    const out = priceAt('2027-03-01T00:00:00+08:00')
    assert.strictEqual(out.promotion, null, '窗口外不得再显示「活动价已用完」')
  })
})

test('promo-resolver：plan / period 过滤', async (t) => {
  const NOW = new Date('2026-12-01T00:00:00+08:00')
  await t.test('pro + month 不打折', () => {
    const out = resolvePrice({
      plan: 'pro', period: 'month', now: NOW, config: makeConfig({ listPriceCents: 11900 }), promoPurchaseCount: 0,
    })
    assert.strictEqual(out.payableCents, 11900)
    assert.strictEqual(out.discountCents, 0)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('standard + year 不打折（年付维持 59000）', () => {
    const out = resolvePrice({
      plan: 'standard', period: 'year', now: NOW, config: makeConfig({ listPriceCents: 59000 }), promoPurchaseCount: 0,
    })
    assert.strictEqual(out.listPriceCents, 59000)
    assert.strictEqual(out.payableCents, 59000)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('free 档不打折（标价 0 不参与促销）', () => {
    const out = resolvePrice({
      plan: 'free', period: 'month', now: NOW, config: makeConfig({ listPriceCents: 0 }), promoPurchaseCount: 0,
    })
    assert.strictEqual(out.payableCents, 0)
    assert.strictEqual(out.promotion, null)
  })
})

test('promo-resolver：开关与计数', async (t) => {
  await t.test('开关关闭（enabled=false）→ 原价', () => {
    const out = priceAt('2026-12-01T00:00:00+08:00', { enabled: false })
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('已购 0 单 → 促销价', () => {
    assert.strictEqual(priceAt('2026-12-01T00:00:00+08:00', {}, 0).payableCents, 2900)
  })

  await t.test('已购 2 单 → 仍可享受第 3 单', () => {
    const out = priceAt('2026-12-01T00:00:00+08:00', {}, 2)
    assert.strictEqual(out.payableCents, 2900)
    assert.strictEqual(out.promotion.exhausted, false)
  })

  await t.test('已购 3 单 → 第 4 次按原价 59，但 promotion 仍在（UI 要显示「活动价已用完」）', () => {
    const out = priceAt('2026-12-01T00:00:00+08:00', {}, 3)
    assert.strictEqual(out.listPriceCents, 5900)
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.discountCents, 0)
    assert.ok(out.promotion, 'exhausted 状态下 promotion 不能为 null，否则 UI 无法提示')
    assert.strictEqual(out.promotion.exhausted, true)
  })

  await t.test('已购 4 单（并发超额的历史数据）→ 依然原价、不报错', () => {
    assert.strictEqual(priceAt('2026-12-01T00:00:00+08:00', {}, 4).payableCents, 5900)
  })
})

test('promo-resolver：配置非法必须抛错，不得静默回退', async (t) => {
  const NOW = new Date('2026-12-01T00:00:00+08:00')
  const expectInvalid = (config, label) => {
    assert.throws(
      () => resolvePrice({ plan: 'standard', period: 'month', now: NOW, config, promoPurchaseCount: 0 }),
      (err) => err.code === 'PROMO_CONFIG_INVALID' && err.status === 500,
      label,
    )
  }

  await t.test('endsAt ≤ startsAt → PROMO_CONFIG_INVALID', () => {
    expectInvalid(makeConfig({ endsAt: STARTS_AT }), '相等必须抛错')
    expectInvalid(makeConfig({ endsAt: '2026-10-01T00:00:00+08:00' }), '早于开始必须抛错')
  })

  await t.test('priceCents ≤ 0 → PROMO_CONFIG_INVALID', () => {
    expectInvalid(makeConfig({ priceCents: 0 }), '0 必须抛错')
    expectInvalid(makeConfig({ priceCents: -100 }), '负数必须抛错')
  })

  await t.test('priceCents ≥ listPriceCents → PROMO_CONFIG_INVALID', () => {
    expectInvalid(makeConfig({ priceCents: 5900 }), '等于标价必须抛错（不是促销）')
    expectInvalid(makeConfig({ priceCents: 6900 }), '高于标价必须抛错（负折扣）')
  })

  await t.test('时间戳不可解析 → PROMO_CONFIG_INVALID（不是静默按无效处理）', () => {
    expectInvalid(makeConfig({ startsAt: 'not-a-date' }), '非法时间串必须抛错')
  })

  await t.test('maxPurchasesPerUser 非正整数 → PROMO_CONFIG_INVALID', () => {
    expectInvalid(makeConfig({ maxPurchasesPerUser: 0 }), '0 单上限等于永久原价，属配置错误')
  })
})

test('promo-resolver：env 装配', async (t) => {
  await t.test('未设置开关 → enabled=false，窗口与价格取默认值', () => {
    const config = loadStandardMonthlyPromoConfig({}, { listPriceCents: 5900 })
    assert.strictEqual(config.enabled, false)
    assert.strictEqual(config.priceCents, PROMO_STANDARD_MONTHLY_DEFAULTS.priceCents)
    assert.strictEqual(config.startsAt, PROMO_STANDARD_MONTHLY_DEFAULTS.startsAt)
    assert.strictEqual(config.endsAt, PROMO_STANDARD_MONTHLY_DEFAULTS.endsAt)
    assert.strictEqual(config.maxPurchasesPerUser, 3)
  })

  await t.test('PROMO_STANDARD_MONTHLY_ENABLED=1 → enabled=true', () => {
    const config = loadStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: '1' }, { listPriceCents: 5900 })
    assert.strictEqual(config.enabled, true)
  })

  await t.test('任何非 "1" 的值都按关闭处理（fail-closed）', () => {
    for (const value of ['0', 'true', '', 'yes', '2']) {
      const config = loadStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: value }, { listPriceCents: 5900 })
      assert.strictEqual(config.enabled, false, `ENABLED=${JSON.stringify(value)} 必须视为关闭`)
    }
  })

  await t.test('价格 / 窗口可被 env 覆盖（运营调整不需改代码）', () => {
    const config = loadStandardMonthlyPromoConfig({
      PROMO_STANDARD_MONTHLY_ENABLED: '1',
      PROMO_STANDARD_MONTHLY_PRICE_CENTS: '1900',
      PROMO_STANDARD_MONTHLY_STARTS_AT: '2026-12-01T00:00:00+08:00',
      PROMO_STANDARD_MONTHLY_ENDS_AT: '2027-01-01T00:00:00+08:00',
      PROMO_STANDARD_MONTHLY_MAX_PURCHASES: '5',
    }, { listPriceCents: 5900 })
    assert.strictEqual(config.priceCents, 1900)
    assert.strictEqual(config.maxPurchasesPerUser, 5)
    assert.strictEqual(config.endsAt, '2027-01-01T00:00:00+08:00')
  })

  await t.test('env 价格 ≥ 标价 → 装配期就抛错（启动 fail-fast）', () => {
    assert.throws(
      () => loadStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: '1', PROMO_STANDARD_MONTHLY_PRICE_CENTS: '5900' }, { listPriceCents: 5900 }),
      (err) => err.code === 'PROMO_CONFIG_INVALID',
    )
  })

  await t.test('env 价格非整数 → 装配期抛错', () => {
    assert.throws(
      () => loadStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: '1', PROMO_STANDARD_MONTHLY_PRICE_CENTS: '29.9' }, { listPriceCents: 5900 }),
      (err) => err.code === 'PROMO_CONFIG_INVALID',
    )
  })
})
