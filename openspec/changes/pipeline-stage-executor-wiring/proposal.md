# Proposal: pipeline-stage-executor-wiring

## Why

2026-10-26 对视频创作流水线做接线审计时发现一个**结构性假绿**：

`StageExecutor.execute()` 在找不到 `stage.type` 对应执行器时，执行：

```js
this.log.warn('StageExecutor', 'Unknown stage type: ' + stageType + ', fallback to manual_checkpoint');
return { success: true, output: null, checkpoint: true };
```

后果有三层：

1. **运行时**：某条流水线的 `stageDefs` 一旦引用了未接线的阶段类型，该阶段被当成「人工检查点」直接通过——整条流水线以 `status=completed` 结束，但这一步没有产出任何东西。用户看到的是「成功」，实际是空跑。
2. **测试面**：全部既有单测（`pipeline-engine.test.js` + 各 `*-stages.test.js`）都是**逐阶段、带 mock 执行器**的，没有任何一条断言「PIPELINES 里每个 stage.type 都有真实执行器」。断链不会让任何测试变红。
3. **诊断面**：`container.setup.js` 的注册调用即使少了一行，启动日志也只有 `warn` 级别的单条 `Unknown stage type`，且只在真正跑到该阶段时才出现；重启后默认日志级别下几乎不可见。

用户要求：**分析所有视频创作流水线现在是否能正常跑通，并把结论落成可执行的质量门禁**。本变更就是把这个「能跑通」从口头判断变成机械断言。

## What Changes

### 1. 运行期 fail closed（`stage-executor.js`）

- 未知 `stage.type` 从「`success: true` + `checkpoint: true`」改为：
  - `success: false`
  - `errorCode: 'PIPELINE_STAGE_EXECUTOR_MISSING'`
  - `messageParams: { stageName, stageType }`
  - `error: 'PIPELINE_STAGE_EXECUTOR_MISSING: no executor registered for stage type "<type>" (stage "<name>")'`
- 保留两条**向后兼容**语义，不误伤旧流水线：
  - 显式 `type: 'manual_checkpoint'` 仍是内置执行器，按原语义成功并 `checkpoint: true`；
  - **完全没有 `type` 字段**的旧阶段（历史 13 条 state_machine 流水线）仍按 `MANUAL_CHECKPOINT` 处理。

### 2. 执行器查询 API（`stage-executor.js`）

- 新增 `hasExecutor(stageType): boolean`：内置 ∪ 自定义。
- 新增 `listExecutorTypes(): string[]`：去重排序后的类型清单，供诊断与回归锁打印。

### 2.1 注册器单一真源（`pipeline-stage-registrars.js`，新增）

- 新增 `electron/services/pipeline-stage-registrars.js`：导出 `PIPELINE_STAGE_REGISTRARS`（顺序清单）与 `registerAllPipelineStages(engine)`（逐项注册、收集失败而不首错即停）。
- `container.setup.js` 从「13 行手工调用」改为「一次 `registerAllPipelineStages(engine)`」。
- 回归锁 import 同一份清单，不再手工镜像或正则解析源码（外部评审 i2）。

### 3. 接线诊断 API（`pipeline-engine.js`）

- 导出只读 `PIPELINE_DEFINITIONS`（= 内置 `PIPELINES` 数组）。
- 新增 `listUnwiredStageTypes()`：
  - 返回 `[{ pipeline, stage, type, reason? }]`；
  - 空数组才表示全部已接线；
  - `stageExecutor` 未配置时**不得返回空数组**（每一项带 `reason: 'STAGE_EXECUTOR_NOT_CONFIGURED'`），避免把「没装执行器」读成「全部正常」。

### 4. 启动期自检（`container.setup.js`）

- 所有 `registerXStages` 完成后调用 `engine.listUnwiredStageTypes()`；
- 非空时以 `logger.error` 输出**完整清单**（`pipeline.stage → type`），把「第一次运行才炸」提前到「启动日志可见」。

### 5. 用户可见错误（renderer）

- `locales/story2video/{zh,en}.js` 新增 `stage_executor_missing` 文案（成对）。
- `utils/pipeline-error-formatter.js` 新增**最高优先级**规则：拦截 `PIPELINE_STAGE_EXECUTOR_MISSING`，避免 120 字符内的英文原文被「短自然语言直出」分支泄漏到历史卡片。
- `views/history-utils.js` 新增 `PIPELINE_ERROR_KEY_MAP`（= `COMPOSE_ERROR_KEY_MAP` + 新码），`CreateViewHistory.vue` 改用它，保证 `run.errorCode` 优先于原文。
- `story2video/story2video-notifications-keys.js` + `story2video-notifications.js` 增加 `PIPELINE_STAGE_EXECUTOR_MISSING → STAGE_EXECUTOR_MISSING` 映射，弹窗/通知不落 `operation_failed` 兜底。

