import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useTemplateTransfer } from './useTemplateTransfer'
import { exportWorkflowTemplate, importWorkflowTemplate } from '@/api/automation'

vi.mock('@/api/automation', () => ({
  exportWorkflowTemplate: vi.fn(),
  importWorkflowTemplate: vi.fn(),
}))

const t = (key) => key

function setup () {
  return useTemplateTransfer({
    templates: ref({ builtin: [], custom: [{ id: 'wft_1', name: '团队模板' }] }),
    templateId: ref('wft_1'),
    loadTemplates: vi.fn(),
    t,
    notifySuccess: vi.fn(),
  })
}

describe('useTemplateTransfer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('导入成功后重新加载列表并提示模板名', async () => {
    importWorkflowTemplate.mockResolvedValue({ code: 0, ok: true, template: { name: '新模板' } })
    const { onTemplateFile } = setup()
    const event = { target: { files: [{ text: async () => '{"version":2}' }], value: 'x.json' } }
    await onTemplateFile(event)
    expect(importWorkflowTemplate).toHaveBeenCalledWith('{"version":2}', { rename: true })
    expect(event.target.value).toBe('')
  })

  it('版本过新给出专用错误，不抛异常', async () => {
    importWorkflowTemplate.mockResolvedValue({ code: 0, ok: false, reason: 'unsupported-version' })
    const { onTemplateFile, templateImportError } = setup()
    await onTemplateFile({ target: { files: [{ text: async () => '{}' }], value: '' } })
    expect(templateImportError.value).toBe('automation.wfTemplateVersionUnsupported')
  })

  it('导出调用主进程并生成下载链接', async () => {
    exportWorkflowTemplate.mockResolvedValue({ code: 0, ok: true, data: { version: 2 } })
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.fn()
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag)
      if (tag === 'a') el.click = click
      return el
    })
    const { exportSelectedTemplate } = setup()
    await exportSelectedTemplate()
    expect(exportWorkflowTemplate).toHaveBeenCalledWith('wft_1')
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })
})
