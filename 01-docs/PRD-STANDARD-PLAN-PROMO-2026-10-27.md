# PRD — 标准版月付「上市期半价」促销（2026-10-27）

| 项 | 值 |
|---|---|
| 文档版本 | v1.3（2026-10-27 三次修订：新增 1095 天会员期限上限与促销额度预占，见 §13/§14） |
| 状态 | 已定稿（决策已锁定，见 §2） |
| 负责人 | 产品 / 支付 |
| 关联 change | `openspec/changes/standard-plan-promo/proposal.md` |
| 关联迁移 | `migrations/postgresql/011_payment_promo.sql` |
| 关联记录 | `openspec/records/standard-plan-promo.md`、`openspec/records/promo-yearly-rule.md` |
| 适用版本 | `PLAN_MATRIX_VERSION = 2026-10-26` 起 |

> 版本沿革：v1.0「月付促销 + 限购 3 次」→ v1.1「年付随月付浮动、删限购」（**错误**，见 §11）→
> v1.2「恢复 v1.0 的限购与年付原价，保留归一化缺陷修复」→ v1.3「新增 1095 天会员期限上限 +
> pending 促销额度预占（见 §13/§14）」。当前生效版本是 **v1.3**。

---

## 1. 目标与非目标

### 1.1 目标

1. 上市期三个月内，把标准版**月付**成交价从 ¥59 压到 **¥29**，降低首购决策成本。
2. 让「促销价」成为**服务端唯一可判定**的事实：前端只渲染服务端下发的字段，不参与任何金额计算。
3. 把「标价 / 让利 / 实收」三个金额同时落库，使退款、对账、客服三方能对上同一笔钱。
4. 用 **per-user 限购 3 单**把单客让利封顶在 **¥90**（3 × ¥30），同时**年付保持原价**：
   计数式限购的计量单位是「次」，年付一次覆盖 12 个月，两者量纲不匹配（见 §12）。

### 1.2 非目标

- 不做首月优惠、不做阶梯折扣、不做优惠券叠加。
- 不做新老客差异定价（全体一视同仁；限购只看「买过几单」，不看新老）。
- 不做年付促销（年付在任何窗口下都是 59000，见 §12.3）。
- 不改**原价**口径：标准版仍是 5900 / 59000；专业版仍是 11900 / 119000；免费版与积分额度不动。
- 不做自动续费/升降级 proration/自助退款。

---

## 2. 决策表（D1–D13，已定稿）

| ID | 项 | 值 |
|---|---|---|
| D1 | 促销形态 | 固定时间窗内持续半价（**非首月**） |
| D2 | 范围 | 仅 `standard` + **month**（年付不参与） |
| D3 | 价格 | 月付标价 5900 分 → 实收 **2900** 分（discount 3000） |
| D4 | 年付 | **任何窗口下都是 59000 分**，不参与促销、无 discount、无 promotion |
| D5 | 人群 | **全体，一视同仁**（无 per-user 新老判定） |
| D6 | 限购 | 同一用户**累计最多 3 单**促销价订单；第 4 单起按 5900 |
| D7 | 展示 | 「¥29/月（上市期特惠 · 剩余 N 天）· ¥590/年」，**不划线**、不展示原价 |
| D8 | 购买按钮 | `exhausted` 时显示「活动价已用完，¥59/月」，**下单前可见** |
| D9 | 账务 | 月付 `amount=5900`/`discount_cents=3000`/`payable_cents=2900`；年付 `59000`/`0`/`59000`（实收是传给微信的唯一金额） |
| D10 | 兑换码 | 促销期内不可叠加，提示 `REDEEM_DISABLED_DURING_PROMO` |
| D11 | 开关 | env `PROMO_STANDARD_MONTHLY_ENABLED`（0/1，改后重启生效） |
| D12 | 到期告知 | 结束前 7 天在会员中心显示「特惠将于 X 日结束，之后按 ¥59/月续费」 |
| D13 | 退款口径 | 按实付 **2900** 原路退（年付按 59000） |
| D14 | 会员期限上限 | 任何新增写入后 `prospectiveEnd = max(现有 current_period_end, now) + durationDays` 不得超过 `now + 1095 天`；恰好 1095 天通过，1096 天拒绝（409 `SUBSCRIPTION_HORIZON_EXCEEDED`），见 §13 |
| D15 | 促销额度预占 | 额度 = `status='paid'` 的促销单 + `status='pending'` 且创建时间在 **30 分钟**内的促销单；pending 过期自动释放；结算超卖仍放行并记 `PROMO_QUOTA_OVERSOLD`，见 §14 |

> v1.2 修订点：D2 / D4 / D6 / D8 / D9 / D13 回到 v1.0 语义，理由见 §12；
> v1.1 的「年付 = 月付 × 10」与「无限购」已被推翻（§11 保留为历史记录）。

---

## 3. 数据校验（逐字段）

### 3.1 促销配置（env → `promo-resolver.loadStandardMonthlyPromoConfig`）

