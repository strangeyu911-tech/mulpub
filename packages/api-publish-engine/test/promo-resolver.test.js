'use strict'
/**
 * 标准版月付「上市期半价」定价解析（promo-resolver）的判据。
 *
 * 为什么单独立文件：这是**唯一**决定「向微信收多少钱」的纯函数。它的每一条分支都对应
 * 资损或客诉面：
 *   · 窗口边界差 1 秒 ⇒ 活动价在活动开始前/结束后仍然生效（资损）；
 *   · plan/period 过滤漏一条 ⇒ **年付被打折**（一次 12 个月，让利放大 10 倍）或专业版被打折；
 *   · 计数判断写反 ⇒ 用户能无限囤促销价，或第 1 单就按原价收（客诉）；
 *   · `exhausted` 不返回 ⇒ 前端拿不到「活动价已用完」，用户点进去才发现涨价（客诉）；
 *   · 配置非法静默回退 ⇒ 部署期配错（endsAt ≤ startsAt、price ≥ listPrice）永远不报错。
 *
 * 目标语义（v1.2，见 PRD §12）：
 *   · 促销范围 = standard + **month**；
 *   · 月付第 1/2/3 单 2900（标价 5900、discount 3000），第 4 单起 5900 + exhausted=true；
 *   · **年付在任何窗口下都是 59000**，promotion 恒 null。
 *
 * 每条判据都配一条**变异反证**（见 openspec/records/promo-yearly-rule.md §10）：
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
const IN_WINDOW = '2026-12-01T00:00:00+08:00'

/** 基准配置：标准版月付，标价 5900/59000 ⇒ 实收 2900/59000，最多 3 单。 */
function makeConfig(overrides = {}) {
  return {
    enabled: true,
    id: PROMO_ID,
    plan: 'standard',
    period: 'month',
    listPriceCents: 5900,
    listPriceYearlyCents: 59000,
    priceCents: 2900,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    maxPurchasesPerUser: 3,
    ...overrides,
  }
}

/** 询价：{ plan, period, now, config, promoPurchaseCount }。 */
function priceOf({ plan = 'standard', period = 'month', now = IN_WINDOW, config = makeConfig(), count = 0 } = {}) {
  return resolvePrice({ plan, period, now: new Date(now), config, promoPurchaseCount: count })
}

test('promo-resolver：月付时间窗边界（左闭右开）', async (t) => {
  await t.test('窗口开始前 1 秒 → 原价、无 promotion', () => {
    const out = priceOf({ now: '2026-10-31T23:59:59+08:00' })
    assert.strictEqual(out.listPriceCents, 5900)
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.discountCents, 0)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('窗口开始时刻（含）→ 2900、discount 3000、剩余 92 天', () => {
    const out = priceOf({ now: STARTS_AT })
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
    const out = priceOf({ now: '2027-01-31T23:59:59.999+08:00' })
    assert.strictEqual(out.payableCents, 2900)
    assert.ok(out.promotion)
    assert.strictEqual(out.promotion.remainingDays, 1)
  })

  await t.test('窗口结束时刻（不含）→ 原价、无 promotion', () => {
    const out = priceOf({ now: ENDS_AT })
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.discountCents, 0)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('活动结束后 promotion 彻底消失（不是 exhausted）', () => {
    const out = priceOf({ now: '2027-03-01T00:00:00+08:00', count: 3 })
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.promotion, null, '窗口外不得残留「已用完」状态')
  })
})

test('promo-resolver：年付在任何窗口下恒为 59000（不参与促销）', async (t) => {
  const times = [
    ['窗口开始前 1 秒', '2026-10-31T23:59:59+08:00'],
    ['窗口开始时刻', STARTS_AT],
    ['窗口内', IN_WINDOW],
    ['窗口最后 1 毫秒', '2027-01-31T23:59:59.999+08:00'],
    ['窗口结束后', ENDS_AT],
  ]
  for (const [label, now] of times) {
    await t.test(`${label} → 年付 59000、discount 0、promotion null`, () => {
      for (const count of [0, 1, 2, 3, 9]) {
        const out = priceOf({ period: 'year', now, count })
        assert.strictEqual(out.listPriceCents, 59000, `${label} count=${count}：标价 59000`)
        assert.strictEqual(out.payableCents, 59000, `${label} count=${count}：⛔ 年付不得被打折`)
        assert.strictEqual(out.discountCents, 0, `${label} count=${count}：年付让利必须为 0`)
        assert.strictEqual(out.promotion, null, `${label} count=${count}：年付没有促销状态`)
      }
    })
  }

  await t.test('年付即使传了「已买满」的计数，也不会出现 exhausted 或 29000', () => {
    const out = priceOf({ period: 'year', count: 3 })
    assert.strictEqual(out.payableCents, 59000)
    assert.strictEqual(out.promotion, null)
  })
})

test('promo-resolver：月付限购 3 单（第 4 单起原价 + exhausted）', async (t) => {
  for (const count of [0, 1, 2]) {
    await t.test(`已支付 ${count} 单 → 第 ${count + 1} 单 2900、exhausted=false`, () => {
      const out = priceOf({ count })
      assert.strictEqual(out.listPriceCents, 5900)
      assert.strictEqual(out.payableCents, 2900)
      assert.strictEqual(out.discountCents, 3000)
      assert.strictEqual(out.promotion.id, PROMO_ID)
      assert.strictEqual(out.promotion.exhausted, false)
    })
  }

  await t.test('已支付 3 单 → 第 4 单 5900、discount 0、exhausted=true（promotion 仍在）', () => {
    const out = priceOf({ count: 3 })
    assert.strictEqual(out.listPriceCents, 5900)
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.discountCents, 0)
    assert.ok(out.promotion, 'exhausted 时 promotion 仍要返回，否则前端拿不到「已用完」')
    assert.strictEqual(out.promotion.exhausted, true)
    assert.strictEqual(out.promotion.remainingDays, 62)
  })

  await t.test('已支付 4 单（并发超额的历史数据）→ 依然原价、不报错', () => {
    const out = priceOf({ count: 4 })
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.promotion.exhausted, true)
  })

  await t.test('限购上限来自配置（默认 3，可被 env 覆盖）', () => {
    const out = priceOf({ count: 2, config: makeConfig({ maxPurchasesPerUser: 2 }) })
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.promotion.exhausted, true)
  })
})

