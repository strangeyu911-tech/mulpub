# Spec: workflow-blogger-status

## ADDED Requirements

### Requirement: 工作流消费后回写发现状态

工作流成功处理博主发现项后，必须将其从 pending 移出；失败必须回到 failed 并保留错误。

#### Scenario: 成功
- **WHEN** 条目状态为 published/scheduled/awaiting_review
- **THEN** `collect_state='workflow_published'`
- **AND** 不写 viral_library/outbox

#### Scenario: 失败
- **WHEN** 条目状态为 failed
- **THEN** `collect_state='failed'`
- **AND** `last_error` 保留

#### Scenario: 回写失败
- **THEN** 发布结果不变
- **AND** run.warnings 增加 creatorMonitor 条目

### Requirement: 不冒充 collected

`workflow_published` 是独立状态；不得复用 `collected` 的资产/outbox 语义。

#### Scenario: 状态值
- **THEN** SQL 写 `workflow_published`，不写 `collected`

### Requirement: UI 显示

博主页必须能区分「已由工作流发布」与「已采集」。

#### Scenario: workflow_published
- **THEN** 显示「已由工作流发布」
- **AND** 不显示采集按钮