| 字段 | 来源 | 类型/范围 | 非法时的行为 |
|---|---|---|---|
| `enabled` | `PROMO_STANDARD_MONTHLY_ENABLED` | 字符串 `"1"` 为开；其它任何值（含 `"true"`、`"0"`、空）为关 | 不报错（fail-closed 视为关闭） |
| `period` | 常量 `'month'` | 必须是 `'month'` | 抛 `PROMO_CONFIG_INVALID`（配成年付是语义错误） |
| `priceCents` | `PROMO_STANDARD_MONTHLY_PRICE_CENTS`（默认 `2900`） | 正整数；必须 `< listPriceCents` | 抛 `PROMO_CONFIG_INVALID`（启动/预检失败） |
| `startsAt` | `PROMO_STANDARD_MONTHLY_STARTS_AT`（默认 `2026-11-01T00:00:00+08:00`） | 可解析时间戳 | 抛 `PROMO_CONFIG_INVALID` |
| `endsAt` | `PROMO_STANDARD_MONTHLY_ENDS_AT`（默认 `2027-02-01T00:00:00+08:00`） | 可解析时间戳，且 `> startsAt` | 抛 `PROMO_CONFIG_INVALID` |
| `maxPurchasesPerUser` | `PROMO_STANDARD_MONTHLY_MAX_PURCHASES`（默认 `3`） | 正整数 | 抛 `PROMO_CONFIG_INVALID` |
| `listPriceCents` | 由 `plan-matrix` 注入（`standard.priceMonthlyCents`，含运营 overrides） | 非负整数；`> 0` 时必须 `> priceCents` | 抛 `PROMO_CONFIG_INVALID` |
| `listPriceYearlyCents` | 由 `plan-matrix` 注入（`standard.priceYearlyCents`，含运营 overrides） | 非负整数 | 抛 `PROMO_CONFIG_INVALID` |

> **年付不是配置项，也不参与促销**：`listPriceYearlyCents` 只作为「年付恒为原价」的返回源，
> 不参与任何折扣比较。年付为什么必须留在原价见 §12.3。
>
> **禁止静默回退**：任何一条非法都必须让启动/预检炸掉。回退到原价的后果是「活动上线了但一分没便宜」，
> 这类故障在日志与监控里完全不可见。

### 3.2 询价入参（`resolvePrice`）

| 字段 | 校验 | 非法行为 |
|---|---|---|
| `plan` | 非空字符串 | 抛 `PROMO_CONFIG_INVALID`（编程错误） |
| `period` | `'month'` 或 `'year'` | 抛 `PROMO_CONFIG_INVALID`（不猜价格） |
| `now` | Date / 时间戳字符串 / 数字 | 抛 `PROMO_CONFIG_INVALID` |
| `config` | 普通对象（含 plan/period/窗口/价格/两个标价/限购） | 抛 `PROMO_CONFIG_INVALID` |
| `promoPurchaseCount` | 非负整数（默认 0） | 抛 `PROMO_CONFIG_INVALID` |

> `promoPurchaseCount` 是**已占用额度**的促销单数：`status='paid'` 的促销单
> **加上** `status='pending'` 且创建时间在 30 分钟内的促销单（见 §14）。纯函数本身不碰 I/O，
> 所以「第 4 单按原价」这条规则仍然可以逐值穷举测试。

### 3.3 订单落库三列

| 字段 | 促销单（月付第 1–3 单） | 年付单 | 原价单（月付第 4 单起 / 窗口外） | 校验 |
|---|---|---|---|---|
| `amount` | 5900 | 59000 | 5900 | `>= 0` 整数（DB CHECK 已存在） |
| `discount_cents` | 3000 | 0 | 0 | `NOT NULL DEFAULT 0` |
| `payable_cents` | 2900 | 59000 | 5900 | `NOT NULL`；回填 = `amount - COALESCE(discount_cents,0)` |
| `promotion_id` | `standard-monthly-half` | `NULL` | `NULL` | 可空 TEXT（计数查询按它过滤） |

> `exhausted` 的订单 `promotion` 非空（UI 要提示「已用完」）但**不得落 `promotion_id`**：
> 计数只数真正享促销价的单，落进去会让「第 4 单」也占额度，用户在 3 单后永远原价。

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
POST /api/v1/me/checkout { plan:'standard', period:'month'|'year' }
  ① requireUser(userId)                     → 未登录 503 BUSINESS_USER_REQUIRED
  ② plan/period 白名单                       → free/非法档 400
  ③ paymentProvider 存在性                   → 缺失 503 PAYMENT_PROVIDER_UNAVAILABLE
  ④ 复用 pending?（带 orderId）              → 走 _reusePendingOrder（按落库 payable_cents 取码）
  ⑤ 会员期限预检（§13）                       → 超过 now + 1095 天 ⇒ 409，不落单、不生成二维码
  ⑥ month? → 同一事务 advisory lock + 计数    → 已占用额度 = paid + 30 分钟内 pending（§14）
  ⑦ resolvePrice()                          → 唯一金额判定点（纯函数）
  ⑧ createPendingOrder(amount, discount_cents, payable_cents, promotion_id)
  ⑨ provider.createCheckout({ amountCents: payableCents })   ← 实收（月付 2900 / 年付 59000）
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
- 促销期内第 1/2/3 单按促销价（2900）；**第 4 单起按原价 5900**（`exhausted` 在下单前可见）。
- 年付无论第几次都是 59000。
- 距活动结束 ≤7 天且促销仍生效 → 会员中心显示续费预告（「之后按 ¥59/月」）。
- 活动结束后新订单按 5900 / 59000；**已下的促销单不受影响**（金额在下单时已锁定）。
- 窗口结束后**无需发版**：价格由 `now ∈ [startsAt, endsAt)` 判定，到期自动恢复。

