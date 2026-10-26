# 设计规范：页面骨架层（Page Scaffold）

| 项目 | 内容 |
|---|---|
| 文档 | DESIGN-PAGE-SCAFFOLD-2026-10-26 |
| 版本 | v1.0 |
| 日期 | 2026-10-26 |
| 适用 | `apps/desktop/src/styles/page-{scaffold,controls,skins,skins-knowledge,skins-data}.css` 与五个页面视图 |
| 关联 PRD | `01-docs/PRD-UI-CONSISTENCY-2026-10-26.md` |
| 关联能力规格 | `openspec/changes/ui-consistency-polish/spec.md` |

## 1. 定位

`page-scaffold.css` 是**页面观感层**的总入口，加载顺序在 `premium-design-system.css` 之后。它只定义「页面怎么排、表面怎么叠、控件长什么样」，不定义业务类名、不改 DOM 语义、不覆盖 Element Plus 组件内部结构。为满足逐文件 500 行门禁，按职责拆成五个文件（同层、按序加载）。

三层职责：

| 层 | 文件 | 负责 |
|---|---|---|
| Token | `styles/tokens.css` | 颜色、字号、圆角、间距、动效、阴影变量 |
| 类名契约 | `styles/cohere-design-system.css` | 哪些类名存在、语义是什么 |
| 观感契约 | `styles/premium-design-system.css` | 全站标题、卡片、页签、图标的统一观感 |
| **页面骨架（布局）** | `styles/page-scaffold.css` | **页面容器、页头、面板、列表行** |
| **页面骨架（控件）** | `styles/page-controls.css` | **按钮、分段、搜索、表单、徽标、提示、表格** |
| **页面皮肤** | `styles/page-skins.css` | 博主监控 / 文案库的页内特有排列 |
| **页面皮肤** | `styles/page-skins-knowledge.css` | 知识库表格与分页 |
| **页面皮肤** | `styles/page-skins-data.css` | 播客 RSS 表单/结果/分发卡片 |

## 2. 文件与导入

```js
// apps/desktop/src/main.js（仅在 premium-design-system.css 之后，按此顺序）
import './styles/page-scaffold.css'
import './styles/page-controls.css'
import './styles/page-skins.css'
import './styles/page-skins-knowledge.css'
import './styles/page-skins-data.css'
```

## 3. 类名清单（稳定契约）

### 3.1 布局

| 类名 | 作用 | 关键规格 |
|---|---|---|
| `.mp-page` | 页面滚动容器 | `flex: 1; overflow-y: auto; background: transparent` |
| `.mp-page--wide` | 宽版页面（表格） | `--mp-page-max: 1440px` |
| `.mp-page-inner` | 内容列 | `max-width: var(--mp-page-max, 1240px); margin: 0 auto; padding: 24px 32px 48px; display:flex; flex-direction:column; gap:16px` |
| `.mp-page-header` | 页头 | `display:flex; justify-content:space-between; align-items:flex-start; gap:24px; padding-bottom:4px` |
| `.mp-page-heading` | 标题组 | `min-width:0; display:flex; flex-direction:column; gap:6px` |
| `.mp-page-title` | 页标题 | 24px / 600 / -0.4px / `--color-text-strong` / 1.25 |
| `.mp-page-subtitle` | 页副标题 | 13px / `--color-text-muted` / 1.6 / max-width 760px |
| `.mp-page-actions` | 页头动作 | `display:flex; gap:8px; flex-shrink:0` |
| `.mp-stack` | 纵向堆叠 | `display:flex; flex-direction:column; gap:16px` |
| `.mp-toolbar` | 工具栏 | `display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap` |

### 3.2 表面

| 类名 | 作用 |
|---|---|
| `.mp-panel` | 白面 + 1px `--hairline` + 16px 圆角 + `--elevation-1`；`overflow:hidden` |
| `.mp-panel--flush` | 去掉内边距（列表/表格用） |
| `.mp-panel-header` | 面板头：`padding:16px 20px; border-bottom:1px solid var(--hairline-soft); display:flex; justify-content:space-between; align-items:center; gap:12px` |
| `.mp-panel-title` | 15px / 600 / `--color-text-strong` / 行高 1.3 |
| `.mp-panel-hint` | 12px / `--color-text-muted` / 1.55 / margin-top 4px |
| `.mp-panel-body` | `padding:20px` |
| `.mp-panel-footer` | `padding:12px 20px; border-top:1px solid var(--hairline-soft); display:flex; justify-content:space-between; align-items:center` |
| `.mp-card` | 面板内子卡片：`--surface-sunken` 底 + 12px 圆角 + 16px 内边距 |

### 3.3 列表行

