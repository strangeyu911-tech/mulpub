// @ts-check
/**
 * workflow-publish-queue.js — 工作流的到点发布队列（持久、可恢复）
 *
 * 为什么不用 scheduler.create：平台侧定时当前只有头条一条真机取证（其余 14 个平台
 * 都是 `unsupported`，见 platform-schedule-capability.json）。把「35-40 分钟间隔批量发
 * 到多个平台」硬塞进 scheduler.create，只会在第二个平台就抛「不支持平台侧定时」。
 * 因此工作流用**自己的持久队列**：到点把任务交给 TaskQueue（与手动发布同一条通道，
 * 因而自动受 PublishIntervalGuard 的账号级最小间隔保护）。
 *
 * 诚实的代价：应用关着不会发。所以运行详情必须显示「本地队列，应用需保持运行」，
 * 重启时对 24h 内的过期项补发并标 `late`，超过 24h 标 `missed` 而不是假装发过。
 */

const crypto = require('crypto')

const DEFAULT_KEY = 'workflow_publish_queue'
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000
const DEFAULT_TICK_MS = 30 * 1000
const MAX_ENTRIES = 500

function newId () {
  return 'wq_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')
}

function parse (raw) {
  if (raw == null) return { entries: [], unreadable: false }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return { entries: [], unreadable: true }
    return { entries: parsed.filter((e) => e && typeof e === 'object' && e.id), unreadable: false }
  } catch (_) {
    return { entries: [], unreadable: true }
  }
}

/**
 * @param {{ store: object, key?: string, now?: () => number, enqueue: Function, log?: object, tickMs?: number, maxAttempts?: number, graceMs?: number, minDispatchDelayMs?: number }} deps
 */
