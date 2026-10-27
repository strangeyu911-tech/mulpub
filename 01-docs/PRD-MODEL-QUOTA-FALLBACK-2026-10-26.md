# PRD：模型额度用尽时的来源切换策略（model-quota-fallback）

> **文档性质**：产品需求 + 决策记录（PRD）。本文件是「用户自带模型 Key（BYOK）」与「平台官方模型（消耗官方积分）」之间**优先级与切换控制**的单一真源。
> **状态**：🚧 **P1a 已实现**；**P1b-1 后端决策层已实现**；**P1b-2a 设置 IPC/preload + 策略卡片已实现**；**P1b-2b 兜底弹窗 + App 根层 + composable 已实现**；**P1b-2c1 生产运行时 + IPC 接线 + run 生命周期已实现**，**P1b-2c2 业务域调用边界接入未实现**；P2/P3 未实现。P1b-1 见 §13.2，P1b-2a 见 §13.3，P1b-2b 见 §13.4，P1b-2c1 见 §13.5 与 `openspec/records/model-quota-p1b2c1.md`。官方兜底仍受 D-11 约束（官方算力代理 D-① 未落地，官方按钮禁用、卡片默认隐藏）。
> **关联设计**：`01-docs/DESIGN-MODEL-QUOTA-FALLBACK-2026-10-26.md`
> **上游依赖**：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（D-① 官方算力代理，**未落地**）、`01-docs/PRD-CREDIT-CONSUME-API-2026-10-25.md`（扣分端点，已实现）、`01-docs/PRD-OFFICIAL-COMPUTE-CHARGE-STATE-2026-10-25.md`（扣分状态机，已实现）
> **日期**：2026-10-26

---

## 0. TL;DR（先回答三个问题）

| # | 用户问题 | 结论 |
|---|---|---|
| Q1 | 用户自己的模型额度用光时，连接外部 API 能拿到错误码并明确告知「到期 / 没额度」吗？ | **能，但不保证每家供应商都给可区分的错误码。** 桌面端已经在适配器层把 401/402/429、MiniMax 业务码 1004/2056 等归一为 `ProviderError`；本方案再补一层**稳定的产品级错误状态**（`quota_exhausted` / `credential_invalid` / `rate_limited` / `transient` / `unknown`），并**只在证据足够时**说「额度用尽 / 凭据失效」；拿不到明确证据时按保守类别处理，绝不猜。|
| Q2 | 如果用户选择使用官方模型，之后的调用控制怎么处理？一直默认用官方积分，还是继续用用户自己的模型？ | **两者都不是。** 推荐 **「BYOK 永远优先 + 官方仅作任务级兜底」**：① 新任务永远先走用户自己的模型；② 额度错误只把**当前任务**后续调用切到官方模型；③ 切换不修改用户「默认模型」设置；④ 任务结束/下次新建任务自动回到 BYOK；⑤ 是否自动切、是否每次询问，由用户设置决定。**不把官方模型变成全局默认**，避免用户在不知情下持续消耗积分。|
| Q3 | 是否需要增加一个设置，让用户自己决定？ | **需要。** 设置项 `modelQuotaFallbackPolicy` 三档：`ask`（默认，每次询问）/ `official`（额度错误时自动用官方模型兜底）/ `byok`（绝不自动用官方，提示充值或更新设置）。但**设置项上线必须与官方模型调用链路同批**——在官方供给未落地前只上线一个点了没反应的开关，比没有更糟。|

---

## 1. 背景与现状

### 1.1 两类模型来源

| 来源 | 凭据 | 成本承担 | 当前状态 |
|---|---|---|---|
| **用户自带模型（BYOK）** | 用户在「设置 → 模型设置」填写的 API Key，经 `safeStorage` 加密存储 | 用户自己的模型账号/套餐 | ✅ 已落地，7 类模型、多个预设供应商 |
| **平台官方模型（官方算力）** | 平台 `official_keys` Key 池，客户端**不持有**官方 Key | 平台成本，按价格卡折算**官方积分**扣减 | ⛔ **未落地**：官方算力代理 `POST /api/v1/compute/execute` 仍属 D-① 待实现；余额读通道（U-13）、视频/图像/TTS/ASR 价格卡（U-12）未闭环 |

### 1.2 现状不是「没有错误码」，而是「错误码没有变成用户可决策的动作」

现状链路（已实现的部分）：

```
provider adapter
  → ProviderError(code, message, { providerId, statusCode })
  → ModelProviderManager.callAdapter() 返回 { code:-1, error, message }
  → ProviderRunContext.openIfQuota() 在本次运行内熔断该 provider
  → 各业务域自己的提示（story2video / 改写 / 热榜 / 电影工程…）
```

已具备的能力：

- `provider-error.js` 已把 401/403 → `AUTH_FAILED`、402 → `QUOTA_EXCEEDED`、429 → `RATE_LIMITED`，并用文本模式区分 `quota` 与 `rate`（`classifyProviderFailure`）。
- MiniMax 这类 **HTTP 200 + `base_resp.status_code`** 的供应商，适配器已解析业务码：`1004` = 认证失败、`2056` = 额度/套餐问题（见 `minimax-image.js`、`minimax-tts.js` 及其测试）。
- `ProviderRunContext` 已支持「本次运行内额度熔断」，避免对同一个已耗尽额度的 provider 连续打请求。
- `story2video-notifications` 等域已有「额度或余额已用完」的本地化文案。

缺口：

| 缺口 | 后果 |
|---|---|
| 没有统一的**产品级错误状态**（`quota_exhausted` / `credential_invalid` 等） | 各业务域各写一套文案，同一错误在不同页面说法不一致 |
| `ProviderError.context.statusCode` 把 **HTTP 状态码**与 **供应商业务码**混在一起 | 无法稳定展示「HTTP 402」与「MiniMax 2056」两个维度，排障困难 |
| 没有「使用官方模型继续」的可执行路径 | 用户只能自己去充值/换 Key，任务中断 |
| 没有「任务级来源覆盖」 | 若未来直接改默认 provider，会污染用户设置，下一次任务仍在用官方积分 |
| 没有用户偏好设置 | 每次额度错误都要重新问，或产品替用户做花钱决定 |

### 1.3 用户原话（需求输入）

> 「模型使用的优先级，需要确定逻辑。因为存在两类消耗方式，一个是用户配置的自己外部订阅的模型的 key，一个是系统内置的模型资源（消耗积分）。如果用户自己配置的模型的额度用光了，连接外部模型 API（用户自己配置的）时是否能获取相应错误码提示，而明确告知用户配置的模型到期或是没有额度了，同时询问用户是否使用官方内置 AI 模型（消耗汤姆鱼积分）？如果可以，而且用户选择了使用官方模型。那么之后的模型调用控制应该怎么处理合适？是一直默认使用官方积分，还是继续使用用户自己的配置模型，提示用户对自己的模型进行充值或更新设置？是否需要增加一个设置，让用户自己来设置这种情况的决定？」

---

## 2. 目标与非目标

### 2.1 目标

1. **说得清**：额度/凭据类失败必须给出稳定、可区分、可操作的用户提示，不再只说「请检查模型设置」。
2. **不误伤**：限流、网络、内容安全、未知错误**不得**被误判成额度不足，更不得自动切官方模型。
3. **不擅自花钱**：默认每次询问；自动切官方必须由用户显式设置，并且有任务级积分上限。
4. **不污染设置**：官方兜底只作用于当前任务，不修改用户的默认模型/默认 provider。
5. **可恢复**：任务在切换前落检查点；用户充值/换 Key 后可继续；官方失败不无限重试。
6. **可审计**：每次来源切换都有结构化记录（原因、错误状态、provider、模型、是否用户选择、是否扣分）。

### 2.2 非目标（本 PRD 明确不做）

| 不做 | 原因 |
|---|---|
| 在官方算力代理 D-① 落地前实现「切官方模型」 | 没有服务端代调通道；客户端不能持有官方 Key（安全红线） |
| 把官方模型变成全局默认来源 | 会造成用户不知情持续扣积分；与 BYOK 优先定位冲突 |
| BYOK 多供应商之间的自动 failover | 与「官方兜底」是两件事；`ProviderRouter.useFailover` 生产零接线，另立 change |
| 官方模型的 LLM（文字推理）供给 | 当前官方算力设计只覆盖视频/图像/TTS/ASR；LLM 官方供给属未决项 U-1 |
| 自动充值、自动续费、自动升级套餐 | 支付链路与用户授权是独立域 |
| 跨任务记住「本次用官方」 | 只记住**策略偏好**（设置），不记住**任务级来源**；避免上一任务的临时选择影响下一任务 |

---

## 3. 术语与状态

### 3.1 模型来源（source）

| 值 | 含义 |
|---|---|
| `byok` | 用户自带 Key 的模型调用 |
| `official` | 平台官方模型（官方算力，扣官方积分） |

