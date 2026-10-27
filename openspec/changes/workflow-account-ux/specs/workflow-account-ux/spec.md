# Spec: workflow-account-ux

## ADDED Requirements

### Requirement: 账号搜索

发布账号区必须支持按账号名称/平台/备注搜索，且只渲染匹配账号。

#### Scenario: 搜索过滤
- **WHEN** 用户输入「小号」
- **THEN** 只显示名称/备注/平台包含「小号」的账号
- **AND** 无匹配时显示「没有匹配的账号」

### Requirement: 批量选择

必须支持全选当前搜索结果与清空已选，且全选跳过不可用账号。

#### Scenario: 全选
- **WHEN** 搜索「小号」后点「全选当前结果」
- **THEN** targets 只新增当前可见且可用的账号
- **AND** 过期账号不被选中

#### Scenario: 清空
- **WHEN** 点「清空已选」
- **THEN** `publish.targets` 为空

### Requirement: 最近使用与健康汇总

必须显示最近使用账号与可用/不可用数量。

#### Scenario: 最近使用
- **WHEN** 用户勾选账号
- **THEN** 该账号 ID 写入 localStorage 并出现在「最近使用」
- **AND** 仅展示可用账号，最多 5 个

#### Scenario: 健康汇总
- **THEN** 显示「可用 N 个 · 不可用 M 个」
