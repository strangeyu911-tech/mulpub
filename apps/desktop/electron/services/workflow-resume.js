// @ts-check
/**
 * workflow-resume.js — 从持久化运行快照续跑未完成条目
 *
 * 只处理「生成阶段」的状态（pending/collecting/rewriting/creating）；`scheduling`
 * 可能已部分入队，无法判断哪些目标已写，直接标成 resume-scheduling-uncertain 交人工，
 * 绝不自动重发。
 */

async function resumePersistedRun ({ run, config, pacer, processItem, persist, finish, now }) {
  if (!run || run.status !== 'running') return { ok: false, error: 'not-running' }
  if (!config || !Array.isArray(run._sources) || run._sources.length !== run.items.length) {
    return { ok: false, error: 'not-resumable' }
  }

  let processed = 0
  let failed = 0
  for (let i = 0; i < run.items.length; i++) {
    const record = run.items[i]
    if (record.status === 'scheduling') {
      record.status = 'failed'
      record.error = 'resume-scheduling-uncertain'
      run.summary.failed += 1
      failed += 1
      persist(run)
      continue
    }
    if (!['pending', 'collecting', 'rewriting', 'creating'].includes(record.status)) continue
    const src = run._sources[i]
    if (!src) {
      record.status = 'failed'
      record.error = 'resume-source-missing'
      run.summary.failed += 1
      failed += 1
      persist(run)
      continue
    }
    record.status = 'pending'
    record.error = ''
    try {
      await processItem({ run, record, src, config, pacer })
    } catch (e) {
      record.status = 'failed'
      record.error = e && e.message ? e.message : String(e)
    }
    if (record.status === 'failed') {
      run.summary.failed += 1
      failed += 1
    }
    run._sources[i] = null
    processed += 1
    persist(run)
  }

  let status
  if (run.summary.awaitingReview > 0) status = 'awaiting_review'
  else if (run.summary.failed > 0) status = run.summary.scheduled + run.summary.published > 0 ? 'completed_with_errors' : 'failed'
  else status = 'completed'
  delete run._sources
  finish(run, status)
  return { ok: status !== 'failed', runId: run.id, status, processed, failed }
}

module.exports = { resumePersistedRun }
