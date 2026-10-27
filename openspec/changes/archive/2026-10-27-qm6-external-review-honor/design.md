# 设计：把「高危域条目经真外部复核可解除阻断」这段判定搬进仓内

## D0 现场取证（活数，引用前现跑）

重取方式：本轮用一次性探针（不入库）遍历 `git ls-tree -r origin/main -- .ccg/reviews` 的 64 位十六进制产物名，
经**单进程** `git cat-file --batch` 按帧头字节长度切 body 后逐条解析；
入库后的等价判据是本刀回归锁（tasks 1.3 的判定表 + 6.2 的 M2/M3）。
本轮实测（2026-10-25，`origin/main` = `96155572f`）：

```
blobs=1292 parsed=1292 parseFail=0 dual=286
self_play_blocked=11   其中 blocking 全为 hrre=0   混合 upheld=3   全为 upheld=8   blocking 空/缺=0
hrre 条目合计=0        其中该 finding 带 externalReview 字段的=0
其他状态分布 pending=898 self_play_resolved=206 self_play_pending=38 cleared=84 needs_revision=36 skipped_by_mode=6 error=13
```

三条由这组数直接得到的结论，都必须按这组数说，不得写成修辞：

1. **派生判据在主干历史上的适用人群是 0 条**。`self_play_blocked` 的 11 条里没有一条是"纯 hrre 阻断"，
   所以本刀**不会**把主干上任何一次既有的"拦"变成"放"。它的价值只在未来：让 self-play 轮次在
   真外部复核到位时**机制上可达**，而不必回到手写 `tier`/手写 `status`。
   这条数是"增量成本"，不是"总成本"——把它漏掉，下一个会话会以为本刀放宽了 11 条。
2. 今天卡住的是**在飞**的那条：#4261 本轮跑出的产物 `blocking=[{id:i5, severity:Warning, reason:high_risk_requires_external}]`
   是纯 hrre 形态，命中人群，但因为合取① 只看 `status`（引擎写了 `self_play_blocked`）而**整条链路签不了**。
3. `全为 upheld=8` 这一档**必须继续拦**，且它现在是 `self_play_blocked` 的主体。本刀如果写成
   "blocking 里每一条都能在 findings 里找到对应项就放行"，会一口气放掉这 8 条——
   所以 D2 的"穷尽且只认一种 reason"不是谨慎，是这条读数逼出来的。

取数那次探针第一版把 `execFileSync(..., { encoding: 'utf8' })` 的返回值按帧头 `size` 做**字符串切片**，
结果 1292 个对象只切出 2 帧、解析全失败——帧头声明的是**字节数**，中文按 UTF-16 长度切必然错位。
主规格里"按帧头声明的字节长度切 body"那句不是修辞，本仓第二次为它交学费（第一次见 `qm6-tier-watermark`
的扫描域条款）。判据实现必须取 Buffer 再逐帧 `toString('utf8')`。

判据本体（`blocking[].reason` 三档、`findings[].highRiskDomains`、`findings[].externalReview`）的字段来源见
下方 D3 的引擎对照。

## D1 落点：新建一个零依赖纯函数真源，两个消费方共用

新增 `scripts/lib/ccg-external-review-honor.js`：只放常量与纯函数，**不 require 任何东西、不读环境、不写文件**
（与 `scripts/lib/exec-record-statuses.js` 同规格——它会被判据本体 require，而判据本体是 CI 每次 PR 都跑的入口，
必须保持零副作用）。

导出两把：

- `HONORABLE_BLOCKING_REASON = 'high_risk_requires_external'`（闭集，只此一词）
- `honorRejection({ deepReview, record, expectedCritic, boundEvidence })` → `null`（可派生闭环）
  或 `{ reason, detail }`（点名缺哪一格）

两个消费方 SHALL 都 `require` 它，SHALL NOT 各自再写一份：
`scripts/ccg-review-writeback.js`（写回时派生合取①，`boundEvidence` 取入参 URL）、
`scripts/check-pr-exec-record.js`（收口矩阵/欠账判据认同一派生，`boundEvidence` 取 `deepReview.evidence`）。
**两处 `boundEvidence` 的来源天然不同**（一处是"即将写进去的值"，一处是"已经写着的值"），
这不是漂移而是本刀的形状：因此各配一条接线锁（D7），防止其中一处悄悄换了取值来源。

