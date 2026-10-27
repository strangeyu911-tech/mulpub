<template>
  <div class="film-engineering-view">
    <h1 v-if="!embedded" class="fe-title">{{ t('filmEngineering.title') }}</h1>
    <p v-if="!embedded" class="fe-subtitle">{{ t('filmEngineering.subtitle') }}</p>

    <ConfigProfileManager
      pipeline-id="film-engineering"
      :pipeline-label="t('pipelines.names.film-engineering')"
      :snapshot="filmEngineeringProfileSnapshot"
      :dirty="filmEngineeringProfileDirty"
      test-id-prefix="film-engineering-config-profile"
      :on-list="loadConfigProfiles"
      :on-save="saveFilmEngineeringProfile"
      :on-apply="applyFilmEngineeringProfile"
      :on-rename="renameConfigProfile"
      :on-delete="deleteFilmEngineeringProfile"
    />

    <!-- 空态：kit 不可用 -->
    <el-card v-if="status && !status.available && !statusLoading" class="fe-card" shadow="never">
      <el-alert :title="t('filmEngineering.unavailable')" :description="t('filmEngineering.unavailableDesc')" type="error" show-icon :closable="false">
        <template #default>
          <div class="fe-empty-detail" v-if="status.error">{{ status.error }}</div>
        </template>
      </el-alert>
      <div class="fe-actions">
        <el-button type="primary" :loading="statusLoading" @click="refreshAll">{{ t('filmEngineering.retry') }}</el-button>
      </div>
    </el-card>

    <!-- 头部元信息 -->
    <el-card v-else-if="status && status.available" class="fe-card" shadow="never">
      <div class="fe-meta">
        <div class="fe-meta-title">{{ t('filmEngineering.libraryTitle') }}</div>
        <div class="fe-meta-logline">{{ status.filmMeta.logline }}</div>
        <div class="fe-meta-row">
          <el-tag size="small">{{ t('filmEngineering.stats.duration') }} {{ formatDuration(status.filmMeta.durationSec) }}</el-tag>
          <el-tag size="small" type="info">{{ t('filmEngineering.stats.scenes') }} {{ status.sceneCount }}</el-tag>
          <el-tag size="small" type="info">{{ t('filmEngineering.stats.shots') }} {{ status.shotCount }}</el-tag>
          <el-tag size="small" type="info">{{ t('filmEngineering.stats.references') }} {{ status.referenceCount }}</el-tag>
        </div>
        <div v-if="status.filmMeta.characters && status.filmMeta.characters.length" class="fe-meta-row">
          <span class="fe-meta-label">{{ t('filmEngineering.characters') }}：</span>
          <el-tooltip v-for="c in status.filmMeta.characters" :key="c.name" :content="c.descriptor || ''" placement="top">
            <el-tag size="small" effect="plain" class="fe-char-tag">{{ c.name }}</el-tag>
          </el-tooltip>
        </div>
      </div>
    </el-card>

    <el-tabs v-if="status && status.available" class="fe-tabs">
      <!-- ============ 分镜库 ============ -->
      <el-tab-pane :label="t('filmEngineering.tabs.library')">
        <div class="fe-layout">
          <!-- 场景树 -->
          <div class="fe-scenes">
            <div class="fe-pane-title">{{ t('filmEngineering.stats.scenes') }}（{{ scenes.length }}）</div>
            <el-tree
              :data="sceneTree"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              highlight-current
              default-expand-all
              :expand-on-click-node="false"
              :loading="scenesLoading"
              @node-click="onSceneClick"
            >
              <template #default="{ data }">
                <span class="fe-scene-node">
                  <span class="fe-scene-name">{{ data.isRoot ? t('filmEngineering.libraryTitle') : data.name }}</span>
                  <span v-if="data.shotCount" class="fe-scene-badge" :title="t('filmEngineering.library.shotCountHint')">{{ data.shotCount }}</span>
                </span>
              </template>
            </el-tree>
          </div>

          <!-- 分镜列表 -->
          <div class="fe-shots">
            <div v-if="!selectedSceneId" class="fe-empty">{{ t('filmEngineering.library.selectScene') }}</div>
            <template v-else>
              <div class="fe-toolbar">
                <el-checkbox :model-value="allSelectedInScene" :indeterminate="someSelectedInScene" :title="t('filmEngineering.library.selectAllLoaded')" @change="toggleAllInScene">
                  {{ t('filmEngineering.library.selectAll') }}
                </el-checkbox>
                <span class="fe-hint" data-testid="fe-loaded-count">{{ t('filmEngineering.library.loadedCount', { loaded: shots.length, total: shotsTotal }) }}</span>
                <el-select v-model="copyMode" size="small" class="fe-mode-select">
                  <el-option :label="t('filmEngineering.library.copyModeFull')" value="full" />
                  <el-option :label="t('filmEngineering.library.copyModeBlocks')" value="blocks" />
                  <el-option :label="t('filmEngineering.library.copyModeCharacters')" value="characters" />
                  <el-option :label="t('filmEngineering.library.copyModeGeo')" value="geo" />
                </el-select>
                <el-button size="small" data-testid="fe-copy-selected" :disabled="selectedShotIds.length === 0" @click="copySelected">{{ t('filmEngineering.library.copySelected') }}（{{ selectedShotIds.length }}）</el-button>
                <el-button size="small" data-testid="fe-export-json" :disabled="selectedShotIds.length === 0" :loading="exportLoading" @click="() => exportSelected('json')">{{ t('filmEngineering.library.exportJson') }}</el-button>
                <el-button size="small" data-testid="fe-export-markdown" :disabled="selectedShotIds.length === 0" :loading="exportLoading" @click="() => exportSelected('markdown')">{{ t('filmEngineering.library.exportMd') }}</el-button>
                <el-button size="small" type="primary" data-testid="fe-generate" :disabled="selectedShotIds.length === 0 || selectedShotIds.length > 20" :loading="generating" @click="onGenerate">
                  {{ t('filmEngineering.library.generate') }}
                </el-button>
                <el-button size="small" type="warning" data-testid="fe-video-entry" :disabled="selectedShotIds.length === 0" @click="openVideoPanel">
                  {{ t('filmEngineering.video.entry') }}
                </el-button>
                <el-button size="small" data-testid="fe-production-entry" :disabled="selectedShotIds.length === 0" @click="openProductionPanel">
                  {{ t('filmEngineering.production.entry') }}
                </el-button>
              </div>
              <div v-if="shotsLoading" v-loading="shotsLoading" class="fe-shots-loading" />
              <div v-else-if="shots.length === 0" class="fe-empty">{{ t('filmEngineering.library.empty') }}</div>
              <div v-else class="fe-shot-list">
                <div v-for="s in shots" :key="s.shotId" class="fe-shot-card" :class="{ 'is-selected': selectedShotIds.includes(s.shotId) }">
                  <el-checkbox :model-value="selectedShotIds.includes(s.shotId)" @change="() => toggleShot(s.shotId)" class="fe-shot-check" />
                  <div class="fe-shot-body" role="button" tabindex="0" @click="onOpenShot(s.shotId)" @keydown.enter.prevent="onOpenShot(s.shotId)" @keydown.space.prevent="onOpenShot(s.shotId)">
                    <div class="fe-shot-head">
                      <el-tag size="small" type="info">{{ s.model }}</el-tag>
                      <el-tag v-if="s.width && s.height" size="small" effect="plain">{{ s.width }}×{{ s.height }}</el-tag>
                      <span class="fe-shot-id">{{ s.shotId.slice(0, 8) }}</span>
                    </div>
                    <div class="fe-shot-prompt">{{ promptPreview(s.prompt) }}</div>
                  </div>
                  <el-button size="small" class="fe-shot-copy" @click="copyText(s.shotId, 'full')">{{ t('filmEngineering.library.copyFull') }}</el-button>
                </div>
              </div>
              <div ref="shotListEnd" class="fe-load-more">
                <el-button v-if="shotsHasMore" size="small" :loading="shotsLoadingMore" data-testid="fe-load-more" @click="loadMoreShots">{{ t('filmEngineering.library.loadMore') }}</el-button>
              </div>
            </template>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 剧本套用 ============ -->
      <el-tab-pane :label="t('filmEngineering.tabs.adapt')">
        <div class="fe-adapt">
          <el-card shadow="never" class="fe-card">
            <template #header>{{ t('filmEngineering.adapt.scriptLabel') }}</template>
            <el-input
              v-model="adapt.script"
              type="textarea"
              :rows="8"
              maxlength="10000"
              show-word-limit
              :placeholder="t('filmEngineering.adapt.scriptPlaceholder')"
            />
            <div class="fe-adapt-roles">
              <div class="fe-adapt-roles-title">
                {{ t('filmEngineering.adapt.roleMapTitle') }}
                <span class="fe-hint">{{ t('filmEngineering.adapt.roleMapHint') }}</span>
              </div>
              <div v-for="(entry, i) in roleEntries" :key="'role-' + i" class="fe-role-row">
                <el-input v-model="entry.key" size="small" :placeholder="t('filmEngineering.adapt.roleKeyPlaceholder')" class="fe-role-key" />
                <el-input v-model="entry.value" size="small" :placeholder="t('filmEngineering.adapt.roleValuePlaceholder')" class="fe-role-value" />
                <el-button v-if="i >= 4" size="small" text type="danger" @click="removeRole(i)">{{ t('filmEngineering.adapt.removeRole') }}</el-button>
              </div>
              <el-button v-if="roleEntries.length < 10" size="small" text type="primary" @click="addRole">{{ t('filmEngineering.adapt.addRole') }}</el-button>
            </div>
            <div class="fe-adapt-actions">
              <el-button type="primary" :loading="adapt.loading" @click="onAdapt">{{ t('filmEngineering.adapt.adaptBtn') }}</el-button>
            </div>
          </el-card>

          <el-card v-if="adapt.adaptedShots.length" shadow="never" class="fe-card">
            <template #header>{{ t('filmEngineering.adapt.resultTitle') }}（{{ adapt.adaptedShots.length }} {{ t('filmEngineering.adapt.resultCount') }}）</template>
            <el-alert v-if="adapt.warnings.length" :title="t('filmEngineering.adapt.warningsTitle')" type="warning" :closable="false" class="fe-warn">
              <div v-for="(w, i) in adapt.warnings" :key="i" class="fe-warn-item">{{ w }}</div>
            </el-alert>
            <div v-for="(shot, i) in adapt.adaptedShots" :key="shot.shotId" class="fe-adapted-card">
              <div class="fe-adapted-head">
                <span class="fe-adapted-no">#{{ i + 1 }}</span>
                <el-tag size="small" type="info">{{ shot.model }}</el-tag>
                <el-tag v-if="shot.sourceTemplateId" size="small" effect="plain">{{ shot.sourceTemplateId.slice(0, 8) }}</el-tag>
                <el-button size="small" class="fe-adapted-copy" @click="copyAdaptedShot(shot, i)">{{ t('filmEngineering.adapt.copyShot') }}</el-button>
              </div>
              <div class="fe-adapted-prompt">{{ promptPreview(shot.prompt) }}</div>
            </div>
          </el-card>
          <el-empty v-else-if="!adapt.loading" :description="t('filmEngineering.adapt.noResult')" />
        </div>
      </el-tab-pane>

      <!-- ============ 方法论 ============ -->
      <el-tab-pane :label="t('filmEngineering.tabs.doctrine')">
        <FilmDoctrinePanel :doctrine="doctrine" />
      </el-tab-pane>
    </el-tabs>

    <!-- 分镜详情抽屉（拆出 → views/film-engineering/FilmShotDetailDrawer.vue） -->
    <FilmShotDetailDrawer
      v-model:open="detailOpen"
      :shot="shotDetail"
      :loading="detailLoading"
      :preview="promptPreview"
      @copy="onDetailCopy"
      @copy-token="copyRefToken"
    />

    <!-- 生成结果 -->
    <el-dialog v-model="generateDialogOpen" :title="t('filmEngineering.library.generateResultTitle')" width="560px">
      <div v-if="generateResults" class="fe-gen-results">
        <div v-for="r in generateResults" :key="r.index" class="fe-gen-row">
          <span class="fe-gen-shot">{{ r.shotId ? r.shotId.slice(0, 8) : r.index }}</span>
          <el-tag :type="r.code === 0 ? 'success' : 'danger'" size="small">
            {{ r.code === 0 ? t('filmEngineering.library.generateSuccess') : t('filmEngineering.library.generateFail') }}
          </el-tag>
          <span class="fe-gen-msg">{{ r.message || '' }}</span>
        </div>
      </div>
    </el-dialog>

    <!-- 分镜视频生成面板（拆出 → views/film-engineering/FilmVideoGenPanel.vue，六态） -->
    <FilmVideoGenPanel
      ref="videoPanelRef"
      v-model:open="videoPanelOpen"
      :selected-payload="selectedShotsPayload"
      :selected-count="selectedShotIds.length"
      :preview="promptPreview"
      @goto-models="gotoModelSettings"
    />

    <!-- 全量分批出片面板（拆出 → views/film-engineering/FilmProductionPanel.vue，七态） -->
    <FilmProductionPanel
      ref="productionPanelRef"
      v-model:open="productionPanelOpen"
      :selected-ids="selectedShotIds"
      :selected-count="selectedShotIds.length"
      :preview="promptPreview"
      @goto-models="gotoModelSettings"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFilmEngineering } from '@/composables/useFilmEngineering'
