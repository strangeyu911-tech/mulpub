<template>
  <div class="automation-page">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('automation.title') }}</div>
        <div class="page-subtitle">{{ t('automation.subtitle') }}</div>
      </div>
      <div class="automation-header-ops">
        <button class="cohere-btn-text" data-testid="automation-runs-open" @click="openRuns">
          {{ t('automation.wfRunsTitle') }}
        </button>
        <button class="cohere-btn-primary" data-testid="automation-create" @click="openCreate">
          {{ t('automation.create') }}
        </button>
      </div>
    </div>

    <div class="cohere-content">
      <!-- 资源竞争提示（不藏代价） -->
      <div class="automation-notice" data-testid="automation-notice">
        {{ t('automation.resourceNotice') }}
      </div>

      <!-- 真源不可读提示：「读不到」与「没有任务」是两件事 -->
      <div v-if="status !== 'ok'" class="automation-alert" data-testid="automation-status">
        {{ status === 'unreadable' ? t('automation.unreadable') : t('automation.saveFailed') }}
      </div>

      <div v-if="tasks.length === 0" class="automation-empty" data-testid="automation-empty">
        {{ t('automation.empty') }}
      </div>

      <div v-else class="cohere-card">
        <table class="automation-table">
          <thead>
            <tr>
              <th>{{ t('automation.colName') }}</th>
              <th>{{ t('automation.colTrigger') }}</th>
              <th>{{ t('automation.colAction') }}</th>
              <th>{{ t('automation.colPolicy') }}</th>
              <th>{{ t('automation.colLastRun') }}</th>
              <th class="col-ops">{{ t('automation.colOps') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.id" :data-testid="'automation-row-' + task.id">
              <td>
                <label class="automation-switch">
                  <input
                    type="checkbox"
                    :checked="task.enabled"
                    :data-testid="'automation-enabled-' + task.id"
                    @change="toggleEnabled(task, $event.target.checked)"
                  />
                  <span>{{ task.name }}</span>
                </label>
              </td>
              <td>
                <span v-for="label in task.triggerLabels" :key="label" class="automation-chip">{{ label }}</span>
              </td>
              <td>
                <span v-if="task.actionSummary">{{ task.actionSummary }}</span>
                <span v-else>{{ t('automation.actionPipeline') }}</span>
              </td>
              <td>
                {{ task.failurePolicy === 'abort' ? t('automation.policyAbort') : t('automation.policySkip') }}
                <span v-if="task.maxRetries > 0" class="automation-sub">
                  （{{ t('automation.retryTimes', { count: task.maxRetries }) }}）
                </span>
              </td>
              <td>
                <span v-if="task.running" class="automation-chip automation-chip--running">
                  {{ t('automation.running') }}
                </span>
                <span v-else-if="!task.lastRunAt" class="automation-sub">—</span>
                <span v-else>
                  <span :class="'automation-status automation-status--' + task.lastStatus">
                    {{ statusLabel(task.lastStatus) }}
                  </span>
                  <span class="automation-sub">{{ formatTime(task.lastRunAt) }}</span>
                </span>
                <div v-if="task.lastError" class="automation-error" :title="task.lastError">
                  {{ task.lastError }}
                </div>
              </td>
              <td class="col-ops">
                <button class="cohere-btn-text" :data-testid="'automation-run-' + task.id" @click="runNow(task)">
                  {{ t('automation.runNow') }}
                </button>
                <button class="cohere-btn-text" @click="openEdit(task)">{{ t('automation.edit') }}</button>
                <button class="cohere-btn-text cohere-btn-text--danger" @click="remove(task)">
                  {{ t('automation.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <AutomationTaskDialog v-if="showDialog" v-model="showDialog" :task="editingTask" @saved="load" />
    <WorkflowRunsDrawer v-model="showRuns" :runs="runs" @refresh="refreshRuns" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  automationList, automationUpdate, automationRemove, automationRunNow,
  onAutomationNotification, listWorkflowRuns,
} from '@/api/automation'
import { useNotify } from '@/composables/useNotify'
import AutomationTaskDialog from '@/features/automation/AutomationTaskDialog.vue'
import WorkflowRunsDrawer from '@/features/automation/WorkflowRunsDrawer.vue'

const { t } = useI18n()
const { notifyError, notifySuccess } = useNotify()

const tasks = ref([])
const status = ref('ok') // ok | unreadable | save-failed
const showDialog = ref(false)
const editingTask = ref(null)
const showRuns = ref(false)
const runs = ref([])

let stopNotifier = null

function statusLabel (s) {
  if (s === 'completed') return t('automation.statusCompleted')
  if (s === 'failed') return t('automation.statusFailed')
  if (s === 'cancelled') return t('automation.statusCancelled')
  return '—'
}

function formatTime (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load () {
  const res = await automationList()
  if (!res || res.code !== 0) { status.value = 'unreadable'; return }
  tasks.value = (res.data && res.data.tasks) || []
  status.value = 'ok'
}

function openCreate () {
  editingTask.value = null
  showDialog.value = true
}

function openEdit (task) {
  editingTask.value = task
  showDialog.value = true
}

async function toggleEnabled (task, value) {
  const res = await automationUpdate(task.id, { enabled: value })
  if (!res || res.code !== 0 || !res.ok) { notifyError('automation.errSaveFailed'); await load(); return }
  task.enabled = value
}

async function runNow (task) {
  const res = await automationRunNow(task.id)
  if (!res || res.code !== 0) { notifyError('automation.errRunFailed'); return }
  if (res.data && res.data.reason === 'already-running') {
    notifyError('automation.errAlreadyRunning')
    return
  }
  notifySuccess('automation.started')
  await load()
}

async function remove (task) {
  const res = await automationRemove(task.id)
  if (!res || res.code !== 0 || !res.ok) { notifyError('automation.errDeleteFailed'); return }
  notifySuccess('automation.deleted')
  await load()
}

async function openRuns () {
  const res = await listWorkflowRuns()
  runs.value = res && res.code === 0 && res.data ? (res.data.runs || []) : []
  showRuns.value = true
}

async function refreshRuns () {
  const res = await listWorkflowRuns()
  if (res && res.code === 0 && res.data) runs.value = res.data.runs || []
}

onMounted(async () => {
  // 注册必须先于任何 await：首屏 load() 在飞的这段窗口里后台任务完全可能失败或恢复，
  // 而通知不排队、不补发 —— 晚注册一秒，那一秒内的通知就永久丢失（审计 2.4）。
  stopNotifier = onAutomationNotification((payload) => {
    if (!payload) return
    if (payload.level === 'error') notifyError('automation.notifyFailed', { message: payload.message || '' })
    else notifySuccess('automation.notifyRecovered', { message: payload.message || '' })
    load()
  })
  await load()
})

onUnmounted(() => {
  if (stopNotifier) { stopNotifier(); stopNotifier = null }
})
</script>

<style scoped>
.automation-page { display: flex; flex-direction: column; }
.automation-header-ops { display: flex; align-items: center; gap: 12px; }
.automation-notice {
  padding: 10px 14px; margin-bottom: 12px; border-radius: 8px;
  background: var(--color-fill-light, #f7f8fa); color: var(--color-text-secondary, #85858f);
  font-size: var(--font-size-xs, 12px); line-height: 1.6;
}
.automation-alert {
  padding: 10px 14px; margin-bottom: 12px; border-radius: 8px;
  background: #fef0f0; color: #d9534f; font-size: var(--font-size-xs, 12px);
}
.automation-empty {
  padding: 48px 16px; text-align: center; color: var(--color-text-secondary, #85858f);
  font-size: var(--font-size-sm, 13px);
}
.automation-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm, 13px); }
.automation-table th, .automation-table td {
  padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--color-border-light, #eff0f4);
  vertical-align: top;
}
.automation-table th { color: var(--color-text-secondary, #85858f); font-weight: 500; }
.col-ops { white-space: nowrap; }
.automation-switch { display: inline-flex; align-items: center; gap: 6px; }
.automation-chip {
  display: inline-block; margin: 0 4px 4px 0; padding: 2px 8px; border-radius: 10px;
  background: var(--color-fill-light, #f2f3f5); font-size: var(--font-size-xs, 12px);
}
.automation-chip--running { background: #e8f3ff; color: #2f6fd0; }
.automation-sub { display: block; color: var(--color-text-secondary, #85858f); font-size: var(--font-size-xs, 12px); }
.automation-error {
  max-width: 260px; margin-top: 4px; color: #d9534f; font-size: var(--font-size-xs, 12px);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.automation-status--completed { color: #3ba55d; }
.automation-status--failed { color: #d9534f; }
</style>