为什么不能只改写回器：`check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 与收口矩阵都看
`deepReview.status ∈ 闭环白名单`。写回器单方面放行会产出一份 `tier=external` 但**判据仍报欠账**的产物
——红文案会指着一个已经盖过章的记录说"评审没做"，那种不一致比原来那个洞更难查。

## D2 派生的成立条件：穷尽、单因、逐条有主

`honorRejection` 只在下列**全部**成立时返回 `null`：

1. `deepReview.status` 逐字等于 `self_play_blocked`（本模块导出 `DERIVABLE_CLOSURE_STATUS`）。
   **这条是资格面，不是谨慎**：主干实测非闭环状态有 `pending=898` / `self_play_pending=38` /
   `error=13` / `skipped_by_mode=6` / `self_play_blocked=11`，把派生限定在这一个词上，
   才使"派生只解释引擎那句『被高危项挡住』"成为字面事实；不限定时那 898 条未评审记录
   会不会被放行，取决于它们恰好没有 `blocking` 字段这个**巧合**（形状会随引擎版本变），
   而判据不该建在巧合上（D6 重取读数）。
2. `deepReview.blocking` 是**非空数组**（空数组走既有第二条出口，不进派生；缺席/非数组一律 fail-closed，见 D6）。
3. 每一条 `blocking[i].reason` 逐字等于 `HONORABLE_BLOCKING_REASON`。
   任一条是 `self_play_upheld` ⇒ 直接拒，且红因**不合并**：「裁决判指控成立」是一条阻断的**理由**，
   不是缺证据，外部复核给它盖章是范畴错误（proposal 刻意不做第 3 条）。
4. 每一条 blocking 能在 `deepReview.findings` 里按 `id` 找到**唯一**对应项（找不到 ⇒ `honor-item-absent`；
   多条同 id ⇒ `honor-item-ambiguous`）。理由：blocking 只带 `{id, severity, reason, domains}`，
   verdict 与 `externalReview` 都在 findings 上；id 对不上时"这条被复核过"这句话没有主语。
5. 该 finding 的 `externalReview` 是一个对象且三格齐备（D3、D4）。
6. 该 finding 的 `verdict` MUST 逐字等于 `dismissed`，且带非空 `rationale`
   （红因 `honor-upheld-assertion` / `honor-verdicts-incomplete`）。
   ⚠ **不能沿用 ③ 的 `verdict ∈ {upheld, dismissed}`**（只读评审 i4，实测成立）：
   现网引擎 `ccg-deep-review.js:481-484` 在 `highRiskDomains` 非空时 push `hrre` 后**直接 return**，
   `verdict === 'upheld'` 那一格（`:485`）永远轮不到 ⇒ 被裁决判**指控成立**的高危项，
   它的 blocking reason 也是 `high_risk_requires_external`。接受 `upheld` 等于把真缺陷连同
   伪阻断一起解除，与 proposal 刻意不做第 3 条（不放行 upheld）正面矛盾。
   红因也 MUST 带 `honor-` 前缀（i8）：`adjudicationRejection` 在"整份 findings"维度已用
   `verdicts-incomplete` 这个词，同名会让 1.5 的召回锁把 ③ 的用例算作 honor 那格的命中。
7. **共享 URL 时处置文案必须两两不同**（轮 1 i1 采纳的一半）：若 ≥2 条 honored 项的 `evidenceRef` 逐字相同，
   它们的 `rationale`（trim 后）MUST NOT 出现重复 ⇒ 否则 `honor-rationale-duplicated`。
   这条把 i1 指出的真问题变成机械判据，同时**不**要求"每条高危项各发一条公开评论"——
   共用载体是现实形态，硬拆只会造出 N 份指向同一处的假独立。真正不可共享的是**逐条处置的理由**。
   ⚠ 实现上这条覆盖的范围比标题更宽：`honor-evidence-unbound` 要求每条 `evidenceRef` 都等于同一个
   `boundEvidence`，所以 **≥2 条时必然共享同一条 URL** ⇒ 去重判据实际上对每条含 ≥2 项的派生都生效。
   这是"更严"而不是"另开一格"，如实写下来，免得下一个会话把它当漏形去"顺手放宽"。

**不得**把"blocking 全为 hrre 但某条 finding 查无此 id"读成"那条不重要"——那正是本仓把工具的失明读成结论的同型。

### D2a `CLOSED_DEEP_REVIEW_STATUSES` 一字不动，并配一条反捷径锁

最省事的做法是把 `self_play_blocked` 直接加进 `scripts/lib/exec-record-statuses.js` 的闭环白名单——
一行字，写回器与判据两边同时"通过"。**这条必须被机械禁止**，因为它把本刀的逐条复核判据整条旁路：
任何一份 `self_play_blocked` 产物（不论有没有 `externalReview`、不论 URL 真假）立即算闭环。
新增一条锁断言闭环白名单**恰为** `{cleared, needs_revision, self_play_resolved}` 三词且不含 `self_play_blocked`，
红文案写明"想加词请先删掉 honor 判据"。既有那条"判据/裁决器/审计三处白名单必须相等"的锁不受影响，
仍逐字有效（本刀没改那三个词）。

**这条锁不得由那条相等锁代替**（轮 1 i2，Critical，实测成立）：`ccg-review-decider.test.js:682-683`
取的是 shared 与 decider 两份 `CLOSED_DEEP_REVIEW_STATUSES` 排序后的**实现间**相等，
三处一起加词它逐字仍然通过。所以本刀这条必须**逐字枚举三词**，另加一条显式非成员断言
（`set.has(...)` 取反）；两条锁测的不是同一件事：那条守"三方不许互相漂移"，这条守"不许三方一起漂移"。


## D3 期望后端的锚点换成仓内真源，不依赖引擎模板

被搬走的那段 vendor 实现（`.bak-severity:436-452` 的 `externalReviewSatisfied`）用
`adj.expectedExternalBackend` 当"本轮真调用过的后端"的期望值，而这个值由**引擎模板**写进裁决模板。
现网引擎（mtime `2026-10-24 11:48`）全文 `expectedExternalBackend` 出现 **0 次**，模板也不再产出它——
所以照抄 vendor 判据会得到一个恒为空的期望值，而 `!expected ⇒ return false` 在 vendor 版里是**拒**，
搬进仓内若保留同一句，就是把"引擎不再给我期望值"这件事静默变成"永远不认外部复核"，
读起来像判据在跑，实际恒假。这正是本仓「装饰性门禁」的第一形态，必须换锚。

仓内锚点本来就有，且比 vendor 更强（`reviewBackends` 由 `deep-review.sh` 在把控制权交给驱动**之前**回写，
见 change `qm6-review-request-writeback`）：

- `record.reviewBackends.critic` 必须逐字等于上层透传的 `expectedCritic`（`scripts/ccg-review-backends.list` 真源，
  或 `--critic`/`MP_QM6_CRITIC` 显式覆盖后写进产物的那个值）⇒ 不成立时沿用既有 `backend-request-mismatch`，
  **不新增第二个红因**。
- `finding.externalReview.performedBy` 必须逐字等于同一个 `expectedCritic`。
  这条替代 vendor 的 `by === adj.expectedExternalBackend`，期望值来源由"引擎模板"换成"仓内清单 + 入口回写"。
- 并沿用 vendor 那条**自证不算外部**的负向判据：`performedBy` 命中 `/self[\s_-]?play|^agent$|内部模拟/i` 一律拒
  （⇒ `honor-self-refuting`）。不加这条，填写方可以写 `performedBy:"self-play"` 而 `reviewBackends.critic` 仍是
  真后端名，两格分别成立、合起来是空话。
  ⚠ 相对 vendor 原式**多认空白分隔**（`SELF PLAY`）：vendor 那版漏认时后果落在"与期望后端不等"那一格被拒（保守侧），
  不会误放行，但红因会指错方向 —— 补它是把红因对齐到真实成因，不是放宽。测试逐变体钉住（含 `SELF PLAY` / `agent` / `内部模拟`）。

**两个消费方的 `expectedCritic` 必须各自有真出处**（只读评审 i5，Warning）：写回侧它本来就是入参
（`--expected-critic`，由 `deep-review.sh` 从清单真源透传）；判据侧**没有 argv**，
若图省事取 `record.reviewBackends.critic` 自己，那条锚点就退化成字段自比（恒真），
而 spec 的端到端 Scenario 恰好会让两档看起来一致 —— 这是"锁在最该有牙的那一档上是装饰"的又一落点。
判据侧的正解是现读清单：`require('./lib/ccg-review-backends.js')`（判定器与 `deep-review.sh` 已在用的那份），
取 `listCritic()`；当 `record.reviewBackends.overridden === true` 或 `from.critic !== 'list'` 时，
按既有口径承认"显式覆盖过的那个值"为期望值（否则 `--critic codex` 的正常用法会被本刀判红）。
接线锁：把判据侧取值改成读 `record.reviewBackends.critic` 自身 ⇒ MUST 红。
新增本地 require ⇒ 同 PR 把它登记进 `scripts/deep-review-entry-rc.test.js` 的 `SCRIPT_CLOSURE`
（漏抄会被该文件的 ⑫ 当场抓住，实测过这条链）。

## D4 `evidenceRef` 必须与记录级 `evidence` 逐字相等

vendor 版只判 `evidenceRef` 的**形状**（`EXTERNAL_EVIDENCE_RE`）。形状判据在这里不够用：
"一条真实存在、但讲的是另一件事的公开评论"与"这次真公开复核过这条高危项"逐字同形。
仓内已经有解决这个问题的机制——第二条出口的 `adjudicationDigest = adjudicated@sha256(deliveryEvidence(findings) ‖ NUL ‖ url)`
把 URL 绑进了 findings 的哈希。本刀把绑定再收一格：

- `externalReview.evidenceRef` 必须命中**本模块自己持有的那一条严格正则** `EVIDENCE_URL_RE` ⇒ `honor-evidence-form`；
- **且逐字等于** `boundEvidence`（写回侧＝`--adjudication-evidence` 传入并即将写入 `deepReview.evidence` 的那条 URL；
  判据侧＝已写入的 `deepReview.evidence`）。

于是"每条高危项各自指向别的公开评论"这种形态被排除，而多条高危项共用同一条 URL 是**允许的**
（一次公开复核覆盖多条指控是现实形态；D2 第 7 格把"同一段文案贴 N 遍"那一半收窄）。
`reviewedAt` 仍须 `Date.parse` 可解析（vendor 同格，实测无新增绕过面）。

**形态判据的宿主必须改，不是"复用判据既有 url 档"**（只读评审 i6，实测成立）。原判语与
"lib 零 require"互斥：`ccg-review-writeback.js:35` 已经 require 判据本体，lib 若反指
`check-pr-exec-record.js` 会形成加载期半初始化环（writeback → 判据 → lib → 判据(进行中)
⇒ lib 解构到的 `evidenceForm` 是 `undefined`，调用即 TypeError）。口径改成三条：

1. `EVIDENCE_URL_RE` 由 honor 模块**唯一持有**；`ccg-review-writeback.js` 的 `ADJ_URL_RE` 字面量删掉、
   改为引用它 —— 这是**净减一份副本**，不是新增第三份。
2. 判据侧 `evidenceForm` 是"可核指针"的**超集**（它还认 `PR #1234`、裸 `/pull/<n>`、`?query` 等主干既有形态，
   那些档只是不再够格当**派生**的出处）。因此加一条**单向包含锁**：命中 honor 正则的串 MUST 被
   `evidenceForm` 判成 `url`。**双向相等不做**——那会把历史产物的收口判红，属另一刀的范围。
