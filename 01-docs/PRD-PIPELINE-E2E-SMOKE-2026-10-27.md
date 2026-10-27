# PRD：视频创作流水线 E2E 冒烟矩阵（2026-10-27）

> 关联：`pipeline-stage-executor-wiring`（PR #4515，已合并）。本 PRD 解决「接线完整」之后的下一个缺口：**14 条带 `stageDefs` 的流水线，是否有一条可重复执行的端到端冒烟清单与就绪审计**。

## 一、背景与问题

PR #4515 已把 `StageExecutor` 的静默兜底改为 fail closed，并新增接线完整性回归锁。它回答的是：

- 每个 `stage.type` 是否有执行器；
- 未知类型是否会失败而不是假装成功。

它**没有回答**：

1. 14 条流水线各自需要哪些模型能力、工具、输入文件和运行环境；
2. 现有 E2E 驱动覆盖了哪些流水线、哪些还是空白；
3. 在当前机器/CI 上，哪些流水线可以立刻跑，哪些缺 Key、缺输入、缺驱动；
4. 跑完后产物应该是什么、如何判定 PASS，而不是「进程没报错」。

结果是：每次要验证「所有流水线能不能跑通」，都要重新翻 `tests/e2e/*.js`、口头确认环境，无法复用，也无法在发版前形成门禁。

## 二、目标与非目标

### 目标

1. 建立**单一清单**：14 条带 `stageDefs` 的流水线全部登记，字段包含阶段数、模型能力、E2E 驱动、输入、期望产物、成本档、超时。
2. 建立**只读审计 CLI**：一条命令输出每条流水线的 `READY / BLOCKED / BROKEN / EXCLUDED`，并给出机器可读 JSON。
3. 把「接线缺失」与「环境缺失」分开：前者是代码缺陷（BROKEN），后者是缺 Key/输入/驱动（BLOCKED），不允许混为一谈。
4. 为后续「真跑」提供稳定入口：审计结果直接告诉执行者需要补什么，不再靠猜。
5. 清单与 `PIPELINE_DEFINITIONS` 自动对账：未来新增流水线未登记时审计直接 BROKEN。

### 非目标

- 本 PR 不在 CI 中真实调用外部模型（成本、密钥、稳定性不可控）；真实执行仍由人工/专用 profile 触发。
- 不替代 `pipeline-options-matrix.js`、`video-model-pipelines.js` 等既有 E2E 驱动；审计只判断「驱动是否存在」。
- 不覆盖 `screen-demo`（无 `stageDefs` 的显式占位）与 `video-clone`（独立 IPC 引擎）。
- 不解决 provider 额度、账号登录态、平台发布授权；这些在执行阶段由既有 preflight/阶段 fail-closed 处理。

## 三、覆盖范围（14 条 + 1 条排除）

| 流水线 | 类别 | 阶段数 | 模型能力（默认参数） | 现有 E2E 驱动 | 状态 |
|--------|------|--------|----------------------|---------------|------|
| `animated-explainer` | generated | 8 | llm + image | `tests/e2e/animated-explainer-cdp.js` | 有驱动 |
| `talking-head` | talking_head | 4 | 无（本地 ffmpeg/ffprobe） | `builtin:local-executor`（`execute.js`） | 已可执行 |
| `cinematic` | cinematic | 4 | 无（本地 ffmpeg/ffprobe） | `tests/e2e/pipeline-options-matrix.js` | 有驱动（共享） |
| `animation` | animation | 4 | llm + video | 无 | **缺口** |
| `avatar-spokesperson` | talking_head | 4 | llm + video（另需 avatarId/voiceId） | `tests/e2e/video-model-pipelines.js` | 有驱动（共享） |
| `character-animation` | animation | 4 | llm + video | `tests/e2e/video-model-pipelines.js` | 有驱动（共享） |
| `clip-factory` | screen_recording | 4 | 无（本地 ffmpeg/ffprobe） | `tests/e2e/pipeline-options-matrix.js` | 有驱动（共享） |
| `documentary-montage` | cinematic | 5 | llm + image | 无 | **缺口** |
| `hybrid` | hybrid | 4 | llm + video | 无 | **缺口** |
| `localization-dub` | hybrid | 4 | llm（显式 voiceProvider 时 + tts） | `tests/e2e/pipeline-options-matrix.js` | 有驱动（共享） |
| `podcast-repurpose` | hybrid | 4 | image（无 transcript 时 + speech_recognition） | 无 | **缺口** |
| `framework-smoke` | custom | 2 | 无（本地 ffmpeg/ffprobe） | `builtin:framework-smoke` | 内置自检 |
| `film-engineering` | generated | 6 | 无（llmEnabled 默认关） | `tests/e2e/film-engineering-real.test.js` | 有驱动 |
| `story2video-compose` | generated | 8 | image（videoMode=fixed/ai-judged 时 + video；ai-judged 时 + llm） | `tests/e2e/pipeline-options-matrix.js` | 有驱动（共享） |
| `screen-demo` | screen_recording | 0 | — | — | **EXCLUDED**（无 stageDefs 占位） |

