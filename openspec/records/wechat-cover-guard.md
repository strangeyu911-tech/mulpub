---
record: wechat-cover-guard
task: 公众号「有配图、无封面」不再漏补封面（封面独立字段平台单列清单）
date: 2026-10-28
---

## 本次执行记录：公众号「有配图、无封面」不再漏补封面（wechat-cover-guard，2026-10-28）

> 分支 `wechat-cover-guard`，隔离 worktree `<worktree-root>/mp-worktrees/mp-cover-guard`；共享根 `<repo-root>` 全程只读。
> ⚠️ 本分支**内含 `fix-publish-cover-url`（PR #4074）的提交副本**（作者为避开同段逻辑逐字冲突而基于该分支起），
> 因此本 PR 必须**在 #4074 合入之后**再 rebase 落地：落点会让「有封面无配图」那半由主干承接，本 PR 只留
> 「有配图无封面」的增量。rebase 后重复 hunk 丢弃（不在本 PR 重复承担 #4074 的改动）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时（renderer composable `usePublishFlow.js` + 既有 autocover 测试）；隔离 worktree `<worktree-root>/mp-worktrees/mp-cover-guard` + 裸分支，共享根未落盘 |
| 第一性原因（QM-5 ①） | PASS | 自动封面兜底把 `!hasImages` 当成**整块前提**：`if (isTextImagePublish && title && !hasImages)`，于是「正文带图 + 封面字段为空」两个分支都不进 ⇒ 封面恒空。公众号封面是**必填且独立**的字段（草稿 `cdn_url` 五槽位），平台**不会**把正文配图自动取作封面 ⇒ 落到后台是「草稿保存成功、但缺封面无法直接发表」（2026-10-20 读书笔记即此形态） |
| 逃逸分析（QM-5 ②） | PASS | 既有 autocover 用例只覆盖「无图无封面 ⇒ 生成」「有封面无图 ⇒ 复用」「有图 ⇒ 不生成」三格，「有图 + 无封面」这一格**从未断言**；且该分支的前提条件写在一行 `if` 里，读代码时「有图」会被当成「封面已有」 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 `INDEPENDENT_COVER_PLATFORMS = ['wechat_mp']`，把「封面必须由独立字段提供」与「首图即封面」两类平台分开：已有配图时公众号**仍补封面且只落封面通道**（`alsoAsImage:false`，不覆盖用户已选配图），小红书/快手/抖音/头条维持 2026-10-12 初衷不生成；生图 + 落值收敛为单一实现 `generateAndApplyCover({ alsoAsImage })`，顺带修掉 `normalizePublishFile` 返回空时**静默无进度**。回归锁：`usePublishFlow.autocover.test.js` 10 → **12 例**；变异两道各自指名变红、红集互不相同（M1 清空 `INDEPENDENT_COVER_PLATFORMS` ⇒ 红 2 条；M2 `alsoAsImage` false→true ⇒ 只红 1 条） |
| 防止再次发生（QM-5 ⑤） | PASS | 「封面通道 ≠ 配图通道」与「两类平台分野」写进代码注释；`generateAndApplyCover` 单点实现避免两条分支各抄一遍生图与失败出声（否则漂移表现为「一边出声一边静默」） |
| 测试 | PASS | rebase 落定后复跑 `apps/desktop` vitest：`usePublishFlow.autocover.test.js` **12 passed**、`usePublishFlow.test.js` **82 passed**（合计 **94 passed / 2 文件**） |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **逐行相等**（rebase 落定后 4 文件：59/0、29/2、49/21、54/0） |
| 接线棘轮 | PASS | 本 PR **未新增** `*.test.js`（只改既有 `usePublishFlow.autocover.test.js`），由 `apps/desktop` 的 vitest 在 Electron CI「Unit tests (Vitest)」收集 |
| 债务熔断（max-lines） | PASS | `MP_BASE_REF=origin/main node .github/scripts/check-max-lines.js` **rc=0**。本分支原先内含 `rpa-view-platforms.js` 那段（#4074 的副本，+15 行）会撞零增长目标 1499；#4074 落地后 `git rebase --onto origin/main 9a4a06c30` 丢弃该重复提交，实测该文件与本 PR **已无关系**（blob 与 `origin/main` 逐字节相同），`max-lines-baseline.json` 未改动 |
| QM-1 打包 / QM-4 视觉 | QM-1 由 CI 实证 / QM-4 N/A | 触及 `apps/desktop/src/**`（渲染层）：QM-1 由本 PR 的 `Build & Release` job（`electron-builder --win --x64 -p never` + `check-asar-test-files.js` 两通道）实证；QM-4 不适用（无视图/样式改动，只改发布流程里的封面补全逻辑） |
| QM-6 CCG 双模型外部评审 | 未执行（tier 缺席，如实登记） | 本机无 `codeagent-wrapper`，`sh scripts/deep-review.sh` 未跑；变更面为发布链渲染层，**不含** `scripts/check-*` 判据本体、`.github/workflows/**`、`CI_IGNORED_PATHS`、闭环状态白名单。不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史（squash 尾注 `(#4206)`）推导；合并前不写状态词 |

### 遗留（不假装已闭合）

- **未做真机发公众号**：本刀解决的是「有图无封面」的补封面路径，单测覆盖了「只落封面通道、不覆盖配图」，但没有真机跑一次「正文带图 + 无封面 → 草稿箱里有封面」的端到端确认（对外发布动作未获授权）。
- 顺序依赖：本 PR 的 diff 在 #4074 落地前含其副本；两者**不可并行合并**，否则重复承担同段改动。

## CHANGELOG 条目

# fix(publish): 公众号「正文带图、封面为空」不再漏补封面（wechat-cover-guard）

- 公众号封面是必填且独立的字段，平台不会拿正文配图当封面；此前「正文带图 + 封面为空」的文章两个兜底分支都不进，落库后是「草稿保存成功但缺封面、无法直接发表」。
- 现在按平台分两类：「封面必须由独立字段提供」（公众号）已有配图仍补封面、且只写封面通道不动用户选的配图；「首图即封面」的平台（小红书/快手/抖音/头条）维持原有「有图不重复生成」。
- 封面生成与落值收敛为单一实现，避免两条分支各写一遍生图与失败提示而在漂移时出现「一边出声一边静默」；封面文件解析为空时不再静默。

## learnings

### lesson: 复合前提里的「豁免」只对一类平台成立，就不能写在共同前提上

**现场**：`usePublishFlow.js` 的自动封面兜底把 `!hasImages` 写进整块的入口条件；2026-10-20 读书笔记（正文带图、封面字段空）既没生成封面也没复用，落库后缺封面。

**根因**：`!hasImages` 的真实语义是「首图即封面」这一类平台的省调用豁免，被当成了所有平台的共同前提。公众号的封面是独立字段（平台不取首图），所以「有图」不能免除它的封面义务。

**可复用的 N 条**：

1. 当一个条件只在**部分平台/分支**上成立时，它必须下沉到那份清单里（这里是 `INDEPENDENT_COVER_PLATFORMS`），不能留在共同入口——否则新增成员的默认行为会静默错。
2. 同一段逻辑里两条分支做同一件事（生图 + 落值 + 失败出声）就必须收敛成一处带参数的实现：漂移的形式通常是「一边有提示、一边静默」。
3. 平台能力差异要能一眼看出是「字段通道」差异：封面通道（`cover_path`/`cover_file`）与配图通道（`image_files`/`images`）互不代偿，判定两张表的成员资格比写成一行 `if` 更可审。
