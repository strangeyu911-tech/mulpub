/**
 * text-length.browser.js — text-length.js 的 ESM 孪生（渲染端经 vite alias 走这份）。
 * 逻辑必须与 CJS 版逐字等价，由 src/__tests__/text-length-parity.test.js 钉住。
 * 为什么需要两份：apps/desktop 的渲染端是 Vite/ESM 构建，require 不到 CJS；
 * 而 packages/shared-utils 的 Node 侧消费者（主进程、脚本）是 CJS。先例：
 * safe-http-url / article-body-format / platform-definitions。
 *
 * 口径与本仓 AGENTS 一致：计数按 **码点**，不是 UTF-16 码元，也不上溯到字素簇；
 * 截断不得切断代理对。完整理由见 text-length.js 文件头。
 */

export function toCodePoints (value) {
  return Array.from(value == null ? '' : String(value))
}

export function codePointLength (value) {
  return toCodePoints(value).length
}

function normalizeMax (max) {
  const n = Number(max)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

export function truncate (value, max, ellipsis = '…') {
  const chars = toCodePoints(value)
  const keep = normalizeMax(max)
  if (ellipsis === '') {
    return chars.length <= keep ? chars.join('') : chars.slice(0, keep).join('')
  }
  if (chars.length <= keep) return chars.join('')
  return chars.slice(0, keep).join('') + String(ellipsis)
}

export function truncateWithin (value, max, ellipsis = '…') {
  const chars = toCodePoints(value)
  const limit = normalizeMax(max)
  if (chars.length <= limit) return chars.join('')
  const marker = toCodePoints(ellipsis)
  if (marker.length >= limit) return chars.slice(0, limit).join('')
  return chars.slice(0, limit - marker.length).join('') + String(ellipsis)
}

export function hasDanglingSurrogate (value) {
  const s = value == null ? '' : String(value)
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s) || /(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/.test(s)
}

export default { toCodePoints, codePointLength, truncate, truncateWithin, hasDanglingSurrogate }
