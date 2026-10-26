import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

const reportErrorMock = vi.fn()
vi.mock('@/utils/report-error', () => ({ reportError: (...args) => reportErrorMock(...args) }))

const { useAccountAddDeepLink } = await import('./useAccountAddDeepLink')

function setup (initialQuery = {}) {
  const route = reactive({ query: { ...initialQuery } })
  const router = { replace: vi.fn().mockResolvedValue(undefined) }
  const showAddDialog = ref(false)
  useAccountAddDeepLink({ route, router, showAddDialog })
  return { route, router, showAddDialog }
}

describe('useAccountAddDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初始 URL 带 action=add-account 时立即打开弹层并清理参数', async () => {
    const { router, showAddDialog } = setup({ action: 'add-account', tab: 'groups' })
    await nextTick()

    expect(showAddDialog.value).toBe(true)
    expect(router.replace).toHaveBeenCalledWith({
      path: '/accounts',
      query: { tab: 'groups' },
    })
  })

  it('已挂载后才出现 action 时同样打开弹层（首页跳转路径）', async () => {
    const { route, router, showAddDialog } = setup()
    await nextTick()
    expect(showAddDialog.value).toBe(false)

    route.query = { action: 'add-account' }
    await nextTick()

    expect(showAddDialog.value).toBe(true)
    expect(router.replace).toHaveBeenCalledWith({ path: '/accounts', query: {} })
  })

  it('非 add-account 的 action 不弹层、不改 URL', async () => {
    const { router, showAddDialog } = setup({ action: 'something-else' })
    await nextTick()

    expect(showAddDialog.value).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('replace 失败时不影响已打开的弹层，并记录错误', async () => {
    const route = reactive({ query: { action: 'add-account' } })
    const router = { replace: vi.fn().mockRejectedValueOnce(new Error('navigation cancelled')) }
    const showAddDialog = ref(false)
    useAccountAddDeepLink({ route, router, showAddDialog })
    await nextTick()
    await Promise.resolve()

    expect(showAddDialog.value).toBe(true)
    expect(reportErrorMock).toHaveBeenCalledWith(
      'accounts add-account deep link cleanup failed',
      expect.any(Error),
    )
  })
})