### 3.2 失败状态（accessState）

| 值 | 含义 | 是否可兜底官方 | 是否允许自动（policy=official） |
|---|---|---|---|
| `quota_exhausted` | 额度/余额/套餐用量耗尽，或套餐到期 | ✅ | ✅ 可以（有上限守卫） |
| `credential_invalid` | Key 无效、被撤销、认证失败；**无法区分「过期」与「填错」** | ✅ 但仅询问 | ❌ **永远询问**（可能是填错/安全事件，不能自动花钱） |
| `rate_limited` | 频率/并发限流，等待可恢复 | ❌ | ❌ |
| `transient` | 超时、网络、5xx 抖动 | ❌ | ❌（走原有重试） |
| `content_policy` | 内容安全拒绝 | ❌ | ❌ |
| `provider_error` | 其他供应商错误 | ❌ | ❌ |
| `unknown` | 证据不足 | ❌ | ❌（保守） |

### 3.3 额度子类（quotaKind）

| 值 | 含义 | 文案差异 |
|---|---|---|
| `balance` | 余额/充值额度不足 | 提示充值 |
| `plan_window` | 套餐的 5 小时/日/月窗口用量耗尽 | 提示等待窗口恢复或升级套餐 |
| `plan_expired` | 套餐到期 | 提示续费/升级 |
| `unknown` | 只知道是额度问题 | 提示检查套餐额度，不承诺恢复时间 |

> **判定纪律**：`quotaKind` 只能从**供应商明确信号**推导；推导不出就用 `unknown`。**不得**根据「429」猜 `plan_window`，也不得根据「402」猜 `balance`。

### 3.4 运行态来源覆盖（run override）

```
runContext.modelSourceOverrides = {
  [capability]: {
    source: 'official',
    decidedAt: 1761480000000,
    decision: 'user' | 'policy',
    reason: 'quota_exhausted',
    originalProviderId: 'minimax-multimodal',
    officialAttempts: 1
  }
}
```

- 作用域：**单个 pipeline run**（内存 + 检查点），不是全局设置。
- 生命周期：run 结束即失效；新 run 从 BYOK 开始。
- 不写入 `model_providers` 表，不改 `is_default` / `user_default_model`。

---

## 4. 决策（D-01 ~ D-12）

| # | 决策 | 理由 | 替代方案（为什么不选） |
|---|---|---|---|
| **D-01** | **BYOK 永远优先**：任何新任务先走用户当前默认模型；官方模型只在 BYOK 失败且满足条件时兜底 | 用户自己的套餐是沉没成本，先用；平台不主动增加用户成本 | 「官方优先」会让 BYOK 用户白买套餐；「按价格选便宜」会不可预测 |
| **D-02** | **官方兜底是任务级覆盖，不是全局切换** | 一次额度错误不代表用户想永久换模型；任务级可控、可回滚 | 改默认 provider → 污染设置；下次任务静默扣积分 |
| **D-03** | 默认策略 `ask`：首次额度错误弹窗询问，用户可选「官方继续 / 去更新设置 / 取消」 | 花钱必须知情；默认最安全 | 默认 `official` → 用户不知情扣积分；默认 `byok` → 每次都中断，体验差 |
| **D-04** | 设置项 `modelQuotaFallbackPolicy` 三档：`ask` / `official` / `byok`；**只控制兜底行为，不控制主来源** | 满足不同用户偏好；`official` 也不改变 BYOK 优先 | 只做二档（是/否）无法表达「每次都问」；做「官方优先」超出本需求 |
| **D-05** | `official` 档也**不自动改默认模型**；每个新任务仍先试 BYOK | 防止一次设置导致长期扣积分 | 设为默认官方 → 违背 BYOK 优先定位 |
| **D-06** | `credential_invalid` **永远询问**，即使 policy=`official` | 401/403 可能是 Key 填错/被撤销，自动切官方会掩盖配置错误并花钱 | 自动切 → 用户永远不知道自己的 Key 坏了 |
| **D-07** | `rate_limited` / `transient` / `content_policy` / `unknown` **不兜底**，走原有重试/提示 | 这些不是额度问题；误兜底会绕过限流、重复计费 | 全部兜底 → 成本失控、掩盖真实故障 |
| **D-08** | 自动兜底必须有**任务级积分上限** `officialCreditCapPerTask`（默认 500，范围 1–100000）；预估消耗超过上限则降级为询问 | 防止一个长任务把积分跑光 | 无上限 → 用户设置一次后被大任务扣爆 |
| **D-09** | 切换前必须**落检查点**；切换只发生在**下一次调用之前**，不重试已经产生部分输出的调用 | 避免重复生成/重复扣费 | 失败后原地重试 → 可能已扣上游费用，再调一次双倍 |
| **D-10** | 官方调用使用 `byok=0` 标记 + 幂等键 `runId:stage:attempt`；失败不自动换回 BYOK 再试 | 成本归属正确；幂等防重复扣分；避免来回横跳 | 失败后回 BYOK → 可能再次触发同一额度错误，死循环 |
| **D-11** | 官方供给未落地前**不上线设置项与「使用官方模型」按钮** | 避免空承诺；设置项必须真实可执行 | 先上 UI 后补链路 → 用户点了没反应，比没有更差 |
| **D-12** | 错误提示必须区分「能确定的」与「不能确定的」：不能确定时只说「额度或凭据异常，请检查」，**不编造**「已到期」「X 小时后恢复」 | 供应商错误码不统一；错误归因错误会引发客诉 | 统一说「额度用完」→ 把限流/网络误报成额度，用户充值也解决不了 |

---

## 5. 功能逻辑

### 5.1 错误识别：能不能拿到错误码？

#### 5.1.1 统一判定顺序（单一真源）

```
输入：ProviderError 或普通 Error + 可选 response headers/body
  ① 结构化 HTTP 状态：
       401/403 → credential_invalid（若文本明确 plan expired/套餐到期 → quota_exhausted/plan_expired）
       402     → quota_exhausted（quotaKind 由文本决定）
       429     → 先看文本/业务码：命中额度语义 → quota_exhausted；否则 → rate_limited
       5xx/0   → transient
  ② 供应商业务码（HTTP 200 也可能有）：
       MiniMax 1004 → credential_invalid；2056 → quota_exhausted
       OpenAI insufficient_quota / billing_hard_limit_reached → quota_exhausted/balance
       Anthropic credit balance is too low → quota_exhausted/balance
       Gemini RESOURCE_EXHAUSTED → 按 quotaId 细分；无细分 → quota_exhausted/unknown
  ③ 文本兜底（仅在①②都未给出明确类别时）：
       额度/余额/quota/balance/credit/套餐到期/用量上限 → quota_exhausted
       rate limit/too many requests/限流 → rate_limited
       invalid/expired/unauthorized/认证失败 → credential_invalid
       超时/网络/5xx → transient
  ④ 都没有 → unknown（不兜底）
```

**硬规则**：
- 文本兜底**不能覆盖**已经明确的结构化非额度码。例如：`429 + rate_limit_error` 即使文本里带「额度」二字，也优先按 429 的 `rate_limit_error` 判 `rate_limited`（避免把限流误判成额度）。
- `401/403` 即使文本带「额度已用完」，也先按认证失败处理；但 MiniMax 的「API Key 额度已用完，请升级套餐」是**额度**，必须按业务码/文本邻近判定（现有 `minimax-image.js:204-207` 已处理这个陷阱，新分类器必须复用同一判据）。
- 任何分类器**不得**把 API Key、完整响应体、请求头写进日志或用户提示。

#### 5.1.2 已知供应商错误码映射表

> 下表是**已知形态**，不是供应商契约承诺。实现时以「结构化码优先、文本兜底、未知保守」为准；新增供应商必须在 `provider-error` 的测试里补一行用例。

