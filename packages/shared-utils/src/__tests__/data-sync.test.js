/**
 * F3 数据同步系统 — Vitest 单元测试
 *
 * 迁移自 manual-data-sync.js
 */
const DataSyncService = require('../data-sync')

// 模拟 Store（需提供 getSetting / setSetting）
class MockStore {
  constructor () {
    this.data = {}
  }
  setSetting (key, val) { this.data[key] = val }
  getSetting (key) { return this.data[key] || null }
}

describe('数据同步 / 数据格式', () => {
  test('sync 返回标准格式', () => {
    const service = new DataSyncService(new MockStore())
    const result = service._makeSyncResult('douyin', { views: 100 })
    expect(result.platform).toBe('douyin')
    expect(result.syncedAt).toBeTruthy()
    expect(typeof result.articles === 'number' || result.articles === undefined).toBe(true)
  })

  test('sync 失败返回错误格式', () => {
    const service = new DataSyncService(new MockStore())
    const result = service._makeErrorResult('douyin', '网络错误')
    expect(result.platform).toBe('douyin')
    expect(result.error).toBe('网络错误')
    expect(result.syncedAt).toBeTruthy()
  })
})

describe('数据同步 / 数据缓存', () => {
  test('缓存同步数据', () => {
    const store = new MockStore()
    const service = new DataSyncService(store)
    service._cacheData('douyin', service._makeSyncResult('douyin', { views: 100 }))
    const cached = service.getCachedData('douyin')
    expect(cached).toBeTruthy()
    expect(cached.views).toBe(100)
  })

  test('缓存过期返回 null', () => {
    const store = new MockStore()
    const service = new DataSyncService(store, { cacheTTL: -1 }) // 已过期
    service._cacheData('douyin', service._makeSyncResult('douyin', { views: 100 }))
    const cached = service.getCachedData('douyin')
    expect(cached).toBeNull()
  })

  test('未同步返回 null', () => {
    const service = new DataSyncService(new MockStore())
    expect(service.getCachedData('nonexistent')).toBeNull()
  })

  test('缓存结构缺少同步时间时返回 null', () => {
    const store = new MockStore()
    store.setSetting('sync_data_douyin', JSON.stringify({ platform: 'douyin', views: 100 }))
    const service = new DataSyncService(store)

    expect(service.getCachedData('douyin')).toBeNull()
  })
})

describe('数据同步 / 同步编排', () => {
  test('syncAll 返回数组', async () => {
    const service = new DataSyncService(new MockStore())
    // mock 同步器（syncAll 依据 _syncers 的键进行编排）
    service._syncers = {
      douyin: async () => service._makeSyncResult('douyin', { views: 100 }),
    }
    const results = await service.syncAll()
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(1)
  })

  test('单个平台失败不影响其他', async () => {
    const service = new DataSyncService(new MockStore())
    service._syncers = {
      fail: async () => { throw new Error('失败') },
      ok: async () => service._makeSyncResult('ok', { views: 50 }),
    }
    const results = await service.syncAll()
    expect(results.length).toBe(2)
    expect(results.find(r => r.error)).toBeTruthy()
    expect(results.find(r => !r.error && r.views === 50)).toBeTruthy()
  })
})

describe('数据同步 / 平台列表', () => {
  test('支持配置的5个平台', () => {
    const service = new DataSyncService(new MockStore())
    const platforms = service.getSupportedPlatforms()
    expect(platforms.length).toBeGreaterThanOrEqual(5)
    expect(platforms).toContain('douyin')
    expect(platforms).toContain('bilibili')
    expect(platforms).toContain('xiaohongshu')
    expect(platforms).toContain('tencent_video')
    expect(platforms).toContain('wechat_mp')
  })
})

/**
 * 假数据防线（2026-10-25，QM-5 回归保护）。
 *
 * 事故形态：`_rpaFetchStats()` 取不到真值时返回
 * `{articles:0, views:0, comments:0, likes:0, followers:0, _note:'RPA 不可用'}`，
 * 而它被 `_makeSyncResult()` 打上 `syncedAt: now` 写进缓存 ⇒
 * 数据页显示成「0阅读 / 0评论 / 0点赞 / 0粉丝 · 更新于 10:51」——
 * **看上去是刚采到的真数据，实际是常量 0**。
 *
 * 之所以必然发生：本服务跑在**主进程**（core/container.setup.js），
 * 而两条取数通路用的 `window.electronAPI` / `ipcRenderer` **只存在于渲染进程**；
 * 且 `rpa:fetchData` 这个 IPC 通道全仓没有任何 handler。
 *
 * ⇒ 判据：取不到真值时必须 **fail-loud**（抛错 → 转成带 error 的结果），
 *   绝不能产出一个「看起来像真数据」的 0 值记录。
 */
