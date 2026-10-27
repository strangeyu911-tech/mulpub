<script setup>
/**
 * FilmProductionPanel — 全量分批出片面板（七态）
 *
 * 归属：change `film-view-split-debt`（从 `FilmEngineeringView.vue` 拆出）。
 *
 * ⚠ **为什么单独成组件**：`pdPhase` 是第二台独立状态机
 * （idle / plan-ready / batching / manifest-ready / composing / done / failed），
 * 只依赖 `useFilmProduction()` 与「选中的分镜」，与本视图的场景树/配置档案无关。
 *
 * ⚠ **`v-for="(sh, si) (sh, si) + b.shots 两段"` 必须逐字保留**：`src/list-stable-keys.test.js` 以
 * `marker: '(sh, si) + b.shots 两段'` + `item: 'sh'` 机械匹配这一行（该文件的站点已改指本文件）。
 * 换成 `(shot, i) (sh, si) + b.shots 两段` 会让那条锁找不到锚点。
 *
 * 清理：`useFilmProduction()` 的 `dispose()` 从父视图的 `onBeforeUnmount` 移到这里。
 */
import { ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFilmProduction } from '@/composables/useFilmProduction'
import { story2videoShowInFolder, story2videoSaveAs } from '@/api/publisher'

const props = defineProps({
  /** 面板开关由**父视图**持有：入口按钮属于分镜库工具条，不属于面板 */
  open: { type: Boolean, default: false },
  /** 父视图当前选中的分镜 id（plan / resume 用） */
  selectedIds: { type: Array, default: () => [] },
  /** 当前选中分镜数（文案用） */
  selectedCount: { type: Number, default: 0 },
  /** 父的 `promptPreview`（本批不搬家，理由见 change 方案 §五①） */
  preview: { type: Function, required: true },
})

const emit = defineEmits(['goto-models', 'update:open'])

const { t } = useI18n()

const startError = ref('')
const taskIdInput = ref('default')
const expandedBatches = ref(new Set())

const {
  phase, busy, plan,
  chosen, batches, progress,
  renderManifest: manifest, manifestError,
  confirmedShotCount, remainingBatchCount,
  recycled, finalPath,
  errorCode, errorText,
  planProduction, begin, confirmBatch,
  resume, retryShotInBatch,
  recycleAll, composeFinal,
  reset, dispose,
} = useFilmProduction()

/**
 * 面板被打开时由父视图调用：清掉上一次的错误/任务名，并在 idle 态自动拉一次 plan。
 *
 * ⚠ 为什么 plan 的触发留在这里而不是父视图：`planProduction` 属于本面板的 composable 实例，
 * 父视图拿不到它；父只负责「把 open 置 true 再喊我一声」。
 */
function onOpened () {
  startError.value = ''
  taskIdInput.value = 'default'
  if (props.selectedIds.length > 0 && phase.value === 'idle') {
    void planProduction(props.selectedIds.slice())
  }
}

