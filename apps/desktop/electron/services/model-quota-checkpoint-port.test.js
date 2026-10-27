// @vitest-environment node
'use strict'

const { createRunStateCheckpointPort } = require('./model-quota-checkpoint-port')

function makeStore (snapshot) {
  return {
    load: vi.fn(() => snapshot),
    savePaused: vi.fn(() => true),
  }
}

const baseSnapshot = {
  kind: 'orchestration-run-state',
  version: 1,
  runId: 'run-1',
  pipeline: 'story2video-compose',
  status: 'running',
  currentStage: 2,
  stages: [{ name: 'tts', status: 'running' }],
  context: { topic: 'x', modelSourceOverrides: { tts: { source: 'official', officialAttempts: 1 } } },
  params: { topic: 'x' },
  checkpoint: { type: 'stage', stageName: 'tts' },
}

describe('createRunStateCheckpointPort', () => {
  it('把 official 覆盖写入 paused 快照的 context.modelSourceOverrides', async () => {
    const store = makeStore(baseSnapshot)
    const port = createRunStateCheckpointPort(store)
    await expect(port.save({
      runId: 'run-1',
      stageId: 'tts',
      capability: 'image',
      reason: 'model_quota_fallback',
      override: { source: 'official', originalProviderId: 'p1', decidedAt: '2026-10-27T00:00:00.000Z', apiKey: 'secret' },
    })).resolves.toBe(true)
    expect(store.savePaused).toHaveBeenCalledTimes(1)
    const run = store.savePaused.mock.calls[0][0]
    expect(run.id).toBe('run-1')
    expect(run.status).toBe('paused')
    expect(run.context.modelSourceOverrides).toEqual({
      tts: { source: 'official', officialAttempts: 1 },
      image: { source: 'official', originalProviderId: 'p1', decidedAt: '2026-10-27T00:00:00.000Z' },
    })
    expect(run.context.modelSourceOverrides.image.apiKey).toBeUndefined()
    expect(run.checkpoint).toMatchObject({ type: 'stage', modelQuota: { capability: 'image', reason: 'model_quota_fallback' } })
  })

  it('override=null 时删除对应能力的覆盖', async () => {
    const store = makeStore(baseSnapshot)
    const port = createRunStateCheckpointPort(store)
    await port.save({ runId: 'run-1', capability: 'tts', reason: 'user_switch_back', override: null })
    const run = store.savePaused.mock.calls[0][0]
    expect(run.context.modelSourceOverrides).toEqual({})
  })

  it('非法 originalProviderId 与额外字段不会落盘', async () => {
    const store = makeStore(baseSnapshot)
    const port = createRunStateCheckpointPort(store)
    await port.save({
      runId: 'run-1',
      capability: 'image',
      reason: 'model_quota_fallback',
      override: { source: 'official', originalProviderId: '../evil', apiKey: 'secret' },
    })
    const run = store.savePaused.mock.calls[0][0]
    expect(run.context.modelSourceOverrides.image).toEqual({ source: 'official' })
  })

  it('快照不存在返回 false 且不写', async () => {
    const store = makeStore(null)
    const port = createRunStateCheckpointPort(store)
    await expect(port.save({ runId: 'missing', capability: 'image', reason: 'x', override: null })).resolves.toBe(false)
    expect(store.savePaused).not.toHaveBeenCalled()
  })

  it('runStateStore 不可用返回 false', async () => {
    const port = createRunStateCheckpointPort(null)
    await expect(port.save({ runId: 'run-1', capability: 'image', reason: 'x', override: null })).resolves.toBe(false)
  })

  it('非法入参返回 false', async () => {
    const store = makeStore(baseSnapshot)
    const port = createRunStateCheckpointPort(store)
    await expect(port.save({ capability: 'image' })).resolves.toBe(false)
    expect(store.load).not.toHaveBeenCalled()
  })
})
