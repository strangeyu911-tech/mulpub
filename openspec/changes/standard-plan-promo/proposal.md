---
change: standard-plan-promo
status: in-progress
created: 2026-10-27
branch: standard-plan-promo
---

# standard-plan-promo — 标准版月付「上市期半价」促销

## 1. 背景

标准版月付当前标价 ¥59（59 元/月，`plan-matrix.js` 的 `standard.priceMonthlyCents = 5900`），
年付 ¥590（`priceYearlyCents = 59000`，已符合「月付 × 10」的定价口径）。
上市期需要一个**有时限、有上限**的价格锚点：用三个月窗口把月付成交价压到 ¥29，
让「首月试水」的决策成本降到一顿饭钱以下，同时用「每人限 3 单」挡住囤积。

本变更只动**标准版 + 月付**一条 SKU。年付、专业版、免费版的价格与权益一律不动。

## 2. 目标（G1–G6）

- **G1**：促销窗口 `[2026-11-01T00:00:00+08:00, 2027-02-01T00:00:00+08:00)` 内，
  标准版月付实收 **2900 分**、标价仍记 **5900 分**、让利 **3000 分**。
- **G2**：金额判定收敛到**一个纯函数** `resolvePrice()`，下单与目录共用；
  前端零改价逻辑（`priceMonthlyCents` 保持"实收价"语义）。
- **G3**：**实收金额是传给微信的唯一金额**。`amount`（标价）与 `payable_cents`（实收）
  分离落库，根治「拿标价去收钱」这类多收 30 元的资损形态。
- **G4**：回调金额**必须校验**：`amountCents === order.payable_cents`，不等即
  `PAYMENT_AMOUNT_MISMATCH` 拒绝且不发权益（补上原 `void amountCents` 的缺口）。
- **G5**：限购 **3 单/人**：第 4 单起按原价 59；促销期内兑换码不可叠加
  （`REDEEM_DISABLED_DURING_PROMO`）。
- **G6**：展示与开关可运营：`PROMO_STANDARD_MONTHLY_ENABLED=1` 即开，
  改后重启生效；会员中心显示活动角标、剩余天数、结束前 7 天续费预告。

## 3. 非目标

- 不做首月优惠/首年优惠（促销形态是**固定时间窗内持续半价**，不是"仅首月"）。
- 不做 per-user 新老客判定（**全体一视同仁**，不查注册时间、不查历史付费）。
- 不做优惠券/折扣码叠加；不做自动续费、升降级 proration、自助退款。
- 不改年付价（59000）、不改专业版价（11900/119000）、不改积分额度。
- 不建「每用户唯一 paid 订单」索引（会挡正常续费，见 §5.2）。
- 不改 `CHANGELOG.md` / `01-docs/learnings.md`（由聚合器写入）。

## 4. 决策表（已定，不再变更）

| # | 项 | 值 |
|---|---|---|
| 1 | 促销形态 | 固定时间窗内持续半价（非首月） |
| 2 | 范围 | 仅 `standard` + `month` |
| 3 | 价格 | 标价 5900 分 → 实收 **2900** 分 |
| 4 | 年付 | 不动，维持 59000（已符合"月付 × 10"） |
| 5 | 人群 | **全体，一视同仁**（无 per-user 新老判定） |
| 6 | 囤积控制 | 促销期内同一用户累计最多 **3 单**促销价（第 4 次起按原价 59） |
| 7 | 展示 | 「¥29/月（上市期特惠 · 剩余 N 天）」，**不划线**、不展示原价 |
| 8 | 第 4 次起的 UI | 按钮直接显示「活动价已用完，¥59/月」，**下单前可见** |
| 9 | 账务 | `amount=5900`、`discount_cents=3000`、**新增 `payable_cents=2900`**（实收，传给微信的唯一金额） |
| 10 | 兑换码 | 促销期内不可叠加，提示 `REDEEM_DISABLED_DURING_PROMO` |
| 11 | 开关 | env `PROMO_STANDARD_MONTHLY_ENABLED`（0/1，改后重启生效） |
| 12 | 到期告知 | 结束前 7 天在会员中心显示「特惠将于 X 日结束，之后按 ¥59/月续费」 |
| 13 | 退款口径 | 按实付 **2900** 原路退 |

> 编号与 PRD §2 的决策表一一对应（PRD 用 D1–D13，本表用 1–13，语义逐字相同）。

## 5. 数据模型

### 5.1 `identity_orders` 新增列（迁移 `011_payment_promo.sql`）

