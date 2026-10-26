# PRD：五页 UI 一致性提升（草稿 / 博主监控 / 文案库 / 知识库 / 播客 RSS）

| 项目 | 内容 |
|---|---|
| 文档编号 | PRD-UI-CONSISTENCY-2026-10-26 |
| 版本 | v1.0 |
| 日期 | 2026-10-26 |
| 状态 | 已确认（用户 2026-10-26 提出，本次实施） |
| 变更标识 | `ui-consistency-polish` |
| 影响应用 | `apps/desktop`（Electron 渲染层 + i18n） |
| 关联设计规范 | `01-docs/DESIGN-PAGE-SCAFFOLD-2026-10-26.md`、`01-docs/DESIGN.md` §Page Scaffold |
| 关联 OpenSpec | `openspec/changes/ui-consistency-polish/` |
| 执行记录 | `openspec/records/ui-consistency-polish.md` |

---

## 1. 背景与问题

### 1.1 用户原声

> 「草稿页、博主监控页、文案库、知识库、播客 RSS 频道，这几个页面，前端 UI 界面和内容呈现上，从视觉上不太统一，而且很混乱、很粗糙、不精致。我的目标是把整体 UI 进行提升，提高档次，实现高级感和精致感。」
>
> 「播客 RSS 频道，在左侧菜单上的名字改成『播客』，页面上的标题，改为『播客 RSS』。」

### 1.2 现状拆解（2026-10-26 巡检，截图逐页核对）

| 页面 | 路由 | 现状问题 | 根因 |
|---|---|---|---|
| 草稿页 | `/publish?tab=drafts` | 独立 `<section>` 脱离 `cohere-page` 骨架；页头只有 20px 标题；每行一张大卡片、标题/时间/按钮横向挤在一行；空态是虚线框 + 两行文字；与发布页其他 tab 的页头完全不是同一套 | `Publish.vue` 内自建 `publish-drafts-*` 样式，未接入页面骨架 |
| 博主监控页 | `/collection?tab=creator` | 内容是其他 tab 唯一没有 `.cohere-content` 包裹的页面：没有左右留白、没有最大宽度；两个面板是 1px 灰边盒子；凭证横幅是裸边框；按钮混用 `cohere-btn-secondary`（文字链接形态）与原生按钮；空态只有一行灰字 | `Collection.vue:350` 直接渲染 `<CreatorMonitor />`；`CreatorMonitor.vue` 自带一套 30 行 scoped 样式 |
| 文案库 | `/copy-library` | 筛选按钮是 4px 圆角小方块；搜索框 4px 圆角；卡片只有 1px 描边、无层次；来源徽标、标题、正文、元信息没有稳定基线；页面无统一页头间距 | `CopyLibraryView.vue` 完全自建样式，未使用设计系统 |
| 知识库 | `/knowledge-base` | 页头被 scoped 样式覆盖为 16px 内边距 + `--coral` 红色主按钮；页签是灰底方角分段；内容区 12px 内边距；表格裸样式；积压提示是裸色块 | `KnowledgeBasePage.vue` scoped 覆盖了全局 `.cohere-page-header` / `.cohere-btn-*` 契约 |
| 播客 RSS | `/podcast` | 纯原生 HTML：默认 input/select/button；四个大区块之间只有 28px 间距、没有卡片边界；标题 16px；空态虚线圈；结果块直接铺在页面上；与全站视觉语言脱节 | `PodcastChannelView.vue` 是 2026-10 新功能，未做视觉层沉淀；`PodcastHostingCard.vue` 同样自带一套 |

### 1.3 共性问题（不是五个独立问题）

1. **页面骨架缺失**：没有统一的「页头 / 内容区 / 最大宽度 / 上下节奏」。
2. **表面层级缺失**：白底 + 1px 灰边，卡片、页面、分区三层分不开。
3. **控件各写一套**：圆角从 4px 到 10px，按钮从文字链接到实心块，输入框高度 28~34px 不等。
4. **排版没有层级**：标题 16/20px 混用、正文 12/13px 混用、行高与段距随意。
5. **状态表达粗糙**：加载只有一行「加载中…」，空态只有一句话，错误是裸红字。
6. **命名与入口不一致**：左侧菜单「播客 RSS 频道」与页面标题同名，菜单过长且与「更多」组其他短标签（文案改写、素材库）不一致。

---

## 2. 目标与非目标

### 2.1 目标（可验收）

| 编号 | 目标 | 验收口径 |
|---|---|---|
| G1 | 五页共用同一套页面骨架 | 五页根节点均带 `mp-page`，页头均带 `mp-page-header`；视觉规范快照通过 |
| G2 | 五页共用同一套表面/控件/状态语言 | 面板、列表行、输入框、按钮、徽标、空态、提示条均来自 `page-scaffold.css` 的同一组类 |
| G3 | 视觉档次提升 | 统一 24px 页标题 / 13px 副标题 / 16px 圆角面板 / 8px 间距栅格 / 柔和投影；同屏不同页的标题、按钮、间距差异 ≤ 1 档 |
| G4 | 信息密度与可读性提升 | 列表行高 ≥ 64px；正文行高 ≥ 1.6；表格表头/行高统一；关键操作右对齐且与危险操作分离 |
| G5 | 播客命名修正 | 左侧菜单显示「播客」；页面标题显示「播客 RSS」；`aria-label` 与 `document.title` 同步 |
| G6 | 不改变业务行为 | 五页所有既有测试通过；IPC 调用序列与参数不变；不新增/删除业务能力 |

