# Spec: workflow-run-resume

## ADDED Requirements

### Requirement: 生成进度可续跑

工作流运行必须持久化未处理源条目；应用重启后必须能继续未完成的生成，而不是整轮重跑。

#### Scenario: 重启续跑 pending 条目
- **GIVEN** persisted run `status=running` 且 `_sources[0]` 存在
- **AND** `items[0].status=pending`
- **WHEN** 调用 `resumeInterruptedRuns()`
- **THEN** 条目重新生成并排期，最终 `status=scheduled`
- **AND** run 最终 `status=completed`

#### Scenario: scheduling 条目不在自动续跑范围
- **GIVEN** persisted run 的 `items[0].status=scheduling`
- **WHEN** 续跑
- **THEN** item 置 `failed`，`error=resume-scheduling-uncertain`
- **AND** 不调用 `schedulePublish`

#### Scenario: 源快照缺失
- **GIVEN** pending 条目的 `_sources[i]` 为 null
- **WHEN** 续跑
- **THEN** item 置 `failed`，`error=resume-source-missing`
- **AND** 不消耗生成额度

### Requirement: 续跑入口不阻塞启动

应用启动时必须在发布队列恢复之后异步触发续跑；续跑失败只记录通知，不阻断窗口。

#### Scenario: 启动触发
- **WHEN** `phase3-services` 完成队列恢复
- **THEN** 调用 `workflowRunner.resumeInterruptedRuns()`
- **AND** 返回 Promise，不 await 阻塞启动
