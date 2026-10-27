// @ts-check
/**
 * workflow-runner.js — 复合自动化工作流的运行编排
 *
 * 结构：运行（run）→ 条目（item），条目独立状态机：
 *   pending → collecting → rewriting → creating → scheduling → scheduled
 *                                                   ↘ awaiting_review（审核开关）
 *                                                   ↘ failed / skipped
 *
 * 五条设计约束（PRD §6）：
 * ① **去重先于创作**：命中账本就跳过，绝不先花 20 分钟生成视频再发现是旧文；
 * ② **单条失败不拖垮整批**：默认 skip，`abort` 才立即停；失败条目保留错误原因；
 * ③ **账本不可读时 fail-closed**：带着失明的去重继续发，比不跑更危险；
 * ④ **审核开关**：打开后生成完停在 awaiting_review，`approveRun` 才排期；
 * ⑤ **额度截断可解释**：少跑了几条必须在 summary 里说清是单次上限还是每日额度。
 */

const { validateWorkflowConfig } = require('./workflow-schema')
const { createPacer, resolveTargetKey, checkGuardrails, buildDedupeKeys } = require('./workflow-plan')
const { createAccountGuard } = require('./workflow-account-guard')
const { applyQueueEventRecord } = require('./workflow-queue-event')
const { buildArticle, itemKeyOf } = require('./workflow-article')
const { adaptArticle } = require('./workflow-adaptation')
const { newRunId, iso, newSummary, withRetry } = require('./workflow-run-utils')
const { snapshotRun } = require('./workflow-run-snapshot')
const { resumePersistedRun } = require('./workflow-resume')

const RUNS_KEY = 'workflow_runs'
const MAX_PERSISTED_RUNS = 50

/**
 * @param {{
 *   sources: { collect: Function },
 *   ledger: object,
 *   rewrite: Function,
 *   collectArticle?: Function,
 *   createVideo?: Function,
 *   createPodcast?: Function,
 *   schedulePublish: Function,
 *   store: { getSetting: Function, setSetting: Function },
 *   log?: object,
 *   now?: () => number,
 *   random?: () => number,
 * }} deps
 */
