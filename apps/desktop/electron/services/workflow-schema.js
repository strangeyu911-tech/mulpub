// @ts-check
/**
 * workflow-schema.js — 复合自动化工作流的配置契约（纯函数，无副作用）
 *
 * 为什么独立成文件：自动化任务原本只有一个 `fullAutoPipeline` 动作，配置是自由对象，
 * 谁都能塞任何键。复合工作流把「来源 / 改写 / 内容 / 发布 / 节奏 / 护栏」六段拼在一起，
 * 任何一段非法都不该被保存——否则任务会在凌晨三点以一条看不懂的报错失败。
 * 校验必须是纯函数：可被 IPC、调度器、渲染层预览三处共用，且能注入固定时钟做边界测试。
 *
 * 三条硬约束（对应 PRD §4）：
 * ① 播客不是平台内容类型，走独立频道（RSS），因此不要求平台目标；
 * ② 视频只能选「文案可直接启动」的流水线——素材型流水线（口播/电影感/剪辑工厂）
 *    需要先导入素材，放进下拉框只会让用户在运行期才发现跑不起来；
 * ③ 抖音爆款本期不实现（无数据源、无行业枚举），来源白名单里没有它，不是灰显。
 */

const crypto = require('crypto')

/** 来源类型白名单（douyinViral = 已采集到爆款库的抖音内容） */
const SOURCE_TYPES = Object.freeze(['hotTopics', 'creatorMonitor', 'zhihuFavlist', 'douyinViral'])
/** 内容类型：图文 / 视频 / 播客（播客走 RSS 频道） */
const CONTENT_TYPES = Object.freeze(['article', 'video', 'podcast'])
/** 文案可直接启动的视频流水线（排除需要先导入素材的 talking-head / cinematic / clip-factory / localization-dub / podcast-repurpose） */
const VIDEO_PIPELINES = Object.freeze([
  'story2video-compose',
  'animated-explainer',
  'documentary-montage',
  'animation',
  'avatar-spokesperson',
  'character-animation',
  'hybrid',
])
/** 发布平台（与 publisher-router ROUTE_TABLE、platform-display-definitions 同源） */
const PLATFORMS = Object.freeze([
  'wechat_mp', 'zhihu', 'weibo', 'douyin', 'xiaohongshu', 'tencent_video', 'kuaishou',
  'toutiao', 'youtube', 'tiktok', 'bilibili', 'baijiahao', 'twitter', 'instagram', 'facebook',
])
/** 热门选题的 11 个类别（与 hot-topics/classifier.js 同源） */
const HOT_TOPIC_CATEGORIES = Object.freeze([
  'general', 'society', 'finance', 'tech', 'ai', 'entertainment',
  'sports', 'emotion', 'education', 'health', 'international',
])
/** 抖音爆款库行业枚举（与前端下拉/数据录入共用；新增项必须同步共享 JSON） */
let VIRAL_INDUSTRIES = Object.freeze(['美妆', '穿搭', '美食', '母婴', '家居', '数码', '职场', '情感', '教育', '健身', '旅行', '财经', '其他'])
try {
  const loaded = require('../../shared/viral-industries.json')
  if (loaded && Array.isArray(loaded.industries)) VIRAL_INDUSTRIES = Object.freeze(loaded.industries.slice())
} catch (_) {
  // 打包遗漏时保留内置枚举，避免模块加载失败。
}

const PLATFORM_LABELS = Object.freeze({
  wechat_mp: '微信公众号', zhihu: '知乎', weibo: '微博', douyin: '抖音', xiaohongshu: '小红书',
  tencent_video: '视频号', kuaishou: '快手', toutiao: '今日头条', youtube: 'YouTube',
  tiktok: 'TikTok', bilibili: 'B站', baijiahao: '百家号', twitter: 'X', instagram: 'Instagram',
  facebook: 'Facebook',
})
const SOURCE_LABELS = Object.freeze({ hotTopics: '热门选题', creatorMonitor: '关注博主', zhihuFavlist: '知乎收藏夹', douyinViral: '抖音爆款库' })
const CONTENT_LABELS = Object.freeze({ article: '图文', video: '视频', podcast: '播客' })

