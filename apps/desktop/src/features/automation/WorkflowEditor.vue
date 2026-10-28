<template>
  <div class="wf-editor">
    <!-- 1. 来源 -->
    <section class="wf-section">
      <div class="wf-title">{{ t('automation.wfSourceTitle') }}</div>
      <div class="wf-row">
        <label class="wf-label" :for="fid('sourceType')">{{ t('automation.wfSourceType') }}</label>
        <select :id="fid('sourceType')" v-model="model.source.type" class="wf-input" data-testid="wf-source-type">
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
          <label class="wf-label" :for="fid('categoriesLimit')">{{ t('automation.wfLimit') }}</label>
          <input :id="fid('categoriesLimit')" v-model.number="model.source.limit" type="number" min="1" :max="meta.limits.maxHotTopicsLimit" class="wf-input wf-input--sm" />
          <select v-model="model.source.sort" class="wf-input">
            <option value="latest">{{ t('automation.wfSortLatest') }}</option>
            <option value="score">{{ t('automation.wfSortScore') }}</option>
          </select>
          <span class="wf-hint">{{ t('automation.wfLimitHint', { max: meta.limits.maxHotTopicsLimit }) }}</span>
        </div>
      </template>

      <template v-else-if="model.source.type === 'creatorMonitor'">
        <div class="wf-row wf-row--block">
          <label class="wf-label" :for="fid('followIds')">{{ t('automation.wfFollowIds') }}</label>
          <input :id="fid('followIds')" :value="followIdsText" class="wf-input wf-input--full" :placeholder="t('automation.wfFollowIdsPlaceholder')" @input="onFollowIdsInput" />
          <div class="wf-hint">{{ t('automation.wfFollowIdsHint') }}</div>
        </div>
        <div class="wf-row">
          <label class="wf-label" :for="fid('perCreator')">{{ t('automation.wfPerCreator') }}</label>
          <input :id="fid('perCreator')" v-model.number="model.source.perCreatorLimit" type="number" min="1" max="20" class="wf-input wf-input--sm" />
          <span class="wf-hint">{{ t('automation.wfPerCreatorHint') }}</span>
        </div>
      </template>

      <template v-else-if="model.source.type === 'zhihuFavlist'">
        <div class="wf-row wf-row--block">
          <label class="wf-label" :for="fid('folders')">{{ t('automation.wfFolders') }}</label>
          <input :id="fid('folders')" :value="folderTokensText" class="wf-input wf-input--full" :placeholder="t('automation.wfFoldersPlaceholder')" @input="onFolderTokensInput" />
          <div class="wf-hint">{{ t('automation.wfFoldersHint') }}</div>
        </div>
        <div class="wf-row">
          <label class="wf-label" :for="fid('foldersLimit')">{{ t('automation.wfLimit') }}</label>
          <input :id="fid('foldersLimit')" v-model.number="model.source.limit" type="number" min="1" :max="meta.limits.maxFolderLimit" class="wf-input wf-input--sm" />
          <span class="wf-hint">{{ t('automation.wfFolderLimitHint', { max: meta.limits.maxFolderLimit }) }}</span>
        </div>
      </template>

      <template v-else-if="model.source.type === 'douyinViral'">
        <div class="wf-row">
          <label class="wf-label">{{ t('automation.wfViralIndustry') }}</label>
          <select v-model="model.source.industry" class="wf-input" data-testid="wf-viral-industry">
            <option value="">{{ t('automation.wfViralIndustryPlaceholder') }}</option>
            <option v-for="industry in meta.viralIndustries" :key="industry" :value="industry">{{ industry }}</option>
          </select>
          <span class="wf-hint">{{ t('automation.wfViralIndustryHint') }}</span>
        </div>
        <div class="wf-row">
          <label class="wf-label">{{ t('automation.wfLimit') }}</label>
          <input v-model.number="model.source.limit" type="number" min="1" max="50" class="wf-input wf-input--sm" />
          <label class="wf-label">{{ t('automation.wfViralMinLikes') }}</label>
          <input v-model.number="model.source.minLikes" type="number" min="0" max="10000000" class="wf-input wf-input--sm" data-testid="wf-viral-min-likes" />
          <span class="wf-hint">{{ t('automation.wfViralLimitHint') }}</span>
        </div>
        <div class="wf-hint">{{ t('automation.wfViralSourceHint') }}</div>
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
        <label class="wf-label" :for="fid('pipeline')">{{ t('automation.wfPipeline') }}</label>
        <select :id="fid('pipeline')" v-model="model.content.videoPipeline" class="wf-input" data-testid="wf-pipeline">
          <option value="">{{ t('automation.wfPipelinePlaceholder') }}</option>
          <option v-for="p in meta.videoPipelines" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <span class="wf-hint">{{ t('automation.wfPipelineHint') }}</span>
      </div>
      <div v-if="model.content.type === 'podcast'" class="wf-row">
        <label class="wf-label" :for="fid('channel')">{{ t('automation.wfChannel') }}</label>
        <input :id="fid('channel')" v-model="model.content.podcastChannelId" class="wf-input" :placeholder="t('automation.wfChannelPlaceholder')" />
        <span class="wf-hint">{{ t('automation.wfChannelHint') }}</span>
      </div>
      <div v-if="model.content.type !== 'podcast'" class="wf-adaptation">
        <label class="wf-check">
          <input v-model="adaptationEnabled" type="checkbox" data-testid="wf-adaptation-enabled" />
          {{ t('automation.wfAdaptationEnabled') }}
        </label>
        <div v-if="adaptationEnabled" class="wf-adaptation-body">
          <div v-if="!adaptationPlatforms.length" class="wf-hint wf-hint--warn" data-testid="wf-adaptation-no-targets">
            {{ t('automation.wfAdaptationNoTargets') }}
          </div>
          <div v-for="platform in adaptationPlatforms" :key="'adapt-' + platform" class="wf-adapt-row" :data-testid="'wf-adapt-' + platform">
            <span class="wf-adapt-name">{{ platformLabel(platform) }}</span>
            <input
              v-model.number="profileFor(platform).titleMaxLength"
              type="number" min="0" :max="meta.adaptationLimits.titleMaxLength"
              class="wf-input wf-input--sm" :title="t('automation.wfAdaptationTitleMax')"
            />
            <input
              v-model.number="profileFor(platform).bodyMaxLength"
              type="number" min="0" :max="meta.adaptationLimits.bodyMaxLength"
              class="wf-input wf-input--sm" :title="t('automation.wfAdaptationBodyMax')"
            />
            <input
              v-model="profileFor(platform).titleSuffix"
              class="wf-input" :maxlength="meta.adaptationLimits.suffixMax"
              :placeholder="t('automation.wfAdaptationSuffix')"
            />
            <input
              :value="tagsTextFor(platform)"
              class="wf-input" :placeholder="t('automation.wfAdaptationTags')"
              @input="onAdaptationTags(platform, $event)"
            />
          </div>
          <div class="wf-hint">{{ t('automation.wfAdaptationHint', { title: meta.adaptationLimits.titleMaxLength, body: meta.adaptationLimits.bodyMaxLength }) }}</div>
        </div>
      </div>
    </section>

    <!-- 4. 发布 -->
    <section class="wf-section" v-if="model.content.type !== 'podcast'">
      <div class="wf-title">{{ t('automation.wfPublishTitle') }}</div>
      <div class="wf-row wf-row--block">
        <WorkflowAccountPicker :accounts="accounts" :meta="meta" v-model="model.publish.targets" />
      </div>
      <div class="wf-row">
        <label class="wf-label" :for="fid('publishMode')">{{ t('automation.wfPublishMode') }}</label>
        <select :id="fid('publishMode')" v-model="model.publish.mode" class="wf-input">
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
      <div class="wf-row wf-row--block">
        <label class="wf-check">
          <input v-model="scheduleRulesEnabled" type="checkbox" data-testid="wf-schedule-rules-enabled" />
          {{ t('automation.wfScheduleRules') }}
        </label>
        <WorkflowScheduleRules v-if="scheduleRulesEnabled" v-model="model.scheduleRules" />
      </div>
      <div class="wf-row">
        <label class="wf-label">{{ t('automation.wfGuard') }}</label>
        <input v-model.number="model.guardrails.maxItemsPerRun" type="number" min="1" :max="meta.limits.maxItemsPerRun" class="wf-input wf-input--sm" />
        <span class="wf-hint">{{ t('automation.wfGuardPerRun') }}</span>
        <input v-model.number="model.guardrails.dailyItemLimit" type="number" min="1" :max="meta.limits.maxDailyItems" class="wf-input wf-input--sm" />
        <span class="wf-hint">{{ t('automation.wfGuardDaily') }}</span>
      </div>
      <div class="wf-row">
        <label class="wf-check">
          <input v-model="budgetEnabled" type="checkbox" data-testid="wf-budget-enabled" />
          {{ t('automation.wfBudgetEnabled') }}
        </label>
        <template v-if="budgetEnabled">
          <select v-model="budget.currency" class="wf-input wf-input--sm" data-testid="wf-budget-currency">
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
          </select>
          <input v-model.number="budget.maxCost" type="number" min="0.01" step="0.01" class="wf-input wf-input--sm" data-testid="wf-budget-max" :placeholder="t('automation.wfBudgetMax')" />
          <input v-model.number="budget.estimatedCostPerItem" type="number" min="0.01" step="0.01" class="wf-input wf-input--sm" data-testid="wf-budget-per-item" :placeholder="t('automation.wfBudgetPerItem')" />
          <span class="wf-hint">{{ t('automation.wfBudgetHint') }}</span>
        </template>
      </div>
      <div class="wf-row">
        <label class="wf-check">
          <input v-model="performanceEnabled" type="checkbox" data-testid="wf-performance-enabled" />
          {{ t('automation.wfPerformanceEnabled') }}
        </label>
        <template v-if="performanceEnabled">
          <input v-model.number="performance.windowDays" type="number" min="1" max="90" class="wf-input wf-input--sm" :placeholder="t('automation.wfPerformanceWindow')" />
          <input v-model.number="performance.minSamples" type="number" min="1" max="100" class="wf-input wf-input--sm" :placeholder="t('automation.wfPerformanceSamples')" />
          <input v-model.number="performance.minViews" type="number" min="0" class="wf-input wf-input--sm" :placeholder="t('automation.wfPerformanceViews')" />
          <input v-model.number="performance.minEngagementRate" type="number" min="0" max="1" step="0.01" class="wf-input wf-input--sm" :placeholder="t('automation.wfPerformanceRate')" />
          <span class="wf-hint">{{ t('automation.wfPerformanceHint') }}</span>
        </template>
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
import { computed, onMounted, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import WorkflowScheduleRules from './WorkflowScheduleRules.vue'
import WorkflowAccountPicker from './WorkflowAccountPicker.vue'

const props = defineProps({
  meta: { type: Object, required: true },
  strategies: { type: Array, default: () => [] },
  accounts: { type: Array, default: () => [] },
})
const model = defineModel({ type: Object, required: true })
const { t } = useI18n()
// 实例级 id：本页可同文档出现两份（自动化列表与模板预览），写死 id 必撞车
const uid = useId()
const fid = (key) => `${uid}-${key}`

function categoryLabel (id) { return t('automation.wfCategory.' + id) }

const followIdsText = computed(() => (model.value.source.followIds || []).join(', '))
function onFollowIdsInput (e) {
  model.value.source.followIds = String(e.target.value || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
}
const folderTokensText = computed(() => (model.value.source.folderTokens || []).join(', '))
function onFolderTokensInput (e) {
  model.value.source.folderTokens = String(e.target.value || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
}

function ensureAdaptation () {
  if (!model.value.content.adaptation || typeof model.value.content.adaptation !== 'object') {
    model.value.content.adaptation = { enabled: false, byPlatform: {}, byAccount: {} }
  }
  const a = model.value.content.adaptation
  if (!a.byPlatform || typeof a.byPlatform !== 'object') a.byPlatform = {}
  if (!a.byAccount || typeof a.byAccount !== 'object') a.byAccount = {}
  return a
}

const adaptationEnabled = computed({
  get: () => Boolean(ensureAdaptation().enabled),
  set: (v) => { ensureAdaptation().enabled = Boolean(v) },
})
const adaptationPlatforms = computed(() => {
  const set = new Set((model.value.publish.targets || []).map((t) => t.platform).filter(Boolean))
  return Array.from(set)
})

function profileFor (platform) {
  const a = ensureAdaptation()
  if (!a.byPlatform[platform]) {
    a.byPlatform[platform] = { titleMaxLength: 0, bodyMaxLength: 0, titleSuffix: '', tags: [] }
  }
  return a.byPlatform[platform]
}

function tagsTextFor (platform) {
  return (profileFor(platform).tags || []).join(', ')
}

function onAdaptationTags (platform, event) {
  profileFor(platform).tags = String(event.target.value || '')
    .split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
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

function ensureScheduleRules () {
  if (!model.value.scheduleRules || typeof model.value.scheduleRules !== 'object') {
    model.value.scheduleRules = {
      enabled: false,
      timezone: 'Asia/Shanghai',
      weekdays: [1, 2, 3, 4, 5],
      quietHours: { start: '23:00', end: '07:00' },
    }
  }
  const r = model.value.scheduleRules
  if (!Array.isArray(r.weekdays)) r.weekdays = [1, 2, 3, 4, 5]
  if (!r.quietHours || typeof r.quietHours !== 'object') r.quietHours = { start: '23:00', end: '07:00' }
  return r
}
const scheduleRulesEnabled = computed({
  get: () => Boolean(ensureScheduleRules().enabled),
  set: (v) => { ensureScheduleRules().enabled = Boolean(v) },
})

function ensureBudget () {
  if (!model.value.guardrails.budget || typeof model.value.guardrails.budget !== 'object') {
    model.value.guardrails.budget = { enabled: false, maxCost: 0, currency: 'CNY', estimatedCostPerItem: 0 }
  }
  return model.value.guardrails.budget
}
const budget = computed(() => model.value.guardrails.budget)
const budgetEnabled = computed({
  get: () => Boolean(model.value.guardrails.budget && model.value.guardrails.budget.enabled),
  set: (v) => { ensureBudget().enabled = Boolean(v) },
})
onMounted(ensureBudget)

function ensurePerformance () {
  if (!model.value.guardrails.performance || typeof model.value.guardrails.performance !== 'object') {
    model.value.guardrails.performance = { enabled: false, windowDays: 7, minSamples: 3, minViews: 0, minEngagementRate: 0 }
  }
  return model.value.guardrails.performance
}
const performance = computed(() => ensurePerformance())
const performanceEnabled = computed({
  get: () => Boolean(model.value.guardrails.performance && model.value.guardrails.performance.enabled),
  set: (v) => { ensurePerformance().enabled = Boolean(v) },
})
onMounted(ensurePerformance)

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
.wf-adaptation { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--color-border, #d9d9e0); }
.wf-schedule-rules { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 10px; border: 1px solid var(--color-border, #d9d9e0); border-radius: 8px; }.wf-adaptation-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.wf-adapt-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wf-adapt-name { min-width: 64px; color: var(--color-text-secondary, #85858f); font-size: var(--font-size-xs, 12px); }
.wf-account-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wf-recent { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wf-recent-chip { border: 1px solid var(--color-border, #d9d9e0); background: transparent; cursor: pointer; }
.wf-account-group__title { margin-bottom: 6px; color: var(--color-text-secondary, #85858f); font-size: var(--font-size-xs, 12px); }
.wf-account-status { padding: 0 4px; border-radius: 3px; background: #fdecec; color: #c0392b; font-size: var(--font-size-xs, 12px); }
.wf-chip--on { border-color: #2f6fd0; background: #eef4ff; color: #2f6fd0; }
.wf-chip--off { opacity: .55; cursor: not-allowed; }
.wf-chip input { display: none; }
.wf-radio, .wf-check { display: inline-flex; align-items: center; gap: 6px; margin-right: 14px; font-size: var(--font-size-sm, 13px); cursor: pointer; }
</style>
