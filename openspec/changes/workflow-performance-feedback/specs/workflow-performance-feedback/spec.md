# Spec: workflow-performance-feedback

## ADDED Requirements

### Requirement: 发布后效果归因

工作流必须通过 `taskId → tracked_content.publish_history_id → performance_snapshot` 归因；不得按账号或时间窗口猜测。

#### Scenario: 有 taskId
- **WHEN** 队列条目已派发且有 taskId
- **AND** tracked_content 的 publish_history_id 等于该 taskId
- **THEN** 参与效果汇总

#### Scenario: 无 taskId
- **THEN** 不参与，返回 0 样本

### Requirement: 最新快照口径

同一作品只取窗口内最新快照，不得跨快照求和。

#### Scenario: 两份快照
- **WHEN** 同一作品有 100 播放与 150 播放两份快照
- **THEN** 只计 150，不计 250

### Requirement: 阈值复核

启用效果复核后，低于阈值必须暂停本次运行且不创建排期。

#### Scenario: 播放低于阈值
- **THEN** run failed `performance-below-views`
- **AND** run.summary.performanceGuard 有 detail
- **AND** 不创建任何条目

#### Scenario: 样本不足
- **THEN** 放行（`insufficient-samples`）

### Requirement: 运行详情显示

运行详情有 performance 时显示样本/平均播放/互动率；无数据不渲染。
