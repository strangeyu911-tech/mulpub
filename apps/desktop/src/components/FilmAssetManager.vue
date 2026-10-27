<script setup>
/**
 * FilmAssetManager — 影视工程**资产区**（Hub 页级，三个标签共用）
 *
 * 归属：change `kit-asset-health-report`。
 *
 * ⚠ **位置纠正**（本组件存在的原因）：资产导入入口原先挂在 `FilmEngineeringView.vue`
 * （= Hub 的 classic「项目案例」标签）页面顶部。但资产被三个标签**共用**：
 * 「自动」拿 `shot-library` 当规划模板（`planAutoShots({ templateShots })`，空了直接报
 * `AUTO_NO_TEMPLATES`）、「画布」吃 `doctrine`/`shotGrammar`、「项目案例」吃 `shot-library`/任务模板库。
 * 资产**不是任何一个标签的私有物** ⇒ 入口放在三个标签共享的 Hub 页头，而不是塞进某一个标签。
 *
 * 交互（三段，**先看再决定**）：
 *   ① 点入口 → ② 系统目录对话框 → ③ **资产体检报告**（只读，不落盘）
 *      → ④ 报告里直接确认替换（`importable=false` 时确认按钮**禁用**并列出缺项）
 *      → ⑤ 导入中**不可中断**模态 → ⑥ 成功/失败/残留/审计不完整 的提示与恢复指引。
 *
 * 报告的三段补充信息（change `kit-import-rollback-and-template-health`）：
 *   - **模板结构**（P1）：auto 规划把模板 `prompt` 当结构化模板复用，缺场景头/角色行/可识别块
 *     ⇒ 能导能跑但提示词里约束是空的（告警，不阻断）；
 *   - **与当前资产对比**（P2）：导入后场景/分镜/模板是多还是少，必须在确认前看见；
 *   - **版本不符**（P3）：`你的包是 vN / 本版本要 v1`，比「内容不符合契约」可读。
 * ⚠ `null` 一律渲染成占位（`—`），**不印 0**：把「没量到」印成 0 会让用户以为资产是空的。
 * ⚠ 「上一版备份」用 `type=info`（正常态），与 warning 型的「残留/失败」在视觉上分开。
 *
 * 只读与写路径的边界（本组件的硬约束）：
 *   - 体检（②③）**不**产生锁、审计、任何落盘；`importing` 与恢复档位等写路径状态在体检期间**不动**；
 *   - 路径只能来自主进程原生对话框（`inspectKit()` / `importKit()` 都是**空参**调用）。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFilmKitImport } from '@/composables/useFilmKitImport'

const props = defineProps({
  /** 导入成功后由父组件刷新（Hub 会把刷新分发给各 panel） */
  onImported: { type: Function, default: null },
})

const { t } = useI18n()
const {
  importing,
  inspecting,
  inspection,
  inspectAssets,
  resetInspection,
  kitImportReason,
  kitImportRecoveryHint,
  kitImportBackupHint,
  kitImportStaleWarning,
  importKitAssets,
  importReasonText,
} = useFilmKitImport({ onImported: props.onImported })

/** 体检报告对话框（报告 + 确认替换在同一屏 ⇒ 用户看完就能决定） */
const reportVisible = ref(false)
/** 导入中模态：**不可中断** ⇒ v-model 的 setter 是空实现（关不掉） */
const importingVisible = computed({
  get: () => importing.value,
  set: () => {},
})

const counts = computed(() => (inspection.value && inspection.value.counts) || null)
const warnings = computed(() => (inspection.value && inspection.value.warnings) || [])
const requiredMissing = computed(() => (inspection.value && inspection.value.requiredMissing) || [])
const ignoredTopLevel = computed(() => (inspection.value && inspection.value.ignoredTopLevel) || [])
const importable = computed(() => !!(inspection.value && inspection.value.importable))
/** 模板结构（P1）：`null` = kit 加载不出来（**不是** 0 个模板） */
const templateStructure = computed(() => (inspection.value && inspection.value.templateStructure) || null)
/** 与当前资产对比（P2）：`null` = 任一侧形状不齐（**不印 0 差异**） */
const compare = computed(() => (inspection.value && inspection.value.compare) || null)
/** 版本不符（P3）：只让失败可读，严格校验仍会自行拒绝 */
const versionMismatch = computed(() => !!(inspection.value && inspection.value.versionMismatch))

/** delta 渲染：带符号，让「增/减」一眼可见（0 也照印 —— 这里是真的量到了 0） */
function signed (value) {
  if (value === null || value === undefined) return '—'
  return value > 0 ? '+' + value : String(value)
}

/** 统计值渲染：`null` = **没量到**（绝不印 0 —— 把"没测"印成 0 会让用户以为资产是空的） */
function num (value) {
  return value === null || value === undefined ? '—' : String(value)
}