async function onBegin () {
  startError.value = ''
  const id = String(taskIdInput.value || '').trim()
  if (!id) { startError.value = t('filmEngineering.production.taskIdInvalid'); return }
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) { startError.value = t('filmEngineering.production.taskIdInvalid'); return }
  const r = begin(id)
  if (!r.ok) startError.value = t('filmEngineering.production.' + r.errorCode) || r.errorCode
}
async function onConfirmBatch (i) { await confirmBatch(i) }
async function onResume () {
  startError.value = ''
  const id = String(taskIdInput.value || '').trim()
  if (!id) { startError.value = t('filmEngineering.production.taskIdInvalid'); return }
  const r = await resume(id, props.selectedIds.slice())
  if (!r.ok) startError.value = t('filmEngineering.production.' + (r.errorCode || 'noLedger')) || r.errorCode
}
async function onRetryShot (bi, si) { await retryShotInBatch(bi, si) }
async function onRecycle () { await recycleAll() }
async function onCompose () { await composeFinal() }
async function onOpenFolder () { if (finalPath.value) await story2videoShowInFolder(finalPath.value) }
async function onSaveAs () { if (finalPath.value) await story2videoSaveAs(finalPath.value) }
function onReset () { reset(); startError.value = '' }
function toggleBatch (bi) {
  const set = new Set(expandedBatches.value)
  if (set.has(bi)) set.delete(bi)
  else set.add(bi)
  expandedBatches.value = set
}
function batchLabel (st) {
  if (st === 'done') return t('filmEngineering.production.statusDone')
  if (st === 'running') return t('filmEngineering.production.statusRunning')
  if (st === 'failed') return t('filmEngineering.production.statusFailed')
  return t('filmEngineering.production.statusPending')
}
function batchType (st) { return st === 'done' ? 'success' : st === 'running' ? '' : st === 'failed' ? 'danger' : 'info' }
function fmtBytes (b) {
  if (!Number.isFinite(b)) return '—'
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  return Math.round(b / 1e6) + ' MB'
}
function fmtDuration (sec) {
  if (!Number.isFinite(sec)) return '—'
  return Math.round(sec / 60) + ' min'
}
// 画幅枚举 → 与画幅下拉完全相同的显示标签（2026-10-07）。
// 付费确认行上出现原始枚举 "16x9"、而下拉里显示 "16:9 横屏"，是同一次操作里两套说法；
// 用户正要据此确认扣费，标签必须与他刚选的那一串逐字一致。未知值原样回显，不静默兜底。
function aspectLabel (aspect) {
  if (aspect === '16x9') return t('filmEngineering.video.aspect169')
  if (aspect === '9x16') return t('filmEngineering.video.aspect916')
  if (aspect === 'source') return t('filmEngineering.video.aspectSource')
  return aspect || '—'
}

onBeforeUnmount(() => { dispose() })

defineExpose({ onOpened })
</script>

