# PRD-DASHBOARD-TRUTHFUL-UI-2026-10-25 · 数据页「真实数据 + 统一视觉 + 浮标安全区」

> 状态：已实现（随本 PR 合入）
> 适用模块：桌面端「数据」页（`/dashboard`，`apps/desktop/src/views/Dashboard.vue`）
> 触发来源：用户 2026-10-25 的三条现场反馈（遮挡 / 视觉不统一 / 数据不真实）
> 关联规范：`docs/desktop-ui-layout-spec.md` §14（回到顶部浮标）、§16（浮标安全区，本次新增）

---

## 0. 一句话

数据页此前把「**取不到真值**」渲染成「**看起来像真数据的 0**」，同时右下角固定浮标会压住页面自己的按钮、同一页并存三套面板标题样式。本 PRD 一次性处理这三件事，并给出可核对的判据与回归锁。

---

## 1. 问题与根因（取证优先）

### 1.1 用户报告的三条现象

| # | 现象 | 是否属实 | 根因 |
|---|------|---------|------|
| ① | 数据页拉到底，右下角按钮被「回到顶部」快捷按钮挡住 | ✅ 属实 | `BackToTop` 是 `position: fixed`（right/bottom 24px, 44×44），**压住文档流里落在同一矩形的内容**；数据页最后一行「内容基准比较 · 分析」按钮正好在那个位置 |
| ② | 整个 UI 界面的元素样式和布局不统一 | ✅ 属实（6 处客观不一致，见 §3.2） | 同一页并存三套面板标题类、两套品牌紫、两套数字字形、两套绿色、平台卡指标区**全仓无样式定义** |
| ③ | 这页里面的所有数据都查一遍，有的没显示真实数据 | ✅ 属实，且比用户看到的更严重 | `sync:cached` 那条链路在主进程**恒返回常量 0**，并被盖上 `syncedAt: now` 写进缓存 ⇒ 界面显示「0阅读 · 更新于 10:51」，**看上去是刚采到的真数据** |

### 1.2 现象 ③ 的完整根因链（这是本次修复的主体）

```
DataSyncService（packages/shared-utils/src/data-sync.js）
  └─ _rpaFetchStats(platform, url, script)
       ├─ window.electronAPI?.rpaFetchData(...)   ← 只存在于**渲染进程**
       ├─ require('electron').ipcRenderer.invoke() ← 只存在于**渲染进程**
       └─ 兜底 return { articles:0, views:0, comments:0, likes:0, followers:0, _note:'RPA 不可用' }
                                                    ↑ 本服务跑在**主进程**
                                                      （core/container.setup.js: new DataSyncService(store)）
                                                      ⇒ 前两条分支必然落空 ⇒ 必然是这组 0
  └─ _makeSyncResult() 给它打上 syncedAt: now → _cacheData() 写进 SQLite
       └─ sync:cached → 看板「各平台数据」5 张卡片全部显示 0/0/0/0
```

补充事实（已逐条 grep 确认）：

- `rpa:fetchData` 这个 IPC 通道**全仓没有任何 handler**（`apps/desktop/electron/ipc-handlers/` 下不存在）⇒ 即使在渲染进程里调用也会失败。
- 仓库里另有一条**真实**的创作者中心通路（`analytics:overview` + `analytics-providers.js`，已注册小红书 / 抖音 provider），但它**每次调用都直连平台**，与「不能太频繁查询以防被封」的既有约束冲突，且主进程没有对该通道的节流 ⇒ 本次不接入（见 §9 P2-2）。

### 1.3 现象 ③ 派生出的第二处自相矛盾

KPI 行的「已发布内容」取自 `Σ platformData[].articles` ⇒ 恒为 0；而同页「发布统计 · 累计发布」取自 `dashboard:stats.total` ⇒ 是真实总数（如 42）。
⇒ **同一页两个数字互相打脸**：上方说「已发布内容 0」，下方说「累计发布 42」。

