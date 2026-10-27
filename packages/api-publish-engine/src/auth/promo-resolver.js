'use strict'
/**
 * promo-resolver.js — 标准版**月付**「上市期半价」定价解析（**纯函数、零依赖**）。
 *
 * 为什么单独成文件：这是全站**唯一**决定「向微信实收多少钱」的定价判定点。
 * 把它写成纯函数（不读 env、不读时钟、不碰数据库）才能让每一条窗口/计数分支
 * 都被单测穷举 —— 定价逻辑一旦混进 I/O，边界（活动前 1 秒、第 4 单）就只能靠线上试。
 *
 * 契约（见 openspec/changes/standard-plan-promo/proposal.md §4 与 §12 二次修订）：
 *   resolvePrice({ plan, period, now, config, promoPurchaseCount })
 *     → { listPriceCents, payableCents, discountCents, promotion }
 *   promotion 无促销时为 null；否则 { id, endsAt, remainingDays, exhausted }。
 *
 * ⛔ **年付永不参与促销**（v1.2 恢复的语义）：
 *   · 年付一次覆盖 12 个月，而限购的计量单位是「次」——两者量纲不匹配，
 *     3 次 × 1 年 = 3 年，让利从 90 元放大到 900 元（见 PRD §12）；
 *   · 因此年付在任何窗口下都返回静态标价 `listPriceYearlyCents`（59000），
 *     `promotion` 恒为 null、`discountCents` 恒为 0。
 *   · 月付促销 + 限购 3 次已经把单客让利封顶在 3 × 30 = 90 元，
 *     3 × 29 = 87 元 / 3 个月买不到 12 个月 × 29 = 348 元的年付 —— 套利不存在。
 *
 * 判定顺序**不可换**：开关 → 时间窗 [startsAt, endsAt) → plan/period → 计数。
 * 顺序决定语义：
 *   · 先判时间窗 ⇒ 窗口外 promotion 恒 null，UI 不会在活动结束后还挂着「已用完」；
 *   · 计数放在最后 ⇒ 计数超限时 promotion 仍返回（exhausted=true），
 *     否则前端拿不到「活动价已用完，¥59/月」这条**下单前可见**的提示（决策表第 7 行）。
 *
 * 配置非法一律抛 `PROMO_CONFIG_INVALID`（status 500），**不得静默回退到原价**：
 * 回退会让「价格配成 5900（等于标价）」这种部署错误永远不报警，而用户看到的是
 * 「活动上线了但一分没便宜」——客诉与资损都不可观测。
 */

/** 促销活动的稳定 id：订单表 promotion_id 列存它，计数查询按它过滤。 */
const PROMO_ID = 'standard-monthly-half'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 默认窗口：2026-11-01 ~ 2027-02-01（三个月，Asia/Shanghai 自然月对齐）。 */
const PROMO_STANDARD_MONTHLY_DEFAULTS = Object.freeze({
  startsAt: '2026-11-01T00:00:00+08:00',
  endsAt: '2027-02-01T00:00:00+08:00',
  priceCents: 2900,
  maxPurchasesPerUser: 3,
})

const CONFIG_INVALID = 'PROMO_CONFIG_INVALID'

/** 配置类错误：属部署期缺陷，HTTP 层应映射 500 / 启动 fail-fast。 */
function invalid(message) {
  return Object.assign(new Error(`promo-resolver: ${message}`), { code: CONFIG_INVALID, status: 500 })
}

function toDate(value, field) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalid(`${field} is an invalid Date`)
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw invalid(`${field} is not a parseable timestamp`)
    return parsed
  }
  throw invalid(`${field} must be a Date or timestamp string`)
}

/**
 * 配置校验：全部非法形态显式抛错（不返回 null、不夹紧）。
 * @returns {{startsAt: Date, endsAt: Date}}
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw invalid('config must be a plain object')
  }
  if (typeof config.plan !== 'string' || !config.plan) {
    throw invalid('plan must be a non-empty string')
  }
  // 促销只作用于一个月计费周期；配成 'year' 的部署是**语义错误**，必须在启动期炸掉。
  if (config.period !== 'month') {
    throw invalid("period must be 'month' (yearly plans never participate in the promo)")
  }
  const startsAt = toDate(config.startsAt, 'startsAt')
  const endsAt = toDate(config.endsAt, 'endsAt')
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw invalid('endsAt must be strictly after startsAt')
  }
  if (!Number.isInteger(config.priceCents) || config.priceCents <= 0) {
    throw invalid('priceCents must be a positive integer')
  }
  if (!Number.isInteger(config.maxPurchasesPerUser) || config.maxPurchasesPerUser <= 0) {
    throw invalid('maxPurchasesPerUser must be a positive integer')
  }
  if (config.listPriceCents !== undefined) {
    if (!Number.isInteger(config.listPriceCents) || config.listPriceCents < 0) {
      throw invalid('listPriceCents must be a non-negative integer')
    }
    // 标价 > 0 才谈得上「打折」；free 档（标价 0）由调用方跳过，不进入本分支。
    if (config.listPriceCents > 0 && config.priceCents >= config.listPriceCents) {
      throw invalid('priceCents must be lower than listPriceCents')
    }
  }
  // 年付标价只用于「年付恒为原价」的返回；不参与任何促销比较（年付永不促销）。
  if (config.listPriceYearlyCents !== undefined) {
    if (!Number.isInteger(config.listPriceYearlyCents) || config.listPriceYearlyCents < 0) {
      throw invalid('listPriceYearlyCents must be a non-negative integer')
    }
  }
  return { startsAt, endsAt }
}

/**
 * 解析一次询价。
 *
 * @param {object} input
 * @param {'free'|'standard'|'pro'} input.plan
 * @param {'month'|'year'} input.period
 * @param {Date|string|number} input.now
 * @param {object} input.config 促销配置（必填；enabled=false 时按原价）
 * @param {number} [input.promoPurchaseCount=0] 该用户已支付的促销单数
 * @returns {{listPriceCents:number, payableCents:number, discountCents:number, promotion:null|{id:string, endsAt:string, remainingDays:number, exhausted:boolean}}}
 */
