# Spec: workflow-p2-composable

## ADDED Requirements

### Requirement: 账号选择逻辑可独立测试

账号分组/搜索/最近使用/健康过滤必须从组件抽到 composable，组件只渲染。

#### Scenario: 同平台多账号
- **WHEN** 同一平台有账号 0 与账号 1
- **THEN** 两者都出现在分组
- **AND** 可同时选中

#### Scenario: numeric 0
- **THEN** `hasAccountId({id:0})` 为 true

### Requirement: 任务配置显式版本

`validateWorkflowConfig` 与默认配置必须返回 `schemaVersion=2`；旧配置缺该字段时归一化为 2。

#### Scenario: 旧配置
- **WHEN** 配置没有 schemaVersion
- **THEN** 返回 config.schemaVersion=2
