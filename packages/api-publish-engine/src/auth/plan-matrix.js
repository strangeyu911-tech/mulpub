'use strict'

/**
 * 会员中心 · 三档权益矩阵（服务端唯一真源）。
 * 数据契约：01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md §2。
 *
 * 约定：
 * - 数值 -1 表示「不限」，仅 maxPlatforms / aiWriteMonthly / videoMonthly / officialCreditMonthly /
 *   maxDevices / maxCloudAccounts / batchSizePerRun 允许（见 UNLIMITED_ALLOWED）；
 *   dailyPublish 被显式排除——它派生被扣减的 quota.cloud_publish_monthly，-1 会击穿 consumeFeature 的 limit >= 0 校验（CCG C5）。
 * - rank 是档位序（0/1/2），**不在 NUMERIC_KEYS 内**：运营 overrides 不得改档位序（改错会让降级保护静默失效）。
 * - 输出形状直接兼容 PostgresEntitlementProvider.consumeFeature：features 为字符串数组（includes 判定），
 *   quota 为顶层对象且键名对齐 `${feature}_monthly`；limits 为 UI 展示透传字段（扣减路径不读）。
 * - overrides 为运营可配注入（config.yaml，带 * 项），只允许覆盖基线已有数值键。
 * - 客户端禁止硬编码金额/配额，一律通过 GET /api/v1/plans 与 entitlement 快照下发。
 * - officialCreditMonthly 是**唯一**的官方积分额度字段，**不设年付专用字段**：年付按月等额发放，
 *   年付总量因此恒为 12×月付量。改动本字段前须先确认年付发放路径没有另起一套数值。
 * - overrides（mergePlanSection）是运营改价/改配额的唯一入口，但**注入点在仓外**：
 *   logto-runtime.js 读 options.planOverrides，本仓内无传参方，createLogtoRuntime 亦无仓内调用方。
 *   依赖注入能否触达本矩阵取决于部署层——本仓无法自证。
 */

// 促销定价判定是纯函数（零 I/O），本矩阵只负责注入标价与档位上下文。
// ⚠️ 方向不可反：promo-resolver **不得** require 本文件，否则「5900 是唯一真源」
// 会退化成两份常量（改一处漏一处，测试还可能两边都绿）。
const { loadStandardMonthlyPromoConfig, resolvePrice } = require('./promo-resolver')

const PLAN_MATRIX_VERSION = '2026-10-26'

const PLAN_IDS = Object.freeze(['free', 'standard', 'pro'])

/**
 * 档位序（v2.0 机制 C9.2 跨档续叠保护的真源）。
 * 独立于 BASE_MATRIX 且**不可被 overrides 覆盖**：档位序一旦可配，运营改错一个数
 * 就能让「低档覆盖高档」的降级保护失效，而这类错误在日志里不可见。
 */
const PLAN_RANK = Object.freeze({ free: 0, standard: 1, pro: 2 })

