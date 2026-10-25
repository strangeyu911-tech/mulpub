# Tasks — official-compute-usage-events

> 进度以本文件为唯一来源。每组任务 ≤ 一个会话。

## 1. 规格与文档（先文档再代码）

- [x] `openspec/changes/official-compute-usage-events/`：proposal / design / tasks
- [x] `01-docs/PRD-OFFICIAL-COMPUTE-USAGE-EVENTS-2026-10-25.md`：口径表 / 流程 / 功能逻辑 / 10 条数据校验 / 14 条验收 / 8 条遗留边界
- [x] `01-docs/usage-metering-spec.md` §4.3：事件级通道与四个用量维度（**真源**）
- [ ] `CHANGELOG.md` 未发布段 —— ⛔ 由执行记录聚合，**不要**在本 PR 直接改（`scripts/check-no-hot-carrier-edit.js` 会判热写面）

## 2. TDD：先写失败测试

- [x] `ops-center/backend/tests/test_usage_event_service.py`（新增）：三个非 token 维度抽出 unit / 音频分流 / 零维度不进 counts / token 与非 token 共存 / 事件入库后服务端算成本 / 客户端报的成本不参与计算 / 积分换算 / `event_id` 重报幂等 / `event_id` 空拒 / 负数维度拒 / 缺价被点名 / BYOK 不计官方成本
- [x] `electron/services/usage-dimensions.test.js`（新增）：权威来源优先 / 三维度各自来源 / 脏输入不变成假数字 / 小数向上取整 / 缺参不抛
- [x] `electron/services/store/model-log-store.test.js`（**新增**）：**存储层维度锁 7 条**（秒数/张数/字符数/spec 入列；抽不到写 NULL；`byok` 缺省 1；显式 0 才算官方算力；显式值不被自动抽取覆盖；既有列不受影响）
- [x] `electron/services/model-provider-call-adapter.test.js`：**原料交接锁 1 条**（manager 把 `params`/`result` 交给存储层；且**不得**自己判 `byok=0`）
- [x] `electron/services/usage-reporter.test.js`：事件流 4 条（一次调用一条 + 带维度 + 不报成本 / 事件水印与日桶水印互不影响 / 失败保留水印 / 未配置 auth 静默跳过）

## 3. 实现

### 3.1 ops-center 后端

- [x] `backend/models_credit.py`：`ModelUsageEvent` 补 `duration_seconds` / `item_count` / `char_count`
- [x] `backend/services/credit_usage_event_migration.py`（新增）：幂等补列（SQLite `create_all` 不改已有表）
- [x] `backend/main.py`：启动时调用 `ensure_model_usage_event_columns`
- [x] `backend/services/credit_price_service.py`：`USAGE_FIELD_TO_UNIT` + 音频分流（`per_second_audio`）+ `token_counts_from_event` 扩非 token 维度
- [x] `backend/services/usage_event_service.py`（新增）：事件校验 / 入库 / 服务端算成本 / 幂等 / 缺价点名 / BYOK 记 0
- [x] `backend/routers/usage.py`：新增 `POST /api/v1/usage/events`（`require_catalog_key` 鉴权）
- [x] `backend/tests/fixtures/auth-surface.json`：重生成（`python scripts/auth_surface.py --emit`）

### 3.2 桌面端

- [x] `electron/services/usage-dimensions.js`（新增）：用量维度提取（纯函数，权威来源优先，抽不到就是 0）
- [x] `electron/services/store/model-provider-logs-schema.js`（新增）：`model_provider_logs` 建表 SQL + 五列幂等 ALTER
- [x] `electron/services/store-schema.js`：引用新模块（499 → **489**，避开 `NEW_OVER_LIMIT`）
- [x] `electron/services/store/base-store.js`：启动时调用 `migrateModelProviderLogsSchema`
- [x] `electron/services/store/model-log-store.js`：**维度判定与写列的归属**（调 `usage-dimensions.js`；写五列）
- [x] `electron/services/model-provider-manager.js`：`_writeLog` 交出原料 `params`/`result` + 压缩注释 ⇒ **1284 行 = target，不超**；**零新增 require** ⇒ 扇出保持 66
- [x] `electron/services/usage-reporter.js`：新增事件流 `reportEvents()`（独立水印 `opsCenterUsageEventReport`，单次 ≤ 500 条）

## 4. 验证

- [x] ops-center 定向：`pytest tests/test_usage_event_service.py` ⇒ 13/13 绿
- [x] ops-center 全量：`pytest tests/ -q` ⇒ 766 passed / 2 failed ⇒ 其中 1 个是**鉴权面 fixture**（已随新端点重生成 ⇒ 复跑绿）、1 个是**沙箱缺 `imageio-ffmpeg`**（装上即绿 ⇒ 与本次改动无关）
- [x] 桌面端定向：`usage-dimensions.test.js` ⇒ 10/10；`store/model-log-store.test.js` ⇒ 7/7；`model-provider-call-adapter.test.js` ⇒ 50/50；`usage-reporter.test.js` ⇒ 12/12（四个文件合计 **78/78**）
- [x] **变异验证 4 组全部被抓住**：M1 去掉非 token 维度映射 / M2 去掉音频分流 / M3 移除 `event_id` 唯一约束 / M4 去掉缺价点名
- [x] 行数门禁：`node .github/scripts/check-max-lines.js` ⇒ ✅ 无新增超大文件
- [x] **require 扇出**：`model-provider-manager.js` 的唯一 require 数 = **66**（= 基线，不增）⇒ 债务熔断不红
- [x] U+FFFD 全文扫描 = 0

## 5. 遗留（不假装已闭合）

- [ ] **R5-2**：扣分端点 `POST /api/v1/credit/consume` + `GET /api/v1/credit/account` + 专用服务凭据/scope/白名单/审计 + 补扣调度
- [ ] **R5-3**：MiniMax H3 V2 适配器（中国站 `api.minimax.cn/v2` + `content` 数组）⇒ H3 的 `usage.total_seconds` 才有来源；官方 Key 池路由 ⇒ `byok=0` 才有来源
- [ ] **R5-4**：灌 8 张 MiniMax 价格卡 + 回算传真实 model/spec + 「缺维度即报错」守卫
- [ ] 事件表保留期 / 归档策略
- [ ] 事件流与日桶流双失败时的退避与告警升级
