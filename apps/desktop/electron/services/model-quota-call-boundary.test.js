// @vitest-environment node
'use strict'
import { describe, expect, it, vi } from 'vitest'

const { installModelQuotaCallBoundary, capabilityFor, isFallbackFailure } = require('./model-quota-call-boundary')

function makeManager (result) {
  return { callAdapter: vi.fn(async () => result) }
}

function makeRuntime (decision = { action: 'stop', reason: 'user_settings' }) {
  return {
    decide: vi.fn(async () => decision),
    metaForContext: vi.fn(() => ({ runId: 'run-1' })),
  }
}

describe('model-quota-call-boundary', () => {
  it('quota 失败 + run context → 询问并转换为 MODEL_QUOTA_PAUSED', async () => {
    const manager = makeManager({ code: -1, errorCode: 'QUOTA_EXCEEDED', fallbackEligible: true, message: 'quota' })
    const runtime = makeRuntime()
    expect(installModelQuotaCallBoundary(manager, runtime)).toBe(true)
    const result = await manager.callAdapter('p1', 'generateImage', { model: 'm1' }, { providerRunContext: {} })
    expect(runtime.decide).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', capability: 'image', providerId: 'p1', model: 'm1',
    }))
    expect(result).toMatchObject({ code: -1, errorCode: 'MODEL_QUOTA_PAUSED' })
  })

  it('非额度失败原样透传', async () => {
    const original = { code: -1, errorCode: 'RATE_LIMITED', fallbackEligible: false }
    const manager = makeManager(original)
    const runtime = makeRuntime()
    installModelQuotaCallBoundary(manager, runtime)
    await expect(manager.callAdapter('p1', 'chatCompletion', {}, { providerRunContext: {} })).resolves.toBe(original)
    expect(runtime.decide).not.toHaveBeenCalled()
  })

  it('没有 run context 时原样透传', async () => {
    const original = { code: -1, errorCode: 'QUOTA_EXCEEDED', fallbackEligible: true }
    const manager = makeManager(original)
    const runtime = makeRuntime()
    runtime.metaForContext.mockReturnValue(null)
    installModelQuotaCallBoundary(manager, runtime)
    await expect(manager.callAdapter('p1', 'generateImage', {}, {})).resolves.toBe(original)
  })

  it('用户选官方但 P2 未落地 → MODEL_OFFICIAL_UNAVAILABLE', async () => {
    const manager = makeManager({ code: -1, errorCode: 'QUOTA_EXCEEDED', fallbackEligible: true })
    const runtime = makeRuntime({ action: 'use_official', reason: 'user_official' })
    installModelQuotaCallBoundary(manager, runtime)
    const runContext = { clearModelSourceOverride: vi.fn() }
    const result = await manager.callAdapter('p1', 'generateImage', {}, { providerRunContext: runContext })
    expect(result).toMatchObject({ code: -1, errorCode: 'MODEL_OFFICIAL_UNAVAILABLE' })
    expect(runContext.clearModelSourceOverride).toHaveBeenCalledWith('image')
  })

  it('重复安装不叠加包装', () => {
    const manager = makeManager({ code: 0 })
    const runtime = makeRuntime()
    expect(installModelQuotaCallBoundary(manager, runtime)).toBe(true)
    expect(installModelQuotaCallBoundary(manager, runtime)).toBe(false)
  })

  it('capability 映射与 quota 判据', () => {
    expect(capabilityFor('generateVideo')).toBe('video')
    expect(capabilityFor('synthesize')).toBe('tts')
    expect(capabilityFor('unknownMethod')).toBe('llm')
    expect(isFallbackFailure({ code: -1, accessState: 'credential_invalid' })).toBe(true)
    expect(isFallbackFailure({ code: -1, errorCode: 'RATE_LIMITED' })).toBe(false)
  })
})
