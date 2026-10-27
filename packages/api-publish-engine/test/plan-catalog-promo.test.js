'use strict'
/**
 * 价目目录的促销字段（GET /api/v1/plans 的对外契约）。
 *
 * 两条不可让的语义（决策表第 5、6 行 + 技术要点 4）：
 *   ① `priceMonthlyCents` 必须保持「**实收价**」语义 —— 前端零改动就能显示 ¥29；
 *      `listPriceMonthlyCents` 是标价（仅用于「已用完」文案与服务端校验），
 *      **前端不得划线展示原价**（本文件只锁契约，展示口径见 PRD §6.3）。
 *   ② `promotion` 只在标准版月付上出现；年付/专业版/免费版恒为 null。
 */

const test = require('node:test')
const assert = require('node:assert')

const {
  getPlanCatalog,
  buildStandardMonthlyPromoConfig,
} = require('../src/auth/plan-matrix')
const { PROMO_ID } = require('../src/auth/promo-resolver')

const IN_WINDOW = new Date('2026-12-01T00:00:00+08:00')

function catalogOf(promoPurchaseCount, env = { PROMO_STANDARD_MONTHLY_ENABLED: '1' }) {
  const promoConfig = buildStandardMonthlyPromoConfig(env, null)
  return getPlanCatalog(null, { now: IN_WINDOW, promoConfig, promoPurchaseCount })
}

const byId = (catalog, id) => catalog.find((item) => item.id === id)

test('plan catalog：无促销配置时保持既有契约', async (t) => {
  await t.test('三档都带 listPriceMonthlyCents，且等于实收价', () => {
    const catalog = getPlanCatalog()
    for (const item of catalog) {
      assert.strictEqual(item.listPriceMonthlyCents, item.priceMonthlyCents, `${item.id} 的标价应等于实收价`)
      assert.strictEqual(item.promotion, null, `${item.id} 无促销时 promotion 必须为 null`)
    }
    assert.strictEqual(byId(catalog, 'standard').priceMonthlyCents, 5900)
  })

  await t.test('年付价不受促销影响', () => {
    assert.strictEqual(byId(getPlanCatalog(), 'standard').priceYearlyCents, 59000)
  })
})

test('plan catalog：促销生效期的价格与 promotion 字段', async (t) => {
  await t.test('count=0 → 标准版实收 2900、标价 5900、剩余 62 天', () => {
    const standard = byId(catalogOf(0), 'standard')
    assert.strictEqual(standard.priceMonthlyCents, 2900, '实收价语义：前端直接显示 ¥29')
    assert.strictEqual(standard.listPriceMonthlyCents, 5900, '标价必须单独下发，供「已用完」文案')
    assert.strictEqual(standard.promotion.id, PROMO_ID)
    assert.strictEqual(standard.promotion.remainingDays, 62)
    assert.strictEqual(standard.promotion.exhausted, false)
    assert.strictEqual(standard.priceYearlyCents, 59000, '年付不动')
  })

  await t.test('count=3 → 实收回到 5900，但 promotion.exhausted=true（UI 要出「已用完」）', () => {
    const standard = byId(catalogOf(3), 'standard')
    assert.strictEqual(standard.priceMonthlyCents, 5900)
    assert.strictEqual(standard.listPriceMonthlyCents, 5900)
    assert.strictEqual(standard.promotion.exhausted, true)
  })

  await t.test('专业版 / 免费版不出现 promotion', () => {
    const catalog = catalogOf(0)
    assert.strictEqual(byId(catalog, 'pro').promotion, null)
    assert.strictEqual(byId(catalog, 'pro').priceMonthlyCents, 11900)
    assert.strictEqual(byId(catalog, 'free').promotion, null)
  })

  await t.test('开关关闭 → 原价且无 promotion', () => {
    const standard = byId(catalogOf(0, { PROMO_STANDARD_MONTHLY_ENABLED: '0' }), 'standard')
    assert.strictEqual(standard.priceMonthlyCents, 5900)
    assert.strictEqual(standard.promotion, null)
  })
})

test('plan catalog：运营 overrides 是标价真源', async (t) => {
  await t.test('overrides 改标准版月付标价 → 促销配置的 listPriceCents 跟随', () => {
    const promoConfig = buildStandardMonthlyPromoConfig(
      { PROMO_STANDARD_MONTHLY_ENABLED: '1' },
      { standard: { priceMonthlyCents: 4900 } },
    )
    assert.strictEqual(promoConfig.listPriceCents, 4900)
    const standard = byId(getPlanCatalog({ standard: { priceMonthlyCents: 4900 } }, {
      now: IN_WINDOW,
      promoConfig,
      promoPurchaseCount: 0,
    }), 'standard')
    assert.strictEqual(standard.priceMonthlyCents, 2900)
    assert.strictEqual(standard.listPriceMonthlyCents, 4900)
  })

  await t.test('overrides 把标价压到促销价以下 → 抛 PROMO_CONFIG_INVALID（不静默）', () => {
    assert.throws(
      () => buildStandardMonthlyPromoConfig({ PROMO_STANDARD_MONTHLY_ENABLED: '1' }, { standard: { priceMonthlyCents: 2900 } }),
      (err) => err.code === 'PROMO_CONFIG_INVALID',
    )
  })
})
