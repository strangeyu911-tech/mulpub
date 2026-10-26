// @ts-check
/**
 * workflow-runtime.js — 把复合工作流接到现有服务上（装配层，不做业务判断）
 *
 * 依赖方向刻意保持单向：runner 只认注入的函数，本文件负责把
 * 热门选题 / 博主监控 / 知乎收藏夹 / 改写引擎 / 视频流水线 / 发布队列
 * 这些真实服务适配成 runner 需要的形状。这样 runner 的单测不需要 electron。
 *
 * 播客：出期宿主由播客页惰性创建（registry / channel service / hosting service 三件套
 * 都在那边装配）。本文件只通过注入的 `podcastHostProvider` 取宿主；取不到时返回
 * 可操作的错误，而不是静默退化成「发一条没有音频的图文」。
 */

const { createWorkflowLedger } = require('./workflow-ledger')
const { createWorkflowSources } = require('./workflow-source')
const { createWorkflowRunner } = require('./workflow-runner')
const { createWorkflowPublishQueue } = require('./workflow-publish-queue')

const VIDEO_POLL_INTERVAL_MS = 5000
const VIDEO_TIMEOUT_MS = 30 * 60 * 1000

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractVideoPath (runStatus) {
  if (!runStatus) return ''
  const output = runStatus.output || runStatus.context || {}
  const stages = Array.isArray(runStatus.stages) ? runStatus.stages : []
  for (const s of stages) {
    if (s && (s.type === 'compose' || s.id === 'compose')) {
      const out = s.output || {}
      if (out.videoPath) return out.videoPath
      if (out.video_path) return out.video_path
    }
  }
  return output.videoPath || output.video_path || output.finalVideoPath || ''
}

/**
 * @param {{
 *   store: object,
 *   log: object,
 *   hotTopicsService?: object,
 *   creatorStore?: object,
 *   rewriteEngineService?: object,
 *   pythonBridge?: object,
 *   pipelineEngine?: object,
 *   taskQueue: object,
 *   urlCollector?: object,
 *   podcastHostProvider?: () => object|null,
 *   now?: () => number,
 *   random?: () => number,
 * }} deps
 */
