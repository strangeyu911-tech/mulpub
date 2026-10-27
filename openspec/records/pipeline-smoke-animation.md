---
record: pipeline-smoke-animation
task: 流水线 E2E 冒烟增量 5——修复推理型 LLM 预算耗尽导致 storyboard 空 JSON，CDP 超时对齐 30min
date: 2026-10-27
---

## 本次执行记录：animation storyboard 空 JSON 修复（pipeline-smoke-animation，2026-10-27）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码 `apps/desktop/electron/services/videogen-stages.js` + 测试 + 文档 ⇒ 隔离 worktree（D 盘非 C，`git rev-parse --show-toplevel` 实证）、裸分支 `pipeline-smoke-animation` |
| 第一性原因（QM-5 ①） | ✅ | 默认 LLM `deepseek-v4-flash` 是推理型；`callDefaultLlm` 只给 5000 tokens，实测 4000 tokens 全部被 `reasoning_tokens` 占用、`content` 为空、`finish_reason=length`；storyboard 解析空字符串失败。不是视频 provider、不是 JSON parser、不是网络。 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：只断言 reasoning 模型 max_tokens=5000，没有覆盖「5000 仍不够」；②**E2E 层**：animation 首次成功（10:13）掩盖了非确定性，第二次失败才暴露；③**超时层**：CDP 默认 20min 与清单 30min 不一致，首次失败被误读为纯超时；④**日志层**：错误只显示「无法解析场景 JSON」，没有记录空 content/usage。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `callDefaultLlm` 空 content + length/90% reasoning 时 5000→10000→16000 自动升级；到上限明确报错；`MAX_LLM_BUDGET_TOKENS` 导出；+2 单测。CDP 默认超时 30min。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①错误信息携带「推理预算耗尽，已到上限」；②单测锁定第二次调用 max_tokens=10000、第三次=16000、最多 3 次；③PRD 写明根因与两层超时；④animation/hybrid 仍 `NO_DRIVER`，重启应用真实 PASS 前不改清单。 |
| 行尾与 diff 对账 | ✅ | 见「验收证据」 |
| 接线棘轮 | ✅ | 新增测试位于既有 `videogen-stages.test.js`，命中既有 include |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未改 renderer/样式/模板；QM-1 需在最终打包前由 CI/发版流程覆盖 |
| QM-6 CCG 双模型外部评审 | ✅ | claude（critic）+ opencode（proposer）双模型审查；4 条争议全部 `dismissed`（逐条见 `.adversarial/ccg-deep-3cfc720c/adjudication.json`），`deepReview.status=self_play_resolved`、`performedBy=self-play`；无阻断项 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件

### 一、改动清单

- `apps/desktop/electron/services/videogen-stages.js`
  - `MAX_LLM_BUDGET_TOKENS = 16000`；
  - `callDefaultLlm(..., budgetAttempt=0)`：`baseMaxTokens`（显式优先 / 推理型 5000 / 普通 1600）；空 content 且 `finish_reason=length` 或 reasoning_tokens ≥ 90% 时，`max_tokens` 翻倍重试（封顶 16000）；
  - 到上限仍空：抛 `默认 LLM 返回空内容（推理预算耗尽，已到上限 16000 tokens）`。
- `apps/desktop/tests/e2e/pipeline-smoke-cdp.js`：默认超时 20min → 30min。
- `apps/desktop/electron/services/videogen-stages.test.js`：+2 例。
- `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md`：增量 5。
- `openspec/changes/pipeline-smoke-animation/proposal.md`（新增）

### 二、验收证据

- `pnpm exec vitest run electron/services/videogen-stages.test.js` → **42 passed**
- `pnpm exec vitest run electron/services/videogen-stages.test.js electron/tests/pipeline-smoke-cdp.test.js` → **49 passed**
- 直接 LLM 证据：
  - `sensenova-llm / deepseek-v4-flash` + `max_tokens=4000` → `content=""`、`finish_reason=length`、`reasoning_tokens=4000`
  - `tianyiyun-coding-plan / deepseek-v4-flash-0731-oc` + `max_tokens=16000` → 合法 12 场景 JSON，`completion_tokens=1480`
- `node --check videogen-stages.js` → 通过
- eslint → 0 errors（3 条既有 no-unused-vars warning）
- animation/hybrid 仍 `NO_DRIVER`：需重启应用加载本修复后真实重跑，才允许改 manifest。

### 三、边界

- 预算升级只对「空 content 且 finish_reason=length / reasoning 占满」生效，不会把所有调用都放大到 16000。
- 仍然尊重显式 `maxTokens`：显式 4000 也按 4000→8000→16000 升级；若调用方要严格固定预算，需要后续增加 `allowBudgetEscalation:false`（当前未提供）。
- 未验证其他推理模型（MiniMax-M2.7/M3、kimi）在 16000 下的表现；逻辑通用，但真实 provider 仍需逐个冒烟。
- animation 真实重跑需要重启当前应用（当前进程加载的是旧代码），本 PR 不自动重启用户应用。

### 四、后续增量

1. 重启应用加载本修复，真实重跑 animation；PASS 后再把 driver 挂到 manifest。
2. hybrid 视频队列等待超时单独排查（增加队列等待预算/降低单次提交量）。
3. 为 reasoning 预算升级增加 telemetry（记录升级次数/最终预算），便于评估成本。

## CHANGELOG 条目

# animation storyboard 空 JSON 修复（pipeline-smoke-animation）

修复推理型默认 LLM 把 5000 token 预算全部用于 reasoning、导致 storyboard 收到空 content 的问题：`callDefaultLlm` 现在按 5000→10000→16000 自动升级预算，到上限仍空才明确报错；CDP 冒烟超时对齐清单 30min。

## learnings

### lesson: reasoning-tokens-can-starve-content

推理型 LLM 的 `max_tokens` 同时包含 reasoning tokens 与正文。预算不足时 `content` 可能为空而 `finish_reason=length`，上游只看到「JSON 解析失败」。必须把 `usage.completion_tokens_details.reasoning_tokens` 纳入判断，并在空 content + length 时自动升级预算；否则会把模型预算问题误诊为 JSON 格式问题。

### lesson: two-timeouts-must-align

清单 `timeoutSec=1800` 与 CDP 驱动默认 20min 是两层超时；不一致会让「预算/性能不足」被误读成「流水线超时」。驱动默认值必须与清单预算对齐，或在报告里同时打印两层超时。
