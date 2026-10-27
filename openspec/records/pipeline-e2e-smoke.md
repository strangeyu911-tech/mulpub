---
record: pipeline-e2e-smoke
task: 视频创作流水线 E2E 冒烟矩阵——14 条带 stageDefs 流水线的清单、就绪审计 CLI、合成输入素材与回归测试
date: 2026-10-27
---

## 本次执行记录：视频创作流水线 E2E 冒烟矩阵（pipeline-e2e-smoke，2026-10-27）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 开发工具 + 测试 + 文档（`apps/desktop/scripts/pipeline-smoke/**`、`apps/desktop/electron/tests/pipeline-smoke-audit.test.js`、`01-docs/**`、`openspec/**`）⇒ 隔离 worktree（D 盘非 C，路径以 `git rev-parse --show-toplevel` 实证）、裸分支 `pipeline-e2e-smoke`（`git rev-parse --abbrev-ref HEAD` 实证） |
| 第一性原因（QM-5 ①） | ✅ | PR #4515 只证明了「stage.type 有执行器」，没有任何单一真源登记「14 条流水线各自需要什么驱动/输入/工具/能力」。验证只能翻散落的 `tests/e2e/*.js` 与口头确认，导致每次发版前都要重新判断，且无法区分「代码断链」与「环境缺 Key」。根因是缺少**清单 + 就绪审计**这一层。 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：`pipeline-executor-wiring.test.js` 只断言接线，不断言每条流水线的驱动/输入/工具是否齐备；②**E2E 层**：`tests/e2e/*.js` 是零散脚本，没有总清单，新增流水线不会触发任何「未登记」失败；③**CI 层**：没有针对 E2E 就绪面的 job；④**审查层**：PRD/记录只写「14 条已接线」，未回答「哪几条有驱动、哪几条缺输入」。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `apps/desktop/scripts/pipeline-smoke/manifest.js`（14 条 + screen-demo 排除）、`audit.js`（READY/BLOCKED/BROKEN/EXCLUDED + JSON + 退出码）、`make-fixtures.js`（5 个合成素材，幂等）；新增 `electron/tests/pipeline-smoke-audit.test.js` **20 例**（manifest 覆盖/重复/未知、状态短路、JSON 计数、严格退出码、生产装配、素材计划/幂等）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①审计对 `PIPELINE_DEFINITIONS` 自动反查：新增带 `stageDefs` 的流水线未登记 ⇒ `BROKEN(MANIFEST_COVERAGE_GAP)`；②清单重复/未知 ⇒ BROKEN；③`--strict` 可接入发版前 checklist；④PRD 与记录沉淀「接线完整 ≠ E2E 就绪」的边界。 |
| 行尾与 diff 对账 | ✅ | 见「验收证据」的 numstat 两口径实测 |
| 接线棘轮 | ✅ | 新增测试位于 `electron/tests/`，命中现有 include 白名单 `electron/tests/**/*.test.{js,ts}`；未新增目录级白名单需求 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未改 `apps/desktop/electron/**` 运行时、未改 renderer/样式/模板；仅新增开发脚本、测试与文档，不进入打包产物语义。 |
| QM-6 CCG 双模型外部评审 | ✅ | claude（critic）+ opencode（proposer）双模型审查；4 条争议全部 `dismissed`（逐条 prosecution/defense/rationale 见 `.adversarial/ccg-deep-c799c370/adjudication.json`），`deepReview.status=self_play_resolved`、`performedBy=self-play`；无阻断项。minScore 仅代表建议密度，不代表存在阻断缺陷 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。写成 `PASS` 会被判「预写不存在的证据」 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 ledger 按 2026-10-15「旧载体冻结」政策零改写）

### 一、问题与结论

PR #4515 之后，「接线完整性」已可机械证明；但「所有流水线能否跑通」仍缺一层可重复的 E2E 就绪审计。本 PR 新增：

1. **单一清单**：14 条带 `stageDefs` 的流水线全部登记（`screen-demo` 显式排除）；
2. **只读审计**：一条命令输出每条流水线的 `READY / BLOCKED / BROKEN / EXCLUDED`，区分代码缺陷与环境缺失；
3. **合成素材**：ffmpeg testsrc/sine 生成 5 个输入，幂等；
4. **回归锁**：清单漏登记/重复/未知 pipeline、未接线阶段、驱动缺失、输入缺失、工具缺失、退出码均有测试。

### 二、改动清单

