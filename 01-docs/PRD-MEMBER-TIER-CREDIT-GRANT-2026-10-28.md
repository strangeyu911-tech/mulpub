# PRD：会员积分发放与 AI 写稿不限次（P1-5）

> 状态：✅ 已实现（2026-10-28）
> 上游：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.9；`01-docs/PRD-CREDIT-CONSUME-API-2026-10-25.md`（扣分端点）
> 数值真源：`packages/api-publish-engine/src/auth/plan-matrix.js`（`PLAN_MATRIX_VERSION = 2026-10-26`）

## 0. TL;DR

| 项 | 结论 |
|---|---|
| 官方积分 | 免费 30 / 标准 1500 / 专业 3000，按订阅周期发放 |
| 发放触发 | 兑换码核销、后台开通、支付回调、免费档 `/me` 首次访问 |
| 发放量 | `officialCreditMonthly × 周期月数`；30 天=1、90 天=3、365 天=12 |
| 幂等键 | `subscription:<subscriptionId>:<periodStart>`，重复调用不重复加余额 |
| 扣减 | 复用既有 `POST /api/v1/credit/consume`，不在客户端扣 |
| AI 写稿 | 全档不限次数（`aiWriteMonthly=-1`），官方模型走积分，BYOK 不扣 |
| 本片不做 | 定时月度续发、按日预扣/补扣、退款回收、客户端余额页 |

## 1. 背景

v3.1 机制把 AI 写稿改为「不限次数 + 官方积分计量」。`plan-matrix` 已声明
`officialCreditMonthly`，但生产代码里 `grantCredit` 的调用方为 0：订阅生效后余额恒为 0，
`/api/v1/credit/consume` 只能 fail-closed 返回 409，官方算力链路无法真正启用。

P1-5 补上「发放」这一半，并把「AI 写稿全档不限次」从矩阵断言固化为可回归的契约。

## 2. 范围

### 2.1 发放

| 通道 | 触发点 | 周期起点 | 周期终点 |
|---|---|---|---|
| 兑换码 | `SubscriptionService.redeem()` 事务提交后 | `applied.periodStart` | `applied.periodEnd` |
| 后台开通 | `SubscriptionService.grant()` 事务提交后 | 同上 | 同上 |
| 支付回调 | `settlePaymentWebhook()` 事务提交后 | 同上 | 同上 |
| 免费档 | `getSubscriptionView()` 发现 `plan=free` | 当月 1 日 00:00 UTC | 下月 1 日 00:00 UTC |

### 2.2 周期月数

```
days = (periodEnd - periodStart) / 86400000
months = clamp(round(days / 30), 1, 12)
amount = officialCreditMonthly × months
```

- 30 天 → 1 个月：标准 1500、专业 3000
- 90 天 → 3 个月：标准 4500、专业 9000
- 365 天 → 12 个月：标准 18000、专业 36000
- 免费自然月 → 30

> 年付「按月等额」的总额与一次发放 12 个月等价；本片不引入月度定时器，避免在无调度宿主时
> 产生「到期不续发」的空窗。后续若做月度续发，只需把同一 `refId` 规则改为每月 periodStart。

### 2.3 幂等

- `refType = 'subscription_period'`
- `refId = subscription:<subscriptionId>:<periodStart ISO>`
- 同一订阅同一周期重复发放 → `grantCredit` 命中既有分录，返回 `duplicated=true`，余额不重复增加
- 续费/顺延时 `periodStart` 变为上一周期结束，`refId` 自然变化，正常再发

### 2.4 失败语义

- 订阅事务已提交后发放失败：**不回滚订阅**，错误上抛；调用方重试时靠 `refId` 幂等补齐。
- `creditRepository` 未注入（旧装配/单测）：跳过发放，不阻断订阅主链路。
- `officialCreditMonthly` 缺失、0、负数：不发放（负数=不限，积分账本无法表示无限余额）。
- `periodStart/periodEnd` 非法：不发放，返回 `period-invalid`。

### 2.5 AI 写稿

`plan-matrix.getPlanEntitlement(plan).quota.ai_write_monthly` 三档均为 `-1`：

- 客户端不按次数拦截；
- 官方模型由扣分端点按实际成本扣积分；
- BYOK 调用不产生官方积分扣减（`usage-reporter` 的 `byok=1` 透传）。

本片不新增 AI 写稿次数限制，也不改扣分端点契约。

## 3. 代码落点

| 文件 | 作用 |
|---|---|
| `packages/api-publish-engine/src/auth/credit-grant.js` | 纯函数：周期月数、发放量、幂等发放 |
| `packages/api-publish-engine/src/auth/subscription-credit-grant.js` | `SubscriptionService` mixin：`_grantCreditsForApplied` / `_grantFreeMonthlyCredits` |
| `packages/api-publish-engine/src/auth/subscription-service.js` | redeem/grant/getSubscriptionView 接线 |
| `packages/api-publish-engine/src/auth/subscription-payment.js` | 支付回调接线 |
| `packages/api-publish-engine/src/auth/logto-runtime.js` | 用 `repository.pool` 装配 `PostgresCreditRepository` |
| `packages/api-publish-engine/test/credit-grant.test.js` | 周期/金额/幂等/降级 |
| `packages/api-publish-engine/test/subscription-credit-grant.test.js` | mixin 发放与免费月发 |

## 4. 验收标准

- [x] 标准月付发 1500，专业月付发 3000，免费自然月发 30
- [x] 标准年付发 18000，专业年付发 36000
- [x] 同一订阅同一周期重复调用不重复加余额
- [x] 兑换码 / 后台开通 / 支付回调三条通道均调用发放
- [x] `creditRepository` 未注入时不阻断订阅
- [x] `aiWriteMonthly=-1` 三档断言存在
- [x] 既有 subscription-service 29 例不回归

## 5. 非目标

- 月度定时续发（无调度宿主；一次发满周期）
- 预扣/并发竞态（由扣分端点 fail-closed + 后续预扣设计处理）
- 退款/降级回收已发积分
- 客户端积分余额页 / 流水页
- 免费档注册即发（当前在首次 `/me` 访问时发，避免注册链路改造）

## 6. 风险

| 风险 | 处置 |
|---|---|
| 订阅已提交、发放失败 | 错误上抛 + `refId` 幂等；重试/运维补发不重复 |
| 年付一次发 12 个月，用户中途退款 | 本片不回收；退款策略后续单独定 |
| 免费档 `/me` 触发发放 | `refId` 按月幂等；无 `/me` 不发放，属可接受延迟 |
| 时区 | 免费档用 UTC 自然月，避免本地时区跨月不一致 |
| 积分单价/额度调整 | 仍以 `officialCreditMonthly` 为唯一字段，改矩阵即全链路生效 |
