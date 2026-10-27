# Proposal: 复合工作流生成中断续跑（P0-3）

## Why

`AutomationScheduler` 对单次运行有 30 分钟硬超时；多条视频串行生成时，进程超时/崩溃会让已经完成的条目丢失，重启后只能整轮重跑。重跑会重复消耗模型额度，且可能重复排期。

## What Changes

- `startRun` 在创建条目后持久化 `run._sources`（未处理源条目的最小快照），每处理完一条清空对应槽位并 `persist(run)`。
- 运行结束时删除 `_sources`，不把源正文留在历史记录里。
- 新增 `workflowRunner.resumeRun(runId)` 与 `resumeInterruptedRuns()`：启动时扫描 `status=running` 且有 `_sources` 的运行，只续跑 `pending/collecting/rewriting/creating` 条目。
- `scheduling` 条目可能已部分入队，无法判断哪些目标已写；续跑时直接标 `failed + resume-scheduling-uncertain`，**不自动重发**。
- 应用启动时在队列恢复之后异步触发 `resumeInterruptedRuns()`，不阻塞主窗口。
- PRD、用户手册、OpenSpec、执行记录同步。

## Non-goals

- 不把生成改成独立队列/独立进程；仍是应用内异步生成，但已具备崩溃后续跑能力。
- 不自动恢复 `scheduling` 条目；这是有意的 fail-closed。
- 不改变 30 分钟调度器超时本身；续跑解决的是「超时后已完成的进度不丢」。

## Impact

- 运行记录新增内部字段 `_sources`（不暴露给渲染层，完成后删除）。
- 启动时可能多一次生成任务恢复；只处理未完成运行，不重复已排期条目。
- 失败语义新增 `resume-source-missing` 与 `resume-scheduling-uncertain`。