| 供应商 | HTTP | 业务码/类型 | 典型文本 | 映射 | quotaKind | 可兜底 |
|---|---|---|---|---|---|---|
| OpenAI | 429 | `insufficient_quota` | "You exceeded your current quota" | `quota_exhausted` | `balance` | ✅ |
| OpenAI | 429 | `rate_limit_exceeded` | "Rate limit reached" | `rate_limited` | — | ❌ |
| OpenAI | 401 | `invalid_api_key` | "Incorrect API key" | `credential_invalid` | — | 仅询问 |
| OpenAI | 403 | `account_deactivated` | "account deactivated" | `credential_invalid` | — | 仅询问 |
| Anthropic | 400 | `invalid_request_error` | "Your credit balance is too low" | `quota_exhausted` | `balance` | ✅ |
| Anthropic | 401 | `authentication_error` | "invalid x-api-key" | `credential_invalid` | — | 仅询问 |
| Anthropic | 429 | `rate_limit_error` | "Number of requests exceeded" | `rate_limited` | — | ❌ |
| Gemini | 429 | `RESOURCE_EXHAUSTED` | "Quota exceeded" | `quota_exhausted` | `unknown`（有 `quotaId` 再细分） | ✅ |
| Gemini | 400 | `API_KEY_INVALID` | "API key not valid" | `credential_invalid` | — | 仅询问 |
| Gemini | 403 | `PERMISSION_DENIED` | "Permission denied" | `credential_invalid` | — | 仅询问 |
| DeepSeek | 402 | `Insufficient Balance` | "Insufficient Balance" | `quota_exhausted` | `balance` | ✅ |
| DeepSeek | 401 | `Authentication Fails` | "Authentication Fails" | `credential_invalid` | — | 仅询问 |
| DeepSeek | 429 | `Rate Limit Reached` | "Rate Limit Reached" | `rate_limited` | — | ❌ |
| MiniMax | 200 | `base_resp.status_code=1004` | "Invalid api key" / "Authentication failed" | `credential_invalid` | — | 仅询问 |
| MiniMax | 200 | `base_resp.status_code=2056` | "已达到 Token Plan 用量上限" / "plan has expired" | `quota_exhausted` | `plan_window` / `plan_expired` | ✅ |
| MiniMax | 429 | — | "rate limit" | `rate_limited` | — | ❌ |
| OpenRouter | 402 | `Insufficient credits` | "Insufficient credits" | `quota_exhausted` | `balance` | ✅ |
| OpenRouter | 429 | — | "rate limit" | `rate_limited` | — | ❌ |
| 其他 OpenAI 兼容 | 402 | — | 含额度语义 | `quota_exhausted` | `unknown` | ✅ |
| 其他 OpenAI 兼容 | 401/403 | — | 认证语义 | `credential_invalid` | — | 仅询问 |

> **MiniMax 业务码说明**：`1004` 与 `2056` 来自仓内现有适配器与测试（`minimax-image.test.js:322-418`），不是本文臆造。新增 MiniMax 端点必须复用同一 `classifyBaseRespError` 口径，不得各写一份。

#### 5.1.3 拿不到明确错误码时怎么办

| 场景 | 产品行为 |
|---|---|
| 供应商只返回 429 "Too Many Requests"，没有任何额度语义 | 判 `rate_limited`：提示「请求过于频繁，请稍后重试」，**不给官方按钮** |
| 供应商只返回 401 "Unauthorized"，不区分过期/填错 | 判 `credential_invalid`：提示「API Key 无效或已过期」，给「更新模型设置」；官方按钮**仅在政策允许时显示，且必须询问** |
| 供应商返回 400 泛化错误，文本含 "quota" 之外无信息 | 判 `provider_error`：提示原始原因（脱敏），不给官方按钮 |
| 供应商返回 200 但业务码未知 | 判 `unknown`：提示「模型账号返回未知错误（{providerCode}）」，不给官方按钮 |
| 同一错误在不同适配器里文本不同 | 以适配器归一化后的 `ProviderError.code` 为准；文本只做兜底 |

**结论**：不能承诺「100% 拿到额度错误码」，但可以承诺「**能识别的绝不漏报，识别不了的绝不误报**」。

### 5.2 来源优先级（用户可感知的顺序）

```
① 用户在本次调用显式指定的 provider/model（如视频创作下拉里手动选的）
② 用户在「模型设置」里设为默认的 provider/model（含多模态能力默认）
③ 任务级来源覆盖（仅当本任务已由用户/策略切到官方）
④ 官方模型兜底（仅额度/凭据失败 + 政策允许 + 供给可用）
⑤ 失败并给出可操作提示（更新设置 / 充值 / 等待 / 取消）
```

> 注意：③ 在**同一任务**内优先于 ①/②，因为用户已经明确选择「本任务用官方继续」；但**新任务**没有 ③，所以回到 ①/②。
> 官方模型**永远不进入** ①②——它不是「默认模型」，只是 ④ 兜底。

### 5.3 决策状态机

```
                    ┌─────────────────────────────┐
                    │ BYOK 调用失败                │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │ 分类 accessState             │
                    └──────────────┬──────────────┘
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                     ▼
   rate/transient/          quota_exhausted       credential_invalid
   content/unknown                │                     │
             │                    │                     │
             ▼                    ▼                     ▼
     原有重试/提示          policy?               永远 ask
     （不兜底）        ┌───────┼───────┐              │
                       ▼       ▼       ▼              ▼
                    ask    official  byok      弹窗（仅询问）
                       │       │       │              │
                       ▼       ▼       ▼              ▼
                    弹窗   官方可用?  停止+引导     用户选择
                       │       │
                 ┌─────┴─┐  ┌──┴──┐
                 ▼       ▼  ▼     ▼
              官方    去设置 是    否
                 │       │  │     │
                 ▼       ▼  ▼     ▼
              任务级   暂停 任务级 停止+引导
              覆盖     任务 覆盖
                 │
                 ▼
          扣积分上限校验
                 │
        ┌────────┴────────┐
        ▼                 ▼
   预估≤上限          预估>上限
        │                 │
        ▼                 ▼
   切官方继续         降级为询问
```

**关键不变量**：
- 一次失败只触发一次决策；并发失败共享同一个 decision Promise，不弹多个窗。
- 同一任务同一能力最多自动切官方 **1 次**；官方失败后不再自动换回 BYOK 重试。
- 决策前必须落检查点；决策后写 `modelSourceOverrides`。
- 用户选择「取消」→ 任务进入 `paused`（不是 `failed`），保留进度。

### 5.4 用户选择官方后的调用控制（本 PRD 的核心）

| 时间点 | 行为 |
|---|---|
| **当前任务后续调用** | 同一能力的所有后续调用走官方模型；不同能力独立决策（例如图片切官方，TTS 仍用 BYOK） |
| **当前任务已完成的调用** | 不重跑、不重复计费；只影响未开始的调用 |
| **当前任务切回** | 用户可在任务详情点「切回我的模型」；只影响后续未开始调用；已完成的官方调用不回滚 |
| **当前任务结束** | 覆盖失效；任务详情保留「本次任务使用过官方模型」记录 |
| **新建任务** | 从 BYOK 重新开始；**不继承**上一任务的官方覆盖 |
| **用户修改默认模型** | 立即影响新任务；不影响正在运行任务的已生效覆盖 |
| **断点续跑** | 检查点里的 `modelSourceOverrides` 生效：上次切了官方，续跑继续官方；续跑页显示「本任务上次已切换到官方模型」 |
| **用户关闭应用/重启** | 运行态覆盖丢失（run 已结束）；已完成任务的记录保留在 run 记录里；新任务 BYOK |

**为什么不是「一直默认官方」**：
- 官方模型是**兜底**，不是用户购买的主模型；长期默认会与「自带 Key」定位冲突。
- 积分是预付/赠送资源，用户可能只想在紧急时用；默认官方会造成「不知不觉花完」。
- 用户如果确实想长期用官方，应通过设置 `official` + 明确的产品入口（后续可做「模型来源」总开关），而不是靠一次错误后的临时选择。

**为什么不是「继续用用户模型直到充值」**：
- 任务会中断，用户体验差；尤其视频生成这种长任务，重跑成本高。
- 用户可能当下无法立刻充值（外部供应商账单/公司审批），官方兜底是合理的应急路径。

### 5.5 设置项：`modelQuotaFallbackPolicy`

| 值 | 显示名（zh） | 显示名（en） | 行为 |
|---|---|---|---|
| `ask` | 每次询问（推荐） | Ask every time (recommended) | 额度/凭据错误时弹窗；用户每次选择 |
| `official` | 额度用尽时自动使用官方模型 | Use official model automatically when quota runs out | 仅 `quota_exhausted` 自动切；受任务级积分上限约束；`credential_invalid` 仍询问 |
| `byok` | 仅使用我的模型（不自动用官方） | Use my own model only | 不切官方；提示充值/更新设置；任务暂停 |

**默认值**：`ask`。
**存储**：本地 `settings` 表，key = `modelQuotaFallbackPolicy`，字符串。
**作用域**：全局（所有能力共用一档）；v1 不做按能力/provider 分别设置。
**生效时机**：每次决策时实时读取；修改后不影响已生效的任务级覆盖，只影响下一次决策。
**校验**：非字符串、空串、未知值 → 归一为 `ask`，并写一条 WARN 日志（只写一次，避免刷屏）。

### 5.6 任务级积分上限 `officialCreditCapPerTask`

| 项 | 值 |
|---|---|
| 类型 | 整数（官方积分） |
| 默认 | `500` |
| 范围 | `1`–`100000`；`0` 表示「不限制」但**默认不允许**，需高级设置显式开启 |
| 校验 | 非整数/负数/超范围 → 回落默认 500，并 WARN |
| 作用 | 自动兜底前检查「本次预估消耗 ≤ 上限」；超过则降级为询问；询问时显示「预计消耗 X，超过本任务上限 Y」 |
| 累计 | 按任务累计，不是按单次调用；已消耗接近上限时下一次调用前再次询问 |
| 未知预估 | 预估为 `unknown` 时**不自动切**，必须询问；询问文案不承诺精确值 |