import ConfigProfileManager from '@/components/ConfigProfileManager.vue'
import { useRouter } from 'vue-router'
import { buildSceneTree } from './film-scene-tree'
// 「方法论」标签页整块拆出（change `kit-import-rollback-and-template-health`）：
// 本视图已贴着 `check-max-lines` 上限，只读分区没有理由占用它的行数。
import FilmDoctrinePanel from './film-engineering/FilmDoctrinePanel.vue'
// 三块面板拆出（change `film-view-split-debt`）：各自一台状态机 + 自己的清理钩子。
// `promptPreview` 刻意留在父视图、以 prop 下传 —— 见方案 §五①（文本长度例外清单不许陈旧也不许扩张）。
import FilmVideoGenPanel from './film-engineering/FilmVideoGenPanel.vue'
import FilmProductionPanel from './film-engineering/FilmProductionPanel.vue'
import FilmShotDetailDrawer from './film-engineering/FilmShotDetailDrawer.vue'

// embedded=true 时作为 Hub 第 3 标签「工程案例」内嵌（隐藏页面级 h1/subtitle）；
// 默认 false 时渲染与本次变更前逐字一致（既有测试与 /film-engineering/classic 直达页以此为准）。
defineProps({ embedded: { type: Boolean, default: false } })

const { t } = useI18n()
const {
  status, statusLoading, scenes, scenesLoading, selectedSceneId, shots, shotsLoading,
  shotsTotal, shotsHasMore, shotsLoadingMore,
  shotDetail, detailLoading, doctrine, selectedShotIds, copyMode,
  generating, exportLoading, adapt,
  refreshAll, selectScene, openShot, toggleShot, toggleAllInScene, loadMoreShots,
  copyText, copySelected, exportSelected, generateSelected, adaptScript, copyAdaptedShot,
  buildConfigProfileSnapshot, applyConfigProfileSnapshot,
  loadConfigProfiles, saveConfigProfile, renameConfigProfile, deleteConfigProfile,
  selectedShotsPayload,
} = useFilmEngineering()

