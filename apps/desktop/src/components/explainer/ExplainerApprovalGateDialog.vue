<template>
  <UiModal
    :visible="visible"
    :title="titleText"
    size="lg"
    @close="handleClose"
  >
    <!-- 加载中 -->
    <div v-if="loading" class="gate-loading" data-testid="explainer-approval-gate-loading">
      <UiSkeleton variant="paragraph" :rows="3" />
    </div>

    <!-- 载荷加载失败 -->
    <div v-else-if="loadError" class="gate-error" data-testid="explainer-approval-gate-error">
      <p>{{ loadError }}</p>
      <UiButton size="sm" @click="$emit('retry')">{{ t('pipelines.approvalGate.close') }}</UiButton>
    </div>

    <!-- 已驳回态：流水线停在此处 -->
    <div v-else-if="rejected" class="gate-rejected" data-testid="explainer-approval-gate-rejected">
      <p class="gate-rejected-title">{{ t('pipelines.approvalGate.rejectedTitle') }}</p>
      <p v-if="rejectedNote" class="gate-rejected-note" data-testid="explainer-approval-gate-rejected-note">
        {{ rejectedNote }}
      </p>
      <UiButton size="sm" @click="handleClose">{{ t('pipelines.approvalGate.close') }}</UiButton>
    </div>

    <!-- 门内容 -->
    <div v-else class="gate-content" data-testid="explainer-approval-gate-content">
      <!-- 门序号 + 阶段 -->
      <div class="gate-meta">
        <span class="gate-index" data-testid="explainer-approval-gate-index">
          {{ gateIndexText }}
        </span>
        <span v-if="stageName" class="gate-stage" data-testid="explainer-approval-gate-stage">{{ stageName }}</span>
      </div>

      <!-- 产物摘要（字段名逐字取自上游 artifact schema；缺字段的条目不显示，绝不编造数字） -->
      <dl v-if="summaryRows.length" class="gate-summary" data-testid="explainer-approval-gate-summary">
        <div v-for="row in summaryRows" :key="row.key" class="gate-summary-row">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <p v-else class="gate-artifact-missing" data-testid="explainer-approval-gate-artifact-missing">
        {{ t('pipelines.approvalGate.artifactMissing') }}
      </p>

      <!-- G1：渲染引擎二选一（默认无选中态：高亮推荐 ≠ 已选中，否则等于静默默认） -->
      <fieldset v-if="isProposalGate" class="gate-runtime" data-testid="explainer-approval-gate-runtime">
        <legend>{{ t('pipelines.approvalGate.runtime.label') }}</legend>
        <label v-for="option in runtimeOptions" :key="option.value" class="gate-runtime-option">
          <input
            type="radio"
            name="explainer-approval-gate-runtime"
            :value="option.value"
            :checked="runtime === option.value"
            :disabled="busy"
            :data-testid="`explainer-approval-gate-runtime-${option.value}`"
            @change="selectRuntime(option.value)"
          />
          <span :class="{ 'is-recommended': option.recommended }">
            {{ runtimeLabel(option.value) }}
          </span>
          <span v-if="option.recommended" class="gate-runtime-recommended" aria-hidden="true">★</span>
        </label>
        <p v-if="runtimeRequired && !runtime" class="gate-runtime-required" data-testid="explainer-approval-gate-runtime-required">
          {{ t('pipelines.approvalGate.runtime.required') }}
        </p>
      </fieldset>

      <!-- 人审要点 -->
      <section v-if="focusItems.length" class="gate-section" data-testid="explainer-approval-gate-focus">
        <h4>{{ t('pipelines.approvalGate.focusLabel') }}</h4>
        <ul>
          <li v-for="(item, index) in focusItems" :key="index">{{ item }}</li>
        </ul>
      </section>

      <!-- 机判项 -->
      <section v-if="autoCheckItems.length" class="gate-section" data-testid="explainer-approval-gate-auto-checks">
        <h4>{{ t('pipelines.approvalGate.autoChecksLabel') }}</h4>
        <ul>
          <li v-for="(item, index) in autoCheckItems" :key="index">{{ item }}</li>
        </ul>
      </section>

      <!-- 驳回理由 -->
      <label class="gate-note">
        <span>{{ t('pipelines.approvalGate.rejectNote') }}</span>
        <UiInput v-model="note" :disabled="busy" data-testid="explainer-approval-gate-note" />
      </label>

      <!-- 动作 -->
      <div class="gate-actions">
        <UiButton
          variant="secondary"
          :disabled="busy"
          data-testid="explainer-approval-gate-reject"
          @click="handleReject"
        >
          {{ t('pipelines.approvalGate.reject') }}
        </UiButton>
        <UiButton
          :disabled="busy || approveDisabled"
          data-testid="explainer-approval-gate-approve"
          @click="handleApprove"
        >
          {{ t('pipelines.approvalGate.approve') }}
        </UiButton>
      </div>
      <p v-if="actionError" class="gate-error" data-testid="explainer-approval-gate-action-error">{{ actionError }}</p>
    </div>
  </UiModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiModal from '@/components/UiModal.vue'