> 「有驱动（共享）」表示该驱动一次覆盖多条流水线/多个用例，不能直接按单条流水线参数化调用；本 PR 的审计只确认驱动文件存在，单条执行入口留到下一增量。

## 四、状态机与判定规则

每条流水线的审计结果只允许以下四种：

| 状态 | 含义 | 判定规则 | 退出码影响 |
|------|------|----------|------------|
| `READY` | 可以进入执行阶段 | 接线完整 + 驱动存在 + 必需工具存在 + 必需输入存在 | 不影响 |
| `BLOCKED` | 环境/资产不满足，不是代码缺陷 | 接线完整，但缺驱动、缺工具、缺输入或必需 env | 默认不影响；`--strict` 时判失败 |
| `BROKEN` | 代码/清单缺陷 | 存在未接线阶段；或清单漏登记带 `stageDefs` 的流水线；或引用了不存在的 pipeline | **必然失败** |
| `EXCLUDED` | 明确不参与 | `screen-demo`（无 `stageDefs`）或人工登记排除项 | 不影响 |

### 判定顺序（短路）

```
1. pipeline 不在 PIPELINE_DEFINITIONS → BROKEN(MANIFEST_UNKNOWN_PIPELINE)
2. pipeline 无 stageDefs → 若在 EXCLUDED 清单 → EXCLUDED；否则 BROKEN(MISSING_STAGE_DEFS)
3. 有任一 stage.type 未接线 → BROKEN(UNWIRED_STAGE)
4. driver 为空且不是 builtin → BLOCKED(NO_DRIVER)
5. driver 文件不存在 → BROKEN(DRIVER_MISSING)（登记了却不存在，属清单/仓库缺陷）
6. ffmpeg/ffprobe 缺失且该流水线需要 → BLOCKED(MISSING_MEDIA_TOOL)
7. 必需输入文件不存在 → BLOCKED(MISSING_INPUT)
8. 必需 env 未设置 → BLOCKED(MISSING_ENV)
9. 全部通过 → READY
```

> 模型能力只做**展示**，不在审计阶段判 BLOCKED：能力是否可用取决于应用内模型设置/SQLite provider 配置，纯 Node 进程无法可靠读取加密凭据。执行阶段由 `pipeline-model-preflight` 在真正启动前拦截，错误码 `PIPELINE_MODEL_REQUIREMENTS_MISSING`。

## 五、清单字段（manifest schema）

```js
{
  pipeline: 'story2video-compose',       // 必填，与 PIPELINE_DEFINITIONS.name 对齐
  driver: 'tests/e2e/pipeline-options-matrix.js', // 相对 apps/desktop；或 null / 'builtin:framework-smoke'
  driverMode: 'shared' | 'single' | 'builtin',
  defaultParams: { ... },                // 用于 resolvePipelineModelRequirements 的能力推导
  inputs: [                              // 相对 E2E_INPUTS（默认 <tmp>/story2video/e2e-inputs）
    { key: 'video', file: 'cinematic-source.mp4', description: '源视频' }
  ],
  expectedArtifact: 'video' | 'audio' | 'json' | 'none',
  timeoutSec: 1800,
  costTier: 'low' | 'medium' | 'high',
  notes: '...'
}
```

约束：

- 每条带 `stageDefs` 的流水线必须且只能登记一次；重复登记 → `BROKEN(DUPLICATE_MANIFEST_ENTRY)`。
- `defaultParams` 必须能通过 `resolvePipelineModelRequirements(pipeline, params)` 推导出非空/空能力集；不允许抛异常。
- `driver` 若为相对路径，必须是 `apps/desktop/` 下真实存在的文件；`builtin:` 前缀只允许 `builtin:framework-smoke`。
- `inputs` 只做存在性检查，不校验内容；文件缺失时状态 `BLOCKED(MISSING_INPUT)`，不阻塞其他流水线。

