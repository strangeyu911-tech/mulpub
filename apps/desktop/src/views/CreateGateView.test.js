// @ts-check
/**
 * CreateGateView.test.js — `/create` 会员功能门禁接线（P1-1）
 *
 * 只锁接线：路由包装层必须把 featureKey=video_create 交给 MemberFeatureGate，
 * 且把 CreateView 放进默认 slot。组件内部行为由 MemberFeatureGate.test.js 覆盖。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const { gateStub } = vi.hoisted(() => ({
  gateStub: {
    name: 'MemberFeatureGate',
    props: ['featureKey', 'title'],
    template: '<div data-testid="gate-stub" :data-feature="featureKey"><slot /></div>',
  },
}))

vi.mock('@/features/member/components/MemberFeatureGate.vue', () => ({ default: gateStub }))
vi.mock('@/views/CreateView.vue', () => ({
  default: { name: 'CreateView', template: '<div data-testid="create-view-stub" />' },
}))

import CreateGateView from './CreateGateView.vue'

describe('CreateGateView — /create 功能门禁接线', () => {
  it('把 video_create 交给 MemberFeatureGate，并把 CreateView 放进 slot', () => {
    const w = mount(CreateGateView, { global: { plugins: [i18n] } })

    const gate = w.get('[data-testid="gate-stub"]')
    expect(gate.attributes('data-feature')).toBe('video_create')
    expect(w.findComponent({ name: 'MemberFeatureGate' }).props('title')).toBe('视频创作')
    expect(w.find('[data-testid="create-view-stub"]').exists()).toBe(true)
  })
})
