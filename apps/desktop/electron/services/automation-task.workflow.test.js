/**
 * automation-task.workflow.test.js — 自动化任务对复合工作流动作的兼容
 *
 * 主线：① 旧 fullAutoPipeline 任务行为不变 ② compositeWorkflow 走完整校验
 * ③ 持久化读回不能把复合动作静默降级成旧动作 ④ 非法配置逐条出声
 */
const { validateAutomationTask, normalizeAutomationTasks } = require('./automation-task')

const NOW = Date.parse('2026-10-26T10:00:00+08:00')

function wfConfig () {
  return {
    source: { type: 'zhihuFavlist', folderTokens: ['t1'], limit: 5 },
    rewrite: { mode: 'default' },
    content: { type: 'video', videoPipeline: 'story2video-compose' },
    publish: { targets: [{ platform: 'bilibili', accountId: 'acc-1' }], mode: 'immediate' },
    cadence: { minMinutes: 35, maxMinutes: 40 },
    guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
    review: { requireApproval: false },
    dedupe: { enabled: true },
  }
}

describe('automation-task · 复合工作流动作', () => {
  it('合法配置：动作类型保留，配置被归一化', () => {
    const r = validateAutomationTask({
      name: '收藏夹转视频',
      triggers: [{ type: 'daily', time: '09:00' }],
      action: { type: 'compositeWorkflow', config: wfConfig() },
    }, { now: NOW })
    expect(r.ok).toBe(true)
    expect(r.task.action.type).toBe('compositeWorkflow')
    expect(r.task.action.config.source.folderTokens).toEqual(['t1'])
    expect(r.task.action.config.cadence).toEqual({ minMinutes: 35, maxMinutes: 40 })
    expect(r.task.action.config.publish.targets[0].platform).toBe('bilibili')
  })

  it('非法配置：返回 workflow-config + 逐条 errors', () => {
    const cfg = { ...wfConfig(), content: { type: 'video' } }
    const r = validateAutomationTask({
      name: '坏配置',
      triggers: [{ type: 'interval', minutes: 30 }],
      action: { type: 'compositeWorkflow', config: cfg },
    }, { now: NOW })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('workflow-config')
    expect(r.errors[0]).toMatchObject({ field: 'content.videoPipeline', reason: 'empty' })
  })

  it('旧动作不带 type 时仍按 fullAutoPipeline 处理（向后兼容）', () => {
    const r = validateAutomationTask({
      name: '旧任务',
      triggers: [{ type: 'onAppStart' }],
      action: { config: { sourceType: 'url', contentType: 'article', urls: ['https://x'] } },
    }, { now: NOW })
    expect(r.ok).toBe(true)
    expect(r.task.action.type).toBe('fullAutoPipeline')
  })

  it('持久化读回保留 compositeWorkflow，不静默降级', () => {
    const out = normalizeAutomationTasks([{
      id: 't1',
      name: '收藏夹转视频',
      triggers: [{ type: 'daily', time: '09:00' }],
      action: { type: 'compositeWorkflow', config: wfConfig() },
      failurePolicy: 'skip',
      maxRetries: 1,
    }], { now: NOW })
    expect(out.tasks).toHaveLength(1)
    expect(out.tasks[0].action.type).toBe('compositeWorkflow')
    expect(out.tasks[0].action.config.content.videoPipeline).toBe('story2video-compose')
  })
})
