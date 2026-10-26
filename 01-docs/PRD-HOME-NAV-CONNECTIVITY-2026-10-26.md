# PRD — 首页导航连通性与发布记录快捷筛选

| 字段 | 内容 |
| --- | --- |
| 文档类型 | PRD（功能需求 + 交互规格 + 验收口径） |
| 变更标识 | `home-nav-connect` |
| 日期 | 2026-10-26 |
| 影响面 | `apps/desktop/src` 渲染层（Home / Accounts / Publish / PublishHistory / locales / 两个新 composable / 一个新组件） |
| 优先级 | P1（可用性修复，不涉及数据迁移与主进程） |
| 关联 OpenSpec | `openspec/changes/home-nav-connect/` |
| 关联执行记录 | `openspec/records/home-nav-connect.md` |

## 1. 背景与问题

首页、发布页与发布记录页之间当前存在一组「看得到但走不通」的断点：

1. **首页「添加账号」只跳页、不接续动作**：用户点「添加账号」后落在账号页，但必须再点一次页面右上角的「添加账号」才能看到添加账号浮层。首个动作的语义是「我要添加账号」，落地页却把用户丢在一个只读列表上。
2. **发布页缺少发布记录的显式入口**：发布页只在「定时发布已创建」的结果卡里出现一个「查看发布记录」按钮；用户没走到该分支时，发布页没有任何稳定可见的历史入口。
3. **发布记录页只能通过下拉框筛选状态**：用户要查看失败记录，需要展开一个下拉框并二次选择；常用状态没有一键切换的可见入口。
4. **首页统计卡只是信息展示**：总发布 / 成功 / 失败 / 已绑定账号四张卡没有链接，用户看到「失败 4」却不能直接查看这 4 条失败记录。
5. **首页快捷入口「私信评论」与实际需求不匹配**：该入口占用一个高价值快捷位，但本阶段用户更高频的需求是「视频创作」；图标仍为聊天气泡，语义也不对应。
6. **首页近期动态不可点**：列表只展示标题/平台/状态/时间，用户无法从近期动态直接打开平台作品页。

上述问题都属于同一类：**界面已经持有信息与目标路由，但没有把「下一步」做成可点击的单一出口**。本 change 只做导航连通性与入口优化，不新增发布能力、不改主进程 IPC、不改历史数据格式。

## 2. 目标与非目标

### 2.1 目标

- G1：首页「添加账号」一次点击完成「跳转账号页 + 打开添加账号浮层」。
- G2：发布页提供稳定可见的「发布记录」入口。
- G3：发布记录页提供「全部 / 发布成功 / 发布失败 / 处理中」四个状态快捷标签，一键切换。
- G4：首页四张统计卡全部可点击，分别落到对应筛选视图或账号页。
- G5：首页快捷入口「私信评论」替换为「视频创作」，使用同色系同风格线性图标。
- G6：首页近期动态中「有公开作品链接」的条目可点击打开对应内容；无链接条目保持不可点并说明原因。
- G7：所有新增路由参数、筛选状态、链接解析均有明确的数据校验与异常兜底，不出现空白页 / 假链接 / 未处理拒绝。

### 2.2 非目标

- 不新增发布记录服务端筛选参数（本期仍由渲染层在已加载记录上筛选，沿用既有补页扫描上限）。
- 不改变首页统计口径（仍为 `dashboard:stats` 与 `accounts:list` 两个真实数据源）。
- 不改变发布记录卡片、详情弹窗、批量删除、导出、指标刷新等既有功能。
- 不改 `Home` 的视觉主题、品牌色、间距体系与暗色模式策略。
- 不引入新的全局状态库；两个新 composable 只做页面级编排。

## 3. 用户故事

| 编号 | 角色 | 故事 | 价值 |
| --- | --- | --- | --- |
| US-1 | 新用户 | 我在首页点「添加账号」，希望账号页直接弹出添加账号浮层 | 少一次点击，避免「到底在哪里添加」的困惑 |
| US-2 | 内容运营 | 我想从发布页随时查看刚发/历史发布结果 | 发布与复盘形成闭环，不用先回首页 |
| US-3 | 内容运营 | 我想在发布记录页一键看失败记录 | 快速定位需要重试的内容 |
| US-4 | 管理者 | 我看到首页「失败 4」时想直接看这 4 条 | 数据卡从「展示」变成「可行动」 |
| US-5 | 视频创作者 | 我希望首页快捷入口直接进入视频创作 | 减少跨模块找入口的成本 |
| US-6 | 内容运营 | 我想点近期动态里的作品直接打开平台内容页 | 从「看到记录」到「查看作品」零跳转 |

