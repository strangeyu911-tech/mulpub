# Spec: 账号级发布目标

## ADDED Requirements

### Requirement: 任务发布目标必须是具体账号

`content.type != podcast` 时，`publish.targets` SHALL 至少包含一个目标，且每个目标的 `accountId` SHALL 为非空字符串；否则 `validateWorkflowConfig` SHALL 返回 `publish.targets[i].accountId` 的 `empty` 错误，任务 SHALL NOT 保存或启动。

#### Scenario: 只选平台
- **WHEN** 任务配置为 `targets:[{platform:'zhihu',accountId:''}]`
- **THEN** 校验失败，errors 含 `publish.targets[0].accountId:empty`

#### Scenario: 同平台两个账号
- **WHEN** `targets:[{platform:'zhihu',accountId:'a1'},{platform:'zhihu',accountId:'a2'}]`
- **THEN** 校验通过，两个目标独立排期、独立节奏

#### Scenario: 播客不要求账号
- **WHEN** `content.type=podcast` 且 `targets=[]`
- **THEN** 校验通过

### Requirement: UI 从账号列表多选

工作流编辑器 SHALL 通过 `listAccounts()` 读取已添加账号，按平台分组展示账号名与状态；用户 SHALL 能勾选同平台的多个账号，`publish.targets` SHALL 写入对应 `{platform, accountId}`。

#### Scenario: 同平台多选
- **WHEN** 账号列表含知乎主号/知乎小号，用户勾选两者
- **THEN** targets 为两个不同 accountId 的目标，而非一个平台目标

#### Scenario: 没有账号
- **WHEN** `listAccounts()` 返回空数组
- **THEN** 编辑器显示空态「还没有已添加的自媒体账号…」，不展示平台假选项

### Requirement: 模板只保存平台建议

模板校验 SHALL 允许 `accountId` 为空；模板保存/导出 SHALL 不写入本机账号 ID；应用模板时 SHALL 过滤空账号与已不存在账号，并提示用户选择具体账号。

#### Scenario: 应用内置模板
- **WHEN** 内置模板 targets 为 `{platform:'bilibili',accountId:''}` 等平台建议
- **THEN** 应用后任务 targets 为空，显示「模板建议平台：B站…；请选择具体账号」

#### Scenario: 模板跨机器导入
- **WHEN** 导入的模板 target 账号 ID 在本机不存在
- **THEN** 该 target 被丢弃并提示「部分目标账号已不存在，请重新选择」