> 该设置是 `official` 档的安全阀；`ask` 档也显示上限，用于弹窗里的提示。

### 5.7 与检查点 / 断点续跑

| 场景 | 行为 |
|---|---|
| 决策前 | 保存当前 stage checkpoint（已完成产物、当前 scene、attempt） |
| 决策为官方 | checkpoint 写入 `modelSourceOverrides[capability] = {source:'official', ...}` |
| 续跑 | 读取覆盖；若覆盖存在且官方仍可用 → 直接走官方，不再询问；若官方不可用 → 提示「本任务上次选择的官方模型当前不可用」，给「重试 / 切回我的模型 / 取消」 |
| 续跑时用户已充值 | 用户可点「切回我的模型」，清除覆盖，后续调用回 BYOK |
| 续跑时 policy 已改 | 任务级覆盖优先；policy 只影响新决策 |
| 取消 | 任务 `paused`，checkpoint 保留；不写官方覆盖 |

### 5.8 与限流、重试、熔断的关系

| 机制 | 交互 |
|---|---|
| `ProviderRunContext.openIfQuota` | 额度错误仍照旧熔断该 provider，防止后续无意义请求；官方兜底是绕过该 provider 的另一条供给链，不解除熔断 |
| 限流重试（429/503） | 保持原逻辑；**不触发**官方兜底 |
| 内容安全重试 | 保持原逻辑；**不触发**官方兜底 |
| 官方调用失败 | 不自动换回 BYOK；按官方错误类型提示；同一任务不再自动重试官方（用户可手动重试） |
| 官方扣分失败 | 按 `DESIGN-OFFICIAL-COMPUTE-WIRING` §8.2 的「结算中 / 补扣」口径；**不得**显示「已扣除」当扣分未成功 |

---

## 6. 数据模型与校验

### 6.1 设置结构

```json
{
  "modelQuotaFallbackPolicy": "ask",
  "officialCreditCapPerTask": 500
}
```

- 存储位置：`settings` 表（本地 SQLite），通过既有 `storeGetSetting` / `storeSetSetting`。
- 不新增 provider 表字段；不修改 `model_providers.config`。
- 未来如需按能力配置，另立 `modelQuotaFallbackPolicyByCapability`，本版不做。

### 6.2 运行态覆盖（不落 settings）

```js
// ProviderRunContext 扩展（内存 WeakMap，随 run 生命周期）
{
  modelSourceOverrides: Map<capability, {
    source: 'official',
    decidedAt: number,
    decision: 'user' | 'policy',
    reason: 'quota_exhausted' | 'credential_invalid',
    originalProviderId: string,
    officialAttempts: number,
    creditCap: number
  }>
}
```

- `capability` ∈ `llm | tts | speech_recognition | image | video | audio`（与 `MULTIMODAL_CAPABILITY_IDS` 同源）。
- 不持久化到 `model_providers`；检查点里只写必要字段（`source`、`originalProviderId`、`decidedAt`、`reason`），不写 API Key/响应体。

### 6.3 校验规则（V-01 ~ V-15）

| # | 校验 | 失败行为 |
|---|---|---|
| V-01 | `modelQuotaFallbackPolicy` ∈ `{ask, official, byok}` | 归一 `ask` + WARN |
| V-02 | `officialCreditCapPerTask` 是整数且在 `1..100000`（或显式 0 + 高级开关） | 回落 500 + WARN |
| V-03 | `accessState` ∈ 7 个枚举值 | 归一 `unknown` |
| V-04 | `quotaKind` ∈ `{balance, plan_window, plan_expired, unknown}` | 归一 `unknown` |
| V-05 | `providerCode` 仅允许 `[A-Za-z0-9_.:-]{1,64}` | 非法 → `null`（不展示原始异常串） |
| V-06 | `httpStatus` 为 `100..599` 的整数或 `null` | 非法 → `null` |
| V-07 | `retryAfterMs` 为 `0..7天` 的整数或 `null` | 非法 → `null`，不承诺恢复时间 |
| V-08 | 错误文本截断 500 字符，且不含 `sk-`/`Bearer`/`api_key` 值 | 命中 → 脱敏后再展示 |
| V-09 | `runId` / `stageId` / `capability` 非空 | 决策拒绝，返回 `MODEL_QUOTA_CONTEXT_INVALID` |
| V-10 | 同一 `(runId, capability)` 并发失败只允许一个 decision | 后续失败等待同一个 Promise，不重复弹窗 |
| V-11 | 官方预估积分为非负整数；`unknown` 不是数字 | `unknown` 不得自动切 |
| V-12 | 官方余额读数必须是非负整数；缺失/非法不得当作 0 | 缺失 → `official_unavailable`，不自动切 |
| V-13 | 官方调用幂等键 = `runId:stageId:attempt`，同一 attempt 重放必须同键 | 不同键 → 拒绝发起 |
| V-14 | 任务级覆盖的 `source` 只允许 `official` | 其他值拒绝 |
| V-15 | 用户选择 `cancel` 时不得写 policy、不得写覆盖 | 只改任务状态为 paused |

### 6.4 错误码（产品级）

| 错误码 | 含义 | 用户可见 | 处理 |
|---|---|---|---|
| `MODEL_QUOTA_EXHAUSTED` | 额度/余额/套餐耗尽 | ✅ | 进入兜底决策 |
| `MODEL_CREDENTIAL_INVALID` | Key 无效/过期/被撤销 | ✅ | 进入兜底决策（仅询问） |
| `MODEL_RATE_LIMITED` | 限流 | ✅ | 原有重试/提示 |
| `MODEL_OFFICIAL_UNAVAILABLE` | 官方模型不可用（未登录/无权益/未配置/缺价） | ✅ | 停止 + 引导 |
| `MODEL_OFFICIAL_INSUFFICIENT_CREDIT` | 官方积分不足 | ✅ | 停止 + 引导充值 |
| `MODEL_OFFICIAL_CAP_EXCEEDED` | 预估超过任务上限 | ✅ | 降级为询问 |
| `MODEL_QUOTA_CONTEXT_INVALID` | 运行态上下文缺失 | ⚠️ 内部+通用文案 | 记录日志，停止 |
| `MODEL_QUOTA_POLICY_INVALID` | 设置值非法 | ⚠️ 内部 | 归一 `ask`，不阻断 |

---

## 7. 交互逻辑

### 7.1 设置页（模型设置）

**位置**：设置 → 模型设置 → 服务商列表上方新增「额度用尽时」卡片（与「运营后台同步」卡片同级，不进入新增/编辑弹窗）。

**显示项**：

| 项 | 内容 |
|---|---|
| 标题 | 额度用尽时 |
| 说明 | 当你的模型账号返回额度/凭据错误时，是否允许使用平台官方模型继续（会消耗官方积分）。 |
| 选项 1 | ○ 每次询问（推荐） |
| 选项 2 | ○ 额度用尽时自动使用官方模型（消耗积分） |
| 选项 3 | ○ 仅使用我的模型（不自动用官方） |
| 任务上限 | 单任务官方积分上限：[ 500 ] 积分（仅 `official` 档显示；`ask` 档在弹窗里显示） |
| 当前状态 | 官方模型：可用 / 不可用（原因：未登录 / 无官方积分权益 / 官方算力暂未开放） |
| 帮助链接 | 「了解官方模型与积分」→ 会员中心/计费说明 |
| 保存 | 选择即保存（无需「保存」按钮），失败时 toast + 回滚选中值 |

**禁用态**：
- 未登录：选项 2 禁用，文案「登录汤姆鱼后可用」。
- 无 `official_credit` 权益 / 官方算力未开放：选项 2 禁用，文案「官方模型暂未开放」。
- 官方积分余额为 0：选项 2 可用但提示「当前官方积分为 0，选择后可能无法实际兜底」；不阻止保存（用户可能即将充值）。

### 7.2 额度错误弹窗

**触发**：`accessState ∈ {quota_exhausted, credential_invalid}` 且决策为 `ask`。

**布局**：

```
┌────────────────────────────────────────────────────────┐
│ 模型额度不足                                            │
│                                                        │
│ 你的模型账号「{providerName}」返回了额度/凭据问题：      │
│ {reasonText}                                            │
│                                                        │
│ 模型：{modelName}    能力：{capabilityLabel}            │
│ 错误：{accessStateLabel}{providerCode ? `（${providerCode}）` : ''} │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 使用官方模型继续（消耗官方积分）                    │ │
│ │ 预计消耗：{estimateText}    当前余额：{balanceText} │ │
│ │ 本任务上限：{capText}                              │ │
│ │ 官方模型由平台提供，按实际用量结算。                │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ ☐ 记住我的选择（以后额度用尽时都这样处理）              │
│                                                        │
│ [使用官方模型继续]  [去更新模型设置]  [取消任务]        │
└────────────────────────────────────────────────────────┘
```

