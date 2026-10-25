<template>
  <div class="dash-page">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">数据看板</div>
        <div class="page-subtitle">各平台发布数据与趋势分析</div>
      </div>
      <div class="page-actions">
        <button class="cohere-btn-secondary" data-testid="dashboard-refresh-btn" @click="refreshSync" :disabled="syncing">
          {{ syncing ? '同步中...' : '⟳ 刷新数据' }}
        </button>
      </div>
    </div>

    <div class="cohere-content">
      <!-- 免费版横幅已撤下（dash-full-entitlement，用户决策方案 C）。
           原因：横幅文案「当前为免费版，部分功能受限」在本页是**误导** ——
           本页三个数据源（dashboard:stats / history:list / performance:overview）
           的门禁都是「登录」而非「套餐」，未登录时由下方 .dashboard-login-gate
           单独引导，本页没有任何一项内容因套餐受限。
           撤下后，套餐差异改由下方各区块的「锁区块占位」真实体现（PRD §3.2），
           那才是诚实且可验证的差异 —— 不再是"声称受限"而是"确实少看几块"。

           注意：若将来要把横幅加回来，**必须放在 .cohere-content 内部**（PR #3752 的教训）：
           放在外侧时它是全页唯一没有水平 padding（--space-xxl）的元素，背景色左侧
           直接贴容器边、与下方卡片不对齐，且会被 .banner-text 的 flex:1 拉满整页
           宽度 —— 比下方内容区更宽，视觉上不专业。该位置关系由
           Dashboard.style-guard.test.js 的回归锁机械守住。 -->

      <!-- KPI 行（2026-10-25 数据真实性修复）：四个数字各有一处出处，
           取不到真值显示「—」而不是 0（旧实现全取自恒 0 占位记录，
           且「已发布内容」与「发布统计·累计发布」自相矛盾）。
           逐项口径见 PRD-DASHBOARD-TRUTHFUL-UI §3.3.1。 -->
      <div class="stats-grid">
        <!-- 大卡片：总发布 (占据 2 列) -->
        <div class="stat-card large">
          <div class="stat-decor" aria-hidden="true"></div>
          <div class="stat-icon"><el-icon><Promotion /></el-icon></div>
          <div class="stat-value" data-testid="kpi-published">{{ formatMetric(kpi.published) }}</div>
          <div class="stat-label">{{ t('dashboard.publishedContent') }}</div>
        </div>

        <!-- 小卡片：作品阅读（回采口径） -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><View /></el-icon></div>
          <div class="stat-value" data-testid="kpi-reads">{{ formatMetric(kpi.reads) }}</div>
          <div class="stat-label">{{ t('dashboard.kpiReadLabel') }}</div>
        </div>

        <!-- 小卡片：作品评论（回采口径） -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><ChatDotRound /></el-icon></div>
          <div class="stat-value" data-testid="kpi-comments">{{ formatMetric(kpi.comments) }}</div>
          <div class="stat-label">{{ t('dashboard.kpiCommentLabel') }}</div>
        </div>

        <!-- 小卡片：账号粉丝（账号级口径；当前无采集源 ⇒ 「—」） -->
        <div class="stat-card">
          <div class="stat-icon"><el-icon><UserFilled /></el-icon></div>
          <div class="stat-value" data-testid="kpi-fans">{{ formatMetric(kpi.fans) }}</div>
          <div class="stat-label">{{ t('dashboard.kpiFansLabel') }}</div>
        </div>
      </div>

      <!-- 口径说明：告诉用户每个数字从哪来，以及为什么会出现「—」 -->
      <p class="dash-kpi-note" data-testid="kpi-note">{{ t('dashboard.kpiNote') }}</p>

      <!-- 未登录门禁：发布统计/最近发布需登录后可见 -->
      <div v-if="statsLoginRequired" class="dashboard-login-gate" role="status" data-testid="dashboard-login-gate">
        <span class="gate-hint">{{ t('dashboard.loginGateHint') }}</span>
        <button class="gate-sign-in" type="button" data-testid="dashboard-sign-in" @click="signInFromGate">{{ t('dashboard.signInNow') }}</button>
      </div>

      <!-- 发布统计（2026-10-25 视觉统一：改用本页统一的 .dash-panel-title，
           去掉本页独有的 .panel-header/.panel-title 两套类） -->
      <div v-if="statsData" class="cohere-card dash-mb-md stats-login-panel">
        <div class="dash-panel-title"><el-icon><TrendCharts /></el-icon> {{ t('dashboard.publishStatsTitle') }}</div>
        <div class="stats-grid-small">
          <div class="stat-card-mini success">
            <div class="stat-value-mini">{{ statsData.total }}</div>
            <div class="stat-label-mini">累计发布</div>
          </div>
          <div class="stat-card-mini success">
            <div class="stat-value-mini dash-stat-success">{{ statsData.success }}</div>
            <div class="stat-label-mini">成功</div>
          </div>
          <div class="stat-card-mini danger">
            <div class="stat-value-mini dash-stat-danger">{{ statsData.failed }}</div>
            <div class="stat-label-mini">失败</div>
          </div>
          <div class="stat-card-mini">
            <div class="stat-value-mini">{{ statsData.successRate || 0 }}%</div>
            <div class="stat-label-mini">成功率</div>
          </div>
        </div>
      </div>

      <!-- 发布趋势（最近 14 天） -->
      <!-- 权益门控：未解锁时渲染占位（不发 IPC、不渲染真实数据），
           见 PRD §3.2.1 —— 这是体验分级，不是访问控制。 -->
      <DashboardLockedPanel v-if="!hasDashboardFull" name="trend" :title="$t('dashboard.trendTitle')" @upgrade="goToMemberCenter" />
      <div v-else-if="statsData && statsData.daily && statsData.daily.length > 0" class="cohere-card dash-panel trend-panel">
        <div class="dash-panel-title">
          <el-icon><TrendCharts /></el-icon> 
          {{ $t('dashboard.trendTitle') }}
          <span class="panel-subtitle">{{ t('dashboard.last14DaysHint') }}</span>
        </div>
        <div class="dash-trend-track" ref="trendChart">
          <div v-for="(d, index) in last14Days" :key="d.date" 
               :style="{ animationDelay: (0.2 + index * 0.05) + 's' }"
               class="dash-trend-col">
            <div class="dash-trend-bar" 
                 :style="{
                   height: Math.max(4, (d.total / dailyMax) * 160) + 'px',
                   background: d.total > 0 ? 'var(--brand-gradient)' : 'var(--color-border)',
                   opacity: d.total > 0 ? 0.7 + (d.total / dailyMax) * 0.3 : 0.3
                 }"
                 :data-value="d.total">
              <span class="bar-tooltip">{{ t('dashboard.countUnit', { count: d.total }) }}</span>
            </div>
            <span class="dash-trend-date">{{ d.date.slice(5) }}</span>
          </div>
        </div>
      </div>

      <!-- 作品互动回流（P2-6c）：数字一律来自 performance_snapshot 聚合 -->
      <DashboardLockedPanel v-if="!hasDashboardFull" name="perf" :title="$t('dashboard.metrics.title')" @upgrade="goToMemberCenter" />
      <PerformanceFlowPanel v-else class="dash-mt-xl" :reload-token="metricsReloadToken" />

      <!-- 平台分布 -->
      <DashboardLockedPanel v-if="!hasDashboardFull" name="platform" :title="$t('dashboard.platformDistTitle')" @upgrade="goToMemberCenter" />
      <div v-else-if="statsData && platformStats.length > 0" class="cohere-card dash-panel platform-panel">
        <div class="dash-panel-title">
          <el-icon><DataLine /></el-icon> 
          {{ $t('dashboard.platformDistTitle') }}
        </div>
        <div class="dash-dist-list">
          <div v-for="p in platformStats" :key="p.platform" 
               :style="{ animationDelay: (0.3 + platformStats.indexOf(p) * 0.1) + 's' }"
               class="dash-dist-row animate-on-scroll">
            <span class="dash-dist-name">{{ platformName(p.platform) }}</span>
            <div class="dash-dist-track">
              <div class="dash-dist-fill" 
                   :style="{ width: (p.total / maxPlatformTotal) * 100 + '%', animationDelay: (0.3 + platformStats.indexOf(p) * 0.1) + 's' }"></div>
            </div>
            <span class="dash-dist-count">{{ p.total }} 篇</span>
          </div>
        </div>
      </div>

      <!-- 最近发布 -->
      <div v-if="recentPublishes.length > 0" class="cohere-card dash-panel">
        <div class="dash-panel-title"><el-icon><Timer /></el-icon> {{ $t('dashboard.recentTitle') }}</div>
        <ul class="cohere-timeline">
          <li v-for="r in recentPublishes" :key="r.id" class="cohere-timeline-item" :class="r.success !== false ? 'success' : 'danger'">
            <span class="tl-time">{{ formatTime(r.timestamp) }}</span>
            <span class="tl-text">
              <el-icon :style="{color: r.success !== false ? 'var(--color-success)' : 'var(--color-danger)'}"><CircleCheckFilled v-if="r.success !== false" /><CircleCloseFilled v-else /></el-icon>
              {{ platformName(r.platform) }}: {{ r.title || r.article?.title || '(无标题)' }}
            </span>
          </li>
        </ul>
      </div>

      <!-- 三个附加区块：账号健康度 / 发布队列 / 题材榜。
           抽成 DashboardExtraPanels 是因为直接内联会让本文件超出「行数债务熔断」
           容差（check-max-lines.js 的 LEDGER_GREW，登记值 796 + 容差 200）。 -->
      <DashboardExtraPanels
        :account-health="accountHealth"
        :queue="queue"
        :pattern-board="patternBoard"
        :has-full="hasDashboardFull"
        @upgrade="goToMemberCenter"
      />

      <!-- 各平台数据（2026-10-25）：数据源与口径见 PlatformDataGrid.vue 头注 -->
      <div class="cohere-section-title dash-section-header">
        <el-icon><DataLine /></el-icon>
        {{ t('dashboard.platformsTitle') }}
        <span class="panel-subtitle">{{ t('dashboard.platformsSubtitle') }}</span>
      </div>
      <PlatformDataGrid :model="platformModel" @refresh="refreshSync" />

      <!-- 内容基准比较（2026-10-25 布局统一：**移进 .cohere-content 内部**）。
           原先它挂在 .cohere-content **外面**，于是成为全页唯一没有水平 padding
           （--space-xxl）的区块 ⇒ 标题、输入框、「分析」按钮与上方卡片左右不对齐。
           这与 TrialBanner / DashboardExtraPanels 那次事故是**同款失效模式**
           （Dashboard.style-guard.test.js 的注释里写的就是「放在外侧 ⇒ 丢 padding、
           与下方卡片不对齐」），只是当时没有把本区块纳入守卫。 -->
      <div class="cohere-section-title dash-mt-xl"><el-icon><DataLine /></el-icon> {{ t('dashboard.benchmarkTitle') }}</div>
      <div class="dash-bench-row">
        <input class="cohere-input dash-bench-input" data-testid="benchmark-input" v-model="benchmarkTitle" :placeholder="t('dashboard.benchmarkPlaceholder')" @keyup.enter="doBenchmark" />
        <button class="cohere-btn-primary" @click="doBenchmark" :disabled="!benchmarkTitle.trim()">{{ t('dashboard.benchmarkAction') }}</button>
      </div>
      <BenchmarkChart v-if="benchmarkActiveTitle" :title="benchmarkActiveTitle" :key="benchmarkActiveTitle" />
    </div>
  </div>