3. honor 模块 MUST NOT require 任何本地模块，也不读环境（纯函数锁钉死，见 tasks 1.6）——
   这条不是风格要求，它就是本格绕开那个环的方式。

## D5 派生只作用于 self-play 出口；直签档一字不动

`performedBy === expectedCritic` 的那条出口（真外部后端跑过）**不得**获得派生能力：
它若 `status` 非闭环，说明是**后端自己**判了 `needs_revision` / `blocked`——那是评审结论，不是能力缺口，
用派生去覆盖它等于把评审的否决改成我们的否决。直签档遇到非闭环 status 仍走 `not-closed`。

这条是本刀唯一"看起来更保守"的分支，理由必须写下来而不是留给下一个人猜：
**放宽的只能是"外部复核无法被表达"这一格，不能是"外部复核给了负面结论"这一格。**

派生的**计算时机**必须钉在"③ 已选定 self-play 出口之后、且只在该出口之内"（只读评审 i7，实测原设计矛盾）：
`applyWriteback` 里 ①（`:121`）先于 ③（`:132`），若在 ① 就地算派生，
则 `performedBy === expectedCritic` 且 `status=self_play_blocked` 且 findings 里恰好有齐备 `externalReview` 的产物，
会先落 `spoke=closed-status-derived`、随后 ③ 把 basis 选成 `delivery`（写出 `evidence=delivery@…`、`tierBasis` 缺席）
——**spoke 声称走了放宽路径，覆盖率却把它计进 `a` 档**，同时 tasks 2.3 那条锁会红。
两条可写的修法里取第二条：① 把 ① 的早退改成"延迟到 ③ 之后"会让控制流绕回去读；
② 直接给 ① 的条件加上 `dr.performedBy === 'self-play'`（= 只在 self-play 那一格内派生）。
读数是显式的两个词（`closed-status` 直判 / `closed-status-derived` 派生），不靠"有没有调用 honor"推断
（这条回应轮 1 i4 的实质诉求；它建议把直判改名 `closed-status-direct` **不采**——
`ccg-review-writeback.test.js:91` 用 `deepStrictEqual(spoke.sort(), [...])` 逐字钉了那个集合，
改名等于拆掉一把已交付的锁，而"对称命名"的收益小于那个成本）。
反过来写（先算派生再算直判）会让一份 `status=cleared` 的正常产物也走一遍派生，
于是 `tierBasis` 可能被落成套 `adjudicated-self-play-honored`——那把最干净的一类产物
（真外部后端跑完、引擎自己判闭环）在覆盖率读数里染成"走了放宽路径"，`c>0` 这个信号就此失去含义。
新增用例（i7 的直接靶）：`performedBy=期望后端` + `status=self_play_blocked` + 复核齐备 ⇒
仍 `not-closed`，且 spoke **不含** `closed-status-derived`。

## D6 三档 blocking 的形状语义（反空转格）

| `deepReview.status` / `blocking` | 派生 | 红因 |
| --- | --- | --- |
| `self_play_blocked` + 非空数组，全为 hrre，逐条复核齐备 | 成立 | — |
| `self_play_blocked` + 空数组 | **不进派生**（走既有第二条出口，其条件本来就更严） | — |
| `self_play_blocked` + blocking 缺席 / `null` / 非数组 | 不成立 | `honor-blocking-absent` |
| `self_play_blocked` + 含任一 `self_play_upheld` | 不成立 | `honor-unhonorable-reason` |
| `self_play_blocked` + 全为 hrre 但 id 查无对应 finding | 不成立 | `honor-item-absent` |
| 其余任何 status（`pending` / `self_play_pending` / `error` / `skipped_by_mode` / 闭环三词） | **不进派生** | `honor-status-ineligible` |

最后一行是资格面，它的实测依据（同 D0 的取数方式；本轮同一次遍历里顺手按 status 分桶统计
`blocking` 的形状，2026-10-25 读数）：

```
pending            absent-or-nonarray=898
self_play_pending  absent-or-nonarray=38
error              absent-or-nonarray=13   skipped_by_mode absent-or-nonarray=6
self_play_blocked  array-nonempty=11       （无 absent、无 empty）
self_play_resolved absent=158 empty=42 nonempty=6
cleared            absent=77  nonempty=7   needs_revision absent=24 empty=1 nonempty=11
```

`pending` 那 898 条现在**恰好**都没有 `blocking` 字段，所以即使只按 D6 前两格实现，它们也会被
"缺席 ⇒ fail-closed"挡住。但那是一层皮：引擎哪天改成"pending 也写 `blocking: []`"，
只看 blocking 形状的实现会把 898 条未评审记录集体读成"无阻断项"。
**所以资格取 status，形状取 blocking，两条都要过**——把判据建在"当前版本恰好没这个字段"上，
就是本仓反复记过的"量过一次没人再量"的同型。


## D7 第三种 `tierBasis`：派生必须可见，且求锁扩到三档

写入值 `tierBasis = "adjudicated-self-play-honored"`（`tier` 仍是闭集里的 `external`，
**不新增 `tier` 值**——理由与 #4308 那条一字不改：撑开 `tier` 闭集会抹平档间区别）。

`summarizeTierCoverage` 与 `scripts/qm6-tier-watermark.js` 的 `external` 子读数从两档扩成三档：

```
[external(直签)=a external(自扮演+公开复核)=b external(自扮演+公开复核+高危派生)=c]
```

并保留既有那条求锁的升级版：`a + b + c == external`，不等即 `WATERMARK-DEFECT`。
求锁的意义在 D2/D5 之后更明确：`c` 是**本刀新增的能力**的计数，`c=0` 是健康态（主干现读 0），
`c>0` 意味着有人在用这条路——它必须被数出来，否则"改宽"不可见，正是零人工收口立项点名的第二条病根。

`classifyEvidenceTier` 必须把新值当**已认识**的 basis 处理（走 `adjudicationDigest` 就地重算，失配降
`external-unverified`），且**未知 basis 继续按 `unrecognized` 拦**——不得为了少写一个 case 把 default 改成放行。

## D8 接线锁（两处 `boundEvidence` 取值来源不同，各自钉死）

- 写回侧：`ccg-review-writeback.js` 传给 `honorRejection` 的 `boundEvidence` MUST 逐字是它随后写入
  `dr.evidence` 的那个表达式；把两者拆成两个变量（例如一个取 `--adjudication-evidence`、另一个取 trim 后的值）
  必须让锁变红。
- 判据侧：`check-pr-exec-record.js` 传的 MUST 是 `dr.evidence`；把它改成"再读一次某个入参"必须变红。
- 单一实现锁：两个消费方都 `require('./lib/ccg-external-review-honor')`，且各自文件内
  SHALL NOT 出现 `'high_risk_requires_external'` 字面量（剥注释后判，按本仓既有"禁令与存在性判据按语义位置切"口径）；
  `HONORABLE_BLOCKING_REASON` 只在该模块出现一次。