## 六、CLI 契约

```bash
# 默认：人类可读表格 + 摘要
node apps/desktop/scripts/pipeline-smoke/audit.js

# 机器可读 JSON（同时打印摘要）
node apps/desktop/scripts/pipeline-smoke/audit.js --json artifacts/pipeline-smoke/report.json

# 严格模式：BLOCKED 也判失败（发版前使用）
node apps/desktop/scripts/pipeline-smoke/audit.js --strict

# 只审计指定流水线（可重复）
node apps/desktop/scripts/pipeline-smoke/audit.js --only story2video-compose --only cinematic

# 生成合成输入素材（ffmpeg testsrc/sine；幂等，已存在则跳过）
node apps/desktop/scripts/pipeline-smoke/make-fixtures.js

# pnpm 快捷入口
pnpm --dir apps/desktop run pipeline:smoke:audit
pnpm --dir apps/desktop run pipeline:smoke:fixtures
```

输出 JSON 结构：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-27T02:00:00.000Z",
  "summary": { "total": 14, "ready": 4, "blocked": 9, "broken": 0, "excluded": 1 },
  "items": [
    {
      "pipeline": "cinematic",
      "status": "READY",
      "reasonCode": null,
      "reason": null,
      "stageCount": 4,
      "capabilities": [],
      "driver": "tests/e2e/pipeline-options-matrix.js",
      "missingInputs": [],
      "missingTools": []
    }
  ]
}
```

`summary.total` 计数规则：`manifest` 条目 + 覆盖反查新增条目 + 注册失败条目 + 排除条目；正常基线为 `14 + 0 + 0 + 1 = 15`，出现 BROKEN 时会因新增条目而增大，属预期。

退出码：

| 码 | 含义 |
|----|------|
| 0 | 无 `BROKEN`；默认模式下 `BLOCKED` 不算失败 |
| 1 | 存在 `BROKEN`，或 `--strict` 下存在 `BLOCKED` |
| 2 | 审计脚本自身故障（读不到 manifest / 依赖加载失败） |

## 七、交互与提示文字

本工具是开发/CI CLI，无 UI。控制台输出遵循：

- 表头：`PIPELINE  STAGES  CAPS  DRIVER  STATUS  REASON`
- `READY` 绿色（若终端支持），`BLOCKED` 黄色，`BROKEN` 红色，`EXCLUDED` 灰色。
- 摘要行：`SUMMARY total=14 ready=4 blocked=9 broken=0 excluded=1`。
- 每条 `BLOCKED` 的 `reason` 必须包含可执行动作，例如：
  - `NO_DRIVER：该流水线尚无 E2E 驱动，需在 tests/e2e/ 新增`
  - `MISSING_INPUT：缺少 E2E_INPUTS/cinematic-source.mp4`
  - `MISSING_MEDIA_TOOL：未找到 ffmpeg/ffprobe`

## 八、验收标准

1. `PIPELINE_SMOKE_MANIFEST` 覆盖全部 14 条带 `stageDefs` 的流水线；`screen-demo` 在 `EXCLUDED` 清单中。
2. 审计在完整注册的生产 `StageExecutor` 上运行，`listUnwiredStageTypes()` 为空时所有条目不得为 `BROKEN(UNWIRED_STAGE)`。
3. 人为漏注册一个阶段类型 ⇒ 对应流水线必须 `BROKEN(UNWIRED_STAGE)`；恢复后 `READY/BLOCKED`。
4. 清单漏登记一条带 `stageDefs` 的流水线 ⇒ 审计返回 `BROKEN(MANIFEST_COVERAGE_GAP)`，退出码 1。
5. 缺输入/缺驱动/缺工具分别返回对应 `reasonCode`，且不影响其他条目。
6. `--json` 输出满足 schema，`summary` 计数与 `items` 状态一致。
7. `--strict` 下存在 `BLOCKED` ⇒ 退出码 1；默认模式 ⇒ 0（除非有 BROKEN）。
8. 单元测试覆盖：manifest 覆盖/重复/未知 pipeline、状态判定短路、JSON 计数、退出码。
9. 文档不使用绝对路径（`scripts/check-doc-abs-paths.test.js` 通过）。
10. `make-fixtures.js` 生成计划覆盖清单中全部 `inputs.file`，已有非空文件时跳过（幂等），ffmpeg 缺失时退出码 2。

## 九、边界与风险

- **驱动存在 ≠ 能跑**：共享驱动的环境变量/输入/登录态由执行者负责；审计只保证文件存在。
- **模型能力未验证**：审计不读应用 SQLite 的加密 provider 凭据；真实执行由 `pipeline-model-preflight` 拦截。
- **CI 不跑真模型**：本工具只做静态/环境审计；真实 E2E 仍在专用 profile 上人工触发，避免费用与不稳定。
- **清单会漂移**：通过 `PIPELINE_DEFINITIONS` 自动对账 + 单元测试锁住；新增流水线未登记直接 BROKEN。
- **平台发布阶段**：`story2video-compose` 的 `publish` 阶段依赖平台登录态，审计只检查驱动存在，不检查账号授权。

## 十、后续增量（不在本 PR）

1. 为剩余 4 条缺口流水线补单条 E2E 驱动：`animation`、`documentary-montage`、`hybrid`、`podcast-repurpose`。
2. 把共享驱动拆成可按 `--pipeline` 参数化的通用驱动，支持 `--run <pipeline>`。
3. 把 `audit --strict` 接入发版前 checklist（QM-1 之后、发布之前）。
4. 真实执行结果落 `artifacts/pipeline-smoke/<date>/<pipeline>.json`，包含 ffprobe 元数据与产物路径。

## 附录 A：首次审计结果（2026-10-27，本机）

生成合成素材后执行 `pipeline:smoke:audit`，结果：

- `total=15 ready=9 blocked=5 broken=0 excluded=1`
- READY：`animated-explainer`、`cinematic`、`avatar-spokesperson`、`character-animation`、`clip-factory`、`localization-dub`、`framework-smoke`、`film-engineering`、`story2video-compose`
- BLOCKED（均为 `NO_DRIVER`）：`talking-head`、`animation`、`documentary-montage`、`hybrid`、`podcast-repurpose`
- EXCLUDED：`screen-demo`

说明：READY 只代表静态条件（接线/驱动/工具/输入）满足，不代表 provider Key 与生成质量已验证；真实执行前仍需应用内模型设置与 `pipeline-model-preflight`。

## 附录 B：增量 2 真实执行结果（2026-10-27，本机）

`execute.js` 用生产 `PipelineEngine` + `StageExecutor` 真实执行本地流水线：

| 流水线 | 结果 | runId | 产物 | ffprobe |
|--------|------|-------|------|---------|
| `talking-head` | **PASS** | `mvq78e25_ad8d` | `%TEMP%/story2video/talkinghead/mvq78e25_ad8d/talkinghead_output.mp4` | duration=4.017s, h264+aac |
| `framework-smoke` | **PASS** | `mvq79act_f4an` | `%TEMP%/story2video/smoketest/mvq79act_f4an/smoketest_output.mp4` | duration=2s, h264+aac |

执行后审计：`total=15 ready=10 blocked=4 broken=0 excluded=1`（talking-head 从 `NO_DRIVER` 变为 `READY`）。


## 十二、增量 3：provider 就绪审计（2026-10-27）

### 12.1 背景

前两增量的 `READY` 只检查接线、驱动、工具、输入，**没有检查应用里是否配置了模型 provider**。本机实测应用 SQLite 只有 `minimax-image`（image）一个可用 provider，但审计仍把 `animated-explainer`（llm+image）、`avatar-spokesperson`（llm+video）、`character-animation`（llm+video）、`localization-dub`（llm）、`story2video-compose`（image+video）标为 READY，属于「静态条件满足 ≠ 能真正生成」的误报。

### 12.2 数据源与安全

- 默认读取 `%APPDATA%/@multi-publish/desktop/multi-publish.db`（可用 `--providers-db <path>` 覆盖）。
- 只读打开（sql.js），读取 `id/category/enabled/is_default/config` 与 `length(api_key)`/`length(api_key_enc)`。
- **不解密、不输出 API Key**；只有 `enabled=1` 且 key 长度>0 的 provider 计入能力集。
- 能力来源：`category` + `config.capabilities` + `config.capability_models` 的并集。

### 12.3 CLI 与判定

```bash
node apps/desktop/scripts/pipeline-smoke/audit.js --with-providers
node apps/desktop/scripts/pipeline-smoke/audit.js --with-providers --providers-db <path> --json artifacts/pipeline-smoke/report-providers.json
```

- 未加 `--with-providers`：保持原静态审计语义，不读 DB。
- 加 `--with-providers`：每条流水线的 `capabilities` 与可用能力集求差，缺能力 → `BLOCKED(MISSING_PROVIDER)`，reason 点名缺失能力（如 `llm, video`）。
- DB 缺失/损坏：CLI 退出码 2，不静默通过。
- 报告新增 `providerChecked: true`；CLI 首行打印 `PROVIDERS db=... usable=N caps=...`。

### 12.4 本机实测

```
PROVIDERS db=...multi-publish.db usable=1 caps=image
SUMMARY total=15 ready=5 blocked=9 broken=0 excluded=1
```

- READY（5）：`talking-head`、`cinematic`、`clip-factory`、`framework-smoke`、`film-engineering`
- BLOCKED(MISSING_PROVIDER)：`animated-explainer`（llm）、`avatar-spokesperson`（llm, video）、`character-animation`（llm, video）、`localization-dub`（llm）、`story2video-compose`（video）
- BLOCKED(NO_DRIVER)：`animation`、`documentary-montage`、`hybrid`、`podcast-repurpose`
- EXCLUDED：`screen-demo`

说明：本机只有 image 能力，因此 5 条含 LLM/VIDEO 依赖的流水线被正确降级为 BLOCKED；这正是「provider 未就绪」的真实读数。


## 十三、增量 4：CDP provider 流水线驱动（2026-10-27）

### 13.1 背景

`podcast-repurpose` / `documentary-montage` 需要真实图片/LLM/视频/TTS provider，不能在纯 Node 进程里用 `execute.js` 跑。应用已在 `shared-user-data` 配置 LLM/VIDEO/IMAGE/TTS provider，并在 9279 端口暴露 CDP；最真实的 E2E 是**连接已启动的应用**，复用它的 provider、登录态、模型设置与产物目录。

### 13.2 驱动契约

```bash
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline podcast-repurpose
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline documentary-montage --json artifacts/pipeline-smoke/documentary.json
```

- 连接 `http://127.0.0.1:9279`（`--cdp-port` 可覆盖）；
- 找到含 `window.electronAPI.pipelineStartOrchestrated` 的页面；
- 调 `pipelineStartOrchestrated(pipeline, params)`，轮询 `pipelineGetRunContext(runId)`；
- 产物提取优先 `render/report/compose/finalize/export`，排除输入 `video/audio/image`；
- `ffprobe` 校验 duration>0 + codec；超时调用 `pipelineCancelRun`；
- 退出码 0 PASS / 1 FAIL / 2 参数/连接/装配错误；报告落 `--json`。