</template>

<script setup>
// eslint-disable-next-line no-unused-vars
import UiButton from "../components/UiButton.vue";
import { getApi } from '@/api/electron-bridge'
// eslint-disable-next-line no-unused-vars
import UiInput from "../components/UiInput.vue";
import { ref, computed, onMounted, watch } from 'vue'
import { ChatDotRound, CircleCheckFilled, CircleCloseFilled, DataLine, Promotion, Timer, TrendCharts, UserFilled, View } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
// eslint-disable-next-line no-unused-vars
import { syncAll, syncPlatform } from '@/api/publisher'
import { usePlatformStore } from '@/stores/platforms'
import { useAccountStore } from '@/stores/accounts'
import { useIdentity } from '@/composables/useIdentity'
import { isAuthGateResult } from '@/utils/auth-gate'
import { formatDateTime } from '@/utils/datetime'
import BenchmarkChart from '@/components/BenchmarkChart.vue'
import PerformanceFlowPanel from '@/features/dashboard/PerformanceFlowPanel.vue'
import DashboardLockedPanel from '@/features/dashboard/DashboardLockedPanel.vue'
import DashboardExtraPanels from '@/features/dashboard/DashboardExtraPanels.vue'
import PlatformDataGrid from '@/features/dashboard/PlatformDataGrid.vue'
// 注意：这里**不要**再 import UpgradeModal。
// 历史教训（fix-upgrade-payment-entry）：曾 import 它、也写了 4 处
// @upgrade="showUpgradeModal = true"，但模板里从未渲染 <UpgradeModal>，
// 于是「升级解锁」点下去毫无反应；当时 lint 报了 no-unused-vars，
// 却用 eslint-disable 掩盖过去，而不是去查「为什么 import 了却没用」。
// 升级入口现在跳会员中心（有真实价目与兑换码核销），不需要这个弹窗。
import { useRouter } from 'vue-router'
import { useIdentityStore } from '@/stores/identity'
import { hasFeatureOf, DASHBOARD_FULL_FEATURE } from '@/views/member-center/entitlement-gate'
import { accountBatchCheckLogin, getQueueStatus, getQueueHistory } from '@/api/publisher'
import { listPatternPerformance, performanceOverview } from '@/api/knowledge-library'
import {
  toAccountHealthModel,
  toQueueStatusModel,
  toPatternBoardModel,
  toKpiModel,
  toPlatformDataModel,
  AUTH_GATE,
} from '@/features/dashboard/dashboard-panels-model'

