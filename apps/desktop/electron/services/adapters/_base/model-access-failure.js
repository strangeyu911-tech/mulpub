'use strict'
/**
 * model-access-failure.js — 「模型额度/凭据失败」的产品级分类器（P1a）
 *
 * 范围：P1a = 错误识别 + 用户提示所需的分类字段。
 * 官方模型兜底、设置项、弹窗、任务级覆盖属 P1b/P2，见
 * `01-docs/PRD-MODEL-QUOTA-FALLBACK-2026-10-26.md` §13.1 与 `openspec/records/model-quota-p1.md`。
 *
 * 脱敏边界：`sanitizeErrorMessage` 覆盖 `sk-` / `Bearer` / `Authorization:` / JWT / `api_key=`；
 * 供应商自定义 token 形态仍由调用方日志层兜底，本模块不假装全覆盖。
 *
 * 与 `classifyProviderFailure` 的分工（**不得互相冒充**）：
 *   - `classifyProviderFailure` 服务**重试/熔断**：quota / rate / transient / content_policy / other。
 *   - `classifyModelAccessFailure` 服务**用户提示 / 官方兜底决策**：
 *       state（7 值）+ quotaKind（4 值）+ providerCode/httpStatus + fallbackEligible/askOnly。
 *
 * 判定顺序固定为「结构化码优先 → 文本兜底 → 未知保守」：
 *   ① 供应商业务码规则（MiniMax 1004/2056、OpenAI insufficient_quota…）
 *   ② ProviderError.code（QUOTA_EXCEEDED / AUTH_FAILED / RATE_LIMITED / TIMEOUT…）
 *   ③ HTTP 状态（401/403/402/429/5xx/0）
 *   ④ 文本模式（额度 / 限流 / 认证 / 瞬时）
 *   ⑤ unknown（绝不兜底）
 *
 * 硬规则：
 *   - `429 + rate_limit_exceeded` 不得因为文本里带「额度」二字被误判成 quota；
 *   - `401/403` 只在文本明确「套餐到期」时才归 quota，否则一律 credential_invalid；
 *   - `credential_invalid` 可兜底但**永远只能询问**（askOnly=true）；
 *   - `rate_limited` / `transient` / `content_policy` / `provider_error` / `unknown`
 *     一律 fallbackEligible=false。
 */

const ACCESS_STATES = Object.freeze({
  QUOTA_EXHAUSTED: 'quota_exhausted',
  CREDENTIAL_INVALID: 'credential_invalid',
  RATE_LIMITED: 'rate_limited',
  TRANSIENT: 'transient',
  CONTENT_POLICY: 'content_policy',
  PROVIDER_ERROR: 'provider_error',
  UNKNOWN: 'unknown',
})

const QUOTA_KINDS = Object.freeze({
  BALANCE: 'balance',
  PLAN_WINDOW: 'plan_window',
  PLAN_EXPIRED: 'plan_expired',
  UNKNOWN: 'unknown',
})

/** 产品级错误码（renderer 的 userErrors.* 与 userErrorCode 字段同源） */
const MODEL_ACCESS_PRODUCT_CODES = Object.freeze({
  QUOTA_EXHAUSTED: 'MODEL_QUOTA_EXHAUSTED',
  QUOTA_PLAN_WINDOW: 'MODEL_QUOTA_PLAN_WINDOW',
  QUOTA_PLAN_EXPIRED: 'MODEL_QUOTA_PLAN_EXPIRED',
  CREDENTIAL_INVALID: 'MODEL_CREDENTIAL_INVALID',
  RATE_LIMITED: 'MODEL_RATE_LIMITED',
})

