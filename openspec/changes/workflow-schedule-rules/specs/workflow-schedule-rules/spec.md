# Spec: workflow-schedule-rules

## ADDED Requirements

### Requirement: 可配置排期窗口

工作流必须支持启用静默时段、工作日与 IANA 时区；未启用时行为与旧版一致。

#### Scenario: 默认关闭
- **WHEN** 配置没有 scheduleRules
- **THEN** enabled=false，排期不受影响

#### Scenario: 跨午夜静默
- **GIVEN** timezone=UTC、weekdays=[1,2]、quiet=23:00–07:00
- **WHEN** 候选时刻为周一 23:30
- **THEN** 排期顺延到周二 07:00

#### Scenario: 周末过滤
- **GIVEN** weekdays=[1]、静默关闭
- **WHEN** 候选为周六 12:00
- **THEN** 排期顺延到周一 00:00

### Requirement: 规则校验

启用时必须拒绝非法时区、空工作日、相同静默起止。

#### Scenario: 非法时区
- **THEN** `scheduleRules.timezone: invalid`

#### Scenario: 空工作日
- **THEN** `scheduleRules.weekdays: empty`

### Requirement: 只影响新排期

已入队条目的 publishAt 不得被规则回改。

#### Scenario: 队列已有条目
- **WHEN** 用户修改规则后再次运行
- **THEN** 新条目使用新规则
- **AND** 旧队列条目保持原 publishAt
