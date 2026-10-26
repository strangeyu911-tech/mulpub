<template>
  <div class="mp-page publish-drafts-page" data-testid="publish-drafts-page" aria-labelledby="publish-drafts-title">
    <div class="mp-page-inner">
      <header class="mp-page-header">
        <div class="mp-page-heading">
          <h1 id="publish-drafts-title" class="mp-page-title" data-testid="publish-drafts-title">{{ t('publishPage.draftsTitle') }}</h1>
          <p class="mp-page-subtitle">{{ t('publishPage.draftsSubtitle') }}</p>
        </div>
        <div class="mp-page-actions">
          <button type="button" class="mp-btn mp-btn--secondary" data-testid="publish-drafts-back" @click="$emit('back')">
            {{ t('publishPage.backToPublish') }}
          </button>
        </div>
      </header>

      <section class="mp-panel" aria-labelledby="publish-drafts-list-title">
        <header class="mp-panel-header">
          <div class="mp-panel-heading">
            <h2 id="publish-drafts-list-title" class="mp-panel-title">{{ t('publishPage.draftsListTitle') }}</h2>
            <p class="mp-panel-hint">{{ t('publishPage.draftsHint') }}</p>
          </div>
          <span v-if="!loading && drafts.length" class="mp-chip mp-chip--brand" data-testid="publish-drafts-count">
            {{ t('publishPage.draftsCount', { count: drafts.length }) }}
          </span>
        </header>

        <div v-if="loading" class="mp-panel-body" data-testid="publish-drafts-loading">
          <UiSkeleton variant="list" :count="3" />
        </div>

        <EmptyState scaffold
          v-else-if="drafts.length === 0"
          data-testid="publish-drafts-empty"
          icon="Document"
          :title="t('publishPage.noDrafts')"
          :description="t('publishPage.draftsHint')"
          :action-text="t('publishPage.backToPublish')"
          @action="$emit('back')"
        />

        <div v-else class="mp-list" data-testid="publish-drafts-list">
          <article
            v-for="draft in drafts"
            :key="draft.id"
            class="mp-row publish-draft-row"
          >
            <div class="mp-row-main">
              <p class="mp-row-title" :title="draft.title || t('publishPage.untitled')">
                {{ draft.title || t('publishPage.untitled') }}
              </p>
              <div class="mp-row-meta">
                <span>{{ formatUpdatedAt(draft) }}</span>
                <template v-if="draft.platforms?.length">
                  <span class="mp-row-divider" aria-hidden="true">·</span>
                  <span class="mp-chip mp-chip--brand">{{ t('publishPage.platformCount', { count: draft.platforms.length }) }}</span>
                </template>
              </div>
            </div>
            <div class="mp-row-actions">
              <UiButton
                :data-testid="`publish-draft-${draft.id}`"
                variant="primary"
                size="sm"
                @click="$emit('open', draft)"
              >{{ t('publishPage.openDraftToPublish') }}</UiButton>
              <UiButton
                :data-testid="`delete-draft-${draft.id}`"
                variant="ghost"
                size="sm"
                class="publish-draft-delete"
                @click="$emit('delete', draft.id)"
              >{{ t('publishPage.delete') }}</UiButton>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
/**
 * PublishDraftsPage.vue — 草稿箱整页视图（ui-consistency-polish 2026-10-26）
 *
 * 为什么从 Publish.vue 抽出：
 * ① 草稿页原先自建 `publish-drafts-*` 骨架，与发布页其他 tab 的页头/间距完全不同；
 * ② Publish.vue 已被 max-lines 门禁点名（targets 1775），草稿页在这里净增行数会直接顶红。
 * 抽成独立组件后，Publish.vue 只保留一个 `<PublishDraftsPage>` 挂载点，行数净减。
 *
 * 契约：只负责展示与转发事件；草稿数据、删除、跳转全部由 Publish.vue 的既有 composable 持有。
 */
import { useI18n } from 'vue-i18n'
import UiButton from '@/components/UiButton.vue'
import UiSkeleton from '@/components/UiSkeleton.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getAppLocale } from '@/i18n'

defineProps({
  drafts: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})
defineEmits(['open', 'delete', 'back'])

const { t } = useI18n()

/** 更新时间：`updatedAt` 优先，其次 `updated_at`；解析失败不得显示 Invalid Date。 */
function formatUpdatedAt (draft) {
  const raw = draft && (draft.updatedAt || draft.updated_at)
  if (!raw) return t('publishPage.updatedUnknown')
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return t('publishPage.updatedUnknown')
  return date.toLocaleString(getAppLocale() === 'en' ? 'en-US' : 'zh-CN')
}
</script>
