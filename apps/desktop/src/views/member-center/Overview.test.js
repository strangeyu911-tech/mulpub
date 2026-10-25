import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

// Phase 2「真概览」改造：
//   - 账号信息改为**摘要行**（头像 + 名称 + 状态徽章），不再整卡复制
//     「账号与安全」tab 的账号卡（P1-1 三重复制的收口）。
//   - 版本与权益合并且一卡（原「版本卡」「权益卡」两卡展示同一 plan，
//     是重复；A2 单一真源语义保留：entitlement 优先、本地 license 兜底）。
//   - 新增快捷入口卡（跳订阅 / 消息），把「概览」变成真正的导览页。
const identityCtx = {
  status: 'authenticated',
  user: { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' },
  displayName: '用户甲',
}
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    status: ref(identityCtx.status),
    user: ref(identityCtx.user),
    displayName: ref(identityCtx.displayName),
    loading: ref(false),
    error: ref(null),
  }),
}))

const emitSpy = vi.fn()
async function mountOverview(entitlement, licenseInfo) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const identityStore = useIdentityStore()
  identityStore.status = identityCtx.status
  identityStore.user = identityCtx.user
  identityStore.entitlement = entitlement
  const { useLicenseStore } = await import('@/stores/license')
  const licenseStore = useLicenseStore()
  licenseStore.info = licenseInfo
  licenseStore.load = vi.fn()
  const Overview = (await import('./Overview.vue')).default
  return mount(Overview, { global: { plugins: [pinia] } })
}

const FREE = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 0 }

describe('member-center/Overview（Phase 2 真概览）', () => {
  afterEach(() => {
    delete window.electronAPI
    emitSpy.mockClear()
  })

  it('pro entitlement：权益摘要同源显示 planPro + pro 徽标点亮', async () => {
    const wrapper = await mountOverview(
      { plan: 'pro', features: [], source: 'online', expiresAt: 1893456000, quota: null },
      FREE,
    )
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.planPro')
    expect(wrapper.get('[data-testid="member-center-entitlement-plan"]').text()).toContain('memberCenter.planPro')
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(true)
  })

  it('trial entitlement：摘要显示 planTrial，无 pro 徽标', async () => {
    const wrapper = await mountOverview(
      { plan: 'trial', features: [], source: 'online', expiresAt: 1893456000, quota: null },
      FREE,
    )
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.planTrial')
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(false)
  })

  it('entitlement 缺失时摘要回退本地 licenseStore', async () => {
    const wrapper = await mountOverview(null, FREE)
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.licenseFree')
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(false)
  })

  // ── P1-1：账号信息降为摘要行，不再整卡复制「账号与安全」────────────
  it('账号信息是摘要行（头像+名称+状态徽章），不是整卡', async () => {
    const wrapper = await mountOverview(null, FREE)
    // 摘要行容器存在（data-testid 保留，既有消费方不破）
    expect(wrapper.find('[data-testid="member-center-account-summary"]').exists()).toBe(true)
    // 「账号与安全」专属的卡标题不得出现在概览
    const text = wrapper.text()
    expect(text).not.toContain('memberCenter.sessionsTitle')
    // 头像与状态徽章仍在
    expect(wrapper.find('.member-center-avatar').exists()).toBe(true)
    expect(wrapper.find('.member-center-status-badge').exists()).toBe(true)
  })

  // ── 快捷入口：概览变成导览页 ────────────────────────────────────
  it('快捷入口卡渲染三个入口（订阅/订单/消息）', async () => {
    const wrapper = await mountOverview(null, FREE)
    const card = wrapper.get('[data-testid="member-center-shortcuts"]')
    expect(card.text()).toContain('memberCenter.navSubscription')
    expect(card.text()).toContain('memberCenter.navOrders')
    expect(card.text()).toContain('memberCenter.navMessages')
  })

  it('点击快捷入口向壳层发出 navigate 事件（带目标分区）', async () => {
    const wrapper = await mountOverview(null, FREE)
    await wrapper.get('[data-testid="shortcut-subscription"]').trigger('click')
    const events = wrapper.emitted('navigate')
    expect(events).toBeTruthy()
    expect(events[events.length - 1]).toEqual(['subscription'])
  })
})
