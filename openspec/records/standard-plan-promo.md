---
record: standard-plan-promo
task: 实现标准版月付「上市期半价」促销（3 个月窗口、限购 3 次、三列账务口径、回调金额校验）
date: 2026-10-27
---

## 本次执行记录：标准版月付上市期半价促销（standard-plan-promo，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `<仓库父目录>\mp-worktrees\mp-standard-plan-promo`，裸分支 `standard-plan-promo`（`git worktree list` 可查）；共享根始终保持 main、零改动 |
| 第一性原因（QM-5 ①） | ✅ | 见 §1 |
| 逃逸分析（QM-5 ②） | ✅ | 见 §2 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 见 §3 / §4 |
| 防止再次发生（QM-5 ⑤） | ✅ | 见 §6 |
| 行尾与 diff 对账 | ✅ | 提交前跑 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径 |
| 接线棘轮 | ✅ | 新增 7 个 `*.test.js` 均由 `node --test` / vitest 直接发现；引擎侧由 `scripts/run-tests.js` 全量跑 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`；无视觉基线变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注 `(#NNNN)` 推导归属 |

### 1. 第一性原因

**缺口不是「促销功能没写」，而是「金额只有一个来源」。**

原实现里 `subscription-payment.createCheckout` 用 `_paymentPriceCents()` 取一个数，
同时把它当作「标价」「让利基数」「传给微信的金额」——三者是同一个变量。
因此任何折扣形态（促销/优惠券/首月特惠）都无法表达，只能改标价，而改标价会让：
- 退款按折扣价退（本该按标价判断合同金额）；
- 对账无法区分「用户少付」与「运营改价」；
- 回调金额校验失去真值（原实现 `void amountCents` 直接不校验）。

⇒ 本变更的第一步是把三列口径拆开（`amount` / `discount_cents` / `payable_cents`），
第二步才是促销判定。**先有账务口径，才有促销。**

### 2. 逃逸分析

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | `subscription-payment.test.js` 原有一条「金额不一致 → 记 WARN 但**不改计费不阻断授权**」—— 它把**缺口写成了期望**。测试全绿恰好证明「回调金额从未被校验」。 |
| 集成测试 | `payment-api.test.js` 的 stub 里 `settlePaymentWebhook` 直接返回固定值，金额字段在 stub 边界被丢弃。 |
| 代码评审 | `void amountCents` 是显式语句，但在 279 行的支付 mixin 里读起来像「占位待办」，没有错误码、没有告警，静态扫描抓不到。 |
| 手工验证 | 沙箱无商户凭据，从未跑过真实微信回调；金额差异只能靠对账发现，而对账原先没有「三列自洽」判据。 |

### 3. 修复

| # | 改动 | 文件 |
|---|---|---|
| 1 | 新增纯函数定价判定（开关 → 窗口 → 档位 → 计数） | `src/auth/promo-resolver.js` |
| 2 | 目录新增 `listPriceMonthlyCents` / `promotion`，`priceMonthlyCents` 保持实收语义 | `src/auth/plan-matrix.js` |
| 3 | 下单按 `resolvePrice` 算价，**provider 收 `payableCents`**；三列 + `promotion_id` 落库 | `src/auth/subscription-payment.js`、`src/auth/payment-order-store.js` |
| 4 | 结算校验 `amountCents === order.payable_cents`，不等抛 `PAYMENT_AMOUNT_MISMATCH` | `src/auth/subscription-payment.js` |
| 5 | 迁移 011：`payable_cents`（回填后 NOT NULL）+ `promotion_id` + 非唯一索引 | `migrations/postgresql/011_payment_promo.sql`、`src/auth/payment-promo-schema.js` |
| 6 | 兑换码促销期禁用 | `src/auth/subscription-service.js` |
| 7 | 装配期读 env；目录按用户下发 `exhausted` | `src/auth/logto-runtime.js`、`src/publish-api-server.js` |
| 8 | 预检 `promo-config` + 对账 INFO `promo-order-amount-mismatch` | `scripts/payment-preflight.js`、`scripts/payment-reconcile.js` |
| 9 | 前端角标/剩余天数/售罄文案/续费预告 | `PlanPriceTag.vue`、`Subscription.vue`、`labels.js`、locales |

### 4. 回归保护（新增判据）

| 文件 | 例数 | 锁住什么 |
|---|---|---|
| `test/promo-resolver.test.js` | 29 | 窗口左闭右开、plan/period 过滤、开关、计数 0/2/3/4、配置非法 5 类、env 装配 |
| `test/plan-catalog-promo.test.js` | 6 | 实收价语义、标价字段、年付不动、overrides 联动 |
| `test/subscription-payment-promo.test.js` | 9 | 三列落库、provider 收 2900、第 4 单原价、结算 2900 通过 / 5900 拒绝 / 缺失拒绝 |
| `test/promo-redeem-guard.test.js` | 5 | 促销期兑换码 409、窗口外/关开关/无配置不拦截 |
| `test/payment-promo-schema.test.js` | 5 | 迁移与 SCHEMA 逐条一致、三步顺序、无 UNIQUE |
| `test/payment-promo-ops.test.js` | 8 | preflight PASS/SKIP/FAIL（含早退分支）、reconcile INFO |
| `Subscription.promo.test.js`（vitest） | 6 | 角标/天数、不划线、售罄按钮、续费预告、无硬编码 2900 |

### 5. 变异反证（把实现改坏 → 必须红；还原 → 必须绿）

命令：PowerShell 读原文件 → 字符串替换 → 跑对应测试 → 还原 → 再跑。
实测结果（2026-10-27，本 worktree）：

| # | 变异 | 改坏后 | 还原后 |
|---|---|---|---|
| M1 | 窗口右端点 `>=` 改成 `>`（结束时刻仍生效） | 红 ✅ | 绿 ✅ |
| M2 | 限购阈值 `>=` 改成 `>`（第 4 单仍促销） | 红 ✅ | 绿 ✅ |
| M3 | `provider.createCheckout` 的 `amountCents` 改回 `listPriceCents`（多收 30 元） | 红 ✅ | 绿 ✅ |
| M4 | 结算校验真值从 `payable_cents` 改回 `amount` | 红 ✅ | 绿 ✅ |
| M5 | 目录把 `priceMonthlyCents` 下发成标价 | 红 ✅ | 绿 ✅ |
| M6 | 促销期不拦兑换码（`if (false && promoActive())`） | 红 ✅ | 绿 ✅ |
| M7 | 前端价格处硬编码 `2900` | 红 ✅ | 绿 ✅ |
| M8 | 售罄按钮退回普通「购买」 | 红 ✅ | 绿 ✅ |

> 结论：8/8 变异均被对应判据捕获，且还原后全绿 —— 判据不是「断言实现存在」，
> 而是「断言行为正确」。M4 尤其重要：它证明测试锁的是 `payable_cents` 而非 `amount`。

### 6. 防止再次发生

1. **金额三列口径进 schema**：`payable_cents` NOT NULL + 回填，任何新写入路径漏写都会 23502
   （而不是静默按 amount 收）。
2. **回调金额校验有稳定错误码**：`PAYMENT_AMOUNT_MISMATCH` 可被对账/告警直接检索，
   不再是「没有错误码的 void」。
3. **对账新增 INFO 判据**：`promo-order-amount-mismatch` 让「三列不自洽」每天可见。
4. **预检新增 `promo-config`**：配置错误在 `payment-preflight` 就红，不等第一个用户下单。

### 7. 测试结果（本 worktree 实测）

| 套件 | 结果 |
|---|---|
| `packages/api-publish-engine` 全量（`node scripts/run-tests.js`） | 见 PR 前最后一次本地读数（提交信息附） |
| 本变更 7 个新测试文件 | 67 例全绿 |
| `apps/desktop` member-center | `Subscription.test.js` 28 + `Subscription.promo.test.js` 6 全绿 |

### 8. 遗留（不假装已闭合）

- **并发下单可超额**：限购是下单时点计数，两请求并发可能各拿一单促销价。
  本期不加 `pg_advisory_xact_lock`（会给支付主链路加锁），由对账与人工兜底。
- **`payment-auth-pipeline.test.js` 依赖 `axios`**：worktree 首次跑时未装依赖导致 `Cannot find module`，
  与本次改动无关；`pnpm install --frozen-lockfile --ignore-scripts` 后复跑通过。
- **QM-6 双模型评审未执行**（本机无 `codeagent-wrapper`）。

## CHANGELOG 条目

# feat(payment): 标准版月付上市期半价促销（3 个月窗口，限购 3 次）

- 标准版月付在 2026-11-01 ~ 2027-02-01 窗口内实收 2900 分（标价仍记 5900、让利 3000），
  年付 59000 与专业版价格不动；每人限 3 单促销价，第 4 单起按原价。
- 订单表新增 `payable_cents`（NOT NULL，回填 `amount - COALESCE(discount_cents,0)`）与
  `promotion_id`；**不建**每用户唯一 paid 订单索引（会挡正常续费）。
- 修掉支付链路的真实缺口：`createCheckout` 原先把标价直接传给微信（促销期会多收 30 元），
  `settlePaymentWebhook` 原先 `void amountCents` 完全不校验回调金额 —— 现改为
  `amountCents === order.payable_cents`，不等即 `PAYMENT_AMOUNT_MISMATCH` 且不发权益。
- 促销期内兑换码不可叠加（`REDEEM_DISABLED_DURING_PROMO`）；会员中心显示活动角标、
  剩余天数、结束前 7 天续费预告，额度用尽时按钮直接显示「活动价已用完，¥59/月」。
- 新增 `promo-config` 上线预检与 `promo-order-amount-mismatch` 对账判据。

## learnings

### lesson: 金额只有一个变量时，任何折扣都只能改标价

**现场**：`subscription-payment.js` 用 `_paymentPriceCents()` 的返回值同时充当标价、让利基数与
传给微信的金额；同一文件的 `settlePaymentWebhook` 里躺着 `void amountCents`，
而测试把「金额不一致照常授权」写成了期望（`subscription-payment.test.js` 原文）。

**根因**：折扣形态不是「加一个 if」，而是**账务口径的维度缺失**。没有 `payable_cents` 时，
「用户实付」这个事实无处存放，于是校验、退款、对账都只能拿标价近似 —— 近似值在促销期就是错的值。

**可复用的 3 条**：

1. 只要出现「同一数字既是展示价又是收款额」，就先拆列，再谈折扣。
2. `void someParam` 是**待办**不是实现：没有错误码的静默丢弃，任何静态扫描都抓不到，
   必须用「不等即拒绝」的行为测试锁住。
3. 测试里出现「不一致也照常通过」的用例时，先问它是不是把缺口写成了规格。

## CI 首轮红：契约锁锚点过时（2026-10-27）

`buyout-removal.contract.test.js` 第 ④ 组断言 `Subscription.vue` 必须含 `priceMonthlyCents`。
本次把价目行抽成 `PlanPriceTag.vue` 后，该字符串从父文件消失 → `QG Desktop Shards (1/2)` 红。

**为什么不是把组件内联回去**：`Subscription.vue` 贴着 500 行债务基线，内联 13 行会直接超 `check-max-lines`。

**为什么改锁是对的**：这条锁的意图是「三档价目展示必须仍在」。它原来用「文件里有这个字符串」当代理，
抽组件后代理失效但性质仍成立。现改为判**渲染链**——组件必须被会员中心挂载（`/<PlanPriceTag\b/`），
且金额绑定必须在渲染者里。两条一起判，比原来只判一个文件**更强**，不是放宽。

本地等价断言 4/4 PASS；本 worktree 的 electron 二进制未安装（`Electron failed to install correctly`），
故该契约测试由 CI 复跑取证。