# 执行记录：错误态三态统一第一步（ux-audit-error-state）

| 远程同步 | 由门禁推导 |
|---|---|

- 本 PR：#4485（状态列不手写状态词；合并后收口由 scripts/lib/merge-ledger.js 按主干历史推导，见 AGENTS「旧载体冻结」与 change gate-record-sync-derived-status）

- 分支：`ux-audit-error-state`（隔离 worktree：按 `scripts/start-mp-task.ps1` 的默认约定落在**仓库父目录**下的 `mp-worktrees/mp-<task-name>`，本机该父目录在非 C 盘；取证锚点是分支名与本 PR 号，不是某台机器的绝对路径）
- 日期：2026-10-26 ｜ 审计条目：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 3.7（含 audit-44 / audit-47 / 正文 line 371）
- 变更性质：渲染端组件 + 6 个视图模板 + locales ⇒ 运行时代码变更，必须经 PR + CI
- 详细合同：`01-docs/PRD-UI-ERROR-STATE-2026-10-26.md`

| 步骤 | 状态 | 证据 |
|---|---|---|
| 根因（QM-5 ①） | ✅ | 错误态没有单一实现：`views/**` 里每个视图各自画一块"失败了"，`role`、重试出口、图标全靠临场发挥。当场机械实测 = **35 处整块自绘站点 / 20 个文件**，其中只有 4 处写了 `role="alert"`、9 处给了重试。审计行 3.7 写的"5 处"少了一个数量级（本批按实测排期，不按抄来的数字）。 |
| 逃逸分析（QM-5 ②） | ✅ | 单元：既有视图用例的写法是 `expect(w.find('.error-state').exists()).toBe(true)` —— **Vue 3 对未注册的自定义标签不报错**，会把它原样渲染成一个空元素，于是 `exists()` 恒真而屏幕上什么都没有；集成/视觉：像素门禁对"读屏有没有播报"结构性失明；审查：AGENTS 已为正文形态、href 协议、令牌等立"单一实现 + 锁"，错误态这一维没有。 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=**测试质量不足（存在性断言冒充行为断言）+ 流程缺失（无组件单一真源）**。同族第 N 次复发：本仓记过的"装饰性链路"「`toContain` 对结构性回归免疫」「注册≠注入≠生效」是同一件事的三个侧面。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `components/UiErrorState.vue`（`role="alert"`、禁叠 `aria-live`、`retryText` 缺省不长按钮、`type="button"`、`el-icon` 图标且容器 `aria-hidden` 且文本为空、`:focus-visible` 焦点环、零裸 hex、`testId` 保锚点）。② 迁移 **7 处 / 6 个文件**（PerformanceInsights / ProjectLibrary / ContactSheetView / CreateHistory×2 / PipelineSelector / QuickRenderPanel），顺手消掉 `PipelineSelector` 的 emoji 图标（audit-44）。③ 新增 `src/error-state-convergence.test.js`（14 条：逐站点接线 / Options API 注册 / 死导入与撞车 / 遍历完整性 / 存量棘轮双向 / 反失明前提 / emoji / locale zh-en 成对与聚合入口接线）。④ 文案落 `locales/error-states/{zh,en}.js` 并接进 `locales/zh.js`/`en.js`。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 存量棘轮 `REGISTRY`（28 处 / 14 文件）双向判据：新增未登记 ⇒ 红；就地减少不销账 ⇒ 陈旧红 ⇒ 下一批必须同次改小。② 接线锁按**语法位置**切（只认 `<div\|section\|p\|span>` 开标签上的旧 class），迁移后把同名 class 留在组件上不会误报，也不会漏报。③ Options API 的"import 了但没注册"成为独立判据，并把 `PipelineSelector` 那条"只断存在"的老用例改成断"用户真看得见"（role + 标题文本 + 按钮存在）。④ 死导入判据复用 `deadImports()` 单一实现，防 #4424 那类"vitest 全绿、vite build 才炸"。 |

## 反证与实测读数

