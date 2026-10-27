# qm6-review-chain Specification

## Purpose

本能力定义 QM-6 复核链里「高危域阻断该不该算已被真外部复核解除」这一格的**归属与资格**：这段判定 MUST 住在仓内、
由版本化判据持有，MUST NOT 依赖仓外未版本化脚本的一份本地补丁（那份补丁被换掉时，能力当场消失而仓内没有任何东西因此变红）。
六条 Requirement 的分工是：① 判定真源的位置与共用面；② 派生闭环的资格面 MUST 窄到引擎那句"被高危项挡住"的字面语义，
逐格红因不得合并成因；③ 派生只准豁免 `blocking-not-empty` 那一格，其余合取一字不动；④ 第三档 MUST 在覆盖率与水位读数里
单独成档、三档之和恒等于 `external`（放宽要可见）；⑤ 采样域 MUST 含派生态，否则"该形态 0 条"是被构造出来的 0 而不是测出来的 0；
⑥ 判据侧接受派生是**新增一条可伪造面**，MUST 登记并在能被机械守住的那一半补上同源约束。

边界（不在本能力内）：高危面**清单本身**与「由判据 require 闭包派生」的规则不在此定义（现状在
`scripts/check-pr-exec-record.js::HIGH_RISK_SURFACES`，收紧片见 `openspec/changes/ci-judge-surface-coverage/`）；
本能力只回答"已经命中高危面之后，阻断能不能被解除、凭什么"。
## Requirements
### Requirement: 「高危域阻断已被真外部复核满足」这段判定 MUST 住在仓内，且 MUST NOT 由仓外未版本化脚本决定

授权来源：用户在 2026-10-25 就「外部复核可解除阻断这件事住在仓外 vendor 脚本的一个本地补丁里、
且已被换掉」的三选一中明确选择「把 honoring 逻辑搬进仓内判据（治本）」。

