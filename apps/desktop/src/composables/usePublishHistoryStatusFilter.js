/**
 * usePublishHistoryStatusFilter — 发布记录状态筛选与 `?status=` 双向同步的单一实现
 *
 * 存在理由（home-nav-connect）：首页统计卡要把用户直接送到「发布成功/失败」视图，
 * 发布记录页也需要常用状态的一键切换。两处必须使用同一套参数校验，否则
 * 「首页传 failed、页面不认识」会静默回落成全部，而界面看起来完全正常。
 *
 * 参数合同：
 *   - `status=all` / 缺省  → 全部（内部值 ''）
 *   - `status=success`     → 发布成功
 *   - `status=failed`      → 发布失败
 *   - `status=pending`     → 处理中
 *   - 其它值 / 非字符串 / 数组取首值 → 归一化，非法值回落 ''
 *
 * 写 URL 使用 router.replace：状态切换是同一页面的筛选变化，不应在浏览器历史里
 * 堆出十几条「发布记录」条目。replace 失败只留日志，不阻断页面内筛选（筛选值已经在 ref 上生效）。
 */
import { ref, watch } from 'vue'
import { reportError } from '@/utils/report-error'

const VALID_STATUS_FILTERS = new Set(['success', 'failed', 'pending'])

/** 状态标签定义：value='' 表示全部；labelKey 直接对应 historyPage 命名空间 */
export const PUBLISH_HISTORY_STATUS_TABS = Object.freeze([
  Object.freeze({ value: '', testId: 'all', labelKey: 'statusTabAll' }),
  Object.freeze({ value: 'success', testId: 'success', labelKey: 'filterStatusSuccess' }),
  Object.freeze({ value: 'failed', testId: 'failed', labelKey: 'filterStatusFailed' }),
  Object.freeze({ value: 'pending', testId: 'pending', labelKey: 'filterStatusPending' }),
])

/**
 * 把任意 URL 值归一化为内部筛选值。
 * 数组取首值（Vue Router 对重复参数会给出数组），其余非法形态一律回落全部。
 * @param {unknown} value
 * @returns {''|'success'|'failed'|'pending'}
 */
export function normalizePublishStatusFilter (value) {
  const raw = Array.isArray(value) ? value[0] : value
  const normalized = String(raw ?? '').trim().toLowerCase()
  return VALID_STATUS_FILTERS.has(normalized) ? normalized : ''
}

/**
 * @param {object} deps
 * @param {object} deps.route vue-router useRoute()
 * @param {object} deps.router vue-router useRouter()
 */
export function usePublishHistoryStatusFilter ({ route, router }) {
  const statusFilter = ref(normalizePublishStatusFilter(route?.query?.status))

  // URL → 页面内状态（首页统计卡深链 / 浏览器前进后退）
  watch(
    () => route?.query?.status,
    (value) => {
      const next = normalizePublishStatusFilter(value)
      if (next !== statusFilter.value) statusFilter.value = next
    },
  )

  // 页面内状态 → URL（仅在两者归一化结果不同时写，避免回环）
  watch(statusFilter, (value) => {
    const current = normalizePublishStatusFilter(route?.query?.status)
    if (value === current) return
    const query = { ...(route?.query || {}) }
    if (value) query.status = value
    else delete query.status
    Promise.resolve(router.replace({ path: '/publish/history', query }))
      .catch((error) => reportError('publish history status query sync failed', error))
  })

  return { statusFilter, statusTabs: PUBLISH_HISTORY_STATUS_TABS }
}