const detailOpen = ref(false)
/** 详情抽屉的「复制」按 kind 交回父视图（`copyText` 依赖 composable，不搬进子组件） */
function onDetailCopy (kind) { if (shotDetail.value) copyText(shotDetail.value.shotId, kind) }
const generateDialogOpen = ref(false)
const generateResults = ref(null)

// ===== 三块面板已拆成子组件（change film-view-split-debt）=====
// 父视图只留「这些面板开没开」一件事：各自的状态机、composable 实例、清理钩子都在子组件里。
// ⚠ 开关**留在父视图**：入口按钮在分镜库工具条上（属于本视图），而且既有行为测试断言的正是
//   `wrapper.vm.productionPanelOpen === true` —— 把开关挪进子组件会让那条白盒断言失去对象。
const router = useRouter()
const videoPanelOpen = ref(false)
const productionPanelOpen = ref(false)
const videoPanelRef = ref(null)
const productionPanelRef = ref(null)

function openVideoPanel () {
  videoPanelRef.value?.resetError()
  videoPanelOpen.value = true
}
function openProductionPanel () {
  productionPanelOpen.value = true
  // plan 的触发必须由面板自己做（composable 实例在那侧），父只喊一声
  productionPanelRef.value?.onOpened()
}
function gotoModelSettings () { router.push("/model-providers") }

