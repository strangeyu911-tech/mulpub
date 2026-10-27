# Design: 复合工作流生成中断续跑

## 1. 持久化边界

`startRun` 建好 `run.items` 后：

```js
run._sources = selected.map((src) => ({ ...src }))
persist(run)
```

每处理完一条：

```js
run._sources[i] = null
persist(run)
```

`finish` 前 `delete run._sources`，历史 run 不保留正文。`snapshotRun` 不输出 `_sources` / `_config`。

## 2. 续跑状态机

| 持久化 item.status | 续跑动作 |
| --- | --- |
| `pending / collecting / rewriting / creating` | 重置为 `pending`，用 `_sources[i]` 重新生成并排期 |
| `scheduling` | 标 `failed`，错误 `resume-scheduling-uncertain`，不自动重发 |
| `scheduled / published / awaiting_review / failed / skipped` | 保持原状，不重复 |

缺 `_sources[i]` 的 pending 条目 → `failed + resume-source-missing`。

## 3. 入口

`workflowRunner.resumeRun(runId)`：
- 加载 live 或 persisted run；要求 `status=running` 且 `_sources` 是数组。
- 用 `now()` 建新 pacer；只续跑未完成条目。
- 返回 `{ok,status,processed,failed}`，最终状态规则与 `startRun` 一致。

`resumeInterruptedRuns()`：
- 扫描 persisted runs 中 `status=running && _sources` 的项。
- 串行续跑，单个失败只 warn，不阻断其他运行。
- 返回 `{resumed,total}`。

`phase3-services` 在 `workflowQueue.start()` 之后异步调用，失败写 `workflow-run-resume-failed` 通知；不阻塞启动。

## 4. 为什么 scheduling 不自动重试

多目标排期是逐条写队列；第 N 个失败时已回滚前 N-1 个，但崩溃可能发生在回滚前。此时无法判断队列里是否已有条目。自动重跑会产生重复发布；因此标 `resume-scheduling-uncertain` 交人工在运行记录/队列面板确认。

## 5. 测试

- `workflow-runner.test.js`：构造 running + `_sources` 的 persisted run，`resumeInterruptedRuns` 重新排期并置 completed。
- `phase3-services.test.js`：启动顺序与通知不回归。
- 既有 startRun 测试验证增量 persist 不改变结果。
