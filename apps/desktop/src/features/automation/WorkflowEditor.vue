<template>
  <div class="wf-editor">
    <!-- 1. 来源 -->
    <section class="wf-section">
      <div class="wf-title">{{ t('automation.wfSourceTitle') }}</div>
      <div class="wf-row">
        <label class="wf-label">{{ t('automation.wfSourceType') }}</label>
        <select v-model="model.source.type" class="wf-input" data-testid="wf-source-type">
          <option v-for="s in meta.sources" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>

      <template v-if="model.source.type === 'hotTopics'">
        <div class="wf-row wf-row--block">
          <label class="wf-label">{{ t('automation.wfCategories') }}</label>
          <div class="wf-chips">
            <label v-for="c in meta.categories" :key="c" class="wf-chip" :class="{ 'wf-chip--on': model.source.categories.includes(c) }">
              <input type="checkbox" :checked="model.source.categories.includes(c)" @change="toggleCategory(c)" />
              {{ categoryLabel(c) }}
            </label>
          </div>
          <div class="wf-hint">{{ t('automation.wfCategoriesHint') }}</div>
        </div>
        <div class="wf-row">
          <label class="wf-label">{{ t('automation.wfLimit') }}</label>
          <input v-model.number="model.source.limit" type="number" min="1" :max="meta.limits.maxHotTopicsLimit" class="wf-input wf-input--sm" />
          <select v-model="model.source.sort" class="wf-input">
            <option value="latest">{{ t('automation.wfSortLatest') }}</option>
            <option value="score">{{ t('automation.wfSortScore') }}</option>
          </select>
          <span class="wf-hint">{{ t('automation.wfLimitHint', { max: meta.limits.maxHotTopicsLimit }) }}</span>
        </div>
      </template>

      <template v-else-if="model.source.type === 'creatorMonitor'">
        <div class="wf-row wf-row--block">
          <label class="wf-label">{{ t('automation.wfFollowIds') }}</label>
          <input :value="followIdsText" class="wf-input wf-input--full" :placeholder="t('automation.wfFollowIdsPlaceholder')" @input="onFollowIdsInput" />
          <div class="wf-hint">{{ t('automation.wfFollowIdsHint') }}</div>
        </div>
        <div class="wf-row">
          <label class="wf-label">{{ t('automation.wfPerCreator') }}</label>
          <input v-model.number="model.source.perCreatorLimit" type="number" min="1" max="20" class="wf-input wf-input--sm" />
          <span class="wf-hint">{{ t('automation.wfPerCreatorHint') }}</span>
        </div>
      </template>

      <template v-else-if="model.source.type === 'zhihuFavlist'">
        <div class="wf-row wf-row--block">
          <label class="wf-label">{{ t('automation.wfFolders') }}</label>
          <input :value="folderTokensText" class="wf-input wf-input--full" :placeholder="t('automation.wfFoldersPlaceholder')" @input="onFolderTokensInput" />
          <div class="wf-hint">{{ t('automation.wfFoldersHint') }}</div>
        </div>
        <div class="wf-row">
          <label class="wf-label">{{ t('automation.wfLimit') }}</label>
          <input v-model.number="model.source.limit" type="number" min="1" :max="meta.limits.maxFolderLimit" class="wf-input wf-input--sm" />
          <span class="wf-hint">{{ t('automation.wfFolderLimitHint', { max: meta.limits.maxFolderLimit }) }}</span>
        </div>
      </template>
    </section>

    <!-- 2. 改写 -->
    <section class="wf-section">
      <div class="wf-title">{{ t('automation.wfRewriteTitle') }}</div>
      <div class="wf-row wf-row--block">
        <label class="wf-radio"><input v-model="model.rewrite.mode" type="radio" value="default" /> {{ t('automation.wfRewriteDefault') }}</label>
        <label class="wf-radio"><input v-model="model.rewrite.mode" type="radio" value="strategy" /> {{ t('automation.wfRewriteStrategy') }}</label>
        <div v-if="model.rewrite.mode === 'strategy'" class="wf-row">
          <select v-model="model.rewrite.strategyId" class="wf-input wf-input--full" data-testid="wf-strategy">
            <option value="">{{ t('automation.wfStrategyPlaceholder') }}</option>
            <option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name || s.id }}</option>
          </select>
        </div>
        <div class="wf-hint">{{ t('automation.wfRewriteHint') }}</div>
      </div>
    </section>

    <!-- 3. 内容 -->
    <section class="wf-section">
      <div class="wf-title">{{ t('automation.wfContentTitle') }}</div>
      <div class="wf-row wf-row--block">
        <label v-for="c in meta.contentTypes" :key="c.id" class="wf-radio">
          <input v-model="model.content.type" type="radio" :value="c.id" /> {{ c.label }}
        </label>
      </div>
      <div v-if="model.content.type === 'video'" class="wf-row">
        <label class="wf-label">{{ t('automation.wfPipeline') }}</label>
        <select v-model="model.content.videoPipeline" class="wf-input" data-testid="wf-pipeline">
          <option value="">{{ t('automation.wfPipelinePlaceholder') }}</option>
          <option v-for="p in meta.videoPipelines" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <span class="wf-hint">{{ t('automation.wfPipelineHint') }}</span>
      </div>
      <div v-if="model.content.type === 'podcast'" class="wf-row">
        <label class="wf-label">{{ t('automation.wfChannel') }}</label>
        <input v-model="model.content.podcastChannelId" class="wf-input" :placeholder="t('automation.wfChannelPlaceholder')" />
        <span class="wf-hint">{{ t('automation.wfChannelHint') }}</span>
      </div>
    </section>

    <!-- 4. 发布 -->
    <section class="wf-section" v-if="model.content.type !== 'podcast'">
      <div class="wf-title">{{ t('automation.wfPublishTitle') }}</div>
      <div class="wf-row wf-row--block">
        <div v-if="!accounts.length" class="wf-hint wf-hint--warn" data-testid="wf-accounts-empty">
          {{ t('automation.wfAccountsEmpty') }}
        </div>
        <div v-else class="wf-account-groups">
          <div v-for="group in accountGroups" :key="group.platform" class="wf-account-group">
            <div class="wf-account-group__title">{{ group.label }}</div>
            <div class="wf-chips">
              <label
                v-for="acc in group.accounts"
                :key="acc.id"
                class="wf-chip"
                :class="{ 'wf-chip--on': hasAccount(acc) }"
                :data-testid="'wf-account-' + acc.id"
              >
                <input type="checkbox" :checked="hasAccount(acc)" @change="toggleAccount(acc)" />
                {{ accountLabel(acc) }}
                <span v-if="accountStatus(acc)" class="wf-account-status">{{ accountStatus(acc) }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="wf-hint">{{ t('automation.wfAccountsHint') }}</div>
        <div class="wf-hint" data-testid="wf-accounts-selected">
          {{ t('automation.wfAccountsSelected', { count: selectedTargets.length }) }}
        </div>
      </div>
      <div class="wf-row">
        <label class="wf-label">{{ t('automation.wfPublishMode') }}</label>
        <select v-model="model.publish.mode" class="wf-input">
          <option value="immediate">{{ t('automation.wfModeImmediate') }}</option>
          <option value="scheduled">{{ t('automation.wfModeScheduled') }}</option>
        </select>
        <input v-if="model.publish.mode === 'scheduled'" v-model="startAtLocal" type="datetime-local" class="wf-input" />
      </div>
      <div class="wf-hint wf-hint--warn">{{ t('automation.wfScheduleWarn') }}</div>
    </section>

    <!-- 5. 节奏与护栏 -->
    <section class="wf-section">
      <div class="wf-title">{{ t('automation.wfCadenceTitle') }}</div>
      <div class="wf-row">
        <label class="wf-label">{{ t('automation.wfCadence') }}</label>
        <input v-model.number="model.cadence.minMinutes" type="number" min="5" max="1440" class="wf-input wf-input--sm" />
        <span>—</span>
        <input v-model.number="model.cadence.maxMinutes" type="number" min="5" max="1440" class="wf-input wf-input--sm" />
        <span class="wf-hint">{{ t('automation.wfCadenceHint') }}</span>
      </div>
      <div class="wf-row">
        <label class="wf-label">{{ t('automation.wfGuard') }}</label>
        <input v-model.number="model.guardrails.maxItemsPerRun" type="number" min="1" :max="meta.limits.maxItemsPerRun" class="wf-input wf-input--sm" />
        <span class="wf-hint">{{ t('automation.wfGuardPerRun') }}</span>
        <input v-model.number="model.guardrails.dailyItemLimit" type="number" min="1" :max="meta.limits.maxDailyItems" class="wf-input wf-input--sm" />
        <span class="wf-hint">{{ t('automation.wfGuardDaily') }}</span>
      </div>
      <div class="wf-row">
        <label class="wf-check"><input v-model="model.review.requireApproval" type="checkbox" /> {{ t('automation.wfReview') }}</label>
        <label class="wf-check"><input v-model="model.dedupe.enabled" type="checkbox" /> {{ t('automation.wfDedupe') }}</label>
      </div>
      <div class="wf-hint">{{ t('automation.wfReviewHint') }}</div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  meta: { type: Object, required: true },
  strategies: { type: Array, default: () => [] },
  accounts: { type: Array, default: () => [] },
})
const model = defineModel({ type: Object, required: true })
const { t } = useI18n()