const LIMITS = Object.freeze({
  maxItemsPerRun: 50,
  maxDailyItems: 200,
  maxTargets: 30,
  maxFollows: 50,
  maxFolders: 20,
  maxHotTopicsLimit: 30,
  maxFolderLimit: 50,
  minCadenceMinutes: 5,
  maxCadenceMinutes: 1440,
  maxHorizonDays: 30,
})

const CADENCE_DEFAULTS = Object.freeze({ minMinutes: 35, maxMinutes: 40 })
const GUARDRAIL_DEFAULTS = Object.freeze({ maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 })

function isPlainObject (v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function intInRange (value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max
}

function normalizeStringArray (value, limit) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const s = raw.trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

function normalizeTargets (value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (!isPlainObject(raw)) continue
    const platform = typeof raw.platform === 'string' ? raw.platform.trim() : ''
    const accountId = typeof raw.accountId === 'string' ? raw.accountId.trim() : ''
    if (!platform) continue
    const key = platform + '|' + accountId
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ platform, accountId })
    if (out.length >= LIMITS.maxTargets) break
  }
  return out
}

function errorsForGuardrails (g) {
  const errors = []
  if (!intInRange(g.maxItemsPerRun, 1, LIMITS.maxItemsPerRun)) {
    errors.push({ field: 'guardrails.maxItemsPerRun', reason: 'outOfRange', params: { min: 1, max: LIMITS.maxItemsPerRun } })
  }
  if (!intInRange(g.dailyItemLimit, 1, LIMITS.maxDailyItems)) {
    errors.push({ field: 'guardrails.dailyItemLimit', reason: 'outOfRange', params: { min: 1, max: LIMITS.maxDailyItems } })
  }
  if (!intInRange(g.retryPerItem, 0, 3)) {
    errors.push({ field: 'guardrails.retryPerItem', reason: 'outOfRange', params: { min: 0, max: 3 } })
  }
  return errors
}

function errorsForSource (source) {
  const errors = []
  if (!SOURCE_TYPES.includes(source.type)) {
    errors.push({ field: 'source.type', reason: 'unknown', params: { allowed: SOURCE_TYPES.join(',') } })
    return errors
  }
  if (source.type === 'hotTopics') {
    if (source.categories.length === 0) {
      errors.push({ field: 'source.categories', reason: 'empty' })
    }
    const unknown = source.categories.filter((c) => !HOT_TOPIC_CATEGORIES.includes(c))
    if (unknown.length > 0) {
      errors.push({ field: 'source.categories', reason: 'unknownCategory', params: { unknown } })
    }
    if (!intInRange(source.limit, 1, LIMITS.maxHotTopicsLimit)) {
      errors.push({ field: 'source.limit', reason: 'outOfRange', params: { min: 1, max: LIMITS.maxHotTopicsLimit } })
    }
  }
  if (source.type === 'creatorMonitor') {
    if (source.followIds.length === 0) {
      errors.push({ field: 'source.followIds', reason: 'empty' })
    }
    if (source.followIds.length > LIMITS.maxFollows) {
      errors.push({ field: 'source.followIds', reason: 'tooMany', params: { max: LIMITS.maxFollows } })
    }
    if (!intInRange(source.perCreatorLimit, 1, 20)) {
      errors.push({ field: 'source.perCreatorLimit', reason: 'outOfRange', params: { min: 1, max: 20 } })
    }
  }
  if (source.type === 'zhihuFavlist') {
    if (source.folderTokens.length === 0) {
      errors.push({ field: 'source.folderTokens', reason: 'empty' })
    }
    if (source.folderTokens.length > LIMITS.maxFolders) {
      errors.push({ field: 'source.folderTokens', reason: 'tooMany', params: { max: LIMITS.maxFolders } })
    }
    if (!intInRange(source.limit, 1, LIMITS.maxFolderLimit)) {
      errors.push({ field: 'source.limit', reason: 'outOfRange', params: { min: 1, max: LIMITS.maxFolderLimit } })
    }
  }
  if (source.type === 'douyinViral') {
    if (!VIRAL_INDUSTRIES.includes(source.industry)) {
      errors.push({ field: 'source.industry', reason: 'unknown', params: { allowed: VIRAL_INDUSTRIES } })
    }
    if (!intInRange(source.limit, 1, 50)) {
      errors.push({ field: 'source.limit', reason: 'outOfRange', params: { min: 1, max: 50 } })
    }
    if (!Number.isInteger(source.minLikes) || source.minLikes < 0 || source.minLikes > 10000000) {
      errors.push({ field: 'source.minLikes', reason: 'outOfRange', params: { min: 0, max: 10000000 } })
    }
  }
  return errors
}