### 2.2 非目标

- 不重做 Element Plus 主题，不改全局 `cohere-design-system.css` 的既有类名语义。
- 不改发布页主表单、采集页其他 tab、知识库弹窗内部表单的字段结构。
- 不引入新的 UI 组件库、CSS-in-JS、图标库或字体文件。
- 不改任何校验规则、IPC 契约、数据结构、数据库。
- 不做移动端专属布局；仅保证 900px / 720px 两档不溢出。

---

## 3. 设计原则（本次统一的判断标准）

1. **安静的高级感**：品牌紫只用于主操作、选中态与图标底座；页面大面积由墨色文字、白色表面、极浅冷紫画布构成。
2. **层级靠表面与留白，不靠边框**：页面 → 面板 → 行三级，分别用画布色、白面 + 发丝描边 + 柔和投影、行分隔线表达。
3. **8pt 节奏**：所有间距取 4/8/12/16/20/24/32；同一层级的上下间距必须相同。
4. **一屏一个主操作**：页头右侧最多一个主按钮 + 一个次按钮；行内操作使用弱化按钮，危险操作与主操作之间留 8px。
5. **状态必须完整**：任何列表/表格都必须有 loading / empty / error / success 四态；空态必须给下一步动作。
6. **可键盘、可读屏**：所有可点击元素原生语义 + 可见焦点环；分段控件 `role="tablist"` + `aria-selected`；装饰性图标 `aria-hidden`。
7. **暗色同源**：只使用 token，禁止硬编码颜色；暗色下表面/描边/投影由 token 自动切换。

---

## 4. 全局规格

### 4.1 页面骨架

```
mp-page
└── mp-page-inner（max-width: 1240px，表格页 1440px；padding: 24px 32px 48px）
    ├── mp-page-header
    │   ├── mp-page-heading
    │   │   ├── h1.mp-page-title（24px / 600 / -0.4px）
    │   │   └── p.mp-page-subtitle（13px / 1.6 / muted / max-width 760px）
    │   └── mp-page-actions（gap 8px）
    └── 内容区（mp-panel / mp-toolbar / mp-empty …）
```

| 项 | 规格 |
|---|---|
| 页面最大宽度 | 常规 1240px；知识库表格 1440px |
| 页面左右留白 | ≥ 1200px 视口：32px；720~1200px：20px；<720px：16px |
| 页头下间距 | 20px |
| 页标题 | `--font-family-ui-display`，24px，600，`--color-text-strong`，字距 -0.4px，行高 1.25 |
| 页副标题 | 13px，`--color-text-muted`，行高 1.6，最多两行 |
| 面板间距 | 16px |
| 区块内边距 | 20px（面板头 16px 20px；列表行 14px 20px） |
| 面板圆角 | 16px（`--r-lg`） |
| 面板描边 | 1px `--hairline` |
| 面板投影 | `--elevation-1`，hover 不提升（避免整页漂浮） |
| 行分隔 | 1px `--hairline-soft`，最后一行无分隔 |
| 行悬停 | `--surface-sunken` 40% 透明叠加，140ms |
| 焦点环 | 2px `--color-focus-ring`，offset 2px |

### 4.2 材质与背景

- 画布：沿用 `premium-design-system.css` 的极浅冷紫渐变（`--surface-canvas` + radial gradient）。
- 页面容器不再铺纯白；面板为 `--surface-raised` 纯白。
- 吸顶/浮层才允许毛玻璃；普通面板禁止 `backdrop-filter`。

### 4.3 控件规格

| 控件 | 高度 | 圆角 | 字号 | 说明 |
|---|---|---|---|---|
| 主按钮（mp-btn--primary） | 34px（sm 28px） | 10px | 13px / 500 | 品牌紫底、白字；hover 提亮；disabled 50% |
| 次按钮（mp-btn--secondary） | 34px | 10px | 13px | 白底 + 发丝描边；hover 描边品牌色 + 文字品牌色 |
| 幽灵按钮（mp-btn--ghost） | 34px（sm 28px） | 10px | 13px | 透明底；hover 浅底；危险变体文字 `--color-danger` |
| 分段控件（mp-segmented） | 容器 36px | pill | 13px | 容器 `--surface-sunken`；选中项白底 + `--shadow-tab-active` + 品牌色 |
| 输入/下拉/文本域 | 36px（文本域自动） | 10px | 13px | 白底 + `--hairline-strong`；focus 品牌描边 + 3px 柔光环 |
| 搜索框 | 36px | pill | 13px | 左内边距 36px 预留放大镜图标位（用背景 SVG，不新增 DOM） |
| 徽标（mp-chip） | 22px | pill | 12px / 500 | 语义色：brand / info / success / warning / danger / neutral |
| 空态（EmptyState） | min-height 240px | — | 15px 标题 / 13px 说明 | 图标底座 48px 圆形渐变；主行动按钮 34px |

### 4.4 文案规范

- 页标题：名词短语，≤ 12 个汉字（「播客 RSS」例外，用户指定）。
- 页副标题：一句话说明「这里有什么 + 能做什么」，≤ 60 汉字，句尾不加句号。
- 面板标题：名词短语，≤ 10 汉字；右侧可带数量徽标。
- 空态文案：`标题（状态）+ 说明（为什么空/下一步）`；有明确动作时必须给按钮，禁止只有一句「暂无数据」。
- 错误文案：`发生了什么 + 下一步怎么做`；禁止只输出技术码。业务校验错误逐字段列在表单下方，字段名用 `code` 小字。
- 按钮文案：动词开头；危险操作必须显式（「删除」「取消关注」），禁止「确定」单独出现。
- 数字与时间：数字使用 `font-variant-numeric: tabular-nums`；时间统一 `YYYY/M/D HH:mm`，由 `toLocaleString` 生成，不手写格式。