---

## 5. 功能逻辑

| 功能 | 规则 |
|---|---|
| 定价判定 | 开关 → 时间窗 `[startsAt, endsAt)` → `plan==='standard'` ∧ `period==='month'` → `promoPurchaseCount < 3`；年付在窗口内外恒为 59000 |
| 计数 | `promotion_id IS NOT NULL` 且（`status='paid'` **或** `status='pending'` 且 `created_at` 在 30 分钟内）；pending 过期自动释放（见 §14） |
| 会员期限 | 任何新增写入前计算 `prospectiveEnd = max(现有 current_period_end, now) + durationDays`；`> now + 1095 天` ⇒ 409 `SUBSCRIPTION_HORIZON_EXCEEDED`（checkout 预检 + applySubscription 兜底，见 §13） |
| 目录下发 | `priceMonthlyCents` = 实收（2900 / 5900）；`priceYearlyCents` = 59000；`listPriceMonthlyCents` = 5900；`promotion` 仅标准版月付非空，含 `exhausted` |
| 兑换码 | `promoActive()` 为真 ⇒ `REDEEM_DISABLED_DURING_PROMO`（409），在触达仓储之前拒绝 |
| 开关 | `PROMO_STANDARD_MONTHLY_ENABLED`，装配期读取一次；改后必须重启 |
| 配置自检 | `payment-preflight.js` 的 `promo-config` 项：未开 SKIP / 合法 PASS / 非法 FAIL（明细含月付实收与每人上限） |
| 对账 | `payment-reconcile.js` 的 INFO `promo-order-amount-mismatch`：`payable_cents <> amount - COALESCE(discount_cents,0)` |

---

## 6. 交互逻辑与显示项

### 6.1 交互逻辑

| 状态 | 用户看到 | 可执行动作 |
|---|---|---|
| 促销生效（已购 0–2 单） | 标准版卡片：`¥29 / 月（上市期特惠 · 剩余 N 天） · ¥590 / 年` + 「购买」 | 点击整卡 → 支付弹窗（月付促销价、年付原价） |
| **额度用尽（已购 3 单）** | 标准版卡片：`¥59 / 月 · ¥590 / 年` + 按钮文案「活动价已用完，¥59/月」 | 仍可按原价购买 |
| 活动未开始 / 已结束 | 标准版卡片：`¥59 / 月 · ¥590 / 年` + 「购买」 | 按原价购买 |
| 距结束 ≤7 天 | 价目区底部追加一行「特惠将于 X 日结束，之后按 ¥59/月续费」 | 无（纯提示） |
| 未登录 | 价格与角标照常展示（目录对未登录用户按 0 单处理），卡片不可购买 | 需先登录 |
| 兑换码输入 | 促销期内提交 → 错误提示（映射 `REDEEM_DISABLED_DURING_PROMO`） | 无法兑换 |

### 6.2 显示项（字段 → 展示）

| 显示项 | 数据来源 | 格式 |
|---|---|---|
| 月付价 | `plan.priceMonthlyCents`（实收） | `¥29` / `¥59` |
| 年付价 | `plan.priceYearlyCents`（恒为原价） | `¥590` |
| 活动角标 | `plan.promotion.remainingDays`，仅 `exhausted === false` 时渲染 | `（上市期特惠 · 剩余 42 天）` |
| 购买按钮（售罄） | `plan.promotion.exhausted === true` + `listPriceMonthlyCents` | `活动价已用完，¥59/月` |
| 续费预告 | `plan.promotion.endsAt` + `listPriceMonthlyCents` | `特惠将于 2027/1/31 结束，之后按 ¥59/月续费` |

**不展示**：划线原价、折扣百分比、「原价 ¥59」这类对比文案（决策 D7）。
**必须展示**：额度用尽时的「活动价已用完，¥59/月」（D8，**下单前可见**）。

### 6.3 提示文字（zh / en 原文）

