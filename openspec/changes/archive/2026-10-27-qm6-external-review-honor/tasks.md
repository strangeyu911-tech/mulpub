# 任务：把外部复核 honoring 搬进仓内判据

> 约定：每个「锁」条目必须写明**测什么**与**摘掉实现时红在哪一条**；标 `[红]` 的条目属 TDD 先见证变红，
> 标 `[M]` 的属变异反证，逐条实跑并把红集记进 design.md 的处置节。

## 1. 真源模块

- [x] 1.1 新建 `scripts/lib/ccg-external-review-honor.js`：零 require / 零 I/O / 零环境读取；
      导出 `HONORABLE_BLOCKING_REASON`、`DERIVABLE_CLOSURE_STATUS`、`HONOR_REJECTIONS`（闭集，供锁遍历）、
      `honorRejection({ deepReview, record, expectedCritic, boundEvidence })`
- [x] 1.2 文件头注释写明：为什么搬进来（仓外副本 mtime 对照 + 「谁换掉它仓内零痕迹」）、
      强度边界（形状 + 就地重算，不联网核真，与 `delivery@` 同级）、以及「不依赖引擎是否配合」那句的**依据**
      （现网引擎 `:380` `findings: adj.items` 原样透传，实测两处 `finalizeAdjudication` 同路径）
- [x] 1.3 新增 `scripts/ccg-external-review-honor.test.js`（纯函数判据表，逐格红因）：
      正例 + 规格 §二 Scenario 列出的每一格各一条负例（`status-ineligible`（七档 status 逐个）/
      `blocking-absent`（缺席·null·非数组·空数组四档）/ `unhonorable-reason`（混合、全 upheld、大小写变体三格）/
      `item-absent` / `item-ambiguous` / `review-absent` / `review-incomplete`（逐格点名）/
      `self-refuting` / `backend-unmatched`（含期望值为空与非字符串）/ `evidence-form` / `evidence-unbound` /
      `reviewed-at-unparsable` / `upheld-assertion`（i4：verdict=upheld 的高危项不得被解除）/
      `honor-verdicts-incomplete`（i8：带前缀，与 ③ 的同名红因分开）/ `rationale-duplicated`（轮 1 i1）
- [x] 1.3b 正例必须含"两条共享同一 URL 但 rationale 不同 ⇒ 通过"那一格，
      否则 1.3 那条负例可以被实现写成"任何时候都不许共享"（更严但不是本刀口径，会把现实形态判红）
- [x] 1.4 `[红]` 先写 1.3 的**全部**负例并跑到「模块不存在 ⇒ 加载失败/红」，再实现转绿；
      红集逐条记入 §6 处置节
- [x] 1.5 一条「判定表完整性」锁：`HONOR_REJECTIONS` 的每个成员都 MUST 至少被一条用例命中
      （防"实现里有一条永远点不到火"的分支），并带**规模下界**（成员数 ≥10，否则清单被掏空时召回锁空转）
- [x] 1.6 纯函数锁：模块内不得 require 本地模块、不得触 `fs`/`child_process`/`os`/`path`、不得读 `process.env`，
      且 `module.exports` 的键集合 MUST 逐字等于 `{HONORABLE_BLOCKING_REASON, DERIVABLE_CLOSURE_STATUS,
      EVIDENCE_URL_RE, HONOR_REJECTIONS, honorRejection}`（清点式守卫；只读评审 i6 的环就靠这条不出现）

## 2. 写回器接线

- [x] 2.1 `scripts/ccg-review-writeback.js`：合取① 直判不成立时调用 `honorRejection`
      （`boundEvidence` 取即将写入 `dr.evidence` 的那个表达式，**同一个变量**）；
      通过 ⇒ spoke 记 `closed-status-derived`（与直判的 `closed-status` 两个词）
- [x] 2.1b 派生**不得**短路合取②③④⑤（轮 1 i6）：`backend-request-mismatch` 等既有红因在派生成立时
      仍必须照常触发，且红因取那一句、不得塌回 `honor-*`；用例断言 spoke 里同时有
      `closed-status-derived` 与该失败红因（那是如实读数，不是矛盾）
