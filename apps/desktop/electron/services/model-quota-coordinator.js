'use strict'
/**
 * model-quota-coordinator.js — 模型额度兜底的唯一决策入口（P1b，主进程有状态服务）。
 *
 * 职责：
 *   - 读设置（modelQuotaFallbackPolicy / officialCreditCapPerTask）；
 *   - 调纯函数 resolveModelQuotaAction；
 *   - 同一 (runId, capability) 并发去重；
 *   - 需要询问时向渲染端发 model-quota:required，等待 decide IPC；
 *   - 用户选择后先 checkpoint.save()，再写 ProviderRunContext.modelSourceOverrides；
 *   - 写埋点。
 *
 * 不依赖具体流水线；checkpointPort / telemetry / officialStatusProvider 都由调用方注入。
 */

const crypto = require('node:crypto')
const { resolveModelQuotaAction, normalizePolicy, normalizeCap } = require('./model-quota-policy')

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const POLICY_KEY = 'modelQuotaFallbackPolicy'
const CAP_KEY = 'officialCreditCapPerTask'

function runCapabilityKey (runId, capability) {
  return `${String(runId || '').trim()}|${String(capability || '').trim()}`
}

class ModelQuotaCoordinator {
  constructor({
    store,
    emitToRenderer,
    checkpointPort,
    officialStatusProvider,
    telemetry,
    clock,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this._store = store || null
    this._emit = typeof emitToRenderer === 'function' ? emitToRenderer : () => {}
    this._checkpoint = checkpointPort || { save: async () => {} }
    this._status = officialStatusProvider || { getStatus: async () => ({ available: false, reason: 'not_configured' }) }
    this._telemetry = telemetry || { record: () => {} }
    this._clock = clock || { setTimeout, clearTimeout }
    this._timeoutMs = timeoutMs
    this._pending = new Map()
    this._requests = new Map()
    this._declined = new Map()
  }

  /**
   * 决策入口。同一 (runId, capability) 的并发调用共享同一 Promise。
   * @returns {Promise<object>}
   */
  decide ({ runId, stageId, capability, providerId, model, failure, runContext } = {}) {
    if (!runId || !capability || !providerId) {
      return Promise.reject(new TypeError('model-quota-coordinator.decide requires runId, capability, providerId'))
    }
    if (!failure || typeof failure !== 'object') {
      return Promise.reject(new TypeError('model-quota-coordinator.decide requires failure'))
    }
    const key = runCapabilityKey(runId, capability)
    if (this._pending.has(key)) return this._pending.get(key)

    const promise = this._decide({ runId, stageId, capability, providerId, model, failure, runContext })
      .finally(() => { this._pending.delete(key) })
    this._pending.set(key, promise)
    return promise
  }

  async _decide ({ runId, stageId, capability, providerId, model, failure, runContext }) {
    const policy = normalizePolicy(this._readSetting(POLICY_KEY)).value
    const cap = normalizeCap(this._readSetting(CAP_KEY)).value
    let official
    try {
      official = await this._status.getStatus()
    } catch (_) {
      official = { available: false, reason: 'balance_unavailable', balance: null, currency: 'credit' }
    }
    const override = runContext && typeof runContext.getModelSourceOverride === 'function'
      ? runContext.getModelSourceOverride(capability)
      : null
    const alreadyDeclined = this._isDeclined(runId, capability)
    const estimate = this._estimateFromFailure(failure)
    const decision = resolveModelQuotaAction({
      failure,
      policy,
      officialStatus: official,
      estimate,
      cap,
      runOverride: override,
      alreadyDeclined,
    })

    if (decision.action === 'use_official') {
      await this._checkpoint.save({
        runId,
        stageId,
        capability,
        reason: 'model_quota_fallback',
        override: {
          source: 'official',
          originalProviderId: providerId,
          decidedAt: new Date().toISOString(),
          reason: decision.reason,
        },
      })
      if (runContext && typeof runContext.setModelSourceOverride === 'function') {
        const attempts = override && Number.isInteger(override.officialAttempts) ? override.officialAttempts : 0
        runContext.setModelSourceOverride(capability, { source: 'official', officialAttempts: attempts + 1 })
      }
      this._recordDecision({ runId, stageId, capability, providerId, model, failure, official, estimate, cap, policy, decision, userDecision: null })
      return decision
    }

    if (decision.action !== 'ask') {
      this._recordDecision({ runId, stageId, capability, providerId, model, failure, official, estimate, cap, policy, decision, userDecision: null })
      return decision
    }

    const requestId = crypto.randomUUID()
    const payload = {
      requestId,
      runId,
      capability,
      providerId,
      providerName: providerId,
      model: model || null,
      failure,
      official,
      estimate,
      cap,
      policy,
    }
    const answer = await this._ask(requestId, payload)
    if (!answer) {
      this._markDeclined(runId, capability)
      const timeoutDecision = { ...decision, action: 'stop', reason: 'timeout' }
      this._recordDecision({ runId, stageId, capability, providerId, model, failure, official, estimate, cap, policy, decision: timeoutDecision, userDecision: null })
      return timeoutDecision
    }

    if (answer.decision === 'official') {
      const originalProviderId = providerId
      // 先落检查点，再写运行态覆盖（D-09；顺序是契约，不能反）
      await this._checkpoint.save({
        runId,
        stageId,
        capability,
        reason: 'model_quota_fallback',
        override: {
          source: 'official',
          originalProviderId,
          decidedAt: new Date().toISOString(),
          reason: decision.reason,
        },
      })
      if (runContext && typeof runContext.setModelSourceOverride === 'function') {
        const attempts = override && Number.isInteger(override.officialAttempts) ? override.officialAttempts : 0
        runContext.setModelSourceOverride(capability, { source: 'official', officialAttempts: attempts + 1 })
      }
      if (answer.remember && this._store && typeof this._store.setSetting === 'function') {
        this._store.setSetting(POLICY_KEY, 'official')
      }
      const accepted = { ...decision, action: 'use_official', reason: 'user_official', requestId }
      this._recordDecision({ runId, stageId, capability, providerId, model, failure, official, estimate, cap, policy, decision: accepted, userDecision: 'official' })
      return accepted
    }

    this._markDeclined(runId, capability)
    if (answer.remember && answer.decision === 'cancel' && this._store && typeof this._store.setSetting === 'function') {
      this._store.setSetting(POLICY_KEY, 'byok')
    }
    const stopped = {
      ...decision,
      action: 'stop',
      reason: answer.reason || (answer.decision === 'settings' ? 'user_settings' : 'user_cancel'),
      requestId,
    }
    // 非 official 的用户选择也要落检查点（任务进入 paused，保留进度）
    await this._checkpoint.save({
      runId,
      stageId,
      capability,
      reason: stopped.reason,
      override: null,
    })
    this._recordDecision({ runId, stageId, capability, providerId, model, failure, official, estimate, cap, policy, decision: stopped, userDecision: answer.decision })
    return stopped
  }

  _readSetting (key) {
    if (!this._store || typeof this._store.getSetting !== 'function') return null
    try {
      return this._store.getSetting(key)
    } catch (_) {
      return null
    }
  }

  _estimateFromFailure (failure) {
    const raw = failure && (failure.estimateCredits != null
      ? failure.estimateCredits
      : (failure.estimate && failure.estimate.credits))
    if (raw === null || raw === undefined || raw === '') return { credits: null }
    const num = Number(raw)
    return Number.isFinite(num) ? { credits: num } : { credits: null }
  }

  _ask (requestId, payload) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        this._clock.clearTimeout(timer)
        this._requests.delete(requestId)
        resolve(value)
      }
      const timer = this._clock.setTimeout(() => finish(null), this._timeoutMs)
      this._requests.set(requestId, {
        runId: payload.runId,
        capability: payload.capability,
        finish,
        timer,
      })
      try {
        this._emit('model-quota:required', payload)
      } catch (_) {
        this._clock.clearTimeout(timer)
        finish(null)
      }
    })
  }

  /**
   * 渲染端 decide IPC 调用。requestId 一次性；runId/capability 必须与请求绑定。
   * @returns {boolean} 是否接受
   */
  userDecision ({ requestId, runId, capability, decision, remember } = {}) {
    if (!requestId || !['official', 'settings', 'cancel'].includes(decision)) return false
    const request = this._requests.get(requestId)
    if (!request) return false
    if (runId && request.runId !== runId) return false
    if (capability && request.capability !== capability) return false
    this._clock.clearTimeout(request.timer)
    request.finish({ decision, remember: remember === true })
    return true
  }

  clearRun (runId) {
    const id = String(runId || '').trim()
    if (!id) return
    for (const [requestId, request] of this._requests) {
      if (request.runId !== id) continue
      this._clock.clearTimeout(request.timer)
      request.finish({ decision: 'cancel', remember: false, reason: 'run_cleared' })
    }
    this._declined.delete(id)
    // 不直接删 _pending：在飞的 decide 还要走自己的 finally 清理；
    // 直接删会让同一 (runId, capability) 立刻重入，造成重复 checkpoint/emit。
  }

  _isDeclined (runId, capability) {
    const set = this._declined.get(runId)
    return Boolean(set && set.has(capability))
  }

  _markDeclined (runId, capability) {
    if (!this._declined.has(runId)) this._declined.set(runId, new Set())
    this._declined.get(runId).add(capability)
  }

  _recordDecision (payload) {
    try {
      this._telemetry.record('model_quota_decision', payload)
    } catch (_) {
      // 埋点失败不影响主流程
    }
  }
}

module.exports = {
  ModelQuotaCoordinator,
  POLICY_KEY,
  CAP_KEY,
  DEFAULT_TIMEOUT_MS,
}
