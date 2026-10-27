/**
 * workflow-service.test.js — 模板管理与计划预览的门面
 *
 * 主线：① 内置模板只读 ② 自定义模板可增删、名字去重、配置必须合法
 * ③ 导入/导出 JSON 往返不丢字段 ④ 预览返回可读摘要与排期数
 */
const { createWorkflowService } = require('./workflow-service')

const NOW = Date.parse('2026-10-26T10:00:00+08:00')

function fakeStore () {
  const map = new Map()
  return { getSetting: (k) => (map.has(k) ? map.get(k) : null), setSetting: (k, v) => { map.set(k, v) } }
}

function validConfig () {
  return {
    source: { type: 'hotTopics', categories: ['ai'], limit: 3, sort: 'latest', followIds: [], perCreatorLimit: 3, folderTokens: [] },
    rewrite: { mode: 'default', strategyId: '', length: 'keep' },
    content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
    publish: { targets: [{ platform: 'zhihu', accountId: 'acc-1' }], mode: 'immediate', startAt: '' },
    cadence: { minMinutes: 35, maxMinutes: 40 },
    guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
    review: { requireApproval: false },
    dedupe: { enabled: true },
  }
}

describe('workflow-service · 模板', () => {
  it('内置模板只读：delete 内置 id 返回 builtin-readonly', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const list = svc.listTemplates()
    expect(list.builtin.length).toBeGreaterThanOrEqual(4)
    expect(list.builtin[0].readonly).toBe(true)
    expect(svc.deleteTemplate(list.builtin[0].id)).toMatchObject({ ok: false, reason: 'builtin-readonly' })
  })

  it('旧自定义模板读取时自动迁移到 v2，账号 ID 清空', () => {
    const store = fakeStore()
    store.setSetting('workflow_templates_custom', JSON.stringify([{
      id: 'wft_old', name: '旧模板', config: { publish: { targets: ['zhihu'] } },
    }, {
      id: 'wft_bad', name: '坏模板',
    }]))
    const svc = createWorkflowService({ store, runner: {}, now: () => NOW })
    const result = svc.listTemplates()
    expect(result.custom).toHaveLength(1)
    expect(result.custom[0]).toMatchObject({ id: 'wft_old', name: '旧模板', version: 2 })
    expect(result.custom[0].config.publish.targets).toEqual([{ platform: 'zhihu', accountId: '' }])
    // 迁移失败的单条进入 warnings，不静默消失
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ name: '坏模板', reason: 'invalid-shape' })
  })

  it('overwrite 与 rename 同时传时明确拒绝', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const exported = svc.exportTemplate(svc.listTemplates().builtin[0].id)
    expect(svc.importTemplate(JSON.stringify(exported.data), { overwrite: true, rename: true }))
      .toMatchObject({ ok: false, reason: 'conflicting-options' })
  })

  it('保存自定义模板：名字去重、配置非法拒绝并给出 errors', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const ok = svc.saveTemplate({ name: '我的模板', config: validConfig() })
    expect(ok.ok).toBe(true)
    expect(svc.listTemplates().custom).toHaveLength(1)
    expect(svc.saveTemplate({ name: '我的模板', config: validConfig() })).toMatchObject({ ok: false, reason: 'name:duplicate' })

    const bad = svc.saveTemplate({ name: '坏模板', config: { ...validConfig(), content: { type: 'video' } } })
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('invalid-config')
    expect(bad.errors[0].field).toBe('content.videoPipeline')
  })

  it('模板允许平台建议：accountId 为空可保存，导出不冒充账号', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const cfg = validConfig()
    cfg.publish.targets = [{ platform: 'zhihu', accountId: '' }]
    const saved = svc.saveTemplate({ name: '平台建议模板', config: cfg })
    expect(saved.ok).toBe(true)
    expect(saved.template.config.publish.targets).toEqual([{ platform: 'zhihu', accountId: '' }])
  })

  it('导出/导入往返：配置等价，导入时重新校验', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const saved = svc.saveTemplate({ name: '导出模板', config: validConfig() })
    const exported = svc.exportTemplate(saved.template.id)
    expect(exported.ok).toBe(true)
    const imported = svc.importTemplate(JSON.stringify({ version: 1, name: '导入模板', config: exported.data.config }))
    expect(imported.ok).toBe(true)
    expect(imported.template.config.source.categories).toEqual(['ai'])

    const bad = svc.importTemplate(JSON.stringify({ version: 1, name: '坏', config: { source: { type: 'nope' } } }))
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('invalid-config')
  })

  it('导出 v2 包剥离账号 ID，导入预览不落盘', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const saved = svc.saveTemplate({ name: '团队模板', config: validConfig() })
    const exported = svc.exportTemplate(saved.template.id)
    expect(exported.data).toMatchObject({ format: 'mulpub-workflow-template', version: 2 })
    expect(exported.data.config.publish.targets).toEqual([{ platform: 'zhihu', accountId: '' }])

    const preview = svc.importTemplate(JSON.stringify(exported.data), { dryRun: true })
    expect(preview.ok).toBe(true)
    expect(preview.preview.name).toBe('团队模板')
    expect(preview.preview.conflict).toBe(true)
    expect(svc.listTemplates().custom).toHaveLength(1)
  })

  it('v1 platform-only targets 迁移为 accountId 空串；重名导入 rename 自动加后缀', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const oldPayload = {
      version: 1,
      name: '旧模板',
      config: {
        source: { type: 'hotTopics', categories: ['ai'], limit: 3 },
        content: { type: 'article' },
        publish: { targets: ['zhihu'] },
      },
    }
    const first = svc.importTemplate(JSON.stringify(oldPayload), { rename: true })
    expect(first.ok).toBe(true)
    expect(first.template.config.publish.targets).toEqual([{ platform: 'zhihu', accountId: '' }])
    const second = svc.importTemplate(JSON.stringify(oldPayload), { rename: true })
    expect(second.ok).toBe(true)
    expect(second.template.name).toContain('导入')
    expect(second.template.name).not.toBe(first.template.name)
  })
})

