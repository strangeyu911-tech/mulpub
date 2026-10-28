---
record: fix-publish-failures-20261020
task: fix(publish) 公众号保存草稿「点了没反应」（可信点击 + 请求/拒绝分判 + 草稿箱反查）+ 微博新版首页发布假失败（可信选择器 + 时间线产物证据 + DOM 留证）；本会话承接 fork PR #4081 的 rebase 解冲突、修 CI 红与合并
date: 2026-10-28
delivered_by_pr: 4081
---

## 本次执行记录：修复发布链两处假失败/假成功（fix-publish-failures-20261020，2026-10-28）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/**`、`packages/rpa-engine/src/platform-selectors.js`）⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-pubfail-4081` + 裸分支 `fix-publish-failures-20261020`；共享根（main-only 协调目录）全程只读（停留 `main`，未落文件）；依赖三连 OK（`pnpm install --frozen-lockfile` 1m8s / `ensure-electron.js` v43.7.7 / `verify-worktree-deps.js` 11 项解析到当前 worktree） |
| 冲突真相与 rebase | ✅ | `git merge-tree --write-tree origin/main fork4081/...` = **1 个文件 content 冲突**（`apps/desktop/electron/services/rpa-view-platforms.js`），非 modify/delete、非二进制；任务描述里的「0 条文本冲突」是旧 main tip 的读数。rebase 3 个 commit 全部落上 `origin/main`(88640e1c0)，末 commit `7adff8ce7` |
| 第一性原因（QM-5 ①） | ✅ | ① 公众号：保存草稿的**点击不可信**（`click()` 返回就当下发）+ 成功只看 appmsgid，缺 mediaId 时把「平台没收到请求」与「收到了但没回 ID」混成一句话；② 微博：新版首页发布后**三类信号全不给**（不跳转 / 无成功文案 / `responses=0`）⇒ 真实成功被判失败（假失败比假成功更伤：用户会反复重发）。两处都不是「选择器少写一条」而是**判据缺失** |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：`xhs-draft-false-success` / `xhs-draft-only-hard-evidence` 用**部分 mock 实例**跑 `_publish_generic`，新增的宿主方法在它上面不存在 ⇒ 诊断把主链测试整片打红（CI 实测）；静态层：`QG Static` 的 ESLint 抓到 `_verifyPublishSuccess` 里 `article` 未定义（真机走到微博兜底会抛 ReferenceError）；集成层：微博「发布成功」只能靠真机手测，无自动判据 ⇒ 靠 `QG Desktop Shards` 全量才照出来 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 诊断能力整体下沉为独立模块 `apps/desktop/electron/services/publish-diagnostics.js`（`dumpPublishDom` / `weiboPublishEvidence` / `dumpOnSaveFailure`），主链只留一行调用 ⇒ 宿主 mock 不再被打断；② `publishContext` 带上 `content`，微博证据按 `{title, content}` 取（原来只带 title ⇒ 正文探针恒缺席，且裸 `article` 未定义）；③ `App:bridge-skipped` 登记进 `observability-messagekey.test.js` 允许清单（新增可观测事件必须可核）。回归锁：新增 `apps/desktop/electron/services/publish-diagnostics.test.js`（17 例：探针来源、命中/未命中、过短不触页面、异常按 false、按 detail 才留证、接线锁、以及 `_verifyPublishSuccess` 走微博兜底必须 resolve 的端到端锁） |
| 变异反证 | ✅ | 把接线改回 `weiboPublishEvidence(this, win, article)`（即原始缺陷形态）后跑同一条命令：**3 条红**（接线锁 + 微博兜底 resolve + 缺 content 不抛），红文案原文 `ReferenceError: article is not defined`，`Tests 3 failed \| 14 passed (17)`，rc=1；改回后 `17 passed`，rc=0 |
| 自测（真跑） | ✅ | `vitest run electron/services/publish-diagnostics.test.js` → 17 passed；`electron/tests/xhs-draft-false-success.test.js` + `xhs-draft-only-hard-evidence.test.js` → 22 passed；`electron/services/observability-messagekey.test.js` → 36 passed；`publish-diagnostics.test.js` + `rpa-view-platforms.test.js` + `wechat-mp-draft-mediaid.test.js` 合并跑 → **3 files / 119 passed**，rc=0；`pnpm exec eslint electron/ src/ --quiet` rc=0 |
| 行数门禁（重锚 targets） | ✅ | 见「四、行数门禁」：红文案原文 + 重锚依据 + 修后 rc=0 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat origin/main` 与 `--ignore-cr-at-eol --numstat` 对 `rpa-view-platforms.js` 两口径同为 `26 4`；本批新增文件一律 LF；删除的 4 行全部是「旧写法被新写法取代」的等价替换（见 §一 逐 hunk） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` 读数见 §五；新增 `publish-diagnostics.test.js` 落在 `apps/desktop` 的 vitest 收集域内 |
| QM-1 打包 | 见 §六（如实登记） | 本批触碰 `apps/desktop/electron/services/**` 与 `packages/rpa-engine/src/**`，按 QM-1 应做打包三层判据；本会话的读数与缺口见 §六 |
| QM-4 视觉回归 | N/A | 未触碰渲染端（`apps/desktop/src/**` 零改动） |
| QM-6 CCG 双模型外部评审 | ✅（出口②） | 见「五、QM-6」：按用户已授权的出口②收口，状态 `self_play_resolved`，`tier` 保持缺席，`closureNote` 含轮次标记 + 逐条处置 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（只认 squash 尾注 `(#4081)`）；本 PR 的 head 在 **fork**（`strangeyu911-tech/mulpub`），`origin` 侧本无同名分支，故收尾判据改为「fork 侧 0 行 + origin 侧本来就没有」 |