### 1.4 现象 ① 的规范缺口

`docs/desktop-ui-layout-spec.md` §14 定义了浮标的位置、显隐、层级，§14.8 只协调了「**浮标 vs 浮标**」（`UpdateNotification` 右移 88px 避让 `BackToTop`），**从未协调「浮标 vs 页面内容」** ⇒ 这个洞一直在，直到本页最后一行恰好落在右下角才暴露。

---

## 2. 范围与不做清单

### 2.1 本次做

| 项 | 内容 |
|---|---|
| T1 | 浮标**安全区**机制：全局几何 token + 页面底部净空 + 规范补章 |
| T2 | 数据页视觉统一：品牌色 / 面板标题 / 数字字形 / 语义色 / 平台卡指标区 五处收敛 |
| T3 | 数据真实性：换掉假数据源、建立「数字有出处 / 取不到显示『—』」口径、修 `data-sync.js` 的静默兜底 |

### 2.2 本次**不做**（明确留白，避免以后被误当成漏做）

| 不做项 | 原因 |
|--------|------|
| 接入 `analytics:overview` 拿账号粉丝数 | 每次调用直连平台创作者中心，与既有「防封频控」约束冲突，且主进程无节流。**记为 P2-2**（§9） |
| 改造作品回采（`account-metrics`）的采集能力 | 本次只**消费**它已有的真实数据，不改它的调度与频控 |
| 把 `data-sync.js` 的 RPA 通道真正实现出来 | 需要为每个平台写创作者后台解析脚本 + 反爬对抗，是独立立项（§9 P2-1） |
| 全站视觉统一 | 本次只动数据页；全站统一会让 20+ 张像素基线同时失效，收益/风险比不划算 |
| 移动「回到顶部」浮标的位置 | 规范 §14 已定「右下角」，改位置属于产品决策，不是缺陷修复 |

---

## 3. 方案

### 3.1 T1 · 浮标安全区

**机制（三层，缺一层就会复发）**

| 层 | 做法 | 落点 |
|---|------|------|
| ① 几何单一真源 | 右下角浮标的几何只在**一个**文件里定义一次：`--mp-float-zone-right/bottom/size/gap/stack-offset` 与 `--mp-float-safe-bottom` | `apps/desktop/src/styles/float-zone.css`（**单独成文件**：tokens.css 已 498 行、离「行数债务熔断」的 500 行硬上限只差 2 行，而浮标几何属交互几何、不是配色 token，塞进去会直接把该文件顶过上限） |
| ② 浮标之间不重叠 | `BackToTop` / `PublishProgressPanel` 改为引用 token（数值与改前**逐字一致** ⇒ 零视觉回归），「不重叠」从巧合变成可核对的几何契约 | `components/BackToTop.vue`、`components/PublishProgressPanel.vue` |
| ③ 内容避开浮标 | 数据页根节点加 `padding-bottom: var(--mp-float-safe-bottom)` ⇒ 滚到底时最后一行内容停在浮标区上方 | `views/Dashboard.vue` |

**数值**（与改前一致，不是新设计）

```
--mp-float-zone-right: 24px        （原 right: var(--spacing-6)）
--mp-float-zone-bottom: 24px       （原 bottom: var(--spacing-6)）
--mp-float-zone-size: 44px         （原 width/height: 44px）
--mp-float-zone-gap: 8px
--mp-float-zone-stack-offset: 52px （= size + gap；原 calc(spacing-6 + 52px) 的语义等价物）
--mp-float-safe-bottom: 84px       （= bottom 24 + size 44 + 呼吸 16）
```

⚠️ **为什么不给全站 `.cohere-content` 加安全区**：那会让 22 个使用该类的页面同时改变版面 ⇒ 20+ 张像素基线失效。⇒ 本次只对数据页生效，并在规范里写明「新增带右下角操作的页面必须自行预留」。

