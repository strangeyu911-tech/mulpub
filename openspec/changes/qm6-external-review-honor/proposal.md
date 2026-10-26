# 提案：把「高危域条目经外部复核可解除阻断」这段判定搬进仓内判据

## 一、问题

QM-6 高危面收口链今天出现一次**能力消失**，而仓内没有任何东西因此变红：

- `scripts/deep-review.sh` 复用档跑完，引擎打 `🔴 自扮演裁决判定存在阻断项 1 条 - [Warning] i5 high_risk_requires_external`，
  写回器随之 `reason=not-closed detail=status="self_play_blocked"` ⇒ 拿不到 `tier=external`。
- 现场事实（今天量到）：生效的 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`
  mtime `2026-10-24 11:48`，其 `blockingFromAdjudication` 只要 `highRiskDomains` 非空就**无条件**计阻断，
  一次都不读 `externalReview`；模板也不再产出 `expectedExternalBackend`。
  同目录 `ccg-deep-review.js.bak-severity`（mtime `2026-10-22 09:55`）里**有**
  `externalReviewSatisfied()` 与 `externallyReviewed` 留痕，两文件差 183 行。
- 也就是说：PR #4308（merge `b6ef75a83`）昨晚能盖章，靠的是那份**仓外、未版本化的 vendor 脚本本地补丁**；
  今天它被换掉，能力就没了。#4261 与 #4326 现在都签不了。

## 二、根因（不是"补丁被覆盖"，那是导火索）

判定链的**关键一格住在了被测系统之外**。本仓反复处理过同型缺陷（"装饰性门禁"一族）：
锁写在注释里、判据挂在不会跑的 workflow、夹具替对方剥壳 —— 共同点是**结论由一个不受本仓测试、
评审与重取覆盖的载体决定**。这次那个载体是 vendor 脚本的一份本地副本：

- 它不受本仓 CI 覆盖（runner 上没有 `ccg-deep-review.js`，实测 `scripts/deep-review.sh:561` 那段就为此存在）；
- 它不在版本控制里，所以"谁在什么时候把它换掉"在仓内零痕迹；
- 它换掉之后**所有仓内断言仍然成立**（写回器的六件前置、判据的分档求锁、水位），
  因为它们测的是"外部复核被承认之后"的下游，而不是"有没有被承认"这一格。

## 三、方案（一句话）

把「一条 `high_risk_requires_external` 阻断是否已被真外部后端的交付 + 公开可核出处满足」这段判定
**搬到仓内一个纯函数**里，写回器与 `check-pr-exec-record.js` 共用它（单一实现 + 单一实现锁），
并让"走了这条路"在 `tierBasis` 与分档读数里**必然可见**。不依赖引擎是否配合：
引擎两条分支都把裁决 items **原样**落进 `deepReview.findings`（`findings: adj.items`），
所以我们只依赖"它写了什么"，不依赖"它判了什么"。

## 四、范围与刻意不做

做：`scripts/lib/ccg-external-review-honor.js`（新纯函数真源）、`ccg-review-writeback.js`
（合取① 的"闭环"改为可派生，且新档写第三种 `tierBasis`）、`check-pr-exec-record.js`
（收口矩阵认同一条派生判据 + 覆盖率再加一档）、`deep-review.sh`（无需改；如改只改文案）、
两套回归锁 + 变异反证、执行记录与 CHANGELOG 条目。

不做（每条都是刻意选择，不是遗漏）：
1. **不恢复那个 vendor 补丁**。它是对的方向下的错误宿主：能力住在别人脚本的未版本化副本里，
   下次同步还会掉。恢复它只能让 #4261 今天合掉，代价是本格继续不可测。
2. **不联网核 URL 为真**。判据继续只做形状 + 就地重算绑定（与 `delivery@`/`adjudicated@` 同一口径）；
   真伪的承担方式是"评论公开可点开"，不是本地校验器。
3. **不放行 `self_play_upheld`**。裁决判"指控成立"是一条阻断的**理由**，不是缺证据；
   honor 只认 `high_risk_requires_external` 这一种 reason。
4. **不改 `blocking` / `status` 的写入方**。引擎写什么就是什么，本刀只在下游**派生**一个
   "闭环可选态"，绝不回写驱动字段（这条既有合同一字不动）。
5. **不自动合并本 PR**。它改的是"谁来守门" ⇒ 按 AGENTS 属禁止自动合并情形，落笔交人工。

## 五、并发核对

- 本刀差量文件：`scripts/lib/ccg-external-review-honor.js`（新建）、`scripts/ccg-review-writeback.js`、
  `scripts/ccg-review-writeback.test.js`、`scripts/check-pr-exec-record.js`、
  `scripts/check-pr-exec-record.test.js`、`scripts/qm6-tier-watermark.js`（分档）、其测试、
  `openspec/changes/qm6-external-review-honor/`、`openspec/records/qm6-external-review-honor.md`、
  `AGENTS.md`（QM-6 段落一句）。
- 在飞相关刀：#4261（等本刀）、#4326（同一格探测器，本刀落地后它可复用）、
  #4361（依赖锁文件升级，零交集）、#4297（轮次上限，可能同时改 `ccg-review-writeback.js`
  ⇒ 若有冲突以本刀只读该文件为准）。
