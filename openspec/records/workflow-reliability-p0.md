---
record: workflow-reliability-p0
task: 复合工作流可靠性 P0（账号预检 / 队列回写 / 幂等派发 / 队列面板）
date: 2026-10-27
---

## 本次执行记录：复合工作流可靠性 P0（workflow-reliability-p0，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + 文档：隔离 worktree `mp-worktrees/mp-workflow-reliability-p0`（D 盘）+ 裸分支 `workflow-reliability-p0`；共享根保持 main |
| QM-5（Bug 反哺） | N/A | 本次是可靠性增强，不是已发生 Bug 的修复；仍按「先写测试」覆盖三个失败场景（账号过期/缺失、派发失败回写、崩溃窗口） |
| 行尾与 diff 对账 | PASS | `git diff --check` 无空白错误；提交前复核 numstat 两口径 |
| 接线棘轮 | PASS | 新增 `WorkflowRunsDrawer.test.js`、`WorkflowEditor`/`AutomationView`/runner/queue/service 测试均由 QG Unit Tests 全量收集 |
| QM-1 打包 | PASS | `electron-builder --win --dir --publish never` → `scripts/qm1-scheduled-publish-verify.cjs` 三阶段 PASS：asar/exe 存在、scheduler 模块在 asar 内、可 require、8 秒存活且 stderr 为空（父环境 ELECTRON_RUN_AS_NODE=1 已由 helper 剔除并告警）。**QM-1 曾抓到真实问题**：`shared/workflow-account-status.json` 未在 `build.files` 内，打包后 `Cannot find module`；已把 `shared/**/*` 加入 electron-builder files 并复跑通过 |
| QM-6 CCG 双模型评审 | PENDING | 待提交后跑 `scripts/ccg-review.ps1 -Mode Deep`，记录最终 review 文件与裁决 |
| 远程同步 | 由门禁推导 | 本行不手工改写；合并后按 squash 尾注 `(#NNNN)` 由 `scripts/lib/merge-ledger.js` 推导 |

### 验证证据

- `npx vitest run`（7 个 workflow service 测试文件）→ **82 tests passed**
- `npx vitest run src/features/automation/*.test.js` → **5 tests passed**
- `npx vitest run src/views/AutomationView.test.js` → **17 tests passed**
- `npx vitest run src/views/AutomationView.notify-registration.test.js` → **4 tests passed**
- `npx vitest run electron/ipc-handlers/automation-ipc-wiring.test.js` → **7 tests passed**
- 合并去重后的定向回归：**108 tests passed**
- `node .github/scripts/check-max-lines.js` → **无新增超大文件**；`workflow-runner.js` 已从 584 行拆到 494 行（account-guard / queue-event / article / run-utils 四个纯模块）
- `pnpm run build:vue` → built successfully
- `node .github/scripts/check-locale-sync.js --keys` → PASS（2419 个使用中的 key 均存在）
- `node .github/scripts/check-locale-sync.js --symmetry` → PASS（61 对，drift=0）
- `npx eslint <changed files> --quiet` → PASS

### 遗留（不假装已闭合）

- 生成/发布彻底解耦与断点续跑（P0-3）留到下一 PR；本 PR 只做队列可靠性边界。
- `dispatch-uncertain` 需要人工在队列面板确认/重试，不自动重发。
- 开机自启/托盘常驻提示（P0-5 的桌面壳部分）未在本 PR 落地；本 PR 提供队列失败黄条 + 面板 + 重试。

## CHANGELOG 条目

# fix(automation): 复合工作流可靠性 P0（账号预检 / 队列回写 / 幂等派发）

- 运行前校验账号存在且可用：过期/未启用/缺失账号直接 `account-unavailable`，不采集、不消耗额度；UI 禁用过期账号并二次拦截保存。
- 发布队列状态回写运行记录：`queueStatus/queueError/queueAttempts/queueAt` 可见；失败/错过同步修正 summary。
- 派发先落 `dispatching` 再调用 TaskQueue；重启时超过 10 分钟租约标 `dispatch-uncertain`，不自动重发；支持人工重试。
- 新增运行记录队列面板与自动化页队列问题黄条；`queue:list` / `queue:retry` IPC 与 preload API。

## learnings

### lesson: 队列「已交给 TaskQueue」不等于「平台已发布」

`dispatched` 只证明任务进入了发布器队列，不能直接写成 `published`。运行记录必须区分 `scheduled → dispatching → dispatched` 与最终发布历史，否则会把「已排队」误报成「已发布」。

### lesson: 崩溃窗口要用租约显式暴露，不能用自动重试掩盖

`await enqueue → 标记 dispatched` 之间崩溃时，无法判断 TaskQueue 是否已接收。正确做法是先持久化 `dispatching`，重启后超过租约标 `dispatch-uncertain` 并交人工确认；自动重发会把不确定性变成重复发布。

### lesson: 账号预检必须在花钱动作之前

账号过期/删除如果等到发布时才失败，前面的采集、改写、视频生成已经消耗模型额度。预检放在 schema 校验之后、采集之前，才能既省成本又给出一致的错误。
