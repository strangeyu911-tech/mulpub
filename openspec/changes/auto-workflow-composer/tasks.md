# Tasks: 复合型全自动化工作流（auto-workflow-composer）

## 1. 配置契约

- [x] 1.1 `workflow-schema.js`：来源/内容/流水线/平台白名单、默认值、字段级校验、5 个内置模板、内容指纹
- [x] 1.2 `workflow-schema.test.js`：16 例（来源/改写/内容/发布/节奏/护栏/模板）
- [x] 1.3 `automation-task.js`：`normalizeAction` 支持 compositeWorkflow，旧动作兼容
- [x] 1.4 `automation-task.workflow.test.js`：4 例（合法/非法/旧动作/读回）

## 2. 计划与去重

- [x] 2.1 `workflow-plan.js`：Pacer、target key、护栏裁决、双键、计划预览
- [x] 2.2 `workflow-plan.test.js`：11 例（节奏/并行/顺延/截断/去重键/预览）
- [x] 2.3 `workflow-ledger.js`：双键账本、TTL 180 天、5000 条上限、损坏 fail-closed
- [x] 2.4 `workflow-ledger.test.js`：6 例

## 3. 来源与运行

- [x] 3.1 `workflow-source.js`：热门选题/关注博主/知乎收藏夹归一化，单源失败隔离
- [x] 3.2 `workflow-source.test.js`：5 例
- [x] 3.3 `workflow-runner.js`：条目状态机、去重、重试、skip/abort、审核、额度
- [x] 3.4 `workflow-runner.test.js`：12 例

## 4. 发布队列

- [x] 4.1 `workflow-publish-queue.js`：持久队列、tick、重启补发/错过、取消、损坏 fail-closed
- [x] 4.2 `workflow-publish-queue.test.js`：6 例

## 5. 接线

- [x] 5.1 `workflow-runtime.js`：现有服务 → runner 依赖；TaskQueue 到点入队
- [x] 5.2 `workflow-service.js` + test：模板 CRUD/导入导出/预览/运行门面
- [x] 5.3 `automation-scheduler.js`：compositeWorkflow 分发 + workflow 摘要 + test
- [x] 5.4 容器注册 `workflowRuntime/workflowRunner/workflowQueue/workflowService`
- [x] 5.5 phase1 context / phase3 启动与清理 / phase5 IPC 依赖
- [x] 5.6 IPC + preload + 渲染 API（模板/预览/运行/审核/取消/元数据）
- [x] 5.7 播客共享宿主（`setSharedEpisodeHost/getSharedEpisodeHost`）

## 6. UI

- [x] 6.1 `AutomationTaskDialog.vue`：任务类型、模板区、5 段配置、触发器、策略、重试
- [x] 6.2 `WorkflowEditor.vue`：来源/改写/内容/发布/节奏与护栏
- [x] 6.3 `WorkflowRunsDrawer.vue`：运行列表、条目详情、审核、取消
- [x] 6.4 `AutomationView.vue`：运行记录入口、动作摘要、空态/错误态
- [x] 6.5 `locales/automation/{zh,en}.js`：全部新增文案成对

## 7. 文档

- [x] 7.1 `01-docs/PRD-AUTO-WORKFLOW-COMPOSER-2026-10-26.md`
- [x] 7.2 `01-docs/USER-MANUAL-AUTO-WORKFLOW-2026-10-26.md`
- [x] 7.3 OpenSpec proposal/design/spec/tasks
- [ ] 7.4 `openspec/records/auto-workflow-composer.md`（提交前补门禁表与 CHANGELOG 条目）

## 8. 验证

- [x] 8.1 13 个测试文件、117 例全绿
- [x] 8.2 `pnpm run build:vue` 通过
- [x] 8.3 ESLint 变更文件 0 error
- [ ] 8.4 CI 全绿（PR 阶段）
- [ ] 8.5 PR 合并后 main push 回读
