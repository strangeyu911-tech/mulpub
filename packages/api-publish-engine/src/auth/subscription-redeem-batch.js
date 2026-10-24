'use strict'
/**
 * subscription-redeem-batch.js — 兑换码批量签发（SubscriptionService 的 mixin）。
 *
 * 为什么单独成文件：`subscription-service.js` 原本 496 行，而仓库的逐文件行数门禁
 * 对**未挂账**文件是「≥ 500 行即阻断」（`.github/scripts/check-max-lines.js` 的
 * `NEW_OVER_LIMIT`，全局 `limit: 500`）。加 `issued_to` 透传需要额外行数 ⇒ 会撞门禁。
 * 正确解法是**抽模块**（把该文件压回安全区），不是抬基线
 * ——「抬高基线掩盖自己引入的债务是禁止的」（同 `subscription-payment.js` 头部注释的同款论证）。
 *
 * 体例与 `subscription-payment.js` / `publish-api-redeem-code-admin.js` 一致：
 * 方法定义在本文件，用 `applySubscriptionRedeemBatchOps` 挂回 SubscriptionService 原型，
 * 对外契约（调用方 `service.createRedeemBatch(...)`）完全不变 ⇒ 既有调用方与测试零改动。
 *
 * 本文件承载：批量签发（含「发放对象 issued_to」透传）。
 */

/** 发放对象最大长度：够写渠道名/客户名/活动名，又不至于把台账塞成长文本。 */
const ISSUED_TO_MAX_LENGTH = 200
/**
 * 批次号最大长度。
 * ⚠️ 为什么必须限（第 3 轮红队实测）：批次号是**索引列**，且一批码会**共用同一个标签**
 * ⇒ 1MB 的标签 × 500 个码 = **单请求写入 439.5 MB**（放大 500×）⇒ 一个 admin 请求就能把库写爆。
 */
const BATCH_MAX_LENGTH = 64

/**
 * 危险字符：控制字符 / C1 / 零宽 / 双向覆盖与隔离 / BOM / 单词连接符。
 *
 * 为什么要挡：发放对象与批次号是**追查泄漏批次的取证锚点**（运营靠它们定位），
 * 而 RTL 覆盖（U+202E）能让列表里的文字**按相反顺序显示**、零宽字符（U+200B）
 * 能让两段文字看起来一模一样、ANSI 转义（ESC）能把控制序列塞进终端与日志
 * ⇒ 运营看到的「批次」可能与库里存的**不是同一串东西**。
 *
 * 同仓已有同类范式：`publish-api-commerce.js` 的 `_deviceNameFrom`
 * 用 `/[\u0000-\u001f\u007f<>]/` 清洗自由文本 ⇒ 本仓不该有两套标准。
 */
const UNSAFE_LABEL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/

/**
 * 惰性取 CommerceError。
 * 不能在文件顶部 `require('./subscription-service')`：subscription-service 会在末尾
 * require 本文件以应用 mixin，形成循环；加载期拿到的是未完成的 exports。
 * 只有调用期才完整（与 subscription-payment.js 同款论证）。
 */
function commerceError (message, code, status) {
  const { CommerceError } = require('./subscription-service')
  return new CommerceError(message, code, status)
}

/**
 * 惰性取码生成器与碰撞补足轮数上限。
 * 这两个是 subscription-service.js 的既有导出，搬走它们会改动那边的 module.exports 契约，
 * 所以留在原处、这里按需取。
 */
function redeemPrimitives () {
  const service = require('./subscription-service')
  return {
    generateRedeemCode: service.generateRedeemCode,
    topupMaxRounds: service.REDEEM_TOPUP_MAX_ROUNDS,
  }
}

/**
 * 归一化「发放对象」。
 *
 * 语义：兑换码一旦泄漏（例如渠道方二次转卖），没有发放对象就无从定位受影响批次，
 * 也就无法快速定位受影响批次（仓里**只有单码吊销** ⇒ 处置要按批次筛出后逐个吊销）。
 * issued_to 回答「这批码发给了谁」。
 *
 * 规则：
 *   - null / undefined / 纯空白 ⇒ 视为未填（null），不是错误（历史批次没有这个字段）
 *   - 非字符串 ⇒ 400（类型错是调用方的错，不该静默吞）
 *   - 超长 ⇒ 400（闸门在入口，不在数据库）
 */
function normalizeLabel (value, { maxLength, field, code }) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw commerceError(`${field} 必须是字符串`, code, 400)
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) {
    throw commerceError(`${field} 过长（上限 ${maxLength} 字符）`, code, 400)
  }
  if (UNSAFE_LABEL_CHARS.test(trimmed)) {
    throw commerceError(`${field} 含不可见或方向控制字符`, code, 400)
  }
  return trimmed
}

