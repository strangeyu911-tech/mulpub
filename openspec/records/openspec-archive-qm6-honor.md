# 本次执行记录：归档 `qm6-external-review-honor`，主规格新增 `qm6-review-chain` 能力（openspec-archive-qm6-honor，2026-10-27）【docs-only】

- 分支：`openspec-archive-qm6-honor`。**就地编辑共享根**（本机仓库根，写成占位符 `<共享根>` —— Gate 12c 的口径是"执行记录的取证力靠分支名与 PR 号，不靠绝对路径"，别把它"顺手改回"真实盘符路径），不走 worktree：本 PR 只动 `openspec/**`，按 AGENTS「分层判据只看是否影响运行行为」属纯规格/流程变更；共享根写守卫 `scripts/guard-shared-root-writes.ps1` 的放行清单含 `openspec/`，不会把落盘判成违规并回滚（对照：`.quality-rhythm/**` 与根级配置**不在**放行清单里，那一类就地编辑会被静默回滚，须走 worktree）。动手前先 `git merge --ff-only origin/main` 吸收 6 笔上游（落到 `9b782ee9c`），再用 `scripts/session-guard.ps1 -Branch main` 声明 `.agent_context/expected-branch`。
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**必须在 commit 之后取证** —— 未提交时 `HEAD==base` 给空 diff，会得到一句假的 `docs-only=false files=0`）。判定值为 `true`；**files 计数刻意不写死**：本篇记录自身也在白名单内，每编辑一次就自增，逐字读数写在 PR 正文/评论。
- 产物：`openspec/specs/qm6-review-chain/spec.md`（**新建**，6 条 Requirement）+ `openspec/changes/archive/2026-10-27-qm6-external-review-honor/`（四份文件搬家）+ 该 change `tasks.md` 的三条勾账。

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：docs-only 判定 ✅（`classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`，files 计数含本篇自身、每编辑一次自增，逐字读数写在 PR 正文）| 行尾两口径一致 ✅ | 品牌残留 ✅（`check-no-brand-residue.js` rc=0，扫 13336 个 tracked 文件）| 本机绝对路径 ✅（**CI 档**：`check-doc-abs-paths.js --base=790a8528f --head=HEAD` rc=0，改动集 4 个文件无新增；首测 base=`9b782ee9c` 同 rc=0，两档结论一致）| 文档同步 ✅（`openspec-sync-check.js` rc=0：`388 tasks, 131 active changes, 248 archives`，**终基线重取**；首测 130，差因见 §四）| 记录债务 ✅ | 远程同步 由门禁推导

⚠️ **门禁当场拦住了我写进记录的盘符路径**：第一次我用**全量档**（不带 `--base`）跑 `check-doc-abs-paths.js`，rc=1 报「超出存量基线 **23 个文件**」—— 其中 **1 个就是本篇记录**（那句 `就地编辑共享根 D:/...` 的真实盘符路径），另 **22 个是上游已合并的 `01-docs/evidence/film-auto-m0-evidence-2026-10-24/*`**。两条都按口径处置：① 本篇那处改成占位符 `<共享根>`（AGENTS ①「写现场一律用占位符；执行记录的取证力靠分支名与 PR 号」），改完 **CI 档 rc=0**；② 那 22 个属"文档不在本次改动集里的上涨"，按既有口径**归因给 base 并逐项出声**，不在本刀清偿 —— 正解是那几个证据脚本改用占位符，**不是**跑 `--write-baseline` 把新增记进账本（那正是这条判据要拦的形状）。

## 一、账证对账：三条一直挂着未勾的收尾项，逐条实测后才勾

形状与本仓记过的 `tasks 勾选与证据双向脱节` 同一类：**已交付的旧编号项一直挂着未勾**。这次 `qm6-external-review-honor` 的 6.4 / 6.5 / 6.6 三条收尾项在 #4453 合并后没人勾，归档时会被读成"这刀没做完"。逐条证据（现读，不是转述）：

| 项 | 证据出处 |
| --- | --- |
| 6.4 | PR **#4453** `MERGED` / merge `4729a93a0f701fc21f628d42355492e0bade869f`；`--mode=enforce` 的 rc=0 与逐套件 pass 数写在 `pull/4453#issuecomment-6403976344`；合并闸门读数 `MAIN-RED verdict=OK exit=0 … prFail=0 mainFail=0 newRed=0 uncertain=0 unknown=0/0 prPending=0` 在 `#issuecomment-6404423854` |
| 6.5 | `#issuecomment-6406892565`：坐标 `(merge SHA 4729a93a0, workflow quality-gate.yml)`，run `40256876308`，`event=push`，`status=completed` / `conclusion=success`；内容归属判据 `[BRANCH-MERGED] ref=a1288e20d23f against=origin/main@4729a93a0` |
| 6.6 | `git worktree list` 对该 worktree **0 条命中**（清理走 `scripts/safe-worktree-remove.ps1`，`-WhatIf` 先行、R7 对账主工作区与基线一致）；记忆三份在场 —— `qm6-honor-in-repo-landed.md`、`qm6-tier-watermark-slice.md`、`qm6-gate-surface-single-source-slice.md`（后者含「#4261 卡住的 11.7 现由 #4453 派生档打开」，现读该文件内 `11.7` 出现 4 次） |

