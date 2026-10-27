<script setup>
/**
 * FilmVideoGenPanel — 分镜视频生成面板（六态）
 *
 * 归属：change `film-view-split-debt`（从 `FilmEngineeringView.vue` 拆出；本批还的是
 * `check-max-lines` 的挂账债，见 `openspec/changes/film-view-split-debt/`）。
 *
 * ⚠ **为什么单独成组件**：`vgPhase` 是一台独立状态机（idle / awaiting-confirm / generating /
 * done / cancelled / failed），它只依赖 `useFilmVideoGen()` 与「用户选中的分镜」两样东西，
 * 与父视图的场景树/分镜列表/配置档案没有任何数据依赖 —— 住在同一个文件里纯粹是历史原因。
 *
 * ⚠ **顺手修掉的一处现存泄漏**：`useFilmVideoGen()` 导出 `dispose()`（清轮询定时器），
 * 而拆分前父视图**只调了 `pdDispose()`、从未调它** ⇒ 关闭页面后轮询仍可能跑。
 * 本组件在 `onBeforeUnmount` 调用 `vgDispose()`；Vue 的父子卸载顺序是「子先于父」，
 * 因此父视图卸载时这里必然先跑到。
 *
 * 数据流不反转：`selectedShotsPayload` / `selectedCount` 由父传入（选中态属于分镜库，不属于本面板）；
 * 面板自身只暴露 `open()` 供父的工具条按钮打开。
 */
import { ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFilmVideoGen, FILM_MAX_VIDEO_BATCH } from '@/composables/useFilmVideoGen'
import { story2videoShowInFolder, story2videoSaveAs } from '@/api/publisher'

const props = defineProps({
  /** 面板开关由**父视图**持有：入口按钮属于分镜库工具条，不属于面板 */
  open: { type: Boolean, default: false },
  /** 父的 `selectedShotsPayload()`：返回当前选中分镜的载荷（函数，不缓存结果） */
  selectedPayload: { type: Function, required: true },
  /** 当前选中分镜数（用于按钮禁用与文案插值） */
  selectedCount: { type: Number, default: 0 },
  /** 父的 `promptPreview`（本批不搬家，理由见 change 方案 §五①） */
  preview: { type: Function, required: true },
})

const emit = defineEmits(['goto-models', 'update:open'])

const { t } = useI18n()

const startError = ref('')
const {
  phase, chosen, busy, progress,
  costCheck, shotResults, finalPath,
  errorCode, errorText,
  start, confirmCost, cancelCost,
  retryShot, reset, dispose,
} = useFilmVideoGen()

/** 面板每次被打开时清掉上一次的入参错误（父只负责把 open 置 true） */
function resetError () { startError.value = '' }

async function onStart () {
  startError.value = ''
  const res = await start(props.selectedPayload(), { aspect: chosen.value.aspect, seconds: chosen.value.seconds })
  if (!res.ok && res.errorCode === 'tooManyShots') startError.value = t('filmEngineering.video.tooManyShots', { max: FILM_MAX_VIDEO_BATCH })
  else if (!res.ok && res.errorCode === 'noShots') startError.value = t('filmEngineering.video.noShots')
}
async function onConfirm () { await confirmCost() }
async function onCancel () { await cancelCost() }
async function onRetry (index) { await retryShot(index) }
function onReset () { reset(); startError.value = '' }
async function onOpenFolder () { if (finalPath.value) await story2videoShowInFolder(finalPath.value) }
async function onSaveAs () { if (finalPath.value) await story2videoSaveAs(finalPath.value) }
function statusType (s) { return s === 'success' ? 'success' : (s === 'failed' ? 'danger' : 'info') }
function statusLabel (s) {
  return s === 'success'
    ? t('filmEngineering.video.statusSuccess')
    : (s === 'failed' ? t('filmEngineering.video.statusFailed') : t('filmEngineering.video.statusPending'))
}

onBeforeUnmount(() => { dispose() })

defineExpose({ resetError })
</script>

