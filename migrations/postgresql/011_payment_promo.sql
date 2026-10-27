-- 011 标准版月付「上市期半价」促销：订单三列账务口径
-- 真源：01-docs/PRD-STANDARD-PLAN-PROMO-2026-10-27.md §3 / openspec/changes/standard-plan-promo/proposal.md §4
--
-- 为什么需要这三列（`payable_cents` / `promotion_id`，加上既有的 `discount_cents`）：
--   促销单的「标价」「折扣」「实收」必须同时落库，否则三种口径只能事后靠 plan-matrix 重算，
--   而运营改价后重算出来的金额与用户当时实际支付的金额**必然不同**（对账直接错）。
--     amount          = 标价 5900（合同价/展示价，退款口径的参照）
--     discount_cents  = 促销让利 3000
--     payable_cents   = 实收 2900（**传给微信的唯一金额**，回调校验的唯一真值）
--   `promotion_id` 只在一单**真正享受促销价**时写入：计数查询按它过滤，
--   所以「第 4 单按原价」不会被计入上限（否则用户永远卡在同一单上）。
--
-- ⛔ 明确**不**建「每用户唯一 paid 订单」索引：
--   会员是**可叠加续费**的（同一用户多次购买同一档是正常业务），唯一索引会把正常续费挡成
--   23505（表现为「老用户无法续费」）。限购只能靠服务层计数 + 对账（PRD §9 已知残留风险）。
--
-- ⚠ 迁移编号纪律（AGENTS.md「迁移编号的唯一性纪律」）：
--   · 落库前已重查 `ls migrations/postgresql/`：主干占用 002/003/004/005/006/008/009/010，
--     007 预留给 compute-key-envelope-migration ⇒ 本文件用 **011**。
--   · 迁移按文件名字典序执行（postgres-migrations.js 的 sort(localeCompare)）⇒ 011 排在
--     004_member_commerce.sql（建 identity_orders）之后，外键/改列依赖满足。
--   · 台账按「完整文件名 + checksum」锁定 ⇒ 本文件一旦应用即不得再改内容。
--
-- ⚠ 必须与运行时 SCHEMA 成对：packages/api-publish-engine/src/auth/payment-promo-schema.js
--   （仅非生产 bootstrap 路径）。两处 DDL 逐字一致（忽略空白/注释），防漂移锁见
--   test/payment-promo-schema.test.js。

BEGIN;

-- ① 实收金额：先加可空列 → 回填 → 置 NOT NULL（三步，既有行不会被 NOT NULL 卡住）。
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS payable_cents INTEGER;
UPDATE identity_orders SET payable_cents = amount - COALESCE(discount_cents, 0) WHERE payable_cents IS NULL;
ALTER TABLE identity_orders ALTER COLUMN payable_cents SET NOT NULL;

-- ② 促销标识：仅「真正享受促销价」的订单写入；原价单为 NULL。
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS promotion_id TEXT;

-- ③ 计数查询的支撑索引（非唯一！见文件头「不建唯一索引」的理由）。
CREATE INDEX IF NOT EXISTS idx_identity_orders_promotion_user
    ON identity_orders (user_id, promotion_id) WHERE promotion_id IS NOT NULL;

COMMIT;
