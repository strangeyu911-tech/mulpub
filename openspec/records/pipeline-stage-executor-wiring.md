---
record: pipeline-stage-executor-wiring
task: 视频创作流水线阶段执行器接线完整性——未知 stage.type 由静默成功改为 fail closed，并新增生产装配级回归锁与启动期自检
date: 2026-10-26
---

## 本次执行记录：视频创作流水线阶段执行器接线完整性（pipeline-stage-executor-wiring，2026-10-26）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/**`、`apps/desktop/src/**`）⇒ 隔离 worktree（D 盘非 C，路径以 `git rev-parse --show-toplevel` 实证）、裸分支 `pipeline-stage-executor-wiring`（`git rev-parse --abbrev-ref HEAD` 实证） |
| 第一性原因（QM-5 ①） | ✅ | `apps/desktop/electron/services/stage-executor.js:306-309`（旧版）：未知 `stage.type` 返回 `{ success: true, output: null, checkpoint: true }`，把「没有执行器」伪装成「人工检查点通过」。根因是「兼容旧 13 条无 stageDefs 流水线」的兜底逻辑被复用到「有 stageDefs 但类型拼错/漏注册」的场景——前者需要默认 `manual_checkpoint`，后者必须失败，两种语义共用一个分支 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：`pipeline-engine.test.js` / 各 `*-stages.test.js` 全部用 mock 执行器逐阶段测试，没有任何用例遍历 `PIPELINES.stageDefs` 做「类型→执行器」比对；②**测试执行层**：`electron/tests/**` 虽在 vitest include 白名单，但缺失的是「跨流水线接线断言」这一维度，不是文件未被跑；③**审查层**：`container.setup.js` 的 `registerStages` 调用是一串无返回值语句，少一行没有编译/类型/运行时反馈；④**运行层**：断链只在跑到该阶段时以 `warn` 出现，默认日志级别下不可见，且流水线仍报 completed |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `electron/tests/pipeline-executor-wiring.test.js`（20 例，使用生产 `registerAllPipelineStages` 装配真实 `StageExecutor`，遍历 `PIPELINE_DEFINITIONS.stageDefs` 断言每个 type 已注册；含「单一真源」「引擎侧 run.status/errorCode 传播」「非法 type 诊断」「自动化变异反证」）；`stage-executor.test.js` +1 例（`hasExecutor`/`listExecutorTypes`）；`pipeline-error-formatter.test.js` +5 例；`history-utils.test.js` +2 例。全绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`StageExecutor.hasExecutor()` / `listExecutorTypes()` 成为唯一判据（测试与运行时诊断共用，不维护第二份白名单）；②`PipelineEngine.listUnwiredStageTypes()` 暴露给启动期自检 `container.setup.js`（非空 `logger.error` 打印完整清单）；③新增测试文件已确认被 `vitest.config.js` 的 `electron/tests/**/*.test.js` 覆盖（无需改白名单，但已在记录中核对）；④PRD 与 OpenSpec 记录沉淀「静默成功 = 假绿」的机制教训 |
| 行尾与 diff 对账 | ✅ | 见下「验收证据」的 numstat 两口径实测 |
| 接线棘轮 | ✅ | 新增测试位于 `electron/tests/`，命中既有 include 白名单 `electron/tests/**/*.test.{js,ts}`；未新增目录级白名单需求 |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A（见下） | QM-1：改动含 `apps/desktop/electron/**` ⇒ 执行 `pnpm run build:dir` + asar 清单 + require 链 + 8 秒启动判据（证据见下）。QM-4：`CreateViewHistory.vue` 仅改 import 行（无模板/样式/布局变更）；新增 locale 文案只在错误态显示，像素基线不覆盖该状态；不涉及视觉回归面 |
| QM-6 CCG 双模型外部评审 | ✅ | claude（critic）+ opencode（proposer）深度审查：**minScore=8 / status=converged（无阻断）**；findings 均为非阻断建议或误报，逐条处置见 PR 评论与 `.ccg/reviews/*.json` 的 `deepReview.closureNote` |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并前本文件不在基线，判 byDesign 不红；写成 `PASS` 会被判「预写不存在的证据」 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按 2026-10-15「旧载体冻结」政策零改写）

### 一、问题与结论

2026-10-26 对视频创作流水线做接线审计，结论：

- **接线层是完整的**：除显式「开发中」占位 `screen-demo`（无 `stageDefs`，`available=false`）外，14 条具备 `stageDefs` 的内置流水线，其每个 `stage.type` 均已被 `container.setup.js` 的 registerXStages 注册。
- **但「能否跑通」此前无法被机械证明**：`StageExecutor` 对未注册类型静默成功，导致断链表现为「流水线 completed 但该阶段无产出」，且所有测试仍绿。这正是本次要关闭的结构性假绿。

### 二、改动清单

**主进程**

- `apps/desktop/electron/services/stage-executor.js`
  - 新增 `hasExecutor(stageType)` / `listExecutorTypes()`；
  - 未知 `stage.type` → `success:false` + `errorCode='PIPELINE_STAGE_EXECUTOR_MISSING'` + `messageParams:{stageName,stageType}`（不再返回 `checkpoint:true`）；
  - 显式 `manual_checkpoint` 与**无 `type` 字段**的旧阶段保持原语义。
