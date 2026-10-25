'use strict'
/**
 * 010 订阅段链的仓储原语（事实源 = `identity_subscription_segments`）。
 *
 * 这个模块只提供**数据访问原语**，不含任何「排位规则」：
 *   · 什么时候插到链中间、插到当前段之前还是之后、剩余时长怎么算
 *     ⇒ 属于规格 §2.3 的 R1–R4，落在后续切片（兑换路径改写）。
 *   · 什么时候把下一段提为生效段 ⇒ 属于结算推进，落在后续切片。
 * 本片只保证两件事：**表与列存在**，且**「写入顺序」这条铁律在结构上无法被违反**。
 *
 * ⛔ **为什么本模块没有「插入 active 段」这个动作**（规格 §5.1 的 D-1 铁律）：
 *   本模型自建了「每用户至多一个 active 段」的**部分唯一索引**
 *   （`idx_identity_subscription_segments_one_active`）⇒ Postgres 在**每条语句结束时**立即检查它。
 *   若允许「先 INSERT 一条 active 新段、旧段稍后再降级」⇒ 同一 user_id 上两行 active ⇒ 23505
 *   ⇒ 表现为「**每次高档码兑换都 500**」，而且会被误判成「内部状态错误 / 数据损坏」。
 *   ⇒ 所以本模块**只提供** `insertQueuedSegment`（恒为 queued）与 `activateSegment`
 *   （仅允许 queued → active）⇒ 「先 demote 再 activate」从约定变成**结构上无法违反**；
 *   硬要违反（active 还在时再 activate 一条）⇒ 撞部分唯一索引 ⇒ **在驱动携带
 *   `error.constraint` 时**被分类成 `SEGMENT_MULTIPLE_ACTIVE`（带 D-1 的可读说明）；
 *   ⚠ 驱动/包装层不带 constraint 时会降级为 `SEGMENT_UNIQUE_CONFLICT`
 *   （仍 fail closed、仍**不当**幂等命中，但 D-1 的可读诊断会丢失）——仓内同款坑见
 *   `credit-repository.js:35-36` 的注释。
 *
 * ⚠ **段链的链序真源是 `seq` 列**（规格 I6）⇒ 读链必须 `ORDER BY seq`，
 *   **不得**用 `created_at` 代替（插入到链中间时两者顺序不同）。
 *
 * ⚠ **`duration_days` 是面值、`remaining_ms` 是剩余**：两者是**不同的量**（规格 I3）⇒
 *   本模块**不提供**任何改写 `plan` / `duration_days` 的语句（面值一经写入永不修改）；
 *   `remaining_ms` 只在 demote 时写一次，之后只读。
 */

const crypto = require('crypto')

const SEGMENT_STATUS = Object.freeze({
  QUEUED: 'queued',
  ACTIVE: 'active',
  CONSUMED: 'consumed',
})

const SEGMENT_SOURCE_KIND = Object.freeze({
  REDEEM: 'redeem',
  PAYMENT: 'payment',
  GRANT: 'grant',
})

/** 段时长上界：与段表 CHECK 一致（36500 天 = 100 年，只防时间戳溢出）。 */
const SEGMENT_MAX_DURATION_DAYS = 36500

/** 部分唯一索引名（与迁移 / SCHEMA 逐字一致）⇒ 23505 时能精确区分「两个 active」。 */
const ONE_ACTIVE_INDEX = 'idx_identity_subscription_segments_one_active'

const LIST_SEGMENTS = `SELECT id, user_id, plan, duration_days, seq, status, period_start, period_end,
       remaining_ms, source_kind, source_reference, created_at, updated_at
  FROM identity_subscription_segments
 WHERE user_id = $1
 ORDER BY seq ASC`

const LIST_ACTIVE_SEGMENT = `SELECT id, user_id, plan, duration_days, seq, status, period_start, period_end,
       remaining_ms, source_kind, source_reference, created_at, updated_at
  FROM identity_subscription_segments
 WHERE user_id = $1 AND status = 'active'
 ORDER BY seq ASC
 LIMIT 1`

const NEXT_SEQ = `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM identity_subscription_segments WHERE user_id = $1`

const INSERT_QUEUED = `INSERT INTO identity_subscription_segments
       (id, user_id, plan, duration_days, seq, status, source_kind, source_reference)
 VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7)
 RETURNING *`

