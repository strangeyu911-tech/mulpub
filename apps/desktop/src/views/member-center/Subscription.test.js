import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

// i18n 桩回**键名**（不是译文）⇒ 插值参数看不到 ⇒ 「档位出现两次」这类问题无法从渲染文本里看出来。
// ⇒ 额外把每次 t(key, params) 的参数记下来，供断言用（`vi.hoisted` 才能在 mock 工厂里引用）。
const { i18nCalls } = vi.hoisted(() => ({ i18nCalls: [] }))
vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({
    t: (key, params) => { i18nCalls.push({ key, params }); return key },
  }),
}))

// WeChatPayDialog 是 defineAsyncComponent——挂载时会真去 import 组件链。
// 测试里替换为轻量 stub（与 MemberCenter.test.js 的 UpgradeModalStub 同模式）。
const WeChatPayDialogStub = {
  name: 'WeChatPayDialog',
  props: ['open', 'plan', 'period', 'reuseOrderId'],
  emits: ['close', 'paid'],
  template: '<div data-testid="wechat-pay-dialog-stub" />',
}

const identityCtx = {
  status: 'authenticated',
  user: { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' },
  isAuthenticated: true,
  entitlement: null,
  plans: null,
  loadResult: true,
}
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    status: ref(identityCtx.status),
    user: ref(identityCtx.user),
    displayName: ref('用户甲'),
    loading: ref(false),
    error: ref(null),
  }),
}))

const memberCtx = {
  redeemCode: vi.fn(async () => ({ idempotent: false, plan: 'pro', periodEnd: '2026-11-24T00:00:00Z' })),
  error: null,
}
vi.mock('@/stores/member', () => ({
  useMemberStore: () => memberCtx,
}))

// Phase 2 链路加固：onPaid 在 load() 被占用（返回 false）时要挂
// state-changed 单次兜底。mock 掉 onIdentityStateChanged 以断言挂载/注销行为。
const stateChangedHandlers = []
vi.mock('@/api/identity', () => ({
  onIdentityStateChanged: (cb) => {
    stateChangedHandlers.push(cb)
    return () => {
      const i = stateChangedHandlers.indexOf(cb)
      if (i >= 0) stateChangedHandlers.splice(i, 1)
    }
  },
}))

async function mountSubscription() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const identityStore = useIdentityStore()
  identityStore.status = identityCtx.status
  identityStore.user = identityCtx.user
  identityStore.entitlement = identityCtx.entitlement
  identityStore.plans = identityCtx.plans
  identityStore.load = vi.fn(() => identityCtx.loadResult)
  const Subscription = (await import('./Subscription.vue')).default
  return {
    pinia,
    identityStore,
    wrapper: mount(Subscription, {
      global: {
        plugins: [pinia],
        stubs: { WeChatPayDialog: WeChatPayDialogStub },
      },
    }),
  }
}