## 一、冲突真相与 rebase 处置（逐 hunk）

`git merge-tree --write-tree origin/main fork4081/fix-publish-failures-20261020` 输出 `8b1a75c6…` + 一行冲突文件，退出码 1 —— 是 **CONFLICT (content)**，不是 modify/delete，也不是二进制。rebase 时分两次命中同一文件：

| 命中处 | 主干侧（origin/main） | 分支侧 | 处置 |
|---|---|---|---|
| commit 2「微博选择器 + DOM 留证」· 正文编辑器落空 | 带 `fillReport.content` 守卫（避免覆写已成功的正文） | 无条件赋值 + 立即 `dump` 页面 | **两侧保留**：先 `dumpPublishDom` 留证，再走主干的守卫赋值 |
| commit 2 · 发布按钮全部候选落空 | 视频号 `publishSelector='body'`（shadowRoot）+ `clickPublishTencent` 下沉 + **统一开启** networkCapture（2026-10-23 注释：头条曾置 null ⇒ `responses=0` 无法区分「没发请求」与「没在听」） | `dump` 后 throw，且把头条置 `networkCapture=null` | **取主干** + 保留分支的 `dump`：分支侧「头条置 null」已被主干 2026-10-23 那条取代，保留它等于回退一次已修的真缺陷 |
| commit 3「公众号草稿」· 保存草稿调用 | `saveWechatMpDraft(this, win)` | `saveWechatMpDraft(this, win, { title })` | **取分支**：本 PR 同批把该模块改成 `(host, win, options)` 且 `options.title` 是「响应无 mediaId 时按标题反查草稿箱」的开关（主干版本读不到标题 ⇒ 反查恒不触发） |

## 二、失败 check 分类（最新 head 的读数，run 39401204572 等）

