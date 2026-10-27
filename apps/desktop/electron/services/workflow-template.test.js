// @ts-check
const {
  TEMPLATE_FORMAT,
  TEMPLATE_VERSION,
  MAX_TEMPLATE_BYTES,
  migrateTemplatePayload,
  migrateLegacyConfig,
  buildTemplateExport,
  uniqueName,
} = require('./workflow-template')

describe('workflow-template · 版本迁移', () => {
  it('v1 迁移：补齐 source/content/publish，platform-only targets 变 accountId 空串', () => {
    const out = migrateTemplatePayload({
      version: 1,
      name: '旧模板',
      config: {
        source: { type: 'hotTopics', categories: ['ai'], limit: 3 },
        publish: { targets: ['zhihu', { platform: 'bilibili', accountId: 'acc-9' }] },
      },
    })
    expect(out.ok).toBe(true)
    expect(out.template.migratedFrom).toBe(1)
    expect(out.template.formatVersion).toBe(TEMPLATE_VERSION)
    expect(out.template.config.publish.targets).toEqual([
      { platform: 'zhihu', accountId: '' },
      { platform: 'bilibili', accountId: '' },
    ])
    expect(out.template.config.content.type).toBe('article')
    expect(out.template.config.source.limit).toBe(3)
  })

  it('无 version 的裸对象按 v1 处理', () => {
    const out = migrateTemplatePayload({ name: '裸模板', config: { source: { type: 'hotTopics', categories: ['ai'], limit: 1 } } })
    expect(out.ok).toBe(true)
    expect(out.template.migratedFrom).toBe(1)
  })

  it('v2 只接受正确 format，并剥离账号 ID', () => {
    const out = migrateTemplatePayload({
      format: TEMPLATE_FORMAT,
      version: 2,
      name: '团队模板',
      config: { publish: { targets: [{ platform: 'zhihu', accountId: 'acc-1' }] } },
    })
    expect(out.ok).toBe(true)
    expect(out.template.migratedFrom).toBeNull()
    expect(out.template.config.publish.targets).toEqual([{ platform: 'zhihu', accountId: '' }])

    const bad = migrateTemplatePayload({ format: 'other', version: 2, name: 'x', config: {} })
    expect(bad).toMatchObject({ ok: false, reason: 'unsupported-format' })
    const missing = migrateTemplatePayload({ version: 2, name: 'x', config: {} })
    expect(missing).toMatchObject({ ok: false, reason: 'unsupported-format' })
  })

  it('未来版本 / 非法 JSON / 缺 name 均拒绝', () => {
    expect(migrateTemplatePayload({ version: 99, name: 'x', config: {} })).toMatchObject({ ok: false, reason: 'unsupported-version' })
    expect(migrateTemplatePayload('{bad json')).toMatchObject({ ok: false, reason: 'invalid-json' })
    expect(migrateTemplatePayload({ version: 1, name: '', config: {} })).toMatchObject({ ok: false, reason: 'name:empty' })
  })

  it('超过大小上限的输入返回 too-large，不做深拷贝', () => {
    const huge = 'x'.repeat(MAX_TEMPLATE_BYTES + 1)
    expect(migrateTemplatePayload(huge)).toMatchObject({ ok: false, reason: 'too-large' })
  })
})

describe('workflow-template · 导出与命名', () => {
  it('导出包带格式/版本/时间，且不泄露 accountId', () => {
    const data = buildTemplateExport({
      name: '导出',
      description: 'desc',
      config: { publish: { targets: [{ platform: 'zhihu', accountId: 'acc-1' }] } },
    })
    expect(data).toMatchObject({ format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: '导出', description: 'desc' })
    expect(data.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(data.config.publish.targets).toEqual([{ platform: 'zhihu', accountId: '' }])
  })

  it('重名自动生成带序号的可用名称', () => {
    expect(uniqueName('模板', [])).toBe('模板')
    expect(uniqueName('模板', ['模板'])).toBe('模板（导入 2）')
    expect(uniqueName('模板', ['模板', '模板（导入 2）'])).toBe('模板（导入 3）')
  })

  it('40 字满长名称重名时仍能生成不同名称（后缀不被截掉）', () => {
    const long = '字'.repeat(40)
    const candidate = uniqueName(long, [long])
    expect(candidate).not.toBe(long)
    expect(candidate.length).toBeLessThanOrEqual(40)
    expect(candidate.endsWith('（导入 2）')).toBe(true)
  })

  it('循环引用配置返回 invalid-shape 而不是抛异常', () => {
    const cfg = { source: { type: 'hotTopics' } }
    cfg.self = cfg
    expect(migrateTemplatePayload({ format: TEMPLATE_FORMAT, version: 2, name: 'x', config: cfg }))
      .toMatchObject({ ok: false, reason: 'invalid-shape' })
  })

  it('legacy 迁移对空对象也能产出可校验骨架', () => {
    const cfg = migrateLegacyConfig({})
    expect(cfg.source.type).toBe('hotTopics')
    expect(cfg.publish.mode).toBe('immediate')
    expect(cfg.dedupe.enabled).toBe(true)
  })
})
