# PRD：账号粉丝数真实化 —— 创作者后台采集通道落地（dash-account-followers）

> 分支 `dashboard-fan-followers` | 创建 2026-10-25 | 状态：实现中
> 基线：`main` @ `97902ba`（含 PR #4435「数据页真实数据 + 视觉统一 + 浮标安全区」）
> 本 PRD 是 `01-docs/PRD-DASHBOARD-TRUTHFUL-UI-2026-10-25.md` §9 切片 P2-1 / P2-2 的**修正版**

---

## 〇、本 PRD 对原计划的修正（先说清楚：它改变了范围）

上一轮遗留的 PRD §9 记了两个切片，本轮**取证后把其中一个撤回、把另一个收窄**：

| 原切片 | 原设想 | 取证结论 | 处置 |
| --- | --- | --- | --- |
| **P2-2** | 接 `analytics:overview` + 给它加节流/缓存 | ❌ **与仓内定案冲突** | **撤回** |
| **P2-1** | 为 5 个平台实现创作者后台解析、接通主进程可达的 RPA 通道 | ⚠️ **解析器早就存在**，缺的是「通道没接上」 | **范围收窄** |

**撤回 P2-2 的依据（两条仓内定案，互相印证）**：

1. `01-docs/PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md` §七.1 明确写：
   > **不接 `analytics:overview`**：`src/api/` 无封装，且它走外部平台 API 带凭证，与 `sync:cached` 同源不同路，接进来会引入第二套口径冲突。

2. `01-docs/PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md:38` 明确写「总粉丝」的真实取数路径：
   > 「总阅读 / 总评论 / **总粉丝**」 → `platformData` 的 `views/comments/**followers**`（**账号级创作者中心同步，TTL 缓存**）

⇒ **真源指向 `sync:cached`（`platformData.followers`），不是 `analytics:overview`。**
⇒ 原 P2-2「给 `analytics:overview` 加节流/缓存」是在给一条**被定案判为不该接的通道**做治理，方向错了。

**收窄 P2-1 的依据**：`packages/shared-utils/src/data-sync.js:241-301` 里 **5 个平台的抽取脚本早已存在**，
每个都产出 `followers` 字段 ⇒ 要做的不是「实现解析器」，而是「**让采集通道在主进程真的能跑**」。

---

## 一、背景与问题

### 1.1 现象

数据页 5 张平台卡的「账号粉丝」位显示「—」（PR #4435 的诚实化处理：取不到就显示「—」，不显示假 0）。

### 1.2 取证（三层，逐层可复验）

| 层 | 事实 | 位置 |
| --- | --- | --- |
| ① 字段存在 | 5 个平台的抽取脚本**都产出 `followers`** | `packages/shared-utils/src/data-sync.js:248 / 262 / 275 / 286 / 298` |
| ② 通道不存在 | `rpaFetchData` / `rpa:fetchData` **全仓只出现在注释里**（preload 无暴露、`ipcMain` 无 handler） | 全仓 grep：`apps/desktop/` 内仅 3 处注释命中（`dashboard-panels-model.js:149`、`PlatformDataGrid.vue:63`、`data-sync.js:231`） |
| ③ 进程错配 | `DataSyncService` 注册在**主进程**（`container.setup.js:349` → `new DataSyncService(c.get("store"))`），而两条旧通路用 `window.electronAPI` / `ipcRenderer` ⇒ 主进程必然落空 | `apps/desktop/electron/core/container.setup.js:349` |

⇒ **结论：粉丝数不是「没有数据源」，是「有源、有解析器、但没有能跑起来的采集通道」。**
⇒ PR #4435 把这条链路改成 fail-loud（抛错 ⇒ 显示「—」）是**正确的**，但它只治了「假 0」，没治「通道缺失」。

### 1.3 三个尚未被处理的隐患（本 PRD 必须一并解决，否则新通道会把旧病带回来）

