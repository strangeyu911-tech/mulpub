# Proposal: 复合工作流可靠性 P0（账号预检 / 队列回写 / 幂等派发）

## Why

账号级发布目标已经落地，但运行链路还有三个会直接造成「发不出去 / 不知道卡在哪 / 重复发」的缺口：

1. **账号只在保存时校验，运行前不校验**：账号在保存后过期、被删除或后端不可用时，任务仍会照常采集、改写、生成，直到到点派发才失败。用户花了模型额度，却得到一批没有发出去的内容。
2. **队列状态不回写运行记录**：`workflow_publish_queue` 的 `failed / missed` 只存在于队列 JSON 和日志；运行记录里的条目仍是 `scheduled`，用户在「运行记录」里看不到真正原因。
3. **派发没有幂等边界**：旧实现先 `await enqueue` 再标记 `dispatched`。如果 TaskQueue 已接收、进程在标记前崩溃，重启后条目仍在 `pending`，会再次派发，可能重复发布。

## What Changes

- **运行前账号预检**：`workflowRunner.startRun` 在 schema 校验之后、采集之前调用 `accountProvider`；账号不存在、`expired / inactive / disabled`、账号服务不可用三种情况 fail-closed，不采集/不改写/不排期。
- **UI 账号状态**：`WorkflowEditor` 对不可用账号禁用复选框并显示状态；`AutomationTaskDialog.save` 对已过期/未启用账号再次拦截，防止绕过 UI。
- **队列状态回写**：队列新增 `onEvent` 回调；每个状态变化通知 `runner.applyQueueEvent`，运行条目新增 `queueStatus / queueError / queueAttempts / queueAt`，失败时同步修正 run summary。
- **派发幂等边界**：tick 先把条目置 `dispatching` 并落盘，再调用 TaskQueue；成功后置 `dispatched`。重启时超过 10 分钟租约的 `dispatching` 标 `failed + dispatch-uncertain + needsReview`，不自动重发。
- **队列面板**：运行记录抽屉顶部显示队列摘要；失败/错过/派发不确定条目显示原因与「重试」；自动化页顶部在存在队列问题时显示黄条。
- **人工重试**：`queue.retry(id)` 只允许失败/错过/派发不确定，重置为 `pending`，不自动无限重试。

## Non-goals

- 不在本期实现生成/发布彻底解耦与断点续跑（P0-3，下一阶段）。
- 不改变平台侧定时能力；队列仍是本地持久队列。
- 不实现跨进程分布式锁；幂等边界只在单应用进程 + 持久队列范围内成立。
- 不自动重试 `dispatch-uncertain`：宁可人工确认，也不重复发布。

## Impact

- 受影响运行路径：`workflow-runner.startRun`、`workflow-runtime` 队列构造、`workflow-publish-queue`、Automation IPC/Preload/Renderer。
- 数据字段：run item 新增 4 个可选字段；queue entry 新增 `dispatchStartedAt / dispatchToken / needsReview`；均为向后兼容的增量字段。
- 用户可见：账号不可用时保存被拦截；运行记录/队列面板显示真实派发状态；可人工重试失败条目。
- 风险：`dispatching` 崩溃窗口会留下 `dispatch-uncertain`，需要用户确认；这是有意的 fail-closed，不是静默丢失。