// ⚠ remaining_ms **由本行自己的 period_end 自算**，不接受调用方传值（复核 D-3）：
//   调用方若能传 null，已结算行的「保剩余」就会被静默丢弃 ⇒ 用户把已过期的那些天再拿一遍
//   （规格明令禁止的「白赚 65 天」）。⇒ 剩余是**推导出来的**，不是**声明出来的**。
const DEMOTE_ACTIVE = `UPDATE identity_subscription_segments
   SET status = 'queued',
       remaining_ms = CASE
         WHEN period_end IS NULL THEN NULL
         ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (period_end - NOW())) * 1000))
       END,
       period_start = NULL, period_end = NULL, updated_at = NOW()
 WHERE id = $1 AND status = 'active'
 RETURNING *`

const ACTIVATE_QUEUED = `UPDATE identity_subscription_segments
   SET status = 'active', period_start = $2, period_end = $3, updated_at = NOW()
 WHERE id = $1 AND status = 'queued'
 RETURNING *`

const CONSUME_ACTIVE = `UPDATE identity_subscription_segments
   SET status = 'consumed', updated_at = NOW()
 WHERE id = $1 AND status = 'active'
 RETURNING *`

const SHIFT_SEQ = `UPDATE identity_subscription_segments
   SET seq = seq + $3, updated_at = NOW()
 WHERE user_id = $1 AND seq >= $2`

/**
 * 23505 的约束名 → 语义。
 *
 * ⚠ **按约束名模式匹配，不写死 Postgres 的自动命名**（自动名会随列改名漂移）⇒
 *   未知约束名走 `SEGMENT_UNIQUE_CONFLICT` 兜底，**绝不**当成幂等命中
 *   （把「别的唯一约束冲突」误判成「幂等成功」是最贵的错：调用方会以为已经发放过）。
 */
function classifyUniqueViolation(constraint) {
  const name = typeof constraint === 'string' ? constraint : ''
  if (name === ONE_ACTIVE_INDEX) {
    return {
      code: 'SEGMENT_MULTIPLE_ACTIVE',
      status: 409,
      message: '同一用户同时存在两个生效段：写入顺序必须「先 demote 旧生效段、再 activate 新段」（规格 §5.1 D-1）',
    }
  }
  if (/source_reference/.test(name)) {
    return {
      code: 'SEGMENT_SOURCE_CONFLICT',
      status: 409,
      message: '同一笔授权已落过一段：按幂等命中处理（不得再插一段）',
    }
  }
  if (/seq/.test(name) && /user/.test(name)) {
    return {
      code: 'SEGMENT_SEQ_CONFLICT',
      status: 409,
      message: '段序冲突：同一用户的链序出现重复（内部状态错误）',
    }
  }
  return {
    code: 'SEGMENT_UNIQUE_CONFLICT',
    status: 409,
    message: `段表唯一约束冲突（约束名未识别：${name || '未知'}）：按内部状态错误处理，不得当成幂等命中`,
  }
}

function fail(code, status, message) {
  throw Object.assign(new Error(message), { code, status })
}

function requireUserId(userId) {
  if (typeof userId !== 'string' || !userId) {
    fail('SEGMENT_USER_REQUIRED', 400, '段链操作需要 user_id')
  }
  return userId
}

function requireSegmentId(id) {
  if (typeof id !== 'string' || !id) {
    fail('SEGMENT_ID_REQUIRED', 400, '段链操作需要段 id')
  }
  return id
}

function requirePlan(plan) {
  if (plan !== 'standard' && plan !== 'pro') {
    fail('SEGMENT_PLAN_INVALID', 400, `段档位非法：${plan}`)
  }
  return plan
}

function requireSourceKind(sourceKind) {
  if (!Object.values(SEGMENT_SOURCE_KIND).includes(sourceKind)) {
    fail('SEGMENT_SOURCE_KIND_INVALID', 400, `段来源种类非法：${sourceKind}`)
  }
  return sourceKind
}

function requireDurationDays(durationDays) {
  if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > SEGMENT_MAX_DURATION_DAYS) {
    fail('DURATION_INVALID', 400, `段时长必须是 1..${SEGMENT_MAX_DURATION_DAYS} 的整数天`)
  }
  return durationDays
}