### 6. 回归锁（新测试）

- `electron/tests/pipeline-executor-wiring.test.js`：
  - 用 **container.setup.js 同款 registerXStages** 装配真实 `StageExecutor`；
  - 遍历 `PIPELINE_DEFINITIONS` 的 `stageDefs`，断言每个 `type` 都在 `listExecutorTypes()` 中；
  - 断言 `listUnwiredStageTypes()` 为 `[]`；
  - `screen-demo` 作为「开发中」占位，允许没有 `stageDefs`；`listPipelines()` 必须 `available=false`；
  - 未知 `type` 必须失败（`errorCode=PIPELINE_STAGE_EXECUTOR_MISSING`）；`manual_checkpoint` 与无 `type` 旧阶段仍成功。
- `electron/tests/stage-executor.test.js`：补 `hasExecutor` / `listExecutorTypes` 单元断言。
- `src/utils/pipeline-error-formatter.test.js`：补 4 条（key 命中、规则必须第一、en locale、存量原文）。
- `src/views/history-utils.test.js`：补 `PIPELINE_ERROR_KEY_MAP` 继承与新增码断言。

## Impact

- Affected specs: 新建 `openspec/changes/pipeline-stage-executor-wiring/`（本 proposal）；PRD 更新见 `01-docs/PRD-video-creation.md` §二十 与 `01-docs/PRD.md` 视频创作流程补充。
- Affected code:
  - 新增：`apps/desktop/electron/services/pipeline-stage-registrars.js`（注册器单一真源）
  - 修改：`apps/desktop/electron/services/stage-executor.js`、`apps/desktop/electron/services/pipeline-engine.js`、`apps/desktop/electron/core/container.setup.js`（改为调用 `registerAllPipelineStages`）
  - 修改（renderer）：`apps/desktop/src/locales/story2video/{zh,en}.js`、`apps/desktop/src/utils/pipeline-error-formatter.js`、`apps/desktop/src/views/history-utils.js`、`apps/desktop/src/views/CreateViewHistory.vue`、`apps/desktop/src/story2video/story2video-notifications-keys.js`、`apps/desktop/src/story2video/story2video-notifications.js`
  - 新增测试：`apps/desktop/electron/tests/pipeline-executor-wiring.test.js`
  - 修改测试：`apps/desktop/electron/tests/stage-executor.test.js`、`apps/desktop/src/utils/pipeline-error-formatter.test.js`、`apps/desktop/src/views/history-utils.test.js`
- 不改：PIPELINES 定义本身、任何阶段的业务实现、provider 调用契约、compose 引擎。
- 兼容性：
  - 无 `type` 的旧阶段行为不变；
  - `manual_checkpoint` 行为不变；
  - 新增错误码只会在「接线真断了」时出现——正常安装不会触发。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 某条流水线的 stage.type 依赖运行时动态注册，静态检查会误报 | 目前所有 stage 均在 `container.setup.js` 启动期注册；`listUnwiredStageTypes()` 允许自定义流水线（`_customPipelines`）走同一判据；若未来出现运行时注册，必须在本测试的 `PIPELINE_STAGE_REGISTRARS` 同步登记（失败文案会点名缺失类型） |
| fail closed 使「旧版本残留 stageDefs」从假成功变成真失败 | 这正是本变更目的：断链必须可见。若确有历史版本兼容需求，应在 pipeline 定义层降级，而不是在执行器层假装成功 |
| 新增 locale key 导致 zh/en 漂移 | 成对新增；CI Gate 7 `check-locale-sync.js` 机械校验 |
| i18n 文案过度承诺「重新安装即可」 | 文案同时给出「反馈给技术支持」出口；技术细节保留在 `messageParams` 与日志，不进用户文案 |

## Acceptance

1. `pnpm exec vitest run electron/tests/pipeline-executor-wiring.test.js` 全绿（20 例：含单一真源、引擎侧 run.status/errorCode 传播、非法 type 诊断、自动化变异反证）。
2. 变异反证：从注册清单移除 `registerVideoGenStages` 后，`listUnwiredStageTypes()` 返回 16 项（animation / avatar-spokesperson / character-animation / hybrid 的 videogen 阶段）；恢复后为 0。
3. 既有 `pipeline-engine.test.js` / 各 `*-stages.test.js` / `container.setup.test.js` 全绿。
4. 历史卡片对 `PIPELINE_STAGE_EXECUTOR_MISSING` 渲染 `story2video.stage_executor_missing`，不出现英文技术原文。
5. `run.errorCode` 落库后，重启应用仍按码渲染（不依赖内存态）。