| 隐患 | 事实 | 后果 |
| --- | --- | --- |
| **A. 假 0 复发** | 抽取脚本内 `parseInt(... \|\| '0')` 兜底。面板元素存在但字段改名 ⇒ 返回 `0` 而非 `null` | **PR #4435 刚消灭的「假 0」会从新通道复活**（界面上又变成「0 粉丝 · 更新于 10:51」） |
| **B. 选择器未验证** | 5 段脚本**无任何出处/日期注释**；`rpa-view-platforms.js` 内 `fans` **零命中**；`01-docs/evidence/rpa-dom-2026-09-23/` 只覆盖 `kuaishou` / `douyin` / `bilibili`，**不含 `xiaohongshu` / `tencent_video` / `wechat_mp`** | 通道接通后可能**取不到数**（返回 null ⇒ 抛错 ⇒ 仍显示「—」），即「接通了但功能仍不可用」 |
| **C. 触发频率** | 创作者后台直连有平台风控（`PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md` 记「不能太频繁查询以防被封」） | 采集过于频繁 ⇒ 账号被限/封 ⇒ 比「显示 —」更严重 |

---

## 二、目标与非目标

### 目标

1. **主进程可达的「创作者后台采集」通道** —— 复用仓内已有的 RPA 窗口池 + 登录态注入能力，不新造轮子。
2. **抽取脚本 fail-loud** —— 缺字段 ⇒ 抛错，**绝不返回 0**（隐患 A）。
3. **节流** —— TTL 缓存已有（1 小时）＋ 同平台最小采集间隔（隐患 C）。
4. **账号粉丝数上屏** —— `PlatformDataGrid.vue` 读 `platformData.followers`，取不到显示「—」。
5. **契约测试** —— 用 `01-docs/evidence/rpa-dom-2026-09-23/` 的真实 DOM JSON 做夹具，并做**变异验证**。

### 非目标（明确不做）

| 不做 | 理由 |
| --- | --- |
| 不改 `apps/desktop/electron/services/rpa-view-platforms.js` | 门禁 `targets` = **1499，容差 0**（点名还账）⇒ **一行都不能加** |
| 不接 `analytics:overview` | 仓内定案（§〇） |
| 不做账号级粉丝趋势 | `data-sync` 无时间序列，需先加历史留存层；`PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md:56 / 289` 已定案不做 |
| 不新增 preload API | 采集在**主进程内闭环**，不经渲染层 ⇒ 不扩大暴露面（`preload` 暴露面改动会连带三处契约测试，见 agent 记忆） |
| 不改 `dashboard:stats` / `performance:overview` 两条已通的通路 | 本切片只补第三条（账号级） |

---

## 三、架构

### 3.1 数据流（新增部分用 ▸ 标注）

```
渲染层
  Dashboard.vue → PlatformDataGrid.vue
                    │ 读 sync:cached（既有 IPC）
                    ▼
主进程
  DataSyncService (container 'dataSync', container.setup.js:349)
    │  ▸ _rpaFetchStats(platform, url, script)  ← 改为走注入的 deps
    ▼
  ▸ RpaViewManager.collect(platform, accountId, { url, script })
    │  ▸ 复用 rpa-view-session.js：_acquireWindow(platform, accountId)  ← 窗口池
    │     + 账号 cookie / localStorage 注入（既有 _createWindow 能力）
    ▼
  ▸ webContents.executeJavaScript(extractScript)  ← 既有执行机制
    ▼
  ▸ 返回值校验（缺字段 ⇒ 抛错）⇒ 写缓存（syncedAt = 采集完成时刻）
```

### 3.2 落点（**新增文件优先**，避免碰大文件）

