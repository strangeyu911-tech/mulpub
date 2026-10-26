# Tasks — ui-consistency-polish

## 1. 设计系统层

- [x] 1.1 盘点五页现状与既有 token / `cohere-design-system.css` / `premium-design-system.css` 契约
- [x] 1.2 输出 PRD 与页面骨架设计规范
- [x] 1.3 新增 `apps/desktop/src/styles/page-scaffold.css`（页面/面板/行/按钮/表单/徽标/提示/表格）
- [x] 1.4 `main.js` 在 `premium-design-system.css` 之后导入
- [x] 1.5 升级 `EmptyState.vue` 视觉（图标底座 + 标题 + 说明 + CTA），API 不变

## 2. 草稿页

- [x] 2.1 新增 `views/PublishDraftsPage.vue`（props: drafts/loading；emits: open/delete/back）
- [x] 2.2 `Publish.vue` 改为渲染新组件，删除草稿专用 scoped 样式
- [x] 2.3 新增 `PublishDraftsPage.test.js`
- [x] 2.4 `Publish.test.js` 草稿相关用例保持通过

## 3. 博主监控

- [x] 3.1 `Collection.vue` creator tab 包进 `.cohere-content`
- [x] 3.2 `CreatorMonitor.vue` 面板/行/徽标/提示条/空态接入骨架
- [x] 3.3 扩展 `CreatorMonitor` 测试（面板类、空态 CTA、凭证提示）

## 4. 文案库

- [x] 4.1 页头 / 分段筛选 / 搜索 / 卡片网格接入骨架
- [x] 4.2 空态动作与筛选空态接入骨架
- [x] 4.3 扩展 `CopyLibraryView.test.js`

## 5. 知识库

- [x] 5.1 移除 scoped 页头/按钮覆盖；页签改 `mp-segmented`
- [x] 5.2 `ViralLibraryTable` 表格接入 `mp-table` / `mp-panel` / 分页按钮
- [x] 5.3 积压提示改 `mp-notice--warning`
- [x] 5.4 扩展知识库 UI 测试

## 6. 播客 RSS

- [x] 6.1 菜单文案 `sidebar.nav.podcast`（播客/Podcast），`podcast.pageTitle` 改「播客 RSS」
- [x] 6.2 `route-registry.js` podcast `labelI18nKey` 切到新 key
- [x] 6.3 `PodcastChannelView.vue` 页头 / 面板 / 字段 / 按钮 / 结果块接入骨架
- [x] 6.4 `PodcastHostingCard.vue` 接入面板与统一字段
- [x] 6.5 扩展 `PodcastChannelView.test.js`；更新 `sidebar-menu.test.js`

## 7. 验证与交付

- [x] 7.1 `page-scaffold.contract.test.js`（类名、导入顺序、无硬编码色、五页引用）
- [x] 7.2 运行五页相关单测与全量 `vitest run`（桌面）
- [x] 7.3 `lint` / `build:vue` / `check:max-lines`
- [x] 7.4 Vite + Playwright 截图五页（1440 / 2560），检查空态与暗色
- [x] 7.5 写 `openspec/records/ui-consistency-polish.md`（门禁证据 + CHANGELOG 条目 + learnings）
- [x] 7.6 推送分支、创建 PR、CI 通过后 squash 合并