/** 告警 code → 本地化文案（闭集，见 SCHEMA.md 十二） */
function warnText (w) {
  const key = 'filmEngineering.assetManager.warn.' + String(w && w.code)
  const count = w && w.count !== null && w.count !== undefined ? w.count : ''
  return count === '' ? t(key) : t(key, { count })
}

async function onPickAndInspect () {
  const ok = await inspectAssets()
  if (ok) reportVisible.value = true
}

function onCancelReport () {
  reportVisible.value = false
  resetInspection()
}

async function onConfirmImport () {
  if (!importable.value) return
  reportVisible.value = false
  const ok = await importKitAssets()
  // 成功后丢弃报告（避免下次打开看到旧统计）；失败则保留报告上下文已由导入状态接管
  if (ok) resetInspection()
}
</script>

<template>
  <!-- 页级资产区：三个标签都能看到（**不进入任何 tabpanel**） -->
  <div class="fa-bar" data-testid="fe-asset-manager">
    <el-button
      type="primary"
      plain
      size="small"
      :disabled="importing || inspecting"
      data-testid="fe-asset-manager-btn"
      @click="onPickAndInspect"
    >{{ t('filmEngineering.assetManager.entry') }}</el-button>
    <span class="fa-hint">{{ t('filmEngineering.assetManager.hint') }}</span>
  </div>

  <!-- 恢复指引 / 残留 / 审计：失败与「成功但有残留」两种情形都要出现 -->
  <el-alert
    v-if="kitImportReason || kitImportRecoveryHint"
    class="fa-alert"
    type="warning"
    show-icon
    :closable="false"
    data-testid="fe-asset-manager-recovery"
    :title="kitImportReason
      ? t('filmEngineering.filmKitImport.failed', { reason: importReasonText(kitImportReason) })
      : t('filmEngineering.filmKitImport.residue')"
  >
    <span v-if="kitImportRecoveryHint">{{ kitImportRecoveryHint }}</span>
  </el-alert>

  <!-- 上一版备份：**正常态**提示（type=info，不是 warning）——
       图标与颜色都在告诉用户「这不是问题」，否则「成功还报错」会让真告警失去分量 -->
  <el-alert
    v-if="kitImportBackupHint"
    class="fa-alert"
    type="info"
    show-icon
    :closable="false"
    data-testid="fe-asset-manager-backup"
    :title="kitImportBackupHint"
  />

  <!-- 清理更早备份失败：本次已生效，但备份会无声堆积 ⇒ 必须可见 -->
  <el-alert
    v-if="kitImportStaleWarning"
    class="fa-alert"
    type="warning"
    show-icon
    :closable="false"
    data-testid="fe-asset-manager-stale"
    :title="t('filmEngineering.filmKitImport.staleWarning', { detail: kitImportStaleWarning })"
  />

  <!-- 资产体检报告 + 确认替换（同一屏） -->
  <el-dialog
    v-model="reportVisible"
    :title="t('filmEngineering.assetManager.reportTitle')"
    width="560px"
    data-testid="fe-asset-report-dialog"
  >
    <div v-if="inspection" class="fa-report" data-testid="fe-asset-report">
      <el-tag
        :type="importable ? 'success' : 'danger'"
        size="small"
        data-testid="fe-asset-report-verdict"
      >{{ importable ? t('filmEngineering.assetManager.importable') : t('filmEngineering.assetManager.notImportable') }}</el-tag>

      <!-- 统计（counts 为 null ⇒ 明确说「没量到」，不给一排 0） -->
      <ul v-if="counts" class="fa-report-counts" data-testid="fe-asset-report-counts">
        <li>{{ t('filmEngineering.assetManager.scenes', { count: num(counts.scenes) }) }}</li>
        <li>{{ t('filmEngineering.assetManager.shots', { count: num(counts.shots) }) }}</li>
        <li>{{ t('filmEngineering.assetManager.templates', { count: num(counts.templateTasks) }) }}</li>
        <li>{{ t('filmEngineering.assetManager.references', { ok: num(counts.referencesResolvable), total: num(counts.references) }) }}</li>
        <li v-if="inspection.langs && inspection.langs.length">{{ t('filmEngineering.assetManager.langs', { langs: inspection.langs.join(' / ') }) }}</li>
      </ul>
      <p v-else class="fa-report-hint" data-testid="fe-asset-report-nocounts">
        {{ t('filmEngineering.assetManager.countsUnavailable') }}
      </p>

      <!-- 版本不符：先说「包是 vN / 本版本要 v1」，而不是让用户对着「内容不符合契约」猜 -->
      <div v-if="versionMismatch" class="fa-report-block" data-testid="fe-asset-report-version">
        <p class="fa-report-block-title">{{ t('filmEngineering.assetManager.versionTitle') }}</p>
        <p class="fa-report-detail">{{ t('filmEngineering.assetManager.versionMismatch', {
          pkg: num(inspection.assetVersion),
          expected: num(inspection.expectedAssetVersion),
        }) }}</p>
      </div>

      <!-- 模板结构（P1）：auto 规划真正复用的三处结构，缺了能导能跑但约束是空的 -->
      <div v-if="templateStructure" class="fa-report-block fa-report-block-info" data-testid="fe-asset-report-template">
        <p class="fa-report-block-title">{{ t('filmEngineering.assetManager.templateTitle') }}</p>
        <p class="fa-report-detail">{{ t('filmEngineering.assetManager.templateDetail', {
          total: num(templateStructure.total),
          heading: num(templateStructure.withSceneHeading),
          character: num(templateStructure.withCharacterLine),
          blocks: num(templateStructure.withBlocks),
        }) }}</p>
      </div>

      <!-- 与当前资产对比（P2）：导入后是多还是少，必须先看见 -->
      <div v-if="compare" class="fa-report-block fa-report-block-info" data-testid="fe-asset-report-compare">
        <p class="fa-report-block-title">{{ t('filmEngineering.assetManager.compareTitle') }}</p>
        <p class="fa-report-detail">{{ t('filmEngineering.assetManager.compareCurrent', {
          scenes: num(compare.current.scenes),
          shots: num(compare.current.shots),
          templates: num(compare.current.templates),
        }) }}</p>
        <p class="fa-report-detail">{{ t('filmEngineering.assetManager.compareDelta', {
          scenes: signed(compare.delta.scenes),
          shots: signed(compare.delta.shots),
          templates: signed(compare.delta.templates),
        }) }}</p>
      </div>

      <!-- 不可导入：先说缺什么，再说原因 -->
      <div v-if="!importable" class="fa-report-block" data-testid="fe-asset-report-blocking">
        <p class="fa-report-block-title">{{ t('filmEngineering.assetManager.blockingTitle') }}</p>
        <ul v-if="requiredMissing.length">
          <li v-for="m in requiredMissing" :key="m" class="fa-missing-item">{{ m }}</li>
        </ul>
        <p v-if="inspection.blockingMessage" class="fa-report-detail">{{ inspection.blockingMessage }}</p>
      </div>

      <!-- 白名单外条目：不会被拷入，用户有权知道 -->
      <div v-if="ignoredTopLevel.length" class="fa-report-block" data-testid="fe-asset-report-ignored">
        <p class="fa-report-block-title">{{ t('filmEngineering.assetManager.ignoredTitle') }}</p>
        <p class="fa-report-detail">{{ ignoredTopLevel.join('、') }}</p>
      </div>

      <!-- 告警（信息性，不阻断） -->
      <ul v-if="warnings.length" class="fa-report-warns" data-testid="fe-asset-report-warns">
        <li v-for="w in warnings" :key="w.code">{{ warnText(w) }}</li>
      </ul>

      <p class="fa-report-confirm-note">{{ t('filmEngineering.filmKitImport.confirm') }}</p>
    </div>

    <!-- 按钮放**默认插槽**：el-dialog 在测试环境按自定义元素渲染，`#footer` 具名插槽不渲染 -->
    <div class="fa-report-actions">
      <el-button data-testid="fe-asset-report-cancel" @click="onCancelReport">
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :disabled="!importable"
        data-testid="fe-asset-report-confirm"
        @click="onConfirmImport"
      >{{ t('filmEngineering.assetManager.confirmImport') }}</el-button>
    </div>
  </el-dialog>

  <!-- 导入中：**不可中断**（无关闭按钮 / 点遮罩不关 / ESC 不关 / 没有取消） -->
  <el-dialog
    v-model="importingVisible"
    :title="t('filmEngineering.filmKitImport.importing')"
    width="420px"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    data-testid="fe-kit-importing"
  >
    <p class="fa-importing-hint">{{ t('filmEngineering.filmKitImport.importingHint') }}</p>
  </el-dialog>
