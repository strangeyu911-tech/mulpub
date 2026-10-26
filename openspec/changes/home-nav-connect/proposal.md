# Proposal: home-nav-connect

## Why

首页、发布页与发布记录页之间存在六处「信息在、动作不在」的断点：首页「添加账号」只跳页不弹层；发布页没有稳定的发布记录入口；发布记录页只能用下拉框筛状态；首页四张统计卡只是展示；快捷入口「私信评论」占用高价值位置却不匹配当前高频需求；近期动态不可点开作品。

这些断点属于同一类可用性缺陷：界面已经知道目标（路由、记录、链接），却没有把「下一步」做成单一可点击出口。用户被迫多点一次、回首页、或手动拼 URL。

## What Changes

- 新增 `apps/desktop/src/features/accounts/useAccountAddDeepLink.js`：消费 `/accounts?action=add-account`，打开添加账号浮层并清理参数。
- 新增 `apps/desktop/src/composables/usePublishHistoryStatusFilter.js`：状态筛选与 `?status=` 双向同步的单一实现（含非法值归一化）。
- 新增 `apps/desktop/src/features/publish/components/PublishHistoryEntry.vue`：发布页页头「发布记录」入口，避免继续膨胀 `Publish.vue`。
- `Home.vue`：添加账号深链；四张统计卡改为原生按钮并跳转对应路由；快捷入口「私信评论」→「视频创作」（`VideoCamera` 图标，`/create`）；近期动态复用 `usePublishHistoryContentLink` 打开作品链接。
- `Accounts.vue`：接线账号深链 composable（2 行）。
- `Publish.vue`：页头接线 `PublishHistoryEntry`（2 行，恰好落在零增长 target 内）。
- `PublishHistory.vue`：状态下拉框替换为「全部 / 发布成功 / 发布失败 / 处理中」快捷标签，支持 URL 深链与外部路由同步。
- locales `home/{zh,en}.js`、`publish-page/{zh,en}.js`、`history-page/{zh,en}.js` 成对新增文案。
- 新增/更新测试：Home、Accounts、Publish 接线、PublishHistory、两个 composable、入口组件、图标守卫登记。
- 新增 `01-docs/PRD-HOME-NAV-CONNECTIVITY-2026-10-26.md`，并更新 `01-docs/PRD.md` 与 `docs/desktop-ui-layout-spec.md`。

## Impact

- Affected specs: `desktop-ui-consistency`（ADDED：可点击入口必须落到真实路由/链接；状态筛选单一实现）
- Affected code: Home / Accounts / Publish / PublishHistory / 2 composables / 1 feature component / 3 locale pairs
- Affected tests: 7 个新增或修改的测试文件
- 风险：低。纯渲染层导航与筛选，无 IPC、无数据库、无历史数据格式变更。
- 行数门禁：`Publish.vue` 只有 2 行 headroom，本 change 用独立组件接线恰好 +2；`Accounts.vue` 用 composable 接线 +2；`PublishHistory.vue` 有 90 行余量。