| key | zh | en | 状态 |
|---|---|---|---|
| `memberCenter.planPromoBadge` | `上市期特惠 · 剩余 {days} 天` | `Launch offer · {days} days left` | 渲染 |
| `memberCenter.promoEndingSoon` | `特惠将于 {date} 结束，之后按 {price}/月续费` | `The launch offer ends on {date}; renewals after that are {price}/month` | 渲染 |
| `memberCenter.planPromoExhausted` | `活动价已用完，{price}/月` | `Offer used up — {price}/month` | **渲染**（D8） |
| 服务端 `REDEEM_DISABLED_DURING_PROMO` | `上市期特惠进行中，兑换码暂不可叠加使用` | （服务端错误码；客户端映射到 `redeemErr*`） | 渲染 |
| 服务端 `PAYMENT_AMOUNT_MISMATCH` | `回调金额 {x} 与订单实收 {y} 不一致` | 同上 | 服务端 |

> 前端渲染的完整句子：`¥29 / 月（上市期特惠 · 剩余 42 天） · ¥590 / 年`。
> 年付金额来自服务端 `priceYearlyCents`（恒 59000），前端不做乘法、不做促销判断。
> 括号由组件提供，locale 串内不含括号 —— 保证 en 下也是 `$29 / month (Launch offer · 42 days left)` 的同一形状。

---

## 7. 边界场景表（14 条）

| # | 场景 | 期望行为 | 判据 |
|---|---|---|---|
| 1 | 活动开始前 1 秒下单 | 月付原价 5900，`promotion=null`，无角标 | `promo-resolver.test.js` 窗口边界 |
| 2 | 活动结束时刻（`endsAt`）下单 | 原价，`promotion=null` | 同上 |
| 3 | 活动结束前 1 毫秒下单 | 2900，`remainingDays=1` | 同上 |
| 4 | 跨窗口：活动内下单、活动后才付款 | 按**下单时**锁定的实收结算（月付 2900 / 年付 59000）；回调金额必须等于它 | `subscription-payment-promo.test.js` |
| 5 | 提前续费（有效期未到再买） | 允许；第 1–3 单按促销价、第 4 单起原价；`applySubscription` 顺延 | `subscription-payment-promo.test.js` |
| 6 | **年付在促销期购买** | 实收 **59000**，`promotion_id` 为 NULL、无折扣 | `promo-resolver` 年付用例 + `plan-catalog-promo` + `subscription-payment-promo` |
| 7 | 同一用户连续下单（第 4 单） | 5900，`promotion.exhausted=true`，按钮显示「活动价已用完」 | `promo-resolver` 计数用例 + 前端 `exhausted` 用例 |
| 8 | 年付购买（窗口内 / 窗口外） | 都是 59000，无 promotion，无折扣 | `promo-resolver` 年付五时点用例 |
| 9 | 促销期兑换码 | 409 `REDEEM_DISABLED_DURING_PROMO`，且不查码 | `promo-redeem-guard.test.js` |
| 10 | 未登录访问目录 | 按 0 单处理（不查库）；下单 503 | `publish-api-server` 路由 + 前端 |
| 11 | 退款 | 按 `payable_cents` 原路退（月付 2900 / 年付 59000，不按 amount） | PRD D13 + 对账 hint |
| 12 | 时区 | 窗口用 `+08:00` 绝对时刻；`remainingDays` 按 UTC 毫秒差 `ceil` | `promo-resolver` 边界用例 |
| 13 | 活动到期文案 | 窗口外 `promotion=null`；最后 7 天显示「特惠将于 X 日结束…」 | 前端 `Subscription.promo.test.js` |
| 14 | 回调金额与订单不符（5900 vs 2900） | `PAYMENT_AMOUNT_MISMATCH`，不发权益，订单保持 pending | `subscription-payment-promo.test.js` |

补充（同属边界，单独列出以免与上表混淆）：

| # | 场景 | 期望 |
|---|---|---|
| 15 | 促销配置 `price >= listPrice` 或 `maxPurchasesPerUser` 非正整数 | 启动/预检 `PROMO_CONFIG_INVALID`，不静默原价 |
| 16 | 迁移未跑（缺 `payable_cents`） | 订单读写直接 SQL 错误 → 500（fail-closed） |
| 17 | 运营 overrides 把标准版月付标价改到 4900 | 促销配置 `listPriceCents` 跟随 4900；月付实收仍 2900、年付实收仍 59000（年付不看标价也不打折） |
| 18 | 窗口结束 | 无需发版：月付回 5900、年付恒 59000，`promotion=null` |
| 19 | 历史订单（v1.1 期落的年付 `promotion_id`） | 仅作事实记录/对账；不参与计数（计数只数 `status='paid'` 且 `promotion_id` 非空的订单） |
| 20 | 会员期限正好 1095 天 | 通过（边界值不误杀） | `subscription-horizon.test.js` |
| 21 | 会员期限 1096 天 | 409 `SUBSCRIPTION_HORIZON_EXCEEDED`，不落单/不发权益 | 同上 |
| 22 | 已有 2 年 + 买 1 年 | 通过；已有 2 年 + 买 2 年拒绝 | 同上 |
| 23 | 已有超限用户再买 | 拒绝新增写入，**现有权益不回滚** | 同上 |
| 24 | 3 个 pending 后第 4 单 | 第 4 单 5900（pending 占额度） | `subscription-payment-promo.test.js` |
| 25 | pending 超过 30 分钟 | 额度自动释放，下一单恢复 2900 | 同上 |
| 26 | 并发 5 单 | 最多 3 单 2900，其余 5900 | 同上 |
| 27 | 竞态导致已支付促销单超过 3 单 | **仍然结算**（钱已收），记 `PROMO_QUOTA_OVERSOLD` + 事件 result 可对账字段 | `payment-reconcile` 的 `promo-quota-oversold` |