function createWorkflowRunner (deps = {}) {
  if (!deps.sources || typeof deps.sources.collect !== 'function') throw new TypeError('workflow-runner 需要 sources.collect')
  if (!deps.ledger) throw new TypeError('workflow-runner 需要 ledger')
  if (!deps.store) throw new TypeError('workflow-runner 需要 store')
  if (typeof deps.rewrite !== 'function') throw new TypeError('workflow-runner 需要 rewrite')
  if (typeof deps.schedulePublish !== 'function') throw new TypeError('workflow-runner 需要 schedulePublish')

  const now = typeof deps.now === 'function' ? deps.now : Date.now
  const random = typeof deps.random === 'function' ? deps.random : Math.random
  const log = deps.log || { warn () {}, error () {}, info () {} }
  const accountGuard = createAccountGuard({ accountProvider: deps.accountProvider })

  /** @type {Map<string, object>} */
  const live = new Map()
  const cancelled = new Set()

  function loadPersisted () {
    try {
      const raw = deps.store.getSetting(RUNS_KEY)
      if (raw == null) return []
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(parsed) ? parsed : []
    } catch (_) {
      return []
    }
  }

  function persist (run) {
    try {
      const all = loadPersisted().filter((r) => r && r.id !== run.id)
      all.unshift(run)
      deps.store.setSetting(RUNS_KEY, JSON.stringify(all.slice(0, MAX_PERSISTED_RUNS)))
    } catch (e) {
      log.warn && log.warn('WorkflowRunner', '运行记录持久化失败: ' + (e && e.message ? e.message : String(e)))
    }
  }

  function finish (run, status) {
    run.status = status
    run.finishedAt = iso(now())
    if (status === 'failed' && !run.error && run.items.length > 0) {
      run.error = (run.items.find((i) => i.error) || {}).error || ''
    }
    persist(run)
    // 终态只留在持久化里：live 只服务「正在跑」的取消与状态读取，
    // 否则常驻应用的 live Map 会随每次运行无限增长（含每条的 article 副本）。
    live.delete(run.id)
    return run
  }


  /**
   * 启动一次运行。等待「生成 + 排期」完成（发布由持久队列在到点时执行）。
   * @param {object} task 归一化后的自动化任务
   */
  async function startRun (task) {
    const cfgRaw = task && task.action && task.action.config
    const validation = validateWorkflowConfig(cfgRaw, { now: now() })
    if (!validation.ok) {
      return { ok: false, error: 'invalid-config', errors: validation.errors }
    }
    const config = validation.config
    const accountCheck = await accountGuard.check(config)
    if (!accountCheck.ok) return accountCheck
    if (!deps.ledger.isReadable()) return { ok: false, error: 'ledger-unreadable' }

    const usedToday = typeof deps.ledger.countToday === 'function' ? deps.ledger.countToday() : 0
    if (usedToday >= config.guardrails.dailyItemLimit) {
      return { ok: false, error: 'dailyItemLimit' }
    }

    const run = {
      id: newRunId(),
      workflowId: (task && task.id) || '',
      workflowName: (task && task.name) || '',
      status: 'running',
      startedAt: iso(now()),
      finishedAt: '',
      error: '',
      warnings: [],
      items: [],
      summary: newSummary(),
      _config: config,
    }
    live.set(run.id, run)
    cancelled.delete(run.id)

    let collected
    try {
      collected = await deps.sources.collect(config)
    } catch (e) {
      run.error = e && e.message ? e.message : String(e)
      return { ok: false, runId: run.id, status: finish(run, 'failed').status, error: run.error }
    }
    run.warnings = Array.isArray(collected.warnings) ? collected.warnings.slice() : []
    const rawItems = Array.isArray(collected.items) ? collected.items : []
    run.summary.collected = rawItems.length

    if (rawItems.length === 0) {
      const status = run.warnings.length > 0 ? 'failed' : 'completed'
      if (status === 'failed') run.error = '采集为空：' + run.warnings.map((w) => w.message).join('; ')
      finish(run, status)
      return { ok: status !== 'failed', runId: run.id, status }
    }

    const guard = checkGuardrails({ itemCount: rawItems.length, guardrails: config.guardrails, usedToday })
    if (!guard.ok) {
      run.error = guard.reason
      finish(run, 'failed')
      return { ok: false, error: guard.reason, runId: run.id }
    }
    run.summary.truncated = guard.truncated
    run.summary.truncateReason = guard.reason
    const selected = rawItems.slice(0, guard.allowed)

    for (const [index, src] of selected.entries()) {
      run.items.push({
        index,
        title: src.title || '',
        sourceType: src.sourceType || '',
        platform: src.platform || '',
        externalId: src.externalId || '',
        url: src.url || '',
        itemKey: String(index) + '|' + itemKeyOf(src),
        status: 'pending',
        error: '',
        scheduleId: '',
        publishAt: '',
        videoPath: '',
        episodeId: '',
      })
    }

    const pacerStart = config.publish.mode === 'scheduled' && config.publish.startAt
      ? Date.parse(config.publish.startAt)
      : now()
    const pacer = createPacer({
      startAtMs: Number.isFinite(pacerStart) ? pacerStart : now(),
      minMinutes: config.cadence.minMinutes,
      maxMinutes: config.cadence.maxMinutes,
      random,
      scheduleRules: config.scheduleRules,
    })

    // 先落一份可续跑的运行快照：进程崩溃/超时后，启动时可按 _sources 继续未完成条目。
    run._sources = selected.map((src) => ({ ...src }))
    persist(run)

    let aborted = false
    for (let i = 0; i < selected.length; i++) {
      if (aborted || cancelled.has(run.id)) break
      const src = selected[i]
      const record = run.items[i]
      try {
        await processItem({ run, record, src, config, pacer })
      } catch (e) {
        record.status = 'failed'
        record.error = e && e.message ? e.message : String(e)
      }
      if (record.status === 'failed') {
        run.summary.failed += 1
        if (task && task.failurePolicy === 'abort') {
          aborted = true
        }
      }
      run._sources[i] = null
      persist(run)
    }

    let status
    if (cancelled.has(run.id)) status = 'cancelled'
    else if (aborted && run.summary.scheduled === 0 && run.summary.published === 0) status = 'failed'
    else if (run.summary.awaitingReview > 0) status = 'awaiting_review'
    else if (run.summary.failed > 0) status = run.summary.scheduled + run.summary.published > 0 ? 'completed_with_errors' : 'failed'
    else status = 'completed'
    delete run._sources
    finish(run, status)
    return { ok: status !== 'failed', runId: run.id, status }
  }

  async function processItem ({ run, record, src, config, pacer }) {
    const retries = config.guardrails.retryPerItem
    let item = { ...src }

    // 去重先于任何花钱的动作
    if (config.dedupe.enabled) {
      const keys = buildDedupeKeys(item)
      const seen = deps.ledger.findSeen(keys)
      if (seen) {
        record.status = 'skipped'
        record.error = 'duplicate:' + (seen.runId || '')
        run.summary.skipped += 1
        return
      }
    }

    if (item.needsCollect && !item.content) {
      record.status = 'collecting'
      if (typeof deps.collectArticle !== 'function') throw new Error('采集器未装配，无法抓取正文')
      const collected = await withRetry(() => deps.collectArticle(item.url), retries)
      if (!collected || !collected.ok) throw new Error((collected && collected.error) || '正文采集失败')
      item = {
        ...item,
        title: collected.title || item.title,
        content: collected.content || item.content,
        coverImage: collected.coverImage || item.coverImage,
      }
    }

    record.status = 'rewriting'
    const rewritten = await withRetry(() => deps.rewrite({ item, config: config.rewrite }), retries)
    if (!rewritten || !rewritten.ok) throw new Error((rewritten && rewritten.error) || '改写失败')
    item = {
      ...item,
      title: rewritten.title || item.title,
      content: rewritten.content || item.content,
    }
    record.title = item.title

    if (config.content.type === 'video') {
      record.status = 'creating'
      if (typeof deps.createVideo !== 'function') throw new Error('视频流水线未装配')
      const created = await withRetry(() => deps.createVideo({
        item,
        pipeline: config.content.videoPipeline,
        config: config.content,
        runId: run.id,
      }), retries)
      if (!created || !created.ok) throw new Error((created && created.error) || '视频创作失败')
      item = { ...item, videoPath: created.videoPath || '' }
      record.videoPath = item.videoPath
    }

    if (config.content.type === 'podcast') {
      record.status = 'creating'
      if (typeof deps.createPodcast !== 'function') throw new Error('播客发布链路未装配')
      const published = await withRetry(() => deps.createPodcast({
        item,
        channelId: config.content.podcastChannelId,
        config: config.content,
        runId: run.id,
      }), retries)
      if (!published || !published.ok) throw new Error((published && published.error) || '播客发布失败')
      record.episodeId = published.episodeId || ''
      record.status = 'published'
      run.summary.published += 1
      const dedupe = recordDedupe(run, item)
      if (!dedupe.ok) throw new Error('去重账本写入失败：' + (dedupe.reason || 'unknown'))
      return
    }

    if (config.review.requireApproval) {
      record.status = 'awaiting_review'
      record._article = buildArticle(item, config.content.type)
      record._sourceKey = buildDedupeKeys(item).sourceKey
      record._fingerprint = buildDedupeKeys(item).fingerprint
      run.summary.awaitingReview += 1
      return
    }

    await scheduleItem({ run, record, item, config, pacer, targets: config.publish.targets })
  }

  async function scheduleItem ({ run, record, item, config, pacer, targets }) {
    record.status = 'scheduling'
    // itemKey 已在 startRun 建记录时按 index 固化；不要在这里按可变的 title/url 重算，
    // 否则快照键与队列键会分叉，applyQueueEvent 可能找不到记录。
    const article = record._article || buildArticle(item, config.content.type)
    const scheduleIds = []
    try {
      for (const target of targets) {
        const key = resolveTargetKey(target)
        const slot = pacer.next(key, now())
        const targetArticle = adaptArticle(article, target, config.content && config.content.adaptation)
        const result = await withRetry(() => deps.schedulePublish({
          runId: run.id,
          workflowId: run.workflowId,
          item,
          itemKey: record.itemKey,
          target,
          publishAt: iso(slot.atMs),
          article: targetArticle,
        }), config.guardrails.retryPerItem)
        if (!result || !result.ok) {
          throw new Error((result && result.error) || ('排期失败：' + key))
        }
        scheduleIds.push(result.scheduleId || '')
        if (!record.publishAt) record.publishAt = iso(slot.atMs)
      }
    } catch (e) {
      // 多目标排期是「一串独立写」：第 2 个目标失败时，第 1 个已写入队列的条目必须撤回，
      // 否则条目记为 failed 但队列里还留着它在到点发布 —— 重跑/审核后会重复发一次。
      await rollbackSchedules(scheduleIds)
      throw e
    }
    record.status = 'scheduled'
    record.scheduleId = scheduleIds.filter(Boolean).join(',')
    run.summary.scheduled += 1
    const dedupe = recordDedupe(run, item)
    if (!dedupe.ok) {
      // 已入队但账本没记住 = 下一轮会把它当新内容再发一次；宁可撤回队列并报错
      await rollbackSchedules(scheduleIds)
      run.summary.scheduled = Math.max(0, run.summary.scheduled - 1)
      record.status = 'failed'
      record.error = '去重账本写入失败：' + (dedupe.reason || 'unknown')
      throw new Error(record.error)
    }
  }

  async function rollbackSchedules (scheduleIds) {
    if (typeof deps.cancelSchedule !== 'function') return
    for (const id of scheduleIds.filter(Boolean)) {
      try { await deps.cancelSchedule(id) } catch (_) { /* 回滚失败不减损原始错误 */ }
    }
  }

  function recordDedupe (run, item) {
    if (!run._config || !run._config.dedupe.enabled) return { ok: true }
    const keys = buildDedupeKeys(item)
    const r = deps.ledger.record({
      sourceKey: keys.sourceKey,
      fingerprint: keys.fingerprint,
      runId: run.id,
      workflowId: run.workflowId,
      title: item.title,
    })
    if (!r.ok) {
      log.warn && log.warn('WorkflowRunner', '去重账本写入失败：' + (r.reason || 'unknown'))
      return r
    }
    return { ok: true }
  }

  /**
   * 队列状态回写：队列只负责「到点把任务交给 TaskQueue」，运行记录需要知道
   * dispatching/dispatched/failed/missed/dispatch-uncertain，否则用户看到永远是 scheduled。
   */
  function applyQueueEvent (payload) {
    if (!payload || !payload.runId) return { ok: false, error: 'invalid-event' }
    const runId = String(payload.runId)
    const run = live.get(runId) || loadPersisted().find((r) => r && r.id === runId)
    if (!run) return { ok: false, error: 'run-not-found' }
    const result = applyQueueEventRecord({ run, payload, now })
    if (result.ok) persist(run)
    return result
  }

  async function approveRun (runId) {
    const run = live.get(runId) || loadPersisted().find((r) => r && r.id === runId)
    if (!run) return { ok: false, error: 'not-found' }
    if (run.status !== 'awaiting_review') return { ok: false, error: 'not-awaiting' }
    const config = run._config || (run._config = null)
    if (!config) return { ok: false, error: 'config-missing' }
    const pacer = createPacer({
      startAtMs: now(),
      minMinutes: config.cadence.minMinutes,
      maxMinutes: config.cadence.maxMinutes,
      random,
    })
    let failed = 0
    for (const record of run.items) {
      if (record.status !== 'awaiting_review') continue
      const item = {
        title: record.title,
        content: (record._article && record._article.content) || '',
        coverImage: (record._article && record._article.cover_path) || '',
        videoPath: record.videoPath || '',
        sourceType: record.sourceType,
        platform: record.platform,
        externalId: record.externalId,
        url: record.url,
      }
      try {
        await scheduleItem({ run, record, item, config, pacer, targets: config.publish.targets })
        run.summary.awaitingReview = Math.max(0, run.summary.awaitingReview - 1)
      } catch (e) {
        record.status = 'failed'
        record.error = e && e.message ? e.message : String(e)
        run.summary.failed += 1
        failed += 1
      }
    }
    finish(run, failed > 0 ? 'completed_with_errors' : 'completed')
    return { ok: true, status: run.status }
  }

  async function resumeRun (runId) {
    const run = live.get(runId) || loadPersisted().find((r) => r && r.id === runId)
    if (!run) return { ok: false, error: 'not-found' }
    if (run.status !== 'running') return { ok: false, error: 'not-running' }
    const config = run._config
    if (!config || !Array.isArray(run._sources)) return { ok: false, error: 'not-resumable' }
    const pacer = createPacer({
      startAtMs: now(),
      minMinutes: config.cadence.minMinutes,
      maxMinutes: config.cadence.maxMinutes,
      random,
    })
    live.set(run.id, run)
    return resumePersistedRun({ run, config, pacer, processItem, persist, finish, now })
  }

  async function resumeInterruptedRuns () {
    const runs = loadPersisted().filter((r) => r && r.status === 'running' && Array.isArray(r._sources) && r._config)
    let resumed = 0
    for (const run of runs) {
      try {
        const result = await resumeRun(run.id)
        if (result && result.status) resumed += 1
      } catch (e) {
        log.warn && log.warn('WorkflowRunner', '续跑失败 run=' + run.id + ': ' + (e && e.message ? e.message : String(e)))
      }
    }
    return { resumed, total: runs.length }
  }

  function getRun (runId) {
    const run = live.get(runId) || loadPersisted().find((r) => r && r.id === runId)
    return run ? snapshotRun(run) : null
  }

  function listRuns () {
    const all = loadPersisted()
    for (const run of live.values()) {
      const idx = all.findIndex((r) => r && r.id === run.id)
      if (idx >= 0) all[idx] = run
      else all.unshift(run)
    }
    return all
      .filter((r) => r && r.id)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, MAX_PERSISTED_RUNS)
      .map(snapshotRun)
  }

  function cancel (runId) {
    if (!live.has(runId)) return { ok: false, error: 'not-running' }
    cancelled.add(runId)
    return { ok: true }
  }

  return { startRun, resumeRun, resumeInterruptedRuns, approveRun, getRun, listRuns, cancel, applyQueueEvent }
}

module.exports = { createWorkflowRunner, RUNS_KEY, MAX_PERSISTED_RUNS }
