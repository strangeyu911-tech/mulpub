# Proposal: 抖音爆款库来源（P1-6）

## Why

复合工作流首版隐藏了「抖音爆款」来源，因为当时没有定义数据源与行业枚举。现有爆款库已经能保存抖音内容（`viral_library.platform=douyin`），但工作流无法按行业/点赞筛选它。与其继续隐藏，不如把「已采集的抖音爆款库」定义成明确来源，并补行业维度。

## What Changes

- `viral_library` 新增 `industry` 列（默认空串）；建表 DDL、store-schema 迁移、creator-schema 迁移三处同步。
- 新增共享行业枚举 `apps/desktop/shared/viral-industries.json`：美妆/穿搭/美食/母婴/家居/数码/职场/情感/教育/健身/旅行/财经/其他。
- `listViralItems` 支持 `platform / industry / minLikes` 过滤；`addViralItem/updateViralItem` 持久化 industry。
- 工作流来源新增 `douyinViral`：
  - 配置字段：`industry`（必填）、`limit`（1–50）、`minLikes`（0–10,000,000）、`sort`（score=按点赞 / latest=按入库时间）。
  - 数据源：`knowledgeLibraryService.listViral({ platform:'douyin', industry, minLikes, ... })`。
  - 归一化后 `needsCollect=false`、`needsGeneration=false`，直接进入改写/排期。
- UI：来源下拉新增「抖音爆款库」；行业、最低点赞、条数；爆款库表单/列表新增行业字段。
- 明确不实时抓抖音：来源是已采集的爆款库；无数据时提示先采集。

## Non-goals

- 不实现抖音实时热榜/爬虫；不改变现有爆款采集链路。
- 不做行业自动分类；行业由录入/采集侧填写。
- 不做跨平台爆款来源（当前只定义 douyin）。

## Impact

- DB：新增可空列与迁移，旧数据 industry=''，不影响现有查询。
- UI：爆款库表单/列表多一列；工作流来源多一个分支。
- 运行：无 industry 数据的旧条目不会被新来源选中；这是有意的数据质量门禁。
