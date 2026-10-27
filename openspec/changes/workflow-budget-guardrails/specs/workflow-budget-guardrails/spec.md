# Spec: workflow-budget-guardrails

## ADDED Requirements

### Requirement: 预算预检

启用预算后，运行前必须按 `selected.length × estimatedCostPerItem` 检查剩余预算；超预算整轮失败，不创建条目。

#### Scenario: 超预算
- **GIVEN** maxCost=100，已占用 60，selected=2、perItem=30
- **WHEN** 启动运行
- **THEN** run failed `budget-exceeded`
- **AND** 不创建任何条目

#### Scenario: 预算内
- **THEN** run 继续，并在 finish 时记录估算占用

### Requirement: 估算台账

台账必须明确标记 `estimated:true`，不得把估算写成供应商实际账单。

#### Scenario: 记录
- **WHEN** run 结束
- **THEN** `workflow_budget_ledger` 增加一条 `{runId,cost,estimated:true,currency}`

#### Scenario: 写失败
- **THEN** run 继续，warnings 有 budget 条目

### Requirement: UI 配置

预算字段必须只在启用时显示，并提示「不是供应商账单」。

#### Scenario: 启用
- **WHEN** 勾选预算护栏
- **THEN** 显示币种/总预算/每项预估
