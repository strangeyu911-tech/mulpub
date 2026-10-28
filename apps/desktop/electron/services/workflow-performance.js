// @ts-check
/**
 * workflow-performance.js — 工作流发布后效果汇总与阈值判定（纯函数）
 *
 * 口径：快照里的 views/likes/... 是累计值，跨快照求和会重复计数。
 * 因此每个 tracked_content 只取窗口内最新一份快照，再对作品求平均。
 * 归因只认 publish_history_id === 工作流队列的 taskId；没有 taskId 的条目不参与。
 */

const METRIC_FIELDS = ['views', 'likes', 'comments', 'favorites', 'shares']
const INTERACTION_FIELDS = ['likes', 'comments', 'favorites', 'shares']

function metric (raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function timeOf (raw) {
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

/**
 * @param {{trackedRows?: Array, snapshotRows?: Array, windowDays?: number, nowMs?: number}} input
 */
function summarizeWorkflowPerformance (input = {}) {
  const trackedRows = Array.isArray(input.trackedRows) ? input.trackedRows : []
  const snapshotRows = Array.isArray(input.snapshotRows) ? input.snapshotRows : []
  const windowDays = Number.isFinite(Number(input.windowDays)) && Number(input.windowDays) > 0
    ? Math.min(90, Math.max(1, Number(input.windowDays)))
    : 7
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now()
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000
  const trackedIds = new Set(trackedRows.map((r) => String(r.id || '')).filter(Boolean))

  const latest = new Map()
  for (const s of snapshotRows) {
    const id = String(s.tracked_content_id || '')
    if (!trackedIds.has(id)) continue
    const at = timeOf(s.captured_at)
    if (!at || at < cutoff) continue
    const prev = latest.get(id)
    if (!prev || at > prev.at) latest.set(id, { at, row: s })
  }

  const items = []
  let views = 0
  let interactions = 0
  for (const [trackedContentId, entry] of latest) {
    const row = entry.row
    const v = metric(row.views)
    let i = 0
    for (const field of INTERACTION_FIELDS) i += metric(row[field])
    views += v
    interactions += i
    items.push({ trackedContentId, views: v, interactions: i, capturedAt: row.captured_at })
  }

  const samples = items.length
  return {
    windowDays,
    samples,
    views,
    interactions,
    avgViews: samples > 0 ? Math.round((views / samples) * 100) / 100 : 0,
    engagementRate: views > 0 ? Math.round((interactions / views) * 10000) / 10000 : 0,
    items,
    metricFields: METRIC_FIELDS.slice(),
  }
}

function evaluatePerformanceGuard (summary, performance) {
  const p = performance || {}
  if (p.enabled !== true) return { ok: true, skipped: true }
  const s = summary || {}
  const minSamples = Math.max(1, Number(p.minSamples) || 1)
  if ((Number(s.samples) || 0) < minSamples) return { ok: true, skipped: true, reason: 'insufficient-samples' }
  const minViews = Math.max(0, Number(p.minViews) || 0)
  if (minViews > 0 && (Number(s.avgViews) || 0) < minViews) {
    return { ok: false, reason: 'performance-below-views', detail: { avgViews: s.avgViews, minViews, samples: s.samples } }
  }
  const minEngagementRate = Math.max(0, Number(p.minEngagementRate) || 0)
  if (minEngagementRate > 0 && (Number(s.engagementRate) || 0) < minEngagementRate) {
    return { ok: false, reason: 'performance-below-engagement', detail: { engagementRate: s.engagementRate, minEngagementRate, samples: s.samples } }
  }
  return { ok: true, summary: s }
}

module.exports = { summarizeWorkflowPerformance, evaluatePerformanceGuard, METRIC_FIELDS, INTERACTION_FIELDS }
