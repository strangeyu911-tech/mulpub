# DESIGN：模型额度用尽处理策略 —— 技术设计与落地形态（2026-10-26）

> **文档性质**：技术设计（Design）。配套 PRD：`01-docs/PRD-MODEL-QUOTA-FALLBACK-2026-10-26.md`（下称 PRD）。
> **状态**：🚧 **P1a 已实现**（`model-access-failure.js` + `userErrorCode` + 适配器 `httpStatus/providerCode` + 精确文案 + 动作）；**P1b / P2 / P3 未实现**。实际落地见 §3.1「P1a 已落地」与执行记录 `openspec/records/model-quota-p1.md`。
> **上游依赖**：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（D-① 官方算力代理 **未落地**）。
> **日期**：2026-10-26

---

## 1. 设计目标

把「模型额度/凭据失败」从一个**散落在各业务域的错误字符串**，变成一条**可判定、可询问、可执行、可审计**的决策链：

```
失败 → 归一化状态 → 策略决策 → 用户选择/自动 → 任务级来源覆盖 → 官方算力调用（P2）→ 扣分/结算
```

核心约束：

1. **BYOK 优先**：官方模型不是默认来源，只在额度/凭据失败时兜底（PRD D-01/D-02）。
2. **不污染设置**：任务级覆盖只活在 run 生命周期，不写 `model_providers`（PRD D-02/D-05）。
3. **不误判**：限流/网络/内容安全/未知错误绝不触发官方兜底（PRD D-07）。
4. **不擅自花钱**：默认 `ask`；自动档有任务级积分上限（PRD D-03/D-08）。
5. **可恢复**：切换前落检查点，续跑保留来源覆盖（PRD §5.7）。
6. **官方供给未落地时不上线 UI**（PRD D-11）。

---

## 2. 架构位置

```
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer (Vue)                                                        │
│  ├─ ModelProviders.vue / useModelProviderCrud                         │
│  │    └─ <ModelQuotaPolicyCard>  （P1，官方可用时显示）                │
│  ├─ <ModelQuotaFallbackDialog>   （P1 全局单例）                       │
│  └─ 各业务域（CreateView / ResultView / FilmEngineering…）              │
│       └─ 只消费统一事件/错误码，不自建弹窗                              │
├──────────────────────────────────────────────────────────────────────┤
│ Preload（contextBridge）                                              │
│  └─ modelQuota:getPolicy / setPolicy / getStatus / decide / onRequired │
├──────────────────────────────────────────────────────────────────────┤
│ Main (Electron)                                                       │
│  ├─ ModelAccessFailureClassifier   （P1，纯函数）                      │
│  ├─ ModelQuotaPolicyResolver       （P1，纯函数）                      │
│  ├─ ModelQuotaCoordinator          （P1，唯一决策入口 + 并发去重）      │
│  ├─ ProviderRunContext             （P1 扩展 modelSourceOverrides）    │
│  ├─ ModelProviderManager.callAdapter（P1 接入分类器）                  │
│  ├─ OfficialComputeClient          （P2，调 ops-center /compute/execute）│
│  └─ CreditStatusProvider           （P2，读余额；U-13）                │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 为什么不把决策放进 `callAdapter`

`callAdapter` 是**同步返回调用结果**的统一入口，被 7 类模型、几十个调用点复用；它不应该知道 UI、弹窗、任务暂停。它的职责边界是：

- 捕获 `ProviderError`；
- 调用纯函数分类器，给返回值补 `errorCode` / `accessState` / `providerCode` / `httpStatus`；
- 保持原有 `{ code:-1, error, message }` 形状向后兼容。

**决策**（问用户/自动切/落检查点）发生在**流水线阶段执行器**或**业务域编排层**，因为它们才知道 `runId`、`stageId`、`capability`、检查点。

### 2.2 为什么需要 `ModelQuotaCoordinator`

- 并发：同一 run 的图片 3 并发、同一 provider 同时 3 个 429，不能弹 3 个窗。
- 去重：同一 `(runId, capability)` 只允许一个 decision Promise。
- 生命周期：知道 run 开始/结束，负责清理覆盖。
- 审计：统一写埋点，避免各域各写。

---

## 3. 模块与接口

### 3.1 `model-access-failure.js`（P1，主进程纯函数）

路径：`apps/desktop/electron/services/adapters/_base/model-access-failure.js`（与 `provider-error.js` 同层；避免适配器基类反向依赖 `electron/services` 业务层）

```js
/**
 * @typedef {'quota_exhausted'|'credential_invalid'|'rate_limited'|'transient'|'content_policy'|'provider_error'|'unknown'} AccessState
 * @typedef {'balance'|'plan_window'|'plan_expired'|'unknown'} QuotaKind
 *
 * @typedef {object} AccessFailure
 * @property {AccessState} state
 * @property {QuotaKind|null} quotaKind
 * @property {number|null} httpStatus
 * @property {string|null} providerCode
 * @property {number|null} retryAfterMs
 * @property {boolean} fallbackEligible
 * @property {boolean} askOnly
 * @property {string} reasonKey        // 对应 locale key 的相对段
 * @property {string} safeMessage      // 脱敏、截断后的错误摘要
 */

