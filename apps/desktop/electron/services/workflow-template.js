// @ts-check
/**
 * workflow-template.js — 工作流模板的版本化与跨机器迁移
 *
 * 模板是团队分发的载体，必须有显式 format/version：
 * - v1 是首版导出的裸对象（version:1）；
 * - v2 增加 format 标记、导出时间，并把旧版 platform-only targets 迁移为 accountId:''。
 *
 * 迁移只做形状归一化；合法性仍由 workflow-schema.validateWorkflowConfig 负责。
 */

const crypto = require('crypto')

const TEMPLATE_FORMAT = 'mulpub-workflow-template'
const TEMPLATE_VERSION = 2
const LEGACY_VERSION = 1
const NAME_MAX = 40
const MAX_TEMPLATE_BYTES = 256 * 1024

function isPlainObject (v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function safeClone (v) {
  try {
    return JSON.parse(JSON.stringify(v))
  } catch (_) {
    return null
  }
}

function normalizeTargets (targets) {
  if (!Array.isArray(targets)) return []
  return targets.map((t) => {
    if (typeof t === 'string') return t ? { platform: t, accountId: '' } : null
    if (!isPlainObject(t)) return null
    const platform = typeof t.platform === 'string' ? t.platform.trim() : ''
    if (!platform || platform.length > 50) return null
    return { platform, accountId: '' }
  }).filter(Boolean)
}

/** 模板跨机器分发：账号 ID 属于本机，不得写进模板/导出包 */
function sanitizeTemplateConfig (config) {
  const copy = safeClone(config)
  if (!copy) return null
  if (copy && copy.publish && Array.isArray(copy.publish.targets)) {
    copy.publish.targets = normalizeTargets(copy.publish.targets)
  }
  return copy
}

/** 把 v1 配置补齐到当前形状；未知字段丢弃，避免旧版脏字段污染新模板 */
function migrateLegacyConfig (raw) {
  const src = isPlainObject(raw) ? raw : {}
  const source = isPlainObject(src.source) ? src.source : {}
  const rewrite = isPlainObject(src.rewrite) ? src.rewrite : {}
  const content = isPlainObject(src.content) ? src.content : {}
  const publish = isPlainObject(src.publish) ? src.publish : {}
  const cadence = isPlainObject(src.cadence) ? src.cadence : {}
  const guardrails = isPlainObject(src.guardrails) ? src.guardrails : {}
  const review = isPlainObject(src.review) ? src.review : {}
  const dedupe = isPlainObject(src.dedupe) ? src.dedupe : {}
  return {
    source: {
      type: source.type || 'hotTopics',
      categories: Array.isArray(source.categories) ? source.categories : [],
      limit: source.limit,
      sort: source.sort || 'latest',
      followIds: Array.isArray(source.followIds) ? source.followIds : [],
      perCreatorLimit: source.perCreatorLimit,
      folderTokens: Array.isArray(source.folderTokens) ? source.folderTokens : [],
      industry: source.industry || '',
      minLikes: source.minLikes,
    },
    rewrite: {
      mode: rewrite.mode || 'default',
      strategyId: rewrite.strategyId || '',
      length: rewrite.length || 'keep',
    },
    content: {
      type: content.type || 'article',
      videoPipeline: content.videoPipeline || '',
      podcastChannelId: content.podcastChannelId || '',
    },
    publish: {
      mode: publish.mode || 'immediate',
      startAt: publish.startAt || '',
      targets: normalizeTargets(publish.targets),
    },
    cadence: { minMinutes: cadence.minMinutes, maxMinutes: cadence.maxMinutes },
    guardrails: {
      maxItemsPerRun: guardrails.maxItemsPerRun,
      dailyItemLimit: guardrails.dailyItemLimit,
      retryPerItem: guardrails.retryPerItem,
    },
    review: { requireApproval: Boolean(review.requireApproval) },
    dedupe: { enabled: dedupe.enabled !== false },
  }
}

/**
 * @param {unknown} payload JSON 字符串或对象
 * @returns {{ok:true, template:{name:string,description:string,config:object,formatVersion:number,migratedFrom:number|null}}|{ok:false,reason:string}}
 */
function migrateTemplatePayload (payload) {
  let parsed = payload
  if (typeof payload === 'string') {
    if (payload.length > MAX_TEMPLATE_BYTES) return { ok: false, reason: 'too-large' }
    try {
      parsed = JSON.parse(payload)
    } catch (_) {
      return { ok: false, reason: 'invalid-json' }
    }
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: 'invalid-shape' }
  try {
    if (JSON.stringify(parsed).length > MAX_TEMPLATE_BYTES) return { ok: false, reason: 'too-large' }
  } catch (_) {
    return { ok: false, reason: 'invalid-shape' }
  }
  if (!isPlainObject(parsed.config)) return { ok: false, reason: 'invalid-shape' }
  const rawName = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  if (!rawName) return { ok: false, reason: 'name:empty' }
  if (rawName.length > NAME_MAX) return { ok: false, reason: 'name:tooLong' }

  const version = parsed.version == null ? LEGACY_VERSION : parsed.version
  if (version !== LEGACY_VERSION && version !== TEMPLATE_VERSION) {
    return { ok: false, reason: 'unsupported-version' }
  }
  if (version === TEMPLATE_VERSION && parsed.format !== TEMPLATE_FORMAT) {
    return { ok: false, reason: 'unsupported-format' }
  }
  const migrated = version === LEGACY_VERSION
  const config = migrated ? migrateLegacyConfig(parsed.config) : sanitizeTemplateConfig(parsed.config)
  if (!config) return { ok: false, reason: 'invalid-shape' }
  return {
    ok: true,
    template: {
      name: rawName,
      description: typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : '',
      config,
      formatVersion: TEMPLATE_VERSION,
      migratedFrom: migrated ? LEGACY_VERSION : null,
    },
  }
}

function buildTemplateExport (template) {
  const config = sanitizeTemplateConfig(template.config)
  if (!config) return null
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    name: String(template.name || '').slice(0, NAME_MAX),
    description: String(template.description || '').slice(0, 200),
    config,
    exportedAt: new Date().toISOString(),
  }
}

function uniqueName (name, existingNames) {
  const names = new Set(existingNames)
  if (!names.has(name)) return name
  for (let i = 2; i <= 1000; i += 1) {
    const suffix = '（导入 ' + i + '）'
    const candidate = name.slice(0, Math.max(0, NAME_MAX - suffix.length)) + suffix
    if (!names.has(candidate)) return candidate
  }
  const digest = crypto.createHash('sha1').update(name + '|' + existingNames.join('|')).digest('hex').slice(0, 6)
  for (let i = 0; i < 10; i += 1) {
    const suffix = '-' + digest + (i === 0 ? '' : String(i))
    const candidate = name.slice(0, Math.max(0, NAME_MAX - suffix.length)) + suffix
    if (!names.has(candidate)) return candidate
  }
  for (let i = 0; i < 100; i += 1) {
    const suffix = '-' + Date.now().toString(36) + String(i)
    const candidate = name.slice(0, Math.max(0, NAME_MAX - suffix.length)) + suffix
    if (!names.has(candidate)) return candidate
  }
  throw new Error('uniqueName exhausted')
}

module.exports = {
  TEMPLATE_FORMAT,
  TEMPLATE_VERSION,
  LEGACY_VERSION,
  MAX_TEMPLATE_BYTES,
  migrateTemplatePayload,
  migrateLegacyConfig,
  sanitizeTemplateConfig,
  buildTemplateExport,
  uniqueName,
}
