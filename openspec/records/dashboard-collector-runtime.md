---
branch: dashboard-collector-runtime
stage: 2
date: 2026-10-25
---

# 执行记录：账号粉丝采集通道的执行体（PR-1 第 2 刀）

## 一、变更类型与隔离声明

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码**（desktop `electron/` + `packages/shared-utils`）⇒ 隔离 worktree `/workspace/wt/collector-runtime` + 裸分支 `dashboard-collector-runtime`；起点 `e30e4e1b184546cdc5570e76c530504f11fef129` = PR #4450 的 merge SHA = 当时的 `origin/main` tip（`git rev-parse origin/main` 实测同值） |
| 第一性原因（QM-5 ①） | ✅ | 粉丝位显示「—」的第一性原因 = **采集通道从未存在**（`rpaFetchData` / `rpa:fetchData` 全仓仅注释命中，preload 无暴露、`ipcMain` 无 handler）；上一刀（#4450）只补了「契约 + 接线骨架」，**执行体、账号归属、节流、并发仍然不存在** ⇒ 采集必然落 `invalid` ⇒ 仍然取不到真值 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸自「字段存在」的表象：5 个平台的抽取脚本早已产出 `followers`（`data-sync.js` 五处）⇒「有源」成立，掩盖了「无通道」；且旧脚本用 `parseInt(x \|\| '0')` ⇒ **缺字段与值不可解析都被折成 0**（假 0 的两个入口） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 共享包 **108 例**（契约 29 + 抽取脚本 43 + data-sync 36）+ 桌面端 **21 例**（采集执行体 15 + 账号解析 6）+ 容器装配锁 **2 例** = **131 例**；**变异验证 3 组全部「注进去必红、还原后必绿」**（见 §三） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 抽取脚本落到**可 import 的模块**（`collector-scripts.js`）⇒ 脚本本体可被单测用假 DOM 真跑 ⇒ 任何新写的脚本若再用 `|| '0'` 会被**当场判红**；② 契约层把「旧式裸对象」判 `invalid`（沿用上一刀）；③ **错误记录落缓存但零数值字段** ⇒ 界面能读到失败态而不是「空白＝成功」 |
| 行尾与 diff 对账 | ✅ | 7 个文件：3 新增 + 4 修改；`data-sync.js` 411 行 / `collector-contract.js` 193 行 / `collector-scripts.js` 167 行 / `rpa-view-collector.js` 165 行 / `collect-account.js` 75 行 ⇒ **全部低于 500 硬上限**；`node .github/scripts/check-max-lines.js` ⇒ **rc=0「无新增超大文件，挂账清单与现实一致」** |
| ⚠️ 行数余量告警 | ✅ | `core/container.setup.js` 原 493 行（门禁口径 494）⇒ 我第一版把它加到 **514** ⇒ **超 500 硬上限且该文件不在挂账清单里 ⇒ 会直接红主干** ⇒ 已把账号解析的装配收进 `services/collect-account.js`（`createCollectAccountResolver`）⇒ 回到 **499**（余 1 行） |
| 点名还账零容差 | ✅ | `apps/desktop/electron/services/rpa-view-platforms.js`（target 1499 / 容差 0）**零改动** —— 采集逻辑独立成 `rpa-view-collector.js` 新文件 |
| 接线棘轮 | ✅ | ① 容器装配锁：`dataSync._rpaViewManager` **必须 === 容器里的 `rpaViewManager` 实例**（漏注入即红）；② 叶子模块（`collector-scripts.js` / `collect-account.js` / `collector-contract.js`）的**调用方 e2e 必配**（`data-sync.test.js` 36 例 + `rpa-view-collector.test.js` 15 例） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 UI（**零 UI 改动** ⇒ 不需要刷像素基线） |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`；不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；合并后 main push 的回读证据写在 PR 评论里，不写回本文件 |

## 二、本刀改了什么（逐条对应 PRD 验收）

| PRD 验收 | 落点 | 状态 |
|---|---|---|
| #1 通道可达 | `container.setup.js` 注入 `rpaViewManager` + `resolveAccount`；`rpa-view-manager.js` 把 `collectorMixin` 注入 prototype | ✅ |
| #2 假 0 不再出现（元素缺失 ⇒ `COLLECT_FIELD_MISSING`） | `collector-scripts.js` 逐字段「缺则报 missing」；`collector-scripts.test.js` 逐平台锁 | ✅ |
| #3 值不可解析 ⇒ `COLLECT_VALUE_INVALID` | 抽取脚本自带计数解析器（不可解析 ⇒ `invalid` + 字段名）；契约层补 `invalid` 分支**保留 field** | ✅ |
| #4 无账号不请求 | `collect-account.js` 解析「默认账号 + 凭证 + 分区 cookie 回退」；无登录态 ⇒ `skipped(no-account)` 且**执行体零调用**、**不落缓存** | ✅ |
| #5 节流生效 | `data-sync.js` 同平台最小间隔（默认 30 分钟，可经 `sync_collect_min_interval_ms` 配置）⇒ **零请求** | ✅ |
| #6 并发恒为 1 | `data-sync.js` 的 `_withCollectLock` 全局采集闸（`syncAll` 是 5 平台并发发起，没这道闸就是并发 5） | ✅ |
| #7 错误不落数值 | 失败记录落缓存，**只有 `error`**（`followers`/`views`/`articles`/`comments`/`likes` 全部 `undefined`） | ✅ |
| #10 契约测试有牙齿 | 脚本落到可 import 的模块 ⇒ 假 DOM 真跑 ⇒ 变异「`invalid` 兜底成 0」**9 例翻红** | ✅ |
| #11 跨包边界 | `packages/shared-utils` 内**零** require desktop 模块（执行体与账号解析都由主进程注入） | ✅ |
| #12 行数零回退 | `Dashboard.vue` / `tokens.css` **零改动**；`rpa-view-platforms.js` **零改动** | ✅ |
| #15 编码无损 | 改动文件 `grep -c $'\xef\xbf\xbd'` = **0** | ✅ |
| #8/#9 渲染三态 / 口径标注 | 属 **PR-2**（UI 改动 ⇒ 像素基线必须由 CI 产） | ⬜ 下一片 |

## 三、变异验证读数（3 组，全部「注进去必红、还原后必绿」）

| # | 变异 | 结果 |
|---|---|---|
| M1 | 把抽取脚本的「值不可解析 ⇒ `invalid`」改回**兜底成 0**（等价于旧式 `\|\| '0'`） | 🔴 **9 failed / 34 passed**（5 个平台的 invalid 用例 + 4 条解析用例） |
| M2 | 把「目标元素缺失 ⇒ `missing`」改回**兜底成 0** | 🔴 **5 failed / 38 passed**（逐平台 missing 用例） |
| M3 | 删掉「同平台最小间隔内 ⇒ 零请求」的节流判定 | 🔴 **1 failed / 107 passed**（节流用例） |

⚠️ **变异打偏的教训（本次踩到）**：M2 的变异点在**生成器**里（`buildExtractionScript` 产出的脚本文本），
⇒ 变异必须打在「**会被加载/会被读到**」的位置上；打偏 ⇒ 锁不红 ≠ 锁没牙齿。
⇒ M1/M2 的变异都作用在**脚本生成结果**上（单测真的在跑那段脚本文本）⇒ 有效。

## 四、本刀顺带修掉的三个真缺陷

1. **「1.2万」被解析成 12（差 1000 倍）**：旧脚本 `parseInt(text.replace(/[^0-9]/g,''))`
   ⇒ 抽取脚本自带计数解析器（万/亿/千 + 千分位 + 「文本里只能有一个数」）。
   ⇒ 附带修掉「日期被当成粉丝数」（`2024-01-01` ⇒ `invalid`）。
2. **失败态到不了渲染端**：上一刀的失败结果**不落缓存** ⇒ `sync:cached` 里永远只有成功记录
   ⇒ 界面无法区分「没采过」与「采失败了」。⇒ 现在失败记录也落缓存（**只有 error，零数值**），
   渲染端既有的 `trustedSyncRows` 判据（无 `error` 且无 `_note`）自动把它判为不可信。
   ⚠️ 上一刀那条「失败结果不会被当成可信数据写进缓存」的断言其实是**空转**的
   （失败结果压根没进缓存 ⇒ 循环体一次都没执行）⇒ 本刀把它变成真断言。
3. **`Number(null) === 0` 把「没配置」读成「不限制」**：最小间隔若从 settings 读，
   `Number(null)` = 0 ⇒ 节流被静默关闭 ⇒ 变成「每点一次就采一次」。
   ⇒ 统一走 `toFiniteNumber()`（空/null/undefined 一律不算数）。

## 五、本刀的边界（明确没做什么）

- **没做选择器标定**：5 组选择器**仍无实机 DOM 证据**
  （仓内 `01-docs/evidence/rpa-dom-2026-09-23/` 只有**发布页**的 dump，
  `d5-douyin.json` 的 url 是 `creator-micro/content/post/video`，不覆盖创作者数据面板）
  ⇒ 与 D1 选 A 一致：标定是独立后续步骤（需真机登录态）。
  ⇒ **在标定完成前，采集必然落到 `missing`（选择器过期）⇒ 界面显示「—」+ 原因，绝不显示假 0。**
- **没做登录页识别**：PRD 风险表提到「cookie 失效 ⇒ 落到登录页 ⇒ 应报「需重新登录」」，
  但识别登录页需要**逐平台的登录页选择器**（同样无实机证据）⇒ 本刀不做，
  避免用猜测的选择器给出**错误的结论**（那比不识别更糟）。
- **没动 UI**（`PlatformDataGrid.vue` / locale / 像素基线）⇒ 粉丝数仍在界面上显示「—」，属 PR-2。
- **没改 `rpa-view-platforms.js`**（点名还账，容差 0）。

## 六、诚实边界

- **本地全量 desktop 测试未跑**：沙箱里 `pnpm install` 在 NFS 上不可用（实测 15 分钟只装到 174/1442）
  ⇒ 本地只跑了**定向装配**（global vitest 4.1.9 + jsdom + vue 插件 + workspace 包软链），
  覆盖：`electron/services/` + `electron/core/` 两个目录 + `packages/shared-utils` 三个测试文件。
  ⇒ **未覆盖** = 其余 ~1190 个 desktop 测试文件 ⇒ 「全绿」的表述只对上述范围成立。
- **采集在真机上的可用性未验证**：沙箱没有创作者后台的登录态 ⇒ 本刀的产出是「通道 + 治理」，
  真机上的选择器命中与否**未验证**。
- **`container.setup.js` 只剩 1 行余量**（499 / 上限 500）⇒ 下一个碰这个文件的改动必须抽模块。

## 七、CHANGELOG 条目

# feat(dashboard): 账号粉丝采集通道的执行体 —— 隐藏窗口 + 账号登录态 + 轮询判读

- 上一刀只补了「契约」，采集通道本身仍然不存在。本片把通道真正接通：复用 RPA 窗口池（按平台 + 账号分区，登录态天然隔离），注入该账号的 cookie / 分区 cookie / localStorage，导航到创作者后台并轮询抽取脚本，直到「取到 / 字段缺 / 值非法」三者之一。
- 同时补上三件治理：同平台最小采集间隔（默认 30 分钟，可配置）⇒ 零请求；全局采集并发恒为 1 ⇒ 不并发轰炸平台；无已登录账号 ⇒ 跳过该平台且零请求。
- 抽取脚本全部改成 fail-loud：元素缺失 ⇒ `COLLECT_FIELD_MISSING`，值不可解析 ⇒ `COLLECT_VALUE_INVALID`，**不再有 `parseInt(x || '0')` 把缺失折成 0**；顺带修掉「1.2万 被解析成 12」与「日期被当成粉丝数」。

## learnings

### lesson: 契约层落地了，**执行体没落地** ⇒ 通道依然不存在（上一刀的自审盲区）

**现场**：上一刀（#4450）把契约层 + 接线骨架做完了，单测 34 例全绿，
但采集执行体、账号归属、节流、并发**四件事一样都没有** ⇒ 采集必然落 `invalid` ⇒ 仍然取不到真值。

**根因**：「契约 + 接线骨架」在纸面上像是「通道已接通」——
执行记录里虽然写了「没做 Electron 执行体 ⇒ 下一刀」，但**没有一条机械判据能区分**
「骨架在」与「通道通」⇒ 下一个人（或我自己）很容易把前者读成后者。

**可复用的 2 条**：

1. **「通道存在」要有机械判据，不能靠描述**：本片的容器装配锁
   （`dataSync._rpaViewManager` 必须 === 容器实例）+ 「执行体零调用/被调用」的用例，
   才让「通道通不通」变成可断言的事实。
2. ⇒ **执行记录里「下一刀要做什么」必须逐条列成可判定的清单**（本片的 §二 验收对照表），
   否则「已完成」会被读成「已完成的部分 = 整体已完成」。

### lesson: 脚本不落到**可 import 的模块**里 ⇒ 变异验证根本构造不出来

**现场**：验收要求「把 fail-loud 改回 `|| '0'` ⇒ 锁必须红」，
而抽取脚本原先**内联在 `data-sync.js` 的 5 个方法体里** ⇒ 单测跑不到脚本本体 ⇒ 这条验收**无法构造**。

**解法**：把脚本抽到 `packages/shared-utils/src/collector-scripts.js`（纯函数 + 编译成脚本文本），
用**假 DOM + `vm.runInNewContext`** 真跑脚本文本 ⇒ 变异立刻可观察。

**泛化**：**「要求做变异验证」等于「要求被测对象可被单独执行」**——
两者是同一件事的两面。若被测对象不可单独执行 ⇒ 要么改设计（抽出来），
要么这条验收只能写成「人工检查」（那就得在记录里如实写明它不是机械判据）。

### lesson: 「失败态到不了界面」是一个**独立于数值正确性**的缺陷

**现场**：失败结果不落缓存 ⇒ `sync:cached` 里只有成功记录 ⇒ 界面分不清「没采过」与「采失败了」。
而上一刀那条断言「失败结果不会被当成可信数据写进缓存」是**空转**的
（失败结果压根没进缓存 ⇒ `for` 循环体一次都没执行 ⇒ 断言从未被检验）。

**根因**：**断言写在循环里、而循环体一次都不执行** ⇒ 看起来有保护，实际零覆盖。
⇒ 与「恒真断言」同族，但更隐蔽：恒真是「结论恒成立」，空转是「结论从未被求值」。

**可复用的 2 条**：

1. **写完断言要问「它被求值过吗」**：断言里若有循环/条件分支 ⇒ 加一条**计数守卫**
   （例如断言被检查的行数 ≥ 1），否则空转看不出来。
2. ⇒ **「可信/不可信」的判据必须作用在**真实存在的记录**上** ⇒ 失败记录也要落缓存
   （但**零数值字段**）⇒ 渲染端既有的 `trustedSyncRows` 才能真的判出「不可信」。
