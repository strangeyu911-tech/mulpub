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

module.exports = { beginModelQuotaRun, endModelQuotaRun }
