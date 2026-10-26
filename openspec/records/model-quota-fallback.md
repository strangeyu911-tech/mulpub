---
record: model-quota-fallback
task: 模型额度用尽时的来源切换策略定案（BYOK 优先 + 官方任务级兜底）—— PRD、设计、决策记录
date: 2026-10-26
branch: model-quota-fallback
---

## 本次执行记录：模型额度用尽处理策略定案（model-quota-fallback，2026-10-26）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档变更（docs-only）**：10 个文件全部落在 `01-docs/**`、`openspec/**`、`.ccg/**`（脚本白名单内；含 2 个 pre-commit 自动生成的 CCG 判定记录）。隔离方式 = 独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-fallback`（D 盘，非 C）+ 裸分支 `model-quota-fallback`（无斜杠前缀），未直推 main。 |
| 第一性原因（QM-5 ①） | N/A | 本片不是 Bug 修复，是**产品策略定案**：两类模型来源（BYOK / 官方算力）的优先级与切换控制此前没有定义。 |
| 逃逸分析（QM-5 ②） | N/A | 同上。相关现状缺口已写入 PRD §1.2（无统一产品级错误状态、`statusCode` 混用、无任务级覆盖、无用户设置、官方供给未落地）。 |
| 修复 + 回归保护（QM-5 ④） | N/A | 本片不改运行时代码；回归保护设计见 PRD AC-01~AC-20 与 DESIGN §7（P1/P2 实施时落地）。 |
| 防止再次发生（QM-5 ⑤） | N/A | 本片产出决策记录 D-041 + PRD/设计单一真源，后续模型调用域必须复用统一决策服务，不得自建 quota 弹窗。 |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=true`**，`files=10`（8 A / 2 M）。 |
| 行尾 / 编码对账 | ✅ | 新增/修改的 5 个 LF 文件 CRLF=0、U+FFFD=0；`01-docs/decision-log.md` 为既有 CRLF 文件（487 行 CRLF，新增行沿用 CRLF）。`git diff --numstat origin/main...HEAD` 与 `git diff --ignore-cr-at-eol --numstat origin/main...HEAD` **两口径逐行相等**（10 个文件全部 +N/-0）。 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → **PASS**（扫描 13056 个 tracked 文件，无品牌残留；已豁免第三方签名服务域名）。 |
| 文档同步检查 | ✅ | `bash scripts/check-docs-sync.sh --base=main --head=HEAD` → **通过**。⚠️ 本地 `main` 滞后于 `origin/main`，脚本走了 direct-diff fallback，输出里包含上游已合并文件；本 PR 自身变更集以 `git diff --name-only origin/main...HEAD` 为准（仅 10 个文档/流程文件）。 |
| 接线棘轮 | N/A | 本片不新增 `*.test.js`，无测试接线变更。 |
| QM-1 打包 / QM-2 代码必检项 / QM-4 视觉 / TDD | N/A | 本 PR **未改任何运行时代码**，docs-only 快通道全部豁免。 |
| QM-6 CCG 双模型外部评审 | N/A | docs-only 快通道豁免；本机无 `codeagent-wrapper` 等外部评审通道，未执行，不以自审冒充通过。 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 随 CI | 远程同步 由门禁推导 | CHANGELOG 收口 由记录承载

### 遗留（不假装已闭合）

- **官方算力代理 D-① 未落地**：`POST /api/v1/compute/execute`、余额读通道 U-13、视频/图像/TTS/ASR 价格卡 U-12 均未闭环 ⇒ 本 PRD 的「使用官方模型」路径当前**不可执行**；PRD D-11 明确「官方供给未落地前不单独上线设置项与按钮」。
- **P1/P2/P3 代码未实现**：本 PR 只交付 PRD / 设计 / 决策记录；`openspec/changes/model-quota-fallback/tasks.md` 的 P1/P2/P3 任务全部未勾选。
- **LLM 官方供给未决（U-1）**：官方算力当前设计只覆盖视频/图像/TTS/ASR；文字推理模型能否官方兜底需产品/运营拍板。
- **默认积分上限 500 未按真实价格卡校准（U-5）**：P2 接价格卡后需重新测算。

## CHANGELOG 条目

# docs(model): 定案模型额度用尽时的来源切换策略 —— BYOK 优先，官方只做任务级兜底

- 明确两类模型来源的优先级：用户自带 Key（BYOK）永远先走；官方模型只在额度/凭据失败时兜底，且默认每次询问。
- 新增三档设置 `modelQuotaFallbackPolicy`（`ask` / `official` / `byok`）与任务级积分上限 `officialCreditCapPerTask`（默认 500）；`official` 档也不会把官方模型变成全局默认。
- 定义统一错误状态机（`quota_exhausted` / `credential_invalid` / `rate_limited` / `transient` / `content_policy` / `provider_error` / `unknown`）：只有额度与凭据失败可兜底，`credential_invalid` 永远询问，限流/网络/内容安全/未知错误绝不兜底。
- 明确任务级覆盖不写 `model_providers`、新任务回到 BYOK、断点续跑保留本任务来源；切换前落检查点、官方调用 `byok=0` + 幂等键。
- 明确上线 gate：官方算力 D-① 未落地前不单独上线设置项与「使用官方模型」按钮，避免空承诺。
- 本 PR 仅文档，不含运行时代码；完整验收 AC-01~AC-20 见 `01-docs/PRD-MODEL-QUOTA-FALLBACK-2026-10-26.md`。

## learnings

### lesson: provider-error-normalization-is-not-user-decision

**现场**：仓库已有 `provider-error.js` 的 `classifyProviderFailure`（quota/rate/transient），也有 `ProviderRunContext.openIfQuota`，但用户仍然只看到「请检查模型设置」——错误被归一了，却没有变成「充值 / 换 Key / 用官方模型继续」的可执行动作。另一个现场：`ProviderError.context.statusCode` 在 MiniMax 适配器里装的是业务码 1004/2056，不是 HTTP 状态，直接展示会把排障引向错误方向。

**根因**：错误归一化的消费方是**重试/熔断**，不是**用户决策**；两者需要的字段不同（前者要 retryable，后者要 quotaKind/凭据状态/可兜底资格/预估成本）。把同一份枚举直接拿去驱动 UI，必然缺字段，最后各业务域各自补文案。

**可复用的 3 条**：

1. 任何「供应商错误 → 用户动作」的链路，必须单独定义**产品级状态**，不要复用重试分类枚举；两组枚举要有测试锁住交集（quota 必须一致），但不能互相冒充。
2. 供应商业务码与 HTTP 状态必须分字段存（`providerCode` / `httpStatus`），`statusCode` 只能作兼容字段；否则展示与排障都会错位。
3. 兜底决策必须「未知保守」：识别不了就不给官方按钮，宁可少兜一次，也不要把限流/网络误判成额度诱导用户充值。
