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
    // ⚠️ 2026-10-25（PR-1 第 2 刀）：签名改为 (platform, account, payload)
    //   —— 采集必须绑定账号（登录态是账号级的）。
    await expect(
      service._rpaFetchStats(
        'douyin',
        { accountId: 'acct-1' },
        { url: 'https://creator.douyin.com/', script: '() => 1' }
      )
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
//
// ⚠️ 2026-10-25（PR-1 第 2 刀）改动说明：
//   执行体的调用签名从 `collect(platform, {url, script})` 变成
//   `collect(platform, accountId, {url, script, authData})`，
//   并且采集前**必须先解析出已登录账号**（否则零请求、记 skipped）。
//   ⇒ 下面这些用例的**注入内容**变了（多注入一个 resolveAccount），
//     但**断言语义一条没改**（仍然是「契约分型落到 error」「不产出数值字段」）。
// ---------------------------------------------------------------------------
describe('数据同步 / 采集契约的接线（调用方 e2e）', () => {
  const makeCollector = (result) => ({ collect: async () => result })
  // 已登录账号解析器（主进程注入；仓内约定 = store.getDefaultAccount(platform)）
  const withAccount = () => ({ accountId: 'acct-1', authData: { cookies: [], localStorage: {} } })
  const makeService = (opts) => new DataSyncService(new MockStore(), {
    resolveAccount: async () => withAccount(),
    ...opts,
  })

  test('注入执行体且返回合规数据 ⇒ 结果含该指标且无 error', async () => {
    const service = makeService({
      rpaViewManager: makeCollector({ ok: true, data: { views: 120, followers: 3400 } }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeUndefined()
    expect(result.followers).toBe(3400)
  })

  test('⛔ 执行体返回旧式裸对象 ⇒ 落 error，且**不产出任何数值字段**', async () => {
    const service = makeService({
      rpaViewManager: makeCollector({ views: 100, followers: 200 }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeTruthy()
    expect(result.followers).toBeUndefined()
    expect(result.views).toBeUndefined()
  })

  test('⛔ 未就绪 ⇒ 错误消息含 COLLECT_NOT_READY（能区分「页面没加载」与「选择器过期」）', async () => {
    const service = makeService({
      rpaViewManager: makeCollector({ ok: false, reason: 'not-ready' }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('COLLECT_NOT_READY')
  })

  test('⛔ 字段缺失 ⇒ 错误消息含 COLLECT_FIELD_MISSING 与字段名', async () => {
    const service = makeService({
      rpaViewManager: makeCollector({ ok: false, reason: 'missing', field: 'followers' }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('COLLECT_FIELD_MISSING')
    expect(result.error).toContain('followers')
  })

  test('⛔ 值不可解析 ⇒ 错误消息含 COLLECT_VALUE_INVALID 与字段名', async () => {
    const service = makeService({
      rpaViewManager: makeCollector({ ok: false, reason: 'invalid', field: 'followers' }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('COLLECT_VALUE_INVALID')
    expect(result.error).toContain('followers')
  })

  test('⛔ 平台归属不符 ⇒ 错误消息含 COLLECT_PLATFORM_MISMATCH', async () => {
    const service = makeService({
      rpaViewManager: makeCollector({ ok: true, data: { platform: 'bilibili', followers: 10 } }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('COLLECT_PLATFORM_MISMATCH')
  })

  test('⛔ 没有注入执行体 ⇒ fail-loud，且结果里**没有任何数值字段**（PR #4435 纪律的回归锁）', async () => {
    const service = makeService({})
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeTruthy()
    expect(result.followers).toBeUndefined()
    expect(result.views).toBeUndefined()
    expect(result.articles).toBeUndefined()
  })

  test('⛔ 执行体抛错 ⇒ 落 error，不产出数值字段', async () => {
    const service = makeService({
      rpaViewManager: { collect: async () => { throw new Error('window destroyed') } },
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toBeTruthy()
    expect(result.followers).toBeUndefined()
  })

  test('账号归属写进记录（供 UI 标注「这条是哪个账号采的」）', async () => {
    const service = makeService({
      rpaViewManager: makeCollector({ ok: true, data: { followers: 3400 } }),
    })
    const result = await service.syncPlatform('douyin')
    expect(result.accountId).toBe('acct-1')
    expect(result.followers).toBe(3400)
  })

  test('⛔ 执行体收到的 accountId 与解析出的账号一致（登录态不能串号）', async () => {
    const seen = []
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => ({ accountId: 'acct-42', authData: { cookies: [{ name: 'a', value: 'b' }] } }),
      rpaViewManager: { collect: async (platform, accountId, payload) => { seen.push({ platform, accountId, payload }); return { ok: true, data: { followers: 1 } } } },
    })
    await service.syncPlatform('douyin')
    expect(seen).toHaveLength(1)
    expect(seen[0].platform).toBe('douyin')
    expect(seen[0].accountId).toBe('acct-42')
    expect(seen[0].payload.url).toMatch(/^https:\/\//)
    expect(typeof seen[0].payload.script).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// 节流 / 并发 / 账号（PR-1 第 2 刀，PRD §四 判据 5-7、§五 5.2、验收 #4-#7）
// ---------------------------------------------------------------------------
describe('数据同步 / 节流（零请求）', () => {
  const okCollector = () => ({ collect: async () => ({ ok: true, data: { followers: 100 } }) })

  test('⛔ 距上次采集 < 最小间隔 ⇒ 执行体零调用（不是「少调用」）', async () => {
    let calls = 0
    let clock = Date.parse('2026-10-25T10:00:00Z')
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      minCollectIntervalMs: 30 * 60 * 1000,
      now: () => clock,
      rpaViewManager: { collect: async () => { calls += 1; return { ok: true, data: { followers: 100 } } } },
    })
    // 第一次：采集 ⇒ 落缓存（syncedAt = 10:00:00.000）
    await service.syncPlatform('douyin')
    expect(calls).toBe(1)
    // 第二次（1 秒后，仍在 30 分钟最小间隔内）⇒ 节流命中 ⇒ 零请求，返回同一条缓存
    clock += 1000
    const again = await service.syncPlatform('douyin')
    expect(calls).toBe(1)
    expect(again.followers).toBe(100)
    expect(again.error).toBeUndefined()
  })

  test('同一时刻重复调用 ⇒ 允许再采一次（时钟没前进 ⇒ 无法判断真实间隔，安全侧先采）', async () => {
    // ⚠️ 这是契约层刻意定的语义（`isCollectDue`：now <= last ⇒ 允许采集），
    //    目的是**时钟回拨/冻结时不得永久停在旧值**。
    //    代价：同一毫秒内的重复调用不会被节流（多一次请求，量级可忽略）。
    let calls = 0
    const clock = Date.parse('2026-10-25T10:00:00Z')
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      minCollectIntervalMs: 30 * 60 * 1000,
      now: () => clock,
      rpaViewManager: { collect: async () => { calls += 1; return { ok: true, data: { followers: 100 } } } },
    })
    await service.syncPlatform('douyin')
    await service.syncPlatform('douyin')
    expect(calls).toBe(2)
  })

  test('超过最小间隔 ⇒ 允许再次采集', async () => {
    let calls = 0
    let clock = Date.parse('2026-10-25T10:00:00Z')
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      minCollectIntervalMs: 30 * 60 * 1000,
      now: () => clock,
      rpaViewManager: { collect: async () => { calls += 1; return { ok: true, data: { followers: 100 } } } },
    })
    await service.syncPlatform('douyin')
    clock += 31 * 60 * 1000
    await service.syncPlatform('douyin')
    expect(calls).toBe(2)
  })

  test('⛔ 时钟回拨（now < 上次采集时刻）⇒ 允许重新采集（不得永久静默停止）', async () => {
    let calls = 0
    let clock = Date.parse('2026-10-25T10:00:00Z')
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      minCollectIntervalMs: 30 * 60 * 1000,
      now: () => clock,
      rpaViewManager: { collect: async () => { calls += 1; return { ok: true, data: { followers: 100 } } } },
    })
    await service.syncPlatform('douyin')
    clock = Date.parse('2026-10-25T09:00:00Z') // 时钟被改回
    await service.syncPlatform('douyin')
    expect(calls).toBe(2)
  })

  test('⛔ 缓存里的时间戳坏了 ⇒ 当作「从未采集」⇒ 允许采集（不得静默停在旧值）', async () => {
    let calls = 0
    const store = new MockStore()
    store.setSetting('sync_data_douyin', JSON.stringify({ platform: 'douyin', syncedAt: 'not-a-date', followers: 7 }))
    const service = new DataSyncService(store, {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      rpaViewManager: { collect: async () => { calls += 1; return { ok: true, data: { followers: 100 } } } },
    })
    await service.syncPlatform('douyin')
    expect(calls).toBe(1)
  })

  test('⛔ 采集失败也算一次尝试 ⇒ 最小间隔内不再轰炸平台', async () => {
    let calls = 0
    let clock = Date.parse('2026-10-25T10:00:00Z')
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      minCollectIntervalMs: 30 * 60 * 1000,
      now: () => clock,
      rpaViewManager: { collect: async () => { calls += 1; return { ok: false, reason: 'missing', field: 'followers' } } },
    })
    const first = await service.syncPlatform('douyin')
    expect(first.error).toContain('COLLECT_FIELD_MISSING')
    clock += 1000
    const second = await service.syncPlatform('douyin')
    expect(calls).toBe(1)
    expect(second.error).toContain('COLLECT_FIELD_MISSING')
  })

  test('最小间隔可经仓内 settings 配置（未配置时回落 30 分钟，不得被 Number(null)=0 关掉）', async () => {
    const store = new MockStore()
    const service = new DataSyncService(store, { resolveAccount: async () => null })
    expect(service._minIntervalMs()).toBe(30 * 60 * 1000)
    store.setSetting('sync_collect_min_interval_ms', '600000')
    expect(service._minIntervalMs()).toBe(600000)
  })

  test('⛔ 时钟给出非法值 ⇒ syncedAt 不得变成 "Invalid Date"', async () => {
    const service = new DataSyncService(new MockStore(), { now: () => Number.NaN })
    const result = service._makeSyncResult('douyin', { views: 1 })
    expect(result.syncedAt).not.toContain('Invalid')
    expect(Number.isFinite(Date.parse(result.syncedAt))).toBe(true)
  })
})

describe('数据同步 / 全局采集并发恒为 1', () => {
  test('⛔ syncAll 5 个平台并发发起 ⇒ 同一时刻至多 1 个采集在途', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      rpaViewManager: {
        collect: async () => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 5))
          inFlight -= 1
          return { ok: true, data: { followers: 1 } }
        },
      },
    })
    const results = await service.syncAll()
    expect(results).toHaveLength(5)
    expect(maxInFlight).toBe(1)
  })
})

describe('数据同步 / 账号归属（无账号 ⇒ 零请求）', () => {
  test('⛔ 无已登录账号 ⇒ 执行体零调用 + skipped(no-account) + 不落任何数值', async () => {
    let calls = 0
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => null,
      rpaViewManager: { collect: async () => { calls += 1; return { ok: true, data: { followers: 100 } } } },
    })
    const result = await service.syncPlatform('douyin')
    expect(calls).toBe(0)
    expect(result.skipped).toBe('no-account')
    expect(result.error).toBeUndefined()
    expect(result.followers).toBeUndefined()
    expect(result.views).toBeUndefined()
  })

  test('⛔ 无账号的记录**不落缓存**（用户刚登录完就该能采到，不得被节流住）', async () => {
    const store = new MockStore()
    const service = new DataSyncService(store, {
      resolveAccount: async () => null,
      rpaViewManager: { collect: async () => ({ ok: true, data: { followers: 100 } }) },
    })
    await service.syncPlatform('douyin')
    expect(store.data.sync_data_douyin).toBeUndefined()
    expect(service.getCachedData('douyin')).toBeNull()
  })

  test('⛔ 账号解析抛错 ⇒ 落 error（不是静默当成「无账号」跳过）', async () => {
    const service = new DataSyncService(new MockStore(), {
      resolveAccount: async () => { throw new Error('凭证文件读失败') },
      rpaViewManager: { collect: async () => ({ ok: true, data: { followers: 100 } }) },
    })
    const result = await service.syncPlatform('douyin')
    expect(result.error).toContain('账号解析失败')
    expect(result.followers).toBeUndefined()
  })
})

describe('数据同步 / 错误落缓存（失败态要能到渲染端）', () => {
  test('⛔ 失败记录落缓存，但**只有 error，没有任何数值字段**', async () => {
    const store = new MockStore()
    const service = new DataSyncService(store, {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      rpaViewManager: { collect: async () => ({ ok: false, reason: 'invalid', field: 'followers' }) },
    })
    await service.syncPlatform('douyin')
    const cached = service.getCachedData('douyin')
    expect(cached).toBeTruthy()
    expect(cached.error).toContain('COLLECT_VALUE_INVALID')
    for (const key of ['followers', 'views', 'articles', 'comments', 'likes']) {
      expect(cached[key], `失败记录不得带 ${key}`).toBeUndefined()
    }
  })

  test('⛔ 失败记录必须被渲染端判为「不可信」（可信判据 = 无 error 且无遗留 _note）', async () => {
    const store = new MockStore()
    const service = new DataSyncService(store, {
      resolveAccount: async () => ({ accountId: 'acct-1' }),
      rpaViewManager: { collect: async () => ({ ok: false, reason: 'missing', field: 'followers' }) },
    })
    await service.syncPlatform('douyin')
    const rows = service.getAllCachedData()
    expect(rows.length).toBe(1)
    expect(rows[0].error).toBeTruthy()
    // 与渲染端同一判据：可信 = 无 error 且无 _note
    const trusted = rows.filter((r) => !r.error && !r._note)
    expect(trusted).toHaveLength(0)
  })
})
