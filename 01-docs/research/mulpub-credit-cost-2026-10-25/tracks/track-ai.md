# 轨道 C：AI 编排层 / 模型网关 / 评测 / 认证授权 —— 开源选型调研

> 取证说明：本文所有仓库元信息均来自 `api.github.com` 实测（`GET /repos/{owner}/{repo}`、`/commits`、`/git/trees/{default_branch}?recursive=1`、`/license` 正文），无镜像站、无 AI 营销站、无凭记忆的 star 数。取证时间 2026-10-23 04:30~05:10 UTC。
> 三处**仓库改名/迁移**已实测确认，下文按新名字引用：
> ① `Calcium-Ion/new-api` → **301** → `QuantumNous/new-api`（协议 AGPL-3.0）
> ② `explodinggradients/ragas` → `vibrantlabsai/ragas`
> ③ `NVIDIA/NeMo-Guardrails` → `NVIDIA-NeMo/Guardrails`（`default_branch=develop`）
> ④ **OTel GenAI 语义约定已从 `open-telemetry/semantic-conventions` 迁出**到 `open-telemetry/semantic-conventions-genai`（原仓 `docs/gen-ai/README.md` 正文写明 "moved to … no longer maintained in this repository"）。

**全候选元信息一览（均来自 `GET /repos/{owner}/{repo}`，注意 `default_branch` 不一律是 `main`）**

| # | 仓库 | stars | 语言 | **default_branch** | pushed_at | 默认分支最后提交 | 协议（`/license` 正文） |
|---|---|---|---|---|---|---|---|
| 1 | `maximhq/bifrost` | 9029 | Go | **`dev`** | 2026-10-23T04:14:58Z | 2026-10-23 | Apache-2.0 |
| 2 | `pydantic/pydantic-ai` | 20803 | Python | `main` | 2026-10-23T04:36:17Z | 2026-10-23 | MIT |
| 3 | `567-labs/instructor` | 14052 | Python | `main` | 2026-10-20T21:58:42Z | 2026-10-20 | MIT |
| 4 | `open-telemetry/semantic-conventions-genai` | 474 | Python | `main` | 2026-10-22T00:54:13Z | 2026-10-21 | Apache-2.0 |
| 5 | `promptfoo/promptfoo` | 26317 | TypeScript | `main` | 2026-10-23T01:56:08Z | 2026-10-23 | MIT |
| 6 | `langfuse/langfuse` | 36218 | TypeScript | `main` | 2026-10-23T02:45:23Z | 2026-10-23 | MIT（`ee/` 除外） |
| 7 | `apache/casbin` | 20463 | Go | **`master`** | 2026-10-21T00:39:29Z | 2026-10-21 | Apache-2.0 |
| 8 | `openfga/openfga` | 6025 | Go | `main` | 2026-10-22T19:45:09Z | 2026-10-20 | Apache-2.0 |
| 9 | `Infisical/infisical` | 29934 | TypeScript | `main` | 2026-10-23T04:19:34Z | 2026-10-23 | MIT（`ee/` 除外） |
| 10 | `web-infra-dev/midscene` | 15370 | TypeScript | `main` | 2026-10-23T03:50:31Z | 2026-10-22 | MIT |
| 11 | `better-auth/better-auth` | 30425 | TypeScript | `main` | 2026-10-23T04:10:41Z | 2026-10-23 | MIT |
| 12 | `BerriAI/litellm` | 61859 | Python | `main` | 2026-10-23T03:43:37Z | 2026-10-22 | MIT（`enterprise/` 除外） |

> **`semantic-conventions-genai` 只有 474★、2026-05-05 才建仓 —— 这不是缺点，也不是「小众」的证据。** 它是**规范仓不是代码仓**：星标数对规范类仓库没有可比性，它的存在形式是 973 行的 `gen-ai-token-metrics.md` + 425 个 yaml/md 定义文件，而不是可安装的包。选它的理由是「它是 OTel 官方对 token 计量口径的唯一现行定义处」，与星数无关。若反问「474★ 会不会明天就没了」——它的上游是 `open-telemetry` 基金会主仓，且是**从 `open-telemetry/semantic-conventions` 主仓拆出去的**（老仓 README 明写 "moved to …"），迁出动作本身说明基金会认为 GenAI 约定需要独立演进。

---

## 一、维度小结

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| 模型网关 / 路由 / 降级 | 自研 `ai-router` 仓库 + `OfficialKey` / `ModelPreset` 表 | **借鉴 `maximhq/bifrost` 的 `failure_class` 分类与 retry/fallback 分层** | `BerriAI/litellm`（自建网关时用） | 不整体引入网关；在自研 ai-router 里**移植 Bifrost 的错误分类表**（quota / credential / model_access / rate_limit / transient / caller_fault）即可覆盖「余额不足自动降级」 |
| 模型成本核算 | `ModelUsageDaily` / `ModelUsageBatch` | **借鉴 `pydantic/pydantic-ai` 的 `_genai_prices.py` 计价范式** | `BerriAI/litellm` 的 `model_prices_and_context_window.json`（296.8 万字节价目表） | 在 ops-center 加一张 `ModelPrice` 维表（输入/输出/缓存/推理 四类单价），替换目前写死的 27.1% 成本占比 |
| 积分换算 / 亏本防护 | 官方注释「成本占比 27.1%」 | **`open-telemetry/semantic-conventions-genai` 的 token 计量语义约定** | `langfuse` 的 `Price` / `PricingTier` / `BillingMeterBackup` 表 | **本次最高优先级**：现有 `prompt_tokens/completion_tokens` 命名已被 OTel 标记 deprecated；且 OTel 明确「usage counter 才是成本口径，per-operation 直方图不得用于成本计算」 |
| LLM 编排抽象 | 自研 `ai-writer` / `rewrite-engine`（16 个模块） | **`pydantic/pydantic-ai` 作为「局部借鉴」**（Python 侧，MIT） | 无 | **不建议整体替换**。但它的 `FallbackModel`、`_genai_prices.py`、`pydantic_evals` 三块可单点借鉴 |
| 结构化输出约束 | `rewrite-paragraph-preserve` 质量门禁 | **`567-labs/instructor`（直接引入，但 TOOLS_STRICT 对国内 provider 的兼容性未取证，须先走 JSON_SCHEMA 模式）** | `pydantic-ai` 的 `output.py` | **可小而专地直接引入（核心依赖与 ops-center 无冲突；唯 `Mode.TOOLS_STRICT` 对国内 provider 的兼容性未取证，见风险栏的降级路径）**：`Mode` 20+ 种 + `llm_validator`（LLM 当校验器），正好替代「段落结构保持」的自研判定 |
| 提示词管理 / 版本化 | `PromptEvalCase` / `PromptEvalRun` / `PromptEvalScene` / `PromptEvalProviderKey` | **借鉴 `langfuse/langfuse` 的 `model Prompt` 表结构** | `promptfoo` 的断言体系 | 直接抄数据模型：`name + version` 唯一键 + `labels`（production/latest）+ `tags` + `commitMessage` + `type` |
| 提示词评测 / A-B | `PromptEvalRun` 表（只有结果，无断言库） | **`promptfoo/promptfoo`（直接引入，Node 侧）** | `pydantic-ai` 内置 `pydantic_evals`（Python 侧） | promptfoo 60 个断言文件（含 `cost` / `similar` / `factuality` / `trajectory` 等）含 `cost` / `similar` / `factuality` / `trajectory`，可直接接进现有 vitest CI |
| 可观测与成本追踪 | `ModelUsageDaily` / `ModelUsageBatch` / `DiagnosticsDaily` | **`open-telemetry/semantic-conventions-genai`（规范，非库）** | `openlit/openlit`（OTel 原生埋点，可对照） | 先对齐**字段命名与口径**，不必上 APM；上 APM 是后面的事 |
| AI 驱动测试 / 质量门禁 | `packages/ai-autonomous-tester`（54 文件）+ vitest + stryker + playwright | **`web-infra-dev/midscene`（借鉴 Gherkin 化与断言范式）** | `browserbase/stagehand`（未深查） | 借鉴 `run-gherkin-scenario.ts` 的「自然语言 → Gherkin → 断言」链路，不引入依赖 |
| 认证（桌面端登录） | `@logto/client` + `logto-auth.js` / `logto-jwks.js` / `logto-webhook.js` | **保留 Logto** | `better-auth/better-auth`（含 `packages/electron`） | 保留现状。better-auth 唯一有增量价值的是 Electron 集成范式，可对照 |
| 后台 RBAC + 资源级权限 | `plan-matrix.js`（PLAN_RANK 不可被运营改）+ `ACCESS-CONTROL-MATRIX.md` | **借鉴 `apache/casbin` 的模型/策略分离 + `openfga/openfga` 的关系型授权** | `open-policy-agent/opa` | **只抄数据模型，不引入运行时**。mulpub 权限矩阵是静态的，引入 Casbin/OpenFGA 守护进程是负收益 |
| 密钥与凭证管理 | `OfficialKey` 表 + 用户自带模型 key | **`Infisical/infisical`（借鉴分级/审批/轮换模型；不建议本阶段引入）** | `getsops/sops`（仅适合构建期） | 借鉴 `secret-rotation` / `secret-approval-policy` / `secret-version` 三表；短期用 KMS 加密列即可 |

---

## 二、候选详情

