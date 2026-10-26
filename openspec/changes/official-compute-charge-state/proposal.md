## Why

官方算力第 5 轮 R5-2。前一刀（#4463）把「事件级用量」接通了：一次 provider 调用落一条
`model_usage_events`，服务端按价格卡算出 `cost_micros` / `credit_cost`。

但**「算出来」离「扣得掉」还差三样**，且这一刀正好撞上一个**会被真金白银赔上的设计陷阱**：

1. **没有「该不该扣」的判定** ⇒ 事件算完成本就躺着，没人决定它是不是一笔该扣的账。
2. **扣不动的事件无处记录** ⇒ 挂起 = 永久白送（DESIGN §13.2 B-10）。
3. ⚠⚠ **客户端上报的 `user_id` 是客户端自称的**（上报端点只认静态 `X-Catalog-Key`，
   **请求里没有任何用户身份**）⇒ **若拿它去扣分，恶意客户端上报别人的 sub 就能扣别人的积分**。

第 3 条是**安全红线**，不是「将来收紧」的问题 ⇒ 必须现在就钉进代码。

## What Changes

- **扣分状态机**（`ModelUsageEvent` 补 11 列 + 幂等 ALTER 迁移）：
  `charge_status`（`not_applicable` / `free` / `unbillable` / `pending` / `settled`）、
  `charge_source`（`client` / `server`）、`charge_period_start` / `charge_period_end`、
  `pending_charge_at`、`retry_count`、`charge_error`、`charged_at`。
- **状态判定是纯函数** `resolve_charge_state()`（`services/usage_event_service.py`）
  ⇒ 客户端入口与将来的代理入口**共用一份** ⇒ 不会出现两处实现漂移。
- **★ 安全红线**：来源不可信 ⇒ `unbillable` + `UNTRUSTED_IDENTITY` ⇒
  **客户端事件永远不进扣分队列**（`charge_source` 缺省 = `client` = 安全侧）。
- **周期在事件发生时算好并落库**（自然月 / UTC）⇒ 补扣跨月时周期不错位。
- **桌面端事件带 `user_id`**（Logto sub）：`usage-reporter.setOwnerSubjectProvider()` 后绑定
  （与 `store` / `accountManager` / `runStateStore` 同款先例），phase3 挂同一个 provider；
  **拿不到就留空**（不编造）。
- **刻意不写补扣执行体**：现在 `pending` 恒为空 ⇒ 写出来是**恒空转的死代码** ⇒
  执行体与调度宿主（U-14）等 D-① 代理落地（或平台签名凭证落地）后再做。

## Capabilities

### New Capabilities

- `official-compute-charge-state`: 官方算力扣分**状态机**的契约——五个状态与判定顺序、
  事件来源的安全边界（客户端来源永不进扣分队列）、发放周期随事件落库、扣分尝试的可观测字段
  （`pending_charge_at` / `retry_count` / `charge_error`）。

## Impact

- **ops-center 后端**：
  - `backend/models_credit.py`（补 11 列 + 5 个状态常量 + 2 个来源常量）
  - `backend/services/usage_event_service.py`（`resolve_charge_state()` 纯函数 + 入库写状态 + 响应读数）
  - `backend/services/credit_usage_event_migration.py`（幂等 ALTER，11 列）
  - `backend/tests/test_usage_event_charge_state.py`（**新增**，12 例）
- **桌面端**：
  - `electron/services/usage-reporter.js`（`setOwnerSubjectProvider` + 事件带 `user_id`）
  - `electron/bootstrap/phase3-services.js`（挂 provider）
  - `electron/bootstrap.js`（把 `context.usageReporter` 传给 phase3）
  - `electron/services/usage-reporter.test.js`（+2 例）、`electron/bootstrap/phase3-services.test.js`（+1 例）
- **文档**：`01-docs/PRD-OFFICIAL-COMPUTE-CHARGE-STATE-2026-10-25.md`（口径 / 判定顺序 / 9 条数据校验 / 11 条验收 / 8 条遗留边界）
- **不触碰**：扣分端点（#4458 已做）、价格卡、会员定价、发放链路、任何用户可见界面与文案