| 文件 | 动作 | 当前行数 | 门禁状态 | 理由 |
| --- | --- | --- | --- | --- |
| `apps/desktop/electron/services/rpa-view-collector.js` | **新增** | 0 | 未登记 | 采集通道独立成文件；**不碰** `rpa-view-platforms.js`（容差 0） |
| `apps/desktop/electron/services/rpa-view-manager.js` | 改（加 `collect` 入口） | 304 | 未登记 | 沿用现有 mixin 模式（`Object.assign` 注入 prototype）⇒ 改动面小 |
| `packages/shared-utils/src/data-sync.js` | 改（`_rpaFetchStats` + 构造器注入 deps） | 305 | 未登记 | 跨包共享包 ⇒ **只能注入，不能 require desktop 的 electron 服务** |
| `apps/desktop/electron/core/container.setup.js` | 改 1 行（注册时传 deps） | 493 | 未登记 | DI 容器既有写法 |
| `apps/desktop/src/features/dashboard/PlatformDataGrid.vue` | 改（读 `followers`） | 224 | 未登记 | 粉丝展示位的唯一落点 |
| `apps/desktop/src/views/Dashboard.vue` | **不改** | 986 / 上限 **996** | 挂账 796 + 容差 200 | **余量仅 10 行** |
| `apps/desktop/src/styles/tokens.css` | **不改** | 498 / 上限 **500** | `>=500` 即红 | **余量仅 2 行** |

> ⚠️ 行数读数口径：门禁脚本用 `split('\n').length`（= 行数 + 1），上表为 `wc -l` 读数；动手前需按门禁口径重算余量。

### 3.3 跨包边界（关键约束）

`packages/shared-utils` 是**跨包共享包**，仓内有跨包边界门禁。
⇒ `data-sync.js` **不得** `require('@multi-publish/desktop/...')`。
⇒ 正解：**依赖注入** —— `DataSyncService` 构造器第二参接受 `{ rpaViewManager }`，
由主进程 `container.setup.js:349` 注入。仓内既有先例：`stage-executor.js:834` 用 `container.get('rpaViewManager')` 取同一服务。

---

## 四、数据校验（核心判据，全部可机械断言）

| # | 校验项 | 判据 | 失败处置 |
| --- | --- | --- | --- |
| 1 | 字段存在性 | 抽取脚本命中不到元素 ⇒ 抛 `COLLECT_FIELD_MISSING` | 抛错 ⇒ 写 error 记录 ⇒ 界面「—」+ 原因 |
| 2 | 数值合法性 | `followers` 必须是**有限非负数**（`Number.isFinite` && `>= 0`） | 抛 `COLLECT_VALUE_INVALID` |
| 3 | 平台归属 | 返回必须带 `platform`，且与请求平台一致 | 抛 `COLLECT_PLATFORM_MISMATCH` |
| 4 | 时效 | `syncedAt` = **采集完成时刻**（不是请求发起时刻） | 写入前断言 |
| 5 | 账号归属 | 采集必须绑定 `accountId`（登录态是账号级的）；**无已登录账号 ⇒ 跳过该平台**，不取默认账号凑数 | 该平台记 `skipped: no-account` |
| 6 | 缓存可信 | 渲染端「可信 = 无 `error` 字段 **且** 无遗留 `_note`」（沿用 `trustedSyncRows`） | 不显示任何数字 |
| 7 | 节流生效 | 同平台距上次采集 < 最小间隔 ⇒ **零请求** | 断言「网络层零调用」 |

> 判据 1 与 2 是「假 0」的两个入口：① 元素不存在、② 元素存在但值不可解析。**两者都必须抛错。**
> ⚠️ `parseInt(x || '0')` 这类写法会把「值缺失」折成 0 ⇒ **抽取脚本必须逐字段改写为「缺则抛」**。

---

## 五、流程

### 5.1 采集流程

