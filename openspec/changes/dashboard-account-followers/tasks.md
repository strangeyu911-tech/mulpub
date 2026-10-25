# Tasks — dashboard-account-followers

> 进度以本文件为唯一来源。每组任务 ≤ 一个会话。
> 范围依据：`01-docs/PRD-DASHBOARD-ACCOUNT-FOLLOWERS-2026-10-25.md`

## 0. 规格与文档（先文档再代码）

- [x] `openspec/changes/dashboard-account-followers/`：proposal / tasks / spec delta（`dashboard-account-followers`）
- [x] `01-docs/PRD-DASHBOARD-ACCOUNT-FOLLOWERS-2026-10-25.md`：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字
- [x] `openspec/records/dashboard-fan-followers.md`（执行记录，现行形态：`| 远程同步 | 由门禁推导 |`）
- [x] `openspec/records/dashboard-collector-runtime.md`（PR-1 第 2 刀执行记录：采集执行体 + 治理 + 抽取脚本 fail-loud）

## 1. 现状取证（已完成，作为实现前提）

- [x] 仓内定案检索：全树搜 `01-docs/` ⇒ 命中 `PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md` §七.1「不接 `analytics:overview`」与 `PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md:38`「粉丝取 `platformData.followers`」
- [x] 字段存在性：`packages/shared-utils/src/data-sync.js:248/262/275/286/298` 五处 `followers`
- [x] 通道不存在性：全仓 grep `rpaFetchData` / `rpa:fetchData` ⇒ 仅 3 处注释命中，preload 无暴露、`ipcMain` 无 handler
- [x] 进程错配：`apps/desktop/electron/core/container.setup.js:349`（主进程注册，仅注入 `store`）
- [x] 执行体存在性：`container.setup.js:117` 注册 `rpaViewManager`；`stage-executor.js:834` 已在用 `container.get('rpaViewManager')`
- [x] 门禁余量：`Dashboard.vue` 986/996（余 10）、`tokens.css` 498/500（余 2）、`rpa-view-platforms.js` target 1499（容差 0）
- [x] 在飞 PR 排查：30 条 open PR 无一条碰数据页/粉丝/analytics ⇒ 不撞车
- [x] 证据缺口：`01-docs/evidence/rpa-dom-2026-09-23/` 只覆盖 `kuaishou`/`douyin`/`bilibili`，**不含** `xiaohongshu`/`tencent_video`/`wechat_mp`

## 2. TDD：先写失败测试

- [x] `apps/desktop/electron/services/rpa-view-collector.test.js`（新增，15 例）：窗口池复用 / 登录态注入 / 轮询语义 / 超时分类 / 失败窗口不入池
- [x] `apps/desktop/electron/services/collect-account.test.js`（新增，6 例）：默认账号解析 / 无登录态 ⇒ null / 解析抛错不吞
- [x] `packages/shared-utils/src/__tests__/collector-scripts.test.js`（新增，43 例）：**假 DOM 真跑脚本文本**（逐平台：元素缺失 ⇒ `missing`；值非数 ⇒ `invalid`；0 是合法值）+ 计数解析（万/亿/千、日期、负数、小数）
- [x] `packages/shared-utils/src/__tests__/data-sync.test.js`（改，36 例）：注入 deps 生效 / 采集失败落 error 不落数值 / 最小间隔内零请求 / 并发上限 1 / 无账号跳过 / 时钟回拨
- [x] `apps/desktop/electron/core/container.setup.test.js`（改，+2 例）：装配锁（`dataSync._rpaViewManager` 必须是容器里的同一个实例）
- [x] 节流与并发的机械锁（断言网络层零调用 / 断言在途数 ≤ 1）
- [x] **变异验证**：把 fail-loud 改回 `|| '0'` ⇒ 锁必须红（实测 9 例翻红 / 还原后必绿）

## 3. 实现（主进程）

