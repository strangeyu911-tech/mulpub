# Spec: workflow-douyin-viral

## ADDED Requirements

### Requirement: 抖音爆款库来源

工作流必须能从已采集的抖音爆款库按行业/最低点赞筛选内容，并归一化为可改写条目。

#### Scenario: 按行业筛选
- **GIVEN** 爆款库有 `platform=douyin, industry=美妆` 的条目
- **WHEN** 工作流来源配置 `{type:'douyinViral', industry:'美妆', minLikes:1000}`
- **THEN** 采集结果只包含该行业且 likes>=1000 的条目
- **AND** item `needsGeneration=false`，直接进入改写

#### Scenario: 未选行业
- **WHEN** `industry=''`
- **THEN** 校验返回 `source.industry: unknown`，保存被拦截

#### Scenario: 爆款库服务未装配
- **WHEN** `viralLibrary` 缺失
- **THEN** 返回 `items:[]` 与 warning「爆款库服务未装配」，不抛异常

### Requirement: 行业维度持久化

爆款库条目必须能保存/编辑/展示行业；旧数据 industry 为空且不被新来源误选。

#### Scenario: 新增/编辑
- **WHEN** 表单选择行业并保存
- **THEN** `viral_library.industry` 写入该值
- **AND** 列表显示行业列

#### Scenario: 旧库迁移
- **GIVEN** 旧 `viral_library` 没有 industry 列
- **WHEN** 应用启动执行迁移
- **THEN** 列被添加，旧行值为空串，不抛错
