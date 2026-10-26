'use strict'

/**
 * 闭环状态词的**唯一真源**（2026-10-20，外部评审第 2 轮 i2 升级为 Critical 后落地）。
 *
 * 为什么单独成模块：这三个词同时决定
 *   ① `check-pr-exec-record.js` 的**阻断面**（状态是否闭环，`unresolved` 的来源）；
 *   ② 同文件「转变核对」的判定；
 *   ③ `scripts/lib/exec-record-audit.js` 的**审计分档**。
 * 三处各抄一份时，改一处的后果不是报错而是**静默不一致**：审计把某状态算成未闭环、
 * 判据却算成闭环，两边读数对不上而没有任何东西会红。
 *
 * 第 1 轮我加的是「相等测试」（护栏），第 2 轮 critic 指出那只是**发现**漂移、不能**消除**
 * 漂移（要等测试跑到）。所以这里改成真正的单一来源：判据与审计都 require 本模块，
 * 删掉各自的字面量副本。
 *
 * ⚠️ 本模块**只放常量**，不 require 任何东西、不读环境、不写文件：
 * 它会被判据本体 require，而判据本体是 CI 每次 PR 都跑的入口，必须保持零副作用。
 */

/** 判据认可的闭环状态词（闭集；新增词等于放宽闭环口径，须同时改判据注释与测试） */
const CLOSED_DEEP_REVIEW_STATUSES = new Set([
  'cleared',
  'needs_revision',
  'self_play_resolved',
])

/**
 * 加载期完整性断言（实现轴轮 2 i2 采纳项）：把"派生资格词不得进闭环白名单"从**只有测试守着**
 * 升级成**模块自己加载时就拒**。理由：那条反捷径锁是一段运行时断言，删掉它没有任何东西会红；
 * 而这个 Set 被判据本体、裁决器、审计模块共同 require —— 在初始化处抛一次，等于让"往白名单里
 * 加派生词"这个动作在**每一次** CI 跑上都炸，而不是等到某个会话恰好跑到那把锁。
 *
 * ⚠ 这不是 `Object.freeze` 那种"看起来更安全"的装饰：冻结一个 Set **挡不住** `set.add(...)`
 * （元素存在内部槽里，不是属性），所以这里用断言而不是只冻结。两条都做，但只有断言有牙。
 *
 * 想真的改口径？那是改「谁来守门」：必须人工过目，且要同次删掉 `scripts/lib/ccg-external-review-honor.js`
 * 的逐条复核判据 —— 留着它又把词加进白名单，就是把本刀的全部判据旁路掉。
 */
const DERIVABLE_STATUS_WORD = 'self_play_blocked'
if (CLOSED_DEEP_REVIEW_STATUSES.has(DERIVABLE_STATUS_WORD)) {
  throw new Error(
    `exec-record-statuses 自检失败：闭环白名单里出现了 ${DERIVABLE_STATUS_WORD}。`
    + '加这个词会让派生判据（逐条 externalReview + 公开出处 + 绑定 URL）整条被旁路 —— '
    + '任何一份该状态的产物都不再需要证据即算闭环。请改回白名单，或按 AGENTS 走人工批准后同步删掉派生判据。')
}
Object.freeze(CLOSED_DEEP_REVIEW_STATUSES)

module.exports = { CLOSED_DEEP_REVIEW_STATUSES }
