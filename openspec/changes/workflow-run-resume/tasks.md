# Tasks: workflow-run-resume

- [x] 1.1 `startRun` 持久化 `_sources`，逐条清空并 persist
- [x] 1.2 运行结束删除 `_sources`
- [x] 1.3 `resumePersistedRun` 续跑 pending/collecting/rewriting/creating
- [x] 1.4 `scheduling` → `resume-scheduling-uncertain`，不自动重发
- [x] 1.5 `resumeRun` / `resumeInterruptedRuns` 暴露给容器
- [x] 1.6 `phase3-services` 启动异步触发
- [x] 2.1 runner 回归测试（续跑成功）
- [ ] 2.2 全量相关测试 + build + QM-1
- [ ] 2.3 PR/CI 回读
- [x] 3.1 PRD / 用户手册
- [x] 3.2 OpenSpec proposal/design/spec/tasks