<template>
  <el-dialog :model-value="props.open" @update:model-value="emit('update:open', $event)" :title="t('filmEngineering.production.title')" width="680px" append-to-body>
    <!-- idle: plan loading or error -->
    <div v-if="phase === 'idle'" class="fe-vg">
      <div v-if="busy" class="fe-vg-hint">{{ t('filmEngineering.production.planTitle') }}…</div>
      <div v-if="startError" class="fe-vg-error">{{ startError }}</div>
    </div>
    <!-- plan-ready: 批次计划预览 + 发起确认 -->
    <div v-else-if="phase === 'plan-ready'" class="fe-vg">
      <el-alert type="info" :closable="false" show-icon :title="t('filmEngineering.production.planTitle')" />
      <p class="fe-vg-hint">{{ t('filmEngineering.production.planSummary', { batches: plan.batchCount, size: plan.batchSize, shots: plan.shotCount }) }}</p>
      <div class="fe-vg-row"><span class="fe-vg-label">{{ t('filmEngineering.production.diskEstimate') }}:</span> {{ fmtBytes(plan.diskEstimateBytes) }}</div>
      <div class="fe-vg-row"><span class="fe-vg-label">{{ t('filmEngineering.production.wallclockEstimate') }}:</span> {{ fmtDuration(plan.wallclockEstimateSeconds) }}</div>
      <div class="fe-vg-row"><span class="fe-vg-label">{{ t('filmEngineering.production.mediaRoot') }}:</span> <code class="fe-vg-path">{{ plan.mediaRoot }}</code></div>
      <div class="fe-vg-row">
        <span class="fe-vg-label">{{ t('filmEngineering.production.taskIdLabel') }}</span>
        <el-input v-model="taskIdInput" size="small" style="width:200px" :placeholder="t('filmEngineering.production.taskIdPlaceholder')" maxlength="64" data-testid="fe-production-taskid" />
      </div>
      <div v-if="startError" class="fe-vg-error">{{ startError }}</div>
      <div class="fe-vg-actions">
        <el-button type="primary" :loading="busy" data-testid="fe-production-begin" @click="onBegin">{{ t('filmEngineering.production.startConfirm') }}</el-button>
        <el-button :loading="busy" data-testid="fe-production-resume" @click="onResume">{{ t('filmEngineering.production.resumeBtn') }}</el-button>
      </div>
    </div>
    <!-- batching: 逐批确认 -->
    <div v-else-if="phase === 'batching'" class="fe-vg">
      <div class="fe-vg-row">
        <span><strong>{{ t("filmEngineering.production.remaining") }}:</strong> {{ remainingBatchCount }}</span>
        <span style="margin-left:16px">{{ t("filmEngineering.production.confirmedBudget", { count: confirmedShotCount }) }}</span>
      </div>
      <el-progress :percentage="progress.totalCount ? Math.round(progress.doneCount / progress.totalCount * 100) : 0" :format="() => progress.doneCount + '/' + progress.totalCount" />
      <div class="fe-vg-hint">{{ t("filmEngineering.production.batchHint") }}</div>
      <div v-if="errorCode === 'VIDEO_MODEL_NOT_CONFIGURED'" class="fe-vg-error">{{ t("filmEngineering.production.providerMissing") }}</div>
      <div v-else-if="errorText" class="fe-vg-error">{{ errorText }}</div>
      <div style="margin-top:8px">
        <div v-for="b in batches" :key="b.batchIndex" class="fe-vg-shot" style="flex-wrap:wrap">
          <span class="fe-vg-shot-no">#{{ b.batchIndex + 1 }}</span>
          <el-tag size="small" :type="batchType(b.status)">{{ batchLabel(b.status) }}</el-tag>
          <span class="fe-vg-shot-id">{{ t("filmEngineering.production.shotsDone", { done: b.doneShots || 0, total: b.shotCount }) }}</span>
          <!-- 付费前的批次上下文：批号 / 总批数 / 本批镜数 / 画幅 / 时长。
               这行此前只有文案定义、零引用，用户在确认计费前看不到本批要出什么。 -->
          <span class="fe-vg-shot-meta" data-testid="fe-production-batch-card">{{ t("filmEngineering.production.batchCard", { i: b.batchIndex + 1, n: batches.length, count: b.shotCount, aspect: aspectLabel(chosen.aspect), seconds: chosen.seconds }) }}</span>
          <el-button v-if="b.status === 'pending' || b.status === 'failed'" size="small" type="primary" :loading="busy" :data-testid="'fe-production-confirm-' + b.batchIndex" @click="onConfirmBatch(b.batchIndex)">{{ t("filmEngineering.production.confirmBatch") }}</el-button>
          <el-button size="small" @click="toggleBatch(b.batchIndex)">{{ t("filmEngineering.production.batchDetail") }}</el-button>
          <div v-if="expandedBatches.has(b.batchIndex) && b.shots" style="width:100%;padding-left:24px">
            <div v-for="(sh, si) in b.shots" :key="sh.shotId || si" style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-xs);margin:2px 0">
              <span>{{ (sh.shotId || "").slice(0, 8) }}</span>
              <el-tag size="small" :type="sh.status === 'done' ? 'success' : sh.status === 'failed' ? 'danger' : 'info'">{{ sh.status }}</el-tag>
              <el-button v-if="sh.status === 'failed'" size="small" :data-testid="'fe-production-retry-' + b.batchIndex + '-' + si" @click="onRetryShot(b.batchIndex, si)">{{ t("filmEngineering.production.retryShot") }}</el-button>
            </div>
          </div>
        </div>
      </div>
      <div class="fe-vg-actions" style="margin-top:12px">
        <el-button :loading="busy" data-testid="fe-production-recycle" @click="onRecycle">{{ recycled ? t("filmEngineering.production.recycled", { ok: recycled.okCount, total: recycled.okCount + recycled.failCount, dir: recycled.destDir }) : t("filmEngineering.production.recycleBtn") }}</el-button>
        <el-button data-testid="fe-production-reset" @click="onReset">{{ t("filmEngineering.video.newRun") }}</el-button>
      </div>
      <el-alert type="info" :closable="false" :title="t('filmEngineering.production.recycleGuide')" style="margin-top:8px" />
    </div>
    <!-- manifest-ready: 收口 -->
    <div v-else-if="phase === 'manifest-ready'" class="fe-vg">
      <el-alert type="success" :closable="false" show-icon :title="t('filmEngineering.production.manifestReady', { count: (manifest || []).length })" />
      <div v-if="manifestError" class="fe-vg-error">{{ t("filmEngineering.production.manifestMissing", { error: manifestError }) }}</div>
      <div class="fe-vg-actions">
        <el-button type="primary" :loading="busy" data-testid="fe-production-compose" @click="onCompose">{{ t("filmEngineering.production.compose") }}</el-button>
        <el-button :loading="busy" data-testid="fe-production-recycle" @click="onRecycle">{{ t("filmEngineering.production.recycleBtn") }}</el-button>
        <el-button data-testid="fe-production-reset" @click="onReset">{{ t("filmEngineering.video.newRun") }}</el-button>
      </div>
    </div>
    <!-- composing -->
    <div v-else-if="phase === 'composing'" class="fe-vg">
      <div class="fe-vg-hint">{{ t("filmEngineering.production.composing") }}</div>
      <el-progress :percentage="progress.totalCount ? Math.round(progress.doneCount / progress.totalCount * 100) : 0" indeterminate />
    </div>
    <!-- done -->
    <div v-else-if="phase === 'done'" class="fe-vg">
      <el-alert type="success" :closable="false" show-icon :title="t('filmEngineering.production.doneTitle')" />
      <div class="fe-vg-path">{{ finalPath }}</div>
      <div class="fe-vg-actions">
        <el-button data-testid="fe-production-open-folder" @click="onOpenFolder">{{ t("filmEngineering.video.openFolder") }}</el-button>
        <el-button data-testid="fe-production-save-as" @click="onSaveAs">{{ t("filmEngineering.video.saveAs") }}</el-button>
        <el-button type="primary" data-testid="fe-production-reset" @click="onReset">{{ t("filmEngineering.video.newRun") }}</el-button>
      </div>
    </div>
    <!-- failed -->
    <div v-else class="fe-vg">
      <el-alert type="error" :closable="false" show-icon :title="t('filmEngineering.production.failedTitle')" />
      <div v-if="errorCode === 'VIDEO_MODEL_NOT_CONFIGURED'" class="fe-vg-hint">{{ t("filmEngineering.production.providerMissing") }}</div>
      <div v-else-if="errorText" class="fe-vg-error">{{ errorText }}</div>
      <div class="fe-vg-actions">
        <el-button v-if="errorCode === 'VIDEO_MODEL_NOT_CONFIGURED'" type="primary" data-testid="fe-production-goto-models" @click="emit('goto-models')">{{ t("filmEngineering.video.viewModelSettings") }}</el-button>
        <el-button data-testid="fe-production-reset" @click="onReset">{{ t("filmEngineering.video.newRun") }}</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
