/**
 * 模型额度兜底 API — 渲染层唯一入口。
 *
 * 渲染组件不得直接碰 window.electronAPI（frontend-consistency Gate 10）；
 * 统一走 electron-bridge，获得参数脱壳与 fallback 信封。
 */
import { invokeWithFallback, on } from './electron-bridge'

const UNAVAILABLE = 'electronAPI not available'

export function modelQuotaGetPolicy () {
  return invokeWithFallback('modelQuotaGetPolicy', { code: -1, message: UNAVAILABLE, data: null })
}

export function modelQuotaSetPolicy (payload) {
  return invokeWithFallback('modelQuotaSetPolicy', { code: -1, message: UNAVAILABLE, data: null }, payload)
}

export function modelQuotaDecide (payload) {
  return invokeWithFallback('modelQuotaDecide', { code: -1, message: UNAVAILABLE, data: null }, payload)
}

export function modelQuotaSwitchBack (payload) {
  return invokeWithFallback('modelQuotaSwitchBack', { code: -1, message: UNAVAILABLE, data: null }, payload)
}

export function onModelQuotaRequired (callback) {
  return on('ModelQuotaRequired', callback)
}
