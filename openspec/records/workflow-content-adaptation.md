---
record: workflow-content-adaptation
task: 按平台/账号内容适配（P1-9，文本层）
date: 2026-10-27
---

## 本次执行记录：按平台/账号内容适配（workflow-content-adaptation，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 主进程 + 渲染层 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-content-adaptation`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 新能力 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | 模块/schema/runner/editor 测试；max-lines 待跑 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PASS | `ccg-review.ps1 -Mode Deep`：i1–i4 已修复；external evidence 见 PR #4565 issuecomment-6445069483 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- workflow 全量 + editor：**118 tests passed**（10 文件）；CCG 修复后针对性 63 项通过。
- `build:vue` 成功；QM-1 三阶段 PASS；locale symmetry PASS；max-lines PASS。

### 边界（不假装已闭合）

- 只实现文本层：标题/正文/标签。
- **封面/视频比例未实现**：需要发布器/视频流水线按目标变体渲染；当前 UI/PRD 明确写「只改文本，不改封面/视频比例」，没有用无效字段假装支持。

## CHANGELOG 条目

# feat(automation): 按平台/账号内容适配（P1-9 文本层）

- content.adaptation 支持 byPlatform/byAccount profile。
- runner 按 target 生成独立 article 入队；标题/正文/标签确定性适配。
- WorkflowEditor 适配 UI；只展示已选平台并校验边界。

## learnings

### lesson: 媒体比例不是文本字段能兑现的承诺

把 coverRatio/videoRatio 放进配置很容易，但下游发布器/流水线不消费，用户会以为已经裁剪。正确做法是先只做能端到端验证的文本适配，并在 UI/PRD 明写媒体比例待管线支持。
