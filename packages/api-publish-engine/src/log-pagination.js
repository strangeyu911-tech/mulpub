'use strict'

/**
 * log-pagination.js — 审计列表（`GET /api/v1/logs`）的分页参数夹紧。
 *
 * ## 为什么单独成文件
 *
 * `publish-api-server.js` 在逐文件行数门禁的 `targets`（**点名还账**）清单里
 * （`max-lines-baseline.json` 的 `targets` = 1574，**零增长容差**），
 * 而夹紧逻辑要连注释一起占 5~6 行 ⇒ 放进主文件就撞天花板。
 * ⇒ 抽成模块：**说明留在模块里**（可读性不降），主文件只留一行调用。
 *
 * ## 口径
 *
 *   limit  ∈ [1, 200]，缺省 50
 *   offset ≥ 0，缺省 0
 *
 * ⚠️ **夹紧时不能用 `Number(x) || 默认值`**：那样 `limit=0`（越界）会被当成「没传」
 * ⇒ 回落成默认 50 ⇒ **下界永远不生效**（实测踩过）。
 * ⇒ 只有「**没传 / 空串 / 非数字**」才回落默认；**合法但越界的数字必须夹到边界**。
 *
 * ⚠️ **空串必须算「没传」**（2026-10-25 独立复评 F8 实测）：`?limit=` 经 query 解析后是
 * `''`，而 `Number('') === 0`（**不是 NaN**）⇒ 若直接用 `Number.isFinite` 判定，
 * 空串会被当成「合法的 0」⇒ 夹到下界 1 ⇒ **返回 1 条而不是默认 50 条**，
 * 与 PRD §15.4 写明的「空 ⇒ 回落默认」不符。
 * ⇒ 判定必须**先看原始值**（空串/空白串 ⇒ 缺省），再谈数值化。
 *
 * ⚠️ **非整数 limit 取整**：`?limit=2.5` ⇒ 向下取整为 2（limit 是「条数」，
 * 落库/切片前再截断会让读数与实际返回对不上）。
 *
 * ⚠️ 为什么不把 limit 放开到「无限」：审计列表一次拉全量 ⇒ 内存与响应体都不可控；
 * 上界 200 是「够运营翻页」与「不至于把进程打爆」之间的折中。
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MIN_LIMIT = 1

/**
 * 数值化：区分「没传 / 空串 / 非数字」（⇒ 回落默认）与「合法但越界的数字」（⇒ 交给夹紧）。
 *
 * ⚠️ 这里**不能**直接 `Number(raw)` 再判 `isFinite`：`Number('')` 是 **0**（不是 NaN），
 * `Number(null)` 也是 0 ⇒ 空值会被误判成「合法的 0」。
 *
 * @param {unknown} raw 原始查询参数值
 * @param {number} fallback 缺省 / 非法时的回落值
 * @returns {number}
 */
function toNumberOrDefault (raw, fallback) {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw === 'string' && raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

/**
 * 夹紧分页参数。
 *
 * @param {object} [query] 查询参数对象（通常是 `this._queryParams(req)` 的结果）
 * @returns {{ limit: number, offset: number }}
 */
function clampLogPagination (query) {
  const data = query || {}
  const rawLimit = toNumberOrDefault(data.limit, DEFAULT_LIMIT)
  const rawOffset = toNumberOrDefault(data.offset, 0)
  const limit = Math.min(
    Math.max(rawLimit, MIN_LIMIT),
    MAX_LIMIT
  )
  const offset = Math.max(rawOffset, 0)
  return { limit, offset }
}

module.exports = { clampLogPagination, DEFAULT_LIMIT, MAX_LIMIT, MIN_LIMIT }