function categoryLabel (id) { return t('automation.wfCategory.' + id) }

const followIdsText = computed(() => (model.value.source.followIds || []).join(', '))
function onFollowIdsInput (e) {
  model.value.source.followIds = String(e.target.value || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
}
const folderTokensText = computed(() => (model.value.source.folderTokens || []).join(', '))
function onFolderTokensInput (e) {
  model.value.source.folderTokens = String(e.target.value || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
}

function toggleCategory (id) {
  const list = model.value.source.categories
  const idx = list.indexOf(id)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(id)
}
function platformLabel (id) {
  const found = (props.meta.platforms || []).find((p) => p.id === id)
  return found ? found.label : id
}

const accountGroups = computed(() => {
  const groups = new Map()
  for (const acc of props.accounts || []) {
    if (!acc || !acc.id || !acc.platform) continue
    if (!groups.has(acc.platform)) {
      groups.set(acc.platform, { platform: acc.platform, label: platformLabel(acc.platform), accounts: [] })
    }
    groups.get(acc.platform).accounts.push(acc)
  }
  return Array.from(groups.values())
})

function hasAccount (acc) {
  return model.value.publish.targets.some(
    (t) => t.platform === acc.platform && String(t.accountId) === String(acc.id),
  )
}

function toggleAccount (acc) {
  const list = model.value.publish.targets
  const idx = list.findIndex((t) => t.platform === acc.platform && String(t.accountId) === String(acc.id))
  if (idx >= 0) list.splice(idx, 1)
  else list.push({ platform: acc.platform, accountId: String(acc.id) })
}

function accountLabel (acc) {
  return acc.name || acc.nickname || acc.remark || String(acc.id)
}

function accountStatus (acc) {
  const status = String(acc.status || '')
  if (!status || status === 'active' || status === 'online') return ''
  if (status === 'expired') return t('automation.wfAccountExpired')
  if (status === 'inactive') return t('automation.wfAccountInactive')
  return status
}

const selectedTargets = computed(() => model.value.publish.targets.filter((t) => t.accountId))

function toLocalInput (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
const startAtLocal = computed({
  get: () => toLocalInput(model.value.publish.startAt),
  set: (v) => {
    const d = new Date(v)
    model.value.publish.startAt = Number.isFinite(d.getTime()) ? d.toISOString() : ''
  },
})
</script>

<style scoped>
.wf-editor { display: flex; flex-direction: column; gap: 18px; }
.wf-section { padding-bottom: 12px; border-bottom: 1px solid var(--color-border-light, #eff0f4); }
.wf-section:last-child { border-bottom: none; }
.wf-title { margin-bottom: 10px; font-weight: 600; font-size: var(--font-size-sm, 13px); }
.wf-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.wf-row--block { display: block; }
.wf-label { min-width: 84px; font-size: var(--font-size-sm, 13px); color: var(--color-text-secondary, #85858f); }
.wf-input { height: 30px; padding: 0 8px; border: 1px solid var(--color-border, #dcdfe6); border-radius: 6px; font-size: var(--font-size-sm, 13px); background: #fff; }
.wf-input--sm { width: 80px; }
.wf-input--full { width: 100%; }
.wf-hint { color: var(--color-text-secondary, #85858f); font-size: var(--font-size-xs, 12px); line-height: 1.5; }
.wf-hint--warn { color: #b26a00; }
.wf-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
.wf-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border: 1px solid var(--color-border, #dcdfe6); border-radius: 999px; font-size: var(--font-size-xs, 12px); cursor: pointer; }
.wf-account-groups { display: flex; flex-direction: column; gap: 10px; }
.wf-account-group__title { margin-bottom: 6px; color: var(--color-text-secondary, #85858f); font-size: var(--font-size-xs, 12px); }
.wf-account-status { padding: 0 4px; border-radius: 3px; background: #fdecec; color: #c0392b; font-size: var(--font-size-xs, 12px); }
.wf-chip--on { border-color: #2f6fd0; background: #eef4ff; color: #2f6fd0; }
.wf-chip input { display: none; }
.wf-radio, .wf-check { display: inline-flex; align-items: center; gap: 6px; margin-right: 14px; font-size: var(--font-size-sm, 13px); cursor: pointer; }
</style>