function classifyModelAccessFailure(error, options = {}) : AccessFailure
function normalizeProviderCode(value) : string|null
function parseRetryAfterMs(headers) : number|null
```

**输入**：`ProviderError`（含 `code`、`message`、`context.statusCode`、`context.providerCode`、`context.headers`）或普通 `Error`。
**输出**：稳定的 `AccessFailure`；永不抛错（内部 try/catch，异常 → `unknown`）。

**与现有 `classifyProviderFailure` 的关系**：
- `classifyProviderFailure` 返回 `quota` / `rate` / `transient` / `content_policy` / `other`，服务于**重试/熔断**。
- `classifyModelAccessFailure` 返回更细的 `AccessState` + `quotaKind`，服务于**用户提示/官方兜底**。
- 两者**各自独立实现**文本模式（`classifyProviderFailure` 在 `provider-error.js`，产品级分类器在新模块）；不互相 require，避免循环依赖；由 `model-access-parity.test.js` 锁住两套枚举的「quota 语义交集」（额度 fixture 两边都判 quota，非额度 fixture 都不判 quota）。这样改一套重试策略不会静默改变用户提示。

**关键实现点**：
- `context.statusCode` 目前被 MiniMax 业务码复用（1004/2056）。P1 必须新增 `context.httpStatus` 与 `context.providerCode` 两个字段，**保留 `statusCode` 向后兼容**（历史测试断言 `context.statusCode === 1004`）。
- 适配器改造点：`minimax-image.js`、`minimax-tts.js`、`minimax.js`、`minimax-h3-v2.js` 在抛 `ProviderError` 时补 `{ providerCode: Number(baseResp.status_code), httpStatus: 200 }`。
- 其他适配器只需补 `httpStatus`（若 `fromHttpStatus` 已带 `statusCode`，可映射）。

**P1a 已落地（2026-10-26）**：
- 文件已按本节路径创建；导出 `ACCESS_STATES` / `QUOTA_KINDS` / `MODEL_ACCESS_PRODUCT_CODES` / `classifyModelAccessFailure` / `normalizeProviderCode` / `normalizeHttpStatus` / `parseRetryAfterMs` / `sanitizeErrorMessage` / `quotaKindFromText`。
- `provider-error.js` 只做 re-export（`classifyModelAccessFailure`），`model-provider-manager` 从既有 `provider-error` require 解构，**没有新增 require 扇出**。
- `callAdapter` 返回新增字段：`userErrorCode`（产品级精确码）、`messageParams.provider`、`accessState`、`quotaKind`、`providerCode`、`httpStatus`、`fallbackEligible`、`askOnly`；`errorCode` 仍为 `ProviderError.code`（历史枚举），保证 `story2video-notifications` 等旧消费方不回归。
- `fromHttpStatus` 写 `statusCode` + `httpStatus` 两个字段；MiniMax 图片/TTS/视频写 `httpStatus:200` + `providerCode: base_resp.status_code`。
- 渲染端 `formatUserError` 的候选顺序为 `userErrorCode → errorCode → 数值码 → pattern`；未知 `userErrorCode` 会回落到已知 `errorCode`，不吞错。
- **未实现**：`model-quota-policy.js`、`model-quota-coordinator.js`、设置读写、弹窗、任务级覆盖、检查点。它们属于 P1b。

### 3.2 `model-quota-policy.js`（P1b，主进程纯函数）

路径建议：`apps/desktop/electron/services/model-quota-policy.js`

```js
const POLICY = Object.freeze({ ASK: 'ask', OFFICIAL: 'official', BYOK: 'byok' })