### 13.3 本机实测

| 流水线 | 结果 | runId | 耗时 | 产物 |
|--------|------|-------|------|------|
| `podcast-repurpose` | **PASS** | `mvqj1cld_e1kt` | 39.7s | duration=5s，h264+aac |
| `documentary-montage` | **PASS** | `mvqk0zj5_7v8p` | 142.8s | duration=67.37s，h264+aac |

审计（`shared-user-data` provider DB）：

```
PROVIDERS usable=9 caps=image,llm,multimodal,video,tts
SUMMARY total=15 ready=12 blocked=2 broken=0 excluded=1
```

剩余 `NO_DRIVER`：`animation`、`hybrid`。

### 13.4 animation 超时（未纳入 READY）

`animation` 真实执行 `mvqj2hff_1bpm`：concept/storyboard 完成，`animate` 阶段 12/12 场景提交后停在 35%（约 18 分钟），20 分钟总超时后取消。**未把 `animation` 标为 READY**；CDP 驱动文件已实现，但清单保持 `driver:null`，待场景数/并发/超时优化后再纳入。

### 13.5 hybrid 队列失败（未纳入 READY）

hybrid 真实执行 mvqk4n8q_fbto：156s 后失败，错误为「排队等待超时，请稍后重试。」（视频 provider 队列）。清单保持 driver:null，不纳入 READY。

