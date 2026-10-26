// @ts-check
/**
 * 绑定账号数上限（v3.1 主计量轴）— 主进程 IPC 判据
 *
 * 覆盖：
 * - account:add 在达到 max_accounts 时拒绝，且不调用 AccountManager.addAccount
 * - auth:open-login 在达到上限时**不打开登录页**
 * - 重新登录（带 accountId）不受上限影响
 * - 打开登录页后、保存前数量被其他窗口推高时，保存前二次判据仍会拒绝
 * - entitlement / limits 缺失时放行（缺失即放行，不误拦付费用户）
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

__enableElectronMock()

let registerHandlers
let originalNodeEnv
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./account')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    on: vi.fn(),
    _get: (channel) => handlers[channel],
  }
}

function identityWith (limits) {
  return {
    getState: vi.fn(() => ({
      status: 'authenticated',
      user: { sub: 'user-1' },
      entitlement: limits === undefined ? null : { plan: 'free', limits },
    })),
  }
}

function createMockDeps(overrides = {}) {
  return {
    authViewManager: {
      openLogin: vi.fn(async () => ({ cookies: [{ name: 'sid', value: 'x' }], name: '测试账号' })),
      completeLogin: vi.fn(),
      loginSilent: vi.fn(),
      close: vi.fn(),
    },
    pythonBridge: { requestBackend: vi.fn() },
    AccountManager: {
      addAccount: vi.fn(async () => ({ id: 'acc-new', platform: 'wechat_mp' })),
      saveCapturedAccount: vi.fn(async () => ({ id: 'acc-new', platform: 'wechat_mp' })),
      updateCapturedAccount: vi.fn(async () => ({ id: 'acc-old', platform: 'wechat_mp' })),
      deleteAccount: vi.fn(),
      listAccounts: vi.fn(async () => []),
      checkLoginStatus: vi.fn(),
      loadSavedCredentials: vi.fn(),
      setAccountProxy: vi.fn(),
      getAccountProxyStatus: vi.fn(() => ({ configured: false })),
      checkLocalCredentials: vi.fn(() => false),
      persistLoginState: vi.fn(async () => ({ ok: true })),
    },
    BACKEND_PLATFORMS: new Set(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    store: { getSetting: vi.fn(), setSetting: vi.fn() },
    identityService: identityWith({ max_accounts: 5 }),
    ...overrides,
  }
}

async function call (deps, channel, arg) {
  const ipcMain = createMockIpcMain()
  registerHandlers(ipcMain, deps)
  return ipcMain._get(channel)(TRUSTED_EVENT, arg)
}

const fiveAccounts = Array.from({ length: 5 }, (_, i) => ({ id: 'acc-' + i, platform: 'wechat_mp' }))

describe('account:add — max_accounts 判据', () => {
  it('达到上限时拒绝，且不调用 AccountManager.addAccount', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue(fiveAccounts)
    const result = await call(deps, 'account:add', 'wechat_mp')

    expect(result.code).toBe(-30)
    expect(result.errorCode).toBe('ACCOUNT_LIMIT_EXCEEDED')
    expect(result.data).toEqual({ current: 5, limit: 5 })
    expect(deps.AccountManager.addAccount).not.toHaveBeenCalled()
  })

  it('未达上限时放行', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue(fiveAccounts.slice(0, 4))
    const result = await call(deps, 'account:add', 'wechat_mp')

    expect(result.code).toBe(0)
    expect(deps.AccountManager.addAccount).toHaveBeenCalledWith('wechat_mp')
  })

  it('entitlement 缺失时放行（缺失即放行，不误拦付费用户）', async () => {
    const deps = createMockDeps({ identityService: identityWith(undefined) })
    deps.AccountManager.listAccounts.mockResolvedValue(fiveAccounts)
    const result = await call(deps, 'account:add', 'wechat_mp')

    expect(result.code).toBe(0)
    expect(deps.AccountManager.addAccount).toHaveBeenCalled()
  })
})

describe('auth:open-login — max_accounts 判据', () => {
  it('达到上限时不打开登录页', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue(fiveAccounts)
    const result = await call(deps, 'auth:open-login', { platform: 'wechat_mp' })

    expect(result.code).toBe(-30)
    expect(result.errorCode).toBe('ACCOUNT_LIMIT_EXCEEDED')
    expect(deps.authViewManager.openLogin).not.toHaveBeenCalled()
  })

  it('重新登录（带 accountId）不受上限影响', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue(fiveAccounts)
    const result = await call(deps, 'auth:open-login', { platform: 'wechat_mp', accountId: 'acc-old' })

    expect(result.code).toBe(0)
    expect(deps.AccountManager.updateCapturedAccount).toHaveBeenCalled()
    expect(deps.AccountManager.saveCapturedAccount).not.toHaveBeenCalled()
  })

  it('打开登录页后数量被其他窗口推高时，保存前二次判据拒绝', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts
      .mockResolvedValueOnce(fiveAccounts.slice(0, 4))
      .mockResolvedValueOnce(fiveAccounts)
    const result = await call(deps, 'auth:open-login', { platform: 'wechat_mp' })

    expect(result.code).toBe(-30)
    expect(result.errorCode).toBe('ACCOUNT_LIMIT_EXCEEDED')
    expect(deps.AccountManager.saveCapturedAccount).not.toHaveBeenCalled()
  })
})
