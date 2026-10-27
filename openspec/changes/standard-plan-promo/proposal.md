---
change: standard-plan-promo
status: in-progress
created: 2026-10-27
branch: standard-plan-promo
---

# standard-plan-promo — 标准版月付「上市期半价」促销

> ⚠️ **本文件经历两次修订，现行版本是 §12（v1.2）**：
> §11 的「年付随月付浮动 + 删除限购」已被**推翻**；§4 决策表中的 D2 / D4 / D6 / D8 与
> §6.1 的 `promoPurchaseCount` / `exhausted`、§6.2 的 `promotion` 形状、§7 的「第 4 次购买」
> 均**恢复**到 v1.0 语义。现行契约以 §12 与
> `01-docs/PRD-STANDARD-PLAN-PROMO-2026-10-27.md`（v1.2）为准。
> 保留 §4 / §11 是为了留下「初版为什么这么做」「v1.1 为什么改错」的可追溯记录。

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

---

## 11. 修订记录 2026-10-27（promo-yearly-rule）

**触发**：初版上线后暴露套利 —— 促销期月付 29×12=348 < 年付 590，理性用户会囤月付。
根因不是「限购不够严」，而是**定价不变量（年付 = 月付 × 10）被破坏**：只降月付、年付锁死，
两者从 10 倍关系变成 20 倍关系，套利空间由定价规则自己制造。

| # | 初版（已推翻） | 修订版（现行） |
|---|---|---|
| D2 | 仅 `standard` + `month` | `standard` 的 **month 与 year**（年付跟随月付，不是独立活动） |
| D3 | 标价 5900 → 实收 2900 | 不变（月付实收 2900） |
| D4 | 年付不动，维持 59000 | **年付实收 = 月付实收 × 10 = 29000**；标价仍 59000 |
| D6 | 每人最多 3 单促销价 | **删除**：无 per-user 计数、无 `maxPurchasesPerUser`、无计数 SQL |
| D8 | 第 4 次起按钮显示「活动价已用完，¥59/月」 | **删除**：按钮恒为「购买」；`promotion` 不再含 `exhausted` |
| §6.1 | `resolvePrice({ plan, period, now, config, promoPurchaseCount })` | `resolvePrice({ plan, period, now, config })` —— **纯函数，无 per-user 入参** |
| §6.2 | `promotion: { id, endsAt, remainingDays, exhausted }` | `promotion: { id, endsAt, remainingDays }`；目录新增 `listPriceYearlyCents`，`priceYearlyCents` 改为**实收**语义 |
| §7 | 「第 4 次购买 → 原价」 | 「年付在促销期购买 → 29000」「同一用户连续下单全按促销价」 |

**为什么取消限购而不是把上限调大**：

- 限购是**症状补丁**：它把「年付定价错」的后果（囤月付）转成「每人最多囤 3 个月」，
  套利窗口仍在（3 单仍赚 3×242 元的等效价值差），却引入一整套 per-user 状态。
- 修不变量后套利算术直接归零（348 > 290），限购失去存在理由。
- 单客让利上限并未放大：年付一单让利 300 元 < 12 次月付的 360 元；换到的是 12 个月留存。

**删除 per-user 状态带来的简化**（逐项，均已落地）：

1. `promo-resolver.js`：删 `promoPurchaseCount` 入参、计数分支、`maxPurchasesPerUser` 校验与装配。
2. `plan-matrix.js`：`getPlanCatalog` 删 `promoPurchaseCount` 选项；`catalogMonthlyPricing` → `catalogPricing(period)`。
3. `subscription-payment.js`：删 `_promoPurchaseCount` 与 `countPromoPurchases` 调用；`promotionId` 不再按 `exhausted` 过滤。
4. `payment-order-store.js`：删 `countPromoPurchases`（`SELECT count(*) ...`）。
5. `publish-api-commerce.js`：`/api/v1/plans` 不再按用户查计数（同一份目录给所有人）。
6. 前端：删 `exhausted` 分支、「活动价已用完，¥59/月」文案与 `promoBuyCtaOf`；保留角标。
7. locales：`memberCenter.planPromoExhausted` **保留不删**（i18n 成对与门禁只关注孤儿新增），只是不再渲染。

