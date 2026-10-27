/**
 * workflow-runner.test.js — 复合工作流运行编排
 *
 * 主线：① 采集→去重→改写→创作→排期 的条目状态机
 * ② 单条失败不拖垮整批（skip）与 abort 立即停
 * ③ 护栏截断、账本不可读时 fail-closed
 * ④ 审核开关：生成后停在待审，不静默发布
 */
const { createWorkflowRunner } = require('./workflow-runner')
const { createWorkflowLedger } = require('./workflow-ledger')

const NOW = Date.parse('2026-10-26T10:00:00+08:00')
const START = NOW + 60 * 60 * 1000

function fakeStore () {
  const map = new Map()
  return {
    getSetting: (k) => (map.has(k) ? map.get(k) : null),
    setSetting: (k, v) => { map.set(k, v) },
  }
}

function config (patch = {}) {
  return {
    source: { type: 'hotTopics', categories: ['ai'], limit: 10, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [] },
    rewrite: { mode: 'default', strategyId: '', length: 'keep' },
    content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
    publish: { targets: [{ platform: 'bilibili', accountId: 'a1' }], mode: 'scheduled', startAt: new Date(START).toISOString() },
    cadence: { minMinutes: 35, maxMinutes: 35 },
    guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 0 },
    review: { requireApproval: false },
    dedupe: { enabled: true },
    ...patch,
  }
}

function item (n) {
  return {
    sourceType: 'hotTopics',
    platform: '',
    externalId: 't' + n,
    title: '选题' + n,
    content: '正文' + n,
    summary: '',
    url: 'https://topic/' + n,
    coverImage: '',
    publishedAt: new Date(NOW - n * 1000).toISOString(),
    needsCollect: false,
    needsGeneration: true,
    meta: {},
  }
}

function makeRunner (opts = {}) {
  const store = opts.store || fakeStore()
  const ledger = opts.ledger || createWorkflowLedger({ store, now: () => NOW })
  const calls = { rewrite: [], video: [], podcast: [], schedule: [], collect: [] }
  const items = opts.items || [item(1), item(2)]
  const deps = {
    sources: { collect: async () => ({ items, warnings: opts.warnings || [] }) },
    ledger,
    rewrite: async ({ item: it }) => { calls.rewrite.push(it.externalId); return { ok: true, title: it.title, content: '改写后:' + it.content } },
    collectArticle: async (url) => { calls.collect.push(url); return { ok: true, title: '采集标题', content: '采集正文', coverImage: 'cover.png' } },
    createVideo: async ({ item: it, pipeline }) => { calls.video.push(pipeline); return { ok: true, videoPath: '/v/' + it.externalId + '.mp4', runId: 'pr1' } },
    createPodcast: async ({ item: it, channelId }) => { calls.podcast.push(channelId); return { ok: true, episodeId: 'ep-' + it.externalId } },
    schedulePublish: async (payload) => { calls.schedule.push(payload); return { ok: true, scheduleId: 's' + calls.schedule.length } },
    accountProvider: async () => [
      { id: 'a1', platform: 'bilibili', status: 'active' },
      { id: 'a1', platform: 'zhihu', status: 'active' },
    ],
    store,
    log: { warn: () => {}, error: () => {}, info: () => {} },
    now: () => NOW,
    random: () => 0,
    ...opts.deps,
  }
  return { runner: createWorkflowRunner(deps), calls, store, ledger }
}

function task (cfg, patch = {}) {
  return {
    id: 'task-1',
    name: '测试工作流',
    action: { type: 'compositeWorkflow', config: cfg },
    failurePolicy: 'skip',
    maxRetries: 0,
    ...patch,
  }
}

