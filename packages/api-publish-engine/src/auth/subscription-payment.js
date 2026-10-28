'use strict'
/**
 * subscription-payment.js — 微信 Native 支付的下单/回调落账（SubscriptionService 的 mixin）。
 *
 * 为什么单独成文件：这组方法直接内联进 `subscription-service.js` 会把那个文件从 487 行
 * 推到 632 行，顶破仓库 `filesOver500` 债务基线。**抬高基线掩盖自己引入的债务是禁止的**，
 * 所以按既有 `publish-api-commerce.js` / `publish-api-redeem-code-admin.js` 的
 * `applyXxxHelpers(Proto)` mixin 体例拆分：方法定义在本文件，挂回 SubscriptionService 原型，
 * 对外契约（调用方 `service.createCheckout(...)`）完全不变。
 *
 * 本文件承载**最小闭环**：
 *   下单 createCheckout → 落 pending 订单 → 调供应商拿 code_url
 *   回调 settlePaymentWebhook → 找订单 → 标 paid → **只调既有 applySubscription**
 *
 * 不做（本期非目标，见 PRD §4.2）：自动续费、升降级 proration、自助退款、免费试用、
 * 促销码 coupon、客户门户、多通道配置切换。
 */

const crypto = require('crypto')
const { PLAN_IDS, getPlanCatalog } = require('./plan-matrix')
const { resolvePrice } = require('./promo-resolver')
const { assertWithinSubscriptionHorizon } = require('./subscription-horizon')
const { OUT_TRADE_NO_PATTERN } = require('./payment-providers/index')
const { claimPaymentEvent, completePaymentEvent } = require('./payment-event-outbox')

const PAYMENT_CHANNEL = 'payment'
const PERIODS = Object.freeze(['month', 'year'])

/** 6 个月/年份 → 授权天数。与兑换码路径同为整数天（不做自然月顺延，避免与既有语义分叉）。 */
const DURATION_DAYS = Object.freeze({ month: 30, year: 365 })

/**
 * 惰性取 CommerceError。
 * 不能在文件顶部 `require('./subscription-service')`：subscription-service 会在末尾
 * require 本文件以应用 mixin，形成循环；加载期拿到的是未完成的 exports（CommerceError 为
 * undefined），只有调用期才完整。用惰性 require 一次性绕开加载顺序问题。
 */
function commerceError (message, code, status) {
  const { CommerceError } = require('./subscription-service')
  return new CommerceError(message, code, status)
}

