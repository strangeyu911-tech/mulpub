## Why

桌面端目前有**两类模型来源**：用户自带 Key（BYOK，用户自己付费）和平台官方模型（官方算力，消耗官方积分）。第二类**尚未落地**（D-① 官方算力代理未实现），但第一类的额度/凭据失败已经每天发生：

- 供应商错误码不统一：OpenAI 用 `429 insufficient_quota`、DeepSeek 用 `402 Insufficient Balance`、MiniMax 用 HTTP 200 + `base_resp.status_code=2056`、Anthropic 用 `400 credit balance is too low`。
- 桌面端已有 `ProviderError` 与 `classifyProviderFailure`，但只到「quota / rate / transient」这一层，**没有变成用户可决策的动作**：用户只看到「请检查模型设置」，任务中断。
- 即使将来官方算力可用，也**没有定义**：额度失败后要不要问用户、用户选了官方之后管多久、下一次任务用谁、会不会偷偷改默认模型、如何避免重复扣积分。

如果不先把这条逻辑定死，直接写代码会出现三种高风险形态：① 把限流/网络误判成额度，诱导用户充值；② 用户选了一次官方，之后所有任务默认扣积分；③ 官方 Key 被下发到客户端或重复扣费。

## What Changes

- **新增产品级错误状态机**：`quota_exhausted` / `credential_invalid` / `rate_limited` / `transient` / `content_policy` / `provider_error` / `unknown`；只有前两类可触发官方兜底，`credential_invalid` **永远询问**，其余**绝不兜底**。
- **新增设置项** `modelQuotaFallbackPolicy`：`ask`（默认）/ `official` / `byok`；`official` 只控制兜底，不改变 BYOK 优先，也不改用户默认模型。
- **新增任务级来源覆盖**：`runContext.modelSourceOverrides[capability] = { source:'official', ... }`；只活在当前 pipeline run + 检查点，不写 `model_providers`；新任务回到 BYOK。
- **新增任务级积分上限** `officialCreditCapPerTask`（默认 500）：预估超过上限时降级为询问；`estimate=unknown` 不自动切。
- **明确官方供给未落地前不单独上线设置项与「使用官方模型」按钮**（避免空承诺）；P0 只交付 PRD/设计/决策，P1 交付错误分类与设置骨架，P2 与 D-① 同批交付官方调用。
- **明确官方模型只覆盖有官方供给的能力**（视频/图像/TTS/ASR）；LLM 官方供给属 U-1 未决项，本 change 不承诺。

## Capabilities

### New Capabilities

- `model-quota-fallback`: 模型额度/凭据失败时的**来源切换契约**——错误状态归一、BYOK 优先、官方兜底的任务级作用域、三档用户策略、任务积分上限、检查点续跑、官方调用幂等与 `byok=0` 成本归属。

## Impact

- **桌面端（P1）**：新增 `model-access-failure.js` / `model-quota-policy.js` / `model-quota-coordinator.js`；扩展 `ProviderRunContext`；`model-provider-manager.callAdapter` 补 `accessState` 等字段；新增 IPC/preload/renderer 组件；各业务域替换 quota 提示。
- **桌面端（P2）**：新增 `official-compute-client.js`，调 ops-center `/api/v1/compute/execute`；不读官方 Key、不直连供应商。
- **ops-center / api-publish-engine**：依赖 D-① 端点、U-13 余额读通道、U-12 价格卡；本 change 不重复实现扣分端点（复用 #4458）与事件状态机（复用 #4463/#4470）。
- **文档**：新增 PRD / DESIGN；在总 PRD 追加附录；decision-log 追加 D-041。
- **不改变**：现有 BYOK 调用链、模型设置 CRUD、ProviderRouter 的 failover 语义（仍不接线）、官方算力计费口径。
