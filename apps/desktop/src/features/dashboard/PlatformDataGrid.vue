<template>
  <!-- 没有任何平台有数据：合法空态，不是故障（用户还没发过 / 没有可统计的作品）。
       ⚠️ 本组件渲染的是**片段**（多根节点）：这样 `.cohere-card-grid` 才是
       `.cohere-content` 的直接子元素 —— E2E 的选择器
       `.cohere-content > .cohere-card-grid .cohere-card` 依赖这个层级关系
       （apps/desktop/tests/e2e/helpers/route-functional-suite.js）。 -->
  <EmptyState v-if="rows.length === 0"
              :title="$t('dashboard.platformsEmptyTitle')"
              :description="$t('dashboard.platformsEmptyDesc')">
    <template #icon><el-icon><DataLine /></el-icon></template>
    <template #actions>
      <button class="cohere-btn-secondary" data-testid="platforms-refresh-btn" @click="$emit('refresh')">
        {{ $t('dashboard.platformsRefresh') }}
      </button>
    </template>
  </EmptyState>

  <div v-else class="cohere-card-grid dash-grid-280">
    <article v-for="row in rows" :key="row.platform" class="cohere-card dash-platform-card" :data-testid="'platform-card-' + row.platform">
      <div class="card-top">
        <div class="card-icon">
          <img v-if="isPlatformIconUrl(iconUrl(row.platform))" :src="iconUrl(row.platform)" class="mp-platform-icon" :alt="row.name" width="24" height="24">
          <span v-else>{{ iconUrl(row.platform) }}</span>
        </div>
        <div class="card-info">
          <div class="card-platform">{{ row.name }}</div>
          <div class="dash-platform-meta" data-testid="platform-meta">
            {{ row.meta }}
          </div>
        </div>
      </div>

      <!-- 指标区：四个槽位固定对齐（标签在上 / 数值在下）。
           任一指标取不到真值时显示「—」，**不显示 0**：
           「没有数据」与「真的是 0」是两件事，混同会让用户误判账号状态。
           口径：阅读/点赞/评论 = 作品级（发布后回采）；粉丝 = 账号级（平台粉丝数）。 -->
      <dl class="dash-platform-metrics">
        <div v-for="metric in row.metrics" :key="metric.key" class="dash-platform-metric">
          <dt class="dash-platform-metric-label">{{ metric.label }}</dt>
          <dd class="dash-platform-metric-value" :data-testid="'platform-' + row.platform + '-' + metric.key">
            {{ metric.value }}
          </dd>
        </div>
      </dl>
    </article>
  </div>
</template>

<script setup>
/**
 * PlatformDataGrid —— 「各平台数据」区块（2026-10-25 数据真实性修复）
 *
 * ## 为什么重写这块（不是样式微调，是数据源换了）
 *
 * 旧实现的数据来自 `sync:cached`（packages/shared-utils/src/data-sync.js）。
 * 那条链路在主进程里**永远拿不到真值**：
 *   · `DataSyncService._rpaFetchStats()` 走的是 `window.electronAPI` / `ipcRenderer`
 *     —— 两者都只存在于**渲染进程**，而 DataSyncService 跑在**主进程**
 *     （core/container.setup.js: `new DataSyncService(store)`）
 *     ⇒ 两条分支都落空 ⇒ 落到兜底 `{articles:0, views:0, comments:0, likes:0, followers:0}`
 *   · 兜底值被 `_makeSyncResult()` 打上 `syncedAt: now` 并写进缓存
 *     ⇒ 界面显示「0阅读 / 更新于 10:51」——**看起来是刚采到的真数据，实际是常量 0**
 *   · 且 `rpa:fetchData` 这个 IPC 通道**全仓不存在**（没有任何 handler 注册）
 *
 * ⇒ 旧界面上的 5 张「0/0/0/0」平台卡不是「数据没同步」，是**造出来的数字**。
 *
 * ## 现在的口径（每格数字都有出处）
 *
 * | 槽位 | 数据源 | 口径 |
 * |------|--------|------|
 * | 作品 | `dashboard:stats` → `stats.perPlatform[p].total` | 发布记录里该平台的**累计发布数** |
 * | 阅读 / 点赞 / 评论 | `performance:overview` → `byPlatform[p]` | **作品级**：发布后回采的作品互动合计 |
 * | 粉丝 | 可信 `sync:cached` 记录 | **账号级**：平台粉丝数 |
 *
 * 口径混用是这类看板最容易犯的错：同名指标在不同卡片里含义不同，用户读不出
 * 「这个数是账号的还是作品的」。⇒ 本页固定：**作品级指标一律取回采，账号级指标（粉丝）取 sync**，
 * KPI 行与本区块成对一致。
 *
 * ## 组件边界
 *
 * 本组件只做「渲染 + 口径展示」，**不取数**：数据由 Dashboard.vue 统一取好后经 props 传入。
 * 理由：同一份取数要同时喂 KPI 行与本区块，分头取会拿到不同时刻的数字
 * （与 `metricsReloadToken` 存在的原因同源，见 Dashboard.vue 注释）。
 */