- [x] `apps/desktop/electron/services/rpa-view-collector.js`（新增，165 行）：复用 `rpa-view-session.js` 的 `_acquireWindow` + 账号登录态注入 + `executeJavaScript` 轮询；返回值校验复用 `collector-contract`（**不重复实现口径**）
- [x] `apps/desktop/electron/services/rpa-view-manager.js`：新增 `collect` 入口（沿用 mixin 模式注入 prototype）
- [x] `apps/desktop/electron/core/container.setup.js`：注册时注入 `{ rpaViewManager, resolveAccount }`（⚠️ 该文件只剩 1 行余量 ⇒ 账号解析的装配收进 `services/collect-account.js`）
- [ ] ⚠️ `rpa-view-platforms.js` **零改动**（target 容差 0）

## 4. 实现（跨包共享）

- [x] `packages/shared-utils/src/data-sync.js`：构造器接受第二参 deps；`_rpaFetchStats` 改走注入的执行体（删掉 `window.electronAPI` / `ipcRenderer` 两条只存在于渲染进程的通路）—— **上一刀（#4450）已完成**
- [x] 五个平台的抽取脚本逐字段改 fail-loud（删掉全部 `|| '0'` 兜底）⇒ 落到**可 import 的模块** `collector-scripts.js`（否则变异验证构造不出来）
- [x] 节流：TTL（既有）+ 同平台最小采集间隔（可配置，缺省 30 分钟）+ 全局并发恒为 1
- [x] 账号归属：绑定 `accountId`；无已登录账号 ⇒ `skipped(no-account)` 且零请求
- [x] 错误记录只带 `error`，**不写任何数值字段**（且失败记录**落缓存** ⇒ 失败态能到渲染端）
- [ ] ⚠️ `packages/shared-utils` 内零 require desktop 的 electron 模块（跨包边界门禁）

## 5. 本地门禁实跑

- [ ] `node .github/scripts/check-max-lines.js`（含 merge preview 口径）
- [ ] 跨包边界 / locale-sync（`--pair-base` / `--keys` / `--cjk` / `--py-cjk`）/ color-literals / font-size / css-var-defined / debt-budget
- [ ] 改动文件 U+FFFD 扫描 = 0
- [ ] 契约测试变异验证（见 2）
- [ ] 单元测试全绿（desktop 侧 + shared-utils 侧）

## 6. UI（**第二个 PR**，因像素基线必须由 CI 产）

- [ ] `apps/desktop/src/features/dashboard/PlatformDataGrid.vue`：读 `followers`；三态（数字 / 「—」+未采集 / 「—」+失败原因）；粉丝位单独标注账号级口径
- [ ] `apps/desktop/src/locales/dashboard/{zh,en}.js`：`followersPending` / `followersUnavailable` / `followersUnavailableReason` / `followersAsOf` / `followersScope`（成对）
- [ ] `data-testid` 供视觉用例选择（不依赖中文占位符）
- [ ] 像素基线：**从 CI artifact 收割**（本机截图一律不入库）
- [ ] ⚠️ `Dashboard.vue` / `tokens.css` **零改动**

## 7. 收口

- [ ] PR-1 开 PR → CI 全绿 → squash 合并 → 回读远端内容级锚点
- [ ] PR-2 开 PR → CI 全绿 → squash 合并 → 基线从 CI artifact 收割
- [ ] 执行记录回填（「远程同步」行保持 `由门禁推导`）
- [ ] 三处记忆沉淀（agent / user / EverOS）

## 8. 待拍板（阻塞 §6 的最终取值，不阻塞 §2-§5）

- [x] **D1 = A**（2026-10-25 用户拍板）：通道 + 治理全做，标定作为独立后续步骤，UI 继续「—」
- [x] 多账号平台取哪个账号 = 沿用仓内既有「默认账号」约定（`store.getDefaultAccount(platform)`，经 `publisher-router.loadAuthForTask` 补齐 cookie / 分区回退）⇒ **未另发明**
