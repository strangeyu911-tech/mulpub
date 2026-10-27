# Spec: workflow-reliability-p0

## ADDED Requirements

### Requirement: 运行前账号预检

工作流在采集之前必须校验所有非播客发布目标对应的账号仍然存在且可用；校验失败时不得采集、改写、生成或排期。

#### Scenario: 账号过期
- **GIVEN** 任务目标为 `bilibili / a1`
- **AND** `accountProvider()` 返回 `a1` 且 `status=expired`
- **WHEN** `startRun` 被调用
- **THEN** 返回 `{ ok:false, error:'account-unavailable' }`
- **AND** `accounts[0]` 包含 `{ platform:'bilibili', accountId:'a1', reason:'expired' }`
- **AND** 采集与排期调用次数均为 0

#### Scenario: 账号不存在
- **GIVEN** 账号列表中没有目标账号
- **WHEN** `startRun` 被调用
- **THEN** 返回 `account-unavailable`，`reason=missing`，不进入采集

#### Scenario: 账号服务不可用
- **GIVEN** `accountProvider()` 抛错
- **WHEN** `startRun` 被调用
- **THEN** 返回 `account-check-failed`，不进入采集

#### Scenario: UI 禁止选择过期账号
- **GIVEN** `WorkflowEditor` 收到 `status=expired` 的账号
- **WHEN** 渲染账号列表
- **THEN** 该账号 checkbox 为 disabled，显示「登录已过期」
- **AND** 点击不会写入 `publish.targets`

### Requirement: 队列状态回写运行记录

发布队列每次状态变化必须通知运行器，运行记录必须能显示真实派发状态。

#### Scenario: 派发失败
- **GIVEN** 运行条目已排期，`itemKey=t1`
- **WHEN** 队列发出 `{ event:'failed', error:'dispatch boom', attempts:3 }`
- **THEN** `getRun(runId).items[0]` 的 `status=failed`
- **AND** `queueStatus=failed`、`queueError=dispatch boom`、`queueAttempts=3`

#### Scenario: 已交给发布器
- **GIVEN** 运行条目已排期
- **WHEN** 队列发出 `{ event:'dispatched' }`
- **THEN** `queueStatus=dispatched`
- **AND** item.status 仍为 `scheduled`（未确认平台发布）

#### Scenario: 队列面板
- **GIVEN** 队列存在 `status=failed` 的条目
- **WHEN** 打开运行记录抽屉
- **THEN** 顶部显示「发布队列」摘要和该条目的错误
- **AND** 点击「重试」调用 `retryWorkflowQueueItem(id)`

### Requirement: 派发幂等边界

队列在调用 TaskQueue 前必须先把条目置为 `dispatching` 并持久化；进程崩溃后不得自动重复派发不确定条目。

#### Scenario: 正常派发
- **WHEN** 条目到点且 enqueue 成功
- **THEN** 事件顺序为 `dispatching → dispatched`
- **AND** 最终状态为 `dispatched`

#### Scenario: 停滞的 dispatching
- **GIVEN** store 中条目 `status=dispatching` 且 `dispatchStartedAt` 超过 10 分钟
- **WHEN** 应用重启构造队列
- **THEN** 条目变为 `failed`、`error=dispatch-uncertain`、`needsReview=true`
- **AND** tick 不会调用 enqueue

#### Scenario: 人工重试
- **GIVEN** 条目 `status=failed`
- **WHEN** 调用 `retry(id)`
- **THEN** 条目变为 `pending`，`error=''`，`attempts=0`