/* ⚠ `.fe-vg*` 整族与 A 相同（scoped 样式不跨组件生效 ⇒ 各持一份，DOM/class 未变）。 */
.fe-vg { display: flex; flex-direction: column; gap: 12px; }
.fe-vg-row { display: flex; align-items: center; gap: 12px; }
.fe-vg-label { min-width: 96px; color: #606266; font-size: var(--font-size-sm); }
.fe-vg-select { width: 200px; }
.fe-vg-hint { color: #909399; font-size: var(--font-size-xs); line-height: 1.6; }
.fe-vg-error { color: var(--el-color-danger); font-size: var(--font-size-sm); }
.fe-vg-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.fe-vg-shots { max-height: 40vh; overflow: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 8px 12px; }
.fe-vg-shot { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.fe-vg-shot-no { font-weight: 600; width: 32px; }
.fe-vg-shot-id { font-family: monospace; font-size: var(--font-size-xs); color: #909399; flex: 1; }
/* 批次上下文（批号/镜数/画幅/时长）：付费前必须可见，flex:1 后跟按钮会换行，用 flex-basis 限宽 */
.fe-vg-shot-meta { font-size: var(--font-size-xs); color: #909399; flex: 0 1 auto; margin-right: auto; }
.fe-vg-path { font-family: monospace; font-size: var(--font-size-xs); color: #606266; word-break: break-all; }
</style>
