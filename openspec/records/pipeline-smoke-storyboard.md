---
record: pipeline-smoke-storyboard
task: 流水线 E2E 冒烟增量 6——修复 creative storyboard 预算/概念/主题/对齐/兜底，animation 与 hybrid 真实 PASS，审计 14/0
date: 2026-10-28
---

## 本次执行记录：creative storyboard 多层修复（pipeline-smoke-storyboard，2026-10-28）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码 + 测试 + 文档 ⇒ 隔离 worktree（D 盘非 C，`git rev-parse --show-toplevel` 实证）、裸分支 `pipeline-smoke-storyboard` |
| 第一性原因（QM-5 ①） | ✅ | 五层叠加：①creative 仍用 1600 token，12 场景 JSON 截断；②`buildStoryboardPrompt` 只读 `visual_style`，concept 实际是 `{name, visual}`；③`resolveVideogenConcept` 丢掉外层 `topic`；④creative 仍执行严格实体覆盖；⑤模型偶发返回 `[]`/非 JSON 无兜底。另有 CDP 20min 与清单 30min 不一致。 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：只断言推理型 5000，未覆盖 creative 1600 截断；②**提示词层**：`visual_style` 缺失时静默回退「动态视觉」；③**概念层**：`topic` 未合并；④**门禁层**：creative 与 fidelity 共用同一对齐开关；⑤**降级层**：空数组直接 fail closed。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | storyboard 8000；visual/topic 注入；creative 关闭对齐；空数组用原文兜底（≤4 场景）；CDP 30min；+4 单测（46 passed）；animation/hybrid 真实 PASS 后才挂 driver。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`storyboard 从 concept.visual 提取` 测试；②`topic 注入` 测试；③`空数组兜底` 测试；④audit 真实清单无 NO_DRIVER 断言；⑤PRD 记录五层根因与真实 runId。 |
| 行尾与 diff 对账 | ✅ | 见「验收证据」 |
| 接线棘轮 | ✅ | 新增测试位于既有 `videogen-stages.test.js` 与 `pipeline-smoke-audit.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未改 renderer/样式/模板 |
| QM-6 CCG 双模型外部评审 | ✅ | `self_play_resolved` / `tier=external`；6 条争议全部 dismissed；证据 PR #4574 issuecomment-6449980831 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件

### 一、改动清单

- `apps/desktop/electron/services/videogen-stages.js`
  - `storyboardMaxTokens = 8000`（creative/fidelity/hybrid 统一）；
  - `buildStoryboardPrompt`：`visual_style || visual || role_design`；`topic` 拼入 user；
  - `resolveVideogenConcept`：对象分支合并外层 `topic`；
  - `alignmentConfig.enabled = mode !== 'creative'`；
  - creative 空/非法输出 → 原文兜底场景（≤4，`report.fallback=true`）。
- `apps/desktop/tests/e2e/pipeline-smoke-cdp.js`：默认超时 30min。
- `apps/desktop/scripts/pipeline-smoke/manifest.js`：animation/hybrid → CDP driver（已验证）。
- `apps/desktop/electron/tests/pipeline-smoke-audit.test.js`：真实清单无 NO_DRIVER 断言；退出码测试用最小 report。
- `apps/desktop/electron/services/videogen-stages.test.js`：+4 例（46 passed）。
- `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md`：增量 5/6。
- `openspec/changes/pipeline-smoke-storyboard/proposal.md`（新增）

### 二、验收证据

- `pnpm exec vitest run electron/services/videogen-stages.test.js` → **46 passed**
- `pnpm exec vitest run electron/tests/pipeline-smoke-audit.test.js` → **25 passed**
- `animation`：`STATUS=PASS`，`RUN_ID=mvqw26rm_jdeu`，`DURATION_MS=1434547`，`PROBE={"duration":21.198656,"codecs":["h264","aac"]}`
- `hybrid`：`STATUS=PASS`，`RUN_ID=mvqx5xae_7giv`，`DURATION_MS=620969`，`PROBE={"duration":5.197673,"codecs":["h264","aac"]}`
- 审计（`shared-user-data` provider DB）：
  - `PROVIDERS usable=9 caps=image,llm,multimodal,video,tts`
  - `SUMMARY total=15 ready=14 blocked=0 broken=0 excluded=1`
- `node --test scripts/check-doc-abs-paths.test.js` → fail 0
- `node .github/scripts/check-max-lines.js` → ✅ 无新增超大文件
- eslint → 0 errors（3 条既有 warning）

### 三、边界

- creative 兜底场景只保证「有场景可生成」，不保证 LLM 级分镜质量；fidelity/hybrid 仍 fail closed。
- 仍依赖真实 provider；CI 不自动跑 CDP 冒烟。
- 8 条 READY 共享驱动流水线本次未全部重跑；`READY` 仍只代表静态条件满足。
- animation 真实耗时 23.9min，hybrid 10.3min，均在 30min 预算内；高成本任务应单独排期。

### 四、后续增量

1. 逐条重跑 8 条 READY 共享驱动流水线，把 READY 变真实 PASS。
2. 把 `audit --with-providers --strict` 接入发布 checklist。
3. 将本轮经验沉淀为 `video-pipeline-e2e-smoke` skill。

## CHANGELOG 条目

# creative storyboard 多层修复（pipeline-smoke-storyboard）

修复 creative 分镜的 1600 token 截断、`concept.visual`/`topic` 丢失、严格对齐误杀、空输出无兜底；animation 与 hybrid 真实 PASS，审计达到 `ready=14 blocked=0`。

## learnings

### lesson: storyboard-pipeline-has-five-layers

「无法解析场景 JSON」可能同时是预算、提示词概念丢失、主题丢失、门禁过严、无兜底五层问题。只修一层会反复失败；必须逐层取证据（token 预算、prompt 内容、concept 结构、alignment 配置、空输出路径）。

### lesson: creative-mode-needs-fallback

creative 是「一句话自由拓展」，不应强制逐字覆盖实体；模型返回 `[]`/非 JSON 时，用原文兜底场景比整条流水线 fail closed 更符合「短创意也要能出片」的产品语义。fidelity/hybrid 则必须继续 fail closed。
