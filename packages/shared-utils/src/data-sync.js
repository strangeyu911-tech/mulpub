/**
 * DataSyncService — 数据同步系统
 *
 * 从各平台拉取发布数据（阅读/粉丝/评论等），
 * 缓存到 SQLite，供 Dashboard 展示。
 *
 * 文件位置: packages/shared-utils/src/data-sync.js
 */
const TTL_DEFAULT = 60 * 60 * 1000  // 1 小时

// 采集契约层（纯函数）：判读页面里跑出来的采集结果，并把失败分型。
// ⚠️ 跨包边界：`packages/shared-utils` 是跨包共享包 ⇒ **不得** require desktop 的 electron 模块；
//    采集执行体一律由主进程注入（见构造器的 `options.rpaViewManager`）。
const {
  evaluateCollectorObservation,
  classifyCollectorTimeout,
  assertCollectorPlatform,
  isCollectDue,
} = require('./collector-contract')

// 抽取脚本（页面内执行）的单一真源：5 个平台的 url + 选择器 + fail-loud 判定。
// 独立成文件是为了让脚本**能被单测真跑**（假 DOM），从而对「假 0」有机械锁。
const { COLLECTOR_SCRIPTS } = require('./collector-scripts')

// 支持数据同步的平台
const SYNC_PLATFORMS = ['douyin', 'bilibili', 'xiaohongshu', 'tencent_video', 'wechat_mp']

/** 同平台最小采集间隔（默认 30 分钟）—— 平台风控要求「不能太频繁查询」 */
const DEFAULT_MIN_COLLECT_INTERVAL_MS = 30 * 60 * 1000
/** 最小间隔的可配置项（走仓内既有 settings 机制） */
const COLLECT_INTERVAL_SETTING_KEY = 'sync_collect_min_interval_ms'

/** @typedef {{getSetting(key: string): unknown, setSetting(key: string, value: string): unknown, getDefaultAccount?: (platform: string) => object|null}} SettingsStore */
/** @typedef {Record<string, unknown>} SyncData */
/** @typedef {{platform: string, syncedAt?: string, error?: string, skipped?: string, accountId?: string} & SyncData} SyncResult */
/** @typedef {() => Promise<SyncData>} Syncer */
/** @typedef {{collect?: (platform: string, accountId: string, payload: {url: string, script: string, authData?: object}) => Promise<unknown>}} CollectorExecutor */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorMessage (value) {
  return value instanceof Error ? value.message : String(value)
}

/**
 * 「有限数」解析：**空 / null / undefined 一律不算数**。
 * ⚠️ 不能用 `Number(raw)`：`Number(null) === 0`、`Number('') === 0`
 *    ⇒ 配置项缺失会被折成 0（= 关闭节流），恰好把「没配」读成「不限制」。
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
function toFiniteNumber (raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * 记录里的 `syncedAt` ⇒ 毫秒时间戳；**时间戳坏了 ⇒ null**（当作「从未采集」）。
 * （与契约层 `isCollectDue` 的纪律一致：非法时间戳不得被读成「不需要采」。）
 *
 * @param {unknown} row
 * @returns {number|null}
 */
function syncedAtMs (row) {
  if (!isRecord(row) || typeof row.syncedAt !== 'string') return null
  const t = Date.parse(row.syncedAt)
  return Number.isFinite(t) ? t : null
}

