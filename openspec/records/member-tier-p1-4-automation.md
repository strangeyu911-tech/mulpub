# member-tier-p1-4-automation 执行记录

> 分支 `member-tier-p1-4-automation` ｜ worktree `mp-member-tier-p1-4-automation`（D 盘隔离区）
> 上游：`01-docs/PRD-MEMBER-TIER-AUTOMATION-QUOTA-2026-10-28.md`；`01-docs/MECHANISM-MEMBER-TIERS.md` v3.8

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

## 一、一句话

P1-4：`maxWorkflows` 0/10/50 与 `automationDailyItems` 0/50/500 进矩阵；workflow-service 按档位限制自定义模板条数，workflow-runner 按档位与 guardrail 取更严限制每日执行条数；免费档模板保存/运行均有明确提示。

## 二、产出

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/plan-matrix.js` | `maxWorkflows` / `automationDailyItems`；`features.automation_workflow`；`limits.max_workflows` / `automation_daily_items` |
| `packages/api-publish-engine/test/plan-matrix.test.js` | 0/10/50、0/50/500、feature 断言 |
| `apps/desktop/electron/services/workflow-service.js` | `setEntitlementProvider`；save/import 按 `max_workflows`；listTemplates 返回 limits |
| `apps/desktop/electron/services/workflow-service.test.js` | 免费 plan-limit、标准 10 上限、缺失回落 |
| `apps/desktop/electron/services/workflow-plan-limit.js` | 每日条数权益读取纯函数（抽出避免 runner 超 500 行） |
| `apps/desktop/electron/services/workflow-plan-limit.test.js` | 0/50/500、缺失、provider 异常 |
| `apps/desktop/electron/services/workflow-runner.js` | 每日上限与 guardrail 取更严；免费 `plan-daily-limit` |
| `apps/desktop/electron/services/workflow-runner.test.js` | 免费 0、计划 10 更严、既有 20 上限 |
| `apps/desktop/electron/services/workflow-schema.js` | `LIMITS.maxDailyItems` 200 → 500（专业档可用） |
| `apps/desktop/electron/services/workflow-schema.test.js` | 每日上限 500 断言 |
| `apps/desktop/electron/services/automation-scheduler.js` | `_runTask` 失败时回传 `reason` |
| `apps/desktop/electron/bootstrap/phase3-services.js` | 给 workflowService/workflowRunner 注入 entitlement provider |
| `apps/desktop/src/features/automation/AutomationTaskDialog.vue` | `plan-limit` / `limit` → `wfTemplateLimit` |
| `apps/desktop/src/views/AutomationView.vue` | 每日超限 → `errDailyLimit`，`ok:false` 不再误报成功 |
| `apps/desktop/src/locales/automation/{zh,en}.js` | `wfTemplateLimit` / `errDailyLimit` |
| `01-docs/PRD-MEMBER-TIER-AUTOMATION-QUOTA-2026-10-28.md` | 新增 P1-4 PRD |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.8：自动化配额、P1-4 状态、历史 |

## 三、口径

- 模板条数：`saveTemplate`/`importTemplate` 新增才计数；overwrite 已有模板不增加。
- 每日执行：`usedToday` 来自 `workflow-ledger.countToday()`；`effectiveDaily = min(guardrail.dailyItemLimit, planLimit)`。
- 0 是合法上限；缺失/非法 limits → 回落全局 50（模板）/ guardrail（每日）。
- 免费运行 → `plan-daily-limit`；标准/专业超限 → `dailyItemLimit`。

## 四、测试读数

| 项 | 读数 |
|---|---|
| `workflow-service` + `workflow-runner` + `workflow-schema` + `workflow-plan-limit` + `AutomationView` | **84 passed / 5 files** |
| `plan-matrix.test.js` | **22 passed** |
| `api-publish-engine` 全量 | **504 passed / 47 files** |
| `phase3-services.test.js` + 上述 | **96 passed / 4 files**（早前一轮） |
| locale-sync / max-lines / route-registry / doc-abs-paths / eslint | PASS（max-lines 曾因 runner 517 行红，抽出 `workflow-plan-limit` 后通过） |

## 五、QM-1（Electron 打包与启动）

本 PR 改了 `apps/desktop/electron/`，QM-1 必跑。

| 项 | 证据 |
|---|---|
| 构建 | `pnpm run build:vue` → `electron-builder --win --dir --publish never` |
| 产物 | `dist-electron/win-unpacked/Multi-Publish.exe` + `resources/app.asar` |
| asar | 15616 条；logger 8 条；rpa-engine 12 条 |
| require | `require('@multi-publish/rpa-engine')` → **OK** |
| 启动 | 8 秒 `alive=True`；stderr **0 bytes** |
| 环境 | 父环境 `ELECTRON_RUN_AS_NODE=1` 已显式剔除 |

## 六、QM-4（视觉）

- 改动含 AutomationView 提示与 AutomationTaskDialog 错误映射；无布局/样式结构变更。
- QG Visual 随 PR 跑全量。

## 七、QM-6（深度评审）

- 待提交时由 CCG 门禁判定；若判定需要评审，按 `scripts/deep-review.sh` 执行并回写本节。

## 八、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | 简单自动化任务（`automationScheduler` MAX_TASKS=20）的档位拆分 | 后续 |
| 2 | 工作流条数客户端预检（当前靠主进程 reason） | 后续按需 |
| 3 | P1-5 积分 grant/consume、P1-6 设备数 | P1-5/P1-6 |

## CHANGELOG 条目

# 自定义自动化配额：免费 0 / 标准 10 条·50 条·日 / 专业 50 条·500 条·日

- `plan-matrix` 新增 `maxWorkflows` 与 `automationDailyItems`，派生 `automation_workflow`
- `workflow-service` 保存/导入按档位限制工作流条数；`workflow-runner` 每日上限与 guardrail 取更严
- 免费保存模板 `plan-limit`；免费/超限运行 `plan-daily-limit` / `dailyItemLimit`，UI 有提示
- schema 每日上限 200 → 500，允许专业档 500 条
- QM-1：build:vue + electron-builder；asar 15616 条、rpa require OK、8 秒存活、stderr 0
- 测试：84 例工作流 + 22 例矩阵 + 504 例 API
