# Tasks: workflow-reliability-p0

## 1. 账号预检

- [x] 1.1 `workflowRunner` 新增 `accountProvider` 与 `checkAccounts`
- [x] 1.2 预检接入 `startRun`（schema 后、采集前）
- [x] 1.3 容器注入 `account-manager.listAccounts()`
- [x] 1.4 `WorkflowEditor` 禁用过期/未启用账号
- [x] 1.5 `AutomationTaskDialog.save` 二次拦截过期账号
- [x] 1.6 中英文案 `wfAccountsExpired`

## 2. 队列状态回写

- [x] 2.1 队列新增 `onEvent` 与 `emit`
- [x] 2.2 队列状态变化发出事件
- [x] 2.3 `runner.applyQueueEvent` 回写 queueStatus/queueError/queueAttempts/queueAt
- [x] 2.4 run snapshot 暴露队列字段
- [x] 2.5 `WorkflowRunsDrawer` 队列摘要/问题条目/重试
- [x] 2.6 `AutomationView` 队列问题黄条
- [x] 2.7 IPC/Preload/Renderer API `queue:list` / `queue:retry`

## 3. 幂等派发

- [x] 3.1 tick 先写 `dispatching` 再 enqueue
- [x] 3.2 重启恢复停滞 `dispatching` → `dispatch-uncertain`
- [x] 3.3 `queue.retry(id)` 人工重试
- [x] 3.4 队列测试覆盖事件顺序/恢复/重试

## 4. 文档与验证

- [x] 4.1 PRD §7.6/§7.10/§8.1/§8.5
- [x] 4.2 用户手册 §3.4
- [x] 4.3 OpenSpec proposal/design/spec/tasks
- [x] 4.4 全量相关测试 + 构建 + QM-1
- [x] 4.5 执行记录已创建（PR/CI 回读在 PR 评论中另行取证）