```
sync(platform)
  ├─ 查同平台最近采集时刻
  │    └─ 距上次 < 最小间隔 ⇒ 返回缓存（零请求）
  ├─ 取该平台**已登录**账号（多账号时取哪一个？见 §六）
  │    └─ 无 ⇒ 记 skipped(no-account)，不请求
  ├─ rpaViewManager.collect(platform, accountId, { url, script })
  │    ├─ 窗口池取窗口（按 platform+accountId 复用）
  │    ├─ 注入该账号登录态（cookie / localStorage）
  │    ├─ loadURL(url) → 等待就绪（既有等待工具）
  │    ├─ executeJavaScript(script)
  │    └─ 校验返回值（§四 判据 1-3）⇒ 失败抛错
  ├─ 成功 ⇒ 写缓存（syncedAt = 采集完成时刻，字段来自脚本，**无兜底 0**）
  └─ 失败 ⇒ 写 error 记录（**不写任何数值**）⇒ 渲染显示「—」+ 原因
```

### 5.2 节流（三层，各自独立判据）

| 层 | 值 | 现状 | 依据 |
| --- | --- | --- | --- |
| TTL 缓存 | 1 小时 | ✅ 已有（`data-sync.js:13` `TTL_DEFAULT`） | 既有常量 |
| 同平台最小采集间隔 | **建议 30 分钟**（待拍板） | ❌ 无 | 平台风控（`PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md` 记「不能太频繁查询」） |
| 全局采集并发 | **1**（串行） | ❌ 无 | 影视工程已实测「串行 provider 上并发 2 ⇒ 第二个必然排队 ⇒ 必然超时」（见 agent 记忆）⇒ 采集同理 |

> ⚠️ 「30 分钟」是**建议值，非实测值** —— 平台风控的真实阈值没有公开数据。
> 落地时按**建议值起步 + 可配置**（配置项写进仓内既有 settings 机制），并在 UI 上标「数据截至 {time}」让用户自己判断新鲜度。

---

## 六、功能逻辑（平台差异与选择器现状）

| 平台 | url | 现有选择器（`data-sync.js`） | 实机 evidence | 风险 |
| --- | --- | --- | --- | --- |
| `douyin` | `creator.douyin.com` | `.creator-data-panel` → `[data-key=total_play]` / `[data-key=fans]`（:247-248） | ✅ `d5-douyin.json`（2026-09-23） | 中 |
| `bilibili` | `member.bilibili.com/platform/home` | `nums[1]` + fans 类名（:262） | ✅ `d5-bilibili.json` | 中 |
| `xiaohongshu` | `creator.xiaohongshu.com` | `[class*=fans]`（:275） | ❌ 无（但另有 10-09 的 DOM 加固 PRD） | **高** |
| `tencent_video` | `channels.weixin.qq.com` | `[data-role=fans]`（:286） | ❌ 无 | **高** |
| `wechat_mp` | `mp.weixin.qq.com` | `#totalFans`（:298） | ❌ 无 | **高** |

**多账号时的账号选择**：5 个平台的创作者后台都是**账号级登录态** ⇒ 一平台多账号时只能采一个。
⇒ 本 PRD 定：**取该平台「最近成功登录/最近使用」的账号**，并在采集记录里写明 `accountId` 供 UI 标注。
（若仓内已有「默认账号」约定 `store.getDefaultAccount`，需与该约定一致 —— 落地时核对，不另发明。）

---

## 七、交互逻辑与显示项

沿用 PR #4435 的三态纪律（`loading` / `ready` / `empty` / `error`），**不新造第四态**。

| 态 | 粉丝位显示 | 副标题 / 提示 |
| --- | --- | --- |
| `loading` | 「—」 | 沿用既有加载表现 |
| `ready` 且有值 | 数字（`tabular-nums`） | 平台卡副标题追加「账号级 · 数据截至 {syncedAt}」 |
| `ready` 但无该平台记录 | 「—」 | 「尚未采集粉丝数据」 |
| `error` | 「—」 | 「粉丝数据暂时无法获取（{原因}）」——**不给 0** |

