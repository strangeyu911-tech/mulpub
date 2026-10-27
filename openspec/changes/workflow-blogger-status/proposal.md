# Proposal: 博主发现状态回写（P1-14）

## Why

工作流从博主监控取走 pending 发现项后，发现项仍停在 `pending`；下一轮工作流会再次取到同一条，用户也无法从博主页判断它已被工作流消费。

## What Changes

- `workflow-source.normalizeCreatorItem` 保留 `meta.discoveryId`。
- `workflow-source` 新增 `markCreatorPublished` / `markCreatorFailed`，调用 creatorStore 新方法。
- `creator-store.discoveries` 新增 `markWorkflowPublished(id,runId)` / `markWorkflowFailed(id,message)`：
  - 只从 `pending|failed` 迁到 `workflow_published`（成功）或 `failed`（失败）；
  - **不冒充 collected**：不写 viral_library、不写 outbox、不消费收藏配额；
  - 条件更新，状态不符返回 `invalid_state_or_missing`。
- runner 在条目成功（published/scheduled/awaiting_review）或失败后回写；回写失败只进 warnings，不影响发布结果。
- 博主页新增「已由工作流发布」显示，不再显示空白采集时间。

## Non-goals

- 不改变 creator runtime 的 claim/lease/fencing 采集链。
- 不把工作流条目写成 `collected` 资产（那会伪造 viral_library 资产与 outbox）。
- 不做跨工作流去重（仍由 workflow ledger 双键负责）。

## Impact

- 发现项成功消费后离开 pending 列表，避免重复取用。
- 失败项回到 failed，可被后续重试；last_error 保留。
- 旧数据无 discoveryId 时回写 skipped。
