---
record: pipeline-smoke-cdp
task: 流水线 E2E 冒烟增量 4——CDP 驱动已启动应用，podcast-repurpose / documentary-montage 真实 PASS
date: 2026-10-27
---

## 本次执行记录：CDP provider 流水线驱动（pipeline-smoke-cdp，2026-10-27）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 测试驱动 + 清单 + 文档（`apps/desktop/tests/e2e/**`、`apps/desktop/scripts/pipeline-smoke/**`、`apps/desktop/electron/tests/**`、`01-docs/**`、`openspec/**`）⇒ 隔离 worktree（D 盘非 C，`git rev-parse --show-toplevel` 实证）、裸分支 `pipeline-smoke-cdp` |
| 第一性原因（QM-5 ①） | ✅ | 前序审计把 `podcast-repurpose`/`documentary-montage` 标为 `NO_DRIVER`，但它们需要真实 provider，纯 Node 执行器没有应用容器/模型管理器。缺的不是 provider（shared-user-data 已配置 LLM/VIDEO/IMAGE/TTS），而是「连接已启动应用的执行入口」。 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：`execute.js` 只覆盖纯本地流水线；②**E2E 层**：既有 `pipeline-options-matrix` 不含 podcast/documentary；③**审计层**：driver=null 只能报 NO_DRIVER，不会尝试启动应用；④**执行层**：`pipelineStartOrchestrated` 在 renderer 内可用，但无脚本从外部 CDP 调用。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `pipeline-smoke-cdp.js`（CDP 连接、start/poll、产物提取排除输入、ffprobe、超时取消）；podcast/documentary 真实 PASS；`pipeline-smoke-cdp.test.js` 7 例 + audit/execute 共 **43 passed**。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①清单只给**已真实验证**的 podcast/documentary 挂 CDP driver；②animation/hybrid 仍保持 NO_DRIVER，避免「文件存在即 READY」；③报告落 `--json`，含 runId/duration/artifact/probe；④PRD 写明「CDP 需应用已启动 + 9279 端口 + 已配置 provider」。 |
| 行尾与 diff 对账 | ✅ | 见「验收证据」 |
| 接线棘轮 | ✅ | 新增测试位于 `electron/tests/`，命中既有 include 白名单 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未改 `apps/desktop/electron/**` 运行时、未改 renderer/样式/模板 |
| QM-6 CCG 双模型外部评审 | ✅ | claude（critic）+ opencode（proposer）双模型审查；6 条争议全部 `dismissed`（逐条见 `.adversarial/ccg-deep-785e16da/adjudication.json`），`deepReview.status=self_play_resolved`、`performedBy=self-play`；无阻断项 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导（squash 尾注 `(#NNNN)`） |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件

### 一、改动清单

- `apps/desktop/tests/e2e/pipeline-smoke-cdp.js`（新增）
  - `connectOverCDP(127.0.0.1:9279)` → 找含 `window.electronAPI.pipelineStartOrchestrated` 的页面；
  - `buildParams()` 从 manifest 的 defaultParams/inputs 补齐 podcast audio、documentary/animation/hybrid text；
  - `findOutput()` 优先 render/report/compose/finalize/export，排除输入 video/audio/image；
  - 轮询 `pipelineGetRunContext`，超时 `pipelineCancelRun`；`ffprobe` 校验 duration>0 + codec；
  - 报告字段 `status/reasonCode/runId/durationMs/artifact/probe`；退出码 0/1/2。
- `apps/desktop/scripts/pipeline-smoke/manifest.js`
  - `podcast-repurpose`、`documentary-montage` → `tests/e2e/pipeline-smoke-cdp.js`（shared）；
  - `animation`、`hybrid` 保持 `null`，notes 写明「CDP 驱动已实现，待验证/超时优化」。
- `apps/desktop/electron/tests/pipeline-smoke-cdp.test.js`（新增，7 例）
- `apps/desktop/electron/tests/pipeline-smoke-audit.test.js`：NO_DRIVER 用例改临时清单；退出码用例改空 provider 能力集。
- `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md`：增量 4 契约 + 实测。
- `openspec/changes/pipeline-smoke-cdp/proposal.md`（新增）

### 二、验收证据

- `pnpm exec vitest run electron/tests/pipeline-smoke-cdp.test.js electron/tests/pipeline-smoke-audit.test.js electron/tests/pipeline-smoke-execute.test.js` → **43 passed**
- `node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline podcast-repurpose` →
  - `STATUS=PASS`，`RUN_ID=mvqj1cld_e1kt`，`DURATION_MS=39659`，`PROBE={"duration":5,"codecs":["h264","aac"]}`
- `node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline documentary-montage` →
  - `STATUS=PASS`，`RUN_ID=mvqk0zj5_7v8p`，`DURATION_MS=142765`，`PROBE={"duration":67.366667,"codecs":["h264","aac"]}`
- `node apps/desktop/scripts/pipeline-smoke/audit.js --with-providers --providers-db <shared-user-data>` →
  - `PROVIDERS usable=9 caps=image,llm,multimodal,video,tts`
  - `SUMMARY total=15 ready=12 blocked=2 broken=0 excluded=1`
- animation 真实执行：`RUN_ID=mvqj2hff_1bpm`，1202s 超时，`animate` 阶段 12/12 场景仍停在 35%（18 分钟），已 `pipelineCancelRun`；未纳入 READY。
- `node --test scripts/check-doc-abs-paths.test.js` → fail 0
- `node .github/scripts/check-max-lines.js` → ✅ 无新增超大文件
- `pnpm exec eslint tests/e2e/pipeline-smoke-cdp.js electron/tests/pipeline-smoke-cdp.test.js` → 0 errors

### 三、边界

- CDP 驱动假设应用已启动、已登录、已配置 provider、9279 端口可连；CI 不自动跑。
- provider 额度/网络/模型名是否有效仍由应用内 `pipeline-model-preflight` 与真实执行负责。
- animation/hybrid 仍为 `NO_DRIVER`：CDP 驱动已实现，但 animation 12 场景 20min 超时；待优化场景数/并发/超时后再纳入。
- 产物路径在应用临时目录（`%TEMP%/story2video`），报告只记录绝对路径，不复制大文件。

### 四、后续增量

1. 优化 animation/hybrid 的 12 场景长耗时：降低场景数、提高并发、延长超时或分批轮询。
2. 把 CDP 驱动接入发布前 checklist（`audit --with-providers --strict`）。
3. 为 `podcast-repurpose` 增加“无 transcript 走 ASR”的独立用例（当前用 transcript 跳过 ASR）。

## CHANGELOG 条目

# CDP provider 流水线驱动（pipeline-smoke-cdp）

新增通过 CDP 连接已启动应用的单条流水线冒烟驱动；`podcast-repurpose` 与 `documentary-montage` 真实 PASS，审计（shared-user-data provider DB）达到 `ready=12 blocked=2`，只剩 animation/hybrid 无驱动。

## learnings

### lesson: provider-pipelines-need-app-context

需要真实 provider 的流水线不能在纯 Node 里跑：`PipelineEngine` 的 `AssetGenerator`、`ModelProviderManager`、登录态与 userData 都在 Electron 容器里。最真实的 E2E 是连接已启动应用的 CDP，调用同一个 `pipelineStartOrchestrated`，而不是复制/模拟 provider。

### lesson: driver-exists-is-not-driver-verified

只把 `driver` 指向文件会让审计 READY，但文件存在不等于跑通。清单只给**已真实 PASS** 的流水线挂驱动；未验证/超时的保持 `NO_DRIVER`，否则会重演「READY 假绿」。