**契约不变量（现行）**：

```js
resolvePrice({ plan, period, now, config })
  → { listPriceCents, payableCents, discountCents, promotion }
// period==='year' ⇒ payableCents === (period==='month' 的 payableCents) × 10
// promotion === null || { id, endsAt, remainingDays }
```

**测试与取证**：`openspec/records/promo-yearly-rule.md`（含变异反证逐条结果）。
**PRD 同步**：`01-docs/PRD-STANDARD-PLAN-PROMO-2026-10-27.md` v1.1 §11「定价不变量与为什么取消限购」。

---

## 12. 二次修订记录 2026-10-27（v1.2：恢复限购 3 次，年付回到原价）

**触发**：v1.1 的推理被用户否决。v1.1 认为「年付 = 月付 × 10」是必须无条件成立的定价不变量，
因此把年付跟着月付降到 29000 并删掉限购。**这个推理错在把限购从等式里删掉了**：

- 限购 3 次本身就把月付促销的单客让利封顶在 **3 × 29 = 87 元 / 3 个月**，
  而 12 个月 × 29 = 348 元的年付**根本买不到** —— 套利路径不存在，不需要靠年付降价去堵；
- 反过来，年付一旦参与促销，「最多 3 次」的限购会变成 **3 次 × 1 年 = 3 年 870 元**
  （原价 3 年 1770 元），让利从 **90 元放大到 900 元**（10 倍）。
  计数式限购的计量单位是「次」，年付一次是 12 个月，**两者量纲不匹配，数学上不能共存**。

**修订历史（三阶段）**：

| 阶段 | 语义 | 结论 |
|---|---|---|
| v1.0（初版） | 月付 2900 + 限购 3 单；年付 59000 | 正确 |
| v1.1（本文件 §11） | 年付 = 月付实收 × 10（29000）+ 删除限购 | **错误**：把「限购已封顶」漏出等式 |
| v1.2（本节） | 恢复 v1.0 语义，保留归一化缺陷修复 | 现行 |

**逐项回滚（与 §11 的七条一一对应）**：

| # | §11 的删除动作 | v1.2 恢复 |
|---|---|---|
| 1 | 删 `promoPurchaseCount` 入参、计数分支、`maxPurchasesPerUser` | 全部恢复；`resolvePrice({ plan, period, now, config, promoPurchaseCount })`，`promotion` 带回 `exhausted` |
| 2 | `getPlanCatalog` 删 `promoPurchaseCount`；`catalogPricing(period)` | 恢复 per-user 计数（目录要能**下单前**显示「已用完」）；`priceYearlyCents` 回到静态 59000 |
| 3 | 删 `_promoPurchaseCount` 调用；`promotionId` 不再按 `exhausted` 过滤 | 恢复计数查询与 `exhausted` 过滤（原价单不得占额度） |
| 4 | 删 `countPromoPurchases`（`SELECT count(*) ...`） | 恢复 `count(*) from identity_orders where user_id=$1 and promotion_id is not null and status='paid'` |
| 5 | `/api/v1/plans` 不再按用户查计数 | 恢复按登录用户查计数（未登录按 0 单） |
| 6 | 删 `exhausted` 分支与「活动价已用完，¥59/月」 | 恢复 `promoBuyCtaOf` 与 `PlanPriceTag` 的 `exhausted === false` 角标条件 |
| 7 | locales 的 `planPromoExhausted` 保留不渲染 | 重新渲染（文案本身没有变过） |

**保留项（不回滚）**：`apps/desktop/electron/services/identity/entitlement-service.js` 与
`apps/desktop/src/stores/identity.js` 的归一化修复 —— `promotion` / `listPrice*Cents` 原先在两次归一化里
被丢弃，导致促销角标与续费预告在真实链路永不出现（单测因为直接塞 store 而全绿）。这是**真实缺陷修复**，
与限购语义无关，必须保留；对应测试也保留。

**契约（v1.2 现行）**：

```js
resolvePrice({ plan, period, now, config, promoPurchaseCount })
  → { listPriceCents, payableCents, discountCents, promotion }
// period==='year' ⇒ payableCents === listPriceCents === priceYearlyCents（恒 59000，promotion === null）
// period==='month' ∧ plan==='standard' ∧ 窗口内 ∧ count < maxPurchasesPerUser
//   ⇒ payableCents === priceCents（2900）、promotion.exhausted === false
// count >= maxPurchasesPerUser ⇒ payableCents === listPriceCents（5900）、promotion.exhausted === true
```

