// @vitest-environment node
'use strict'

const { ModelQuotaCoordinator } = require('./model-quota-coordinator')
const { ProviderRunContext } = require('./provider-run-context')

function makeHarness (options = {}) {
  const rows = options.rows || {}
  const store = {
    getSetting: (key) => (key in rows ? rows[key] : null),
    setSetting: (key, value) => { rows[key] = value },
  }
  const emitToRenderer = vi.fn()
  const checkpointPort = { save: vi.fn(async () => {}) }
  const officialStatusProvider = {
    getStatus: vi.fn(async () => options.official || { available: true, reason: 'ok', balance: 1000, currency: 'credit' }),
  }
  const telemetry = { record: vi.fn() }
  const timers = []
  const clock = {
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t },
    clearTimeout: (t) => { if (t) t.cleared = true },
  }
  const coordinator = new ModelQuotaCoordinator({
    store, emitToRenderer, checkpointPort, officialStatusProvider, telemetry, clock,
  })
  return { coordinator, store, rows, emitToRenderer, checkpointPort, officialStatusProvider, telemetry, timers }
}

const failure = { state: 'quota_exhausted', fallbackEligible: true, quotaKind: 'balance', estimateCredits: 10 }
const baseArgs = {
  runId: 'run-1', stageId: 'stage-1', capability: 'image', providerId: 'openai', model: 'gpt-image-1', failure,
}

async function flush () { await Promise.resolve(); await Promise.resolve() }

describe('ModelQuotaCoordinator', () => {
  it('ask 档：发 required 事件，用户选 official 后先 checkpoint 再写 override', async () => {
    const h = makeHarness()
    const ctx = new ProviderRunContext()
    const setSpy = vi.spyOn(ctx, 'setModelSourceOverride')
    const p = h.coordinator.decide({ ...baseArgs, runContext: ctx })
    await flush()
    expect(h.emitToRenderer).toHaveBeenCalledTimes(1)
    const [channel, payload] = h.emitToRenderer.mock.calls[0]
    expect(channel).toBe('model-quota:required')
    expect(payload).toMatchObject({ runId: 'run-1', capability: 'image', providerId: 'openai', policy: 'ask' })
    expect(payload.requestId).toBeTruthy()

    const accepted = h.coordinator.userDecision({ requestId: payload.requestId, runId: 'run-1', capability: 'image', decision: 'official', remember: false })
    expect(accepted).toBe(true)
    const result = await p
    expect(result.action).toBe('use_official')
    expect(result.reason).toBe('user_official')
    expect(h.checkpointPort.save).toHaveBeenCalledTimes(1)
    expect(h.checkpointPort.save.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0])
    expect(ctx.getModelSourceOverride('image')).toMatchObject({ source: 'official', officialAttempts: 1 })
    expect(h.telemetry.record).toHaveBeenCalled()
  })

  it('并发去重：同 run/capability 两次 decide 共享同一 Promise，只发一次事件', async () => {
    const h = makeHarness()
    const ctx = new ProviderRunContext()
    const p1 = h.coordinator.decide({ ...baseArgs, runContext: ctx })
    const p2 = h.coordinator.decide({ ...baseArgs, runContext: ctx })
    expect(p1).toBe(p2)
    await flush()
    expect(h.emitToRenderer).toHaveBeenCalledTimes(1)
    const payload = h.emitToRenderer.mock.calls[0][1]
    h.coordinator.userDecision({ requestId: payload.requestId, runId: 'run-1', capability: 'image', decision: 'cancel', remember: false })
    await expect(p1).resolves.toMatchObject({ action: 'stop', reason: 'user_cancel' })
  })

  it('requestId 一次性：重复 decide 返回 false', async () => {
    const h = makeHarness()
    const p = h.coordinator.decide({ ...baseArgs, runContext: new ProviderRunContext() })
    await flush()
    const payload = h.emitToRenderer.mock.calls[0][1]
    expect(h.coordinator.userDecision({ requestId: payload.requestId, runId: 'run-1', capability: 'image', decision: 'cancel' })).toBe(true)
    expect(h.coordinator.userDecision({ requestId: payload.requestId, runId: 'run-1', capability: 'image', decision: 'official' })).toBe(false)
    await p
  })

  it('cancel + remember 不写 policy（PRD：取消不写）', async () => {
    const h = makeHarness()
    const p = h.coordinator.decide({ ...baseArgs, runContext: new ProviderRunContext() })
    await flush()
    const payload = h.emitToRenderer.mock.calls[0][1]
    h.coordinator.userDecision({ requestId: payload.requestId, runId: 'run-1', capability: 'image', decision: 'cancel', remember: true })
    await p
    expect(h.rows.modelQuotaFallbackPolicy).toBeUndefined()
  })

  it('settings + remember 写 policy=byok', async () => {
    const h = makeHarness({ rows: { modelQuotaFallbackPolicy: 'ask' } })
    const p = h.coordinator.decide({ ...baseArgs, runContext: new ProviderRunContext() })
    await flush()
    const payload = h.emitToRenderer.mock.calls[0][1]
    h.coordinator.userDecision({ requestId: payload.requestId, runId: 'run-1', capability: 'image', decision: 'settings', remember: true })
    await p
    expect(h.rows.modelQuotaFallbackPolicy).toBe('byok')
  })

  it('超时视为 cancel，并清理 pending', async () => {
    const h = makeHarness()
    const p = h.coordinator.decide({ ...baseArgs, runContext: new ProviderRunContext() })
    await flush()
    expect(h.timers.length).toBe(1)
    h.timers[0].fn()
    await expect(p).resolves.toMatchObject({ action: 'stop', reason: 'timeout' })
  })

  it('policy=official + 官方可用 + 余额/预估满足 → 自动官方，不发弹窗', async () => {
    const h = makeHarness({ rows: { modelQuotaFallbackPolicy: 'official', officialCreditCapPerTask: 500 } })
    const ctx = new ProviderRunContext()
    const result = await h.coordinator.decide({ ...baseArgs, runContext: ctx })
    expect(result.action).toBe('use_official')
    expect(result.reason).toBe('policy_official')
    expect(h.emitToRenderer).not.toHaveBeenCalled()
    expect(h.checkpointPort.save).toHaveBeenCalledTimes(1)
    expect(ctx.getModelSourceOverride('image')).toMatchObject({ source: 'official' })
  })

  it('credential_invalid 即使 policy=official 也必须询问', async () => {
    const h = makeHarness({ rows: { modelQuotaFallbackPolicy: 'official' } })
    const p = h.coordinator.decide({
      ...baseArgs,
      failure: { state: 'credential_invalid', fallbackEligible: true, quotaKind: 'unknown' },
      runContext: new ProviderRunContext(),
    })
    await flush()
    expect(h.emitToRenderer).toHaveBeenCalledTimes(1)
    const payload = h.emitToRenderer.mock.calls[0][1]
    h.coordinator.userDecision({ requestId: payload.requestId, runId: 'run-1', capability: 'image', decision: 'cancel' })
    await expect(p).resolves.toMatchObject({ action: 'stop', reason: 'user_cancel' })
  })

  it('clearRun 取消未决请求并清理该 run 的拒绝记录', async () => {
    const h = makeHarness()
    const p = h.coordinator.decide({ ...baseArgs, runContext: new ProviderRunContext() })
    await flush()
    h.coordinator.clearRun('run-1')
    await expect(p).resolves.toMatchObject({ action: 'stop', reason: 'run_cleared' })
  })
})