const BASE_MATRIX = {
  free: {
    label: '免费版',
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    maxPlatforms: -1,
    dailyPublish: 5,
    aiWriteMonthly: -1,
    videoMonthly: 0,
    scheduleBatch: false,
    // v3.1：定时任务数（0 = 不可建；标准 100；专业 -1 不限）
    maxScheduledTasks: 0,
    // v3.1：自定义自动化工作流 0 条；每日执行 0 条
    maxWorkflows: 0,
    automationDailyItems: 0,
    dashboard: 'basic',
    // v3.1：知识库只做功能开关（免费不提供，标准/专业提供），不设容量档
    knowledgeBase: false,
    // 体验额度 30 积分 = ¥0.3（1 积分 = ¥0.01）。
    // ⚠️ 按 10-08 §3.2 挂牌价：¥0.3 ≈ **1 张**标准清晰度配图（¥0.2/张），
    //    **买不起最便宜的视频**（Hailuo-02 512P/6s = ¥0.6）⇒ 视频能力天然不可达，
    //    这与 features 里 free 不含 video_create 互相印证（免费档禁视频的**定量依据**）。
    //    ⚠️ 旧注释「约 2 条 720P 视频或 7 张配图」与 10-08 价表差 7~10 倍，已订正。
    officialCreditMonthly: 30,
    concurrentTasks: 1,
    // v2.0 机制 C2.3 结构 A：rank 用于跨档续叠保护（免费档为最小序）。
    // 引用 PLAN_RANK 而非字面量：档位序只能有一个真源，否则 limits.plan_rank 与
    // planRank()（降级保护）会各读一份，改错一处即静默不一致。
    rank: PLAN_RANK.free,
    // v2.0 机制 C6.2：设备数温和上限（服务端会话表可强制；-1 表示不限）
    maxDevices: 1,
    // v3.1：绑定账号数是唯一主计量轴（5/20/100），客户端主进程 + UI 双拦
    maxAccounts: 5,
    // v2.0 机制 C6.1：云凭证同步账号数（0 表示不提供云同步；-1 表示不限）
    maxCloudAccounts: 0,
    // v2.0 机制 C7 A 批：单次批量发布条数上限（1 表示单篇；-1 表示不限）
    batchSizePerRun: 1,
    // v2.0 机制 C7 A 批：模型分层访问级别（0 基础 / 1 标准 / 2 高阶）
    modelTier: 0,
  },
  standard: {
    label: '标准版',
    priceMonthlyCents: 5900,
    priceYearlyCents: 59000,
    maxPlatforms: -1,
    dailyPublish: 50,
    // v3.1：AI 写稿不再按次数分档；官方模型按积分，BYOK 不计
    aiWriteMonthly: -1,
    // v3.1：视频创作只做功能开关（0 = 不提供，-1 = 可用且不限条数）
    videoMonthly: -1,
    scheduleBatch: true,
    maxScheduledTasks: 100,
    // v3.1：标准 10 条工作流 / 50 条·日
    maxWorkflows: 10,
    automationDailyItems: 50,
    dashboard: 'full',
    knowledgeBase: true,
    // 成本占比 25.42%（¥59 × 25.42% ≈ ¥15.21）。年付按月等额发放，年付总量因此恒为 12×本值
    // ⇒ 年付 12×1500 = 18000 积分 = ¥180 = ¥590 的 **30.51%**，在年付守线 40% 内（余量 9.49 个点）。
    // ⚠️ 1500 是「在两条守线内、且让 H3 768P 10 秒（500 积分）正好整除」的整数：
    //    1500 ÷ 500 = 3 个（宣传口径可写"每月 3 条 10 秒 768P"），3000 ÷ 500 = 6 个 ⇒ 体感是整数。
    //    ⚠️ 代价要写清：1500 < 1600 ⇒ **给用户的额度更少 ⇒ 运营方毛利更高 ⇒ 少让利 1.7 个点**
    //    （月付占比 27.1% → 25.42%）—— 这是主动提高毛利率的取舍，不是算错。
    officialCreditMonthly: 1500,
    concurrentTasks: 3,
    rank: PLAN_RANK.standard,
    maxDevices: 3,
    maxAccounts: 20,
    maxCloudAccounts: 20,
    batchSizePerRun: 10,
    modelTier: 1,
  },
  pro: {
    label: '专业版',
    // v2.0 机制 C2.3 结构 A：¥79 → ¥119（相邻档 2.0x，行业中位），年付 ¥699 → ¥1190
    // ⚠️ 2026-10-25：年付改为「月付 × 10」= ¥1190（付 10 个月的钱、用 12 个月权益）
    //    ⇒ 相邻档年付仍 ≈ 2.0x（119000/59000 = 2.017x）⇒ 结构 A 不变。
    priceMonthlyCents: 11900,
    priceYearlyCents: 119000,
    maxPlatforms: -1,
    // spec：「不限（默认上限 1000，运营可配）」——用有限高值而非 -1，避免下游除零/无限逻辑。
    dailyPublish: 1000,
    aiWriteMonthly: -1,
    videoMonthly: -1,
    scheduleBatch: true,
    maxScheduledTasks: -1,
    // v3.1：专业 50 条工作流 / 500 条·日
    maxWorkflows: 50,
    automationDailyItems: 500,
    dashboard: 'full',
    knowledgeBase: true,
    // 成本占比 25.21%（¥119 × 25.21% ≈ ¥30）。年付按月等额发放 ⇒ 年付 12×3000 = 36000 积分
    // = ¥360 = ¥1190 的 **30.25%**，在年付守线 40% 内（余量 9.75 个点）。
    // ⚠️ 3330 曾是「月付目标 28%」与「年付守线 40%」在旧年付价 ¥999 下的**唯一交点**
    //    （0.12M/999 ≤ 0.40 ⇒ M ≤ 3330，且 0.01M/119 = 28.0% ⇒ M = 3330）
    //    ⇒ 它当时**正好压在 40.0% 守线上、余量为 0** ⇒ 年付价一降就破线。
    //    2026-10-25 改为 3000：月付占比 25.21%、年付占比 30.25% ⇒ **余量从 0 个点变 9.75 个点**。
    //    3000 ÷ 500（H3 768P 10 秒）= 6 个整 ⇒ 宣传口径可写"每月 6 条 10 秒 768P"。
    //    ⚠️ 代价：3000 < 3330 ⇒ 少让利 2.8 个点（这是主动提高毛利率的取舍）。
    // ⚠️ 2200 是**旧价 ¥79 时代**按 27.8% 反解的遗留值（历史说明保留，见上方记忆条目）。
    officialCreditMonthly: 3000,
    concurrentTasks: 10,
    rank: PLAN_RANK.pro,
    maxDevices: -1,
    maxAccounts: 100,
    maxCloudAccounts: 100,
    batchSizePerRun: -1,
    modelTier: 2,
  },
}

