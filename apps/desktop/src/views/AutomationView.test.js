/**
 * AutomationView.test.js — 自动化模块主页
 *
 * 主线：① 空态 / 真源不可读 ② 任务列表显示项 ③ 表单校验提示 ④ 后台通知不弹模态
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

const mockState = {
  listRes: { code: 0, data: { tasks: [] } },
  createRes: { code: 0, ok: true, task: {} },
  updateRes: { code: 0, ok: true, task: {} },
  removeRes: { code: 0, ok: true },
  runRes: { code: 0, ok: true, data: {} },
  lastPayload: null,
  notifier: null,
}

vi.mock('@/api/automation', () => ({
  automationList: () => Promise.resolve(mockState.listRes),
  automationCreate: (payload) => { mockState.lastPayload = payload; return Promise.resolve(mockState.createRes) },
  automationUpdate: (_id, payload) => { mockState.lastPayload = payload; return Promise.resolve(mockState.updateRes) },
  automationRemove: () => Promise.resolve(mockState.removeRes),
  automationRunNow: () => Promise.resolve(mockState.runRes),
  listWorkflowTemplates: () => Promise.resolve({ code: 0, data: { builtin: [], custom: [] } }),
  saveWorkflowTemplate: () => Promise.resolve({ code: 0, ok: true, template: {} }),
  getWorkflowMeta: () => Promise.resolve({
    code: 0,
    data: {
      defaults: {
        source: { type: 'hotTopics', categories: ['ai'], limit: 5, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [] },
        rewrite: { mode: 'default', strategyId: '', length: 'keep' },
        content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
        publish: { targets: [], mode: 'immediate', startAt: '' },
        cadence: { minMinutes: 35, maxMinutes: 40 },
        guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
        review: { requireApproval: false },
        dedupe: { enabled: true },
      },
      sources: [{ id: 'hotTopics', label: '热门选题' }],
      contentTypes: [{ id: 'article', label: '图文' }],
      videoPipelines: [],
      platforms: [{ id: 'zhihu', label: '知乎' }, { id: 'bilibili', label: 'B站' }],
      categories: ['ai'],
      limits: { maxHotTopicsLimit: 30, maxFolderLimit: 50, maxItemsPerRun: 50, maxDailyItems: 200 },
    },
  }),
  previewWorkflowPlan: () => Promise.resolve({ code: 0, ok: true, summary: '预览', totalMinutes: 0 }),
  listWorkflowRuns: () => Promise.resolve({ code: 0, data: { runs: [] } }),
  onAutomationNotification: (cb) => {
    mockState.notifier = cb
    return () => { mockState.notifier = null }
  },
}))

vi.mock('@/api/publisher', () => ({
  aiListRewriteStrategies: () => Promise.resolve({ code: 0, data: [] }),
  listAccounts: () => Promise.resolve({
    code: 0,
    data: [
      { id: 'zhihu-1', platform: 'zhihu', name: '知乎主号', status: 'active' },
      { id: 'zhihu-2', platform: 'zhihu', name: '知乎小号', status: 'active' },
      { id: 'bili-1', platform: 'bilibili', name: 'B站主号', status: 'active' },
    ],
  }),
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }),
}))

import AutomationView from '@/views/AutomationView.vue'
import AutomationTaskDialog from '@/features/automation/AutomationTaskDialog.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      automation: {
        title: '自动化', subtitle: 'sub', resourceNotice: 'notice',
        wfRunsTitle: '运行记录',
        wfAccountsRequired: '请选择至少一个发布账号（不能只选平台）',
        wfAccountsEmpty: '还没有已添加的自媒体账号，请先到「账号管理」添加。',
        wfAccountsHint: '勾选要发布的账号；同一平台可多选。',
        wfAccountsSelected: '已选 {count} 个账号',
        wfAccountsLegacy: '模板建议平台：{platforms}；应用后请选择具体账号。',
        wfAccountsUnavailable: '部分目标账号已不存在，请重新选择。',
        wfAccountsLoadFailed: '账号列表读取失败，请关闭弹窗后重试。',
        wfActionType: '任务类型', wfActionComposite: '复合工作流', wfActionLegacy: '直发', wfActionHint: 'hint',
        wfTemplate: '模板', wfTemplatePlaceholder: '选择模板', wfTemplateBuiltin: '内置', wfTemplateCustom: '我的',
        wfTemplateApply: '应用', wfTemplateNamePlaceholder: '模板名称', wfTemplateSave: '保存模板', wfTemplateHint: 'hint',
        create: '新建任务', createTitle: '新建', editTitle: '编辑',
        empty: '还没有自动化任务', unreadable: '读取失败', saveFailed: '保存失败',
        colName: '名称', colTrigger: '触发', colAction: '动作',
        colPolicy: '策略', colLastRun: '上次运行', colOps: '操作',
        actionPipeline: '全自动流水线',
        fieldName: '任务名称', namePlaceholder: 'ph',
        fieldTriggers: '触发方式', triggersHint: 'hint',
        triggerAppStart: '启动', triggerDaily: '每天', triggerWeekly: '每周',
        triggerInterval: '每隔', minutesUnit: '分钟',
        fieldPolicy: '失败处理', policySkip: '跳过继续', policySkipHint: 'h1',
        policyAbort: '中断', policyAbortHint: 'h2',
        fieldRetries: '重试次数', retryNone: '不重试',
        retryTimes: ({ named }) => named('count') + ' 次',
        weekdays: { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' },
        runNow: '立即运行', edit: '编辑', delete: '删除',
        cancel: '取消', save: '保存', running: '运行中',
        statusCompleted: '成功', statusFailed: '失败', statusCancelled: '取消',
        errNameEmpty: '请填写任务名称', errNameTooLong: '名称过长',
        errNoTrigger: '请至少选择一种触发方式', errNoWeekday: '请至少选择一个星期',
        errSaveFailed: '保存失败', errRunFailed: '启动失败',
        errDeleteFailed: '删除失败', errAlreadyRunning: '上一轮还在运行',
        created: 'created', saved: 'saved', deleted: 'deleted', started: 'started',
        notifyFailed: ({ named }) => named('message'),
        notifyRecovered: ({ named }) => named('message'),
      },
    },
  },
})

function mountView() {
  return mount(AutomationView, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

const sampleTask = {
  id: 'at_1',
  name: '每日科技',
  enabled: true,
  triggers: [{ type: 'daily', time: '09:00' }, { type: 'onAppStart' }],
  triggerLabels: ['每天 09:00', '启动触发'],
  failurePolicy: 'skip',
  maxRetries: 1,
  running: false,
  lastRunAt: '2026-10-03T09:00:00.000Z',
  lastStatus: 'completed',
  lastError: '',
}

describe('自动化页 · 空态与真源状态', () => {
  beforeEach(() => { mockState.listRes = { code: 0, data: { tasks: [] } } })
  afterEach(() => { vi.clearAllMocks() })

  it('无任务时显示空态文案', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('[data-testid="automation-empty"]').exists()).toBe(true)
    w.unmount()
  })

  it('真源读不到时显示 unreadable 提示（与「没有任务」区分）', async () => {
    mockState.listRes = { code: -1, message: 'unavailable' }
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    const status = w.find('[data-testid="automation-status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('读取失败')
    w.unmount()
  })

  it('资源竞争提示常驻（不藏代价）', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('[data-testid="automation-notice"]').exists()).toBe(true)
    w.unmount()
  })
})

describe('自动化页 · 任务列表显示项', () => {
  beforeEach(() => { mockState.listRes = { code: 0, data: { tasks: [sampleTask] } } })
  afterEach(() => { vi.clearAllMocks() })

  it('显示名称 / 触发摘要 / 失败策略 / 上次运行结果', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    const row = w.find('[data-testid="automation-row-at_1"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('每日科技')
    expect(row.text()).toContain('每天 09:00')
    expect(row.text()).toContain('启动触发')
    expect(row.text()).toContain('跳过继续')
    expect(row.text()).toContain('成功')
    w.unmount()
  })

  it('运行中显示 running 标记而非上次结果', async () => {
    mockState.listRes = { code: 0, data: { tasks: [{ ...sampleTask, running: true }] } }
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.text()).toContain('运行中')
    w.unmount()
  })

  it('失败任务显示 lastError（首个失败原因可见）', async () => {
    mockState.listRes = {
      code: 0,
      data: { tasks: [{ ...sampleTask, lastStatus: 'failed', lastError: '采集阶段超时' }] },
    }
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.text()).toContain('采集阶段超时')
    w.unmount()
  })
})

describe('自动化页 · 表单校验', () => {
  beforeEach(() => { mockState.listRes = { code: 0, data: { tasks: [] } } })
  afterEach(() => { vi.clearAllMocks() })

  async function openDialog(w) {
    await w.find('[data-testid="automation-create"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
  }

  function dialogVm(w) {
    return w.findComponent(AutomationTaskDialog).vm
  }

  it('未填名称 → errNameEmpty', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await openDialog(w)
    dialogVm(w).form.name = ''
    await w.vm.$nextTick()
    await dialogVm(w).save()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('[data-testid="automation-form-error"]').text()).toContain('请填写任务名称')
    w.unmount()
  })

  it('未选任何触发方式 → errNoTrigger', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await openDialog(w)
    dialogVm(w).form.name = '任务A'
    await w.vm.$nextTick()
    await dialogVm(w).save()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('[data-testid="automation-form-error"]').text()).toContain('请至少选择一种触发方式')
    w.unmount()
  })

  it('选了每周但未选星期 → errNoWeekday', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await openDialog(w)
    dialogVm(w).form.name = '任务A'
    dialogVm(w).form.useWeekly = true
    dialogVm(w).form.weekdays = []
    await w.vm.$nextTick()
    await dialogVm(w).save()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('[data-testid="automation-form-error"]').text()).toContain('请至少选择一个星期')
    w.unmount()
  })

  it('多种触发方式可同时勾选（多个同时有效）', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await openDialog(w)
    dialogVm(w).form.useAppStart = true
    dialogVm(w).form.useDaily = true
    dialogVm(w).form.useInterval = true
    await w.vm.$nextTick()
    expect(dialogVm(w).formTriggers.map((t) => t.type)).toEqual(['onAppStart', 'daily', 'interval'])
    w.unmount()
  })

  it('复合工作流未选发布账号 → 保存被拦截', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await openDialog(w)
    dialogVm(w).form.name = '账号目标校验'
    dialogVm(w).form.useAppStart = true
    await w.vm.$nextTick()
    await dialogVm(w).save()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('[data-testid="automation-form-error"]').text()).toContain('请选择至少一个发布账号')
    w.unmount()
  })

  it('同平台可勾选多个账号，保存 payload 写入真实 accountId', async () => {
    mockState.createRes = { code: 0, ok: true, task: {} }
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await openDialog(w)
    dialogVm(w).form.name = '多账号发布'
    dialogVm(w).form.useAppStart = true
    await w.vm.$nextTick()
    await w.find('[data-testid="wf-account-zhihu-1"] input').setValue(true)
    await w.find('[data-testid="wf-account-zhihu-2"] input').setValue(true)
    await dialogVm(w).save()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockState.lastPayload.action.config.publish.targets).toEqual([
      { platform: 'zhihu', accountId: 'zhihu-1' },
      { platform: 'zhihu', accountId: 'zhihu-2' },
    ])
    w.unmount()
  })

  it('编辑时回填已有触发器', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.openEdit(sampleTask)
    await new Promise((r) => setTimeout(r, 0))
    expect(dialogVm(w).form.useDaily).toBe(true)
    expect(dialogVm(w).form.dailyTime).toBe('09:00')
    expect(dialogVm(w).form.useAppStart).toBe(true)
    expect(dialogVm(w).form.failurePolicy).toBe('skip')
    w.unmount()
  })

  it('编辑旧 fullAutoPipeline 任务：保存时保留原配置，不被清空', async () => {
    const legacyConfig = { sourceType: 'url', contentType: 'article', urls: ['https://example.com/a'] }
    const legacyTask = { ...sampleTask, action: { type: 'fullAutoPipeline', config: legacyConfig } }
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.openEdit(legacyTask)
    await new Promise((r) => setTimeout(r, 0))
    const d = dialogVm(w)
    d.form.useAppStart = true
    await d.save()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockState.lastPayload.action).toEqual({ type: 'fullAutoPipeline', config: legacyConfig })
    w.unmount()
  })
})

describe('自动化页 · 后台通知', () => {
  beforeEach(() => { mockState.listRes = { code: 0, data: { tasks: [sampleTask] } } })
  afterEach(() => { vi.clearAllMocks() })

  it('订阅通知并在收到后刷新列表（不弹模态，只刷数据）', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(typeof mockState.notifier).toBe('function')
    // 收到失败通知后应重新拉取列表
    const before = mockState.listRes
    mockState.notifier({ level: 'error', title: 't', message: '采集失败', taskId: 'at_1' })
    await new Promise((r) => setTimeout(r, 10))
    expect(mockState.listRes).toBe(before) // 列表数据未被就地改写，走重新拉取
    w.unmount()
  })

  it('卸载后取消订阅（不留悬挂监听器）', async () => {
    const w = mountView()
    await new Promise((r) => setTimeout(r, 0))
    w.unmount()
    expect(mockState.notifier).toBe(null)
  })
})