const syncing = ref(false)
const dismissBanner = ref(false)
const { t } = useI18n()
const router = useRouter()

/**
 * 升级入口 → 会员中心。
 * 为什么不是打开 UpgradeModal：正式包里那里只有「付费通道筹备中」，是死胡同；
 * 会员中心有真实档位、真实价格与服务端兑换码核销 —— 那是当前唯一真实可用的开通渠道。
 * 在线支付仍未实现，属独立立项，见 PRD-FIX-UPGRADE-PAYMENT-ENTRY-2026-10-17 §5。
 */
function goToMemberCenter () {
  router.push('/member-center')
}
// sync:cached 的原始记录（2026-10-25 起**只**用于账号级指标「粉丝」，且只接受
// 「可信」记录：既无 error、也无遗留占位标记 _note —— 判据单一实现见
// features/dashboard/dashboard-panels-model.js 的 trustedSyncRows()。
const platformSyncRows = ref([])
const statsData = ref(null)
// 作品互动回流总览（performance:overview）：作品级指标的**唯一**来源。
// 与 PerformanceFlowPanel 各自取一次（同一 reloadToken 触发），口径相同。
const perfOverview = ref(null)
const recentPublishes = ref([])
// 回流看板与页面共用同一个刷新入口：两个入口各自拉数据会拿到不同时刻的数字
const metricsReloadToken = ref(0)
// 未登录门禁态：dashboard:stats / history:list 要求登录（AUTH_REQUIRED），
// 旧实现静默吞掉导致空数据无引导（2026-09-15，与 publish-history 同范式）。
const statsLoginRequired = ref(false)
const { isAuthenticated: identityAuthenticated, signIn: identitySignIn } = useIdentity()
const platformStore = usePlatformStore()
platformStore.load()