- `apps/desktop/scripts/pipeline-smoke/manifest.js`（新增）
  - 14 条流水线：animated-explainer、talking-head、cinematic、animation、avatar-spokesperson、character-animation、clip-factory、documentary-montage、hybrid、localization-dub、podcast-repurpose、framework-smoke、film-engineering、story2video-compose；
  - 每条含 driver/driverMode/defaultParams/inputs/requiredTools/expectedArtifact/timeoutSec/costTier/notes；
  - `PIPELINE_SMOKE_EXCLUDED` 登记 `screen-demo`（NO_STAGE_DEFS_PLACEHOLDER）。
- `apps/desktop/scripts/pipeline-smoke/audit.js`（新增）
  - `createWiringEngine()` 用生产 `registerAllPipelineStages` 装配真实 `StageExecutor`；
  - 状态判定顺序：未知 pipeline → 无 stageDefs → 未接线 → 无驱动 → 驱动缺失 → 缺工具 → 缺输入 → 缺 env → READY；
  - `--json` / `--strict` / `--only` / `--input-dir`；退出码 0/1/2；
  - 能力推导复用 `resolvePipelineModelRequirements()`，不重复维护能力表。
- `apps/desktop/scripts/pipeline-smoke/make-fixtures.js`（新增）
  - 生成 `cinematic-source.mp4`、`clipfactory-long.mp4`、`localization-source.mp4`、`talkinghead-source.mp4`、`podcast-source.mp3`；已有非空文件跳过。
- `apps/desktop/electron/tests/pipeline-smoke-audit.test.js`（新增，15 例）
- `apps/desktop/package.json`：`pipeline:smoke:audit` / `pipeline:smoke:fixtures`
- `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md`（新增）
- `openspec/changes/pipeline-e2e-smoke/proposal.md`（新增）

### 三、验收证据

- 测试：`pnpm exec vitest run electron/tests/pipeline-smoke-audit.test.js` → **20 passed**。
- 审计（生成合成素材后）：`total=15 ready=9 blocked=5 broken=0 excluded=1`。
  - READY：animated-explainer、cinematic、avatar-spokesperson、character-animation、clip-factory、localization-dub、framework-smoke、film-engineering、story2video-compose；
  - BLOCKED（NO_DRIVER）：talking-head、animation、documentary-montage、hybrid、podcast-repurpose；
  - EXCLUDED：screen-demo。
- `node --test scripts/check-doc-abs-paths.test.js` → fail 0。
- `node .github/scripts/check-max-lines.js` → ✅ 无新增超大文件。
- `pnpm exec eslint scripts/pipeline-smoke/*.js electron/tests/pipeline-smoke-audit.test.js` → 0 errors。

### 四、边界

- READY 只代表静态条件（接线/驱动/工具/输入）满足，不代表 provider Key 与生成质量已验证；真实执行前仍需应用内模型设置与 `pipeline-model-preflight`。
- 共享驱动（`pipeline-options-matrix.js` / `video-model-pipelines.js`）一次覆盖多条流水线，暂不支持 `--run <pipeline>` 单条参数化；本 PR 只做审计。
- 不覆盖 `screen-demo`（无 stageDefs 占位）与 `video-clone`（独立 IPC 引擎）。
- `--strict` 下 BLOCKED 会失败；默认模式只有 BROKEN 失败，避免开发机缺 Key 时误红。

### 五、后续增量

1. 为 5 条缺口流水线补单条 E2E 驱动：talking-head、animation、documentary-montage、hybrid、podcast-repurpose；
2. 把共享驱动拆成通用 `--pipeline` 参数化驱动，支持 `--run <pipeline>`；
3. 把 `audit --strict` 接入发版前 checklist；
4. 真实执行结果落 `artifacts/pipeline-smoke/<date>/<pipeline>.json`（ffprobe 元数据 + 产物路径）。

## CHANGELOG 条目

# 视频创作流水线 E2E 冒烟矩阵（pipeline-e2e-smoke）

新增 14 条流水线的 E2E 冒烟清单、只读就绪审计 CLI（READY/BLOCKED/BROKEN/EXCLUDED）、ffmpeg 合成输入素材生成器与 15 例回归测试；首次审计 `ready=9 blocked=5 broken=0`，5 条缺口均为 NO_DRIVER。

## learnings

### lesson: wiring-complete-is-not-e2e-ready

接线完整只回答「阶段有执行器」，不回答「这条流水线有驱动、有输入、有工具、能产出」。必须把「清单 + 就绪审计」做成单一真源，并对 `PIPELINE_DEFINITIONS` 自动反查；否则新增流水线只会让文档数字变大，不会让验证变强。

### lesson: blocked-vs-broken-must-be-separate

「缺 Key/缺输入/缺驱动」与「代码断链」必须使用不同状态和退出码：前者是环境，后者是缺陷。混在一起会导致开发机永远红，或发版前把环境缺失当代码通过。默认只对 BROKEN 失败，`--strict` 才把 BLOCKED 也判失败。
