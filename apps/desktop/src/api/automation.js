/**
 * automation API — 自动化任务模块 IPC 桥接（渲染层）
 *
 * 后台语义：任务的失败/恢复通知经 `onAutomationNotification` 推送到渲染层，
 * 渲染层只转成 toast，**不弹模态框**——自动化任务在后台跑，不该打断当前操作。
 */
import { invokeWithFallback, on as bridgeOn } from './electron-bridge'

/** 列出任务（含触发摘要 / 运行状态 / 上次结果） */
export async function automationList () {
  return invokeWithFallback('automationList', { code: -1, message: 'electronAPI not available', data: { tasks: [] } })
}

/** 新建任务 */
export async function automationCreate (payload) {
  return invokeWithFallback('automationCreate', { code: -1, message: 'electronAPI not available', ok: false }, payload)
}

/** 编辑任务（改触发器 / 失败策略 / 启停） */
export async function automationUpdate (id, payload) {
  return invokeWithFallback('automationUpdate', { code: -1, message: 'electronAPI not available', ok: false }, id, payload)
}

/** 删除任务 */
export async function automationRemove (id) {
  return invokeWithFallback('automationRemove', { code: -1, message: 'electronAPI not available', ok: false }, id)
}

/** 立即运行一次（手动触发，不影响定时计划） */
export async function automationRunNow (id) {
  return invokeWithFallback('automationRunNow', { code: -1, message: 'electronAPI not available', ok: false, data: {} }, id)
}

// ── 复合自动化工作流（2026-10-26）────────────────────────────

export async function listWorkflowTemplates () {
  return invokeWithFallback('automationListTemplates', { code: -1, message: 'electronAPI not available', data: { builtin: [], custom: [] } })
}

export async function saveWorkflowTemplate (payload) {
  return invokeWithFallback('automationSaveTemplate', { code: -1, message: 'electronAPI not available', ok: false }, payload)
}

export async function deleteWorkflowTemplate (id) {
  return invokeWithFallback('automationDeleteTemplate', { code: -1, message: 'electronAPI not available', ok: false }, id)
}

export async function exportWorkflowTemplate (id) {
  return invokeWithFallback('automationExportTemplate', { code: -1, message: 'electronAPI not available', ok: false }, id)
}

export async function importWorkflowTemplate (payload) {
  return invokeWithFallback('automationImportTemplate', { code: -1, message: 'electronAPI not available', ok: false }, payload)
}

export async function getWorkflowMeta () {
  return invokeWithFallback('automationWorkflowMeta', { code: -1, message: 'electronAPI not available', data: null })
}

export async function previewWorkflowPlan (payload) {
  return invokeWithFallback('automationPreviewPlan', { code: -1, message: 'electronAPI not available', ok: false }, payload)
}

export async function listWorkflowRuns () {
  return invokeWithFallback('automationListRuns', { code: -1, message: 'electronAPI not available', data: { runs: [] } })
}

export async function getWorkflowRun (runId) {
  return invokeWithFallback('automationGetRun', { code: -1, message: 'electronAPI not available', data: null }, runId)
}

export async function approveWorkflowRun (runId) {
  return invokeWithFallback('automationApproveRun', { code: -1, message: 'electronAPI not available', ok: false }, runId)
}

export async function cancelWorkflowRun (runId) {
  return invokeWithFallback('automationCancelRun', { code: -1, message: 'electronAPI not available', ok: false }, runId)
}

export async function listWorkflowQueue () {
  return invokeWithFallback('automationListQueue', { code: -1, message: 'electronAPI not available', data: { entries: [], summary: {} } })
}

export async function retryWorkflowQueueItem (id) {
  return invokeWithFallback('automationRetryQueueItem', { code: -1, message: 'electronAPI not available', ok: false }, id)
}

/**
 * 订阅后台任务通知（失败 / 从失败恢复）。
 * @param {(payload: {level:string,title:string,message:string,taskId:string}) => void} callback
 * @returns {Function} 取消订阅
 */
export function onAutomationNotification (callback) {
  return bridgeOn('AutomationNotification', callback)
}
