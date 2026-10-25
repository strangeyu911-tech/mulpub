// @ts-check
/**
 * RpaViewManager collector mixin — 账号级数据采集通道
 *
 * 锁住四件事（2026-10-25，PR-1 第 2 刀）：
 *   1. 窗口池复用：新窗口才注入登录态，复用窗口**不重复注入**；
 *   2. 轮询语义：「未就绪」继续等，「字段缺/值非法」立刻停（再等也没用）；
 *   3. 超时分类：错误消息带契约错误码（界面据此区分「没加载」与「选择器过期」）；
 *   4. 失败**绝不**产出数值：采集失败时窗口不入池（状态不可信）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let collectorMixin

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  collectorMixin = require('./rpa-view-collector')
})

/** 假窗口：脚本按顺序返回预设观测；用尽后重复最后一个（模拟「页面一直那个状态」） */
function createWin (scriptResults) {
  let index = 0
  const win = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    destroy: () => { win.destroyed = true },
    webContents: {
      loadURL: vi.fn(async () => {}),
      executeJavaScript: vi.fn(async () => {
        const next = scriptResults[Math.min(index++, scriptResults.length - 1)]
        if (next instanceof Error) throw next
        return next
      }),
    },
  }
  return win
}

/** 假 manager：mixin 本体 + 只提供 session/helper 那几个方法的替身 */
function createManager (win, reused) {
  return Object.assign({}, collectorMixin, {
    _acquireWindow: vi.fn(() => ({ win, reused: reused === true })),
    _restoreCookies: vi.fn(async () => {}),
    _restoreAuthPartitionCookies: vi.fn(async () => 0),
    _restoreBrowserStorage: vi.fn(async () => {}),
    _releaseWindow: vi.fn(async () => {}),
    _sleep: vi.fn(async () => {}),
  })
}

const OK_OBS = { ok: true, data: { platform: 'douyin', followers: 12000, views: 340 } }

describe('rpa-view-collector — 采集成功路径', () => {
  it('脚本返回合规观测 ⇒ 原样返回，并释放窗口（healthy=true）', async () => {
    const win = createWin([OK_OBS])
    const manager = createManager(win, false)
    const raw = await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })
    expect(raw).toEqual(OK_OBS)
    expect(manager._releaseWindow).toHaveBeenCalledWith('douyin', 'acct-1', win, true)
  })

  it('新建窗口 ⇒ 注入该账号的登录态（cookie / 分区 cookie / localStorage）', async () => {
    const win = createWin([OK_OBS])
    const manager = createManager(win, false)
    const authData = { cookies: [{ name: 'sid', value: 'x' }], localStorage: { a: 'b' } }
    await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
      authData,
    })
    expect(manager._restoreCookies).toHaveBeenCalledWith(win, authData.cookies, 'douyin')
    expect(manager._restoreAuthPartitionCookies).toHaveBeenCalledWith(win, 'douyin', 'acct-1')
    expect(manager._restoreBrowserStorage).toHaveBeenCalledWith(win, 'douyin', authData)
  })

  it('⛔ 复用池内窗口 ⇒ 不重复注入登录态（partition 已带登录态，重复恢复是纯浪费）', async () => {
    const win = createWin([OK_OBS])
    const manager = createManager(win, true)
    await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
      authData: { cookies: [{ name: 'sid', value: 'x' }], localStorage: {} },
    })
    expect(manager._restoreCookies).not.toHaveBeenCalled()
    expect(manager._restoreAuthPartitionCookies).not.toHaveBeenCalled()
    expect(manager._restoreBrowserStorage).not.toHaveBeenCalled()
  })

  it('采集前先导航到创作者后台', async () => {
    const win = createWin([OK_OBS])
    const manager = createManager(win, false)
    await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })
    expect(win.webContents.loadURL).toHaveBeenCalledWith('https://creator.douyin.com/')
  })
})

