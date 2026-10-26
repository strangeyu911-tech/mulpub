/**
 * automation-scheduler.workflow.test.js — 调度器对复合工作流的分发
 *
 * 主线：① compositeWorkflow 交给 workflowRunner，不落到旧 pipeline
 * ② 重试次数生效 ③ ledger-unreadable 不做无意义重试
 */
const { AutomationScheduler } = require('./automation-scheduler')

const NOW = Date.parse('2026-10-26T10:00:00+08:00')

function makeStore () {
  const mem = { v: null }
  return { getSetting: () => mem.v, setSetting: (_k, v) => { mem.v = v } }
}

function makeWorkflowConfig () {
  return {
    source: { type: 'hotTopics', categories: ['ai'], limit: 5, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [] },
    rewrite: { mode: 'default', strategyId: '', length: 'keep' },
    content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
    publish: { targets: [{ platform: 'zhihu', accountId: 'acc-1' }], mode: 'immediate', startAt: '' },
    cadence: { minMinutes: 35, maxMinutes: 40 },
    guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
    review: { requireApproval: false },
    dedupe: { enabled: true },
  }
}

function makeRunner (results) {
  return {
    calls: [],
    async startRun (task) {
      this.calls.push(task)
      return results[this.calls.length - 1]
    },
  }
}

describe('automation-scheduler · 复合工作流分发', () => {
  it('compositeWorkflow 交给 workflowRunner，旧 pipeline 不被调用', async () => {
    const pipeline = { calls: [], startRun: () => { pipeline.calls.push(1); return { success: true, runId: 'x' } } }
    const runner = makeRunner([{ ok: true, runId: 'wf1', status: 'completed' }])
    const scheduler = new AutomationScheduler({ store: makeStore(), pipeline, workflowRunner: runner })
    const created = scheduler.create({
      name: '收藏夹转视频',
      triggers: [{ type: 'interval', minutes: 60 }],
      action: { type: 'compositeWorkflow', config: makeWorkflowConfig() },
      failurePolicy: 'skip',
      maxRetries: 2,
    })
    expect(created.ok).toBe(true)

    const r = await scheduler.runNow(created.task.id)
    expect(r.ok).toBe(true)
    expect(runner.calls).toHaveLength(1)
    expect(pipeline.calls).toHaveLength(0)
    expect(scheduler.list()[0].lastStatus).toBe('completed')
  })

  it('失败按 maxRetries 重试，耗尽后 lastStatus=failed', async () => {
    const runner = makeRunner([
      { ok: false, error: '模型超时' },
      { ok: false, error: '模型超时' },
      { ok: false, error: '模型超时' },
    ])
    const scheduler = new AutomationScheduler({ store: makeStore(), workflowRunner: runner })
    const created = scheduler.create({
      name: '重试任务',
      triggers: [{ type: 'interval', minutes: 60 }],
      action: { type: 'compositeWorkflow', config: makeWorkflowConfig() },
      failurePolicy: 'skip',
      maxRetries: 2,
    })
    const r = await scheduler.runNow(created.task.id)
    expect(r.ok).toBe(false)
    expect(runner.calls).toHaveLength(3)
    expect(scheduler.list()[0].lastStatus).toBe('failed')
  })

  it('账本不可读 → 只跑一次，不做无意义重试', async () => {
    const runner = makeRunner([
      { ok: false, error: 'ledger-unreadable' },
      { ok: true, runId: 'wf1' },
    ])
    const scheduler = new AutomationScheduler({ store: makeStore(), workflowRunner: runner })
    const created = scheduler.create({
      name: '账本坏了',
      triggers: [{ type: 'interval', minutes: 60 }],
      action: { type: 'compositeWorkflow', config: makeWorkflowConfig() },
      failurePolicy: 'skip',
      maxRetries: 3,
    })
    const r = await scheduler.runNow(created.task.id)
    expect(r.ok).toBe(false)
    expect(runner.calls).toHaveLength(1)
  })
})
