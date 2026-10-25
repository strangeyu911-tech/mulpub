// @ts-check
/**
 * usage-reporter.test.js — 模型调用用量脱敏上报
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { UsageReporter, classifyStatus } = require('./usage-reporter')

function makeDb (rows) {
  const statements = []
  return {
    prepare: vi.fn((sql) => {
      const stmt = {
        all: vi.fn((...args) => rows),
        run: vi.fn(() => ({ changes: 1 })),
      }
      statements.push({ sql, stmt })
      return stmt
    }),
    _statements: statements,
  }
}

// 与真实 settings-store 同形：落盘是文本，读回是**解析后的值**（原样回吐会替被测代码改契约）
function makeStore (rows, initial) {
  let data = initial || ''
  const stored = () => { try { return JSON.parse(data) } catch { return data } }
  return {
    db: makeDb(rows),
    getSetting: vi.fn(() => (data ? stored() : '')),
    getSettingObject: vi.fn((_k, d = {}) => {
      const v = data ? stored() : null
      return v && typeof v === 'object' && !Array.isArray(v) ? v : d
    }),
    setSetting: vi.fn((_k, v) => { data = (typeof v === 'string' ? v : JSON.stringify(v)) }),
    _getData: () => data,
  }
}

const LOG = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
const AUTH = { url: 'https://ops.example.com', apiKey: 'k' }

describe('classifyStatus', () => {
  it('success / 限流 / 普通失败分类', () => {
    expect(classifyStatus({ status: 'success' })).toEqual({ ok: true, ratelimit: false })
    expect(classifyStatus({ status: 'error', error_message: 'rate limit exceeded' }).ratelimit).toBe(true)
    expect(classifyStatus({ status: 'error', error_message: 'HTTP 429' }).ratelimit).toBe(true)
    expect(classifyStatus({ status: 'timeout', error_message: 'ETIMEDOUT' })).toEqual({ ok: false, ratelimit: false })
  })
})

describe('UsageReporter.reportPending', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('未配置 auth 时静默跳过', async () => {
    const store = makeStore([])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => null })
    const res = await r.reportPending()
    expect(res).toEqual({ code: 0, skipped: true })
  })

  it('无待上报日志时直接返回 0', async () => {
    const store = makeStore([])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    const res = await r.reportPending()
    expect(res).toEqual({ code: 0, reported: 0 })
  })

  it('聚合上报并按水印推进；脱敏（不含 error_message）', async () => {
    const rows = [
      { id: 1, provider_id: 'openai', category: 'llm', action: 'chat', status: 'success', latency_ms: 500, tokens_in: 100, tokens_out: 50, cost: 0.01, error_message: null, created_at: '2026-08-09 10:00:00' },
      { id: 2, provider_id: 'openai', category: 'llm', action: 'chat', status: 'error', latency_ms: 2000, tokens_in: 0, tokens_out: 0, cost: 0, error_message: 'rate limit exceeded 敏感信息', created_at: '2026-08-09 11:00:00' },
      { id: 3, provider_id: 'minimax-multimodal', category: 'multimodal', action: 'tts', status: 'success', latency_ms: 12000, tokens_in: 0, tokens_out: 0, cost: 0.5, error_message: null, created_at: '' },
    ]
    const store = makeStore(rows)
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    let body
    global.fetch = vi.fn(async (url, opts) => {
      body = JSON.parse(opts.body)
      return { ok: true, status: 200 }
    })
    const res = await r.reportPending()
    expect(res.code).toBe(0)
    expect(res.reported).toBe(2)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ops.example.com/api/v1/usage/ingest',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Catalog-Key': 'k' }) }),
    )
    // 批次号随请求发出（服务端按 client_id+batch_id 去重防重试翻倍）
    expect(body.batch_id).toContain('dev-1:0:3')
    const byAction = Object.fromEntries(body.items.map(i => [i.action, i]))
    expect(byAction.chat.usage_date).toBe('2026-08-09') // 按 created_at 真实日期归日
    expect(byAction.chat.calls).toBe(2)
    expect(byAction.chat.ok_count).toBe(1)
    expect(byAction.chat.fail_count).toBe(1)
    expect(byAction.chat.ratelimit_count).toBe(1)
    expect(byAction.chat.latency_buckets).toEqual({ lt1s: 1, '1to3s': 1, '3to10s': 0, gt10s: 0 })
    expect(byAction.tts.calls).toBe(1)
    expect(byAction.tts.latency_buckets.gt10s).toBe(1)
    // 脱敏：不上报 error_message 字段
    expect(JSON.stringify(body)).not.toContain('rate limit exceeded')
    expect(JSON.stringify(body)).not.toContain('error_message')
    // 水印推进到 max id
    expect(store._getData()).toContain('lastId')
    expect(JSON.parse(store._getData()).lastId).toBe(3)
  })

  it('上报失败保留水印，下次重试不丢数据', async () => {
    const rows = [{ id: 1, provider_id: 'openai', category: 'llm', action: 'chat', status: 'success', latency_ms: 100, tokens_in: 0, tokens_out: 0, cost: 0, error_message: null }]
    const store = makeStore(rows)
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH })
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    const res = await r.reportPending()
    expect(res.code).toBe(-1)
    expect(store._getData()).toBe('') // 水印未推进
  })

  it('start 后定时与首报触发（fake timers）', async () => {
    vi.useFakeTimers()
    const rows = []
    const store = makeStore(rows)
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH })
    const spy = vi.spyOn(r, 'reportPending').mockResolvedValue({ code: 0 })
    r.start()
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5001)
    expect(spy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30 * 60 * 1000)
    expect(spy).toHaveBeenCalledTimes(2)
    r.stop()
  })
})

describe('P1 调度可观测性上报（scheduler 聚合项）', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('governor 排队/冷却计数以 scheduler-observation 项上报', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
    // 至少一条调用日志触发上报路径（scheduler 项追加在调用桶之后）
    const store = makeStore([{ id: 1, provider_id: 'openai', category: 'llm', action: 'chat', status: 'success', latency_ms: 10, tokens_in: 1, tokens_out: 1, cost: 0, error_message: null, created_at: new Date().toISOString().slice(0, 10) }])
    const r = new UsageReporter({
      store,
      log: LOG,
      getOpsCenterAuth: () => AUTH,
      getClientId: () => 'dev-1',
      getSchedulerMetrics: () => ({
        'minimax-tts': { queuedCount: 3, cooldownCount: 1, queueWaitMs: 4500, cooldownWaitMs: 30000 },
      }),
    })
    const res = await r.reportPending()
    expect(res.code).toBe(0)
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    const sched = body.items.find(i => i.action === 'scheduler-observation')
    expect(sched).toBeTruthy()
    expect(sched.provider_id).toBe('minimax-tts')
    expect(sched.category).toBe('scheduler')
    expect(sched.queued_count).toBe(3)
    expect(sched.cooldown_count).toBe(1)
    expect(sched.queue_wait_ms).toBe(4500)
    expect(sched.cooldown_wait_ms).toBe(30000)
  })

  it('未注入 getSchedulerMetrics 时不上报 scheduler 项（向后兼容）', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
    const store = makeStore([{ id: 1, provider_id: 'openai', category: 'llm', action: 'chat', status: 'success', latency_ms: 10, tokens_in: 1, tokens_out: 1, cost: 0, error_message: null, created_at: new Date().toISOString().slice(0, 10) }])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    const res = await r.reportPending()
    expect(res.code).toBe(0)
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.items.filter(i => i.action === 'scheduler-observation')).toHaveLength(0)
  })
})

// ⚠ 按 key 存取的 store 桩：真实 settings-store 的 setSetting/getSettingObject 是**按 key**的，
//   而上面的 makeStore 只有一格 ⇒ 用它验证「日桶水印与事件水印互不影响」会得到假失败。
function makeKeyedStore (rows, initial) {
  const map = new Map(Object.entries(initial || {}))
  return {
    db: makeDb(rows),
    getSetting: vi.fn((k) => (map.has(k) ? map.get(k) : '')),
    getSettingObject: vi.fn((k, d = {}) => {
      const v = map.get(k)
      return v && typeof v === 'object' && !Array.isArray(v) ? v : d
    }),
    setSetting: vi.fn((k, v) => { map.set(k, typeof v === 'string' ? v : JSON.stringify(v)) }),
    _map: map,
  }
}

describe('UsageReporter.reportEvents（事件级上报 · 官方算力成本归集的地基）', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const VIDEO_ROW = {
    id: 7, provider_id: 'minimax', category: 'video', model: 'H3', action: 'generateVideo',
    status: 'success', latency_ms: 12000, tokens_in: 0, tokens_out: 0,
    spec: '768p', duration_seconds: 10, item_count: 0, char_count: 0, byok: 1,
    created_at: '2026-10-25 10:00:00',
  }

  it('一次调用一条事件（不聚合），并带上用量维度', async () => {
    const store = makeKeyedStore([VIDEO_ROW])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    let body
    global.fetch = vi.fn(async (url, opts) => {
      body = JSON.parse(opts.body)
      return { ok: true, status: 200 }
    })
    const res = await r.reportEvents()
    expect(res.code).toBe(0)
    expect(res.reported).toBe(1)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ops.example.com/api/v1/usage/events',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Catalog-Key': 'k' }) }),
    )
    expect(body.items).toHaveLength(1)
    const item = body.items[0]
    // ★ 用量维度必须带上去：缺它们 ⇒ 服务端成本恒 0 且全报「缺价格」
    expect(item.duration_seconds).toBe(10)
    expect(item.spec).toBe('768p')
    expect(item.model).toBe('H3')
    expect(item.usage_date).toBe('2026-10-25')
    // ★ 幂等键：重试重报不会重复计数
    expect(item.event_id).toBe('dev-1:7')
    // byok 透传：用户自带 Key ⇒ 服务端不扣官方积分
    expect(item.byok).toBe(1)
    // ★ 客户端**不报成本**：成本一律由服务端按价格卡算
    expect(item.cost).toBeUndefined()
  })

  it('事件带 user_id（Logto sub）—— 后绑定 provider 提供的身份', async () => {
    const store = makeKeyedStore([VIDEO_ROW])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    r.setOwnerSubjectProvider(() => 'logto-sub-42')
    let body
    global.fetch = vi.fn(async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200 } })
    await r.reportEvents()
    expect(body.items[0].user_id).toBe('logto-sub-42')
  })

  it('拿不到身份时 user_id 留空（不编造）', async () => {
    // ⚠ 编一个身份会污染「按用户维度归集成本」⇒ 拿不到就留空。
    const store = makeKeyedStore([VIDEO_ROW])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    let body
    global.fetch = vi.fn(async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200 } })
    await r.reportEvents()
    expect(body.items[0].user_id).toBe('')
  })

  it('事件水印与日桶水印**互不影响**（两条流读同一张表）', async () => {
    const store = makeKeyedStore([VIDEO_ROW])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }))
    await r.reportEvents()
    // 事件流推进了自己的水印
    expect(JSON.parse(store._map.get('opsCenterUsageEventReport')).lastId).toBe(7)
    // 日桶水印**没有**被推进（否则两条流会互相饿死：日桶推进后事件流就看不到那些行了）
    expect(store._map.has('opsCenterUsageReport')).toBe(false)
  })

  it('事件上报失败保留事件水印（下次重试不丢数据）', async () => {
    const store = makeKeyedStore([VIDEO_ROW])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => AUTH, getClientId: () => 'dev-1' })
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    const res = await r.reportEvents()
    expect(res.code).toBe(-1)
    expect(store._map.has('opsCenterUsageEventReport')).toBe(false)
  })

  it('未配置 auth 时静默跳过（不发请求）', async () => {
    const store = makeKeyedStore([VIDEO_ROW])
    const r = new UsageReporter({ store, log: LOG, getOpsCenterAuth: () => null })
    const res = await r.reportEvents()
    expect(res).toEqual({ code: 0, skipped: true })
  })
})