| 失败 check | 分类 | 根因 | 处置 |
|---|---|---|---|
| `依赖漏洞审计` | **全局** | deepmerge 新公告 GHSA-gcqx-w48m-w2h4，由队友在 #4452 修 | 不改本支；主干合入后 rebase 一次 |
| `QG Static` | **本 PR 真缺陷** | ESLint `rpa-view-platforms.js:952 'article' is not defined no-undef` | 已修：`publishContext` 带 `content`，模块按上下文取 |
| `QG Desktop Shards (1/2)` 4 红 / `(2/2)` 1 红 | **本 PR 真缺陷** | `this._dumpPublishDom is not a function` 打红两个 xhs 测试（部分 mock 实例）；`observability-messagekey` T6.1 两条：`App:bridge-skipped` 未登记 | 已修：诊断下沉为模块函数（不再依赖宿主方法）+ 登记允许清单 |
| `QG Coverage` / `Gate Result` / `债务熔断检查` | 下游 / 行数门禁 | Coverage 与 Gate Result 是上述红的下游；债务熔断是**行数门禁**（见 §四） | 见 §四 |

## 三、修复的形态与理由

1. **为什么把诊断「下沉」而不是「给宿主方法加守卫」**：`_dumpPublishDom` 写在 `platformsMixin` 上，任何用**部分 mock 实例**跑 `_publish_generic` 的测试都会在它身上得到 `TypeError`。加 `typeof === 'function'` 守卫能让测试变绿，但那会把「诊断静默不执行」变成合法状态 —— 与本次要修的「静默判失败/静默留空」同型。下沉后它是模块函数，调用点不依赖宿主形状，行为面与可测面同时成立。
2. **`content` 必须进上下文**：微博证据的判据是「时间线里某个『刚刚』之后 400 字符内命中本次标题前 10 字**或**正文前 12 字」。只带 title 时正文探针恒缺席 ⇒ 只剩半条判据（标题短的微博会漏判）。
3. **`App:bridge-skipped` 必须登记**：这个测试的存在意义是「任何新增可观测事件都要有人登记」——不登记时它红，登记就是设计里的扩展路径（不是放宽判据）。

## 四、行数门禁（同 PR 重锚 targets，按 change #4337）

**红文案原文（CI）**：
```
❌ TARGET_GREW: apps/desktop/electron/services/rpa-view-platforms.js 现 1564 行已超过点名目标 1484 行（超 80）。
  被点名还账的文件一律零增长容差：降到目标以下，或在 review 中说明理由后一并上调 targets
```
**本会话先在本地复现的红文案原件**（下沉前，main 已把目标重锚到 1499）：
```
❌ TARGET_GREW: apps/desktop/electron/services/rpa-view-platforms.js 现 1580 行已超过点名目标 1499 行（超 81）。
```
**下沉后仍红（这才是重锚的对象）**：
```
❌ TARGET_GREW: apps/desktop/electron/services/rpa-view-platforms.js 现 1518 行已超过点名目标 1499 行（超 19）。
```

**为什么这 23 行是实际增长（逐项点名，不许「无关漂移」）**：主干该文件 1495 行、目标 1499 行 ⇒ 余量 4 行。本 PR 原始净增 **85** 行（1580）。先做了一轮**下沉**：把「页面结构留证 + 微博产物证据」两项只读诊断整体搬到 `publish-diagnostics.js`（−62 行，与 2026-10-26 视频号点击链下沉 `tencent-publish-hooks.js` 同型），净增降到 **23**（`git diff --numstat origin/main` 为 `+26 / −4`）。余下 23 行逐项：

| # | 内容 | 行数 |
|---|---|---|
| ① | 微博产物证据接线：`_verifyPublishSuccess` 分支 7 行（本身即本次交付的判据） | +7 |
| ② | `publishContext` 带 `content`（含 1 行理由注释，−1 旧行） | +1 |
| ③ | 正文编辑器落空留证（1 行注释 + 1 行调用） | +2 |
| ④ | 发布按钮全部候选落空留证（块化，−1 旧行） | +4 |
| ⑤ | `saveWechatMpDraft` 传 `title` 供草稿箱反查（2 行注释，调用行等价替换） | +2 |
| ⑥ | 存草稿失败的 `saved.ok` 块化 + 「按 detail 才留证」（−1 旧行） | +4 |
| ⑦ | 诊断下沉点的指向注释 | +2 |
| ⑧ | 删除的 4 行：旧 `_publish_generic` 单行 throw、旧 `saveWechatMpDraft` 单行调用、旧 `if (!saved.ok) return …` 单行、旧 `publishContext` 单行 | −4 |