describe('数据同步 / 假数据防线（2026-10-25）', () => {
  test('取不到真值时抛错，不得返回一组 0', async () => {
    const service = new DataSyncService(new MockStore())
    // 主进程环境：window 不存在、ipcRenderer 不可用 ⇒ 必然落到兜底分支
    await expect(
      service._rpaFetchStats('douyin', 'https://creator.douyin.com/', '() => 1')
    ).rejects.toThrow(/采集通道未接入/)
  })

  test('syncAll 的失败结果带 error，且不含任何 0 值指标', async () => {
    const service = new DataSyncService(new MockStore())
    const results = await service.syncAll()
    expect(results.length).toBe(5)
    for (const r of results) {
      expect(r.error, `${r.platform} 应带 error`).toBeTruthy()
      // 关键：不能出现「看起来是真数据」的 0
      expect(r.views, `${r.platform} 不应带 views=0`).toBeUndefined()
      expect(r.comments, `${r.platform} 不应带 comments=0`).toBeUndefined()
      expect(r.likes, `${r.platform} 不应带 likes=0`).toBeUndefined()
      expect(r.followers, `${r.platform} 不应带 followers=0`).toBeUndefined()
      expect(r.articles, `${r.platform} 不应带 articles=0`).toBeUndefined()
    }
  })

  test('失败结果不会被当成可信数据写进缓存（渲染端据此不显示数字）', async () => {
    const store = new MockStore()
    const service = new DataSyncService(store)
    await service.syncAll()
    const cached = service.getAllCachedData()
    // 失败结果带 error ⇒ 渲染端的可信判据（无 error 且无遗留 _note 标记）会拒绝它
    for (const row of cached) {
      expect(row.error).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// 接线锁（2026-10-25）：契约层是叶子模块，**它的调用方必须自己锁住接线**。
// 只测 collector-contract 本身全绿，不能证明 data-sync 真的走了新路径。
// ---------------------------------------------------------------------------
describe('数据同步 / 采集契约的接线（调用方 e2e）', () => {
  const makeCollector = (result) => ({ collect: async () => result })

  test('注入执行体且返回合规数据 ⇒ 结果含该指标且无 error', async () => {
    const service = new DataSyncService(new MockStore(), {
      rpaViewManager: makeCollector({ ok: true, data: { views: 120, followers: 3400 } }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeUndefined()
    expect(result.followers).toBe(3400)
  })

  test('⛔ 执行体返回旧式裸对象 ⇒ 落 error，且**不产出任何数值字段**', async () => {
    const service = new DataSyncService(new MockStore(), {
      rpaViewManager: makeCollector({ views: 100, followers: 200 }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeTruthy()
    expect(result.followers).toBeUndefined()
    expect(result.views).toBeUndefined()
  })

  test('⛔ 未就绪 ⇒ 错误消息含 COLLECT_NOT_READY（能区分「页面没加载」与「选择器过期」）', async () => {
    const service = new DataSyncService(new MockStore(), {
      rpaViewManager: makeCollector({ ok: false, reason: 'not-ready' }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('COLLECT_NOT_READY')
  })

  test('⛔ 字段缺失 ⇒ 错误消息含 COLLECT_FIELD_MISSING 与字段名', async () => {
    const service = new DataSyncService(new MockStore(), {
      rpaViewManager: makeCollector({ ok: false, reason: 'missing', field: 'followers' }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('COLLECT_FIELD_MISSING')
    expect(result.error).toContain('followers')
  })

  test('⛔ 平台归属不符 ⇒ 错误消息含 COLLECT_PLATFORM_MISMATCH', async () => {
    const service = new DataSyncService(new MockStore(), {
      rpaViewManager: makeCollector({ ok: true, data: { platform: 'bilibili', followers: 10 } }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('COLLECT_PLATFORM_MISMATCH')
  })

  test('⛔ 没有注入执行体 ⇒ fail-loud，且结果里**没有任何数值字段**（PR #4435 纪律的回归锁）', async () => {
    const service = new DataSyncService(new MockStore())
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeTruthy()
    expect(result.followers).toBeUndefined()
    expect(result.views).toBeUndefined()
    expect(result.articles).toBeUndefined()
  })

  test('⛔ 执行体抛错 ⇒ 落 error，不产出数值字段', async () => {
    const service = new DataSyncService(new MockStore(), {
      rpaViewManager: { collect: async () => { throw new Error('window destroyed') } },
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeTruthy()
    expect(result.followers).toBeUndefined()
  })
})
