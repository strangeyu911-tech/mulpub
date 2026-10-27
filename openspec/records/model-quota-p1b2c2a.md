---
record: model-quota-p1b2c2a
task: P1b-2c2a 统一模型调用边界 + 额度暂停
date: 2026-10-27
branch: model-quota-p1b2c2a
---

## 本次执行记录：P1b-2c2a 统一调用边界 + 额度暂停（2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1b2c2a`（D 盘）+ 裸分支 `model-quota-p1b2c2a`；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | P1b-2c1 只建了 runtime，没有任何调用点把「模型额度失败」送进 `decide()`；PipelineEngine 收到 `MODEL_QUOTA_PAUSED` 也会走普通失败分支，直接 finalize failed。 |
| 逃逸分析（QM-5 ②） | ✅ | ① 调用层：`ModelProviderManager.callAdapter` 返回 quota 结果后直接给业务域，没接 Coordinator；② 暂停层：PipelineEngine 两条阶段失败路径只认 failed；③ 能力层：没有 method→capability 映射；④ 官方未落地：用户选官方时无明确错误码。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `model-quota-call-boundary.test.js` 6 例；`model-quota-pipeline-pause.test.js` 2 例；`model-quota-pipeline-pause-integration.test.js` 1 例；`model-quota-runtime.test.js` 新增 1 例；`phase5-ipc.test.js` 新增 1 例。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 包装层幂等，重复 install 不叠加；② 只有能反查 runId 才介入，非 pipeline 调用不受影响；③ 非额度失败不拦截；④ 官方未落地返回 `MODEL_OFFICIAL_UNAVAILABLE` 并清覆盖；⑤ 暂停路径有独立集成测试锁住「paused 不是 failed」。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` exit 0；`pnpm exec electron-builder --win --dir --publish never` exit 0；asar `require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 8 秒存活、stderr 0 字节。 |
| QM-2 代码必检项 | ✅ | `eslint` 变更文件 exit 0；无硬编码密钥、无 `eval`、无生产 `console.log`。 |
| QM-4 视觉 | N/A | 无渲染端改动。 |
| QM-6 CCG 评审 | 由 pre-commit 判定 | 按仓内 `deep-review` 流程执行；不以自审冒充通过。 |
| 单测 | ✅ | P1b-2c2a 定向 **124/124 passed**（call-boundary 6 + pause 2 + pause-integration 1 + runtime 9 + phase5 30 + pipeline-engine 73 + hooks 3）。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等。 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词；合并后由 merge-ledger 推导。 |

## 行数基线说明

`pipeline-engine.js` targets 2779→2781（+2，零余量）：仅为两条阶段失败路径各加一行 `MODEL_QUOTA_PAUSED → pauseModelQuotaRun` 分支；暂停逻辑本体在 `model-quota-pipeline-hooks.js`，`register.files` 与 200 行容差未动。

## CHANGELOG 条目

# feat(model): P1b-2c2a 统一模型调用边界接入额度询问与暂停

在 `ModelProviderManager.callAdapter` 外幂等包装 `model-quota-call-boundary`：额度/凭据失败且有 run context 时调用 `ModelQuotaRuntime.decide`，用户取消/去设置返回 `MODEL_QUOTA_PAUSED`，用户选官方但 P2 未落地返回 `MODEL_OFFICIAL_UNAVAILABLE`；PipelineEngine 把 `MODEL_QUOTA_PAUSED` 转为 run/stage paused 并保存 `model_quota` 检查点。覆盖 Story2Video/图片轮播/数字人/Film 等所有经统一 manager 的调用。

## learnings

### lesson: intercept-at-single-funnel-not-every-domain

**问题**：额度失败散落在各业务域，逐域接入会重复、漏接，且每个域都要自己处理「暂停」语义。
**根因**：业务域共享同一个 `ModelProviderManager.callAdapter` 漏斗，但该漏斗只做错误返回，没有「可兜底失败」的上抛合同。
**修复**：在漏斗外包一层幂等包装，只对「有 run context + 可兜底失败」介入；把 `MODEL_QUOTA_PAUSED` 作为唯一暂停信号交给 PipelineEngine。
**推广**：跨域横切能力优先接单一漏斗；包装层必须幂等、可旁路、非目标失败零改写。
