// @ts-check
/** 博主发现状态回写：成功/失败都不影响已完成的发布，只记录 warning。 */
async function writebackCreatorStatus ({ sources, src, record, runId, warn }) {
  if (!src || !record || src.sourceType !== 'creatorMonitor' || !src.meta || !src.meta.discoveryId) return
  const failed = record.status === 'failed'
  const succeeded = record.status === 'published' || record.status === 'scheduled' || record.status === 'awaiting_review'
  if (!failed && !succeeded) return
  const method = failed ? 'markCreatorFailed' : 'markCreatorPublished'
  if (!sources || typeof sources[method] !== 'function') return
  try {
    const result = failed
      ? await sources[method](src, record.error || '工作流条目失败')
      : await sources[method](src, runId)
    if (result && result.ok === false && !result.skipped && typeof warn === 'function') {
      warn('博主发现状态回写失败: ' + (result.reason || 'unknown'))
    }
  } catch (e) {
    if (typeof warn === 'function') warn('博主发现状态回写异常: ' + (e && e.message ? e.message : String(e)))
  }
}

module.exports = { writebackCreatorStatus }