现场事实（本轮取证，重取见 `openspec/changes/qm6-external-review-honor/design.md` §D0）：
生效的 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`（mtime `2026-10-24 11:48`）
只要 `highRiskDomains` 非空就**无条件**计阻断、一次都不读 `externalReview`；
同目录 `ccg-deep-review.js.bak-severity`（mtime `2026-10-22 09:55`）**有** `externalReviewSatisfied()`
与 `externallyReviewed` 留痕。PR #4308（merge `b6ef75a83`）能盖 `tier=external` 靠的是那份
**仓外、未版本化、不受本仓 CI 覆盖**的副本；它被换掉后，仓内没有任何一条断言变红。

因此：判定链的**结论**SHALL NOT 取决于一个"谁在什么时候把它换掉"在仓内零痕迹的载体。
系统 SHALL 提供仓内唯一实现 `scripts/lib/ccg-external-review-honor.js`（零 require、零 I/O 的纯函数，
与 `scripts/lib/exec-record-statuses.js` 同规格），导出
`HONORABLE_BLOCKING_REASON`（闭集，逐字 `high_risk_requires_external`）、
`DERIVABLE_CLOSURE_STATUS`（逐字 `self_play_blocked`）与
`honorRejection({ deepReview, record, expectedCritic, boundEvidence })`。

`scripts/ccg-review-writeback.js` 与 `scripts/check-pr-exec-record.js` SHALL 都 `require` 该模块，
SHALL NOT 各自再写一份 reason 比较、`externalReview` 三格判据或 URL 绑定；
两个消费方文件内（剥注释后）SHALL NOT 出现该 reason 的字面量。

#### Scenario: 引擎不再配合时，仓内判据自己就能表达「外部复核已满足」

- **WHEN** 驱动写出的产物是 `status=self_play_blocked`、`blocking=[{id:i5, reason:high_risk_requires_external}]`，
  而 `findings` 里 id `i5` 那条带齐 `externalReview{performedBy, evidenceRef, reviewedAt}`、
  `verdict` 与非空 `rationale`，且 `performedBy` 逐字等于清单里的 critic、`evidenceRef` 逐字等于本次透传的公开评论 URL
- **THEN** 写回器 MUST 以 `tier="external"` + `tierBasis="adjudicated-self-play-honored"` 写入，
  `evidence` 逐字等于那条 URL，并落 `adjudicationDigest`（与第二条出口同一实现）
- **AND** `check-pr-exec-record.js --mode=enforce` 对同一份产物 MUST 判 OK（不得出现"已盖章却报欠账"的不一致）
- **AND** 这条 MUST 由一条端到端锁跑**真实现**（真写回器 + 真判据，只假 git/文件），不得只测纯函数

#### Scenario: 仓外脚本被换回来时，本刀不得变成第二条签字通道

- **WHEN** 上游把 `externalReviewSatisfied` 补回引擎，驱动因此写出 `blocking=[]` 的正常自扮演收口
- **THEN** 派生分支 MUST **不触发**（空数组那一格），走既有 `tierBasis="adjudicated-self-play"`
- **AND** 覆盖率第三档 `external(自扮演+公开复核+高危派生)` MUST 仍为 0
- **AND** 该结果 SHALL NOT 要求本仓改动任何判据——这条"不需要改"必须由上面那条用例证明，不靠承诺

### Requirement: 派生闭环的资格面 MUST 窄到「引擎那句被高危项挡住」的字面语义，且逐格红因不得合并

`honorRejection` 仅在下列全部成立时返回 `null`，任一不成立 MUST 返回**点名那一格**的 reason
（不得把两格合并成一句"条件不满足"——它们的修法相反）：

- `deepReview.status` 逐字等于 `DERIVABLE_CLOSURE_STATUS`；否则 `honor-status-ineligible`。
  其余任何状态一律不进派生，**包括已经在闭环白名单里的三个词**：派生只在合取① 直判不成立时才计算，
  否则一份 `status=cleared` 的正常产物会被染成"走了放宽路径"，第三档读数失去含义。
- `deepReview.blocking` 是非空数组，且**每一条** `reason` 逐字等于 `HONORABLE_BLOCKING_REASON`；
  含任一其它 reason（含 `self_play_upheld`）⇒ `honor-unhonorable-reason`；缺席/非数组 ⇒ `honor-blocking-absent`。
- 每条 blocking 能在 `findings` 里按 `id` 找到**唯一**对应项 ⇒ 否则 `honor-item-absent` / `honor-item-ambiguous`。
- 该项 `externalReview.performedBy` 逐字等于上层透传的 `expectedCritic`（仓内清单真源），
  且**不得**命中自证形态（`/self[-_]?play|^agent$|内部模拟/i` ⇒ `honor-self-refuting`）；
  同时 `record.reviewBackends.critic` 必须逐字等于同一个 `expectedCritic`（沿用既有 `backend-request-mismatch`，
  不新增第二个红因）。
- 该项 `externalReview.evidenceRef` MUST 命中该模块**唯一持有**的 `EVIDENCE_URL_RE`
  （`ccg-review-writeback.js` 原有的 `ADJ_URL_RE` 字面量删除并改为引用它 —— 净减一份副本）
  ⇒ 否则 `honor-evidence-form`；判据侧的 `evidenceForm` 是可核指针的**超集**，
  两者关系 MUST 由一条**单向包含锁**钉住（命中 honor 正则 ⇒ `evidenceForm==='url'`），
  SHALL NOT 做双向相等（那会把主干既有形态的历史收口判红）。
  honor 模块 SHALL NOT require 任何本地模块：`ccg-review-writeback.js` 已 require 判据本体，
  lib 反指判据会形成加载期半初始化环（`evidenceForm` 解构到 `undefined`，调用即 TypeError）。
- **且** `evidenceRef` 逐字等于 `boundEvidence` ⇒ 否则 `honor-evidence-unbound`。
- 该项 `externalReview.reviewedAt` 可被 `Date.parse` 解析 ⇒ 否则 `honor-reviewed-at-unparsable`。
- 该项 `verdict` MUST 逐字等于 `dismissed` ⇒ `upheld` 时红因 `honor-upheld-assertion`；
  rationale 缺失/空白 ⇒ `honor-verdicts-incomplete`（**带前缀**，与 `adjudicationRejection`
  在"整份 findings"维度用的 `verdicts-incomplete` 分开，否则红因召回锁会把别人的用例算作本格的命中）。
  这条不接受 `upheld`，理由是按现网引擎实测：`highRiskDomains` 非空时 push `hrre` 后直接 `return`，
  `verdict==='upheld'` 分支永远轮不到 ⇒ 被裁决判**指控成立**的高危项其 blocking reason 也是 `hrre`，
  接受 `upheld` 等于把真缺陷连同伪阻断一起解除。
- 当 ≥2 条 honored 项的 `evidenceRef` 逐字相同时，它们的 `rationale`（去首尾空白后）MUST NOT 出现重复
  ⇒ 否则 `honor-rationale-duplicated`。**这条是轮 1 评审 i1（Critical）的采纳项**：共用一条公开评论是现实形态
  （一次复核覆盖多条指控），硬拆成每条一个 URL 只会造出 N 份指向同一处的假独立；
  不可共享的是**逐条处置的理由**——同一段文案复制 N 遍去解除 N 条阻断，那不是 N 次处置。
  驳回该评审建议的另一半（"增加覆盖声明字段"）：没有任何东西能验证那份声明，属装饰性判据。

`scripts/lib/exec-record-statuses.js` 的 `CLOSED_DEEP_REVIEW_STATUSES` MUST 逐字保持
`{cleared, needs_revision, self_play_resolved}` 三词，SHALL NOT 因本刀加入 `self_play_blocked`；
并 MUST 有一条锁钉住这一点，红文案写明"加那个词等于把逐条复核判据整条旁路"。

#### Scenario: 混合 reason 的阻断必须继续拦，且不能因为"逐条都有复核"而放行

- **WHEN** `blocking=[{id:i2, reason:high_risk_requires_external}, {id:i3, reason:self_play_upheld}]`，
  且 i2 的 `externalReview` 三格齐备、i3 也有 `verdict`/`rationale`
- **THEN** 不写，`reason=honor-unhonorable-reason`，detail MUST 点名是 i3 与它的 reason
- **AND** 主干现读 11 条 `self_play_blocked` 中 8 条全为 `self_play_upheld`、3 条混合，
  本条用例的形状 MUST 覆盖"混合"与"全 upheld"两格（缺任意一格，实现可以靠"只检查有没有 hrre"蒙过）

#### Scenario: 形状巧合不得当资格

- **WHEN** 一份 `status=pending`、`blocking=[{id:i1, reason:high_risk_requires_external}]` 且该条复核"齐备"的产物
  （主干上 898 条 pending **现在恰好**没有 `blocking` 字段，那是版本巧合不是语义保证）
- **THEN** MUST 判 `honor-status-ineligible`，不得写入 `tier`
- **AND** 这条锁存在的原因就是"只看 blocking 形状"那一版实现会在此格放行，红文案写明这一点

#### Scenario: `evidenceRef` 指向别处的真实公开评论不算本条复核

- **WHEN** `externalReview.evidenceRef` 是一条形状合法、真实存在、但**不等于**本次 `boundEvidence` 的 PR 评论 URL
- **THEN** 不写，`reason=honor-evidence-unbound`
- **AND** 判据侧 MUST 就地重算 `adjudicationDigest`，两侧任换其一即失配降 `external-unverified`

#### Scenario: 两条消费路径的 boundEvidence 来源不同，各自必须有接线锁

- **WHEN** 检查 `ccg-review-writeback.js` 与 `check-pr-exec-record.js` 的调用点
- **THEN** 写回侧传入的 MUST 逐字是它随后写入 `deepReview.evidence` 的那个表达式
  （拆成两个变量——一个取未 trim 的入参、一个取 trim 后的值——MUST 让锁变红）
- **AND** 判据侧传入的 MUST 是 `deepReview.evidence` 本身（改成再读某个入参 MUST 让锁变红）
- **AND** 两侧取值来源的这句不同**是刻意的**（"即将写进去的值" vs "已经写着的值"），SHALL NOT 被"顺手统一"

### Requirement: 派生只准豁免 `blocking-not-empty` 那一格；合取②③④⑤ 其余各格一字不动

派生解释的只是**合取①（状态词）**，而① 的派生 MUST 只发生在 self-play 出口之内：
`performedBy === expectedCritic` 的直签档遇到非闭环 status 仍走 `not-closed`，
且 spoke MUST NOT 出现 `closed-status-derived`（否则"走了放宽路径"这句话与覆盖率里的 `a` 档互相指认）。

self-play 出口的六件前置里，**有且只有 `blocking-not-empty` 这一格**在派生成立时被豁免，
豁免的语义是"每一条 blocking 都被 honor 逐条覆盖过"（这正是 `honorRejection` 已经证明的东西），
SHALL NOT 实现成"派生成立即跳过 `adjudicationRejection`"。
理由（只读评审 i1，Critical，实测成立）：该出口原本要求 `blocking` 是**空数组**，
而本刀的存在理由恰恰是它**非空** —— 不处理这一格，主场景机制上不可满足，
且主干该形态现读 0 条 ⇒ 落地后没有任何断言会红（本刀要消灭的"能力静默消失"会在仓内重演）。
其余五格（URL 形态、请求后端一致、`confidenceWeight < 1`、逐条 `verdict`/`rationale` 齐备）
MUST 照常触发；`reviewBackends.critic` 不一致时红因 MUST 仍是 `backend-request-mismatch`，
SHALL NOT 塌回派生那组的任一 reason，也 SHALL NOT 因"已派生出闭环"而被跳过
（spoke 里同时出现 `closed-status-derived` 与该失败红因是**如实读数**，不是矛盾 —— 轮 1 评审 i6）。

`QG Changes` 的 Gate 2c2 现以 `--mode=advisory` 运行（既有欠账，本刀不转 enforce）。
因此同一份派生产物在两档下的行为分叉 MUST 各有一条用例：advisory 档打印点名但 `exit 0`，
enforce 档才把"派生成立"计入 OK、把"派生不成立"计入欠账。
本刀 SHALL NOT 顺手把该步转成阻断——那属改「谁来守门」，须人工过目（AGENTS 既有口径）。

#### Scenario: 派生豁免只覆盖那一格

- **WHEN** 派生成立但 `confidenceWeight` 缺席（或 `reviewBackends.critic` 与期望后端不一致）
- **THEN** MUST 拒写，红因是既有的 `confidence-weight-absent` / `backend-request-mismatch`
- **AND** 把豁免扩成"跳过整条 `adjudicationRejection`"的改动 MUST 让该用例变红（tasks 6.2 M16）

#### Scenario: 直签档不获得派生，spoke 也不染

- **WHEN** `performedBy` 逐字等于期望后端、`status=self_play_blocked`、findings 里 `externalReview` 三格齐备
- **THEN** MUST 返回 `not-closed`，且 `spoke` **不含** `closed-status-derived`
- **AND** 这条是"① 先于 ③ 算派生"那版实现的红靶（只读评审 i7）

#### Scenario: 派生成立但后端请求值不一致 ⇒ 仍拒写，红因是既有那一句

- **WHEN** 一份 `status=self_play_blocked` 的产物逐条复核齐备（honor 通过），但 `reviewBackends.critic`
  不等于上层透传的期望后端
- **THEN** 不写，`reason=backend-request-mismatch`（**不得**是 `honor-*` 任一个，也不得是 `not-closed`）
- **AND** spoke MUST 保留 `closed-status-derived`，让读数如实显示"① 过了、③ 没过"

#### Scenario: 同一份派生产物在 advisory 与 enforce 下读数不同

- **WHEN** 对同一份 `tierBasis="adjudicated-self-play-honored"` 的产物分别跑 `--mode=advisory` 与 `--mode=enforce`
- **THEN** advisory 档 MUST `exit 0` 并打印它不是阻断；enforce 档 MUST 判 OK
- **AND** 对一份 honor 不成立的同形状产物，advisory 仍 `exit 0`（点名）、enforce MUST 判欠账
- **AND** 两档各一条用例，缺一档即视为该分叉未被锁（轮 1 评审 i5）

### Requirement: 派生档 MUST 在覆盖率与水位读数里单独成档，三档之和恒等于 `external`

`tier` 闭集 SHALL NOT 新增取值（撑开它会抹平档间区别，与 #4308 那条一字不改）。
新增 `tierBasis="adjudicated-self-play-honored"`，并 MUST 被 `classifyEvidenceTier` 当**已认识**的 basis
处理（走 `adjudicationDigest` 就地重算，失配降 `external-unverified`）；未知 basis 继续按 `unrecognized` 拦，
SHALL NOT 为了少写一个 case 把 default 改成放行。

`summarizeTierCoverage` 与 `scripts/qm6-tier-watermark.js` 的 `external` 子读数 MUST 从两档扩成三档：

```
[external(直签)=a external(自扮演+公开复核)=b external(自扮演+公开复核+高危派生)=c]
```

并保留求锁的升级版：`a + b + c == external`，不等即 `WATERMARK-DEFECT`。
`c=0` 是健康态（主干现读 0）；`c>0` 必须被数出来——"改宽"不可见正是零人工收口立项点名的第二条病根。

#### Scenario: 三档求锁必须能抓到"新档没被计入"

- **WHEN** 一批产物含直签、第二条出口、派生出口各若干条
- **THEN** 三个子读数之和 MUST 等于 `external`，且每条产物只进一档（按 basis 判，不按 status 判）
- **AND** 变异"派生档落进 `external(自扮演+公开复核)` 那一格" MUST 让该锁变红（否则三档只是文案）

#### Scenario: 派生档不得被用来给直签产物染色

- **WHEN** 一份 `status=cleared`、`performedBy` 逐字等于 critic 的正常产物
- **THEN** `tierBasis` MUST 缺席（仍是直签档），`evidence` 仍是 `delivery@` 摘要
- **AND** 覆盖率里它 MUST 计入 `external(直签)`，`c` 不因它增长

### Requirement: 覆盖率与水位的采样域 MUST 含派生态，否则第三档是构造出来的 0

`dualClosedDeepReviews`（`check-pr-exec-record.js:964`）与水位计（`qm6-tier-watermark.js:108`）的采样域
现按闭环白名单过滤，而派生产物的 `status` 恒为 `self_play_blocked`（本刀绝不回写驱动字段）。
两处 MUST 改为「白名单直判 ∥ `honorRejection` 通过」，且 MUST 与判据的闭环判定**同源同一把函数**
—— 采样域与欠账判据各算一份，读数与门禁就会漂移（那是另一条欠账的形状）。

理由（只读评审 i3，Critical）：不扩域，`c` 结构性恒 0，`a + b + c == external` 由构造恒真，
这把求锁就装饰在本刀最该被看见的一格上（"有没有人开始用这条放宽路径"）。
`c=0` 从此必须是**测出来的 0**，不是**构造出来的 0**。

#### Scenario: 真的派生产物必须进得了读数

- **WHEN** 一份 `status=self_play_blocked`、`tierBasis="adjudicated-self-play-honored"` 的产物进入变更集
- **THEN** 它 MUST 出现在 `TIER-COVERAGE dual-closed total=` 的分母里，并计入 `external(自扮演+公开复核+高危派生)`
- **AND** 该用例 MUST 用真实 status 构造；用 `status=cleared` + 手写 honored basis 过测是**禁止形态**
      （它绕过的恰是"域按 status 过滤"这一格，与「派生档不得染色」那条要求正面冲突）
- **AND** 变异 M17：把采样域退回白名单 ⇒ 本条 MUST 红

### Requirement: 判据侧接受派生是新增可伪造面，MUST 登记并在可补的那一半补上同源约束

合取④（本次驱动真的产出过：动手前后字节与语义指纹都变）只存在于写回器，`honorRejection` 无等价物。
因此判据单方面认派生后，`self_play_blocked` 从**无条件欠账**变成**静态手写即可解除**：
一份自洽的伪造件（`blocking` 全为 `hrre` + 每条 `externalReview` 齐备 + 手写
`tier`/`tierBasis`/`adjudicationDigest`，摘要任何填写方可一条命令自算）在判据侧过、在写回器不过。
「判据比工具松」这件事 MUST 写进设计文档的已知不闭合节，SHALL NOT 写成"不是本刀引入"。

MUST 同时补上能补的那一半：当该产物在本次差量里**有 base 版本**时，
其 base 与 head 的 `deepReview` 语义指纹 MUST 不同（复用 `deepReviewFingerprint`，不重抄）；
取不到 base（新增 A 形态）时**不判红**，但 MUST 计入「未证实」读数并逐条打印 ——
与既有那句「不得把工具的失明读成『没有欠账』」同口径。
红文案 MUST 说明这一格挡的是"改一个词把历史 pending 翻成派生闭环"，
**不**挡"当场伪造一整份"，后者仍只有那条公开评论负责。

#### Scenario: 有 base 而语义指纹未变 ⇒ 派生不被承认，且点名

- **WHEN** head 侧一份 `self_play_blocked` 产物逐条复核齐备，但其 base 版本的 `deepReview` 语义指纹与 head 相同
- **THEN** enforce MUST 判该条未闭环，detail 点名「本次没产出新交付，只是把状态词翻了一下」
- **AND** 拿不到 base 时 MUST 打「未证实=N」而非静默计入 OK

