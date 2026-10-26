# Proposal: 复合工作流发布目标改为账号级多选

## Why

复合工作流首版把「发布目标」做成了平台多选：UI 只渲染 15 个平台，选中后写入 `{ platform, accountId: '' }`，运行时由发布链路回落到该平台的默认账号。用户无法选择同平台的其他账号，也无法表达「知乎主号 + 知乎小号同时发」这类真实需求。

账号是发布的最小单位：同一平台的不同账号有不同的登录态、粉丝与限流，必须由用户显式选择。平台只是账号的属性，不应该成为选择项。

## What Changes

- `WorkflowEditor` 改为按平台分组的**账号多选**：读取 `listAccounts()`，展示账号名与状态，同一平台可多选。
- `WorkflowEditor` 新增 `accounts` prop；`AutomationTaskDialog` 打开时加载账号并传入。
- `validateWorkflowConfig` 对**任务配置**要求每个非播客 target 的 `accountId` 非空；错误为 `publish.targets[i].accountId: empty`。
- 模板配置允许 `accountId` 为空：模板只保存「平台建议」，不保存账号 ID（账号属于本机/本用户，模板要可跨机器分发）。
- 应用模板/导入模板时过滤掉空账号 target 与已不存在的账号，并显示「模板建议平台：…；请选择具体账号」。
- 保存任务前在 UI 层拦截「没有账号」或「账号已不存在」，不只依赖后端校验。
- PRD、OpenSpec、使用说明同步改为账号级语义；执行记录补测试与门禁证据。

## Non-goals

- 不改变账号管理（新增/删除/登录态检测）本身。
- 不改变发布通道：仍然经 `TaskQueue` 按 `platform + accountId` 串行与限流。
- 不引入远程账号目录；账号列表仍来自本机 `listAccounts()`。

## Impact

- 受影响：`workflow-schema.js`、`workflow-service.js`、`WorkflowEditor.vue`、`AutomationTaskDialog.vue`、locales、相关测试与文档。
- 兼容性：旧任务若 target 的 `accountId` 为空，读取时会被清空并提示重新选择；不会静默回落到默认账号。
