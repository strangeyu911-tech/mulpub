---
record: workflow-run-resume
task: 复合工作流生成中断续跑（P0-3）
date: 2026-10-27
---

## 本次执行记录：生成中断续跑（workflow-run-resume，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + 文档：隔离 worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-p03`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 可靠性增强；以「崩溃/重启」场景先补续跑回归测试 |
| 行尾与 diff 对账 | PASS | `git diff --check` 无空白错误 |
| 接线棘轮 | PASS | `workflow-runner.test.js` 新增续跑用例；`phase3-services.test.js` 沿用 38 例 |
| QM-1 打包 | PASS | `build:vue` + `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PENDING | 提交后跑双模型审查并记录最终 review 文件 |
| 远程同步 | 由门禁推导 | 合并后按 squash 尾注由 merge-ledger 推导 |

### 验证证据

- `npx vitest run`（8 个 workflow/phase3 测试文件）→ **121 tests passed**
- `node .github/scripts/check-max-lines.js` → 无新增超大文件；`workflow-runner.js` 487 行
- `pnpm run build:vue` → success
- QM-1 → 三阶段 PASS（asar/exe、require、8 秒存活 stderr 空）

### 关键实现

- `startRun` 持久化 `_sources`，逐条清空并 `persist(run)`；结束时删除。
- `resumePersistedRun` 只续跑 `pending/collecting/rewriting/creating`；`scheduling` 标 `resume-scheduling-uncertain`，不自动重发。
- `resumeRun` / `resumeInterruptedRuns` 暴露；`phase3-services` 在队列恢复后异步触发。
- 拆分 `workflow-resume.js` / `workflow-run-snapshot.js`，`workflow-runner.js` 保持 <500 行。

### 遗留（不假装已闭合）

- 生成仍在应用内异步执行，不是独立队列/进程；应用关闭期间不会生成，只保证重启后续跑。
- `resume-scheduling-uncertain` 需要人工确认，不能自动判断已入队目标。

## CHANGELOG 条目

# feat(automation): 复合工作流生成中断续跑（P0-3）

- 运行过程持久化未处理源条目，应用崩溃/重启后可续跑未完成生成。
- `scheduling` 条目可能已部分入队，续跑标 `resume-scheduling-uncertain` 并停止自动重发。
- 启动时在发布队列恢复后异步触发续跑，不阻塞主窗口。

## learnings

### lesson: 续跑边界要按「是否已写外部队列」切开

生成阶段可安全重做；一旦进入 `scheduling`，多目标入队可能已部分成功。续跑必须把 `scheduling` 当作不确定态交人工，而不是用「重跑一遍」掩盖重复发布风险。