---

## 8. 测试矩阵

| 层 | 文件 | 覆盖 |
|---|---|---|
| 纯函数 | `test/promo-resolver.test.js` | 窗口前 1 秒/起点/最后 1 毫秒/结束点；**年付五个时点 × 多个计数恒为 59000**；月付第 1/2/3 单 2900、第 4 单 5900 + `exhausted=true`；pro/free 不受影响；配置非法 9 类；env 装配（含限购上限） |
| 目录契约 | `test/plan-catalog-promo.test.js` | `priceMonthlyCents` 实收语义（2900/5900）、`priceYearlyCents` 恒 59000、两个 list 标价、`promotion.exhausted`、年付窗口内/外都不被污染、overrides 联动 |
| 账务 | `test/subscription-payment-promo.test.js` | 月付三列、年付三列（59000/0/59000）、provider 收实收、第 1/2/3 单促销、第 4 单原价、**3 个 pending 后第 4 单 5900**、**pending 30 分钟过期释放**、**并发 5 单最多 3 单 2900**、**超卖仍结算且返回可对账字段**、年付不查计数、继续支付、结算金额校验 |
| 会员期限 | `test/subscription-horizon.test.js` | 正好 1095 天通过 / 1096 天拒绝、无存量 1095/1096、2 年 + 1 年通过、2 年 + 2 年拒绝、过期旧订阅按 now 起算、已有超限不回滚、checkout 预检零订单零二维码、兑换码/后台授予兜底、兑换码边界放行 |
| 仓储原语 | `test/member-commerce-repository.test.js` | `countPromoPurchases` 含 30 分钟内 pending、paid-only 模式、`createPendingOrderWithPromoQuota` 的 advisory lock → 计数 → INSERT 同事务 |
| 既有回归 | `test/subscription-payment.test.js` | 金额真源、幂等、跨档压制、复用 applySubscription；金额不符用例已反转为拒绝 |
| 兑换码 | `test/promo-redeem-guard.test.js` | 窗口内 409、窗口外/关开关/无配置不拦截 |
| 迁移 | `test/payment-promo-schema.test.js` | DDL 逐条一致、三步顺序、无 UNIQUE 索引 |
| 运维 | `test/payment-promo-ops.test.js` | preflight PASS/SKIP/FAIL + 早退分支（明细含每人上限）；reconcile INFO 判据 |
| 前端 | `apps/desktop/src/views/member-center/Subscription.promo.test.js` | 角标/剩余天数、年付 ¥590、不划线、`exhausted` 售罄文案与角标消失、续费预告、无硬编码 2900/29000 |
| 链路 | `apps/desktop/electron/services/identity/entitlement-service.test.js`、`apps/desktop/src/stores/identity.test.js` | `promotion` 与 `listPrice*Cents` 穿透归一化（否则角标在真实链路永远不出现） |

**变异反证**：每条新判据都做过「改坏实现 → 测试必须红 → 还原 → 绿」，结果记录在
`openspec/records/promo-yearly-rule.md` §10（初版记录见 `openspec/records/standard-plan-promo.md` §5）。

---

## 9. 已知残留风险

1. **`promotion_id` 与支付回调的时序**：若订单在促销窗口内创建、窗口结束后才支付，仍按促销价结算
   （金额已锁定）——这是**有意**的，不是 bug。
2. **前端未做「活动结束倒计时」实时刷新**：`remainingDays` 在页面加载时快照，跨零点需重新拉取。
3. **30 分钟预占窗口与微信 2 小时有效期的错位**：pending 单在 30 分钟后释放额度（见 §14），
   但微信二维码通常 2 小时内仍可支付。若用户在释放后下了新促销单、又把旧 pending 单一并支付，
   仍可能出现「已支付促销单 > 3」；本期由**结算兜底**处理：钱已收，仍然结算，记
   `PROMO_QUOTA_OVERSOLD` 异常日志与事件 result 可对账字段，由 `payment-reconcile` 的
   `promo-quota-oversold` 检出。要彻底消除需把释放窗口调到微信侧有效期或引入
   `promotion_slot` 唯一索引；本期**不做**，因为那会把弃单锁死窗口从 30 分钟拉长到 2 小时。
4. **历史 `promotion_id` 的语义**：v1.0/v1.1 都写过它；它始终是「这单按促销价成交」的事实记录，
   不是额度账本。任何报表若把它当「额度占用」会得出错误结论。

---

## 10. 上线与回滚

### 10.1 上线顺序（不可换）

