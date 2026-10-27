# 视频创作流水线 E2E 冒烟：分析与成果（2026-10-27 ~ 2026-10-28）

> 范围：`PIPELINE_DEFINITIONS` 中 14 条带 `stageDefs` 的视频流水线（`screen-demo` 为占位，排除）。
> 代码基线：`origin/main`（含 PR #4515 / #4519 / #4535 / #4541 / #4556 / #4561 / 本文件对应 PR）。
> 结论：**14 条均有驱动，审计 `ready=14 blocked=0 broken=0 excluded=1`；其中 11 条本轮真实跑出成片，3 条受选择/契约前置阻塞（avatarId、selectedShotIds、research schema）。**

## 1. 为什么要做

原问题不是「某条流水线报错」，而是无法回答「所有视频流水线到底能不能跑通」。逐层分析后发现四类系统性缺口：

1. **接线缺口**：阶段类型未注册时可能静默跳过，流水线「成功」但没有产物。
2. **执行缺口**：审计只检查驱动文件是否存在，`READY` 不代表真跑。
3. **provider 缺口**：没检查应用 SQLite 里是否配置了 LLM/IMAGE/VIDEO/TTS，导致 READY 假绿。
4. **长尾缺口**：需要 provider 的流水线缺真实执行器；推理模型预算、12 场景耗时、队列限流会以「JSON 解析失败/超时」表象出现。

## 2. 建设成果

| 能力 | 文件 | 作用 |
|------|------|------|
| 清单 | `apps/desktop/scripts/pipeline-smoke/manifest.js` | 14 条流水线的 stages/capabilities/driver/inputs/timeout |
| 审计 | `apps/desktop/scripts/pipeline-smoke/audit.js` | READY/BLOCKED/BROKEN/EXCLUDED；`--with-providers`；`verifiedRunId` 门禁 |
| 合成素材 | `apps/desktop/scripts/pipeline-smoke/make-fixtures.js` | ffmpeg 生成 5 个标准输入 |
| 纯本地执行器 | `apps/desktop/scripts/pipeline-smoke/execute.js` | talking-head / framework-smoke 真跑，产物 + ffprobe |
| provider 就绪 | `apps/desktop/scripts/pipeline-smoke/provider-readiness.js` | 只读应用 SQLite，能力判定，不解密 key |
| CDP 执行器 | `apps/desktop/tests/e2e/pipeline-smoke-cdp.js` | 连接已启动应用，跑需要 provider 的流水线 |
| PRD | `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md` | 增量 1~6 契约、边界、实测 |
| 本分析 | `01-docs/ANALYSIS-VIDEO-PIPELINE-E2E-2026-10-28.md` | 全量结果与 runbook |

## 3. 当前审计读数

```text
PROVIDERS db=%SHARED_USER_DATA%/multi-publish.db
usable=9 caps=image,llm,multimodal,video,tts
SUMMARY total=15 ready=14 blocked=0 broken=0 excluded=1
```

> 注意：应用实际 userData 是仓库根 `shared-user-data`，不是 `%APPDATA%/@multi-publish/desktop`；审计必须传 `--providers-db`，否则会误报 `MISSING_PROVIDER`。

## 4. 真实执行结果（本轮可核）

| 流水线 | 结果 | runId | 耗时 | 产物 / ffprobe |
|--------|------|-------|------|----------------|
| `talking-head` | PASS | `mvq8s5f4_5zyd` | 1.4s | 4.017s，h264+aac |
| `framework-smoke` | PASS | `mvq79act_f4an` | 5.0s | 2s，h264+aac |
| `podcast-repurpose` | PASS | `mvqj1cld_e1kt` | 39.7s | 5s，h264+aac |
| `documentary-montage` | PASS | `mvqk0zj5_7v8p` | 142.8s | 67.37s，h264+aac |
| `animation` | PASS | `mvqw26rm_jdeu` | 1434.5s | 21.20s，h264+aac |
| `hybrid` | PASS | `mvqx5xae_7giv` | 621.0s | 5.20s，h264+aac |
| `cinematic` | PASS | `mvr0j9oy_4ytr` | 7.9s | 4s，h264 |
| `clip-factory` | PASS | `mvr0jty9_3xvo` | 15.1s | 12s，h264 |
| `localization-dub` | PASS | `mvr2w1kp_vofb` | 6.2s | 2.304s，h264+aac |
| `story2video-compose` | PASS | `mvr0omws_u0cp` | 465.4s | 5.28s，h264+aac |
| `character-animation` | PASS | `mvr1dhhp_ajmc` | 1501.0s | 21.20s，h264+aac |

## 5. 仍未自动跑通的 3 条（前置阻塞）

| 流水线 | 阻塞 | 证据 |
|--------|------|------|
| `animated-explainer` | research schema 校验失败：`data_points[].value` / `sources[].publisher` 额外字段、`angles_discovered` 为空 | run `mvr11zsl_qpd3`，25.7s |
| `avatar-spokesperson` | 启动前需选择数字人形象，manifest 无 `avatarId`/`voiceId` 默认 | `AVATAR_ID_REQUIRED` |
| `film-engineering` | 需 `kitDir` + 非空 `selectedShotIds`，不是无参可跑 | `SELECTED_SHOT_IDS_REQUIRED` |

