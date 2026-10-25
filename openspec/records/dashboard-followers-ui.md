---
branch: dashboard-followers-ui
stage: 1
date: 2026-10-25
---

# 执行记录：账号粉丝上屏（PR-2，UI 片）

## 一、变更类型与隔离声明

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **UI + 数据模型**（`apps/desktop/src`）⇒ 隔离 worktree `/workspace/wt/followers-ui` + 裸分支 `dashboard-followers-ui`（起点 = 当时的 `origin/main` tip `de06acc3`）；⚠️ 起点是 PR #4455 合并**之后**的新 main（期间又进了 5 个 PR：#4451/#4458/#4460/#4459/#4457）⇒ 已核对**无一条碰过本片目标文件**（`git diff --name-only 84a2f5e2..origin/main \| grep -E "dashboard\|locales"` 命中 0） |
| 第一性原因（QM-5 ①） | ✅ | 上一刀（#4455）把**采集通道**接通了，但**失败态到不了界面**：`trustedSyncRows()` 把带 `error` 的记录直接丢弃 ⇒ 界面分不清「没采过」与「采失败了」；且粉丝槽位**没有任何口径标注** ⇒ 用户读不出这个数是账号级还是作品级 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸自「粉丝位已经显示了」：PR #4435 之后粉丝位就在渲染（值来自 `metricOf(syncRow,'followers')`）⇒ 看上去「已上屏」；但**三态被压成两态**（有值 / 「—」），失败原因**根本没进模型** ⇒ 「已实现」掩盖了「失败不可见」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 模型三态 8 例 + 组件三态 5 例（含 1 条 token⇄locale **机械锁**）= **13 例新增**；本地 `src/features/dashboard/` **63/63 绿**（含既有 PerformanceFlowPanel 17 例） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 模型层 `partitionSyncRows()` —— **一条判据、两个出口**（trusted / failed）⇒ 不会再出现「判据两处各写一遍」的口径分裂；② 失败原因按**契约错误码**归类成 token ⇒ 界面只显示**可读原因**，**内部错误码不泄漏**（组件用例显式断言 `COLLECT_FIELD_MISSING` 不出现在 DOM 里） |
| 行尾与 diff 对账 | ✅ | 5 个文件（3 改 + 2 改测试 + 2 locale = 7 个文件）：`PlatformDataGrid.vue` / `dashboard-panels-model.js` / `dashboard-panels-model.test.js` / `PlatformDataGrid.test.js` / `locales/dashboard/{zh,en}.js` + 本记录；`Dashboard.vue` / `tokens.css` **零改动** ⇒ 门禁余量（986/996、498/500）**未被动** |
| 门禁余量 | ✅ | `node .github/scripts/check-max-lines.js` ⇒ **rc=0**「无新增超大文件，挂账清单与现实一致」；`PlatformDataGrid.vue` 246 行、`dashboard-panels-model.js` 380 行 ⇒ 均远低于 500 |
| 接线棘轮 | ✅ | ① 模型层新增导出（`FANS_*` / `partitionSyncRows` / `fansReasonOf`）全部**被调用方用到**（组件 + 测试）；② `FANS_REASON_LOCALE_KEYS` 放在**模型层**（不是组件里）⇒ 单测能直接 import 它 ⇒ **不需要**「读源码正则去捞」那种脆锁 |
| 跨语言/边界 | ✅ | 零后端改动；locale zh/en **成对**（`check-locale-sync` 四道判据全绿：pair/symmetry/cjk/keys） |
| QM-1 打包 / QM-4 视觉 | ✅ 两段式 | 本片**有 UI 改动** ⇒ 像素基线由 **CI 产物收割**（run `40199253540`，本机截图一律不入库）⇒ 第 ① 步（代码）CI 的 QG Visual **如预期红**（基线过期）⇒ 收割后第 ② 步（基线）补一个提交 ⇒ CI 复跑 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`；不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`）；合并后 main push 的回读证据写在 PR 评论里，不写回本文件 |

## 二、变异验证读数（4 组，全部「注进去必红、还原后必绿」）

