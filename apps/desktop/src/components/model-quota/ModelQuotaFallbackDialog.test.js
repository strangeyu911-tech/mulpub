import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  decide: vi.fn(async () => ({ code: 0 })),
  subscribe: vi.fn(),
}))
let listener = null

vi.mock('@/api/model-quota', () => ({
  modelQuotaDecide: api.decide,
  onModelQuotaRequired: (cb) => {
    listener = cb
    api.subscribe(cb)
    return () => {}
  },
}))

import ModelQuotaFallbackDialog from './ModelQuotaFallbackDialog.vue'

const base = {
  requestId: 'req-1',
  runId: 'run-1',
  capability: 'image',
  providerId: 'openai',
  providerName: 'OpenAI',
  model: 'gpt-image-1',
  failure: { state: 'quota_exhausted' },
  official: { available: true, reason: 'ok', balance: 1000 },
  estimate: { credits: 10 },
  cap: 500,
}

function mountDialog () {
  return mount(ModelQuotaFallbackDialog, { global: { plugins: [i18n], stubs: { teleport: true } } })
}

describe('ModelQuotaFallbackDialog', () => {
  beforeEach(() => {
    api.decide.mockReset()
    api.decide.mockResolvedValue({ code: 0 })
    api.subscribe.mockReset()
    listener = null
  })

  it('无 request 时不渲染', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="model-quota-overlay"]').exists()).toBe(false)
  })

  it('有 request 时展示 provider/model/错误类型/积分', async () => {
    const wrapper = mountDialog()
    listener(base)
    await nextTick()
    expect(wrapper.find('[data-testid="model-quota-overlay"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('OpenAI')
    expect(wrapper.text()).toContain('gpt-image-1')
    expect(wrapper.text()).toContain('额度用尽')
    expect(wrapper.text()).toContain('10')
  })

  it('官方不可用时按钮禁用并展示原因', async () => {
    const wrapper = mountDialog()
    listener({ ...base, official: { available: false, reason: 'not_configured', balance: null } })
    await nextTick()
    expect(wrapper.find('[data-testid="model-quota-official"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="model-quota-disabled-reason"]').text()).toContain('官方算力尚未接入')
  })

  it('取消调用 decide(cancel)', async () => {
    const wrapper = mountDialog()
    listener(base)
    await nextTick()
    await wrapper.find('[data-testid="model-quota-cancel"]').trigger('click')
    await flushPromises()
    expect(api.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'cancel' }))
  })

  it('官方按钮传递 remember，设置按钮 emit settings', async () => {
    const wrapper = mountDialog()
    listener(base)
    await nextTick()
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find('[data-testid="model-quota-official"]').trigger('click')
    await flushPromises()
    expect(api.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'official', remember: true }))

    listener(base)
    await nextTick()
    await wrapper.find('[data-testid="model-quota-settings"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('settings')).toHaveLength(1)
  })
})
