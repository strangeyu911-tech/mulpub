# Video Pipeline E2E Smoke

> 用途：回答「视频创作流水线到底能不能跑通」——审计 14 条带 `stageDefs` 的流水线，按「纯本地 / 需要 provider」两条路径真实执行，保存 runId + 产物 + ffprobe 证据。
> 本 skill 是 2026-10-27~28 多轮修复（PR #4515 / #4519 / #4535 / #4541 / #4556 / #4561 / pipeline-smoke-storyboard）的经验沉淀。

## When to Use

- 用户问「所有视频流水线都能跑通吗」「某条流水线为什么失败」
- 新增/修改 pipeline 后，需要更新 E2E 冒烟清单与审计
- 需要真实跑 `talking-head` / `podcast-repurpose` / `animation` / `hybrid` 等
- 需要判断 `READY` 是静态条件还是真实 PASS
- 排查 `storyboard 无法解析场景 JSON`、`排队等待超时`、`产物不存在`、provider 未配置

## 0. 先读这些文件

```text
apps/desktop/scripts/pipeline-smoke/manifest.js
apps/desktop/scripts/pipeline-smoke/audit.js
apps/desktop/scripts/pipeline-smoke/execute.js
apps/desktop/scripts/pipeline-smoke/provider-readiness.js
apps/desktop/tests/e2e/pipeline-smoke-cdp.js
01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md
01-docs/ANALYSIS-VIDEO-PIPELINE-E2E-2026-10-28.md
```

## 1. 四条判定，不要混

| 判定 | 含义 | 下一步 |
|------|------|--------|
| `PASS` | 真实执行完成，产物存在，ffprobe duration>0 | 记 runId/产物/耗时 |
| `READY` | 静态条件满足（接线/驱动/工具/输入/provider） | 不等于跑通，仍需真实执行 |
| `BLOCKED` | 缺输入/工具/provider/驱动，或 driver 无 verifiedRunId | 按 reasonCode 修环境/补驱动 |
| `BROKEN` | 接线/清单/驱动文件一致性坏了 | 先修代码，不要重试 |

## 2. 标准命令

```bash
# 合成素材（幂等；已有非空文件跳过）
node apps/desktop/scripts/pipeline-smoke/make-fixtures.js

# 审计：必须指向应用真实 userData DB
node apps/desktop/scripts/pipeline-smoke/audit.js \
  --with-providers \
  --providers-db "%SHARED_USER_DATA%/multi-publish.db" \
  --json artifacts/pipeline-smoke/report.json

# 纯本地（不需要 provider）
node apps/desktop/scripts/pipeline-smoke/execute.js --pipeline talking-head
node apps/desktop/scripts/pipeline-smoke/execute.js --pipeline framework-smoke

# 需要 provider：连接已启动应用（CDP 9279）
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline podcast-repurpose
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline documentary-montage
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline animation
node apps/desktop/tests/e2e/pipeline-smoke-cdp.js --pipeline hybrid
```

## 3. 应用与 provider 前置

- 运行中的应用必须带 `--remote-debugging-port=9279`，页面有 `window.electronAPI.pipelineStartOrchestrated`。
- 应用真实 userData 常见为仓库根 `shared-user-data`（不是 `%APPDATA%/@multi-publish/desktop`）。
- 可用 provider 必须 `enabled=1` 且有 key；多模态 provider 的 `config.capabilities` / `capability_models` 决定能力。
- 改了 `electron/services/*` 后**必须重启应用**才会生效；仅重跑脚本不够。

## 4. 驱动选择决策树

```text
流水线 capabilities 为空？
├─ 是 → execute.js（纯本地生产引擎）
└─ 否 → 应用已启动 + provider 已配置？
        ├─ 是 → pipeline-smoke-cdp.js（CDP，真实 provider）
        └─ 否 → 先配置 provider；不要用假数据假装 PASS
```

## 5. 新增流水线接入 checklist