<template>
  <el-dialog :model-value="props.open" @update:model-value="emit('update:open', $event)" :title="t('filmEngineering.video.title')" width="640px">
    <!-- idle：发起面板 -->
    <div v-if="phase === 'idle'" class="fe-vg">
      <div class="fe-vg-row"><span class="fe-vg-label">{{ t('filmEngineering.video.selectedCount', { n: props.selectedCount }) }}</span></div>
      <div class="fe-vg-row">
        <span class="fe-vg-label">{{ t('filmEngineering.video.aspect') }}</span>
        <el-select v-model="chosen.aspect" size="small" class="fe-vg-select" data-testid="fe-video-aspect">
          <el-option :label="t('filmEngineering.video.aspect169')" value="16x9" />
          <el-option :label="t('filmEngineering.video.aspect916')" value="9x16" />
          <el-option :label="t('filmEngineering.video.aspectSource')" value="source" />
        </el-select>
      </div>
      <div class="fe-vg-row">
        <span class="fe-vg-label">{{ t('filmEngineering.video.seconds') }}</span>
        <el-select v-model="chosen.seconds" size="small" class="fe-vg-select" data-testid="fe-video-seconds">
          <el-option v-for="d in [5, 8, 10]" :key="d" :label="t('filmEngineering.video.secondsN', { n: d })" :value="d" />
        </el-select>
      </div>
      <div class="fe-vg-hint">{{ t('filmEngineering.video.batchHint', { max: FILM_MAX_VIDEO_BATCH }) }}</div>
      <div v-if="startError" class="fe-vg-error">{{ startError }}</div>
      <div class="fe-vg-actions">
        <el-button type="primary" :loading="busy" data-testid="fe-video-start" :disabled="props.selectedCount === 0 || props.selectedCount > FILM_MAX_VIDEO_BATCH" @click="onStart">
          {{ t('filmEngineering.video.start') }}
        </el-button>
      </div>
    </div>
    <!-- awaiting-confirm：成本确认卡 -->
    <div v-else-if="phase === 'awaiting-confirm'" class="fe-vg">
      <el-alert type="warning" :closable="false" show-icon :title="t('filmEngineering.video.confirmTitle')" />
      <p class="fe-vg-hint">{{ t('filmEngineering.video.confirmHint', { totalShots: costCheck && costCheck.totalShots, aspect: costCheck && costCheck.aspect, seconds: costCheck && costCheck.seconds, provider: costCheck && costCheck.providerId }) }}</p>
      <div class="fe-vg-shots">
        <div v-for="s in shotResults" :key="s.index" class="fe-vg-shot">
          <span class="fe-vg-shot-no">#{{ s.index + 1 }}</span>
          <span class="fe-vg-shot-id">{{ (s.shotId || '').slice(0, 8) }}</span>
          <el-tag size="small" :type="statusType(s.status)">{{ statusLabel(s.status) }}</el-tag>
        </div>
      </div>
      <div class="fe-vg-actions">
        <el-button type="primary" :loading="busy" data-testid="fe-video-confirm" @click="onConfirm">{{ t('filmEngineering.video.confirm') }}</el-button>
        <el-button :loading="busy" data-testid="fe-video-cancel" @click="onCancel">{{ t('filmEngineering.video.cancel') }}</el-button>
      </div>
    </div>
    <!-- generating：进度 + 逐镜结果 -->
    <div v-else-if="phase === 'generating'" class="fe-vg">
      <el-progress :percentage="Math.round(progress || 0)" />
      <div class="fe-vg-hint">{{ t('filmEngineering.video.generating') }}</div>
      <div class="fe-vg-shots">
        <div v-for="s in shotResults" :key="s.index" class="fe-vg-shot">
          <span class="fe-vg-shot-no">#{{ s.index + 1 }}</span>
          <span class="fe-vg-shot-id">{{ (s.shotId || '').slice(0, 8) }}</span>
          <el-tag size="small" :type="statusType(s.status)">{{ statusLabel(s.status) }}</el-tag>
          <el-button v-if="s.status === 'failed'" size="small" :data-testid="'fe-video-retry-' + s.index" @click="onRetry(s.index)">{{ t('filmEngineering.video.retry') }}</el-button>
        </div>
      </div>
    </div>
    <!-- done：成片完成态 -->
    <div v-else-if="phase === 'done'" class="fe-vg">
      <el-alert type="success" :closable="false" show-icon :title="t('filmEngineering.video.doneTitle')" />
      <div class="fe-vg-path">{{ finalPath }}</div>
      <div class="fe-vg-actions">
        <el-button data-testid="fe-video-open-folder" @click="onOpenFolder">{{ t('filmEngineering.video.openFolder') }}</el-button>
        <el-button data-testid="fe-video-save-as" @click="onSaveAs">{{ t('filmEngineering.video.saveAs') }}</el-button>
        <el-button type="primary" data-testid="fe-video-new-run" @click="onReset">{{ t('filmEngineering.video.newRun') }}</el-button>
      </div>
    </div>
    <!-- cancelled -->
    <div v-else-if="phase === 'cancelled'" class="fe-vg">
      <div class="fe-vg-hint">{{ t('filmEngineering.video.cancelled') }}</div>
      <div class="fe-vg-actions"><el-button type="primary" data-testid="fe-video-new-run" @click="onReset">{{ t('filmEngineering.video.newRun') }}</el-button></div>
    </div>
    <!-- failed -->
    <div v-else class="fe-vg">
      <el-alert type="error" :closable="false" show-icon :title="t('filmEngineering.video.failedTitle')" />
      <div v-if="errorCode === 'VIDEO_MODEL_NOT_CONFIGURED'" class="fe-vg-hint">{{ t('filmEngineering.video.noModel') }}</div>
      <div v-else-if="errorText" class="fe-vg-error">{{ errorText }}</div>
      <div class="fe-vg-actions">
        <el-button v-if="errorCode === 'VIDEO_MODEL_NOT_CONFIGURED'" type="primary" data-testid="fe-video-goto-models" @click="emit('goto-models')">{{ t('filmEngineering.video.viewModelSettings') }}</el-button>
        <el-button data-testid="fe-video-new-run" @click="onReset">{{ t('filmEngineering.video.newRun') }}</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
/* ⚠ `.fe-vg*` 整族从父视图逐字搬来：DOM 与 class 不变 ⇒ 视觉基线无需刷新。
   scoped 样式不跨组件生效，故 A/B 各自持有一份（这是拆分的代价，不是重复代码的疏忽）。 */
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
.fe-vg-shot-meta { font-size: var(--font-size-xs); color: #909399; flex: 0 1 auto; margin-right: auto; }
.fe-vg-path { font-family: monospace; font-size: var(--font-size-xs); color: #606266; word-break: break-all; }
</style>