### 4.5 状态矩阵（通用）

| 状态 | 视觉 | 交互 |
|---|---|---|
| Loading | 列表/表格用骨架屏；按钮 loading 显示 spinner 并禁用 | 阻止重复提交 |
| Empty（无数据） | 图标底座 + 标题 + 说明 + 主行动 | 行动按钮触发创建/去采集/返回 |
| Empty（筛选无结果） | 搜索图标 + 「没有匹配的…」+「清除筛选」 | 一键清空筛选与搜索 |
| Error | `mp-notice mp-notice--danger`，含重试按钮 | 重试重新拉取，不丢筛选 |
| Partial | `mp-notice mp-notice--warning`，说明降级范围 | 保留可用功能 |
| Success | `mp-notice mp-notice--success` 或轻提示 | 3s 后自动消失（toast）/常驻（结果块） |

### 4.6 响应式

| 断点 | 变化 |
|---|---|
| ≥ 1200px | 双列表单；卡片 3 列；页头左右分布 |
| 900~1199px | 双列表单保持；卡片 2 列；表格横向滚动 |
| 720~899px | 单列表单；卡片 1 列；页头纵向；行操作换行到下一行 |
| < 720px | 页头按钮占满整行；行内操作 100% 宽；表格最小宽度 960px 横向滚动 |

### 4.7 可访问性

- 对比度：正文 ≥ 4.5:1；大字号 ≥ 3:1；非文本控件边界 ≥ 3:1。
- 焦点：所有按钮/输入/行内可点击元素可见焦点环；不用 `outline: none`。
- 键盘：Tab 顺序 = 视觉顺序；分段控件支持 ←/→（沿用现有实现，不新增 roving tabindex 以免回归）；列表行的 Enter/Space 行为保持现状。
- 读屏：页标题为 `h1`；面板标题 `h2`；徽标为纯文本；图标 `aria-hidden="true"`。
- 减少动效：`prefers-reduced-motion: reduce` 时取消位移与过渡。

---

## 5. 页面规格

### 5.1 草稿页（`/publish?tab=drafts`）

#### 5.1.1 结构

```
mp-page
└── mp-page-inner
    ├── mp-page-header
    │   ├── h1「草稿箱」+ p「查看、编辑或删除已保存的内容草稿」
    │   └── mp-page-actions：次按钮「返回发布」
    └── mp-panel
        ├── mp-panel-header：标题「草稿列表」+ 徽标「共 N 篇」
        └── 加载 / 空态 / mp-list（每行一条）
```

#### 5.1.2 显示项（每行）

| 区域 | 内容 | 规则 |
|---|---|---|
| 主标题 | `draft.title`，空则「无标题」 | 单行省略，最大宽度由 flex 决定；`title` 属性给全文 |
| 元信息 | 更新时间 | `updatedAt ?? updated_at`；解析失败显示「更新时间未知」；格式 `YYYY/M/D HH:mm` |
| 平台徽标 | `draft.platforms.length` > 0 时显示「N 个平台」 | `mp-chip mp-chip--brand` |
| 操作 | 「去发布」主按钮（sm）+「删除」幽灵危险按钮（sm） | 右对齐；gap 8px；删除前二次确认沿用 `removeDraft` 现有逻辑 |

#### 5.1.3 状态

- Loading：`UiSkeleton variant="list" :count="3"`，不再显示文字「加载中」。
- Empty：`EmptyState scaffold icon="Document"`，标题「还没有草稿」，说明「在发布页保存草稿后，会出现在这里」，动作「返回发布」→ `goToPublish`。
- Error：`usePublishDrafts` 现有点击操作已用 toast 提示，本页不新增请求错误态（读列表失败时 `drafts` 为空，落空态；保留现有行为）。
- 删除成功：toast「草稿已删除」，列表即时移除（沿用现有实现）。

#### 5.1.4 交互

- 点击行标题不触发打开（避免误触）；只有「去发布」按钮打开。
- 与发布页共用 `editDraft` / `removeDraft`，不复制逻辑。
- 返回按钮：`router.push('/publish')`，保留 `publishTab` 切换逻辑。

#### 5.1.5 埋点/日志

不新增埋点；保留现有 `console` 与 toast 行为。

---

### 5.2 博主监控页（`/collection?tab=creator`）

#### 5.2.1 结构

```
cohere-page-header（采集页既有页签栏，保持不变）
cohere-content
└── creator-monitor
    ├── mp-notice（凭证/服务降级，按状态出现）
    ├── mp-hint（正文腿依赖，非阻塞）
    ├── mp-panel（关注的博主）
    │   ├── mp-panel-header：标题 + 数量徽标 + 次按钮「添加博主」
    │   └── mp-list（博主行）/ EmptyState
    └── mp-panel（博主监控 / 新作品）
        ├── mp-panel-header：标题 + 主按钮「一键采集新作品」
        └── mp-list（发现行）/ EmptyState
```

#### 5.2.2 显示项（博主行）