1. **迁移与应用同批部署**（`allowPending:false` ⇒ 拆两个 PR 中间每次启动都会硬失败）：
   `node packages/api-publish-engine/scripts/migrate-postgres.js`。
2. `node packages/api-publish-engine/scripts/payment-preflight.js` → `promo-config` 必须 PASS
   （明细应出现「月付实收 2900」与「每人上限 3 单」）。
3. 设 `PROMO_STANDARD_MONTHLY_ENABLED=1` 并**重启**服务。
4. 冒烟：`GET /api/v1/plans` 中标准版 `priceMonthlyCents=2900`、`priceYearlyCents=59000`、
   `listPriceYearlyCents=59000`；下单后查订单三列（月付促销单应为 5900 / 3000 / 2900；
   年付应为 59000 / 0 / 59000）。
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

---

## 11. 历史修订记录（为什么 v1.1 是错的）

| 版本 | 语义 | 结论 |
|---|---|---|
| v1.0 | 月付 2900 + 限购 3 单；年付 59000 | 正确（v1.2 恢复） |
| v1.1 | 年付 = 月付实收 × 10（29000）+ 删除限购 | **错误**，已被 v1.2 推翻 |

v1.1 的推理是：初版「月付 29 / 年付 590」让 12 个月月付 = 348 < 590，用户会囤月付，
所以把年付改成 290 让套利消失。**这个推理只看到了一个方向**：

- 它把「年付 = 月付 × 10」当成必须无条件成立的定价不变量，却没算**限购已经把月付路径封顶**：
  最多 3 × 29 = 87 元 / 3 个月，根本买不到 12 个月 × 29 = 348 元的年付；
- 它没有算**年付一旦参与促销**，同一套「按次」限购会变成 3 次 × 1 年 = 3 年 870 元（原价 1770），
  让利从 90 元放大到 900 元 —— 计数式限购与年付促销在数学上不能共存。

完整算术见 §12。v1.1 期间产生的代码（`priceCents * 10`、`exhausted` 删除、计数 SQL 删除）
已在 v1.2 全部回滚；**唯一保留的是归一化缺陷修复**（`promotion` / `listPrice*Cents` 在
`entitlement-service` 与 `identity` store 中被丢弃），那是真实缺陷，与限购语义无关。

---

## 12. 为什么限购 3 次是必要的（且不能与年付促销共存）

### 12.1 限购 3 次本身就消灭了套利

促销期月付 29、年付 590（不参与促销）：

```
3 次月付（限购上限） = 29 × 3 = 87 元，覆盖 3 个月
12 个月年付          = 590 元（或促销外 29 × 12 = 348 元）
```

- 用户**最多**只能以 29 元买 3 个月，累计 87 元；他**买不到** 12 个月 × 29 = 348 元。
- 所以「囤 12 个月月付」这条套利路径根本不存在——它不是被定价不变量堵住的，是被**次数上限**
  堵住的，而且堵得比任何价格公式都干净：**单客让利上限 = 3 × 30 = 90 元**。
- 年付 590 与「3 次月付 87 元」不是同一件商品：前者 12 个月、后者 3 个月。把两者放在一起比
  单价，是把「限购」这个约束从等式里删掉之后才会得出的结论（v1.1 的错误正在这里）。

### 12.2 如果年付也享促销：3 次 × 1 年 = 870 元买 3 年

假设把同一套「每人最多 3 次」的限购套到年付促销上（年付促销价按 v1.1 的 290 元算）：

```
3 次年付 = 3 × 290 = 870 元，覆盖 3 年
原价 3 年 = 3 × 590 = 1770 元
让利 = 1770 - 870 = 900 元
```

而月付促销的单客让利上限只有 **90 元**（3 × 30）。也就是说：

- 年付参与促销会把单客让利从 **90 元放大到 900 元**（10 倍）；
- 放大倍数恰好等于「一年 12 个月 ÷ 限购 3 次」的量纲错配：**限购买的是「次数」，年付卖的是「12 个月」**；
- 这不是「年付更划算」，而是**限购的计量单位与商品的时间跨度不一致**，导致一次购买绕过了
  3 次约束里的 3 个月假设。

结论：**计数式限购与年付促销在数学上不能共存**。要么限购按「月数」计量（需要另一套额度账本，
且与「累计最多 3 单」的产品口径冲突），要么年付不参与促销。本 PRD 选择后者。

### 12.3 年付为什么必须留在原价

1. **量纲不匹配**：限购的单位是「次」，年付一次 = 12 个月。任何「最多 N 次」的规则用在年付上，
   实际卖出的月数是 `N × 12`，与月付的 `N × 1` 差 12 倍。§12.2 的 900 元让利就是这 12 倍的算术后果。
2. **年付的定价逻辑是「付 10 个月用 12 个月」**：590 = 59 × 10，折扣已经内含在年付标价里
   （相对按月付 12 个月省 118 元）。再叠一层促销，等于对同一段时长**打两次折**。
