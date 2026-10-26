<template>
  <div v-if="modelValue" class="wfr-mask">
    <div class="wfr-panel" data-testid="workflow-runs">
      <div class="wfr-head">
        <div class="wfr-title">{{ t('automation.wfRunsTitle') }}</div>
        <button class="cohere-btn-text" @click="close">{{ t('automation.cancel') }}</button>
      </div>

      <div v-if="!runs.length" class="wfr-empty">{{ t('automation.wfRunsEmpty') }}</div>

      <div v-else class="wfr-list">
        <div v-for="run in runs" :key="run.id" class="wfr-run">
          <div class="wfr-run__head">
            <button type="button" class="wfr-run__toggle" @click="toggle(run.id)">
              <div>
                <div class="wfr-run__name">{{ run.workflowName || run.workflowId || run.id }}</div>
                <div class="wfr-run__meta">
                  <span :class="'wfr-status wfr-status--' + run.status">{{ statusLabel(run.status) }}</span>
                  <span class="wfr-sub">{{ formatTime(run.startedAt) }}</span>
                  <span class="wfr-sub">
                    {{ t('automation.wfRunSummary', {
                      collected: run.summary.collected,
                      scheduled: run.summary.scheduled,
                      skipped: run.summary.skipped,
                      failed: run.summary.failed,
                    }) }}
                  </span>
                </div>
              </div>
            </button>
            <div class="wfr-run__ops">
              <button v-if="run.status === 'awaiting_review'" class="cohere-btn-primary" @click.stop="approve(run.id)">
                {{ t('automation.wfApprove') }}
              </button>
              <button v-if="run.status === 'running'" class="cohere-btn-text" @click.stop="cancel(run.id)">
                {{ t('automation.wfCancelRun') }}
              </button>
            </div>
          </div>

          <div v-if="expanded === run.id && detail" class="wfr-detail">
            <div v-for="item in detail.items" :key="item.index" class="wfr-item">
              <span :class="'wfr-item__status wfr-item__status--' + item.status">{{ itemStatus(item.status) }}</span>
              <span class="wfr-item__title">{{ item.title || item.url || item.externalId }}</span>
              <span class="wfr-item__time">{{ item.publishAt ? formatTime(item.publishAt) : '' }}</span>
              <span v-if="item.error" class="wfr-item__err" :title="item.error">{{ item.error }}</span>
            </div>
            <div v-if="detail.warnings && detail.warnings.length" class="wfr-warn">
              <div v-for="(w, i) in detail.warnings" :key="i">⚠ {{ w.sourceType }}: {{ w.message }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { getWorkflowRun, approveWorkflowRun, cancelWorkflowRun } from '@/api/automation'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  runs: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'refresh'])
const { t } = useI18n()
const expanded = ref('')
const detail = ref(null)

function close () { emit('update:modelValue', false) }
function onKeydown (e) { if (e.key === 'Escape' && props.modelValue) close() }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
async function toggle (runId) {
  if (expanded.value === runId) { expanded.value = ''; detail.value = null; return }
  expanded.value = runId
  const res = await getWorkflowRun(runId)
  detail.value = res && res.code === 0 ? res.data : null
}
async function approve (runId) {
  await approveWorkflowRun(runId)
  emit('refresh')
}
async function cancel (runId) {
  await cancelWorkflowRun(runId)
  emit('refresh')
}

function statusLabel (s) { return t('automation.wfRunStatus.' + s) }
function itemStatus (s) { return t('automation.wfItemStatus.' + s) }
function formatTime (value) {
  if (!value) return ''
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleString()
}
</script>

<style scoped>
.wfr-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.wfr-panel { width: 760px; max-height: 82vh; overflow-y: auto; padding: 18px 22px; background: #fff; border-radius: 12px; }
.wfr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.wfr-title { font-size: var(--font-size-lg, 16px); font-weight: 600; }
.wfr-empty { padding: 36px; text-align: center; color: #85858f; }
.wfr-run { border: 1px solid #eff0f4; border-radius: 8px; margin-bottom: 10px; }
.wfr-run__head { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
.wfr-run__toggle { flex: 1; display: block; padding: 0; border: 0; background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.wfr-run__name { font-weight: 500; margin-bottom: 4px; }
.wfr-run__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wfr-sub { color: #85858f; font-size: var(--font-size-xs, 12px); }
.wfr-status { font-size: var(--font-size-xs, 12px); padding: 1px 8px; border-radius: 10px; background: #f2f3f5; }
.wfr-status--completed { background: #e8f7ee; color: #2e7d4f; }
.wfr-status--failed { background: #fdecec; color: #c0392b; }
.wfr-status--awaiting_review { background: #fff4e5; color: #b26a00; }
.wfr-detail { border-top: 1px solid #eff0f4; padding: 8px 12px; }
.wfr-item { display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: var(--font-size-xs, 12px); }
.wfr-item__status { min-width: 56px; color: #2f6fd0; }
.wfr-item__status--failed { color: #c0392b; }
.wfr-item__status--skipped { color: #85858f; }
.wfr-item__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wfr-item__time { color: #85858f; }
.wfr-item__err { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c0392b; }
.wfr-warn { margin-top: 6px; padding: 6px 8px; background: #fff8e6; color: #8a6100; font-size: var(--font-size-xs, 12px); border-radius: 6px; }
</style>