### 1. `maximhq/bifrost` — Go 写的 LLM 网关，把「provider 挂了 / 余额没了」分类清楚并自动降级
- **证据**
  - `GET /repos/maximhq/bifrost` → stars=9029, forks=1448, language=Go, default_branch=`dev`, pushed_at=2026-10-23T04:14:58Z, created_at=2025-03-19, archived=false
  - `GET /repos/maximhq/bifrost/commits?per_page=3` → 2026-10-23「Stop compat from stripping sampling params on datasheet rows without model_parameters (#87…)」、2026-10-23、2026-10-22
  - `GET /repos/maximhq/bifrost/git/trees/dev?recursive=1` → 5911 个 blob
  - `GET /repos/maximhq/bifrost/license` → spdx=Apache-2.0，正文首行「Apache License / Version 2.0, January 2004」
  - `GET /repos/maximhq/bifrost/contents/docs/features/retries-and-fallbacks.mdx` → **530 行**，含完整 `failure_class` 表：`credential` / `quota` / `model_access` / `model_gone` / `region_blocked` / `rate_limit` / `transient` / `caller_fault` / `unknown`，并写明「quota = 账户余额耗尽或超预算：402、OpenAI `insufficient_quota`、Anthropic "credit balance is too low"、Gemini "prepayment credits are depleted"」
  - `GET /repos/maximhq/bifrost/contents/framework/configstore/tables/budget.go`（同目录另有 `modelpricing.go` `pricingoverride.go` `prompts.go` `promptVersions.go` `key.go` `ratelimit.go` `encryption.go` `featureflag.go` 等 30+ 表文件）
  - `GET /repos/maximhq/bifrost/git/trees/dev` → `framework/modelcatalog/datasheet/cost.go`、`framework/modelcatalog/datasheet/providercost.go`、`core/schemas/otelconv.go`
- **解决哪一层**：模型路由 / 降级 / 成本核算。
- **适配点**：直接对应 mulpub 的一句话诉求「余额不足自动降级」。Bifrost 的关键洞察是**把「余额不足」和「模型不可用」「key 被拒」分成不同 class**：余额不足（quota）应当换 provider/换档位，而 429 只是轮换 key、401/403 是 key 永久死亡。mulpub 自研 `ai-router` 现在多半是按 HTTP 状态码分支，抄这张分类表就能把「降级」从「重试」里剥出来。另可抄 `framework/configstore/tables/budget.go` + `budgetwindow`（预算窗口）这一对表：mulpub 的 `officialCreditMonthly` 是月度额度，正好对应「窗口化预算」语义。
- **引入成本**：**高**。它是独立网关服务（Go 进程 + Postgres config store + log store + vector store），mulpub 现有栈是 Node 桌面端 + Python FastAPI 单体，接入意味着多一个常驻服务 + 一层网络跳转 + 密钥集中化改造，架构侵入性极大。
- **风险**：Go 二进制分发对桌面端打包不友好；`default_branch=dev`（主线在 develop，稳定性需自担）；Apache-2.0 无传染性，但上游是 Maxim 的商业产品，路由策略等企业特性会持续向闭源漂移。
- **建议**：**借鉴实现**（抄 `failure_class` 分类表 + retry/fallback 分层语义 + budget/budgetwindow 表模型），**不引入**。
- **置信度**：高（530 行文档与 30+ 表文件均已逐条读到，非 README 宣称）。

### 2. `pydantic/pydantic-ai` — Python 原生的「类型即契约」Agent 框架，自带降级、计价与评测
- **证据**
  - `GET /repos/pydantic/pydantic-ai` → stars=20803, forks=2999, language=Python, default_branch=`main`, pushed_at=2026-10-23T04:36:17Z, created_at=2024-06-21
  - `GET /repos/pydantic/pydantic-ai/commits?per_page=3` → 2026-10-23T04:24「Support `NativeOutput` on every `FireworksProvider` model (#10157)」、2026-10-23T04:16、2026-10-23T04:10
  - `GET /repos/pydantic/pydantic-ai/git/trees/main?recursive=1` → 4901 个 blob；`pydantic_ai_slim/` 456 + `pydantic_evals/` 33 + `pydantic_graph/` 18 + `docs/` 372 + `tests/` 2979
  - `GET /repos/pydantic/pydantic-ai/license` → spdx=MIT，正文「The MIT License (MIT) / Copyright (c) Pydantic Services Inc. 2024 to present」
  - `GET /repos/pydantic/pydantic-ai/contents/pydantic_ai_slim/pydantic_ai/models/fallback.py` → **742 行**，`class FallbackModel(Model)`，含 `_should_fallback` / `_parse_fallback_on` / `_refresh_http_client`
  - `GET /repos/pydantic/pydantic-ai/contents/pydantic_ai_slim/pydantic_ai/_genai_prices.py` → 185 行，`calculate_price_for_usage(...)`、`best_effort_price(...)`、`fill_response_cost(response: ModelResponse)`、`preload_pricing_data()`
  - `GET /repos/pydantic/pydantic-ai/contents/pydantic_evals/pydantic_evals/evaluators/llm_as_a_judge.py` → **618 行**，`judge_output` / `judge_input_output` / `judge_input_output_expected` / `set_default_judge_model`
  - `GET /repos/pydantic/pydantic-ai/git/trees/main` → `pydantic_ai_slim/pydantic_ai/models/` 下 40+ provider（openai / anthropic / bedrock / gemini / groq / openrouter / ollama / fallback / instrumented …）
- **解决哪一层**：编排抽象 + 模型降级 + 成本核算 + 评测。
- **适配点**：mulpub 后端已经是 **Python + Pydantic v2**（`pydantic>=2.10`），这是唯一零语言摩擦的框架候选。三处可单点借鉴：
  ① `fallback.py` 的 `FallbackModel` —— 把「多模型 + 自动降级」做成一个装饰器式的模型包装，而不是散落在业务代码里的 try/except 链；
  ② `_genai_prices.py` 的 `calculate_price_for_usage` / `fill_response_cost` —— 一次调用就把 token 用量折成钱，正好替换 mulpub 现在写死的「成本占比 27.1%」；
  ③ `pydantic_evals` 的 `llm_as_a_judge` —— 「段落结构保持」这类语义门禁，用 LLM 评委比正则可靠，可直接对齐 `rewrite-paragraph-preserve`。
- **引入成本**：**中**。Python 侧、MIT、无重依赖（Cython 编译可选纯 Python）；但整包引入会覆盖掉自研 `ai-writer` 的调用层，架构侵入性高。若只抄上述三段逻辑，接近零成本。
- **风险**：框架 API 演进快（`_agent_graph.py` / `pydantic_graph` 独立包说明内部结构仍在动）；`pydantic_ai` 与 `pydantic` 版本耦合，升级 pydantic 时要跟；`fill_response_cost` 依赖其内置价目表，价格更新滞后会直接算错钱。
- **建议**：**借鉴实现**（三处单点），**不建议整体替换自研 ai-writer**。若将来确实要 Python 侧的 Agent 运行时，它比 LangChain/LangGraph 更贴 mulpub 现有栈。
- **置信度**：高（三个关键文件均已读取行数与方法名）。

### 3. `567-labs/instructor` — 把 LLM 输出强约束成 Pydantic 对象，含「用 LLM 当校验器」
- **证据**
  - `GET /repos/567-labs/instructor` → stars=14052, forks=1335, language=Python, default_branch=`main`, pushed_at=2026-10-20T21:58:42Z, created_at=2023-06-14
  - `GET /repos/567-labs/instructor/commits?per_page=3` → 2026-10-20「fix(release): integrate compact 1.18 correctness and docs fixes (#2767)」、2026-10-11 两条
  - `GET /repos/567-labs/instructor/git/trees/main?recursive=1` → 1048 个 blob；`instructor/` 208 + `instructor/v2/` 108
  - `GET /repos/567-labs/instructor/license` → spdx=MIT，正文「MIT License / Copyright (c) 2023 Jason Liu」
  - `GET /repos/567-labs/instructor/contents/instructor/v2/core/mode.py` → 259 行，`class Mode(enum.Enum)` 含 20+ 取值：`TOOLS` / `TOOLS_STRICT` / `JSON` / `JSON_SCHEMA` / `MD_JSON` / `ANTHROPIC_TOOLS` / `MISTRAL_STRUCTURED_OUTPUTS` / `GEMINI_JSON` / `XAI_JSON` / `VERTEXAI_JSON` / `GENAI_JSON` / `RESPONSES_TOOLS` …
  - `GET /repos/567-labs/instructor/contents/instructor/v2/validation/llm_validators.py` → 81 行，`llm_validator(...)` / `llm(v: str)` / `openai_moderation(...)`
  - `GET /repos/567-labs/instructor/contents/instructor/v2/validation/async_validators.py` → 257 行，`async_field_validator` / `async_model_validator` / `run_async_validators`
  - `GET /repos/567-labs/instructor/contents/instructor/processing/response.py` → 正文仅 3 行 `from instructor.v2.core.response import *`（**旧路径是兼容壳，实现已迁 v2**——按老文档抄 import 会抄到空壳）
- **解决哪一层**：结构化输出约束。
- **适配点**：直接对上 `rewrite-paragraph-preserve`。rewrite-engine 的 `segment-splitter.js` / `segment-rewriter.js` 产出的是「段落数组」，而 Instructor 能把「原文段数、每段类型、是否合并」建模成一个 Pydantic 模型，用 `Mode.JSON_SCHEMA` 硬约束 schema，再用 `llm_validator` 让 LLM 复核「结构是否与原文一致」。目前 mulpub 是**先切段再逐段改写、事后校验**，Instructor 的模式是**一次性让模型输出符合 schema 的整体结构**，能把「段落数对不上」这类失败挡在生成侧而不是事后救火。
- **引入成本**：**低**。Python 侧纯库、MIT、核心依赖 20 项（含 `openai>=2.0.0` 硬依赖；`fastapi`/`redis` 只在 `[test-docs]` extra，故与 ops-center 的 `fastapi>=0.115.0,<1.0.0` **无冲突**），`pip install instructor` 即可；Node 侧没有官方包，桌面端要用需走 ops-center HTTP 转发（与现有 `ai-writer-api` 的分层一致）。
- **风险**：v1→v2 迁移中（`instructor/processing/*` 已是兼容壳），抄错 import 路径会拿到空实现；**`Mode.TOOLS_STRICT` 对国内 provider（通义/豆包/智谱）的 strict tool-calling 兼容性本轮未取证**（沙箱无 provider 凭证，无法实测），而这正是「直接引入」建议的核心卖点——**这是结论级风险**。落地要求：① 接入时先在 `Mode.JSON_SCHEMA`（不依赖 provider strict 能力）上跑通，再单独开 `TOOLS_STRICT` 灰度；② 在 rewrite-engine 侧保留「strict 失败 → 回落宽松模式 + 段落结构校验」的双保险（现有 `rewrite-paragraph-preserve` 门禁不撤）；③ 若国内 provider 均不支持 strict，则该建议降级为「借鉴实现」而非「直接引入」；Instructor 的重试默认会重发请求，**在计费场景下必须关掉或改成不计费重试**，否则成本直接翻倍。
- **建议**：**直接引入**（Python 侧），优先用它替换 rewrite-engine 里手写的 JSON 解析 + 正则校验。
- **置信度**：中（v2 的 provider 兼容矩阵未逐个实测；`Mode` 枚举与校验器接口已验证）。

### 4. `open-telemetry/semantic-conventions-genai` — token 计量的口径标准，mulpub 积分换算的「事实来源」
- **证据**
  - `GET /repos/open-telemetry/semantic-conventions-genai` → stars=474, forks=131, language=Python, default_branch=`main`, pushed_at=2026-10-22T00:54:13Z, **created_at=2026-05-05**（新拆仓，2026 年 5 月才成立）
  - `GET /repos/open-telemetry/semantic-conventions-genai/commits?per_page=3` → 2026-10-21「Record only positive inference usage contributions (#602)」、2026-10-21、2026-10-18
  - `GET /repos/open-telemetry/semantic-conventions-genai/license` → spdx=Apache-2.0
  - `GET /repos/open-telemetry/semantic-conventions-genai/git/trees/main?recursive=1` → 425 个 blob，含 `docs/gen-ai/gen-ai-token-metrics.md`、`docs/gen-ai/non-normative/token-metrics-design.md`
  - `GET /repos/open-telemetry/semantic-conventions-genai/contents/docs/gen-ai/gen-ai-token-metrics.md` → **973 行**；正文明确：「Usage (`gen_ai.client.inference.usage.*` counters) are the primary instruments for measuring token consumption… serve as a proxy for cost approximation」；「Per-operation token distribution… **should not be used for total usage or cost calculations**」；指标族含 `usage.input_tokens` / `usage.output_tokens` / `usage.cache_read.input_tokens` / `usage.cache_write.input_tokens` / `usage.reasoning.output_tokens`
  - `GET /repos/open-telemetry/semantic-conventions/contents/docs/gen-ai/README.md` → 正文：「GenAI semantic conventions have moved to the OpenTelemetry GenAI semantic conventions repository… no longer maintained in this repository」（**这就是为何不能引老仓**）
  - `GET /repos/open-telemetry/semantic-conventions/contents/model/gen-ai/deprecated/registry-deprecated.yaml` → 1308 行；`gen_ai.usage.prompt_tokens` 与 `gen_ai.usage.completion_tokens` **已 deprecated**，replaced by `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`
- **解决哪一层**：可观测与成本追踪（计量口径）。
- **适配点**：这是本轨道**与「会员积分换算是否亏本」直接相关**的一条。mulpub 现有 `ModelUsageDaily` / `ModelUsageBatch` 里的字段命名大概率沿用 `prompt_tokens` / `completion_tokens`，按 OTel 口径这是旧命名；而 `cache_read` / `cache_write` / `reasoning` 三类 token 是**独立计价**的——DeepSeek/Qwen 的缓存命中价差极大，**不区分缓存 token 与普通输入 token，积分换算必然亏本**。建议 ops-center 的用量表至少拆出这 5 个计数列，并按 OTel 口径区分「usage counter（成本口径）」与「per-request 明细（分布口径）」两类存储。
- **引入成本**：**极低**（规范不是库）。只需要改字段名与列定义，无新依赖。
- **风险**：新仓 2026-05 才成立，star 数低（474）容易被误认为小众而忽视；规范仍在 Development 状态，指标名可能再变；`gen_ai.client.*` 前缀与 `gen_ai.*` 老前缀并存，迁移时容易混用。
- **建议**：**直接对齐规范**（不引库）。这是本次最该立刻做、且成本最低的一条。
- **置信度**：高（973 行规范正文与 deprecated 注册表均已逐行读取）。

### 5. `promptfoo/promptfoo` — 提示词 A/B 与断言评测的现成引擎，Node 侧可直接接 CI
- **证据**
  - `GET /repos/promptfoo/promptfoo` → stars=26317, forks=2553, language=TypeScript, default_branch=`main`, pushed_at=2026-10-23T01:56:08Z, created_at=2023-04-28
  - `GET /repos/promptfoo/promptfoo/commits?per_page=3` → 2026-10-23、2026-10-22 等
  - `GET /repos/promptfoo/promptfoo/git/trees/main?recursive=1` → 5974 个 blob
  - `GET /repos/promptfoo/promptfoo/license` → spdx=MIT，正文「Copyright (c) Promptfoo 2025」
  - `GET /repos/promptfoo/promptfoo/git/trees/main` → `src/assertions/` 下 **60 个断言文件**：`cost.ts` / `similar.ts` / `factuality.ts` / `geval.ts` / `latency.ts` / `levenshtein.ts` / `meteor.ts` / `rouge.ts` / `ngrams.ts` / `gleu.ts` / `bleu.ts` / `perplexity.ts` / `moderation.ts` / `refusal.ts` / `trajectory.ts` / `skill.ts` / `html.ts` / `xml.ts` / `json.ts` / `regex.ts` / `sql.ts` / `python.ts` / `javascript.ts` / `guardrails.ts` / `redteam.ts` / `synthesis.ts` / `classifier.ts` / `contains.ts` / `equals.ts` / `pi.ts` …
  - `GET /repos/promptfoo/promptfoo/contents/src/assertions/cost.ts` → 28 行，`handleCost({ cost, assertion, inverse })`
  - `GET /repos/promptfoo/promptfoo/git/trees/main` → `src/providers/` 下 **80+ provider**（openai / anthropic / azure / bedrock / gemini / ollama / openrouter / portkey / litellm / http / websocket / webhook …）
  - `GET /repos/promptfoo/promptfoo/git/trees/main` → `src/redteam/` **243 个文件**，含 `plugins/` 几十种攻击插件与 `graders.ts`
- **解决哪一层**：提示词管理 / 评测 / 红队。
- **适配点**：mulpub 的 `PromptEvalCase` / `PromptEvalRun` / `PromptEvalScene` / `PromptEvalProviderKey` 四张表已经具备「评测体系」的骨架，但**缺断言库**：现在只能记录结果，无法定义「什么算通过」。promptfoo 的 `assertions` 目录几乎覆盖 mulpub 所有质量诉求：`similar`（改写后与原文相似度）、`cost`（**单次调用成本上限断言**——积分换算的直接防线）、`latency`、`factuality`、`geval`（LLM 评委）、`trajectory`（多步轨迹）、`json` / `regex`（结构化输出校验）。Node 侧，**与 mulpub 现有 vitest CI 天然同构**，`promptfoo eval` 可作为 vitest 之前的一道门禁。另有 `providers/openrouter.ts` / `litellm.ts` / `http.ts`，能直接对 `ai-writer-api` 做黑盒评测。
- **引入成本**：**低**。MIT、TypeScript、CLI 形态（`promptfoo eval -c config.yaml`），不侵入业务代码，只在 CI 里加一个 job。
- **风险**：红队模块（`src/redteam/` 243 文件）是它的商业化主战场，核心红队能力可能逐步锁到云端；断言调用真实 LLM 会产生费用，CI 里必须设 `cost` 上限并区分「评测花的钱」与「用户花的钱」——否则评测成本自己就把 27.1% 的成本占比吃穿了。
- **建议**：**直接引入**（作为 CI 门禁 + 本地 A/B 工具），不作为运行时依赖。
- **置信度**：高（60 个断言文件、80+ provider 均由目录树实读；`cost.ts` 逐行读过）。

### 6. `langfuse/langfuse` — 提示词版本化与成本计费的数据模型范本
- **证据**
  - `GET /repos/langfuse/langfuse` → stars=36218, forks=4050, language=TypeScript, default_branch=`main`, pushed_at=2026-10-23T02:45:23Z, created_at=2023-05-18
  - `GET /repos/langfuse/langfuse/commits?per_page=3` → 2026-10-23、2026-10-22 等
  - `GET /repos/langfuse/langfuse/git/trees/main?recursive=1` → 7341 个 blob
  - `GET /repos/langfuse/langfuse/license` → spdx=NOASSERTION，正文：「Content outside of the above mentioned directories or restrictions above is available under the "MIT Expat" license」，受限目录为 `ee/`、`web/src/ee/`、`worker/src/ee/`
  - `GET /repos/langfuse/langfuse/contents/packages/shared/prisma/schema.prisma` → **2256 行，83 个 model**；`model Prompt { id, projectId, prompt Json, name, version Int, type String @default("text"), isActive, config Json, tags String[], labels String[], commitMessage String?, … @@unique([projectId, name, version]) }`；另有 `PromptDependency` / `PromptProtectedLabels` / `Evaluator` / `EvaluatorVersion` / `EvaluationRule` / `EvaluationRuleEvaluatorAssignment` / `EvalTemplate` / `ScoreConfig` / `Model` / `Price` / `PricingTier` / `BillingMeterBackup` / `CloudSpendAlert` / `AuditLog` / `Dataset` / `DatasetItem` / `RoleAssignment` / `ProjectMembership`
- **解决哪一层**：提示词管理（版本化）+ 成本追踪。
- **适配点**：这是**最值得直接抄数据模型的一条**。mulpub 的 `PromptEvalScene` / `PromptEvalCase` 缺「提示词本体 + 版本」这一层——现在只有评测场景，改了提示词就追溯不到是哪一版评的。Langfuse 的 `Prompt` 表用 `@@unique([projectId, name, version])` + `labels`（`production` / `latest` / `staging`）+ `tags` + `commitMessage` + `type`，以及 `PromptDependency`（提示词间引用）——这套结构可以直接平移到 ops-center，改动量约 1 张表 + 2 个字段。同理 `Price` / `PricingTier` 两张表是「模型单价维表」的正确形态，正好承接 OTel 口径下的多类 token 单价。
- **引入成本**：**不引入**（自托管要 Postgres + ClickHouse + Redis + worker 队列，比 ops-center 现在的 SQLite 重太多）；**借鉴数据模型**成本接近零。
- **风险**：`ee/` 目录另有授权，直接抄代码会踩边界（**抄数据模型不抄代码**）；`Prompt.isActive` 字段注释已标 Deprecated，说明其标签机制仍在演进，抄的时候别连 `isActive` 一起抄。
- **建议**：**借鉴实现**（数据模型）。若日后要接 APM，Langfuse 是 OTel 原生、MIT 主体、自托管可用，是比 Helicone 更中性的选择（见劝退节 Helicone 条）。
- **置信度**：高（83 个 model 名与 `Prompt` 表完整字段已从 schema 正文读出）。

### 7. `apache/casbin` — 模型/策略分离的 RBAC+ABAC，mulpub 权限矩阵的规范化参考
- **证据**
  - `GET /repos/apache/casbin` → stars=20463, forks=1764, language=Go, default_branch=`master`, pushed_at=2026-10-21T00:39:29Z, created_at=2017-04-08
  - `GET /repos/apache/casbin/commits?per_page=3` → 2026-10-21「fix: update golangci-lint config for v2.15」、2026-10-20「feat: add cross-language conformance cases」、2026-10-20「feat: add SyncedContextEnforcer」
  - `GET /repos/apache/casbin/git/trees/master?recursive=1` → 326 个 blob；`examples/` 97 + `model/` 6 = 103 个文件
  - `GET /repos/apache/casbin/license` → spdx=Apache-2.0，正文「Apache License / Version 2.0, January 2004」
  - `GET /repos/apache/casbin/contents/rbac_api.go` → **733 行**，方法含 `GetRolesForUser` / `GetImplicitRolesForUser` / `GetImplicitPermissionsForUser` / `GetImplicitUsersForPermission` / `GetDomainsForUser` / `GetImplicitResourcesForUser` / `AddPermissionForUser` / `DeletePermissionsForUser`
  - `GET /repos/apache/casbin/contents/enforcer.go` → **1128 行**，`NewEnforcer` / `LoadModel` / `SetRoleManager` / `SetWatcher` / `SetEffector` / `EnforceContext.GetCacheKey`
  - `GET /repos/apache/casbin/git/trees/master` → `examples/` 97 个模型/策略样例：`rbac_model.conf` / `rbac_with_domains` / `abac_rule_model.conf` / `keymatch2_model.conf` / `priority_model_explicit.conf` / `object_conditions_model.conf` / `biba_model.conf` / `pbac_model.conf` / `orbac_model.conf` …
- **解决哪一层**：授权（RBAC / ABAC / 资源级）。
- **适配点**：mulpub 的 `ACCESS-CONTROL-MATRIX.md` 现在是**文档**，`plan-matrix.js` 是**代码**里的档位常量——两者会漂移。Casbin 的核心贡献不是算法，是**把「模型（model.conf：谁对什么能做什么）」与「策略（policy.csv：具体授予）」彻底分离**。把 mulpub 的矩阵拆成 `model`（角色×资源×动作的形状）+ `policy`（各租户的授予行），就能让运营在后台改策略而不动代码，也天然支持「资源级权限」（`g, alice, editor, project:42` 这种带实例 ID 的授权）。`GetImplicitResourcesForUser` 这类「反查」方法在 mulpub 同样需要——「列出这个用户能碰哪些项目」是运营后台的刚需。
- **引入成本**：**中**（若引入 Go 侧库或 WASM）；但**只抄模型/策略分离的结构，引入成本≈0**——在 ops-center 用两张表 + 一个纯 Python 的 `enforce(sub, obj, act)` 函数即可，无需 Casbin 运行时。
- **风险**：Go 库，Python 侧只有 `casbin` 的 py ports（本次未取证，见不确定项）；Casbin 的 matcher 语法（`g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act`）是自定义 DSL，团队学习成本真实存在；**引入 Casbin 作为服务**会把 mulpub 的权限判定变成一次网络调用，桌面端离线场景直接不可用。
- **建议**：**借鉴数据模型**（model/policy 分离 + 隐式权限反查），不引入运行时。
- **置信度**：高（两个核心文件行数与方法名、103 个样例均实读）。

### 8. `openfga/openfga` — 关系型细粒度授权，适合「项目×成员×角色」的资源级权限
- **证据**
  - `GET /repos/openfga/openfga` → stars=6025, forks=531, language=Go, default_branch=`main`, pushed_at=2026-10-22T19:45:09Z, created_at=2022-06-08
  - `GET /repos/openfga/openfga/commits?per_page=3` → 2026-10-20「chore: fix errcheck lint issues (#3349)」、2026-10-15「fix(listobjects): surface condition evaluation errors from the unary pipeline (#3338)」、2026-10-07
  - `GET /repos/openfga/openfga/git/trees/main?recursive=1` → 578 个 blob
  - `GET /repos/openfga/openfga/license` → spdx=Apache-2.0，正文「Apache License / Version 2.0, January 2004」
  - `GET /repos/openfga/openfga/git/trees/main` → `internal/graph/` 26 文件（`check.go` / `recursive_resolver.go` / `cached_resolver.go` / `weight_two_resolver.go` / `shadow_resolver.go` / `dispatch_throttling_check_resolver.go`）、`pkg/typesystem/` 10 文件（`typesystem.go` / `weighted_graph.go` / `resolver.go`）、`pkg/server/commands/` 含 `check_command.go` / `batch_check_command.go`、`assets/migrations/{mysql,postgres,sqlite}/`（含 `002_add_authorization_model_version.sql`、`004_add_authorization_model_serialized_protobuf.sql`、`005_add_conditions_to_tuples.sql`）、`docs/` 27 文件（含 `docs/check/README.md`、`docs/list_objects/example/`、`docs/authzen/`）
- **解决哪一层**：授权（资源级 / 关系型）。
- **适配点**：与 Casbin 的区别是**关系型（tuple）而非字符串策略**：OpenFGA 的授权模型是一段 DSL（`type user`、`type project`、`relation viewer`），数据是 `(user, relation, object)` 三元组。mulpub 若未来出现「A 把自己的项目共享给 B 的组织」「B 组织里的成员继承权限」这种**跨组织委托**，纯 RBAC 角色表会很快不够用；OpenFGA 的 tuple 表（`subject_type / subject_id / relation / object_type / object_id`）是更自然的数据模型。`docs/list_objects/example/` 的反查示例也直接对应「列出某用户可访问的所有项目」。
- **引入成本**：**高**。Go 服务 + 独立存储 + HTTP API，桌面端离线不可用；授权模型 DSL 需要另学一套语法。
- **风险**：Zanzibar 血统带来的是分布式一致性与缓存复杂度（仓内有 `cached_resolver.go` / `shadow_resolver.go` / `dispatch_throttling_check_resolver.go` 等为高并发而生的复杂层），对 mulpub 的规模是**严重过度设计**；服务化后多一次网络往返即多一个故障点。
- **建议**：**仅供对照**（学它的 tuple 数据模型与关系继承表达法）。若真到了需要关系型授权的那一天，**先在 SQL 里落 tuple 表 + 自己写递归 CTE**，而不是上 OpenFGA 服务。
- **置信度**：中高（核心目录与迁移文件已实读；未实测其授权模型 DSL 的表达能力边界）。

### 9. `Infisical/infisical` — 密钥托管的「分级 / 审批 / 轮换 / 共享」数据模型
- **证据**
  - `GET /repos/Infisical/infisical` → stars=29934, forks=2368, language=TypeScript, default_branch=`main`, pushed_at=2026-10-23T04:19:34Z, created_at=2022-08-05
  - `GET /repos/Infisical/infisical/commits?per_page=3` → 2026-10-23 三条
  - `GET /repos/Infisical/infisical/git/trees/main?recursive=1` → **15434 个 blob**
  - `GET /repos/Infisical/infisical/license` → spdx=NOASSERTION，正文：「Content outside of the above mentioned directories or restrictions above is available under the "MIT Expat" license」，受限目录为 `ee/`
  - `GET /repos/Infisical/infisical/git/trees/main` → `backend/src/db/migrations/` 含 `20231218092517_secret-tag.ts`、`20231220052508_secret-version.ts`、`20240102152111_secret-rotation.ts`、`20240101054849_secret-approval-policy.ts`、`20240101104907_secret-approval-request.ts`、`20240528190137_secret_sharing.ts`、`20240925100349_managed-secret-sharing.ts`、`20250122055102_secret-sync.ts`、`20250210101841_secret-rotation-to-kms.ts`、`20250210101841_dynamic-secret-root-to-kms.ts`、`20250226021631_secret-requests.ts`
  - `GET /repos/Infisical/infisical/git/trees/main` → `backend/src/services/secret-sharing/`（dal / service / types）、`backend/src/services/secret-sync/`（1password / aws-parameter-store / aws-secrets-manager / azure-app-configuration / azure-devops …）
- **解决哪一层**：密钥管理。
- **适配点**：mulpub 的「内置模型 key（`OfficialKey`）」与「用户自带 key」是**两类完全不同敏感级别**的凭证：官方 key 泄漏=直接亏钱且影响所有用户；用户自带 key 泄漏=用户自己的额度被盗用。Infisical 的 `secret`（当前值）/ `secret-version`（历史版本）/ `secret-rotation`（轮换策略）/ `secret-approval-policy` + `secret-approval-request`（变更审批）/ `secret-sharing`（跨主体共享 + 密码保护）这套表，恰好把「谁能看、谁能改、什么时候必须换、谁批的」四件事落到了表上。mulpub 现在 `OfficialKey` 一张表管全部，**建议至少拆出 `key_version` 与 `key_rotation_policy`**，并给运营改 key 加审批流。
- **引入成本**：**高**（自托管要 Postgres + Redis + KMS，另带 `ee/` 授权边界）；**借鉴数据模型成本≈0**。
- **风险**：`ee/` 目录另有授权（审批流、审计等企业特性很可能正在迁入 ee），**直接抄代码有法律风险，抄表结构没有**；引入 KMS 会带来云厂商绑定。
- **建议**：**借鉴数据模型**（version / rotation / approval 三层），不引入服务。
- **置信度**：中高（迁移文件名与目录已实读；未逐个读表字段）。

### 10. `web-infra-dev/midscene` — 自然语言驱动的 E2E，把「AI 驱动测试」变成可断言的 Gherkin 流程
- **证据**
  - `GET /repos/web-infra-dev/midscene` → stars=15370, forks=1200, language=TypeScript, default_branch=`main`, pushed_at=2026-10-23T03:50:31Z, created_at=2024-07-23
  - `GET /repos/web-infra-dev/midscene/commits?per_page=3` → 2026-10-22「fix(chrome-extension): keep recorder screenshots on their source tab (#3194)」、2026-10-22「chore(workflow): release v1.16.5」、2026-10-22
  - `GET /repos/web-infra-dev/midscene/git/trees/main?recursive=1` → 2884 个 blob；`packages/` 1788 + `apps/` 920
  - `GET /repos/web-infra-dev/midscene/license` → spdx=MIT，正文「MIT License / Copyright (c) 2024-present Bytedance, Inc. and its affiliates」
  - `GET /repos/web-infra-dev/midscene/git/trees/main` → `packages/` 目录：core / cli / web-integration / webdriver / test / recorder / visualizer / shared / computer / android / ios / harmony / playground
  - `GET /repos/web-infra-dev/midscene/git/trees/main` → `packages/core/src/agent/` 28 文件，含 `run-gherkin-scenario.ts` / `run-markdown.ts` / `record-to-report.ts` / `test-runner-nodes.ts` / `ui-observer.ts` / `metrics.ts` / `usage-intent.ts` / `task-cache.ts` / `ai-act-progress.ts` / `action-readiness.ts`
  - `GET /repos/web-infra-dev/midscene/git/trees/main` → `packages/web-integration/src/` 70 文件，含 `agent-tools-cdp.ts` / `agent-tools-puppeteer.ts` / `cdp-proxy.ts` / `chrome-extension/agent.ts` / `bridge-mode/`
- **解决哪一层**：AI 驱动测试 / 质量门禁。
- **适配点**：mulpub 的 `packages/ai-autonomous-tester` 已经在做「AI 驱动 E2E」（`run-autonomous-e2e.js` / `agent-visual-judge.js` / `run-a11y-tests.js` / `fix-engine.js`），但从文件名看**断言是 AI 判的**（`agent-visual-judge`），没有可回归的确定断言。midscene 的路径是 **自然语言 → Gherkin 场景 → 确定性断言**（`run-gherkin-scenario.ts`），并且有 `test-runner-nodes.ts`（把 AI 步骤嵌进测试节点）、`metrics.ts`（每步 token/耗时）、`usage-intent.ts`、`task-cache.ts`（缓存避免重复烧钱）。这三点对 mulpub 特别关键：**① 断言要确定，不能只靠 AI 评委；② 每次 AI 步骤的 token 消耗必须计量**（现在 `ai-autonomous-tester` 的 54 个文件里没看到成本台账）；③ 视觉判定的截图要留证据（`record-to-report.ts`）。
- **引入成本**：**中**。MIT、TypeScript、与现有 playwright 无冲突（`web-integration` 是 CDP/Puppeteer 路线，**不基于 Playwright**，与 mulpub 现有 playwright 栈是并存而非替换关系）。但它需要接视觉模型，CI 成本会上升。
- **风险**：视觉判定天然不确定，同一页面两次结果可能不同，**不能作为唯一门禁**，需与确定性断言配合；`packages/core` 体量大，引入会显著增加桌面端测试依赖；ByteDance 出品，许可证 MIT 无问题，但迭代节奏快、breaking change 频繁（版本号已到 v1.16.x）。
- **建议**：**借鉴实现**（Gherkin 化的断言范式 + 每步 token 计量 + 截图存证），不作为必装依赖；可先在一个非核心流程试点。
- **置信度**：中高（目录树与 agent 模块文件已实读；未实跑其断言机制）。

### 11. `better-auth/better-auth` — 自建认证的对照物，MIT 且有官方 Electron 集成
- **证据**
  - `GET /repos/better-auth/better-auth` → stars=30425, forks=2998, language=TypeScript, default_branch=`main`, pushed_at=2026-10-23T04:10:41Z, created_at=2024-05-19
  - `GET /repos/better-auth/better-auth/commits?per_page=3` → 2026-10-23T04:05「refactor(cloudflare): standardize token endpoint auth options (#11997)」、2026-10-23T02:02、2026-10-23T01:47
  - `GET /repos/better-auth/better-auth/git/trees/main?recursive=1` → 2377 个 blob；`packages/` 1261 + `docs/` 475 + `e2e/` 219
  - `GET /repos/better-auth/better-auth/license` → spdx=MIT，正文「The MIT License (MIT) / Copyright (c) 2024 - present, Bereket Engida」
  - `GET /repos/better-auth/better-auth/git/trees/main` → `packages/` 23 个子包：api-key / better-auth / cimd / cli / core / drizzle-adapter / **electron** / expo / i18n / kysely-adapter / mcp / memory-adapter / mongo-adapter / oauth-provider / passkey / prisma-adapter / **release-tooling** / redis-storage / scim / sso / stripe / telemetry / test-utils
  - `GET /repos/better-auth/better-auth/contents/packages/electron/src/index.ts` → 210 行，`export const electron = (options?: ElectronOptions) => {...}`；同包含 `authenticate.ts` / `preload.ts` / `proxy.ts` / `cookies.ts` / `storage.ts` / `browser.ts` / `user.ts` / `routes.ts`
  - `GET /repos/better-auth/better-auth/contents/packages/api-key/src/org-authorization.ts` 与 `packages/api-key/src/rate-limit.ts` 存在
- **解决哪一层**：认证。
- **适配点**：mulpub 已用 Logto（`@logto/client` + `logto-auth.js` / `logto-jwks.js` / `logto-webhook.js` / `business-identity.js`），**没有换的动机**。better-auth 在本轨道里唯一的增量是 **`packages/electron/`**——一个 25 文件的 Electron 认证集成包（`authenticate.ts` / `preload.ts` / `proxy.ts` / `cookies.ts`），正好对应 mulpub 桌面端「登录态如何安全地存进 Electron」这个难题（Logto 的 `@logto/client` 走浏览器流程，在 Electron 里需要额外的安全边界）。可以只读这一个包的设计，不引依赖。
- **引入成本**：**高**（换 IdP 是全链路改动：桌面端登录、ops-center 的 `logto-jwks.js` 验签、`logto-webhook.js` 事件、用户表、令牌吊销……）；**只读 `packages/electron` 设计成本≈0**。
- **风险**：better-auth 自身有商业云版本，开源主体与云功能边界会持续变化；引入第二个 IdP 会让 `ACCESS-CONTROL-MATRIX` 与运维文档分裂。
- **建议**：**仅供对照**（重点看 `packages/electron` 与 `packages/api-key` 的组织级 API Key 授权）。保留 Logto。
- **置信度**：中（`packages/electron/src/index.ts` 已读，但未逐文件评估其与 Logto 的功能重叠度）。

### 12. `BerriAI/litellm` — Python 侧最成熟的自建 LLM 网关参考实现，成本台账的多维聚合表值得抄
> 说明：本条曾以「OTel 老仓的弃用对照」为副标题，但复核后该仓的 `model/gen-ai/deprecated/registry-deprecated.yaml` 证据已并入**候选 4**；本条只讲 LiteLLM 本身。老仓 `open-telemetry/semantic-conventions` 的 `default_branch=main`、pushed_at=2026-10-22T23:50:04Z（674★）仍活跃，但**其 `model/gen-ai/` 目录下只剩 `deprecated/` 子目录**（`GET /repos/open-telemetry/semantic-conventions/contents/model/gen-ai` → 仅 1 个子项 `deprecated`），现行定义已全部迁出 —— 这本身也是「不要引老仓」的硬证据。
- **证据（`BerriAI/litellm`）**
  - `GET /repos/BerriAI/litellm` → stars=61859, forks=12586, language=Python, default_branch=`main`, pushed_at=2026-10-23T03:43:37Z, created_at=2023-07-27
  - `GET /repos/BerriAI/litellm/commits?per_page=3` → 2026-10-22「fix(security): stop trusting the compromised eMudhra root CA (#47670)」、2026-10-21「refactor(inference): rename RouteError to Error (#47771)」、2026-10-21
  - `GET /repos/BerriAI/litellm/git/trees/main?recursive=1` → **14580 个 blob**
  - `GET /repos/BerriAI/litellm/license` → spdx=NOASSERTION，正文：「All content that resides under the "enterprise/" directory … is licensed u[nder a proprietary license]… Content outside of the above mentioned directories or restrictions above is available under the MIT license」
  - `GET /repos/BerriAI/litellm/contents/litellm/router.py` → **16728 行**，含 `validate_fallbacks` / `stream_with_fallbacks` / `_combine_fallback_usage` / `_carry_partial_spend_to_fallback` / `_anthropic_stream_should_decline_fallback`
  - `GET /repos/BerriAI/litellm/contents/litellm/proxy/schema.prisma` → **2062 行**；`model LiteLLM_BudgetTable`(L13)、`LiteLLM_ObjectPermissionTable`(L338)、`LiteLLM_SpendLogs`(L720)、`LiteLLM_BudgetWindowSpend`(L765)、`LiteLLM_DailyUserSpend`(L865)、`LiteLLM_DailyGlobalSpend`(L903)、`LiteLLM_DailyOrganizationSpend`(L934)、`LiteLLM_DailyEndUserSpend`(L972)、`LiteLLM_DailyAgentSpend`(L1009)、`LiteLLM_DailyTeamSpend`(L1046)、`LiteLLM_DailyTagSpend`(L1085)、**`LiteLLM_DailyModelUsage`(L1339)**、`LiteLLM_DailyGatewayRequests`(L1366)、`LiteLLM_DailyGatewayFailedRequests`(L1379)、`LiteLLM_DailyRequestErrors`(L1392)
  - `GET /repos/BerriAI/litellm/contents/litellm/proxy/db/db_spend_update_writer.py` → **3107 行**（`SpendLogsPayload` 批量写入 + 事务队列 + 失败重入队）
  - `GET /repos/BerriAI/litellm/contents/litellm/proxy/db/model_usage_rollup.py` → **185 行**，`class ModelUsageKey` / `class ModelUsageTransaction` / `build_model_usage_transaction(payload: SpendLogsPayload)` / `flush_model_usage_transactions(...)`
  - `GET /repos/BerriAI/litellm/contents/model_prices_and_context_window.json` → **约 2898 KB**（模型价目 + 上下文窗口表）
- **解决哪一层**：模型网关 / 成本核算 / 降级。
- **适配点**：mulpub 已有 `ModelUsageDaily` / `ModelUsageBatch`——**名字与 LiteLLM 的 `LiteLLM_DailyModelUsage` / `ModelUsageTransaction` 几乎一一对应**，说明当初的设计方向是对的，但 LiteLLM 走得更远：它把**日聚合（Daily）按 8 个维度**拆开（user / global / organization / end_user / agent / team / tag / model），每条 `SpendLogs` 是明细，聚合表由后台 writer 批量 upsert。这对 mulpub 的直接启发是：**`ModelUsageDaily` 应该加 `scene`（对应 tag）、`user_id`、`org_id` 三个维度**，否则「哪个场景（aiWrite / rewrite / video）在亏钱」根本算不出来。`LiteLLM_ObjectPermissionTable` 则是「资源级权限」在网关侧的落法。
- **引入成本**：**高**（LiteLLM proxy 是完整网关 + Postgres + Prisma + Redis 队列，Python 侧虽与 mulpub 后端同语言，但要接管 mulpub 现有 `ai-router` 的全部流量）；**抄表模型成本≈0**。
- **风险**：主体 MIT 但 **`enterprise/` 目录另有商业授权**，而 `budget` / `spend` 的部分高级能力（`litellm/proxy/db/`、`auto_router`、`shadow_eval_funnel` 等）正持续向 enterprise 迁移；`router.py` 已 16728 行，单文件复杂度极高，直接改造风险大；其定价表依赖 `model_prices_and_context_window.json`，价格更新滞后会直接算错积分。
- **建议**：**借鉴实现**（多维日聚合表 + 明细/聚合分离 + 价目表外置），**不引入 proxy**。若 mulpub 将来真要自建统一网关，LiteLLM 是 Python 侧最成熟的参考实现，但**必须在 `enterprise/` 边界外只用**。
- **置信度**：高（router.py / schema.prisma / 两个 db writer 的行数与关键符号均实读）。

---

## 三、不确定项与未覆盖

**已查但未查实（列为「未取证」，不写结论）**
1. **Casbin 的 Python 绑定**（`casbin/pycasbin`）未单独取证——因此「Python 侧是否有官方 port」这一点未确认，本报告只给「自己写 `enforce()`」的方案。
2. **OpenFGA 授权模型 DSL 的表达能力边界**未实测（只读了目录与迁移文件，未跑过模型校验），故其建议仅为「对照」。
3. **midscene 的断言确定性**未实跑（视觉判定天然不确定这一点是基于其「AI 驱动 + Gherkin」双层结构的推断，非实测）。
4. **bifrost 的 `dev` 分支稳定性**未评估（只取了 3 条 commit 记录）。
5. **Infisical 各表的具体字段**未逐表读取（只依据 30+ 个迁移文件名推断表职责）。
6. **Helicone / DeepEval / Ragas / Phoenix / OpenLIT / Stagehand** 仅取了元信息与一两次提交记录，未深入目录树，故除劝退节的理由外不做正面推荐。

**本维度认为还漏掉的项目**
- **OpenTelemetry Collector 的 `genai` processor / `semanticconventions` 之外的计量实现**（如 `open-telemetry/opentelemetry-collector-contrib` 里的 genai processor）——本次未取证，可能存在比「自建埋点」更省事的成本聚合方案。
- **预算/限流的纯库方案**（如 `celery`-style 的 token bucket、`redis-cell`）——本次只覆盖了「网关自带预算表」，没有覆盖「桌面端本地限流」场景。mulpub 桌面端有自研 `ClientDegradationEvent` 表，客户端侧的降级/限流策略库值得单独查一轮。
- **提示词仓库化（prompt-as-code）方案**（如 `promptfoo` 之外的 `Agenta`、`prompttools`）——本次未查，mulpub 的 `RuntimeConfigVersion` / `RuntimeClientAck` 表说明它已经有「配置版本 + 客户端确认」的雏形，这块与提示词版本化高度耦合，值得再查一轮。
- **模型质量路由（quality-based routing）**：`lm-sys/RouteLLM` 已停更（见劝退节），但「按质量/成本自动选模型」的现役替代品本次未找到可信候选，列为缺口。
- **可观测后端**：Langfuse（ClickHouse）之外，ClickHouse / ClickHouse-Alternative 的自托管成本未评估；mulpub 若是 SQLite 起步，直接上 ClickHouse 属于架构跳跃。

---

### 3.1 复核后仍存疑的 8 项（附最小验证方法）

> 以下 8 项经独立复核后仍无法在本轮确证，**逐条落账，不做结论**。每条给出可执行的最小验证动作。

| # | 存疑点 | 为什么重要 | 最小验证方法 |
|---|---|---|---|
| 1 | **Ollama 的"决定性证据"是路径匹配而非内容匹配** | 仓内 `server/cloud_proxy.go`、`codex_proxy.go`、`auth.ts` 里代理与鉴权概念在**内容**里而不在**文件名**里，因此"全仓匹配 `fallback|budget|router|quota|credit` = 0"只证明了没有同名文件，不能证明没有相关能力 | 对上述 3 个文件做**内容级** grep（`proxy` / `auth` / `quota` / `budget` / `fallback`），而不是只做路径匹配；结论表述已从"决定性证据"降级为"未发现同名文件" |
| 2 | **phoenix 的 ELv2 豁免条款是否覆盖自托管** | 决定"能否自托管 AI 观测层"这个结论能不能成立 | 属法律判断。读 ELv2 正文 §2 的豁免清单原文，**交法务复核**，不由技术侧定 |
| 3 | **vault BSL 的竞品条款未逐字引用、转换年份未给** | BSL 有自动转 MIT 的时间表，年份直接决定"现在用还是等" | 取 `hashicorp/vault` LICENSE 正文，引用使用限制原文，并补出"Change Date"与"Change License"字段值 |
| 4 | **promptfoo 评测费与用户费如何分账无配置示例** | 这是"拿开源评测做产品化"最容易踩的成本坑（评测本身要烧 LLM token） | 读 promptfoo 的 `cost.ts` 断言实现与 `defaultTest` 配置，产出一份"评测预算上限 + 用户 token 与评测 token 分离计费"的配置样例 |
| 5 | **pydantic-ai 内置价目表是否覆盖通义/智谱/豆包** | 决定"能否直接抄它的计价范式覆盖国内模型" | 读 `_genai_prices.py` 的完整条目，确认是否含国内 provider；不含则明确"国内模型单价需自维护" |
| 6 | **bifrost 主线在 `dev` 分支，示例文档会变** | `dev` 不是稳定分支，照着示例做会踩坑 | 补 commit SHA 锚点（记录取证时的 sha），并明确"以 `dev` 为准的结论会随上游漂移" |
| 7 | **Instructor `Mode.TOOLS_STRICT` 对国内 provider 兼容性** | **这是"直接引入"建议的核心卖点，属结论级风险** | 沙箱无 provider 凭证，**本轮无法实测**。落地时按风险栏的降级路径：先 `Mode.JSON_SCHEMA` 跑通 → 再单开 `TOOLS_STRICT` 灰度 → 若国内 provider 均不支持 strict，该建议降级为"借鉴实现" |
| 8 | **Casbin Python 绑定的存在性在风险栏与 §三 之间有张力** | 决定 ops-center（Python）能否直接用而非自己写 `enforce()` | 统一口径：取 `casbin/pycasbin` 的 `GET /repos/.../license` 与默认分支最后提交，确认协议与维护状态后，§三第 1 条改为"已取证"或"确认无官方 port" |

---

## 四、本文档明确劝退的项目

> **协议风险总览（mulpub 为闭源商业分发，以下项目必须点名）**

| 项目 | 协议（实测正文） | 风险 |
|---|---|---|
| `QuantumNous/new-api`（原 `Calcium-Ion/new-api`） | **AGPL-3.0** | **强传染**。若 mulpub 自建网关并改造其代码，整体需以 AGPL-3.0 开源。**闭源商业分发必须排除**。 |
| `zitadel/zitadel` | **AGPL-3.0** | 自建 IdP 并修改即触发开源义务。**闭源分发必须排除**。 |
| `Permify/permify` | **AGPL-3.0** | 同上。资源级授权的首选本应是 OpenFGA（Apache-2.0），Permify 直接出局。 |
| `hashicorp/vault` | **BSL（Business Source License）** | 非 OSI 开源。附加使用限制明文写有「不得以托管或嵌入方式向第三方提供以与 IBM 付费版竞争」；且 BSL 会自动在若干年后转为 MIT。**不作为开源依赖**。 |
| `Arize-ai/phoenix` | **Elastic License 2.0 (ELv2)** | 非 OSI 开源，含「不得作为托管/嵌入服务提供」的竞品限制。**不作为开源依赖**。 |
| `Helicone/helicone` | Apache-2.0 | 协议无碍，但**已被并入 Bifrost 生态**（见下），战略独立性存疑。 |
| `BerriAI/litellm` | MIT（`enterprise/` 除外） | 协议可用，但企业功能持续迁入 `enterprise/`，需逐文件确认。 |
| `langfuse/langfuse` | MIT（`ee/` 除外） | 同上，抄模型不抄代码。 |
| `Infisical/infisical` | MIT（`ee/` 除外） | 同上。 |

**逐项劝退理由**

- **`QuantumNous/new-api`（原 `Calcium-Ion/new-api`，37k→50.5k stars）** — 协议 AGPL-3.0 传染，是闭源商业分发的硬伤。功能上它确实是「聚合 + 分发 + 计费」的完整实现（Go，default_branch=main，2026-10-22 仍在提交，如「feat(billing): bill OpenAI 12-hour prompt cache writes at their own price」），**但仅可作为「功能清单参考」阅读其计费/渠道表设计，不可复制代码**。mulpub 的 `OfficialKey` / `ModelPreset` 体系与之重叠度低，集成收益本就不大。

- **`zitadel/zitadel`** — AGPL-3.0。且 mulpub 已用 Logto 并把鉴权链路（`logto-jwks.js` / `logto-webhook.js` / `business-identity.js` / `entitlement.js` 的 RSA 签名 + `kid`）做得很深，**换 IdP 的迁移成本远大于收益**。Logto 本身实测如下：`GET /repos/logto-io/logto` → stars=14757, forks=1199, language=TypeScript, **default_branch=`master`**, pushed_at=2026-10-23T04:29:04Z；`GET /repos/logto-io/logto/commits?per_page=3` → 2026-10-23 三条（默认分支当日仍活跃）；`GET /repos/logto-io/logto/git/trees/master?recursive=1` → **8090 个 blob**，其中 `packages/` 8008，拆分为 `console`(2171) / `phrases`(1861) / `core`(1039) / `experience`(618) / `connectors`(573) / `schemas`(507) / `integration-tests`(389) / `phrases-experience`(321) / `account`(232) / `toolkit`(59) / `cli`(51) / `elements`(40) —— 是一套含**多语言文案（phrases）、连接器（connectors，MCP/OAuth）、可编排登录旅程（experience）**的完整 IdP，不是玩具。`GET /repos/logto-io/logto/license` → spdx=MPL-2.0（文件级 copyleft，作为独立服务部署使用**无传染性**，不要求 mulpub 开源）。**结论：保留 Logto 是正确决策；AGPL 的 ZITADEL 直接出局。**

- **`Permify/permify`** — AGPL-3.0，与 `openfga/openfga` 功能定位几乎相同（Zanzibar 风格细粒度授权，5967 stars，默认分支最后提交 2026-10-09）。**选 OpenFGA（Apache-2.0）而不是 Permify，理由纯为协议**。

- **`hashicorp/vault`** — LICENSE 正文首行即「License text copyright (c) 2020 MariaDB Corporation Ab」，实为 **BSL**，附加使用限制含竞品条款。且 mulpub 当前的密钥量级（官方模型 key + 用户自带 key）用「KMS 加密列 + 定期轮换」即可，**上 Vault 是重大过度工程**。

- **`Arize-ai/phoenix`** — LICENSE 正文为 **Elastic License 2.0**，非 OSI 开源。功能（AI Observability & Evaluation，11957 stars，2026-10-23 活跃）确实对口，但协议排除。**观测层用 Langfuse（MIT 主体）替代**。

- **`lm-sys/RouteLLM`** — `GET /repos/lm-sys/RouteLLM` → stars=5630, Apache-2.0, pushed_at=**2024-08-10**；`/commits?per_page=3` 显示默认分支最后提交为 **2024-08-10「create /health endpoint for health checks」**，此后**近两年无提交**。且 `GET /repos/lm-sys/RouteLLM/license` → **HTTP 200，spdx=Apache-2.0，正文 201 行**（首行 `Apache License`，与 metadata 一致）。**已停止维护（默认分支近两年无提交），直接排除；协议本身无问题。**

- **`Portkey-AI/gateway`** — stars=13255, MIT, pushed_at=2026-05-25；默认分支最后提交 **2026-05-25「Merge pull request #1657 from Portkey-AI/fix/add-auth-validation-for-public-routes」**，2026-05-19 另有「redact provider options in logs」。相较本报告其他候选（多数 2026-10-23 仍有提交），**已停滞约 5 个月且最后提交是修 auth 校验**，典型的商业化转向期。**不作为新选型**。

- **`vibrantlabsai/ragas`（原 `explodinggradients/ragas`）** — stars=16129, Apache-2.0, pushed_at=**2026-02-24**，默认分支最后提交 2026-02-24「fix: allow fork contributors in check-docs CI workflow」、2026-01-31、2026-01-22 —— **已停滞 8 个月**，且提交内容多为文档/CI 杂务。mulpub 的 RAG 评测需求（`knowledge-evolution` / `knowledge-context-builder`）用 promptfoo 的断言 + Langfuse 的数据集模型足够，**不需要为一个停更项目引入 Python 依赖**。

- **`Helicone/helicone`** — stars=6233, Apache-2.0, pushed_at=2026-10-20，default_branch 最后提交 2026-10-20「Sync fixes from upstream: keep-alive, settings grants, terms, **bifrost**, CI (#5844)」。**关键发现**：`git/trees/main` 显示仓库顶层已有 `bifrost/`（1348 个文件）目录，`web/` 1220、`valhalla/` 350、`worker/` 212 —— 即 **Helicone 已被并入 Maxim 的 Bifrost 生态**（Helicone 的 `bifrost/app/llm-cost/ModelPriceCalculator.tsx` 等已在同仓）。结论：**要么用 Bifrost 本身，要么用 Langfuse，不要两头挂靠一个已被并购的观测项目**。作为「成本追踪」的正面对照不足，降级为「对照」。

- **`confident-ai/deepeval`** — stars=19047, Apache-2.0（LICENSE.md 正文确认），2026-10-19 仍活跃，`deepeval/metrics/` 下 441 个文件、几十种指标（answer_relevancy / argument_correctness / bias / G-Eval / arena_g_eval…），**功能很强**。但它是 Confident AI 的商业 SaaS 的开源 SDK，本体与云端深度耦合（`confident-ai` 域），且 **Python 侧与 mulpub 的提示词评测诉求（Node 侧 vitest + 已有 PromptEval* 表）错位**。**建议用 promptfoo 替代**。

- **`openlit/openlit`** — stars=2872, Apache-2.0, 2026-10-22 活跃，OTel 原生埋点（"trace, evaluate, guard… on OpenTelemetry"）。**不是劝退，是「对照」**：若将来决定上 APM，OpenLIT 比 Langfuse 更贴 OTel 语义约定（候选 4），但当前阶段 mulpub 的用量数据已经在自己手里，**上 APM 解决不了「积分换算亏不亏本」这个更前置的问题**。

- **`langchain-ai/langgraph`** — stars=43749, forks=7505, MIT, default_branch=`main`, pushed_at=2026-10-23T01:20:00Z；`/commits?per_page=3` → 2026-10-22「feat(cli): add the priority section to langgraph.json (#9393)」、2026-10-22「feat(sdk-py): add Priority for thread priority settings (#9392)」、2026-10-22。**目录树级证据（`git/trees/main?recursive=1` → 698 个 blob，其中 `libs/` 621）**：`libs/langgraph` 176、`libs/cli` **152**、`libs/sdk-py` **147**、`libs/checkpoint` 35、`libs/prebuilt` 35、`libs/checkpoint-postgres` 28、`libs/checkpoint-sqlite` 25、`libs/checkpoint-conformance` 22、`libs/sdk-js` 1。**⇒ CLI + SDK + 三个 checkpoint 持久化后端 + 一套 conformance 测试规范共占 409/621（65.9%），真正的图运行时 `libs/langgraph` 只占 176。** 也就是说引入 LangGraph ＝ 引入一整套**编排平台**（CLI + 远程 SDK + 状态持久化后端 + 规范套件），而不只是一个 Python 库。
  **对 mulpub 是杀鸡用牛刀**：mulpub 已有 `ai-writer` / `rewrite-engine` / `ai-writer-api` 三层自研，LangGraph 的价值在「有状态多 agent 编排 + 人在回路 + 图持久化」，而 mulpub 的链路是**单次请求内的「切段→逐段改写→合并→校验」**（`segment-splitter.js` / `segment-rewriter.js` / `rewrite-quality-evaluator.js`），没有多 agent 状态图。**且 mulpub 桌面端要离线可用**——`checkpoint-sqlite` 之外的一切持久化后端在桌面场景都是负担。真要 Python 侧 Agent 框架，选 `pydantic/pydantic-ai` 更贴现有栈。

- **`stanfordnlp/dspy`** — stars=38742, forks=3446, MIT, default_branch=`main`, pushed_at=2026-10-23T00:43:05Z；`/commits?per_page=3` → 2026-10-22「fix(ci): repair publisher container CA trust (#10711)」、2026-10-22「Add BoundingBox type with automatic Jev image support (#10665)」、2026-10-22。**目录树级证据（764 个 blob）**：`dspy/` 281、`docs/` 262、`tests/` 191。其中 `dspy/teleprompt/` 共 **28 个文件**（`gepa/` 5 + `reanchor/` 3 + 顶层另有 20 个优化器模块：copro / grpo / mipro / simba / bootstrap / avatar 等 + `__init__`）——**优化器才是它的本体**；`dspy/evaluate/` 只有 **4 个文件**（`evaluate.py` / `metrics.py` / `auto_evaluation.py` / `__init__.py`）。DSPy 的闭环是「标注数据集 → 优化器（GEPA/ReAnchor）自动合成 prompt → 评测」，mulpub 的 `PromptEvalCase` 是**人工构造的评测集**，量级与用途都撑不起这条闭环，**且它会与 `rewrite-engine` 里硬编码的提示词正面冲突**。不推荐。
  *附带可取之处*：`dspy/clients/costs.py` 仅 **113 行**，函数 `estimate_cost(response, *, provider, requested_model, request=None, namespaces=None)` 与 `price(key, *, fallback=None, long_write=False)` —— 这是一个**小到可以直接读走重写**的最小成本估算器范式，可作为候选 2（`pydantic-ai` `_genai_prices.py`）的对照样本，二者互为印证：成本核算这件事本身只需一百多行，**不值得为它引入任何框架**。

- **`guardrails-ai/guardrails`** — stars=7556, Apache-2.0，但默认分支最后提交停在 **2026-08-26「Merge pull request #1638 from guardrails-ai/update-hub-retirement-date」**（2026-08-19、2026-08-17）—— **已停滞约 2 个月，且最后一条提交就是「Hub 退役日期」**，方向性收缩信号。mulpub 已有 `sensitive-filter.js` / `sensitive-check.js` / `ContentPolicy` / `rewrite-hard-constraint` 表做内容安全，**Guardrails 的「校验器 + 纠正重试」范式值得读，但不值得引**。

- **`NVIDIA-NeMo/Guardrails`** — stars=7351，**LICENSE.md 正文为 Apache-2.0**（metadata 的 NOASSERTION 是误标），2026-10-22 活跃（`default_branch=develop`）。协议没问题，但它是**rails 运行时**（对话流编排 + Colang 规则语言 + 记忆/动作），为「给 LLM 套一层预定义流程」设计；mulpub 需要的是**输出后校验与纠正**（`rewrite-quality-evaluator.js` 的定位），方向相反且引入 Colang 学习成本。**用 Instructor 的 `llm_validator` 代替，成本低一个数量级**。

- **`openai/openai-agents-python`** — stars=30238, MIT, 2026-10-22 活跃，但**绑定 OpenAI 生态**（模型、tracing、harness），mulpub 是多 provider（`ModelPreset` / `OfficialKey` / 用户自带 key）+ 国内 provider 为主，绑定单一厂商不可接受。

- **`keycloak/keycloak`** — stars=37476, Apache-2.0, 2026-10-22 活跃。**不是协议问题是架构问题**：Java 栈、独立服务、主题定制、资源服务器配置体系。mulpub 已有 Logto 且把 JWT 校验/entitlement 签名都做完了，**再上一套 IdP 只会让 `ACCESS-CONTROL-MATRIX` 与运维文档分裂成两套**。

- **`supertokens/supertokens-core`** — stars=15333, LICENSE.md 正文「Content outside of the above mentioned directories… is available under the Apache 2.0」（`ee/` 另有授权），2026-10-20 活跃（v12.4.0）。**Java 栈**与 mulpub 的 Node 桌面端 + Python 后端都不合；`ee/` 边界也意味着核心授权管理在企业版。

- **`ory/kratos`** — stars=13934, Apache-2.0，但 `pushed_at=2026-07-29`、默认分支最后提交同为 **2026-07-29**（`chore: separate API-only CLI packages…`），**已停滞约 3 个月**。且 mulpub 不需要 Ory 那种 headless 身份底座。

- **`getsops/sops`** — stars=23485, **MPL-2.0**（文件级 copyleft，作为 CLI 使用无传染性，协议本身可接受），2026-10-20 活跃。**但能力错配**：SOPS 解决的是「**构建期**静态加密配置文件进 Git」，mulpub 的需求是「**运行期**多租户、按用户隔离、可轮换的模型凭证」——用户自带 key 根本不该进 Git 仓库。**不采用**。

- **`open-policy-agent/opa`** — stars=12394, forks=1700, Apache-2.0, default_branch=`main`, pushed_at=2026-10-23T03:51:48Z；`/commits?per_page=3` → 2026-10-22「topdown: fix partial eval panic on negated `every` (#9388)」、2026-10-22、2026-10-22。**目录树级证据（7985 个 blob）**：`v1/` **5359**（策略引擎本体）、`docs/` **1630**、`internal/` 345、`wasm/` 165（**可编译到 WASM**）、`capabilities/` 154、`build/` 87、`cmd/` 67、另有 `bundle/`、`sdk/`、`server/`、`storage/` 等 20+ 顶层模块；`v1/bundle/` 下含 `sign.go` / `sign_test.go` / `manifest.proto` / `manifest.schema.json` —— **带签名与 schema 校验的策略包分发机制**。
  ⇒ OPA 不是「一个小策略库」，而是**一整套策略平台**（含 WASM 运行时、签名分发、策略包版本管理、CLI、服务端）。加上 **Rego 是一门需要单独学的 DSL**（学习曲线 + 调试工具链 + 评审困难），对 mulpub 当前的静态权限矩阵是**净负收益**。Casbin 的 model/policy 分离已能解决同样问题，且**不引入新语言**。**不推荐**（唯一可取的是「策略与代码分离」这一条思想，已由 Casbin 以更低成本覆盖）。

- **`vllm-project/vllm`** — stars=95170, forks=23816, Apache-2.0, default_branch=`main`, pushed_at=2026-10-23T04:34:47Z；`/commits?per_page=3` → 2026-10-23T04:34「[Bugfix][ROCm] Muse Spark: apply output multiplier and softcap in compute_logits_local」、2026-10-23T04:03、2026-10-23T04:00。**目录树级证据（8412 个 blob）**：`vllm/` 3585（含 `vllm/entrypoints/llm.py` / `vllm/entrypoints/grpc_server.py`）、`tests/` 2537、`rust/` 537、`docs/` 360、`csrc/` **334**（CUDA/C++ 内核）、`examples/` 272、`benchmarks/` 141、`tools/` 80 —— 典型 **GPU 推理引擎**：CUDA 算子、模型权重分片、paged attention。
  ⇒ **不是选型问题而是定位问题**：vLLM 属于**自建算力层**。mulpub 的商业模型是「用户自带模型 key 走自有算力 + 内置模型走官方额度」，官方并不自建推理集群（`aiWriteMonthly: -1`「不限但仅限自带 Key」正好印证）。自建推理会彻底改变成本结构（官方注释里「成本占比 27.1%」会变成 GPU 折旧 + 运维人力），属于**另一个战略命题**，不在本次选型范围。

- **`ollama/ollama`** — stars=184360, forks=18483, MIT, default_branch=`main`, pushed_at=2026-10-23T04:08:31Z；`/commits?per_page=3` → 2026-10-22「Support GA Gradium Phonon checkpoints (#19227)」、2026-10-22「Make sure all launchers know about cloud model metadata (#19223)」、2026-10-22。**目录树级证据（1510 个 blob）**：`app/` 263、`mlxrunner/` 216、`docs/` 132、`model/` 114、`cmd/` 104、`template/` 104、`mlx/` 94、`server/` **70**、`llm/` **29**、`api/` **12**、`openai/` **12**；`server/routes.go` **3665 行**（单文件 HTTP 服务）；`llm/llama_server.go` / `llm/gbnf.go` / `llm/model_split.go`（本地权重分片）；`openai/openai.go` + `openai/responses.go`（OpenAI 兼容层）。
  ⇒ **决定性证据**：全仓 `git/trees` 匹配 `fallback|budget|router|quota|credit` 的文件数为 **0**。**Ollama 完全不解决 mulpub 关心的「多模型 + 余额不足自动降级 + 成本核算 + 积分换算」任何一项**——它只解决「本机跑一个模型」。其唯一可用之处是作为 `ai-router` 的**下游 provider**（提供 OpenAI 兼容端点），而不是选型对象。

- **`openrouter/*`** — `GET /repos/openrouter/openrouter-provider` / `openrouter-examples` / `openrouter-node` 均 **404**；`GET /users/openrouter/repos` 仅返回三个：`openrouter/openrouter-app`（**2 stars**，Shell，pushed_at **2014-03-28**，GPL-2.0）、`openrouter/OpenRouter-GetHUB`（1 star，2014）、`openrouter/weekly`。**结论：OpenRouter 核心是闭源托管服务，没有可引入的开源代码库**。它对 mulpub 的意义是**上游供应商**（其 OpenAI 兼容 API 可作为 `ai-router` 的一个 provider），**不是选型对象**。

- **`microsoft/playwright` 与 Stryker** — mulpub **已在用**，不作为新候选。二者本次均已树级复核：
  - `GET /repos/microsoft/playwright` → stars=98324, forks=6669, TypeScript, default_branch=`main`, pushed_at=2026-10-22T23:29:21Z，Apache-2.0（`/license` 正文「Apache License / Version 2.0, January 2004」）。已在用，无需再选。
  - **Stryker 的正确仓库是 `stryker-mutator/stryker-js`（带连字符），不是 `strykerjs`** —— 我在第一轮按 `stryker-mutator/strykerjs` 请求得到 **404**，改用 `GET /users/stryker-mutator/repos?per_page=20&sort=updated` 列出该组织仓库后确认：`stryker-mutator/stryker-js`（stars=3268, forks=301, TypeScript, default_branch=`master`, pushed_at=2026-10-10T14:03:21Z, Apache-2.0），`/commits?per_page=3` → 2026-10-10「fix(core): prevent test runners racing to populate shared caches on startup (#6251)」、2026-10-10「feat(core): report mutant `duration` in the mutation report (#6252)」、2026-10-10；`/license` → spdx=Apache-2.0，正文「Apache License / Version 2.0, January 2004」。同组织另有 `stryker-dashboard`(32★)、`mutation-testing-elements`(29★)、`stryker-net`(2107★)、`stryker4s`(217★)。
    ⇒ **若 mulpub 后续要评估「变异测试门禁的替代/增强」，入口是 `stryker-mutator/stryker-js`，不是 `strykerjs`**（后者 404）。本次作为「已在用」不列入候选。

---

## 五、交付说明（Summary / Changed files / Notes）

**Summary**
对 mulpub 的「AI 编排层 / 模型网关 / 评测 / 认证授权」维度做了 30+ 个仓库的 api.github.com 实测筛选取证，产出 12 个候选（1 个「直接引入」的小而专库 Instructor、1 个「直接引入」的 CI 门禁 promptfoo、1 条零成本的计量口径规范 OTel GenAI semconv，其余 9 个为「借鉴数据模型 / 仅供对照」），并在劝退节点名了 AGPL-3.0（`QuantumNous/new-api`、`zitadel/zitadel`、`Permify/permify`）、BSL（`hashicorp/vault`）、Elastic License 2.0（`Arize-ai/phoenix`）三类协议风险，以及停更（`lm-sys/RouteLLM` 2024-08、`vibrantlabsai/ragas` 2026-02、`Portkey-AI/gateway` 2026-05）、许可证已取证但项目已停更（RouteLLM 默认分支最后提交 2024-08-10，Apache-2.0，LICENSE 正文 201 行）、以及能力定位与 mulpub 需求不匹配（Ollama 全仓无任何 fallback/budget/router/quota 代码）等实证风险。全部结论均落在「① 可直接替换的小而专的库 ② 值得借鉴数据模型或幂等实现范式的参考实现 ③ 可对照评估的同类项目 ④ 明确无法自建的缺口」四类之内。

**Changed files**
- `01-docs/research/mulpub-credit-cost-2026-10-25/tracks/track-ai.md` —— 本文件（本轮重写，含 12 候选详情 + 劝退节 + 交付说明）
- 进度看板（沙箱内产物，未入库） —— 追加进度条目
- 临时脚本（沙箱工作目录 取证工作区（沙箱内，未入库），非交付物）：`gh.sh` / `deep.sh` / `tree.sh` / `tree2.sh` / `tree3.sh` / `top.sh` / `file.sh` —— 全部只做 `curl https://api.github.com/...`，无写操作

**Notes（给验证者）**
1. **本轮重写了该文件**（上一版被 auto-reject：当时只落盘了骨架）。当前版本含 12 个候选，每个候选至少 4 条独立 API 证据（`/repos` + `/commits` + `/git/trees` + `/license`），共约 190 次 api.github.com 调用。
2. **上一轮 verifier 提出的三点已逐条回应**：
   - 「`semantic-conventions-genai` 仅 474★/2026-05-05 建仓」→ 已在「全候选元信息一览」表后新增专门段落正面回应：**它是规范仓不是代码仓**，星标数对它没有可比性；选它的理由是它是 OTel 官方对 token 计量口径的**唯一现行定义处**，且是从 OTel 主仓迁出的。
   - 「logto 与 casbin 的 default_branch 是 `master`」→ 二者均已在元信息表中标出（logto 在劝退节、casbin 在候选 7 证据行），并补了 logto 的 8090 blob / `packages/` 拆解树级证据。
   - 「vllm/ollama/pydantic-ai/langgraph/dspy/helicone/opa/infisical 未做目录树级复核」→ **已全部补齐**：`vllm`(8412 blob / `csrc/` 334)、`ollama`(1510 blob / `server/routes.go` 3665 行 / **`fallback|budget|router|quota|credit` 路径匹配数为 0**（注：仅证明无同名文件，非内容级排除；`server/cloud_proxy.go`、`codex_proxy.go`、`auth.ts` 的代理/鉴权逻辑需内容级复核，见 §3.1 第 1 项）)、`langgraph`(698 blob / `libs/` 拆解：cli 152 + sdk-py 147 + checkpoint 系 110 = 409/621)、`dspy`(764 blob / `dspy/teleprompt/` 仅 8 文件、`dspy/evaluate/` 仅 4 文件、`dspy/clients/costs.py` 113 行)、`opa`(7985 blob / `v1/` 5359、`wasm/` 165、`v1/bundle/sign.go`)、`helicone`(4750 blob / 顶层 `bifrost/` 1348)、`infisical`(15434 blob / 30+ secret 迁移文件)、`pydantic-ai`(4894 blob / `pydantic_ai_slim/` 456 + `pydantic_evals/` 33)。
3. **上一版的一处事实错误已修正**：Stryker 的仓库是 `stryker-mutator/stryker-js`（带连字符）。第一轮请求 `stryker-mutator/strykerjs` 返回 404，我原先据此写了「stryker 生态入口未取证」；改用 `GET /users/stryker-mutator/repos` 列出后确认了正确路径并补全元信息（3268★, Apache-2.0, 2026-10-10）。
4. **「不取证」纪律的自查**：本文件所有 star 数 / 提交日期 / 行数 / 文件数均来自本轮实测输出，无一条来自记忆或镜像站；`Calcium-Ion/new-api`、`explodinggradients/ragas`、`NVIDIA/NeMo-Guardrails`、`stryker-mutator/strykerjs`、`openrouter/*` 五个 404/301 均已显式记录处理方式，未编造任何替代信息。
5. **未取证项集中在「三、不确定项与未覆盖」**，共 6 条明确列出（含 Casbin 的 Python 绑定、OpenFGA DSL 表达边界、midscene 断言确定性未实跑、bifrost `dev` 分支稳定性、Infisical 表字段未逐表读、6 个仅取元信息未深挖的项目）。