- `apps/desktop/electron/services/pipeline-engine.js`
  - 导出只读 `PIPELINE_DEFINITIONS`；
  - 新增 `listUnwiredStageTypes()`（空数组才算全接线；`stageExecutor` 未配置时每项带 `STAGE_EXECUTOR_NOT_CONFIGURED`，不返回空数组；`type` 存在但非法 ⇒ `INVALID_STAGE_TYPE`）。
- `apps/desktop/electron/services/pipeline-stage-registrars.js`（**新增**，外部评审 i2）
  - 注册器清单 `PIPELINE_STAGE_REGISTRARS` + `registerAllPipelineStages(engine)` 的单一真源；
  - `container.setup.js` 与回归锁共用同一份，不再手工镜像/正则解析源码。
- `apps/desktop/electron/core/container.setup.js`
  - 13 行手工 `registerXStages` 改为一次 `registerAllPipelineStages(engine)`；
  - 注册失败与接线自检均以 `logger.error` 打印完整清单。

**渲染端**

- `apps/desktop/src/locales/story2video/zh.js` / `en.js`：成对新增 `stage_executor_missing`。
- `apps/desktop/src/utils/pipeline-error-formatter.js`：新增**最高优先级**规则拦截 `PIPELINE_STAGE_EXECUTOR_MISSING`（否则 120 字符内的英文原文会被「短自然语言直出」分支泄漏）。
- `apps/desktop/src/views/history-utils.js`：新增 `PIPELINE_ERROR_KEY_MAP`（继承 `COMPOSE_ERROR_KEY_MAP` + 新码）。
- `apps/desktop/src/views/CreateViewHistory.vue`：`formatError` 改用 `PIPELINE_ERROR_KEY_MAP`（import 行变更）。
- `apps/desktop/src/story2video/story2video-notifications-keys.js` / `story2video-notifications.js`：新增 `STAGE_EXECUTOR_MISSING` key 与 `PIPELINE_STAGE_EXECUTOR_MISSING` 映射。

**测试**

- 新增 `apps/desktop/electron/tests/pipeline-executor-wiring.test.js`（20 例）。
- 修改 `apps/desktop/electron/tests/stage-executor.test.js`（+1 例）。
- 修改 `apps/desktop/src/utils/pipeline-error-formatter.test.js`（+5 例，含行为面优先级）。
- 修改 `apps/desktop/src/views/history-utils.test.js`（+2 例）。

**文档**

- `01-docs/PRD-video-creation.md` §二十（20.1–20.11：数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字、错误码、验收、边界）。
- `01-docs/PRD.md` 末尾「视频创作流水线阶段执行器接线完整性」摘要。
- `openspec/changes/pipeline-stage-executor-wiring/proposal.md`。
- 本执行记录。

### 三、验收证据

**基线（改动前，同一 worktree 实测）**

```
pnpm exec vitest run electron/tests/pipeline-engine.test.js \
  electron/services/{cinematic,clipfactory,documentary,explainer,localization,podcast-repurpose,smoketest,story2video,story2video-aspect-ratio,talkinghead,videogen,videogen-poll,videogen.digital-human}-stages.test.js \
  electron/services/film-engineering/film-engineering-stages.test.js
→ Test Files 15 passed (15), Tests 415 passed (415), Duration 60.73s
```

**新增/增强（改动后）**

```
pnpm exec vitest run electron/tests/pipeline-executor-wiring.test.js \
  electron/tests/stage-executor.test.js \
  src/utils/pipeline-error-formatter.test.js \
  src/views/history-utils.test.js
→ 全部通过（详见 CI run）
```

**变异反证（判据不是恒绿）**

```
# 完整注册
ALL_REGISTERED_UNWIRED=0
# 移除 registerVideoGenStages（模拟断链）
MUTATED_UNWIRED=16
SAMPLE=[{"pipeline":"animation","stage":"concept","type":"videogen_concept"}, ...]
```

**回归面（改动后）**

```
pnpm exec vitest run（24 个文件：pipeline-executor-wiring / stage-executor / pipeline-engine /
pipeline-story2video-contract / 13 个 *-stages / container.setup / pipeline-error-formatter /
history-utils / CreateViewHistory / story2video-notifications / i18n）
→ Test Files 24 passed (24), Tests 748 passed (748), Duration 84.27s
```

**行尾与 diff 对账**