| 区域 | 内容 | 规则 |
|---|---|---|
| 头像 | `avatar_url` | 40×40，圆角 12px（不是圆形，避免与平台图标混淆）；缺失时显示首字母占位（背景 brand-soft） |
| 平台 | `platformLabel(c.platform ?? 'youtube')` | `mp-chip`，按平台 tone：YouTube danger、抖音 info、小红书 warning |
| 名称 | `display_name || external_id` | 15px / 600，单行省略 |
| 能力 | `capKey(capability_tier)` | `mp-chip`：official → success；best_effort → warning；unsupported → neutral |
| 暂停态 | `creatorAutoPaused` / `creatorFatalPaused` | 12px danger，单独一行；带失败次数与原因 |
| 待采集 | `pendingCount > 0` 时「N 条新作品」 | `mp-chip mp-chip--brand`，放在名称右侧 |
| 操作 | 「立即检查」「暂停/恢复」「取消关注」 | 全部 `mp-btn--ghost mp-btn--sm`；取消关注为 danger 文字；行 hover 时才提升不透明度到 1 |

#### 5.2.3 显示项（发现行）

| 区域 | 内容 | 规则 |
|---|---|---|
| 缩略图 | `thumbnail_url` | 64×40，圆角 8px；缺失时灰底 + 视频图标 |
| 标题 | `d.title` | 15px / 600，最多两行 |
| 质量徽标 | `qualityKey(d.content_quality)` | `mp-chip`：full → success；partial → warning；stub → neutral |
| 操作 | 「采集」或「已采集 · time」 | 采集主按钮（sm）；已采集为 12px muted 文本 |

#### 5.2.4 状态与提示

- 服务降级：`mp-notice mp-notice--warning`，文案沿用 `creatorErrServiceUnavailable`，右侧「重试」按钮。
- 凭证缺失/读取失败：`mp-notice mp-notice--info`，文案沿用 `credentialBannerKey`，右侧「配置 API Key」按钮。
- 正文腿依赖缺失：`mp-hint` 一行，不阻塞。
- 加载中：博主列表显示 3 行骨架（`UiSkeleton variant="list"`）。
- 空博主：`EmptyState scaffold icon="User"`，标题「还没有关注的博主」，说明沿用 `creatorEmptyDesc`，动作「添加博主」→ `openAddDialog`。
- 空发现：`EmptyState scaffold icon="VideoCamera" compact`，标题「暂无新作品」，说明沿用 `creatorNoNewWorks`（每 60 秒自动检查）。

#### 5.2.5 交互

- 点击博主行切换当前博主并加载发现；点击操作按钮 `@click.stop`，不触发行切换。
- 所有 IPC 调用、错误分支、配额提示保持现状；本次只改视觉与信息层级。
- 添加博主、凭证配置弹窗保持现有组件与流程。

---

### 5.3 文案库（`/copy-library`）

#### 5.3.1 结构

```
mp-page
└── mp-page-inner
    ├── mp-page-header：h1「文案库」+ 副标题
    ├── mp-toolbar：mp-segmented（来源筛选）+ mp-search（搜索）
    ├── 加载 / 空态 / 筛选空态 / 卡片网格
    └── LoadMoreRow
```

#### 5.3.2 筛选与搜索

| 项 | 规则 |
|---|---|
| 筛选项 | 全部 / 采集 / 改写 / 草稿 / 视频创作 |
| 默认 | 全部 |
| 搜索范围 | `(title + ' ' + content).toLowerCase()` 包含查询串；查询串 `trim().toLowerCase()` |
| 组合 | 先按来源过滤，再按关键词过滤；两者同时生效 |
| 空结果 | 来源+关键词都清空才恢复；「清除筛选」同时重置 `originFilter='all'` 与 `searchQuery=''` |
| 输入反馈 | 即时过滤（不防抖，沿用现有行为） |
| 可访问性 | 筛选组 `role="group"` + `aria-label`；按钮 `aria-pressed`；搜索框 `type="search"` + `aria-label` |

#### 5.3.3 卡片显示项

| 区域 | 内容 | 规则 |
|---|---|---|
| 来源徽标 | `originLabel(entry.origin)` | `mp-chip`：collect → info；rewrite → brand；draft → warning；video → success |
| 播客入口 | 「文本出期」按钮 | 可见性严格沿用 `canShowEpisodeEntry(entry)`：无频道 / 无 id / 无正文（video 档按 `wordCount`）时不渲染 |
| 标题 | `entry.title || untitled` | 15px / 600，两行省略 |
| 正文摘要 | `entry.content` | 13px，行高 1.65，3 行截断；`white-space: pre-line` |
| 元信息 | 字数、创建时间、截断标记 | 12px muted；以 `·` 分隔；数字 tabular-nums |
| 查看图标 | `View` | 右侧，hover 品牌色；`aria-hidden` |

#### 5.3.4 状态

- Loading：卡片骨架 6 张（`UiSkeleton variant="card"`，若组件不支持则 `list`）。
- 无文案：`EmptyState scaffold icon="Document"`，标题/说明/动作沿用 `copyLibrary.empty*`；动作可指向 `/collection`（新增文案 key `emptyAction`）。
- 筛选空：`EmptyState scaffold compact icon="Search"`，「清除筛选」。
- 视频全文获取失败：沿用 `notifyWarning('copyLibrary.videoFullTextFailed')`。
- 交接失败：沿用 `notifyWarning('copyLibrary.handoffFailed')`，不跳转。

#### 5.3.5 交互