// ─── 套餐权益分级（dash-full-entitlement）─────────────────────────────
// 一律走服务端 entitlement，**不用** licenseStore.isPro：后者是二值，
// 会把 standard 档误判成免费（调研确认的既有陷阱）。
// entitlement 在未登录/未取到时是 null，hasFeatureOf 内部已判空。
const identityStore = useIdentityStore()
const hasDashboardFull = computed(() => hasFeatureOf(identityStore.entitlement, DASHBOARD_FULL_FEATURE))

// 批量检测入参：从 store 取 id 后必须 JSON 脱壳 —— Vue ref 包着的是 reactive proxy，
// 直接传 IPC 会抛 "An object could not be cloned"（项目 QM-2 明写的纪律）。
const accountStore = useAccountStore()
const accountIdsForCheck = computed(() =>
  (accountStore.accounts || []).map((a) => a && a.id).filter((id) => typeof id === 'string' && id)
)

// ─── 新增区块状态（初值 loading，四态：loading/ready/empty/error/auth）────
const accountHealth = ref({ state: 'loading', ok: 0, bad: 0, unknown: 0, badAccounts: [], badOverflow: 0 })
const queue = ref({ state: 'loading', running: 0, pending: 0, failed: 0, failedTitles: [] })
const patternBoard = ref({ state: 'loading', rows: [] })

function platformName (id) { return platformStore.getLabel(id) || id }
const formatTime = (iso) => formatDateTime(iso, { style: 'hour-minute' })

/**
 * KPI 数值格式化：**没有真值就显示「—」，不显示 0**。
 * 「取不到」与「真的是 0」是两件事（PRD §3.3.3）。
 */
function formatMetric (value) {
  // ⚠️ 判定必须是「类型 + 有限性」：Number(null) 与 Number('') 都是 0，
  // 只判 isFinite 会把「没有这项数据」显示成假 0（本次要消灭的那类谎）。
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value > 10000 ? (value / 10000).toFixed(1) + '万' : value.toLocaleString('zh-CN')
}