import UiButton from '@/components/UiButton.vue'
import UiInput from '@/components/UiInput.vue'
import UiSkeleton from '@/components/UiSkeleton.vue'
import { pipelineApprovalGate, pipelineApproveStageGate, pipelineRejectStageGate, pipelineGetRunContext } from '@/api/publisher'

/**
 * AI 讲解视频的人工审批门弹窗（上游 animated-explainer 的 checkpoint / human_approval 语义）。
 *
 * ⚠ 本组件是**纯展示 + 交互回调**：载荷由主进程组装（explainer-approval-gates.js，
 *   严格按上游 checkpoint.schema.json 形状），本组件不参与拼装、不做批准语义判断。
 * ⚠ 摘要字段名逐字取自上游 artifact schema（proposal_packet / script / scene_plan /
 *   asset_manifest / publish_log）；缺字段的条目**不显示**，绝不编造数字。
 */

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 流水线运行 id（门载荷与批准/驳回都按它寻址） */
  runId: { type: String, default: '' },
})

const emit = defineEmits(['close', 'approved', 'rejected', 'retry'])

const { t } = useI18n()
const note = ref('')
const runtime = ref('')
const payload = ref(null)
const loading = ref(false)
const busy = ref(false)
const rejected = ref(false)
const rejectedNote = ref('')
const loadError = ref('')
const actionError = ref('')

watch(() => props.visible, (visible) => {
  if (!visible) return
  note.value = ''
  runtime.value = ''
  actionError.value = ''
  loadError.value = ''
  rejected.value = false
  rejectedNote.value = ''
  loadGate()
})

/** 拉门载荷：主进程按上游 checkpoint.schema.json 组装；驳回态从 run.context 的 approval 记录读。 */
async function loadGate() {
  const runId = String(props.runId || '').trim()
  if (!runId) {
    loadError.value = t('pipelines.approvalGate.loadFailed')
    return
  }
  loading.value = true
  try {
    const res = await pipelineApprovalGate(runId)
    if (!res || res.code !== 0 || !res.data || !res.data.success) {
      loadError.value = (res && res.message) || t('pipelines.approvalGate.loadFailed')
      payload.value = null
      return
    }
    payload.value = res.data.payload
    const contextRes = await pipelineGetRunContext(runId)
    const context = contextRes && contextRes.code === 0 && contextRes.data && typeof contextRes.data === 'object'
      ? contextRes.data
      : null
    const stage = res.data.payload && res.data.payload.stage
    const record = context && stage ? context['approval_' + stage] : null
    if (record && typeof record === 'object' && record.approved === false) {
      rejected.value = true
      rejectedNote.value = typeof record.note === 'string' ? record.note : ''
    }
  } catch (error) {
    loadError.value = (error && error.message) || t('pipelines.approvalGate.loadFailed')
    payload.value = null
  } finally {
    loading.value = false
  }
}

/** 批准：主进程组装 contextPatch（含 G1 的渲染引擎写回 proposal 本体）并推进流水线。 */
async function handleApprove() {
  if (busy.value || approveDisabled.value) return
  const runId = String(props.runId || '').trim()
  if (!runId) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await pipelineApproveStageGate(runId, {
      stage: stageName.value,
      note: note.value,
      renderRuntime: runtime.value || undefined,
    })
    if (!res || res.code !== 0) {
      actionError.value = (res && res.message) || 'approve failed'
      return
    }
    emit('approved')
  } catch (error) {
    actionError.value = (error && error.message) || 'approve failed'
  } finally {
    busy.value = false
  }
}

/** 驳回：记录意见并停住（不推进、不自动重跑）。 */
async function handleReject() {
  if (busy.value) return
  const runId = String(props.runId || '').trim()
  if (!runId) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await pipelineRejectStageGate(runId, { stage: stageName.value, note: note.value })
    if (!res || res.code !== 0) {
      actionError.value = (res && res.message) || 'reject failed'
      return
    }
    rejected.value = true
    rejectedNote.value = note.value
    emit('rejected')
  } catch (error) {
    actionError.value = (error && error.message) || 'reject failed'
  } finally {
    busy.value = false
  }
}

const stageName = computed(() => {
  const p = payload.value
  return p && typeof p.stage === 'string' ? p.stage : ''
})

const isProposalGate = computed(() => stageName.value === 'proposal')

const gateIndexText = computed(() => {
  const meta = payload.value && payload.value.metadata
  if (!meta || typeof meta !== 'object') return ''
  const index = Number(meta.gate_index)
  const total = Number(meta.gate_total)
  if (!Number.isFinite(index) || !Number.isFinite(total)) return ''
  return `${index} / ${total}`
})