- [x] 2.2 self-play 出口内区分两种 basis：派生成功 ⇒ `adjudicated-self-play-honored`，
      未触发派生（status 本就闭环）⇒ `adjudicated-self-play`（既有值一字不动）；
      派生档同样落 `evidence=<URL>` + `adjudicationDigest`（复用 `lib/ccg-delivery-digest.js`，不重抄）
- [x] 2.3 直签档（`performedBy === expectedCritic`）MUST NOT 获得派生：加一条锁断言
      "status 非闭环 + performedBy 等于期望后端 ⇒ 仍 `not-closed`，detail 里 MUST 出现 `status=` 读数"
      （轮 1 i3 点名）断言必须写成可执行的两条：`tierBasis` 缺席 **且** 第三档计数不因此增长
- [x] 2.4 派生失败时的红因 MUST 从 `honorRejection` 透传（不得塌回 `not-closed` 那句），
      且 `ADJ_HINT` 里为每一格新增一句可执行处置（缺什么、去哪儿补）
- [x] 2.5 `scripts/ccg-review-writeback.test.js` 补：2.1/2.2/2.3/2.4 各一条行为锁 +
      一条接线锁（`boundEvidence` 与写入值同表达式；拆成两个变量即红）
- [x] 2.6 **`blocking-not-empty` 的定向豁免**（只读评审 i1，Critical，不补则主场景不可达）：
      `adjudicationRejection` 收一个调用方显式传入的 `closureDerived`，它**只**豁免
      `blocking-not-empty` 这一格；其余五格照旧。用例两向都要有：
      ① 派生成立 + `confidenceWeight` 缺席 ⇒ 仍 `confidence-weight-absent`；
      ② 派生成立 + `reviewBackends.critic` 不一致 ⇒ 仍 `backend-request-mismatch` 且 spoke 保留 `closed-status-derived`
- [x] 2.7 `ADJ_URL_RE` 字面量删除、改为 `require('./lib/ccg-external-review-honor').EVIDENCE_URL_RE`
      （净减一份副本）；正反向各一条：同一条 URL 在两版形态下判定不得翻转
- [x] 2.8 派生计算的**时机**落在 self-play 出口之内（只读评审 i7）：
      `performedBy === expectedCritic` + `status=self_play_blocked` + 复核齐备 ⇒ 仍 `not-closed`
      且 spoke **不含** `closed-status-derived`（这条就是"① 先于 ③ 算"那版实现的红靶）

## 3. 判据侧接线（收口矩阵 / 欠账 / 转变核对）

- [x] 3.1 `scripts/check-pr-exec-record.js`：闭环判定改为「白名单直判 ∥ `honorRejection` 通过」，
      `boundEvidence` 取 `deepReview.evidence`；派生成立时收口矩阵（高危面）MUST 认它
      （前提：`tier=external` + basis 已认识 + `adjudicationDigest` 就地重算自洽）
- [x] 3.1b 判据侧的 `expectedCritic` **不得**取 `record.reviewBackends.critic` 自身（只读评审 i5：
      那会退化成字段自比、恒真，而端到端 Scenario 恰好让两档看起来一致）。
      口径：`require('./lib/ccg-review-backends.js')` 现读清单；当 `reviewBackends.overridden === true`
      或 `reviewBackends.from.critic !== 'list'` 时按既有"显式覆盖"口径承认记录里的值
      （否则 `--critic codex` 的正常用法会被本刀判红）。接线锁一条：把取值改回自比即红
- [x] 3.1c 新增本地 require ⇒ 同 PR 把 `lib/ccg-external-review-honor.js` 与
      （若 3.1b 引入）其依赖登记进 `scripts/deep-review-entry-rc.test.js` 的 `SCRIPT_CLOSURE`；
      漏抄由该文件 ⑫ 当场抓（实测过这条链：#4093 漏一行 ⇒ Gate 2b11 对所有 PR 转红）
- [x] 3.1d **同源约束补一半**（只读评审 i2，Critical）：派生成立且该产物在本次差量里**有 base 版本**时，
      base 与 head 的 `deepReview` 语义指纹 MUST 不同（复用 `deepReviewFingerprint`）；
      取不到 base（A 形态）不判红但 MUST 计入「未证实」读数并逐条打印；
      红文案写清这一格挡"改一个词把历史 pending 翻成派生闭环"，**不**挡当场伪造整份
