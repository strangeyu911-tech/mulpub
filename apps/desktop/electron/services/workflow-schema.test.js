/**
 * workflow-schema.test.js — 复合自动化工作流配置的校验与默认值
 *
 * 主线：① 非法配置逐条出声（field + reason）② 默认值可预测 ③ 内置模板必须全部合法
 * ④ 播客走独立频道、视频必须选流水线、来源决定必填项
 */
const {
  SOURCE_TYPES,
  VIRAL_INDUSTRIES,
  CONTENT_TYPES,
  VIDEO_PIPELINES,
  PLATFORMS,
  buildDefaultWorkflowConfig,
  validateWorkflowConfig,
  describeWorkflow,
  BUILTIN_TEMPLATES,
  LIMITS,
} = require('./workflow-schema')

const baseTarget = { platform: 'bilibili', accountId: 'acc-1' }

function validConfig (patch = {}) {
  return {
    source: { type: 'zhihuFavlist', folderTokens: ['token-1'], limit: 5 },
    rewrite: { mode: 'default' },
    content: { type: 'video', videoPipeline: 'story2video-compose' },
    publish: { targets: [baseTarget], mode: 'scheduled', startAt: '2026-11-01T09:00:00.000Z' },
    cadence: { minMinutes: 35, maxMinutes: 40 },
    guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
    review: { requireApproval: false },
    dedupe: { enabled: true },
    ...patch,
  }
}

describe('workflow-schema · 枚举与默认值', () => {
  it('行业枚举与共享 JSON 同源，避免打包 fallback 漂移', () => {
    const shared = require('../../shared/viral-industries.json')
    expect(VIRAL_INDUSTRIES).toEqual(shared.industries)
  })

  it('来源/内容类型/流水线/平台为显式白名单', () => {
    expect(SOURCE_TYPES).toEqual(['hotTopics', 'creatorMonitor', 'zhihuFavlist', 'douyinViral'])
    expect(CONTENT_TYPES).toEqual(['article', 'video', 'podcast'])
    expect(VIDEO_PIPELINES).toContain('story2video-compose')
    // 只允许「文案可直接启动」的流水线，素材型流水线不在选项里
    expect(VIDEO_PIPELINES).not.toContain('talking-head')
    expect(VIDEO_PIPELINES).not.toContain('cinematic')
    expect(PLATFORMS).toHaveLength(15)
  })

  it('默认配置：35-40 分钟、单次 5 条、每日 20 条、去重开启', () => {
    const cfg = buildDefaultWorkflowConfig()
    expect(cfg.cadence).toEqual({ minMinutes: 35, maxMinutes: 40 })
    expect(cfg.guardrails.maxItemsPerRun).toBe(5)
    expect(cfg.guardrails.dailyItemLimit).toBe(20)
    expect(cfg.dedupe.enabled).toBe(true)
    expect(cfg.publish.mode).toBe('immediate')
  })
})

