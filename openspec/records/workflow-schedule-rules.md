---
record: workflow-schedule-rules
task: 排期规则（P1-10）
date: 2026-10-27
---

## 本次执行记录：排期规则（workflow-schedule-rules，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 主进程 + 渲染层 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-schedule-rules`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 新能力 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | 模块/pacer/schema/editor 测试；max-lines 待跑 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PASS | `ccg-review.ps1 -Mode Deep`：i1–i5 已修复/文档同步；external evidence 见 PR #4568 issuecomment-6446633925 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- workflow 全量 + editor：**129 tests passed**（11 文件）；覆盖默认关闭、跨午夜静默顺延、周末顺延、非法时区/空工作日/相同起止拒绝、pacer 首条顺延、UI 时区/静默写入。
- `build:vue` 成功；QM-1 三阶段 PASS；locale symmetry PASS；max-lines PASS（抽取 WorkflowScheduleRules/WorkflowAccountPicker 后 WorkflowEditor 344 行）。

### 边界

- 不做节假日/农历/调休。
- 工作流级时区，不按平台不同时区。
- 只影响新排期，已入队 publishAt 不改。
- 每日上限复用 guardrails.dailyItemLimit，不新增字段。

## CHANGELOG 条目

# feat(automation): 排期规则（P1-10）

- scheduleRules 支持时区/工作日/跨午夜静默时段。
- createPacer/estimatePlan 接入规则；UI 可配置。
- 默认关闭，升级不改变旧任务。

## learnings

### lesson: 默认关闭是兼容性策略，不是功能缺失

排期规则会改变既有任务的发布时间；默认 enabled=false 让升级不惊吓用户，再由用户主动开启。任何改变时间语义的功能都应先默认不生效。