// KPI 行与「各平台数据」区块的模型（口径定义见 dashboard-panels-model.js）
const kpi = computed(() => toKpiModel({
  stats: statsData.value,
  perf: perfOverview.value,
  syncRows: platformSyncRows.value,
}))
const platformModel = computed(() => toPlatformDataModel({
  stats: statsData.value,
  perf: perfOverview.value,
  syncRows: platformSyncRows.value,
}))

const last14Days = computed(() => {
  if (!statsData.value || !statsData.value.daily) return []
  return statsData.value.daily.slice(-14)
})

const dailyMax = computed(() => {
  const days = last14Days.value
  if (days.length === 0) return 1
  return Math.max(1, ...days.map(d => d.total))
})

const platformStats = computed(() => {
  if (!statsData.value || !statsData.value.perPlatform) return []
  return Object.entries(statsData.value.perPlatform)
    .map(([platform, data]) => ({ platform, ...data }))
    .sort((a, b) => b.total - a.total)
})

const maxPlatformTotal = computed(() => {
  if (platformStats.value.length === 0) return 1
  return Math.max(1, ...platformStats.value.map(p => p.total))
})

/**
 * 「刷新数据」：重新拉本页**真正展示**的三路数据。
 * 2026-10-25 变更：旧实现只 await `syncAll()`（那条链路恒返回 0 ⇒ 刷新的是假数据），
 * 且它必然失败 ⇒ 每次点刷新都弹「平台同步失败」。
 * 现在：三路真实数据并行刷新；`syncAll` 降级为尽力而为（失败不阻断、不弹错，
 * 该 IPC 契约仍有 E2E 依赖）。详见 PRD §5.2。
 */
async function refreshSync () {
  if (!syncAll) return
  syncing.value = true
  try {
    await Promise.allSettled([
      syncAll(),
      loadStats(),
      loadRecent(),
      loadPerfOverview(),
    ])
    await loadCached()
    metricsReloadToken.value += 1
  } catch (e) {
    console.warn('Refresh failed:', e.message)
    ElMessage.error(t('dashboard.syncFailed'))
  } finally {
    syncing.value = false
  }
}

async function loadStats () {
  const api = getApi()
  if (!api || !api.dashboardStats) return
  try {
    const res = await api.dashboardStats()
    if (isAuthGateResult(res)) {
      statsLoginRequired.value = true
      return
    }
    statsLoginRequired.value = false
    if (res.code === 0) statsData.value = res.data
  } catch (e) {
    console.warn('Load stats failed:', e.message)
    ElMessage.error(t('dashboard.loadStatsFailed'))
  }
}

async function loadRecent () {
  const api = getApi()
  if (!api || !api.historyList) return
  try {
    const res = await api.historyList({ limit: 5 })
    if (isAuthGateResult(res)) {
      statsLoginRequired.value = true
      return
    }
    if (res.code === 0) recentPublishes.value = (res.data && res.data.records) || []
  } catch (e) {
    console.warn('Load recent failed:', e.message)
    ElMessage.error(t('dashboard.loadRecentFailed'))
  }
}

/**
 * 账号健康度、发布队列、题材表现榜三路**并行**取数（dash-full-entitlement）。
 * 纪律（QM-2 首屏不得串行阻塞）：三路 allSettled 并行；单路失败只停该路；
 * 题材榜未解锁时**根本不发起**请求。
 * 防重入：onMounted / watch(auth) / watch(权益) 三个入口都会调它，
 * 而权益是异步下发的 ⇒ 不加闸门会让同一批数据被取 3~5 次（实测题材榜 5 次）。
 */
// 题材榜单独一个入口：只有它受权益门控，与账号/队列解耦后，
// 权益到位时不会把已取到的账号/队列数据再拉一遍（拆分前的实测：5 次 IPC）。
let patternSeq = 0
async function loadPatternBoard () {
  const seq = ++patternSeq
  // 未解锁时**根本不发请求**：主进程对该通道不设权益防（PRD §3.2.1），
  // 发了会成功返回却不能显示，这个"拿到了但不给看"的状态无从解释，不如不发。
  if (!hasDashboardFull.value) {
    patternBoard.value = { state: 'loading', rows: [] }
    return
  }
  try {
    const res = await listPatternPerformance({ dimension: 'narrative_structure' })
    if (seq === patternSeq) patternBoard.value = toPatternBoardModel(res)
  } catch (e) {
    console.warn('Load pattern board failed:', e && e.message)
    if (seq === patternSeq) patternBoard.value = { state: 'error', rows: [] }
  }
}