## D9 不动引擎、不恢复 vendor 补丁，但判据对上游修复中性

如果上游把 `externalReviewSatisfied` 补回来：引擎会写 `blocking=[]`，本刀派生**不会被触发**（D6 空数组那一格），
走的是既有第二条出口——两条路互不干扰，`tierBasis` 会落成 `adjudicated-self-play`（更弱的声明），
`c` 档自然归零。**本刀无需为此改动**，这一点由一条"blocking 空数组不进派生"的用例守着，不是靠承诺。

## D10 已知不闭合（登记，不装作已闭合）

1. **强度边界要说全，包括本刀新增加的那一段**（只读评审 i2 否证了本节第一版）：
   三格 + 绑定仍是**形状 + 就地重算**判据，不联网核真 —— 这与 `delivery@`/`adjudicated@` 同级。
   但本刀**确实新增了两段可伪造面**，第一版写成"不是本刀引入"是错的：
   ① 可伪造面从"整条记录"扩到"每条高危项各一个 `externalReview` 块"；
   ② 更硬的一条：判据侧接受派生后，`self_play_blocked` 从**无条件欠账**变成**静态手写即可解除**，
      因为合取④（"本次驱动真的产出过"）只存在于写回器，`honorRejection` 没有等价物 ——
      于是"判据比工具松"。处置见 §D14（登记 + 在有 base 的那一半上补同源约束），不得靠删文字消解。
   真正的第三方核证点仍是那条公开评论本身（任何人都能点开）。
2. **`externalReview` 由谁填**：引擎两条分支都把 `adj.items` **原样**落进 `deepReview.findings`
   （现网 `ccg-deep-review.js:380` `findings: adj.items`，实测两处 `finalizeAdjudication` 调用同一路径），
   所以这块内容出自**裁决填写方**（也就是会话自己）。本刀刻意只依赖"它写了什么"而不依赖"它判了什么"，
   代价就是这条：写入方与被判定方同源。缓解手段只有 D4 的绑定 + D7 的可见档 + 公开 URL，没有更多。
3. **proposer 轴不认**：本刀只覆盖 critic 轴（与第二条出口同域）。proposer 轴仍受 7800 字符输入墙，
   欠账在 `ccg-review-degradation-ladder`，不因本刀改变。
4. **CI 侧仍 advisory**：`QG Changes` 的 Gate 2c2 以 `--mode=advisory` 跑，所以"本刀落地"不改变
   「QG Changes 全绿 ≠ QM-6 已闭合」这条既有欠账。
   这条**不因本刀改变**这件事本身要有锁（设计轴评审 i5）：见 tasks 3.8，advisory 与 enforce 两档
   对同一份派生产物的读数分叉必须各测一次。

## D12 只读 fresh-context 评审处置（8 条：Critical 3 / Warning 4 / Info 1；最低维分 4=feasibility，security=4）

决策层的对抗链在本方案上**走不通**：proposer 轴（opencode）实测上限 7800 字符，而 23853 字符的方案
产生的载荷是 28274 字符（开销 4421 ⇒ 方案必须 ≲3.4k 字符才能进 proposer，那不是任何真实设计文档的规模）。
整链 rc=2 升级人工。为了不把"没收敛"读成"没问题"，另派一个**零上下文只读评审者**独立过一遍
（它不产 `.ccg` 产物、不闭 QM-6，只顶"第二双眼睛"那一半）。

**八条全部采纳**，其中三条是能让本刀落地即失效的：

| # | 档 | 判定 | 依据与落点 |
| --- | --- | --- | --- |
| i1 | Critical (feasibility) | **采纳** | 实测成立：`ccg-review-writeback.js:246` 要求 `blocking` 是**空数组**，而派生要求它**非空**。两条合起来 ⇒ 主场景机制上不可满足，写回器会在 ③ 报 `blocking-not-empty` 而永不盖章。⇒ 见 D13。 |
| i2 | Critical (security) | **采纳** | 判据侧接受派生后，`self_play_blocked` 从"无条件欠账"变成"静态手写即可解除"：合取④（本次驱动真的改过）只存在于写回器。这**是**本刀新增的可伪造面，D10.1 原先写"不是本刀引入"是错的，已改写。⇒ 见 D14。 |
| i3 | Critical (completeness) | **采纳** | `dualClosedDeepReviews`（`:964`）与水位（`qm6-tier-watermark.js:108`）的采样域都按闭环白名单过滤，而派生产物的 status 恒为 `self_play_blocked` ⇒ 第三档 `c` **结构性恒 0**，`a+b+c==external` 由构造恒真（装饰性锁的又一落点：锁测的那一格根本进不了域）。⇒ 见 D15。 |
| i4 | Warning (security) | **采纳（升级为必须）** | 实测现网引擎 `:481-484`：`highRiskDomains` 非空就 push `hrre` 并 **return**，`verdict==='upheld'` 那一格在其后 ⇒ 被裁决判**指控成立**的高危项，reason 也是 `hrre`。我的 D2 第 6 格接受 `verdict ∈ {upheld, dismissed}`，等于把真缺陷一起解除，与 proposal 刻意不做第 3 条直接矛盾。⇒ honored 项的 verdict MUST 逐字 `dismissed`，新增 `honor-upheld-assertion`。 |
| i5 | Warning (consistency) | **采纳** | 判据侧没有 `expectedCritic` 输入；取 `record.reviewBackends.critic` 会让那条锚点退化成字段自比（写回侧才有牙）。⇒ 判据侧从 `scripts/lib/ccg-review-backends.js` **现读清单**，覆盖态按 `reviewBackends.overridden` 分支；并加接线锁：改成自比即红。落 D3。 |
| i6 | Warning (feasibility) | **采纳** | 「复用判据既有 url 档」与「lib 零 require」互斥：`ccg-review-writeback.js:35` 已 require 判据本体，lib 反指会形成**加载期半初始化**环（`evidenceForm` 解构到 undefined，调用即 TypeError）。⇒ 形态判据的落点改为 D4 重写的那份：lib 持有唯一严格正则，写回器**改为引用它**（净减一份副本），判据侧 `evidenceForm` 的 url 档只是它的**超集**，用单向包含锁钉住。 |
| i7 | Warning (consistency) | **采纳** | 控制流矛盾：① 先于 ③（`:121` vs `:132`），若在 ① 就算派生，则 `performedBy===期望后端` 且 `status=self_play_blocked` 的产物会落 `spoke=closed-status-derived` 但 `basis='delivery'`（写出 `delivery@`、`tierBasis` 缺席）——spoke 声称走了放宽路径，读数却把它计进 `a` 档；同时 tasks 2.3 那条锁会红。⇒ 派生**只在 ③ 选定 self-play 出口之后、该出口之内**计算。落 D5 重写。 |
| i8 | Info (clarity) | **采纳** | honor 复用 `verdicts-incomplete` 这个词，而 `adjudicationRejection` 在"整份 findings"维度返回同名红因 ⇒ 召回锁按字符串集合遍历时，③ 的用例就能把该成员记为"已命中"，honor 那一格可以永不点火。⇒ 改名 `honor-verdicts-incomplete`，两条用例红集互不相同。 |

## D13 派生与合取③ 的 `blocking` 那一格互斥 ⇒ 豁免只准作用于那一格（轮 1′ i1，Critical）

