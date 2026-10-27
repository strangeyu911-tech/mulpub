# Roadmap: 复合自动化工作流后续优化（2026-10-27）

> 本文件是跨 PR 的执行清单，按用户确认的顺序推进。每个阶段独立 worktree / PR；状态以实际代码与测试为准，不把「计划」写成「已完成」。

## P0 正确性与可靠性

| # | 项目 | 状态 | 落地 |
| --- | --- | --- | --- |
| 1 | 发布前账号预检 + 失效账号禁止选择 | 本 PR | `workflow-runner.checkAccounts`、`WorkflowEditor`、`AutomationTaskDialog` |
| 2 | 队列状态回写运行记录 + 队列面板 | 本 PR | `workflow-publish-queue.onEvent`、`runner.applyQueueEvent`、`WorkflowRunsDrawer` |
| 3 | 生成与发布解耦、断点续跑 | 本 PR | 持久化 `_sources` + `resumeInterruptedRuns`；`scheduling` 条目标 `resume-scheduling-uncertain` 不自动重发 |
| 4 | 派发幂等（dispatching lease） | 本 PR | `dispatching` 先落盘、10 分钟租约、`dispatch-uncertain` 人工确认 |
| 5 | 本地队列常驻保障 | 本 PR（UI）/后续 | 队列失败黄条、队列面板、重试；开机自启/托盘提示后续补 |

## P1 产品价值

| # | 项目 | 状态 | 说明 |
| --- | --- | --- | --- |
| 6 | 抖音爆款来源 + 行业枚举 | 本 PR | 来源=`viral_library` platform=douyin；industry 列 + 共享枚举；不实时抓抖音 |
| 7 | 模板市场/团队共享 + 版本迁移 | 本 PR | 导出 v2 包（format/version/exportedAt）；v1 自动迁移；账号 ID 剥离；导入预览/重名 rename/显式 overwrite；无云端市场 |
| 8 | 账号选择体验（搜索/全选/最近使用/健康状态） | 本 PR | 搜索账号/平台/备注；全选当前结果跳过不可用；清空已选；最近 5 个可用账号；健康汇总 |
| 9 | 按平台/账号内容适配 | 本 PR（文本层） | 标题/正文/标签按平台/账号覆盖；封面/视频比例需媒体管线，未伪实现 |
| 10 | 排期规则（静默时段/工作日/时区/每日上限） | 待做 | 与现有 cadence/guardrails 合并，不另造一套 |
| 11 | 预算与成本护栏 | 待做 | 工作流级预算、预估、实际花费台账 |
| 12 | 发布后效果回流 | 待做 | 阅读/播放/互动数据与自动暂停/复核 |
| 13 | 播客宿主下沉 | 待做 | 不要求先打开播客页 |
| 14 | 博主发现项状态回写 | 待做 | `markCollected/finalizeCollected` |

## P2 工程质量与体验

| # | 项目 | 状态 | 说明 |
| --- | --- | --- | --- |
| 15 | 拆分 `AutomationTaskDialog` / 提取账号 composable | 待做 | 400+ 行，账号清洗逻辑独立可测；`platformLabel` 去重 |
| 16 | 队列/账本可观测与导出/重置 | 待做 | 本 PR 已有队列面板；账本导出/重置后续 |
| 17 | 配置版本迁移 | 待做 | `schemaVersion` 升级与旧配置迁移 |
| 18 | E2E/视觉回归 | 待做 | 账号多选/模板应用/失效账号/队列恢复/跨机器模板 |
| 19 | 性能（账号虚拟列表、队列批量） | 待做 | 账号上百、队列上限提升前先做索引/分批 |
| 20 | 模板/任务账号语义显式类型 | 待做 | `allowEmptyAccounts` 常量/类型化，防误用 |

## 验收口径

- 每个 PR：TDD 红→绿、相关全量测试、`build:vue`、locale 对称、QM-1（改 Electron 时）、QM-6（M+）、执行记录、PR CI 全绿后 squash merge。
- 不把「队列已交给 TaskQueue」写成「平台已发布」；发布确认仍以发布历史为准。
- `dispatch-uncertain` 只人工确认，不自动重试。