3. **年付是长周期承诺，促销是拉新手段**：促销要降低的是「第一次掏 59 元」的心理门槛；
   年付用户已经愿意一次付 590 元，不需要再用 290 元去刺激，反而会把高价值客户的价格锚点打下来。
4. **可验证性**：年付恒为 59000 是一条**静态**性质，可以用「窗口五个时点 × 多个计数」穷举断言；
   一旦让它随促销浮动，就必须同时验证「限购 × 年付」的 12 倍放大，测试面与资损面同步扩大。

### 12.4 目标语义（一句话）

> 促销只作用于**标准版月付**；同一用户累计最多 **3 单**促销价；第 **4** 单起按 **5900**；
> 年付在**任何窗口**下都是 **59000**；`exhausted` 在**下单前**可见。

### 12.5 防回归（本次新增的判据）

| 判据 | 锁住什么 | 变异反证 |
|---|---|---|
| `promo-resolver` 年付五时点 × 计数 0/1/2/3/9 = 59000 | 年付不得被促销污染 | 把年付改成 29000 → 必红 |
| `promo-resolver` 计数 0/1/2 = 2900、3/4 = 5900 + `exhausted=true` | 限购边界与售罄状态 | 把 `>= max` 改成恒 false → 必红 |
| `plan-catalog-promo` 年付窗口内/外 = 59000 | 目录层不得被促销污染 | 让 catalog 对年付调促销 → 必红 |
| `subscription-payment-promo` 已满 3 单时 5 个并发下单全部 5900 | 已满额度不可被并发绕过 | 删除计数判断 → 必红 |
| `subscription-payment-promo` 3 个 pending 后第 4 单 5900 | pending 也占额度（堵多开窗口） | 计数退回只看 paid → 必红 |
| `subscription-payment-promo` 并发 5 单最多 3 单 2900 | 预占锁串行化 | 删除 advisory lock/串行化 → 必红 |
| `subscription-horizon` 1095 通过 / 1096 拒绝 | 期限上限边界 | 把 `>` 改成 `>=` 或改常量 → 必红 |
| 前端 `exhausted` 文案 + 角标消失 | 「下单前可见」不能只存在于服务端 | 删 `promoBuyCtaOf` 分支 → 必红 |

> 并发口径（v1.3）：下单路径用 `pg_advisory_xact_lock('promo:<user>')` 把「计数 → 定价 → 落
> pending」串行化，pending 占用额度 30 分钟。仍有残留风险：30 分钟后额度释放、但微信二维码
> 通常 2 小时内仍可支付 ⇒ 晚到的旧 pending 可能造成「已支付 > 3」；结算兜底不拒付，记
> `PROMO_QUOTA_OVERSOLD` 并对账可见，详见 §9.3 与 §14。

---

## 13. 会员期限上限（1095 天）

### 13.1 规则

```text
prospectiveEnd = max(现有 current_period_end, now) + durationDays
prospectiveEnd > now + 1095 天  ⇒ 拒绝（409 SUBSCRIPTION_HORIZON_EXCEEDED）
```

- **口径按天**：`MAX_SUBSCRIPTION_HORIZON_DAYS = 1095 = 3 × 365`。跨闰年时与「3 个自然年」
  相差 1 天（例如 2028-02-29 前后）；本上限不按日历月/年顺延。
- **单一真源**：`packages/api-publish-engine/src/auth/subscription-horizon.js`，前端与本文件
  只是引用/描述，不得各写一份常量。
- **两层都拦**：
  1. `SubscriptionService.createCheckout` 预检：付款前拒绝，**不落 pending 单、不生成二维码**；
  2. `PostgresCommerceTransaction.applySubscription` 兜底：兑换码与后台授予不经过 checkout，
     必须在仓储层拦；支付回调最终也复用这层（同一事务内再校验一次）。
- **已有超限用户不受影响**：护栏只拒绝新增写入，绝不回滚 `identity_subscriptions` 的现有行。

### 13.2 边界表

| # | 现有 current_period_end | 本次新增 | prospectiveEnd | 结果 |
|---|---|---|---|---|
| 1 | now + 730 天（2 年） | 365 天（1 年） | now + 1095 天 | **通过**（正好边界） |
| 2 | now + 731 天 | 365 天 | now + 1096 天 | **拒绝** |
| 3 | 无订阅 / 已过期 | 1095 天 | now + 1095 天 | **通过** |
| 4 | 无订阅 / 已过期 | 1096 天 | now + 1096 天 | **拒绝** |
| 5 | now + 730 天（2 年） | 730 天（2 年） | now + 1460 天 | **拒绝** |
| 6 | now + 1200 天（已超限） | 30 天 | now + 1230 天 | **拒绝新增**；现有权益保持原样 |
| 7 | now - 400 天（已过期） | 365 天 | now + 365 天 | **通过**（按 now 起算，不按陈旧到期时间） |

### 13.3 错误码与提示文字