function resolvePrice({ plan, period, now = new Date(), config, promoPurchaseCount = 0 } = {}) {
  if (typeof plan !== 'string' || !plan) throw invalid('plan is required')
  if (period !== 'month' && period !== 'year') throw invalid("period must be 'month' or 'year'")
  if (!Number.isInteger(promoPurchaseCount) || promoPurchaseCount < 0) {
    throw invalid('promoPurchaseCount must be a non-negative integer')
  }
  const window = validateConfig(config)
  // 两个周期各取自己的标价：年付标价缺失就是配置缺陷，不拿月付标价顶替（差 10 倍量级）。
  const listPriceCents = period === 'year' ? config.listPriceYearlyCents : config.listPriceCents
  if (!Number.isInteger(listPriceCents)) {
    throw invalid(`listPriceCents for period '${period}' is required to resolve a price`)
  }
  const base = { listPriceCents, payableCents: listPriceCents, discountCents: 0, promotion: null }

  // ① 开关
  if (config.enabled !== true) return base
  // ② 时间窗 [startsAt, endsAt)
  const at = toDate(now, 'now')
  if (at.getTime() < window.startsAt.getTime() || at.getTime() >= window.endsAt.getTime()) return base
  // ③ 档位 / 周期：**只有 standard + month 参与**；年付在任何窗口下都是原价
  if (plan !== config.plan || period !== config.period) return base
  // ④ 计数（促销期内每人最多 N 单促销价；超限仍返回 promotion，供 UI 展示「已用完」）
  const exhausted = promoPurchaseCount >= config.maxPurchasesPerUser
  if (exhausted) {
    return { ...base, promotion: buildPromotion(window.endsAt, at, true) }
  }
  return {
    listPriceCents,
    payableCents: config.priceCents,
    discountCents: listPriceCents - config.priceCents,
    promotion: buildPromotion(window.endsAt, at, false),
  }
}

function buildPromotion(endsAt, at, exhausted) {
  return {
    id: PROMO_ID,
    endsAt: endsAt.toISOString(),
    // 向上取整：窗口最后一毫秒显示「剩余 1 天」，绝不显示「0 天」却仍打折。
    remainingDays: Math.max(1, Math.ceil((endsAt.getTime() - at.getTime()) / MS_PER_DAY)),
    exhausted,
  }
}

function positiveIntFromEnv(raw, fallback, field) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
  const value = Number(String(raw).trim())
  if (!Number.isInteger(value) || value <= 0) throw invalid(`${field} must be a positive integer`)
  return value
}

/**
 * 从环境变量装配促销配置（启动期一次）。**`listPriceCents` / `listPriceYearlyCents`
 * 由调用方从 plan-matrix 注入**，避免本文件反向依赖价格矩阵
 * （两处各写一份 5900 就是下一次「改价只改一处」的事故）。
 *
 * 开关语义是 fail-closed：只有字符串 "1" 才算开启，其它任何值（含 'true'）都按关闭。
 */
function loadStandardMonthlyPromoConfig(env = {}, options = {}) {
  const source = env || {}
  const enabled = String(source.PROMO_STANDARD_MONTHLY_ENABLED ?? '').trim() === '1'
  const config = {
    enabled,
    id: PROMO_ID,
    plan: 'standard',
    period: 'month',
    listPriceCents: options.listPriceCents,
    listPriceYearlyCents: options.listPriceYearlyCents,
    priceCents: positiveIntFromEnv(
      source.PROMO_STANDARD_MONTHLY_PRICE_CENTS,
      PROMO_STANDARD_MONTHLY_DEFAULTS.priceCents,
      'PROMO_STANDARD_MONTHLY_PRICE_CENTS',
    ),
    startsAt: String(source.PROMO_STANDARD_MONTHLY_STARTS_AT || PROMO_STANDARD_MONTHLY_DEFAULTS.startsAt).trim(),
    endsAt: String(source.PROMO_STANDARD_MONTHLY_ENDS_AT || PROMO_STANDARD_MONTHLY_DEFAULTS.endsAt).trim(),
    maxPurchasesPerUser: positiveIntFromEnv(
      source.PROMO_STANDARD_MONTHLY_MAX_PURCHASES,
      PROMO_STANDARD_MONTHLY_DEFAULTS.maxPurchasesPerUser,
      'PROMO_STANDARD_MONTHLY_MAX_PURCHASES',
    ),
  }
  // 装配期即校验：配错必须在启动/预检时炸，而不是等第一个用户下单。
  validateConfig(config)
  return Object.freeze(config)
}

module.exports = {
  PROMO_ID,
  PROMO_STANDARD_MONTHLY_DEFAULTS,
  loadStandardMonthlyPromoConfig,
  resolvePrice,
  validateConfig,
}
