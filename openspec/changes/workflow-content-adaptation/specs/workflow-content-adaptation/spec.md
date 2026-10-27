# Spec: workflow-content-adaptation

## ADDED Requirements

### Requirement: 按目标平台适配文本

排期时每个发布目标必须拿到按平台/账号 profile 适配后的 article。

#### Scenario: 平台 profile
- **WHEN** 目标平台为 bilibili，profile 设 titleMaxLength=8、suffix='#B'
- **THEN** 入队 article.title 截断后带 '#B'
- **AND** article.adaptation.platform='bilibili'

#### Scenario: 账号优先
- **WHEN** 同平台账号 profile 与平台 profile 同时存在
- **THEN** 账号 profile 生效

### Requirement: 文本适配校验

启用适配时必须至少有一个 profile；未知平台/越界字数/超长后缀/过多标签必须拒绝保存。

#### Scenario: 空 profile
- **WHEN** enabled=true 且 byPlatform/byAccount 都为空
- **THEN** 返回 `content.adaptation: empty`

### Requirement: UI 只展示已选平台

适配行必须只针对 `publish.targets` 中出现的平台；无目标时提示先选账号。

#### Scenario: 未选账号
- **THEN** 显示「先在下方选择发布账号」提示，不渲染空平台行