| 列 | 类型 | 约束 | 语义 |
|---|---|---|---|
| `payable_cents` | `INTEGER` | `NOT NULL` | 实收金额（分）。**传给微信的唯一金额**；退款按它原路退 |
| `promotion_id` | `TEXT` | 可空 | 促销标识。**仅真正享受促销价的订单写入**；原价单为 `NULL` |

既有列在本变更中的语义（不改类型）：

| 列 | 语义 |
|---|---|
| `amount` | 标价（合同价/展示价）。促销单恒 5900 |
| `discount_cents` | 让利金额。促销单 3000，原价单 0（既有 `NOT NULL DEFAULT 0`，本次开始真正写入） |

**回填**：`UPDATE identity_orders SET payable_cents = amount - COALESCE(discount_cents, 0) WHERE payable_cents IS NULL;`
回填后才 `SET NOT NULL`（顺序不可换，否则存量行会让迁移中断）。

**索引**：`CREATE INDEX idx_identity_orders_promotion_user ON identity_orders (user_id, promotion_id) WHERE promotion_id IS NOT NULL;`
—— **非唯一**。唯一索引会把「同一用户第二次续费」挡成 23505。

### 5.2 为什么不建「每用户唯一 paid 订单」索引

会员是**可叠加续费**的：同一用户在一个促销期内买 3 个月是正常业务。唯一索引会：
- 让第 2 单直接 23505（表现为「老用户无法续费」）；
- 把「限购」这件业务规则硬编码进 schema，改上限就要改索引（DDL 不可事务化回滚）。

限购改为**服务层计数 + 对账可见**（`promo-order-amount-mismatch` + PRD §9 的并发残留风险）。

## 6. 契约

### 6.1 纯函数：`packages/api-publish-engine/src/auth/promo-resolver.js`

```js
resolvePrice({ plan, period, now, config, promoPurchaseCount })
  → { listPriceCents, payableCents, discountCents, promotion }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `listPriceCents` | number | 标价（由调用方从 plan-matrix 注入，promo-resolver 不反向依赖价格表） |
| `payableCents` | number | 实收。促销生效且未超额 = 2900；否则 = 标价 |
| `discountCents` | number | `listPriceCents - payableCents`（原价时为 0） |
| `promotion` | `null \| {id, endsAt, remainingDays, exhausted}` | 无促销为 `null` |

判定顺序（**不可换**）：开关 → 时间窗 `[startsAt, endsAt)` → plan/period → `promoPurchaseCount < 3`。

配置非法（`endsAt <= startsAt`、`priceCents <= 0`、`priceCents >= listPriceCents`、
时间戳不可解析、`maxPurchasesPerUser` 非正整数）一律抛 `PROMO_CONFIG_INVALID`（status 500），
**不得静默回退**。

### 6.2 目录：`getPlanCatalog(overrides, options)`

新增/变更字段：

| 字段 | 语义 |
|---|---|
| `priceMonthlyCents` | **实收价**（保持既有语义，前端零改动） |
| `listPriceMonthlyCents` | 标价（仅用于「已用完」文案与服务端校验；前端不划线展示） |
| `promotion` | 同 6.1；非标准版/非月付恒 `null` |

`options = { now, promoConfig, promoPurchaseCount }`。未传 `promoConfig` 时行为与变更前逐字一致。

### 6.3 订单账务三列

| 字段 | 促销单 | 原价单 | 年付/专业版 |
|---|---|---|---|
| `amount` | 5900 | 5900 | 59000 / 11900 |
| `discount_cents` | 3000 | 0 | 0 |
| `payable_cents` | 2900 | 5900 | 同 amount |
| `promotion_id` | `standard-monthly-half` | `NULL` | `NULL` |

### 6.4 结算校验

`settlePaymentWebhook` 在进入事务前校验：
`Number.isInteger(amountCents) && amountCents === order.payable_cents`，
否则抛 `PAYMENT_AMOUNT_MISMATCH`（409），**不发权益、订单保持 pending**。

## 7. 流程

```
① 用户打开会员中心
   GET /api/v1/plans
     → getPlanCatalog({ now, promoConfig, promoPurchaseCount })
     → 标准版: priceMonthlyCents=2900, listPriceMonthlyCents=5900,
               promotion={remainingDays, exhausted}
② 点击购买
   POST /api/v1/me/checkout { plan:'standard', period:'month' }
     → countPromoPurchases(userId) → resolvePrice()
     → createPendingOrder(amount=5900, discount_cents=3000, payable_cents=2900, promotion_id=...)
     → provider.createCheckout({ amountCents: 2900 })     ← 实收，不是标价
