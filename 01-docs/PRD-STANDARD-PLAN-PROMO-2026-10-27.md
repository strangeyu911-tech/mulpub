# PRD — 标准版月付「上市期半价」促销（2026-10-27）

| 项 | 值 |
|---|---|
| 文档版本 | v1.0 |
| 状态 | 已定稿（决策已锁定，见 §2） |
| 负责人 | 产品 / 支付 |
| 关联 change | `openspec/changes/standard-plan-promo/proposal.md` |
| 关联迁移 | `migrations/postgresql/011_payment_promo.sql` |
| 关联记录 | `openspec/records/standard-plan-promo.md` |
| 适用版本 | `PLAN_MATRIX_VERSION = 2026-10-26` 起 |

---

## 1. 目标与非目标

### 1.1 目标

1. 上市期三个月内，把标准版**月付**成交价从 ¥59 压到 **¥29**，降低首购决策成本。
2. 让「促销价」成为**服务端唯一可判定**的事实：前端只渲染服务端下发的字段，不参与任何金额计算。
3. 把「标价 / 让利 / 实收」三个金额同时落库，使退款、对账、客服三方能对上同一笔钱。
4. 用每人 **3 单**的硬上限挡住囤积，同时**不牺牲正常续费**（不建唯一索引）。

### 1.2 非目标

- 不做首月优惠、不做阶梯折扣、不做优惠券叠加。
- 不做新老客差异定价（全体一视同仁）。
- 不动年付（59000）、专业版（11900/119000）、免费版、积分额度。
- 不做自动续费/升降级 proration/自助退款。

---

## 2. 决策表（D1–D13，已定稿）

| ID | 项 | 值 |
|---|---|---|
| D1 | 促销形态 | 固定时间窗内持续半价（**非首月**） |
| D2 | 范围 | 仅 `standard` + `month` |
| D3 | 价格 | 标价 5900 分 → 实收 **2900** 分 |
| D4 | 年付 | 不动，维持 59000（已符合"月付 × 10"） |
| D5 | 人群 | **全体，一视同仁**（无 per-user 新老判定） |
| D6 | 囤积控制 | 促销期内同一用户累计最多 **3 单**促销价（第 4 次起按原价 59） |
| D7 | 展示 | 「¥29/月（上市期特惠 · 剩余 N 天）」，**不划线**、不展示原价 |
| D8 | 第 4 次起的 UI | 按钮直接显示「活动价已用完，¥59/月」，**下单前可见** |
| D9 | 账务 | `amount=5900`、`discount_cents=3000`、`payable_cents=2900`（实收，传给微信的唯一金额） |
| D10 | 兑换码 | 促销期内不可叠加，提示 `REDEEM_DISABLED_DURING_PROMO` |
| D11 | 开关 | env `PROMO_STANDARD_MONTHLY_ENABLED`（0/1，改后重启生效） |
| D12 | 到期告知 | 结束前 7 天在会员中心显示「特惠将于 X 日结束，之后按 ¥59/月续费」 |
| D13 | 退款口径 | 按实付 **2900** 原路退 |

---

## 3. 数据校验（逐字段）

### 3.1 促销配置（env → `promo-resolver.loadStandardMonthlyPromoConfig`）

| 字段 | 来源 | 类型/范围 | 非法时的行为 |
|---|---|---|---|
| `enabled` | `PROMO_STANDARD_MONTHLY_ENABLED` | 字符串 `"1"` 为开；其它任何值（含 `"true"`、`"0"`、空）为关 | 不报错（fail-closed 视为关闭） |
| `priceCents` | `PROMO_STANDARD_MONTHLY_PRICE_CENTS`（默认 `2900`） | 正整数；必须 `< listPriceCents` | 抛 `PROMO_CONFIG_INVALID`（启动/预检失败） |
| `startsAt` | `PROMO_STANDARD_MONTHLY_STARTS_AT`（默认 `2026-11-01T00:00:00+08:00`） | 可解析时间戳 | 抛 `PROMO_CONFIG_INVALID` |
| `endsAt` | `PROMO_STANDARD_MONTHLY_ENDS_AT`（默认 `2027-02-01T00:00:00+08:00`） | 可解析时间戳，且 `> startsAt` | 抛 `PROMO_CONFIG_INVALID` |
| `maxPurchasesPerUser` | `PROMO_STANDARD_MONTHLY_MAX_PURCHASES`（默认 `3`） | 正整数 | 抛 `PROMO_CONFIG_INVALID` |
| `listPriceCents` | 由 `plan-matrix` 注入（`standard.priceMonthlyCents`，含运营 overrides） | 非负整数；`> 0` 时必须 `> priceCents` | 抛 `PROMO_CONFIG_INVALID` |