function createWorkflowPublishQueue (deps = {}) {
  const store = deps.store
  if (!store || typeof store.getSetting !== 'function' || typeof store.setSetting !== 'function') {
    throw new TypeError('workflow-publish-queue 需要 store')
  }
  if (typeof deps.enqueue !== 'function') throw new TypeError('workflow-publish-queue 需要 enqueue')
  const key = deps.key || DEFAULT_KEY
  const now = typeof deps.now === 'function' ? deps.now : Date.now
  const tickMs = Number.isFinite(deps.tickMs) ? deps.tickMs : DEFAULT_TICK_MS
  const maxAttempts = Number.isInteger(deps.maxAttempts) && deps.maxAttempts > 0 ? deps.maxAttempts : DEFAULT_MAX_ATTEMPTS
  const graceMs = Number.isFinite(deps.graceMs) ? deps.graceMs : DEFAULT_GRACE_MS
  // 新入队项的静默期：多目标排期是逐条写入的，给「第 N 条失败 → 回滚前 N-1 条」
  // 留出窗口；测试默认 0，生产在 runtime 里显式设 60s。
  const minDispatchDelayMs = Number.isFinite(deps.minDispatchDelayMs) ? deps.minDispatchDelayMs : 0
  const log = deps.log || { warn () {}, error () {} }

  const loaded = parse(store.getSetting(key))
  let entries = loaded.entries
  const unreadable = loaded.unreadable
  let timer = null
  let ticking = false

  function persist () {
    const trimmed = entries.slice(-MAX_ENTRIES)
    entries = trimmed
    store.setSetting(key, JSON.stringify(entries))
  }

  async function tickInternal () {
    if (unreadable) return { dispatched: 0, failed: 0, missed: 0, error: 'queue-unreadable' }
    if (ticking) return { dispatched: 0, failed: 0, missed: 0, skipped: 'busy' }
    ticking = true
    const at = now()
    let dispatched = 0
    let failed = 0
    let missed = 0
    let changed = false
    try {
      const pending = entries
        .filter((e) => e.status === 'pending')
        .sort((a, b) => Date.parse(a.publishAt) - Date.parse(b.publishAt))
      for (const e of pending) {
        const due = Date.parse(e.publishAt)
        const createdAt = Date.parse(e.createdAt)
        if (Number.isFinite(createdAt) && at - createdAt < minDispatchDelayMs) continue
        if (!Number.isFinite(due)) {
          e.status = 'failed'
          e.error = 'invalid-publish-at'
          failed += 1
          changed = true
          continue
        }
        if (due + graceMs < at) {
          e.status = 'missed'
          e.error = '超过 24 小时未派发'
          missed += 1
          changed = true
          continue
        }
        if (due > at) continue
        try {
          const late = at - due > 60 * 1000
          await deps.enqueue({ ...e, late })
          e.status = 'dispatched'
          e.dispatchedAt = new Date(at).toISOString()
          e.attempts = (e.attempts || 0) + 1
          e.late = late
          e.error = ''
          dispatched += 1
          changed = true
        } catch (err) {
          e.attempts = (e.attempts || 0) + 1
          e.error = err && err.message ? err.message : String(err)
          if (e.attempts >= maxAttempts) {
            e.status = 'failed'
            failed += 1
          }
          changed = true
          log.warn && log.warn('WorkflowQueue', '派发失败 run=' + e.runId + ' attempts=' + e.attempts + ': ' + e.error)
        }
      }
      // 没有任何状态变化就不写盘：常驻应用每 30s 全量重写 500 条是纯浪费
      if (changed) persist()
      return { dispatched, failed, missed }
    } finally {
      ticking = false
    }
  }

  return {
    add (input) {
      if (unreadable) return { ok: false, reason: 'queue-unreadable' }
      if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid' }
      if (!input.runId || !input.platform || !input.publishAt) return { ok: false, reason: 'missing-fields' }
      const entry = {
        id: newId(),
        runId: String(input.runId),
        workflowId: String(input.workflowId || ''),
        itemKey: String(input.itemKey || ''),
        title: String(input.title || ''),
        platform: String(input.platform),
        accountId: String(input.accountId || ''),
        article: input.article && typeof input.article === 'object' ? input.article : {},
        publishAt: String(input.publishAt),
        status: 'pending',
        attempts: 0,
        late: false,
        error: '',
        createdAt: new Date(now()).toISOString(),
        dispatchedAt: '',
      }
      entries.push(entry)
      try {
        persist()
      } catch (e) {
        entries = entries.filter((x) => x !== entry)
        return { ok: false, reason: 'persist-failed', message: e && e.message ? e.message : String(e) }
      }
      return { ok: true, id: entry.id }
    },
    list () {
      return entries.map((e) => ({ ...e }))
    },
    size () { return entries.length },
    tick () { return tickInternal() },
    cancelRun (runId) {
      let cancelled = 0
      for (const e of entries) {
        if (e.runId === String(runId) && e.status === 'pending') {
          e.status = 'cancelled'
          cancelled += 1
        }
      }
      if (cancelled > 0) persist()
      return { ok: true, cancelled }
    },
    /** 撤回单条未派发项（多目标排期失败时回滚已写入的前几条，防重复发布） */
    remove (id) {
      const idx = entries.findIndex((e) => e.id === String(id))
      if (idx < 0) return { ok: false, reason: 'not-found' }
      if (entries[idx].status !== 'pending') return { ok: false, reason: 'not-pending' }
      entries.splice(idx, 1)
      persist()
      return { ok: true }
    },
    start () {
      if (timer) return
      timer = setInterval(() => {
        tickInternal().catch((e) => log.error && log.error('WorkflowQueue', e && e.message ? e.message : String(e)))
      }, tickMs)
      if (typeof timer.unref === 'function') timer.unref()
    },
    stop () {
      if (timer) clearInterval(timer)
      timer = null
    },
    isReadable () { return !unreadable },
  }
}

module.exports = { createWorkflowPublishQueue, DEFAULT_KEY, DEFAULT_MAX_ATTEMPTS, DEFAULT_GRACE_MS, DEFAULT_TICK_MS }
