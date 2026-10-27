// @ts-check
/**
 * 模型额度兜底 IPC handlers（P1b-2a）
 *
 * 通道（渲染端 → 主进程）：
 *   - model-quota:get-policy   读策略 + cap + 官方可用状态（public 读）
 *   - model-quota:set-policy   写 modelQuotaFallbackPolicy / officialCreditCapPerTask（authenticated）
 *   - model-quota:decide       弹窗用户选择回传（authenticated）
 *   - model-quota:switch-back  任务级回到 BYOK（authenticated）
 *
 * `model-quota:required` 是 main → renderer 事件，由 Coordinator.emitToRenderer 发送，不在这里注册。
 */

const { normalizePolicy, normalizeCap } = require('../services/model-quota-policy')

const POLICY_KEY = 'modelQuotaFallbackPolicy'
const CAP_KEY = 'officialCreditCapPerTask'
const UNAVAILABLE_STATUS = Object.freeze({
  available: false,
  reason: 'not_configured',
  balance: null,
  currency: 'credit',
})

const OFFICIAL_REASONS = new Set([
  'ok', 'not_signed_in', 'no_entitlement', 'not_configured', 'no_price', 'balance_unavailable',
])

function readSetting (store, key) {
  if (!store || typeof store.getSetting !== 'function') return null
  try {
    return store.getSetting(key)
  } catch (_) {
    return null
  }
}

/**
 * 官方状态输入校验（PRD V-12）：available 必须是 true；reason 只认 6 个枚举；
 * balance 只接受非负整数。可用但余额读不到 ⇒ 降级 balance_unavailable，不自动切。
 */
function sanitizeOfficialStatus (status) {
  if (!status || typeof status !== 'object') return { ...UNAVAILABLE_STATUS }
  const available = status.available === true
  let reason = typeof status.reason === 'string' && OFFICIAL_REASONS.has(status.reason)
    ? status.reason
    : (available ? 'ok' : 'not_configured')
  const balance = Number.isInteger(status.balance) && status.balance >= 0 ? status.balance : null
  if (available && balance === null) {
    return { available: false, reason: 'balance_unavailable', balance: null, currency: 'credit' }
  }
  if (!available) {
    if (reason === 'ok') reason = 'not_configured'
    return { available: false, reason, balance: null, currency: 'credit' }
  }
  return { available: true, reason, balance, currency: 'credit' }
}

async function readOfficialStatus (provider) {
  if (!provider || typeof provider.getStatus !== 'function') return { ...UNAVAILABLE_STATUS }
  try {
    return sanitizeOfficialStatus(await provider.getStatus())
  } catch (_) {
    return { ...UNAVAILABLE_STATUS, reason: 'balance_unavailable' }
  }
}

function registerHandlers (ipcMain, deps = {}) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { store, log, modelQuotaCoordinator, modelQuotaSwitchBack } = deps
  const officialStatusProvider = deps.officialStatusProvider

  ipcMain.handle('model-quota:get-policy', withSenderCheck(async () => {
    try {
      const policy = normalizePolicy(readSetting(store, POLICY_KEY)).value
      const cap = normalizeCap(readSetting(store, CAP_KEY)).value
      return {
        code: 0,
        data: {
          policy,
          cap,
          official: await readOfficialStatus(officialStatusProvider),
        },
      }
    } catch (e) {
      log.error('[model-quota] get-policy error:', e)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('model-quota:set-policy', withSenderCheck(async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const policy = normalizePolicy(payload.policy)
      const cap = normalizeCap(payload.cap)
      if (!policy.valid || !cap.valid) {
        return { code: EC.VALIDATION_ERROR, message: '策略或单任务积分配额无效' }
      }
      if (!store || typeof store.setSetting !== 'function') {
        return { code: EC.REQUEST_ERROR, message: '本地设置不可用' }
      }
      const previousPolicy = readSetting(store, POLICY_KEY)
      const previousCap = readSetting(store, CAP_KEY)
      try {
        store.setSetting(POLICY_KEY, policy.value)
        store.setSetting(CAP_KEY, cap.value)
      } catch (e) {
        // 两个 key 必须同进同退；第二个写失败时尽力回滚第一个，避免半套配置。
        try {
          store.setSetting(POLICY_KEY, previousPolicy)
          store.setSetting(CAP_KEY, previousCap)
        } catch (_) { /* 回滚失败只能保留原错误 */ }
        throw e
      }
      return { code: 0, data: { policy: policy.value, cap: cap.value } }
    } catch (e) {
      log.error('[model-quota] set-policy error:', e)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('model-quota:decide', withSenderCheck(async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object' || !payload.requestId || !payload.decision) {
        return { code: EC.VALIDATION_ERROR, message: '缺少 requestId 或 decision' }
      }
      if (!['official', 'settings', 'cancel'].includes(payload.decision)) {
        return { code: EC.VALIDATION_ERROR, message: 'decision 不在允许值内' }
      }
      if (!modelQuotaCoordinator || typeof modelQuotaCoordinator.userDecision !== 'function') {
        return { code: EC.REQUEST_ERROR, message: '模型额度协调器未就绪' }
      }
      const accepted = modelQuotaCoordinator.userDecision(payload)
      if (!accepted) return { code: EC.NOT_FOUND, message: '请求不存在或已处理' }
      return { code: 0, data: { accepted: true } }
    } catch (e) {
      log.error('[model-quota] decide error:', e)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('model-quota:switch-back', withSenderCheck(async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object' || !payload.runId || !payload.capability) {
        return { code: EC.VALIDATION_ERROR, message: '缺少 runId 或 capability' }
      }
      if (typeof modelQuotaSwitchBack !== 'function') {
        return { code: EC.REQUEST_ERROR, message: '任务级切换未就绪' }
      }
      const switched = await modelQuotaSwitchBack(payload)
      if (!switched) return { code: EC.NOT_FOUND, message: '任务或能力不存在' }
      return { code: 0, data: { switched: true } }
    } catch (e) {
      log.error('[model-quota] switch-back error:', e)
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))
}

module.exports = registerHandlers