> **禁止静默回退**：任何一条非法都必须让启动/预检炸掉。回退到原价的后果是「活动上线了但一分没便宜」，
> 这类故障在日志与监控里完全不可见。

### 3.2 询价入参（`resolvePrice`）

| 字段 | 校验 | 非法行为 |
|---|---|---|
| `plan` | 非空字符串 | 抛 `PROMO_CONFIG_INVALID`（编程错误） |
| `period` | 非空字符串（本次仅 `month` 参与促销） | 不参与促销，返回原价 |
| `now` | Date / 时间戳字符串 / 数字 | 抛 `PROMO_CONFIG_INVALID` |
| `config` | 普通对象 | 抛 `PROMO_CONFIG_INVALID` |
| `promoPurchaseCount` | 非负整数 | 抛 `PROMO_CONFIG_INVALID` |

### 3.3 订单落库三列

| 字段 | 促销单 | 原价单 | 年付 | 校验 |
|---|---|---|---|---|
| `amount` | 5900 | 5900 | 59000 | `>= 0` 整数（DB CHECK 已存在） |
| `discount_cents` | 3000 | 0 | 0 | `NOT NULL DEFAULT 0` |
| `payable_cents` | 2900 | 5900 | 59000 | `NOT NULL`；回填 = `amount - COALESCE(discount_cents,0)` |
| `promotion_id` | `standard-monthly-half` | `NULL` | `NULL` | 可空 TEXT |

### 3.4 回调金额

| 输入 | 校验 | 结果 |
|---|---|---|
| `amountCents` 为整数且 `=== order.payable_cents` | 通过 | 进入结算事务 |
| `amountCents` 为整数但不等 | 拒绝 | `PAYMENT_AMOUNT_MISMATCH`（409），不发权益 |
| `amountCents` 缺失/非整数 | 拒绝 | 同上（不可验证 = 不可信任） |

---

## 4. 完整流程

### 4.1 下单（`createCheckout`）

```
POST /api/v1/me/checkout { plan:'standard', period:'month' }
  ① requireUser(userId)                     → 未登录 503 BUSINESS_USER_REQUIRED
  ② plan/period 白名单                       → free/非法档 400
  ③ paymentProvider 存在性                   → 缺失 503 PAYMENT_PROVIDER_UNAVAILABLE
  ④ 复用 pending?（带 orderId）              → 走 _reusePendingOrder（按落库 payable_cents 取码）
  ⑤ countPromoPurchases(userId)             → 0/1/2 → 促销价；≥3 → 原价
  ⑥ resolvePrice()                          → 唯一金额判定点
  ⑦ createPendingOrder(amount, discount_cents, payable_cents, promotion_id)
  ⑧ provider.createCheckout({ amountCents: payableCents })   ← 实收
```

**为什么先落单再调供应商**：反过来的话，供应商下单成功而落库失败会得到「用户手机里有一张可扫的
付款码，我们账上什么都没有」——回调到达时无从归属，既不能授权也不能对账。先落单最坏留一条 pending。

### 4.2 支付

用户在微信内扫码支付。微信侧记录 `out_trade_no = 订单号`，金额 = 我们传入的 `amountCents`（实收）。

### 4.3 回调（`POST /api/v1/webhooks/payment`）

