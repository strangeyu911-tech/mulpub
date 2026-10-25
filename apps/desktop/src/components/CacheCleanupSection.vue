<template>
    <div class="cache-section" data-testid="cache-cleanup-section" role="group" :aria-label="t('settings.cache.title')">
      <div class="cache-header">
        <div>
          <div class="cache-title">{{ t('settings.cache.title') }}</div>
          <div class="cache-subtitle">{{ t('settings.cache.subtitle') }}</div>
        </div>
        <div class="page-actions">
          <button class="cohere-btn-secondary" :disabled="cacheLoading" @click="loadCache">⟳ {{ t('common.refresh') }}</button>
          <button class="clear-btn" :disabled="!cacheInfo.totalBytes || cacheClearing" data-testid="cache-clear-btn" @click="clearCache">
            {{ cacheClearing ? t('settings.cache.clearing') : t('settings.cache.clearBtn') }}
          </button>
        </div>
      </div>
      <div class="log-hint" role="note">
        <span class="hint-icon">ℹ️</span>
        {{ t('settings.cache.autoClearHint') }}
      </div>
      <div class="log-summary">
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">{{ t('settings.cache.totalSize') }}</div>
            <div class="summary-value">{{ formatBytes(cacheInfo.totalBytes) }}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">{{ t('settings.cache.fileCount') }}</div>
            <div class="summary-value">{{ cacheInfo.fileCount }}</div>
          </div>
        </div>
        <div class="cache-item-list">
          <div v-for="item in cacheInfo.items" :key="item.key" class="log-file-row">
            <span class="file-name" :title="item.dir">{{ cacheItemLabel(item.key) }}</span>
            <span class="file-size">{{ formatBytes(item.totalBytes) }}</span>
          </div>
          <div v-if="cacheLoading" class="log-empty"><UiSkeleton variant="list" :count="2" /></div>
          <div v-else-if="!cacheInfo.items.length" class="log-empty">{{ t('settings.cache.empty') }}</div>
        </div>
      </div>
      <!-- 清理结果提示：成功走绿色内联提示条（UiInlineNotice，inline-notice-green 2026-10-26）；
           失败保持红字浅底（同一槽位两种语义，失败不得借用成功绿误导用户）。 -->
      <UiInlineNotice
        v-if="cacheClearedText"
        :text="cacheClearedText"
        :close-label="t('settings.cache.clearedToastClose')"
        test-id="cache-cleanup-result"
        data-testid="cache-cleanup-result"
      />
      <div v-else-if="cacheToast" class="cache-toast" role="status" data-testid="cache-cleanup-error">{{ cacheToast }}</div>
    </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { cacheGetStats, cacheClear } from '@/api/publisher'
import { formatBytes } from '@/utils/bytes'
import UiInlineNotice from './UiInlineNotice.vue'

const { t } = useI18n()

const cacheLoading = ref(false)
const cacheClearing = ref(false)
// 清理结果拆成两个槽：成功文案走绿色内联提示条，失败文案走红字提示。
// 拆开的理由：绿色是「已成功」的语义色，失败复用绿色会误导用户（inline-notice-green 决策记录）。
const cacheClearedText = ref('')
const cacheToast = ref('')
const cacheInfo = reactive({ totalBytes: 0, fileCount: 0, items: [] })

function cacheItemLabel (key) {
  if (key === 'story2video') return t('settings.cache.itemStory2Video')
  if (key === 'filmEngineering') return t('settings.cache.itemFilmEngineering')
  return key
}

async function loadCache () {
  cacheLoading.value = true
  try {
    const result = await cacheGetStats()
    if (result && result.code === 0 && result.data) {
      cacheInfo.totalBytes = result.data.totalBytes || 0
      cacheInfo.fileCount = result.data.fileCount || 0
      cacheInfo.items = Array.isArray(result.data.items) ? result.data.items : []
    }
  } finally {
    cacheLoading.value = false
  }
}

async function clearCache () {
  if (cacheClearing.value) return
  cacheClearing.value = true
  cacheClearedText.value = ''
  cacheToast.value = ''
  try {
    const result = await cacheClear()
    if (result && result.code === 0 && result.data) {
      await loadCache()
      cacheClearedText.value = t('settings.cache.clearedToast', { size: formatBytes(result.data.freedBytes || 0) })
    } else {
      cacheToast.value = t('settings.cache.clearFailedToast')
    }
  } catch {
    cacheToast.value = t('settings.cache.clearFailedToast')
  } finally {
    cacheClearing.value = false
  }
}

onMounted(() => {
  loadCache()
})
</script>

<style scoped>
/* 下列卡片基元样式与 LogsSettings.vue 同源：scoped 样式不跨组件继承，逐文件行数门禁下宁可少量重复，也不把局部样式提升为全局（避免污染其他设置页） */
.log-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: var(--primary-light, #eef4ff);
  color: var(--text-secondary, #4a5568);
  border-radius: 8px;
  padding: 10px 14px;
  margin: 12px 0 16px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

.hint-icon {
  flex-shrink: 0;
}

.clear-btn {
  background: #e5484d;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: opacity 150ms;
}

.clear-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.log-summary {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.summary-label {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--text-muted, #718096);
  margin-bottom: 4px;
}

.summary-value {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary, #1a202c);
}

.log-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-size: var(--font-size-sm);
  border-bottom: 1px solid var(--border-light, #e2e8f0);
}

.log-file-row:last-child {
  border-bottom: none;
}

.file-name {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.file-size {
  color: var(--text-muted, #718096);
}

.log-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-muted, #718096);
}

.cache-section {
  margin-top: 20px;
}

.cache-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cache-title {
  font-size: var(--font-size-base);
  font-weight: 650;
  color: var(--text-primary, #1a202c);
}

.cache-subtitle {
  margin-top: 4px;
  color: var(--text-muted, #718096);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.cache-item-list {
  margin-top: 10px;
  border-top: 1px dashed var(--border-light, #e2e8f0);
}

/* 失败态提示条：与成功态（UiInlineNotice 绿色）语义分离，用 danger 语义槽。
   原 #067647/#ecfdf3 是成功绿，被失败提示复用属配色错误（inline-notice-green 修正）。 */
.cache-toast {
  margin-top: 10px;
  border: 1px solid var(--color-danger);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
  background: var(--color-danger-soft);
}
</style>
