## Why

数据页 5 张平台卡的「账号粉丝」位显示「—」。上一轮（PR #4435）把这条链路从「显示假 0」改成「取不到就显示 —」，治住了**假数据**，但没治**取不到**。取证后发现粉丝数并不是「没有数据源」：

- **字段早就在**：`packages/shared-utils/src/data-sync.js` 里 5 个平台（`douyin` / `bilibili` / `xiaohongshu` / `tencent_video` / `wechat_mp`）的抽取脚本**都已经产出 `followers`**（:248 / :262 / :275 / :286 / :298）。
- **通道从没存在过**：全仓 grep `rpaFetchData` / `rpa:fetchData` 只命中 3 处**注释**——preload 没有任何暴露、`ipcMain` 没有任何 handler。
- **进程也是错的**：`DataSyncService` 注册在主进程（`apps/desktop/electron/core/container.setup.js:349` → `new DataSyncService(c.get("store"))`），而抽取脚本的旧通路用 `window.electronAPI` / `ipcRenderer` ⇒ 在主进程必然全部落空。

⇒ 真实缺口是「**采集通道没接上**」，不是「解析器没写」。仓内 RPA 能力其实齐备：`rpa-view-session.js` 提供窗口池（`_acquireWindow` / TTL 回收）与账号 cookie 注入，`rpa-view-manager.js` 已作为主进程 DI 服务注册（`container.setup.js:117`），`stage-executor.js:834` 已在用 `container.get('rpaViewManager')` 取它——**主进程完全可达，只差一个「采集」入口**。

同时必须一并处理三个隐患，否则新通道会把旧病带回来：

1. **假 0 复发**：抽取脚本内 `parseInt(... || '0')` 兜底。面板元素存在但字段改名 ⇒ 返回 `0` 而不是缺失 ⇒ 界面又变成「0 粉丝 · 更新于 10:51」——正是 PR #4435 刚消灭的形态。
2. **选择器未验证**：5 段脚本无任何出处/日期注释；`rpa-view-platforms.js` 内 `fans` 零命中；`01-docs/evidence/rpa-dom-2026-09-23/` 只覆盖 `kuaishou` / `douyin` / `bilibili`，**不含** `xiaohongshu` / `tencent_video` / `wechat_mp`。
3. **触发频率**：创作者后台直连有平台风控，采集过频可能影响账号。

### 口径依据（为什么不是 `analytics:overview`）

- `01-docs/PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md` §七.1 明确「**不接 `analytics:overview`**」（与 `sync:cached` 同源不同路，会引入第二套口径冲突）。
- `01-docs/PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md:38` 明确「总粉丝」取 `platformData` 的 `views/comments/followers`（**账号级创作者中心同步，TTL 缓存**）。
- `01-docs/QM6-FINDINGS-METRICS-DASHBOARD-2026-10-04.md` FF1（**采纳**）：上方卡片是**账号级 `sync:cached`**，面板是作品级 `performance_snapshot`。

⇒ 真源指向 `sync:cached` 的 `platformData.followers`；原 P2-2「给 `analytics:overview` 加节流/缓存」方向错误，本 change 不做。

## What Changes

- **新增采集通道**（主进程内闭环）：`apps/desktop/electron/services/rpa-view-collector.js` 新增，**复用** `rpa-view-session.js` 的窗口池与账号登录态注入，走既有 `webContents.executeJavaScript` 执行抽取脚本。
  **动因是硬约束**：`apps/desktop/electron/services/rpa-view-platforms.js` 在门禁 `targets` 清单里（target 1499、**容差 0**）⇒ **加一行就把主干打红、全仓 PR 被挡** ⇒ 采集逻辑独立成新文件，一行不碰它。
- **`RpaViewManager` 增加 `collect` 入口**：沿用仓内既有 mixin 模式（`Object.assign` 注入 prototype），与 `publish` / `cancel` / `cleanup` 并列。
- **`DataSyncService` 改为依赖注入**：`packages/shared-utils/src/data-sync.js` 的构造器接受第二参 `{ rpaViewManager }`，由 `container.setup.js:349` 注册时注入。
  ⚠️ `shared-utils` 是**跨包共享包** ⇒ **不得** require desktop 的 electron 模块（跨包边界门禁）⇒ 只能注入，不能自己找。
- **抽取脚本改 fail-loud**：逐字段「缺则抛错」，删掉全部 `|| '0'` 兜底；错误分型 `COLLECT_FIELD_MISSING` / `COLLECT_VALUE_INVALID` / `COLLECT_PLATFORM_MISMATCH`。
- **节流**：保留既有 TTL 缓存（1 小时）＋ 新增「同平台最小采集间隔」＋ 全局采集并发恒为 1。
- **账号归属**：采集必须绑定 `accountId`（登录态是账号级的）；该平台无已登录账号 ⇒ 记 `skipped(no-account)` 且**零请求**，不取默认账号凑数。
- **UI（第二个 PR）**：`apps/desktop/src/features/dashboard/PlatformDataGrid.vue` 读 `followers`；取不到显示「—」＋原因；粉丝位单独标注**账号级**口径。
  ⚠️ `Dashboard.vue` 余量仅 10 行（986/996）、`tokens.css` 余量仅 2 行（498/500）⇒ **两者一行不动**，UI 改动全部落在 `PlatformDataGrid.vue`（224 行，未登记）。

## Capabilities

### New Capabilities

- `dashboard-account-followers`: 账号级粉丝数据的采集与呈现契约——主进程可达的创作者后台采集通道、采集结果的 fail-loud 语义与错误分型、节流与并发上限、账号归属与账号级口径标注、渲染三态与提示文案。

## Impact

- **主进程**：
  - 新增 `apps/desktop/electron/services/rpa-view-collector.js`
  - 改 `apps/desktop/electron/services/rpa-view-manager.js`（加 `collect` 入口）
  - 改 `apps/desktop/electron/core/container.setup.js`（注册时注入 `rpaViewManager`）
- **跨包共享**：
  - 改 `packages/shared-utils/src/data-sync.js`（构造器注入 + `_rpaFetchStats` 改走注入的 deps + 抽取脚本 fail-loud + 节流）
- **渲染端**（第二个 PR）：
  - 改 `apps/desktop/src/features/dashboard/PlatformDataGrid.vue`
  - 改 `apps/desktop/src/locales/dashboard/{zh,en}.js`
  - 改 `apps/desktop/tests/visual-testing/base-screenshots/dashboard*.png`（**基线必须由 CI 产物收割**，本机截图不入库）
- **门禁影响**：
  - `rpa-view-platforms.js` **零改动**（target 容差 0）
  - `Dashboard.vue` / `tokens.css` **零改动**（余量 10 / 2 行）
  - `packages/shared-utils` 内**零** require desktop 的 electron 模块（跨包边界）
- **诚实边界**：
  - 3/5 平台**无实机 DOM 证据** ⇒ 通道与治理做完后，选择器仍需真机标定（沙箱无平台登录态）⇒ 标定完成前界面继续显示「—」。
  - 最小采集间隔取值 30 分钟为**建议值**（平台风控真实阈值无公开数据），落地为可配置。
