'use strict'
/**
 * model-quota-checkpoint-port.js — 把 Coordinator 的检查点请求落到 RunStateStore。
 *
 * Coordinator 只给最小字段：{ runId, stageId, capability, reason, override }。
 * RunStateStore 需要完整编排快照，所以这里读旧快照、合并 modelSourceOverrides 后 savePaused。
 * 只写 source/originalProviderId/decidedAt/reason，绝不写 API Key 或响应体。
 */

const MODEL_QUOTA_CHECKPOINT_KEY = 'modelQuota'

function cloneJson (value) {
  if (value === null || value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_) {
    return null
  }
}

function sanitizeOverride (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.source !== 'official' && value.source !== 'byok') return null
  const out = { source: value.source }
  if (Number.isInteger(value.officialAttempts) && value.officialAttempts >= 0) out.officialAttempts = value.officialAttempts
  if (typeof value.originalProviderId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.originalProviderId.trim())) {
    out.originalProviderId = value.originalProviderId.trim()
  }
  if (typeof value.decidedAt === 'string' && value.decidedAt.trim()) out.decidedAt = value.decidedAt.trim()
  if (typeof value.reason === 'string' && value.reason.trim()) out.reason = value.reason.trim()
  return out
}

function toRun (snapshot, entry) {
  const clonedContext = cloneJson(snapshot.context)
  const context = clonedContext && typeof clonedContext === 'object' && !Array.isArray(clonedContext)
    ? clonedContext
    : {}
  const existing = {}
  if (context.modelSourceOverrides && typeof context.modelSourceOverrides === 'object' && !Array.isArray(context.modelSourceOverrides)) {
    for (const [capability, value] of Object.entries(context.modelSourceOverrides)) {
      const sanitized = sanitizeOverride(value)
      if (sanitized) existing[capability] = sanitized
    }
  }
  const override = sanitizeOverride(entry.override)
  if (override) existing[entry.capability] = override
  else delete existing[entry.capability]
  context.modelSourceOverrides = existing

  const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
    ? { ...snapshot.checkpoint }
    : {}
  checkpoint[MODEL_QUOTA_CHECKPOINT_KEY] = {
    capability: entry.capability,
    ...(entry.stageId ? { stageId: entry.stageId } : {}),
    reason: entry.reason,
    decidedAt: new Date().toISOString(),
  }

  return {
    id: snapshot.runId,
    pipeline: snapshot.pipeline,
    status: 'paused',
    currentStage: snapshot.currentStage,
    stages: Array.isArray(snapshot.stages) ? (cloneJson(snapshot.stages) || []) : [],
    context,
    params: snapshot.params && typeof snapshot.params === 'object' ? snapshot.params : {},
    checkpoint,
    error: snapshot.error || null,
    errorCode: snapshot.errorCode || null,
    errorParams: snapshot.errorParams || null,
    orchestrationMode: snapshot.orchestrationMode || 'orchestrator',
    createdAt: snapshot.createdAt || null,
    projectId: snapshot.projectId || null,
    activeMs: Number.isFinite(Number(snapshot.activeMs)) ? Number(snapshot.activeMs) : 0,
    endedAt: null,
  }
}

/**
 * @param {object|null} runStateStore
 * @param {{log?: {warn?: Function}}} [options]
 */
function createRunStateCheckpointPort (runStateStore, options = {}) {
  const log = options.log || { warn () {} }
  return {
    async save (entry) {
      if (!entry || typeof entry !== 'object') return false
      const runId = typeof entry.runId === 'string' ? entry.runId.trim() : ''
      const capability = typeof entry.capability === 'string' ? entry.capability.trim() : ''
      if (!runId || !capability) return false
      if (!runStateStore || typeof runStateStore.load !== 'function' || typeof runStateStore.savePaused !== 'function') return false

      let snapshot
      try {
        snapshot = runStateStore.load(runId)
      } catch (e) {
        log.warn('ModelQuotaCheckpoint', 'load failed: ' + (e && e.message ? e.message : String(e)))
        return false
      }
      if (!snapshot || snapshot.kind !== 'orchestration-run-state' || snapshot.runId !== runId) return false

      try {
        const saved = runStateStore.savePaused(toRun(snapshot, {
          ...entry,
          runId,
          capability,
          override: entry.override,
        }))
        return saved !== false
      } catch (e) {
        log.warn('ModelQuotaCheckpoint', 'savePaused failed: ' + (e && e.message ? e.message : String(e)))
        return false
      }
    },
  }
}

module.exports = { createRunStateCheckpointPort, MODEL_QUOTA_CHECKPOINT_KEY }