function errorsForPublish (publish, content, opts, now) {
  const errors = []
  if (content.type === 'podcast') {
    if (publish.mode === 'scheduled' && publish.startAt) {
      // 播客由 RSS 聚合端按 item 时间抓取，不存在「平台侧定时」；这里只允许立即入期
      errors.push({ field: 'publish.mode', reason: 'podcastImmediateOnly' })
    }
    return errors
  }
  if (publish.targets.length === 0) {
    errors.push({ field: 'publish.targets', reason: 'empty' })
  }
  publish.targets.forEach((t, i) => {
    if (!t.accountId && !opts.allowEmptyAccounts) {
      errors.push({ field: 'publish.targets[' + i + '].accountId', reason: 'empty' })
    }
    if (!PLATFORMS.includes(t.platform)) {
      errors.push({ field: 'publish.targets[' + i + '].platform', reason: 'unsupported', params: { platform: t.platform } })
    }
  })
  if (publish.targets.length > LIMITS.maxTargets) {
    errors.push({ field: 'publish.targets', reason: 'tooMany', params: { max: LIMITS.maxTargets } })
  }
  if (publish.mode === 'scheduled') {
    const ts = Date.parse(publish.startAt)
    if (!publish.startAt || !Number.isFinite(ts)) {
      errors.push({ field: 'publish.startAt', reason: 'invalid' })
    } else if (ts <= now) {
      errors.push({ field: 'publish.startAt', reason: 'notFuture' })
    } else if (ts - now > LIMITS.maxHorizonDays * 24 * 60 * 60 * 1000) {
      errors.push({ field: 'publish.startAt', reason: 'beyondHorizon', params: { maxDays: LIMITS.maxHorizonDays } })
    }
  }
  return errors
}

/**
 * 校验并归一化工作流配置。不抛错：逐条返回 field + reason，由调用方映射文案。
 * @param {unknown} raw
 * @param {{ now?: number, allowEmptyAccounts?: boolean }} [opts] allowEmptyAccounts 仅供模板校验：模板只存平台建议，不存账号 ID
 * @returns {{ ok: boolean, config: object, errors: Array<{field:string,reason:string,params?:object}> }}
 */