/**
 * 归一化「有效期」。
 *
 * ⚠️ 必须校验（第 3 轮红队实测，原实现**完全不校验**）：
 *   ① `'not-a-date'` ⇒ `new Date(...).toISOString()` 抛 RangeError ⇒ **500**（不是 400）；
 *   ② `true` / `12345` ⇒ 静默变成 1970 年 ⇒ **整批码一出生就过期**，而 API 回 200。
 * ⇒ 非法值一律 400；过去的时间也拒（否则签出来的是一批死码）。
 */
function normalizeExpiresAt (value, nowMs) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') {
    throw commerceError('有效期必须是 ISO 时间字符串', 'EXPIRES_AT_INVALID', 400)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw commerceError('有效期不是合法时间', 'EXPIRES_AT_INVALID', 400)
  }
  if (parsed.getTime() <= nowMs) {
    throw commerceError('有效期必须晚于当前时间', 'EXPIRES_AT_INVALID', 400)
  }
  return parsed.toISOString()
}

class SubscriptionRedeemBatchOps {
  /**
   * 批量生成兑换码（运营入口）：上限 500/批，内存去重后批量入库。
   *
   * 与原实现逐行一致，只多了一处：`issuedTo`（发放对象）随记录落库。
   * 其余语义（碰撞补足、REDEEM_BATCH_INCOMPLETE 携带已签发码）**一个字都没改**。
   */
  async createRedeemBatch ({ plan, durationDays, count, batch = null, expiresAt = null, issuedTo = null }) {
    const { CommerceError } = require('./subscription-service')
    const { generateRedeemCode, topupMaxRounds } = redeemPrimitives()
    const { PLAN_IDS } = require('./plan-matrix')
    const crypto = require('crypto')
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw new CommerceError('兑换码仅支持付费档位', 'PLAN_INVALID', 400)
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw new CommerceError('时长必须为正整数天', 'DURATION_INVALID', 400)
    }
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new CommerceError('批量数量需在 1-500 之间', 'BATCH_COUNT_INVALID', 400)
    }
    const normalizedIssuedTo = normalizeLabel(issuedTo, {
      maxLength: ISSUED_TO_MAX_LENGTH, field: '发放对象', code: 'ISSUED_TO_INVALID',
    })
    const normalizedBatch = normalizeLabel(batch, {
      maxLength: BATCH_MAX_LENGTH, field: '批次号', code: 'BATCH_INVALID',
    })
    const normalizedExpiresAt = normalizeExpiresAt(expiresAt, new Date(this.now()).getTime())
    const batchId = normalizedBatch || `batch-${new Date(this.now()).toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`
    const created = []
    // seen 始终以已入库码打底，保证本批内不会重复投递同一个 code
    const seen = new Set()
    const done = new Set()
    let rounds = 0
    for (; created.length < count && rounds < topupMaxRounds; rounds++) {
      while (seen.size < count) seen.add(generateRedeemCode())
      const pending = [...seen].filter((code) => !done.has(code))
      if (pending.length === 0) break
      const records = pending.map((code) => ({ code, plan, durationDays, batch: batchId, expiresAt: normalizedExpiresAt, issuedTo: normalizedIssuedTo }))
      const inserted = await this.repository.createRedeemCodes(records)
      for (const code of inserted) done.add(code)
      created.push(...inserted)
    }
    if (created.length < count) {
      const error = new CommerceError('批量签发未补足，请按已签发码交付或重试', 'REDEEM_BATCH_INCOMPLETE', 409)
      error.requested = count
      error.generated = created.length
      error.rounds = rounds
      error.created = created
      // ⚠️ batch / issuedTo 必须挂在错误上：**已签发出去、仍可兑**的那些码
      // 出了这个错误就没别的去处了（审计与响应体都靠这两个字段定位是哪一批）。
      error.batch = batchId
      error.issuedTo = normalizedIssuedTo
      throw error
    }
    return { batch: batchId, plan, durationDays, issuedTo: normalizedIssuedTo, requested: count, generated: created.length, codes: created }
  }
}

function applySubscriptionRedeemBatchOps (Proto) {
  const names = Object.getOwnPropertyNames(SubscriptionRedeemBatchOps.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(SubscriptionRedeemBatchOps.prototype, key))
  }
}

module.exports = {
  applySubscriptionRedeemBatchOps,
  SubscriptionRedeemBatchOps,
  ISSUED_TO_MAX_LENGTH,
  BATCH_MAX_LENGTH,
}
