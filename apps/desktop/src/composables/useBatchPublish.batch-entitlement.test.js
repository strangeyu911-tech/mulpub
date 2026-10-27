// @ts-check
/**
 * useBatchPublish.batch-entitlement.test.js — P0-4 批量发布档位门禁（独立文件）
 *
 * 为什么单独成文件：useBatchPublish.test.js 已接近测试文件 1500 行上限；
 * 按「一个判据一组用例」拆出，避免为了加测试去抬高台账上限。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

const { mockBatchCreate, mockElMessage } = vi.hoisted(() => ({
  mockBatchCreate: vi.fn(),
  mockElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}))

vi.mock('@/api/publisher', () => ({
  batchCreate: mockBatchCreate,
  retryTask: vi.fn(),
  onProgress: vi.fn(() => vi.fn()),
  batchExecute: vi.fn(async () => ({ code: 0 })),
  batchSchedule: vi.fn(async () => ({ code: 0 })),
  batchCancel: vi.fn(),
  batchGet: vi.fn(),
  onBatchProgress: vi.fn(() => vi.fn()),
  publishBatch: vi.fn(),
  sensitiveCheck: vi.fn(),
  storeGetSetting: vi.fn(),
  offlineStatus: vi.fn(async () => ({ code: 0, data: { offline: false } })),
  offlineAddToCache: vi.fn(async () => ({ code: 0 })),
}))

vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
  ElMessageBox: { confirm: vi.fn() },
}))

vi.mock('@/stores/publishProgress', async () => {
  const { reactive: reactiveStore } = await import('vue')
  const store = reactiveStore({
    sessions: [],
    panelVisible: false,
    panelMinimized: false,
    registerSession: vi.fn(),
  })
  return { usePublishProgressStore: () => store }
})

import { nextTick } from 'vue'
import { useBatchPublish } from './useBatchPublish'

describe('useBatchPublish — 批量发布档位门禁（P0-4）', () => {
  let article

  beforeEach(() => {
    vi.clearAllMocks()
    article = reactive({ title: '', content: '' })
  })

  it('标准档 entitlement 允许批量，即使 licenseStore.isPro=false（纯订阅）', () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'standard', limits: { batch_size_per_run: 10 } },
    })
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(true)
  })

  it('免费档 batch_size_per_run=1 禁止批量并提示', () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'free', limits: { batch_size_per_run: 1 } },
    })
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(false)
    expect(mockElMessage.warning).toHaveBeenCalled()
  })

  it('专业档 batch_size_per_run=-1 不限，允许批量', () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'pro', limits: { batch_size_per_run: -1 } },
    })
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(true)
  })

  it('entitlement 缺失按「缺失即放行」允许批量（legacy 快照）', () => {
    const r = useBatchPublish({ article })
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(true)
  })

  it('checkBatchAccess batchMode=false 时不检查', () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'free', limits: { batch_size_per_run: 1 } },
    })
    r.batchMode.value = false
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(false)
  })

  it('addArticle 达到 batch_size_per_run 上限后不再添加并提示', () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'standard', limits: { batch_size_per_run: 2 } },
    })
    expect(r.addArticle()).toBe(true)
    expect(r.addArticle()).toBe(true)
    expect(r.addArticle()).toBe(false)
    expect(r.articles.value).toHaveLength(2)
    expect(mockElMessage.warning).toHaveBeenCalled()
  })

  it('getEntitlement 每次实时读取（升级后不刷新页面也生效）', () => {
    let entitlement = { plan: 'free', limits: { batch_size_per_run: 1 } }
    const r = useBatchPublish({ article, getEntitlement: () => entitlement })
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(false)

    entitlement = { plan: 'standard', limits: { batch_size_per_run: 10 } }
    r.batchMode.value = true
    r.checkBatchAccess()
    expect(r.batchMode.value).toBe(true)
  })

  it('提交前按 entitlement 复核条数，超限不创建批次', async () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'standard', limits: { batch_size_per_run: 1 } },
    })
    r.articles.value = [
      { title: 'A', content: 'a', platforms: ['wechat_mp'] },
      { title: 'B', content: 'b', platforms: ['zhihu'] },
    ]
    await r.handleBatchPublish()
    expect(mockBatchCreate).not.toHaveBeenCalled()
    expect(mockElMessage.warning).toHaveBeenCalled()
  })

  it('热门选题交接超过上限时只装载上限条数并提示', () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'standard', limits: { batch_size_per_run: 2 } },
    })
    const count = r.seedArticlesFromDrafts([
      { id: 'd1', title: 'A', content: 'a' },
      { id: 'd2', title: 'B', content: 'b' },
      { id: 'd3', title: 'C', content: 'c' },
    ])
    expect(count).toBe(2)
    expect(r.articles.value).toHaveLength(2)
    expect(mockElMessage.warning).toHaveBeenCalled()
  })

  it('batchMode 切换为 true 且免费档时只保留 1 条（不越界）', async () => {
    const r = useBatchPublish({
      article,
      entitlement: { plan: 'free', limits: { batch_size_per_run: 1 } },
    })
    r.batchMode.value = true
    await nextTick()
    expect(r.articles.value).toHaveLength(1)
  })
})