// 角色映射输入（前 4 个为影视项目案例主角预设）
const roleEntries = reactive([
  { key: 'ROKO', value: '' },
  { key: 'JAXX', value: '' },
  { key: 'LULU', value: '' },
  { key: 'REIN', value: '' },
])

const filmEngineeringProfileSnapshot = computed(() => buildConfigProfileSnapshot(roleEntries))
const filmEngineeringProfileDirty = computed(() => (
  copyMode.value !== 'full' ||
  roleEntries.some((entry) => Boolean(String(entry?.key || '').trim() && String(entry?.value || '').trim()))
))

function saveFilmEngineeringProfile (name, options = {}) {
  return saveConfigProfile(name, roleEntries, options)
}

function applyFilmEngineeringProfile (profile) {
  return applyConfigProfileSnapshot(profile?.snapshot, roleEntries)
}

function deleteFilmEngineeringProfile (profile) {
  return deleteConfigProfile(profile?.id)
}

const sceneTree = computed(() => buildSceneTree(scenes.value))

const allSelectedInScene = computed(() => {
  const ids = shots.value.map((s) => s.shotId)
  return ids.length > 0 && ids.every((id) => selectedShotIds.value.includes(id))
})
const someSelectedInScene = computed(() => {
  const ids = shots.value.map((s) => s.shotId)
  return ids.some((id) => selectedShotIds.value.includes(id)) && !allSelectedInScene.value
})