function requireSeq(seq) {
  if (!Number.isInteger(seq) || seq <= 0) {
    fail('SEGMENT_SEQ_INVALID', 400, '段序必须是正整数')
  }
  return seq
}

function requireSourceReference(sourceReference) {
  if (typeof sourceReference !== 'string' || !sourceReference.trim()) {
    fail('SEGMENT_SOURCE_REFERENCE_REQUIRED', 400, '段来源引用（幂等键）不能为空')
  }
  // ⚠ **要 trim**（复核 D-9）：'redeem:X' 与 'redeem:X ' 若是两个不同的幂等键，
  //   同一笔授权就能落两段 ⇒ 幂等锁被绕过。⇒ 归一后写库。
  return sourceReference.trim()
}

function requireInstant(value, code, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(code, 400, `${label} 非法`)
    return value.toISOString()
  }
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    fail(code, 400, `${label} 非法`)
  }
  return new Date(value).toISOString()
}

/** 把 23505 翻译成带语义的错误；非 23505 原样上抛（不吞）。 */
function rethrowSegmentError(error) {
  // ⚠ `pgCode` 是事务包装层补的形态（COMMIT 阶段违例在包装层被换成
  //   COMMERCE_UNIQUE_CONFLICT，原 23505 留在 pgCode 上）⇒ 两种形态都要认。
  if (!error || (error.code !== '23505' && error.pgCode !== '23505')) throw error
  const classified = classifyUniqueViolation(error.constraint)
  throw Object.assign(new Error(classified.message), {
    code: classified.code,
    status: classified.status,
    constraint: error.constraint || null,
  })
}

function firstRow(result) {
  return (result && result.rows && result.rows[0]) || null
}

/**
 * 段链仓储原语（**事务内**使用 ⇒ 与订阅投影 / 权益快照同事务）。
 * 挂载点：`PostgresCommerceTransaction.prototype`（见 postgres-commerce-store.js）。
 */
