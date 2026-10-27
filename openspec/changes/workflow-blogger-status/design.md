# Design: 博主发现状态回写

## 1. 状态机

```
pending ──工作流成功──> workflow_published（终态，不再被 list pending 取出）
pending ──工作流失败──> failed（保留 last_error，可被后续重试）
```

只允许 `pending|failed ->` 目标状态；`collecting/collected/workflow_published` 不受影响。

## 2. 存储

`creator_discoveries` 复用 `collect_state` 字段，新增值 `workflow_published`：

```sql
UPDATE creator_discoveries
SET collect_state='workflow_published', last_error='', claimed_by=?, updated_at=?
WHERE id=? AND collect_state IN ('pending','failed')
```

失败：

```sql
UPDATE ... SET collect_state='failed', last_error=?, updated_at=?
WHERE id=? AND collect_state IN ('pending','failed')
```

不写 `viral_library`、不写 `collection_outbox`、不扣 `collection_quota_ledger`。

## 3. 回写路径

`workflow-runner` 每条处理完：
- 成功状态（published / scheduled / awaiting_review）→ `sources.markCreatorPublished(item, runId)`；
- failed → `sources.markCreatorFailed(item, error)`；
- skipped/duplicate/collecting/rewriting 等中间态 → 不写。
- 任何回写异常只 push `run.warnings`，不影响已排期/已发布结果。

## 4. UI

博主页发现项：
- pending：显示「采集」按钮；
- workflow_published：显示「已由工作流发布」；
- collected：仍显示「已采集 · 时间」；
- failed：保持既有失败显示/重试逻辑。

## 5. 测试

- `creator-store.test.js`：SQL 只允许 pending/failed；状态值 `workflow_published`；changes=0 返回 false。
- `workflow-source.test.js`：meta.discoveryId 保留；成功/失败回写调用；无 id 跳过。
- `CreatorMonitor.test.js`：workflow_published 文案与无采集按钮。
- runner：现有 26 项回归保持通过。
