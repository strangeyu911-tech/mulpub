// @vitest-environment node
'use strict'

const {
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
} = require('./model-access-failure')

function makeError (message, context = {}, code = '') {
  const error = new Error(message)
  if (code) error.code = code
  error.context = context
  return error
}

describe('model-access-failure — 额度/凭据产品级分类', () => {
  it('HTTP 402 + Insufficient Balance → quota_exhausted / balance', () => {
    const result = classifyModelAccessFailure(makeError('Insufficient Balance', { httpStatus: 402 }, 'QUOTA_EXCEEDED'))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.BALANCE)
    expect(result.fallbackEligible).toBe(true)
    expect(result.askOnly).toBe(false)
    expect(result.productCode).toBe(MODEL_ACCESS_PRODUCT_CODES.QUOTA_EXHAUSTED)
  })

  it('OpenAI 429 insufficient_quota → quota（不是限流）', () => {
    const result = classifyModelAccessFailure(makeError('You exceeded your current quota', {
      httpStatus: 429,
      providerCode: 'insufficient_quota',
      providerId: 'openai',
    }))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.BALANCE)
  })

  it('OpenAI 429 rate_limit_exceeded → rate_limited（即使文本带 quota）', () => {
    const result = classifyModelAccessFailure(makeError('Rate limit reached for quota', {
      httpStatus: 429,
      providerCode: 'rate_limit_exceeded',
      providerId: 'openai',
    }))
    expect(result.state).toBe(ACCESS_STATES.RATE_LIMITED)
    expect(result.fallbackEligible).toBe(false)
    expect(result.productCode).toBe(MODEL_ACCESS_PRODUCT_CODES.RATE_LIMITED)
  })

  it('Anthropic 400 credit balance is too low → quota / balance', () => {
    const result = classifyModelAccessFailure(makeError('Your credit balance is too low to access the Anthropic API', {
      httpStatus: 400,
      providerId: 'anthropic',
    }))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.BALANCE)
  })

  it('MiniMax HTTP 200 + 业务码 1004 → credential_invalid，且只能询问', () => {
    const result = classifyModelAccessFailure(makeError('Invalid api key', {
      httpStatus: 200,
      providerCode: 1004,
      statusCode: 1004,
      providerId: 'minimax-image',
    }))
    expect(result.state).toBe(ACCESS_STATES.CREDENTIAL_INVALID)
    expect(result.fallbackEligible).toBe(true)
    expect(result.askOnly).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(result.providerCode).toBe('1004')
    expect(result.productCode).toBe(MODEL_ACCESS_PRODUCT_CODES.CREDENTIAL_INVALID)
  })

  it('MiniMax 2056「已达到 Token Plan 用量上限」→ quota / plan_window', () => {
    const result = classifyModelAccessFailure(makeError('已达到 Token Plan 用量上限', {
      httpStatus: 200,
      providerCode: 2056,
      statusCode: 2056,
      providerId: 'minimax-image',
    }))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.PLAN_WINDOW)
    expect(result.productCode).toBe(MODEL_ACCESS_PRODUCT_CODES.QUOTA_PLAN_WINDOW)
  })

  it('MiniMax 2056「Your plan has expired」→ quota / plan_expired', () => {
    const result = classifyModelAccessFailure(makeError('Your plan has expired, please upgrade to continue', {
      httpStatus: 200,
      providerCode: 2056,
      statusCode: 2056,
      providerId: 'minimax-tts',
    }))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.PLAN_EXPIRED)
    expect(result.productCode).toBe(MODEL_ACCESS_PRODUCT_CODES.QUOTA_PLAN_EXPIRED)
  })

  it('HTTP 401 → credential_invalid / askOnly', () => {
    const result = classifyModelAccessFailure(makeError('Unauthorized', { httpStatus: 401 }, 'AUTH_FAILED'))
    expect(result.state).toBe(ACCESS_STATES.CREDENTIAL_INVALID)
    expect(result.askOnly).toBe(true)
  })

  it('HTTP 403 + 套餐到期文本 → 仍判 credential_invalid（认证错误不得升级成 quota，深评 i6）', () => {
    const result = classifyModelAccessFailure(makeError('套餐已到期，请续费', { httpStatus: 403 }))
    expect(result.state).toBe(ACCESS_STATES.CREDENTIAL_INVALID)
    expect(result.askOnly).toBe(true)
  })

  it('HTTP 429 纯 Too Many Requests → rate_limited', () => {
    const result = classifyModelAccessFailure(makeError('Too Many Requests', { httpStatus: 429 }))
    expect(result.state).toBe(ACCESS_STATES.RATE_LIMITED)
    expect(result.fallbackEligible).toBe(false)
  })

  it('HTTP 500 → transient', () => {
    const result = classifyModelAccessFailure(makeError('Internal Server Error', { httpStatus: 500 }))
    expect(result.state).toBe(ACCESS_STATES.TRANSIENT)
  })

  it('空错误对象 → unknown（保守）', () => {
    const result = classifyModelAccessFailure({})
    expect(result.state).toBe(ACCESS_STATES.UNKNOWN)
    expect(result.fallbackEligible).toBe(false)
  })

  it('ProviderError.code=RATE_LIMITED 但文本是额度语义且无 rate 词 → quota', () => {
    const result = classifyModelAccessFailure(makeError('insufficient balance', {}, 'RATE_LIMITED'))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
  })

  it('ProviderError.code=QUOTA_EXCEEDED 文本含 5 小时窗口 → plan_window', () => {
    const result = classifyModelAccessFailure(makeError('Token Plan 5 小时用量窗口已用尽', {}, 'QUOTA_EXCEEDED'))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.PLAN_WINDOW)
  })

  it('不抛错：传入 null / 循环对象也返回 unknown', () => {
    expect(classifyModelAccessFailure(null).state).toBe(ACCESS_STATES.UNKNOWN)
    const circular = {}
    circular.self = circular
    expect(classifyModelAccessFailure(circular).state).toBe(ACCESS_STATES.UNKNOWN)
  })
})

