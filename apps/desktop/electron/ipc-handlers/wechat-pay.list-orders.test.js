import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

vi.mock('../services/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

// 与 logs.test.js 同型：withSenderCheck 在测试环境按 senderFrame 判定可信来源
const TRUSTED_EVENT = { senderFrame: { url: 'app://localhost/index.html' } }

let registerHandlers
beforeAll(async () => {
  const mod = await import('./wechat-pay')
  registerHandlers = mod.registerWeChatPayHandlers || mod.default || mod
})

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    call: (channel, ...args) => handlers[channel](TRUSTED_EVENT, ...args),
  }
}

const requestMock = vi.fn()

function buildDeps() {
  return {
    authService: {
      getState: () => ({ user: { sub: 'sub-1' } }),
      memberApiService: { request: requestMock },
    },
    toQrDataUrl: vi.fn(async () => 'data:image/png;base64,stub'),
  }
}

function row(id) {
  return {
    id,
    plan: 'pro',
    amount: 9900,
    currency: 'CNY',
    status: 'paid',
    period: 'month',
    created_at: '2026-10-20T10:00:00.000Z',
    paid_at: '2026-10-20T10:01:00.000Z',
  }
}

describe('wechat-pay:list-orders 分页', () => {
  let ipcMain

  beforeEach(() => {
    requestMock.mockReset()
    ipcMain = createMockIpcMain()
  })

  it('上行带 limit/offset，下行透出 total/hasMore', async () => {
    requestMock.mockResolvedValue({ orders: [row('o1')], total: 3, hasMore: true })
    registerHandlers(ipcMain, buildDeps())

    const res = await ipcMain.call('wechat-pay:list-orders', { limit: 2, offset: 4 })

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      path: '/api/v1/me/orders',
      method: 'GET',
      query: { limit: 2, offset: 4 },
    }))
    expect(res.code).toBe(0)
    expect(res.data.total).toBe(3)
    expect(res.data.hasMore).toBe(true)
    expect(res.data.orders).toHaveLength(1)
  })

  it('非法分页参数在主进程再钳制一次（不信任渲染层）', async () => {
    requestMock.mockResolvedValue({ orders: [], total: 0, hasMore: false })
    registerHandlers(ipcMain, buildDeps())

    await ipcMain.call('wechat-pay:list-orders', { limit: 9999, offset: -3 })

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ query: { limit: 100, offset: 0 } }))
  })

  it('旧服务端不返回 total/hasMore 时本地兜底推导', async () => {
    // 恰好满一页 ⇒ 推测「可能还有下一页」，让用户能继续翻
    requestMock.mockResolvedValue({ orders: Array.from({ length: 20 }, (_, i) => row(`o${i}`)) })
    registerHandlers(ipcMain, buildDeps())

    const res = await ipcMain.call('wechat-pay:list-orders', { limit: 20, offset: 0 })

    expect(res.data.total).toBe(20)
    expect(res.data.hasMore).toBe(true)
  })

  it('投影仍是白名单八字段：供应商侧列不得外泄', async () => {
    requestMock.mockResolvedValue({
      orders: [{ ...row('o1'), provider_order_id: 'wx-secret', provider_sub_id: 'sub-secret', discount_cents: 100 }],
      total: 1,
      hasMore: false,
    })
    registerHandlers(ipcMain, buildDeps())

    const res = await ipcMain.call('wechat-pay:list-orders', {})

    expect(Object.keys(res.data.orders[0]).sort()).toEqual([
      'amount', 'createdAt', 'currency', 'id', 'paidAt', 'period', 'plan', 'status',
    ])
  })
})