现场：写回器 self-play 出口的第一件前置就是 `blocking` 必须是**空数组**
（`ccg-review-writeback.js:246`，红因 `blocking-not-empty`）。而本刀的存在理由恰恰是
"`blocking` 里全是被高危复核满足的那几条" ⇒ **非空**。不处理这一格，整条路径落地即不可达，
且 D0 实测主干该形态 0 条 ⇒ 没有任何断言会因此变红（本刀要消灭的"能力静默消失"在仓内重演）。

处置：`adjudicationRejection` 增加一个**由调用方显式传入**的 `closureDerived` 标志，
它**只**豁免 `blocking-not-empty` 这一格；其余五格（URL 形态、请求后端一致、`confidenceWeight`、
逐条 `verdict`/`rationale`、以及"blocking 必须真的每条都被覆盖"由 honor 自己保证）一字不动。

为什么豁免写成"只这一格"而不是"派生成立就跳过 ③"：派生解释的是**状态词**（引擎那句
"被高危项挡住"），③ 解释的是**这一轮到底是谁做的、公开出处在哪**。把两者合并，
等于让"我自己判自己闭环"顺带把"谁评审的"也免了——那正是本仓给 QM-6 记过的范畴错误。

变异靶（tasks 6.2 M16）：把豁免扩成整条跳过 `adjudicationRejection` ⇒ MUST 红在
"self-play 出口 + `reviewBackends.critic` 不一致 ⇒ 仍 `backend-request-mismatch`"那条用例上。

## D14 判据侧接受派生 = 新增一条可伪造面，必须登记并尽量补同源约束（轮 1′ i2，Critical）

事实：合取④（"本次驱动真的产出过"：动手前后字节与语义指纹都变）只在写回器里，`honorRejection`
没有任何等价物。因此判据单方面认派生后，一份**静态手写**的
`status=self_play_blocked` + `blocking` 全为 `hrre` + 每条 `externalReview` 齐备
+ 手写 `tier/tierBasis/adjudicationDigest`（摘要任何填写方可一条命令自算）的产物
就能被判成闭环——而写回器对同一份产物会拒绝。两档不对称本身就是信号：**判据比工具松**。

处置两半，都要做：

1. **如实登记**：D10.1 那句"不是本刀引入"是错的，已改写为"本刀新增的可伪造面，从『整条记录』
   扩到『每条高危项各一个块』，并在判据侧不再被 ④ 挡住"。这条不得靠删文字消解。
2. **能补的同源约束**：判据本来就能读 base blob（转变核对已在读 `readAtBase`）。新增一条同源判据：
   **若该产物在本次差量里有 base 版本**，则 base 的 `deepReview` 语义指纹 MUST 与 head 不同
   （复用 `deepReviewFingerprint`，不重抄）。取不到 base（新增 A 形态）时**不判红**，
   但 MUST 计入"未证实"读数并逐条打印 —— 与既有那句「⛔ 不得把工具的失明读成『没有欠账』」同口径。
   这一格能挡的是"改一个词就把一条历史 pending 翻成派生闭环"，挡不住"当场伪造一整份"；
   后者仍只有那条公开评论负责。差量语义的边界必须写进红文案，不得让读数看起来像更强的保证。

## D15 采样域必须扩到派生态，否则第三档恒 0、求锁恒真（轮 1′ i3，Critical）

现状两处按闭环白名单过滤：`dualClosedDeepReviews`（`check-pr-exec-record.js:964`）与
水位计的同一判据（`qm6-tier-watermark.js:108`）。派生产物的 status 永远是 `self_play_blocked`
（proposal §四.4：本刀绝不回写驱动字段）⇒ 它进不了 `total`，`c` 结构性恒 0，
而 `a+b+c==external` 由构造成立——**一把永远不会红的求锁，就是本仓说的装饰性门禁**，
而且它恰好装饰在这一刀最该被看见的那一格上（"有人开始用这条放宽路径了没有"）。

处置：采样域统一改为「白名单直判 ∥ `honorRejection` 通过」，且必须与 3.1 的闭环判定**同源同一把函数**
（否则采样域与欠账判据各算一份，读数与门禁会漂移）。新增两条硬断言：
① 一份**真的** `status=self_play_blocked` 派生产物 MUST 出现在 `total` 与 `c` 里
（不许用手工伪造 `status=cleared` + `tierBasis=honored` 过测——那正是 D5 末尾"不得染色"要拦的形状）；
② 变异 M17：把采样域退回白名单 ⇒ ① 那条用例必须红。
`c=0` 仍是健康态（D0 实测适用人群 0 条），但它从此是**测出来的 0**，不是**构造出来的 0**。

## D16 变异反证（20 条全部实跑，红集互不相同；驱动 `h-mutate.cjs`，数字取自 squash 后基线 `2d06aad9a` 的重跑）

三条护栏（都对应本仓已发生的事故）：动手前先跑一遍被测锁**必须全绿**且断言**工作树 == HEAD**
（否则还原目标本身可能是脏的）；每轮 mutate 前重新断言当前字节 == 启动基线；查找串**不唯一即拒**，
不按位置猜。收口一律 `process.exitCode`，绝不在 `try` 里 `process.exit()`（那会跳过 `finally`，
把文件留在变异态）。这三条当场各抓到一次：第一轮 squash 前我带着未提交的 i2 修复去跑，
驱动直接 `REFUSE: 工作树与 HEAD 不一致，还原基线不可信` 拒跑（护栏有牙，不是摆设）。

| 变异 | 摘掉的是什么 | 结果 | 红/指名 | 红集宽窄如实标注 |
|---|---|---|---|---|
| M1 | `honorRejection` 恒返回 null | CAUGHT | 36 / 7 | 整片负例齐红，属预期；与 M2 的 9 条红集可分辨 |
| M2 | 删 status 资格面（只看 blocking 形状） | CAUGHT | 9 / 7 | 七档 status 逐个那条 + 形状巧合那条 |
| M3 | 穷尽性改成"含一条 hrre 就行" | CAUGHT | 4 / 1 | 混合、全 upheld、大小写变体、召回锁 —— 四条互不相同 |
| M4 | 删 `evidenceRef === boundEvidence` | CAUGHT | 3 / 1 | unbound、去重正例的反面、召回锁 |
| M5 | 删自证形态负向判据 | CAUGHT | 2 / 1 | 自证那条 + 召回锁 |
| M13 | 删共享 URL 时 rationale 去重 | CAUGHT | 3 / 1 | 两条去重用例 + 召回锁；**"共享但文案不同"那条正例未红**（实现不是靠"一律禁止共享"蒙过） |
| M6 | 写入侧另算一次 trim | CAUGHT | 1 / 1 | 接线锁指名那条，红集唯一 |
| M11 | 把派生资格面前移（① 先于 ③） | CAUGHT | 3 / 1 | 另有两条既有用例一起红 ⇒ **防御重叠**；红集与 M23 不重叠（M11 打在写回器套件、M23 打在判据套件） |
| M14 | 派生成立即跳过整条 ③ | CAUGHT | 2 / 1 | 两条定向豁免用例（`confidenceWeight` / `backend-request-mismatch`） |
| M7 | 判据侧期望后端退回字段自比 | CAUGHT | 1 / 1 | i5 那条，红集唯一 |
| M8 | 第三档并进第二格 | CAUGHT | 2 / 1 | 三档求锁那条 + 采样域那条（后者被牵连，不是同一条判据） |
| M9 | `classifyEvidenceTier` default 改放行 | CAUGHT | 1 / 1 | 未知 basis 那条 |
| M12 | 在消费方里重抄那份 reason 字面量 | CAUGHT | 1 / 1 | 单一实现锁 |
| M17 | 判据侧采样域退回白名单 | CAUGHT | 1 / 1 | 派生态进分母那条 |
| M18 | 删有 base 时的语义指纹同源约束 | CAUGHT | 1 / 1 | 同源约束那条 |
| M22 | 删"必须带工具的章"这一格 | CAUGHT | 2 / 1 | unsigned 那条 + 高危面反向半条 |
| M23 | 把派生算在闭环白名单之前（染色） | CAUGHT | 25 / 1 | **重度防御重叠**：这一步改动会让 25 条用例红，"三态各自分明"只是其中被指名的一条。列在这里是因为实现轴轮 1 i4 要的正是"两把锁能否分别失效"——答：M11 与 M23 的**指名靶不同、红集不相交**（写回器套件 vs 判据套件），可以分别检出 |
| M24 | 删派生的「无 base 可比」记账 | CAUGHT | 1 / 1 | i2 落点那条；其反向半格（有 base 且指纹变了 ⇒ 账归零）保证它不是恒计 |
| M10 | 把 `self_play_blocked` 加进闭环白名单 | CAUGHT | 9 / 1 | 反捷径锁指名那条，另 8 条是"假定该词未闭环"的既有用例 ⇒ **防御重叠**，这 8 条不能替代那条逐字枚举锁 |
| M21 | 水位侧采样域退回白名单 | CAUGHT | 1 / 1 | 真临时仓跑真工具那条 |