**按钮规则**：

| 按钮 | 条件 | 行为 |
|---|---|---|
| 使用官方模型继续 | 官方可用 + 预估 ≤ 上限 + 余额足够 | 写覆盖、落检查点、继续任务 |
| 使用官方模型继续（禁用） | 官方不可用 / 余额不足 / 预估超上限 | 置灰 + tooltip 说明原因；不关闭弹窗 |
| 去更新模型设置 | 总是可用 | 打开设置 → 模型设置，定位到 provider；任务保持 paused |
| 取消任务 | 总是可用 | 任务 paused；不写 policy；保留进度 |
| 记住我的选择 | 仅当用户点了官方或去设置后可选 | 勾选 + 官方 → policy=`official`；勾选 + 去设置 → policy=`byok`；取消不写 |

**关闭弹窗（ESC/遮罩）**：等同「取消任务」，但**不写 policy**。

### 7.3 选择官方后的界面

| 位置 | 显示项 |
|---|---|
| 任务详情顶部 | 横幅：「本次任务正在使用官方模型（已消耗 {used} 积分）」+「切回我的模型」 |
| 阶段进度 | 阶段标签旁显示「官方」徽标；tooltip「本阶段使用平台官方模型，消耗官方积分」 |
| 预计/实际消耗 | 第一次切换后显示「预计消耗」；完成后显示「实际消耗」；未扣分成功时显示「结算中」 |
| 切回我的模型 | 二次确认：「切回后，后续未开始的调用将使用你的模型；已完成的官方调用不会回滚。」；确认后清除覆盖 |
| 任务结束 | 结果页显示「本次任务使用过官方模型，消耗 {credits} 积分」 |

### 7.4 各入口的接入优先级

| 入口 | 是否接入 v1 | 说明 |
|---|---|---|
| 视频创作（Story2Video / 图片轮播 / 数字人） | ✅ | 额度错误最集中、单次成本最高，优先接入 |
| 电影工程（Film Engineering） | ✅ | 长任务，断点续跑必须保留来源覆盖 |
| 改写引擎 / 热榜 / 快速采集 | ✅（P1 后） | 文本调用，若官方 LLM 未供给则只显示「去更新设置」 |
| 提示词引擎 / 评估 | ✅（P1 后） | 同上 |
| 模型设置「测试连接」 | ✅ | 只展示错误分类，不触发官方兜底（测试连接不应扣积分） |

> 接入顺序：先做**统一决策服务 + 弹窗**，再由各域替换自己的 quota 提示；不允许各域直接调官方客户端。

---

## 8. 显示项（汇总）

| 位置 | 字段 | 数据来源 | 规则 |
|---|---|---|---|
| 设置卡片 | 当前策略 | `modelQuotaFallbackPolicy` | 三档单选；默认 ask |
| 设置卡片 | 任务积分上限 | `officialCreditCapPerTask` | 整数；默认 500 |
| 设置卡片 | 官方可用状态 | `officialComputeStatus` | 可用/不可用 + 原因 |
| 弹窗 | provider 名称 | `model_providers.name` | 不回显 Key |
| 弹窗 | 模型名 | 请求参数 `model` | 空则显示「默认模型」 |
| 弹窗 | 能力标签 | capability 映射 | 文字推理 / TTS / 语音识别 / 图片生成 / 视频生成 / 音频生成 |
| 弹窗 | 失败原因 | `accessStateLabel` + `quotaKind` | 不编造恢复时间 |
| 弹窗 | 供应商错误码 | `providerCode` | 有则显示，脱敏 |
| 弹窗 | 预计消耗 | `officialEstimate.credits` | `unknown` 显示「以实际结算为准」 |
| 弹窗 | 当前余额 | `officialStatus.balance` | 缺失显示「—」，不显示 0 |
| 弹窗 | 任务上限 | `officialCreditCapPerTask` | 整数 |
| 任务横幅 | 已消耗 | 官方事件累计 | 未结算显示「结算中」 |
| 结果页 | 本次官方消耗 | `entry.amount` | 扣分失败不显示「已扣除」 |

---

## 9. 提示文字（zh / en，必须成对）

> 所有文案进入 `apps/desktop/src/locales/**`，zh/en 成对提交；不得在 `.vue` 里写死中文。

### 9.1 设置页

| key | zh | en |
|---|---|---|
| `modelProviders.quotaPolicy.title` | 额度用尽时 | When quota runs out |
| `modelProviders.quotaPolicy.desc` | 当你的模型账号返回额度/凭据错误时，是否允许使用平台官方模型继续（会消耗官方积分）。 | When your model account returns a quota or credential error, allow the platform official model to continue (consumes official credits). |
| `modelProviders.quotaPolicy.ask` | 每次询问（推荐） | Ask every time (recommended) |
| `modelProviders.quotaPolicy.official` | 额度用尽时自动使用官方模型（消耗积分） | Use the official model automatically when quota runs out (consumes credits) |
| `modelProviders.quotaPolicy.byok` | 仅使用我的模型（不自动用官方） | Use my own model only |
| `modelProviders.quotaPolicy.capLabel` | 单任务官方积分上限 | Official credit cap per task |
| `modelProviders.quotaPolicy.capHint` | 超过上限时会改为询问，不会自动扣积分。 | If the estimate exceeds the cap, you will be asked instead of charged automatically. |
| `modelProviders.quotaPolicy.officialAvailable` | 官方模型：可用 | Official model: available |
| `modelProviders.quotaPolicy.officialUnavailable` | 官方模型：不可用（{reason}） | Official model: unavailable ({reason}) |
| `modelProviders.quotaPolicy.reason.notSignedIn` | 未登录汤姆鱼 | Not signed in to Tomfish |
| `modelProviders.quotaPolicy.reason.noEntitlement` | 当前套餐不含官方积分 | Your plan does not include official credits |
| `modelProviders.quotaPolicy.reason.notConfigured` | 官方算力暂未开放 | Official compute is not available yet |
| `modelProviders.quotaPolicy.reason.noPrice` | 缺少生效价格 | No active price |
| `modelProviders.quotaPolicy.saved` | 已保存 | Saved |
| `modelProviders.quotaPolicy.saveFailed` | 保存失败，请重试。 | Failed to save. Please try again. |

### 9.2 弹窗

| key | zh | en |
|---|---|---|
| `modelQuota.dialog.title` | 模型额度不足 | Model quota is insufficient |
| `modelQuota.dialog.body` | 你的模型账号「{provider}」返回了额度/凭据问题：{reason} | Your model account "{provider}" returned a quota/credential issue: {reason} |
| `modelQuota.dialog.meta` | 模型：{model} · 能力：{capability} | Model: {model} · Capability: {capability} |
| `modelQuota.dialog.errorCode` | 错误：{state}{codeSuffix} | Error: {state}{codeSuffix} |
| `modelQuota.dialog.officialTitle` | 使用官方模型继续（消耗官方积分） | Continue with the official model (consumes official credits) |
| `modelQuota.dialog.estimate` | 预计消耗：{credits} 积分 | Estimated cost: {credits} credits |
| `modelQuota.dialog.estimateUnknown` | 预计消耗：以实际结算为准 | Estimated cost: based on final settlement |
| `modelQuota.dialog.balance` | 当前余额：{balance} 积分 | Current balance: {balance} credits |
| `modelQuota.dialog.cap` | 本任务上限：{cap} 积分 | Task cap: {cap} credits |
| `modelQuota.dialog.officialNote` | 官方模型由平台提供，按实际用量结算。 | The official model is provided by the platform and settled by actual usage. |
| `modelQuota.dialog.remember` | 记住我的选择（以后额度用尽时都这样处理） | Remember my choice for future quota errors |
| `modelQuota.dialog.useOfficial` | 使用官方模型继续 | Continue with official model |
| `modelQuota.dialog.updateSettings` | 去更新模型设置 | Update model settings |
| `modelQuota.dialog.cancelTask` | 取消任务 | Cancel task |
| `modelQuota.dialog.disabled.notSignedIn` | 登录汤姆鱼后才能使用官方模型。 | Sign in to Tomfish to use the official model. |
| `modelQuota.dialog.disabled.noEntitlement` | 当前套餐不含官方积分。 | Your plan does not include official credits. |
| `modelQuota.dialog.disabled.notConfigured` | 官方模型暂未开放。 | The official model is not available yet. |
| `modelQuota.dialog.disabled.noPrice` | 官方模型缺少生效价格，暂时无法使用。 | No active price for the official model; it is temporarily unavailable. |
| `modelQuota.dialog.disabled.insufficientCredit` | 官方积分不足，需要 {required} 积分，当前 {balance} 积分。 | Not enough official credits. This needs {required}, you have {balance}. |
| `modelQuota.dialog.disabled.capExceeded` | 预计消耗 {estimate} 积分，超过本任务上限 {cap} 积分。 | Estimated {estimate} credits exceeds the task cap of {cap}. |