- 这三条不是「代码坏了」，而是**需要用户选择/上游产物**；发布前应把它们在 UI 里走完选择再跑，或补受控测试夹具。
- `READY` 仍只代表静态条件满足，不代表已跑。

## 6. 关键根因与修复

### 6.1 接线 fail-open（PR #4515）

- 未知阶段类型以前可能静默跳过；改为 fail-closed，并新增 `pipeline-wiring-diagnostics.js`。
- 20 例接线测试锁住「阶段类型未注册 ⇒ BROKEN(UNWIRED_STAGE)」。

### 6.2 审计只查文件（PR #4519）

- 建清单、审计、fixtures；`screen-demo` 显式排除。
- 首次读数 `ready=9 blocked=5`，暴露 5 条 `NO_DRIVER`。

### 6.3 纯本地执行器（PR #4535）

- `talking-head` / `framework-smoke` 用生产 `PipelineEngine` + `StageExecutor` 真跑。
- 关键教训：`success:true` ≠ 有产物；必须 `existsSync + size>0 + ffprobe duration>0`，且产物提取优先 `render/report`，排除 `upload/source`。

### 6.4 provider 假绿（PR #4541）

- 只读应用 SQLite 判断 `enabled + hasKey`，缺能力 → `BLOCKED(MISSING_PROVIDER)`。
- 修正了「`animated-explainer` 等 5 条被误报 READY」的问题。
- 默认 `%APPDATA%` 与运行应用 `shared-user-data` 不一致，是后续必须显式传 `--providers-db` 的原因。

### 6.5 需要 provider 的 CDP 执行器（PR #4556）

- 连接已启动应用 9279，复用其 provider/登录态/模型设置。
- `podcast-repurpose` / `documentary-montage` 真实 PASS。
- 教训：驱动文件存在 ≠ 已验证；只有真实 PASS 的流水线才挂 driver。

### 6.6 推理预算耗尽（PR #4561）

- 默认 LLM `deepseek-v4-flash` 是推理型；4000 tokens 全被 `reasoning_tokens` 占用，`content=""`、`finish_reason=length`。
- `callDefaultLlm` 空 content + length/90% reasoning → 5000→10000→16000；非推理不升级；`disableBudgetEscalation` 可关闭。

### 6.7 creative storyboard 五层问题（本 PR）

1. creative 仍用 1600 token → 12 场景 JSON 截断；
2. `buildStoryboardPrompt` 只读 `visual_style`，concept 实际是 `{name, visual}`；
3. `resolveVideogenConcept` 丢掉外层 `topic`（原始文案）；
4. creative 仍执行严格实体覆盖，短创意必失败；
5. 模型偶发返回 `[]`/非 JSON，无兜底。
- 修复：8000 预算、visual/topic 注入、creative 关闭对齐、原文兜底场景、CDP 30min。
- 结果：animation 23.9min PASS、hybrid 10.3min PASS，审计 14/0。

## 7. Runbook

### 7.1 环境

```bash
# 应用必须已启动，CDP 9279，且 shared-user-data 已配置 provider
# 检查：
Get-NetTCPConnection -LocalPort 9279 -State Listen
```

### 7.2 审计

```bash
node apps/desktop/scripts/pipeline-smoke/make-fixtures.js
node apps/desktop/scripts/pipeline-smoke/audit.js \
  --with-providers \
  --providers-db "%SHARED_USER_DATA%/multi-publish.db" \
  --json artifacts/pipeline-smoke/report.json
```

### 7.3 纯本地流水线

```bash
node apps/desktop/scripts/pipeline-smoke/execute.js --pipeline talking-head
node apps/desktop/scripts/pipeline-smoke/execute.js --pipeline framework-smoke
```

### 7.4 provider 流水线

```bash
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline podcast-repurpose
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline documentary-montage
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline animation
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline hybrid
```

### 7.5 判定

- `PASS`：报告 `status=PASS`、`artifact` 存在、`probe.duration>0`、codec 含 h264/aac。
- `FAIL`：保留 `runId`、`reasonCode`、`error`；用 `pipelineGetRunContext` 看 stage error/context。
- `READY` 不等于 PASS；新增 driver 必须补 `verifiedRunId`，否则审计 `UNVERIFIED_DRIVER`。

## 8. 剩余风险

1. 8 条 READY 未逐条重跑（最大缺口）。
2. CDP 冒烟依赖应用运行 + 9279 + provider，CI 不自动跑。
3. animation 23.9min / hybrid 10.3min，成本高；12 场景并发仍保守（视频并发上限 2）。
4. provider 队列/额度（`排队等待超时`）仍是外部风险；重试前先确认额度。
5. creative 兜底场景只保证「有产物」，不保证分镜质量；fidelity/hybrid 仍 fail closed。
6. 运行中的应用加载旧代码时，代码修复必须重启后才会生效。
