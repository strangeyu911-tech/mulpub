# member-tier-p1-5-credit-grant 执行记录

> 分支 `member-tier-p1-5-credit-grant` ｜ worktree `mp-member-tier-p1-5-credit-grant`（D 盘隔离区）
> 上游：`01-docs/PRD-MEMBER-TIER-CREDIT-GRANT-2026-10-28.md`；`01-docs/MECHANISM-MEMBER-TIERS.md` v3.9

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

## 一、一句话

P1-5：订阅生效（兑换/后台/支付）后按 `officialCreditMonthly × 周期月数` 发放官方积分，免费档在 `/me` 按自然月发放 30；`refId` 幂等；AI 写稿三档 `-1` 契约固化。

## 二、产出

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/credit-grant.js` | 周期月数/发放量/幂等发放纯函数 |
| `packages/api-publish-engine/src/auth/subscription-credit-grant.js` | SubscriptionService mixin：订阅/免费月发放 |
| `packages/api-publish-engine/src/auth/subscription-service.js` | redeem/grant/getSubscriptionView 接线；`creditRepository` 注入 |
| `packages/api-publish-engine/src/auth/subscription-payment.js` | 支付回调事务提交后发放；返回 periodStart |
| `packages/api-publish-engine/src/auth/logto-runtime.js` | 用 `repository.pool` 装配 `PostgresCreditRepository` |
| `packages/api-publish-engine/test/credit-grant.test.js` | 周期/金额/幂等/降级 4 例 |
| `packages/api-publish-engine/test/subscription-credit-grant.test.js` | mixin 发放 + 免费自然月 2 例 |
| `01-docs/PRD-MEMBER-TIER-CREDIT-GRANT-2026-10-28.md` | 新增 P1-5 PRD |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.9：积分发放、AI 写稿、缺陷 G、历史 |

## 三、口径

- 发放量 = `officialCreditMonthly × clamp(round(days/30),1,12)`：30→1、90→3、365→12。
- 幂等键 `subscription_period` + `subscription:<id>:<periodStart ISO>`；续费 periodStart 前移，自然再发。
- 订阅事务先提交、发放后执行；发放失败不回滚订阅，错误上抛，重试幂等补齐。
- `creditRepository` 未注入时跳过（旧装配/单测），不阻断订阅。
- 免费档在 `getSubscriptionView` 发现 `plan=free` 时按 UTC 自然月发放 30，`refId` 月内幂等。
- 消费沿用既有 `POST /api/v1/credit/consume`，本片不新增扣分入口。
- AI 写稿 `ai_write_monthly = -1` 三档，官方模型扣积分、BYOK 不扣。

## 四、测试读数

| 项 | 读数 |
|---|---|
| `credit-grant.test.js` | **4 passed** |
| `subscription-credit-grant.test.js` | **2 passed** |
| `subscription-service.test.js` | **29 passed** |
| `api-publish-engine` 全量 | **504 passed / 47 files** |
| max-lines / doc-abs-paths | PASS |

## 五、QM-1

本 PR 未改 `apps/desktop/electron/` 或 `packages/rpa-engine/`，QM-1 不适用。

## 六、QM-4（视觉）

无 UI 变更，QM-4 不适用。

## 七、QM-6（深度评审）

- 首轮 `deep-review.sh`：DUAL（222 行 > 200），4 条问题，最低分 4。
- 第二轮（本轮最终 diff）：DUAL（238 行 > 200），5 条问题，最低分 5，无高危域。
- 逐条处置：
  - i1（Critical，`periodMonths(end<=start)` 返回 1）：**成立，已修**——无效周期返回 0，`resolveGrantAmount` 同步返回 0；发放前先校验周期，测试覆盖反转周期。
  - i2（High，免费档每次 `/me` 触发 grant 查重）：**接受**——`refId` 月内幂等，单次索引查重低于新增缓存失效逻辑；后续读放大再优化。
  - i3（Warning，支付回调响应无 grant 状态）：**接受**——回调是服务间接口，发放结果由账本与运维补发脚本核对；不扩 HTTP 契约。
  - i4（Warning，订阅提交后发放失败无即时反馈）：**接受**——mixin 捕获并返回 `grant-failed`，不把已收款请求判 500；按幂等 `refId` 补发，PRD §2.4 已写明。
- 首轮 i2（`this.now` 未定义）为假阳性：`SubscriptionService` 构造函数已定义。
- 公开证据见 PR 评论。


## 八、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | 月度定时续发（当前按周期一次发满） | 后续调度宿主 |
| 2 | 预扣/并发竞态 | 官方算力接线后续 |
| 3 | 退款/降级回收已发积分 | P3 |
| 4 | 客户端积分余额/流水页 | 后续 |
| 5 | 免费档注册即发（当前首次 `/me`） | 后续注册链路 |

## CHANGELOG 条目

# 会员积分发放：订阅/兑换/支付/免费档按周期发放 30/1500/3000

- `credit-grant` 纯函数：周期月数、发放量、幂等 refId
- `SubscriptionService` 在兑换/后台开通/支付回调后发放；免费档按 UTC 自然月发放 30
- 发放失败不回滚订阅；`creditRepository` 未注入时跳过
- 消费沿用 `/api/v1/credit/consume`；AI 写稿三档 `-1` 契约固化
- 测试：504 例 API 全绿；新增 6 例发放测试
