// @ts-check
/**
 * RpaViewManager collector mixin — 账号级数据采集（粉丝等）
 *
 * 为什么独立成文件（2026-10-25，PR-1 第 2 刀）：
 *   `rpa-view-platforms.js` 在门禁的**点名还账清单**里（target 1499 / 容差 0）
 *   ⇒ **一行都不能碰**（改动会让主干红，挡住全仓 PR）。
 *   ⇒ 采集通道独立成新文件，沿用既有的 mixin 注入模式
 *   （`Object.assign(RpaViewManager.prototype, ...)`），接口面零改动。
 *
 * 它解决的是「采集通道从未存在」这个根缺口：
 *   `DataSyncService` 跑在**主进程**，旧的取数通路（`window.electronAPI` /
 *   `ipcRenderer`）只存在于渲染进程 ⇒ 主进程必然落空 ⇒ 落到「返回一组 0」的兜底
 *   ⇒ 而兜底被 `syncedAt: now` 盖上 ⇒ 界面显示「0粉丝 · 更新于 10:51」——
 *   **看上去是刚采到的真数据，实际是常量 0**。
 *
 * 本 mixin 的职责：
 *   1. 复用窗口池（`_acquireWindow` / `_releaseWindow`，池键 = 平台 + 账号）
 *      ⇒ 登录态天然按账号隔离（partition = `persist:rpa-<platform>-<accountId>`）；
 *   2. 新建窗口时注入该账号的登录态（cookie / 分区 cookie / localStorage）；
 *   3. 导航到创作者后台并**轮询**抽取脚本，直到「取到 / 字段缺 / 值非法」三者之一；
 *   4. 失败**抛错并带契约错误码**（COLLECT_NOT_READY / COLLECT_FIELD_MISSING /
 *      COLLECT_VALUE_INVALID）⇒ 界面能区分「页面没加载」与「选择器过期」，
 *      **绝不**把取不到数说成 0。
 *
 * 判读口径复用 `@multi-publish/shared-utils/src/collector-contract`
 * （与 `data-sync.js` 同一份实现 ⇒ 不存在「两处口径」）。
 */
const log = require('./logger')
const {
  evaluateCollectorObservation,
  classifyCollectorTimeout,
} = require('@multi-publish/shared-utils/src/collector-contract')

/** 采集轮询默认超时（ms）：页面渲染慢 + 平台接口慢，30 秒是保守上限 */
const DEFAULT_COLLECT_TIMEOUT_MS = 30000
/** 采集轮询默认间隔（ms） */
const DEFAULT_COLLECT_INTERVAL_MS = 500

/**
 * 采集超时（可配置）。非法值回落默认并出声告警（对齐仓内 MP_* 环境变量纪律）。
 * @returns {number}
 */
function resolveCollectTimeoutMs () {
  const raw = process.env.MP_COLLECT_TIMEOUT_MS
  if (raw === undefined || raw === '') return DEFAULT_COLLECT_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.warn('[rpa-view] MP_COLLECT_TIMEOUT_MS 非法值 ' + JSON.stringify(raw) + '，回落默认 ' + DEFAULT_COLLECT_TIMEOUT_MS)
    return DEFAULT_COLLECT_TIMEOUT_MS
  }
  return n
}

/**
 * 采集轮询间隔（可配置）。
 * @returns {number}
 */
function resolveCollectIntervalMs () {
  const raw = process.env.MP_COLLECT_INTERVAL_MS
  if (raw === undefined || raw === '') return DEFAULT_COLLECT_INTERVAL_MS
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.warn('[rpa-view] MP_COLLECT_INTERVAL_MS 非法值 ' + JSON.stringify(raw) + '，回落默认 ' + DEFAULT_COLLECT_INTERVAL_MS)
    return DEFAULT_COLLECT_INTERVAL_MS
  }
  return n
}