describe('workflow-schema · 来源校验', () => {
  it('热门选题：类别必须来自 11 类，limit 1-30，默认按最新排序', () => {
    const ok = validateWorkflowConfig(validConfig({
      source: { type: 'hotTopics', categories: ['ai', 'tech'], limit: 10 },
    }))
    expect(ok.ok).toBe(true)
    expect(ok.config.source.sort).toBe('latest')

    const badCategory = validateWorkflowConfig(validConfig({
      source: { type: 'hotTopics', categories: ['not-a-category'], limit: 10 },
    }))
    expect(badCategory.ok).toBe(false)
    expect(badCategory.errors[0]).toMatchObject({ field: 'source.categories', reason: 'unknownCategory' })

    const badLimit = validateWorkflowConfig(validConfig({
      source: { type: 'hotTopics', categories: ['ai'], limit: 0 },
    }))
    expect(badLimit.errors[0]).toMatchObject({ field: 'source.limit', reason: 'outOfRange' })
  })

  it('关注博主：followIds 必填且上限 50，perCreatorLimit 1-20', () => {
    expect(validateWorkflowConfig(validConfig({
      source: { type: 'creatorMonitor', followIds: ['f1'], perCreatorLimit: 3 },
    })).ok).toBe(true)

    const empty = validateWorkflowConfig(validConfig({
      source: { type: 'creatorMonitor', followIds: [], perCreatorLimit: 3 },
    }))
    expect(empty.errors[0]).toMatchObject({ field: 'source.followIds', reason: 'empty' })

    const tooMany = validateWorkflowConfig(validConfig({
      source: { type: 'creatorMonitor', followIds: Array.from({ length: 51 }, (_, i) => 'f' + i), perCreatorLimit: 3 },
    }))
    expect(tooMany.errors[0]).toMatchObject({ field: 'source.followIds', reason: 'tooMany' })
  })

  it('知乎收藏夹：folderTokens 必填、去重、上限 20', () => {
    const ok = validateWorkflowConfig(validConfig({
      source: { type: 'zhihuFavlist', folderTokens: ['a', 'a', 'b'], limit: 8 },
    }))
    expect(ok.ok).toBe(true)
    expect(ok.config.source.folderTokens).toEqual(['a', 'b'])

    const empty = validateWorkflowConfig(validConfig({
      source: { type: 'zhihuFavlist', folderTokens: [], limit: 8 },
    }))
    expect(empty.errors[0]).toMatchObject({ field: 'source.folderTokens', reason: 'empty' })
  })

  it('抖音爆款库要求行业，limit/minLikes 有边界', () => {
    const ok = validateWorkflowConfig(validConfig({
      source: { type: 'douyinViral', industry: '美妆', limit: 20, minLikes: 1000 },
    }))
    expect(ok.ok).toBe(true)

    const missing = validateWorkflowConfig(validConfig({
      source: { type: 'douyinViral', industry: '', limit: 20, minLikes: 0 },
    }))
    expect(missing.ok).toBe(false)
    expect(missing.errors[0]).toMatchObject({ field: 'source.industry', reason: 'unknown' })

    const badLikes = validateWorkflowConfig(validConfig({
      source: { type: 'douyinViral', industry: '美妆', limit: 20, minLikes: -1 },
    }))
    expect(badLikes.errors[0]).toMatchObject({ field: 'source.minLikes', reason: 'outOfRange' })
  })

  it('未知来源类型直接拒绝', () => {
    const r = validateWorkflowConfig(validConfig({ source: { type: 'unknownSource' } }))
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatchObject({ field: 'source.type', reason: 'unknown' })
  })
})