describe('workflow-runner · 正常链路', () => {
  it('两条图文：改写→排期，间隔 35 分钟，账本记录两条', async () => {
    const { runner, calls, ledger } = makeRunner()
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(true)
    expect(r.status).toBe('completed')
    expect(calls.rewrite).toEqual(['t1', 't2'])
    expect(calls.schedule).toHaveLength(2)
    expect(Date.parse(calls.schedule[1].publishAt) - Date.parse(calls.schedule[0].publishAt)).toBe(35 * 60 * 1000)
    expect(ledger.size()).toBe(2)
    const run = runner.getRun(r.runId)
    expect(run.items.map((i) => i.status)).toEqual(['scheduled', 'scheduled'])
  })

  it('视频内容：先创作再排期，article 带 video_path', async () => {
    const { runner, calls } = makeRunner()
    const r = await runner.startRun(task(config({ content: { type: 'video', videoPipeline: 'story2video-compose', podcastChannelId: '' } })))
    expect(r.status).toBe('completed')
    expect(calls.video).toEqual(['story2video-compose', 'story2video-compose'])
    expect(calls.schedule[0].article.video_path).toBe('/v/t1.mp4')
  })

  it('播客：走频道发布，不排平台目标', async () => {
    const { runner, calls } = makeRunner()
    const r = await runner.startRun(task(config({
      content: { type: 'podcast', videoPipeline: '', podcastChannelId: 'ch-1' },
      publish: { targets: [], mode: 'immediate', startAt: '' },
    })))
    expect(r.status).toBe('completed')
    expect(calls.podcast).toEqual(['ch-1', 'ch-1'])
    expect(calls.schedule).toHaveLength(0)
  })

  it('无正文的收藏夹条目先采集再改写', async () => {
    const noContent = { ...item(1), content: '', needsCollect: true, url: 'https://zhuanlan.zhihu.com/p/9' }
    const { runner, calls } = makeRunner({ items: [noContent] })
    const r = await runner.startRun(task(config({ source: { type: 'zhihuFavlist', folderTokens: ['t'], limit: 5, categories: [], sort: 'latest', followIds: [], perCreatorLimit: 3 } })))
    expect(r.status).toBe('completed')
    expect(calls.collect).toEqual(['https://zhuanlan.zhihu.com/p/9'])
    expect(calls.rewrite).toEqual(['t1'])
  })
})

describe('workflow-runner · 去重与护栏', () => {
  it('账本命中的条目跳过，不重复改写/发布', async () => {
    const { runner, calls, ledger, store } = makeRunner()
    ledger.record({ sourceKey: 'hotTopics:unknown:t1', fingerprint: 'x', runId: 'old', title: '选题1' })
    const r = await runner.startRun(task(config()))
    expect(r.status).toBe('completed')
    expect(calls.schedule).toHaveLength(1)
    expect(calls.schedule[0].item.title).toBe('选题2')
    expect(runner.getRun(r.runId).summary.skipped).toBe(1)
    expect(store.getSetting('workflow_dedupe_ledger').includes('old')).toBe(true)
  })

  it('单次上限 5：10 条只排 5 条，并在摘要里说明截断原因', async () => {
    const items = Array.from({ length: 10 }, (_, i) => item(i + 1))
    const { runner, calls } = makeRunner({ items })
    const r = await runner.startRun(task(config({ guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 0 } })))
    expect(calls.schedule).toHaveLength(5)
    const run = runner.getRun(r.runId)
    expect(run.summary.truncated).toBe(true)
    expect(run.summary.truncateReason).toBe('maxItemsPerRun')
    expect(run.summary.collected).toBe(10)
  })

  it('每日额度用尽 → 不执行任何条目，run 失败并给出原因', async () => {
    const store = fakeStore()
    const ledger = createWorkflowLedger({ store, now: () => NOW })
    for (let i = 0; i < 20; i++) ledger.record({ sourceKey: 'old' + i, fingerprint: 'f' + i, runId: 'r0', createdAt: new Date(NOW).toISOString() })
    const { runner, calls } = makeRunner({ store, ledger })
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('dailyItemLimit')
    expect(calls.schedule).toHaveLength(0)
  })

  it('账本不可读 → fail-closed，绝不带着失明的去重继续发', async () => {
    const store = fakeStore()
    store.setSetting('workflow_dedupe_ledger', '{broken')
    const ledger = createWorkflowLedger({ store, now: () => NOW })
    const { runner, calls } = makeRunner({ store, ledger })
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('ledger-unreadable')
    expect(calls.schedule).toHaveLength(0)
  })
})

