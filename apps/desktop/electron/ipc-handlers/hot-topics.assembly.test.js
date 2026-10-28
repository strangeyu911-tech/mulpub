// @ts-check
/**
 * 装配冒烟测试：ipc-handlers/index.js → hot-topics.js 的 require 调用链。
 * 回归背景：hot-topics.js 曾导出 { registerHandlers } 对象而非函数，
 * index.js 直接调用 require('./hot-topics')(ipcMain, deps) 抛 TypeError，
 * 导致其后 9 个模块 IPC 注册全部中断（测试全绿但启动即崩）。
 */
import { describe, it, expect, vi } from 'vitest'

describe('ipc-handlers assembly: hot-topics', () => {
  it('index.js requires hot-topics as a callable function', async () => {
    const mod = await import('./hot-topics.js')
    expect(typeof mod.default === 'function' || typeof mod === 'function').toBe(true)
  })

  it('registerHandlers warns and skips when hotTopicsService missing (does not break other modules)', async () => {
    const register = (await import('./hot-topics.js')).default || (await import('./hot-topics.js'))
    const fakeIpc = { handle: vi.fn() }
    const warned = []
    register(fakeIpc, { log: { warn: (m) => warned.push(m) } })
    expect(fakeIpc.handle).not.toHaveBeenCalled()
    expect(warned.some(m => String(m).includes('hotTopicsService'))).toBe(true)
  })

  it('registerHandlers registers all 5 channels when service present', async () => {
    const register = (await import('./hot-topics.js')).default || (await import('./hot-topics.js'))
    const fakeIpc = { handle: vi.fn() }
    const fakeService = { fetchTopics: vi.fn(), getCache: vi.fn() }
    const fakeStore = { getUserSetting: vi.fn(() => []), setUserSetting: vi.fn() }
    register(fakeIpc, { hotTopicsService: fakeService, store: fakeStore })
    const channels = fakeIpc.handle.mock.calls.map(c => c[0])
    expect(channels).toContain('hot-topics:fetch')
    expect(channels).toContain('hot-topics:get-cache')
    expect(channels).toContain('hot-topics:favorite-add')
    expect(channels).toContain('hot-topics:favorite-remove')
    expect(channels).toContain('hot-topics:favorite-list')
  })
})

describe('收藏投影的判别位（QM-6 轮1 指控 i1 的回归锁）', () => {
  // 走真入口 hot-topics:favorite-add 并断言**实际落盘的那份 topic**，而不是直接调内部 _sanitizeTopic：
  // 后者会让「入口忘了投影」这一类缺陷照测不到（AGENTS「测试断言不得反向固化错误行为」同族）。
  async function addFavorite (rawTopic) {
    const mod = await import('./hot-topics.js')
    const register = mod.default || mod
    const handlers = new Map()
    let written = null
    register({ handle: (ch, fn) => handlers.set(ch, fn) }, {
      hotTopicsService: { fetchTopics: async () => ({ topics: [], fetchedAt: 0, channelStats: {} }), getCache: () => ({ topics: [], fetchedAt: 0 }) },
      store: { getUserSetting: () => [], setUserSetting: (_k, v) => { written = v } },
      identityService: { getState: () => ({ user: { sub: 'sub-lock' } }) },
      log: { info() {}, warn() {}, error() {}, notify() {} },
    })
    const r = await handlers.get('hot-topics:favorite-add')({}, { topic: { id: 't1', ...rawTopic } })
    return { code: r.code, written: written || [] }
  }

  it('kind 缺席时读作 topic（既有合同，不得改）', async () => {
    const { code, written } = await addFavorite({ topic: '甲' })
    expect(code).toBe(0)
    expect(written).toHaveLength(1)
    expect(written[0].topic.kind).toBe('topic')
  })

  it('kind 存在但非法时原样保留，不被消费层修成 topic', async () => {
    const { written } = await addFavorite({ topic: '乙', kind: 'video' })
    expect(written[0].topic.kind, '被修成 topic 即 Requirement 1 失守').toBe('video')
  })

  it('kind 为非字符串（数字）时同样原样保留', async () => {
    const { written } = await addFavorite({ topic: '丙', kind: 42 })
    expect(written[0].topic.kind).toBe(42)
  })

  it('非法 kind 落盘后仍被资格判据判红：KIND_INVALID 才是可归因症状', async () => {
    const { validateEntry } = await import('../services/hot-topics/item-model.js')
    const { written } = await addFavorite({ topic: '丁', kind: 'video' })
    expect(validateEntry(written[0].topic).reason).toBe('KIND_INVALID')
  })
})