## 4. 全局交互与路由合同

### 4.1 路由参数合同

| 来源 | 目标路由 | 参数 | 说明 |
| --- | --- | --- | --- |
| 首页「添加账号」按钮 | `/accounts` | `action=add-account` | 账号页消费后立即从 URL 移除该参数，避免刷新/后退重复弹层 |
| 首页「总发布」卡 | `/publish/history` | `status=all` | `all` 与缺省等价，显式写出便于用户理解当前视图 |
| 首页「成功」卡 | `/publish/history` | `status=success` | 只显示归一化状态组 `success` |
| 首页「失败」卡 | `/publish/history` | `status=failed` | 只显示归一化状态组 `failed` |
| 首页「已绑定账号」卡 | `/accounts` | 无 | 账号管理默认视图 |
| 首页快捷入口「视频创作」 | `/create` | 无 | 复用既有视频创作页路由 |
| 发布页「发布记录」入口 | `/publish/history` | 无 | 默认「全部」 |
| 发布记录页状态标签 | `/publish/history` | `status=success\|failed\|pending`；选「全部」时移除 `status` | 使用 `router.replace`，不新增浏览器历史噪声 |

**参数校验**：`status` 只接受 `all` / `success` / `failed` / `pending`（大小写不敏感，数组取首值）；其它值、空串、`null`、对象一律归一化为「全部」，不得抛错、不得渲染空页。`action` 只接受精确值 `add-account`；其它值不触发弹层，且不从 URL 删除（避免误删未来参数）。

### 4.2 状态归一化口径（复用既有真源）

发布记录状态展示与筛选统一走 `usePublishRecordActions` 的 `normalizedStatusGroup(record)`：

| 原始值 | 归一组 | 标签 |
| --- | --- | --- |
| `success` / `completed` / `published` | `success` | 发布成功 |
| `failed` / `error`，或 `record.success === false` | `failed` | 发布失败 |
| `running` / `pending` / 其它未知值 | `pending` | 处理中 |

**不得**在本 change 里另写第二套状态映射；状态标签与卡片徽标必须使用同一函数，避免「标签说成功、卡片说失败」的分裂。

### 4.3 全局无障碍与键盘合同

- 所有新增可点击区域必须是原生 `button` / `a`，不得用 `div role="button"` 包裹可见可聚焦后代。
- 键盘焦点环统一使用 `--color-focus-ring`，键盘 `Enter` / `Space` 行为与鼠标点击同出口。
- 状态标签使用原生 `button` + `aria-pressed`，容器 `role="group"`（不是 `tablist`：该组不切换面板，只改变筛选条件）。
- 近期动态中的外链使用 `<a href>`，点击时 `preventDefault` 改走应用内标签；无链接条目渲染为普通 `div`，不进入 Tab 顺序。

## 5. 需求详述

### R1 首页「添加账号」跳转并自动打开添加账号浮层

**触发**：首页欢迎区「添加账号」按钮（`data-testid="home-add-account"`）。

**流程**：

1. 点击按钮 → `router.push({ path: '/accounts', query: { action: 'add-account' } })`。
2. 账号页挂载或已挂载时监听 `route.query.action`。
3. 命中 `add-account` → `showAddDialog = true`（打开 `AccountLoginDialog`）。
4. 同一次事件内把 `action` 从 query 移除：`router.replace({ path: '/accounts', query: { ...route.query, action: undefined } })`，保留 `tab` 等其它合法参数。
5. 用户关闭浮层后停留在账号页，不再次自动打开。

**数据校验**：

- `action` 非 `add-account` → 不弹层、不改 URL。
- 账号页已在「分组 / 收藏分组」tab 时收到该参数 → 仍打开弹层（添加账号是全局动作，不依赖当前 tab）；关闭后保留原 tab。
- 浮层组件自身负责平台选择校验、登录链路与错误提示，本 change 不改其内部逻辑。

