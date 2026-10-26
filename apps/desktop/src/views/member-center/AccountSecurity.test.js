import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive, ref } from 'vue'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

const identityCtx = {
  status: 'authenticated',
  user: { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' },
  displayName: '用户甲',
  loading: false,
  switchAccount: vi.fn(async () => true),
  signOut: vi.fn(async () => true),
}
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    status: ref(identityCtx.status),
    user: ref(identityCtx.user),
    displayName: ref(identityCtx.displayName),
    loading: ref(identityCtx.loading),
    error: ref(null),
    switchAccount: identityCtx.switchAccount,
    signOut: identityCtx.signOut,
  }),
}))

// reactive：组件 computed 依赖 store.error / sessions，测试里回调内改值
// 必须能触发重算（普通对象不会）。
const memberCtx = reactive({
  sessions: [{ id: 1, deviceId: 'dev-1', deviceName: 'PC-A', lastSeenAt: '2026-10-24T00:00:00Z' }],
  loading: false,
  error: null,
  revokeOtherSessions: vi.fn(async () => 1),
  // 单设备下线（2026-10-26）
  revokeSession: vi.fn(async () => true),
})
vi.mock('@/stores/member', () => ({
  useMemberStore: () => memberCtx,
}))

async function mountAccountSecurity() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const AccountSecurity = (await import('./AccountSecurity.vue')).default
  return mount(AccountSecurity, { global: { plugins: [pinia] } })
}

describe('member-center/AccountSecurity', () => {
  beforeEach(() => {
    memberCtx.error = null
    memberCtx.revokeOtherSessions = vi.fn(async () => 1)
  })

  describe('错误展示（P0-5：修复前静默）', () => {
    it('revoke 失败（store error）→ 本地化错误提示，不渲染裸码', async () => {
      // 真实链路：safeInvoke 捕获抛错 → error 落 MEMBER_REQUEST_FAILED；
      // mock 层直接置 store.error 模拟该终态（渲染层只认 error 字段）。
      memberCtx.revokeOtherSessions = vi.fn(async () => { memberCtx.error = 'MEMBER_REQUEST_FAILED'; return false })
      const wrapper = await mountAccountSecurity()
      await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
      await wrapper.vm.$nextTick()
      const alert = wrapper.find('[role="alert"]')
      expect(alert.exists()).toBe(true)
      expect(alert.text()).toBe('memberCenter.memberRequestFailed')
      memberCtx.error = null
    })

    it('权限错误 → 权限文案', async () => {
      memberCtx.revokeOtherSessions = vi.fn(async () => false)
      memberCtx.error = 'MEMBER_PERMISSION_REQUIRED'
      const wrapper = await mountAccountSecurity()
      expect(wrapper.find('[role="alert"]').text()).toBe('memberCenter.memberPermissionRequired')
    })

    it('无 error → 不渲染错误区', async () => {
      memberCtx.error = null
      const wrapper = await mountAccountSecurity()
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    })
  })

  describe('revoked 数量语义', () => {
    it('revoked > 0 → 成功提示（插值 key）', async () => {
      memberCtx.revokeOtherSessions = vi.fn(async () => 2)
      const wrapper = await mountAccountSecurity()
      await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
      await wrapper.vm.$nextTick()
      const result = wrapper.find('[data-testid="revoke-result"]')
      expect(result.text()).toBe('memberCenter.revokeSuccess')
      expect(result.classes()).toContain('is-success')
    })

    it('revoked === 0 → info 提示「没有其他设备」', async () => {
      memberCtx.revokeOtherSessions = vi.fn(async () => 0)
      const wrapper = await mountAccountSecurity()
      await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="revoke-result"]').exists()).toBe(true)
    })
  })

  it('会话列表正常渲染', async () => {
    const wrapper = await mountAccountSecurity()
    expect(wrapper.text()).toContain('PC-A')
  })

  // ── 当前设备标记（P1-4 + C1-13）────────────────────────────────
  describe('当前设备标记（is_current，弃用 index===0）', () => {
    beforeEach(() => {
      memberCtx.sessions = [
        { id: 1, deviceId: 'dev-1', deviceName: '办公室电脑', is_current: false, lastSeenAt: '2026-10-24T00:00:00Z' },
        { id: 2, deviceId: 'dev-2', deviceName: '我的笔记本', is_current: true, lastSeenAt: '2026-10-24T00:00:00Z' },
      ]
    })

    it('is_current=true 的那行显示「当前设备」徽章（不管它在第几位）', async () => {
      const wrapper = await mountAccountSecurity()
      const rows = wrapper.findAll('.member-center-list-item')
      expect(rows[0].text()).not.toContain('memberCenter.currentDevice')
      expect(rows[1].text()).toContain('memberCenter.currentDevice')
    })

    it('顺序翻转后徽章跟着 is_current 走（证明不再依赖位置）', async () => {
      memberCtx.sessions = [...memberCtx.sessions].reverse()
      const wrapper = await mountAccountSecurity()
      const rows = wrapper.findAll('.member-center-list-item')
      // 翻转后第一行是 is_current=true
      expect(rows[0].text()).toContain('memberCenter.currentDevice')
      expect(rows[1].text()).not.toContain('memberCenter.currentDevice')
    })

    it('全 false（合法态）→ 不标任何行，且显示「未识别当前设备」中性提示', async () => {
      memberCtx.sessions = memberCtx.sessions.map((s) => ({ ...s, is_current: false }))
      const wrapper = await mountAccountSecurity()
      const rows = wrapper.findAll('.member-center-list-item')
      rows.forEach((r) => expect(r.text()).not.toContain('memberCenter.currentDevice'))
      expect(wrapper.find('[data-testid="member-center-current-device-unknown"]').exists()).toBe(true)
    })

    it('字段缺失（旧数据/异常响应）→ 全 false 处理，不崩也不猜', async () => {
      memberCtx.sessions = [{ id: 1, deviceId: 'dev-1', deviceName: '办公室电脑' }]
      const wrapper = await mountAccountSecurity()
      const rows = wrapper.findAll('.member-center-list-item')
      expect(rows[0].text()).not.toContain('memberCenter.currentDevice')
    })
  })
})