class SubscriptionPaymentOps {
  /**
   * 下单：**金额一律服务端算**（客户端只报 plan/period，传 amount 在路由层白名单就被丢弃）。
   *
   * 落库顺序不可换：**先落 pending 订单，再调供应商**。反过来的话，供应商下单成功而落库失败
   * 会得到「用户手机里有一张可扫的付款码，我们账上什么都没有」——回调到达时无从归属，
   * 既不能授权也不能对账。先落单后下单，最坏情况是留一条 pending（超时后自然失效），无害。
   */
  async createCheckout({ userId, plan, period, orderId }) {
    await this.requireUser(userId)
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw commerceError('仅支持购买付费档位', 'CHECKOUT_PLAN_INVALID', 400)
    }
    if (!PERIODS.includes(period)) {
      throw commerceError('计费周期仅支持 month / year', 'CHECKOUT_PERIOD_INVALID', 400)
    }
    if (!this.paymentProvider) {
      throw commerceError('支付通道暂未开放', 'PAYMENT_PROVIDER_UNAVAILABLE', 503)
    }
    // 继续支付：复用既有 pending 订单重取 codeUrl（spec「订单页展示真实订单」要求用同一
    // orderId）。必须排在新建之前，且**不落新行** —— 否则用户每点一次「继续支付」就多
    // 一条 pending，账单与对账都会脏。
    if (orderId !== undefined && orderId !== null && orderId !== '') {
      return this._reusePendingOrder({ userId, plan, period, orderId })
    }
    // 1095 天护栏（A）：在**付款前**拦截，不生成二维码、不落订单。
    // 「继续支付」已在上面早退：复用旧单不新增时长，不能因为用户当前接近上限
    // 就让他连已经创建的订单都无法完成支付；真正的时长校验在结算事务里还会再跑一次。
    if (typeof this.repository.getActiveSubscription !== 'function') {
      throw commerceError('会员期限校验不可用', 'SUBSCRIPTION_HORIZON_UNAVAILABLE', 503)
    }
    const existing = await this.repository.getActiveSubscription(userId)
    assertWithinSubscriptionHorizon({
      currentPeriodEnd: existing ? existing.current_period_end : null,
      now: this.now(),
      durationDays: DURATION_DAYS[period],
    })
    // 促销定价：**唯一**判定点在 promo-resolver（纯函数），本方法只负责取计数与落库。
    // 只有 standard + month 才需要预占锁；其它档位/周期不参与促销，走普通落单。
    const promoEligible = Boolean(this.promoConfig)
      && plan === this.promoConfig.plan
      && period === this.promoConfig.period
    const newOrderId = this._newPaymentOrderId()
    let pricing
    let order
    if (promoEligible) {
      if (typeof this.repository.createPendingOrderWithPromoQuota !== 'function') {
        // 促销开着却没有预占能力 ⇒ 多开窗口仍可绕过限购。fail-closed，不静默降级。
        throw commerceError('促销额度预占不可用', 'PROMO_QUOTA_UNAVAILABLE', 500)
      }
      const guarded = await this.repository.createPendingOrderWithPromoQuota({
        userId,
        now: this.now(),
        resolvePendingOrder: (promoPurchaseCount) => {
          const computed = this._checkoutPricing(plan, period, promoPurchaseCount)
          return {
            order: this._pendingOrderRow({ id: newOrderId, userId, plan, period, pricing: computed }),
            pricing: computed,
          }
        },
      })
      order = guarded.order
      pricing = guarded.pricing
    } else {
      pricing = this._checkoutPricing(plan, period, 0)
      order = await this.repository.createPendingOrder(
        this._pendingOrderRow({ id: newOrderId, userId, plan, period, pricing }),
      )
    }
    if (!order) throw commerceError('订单创建失败', 'PAYMENT_ORDER_CREATE_FAILED', 503)
    // 用户 ↔ 供应商客户映射：webhook 回传 openid 时反查用。本期只用 user_id 键，best-effort。
    if (typeof this.repository.upsertPaymentCustomer === 'function') {
      await this.repository.upsertPaymentCustomer({ userId, provider: 'wechat' })
    }
    let checkout
    try {
      checkout = await this.paymentProvider.createCheckout({
        orderId: newOrderId,
        plan,
        period,
        // ⛔ 传给微信的必须是**实收**（2900），不是标价 5900 —— 传错会多收 30 元。
        amountCents: pricing.payableCents,
        currency: 'CNY',
        // attach 会被微信原样回传，是 webhook 落定用户的关键（回调本身不带我们的 user_id）
        attach: { orderId: newOrderId, userId },
      })
    } catch (error) {
      // 供应商失败：订单留 pending（等超时），错误原样上抛给路由层映射 502/400
      if (error && error.code) throw error
      throw commerceError('支付发起失败', 'PAYMENT_PROVIDER_UPSTREAM_FAILED', 502)
    }
    return { orderId: newOrderId, codeUrl: checkout.codeUrl, expiresAt: checkout.expiresAt || null }
  }

  /** 从 plan-matrix 公开目录取**标价**（唯一真源，已含运营 overrides）。 */
  _paymentListPrices(plan) {
    const entry = getPlanCatalog(this.planOverrides).find((item) => item.id === plan)
    const monthly = entry && entry.listPriceMonthlyCents
    const yearly = entry && entry.listPriceYearlyCents
    // 年付标价是「年付恒为原价」的返回源，两个周期都必须有值（缺失即配置缺陷）。
    if (!Number.isInteger(monthly) || monthly <= 0 || !Number.isInteger(yearly) || yearly <= 0) {
      throw commerceError('该档位未配置价格', 'CHECKOUT_PRICE_MISSING', 500)
    }
    return { monthly, yearly }
  }

  /**
   * 订单落库白名单：金额一律来自 `_checkoutPricing` 的纯函数结果。
   * `exhausted` 的订单 `promotion` 非空（UI 要提示「已用完」）但**不得落 promotion_id**：
   * 计数只数真正享促销价的单，落进去会让「第 4 单」也占额度，用户在 3 单后永远原价。
   */
  _pendingOrderRow({ id, userId, plan, period, pricing }) {
    return {
      id,
      userId,
      plan,
      // amount 恒为**标价**：退款口径、合同价、对账都按它；实收另存 payable_cents。
      amount: pricing.listPriceCents,
      currency: 'CNY',
      period,
      payableCents: pricing.payableCents,
      discountCents: pricing.discountCents,
      promotionId: pricing.promotion && !pricing.promotion.exhausted ? pricing.promotion.id : null,
    }
  }

  /**
   * 下单定价：无促销配置时等价于旧行为（标价 = 实收），有配置时走纯函数。
   * 配置非法（endsAt ≤ startsAt、price ≥ listPrice）在这里映射成 500，**不回退原价**。
   */
  _checkoutPricing(plan, period, promoPurchaseCount) {
    const listPrices = this._paymentListPrices(plan)
    const listPriceCents = period === 'year' ? listPrices.yearly : listPrices.monthly
    if (!this.promoConfig) {
      return { listPriceCents, payableCents: listPriceCents, discountCents: 0, promotion: null }
    }
    try {
      return resolvePrice({
        plan,
        period,
        now: this.now(),
        // 两个周期的标价都由 plan-matrix 注入：promo-resolver 不反向依赖价格表。
        // 年付分支会用 listPriceYearlyCents 返回原价（年付永不促销）。
        config: {
          ...this.promoConfig,
          listPriceCents: listPrices.monthly,
          listPriceYearlyCents: listPrices.yearly,
        },
        promoPurchaseCount,
      })
    } catch (error) {
      throw commerceError(`促销配置非法：${(error && error.message) || error}`, 'PROMO_CONFIG_INVALID', 500)
    }
  }

  /** 订单号：`wp` + base36 时间戳 + 8 位 hex。全局唯一、有界、形状与 provider 侧校验一致。 */
  _newPaymentOrderId() {
    const ts = Math.floor(this.now().getTime()).toString(36)
    const rand = crypto.randomBytes(4).toString('hex').slice(0, 8)
    return `wp${ts}${rand}`
  }
  /**
   * 继续支付：复用既有 pending 订单重取 codeUrl。
   *
   * 六条前置缺一即拒，任何一条放松都是资损或信息泄露入口：
   *   ① 形状合法（不把任意串送进查询）② 订单存在 ③ 属于当前用户
   *   ④ channel=payment（防串道）⑤ 仍是 pending ⑥ plan/period 与订单登记值一致
   *
   * **金额取订单已落库的值，不重算 plan-matrix**：订单创建后若运营调价，
   * 重算会让「继续支付」收出与订单登记不一致的金额 —— 对账直接错。
   */
  async _reusePendingOrder({ userId, plan, period, orderId }) {
    if (typeof orderId !== 'string' || !OUT_TRADE_NO_PATTERN.test(orderId)) {
      throw commerceError('订单号格式非法', 'CHECKOUT_ORDER_ID_INVALID', 400)
    }
    const order = typeof this.repository.getOrderById === 'function'
      ? await this.repository.getOrderById(orderId)
      : null
    // 「不存在」与「不属于你」返回**同一个码**：区分开就等于回答「这个订单号存在吗」
    if (!order || order.user_id !== userId) {
      throw commerceError('订单不存在', 'PAYMENT_ORDER_NOT_FOUND', 409)
    }
    if (order.channel !== PAYMENT_CHANNEL) {
      throw commerceError('订单渠道不匹配', 'CHECKOUT_ORDER_CHANNEL_MISMATCH', 409)
    }
    if (order.status !== 'pending') {
      throw commerceError('该订单不可继续支付', 'PAYMENT_ORDER_NOT_REUSABLE', 409)
    }
    if (order.plan !== plan || (order.period || null) !== period) {
      throw commerceError('订单档位与本次请求不一致', 'CHECKOUT_ORDER_MISMATCH', 400)
    }
    const checkout = await this.paymentProvider.createCheckout({
      orderId,
      plan: order.plan,
      period: order.period,
      // 复用既有 pending 单必须按**落库的实收**重新取码：促销单若按 amount(5900) 取码会多收。
      amountCents: Number.isInteger(order.payable_cents) ? order.payable_cents : order.amount,
      currency: order.currency || 'CNY',
      attach: { orderId, userId },
    })
    return { orderId, codeUrl: checkout.codeUrl, expiresAt: checkout.expiresAt || null }
  }

  /**
   * 支付回调落账：**只做「找订单 → 标记 paid → 调既有 applySubscription」**，
   * 不复制 applySubscription 的任何一行（advisory lock / 跨档压制 / 快照同源 / 三连写原子性
   * 全在 postgres-commerce-store.js）。这是本设计最重要的一条边界。
   *
   * 非 `checkout.completed` 事件一律 `ignored: true` 返回、**不抛错**：微信对 4xx/5xx 会重投，
   * 乱序到达的 refunded 若报错会引发重投风暴，而它本身没有可执行语义（本期无退款功能）。
   */
  async settlePaymentWebhook({ orderId, providerReference = null, amountCents = null, occurredAt = null, type = 'checkout.completed' }) {
    if (type !== 'checkout.completed') {
      return { ignored: true, type, orderId: orderId || null }
    }
    if (typeof orderId !== 'string' || !orderId) {
      throw commerceError('回调缺少订单号', 'PAYMENT_ORDER_ID_REQUIRED', 400)
    }
    const order = typeof this.repository.getOrderById === 'function'
      ? await this.repository.getOrderById(orderId)
      : null
    if (!order) throw commerceError('订单不存在', 'PAYMENT_ORDER_NOT_FOUND', 409)
    if (order.channel !== PAYMENT_CHANNEL) {
      // 兑换码/后台订单不该走到支付回调；拒绝而不是静默处理，避免串道
      throw commerceError('订单渠道不匹配', 'PAYMENT_ORDER_CHANNEL_MISMATCH', 409)
    }
    const durationDays = DURATION_DAYS[order.period] || DURATION_DAYS.month
    const reference = providerReference || `wechat:${orderId}`
    // ⛔ 金额校验（原实现 `void amountCents` = 完全不校验）：
    //   微信回调的 amount.total 是**用户实付**，必须等于订单落库的 payable_cents。
    //   相等才结算；不等说明「回调与订单不是同一笔钱」（多收/少收/伪造/串单），
    //   一律 PAYMENT_AMOUNT_MISMATCH 拒绝，且**不得发放权益**（订单留 pending 等人工核对）。
    //   `payable_cents` 为 INTEGER NOT NULL（迁移 011 已回填），下面的 amount 兜底只服务
    //   测试替身/迁移前历史行；生产读不到该列本身就是迁移失败的硬错误。
    const expectedPayableCents = Number.isInteger(order.payable_cents) ? order.payable_cents : order.amount
    if (!Number.isInteger(amountCents) || amountCents !== expectedPayableCents) {
      throw commerceError(
        `回调金额 ${amountCents} 与订单实收 ${expectedPayableCents} 不一致`,
        'PAYMENT_AMOUNT_MISMATCH',
        409,
      )
    }
    const result = await this.repository.commerceTransaction(async (tx) => {
      // 回调留痕（PRD §15.9）：回调到达必须有持久化痕迹，事后追查不能只靠日志。
      // 幂等键是订单号 —— 同一单的重复投递落到同一行、`claimed=false` 时**直接短路**，
      // 连 markOrderPaid/applySubscription 都不再执行（比只靠 UNIQUE 冲突更早拦住）。
      //
      // ⚠️ 事件表写失败**不得**阻断结算：用户已经付了钱，权益优先于可观测性。
      //    失败时用 `eventRecorded=false` 让调用方落日志，不静默。
      let eventId = null
      let eventRecorded = null
      if (tx && tx.client && typeof tx.client.query === 'function') {
        try {
          const claim = await claimPaymentEvent(tx.client, {
            orderId,
            event: type,
            occurredAt: occurredAt ? new Date(occurredAt) : null,
            receivedAt: this.now(),
          })
          if (!claim.claimed) {
            return { ignored: true, duplicate: true, orderId, eventId: claim.id }
          }
          eventId = claim.id
          eventRecorded = true
        } catch (error) {
          eventRecorded = false
        }
      }
      // 促销额度结算兜底（B）：钱已经收了，**不得拒付**。若因竞态导致这笔促销单
      // 是第 max+1 单，仍然走完整结算，但把超卖事实写进事件 result（可对账字段）
      // 并由路由层记 `PROMO_QUOTA_OVERSOLD` 异常日志，供 payment-reconcile 检出。
      // ⚠ 计数必须在 markOrderPaid **之前**做：本笔尚未变成 paid，数出来的就是「此前已支付」。
      const maxPromoPurchases = this.promoConfig && Number.isInteger(this.promoConfig.maxPurchasesPerUser)
        ? this.promoConfig.maxPurchasesPerUser
        : 3
      let paidPromoCount = 0
      if (order.promotion_id) {
        if (typeof tx.countPromoPurchases !== 'function') {
          throw commerceError('促销额度对账不可用', 'PROMO_QUOTA_RECONCILE_UNAVAILABLE', 500)
        }
        paidPromoCount = await tx.countPromoPurchases(order.user_id, { includePending: false })
      }
      const promoQuotaOversold = Boolean(order.promotion_id) && paidPromoCount >= maxPromoPurchases
      // 条件更新 pending → paid：重复回调在这里拿到 null；随后的 applySubscription 会撞
      // provider_reference UNIQUE 收敛成 409（既有语义），因此不会重复授权。
      if (typeof this.repository.markOrderPaid === 'function') {
        await this.repository.markOrderPaid(orderId, {
          paidAt: occurredAt ? new Date(occurredAt) : this.now(),
        })
      }
      const applied = await tx.applySubscription({
        userId: order.user_id,
        plan: order.plan,
        durationDays,
        now: this.now(),
        order: {
          id: orderId,
          // 金额取**订单已落库的值**（下单时服务端算好的），不是回调声称的金额。
          // 回调金额只用于对账告警，绝不据此计费（AGENTS 金额夹紧）。
          amount: order.amount,
          currency: order.currency || 'CNY',
          channel: PAYMENT_CHANNEL,
          providerReference: reference,
        },
        // 快照按**生效档位**现算（低档单不得把高档配额写进快照）
        entitlementPayloadFor: (plan) => this.entitlementPayload(plan),
      })
      const appliedPlan = applied.plan || order.plan
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId: order.user_id,
        title: '支付成功',
        body: applied.downgradeSuppressed
          ? `已顺延 ${durationDays} 天；当前有效期内的档位高于本次购买，档位保持 ${appliedPlan} 不变`
          : `已开通 ${appliedPlan}，有效期 ${durationDays} 天`,
        level: 'info',
      })
      if (eventId) {
        // 收口失败同样不该让已完成的结算回滚：权益已经发了。
        try {
          await completePaymentEvent(tx.client, eventId, {
            plan: appliedPlan,
            requestedPlan: order.plan,
            downgradeSuppressed: applied.downgradeSuppressed === true,
            // 可对账字段：payment-reconcile 可直接按 result->>'promoQuotaOversold' 检出。
            promoQuotaOversold,
            paidPromoCount,
            maxPromoPurchases,
          })
        } catch (error) {
          eventRecorded = false
        }
      }
      return {
        plan: appliedPlan,
        requestedPlan: order.plan,
        downgradeSuppressed: applied.downgradeSuppressed === true,
        orderId: orderId,
        periodStart: applied.periodStart ?? null,
        periodEnd: applied.periodEnd ?? null,
        // 三值语义，**键永远存在**（缺键会被读成"成功"）：
        //   true  = 已落库
        //   false = 写失败（调用方已落 PAYMENT_EVENT_NOT_RECORDED）
        //   null  = 不适用（事务里没有 DB client，只出现在测试替身）
        eventRecorded,
        // 促销超卖兜底的可对账读数（即使 false 也返回，避免"缺键=没超卖"的误读）。
        promoQuotaOversold,
        paidPromoCount,
        maxPromoPurchases,
      }
    })
    await this._grantCreditsForApplied(order.user_id, result)
    return result
  }
}

function applySubscriptionPaymentOps (Proto) {
  const names = Object.getOwnPropertyNames(SubscriptionPaymentOps.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(SubscriptionPaymentOps.prototype, key))
  }
}

module.exports = { applySubscriptionPaymentOps, SubscriptionPaymentOps, PAYMENT_CHANNEL, DURATION_DAYS }
