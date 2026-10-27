/**
 * 模型额度兜底 API — 渲染层唯一入口。
 *
 * 渲染组件不得直接碰 window.electronAPI（frontend-consistency Gate 10）；
 * 统一走 electron-bridge，获得参数脱壳与 fallback 信封。
 *
 * 这里刻意逐个写出 `invokeWithFallback('literalMethod', ...)`，不抽
 * `invoke(method)` 泛型：IPC 暴露面契约会扫描「首参不是字面量」的动态取名
 * 调用点并判红。重复几行换来契约可判，值得。
 *
 * 用命名空间导入而不是 `{ on }`：部分 App 级测试只 mock 了
 * invokeWithFallback；命名导入会在模块加载期就报「No "on" export」，
 * 命名空间导入只在真正调用时判空，弹窗未触发事件的页面不受影响。
 */
import * as bridge from './electron-bridge'

const UNAVAILABLE = 'electronAPI not available'
const FALLBACK = { code: -1, message: UNAVAILABLE, data: null }

function hasBridgeMethod (name) {
  return Boolean(bridge && name in bridge && typeof bridge[name] === 'function')
}

export function modelQuotaGetPolicy () {
  if (!hasBridgeMethod('invokeWithFallback')) return Promise.resolve(FALLBACK)
  return bridge.invokeWithFallback('modelQuotaGetPolicy', FALLBACK)
}

export function modelQuotaSetPolicy (payload) {
  if (!hasBridgeMethod('invokeWithFallback')) return Promise.resolve(FALLBACK)
  return bridge.invokeWithFallback('modelQuotaSetPolicy', FALLBACK, payload)
}

export function modelQuotaDecide (payload) {
  if (!hasBridgeMethod('invokeWithFallback')) return Promise.resolve(FALLBACK)
  return bridge.invokeWithFallback('modelQuotaDecide', FALLBACK, payload)
}

export function modelQuotaSwitchBack (payload) {
  if (!hasBridgeMethod('invokeWithFallback')) return Promise.resolve(FALLBACK)
  return bridge.invokeWithFallback('modelQuotaSwitchBack', FALLBACK, payload)
}

export function onModelQuotaRequired (callback) {
  if (!hasBridgeMethod('on')) return () => {}
  return bridge.on('ModelQuotaRequired', callback)
}