function validateWorkflowConfig (raw, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const errors = []
  const src = isPlainObject(raw) ? raw : {}
  const rawSource = isPlainObject(src.source) ? src.source : {}
  const source = {
    type: typeof rawSource.type === 'string' ? rawSource.type : '',
    categories: normalizeStringArray(rawSource.categories, HOT_TOPIC_CATEGORIES.length),
    limit: Number.isInteger(rawSource.limit) ? rawSource.limit : (rawSource.type === 'zhihuFavlist' ? 20 : 10),
    sort: rawSource.sort === 'score' ? 'score' : 'latest',
    followIds: normalizeStringArray(rawSource.followIds, LIMITS.maxFollows + 1),
    perCreatorLimit: Number.isInteger(rawSource.perCreatorLimit) ? rawSource.perCreatorLimit : 3,
    folderTokens: normalizeStringArray(rawSource.folderTokens, LIMITS.maxFolders + 1),
    industry: typeof rawSource.industry === 'string' ? rawSource.industry : '',
    minLikes: Number.isInteger(rawSource.minLikes) ? rawSource.minLikes : 0,
  }
  errors.push(...errorsForSource(source))

  const rawRewrite = isPlainObject(src.rewrite) ? src.rewrite : {}
  const rewrite = {
    mode: rawRewrite.mode === 'strategy' ? 'strategy' : 'default',
    strategyId: typeof rawRewrite.strategyId === 'string' ? rawRewrite.strategyId.trim() : '',
    length: ['keep', 'shorten', 'expand'].includes(rawRewrite.length) ? rawRewrite.length : 'keep',
  }
  if (rewrite.mode === 'strategy' && !rewrite.strategyId) {
    errors.push({ field: 'rewrite.strategyId', reason: 'empty' })
  }

  const rawContent = isPlainObject(src.content) ? src.content : {}
  const content = {
    type: CONTENT_TYPES.includes(rawContent.type) ? rawContent.type : '',
    videoPipeline: typeof rawContent.videoPipeline === 'string' ? rawContent.videoPipeline.trim() : '',
    podcastChannelId: typeof rawContent.podcastChannelId === 'string' ? rawContent.podcastChannelId.trim() : '',
  }
  if (!content.type) {
    errors.push({ field: 'content.type', reason: 'unknown' })
  } else if (content.type === 'video') {
    if (!content.videoPipeline) {
      errors.push({ field: 'content.videoPipeline', reason: 'empty' })
    } else if (!VIDEO_PIPELINES.includes(content.videoPipeline)) {
      errors.push({ field: 'content.videoPipeline', reason: 'unsupported', params: { pipeline: content.videoPipeline } })
    }
  } else if (content.type === 'podcast' && !content.podcastChannelId) {
    errors.push({ field: 'content.podcastChannelId', reason: 'empty' })
  }

  const rawPublish = isPlainObject(src.publish) ? src.publish : {}
  const publish = {
    targets: normalizeTargets(rawPublish.targets),
    mode: rawPublish.mode === 'scheduled' ? 'scheduled' : 'immediate',
    startAt: typeof rawPublish.startAt === 'string' ? rawPublish.startAt.trim() : '',
  }
  if (publish.mode === 'immediate') publish.startAt = ''
  errors.push(...errorsForPublish(publish, content, opts, now))

  const rawCadence = isPlainObject(src.cadence) ? src.cadence : {}
  const cadence = {
    minMinutes: Number.isInteger(rawCadence.minMinutes) ? rawCadence.minMinutes : CADENCE_DEFAULTS.minMinutes,
    maxMinutes: Number.isInteger(rawCadence.maxMinutes) ? rawCadence.maxMinutes : CADENCE_DEFAULTS.maxMinutes,
  }
  if (!intInRange(cadence.minMinutes, LIMITS.minCadenceMinutes, LIMITS.maxCadenceMinutes)) {
    errors.push({ field: 'cadence.minMinutes', reason: 'outOfRange', params: { min: LIMITS.minCadenceMinutes, max: LIMITS.maxCadenceMinutes } })
  }
  if (!intInRange(cadence.maxMinutes, LIMITS.minCadenceMinutes, LIMITS.maxCadenceMinutes)) {
    errors.push({ field: 'cadence.maxMinutes', reason: 'outOfRange', params: { min: LIMITS.minCadenceMinutes, max: LIMITS.maxCadenceMinutes } })
  }
  if (cadence.minMinutes > cadence.maxMinutes) {
    errors.push({ field: 'cadence.minMinutes', reason: 'minGreaterThanMax' })
  }

  const rawGuardrails = isPlainObject(src.guardrails) ? src.guardrails : {}
  const guardrails = {
    maxItemsPerRun: Number.isInteger(rawGuardrails.maxItemsPerRun) ? rawGuardrails.maxItemsPerRun : GUARDRAIL_DEFAULTS.maxItemsPerRun,
    dailyItemLimit: Number.isInteger(rawGuardrails.dailyItemLimit) ? rawGuardrails.dailyItemLimit : GUARDRAIL_DEFAULTS.dailyItemLimit,
    retryPerItem: Number.isInteger(rawGuardrails.retryPerItem) ? rawGuardrails.retryPerItem : GUARDRAIL_DEFAULTS.retryPerItem,
  }
  errors.push(...errorsForGuardrails(guardrails))

  const review = { requireApproval: !!(isPlainObject(src.review) && src.review.requireApproval === true) }
  const dedupe = { enabled: !(isPlainObject(src.dedupe) && src.dedupe.enabled === false) }

  return {
    ok: errors.length === 0,
    errors,
    config: { source, rewrite, content, publish, cadence, guardrails, review, dedupe },
  }
}