| 错误码 | HTTP | 触发 | 服务端中文消息 | 前端 key（zh / en） |
|---|---|---|---|---|
| `SUBSCRIPTION_HORIZON_EXCEEDED` | 409 | 新增写入后超过 now + 1095 天 | `会员到期时间最多可延长至 3 年后，当前购买会超过上限` | `memberCenter.payHorizonExceeded`：`会员到期时间最多可延长至 3 年后，当前购买会超过上限` / `Membership can be extended at most 3 years from now; this purchase would exceed that limit.` |
| `SUBSCRIPTION_HORIZON_EXCEEDED`（兑换） | 409 | 兑换码/后台授予超过上限 | 同上 | `memberCenter.redeemErrHorizon`：`会员到期时间最多可延长至 3 年后，当前兑换会超过上限` / `Membership can be extended at most 3 years from now; this redemption would exceed that limit.` |
| `DURATION_INVALID` | 400 | `durationDays` 非正整数或溢出 Date 范围 | 时长非法 | 不单独展示（内部错误） |

> 前端行为：点击购买若被 409 拒绝，支付弹窗必须展示
> 「会员到期时间最多可延长至 3 年后，当前购买会超过上限」，**不得**退化成「支付未完成」；
> 被拒时**不显示二维码**。

---

## 14. 促销额度预占（为什么 pending 也占额度）

### 14.1 问题

定价在**下单时**固化：第 1/2/3 单按 2900、第 4 单起按 5900。若额度只数 `status='paid'`，
用户可以开 5 个窗口各下一单：5 个 pending 都读到「已支付 0 单」⇒ 都按 2900 定价，
逐一支付后拿到 **5 个月促销价**。这不是并发 bug，是**额度账本漏了 pending 这一半事实**。

### 14.2 规则

```text
已占用额度 = status='paid' 的促销单
           + status='pending' 且 created_at 在最近 30 分钟内的促销单
```

- **30 分钟从哪来**：现有代码里唯一成文的 pending 超时口径是支付弹窗的 30 分钟硬上限
  （`apps/desktop/src/components/WeChatPayDialog.vue:87-89`，注释明确写「与 PRD §6.1
  『pending 订单 30 分钟未 paid』同源」；`PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md`
  §7.3 同值）。服务端**没有**把 pending 置 failed 的定时任务，因此本 PR 不新增支付状态机，
  只按 `created_at` 滑窗释放额度。
- **过期自动释放**：pending 超过 30 分钟不再计入；弃单不会永久锁死用户。
- **并发串行化**：下单路径在同一事务内先 `pg_advisory_xact_lock('promo:<userId>')`，再计数、
  定价、INSERT pending。第 4 个并发请求必然看到前 3 个已提交的 pending。
- **结算兜底不拒付**：若因竞态（尤其是 30 分钟释放后旧 pending 晚到支付）导致已支付促销单
  超过上限，**仍然结算**（钱已收），但：
  - 路由层记 `PROMO_QUOTA_OVERSOLD` 异常日志；
  - `identity_webhook_events.result` 写 `promoQuotaOversold` / `paidPromoCount` /
    `maxPromoPurchases` 可对账字段；
  - `payment-reconcile` 的 `promo-quota-oversold` 判据按 `HAVING count(*) > 上限` 检出。

### 14.3 边界表

| # | 场景 | 期望 |
|---|---|---|
| 1 | 已支付 0 单，连续下 3 个 pending | 3 单都是 2900（额度逐单占用） |
| 2 | 3 个 pending 后下第 4 单 | 第 4 单 **5900**，`promotion_id=null` |
| 3 | 3 个 pending 均超过 30 分钟 | 额度释放；下一单 **2900** |
| 4 | 并发 5 单（同一用户） | 最多 **3 单 2900**，其余 5900 |
| 5 | 已支付 3 单 + 第 4 个 pending（竞态） | 结算仍放行；`promoQuotaOversold=true`，`paidPromoCount=3` |
| 6 | 第 4 单本身是原价单 | 结算不误报超卖（`promotion_id=null`） |
| 7 | pending 过期后被支付 | 按订单落库的 `payable_cents` 结算；若形成超卖，走第 5 行的兜底 |

### 14.4 错误码 / 观测项

| 标识 | 类型 | 含义 |
|---|---|---|
| `PROMO_QUOTA_UNAVAILABLE` | HTTP 500 | 促销开启但仓储缺少 `createPendingOrderWithPromoQuota`（fail-closed，不静默降级） |
| `PROMO_QUOTA_RECONCILE_UNAVAILABLE` | HTTP 500 | 结算时事务缺少促销计数能力（无法判断超卖，拒绝静默放行） |
| `PROMO_QUOTA_OVERSOLD` | 异常日志（不改变 HTTP 200） | 已结算的促销单超过上限；钱已收，权益照发 |
| `promo-quota-oversold` | `payment-reconcile` INFO | 按用户聚合已支付促销单数 > 上限 |

> **为什么不在结算时拒付**：用户已经付了钱，拒付会制造「钱在微信、权益没有」的更坏状态；
> 超卖是定价/额度窗口的缺陷，应该由日志与对账暴露并复盘，而不是把损失转嫁给用户。
