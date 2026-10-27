'use strict'
/**
 * model-quota-call-boundary.js — 在统一模型调用入口上接「额度兜底询问」。
 *
 * 为什么包 manager.callAdapter 而不是改 manager：
 *   - manager 是唯一调用漏斗，业务域（Story2Video / 图片轮播 / 数字人 / Film）都经过它；
 *   - manager 在点名还账清单里（target=1284、零容差），不能为接线再增行；
 *   - 包装层只在「已有 run context + 失败可兜底」时介入，其余调用原样透传。
 *
 * 产出错误码：
 *   - MODEL_QUOTA_PAUSED：用户取消/去设置，任务应暂停而不是失败；
 *   - MODEL_OFFICIAL_UNAVAILABLE：用户选官方但 P2 官方供给未落地。
 */

const CAPABILITY_BY_METHOD = Object.freeze({
  chatCompletion: 'llm',
  streamChat: 'llm',
  embeddings: 'llm',
  generateImage: 'image',
  editImage: 'image',
  createCover: 'image',
  generateVideo: 'video',
  getVideoStatus: 'video',
  createVideoByImage: 'video',
  createVideoByAudio: 'video',
  createVideoBySing: 'video',
  createVideoByTemplate: 'video',
  translateVideo: 'video',
  synthesize: 'tts',
  createAudioByTts: 'tts',
  cloneVoice: 'tts',
  editVoice: 'tts',
  generateMusic: 'audio',
  searchMusic: 'audio',
  transcribe: 'speech_recognition',
})

const QUOTA_STATES = new Set(['quota_exhausted', 'credential_invalid'])
const QUOTA_CODES = new Set([
  'QUOTA_EXCEEDED',
  'MODEL_QUOTA_EXHAUSTED',
  'MODEL_QUOTA_PLAN_WINDOW',
  'MODEL_QUOTA_PLAN_EXPIRED',
  'MODEL_CREDENTIAL_INVALID',
])

function capabilityFor (method, provider) {
  if (CAPABILITY_BY_METHOD[method]) return CAPABILITY_BY_METHOD[method]
  const category = provider && provider.category
  if (category === 'image' || category === 'video' || category === 'audio') return category
  return 'llm'
}

function isFallbackFailure (result) {
  if (!result || typeof result !== 'object' || Number(result.code) === 0) return false
  if (QUOTA_STATES.has(result.accessState)) return true
  if (result.fallbackEligible === true || result.askOnly === true) return true
  return QUOTA_CODES.has(String(result.errorCode || result.userErrorCode || ''))
}

function createModelQuotaCallBoundary (runtime) {
  return async function handleQuotaFailure ({ providerId, method, params, result, options }) {
    if (!runtime || typeof runtime.decide !== 'function') return result
    const runContext = options && options.providerRunContext
    const meta = typeof runtime.metaForContext === 'function' ? runtime.metaForContext(runContext) : null
    if (!meta || !meta.runId) return result

    let decision
    try {
      decision = await runtime.decide({
        runId: meta.runId,
        stageId: meta.stageId || null,
        capability: capabilityFor(method),
        providerId,
        model: params && params.model,
        failure: result.error || result,
        runContext,
      })
    } catch (_) {
      return result
    }

    if (decision && decision.action === 'use_official') {
      const capability = capabilityFor(method)
      if (runContext && typeof runContext.clearModelSourceOverride === 'function') runContext.clearModelSourceOverride(capability)
      return {
        ...result,
        success: false,
        code: -1,
        errorCode: 'MODEL_OFFICIAL_UNAVAILABLE',
        message: '官方模型供给尚未接入，无法继续使用官方模型。',
        modelQuotaDecision: decision,
      }
    }
    if (decision && decision.action === 'stop') {
      const userSettings = decision.reason === 'user_settings'
      return {
        ...result,
        success: false,
        code: -1,
        errorCode: 'MODEL_QUOTA_PAUSED',
        message: userSettings ? '任务已暂停：请更新模型设置后继续。' : '任务已暂停：模型额度不足，已保留当前进度。',
        modelQuotaDecision: decision,
      }
    }
    return result
  }
}

/**
 * 包装 manager.callAdapter；幂等，重复调用不会叠加包装。
 * @param {object} manager
 * @param {object} runtime
 * @returns {boolean} 是否本次安装
 */
function installModelQuotaCallBoundary (manager, runtime) {
  if (!manager || typeof manager.callAdapter !== 'function' || !runtime) return false
  if (manager.__modelQuotaBoundaryInstalled) return false
  const original = manager.callAdapter.bind(manager)
  const handleQuotaFailure = createModelQuotaCallBoundary(runtime)
  manager.callAdapter = async function callAdapterWithModelQuota (providerId, method, params = {}, options = {}) {
    const result = await original(providerId, method, params, options)
    if (!isFallbackFailure(result)) return result
    return handleQuotaFailure({ providerId, method, params, result, options })
  }
  manager.__modelQuotaBoundaryInstalled = true
  return true
}

module.exports = {
  installModelQuotaCallBoundary,
  capabilityFor,
  isFallbackFailure,
  createModelQuotaCallBoundary,
}