class DataSyncService {
  /**
   * @param {SettingsStore | null} store - Store 实例（需有 getSetting/setSetting）
   * @param {object} [options]
   * @param {number} [options.cacheTTL] - 缓存有效期 (ms)
   * @param {number} [options.minCollectIntervalMs] - 同平台最小采集间隔 (ms)，缺省 30 分钟
   * @param {() => number} [options.now] - 时钟（可注入，便于确定性测试）
   * @param {CollectorExecutor} [options.rpaViewManager]
   *   - 主进程可达的采集执行体（由 `container.setup.js` 注入 `rpaViewManager`）。
   *   - 不注入 ⇒ 采集一律 fail-loud 抛错（绝不产出看起来像真数据的 0）。
   * @param {(platform: string) => Promise<{accountId: string, authData?: object}|null>} [options.resolveAccount]
   *   - 已登录账号解析（主进程注入；仓内约定 = `store.getDefaultAccount(platform)`）。
   *   - 返回 null ⇒ 该平台**无已登录账号** ⇒ 记 `skipped(no-account)` 且**零请求**。
   */
  constructor (store, options = {}) {
    this._store = store
    this._cacheTTL = options.cacheTTL || TTL_DEFAULT
    this._rpaViewManager = options.rpaViewManager || null
    this._resolveAccountFn = typeof options.resolveAccount === 'function' ? options.resolveAccount : null
    this._minCollectIntervalMs = options.minCollectIntervalMs
    this._now = typeof options.now === 'function' ? options.now : () => Date.now()
    // 全局采集并发闸：同一时刻至多 1 个采集在途（平台风控；PRD §5.2）。
    this._collectChain = Promise.resolve()

    // 注册同步器。显式映射让平台与实现的合同可被 TypeScript 校验。
    /** @type {Record<string, Syncer>} */
    this._syncers = {
      douyin: () => this._collectFor('douyin'),
      bilibili: () => this._collectFor('bilibili'),
      xiaohongshu: () => this._collectFor('xiaohongshu'),
      tencent_video: () => this._collectFor('tencent_video'),
      wechat_mp: () => this._collectFor('wechat_mp'),
    }
  }

  // ─── 公开接口 ─────────────────────────────

