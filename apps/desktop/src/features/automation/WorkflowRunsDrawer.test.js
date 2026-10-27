import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import WorkflowRunsDrawer from './WorkflowRunsDrawer.vue'

const { retryMock, listQueueMock } = vi.hoisted(() => ({
  retryMock: vi.fn(() => Promise.resolve({ code: 0, ok: true })),
  listQueueMock: vi.fn(() => Promise.resolve({
    code: 0,
    data: {
      entries: [{ id: 'wq_1', status: 'failed', title: '失败条目', error: 'dispatch boom' }],
      summary: { pending: 1, dispatching: 0, dispatched: 0, failed: 1, missed: 0 },
    },
  })),
}))

vi.mock('@/api/automation', () => ({
  getWorkflowRun: () => Promise.resolve({ code: 0, data: null }),
  approveWorkflowRun: () => Promise.resolve({ code: 0, ok: true }),
  cancelWorkflowRun: () => Promise.resolve({ code: 0, ok: true }),
  listWorkflowQueue: listQueueMock,
  retryWorkflowQueueItem: retryMock,
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      automation: {
        wfRunsTitle: '运行记录', cancel: '关闭', wfRunsEmpty: '暂无运行',
        wfQueueTitle: '发布队列',
        wfQueueSummary: '排队 {pending} · 派发中 {dispatching} · 失败 {failed} · 错过 {missed}',
        wfQueueRetry: '重试', wfQueueFailed: '派发失败', wfQueueMissed: '已错过',
        wfQueueUncertain: '派发不确定', wfQueuePending: '排队中', wfQueueDispatching: '派发中',
        wfQueueDispatched: '已交给发布器',
        wfRunStatus: { running: '运行中', completed: '已完成', failed: '失败' },
        wfItemStatus: { scheduled: '已排期', failed: '失败' },
      },
    },
  },
})

describe('WorkflowRunsDrawer · 队列面板', () => {
  it('展示队列失败项并可重试', async () => {
    const w = mount(WorkflowRunsDrawer, {
      props: { modelValue: true, runs: [] },
      global: { plugins: [i18n] },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('[data-testid="workflow-queue"]').text()).toContain('失败条目')
    expect(w.find('[data-testid="workflow-queue"]').text()).toContain('dispatch boom')
    await w.find('[data-testid="workflow-queue"] button').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(retryMock).toHaveBeenCalledWith('wq_1')
    w.unmount()
  })
})