const collectorMixin = {
  /**
   * 采集一个平台的账号级数据。
   *
   * @param {string} platform - 平台 id（douyin / bilibili / …）
   * @param {string} accountId - 账号 id（登录态是账号级的 ⇒ 必须绑定）
   * @param {{url: string, script: string, authData?: {cookies?: object[], localStorage?: object}}} payload
   *   - url：创作者后台地址；script：页面内抽取脚本（返回契约形态的观测）
   * @returns {Promise<unknown>} 页面里的原始观测（由调用方按契约判读）
   */
  async collect (platform, accountId, payload) {
    const url = payload && typeof payload.url === 'string' ? payload.url : ''
    const script = payload && typeof payload.script === 'string' ? payload.script : ''
    if (!url) throw new Error('平台数据采集失败（' + platform + '）：缺少采集地址')
    if (!script) throw new Error('平台数据采集失败（' + platform + '）：缺少抽取脚本')
    // ⛔ 采集必须绑定账号：登录态是**账号级**的（partition = persist:rpa-<platform>-<accountId>）
    //    ⇒ 不给账号就等于让不同账号共用同一个窗口分区（登录态串号）。
    if (!accountId) throw new Error('平台数据采集失败（' + platform + '）：缺少账号（采集必须绑定已登录账号）')
    const authData = (payload && payload.authData) || { cookies: [], localStorage: {} }

    const acquired = this._acquireWindow(platform, accountId)
    const win = acquired.win
    const reused = acquired.reused
    let healthy = false
    try {
      if (!reused) {
        // 登录态注入只在**新建窗口**时做：池内复用的窗口已带登录态
        // （partition = persist:rpa-<platform>-<accountId>，登录态天然按账号隔离）。
        await this._restoreCookies(win, Array.isArray(authData.cookies) ? authData.cookies : [], platform)
        await this._restoreAuthPartitionCookies(win, platform, accountId)
        await this._restoreBrowserStorage(win, platform, authData)
      }
      await win.webContents.loadURL(url)
      const observation = await this._pollCollectorObservation(win, script, platform)
      healthy = observation.judged.ok === true
      return observation.raw
    } finally {
      // 失败/超时的窗口立即销毁（页面状态不可信）；成功的窗口归池复用。
      try {
        await this._releaseWindow(platform, accountId, win, healthy)
      } catch (_e) {
        try { if (!win.isDestroyed()) win.destroy() } catch (_) { /* ignore */ }
      }
    }
  },

  /**
   * 轮询抽取脚本，直到「取到 / 字段缺 / 值非法 / 超时」四者之一。
   *
   * 为什么「未就绪」要继续等、而「字段缺」要立刻停：
   *   not-ready = 页面还没渲染出来（慢）⇒ 等；
   *   missing / invalid = 容器在了但取不到值（选择器可能过期）⇒ 再等也没用，
   *   立刻报错才能让用户看到「选择器过期」而不是干等到超时。
   *
   * @param {any} win
   * @param {string} script
   * @param {string} platform
   * @returns {Promise<{raw: unknown, judged: object}>}
   */
  async _pollCollectorObservation (win, script, platform) {
    const timeoutMs = resolveCollectTimeoutMs()
    const intervalMs = resolveCollectIntervalMs()
    const deadline = Date.now() + timeoutMs
    const observations = []
    for (;;) {
      let raw
      try {
        raw = await win.webContents.executeJavaScript(script)
      } catch (e) {
        // 脚本执行失败：页面可能还没准备好（加载中）⇒ 当作「未就绪」继续等；
        // 窗口已销毁则是终态错误，直接抛出（再等也不会有结果）。
        if (typeof win.isDestroyed === 'function' && win.isDestroyed()) {
          throw new Error('平台数据采集失败（' + platform + '）：采集窗口已销毁', { cause: e })
        }
        raw = { ok: false, reason: 'not-ready' }
      }
      observations.push(raw)
      const judged = evaluateCollectorObservation(raw)
      if (judged.ok) return { raw, judged }
      if (judged.reason !== 'not-ready') return { raw, judged }
      if (Date.now() >= deadline) break
      await this._sleep(intervalMs)
    }
    const classified = classifyCollectorTimeout(observations)
    log.warn('RpaView', '[' + platform + '] collect timeout code=' + classified.code + ' observations=' + observations.length)
    throw new Error(
      '平台数据采集超时（' + platform + '）：' + classified.code +
      (classified.field ? ' / ' + classified.field : '')
    )
  },
}

module.exports = collectorMixin
module.exports.resolveCollectTimeoutMs = resolveCollectTimeoutMs
module.exports.resolveCollectIntervalMs = resolveCollectIntervalMs
