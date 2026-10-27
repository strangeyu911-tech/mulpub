// @ts-check
/**
 * plan-features.js — 档位 `entitlement.features` 的客户端判定（纯函数，可单测）。
 *
 * 真源是服务端 `packages/api-publish-engine/src/auth/plan-matrix.js` 下发的 features：
 * 免费档只有 `cloud_publish` / `ai_write` / `official_credit`；`video_create` 由
 * `videoMonthly !== 0` 派生，标准/专业档才有。
 *
 * 与 plan-limits 共用同一条纪律：**缺失即放行**。
 * - entitlement 缺失 / features 不是数组 / 空数组 → 返回 `null`（无信息，调用方放行）；
 * - features 非空但不含目标 key → 返回 `false`（明确未授权）；
 * - 含目标 key → `true`。
 *
 * 为什么空数组也按「无信息」：identity store 的 normalizeState 会把缺失的 features
 * 归一成 `[]`，如果这里把 `[]` 判成「未授权」，一次旧快照字段漂移就会把全体付费用户
 * 锁在功能门外——这正是缺失即放行要防的形态。
 */

/**
 * 是否有某个功能开关。
 * @param {object|null|undefined} entitlement
 * @param {string} feature
 * @returns {boolean|null} null = 无信息（放行）；false = 明确没有；true = 有
 */
export function hasFeature(entitlement, feature) {
  if (!entitlement || typeof entitlement !== 'object') return null
  const features = entitlement.features
  if (!Array.isArray(features) || features.length === 0) return null
  return features.includes(feature)
}
