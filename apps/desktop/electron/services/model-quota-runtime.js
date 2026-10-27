'use strict'
/**
 * model-quota-runtime.js — 模型额度兜底的生产运行时。
 *
 * 职责边界：
 *   - 持有唯一 ModelQuotaCoordinator（设置/状态/事件/检查点端口都在这里注入）；
 *   - 按 runId 管理 ProviderRunContext（与 PipelineEngine 的 getProviderRunContext 同一对象）；
 *   - beginRun / endRun 管生命周期；switchBack 管「切回我的模型」。
 *
 * 不负责：业务域何时调用 decide（P1b-2c-2 接调用边界）、官方算力客户端（P2）。
 */

const { ModelQuotaCoordinator } = require('./model-quota-coordinator')
const { ProviderRunContext } = require('./provider-run-context')

class ModelQuotaRuntime {
  constructor ({
    store,
    emitToRenderer,
    checkpointPort,
    officialStatusProvider,
    telemetry,
    clock,
    timeoutMs,
    coordinator,
  } = {}) {
    this._checkpoint = checkpointPort || { save: async () => false }
    this._contexts = new Map()
    this._coordinator = coordinator || new ModelQuotaCoordinator({
      store,
      emitToRenderer,
      checkpointPort: this._checkpoint,
      officialStatusProvider,
      telemetry,
      clock,
      timeoutMs,
    })
  }

  /**
   * 建立/复用 run 的运行态。overrides 来自 checkpoint.context.modelSourceOverrides，
   * 用于断点续跑恢复「上次已切官方」。
   * @param {string} runId
   * @param {{runContext?: object, overrides?: object}} [options]
   * @returns {ProviderRunContext}
   */
  beginRun (runId, { runContext, overrides } = {}) {
    const id = String(runId || '').trim()
    if (!id) throw new TypeError('model-quota-runtime.beginRun requires runId')
    const existing = this._contexts.get(id)
    if (existing) {
      this._hydrateOverrides(existing, overrides)
      return existing
    }

    const ctx = runContext instanceof ProviderRunContext
      ? runContext
      : (runContext && typeof runContext.getModelSourceOverride === 'function' ? runContext : new ProviderRunContext())
    this._contexts.set(id, ctx)
    this._hydrateOverrides(ctx, overrides)
    return ctx
  }

  getContext (runId) {
    const id = String(runId || '').trim()
    return id ? (this._contexts.get(id) || null) : null
  }

  /**
   * 决策入口：自动确保 run context 存在，再交给 Coordinator。
   * @param {object} args
   */
  decide (args = {}) {
    const ctx = this.beginRun(args.runId, { runContext: args.runContext })
    return this._coordinator.decide({ ...args, runContext: ctx })
  }

  userDecision (payload) {
    return this._coordinator.userDecision(payload)
  }

  /**
   * 切回用户的 BYOK。先落检查点（override=null），成功后清内存覆盖。
   * 检查点不存在也允许切回（例如非编排 run），只是没有持久化记录。
   * @param {{runId: string, capability: string}} args
   * @returns {Promise<boolean>}
   */
  async switchBack ({ runId, capability } = {}) {
    const id = String(runId || '').trim()
    const cap = String(capability || '').trim()
    if (!id || !cap) return false
    const ctx = this._contexts.get(id)
    if (!ctx) return false
    const current = ctx.getModelSourceOverride(cap)
    if (!current || current.source !== 'official') return false

    const saved = await this._checkpoint.save({
      runId: id,
      capability: cap,
      reason: 'user_switch_back',
      override: null,
    })
    if (!saved) return false
    ctx.clearModelSourceOverride(cap)
    return true
  }

  /**
   * run 终结：取消未决询问并清掉运行态覆盖。
   * @param {string} runId
   */
  endRun (runId) {
    const id = String(runId || '').trim()
    if (!id) return
    this._coordinator.clearRun(id)
    this._contexts.delete(id)
  }

  _hydrateOverrides (ctx, overrides) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return
    for (const [capability, value] of Object.entries(overrides)) {
      if (!value || (value.source !== 'official' && value.source !== 'byok')) continue
      ctx.setModelSourceOverride(capability, {
        source: value.source,
        officialAttempts: Number.isInteger(value.officialAttempts) && value.officialAttempts >= 0
          ? value.officialAttempts
          : 0,
      })
    }
  }
}

function createModelQuotaRuntime (options) {
  return new ModelQuotaRuntime(options)
}

module.exports = { ModelQuotaRuntime, createModelQuotaRuntime }