/**
 * @typedef {object} OfficialStatus
 * @property {boolean} available
 * @property {'ok'|'not_signed_in'|'no_entitlement'|'not_configured'|'no_price'|'balance_unavailable'} reason
 * @property {number|null} balance
 * @property {'credit'} currency
 *
 * @typedef {object} Decision
 * @property {'use_official'|'ask'|'stop'|'retry_later'} action
 * @property {'policy_official'|'policy_ask'|'policy_byok'|'credential_ask_only'|'official_unavailable'|'insufficient_credit'|'cap_exceeded'|'already_declined'|'official_failed'|'not_fallback_eligible'} reason
 * @property {boolean} showDialog
 * @property {string|null} messageKey
 */

function resolveModelQuotaAction({
  failure,          // AccessFailure
  policy,           // 'ask'|'official'|'byok'
  officialStatus,   // OfficialStatus
  estimate,         // { credits: number|null }
  cap,              // number
  runOverride,      // { source:'official', officialAttempts:number } | null
  alreadyDeclined,  // boolean
}) : Decision

function normalizePolicy(value) : { value:'ask'|'official'|'byok', valid:boolean, reason:string }
function normalizeCap(value) : { value:number, valid:boolean, reason:string }
```

**决策优先级（必须按此顺序，测试逐条锁）**：

1. `failure.state === 'official_failed'`（来自官方调用失败）→ `stop`，reason `official_failed`。
2. `!failure.fallbackEligible` → 按 state：
   - `rate_limited` / `transient` → `retry_later`
   - `content_policy` / `provider_error` / `unknown` → `stop`
3. `runOverride?.officialAttempts >= 1` 且本次仍是官方失败 → `stop`（不循环）。
4. `alreadyDeclined === true` → `stop`（同一 run 不重复问）。
5. `policy === 'byok'` → `stop`（`policy_byok`）。
6. `officialStatus.available !== true` → `stop`（`official_unavailable`）。
7. `failure.state === 'credential_invalid'` → `ask`（`credential_ask_only`，**无论 policy**）。
8. `estimate.credits == null` → `ask`（`cap_exceeded` 或 `estimate_unknown`；不自动）。
9. `estimate.credits > cap` → `ask`（`cap_exceeded`）。
10. `officialStatus.balance != null && officialStatus.balance < estimate.credits` → `stop`（`insufficient_credit`）。
11. `policy === 'official'` → `use_official`（`policy_official`）。
12. 否则 → `ask`（`policy_ask`）。

> 顺序 7 在 11 之前是**安全关键**：`credential_invalid` 永远询问，`official` 档不能自动切。

### 3.3 `model-quota-coordinator.js`（P1，主进程有状态服务）

路径建议：`apps/desktop/electron/services/model-quota-coordinator.js`

职责：

- 持有 `Map<runId, Map<capability, Promise<Decision>>>`，并发去重。
- 读取设置（`modelQuotaFallbackPolicy` / `officialCreditCapPerTask`）。
- 调用 `resolveModelQuotaAction`。
- 需要询问时，向渲染端发事件并等待 `decide` IPC；超时（默认 5 分钟）→ 视为 `cancel`。
- 写 `ProviderRunContext.modelSourceOverrides`。
- 调 `checkpoint.save()`（由注入的 `checkpointPort` 提供，避免依赖具体流水线）。
- 写埋点（注入 `telemetryPort`）。

```js
class ModelQuotaCoordinator {
  constructor({ store, emitToRenderer, checkpointPort, officialStatusProvider, telemetry, clock })
  async decide({ runId, stageId, capability, providerId, model, failure, runContext })
  async userDecision({ runId, capability, decision, remember })
  clearRun(runId)
}
```

**IPC / 事件契约**：

| 方向 | 通道 | 载荷 |
|---|---|---|
| main → renderer | `model-quota:required` | `{ requestId, runId, capability, providerId, providerName, model, failure: AccessFailure, official: OfficialStatus, estimate, cap, policy }` |
| renderer → main | `model-quota:decide` | `{ requestId, decision: 'official'|'settings'|'cancel', remember: boolean }` |
| renderer → main | `model-quota:get-policy` | `{}` → `{ policy, cap, official: OfficialStatus }` |
| renderer → main | `model-quota:set-policy` | `{ policy, cap }` → `{ code, message }` |
| renderer → main | `model-quota:switch-back` | `{ runId, capability }` → `{ code }` |

> **安全**：所有 renderer → main 通道使用 `withSenderCheck`；`requestId` 必须由 main 生成并一次性有效；renderer 不能伪造 `runId` 去改别的任务（校验 `requestId` 与 `runId` 绑定）。

### 3.4 `ProviderRunContext` 扩展（P1）

现有 `ProviderRunContext` 是 WeakMap 绑定 pipeline context。扩展：

```js
class ProviderRunContext {
  constructor() {
    this._open = new Map()
    this._voice = new Map()
    this._modelSource = new Map() // capability -> override
  }
  modelSourceOf(capability) { ... }
  setModelSource(capability, override) { ... }
  clearModelSource(capability) { ... }
  clearAllModelSources() { ... }
}
```

- `openIfQuota` 保持不变；官方兜底不解除 BYOK provider 熔断（PRD §5.8）。
- 检查点序列化由业务域负责：只写 `{source, originalProviderId, decidedAt, reason}`，不写整个 context。

### 3.5 `OfficialComputeClient`（P2，主进程）

路径建议：`apps/desktop/electron/services/official-compute-client.js`

```js
class OfficialComputeClient {
  constructor({ opsCenterSync, identity, creditStatus, log })
  async getStatus() : OfficialStatus
  async execute({ runId, stageId, capability, model, spec, input, idempotencyKey }) : { code, data?, errorCode?, message? }
}
```

**依赖**：
- `opsCenterSync.getConfig().url` + `getCatalogApiKey()`（或身份 Bearer）——官方算力端点走 ops-center。
- `identity` 登录态（Logto sub）——官方算力必须绑定用户。
- `creditStatus.getBalance()` —— U-13 读余额通道；未落地时 `balance=null`，`available=false`（`balance_unavailable`）。
- 价格卡 —— 缺价时 `available=false`（`no_price`）。

**契约（与 `DESIGN-OFFICIAL-COMPUTE-WIRING` 对齐）**：

```
POST {opsCenterUrl}/api/v1/compute/execute
Headers:
  X-Catalog-Key: <catalog key>        // 或 Authorization: Bearer <logto>
  Content-Type: application/json
