'use strict'
/**
 * provider-run-context.js — 当前流水线运行内的 provider 级熔断与音色恢复协调器。
 *
 * 作用域：绑定到 PipelineEngine 各阶段共享的 context 对象（模块级 WeakMap），
 * 因此不会随 checkpoint JSON 持久化；断点恢复使用新的 context 对象即获得全新 breaker。
 */

const { classifyProviderFailure } = require('./adapters/_base/provider-error')

class ProviderCircuitOpenError extends Error {
  constructor(providerId, message = '') {
    const detail = typeof message === 'string' && message.trim() ? message.trim() : 'quota/token-plan exceeded'
    super(`服务商「${providerId}」已因额度/套餐上限熔断，本次运行已停止该服务商的新请求：${detail}`)
    this.name = 'ProviderCircuitOpenError'
    this.code = 'PROVIDER_CIRCUIT_OPEN'
    this.providerId = providerId
  }
}

class ProviderRunContext {
  constructor() {
    this._open = new Map()
    this._voice = new Map()
    this._modelSourceOverrides = new Map()
  }

  /**
   * 读取当前 run 的官方来源覆盖。返回副本，调用方不能改内部状态。
   * @param {string} capability
   * @returns {{source:'official'|'byok', officialAttempts:number}|null}
   */
  getModelSourceOverride(capability) {
    const key = String(capability || '').trim()
    if (!key) return null
    const value = this._modelSourceOverrides.get(key)
    return value ? { ...value } : null
  }

  /**
   * 写入当前 run 的官方来源覆盖；只允许 official / byok。
   * 不写 checkpoint、不写 model_providers；持久化由业务域负责。
   * @param {string} capability
   * @param {{source:'official'|'byok', officialAttempts?:number}} override
   */
  setModelSourceOverride(capability, override) {
    const key = String(capability || '').trim()
    const source = override && override.source
    if (!key || (source !== 'official' && source !== 'byok')) return false
    const attempts = Number.isInteger(override.officialAttempts) && override.officialAttempts >= 0
      ? override.officialAttempts
      : 0
    this._modelSourceOverrides.set(key, { source, officialAttempts: attempts })
    return true
  }

  clearModelSourceOverride(capability) {
    const key = String(capability || '').trim()
    if (!key) return
    this._modelSourceOverrides.delete(key)
  }

  clearModelSourceOverrides() {
    this._modelSourceOverrides.clear()
  }

  /** 返回当前 run 的全部来源覆盖副本；渲染层任务详情据此显示「官方」横幅。 */
  getModelSourceOverrides() {
    const out = {}
    for (const [capability, value] of this._modelSourceOverrides) out[capability] = { ...value }
    return out
  }

  failureOf(providerId) {
    const id = String(providerId || '').trim()
    if (!id) return null
    return this._open.get(id) || null
  }

  isOpen(providerId) {
    return Boolean(this.failureOf(providerId))
  }

  assertAvailable(providerId) {
    const failure = this.failureOf(providerId)
    if (failure) throw new ProviderCircuitOpenError(providerId, failure.message)
  }

  open(providerId, error) {
    const id = String(providerId || '').trim()
    if (!id) return
    if (this._open.has(id)) return
    const message = error && typeof error === 'object'
      ? String(error.message || error.error || error.msg || error)
      : String(error || '')
    this._open.set(id, { message: message.slice(0, 500) })
  }

  openIfQuota(providerId, error) {
    if (!providerId) return false
    if (classifyProviderFailure(error) !== 'quota') return false
    this.open(providerId, error)
    return true
  }

  /**
   * 同一 (providerId, voiceId) 在本运行内只克隆一次；并发调用共享同一 Promise。
   * @param {{ providerId: string, voiceId: string, fn: () => Promise<string|{id:string}> }} args
   */
  cloneVoiceOnce({ providerId, voiceId, fn }) {
    const key = String(providerId || '').trim() + '|' + String(voiceId || '').trim()
    if (!key) return Promise.reject(new TypeError('cloneVoiceOnce requires providerId and voiceId'))
    const state = this._voice.get(key)
    if (state) {
      if (state.pending) return state.pending
      if (state.succeeded) return Promise.resolve({ succeeded: true, voiceId: state.succeeded })
      if (state.failed) return Promise.resolve({ failed: true, error: state.failed })
    }

    const next = { pending: null, succeeded: null, failed: null }
    this._voice.set(key, next)
    const promise = Promise.resolve()
      .then(() => fn())
      .then((voice) => {
        const voiceIdResult = voice && typeof voice === 'object' ? voice.id : voice
        if (typeof voiceIdResult !== 'string' || !voiceIdResult.trim()) {
          throw new Error('cloneVoice returned no voice id')
        }
        next.succeeded = voiceIdResult.trim()
        next.pending = null
        return { succeeded: true, voiceId: next.succeeded }
      })
      .catch((error) => {
        next.failed = error && typeof error === 'object' ? error : new Error(String(error || 'clone failed'))
        next.pending = null
        return { failed: true, error: next.failed }
      })
    next.pending = promise
    return promise
  }
}

const contextMap = new WeakMap()

function getProviderRunContext(context) {
  if (!context || typeof context !== 'object') return new ProviderRunContext()
  if (!contextMap.has(context)) contextMap.set(context, new ProviderRunContext())
  return contextMap.get(context)
}

module.exports = {
  ProviderCircuitOpenError,
  ProviderRunContext,
  getProviderRunContext,
}
