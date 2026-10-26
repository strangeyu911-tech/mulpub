// @ts-check
/**
 * workflow-ledger.js — 工作流去重账本与每日额度计数
 *
 * 为什么不能只查发布历史：生产历史是 `publish-history.jsonl`，只写平台/标题/结果，
 * **不写正文**，也没有 content_hash（2026-10-26 全仓核查）。"同一篇改个标题再发一次"
 * 在历史里是两个不同标题，查不出来。因此必须由工作流自己记一份「来源键 + 内容指纹」。
 *
 * 三条纪律：
 * ① 双键任一命中即跳过（来源键挡重复采集，内容指纹挡改标题重发）；
 * ② 账本 JSON 读不出来时**不覆盖原值**——宁可这一轮报错，也不能把用户的历史去重记录清空；
 * ③ TTL 180 天 / 上限 5000 条，避免 settings 单键无限膨胀。
 */

const DEFAULT_KEY = 'workflow_dedupe_ledger'
const DEFAULT_TTL_DAYS = 180
const DEFAULT_MAX_ENTRIES = 5000

function parseEntries (raw) {
  if (raw == null) return { entries: [], unreadable: false }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return { entries: [], unreadable: true }
    return { entries: parsed.filter((e) => e && typeof e === 'object'), unreadable: false }
  } catch (_) {
    return { entries: [], unreadable: true }
  }
}

function entryTime (entry) {
  const t = Date.parse(entry && entry.createdAt)
  return Number.isFinite(t) ? t : 0
}

function localDayKey (ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
}

/**
 * @param {{ store: { getSetting: Function, setSetting: Function }, key?: string, now?: () => number, ttlDays?: number, maxEntries?: number }} deps
 */
function createWorkflowLedger (deps = {}) {
  const store = deps.store
  if (!store || typeof store.getSetting !== 'function' || typeof store.setSetting !== 'function') {
    throw new TypeError('workflow-ledger 需要提供 getSetting/setSetting 的 store')
  }
  const key = deps.key || DEFAULT_KEY
  const now = typeof deps.now === 'function' ? deps.now : Date.now
  const ttlMs = (Number.isFinite(deps.ttlDays) ? deps.ttlDays : DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000
  const maxEntries = Number.isInteger(deps.maxEntries) && deps.maxEntries > 0 ? deps.maxEntries : DEFAULT_MAX_ENTRIES

  const loaded = parseEntries(store.getSetting(key))
  let entries = loaded.entries
  let unreadable = loaded.unreadable

  function prune () {
    const cutoff = now() - ttlMs
    const kept = entries.filter((e) => entryTime(e) >= cutoff)
    kept.sort((a, b) => entryTime(a) - entryTime(b))
    entries = kept.slice(-maxEntries)
  }

  function persist () {
    store.setSetting(key, JSON.stringify(entries))
  }

  prune()

  return {
    isReadable () { return !unreadable },
    size () { return entries.length },
    /** 双键任一命中即返回该条 */
    findSeen (keys) {
      if (!keys || typeof keys !== 'object') return null
      const { sourceKey, fingerprint } = keys
      for (const entry of entries) {
        if (sourceKey && entry.sourceKey === sourceKey) return entry
        if (fingerprint && entry.fingerprint === fingerprint) return entry
      }
      return null
    },
    /**
     * 记录一条已发布/已排期条目。
     * @returns {{ ok: boolean, reason?: string, entry?: object }}
     */
    record (input) {
      if (unreadable) return { ok: false, reason: 'ledger-unreadable' }
      if (!input || (!input.sourceKey && !input.fingerprint)) return { ok: false, reason: 'keys-empty' }
      const entry = {
        sourceKey: input.sourceKey || '',
        fingerprint: input.fingerprint || '',
        runId: input.runId || '',
        workflowId: input.workflowId || '',
        title: input.title || '',
        createdAt: input.createdAt || new Date(now()).toISOString(),
      }
      entries.push(entry)
      prune()
      try {
        persist()
      } catch (e) {
        entries = entries.filter((x) => x !== entry)
        return { ok: false, reason: 'persist-failed', message: e && e.message ? e.message : String(e) }
      }
      return { ok: true, entry }
    },
    countToday () {
      const today = localDayKey(now())
      return entries.filter((e) => entryTime(e) > 0 && localDayKey(entryTime(e)) === today).length
    },
    /** 测试与诊断用 */
    dump () { return entries.slice() },
  }
}

module.exports = { createWorkflowLedger, DEFAULT_KEY, DEFAULT_TTL_DAYS, DEFAULT_MAX_ENTRIES }
