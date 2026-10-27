/**
 * workflow-source.test.js — 三类来源的归一化与排序
 *
 * 主线：① 热门选题按类别过滤 + 「最新 N 条」按时间而非热度
 * ② 关注博主按 (platform, externalId) 去重 ③ 知乎收藏夹按收藏时间倒序
 * ④ 单个来源失败只出声，不拖垮其他来源
 */
const { createWorkflowSources } = require('./workflow-source')

const NOW = Date.parse('2026-10-26T10:00:00+08:00')

function deps (patch = {}) {
  return {
    hotTopics: {
      fetchTopics: async () => ({
        topics: [
          { id: 'h1', topic: '旧热点', channel: 'zhihu', category: 'ai', categories: ['ai'], score: 99, fetchedAt: '2026-10-26T01:00:00.000Z', url: 'https://t/1' },
          { id: 'h2', topic: '新热点', channel: 'weibo', category: 'tech', categories: ['tech'], score: 10, fetchedAt: '2026-10-26T09:00:00.000Z', url: 'https://t/2' },
          { id: 'h3', topic: '娱乐热点', channel: 'weibo', category: 'entertainment', categories: ['entertainment'], score: 50, fetchedAt: '2026-10-26T05:00:00.000Z', url: 'https://t/3' },
        ],
      }),
    },
    creator: {
      listNewDiscoveries: async () => [
        { id: 'd1', platform: 'youtube', externalId: 'v1', title: '视频1', url: 'https://y/1', publishedAt: '2026-10-26T08:00:00.000Z' },
        { id: 'd2', platform: 'youtube', externalId: 'v1', title: '视频1 重复', url: 'https://y/1?dup', publishedAt: '2026-10-26T08:00:00.000Z' },
        { id: 'd3', platform: 'douyin', externalId: 'v2', title: '视频2', url: 'https://d/2', publishedAt: '2026-10-25T08:00:00.000Z' },
      ],
    },
    zhihu: {
      listFolderItems: async () => [
        { contentType: 'article', url: 'https://zhuanlan.zhihu.com/p/1', title: '旧文', summary: '摘要1', favTime: '2026-10-20T00:00:00.000Z' },
        { contentType: 'answer', url: 'https://www.zhihu.com/question/2/answer/3', title: '新文', summary: '摘要2', favTime: '2026-10-25T00:00:00.000Z' },
      ],
    },
    log: { warn: () => {} },
    ...patch,
  }
}

describe('workflow-source · 抖音爆款库', () => {
  it('按行业/最低赞查询并归一化为可直接改写条目', async () => {
    const calls = []
    const sources = createWorkflowSources({
      ...deps(),
      viralLibrary: {
        listViral: async (params) => {
          calls.push(params)
          return {
            code: 0,
            data: {
              items: [{
                id: 'v1',
                title: '爆款标题',
                content: '爆款正文',
                platform: 'douyin',
                industry: '美妆',
                likes: 1200,
                url: 'https://douyin/v1',
                cover_url: 'cover.jpg',
                published_at: '2026-10-26T08:00:00.000Z',
              }],
            },
          }
        },
      },
    })
    const out = await sources.collect({
      source: { type: 'douyinViral', industry: '美妆', minLikes: 1000, limit: 20, sort: 'score' },
    })
    expect(calls[0]).toMatchObject({ platform: 'douyin', industry: '美妆', minLikes: 1000, pageSize: 20, sortBy: 'likes' })
    expect(out.items[0]).toMatchObject({
      sourceType: 'douyinViral',
      platform: 'douyin',
      title: '爆款标题',
      needsGeneration: false,
      meta: { industry: '美妆', likes: 1200 },
    })
  })

  it('缺标题或正文的爆款跳过并给出 warning，不静默吞掉', async () => {
    const sources = createWorkflowSources({
      ...deps(),
      viralLibrary: {
        listViral: async () => ({
          code: 0,
          data: {
            items: [
              { id: 'v1', title: '有效标题', content: '有效正文' },
              { id: 'v2', title: '', content: '没有标题' },
            ],
          },
        }),
      },
    })
    const out = await sources.collect({
      source: { type: 'douyinViral', industry: '美妆', minLikes: 0, limit: 20, sort: 'latest' },
    })
    expect(out.items).toHaveLength(1)
    expect(out.warnings[0]).toMatchObject({ sourceType: 'douyinViral' })
    expect(out.warnings[0].message).toContain('1 条')
  })
})

describe('workflow-source · 热门选题', () => {
  it('按类别过滤、按 fetchedAt 倒序、截断到 limit', async () => {
    const sources = createWorkflowSources(deps())
    const out = await sources.collect({
      source: { type: 'hotTopics', categories: ['ai', 'tech'], limit: 1, sort: 'latest' },
    })
    expect(out.items).toHaveLength(1)
    expect(out.items[0].title).toBe('新热点')
    expect(out.items[0]).toMatchObject({ sourceType: 'hotTopics', externalId: 'h2' })
    expect(out.items[0].needsGeneration).toBe(true)
  })

  it('sort=score 时按热度排序（与 latest 明确不同）', async () => {
    const sources = createWorkflowSources(deps())
    const out = await sources.collect({
      source: { type: 'hotTopics', categories: ['ai', 'tech', 'entertainment'], limit: 3, sort: 'score' },
    })
    expect(out.items.map((i) => i.title)).toEqual(['旧热点', '娱乐热点', '新热点'])
  })
})

describe('workflow-source · 关注博主', () => {
  it('按 platform + externalId 去重，并对无正文条目标记 needsCollect', async () => {
    const sources = createWorkflowSources(deps())
    const out = await sources.collect({
      source: { type: 'creatorMonitor', followIds: ['f1'], perCreatorLimit: 5 },
    })
    expect(out.items).toHaveLength(2)
    expect(out.items.map((i) => i.externalId)).toEqual(['v1', 'v2'])
    expect(out.items[0].needsCollect).toBe(true)
  })
})

describe('workflow-source · 知乎收藏夹', () => {
  it('按收藏时间倒序、标记 needsCollect、保留来源 URL', async () => {
    const sources = createWorkflowSources(deps())
    const out = await sources.collect({
      source: { type: 'zhihuFavlist', folderTokens: ['t1'], limit: 10 },
    })
    expect(out.items.map((i) => i.title)).toEqual(['新文', '旧文'])
    expect(out.items[0].needsCollect).toBe(true)
    expect(out.items[0].platform).toBe('zhihu')
    expect(out.items[0].url).toBe('https://www.zhihu.com/question/2/answer/3')
  })
})

describe('workflow-source · 失败隔离', () => {
  it('单个来源抛错 → warning + 空结果，不中断其他来源', async () => {
    const d = deps({
      hotTopics: { fetchTopics: async () => { throw new Error('热榜接口 503') } },
    })
    const sources = createWorkflowSources(d)
    const out = await sources.collect({ source: { type: 'hotTopics', categories: ['ai'], limit: 5 } })
    expect(out.items).toEqual([])
    expect(out.warnings[0]).toMatchObject({ sourceType: 'hotTopics' })
    expect(out.warnings[0].message).toContain('503')
  })
})
