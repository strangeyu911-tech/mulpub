---
change: ui-consistency-polish
status: in-progress
created: 2026-10-26
branch: ui-consistency-polish
---

# ui-consistency-polish — 五页视觉统一与播客命名修正

## Why

用户明确指出五个页面「视觉不统一、混乱、粗糙、不精致」：草稿页、博主监控页、文案库、知识库、播客 RSS 频道。巡检确认这不是五个独立问题，而是同一组系统性缺口：

1. **页面骨架缺失**：草稿页是脱离 `cohere-page` 的独立 `<section>`；博主监控是采集页唯一没有 `.cohere-content` 包裹的 tab；其余三页各自写页头 padding。
2. **表面层级缺失**：白底 + 1px 灰边，页面/面板/行三级分不开。
3. **控件各写一套**：4px~10px 圆角并存；按钮从文字链接到实心块；输入框 28~34px。
4. **状态表达粗糙**：加载一行字、空态一句话、错误裸红字。
5. **知识库页头被 scoped 样式覆盖**：`--coral` 红色主按钮与全站品牌紫冲突。
6. **播客命名与菜单语义不一致**：左侧菜单「播客 RSS 频道」过长；页面标题与菜单同名。

本变更把上述收敛为一套**页面骨架层**（`page-scaffold.css`）+ 五个页面接入 + 播客菜单/标题改名，不触碰业务逻辑、数据与 IPC。

## What Changes

- **新增** `apps/desktop/src/styles/page-scaffold.css`：页面骨架、面板、列表行、按钮、分段控件、搜索、表单字段、徽标、提示条、表格的稳定类名契约（全部 `mp-` 前缀，token-only）。
- **新增** `apps/desktop/src/views/PublishDraftsPage.vue`：把草稿页从 `Publish.vue` 抽出（同时满足 `Publish.vue` 的 1775 行门禁），使用新骨架。
- **改造** `Publish.vue`：草稿 tab 改为渲染 `PublishDraftsPage`，删除草稿专用 scoped 样式；主发布表单不动。
- **改造** `Collection.vue`：博主监控 tab 包进 `.cohere-content`（补上唯一缺失的内容留白）。
- **改造** `features/collection/CreatorMonitor.vue`：面板 / 行 / 徽标 / 提示条 / 空态接入新骨架；IPC 调用与错误分支不动。
- **改造** `views/CopyLibraryView.vue`：页头、筛选分段、搜索、卡片网格、空态接入新骨架。
- **改造** `views/KnowledgeBasePage.vue`：移除 scoped 页头/按钮覆盖；页签改分段控件；表格接入 `.mp-table`；积压提示改 `mp-notice`。
- **改造** `views/PodcastChannelView.vue` + `components/PodcastHostingCard.vue`：页头、面板、表单字段、按钮、结果块、分发卡片接入新骨架。
- **改名**：`route-registry.js` 的 podcast `labelI18nKey` 改为新增的 `sidebar.nav.podcast`（中文「播客」/英文「Podcast」）；`podcast.pageTitle` 改为「播客 RSS」/「Podcast RSS」。
- **测试**：新增 `page-scaffold.contract.test.js`、`PublishDraftsPage.test.js`；扩展现有五页测试与 `sidebar-menu.test.js`。
- **文档**：`01-docs/PRD-UI-CONSISTENCY-2026-10-26.md`、`01-docs/DESIGN-PAGE-SCAFFOLD-2026-10-26.md`、`01-docs/DESIGN.md` 与主 PRD 附录同步；执行记录 `openspec/records/ui-consistency-polish.md`。

## Impact

- Affected specs：`openspec/changes/ui-consistency-polish/spec.md`（新增 capability `ui-consistency`）
- Affected code：
  - 新增：`apps/desktop/src/styles/page-scaffold.css`、`apps/desktop/src/views/PublishDraftsPage.vue`
  - 修改：`apps/desktop/src/main.js`、`apps/desktop/src/views/{Publish.vue,Collection.vue,CopyLibraryView.vue,KnowledgeBasePage.vue,PodcastChannelView.vue}`、`apps/desktop/src/features/collection/CreatorMonitor.vue`、`apps/desktop/src/components/{PodcastHostingCard.vue,EmptyState.vue}`、`apps/desktop/src/config/route-registry.js`、`apps/desktop/src/locales/sidebar/{zh,en}.js`、`apps/desktop/src/locales/podcast/{zh,en}.js`、`apps/desktop/src/locales/copy-library/{zh,en}.js`、`apps/desktop/src/locales/publish-page/{zh,en}.js`
- 不改：IPC、主进程、数据库、业务校验、发布/采集/改写/知识库/播客的流程逻辑
- 兼容性：无数据迁移；纯渲染层；可单提交 revert
