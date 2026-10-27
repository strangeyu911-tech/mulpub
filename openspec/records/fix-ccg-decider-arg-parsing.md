# 执行记录：判定器参数形态与退出码档位（fix-ccg-decider-arg-parsing）

| 远程同步 | 由门禁推导 |
|---|---|

- 本 PR：#4488（状态列不手写状态词；合并后收口由 scripts/lib/merge-ledger.js 按主干历史推导，见 AGENTS「旧载体冻结」与 change gate-record-sync-derived-status）

- 日期：2026-10-26 ｜ 分支：`fix-ccg-decider-arg-parsing`（复用已合并工作区 `mp-ux-audit-unwired-components`，从 `origin/main` 新建；旧分支留 `retire/ux-audit-unwired-components-20261026`）
- 关联：任务 #40；同日两次现场复现（PR #4487 提交前跑 decider 得「未判定：origin/main...HEAD 为空」并 rc=0，随后 `deep-review.sh` 报「未找到判定记录 ⇒ 跳过深度审查」也 rc=0）
- 变更性质：`scripts/` 判据本体 ⇒ 混合 PR（非 docs-only），且命中高危面前缀 `scripts/ccg-review-`

| 步骤 | 状态 | 证据 |
|---|---|---|
| 根因（QM-5 ①） | ✅ | 参数解析只有 `argv.indexOf("--base")` + 取下一个 token ⇒ **`--base=<rev>` 等号形态被静默忽略**（`base=null`），调用方随即落回「暂存区」路径；同时三条「未判定」出口（显式基准读不到 / 显式基准差量为空 / 参数不认）一律 `return 0`，与「判定完成且无需阻断」同码。 |
| 逃逸分析（QM-5 ②） | ✅ | 单元：既有 76 条只测空格形态与措辞（`assert.match(out, /未判定/)`），**没有一条看 `r.status`** ⇒ 退出码档位对测试完全不可见；集成：pre-commit 与 `deep-review.sh` 都只看 rc，于是「跳过审查」在链上被读成「已审」；审查：AGENTS 已有「判成败一律用 rc + 产物校验」「参数不得静默忽略」两条通则，但这条判据本体没落实。 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=**测试质量不足（只断措辞不断档位）+ 判据自指面缺反证**。同族即本仓反复记的「装饰性门禁」：判据存在且不报错 ≠ 判据在跑。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 单点旗标读取实现 `flagVal(name)`：`--name value` 与 `--name=value` 同效；空值旗标（`--base=`）不再被当成未传。② 未知旗标一律点名并 **rc=2**。③ 退出码三档写进文件头注释并在红文案里出声：`0`=判定完成/无显式域常态、`1`=判定完成需阻断、**`2`=判据自身没跑成**。④ 显式 `--base` 读不到或差量为空 ⇒ rc=2。⑤ 新增 6 条 `node --test` 用例（已接 CI Gate 2c4，无需 workflow 改动），含**反向对偶**：pre-commit 常态（无参数、空暂存区）必须仍 rc=0，否则每次提交都被阻断。 |
| 防止再次发生（QM-5 ⑤） | ✅ | 档位区分由断言 `r.status` 机械守住（措辞断言不能替）；`KNOWN_FLAGS` 是唯一旗标清单，加旗标不登记即被自己的未知旗标判据打回；反证已实跑（见下）。 |

## 反证与实测读数

- `node --test scripts/ccg-review-decider.test.js` ⇒ **tests 76 / pass 76 / fail 0**（含本批新增 6 条，耗时 68.7s）
- 变异 A/B：只把基准解析退回旧 `argv.indexOf("--base")` 形态 ⇒ `--test-name-pattern="残余2续"` 报 **fail 1**（正是「两种写法都必须生效」那条）；还原后 **fail 0**。⇒ 这条锁确实测的是"等号形态"这一变量，不是顺手红。
- 现场成因复现（本批开工前）：decider 在 `HEAD == origin/main` 时打印「未判定：origin/main...HEAD 为空」并 **rc=0**；`deep-review.sh` 因找不到判定记录打印「跳过深度审查」并 **rc=0**。修复后这两格分别是 rc=2 与「未找到记录」，两者都不再被读成"审过了"。
- 未做：不改 `deep-review.sh`（它"找不到判定记录 ⇒ 跳过"的档位问题已另记 [[project-qm6-deepreview-sha-key-skip]]），不在本批扩到该文件；不改 pre-commit 钩子本体。

## QM-6

`scripts/ccg-review-` 属高危面前缀 ⇒ 收口矩阵只认 `deepReview.tier=external` + 可核证据，而 `tier` 目前无生产写入方（须会话手写并注明）。本批**不**自行填 `tier`/`status`：判定与评审产物随 PR 落 `.ccg/reviews/`，闭合交人工（任务 #19）。

