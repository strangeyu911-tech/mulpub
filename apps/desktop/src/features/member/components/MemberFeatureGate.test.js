// @ts-check
/**
 * MemberFeatureGate.test.js — 会员功能整页门禁（P1-1）
 *
 * 真实组件；身份 store / router 用 mock。重点锁三件事：
 * 1. 免费档（features 不含目标 key）显示锁定页，slot 不挂载；
 * 2. 标准/专业档（features 含目标 key）直接渲染 slot；
 * 3. entitlement 缺失时 fail-open（缺失即放行，旧快照不误拦）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const { mockPush, store } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  store: {
    entitlement: null,
    load: vi.fn(async () => true),
  },
}))

vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => store,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import MemberFeatureGate from './MemberFeatureGate.vue'

function mountGate (entitlement) {
  store.entitlement = entitlement
  store.load.mockClear()
  return mount(MemberFeatureGate, {
    props: { featureKey: 'video_create', title: '视频创作' },
    slots: { default: '<div data-testid="gate-allowed">allowed</div>' },
    global: {
      plugins: [i18n],
      stubs: { 'el-icon': true },
    },
  })
}

describe('MemberFeatureGate — 功能开关整页门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('免费档：显示锁定页、slot 不挂载、CTA 跳会员中心订阅区', async () => {
    const w = mountGate({
      plan: 'free',
      features: ['cloud_publish', 'ai_write', 'official_credit'],
    })
    await nextTick()

    expect(w.find('[data-testid="member-feature-gate-locked"]').exists()).toBe(true)
    expect(w.find('[data-testid="gate-allowed"]').exists()).toBe(false)
    expect(w.text()).toContain('视频创作')
    expect(w.text()).toContain('标准版及以上功能')

    await w.get('[data-testid="member-feature-gate-upgrade"]').trigger('click')
    expect(mockPush).toHaveBeenCalledWith({
      path: '/member-center',
      query: { section: 'subscription' },
    })
  })

  it('标准/专业档含 video_create：直接渲染 slot', async () => {
    const w = mountGate({
      plan: 'standard',
      features: ['cloud_publish', 'ai_write', 'video_create'],
    })
    await nextTick()

    expect(w.find('[data-testid="gate-allowed"]').exists()).toBe(true)
    expect(w.find('[data-testid="member-feature-gate-locked"]').exists()).toBe(false)
  })

  it('entitlement 缺失：fail-open 渲染 slot（缺失即放行）', async () => {
    const w = mountGate(null)
    await nextTick()
    await nextTick()

    expect(store.load).toHaveBeenCalledTimes(1)
    expect(w.find('[data-testid="gate-allowed"]').exists()).toBe(true)
    expect(w.find('[data-testid="member-feature-gate-locked"]').exists()).toBe(false)
  })
})