let newPanelsSeq = 0
async function loadNewPanels () {
  const seq = ++newPanelsSeq
  const [accountRes, statusRes, historyRes] = await Promise.allSettled([
    // 展开运算符已足够脱壳：accountIdsForCheck 是 string[]，元素是**原始值**，
    // 不是被 reactive 包装的对象。原写法 JSON.parse(JSON.stringify(...)) 属过度，
    // 且每次 auth/entitlement 变化都跑一遍完整序列化（CCG i6 提出，已采纳）。
    // 注意：若将来元素变成对象，必须换回深拷贝 —— reactive proxy 传 IPC 会抛
    // "An object could not be cloned"（QM-2 明文纪律）。
    accountBatchCheckLogin([...accountIdsForCheck.value]),
    getQueueStatus(),
    getQueueHistory(),
  ])
  // 被后来的调用取代则丢弃结果（防乱序写回）
  if (seq !== newPanelsSeq) return
  accountHealth.value = toAccountHealthModel(accountRes.status === 'fulfilled' ? accountRes.value : null)
  queue.value = toQueueStatusModel(
    statusRes.status === 'fulfilled' ? statusRes.value : null,
    historyRes.status === 'fulfilled' ? historyRes.value : null
  )
}

async function signInFromGate () {
  // 打开登录窗口的唯一正确入口：identity.signIn()（主进程 Logto OAuth）；取消保持门禁态。
  try {
    await identitySignIn()
  } catch {
    /* 用户取消或登录窗关闭 */
  }
}

// 登录成功后自动重载看板数据，无需刷新页面。
watch(identityAuthenticated, (authed) => {
  if (authed && statsLoginRequired.value) {
    statsLoginRequired.value = false
    loadStats()
    loadRecent()
  }
  // 新增三区块同样依赖登录态（队列/账号通道不在 public 列表）
  if (authed) loadNewPanels()
})

// 权益到位时只补取题材榜（PRD §3.2.1）：它是唯一受门控的区块。
// 账号/队列不受套餐限制，权益到位不该让它们再取一遍。
watch(hasDashboardFull, loadPatternBoard)

/**
 * 取 `sync:cached` 的原始记录。
 * ⚠️ 这些记录**不直接进界面数字**（那条链路在主进程恒返回 0 占位值），
 * 只作为账号级指标（粉丝）的候选来源，由模型层逐条判定可信度。
 */
async function loadCached () {
  const api = getApi()
  if (!api || !api.syncCached) return
  try {
    const res = await api.syncCached()
    if (res.code === 0) platformSyncRows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.warn('Load cached failed:', e.message)
    ElMessage.error(t('dashboard.loadCachedFailed'))
  }
}

/**
 * 取作品互动回流总览（performance:overview）：**作品级**指标的唯一来源。
 * 取不到时保持 null ⇒ KPI 与平台卡片显示「—」而不是 0。
 */
async function loadPerfOverview () {
  try {
    const res = await performanceOverview({ windowDays: 30 })
    if (isAuthGateResult(res)) {
      perfOverview.value = null
      return
    }
    if (res && res.code === 0) perfOverview.value = res.data
  } catch (e) {
    console.warn('Load performance overview failed:', e && e.message)
  }
}

const benchmarkTitle = ref('')
const benchmarkActiveTitle = ref('')

function doBenchmark () {
  if (!benchmarkTitle.value.trim()) return
  benchmarkActiveTitle.value = benchmarkTitle.value.trim()
}

onMounted(() => {
  loadCached()
  loadStats()
  loadRecent()
  loadPerfOverview()
  loadNewPanels()
  loadPatternBoard()
})
</script>

<style scoped>
/* === 单一真源：品牌色一律取全局 token ===
 * 旧写法在本页另起了一套紫（写死的亮色值，暗色下不切换）⇒ 同屏两种紫。
 * 现在这四个变量只做别名，值全部指向全局 token；页面里的品牌紫一律走
 * --primary / --brand-gradient。论证见 PRD-DASHBOARD-TRUTHFUL-UI §3.2。 */
:global(:root) {
  --lavender-primary: var(--primary);
  --lavender-light: var(--color-bg-inset);
  --lavender-accent: var(--primary);
  --deep-purple: var(--color-text-strong);
}

/* 页面底部净空：右下角有 fixed 浮标（回到顶部），内容必须能滚到它上方。
 * 事故现场（2026-10-25）：滚到底时「内容基准比较·分析」按钮被浮标压住，点不到。
 * 见规范 §16 浮标安全区。 */
