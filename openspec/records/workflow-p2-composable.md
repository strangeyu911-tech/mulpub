---
record: workflow-p2-composable
task: P2 工程质量收口（账号选择 composable / schemaVersion）
date: 2026-10-27
---

## 本次执行记录：P2 工程质量收口（workflow-p2-composable，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 渲染层 + 主进程 schema + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-p2-composable`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 结构重构/版本字段 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | composable/schema/editor 测试；max-lines 待跑 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PENDING | 提交后跑 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- `useAccountSelection.test.js` 3 项、`WorkflowEditor.test.js` 11 项、`workflow-schema.test.js` 24 项，全部通过。
- 覆盖：同平台多账号、numeric 0、toggle、搜索、全选只加可用账号；旧配置无 schemaVersion → 2。
- `WorkflowAccountPicker.vue` 从 150+ 行降到 59 行；逻辑可脱离模板单测。

### 边界（P2 未全闭）

- 本 PR 只做 #15/#17；#16 账本导出/重置 UI、#18 E2E/视觉、#19 虚拟列表、#20 语义类型仍待做，ROADMAP 保留「待做」。
- `AutomationTaskDialog` 本身未在本 PR 继续拆分（当前 465 行，低于 500 硬限）；账号选择已抽为组件+composable。
- schemaVersion 只标记任务配置；模板版本 `TEMPLATE_VERSION` 独立。

## CHANGELOG 条目

# refactor(automation): 账号选择 composable 与 schemaVersion（P2 #15/#17）

- `useAccountSelection` 抽离账号选择逻辑，picker 仅渲染。
- `SCHEMA_VERSION=2`，旧配置归一化。
- 同平台多账号/numeric 0 独立测试。

## learnings

### lesson: 「组件抽出去」不等于「逻辑可测」

P1-8 把账号选择抽成组件后，组件仍有 150 行脚本；逻辑与模板耦合时只能靠挂载测。再抽一层 composable，numeric 0、同平台双账号、全选过滤这些规则才能直接单测，也才真正降低 WorkflowEditor 的复杂度。