// ─── 文本模式 ────────────────────────────────────────────────────────────
// 与 provider-error.js 的 QUOTA_MESSAGE_PATTERN 保持同一语义域；本文件独立实现是为了
// 不把「用户提示」耦合进「重试分类」的枚举（两套枚举由测试锁交集，不互相 require）。
const QUOTA_TEXT_PATTERN = /(?:insufficient|exhausted|exceeded|out\s+of)[^\n]{0,40}(?:quota|balance|token|credit)|(?:quota|balance|token|credit)s?[^\n]{0,40}(?:exceeded|insufficient|exhausted)|credit\s+balance[^\n]{0,30}(?:too\s+low|low|insufficient)|(?:余额|额度|配额)[^\n]{0,20}(?:不足|不够|超|耗尽|用尽|用完)|insufficient[_\s]*balance|billing|payment\s*required|(?:用量|token\s*plan|额度)[^\n]{0,24}(?:上限|超|耗尽|用尽|用完)|(?:套餐|plan)[^\n]{0,24}(?:expired|到期|过期)/i
const RATE_TEXT_PATTERN = /\brate[\s_-]?limit\b|too\s+many\s+requests|rpm\s+exhausted|429\s+Too\s+Many|限流|请求频率|请求过于频繁/i
const CREDENTIAL_TEXT_PATTERN = /invalid\s+api[ _-]?key|api[ _-]?key[^\n]{0,24}(?:invalid|expired|失效|过期|无效|错误|不正确)|(?:invalid|expired)\s+api[ _-]?key|authentication\s+(?:failed|error)|unauthorized|access\s+denied|credential|认证失败|密钥[^\n]{0,12}(?:无效|过期)/i
const PLAN_EXPIRED_PATTERN = /plan[^\n]{0,24}(?:expired|到期)|套餐[^\n]{0,12}(?:到期|过期)|订阅[^\n]{0,12}(?:到期|过期)|续费/i
const PLAN_WINDOW_PATTERN = /5\s*(?:小时|hour)|token\s*plan|用量窗口|额度窗口|per\s*5|5h\b|monthly|每月|每日|daily|日限额|月限额/i
const BALANCE_PATTERN = /balance|余额|充值|credit|credits|欠费|insufficient|payment/i

