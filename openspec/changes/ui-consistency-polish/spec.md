# ui-consistency 能力规格（v1）

> 本规格定义「页面骨架层」与五个页面的视觉/交互契约。业务规则（采集、改写、发布、知识库 CRUD、播客 Feed）以各自既有规格为准；本规格只约束**呈现与交互反馈**。

## ADDED Requirements

### Requirement: 统一页面骨架

系统 SHALL 为五个目标页面（草稿、博主监控、文案库、知识库、播客 RSS）提供同一套页面骨架：页面容器、内容列、页头、页标题、页副标题、页头动作。

#### Scenario: 五页页头结构一致

- **WHEN** 用户依次打开 `/publish?tab=drafts`、`/collection?tab=creator`、`/copy-library`、`/knowledge-base`、`/podcast`
- **THEN** 每页根节点带 `mp-page`，内容列带 `mp-page-inner`，页头带 `mp-page-header`
- **AND** 页标题为 `h1` 且字号 22px、字重 600；页副标题 13px、行高 1.6
- **AND** 页头动作位于右侧，最多一个主按钮 + 一个次按钮

#### Scenario: 窄视口不溢出

- **WHEN** 视口宽度为 720px
- **THEN** 页头纵向排列，动作按钮换行且不超出内容列
- **AND** 双列表单变为单列；卡片网格变为单列

### Requirement: 统一表面与控件语言

系统 SHALL 使用同一套面板、列表行、按钮、输入框、分段控件、徽标与提示条规格，禁止页面级 scoped 样式覆盖骨架级字号/圆角/颜色。

#### Scenario: 面板规格

- **WHEN** 任一目标页面渲染面板
- **THEN** 面板圆角 16px、描边 1px `--hairline`、投影 `--elevation-1`、内边距 20px（列表/表格面板用 `--flush`）
- **AND** 面板内不再嵌套面板（子卡片用 `mp-card`）

#### Scenario: 控件规格

- **WHEN** 页面渲染按钮或输入框
- **THEN** 按钮使用 `mp-btn`（或既有 `cohere-btn-*`），高度 34px（sm 28px）、圆角 10px
- **AND** 输入/下拉/文本域高度 36px、圆角 10px、focus 有品牌色描边与柔光环
- **AND** 同屏不出现 4px 圆角控件

### Requirement: 完整状态表达

系统 SHALL 为每个列表/表格提供 loading、empty、error、success 四态；空态必须有标题、说明，并在存在下一步动作时提供按钮。

#### Scenario: 空列表

- **WHEN** 列表数据为空
- **THEN** 显示 `EmptyState`（图标底座 + 标题 + 说明）
- **AND** 若该页存在创建/返回入口，则显示对应主按钮
- **AND** 不显示无意义的「暂无数据」单行文本

#### Scenario: 加载中

- **WHEN** 首次加载或刷新列表
- **THEN** 列表/表格区域显示骨架屏
- **AND** 页头与筛选控件保持可见，不整页空白

#### Scenario: 业务错误

- **WHEN** IPC 返回 `code !== 0`
- **THEN** 显示 `mp-notice--danger`，包含可读原因与下一步动作
- **AND** 不把错误渲染成成功态，不吞掉 `issues`

### Requirement: 播客命名与入口

系统 SHALL 将播客页在左侧菜单显示为「播客」，页面标题显示为「播客 RSS」。

#### Scenario: 菜单与标题

- **WHEN** 用户查看左侧「更多」菜单
- **THEN** 该入口文案为「播客」（英文 Podcast）
- **WHEN** 用户进入 `/podcast`
- **THEN** 页面 `h1` 为「播客 RSS」（英文 Podcast RSS）
- **AND** 菜单 key 仍为 `podcast`，运营中心配置不失效

#### Scenario: 国际化成对

- **WHEN** 构建或运行 locale 同步检查
- **THEN** `sidebar.nav.podcast` 与 `podcast.pageTitle` 在 zh/en 均存在
- **AND** 不出现硬编码中文文案

### Requirement: 不改业务行为

本变更 SHALL 只修改呈现层与文案，不改变任何 IPC 调用、业务校验、数据结构与操作结果。

#### Scenario: 既有行为保持

- **WHEN** 用户在任一目标页面执行原有操作（保存草稿、删除、切换博主、采集、打开文案详情、导入知识、构建 Feed、发布 Feed）
- **THEN** 调用参数、返回处理、toast 文案与结果与改造前一致
- **AND** 既有测试全部通过

#### Scenario: 播客校验错误仍逐条可见

- **WHEN** 频道或单集保存失败并返回 `issues`
- **THEN** 每条 issue 的 `message` 与 `field` 均显示在表单下方
- **AND** `compliance` 缺失时不渲染「0 项不符合」

### Requirement: 可访问性与暗色

系统 SHALL 保证目标页面可通过键盘操作，并在暗色主题下保持可读。

#### Scenario: 键盘

- **WHEN** 用户仅使用键盘
- **THEN** 可到达页头动作、筛选、搜索、列表行内全部操作
- **AND** 焦点环可见（2px `--color-focus-ring`，offset 2px）
- **AND** 分段控件暴露 `aria-selected`

#### Scenario: 暗色

- **WHEN** 主题为 dark
- **THEN** 页面与面板使用暗色 token，无固定白色底
- **AND** 正文对比度 ≥ 4.5:1
