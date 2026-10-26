# Tasks: 账号级发布目标

## 1. 测试先行

- [x] 1.1 `workflow-schema.test.js`：空 `accountId` 严格拒绝；内置模板用 `allowEmptyAccounts` 通过
- [x] 1.2 `workflow-runner.test.js`：空账号 `startRun` 返回 `invalid-config`，不排期
- [x] 1.3 `WorkflowEditor.test.js`：账号分组渲染、同平台多选、空态
- [x] 1.4 `AutomationView.test.js`：未选账号保存被拦截；多账号 payload 带真实 accountId

## 2. 实现

- [x] 2.1 `workflow-schema.js`：`allowEmptyAccounts` 选项 + target.accountId 严格校验
- [x] 2.2 `workflow-service.js`：模板保存/导入允许平台建议
- [x] 2.3 `WorkflowEditor.vue`：账号多选 UI，替换平台 chips
- [x] 2.4 `AutomationTaskDialog.vue`：加载账号、模板/旧任务 sanitize、保存前账号校验
- [x] 2.5 locales zh/en 新增账号相关文案

## 3. 文档

- [x] 3.1 PRD 发布账号章节与校验表
- [x] 3.2 使用说明 3.4 与模板说明
- [x] 3.3 OpenSpec proposal/design/spec
- [x] 3.4 执行记录 `openspec/records/workflow-account-targets.md`

## 4. 验证

- [x] 4.1 `npx vitest run electron/services/workflow electron/services/automation ...` 全绿
- [x] 4.2 `pnpm run build:vue` 成功
- [ ] 4.3 质量节拍门禁 + CI 全绿 + squash 合并