- [x] 3.1e 采样域扩到派生态（只读评审 i3，Critical）：`dualClosedDeepReviews`（`:964`）与
      水位（`qm6-tier-watermark.js:108`）改为「白名单 ∥ 3.1 那把同源判定」；
      用例 MUST 用**真实** `status=self_play_blocked` 的派生产物断言它进 `total` 与 `c`
      （禁止用 `status=cleared` + 手写 honored basis 过测 —— 那是 5「不得染色」要拦的形状）
- [x] 3.2 `classifyEvidenceTier` 增加 `"adjudicated-self-play-honored"` case（重算 `adjudicationDigest`），
      default 仍落 `unrecognized`；把 default 改成放行 MUST 变红
- [x] 3.3 `summarizeTierCoverage` 扩成三档 + `a+b+c==external` 求锁；读数行格式照 design §D7
- [x] 3.4 「转变核对」（base 非闭环 → head 闭环）MUST 与派生一致：
      派生成立即算一次**有出处**的转变（出处 = 那条 URL，形态判据既有），不得判成无出处欠账
- [x] 3.5 `scripts/check-pr-exec-record.test.js` 补 3.1–3.4 各一条；并补一条端到端：
      真写回器写出的派生产物 ⇒ 喂真判据 ⇒ `rc=0`（**不许只测纯函数**，本仓「契约夹具不得替对方剥壳」同型）
- [x] 3.6 反捷径锁：`CLOSED_DEEP_REVIEW_STATUSES` **逐字枚举**恰为三词，另加一条显式非成员断言
      （不含 `self_play_blocked`）。轮 1 i2（Critical）实测过那条相等锁的形状
      （`ccg-review-decider.test.js:682-683` 只比 shared/decider 两份实现排序相等 ⇒ 三处一起加词照过），
      所以本条 MUST NOT 用相等检查代替，红文案写清"这条守不许一起漂移"
- [x] 3.7 单一实现锁：`ccg-review-writeback.js` 与 `check-pr-exec-record.js` 都 require 真源，
      且两文件剥注释后不含该 reason 字面量；真源模块内该字面量恰出现一次
      （扫描域只含 `scripts/*.js`，MUST NOT 含 `openspec/**/*.md` —— 本设计文档通篇在引用那个词）。
      剥注释一律复用既有 `stripCommentsForScan`（引号感知，**刻意保留字符串字面量**，
      其自身用例在 `check-pr-exec-record.test.js:1198`）；轮 1 i7 建议"排除字面量"已驳回，
      理由就写在这条里：文件内的该字面量正是本锁要禁的重复实现本身
- [x] 3.8 advisory / enforce 分叉各一条用例（轮 1 i5）：同一份 `tierBasis="adjudicated-self-play-honored"`
      产物，advisory 档 `exit 0` 且点名派生、enforce 档判 OK；honor 不成立的同形状产物
      advisory 仍 `exit 0`（点名）、enforce 判欠账。**缺任一档即视为该分叉未被锁**

## 4. 水位与可见性

- [x] 4.1 `scripts/qm6-tier-watermark.js` 打印第三档 `external(自扮演+公开复核+高危派生)=c`
      与 `a+b+c==external` 自检；沿用既有 `require` 判据分类实现，SHALL NOT 自写一份
- [x] 4.2 水位测试补三档用例：三条产物各进一档、`a+b+c==external` 成立；
      并含"派生档落进第二格 ⇒ 求锁红"与"`status=cleared` 的正常产物使 `c` 增长 ⇒ 红"两种靶
      （后一条即轮 1 i3 要求点名到具体条目的那条断言）
- [x] 4.3 现跑一次水位，把 `c=0` 与 `total/external` 读数记进执行记录 （现跑 2026-10-26，ref=`origin/main` tip `2d5a636f6c`）：`total=291 external=83`，分档 `直签=78 自扮演复核=5 高危派生=0`（78+5+0=83 求锁成立）。`c=0` 是健康态，且它是**测出来的 0**：采样域已含派生态，水位自己那处由 §7.1/3.1e 的用例守着

