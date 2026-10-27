// @ts-check
/** workflow-run-snapshot.js — 运行记录对外快照（不泄露 _config/_sources） */

function snapshotRun (run) {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error || '',
    warnings: run.warnings.slice(),
    items: run.items.map((i) => ({
      index: i.index,
      title: i.title,
      sourceType: i.sourceType,
      platform: i.platform,
      externalId: i.externalId,
      url: i.url,
      itemKey: i.itemKey || '',
      status: i.status,
      error: i.error,
      scheduleId: i.scheduleId,
      publishAt: i.publishAt,
      queueStatus: i.queueStatus || '',
      queueError: i.queueError || '',
      queueAttempts: i.queueAttempts || 0,
      queueAt: i.queueAt || '',
      videoPath: i.videoPath,
      episodeId: i.episodeId,
    })),
    summary: { ...run.summary },
  }
}

module.exports = { snapshotRun }
