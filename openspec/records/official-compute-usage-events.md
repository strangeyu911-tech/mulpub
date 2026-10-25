---
record: official-compute-usage-events
task: 官方算力事件级用量通道 —— 补齐秒/张/字符三维度、事件入库与成本服务端自算
date: 2026-10-25
---

## 本次执行记录：官方算力事件级用量通道（official-compute-usage-events，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 混合 PR（运行时代码 + 文档） | worktree `mp-worktrees/mp-official-compute-usage-events`、裸分支 `official-compute-usage-events`；`classify-docs-only` ⇒ docs-only=false |
| 第一性原因（QM-5 ①） | 通过 | 四条缺口都回源码逐条核对：`models_credit.ModelUsageEvent` 无三列；`credit_price_service.TOKEN_FIELD_TO_UNIT` 只映射 5 类 token；`/usage/ingest` 只 upsert `ModelUsageDaily` ⇒ `ModelUsageEvent` 零写入方；桌面端 `model_provider_logs` 无三列且 `usage-reporter` 只有日桶流。**共同失败形态：成本算成 0 且不报任何错** |
| 逃逸分析（QM-5 ②） | 已封 | ① 非 token 维度映射（M1）② 音频秒数分流（M2）③ `event_id` 唯一约束（M3）④ 缺价点名（M4）—— **4 组变异全部被抓住**；另有桌面端接线锁 2 条（维度真的进 `addProviderLog`、`byok` 缺省为 1）防「叶子模块单测全绿但生产零引用」 |
| 修复 + 回归保护（QM-5 ④） | 通过 | 服务端：`usage_event_service`（校验/入库/服务端算成本/幂等/缺价点名/BYOK 记 0）+ `credit_price_service` 扩映射 + 幂等补列迁移 + 新端点 `POST /api/v1/usage/events`；桌面端：`usage-dimensions` + `model-log-entry` 两个纯函数 + `store/model-provider-logs-schema` + 事件流 `reportEvents()`（独立水印） |
| 防止再次发生（QM-5 ⑤） | 通过 | 口径写进 `01-docs/usage-metering-spec.md` §4.3（**唯一真源指向** `credit_price_service` 的两张映射表，不允许各写一份）；桌面端形状假设集中在 `usage-dimensions.js` 一个纯函数里；openspec `design.md` §2/§3/§6 记「水印独立」「权威来源优先」「缺省方向是不扣」三条决策 |
| 行尾与 diff 对账 | 通过 | 两口径 numstat 逐文件相等（`git diff <merge-base> HEAD --numstat` 与 `--ignore-cr-at-eol --numstat`）；U+FFFD 全文扫描 = 0 |
| 接线棘轮 | 通过 | 新增 `electron/services/usage-dimensions.test.js` 落在 `electron/services/**` ⇒ 已被 `apps/desktop/vitest.config.js` 的 include 白名单覆盖（该 glob 覆盖本目录）；新增 ops-center 测试 `tests/test_usage_event_service.py` 走 pytest 全量 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面与界面（本刀是数据通道，**无用户可见界面**） |
| QM-6 CCG 双模型外部评审 | **未执行** | 本机无 `codeagent-wrapper` ⇒ 如实写未执行；降级证据 = 仓内断言 + 4 组变异验证 + 逐条源码对账（不冒充外部评审通过） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属 |

### 遗留（不假装已闭合）

- **R5-2**：扣分端点 `POST /api/v1/credit/consume` + `GET /api/v1/credit/account` + 专用服务凭据 / scope / IP 白名单 / 审计 + 补扣调度（幂等键 = event_id）。
- **R5-3**：MiniMax H3 V2 适配器（中国站 `api.minimax.cn/v2/video_generation` + `content` 数组）⇒ H3 的 `usage.total_seconds` 才有来源；官方 Key 池路由 ⇒ `byok=0` 才有来源。
- **R5-4**：灌 8 张 MiniMax 价格卡 + 回算传真实 model/spec + 「缺维度即报错」守卫。**在此之前官方算力事件必然报「缺价」——那是正确的缺价，不是缺陷。**
- 事件表保留期 / 归档策略。
- 事件流与日桶流**双失败**时的退避与告警升级（当前只 warn 一行）。
- BYOK 的服务端侧判定口径（当前由客户端显式声明 `byok`，**服务端不自行推断**——推断需要官方 Key 池的真相源，属 R5-3）。