**显示项清单（平台卡四列）**：阅读 / 点赞 / 评论 / **粉丝**（账号级）
- ⚠️ 口径纪律：阅读/点赞/评论是**作品级**（`performance:overview` 回采），粉丝是**账号级**（创作者中心）
  ⇒ **同卡片混放两个口径** ⇒ 副标题必须分别标注（这正是 `PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md` §289 记的「账号级与作品级混在同一行的四个指标位里」）
  ⇒ 本次落地时，平台卡的账号级粉丝位**单独标注口径**，不让用户误读。

**提示文字（zh / en 成对，落在 `apps/desktop/src/locales/dashboard/{zh,en}.js`）**：

| key | zh | en |
| --- | --- | --- |
| `followersPending` | 尚未采集粉丝数据 | Follower data not collected yet |
| `followersUnavailable` | 粉丝数据暂时无法获取 | Follower data unavailable |
| `followersUnavailableReason` | 粉丝数据暂时无法获取（{reason}） | Follower data unavailable ({reason}) |
| `followersAsOf` | 账号级 · 数据截至 {time} | Account-level · as of {time} |
| `followersScope` | 账号级 | Account-level |

> ⚠️ 门禁：`.github/scripts/check-locale-sync.js` 四道判据（`--pair-base` / `--keys` / `--cjk` / `--py-cjk`）⇒ zh/en 必须成对；新增中文文案必须进 CJK 基线（PR #4435 踩过：主干硬编码中文从未进过基线，动 `Dashboard.vue` 才暴露）。

---

## 八、验收标准

| # | 验收项 | 判据（可机械断言） |
| --- | --- | --- |
| 1 | 通道可达 | 主进程 `DataSyncService` 能拿到 `rpaViewManager`；单测断言 deps 注入生效 |
| 2 | **假 0 不再出现** | 抽取脚本命中不到元素 ⇒ 抛 `COLLECT_FIELD_MISSING`；断言**不产生任何数值字段** |
| 3 | **值不可解析也抛错** | 元素存在但 `textContent` 非数 ⇒ 抛 `COLLECT_VALUE_INVALID` |
| 4 | 无账号不请求 | 该平台无已登录账号 ⇒ 零请求、记 `skipped(no-account)` |
| 5 | 节流生效 | 同平台距上次采集 < 最小间隔 ⇒ 零请求（断言网络层零调用） |
| 6 | 并发恒为 1 | 同一时刻至多 1 个采集在途 |
| 7 | 错误不落数值 | 采集失败 ⇒ 缓存记录里**无** `followers`/`views` 字段，只有 `error` |
| 8 | 渲染三态 | 有值 ⇒ 数字；无记录 ⇒ 「—」+ `followersPending`；失败 ⇒ 「—」+ `followersUnavailable` |
| 9 | 口径标注 | 平台卡粉丝位带账号级标注（`followersScope`），不与作品级指标混读 |
| 10 | 契约测试有牙齿 | 用 evidence JSON 做夹具；**变异验证**：把 fail-loud 改回 `|| '0'` ⇒ 锁必须红 |
| 11 | 跨包边界 | `packages/shared-utils` 内**零** require desktop 的 electron 模块（跨包边界门禁） |
| 12 | 行数零回退 | `Dashboard.vue` / `tokens.css` 行数**不变**；`rpa-view-platforms.js` 零改动 |
| 13 | 像素基线 | 若 UI 有改动 ⇒ 基线由 **CI 产物**收割（本机截图不入库） |
| 14 | locale 成对 | `check-locale-sync` 四道全绿 |
| 15 | 编码无损 | 改动文件 `grep -c $'\xef\xbf\xbd'` = 0 |

---

## 九、待拍板（**唯一需要人决定的一格**）

**D1：3/5 平台无实机 evidence（`xiaohongshu` / `tencent_video` / `wechat_mp`）⇒ 怎么办？**

