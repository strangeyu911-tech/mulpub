// @ts-check
/**
 * 采集用账号解析（主进程侧）
 *
 * 口径（PRD《账号粉丝数真实化》§四 判据 5 / §六）：
 *   5 个平台的创作者后台都是**账号级登录态** ⇒ 一平台多账号时只能采一个
 *   ⇒ 取仓内既有的「默认账号」约定（`store.getDefaultAccount(platform)`）。
 *   ⛔ 不另发明第二份账号解析：仓内已有的 `loadAuthForTask`
 *   （`services/publisher-router.js`）已经实现了「默认账号 → 加密凭证 → store 行
 *   → session 分区 cookie 回退」这条完整链 ⇒ 直接复用。
 *
 * 「已登录」的判定：解析完成后**既没有 cookie、也没有 localStorage**
 *   ⇒ 该账号没有任何可用登录态 ⇒ 视为「无已登录账号」
 *   ⇒ 上层记 `skipped(no-account)` 且**零请求**（连窗口都不开）。
 *
 * 为什么放在主进程侧（而不是 `packages/shared-utils` 里）：
 *   ① session 分区 cookie 回退要用 `account-manager`（desktop 模块）；
 *   ② `packages/shared-utils` 是跨包共享包 ⇒ 不得 require desktop 的 electron 模块
 *      （跨包边界门禁）⇒ 只能**注入**（`DataSyncService` 的 `options.resolveAccount`）。
 */

/**
 * 懒加载发布链的账号凭证解析器。
 * 懒加载的原因：装配期与单测都不该为了「解析一个账号」拉起整条发布链。
 * @returns {(deps: object, platform: string, article: object, ownerSubject?: string) => Promise<{accountId: string|null, authData: object}>}
 */
function getLoadAuthForTask () {
  // eslint-disable-next-line global-require
  return require('./publisher-router').loadAuthForTask
}

/**
 * 解析采集用的账号。
 *
 * @param {{store: object, accountManager: object}} deps
 * @param {string} platform
 * @param {Function} [loadAuthForTask] - 可注入的凭证解析器（单测用）
 * @returns {Promise<{accountId: string, authData: {cookies: object[], localStorage: object}}|null>}
 *   null = 该平台**没有已登录账号**
 */
async function resolveCollectAccount (deps, platform, loadAuthForTask) {
  const loader = typeof loadAuthForTask === 'function' ? loadAuthForTask : getLoadAuthForTask()
  const result = await loader(deps, platform, {}, undefined)
  const accountId = result && result.accountId ? result.accountId : null
  if (!accountId) return null
  const authData = (result && result.authData) || {}
  const cookies = Array.isArray(authData.cookies) ? authData.cookies : []
  const localStorage = (authData.localStorage && typeof authData.localStorage === 'object' && !Array.isArray(authData.localStorage))
    ? authData.localStorage
    : {}
  // ⛔ 既没有 cookie 也没有 localStorage ⇒ 没有可用登录态 ⇒ 不拿它凑数
  if (cookies.length === 0 && Object.keys(localStorage).length === 0) return null
  return { accountId, authData: { cookies, localStorage } }
}

/**
 * 造一个「采集账号解析器」，供 DI 注入 `DataSyncService`。
 *
 * ⚠️ 为什么把装配也收进本模块：`core/container.setup.js` 只有 **6 行余量**
 *   （493 行 + 门禁口径 `split('\n').length` +1 ⇒ 上限 500），
 *   账号解析的装配细节放这里 ⇒ DI 那侧只剩一行注入。
 *
 * @param {object} store - Store 实例（需有 getDefaultAccount）
 * @returns {(platform: string) => Promise<{accountId: string, authData: object}|null>}
 */
function createCollectAccountResolver (store) {
  return function (platform) {
    // 懒加载：account-manager 依赖 electron/fs ⇒ 装配期不拉起（单测与启动路径都更轻）
    // eslint-disable-next-line global-require
    const accountManager = require('../publishers/account-manager')
    return resolveCollectAccount({ store, accountManager }, platform)
  }
}

module.exports = { resolveCollectAccount, createCollectAccountResolver }
