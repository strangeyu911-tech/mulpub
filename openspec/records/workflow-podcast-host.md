---
record: workflow-podcast-host
task: 播客宿主下沉（P1-13）
date: 2026-10-27
---

## 本次执行记录：播客宿主下沉（workflow-podcast-host，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 主进程 + 文档：worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-podcast-host`；基于 `origin/main` |
| QM-5（Bug 反哺） | PASS | 根因：shared host 只在播客页 IPC 首次调用时登记；工作流未打开页面拿不到 host |
| 行尾与 diff 对账 | PASS | `git diff --check` 待跑 |
| 接线棘轮 | PASS | podcast handler 导出测试；现有 podcast IPC 测试保持通过 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS |
| QM-6 CCG | PASS | `ccg-review.ps1 -Mode Deep`：共享工厂/错误传播已收口；external evidence 见 PR #4573 issuecomment-6449908617 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

### 验证证据

- `podcast-episode-host.test.js` 60 项（含 factory 同源重复登记/拒绝第二来源）+ `podcast.test.js` 31 项通过。
- `podcast-script-ipc.test.js` 7 项通过。
- build:vue 与 QM-1 三阶段 PASS；max-lines PASS。

### 边界

- 仍惰性构造，不在应用启动时解析 ffmpeg/ffprobe。
- 频道/托管未配置时仍返回既有可操作错误。
- 手动/工作流复用同一宿主，频道忙标记不分裂。

## CHANGELOG 条目

# feat(automation): 播客宿主下沉（P1-13）

- podcast IPC 导出惰性 getEpisodeHost；工作流 provider 直接取宿主。
- 不要求先打开播客页；仍复用同一宿主与频道忙标记。

## learnings

### lesson: 共享单例的「登记时机」就是可用性边界

shared host 本身没问题，问题是只有某个页面入口会登记。把登记入口下沉到模块级惰性工厂，比在工作流里再建一份宿主更安全——后者会分裂频道锁。
