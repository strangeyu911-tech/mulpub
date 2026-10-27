# Design: 预算与成本护栏

## 1. 配置

```js
guardrails.budget = {
  enabled: false,
  maxCost: 100,
  currency: 'CNY',
  estimatedCostPerItem: 2.5
}
```

启用后 maxCost 与 estimatedCostPerItem 必须 >0；currency 只允许 CNY/USD。

## 2. 台账

settings key `workflow_budget_ledger`，数组条目：

```json
{ "runId":"...", "workflowId":"...", "cost":5.0, "estimated":true, "currency":"CNY", "createdAt":"..." }
```

- TTL 180 天；最多 2000 条；
- 读取失败视为空台账（不覆盖原值）——与去重账本不同，预算不是安全关键；
- `summary()` 返回 `{currency,maxCost,spent,entries}`；
- `canSpend(amount)`：`remaining = max(0, maxCost - spent)`；`remaining >= amount` 才放行。

## 3. Runner

在采集 + 护栏截断得到 `selected` 后：

1. 若 budget enabled，创建 ledger；
2. `estimatedCost = round(selected.length * estimatedCostPerItem, 2)`；
3. `canSpend` 失败 → `run.error='budget-exceeded'`、finish failed，不创建条目；
4. 成功 → `budgets.set(runId,{ledger,cost})`，run.summary.budgetCost；
5. finish 时 `ledger.record(...)`；写失败追加 warning。

## 4. UI

护栏区 checkbox + 币种 + 总预算 + 每项预估；提示「按每项预估累计占用；不是供应商账单」。
未启用时字段不渲染。

## 5. 错误

| 场景 | 行为 |
| --- | --- |
| maxCost=0 / perItem=0 | 保存拒绝 outOfRange |
| 超预算 | run failed `budget-exceeded` |
| 台账写失败 | run 继续，warnings 记录 `budget` |
| 旧配置无 budget | 归一化为 enabled=false |

## 6. 测试

- `workflow-budget.test.js`：默认、校验、累计、超预算、非法成本。
- schema：默认关闭、启用非法拒绝。
- runner：首次占用、第二次超预算拒绝。
- editor：启用后写 max/perItem。
