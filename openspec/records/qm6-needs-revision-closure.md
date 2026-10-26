# 执行记录：把用户授权的 QM-6 人工收口落进 main（qm6-needs-revision-closure）

- 分支：`qm6-needs-revision-closure`
- 日期：2026-10-25
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后现跑）→ 读数见 §3
- 归属：任务 #94 的合并后收尾。被收口的 PR 是 **#4398**（预算重测入口的有界退避 + provenance 一册账），
  由外部自动化于 `2026-10-25T03:55:08Z` squash 收走，merge SHA `f5135947af988fa4e26a050fdb636f4b5a935091`。
  人工授权落在合并**之后**，所以 main 曾带着两份 `self_play_blocked` 判定产物；本 PR 把那笔判定补落地。

## 1. 这笔做了什么，以及为什么不算 agent 自签

用户原话：**「按 needs_revision 人工收口，合」**（2026-10-25）。据此把两份判定产物的
`deepReview.status` 由 `self_play_blocked` 改为 `needs_revision`，并各写一条结构化 `closureNote`
（轮次标记 + 逐条处置结论）与一个 `humanClosure` 字段（授权人、授权原文、日期、公开出处 = PR #4398 的评论）。

四件刻意**没做**的事，这是它与「伪造闭环」的唯一区别：

1. 没改 `adjudicatedBy`（仍是 `self-play`）、`confidenceWeight`（仍是 `0.6`）、`performedBy`；
2. 没改 `blocking` 清单，也没改 `findings` 里任何一条的 `verdict`——**没有把任何 upheld 改成 dismissed**；
3. 没走 `4729a93a0` 新增的 honoring 通道。不适用是**按设计**，不是嫌麻烦：该通道要求 blocking 里
   **每一条** 的 reason 都是高危复核且 verdict 为 `dismissed`，而本 PR 两轮 blocking 的 reason 是
   `i1/i3/i4 = self_play_upheld` + `i2 = high_risk_requires_external`——被判成立的真缺陷，
   正是那条通道刻意拒绝解除的那一格（接受 upheld 等于把真缺陷一起盖章放行）；
4. 没动 `CHANGELOG.md` / `01-docs/learnings.md`（条目在本文件 §6，由聚合器搬运）。

## 2. 门禁表（docs-only 保留门禁，一条不省）

| 门禁 | 结果 | 读数 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | 纯流程面改动（`.ccg/reviews/*.json` + `openspec/records/`），未触运行时代码；仍在隔离 worktree 内编辑并经 PR 落地，不直推 `refs/heads/main` |
| 行尾对账 | ✅ | 两份产物原为 `i/lf w/lf CR=0`，改写前后各测一次；判定见 §4 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js`，见 §3 |
| 文档同步 | ✅ | `node scripts/check-docs-sync`（changes job 那条），见 §3 |
| 台账（CHANGELOG） | ✅ 按新规 | 条目在本文件 §6，本 PR 不编辑 `CHANGELOG.md` |
| QM-1 打包 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/` |
| QM-4 视觉 | N/A | 无模板/样式/组件改动 |
| TDD | N/A | 本 PR 不产出运行时代码，只改审计产物的状态字段与执行记录；改动本身的正确性由 §3 的 `check-pr-exec-record --mode=enforce` 当场验证（它正是消费这两个字段的判据） |
| QM-6 | 见 §5 | 本 PR 自身规模档由 `scripts/ccg-review-decider.js` 当场判定；被收口的评审链（两轮、共 8 条 Warning 全部 upheld 且已修）见 `openspec/records/shard-audit-transient-retry.md` §5、§6 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## 3. 现场读数（commit 之后现跑，逐条可重取）

- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ **docs-only=true files=3**
  （两份 `.ccg/reviews/*.json` + 本记录，均落在 `.ccg/**`、`openspec/**` 白名单内）
- `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` ⇒ **通过**：
  `TRANSITION-CHECK 转变=通过 扫描域=2 已核对=2 无出处=0 未证实=0` —— 两条「非闭环 → 闭环」的跃迁
  都被判据认到有出处的收口（结构化 closureNote），不是被跳过。同一次分档行照抄：
  `TIER-COVERAGE dual-closed total=2 external=0 … unknown(字段缺席)=2` —— 这两条是 **note 档收口，
  不是 external 档**；覆盖率不会因为本次改动出现"自称外部评审"的计数。
- `bash scripts/check-docs-sync.sh --base=main --head=HEAD` ⇒ **rc=0**，输出 `✅ 仅文档/流程变更，无需额外同步`。
  ⚠ `--base` 收的是**分支名**（脚本自己拼 `origin/$BASE`）：我第一遍传 `--base=origin/main`，
  得到 `fetching origin/origin/main … fatal: couldn't find remote ref` —— 那是**用法错**，
  不能读成门禁红；这类"脚本报错先怀疑自己坐标"的口径本仓已记过多次。