.dash-page {
  padding-bottom: var(--mp-float-safe-bottom);
}

/* === 统计卡片网格 - 不规则布局 === */
.stats-grid {
  display: grid;
  /* 桌面 5 列 == hero(span2) + 3 普通卡 = 5 网格单元，单行铺满无孤儿换行 */
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: auto;
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.stat-card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--elevation-2);
  transition: transform var(--motion-base) var(--ease-out-soft),
              box-shadow var(--motion-base) var(--ease-out-soft),
              border-color var(--motion-fast) var(--ease-default);
  position: relative;
  overflow: hidden;
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) forwards;
}

/* 深色模式覆盖（P4 2026-10-08）：background: white 是硬编码，暗色下不变 →
 * 深底上三张刺眼白卡（实测截图见研究方案 §3.3/§8）。改用 token 让暗色
 * 自动切换到 --color-bg-card（#232329）；白卡内文字继承暗色文字档。 */
[data-theme='dark'] .stat-card {
  background: var(--color-bg-card);
  box-shadow: none;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--brand-gradient);
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.stat-card:hover::before {
  opacity: 1;
}

.stat-card.large {
  grid-column: span 2;
  /* hero 卡改用统一品牌渐变（与首页主任务卡同一套 token），
   * 旧值 linear-gradient(135deg, #1e1b4b, #4a3f8f) 是另一条紫色路径，
   * 与按钮/图标片的紫对不上，同屏出现两种紫。 */
  background: var(--brand-gradient);
  border-color: transparent;
  box-shadow: var(--brand-glow);
  color: white;
}

.stat-card.large::before {
  display: none;
}

.stat-card.large:hover {
  transform: scale(1.02);
}

/* hero 卡右侧装饰光晕：2 列宽内容仅占左半，柔光圆斑填充右半空区 */
.stat-decor {
  position: absolute;
  top: 50%;
  right: -30px;
  width: 160px;
  height: 160px;
  transform: translateY(-50%);
  border-radius: var(--radius-full);
  background: radial-gradient(circle at 32% 30%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 70%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
  pointer-events: none;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xl);
  margin-bottom: var(--space-md);
  background: var(--brand-gradient-soft);
  color: var(--color-primary);
}

.stat-card.large .stat-icon {
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  color: #ffffff;
}

/* 数字排版：改用统一展示字族 + 等宽数字（tabular-nums）。
 * 旧值 'JetBrains Mono', monospace —— 本机没装 JetBrains Mono，
 * 回退到系统等宽字体，于是同一个应用里「数据看板」的数字是等宽衬线感，
 * 而首页/发布记录的数字是无衬线，同屏两种数字字形。 */
.stat-value {
  font-size: clamp(2.4rem, 4vw, 2.8rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: var(--space-xs);
  font-family: var(--font-family-ui-display);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-strong);
}

.stat-card.large .stat-value { color: #ffffff; }

.stat-card.large .stat-value {
  font-size: clamp(3rem, 5vw, 3.6rem);
}

.stat-label {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.stat-card.large .stat-label {
  color: rgba(255, 255, 255, 0.8);
}

/* === 发布统计面板 === */
.stats-login-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.1s backwards;
}

.panel-subtitle {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-weight: 400;
  margin-left: var(--space-sm);
}

.stats-grid-small {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-md);
}

.stat-card-mini {
  background: var(--cream-surface);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  text-align: center;
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.stat-card-mini:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.stat-card-mini.success {
  background: rgba(16, 185, 129, 0.05);
}

.stat-card-mini.danger {
  background: rgba(239, 68, 68, 0.05);
}

.stat-value-mini {
  font-size: var(--font-size-xxl);
  font-weight: 700;
  /* 与 .stat-value 同一套展示字族 + 等宽数字（tabular-nums）。
   * 旧值 'JetBrains Mono', monospace —— 本机没装该字体，回退到系统等宽字体，
   * 于是**同一页里两种数字字形**（上方大卡是无衬线、下面迷你卡是等宽衬线感）。 */
  font-family: var(--font-family-ui-display);
  font-variant-numeric: tabular-nums;
  margin-bottom: 4px;
}

.stat-label-mini {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

/* === 趋势图表 === */
.trend-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.2s backwards;
}

.dash-trend-track {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 200px;
  padding: var(--space-md) 0;
  overflow-x: auto;
}

.dash-trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 40px;
}

