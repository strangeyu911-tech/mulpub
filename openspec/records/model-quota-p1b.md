---
record: model-quota-p1b
task: P1b-1 后端决策层——纯函数决策器 + Coordinator + ProviderRunContext.modelSourceOverrides
date: 2026-10-27
branch: model-quota-p1b
---

## 本次执行记录：P1b-1 后端决策层（model-quota-p1b，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1b`（D 盘，非 C）+ 裸分支 `model-quota-p1b`；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | P1a 只有错误分类/提示，没有「这次失败该不该切官方」的可执行决策器；P1b 的 12 条优先级、凭据永远 ask、cap/余额边界都还只写在 PRD/设计里，无法被测试或调用。 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸链：① 单测层：没有 `model-quota-policy.test.js` / `model-quota-coordinator.test.js`；② 运行层：`ProviderRunContext` 没有 `modelSourceOverrides`，无法表达任务内来源覆盖；③ 审查层：P1a 记录明确写「P1b 未实现」，没有把设置/弹窗/覆盖当成已完成。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `model-quota-policy.test.js` 16 例（12 条优先级 + 归一）；`model-quota-coordinator.test.js` 7 例（并发去重、requestId 一次性、超时、checkpoint 顺序、自动官方、credential 永远 ask、clearRun）；`provider-run-context.test.js` +3 例（覆盖读写/清理/非法值/既有熔断不变）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 决策器是纯函数，不读 store/不发 IPC，边界可单测；② Coordinator 的 checkpoint 先于 override 写成断言；③ `credential_invalid` 永远 ask 有专门用例；④ 设置归一非法值有专门用例；⑤ P1b-1/P1b-2 边界写入 PRD §13.2 与 tasks，避免把 IPC/UI 误报为已完成。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` exit 0；`pnpm exec electron-builder --win --dir --publish never` exit 0；asar 命中 `electron/services/logger.js`；`require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 8 秒存活、stderr 0 字节。 |
| QM-2 代码必检项 | ✅ | `eslint` 变更文件 exit 0；新增纯函数/类无硬编码密钥、无 `eval`、无生产 `console.log`；Coordinator 对 emit/telemetry 失败做降级，不阻断主流程。 |
| QM-4 视觉 | N/A | P1b-1 不含 UI。 |
| QM-6 CCG 评审 | 由 pre-commit 判定 | 本 PR 若触发 deep review，按仓内 `deep-review` 流程执行；不以自审冒充通过。 |
| 单测 | ✅ | P1b-1 定向 41 例全绿；P1a 分类 + manager 回归 121 例全绿。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等。 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词；合并后由 merge-ledger 推导。 |

## CHANGELOG 条目

# feat(model): P1b-1 模型额度兜底增加纯函数决策器与 Coordinator

新增 `model-quota-policy.js`（12 条优先级 + 设置归一）、`model-quota-coordinator.js`（并发去重、一次性 requestId、超时、checkpoint 先于 override、埋点）、`ProviderRunContext.modelSourceOverrides`（任务级来源覆盖）。P1b-1 只做后端决策层，不含 IPC/UI/业务域接入。

## learnings

### lesson: checkpoint-before-override-must-be-an-invocation-order-assertion

**问题**：P1b 要求「切换前必须落检查点；检查点先于写 override」，但只写在文档里时，实现很容易先写内存覆盖再异步 save。
**根因**：顺序是运行时副作用，不是返回值，普通结果断言看不到。
**修复**：Coordinator 测试用 `mock.invocationCallOrder` 断言 `checkpoint.save` 的调用序号小于 `setModelSourceOverride`。
**推广**：凡是「先持久化再改内存/先审计再执行」的契约，必须用调用顺序断言，而不是只断言最终状态。