| 类名 | 作用 |
|---|---|
| `.mp-list` | `display:flex; flex-direction:column` |
| `.mp-row` | `display:flex; align-items:center; gap:12px; padding:14px 20px; border-top:1px solid var(--hairline-soft)`；`first-child` 无上边线；hover `--surface-sunken` 40% |
| `.mp-row-main` | `flex:1; min-width:0` |
| `.mp-row-title` | 15px / 600 / 单行省略 |
| `.mp-row-meta` | 12px / muted / `display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; align-items:center` |
| `.mp-row-actions` | `display:flex; gap:8px; flex-shrink:0; opacity:.72`；行 hover/focus-within 时 `opacity:1` |

### 3.4 控件

| 类名 | 作用 |
|---|---|
| `.mp-btn` | 基础按钮：34px 高 / 10px 圆角 / 13px 500 / gap 6px / inline-flex |
| `.mp-btn--primary` | 品牌紫底白字；hover `--primary-hover`；disabled 50% |
| `.mp-btn--secondary` | 白底 + `--hairline-strong` 描边 + 主文字色；hover 描边品牌色、文字品牌色 |
| `.mp-btn--ghost` | 透明底 + 次文字色；hover `--surface-sunken` + 主文字色 |
| `.mp-btn--danger` | 透明底 + `--color-danger`；hover `--color-danger-soft` |
| `.mp-btn--sm` | 28px 高 / 12px 字号 / 10px 内边距 |
| `.mp-segmented` | pill 容器：`--surface-sunken` 底 + 3px 内边距 + 2px gap |
| `.mp-segmented button` | pill 按钮；选中白底 + 品牌文字 + `--shadow-tab-active` |
| `.mp-search` | 胶囊搜索容器；input 36px / 左内边距 36px |
| `.mp-field` | `display:flex; flex-direction:column; gap:6px` |
| `.mp-field > span` | 12px / 500 / 次文字色 |
| `.mp-field-hint` | 12px / muted / 1.5 |
| `.mp-form-grid` | 双列网格 `gap:16px 20px`；`--wide` 跨两列 |

### 3.5 状态

| 类名 | 作用 |
|---|---|
| `.mp-chip` | 22px pill 徽标；默认 `--surface-sunken` + 次文字色 |
| `.mp-chip--brand` / `--info` / `--success` / `--warning` / `--danger` | 语义色调 |
| `.mp-notice` | 12px 提示条：12px 14px 内边距 + 12px 圆角 + 1px 描边 |
| `.mp-notice--info` / `--warning` / `--danger` / `--success` | 四态 |
| `.mp-hint` | 12px muted 文本 |
| `.mp-empty-state--scaffold` | 由 `EmptyState.vue` 的 `scaffold` prop 开启：图标底座 + 标题 + 说明 + CTA；默认观感保持不变 |

### 3.6 表格

| 类名 | 作用 |
|---|---|
| `.mp-table` | 全宽表格；`border-collapse: separate; border-spacing: 0` |
| `.mp-table thead th` | `--surface-sunken` 底 / 12px 600 muted / 44px 高 / 左右 12px |
| `.mp-table tbody td` | 13px / 56px 高 / 上下 10px / 左右 12px / 单行省略 |
| `.mp-table tbody tr:hover` | `--surface-sunken` 50% |
| `.mp-table-wrap` | `overflow-x:auto`；`min-width` 由页面给（知识库 1180px） |

## 4. 与既有系统的关系

- **不覆盖** `.cohere-page-header`、`.cohere-card`、`.cohere-tabs`、`.cohere-btn-*` 的既有规则；五页改用 `mp-*` 后不再依赖它们。
- **可复用** `cohere-btn-*` 的页面（如发布页主表单）保持原样；本次只把五个目标页的控件收敛到 `mp-btn`。
- `EmptyState.vue` 是唯一跨页复用的状态组件；新增 `scaffold: Boolean`（默认 false），仅五个目标页显式开启，避免全站已登记像素基线漂移。
- `UiButton` / `UiSkeleton` 保持原 API；`PublishDraftsPage.vue` 使用它们。

## 5. 禁止项

1. 页面视图内禁止再写 `.xxx-page { padding: 24px }` 这类骨架级样式；一律用 `mp-page-inner`。
2. 禁止用 `!important` 覆盖 `mp-*`（页面级差异用修饰类）。
3. 禁止硬编码颜色；阴影使用 `--elevation-*`；圆角使用 `--r-*`。
4. 禁止在 `mp-panel` 内再套 `mp-panel`（用 `mp-card` 表达子卡片）。
5. 禁止把 `mp-btn` 用在需要 `type="submit"` 的原生表单语义上而不声明 `type`。

## 6. 验收快照（视觉基准）

| 观察点 | 目标 |
|---|---|
| 页头到首个面板 | 20px |
| 面板之间 | 16px |
| 面板头标题基线 | 与右侧按钮垂直居中 |
| 列表行高 | 64~72px（单行）/ 88px（双行） |
| 输入框与按钮同排 | 高度均 36px / 34px，垂直居中 |
| 空态高度 | ≥ 240px（compact ≥ 140px） |
| 同屏按钮圆角 | 仅 10px 与 pill 两种 |
| 同屏描边 | 仅 `--hairline` / `--hairline-soft` / `--hairline-strong` 三种 |