const runtimeOptions = computed(() => {
  const meta = payload.value && payload.value.metadata
  const list = meta && Array.isArray(meta.render_runtime_options) ? meta.render_runtime_options : []
  return list
    .filter((o) => o && typeof o.value === 'string')
    .map((o) => ({ value: o.value, recommended: Boolean(o.recommended) }))
})

const runtimeRequired = computed(() => isProposalGate.value && runtimeOptions.value.length > 0)

const approveDisabled = computed(() => runtimeRequired.value && !runtime.value)

const titleText = computed(() => {
  const key = payload.value && payload.value.metadata && payload.value.metadata.gate_title_key
  if (typeof key === 'string' && key) return t(key)
  return t('pipelines.approvalGate.title.proposal')
})

/** 从 payload.artifacts 里按门取摘要；字段缺失的条目直接不出现（不编造）。 */
const summaryRows = computed(() => {
  const p = payload.value
  if (!p || typeof p !== 'object') return []
  const artifacts = p.artifacts && typeof p.artifacts === 'object' ? p.artifacts : {}
  const primary = {
    proposal: 'proposal_packet',
    script: 'script',
    scenes: 'scene_plan',
    assets: 'asset_manifest',
    publish: 'publish_log',
  }[stageName.value]
  const artifact = primary ? artifacts[primary] : null
  if (!artifact || typeof artifact !== 'object') return []
  const rows = []
  const countOf = (value) => (Array.isArray(value) ? value.length : null)
  const push = (key, label, value) => {
    if (value === null || value === undefined) return
    rows.push({ key, label: t(label), value: String(value) })
  }
  if (stageName.value === 'proposal') {
    push('concepts', 'pipelines.approvalGate.summary.concepts', countOf(artifact.concept_options))
    const cost = artifact.cost_estimate && typeof artifact.cost_estimate === 'object' ? artifact.cost_estimate : null
    push('costItems', 'pipelines.approvalGate.summary.costItems', cost ? countOf(cost.line_items) : null)
  } else if (stageName.value === 'script') {
    push('sections', 'pipelines.approvalGate.summary.sections', countOf(artifact.sections))
    push('duration', 'pipelines.approvalGate.summary.duration', artifact.total_duration_seconds)
  } else if (stageName.value === 'scenes') {
    push('scenes', 'pipelines.approvalGate.summary.scenes', countOf(artifact.scenes))
  } else if (stageName.value === 'assets') {
    push('assets', 'pipelines.approvalGate.summary.assets', countOf(artifact.assets))
  } else if (stageName.value === 'publish') {
    push('entries', 'pipelines.approvalGate.summary.entries', countOf(artifact.entries))
  }
  return rows
})

const focusItems = computed(() => {
  const key = `pipelines.approvalGate.focus.${stageName.value}`
  const value = t(key)
  return Array.isArray(value) ? value : []
})

const autoCheckItems = computed(() => {
  const key = `pipelines.approvalGate.autoChecks.${stageName.value}`
  const value = t(key)
  return Array.isArray(value) ? value : []
})

function runtimeLabel(value) {
  return t(`pipelines.approvalGate.runtime.${value}`)
}

function selectRuntime(value) {
  runtime.value = value
}

function handleClose() {
  emit('close')
}

</script>

<style scoped>
.gate-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.gate-index {
  font-size: var(--font-size-xs);
  color: var(--text-secondary, #666);
}

.gate-stage {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-secondary, #f3f4f6);
}

.gate-summary {
  margin: 0 0 16px;
}

.gate-summary-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color, #eee);
}

.gate-summary-row dt {
  color: var(--text-secondary, #666);
  font-size: var(--font-size-sm);
}

.gate-summary-row dd {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.gate-section {
  margin-bottom: 12px;
}

.gate-section h4 {
  margin: 0 0 6px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary, #666);
}

.gate-section ul {
  margin: 0;
  padding-left: 18px;
}

.gate-section li {
  font-size: var(--font-size-sm);
  line-height: 1.7;
}

.gate-runtime {
  margin: 0 0 16px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  padding: 10px 12px;
}

.gate-runtime legend {
  font-size: var(--font-size-sm);
  color: var(--text-secondary, #666);
  padding: 0 4px;
}

.gate-runtime-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  padding: 4px 0;
}

.gate-runtime-option .is-recommended {
  font-weight: 600;
}

.gate-runtime-recommended {
  color: var(--warning-color, #f59e0b);
}

.gate-runtime-required {
  margin: 6px 0 0;
  font-size: var(--font-size-xs);
  color: var(--danger-color, #ef4444);
}

.gate-note {
  display: block;
  margin-bottom: 12px;
  font-size: var(--font-size-sm);
}

.gate-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.gate-error {
  color: var(--danger-color, #ef4444);
  font-size: var(--font-size-sm);
  margin-top: 8px;
}

.gate-rejected-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.gate-rejected-note {
  color: var(--text-secondary, #666);
  font-size: var(--font-size-sm);
  margin-bottom: 12px;
}
</style>
