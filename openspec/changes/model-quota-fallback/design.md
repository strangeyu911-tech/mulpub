# Design — model-quota-fallback

> 配套：`01-docs/DESIGN-MODEL-QUOTA-FALLBACK-2026-10-26.md`（完整技术设计）、`01-docs/PRD-MODEL-QUOTA-FALLBACK-2026-10-26.md`（产品需求）。
> 本文件只记录**设计决策与替代方案**，不重复 PRD 的文案/验收细节。

## 1. 根决策

| # | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-01 | BYOK 永远优先，官方只做兜底 | 官方优先 / 按价格自动选 | 用户自带套餐是沉没成本；官方优先会在用户不知情时持续扣积分 |
| D-02 | 官方兜底是任务级覆盖（run context + checkpoint），不是全局切换 | 改 `model_providers.is_default` | 改默认会污染设置；任务级可回滚、可审计 |
| D-03 | 默认 `ask`，用户显式设置才自动 | 默认 `official` / 默认 `byok` | 花钱必须知情；默认 `byok` 体验太硬 |
| D-04 | `credential_invalid` 永远询问，即使 `official` 档 | 自动切 | 401 可能是 Key 填错/被撤销，自动切会掩盖配置错误并花钱 |
| D-05 | `rate_limited` / `transient` / `content_policy` / `unknown` 不兜底 | 全部兜底 | 误兜底会绕过限流/内容安全，且重复计费 |
| D-06 | 自动档必须有任务级积分上限（默认 500） | 无上限 | 防止长任务把积分跑光 |
| D-07 | 切换前落检查点，只在下一次调用前切 | 失败后原地重试 | 已产生部分输出的调用重试可能双倍计费 |
| D-08 | 官方调用 `byok=0` + 幂等键 | 客户端估算成本 / 无幂等 | 成本归属正确；防重复扣分 |
| D-09 | 官方供给未落地前不上线设置/按钮 | 先上 UI 后补链路 | 空承诺比没有更差 |
| D-10 | 分类器「结构化码优先、文本兜底、未知保守」 | 纯文本匹配 | 文本匹配会把限流误判成额度；纯结构化码又覆盖不了 MiniMax HTTP 200 |

## 2. 模块边界

```
Renderer
  ├─ ModelQuotaPolicyCard（设置，P1）
  ├─ ModelQuotaFallbackDialog（全局单例，P1）
  └─ 业务域：只消费 errorCode/事件，不直接调 official client

Main
  ├─ model-access-failure.js     纯函数：错误 → AccessFailure
  ├─ model-quota-policy.js       纯函数：AccessFailure + policy + officialStatus → Decision
  ├─ model-quota-coordinator.js  有状态：并发去重 / 设置读取 / 事件 / checkpointPort / telemetry
  ├─ provider-run-context.js     扩展：modelSourceOverrides
  ├─ official-compute-client.js  P2：只调 ops-center，不读官方 Key
  └─ model-provider-manager.js   只补错误字段，不做决策
```

**为什么决策不放进 `callAdapter`**：它是 7 类模型共用的底层调用入口，不知道 run/stage/checkpoint；放进去会把 UI 与流水线语义耦合进底层，且无法做并发去重。

**为什么需要 Coordinator**：同一 run 的并发失败必须共享一个 decision Promise；否则会弹多个窗、重复落检查点、重复扣积分。

## 3. 错误分类顺序

1. 供应商业务码（providerCode）→ 规则表。
2. HTTP 状态（httpStatus）→ 401/403/402/429/5xx/0。
3. `ProviderError.code`（AUTH_FAILED / QUOTA_EXCEEDED / RATE_LIMITED / TIMEOUT / NETWORK_ERROR…）。
4. 文本模式（额度/限流/认证/瞬时）。
5. `unknown`（不兜底）。

**关键陷阱**：`context.statusCode` 在 MiniMax 适配器里是**业务码**（1004/2056），不是 HTTP 状态。P1 必须新增 `httpStatus` / `providerCode`，同时保留 `statusCode` 兼容历史断言。

## 4. 任务级覆盖的生命周期

```
run start → 空
  └─ quota error → decision
       ├─ cancel → run paused；不写覆盖
       ├─ settings → run paused；不写覆盖
       └─ official → checkpoint.save → set override
            └─ 后续调用（同 capability）→ official
                 ├─ success → 继续
                 └─ failure → stop（不再自动换回 BYOK）
run end → 清理内存；run 记录保留「使用过官方」
new run → 空（BYOK 优先）
```

## 5. 与既有机制的关系

| 既有机制 | 关系 |
|---|---|
| `ProviderRunContext.openIfQuota` | 保留：额度错误熔断 BYOK provider；官方兜底是另一条供给链，不解除熔断 |
| `classifyProviderFailure` | 保留：服务重试/熔断；新分类器服务用户提示/兜底；测试锁「quota 集合一致」 |
| `story2video-notifications` | P1 逐步替换为统一 `MODEL_QUOTA_*` 错误码；过渡期两者并存但文案不冲突 |
| `ProviderRouter.executeWithFailover` | **不接线**；BYOK→BYOK failover 是独立 change |
| `usage-reporter` / `byok` | 官方调用必须 `byok=0`；BYOK 保持 1 |
| `credit/consume` | P2 由 ops-center 调用；客户端不直接扣分 |
| `DESIGN-OFFICIAL-COMPUTE-WIRING` §8.4 | 继承「自动切换默认关」；本设计把它细化为三档 + 任务级上限 |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 分类器误判 | 12 条决策优先级 + 供应商码表 + 未知保守 + 单测逐条锁 |
| 并发弹窗 | Coordinator `Map<runId, Map<capability, Promise>>` + requestId 一次性 |
| 重复扣费 | 幂等键 `runId:stageId:attempt`；同一 attempt 重放同键 |
| 官方 Key 泄露 | 客户端零持有；只调 ops-center；日志脱敏 |
| 设置空承诺 | D-09 上线 gate |
| 各域文案漂移 | 全局单例 + `model-quota-labels` 单一映射；CI 扫描禁止域内新写 quota 弹窗 |

## 7. 迁移与兼容

- `ProviderError.context.statusCode` 保留；新增 `httpStatus` / `providerCode` 为**可选**字段；旧调用方不受影响。
- `ModelProviderManager.callAdapter` 返回值只**新增**字段，不删除/改名；旧业务域仍可用 `error`/`message`。
- 设置缺失时默认 `ask`；旧版本读不到新键不崩溃。
- 官方供给未落地时 `OfficialStatus.available=false`，所有官方路径 fail-closed，不产生网络请求。