| # | 变异 | 结果 |
|---|---|---|
| M1 | 粉丝失败不再判 `error`（失败与「没采过」混同） | 🔴 **红**（rc=1） |
| M2 | 粉丝值缺失时回落成 **0**（假 0 复发） | 🔴 **红**（rc=1） |
| M3 | locale 键改名（`followersUnavailableReason` → `…ReasonX`） | 🔴 **红**（rc=1，token⇄locale 机械锁生效） |
| M4 | 副标题不再带口径（`scope` 传空串） | 🔴 **红**（rc=1） |
| M5 | `followersPending` 不带口径 | 🔴 **红**（rc=1） |

⇒ 还原后复跑：**63/63 绿**。

## 三、本刀的边界（明确没做什么）

- **没做选择器标定** ⇒ 5 组选择器仍无实机 DOM 证据 ⇒ 采集在标定完成前必然落 `missing`
  ⇒ 界面对该平台显示「—」+「粉丝数据暂时无法获取（平台页面结构已变化）」。
  ⇒ **这是准确的结论，不是缺陷**（与 D1 = A 一致）。
- **没做登录页识别**（cookie 失效 ⇒ 报「需重新登录」）⇒ 需要逐平台登录页选择器（无实机证据）
  ⇒ 用猜的选择器给出错误结论比不识别更糟 ⇒ 不做。
- **没动 `Dashboard.vue` / `tokens.css`**（余量只有 10 行 / 2 行）⇒ 口径标注走**副标题**（既有元素）
  ⇒ **零新增字号、零新增 CSS** ⇒ 也就不会撞 `check-font-size-scale`。
- **没改后端**（`data-sync.js` 上一刀已定：失败记录落缓存但零数值字段）⇒ 本片只把**失败态**从模型层接到界面。

## 四、诚实边界

- **像素基线已从 CI 渲染收割**（本机截图一律不入库，QM-4 第 7 条）：
  浅色 `dashboard.png` ← QG Visual run `40199253540` 的 `tests/visual-testing/screenshots/dashboard.png`
  （**views 套件**产物；`check-baseline-freshness.js` 的 `findRender` 对这个名字**优先**取 views 套件那张）；
  暗色 `dashboard-dark.png` ← 同 run 的 `screenshots/dashboard-dark-current.png`
  （该 run 的 views 套件**没有**产出 `dashboard-dark.png` ⇒ `findRender` 走 `-current.png` 回落分支
  ⇒ 必须取**像素门禁**那张）。
  ⚠️ **两次来源不同**（一次 views、一次 pixel-gate）⇒ 取错来源 ⇒ 像素不等 ⇒ 门禁照红。
  ⇒ 收割后与同一次渲染**逐字节同源**（本片按构造保证：直接从 artifact 落盘）。
- **本地未跑全量 desktop 测试**：沙箱 `pnpm install` 在 NFS 上不可用（实测 15 分钟装到 174/1442）
  ⇒ 本地只做**定向装配**（global vitest 4.1.9 + jsdom + vue 插件 + workspace 包软链）
  ⇒ 覆盖 `src/features/dashboard/` 三个测试文件（63 例）⇒ **「全绿」的表述只对上述范围成立**。
- **三态的覆盖靠单测，不靠视觉用例**：CI 的视觉套件跑的是**真实应用**（无账号 ⇒ 粉丝位是「—」）
  ⇒ 三态（ready/pending/error）的渲染由**组件单测**覆盖，视觉用例只守「没崩、没变形」。

## 五、CHANGELOG 条目

# feat(dashboard): 账号粉丝上屏 —— 三态分开，口径标在槽位上

- 粉丝位此前只有「有值 / 「—」」两态：「没采过」与「采失败了」在界面上长得一样 ⇒ 用户以为功能坏了。现在分成三态：拿到真值显示数字；没采过显示「—」+「尚未采集粉丝数据」；采失败显示「—」+「粉丝数据暂时无法获取（原因）」，且给的是可读原因而不是内部错误码。
- 粉丝的**口径标注走卡片副标题**：`followersScope`（账号级）在**三个状态下都出现**
  （ready ⇒「账号级 · 数据截至 {time}」／pending ⇒「账号级 · 尚未采集粉丝数据」／
  error ⇒「账号级 · 粉丝数据暂时无法获取（原因）」）⇒ 口径一直看得见。
  ⛔ **没做成「槽位旁挂一个小标签」**：① 仓内门禁禁止 `font-size` 字面量
  （`check-font-size-scale.js`，实测把 `10px` 逮住）而仓内**没有比 `--font-size-xs`(12px)
  更小的字号 token**；② 「粉丝」+「账号级」在 12px 下宽约 64px，而该列实测可用宽约 65px
  ⇒ 几乎必然溢出。⇒ 副标题整行可用 ⇒ 口径标注放那里：零布局风险、零新增字号、槽位仍等宽。