### 9.3 原因文案（按 accessState / quotaKind）

| key | zh | en |
|---|---|---|
| `modelQuota.reason.quota.balance` | 模型账号余额不足，请充值或更换模型账号。 | Your model account balance is insufficient. Top up or switch accounts. |
| `modelQuota.reason.quota.planWindow` | 模型套餐的用量窗口已用尽，请等待恢复或升级套餐。 | Your model plan's usage window is exhausted. Wait for it to reset or upgrade. |
| `modelQuota.reason.quota.planExpired` | 模型套餐已到期，请续费或更换模型账号。 | Your model plan has expired. Renew it or switch accounts. |
| `modelQuota.reason.quota.unknown` | 模型账号返回额度不足，请检查套餐额度。 | Your model account reports insufficient quota. Check your plan. |
| `modelQuota.reason.credential` | API Key 无效或已过期，请在模型设置中更新。 | The API key is invalid or expired. Update it in Model Settings. |
| `modelQuota.reason.rate` | 模型请求过于频繁，请稍后重试。 | The model is rate limited. Please retry later. |
| `modelQuota.reason.provider` | 模型服务返回错误：{message} | The model provider returned an error: {message} |
| `modelQuota.reason.unknown` | 模型服务返回未知错误，请检查模型设置。 | The model provider returned an unknown error. Check Model Settings. |

### 9.4 任务横幅

| key | zh | en |
|---|---|---|
| `modelQuota.banner.usingOfficial` | 本次任务正在使用官方模型（已消耗 {used} 积分） | This task is using the official model ({used} credits used) |
| `modelQuota.banner.switchBack` | 切回我的模型 | Switch back to my model |
| `modelQuota.banner.switchBackConfirm` | 切回后，后续未开始的调用将使用你的模型；已完成的官方调用不会回滚。 | After switching back, future calls will use your model. Completed official calls will not be reversed. |
| `modelQuota.banner.settling` | 积分结算中 | Credits are being settled |
| `modelQuota.banner.taskUsedOfficial` | 本次任务使用过官方模型，消耗 {credits} 积分 | This task used the official model and consumed {credits} credits |

### 9.5 暂停 / 续跑

| key | zh | en |
|---|---|---|
| `modelQuota.paused.title` | 任务已暂停 | Task paused |
| `modelQuota.paused.body` | 已保留当前进度。更新模型设置或充值后，可从断点继续。 | Progress has been saved. Update Model Settings or top up, then resume from the checkpoint. |
| `modelQuota.resume.official` | 本任务上次已切换到官方模型 | This task was switched to the official model last time |
| `modelQuota.resume.officialUnavailable` | 本任务上次选择的官方模型当前不可用（{reason}） | The official model selected last time is currently unavailable ({reason}) |
| `modelQuota.resume.switchBack` | 切回我的模型 | Switch back to my model |

---

## 10. 埋点与可观测

> 只记录结构化字段，不记录 API Key、完整响应体、用户输入内容。

| 事件 | 字段 |
|---|---|
| `model_quota_error` | `run_id`, `stage_id`, `capability`, `provider_id`, `model`, `access_state`, `quota_kind`, `http_status`, `provider_code`, `policy`, `source` |
| `model_quota_decision` | 上述 + `decision`（`use_official` / `update_settings` / `cancel`）, `decision_origin`（`user` / `policy`）, `remember` |
| `model_quota_official_start` | 上述 + `estimate_credits`, `balance`, `cap`, `idempotency_key_hash`（哈希，不是原文） |
| `model_quota_official_result` | `status`（`success` / `failed`）, `charged`（`settled` / `pending_charge` / `not_charged`）, `actual_credits` |
| `model_quota_switch_back` | `run_id`, `capability`, `elapsed_ms` |

**日志纪律**：
- `provider_code` 可记录；`provider_message` 只记录脱敏后的 200 字符。
- 不记录 `Authorization`、`api_key`、`base_url` 中的 query 参数。
- 官方 Key 永远不出现在客户端日志。

---

## 11. 验收标准（AC-01 ~ AC-20）

| # | 验收 | 判据 |
|---|---|---|
| AC-01 | 402 → 额度错误 | 单测：`fromHttpStatus(402)` + 分类器 → `quota_exhausted`；弹窗出现 |
| AC-02 | 429 + `insufficient_quota` → 额度，不是限流 | 单测：OpenAI 形态 → `quota_exhausted` |
| AC-03 | 429 纯 `rate_limit_exceeded` → 限流，不弹官方 | 单测：`rate_limited`；无官方按钮 |
| AC-04 | 401 → 凭据无效；即使 policy=official 也只询问 | 单测：`credential_invalid` + `askOnly=true` |
| AC-05 | MiniMax 2056 → 额度；1004 → 凭据 | 单测：HTTP 200 + base_resp；两种映射 |
| AC-06 | 未知错误不兜底 | 单测：`unknown` → `stop`；无官方调用 |
| AC-07 | 默认 policy=ask | 单测：缺省/非法值 → `ask` |
| AC-08 | policy=official 自动切，但仅限 quota | 单测：quota → `use_official`；credential → `ask` |
| AC-09 | policy=byok 不切 | 单测：quota → `stop`；无官方调用 |
| AC-10 | 任务级覆盖只影响当前 run | 集成：新建 run 后 `modelSourceOverrides` 为空 |
| AC-11 | 切官方不改默认 provider | 集成：切换后 `model_providers.is_default` 不变 |
| AC-12 | 检查点保留来源覆盖 | 集成：切官方 → 落 checkpoint → 续跑仍走官方 |
| AC-13 | 并发失败只弹一个窗 | 单测：同一 `(runId, capability)` 两次失败共享 Promise |
| AC-14 | 预估超上限降级为询问 | 单测：estimate > cap → `ask`，不自动切 |
| AC-15 | 官方不可用时不发请求 | 集成：`officialStatus.available=false` → 无 compute 调用 |
| AC-16 | 官方失败不换回 BYOK 重试 | 集成：官方 402 → `MODEL_OFFICIAL_INSUFFICIENT_CREDIT`，不再调 BYOK |
| AC-17 | 取消 = paused，进度保留 | 集成：cancel → status `paused`；checkpoint 存在 |
| AC-18 | 文案 zh/en 成对 | CI Gate 7；locale key 齐全 |
| AC-19 | 不泄露 Key | 日志/弹窗/埋点扫描无 `sk-`、`Bearer`、API Key 值 |
| AC-20 | 设置项在官方不可用时禁用 | UI 测试：option official disabled + reason 文案 |

---

## 12. 边界与异常

| 场景 | 行为 |
|---|---|
| 用户在弹窗打开时关闭应用 | 任务 paused；下次启动可从检查点继续；不写 policy |
| 弹窗打开时另一个任务也额度错误 | 每个 run 独立弹窗；同一 run 同一能力复用 |
| 用户快速连点「使用官方模型」 | 按钮 loading + 防重；幂等键相同 |
| 官方预估为 0（免费模型） | 仍需确认一次；不自动切（除非 policy=official 且 cap 允许） |
| 官方余额读不到 | 视为不可用，不自动切；弹窗显示「余额未知，无法自动兜底」 |
| 官方价格卡缺失 | 视为不可用；提示「缺少生效价格」；不按 0 计算 |
| 官方扣分失败但生成成功 | 显示「结算中」，不显示「已扣除」；按官方算力设计的补扣口径 |
| 官方生成失败但已产生用量 | 显示实际原因 + 「本次用量已记录，积分将在恢复后补扣」；不自动重试 |
| 用户切回 BYOK 后再次额度错误 | 同一 run 不再自动切官方（已切过一次）；提示充值/更新；可手动再选官方（计为第 2 次，需确认） |
| 断点续跑时官方覆盖存在但用户已登出 | 官方不可用；提示重新登录或切回 BYOK |
| policy=official 但用户未登录 | 官方不可用 → 降级为 ask（只给「去设置」/「取消」） |
| 供应商错误文本含用户内容 | 只取错误 message 的脱敏前 200 字符；不展示完整响应体 |

---

## 13. 分阶段落地