/** 新建工作流时的默认配置（全部落在合法区间内） */
function buildDefaultWorkflowConfig () {
  return {
    source: { type: 'hotTopics', categories: ['ai'], limit: 10, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [], industry: '', minLikes: 0 },
    rewrite: { mode: 'default', strategyId: '', length: 'keep' },
    content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
    publish: { targets: [], mode: 'immediate', startAt: '' },
    cadence: { ...CADENCE_DEFAULTS },
    guardrails: { ...GUARDRAIL_DEFAULTS },
    review: { requireApproval: false },
    dedupe: { enabled: true },
  }
}

/** 面向列表/确认页的一句话摘要 */
function describeWorkflow (config) {
  if (!config || typeof config !== 'object') return ''
  const src = config.source || {}
  const content = config.content || {}
  const cadence = config.cadence || CADENCE_DEFAULTS
  const parts = []
  parts.push(SOURCE_LABELS[src.type] || '未知来源')
  parts.push(CONTENT_LABELS[content.type] || '未知内容')
  parts.push(cadence.minMinutes + '-' + cadence.maxMinutes + ' 分钟')
  const targets = Array.isArray(config.publish && config.publish.targets) ? config.publish.targets : []
  if (content.type === 'podcast') {
    parts.push('播客 RSS 频道')
  } else if (targets.length > 0) {
    const names = targets.map((t) => PLATFORM_LABELS[t.platform] || t.platform)
    const summary = Array.from(new Set(names)).join('/')
    parts.push(targets.length > 1 ? summary + ' · ' + targets.length + ' 个账号' : summary)
  }
  return parts.join(' · ')
}

/** 内容指纹：归一化标题 + 正文的 SHA-256（去重双键之一） */
function fingerprintContent ({ title, content }) {
  const norm = (v) => String(v == null ? '' : v)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return crypto.createHash('sha256').update(norm(title) + '\n' + norm(content)).digest('hex')
}