### 3.2 T2 · 视觉统一（6 处客观不一致）

| # | 不一致 | 改前 | 改后（单一真源） |
|---|--------|------|-----------------|
| 1 | **两套品牌紫** | 本页 `:global(:root)` 写死 `--lavender-primary #7c5cbf` / `--lavender-accent #f472b6` / `--deep-purple #1e1b4b`，与全局 `--primary`(#5048E5) 并存，且**不随主题切换**（暗色下 `--deep-purple` 对比度 1.09:1） | 四个变量降级为**别名**，值全部指向全局 token；页面里的品牌紫一律走 `--primary` / `--brand-gradient` |
| 2 | **三套面板标题** | `.panel-title`（17px + 底部分隔线）/ `.dash-panel-title`（15px）/ `.dash-extra-title`（15px + 无图标底座） | 全部收敛到全局 `.dash-panel-title`（字号、下间距、图标底座、flex 排版一处定义） |
| 3 | **两套数字字形** | `.stat-value` 用 `--font-family-ui-display`；`.stat-value-mini` 用 `'JetBrains Mono', monospace`（本机没装 ⇒ 回退成等宽衬线感） | 统一为 `--font-family-ui-display` + `tabular-nums` |
| 4 | **两套绿色** | 时间线圆点写死 `#22c55e`；本页其它成功态用 `--color-success`(#34d399) | 本页时间线圆点改用 `--color-success` / `--color-danger`（**只在本页覆盖**，不动全局，避免波及其它页面基线） |
| 5 | **平台卡指标区无样式** | `.card-stats` / `.stat-item` / `.stat-num` / `.stat-lbl` **全仓没有任何定义** ⇒ 四个指标渲染成无样式的裸文本逐行堆叠 | 新样式类 `.dash-platform-metrics` / `.dash-platform-metric(-label/-value)`：四列等宽、标签在上数值在下、等宽数字 |
| 6 | **徽章底色写死品牌紫** | `rgba(124, 92, 191, .12)`（另一条紫、不随主题切换） | `color-mix(in srgb, var(--primary) 12%, transparent)`（随主题、同一色相） |

**面板标题层级说明**（保留两级，不强行拉平）：
- **分区标题**（各平台数据 / 内容基准比较）＝ `.cohere-section-title`（全局）
- **面板标题**（发布统计 / 最近发布 / 账号状态 / 发布队列 / 作品互动回流 / 题材表现榜）＝ `.dash-panel-title`（全局）

两者都用同一套 26px 图标底座 + 品牌渐变，区别只在字重层级（分区标题更大、间距更宽），这是 ADR-002 定的层级，不属于「不统一」。

### 3.3 T3 · 数据真实性

#### 3.3.1 数据源替换

| 显示项 | 改前 | 改后（数据源 + 口径） |
|--------|------|------------------------|
| 已发布内容 | `Σ sync:cached[].articles`（**恒 0**） | `dashboard:stats.total`（发布记录累计） |
| 作品阅读 | `Σ sync:cached[].views`（**恒 0**） | `performance:overview.totals.views`（**作品级**：发布后自动回采，每篇取最近一次采集） |
| 作品评论 | `Σ sync:cached[].comments`（**恒 0**） | `performance:overview.totals.comments`（作品级） |
| 账号粉丝 | `Σ sync:cached[].followers`（**恒 0**） | 可信 `sync:cached` 记录汇总（**账号级**）；当前无可信记录 ⇒ 「—」 |
| 各平台 · 作品 | 未展示 | `dashboard:stats.perPlatform[p].total`（发布记录累计） |
| 各平台 · 阅读/点赞/评论 | `sync:cached`（**恒 0**） | `performance:overview.byPlatform[p]`（作品级回采） |
| 各平台 · 粉丝 | `sync:cached`（**恒 0**） | 可信 `sync:cached` 记录（账号级） |
| 各平台 · 更新时间 | `sync:cached[].syncedAt`（**占位记录的写入时间**，等于「刚刚造了一遍 0」） | `performance:overview.health.lastCapturedAt`（**真实回采时间**） |

#### 3.3.2 「可信记录」判据（单一实现）

`sync:cached` 的记录只有同时满足下列两条才允许贡献数字：

```
可信 ⇔ record 没有 error 字段  且  record 没有 _note 字段
```

- `_note` 是**遗留占位标记**（旧实现写的 `_note: 'RPA 不可用'`）：老版本缓存里的那批恒 0 记录会被这条判据挡掉 ⇒ **升级后不用等缓存过期，页面立刻不再显示假 0**。
- `error` 是改后 `data-sync.js` 的失败记录（带 `error` ⇒ 不可信）。
- 该判据只在 `features/dashboard/dashboard-panels-model.js` 的 `trustedSyncRows()` 一处实现，KPI 行与平台卡片共用 ⇒ 不会出现两处口径分裂。

#### 3.3.3 「取不到真值」的统一表达

| 情况 | 界面表现 | 理由 |
|------|---------|------|
| 指标取不到（无来源 / 来源失败 / 平台不支持） | 显示「—」 | 「没有数据」与「真的是 0」是两件事 |
| 指标真的是 0 | 显示 `0` | 真实值照常显示 |
| 整个区块没有平台 | 渲染 EmptyState + 「刷新数据」 | 合法空态，不是故障 |
| 平台有作品但没回采 | 卡片显示作品数 + 四个「—」+ 副标题「暂无回采数据」 | 平台不能消失（消失＝用户以为没发过） |

⚠️ **禁止** `item.views ?? '-'` 这类写法：`0` 会原样通过 `??`，假 0 仍然显示成数字（这正是旧实现的漏点）。

#### 3.3.4 `data-sync.js` 的 fail-loud 修正

`_rpaFetchStats()` 取不到真值时**抛错**（而不是返回一组 0），错误被 `_syncOne()` 转成 `{ platform, syncedAt, error }` ⇒ 该记录按 §3.3.2 不可信 ⇒ 界面不显示任何数字。

---

## 4. 数据契约（逐项：来源 / 口径 / 校验 / 失败处理）

| 数据 | 来源通道 | 口径 | 入参校验 | 失败/缺失表现 |
|------|---------|------|---------|---------------|
| 发布总数 / 成功率 / 分平台发布数 | `dashboard:stats` | 发布记录（当前登录主体） | 主进程 `resolveIpcOwnerSubject`：认不出身份 ⇒ `AUTH_ERROR`（**不是 0 条**） | 未登录 ⇒ 页面显示登录门禁条；取数失败 ⇒ 该区块不渲染，KPI 显示「—」 |
| 最近发布 | `history:list` | 发布记录前 5 条 | 同上 | 同上 |
| 作品互动总量 / 分平台互动 / 回采健康度 | `performance:overview` | 作品级：每篇取最近一次采集 | 主进程聚合；DB 故障翻成错误信封（不翻成「从未发布」） | 取不到 ⇒ KPI 显示「—」，平台卡对应指标显示「—」 |
| 账号级粉丝 | `sync:cached`（可信记录） | 账号级 | 记录须有 `platform`、无 `error`、无 `_note` | 无可信记录 ⇒ 「—」 |
| 账号状态 | `account:batchCheckLogin` | 正常 / 异常 / 未检测 三态 | 三态分开，**未检测不得默认成正常** | 空 ⇒ 「还没有授权账号」 |
| 发布队列 | `publish:queueStatus` + `publish:queueHistory` | 运行中 / 排队中 / 最近失败 | 两路都成功才算成功（半套数据比没有更难解释） | 任一门禁 ⇒ auth 态 |
| 题材表现榜 | `knowledge:patternPerformance` | 题材互动分 Top5 | 仅 `dashboard_full` 权益解锁 | 未解锁 ⇒ 锁区块占位，**不发请求** |

---

## 5. 流程与交互逻辑

### 5.1 首屏加载（并行，互不阻塞）

```
onMounted
  ├─ loadCached()        sync:cached        → 账号级候选（粉丝）
  ├─ loadStats()         dashboard:stats    → 发布口径（总数 / 分平台 / 日趋势）
  ├─ loadRecent()        history:list       → 最近发布
  ├─ loadPerfOverview()  performance:overview → 作品级口径（阅读 / 点赞 / 评论）
  ├─ loadNewPanels()     账号健康度 + 发布队列（三路并行，allSettled）
  └─ loadPatternBoard()  题材榜（仅权益解锁时发请求）
```

- 任何一路失败**不影响**其它区块渲染（`Promise.allSettled` 语义）。
- 权益（`dashboard_full`）到位时**只补取题材榜**，不重取账号/队列（避免同一批数据被取 3~5 次）。

### 5.2 「刷新数据」按钮

| 项 | 改前 | 改后 |
|----|------|------|
| 触发 | 只 `syncAll()`（那条链路恒 0） | 并行刷新三路真实数据 + 同步刷新「作品互动回流」面板 |
| `syncAll` 失败 | 弹「平台同步失败，请稍后重试」⇒ 每次点都报错 | 降级为尽力而为（`allSettled` 吞掉），**不再弹错误**；IPC 契约保留（E2E 依赖） |
| 反馈 | 同步中禁用按钮 | 不变 |

### 5.3 登录门禁

`dashboard:stats` / `history:list` 返回 `AUTH_REQUIRED` ⇒ 显示登录门禁条 + 「去登录」；登录成功后自动重载（不要求用户手动刷新）。

### 5.4 浮标交互（不变）

- 显隐：主滚动容器 `scrollTop > 320px` 才出现（唯一条件，无页面白名单）。
- 点击：平滑回顶（尊重系统「减少动态效果」），600ms 点击锁。
- 路由切换：强制隐藏。
- **本次新增**：数据页底部留出 84px 净空 ⇒ 滚到底时「分析」按钮完整可见可点。

---

## 6. 显示项与提示文字（逐项）

### 6.1 新增 / 修改的文案（zh / en 成对，`locales/dashboard/`）

| Key | zh | en | 显示条件 |
|-----|----|----|---------|
| `dashboard.kpiReadLabel` | 作品阅读 | Work views | 常显 |
| `dashboard.kpiCommentLabel` | 作品评论 | Work comments | 常显 |
| `dashboard.kpiFansLabel` | 账号粉丝 | Account followers | 常显 |
| `dashboard.kpiNote` | 作品阅读/评论为发布后回采口径（每篇取最近一次采集）；账号粉丝为平台账号级指标，当前版本未接入采集，故显示「—」而不是 0。 | Work views/comments come from post-publish recapture (latest snapshot per post); account followers are account-level platform metrics that this version does not collect yet, so it shows "—" instead of 0. | KPI 行下方常显 |
| `dashboard.platformsTitle` | 各平台数据 | Platform data | 常显 |
| `dashboard.platformsSubtitle` | 发布记录 + 作品回采 | Publish records + work recapture | 标题右侧 |
| `dashboard.platformsEmptyTitle` | 还没有平台数据 | No platform data yet | 无平台时 |
| `dashboard.platformsEmptyDesc` | 发布内容后，这里会按平台显示真实作品数与互动数据。 | After you publish, real per-platform post counts and engagement data will show up here. | 无平台时 |
| `dashboard.platformsRefresh` | 刷新数据 | Refresh data | 空态按钮 |
| `dashboard.platformMetricViews` | 阅读 | Views | 平台卡指标 |
| `dashboard.platformMetricLikes` | 点赞 | Likes | 平台卡指标 |
| `dashboard.platformMetricComments` | 评论 | Comments | 平台卡指标 |
| `dashboard.platformMetricFans` | 粉丝 | Followers | 平台卡指标 |
| `dashboard.platformMetaArticles` | 作品 {count} | {count} posts | 平台卡副标题 |
| `dashboard.platformMetaContents` | 已回采 {count} 篇 | {count} posts captured | 无发布数但有回采时 |
| `dashboard.platformMetaLastCapture` | 最近回采 {time} | last capture {time} | 有回采时间时 |
| `dashboard.platformMetaNoCapture` | 暂无回采数据 | No recapture data yet | 有发布数但无回采时 |
| `dashboard.platformMetaNone` | 暂无数据 | No data | 兜底 |

**删除**（旧口径已不成立，留着会误导）：`dashboard.totalViews` / `dashboard.totalComments` / `dashboard.totalFollowers`（原来分别叫「账号总阅读/总评论/总粉丝」，实际数据是作品级回采与账号级粉丝混在一行）。

### 6.2 平台卡显示项（4 指标 + 1 副标题）

```
┌────────────────────────────────────┐
│ [图标]  抖音                        │
│         作品 12 · 最近回采 10:51      │   ← 副标题：作品数（发布记录口径）+ 回采时间（真实）
│                                     │
│  阅读    点赞    评论    粉丝          │   ← 四列等宽，标签在上 / 数值在下
│  1.2万   340     56     —           │   ← 「—」= 没有这项数据（不是 0）
└────────────────────────────────────┘
```

### 6.3 提示文字纪律

- **口径写进标签或副标题**，不藏进 tooltip（口径是长期事实）。
- 任何「—」都必须有对应的原因说明（KPI 行说明 / 平台卡副标题 / 规范文档）。
- 不承诺尚未实现的能力（升级 CTA 仍只说「升级解锁」，见既有约定）。

---

## 7. 数据校验与不变量

### 7.1 转换层不变量（`dashboard-panels-model.js`）

| # | 不变量 | 断言位置 |
|---|--------|---------|
| I1 | 取不到的指标是 `null`，**绝不回落成 0** | `dashboard-panels-model.test.js` |
| I2 | 遗留占位记录（`_note`）不进入任何指标 | 同上 |
| I3 | 带 `error` 的记录不进入任何指标 | 同上 |
| I4 | 可信记录只贡献**账号级**指标（粉丝），不污染作品级口径 | 同上 |
| I5 | 只回采到部分平台时，未回采的平台仍出现（作品数 + 「—」） | 同上 |
| I6 | KPI「已发布内容」＝ `dashboard:stats.total`（与「累计发布」同源，不再自相矛盾） | 同上 + `Dashboard.test.js` |
| I7 | 账号粉丝只由可信记录汇总；一条都没有时为 `null` | 同上 |

### 7.2 源码层不变量（防回潮）

| # | 不变量 | 断言位置 |
|---|--------|---------|
| S1 | 数据页不得再出现 `?? '-'` 这类把 0 当「无数据」的写法 | `Dashboard.test.js` |
| S2 | 数据页不得再写死 `--lavender-*` / `--deep-purple` 的色值 | `Dashboard.test.js` |
| S3 | 数据页必须引用 `--mp-float-safe-bottom`（浮标安全区） | `Dashboard.test.js` |
| S4 | `data-sync.js` 取不到真值时必须抛错，**不得返回 0** | `packages/shared-utils/src/__tests__/data-sync.test.js` |
| S5 | 平台卡指标区必须有样式类（四列结构，不是裸文本） | `PlatformDataGrid.test.js` |
| S6 | 平台卡模板不得残留中文字面量（文案全走 locale） | `PlatformDataGrid.test.js` + `Dashboard.test.js` |

### 7.3 既有守卫（不得被本次改动破坏）

`Dashboard.style-guard.test.js` 的 13 条（token 必须在 `:global(:root)`、scoped 不得出现裸 `:root`、不得「opacity:0 + animation」同体、hero 卡渐变 token 必须已定义、网格算术、阴影/表面 token 必须有全局定义、登录门禁三类必须有样式、禁 emoji、hero 必须有装饰节点、不得回潮 TrialBanner、`DashboardExtraPanels` 必须在 `.cohere-content` 内、升级 CTA 必须走路由）—— 本次全部保持通过。

⚠️ 其中「token 必须在 `:global(:root)`」一条**故意保留**：本次把该处的值从字面量改成**指向全局 token 的别名**，既满足「scoped 里能生效」，又消灭了第二套紫。

---

## 8. 测试与门禁

| 层 | 文件 | 覆盖 |
|----|------|------|
| 纯函数 | `features/dashboard/dashboard-panels-model.test.js` | I1–I7 |
| 组件 | `features/dashboard/PlatformDataGrid.test.js` | S5、S6、真实 0 与「—」的区分、空态 |
| 页面 | `views/Dashboard.test.js` | KPI 取值、平台卡「—」、遗留占位记录被拒、S1–S3 |
| 主进程 | `packages/shared-utils/src/__tests__/data-sync.test.js` | S4（fail-loud + 不产生 0 值记录） |

**CI 门禁**：`QG Unit Tests` / `QG Coverage` / `QG Static` / `债务熔断检查` / `文档同步检查` / `GUI Gate Result` / `Gate Result` 全部必须绿。

**像素基线**：数据页外观有变更 ⇒ `dashboard.png` / `dashboard-dark.png` 必须用**CI 同一次渲染**刷新（`scripts/check-baseline-freshness.js` 的 0px 判据：仓库里的基线必须与 CI 渲染逐像素相等）。⚠️ 本机截图不得入库（仓库既有纪律：QM-4 第 7 条）。

---

## 9. 遗留与后续切片

| # | 切片 | 内容 | 优先级 |
|---|------|------|--------|
| P2-1 | 平台账号级数据采集 | 为 5 个平台实现创作者后台解析（`data-sync.js` 的 `_sync_*` 脚本已给出入口与 DOM 选择器雏形），并把 RPA 通道接到主进程可达的位置 | P2 |
| P2-2 | 账号粉丝数 | 为「账号粉丝」接入 `analytics:overview`（已有小红书/抖音 provider），**前提**是给该通道加频控与缓存（当前每次调用直连平台） | P2 |
| P2-3 | 平台卡展示项扩展 | 「点赞」之外的收藏/转发是否单独展示，取决于回采覆盖度 | P3 |
| P3-1 | 全站浮标安全区 | 把 `--mp-float-safe-bottom` 推广到所有带右下角操作的页面（本次只做数据页） | P3 |

---

## 10. 验收标准

| # | 验收点 | 判定方式 |
|---|--------|---------|
| A1 | 数据页滚到底，右下角「分析」按钮**完整可见可点** | 人工 + `--mp-float-safe-bottom` 生效 |
| A2 | 页面上不再出现写死的第二套紫 / 两种数字字形 / 两种绿色 | 源码锁 S1–S2 + 视觉复核 |
| A3 | 平台卡四个指标是四列结构、有标签有数值 | `PlatformDataGrid.test.js` |
| A4 | 「已发布内容」＝「累计发布」（不再一个 0 一个 42） | `Dashboard.test.js` |
| A5 | 任何取不到的数字显示「—」，且有原因说明 | I1 + 页面复核 |
| A6 | 升级后（缓存里仍有旧的恒 0 记录）页面**立刻**不显示假 0 | `_note` 判据 + 人工复现 |
| A7 | 点「刷新数据」不再弹「平台同步失败」，且真实数字会变 | 人工 |
| A8 | CI 全绿（含 Gate 7b 基线新鲜度） | `gh pr checks` |

---

## 11. 变更历史

| 日期 | 变更 |
|------|------|
| 2026-10-25 | 首版：T1 浮标安全区 / T2 视觉统一 / T3 数据真实性 |
