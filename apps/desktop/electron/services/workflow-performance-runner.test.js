const { createWorkflowPerformance, checkPerformanceForRun } = require('./workflow-performance-runner')

const NOW = Date.parse('2026-10-27T12:00:00Z')

function deps () {
  const queue = { list: () => [
    { id: 'q1', workflowId: 'w1', taskId: 'task1' },
    { id: 'q2', workflowId: 'w1', taskId: 'task2' },
    { id: 'q3', workflowId: 'w2', taskId: 'task3' },
  ] }
  const store = {
    listTrackedForOverview: () => ({ rows: [
      { id: 't1', publish_history_id: 'task1' },
      { id: 't2', publish_history_id: 'task2' },
      { id: 't3', publish_history_id: 'task3' },
    ] }),
    listSnapshotsForOverview: () => ({ rows: [
      { tracked_content_id: 't1', captured_at: '2026-10-27T11:00:00Z', views: 100, likes: 10 },
      { tracked_content_id: 't2', captured_at: '2026-10-27T11:00:00Z', views: 50, likes: 5 },
      { tracked_content_id: 't3', captured_at: '2026-10-27T11:00:00Z', views: 999, likes: 99 },
    ] }),
  }
  return { queue, store }
}

describe('workflow-performance-runner · taskId 归因', () => {
  it('只统计当前工作流队列 taskId 对应的作品，不把其他工作流混入', async () => {
    const d = deps()
    const p = createWorkflowPerformance({ queue: d.queue, store: d.store, now: () => NOW })
    const out = await p.summary('w1')
    expect(out.samples).toBe(2)
    expect(out.views).toBe(150)
    expect(out.linkedEntries).toBe(2)
    expect(out.taskIds).toEqual(['task1', 'task2'])
  })

  it('没有 taskId 时返回 0 样本，不猜归因', async () => {
    const p = createWorkflowPerformance({ queue: { list: () => [{ workflowId: 'w1' }] }, store: deps().store, now: () => NOW })
    expect(await p.summary('w1')).toMatchObject({ samples: 0 })
  })

  it('checkPerformanceForRun 未启用放行；启用且低于阈值拒绝', async () => {
    const run = { workflowId: 'w1', summary: {} }
    expect(await checkPerformanceForRun({ run, config: { guardrails: { performance: { enabled: false } } } })).toMatchObject({ ok: true })
    const bad = await checkPerformanceForRun({
      run,
      config: { guardrails: { performance: { enabled: true, windowDays: 7, minSamples: 2, minViews: 1000, minEngagementRate: 0 } } },
      performance: { summary: async () => ({ samples: 2, avgViews: 10, engagementRate: 0.1 }) },
    })
    expect(bad).toMatchObject({ ok: false, reason: 'performance-below-views' })
    expect(run.summary.performance.samples).toBe(2)
  })
})