describe('rpa-view-collector — 轮询与失败分类', () => {
  const originalTimeout = process.env.MP_COLLECT_TIMEOUT_MS
  const originalInterval = process.env.MP_COLLECT_INTERVAL_MS

  beforeEach(() => {
    process.env.MP_COLLECT_TIMEOUT_MS = '50'
    process.env.MP_COLLECT_INTERVAL_MS = '1'
  })

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.MP_COLLECT_TIMEOUT_MS
    else process.env.MP_COLLECT_TIMEOUT_MS = originalTimeout
    if (originalInterval === undefined) delete process.env.MP_COLLECT_INTERVAL_MS
    else process.env.MP_COLLECT_INTERVAL_MS = originalInterval
  })

  it('未就绪 ⇒ 继续轮询，直到取到', async () => {
    const win = createWin([{ ok: false, reason: 'not-ready' }, { ok: false, reason: 'not-ready' }, OK_OBS])
    const manager = createManager(win, false)
    const raw = await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })
    expect(raw).toEqual(OK_OBS)
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(3)
    expect(manager._sleep).toHaveBeenCalled()
  })

  it('⛔ 字段缺失 ⇒ 立刻停（不再轮询），并把失败窗口判为不健康', async () => {
    const win = createWin([{ ok: false, reason: 'missing', field: 'followers' }])
    const manager = createManager(win, false)
    const raw = await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })
    expect(raw.ok).toBe(false)
    expect(raw.reason).toBe('missing')
    expect(raw.field).toBe('followers')
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(manager._releaseWindow).toHaveBeenCalledWith('douyin', 'acct-1', win, false)
  })

  it('⛔ 值不可解析 ⇒ 立刻停（同样不健康）', async () => {
    const win = createWin([{ ok: false, reason: 'invalid', field: 'followers' }])
    const manager = createManager(win, false)
    const raw = await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })
    expect(raw.reason).toBe('invalid')
    expect(manager._releaseWindow).toHaveBeenCalledWith('douyin', 'acct-1', win, false)
  })

  it('⛔ 一直未就绪 ⇒ 超时抛错，消息带契约错误码（区分「没加载」与「选择器过期」）', async () => {
    const win = createWin([{ ok: false, reason: 'not-ready' }, { ok: false, reason: 'not-ready' }])
    const manager = createManager(win, false)
    await expect(collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })).rejects.toThrow(/COLLECT_NOT_READY/)
    expect(manager._releaseWindow).toHaveBeenCalledWith('douyin', 'acct-1', win, false)
  })

  it('⛔ 脚本执行抛错（页面还没准备好）⇒ 当作未就绪继续等', async () => {
    const win = createWin([new Error('Script failed to execute'), OK_OBS])
    const manager = createManager(win, false)
    const raw = await collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })
    expect(raw).toEqual(OK_OBS)
  })

  it('⛔ 窗口已销毁 ⇒ 立刻抛错（再等也不会有结果）', async () => {
    const win = createWin([new Error('Script failed to execute')])
    win.destroyed = true
    const manager = createManager(win, false)
    await expect(collectorMixin.collect.call(manager, 'douyin', 'acct-1', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })).rejects.toThrow(/窗口已销毁/)
  })
})

describe('rpa-view-collector — 参数校验', () => {
  it('⛔ 缺 url ⇒ 抛错（不许拿空地址去导航）', async () => {
    const win = createWin([OK_OBS])
    const manager = createManager(win, false)
    await expect(collectorMixin.collect.call(manager, 'douyin', 'acct-1', { script: '() => 1' }))
      .rejects.toThrow(/缺少采集地址/)
  })

  it('⛔ 缺脚本 ⇒ 抛错', async () => {
    const win = createWin([OK_OBS])
    const manager = createManager(win, false)
    await expect(collectorMixin.collect.call(manager, 'douyin', 'acct-1', { url: 'https://x/' }))
      .rejects.toThrow(/缺少抽取脚本/)
  })

  it('⛔ 缺账号 ⇒ 抛错（登录态是账号级的，不给账号就等于让不同账号共用同一个窗口分区）', async () => {
    const win = createWin([OK_OBS])
    const manager = createManager(win, false)
    await expect(collectorMixin.collect.call(manager, 'douyin', '', {
      url: 'https://creator.douyin.com/',
      script: '() => 1',
    })).rejects.toThrow(/缺少账号/)
    expect(manager._acquireWindow).not.toHaveBeenCalled()
  })
})

describe('rpa-view-collector — 环境变量口径', () => {
  it('非法 MP_COLLECT_TIMEOUT_MS ⇒ 回落默认（不出声吞掉）', () => {
    const original = process.env.MP_COLLECT_TIMEOUT_MS
    process.env.MP_COLLECT_TIMEOUT_MS = 'abc'
    expect(collectorMixin.resolveCollectTimeoutMs()).toBe(30000)
    if (original === undefined) delete process.env.MP_COLLECT_TIMEOUT_MS
    else process.env.MP_COLLECT_TIMEOUT_MS = original
  })

  it('合法 MP_COLLECT_TIMEOUT_MS ⇒ 采用配置值', () => {
    const original = process.env.MP_COLLECT_TIMEOUT_MS
    process.env.MP_COLLECT_TIMEOUT_MS = '1234'
    expect(collectorMixin.resolveCollectTimeoutMs()).toBe(1234)
    if (original === undefined) delete process.env.MP_COLLECT_TIMEOUT_MS
    else process.env.MP_COLLECT_TIMEOUT_MS = original
  })
})
