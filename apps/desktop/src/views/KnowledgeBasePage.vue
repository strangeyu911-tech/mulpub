<template>
  <div class="mp-page mp-page--wide kb-page">
    <div class="mp-page-inner">
      <header class="mp-page-header">
        <div class="mp-page-heading">
          <h1 class="mp-page-title">{{ t('knowledgeBase.title') }}</h1>
          <p class="mp-page-subtitle">{{ subtitleText }}</p>
        </div>
        <div class="mp-page-actions">
          <button v-if="activeTab === 'viral'" type="button" class="mp-btn mp-btn--primary" @click="showViralForm = true">＋ {{ t('knowledgeBase.addViral') }}</button>
          <button v-if="activeTab === 'personal'" type="button" class="mp-btn mp-btn--primary" @click="showPersonalForm = true">＋ {{ t('knowledgeBase.addPersonal') }}</button>
          <button v-if="activeTab === 'personal'" type="button" class="mp-btn mp-btn--secondary" @click="triggerBatchImport">{{ t('knowledgeBase.batchImport') }}</button>
          <button type="button" class="mp-btn mp-btn--secondary" @click="handleExport">{{ t('knowledgeBase.exportToFeishu') }}</button>
        </div>
      </header>

      <div class="mp-segmented kb-tabs" role="tablist" :aria-label="t('knowledgeBase.title')">
        <button
          v-for="tab in KB_TABS"
          :key="tab.key"
          type="button"
          role="tab"
          class="kb-tab-btn"
          :class="{ active: activeTab === tab.key }"
          :aria-selected="activeTab === tab.key"
          @click="activeTab = tab.key"
        >{{ t(tab.labelKey) }}</button>
      </div>

      <!-- F-204：模式提取积压提示条（deferred>0 才出现；IPC 失败静默隐藏，fail-open） -->
      <div v-if="activeTab === 'viral' && queueDeferred > 0" class="mp-notice mp-notice--warning" data-testid="pattern-queue-backlog">
        <span class="mp-notice-text">{{ t('knowledgeBase.patternQueueBacklog', { n: queueDeferred }) }}</span>
      </div>
      <ViralLibraryTable v-if="activeTab === 'viral'" ref="viralRef" @create="showViralForm = true" />
      <PatternAnalysisPanel v-if="activeTab === 'pattern'" ref="patternRef" />
      <PersonalKnowledgePanel v-if="activeTab === 'personal'" ref="personalRef" @create="showPersonalForm = true" />

      <ViralFormDialog v-if="showViralForm" :item="editingViral" @close="showViralForm = false; editingViral = null" @saved="onViralSaved" @collect="onCollectByLink" />
      <PersonalFormDialog v-if="showPersonalForm" :item="editingPersonal" @close="showPersonalForm = false; editingPersonal = null" @saved="onPersonalSaved" />

      <input ref="fileInput" type="file" multiple accept=".txt,.md,.doc,.docx" style="display:none" @change="onFilesSelected" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { userFacingErrorMessage } from '@/utils/user-facing-error'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { formatUserError } from '@/utils/user-facing-error'
import { importFiles, exportViralToFeishu, exportPersonalToFeishu } from '@/api/knowledge-library'
import { getPatternQueueStats } from '@/api/knowledge-library'
import { getApi } from '@/api/electron-bridge'
import ViralLibraryTable from '@/components/ViralLibraryTable.vue'
import PatternAnalysisPanel from '@/components/PatternAnalysisPanel.vue'
import PersonalKnowledgePanel from '@/components/PersonalKnowledgePanel.vue'
import ViralFormDialog from '@/components/ViralFormDialog.vue'
import PersonalFormDialog from '@/components/PersonalFormDialog.vue'

