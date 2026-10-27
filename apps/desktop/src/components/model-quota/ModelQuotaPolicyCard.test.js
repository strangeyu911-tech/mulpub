import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@/api/model-quota', () => ({
  modelQuotaGetPolicy: api.get,
  modelQuotaSetPolicy: api.set,
}))

import ModelQuotaPolicyCard from './ModelQuotaPolicyCard.vue'

function defaultGet (available = false) {
  return {
    code: 0,
    data: {
      policy: 'ask',
      cap: 500,
      official: available
        ? { available: true, reason: 'ok', balance: 1200, currency: 'credit' }
        : { available: false, reason: 'not_configured', balance: null, currency: 'credit' },
    },
  }
}

function mountCard () {
  return mount(ModelQuotaPolicyCard, { global: { plugins: [i18n] } })
}

describe('ModelQuotaPolicyCard', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.set.mockReset()
    api.get.mockResolvedValue(defaultGet(false))
    api.set.mockImplementation(async (payload) => ({ code: 0, data: payload }))
  })

  it('官方不可用且策略为 ask 时整卡隐藏（P2 前不空承诺）', async () => {
    const wrapper = mountCard()
    await flushPromises()
    expect(wrapper.find('[data-testid="model-quota-policy-card"]').exists()).toBe(false)
  })

  it('官方可用时显示状态与三个策略选项', async () => {
    api.get.mockResolvedValue(defaultGet(true))
    const wrapper = mountCard()
    await flushPromises()
    expect(wrapper.find('[data-testid="model-quota-policy-card"]').exists()).toBe(true)
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('1200')
  })

  it('读取失败时卡片仍可见并显示错误（不能把错误藏在隐藏区域）', async () => {
    api.get.mockResolvedValue({ code: -1, message: 'db locked' })
    const wrapper = mountCard()
    await flushPromises()
    expect(wrapper.find('[data-testid="model-quota-policy-card"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('读取设置失败')
  })

  it('保存合法策略调用 setPolicy 并显示已保存', async () => {
    api.get.mockResolvedValue(defaultGet(true))
    const wrapper = mountCard()
    await flushPromises()
    await wrapper.find('input[value="byok"]').setValue(true)
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(api.set).toHaveBeenCalledWith({ policy: 'byok', cap: 500 })
    expect(wrapper.find('[data-testid="model-quota-saved"]').exists()).toBe(true)
  })

  it('cap 非整数时不调用 setPolicy', async () => {
    api.get.mockResolvedValue(defaultGet(true))
    const wrapper = mountCard()
    await flushPromises()
    await wrapper.find('#model-quota-cap').setValue('1.5')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(api.set).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('1–100000')
  })
})
