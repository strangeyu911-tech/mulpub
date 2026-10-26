/**
 * workflow-publish-queue.test.js — 到点派发的持久队列
 *
 * 主线：① 到点才发、未到点不动 ② 派发失败有界重试 ③ 应用重启后过期项标记 missed
 * ④ 取消运行会撤掉未派发项 ⑤ 队列损坏 fail-closed 不覆盖
 */
const { createWorkflowPublishQueue } = require('./workflow-publish-queue')

const NOW = Date.parse('2026-10-26T10:00:00+08:00')

function fakeStore (initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getSetting: (k) => (map.has(k) ? map.get(k) : null),
    setSetting: (k, v) => { map.set(k, v) },
    _dump: () => Object.fromEntries(map.entries()),
  }
}

function entry (patch = {}) {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    title: '标题',
    platform: 'bilibili',
    accountId: 'a1',
    article: { title: '标题', content: '正文' },
    publishAt: new Date(NOW - 1000).toISOString(),
    ...patch,
  }
}

describe('workflow-publish-queue · 到点派发', () => {
  it('未到点不派发，到点后派发一次并标记 dispatched', async () => {
    const store = fakeStore()
    const calls = []
    const q = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async (e) => { calls.push(e) } })
    q.add(entry({ publishAt: new Date(NOW + 60 * 1000).toISOString() }))
    expect(await q.tick()).toMatchObject({ dispatched: 0 })
    const q2 = createWorkflowPublishQueue({ store, now: () => NOW + 120 * 1000, enqueue: async (e) => { calls.push(e) } })
    expect(await q2.tick()).toMatchObject({ dispatched: 1 })
    expect(calls).toHaveLength(1)
    expect(q2.list()[0].status).toBe('dispatched')
  })

  it('派发失败：同一条最多重试 3 次后置 failed，不无限重试', async () => {
    const store = fakeStore()
    let attempts = 0
    const q = createWorkflowPublishQueue({
      store,
      now: () => NOW,
      maxAttempts: 3,
      enqueue: async () => { attempts += 1; throw new Error('队列不可用') },
    })
    q.add(entry())
    await q.tick()
    await q.tick()
    await q.tick()
    expect(attempts).toBe(3)
    expect(q.list()[0]).toMatchObject({ status: 'failed' })
    expect(q.list()[0].error).toContain('队列不可用')
  })

  it('重启恢复：超过 24h 的过期项标记 missed，不补发', async () => {
    const store = fakeStore()
    const calls = []
    const q = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async (e) => { calls.push(e) } })
    q.add(entry({ publishAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString() }))
    const q2 = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async (e) => { calls.push(e) } })
    const r = await q2.tick()
    expect(r.missed).toBe(1)
    expect(calls).toHaveLength(0)
    expect(q2.list()[0].status).toBe('missed')
  })

  it('重启恢复：24h 内过期项补发并标记 late', async () => {
    const store = fakeStore()
    const calls = []
    const q = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async (e) => { calls.push(e) } })
    q.add(entry({ publishAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }))
    const q2 = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async (e) => { calls.push(e) } })
    await q2.tick()
    expect(calls).toHaveLength(1)
    expect(calls[0].late).toBe(true)
  })

  it('取消运行：pending 项置 cancelled，已派发的保留', async () => {
    const store = fakeStore()
    const q = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async () => {} })
    const a = q.add(entry({ publishAt: new Date(NOW + 3600 * 1000).toISOString() }))
    const b = q.add(entry({ runId: 'run-2', publishAt: new Date(NOW + 3600 * 1000).toISOString() }))
    const r = q.cancelRun('run-1')
    expect(r.cancelled).toBe(1)
    const rows = q.list()
    expect(rows.find((x) => x.id === a.id).status).toBe('cancelled')
    expect(rows.find((x) => x.id === b.id).status).toBe('pending')
  })

  it('remove：pending 可撤回，dispatched 不可撤回（防「排了三条只成功两条还留一条」）', async () => {
    const store = fakeStore()
    const q = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async () => {} })
    const a = q.add(entry({ publishAt: new Date(NOW + 3600 * 1000).toISOString() }))
    expect(q.remove(a.id)).toMatchObject({ ok: true })
    expect(q.list()).toHaveLength(0)

    const b = q.add(entry())
    await q.tick()
    expect(q.list()[0].status).toBe('dispatched')
    const r = q.remove(b.id)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-pending')
    expect(q.list()[0].status).toBe('dispatched')
  })

  it('新入队静默期：minDispatchDelayMs 内不派发（给多目标回滚留窗口）', async () => {
    const store = fakeStore()
    const calls = []
    const q = createWorkflowPublishQueue({ store, now: () => NOW, minDispatchDelayMs: 60000, enqueue: async (e) => { calls.push(e) } })
    q.add(entry())
    expect(await q.tick()).toMatchObject({ dispatched: 0 })
    const q2 = createWorkflowPublishQueue({ store, now: () => NOW + 61000, minDispatchDelayMs: 60000, enqueue: async (e) => { calls.push(e) } })
    expect(await q2.tick()).toMatchObject({ dispatched: 1 })
    expect(calls).toHaveLength(1)
  })

  it('队列损坏 → fail-closed：拒绝写入且不覆盖原值', () => {
    const store = fakeStore({ workflow_publish_queue: '{broken' })
    const q = createWorkflowPublishQueue({ store, now: () => NOW, enqueue: async () => {} })
    const r = q.add(entry())
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('queue-unreadable')
    expect(store.getSetting('workflow_publish_queue')).toBe('{broken')
  })
})
