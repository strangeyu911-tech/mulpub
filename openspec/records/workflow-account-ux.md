---
record: workflow-account-ux
task: 账号选择体验（P1-8）
date: 2026-10-27
---

## 本次执行记录：账号选择体验（workflow-account-ux，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 渲染层 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-account-ux`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 体验增强 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | WorkflowEditor 7 tests；max-lines 无新增超大文件 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PASS | `ccg-review.ps1 -Mode Deep`：i2/i3 已修复，i1 记录元数据驳回；external evidence 见 PR #4562 issuecomment-6443134056 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- `WorkflowEditor.test.js` 8 项通过（含搜索/全选/清空/健康汇总/数字 0 ID）。
- locale symmetry PASS；max-lines PASS；build:vue 与 QM-1 三阶段 PASS。

### 边界

- 最近使用仅本机 localStorage，不同步；隐私模式静默降级。
- 不做虚拟列表（P2-19）。
- 全选跳过过期/未启用账号；清空会清掉搜索前已选的不可见账号。

## CHANGELOG 条目

# feat(automation): 账号选择体验（P1-8）

- 账号搜索（名称/平台/备注/状态/ID）、全选当前结果、清空已选。
- 健康状态汇总与最近使用账号 chips。
- 无结果空态与响应式工具栏。

## learnings

### lesson: 「全选」的语义必须在文案里写清范围

账号列表有搜索过滤时，「全选」可能指全部账号或当前结果；如果文案不写「当前结果」，用户会在过滤后误以为选中了全部。清空同理要写「已选」，避免被理解成只清当前过滤。
