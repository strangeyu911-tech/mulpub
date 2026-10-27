# Proposal: 预算与成本护栏（P1-11）

## Why

自动工作流可能一次跑几十条内容，用户需要一个总预算护栏，避免「跑完才发现成本超了」。当前没有任何成本上限。

## What Changes

- `guardrails.budget`：
  - `enabled`（默认 false）；
  - `maxCost`（>0）；
  - `currency`（CNY/USD）；
  - `estimatedCostPerItem`（>0）。
- `workflow-budget.js`：
  - 设置键 `workflow_budget_ledger` 记录 `{runId,workflowId,cost,estimated:true,currency,createdAt}`；
  - TTL 180 天、上限 2000 条；
  - `canSpend(amount)` 按累计估算与 maxCost 比较；
  - `summary()` 返回 maxCost/spent/entries。
- runner：开始前按 `selected.length × estimatedCostPerItem` 预检；超预算整轮失败 `budget-exceeded`；结束时把估算占用写入台账。
- UI：护栏区开关、币种、总预算、每项预估。

## 诚实边界

- 记录的是**按配置预估的预算占用**，不是供应商账单；没有真实 usage 时不写成「实际花费」。
- 不做模型/供应商动态定价；用户按自己的单价配置。
- 预算只做运行前拦截 + 台账，不做运行中逐条熔断（本期）。
- 台账写失败不会把已发内容回滚，但会在 run.warnings 记录。

## Impact

- 默认关闭，旧任务无变化。
- 预算叠加按 180 天窗口；不是自然月重置。UI/文档必须说明。