describe('member-center/Subscription', () => {
  beforeEach(() => {
    identityCtx.entitlement = null
    identityCtx.plans = null
    identityCtx.loadResult = true
    memberCtx.error = null
    stateChangedHandlers.length = 0
  })

  // ── 降档：产品明确不支持 ⇒ 只给说明、不给按钮 ──────────────────────
  // 为什么断言「没有按钮」：留一张点不动的卡（或一个点了没反应的按钮）比不给入口更糟，
  // 它会让用户以为产品有 bug。这里锁住形状：只有文案，没有可点击的降档控件。
  it('价目区给出降档说明，且不提供任何可点击的降档控件', async () => {
    identityCtx.entitlement = { plan: 'pro', features: [], source: 'online', expiresAt: null, quota: null, limits: { plan_rank: 2 } }
    identityCtx.plans = [
      { id: 'free', label: '免费版', priceMonthlyCents: 0, priceYearlyCents: 0, currency: 'CNY' },
      { id: 'standard', label: '标准版', priceMonthlyCents: 5900, priceYearlyCents: 59000, currency: 'CNY' },
      { id: 'pro', label: '专业版', priceMonthlyCents: 9900, priceYearlyCents: 99000, currency: 'CNY' },
    ]
    const { wrapper } = await mountSubscription()
    const hint = wrapper.find('[data-testid="member-center-downgrade-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('memberCenter.planDowngradeHint')
    expect(wrapper.findAll('[data-testid^="plan-downgrade"]')).toHaveLength(0)
    // standard 卡（低于当前档）不可购买、也不标「当前方案」
    expect(wrapper.get('[data-testid="plan-standard"]').attributes('aria-disabled')).toBe('true')
  })

  // ── 价目三态（从壳层迁入后的落点）────────────────────────────────
  describe('价目三态', () => {
    it('plans === null → 「暂不可用」，不渲染卡片列表', async () => {
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="plans-unavailable"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="plan-free"]').exists()).toBe(false)
    })

    it('plans === [] → 「暂无套餐」', async () => {
      identityCtx.plans = []
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="plans-empty"]').exists()).toBe(true)
    })

    it('有数据 → 每档渲染卡片 + 价格', async () => {
      identityCtx.plans = [
        { id: 'free', label: '免费版', currency: 'CNY', priceMonthlyCents: 0, priceYearlyCents: 0 },
        { id: 'standard', label: '标准版', currency: 'CNY', priceMonthlyCents: 5900, priceYearlyCents: 59000 },
        { id: 'pro', label: '专业版', currency: 'CNY', priceMonthlyCents: 11900, priceYearlyCents: 119000 },
      ]
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="plan-standard"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="plan-standard-price"]').text()).toContain('¥59')
      expect(wrapper.get('[data-testid="plan-pro-price"]').text()).toContain('¥119')
      // ⚠ 年付价也必须被断言（2026-10-25 定价定案时补）：上面两条 `toContain('¥59')` / `toContain('¥119')`
      // 是**前缀弱断言** —— '¥590' 也含 '¥59'、'¥1190' 也含 '¥119' ⇒ 年付价从 ¥499/¥999 改成
      // ¥590/¥1190 时它们**照样绿** ⇒ 旧口径漏了过去。这两条用完整金额才有区分力。
      expect(wrapper.get('[data-testid="plan-standard-price"]').text()).toContain('¥590')
      expect(wrapper.get('[data-testid="plan-pro-price"]').text()).toContain('¥1190')
    })
  })

  // ── 可购买化（v4 E6：单一入口）───────────────────────────────────
  describe('价目卡可购买', () => {
    beforeEach(() => {
      identityCtx.plans = [
        { id: 'free', label: '免费版', currency: 'CNY', priceMonthlyCents: 0, priceYearlyCents: 0 },
        { id: 'standard', label: '标准版', currency: 'CNY', priceMonthlyCents: 5900, priceYearlyCents: 59000 },
        { id: 'pro', label: '专业版', currency: 'CNY', priceMonthlyCents: 11900, priceYearlyCents: 119000 },
      ]
      identityCtx.entitlement = { plan: 'free', features: [], source: 'online', limits: { plan_rank: 0 } }
    })

    it('点击标准版卡片 → 打开支付弹窗且携带 plan/period', async () => {
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="plan-standard"]').trigger('click')
      const dialog = wrapper.findComponent({ name: 'WeChatPayDialog' })
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('plan')).toBe('standard')
      expect(dialog.props('period')).toBe('month')
    })

    // 键盘可达性的**行为锁**（2026-10-25）：套餐 li 带 role="button"（可购买时），
    // Space 键是它唯一的键盘激活路径（#4416 补的 @keydown.space.prevent）。
    // ⚠️ 为什么必须在这里单独锁：合同测试（clickable-roles.contract.test.js）的
    // 「键盘处理必须逐字镜像鼠标处理」只遍历 **fixed**（静态 role="button"）的站点，
    // 而这个站点的 role 是**条件绑定**（`:role="canBuyPlan(plan.id) ? 'button' : undefined"`）
    // ⇒ 它在合同测试里算「缺口」⇒ 那条断言**遍历不到它** ⇒ 没有本用例的话，
    // 谁把 @keydown.space.prevent 删掉，没有任何测试会红（#4416 合入后就是这种状态）。
    it('键盘 Space 必须与点击同出口（可购买套餐卡）', async () => {
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="plan-standard"]').trigger('keydown.space')
      const dialog = wrapper.findComponent({ name: 'WeChatPayDialog' })
      expect(dialog.props('open'), 'Space 必须与点击同出口（不得只认 Enter）').toBe(true)
      expect(dialog.props('plan')).toBe('standard')
      expect(dialog.props('period')).toBe('month')
    })

    it('当前档（free）卡片不渲染购买入口', async () => {
      const { wrapper } = await mountSubscription()
      const freeCard = wrapper.get('[data-testid="plan-free"]')
      expect(freeCard.text()).toContain('memberCenter.planBuyCurrent')
    })

    it('更高档（pro）卡片渲染购买按钮', async () => {
      const { wrapper } = await mountSubscription()
      const proCard = wrapper.get('[data-testid="plan-pro"]')
      expect(proCard.text()).toContain('memberCenter.planBuyCta')
    })

    it('购买区与卡片是同一路径：不存在独立的 purchase-*-* 按钮组', async () => {
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="purchase-standard-month"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="member-center-purchase"]').exists()).toBe(false)
    })
  })

  // ── feature 本地化（P0-4）────────────────────────────────────────
  describe('feature 本地化', () => {
    it('已知 feature → 本地化键', async () => {
      identityCtx.entitlement = {
        plan: 'pro', features: ['cloud_publish', 'ai_write'], source: 'online', limits: { plan_rank: 2 },
      }
      const { wrapper } = await mountSubscription()
      const text = wrapper.get('[data-testid="member-center-features"]').text()
      expect(text).toContain('memberCenter.feature.cloud_publish')
      expect(text).not.toContain('cloud_publish\n') // 不再裸渲染原文
    })

    it('未知 feature → 回退原文', async () => {
      identityCtx.entitlement = {
        plan: 'pro', features: ['future_feature'], source: 'online', limits: { plan_rank: 2 },
      }
      const { wrapper } = await mountSubscription()
      expect(wrapper.get('[data-testid="member-center-features"]').text()).toContain('future_feature')
    })
  })

  // ── 宽限期（v4 新增）─────────────────────────────────────────────
  describe('宽限期展示', () => {
    it('graceUntil 存在 → 宽限徽标 + 当前档（降级后）+ 宽限提示', async () => {
      identityCtx.entitlement = {
        plan: 'free', features: [], source: 'online', limits: { plan_rank: 0 },
        graceUntil: '2026-11-01T00:00:00Z', previousPlan: 'pro',
      }
      const { wrapper } = await mountSubscription()
      const text = wrapper.get('[data-testid="member-center-subscription-detail"]').text()
      expect(text).toContain('memberCenter.graceTitle')
      // 档位名走当前 plan（free）——宽限期里用户就是免费档；
      // previousPlan 经 graceHint 插值进入提示文案（见 labels.graceState 单测）。
      expect(text).toContain('memberCenter.planFree')
      expect(text).toContain('memberCenter.graceHint')
    })

    it('graceUntil 缺失 → 正常到期展示，无宽限徽标', async () => {
      identityCtx.entitlement = {
        plan: 'pro', features: [], source: 'online', expiresAt: 1893456000, limits: { plan_rank: 2 },
      }
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="member-center-grace"]').exists()).toBe(false)
    })

    it('graceUntil 非法 ISO → 不渲染宽限徽标（不崩）', async () => {
      identityCtx.entitlement = {
        plan: 'free', features: [], source: 'online', limits: { plan_rank: 0 }, graceUntil: 'not-a-date',
      }
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="member-center-grace"]').exists()).toBe(false)
    })
  })

  // ── 兑换本地前置校验（P1-8 / MISS-9）─────────────────────────────
  describe('兑换前置校验', () => {
    it('合法码 → 调用 store.redeemCode', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('ABCD-EFGH-JKMN')
      await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
      expect(memberCtx.redeemCode).toHaveBeenCalledWith('ABCD-EFGH-JKMN')
    })

    it('含禁用字符（I/O/0/1）→ 本地拦截，不发请求', async () => {
      memberCtx.redeemCode.mockClear()
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="redeem-code-input"]').setValue('ABCD-EFGH-IKMN')
      await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
      expect(memberCtx.redeemCode).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="redeem-result-error"]').exists()).toBe(true)
    })

    // F12（2026-10-25 独立复评）：成功文案把「plan · end」的**组合串**塞进 `{end}`
    // ⇒ 渲染成「已开通 专业版，有效期至 专业版 · 2026/11/24」⇒ **档位出现两次**。
    // 该缺陷是**既有的**（origin/main 同形），但本 PR 重写的用户手册把这条文案写进了
    // 「结果提示」表 ⇒ 手册与实现必须对得上 ⇒ 顺带修掉并钉死。
    it('兑换成功文案：档位**只出现一次**，且用显示名（不漏原始 id）', async () => {
      memberCtx.redeemCode.mockClear()
      // ⚠️ i18nCalls 是模块级的、**跨用例累积** ⇒ 本用例先清空，只看自己这次的调用。
      i18nCalls.length = 0
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="redeem-code-input"]').setValue('ABCD-EFGH-JKMN')
      await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
      await flushPromises()
      // ⚠️ i18n 桩回键名、不做插值 ⇒ 断言落在**插值参数**上（渲染文本里只有键名）。
      const calls = i18nCalls.filter((c) => c.key === 'memberCenter.redeemSuccess')
      expect(calls.length).toBe(1)
      const params = calls[0].params || {}
      // {plan} 必须是**显示名**（经 planLabelOf）而不是原始 id
      expect(params.plan).toBeTruthy()
      expect(params.plan).not.toBe('pro')
      expect(params.plan).not.toBe('standard')
      // {end} 只能是日期本身：把「档位 · 日期」的组合串塞进 {end} ⇒ 档位出现两次
      expect(params.end).toBeTruthy()
      expect(String(params.end)).not.toContain(params.plan)
      // ⚠️ 日期是 `toLocaleDateString()` ⇒ **顺序随运行环境 locale 变**（en-US 是 11/24/2026，
      // zh-CN 是 2026/11/24）⇒ 断言必须与顺序无关。
      expect(String(params.end)).toMatch(/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/)
    })

    it('长度不足 → 本地拦截', async () => {
      memberCtx.redeemCode.mockClear()
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="redeem-code-input"]').setValue('ABC-EFG')
      await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
      expect(memberCtx.redeemCode).not.toHaveBeenCalled()
    })

    it('兑换被限流（两个 429 源）都显示「尝试过于频繁」，不落成「网络错误」', async () => {
      // ⚠️ 锁的是**用户看到什么**，不是映射表里的键名：
      // 第 3 轮实测：把映射键名打错一个字母，32 个桌面端测试 + locale 门禁**全绿**，
      // 而用户看到的 429 文案静默退化成「网络错误」⇒ 当时**零测试覆盖**。
      for (const code of ['REDEEM_RATE_LIMITED', 'RATE_LIMIT_EXCEEDED']) {
        memberCtx.redeemCode.mockResolvedValueOnce(null)
        memberCtx.error = code
        const { wrapper } = await mountSubscription()
        await wrapper.get('[data-testid="redeem-code-input"]').setValue('ABCD-EFGH-JKMN')
        await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
        await flushPromises()
        expect(wrapper.get('[data-testid="redeem-result-error"]').text()).toBe('memberCenter.redeemErrRateLimited')
        wrapper.unmount()
      }
      memberCtx.error = null
    })

    it('输入自动转大写（服务端语义对齐）', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('abcd-efgh-jkmn')
      expect(input.element.value).toBe('ABCD-EFGH-JKMN')
    })
  })

  // ── 兑换输入归一化（组件级）──────────────────────────────────────
  // 上一组只锁了「大写」；本组锁住**接线**本身（@input 是不是真的调了归一化函数），
  // 纯函数级的锁在 `redeem-code-input.test.js`。
  describe('兑换输入归一化（组件级接线）', () => {
    it('缺连字符 → 自动补成 4-4-4', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('abcdefghjkmn')
      expect(input.element.value).toBe('ABCD-EFGH-JKMN')
    })

    it('易混淆字符（I/L/O/0/1）**保留原样**（不悄悄纠正）', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('abcd-efgh-ikmn')
      expect(input.element.value).toBe('ABCD-EFGH-IKMN')
    })

    it('超出 12 位 → 截断到 12 位（4-4-4，共 14 字符含连字符）', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('ABCDEFGHJKMNEXTRA')
      expect(input.element.value).toBe('ABCD-EFGH-JKMN')
    })

    it('归一化后仍是 14 个字符（12 码 + 2 连字符）⇒ 不会撞 maxlength', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('ABCDEFGHJKMN')
      expect(input.element.value).toHaveLength(14)
    })
  })

  // ── 支付成功后的权益刷新兜底（Phase 2 链路加固）───────────────────
  describe('onPaid 权益刷新兜底', () => {
    it('load() 成功（返回 true）→ 不挂兜底监听', async () => {
      identityCtx.loadResult = true
      const { wrapper } = await mountSubscription()
      wrapper.findComponent({ name: 'WeChatPayDialog' }).vm.$emit('paid')
      await flushPromises()
      expect(stateChangedHandlers).toHaveLength(0)
    })

    it('load() 被占用（返回 false）→ 挂单次 state-changed 兜底', async () => {
      identityCtx.loadResult = false
      const { wrapper } = await mountSubscription()
      wrapper.findComponent({ name: 'WeChatPayDialog' }).vm.$emit('paid')
      await flushPromises()
      expect(stateChangedHandlers.length).toBeGreaterThan(0)
    })

    it('兜底监听收到快照推送后自行注销（不永久挂）', async () => {
      identityCtx.loadResult = false
      const { wrapper } = await mountSubscription()
      wrapper.findComponent({ name: 'WeChatPayDialog' }).vm.$emit('paid')
      await flushPromises()
      expect(stateChangedHandlers).toHaveLength(1)
      // 模拟服务端推送快照 → 监听应自行注销
      stateChangedHandlers[0]()
      expect(stateChangedHandlers).toHaveLength(0)
    })

    it('组件卸载时兜底监听被清理（无泄漏）', async () => {
      identityCtx.loadResult = false
      const { wrapper } = await mountSubscription()
      wrapper.findComponent({ name: 'WeChatPayDialog' }).vm.$emit('paid')
      await flushPromises()
      expect(stateChangedHandlers).toHaveLength(1)
      wrapper.unmount()
      // ⚠️ 这条断言来自主干（#4428 的「onPaid 权益刷新兜底」块），本 PR 合并 origin/main 时
      // 在冲突解决里**误删**过一次 ⇒ 用例标题还在说「无泄漏」，断言却没了
      // ⇒ 标题与断言脱节 ⇒ 泄漏真的发生也不会红。
      // ⇒ 独立复评 F3 实测：把它加回去后 26/26 仍全绿 ⇒ 删除**没有任何功能上的必要性**。
      expect(stateChangedHandlers).toHaveLength(0)
    })
  })
})