const { t } = useI18n()
const router = useRouter()
const activeTab = ref('viral')
/** 页签定义：渲染与顺序的唯一来源（避免三个按钮各写一遍条件）。 */
const KB_TABS = Object.freeze([
  { key: 'viral', labelKey: 'knowledgeBase.tabViral' },
  { key: 'pattern', labelKey: 'knowledgeBase.tabPattern' },
  { key: 'personal', labelKey: 'knowledgeBase.tabPersonal' },
])
// F-204：deferred 计数（页头提示条）；挂载时拉一次，失败保持 0（不打扰）
const queueDeferred = ref(0)
async function loadQueueStats () {
  try {
    const res = await getPatternQueueStats()
    if (res && res.code === 0 && res.data) queueDeferred.value = Number(res.data.deferred) || 0
  } catch { /* fail-open：静默 */ }
}
onMounted(loadQueueStats)
const showViralForm = ref(false)
const showPersonalForm = ref(false)
const editingViral = ref(null)
const editingPersonal = ref(null)
const viralRef = ref(null)
const patternRef = ref(null)
const subtitleText = computed(() => {
  if (activeTab.value === 'viral') return t('knowledgeBase.viralSubtitle')
  if (activeTab.value === 'pattern') return t('knowledgeBase.patternSubtitle')
  return t('knowledgeBase.personalSubtitle')
})
const personalRef = ref(null)
const fileInput = ref(null)

/** 「用链接采集」入口：关闭手动录入弹窗，跳转采集页走链接采集流程 */
function onCollectByLink() {
  showViralForm.value = false
  editingViral.value = null
  router.push('/collection')
}

function onViralSaved() {
  showViralForm.value = false
  editingViral.value = null
  viralRef.value?.loadData()
}

function onPersonalSaved() {
  showPersonalForm.value = false
  editingPersonal.value = null
  personalRef.value?.loadData()
}

function triggerBatchImport() {
  fileInput.value?.click()
}

async function onFilesSelected(e) {
  const files = e.target.files
  if (!files || !files.length) return
  const filePaths = []
  for (const f of files) {
    if (f.size > 5 * 1024 * 1024) {
      ElMessage.warning(t('knowledgeBase.fileTooLarge', { name: f.name }))
      fileInput.value.value = ''
      return
    }
    // File 对象跨 contextBridge 后路径会丢失；经 getPathForFile 拿到真实路径
    const fp = typeof getApi()?.getPathForFile === 'function'
      ? await getApi().getPathForFile(f)
      : (f.path || '')
    if (!fp) {
      ElMessage.warning(t('knowledgeBase.importFailed'))
      fileInput.value.value = ''
      return
    }
    filePaths.push(fp)
  }
  if (filePaths.length === 0) return
  const categoryPerFile = new Array(filePaths.length).fill('personal_stories')
  try {
    const res = await importFiles(filePaths, categoryPerFile)
    if (res && res.code === 0 && res.data) {
      const { total, results } = res.data
      const succeeded = results.filter(r => r.ok).length
      const failed = results.filter(r => r.error).length
      let msg = t('knowledgeBase.importResult', { total, succeeded, failed })
      if (failed > 0) {
        // 逐文件错误经 formatUserError 归一化（i18n + 友好度），文件路径仅保留文件名避免泄露本机绝对路径
        const errors = results.filter(r => r.error).map(r => {
          const name = String(r.path || '').split(/[\\/]/).pop() || t('knowledgeBase.importFailed')
          return name + ': ' + formatUserError({ message: String(r.error) }, { fallback: t('knowledgeBase.importFailed') }).message
        }).join('; ')
        msg += '\n' + errors
      }
      if (failed > 0) ElMessage.warning(msg)
      else ElMessage.success(msg)
      personalRef.value?.loadData()
    } else {
      // 业务错误 resolve 分支同样走 formatUserError（i18n + 友好度强制，禁止原始技术消息直出）
      ElMessage.error(formatUserError(res || {}, { fallback: t('knowledgeBase.importFailed') }).message)
    }
  } catch (err) {
    ElMessage.error(formatUserError(err, { fallback: t('knowledgeBase.importFailed') }).message)
  } finally {
    fileInput.value.value = ''
  }
}

async function handleExport() {
  const title = prompt(t('knowledgeBase.exportTitlePrompt'), t('knowledgeBase.exportTitleDefault'))
  if (!title) return
  try {
    let res
    if (activeTab.value === 'viral') {
      res = await exportViralToFeishu(title)
    } else {
      res = await exportPersonalToFeishu(title)
    }
    if (res && res.code === 0 && res.data) {
      const { docId, count } = res.data
      ElMessage.success(t('knowledgeBase.exportSuccess', { docId, count }))
    } else {
      ElMessage.error(userFacingErrorMessage(res, () => t('knowledgeBase.exportFailed')))
    }
  } catch (e) {
    ElMessage.error(t('knowledgeBase.exportFailed'))
  }
}
</script>