**刻意不勾**的一条：7.5「把派生收口与产物文件名 = 差量内容寻址重绑定」——它原文就写着"不在本 PR"，是跟进项。归档 CLI 当场打印 `Task status: 45/46 tasks` + `Warning: 1 incomplete task(s) found. Continuing due to --yes flag.`，这条 warning 就是那个未勾项的现场留痕；**不得为了让归档安静而预先勾上**（那正是把未做的事记成已做）。

## 二、被实测否证的一条前提 —— 它当时就写在这件事的工单标题里

工单原话是「归档 `qm6-external-review-honor`（**同 PR 同步 vendored 镜像**）」。实测否证：镜像锁 `scripts/quality-rhythm-spec-mirror.test.js` 的比对真源**写死是** `openspec/specs/openspec-integration/spec.md`（文件头第 3–4 行注释即为此），而本刀归档落进**另一个 capability**（新建 `qm6-review-chain`）⇒ **不联动**。归档前后各跑一次该 test 都是 **8 passed / 0 failed**；此时"顺手同步镜像"反而会凭空制造一次镜像改写。

本仓两个先例正好构成对照（判据是读锁本体那行，不是回忆上一次归档的条件）：落进 `openspec-integration` 的那次归档（#3892）**当场红 Gate 2b2**；落进别的 capability 的两次（#3926 → `quality-gate-execution-record`，以及本刀上游的 `align-shape-lock-empty-ledger-scenario` → 同一能力）**不联动**。

`Purpose` 占位按纪律当场还了：`openspec archive` 只在**新建主规格**时写 `TBD - created by archiving change …`，本刀正是新建，所以要还；还完 `grep -c TBD` = **0**。

## 三、顺手量到的一条 required 面欠账（不属本刀，建账交人工）

#4453 的回读评论当时就记下「`QG Coverage` 这一格是 `skipped` 不是 `success`」，但**没有建账**，只写了"required 清单被满足"。本刀对照实测：最近 **6 次 main push**（含与本刀完全无关的 4 次）里 `QG Coverage` **全部 skipped**，而 `branches/main/protection` 把它列进 required（另一套机制 ruleset `main-ci-gate`(23749994) 列的是 7 个**不同的**名 —— **两套并存，只查其一必得假结论**，这条本仓已记过）。

后果值得写清：一条 required 检查在主干上**恒不执行**，而 GitHub 把 skipped 当满足 ⇒ 整条 run 结论照 `success`，所以它**不会自我暴露**，只会让后来者以为有人在守。处置三选一（让它真跑 / 摘出 required 并说明由哪条替代 / 保持现状但在仓内显式承认）都属改「谁来守门」，**须人工裁决**；agent 不动 GitHub 侧配置，本刀只把它从"评论里的一句话"升格成一条有重取命令的欠账。

重取命令（两套机制并集，`gh api` 按 id 取 ruleset —— `/rulesets` 列表的 `rules` 恒空）：

```
gh api repos/<owner>/rulesets/23749994 --jq '[.rules[].parameters.required_status_checks[]?.context]'
gh api repos/<owner>/branches/main/protection --jq '[.required_status_checks.contexts[]]'
gh api "repos/<owner>/actions/runs/<main-push run>/jobs" --jq '.jobs[] | select(.name=="QG Coverage") | .conclusion'
```

## 四、re-sync：PR 在飞期间主干前进 4 笔，全部读数按终基线重取

