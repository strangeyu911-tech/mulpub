# member-tier-p1-3-schedule 执行记录

> 分支 `member-tier-p1-3-schedule` ｜ worktree `mp-member-tier-p1-3-schedule`（D 盘隔离区）
> 上游：`01-docs/PRD-MEMBER-TIER-SCHEDULE-LIMIT-2026-10-27.md`；`01-docs/MECHANISM-MEMBER-TIERS.md` v3.7

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

## 一、一句话

P1-3：`maxScheduledTasks` 0/100/-1 进矩阵与 entitlement；主进程 `scheduler:create` 统计待执行单篇 + scheduled 批次并返回 `SCHEDULE_LIMIT_EXCEEDED`；客户端免费档在 IPC 前拦截，标准第 101 个由主进程拒。

## 二、产出

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/plan-matrix.js` | `maxScheduledTasks` 0/100/-1；NUMERIC_KEYS/UNLIMITED_ALLOWED；`limits.max_scheduled_tasks` |
| `packages/api-publish-engine/test/plan-matrix.test.js` | 三档 0/100/-1 断言 |
| `apps/desktop/src/features/member/plan-limits.js` | `maxScheduledTasksOf` / `canScheduleTask` / `scheduleLimitState` |
| `apps/desktop/src/features/member/plan-limits.test.js` | 读取/边界/缺失/展示态 4 例 |
| `apps/desktop/electron/services/schedule-quota.js` | 纯函数：读取上限、过滤待执行、统计 scheduled 批次 |
| `apps/desktop/electron/services/schedule-quota.test.js` | 4 例（0/100/-1、终态、批次同池） |
| `apps/desktop/electron/core/error-codes.js` | `SCHEDULE_LIMIT_EXCEEDED=-31` |
| `apps/desktop/electron/ipc-handlers/scheduler.js` | `scheduler:create` 创建前判上限；计数含批次；返回 -31 |
| `apps/desktop/electron/ipc-handlers/scheduler.test.js` | 免费拒 / 100 拒 / 99 放行 / 批次同池 / 缺失放行 |
| `apps/desktop/src/composables/usePublishFlow.js` | `getEntitlement` 注入；免费档 `scheduleTargets` 在 IPC 前抛错 |
| `apps/desktop/src/composables/usePublishFlow.test.js` | 免费档不调用 `schedulerCreate` |
| `apps/desktop/src/composables/useBatchPublish.js` / `runBatchPublish.js` | 批量排期免费档在 batchCreate 前拦截 |
| `apps/desktop/src/views/Publish.vue` | 传 `getEntitlement: () => identityStore.entitlement` |
| `apps/desktop/src/locales/publish-page/{zh,en}.js` | 单篇/批量 `scheduleUpgradeRequired` |
| `01-docs/PRD-MEMBER-TIER-SCHEDULE-LIMIT-2026-10-27.md` | 新增 P1-3 详细 PRD |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.7：定时任务状态、P1-3 状态、历史 |

## 三、计数口径

- 单篇 scheduler：`pending` / `submitted` / `dispatching`（无 status 兼容）计入；`executed` / `failed` / `cancelled` 不计。
- 批量：`batch_jobs.status === 'scheduled'` 计入；与单篇共用同一个池。
- 缺失/非法 `max_scheduled_tasks` → null（放行）；0 是合法上限（第 1 个即拒）；-1 不限。

## 四、测试读数

| 项 | 读数 |
|---|---|
| `scheduler` + `schedule-quota` + `plan-limits` + `usePublishFlow` + `useBatchPublish` | **204 passed / 5 files** |
| `Publish.test.js` | **110 passed** |
| `plan-matrix.test.js` | **22 passed** |
| `api-publish-engine` 全量 | **504 passed / 47 files** |
| `check-locale-sync` / `check-max-lines` / `check-route-registry` / `check-doc-abs-paths` / eslint | **PASS** |

## 五、QM-1（Electron 打包与启动）

本 PR 改了 `apps/desktop/electron/`，QM-1 必跑。

| 项 | 证据 |
|---|---|
| 首次构建 | `electron-builder --win --dir` 成功，但启动报 `ERR_FILE_NOT_FOUND .../dist/index.html`（stderr 297 bytes）⇒ 只打包了 Electron 壳，未先构建渲染层 |
| 修复 | 先跑 `pnpm run build:vue`（preload + paginator + vite），再 `electron-builder --win --dir` |
| 产物 | `dist-electron/win-unpacked/Multi-Publish.exe` + `resources/app.asar` |
| asar | 15612 条；`logger` 8 条；`@multi-publish/rpa-engine` 12 条 |
| require | 解包后 `require('@multi-publish/rpa-engine')` → **OK** |
| 启动 | 8 秒 `alive=True`；stderr **0 bytes** |
| 环境 | 父环境 `ELECTRON_RUN_AS_NODE=1` 已显式剔除后再启动 |

> QM-1 结论：**通过**（以「先 build:vue 再打包」的最终产物为准；首次失败是缺失渲染层构建，不是代码缺陷）。

## 六、QM-4（视觉）

- 改动含 `Publish.vue` 的 props 注入与文案，但无 DOM/CSS 结构变更；免费档定时提示是既有发布结果区文案。
- QG Visual 随 PR 跑全量。

## 七、QM-6（深度评审）

- 待提交时由 CCG 门禁判定；若判定需要评审，按 `scripts/deep-review.sh` 执行并回写本节。

## 八、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | `batch:schedule` 主进程配额（该通道当前未注册，属既有死路径） | 后续接线时补 |
| 2 | 自定义自动化配额 | P1-4 |
| 3 | 官方积分 grant/consume | P1-5 |
| 4 | 设备数 | P1-6 |

## CHANGELOG 条目

# 定时任务会员上限：免费 0 / 标准 100 / 专业不限

- `plan-matrix` 新增 `maxScheduledTasks`（0/100/-1）与 `limits.max_scheduled_tasks`
- `scheduler:create` 创建前统计待执行单篇 + scheduled 批次；超限返回 `-31 SCHEDULE_LIMIT_EXCEEDED`
- 单篇/批量排期免费档在客户端 IPC/batchCreate 前拦截；标准第 101 个由主进程拒
- QM-1：先 `build:vue` 再 electron-builder；asar 15612 条、rpa-engine require OK、8 秒存活、stderr 0
- 测试：204 例桌面 + 110 例 Publish + 22 例矩阵 + 504 例 API

> 评审前定稿：P1-3 代码与文档基线。
