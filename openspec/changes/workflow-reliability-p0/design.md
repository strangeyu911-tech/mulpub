# Design: 复合工作流可靠性 P0

## 1. 账号预检

### 1.1 注入

`workflowRuntime` 新增可选依赖：

```js
accountProvider?: () => Promise<Array<{ id: string, platform: string, status?: string }>>
```

生产容器注入：

```js
accountProvider: async () => require('../publishers/account-manager').listAccounts()
```

单测不注入时跳过预检，保持既有测试可独立运行；生产必须注入。

### 1.2 判定

在 `startRun` 的 `validateWorkflowConfig` 之后、`ledger.isReadable()` 之前：

| 条件 | 返回 |
| --- | --- |
| provider 抛错 | `{ ok:false, error:'account-check-failed' }` |
| 找不到 `platform + accountId` | `{ ok:false, error:'account-unavailable', accounts:[{ reason:'missing' }] }` |
| `status ∈ {expired,inactive,disabled}` | `{ ok:false, error:'account-unavailable', accounts:[{ reason:status }] }` |
| 全部匹配且可用 | 继续 |

预检在任何采集/改写/生成/排期之前执行，因此不会消耗模型额度或写入账本。

### 1.3 UI

- `WorkflowEditor` 新增 `isAccountUsable(acc)`；`expired/inactive/disabled` 的 checkbox `disabled`，label 加 `wf-chip--off`，状态文案仍显示。
- `AutomationTaskDialog.save` 对 `findAccount()` 结果再做一次状态判断；错误 key `wfAccountsExpired`。
- 账号不存在仍用 `wfAccountsUnavailable`，账号列表加载失败用 `wfAccountsLoadFailed`。

## 2. 队列状态机与幂等

### 2.1 状态

```
pending ──tick 到点──> dispatching ──enqueue 成功──> dispatched
   ^                         │
   │                         ├─ enqueue 失败且 attempts < max ─> pending
   │                         └─ attempts >= max ─> failed
   ├─ 超过 24h ─> missed
   └─ retry(failed/missed/dispatch-uncertain) ─> pending
dispatching ──重启且超过 lease(10min)──> failed(error=dispatch-uncertain, needsReview=true)
```

`dispatching` 在调用 `enqueue` 前写入 store；`dispatchStartedAt` 用于租约判断。`dispatchToken` 仅用于诊断/日志关联。

### 2.2 事件

`createWorkflowPublishQueue({ onEvent })` 在状态变化后回调：

```js
{ ...entry, event: 'dispatching' | 'dispatched' | 'failed' | 'missed' | 'dispatch-uncertain' | 'retry' | 'retry-requested' }
```

回调异常被吞掉并 `log.warn`，不能反向破坏队列 tick。

### 2.3 运行记录回写

`workflowRunner.applyQueueEvent(payload)`：

- 以 `runId` + `itemKey` 定位 item；`itemKey = externalId || url || title`。
- 写 `queueStatus / queueError / queueAttempts / queueAt`。
- `failed/missed/dispatch-uncertain`：item.status=`failed`，summary.scheduled--，summary.failed++（只减一次）。
- `dispatched`：清空 item.error，但**不**把 item.status 改成 published（TaskQueue 只接收，未确认平台发布）。
- `retry-requested`：item.status=`scheduled`，清空 error，等待下一 tick。

### 2.4 队列面板

- `WorkflowRunsDrawer` 打开时调用 `listWorkflowQueue()`，显示摘要和问题条目。
- 问题条目定义：`failed / missed / dispatch-uncertain`。
- 「重试」调用 `retryWorkflowQueueItem(id)`，刷新队列与运行记录。
- `AutomationView` 挂载时读 `queueSummary`，有 failed/missed 时显示黄条；点击打开运行记录。

## 3. API / IPC

| Channel | 返回 |
| --- | --- |
| `automation:queue:list` | `{ code:0, data:{ entries, summary } }` |
| `automation:queue:retry` | `{ code:0, ok, reason? }` |

Preload：`automationListQueue`、`automationRetryQueueItem`。
Renderer API：`listWorkflowQueue()`、`retryWorkflowQueueItem(id)`。

## 4. 错误与提示

| 场景 | 文案 key | 显示 |
| --- | --- | --- |
| 账号过期/未启用（保存） | `wfAccountsExpired` | 表单错误 |
| 账号过期/未启用（Checkbox） | `wfAccountExpired / wfAccountInactive` | 账号行状态 |
| 队列有失败/错过 | `wfQueueBanner` | 自动化页黄条 |
| 队列摘要 | `wfQueueSummary` | 运行抽屉顶部 |
| 队列条目状态 | `wfQueuePending/Dispatching/Dispatched/Failed/Missed/Uncertain` | 条目徽标 |
| 重试 | `wfQueueRetry` | 按钮 |

## 5. 测试策略

- `workflow-runner.test.js`：过期/缺失/账号服务失败三种预检；队列事件回写 failed 与 dispatched。
- `workflow-publish-queue.test.js`：dispatching 先落盘 + 事件顺序；停滞 dispatching 恢复；人工 retry。
- `WorkflowEditor.test.js`：过期账号 disabled 且点击不写入 targets。
- `WorkflowRunsDrawer.test.js`：队列面板展示失败原因、点击重试。
- `AutomationView.test.js`：queue summary 有 failed/missed 时显示黄条。
- `workflow-service.test.js`：队列门面透传。

## 6. 兼容与回滚

- 新增字段均为可选；旧 run 记录没有 `queueStatus` 时 UI 不渲染徽标。
- 旧队列条目没有 `dispatching` 状态，按原 `pending` 路径处理。
- 回滚只需移除 `onEvent` 注入与 UI 队列面板；队列数据不会被破坏。
- `dispatch-uncertain` 是有意保留的人工处理项，不回滚为自动重试。