function formatDuration (sec) {
  if (!Number.isFinite(Number(sec))) return String(sec)
  const m = Math.floor(Number(sec) / 60)
  const s = Number(sec) % 60
  return m + 'm' + String(Math.round(s)).padStart(2, '0') + 's'
}

function promptPreview (text, max = 260) {
  const t2 = String(text || '')
  if (t2.length <= max) return t2
  return t2.slice(0, max) + ' …'
}

function onSceneClick (node) {
  selectScene(node.id)
}

async function onOpenShot (shotId) {
  detailOpen.value = true
  await openShot(shotId)
}

function onGenerate () {
  generateSelected().then((data) => {
    if (data) {
      generateResults.value = data.results || []
      generateDialogOpen.value = true
    }
  })
}

function onAdapt () {
  if (!adapt.script || !adapt.script.trim()) return
  adapt.characterMap = {}
  for (const entry of roleEntries) {
    if (entry.key && entry.key.trim() && entry.value && entry.value.trim()) {
      adapt.characterMap[entry.key.trim()] = entry.value.trim()
    }
  }
  adaptScript()
}

function addRole () {
  if (roleEntries.length >= 10) return
  roleEntries.push({ key: '', value: '' })
}

function removeRole (i) {
  roleEntries.splice(i, 1)
}

async function copyRefToken (token) {
  try {
    await navigator.clipboard.writeText(token)
  } catch (_) {
    /* 静默 */
  }
}

// 4.3 虚拟滚动：列表尾 sentinel 进入视口（提前 240px）自动拉取下一页；无 IntersectionObserver 环境（如 jsdom）跳过，保留手动「加载更多」兜底
const shotListEnd = ref(null)
let shotEndObserver = null
watch(shotListEnd, (el) => {
  if (shotEndObserver) { shotEndObserver.disconnect(); shotEndObserver = null }
  if (el && typeof IntersectionObserver !== 'undefined') {
    shotEndObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && shotsHasMore.value && !shotsLoadingMore.value && !shotsLoading.value) loadMoreShots()
    }, { rootMargin: '240px' })
    shotEndObserver.observe(el)
  }
}, { flush: 'post' })
onBeforeUnmount(() => { if (shotEndObserver) { shotEndObserver.disconnect(); shotEndObserver = null } })

