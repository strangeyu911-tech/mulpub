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
    publish: { targets: [{ platform: 'zhihu', accountId: '' }], mode: 'immediate', startAt: '' },
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
})

describe('workflow-service · 预览', () => {
  it('返回摘要、目标数与每个目标的排期数', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const r = svc.previewPlan(validConfig(), { itemCount: 3 })
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('热门选题')
    expect(r.targets).toHaveLength(1)
    expect(r.slotsByTarget['zhihu:default']).toHaveLength(3)
    expect(r.totalMinutes).toBe(70)
  })

  it('非法配置 → invalid-config + errors，不返回排期', () => {
    const svc = createWorkflowService({ store: fakeStore(), runner: {}, now: () => NOW })
    const r = svc.previewPlan({ ...validConfig(), cadence: { minMinutes: 40, maxMinutes: 35 } }, { itemCount: 1 })
    expect(r.ok).toBe(false)
    expect(r.errors[0].field).toBe('cadence.minMinutes')
  })
})
