const { summarizeWorkflowPerformance, evaluatePerformanceGuard } = require('./workflow-performance')

const NOW = Date.parse('2026-10-27T12:00:00Z')
const tracked = [{ id: 't1', publish_history_id: 'task1' }, { id: 't2', publish_history_id: 'task2' }]

function snap (id, at, views, likes) {
  return { tracked_content_id: id, captured_at: at, views, likes, comments: 0, favorites: 0, shares: 0 }
}

describe('workflow-performance · 汇总口径', () => {
  it('每个作品只取窗口内最新快照，跨快照不重复求和', () => {
    const out = summarizeWorkflowPerformance({
      trackedRows: tracked,
      nowMs: NOW,
      windowDays: 7,
      snapshotRows: [
        snap('t1', '2026-10-26T12:00:00Z', 100, 10),
        snap('t1', '2026-10-27T12:00:00Z', 150, 15),
        snap('t2', '2026-10-27T12:00:00Z', 50, 5),
      ],
    })
    expect(out.samples).toBe(2)
    expect(out.views).toBe(200)
    expect(out.interactions).toBe(20)
    expect(out.avgViews).toBe(100)
    expect(out.engagementRate).toBe(0.1)
  })

  it('窗口外快照不计入；没有快照返回 0 样本', () => {
    const out = summarizeWorkflowPerformance({ trackedRows: tracked, nowMs: NOW, windowDays: 1, snapshotRows: [snap('t1', '2026-10-20T12:00:00Z', 999, 99)] })
    expect(out.samples).toBe(0)
    expect(out.views).toBe(0)
  })
})

describe('workflow-performance · 阈值判定', () => {
  const summary = { samples: 3, avgViews: 10, engagementRate: 0.01 }

  it('未启用/样本不足放行', () => {
    expect(evaluatePerformanceGuard(summary, { enabled: false }).ok).toBe(true)
    expect(evaluatePerformanceGuard({ samples: 1 }, { enabled: true, minSamples: 3 }).ok).toBe(true)
  })

  it('播放或互动率低于阈值拒绝，并给出原因', () => {
    expect(evaluatePerformanceGuard(summary, { enabled: true, minSamples: 3, minViews: 20 })).toMatchObject({ ok: false, reason: 'performance-below-views' })
    expect(evaluatePerformanceGuard(summary, { enabled: true, minSamples: 3, minEngagementRate: 0.05 })).toMatchObject({ ok: false, reason: 'performance-below-engagement' })
  })

  it('达到阈值放行', () => {
    expect(evaluatePerformanceGuard(summary, { enabled: true, minSamples: 3, minViews: 5, minEngagementRate: 0.005 })).toMatchObject({ ok: true })
  })
})
