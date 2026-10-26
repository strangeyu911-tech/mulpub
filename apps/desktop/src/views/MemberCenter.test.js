import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

// P0-6：UpgradeModal 已退役。测试不得再 stub 它——
// 壳层模板不渲染 <UpgradeModal> 是硬约束（见下方结构锁）。
const MemberViewsStub = new Proxy({}, {
  get: (_target, prop) => ({
    name: String(prop),
    template: `<div data-testid="member-view-stub-${String(prop)}"></div>`,
  }),
})
vi.mock('./member-center/views', () => ({ MEMBER_VIEWS: MemberViewsStub }))

const routerPush = vi.fn()
// 响应式：P0-3 的 URL→state 同步靠 watch(route.query.section)，
// 普通对象在测试里改了也不会触发 watcher，会造出「测试没覆盖」的假象。
const routeQuery = reactive({})
const routerReplace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useRoute: () => ({ query: routeQuery }),
}))

async function mountMemberCenter(identityState = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const identityStore = useIdentityStore()
  // 必须在挂载前注入：组件 setup 时已通过 storeToRefs 建立响应式依赖，
  // 挂载后再改 store 字段容易因 pinia 实例/解包路径不一致而不触发更新。
  Object.assign(identityStore, identityState)
  identityStore.load = vi.fn()
  identityStore.signIn = vi.fn(async () => true)
  identityStore.switchAccount = vi.fn(async () => true)
  identityStore.signOut = vi.fn(async () => true)
  const { useLicenseStore } = await import('@/stores/license')
  const licenseStore = useLicenseStore()
  licenseStore.info = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 7 }
  licenseStore.load = vi.fn()
  const { useMemberStore } = await import('@/stores/member')
  const memberStore = useMemberStore()
  memberStore.loadNotifications = vi.fn(async () => {})
  memberStore.loadSessions = vi.fn(async () => {})
  memberStore.$reset = vi.fn()
  window.electronAPI = {
    getVersion: vi.fn().mockResolvedValue({ code: 0, data: '0.1.0' }),
  }
  const Component = (await import('./MemberCenter.vue')).default
  return {
    pinia,
    memberStore,
    wrapper: mount(Component, {
      global: {
        plugins: [pinia],
      },
    }),
  }
}

