const { normalizePerformance, validatePerformance } = require('./workflow-performance-schema')

describe('workflow-performance-schema · 配置校验', () => {
  it('默认关闭；归一化保留合法值', () => {
    expect(normalizePerformance()).toEqual({ enabled: false, windowDays: 7, minSamples: 3, minViews: 0, minEngagementRate: 0 })
    expect(normalizePerformance({ enabled: true, windowDays: 30, minSamples: 5, minViews: 100, minEngagementRate: 0.05 })).toMatchObject({ enabled: true, windowDays: 30, minSamples: 5, minViews: 100, minEngagementRate: 0.05 })
  })

  it('启用时拒绝越界窗口/样本/播放/互动率', () => {
    const errors = validatePerformance(normalizePerformance({ enabled: true, windowDays: 0, minSamples: 0, minViews: -1, minEngagementRate: 2 }))
    expect(errors.map((e) => e.field)).toEqual(expect.arrayContaining([
      'guardrails.performance.windowDays', 'guardrails.performance.minSamples',
      'guardrails.performance.minViews', 'guardrails.performance.minEngagementRate',
    ]))
  })
})
