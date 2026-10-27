# 变更提案：pipeline-smoke-cdp

## 为什么

`podcast-repurpose` / `documentary-montage` 等流水线需要真实图片/LLM/视频 provider，不能像 `talking-head` 那样在纯 Node 进程里跑。应用已在 `shared-user-data` 配置了 LLM/VIDEO/IMAGE/TTS provider，并在 9279 端口暴露 CDP；最真实的 E2E 就是**连接已启动的应用**，走它的 `pipelineStartOrchestrated`，复用应用自己的 provider、登录态、模型设置与产物目录。

## 变更内容

1. 新增 `apps/desktop/tests/e2e/pipeline-smoke-cdp.js`
   - `--pipeline` / `--params` / `--params-file` / `--input-dir` / `--json` / `--cdp-port` / `--timeout-ms`；
   - 用 Playwright `connectOverCDP` 连接已启动应用（默认 `http://127.0.0.1:9279`）；
   - 调 `window.electronAPI.pipelineStartOrchestrated`，轮询 `pipelineGetRunContext`；
   - 产物提取优先 `render/report/compose/finalize/export`，排除输入 video/audio/image；
   - `ffprobe` 校验 duration>0 + codec；超时调用 `pipelineCancelRun`；
   - 退出码 0 PASS / 1 FAIL / 2 参数/连接错误；报告落 `--json`。
2. `manifest.js`
   - `podcast-repurpose` / `documentary-montage` driver → `tests/e2e/pipeline-smoke-cdp.js`（已真实验证）；
   - `animation` / `hybrid` 暂保持 `NO_DRIVER`：CDP 驱动已实现，但 animation 12 场景 20min 超时，待优化/延长超时后再纳入。
3. `pipeline-smoke-audit.test.js`：NO_DRIVER 用例改为用临时清单（podcast driver=null），避免依赖真实清单中某条固定无驱动。
4. 新增 `pipeline-smoke-cdp.test.js`：参数、podcast/documentary 参数补齐、产物优先级/排除输入、状态兼容（7 例）。
5. PRD 增补增量 4 契约与实测。

## 不做什么

- 不在 CI 自动启动应用/CDP；这是本地/发布前手动 E2E。
- 不替代 `pipeline-model-preflight`；provider 缺失仍由应用内前置检查拦截。
- 不覆盖 animation/hybrid 的 12 场景长耗时优化；它们仍为 `NO_DRIVER`。

## 验收

- `podcast-repurpose` 真实 PASS：`mvqj1cld_e1kt`，39.7s，产物 5s h264+aac。
- `documentary-montage` 真实 PASS：`mvqk0zj5_7v8p`，142.8s，产物 67.37s h264+aac。
- 审计（shared-user-data provider DB）：`ready=12 blocked=2 broken=0 excluded=1`，只剩 animation/hybrid 无驱动。
- CDP 单测 7 例 + 既有 audit/execute 测试全绿；文档无绝对路径。