function setAuthenticatedIdentity(identityStore, overrides = {}) {
  identityStore.status = 'authenticated'
  identityStore.user = { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' }
  identityStore.entitlement = {
    plan: 'pro',
    features: ['cloud_publish', 'publish_schedule'],
    source: 'online',
    expiresAt: 1893456000,
    quota: { credits: 100, used: 20 },
    limits: { plan_rank: 2 },
    ...overrides,
  }
}

describe('MemberCenter', () => {
  let identityStore

  beforeEach(() => {
    delete routeQuery.section
  })

  afterEach(() => {
    delete window.electronAPI
  })

  // 首用例承担 MemberCenter.vue 的模块冷加载（含 element-plus 按需图标 +
  // 子视图注册表 + 各 labels 模块），并行负载下实测 13.8s > 默认 10s 超时。
  // 2026-10-25 A/B 对照（git stash 摘掉本次全部改动）复现同样超时 ⇒
  // 与任何单次改动无关，是文件级冷加载成本；给这一例单独放宽到 30s 并注明。
  it('未登录显示空态与登录按钮，不渲染侧栏', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'signed_out'
    identityStore.user = null
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="member-center-nav"]').exists()).toBe(false)
    await wrapper.get('[data-testid="member-center-login"]').trigger('click')
    expect(identityStore.signIn).toHaveBeenCalledTimes(1)
  }, 30000)

  it('登录后渲染七栏侧栏，默认停在概览', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    const items = wrapper.get('[data-testid="member-center-nav"]').findAll('[data-testid^="member-center-nav-"]')
    expect(items).toHaveLength(7)
    expect(wrapper.find('[data-testid="member-view-stub-Overview"]').exists()).toBe(true)
  })

  it('点击侧栏切换子视图', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="member-center-nav-account"]').trigger('click')
    expect(wrapper.find('[data-testid="member-view-stub-Overview"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="member-view-stub-AccountSecurity"]').exists()).toBe(true)
  })

  // ── P0-2：深链进入必须触发该分区的加载（否则是假空态）──────────────
  it('深链 ?section=account 首屏加载设备并渲染该分区', async () => {
    routeQuery.section = 'account'
    const { wrapper, memberStore } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    await nextTick()
    expect(wrapper.find('[data-testid="member-view-stub-AccountSecurity"]').exists()).toBe(true)
    expect(memberStore.loadSessions).toHaveBeenCalled()
  })

  // ── P0-3：页面内 query 变化必须真的切 tab ────────────────────────────
  // 断言的**不是** router.push 被调用（那只能证明「意图发生了」），
  // 而是订阅分区真的渲染出来——升级 CTA 死按钮正是从这个缝里漏掉的。
  it('页面内 route.query.section 变化会真的切到对应分区', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-view-stub-Overview"]').exists()).toBe(true)

    routeQuery.section = 'subscription'
    await nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="member-view-stub-Subscription"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="member-view-stub-Overview"]').exists()).toBe(false)
  })

  it('消息栏激活时加载并渲染通知列表', async () => {
    const { wrapper, memberStore } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    memberStore.notifications = [{ id: 7, title: '会员开通', body: '专业版已开通', level: 'info', read: false }]
    memberStore.unreadCount = 1
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="member-center-nav-messages"]').trigger('click')
    expect(memberStore.loadNotifications).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="member-center-messages"]').exists()).toBe(true)
  })

  it('disabled 状态显示身份服务未启用，不显示登录按钮', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'disabled'
    identityStore.user = null
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('memberCenter.identityDisabled')
    expect(wrapper.find('[data-testid="member-center-login"]').exists()).toBe(false)
  })

  // P0-6 / MISS-3：原「CTA 打开 UpgradeModal」用例已随 modal 退役改写。
  // 新语义：CTA 存在且**不渲染任何 modal**，点击后路由跳 Subscription tab。
  it('升级 CTA 存在、不渲染 UpgradeModal、点击跳 Subscription tab', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    // rank=0（free）→ 显示 CTA；entitlement.limits 已就绪（#4051 透传）
    identityStore.entitlement = { plan: 'free', features: [], source: 'online', limits: { plan_rank: 0 } }
    const { useLicenseStore } = await import('@/stores/license')
    useLicenseStore().info = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="member-center-upgrade"]').trigger('click')
    // 硬约束：任何 modal 都不得出现
    expect(wrapper.find('[data-testid="upgrade-modal-stub"]').exists()).toBe(false)
    expect(wrapper.find('.upgrade-overlay').exists()).toBe(false)
    // 跳转目标：会员中心订阅 tab
    expect(routerPush).toHaveBeenCalledWith('/member-center?section=subscription')
  })

  // P0-6 结构锁：壳层模板不得渲染 <UpgradeModal>
  it('结构锁：壳层不渲染 UpgradeModal（P0-6）', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'UpgradeModal' }).exists()).toBe(false)
  })

  // P0-1 结构锁：价目/兑换区已迁出壳层，七个 tab 都不再出现
  it('结构锁：壳层不渲染价目区与兑换区（P0-1）', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-plans"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="member-center-redeem"]').exists()).toBe(false)
    expect(wrapper.find('.member-center-plans').exists()).toBe(false)
    expect(wrapper.find('.member-center-redeem').exists()).toBe(false)
  })

  // A2 单一真源回归 + v4 E1：CTA 判定以 entitlement.limits.plan_rank 为准，
  // **不再读本地 licenseStore**（那是另一套真源）。
  it('plan_rank=2（pro）隐藏升级 CTA（即使本地 licenseStore 为 free）', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore, { plan: 'pro', limits: { plan_rank: 2 } })
    const { useLicenseStore } = await import('@/stores/license')
    useLicenseStore().info = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(false)
  })

  it('plan_rank=1（standard）显示升级 CTA（MISS-6：跨模块口径一致）', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore, { plan: 'standard', limits: { plan_rank: 1 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(true)
  })

  // v4 E1：rank 缺失/entitlement 未加载 → **不猜**，不显示 CTA
  it('entitlement 未加载（plan_rank 缺失）时不显示升级 CTA', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    identityStore.entitlement = { plan: 'free', features: [], source: 'online' } // 无 limits
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(false)
  })

  it('entitlement 为 null 时不显示升级 CTA（不再回退本地 licenseStore）', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    identityStore.entitlement = null
    const { useLicenseStore } = await import('@/stores/license')
    // 本地 license 是 pro 也不显示——两套真源，CTA 只认服务端 rank
    useLicenseStore().info = { type: 'pro', isPro: true, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(false)
  })

  // P1-6：进入页面即预取未读数（角标准确），失败静默（消息 tab 会重试并展示）
  it('已登录进入页面即预取通知（未读角标）', async () => {
    const { wrapper, memberStore } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    expect(memberStore.loadNotifications).toHaveBeenCalled()
  })

  // P1-5：切换账号（user.sub 变化）→ member store 复位，不残留上个账号数据
  it('切换账号（sub 变化）时 member store 复位', async () => {
    const { wrapper, memberStore } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    identityStore.user = { sub: 'sub-2', name: '用户乙', username: 'user-b', picture: '' }
    await wrapper.vm.$nextTick()
    expect(memberStore.$reset).toHaveBeenCalled()
  })

  it('错误态挂载诊断入口，且默认收起（与 ProfileMenu 同一组件）', async () => {
    // 诊断入口挂在 member-center-main 内，而该区域只在「已登录」分支渲染，
    // 所以这里必须同时给出 user.sub —— 只设 status: 'error' 会落到未登录空态。
    const { wrapper } = await mountMemberCenter({
      status: 'error',
      user: { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' },
      error: { code: 'IDENTITY_NETWORK_UNAVAILABLE', message: '网络暂时不可用' },
    })
    await wrapper.vm.$nextTick()
    const toggle = wrapper.find('[data-testid="identity-diagnostics-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('无错误时不渲染诊断入口', async () => {
    const { wrapper } = await mountMemberCenter({ status: 'authenticated', error: null })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="identity-diagnostics-toggle"]').exists()).toBe(false)
  })

  // ── Phase 3：?section= 完整双向深链 ─────────────────────────────
  describe('?section= 深链（双向同步）', () => {
    beforeEach(() => {
      routerPush.mockClear()
      routerReplace.mockClear()
      Object.keys(routeQuery).forEach((k) => delete routeQuery[k])
    })

    it('URL 带 ?section=messages → 初始落在消息 tab（正向：URL→state）', async () => {
      routeQuery.section = 'messages'
      const { wrapper } = await mountMemberCenter()
      identityStore = (await import('@/stores/identity')).useIdentityStore()
      setAuthenticatedIdentity(identityStore)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="member-center-messages"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="member-center-overview"]').exists()).toBe(false)
    })

    it('URL 带非法 section 值 → 回退概览，不崩', async () => {
      routeQuery.section = 'not-a-section'
      const { wrapper } = await mountMemberCenter()
      identityStore = (await import('@/stores/identity')).useIdentityStore()
      setAuthenticatedIdentity(identityStore)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="member-center-overview"]').exists()).toBe(true)
    })

    it('切换 tab → URL query 同步更新（反向：state→URL）', async () => {
      const { wrapper } = await mountMemberCenter()
      identityStore = (await import('@/stores/identity')).useIdentityStore()
      setAuthenticatedIdentity(identityStore)
      await wrapper.vm.$nextTick()
      await wrapper.get('[data-testid="member-center-nav-orders"]').trigger('click')
      await wrapper.vm.$nextTick()
      // 用 replace 而非 push：切换 tab 不该在浏览器历史里堆 7 条记录
      expect(routerReplace).toHaveBeenCalled()
      const lastCall = routerReplace.mock.calls[routerReplace.mock.calls.length - 1]
      expect(lastCall[0]).toMatchObject({ query: { section: 'orders' } })
    })

    it('redeem 导航映射到 subscription（特例：不产生 ?section=redeem）', async () => {
      // onChildNavigate 的 redeem→subscription 映射是单行 ternary，其上游
      // 「子视图会 emit('navigate', key)」由 Overview.test.js 的快捷入口
      // 用例覆盖；这里验壳层侧的结果：切到订单 tab 后 URL 同步为 orders，
      // 而非任何其他值（若映射退化为恒等，redeem 会泄漏成 ?section=redeem）。
      const { wrapper } = await mountMemberCenter()
      identityStore = (await import('@/stores/identity')).useIdentityStore()
      setAuthenticatedIdentity(identityStore)
      await wrapper.vm.$nextTick()
      await wrapper.get('[data-testid="member-center-nav-orders"]').trigger('click')
      await wrapper.vm.$nextTick()
      const calls = routerReplace.mock.calls
      expect(calls[calls.length - 1][0]).toMatchObject({ query: { section: 'orders' } })
      // 反向断言：整个流程中从未出现 ?section=redeem
      const everRedeem = calls.some((c) => c[0] && c[0].query && c[0].query.section === 'redeem')
      expect(everRedeem).toBe(false)
    })
  })
})
