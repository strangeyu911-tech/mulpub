# Tasks: home-nav-connect

## 1. 规格与取证

- [x] 1.1 确认首页「添加账号」当前只 `router.push('/accounts')`，账号页 `showAddDialog` 无路由驱动
- [x] 1.2 确认发布页只有「定时发布结果卡」一个发布记录入口
- [x] 1.3 确认发布记录页状态下拉框使用 `statusFilter` + `normalizedStatusGroup`
- [x] 1.4 确认首页四张统计卡为纯展示 `div`，近期动态无链接
- [x] 1.5 确认 `Publish.vue` 行数 target=1775、当前 1773；`Accounts.vue` target=1578、当前 1570
- [x] 1.6 落 `01-docs/PRD-HOME-NAV-CONNECTIVITY-2026-10-26.md` 与 proposal/design/spec

## 2. 测试先行

- [x] 2.1 `usePublishHistoryStatusFilter.test.js`：归一化、初始 query、外部同步、replace、失败静默
- [x] 2.2 `useAccountAddDeepLink.test.js`：初始/后续 query、清理参数、非匹配不动作、replace 失败静默
- [x] 2.3 `PublishHistoryEntry.test.js`：文案、可访问名、点击路由
- [x] 2.4 `Home.test.js`：快捷入口文案/路由、统计卡按钮与路由、近期动态链接、键盘
- [x] 2.5 `Accounts.test.js`：`action=add-account` 自动弹层与参数清理
- [x] 2.6 `PublishHistory.test.js`：四状态标签、点击筛选、URL 同步、非法值回落
- [x] 2.7 `Publish.history-entry-wiring.test.js`：SFC 引入并渲染入口组件

## 3. 实现

- [x] 3.1 `usePublishHistoryStatusFilter.js` + 发布记录页接线与标签 UI
- [x] 3.2 `useAccountAddDeepLink.js` + 账号页接线
- [x] 3.3 `PublishHistoryEntry.vue` + 发布页接线
- [x] 3.4 Home 统计卡按钮化与路由
- [x] 3.5 Home 快捷入口「视频创作」与图标
- [x] 3.6 Home 近期动态复用作品链接 composable
- [x] 3.7 locales zh/en 成对新增 7 个键
- [x] 3.8 `home-navigation.css` + 图标守卫登记

## 4. 门禁与验证

- [x] 4.1 相关 Vitest 全绿（Home/Accounts/Publish/PublishHistory/composables/entry/locales）
- [x] 4.2 `eslint src --quiet` 通过
- [x] 4.3 `check-locale-sync` / `check-no-brand-residue` / `check-max-lines` 通过
- [x] 4.4 QM-1：仅渲染层变更，未改 `apps/desktop/electron/` 或 `packages/rpa-engine/` ⇒ N/A
- [x] 4.5 QM-4：PR 的 `QG Visual` 执行 + 同 run 产物回填基线并回读 0 px（run 40344775791）

## 5. 文档与收尾

- [x] 5.1 更新 `01-docs/PRD.md`、`docs/desktop-ui-layout-spec.md`、`docs/frontend-interaction-spec.md`
- [x] 5.2 写 `openspec/records/home-nav-connect.md`（含 CHANGELOG 条目）
- [x] 5.3 提交、推送、创建 PR（#4506）
- [ ] 5.4 CI 全绿后 squash 合并并删远端分支
- [ ] 5.5 写入内置记忆 / 外部记忆 / EverOS
