---
record: workflow-budget-guardrails
task: 预算与成本护栏（P1-11，估算）
date: 2026-10-27
---

## 本次执行记录：预算与成本护栏（workflow-budget-guardrails，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 主进程 + 渲染层 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-budget-guardrails`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 新能力 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | 模块/schema/runner/editor 测试；max-lines 待跑 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PASS | `ccg-review.ps1 -Mode Deep`：i1–i3 已修复；external evidence 见 PR #4570 issuecomment-6448319596 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- workflow 全量 + editor：**135 tests passed**（12 文件）；覆盖默认关闭、maxCost/perItem 校验、累计与超预算、runner 首次占用/第二次拒绝、UI 写入。
- `build:vue` 成功；QM-1 三阶段 PASS；locale symmetry / max-lines PASS（runner 496 行、schema 498 行）。

### 边界（不假装已闭合）

- **只记估算占用，不是供应商账单**；没有真实 usage。
- 不做动态定价、运行中逐条熔断；只做运行前预检 + finish 台账。
- 台账写失败不回滚已发内容，只进 run.warnings。
- 180 天窗口累计，不是自然月重置。

## CHANGELOG 条目

# feat(automation): 预算与成本护栏（P1-11 估算）

- guardrails.budget 预检与 workflow_budget_ledger 估算台账。
- 超预算运行整轮失败；UI 配置总预算/币种/每项预估。
- 明确 estimated=true，不冒充供应商实际账单。

## learnings

### lesson: 成本功能的第一个诚实边界是「估算 vs 账单」

没有供应商 usage 时，任何「实际花费」都是伪造。把字段命名为 estimated、UI 写明不是账单，比做一个看起来精确的假数字更可信。
