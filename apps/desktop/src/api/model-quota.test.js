import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./electron-bridge', () => ({
  invokeWithFallback: vi.fn(async (method, fallback, ...args) => ({ method, fallback, args })),
  on: vi.fn(() => () => {}),
}))

import { invokeWithFallback, on } from './electron-bridge'
import {
  modelQuotaGetPolicy,
  modelQuotaSetPolicy,
  modelQuotaDecide,
  modelQuotaSwitchBack,
  onModelQuotaRequired,
} from './model-quota'

describe('model-quota api bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('get-policy 走 modelQuotaGetPolicy', async () => {
    await modelQuotaGetPolicy()
    expect(invokeWithFallback).toHaveBeenCalledWith('modelQuotaGetPolicy', expect.objectContaining({ code: -1 }))
  })

  it('set-policy 透传 payload', async () => {
    await modelQuotaSetPolicy({ policy: 'ask', cap: 500 })
    expect(invokeWithFallback).toHaveBeenCalledWith('modelQuotaSetPolicy', expect.objectContaining({ code: -1 }), { policy: 'ask', cap: 500 })
  })

  it('decide 走 modelQuotaDecide', async () => {
    await modelQuotaDecide({ requestId: 'r1', decision: 'cancel' })
    expect(invokeWithFallback).toHaveBeenCalledWith('modelQuotaDecide', expect.objectContaining({ code: -1 }), { requestId: 'r1', decision: 'cancel' })
  })

  it('switch-back 走 modelQuotaSwitchBack', async () => {
    await modelQuotaSwitchBack({ runId: 'run-1', capability: 'image' })
    expect(invokeWithFallback).toHaveBeenCalledWith('modelQuotaSwitchBack', expect.objectContaining({ code: -1 }), { runId: 'run-1', capability: 'image' })
  })

  it('onModelQuotaRequired 绑定 ModelQuotaRequired 事件', () => {
    const cb = vi.fn()
    onModelQuotaRequired(cb)
    expect(on).toHaveBeenCalledWith('ModelQuotaRequired', cb)
  })
})
