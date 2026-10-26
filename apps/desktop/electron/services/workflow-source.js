// @ts-check
/**
 * workflow-source.js — 把三类来源归一化成工作流条目
 *
 * 归一化合同（运行编排只认这些字段）：
 *   { sourceType, platform, externalId, title, content, summary, url, coverImage,
 *     publishedAt, needsCollect, needsGeneration, meta }
 *
 * 为什么 `needsGeneration` 与 `needsCollect` 分开：
 * - 热门选题只有「话题名」，没有正文 → 改写阶段要**生成**而不是改写；
 * - 博主/收藏夹有 URL 但没有正文 → 改写前要先**采集**正文。
 * 两者混成一个布尔值会让改写阶段在「没有正文」时静默把标题当正文发出去。
 */

function asArray (v) {
  return Array.isArray(v) ? v : []
}

function timeOf (value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

function safeWarn (log, msg) {
  try {
    if (log && typeof log.warn === 'function') log.warn('WorkflowSource', msg)
  } catch (_) { /* 日志失败不得影响采集 */ }
}

function normalizeHotTopic (topic) {
  return {
    sourceType: 'hotTopics',
    platform: '',
    externalId: String(topic.id || topic.url || topic.topic || ''),
    title: String(topic.topic || ''),
    content: '',
    summary: '',
    url: String(topic.url || ''),
    coverImage: '',
    publishedAt: topic.fetchedAt || '',
    needsCollect: false,
    needsGeneration: true,
    meta: {
      channel: topic.channel || '',
      category: topic.category || '',
      categories: asArray(topic.categories),
      score: Number(topic.score) || 0,
      hotValue: Number(topic.hotValue) || 0,
    },
  }
}

function normalizeCreatorItem (item) {
  const platform = String(item.platform || '')
  const externalId = String(item.externalId || item.external_id || item.id || '')
  const content = String(item.summary || item.content || '')
  const url = String(item.url || '')
  return {
    sourceType: 'creatorMonitor',
    platform,
    externalId,
    title: String(item.title || ''),
    content,
    summary: content,
    url,
    coverImage: String(item.thumbnail_url || item.coverImage || ''),
    publishedAt: item.publishedAt || item.published_at || item.discovered_at || '',
    needsCollect: !content && !!url,
    needsGeneration: false,
    meta: { creatorId: item.creatorId || item.creator_id || '', followId: item.followId || item.follow_id || '' },
  }
}

function normalizeZhihuItem (item, index) {
  const url = String(item.url || '')
  const derivedId = url.split('?')[0].split('/').filter(Boolean).pop() || String(index)
  const content = String(item.summary || '')
  return {
    sourceType: 'zhihuFavlist',
    platform: 'zhihu',
    externalId: String(item.id || derivedId),
    title: String(item.title || ''),
    content,
    summary: content,
    url,
    coverImage: String(item.coverImage || ''),
    publishedAt: item.favTime || item.publishTime || '',
    needsCollect: !!url,
    needsGeneration: false,
    meta: { kind: item.kind || item.contentType || '', likeCount: Number(item.likeCount) || 0 },
  }
}

/**
 * @param {{
 *   hotTopics?: { fetchTopics: Function },
 *   creator?: { listNewDiscoveries: Function },
 *   zhihu?: { listFolderItems: Function },
 *   log?: { warn?: Function },
 * }} deps
 */
function createWorkflowSources (deps = {}) {
  const log = deps.log || {}

  async function collectHotTopics (source) {
    if (!deps.hotTopics || typeof deps.hotTopics.fetchTopics !== 'function') {
      return { items: [], warnings: [{ sourceType: 'hotTopics', message: '热门选题服务未装配' }] }
    }
    try {
      const data = await deps.hotTopics.fetchTopics({ force: false, boostCategories: source.categories })
      let topics = asArray(data && data.topics)
      const wanted = asArray(source.categories)
      if (wanted.length > 0) {
        topics = topics.filter((t) => {
          const cats = asArray(t.categories).length > 0 ? asArray(t.categories) : [t.category]
          return cats.some((c) => wanted.includes(c))
        })
      }
      topics.sort((a, b) => {
        if (source.sort === 'score') {
          const diff = (Number(b.score) || 0) - (Number(a.score) || 0)
          return diff !== 0 ? diff : timeOf(b.fetchedAt) - timeOf(a.fetchedAt)
        }
        const diff = timeOf(b.fetchedAt) - timeOf(a.fetchedAt)
        return diff !== 0 ? diff : (Number(b.score) || 0) - (Number(a.score) || 0)
      })
      const items = topics.slice(0, source.limit).map(normalizeHotTopic).filter((i) => i.title)
      return { items, warnings: [] }
    } catch (e) {
      const message = e && e.message ? e.message : String(e)
      safeWarn(log, '热门选题采集失败: ' + message)
      return { items: [], warnings: [{ sourceType: 'hotTopics', message }] }
    }
  }

  async function collectCreator (source) {
    if (!deps.creator || typeof deps.creator.listNewDiscoveries !== 'function') {
      return { items: [], warnings: [{ sourceType: 'creatorMonitor', message: '博主监控服务未装配' }] }
    }
    try {
      const raw = await deps.creator.listNewDiscoveries({
        followIds: source.followIds,
        perCreatorLimit: source.perCreatorLimit,
      })
      const seen = new Set()
      const items = []
      for (const row of asArray(raw)) {
        const item = normalizeCreatorItem(row)
        const key = item.platform + ':' + item.externalId
        if (!item.title || !item.externalId || seen.has(key)) continue
        seen.add(key)
        items.push(item)
      }
      items.sort((a, b) => timeOf(b.publishedAt) - timeOf(a.publishedAt))
      const cap = Math.max(1, source.perCreatorLimit) * Math.max(1, source.followIds.length)
      return { items: items.slice(0, cap), warnings: [] }
    } catch (e) {
      const message = e && e.message ? e.message : String(e)
      safeWarn(log, '博主更新采集失败: ' + message)
      return { items: [], warnings: [{ sourceType: 'creatorMonitor', message }] }
    }
  }

  async function collectZhihu (source) {
    if (!deps.zhihu || typeof deps.zhihu.listFolderItems !== 'function') {
      return { items: [], warnings: [{ sourceType: 'zhihuFavlist', message: '知乎收藏夹服务未装配或未配置 Access Secret' }] }
    }
    try {
      const raw = await deps.zhihu.listFolderItems({ folderTokens: source.folderTokens, limit: source.limit })
      const seen = new Set()
      const items = []
      asArray(raw).forEach((row, index) => {
        const item = normalizeZhihuItem(row, index)
        if (!item.title || !item.url || seen.has(item.url)) return
        seen.add(item.url)
        items.push(item)
      })
      items.sort((a, b) => timeOf(b.publishedAt) - timeOf(a.publishedAt))
      return { items: items.slice(0, source.limit), warnings: [] }
    } catch (e) {
      const message = e && e.message ? e.message : String(e)
      safeWarn(log, '知乎收藏夹采集失败: ' + message)
      return { items: [], warnings: [{ sourceType: 'zhihuFavlist', message }] }
    }
  }

  return {
    async collect (config) {
      const source = (config && config.source) || {}
      if (source.type === 'hotTopics') return collectHotTopics(source)
      if (source.type === 'creatorMonitor') return collectCreator(source)
      if (source.type === 'zhihuFavlist') return collectZhihu(source)
      return { items: [], warnings: [{ sourceType: String(source.type || ''), message: '未知来源类型' }] }
    },
  }
}

module.exports = { createWorkflowSources }