⇒ 判据计数 `1518`，与「采信当场读数、不给余量」的口径一致：`targets["apps/desktop/electron/services/rpa-view-platforms.js"]` 1499 → **1518**，`register.files` 保持 1422 不动（不放松 LEDGER_GREW 的 200 容差），条目未删、其它 targets 未动。

**修后读数**：
```
[max-lines] domain=13655 (git 索引 ∪ 未忽略的未跟踪文件)
=== 逐文件行数门禁 ===
limit=500 growthAllowance=200 超限文件=93 挂账=93 墓碑=7 点名还账=20
testLimit=1500 测试超限=13 测试挂账=12
✅ 无新增超大文件，挂账清单与现实一致。
rc=0
```
还债路径不变：把各平台发布实现拆到 `rpa-engine` 独立模块（与 `toutiao-direct-bridge` 同型），而不是回退判据。

## 五、QM-6（出口②收口，仅非高危面）

本会话的评审面是「接手 fork PR 后的自审 + 变异反证」，不是外部双模型；按用户已授权的**出口②**收口：

- **第 1 轮**：命中 2 项成立缺陷 ——（i1）`_verifyPublishSuccess` 内裸 `article`（真机走微博兜底即 `ReferenceError`）；（i2）诊断写成宿主方法后用部分 mock 实例跑 `_publish_generic` 得到 `TypeError`，把两条 xhs 主链测试整片打红。两项**均在本支修完并取证**（消失式修复 + `publish-diagnostics.test.js` 17 例 + 变异反证 3 红）。
- **第 2 轮**：复核「修复是否引入新面」—— 新增模块不 require 任何发布链方法、只读不写、异常一律吞成 `false`/warn；接线锁要求主链三个调用点必须经模块（`this._dumpPublishDom` / `this._weiboPublishEvidence` 出现即红），无未闭合项、无 follow-up 登记。
- 结论：`status` 由会话按出口②手写为 `self_play_resolved`，`tier` 保持缺席（不伪造成 `external`）；`closureNote` 含轮次标记（第 1/2 轮）与逐条处置词（已修 / 驳回 无 / 无 follow-up）。
- 高危面判断：本次变更集**未**命中 `.github/workflows/**`、`scripts/check-*`、`scripts/deep-review*`、`scripts/ccg-review-*`、凭证/登录态前缀；`scripts/check-*` 判据本体零改动。唯一触到门禁数据面的是 `.github/scripts/max-lines-baseline.json` 里**一条 targets 值**的重锚，该路径不在 `HIGH_RISK_SURFACES` 前缀上（清单是 `.github/workflows/` 段起点，不含 `.github/scripts/`），故仍属非高危面。

## 六、QM-1 打包（如实登记，不假装）

本批触碰 `apps/desktop/electron/services/**` 与 `packages/rpa-engine/src/**`，按 QM-1 应给三层读数（asar 清单 / require 链 / 8 秒启动 + stderr 三分档）。本会话的取舍与缺口：

- 已做：`node scripts/ensure-electron.js`（v43.7.7 就绪）+ `node scripts/verify-worktree-deps.js`（11 项 workspace 解析到当前 worktree，OK）；`pnpm exec electron-builder --win --dir --publish never` → `rc=0`，产物 `dist-electron/win-unpacked/`（app.asar 151310832 字节）；`pnpm exec asar list` 里能看到本次新增的 `\electron\services\publish-diagnostics.js` 与既有 `\electron\services\logger.js`；解包后 `node -e "require('<extracted>/node_modules/@multi-publish/rpa-engine'); require('<extracted>/electron/services/publish-diagnostics.js')"` → `REQUIRE-CHAIN OK`，rc=0。
- 未做（缺口，不得当成通过）：真机 8 秒启动 + stderr 三分档需要桌面会话与共享用户数据，本会话不跑 GUI，**不声称 QM-1 通过**。
- 风险面如实评估：本批新增的是一个**无副作用的纯诊断模块**（只读页面 + 写日志）与两处一行级接线；没有新增 `require` 依赖、没有新增 native 资源、没有改 preload/asr 打包清单。CI 侧 `electron-tests` / `QG Desktop Shards`（各 526+ 测试文件）与 `build` 覆盖了加载与行为面。