- 整卡可点击 + Enter/Space 打开详情（保持现状）；播客按钮 `@click.stop`。
- hover：卡片上浮 1px + 阴影 `--elevation-2`；`prefers-reduced-motion` 时取消位移。
- 加载更多：`LoadMoreRow` 样式统一（按钮 `mp-btn--secondary`）。

---

### 5.4 知识库（`/knowledge-base`）

#### 5.4.1 结构

```
mp-page mp-page--wide
└── mp-page-inner
    ├── mp-page-header：h1「知识库」+ 动态副标题 + 页头动作
    ├── mp-segmented（爆款库 / 模式分析 / 个人知识库）
    ├── mp-notice（模式提取积压，deferred > 0）
    └── 面板（ViralLibraryTable / PatternAnalysisPanel / PersonalKnowledgePanel）
```

#### 5.4.2 页头动作（按 tab 显示）

| Tab | 主按钮 | 次按钮 |
|---|---|---|
| 爆款库 | 「＋ 添加爆款」 | 「导出到飞书」 |
| 模式分析 | — | 「导出到飞书」 |
| 个人知识库 | 「＋ 添加内容」 | 「批量导入」「导出到飞书」 |

- 主按钮：`mp-btn mp-btn--primary`（品牌紫），不再使用 `--coral`。
- 次按钮：`mp-btn mp-btn--secondary`。
- 批量导入：`input[type=file]` 保持隐藏，accept `.txt,.md,.doc,.docx`；单文件 > 5MB 时 toast 警告并终止；未取得路径时提示导入失败。

#### 5.4.3 爆款库表格

| 列 | 规则 |
|---|---|
| 序号 | 当前页序号 `(page-1)*pageSize + idx + 1` |
| 标题 | 单行省略；悬停显示完整标题（含 recrawl 提示） |
| 封面 | 60×60，圆角 8px；无封面显示「—」 |
| 博主 | 空显示「-」 |
| 正文 | 前 80 字 + `...` |
| 话题标签 | `el-tag` 改为 `mp-chip` 风格的只读标签，最多显示 3 个，超出显示 `+N`（不改变数据） |
| 点赞/收藏/评论 | 数字格式化沿用 `formatNum`，tabular-nums |
| 赞藏比 | 1 位小数；空「-」 |
| 发布时间 | `YYYY-MM-DD` |
| 平台 | 文本 |
| 操作 | 「编辑」幽灵、「删除」幽灵危险 |

表格外观：

- 外层 `mp-panel`；表头 `--surface-sunken`、12px / 600 / muted、高 44px；行高 56px；行悬停 `--surface-sunken` 50%；无斑马纹；列分隔只保留纵向发丝线；表格最小宽度 1180px，横向滚动。
- 分页：`mp-panel-footer`，左「共 N 条」，右「上一页 / 第 X / Y 页 / 下一页」；按钮 `mp-btn--secondary mp-btn--sm`；禁用态 40% 不透明度。
- 搜索：`mp-search` 上方工具栏，占满剩余宽度；placeholder「搜索...」。
- 空态：`EmptyState scaffold icon="TrendCharts"`，标题/说明/动作沿用 `knowledgeBase.empty.viral.*`。
- 加载：表体 5 行骨架。
- 删除：`ElMessageBox.confirm` 文案沿用 `confirmDelete`；成功后 toast `deleteSuccess` 并重载。

#### 5.4.4 模式分析 / 个人知识库

- 面板标题与筛选控件统一到 `mp-panel` + `mp-toolbar`；内部已有逻辑不动。
- 模式分析的状态筛选使用 `mp-segmented`；刷新按钮 `mp-btn--secondary`。
- 个人知识库的添加/批量导入/导出入口统一到页头。

#### 5.4.5 积压提示

`mp-notice mp-notice--warning`：文案沿用 `patternQueueBacklog`，不提供关闭按钮（状态型提示，消失条件为 deferred=0）。

---

### 5.5 播客 RSS（`/podcast`）

#### 5.5.1 命名

| 位置 | 旧 | 新 | 实现 |
|---|---|---|---|
| 左侧菜单 | 播客 RSS 频道 | **播客** | `sidebar.nav.podcast`（新增 key） |
| 页面标题 | 播客 RSS 频道 | **播客 RSS** | `podcast.pageTitle` 改值 |
| 浏览器/窗口标题 | 由路由 meta 推导 | 播客 RSS | 路由 `meta.title` 使用同一 key |
| 面包屑（若有） | 同上 | 播客 RSS | 同一 key |

- 菜单 key 仍为 `podcast`，运营中心配置不受影响。
- 英文：菜单「Podcast」，页面「Podcast RSS」。

#### 5.5.2 结构

```
mp-page
└── mp-page-inner
    ├── mp-page-header：h1「播客 RSS」+ 副标题（沿用 pageSubtitle）
    ├── mp-panel 频道选择（picker）
    ├── mp-panel 托管发布（PodcastHostingCard）
    ├── mp-panel 频道设置（channel form）
    ├── mp-panel 单集管理（episodes）
    ├── mp-panel 发布与自检（feed build/verify）
    └── mp-panel 分发端提交指引（endpoint cards）
```

#### 5.5.3 频道选择（picker）