- `vitest run` 8 个相关文件 ⇒ `Test Files 8 passed (8) / Tests 125 passed (125)`
- 棘轮现场：`[ERR-RATCHET] files=14 total=28 清单=AutoPipelineView.vue=2 AutomationView.vue=1 CloudPublish.vue=1 Collection.vue=3 CreateView.vue=1 FilmEngineeringView.vue=8 MemberCenter.vue=1 PromptEvalView.vue=1 PublishHistory.vue=3 ReplayTimeline.vue=1 RewriteView.vue=1 ViralAnalysis.vue=2 video-creation/ErrorDialog.vue=2 video-creation/SceneAssetSelection.vue=1`（每次跑打印）
- `vite build` ⇒ rc=0，无 `already been declared` / `could not be resolved`
- 变异驱动 `scripts/error-state-mutate.cjs` → **CAUGHT=12/12**（E1 role 摘成 status / E2 叠 aria-live / E3 按钮缺 type / E4 emoji 回图标位 / E5 自绘块回流 / E6 摘 Options API 注册 / E7 摘 import / E8 把 import 改成注释 / E9 新增未登记站点 / E10 扫描恒返空集 / E11 只删 zh 侧键 / E12 把登记表改大）；基线趟 rc=0 失败行=0、还原后复跑 rc=0、逐刀同一份 original 快照

## 本批过程中被抓出来的四件事（都不是"顺手改掉的旁枝"，各自有判据）

1. **Options API 只 import 不注册 = 静默空白**。`PipelineSelector.vue` 与 `CreateHistory.vue` 都是 `<script>` + `components:`。第一版迁移后 `PipelineSelector` 的 8 条用例**全绿**，而它的错误块已渲染成空元素——是收敛锁的"必须出现在 `components: {…}`"这条把它抓住的。修法不是加断言字符串，而是注册 + 把那条"只断存在"的老用例升级为断 role/文本/按钮。
2. **死导入被自己的锁抓住**：`ProjectLibrary.vue` 的 `UiButton` 在替换后只剩 import。这正是 #4424 的同型（vitest 不报，`vite build` 才炸），所以判据必须住在单测里而不是依赖 build。
3. **同一文件里的同形缺陷不能只修一处**：`CreateHistory.vue` 有两块同型自绘错误态，第一版只迁了渲染记录那块，`marker=history-error` 的语法位置判据当场把它报了出来（否则就是"改了名字没改干净"，第二处成为下一次复发的种子）。
4. **驱动自身的两条环境坑（留痕防止改回去）**：`spawnSync('pnpm.CMD', …)` 在 Node 24 直接 `EINVAL`（.cmd 需 shell），且 macOS/Linux 无 `.cmd` ⇒ 驱动"跑不起来"会被读成"基线就红 ⇒ 无法归因"；改为 `process.execPath` + 逐级上溯找 `node_modules/vitest/vitest.mjs`，找不到即 fail closed。第二处：vitest 的汇总行带 ANSI 颜色，不剥转义序列时 `Test Files  2` 匹配不上，"跑完了"被误判成"采集断了"。

null
## 第二轮外部评审（critic=claude）：输出被截断，但截断片段里那条是**真缺陷**

引擎这轮以「JSON 被截断」失败收场（`status=error`、`performedBy=claude`，`DEEP_RC` 非 0 档），按本仓口径**有截断 ≠ 没有发现**：片段里已经落出一条 Warning，实测成立——

> `QuickRenderPanel.vue` 迁移把原 `data-testid="quick-retry"` 的重试按钮整块换成 `<UiErrorState>`，组件内部按钮只有 class 没有 testid；7 处里只有**容器**锚点被保住，**按钮**锚点静默丢失。

这正是我自己 PRD §3 写的"迁移必须保住 data-testid"这一条**没有被任何东西守住**：我保了容器、丢了按钮，而全仓当下没有 `[data-testid="quick-retry"]` 的消费者（`git grep` 零命中），所以它不会以任何测试的形式浮现。

处置（三步都做了实测）：