describe('workflow-service · 预览', () => {
  it('返回摘要、目标数与每个目标的排期数', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const r = svc.previewPlan(validConfig(), { itemCount: 3 })
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('热门选题')
    expect(r.targets).toHaveLength(1)
    expect(r.slotsByTarget['zhihu:acc-1']).toHaveLength(3)
    expect(r.totalMinutes).toBe(70)
  })

  it('非法配置 → invalid-config + errors，不返回排期', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const r = svc.previewPlan({ ...validConfig(), cadence: { minMinutes: 40, maxMinutes: 35 } }, { itemCount: 1 })
    expect(r.ok).toBe(false)
    expect(r.errors[0].field).toBe('cadence.minMinutes')
  })
})

describe('workflow-service · P1-4 工作流条数配额', () => {
  it('免费档 max_workflows=0：保存新模板返回 plan-limit', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    svc.setEntitlementProvider(() => ({ limits: { max_workflows: 0 } }))
    const r = svc.saveTemplate({ name: '免费模板', config: validConfig() })
    expect(r).toMatchObject({ ok: false, reason: 'plan-limit' })
    expect(r.data).toMatchObject({ limit: 0, current: 0 })
  })

  it('标准档 10 条：第 11 条返回 limit；已存在 10 条时不落盘', () => {
    const store = fakeStore()
    const seed = Array.from({ length: 10 }, (_, i) => ({ id: 'wft_seed_' + i, name: '预置' + i, config: validConfig() }))
    store.setSetting('workflow_templates_custom', JSON.stringify(seed))
    const svc = createWorkflowService({ store, runner: {}, now: () => NOW })
    svc.setEntitlementProvider(() => ({ limits: { max_workflows: 10 } }))
    const r = svc.saveTemplate({ name: '第十一条', config: validConfig() })
    expect(r).toMatchObject({ ok: false, reason: 'limit' })
    expect(svc.listTemplates().custom).toHaveLength(10)
  })

  it('缺失 limits：回落全局 MAX_CUSTOM=50（不误拦旧快照）', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    expect(svc.listTemplates().limits).toMatchObject({ max_custom: 50, current: 0 })
    expect(svc.saveTemplate({ name: '旧快照模板', config: validConfig() }).ok).toBe(true)
  })

  it('max_workflows=-1：按不限处理，回落全局 MAX_CUSTOM=50', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    svc.setEntitlementProvider(() => ({ limits: { max_workflows: -1 } }))
    expect(svc.listTemplates().limits).toMatchObject({ max_custom: 50, current: 0 })
  })
})

describe('workflow-service · 发布队列门面', () => {
  it('list/summary/retry 透传给队列', () => {
    const queue = {
      list: () => [{ id: 'wq_1', status: 'failed' }],
      summary: () => ({ total: 1, pending: 0, dispatching: 0, dispatched: 0, failed: 1, missed: 0, cancelled: 0 }),
      retry: (id) => ({ ok: id === 'wq_1' }),
    }
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, queue, now: () => NOW })
    expect(svc.listQueue()).toEqual([{ id: 'wq_1', status: 'failed' }])
    expect(svc.queueSummary().failed).toBe(1)
    expect(svc.retryQueueItem('wq_1')).toEqual({ ok: true })
  })
})