汇总：`MUTATION-SUMMARY 跑了=20 未被指名抓住=0 驱动自身故障=0`。


**两轮驱动的现场教训（记下来比红集更有用）**：第一轮有两条报 `DRIVER-FAULT 查找串取不到`
（M18 / M10 的多行锚点）。当时我先用 `grep -c $'\r'` 判行尾，它对纯 CRLF 文件报 **0**，
而按字节数互证是 `CR=1492 / LF=1492 / CRLF=1492 / loneLF=0` —— **是探针瞎，不是文件是 LF**。
若照那个读数写下"锚点取不到说明实现变了"，就会把驱动失明写成一条不存在的实现漂移。
口径：锚点一律取单行；行尾判断必须 CR / LF / CRLF 三个量互证，不得只信一个探针（详见 D0 那条同类取数教训）。

**刻意没做的两条变异**：① 把 `EVIDENCE_URL_RE` 放宽（那条由"两侧同为垃圾但逐字相等"的用例正面守住，
变异只会红在同一条用例上，不增加信息）；② 把 honor 的 rationale 去重反向改成"一律禁止共享"
（M13 的红集已经证明正例 `1.3b` 未被牵连，等价于这条变异已跑过）。

## D17 实现轴轮 1 的处置（critic=claude 真跑，交付 4 条：Critical 3 / Warning 1；最低维分 5=correctness）

引擎走自扮演档（`reason=stall/maxRounds 后自扮演裁决`，置信权重 0.6），`requiresExternalReview=[{id:i3, domains:[crypto]}]`。
裁决模板落 `.adversarial/ccg-deep-3a9fc062/adjudication.json`；第一趟未填裁决 ⇒
写回器如实打 `未写回 reason=not-closed … performedBy="self-play(pending)"` —— **pending 态拿不到章**，
这一格不是缺陷，是设计里"直签档不获得派生"的正面体现。

逐条处置（先实测再判，驳回的两条都给了现场读数）：

| # | 档 | 判定 | 依据 |
| --- | --- | --- | --- |
| i1 | Critical | **驳回** | 它断言"第二出口产物被读成欠账、b 档永远为 0"。实测：拿真形状（`status=self_play_resolved` + `blocking=[]` + `tierBasis=adjudicated-self-play` + 自洽摘要）跑，`deriveClosure` 回 `{closed:true, derived:false}`，`summarizeTierCoverage` 打 `直签0 自扮演复核1 高危派生0 external=1 sum锁=true`，`dualClosedDeepReviews` 在真临时仓里取到 1 条且 b=1 ⇒ 主张否证。它建议的"blocked + blocking=[] 也算闭环"**不可采**：那是绕开闭环白名单去认一个引擎明写"被挡住"的状态词，正是 §D2a 那条反捷径锁要拦的形状。 |
| i2 | Critical | **采纳一半** | 成立的那半：设计文档写了「取不到 base 时 MUST 计入未证实并逐条打印」，而实现只计了总数 ⇒ 规格与实现脱节，已补 `unverified` / `unverifiedList` 两个字段与 `HONOR-DERIVED … 无 base 可比=n 清单=…` 读数行，并配 M24 变异。不采的那半：它建议"加进 reasons"。A 形态（新产物）就是生产路径的正常形态，把它判红等于要求"改判据之前必须先有一份 base"，与缺陷 G 那次「对 single 也要求闭环 ⇒ 无法闭合的循环」同型。所以这笔账**只可见、不阻断**，并另配一条"有 base 且指纹真的变了 ⇒ 账必须归零"的反向半格，防它退化成恒计。 |
| i3 | Critical | **驳回** | 它担心 `deepReviewFingerprint` 未导出 ⇒ ReferenceError。实测 `typeof === 'function'`，导出清单在 `lib/ccg-delivery-digest.js:132-146` 原样含它。评审载荷是 committed diff，看不到没被改的那个文件 —— 这是视野边界，不是缺项。（它另半句"同步更新 deep-review-deps 测试清单"本轮已做：两份手抄闭包清单都补了 honor 模块。） |
| i4 | Warning | **采纳（并订正它引用的一条）** | 它引用的 "M11/M20 红集重叠" 里 **M20 不在本轮跑过的清单**（它与我列的 M11 同靶，落地时合并成一条，见 §D16 表）。但实质顾虑成立：两把锁若共享红集，删掉其一不会被独立检出。⇒ 新增 M23（把派生算在闭环白名单之前，靶是"三态各自分明"那条）与 M24（删掉未证实记账），使"染色"与"资格"两格各有独立红靶；M10 的防御重叠继续如实标注，不假装可分辨。 |

## D11 设计轴评审处置（轮 1 critic=claude，7 条：Critical 2 / Warning 3 / Info 2；最低维分 6=consistency/clarity/security）

评审输入是 proposal+design+spec+tasks 的一次性拼接（23853 字符）。proposer 轴（opencode）在 28274 字符
载荷处**同步拒绝**（实测上限 7800，文案自报长度构成），故本轮无修订轮、整链 rc=2 升级人工。
`ccg-review-degradation-ladder` 那条欠账第三次显形，且这次是**决策层**（不是代码轴）。

逐条处置（采纳内容、不照抄实现）：