function createWorkflowRuntime (deps = {}) {
  const { store, log } = deps
  if (!store) throw new TypeError('workflow-runtime 需要 store')
  if (!deps.taskQueue) throw new TypeError('workflow-runtime 需要 taskQueue')
  const now = typeof deps.now === 'function' ? deps.now : Date.now
  const random = typeof deps.random === 'function' ? deps.random : Math.random

  const ledger = createWorkflowLedger({ store, now })

  const creatorSource = {
    async listNewDiscoveries ({ followIds, perCreatorLimit }) {
      const storeApi = deps.creatorStore
      if (!storeApi || typeof storeApi.listDiscoveries !== 'function' || typeof storeApi.getFollow !== 'function') {
        throw new Error('博主监控服务未装配')
      }
      const out = []
      for (const followId of followIds) {
        const follow = storeApi.getFollow(followId)
        if (!follow) continue
        const rows = storeApi.listDiscoveries({
          creatorId: follow.creator_id,
          state: 'pending',
          limit: perCreatorLimit,
        })
        for (const row of rows) {
          out.push({
            id: row.id,
            followId,
            platform: follow.platform || row.platform,
            externalId: row.external_id,
            title: row.title,
            url: row.url,
            thumbnail_url: row.thumbnail_url,
            summary: row.summary || '',
            published_at: row.published_at,
          })
        }
      }
      return out
    },
  }

  const zhihuSource = {
    async listFolderItems ({ folderTokens, limit }) {
      const ZhihuFavlistService = require('./zhihu-favlist-service')
      const credential = require('./zhihu-credential')
      const { secret } = credential.resolveSecret(store)
      if (!secret) throw new Error('未配置知乎 Access Secret（设置 → 知乎 API）')
      const svc = new ZhihuFavlistService()
      const rows = []
      for (const token of folderTokens) {
        const r = await svc.getFavlistContents(secret, token, { maxPages: Math.max(1, Math.ceil(limit / 50)) })
        if (!r || !r.success) throw new Error((r && r.error) || '收藏夹读取失败')
        rows.push(...(r.items || []))
      }
      return rows
    },
  }

  const sources = createWorkflowSources({
    hotTopics: deps.hotTopicsService
      ? { fetchTopics: (opts) => deps.hotTopicsService.fetchTopics(opts) }
      : undefined,
    creator: creatorSource,
    zhihu: zhihuSource,
    log,
  })

  async function rewrite ({ item, config }) {
    const content = String(item.content || '').trim()
    const isTopicOnly = !content
    const base = {
      mode: isTopicOnly ? 'create' : 'expand',
      content: isTopicOnly ? String(item.title || '') : content,
      userSettings: {},
    }
    if (config && config.mode === 'strategy' && config.strategyId) base.strategyId = config.strategyId
    if (deps.rewriteEngineService && typeof deps.rewriteEngineService.rewrite === 'function') {
      try {
        const result = await deps.rewriteEngineService.rewrite(base)
        if (result && result.success && result.result) {
          return { ok: true, title: item.title, content: result.result }
        }
      } catch (e) {
        log.warn && log.warn('WorkflowRuntime', '改写引擎失败，回退 Python 聚合: ' + (e && e.message ? e.message : String(e)))
      }
    }
    if (deps.pythonBridge && typeof deps.pythonBridge.requestBackend === 'function') {
      const result = await deps.pythonBridge.requestBackend('POST', '/aggregation/rewrite', {
        title: item.title,
        content: base.content,
        style: config && config.mode === 'strategy' ? config.strategyId : '轻松易懂',
        length: config && config.length ? config.length : 'keep',
      })
      const text = result && result.code === 0 && result.data
        ? (result.data.content || result.data.rewritten_content || '')
        : ''
      if (text) return { ok: true, title: item.title, content: text }
    }
    return { ok: false, error: '没有可用的改写引擎（改写引擎与 Python 聚合都不可用）' }
  }

  async function collectArticle (url) {
    if (!deps.urlCollector || typeof deps.urlCollector.collect !== 'function') {
      return { ok: false, error: '正文采集器未装配' }
    }
    const r = await deps.urlCollector.collect(url)
    if (!r || !r.success) return { ok: false, error: (r && r.error) || '正文采集失败' }
    return { ok: true, title: r.title || '', content: r.content || '', coverImage: r.coverImage || r.cover_image || '' }
  }

  async function createVideo ({ item, pipeline }) {
    if (!deps.pipelineEngine || typeof deps.pipelineEngine.startOrchestrated !== 'function') {
      return { ok: false, error: '视频流水线引擎未装配' }
    }
    const started = await deps.pipelineEngine.startOrchestrated(pipeline, {
      text: item.content || '',
      autoAdvance: true,
      background: true,
      checkpointPolicy: 'none',
    })
    if (!started || started.success === false) {
      return { ok: false, error: (started && started.error) || '视频创作启动失败' }
    }
    const deadline = now() + VIDEO_TIMEOUT_MS
    while (now() < deadline) {
      const status = await deps.pipelineEngine.getRunContext(started.runId)
      const runStatus = status && (status.status || (status.run && status.run.status))
      if (runStatus === 'completed' || runStatus === 'success') {
        return { ok: true, videoPath: extractVideoPath(status), runId: started.runId }
      }
      if (runStatus === 'failed' || runStatus === 'error') {
        return { ok: false, error: (status && status.error) || '视频创作失败' }
      }
      if (runStatus === 'cancelled') return { ok: false, error: '视频创作已取消' }
      await sleep(VIDEO_POLL_INTERVAL_MS)
    }
    return { ok: false, error: '视频创作超时（30 分钟）' }
  }

  async function createPodcast ({ item, channelId }) {
    const host = typeof deps.podcastHostProvider === 'function' ? deps.podcastHostProvider() : null
    if (!host || typeof host.publishFromScript !== 'function') {
      return { ok: false, error: '播客出期宿主未初始化：请先打开「播客 RSS 频道」页完成频道配置后重试' }
    }
    try {
      const result = await host.publishFromScript({
        channelId,
        title: item.title,
        copy: { content: item.content || '' },
        billingConfirmed: true,
      })
      return { ok: true, episodeId: (result && (result.episodeId || result.id)) || '' }
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) }
    }
  }

  const queue = createWorkflowPublishQueue({
    store,
    log,
    now,
    minDispatchDelayMs: 60 * 1000,
    enqueue: async (entry) => {
      const article = { ...entry.article, accountId: entry.accountId }
      deps.taskQueue.add({
        platform: entry.platform,
        article,
        accountId: entry.accountId,
        batchId: 'wf_' + entry.runId,
        ...(article.video_path ? { timeout: 1800000 } : {}),
      })
    },
  })

  const runner = createWorkflowRunner({
    sources,
    ledger,
    rewrite,
    collectArticle,
    createVideo,
    createPodcast,
    schedulePublish: async (payload) => {
      const r = queue.add({
        runId: payload.runId,
        workflowId: payload.workflowId,
        itemKey: payload.item && (payload.item.externalId || payload.item.url || payload.item.title),
        title: payload.item && payload.item.title,
        platform: payload.target.platform,
        accountId: payload.target.accountId,
        article: payload.article,
        publishAt: payload.publishAt,
      })
      return r.ok ? { ok: true, scheduleId: r.id } : { ok: false, error: r.reason || '入队失败' }
    },
    cancelSchedule: async (scheduleId) => queue.remove(scheduleId),
    store,
    log,
    now,
    random,
  })

  return { ledger, sources, queue, runner }
}

module.exports = { createWorkflowRuntime, extractVideoPath }
