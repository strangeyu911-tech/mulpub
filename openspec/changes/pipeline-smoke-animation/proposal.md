# 变更提案：pipeline-smoke-animation

## 为什么

`animation` 真实执行两次失败，根因不是视频模型，而是**默认 LLM 的推理预算**：

- 默认 LLM 为 `deepseek-v4-flash`（推理型）；
- `callDefaultLlm` 给推理型模型 `REASONING_LLM_MAX_TOKENS = 5000`；
- 实测 `aiGenerate` 同模型 `max_tokens=4000` 时返回 `content=""`、`finish_reason="length"`、`reasoning_tokens=4000`（全部预算被思考占用，没有正文）；
- `storyboard` 收到空字符串 → `parseJsonArray` 返回 null → 三次重试都空 → `STORYBOARD_EMPTY_SCENES`「storyboard 无法解析场景 JSON」。

另外 CDP 冒烟驱动默认 20min，而清单 `animation.timeoutSec=1800`（30min），两层超时不一致，第一次动画在 20min 被取消。

## 变更内容

1. `apps/desktop/electron/services/videogen-stages.js`
   - 新增 `MAX_LLM_BUDGET_TOKENS = 16000`；
   - `callDefaultLlm` 在 `content` 为空且 `finish_reason=length` 或 reasoning_tokens ≥ 90% 预算时，自动把预算翻倍重试：5000 → 10000 → 16000；
   - 到 16000 仍为空则抛 `默认 LLM 返回空内容（推理预算耗尽，已到上限 16000 tokens）`，不无限重试；
   - 显式 `maxTokens` 同样适用升级链（4000 → 8000 → 16000）。
2. `apps/desktop/tests/e2e/pipeline-smoke-cdp.js`
   - `DEFAULT_TIMEOUT_MS` 20min → 30min，与清单 `timeoutSec=1800` 对齐。
3. `videogen-stages.test.js` +2 例：空 content + length 时升级预算重试；到上限仍空时明确报错且只调用 3 次。
4. PRD 增补增量 5 契约与实测。

## 不做什么

- 不改变默认 LLM 选择逻辑；仍由用户在模型设置中选择。
- 不自动降低 reasoning 模型的 temperature/思考强度（各 adapter 差异大）。
- 不在本 PR 把 animation/hybrid 挂驱动：需要重启应用加载新代码后真实重跑，才允许改 manifest。

## 验收

- 单测：`videogen-stages.test.js` 42 例全绿；CDP/audit/execute 组合 49 例全绿。
- 直接调用证据：`deepseek-v4-flash` + 4000 tokens → 空 content / length / 4000 reasoning；`tianyiyun deepseek-v4-flash-0731-oc` + 16000 tokens → 合法 12 场景 JSON（1480 completion tokens）。
- 代码路径：空 content + length 时第二次调用 max_tokens 从 5000 升到 10000，第三次升到 16000。
- animation/hybrid 仍为 `NO_DRIVER`，直到重启应用后真实 PASS。
