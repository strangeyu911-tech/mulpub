# auto-workflow-composer Specification

## Purpose

定义复合型全自动化工作流的配置契约、运行状态机、发布节奏、去重与模板能力，使「来源 → 改写 → 生成 → 节奏 → 多平台发布」可保存、可复用、可审计，并在失败时如实出声。

## ADDED Requirements

### Requirement: 工作流配置强校验

`AutomationTask.action.type = compositeWorkflow` 时，`action.config` SHALL 通过 `validateWorkflowConfig` 校验；非法配置 SHALL 返回 `{ ok:false, reason:'workflow-config', errors:[{field,reason,params}] }`，SHALL NOT 保存为任务。

#### Scenario: 非法视频流水线
- **WHEN** `content.type=video` 且 `videoPipeline` 为空或属于素材型流水线
- **THEN** 校验失败，errors 含 `content.videoPipeline` 的 `empty`/`unsupported`

#### Scenario: 播客不要求平台目标
- **WHEN** `content.type=podcast` 且 `publish.targets=[]`
- **THEN** 校验通过；若 `publish.mode=scheduled` 则失败并给 `podcastImmediateOnly`

#### Scenario: 保存非法时间
- **WHEN** `publish.mode=scheduled` 且 `startAt` 在过去或超过 30 天
- **THEN** 校验失败，reason 为 `notFuture`/`beyondHorizon`

### Requirement: 三层运行模型

一次运行 SHALL 包含多个条目；每个条目 SHALL 有独立状态（pending/collecting/rewriting/creating/scheduling/scheduled/published/skipped/failed/awaiting_review）与独立错误。

#### Scenario: 单条失败不拖垮整批
- **WHEN** 第 1 条改写失败且 `failurePolicy=skip`
- **THEN** 第 2 条继续处理；run 终态为 `completed_with_errors`

#### Scenario: abort 立即停
- **WHEN** `failurePolicy=abort` 且第 1 条失败
- **THEN** 第 2 条保持 `pending`，run 终态为 `failed`

### Requirement: 去重先于生成

运行 SHALL 在改写/生成前用「来源键 + 内容指纹」双键查账本；任一命中 SHALL 标记 `skipped` 且不消耗模型额度。账本不可读时 SHALL fail-closed（`ledger-unreadable`），SHALL NOT 覆盖原账本。

#### Scenario: 同一篇改标题后重发
- **WHEN** 来源键不同但内容指纹相同
- **THEN** 条目被判重复并跳过

#### Scenario: 账本损坏
- **WHEN** `workflow_dedupe_ledger` 不是合法 JSON
- **THEN** `startRun` 返回 `ok:false, error:'ledger-unreadable'`，零排期，原值不变

### Requirement: 按平台+账号的随机节奏

发布排期 SHALL 以 `platform:accountId` 为独立队列；同队列相邻两条间隔 SHALL 为 `[minMinutes,maxMinutes]` 内随机整数；不同队列 SHALL 可并行；计划时间 SHALL NOT 落在过去。

#### Scenario: 两条 35 分钟间隔
- **WHEN** cadence=35/35，同一目标两条
- **THEN** 两个 publishAt 相差 35 分钟

#### Scenario: 不同平台首条同时
- **WHEN** 两个目标各一条
- **THEN** 两个首条 publishAt 相同

### Requirement: 持久发布队列

到点发布 SHALL 经 `workflow_publish_queue` 持久队列，通过 `taskQueue.add` 进入与手动发布相同的通道。队列 SHALL 每 30 秒 tick；重启时 `publishAt+24h<now` 标记 `missed`，其余过期项补发并标 `late`；派发失败最多 3 次。

#### Scenario: 过期 2 小时
- **WHEN** 应用重启，队列条目 publishAt 为 2 小时前
- **THEN** 立即派发，`late=true`

#### Scenario: 过期 25 小时
- **WHEN** publishAt 为 25 小时前
- **THEN** 状态 `missed`，不派发

### Requirement: 成本护栏

运行 SHALL 按 `maxItemsPerRun` 与每日额度截断；截断 SHALL 在 summary 中给出 `truncated` 与 `truncateReason`；每日额度用尽 SHALL 整轮失败 `dailyItemLimit`。

#### Scenario: 10 条配置 5 条上限
- **WHEN** 来源 10 条、maxItemsPerRun=5
- **THEN** 只排 5 条，summary.truncated=true、reason=maxItemsPerRun

### Requirement: 模板库

内置模板 SHALL 只读；自定义模板 SHALL 名称唯一（≤40 字符）、配置合法、最多 50 个；导出 JSON SHALL 为 `{version:1,name,description,config}`；导入 SHALL 重新校验。

#### Scenario: 删除内置模板
- **WHEN** 调用 deleteTemplate 且 id 属于内置
- **THEN** 返回 `{ok:false, reason:'builtin-readonly'}`

### Requirement: 审核开关

`review.requireApproval=true` 时，条目生成完 SHALL 停在 `awaiting_review`，run 终态 `awaiting_review`；`approveRun` SHALL 重新排期并写账本；未审核条目不写账本。

#### Scenario: 审核后发布
- **WHEN** run=awaiting_review，调用 approveRun
- **THEN** 条目变为 scheduled，run=completed

### Requirement: 旧任务兼容

`normalizeAutomationTasks` SHALL 保留 `compositeWorkflow` 动作类型与配置；未声明 `action.type` 的旧任务 SHALL 仍按 `fullAutoPipeline` 处理。

#### Scenario: 读回复合任务
- **WHEN** settings 中任务的 action.type=compositeWorkflow
- **THEN** 读回后类型仍为 compositeWorkflow，不降级
