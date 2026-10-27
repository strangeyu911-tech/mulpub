# 变更提案：pipeline-smoke-exec

## 为什么

`pipeline-e2e-smoke` 已建立 14 条流水线的清单与就绪审计，但 `talking-head`、`framework-smoke` 仍是 `NO_DRIVER`：它们**不需要外部模型 provider**（纯 ffmpeg/ffprobe + 本地文案），完全可以在 Node 进程里用生产 `PipelineEngine` + `StageExecutor` 真跑。把它们留在 `NO_DRIVER` 会让审计低估真实可执行面，也无法给后续「真跑」提供最小可用样板。

## 变更内容

1. 新增 `apps/desktop/scripts/pipeline-smoke/execute.js`
   - 用生产 `PipelineEngine` + `StageExecutor` + `registerAllPipelineStages` 装配；
   - 支持 `talking-head` / `framework-smoke` 两条纯本地流水线；
   - `buildLocalParams()` 生成合成输入参数；
   - `runLocalPipeline()` 执行、提取最终产物（优先 `render/report` 子树，避免把 `upload` 输入当产物）、ffprobe 校验；
   - `--pipeline` / `--input-dir` / `--json`；退出码 0 PASS、1 FAIL、2 参数/装配错误；
   - 报告字段：`status/reasonCode/runId/durationMs/stages/artifact/probe`。
2. `manifest.js`：`talking-head` 的 driver 从 `null` 改为 `builtin:local-executor`；`audit.js` 允许该 builtin。
3. `apps/desktop/electron/tests/pipeline-smoke-execute.test.js`：参数、产物提取、PASS/FAIL/NO_ARTIFACT/PROBE_FAILED、审计联动。
4. `apps/desktop/package.json`：`pipeline:smoke:execute`。
5. PRD 增补增量 2 契约与真实执行结果（talking-head / framework-smoke PASS）。

## 不做什么

- 不支持需要 LLM/图片/视频/语音 provider 的流水线；它们仍由 `NO_DRIVER` 或共享 E2E 驱动处理。
- 不在 CI 自动真跑；`execute.js` 是本地/发布前手动命令。
- 不替代 `PipelineEngine` 的编排逻辑；execute 只是调用生产入口。

## 验收

- `talking-head` 真实执行 PASS，产物存在且 ffprobe 返回 duration>0、codec h264/aac。
- `framework-smoke` 真实执行 PASS，产物存在且 ffprobe 返回 duration=2s。
- 审计从 `ready=9 blocked=5` 变为 `ready=10 blocked=4`，`talking-head` 为 READY。
- 单测覆盖参数、产物优先级、失败码、探测失败、审计联动。
- 文档无绝对路径；`check-max-lines` 无新增超大文件。
