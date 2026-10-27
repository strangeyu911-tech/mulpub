# Spec: workflow-template-market

## ADDED Requirements

### Requirement: 版本化模板包

模板导出必须带 `format=mulpub-workflow-template` 与 `version=2`；导入必须按版本迁移。

#### Scenario: 导出
- **WHEN** 用户导出任意模板
- **THEN** 返回包包含 format/version/name/config/exportedAt
- **AND** `config.publish.targets[].accountId` 必须为空串

#### Scenario: v1 导入
- **WHEN** 导入 `version:1` 或没有 version 的裸对象
- **THEN** 自动补齐字段并迁移为 v2
- **AND** platform-only target 变 `{platform, accountId:''}`

#### Scenario: 未来版本
- **WHEN** 导入 `version:99`
- **THEN** 返回 `unsupported-version`，不落盘

### Requirement: 团队共享与冲突处理

导入必须支持预览、重名自动改名、显式覆盖，不得静默覆盖同名模板。

#### Scenario: 重名
- **WHEN** 导入名称已存在且未指定策略
- **THEN** 返回 `name:duplicate` 与 preview
- **AND** settings 不变化

#### Scenario: rename
- **WHEN** 导入 `{rename:true}`
- **THEN** 保存为「原名（导入 N）」，原模板不变

#### Scenario: dryRun
- **WHEN** 导入 `{dryRun:true}`
- **THEN** 只返回 preview，不写 settings

### Requirement: 本机账号隔离

模板不得携带本机账号 ID。

#### Scenario: 导出/导入
- **WHEN** 配置 targets 含 accountId
- **THEN** 导出与导入后 accountId 均为空串
- **AND** UI 应用模板后要求重新选账号