1. `manifest.js` 加条目：stages/capabilities/driver/inputs/timeoutSec/costTier/notes。
2. 有 driver 后先真实跑一次；只有 `PASS` 才写 `driver` + `verifiedRunId`。
3. `audit.js` 对 `tests/e2e/pipeline-smoke-cdp.js` 要求 `verifiedRunId`，缺失 → `BLOCKED(UNVERIFIED_DRIVER)`。
4. 单测：manifest 覆盖、状态机、退出码、driver 验证门禁。
5. PRD 增量 + record；跑 `check-doc-abs-paths`、`check-max-lines`、eslint、目标 vitest。
6. 走 QM-6 deep-review、PR CI、squash merge、main quality-gate 回读。

## 6. 核心陷阱（都踩过）

### 6.1 `success:true` ≠ 有产物

必须：
```text
extractArtifact → 只认 render/report/compose/finalize/export
→ 排除 upload/source/input
→ fs.existsSync + stat.isFile + size>0
→ ffprobe duration>0 + codec
```

### 6.2 READY 假绿

- 只检查驱动文件存在 → `READY` 但从未跑过。
- 只检查静态条件 → 没 provider 也 READY。
- 解决：`--with-providers` + `verifiedRunId` 门禁 + 真实 PASS 才挂 driver。

### 6.3 推理型 LLM 预算

- `max_tokens` 包含 reasoning tokens；预算不足时 `content=""`、`finish_reason=length`。
- 处理：空 content + length / reasoning≥90% → 5000→10000→16000；非推理模型不升级；提供 `disableBudgetEscalation`。

### 6.4 creative storyboard 五层坑

- 1600 token 截断 12 场景 JSON；
- `buildStoryboardPrompt` 只读 `visual_style`，concept 实际是 `{name, visual}`；
- `resolveVideogenConcept` 丢外层 `topic`；
- creative 仍执行严格实体覆盖；
- 模型返回 `[]` / 非 JSON 无兜底。
- 修复：8000 预算、visual/topic 注入、creative 关闭对齐、原文兜底（≤4 场景）。

### 6.5 超时不是一种

- 清单 `timeoutSec`（流水线预算）≠ CDP `DEFAULT_TIMEOUT_MS`（驱动预算）≠ provider 队列 `MAX_QUEUE_WAIT_MS`（30s）。
- 看到「排队等待超时」先查 provider 额度/队列，不要加代码超时。
- 看到「执行超时」先看 stage currentStage/progress，再决定扩预算还是降场景数。

### 6.6 应用重启

- `sync-app.ps1` 会 fast-forward `mp-app-live2` 到 origin/main；
- 本地未合并的修复不会被加载；调试时可临时复制 `videogen-stages.js` 到 `mp-app-live2`，但合并后应恢复；
- 重启后确认 9279 监听 + 页面有 electronAPI。

## 7. 当前基准（2026-10-28）

- 审计：`total=15 ready=14 blocked=0 broken=0 excluded=1`（READY 含 8 条静态条件）
- 真实 PASS（6）：talking-head、framework-smoke、podcast-repurpose、documentary-montage、animation、hybrid
- READY 未重跑（8）：animated-explainer、cinematic、avatar-spokesperson、character-animation、clip-factory、localization-dub、film-engineering、story2video-compose
- 关键 runId：
  - podcast `mvqj1cld_e1kt`
  - documentary `mvqk0zj5_7v8p`
  - animation `mvqw26rm_jdeu`
  - hybrid `mvqx5xae_7giv`

## 8. 质量节拍

- 任何代码修改走 worktree + TDD + `check-pr-exec-record` + QM-6 deep-review + PR CI + main 回读。
- 文档/记录必须写 `%TEMP%`/描述性路径，不写绝对盘符，否则 `check-doc-abs-paths` 红。
- 高成本真实执行（animation 24min、hybrid 10min）要单独排期，不要塞进快速 CI。
