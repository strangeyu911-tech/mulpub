# 变更提案：pipeline-smoke-storyboard

## 为什么

`animation` / `hybrid` 在 storyboard 阶段反复失败，调试发现是**多层问题叠加**，不是单一 LLM 预算：

1. **creative 分镜仍用 1600 默认预算**：12 场景长 prompt JSON 被截断，`parseJsonArray` 返回 null。
2. **`concept.visual` 被丢弃**：`buildStoryboardPrompt` 只读 `visual_style`，而 concept 阶段实际输出 `{name, visual}`，导致 prompt 只剩「动态视觉」。
3. **`topic` 被丢弃**：`resolveVideogenConcept` 只返回 `value.concept` 对象，外层 `context.concept.topic`（原始文案）没进入 storyboard prompt，模型无法覆盖「机器人/城市/行走」。
4. **creative 模式仍执行严格对齐门禁**：短创意自由拓展被要求逐字覆盖实体，必然失败。
5. **模型偶尔返回 `[]` / 非 JSON**：creative 没有降级路径，整条流水线失败。

另外 `animation` 首次 20min 超时是 CDP 默认超时与清单 30min 不一致。

## 变更内容

1. `videogen-stages.js`
   - storyboard 统一 `storyboardMaxTokens = 8000`（creative 不再用 1600）；
   - `buildStoryboardPrompt` 从 `concept.visual` / `role_design` / `topic` 提取视觉与主题；
   - `resolveVideogenConcept` 把外层 `topic` 合并进 concept 对象；
   - creative 模式 `alignmentConfig.enabled = false`（自由拓展不强制逐字覆盖）；
   - creative 模式 LLM 返回空/非法时，用原文拆分生成兜底场景（最多 4 个），`report.fallback=true`，fidelity/hybrid 仍 fail closed。
2. `apps/desktop/tests/e2e/pipeline-smoke-cdp.js`：默认超时 20min → 30min（与清单 `timeoutSec=1800` 对齐）。
3. `manifest.js`：animation / hybrid driver → `tests/e2e/pipeline-smoke-cdp.js`（已真实验证）。
4. `videogen-stages.test.js`：+4 例（8000 预算、visual 提取、topic 注入、空数组兜底）；audit 测试 NO_DRIVER/退出码基线适配。
5. PRD 增量 5/6 + proposal/record。

## 验收

- `animation` 真实 PASS：`mvqw26rm_jdeu`，1434s，21.2s h264+aac。
- `hybrid` 真实 PASS：`mvqx5xae_7giv`，621s，5.2s h264+aac。
- 审计：`total=15 ready=14 blocked=0 broken=0 excluded=1`。
- `videogen-stages.test.js` 45 passed；audit 25 passed；doc-abs fail 0。
- animation/hybrid 的 driver 只在真实 PASS 后才挂入 manifest。
