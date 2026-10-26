# Proposal: 复合型全自动化工作流（auto-workflow-composer）

## Why

现有「自动化」模块的动作只有 `fullAutoPipeline`，配置是自由对象，只能表达 URL/RSS 采集。用户真正需要的是把「来源 → 改写 → 内容类型/视频流水线 → 同账号批量发布间隔 → 发布账号」拼成一条可保存、可复用、可审计的工作流，并且预设模板（例如「知乎收藏夹新文章 → 故事讲述视频 → 35–40 分钟间隔 → 多平台多账号」）。

同时，现有发布链路存在三个结构性事实，必须在设计里正面处理：

1. **平台侧定时只有头条取证通过**（`platform-schedule-capability.json`：1 个 `api`、14 个 `unsupported`）。把批量间隔硬塞进 `scheduler.create` 会在第二个平台被阻断。
2. **发布历史不写正文、没有 content_hash**，无法只靠历史做「同一篇改标题重发」的去重。
3. **现有间隔守卫是最小间隔 + 单边抖动**，不是 min–max 随机窗口，无法表达 35–40 分钟。

## What Changes

- `AutomationTask.action` 新增 `compositeWorkflow` 类型与强校验的 `config`（来源/改写/内容/发布/节奏/护栏/审核/去重）。
- 新增工作流运行时：来源适配（热门选题/关注博主/知乎收藏夹）、去重账本、条目状态机、视频流水线参数化、播客共享宿主、持久发布队列。
- 新增模板库（5 个内置只读 + 自定义 + 导入/导出）。
- 新增 IPC 与渲染层：任务类型切换、模板区、5 段配置、计划预览、运行记录抽屉、审核动作。
- 旧 `fullAutoPipeline` 任务行为保持不变。

## Impact

- 受影响能力：desktop automation、publish queue、publish history/去重、podcast episode host、i18n。
- 数据：新增 settings 键 `workflow_runs`、`workflow_publish_queue`、`workflow_dedupe_ledger`、`workflow_templates_custom`；不改 SQLite schema。
- 兼容：`normalizeAutomationTasks` 保留动作类型；旧任务读取不受影响。
- 风险：本地队列依赖应用常驻；播客宿主初始化依赖播客页；博主发现项状态不回写（见 PRD §14）。

## Non-goals

- 抖音爆款来源（无数据源、无行业枚举）。
- 自由画布 DAG 编排。
- 云端调度。