## CHANGELOG 条目

# 判定器不再把「没判定」说成「判过了」：`--base=xxx` 等号写法生效，未判定改独立退出码档

`ccg-review-decider` 以前只认 `--base <rev>` 这种空格写法，写成 `--base=origin/main` 会被静默丢掉，于是判定落回「暂存区为空」并打印一句「未判定」后返回 0；补跑深度审查的链条因此把「从未判过」读成「判过且无需审查」。现在两种写法同效，未知旗标与空值旗标一律点名并返回 2（判据自身故障档），显式给的基准读不到或差量为空也返回 2；pre-commit 的常态空暂存区仍返回 0，以免每次提交都被阻断。


## 合并闸门读数与"这条 PR 我不自动合"的理由（2026-10-26）

机械闸门当场读数（全部实跑，不引用历史）：

- `gh pr view 4488` ⇒ `mergeStateStatus = CLEAN`；`gh pr checks 4488` ⇒ 零 pending、零 fail（`gui-test` 因 docs 短路 `skipping`）
- `node scripts/check-main-red.js --pr 4488` ⇒ `MAIN-RED verdict=OK exit=0`，`mainFail=0 prFail=0 newRed=0 uncertain=0 prPending=0 baseKind=green`
- `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` ⇒ `OK: 本 PR 携带执行记录或带原因的豁免`
- `node scripts/ccg-review-decider.js --base origin/main` ⇒ `SINGLE`（变更 124 行 ≤ 200，无敏感命中）

**仍不合并的那一格**（AGENTS.md 判据第 5 条，agent 自查）：本 PR 改的正是"判定要不要外部评审"的那段代码，而我现在能拿到的"不需要外部评审（SINGLE）"这个结论，**是被我正在改的这段代码算出来的**——自指。`HIGH_RISK_SURFACES` 把 `scripts/ccg-review-` 列为高危面，收口矩阵对高危面只认 `tier=external` + 可核 `evidence`；而 enforce 之所以 RC=0，是因为**变更集里根本没有判定产物**（green-by-absence），不是"审查过了"。补跑真评审这条路我也当场试过并**如实失败**：`~/.claude/skills/adversarial-review-loop/` 与 `~/.qoder-cn/skills/` 下 `ccg-deep-review.js` / `model-call.js` 已 0 命中（引擎不在本机），`codeagent-wrapper.exe` 在位但无人可调；装它属第三方执行体 + 消耗外部配额，要先得到人工许可。

### 本批刻意不做：上游那格失明（登记为任务 #44，附三条候选设计）

上面的 green-by-absence 不是巧合，是**同一条 PR 链最上游的失明**：`scripts/ccg-gate.js:294` 在 `resolveCcgDir()` 拿不到 CCG（`run_skill.js`）时打印「未找到 CCG…已跳过 CCG 门禁」并 **return 0**。同一个函数已经给另外两类自故障建了正确档位（未知门禁名 ⇒ 2、显式目标不存在 ⇒ 2），唯独"引擎整个不在"这档放行。今日现场：我在 #4483 / #4485 / #4487 三个 worktree 各提交一次，三次 pre-commit **都**走了这句 rc=0 ⇒ 判定产物一条没生成。

⚠️ 顺手记下第二格：**手动补跑的产物不在判定域里**。我为了拿读数手动跑了 decider，它写出 `.ccg/reviews/e983a776….json`，但那是一个**未跟踪文件**——不 commit 就永远不在这次变更集里，于是"有产物"与"产物在 PR 里"是两件事，而现有链条只看后者。这一格不写在记录里，下一个会话会以为自己"已经补过评审"。

为什么不在本批直接把它改成 `return 2`：那会锁死所有未装 CCG 的会话与 CI runner 的每一次提交（本机与 GitHub runner 现在正是这个状态）。这是 liveness 代价，与本仓「主干红闸门的 liveness 代价」同型——**先把"失明"与"违规"分档，再把失明变成有产物的登记**，而不是把失明升成阻断。三条候选设计与各自代价写在任务 #44：① 失明即写 `pending + reason:"engine-missing"` 产物（诚实，代价是每个未装引擎的仓库都红）；② 只在显式要求 QM-6 的调用形态下 return 2，其余仍 0 但把后果打印出来（零 liveness 代价，代价是默认路径仍沉默）；③ 把"有无判定产物"升为 enforce 的独立一档 `UNVERIFIED`（最贴近本仓既有口径，但要动判据本体，属「改谁来守门」，须人工过目）。本批**一条都不自选**，交回人工点名。
