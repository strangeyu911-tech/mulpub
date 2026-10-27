---
record: workflow-blogger-status
task: 博主发现状态回写（P1-14）
date: 2026-10-27
---

## 本次执行记录：博主发现状态回写（workflow-blogger-status，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 主进程 + 渲染层 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-blogger-status`；基于 `origin/main` |
| QM-5（Bug 反哺） | PASS | 根因：工作流消费 pending 发现项后不回写，下一轮重复取用；博主页也无法区分已用 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | store/source/UI 测试；max-lines 待跑 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PENDING | 提交后跑 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- workflow 全量 + creator-store + CreatorMonitor：**185 tests passed**（13 文件）；覆盖 workflow_published 独立状态、只允许 pending/failed、meta.discoveryId、成功/失败回写、无 id 跳过、UI 文案与无采集按钮。
- `build:vue` 成功；QM-1 三阶段 PASS；locale symmetry / max-lines PASS（runner 498 行）。

### 边界

- 不冒充 collected：不写 viral_library、不写 outbox、不扣配额。
- 不改变 creator runtime 的 claim/lease/fencing 采集链。
- 回写失败只进 run.warnings，不影响发布结果。
- 不做跨工作流去重（workflow ledger 双键负责）。

## CHANGELOG 条目

# feat(automation): 博主发现状态回写（P1-14）

- 工作流成功消费发现项后写 workflow_published，失败写 failed。
- 博主页显示「已由工作流发布」，避免重复采集。
- 不冒充 collected，不写资产/outbox。

## learnings

### lesson: 状态回写要用独立状态，不要借语义更重的终态

`collected` 在 creator store 里意味着 viral_library 资产 + outbox + 配额事务；工作流只发布、不采集资产，复用 collected 会伪造一整条下游链路。`workflow_published` 是一个更窄但诚实的终态。