## 遗留（不假装已闭合）

- `依赖漏洞审计` 的红来自全局 deepmerge 新公告（#4452 承接），本支不改 baseline；主干合入后 rebase 一次即消失。
- QM-1 的真机三层判据未在本会话执行（见 §六）；合并前如需，应由具备桌面会话的会话补读数。
- `rpa-view-platforms.js` 仍 1518 行、仍挂账待还；本 PR 只解决「本次增量」的重锚，还债路径见 §四末。

## CHANGELOG 条目

# fix(publish): 公众号保存草稿点不动与微博发布假失败（fix-publish-failures-20261020）

- 公众号：保存草稿改为「可信点击 + 请求是否真的发出」分判；响应里没有 mediaId 时按标题反查草稿箱，避免把「平台没收到请求」写成「找不到媒体 ID」这种误导用户的文案。
- 微博：新版首页发布后平台三类信号全不给，原先会把**真实成功**判成失败（用户反复重发 ⇒ 账号出现重复微博）；补一条只读的时间线产物证据（「刚刚」+ 本次标题/正文片段）作为第四条判据。
- 发布链失败时把页面**真实结构**摘要（正文区/按钮/文件输入 + 正文前 160 字）打进日志：平台改版时旧选择器静默全落空，没有这份摘要就只能继续猜。
- 发布链的两项只读诊断下沉为独立模块 `publish-diagnostics.js`：宿主 mock 不再被 `TypeError` 打断，回归锁 17 例 + 变异反证 3 红。

## learnings

### lesson: 诊断能力写在宿主对象上，会把「部分 mock 实例」变成 TypeError

**现场**：PR #4081 把 `_dumpPublishDom` / `_weiboPublishEvidence` 加在 `platformsMixin` 上，CI 的 `QG Desktop Shards 1/2`、`2/2` 各报 `TypeError: this._dumpPublishDom is not a function`（`xhs-draft-false-success.test.js` / `xhs-draft-only-hard-evidence.test.js` 用只 mock 了少数方法的实例跑 `_publish_generic`）。同一支里 `_verifyPublishSuccess` 还调了一个该作用域根本不存在的 `article`，ESLint `no-undef` 抓到而 ESLint 之外没有第二处会响。

**根因**：「诊断」被当成宿主能力，于是它的可用性跟调用点的 `this` 形状绑死；而测试里的 `this` 是**部分 mock**。守卫（`typeof === 'function'`）能让测试变绿，却把「诊断静默不执行」变成合法状态 —— 与本批要修的「静默判失败」同型。同理，`article` 未定义能被 ESLint 抓住，是因为 ESLint 看的是**作用域**；任何只测「函数被调用了」的测试都看不见它。

**可复用的 3 条**：

1. 纯读的旁路能力（留证/取证/证据探针）应做成**模块函数**，参数显式传入；绑在宿主对象上等于把它的可用性外包给调用点的 `this`。
2. 「新增能力」的回归锁要打**真回归**：跑一遍会经过它的端到端路径（本批是 `_verifyPublishSuccess` 走微博兜底），再拿变异反证确认锁会红；只断言「函数存在」的锁在 `ReferenceError` 面前全绿。
3. 行数门禁点名还账的文件（零增长容差）里加功能，先想**降到兄弟模块**（本仓已两次同型：`tencent-publish-hooks.js`、`publish-diagnostics.js`），再谈重锚 targets；重锚只允许「恰好等于当前行数」且必须逐项点名增量来源。