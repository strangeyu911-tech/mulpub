'use strict'
/**
 * 011 标准版月付促销的**开发态/测试态**建表语句（生产态真源是
 * `migrations/postgresql/011_payment_promo.sql`，两边 DDL 必须逐字一致）。
 *
 * 为什么独立成文件：内联进 `postgres-identity-repository.js` 的 `SCHEMA` 会把那个文件
 * 推过 500 行债务基线；而抬高基线掩盖自己引入的债务是明确禁止的。体例与
 * `payment-schema.js` / `credit-schema.js` 一致。
 *
 * ⚠ 迁移侧的 SQL 注释**不镜像**进来：漂移锁的比对口径是「迁移侧去注释 + 忽略空白」，
 *   把注释带进来会造成永久假红。
 */

const PAYMENT_PROMO_SCHEMA = [
  'ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS payable_cents INTEGER',
  // 回填口径必须与迁移逐字一致：amount 是标价，discount_cents 是让利，二者之差才是实收。
  'UPDATE identity_orders SET payable_cents = amount - COALESCE(discount_cents, 0) WHERE payable_cents IS NULL',
  'ALTER TABLE identity_orders ALTER COLUMN payable_cents SET NOT NULL',
  'ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS promotion_id TEXT',
  // 非唯一：会员可叠加续费；唯一索引会把正常续费挡成 23505。
  `CREATE INDEX IF NOT EXISTS idx_identity_orders_promotion_user
    ON identity_orders (user_id, promotion_id) WHERE promotion_id IS NOT NULL`,
]

module.exports = { PAYMENT_PROMO_SCHEMA }