- `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径一致（提交前实测，见 PR 正文）。

### 四、QM-1 打包证据

- 命令：`cd apps/desktop && pnpm run build:dir`（= `build:vue` + `electron-builder --dir`，Windows 目标），**exit 0**。
- 产物：`dist-electron/win-unpacked/resources/app.asar` = 158,013,820 B；asar 清单含 `\electron\main.js`、`\electron\services\logger.js`、`\electron\services\pipeline-engine.js`、`\electron\services\stage-executor.js`。
- require 链：`pnpm exec asar extract <app.asar> %TEMP%\\mp-app-test` → `node -e "require('.../node_modules/@multi-publish/rpa-engine')"` → `RPA_ENGINE_REQUIRE_OK object`。
- 启动判据（三层，非仅黑名单）：子进程 env 显式剔除 `ELECTRON_RUN_AS_NODE`，`--user-data-dir=%TEMP%\\mp-qm1-userdata-224134`，`ALIVE_AFTER_8S=True`，`STDERR_BYTES=0`（stderr 为空 ⇒ 通过）；stdout 中 `接线不完整` / `PIPELINE_STAGE_EXECUTOR_MISSING` 命中数 = **0**。
- 已知环境噪声（非本次改动引入，如实登记）：fresh user-data + 无 python PATH ⇒ stdout 出现 `PythonBridge Failed to start: spawn python ENOENT`；未登录 ⇒ renderer 多条 `许可证权限不足`。二者均落在 stdout，stderr 为空，不影响 QM-1 判据。

### 五、遗留（不假装已闭合）

1. **只覆盖启动期静态注册**：未来若引入运行时动态注册执行器，`PIPELINE_STAGE_REGISTRARS` 与判据需同步扩展。
2. **`video-clone` 不在本判据内**：其走独立 IPC 引擎，不经 `PipelineEngine.stageDefs` 编排，由自身测试覆盖。
3. **不校验 provider 可用性**：接线完整性只回答「阶段是否实现」，不回答「模型 Key / ffmpeg 是否就绪」；后者由 `pipeline-model-preflight`、各阶段 fail-closed 与 `framework-smoke` 负责。
4. **QM-6 已执行（收敛）**：claude + opencode 双模型审查 minScore=8、status=converged；findings 均为非阻断建议/误报，逐条处置见 review 记录 `deepReview.closureNote`。

## CHANGELOG 条目

# fix(pipeline): 视频创作流水线未知阶段类型改为 fail closed，并新增执行器接线完整性回归锁（pipeline-stage-executor-wiring）

- 症状：某条流水线的 `stageDefs` 若引用了未注册的阶段类型，`StageExecutor` 会把它当成「人工检查点」返回 `success:true` —— 整条流水线以 completed 结束，但该阶段什么都没做，用户看到「成功」、实际是空跑；所有既有测试仍然全绿。
- 真因：`stage-executor.js` 的「兼容旧 13 条无 stageDefs 流水线」兜底（默认 `manual_checkpoint`）被复用到了「有 stageDefs 但类型拼错/漏注册」的场景，两种语义共用一个成功分支。
- 修法：未知 `stage.type` 返回 `success:false` + 稳定码 `PIPELINE_STAGE_EXECUTOR_MISSING`（`messageParams` 带 stageName/stageType）；显式 `manual_checkpoint` 与无 `type` 旧阶段保持原语义。新增 `hasExecutor` / `listExecutorTypes` / `listUnwiredStageTypes`，`container.setup.js` 启动期自检非空即 `logger.error` 打印完整断链清单。
- 用户可见：历史卡片与通知按 `errorCode` 渲染 zh/en 自然语言（`story2video.stage_executor_missing`），不泄漏英文技术原文；属于「安装/版本异常」类提示，给出重装与反馈技术支持两个出口。
- 回归锁：新增 `electron/tests/pipeline-executor-wiring.test.js`，用与生产 `container.setup.js` 相同的 registerXStages 装配真实 `StageExecutor`，遍历 `PIPELINE_DEFINITIONS.stageDefs` 断言每个 type 已接线；变异反证移除 `registerVideoGenStages` 后未接线清单返回 16 项、恢复为 0。

## learnings

### lesson: silent-fallback-turns-wiring-gaps-into-fake-success

**现场**：2026-10-26 审计视频创作流水线，`stage-executor.js` 对未知 `stage.type` 返回 `{ success:true, output:null, checkpoint:true }`；`pipeline-engine.test.js` 与 13 个 `*-stages.test.js` 共 415 个用例全部通过，但没有任何一条断言「PIPELINES 的每个 stage.type 都有真实执行器」。

**根因**：兜底逻辑服务于「旧 13 条无 stageDefs 流水线」的兼容需求（缺 `type` 时默认 manual_checkpoint），却被复用为「未知 type」的兜底。两种语义——「本来就没有类型」与「类型写错了」——共用一个成功分支。前者应成功，后者必须失败。

**可复用的 3 条**：

1. **兜底分支必须区分「缺省」与「未知」**：`undefined` 可以走默认值，`typeof === 'string'` 但未注册必须 fail closed。把两者合并会在测试里表现为「永远不会失败的默认路径」。
2. **接线完整性要用生产装配函数验证**：用 mock 执行器只能证明测试自己会注册；必须调用与 `container.setup.js` 逐字相同的 registerXStages，再向真实执行器查询已注册类型。否则测的是测试，不是产品。
3. **「成功」不是可观测产出**：流水线 completed 只证明状态机走完，不证明每一步有产出。对每个可执行阶段，至少要有一个「产物存在性/类型」断言；否则静默空跑会以成功形态进入历史记录。