const NUMERIC_KEYS = Object.freeze([
  'priceMonthlyCents', 'priceYearlyCents', 'maxPlatforms', 'dailyPublish',
  'aiWriteMonthly', 'videoMonthly', 'officialCreditMonthly', 'concurrentTasks',
  'maxDevices', 'maxAccounts', 'maxCloudAccounts', 'batchSizePerRun', 'modelTier',
  'maxScheduledTasks', 'maxWorkflows', 'automationDailyItems',
])
// 不含 dailyPublish：它派生 quota.cloud_publish_monthly，该 feature 会被 consumeFeature 扣减（要求 limit >= 0），-1 会导致发布链路 503
const UNLIMITED_ALLOWED = Object.freeze([
  'maxPlatforms', 'aiWriteMonthly', 'videoMonthly', 'officialCreditMonthly',
  'maxDevices', 'maxCloudAccounts', 'batchSizePerRun', 'maxScheduledTasks',
])
// concurrentTasks 至少 1：0 并发为病态配置。dailyPublish 不在此列（0 属刻意清零配额，仍合法）。
const MIN_ONE_KEYS = Object.freeze(['concurrentTasks'])
// 上界（CCG i5）：modelTier 的派生判定是 `>= 1 / >= 2`，不设上界时 overrides 写 3/10 照样派生
// tier_access_pro 并下发 model_tier=3 —— 文档承诺「0-2」而代码只拒了 -1。仅对语义有界的键设上限。
const MAX_BY_KEY = Object.freeze({ modelTier: 2 })

/** 配置类错误：overrides 非法，属部署期缺陷（HTTP 层应映射 500 / 启动 fail-fast）。 */
const invalid = (message) => Object.assign(new Error(`plan-matrix: ${message}`), { code: 'PLAN_MATRIX_CONFIG_INVALID', status: 500 })
/** 请求类错误：档位不存在，属入参缺陷（HTTP 层应映射 400）。 */
const invalidPlan = (plan) => Object.assign(new Error(`plan-matrix: unknown plan '${plan}'`), { code: 'PLAN_INVALID', status: 400 })

function validateNumericValue(key, value, context) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid(`'${key}' in ${context} must be an integer`)
  }
  if (value === -1 && !UNLIMITED_ALLOWED.includes(key)) {
    throw invalid(`'${key}' in ${context} does not accept -1 (unlimited)`)
  }
  if (value < -1) {
    throw invalid(`'${key}' in ${context} must be >= -1`)
  }
  if (MIN_ONE_KEYS.includes(key) && value < 1) {
    throw invalid(`'${key}' in ${context} must be >= 1`)
  }
  if (Object.prototype.hasOwnProperty.call(MAX_BY_KEY, key) && value > MAX_BY_KEY[key]) {
    throw invalid(`'${key}' in ${context} must be <= ${MAX_BY_KEY[key]}`)
  }
}

// overrides 顶层形状守卫：只接受以合法档位 id 为键的普通对象；段内逐键校验交给 mergePlanSection。
// 段值为 null/undefined 视为「该档位不覆盖」（对应 YAML 空节点），显式允许；顶层非对象或档位键拼错一律抛错（fail closed）。
function validateOverridesShape(overrides) {
  if (overrides === undefined || overrides === null) return
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw invalid('overrides must be a plain object keyed by plan id')
  }
  for (const key of Object.keys(overrides)) {
    if (!PLAN_IDS.includes(key)) throw invalid(`unknown plan key '${key}' in overrides`)
    const section = overrides[key]
    if (section === null || section === undefined) continue
    if (typeof section !== 'object' || Array.isArray(section)) {
      throw invalid(`overrides.${key} must be an object of numeric keys`)
    }
  }
}

