---
record: pipeline-smoke-exec
task: 流水线 E2E 冒烟增量 2——本地流水线真实执行器（talking-head / framework-smoke），产物与 ffprobe 校验
date: 2026-10-27
---

## 本次执行记录：本地流水线真实执行器（pipeline-smoke-exec，2026-10-27）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 开发工具 + 测试 + 文档（`apps/desktop/scripts/pipeline-smoke/**`、`apps/desktop/electron/tests/**`、`01-docs/**`、`openspec/**`）⇒ 隔离 worktree（D 盘非 C，路径以 `git rev-parse --show-toplevel` 实证）、裸分支 `pipeline-smoke-exec`（`git rev-parse --abbrev-ref HEAD` 实证） |
| 第一性原因（QM-5 ①） | ✅ | 增量 1 的 `manifest.js` 把 `talking-head` 标为 `driver:null`，但该流水线只依赖本地 ffmpeg/ffprobe + 文案，不需要 provider。缺的是「本地执行器」这一层，而不是驱动本身。根因是把「共享 E2E 驱动」当成唯一执行入口，忽略了纯本地流水线可以用生产 `PipelineEngine` 直接跑。 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：`pipeline-smoke-audit.test.js` 只断言 `NO_DRIVER` 状态，没有验证「本地流水线能否真跑」；②**E2E 层**：此前没有 `talking-head` 的 E2E，`pipeline-options-matrix` 也不覆盖它；③**审计层**：`READY` 只检查驱动文件存在，不检查产物；④**运行层**：无人跑过 `talking-head`，无法发现「产物提取把 upload 输入当输出」这个具体缺陷。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `execute.js`（生产引擎装配 + 产物提取 + ffprobe）；`pipeline-smoke-execute.test.js` **14 例**；`pipeline-smoke-audit.test.js` 18 例；真实执行 `talking-head` PASS（duration=4.017s, h264+aac）、`framework-smoke` PASS（duration=2s, h264+aac）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`extractArtifact` 优先 `render/report` 子树，显式跳过 `upload/source/input`，并有回归用例；②`execute.js` 必须校验产物存在 + ffprobe duration>0，不能只信 `success:true`；③审计清单把 `builtin:local-executor` 作为正式 driver；④PRD 增补「真实执行结果」附录。 |
| 行尾与 diff 对账 | ✅ | 见「验收证据」的 numstat 两口径实测 |
| 接线棘轮 | ✅ | 新增测试位于 `electron/tests/`，命中既有 include 白名单；未新增目录级白名单需求 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未改 `apps/desktop/electron/**` 运行时、未改 renderer/样式/模板；仅开发脚本、测试与文档。 |
| QM-6 CCG 双模型外部评审 | ✅ | claude（critic）+ opencode（proposer）双模型审查；5 条争议全部 `dismissed`（逐条见 `.adversarial/ccg-deep-14e241e7/adjudication.json`），`deepReview.status=self_play_resolved`、`performedBy=self-play`；无阻断项 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件

### 一、改动清单

- `apps/desktop/scripts/pipeline-smoke/execute.js`（新增）
  - `SUPPORTED_LOCAL_PIPELINES = {talking-head, framework-smoke}`
  - `buildLocalParams()`：talking-head 生成 `video` + `text` + `autoAdvance/checkpointPolicy`
  - `createLocalEngine()`：生产 `PipelineEngine` + `StageExecutor` + `registerAllPipelineStages`
  - `runLocalPipeline()`：执行 → 提取产物 → ffprobe → PASS/FAIL 报告
  - `extractArtifact()`：优先 `render/report/compose/finalize/export`，跳过 `upload/source/input`；产物路径限制在临时目录/工作区 artifacts
- `apps/desktop/scripts/pipeline-smoke/manifest.js`：talking-head 改 `builtin:local-executor`
- `apps/desktop/scripts/pipeline-smoke/audit.js`：允许 `builtin:local-executor`
- `apps/desktop/electron/tests/pipeline-smoke-execute.test.js`（新增，10 例）
- `apps/desktop/electron/tests/pipeline-smoke-audit.test.js`：NO_DRIVER 用例改指 animation；JSON 路径校验更新
- `apps/desktop/package.json`：`pipeline:smoke:execute`
- `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md`：增量 2 契约 + 附录 B 真实执行结果

### 二、验收证据

- `pnpm exec vitest run electron/tests/pipeline-smoke-execute.test.js electron/tests/pipeline-smoke-audit.test.js` → **32 passed**
- `node scripts/pipeline-smoke/execute.js --pipeline talking-head` → **PASS**，runId `mvq78e25_ad8d`，产物 `talkinghead_output.mp4`，ffprobe `duration=4.017007, h264+aac`
- `node scripts/pipeline-smoke/execute.js --pipeline framework-smoke` → **PASS**，runId `mvq79act_f4an`，产物 `smoketest_output.mp4`，ffprobe `duration=2, h264+aac`
- `node scripts/pipeline-smoke/audit.js` → `total=15 ready=10 blocked=4 broken=0 excluded=1`（talking-head READY）
- `pnpm exec eslint scripts/pipeline-smoke/*.js electron/tests/pipeline-smoke-execute.test.js electron/tests/pipeline-smoke-audit.test.js` → 0 errors
- `node --test scripts/check-doc-abs-paths.test.js` → fail 0
- `node .github/scripts/check-max-lines.js` → ✅ 无新增超大文件

### 三、边界

- 仅支持纯本地 `talking-head` / `framework-smoke`；其余 4 条仍需 provider，保持 `NO_DRIVER` 或共享驱动。
- `execute.js` 不做模型能力前置校验的替代：它只跑两条无模型依赖的流水线。
- 真实执行使用合成 testsrc/sine 素材，验证「能跑通 + 有产物」，不验证真实内容质量。
- `talking-head` 的文案分句是本地透传，不验证语音识别（该流水线在无文案时本就 fail closed）。

### 四、后续增量

1. `podcast-repurpose` 单条驱动（图片 provider + 可选 ASR）
2. `animation` / `documentary-montage` / `hybrid` 单条驱动（LLM+image/video）
3. 把 `execute.js` 的 `--pipeline` 扩展为通用本地/远程执行入口
4. `audit --strict` 接入发版前 checklist

## CHANGELOG 条目

# 本地流水线真实执行器（pipeline-smoke-exec）

为 `talking-head` / `framework-smoke` 新增基于生产 `PipelineEngine` + `StageExecutor` 的真实执行器 `execute.js`，强制校验产物存在与 ffprobe duration；两条流水线均真实 PASS，审计从 `ready=9 blocked=5` 提升为 `ready=10 blocked=4`。

## learnings

### lesson: success-true-is-not-artifact-exists

`startOrchestrated` 返回 `success:true` 只代表阶段走完，不代表产物存在。`extractArtifact` 必须先看 `render/report` 等最终阶段子树，并跳过 `upload/source/input`，否则会把输入视频误判为输出；随后必须 `fs.existsSync + size>0 + ffprobe duration>0` 三重校验。

### lesson: local-pipelines-should-not-be-marked-no-driver

纯本地流水线（talking-head / framework-smoke）不需要 provider，可以直接用生产引擎在 Node 里跑；把它们标为 `NO_DRIVER` 会低估真实可执行面。清单里的 driver 应区分 `builtin:local-executor`、`builtin:framework-smoke`、共享 E2E 驱动与 `null`。
