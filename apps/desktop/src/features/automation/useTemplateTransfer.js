// @ts-check
/**
 * useTemplateTransfer — 模板导出/导入的 UI 侧动作
 *
 * 从 AutomationTaskDialog 抽出，避免弹窗继续膨胀；只负责文件读写与提示，
 * 版本迁移与校验仍在主进程 workflow-template / workflow-service。
 */
import { ref } from 'vue'
import { exportWorkflowTemplate, importWorkflowTemplate } from '@/api/automation'

export function useTemplateTransfer ({ templates, templateId, loadTemplates, t, notifySuccess }) {
  const templateImportError = ref('')

  async function exportSelectedTemplate () {
    templateImportError.value = ''
    const all = [...templates.value.builtin, ...templates.value.custom]
    const tpl = all.find((x) => x.id === templateId.value)
    if (!tpl) return
    const res = await exportWorkflowTemplate(tpl.id)
    if (!res || res.code !== 0 || !res.ok) {
      templateImportError.value = t('automation.wfTemplateImportFailed')
      return
    }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = String(tpl.name || 'workflow-template').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function onTemplateFile (event) {
    templateImportError.value = ''
    const file = event && event.target && event.target.files && event.target.files[0]
    if (!file) return
    try {
      const text = await file.text()
      const res = await importWorkflowTemplate(text, { rename: true })
      if (!res || res.code !== 0 || !res.ok) {
        templateImportError.value = res && res.reason === 'unsupported-version'
          ? t('automation.wfTemplateVersionUnsupported')
          : t('automation.wfTemplateImportFailed')
        return
      }
      notifySuccess('automation.wfTemplateImported', { params: { name: res.template?.name || '' } })
      await loadTemplates()
    } catch (_e) {
      templateImportError.value = t('automation.wfTemplateImportFailed')
    } finally {
      if (event && event.target) event.target.value = ''
    }
  }

  return { templateImportError, exportSelectedTemplate, onTemplateFile }
}