onMounted(() => {
  refreshAll()
})
</script>

<style scoped>
.film-engineering-view { max-width: 1240px; margin: 24px auto; padding: 0 16px; }
.fe-title { font-size: var(--font-size-lg); margin-bottom: 4px; }
.fe-subtitle { color: #909399; font-size: var(--font-size-sm); margin-bottom: 16px; }
.fe-card { margin-bottom: 16px; }
.fe-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.fe-meta-title { font-size: var(--font-size-md); font-weight: 600; }
.fe-meta-logline { color: #606266; font-size: var(--font-size-sm); margin: 6px 0 10px; }
.fe-meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.fe-meta-label { color: #606266; font-size: var(--font-size-sm); }
.fe-char-tag { margin-right: 4px; }
.fe-layout { display: flex; gap: 16px; align-items: flex-start; }
.fe-scenes { width: 300px; min-width: 240px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 12px; max-height: 70vh; overflow: auto; }
.fe-shots { flex: 1; min-width: 0; }
.fe-pane-title { font-weight: 600; margin-bottom: 8px; font-size: var(--font-size-sm); }
.fe-scene-node { display: flex; align-items: center; gap: 6px; flex: 1; }
.fe-scene-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fe-scene-badge { background: var(--el-color-primary-light-8); color: var(--el-color-primary); border-radius: 8px; padding: 0 6px; font-size: var(--font-size-xs); }
.fe-empty { color: #909399; padding: 24px 0; text-align: center; }
.fe-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.fe-mode-select { width: 150px; }
.fe-shots-loading { min-height: 120px; }
.fe-shot-list { display: flex; flex-direction: column; gap: 8px; }
.fe-shot-card { display: flex; align-items: flex-start; gap: 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; }
.fe-shot-card.is-selected { border-color: var(--el-color-primary); }
.fe-shot-check { margin-top: 4px; }
.fe-shot-body { flex: 1; min-width: 0; cursor: pointer; }
.fe-shot-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.fe-shot-id { color: #c0c4cc; font-size: var(--font-size-xs); }
.fe-shot-prompt { color: #606266; font-size: var(--font-size-sm); line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.fe-shot-copy { flex-shrink: 0; }
.fe-load-more { display: flex; justify-content: center; padding: 10px 0; }
.fe-adapt-roles { margin-top: 14px; }
.fe-adapt-roles-title { font-size: var(--font-size-sm); font-weight: 600; margin-bottom: 8px; }
.fe-hint { color: #909399; font-size: var(--font-size-xs); font-weight: 400; margin-left: 8px; }
.fe-role-row { display: flex; gap: 8px; margin-bottom: 8px; }
.fe-role-key { width: 200px; }
.fe-role-value { flex: 1; }
.fe-adapt-actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.fe-warn { margin-bottom: 12px; }
.fe-warn-item { font-size: var(--font-size-sm); }
.fe-adapted-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.fe-adapted-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.fe-adapted-no { font-weight: 600; }
.fe-adapted-copy { margin-left: auto; }
.fe-adapted-prompt { color: #606266; font-size: var(--font-size-sm); line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.fe-gen-results { max-height: 50vh; overflow: auto; }
.fe-gen-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.fe-gen-shot { font-family: monospace; font-size: var(--font-size-xs); width: 80px; }
.fe-gen-msg { color: #909399; font-size: var(--font-size-xs); }
.fe-empty-detail { color: #909399; font-size: var(--font-size-xs); margin-top: 8px; word-break: break-all; }
.fe-actions { margin-top: 14px; }
/* 批次上下文（批号/镜数/画幅/时长）：付费前必须可见，flex:1 后跟按钮会换行，用 flex-basis 限宽 */
</style>
