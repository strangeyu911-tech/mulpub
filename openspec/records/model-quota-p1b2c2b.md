---
record: model-quota-p1b2c2b
task: P1b-2c2b 任务详情官方横幅 + 切回按钮
date: 2026-10-27
branch: model-quota-p1b2c2b
---

## 本次执行记录：P1b-2c2b 任务详情官方横幅 + 切回按钮（2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1b2c2b`（D 盘）+ 裸分支 `model-quota-p1b2c2b`；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | P1b-2c2a 已能把任务暂停在 `MODEL_QUOTA_PAUSED`，但渲染层没有任何「当前任务已切官方」的读数；用户看不到来源，也无法切回。 |
| 逃逸分析（QM-5 ②） | ✅ | ① 快照层：`getRunSnapshot` 没暴露 `modelSourceOverrides`；② 组件层：没有任务详情横幅；③ 动作层：`modelQuotaSwitchBack` 只有 IPC，没有 UI 调用；④ 刷新层：切回后没有重新拉 run 快照。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `ModelQuotaTaskBanner.test.js` 4 例；`model-quota-pipeline-hooks.test.js` 新增 1 例；定向 93 例全绿。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 组件只在 `source=official` 时出现；② 多能力逐个切回，任一失败即停；③ 成功 emit 后父页刷新快照；④ 快照暴露只读副本，不污染运行时。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` exit 0；`pnpm exec electron-builder --win --dir --publish never` exit 0；asar `require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 8 秒存活、stderr 0 字节。 |
| QM-2 代码必检项 | ✅ | `eslint` 变更文件 exit 0；无硬编码密钥、无 `eval`、无生产 `console.log`。 |
| QM-4 视觉 | 由 QG Visual 判定 | 无官方覆盖时组件 `v-if` 不渲染；视觉基线预期不变。 |
| QM-6 CCG 评审 | 由 pre-commit 判定 | 按仓内 `deep-review` 流程执行；不以自审冒充通过。 |
| 单测 | ✅ | P1b-2c2b 定向 **94/94 passed**（banner 5 + hooks 4 + runtime 9 + pause 2 + pause-integration 1 + pipeline-engine 73）。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等。 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词；合并后由 merge-ledger 推导。 |

## 行数基线说明

`pipeline-engine.js` targets 2781→2782（+1，零余量）：仅为 `getRunSnapshot` 增加 `modelQuotaOverrides` 只读字段；覆盖反查逻辑在 `model-quota-pipeline-hooks.js`，不继续撑大主引擎。

## CHANGELOG 条目

# feat(model): P1b-2c2b 任务详情增加官方模型横幅与切回按钮

新增 `ModelQuotaTaskBanner.vue`：任务存在 `source=official` 覆盖时显示官方能力与「切回我的模型」，逐个能力调用 `modelQuotaSwitchBack`，成功后刷新 run 快照；`pipeline-engine.getRunSnapshot` 新增 `modelQuotaOverrides`，`ProviderRunContext` 提供只读覆盖副本。无官方覆盖时组件不渲染。

## learnings

### lesson: expose-runtime-state-through-existing-snapshot

**问题**：运行时已有 `modelSourceOverrides`，但 UI 通过 `pipelineGetRunContext` 只能看到 `run.context`，看不到 WeakMap 里的运行时覆盖，导致「已切官方」不可见。
**根因**：状态存在两处（run.context 与 ProviderRunContext），快照只读前者。
**修复**：在既有 `getRunSnapshot` 里增加只读 `modelQuotaOverrides`，由 hooks 从 runtime 反查；不新增 IPC 通道、不改 preload 计数。
**推广**：渲染层需要运行时状态时，优先扩展现有快照字段，而不是新增一套 IPC 面。
