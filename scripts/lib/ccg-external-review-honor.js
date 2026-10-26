'use strict'

/**
 * 「高危域的一条阻断是否已被真外部后端的交付 + 公开可核出处满足」这段判定的**唯一真源**
 * （change: qm6-external-review-honor，2026-10-25）。
 *
 * 为什么必须在仓内：这段判定原先只存在于仓外评审引擎的一份**未版本化本地副本**里
 * （`~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js.bak-severity` 的
 * `externalReviewSatisfied()`）。2026-10-24 那份副本被换掉，能力当场消失，而仓内**没有任何断言因此变红**
 * —— 判定链的关键一格住在了被测系统之外，这是本仓「装饰性门禁」一族的又一个落点，
 * 区别是这次连"装饰"都算不上，因为它根本不在守门面里。
 *
 * ⚠️ 本模块**只放常量与纯函数**：不 require 任何东西、不读环境、不触 I/O。
 * 它会被判据本体 `check-pr-exec-record.js` require（CI 每次 PR 都跑的入口，必须零副作用），
 * 而 `ccg-review-writeback.js` 已经 require 判据本体 —— 本模块若反指判据就会形成
 * 加载期半初始化环（解构到的函数是 `undefined`，调用即 TypeError）。这条不是风格要求。
 * 由 `scripts/ccg-external-review-honor.test.js` 的纯函数锁钉死。
 *
 * 强度边界（如实写）：以下全部是**形状 + 逐字相等**判据，不联网核真。
 * 它们把"随手糊一个"挡住，挡不住"认真伪造一套"——真正对第三方负责的是那条公开可点开的评论本身。
 * ⚠ 由此有一条**只能由人完成的动作**（实现轴轮 2 i3 要求写明，免得读数被当成"已经核过了"）：
 * `EVIDENCE_URL_RE` 认的是"这是一个公开可点开的 PR 评论地址"，**不**是"点开之后内容确实复核了这一条"。
 * 要核证据的人应当逐条点开那条评论，比对 critique 原文与逐条处置是否真的覆盖了对应的阻断项；
 * 判据红与绿都不替代这一步。
 */

/** 唯一可被外部复核解除的 blocking reason（闭集；加词等于放宽口径，须同改判据注释与测试） */
const HONORABLE_BLOCKING_REASON = 'high_risk_requires_external'

/**
 * 唯一有派生资格的状态词。
 * 资格取 status 而**不**取 blocking 形状：主干 `pending` 那 898 条现在恰好没有 `blocking` 字段，
 * 那是当前引擎版本的形状巧合；只看形状的实现会在引擎改成"pending 也写 blocking: []"那天
 * 把全部未评审记录读成"无阻断项"。
 */
const DERIVABLE_CLOSURE_STATUS = 'self_play_blocked'

/**
 * 公开可核的 PR 评论 URL —— 本仓唯一一份这条形态的严格正则。
 * `ccg-review-writeback.js` 原来自带 `ADJ_URL_RE`，改为引用这里（净减一份副本）。
 * 判据侧 `evidenceForm` 认的是**更宽的超集**（还认 `PR #1234`、裸 `/pull/<n>` 等主干既有形态），
 * 两者的单向包含关系由 `check-pr-exec-record.test.js` 钉住。
 */
const EVIDENCE_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/\d+#issuecomment-\d+$/

/**
 * 自证形态：`performedBy` 写成这些词，等于"我自己说我被外部复核过"。
 * ⚠ 相对 vendor 原式（`/self[-_]?play|^agent$|内部模拟/i`）**多加了空白分隔**：
 * `SELF PLAY` / `Self Play` 与 `self-play` 是同一个意图，vendor 那版漏认它，
 * 漏认的后果是走到"与期望后端不等"那一格被拒（保守侧），不会误放行 —— 但红因会指错方向，
 * 所以按形态补齐，并在测试里逐变体钉住。
 */
const SELF_REFUTING_RE = /self[\s_-]?play|^agent$|内部模拟/i

/**
 * `external` 的三个子档名 —— **唯一一份**。实现轴轮 2 i4 命中：这三串原先在判据、水位计与两边测试里
 * 各抄一遍，任一处漏改就把 `a+b+c == external` 变成"两个字符串自己跟自己比"（形同求锁，实为装饰）。
 * 名字放这里而不是新开模块：第三档本来就是本模块的存在理由，读者在一处就能对上"哪个桶对应哪条出口"。
 */
const TIER_BUCKETS = Object.freeze({
  direct: 'external(直签)',
  adjudicated: 'external(自扮演+公开复核)',
  honored: 'external(自扮演+公开复核+高危派生)',
})

/** 全部红因（召回锁按这份清单逐个要求"至少被一条用例命中"）。 */
const HONOR_REJECTIONS = [
  'honor-status-ineligible',
  'honor-blocking-absent',
  'honor-unhonorable-reason',
  'honor-item-absent',
  'honor-item-ambiguous',
  'honor-review-absent',
  'honor-review-incomplete',
  'honor-self-refuting',
  'honor-backend-unmatched',
  'honor-evidence-form',
  'honor-evidence-unbound',
  'honor-reviewed-at-unparsable',
  'honor-upheld-assertion',
  'honor-verdicts-incomplete',
  'honor-rationale-duplicated',
]