## 5. 文档与规格同步

- [x] 5.1 `AGENTS.md` QM-6 段落补一句：派生档存在、`tier` 闭集未扩、三档求锁、 AGENTS.md QM-6 段落已加一整条（资格七格、三档求锁、增量成本 0/11、三条边界、反捷径禁止加词）
      以及「这条能力不再依赖仓外副本」那句（本仓 AGENTS-text↔implementation 同步欠账的清偿动作）
- [x] 5.2 `scripts/deep-review.sh` **不改**；若改仅限文案，且改后必须复跑入口 rc 锁
      （`deep-review-entry-rc.test.js` 的 rc=0/1/2 逐字相等断言对文案敏感）
- [x] 5.3 执行记录 `openspec/records/qm6-external-review-in-repo.md`（**按分支名命名**，不是 change 名 —— 旧行写的是 `qm6-external-review-honor.md`，创建后被载体规格纠正）：判定行、QM-5 五步行、主干适用人群行、探针失明行、决策层与验证层读数行、CHANGELOG 条目小节
- [x] 5.4 `node scripts/aggregate-changelog.js --dry-run` 读数写入记录（台账由聚合器发版时搬，PR 不编辑 CHANGELOG.md）

## 6. 验证与收尾

- [x] 6.1 全量本地判据：`node --test scripts/ccg-external-review-honor.test.js scripts/ccg-review-writeback.test.js
      scripts/check-pr-exec-record.test.js scripts/qm6-tier-watermark.test.js scripts/deep-review-entry-rc.test.js`
- [x] 6.2 `[M]` 变异反证逐条实跑（红集互不相同，每条写明指名红在哪一条用例）：
      M1 把 `honorRejection` 改成恒 `null`（应红在资格面/形状面多条，且**必须**含 3.5 端到端那条）
      M2 去掉 status 资格那一格（应红在 `status-ineligible` 用例，且 1.4 那条 pending 形状负例红）
      M3 只检查"blocking 里有没有 hrre"而不穷尽（应红在混合/全 upheld 两格）
      M4 摘掉 `evidenceRef === boundEvidence`（应红在 unbound 用例）
      M5 摘掉自证负向判据（应红在 `self-refuting`）
      M6 写回侧把 `boundEvidence` 拆成两个变量（应红在 2.5 接线锁）
      M7 判据侧把 `boundEvidence` 改成读入参（应红在 3.5/3.7）
      M8 把派生档并进第二格（应红在三档求锁）
      M9 `classifyEvidenceTier` 的 default 改成放行（应红在 unknown-basis 用例）
      M10 把 `self_play_blocked` 加进闭环白名单（应红在 3.6 反捷径锁）
      M11 让 `status=cleared` 的产物也走派生（计算时机倒置；应红在"不得染色"用例）
      M12 在两个消费方之一里重抄 reason 字面量（应红在 3.7 单一实现锁）
      M13 摘掉"共享 URL 时 rationale 必须两两不同"那一格（应红在 1.3 的 `rationale-duplicated`，
          且 MUST NOT 让 1.3b 那条"共享但文案不同"的正例变红——红集里出现它说明实现写成了"一律禁止共享"）
      M14 让派生短路合取③（honor 通过即跳过 `adjudicationRejection`；应红在 2.1b，
          红因应从 `backend-request-mismatch` 变成别的，说明 ③ 不再被触发）
      M15 把 3.6 写成"两份实现排序相等"（应红在自建/三处一起加词那一格——本条测的是锁本身有没有牙，
          对应轮 1 i2 的采纳项）
      M16 把 2.6 的定向豁免扩成"派生成立即跳过整条 `adjudicationRejection`"（应红在 2.6①/②，
          且**不得**红在派生正例上——红集里出现正例说明豁免写在了派生之前）
      M17 把 3.1e 的采样域退回闭环白名单（应红在"真 `self_play_blocked` 派生产物进得了 `total` 与 `c`"那条；
          这是"求锁恒真"的红靶，若它不红说明用例是用 `status=cleared` 伪造出来的）
      M18 把 3.1d 的同源约束删掉（应红在"有 base 且指纹未变 ⇒ 不认派生"那条）
      M19 把判据侧 `expectedCritic` 改回 `record.reviewBackends.critic` 自比（应红在 3.1b 接线锁）
      M20 把派生提到 ③ 之前计算（应红在 2.8 那条 performedBy=期望后端 的红靶；红集必须**只**含它，
          若连 5「染色」那条一起红说明两格被同一把锁混判）
