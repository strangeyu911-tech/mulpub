---
record: model-quota-p1b2c1
task: P1b-2c1 生产运行时 + RunStateStore 检查点 + PipelineEngine run 生命周期
date: 2026-10-27
branch: model-quota-p1b2c1
---

## 本次执行记录：P1b-2c1 生产运行时 + 检查点 + run 生命周期（2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1b2c1`（D 盘）+ 裸分支 `model-quota-p1b2c1`；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | P1b-2b 只有 UI 消费端，生产侧从未创建 Coordinator：`phase5-ipc` 的 `handlerDependencies` 没有 `modelQuotaCoordinator`，`model-quota:decide` / `switch-back` 永远返回「未就绪」；PipelineEngine 也没有把 `ProviderRunContext` 注册给任何运行时。 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸链：① 装配层：phase5 没有生产单例；② 生命周期层：run 开始/结束不创建/清理 context；③ 持久化层：Coordinator 的 `checkpointPort` 默认 no-op，切官方不落检查点；④ IPC 层：`switch-back` 未 await，异步 false 会被 Promise 真值误判成功。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `model-quota-runtime.test.js` 6 例；`model-quota-checkpoint-port.test.js` 5 例；`model-quota-pipeline-hooks.test.js` 3 例；`phase5-ipc.test.js` 新增 1 例；`model-quota.test.js` 新增 1 例；`pipeline-engine.test.js` 新增 1 例。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 运行时按 runId 单例 context，防跨 run 污染；② begin/end 接线锁住生命周期；③ 检查点端口只写白名单字段，防 Key 落盘；④ `switch-back` await 锁住异步 false；⑤ P1b-2c1/2c2 边界写入 PRD/tasks，避免把「运行时已接线」误报成「业务域已接入」。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` exit 0；`pnpm exec electron-builder --win --dir --publish never` exit 0；asar `require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 8 秒存活、stderr 0 字节。 |
| QM-2 代码必检项 | ✅ | `eslint` 变更文件 exit 0；无硬编码密钥、无 `eval`、无生产 `console.log`。 |
| 行数基线说明 | ✅ | `pipeline-engine.js` 的 targets 2776→2779（+3，零余量）：只为把 `beginModelQuotaRun` / `endModelQuotaRun` 的调用恢复为独立可读行（不把两条语句压在一行）；生命周期逻辑本体已拆到 `model-quota-pipeline-hooks.js`，`register.files` 与 200 行容差未动。 |
| QM-4 视觉 | N/A | 本 PR 无渲染端改动；Dialog/卡片沿用 P1b-2b/2a，视觉基线不受影响。 |
| QM-6 CCG 评审 | 由 pre-commit 判定 | 按仓内 `deep-review` 流程执行；不以自审冒充通过。 |
| 单测 | ✅ | P1b-2c1 定向 **130/130 passed**（runtime 8 + checkpoint 6 + hooks 3 + phase5 29 + IPC 11 + pipeline-engine 73）。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等。 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词；合并后由 merge-ledger 推导。 |

## CHANGELOG 条目

# feat(model): P1b-2c1 接入模型额度兜底生产运行时与 run 生命周期

新增 `ModelQuotaRuntime`（唯一 Coordinator + run context 注册 + `switchBack`）、`RunStateStore` 检查点端口（`context.modelSourceOverrides` + `checkpoint.modelQuota`）与 `PipelineEngine` begin/end 接线；phase5 生产实例化并注入 `modelQuotaCoordinator` / `modelQuotaSwitchBack`；`switch-back` 改为 await，异步 false 不再误判成功。业务域调用边界留给 P1b-2c2。

## learnings

### lesson: production-runtime-must-own-run-context

**问题**：Coordinator 单测全绿、UI 也接好，但生产端 `model-quota:decide` 永远「未就绪」，因为没有任何装配点创建 Coordinator，也没有把 PipelineEngine 的 `ProviderRunContext` 注册进去。
**根因**：按「层」分别交付时，每层都自证绿，但缺少「装配层」的 ownership：谁创建单例、谁在 run 开始/结束调用、checkpointPort 落到哪个 store。
**修复**：用 `ModelQuotaRuntime` 统一持有 Coordinator + runId→context；phase5 只做装配；PipelineEngine 只留一行 begin/end；检查点端口单独适配 `RunStateStore` 快照形状。
**推广**：任何「纯函数/协调器 + UI」的功能，交付时必须点名装配点与生命周期 owner，并用集成测试锁住「生产依赖真的注入」。