| 阶段 | 内容 | 依赖 | 是否本 PR |
|---|---|---|---|
| **P0** | 决策定案 + PRD + 设计 + 验收标准 | 无 | ✅ 已随 PR #4497 合并（仅文档） |
| **P1a（本 PR）** | 统一错误分类器（`model-access-failure.js`）+ 产品级 `userErrorCode` + `httpStatus`/`providerCode` 分离 + 精确文案 + 「前往模型设置」动作 | 无（可先于官方算力） | ✅ 本 PR 实现 |
| **P1b-1** | 纯函数决策器 + Coordinator + `modelSourceOverrides` + 检查点/埋点编排 | 无（可先于官方算力） | ✅ 本 PR 实现 |
| **P1b-2a** | IPC/preload + `ModelQuotaPolicyCard` + 标签/locales；官方按钮按能力 gate 禁用 | P1b-1 | ✅ 本 PR 实现 |
| **P1b-2b** | `ModelQuotaFallbackDialog` + `useModelQuotaFallback` + App 根层挂载 | P1b-2a | ✅ 本 PR 实现 |
| **P1b-2c1** | 生产 `ModelQuotaRuntime` + `RunStateStore` 检查点端口 + phase5 IPC 接线 + PipelineEngine run 生命周期 | P1b-2b | ✅ 本 PR 实现 |
| **P1b-2c2** | 业务域调用边界接入（Story2Video/图片轮播/数字人/Film Engineering）+ 模型设置「测试连接」分类展示 | P1b-2c1 | ❌ 下一 PR |
| **P2** | 官方算力代理 D-① + 余额读通道 U-13 + 价格卡 U-12 + 官方调用客户端 + `byok=0` + 扣分 | D-① / U-12 / U-13 | ❌ 与官方算力同批 |
| **P3** | 自动档 `official` 全量开放 + 任务积分上限 + 埋点看板 + LLM 官方供给（若 U-1 决定做） | P2 + U-1 | ❌ |

**上线 gate**：P1 的设置项与「使用官方模型」按钮**不得早于 P2 单独上线**（D-11）。P1a 只交付「错误分类 + 精确提示 + 去更新设置」，设置项与官方按钮均不出现。

### 13.1 P1a 落地记录（2026-10-26）

**范围**：只做「用户能看懂 + 能去改」；不做官方兜底、不做设置、不做任务级覆盖。

| 层 | 实际实现 | 说明 |
|---|---|---|
| 分类器 | `apps/desktop/electron/services/adapters/_base/model-access-failure.js`（新增，与 `provider-error.js` 同层） | 7 状态 + 4 额度子类 + `productCode` / `reasonKey` / `fallbackEligible` / `askOnly` / `safeMessage` / `retryAfterMs`；规则表可注入，避免适配器基类反向依赖业务层 |
| 复用出口 | `provider-error.js` re-export `classifyModelAccessFailure` | 避免 `model-provider-manager` 新增 require 扇出（`check-debt-budget` 只降不升） |
| 调用入口 | `model-provider-manager.callAdapter` 错误分支 | 返回 `errorCode`（历史枚举）、`userErrorCode`（产品级精确码）、`messageParams.provider`、`accessState`、`quotaKind`、`providerCode`、`httpStatus`、`fallbackEligible`、`askOnly` |
| 适配器 | MiniMax 图片/TTS/视频 | `context.httpStatus=200` + `context.providerCode=base_resp.status_code`；`statusCode` 保留兼容 |
| 渲染端 | `user-facing-error.js` + `locales/user-errors/{zh,en}.js` | `userErrorCode` 优先于 `errorCode`；新增 `MODEL_QUOTA_EXHAUSTED` / `_PLAN_WINDOW` / `_PLAN_EXPIRED` / `MODEL_CREDENTIAL_INVALID` / `MODEL_RATE_LIMITED` 五条成对文案 |
| 动作 | `AiWriterPanel.vue` | 上述额度/凭据码给「前往模型设置」；`MODEL_RATE_LIMITED` 不给按钮 |
| 兼容 | `errorCode` 保持 `QUOTA_EXCEEDED` / `AUTH_FAILED` / `RATE_LIMITED` | `story2video-notifications` 等既有消费方继续识别，不被精确码替换 |

**数据校验（P1a 已实现）**：`providerCode` 只接受 `[A-Za-z0-9_.: -]{1,64}`；`httpStatus` 只接受 100–599；`retryAfterMs` 只接受 0–7 天；错误文本截断 500 字符并脱敏 `sk-` / `Bearer` / `api_key`；分类器内部异常一律降级 `unknown`。

**测试**：`model-access-failure.test.js` 24 例；`provider-error.test.js` 新增 2 例；`model-provider-call-adapter.test.js` 新增 5 例；`user-facing-error.test.js` 新增 8 例；`AiWriterPanel.error-action.test.js` 新增 1 例；`model-access-parity.test.js` 新增 16 例。P1a 相关 177 例全绿（详见执行记录）。

**P1a 明确不做**：官方模型按钮 / 设置项 / 弹窗 / 任务级覆盖 / 检查点 / 积分上限。理由见 D-11：官方算力代理 D-① 未落地，先上设置是空承诺。

**P1a follow-up（2026-10-26）**：合并后 CCG 复核发现「两套额度正则漂移 + 裸 `billing` 误判」。已补 `model-access-parity.test.js` 16 例，锁定额度 fixture 两边都判 quota、非额度 fixture 都不判 quota；修正 `insufficient_quota` / `insufficient_balance` 下划线形态、`usage limit` 产品侧漏判；把裸 `billing` 收窄为 `billing hard limit` / `billing … exceeded|insufficient|quota`。新增测试 16 例，P1a 核心 6 文件 177 例全绿。

### 13.2 P1b-1 后端决策层落地记录（2026-10-27）

**范围**：只做「决策 + 运行态覆盖 + 并发/检查点/埋点编排」；不做 IPC、preload、设置卡片、弹窗、业务域接入（P1b-2）。

| 层 | 实际实现 | 说明 |
|---|---|---|
| 纯函数决策器 | `apps/desktop/electron/services/model-quota-policy.js`（新增） | 12 条优先级逐条实现；`normalizePolicy` / `normalizeCap` 校验；`credential_invalid` 永远 ask；`estimate=null` / 超 cap 降级为 ask |
| 运行态覆盖 | `provider-run-context.js` 扩展 `modelSourceOverrides` | `get/set/clear` 按 capability；返回副本；不写 `model_providers` / 不持久化；既有 `openIfQuota` 不变 |
| 编排器 | `apps/desktop/electron/services/model-quota-coordinator.js`（新增） | 同 `(runId, capability)` 并发去重；`model-quota:required` 事件 + 一次性 requestId；5 分钟超时视为 cancel；用户选 official 后**先 checkpoint.save 再写 override**；`telemetry.record` 埋点 |
| 设置键 | `modelQuotaFallbackPolicy` / `officialCreditCapPerTask` | 通过注入的 `store.getSetting` / `setSetting` 读取，非法值归一 `ask` / 500 |

**测试**：`model-quota-policy.test.js` 16 例（12 条优先级 + 归一）；`model-quota-coordinator.test.js` 7 例（并发去重、requestId 一次性、超时、checkpoint 顺序、自动官方、credential 永远 ask、clearRun）；`provider-run-context.test.js` 18 例（新增 3 例覆盖 `modelSourceOverrides`）。P1b-1 定向 41 例全绿。

**P1b-1 明确不做**：IPC/preload、设置卡片、弹窗、`App.vue` 根层挂载、Story2Video/图片轮播/数字人/Film Engineering 接入、模型设置「测试连接」分类展示。这些属 P1b-2；官方按钮在 P2 D-① 未落地前仍禁用。

### 13.3 P1b-2a 设置 IPC + 策略卡片落地记录（2026-10-27）

**范围**：只做「设置读写 + preload 桥 + ModelProviders 策略卡片」；不做弹窗、`App.vue` 根层挂载、Coordinator 生产实例化、业务域接入（P1b-2b）。

| 层 | 实际实现 | 说明 |
|---|---|---|
| IPC | `apps/desktop/electron/ipc-handlers/model-quota.js`（新增） | 4 条渲染端通道：`get-policy` / `set-policy` / `decide` / `switch-back`；全部 `withSenderCheck`；`get-policy` 为 public 读，其余 authenticated |
| 通道注册 | `ipc-handlers/index.js` | 注册 `model-quota`；Coordinator 未接线时 `decide/switch-back` 返回「未就绪」，不阻断其它 IPC |
| 权限 | `license-access-control.js` + `preload/access-control.js` | 只把 `model-quota:get-policy` / `onModelQuotaRequired` 放 public；写通道默认 authenticated |
| preload | `preload/system.js` | `modelQuotaGetPolicy` / `SetPolicy` / `Decide` / `SwitchBack` + `onModelQuotaRequired` 订阅，返回取消订阅函数 |
| 渲染桥 | `src/api/model-quota.js`（新增） | 组件不直调 `window.electronAPI`；统一走 `invokeWithFallback`（参数脱壳 + fallback）；事件走 bridge 的 `on()` |
| UI | `src/components/model-quota/ModelQuotaPolicyCard.vue`（新增） | 三档单选 + cap 输入 + 官方状态；官方不可用且 policy=ask 时整卡隐藏（P2 前不空承诺）；挂在 `ModelProviders.vue` 顶部 |
| 标签 | `src/views/model-quota-labels.js` + `locales/model-quota/{zh,en}.js` | state/reason → i18n key；卡片全部文案走 locale，无中文硬编码 |
| 校验 | `model-quota.test.js` 9 例 + `ModelQuotaPolicyCard.test.js` 5 例 + `model-quota-labels.test.js` 5 例 | 读写/非法值/权限降级/隐藏态/保存/cap 边界/标签回落/官方状态降级/写失败回滚/读取失败可见 |