- `node scripts/ccg-review-decider.js --base origin/main` ⇒ 打印 `SINGLE / 变更 0 行（≤ 200）且无敏感命中`。
  ⚠ **这个 0 不是本 PR 的规模档**：decider 读的是**暂存 diff**，在提交之后、索引为空时跑就得到 0，
  与 `classify-docs-only --head=HEAD` 必须在 commit 后取证是同一族取证顺序问题。本 PR 的真实源码差量
  按 `git diff --numstat origin/main..HEAD` 是两份产物各 `11 增 / 2 删`（合计 26 行，含本记录也只有 102 增），
  远低于 200 ⇒ 无论怎么取都是 SINGLE 档，所以这里没有"靠顺序骗过判定"的空间，但读数必须如实标注来历。
- `check-gate-record-debt` / `check-doc-abs-paths` / `check-no-brand-residue` / `check-unwired-tests` /
  `check-step-failfast` / `check-debt-budget` 全部 rc=0。其中 `check-gate-record-debt` 第一遍是 **rc=1**，
  红因正是本文件自己：我多写了一节 §7，使一篇记录里出现 **3 行** `远程同步`（§2 门禁表 1 行 +
  §7 表头 1 行 + §7 数据行 1 行），判据文案「一篇记录只留一行收口，且状态列写「由门禁推导」」当场点名。
  正解是删掉 §7 而不是放宽判据 —— 这一条必须记下来：它和 #4398 第 2 轮 i1/i5 同源，
  **我在自己写的文档里复述了别处持有的事实，然后与别处不一致**。
- 收口脚本的写盘前自检（任一不符即抛错不落盘）：两份的 `findings=4 / blocking=4 / confidenceWeight /
  adjudicatedBy` 逐字段未变，只有 `status` 与新增的 `closureNote`、`humanClosure` 变化；
  写盘前先验证 `raw === JSON.stringify(JSON.parse(raw), null, 2) + "\n"`，所以 diff 是 `11 增 / 2 删`
  而不是"整文件重写"。

  `findings=4 / blocking=4 / confidenceWeight / adjudicatedBy` 两份均**逐字段未变**，只有 `status`
  与新增的 `closureNote`、`humanClosure` 变化；diff 规模 `11 增 / 2 删` 每份（见 §4）。

## 4. 行尾与 diff 对账

两份产物改写前实测 `CR=0`、且 `raw === JSON.stringify(JSON.parse(raw), null, 2) + '\n'`
（先验证这一点才敢整份重序列化，否则 diff 会变成"整文件重写"）。因此本次写盘逐字节保持原格式，
`git diff --numstat` 每份 `11 2`（= 状态行 1 改 + `closureNote`/`humanClosure` 新增），未出现幽灵行。
`--ignore-cr-at-eol` 口径的对照读数记在 §3 那批里一起取。

## 5. 本 PR 自身的 QM-6 规模档（以及它为什么不是"替代一轮评审"）

本 PR 走 docs-only 通道（AGENTS：纯文档/流程变更不强制 QM-6），decider 在提交后的索引态是 SINGLE，
真实源码差量 26 行也远在阈值下 —— 但**被收口的那条评审链不是 docs-only**：PR #4398 是混合 PR，
它的两轮外部评审、共 8 条 upheld 与 M1–M17 全部在
`openspec/records/shard-audit-transient-retry.md` §5 / §6 里。本文件只把那笔**人工判定**落进 main，
没有替代、也没有新增任何一轮评审；`adjudicatedBy` 与 `confidenceWeight` 因此一字未改。


# [未发布] docs(qm6): 用户授权的人工收口落进 main —— 两份 self_play_blocked 产物改记 needs_revision 并附逐条处置

- **现场**：PR #4398 由外部自动化于 2026-10-25T03:55:08Z squash 收走（merge SHA `f5135947af`），
  比人工授权早了几分钟，于是 main 带着 `.ccg/reviews/e7b39a89….json` 与 `.ccg/reviews/8808bd5b….json`
  两条 `status=self_play_blocked` 落地。
- **处置**：按用户授权「按 needs_revision 人工收口，合」把两份产物置为 `needs_revision`，各附结构化
  `closureNote`（轮次 + 逐条处置）与 `humanClosure`（授权原文、日期、公开出处）。**裁决本身一字未改**：
  `adjudicatedBy=self-play`、`confidenceWeight=0.6`、`blocking`、`findings` 与每条 `verdict=upheld` 原样保留。
- **边界**：`4729a93a0` 的 honoring 通道对本例按设计不适用（它只解除"全部为高危复核且外部判 dismissed"，
  而这里是成立且已修的真缺陷）。这条不是绕行，是把两种闭合口径分开记清楚。