| # | 档 | 判定 | 依据与落点 |
| --- | --- | --- | --- |
| i1 | Critical | **采纳一半** | 它说"多条共用一条 URL ⇒ 一次复核解除多条"。共用**公开载体**是现实形态（一份评论覆盖多条指控），要求每条各一条 URL 只会造出 N 份指向同一处的假独立。但它指出的真问题成立：同一份 `rationale` 复制粘贴 N 遍确实能一次解除多条。⇒ 新增 `honor-rationale-duplicated`：≥2 条 honored 项共享同一 `evidenceRef` 时，其 `rationale` 必须两两不同（trim 后逐字比）。驳回它建议的"覆盖声明字段"：没有任何东西能验证那份声明，属装饰。落 D2 第 6 格、spec §一、tasks 1.3/6.2 M13。 |
| i2 | Critical | **采纳** | 实测它的顾虑是真的：现有三处白名单锁（`ccg-review-decider.test.js:682-683`）取的是 `[...shared].sort()` vs `[...decider].sort()` 的**实现间相等**，三处同时加 `self_play_blocked` 照样过锁。⇒ 本刀的 3.6 必须逐字枚举三词 + 显式断言 `!has('self_play_blocked')`，并写明"不得由那条相等锁代替"（两者测的不是同一件事）。落 D2a。 |
| i3 | Warning | **采纳** | 断言散在 spec 的染色 Scenario 里，tasks 没点名。⇒ tasks 2.3/4.2 各补一句可执行断言：`status=cleared` 的产物 `tierBasis` MUST 缺席且 `c` 不增长；M11 的靶子明确挂到这条。 |
| i4 | Warning | **驳回改名，采纳其要求** | 它说"未触发态无显式返回值"。事实：直判那格 spoke 落 `closed-status`，派生那格落 `closed-status-derived`，两个词都在读数是显式的，不靠"没调用"推断。它建议把直判改名 `closed-status-direct` **不可采**：`ccg-review-writeback.test.js:91` 用 `deepStrictEqual(spoke.sort(), [...])` 逐字钉了那个集合，改名等于把已交付的锁拆掉，而且"direct/derived"的对称性收益小于一把既有锁的断裂成本。 |
| i5 | Warning | **采纳** | tasks 1-6 确实没有一条处理 advisory/enforce 分叉。⇒ 新增 tasks 3.8（同一份派生产物在两档各跑一次：advisory 仍 `exit 0` 且点名派生；enforce 才判 OK/欠账）。 |
| i6 | Info | **采纳（它指出的顺序真存在）** | 派生算在合取①、`backend-request-mismatch` 查在合取③，所以"① 派生成立但 ③ 拒绝"是一个会出现的中间态。⇒ tasks 2.1 明确写：派生**不得**短路 ③，且此时红因 MUST 是 `backend-request-mismatch`（不得塌回派生那组的任一 reason）；红文案里 `closed-status-derived` 会留在 spoke 上，那是如实读数不是矛盾。 |
| i7 | Info | **驳回** | 它建议"扫描时排除字符串字面量"。实测本仓 `stripCommentsForScan`（`check-pr-exec-record.js:202`）是**引号感知剥注释**，且它自己的用例 `check-pr-exec-record.test.js:1198` 明确断言 `msg = '允许 ' + PH` **不被剥掉** —— 保留字面量是刻意的。而本刀 3.7 要禁的正是那两个消费方文件里的字面量（那份字面量就是重复实现本身），排除字面量等于把锁拆了。md 排除已由 3.7 写明，无需改动。 |

## D18 实现轴轮 2 的处置（critic=claude 真跑，HEAD `8910d63e`，交付 8 条：Critical 2 / Warning 3 / Info 3；最低维分 5=security；待裁决 5 条、其中高危域须外部复核 1 条）

采纳 5 条（i2/i3/i4/i5/i6，全部当场落代码 + 落锁并实测）、驳回 1 条（i1，给可证伪的理由而不是"下一刀再说"）、
另两条 Info（i7/i8）登记为"部分已覆盖 + 跟进项"。**本轮修完重跑一轮**，让新 HEAD 的 critique 成为被裁决的对象 ——
不拿"我已说过要改"当已改完的证据。

| # | 档 | 判定 | 落点与依据 |
| --- | --- | --- | --- |
| i1 | Critical(security) | **驳回（作为本 PR 的阻断项）** | 它说 A 形态（无 base 可比）+ 自洽摘要可伪造出闭环。这风险我在 §D14 已自登记，争的不是"有没有"而是"是不是本刀新增"。实测：本刀之前手写 `status=self_play_resolved` + `tier=external` + 手写 URL **就已经能过判据** —— `judgeBackendMismatch` 对 `self_play_resolved` 写死"自扮演闭合走它自己的审计路径，本判据不插手"（`check-pr-exec-record.js:1321`），而写回器文件头记着 #3987 / #4071 的 tier 就是手写的。⇒ 派生档没开出新绕行，只是让机器也能走那条已经敞着的门。真正的收窄是"产物文件名 = 差量内容寻址"的重绑定判据，属另一个机制，另立一刀（已登记在 §D10 与本节末）。 |
| i2 | Critical(security) | **采纳** | 反捷径判据从"只有测试会红"升级为**模块加载期抛错**：`lib/exec-record-statuses.js` 初始化时断言派生资格词不在闭环白名单内，任何消费方 require 即炸。配一条行为锁：复制模块、真的塞进那个词、spawn 子进程要求它抛 `exec-record-statuses 自检失败`；同时正控要求原样加载必须成功 —— 少这条正控，"反控炸了"可能只是文件本身坏了。⚠ 它建议的另一半被当场否证：`Object.freeze` 一个 Set **挡不住** `.add()`（元素在内部槽，不是属性），所以两句都写、只有断言有牙。 |
| i3 | Warning(security) | **采纳** | 真源模块头写明：`EVIDENCE_URL_RE` 认的是"这是一个公开可点开的 PR 评论地址"，**不**是"点开之后内容确实复核了这一条"；要核证据的人应逐条点开比对 critique 原文与逐条处置，判据红绿都不替代这一步。等于把边界从 §D10 的散文搬读到代码的人第一眼的位置。 |
| i4 | Warning(maintainability) | **采纳（实测成立）** | 三个子档名确实抄在判据、水位计与两边测试里 —— 任一处漏改，`a+b+c == external` 就变成"两个字符串自己跟自己比"。⇒ 收进真源 `TIER_BUCKETS`（冻结），两消费方 require 它；新增锁：两文件**剥注释后**不得再打这些字面量且必须出现 `TIER_BUCKETS` 引用，同时逐字枚举三个桶名（改名要同次改判据、水位与文案）。 |
| i5 | Warning(correctness) | **采纳** | `honorRejection` 内补显式三档映射注释：`dismissed` 继续 / `upheld` 出 `honor-upheld-assertion` / 其它任何值（含缺席、拼错、非字符串）出 `honor-verdicts-incomplete`。两档都出声、不静默放行 —— 合并成一格，人会去补错的那一格。 |
| i6 | Info(performance) | **采纳** | 逐条 `findings.filter` 是 O(blocking × findings)，而判据本体每次 PR 都跑 ⇒ 改为一次建 `id → [findings]` 索引。刻意保留**数组**值而不是单对象："同 id 两条"本身是要出声的一格（`honor-item-ambiguous`）。 |
| i7 | Info(maintainability) | **部分已覆盖** | 判据对**本次变更集内**的产物已有"解析不动 ⇒ 出声并计入未证实"的落点（`unparsed`）；它建议的"历史全量 JSON/schema 体检"是另一件事，登记为跟进项，不在本 PR 假装做了。 |
| i8 | Info(security) | **已在做** | 边界一直写在 §D10.1（本刀新增两段可伪造面）、spec 的强度边界段、AGENTS 的"这一档仍不是签名"与本记录；本轮又按 i3 搬进代码注释。跟进项即 i1 的内容寻址重绑定。 |

**为什么这一轮不直接签字**：`8910d63e` 的 critique 里 i2/i4 是我认账的缺陷 ⇒ 在这份产物上判 `dismissed` 就是说谎；
把成立的指控写成不成立，与手写 `tier` 是同一类代用，而本刀的立论恰恰是"不必再靠手写"。
⇒ 修完重跑一轮；旧 sha 的产物随 squash 一起消失，不给主干留未闭合记录。

## D19 实现轴轮 3 的处置与「首次用仓内派生档签字」现场（critic=claude 真跑，HEAD `f401591e7`，交付 6 条：Critical 3 / Warning 3；最低维分 3；待裁决 6 条、其中高危域须外部复核 2 条）