Body:
  {
    "userId": "<logto sub>",
    "capability": "video|image|tts|speech_recognition",
    "model": "<model id>",
    "spec": "<quality/spec>",
    "input": { ... },                // 与 BYOK 适配器同形态
    "idempotencyKey": "<runId:stageId:attempt>"
  }
Response:
  { "code": 0, "data": { "output": ..., "usage": ..., "creditCost": 123 }, "requestId": "..." }
```

> 该端点是 **D-① 待实现**；P2 之前 `getStatus()` 恒返回 `{available:false, reason:'not_configured'}`。客户端**不得**直连供应商，也不得读取 `official_keys`。

### 3.6 渲染端组件（P1）

| 组件/模块 | 职责 |
|---|---|
| `ModelQuotaPolicyCard.vue` | 设置卡片：三档单选 + cap 输入 + 官方状态；调用 `model-quota:get-policy` / `set-policy` |
| `ModelQuotaFallbackDialog.vue` | 全局单例弹窗；监听 `model-quota:required`；按钮/禁用态/记住选择 |
| `useModelQuotaFallback.js` | 订阅事件、维护 `currentRequest`、提交 decision、错误 toast |
| `model-quota-labels.js` | `accessState` / `quotaKind` / reason → locale key 的纯函数映射（可单测） |

**组件放置**：`ModelQuotaFallbackDialog` 挂在 `App.vue` 根层，确保任何页面都能弹；`ModelQuotaPolicyCard` 挂在 `ModelProviders.vue` 顶部。

> `ModelProviders.vue` 已 1483 行，接近 `check-max-lines` 债务线；新卡片必须抽独立组件，**不得**把 150+ 行模板塞回该文件。

---

## 4. 数据流（时序）

### 4.1 默认 `ask` 流程

```
StageExecutor        ModelProviderManager      Coordinator           Renderer              OfficialClient
     │                        │                    │                    │                      │
     │ callAdapter(...)       │                    │                    │                      │
     │───────────────────────>│                    │                    │                      │
     │                        │ ProviderError(402) │                    │                      │
     │                        │ classify → quota   │                    │                      │
     │<───────────────────────│ {code:-1, error,   │                    │                      │
     │                        │  accessState:...}  │                    │                      │
     │ decide(...)            │                    │                    │                      │
     │───────────────────────────────────────────>│                    │                      │
     │                        │                    │ getPolicy/getStatus│                      │
     │                        │                    │───────────────────>│                      │
     │                        │                    │ emit required      │                      │
     │                        │                    │───────────────────>│                      │
     │                        │                    │                    │ 用户点「官方继续」     │
     │                        │                    │<───────────────────│ decide               │
     │                        │                    │ checkpoint.save()  │                      │
     │                        │                    │ setOverride()      │                      │
     │                        │                    │                    │                      │
     │ resume stage           │                    │                    │                      │
     │─────────────────────────────────────────────────────────────────────────────────────────>│
     │                        │                    │                    │                      │ execute
     │<─────────────────────────────────────────────────────────────────────────────────────────│
     │                        │                    │ telemetry          │                      │