/** 内置模板：只读；创建时另存为「我的模板」后再改。账号留空 = 使用平台默认账号。 */
const BUILTIN_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'zhihu-fav-story-video',
    name: '知乎收藏夹 → 故事讲述视频',
    description: '收藏夹里的新文章去重后，逐条生成故事讲述视频，同账号 35-40 分钟间隔批量发布到视频平台。',
    badge: '推荐',
    config: {
      source: { type: 'zhihuFavlist', folderTokens: ['__pick_folder__'], limit: 10, categories: [], sort: 'latest', followIds: [], perCreatorLimit: 3 },
      rewrite: { mode: 'default', strategyId: '', length: 'keep' },
      content: { type: 'video', videoPipeline: 'story2video-compose', podcastChannelId: '' },
      publish: {
        targets: [
          { platform: 'bilibili', accountId: '' },
          { platform: 'douyin', accountId: '' },
          { platform: 'tencent_video', accountId: '' },
          { platform: 'youtube', accountId: '' },
        ],
        mode: 'immediate',
        startAt: '',
      },
      cadence: { minMinutes: 35, maxMinutes: 40 },
      guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
      review: { requireApproval: false },
      dedupe: { enabled: true },
    },
  }),
  Object.freeze({
    id: 'creator-article-daily',
    name: '关注博主 → 图文分发',
    description: '关注博主的新作品改写为图文，发到知乎与微博；适合每天固定时段巡检一次。',
    badge: '日常',
    config: {
      source: { type: 'creatorMonitor', followIds: ['__pick_follow__'], perCreatorLimit: 3, categories: [], limit: 10, sort: 'latest', folderTokens: [] },
      rewrite: { mode: 'default', strategyId: '', length: 'keep' },
      content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
      publish: {
        targets: [
          { platform: 'zhihu', accountId: '' },
          { platform: 'weibo', accountId: '' },
        ],
        mode: 'immediate',
        startAt: '',
      },
      cadence: { minMinutes: 10, maxMinutes: 15 },
      guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
      review: { requireApproval: false },
      dedupe: { enabled: true },
    },
  }),
  Object.freeze({
    id: 'hot-topic-article',
    name: '热门选题 → 图文快讯',
    description: '抓取 AI / 科技分类的最新选题，改写为图文后发到头条与百家号。',
    badge: '热点',
    config: {
      source: { type: 'hotTopics', categories: ['ai', 'tech'], limit: 10, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [] },
      rewrite: { mode: 'default', strategyId: '', length: 'keep' },
      content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
      publish: {
        targets: [
          { platform: 'toutiao', accountId: '' },
          { platform: 'baijiahao', accountId: '' },
        ],
        mode: 'immediate',
        startAt: '',
      },
      cadence: { minMinutes: 30, maxMinutes: 40 },
      guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
      review: { requireApproval: false },
      dedupe: { enabled: true },
    },
  }),
  Object.freeze({
    id: 'hot-topic-explainer-video',
    name: '热门选题 → 解释视频',
    description: '把最新 AI 选题做成解释视频，30-40 分钟间隔发到抖音/视频号/快手。',
    badge: '视频',
    config: {
      source: { type: 'hotTopics', categories: ['ai'], limit: 5, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [] },
      rewrite: { mode: 'default', strategyId: '', length: 'keep' },
      content: { type: 'video', videoPipeline: 'animated-explainer', podcastChannelId: '' },
      publish: {
        targets: [
          { platform: 'douyin', accountId: '' },
          { platform: 'tencent_video', accountId: '' },
          { platform: 'kuaishou', accountId: '' },
        ],
        mode: 'immediate',
        startAt: '',
      },
      cadence: { minMinutes: 30, maxMinutes: 40 },
      guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
      review: { requireApproval: false },
      dedupe: { enabled: true },
    },
  }),
  Object.freeze({
    id: 'zhihu-fav-podcast',
    name: '知乎收藏夹 → 播客一期',
    description: '把收藏夹文章改写成播客脚本，合成音频后自动出一期 RSS，小宇宙/Apple/Spotify 自动抓取。',
    badge: '播客',
    config: {
      source: { type: 'zhihuFavlist', folderTokens: ['__pick_folder__'], limit: 5, categories: [], sort: 'latest', followIds: [], perCreatorLimit: 3 },
      rewrite: { mode: 'default', strategyId: '', length: 'keep' },
      content: { type: 'podcast', videoPipeline: '', podcastChannelId: '__pick_channel__' },
      publish: { targets: [], mode: 'immediate', startAt: '' },
      cadence: { minMinutes: 60, maxMinutes: 90 },
      guardrails: { maxItemsPerRun: 3, dailyItemLimit: 10, retryPerItem: 1 },
      review: { requireApproval: false },
      dedupe: { enabled: true },
    },
  }),
])

module.exports = {
  SOURCE_TYPES,
  CONTENT_TYPES,
  VIDEO_PIPELINES,
  PLATFORMS,
  HOT_TOPIC_CATEGORIES,
  VIRAL_INDUSTRIES,
  PLATFORM_LABELS,
  SOURCE_LABELS,
  CONTENT_LABELS,
  LIMITS,
  CADENCE_DEFAULTS,
  GUARDRAIL_DEFAULTS,
  buildDefaultWorkflowConfig,
  validateWorkflowConfig,
  describeWorkflow,
  fingerprintContent,
  BUILTIN_TEMPLATES,
}