1. 组件加可选 `retryTestId`，`QuickRenderPanel` 传回 `quick-retry`。
2. 收敛锁新增一条**由 git 改动前 blob 派生**的锚点判据：逐站点把 `origin/main:<file>` 里出现过的每个 `data-testid` 拿来要求在当前文件里仍在。口径与令牌基线同源——**不手抄清单**，手抄清单自己就是下一个矛盾源（PRD §1 的 83/93 就是教训）。现场读数 `[ERR-ANCHOR] 已核对锚点 37 个（取自 origin/main 的改动前 blob）`。
3. 正反两档各跑一次证明这条有牙：摘掉 `retry-test-id` ⇒ `1 failed`，失败项逐字点名 `video-creation/QuickRenderPanel.vue :: quick-retry`；还原 ⇒ `Test Files 2 passed / Tests 41 passed`。（先修代码再加锁的话，锁永远没经历过那次真实违规——所以必须补 A/B，而不是只在绿基线上宣布"有牙"。）

本轮复跑：`vitest` 相关 3 文件 `Test Files 3 passed / Tests 53 passed`。
## 本批刻意不做的（写清理由，不是默默留下）

- `ReplayTimeline.vue` **退回未迁**：其测试夹具 `mountComponent(component)` 裸跑、不装 i18n，在该视图引入 `$t` 会把 12 条用例打成 `_ctx.t is not a function`。正解是先补夹具（测试基建改动），不与本批 UI 语义混做。已留在 `REGISTRY` 里计数，不会被视为已收敛。
- **旧自绘块的 CSS 规则没删**：`.pi-error` / `.cs-error` / `.error-state` 等仍在各视图 `<style>` 中，现与组件自身样式叠加。因此本批**不声明"零视觉回归"**——像素判定交给 CI 的 `QG Visual`（基线只能取自同一次 CI 渲染的既有口径），本机不拿截图消化，也不用 `--update-baseline`。
- 其余 28 处自绘站点（含 `Home.vue` 的"取数失败静默落日志"那一类，审计 line 371）留作后续批次；`EmptyState` 侧的 emoji 图标与"13/39 处空态无下一步"（audit-44/47）不在本批面内。

## 第三轮：CI `Gate 12c - Doc abs-path validity` 判红与处置（2026-10-26）

首次 CI 读数：`QG Changes` fail ⇒ `Gate Result` fail。按 step 定位唯一失败步是 **Gate 12c**（文档本机绝对路径存量棘轮），不是组件锁、不是 locale 成对锁。

本地复现（与 CI 同一对参数，`--base` 取 merge-base 而非 `origin/main`，否则会把别人已落地的文件读进我的改动集）：

```
MB=$(git merge-base origin/main HEAD)
node scripts/check-doc-abs-paths.js --base="$MB" --head=HEAD
→ counts=1162 domain=566 files=562 canJudge=true
→ FAIL：openspec/records/ux-audit-error-state.md：1 处 > 基线 0
    L8: <盘符>:/…/mp-worktrees/mp-ux-audit-error-state  └─ 存在（但仍计入新增；计数口径不问存在性）
```

根因：**我在执行记录里抄了本机的 worktree 绝对路径**。这条红是本批独有，不是既有欠账（该文件基线为 0，即门禁认得它此前一条都没有）。

处置按红文案的第一条正解：改写成**约定形态 + 取证锚点**，不调账本、不挂归档豁免。执行记录的可复核性从来不靠某台机器的路径，而靠**分支名 + PR 号**（`git worktree list` 与 `gh pr view 4485` 在任一台机器上都能重取）；写死盘符既泄漏本机文件系统布局，又在换机/协作克隆时立刻变成假事实。

⚠️ 一条判据口径值得记下来，因为"路径存在"极易被误读成可以放行：**存在性不参与计数**。L8 那条路径此刻在本机真实存在，门禁照样计入新增 —— 这正是 v2 换代的目的（v1 只在"路径在本机不存在"时才记，于是 GitHub 的 ubuntu runner 上没有 `C:`–`Z:` 盘 ⇒ 现场读数恒 0 ⇒ 与账本比较两个方向都不可能红）。所以"这条路径是对的、确实存在"不是抗辩，只是它为什么容易被写下来的解释。

复跑：`node scripts/check-doc-abs-paths.js --base="$MB" --head=HEAD` → 该文件不再被点名，rc=0（改动集内新增 0）；`node --test scripts/check-doc-abs-paths.test.js` 与本步同 CI 顺序执行，未改动判据本体。

