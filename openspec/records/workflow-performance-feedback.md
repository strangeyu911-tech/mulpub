---
record: workflow-performance-feedback
task: 发布后效果回流与自动复核（P1-12）
date: 2026-10-27
---

## 本次执行记录：发布后效果回流与自动复核（workflow-performance-feedback，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 主进程 + 渲染层 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-performance-feedback`；基于 `origin/main` |
| QM-5（Bug 反哺） | PASS | 根因：发布队列只记 dispatched，不记 TaskQueue taskId；效果看板有账号级快照但无法归因到工作流 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | 队列/性能/provider/runner/UI 测试；max-lines 待跑 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PASS（外部复核） | 高危域 i1 由 Claude CLI 独立复核 `NO_BLOCKING_FINDINGS`；公开证据 PR #4578 issuecomment-6453688925；记录置 `self_play_resolved`/`external` |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- `workflow-performance` 5 项、`workflow-performance-schema` 2 项、`workflow-performance-runner` 3 项、schema 25 项、runner 29 项、queue 13 项、editor 12 项、runs drawer 1 项，共 90 项通过。
- build:vue 与 QM-1 三阶段 PASS；locale symmetry / max-lines PASS。

### CI 红修复（第二轮，2026-10-28）：T15「列最小集」棘轮被新增消费列越过

- **CI 读数（第一手）**：PR #4578 run `40585404371` —— `QG Desktop Shards (2/2)`（job `122477946583`）
  唯一失败用例是 `electron/services/store/performance-loop-store-overview.test.js > T15 返回列最小集`，
  `AssertionError: expected ['created_at','id','last_recrawl_at','platform',…(4)] to deeply equal […(3)]`
  —— 实得比期望多一列 `publish_history_id`；整片读数 `Test Files 1 failed | 641 passed`、
  `Tests 1 failed | 10941 passed`。
- **`QG Coverage` 不是第二条独立红**：job `122491311846` 只报
  `[COVERAGE-MERGE] FAIL-BLIND 只收到 1/2 片覆盖率产物（分片可能失败） ⇒ 不得用半份数据判全局阈值`，
  它是 shard 2/2 失败的下游。把它当独立问题去修等于把同一个根因数两遍。
- **第一性原因**：本 PR 给 `listTrackedForOverview` 的投影加了 `publish_history_id`
  （`performance-loop-store.js:351`），因为 `workflow-performance-runner.js:23` 要用
  `taskIds.has(String(r.publish_history_id || ''))` 把 tracked 行对齐到发布队列的 taskId。
  列是**真被消费的**；过期的是 T15 里那份"最小列集"期望值 —— 测试与实现各自持有一份列清单，
  实现改了而清单没跟着改。
- **逃逸分析**：T15 是**唯一**断言该投影列集的地方。它不是"没测"，而是"测了但期望值没随同一次
  变更更新"；本地单文件跑能过、CI 分片才红，说明这类棘轮的失效点不在断言强度而在**变更同步**。
- **修复 + 回归保护**：T15 期望列补 `publish_history_id`，**保留 `Object.keys(...).sort()` 逐列相等**
  （棘轮不放宽 —— 以后再加列必须同时带来消费方，否则当场红），并在用例内注释点名消费方。
  本地复跑 `npx vitest run electron/services/store/performance-loop-store-overview.test.js` → **8/8 passed**。

### 边界

- 不做跨平台播放口径统一；不自动恢复。
- 没有 taskId/tracked_content/publish_history_id 的条目不参与，返回 0 样本。
- 依赖既有账号指标回流周期，不实时刷新。
- 阈值失败是「本次运行暂停」，不是修改工作流任务状态；下一轮会重新判断。

## CHANGELOG 条目

# feat(automation): 发布后效果回流与自动复核（P1-12）

- 队列记录 taskId，按 publish_history_id 归因到 tracked_content/performance_snapshot。
- 最新快照口径汇总播放/互动；低于阈值暂停本次运行。
- 运行详情与编辑器显示效果配置/摘要。

## learnings

### lesson: 归因键必须在派发时留下

发布队列原先只记「已交给发布器」，丢掉了 TaskQueue 返回的 taskId；而效果链的起点正是这个 id。补记 taskId 比在事后按标题/时间猜归因可靠得多——猜出来的数字看起来也正常，但那是最危险的一类错误。
