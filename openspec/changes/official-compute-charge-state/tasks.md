# Tasks — official-compute-charge-state

> 进度以本文件为唯一来源。每组任务 ≤ 一个会话。

## 1. 规格与文档

- [x] `openspec/changes/official-compute-charge-state/`：proposal / design / tasks
- [x] `01-docs/PRD-OFFICIAL-COMPUTE-CHARGE-STATE-2026-10-25.md`：状态机 / 判定顺序 / 来源安全边界 / 9 条数据校验 / 11 条验收 / 8 条遗留边界
- [ ] `CHANGELOG.md` 未发布段 —— ⛔ 由执行记录聚合，**不要**在本 PR 直接改（`check-no-hot-carrier-edit.js` 判热写面）

## 2. TDD：先写失败测试

- [x] `ops-center/backend/tests/test_usage_event_charge_state.py`（**新增**，12 例）：
      纯函数判定 5 例（BYOK / 缺价 / 无用户 / 成本 0 / server 可扣）+
      **安全锁 2 例**（客户端来源绝不可 pending；客户端自称来源绕不过）+
      集成 4 例（落库为 unbillable + 待扣计数 0 / 周期落库 / BYOK 不入待扣 / 缺价点名）+
      迁移 1 例（11 列 + 幂等 + **判据侧自带期望清单**）
- [x] `electron/services/usage-reporter.test.js`：事件带 `user_id`（后绑定 provider）/ 拿不到留空
- [x] `electron/bootstrap/phase3-services.test.js`：phase3 把同一个 provider 挂给 reporter

## 3. 实现

### 3.1 ops-center

- [x] `backend/models_credit.py`：补 11 列 + `CHARGE_STATUS_*`（5 个）+ `CHARGE_SOURCE_*`（2 个）
- [x] `backend/services/credit_usage_event_migration.py`：幂等 ALTER（11 列，判据侧清单一致）
- [x] `backend/services/usage_event_service.py`：
      `resolve_charge_state()` 纯函数 + 入库写状态/周期/来源 + 响应读数（`charge_pending` / `charge_unbillable`）
- [x] `backend/services/usage_event_service.py`：`_STR_FIELDS` 收 `user_id`（**R5-1 遗留缺口**：漏收 ⇒ 事件行的 user_id 恒空）

### 3.2 桌面端

- [x] `electron/services/usage-reporter.js`：`setOwnerSubjectProvider()` + 事件带 `user_id`（拿不到留空）
- [x] `electron/bootstrap/phase3-services.js`：挂 provider（后绑定）+ `startServices` 签名加 `usageReporter`
- [x] `electron/bootstrap.js`：传 `usageReporter: context.usageReporter`

## 4. 验证

- [x] ops-center 定向：`pytest tests/test_usage_event_charge_state.py tests/test_usage_event_service.py` ⇒ **25/25 绿**
- [x] 桌面端定向：`usage-reporter.test.js` + `phase3-services.test.js` ⇒ **52/52 绿**
- [x] **变异验证 7 组全部 CAUGHT**（M1 来源判定 / M2 BYOK / M3 缺价 / M4 成本 0 / M5 迁移少列 / M6 不报 user_id / M7 不挂 provider）
- [x] 仓内门禁：`check-max-lines` / `check-debt-budget` / `check-no-brand-residue` / `check-doc-abs-paths` / `check-gate-record-debt` / `check-pr-exec-record`
- [x] 两口径 numstat 逐文件相等；U+FFFD 全文扫描 = 0

## 5. 遗留（不假装已闭合）

- [ ] **补扣执行体 + 调度宿主**（B-10 / U-14）—— 须人工拍板；**本刀刻意不做**（无可扣对象 ⇒ 恒空转的死代码）
- [ ] **额度预检读端点**（B-1 / U-13）—— 须人工过目（改暴露面）
- [ ] **预检与实扣竞态**（B-2）—— 需设计级决策
- [ ] **积分发放链路**（B-6）—— 须人工拍板（否则余额恒 0 ⇒ 恒 409）
- [ ] **D-① 官方算力代理**（ops-center 代调上游）—— 已定案根决策、**未落地** ⇒ **扣分链路的真正前置**
- [ ] **终态**（一直扣不动 ⇒ 坏账？跨周期？）—— 须人工拍板；本刀**不预设**
- [ ] 事件表保留期 / 归档