function mergePlanSection(plan, overrides) {
  validateOverridesShape(overrides)
  const base = BASE_MATRIX[plan]
  if (!overrides) return { ...base }
  const section = overrides[plan]
  if (!section) return { ...base }
  const merged = { ...base }
  for (const [key, value] of Object.entries(section)) {
    if (!(key in base)) throw invalid(`unknown key '${key}' for plan ${plan}`)
    if (!NUMERIC_KEYS.includes(key)) {
      // scheduleBatch/dashboard/label 为契约开关，阶段 1 冻结为不可覆盖（运营可配仅覆盖数值 * 项）
      throw invalid(`key '${key}' for plan ${plan} is not overridable`)
    }
    validateNumericValue(key, value, `plan ${plan}`)
    merged[key] = value
  }
  return merged
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value)
  }
  return Object.freeze(obj)
}

/** entitlement 形状：{ plan, features: string[], quota: {}, limits: {} }，兼容 consumeFeature，供 /api/v1/me 快照直接落库。 */
function getPlanEntitlement(plan, overrides) {
  if (!PLAN_IDS.includes(plan)) {
    throw invalidPlan(plan)
  }
  const matrix = mergePlanSection(plan, overrides)
  const features = ['cloud_publish', 'ai_write']
  if (matrix.videoMonthly !== 0) features.push('video_create')
  if (matrix.scheduleBatch === true) features.push('schedule_batch')
  // v3.1：自定义自动化工作流（免费不提供，标准/专业提供）
  if (matrix.maxWorkflows !== 0) features.push('automation_workflow')
  if (matrix.dashboard === 'full') features.push('dashboard_full')
  // v3.1：知识库功能开关（免费不提供，标准/专业提供；不设容量档）
  if (matrix.knowledgeBase === true) features.push('knowledge_base')
  // v2.0 机制 C6.1：账号数 > 0（或 -1 不限）才提供云凭证同步；0 表示本档不提供
  if (matrix.maxCloudAccounts !== 0) features.push('cloud_account_sync')
  // v2.0 机制 C7 A 批：单次批量上限 > 1（或 -1 不限）才提供批量发布
  if (matrix.batchSizePerRun !== 1) features.push('batch_publish')
  // v2.0 机制 C7 A 批：模型分层访问，高档覆盖低档（features.includes 是单调包含判定）
  if (matrix.modelTier >= 1) features.push('tier_access_standard')
  if (matrix.modelTier >= 2) features.push('tier_access_pro')
  // 官方积分额度：只要本档有额度就声明该能力（额度数值在 quota.official_credit_monthly）。
  // ⚠️ 这是**给客户端的能力声明**，不是扣费开关——真正的扣减在 Phase 2 的积分账本接线里；
  //    此处声明缺失会让后续 consumeFeature('official_credit') 直接 403，能力形同虚设。
  // ⚠️ 判据用 `!== 0` 而**不是** `> 0`：`officialCreditMonthly` 在 UNLIMITED_ALLOWED 里
  //    （-1 = 不限，运营可配）⇒ `> 0` 会把「不限」判成「没有额度」⇒ 能力声明整条消失
  //    ⇒ 一次合法的运营配置静默关掉已付费的能力（与 maxCloudAccounts 同一形态）。
  if (matrix.officialCreditMonthly !== 0) features.push('official_credit')
  // dailyPublish 已在 UNLIMITED_ALLOWED 之外，取值必为有限非负整数（-1 被 override 校验拒绝），此处无需再判 -1
  const cloudPublishMonthly = matrix.dailyPublish * 30
  return deepFreeze({
    plan,
    matrixVersion: PLAN_MATRIX_VERSION,
    features,
    quota: {
      cloud_publish_monthly: cloudPublishMonthly,
      ai_write_monthly: matrix.aiWriteMonthly,
      video_create_monthly: matrix.videoMonthly,
      official_credit_monthly: matrix.officialCreditMonthly,
    },
    limits: {
      max_platforms: matrix.maxPlatforms,
      daily_publish: matrix.dailyPublish,
      concurrent_tasks: matrix.concurrentTasks,
      // v2.0 机制：以下四项此前只存在于文档，客户端 normalizeEntitlement 会丢弃；
      // 现在随快照签名下发并被客户端透传（见 entitlement-service.normalizeEntitlement）
      max_devices: matrix.maxDevices,
      max_accounts: matrix.maxAccounts,
      max_cloud_accounts: matrix.maxCloudAccounts,
      batch_size_per_run: matrix.batchSizePerRun,
      max_scheduled_tasks: matrix.maxScheduledTasks,
      max_workflows: matrix.maxWorkflows,
      automation_daily_items: matrix.automationDailyItems,
      model_tier: matrix.modelTier,
      plan_rank: matrix.rank,
    },
  })
}