③ 扫码支付
   微信回调 POST /api/v1/webhooks/payment
     → 验签 → parseWebhook → amountCents=2900
④ 结算
   settlePaymentWebhook
     → amountCents === order.payable_cents ? 继续 : PAYMENT_AMOUNT_MISMATCH
     → markOrderPaid → applySubscription(order.amount=5900) → 通知
⑤ 续期
   用户再次下单 → 计数（0/1/2 → 促销价；≥3 → 原价）
   到期前 7 天会员中心提示「之后按 ¥59/月续费」
```

## 8. 边界表（摘要，完整 14 条见 PRD §7）

| 场景 | 期望 |
|---|---|
| 活动开始前 1 秒 / 结束后 1 毫秒 | 原价 5900，`promotion=null` |
| 跨窗口下单、窗口结束后才付款 | 订单按**下单时**锁定的 2900 收；回调校验通过、正常发放（不追溯补差价） |
| 提前续费 | 允许；促销期内按促销价，`applySubscription` 顺延时长 |
| 第 4 次购买 | 原价 5900；按钮显示「活动价已用完，¥59/月」 |
| 并发下单 | 以下单时点计数为准，极端并发可能多出一单促销价（已知残留风险，见 §9） |
| 年付 | 59000 不变，无 `promotion` |
| 兑换码 | 促销期内 409 `REDEEM_DISABLED_DURING_PROMO` |
| 未登录 | 目录按 count=0 展示（不显示"已用完"），下单 503 |
| 退款 | 按 `payable_cents=2900` 原路退 |
| 时区 | 窗口用 `+08:00` 绝对时刻；`remainingDays` 按 UTC 毫秒差向上取整 |
| 活动到期文案 | 窗口外 `promotion=null`，不显示"已用完"；最后 7 天显示续费预告 |
| 回调金额不符 | `PAYMENT_AMOUNT_MISMATCH`，不发权益 |
| 促销配置非法 | `PROMO_CONFIG_INVALID`（启动/预检期即失败） |
| `payable_cents` 缺失（迁移未跑） | 读取即 SQL 错误 → 500（fail-closed，不静默按 amount 收） |

## 9. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| **并发下单绕过限购** | 最多 N 个并发会话各多拿一单促销价 | 前端单弹窗串行；对账可发现；后续可用 `pg_advisory_xact_lock(user_id)` 收敛（本期不做，避免给支付主链路加锁） |
| 运营改价把标价压到 ≤2900 | 启动即 `PROMO_CONFIG_INVALID` | 装配期 fail-fast + preflight 自检 |
| 迁移未落库 | 所有订单 INSERT 23502 | 迁移与应用同批部署（AGENTS 硬纪律）；`assertReady` fail-closed |
| 微信实收与订单不符 | 多收/少收 | 回调强制校验 + `promo-order-amount-mismatch` 对账 |
| 促销被误开 | 全站月付半价 | env 开关 fail-closed（只有 `"1"` 才开） |
| **回滚** | —— | ①`PROMO_STANDARD_MONTHLY_ENABLED=0` + 重启（立即停止新促销单，**存量促销单不受影响**）；②回滚代码版本（三列向后兼容，旧代码不读 `payable_cents`，但**新订单会因 NOT NULL 失败** ⇒ 回滚代码前必须先关促销，或保留一个默认值补丁）；③**不回滚已发放的权益**（用户已付钱） |

## 10. 影响面

| 层 | 文件 |
|---|---|
| 定价 | `src/auth/promo-resolver.js`（新）、`src/auth/plan-matrix.js` |
| 账务 | `src/auth/subscription-payment.js`、`src/auth/payment-order-store.js`（新）、`src/auth/postgres-commerce-store.js` |
| 迁移 | `migrations/postgresql/011_payment_promo.sql`（新）、`src/auth/payment-promo-schema.js`（新）、`src/auth/postgres-identity-repository.js` |
| 服务装配 | `src/auth/logto-runtime.js`、`src/auth/subscription-service.js`、`src/publish-api-server.js` |
| 运维 | `scripts/payment-preflight.js`、`scripts/payment-reconcile.js` |
| 前端 | `apps/desktop/src/views/member-center/{Subscription.vue,PlanPriceTag.vue,labels.js}`、`locales/member-center/{zh,en}.js` |
| 文档 | `01-docs/PRD-STANDARD-PLAN-PROMO-2026-10-27.md`、本文件、`openspec/records/standard-plan-promo.md` |