describe('单设备下线（逐行下线）', () => {
  const CURRENT = 'ses-' + 'a'.repeat(32)
  const OTHER = 'ses-' + 'b'.repeat(32)

  beforeEach(() => {
    memberCtx.error = null
    memberCtx.revokeSession = vi.fn(async () => true)
    memberCtx.sessions = [
      { id: CURRENT, deviceId: 'dev-cur', deviceName: '我的笔记本', is_current: true, lastSeenAt: '2026-10-24T00:00:00Z' },
      { id: OTHER, deviceId: 'dev-old', deviceName: '旧笔记本', is_current: false, lastSeenAt: '2026-10-20T00:00:00Z' },
    ]
  })

  it('当前设备行不渲染「下线」按钮，其他设备行渲染', async () => {
    const wrapper = await mountAccountSecurity()
    expect(wrapper.find('[data-testid="session-revoke-' + CURRENT + '"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="session-revoke-' + OTHER + '"]').exists()).toBe(true)
  })

  it('点「下线」把该行会话 id 交给 store，并显示成功提示', async () => {
    const wrapper = await mountAccountSecurity()
    await wrapper.get('[data-testid="session-revoke-' + OTHER + '"]').trigger('click')
    await flushPromises()

    expect(memberCtx.revokeSession).toHaveBeenCalledWith(OTHER)
    expect(wrapper.get('[data-testid="session-revoke-one-result"]').text()).toBe('memberCenter.sessionsRevokeOneSuccess')
  })

  it('store 返回 false 时不显示成功提示（失败不能伪装成成功）', async () => {
    memberCtx.revokeSession = vi.fn(async () => false)
    const wrapper = await mountAccountSecurity()
    await wrapper.get('[data-testid="session-revoke-' + OTHER + '"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="session-revoke-one-result"]').exists()).toBe(false)
  })
})
