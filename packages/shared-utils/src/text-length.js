'use strict'
/**
 * text-length.js — 「字数」与「按字数截断」的唯一实现（Unicode 码点口径）。
 *
 * 为什么要有这个模块（UX 审计阶段 4.7 ①，按评审 w10 修正后的口径）：
 *   String.prototype.length 数的是 **UTF-16 码元**，不是"一个字"。一个 emoji（🎉）占 2 个码元，
 *   一面国旗（🇯🇵 由两个 regional indicator 组成）占 4 个。于是本仓原来三种口径并存：
 *     - Array.from(x).length                     （码点，对）
 *     - x.length                                 （码元，对 emoji 多算）
 *     - x.slice(0, N) + '…'                      （按码元切，会把代理对**切成半片**）
 *   第三条是真缺陷：实测 `'a'.repeat(19) + '🎉尾巴'` 取 slice(0,20) 得到
 *   "aaaaaaaaaaaaaaaaaaa\ud83c" —— 尾部是一个**孤立高位代理**，渲染出来是豆腐块/问号；
 *   国旗更直观：'🇯🇵 flag'.slice(0,2) === '🇯'（半面旗）。
 *   本产品的标题/正文/备注里 emoji 与国旗是常态（社媒文案），所以这不是边角。
 *
 * 三条口径：
 *   1. **计数按码点**：`codePointLength`。注意它**不等于**字素簇（grapheme）——"e\u0301" 是 2 个码点
 *      但 1 个视觉字符，emoji 家族（ZWJ 序列、肤色修饰符）也是多码点一字符。
 *      本仓**刻意不上溯到字素簇**：Intl.Segmenter 在 Node/浏览器双侧可用性不一致，
 *      而平台侧限制本身按码点/字节计（见 PRD §7），用码点口径与平台可对账。这句话必须写在这里，
 *      否则下一个会话会把"码点"误读成"字符数"并以为可以顺手换成 Intl.Segmenter。
 *   2. **截断不得切断代理对**：一律先展开成码点数组再切。
 *   3. `truncate` 的 `max` 是**正数码点数**，省略号**另加**（与既有调用方逐字一致，
 *      迁移时不改变可见宽度）。要"总宽不超 n"请调用 truncateWithin。
 *
 * 消费方：渲染端经 apps/desktop/vite.config.js 的 alias 走 text-length.browser.js（ESM 孪生），
 * 两份实现的逐字一致性由 packages/shared-utils/src/__tests__/text-length-parity.test.js 钉住
 * （先例：safe-http-url / article-body-format / platform-definitions 三对孪生）。
 */

/** 展开成码点数组（唯一入口，禁外部再写 Array.from 的第二份） */
function toCodePoints (value) {
  return Array.from(value == null ? '' : String(value))
}

/** 码点计数：null/undefined 视作空串，非字符串先 String() */
function codePointLength (value) {
  return toCodePoints(value).length
}

function normalizeMax (max) {
  const n = Number(max)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

/**
 * 按码点截断，省略号另加（保持既有调用方语义：`text.length > 90 ? text.slice(0,90) + '...' : text`）。
 * 与旧写法的唯一差别：切点永远落在码点边界上，不会留下孤立代理。
 */
function truncate (value, max, ellipsis = '…') {
  const chars = toCodePoints(value)
  const keep = normalizeMax(max)
  if (ellipsis === '') {
    return chars.length <= keep ? chars.join('') : chars.slice(0, keep).join('')
  }
  if (chars.length <= keep) return chars.join('')
  return chars.slice(0, keep).join('') + String(ellipsis)
}

/**
 * 总宽（含省略号）不超过 max 的截断 —— 给"宽度是硬合同"的场景用（如平台字段上限）。
 * max 小于省略号自身长度时不产出省略号，只截到 max，避免"结果比 max 还长"的反向违约。
 */
function truncateWithin (value, max, ellipsis = '…') {
  const chars = toCodePoints(value)
  const limit = normalizeMax(max)
  if (chars.length <= limit) return chars.join('')
  const marker = toCodePoints(ellipsis)
  if (marker.length >= limit) return chars.slice(0, limit).join('')
  return chars.slice(0, limit - marker.length).join('') + String(ellipsis)
}

/** 是否是"孤立代理"串（截断错误的现场探针；供测试与排障用，不参与业务判定） */
function hasDanglingSurrogate (value) {
  const s = value == null ? '' : String(value)
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s) || /(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/.test(s)
}

module.exports = { toCodePoints, codePointLength, truncate, truncateWithin, hasDanglingSurrogate }