**显示项**：账号页原有布局不变；浮层沿用 `AccountLoginDialog` 现有标题、平台选择、登录方式与按钮文案。

**提示文字**：无新增文案；浮层内部文案沿用 `accountsPage.*` 既有词条。

**边界与异常**：

- `router.replace` 失败（路由被卸载/导航竞态）→ 不影响已打开的浮层；记录 `reportError` 日志，不向用户弹错。
- 用户刷新账号页时 URL 已无 `action`，不会二次弹层。
- 首次进入即带 `action` 且账号列表尚未加载完成 → 浮层可以先打开，平台列表由 `platformStore` 异步填充；不得因账号数为 0 而阻止打开。

**验收**：

- AC-R1-1：点击首页「添加账号」后 URL 为 `/accounts?action=add-account`，账号页 `showAddDialog === true`。
- AC-R1-2：弹层打开后 URL 中不再包含 `action`；`tab` 等其它参数保留。
- AC-R1-3：非 `add-account` 的 `action` 值不触发弹层。

### R2 发布页新增「发布记录」稳定入口

**形式决策**：采用**页头一级导航按钮**，不放在右侧操作卡内。理由：

1. 发布记录是「页面级去向」，不是一次发布动作；与「保存草稿 / 一键发布」混排会让用户误以为它会改变当前编辑内容。
2. 页头在编辑区滚动时仍处于首屏可发现位置，满足「明显入口」诉求。
3. 右侧操作卡已有保存草稿、视频创作、草稿箱、发布、取消任务五个按钮，继续加会稀释主 CTA。
4. 复用 `UiButton` 的 ghost/secondary 视觉语言，不引入新的按钮风格。

**位置**：发布页页头 `.publish-header-row` 末尾，批量模式开关之后；草稿箱页面不显示（草稿箱自己的页头已有「返回发布」）。

**交互**：点击 → `router.push('/publish/history')`。不在当前页做浮层或抽屉，避免与发布编辑态争抢焦点/触发未保存提示。

**显示项**：图标 + 文案「发布记录」；英文 `Publish History`。按钮带 `data-testid="publish-open-history"`，可访问名与可见文案一致。

**边界与异常**：无桥/无路由环境（单测）下按钮仍可渲染；`router.push` 拒绝时不崩溃、不改变当前编辑内容。

**验收**：

- AC-R2-1：发布页页头存在可见「发布记录」按钮。
- AC-R2-2：点击后调用 `router.push('/publish/history')`。
- AC-R2-3：草稿箱视图不渲染该按钮。

### R3 发布记录页状态快捷标签

**位置**：发布记录工具卡顶部，搜索框上方；替换原「发布状态」下拉框（同一筛选能力不保留两套控件）。

**标签集合**：`全部` / `发布成功` / `发布失败` / `处理中`，对应 `statusFilter` 值 `''` / `success` / `failed` / `pending`。

**交互**：

1. 点击标签 → 立即更新 `statusFilter`（列表即时过滤，不等待防抖）。
2. 同时用 `router.replace` 把 `status` 写入 URL（选中「全部」时删除该参数）。
3. 外部路由变化（例如首页统计卡跳转）→ 监听 `route.query.status` 并同步 `statusFilter`。
4. 点击「清除筛选」→ `statusFilter = ''`，URL 中 `status` 被移除。

**显示项**：

- 标签为原生按钮，`aria-pressed` 反映选中态；选中态使用既有 `.history-tab.active` 视觉（品牌色 + 加粗）。
- 保留记录总数、筛选来源说明、截断提示等既有信息。
- 不显示「每个状态的数量」：当前只加载前 50 条（筛选时最多补扫 20 页），显示局部数量会让用户误以为是全量统计。

**数据校验**：

- `status` 非法值 → 归一化为「全部」，不抛错。
- 状态筛选与其它筛选（发布人/类型/模式/平台/时间/搜索）叠加，任一不满足即不显示。
- 状态筛选触发补页扫描，沿用 `FILTER_SCAN_MAX_PAGES=20` 上限与「已在已加载 N 条中筛选」文案。