function reject (reason, detail) {
  return { reason, detail }
}

function nonEmptyString (v) {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * @param {{deepReview: object, record: object, expectedCritic: string, boundEvidence: string}} args
 *   expectedCritic：写回侧由入口从 `scripts/ccg-review-backends.list` 真源透传；
 *     判据侧 MUST 现读同一份清单（**不得**取 `record.reviewBackends.critic` 自身，那会退化成字段自比）。
 *   boundEvidence：写回侧＝即将写入 `deepReview.evidence` 的那个值；判据侧＝已写入的 `deepReview.evidence`。
 * @returns {null|{reason: string, detail: string}} null＝可派生闭环；否则点名缺的是哪一格
 */
function honorRejection (args) {
  const a = args || {}
  const dr = a.deepReview
  if (!dr || typeof dr !== 'object' || dr.status !== DERIVABLE_CLOSURE_STATUS) {
    return reject('honor-status-ineligible',
      `status=${dr && typeof dr === 'object' ? JSON.stringify(dr.status) : '(无 deepReview 段)'}；`
      + `派生只解释引擎那句 ${DERIVABLE_CLOSURE_STATUS}（=「被高危项挡住」），其余状态词各有它自己的语义，`
      + '不由本模块代判')
  }

  const blocking = dr.blocking
  if (!Array.isArray(blocking) || blocking.length === 0) {
    return reject('honor-blocking-absent',
      `blocking=${blocking === undefined ? '缺席' : Array.isArray(blocking) ? '空数组' : JSON.stringify(blocking).slice(0, 40)}；`
      + '空数组/取不到一律 fail-closed —— "没有阻断项"走的是既有第二条出口（条件更严），不得由本模块把它读成"全部被复核满足"')
  }

  const findings = dr.findings
  if (!Array.isArray(findings)) {
    return reject('honor-item-absent',
      `findings=${findings === undefined ? '缺席' : typeof findings} ⇒ 没有任何一条复核能与 blocking 对上号`)
  }

  const expected = a.expectedCritic
  if (!nonEmptyString(expected)) {
    return reject('honor-backend-unmatched',
      `expectedCritic=${JSON.stringify(expected)}（须是非空字符串）；`
      + '缺期望值时"永远不认外部复核"必须是**拒**，不能是放行 —— 拿默认值补齐等于把"没传"读成"传得松"')
  }
  const bound = a.boundEvidence
  if (!nonEmptyString(bound) || !EVIDENCE_URL_RE.test(bound.trim())) {
    return reject('honor-evidence-form',
      `boundEvidence=${JSON.stringify(String(bound === undefined ? '' : bound).slice(0, 60))} 不是公开可核的 PR 评论 URL；`
      + '两侧同为垃圾但逐字相等也不得过派生（否则 unbound 那一格反而成了绕过入口）')
  }
  const boundTrimmed = bound.trim()

  // id → findings（实现轴轮 2 i6：逐条 filter 是 O(blocking × findings)，判据本体每次 PR 都跑）。
  // 这里保留**数组**而不是单个对象，因为"同 id 两条"本身是一格要出声的形态（honor-item-ambiguous）。
  const byId = new Map()
  for (const f of findings) {
    const k = f && f.id
    if (!byId.has(k)) byId.set(k, [])
    byId.get(k).push(f)
  }

  const rationaleByRef = new Map()
  for (const b of blocking) {
    const id = b && b.id
    if (!b || b.reason !== HONORABLE_BLOCKING_REASON) {
      return reject('honor-unhonorable-reason',
        `blocking 里的 ${JSON.stringify(id)} reason=${b ? JSON.stringify(b.reason) : '(整项缺失)'}；`
        + `本模块只认 ${HONORABLE_BLOCKING_REASON}。裁决判「指控成立」是一条阻断的**理由**，不是缺证据，`
        + '给它盖外部复核的章是范畴错误')
    }
    const hits = byId.get(id) || []
    if (hits.length === 0) {
      return reject('honor-item-absent',
        `blocking 点名 ${JSON.stringify(id)}，但 findings 里没有这一条 ⇒ "它被复核过"这句话没有主语`
        + '（不得读成"那条不重要"）')
    }
    if (hits.length > 1) {
      return reject('honor-item-ambiguous',
        `findings 里有 ${hits.length} 条 id=${JSON.stringify(id)} ⇒ 复核结论不唯一，不知该认哪一条`)
    }
    const f = hits[0]

    const er = f.externalReview
    if (!er || typeof er !== 'object') {
      return reject('honor-review-absent',
        `第 ${JSON.stringify(id)} 条整块 externalReview 缺席（现网引擎模板已不再产出它，是常态不是异常）`
        + ' ⇒ 这一条高危阻断没有被外部复核的任何痕迹')
    }
    for (const cell of ['performedBy', 'evidenceRef', 'reviewedAt']) {
      if (!nonEmptyString(er[cell])) {
        return reject('honor-review-incomplete',
          `第 ${JSON.stringify(id)} 条的 externalReview.${cell} 缺失或空白；三格缺一即不成立，`
          + '不得用默认值补齐（那等于把"没填"读成"填得松"）')
      }
    }
    const by = er.performedBy.trim()
    if (SELF_REFUTING_RE.test(by)) {
      return reject('honor-self-refuting',
        `第 ${JSON.stringify(id)} 条 externalReview.performedBy=${JSON.stringify(by)} 是自证形态；`
        + 'reviewBackends 里写真后端名也算 —— 两格分别成立、合起来是空话')
    }
    if (by !== expected.trim()) {
      return reject('honor-backend-unmatched',
        `第 ${JSON.stringify(id)} 条 performedBy=${JSON.stringify(by)} ≠ 期望后端 ${JSON.stringify(expected.trim())}；`
        + '期望值的出处必须是清单/入口透传，不是填写方自选')
    }
    const ref = er.evidenceRef.trim()
    if (!EVIDENCE_URL_RE.test(ref)) {
      return reject('honor-evidence-form',
        `第 ${JSON.stringify(id)} 条 evidenceRef 不是 https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id> 形态`
        + '（自由文本、仓内路径、内部群消息都不算"公开可核"）')
    }
    if (ref !== boundTrimmed) {
      return reject('honor-evidence-unbound',
        `第 ${JSON.stringify(id)} 条 evidenceRef=${JSON.stringify(ref)} ≠ 本记录绑定的 boundEvidence=${JSON.stringify(boundTrimmed)}；`
        + '一条真实存在、但讲的是另一件事的公开评论，与"这次真公开复核过这条高危项"在形状上无法区分，只能靠逐字相等排除')
    }
    if (Number.isNaN(Date.parse(er.reviewedAt.trim()))) {
      return reject('honor-reviewed-at-unparsable',
        `第 ${JSON.stringify(id)} 条 reviewedAt=${JSON.stringify(er.reviewedAt)} 解析不出时间`)
    }
    // verdict 的三档映射（实现轴轮 2 i5 要求写明，别留给下一个人从 if 顺序里反推）：
    //   'dismissed'  → 继续（这条指控被逐条处置否证了，且外部复核齐备）
    //   'upheld'     → honor-upheld-assertion（裁决判**指控成立**，外部复核解除不了真缺陷）
    //   其它任何值（含缺席 / 拼错 / 非字符串）→ honor-verdicts-incomplete（逐条处置不齐，没资格谈解除）
    // 两档刻意都出声、不静默放行：把"没填"和"填了但填反了"合并成一格，人会去补错的那一格。
    if (f.verdict !== 'dismissed' && f.verdict !== 'upheld') {
      return reject('honor-verdicts-incomplete',
        `第 ${JSON.stringify(id)} 条 verdict=${JSON.stringify(f.verdict)} 不在 {dismissed, upheld} 内 ⇒ 逐条处置不齐`)
    }
    if (f.verdict === 'upheld') {
      // 现网引擎在 highRiskDomains 非空时 push 本 reason 后直接 return，
      // verdict==='upheld' 那一支永远轮不到 ⇒ 被裁决判成立的**高危**项，它的 reason 也是这个。
      // 接受 upheld 等于把真缺陷连同伪阻断一起解除。
      return reject('honor-upheld-assertion',
        `第 ${JSON.stringify(id)} 条 verdict=upheld（裁决判指控**成立**）而 reason 仍是 ${HONORABLE_BLOCKING_REASON}；`
        + '外部复核解除的是"没做外部评审"这条程序性阻断，解除不了一条被认定成立的缺陷')
    }
    const rationale = typeof f.rationale === 'string' ? f.rationale.trim() : ''
    if (rationale === '') {
      return reject('honor-verdicts-incomplete', `第 ${JSON.stringify(id)} 条 rationale 缺失或空白`)
    }
    const seen = rationaleByRef.get(ref) || []
    seen.push({ id, rationale })
    rationaleByRef.set(ref, seen)
  }

  // 共享同一条公开评论时（本模块的形态判据决定了 ≥2 条必然共享），不可共享的是**逐条处置的理由**：
  // 同一段文案贴 N 遍去解除 N 条阻断，那不是 N 次处置。
  for (const [, list] of rationaleByRef) {
    if (list.length < 2) continue
    const byText = new Map()
    for (const e of list) {
      const prev = byText.get(e.rationale)
      if (prev) {
        return reject('honor-rationale-duplicated',
          `第 ${JSON.stringify(prev)} 与 ${JSON.stringify(e.id)} 条共用同一条公开评论，且 rationale 逐字相同`
          + '（比较前已去首尾空白）⇒ 复制粘贴不构成两次处置')
      }
      byText.set(e.rationale, e.id)
    }
  }

  return null
}

module.exports = {
  HONORABLE_BLOCKING_REASON,
  DERIVABLE_CLOSURE_STATUS,
  EVIDENCE_URL_RE,
  HONOR_REJECTIONS,
  TIER_BUCKETS,
  honorRejection,
}