import { computed } from 'vue'
import { DataLine } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import EmptyState from '@/components/EmptyState.vue'
import { getPlatformIconUrl, isPlatformIconUrl } from '@/composables/usePlatformIconUrl'
import { usePlatformStore } from '@/stores/platforms'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps({
  /** toPlatformDataModel() 的输出：{ rows: [...] } */
  model: { type: Object, required: true },
})

defineEmits(['refresh'])

const { t } = useI18n()
const platformStore = usePlatformStore()

const rows = computed(() => {
  const list = props.model && Array.isArray(props.model.rows) ? props.model.rows : []
  return list.map(decorate)
})

function iconUrl (platform) {
  return getPlatformIconUrl(platform) || platformStore.getIcon(platform) || ''
}

/** 平台显示名：优先 store 的本地化名，取不到时回落原始 id（不编造名称）。 */
function platformName (platform) {
  return platformStore.getLabel(platform) || platform
}

/**
 * 指标数值：**null（没有这项数据）渲染成「—」，不回落成 0**。
 *
 * ⚠️ 判定必须用「类型 + 有限性」双条件：`Number('')` 是 0、`Number(null)` 也是 0
 * ⇒ 只判 `Number.isFinite(Number(v))` 会把空串当成真实的 0 显示出来（正是本次要消灭的假 0）。
 */
function formatCount (value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toLocaleString('zh-CN')
}

/** 是否拿到了真值（数字）。null / undefined / 非有限数都算「没拿到」。 */
function hasValue (value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function decorate (row) {
  return {
    ...row,
    name: platformName(row.platform),
    meta: buildMeta(row),
    metrics: [
      { key: 'views', label: t('dashboard.platformMetricViews'), value: formatCount(row.views) },
      { key: 'likes', label: t('dashboard.platformMetricLikes'), value: formatCount(row.likes) },
      { key: 'comments', label: t('dashboard.platformMetricComments'), value: formatCount(row.comments) },
      { key: 'fans', label: t('dashboard.platformMetricFans'), value: formatCount(row.fans) },
    ],
  }
}

/**
 * 卡片副标题：说清「这个平台的数字覆盖到哪、什么时候采的」。
 *
 * ⚠️ 这里**不再**显示旧实现那个 `更新于 {{ syncedAt }}` —— 那个时间戳来自
 * `sync:cached` 的常量 0 记录（每次刷新都刷新一次），显示它等于宣称
 * 「这些 0 是刚刚采到的」。现在只显示真实的回采时间。
 */
function buildMeta (row) {
  const parts = []
  const hasArticles = hasValue(row.articles)
  if (hasArticles) {
    parts.push(t('dashboard.platformMetaArticles', { count: row.articles }))
  } else if (hasValue(row.contents)) {
    parts.push(t('dashboard.platformMetaContents', { count: row.contents }))
  }
  if (row.lastCapturedAt) {
    parts.push(t('dashboard.platformMetaLastCapture', { time: formatDateTime(row.lastCapturedAt, { style: 'hour-minute' }) }))
  } else if (hasArticles) {
    parts.push(t('dashboard.platformMetaNoCapture'))
  }
  if (parts.length === 0) parts.push(t('dashboard.platformMetaNone'))
  return parts.join(' · ')
}
</script>

<style scoped>
/* 本区块此前用的 .card-stats / .stat-item / .stat-num / .stat-lbl **全仓没有任何定义**
 * ⇒ 四个指标是**无样式的裸文本**逐行堆叠（这是「元素样式不统一」最刺眼的一处）。
 * 这里改成与全站一致的「标签在上 / 数值在下」四列指标行，槽位宽度固定、数字等宽对齐。 */
.dash-platform-card {
  cursor: default;
  padding: 16px;
}

/* 平台卡**不可点**：全局 .cohere-card 默认是「可点卡片」（cursor:pointer + hover 变色），
 * 旧实现的平台卡直接复用了它 ⇒ 鼠标移上去会亮、按下却什么也不发生（假 affordance）。
 * 这里把 hover 态也收掉，与 .dash-panel / .dash-extra-panel 一致。 */
.dash-platform-card:hover {
  background: var(--canvas);
  box-shadow: none;
}

.dash-platform-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-top: 2px;
}

.dash-platform-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-sm);
  margin: 0;
}

.dash-platform-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dash-platform-metric-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.dash-platform-metric-value {
  margin: 0;
  font-family: var(--font-family-ui-display);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-strong);
  line-height: 1.2;
}
</style>