**数据校验（P1b-2a 已实现）**：`policy` 只接受 `ask|official|byok`；`cap` 只接受 1–100000 整数（字符串 `'500'` 可归一）；非法值返回 `VALIDATION_ERROR` 且不写；`get-policy` 的官方状态读取失败降级 `not_configured` / `balance_unavailable`，不抛。

**测试**：P1b-2a 定向 7 文件 460 例全绿（IPC 9 + 渲染桥 5 + preload/access/card/labels/ModelProviders 既有+新增）。

**P1b-2a 明确不做**：`ModelQuotaFallbackDialog.vue`、`useModelQuotaFallback.js`、`App.vue` 根层挂载、Coordinator 生产实例化与 run 生命周期、业务域接入、模型设置「测试连接」分类展示。官方按钮在 P2 D-① 未落地前仍禁用。

### 13.4 P1b-2b 兜底弹窗 + App 根层落地记录（2026-10-27）

**范围**：只做「弹窗 UI + 状态机 composable + App 根层挂载」；不做 Coordinator 生产实例化、run 生命周期、业务域接入（P1b-2c）。

| 层 | 实际实现 | 说明 |
|---|---|---|
| Composable | `src/composables/useModelQuotaFallback.js`（新增） | 订阅 `onModelQuotaRequired`；维护 `currentRequest`；`decide('official'|'settings'|'cancel')` 回传 `requestId/runId/capability/remember`；卸载取消订阅；decide 成功清空请求、失败保留并标记 |
| Dialog | `src/components/model-quota/ModelQuotaFallbackDialog.vue`（新增） | 全局单例；provider/model/错误类型/预计积分/官方余额/单任务上限；官方不可用禁用按钮并显示原因；记住选择；设置/取消/官方三出口；ESC/遮罩/× 均走 cancel |
| App 挂载 | `src/App.vue` | 根层 `<ModelQuotaFallbackDialog @settings="openModelSettingsFromQuota" />`；设置出口调用 `requestSettingsDialog('model')` |
| 文案 | `locales/model-quota/{zh,en}.js` | 新增 `dialog.*` 成对文案；无中文硬编码 |
| 协调器修复 | `model-quota-coordinator.js` | 修正 PRD §7.2：`remember + settings` 才写 `policy=byok`；`cancel` 不写 policy；补 2 例回归测试 |

**测试**：`useModelQuotaFallback.test.js` 5 例；`ModelQuotaFallbackDialog.test.js` 5 例；`model-quota-coordinator.test.js` 9 例（新增 2 例 remember 语义）。P1b-2b 定向 19 例全绿。

**P1b-2b 明确不做**：Coordinator 生产实例化、`checkpointPort` 的 run 生命周期、`modelQuotaSwitchBack` 的真实 run 上下文、Story2Video/图片轮播/数字人/Film Engineering 业务域接入、模型设置「测试连接」分类展示。这些属 P1b-2c。

### 13.5 P1b-2c1 生产运行时 + IPC 接线 + run 生命周期落地记录（2026-10-27）

**范围**：把 P1b-1 的纯 Coordinator 变成生产单例，并接上 `RunStateStore` 检查点与 PipelineEngine run 生命周期；**不接业务域调用边界**（P1b-2c2）。

| 层 | 实际实现 | 说明 |
|---|---|---|
| 运行时 | `electron/services/model-quota-runtime.js`（新增） | `ModelQuotaRuntime` 持有唯一 Coordinator；`beginRun(runId,{runContext,overrides})` 复用/恢复 run context；`decide()` 自动带 context；`endRun()` 清理；`switchBack()` 先落检查点再清覆盖 |
| 检查点端口 | `electron/services/model-quota-checkpoint-port.js`（新增） | 从 `RunStateStore.load(runId)` 读旧快照 → 合并 `context.modelSourceOverrides` → `savePaused()`；`override=null` 删除能力覆盖；只写 `source/originalProviderId/decidedAt/reason`，不写 Key/响应体 |
| Pipeline 生命周期 | `electron/services/model-quota-pipeline-hooks.js`（新增） | `beginModelQuotaRun` 从 `run.context` 取同一个 `ProviderRunContext` 注册；`endModelQuotaRun` 在 `_finalizeRun` 清理；独立模块避免继续撑大 `pipeline-engine.js` |
| 生产接线 | `electron/bootstrap/phase5-ipc.js` | 创建运行时（`BrowserWindow.getAllWindows()` 广播 `model-quota:required`）；`pipelineEngine.modelQuotaRuntime` 挂载；`handlerDependencies` 注入 `modelQuotaCoordinator` / `modelQuotaSwitchBack` |
| IPC 修正 | `electron/ipc-handlers/model-quota.js` | `switch-back` 改为 `await`，异步运行时返回 false 时不再被 Promise 真值误判成功 |
| 边界 | — | 本 PR **没有**任何业务域调用 `decide()`：`model-quota:required` 的生产触发仍属 P1b-2c2；P2 D-① 前官方仍不可用 |

**数据校验**：`beginRun` 空 runId 抛 `TypeError`；`overrides` 非对象/数组忽略；只接受 `source ∈ official|byok`；`officialAttempts` 非负整数否则 0；`switchBack` 空 runId/capability、未知 run、非 official 覆盖均返回 false；检查点端口对缺 runId/capability、无 store、快照不存在/损坏、`savePaused` 抛错均返回 false 且不抛。

**测试**：`model-quota-runtime.test.js` 8 例；`model-quota-checkpoint-port.test.js` 6 例；`model-quota-pipeline-hooks.test.js` 3 例；`phase5-ipc.test.js` 新增 1 例；`model-quota.test.js` 新增 1 例；`pipeline-engine.test.js` 新增 1 例。P1b-2c1 相关 130 例全绿。

**P1b-2c1 明确不做**：Story2Video/图片轮播/数字人/Film Engineering 的模型调用边界接入、业务域失败→`decide()` 的触发、任务详情「官方」横幅/切回按钮、模型设置「测试连接」分类展示；这些属 P1b-2c2。

---

## 14. 未决问题（U-1 ~ U-6）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| U-1 | 官方模型是否提供 **LLM（文字推理）** 供给？ | 影响改写/热榜/提示词等文本域能否兜底 | 需产品/运营拍板；当前官方算力设计只覆盖视频/图像/TTS/ASR |
| U-2 | 官方积分余额读端点形态（U-13） | 无法预检余额 → 只能 fail-closed | 与官方算力 D-① 同批 |
| U-3 | 视频/图像/TTS/ASR 价格卡（U-12） | 无价卡 → 缺价拒绝服务 | 运营提供定价数据 |
| U-4 | 官方兜底是否允许「跨能力」共享一个任务上限？ | 影响 cap 语义 | 建议按任务总上限，不按能力分别算 |
| U-5 | 默认 cap 500 是否合适？ | 影响大任务体验 | 需按真实价格卡测算后校准 |
| U-6 | 是否允许用户把官方模型设为**主来源**（非兜底）？ | 与 BYOK 定位冲突 | 本版不做；如要做，另立「模型来源」总开关 |

---

## 15. 关联文档

- `01-docs/DESIGN-MODEL-QUOTA-FALLBACK-2026-10-26.md` — 本 PRD 的技术设计
- `01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` — 官方算力 D-① / 扣分 / 交互
- `01-docs/PRD-CREDIT-CONSUME-API-2026-10-25.md` — 扣分端点
- `01-docs/PRD-OFFICIAL-COMPUTE-CHARGE-STATE-2026-10-25.md` — 扣分状态机
- `01-docs/PRD-OFFICIAL-COMPUTE-USAGE-EVENTS-2026-10-25.md` — 事件级用量与 `byok`
- `apps/desktop/electron/services/adapters/_base/provider-error.js` — 现有错误分类
- `apps/desktop/electron/services/provider-run-context.js` — 现有运行内熔断
- `apps/desktop/electron/services/model-provider-manager.js` — 统一调用入口
- `apps/desktop/src/utils/user-facing-error.js` — 渲染端错误文案归一

---

## 16. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-26 | v1.0 | 初始定案：三档设置、任务级覆盖、错误状态机、验收标准；明确官方供给未落地前不单独上线设置项 |
