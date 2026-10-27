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
  async createPendingOrder({ id, userId, plan, amount, currency = 'CNY', period, payableCents = null, discountCents = 0, promotionId = null }) {
    const payable = Number.isInteger(payableCents) ? payableCents : amount
    const result = await this.pool.query(
      `INSERT INTO identity_orders (id, user_id, plan, amount, currency, channel, status, period, payable_cents, discount_cents, promotion_id)
       VALUES ($1, $2, $3, $4, $5, 'payment', 'pending', $6, $7, $8, $9)
       RETURNING *`,
      [id, userId, plan, amount, currency, period, payable, discountCents, promotionId],
    )
    return result.rows[0] || null
  }

  /** 促销限购计数：只数**已支付**且**真正享促销价**的订单（pending 不占额度，避免弃单锁死）。 */
  async countPromoPurchases(userId) {
    const result = await this.pool.query(
      `SELECT count(*)::int AS count FROM identity_orders
        WHERE user_id = $1 AND promotion_id IS NOT NULL AND status = 'paid'`,
      [userId],
    )
    return (result.rows[0] && result.rows[0].count) || 0
  }
}

function applyPaymentOrderOps(Proto) {
  const names = Object.getOwnPropertyNames(PaymentOrderOps.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PaymentOrderOps.prototype, key))
  }
}

module.exports = { PaymentOrderOps, applyPaymentOrderOps }
