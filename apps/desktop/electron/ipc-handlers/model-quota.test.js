// @vitest-environment node
'use strict'

vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

__enableElectronMock()

let registerHandlers

beforeAll(async () => {
  const mod = await import('./model-quota')
  registerHandlers = mod.default || mod
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    _call: async (channel, ...args) => handlers[channel]({ sender: { send: vi.fn() } }, ...args),
  }
}

function makeDeps (overrides = {}) {
  const rows = overrides.rows || {}
  const store = {
    getSetting: vi.fn((key) => (key in rows ? rows[key] : null)),
    setSetting: vi.fn((key, value) => { rows[key] = value }),
  }
  const coordinator = { userDecision: vi.fn(() => true) }
  return {
    store,
    log: { error: vi.fn(), warn: vi.fn() },
    modelQuotaCoordinator: coordinator,
    modelQuotaSwitchBack: vi.fn(() => true),
    officialStatusProvider: { getStatus: vi.fn(async () => ({ available: false, reason: 'not_configured', balance: null, currency: 'credit' })) },
    ...overrides,
  }
}

describe('model-quota IPC', () => {
  it('get-policy 返回归一后的默认值 + 官方状态', async () => {
    const ipc = createMockIpcMain()
    registerHandlers(ipc, makeDeps())
    const res = await ipc._call('model-quota:get-policy')
    expect(res.code).toBe(0)
    expect(res.data).toMatchObject({ policy: 'ask', cap: 500, official: { available: false, reason: 'not_configured' } })
  })

  it('get-policy 读取已保存值', async () => {
    const ipc = createMockIpcMain()
    registerHandlers(ipc, makeDeps({ rows: { modelQuotaFallbackPolicy: 'byok', officialCreditCapPerTask: 1200 } }))
    const res = await ipc._call('model-quota:get-policy')
    expect(res.data).toMatchObject({ policy: 'byok', cap: 1200 })
  })

  it('set-policy 校验并写入两个设置键', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps()
    registerHandlers(ipc, deps)
    const res = await ipc._call('model-quota:set-policy', { policy: 'official', cap: 800 })
    expect(res).toEqual({ code: 0, data: { policy: 'official', cap: 800 } })
    expect(deps.store.setSetting).toHaveBeenCalledWith('modelQuotaFallbackPolicy', 'official')
    expect(deps.store.setSetting).toHaveBeenCalledWith('officialCreditCapPerTask', 800)
  })

  it('set-policy 非法值返回 VALIDATION_ERROR 且不写', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps()
    registerHandlers(ipc, deps)
    const res = await ipc._call('model-quota:set-policy', { policy: 'AUTO', cap: 0 })
    expect(res.code).toBe(-2)
    expect(deps.store.setSetting).not.toHaveBeenCalled()
  })

  it('decide 委托 coordinator.userDecision，未知 requestId 返回 NOT_FOUND', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps()
    registerHandlers(ipc, deps)
    const ok = await ipc._call('model-quota:decide', { requestId: 'r1', decision: 'official' })
    expect(ok.code).toBe(0)
    expect(deps.modelQuotaCoordinator.userDecision).toHaveBeenCalledWith({ requestId: 'r1', decision: 'official' })
    deps.modelQuotaCoordinator.userDecision.mockReturnValueOnce(false)
    const missing = await ipc._call('model-quota:decide', { requestId: 'r2', decision: 'cancel' })
    expect(missing.code).toBe(-10)
  })

  it('decide 拒绝不在枚举内的 decision', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps()
    registerHandlers(ipc, deps)
    const res = await ipc._call('model-quota:decide', { requestId: 'r1', decision: 'admin' })
    expect(res.code).toBe(-2)
    expect(deps.modelQuotaCoordinator.userDecision).not.toHaveBeenCalled()
  })

  it('switch-back 委托注入函数', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps()
    registerHandlers(ipc, deps)
    const res = await ipc._call('model-quota:switch-back', { runId: 'run-1', capability: 'image' })
    expect(res.code).toBe(0)
    expect(deps.modelQuotaSwitchBack).toHaveBeenCalledWith({ runId: 'run-1', capability: 'image' })
  })

  it('switch-back 等待异步 false 并返回 NOT_FOUND', async () => {
    const ipc = createMockIpcMain()
    const deps = makeDeps({ modelQuotaSwitchBack: vi.fn(async () => false) })
    registerHandlers(ipc, deps)
    const res = await ipc._call('model-quota:switch-back', { runId: 'run-1', capability: 'image' })
    expect(res.code).toBe(-10)
    expect(res.message).toContain('不存在')
  })

  it('store 不可用时 set-policy 返回 REQUEST_ERROR', async () => {
    const ipc = createMockIpcMain()
    registerHandlers(ipc, makeDeps({ store: null }))
    const res = await ipc._call('model-quota:set-policy', { policy: 'ask', cap: 500 })
    expect(res.code).toBe(-1)
  })

  it('官方状态非法时降级：可用但余额非法 → balance_unavailable', async () => {
    const ipc = createMockIpcMain()
    registerHandlers(ipc, makeDeps({
      officialStatusProvider: { getStatus: vi.fn(async () => ({ available: true, reason: 'ok', balance: -5 })) },
    }))
    const res = await ipc._call('model-quota:get-policy')
    expect(res.data.official).toEqual({ available: false, reason: 'balance_unavailable', balance: null, currency: 'credit' })
  })

  it('第二个设置写失败时回滚第一个键', async () => {
    const ipc = createMockIpcMain()
    const rows = { modelQuotaFallbackPolicy: 'ask', officialCreditCapPerTask: 500 }
    let writes = 0
    const store = {
      getSetting: (key) => rows[key],
      setSetting: (key, value) => {
        writes += 1
        if (writes === 2) throw new Error('disk full')
        rows[key] = value
      },
    }
    registerHandlers(ipc, makeDeps({ store }))
    const res = await ipc._call('model-quota:set-policy', { policy: 'official', cap: 800 })
    expect(res.code).toBe(-1)
    expect(rows.modelQuotaFallbackPolicy).toBe('ask')
  })
})