describe('workflow-schema · 改写/内容/发布校验', () => {
  it('预算护栏：默认关闭；启用后 maxCost/perItem 必须大于 0', () => {
    const def = validateWorkflowConfig(validConfig())
    expect(def.config.guardrails.budget.enabled).toBe(false)

    const bad = validateWorkflowConfig(validConfig({
      guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1, budget: { enabled: true, maxCost: 0, estimatedCostPerItem: 0 } },
    }))
    expect(bad.errors.some((e) => e.field === 'guardrails.budget.maxCost')).toBe(true)
    expect(bad.errors.some((e) => e.field === 'guardrails.budget.estimatedCostPerItem')).toBe(true)
  })

  it('排期规则：默认关闭；启用后校验时区/工作日/静默时段', () => {
    const def = validateWorkflowConfig(validConfig())
    expect(def.config.scheduleRules.enabled).toBe(false)

    const ok = validateWorkflowConfig(validConfig({
      scheduleRules: { enabled: true, timezone: 'Asia/Shanghai', weekdays: [1, 2, 3], quietHours: { start: '23:00', end: '07:00' } },
    }))
    expect(ok.ok).toBe(true)
    expect(ok.config.scheduleRules.weekdays).toEqual([1, 2, 3])

    const badTz = validateWorkflowConfig(validConfig({
      scheduleRules: { enabled: true, timezone: 'Not/AZone', weekdays: [1], quietHours: { start: '23:00', end: '07:00' } },
    }))
    expect(badTz.errors.some((e) => e.field === 'scheduleRules.timezone')).toBe(true)

    const noDays = validateWorkflowConfig(validConfig({
      scheduleRules: { enabled: true, timezone: 'UTC', weekdays: [], quietHours: { start: '23:00', end: '07:00' } },
    }))
    expect(noDays.errors.some((e) => e.field === 'scheduleRules.weekdays')).toBe(true)
  })

  it('平台适配启用时要求至少一个 profile，未知平台被拒绝', () => {
    const ok = validateWorkflowConfig(validConfig({
      content: { type: 'article', adaptation: { enabled: true, byPlatform: { zhihu: { titleMaxLength: 20 } } } },
    }))
    expect(ok.ok).toBe(true)
    expect(ok.config.content.adaptation.byPlatform.zhihu.titleMaxLength).toBe(20)

    const empty = validateWorkflowConfig(validConfig({
      content: { type: 'article', adaptation: { enabled: true } },
    }))
    expect(empty.errors.some((e) => e.field === 'content.adaptation' && e.reason === 'empty')).toBe(true)

    const unknown = validateWorkflowConfig(validConfig({
      content: { type: 'article', adaptation: { enabled: true, byPlatform: { nope: { titleMaxLength: 20 } } } },
    }))
    expect(unknown.errors.some((e) => e.reason === 'unsupported')).toBe(true)
  })

  it('指定策略必须带 strategyId；默认策略忽略 strategyId', () => {
    const bad = validateWorkflowConfig(validConfig({ rewrite: { mode: 'strategy' } }))
    expect(bad.errors[0]).toMatchObject({ field: 'rewrite.strategyId', reason: 'empty' })

    const ok = validateWorkflowConfig(validConfig({ rewrite: { mode: 'strategy', strategyId: 'strategy-viral-storytelling' } }))
    expect(ok.ok).toBe(true)
    expect(ok.config.rewrite.length).toBe('keep')
  })

  it('视频必须选一条可执行流水线', () => {
    const missing = validateWorkflowConfig(validConfig({ content: { type: 'video' } }))
    expect(missing.errors[0]).toMatchObject({ field: 'content.videoPipeline', reason: 'empty' })

    const unsupported = validateWorkflowConfig(validConfig({ content: { type: 'video', videoPipeline: 'talking-head' } }))
    expect(unsupported.errors[0]).toMatchObject({ field: 'content.videoPipeline', reason: 'unsupported' })
  })

  it('播客必须选频道，且不要求平台目标', () => {
    const noChannel = validateWorkflowConfig(validConfig({
      content: { type: 'podcast' },
      publish: { targets: [], mode: 'immediate' },
    }))
    expect(noChannel.errors[0]).toMatchObject({ field: 'content.podcastChannelId', reason: 'empty' })

    const ok = validateWorkflowConfig(validConfig({
      content: { type: 'podcast', podcastChannelId: 'ch-1' },
      publish: { targets: [], mode: 'immediate' },
    }))
    expect(ok.ok).toBe(true)
    expect(ok.config.publish.targets).toEqual([])
  })

  it('发布目标：至少一个平台账号、去重、未知平台拒绝', () => {
    const empty = validateWorkflowConfig(validConfig({ publish: { targets: [], mode: 'immediate' } }))
    expect(empty.errors[0]).toMatchObject({ field: 'publish.targets', reason: 'empty' })

    const dup = validateWorkflowConfig(validConfig({
      publish: { targets: [baseTarget, { ...baseTarget }], mode: 'immediate' },
    }))
    expect(dup.ok).toBe(true)
    expect(dup.config.publish.targets).toHaveLength(1)

    const unknown = validateWorkflowConfig(validConfig({
      publish: { targets: [{ platform: 'myspace', accountId: 'x' }], mode: 'immediate' },
    }))
    expect(unknown.errors[0]).toMatchObject({ field: 'publish.targets[0].platform', reason: 'unsupported' })
  })

  it('发布目标必须指定账号 ID（不允许只选平台回落默认账号）', () => {
    const r = validateWorkflowConfig(validConfig({
      publish: { targets: [{ platform: 'bilibili', accountId: '' }], mode: 'immediate' },
    }))
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatchObject({ field: 'publish.targets[0].accountId', reason: 'empty' })
  })

  it('定时模式必须给未来 startAt；立即模式忽略 startAt', () => {
    const now = Date.parse('2026-10-26T00:00:00.000Z')
    const past = validateWorkflowConfig(validConfig({
      publish: { targets: [baseTarget], mode: 'scheduled', startAt: '2020-01-01T00:00:00.000Z' },
    }), { now })
    expect(past.errors[0]).toMatchObject({ field: 'publish.startAt', reason: 'notFuture' })

    const ok = validateWorkflowConfig(validConfig({
      publish: { targets: [baseTarget], mode: 'immediate', startAt: '2020-01-01T00:00:00.000Z' },
    }), { now })
    expect(ok.ok).toBe(true)
    expect(ok.config.publish.startAt).toBe('')
  })
})

