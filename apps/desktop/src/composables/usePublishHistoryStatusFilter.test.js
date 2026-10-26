import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

const reportErrorMock = vi.fn()
vi.mock('@/utils/report-error', () => ({ reportError: (...args) => reportErrorMock(...args) }))

const {
  usePublishHistoryStatusFilter,
  normalizePublishStatusFilter,
  PUBLISH_HISTORY_STATUS_TABS,
} = await import('./usePublishHistoryStatusFilter')

function setup (initialQuery = {}) {
  const route = reactive({ query: { ...initialQuery } })
  const router = { replace: vi.fn().mockResolvedValue(undefined) }
  const { statusFilter, statusTabs } = usePublishHistoryStatusFilter({ route, router })
  return { route, router, statusFilter, statusTabs }
}

describe('normalizePublishStatusFilter', () => {
  it.each([
    ['success', 'success'],
    ['SUCCESS', 'success'],
    ['failed', 'failed'],
    ['pending', 'pending'],
    ['all', ''],
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['not-a-status', ''],
    [['failed', 'success'], 'failed'],
  ])('把 %j 归一化为 %j', (input, expected) => {
    expect(normalizePublishStatusFilter(input)).toBe(expected)
  })
})

describe('usePublishHistoryStatusFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('从 URL 初始化状态，并暴露四个标签', async () => {
    const { statusFilter, statusTabs } = setup({ status: 'failed' })
    await nextTick()

    expect(statusFilter.value).toBe('failed')
    expect(statusTabs.map(tab => tab.value)).toEqual(['', 'success', 'failed', 'pending'])
  })

  it('非法 URL 值回落为全部', async () => {
    const { statusFilter } = setup({ status: 'not-a-status' })
    await nextTick()
    expect(statusFilter.value).toBe('')
  })

  it('外部路由变化会同步到状态筛选（首页统计卡深链）', async () => {
    const { route, statusFilter } = setup()
    await nextTick()

    route.query = { status: 'success' }
    await nextTick()

    expect(statusFilter.value).toBe('success')
  })

  it('点击状态标签写入 URL，并保留其它查询参数', async () => {
    const { router, statusFilter } = setup({ q: '关键词' })
    await nextTick()

    statusFilter.value = 'failed'
    await nextTick()

    expect(router.replace).toHaveBeenCalledWith({
      path: '/publish/history',
      query: { q: '关键词', status: 'failed' },
    })
  })

  it('切回全部时从 URL 移除 status', async () => {
    const { router, statusFilter } = setup({ status: 'failed' })
    await nextTick()

    statusFilter.value = ''
    await nextTick()

    expect(router.replace).toHaveBeenCalledWith({
      path: '/publish/history',
      query: {},
    })
  })

  it('URL 已经是目标状态时不重复 replace（避免回环）', async () => {
    const { router, statusFilter } = setup({ status: 'success' })
    await nextTick()

    statusFilter.value = 'success'
    await nextTick()

    expect(router.replace).not.toHaveBeenCalled()
  })

  it('replace 失败时记录错误但不抛未处理拒绝', async () => {
    const { router, statusFilter } = setup()
    router.replace.mockRejectedValueOnce(new Error('navigation cancelled'))
    await nextTick()

    statusFilter.value = 'pending'
    await nextTick()
    await Promise.resolve()

    expect(reportErrorMock).toHaveBeenCalledWith(
      'publish history status query sync failed',
      expect.any(Error),
    )
  })

  it('标签定义与 historyPage 文案键一一对应', () => {
    const keys = PUBLISH_HISTORY_STATUS_TABS.map(tab => tab.labelKey)
    expect(keys).toEqual([
      'statusTabAll',
      'filterStatusSuccess',
      'filterStatusFailed',
      'filterStatusPending',
    ])
  })
})
