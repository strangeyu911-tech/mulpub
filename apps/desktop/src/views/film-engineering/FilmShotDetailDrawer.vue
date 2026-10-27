<script setup>
/**
 * FilmShotDetailDrawer — 分镜详情抽屉（只读展示 + 复制动作）
 *
 * 归属：change `film-view-split-debt`（从 `FilmEngineeringView.vue` 拆出）。
 *
 * 边界（为什么这样切）：
 *   - **只读**：本组件不调用任何写接口，也不持有 IPC 能力；唯一的外部动作是「复制」与「复制 token」，
 *     它们通过 `emit` 交回父视图执行（父侧 `copyText` / `copyRefToken` 行为逐字不变）；
 *   - `shot` 是父视图 `useFilmEngineering()` 里的 `shotDetail`，**仅用于展示**；
 *     `copy-token` 回传的 `token` 就是模板里已经明文渲染的那串参考 token（形如 `@ROKO`），
 *     不新增数据通路，也不引入新的暴露面（详见 change 方案 §接口面）；
 *   - `loading` 是父的 `detailLoading`（`v-loading` 指令的绑定源，搬进本组件后全仓命中数不变）。
 *
 * `expanded`（提示词展开/收起）是纯展示态，随组件走。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  /** v-model: 抽屉开关 */
  open: { type: Boolean, default: false },
  /** 父视图的 `shotDetail`（仅展示；`null` ⇒ 抽屉内不渲染内容） */
  shot: { type: Object, default: null },
  /** 父视图的 `detailLoading` */
  loading: { type: Boolean, default: false },
  /** 父的 `promptPreview`（本批不搬家，理由见 change 方案 §五①） */
  preview: { type: Function, required: true },
})

const emit = defineEmits(['update:open', 'copy', 'copy-token'])

const { t } = useI18n()

const expanded = ref(false)

function setOpen (v) { emit('update:open', v) }
function onCopy (kind) { emit('copy', kind) }
function onCopyToken (token) { emit('copy-token', token) }
</script>

<template>
  <el-drawer :model-value="props.open" :title="t('filmEngineering.library.shotDetail')" size="min(720px, 92vw)" @update:model-value="setOpen">
    <div v-if="props.shot" v-loading="props.loading" class="fe-detail">
      <div class="fe-detail-head">
        <el-tag size="small" type="info">{{ props.shot.model }}</el-tag>
        <el-tag v-if="props.shot.width && props.shot.height" size="small" effect="plain">{{ props.shot.width }}×{{ props.shot.height }}</el-tag>
        <span class="fe-shot-id">{{ props.shot.shotId }}</span>
      </div>
      <div class="fe-detail-copies">
        <el-button size="small" data-testid="fe-detail-copy" @click="onCopy('full')">{{ t('filmEngineering.library.copyFull') }}</el-button>
        <el-button size="small" @click="onCopy('blocks')">{{ t('filmEngineering.library.copyBlocks') }}</el-button>
        <el-button size="small" @click="onCopy('characters')">{{ t('filmEngineering.library.copyCharacters') }}</el-button>
        <el-button size="small" @click="onCopy('geo')">{{ t('filmEngineering.library.copyGeo') }}</el-button>
      </div>
      <div class="fe-detail-section">
        <div class="fe-pane-title">{{ t('filmEngineering.library.refTokens') }}</div>
        <div v-if="props.shot.resolvedRefs && props.shot.resolvedRefs.length" class="fe-refs">
          <div v-for="ref in props.shot.resolvedRefs" :key="ref.token" class="fe-ref">
            <img v-if="ref.entry.imageUrls && ref.entry.imageUrls.length" :src="ref.entry.imageUrls[0]" class="fe-ref-img" loading="lazy" referrerpolicy="no-referrer" alt="" />
            <div class="fe-ref-meta">
              <div class="fe-ref-name">
                <el-tag size="small" :type="ref.entry.kind === 'unknown' ? 'danger' : 'info'">{{ ref.entry.name || t('filmEngineering.library.refUnknown') }}</el-tag>
                <el-tag v-if="ref.entry.kind !== 'unknown'" size="small" effect="plain">{{ ref.entry.kind }}</el-tag>
              </div>
              <div class="fe-ref-token">
                <code>{{ ref.token }}</code>
                <el-button size="small" text type="primary" data-testid="fe-detail-copy-token" @click="onCopyToken(ref.token)">{{ t('filmEngineering.library.copyToken') }}</el-button>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="fe-empty">{{ t('filmEngineering.library.refUnknown') }}</div>
      </div>
      <div class="fe-detail-section">
        <div class="fe-pane-title">{{ t('filmEngineering.library.copyModeFull') }}</div>
        <div class="fe-prompt-box">
          <pre class="fe-prompt-text">{{ expanded ? props.shot.prompt : props.preview(props.shot.prompt, 4000) }}</pre>
          <el-button size="small" text type="primary" @click="expanded = !expanded">
            {{ expanded ? t('filmEngineering.library.collapsePrompt') : t('filmEngineering.library.expandPrompt') }}
          </el-button>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
/* 从父视图逐字搬来的详情区样式（scoped 不跨组件生效 ⇒ 这里自带一份）。 */
.fe-detail-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.fe-detail-copies { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.fe-detail-section { margin-bottom: 18px; }
.fe-refs { display: flex; flex-direction: column; gap: 8px; }
.fe-ref { display: flex; gap: 10px; align-items: flex-start; }
.fe-ref-img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; background: #f2f3f5; }
.fe-ref-meta { min-width: 0; }
.fe-ref-name { display: flex; gap: 6px; margin-bottom: 4px; }
.fe-ref-token { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-xs); color: #909399; }
.fe-ref-token code { word-break: break-all; }
.fe-prompt-box { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px; }
.fe-prompt-text { margin: 0 0 8px; font-size: var(--font-size-xs); line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 46vh; overflow: auto; }
.fe-shot-id { color: #c0c4cc; font-size: var(--font-size-xs); }
.fe-pane-title { font-weight: 600; margin-bottom: 8px; font-size: var(--font-size-sm); }
.fe-empty { color: #909399; padding: 24px 0; text-align: center; }
</style>
