# member-tier-p0-batch-entitlement 执行记录

> 分支 `member-tier-p0-batch-entitlement` ｜ worktree `mp-member-tier-p0-batch-entitlement`（D 盘隔离区）
> 上游：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.3 §10 P0-4；`01-docs/PRD-MEMBER-TIER-BATCH-ENTITLEMENT-2026-10-27.md`

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

## 一、一句话

P0-4：批量发布 UI 从旧 `licenseStore.isPro` 改读 entitlement `limits.batch_size_per_run`，纯订阅用户可批量；云 `/batch-publish` 改为「先判数量上限、再扣 cloud_publish 额度」，被拒不扣额。

## 二、产出

| 文件 | 变更 |
|---|---|
| `apps/desktop/src/composables/useBatchPublish.js` | `entitlement` / `getEntitlement` 注入；`checkBatchAccess`、`addArticle`、`seedArticlesFromDrafts` 按 `batch_size_per_run` 收口；移除 `licenseStore.isPro` |
| `apps/desktop/src/composables/runBatchPublish.js` | 提交前二次判据 `getBatchLimit`；超限不创建批次 |
| `apps/desktop/src/views/Publish.vue` | 移除 `useLicenseStore`，传 `getEntitlement: () => identityStore.entitlement` |
| `apps/desktop/src/features/member/plan-limits.js` | 接线状态注释：`batchSizePerRunOf` / `canBatchSize` 已接线 |
| `packages/api-publish-engine/src/publish-api-server.js` | `/batch-publish` 先 `assertPlanCapabilitiesForRequest`，再 `_authorizeImmediateEntry` |
| `apps/desktop/src/composables/useBatchPublish.test.js` | 6 个档位/上限用例 + 提交前复核 |
| `packages/api-publish-engine/test/publish-permission-recheck.test.js` | 402 不扣额集成用例 |
| `01-docs/PRD-MEMBER-TIER-BATCH-ENTITLEMENT-2026-10-27.md` | 新增 P0-4 详细 PRD |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.3：P0-4 状态、批量矩阵、缺陷 B/C 闭环 |

## 三、数据契约

- `batch_size_per_run`：免费 1 / 标准 10 / 专业 -1。
- 桌面本地批量按**文章条数**；云 `/batch-publish` 按**平台数**（一篇文章 × N 平台）。
- 缺失/非法 → 放行；`0/1` UI 视为不提供批量；`-1` 不限。

## 四、测试读数

| 项 | 读数 |
|---|---|
| `useBatchPublish.test.js` + `useBatchPublish.batch-entitlement.test.js` | **81 + 10 = 91 passed** |
| `Publish.test.js` + 批量两文件 + `plan-limits.test.js` | **214 passed / 4 files** |
| `publish-permission-recheck.test.js` + `plan-capabilities.test.js` + `plan-matrix.test.js` + `plan-capabilities-wiring.test.js` | **44 passed** |
| `api-publish-engine` 全量 | **504 passed / 47 files** |
| `eslint`（改动文件） | rc=0 |
| `check-locale-sync` | 待跑（本 PR 未新增文案 key） |
| `check-max-lines` | 待跑 |

## 五、QM-1

- 本 PR 未改 `apps/desktop/electron/` 或 `packages/rpa-engine/`，QM-1 **N/A**。
- 渲染层批量模式为条件态，默认发布页布局不变；QG Visual 负责像素回归。

## 六、QM-4（视觉）

- 改动是批量模式开启后的交互与上限；默认发布页（`batchMode=false`）DOM 不变。
- 不新增全局样式；`Publish.vue` 仅删除 `useLicenseStore` 并换参数。QG Visual 在 PR CI 验证。

## 七、QM-6（深度评审）

- 待提交时由 CCG 门禁判定；若判定需要评审，按 `scripts/deep-review.sh` 执行并回写本节。

## 八、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | 云 `/publish` 同样「先判后扣」（当前平台轴全 -1，无触发面） | P1 观察 |
| 2 | 定时任务 `schedule_batch` 计数 | P1-3 |
| 3 | 自定义自动化配额 | P1-4 |
| 4 | 官方积分 grant/consume | P1-5 |
| 5 | 设备数会话判据 | P1-6 |

## CHANGELOG 条目

# 批量发布档位门禁：纯订阅可批量，云批量先判后扣

- 批量 UI 改读 `entitlement.limits.batch_size_per_run`，移除 `licenseStore.isPro` 误拦；标准/专业纯订阅用户可批量
- 桌面批量按文章条数收口：免费 1 条不提供批量，标准 10 篇，专业不限；`addArticle`/热门选题交接/提交前三重判据
- 云 `/batch-publish` 改为先判 `batch_size_per_run` 再扣 `cloud_publish`，402 被拒不扣额
- 新增 P0-4 PRD，机制文档升 v3.3，缺陷 B/C 闭环
- 测试：批量 UI 91、Publish 组合 214、服务端 44、API 全量 504
