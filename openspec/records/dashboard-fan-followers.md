---
branch: dashboard-fan-followers
stage: 2
date: 2026-10-25
---

# 执行记录：数据页账号粉丝数真实化（创作者后台采集通道，规格片）

## 一、变更类型与隔离声明

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：隔离 worktree + 裸分支 `dashboard-fan-followers`（起点 `97902ba`）；本 PR 为**纯文档**（规格片）⇒ 就地编辑 + 经 PR 落地 |
| 第一性原因（QM-5 ①） | ✅ | 粉丝位显示「—」的第一性原因 = **采集通道从未存在**（`rpaFetchData`/`rpa:fetchData` 全仓仅 3 处注释命中，preload 无暴露、`ipcMain` 无 handler），不是「数据源缺失」也不是「解析器缺失」 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸自「字段存在」的表象：`data-sync.js:248/262/275/286/298` 五处 `followers` 让「有源」成立，掩盖了「无通道」；`PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md:38` 也据此写了「真数据」 |
| 修复 + 回归保护（QM-5 ④） | ⏳ | 本片为规格片；回归保护落点写在 spec delta 的 Scenario（假 0 / 值不可解析 / 真 0 三态可区分）⇒ 实现见 PR-1 tasks §2 |
| 防止再次发生（QM-5 ⑤） | ✅ | 规格片把「抽取脚本不得保留 `\|\| '0'` 兜底」「选择器无实机证据须登记」写进 Requirement（可机械断言）⇒ 防止新通道把旧病带回来 |
| 行尾与 diff 对账 | ✅ | 本片只新增 4 个文件、**零行删除** ⇒ numstat 两口径必然相等，删除数归因为 0 |
| 接线棘轮 | N/A | 本片**不新增** `*.test.js`；实现片的测试文件已在 `openspec/changes/dashboard-account-followers/tasks.md` §2 登记 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`；不以自审冒充通过 ⇒ 规格片按「文档变更 + 逐条可复验取证」交付，双模型评审在实现片补 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；合并后 main push 的回读证据写在 PR 评论里，不写回本文件 |

- **变更类型**：📝 纯文档变更（规格片）+ 🏗️ 架构/API 变更的**规格**（本 PR 不含运行时代码）。
  - 新增 `01-docs/PRD-DASHBOARD-ACCOUNT-FOLLOWERS-2026-10-25.md`
  - 新增 `openspec/changes/dashboard-account-followers/{proposal,tasks}.md` + `specs/dashboard-account-followers/spec.md`
  - 新增本执行记录
- **隔离**：运行时代码落地将在**隔离 worktree + 裸分支** `dashboard-fan-followers`（起点 `97902ba`）进行；本 PR 为 docs-only，走仓内 docs-only 快速通道。
- **规模刻意控制**：本片只出规格与取证，**不动任何运行时代码** ⇒ 不触碰本轮所有行数零容差约束（见 §三）。

## 二、收口核对（上一轮 PR #4435 的最终状态）

| 判据 | 读数 | 结论 |
|---|---|---|
| quality-gate run `40167250883`（`head_sha=071318d3`） | `completed` / `success`，**11/11 job success**，含 `QG Coverage` | 本次合并所在的提交**全绿** |
| Electron CI run `40167250900`（同 `head_sha`） | `completed` / `success`，2/2 job success | 同上 |
| `GET /pulls/4435` | `state=closed` / `merged=true` / `merged_at=2026-10-25T05:55:03Z` / `merge_commit_sha=071318d3` | 已合并 |
| `GET /branches/feat/dashboard-truthful-ui` | **HTTP 404** | 远端分支已删 |
| `GET /compare/071318d3...<当前 main>` | `status=ahead` / `ahead_by=3` / **`behind_by=0`** | 我们的合并**仍在主干祖先链上**，未被后续提交覆盖 |

⚠️ **措辞分层（不替别人线断言）**：同一时刻 `main` tip 已前进到 `97902ba`（中间进了 #4444 / #4421 / #4443 三个别的 PR），
那 3 个 PR 触发的 push CI 里 `QG Coverage` / `QG Desktop Shards (2/2)` / `electron-tests` **仍在 in_progress**。
⇒ 只能写「**我们这次合并的提交全绿；后续 tip 的 CI 仍在进行中，未观察到红**」，
**不能**写「主干现在全绿」（未判定 ≠ 通过）。

## 三、立项取证：原计划被仓内定案否掉了一半

### 3.1 检索纪律

动手前全树搜 `01-docs/`（986 个文件）⇒ 命中 4 份相关定案文档：
`PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md`、`PRD-HOME-DATA-TRUTHFULNESS-2026-09-23.md`、
`PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md`、`QM6-FINDINGS-METRICS-DASHBOARD-2026-10-04.md`。

### 3.2 原计划的两处修正

| 原切片 | 原设想 | 取证结论 | 处置 |
|---|---|---|---|
| P2-2 | 接 `analytics:overview` + 给它加节流/缓存 | ❌ 与仓内定案冲突：`PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md` §七.1 明确「**不接 `analytics:overview`**」 | **撤回** |
| P2-1 | 为 5 个平台实现创作者后台解析、接通 RPA 通道 | ⚠️ 解析器**早就存在**，缺的是「通道没接上」 | **范围收窄** |

**P2-2 该撤回的依据是两条互相印证的真源**：
① `PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md` §七.1「不接 `analytics:overview`（与 `sync:cached` 同源不同路，会引入第二套口径冲突）」；
② `PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md:38`「总粉丝」取 `platformData` 的 `views/comments/followers`（账号级创作者中心同步，TTL 缓存）；
③ `QM6-FINDINGS-METRICS-DASHBOARD-2026-10-04.md` FF1（**采纳**）「上方卡片是账号级 `sync:cached`，面板是作品级 `performance_snapshot`」。
⇒ 真源指向 `sync:cached` 的 `platformData.followers`；原 P2-2 是在给一条**被定案判为不该接的通道**做治理，方向错了。

### 3.3 缺口的三层取证（粉丝数不是「没有数据源」）

| 层 | 事实 | 坐标 |
|---|---|---|
| ① 字段存在 | 5 个平台的抽取脚本**都已产出 `followers`** | `packages/shared-utils/src/data-sync.js:248 / 262 / 275 / 286 / 298` |
| ② 通道不存在 | `rpaFetchData` / `rpa:fetchData` **全仓只命中 3 处注释**（preload 无暴露、`ipcMain` 无 handler） | `src/features/dashboard/dashboard-panels-model.js:149`、`src/features/dashboard/PlatformDataGrid.vue:63`、`packages/shared-utils/src/data-sync.js:231` |
| ③ 进程错配 | `DataSyncService` 注册在**主进程**，而旧通路用 `window.electronAPI` / `ipcRenderer`（只存在于渲染进程） | `apps/desktop/electron/core/container.setup.js:349` |

⇒ 真实缺口 = **采集通道没接上**，不是解析器没写。

### 3.4 执行体其实齐备（这一步把工作量从「大」改成「中」）

- `rpaViewManager` 是**主进程 DI 服务**：`core/container.setup.js:117` 注册；`services/stage-executor.js:834` 已在用 `container.get('rpaViewManager')` ⇒ **主进程完全可达**。
- 窗口池与账号登录态注入在 `services/rpa-view-session.js`（`_acquireWindow` / TTL 回收 / partition cookie）⇒ 采集能力可**复用**，不必新造。
- 但 `RpaViewManager` 的公开 API 只有 `publish` / `cancel` / `cleanup` / `setMainWindow` / `onProgress` ⇒ **没有「采集」入口**。

### 3.5 三个尚未被处理的隐患（不处理则新通道会把旧病带回来）

| 隐患 | 事实 | 后果 |
|---|---|---|
| **A 假 0 复发** | 抽取脚本内 `parseInt(... \|\| '0')` 兜底：面板在、字段改名 ⇒ 返回 `0` 而非缺失 | PR #4435 刚消灭的「假 0」从新通道复活 |
| **B 选择器未验证** | 5 段脚本**无任何出处/日期注释**；`rpa-view-platforms.js` 内 `fans` **零命中**；`01-docs/evidence/rpa-dom-2026-09-23/` 只覆盖 `kuaishou`/`douyin`/`bilibili`，**不含** `xiaohongshu`/`tencent_video`/`wechat_mp` | 通道通了但取不到数 ⇒「接通了但功能仍不可用」 |
| **C 触发频率** | 创作者后台直连有平台风控（`PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md` 记「不能太频繁查询以防被封」） | 过频采集可能影响账号 |

## 四、门禁余量实测（本片**零改动**这些文件）

| 文件 | 读数 | 上限 | 余量 | 处置 |
|---|---|---|---|---|
| `apps/desktop/src/views/Dashboard.vue` | 986 | 996（登记 796 + 容差 200） | **10** | 不动 |
| `apps/desktop/src/styles/tokens.css` | 498 | 500（`>=500` 即红） | **2** | 不动 |
| `apps/desktop/electron/services/rpa-view-platforms.js` | — | **target 1499 / 容差 0** | **0** | **一行不碰** ⇒ 采集逻辑独立成新文件 `rpa-view-collector.js` |
| `apps/desktop/src/features/dashboard/PlatformDataGrid.vue` | 224 | 未登记 | 可改 | UI 落点 |
| `packages/shared-utils/src/data-sync.js` | 305 | 未登记 | 可改 | 采集调用点 |
| `apps/desktop/electron/core/container.setup.js` | 493 | 未登记 | 可改 | 依赖注入 |

> ⚠️ 行数口径提醒：门禁脚本用 `split('\n').length`（= 行数 + 1），上表为 `wc -l` 读数；动手前需按门禁口径重算余量。

## 五、隔离与撞车排查

- **在飞 PR**：30 条 open PR 全列 ⇒ **无一条**碰数据页 / 粉丝 / analytics ⇒ 不撞车。
- **跨包边界**：`packages/shared-utils` 是跨包共享包 ⇒ `data-sync.js` **不得** require desktop 的 electron 模块 ⇒ 只能用**依赖注入**（仓内先例：`stage-executor.js:834`）。
- **本片为 docs-only** ⇒ 走仓内 docs-only 快速通道判定。

## 六、诚实边界（本片不假装已闭合）

- **3/5 平台无实机 DOM 证据** ⇒ 通道与治理做完也不保证取得到数；选择器标定需要真机登录态（沙箱做不了）⇒ 标定完成前界面继续显示「—」。
- 最小采集间隔 **30 分钟是建议值**（平台风控真实阈值无公开数据），落地时做成可配置。
- 多账号平台取哪个账号**未定案**（倾向沿用仓内既有「默认账号」约定，落地时核对，不另发明）。
- 采集通道的**真机端到端复跑**（真登录态 + 真平台）本片**未执行** ⇒ 属 PR-1 的验收前置，不在规格片里假装完成。

## 七、CHANGELOG 条目

# docs(dashboard): 补齐账号粉丝数的采集通道规格 —— 撤回 analytics 接法，改走 sync 通道

- 数据页平台卡的「账号粉丝」位此前显示「—」：不是没有数据源，而是创作者后台的**采集通道从未存在**（5 个平台的抽取脚本早在，只缺一个能跑起来的执行体）。本片把这条链路的规格写清：主进程可达的采集通道、缺字段即抛错的 fail-loud 语义、节流与并发上限、账号归属与账号级口径标注。
- 同时撤回上一轮留下的「接 `analytics:overview`」方案——仓内已有定案明确不接它，真源指向 `sync:cached` 的 `platformData.followers`。

## learnings

### lesson: 上游定案文档会否掉原计划 —— 且被否掉的方案可能正好是「方向错」而非「做得少」

**现场**：上一轮留下的两个切片里，P2-2 计划「接 `analytics:overview` + 给它加节流/缓存」。开工前全树搜 `01-docs/`（986 个文件）命中两份互相印证的真源：`PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md` §七.1 明确「不接 `analytics:overview`」，而 `PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md:38` 写明「总粉丝」取 `platformData.followers`。

**根因**：原计划把「补一个数据源」当成了「数据源缺治理」，于是去给一条**被定案判为不该接的通道**做节流/缓存。真正的缺口在别处：字段早就在、解析器早就在、缺的只是「通道没接上」。

**可复用的 3 条**：

1. **方案落地前先全树搜 `01-docs/`**（本次 986 个文件，30 秒）——仓内定案文档会直接否掉原计划。
2. **「定案说不接 X」时，先问「X 是不是本来就不该接」**——本例的真实缺口不是「X 缺治理」，而是「另一条路缺执行体」；把力气花在 X 上等于给一条错路做优化。
3. **定案文档的「不做什么」自带理由，理由本身要被核对前提**——本例「与 `sync:cached` 同源不同路会引入第二套口径冲突」这条理由在「`sync:cached` 里本来就没有粉丝」这个前提下并不成立 ⇒ 属于**前提失效**，不是「论证有错」⇒ 记录时写成「随前提失效」，不写成「已作废」。