</template>

<style scoped>
.fa-bar { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.fa-hint { color: #909399; font-size: var(--font-size-sm); }
.fa-alert { margin-top: 10px; }
.fa-report { display: flex; flex-direction: column; gap: 10px; }
.fa-report-counts { margin: 0; padding-left: 20px; line-height: 1.9; }
.fa-report-hint { margin: 0; color: #909399; }
.fa-report-block { padding: 8px 10px; border-radius: 6px; background: rgba(245, 108, 108, 0.08); }
.fa-report-block-info { background: rgba(64, 158, 255, 0.08); }
.fa-report-block-title { margin: 0 0 4px; font-weight: 600; font-size: var(--font-size-sm); }
.fa-report-detail { margin: 4px 0 0; color: #606266; font-size: var(--font-size-sm); word-break: break-all; }
.fa-missing-item { font-family: var(--font-family-mono, monospace); font-size: var(--font-size-sm); }
.fa-report-warns { margin: 0; padding-left: 20px; color: #b88230; font-size: var(--font-size-sm); line-height: 1.8; }
.fa-report-confirm-note { margin: 4px 0 0; line-height: 1.7; font-size: var(--font-size-sm); color: #606266; }
.fa-report-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.fa-importing-hint { margin: 0; line-height: 1.7; color: #909399; }
</style>
