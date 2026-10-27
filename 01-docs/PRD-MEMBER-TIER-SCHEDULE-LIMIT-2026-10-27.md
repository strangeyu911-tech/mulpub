# PRD — 定时任务数量上限（P1-3，v1.0）

> **状态**：🟢 已实现（2026-10-27）
> **上游机制**：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.7 §4.3/§6.2/§10
> **数值真源**：`packages/api-publish-engine/src/auth/plan-matrix.js`
> **执行记录**：`openspec/records/member-tier-p1-3-schedule.md`

---

## 1. 背景

v3.1 机制把定时任务定为功能轴：免费不可建；标准 100 个；专业不限。`schedule_batch` feature 已在矩阵里，但客户端没有消费点，主进程 `scheduler:create` 也只要求登录——免费用户可以直接创建无限定时任务。

P1-3 目标：**免费 0 个；标准 100 个；专业不限**，并在客户端与主进程双层执行。

## 2. 数据契约

| 档位 | `scheduleBatch` | `maxScheduledTasks` | `features.schedule_batch` | 可建定时任务 |
|---|---|---|---|---|
| 免费 | `false` | `0` | 无 | 0 个（第 1 个即拒） |
| 标准 | `true` | `100` | 有 | 最多 100 个 |
| 专业 | `true` | `-1` | 有 | 不限 |

`entitlement.limits.max_scheduled_tasks` 随签名快照下发，客户端 `plan-limits.js` 只读。

## 3. 计数口径

`max_scheduled_tasks` 统计「待执行」排期，不统计历史：

| 来源 | 计入条件 |
|---|---|
| 单篇定时任务（`scheduler:*`） | `status` 为 `pending` / `submitted` / `dispatching`，或无 status 的历史兼容数据 |
| 批量排期批次（`batch_jobs`） | `status === 'scheduled'` |
| 终态 | `executed` / `failed` / `cancelled` 不计 |

单篇与批量共用同一个池：99 个单篇 + 1 个已排期批次 = 100，再建即拒。

## 4. 执行点

### 4.1 主进程 `scheduler:create`（权威）

```
读取 entitlement.limits.max_scheduled_tasks
  ├─ 缺失/非法 → null → 放行（fail-open）
  ├─ -1 → 放行
  └─ 0 / 100 → 统计 pending 单篇 + scheduled 批次
       ├─ current < limit → 创建
       └─ current >= limit → 返回 -31 SCHEDULE_LIMIT_EXCEEDED
```

返回：

```json
{
  "code": -31,
  "errorCode": "SCHEDULE_LIMIT_EXCEEDED",
  "message": "当前套餐最多创建 100 个定时任务（已有 100 个），请升级后重试",
  "data": { "current": 100, "limit": 100 }
}
```

免费档文案：「当前套餐不支持定时任务，请升级后重试」。

### 4.2 客户端 `usePublishFlow.scheduleTargets`

- `maxScheduledTasksOf(getEntitlement()) === 0` → 在调用任何 `schedulerCreate` 之前抛错，文案 `publishPage.publishFlow.scheduleUpgradeRequired`。
- 标准/专业继续走 IPC；100 上限由主进程返回的 `SCHEDULE_LIMIT_EXCEEDED.message` 透传到发布结果。
- `getEntitlement` 缺失 → `maxScheduledTasksOf(null) = null` → 放行（旧测试/旧快照兼容）。

### 4.3 客户端批量排期 `runBatchPublish`

- `scheduleEntries.length > 0 && getScheduleLimit() === 0` → `notifyWarning('publishPage.batchNotify.scheduleUpgradeRequired')` 并 return，**不创建批次**。
- 标准/专业继续；批量排期与单篇共享计数池（主进程单篇创建时统计批次）。

## 5. 边界

| 场景 | 行为 |
|---|---|
| 免费第 1 个定时任务 | 客户端文案 + IPC -31；handler 不落盘 |
| 标准第 100 个 | 允许；第 101 个 -31 |
| 标准 99 个 + 1 个 scheduled 批次 | 第 101 个单篇被拒（共用池） |
| 执行完/失败/取消的旧任务 | 不计数，不阻塞新任务 |
| limits 缺失/非法 | 放行（不误拦旧快照付费用户） |
| 专业 -1 | 永远放行 |
| 开发/未打包 | 与其它 feature 同口径，不额外缩短；生产包主进程强制 |

## 6. 提示文字

| key | 中文 | English |
|---|---|---|
| `publishPage.publishFlow.scheduleUpgradeRequired` | 当前套餐不支持定时任务，请升级后重试 | Scheduled publishing is not available on your current plan. Please upgrade and retry. |
| `publishPage.batchNotify.scheduleUpgradeRequired` | 当前套餐不支持定时任务，请升级后重试 | Scheduled publishing is not available on your current plan. Please upgrade and retry. |
| 主进程 0 档 | 当前套餐不支持定时任务，请升级后重试 | — |
| 主进程 100 档 | 当前套餐最多创建 100 个定时任务（已有 100 个），请升级后重试 | — |

## 7. 验收标准

- [ ] 免费档点「定时发布」：不调用 `schedulerCreate`，显示升级文案。
- [ ] 免费档直接 invoke `scheduler:create`：返回 `-31`，不落盘。
- [ ] 标准档第 100 个成功、第 101 个 `-31`。
- [ ] 专业档 `-1` 不限。
- [ ] 终态任务不计数。
- [ ] 99 个单篇 + 1 个 scheduled 批次 = 100，再建被拒。
- [ ] limits 缺失时放行。
- [ ] 既有单篇/批量发布回归不红。

## 8. 非目标

- 不新增独立「定时任务管理页」；复用 Calendar 与发布页。
- 不实现批量 `batch:schedule` 的主进程配额（该通道未注册，属既有死路径；批量排期在客户端先拦免费档）。
- 不改定时任务平台能力/提前量校验。

## 9. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| 矩阵 | `plan-matrix.test.js` | 0/100/-1 + limits 下发 |
| 纯函数 | `plan-limits.test.js` | 读取/边界/缺失/展示态 |
| 主进程 | `schedule-quota.test.js` | 状态过滤、批次同池、0/100/-1 |
| IPC | `scheduler.test.js` | 免费拒、100 拒、99 放行、批次计数、缺失放行 |
| 客户端 | `usePublishFlow.test.js` | 免费档 IPC 前拦截 |
| 回归 | `useBatchPublish*.test.js` | 批量排期不回归 |