**本轮可以签字，与 §D18「不可签字」是同一条纪律的两面**：§D18 拒签是因为那轮的 i2/i4 是我认账的真缺陷，
在那份产物上判 `dismissed` 就是说谎。本轮 6 条经逐条实测**没有成立指控**，每条 `dismissed` 都附一个可重跑的读数
（下表第 4 列），不是"我已说过要改"那种代用。公开出处 = 本 PR 的一条评论（critique 原文 + 逐条处置），
`evidenceRef` 绑的就是它。

| # | 档 | 判定 | 定案用的实测读数（不是措辞） |
| --- | --- | --- | --- |
| i1 | Critical(auth) | **驳回** | 它说内容绑定"只在 `evaluateDeepReviewDebt`，不在读派生的那条路径"。实测反证：`deriveClosure` 要求 `classifyEvidenceTier(dr, existsAt) === 'external'`（`check-pr-exec-record.js:822`），该函数在 `tierBasis` 非空分支里就地重算并比对 `adjudicationDigest`（`:988`）。探针：一份齐备产物盖章后把任一条 `verdict` 改 `upheld` 而不重算摘要 ⇒ `tier=external-unverified`、`deriveClosure().closed=false`。残余那格（当场伪造一整份含重算摘要）是模块头注释 19–24 行、AGENTS「不是签名」与 §D14 三处写明的**声明边界**，负责它的是那条评论本身。 |
| i2 | Critical(crypto) | **驳回** | 「does not close it with a digest binding within the derivation check」直接与 `:988` 矛盾；摘要由写回器在盖章同刻写入（`ccg-review-writeback.js:238`）。**探针另抓到一条如实不对称**：摘要覆盖 `findings + evidence`，**不**覆盖 `blocking`；`blocking` 由逐条复核那一格守 —— 探针第 3 行（往 `blocking` 加一条没有复核的阻断、不重算摘要）⇒ `tier` 仍 `external` 但 `closed=false`，红因 `honor-item-absent` 点名缺哪一格。这条不对称本刀不"顺手补进摘要"：那要改已合并档的摘要算法，属另一刀。 |
| i3 | Critical | **驳回（结论错，两半如实登记）** | 措辞层：`existsAt` 确实被消费（`:822` → `:993` 把"路径形态但对象取不到"降档）；"整条绕过"被探针第 2/3 行否证。**承认的两半**：① 对第三档 `evidence` 必为 URL，URL 不做文件系统检查 ⇒ `existsAt` 在该档不产生作用（设计使然，但该写明）；② 新增（A）形态结构上没有 base 可比 ⇒ 语义指纹那道不拦，只进「未证实」账（`:1345` 起，不判红的理由见 §D14 与缺陷 G 那条循环）。①的注释落点**不在本 PR 做**：加注释会改动已提交 diff，使本轮这份正在被裁决的产物与主干字节不同源（本仓「声明与字节必须同源」），留作下一刀，落点与依据写在该评论里。 |
| i4 | Warning | **驳回** | 「没有 graceful path」不准：红文案逐字写着出口（改回白名单），模块注释另写明改它属「改谁来守门 ⇒ 人工过目 + 须同次删派生判据」。防护两道：反捷径逐字枚举锁（`check-pr-exec-record.test.js`）+ 本模块加载期断言；变异 M10 实测 CAUGHT（9 条红、被指名 1 条），两把锁分别跑在 `Gate 2b11` 与 `Gate 2c2`。如实成本也写着：这条断言一炸，三个消费方都起不来 —— 而触发条件是"闭环口径被改成旁路"，那种状态下链子本就不该继续判绿。 |
| i5 | Warning | **驳回** | 指控的事实前提「proposal does not document isolation mechanisms」不成立：§D16 首段逐条写了三道护栏（动手前被测锁全绿 + 断言工作树 == HEAD；每轮 mutate 前重新断言当前字节 == 启动基线；查找串不唯一即拒），并附一次真实拒跑；同表第 5 列「红集宽窄如实标注」就是重叠披露位（M11/M23/M10 三行分别写着防御重叠 / 重度防御重叠，并给出指名靶不同、红集不相交的判据）。汇总行 `跑了=20 未被指名抓住=0 驱动自身故障=0`。 |
| i6 | Warning | **驳回** | 复杂度读反了：`lib/ccg-external-review-honor.js:139-144` 是**单趟**建 `Map<id, finding[]>` + 每条 blocking O(1) 查表，总代价 O(findings + blocking)；那个 Map 恰是轮 2 i6 把嵌套 `filter` 换掉的产物。规模现读（`origin/main` 抽 400 个产物名、解析成功 30 条）：单条记录最大 `findings=8`、最大 `blocking=5`，且判据只扫本次变更集内的产物。 |

### 签字现场（本仓第一次由工具而不是由人签第三档）

```
[ccg-review-writeback] 已写回 tier=external basis=adjudicated-self-play-honored
  evidence=https://github.com/<owner>/<repo>/pull/4453#issuecomment-<id>
  spoke=findings-present|nonempty-findings|closed-status-derived|adjudication-conditions|delivery-changed
```

产物 `.ccg/reviews/34ab93f9….json` 落 `status=self_play_blocked performedBy=self-play tier=external
tierBasis=adjudicated-self-play-honored adjudicationDigest=adjudicated@d8a3da77…`，
`blocking` 两条 `high_risk_requires_external`（域 `auth` / `crypto`），`findings` 6 条 verdict 全 `dismissed`。
读判据链的七条套件在最终树上重跑全绿：honor **43/43**、判据 **154/154**、写回器 **35/35**、水位 **17/17**、
deps **47/47**、entry-rc **11/11**、decider **71/71**；另四把消费者锁 closure-chain **3/3**、
exit-capabilities **25/25**、enforce-preview **23/23**、workflow-contract **46/46**。

### 本轮新抓到的三次"工具失明"（比红集更该记）

① **空参数的批处理与"全部通过"逐字同形**。我跑 `node <本机临时目录>/run-suites.cjs`（忘了传套件文件名），它打印
`BATCH badFiles=0` —— 而 `bad` 是对**空数组**求的。这是本仓「装饰性门禁」第三代的同型：判据没测任何东西时，
它的成功读数必须与"测了且全绿"可区分。口径：批处理必须自己打印**跑了几个**，调用侧另断言参数非空。
（现场：这条是在我准备把 `badFiles=0` 写进记录的那一刹发现的，写进去就会是一条从没测过的"全绿"。）

② **argv 的语义属于被调用那一层**。同一次我把 `check-workflow-structure.js`（一个 CLI 判据，不是测试文件）
喂给 `node --test` 的批处理，得到一行 `rc=1 NO-SUMMARY` —— 那条假失败如果被读成"某个套件坏了"，
就会去找一个不存在的回归。摘掉它单跑：`files=18 violations=0`。

③ **`reset --soft` 站旧检出 = 静默回退上游**。squash 之后 `git status` 露出 6 份文件与 HEAD 不同，
逐份验到它们与 `2d5a636f6^`（上游那一笔 #4474 的父提交）**逐字节相同** —— 也就是说工作树站的是旧 base 的检出，
而 `reset --soft` 不动工作树：任何一次带 `-a` 或让钩子批量 stage 的提交，都会把别人刚合的内容**原地撤掉**，
且 `git diff HEAD^ HEAD` 只会把它读成"我改了这 6 个文件"。修法不是放宽判据而是补一条收尾断言：
`git status --porcelain` 必须为空，且**每一份**与 HEAD 不同的文件都要能说出"是谁改的、为什么"。
本仓口径「rebase/refresh 工作树在任何 `reset --soft` 之前」由此从散文变成这一格的依据。