| 选项 | 做法 | 后果 | Completeness |
| --- | --- | --- | --- |
| **A（推荐）** | 通道 + fail-loud + 节流 + 契约测试**全部做完**；**选择器标定作为独立后续步骤**（需真机登录态，沙箱做不了）；UI 在标定完成前**继续显示「—」** | 通道与治理全部就位；粉丝数要等标定后才出现 | 8/10 |
| B | 先只做通道，**选择器照抄现有 5 段脚本**直接上 | 可能取不到数（→ 仍显示「—」），但**代码路径完整** | 6/10 |
| C | 只接 evidence 覆盖的 2 个平台（`douyin` / `bilibili`），其余继续「—」 | 更快见到真数字；但覆盖面小 | 7/10 |
| D | 等真机标定后再开工 | 什么也不做 | 3/10 |

> 我的建议：**A**。理由 —— 通道与治理（fail-loud / 节流 / 契约）**与选择器标定正交**，先把正交的部分做完，
> 标定作为独立步骤（需要真机登录态）⇒ 不被「拿不到登录态」卡住整条线。
> 而 B 的风险是「接通但取不到数」⇒ 用户看到的是「功能没做」，比明确显示「—」更糟。

**次要待定（可由我按默认推进，不阻塞）**：
- 最小采集间隔取值（建议 30 分钟，可配置）
- 采集并发（建议 1）
- 多账号时取哪个账号（倾向：仓内既有「默认账号」约定，落地时核对）

---

## 十、风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **选择器过期**（3/5 平台） | 通道通了但取不到数 | D1 选 A；选择器做成**可配置 + 契约测试可更新**；失败时显示原因而非 0 |
| **平台风控 / 封号** | 账号受损 ⇒ 严重后果 | 最小间隔 + 并发 1 + 可配置；**采集失败不得重试轰炸** |
| **账号 cookie 失效** | 采集落到登录页 ⇒ 取到 0 或 null | 失败时**识别登录页**并报「需重新登录」；绝不显示 0 |
| **门禁行数** | `Dashboard.vue` 余 10 行 / `tokens.css` 余 2 行 | UI 改动全部落在 `PlatformDataGrid.vue`（224 行，未登记） |
| **`rpa-view-platforms.js` 容差 0** | 任何改动直接让主干红 | 采集逻辑**独立成新文件**，一行不碰 |
| **像素基线** | UI 改动 ⇒ 必须 CI 产基线 | 单独 PR 刷基线（本机截图不入库） |
| **跨包边界** | `shared-utils` require desktop ⇒ 门禁红 | 依赖注入（§3.3） |

---

## 十一、切分（两个 PR）

| PR | 内容 | UI 改动 | 像素基线 |
| --- | --- | --- | --- |
| **PR-1** | 采集通道（新增 `rpa-view-collector.js`）+ `RpaViewManager.collect` + `DataSyncService` 注入 + fail-loud 抽取脚本 + 节流 + 契约测试（evidence 夹具 + 变异验证） | **无** | 不需要 |
| **PR-2** | 粉丝数上屏（`PlatformDataGrid.vue` 读 `followers`）+ locale zh/en + 三态显示 | 有 | **需要**（CI 产） |

**为什么这么切**：① 像素基线必须由 CI 产 ⇒ 单独一个 PR 刷最省；② PR-1 零 UI 改动 ⇒ 与在飞的 30 条 PR 冲突面最小；
③ PR-1 的验收（通道 + 治理）**不依赖真机标定** ⇒ 不被登录态卡住。

---

## 十二、相关文档

- 上游切片 PRD：`01-docs/PRD-DASHBOARD-TRUTHFUL-UI-2026-10-25.md`（§9 记录 P2-1/P2-2）
- 权益分级定案：`01-docs/PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md`（§七.1「不接 analytics:overview」）
- 指标口径定案：`01-docs/PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md`（:38 粉丝取 `platformData.followers`）
- QM6 评审结论：`01-docs/QM6-FINDINGS-METRICS-DASHBOARD-2026-10-04.md`（FF1 采纳：上方卡片是账号级 `sync:cached`）
- 上轮已合入：`01-docs/PRD-DASHBOARD-TRUTHFUL-UI-2026-10-25.md` / PR #4435