describe('workflow-runner · 失败策略', () => {
  it('skip：第 1 条改写失败，第 2 条照常发，run=completed_with_errors', async () => {
    const { runner, calls } = makeRunner({
      deps: {
        rewrite: async ({ item: it }) => (it.externalId === 't1'
          ? { ok: false, error: '模型超时' }
          : { ok: true, title: it.title, content: 'ok' }),
      },
    })
    const r = await runner.startRun(task(config()))
    expect(r.status).toBe('completed_with_errors')
    expect(calls.schedule).toHaveLength(1)
    expect(runner.getRun(r.runId).items[0].error).toContain('模型超时')
  })

  it('abort：第 1 条失败后立即停，第 2 条不再处理', async () => {
    const { runner, calls } = makeRunner({
      deps: {
        rewrite: async ({ item: it }) => (it.externalId === 't1'
          ? { ok: false, error: '模型超时' }
          : { ok: true, title: it.title, content: 'ok' }),
      },
    })
    const r = await runner.startRun(task(config(), { failurePolicy: 'abort' }))
    expect(r.status).toBe('failed')
    expect(calls.schedule).toHaveLength(0)
    expect(runner.getRun(r.runId).items[1].status).toBe('pending')
  })

  it('采集为空且有 warning → run=failed 并保留 warning', async () => {
    const { runner } = makeRunner({ items: [], warnings: [{ sourceType: 'zhihuFavlist', message: '未配置 Access Secret' }] })
    const r = await runner.startRun(task(config({ source: { type: 'zhihuFavlist', folderTokens: ['t'], limit: 5, categories: [], sort: 'latest', followIds: [], perCreatorLimit: 3 } })))
    expect(r.status).toBe('failed')
    expect(runner.getRun(r.runId).warnings[0].message).toContain('Access Secret')
  })

  it('发布目标缺账号 → invalid-config，且不排期', async () => {
    const { runner, calls } = makeRunner({ items: [item(1)] })
    const r = await runner.startRun(task(config({
      publish: { targets: [{ platform: 'zhihu', accountId: '' }], mode: 'immediate', startAt: '' },
    })))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid-config')
    expect(r.errors[0]).toMatchObject({ field: 'publish.targets[0].accountId', reason: 'empty' })
    expect(calls.schedule).toHaveLength(0)
  })

  it('账号检查器缺失 → account-check-unavailable（不静默跳过）', async () => {
    const { runner, calls } = makeRunner({
      items: [item(1)],
      deps: { accountProvider: undefined },
    })
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('account-check-unavailable')
    expect(calls.collect).toHaveLength(0)
  })

  it('账号登录过期 → account-unavailable，采集与排期都不发生', async () => {
    const { runner, calls } = makeRunner({
      items: [item(1)],
      deps: { accountProvider: async () => [{ id: 'a1', platform: 'bilibili', status: 'expired' }] },
    })
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('account-unavailable')
    expect(r.accounts[0]).toMatchObject({ platform: 'bilibili', accountId: 'a1', reason: 'expired' })
    expect(calls.collect).toHaveLength(0)
    expect(calls.schedule).toHaveLength(0)
  })

  it('账号不存在 → account-unavailable，不带着无效目标开跑', async () => {
    const { runner, calls } = makeRunner({
      items: [item(1)],
      deps: { accountProvider: async () => [{ id: 'other', platform: 'bilibili', status: 'active' }] },
    })
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('account-unavailable')
    expect(r.accounts[0]).toMatchObject({ platform: 'bilibili', accountId: 'a1', reason: 'missing' })
    expect(calls.collect).toHaveLength(0)
  })

  it('账号检查本身失败 → account-check-failed（fail-closed）', async () => {
    const { runner, calls } = makeRunner({
      items: [item(1)],
      deps: { accountProvider: async () => { throw new Error('backend down') } },
    })
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('account-check-failed')
    expect(calls.collect).toHaveLength(0)
  })

  it('队列派发失败回写运行条目：failed + queueStatus/queueError', async () => {
    const { runner } = makeRunner({ items: [item(1)] })
    const r = await runner.startRun(task(config()))
    expect(r.ok).toBe(true)
    expect(runner.applyQueueEvent({
      runId: r.runId,
      itemKey: '0|t1',
      event: 'failed',
      error: 'dispatch boom',
      attempts: 3,
    })).toEqual({ ok: true })
    expect(runner.getRun(r.runId).items[0]).toMatchObject({
      status: 'failed',
      queueStatus: 'failed',
      queueError: 'dispatch boom',
      queueAttempts: 3,
    })
  })

  it('队列已派发只是回写 queueStatus，不把 scheduled 直接改 published', async () => {
    const { runner } = makeRunner({ items: [item(1)] })
    const r = await runner.startRun(task(config()))
    await runner.applyQueueEvent({ runId: r.runId, itemKey: '0|t1', event: 'dispatched', attempts: 1 })
    expect(runner.getRun(r.runId).items[0]).toMatchObject({
      status: 'scheduled',
      queueStatus: 'dispatched',
      error: '',
    })
  })

  it('同标题多条用 index 前缀区分，不串写错误状态', async () => {
    const { runner, calls } = makeRunner({
      items: [
        { ...item(1), title: '同名标题' },
        { ...item(2), title: '同名标题' },
      ],
    })
    const r = await runner.startRun(task(config()))
    expect(new Set(calls.schedule.map((x) => x.itemKey)).size).toBe(2)
    const second = runner.getRun(r.runId).items[1]
    await runner.applyQueueEvent({ runId: r.runId, itemKey: second.itemKey, event: 'failed', error: 'second failed' })
    const detail = runner.getRun(r.runId)
    expect(detail.items[0].status).toBe('scheduled')
    expect(detail.items[1]).toMatchObject({ status: 'failed', queueError: 'second failed' })
  })

  it('人工重试回写把 failed 条目恢复为 scheduled，并修正 summary', async () => {
    const { runner } = makeRunner({ items: [item(1)] })
    const r = await runner.startRun(task(config()))
    await runner.applyQueueEvent({ runId: r.runId, itemKey: '0|t1', event: 'failed', error: 'boom' })
    expect(runner.getRun(r.runId).summary.failed).toBe(1)
    await runner.applyQueueEvent({ runId: r.runId, itemKey: '0|t1', event: 'retry-requested' })
    const detail = runner.getRun(r.runId)
    expect(detail.items[0]).toMatchObject({ status: 'scheduled', queueStatus: 'pending', error: '' })
    expect(detail.summary.failed).toBe(0)
  })

  it('账本写入失败 → 回滚已排期项，不留下「无账本记录却会发」的队列项', async () => {
    const cancelled = []
    const { runner, ledger } = makeRunner({
      items: [item(1)],
      deps: {
        cancelSchedule: async (id) => { cancelled.push(id); return { ok: true } },
      },
    })
    ledger.record = () => ({ ok: false, reason: 'persist-failed' })
    const r = await runner.startRun(task(config()))
    expect(r.status).toBe('failed')
    expect(cancelled).toEqual(['s1'])
  })

  it('多目标排期：第二个目标失败 → 回滚第一个已写入项，不留下幽灵任务', async () => {
    const cancelled = []
    const { runner } = makeRunner({
      items: [item(1)],
      deps: {
        schedulePublish: async ({ target }) => (target.platform === 'zhihu'
          ? { ok: false, error: 'zhihu 排期失败' }
          : { ok: true, scheduleId: 's1' }),
        cancelSchedule: async (id) => { cancelled.push(id); return { ok: true } },
      },
    })
    const r = await runner.startRun(task(config({
      publish: {
        targets: [{ platform: 'bilibili', accountId: 'a1' }, { platform: 'zhihu', accountId: 'a1' }],
        mode: 'immediate',
        startAt: '',
      },
    })))
    expect(r.status).toBe('failed')
    expect(cancelled).toEqual(['s1'])
    expect(runner.getRun(r.runId).items[0].status).toBe('failed')
  })
})

describe('workflow-runner · 审核开关', () => {
  it('requireApproval=true：生成后停在 awaiting_review，approveRun 才排期', async () => {
    const { runner, calls } = makeRunner()
    const cfg = config({ review: { requireApproval: true } })
    const r = await runner.startRun(task(cfg))
    expect(r.status).toBe('awaiting_review')
    expect(calls.schedule).toHaveLength(0)
    const approved = await runner.approveRun(r.runId)
    expect(approved.ok).toBe(true)
    expect(calls.schedule).toHaveLength(2)
    expect(runner.getRun(r.runId).status).toBe('completed')
  })
})
