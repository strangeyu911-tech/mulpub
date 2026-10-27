// @vitest-environment node
'use strict'

const { ModelQuotaRuntime } = require('./model-quota-runtime')

function makeCoordinator () {
  return {
    decide: vi.fn(async () => ({ action: 'stop', reason: 'user_cancel' })),
    userDecision: vi.fn(() => true),
    clearRun: vi.fn(),
  }
}

describe('ModelQuotaRuntime', () => {
  it('beginRun 复用同一 run 的 ProviderRunContext', () => {
    const runtime = new ModelQuotaRuntime({ coordinator: makeCoordinator() })
    const first = runtime.beginRun('run-1')
    const second = runtime.beginRun('run-1')
    expect(second).toBe(first)
    expect(runtime.getContext('run-1')).toBe(first)
  })

  it('beginRun 可从 checkpoint 覆盖恢复 modelSourceOverrides', () => {
    const runtime = new ModelQuotaRuntime({ coordinator: makeCoordinator() })
    const ctx = runtime.beginRun('run-1', {
      overrides: { image: { source: 'official', officialAttempts: 1 } },
    })
    expect(ctx.getModelSourceOverride('image')).toEqual({ source: 'official', officialAttempts: 1 })
  })

  it('beginRun 已存在时补写 checkpoint 覆盖，不丢恢复状态', () => {
    const runtime = new ModelQuotaRuntime({ coordinator: makeCoordinator() })
    runtime.beginRun('run-1')
    const ctx = runtime.beginRun('run-1', { overrides: { image: { source: 'official', officialAttempts: 2 } } })
    expect(ctx.getModelSourceOverride('image')).toEqual({ source: 'official', officialAttempts: 2 })
  })

  it('decide 委托 Coordinator 并带上 runContext', async () => {
    const coordinator = makeCoordinator()
    const runtime = new ModelQuotaRuntime({ coordinator })
    const ctx = runtime.beginRun('run-1')
    await runtime.decide({ runId: 'run-1', stageId: 's1', capability: 'image', providerId: 'p1', failure: { kind: 'quota' } })
    expect(coordinator.decide).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', stageId: 's1', capability: 'image', providerId: 'p1', runContext: ctx,
    }))
  })

  it('switchBack 先落检查点再清除覆盖', async () => {
    const checkpointPort = { save: vi.fn(async () => true) }
    const runtime = new ModelQuotaRuntime({ coordinator: makeCoordinator(), checkpointPort })
    const ctx = runtime.beginRun('run-1')
    ctx.setModelSourceOverride('image', { source: 'official', officialAttempts: 1 })

    await expect(runtime.switchBack({ runId: 'run-1', capability: 'image' })).resolves.toBe(true)
    expect(checkpointPort.save).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', capability: 'image', reason: 'user_switch_back', override: null,
    }))
    expect(ctx.getModelSourceOverride('image')).toBeNull()
  })

  it('switchBack 检查点保存失败时不清覆盖、返回 false', async () => {
    const checkpointPort = { save: vi.fn(async () => false) }
    const runtime = new ModelQuotaRuntime({ coordinator: makeCoordinator(), checkpointPort })
    const ctx = runtime.beginRun('run-1')
    ctx.setModelSourceOverride('image', { source: 'official', officialAttempts: 1 })
    await expect(runtime.switchBack({ runId: 'run-1', capability: 'image' })).resolves.toBe(false)
    expect(ctx.getModelSourceOverride('image')).toEqual({ source: 'official', officialAttempts: 1 })
  })

  it('switchBack 对未切官方的能力返回 false', async () => {
    const runtime = new ModelQuotaRuntime({ coordinator: makeCoordinator() })
    runtime.beginRun('run-1')
    await expect(runtime.switchBack({ runId: 'run-1', capability: 'image' })).resolves.toBe(false)
  })

  it('endRun 清理请求与 run context', () => {
    const coordinator = makeCoordinator()
    const runtime = new ModelQuotaRuntime({ coordinator })
    runtime.beginRun('run-1')
    runtime.endRun('run-1')
    expect(coordinator.clearRun).toHaveBeenCalledWith('run-1')
    expect(runtime.getContext('run-1')).toBeNull()
  })
})
