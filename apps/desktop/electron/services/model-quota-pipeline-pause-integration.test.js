// @vitest-environment node
'use strict'
import { describe, expect, it, vi } from 'vitest'

const { PipelineEngine } = require('./pipeline-engine')

describe('PipelineEngine 模型额度暂停', () => {
  it('executeStage 收到 MODEL_QUOTA_PAUSED 时把 run 置 paused，而不是 failed', async () => {
    const stageExecutor = {
      register: vi.fn(),
      execute: vi.fn(async () => ({ success: false, error: '额度已用完，任务已暂停', errorCode: 'MODEL_QUOTA_PAUSED' })),
    }
    const engine = new PipelineEngine({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }, stageExecutor })
    engine.registerPipeline({
      name: 'quota-pause-test',
      description: 'quota pause',
      stages: ['a'],
      stageDefs: [{ name: 'a', type: 'quota_pause_stage' }],
    })
    engine.registerStageExecutor('quota_pause_stage', async () => ({
      success: false,
      error: '额度已用完，任务已暂停',
      errorCode: 'MODEL_QUOTA_PAUSED',
    }))
    const started = await engine.startOrchestrated('quota-pause-test', {})
    const result = await engine.executeStage(started.runId)
    expect(result.paused).toBe(true)
    expect(result.errorCode).toBe('MODEL_QUOTA_PAUSED')
    expect(engine._runs.get(started.runId).status).toBe('paused')
  })
})