test('promo-resolver：plan / period 过滤', async (t) => {
  await t.test('pro + month 不打折', () => {
    const out = priceOf({ plan: 'pro', config: makeConfig({ listPriceCents: 11900 }) })
    assert.strictEqual(out.payableCents, 11900)
    assert.strictEqual(out.discountCents, 0)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('free 档不打折（标价 0 不参与促销）', () => {
    const out = priceOf({ plan: 'free', config: makeConfig({ listPriceCents: 0 }) })
    assert.strictEqual(out.payableCents, 0)
    assert.strictEqual(out.promotion, null)
  })
})

test('promo-resolver：开关', async (t) => {
  await t.test('enabled=false → 月付原价、无 promotion', () => {
    const out = priceOf({ config: makeConfig({ enabled: false }) })
    assert.strictEqual(out.payableCents, 5900)
    assert.strictEqual(out.promotion, null)
  })

  await t.test('enabled 非 true 的任意值都按关闭（fail-closed）', () => {
    for (const enabled of [undefined, null, 'true', 1, {}]) {
      const out = priceOf({ config: makeConfig({ enabled }) })
      assert.strictEqual(out.payableCents, 5900)
      assert.strictEqual(out.promotion, null)
    }
  })
})

test('promo-resolver：配置非法必须抛错，不得静默回退', async (t) => {
  const cases = [
    ['endsAt ≤ startsAt', { endsAt: STARTS_AT }, 'endsAt'],
    ['priceCents ≤ 0', { priceCents: 0 }, 'priceCents'],
    ['priceCents ≥ listPriceCents', { priceCents: 5900 }, 'priceCents'],
    ['时间戳不可解析', { startsAt: 'not-a-date' }, 'startsAt'],
    ['maxPurchasesPerUser 非正整数', { maxPurchasesPerUser: 0 }, 'maxPurchasesPerUser'],
    ['period 不是 month', { period: 'year' }, 'period'],
    ['plan 为空', { plan: '' }, 'plan'],
    ['config 不是对象', null, 'config'],
  ]
  for (const [label, override, hint] of cases) {
    await t.test(`${label} → PROMO_CONFIG_INVALID`, () => {
      const config = override === null ? null : makeConfig(override)
      assert.throws(
        () => resolvePrice({ plan: 'standard', period: 'month', now: new Date(IN_WINDOW), config, promoPurchaseCount: 0 }),
        (err) => err.code === 'PROMO_CONFIG_INVALID' && err.status === 500 && err.message.includes(hint),
      )
    })
  }

  await t.test('promoPurchaseCount 非非负整数 → PROMO_CONFIG_INVALID', () => {
    for (const count of [-1, 1.5, '3', null]) {
      assert.throws(
        () => resolvePrice({ plan: 'standard', period: 'month', now: new Date(IN_WINDOW), config: makeConfig(), promoPurchaseCount: count }),
        (err) => err.code === 'PROMO_CONFIG_INVALID',
      )
    }
  })

  await t.test('年付标价缺失 → PROMO_CONFIG_INVALID（不拿月付标价顶替）', () => {
    assert.throws(
      () => resolvePrice({
        plan: 'standard',
        period: 'year',
        now: new Date(IN_WINDOW),
        config: makeConfig({ listPriceYearlyCents: undefined }),
        promoPurchaseCount: 0,
      }),
      (err) => err.code === 'PROMO_CONFIG_INVALID',
    )
  })
})

test('promo-resolver：env 装配', async (t) => {
  await t.test('未设置开关 → enabled=false，窗口/价格/限购取默认值', () => {
    const config = loadStandardMonthlyPromoConfig({}, { listPriceCents: 5900, listPriceYearlyCents: 59000 })
    assert.strictEqual(config.enabled, false)
    assert.strictEqual(config.period, 'month')
    assert.strictEqual(config.plan, 'standard')
    assert.strictEqual(config.priceCents, 2900)
    assert.strictEqual(config.maxPurchasesPerUser, 3)
    assert.strictEqual(config.startsAt, PROMO_STANDARD_MONTHLY_DEFAULTS.startsAt)
    assert.strictEqual(config.endsAt, PROMO_STANDARD_MONTHLY_DEFAULTS.endsAt)
  })

  await t.test('PROMO_STANDARD_MONTHLY_ENABLED=1 → enabled=true', () => {
    const config = loadStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: '1' }, { listPriceCents: 5900, listPriceYearlyCents: 59000 })
    assert.strictEqual(config.enabled, true)
  })

  await t.test('任何非 "1" 的值都按关闭处理（fail-closed）', () => {
    for (const raw of ['true', 'yes', '0', ' 1 ', '']) {
      const config = loadStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: raw }, { listPriceCents: 5900, listPriceYearlyCents: 59000 })
      assert.strictEqual(config.enabled, raw === ' 1 ', `${JSON.stringify(raw)}`)
    }
  })

  await t.test('价格 / 窗口 / 限购可被 env 覆盖（运营调整不需改代码）', () => {
    const config = loadStandardMonthlyPromoConfig({
      PROMO_STANDARD_MONTHLY_ENABLED: '1',
      PROMO_STANDARD_MONTHLY_PRICE_CENTS: '1990',
      PROMO_STANDARD_MONTHLY_STARTS_AT: '2026-12-01T00:00:00+08:00',
      PROMO_STANDARD_MONTHLY_ENDS_AT: '2026-12-31T00:00:00+08:00',
      PROMO_STANDARD_MONTHLY_MAX_PURCHASES: '5',
    }, { listPriceCents: 5900, listPriceYearlyCents: 59000 })
    assert.strictEqual(config.priceCents, 1990)
    assert.strictEqual(config.maxPurchasesPerUser, 5)
    assert.strictEqual(config.startsAt, '2026-12-01T00:00:00+08:00')
    assert.strictEqual(config.endsAt, '2026-12-31T00:00:00+08:00')
  })

  await t.test('env 价格 ≥ 标价 → 装配期就抛错（启动 fail-fast）', () => {
    assert.throws(
      () => loadStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: '1', PROMO_STANDARD_MONTHLY_PRICE_CENTS: '5900' }, { listPriceCents: 5900, listPriceYearlyCents: 59000 }),
      (err) => err.code === 'PROMO_CONFIG_INVALID',
    )
  })

  await t.test('env 价格 / 限购非整数 → 装配期抛错', () => {
    for (const [key, value] of [['PROMO_STANDARD_MONTHLY_PRICE_CENTS', '29.9'], ['PROMO_STANDARD_MONTHLY_MAX_PURCHASES', '0']]) {
      assert.throws(
        () => loadStandardMonthlyPromoConfig({ [key]: value }, { listPriceCents: 5900, listPriceYearlyCents: 59000 }),
        (err) => err.code === 'PROMO_CONFIG_INVALID',
      )
    }
  })
})
