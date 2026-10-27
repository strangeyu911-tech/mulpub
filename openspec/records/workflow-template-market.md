---
record: workflow-template-market
task: 模板市场/团队共享 + 版本迁移（P1-7）
date: 2026-10-27
---

## 本次执行记录：模板市场/团队共享 + 版本迁移（workflow-template-market，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-template-market`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 新能力；旧模板迁移是显式路径，不静默回填 |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | 模块/服务/composable 测试；`check-max-lines` 通过（AutomationTaskDialog 465 行） |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS（asar/exe、require、8 秒存活 stderr 空） |
| QM-6 CCG | PASS | 两轮 `ccg-review.ps1 -Mode Deep`；i2–i6 已修复，i1 旧 pending 记录已清理；external evidence 见 PR #4557 issuecomment-6442037087 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- `workflow-template.test.js` 7 项 + `workflow-service.test.js` 10 项 + `useTemplateTransfer.test.js` 3 项，全部通过；workflow 全量 9 文件 **100 tests passed**。
- `pnpm run build:vue` 通过；QM-1 三阶段 PASS。
- locale symmetry PASS；max-lines PASS（弹窗 465 行）。

### 功能边界

- 不做云端模板市场；团队共享走 JSON 文件。
- 模板不携带账号 ID；导入后必须重新选账号。
- v1 自动迁移；未来版本明确拒绝。
- 重名导入自动加「（导入 N）」，不静默覆盖。

## CHANGELOG 条目

# feat(automation): 模板市场/团队共享 + 版本迁移（P1-7）

- 模板导出升级 v2 包，v1 自动迁移，账号 ID 剥离。
- 导入支持 dryRun 预览、重名 rename、显式 overwrite。
- 任务弹窗新增导出/导入模板；旧自定义模板读取时自动迁移。

## learnings

### lesson: 模板跨机器分发先解决「身份隔离」

模板一旦带 accountId，导入方会看到本机不存在的账号，轻则校验失败，重则把内容发到错误账号。把 accountId 在导出/导入两端强制清空，比在 UI 上提醒可靠。