  /**
   * 同步所有支持的平台
   * @returns {Promise<SyncResult[]>}
   */
  async syncAll () {
    const platforms = Object.keys(this._syncers)
    const results = await Promise.allSettled(
      platforms.map(p => this._syncOne(p))
    )
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      const message = r.reason === undefined ? '同步失败' : errorMessage(r.reason)
      return this._makeErrorResult(platforms[i], message)
    })
  }

  /**
   * 同步单个平台
   * @param {string} platform
   * @returns {Promise<SyncResult>}
   */
  async syncPlatform (platform) {
    return this._syncOne(platform)
  }

  /**
   * 获取缓存的同步数据
   * @param {string} platform
   * @returns {SyncResult|null}
   */
  getCachedData (platform) {
    if (!this._store) return null
    const raw = this._store.getSetting(`sync_data_${platform}`)
    if (!raw) return null
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!isRecord(parsed) || typeof parsed.platform !== 'string' || typeof parsed.syncedAt !== 'string') {
        return null
      }
      // 检查是否过期
      if (this._now() - new Date(parsed.syncedAt).getTime() > this._cacheTTL) {
        return null
      }
      return /** @type {SyncResult} */ (parsed)
    } catch (e) {
      return null
    }
  }

  /**
   * 获取所有缓存的同步数据（用于 Dashboard）
   * @returns {SyncResult[]}
   */
  getAllCachedData () {
    return SYNC_PLATFORMS
      .map(p => this.getCachedData(p))
      .filter((data) => data !== null)
  }

  /**
   * 获取支持的平台列表
   * @returns {string[]}
   */
  getSupportedPlatforms () {
    return [...SYNC_PLATFORMS]
  }

  // ─── 内部方法 ─────────────────────────────

  /**
   * @param {string} platform
   * @returns {Promise<SyncResult>}
   */
  async _syncOne (platform) {
    const syncer = this._syncers[platform]
    if (!syncer) {
      return this._makeErrorResult(platform, `不支持的平台: ${platform}`)
    }
    // ── 节流（三层之一：同平台最小采集间隔）────────────────────────────
    // 距上次采集 < 最小间隔 ⇒ **零请求**（返回缓存记录）。
    // 依据是缓存记录里的 syncedAt（= 采集完成时刻）；**失败记录也算一次尝试**
    // ⇒ 平台风控侧不会因为采集失败而被反复轰炸。
    const cached = this.getCachedData(platform)
    if (cached && !isCollectDue(syncedAtMs(cached), this._now(), this._minIntervalMs())) {
      return cached
    }
    try {
      const data = await syncer()
      if (isRecord(data) && typeof data.skipped === 'string') {
        // 跳过（无已登录账号）：**不落缓存** ——
        // 它不是数据，也不该把后续尝试节流住（用户刚登录完就该能采到）。
        return { platform, skipped: data.skipped }
      }
      const result = this._makeSyncResult(platform, data)
      this._cacheData(platform, result)
      return result
    } catch (e) {
      const result = this._makeErrorResult(platform, errorMessage(e))
      // 失败也落缓存：**只有 error，没有任何数值字段** ⇒
      //   ① 渲染端能读到失败态（trustedSyncRows 会把它判为不可信 ⇒ 显示「—」+ 原因）；
      //   ② 最小间隔能覆盖失败，避免「采集失败反复轰炸平台」。
      this._cacheData(platform, result)
      return result
    }
  }

  /**
   * 最小采集间隔：构造器参数 > 仓内 settings > 默认 30 分钟。
   * @returns {number}
   */
  _minIntervalMs () {
    const explicit = toFiniteNumber(this._minCollectIntervalMs)
    if (explicit !== null && explicit >= 0) return explicit
    if (this._store && typeof this._store.getSetting === 'function') {
      const configured = toFiniteNumber(this._store.getSetting(COLLECT_INTERVAL_SETTING_KEY))
      if (configured !== null && configured >= 0) return configured
    }
    return DEFAULT_MIN_COLLECT_INTERVAL_MS
  }

  /**
   * 解析该平台的已登录账号。
   *
   * 口径（PRD §四 判据 5 / §六）：账号级登录态 ⇒ 一平台多账号时只采一个，
   * 取仓内既有「默认账号」约定（`store.getDefaultAccount(platform)`）——
   * 由主进程注入（`options.resolveAccount`），**不在本包复制第二份账号解析**。
   *
   * @param {string} platform
   * @returns {Promise<{ok: true, account: {accountId: string, authData?: object}|null} | {ok: false, error: string}>}
   */
  async _resolveAccount (platform) {
    if (!this._resolveAccountFn) {
      return {
        ok: false,
        error: `平台数据采集通道未接入（${platform}）：未注入账号解析器，取不到已登录账号`,
      }
    }
    let account = null
    try {
      account = await this._resolveAccountFn(platform)
    } catch (e) {
      return { ok: false, error: `账号解析失败（${platform}）：${errorMessage(e)}` }
    }
    if (!account || typeof account.accountId !== 'string' || !account.accountId) {
      return { ok: true, account: null }
    }
    return { ok: true, account }
  }

  /**
   * 采集一个平台（统一流程）。
   * @param {string} platform
   * @returns {Promise<SyncData>}
   */
  async _collectFor (platform) {
    const spec = COLLECTOR_SCRIPTS[platform]
    if (!spec) {
      throw new Error(`平台数据采集通道未接入（${platform}）：没有该平台的采集规格，取不到真值`)
    }
    const accountResult = await this._resolveAccount(platform)
    if (!accountResult.ok) throw new Error(accountResult.error)
    // ⛔ 无已登录账号 ⇒ **零请求**（连窗口都不开），只记 skipped。
    if (!accountResult.account) {
      return { skipped: 'no-account' }
    }
    const account = accountResult.account
    const data = await this._rpaFetchStats(platform, account, {
      url: spec.url,
      script: spec.script,
      authData: account.authData,
    })
    // 账号归属写进记录（PRD §六：供 UI 标注「这条是哪个账号采的」）
    return Object.assign({}, data, { accountId: account.accountId })
  }

  /**
   * 采集平台统计数据（主进程可达的执行体 + 契约判读）。
   *
   * ⚠️ 本服务跑在**主进程**（`core/container.setup.js` 注册 `dataSync`），
   *    而旧实现走的两条通路（`window.electronAPI` / `ipcRenderer`）**只存在于渲染进程**
   *    ⇒ 在主进程里必然全部落空 ⇒ 必然落到「返回一组 0」的兜底
   *    ⇒ 而该兜底被 `_makeSyncResult()` 打上 `syncedAt: now` 写进缓存
   *    ⇒ 界面显示「0阅读 · 更新于 10:51」——**看上去是刚采到的真数据，实际是常量 0**。
   *
   * ⇒ 现在改为**依赖注入**一个主进程可达的采集执行体（`options.rpaViewManager`）：
   *    跨包边界（`packages/shared-utils` 是跨包共享包）不允许 require desktop 的 electron 模块，
   *    因此只能注入，不能自己去找。
   *
   * @param {string} platform
   * @param {{accountId: string, authData?: object}} account
   * @param {{url: string, script: string, authData?: object}} payload
   * @returns {Promise<SyncData>}
   */
  async _rpaFetchStats (platform, account, payload) {
    const collector = this._rpaViewManager
    if (!collector || typeof collector.collect !== 'function') {
      // ⛔ 取不到真值 ⇒ 抛错，绝不返回一组 0（PR #4435 已确立的 fail-loud 纪律）。
      throw new Error(
        `平台数据采集通道未接入（${platform}）：本版本未实现创作者后台数据采集，取不到真值`
      )
    }
    const raw = await this._withCollectLock(() =>
      collector.collect(platform, account.accountId, payload)
    )
    const judged = evaluateCollectorObservation(raw)
    if (!judged.ok) {
      // 单次观测即终态（执行体内部已做轮询与就绪等待）⇒ 按契约分型抛错，
      // 让渲染端能区分「页面没就绪」与「选择器过期」而不是只给一句「不可用」。
      const classified = classifyCollectorTimeout([judged])
      throw new Error(
        `平台数据采集失败（${platform}）：${classified.code}${classified.field ? ' / ' + classified.field : ''}`
      )
    }
    const platformCheck = assertCollectorPlatform(platform, judged.data)
    if (!platformCheck.ok) {
      throw new Error(
        `平台数据采集失败（${platform}）：${platformCheck.code}（期望 ${platformCheck.expected}，实际 ${platformCheck.actual}）`
      )
    }
    return judged.data
  }

  /**
   * 全局采集并发闸：**同一时刻至多 1 个采集在途**。
   * （平台风控；PRD §5.2。`syncAll` 是 5 个平台并发发起 ⇒ 没有这道闸就是并发 5。）
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async _withCollectLock (fn) {
    const previous = this._collectChain
    let release = null
    this._collectChain = new Promise((resolve) => { release = resolve })
    await previous
    try {
      return await fn()
    } finally {
      if (release) release()
    }
  }

  /**
   * 当前时刻的 ISO 字符串（`syncedAt` = 采集**完成**时刻，不是请求发起时刻）。
   * 时钟异常（非法值）⇒ 回落到系统时钟，绝不产出 `Invalid Date`。
   * @returns {string}
   */
  _nowIso () {
    const raw = this._now()
    const n = Number(raw)
    return new Date(Number.isFinite(n) ? n : Date.now()).toISOString()
  }

  /**
   * @param {string} platform
   * @param {SyncData} data
   * @returns {SyncResult}
   */
  _makeSyncResult (platform, data) {
    return {
      platform,
      syncedAt: this._nowIso(),
      ...data,
    }
  }

  /**
   * @param {string} platform
   * @param {string} error
   * @returns {SyncResult}
   */
  _makeErrorResult (platform, error) {
    return {
      platform,
      syncedAt: this._nowIso(),
      error,
    }
  }

  /**
   * @param {string} platform
   * @param {SyncResult} data
   * @returns {void}
   */
  _cacheData (platform, data) {
    if (this._store) {
      this._store.setSetting(`sync_data_${platform}`, JSON.stringify(data))
    }
  }
}

module.exports = DataSyncService
