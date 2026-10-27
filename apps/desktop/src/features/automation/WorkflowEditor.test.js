import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import WorkflowEditor from './WorkflowEditor.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      automation: {
        wfSourceTitle: '来源', wfSourceType: '来源类型', wfHotCategories: '分类', wfHotLimit: '条数',
        wfFollowIds: '博主', wfPerCreator: '每位', wfFolderTokens: '收藏夹', wfFolderLimit: '条数',
        wfSourceHot: '热门', wfSourceCreator: '博主', wfSourceZhihu: '收藏夹', wfRewriteTitle: '改写',
        wfRewriteMode: '模式', wfRewriteDefault: '默认', wfRewriteStrategy: '策略', wfRewriteLength: '长度',
        wfLengthKeep: '保持', wfLengthShort: '缩短', wfLengthExpand: '扩写', wfContentTitle: '内容',
        wfContentType: '类型', wfContentArticle: '图文', wfContentVideo: '视频', wfContentPodcast: '播客',
        wfPipeline: '流水线', wfPipelineHint: 'hint', wfChannel: '频道', wfChannelPlaceholder: 'ph', wfChannelHint: 'hint',
        wfPublishTitle: '发布账号', wfAccountsHint: '选择账号', wfAccountsEmpty: '没有账号',
        wfAccountsSelected: '已选 {count} 个账号', wfAccountsRequired: '请选择发布账号',
        wfAccountsLegacy: '模板建议平台：{platforms}',
        wfAccountExpired: '登录已过期',
        wfAccountInactive: '未启用',
        wfPublishMode: '发布方式', wfModeImmediate: '立即', wfModeScheduled: '定时', wfScheduleWarn: 'warn',
        wfCadenceTitle: '节奏', wfCadence: '间隔', wfCadenceHint: 'hint', wfGuard: '护栏',
        wfGuardPerRun: '每次', wfGuardDaily: '每天', wfReview: '审核', wfDedupe: '去重', wfReviewHint: 'hint',
        wfCategory: { general: '综合', society: '社会', finance: '财经', tech: '科技', ai: 'AI' },
        wfViralIndustry: '行业', wfViralIndustryPlaceholder: '请选择行业', wfViralIndustryHint: 'hint',
        wfViralMinLikes: '最低点赞', wfViralLimitHint: 'hint', wfViralSourceHint: 'hint',
      },
    },
  },
})

function config () {
  return {
    source: { type: 'hotTopics', categories: ['ai'], limit: 10, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [] },
    rewrite: { mode: 'default', strategyId: '', length: 'keep' },
    content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
    publish: { targets: [], mode: 'immediate', startAt: '' },
    cadence: { minMinutes: 35, maxMinutes: 40 },
    guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
    review: { requireApproval: false },
    dedupe: { enabled: true },
  }
}

const meta = {
  sources: [{ id: 'hotTopics', label: '热门选题' }, { id: 'douyinViral', label: '抖音爆款库' }],
  viralIndustries: ['美妆'],
  contentTypes: [
    { id: 'article', label: '图文' },
    { id: 'video', label: '视频' },
    { id: 'podcast', label: '播客' },
  ],
  videoPipelines: [],
  platforms: [
    { id: 'zhihu', label: '知乎' },
    { id: 'bilibili', label: 'B站' },
  ],
  categories: ['ai'],
  limits: { maxHotTopicsLimit: 30, maxFolderLimit: 50, maxItemsPerRun: 50, maxDailyItems: 200 },
}

const accounts = [
  { id: 'zhihu-1', platform: 'zhihu', name: '知乎主号', status: 'active' },
  { id: 'zhihu-2', platform: 'zhihu', name: '知乎小号', status: 'active' },
  { id: 'bili-1', platform: 'bilibili', name: 'B站主号', status: 'expired' },
]

function mountEditor () {
  return mount(WorkflowEditor, {
    props: { meta, accounts, modelValue: config() },
    global: { plugins: [i18n] },
  })
}

describe('WorkflowEditor · 抖音爆款来源', () => {
  it('切换到抖音爆款库后显示行业与最低点赞输入', async () => {
    const w = mountEditor()
    await w.find('[data-testid="wf-source-type"]').setValue('douyinViral')
    expect(w.find('[data-testid="wf-viral-industry"]').exists()).toBe(true)
    expect(w.find('[data-testid="wf-viral-min-likes"]').exists()).toBe(true)
  })
})

describe('WorkflowEditor · 发布账号多选', () => {
  it('按账号渲染复选框（同平台多个账号都可见），不再只渲染平台', () => {
    const w = mountEditor()
    expect(w.find('[data-testid="wf-account-zhihu-1"]').exists()).toBe(true)
    expect(w.find('[data-testid="wf-account-zhihu-2"]').exists()).toBe(true)
    expect(w.find('[data-testid="wf-account-bili-1"]').exists()).toBe(true)
    expect(w.text()).toContain('知乎主号')
    expect(w.text()).toContain('知乎小号')
    expect(w.text()).toContain('B站主号')
  })

  it('同平台可选择多个账号，targets 写入 platform + accountId', async () => {
    const w = mountEditor()
    await w.find('[data-testid="wf-account-zhihu-1"] input').setValue(true)
    await w.find('[data-testid="wf-account-zhihu-2"] input').setValue(true)
    expect(w.props('modelValue').publish.targets).toEqual([
      { platform: 'zhihu', accountId: 'zhihu-1' },
      { platform: 'zhihu', accountId: 'zhihu-2' },
    ])
    await w.find('[data-testid="wf-account-zhihu-1"] input').setValue(false)
    expect(w.props('modelValue').publish.targets).toEqual([
      { platform: 'zhihu', accountId: 'zhihu-2' },
    ])
  })

  it('过期账号显示状态且不可勾选（保存前预检的第一道）', async () => {
    const w = mountEditor()
    const expired = w.find('[data-testid="wf-account-bili-1"] input')
    expect(expired.attributes('disabled')).toBeDefined()
    await expired.setValue(true)
    expect(w.props('modelValue').publish.targets).toEqual([])
    expect(w.text()).toContain('登录已过期')
  })

  it('没有已添加账号时给出明确空态，而不是展示平台假选项', () => {
    const w = mount(WorkflowEditor, {
      props: { meta, accounts: [], modelValue: config() },
      global: { plugins: [i18n] },
    })
    expect(w.text()).toContain('没有账号')
    expect(w.find('[data-testid="wf-account-zhihu-1"]').exists()).toBe(false)
  })
})