**提示文字**：无新增提示；「处理中」沿用 `historyPage.filterStatusPending`。

**验收**：

- AC-R3-1：默认「全部」选中，列表显示全部状态。
- AC-R3-2：点击「发布失败」只显示 `failed` 组记录，按钮 `aria-pressed="true"`。
- AC-R3-3：URL 为 `status=failed`；点击「全部」后 URL 中无 `status`。
- AC-R3-4：直接访问 `/publish/history?status=success` 时初始选中「发布成功」。
- AC-R3-5：`status=not-a-status` 回落「全部」，页面不空白。

### R4 首页统计卡可点击

**卡片与目标**：

| 卡片 | `data-testid` | 点击目标 | 目标页选中标签 |
| --- | --- | --- | --- |
| 总发布 | `home-stat-total` | `/publish/history?status=all` | 全部 |
| 成功 | `home-stat-success` | `/publish/history?status=success` | 发布成功 |
| 失败 | `home-stat-failed` | `/publish/history?status=failed` | 发布失败 |
| 已绑定账号 | `home-stat-accounts` | `/accounts` | — |

**交互**：整卡为原生 `button`；鼠标悬停有抬升与边框变化（沿用既有 `.mp-home-stat-card:hover`）；键盘 `Enter` / `Space` 与点击同出口。数字与标签是按钮内容，不额外放「查看」文字（四个卡片空间有限，避免信息噪音）；通过 `title` / `aria-label` 说明去向。

**数据校验**：统计值仍来自 `dashboard:stats`；账号数来自 `accountStore.accounts`。本 change 不改变统计口径，也不使用 SQLite 脱钩数据源。

**边界**：数据未加载完成时点击仍可跳转（目标页自行加载）；数字为 0 时卡片仍可点击（可进入空态页）。

**验收**：

- AC-R4-1：四张卡均为 `BUTTON` 元素。
- AC-R4-2：点击分别调用对应路由。
- AC-R4-3：键盘 Enter/Space 与点击同出口。

### R5 首页「已绑定账号」卡片跳转账号页

该卡片属于 R4 的第四张，单独列出的原因是它不进入发布记录，而是复用账号页默认视图。点击后 `/accounts`，不携带 `action`（不自动弹添加浮层，因为用户意图是「查看已绑定账号」而非「添加」）。

**验收**：

- AC-R5-1：点击「已绑定账号」卡 → `router.push('/accounts')`。
- AC-R5-2：不会自动打开添加账号浮层。

### R6 快捷入口「私信评论」→「视频创作」

**变更**：

- 文案：`home.comments`（私信评论）→ 新键 `home.videoCreation`（视频创作 / Video Creation）。
- 路由：`/comments` → `/create`。
- 图标：`ChatDotRound` → `VideoCamera`（Element Plus 线性图标），尺寸 22、颜色沿用 `.shortcut-icon` 的既有继承色（不新增颜色）。
- `data-testid`：`home-shortcut-video-creation`（原入口无 testid，新增便于回归）。

**位置**：快捷入口网格第 6 个位置不变，保持 3×2 布局与六项数量；其余五个入口不动。

**边界**：`/comments` 页面与路由保留（不删除能力），只是首页快捷入口不再指向它；侧边栏/其它入口若存在不受影响。

**验收**：

- AC-R6-1：首页快捷入口文本为「视频创作」，不再出现「私信评论」。
- AC-R6-2：点击第 6 个快捷入口 → `router.push('/create')`。
- AC-R6-3：图标为 `VideoCamera`，尺寸/颜色类与其它快捷入口一致。

### R7 近期动态条目可打开作品链接

**数据来源**：`api.historyList({ limit: 5, offset: 0 })` 返回的 `records`。

**可点判据**（与发布记录页**同一实现** `usePublishHistoryContentLink`）：

1. 若 `record.result.draft === true` → 不可点（只进平台草稿箱，无公开作品）。
2. 解析 `resolvePublishedContentUrl({ platform, postId: result.postId || platformWorkId, recordedUrl: result.url })`：
   - 命中平台公开内容页白名单 → 使用记录 URL；
   - 否则由合法作品 ID 派生公开内容页；
   - 都不成立 → 不可点。
