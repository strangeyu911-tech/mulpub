# 变更提案：pipeline-e2e-smoke

## 为什么

PR #4515 解决了「阶段执行器接线完整性」，但没有回答「14 条带 `stageDefs` 的流水线各自需要什么、当前哪些能跑、哪些缺驱动/输入/工具」。每次验证都靠翻散落的 `tests/e2e/*.js` 与口头确认，无法在发版前形成可重复门禁。

## 变更内容

新增一套**只读**流水线 E2E 冒烟清单与就绪审计：

1. `apps/desktop/scripts/pipeline-smoke/manifest.js`：14 条流水线（含 `framework-smoke`）的驱动、默认参数、输入、期望产物、成本、超时；`screen-demo` 显式排除。
2. `apps/desktop/scripts/pipeline-smoke/audit.js`：纯 Node CLI，使用生产 `StageExecutor` + `registerAllPipelineStages` 校验接线，检查驱动文件、ffmpeg/ffprobe、E2E 输入；输出 `READY/BLOCKED/BROKEN/EXCLUDED` 与 JSON 报告。
3. `apps/desktop/scripts/pipeline-smoke/make-fixtures.js`：用 ffmpeg testsrc/sine 生成 5 个合成输入素材（幂等，可重复执行）。
4. `apps/desktop/electron/tests/pipeline-smoke-audit.test.js`：覆盖清单完整性、状态短路、JSON 计数、退出码、素材生成计划。
5. `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md`：数据校验、状态机、CLI 契约、验收、边界与首次审计结果。

## 不做什么

- 不在 CI 真实调用外部模型；不读取应用 SQLite 的加密 provider 凭据。
- 不替代现有 E2E 驱动；不覆盖 `screen-demo` 与 `video-clone`。
- 不新增 UI。

## 影响面

- 新增 `apps/desktop/scripts/pipeline-smoke/`（开发工具，不进 renderer 打包）。
- 新增测试 1 个（vitest `electron/tests/**`）。
- 新增 PRD/提案/执行记录；不改生产运行时代码路径。

## 验收

- 14 条带 `stageDefs` 的流水线全部登记；漏登记/重复登记/未知 pipeline 判 `BROKEN`。
- 完整注册时无 `UNWIRED_STAGE`；人为漏注册时对应流水线 `BROKEN`。
- `--json` 报告 schema 稳定，`summary` 与 `items` 一致。
- `--strict` 下 `BLOCKED` 退出码 1；默认模式仅 `BROKEN` 退出码 1。
- `make-fixtures.js` 生成 5 个合成素材；已存在时跳过；ffmpeg 缺失时退出码 2。
- `node --test`/vitest 全绿；文档无绝对路径。
- 首次审计：`total=15 ready=9 blocked=5 broken=0 excluded=1`；5 条 BLOCKED 均为 `NO_DRIVER`（talking-head / animation / documentary-montage / hybrid / podcast-repurpose）。
