'use strict'

/**
 * 官方算力扣分端点 —— `POST /api/v1/credit/consume`（Phase 2 第 1 刀）。
 *
 * 契约真源：`01-docs/PRD-CREDIT-CONSUME-API-2026-10-25.md`
 * 落地形态定案：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §3.3 / §6.4
 *
 * ## 为什么单独成文件
 * `publish-api-server.js` 有逐文件行数**点名目标**（1574 行，容差 0）⇒ 路由代码留在原地
 * 会触发 `TARGET_GREW` 门禁 ⇒ 新逻辑一律独立成文件 + mixin 挂载
 * （与 `publish-api-redeem-code-admin.js` 同款理由、同款范式）。
 *
 * ## 鉴权（**服务间**，不是用户）
 * · 方向 = ops-center → api-publish-engine（单向；桌面端不直接调本端点）。
 * · 机制 = **复用既有服务间通道**（与 `/api/v1/admin/member/grant` 同一套）：
 *   ops-center 持 Logto M2M token（`engine_admin_token`）⇒ engine 侧
 *   `req.auth.authType === 'logto'` 且 scope 含 `admin:users`。
 *   ⇒ U-1「服务间鉴权机制」按**复用既有**关闭，不新建守门机制、不新增 scope。
 * · ⛔ **api_key 一律拒绝**：静态主密钥分支不校验 `requiredScope`
 *   （`_checkApiKeyAuth` 对 api_key 是「有 key 就算过」），而本端点能扣**任意用户**的积分
 *   ⇒ 放行 api_key 即越权扣分（定案 §13.2 B-8）。这里硬判 `authType === 'logto'`。
 * · ⛔ **不得透传用户 Bearer**：ops-center 不是那个身份。
 * · ⛔ **不查用户套餐/权益**：扣分端点只负责「扣」，不负责「准不准用」
 *   （准入在 ops-center 侧的额度预检，本片不含读余额端点 ⇒ 定案 §13.2 B-1 / U-13 待拍板）。
 *
 * ## 单位口径（跨库，必须看清）
 * · ops-center 侧是**微元**（`model_usage_events.cost_micros`）；
 * · 账本侧 `identity_credit_ledger.cost_cents` 是**分**（`008_credit_ledger.sql`）。
 * ⇒ wire 上的 `costCents` 由 ops-center 按 `ceil(cost_micros / 10000)` 换算而来
 *   （定案 §3.3.1）⇒ **它只是账本的审计痕迹，绝不能用它反算 `amount`**
 *   （反算会在单位混用时放大 10000 倍）。`amount` 一律由 ops-center 算好传入，本端点不重算。
 *
 * ## 幂等
 * · 幂等键 = `(ref_type='usage_event', ref_id, entry_type='spend')`。
 * · `refId` **空值必须 400**：既有 `consumeCredit` 没有 `refId` 守卫
 *   （`grantCredit` 有），`refId=''` 会与**任何**一次空 refId 的扣分共用查重键
 *   ⇒ 第二次起静默「已扣」但实际不扣 ⇒ 静默免费算力（定案 §3.3 / 0bis.1）。
 * · `refType` **必须是常量** `'usage_event'`：DB 唯一索引是**部分索引**，只覆盖它
 *   ⇒ 传别的值 ⇒ 并发重复扣分不再被 DB 拦（定案 §3.3 / 0ter.B-9）。
 */

const CREDIT_CONSUME_URL = '/api/v1/credit/consume'
/** 复用既有服务间 scope（与 /api/v1/admin/member/grant 同款）⇒ 不新增授权面。 */
const CREDIT_CONSUME_SCOPE = 'admin:users'
/** 幂等键的 ref_type：**常量**，不可配、不可省。 */
const CREDIT_REF_TYPE = 'usage_event'
const CREDIT_MAX_SUBJECT_LENGTH = 128
const CREDIT_MAX_REF_ID_LENGTH = 128

/**
 * 端点的错误码 → HTTP 状态。
 * 码的集合来自定案 §3.3 错误表（其中 5 个是仓内尚不存在、需新增的 ⇒ U-9）。
 */
const CREDIT_ERROR_STATUS = Object.freeze({
  CREDIT_USER_INVALID: 400,
  CREDIT_REF_INVALID: 400,
  CREDIT_AMOUNT_INVALID: 400,
  CREDIT_PERIOD_INVALID: 400,
  CREDIT_AUTH_INVALID: 403,
  CREDIT_BALANCE_EXHAUSTED: 409,
  CREDIT_SERVICE_UNAVAILABLE: 503,
})