开 PR 后 `gh pr checks 4532` 收敛到 0 pending / 0 fail（docs-only ⇒ 重型作业 `skipping`，`QG Changes`/`Gate Result`/`GUI Gate Result` 全 pass），
但 `node scripts/check-main-red.js --pr 4532` 回 **rc=3 `verdict=INCOMPLETE`**，字段是 `baseline=5255d3f5c staleness=4 baseKind=too-stale`。
**这档不是"主干红"，是"读数不可归因"** —— 但本节初版把 `staleness=4` 解释成"我的分支的 merge-base 落后主干 4 笔"，**那句解释不实，原文保留在此以备追溯**。按判据本体 `scripts/lib/main-red.js` 的 `pickBaseline`（`:397` `maxStale` 默认 3；`:420-422` 命中 `i > maxStale` 才返回 `too-stale`）：`staleness` 量的是**从主干 tip 往回回溯到"最近一版有完整结论的 main push 读数"走了几步**，本次是主干侧最近 4 笔都还没有完整结论（hot main 现象：push 密集、重型作业要跑 20 分钟以上）。它与"我的分支落后几笔"是**两个不同的量**，这次数值都是 4 只是巧合 —— 我当时把两者混成了一句。
所以出口仍然是：重新同步 + 等主干侧出现更近的完整读数，**而不是**"看 `mergeable=MERGEABLE` 就合"（squash 会把差量落到更新的 tip 上，产物树可能与 PR 侧不同；本仓 #3652 就是这个成因）：

1. 共享根 `git merge --ff-only origin/main`（→ `790a8528f`，工作树 tracked 部分保持 0 脏）；
2. `git cherry-pick` 把那两笔重放到新 tip（钩子照跑，判定产物按**新的差量内容寻址**重新落盘 —— 重放会换键是机制，不是异常）；
3. **全部读数在重放后的树上再取一遍**：`docs-only=true files=8`、`openspec-sync-check.js` rc=0 但 active changes **130 → 131**
   （上游新开了一个 change，与本刀无关 —— 这正是"引用型计数必须连着基线一起取"这条纪律在本刀的具体作用）、
   镜像锁 **8/8**、`openspec-sync-check.test.js` **20/20**、12c CI 档 rc=0、`check-gate-record-debt.js` rc=0 且 `HAND-CLOSURE 人工改写=0`。

共享根全程停在 `main`：分支指针用 `git branch -f` 重指，再 `git reset --keep origin/main` 把 main 收回；
强推带 `--force-with-lease=<分支>:<远端 tip>`，那个值从 `git ls-remote` 现取，不用记忆（本仓实测 force-with-lease 会被自己的 fetch 合法化）。

## 未闭合清单（逐条点名，不靠下一个会话猜）

1. 上面那条 required / 恒 skipped 的裁决（三选一），**属人工**；重取命令已给在上面。
2. `qm6-external-review-honor` 的 tasks **7.5**（派生收口与差量内容寻址重绑定，原文明写"不在本 PR"）。
3. 归档 CLI 每次都会打的 proposal 格式 warning：`Change must have a Why section … Expected headers: "## Why" and "## What Changes"`。本仓 proposal 用的是自定义小节名，这条**非阻塞**、且与本次内容无关。**没修**：修它要把全仓 130 个在飞/存量 change 的 proposal 标题一起收敛，属另一刀。记在这里是为了让下一个读者知道"这不是我写坏了"，而不是留一条无人认领的假线索。
4. vendored 镜像本刀**不动**（已在第二节实测否证了"必须同步"那句前提）。
5. `01-docs/evidence/film-auto-m0-evidence-2026-10-24/` 下 **22 个脚本**带真实盘符路径、且不在 Gate 12c 账本里（全量档读数 `counts=1192`，CI 档不受影响）。
   正解是把那几个脚本的落盘路径改成占位符或环境变量（先例：`scripts/lib/qm1-paths.js`，PR **#3869** 把"脚本在 `scripts/` 却把 `__dirname` 当 `apps/desktop`"改成从脚本位置向上定位、找不到即 fail closed），**不是**调大账本。重取命令：
   `node scripts/check-doc-abs-paths.js`（不带 `--base` 即全量档，看 `FAIL：… 超出存量基线 N 个文件`）。

## CHANGELOG 条目

# 归档 QM-6 高危复核 honoring 那一刀，主规格新增 `qm6-review-chain` 能力

把 `qm6-external-review-honor`（PR #4453）的六条 Requirement 落进新建的 `openspec/specs/qm6-review-chain/spec.md`，
并勾掉三条"已交付却一直挂着未勾"的收尾项 —— 每条附当场可复算的证据出处（PR 评论号 + 逐字读数），
未做的第 7.5 条保持未勾并留下 CLI 的 `45/46 tasks` warning 作现场留痕。
同时用实测否证了工单里"归档必须同步 vendored 镜像"这句前提：镜像锁的真源写死在 `openspec-integration`，
本次落进别的 capability，归档前后那把锁都是 8/8。
顺手建账一条更大的形状：`QG Coverage` 在 required 清单里，却在最近 6 次 main push 上全部 `skipped`，
而 GitHub 把 skipped 当满足 —— 一条看起来在守、实际永不发火的门禁，且不会自我暴露；处置须人工裁决。