- [x] 6.3 QM-6 实现轴外部评审（`sh scripts/deep-review.sh`，走真链、不手写 tier），逐条处置后把
      轮次/交付条数/裁决记进 design.md；**本刀属"改谁来守门"，PR 一律交人工合并**（proposal 四·5）
- [x] 6.4 PR + `node scripts/check-main-red.js --pr <n>` 读数 + `--mode=enforce` 读数；
      合并由人执行，agent 只做产物取证
      证据（勾时现取，不是转述）：PR **#4453**，merge `4729a93a0f701fc21f628d42355492e0bade869f`（`gh pr view --json state,mergeCommit` 现读 MERGED）。
      `--mode=enforce` 的 rc=0 与逐套件 pass 数写在 PR 评论 `pull/4453#issuecomment-6403976344`；
      合并闸门读数 `MAIN-RED verdict=OK exit=0 … prFail=0 mainFail=0 newRed=0 uncertain=0 unknown=0/0 prPending=0` 在 `#issuecomment-6404423854`。
- [x] 6.5 回读本次合并触发的 main push（若人工合并），读数写进 PR 评论、不写回仓库文件
      证据：回读写在 PR 评论 `pull/4453#issuecomment-6406892565`（**没有**回填仓库文件）——坐标 `(merge SHA 4729a93a0, workflow quality-gate.yml)`，
      run `40256876308`，`event=push`，`status=completed` / `conclusion=success`；内容归属判据 `[BRANCH-MERGED] ref=a1288e20d23f against=origin/main@4729a93a0`。
      同一条评论当时就记下「`QG Coverage` 这一格是 skipped 不是 success」，但**止于"required 清单被满足"，没有建账**；
      2026-10-27 对照实测（最近 6 次 main push，含与本刀无关的 4 次）该作业**全部 skipped** ⇒ 已作为具名欠账写进本次归档 PR 的执行记录
      「未闭合清单」行，并附重取命令（required 清单要读两套机制的并集：ruleset 23749994 + branches/main/protection）。
- [x] 6.6 R1-R7 worktree 清理（`safe-worktree-remove.ps1 -WhatIf` 先行）+ 记忆收敛：
      更新 `qm6-tier-watermark-slice.md` 与本刀的落地状态，登记「#4261/#4326 现可用派生档签字」
      证据（勾时现取）：`git worktree list` 对该 worktree **0 条命中**（清理走 `scripts/safe-worktree-remove.ps1`，`-WhatIf` 先行、R7 对账主工作区与基线一致）；
      记忆三份在场 —— `qm6-honor-in-repo-landed.md`（本刀落地状态）、`qm6-tier-watermark-slice.md`（派生档那条出口的上游片）、
      `qm6-gate-surface-single-source-slice.md`（含「#4261 卡住的 11.7 现由 #4453 派生档打开」的登记，现读该文件内 `11.7` 出现 4 次）。


## 7. 实现轴轮 2 采纳追加项（原清单没有这几格，是评审逼出来的）

- [x] 7.1 三档桶名收进真源 `TIER_BUCKETS`（冻结），判据与水位都引用它；两文件剥注释后不得再打字面量
- [x] 7.2 反捷径判据从"只有测试会红"升级为 `lib/exec-record-statuses.js` **加载期抛错**，并配行为锁 + 原样加载正控
- [x] 7.3 `honorRejection` 的 `verdict` 三档映射写成显式注释；`blocking × findings` 改一次建索引（保留同 id 两条那一格）
- [x] 7.4 真源模块头写明"URL 只是形状判据，人工须逐条点开核对评论原文"；顺带否证 `Object.freeze(Set)` 能挡 `.add()` 这个错觉
- [ ] 7.5 跟进项（不在本 PR）：把派生收口与"产物文件名 = 差量内容寻址"重绑定，收窄 i1 指出的可伪造面
