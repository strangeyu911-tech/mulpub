# Proposal: 发布后效果回流与自动复核（P1-12）

## Why

发布队列只证明「已交给发布器」，不证明内容有效果。用户需要看到工作流最近发布作品的播放/互动，并在连续低于阈值时自动暂停，避免继续生产同类低效内容。

## What Changes

- `workflow-publish-queue` 派发时记录 TaskQueue 返回的 `taskId`；该 id 就是发布历史 `tracked_content.publish_history_id`。
- `workflow-performance.js`：纯函数汇总，每个作品只取窗口内**最新**快照，计算 `samples/views/interactions/avgViews/engagementRate`。
- `workflow-performance-runner.js`：按 `workflowId` 取队列 taskId，过滤 `tracked_content.publish_history_id`，再取快照；提供 `checkPerformanceForRun` / `applyPerformanceGuard`。
- `guardrails.performance`：`enabled/windowDays/minSamples/minViews/minEngagementRate`；启用时校验范围。
- runner 在采集/截断后、预算预检前复核；低于阈值 → run failed `performance-below-views|performance-below-engagement`，不创建条目、不排期。
- 运行详情显示效果摘要（样本数/平均播放/互动率）。

## Non-goals

- 不做跨平台播放口径统一（各平台 views 语义不同，按原值展示）。
- 不做自动恢复：阈值调整/新数据后由下一轮运行重新判断。
- 不把账号级快照冒充工作流归因：没有 `taskId` 或没有 `publish_history_id` 的记录不参与。
- 不做实时刷新；数据依赖既有账号指标回流周期。

## Impact

- 默认关闭，旧任务无变化。
- 新工作流样本不足时放行（`insufficient-samples`），避免永远无法起步。
- 归因链断（无 taskId/无 tracked_content）时返回 0 样本，不阻塞。