describe('workflow-schema · 节奏与护栏', () => {
  it('间隔必须是 5-1440 且 min<=max', () => {
    const reversed = validateWorkflowConfig(validConfig({ cadence: { minMinutes: 40, maxMinutes: 35 } }))
    expect(reversed.errors[0]).toMatchObject({ field: 'cadence.minMinutes', reason: 'minGreaterThanMax' })

    const tooShort = validateWorkflowConfig(validConfig({ cadence: { minMinutes: 1, maxMinutes: 2 } }))
    expect(tooShort.errors[0]).toMatchObject({ field: 'cadence.minMinutes', reason: 'outOfRange' })
  })

  it('护栏：单次上限 50、每日上限 500、单条重试 0-3', () => {
    const r = validateWorkflowConfig(validConfig({
      guardrails: { maxItemsPerRun: 51, dailyItemLimit: 501, retryPerItem: 4 },
    }))
    expect(r.errors.map((e) => e.field)).toEqual([
      'guardrails.maxItemsPerRun',
      'guardrails.dailyItemLimit',
      'guardrails.retryPerItem',
    ])
  })

  it('超出单次上限的条数在计划阶段截断，不在校验阶段报错', () => {
    // 校验只管取值范围；运行期按 maxItemsPerRun 截断（workflow-plan 负责）
    expect(LIMITS.maxItemsPerRun).toBe(50)
  })
})

describe('workflow-schema · 描述与模板', () => {
  it('describeWorkflow 输出可读摘要', () => {
    const cfg = validateWorkflowConfig(validConfig()).config
    const text = describeWorkflow(cfg)
    expect(text).toContain('知乎收藏夹')
    expect(text).toContain('视频')
    expect(text).toContain('35-40 分钟')
    expect(text).toContain('B站')
  })

  it('describeWorkflow 对同平台多账号给出账号数', () => {
    const cfg = validateWorkflowConfig(validConfig({
      publish: {
        targets: [
          { platform: 'zhihu', accountId: 'zhihu-1' },
          { platform: 'zhihu', accountId: 'zhihu-2' },
        ],
        mode: 'immediate',
      },
    })).config
    expect(describeWorkflow(cfg)).toContain('知乎 · 2 个账号')
  })

  it('内置模板全部通过校验，且覆盖四类场景', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(4)
    for (const tpl of BUILTIN_TEMPLATES) {
      // 内置模板只存「平台建议」，不存账号 ID（账号是每台机器/每个用户私有的）；
      // 因此模板校验允许 target.accountId 为空，任务校验默认不允许。
      const r = validateWorkflowConfig(tpl.config, { now: Date.parse('2026-10-26T00:00:00.000Z'), allowEmptyAccounts: true })
      expect(r.ok, tpl.id + ': ' + JSON.stringify(r.errors)).toBe(true)
    }
    const ids = BUILTIN_TEMPLATES.map((t) => t.id)
    expect(ids).toContain('zhihu-fav-story-video')
    expect(ids).toContain('creator-article-daily')
    expect(ids).toContain('hot-topic-article')
    expect(ids).toContain('zhihu-fav-podcast')
  })
})
