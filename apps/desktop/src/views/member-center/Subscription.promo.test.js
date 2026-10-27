import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import fs from 'node:fs'

// i18n 桩回键名并记录插值参数：金额/天数是否**来自服务端字段**只有看 params 才能断言。
const { i18nCalls } = vi.hoisted(() => ({ i18nCalls: [] }))
vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({
    t: (key, params) => { i18nCalls.push({ key, params }); return key },
  }),
}))

const WeChatPayDialogStub = {
  name: 'WeChatPayDialog',
  props: ['open', 'plan', 'period', 'reuseOrderId'],
  emits: ['close', 'paid'],
  template: '<div data-testid="wechat-pay-dialog-stub" />',
}

const identityCtx = { status: 'authenticated', user: { sub: 'sub-1' }, isAuthenticated: true, entitlement: null, plans: null }
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    status: ref(identityCtx.status),
    user: ref(identityCtx.user),
    displayName: ref('用户甲'),
    loading: ref(false),
    error: ref(null),
  }),
}))
vi.mock('@/stores/member', () => ({ useMemberStore: () => ({ redeemCode: vi.fn(), error: null }) }))
vi.mock('@/api/identity', () => ({ onIdentityStateChanged: () => () => {} }))

const STANDARD_PROMO = {
  id: 'standard',
  label: '标准版',
  currency: 'CNY',
  priceMonthlyCents: 2900,          // 服务端下发的**实收价**
  listPriceMonthlyCents: 5900,      // 标价：只用于「已用完」文案
  priceYearlyCents: 59000,
  promotion: { id: 'standard-monthly-half', endsAt: '2027-01-31T16:00:00.000Z', remainingDays: 42, exhausted: false },
}

async function mountSubscription(plans) {
  identityCtx.plans = plans
  identityCtx.entitlement = { plan: 'free', features: [], source: 'online', expiresAt: null, limits: { plan_rank: 0 } }
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const store = useIdentityStore()
  store.status = identityCtx.status
  store.user = identityCtx.user
  store.entitlement = identityCtx.entitlement
  store.plans = plans
  store.load = vi.fn(() => true)
  const Subscription = (await import('./Subscription.vue')).default
  return mount(Subscription, {
    global: { plugins: [pinia], stubs: { WeChatPayDialog: WeChatPayDialogStub } },
  })
}

describe('member-center/Subscription：标准版月付促销展示', () => {
  beforeEach(() => { i18nCalls.length = 0 })

  it('呈现服务端实收价 ¥29 + 活动角标（剩余天数来自 promotion.remainingDays）', async () => {
    const wrapper = await mountSubscription([STANDARD_PROMO])
    expect(wrapper.get('[data-testid="plan-standard-price"]').text()).toContain('¥29')
    expect(wrapper.get('[data-testid="plan-standard-price-promo"]').exists()).toBe(true)
    const badge = i18nCalls.find((call) => call.key === 'memberCenter.planPromoBadge')
    expect(badge).toBeTruthy()
    expect(badge.params).toEqual({ days: 42 })
  })

  it('不划线、不展示标价：月付价从 ¥29 开头且没有 del/s 元素', async () => {
    const wrapper = await mountSubscription([STANDARD_PROMO])
    const priceNode = wrapper.get('[data-testid="plan-standard-price"]')
    const priceText = priceNode.text()
    // ⚠️ 不能断言「不含 ¥59」：年付价 ¥590 自带这个前缀（弱断言会假红）。
    // 真正要锁的是「月付价就是实收价，且没有划线原价节点」。
    expect(priceText.startsWith('¥29')).toBe(true)
    expect(priceText).not.toContain('5900')
    expect(priceNode.find('del').exists()).toBe(false)
    expect(priceNode.find('s').exists()).toBe(false)
  })

  it('额度用尽 → 按钮**下单前**显示「活动价已用完，¥59/月」', async () => {
    const exhausted = {
      ...STANDARD_PROMO,
      priceMonthlyCents: 5900,
      promotion: { ...STANDARD_PROMO.promotion, exhausted: true },
    }
    const wrapper = await mountSubscription([exhausted])
    expect(wrapper.get('[data-testid="plan-standard-buy"]').text()).toBe('memberCenter.planPromoExhausted')
    const call = i18nCalls.find((item) => item.key === 'memberCenter.planPromoExhausted')
    expect(call.params).toEqual({ price: '¥59' })
  })

  it('结束前 7 天 → 会员中心显示续费预告（日期与价格均来自服务端）', async () => {
    const endingSoon = {
      ...STANDARD_PROMO,
      promotion: { ...STANDARD_PROMO.promotion, remainingDays: 5 },
    }
    const wrapper = await mountSubscription([endingSoon])
    expect(wrapper.get('[data-testid="member-center-promo-ending"]').exists()).toBe(true)
    const call = i18nCalls.find((item) => item.key === 'memberCenter.promoEndingSoon')
    expect(call).toBeTruthy()
    expect(call.params.price).toBe('¥59')
    expect(typeof call.params.date).toBe('string')
  })

  it('剩余天数 > 7 → 不显示续费预告', async () => {
    const wrapper = await mountSubscription([STANDARD_PROMO])
    expect(wrapper.find('[data-testid="member-center-promo-ending"]').exists()).toBe(false)
  })

  // 金额必须来自服务端：前端任何一处硬编码 2900 都会让「运营改价」变成代码发布。
  it('前端源码不含 2900 字面量（金额只能来自 /api/v1/plans）', () => {
    const files = ['./Subscription.vue', './PlanPriceTag.vue', './labels.js']
    for (const file of files) {
      const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, `${file} 出现硬编码 2900`).not.toMatch(/\b2900\b/)
    }
  })
})
