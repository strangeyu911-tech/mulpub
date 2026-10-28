// @ts-check
const { summarizeWorkflowPerformance, evaluatePerformanceGuard } = require('./workflow-performance')

/**
 * 工作流效果回流适配层：把发布队列的 taskId 与 tracked_content.publish_history_id 对齐。
 * 不猜归因：没有 taskId 或没有 tracked_content 的条目不参与。
 */
function createWorkflowPerformance ({ queue, store, now } = {}) {
  const nowFn = typeof now === 'function' ? now : Date.now

  async function summary (workflowId, options = {}) {
    if (!queue || typeof queue.list !== 'function') return { samples: 0, error: 'queue-unavailable' }
    if (!store || typeof store.listTrackedForOverview !== 'function' || typeof store.listSnapshotsForOverview !== 'function') {
      return { samples: 0, error: 'performance-store-unavailable' }
    }
    const entries = queue.list().filter((e) => e && e.workflowId === String(workflowId || '') && e.taskId)
    const taskIds = new Set(entries.map((e) => String(e.taskId)))
    if (taskIds.size === 0) return { samples: 0, linkedEntries: 0, taskIds: [] }

    const trackedResult = store.listTrackedForOverview(options.ownerSubject)
    if (trackedResult && trackedResult.error) return { samples: 0, error: trackedResult.error, linkedEntries: 0 }
    const trackedRows = ((trackedResult && trackedResult.rows) || [])
      .filter((r) => r && taskIds.has(String(r.publish_history_id || '')))
    const snapshotResult = store.listSnapshotsForOverview(options.ownerSubject)
    if (snapshotResult && snapshotResult.error) return { samples: 0, error: snapshotResult.error, linkedEntries: trackedRows.length }
    const snapshotRows = (snapshotResult && snapshotResult.rows) || []
    const result = summarizeWorkflowPerformance({
      trackedRows,
      snapshotRows,
      windowDays: options.windowDays,
      nowMs: nowFn(),
    })
    return { ...result, linkedEntries: entries.length, taskIds: [...taskIds] }
  }

  return { summary }
}

/**
 * 运行前效果复核：低于阈值时 fail-closed，不继续花预算/发布。
 * 没有样本（insufficient-samples）时放行，避免新工作流永远无法起步。
 */
async function checkPerformanceForRun ({ run, config, performance }) {
  const p = config && config.guardrails && config.guardrails.performance
  if (!p || p.enabled !== true) return { ok: true, skipped: true }
  if (!performance || typeof performance.summary !== 'function') return { ok: false, reason: 'performance-unavailable' }
  let summary
  try {
    summary = await performance.summary(run.workflowId, { windowDays: p.windowDays })
  } catch (e) {
    return { ok: false, reason: 'performance-unavailable', message: e && e.message ? e.message : String(e) }
  }
  if (!summary || summary.error) return { ok: false, reason: summary && summary.error ? summary.error : 'performance-unavailable' }
  run.summary.performance = summary
  const verdict = evaluatePerformanceGuard(summary, p)
  if (!verdict.ok) return { ok: false, reason: verdict.reason, detail: verdict.detail }
  return { ok: true, summary }
}

async function applyPerformanceGuard ({ run, config, performance, finish }) {
  const result = await checkPerformanceForRun({ run, config, performance })
  if (result.ok) return result
  run.error = result.reason
  if (result.detail) run.summary.performanceGuard = result.detail
  if (typeof finish === 'function') finish(run, 'failed')
  return result
}

module.exports = { createWorkflowPerformance, checkPerformanceForRun, applyPerformanceGuard }