| 项 | 规则 |
|---|---|
| 频道下拉 | 显示 `name · count/cap`；无频道时显示空态「还没有频道，先新建一个。」+ 新建输入框 |
| 新建 | 名称 `trim()` 非空；≤120 字符；成功后 toast「频道已创建」并刷新列表 |
| 设为默认 | 无当前频道时禁用；成功 toast「默认频道已更新」 |
| 重命名 | 名称 `trim()` 非空；≤120 字符；成功 toast「频道已重命名」 |
| 配额提示 | `该频道已收录 {count} 期，上限 {cap} 期；达到上限时须先删除旧期。` |
| 迁移冲突 | `mp-notice--warning`，两个按钮「保留当前数据」「保留原有数据」；处理成功 toast「迁移冲突已处理」 |
| 迁移失败 | `mp-notice--danger`，文案 `migrationError`，不提供伪操作 |
| 错误 | 行内 `mp-notice--danger` + 错误码可读文案（`errorText`） |

#### 5.5.4 托管发布（PodcastHostingCard）

| 字段 | 校验/提示 |
|---|---|
| 托管类型 | 阿里云 OSS；COS 置灰并提示暂不支持 |
| Endpoint | ≤200，必须为 https 域名（主进程校验） |
| Bucket | ≤120 |
| 路径前缀 | ≤160，默认 `podcast` |
| AccessKeyId | ≤160；留空 = 沿用已存凭证 |
| AccessKeySecret | ≤200；`type=password`；留空 = 沿用；**永不回显** |
| 状态 | 已配置显示掩码 Key；未配置显示未配置 |
| 操作 | 保存托管配置（主）/ 测试连通 / 发布本期 Feed / 清除已存凭证（危险） |
| 结果 | 成功 `mp-notice--success`；失败 `mp-notice--danger`；部分成功 `mp-notice--warning`；发布结果含条目数、备份状态 |
| Feed 过期 | `mp-notice--warning` + 「重新发布」按钮 |

#### 5.5.5 频道设置字段与校验（与 `packages/shared-utils/src/podcast-rss.js` 同源）

| 字段 | 限制 | 失败提示（code） |
|---|---|---|
| 频道标题 | 必填，≤255 | `CHANNEL_TITLE_REQUIRED` / `CHANNEL_TITLE_TOO_LONG` |
| 副标题 | ≤120 | `CHANNEL_SUBTITLE_TOO_LONG` |
| 站点地址 | 可空；非空必须 https 绝对地址 | `CHANNEL_LINK_NOT_HTTPS` |
| 频道简介 | 必填，≤4000 | `CHANNEL_DESC_REQUIRED` / `CHANNEL_DESC_TOO_LONG` |
| 语言 | 必填，`^[a-z]{2}(-[A-Z]{2})?$` | `CHANNEL_LANGUAGE_INVALID` |
| 作者/主播名 | 必填 | `CHANNEL_AUTHOR_REQUIRED` |
| 所有者名称 | 可空 | — |
| 所有者邮箱 | 必填，邮箱格式；会公开在 feed 中 | `CHANNEL_OWNER_EMAIL_INVALID` |
| 分级 | `yes/no/clean` | `CHANNEL_EXPLICIT_INVALID` |
| 更新方式 | `episodic/serial` | `CHANNEL_FEED_TYPE_INVALID` |
| 封面地址 | 必填，https 绝对地址 | `CHANNEL_COVER_REQUIRED` / `CHANNEL_COVER_NOT_HTTPS` |
| 封面尺寸 | 必填，`WxH`，正方形，1400~3000 | `CHANNEL_COVER_SIZE_*` |
| 分类 | 必填，两级以内，须在白名单中 | `CHANNEL_CATEGORY_*` |
| 子分类 | 可选，必须在所属顶级分类下 | `CHANNEL_SUBCATEGORY_UNKNOWN` |
| 音频来源 | `url/oss` | — |

- 保存按钮 loading 期间禁用；成功后 toast「频道设置已保存」；失败时错误按字段列在表单下方（`mp-notice--danger` + `<code>field</code>`）。
- 表单字段使用 `mp-field`；标签 12px / 500；提示 12px muted；错误字段加 `aria-invalid="true"`。

#### 5.5.6 单集管理

| 字段 | 限制 |
|---|---|
| 标题 | 必填，≤255（`EPISODE_TITLE_REQUIRED` / `EPISODE_TITLE_TOO_LONG`） |
| 简介 | ≤4000（`EPISODE_DESC_TOO_LONG`） |
| 音频 URL | 必须 https 绝对地址；仅有本地文件且未配置托管 → `EPISODE_HOSTING_NOT_CONFIGURED` |
| 本地文件路径 | 可空；与音频 URL 二选一 |
| 时长（秒） | 整数 1~86400（`EPISODE_DURATION_INVALID`） |
| 字节数 | 正整数；必填（`EPISODE_SIZE_REQUIRED` / `EPISODE_SIZE_INVALID`） |
| 发布时间 | 可空；非空必须可解析（`EPISODE_PUBDATE_INVALID`） |
| 分级 | 继承/yes/no/clean |
| 类型 | full/trailer/bonus（`EPISODE_TYPE_INVALID`） |
| GUID | ≤500（`EPISODE_GUID_TOO_LONG`） |

- 列表行：标题 + 时长/发布时间/类型 + 合规徽标 + 编辑/删除；删除二次确认（行内「确认删除？」+ 是/否）。
- 合规三态：`ok` 不显示；`stock` 显示「存量沿用」；`invalid` 显示「N 项不符合发布要求」+ 逐条原因 + 「仍可播出」提示；`compliance` 缺失时整块不显示（不得渲染成 0 项）。
- 空态：`EmptyState scaffold icon="Headset"`，标题「还没有单集」，说明 + 「新增单集」。
- 新增/编辑表单：`mp-panel` 内嵌，`mp-form-grid`；保存/取消按钮；错误逐字段列出。

