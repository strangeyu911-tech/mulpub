/**
 * redemption-code-utils.js — 运营中心「兑换码签发」的前端纯逻辑。
 *
 * 为什么单独成文件：这些逻辑原本写在 `RedemptionCodes.vue` 的 `<script setup>` 里，
 * **无法被单测直接引用** ⇒ 签发前的二次确认文案、CSV 导出内容、有效期归一化
 * 都只能靠人眼看 ⇒ 本仓有过「新增文件没进测试白名单 ⇒ 一个都不跑」的先例。
 * ⇒ 抽成纯函数模块：逻辑可单测，视图只负责渲染。
 */

/**
 * CSV 单元格转义。
 *
 * 含逗号 / 引号 / 换行时用双引号包起来、内部引号翻倍（RFC 4180）。
 * ⚠️ 运营填的「发放对象」是自由文本，可能含逗号 ⇒ 不转义会整张表串列。
 *
 * @param {*} value 单元格值（null/undefined ⇒ 空串）
 * @returns {string} 转义后的单元格文本
 */
export function csvCell (value) {
  const s = String(value == null ? '' : value)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** CSV 表头（中文列名，交付给运营的表格模板）。 */
export const CSV_HEADER = ['兑换码', '发放对象', '批次号', '套餐', '会员时长(天)', '兑换码过期时间']

/** 交付模板行：给运营粘贴到自己的表格里逐行填。 */
export const TEMPLATE_ROW = CSV_HEADER.join(',')

/**
 * 拼出这批码的 CSV 全文（表头 + 每个码一行，CRLF 行尾 ⇒ Excel 友好）。
 *
 * ⚠️ 列来源用**签发结果**而不是当前表单：结果弹窗打开时表单可能已被改过，
 * 用表单值会导出一张「看起来对、其实不是这批码」的表。
 *
 * @param {object} input
 * @param {string[]} input.codes 本批的完整兑换码
 * @param {string} [input.issuedTo] 发放对象
 * @param {string} [input.batch] 批次号
 * @param {string} [input.plan] 套餐 id（standard/pro）
 * @param {object} [input.planLabels] 套餐显示名映射
 * @param {number} [input.durationDays] 会员时长（天）
 * @param {string} [input.expiresAt] 兑换码过期时间（ISO 串）
 * @returns {string} CSV 全文
 */
export function buildCsv (input) {
  const data = input || {}
  const codes = Array.isArray(data.codes) ? data.codes : []
  const labels = data.planLabels || {}
  const header = CSV_HEADER
  const rows = codes.map((code) => [
    code,
    data.issuedTo || '',
    data.batch || '',
    labels[data.plan] || data.plan || '',
    data.durationDays == null ? '' : data.durationDays,
    data.expiresAt || '',
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/**
 * 从**签发结果**拼出 CSV 全文（视图层的 `currentCsv()` 只做转发）。
 *
 * ⚠️ 为什么把「列来源」这件事钉在这个函数里（而不是留在 .vue 的 `<script setup>`）：
 * 「用签发结果、**不用当前表单**」是一条**容易在重构中被改坏**的规则
 * （结果弹窗打开时表单可能已改过 ⇒ 用表单值会导出一张「看起来对、其实不是这批码」的表）。
 * 规则留在 .vue 里 ⇒ 没人测得到；钉在这里 ⇒ 参数只有「结果」与「码列表」，
 * **没有任何入口能塞进表单值** ⇒ 规则变成结构上的不可能。
 *
 * @param {object} result 签发结果对象（后端返回的 detail / 本地补全后的对象）
 * @param {object} [options]
 * @param {string[]} [options.codes] 本批的完整兑换码
 * @param {object} [options.planLabels] 套餐显示名映射
 * @returns {string} CSV 全文
 */
export function buildCsvFromResult (result, options) {
  const r = result || {}
  const opts = options || {}
  return buildCsv({
    codes: Array.isArray(opts.codes) ? opts.codes : [],
    issuedTo: r.issuedTo || '',
    batch: r.batch || '',
    plan: r.plan || '',
    planLabels: opts.planLabels || {},
    durationDays: r.durationDays,
    expiresAt: r.expiresAt || '',
  })
}

/**
 * 表单里的有效期 → 提交给服务端的 UTC ISO 串。
 *
 * ⚠️ 统一走 UTC：运营的浏览器时区与服务端可能不同 ⇒ 直接发本地时间串会差几个小时。
 * ⚠️ 空值 ⇒ 返回 `undefined`（**不是** 空串 / "Invalid Date"）⇒ 请求里不带该字段。
 *
 * @param {Date|string|null} value date-picker 给的值（Date）或手填串
 * @returns {string|undefined} ISO 串；空/非法 ⇒ undefined
 */
export function expiresAtToIso (value) {
  if (value === null || value === undefined || value === '') return undefined
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

/**
 * 「只能选未来」判据（date-picker 的 disabled-date 用）。
 *
 * 只挡**今天之前**的日期；今天之内的时间由提交前的校验挡（见 expiresAtMustBeFuture）。
 *
 * @param {Date} date 候选日期
 * @returns {boolean} true = 不可选
 */
export function isPastDate (date) {
  if (!date) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

/**
 * 过期时间必须晚于当前时刻。
 *
 * ⚠️ 为什么客户端也要挡：服务端已拒（400 EXPIRES_AT_INVALID），
 * 但让运营先看到「过期时间必须晚于当前时间」比看到一个英文错误码友好得多；
 * 而且**过期时间等于现在**的批次，服务端拒、客户端也拒 ⇒ 口径一致。
 *
 * @param {string|undefined} iso 归一化后的 ISO 串
 * @returns {boolean} true = 有问题
 */
export function expiresAtMustBeFuture (iso) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return true
  return t <= Date.now()
}

/**
 * 签发前二次确认的**摘要文案**（每行一条）。
 *
 * ⚠️ 这一段是「将要发生什么」的唯一真源 ⇒ 运营在**扣出码之前**能复核一遍
 * （套餐 / 时长 / 数量 / 发给谁 / 批次 / 过期时间）。
 * ⚠️ 发放对象与批次号**为空时不出现在摘要里**（不要给「发放对象：（空）」这种噪音行）。
 *
 * @param {object} input
 * @returns {string[]} 摘要行数组
 */
export function buildConfirmSummary (input) {
  const data = input || {}
  const labels = data.planLabels || {}
  const lines = [
    `套餐：${labels[data.plan] || data.plan || '-'}`,
    `会员时长：${data.durationDays == null ? '-' : `${data.durationDays} 天`}`,
    `数量：${data.count == null ? '-' : `${data.count} 个`}`,
  ]
  if (data.issuedTo) lines.push(`发放对象：${data.issuedTo}`)
  if (data.batch) lines.push(`批次号：${data.batch}`)
  if (data.expiresAt) lines.push(`兑换码过期：${data.expiresAtText || data.expiresAt}`)
  return lines
}

/**
 * 签发流程编排：**校验 → 二次确认 → 提交**（纯函数，依赖注入）。
 *
 * ⚠️ 为什么把流程抽出来（2026-10-25 独立复评 F10 实测）：
 * 「过期时间不合法 ⇒ 不进确认框」「运营点了『再看看』⇒ **一个请求都不发**」
 * 这两条**是行为**，不是「模板里有个 @click 字符串」。
 * 留在 `.vue` 的 `<script setup>` 里 ⇒ 组件测试设施不存在 ⇒ 只能写
 * 「源码里包含某个字符串」的形状锁 ⇒ **形状锁证明不了「取消后仍然发了请求」**
 * （2026-10-25 复评实测：把 `@click="confirmGenerate"` 留着、但让它直接调 submit，
 * 形状锁照样绿）。
 * ⇒ 抽成**依赖注入**的编排函数：视图只提供「怎么校验 / 怎么确认 / 怎么提交」，
 * 流程的**次序与中止条件**由本函数保证 ⇒ 行为可被真用例覆盖。
 *
 * @param {object} options
 * @param {string[]} [options.summary] 二次确认要展示的摘要行
 * @param {() => (string|null)} [options.validate] 提交前校验；返回错误文案 ⇒ **中止**（不确认、不提交）
 * @param {(summary: string[]) => Promise<any>} [options.confirm] 二次确认；**拒绝/抛错 ⇒ 用户取消**（不提交）
 * @param {() => Promise<any>} [options.submit] 真正发请求
 * @returns {Promise<{ok: boolean, stage: 'validate'|'confirm'|'submit', error?: string, cancelled?: boolean, result?: any}>}
 */
export async function runIssueFlow (options) {
  const opts = options || {}
  const validationError = opts.validate ? opts.validate() : null
  if (validationError) {
    return { ok: false, stage: 'validate', error: String(validationError) }
  }
  try {
    if (opts.confirm) await opts.confirm(opts.summary || [])
  } catch (e) {
    // 用户取消（「再看看」）⇒ **不发任何请求**。
    return { ok: false, stage: 'confirm', cancelled: true }
  }
  const result = opts.submit ? await opts.submit() : null
  return { ok: true, stage: 'submit', result }
}

/**
 * 复制文本到剪贴板，**非安全上下文自动降级**（纯函数，依赖注入）。
 *
 * ⚠️ 为什么抽出来（同上）：「局域网 http 部署下 `navigator.clipboard` 不可用 ⇒
 * 必须降级到临时 textarea + `execCommand`」是一条**行为**，
 * 留在 `.vue` 里就只能拿到「源码里有 `document.execCommand('copy')`」这种形状锁
 * ⇒ **证明不了降级路径真的能复制**（独立复评 F10 实测）。
 *
 * ⚠️ 降级路径**必须真的能复制**（局域网 http 部署是运营的实际环境）⇒ 两条路都失败时
 * 返回 `ok:false`，由视图给出「复制失败，请手动选中文本复制」——**不静默失败**。
 *
 * @param {*} text 要复制的文本
 * @param {object} [deps] 依赖注入（测试用；生产不传则取浏览器全局）
 * @param {{writeText: (v: string) => Promise<any>}|null} [deps.clipboard]
 * @param {boolean} [deps.isSecureContext]
 * @param {Document} [deps.document]
 * @param {(cmd: string) => boolean} [deps.execCommand]
 * @returns {Promise<{ok: boolean, via?: 'clipboard'|'execCommand', reason?: 'empty'|'unavailable'|'exec-failed'|'error'}>}
 */
export async function copyTextWithFallback (text, deps) {
  const value = String(text == null ? '' : text)
  if (!value) return { ok: false, reason: 'empty' }
  const d = deps || {}
  const clipboard = d.clipboard !== undefined
    ? d.clipboard
    : (typeof navigator !== 'undefined' ? navigator.clipboard : null)
  const secure = d.isSecureContext !== undefined
    ? !!d.isSecureContext
    : (typeof window !== 'undefined' ? !!window.isSecureContext : false)
  const doc = d.document || (typeof document !== 'undefined' ? document : null)
  const execCommand = d.execCommand
    || (doc && typeof doc.execCommand === 'function' ? doc.execCommand.bind(doc) : null)
  try {
    if (clipboard && secure) {
      await clipboard.writeText(value)
      return { ok: true, via: 'clipboard' }
    }
    if (!doc || !execCommand) return { ok: false, reason: 'unavailable' }
    const area = doc.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', 'readonly')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    doc.body.appendChild(area)
    area.select()
    const ok = execCommand('copy')
    doc.body.removeChild(area)
    if (!ok) return { ok: false, reason: 'exec-failed' }
    return { ok: true, via: 'execCommand' }
  } catch (e) {
    return { ok: false, reason: 'error', error: e }
  }
}
