---
record: home-nav-connect
task: 首页导航连通性（添加账号深链、统计卡/近期动态链接、视频创作快捷入口）与发布记录页状态快捷标签
date: 2026-10-26
---

## 本次执行记录：首页导航连通性与发布记录快捷筛选（home-nav-connect，2026-10-26）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：隔离 worktree `<仓库父目录>/mp-worktrees/mp-home-nav-connect` + 裸分支 `home-nav-connect`（非 C 盘） |
| 第一性原因（QM-5 ①） | ✅ | 六个断点同源：界面已持有目标路由/记录链接，却只做到「信息展示」或「跳页」；`Home.vue:16` 原 `go('/accounts')`、`Home.vue:64-80` 统计卡为纯 `div`、`Publish.vue` 仅在定时发布结果卡有 `router.push('/publish/history')`、`PublishHistory.vue` 状态筛选只有下拉框、快捷入口第 6 项 `go('/comments')`、近期动态行无链接 |
| 逃逸分析（QM-5 ②） | ✅ | 既有 Home 测试只断言「添加账号按钮存在/跳 /accounts」，不检查落地后动作；发布记录页测试只断言 `status-filter` 下拉存在；近期动态测试只断言标题文本；没有「入口 → 目标视图 → 目标筛选/弹层」的端到端断言 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `useAccountAddDeepLink` / `usePublishHistoryStatusFilter` 单测、`PublishHistoryEntry` 组件测试、`Publish.history-entry-wiring` 接线锁；Home/Accounts/PublishHistory 既有测试补 7 组行为断言（按钮类型、路由对象、URL 同步、非法值回落、近期动态 `<a>`/`div`） |
| 防止再次发生（QM-5 ⑤） | ✅ | 入口类需求统一要求「目标路由 + 落地动作」同时有测试；状态筛选与链接解析各只有一份实现（composable 单一出口）；PRD §7 数据校验矩阵与 §9 测试矩阵落盘 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径逐文件一致；`PRD.md` 为 LF 基线（全文件 LF），`desktop-ui-layout-spec.md` 保持 CRLF 基线 |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → `OK: 全部测试均已接线或按欠账登记`（137 个测试文件） |
| QM-1 打包 / QM-4 视觉 | ✅ | QM-1 N/A（仅渲染层，未改 `apps/desktop/electron/` 或 `packages/rpa-engine/`）。QM-4：PR 的 `QG Visual`（run 40344775791 / job 121650554128）通过；6 张基线（`home-baseline{,-dark}.png`、`publish-form{,-dark}.png`、`publish-history{,-dark}.png`）从同一 run 的 `quality-gate-visual-reports` artifact 回填，回读 `Gate 7b` 0 px 通过 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录；已用现有契约测试与 lint/build 替代自检，不冒充外部评审 |
| 远程同步 | 由门禁推导 | 本行不改写；合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |

### 本地验证读数

- `pnpm exec vitest run`（Home 34 + Accounts 124 + PublishHistory 93 + 新增 27 + 相关回归合计 **526 passed / 1 skipped（527 用例）**，21 个测试文件）
- `pnpm exec eslint <全部变更文件> --quiet` → rc=0
- `pnpm run build:vue` → `✓ built in 20.22s`
- `node .github/scripts/check-locale-sync.js --symmetry` → PASS（pairs=61，drift=0）
- `node .github/scripts/check-locale-sync.js --cjk` → PASS（无新增硬编码）
- `node .github/scripts/check-locale-sync.js --pair-base origin/main` → PASS
- `node .github/scripts/check-max-lines.js` → PASS（`Publish.vue` 1775 / target 1775，`Accounts.vue` 1572 / target 1578，`Home.vue` 484 < 500）
- `node scripts/check-no-brand-residue.js` → PASS
- `node .github/scripts/check-frontend-consistency.js` → PASS
- `node scripts/check-doc-abs-paths.js --base=origin/main` → PASS
- `openspec validate home-nav-connect` → valid

### 遗留（不假装已闭合）

- 状态筛选仍为渲染层补页扫描（20 页上限），服务端筛选未在本 change 扩展。
- 「私信评论」页面与路由保留，仅首页快捷位替换为「视频创作」。
- `PublishHistoryEntry.vue` 新增 `/publish/history` 宿主后已同步登记 `route-registry-entry-hosts.test.js` 与 `route-registry.js` 注释（QG Desktop Shards 2/2 首轮红 → 修复后通过）。

## CHANGELOG 条目

# feat(home): 首页入口全部接到真实动作，发布记录页支持状态快捷标签（home-nav-connect）

- 首页「添加账号」现在跳转账号页并自动打开添加账号浮层，消费后清理 `action` 参数，刷新不会重复弹层。
- 首页总发布/成功/失败/已绑定账号四张统计卡改为原生按钮，分别进入对应发布记录筛选视图或账号页；键盘 Enter/Space 与点击同出口。
- 首页快捷入口「私信评论」替换为「视频创作」（`/create`，`VideoCamera` 线性图标），其余五个入口与 3×2 布局不变。
- 首页近期动态复用发布记录页的作品链接判据：有公开作品页的整行可点并在应用内新标签打开；草稿/无公开页/未抓到作品 ID 保持不可点并说明原因。
- 发布页页头新增稳定可见的「发布记录」入口（独立组件，避免 `Publish.vue` 行数增长）。
- 发布记录页状态筛选从下拉框收敛为「全部 / 发布成功 / 发布失败 / 处理中」四个快捷标签，支持 `?status=` 深链与 URL 同步，非法值回落「全部」。
- 新增 zh/en 成对文案：`home.videoCreation`、`home.statHint*`、`publishPage.publishHistory`、`historyPage.statusTabAll`。