describe('model-access-failure — 脱敏与边界', () => {
  it('sanitizeErrorMessage 清除 sk- / Bearer / Authorization / JWT / api_key', () => {
    const text = sanitizeErrorMessage('bad key sk-abcdef1234567890 Bearer abc.def.ghi Authorization: Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk api_key=supersecret123')
    expect(text).not.toContain('sk-abcdef1234567890')
    expect(text).not.toContain('Bearer abc.def.ghi')
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(text).not.toContain('supersecret123')
    expect(text).toContain('[redacted]')
  })

  it('PROVIDER_CODE_RULES 深冻结（规则对象与 codes 数组都不可变，深评 i7）', () => {
    expect(Object.isFrozen(PROVIDER_CODE_RULES)).toBe(true)
    expect(Object.isFrozen(PROVIDER_CODE_RULES[0])).toBe(true)
    expect(Object.isFrozen(PROVIDER_CODE_RULES[0].codes)).toBe(true)
  })

  it('非法注入规则被跳过（state 不在枚举 / codes 为空，深评 i5）', () => {
    const result = classifyModelAccessFailure(
      makeError('x', { providerId: 'acme-llm', providerCode: 'E_BAD' }),
      { providerCodeRules: [{ provider: 'acme', codes: ['E_BAD'], state: 'not_a_state' }] },
    )
    expect(result.state).not.toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.productCode).not.toBe(MODEL_ACCESS_PRODUCT_CODES.QUOTA_EXHAUSTED)
  })

  it('sanitizeErrorMessage 截断 500 字', () => {
    expect(sanitizeErrorMessage('x'.repeat(900)).length).toBe(500)
  })

  it('normalizeProviderCode 接受数字/短字符串，拒绝空/超长/控制字符', () => {
    expect(normalizeProviderCode(1004)).toBe('1004')
    expect(normalizeProviderCode(' insufficient_quota ')).toBe('insufficient_quota')
    expect(normalizeProviderCode('')).toBeNull()
    expect(normalizeProviderCode('x'.repeat(65))).toBeNull()
    expect(normalizeProviderCode('bad\u0000code')).toBeNull()
  })

  it('normalizeHttpStatus 只接受 100..599', () => {
    expect(normalizeHttpStatus(402)).toBe(402)
    expect(normalizeHttpStatus('429')).toBe(429)
    expect(normalizeHttpStatus(200)).toBe(200)
    expect(normalizeHttpStatus(1004)).toBeNull()
    expect(normalizeHttpStatus('abc')).toBeNull()
  })

  it('parseRetryAfterMs 支持秒数与 HTTP-date，拒绝负数/超 7 天/非法', () => {
    expect(parseRetryAfterMs({ 'retry-after': '30' })).toBe(30000)
    expect(parseRetryAfterMs({ 'Retry-After': '0' })).toBe(0)
    expect(parseRetryAfterMs({ 'retry-after': '-1' })).toBeNull()
    expect(parseRetryAfterMs({ 'retry-after': '999999999' })).toBeNull()
    expect(parseRetryAfterMs({ 'retry-after': 'not-a-date' })).toBeNull()
    const inOneMinute = new Date(Date.now() + 60_000).toUTCString()
    expect(parseRetryAfterMs({ 'retry-after': inOneMinute })).toBeGreaterThan(0)
  })

  it('quotaKindFromText 优先级：plan_expired > plan_window > balance > unknown', () => {
    expect(quotaKindFromText('套餐已到期，请续费')).toBe(QUOTA_KINDS.PLAN_EXPIRED)
    expect(quotaKindFromText('Token Plan 5 小时窗口已用尽')).toBe(QUOTA_KINDS.PLAN_WINDOW)
    expect(quotaKindFromText('余额不足，请充值')).toBe(QUOTA_KINDS.BALANCE)
    expect(quotaKindFromText('额度不足')).toBe(QUOTA_KINDS.UNKNOWN)
  })

  it('超长错误文本先截断到 4000 字再匹配，仍能识别额度（性能审查 i4）', () => {
    const long = 'Insufficient Balance ' + 'x'.repeat(100_000)
    const result = classifyModelAccessFailure(makeError(long))
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.BALANCE)
  })

  it('providerCodeRules 可注入：新增供应商无需改核心文件（可维护审查 i5）', () => {
    const result = classifyModelAccessFailure(
      makeError('custom quota', { providerId: 'acme-llm', providerCode: 'E_QUOTA' }),
      { providerCodeRules: [{ provider: 'acme', codes: ['E_QUOTA'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.BALANCE }] },
    )
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.BALANCE)
  })

  it('注入规则的 provider 大小写不敏感（深评 i2）', () => {
    const result = classifyModelAccessFailure(
      makeError('custom quota', { providerId: 'ACME-LLM', providerCode: 'E_QUOTA' }),
      { providerCodeRules: [{ provider: 'Acme', codes: ['E_QUOTA'], state: ACCESS_STATES.QUOTA_EXHAUSTED, quotaKind: QUOTA_KINDS.BALANCE }] },
    )
    expect(result.state).toBe(ACCESS_STATES.QUOTA_EXHAUSTED)
    expect(result.quotaKind).toBe(QUOTA_KINDS.BALANCE)
  })
})