- 顺手订正了 KPI 说明文案：原文说「当前版本未接入采集」，而通道在上一刀已接通 ⇒ 改为「取不到真值时显示「—」而不是 0」。

## learnings

### lesson: 「已上屏」与「失败可见」是两件事 —— 界面上有数字**不等于**用户能判断它可不可信

**现场**：粉丝位在 PR #4435 之后就已经渲染了（值来自 `metricOf(syncRow,'followers')`）⇒ 看着「已实现」。
但 `trustedSyncRows()` 把带 `error` 的记录**直接丢弃** ⇒ 采失败与「还没采过」在界面上**完全一样**（都是「—」）
⇒ 用户看到「—」时无法判断是「该平台还没采」还是「采挂了」。

⇒ 与「叶子模块单测全绿 ≠ 已接线」同族，但更靠上：**下游把失败信息过滤掉时，界面不会报错，只会变得沉默**。

**可复用的 2 条**：

1. **判据要从「一个出口」改成「两个出口」时，要在同一处实现**：本次把 `trustedSyncRows` 拆成
   `partitionSyncRows() → { trusted, failed }` ⇒ **判据只有一份、出口有两个** ⇒ 不会长出口径分裂。
2. ⇒ **「界面上有值」与「用户能判断这个值可不可信」是两条独立验收** ⇒ 后者要有**自己的**用例
   （本次：error 态必须显示原因、且**内部错误码不得出现在 DOM 里**）。

### lesson: 「小标签」这种看似安全的方案，会同时踩**字号门禁**与**列宽**两个坑

**现场**：给粉丝槽位加一个「账号级」小标签（`font-size: 10px`）
⇒ CI 的 `check-font-size-scale` 判「新增 font-size 字面量（应使用 var(--font-size-*)）」而红；
本地 eslint 是绿的 ⇒ **第一轮 CI 才发现**。

⇒ 深挖后发现**两个坑叠在一起**：
① 仓内**没有比 `--font-size-xs`(12px) 更小的字号 token** ⇒ 想更小只能写字面量 ⇒ 必红；
② 「粉丝」+「账号级」在 12px 下宽约 64px，而该列实测可用宽约 65px ⇒ 几乎必然溢出。

**可复用的 2 条**：
1. ⭐ **加「小一号」的标签前先查字号刻度有没有这一档**；没有 ⇒ 方案本身不成立（不是「先写着再说」）。
2. ⭐ **同一张卡里加任何并排元素前，先量该列的可用宽度**（列宽 = 卡宽 − padding − gaps），
   别凭「看着放得下」；**放不下就换位置**（本片换到副标题 ⇒ 口径反而在三个状态下都可见）。
⇒ 与「口径标注必须一直看得见」合起来看：**位置的选择要同时满足「不溢出」与「状态无关」**。

### lesson: 「失败原因」要按**错误码归类**再查文案 ⇒ 界面不甩内部代号、也不猜

**现场**：主进程的失败消息形如「平台数据采集失败（douyin）：COLLECT_FIELD_MISSING / followers」。
直接把这句话甩给用户 = 泄漏内部代号；只显示「失败」= 用户无从下手。

⇒ 解法：模型层按**已知的契约错误码**归类成 token（selector / not-ready / unknown）⇒
组件按 token 查 locale ⇒ 界面只出现**可读原因**。
⚠ 这条映射与 locale 是一对「**手工同步的清单**」⇒ **必须有机械锁**
（本次：token⇄locale **双向**用例，漏一条当场红 —— 变异 M3 证明了它有牙齿）。