```
① provider.parseWebhook(rawBody, headers)   → 验签失败 401，不落任何账
② 非 checkout.completed                     → ignored:true，不抛错（防重投风暴）
③ getOrderById(orderId)                     → 不存在 409 PAYMENT_ORDER_NOT_FOUND
④ channel !== 'payment'                     → 409 PAYMENT_ORDER_CHANNEL_MISMATCH
⑤ amountCents === order.payable_cents ?     → 不等 409 PAYMENT_AMOUNT_MISMATCH
⑥ commerceTransaction:
     claimPaymentEvent（幂等键 = 订单号）    → 已处理则短路 duplicate:true
     markOrderPaid（pending → paid 条件更新）
     applySubscription({ amount: order.amount, providerReference:'wechat:<id>' })
     createNotification('支付成功')
     completePaymentEvent
```

### 4.4 结算

结算**不复制** `applySubscription` 的任何一行：advisory lock / 跨档压制 / 快照同源 / 三连写原子性
全在 `postgres-commerce-store.js`。支付路径只负责「找订单 → 标记 paid → 调用」。

### 4.5 续期

- 续期 = 重新下一单（本产品无自动续费）。
- 促销期内、未满 3 单 → 仍按 2900；满 3 单 → 5900。
- 距活动结束 ≤7 天且用户仍在促销状态 → 会员中心显示续费预告。
- 活动结束后新订单按 5900；**已下的促销单不受影响**（金额在下单时已锁定）。

---

## 5. 功能逻辑

| 功能 | 规则 |
|---|---|
| 定价判定 | 开关 → 时间窗 `[startsAt, endsAt)` → `plan==='standard' && period==='month'` → `count < 3` |
| 限额计数 | `SELECT count(*) FROM identity_orders WHERE user_id=$1 AND promotion_id IS NOT NULL AND status='paid'` |
| 目录下发 | `priceMonthlyCents` = 实收；`listPriceMonthlyCents` = 标价；`promotion` 仅标准版月付非空 |
| 兑换码 | `promoActive()` 为真 ⇒ `REDEEM_DISABLED_DURING_PROMO`（409），在触达仓储之前拒绝 |
| 开关 | `PROMO_STANDARD_MONTHLY_ENABLED`，装配期读取一次；改后必须重启 |
| 配置自检 | `payment-preflight.js` 的 `promo-config` 项：未开 SKIP / 合法 PASS / 非法 FAIL |
| 对账 | `payment-reconcile.js` 的 INFO `promo-order-amount-mismatch`：`payable_cents <> amount - COALESCE(discount_cents,0)` |

---

## 6. 交互逻辑与显示项

### 6.1 交互逻辑

| 状态 | 用户看到 | 可执行动作 |
|---|---|---|
| 促销生效、未超额 | 标准版卡片：`¥29 / 月（上市期特惠 · 剩余 N 天）` + 年付 `¥590 / 年` + 「购买」 | 点击整卡 → 支付弹窗 |
| 促销生效、已超额（第 4 单起） | 标准版卡片：`¥59 / 月` + 年付 `¥590 / 年` + 按钮「活动价已用完，¥59/月」 | 仍可购买（按原价） |
| 活动未开始 / 已结束 | 标准版卡片：`¥59 / 月` + 年付 `¥590 / 年` + 「购买**」 | 按原价购买 |
| 距结束 ≤7 天（未超额） | 价目区底部追加一行「特惠将于 X 日结束，之后按 ¥59/月续费」 | 无（纯提示） |
| 未登录 | 价格与角标照常展示（count 按 0），卡片不可购买 | 需先登录 |
| 兑换码输入 | 促销期内提交 → 错误提示（映射 `REDEEM_DISABLED_DURING_PROMO`） | 无法兑换 |

### 6.2 显示项（字段 → 展示）

| 显示项 | 数据来源 | 格式 |
|---|---|---|
| 月付价 | `plan.priceMonthlyCents`（实收） | `¥29` / `¥59` |
| 活动角标 | `plan.promotion.remainingDays` | `（上市期特惠 · 剩余 42 天）` |
| 年付价 | `plan.priceYearlyCents` | `¥590 / 年` |
| 「已用完」按钮 | `plan.promotion.exhausted` + `plan.listPriceMonthlyCents` | `活动价已用完，¥59/月` |
| 续费预告 | `plan.promotion.endsAt` + `listPriceMonthlyCents` | `特惠将于 2027/1/31 结束，之后按 ¥59/月续费` |