**测试与取证**：`openspec/records/promo-yearly-rule.md` §10（含三组必须红的变异反证）。
**PRD 同步**：`01-docs/PRD-STANDARD-PLAN-PROMO-2026-10-27.md` v1.2 §12。

---

## 13. 三次修订记录 2026-10-27（v1.3：会员期限护栏 + 促销额度预占）

**触发**：v1.2 的限购只在「已支付」口径下成立，仍有两个结构性缺口：

1. **多开窗口**：定价在下单时固化，计数只数 `status='paid'` ⇒ 5 个窗口各下一个 pending，
   5 单都按 2900 定价，逐一支付后拿到 5 个月促销价。
2. **期限无上限**：`applySubscription` 只校验 `durationDays > 0`，兑换码/后台授予可把
   `current_period_end` 叠到任意远；支付路径也可被反复续费叠出超长有效期。

**修订内容**：

| # | 项 | v1.2 | v1.3（现行） |
|---|---|---|---|
| 1 | 会员期限 | 无上限 | 新增 `MAX_SUBSCRIPTION_HORIZON_DAYS = 1095`（= 3 × 365，按天计、跨闰年差 1 天）；`prospectiveEnd = max(现有 current_period_end, now) + durationDays > now + 1095 天` ⇒ 409 `SUBSCRIPTION_HORIZON_EXCEEDED` |
| 2 | 护栏层级 | 仅 checkout 定价 | **两层都拦**：`createCheckout` 预检（付款前、不生成二维码）+ `PostgresCommerceTransaction.applySubscription` 兜底（兑换码/后台授予/支付回调） |
| 3 | 促销额度 | 只数 `status='paid'` | 额度 = paid **+** `pending` 且 `created_at` 在 30 分钟内；pending 过期自动释放 |
| 4 | 并发控制 | 无（已知残留风险） | 下单路径同一事务内 `pg_advisory_xact_lock('promo:<userId>')` → 计数 → 定价 → INSERT pending；第 4 个并发请求必然看到前 3 个 |
| 5 | 结算兜底 | 不适用 | 竞态导致已支付促销单超限时**仍然结算**（钱已收），记 `PROMO_QUOTA_OVERSOLD` 异常日志 + 事件 result 可对账字段；`payment-reconcile` 新增 `promo-quota-oversold` |
| 6 | 前端 | 仅售罄文案 | 新增 `memberCenter.payHorizonExceeded`（购买被 409 拒绝时展示具体原因）与 `memberCenter.redeemErrHorizon`（兑换被同一护栏拒绝） |

**为什么 30 分钟**：现有代码里唯一成文的 pending 超时是支付弹窗的 30 分钟硬上限
（`WeChatPayDialog.vue:87-89`，与 PRD-WECHAT-PAY §7.3 / §6.1 同源）；服务端没有 pending
置 failed 的定时任务。本修订**不新增支付状态机**，只把同一口径用于额度滑窗。

**已知残留风险**：30 分钟释放后微信二维码通常 2 小时内仍可支付 ⇒ 旧 pending 晚到支付可能造成
「已支付 > 3」。本期由结算兜底与对账暴露，不拒付（详见 PRD §9.3 / §14）。

**契约（v1.3 新增）**：

```js
// 共享模块 packages/api-publish-engine/src/auth/subscription-horizon.js
assertWithinSubscriptionHorizon({ currentPeriodEnd, now, durationDays })
  → { base, periodEnd, limit }                    // 超限抛 409 SUBSCRIPTION_HORIZON_EXCEEDED
// 仓储：countPromoPurchases(userId, { now, includePending=true })
//       createPendingOrderWithPromoQuota({ userId, now, resolvePendingOrder })
```

**测试与取证**：`openspec/records/promo-yearly-rule.md` §11（含 A/B 两类变异反证）。
**PRD 同步**：`01-docs/PRD-STANDARD-PLAN-PROMO-2026-10-27.md` v1.3 §13 / §14。
