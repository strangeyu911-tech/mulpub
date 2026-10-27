// @ts-check
/**
 * workflow-queue-event.js — 发布队列事件 → 运行条目
 *
 * 与 runner 拆开，避免 workflow-runner.js 继续膨胀；保持纯函数：
 * 只修改传入的 run，持久化由调用方负责。
 */

const QUEUE_EVENT_STATUS = {
  dispatching: 'dispatching',
  dispatched: 'dispatched',
  failed: 'failed',
  missed: 'missed',
  'dispatch-uncertain': 'dispatch-uncertain',
  retry: 'pending',
  'retry-requested': 'pending',
}

function applyQueueEventRecord ({ run, payload, now }) {
  if (!payload || !payload.runId) return { ok: false, error: 'invalid-event' }
  const itemKey = String(payload.itemKey || '')
  let record = itemKey ? run.items.find((i) => i.itemKey === itemKey) : null
  if (!record && payload.scheduleId) record = run.items.find((i) => i.scheduleId === String(payload.scheduleId))
  if (!record) return { ok: false, error: 'item-not-found' }

  const event = String(payload.event || '')
  const previousStatus = record.status
  record.queueStatus = QUEUE_EVENT_STATUS[event] || event
  record.queueError = String(payload.error || '')
  record.queueAttempts = Number(payload.attempts) || 0
  record.queueAt = payload.dispatchedAt || payload.at || new Date(now()).toISOString()

  if (['failed', 'missed', 'dispatch-uncertain'].includes(event)) {
    if (record.status !== 'failed') {
      record.status = 'failed'
      run.summary.scheduled = Math.max(0, run.summary.scheduled - 1)
      run.summary.failed += 1
    }
    record.error = payload.error || (event === 'missed' ? 'missed' : 'dispatch-failed')
  } else if (event === 'dispatched') {
    record.error = ''
  } else if (event === 'retry-requested') {
    if (previousStatus === 'failed' || previousStatus === 'missed') {
      run.summary.failed = Math.max(0, run.summary.failed - 1)
      run.summary.scheduled += 1
    }
    record.status = 'scheduled'
    record.error = ''
  }
  return { ok: true }
}

module.exports = { applyQueueEventRecord, QUEUE_EVENT_STATUS }