3. URL 必须通过 `safeHttpUrl` 协议白名单（http/https）。

**交互**：

- 可点条目渲染为 `<a href="...">`，`title` 为「点击打开平台作品链接」；点击 `preventDefault` → `tabStore.createTab({ url, platform, title })` 在应用内新标签打开。
- `createTab` 返回空（桥不可用/创建失败）→ 回退 `window.open(url, '_blank')`，由主进程外链白名单兜底。
- 打开中同一记录重复点击忽略（`usePublishHistoryContentLink` 内部 `openingCardIds` 守卫）。
- 无链接条目渲染为 `div`，`title` 按三态原因说明：草稿 / 平台结构性无网页内容页 / 未抓到作品 ID / 无公开链接。

**显示项**：标题、平台、状态、时间不变；可点条目增加手型光标与 hover 背景，不新增按钮，避免列表每行出现第二个焦点站。

**边界**：`result` 缺失、`result` 非对象、`url` 非字符串、作品 ID 为合成前缀（`published-` / `task_` / `tmp`）→ 均按无链接处理，不生成假链接。

**验收**：

- AC-R7-1：带合法 `result.postId` 的知乎记录渲染为 `<a>`，`href` 为派生公开页。
- AC-R7-2：点击调用 `tabStore.createTab`，参数含 URL、平台与标题。
- AC-R7-3：无链接记录渲染为 `div`，无 `href`、不进入 Tab 顺序。
- AC-R7-4：草稿记录（`result.draft === true`）不可点。

## 6. 文案清单（zh / en 成对）

| 键 | 中文 | 英文 | 使用位置 |
| --- | --- | --- | --- |
| `home.videoCreation` | 视频创作 | Video Creation | 首页快捷入口 |
| `home.statHintTotal` | 查看全部发布记录 | View all publish records | 总发布卡 title/aria-label |
| `home.statHintSuccess` | 查看发布成功记录 | View successful publishes | 成功卡 |
| `home.statHintFailed` | 查看发布失败记录 | View failed publishes | 失败卡 |
| `home.statHintAccounts` | 前往账号管理 | Go to account management | 已绑定账号卡 |
| `publishPage.publishHistory` | 发布记录 | Publish History | 发布页页头入口 |
| `historyPage.statusTabAll` | 全部 | All | 发布记录状态标签 |

其余复用既有键：`historyPage.filterStatusSuccess` / `filterStatusFailed` / `filterStatusPending`、`historyPage.cardOpenHint`、`historyPage.cardDraftHint`、`historyPage.cardNoLinkStructural`、`historyPage.cardNoLinkNoPostId`、`historyPage.cardNoLinkHint`、`historyPage.cardTabTitle`、`historyPage.cardLinkOpened`、`historyPage.cardLinkOpenFailed`。

**文案规则**：

- 中文与英文必须同 PR 成对提交；英文不使用中文标点。
- 不使用「点击这里」等空泛文案；按钮文案必须描述结果。
- 状态标签的「全部」不带数量，避免暗示全量统计。

## 7. 数据校验与异常矩阵

| 场景 | 期望行为 | 用户可见反馈 |
| --- | --- | --- |
| `/accounts?action=add-account` | 自动打开添加账号浮层并清理参数 | 浮层出现 |
| `/accounts?action=other` | 不弹层、不改 URL | 无 |
| `/publish/history?status=success` | 初始筛选成功 | 「发布成功」高亮 |
| `/publish/history?status=bad` | 回落全部 | 「全部」高亮，无报错 |
| `/publish/history?status=success&status=failed` | 取首值 `success` | 「发布成功」高亮 |
| 首页统计 IPC 失败 | 卡片显示 0，仍可点击 | 目标页自行展示空/错态 |
| 近期动态 `historyList` 失败 | 显示既有空态 | 不阻断整页 |
| 记录无公开链接 | 条目不可点 | `title` 说明原因 |
| `createTab` 失败 | 回退系统浏览器 | 若仍失败则静默，不抛未处理异常 |
| 路由 replace 失败 | 不影响页面内筛选/浮层 | 无弹窗，仅日志 |

## 8. 非功能需求

