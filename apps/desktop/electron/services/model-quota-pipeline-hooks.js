'use strict'
/**
 * model-quota-pipeline-hooks.js — PipelineEngine 与 ModelQuotaRuntime 的最小接线。
 *
 * 单独成模块的原因：pipeline-engine.js 已超出 500 行且被点名零增长，
 * 生命周期逻辑放这里，主引擎只留一行调用。
 */

let getProviderRunContext = null
try {
  ({ getProviderRunContext } = require('./provider-run-context'))
} catch (_) {
  getProviderRunContext = null
}

function beginModelQuotaRun (engine, run) {
  if (!engine || !run || !engine.modelQuotaRuntime) return
  if (typeof engine.modelQuotaRuntime.beginRun !== 'function') return
  if (typeof getProviderRunContext !== 'function') {
    const log = engine.log
    if (log && typeof log.warn === 'function') log.warn('PipelineEngine', 'provider-run-context unavailable; model quota run skipped')
    return
  }
  try {
    const runContext = getProviderRunContext(run.context || {})
    const overrides = run.context && run.context.modelSourceOverrides
    engine.modelQuotaRuntime.beginRun(run.id, { runContext, overrides })
  } catch (e) {
    const log = engine.log
    if (log && typeof log.warn === 'function') {
      log.warn('PipelineEngine', 'modelQuotaRuntime.beginRun failed: ' + (e && e.message ? e.message : String(e)))
    }
  }
}

function modelQuotaOverridesFor (engine, run) {
  if (!engine || !run || !engine.modelQuotaRuntime) return null
  if (typeof engine.modelQuotaRuntime.getContext !== 'function') return null
  const ctx = engine.modelQuotaRuntime.getContext(run.id)
  if (!ctx || typeof ctx.getModelSourceOverrides !== 'function') return null
  const overrides = ctx.getModelSourceOverrides()
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null
  return Object.keys(overrides).length > 0 ? overrides : null
}

function pauseModelQuotaRun (engine, run, result) {
  if (!engine || !run) return result
  const stage = Array.isArray(run.stages) ? run.stages[run.currentStage] : null
  let checkpoint = { type: 'model_quota', required: true }
  try {
    if (typeof engine._buildCheckpoint === 'function') {
      checkpoint = engine._buildCheckpoint(run, {
        stageName: stage && stage.name,
        stageIndex: run.currentStage,
        required: true,
        type: 'model_quota',
      })
    }
  } catch (_) { /* checkpoint 构建失败仍暂停，保留基础信息 */ }
  run.checkpoint = checkpoint
  run.status = 'paused'
  if (stage && typeof stage === 'object') stage.status = 'paused'
  try {
    if (engine.runStateStore && typeof engine.runStateStore.savePaused === 'function') engine.runStateStore.savePaused(run)
  } catch (_) { /* 快照失败不阻断暂停 */ }
  try {
    if (typeof engine._emit === 'function') {
      engine._emit('checkpoint:pause', { runId: run.id, stageName: stage && stage.name, checkpointType: 'model_quota' })
    }
  } catch (_) { /* 事件失败不阻断暂停 */ }
  return {
    ...result,
    success: false,
    runId: run.id,
    paused: true,
    checkpointData: checkpoint,
    errorCode: 'MODEL_QUOTA_PAUSED',
    context: run.context,
  }
}

function endModelQuotaRun (engine, run) {
  if (!engine || !run || !engine.modelQuotaRuntime) return
  if (typeof engine.modelQuotaRuntime.endRun !== 'function') return
  try {
    engine.modelQuotaRuntime.endRun(run.id)
  } catch (e) {
    const log = engine.log
    if (log && typeof log.warn === 'function') {
      log.warn('PipelineEngine', 'modelQuotaRuntime.endRun failed: ' + (e && e.message ? e.message : String(e)))
    }
  }
}

module.exports = { beginModelQuotaRun, endModelQuotaRun, pauseModelQuotaRun, modelQuotaOverridesFor }
