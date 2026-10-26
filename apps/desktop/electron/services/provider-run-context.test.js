// @vitest-environment node
'use strict'

const {
  ProviderError,
  ERROR_CODES,
  classifyProviderFailure,
} = require('./adapters/_base/provider-error')

const { ProviderRunContext, ProviderCircuitOpenError } = require('./provider-run-context')

describe('ProviderError quota classification variants', () => {
  it.each([
    'insufficient balance',
    '[QUOTA_EXCEEDED] insufficient balance',
    'Token Plan 用量上限',
    '已达到 Token Plan 用量上限',
    'Token Plan usage limit reached',
    'usage limit exceeded',
    '达到额度上限',
    '余额不足',
    'Remaining quota is insufficient',
  ])('classifies %s as quota', (message) => {
    expect(classifyProviderFailure(new Error(message))).toBe('quota')
  })

  it('classifies nested MiniMax base_resp quota payload as quota', () => {
    const error = new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'provider business failure', {
      providerId: 'minimax-tts',
      data: {
        base_resp: {
          status_code: 4002,
          status_msg: 'Token Plan usage limit reached',
        },
      },
    })
    expect(classifyProviderFailure(error)).toBe('quota')
  })

  it('keeps rate limit separate from quota', () => {
    expect(classifyProviderFailure(new Error('rate limit exceeded'))).toBe('rate')
    expect(classifyProviderFailure(new ProviderError(ERROR_CODES.RATE_LIMITED, 'too many requests'))).toBe('rate')
  })
})

describe('ProviderRunContext', () => {
  it('scopes breaker state by provider id', () => {
    const ctx = new ProviderRunContext()
    ctx.open('minimax-image', new Error('Token Plan usage limit reached'))
    expect(ctx.isOpen('minimax-image')).toBe(true)
    expect(ctx.isOpen('minimax-tts')).toBe(false)
    expect(() => ctx.assertAvailable('minimax-image')).toThrow(ProviderCircuitOpenError)
    expect(ctx.assertAvailable('minimax-tts')).toBeUndefined()
  })

  it('only opens on quota classification', () => {
    const ctx = new ProviderRunContext()
    expect(ctx.openIfQuota('openai', new Error('rate limit exceeded'))).toBe(false)
    expect(ctx.isOpen('openai')).toBe(false)
    expect(ctx.openIfQuota('openai', new Error('Token Plan usage limit reached'))).toBe(true)
    expect(ctx.isOpen('openai')).toBe(true)
  })
})

describe('ProviderRunContext modelSourceOverrides', () => {
  it('按 capability 读写来源覆盖，返回副本不暴露内部对象', () => {
    const ctx = new ProviderRunContext()
    expect(ctx.getModelSourceOverride('image')).toBeNull()
    ctx.setModelSourceOverride('image', { source: 'official', officialAttempts: 1 })
    const read = ctx.getModelSourceOverride('image')
    expect(read).toEqual({ source: 'official', officialAttempts: 1 })
    read.officialAttempts = 99
    expect(ctx.getModelSourceOverride('image').officialAttempts).toBe(1)
    expect(ctx.getModelSourceOverride('tts')).toBeNull()
  })

  it('清除单个/全部覆盖', () => {
    const ctx = new ProviderRunContext()
    ctx.setModelSourceOverride('image', { source: 'official' })
    ctx.setModelSourceOverride('tts', { source: 'official' })
    ctx.clearModelSourceOverride('image')
    expect(ctx.getModelSourceOverride('image')).toBeNull()
    expect(ctx.getModelSourceOverride('tts')).toEqual({ source: 'official', officialAttempts: 0 })
    ctx.clearModelSourceOverrides()
    expect(ctx.getModelSourceOverride('tts')).toBeNull()
  })

  it('非法 capability / source 被忽略，不影响既有 quota 熔断', () => {
    const ctx = new ProviderRunContext()
    ctx.setModelSourceOverride('', { source: 'official' })
    ctx.setModelSourceOverride('image', { source: 'invalid' })
    expect(ctx.getModelSourceOverride('image')).toBeNull()
    expect(ctx.openIfQuota('openai', new Error('insufficient balance'))).toBe(true)
    expect(ctx.isOpen('openai')).toBe(true)
  })
})

describe('ProviderRunContext.cloneVoiceOnce', () => {
  it('deduplicates concurrent clones and reuses the succeeded voice id', async () => {
    const ctx = new ProviderRunContext()
    const clone = vi.fn(async () => 'MiniMaxCloneVoice_new123')

    const first = ctx.cloneVoiceOnce({ providerId: 'minimax-tts', voiceId: 'MiniMaxCloneVoice_00jngz', fn: clone })
    const second = ctx.cloneVoiceOnce({ providerId: 'minimax-tts', voiceId: 'MiniMaxCloneVoice_00jngz', fn: clone })
    const results = await Promise.all([first, second])

    expect(clone).toHaveBeenCalledTimes(1)
    expect(results).toEqual([
      { succeeded: true, voiceId: 'MiniMaxCloneVoice_new123' },
      { succeeded: true, voiceId: 'MiniMaxCloneVoice_new123' },
    ])

    const reused = await ctx.cloneVoiceOnce({
      providerId: 'minimax-tts',
      voiceId: 'MiniMaxCloneVoice_00jngz',
      fn: clone,
    })
    expect(reused).toEqual({ succeeded: true, voiceId: 'MiniMaxCloneVoice_new123' })
    expect(clone).toHaveBeenCalledTimes(1)
  })

  it('records failure once and refuses another clone in the same run', async () => {
    const ctx = new ProviderRunContext()
    const clone = vi.fn(async () => { throw new Error('[QUOTA_EXCEEDED] insufficient balance') })

    const first = await ctx.cloneVoiceOnce({ providerId: 'minimax-tts', voiceId: 'MiniMaxCloneVoice_00jngz', fn: clone })
    const second = await ctx.cloneVoiceOnce({ providerId: 'minimax-tts', voiceId: 'MiniMaxCloneVoice_00jngz', fn: clone })

    expect(first.failed).toBe(true)
    expect(second.failed).toBe(true)
    expect(clone).toHaveBeenCalledTimes(1)
  })
})