**不展示**：划线原价、折扣百分比、「原价 ¥59」这类对比文案（决策 D7）。

### 6.3 提示文字（zh / en 原文）

| key | zh | en |
|---|---|---|
| `memberCenter.planPromoBadge` | `上市期特惠 · 剩余 {days} 天` | `Launch offer · {days} days left` |
| `memberCenter.planPromoExhausted` | `活动价已用完，{price}/月` | `Offer used up — {price}/month` |
| `memberCenter.promoEndingSoon` | `特惠将于 {date} 结束，之后按 {price}/月续费` | `The launch offer ends on {date}; renewals after that are {price}/month` |
| 服务端 `REDEEM_DISABLED_DURING_PROMO` | `上市期特惠进行中，兑换码暂不可叠加使用` | （服务端错误码；客户端映射到 `redeemErr*`） |
| 服务端 `PAYMENT_AMOUNT_MISMATCH` | `回调金额 {x} 与订单实收 {y} 不一致` | 同上 |

> 前端渲染的完整句子：`¥29 / 月（上市期特惠 · 剩余 42 天） · ¥590 / 年`。
> 括号由组件提供，locale 串内不含括号 —— 保证 en 下也是 `$29 / month (Launch offer · 42 days left)` 的同一形状。

---

## 7. 边界场景表（14 条）

| # | 场景 | 期望行为 | 判据 |
|---|---|---|---|
| 1 | 活动开始前 1 秒下单 | 原价 5900，`promotion=null`，无角标 | `promo-resolver.test.js` 窗口边界 |
| 2 | 活动结束时刻（`endsAt`）下单 | 原价，`promotion=null`（不是 exhausted） | 同上 |
| 3 | 活动结束前 1 毫秒下单 | 2900，`remainingDays=1` | 同上 |
| 4 | 跨窗口：活动内下单、活动后才付款 | 按**下单时**锁定的 2900 结算；回调 2900 通过；正常发放 | `subscription-payment-promo.test.js` |
| 5 | 提前续费（有效期未到再买） | 允许；促销期内且未满 3 单按 2900；`applySubscription` 顺延 | `subscription-payment.test.js` 跨档/续叠 |
| 6 | 第 4 次购买 | 原价 5900，`promotion_id=null`，按钮显示「活动价已用完」 | `plan-catalog-promo` + `subscription-payment-promo` |
| 7 | 并发下单（两台设备） | 以下单时点计数为准；极端并发可能多出一单促销价（已知残留风险 §9） | PRD §9 + 对账 INFO |
| 8 | 年付购买 | 59000，无 promotion，无折扣 | `promo-resolver` plan/period 过滤 |
| 9 | 促销期兑换码 | 409 `REDEEM_DISABLED_DURING_PROMO`，且不查码 | `promo-redeem-guard.test.js` |
| 10 | 未登录访问目录 | 按 count=0 展示，不出现「已用完」；下单 503 | `publish-api-server` 路由 + 前端 |
| 11 | 退款 | 按 `payable_cents=2900` 原路退（不按 amount 5900） | PRD D13 + 对账 hint |
| 12 | 时区 | 窗口用 `+08:00` 绝对时刻；`remainingDays` 按 UTC 毫秒差 `ceil` | `promo-resolver` 边界用例 |
| 13 | 活动到期文案 | 窗口外 `promotion=null`；最后 7 天显示「特惠将于 X 日结束…」 | 前端 `Subscription.promo.test.js` |
| 14 | 回调金额与订单不符（5900 vs 2900） | `PAYMENT_AMOUNT_MISMATCH`，不发权益，订单保持 pending | `subscription-payment-promo.test.js` |

补充（同属边界，单独列出以免与上表混淆）：

| # | 场景 | 期望 |
|---|---|---|
| 15 | 促销配置 `price >= listPrice` | 启动/预检 `PROMO_CONFIG_INVALID`，不静默原价 |
| 16 | 迁移未跑（缺 `payable_cents`） | 订单读写直接 SQL 错误 → 500（fail-closed） |
| 17 | 运营 overrides 把标准版标价改到 4900 | 促销配置 `listPriceCents` 跟随 4900；`payable` 仍 2900 |
| 18 | 已购 3 单后活动结束 | `promotion=null`（不再显示「已用完」），按原价 |

