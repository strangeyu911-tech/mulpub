// @vitest-environment node
'use strict'
import { describe, expect, it, vi } from 'vitest'

const { pauseModelQuotaRun } = require('./model-quota-pipeline-hooks')

describe('pauseModelQuotaRun', () => {
  it('把 run/当前阶段置 paused 并落检查点', () => {
    const savePaused = vi.fn(() => true)
    const emit = vi.fn()
    const engine = {
      runStateStore: { savePaused },
      _buildCheckpoint: vi.fn((run, meta) => ({ ...meta, context: { topic: 'x' } })),
      _emit: emit,
    }
    const run = { id: 'run-1', currentStage: 0, stages: [{ name: 'generate_assets', status: 'running' }], context: { topic: 'x' } }
    const result = pauseModelQuotaRun(engine, run, { success: false, errorCode: 'MODEL_QUOTA_PAUSED', error: 'paused' })
    expect(run.status).toBe('paused')
    expect(run.stages[0].status).toBe('paused')
    expect(run.checkpoint).toMatchObject({ type: 'model_quota', stageName: 'generate_assets' })
    expect(savePaused).toHaveBeenCalledWith(run)
    expect(emit).toHaveBeenCalledWith('checkpoint:pause', expect.objectContaining({ runId: 'run-1', checkpointType: 'model_quota' }))
    expect(result).toMatchObject({ success: false, paused: true, runId: 'run-1', errorCode: 'MODEL_QUOTA_PAUSED' })
  })

  it('checkpoint 构建失败仍暂停', () => {
    const engine = {
      _buildCheckpoint: () => { throw new Error('boom') },
      runStateStore: {},
      _emit: () => {},
    }
    const run = { id: 'run-2', currentStage: 0, stages: [{ name: 'x', status: 'running' }], context: {} }
    const result = pauseModelQuotaRun(engine, run, { success: false, errorCode: 'MODEL_QUOTA_PAUSED' })
    expect(run.status).toBe('paused')
    expect(result.paused).toBe(true)
    expect(result.checkpointData).toEqual({ type: 'model_quota', required: true })
  })
})
