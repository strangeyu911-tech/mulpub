'use strict'
/**
 * payment-order-store.js — 支付订单的写入与促销计数（CommerceMethods 的 mixin）。
 *
 * 为什么独立成文件：`postgres-commerce-store.js` 已贴在 500 行债务基线上（498/500），
 * 把「三列账务口径 + 计数查询」内联进去会直接把那个文件推进挂账区，而抬高基线
 * 掩盖自己引入的债务是明确禁止的。体例同 `subscription-payment.js` 的 `applyXxx` mixin：
 * 方法定义在本文件，挂回 `CommerceMethods` 原型，对外契约（this.repository.createPendingOrder）
 * 完全不变。
 */

/**
 * pending 促销单占用额度的窗口 = **30 分钟**。
 *
 * ⛔ 这不是臆造的新 TTL：现有代码里唯一成文的 pending 超时口径就是支付弹窗的
 * 30 分钟硬上限（`apps/desktop/src/components/WeChatPayDialog.vue:87-89`，
 * 注释明确写「与 PRD §6.1『pending 订单 30 分钟未 paid』同源」；PRD-WECHAT-PAY-INTEGRATION
 * §7.3 同值）。服务端**没有**把 pending 置 failed 的定时任务，所以这里不新增支付状态机，
 * 只按 `created_at` 滑窗判断「这笔 pending 还算不算占用额度」。
 *
 * 为什么必须让 pending 占额度：定价在下单时固化。若只数 `status='paid'`，用户可开 5 个窗口
 * 各下一单，5 个 pending 都按 2900 定价，逐一支付后拿到 5 个月促销价。30 分钟后弃单自动
 * 释放额度，又不会把用户永久锁死；30 分钟内才支付成功的旧 pending 由结算兜底记
 * `PROMO_QUOTA_OVERSOLD`，不拒付。
 */
const PROMO_PENDING_RESERVATION_MINUTES = 30

const INSERT_PENDING_ORDER_SQL = `INSERT INTO identity_orders
    (id, user_id, plan, amount, currency, channel, status, period, payable_cents, discount_cents, promotion_id)
   VALUES ($1, $2, $3, $4, $5, 'payment', 'pending', $6, $7, $8, $9)
   RETURNING *`

// paid 永远占额度；pending 只在有效期内占额度（过期后额度自动释放）。
const COUNT_PROMO_PURCHASES_SQL = `SELECT count(*)::int AS count FROM identity_orders
    WHERE user_id = $1 AND promotion_id IS NOT NULL
      AND (status = 'paid'
           OR (status = 'pending'
               AND created_at >= COALESCE($2::timestamptz, NOW()) - ($3 * INTERVAL '1 minute')))`

// 结算兜底只数「已支付」：pending 不参与超卖判定。
const COUNT_PAID_PROMO_PURCHASES_SQL = `SELECT count(*)::int AS count FROM identity_orders
    WHERE user_id = $1 AND promotion_id IS NOT NULL AND status = 'paid'`

/** 同一个 mixin 既挂池级仓储、也挂事务类：事务内用 this.client，池级用 this.pool。 */
function dbOf (target) {
  if (target && target.client && typeof target.client.query === 'function') return target.client
  if (target && target.pool && typeof target.pool.query === 'function') return target.pool
  throw new TypeError('payment-order-store: no queryable client/pool')
}

function toIsoOrNull (value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

class PaymentOrderOps {
  /**
   * 落 pending 订单。**三列账务口径必须同时写**：
   *   amount=标价、discountCents=让利、payableCents=实收（传给微信的金额）；
   *   promotionId 只在真正享受促销价时非空（计数查询按它过滤，原价单不得计入上限）。
   * 由服务层算好后传入，仓储不做任何价格推断 —— 价格真源只有一个（promo-resolver）。
   *
   * 为什么另起 SQL 而不复用 INSERT_ORDER：后者硬编码 `status='paid', paid_at=NOW()`，
   * 是兑换码/后台开通的语义；支付路径必须先 pending 再等回调，混用会让「下单即视为已支付」。
   */
  async createPendingOrder ({ id, userId, plan, amount, currency = 'CNY', period, payableCents = null, discountCents = 0, promotionId = null }) {
    const payable = Number.isInteger(payableCents) ? payableCents : amount
    const result = await dbOf(this).query(INSERT_PENDING_ORDER_SQL, [
      id, userId, plan, amount, currency, period, payable, discountCents, promotionId,
    ])
    return result.rows[0] || null
  }

  /**
   * 促销限购计数。
   * @param {string} userId
   * @param {{now?: Date|string|null, includePending?: boolean}} [options]
   *   includePending=true（默认）：paid + 30 分钟内 pending；
   *   includePending=false：只数 paid（结算兜底判定超卖时用）。
   */
  async countPromoPurchases (userId, { now = null, includePending = true } = {}) {
    const db = dbOf(this)
    const result = includePending
      ? await db.query(COUNT_PROMO_PURCHASES_SQL, [userId, toIsoOrNull(now), PROMO_PENDING_RESERVATION_MINUTES])
      : await db.query(COUNT_PAID_PROMO_PURCHASES_SQL, [userId])
    return Number(result.rows[0] && result.rows[0].count) || 0
  }

  /**
   * 促销下单的原子预占：同一用户先拿事务级 advisory lock，再计数、定价、落 pending。
   * 锁与 INSERT 在同一事务 ⇒ 第 4 个并发请求必然看到前 3 个已提交的 pending。
   *
   * 定价仍由服务层的纯函数决定：本方法只把 count 交给 `resolvePendingOrder(count)`，
   * 仓储不接触 promo-resolver，价格真源不分裂成两份。
   *
   * @param {{userId: string, now?: Date|string|null, resolvePendingOrder: Function}} input
   * @returns {Promise<{order: object, pricing: object|null, promoPurchaseCount: number}>}
   */
  async createPendingOrderWithPromoQuota ({ userId, now = null, resolvePendingOrder } = {}) {
    if (typeof resolvePendingOrder !== 'function') {
      throw new TypeError('createPendingOrderWithPromoQuota: resolvePendingOrder is required')
    }
    return this.commerceTransaction(async (tx) => {
      await tx.lockPromoQuota(userId)
      const promoPurchaseCount = await tx.countPromoPurchases(userId, { now })
      const resolved = resolvePendingOrder(promoPurchaseCount)
      if (!resolved || !resolved.order) {
        throw new TypeError('createPendingOrderWithPromoQuota: resolvePendingOrder must return { order }')
      }
      const order = await tx.createPendingOrder(resolved.order)
      return { order, pricing: resolved.pricing || null, promoPurchaseCount }
    })
  }
}

function applyPaymentOrderOps (Proto) {
  const names = Object.getOwnPropertyNames(PaymentOrderOps.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PaymentOrderOps.prototype, key))
  }
}

module.exports = { PaymentOrderOps, applyPaymentOrderOps, PROMO_PENDING_RESERVATION_MINUTES, COUNT_PROMO_PURCHASES_SQL }