---

## 8. 测试矩阵

| 层 | 文件 | 覆盖 |
|---|---|---|
| 纯函数 | `test/promo-resolver.test.js`（29 例） | 窗口前 1 秒/起点/最后 1 毫秒/结束点、plan/period 过滤、开关、计数 0/2/3/4、配置非法 5 类、env 装配 6 例 |
| 目录契约 | `test/plan-catalog-promo.test.js`（6 例） | `priceMonthlyCents` 实收语义、`listPriceMonthlyCents`、`promotion`、年付不动、overrides 联动 |
| 账务 | `test/subscription-payment-promo.test.js`（9 例） | 三列落库、provider 收 2900、第 4 单原价、年付、继续支付、结算 2900/5900/缺失、非促销单 |
| 既有回归 | `test/subscription-payment.test.js` | 金额真源、幂等、跨档压制、复用 applySubscription；金额不符用例已反转为拒绝 |
| 兑换码 | `test/promo-redeem-guard.test.js`（5 例） | 窗口内 409、窗口外/关开关/无配置不拦截 |
| 迁移 | `test/payment-promo-schema.test.js`（5 例） | DDL 逐条一致、三步顺序、无 UNIQUE 索引 |
| 运维 | `test/payment-promo-ops.test.js`（8 例） | preflight PASS/SKIP/FAIL + 早退分支；reconcile INFO 判据 |
| 前端 | `apps/desktop/src/views/member-center/Subscription.promo.test.js`（6 例） | 角标/剩余天数、不划线、售罄按钮、续费预告、无硬编码 2900 |

**变异反证**：每条新判据都做过「改坏实现 → 测试必须红 → 还原 → 绿」，结果记录在
`openspec/records/standard-plan-promo.md` §5。

---

## 9. 已知残留风险

1. **并发下单可超额**：限购是「下单时点计数」，两个请求同时读到 count=2 会各自生成一单促销价。
   本期不做 `pg_advisory_xact_lock`（会给支付主链路加锁），由对账与人工兜底。
2. **`promotion_id` 与支付回调的时序**：若订单在促销窗口内创建、窗口结束后才支付，仍按促销价结算
   （金额已锁定）——这是**有意**的，不是 bug。
3. **前端未做「活动结束倒计时」实时刷新**：`remainingDays` 在页面加载时快照，跨零点需重新拉取。

---

## 10. 上线与回滚

### 10.1 上线顺序（不可换）

1. **迁移与应用同批部署**（`allowPending:false` ⇒ 拆两个 PR 中间每次启动都会硬失败）：
   `node packages/api-publish-engine/scripts/migrate-postgres.js`。
2. `node packages/api-publish-engine/scripts/payment-preflight.js` → `promo-config` 必须 PASS。
3. 设 `PROMO_STANDARD_MONTHLY_ENABLED=1` 并**重启**服务。
4. 冒烟：`GET /api/v1/plans` 中标准版 `priceMonthlyCents=2900`；下单后查订单三列。
5. `node packages/api-publish-engine/scripts/payment-reconcile.js` → `promo-order-amount-mismatch` 为 0。

### 10.2 回滚

| 层级 | 动作 | 影响 |
|---|---|---|
| ① 立即止血 | `PROMO_STANDARD_MONTHLY_ENABLED=0` + 重启 | 停止新促销单；**存量促销单与权益不受影响** |
| ② 代码回滚 | 回滚到上一版本 | 旧代码不读 `payable_cents`，但 `NOT NULL` 仍生效 ⇒ **必须先做①**，否则新下单/兑换会 23502 |
| ③ 数据 | **不回滚已发放权益**；退款按 `payable_cents` 原路退 | 用户已付钱，权益优先 |

### 10.3 监控与对账

- `payment-reconcile.js` 的 `promo-order-amount-mismatch`（INFO）每日一次。
- `payment-reconcile.js` 的 `paid-without-entitlement`（BLOCKING）保持为 0。
- 客服口径：退款金额一律以订单详情里的 `payable_cents` 为准，**不看 `amount`**。