// ─── 供应商业务码规则 ────────────────────────────────────────────────────
// 只登记「有仓内适配器/测试实证」的码；新增供应商必须同时补分类器测试。
// 深冻结：不仅冻结数组引用，也冻结每条规则与 codes 数组，防止消费方原地修改污染后续分类（深评 i7）。
const PROVIDER_CODE_RULES = Object.freeze([
  { provider: 'minimax', codes: ['1004'], state: ACCESS_STATES.CREDENTIAL_INVALID, quotaKind: null },
  { provider: 'minimax', codes: ['2056'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.PLAN_WINDOW },
  { provider: 'openai', codes: ['insufficient_quota', 'billing_hard_limit_reached'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.BALANCE },
  { provider: 'openai', codes: ['rate_limit_exceeded'], state: ACCESS_STATES.RATE_LIMITED, quotaKind: null },
  { provider: 'anthropic', codes: ['credit_balance_too_low', 'credit balance is too low'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.BALANCE },
  { provider: 'anthropic', codes: ['authentication_error'], state: ACCESS_STATES.CREDENTIAL_INVALID, quotaKind: null },
  { provider: 'anthropic', codes: ['rate_limit_error'], state: ACCESS_STATES.RATE_LIMITED, quotaKind: null },
  { provider: 'gemini', codes: ['RESOURCE_EXHAUSTED'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.UNKNOWN },
  { provider: 'gemini', codes: ['API_KEY_INVALID'], state: ACCESS_STATES.CREDENTIAL_INVALID, quotaKind: null },
  { provider: 'deepseek', codes: ['Insufficient Balance', 'insufficient_balance'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.BALANCE },
  { provider: 'deepseek', codes: ['Authentication Fails'], state: ACCESS_STATES.CREDENTIAL_INVALID, quotaKind: null },
  { provider: 'openrouter', codes: ['Insufficient credits'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.BALANCE },
].map((rule) => Object.freeze({ ...rule, codes: Object.freeze([...rule.codes]) })))

function asString (value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/**
 * 归一化供应商业务码：数字转字符串，允许空格/点/冒号/下划线/连字符。
 * 非法（过长、控制字符、空）→ null，不把原始异常串带进 UI。
 * @param {*} value
 * @returns {string|null}
 */
function normalizeProviderCode (value) {
  const text = asString(value).trim()
  if (!text || text.length > 64) return null
  if (!/^[A-Za-z0-9_.: -]+$/.test(text)) return null
  return text
}

function normalizeHttpStatus (value) {
  const num = Number(value)
  if (!Number.isInteger(num) || num < 100 || num > 599) return null
  return num
}

function pickFirstString (...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * 从 ProviderError 的 context / 自身字段里取 HTTP 状态。
 * 兼容历史：MiniMax 适配器把业务码（1004/2056）放在 context.statusCode。
 */
function extractHttpStatus (error) {
  const context = error && typeof error.context === 'object' && error.context ? error.context : {}
  return normalizeHttpStatus(context.httpStatus) ||
    normalizeHttpStatus(context.statusCode) ||
    normalizeHttpStatus(error && error.httpStatus) ||
    normalizeHttpStatus(error && error.statusCode)
}

function extractProviderCode (error) {
  const context = error && typeof error.context === 'object' && error.context ? error.context : {}
  const explicit = normalizeProviderCode(context.providerCode) || normalizeProviderCode(error && error.providerCode)
  if (explicit) return explicit
  // 历史形态：context.statusCode 不是 HTTP 码时，它就是供应商业务码。
  const legacy = context.statusCode
  if (legacy !== undefined && legacy !== null && normalizeHttpStatus(legacy) === null) {
    return normalizeProviderCode(legacy)
  }
  return null
}

/**
 * 收集错误文本（有界、去重、不含堆栈与请求头）。
 * @param {*} error
 * @param {number} depth
 * @returns {string}
 */
function collectErrorText (error, depth = 0) {
  if (!error || depth > 3) return ''
  if (typeof error === 'string') return error.slice(0, 2000)
  if (typeof error !== 'object') return ''
  const parts = []
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim().slice(0, 2000))
  }
  push(error.message)
  push(error.msg)
  push(error.status_msg)
  push(error.error)
  const context = error.context && typeof error.context === 'object' ? error.context : null
  if (context) {
    push(context.message)
    push(context.status_msg)
  }
  const data = error.data && typeof error.data === 'object' ? error.data : null
  if (data) {
    push(data.message)
    push(data.msg)
    if (data.base_resp && typeof data.base_resp === 'object') push(data.base_resp.status_msg)
    if (data.error && typeof data.error === 'object') {
      push(data.error.message)
      push(data.error.type)
      push(data.error.code)
    }
  }
  return [...new Set(parts)].join('\n')
}

function normalizeRuleCode (value) {
  return asString(value).trim().toLowerCase()
}

function providerMatches (providerId, ruleProvider) {
  const id = asString(providerId).trim().toLowerCase()
  const rule = asString(ruleProvider).trim().toLowerCase()
  if (!id || !rule) return false
  return id === rule || id.startsWith(rule + '-')
}

/**
 * 校验注入规则：只接受已知 state / quotaKind / provider / 非空 codes。
 * 非法规则静默跳过（不让恶意配置把 state 改成任意值，深评 i5）。
 * @param {*} rule
 * @returns {{provider:string, codes:string[], state:string, quotaKind:string|null}|null}
 */
function normalizeRule (rule) {
  if (!rule || typeof rule !== 'object') return null
  const provider = asString(rule.provider).trim().toLowerCase()
  const codes = Array.isArray(rule.codes)
    ? rule.codes.map(normalizeRuleCode).filter(Boolean)
    : []
  const state = asString(rule.state).trim()
  if (!provider || !codes.length || !Object.values(ACCESS_STATES).includes(state)) return null
  let quotaKind = rule.quotaKind || null
  if (state === ACCESS_STATES.QUOTA_EXHAUSTED) {
    if (quotaKind && !Object.values(QUOTA_KINDS).includes(quotaKind)) return null
    quotaKind = quotaKind || QUOTA_KINDS.UNKNOWN
  } else {
    quotaKind = null
  }
  return { provider, codes, state, quotaKind }
}

function matchProviderCodeRule (providerId, providerCode, rules = PROVIDER_CODE_RULES) {
  if (!providerCode) return null
  const code = normalizeRuleCode(providerCode)
  for (const rawRule of rules) {
    const rule = normalizeRule(rawRule)
    if (!rule) continue
    if (!providerMatches(providerId, rule.provider)) continue
    if (rule.codes.some((item) => item === code)) return rule
  }
  return null
}

/**
 * 从文本推导额度子类；推导不出返回 unknown。
 * @param {string} text
 * @returns {'balance'|'plan_window'|'plan_expired'|'unknown'}
 */
function quotaKindFromText (text) {
  const value = asString(text)
  if (!value) return QUOTA_KINDS.UNKNOWN
  if (PLAN_EXPIRED_PATTERN.test(value)) return QUOTA_KINDS.PLAN_EXPIRED
  if (PLAN_WINDOW_PATTERN.test(value)) return QUOTA_KINDS.PLAN_WINDOW
  if (BALANCE_PATTERN.test(value)) return QUOTA_KINDS.BALANCE
  return QUOTA_KINDS.UNKNOWN
}

function productCodeFor (state, quotaKind) {
  if (state === ACCESS_STATES.QUOTA_EXHAUSTED) {
    if (quotaKind === QUOTA_KINDS.PLAN_EXPIRED) return MODEL_ACCESS_PRODUCT_CODES.QUOTA_PLAN_EXPIRED
    if (quotaKind === QUOTA_KINDS.PLAN_WINDOW) return MODEL_ACCESS_PRODUCT_CODES.QUOTA_PLAN_WINDOW
    return MODEL_ACCESS_PRODUCT_CODES.QUOTA_EXHAUSTED
  }
  if (state === ACCESS_STATES.CREDENTIAL_INVALID) return MODEL_ACCESS_PRODUCT_CODES.CREDENTIAL_INVALID
  if (state === ACCESS_STATES.RATE_LIMITED) return MODEL_ACCESS_PRODUCT_CODES.RATE_LIMITED
  return null
}

function reasonKeyFor (state, quotaKind) {
  if (state === ACCESS_STATES.QUOTA_EXHAUSTED) {
    if (quotaKind === QUOTA_KINDS.BALANCE) return 'modelQuota.reason.quota.balance'
    if (quotaKind === QUOTA_KINDS.PLAN_WINDOW) return 'modelQuota.reason.quota.planWindow'
    if (quotaKind === QUOTA_KINDS.PLAN_EXPIRED) return 'modelQuota.reason.quota.planExpired'
    return 'modelQuota.reason.quota.unknown'
  }
  if (state === ACCESS_STATES.CREDENTIAL_INVALID) return 'modelQuota.reason.credential'
  if (state === ACCESS_STATES.RATE_LIMITED) return 'modelQuota.reason.rate'
  if (state === ACCESS_STATES.PROVIDER_ERROR) return 'modelQuota.reason.provider'
  return 'modelQuota.reason.unknown'
}

/**
 * 脱敏错误摘要：去 API Key / Bearer / 过长文本。
 * @param {*} error
 * @returns {string}
 */
function sanitizeErrorMessage (error) {
  const text = typeof error === 'string' ? error : collectErrorText(error)
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\bAuthorization\s*[:=]\s*[^\s,;]{8,}/gi, 'Authorization: [redacted]')
    // JWT：三段 base64url，常见于供应商把请求头/调试信息塞进错误文本。
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]')
    .replace(/(api[_-]?key\s*[=:]\s*)[^\s,;]{8,}/gi, '$1[redacted]')
    .slice(0, 500)
}

/**
 * 解析 Retry-After（秒数或 HTTP-date）；只接受 0..7 天。
 * @param {object|Headers|null} headers
 * @param {number} [now]
 * @returns {number|null}
 */
function parseRetryAfterMs (headers, now = Date.now()) {
  if (!headers || typeof headers !== 'object') return null
  let raw
  if (typeof headers.get === 'function') {
    try { raw = headers.get('retry-after') } catch (_) { raw = null }
  }
  if (raw === undefined || raw === null) {
    for (const key of Object.keys(headers)) {
      if (String(key).toLowerCase() === 'retry-after') { raw = headers[key]; break }
    }
  }
  if (raw === undefined || raw === null || raw === '') return null
  const asNumber = Number(raw)
  if (Number.isFinite(asNumber)) {
    if (asNumber < 0) return null
    const ms = Math.round(asNumber * 1000)
    return ms <= 7 * 24 * 60 * 60 * 1000 ? ms : null
  }
  const date = Date.parse(String(raw))
  if (!Number.isFinite(date)) return null
  const delta = date - now
  if (delta < 0) return 0
  return delta <= 7 * 24 * 60 * 60 * 1000 ? delta : null
}

function buildResult ({ state, quotaKind = null, httpStatus = null, providerCode = null, retryAfterMs = null, reasonKey = null, safeMessage = '' }) {
  const quota = state === ACCESS_STATES.QUOTA_EXHAUSTED
  return Object.freeze({
    state,
    quotaKind: quota ? (quotaKind || QUOTA_KINDS.UNKNOWN) : null,
    httpStatus,
    providerCode,
    retryAfterMs,
    fallbackEligible: quota || state === ACCESS_STATES.CREDENTIAL_INVALID,
    askOnly: state === ACCESS_STATES.CREDENTIAL_INVALID,
    productCode: productCodeFor(state, quotaKind || QUOTA_KINDS.UNKNOWN),
    reasonKey: reasonKey || reasonKeyFor(state, quotaKind || QUOTA_KINDS.UNKNOWN),
    safeMessage,
  })
}

/**
 * 主分类器。永不抛错：内部异常一律降级为 unknown。
 * @param {*} error ProviderError | Error | 普通对象
 * @param {{ providerId?: string }} [options]
 * @returns {Readonly<object>}
 */
function classifyModelAccessFailure (error, options = {}) {
  try {
    if (!error) return buildResult({ state: ACCESS_STATES.UNKNOWN, safeMessage: '' })

    const providerId = pickFirstString(
      options && options.providerId,
      error && error.context && error.context.providerId,
      error && error.providerId,
    )
    const httpStatus = extractHttpStatus(error)
    const providerCode = extractProviderCode(error)
    // 文本上限：collectErrorText 已对每个来源截 2000 字，这里再收敛到 4000 字再跑正则，
    // 避免超长错误体把多语言正则的匹配成本放大（性能审查 i4）。
    const text = collectErrorText(error).slice(0, 4000)
    const safeMessage = sanitizeErrorMessage(error)
    const code = asString(error && error.code).trim().toUpperCase()

    // 规则可注入：默认用仓内实证表；调用方/插件可在不修改本文件的前提下扩展（性能/可维护审查 i5）。
    const rules = Array.isArray(options && options.providerCodeRules)
      ? options.providerCodeRules
      : PROVIDER_CODE_RULES
    const rule = matchProviderCodeRule(providerId, providerCode, rules)
    if (rule) {
      let quotaKind = rule.quotaKind
      if (rule.state === ACCESS_STATES.QUOTA_EXHAUSTED && quotaKind === QUOTA_KINDS.PLAN_WINDOW && PLAN_EXPIRED_PATTERN.test(text)) {
        quotaKind = QUOTA_KINDS.PLAN_EXPIRED
      }
      if (rule.state === ACCESS_STATES.QUOTA_EXHAUSTED && quotaKind === QUOTA_KINDS.UNKNOWN) {
        quotaKind = quotaKindFromText(text)
      }
      return buildResult({ state: rule.state, quotaKind, httpStatus, providerCode, safeMessage, retryAfterMs: parseRetryAfterMs(error && error.headers) })
    }

    if (code === 'QUOTA_EXCEEDED') {
      return buildResult({ state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: quotaKindFromText(text), httpStatus, providerCode, safeMessage })
    }
    if (code === 'AUTH_FAILED') {
      // 安全边界（深评 i6）：认证失败**不得**因为文本里出现「套餐到期/续费」就升级成 quota。
      // 401/403 可能被错误配置或恶意响应污染；quota 动作会打开「使用官方模型」的消费路径。
      // 真正的套餐到期应通过供应商额度业务码（如 MiniMax 2056）或 402 表达，而不是认证错误文本。
      return buildResult({ state: ACCESS_STATES.CREDENTIAL_INVALID, httpStatus, providerCode, safeMessage })
    }
    if (code === 'RATE_LIMITED') {
      if (QUOTA_TEXT_PATTERN.test(text) && !RATE_TEXT_PATTERN.test(text)) {
        return buildResult({ state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: quotaKindFromText(text), httpStatus, providerCode, safeMessage })
      }
      return buildResult({ state: ACCESS_STATES.RATE_LIMITED, httpStatus, providerCode, safeMessage, retryAfterMs: parseRetryAfterMs(error && error.headers) })
    }
    if (code === 'TIMEOUT' || code === 'NETWORK_ERROR') {
      return buildResult({ state: ACCESS_STATES.TRANSIENT, httpStatus, providerCode, safeMessage })
    }
    if (code === 'CONTENT_POLICY') {
      return buildResult({ state: ACCESS_STATES.CONTENT_POLICY, httpStatus, providerCode, safeMessage })
    }

    if (httpStatus === 401 || httpStatus === 403) {
      // 同 AUTH_FAILED：认证错误文本不能被当作额度/到期证据（深评 i6，安全边界）。
      return buildResult({ state: ACCESS_STATES.CREDENTIAL_INVALID, httpStatus, providerCode, safeMessage })
    }
    if (httpStatus === 402) {
      return buildResult({ state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: quotaKindFromText(text), httpStatus, providerCode, safeMessage })
    }
    if (httpStatus === 429) {
      if (QUOTA_TEXT_PATTERN.test(text) && !RATE_TEXT_PATTERN.test(text)) {
        return buildResult({ state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: quotaKindFromText(text), httpStatus, providerCode, safeMessage })
      }
      return buildResult({ state: ACCESS_STATES.RATE_LIMITED, httpStatus, providerCode, safeMessage, retryAfterMs: parseRetryAfterMs(error && error.headers) })
    }
    if (httpStatus !== null && (httpStatus === 0 || httpStatus >= 500)) {
      return buildResult({ state: ACCESS_STATES.TRANSIENT, httpStatus, providerCode, safeMessage })
    }

    if (QUOTA_TEXT_PATTERN.test(text)) {
      return buildResult({ state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: quotaKindFromText(text), httpStatus, providerCode, safeMessage })
    }
    if (CREDENTIAL_TEXT_PATTERN.test(text)) {
      return buildResult({ state: ACCESS_STATES.CREDENTIAL_INVALID, httpStatus, providerCode, safeMessage })
    }
    if (RATE_TEXT_PATTERN.test(text)) {
      return buildResult({ state: ACCESS_STATES.RATE_LIMITED, httpStatus, providerCode, safeMessage, retryAfterMs: parseRetryAfterMs(error && error.headers) })
    }
    if (/timed?\s*out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|network\s*error|fetch\s+failed|socket\s+hang\s+up|超时|网络|5\d\d\s*(?:error|server)/i.test(text)) {
      return buildResult({ state: ACCESS_STATES.TRANSIENT, httpStatus, providerCode, safeMessage })
    }

    // 有错误对象但不是上面任何一类：可归 provider_error；完全空对象才 unknown。
    const hasAnyText = Boolean(text)
    return buildResult({
      state: hasAnyText ? ACCESS_STATES.PROVIDER_ERROR : ACCESS_STATES.UNKNOWN,
      httpStatus,
      providerCode,
      safeMessage,
    })
  } catch (_) {
    return buildResult({ state: ACCESS_STATES.UNKNOWN, safeMessage: '' })
  }
}

module.exports = {
  ACCESS_STATES,
  QUOTA_KINDS,
  MODEL_ACCESS_PRODUCT_CODES,
  PROVIDER_CODE_RULES,
  classifyModelAccessFailure,
  normalizeProviderCode,
  normalizeHttpStatus,
  parseRetryAfterMs,
  sanitizeErrorMessage,
  quotaKindFromText,
  productCodeFor,
}