#### 5.5.7 发布与自检

- 操作：「构建 Feed」次按钮、「自检 Feed」主按钮。
- 构建成功：`mp-notice--success`，显示条目数、Feed 路径（`code` 可复制）、「复制路径」按钮。
- 构建失败：`mp-notice--danger`，错误码文案 + 逐条 issues。
- 自检：通过 `mp-notice--success`「N 项检查通过」；失败 `mp-notice--danger`「N 项未通过」+ 频道级 issues + 单集 issues + 每条 URL 的 ✓/✗。
- 所有长路径 `word-break: break-all`。

#### 5.5.8 分发端提交指引

- 卡片网格：`repeat(auto-fill, minmax(280px, 1fr))`，卡片背景 `--surface-sunken`、圆角 12px、内边距 16px。
- 卡片内容：平台名（h3 15px/600）、「需手动首次提交」徽标、节奏说明、步骤有序列表、提交/文档链接。
- 无提交地址：显示「暂无提交地址」12px muted，不显示死链。

---

## 6. 数据校验与边界（汇总）

> 本节只声明**本 PR 不新增业务校验**；以下为界面必须正确承载的既有校验，避免视觉改造把错误吞掉或显示成成功。

1. 任何 IPC 返回 `{ code !== 0 }` 必须走错误分支；`resolve` 不等于成功。
2. 草稿列表：`drafts` 非数组时按空数组处理，不崩溃。
3. 文案库：`entry.content` 可能为空、`title` 可能为空、`wordCount` 可能缺失；渲染必须回退到「未命名文案」/0 字。
4. 知识库：`item.tags` 可能不是数组；表格渲染前归一为 `[]`；`like_collect_ratio` 可能为 `null`。
5. 播客：所有 `issues` 必须逐条显示 `message` 与 `field`；`compliance` 缺失 ≠ 合规；`publishResult.state` 三态 success/failed/partial 分别用 success/danger/warning。
6. 文件名/标题中的 `<`、`>`、`&` 由 Vue 自动转义；禁止 `v-html`。
7. 超长文本：标题单行省略 + `title` 属性；正文 3 行截断；Feed 路径 `break-all`；表格单元格 `overflow: hidden; text-overflow: ellipsis`。
8. 空值显示：数字 `-`；文本 `-`；布尔不直接显示 true/false。

---

## 7. 交互逻辑（跨页统一）

| 交互 | 规格 |
|---|---|
| 页面进入 | 页头先渲染（无骨架），内容区按 loading 态显示；不得整页空白 |
| Tab 切换 | 选中态立即变化（本地状态），数据加载中显示骨架；不阻塞切换 |
| 刷新/重试 | 按钮进入 loading，禁用重复点击；失败保留原数据并显示 notice |
| 删除 | 必须二次确认（行内确认或 ElMessageBox）；成功后移除行并 toast；失败保留行并 toast |
| 复制 | 成功后按钮短暂显示「已复制」或 toast；失败提示手动复制 |
| 搜索 | 输入即时过滤；清除按钮可见；Esc 清空（浏览器原生 search 行为） |
| 键盘 | Enter 触发主操作；Space 在按钮上等同点击；行内按钮不冒泡到整卡点击 |
| 焦点返回 | 弹窗关闭后焦点回到触发按钮（沿用现有弹窗实现，不回归） |

---

## 8. 验收标准（AC）

| 编号 | 验收项 | 判据 |
|---|---|---|
| AC-01 | 五页共用骨架 | 源码中五个视图均含 `mp-page` / `mp-page-header` / `mp-page-inner`；契约测试通过 |
| AC-02 | 页标题规格一致 | 五页 h1 均为 24px/600；无页面级 scoped 覆盖 `.page-title`/`.mp-page-title` 字号 |
| AC-03 | 面板规格一致 | 五页面板圆角 16px、描边 `--hairline`、投影 `--elevation-1`；无 1px 深灰边框 |
| AC-04 | 控件规格一致 | 所有按钮走 `mp-btn` 或 `cohere-btn-*`；输入框高度 36px；无 4px 圆角控件 |
| AC-05 | 空态完整 | 五页每个列表/表格空态均有图标 + 标题 + 说明；可行动的空态有按钮 |
| AC-06 | 暗色可用 | 暗色模式下正文对比度 ≥ 4.5:1；无白底黑字残留在面板外 |
| AC-07 | 键盘可用 | Tab 可到达所有操作；焦点环可见；分段控件 `aria-selected` 正确 |
| AC-08 | 播客命名 | 菜单显示「播客」、页面显示「播客 RSS」；zh/en 均有对应 key；`sidebar-menu.test.js` 通过 |
| AC-09 | 业务行为不变 | 五页既有单测全绿；IPC 参数与调用次数不变；无新增/删除 API |
| AC-10 | 响应式 | 900px 与 720px 视口无横向溢出（表格自身滚动除外） |
| AC-11 | 视觉回归 | 五页截图与改造前对比：间距/字号/圆角差异符合规范；无重叠、截断、错位 |
| AC-12 | 文案成对 | 新增 zh key 均有 en；`check-locale-sync` 通过 |
| AC-13 | 无硬编码色 | 新增 CSS 只使用 token 或既有语义变量；`page-scaffold.contract.test.js` 通过 |
| AC-14 | 行数门禁 | `Publish.vue` 不超过 1775 行；新增文件 ≤500 行；`check-max-lines` 通过 |