function creditErrorStatus(code) {
  return CREDIT_ERROR_STATUS[code] || 500
}

/**
 * 入参校验（**纯函数**，便于单测；不依赖 `this`）。
 *
 * 失败顺序固定：先「目标用户」→ 再「幂等键」→ 再「要算的数」→ 最后「周期边界」。
 * 顺序即业务优先级：连要扣谁都不知道时，其余字段的报错没有意义。
 *
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
function validateCreditConsumeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    // body 不是对象 ⇒ 目标用户必然缺失 ⇒ 按最根本的一类拒（不放行任何半缺字段的请求）
    return { ok: false, error: 'CREDIT_USER_INVALID' }
  }

  const authSubject = body.authSubject
  if (typeof authSubject !== 'string' || !authSubject.trim() || authSubject.length > CREDIT_MAX_SUBJECT_LENGTH) {
    return { ok: false, error: 'CREDIT_USER_INVALID' }
  }

  const refId = body.refId
  if (typeof refId !== 'string' || !refId.trim() || refId.length > CREDIT_MAX_REF_ID_LENGTH) {
    return { ok: false, error: 'CREDIT_REF_INVALID' }
  }
  if (body.refType !== undefined && body.refType !== null && body.refType !== CREDIT_REF_TYPE) {
    return { ok: false, error: 'CREDIT_REF_INVALID' }
  }

  const amount = body.amount
  if (!Number.isInteger(amount) || amount <= 0) {
    // amount=0 也非法：缺价 / 非 token 场景会算出 0（定案 §5.1 ⑧）⇒ 放行等于白送
    return { ok: false, error: 'CREDIT_AMOUNT_INVALID' }
  }
  const costCents = body.costCents
  if (!Number.isInteger(costCents) || costCents < 0) {
    return { ok: false, error: 'CREDIT_AMOUNT_INVALID' }
  }
  // ⛔ 扣了分却把账本成本记成 0 ⇒ 审计痕迹缺失（「记 0 等于静默免费」，定案 §3.3.1）。
  //    正确的 ops-center 公式下 amount>0 ⇒ cost_micros>0 ⇒ ceil 后 costCents>=1
  //    ⇒ 该组合**不可达** ⇒ 命中即说明调用方算错了 ⇒ 拒（fail-closed）。
  if (amount > 0 && costCents === 0) {
    return { ok: false, error: 'CREDIT_AMOUNT_INVALID' }
  }

  const periodStart = body.periodStart
  const periodEnd = body.periodEnd
  if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') {
    return { ok: false, error: 'CREDIT_PERIOD_INVALID' }
  }
  const start = new Date(periodStart)
  const end = new Date(periodEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { ok: false, error: 'CREDIT_PERIOD_INVALID' }
  }

  return {
    ok: true,
    value: {
      authSubject: authSubject.trim(),
      amount,
      costCents,
      priceId: typeof body.priceId === 'string' ? body.priceId : '',
      reason: typeof body.reason === 'string' ? body.reason : '',
      refType: CREDIT_REF_TYPE,
      refId: refId.trim(),
      periodStart,
      periodEnd,
    },
  }
}

class PublishApiCreditConsumeHelpers {
  /**
   * `POST /api/v1/credit/consume`。返回 true 表示已处理（调用方应立即 return）。
   *
   * 非 POST 一律**不处理**（返回 false）⇒ 落到通用 404 —— 与仓内既有路由的
   * 「方法不匹配就落空」的写法一致（不新增错误码）。
   */
  async _handleCreditConsume(req, res, method, url) {
    if (url !== CREDIT_CONSUME_URL) return false
    if (method !== 'POST') return false

    // 鉴权守卫与它守护的 handler 刻意待在同一处：守卫一旦被移到别处，
    // 审查时就容易漏看「哪个端点被它覆盖」。
    if (!(req.auth && req.auth.authType === 'logto')) {
      this._json(res, creditErrorStatus('CREDIT_AUTH_INVALID'), {
        error: 'CREDIT_AUTH_INVALID',
        message: '服务间凭据缺失或无权调用扣分端点',
      })
      return true
    }
    // 仓储未装配 ⇒ 503 fail-closed（不「先扣了再说」）
    if (!this._creditRepository || typeof this._creditRepository.consumeCredit !== 'function') {
      this._json(res, creditErrorStatus('CREDIT_SERVICE_UNAVAILABLE'), {
        error: 'CREDIT_SERVICE_UNAVAILABLE',
        message: '扣分服务暂时不可用',
      })
      return true
    }
    if (!this._businessIdentityRepository || typeof this._businessIdentityRepository.findBySubject !== 'function') {
      this._json(res, creditErrorStatus('CREDIT_SERVICE_UNAVAILABLE'), {
        error: 'CREDIT_SERVICE_UNAVAILABLE',
        message: '扣分服务暂时不可用',
      })
      return true
    }

    let body = null
    try {
      body = await this._parseBody(req)
    } catch (error) {
      // 请求体读失败是**客户端错误**（畸形 JSON / 超限），按既有语义透传状态与码
      this._json(res, error && error.status ? error.status : 400, {
        error: error && error.code ? error.code : 'INVALID_JSON_BODY',
        message: error && error.message ? error.message : 'Request body is not valid JSON',
      })
      return true
    }

    const parsed = validateCreditConsumeBody(body)
    if (!parsed.ok) {
      this._json(res, creditErrorStatus(parsed.error), { error: parsed.error })
      return true
    }
    const request = parsed.value

    // `authSubject`（Logto sub）→ `identity_users.id`：**端点内解析**（定案 §3.3）。
    // 账本 FK 指向 `identity_users.id`；ops-center 不查 Postgres（守 §3.1）。
    let user = null
    try {
      user = await this._businessIdentityRepository.findBySubject('logto', request.authSubject)
    } catch (error) {
      this._json(res, creditErrorStatus('CREDIT_SERVICE_UNAVAILABLE'), {
        error: 'CREDIT_SERVICE_UNAVAILABLE',
        message: '扣分服务暂时不可用',
      })
      return true
    }
    if (!user || typeof user.id !== 'string' || !user.id) {
      this._json(res, creditErrorStatus('CREDIT_USER_INVALID'), { error: 'CREDIT_USER_INVALID' })
      return true
    }

    let result = null
    try {
      result = await this._creditRepository.consumeCredit({
        userId: user.id,
        amount: request.amount,
        costCents: request.costCents,
        priceId: request.priceId,
        reason: request.reason,
        refType: request.refType,
        refId: request.refId,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
      })
    } catch (error) {
      const code = error && error.code && CREDIT_ERROR_STATUS[error.code] ? error.code : null
      if (code) {
        // 余额不足（409）等**已知业务语义** ⇒ 按错误表回，ops-center 据此挂起补扣
        this._json(res, creditErrorStatus(code), { error: code, message: error.message })
        return true
      }
      // 未知异常 ⇒ 500（不吞、不伪装成业务码）
      throw error
    }

    // 审计：扣分是**花钱动作**（把用户余额减掉）⇒ 必须留痕（谁扣的、扣给谁、扣多少、幂等键）。
    // ⚠️ 业务字段装在 `details` 里：`AuditLog.log` 只认固定字段表，
    //    直接传 amount/refId 会被静默丢弃。
    try {
      this._auditLog.log({
        ownerSubject: request.authSubject,
        type: 'credit_consume',
        title: `消耗 ${request.amount} 积分`,
        status: result.duplicated ? 'duplicated' : 'success',
        details: {
          callerSubject: (req.auth && req.auth.subject) || null,
          amount: request.amount,
          costCents: request.costCents,
          priceId: request.priceId,
          refType: request.refType,
          refId: request.refId,
          periodStart: request.periodStart,
          periodEnd: request.periodEnd,
          duplicated: Boolean(result.duplicated),
        },
      })
    } catch (error) {
      // 审计写失败**不**反过来让扣分失败（分录已入账；审计是留痕，不是账务）
      this._logError('CREDIT_AUDIT_LOG_FAILED', error, { url: CREDIT_CONSUME_URL })
    }

    this._json(res, 200, {
      account: result.account,
      entry: result.entry,
      duplicated: Boolean(result.duplicated),
    })
    return true
  }
}

function applyCreditConsumeHelpers(Proto) {
  const names = Object.getOwnPropertyNames(PublishApiCreditConsumeHelpers.prototype);
  for (const key of names) {
    if (key === 'constructor') continue;
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PublishApiCreditConsumeHelpers.prototype, key));
  }
}

module.exports = {
  applyCreditConsumeHelpers,
  validateCreditConsumeBody,
  CREDIT_CONSUME_URL,
  CREDIT_CONSUME_SCOPE,
  CREDIT_REF_TYPE,
  CREDIT_ERROR_STATUS,
  creditErrorStatus,
}