### 本轮踩到并当场修掉的两个真问题（记在案里，别再踩）

1. **ops-center 的事件入库事务冲突**：`load_effective_cards` 的 SELECT 已 autobegin 一个事务 ⇒ 再 `async with db.begin()` 报
   `A transaction is already begun on this Session` ⇒ 改为 `add + commit`。
2. **两处行数门禁当场变红**（不是事后才发现）：
   - `model-provider-manager.js` 在 `targets`（1284、**容差 0**）⇒ 新增字段让它超 14 行 ⇒ **抽 `model-log-entry.js`**（⇒ 1270）；
   - `store-schema.js` 在主干是 **499 行**（上限 500、零余量）⇒ 任何净增触发 `NEW_OVER_LIMIT` ⇒ **抽 `store/model-provider-logs-schema.js`**（⇒ 489）。
   ⇒ 纪律：**不许再长的文件 ⇒ 抽模块，不抬基线**（改基线 = 改「谁来守门」，须人工过目）。

## CHANGELOG 条目

# feat(官方算力): 新增事件级用量通道，成本改由服务端按价格卡算（official-compute-usage-events）

- 官方算力的成本归集从「客户端估算」改为「服务端按价格卡算」：一次 provider 调用落一条事件，
  带 spec / 秒数 / 张数 / 字符数四个用量维度 ⇒ 视频、图像、语音第一次能按实际用量计价。
- 桌面端日志表补齐四个维度列与 byok 标记；日志组装与维度提取抽成两个纯函数
  （`model-log-entry.js` / `usage-dimensions.js`），形状假设集中一处、可逐条钉死。
- 缺价格卡不再静默按 0：成本照记 0，但会在上报响应与服务端日志里**点名**
  ⇒ 运营能看见「成本算成 0」这件事，而不是以为免费。
- 用户自带 Key 的调用标为 BYOK，**不扣官方积分**（缺省方向是「不扣」：错扣比不扣更糟）。

## learnings

### lesson: two-streams-same-table-need-independent-watermarks

**形态**：两条上报流（日桶 + 事件）读**同一张**本地表，若共用一个水印键，
先推进的那条会让后一条 `WHERE id > watermark` **永远看不到那些行** ⇒ 少一半数据，**不报任何错**。

**判据**：任何「多条流读同一张表」的场景 ⇒ **水印必须按流分键**；
测试里要有一条断言「推进 A 的水印**不会**动 B 的水印」。

**泛化**：症状是「数据静默少一半、没有任何报错」⇒ 这类缺陷只能靠**结构性锁**（水印键分离）挡住，
不能靠「跑一遍看看」。

### lesson: absent-dimension-looks-like-free

**形态**：成本算成 0 的原因有三种：① 真的免费 ② 没有价格卡 ③ **维度没采到**。
三者都表现为「成本 0」⇒ 错误长得像正确。

**判据**：缺价/缺维度必须**被点名**（响应字段 + 日志），让「算成 0」与「本来就免费」可区分；
维度提取抽不到时**返回 0 而不是猜一个值**——0 会被报成「缺价」（可见），猜出来的值会让成本错得看不见。

### lesson: byok-default-must-be-do-not-charge

**形态**：`byok` 标记的缺省值方向选错 ⇒ 用户自己的 Key 消耗被当成官方算力 ⇒ **给用户错扣积分**。

**判据**：计费类标记的缺省必须落在**「不向用户收钱」那一侧**；
错扣的代价（用户投诉 + 退款）远高于少扣（营收损失但可事后补）。