- **性能**：首页首屏并行取数逻辑不变；统计卡改为按钮不新增请求。近期动态链接解析为纯函数，最多 5 条，渲染期成本可忽略。发布记录状态筛选沿用既有防抖补页，不新增全表循环。
- **可访问性**：原生控件、可见焦点环、`aria-pressed`、`title`/`aria-label`、无嵌套交互控件。
- **i18n**：新增文案 zh/en 成对；不在渲染端写中文字面量。
- **安全**：外链必须经 `safeHttpUrl` + `resolvePublishedContentUrl` 双重判据；应用内打开走 tabStore，回退 `window.open` 由主进程白名单兜底。
- **可维护性**：状态筛选与账号深链分别收敛到 composable；发布页入口收敛到独立组件，避免继续膨胀 `Publish.vue`（该文件已挂零增长行数门禁）。
- **兼容性**：不新增 IPC、不改数据库、不改历史记录格式；旧记录无需迁移。

## 9. 验收清单（手动 + 自动）

### 9.1 自动化测试矩阵

| 范围 | 测试文件 | 关键断言 |
| --- | --- | --- |
| 首页 | `views/Home.test.js` | 快捷入口文案/路由、四张统计卡路由、近期动态链接、键盘行为 |
| 账号页 | `views/Accounts.test.js` | `action=add-account` 自动弹层、参数清理、非匹配值不弹 |
| 账号深链 | `features/accounts/useAccountAddDeepLink.test.js` | 初始/后续 query、替换参数、异常静默 |
| 发布页入口 | `features/publish/components/PublishHistoryEntry.test.js` | 文案、可访问名、点击路由 |
| 发布页接线 | `views/Publish.history-entry-wiring.test.js` | SFC 引入并渲染入口组件 |
| 发布记录状态筛选 | `views/PublishHistory.test.js` | 四标签、点击筛选、URL 同步、非法值回落 |
| 状态筛选 composable | `composables/usePublishHistoryStatusFilter.test.js` | 归一化、双向同步、replace 失败不抛 |
| 国际化 | `locales/structure-lock.test.js` + 新增断言 | zh/en 键成对 |

### 9.2 手动验收步骤

1. 首页点击「添加账号」→ 账号页立即出现添加账号浮层；关闭后 URL 无 `action`。
2. 发布页页头点击「发布记录」→ 进入发布记录页。
3. 发布记录页依次点击四个状态标签 → 列表即时变化且 URL 同步。
4. 首页点击「成功」「失败」卡 → 发布记录页对应标签选中。
5. 首页点击「已绑定账号」→ 账号页，且不自动弹添加浮层。
6. 首页快捷入口第 6 项显示「视频创作」，点击进入 `/create`。
7. 首页近期动态：有公开链接的记录可点击并在应用内新标签打开；无链接记录不可点且悬停有原因说明。

## 10. 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 状态筛选补页扫描在大数据量下变慢 | 用户等待 | 沿用 20 页上限 + 截断提示；不在本 change 新增服务端能力 |
| 账号深链参数与其它 query 冲突 | 账号页 tab 丢失 | 清理 action 时保留其余 query；只精确匹配 `add-account` |
| 近期动态链接判据误判 | 打开登录墙/404 | 复用发布记录页同一判据；无证据不给链接 |
| 首页统计卡改为按钮导致样式偏移 | 视觉回归 | 复用原卡片 class；新增样式独立文件，不覆盖品牌 token |
| `Publish.vue` 行数门禁 | CI 红 | 入口抽成独立组件，仅 +2 行接线；若超限按门禁登记理由上调 target |

**回滚**：本 change 无数据写入，回滚只需 revert 提交；`/publish/history?status=` 参数对旧版本无影响（旧版本忽略未知 query）。

## 11. 里程碑

| 阶段 | 交付 |
| --- | --- |
| M1 | PRD + OpenSpec change + 测试骨架 |
| M2 | 首页 4 项（添加账号深链 / 统计卡 / 快捷入口 / 近期动态） |
| M3 | 发布页入口 + 发布记录状态标签 |
| M4 | i18n、样式、行数与质量门禁 |
| M5 | PR + CI + 合并 + 记忆沉淀 |