## 第四轮：QM-6 双模型欠账按门禁出口②收口（2026-10-28）

`check-pr-exec-record --mode=enforce` 曾判 2 条 CCG 深度审查欠账，两条都是**评审引擎侧的状态**，不是本批代码的缺陷：

| 记录 | 原状态 | 复核结论 | 现状态 |
|---|---|---|---|
| `0c64bf77….json` | `error` | critic=claude 真跑过，但模型输出被截断（结尾字符串被砍断，共 5491 字符）⇒ findings 未完整产出。截断片段里那 1 条 Warning 成立，已修且留 A/B 变异读数（详见上节） | `self_play_resolved` |
| `b5a219d6….json` | `pending` | 同一 diff 的**前一次**尝试，未产出任何结论，已被 `0c64bf77` 那一轮取代 ⇒ 不承载风险结论 | `self_play_resolved` |

口径三点必须一起读，否则会把这次收口读成"评审通过"：
1. 本 PR 变更面**不命中** `HIGH_RISK_SURFACES`（不含判据本体 `scripts/check-*`、不含 workflows、不含登录态/凭证面），故适用出口②；若命中，此路不通，只能 `tier=external` + 可核 evidence。
2. 收口依据是「**成立项已修完并取证**」，不是「没发现问题」—— Info 档因截断从未产出，属**未穷举**。
3. `tier` 保持缺席（未声明 external），覆盖率读数 `TIER-COVERAGE … unknown(字段缺席)=N` 里这一档可见；`closureNote` 内写明本行是**会话按出口②手写**、非引擎 writeback。

后续若要求逐轮留痕或穷举 Info 档，正解是重跑 `sh scripts/deep-review.sh` 让引擎自己写 `cleared` / `needs_revision`，而不是继续手写闭环值。

## 第五轮：rebase 后存量棘轮与主干漂移对账（2026-10-28）

rebase 到 `9b65a7cef`（落后主干 111 笔）之后，`QG Desktop Shards (2/2)` 红在**本 PR 自己的**棘轮用例：

```
FAIL src/error-state-convergence.test.js > 逐文件读数必须与登记表逐项相等
存量棘轮不一致：
  video-creation/HiflyExtraPanel.vue：未登记的自绘错误态站点（新增或换了文件名）
  FilmEngineeringView.vue：登记表里的站点已不存在，登记项必须删除
[ERR-RATCHET] files=14 total=21
```

归因（**主干漂移，不是本 PR 的代码被谁改坏**）：主干把该视图拆成 `film-engineering/` 下的若干面板，`FilmEngineeringView.vue` 里原登记的 8 处自绘错误态在拆分后已不存在（实测该文件一处都没有，拆出的面板也没有块级 `error` 类站点）；同一时期主干新增了 `video-creation/HiflyExtraPanel.vue` 的 1 处（`<div class="inline-error">`）。⇒ `28 - 8 + 1 = 21`，与实测 `total=21` 一致。

处置：按「实测即真相」**下调**登记表（删 `FilmEngineeringView.vue=8`、增 `video-creation/HiflyExtraPanel.vue=1`），并把「总存量不得高于 28」的常数同步改成 21。**这不是放宽判据**：该用例本来就逐文件双向对账（少登记一处或多留一条陈旧项都当场红），下调只让表跟着现实走；本机复跑 `error-state-convergence.test.js` ⇒ `Tests 15 passed`，`[ERR-RATCHET] files=14 total=21` 与表逐项相等；连同 `UiErrorState.test.js` 复跑 ⇒ `Test Files 2 passed / Tests 27 passed`。

## CHANGELOG 条目

# 错误态统一第一步：新增 UiErrorState 并把 7 处"失败了但不播报、不给重试"的界面接上它

设置与列表页取数失败时，以前有 35 处界面各自画一块错误提示，其中只有 4 处会让读屏播报、9 处给出重试。本批新增共享错误态组件（失败即播报、必带类型正确的重试按钮、图标不再是 emoji、焦点环齐备），并把性能洞察、作品库、联系表、创作历史（两处）、流水线选择器、快速渲染面板共 7 处接入它；剩余 28 处登记为只能缩小的欠账，由新加的收敛锁逐批收口。
