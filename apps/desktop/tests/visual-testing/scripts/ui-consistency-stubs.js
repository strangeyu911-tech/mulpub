/**
 * ui-consistency-stubs.js — 五页截图用的浏览器侧 IPC stub（仅测试/视觉验收）
 *
 * 为什么单独一份：五页的数据源横跨 draft / storeSetting / 知识库 / 播客命名空间 /
 * creator 平面方法，直接复用 e2e 的 ipc-mock 会缺一大半方法，页面会落在空态或报错，
 * 截出来的「视觉验收」只能看到错误态。这里按页面真实读取路径补齐最小只读数据。
 *
 * 使用：`window.__uiEmpty = true` 时所有列表返回空数组（用于空态截图）。
 */
;(() => {
  const api = window.electronAPI || {}
  const empty = window.__uiEmpty === true
  const ok = (data) => ({ code: 0, data })

  const drafts = [
    { id: 'd1', title: '国庆假期后的第一波选题：三个反常识观察', updatedAt: '2026-10-26T09:12:00+08:00', platforms: ['wechat', 'xiaohongshu'] },
    { id: 'd2', title: '为什么你的短视频完播率总在 12% 徘徊', updatedAt: '2026-10-25T21:40:00+08:00', platforms: ['douyin'] },
    { id: 'd3', title: '', updatedAt: 'not-a-date', platforms: [] },
  ]

  api.draftList = async () => ok(empty ? [] : drafts)
  api.draftDelete = async () => ok(true)

  const collected = [
    { id: 'c1', title: '被误解的明朝：西方史料里的另一个大明', content: '你还记得大明是「东亚病夫」吗？别被洗脑了，翻开西方史料，根本不是同一回事。葡萄牙水手艾维拉第一次见到明朝水师时记录：那些战船大得像……', createdAt: '2026-10-24T05:18:15Z', platform: 'weibo', sourceUrl: 'https://example.com/c1' },
    { id: 'c2', title: '越南排华为什么远没有印尼排华有名？', content: '网上看过一个自媒体的视频说，越南人在老挝打砸闹事，和闹事的视频发布者（中国公民）一起被老挝条子关进看守所。', createdAt: '2026-10-23T21:56:17Z', platform: 'weibo', sourceUrl: 'https://example.com/c2' },
  ]
  const rewrites = [
    { id: 'r1', title: '在明代，其他国家的人如何看待明朝？', content: '明朝这个王朝，真的有些戏剧性。起点是乞丐流氓的「驱逐鞑虏」，终点却成了「中原沉沦」。', createdAt: '2026-10-25T22:27:07Z' },
    { id: 'r2', title: '日本流行「取消晚饭」', content: '日本最近有个词火得一塌糊涂，叫「取消晚饭」。听着像是要饿死自己？不，这是他们正在偷偷流行的新生活方式。', createdAt: '2026-10-19T17:37:38Z' },
  ]
  const settings = {
    collected_items: JSON.stringify(empty ? [] : collected),
    copy_library_rewrites: JSON.stringify(empty ? [] : rewrites),
  }
  api.storeGetSetting = async (key) => {
    if (key === 'ui:theme' && window.__uiTheme) return ok(window.__uiTheme)
    return ok(Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : null)
  }
  api.story2videoListProjects = async () => ok(empty ? [] : [
    { projectId: 'p1', title: '机器与人：谁在定义效率', sourceText: '想象一下这个场景：你正悠闲地坐在咖啡馆门口喝咖啡，一个正在干活的机械臂突然失控……', updatedAt: '2026-10-20T00:05:02Z' },
  ])

  const viralItems = [
    { id: 'v1', title: '13 岁女孩遭强奸案被认定为共犯', author: '社会观察', content: '一个 13 岁女孩在遭受侵害后，被认定为共犯。这条新闻之所以引爆，是因为它同时踩中了三个公共情绪点……', tags: ['社会', '法治'], likes: 455000, collections: 38000, comments: 17600, like_collect_ratio: 12.0, published_at: '2026-09-22', platform: 'bilibili', cover_url: '' },
    { id: 'v2', title: '多家银行存款利息涨了', author: '财经小记', content: '多家银行上调存款利率，背后是银行负债端的压力与揽储竞争。对普通人来说，最直接的问题是：现在该不该存长期？', tags: ['财经'], likes: 12000, collections: 3200, comments: 890, like_collect_ratio: 3.8, published_at: '2026-09-23', platform: 'weibo', cover_url: '' },
    { id: 'v3', title: '苹果不建议给 iPhone 贴膜', author: '数码前线', content: '苹果官方文档提到，iPhone 屏幕本身具备足够的抗刮性能，额外贴膜可能影响触控与显示效果。', tags: ['数码', '苹果'], likes: 88000, collections: 15000, comments: 4300, like_collect_ratio: 5.9, published_at: '2026-09-23', platform: 'douyin', cover_url: '' },
  ]
  api.listViralItems = async () => ok({ items: empty ? [] : viralItems, total: empty ? 0 : 3 })
  api.getPatternQueueStats = async () => ok({ pending: 0, deferred: empty ? 0 : 2 })
  api.listPatternCards = async () => ok({ items: [], total: 0 })
  api.listPersonalItems = async () => ok({ items: [], total: 0 })

  api.creatorList = async () => ({
    code: 0,
    items: empty ? [] : [
      { id: 'cr1', follow_id: 'f1', platform: 'youtube', display_name: 'Google Developers', avatar_url: '', capability_tier: 'official', status: 'active', enabled: 1, pendingCount: 3 },
      { id: 'cr2', follow_id: 'f2', platform: 'douyin', display_name: '影视飓风', avatar_url: '', capability_tier: 'best_effort', status: 'auto_paused', enabled: 0, pendingCount: 0, consecutive_failures: 3, paused_reason: '登录态已过期' },
    ],
    totalPending: empty ? 0 : 3,
  })
  api.creatorDiscoveries = async () => ({
    code: 0,
    items: empty ? [] : [
      { id: 'disc1', title: 'Build with Gemini 3: from prompt to production', thumbnail_url: '', content_quality: 'full', collect_state: 'pending' },
      { id: 'disc2', title: 'A practical guide to agentic workflows', thumbnail_url: '', content_quality: 'partial', collect_state: 'pending' },
    ],
  })
  api.creatorCredentialStatus = async () => ({ code: 0, status: 'ok' })
  api.creatorDependencyStatus = async () => ({ code: 0, discovery: { ready: true }, transcript: { ready: true, optional: true } })
  api.creatorPlatforms = async () => ({ code: 0, platforms: [{ id: 'youtube', label: 'YouTube', supported: true, hasSession: true }] })

  api.podcast = {
    channelList: async () => ({
      ok: true,
      channels: empty ? [] : [{ id: 'ch1', name: '汤姆鱼播客', count: 2, cap: 20 }],
      defaultChannelId: 'ch1',
      migrationStatus: 'done',
    }),
    channelGet: async () => (empty ? { ok: true, channel: null, feedSync: null } : {
      ok: true,
      channel: {
        title: '汤姆鱼播客', subtitle: '每周聊一次内容与产品', description: '一档关于内容创作、产品设计与 AI 工具的播客。',
        link: 'https://example.com/podcast', language: 'zh-CN', author: '汤姆鱼', ownerName: '汤姆鱼',
        ownerEmail: 'hello@example.com', explicit: 'no', feedType: 'episodic', coverUrl: 'https://example.com/cover.jpg',
        coverSize: '3000x3000', categoryId: 'Technology', audioSource: 'oss',
      },
      feedSync: { status: 'synced' },
    }),
    episodeList: async () => ({
      ok: true,
      episodes: empty ? [] : [
        { id: 'ep1', title: '第 12 期：内容团队的 AI 工作流', durationSec: 1830, pubDate: '2026-10-20', episodeType: 'full', compliance: { state: 'stock' } },
        { id: 'ep2', title: '第 11 期：从 0 到 1 做一个播客', durationSec: 2410, pubDate: '2026-10-13', episodeType: 'full', compliance: { state: 'invalid', reasons: ['EPISODE_COVER_NOT_HTTPS'] } },
      ],
      stock: null,
    }),
    endpointList: async () => ({
      ok: true,
      endpoints: empty ? [] : [
        { id: 'xiaoyuzhou', name: '小宇宙', requiresManualFirstSubmit: true, timing: '首次手动提交，之后由平台定期抓取', steps: ['打开小宇宙创作者中心', '提交 RSS 地址', '等待审核'], submitUrl: 'https://podcaster.xiaoyuzhoufm.com/', docUrl: 'https://example.com/doc' },
        { id: 'apple', name: 'Apple Podcasts', requiresManualFirstSubmit: true, timing: '首次提交后 24 小时内审核', steps: ['打开 Podcasts Connect', '粘贴 Feed 地址'], submitUrl: 'https://podcastsconnect.apple.com/', docUrl: '' },
      ],
    }),
    hostingGet: async () => (empty ? { ok: true, hosting: null } : {
      ok: true,
      hosting: { provider: 'oss', endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'tomfish-podcast', pathPrefix: 'podcast', maskedAccessKeyId: 'LTAI***WXYZ' },
    }),
  }

  window.electronAPI = api
})()