### 13.6 边界

- 需要应用已启动、已登录、已配置 provider，且 9279 端口可连；CI 不自动跑。
- 不验证 key 有效性、额度、base_url、模型名；这些由应用内 `pipeline-model-preflight` 与真实执行负责。
- 产物在应用临时目录，报告只记录路径，不复制大文件。


## 十四、增量 5：推理型 LLM 预算修复与 CDP 超时对齐（2026-10-27）

### 14.1 animation 失败根因

`animation` 第二次真实执行失败在 `storyboard`，错误 `storyboard 无法解析场景 JSON`。根因不是 JSON parser，而是**默认 LLM 的推理预算耗尽**：

- 默认 LLM 为 `deepseek-v4-flash`（推理型）；
- 直接调用同模型 `max_tokens=4000`：`content=""`、`finish_reason="length"`、`reasoning_tokens=4000`，全部预算被思考占用；
- `storyboard` 收到空字符串，`parseJsonArray` 返回 null，三次重试仍空 → `STORYBOARD_EMPTY_SCENES`。

另外 CDP 驱动默认 20min，而清单 `animation.timeoutSec=1800`（30min），首次失败被误读为纯超时。

### 14.2 修复

- `videogen-stages.js`：新增 `MAX_LLM_BUDGET_TOKENS=16000`；
- `callDefaultLlm` 在 `content` 为空且 `finish_reason=length` 或 reasoning_tokens ≥ 90% 预算时，自动翻倍重试：5000 → 10000 → 16000；
- 到 16000 仍空：明确抛「推理预算耗尽，已到上限 16000 tokens」，不无限重试；
- 显式 `maxTokens` 同样走升级链（4000 → 8000 → 16000）；
- CDP `DEFAULT_TIMEOUT_MS` 20min → 30min，与清单对齐。

