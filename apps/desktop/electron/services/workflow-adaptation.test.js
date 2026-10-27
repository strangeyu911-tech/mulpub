// @ts-check
const { normalizeAdaptation, validateAdaptation, profileForTarget, adaptArticle } = require('./workflow-adaptation')

const PLATFORMS = ['zhihu', 'weibo']

describe('workflow-adaptation · 归一化与校验', () => {
  it('归一化保留平台/账号 profile，非法标签留给校验拒绝', () => {
    const a = normalizeAdaptation({
      enabled: true,
      byPlatform: { zhihu: { titleMaxLength: 20, bodyMaxLength: 1000, titleSuffix: ' | 知乎', tags: ['AI', '', 'x'.repeat(40)] } },
      byAccount: { acc1: { titleMaxLength: 10 } },
    })
    expect(a.enabled).toBe(true)
    expect(a.byPlatform.zhihu.titleMaxLength).toBe(20)
    expect(a.byPlatform.zhihu.tags).toEqual(['AI', 'x'.repeat(40)])
    expect(a.byAccount.acc1.titleMaxLength).toBe(10)
    expect(validateAdaptation(a, PLATFORMS).some((e) => e.reason === 'tooLong')).toBe(true)
  })

  it('非整数/越界标题正文长度被拒绝，不静默归零', () => {
    const a = normalizeAdaptation({
      enabled: true,
      byPlatform: { zhihu: { titleMaxLength: 10.5, bodyMaxLength: '100' } },
    })
    const errors = validateAdaptation(a, PLATFORMS)
    expect(errors.some((e) => e.field.includes('titleMaxLength'))).toBe(true)
    expect(errors.some((e) => e.field.includes('bodyMaxLength'))).toBe(true)
  })

  it('启用但没有任何 profile 时报 empty', () => {
    const a = normalizeAdaptation({ enabled: true })
    expect(validateAdaptation(a, PLATFORMS)).toContainEqual({ field: 'content.adaptation', reason: 'empty' })
  })

  it('未知平台、越界字数被拒绝', () => {
    const a = normalizeAdaptation({ enabled: true, byPlatform: { unknown: {}, zhihu: { titleMaxLength: 999 } } })
    const errors = validateAdaptation(a, PLATFORMS)
    expect(errors.some((e) => e.reason === 'unsupported')).toBe(true)
    expect(errors.some((e) => e.field.includes('titleMaxLength'))).toBe(true)
  })

  it('账号 profile 优先级高于平台 profile', () => {
    const a = normalizeAdaptation({
      enabled: true,
      byPlatform: { zhihu: { titleMaxLength: 20 } },
      byAccount: { acc1: { titleMaxLength: 8 } },
    })
    expect(profileForTarget(a, { platform: 'zhihu', accountId: 'acc1' }).titleMaxLength).toBe(8)
    expect(profileForTarget(a, { platform: 'zhihu', accountId: 'acc2' }).titleMaxLength).toBe(20)
  })
})

describe('workflow-adaptation · 文本变换', () => {
  const adaptation = normalizeAdaptation({
    enabled: true,
    byPlatform: {
      zhihu: { titleMaxLength: 10, bodyMaxLength: 20, titleSuffix: ' | 知乎', tags: ['AI', '知乎'] },
    },
  })

  it('标题截断后拼后缀，正文截断并加省略号，标签去重合并', () => {
    const article = { title: '这是一个很长的标题超过十个字', content: 'x'.repeat(50), tags: ['AI'] }
    const out = adaptArticle(article, { platform: 'zhihu', accountId: 'a1' }, adaptation)
    expect(out.title).toBe('这是一个很 | 知乎')
    expect(out.title.length).toBe(10)
    expect(out.content.length).toBe(20)
    expect(out.content.endsWith('…')).toBe(true)
    expect(out.tags).toEqual(['AI', '知乎'])
    expect(out.adaptation).toMatchObject({ platform: 'zhihu', titleMaxLength: 10 })
  })

  it('后缀比标题上限长时只保留上限内后缀，不超长', () => {
    const a = normalizeAdaptation({ enabled: true, byPlatform: { zhihu: { titleMaxLength: 5, titleSuffix: '1234567890' } } })
    const out = adaptArticle({ title: '标题', content: '正文' }, { platform: 'zhihu', accountId: 'a1' }, a)
    expect(out.title.length).toBe(5)
    expect(out.title).toBe('12345')
  })

  it('未启用或无 profile 时原样返回', () => {
    const article = { title: 't', content: 'c' }
    expect(adaptArticle(article, { platform: 'weibo' }, adaptation)).toBe(article)
    expect(adaptArticle(article, { platform: 'zhihu' }, normalizeAdaptation())).toBe(article)
  })
})