```

### 4.2 `official` 自动档流程

```
失败 → 分类 quota_exhausted → policy=official
  → officialStatus.available?
     ├─ 否 → stop（official_unavailable）+ 引导
     └─ 是 → estimate ≤ cap? + balance ≥ estimate?
        ├─ 否 → ask（降级询问）
        └─ 是 → checkpoint.save → setOverride → execute official
```

### 4.3 断点续跑

```
读取 checkpoint.modelSourceOverrides[capability]
  ├─ 存在且 official 可用 → 直接官方；横幅提示「上次已切换」
  ├─ 存在但 official 不可用 → 弹「官方不可用」三选一（重试/切回/取消）
  └─ 不存在 → BYOK 正常解析
```

---

## 5. 错误分类器细节

### 5.1 `ProviderError` 上下文扩展

当前：

```js
new ProviderError(ERROR_CODES.QUOTA_EXCEEDED, msg, { providerId, statusCode: 2056 })
```

目标：

```js
new ProviderError(ERROR_CODES.QUOTA_EXCEEDED, msg, {
  providerId,
  httpStatus: 200,
  providerCode: 2056,
  // statusCode 保留 = providerCode（向后兼容历史测试/消费方）
  statusCode: 2056,
})
```

`classifyModelAccessFailure` 读取顺序：

1. `error.context.providerCode`（业务码）
2. `error.context.httpStatus`（HTTP 码）
3. `error.context.statusCode`（兼容：若 ≤599 视为 HTTP，否则视为业务码）
4. `error.code`（`ProviderError` 枚举）
5. 文本

### 5.2 供应商业务码表（可扩展）

```js
const PROVIDER_CODE_RULES = Object.freeze([
  { provider: 'minimax', code: 1004, state: 'credential_invalid' },
  { provider: 'minimax', code: 2056, state: 'quota_exhausted', quotaKind: 'plan_window' }, // 文本含 expired → plan_expired
  { provider: 'openai', code: 'insufficient_quota', state: 'quota_exhausted', quotaKind: 'balance' },
  { provider: 'openai', code: 'billing_hard_limit_reached', state: 'quota_exhausted', quotaKind: 'balance' },
  { provider: 'openai', code: 'rate_limit_exceeded', state: 'rate_limited' },
  { provider: 'anthropic', code: 'credit_balance_too_low', state: 'quota_exhausted', quotaKind: 'balance' },
  { provider: 'anthropic', code: 'authentication_error', state: 'credential_invalid' },
  { provider: 'anthropic', code: 'rate_limit_error', state: 'rate_limited' },
  { provider: 'gemini', code: 'RESOURCE_EXHAUSTED', state: 'quota_exhausted', quotaKind: 'unknown' },
  { provider: 'gemini', code: 'API_KEY_INVALID', state: 'credential_invalid' },
  { provider: 'deepseek', code: 'Insufficient Balance', state: 'quota_exhausted', quotaKind: 'balance' },
  { provider: 'openrouter', code: 'Insufficient credits', state: 'quota_exhausted', quotaKind: 'balance' },
])
```

> 业务码大小写不敏感；`provider` 允许前缀匹配（`minimax-*`）。

### 5.3 文本模式

复用 `QUOTA_MESSAGE_PATTERN` / `RATE_LIMIT_MESSAGE_PATTERN` / `TRANSIENT_MESSAGE_PATTERN`，新增：

```js
const CREDENTIAL_MESSAGE_PATTERN = /invalid\s+api[ _-]?key|api[ _-]?key[^\n]{0,24}(?:invalid|expired|失效|过期|无效|错误)|authentication\s+(?:failed|error)|unauthorized|access\s+denied|credential|认证失败|密钥.{0,12}(?:无效|过期)/i
const PLAN_EXPIRED_PATTERN = /plan[^\n]{0,24}expired|套餐[^\n]{0,12}到期|订阅[^\n]{0,12}到期|续费/i
```

**判定顺序**（伪代码）：

```
if (providerCodeRule) return rule
if (httpStatus === 401 || 403) {
  if (PLAN_EXPIRED_PATTERN.test(text)) return quota_exhausted/plan_expired
  return credential_invalid
}
if (httpStatus === 402) return quota_exhausted/(balance if text 余额/balance else unknown)
if (httpStatus === 429) {
  if (QUOTA_MESSAGE_PATTERN.test(text) && !RATE_LIMIT_MESSAGE_PATTERN.test(text)) return quota_exhausted
  return rate_limited
}
if (httpStatus >= 500 || httpStatus === 0) return transient
if (QUOTA_MESSAGE_PATTERN.test(text)) return quota_exhausted/unknown
if (CREDENTIAL_MESSAGE_PATTERN.test(text)) return credential_invalid
if (RATE_LIMIT_MESSAGE_PATTERN.test(text)) return rate_limited
return unknown
```

> 注意：`429` 分支必须先排除「纯限流」文本；OpenAI `insufficient_quota` 会同时命中 `QUOTA_MESSAGE_PATTERN`，且不命中 `RATE_LIMIT_MESSAGE_PATTERN`（`insufficient_quota` 不含 "rate limit"）→ 正确判额度。

---

## 6. 设置读写

### 6.1 存储

使用既有 `settings` 表：

```js
store.getSettingObject('modelQuotaFallbackPolicy', 'ask') // 若既有 API 只支持对象，包一层 { value }
store.setSetting('modelQuotaFallbackPolicy', policy)
store.setSetting('officialCreditCapPerTask', cap)
```

> 若 `getSettingObject` 对字符串不友好，使用 `getSetting` / `setSetting` 的 JSON 包装 `{value:'ask'}`；实现时必须先读现有 store 的契约（`settings-roundtrip-contract.test.js` 锁「对象进、对象出」）。

### 6.2 读取时机

- `ModelQuotaCoordinator.decide()` 每次实时读；不缓存。
- 设置卡片打开时读一次；保存后更新本地状态。
- 多窗口：`store` 是单进程 SQLite；设置写入后其他窗口通过 `model-quota:policy-changed` 广播刷新（可选 P1）。

### 6.3 校验

`normalizePolicy` / `normalizeCap` 是纯函数，测试覆盖：
- `undefined` / `null` / `''` / `'ASK'` / `' official '` / `123` / `{}`。
- cap：`0` / `-1` / `1.5` / `'500'` / `100001` / `null`。

---

## 7. 测试策略（TDD）

### 7.1 单元（P1）

| 文件 | 用例 |
|---|---|
| `model-access-failure.test.js` | 401/402/429/400/500/0；OpenAI/Anthropic/Gemini/DeepSeek/MiniMax/OpenRouter 业务码；文本兜底；未知 → unknown；脱敏；retryAfter 边界 |
| `model-quota-policy.test.js` | 12 条决策优先级逐条；三档 policy × 7 状态 × official 可用/不可用 × 余额/预估组合；`credential_invalid` 永远 ask；cap 边界 |
| `provider-run-context.test.js` | `modelSourceOverrides` 读写/清理；不影响既有 quota 熔断 |
| `model-quota-coordinator.test.js` | 并发去重；requestId 一次性；超时 → cancel；checkpoint 调用顺序；埋点字段 |
| `model-quota-labels.test.js` | state/quotaKind/reason → locale key；未知 → 通用 key |

### 7.2 契约（P1）

| 文件 | 用例 |
|---|---|
| `ipc-handlers/model-quota.test.js` | 5 条通道的 sender 校验、入参校验、错误信封；renderer 伪造 runId 被拒 |
| `preload` 测试 | 新方法存在、通道名正确、参数脱壳 |
| `model-provider-manager` 测试 | 现有 `{code:-1,error,message}` 形状不变；新增 `accessState` 字段；`context.statusCode` 兼容 |

### 7.3 集成（P1/P2）

| 场景 | 判据 |
|---|---|
| 模拟 provider 402 → 弹窗 → 选官方 → 后续调用走 official（mock client） | official client 被调用 1 次；BYOK adapter 不再被调用 |
| 切官方后新任务 | 新 run 的 `modelSourceOverrides` 为空；BYOK 先调用 |
| 检查点续跑 | 重新加载 checkpoint → `modelSourceOverrides` 恢复；official client 被调用 |
| 并发 3 个 402 | 只弹 1 个窗；3 个调用共享同一次决策 |
| policy=byok | official client 0 调用；任务 paused |
| official 不可用 | official client 0 调用；按钮禁用；无扣分 |
| official 402 | 不再调 BYOK；`MODEL_OFFICIAL_INSUFFICIENT_CREDIT` |

### 7.4 手动验证（P2）

1. 用真实额度不足的 BYOK Key（或 mock 402）跑一条视频任务 → 弹窗文案正确。
2. 选「官方继续」→ 任务继续；会员中心积分减少；任务横幅显示已消耗。
3. 新建任务 → 仍走 BYOK（若 Key 仍不足 → 再弹窗）。
4. 勾选「记住选择」+ 官方 → 设置页显示 `official`；下一个任务额度错误时不再弹窗（在 cap 内）。
5. 断点续跑 → 官方覆盖保留。
6. 官方余额不足 → 弹窗禁用 + 充值引导。

---

## 8. 与官方算力 D-① 的依赖

| 依赖 | 状态 | 影响 |
|---|---|---|
| `POST /api/v1/compute/execute` | ⛔ 未实现（D-①） | P2 之前 `OfficialComputeClient` 不可用；P1 只能做错误提示/设置（D-11 禁止单独上线设置） |
| 余额读端点（U-13） | ⛔ 未定 | 无法预检余额；`OfficialStatus.balance=null`；`available=false` |
| 价格卡（U-12） | ⛔ 待定价 | 无价卡 → `no_price`；不能自动切 |
| `credit/consume` | ✅ 已实现（#4458） | 扣分端点在 P2 可复用 |
| `model_usage_events` + 状态机 | ✅ 已实现（#4463/#4470） | 官方调用可落事件、判定 `byok=0` |

**红线**：`OfficialComputeClient` **不得**：
- 读取/解密 `official_keys`；
- 直连供应商域名；
- 把官方 Key 下发到 renderer；
- 在没有 `idempotencyKey` 的情况下调用扣分/生成。

---

## 9. 回滚与降级

| 场景 | 回滚/降级 |
|---|---|
| P1 分类器误判导致错误弹窗 | 通过 feature flag `modelQuotaFallback.enabled=false` 关闭弹窗；保留原错误提示 |
| P1 设置项异常 | `normalizePolicy` 失败 → `ask`；不阻断模型调用 |
| P2 官方端点故障 | `OfficialStatus.available=false`；降级为 BYOK 提示；不发官方请求 |
| P2 扣分失败 | 按官方算力设计的 `pending_charge` 口径；不显示「已扣除」 |
| 用户投诉被扣积分 | 通过埋点 `model_quota_official_start/result` + `model_usage_events` 对账；可追溯到 run/stage |

---

## 10. 风险与取舍

| 风险 | 等级 | 缓解 |
|---|---|---|
| 供应商把额度伪装成 429 限流 → 漏兜底 | 中 | 文本模式 + 业务码表；漏判时不给官方按钮，用户仍可手动去设置；后续按真实样本补规则 |
| 401 被自动切官方 → 掩盖 Key 填错 | 高 | D-06：`credential_invalid` 永远询问 |
| 官方兜底导致积分被大任务跑光 | 高 | D-08 cap + 预估；`estimate=unknown` 不自动 |
| 切换后重复调用已产生部分输出的请求 | 高 | D-09：只在调用边界切；检查点；同一 attempt 幂等键 |
| 并发弹窗 | 中 | Coordinator 去重 + requestId |
| 官方 Key 泄露 | 极高 | 客户端零持有；只调 ops-center；日志脱敏 |
| 设置项空承诺 | 高 | D-11：官方供给未落地前不上线设置/按钮 |
| 各业务域自建弹窗导致文案漂移 | 中 | 全局单例组件 + `model-quota-labels` 单一映射；CI 扫描禁止域内新写 quota 弹窗 |

---

## 11. 交付物清单（P0 本 PR）

| 文件 | 状态 |
|---|---|
| `01-docs/PRD-MODEL-QUOTA-FALLBACK-2026-10-26.md` | ✅ 新增 |
| `01-docs/DESIGN-MODEL-QUOTA-FALLBACK-2026-10-26.md` | ✅ 新增（本文件） |
| `01-docs/PRD.md` | ✅ 追加附录（摘要 + 链接 + 【规划中】标注） |
| `01-docs/decision-log.md` | ✅ 追加 D-041 |
| `openspec/changes/model-quota-fallback/` | ✅ proposal / design / tasks |
| `openspec/records/model-quota-fallback.md` | ✅ 执行记录 |

## 12. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-26 | v1.0 | 初始设计：分类器 / 策略器 / 协调器 / 运行态覆盖 / 官方客户端 / 测试策略 |