### 14.3 验证

- `videogen-stages.test.js`：42 passed（新增 2 例：空 content + length 升级；到上限只调用 3 次并明确报错）。
- 直接 LLM 证据：`tianyiyun-coding-plan / deepseek-v4-flash-0731-oc` + 16000 tokens 返回合法 12 场景 JSON（completion_tokens=1480）。
- animation/hybrid 仍为 `NO_DRIVER`；需重启应用加载本修复后真实重跑，PASS 才允许挂 driver。

### 14.4 边界

- 只对「空 content + length/推理占满」升级，不把所有调用放大。
- 未验证 MiniMax-M2.7/M3、kimi 等其他推理模型在 16000 下的表现。
- 当前运行中的应用加载的是旧代码，本增量不自动重启用户应用。


## 十五、增量 6：creative storyboard 多层修复（2026-10-28）

### 15.1 五层根因

`animation` / `hybrid` 在 storyboard 反复失败，逐层取证后确认是五层叠加：

1. creative 分镜仍用 `DEFAULT_LLM_MAX_TOKENS=1600`，12 场景长 prompt JSON 被截断；
2. `buildStoryboardPrompt` 只读 `concept.visual_style`，而 concept 阶段实际输出 `{name, visual}`，prompt 只剩「动态视觉」；
3. `resolveVideogenConcept` 只返回 `value.concept` 对象，外层 `context.concept.topic` 没进入 prompt；
4. creative 模式仍执行 `alignmentConfig.enabled=true`，短创意被要求逐字覆盖「机器人/城市/行走」；
5. 模型偶发返回 `[]` / 非 JSON，creative 没有兜底，整条流水线失败。

另有 CDP 默认 20min 与清单 `animation.timeoutSec=1800` 不一致。

### 15.2 修复

- storyboard 统一 `storyboardMaxTokens=8000`；
- `buildStoryboardPrompt` 从 `visual_style || visual || role_design` 提取视觉，并把 `topic` 拼进 user；
- `resolveVideogenConcept` 对象分支合并外层 `topic`；
- creative `alignmentConfig.enabled=false`（自由拓展不强制逐字覆盖）；
- creative 空/非法输出 → 用原文拆 1-4 个兜底场景，`report.fallback=true`；fidelity/hybrid 仍 fail closed；
- CDP 默认超时 30min。

### 15.3 真实执行

| 流水线 | 结果 | runId | 耗时 | 产物 |
|--------|------|-------|------|------|
| `animation` | **PASS** | `mvqw26rm_jdeu` | 1434s | duration=21.2s，h264+aac |
| `hybrid` | **PASS** | `mvqx5xae_7giv` | 621s | duration=5.2s，h264+aac |

审计（`shared-user-data` provider DB）：

```
PROVIDERS usable=9 caps=image,llm,multimodal,video,tts
SUMMARY total=15 ready=14 blocked=0 broken=0 excluded=1
```

### 15.4 边界

- creative 兜底只保证有场景可生成，不保证 LLM 级分镜质量；
- 8 条 READY 共享驱动流水线本次未全部重跑，READY 仍只代表静态条件；
- animation 23.9min / hybrid 10.3min 属高成本任务，应在发布前单独排期。
