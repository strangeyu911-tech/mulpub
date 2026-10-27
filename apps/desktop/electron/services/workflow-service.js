// @ts-check
/**
 * workflow-service.js — 模板库与计划预览的门面（IPC 直接消费）
 *
 * 为什么模板要单独一层：
 * - 内置模板必须**只读**：升级内置模板时不能覆盖用户改过的副本；
 * - 自定义模板存 settings（与任务同一存储面），必须校验后才落盘；
 * - 导入/导出是团队分发的唯一路径，JSON 形状要稳定、版本要显式。
 */

const crypto = require('crypto')
const {
  BUILTIN_TEMPLATES,
  validateWorkflowConfig,
  describeWorkflow,
  buildDefaultWorkflowConfig,
  SOURCE_TYPES,
  CONTENT_TYPES,
  VIDEO_PIPELINES,
  PLATFORMS,
  HOT_TOPIC_CATEGORIES,
  SOURCE_LABELS,
  CONTENT_LABELS,
  PLATFORM_LABELS,
  LIMITS,
} = require('./workflow-schema')
const { estimatePlan } = require('./workflow-plan')

const CUSTOM_KEY = 'workflow_templates_custom'
const MAX_CUSTOM = 50
const NAME_MAX = 40

function newTemplateId () {
  return 'wft_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')
}

function parseCustom (raw) {
  if (raw == null) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.filter((t) => t && t.id && t.config) : []
  } catch (_) {
    return []
  }
}

/**
 * @param {{ store: object, runner: object, now?: () => number }} deps
 */
function createWorkflowService (deps = {}) {
  const store = deps.store
  if (!store) throw new TypeError('workflow-service 需要 store')
  const now = typeof deps.now === 'function' ? deps.now : Date.now

  function loadCustom () { return parseCustom(store.getSetting(CUSTOM_KEY)) }
  function saveCustom (list) { store.setSetting(CUSTOM_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM))) }

  function listTemplates () {
    return {
      builtin: BUILTIN_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        badge: t.badge || '',
        readonly: true,
        config: JSON.parse(JSON.stringify(t.config)),
      })),
      custom: loadCustom().map((t) => ({ ...t, readonly: false })),
    }
  }

  function saveTemplate (input) {
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!name) return { ok: false, reason: 'name:empty' }
    if (name.length > NAME_MAX) return { ok: false, reason: 'name:tooLong' }
    const validated = validateWorkflowConfig(input && input.config, { now: now(), allowEmptyAccounts: true })
    if (!validated.ok) return { ok: false, reason: 'invalid-config', errors: validated.errors }
    const list = loadCustom()
    if (list.some((t) => t.name === name)) return { ok: false, reason: 'name:duplicate' }
    if (list.length >= MAX_CUSTOM) return { ok: false, reason: 'limit' }
    const template = {
      id: newTemplateId(),
      name,
      description: typeof input.description === 'string' ? input.description.slice(0, 200) : '',
      config: validated.config,
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
    }
    list.push(template)
    try {
      saveCustom(list)
    } catch (e) {
      return { ok: false, reason: 'persist-failed', message: e && e.message ? e.message : String(e) }
    }
    return { ok: true, template }
  }

  function deleteTemplate (id) {
    if (BUILTIN_TEMPLATES.some((t) => t.id === id)) return { ok: false, reason: 'builtin-readonly' }
    const list = loadCustom()
    const next = list.filter((t) => t.id !== id)
    if (next.length === list.length) return { ok: false, reason: 'not-found' }
    saveCustom(next)
    return { ok: true }
  }

  function findTemplate (id) {
    const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id)
    if (builtin) return { ...builtin, readonly: true }
    const custom = loadCustom().find((t) => t.id === id)
    return custom ? { ...custom, readonly: false } : null
  }

  function exportTemplate (id) {
    const t = findTemplate(id)
    if (!t) return { ok: false, reason: 'not-found' }
    return { ok: true, data: { version: 1, name: t.name, description: t.description || '', config: t.config } }
  }

  function importTemplate (payload) {
    let parsed = payload
    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload)
      } catch (_) {
        return { ok: false, reason: 'invalid-json' }
      }
    }
    if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'invalid-shape' }
    if (parsed.version !== 1) return { ok: false, reason: 'unsupported-version' }
    return saveTemplate({ name: parsed.name, description: parsed.description, config: parsed.config })
  }

  /** 渲染层下拉框的唯一数据源：标签与白名单都由主进程下发，避免前端再抄一份枚举 */
  function getWorkflowMeta () {
    return {
      defaults: buildDefaultWorkflowConfig(),
      sources: SOURCE_TYPES.map((id) => ({ id, label: SOURCE_LABELS[id] })),
      contentTypes: CONTENT_TYPES.map((id) => ({ id, label: CONTENT_LABELS[id] })),
      videoPipelines: VIDEO_PIPELINES.map((id) => ({ id, label: id })),
      platforms: PLATFORMS.map((id) => ({ id, label: PLATFORM_LABELS[id] })),
      categories: HOT_TOPIC_CATEGORIES.slice(),
      limits: { ...LIMITS },
    }
  }

  function previewPlan (config, opts = {}) {
    const validated = validateWorkflowConfig(config, { now: now() })
    if (!validated.ok) return { ok: false, errors: validated.errors }
    const itemCount = Math.max(0, Number(opts.itemCount) || 0)
    // 预览按下限估算（对用户最保守），不用随机源
    const plan = estimatePlan({ config: validated.config, itemCount, now: now(), random: () => 0 })
    return {
      ok: true,
      summary: describeWorkflow(validated.config),
      targets: validated.config.publish.targets,
      slotsByTarget: plan.slotsByTarget,
      totalMinutes: plan.totalMinutes,
      config: validated.config,
    }
  }

  return {
    listTemplates,
    getWorkflowMeta,
    saveTemplate,
    deleteTemplate,
    exportTemplate,
    importTemplate,
    previewPlan,
    listRuns: () => (deps.runner && typeof deps.runner.listRuns === 'function' ? deps.runner.listRuns() : []),
    getRun: (runId) => (deps.runner && typeof deps.runner.getRun === 'function' ? deps.runner.getRun(runId) : null),
    listQueue: () => (deps.queue && typeof deps.queue.list === 'function' ? deps.queue.list() : []),
    queueSummary: () => (deps.queue && typeof deps.queue.summary === 'function'
      ? deps.queue.summary()
      : { total: 0, pending: 0, dispatching: 0, dispatched: 0, failed: 0, missed: 0, cancelled: 0 }),
    retryQueueItem: (id) => (deps.queue && typeof deps.queue.retry === 'function'
      ? deps.queue.retry(id)
      : { ok: false, reason: 'queue-unavailable' }),
    approveRun: (runId) => (deps.runner && typeof deps.runner.approveRun === 'function' ? deps.runner.approveRun(runId) : { ok: false, error: 'runner-unavailable' }),
    cancelRun: (runId) => {
      const runnerResult = deps.runner && typeof deps.runner.cancel === 'function'
        ? deps.runner.cancel(runId)
        : { ok: false, error: 'runner-unavailable' }
      const queueResult = deps.queue && typeof deps.queue.cancelRun === 'function'
        ? deps.queue.cancelRun(runId)
        : { cancelled: 0 }
      // 运行已结束但队列里还有未派发项时，也必须能撤掉；两者都动过才算成功
      if (!runnerResult.ok && !queueResult.cancelled) return runnerResult
      return { ok: true, cancelled: queueResult.cancelled || 0 }
    },
  }
}

module.exports = { createWorkflowService, CUSTOM_KEY, MAX_CUSTOM }