.dash-trend-bar {
  width: 100%;
  max-width: 40px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
  position: relative;
  cursor: pointer;
  animation: growBar 1s cubic-bezier(0.33, 1, 0.68, 1) forwards;
  animation-fill-mode: both;
}

.dash-trend-bar:hover {
  filter: brightness(1.1);
  box-shadow: 0 8px 24px rgba(244, 114, 182, 0.2);
}

.bar-tooltip {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-strong);
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.dash-trend-bar:hover .bar-tooltip {
  opacity: 1;
}

.dash-trend-date {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-align: center;
}

/* === 平台分布 === */
.platform-panel {
  animation: fadeInUp 0.6s cubic-bezier(0.33, 1, 0.68, 1) 0.3s backwards;
}

.dash-dist-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm);
  border-radius: var(--radius-md);
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.dash-dist-row.animate-on-scroll {
  animation: fadeInLeft 0.6s cubic-bezier(0.33, 1, 0.68, 1) forwards;
}

.dash-dist-row:hover {
  background: var(--lavender-light);
}

.dash-dist-track {
  flex: 1;
  height: 16px;
  background: var(--lavender-light);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.dash-dist-fill {
  height: 100%;
  background: var(--brand-gradient);
  border-radius: var(--radius-full);
  transition: width 1.2s cubic-bezier(0.33, 1, 0.68, 1);
  animation: fillProgress 1.2s cubic-bezier(0.33, 1, 0.68, 1) forwards;
  animation-fill-mode: both;
}

.dash-dist-count {
  font-weight: 700;
  color: var(--color-text-strong);
  min-width: 60px;
  text-align: right;
  font-size: var(--font-size-base);
}

/* === 章节标题 === */
.dash-section-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  color: var(--color-text-strong);
}

/* === 动画关键帧 === */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeInLeft {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes growBar {
  from {
    height: 0;
  }
}

@keyframes fillProgress {
  from {
    width: 0;
  }
}

/* T1-3e：原 25 处内联样式全部类化；颜色一律 var(--color-*)（旧别名 fallback 值
 * #f56c6c/#e0e0e0 均为未生效 fallback，直接丢弃零视觉回归）。 */
.dash-mb-md { margin-bottom: var(--space-md); }
.dash-mt-xl { margin-top: var(--space-xl); }
.dash-stat-success { color: var(--color-success); }
.dash-stat-danger { color: var(--color-danger); }
.dash-panel { cursor: default; margin-bottom: var(--space-md); padding: 16px; }
.dash-fail-note { font-size: var(--font-size-xs); color: var(--color-danger); }
.dash-grid-280 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.dash-bench-row { display: flex; gap: var(--space-sm); margin-bottom: var(--space-md); align-items: center; }
.dash-bench-input { flex: 1; font-size: var(--font-size-base); }

/* KPI 口径说明行（2026-10-25）：告诉用户每个数字来自哪、为什么会出现「—」。
 * 不做成 tooltip：口径是**长期事实**，藏在悬浮提示里等于没有。 */
.dash-kpi-note {
  margin: calc(var(--space-md) * -1 + var(--space-xs)) 0 var(--space-lg);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

/* 最近发布时间线圆点：与全站语义色对齐。
 * 全局 .cohere-timeline-item.success::before 用的是写死绿 #22c55e，
 * 而本页其它成功态用的是 --color-success（#34d399）⇒ 同屏两种绿。
 * 这里在**本页**覆盖（不动全局，避免波及其它页面的像素基线）。 */
.cohere-timeline-item.success::before { background: var(--color-success); }
.cohere-timeline-item.danger::before { background: var(--color-danger); }

/* === 未登录门禁条（发布统计/最近发布登录后可见时的占位提示）=== */
.dashboard-login-gate {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-md);
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
  background: var(--cream-surface);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}

.gate-hint {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
}

.gate-sign-in {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  cursor: pointer;
  padding: 8px 18px;
  border-radius: var(--radius-pill);
  background: var(--primary);
  color: #fff;
  font-size: var(--font-size-sm);
  font-weight: 600;
  transition: all 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.gate-sign-in:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.gate-sign-in:active {
  transform: translateY(0);
}

/* 账号健康度 / 发布队列 / 题材榜的样式已随模板一并迁入
 * features/dashboard/DashboardExtraPanels.vue（自包含 scoped）。
 * 这里不再保留副本 —— 两份定义会静默漂移（改一处忘另一处）。 */

/* 响应式 */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .stat-card.large {
    grid-column: span 1;
  }
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  
  .stat-card.large {
    grid-column: span 1;
  }
  
  .stats-grid-small {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
