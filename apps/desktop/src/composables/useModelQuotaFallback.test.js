import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'

const api = vi.hoisted(() => ({
  decide: vi.fn(),
  subscribe: vi.fn(),
}))
let listener = null
let unsubscribe = vi.fn()

vi.mock('@/api/model-quota', () => ({
  modelQuotaDecide: api.decide,
  onModelQuotaRequired: (cb) => {
    listener = cb
    api.subscribe(cb)
    return unsubscribe
  },
}))

import { useModelQuotaFallback } from './useModelQuotaFallback'

function mountComposable () {
  let state
  const wrapper = mount({
    setup () {
      state = useModelQuotaFallback()
      return () => h('div')
    },
  })
  return { wrapper, state }
}

const payload = {
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

describe('useModelQuotaFallback', () => {
  beforeEach(() => {
    api.decide.mockReset()
    api.subscribe.mockReset()
    listener = null
    unsubscribe = vi.fn()
  })

  it('订阅事件并接收 request', () => {
    const { state } = mountComposable()
    listener(payload)
    expect(state.currentRequest.value).toEqual(payload)
    expect(state.failed.value).toBe(false)
  })

  it('official 成功：回传 requestId/runId/capability/remember，并清空请求', async () => {
    api.decide.mockResolvedValue({ code: 0 })
    const { state } = mountComposable()
    listener(payload)
    await expect(state.useOfficial(true)).resolves.toBe(true)
    expect(api.decide).toHaveBeenCalledWith({
      requestId: 'req-1',
      runId: 'run-1',
      capability: 'image',
      decision: 'official',
      remember: true,
    })
    expect(state.currentRequest.value).toBeNull()
  })

  it('decide 失败：保留请求并标记 failed', async () => {
    api.decide.mockResolvedValue({ code: -10, message: 'gone' })
    const { state } = mountComposable()
    listener(payload)
    await expect(state.cancel()).resolves.toBe(false)
    expect(state.currentRequest.value).toEqual(payload)
    expect(state.failed.value).toBe(true)
  })

  it('goSettings 成功后发出 settings 决策', async () => {
    api.decide.mockResolvedValue({ code: 0 })
    const { state } = mountComposable()
    listener(payload)
    await expect(state.goSettings(false)).resolves.toBe(true)
    expect(api.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'settings' }))
  })

  it('卸载时取消订阅并清空请求', () => {
    const { wrapper, state } = mountComposable()
    listener(payload)
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(state.currentRequest.value).toBeNull()
  })
})