---

## 9. 测试计划

### 9.1 单元/组件测试

- `apps/desktop/src/styles/page-scaffold.contract.test.js`
  - CSS 文件存在且被 `main.js` 在 `premium-design-system.css` 之后导入；
  - 关键类名齐全（`mp-page` / `mp-page-header` / `mp-panel` / `mp-row` / `mp-btn` / `mp-segmented` / `mp-field` / `mp-notice` / `mp-chip` / `mp-table`）；
  - 无硬编码 `#rrggbb`（允许 `rgba(0,0,0,...)` 仅限遮罩）；
  - 五个视图均引用骨架类；
  - `prefers-reduced-motion` 规则存在。
- `apps/desktop/src/views/PublishDraftsPage.test.js`
  - 渲染标题/副标题/计数/行标题/时间/平台徽标；
  - 空态文案与返回动作；
  - 点击「去发布」「删除」「返回」emit 正确参数；
  - 加载态渲染骨架而非空态。
- `CreatorMonitor` 既有测试扩展：断言 `.mp-panel`、`.mp-notice`、空态 CTA。
- `CopyLibraryView.test.js` 扩展：断言 `mp-segmented`、`mp-search`、卡片 `mp-chip`、空态动作。
- `KnowledgeBasePage` 既有测试扩展：断言页头无 `--coral` 依赖（或 class 为 `mp-btn--primary`）、`mp-segmented`、表格 `mp-table`。
- `PodcastChannelView.test.js` 扩展：断言页标题 `zh.podcast.pageTitle === '播客 RSS'`、根节点 `mp-page`、按钮 class。
- `sidebar-menu.test.js`：`podcast` 项 `labelI18nKey === 'sidebar.nav.podcast'`。
- `locales/structure-lock.test.js` / `check-locale-sync`：新增 key 成对。

### 9.2 手工/截图验证

- 使用 Vite + Playwright 在 1440×900 与 2560×1328 两个视口截图五页；
- 每页覆盖：有数据、空数据、筛选空、错误提示（能构造时）；
- 与改造前截图并排检查：页头基线、卡片圆角/阴影、行高、按钮主次、空态完整性；
- 暗色模式抽查至少 1 页（播客或知识库）。

### 9.3 质量门禁

- `pnpm --filter @multi-publish/desktop test`（至少五个页面的测试文件）
- `pnpm --filter @multi-publish/desktop lint`
- `pnpm --filter @multi-publish/desktop build:vue`
- `node scripts/classify-docs-only.js`（预期 false，混合 PR）
- QM-1：本次不改 `electron/` 与 `rpa-engine/`，无需打包验证；如改动主进程则补跑。
- QM-4：截图证据写入执行记录。

---

## 10. 风险与兼容

| 风险 | 影响 | 缓解 |
|---|---|---|
| 全局 `page-scaffold.css` 影响其他页面 | 范围外页面视觉漂移 | 类名全部 `mp-` 前缀；不改既有 `cohere-*` 规则；只在五个视图引用 |
| 删除 scoped 样式导致局部回归 | 某页原有细节丢失 | 逐页截图对比；保留页面特有规则（如表格最小宽度、行内确认） |
| `Publish.vue` 行数超门禁 | CI 红 | 抽出 `PublishDraftsPage.vue`，净减少行数 |
| 文案新增导致 zh/en 不同步 | Gate 7 红 | 同一提交成对新增；`check-locale-sync` 本地先跑 |
| 暗色模式对比度 | 可读性下降 | 只用 token；截图抽查；不新增固定白底 |
| 视觉改造改变 DOM 结构影响测试 | 既有测试失败 | 保留所有 `data-testid`；仅新增 class/包裹层；逐页跑测试 |

### 回滚方案

- 纯渲染层改动，`git revert` 单个 squash 提交即可回滚；无数据迁移、无 IPC 变更。
- 若仅某页回归，可单独回滚该页文件（`PublishDraftsPage.vue` / `CreatorMonitor.vue` / `CopyLibraryView.vue` / `KnowledgeBasePage.vue` / `PodcastChannelView.vue`），其余页不受影响。

---

## 11. 发布说明（用户可见）

- 五个页面统一为新的视觉体系：更清晰的页头、更柔和的面板、更克制的品牌色、更完整的空态与错误提示。
- 「播客 RSS 频道」在左侧菜单更名为「播客」，页面标题改为「播客 RSS」。
- 功能、数据与操作路径不变。

---

## 12. 附录：页面截图基线索引

| 页面 | 截图文件名（建议） |
|---|---|
| 草稿页 | `ui-consistency/drafts-default.png`、`ui-consistency/drafts-empty.png` |
| 博主监控 | `ui-consistency/creator-default.png`、`ui-consistency/creator-empty.png` |
| 文案库 | `ui-consistency/copy-library-default.png`、`ui-consistency/copy-library-filter-empty.png` |
| 知识库 | `ui-consistency/knowledge-base-viral.png` |
| 播客 RSS | `ui-consistency/podcast-default.png` |

> 截图存放在 `apps/desktop/tests/visual-testing/screenshots/ui-consistency/`，不纳入版本控制（由 `.gitignore` 覆盖）；执行记录引用其相对路径与生成时间。