/**
 * 档位序查询（跨档续叠保护用）。未知档位返回 -1：调用方据此判「无法比较」，
 * 不得把未知值当 0 或 2 参与大小比较（那会让未知档位静默覆盖或静默被压制）。
 */
function planRank(plan) {
  return Object.prototype.hasOwnProperty.call(PLAN_RANK, plan) ? PLAN_RANK[plan] : -1
}

/**
 * 单档月付定价（目录展示 + 下单共用同一判定）。
 *
 * `priceMonthlyCents` 保持**实收价**语义（前端零改动），标价另出 `listPriceMonthlyCents`。
 * 免费档标价 0 ⇒ 不进入促销判定（resolvePrice 的「price < listPrice」校验对 0 无意义）。
 */
function catalogMonthlyPricing(plan, matrix, now, promoConfig, promoPurchaseCount) {
  const listPriceCents = matrix.priceMonthlyCents
  const base = { listPriceCents, payableCents: listPriceCents, discountCents: 0, promotion: null }
  if (!promoConfig || listPriceCents <= 0) return base
  return resolvePrice({
    plan,
    period: 'month',
    now,
    // 标价由本矩阵注入：promo-resolver 因此无需反向依赖价格表。
    config: { ...promoConfig, listPriceCents },
    promoPurchaseCount,
  })
}

/**
 * 从 env + 运营 overrides 装配标准版月付促销配置（启动期一次）。
 * 标价取 override 后的 standard 月付价 —— 运营改价时促销价与之的差值自动跟随，
 * 并在「促销价 ≥ 标价」时于装配期抛错（见 promo-resolver.validateConfig）。
 */
function buildStandardMonthlyPromoConfig(env, overrides) {
  const standard = mergePlanSection('standard', overrides)
  return loadStandardMonthlyPromoConfig(env, {
    listPriceCents: standard.priceMonthlyCents,
    // 年付标价只用于「年付恒为原价」的返回；年付不参与促销。
    listPriceYearlyCents: standard.priceYearlyCents,
  })
}

/** 价目目录（GET /api/v1/plans 展示用，含展示字段，与权益分离）。 */
function getPlanCatalog(overrides, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const promoConfig = options.promoConfig || null
  const promoPurchaseCount = Number.isInteger(options.promoPurchaseCount) && options.promoPurchaseCount > 0
    ? options.promoPurchaseCount
    : 0
  return PLAN_IDS.map((plan) => {
    const matrix = mergePlanSection(plan, overrides)
    const pricing = catalogMonthlyPricing(plan, matrix, now, promoConfig, promoPurchaseCount)
    return deepFreeze({
      id: plan,
      label: matrix.label,
      currency: 'CNY',
      priceMonthlyCents: pricing.payableCents,
      // 标价：仅供「活动价已用完」文案与服务端自检读取；前端**不得划线展示**（PRD §6.3）。
      listPriceMonthlyCents: pricing.listPriceCents,
      // 年付**任何窗口下都是静态标价**：年付不参与促销（限购按「次」计量，
      // 与「年」量纲不匹配，见 PRD §12）。矩阵是唯一来源，促销配置改不动它。
      priceYearlyCents: matrix.priceYearlyCents,
      listPriceYearlyCents: matrix.priceYearlyCents,
      // 角标只由**月付**促销驱动：年付永远没有 promotion，不能用 `&&` 把两者绑在一起
      // （那会让「年付不促销」把月付角标也一并熄掉）。
      promotion: pricing.promotion,
      rank: matrix.rank,
      entitlement: getPlanEntitlement(plan, overrides),
    })
  })
}

// 基线为全标量 + 浅拷贝安全；显式深冻结作 tripwire，若将来有人塞入嵌套对象可及时暴露（见测试）。
deepFreeze(BASE_MATRIX)

module.exports = {
  PLAN_MATRIX_VERSION,
  PLAN_IDS,
  PLAN_RANK,
  buildStandardMonthlyPromoConfig,
  getPlanEntitlement,
  getPlanCatalog,
  planRank,
}