const SubscriptionSegmentMethods = {
  /** 读整条链（按 seq 升序）。空链返回 []。 */
  async listSubscriptionSegments(userId) {
    const result = await this.client.query(LIST_SEGMENTS, [requireUserId(userId)])
    return result.rows || []
  },

  /** 当前生效段（至多一个，由部分唯一索引保证）。没有则 null。 */
  async getActiveSubscriptionSegment(userId) {
    const result = await this.client.query(LIST_ACTIVE_SEGMENT, [requireUserId(userId)])
    return firstRow(result)
  },

  /** 链尾的下一个 seq（追加到链尾时用）。 */
  async nextSegmentSeq(userId) {
    const result = await this.client.query(NEXT_SEQ, [requireUserId(userId)])
    const row = firstRow(result)
    return row ? Number(row.next_seq) : 1
  },

  /**
   * 插入一段**排队中**的段。
   *
   * ⛔ 本方法**不接受** status 参数 ⇒ 结构上无法「插入一条 active 段」
   *   （见文件头的 D-1 说明）。要让它生效必须显式走 `activateSegment`。
   */
  async insertQueuedSegment({ userId, plan, durationDays, seq, sourceKind, sourceReference, id } = {}) {
    const segmentId = typeof id === 'string' && id ? id : `seg-${crypto.randomUUID()}`
    try {
      const result = await this.client.query(INSERT_QUEUED, [
        segmentId,
        requireUserId(userId),
        requirePlan(plan),
        requireDurationDays(durationDays),
        requireSeq(seq),
        requireSourceKind(sourceKind),
        requireSourceReference(sourceReference),
      ])
      return firstRow(result)
    } catch (error) {
      rethrowSegmentError(error)
    }
  },

  /**
   * 把生效段降级为排队段，并**保住它的剩余时长**。
   *
   * ⚠ **剩余由 SQL 自算**（`remaining_ms = GREATEST(0, (period_end - NOW()) * 1000)`），
   *   **不接受调用方传值**：调用方若能传 null，已结算行的保剩余就会被静默丢弃
   *   ⇒ 用户把已过期的那些天再拿一遍（规格 §2.3 明令禁止的「白赚 65 天」）。
   *   ⇒ 「保剩余」与 D-1 一样是**结构上无法违反**，不是约定。
   * ⚠ 本行的 period_end 为空（从未生效过）⇒ remaining 记 NULL ⇒ 之后重新生效时长度取面值。
   */
  async demoteActiveSegment(id) {
    const result = await this.client.query(DEMOTE_ACTIVE, [requireSegmentId(id)])
    const row = firstRow(result)
    if (!row) fail('SEGMENT_NOT_ACTIVE', 409, '段不是生效态，无法降级为排队段')
    return row
  },

  /**
   * 把排队段提为生效段。
   *
   * ⚠ 只有 queued 能被激活 ⇒ 「先 demote 再 activate」是结构上唯一可行的路径。
   *   若此刻该用户已有生效段 ⇒ 撞部分唯一索引 ⇒ `SEGMENT_MULTIPLE_ACTIVE`（可读 + fail closed）。
   */
  async activateSegment(id, { periodStart, periodEnd } = {}) {
    const start = requireInstant(periodStart, 'SEGMENT_PERIOD_INVALID', '段生效起点')
    const end = requireInstant(periodEnd, 'SEGMENT_PERIOD_INVALID', '段生效终点')
    if (Date.parse(end) <= Date.parse(start)) {
      fail('SEGMENT_PERIOD_INVALID', 400, '段生效终点必须晚于起点')
    }
    try {
      const result = await this.client.query(ACTIVATE_QUEUED, [requireSegmentId(id), start, end])
      const row = firstRow(result)
      if (!row) fail('SEGMENT_NOT_QUEUED', 409, '段不是排队态，无法激活（可能已被激活过）')
      return row
    } catch (error) {
      rethrowSegmentError(error)
    }
  },

  /**
   * 消费生效段（到期让位）。
   *
   * ⚠ **推进顺序必须是「先 consume 再 activate」**（复核 D-12）：
   *   写反（先 activate 下一段）⇒ 此刻旧段还是 active ⇒ 撞**即时**部分唯一索引
   *   ⇒ 报 SEGMENT_MULTIPLE_ACTIVE（fail closed，但诊断会指向 D-1 而不是「推进顺序」）
   *   ⇒ 且下一段永远激活不上（结算推进会卡在这一段）。
   */
  async consumeActiveSegment(id) {
    const result = await this.client.query(CONSUME_ACTIVE, [requireSegmentId(id)])
    const row = firstRow(result)
    if (!row) fail('SEGMENT_NOT_ACTIVE', 409, '段不是生效态，无法消费')
    return row
  },

  /**
   * 把 `fromSeq` 起的链段整体后移 `delta`（插入到链中间时用）。
   *
   * ⚠ 依赖 `(user_id, seq)` 的 UNIQUE 是 **DEFERRABLE INITIALLY DEFERRED**：
   *   单条 `UPDATE ... SET seq = seq + 1` 会**逐行**撞唯一约束（行 5→6 时 6 还在）
   *   ⇒ 段链插到中间必然 23505。DEFERRABLE 把冲突检查推迟到 COMMIT，
   *   ⚠ **DEFERRABLE 只推迟「检查」，不推迟「可见性」**（复核 D-8）：
   *   **同一事务内的读者看得到中间态**（那一瞬会有重复 seq）⇒ **shift 之后不得再读链**；
   *   只有**事务外**的读者看不到中间态（他们看到的是提交后的结果）。
   *   ⚠ 与之相对，「至多一个 active」的部分唯一索引**必须保持即时**（那是 D-1 的错，要当场暴露）。
   */
  async shiftSegmentSeq(userId, fromSeq, delta) {
    // ⚠ 只允许**正**位移（复核 D-4）：负位移会把 seq 推到 ≤0，而段表 CHECK (seq > 0)
    //   与应用层的 requireSeq（seq ≥ 1）都不接受那种行 ⇒ 写进去之后整条链再也读不动。
    if (!Number.isInteger(delta) || delta <= 0) {
      fail('SEGMENT_SEQ_INVALID', 400, '段序后移量必须是正整数（只允许后移）')
    }
    const result = await this.client.query(SHIFT_SEQ, [
      requireUserId(userId),
      requireSeq(fromSeq),
      delta,
    ])
    return result && result.rowCount ? result.rowCount : 0
  },
}

module.exports = {
  SEGMENT_STATUS,
  SEGMENT_SOURCE_KIND,
  SEGMENT_MAX_DURATION_DAYS,
  ONE_ACTIVE_INDEX,
  classifyUniqueViolation,
  SubscriptionSegmentMethods,
}
