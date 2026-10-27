import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'

const api = vi.hoisted(() => ({ switchBack: vi.fn() }))
vi.mock('@/api/model-quota', () => ({ modelQuotaSwitchBack: api.switchBack }))

import ModelQuotaTaskBanner from './ModelQuotaTaskBanner.vue'

function mountBanner (props = {}) {
  return mount(ModelQuotaTaskBanner, {
    props: { runId: 'run-1', overrides: { image: { source: 'official', officialAttempts: 1 } }, ...props },
    global: { plugins: [i18n] },
  })
}

describe('ModelQuotaTaskBanner', () => {
  beforeEach(() => {
    api.switchBack.mockReset()
    api.switchBack.mockResolvedValue({ code: 0, data: { switched: true } })
  })

  it('没有官方覆盖时隐藏', () => {
    const wrapper = mountBanner({ overrides: { image: { source: 'byok' } } })
    expect(wrapper.find('[data-testid="model-quota-task-banner"]').exists()).toBe(false)
  })

  it('展示官方能力并调用 switchBack', async () => {
    const wrapper = mountBanner()
    expect(wrapper.text()).toContain('图片')
    await wrapper.find('[data-testid="model-quota-switch-back"]').trigger('click')
    await flushPromises()
    expect(api.switchBack).toHaveBeenCalledWith({ runId: 'run-1', capability: 'image' })
    expect(wrapper.emitted('switched')).toHaveLength(1)
    expect(wrapper.find('[data-testid="model-quota-switched"]').exists()).toBe(true)
  })

  it('多能力逐个切回', async () => {
    const wrapper = mountBanner({
      overrides: {
        image: { source: 'official' },
        tts: { source: 'official' },
      },
    })
    await wrapper.find('[data-testid="model-quota-switch-back"]').trigger('click')
    await flushPromises()
    expect(api.switchBack).toHaveBeenCalledTimes(2)
    expect(api.switchBack).toHaveBeenNthCalledWith(1, { runId: 'run-1', capability: 'image' })
    expect(api.switchBack).toHaveBeenNthCalledWith(2, { runId: 'run-1', capability: 'tts' })
  })

  it('多能力部分成功时 emit 刷新，同时提示失败', async () => {
    api.switchBack
      .mockResolvedValueOnce({ code: 0, data: { switched: true } })
      .mockResolvedValueOnce({ code: -1, message: 'failed' })
    const wrapper = mountBanner({ overrides: { image: { source: 'official' }, tts: { source: 'official' } } })
    await wrapper.find('[data-testid="model-quota-switch-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('switched')).toHaveLength(1)
    expect(wrapper.text()).toContain('切回失败')
  })

  it('切回失败时显示错误且不 emit', async () => {
    api.switchBack.mockResolvedValue({ code: -1, message: 'failed' })
    const wrapper = mountBanner()
    await wrapper.find('[data-testid="model-quota-switch-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('切回失败')
    expect(wrapper.emitted('switched')).toBeUndefined()
  })
})
