# 轨道E：运营后台 / 会员计费 / 积分与用量计量 — 开源对标调研

> 取证纪律：全部数字来自 `api.github.com` 实测（拉取时间 2026-10-23）。不引用任何 GitHub 镜像站 /
> AI 生成营销站 / 记忆中的 star 数。每个候选至少 2 条独立 API 证据（metadata + license 正文 +
> 默认分支最后提交 + 目录树 + 关键文件内容）。查不到就写"未取证"。
>
> 本轮结论的落点：mulpub 的商业化闭环（`packages/api-publish-engine/src/auth/plan-matrix.js`
> 三档权益矩阵 + `subscription-service.js` + `payment-event-outbox.js` 事务性发件箱 +
> `ops-center/backend/models.py` 40 张表含 `ModelUsageDaily`/`ModelUsageBatch`/`RedemptionCode`）
> **已经是成熟实现**。所以本轮没有任何一个候选被建议"整体替换自研后台"；结论全部落在
> ①小而专的库 ②数据模型/幂等范式借鉴 ③可对照评估的同类 ④明确缺口。

---

## 一、维度小结（表）

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| 用量计量（按 token/秒/张/次数） | `ModelUsageDaily`/`ModelUsageBatch` 落 PostgreSQL，无统一 meter 定义 | **openmeterio/openmeter**（Apache-2.0）`openmeter/meter`（`ValueProperty`+`GroupBy` **四种口径同机制**） | Lago `events-processor` | **借鉴 meter 定义模型 + grant 烧耗顺序**，不引入服务 |
| 积分账户 / 余额 / 发放 | `plan-matrix.js` 的 `officialCreditMonthly`（free=30/standard=1600）由权益令牌下发，**没有可查询的积分账户表，也没有 grant 概念** | **openmeterio/openmeter** `openmeter/credit/`（grant/balance/burnphase） | Lago `wallet.rb` | **自建 grant 表**，烧耗顺序直接抄 OpenMeter 三级排序 |
| 积分换算必须挂模型成本 | `officialCreditMonthly` 是**固定额度**，与模型单价无任何映射（prompt 原文的"待设计换算"其实已落地为固定值） | **openmeterio/openmeter** `openmeter/llmcost/llmcost.go` 的 `Price`（**版本化价格 + Namespace 倍率覆盖**）+ `models.dev/api.json` 公开价格源 | opencost `pkg/inferencecost/types.go`（CostBasis=usage/allocation、AllocationMethod=multiplier）；LiteLLM `model_prices_and_context_window.json` | **自建 `Price` 版本化价格表**（EffectiveFrom/To + namespace 覆盖），`ModelUsageBatch` 落 `price_id` 而非只落 `model_name`；**缺口需自建** |
| 余额不足自动切模型 | `modelTier` 0/1 + `ModelPreset`/`OfficialKey` 已有降级位 | **BerriAI/litellm** `router_strategy/budget_limiter.py`（部署级预算过滤 + 路由策略组合） | OpenMeter grant 优先级 | 借鉴"预算过滤是路由策略之一"的设计，别把切模型写成 if-else |
| 成本对账 / 账本 | 无账本，只有 `ModelUsageDaily` 汇总表 | **openmeterio/openmeter** `openmeter/ledger/README.md`（不可变分录账本，account kinds 含 `wash`/`breakage`） | Kill Bill `invoice_payments` | 借鉴账户种类划分，**账本必须自建** |
| 会员订阅生命周期 / 续费 | `subscription-service.js` + `identity_payment_customers` 映射表 | **killbill/killbill**（Apache-2.0）`subscription/ddl.sql` | Lago `plan.rb`/`subscription.rb` | 借鉴 `charged_through_date` + 事件溯源表；**不引入 Java 栈** |
| 支付幂等 / 查单 / 对账 | `payment-event-outbox.js`（事务性发件箱） | **wechatpay-apiv3/wechatpay-skills**（官方 MIT 规则原文） | Kill Bill `payment_transactions` | **直接按官方查单节奏实现**（5s/30s/1m/3m/5m/10m/30m） |
| 官方支付 SDK | 自研 `payment-schema.js`（微信 Native） | **wechatpay-apiv3 官方仓全家桶（但已停更）+ vikingmute/better-wechatpay** | binarywang/WxJava `weixin-java-pay`（同能力、2026-10 仍活跃、Apache-2.0） | 官方无 Node/Python SDK ⇒ **签名/验签/回调解密必须自建**（约 200 行，缺口已定性） |
| 兑换码 / 礼品卡 | `RedemptionCode` 表 + `publish-api-redeem-code-admin.js` | **saleor/saleor** `Voucher`+`VoucherCode`+`VoucherCustomer` 三表模型 | — | 借鉴三表拆分 + `used` 计数器 + 一人一券；**核销事务自建** |
| LLM 成本观测（自建） | 无独立观测面 | **langfuse/langfuse**（**核心 MIT 可自建已验证**：`isEeAvailable` 机制实测） | opencost inferencecost | 成本看板可自建（MIT 核心）；但**阈值告警与 PG 导出在 EE** ⇒ 告警/对账出库须自写；**6 个服务，部署代价高** |
| RBAC / 资源归属 | `AdminUser` + `ACCESS-CONTROL-MATRIX.md` | **apache/casbin**（+ `apache/casbin-pycasbin`） | openfga/openfga | 直接引入 casbin-pycasbin（Apache-2.0，Python） |
| 资源级授权（Zanzibar 式） | `Project` 表 + 资源归属 | **openfga/openfga**（支持 SQLite） | Permify（AGPL） | 只有在需要"像 Google Docs 那样分享项目"时才上；否则 Casbin `rbac_with_domains` 足够 |
| 运营后台底座 | 自研 Vue3 + Element Plus | **pure-admin/vue-pure-admin**（MIT，Element Plus 同栈） | Vben Admin（Ant Design Vue，不同栈） | **只借鉴**角色/菜单/按钮级权限与路由守卫，不整体替换 |
| ECS 轻量指标/日志/告警 | 无 | **VictoriaMetrics/VictoriaMetrics**（Apache-2.0） | Prometheus+Alertmanager | 单二进制，自建成本最低 |

---

## 二、候选详情

### 1. openmeterio/openmeter — 事件驱动的用量计量 + 积分（grant）账户 + 不可变账本，本维度最完整的一个

- **证据**
  - `GET /repos/openmeterio/openmeter` → stars=2400，language=Go，default_branch=main，pushed_at=2026-10-22T14:57:49Z，created_at=2023-06-06，license=Apache-2.0，archived=false
  - `GET /repos/openmeterio/openmeter/commits?per_page=1` → 默认分支最后提交 **2026-10-22**，sha=f04b561f，`fix(billing): expose pinned and effective customer profiles (#5342)`
  - `GET /repos/openmeterio/openmeter/git/trees/main?recursive=1` → total_entries=**5598**，truncated=false，其中 `.go` 文件 **3393** 个
  - `GET /repos/openmeterio/openmeter/license` → 正文首行 "Apache License  Version 2.0, January 2004"（spdx 与正文一致）
  - `GET /repos/openmeterio/openmeter/contents/openmeter/credit/README.md` → 正文已取（见下）
  - `GET /repos/openmeterio/openmeter/contents/openmeter/ledger/README.md` → 正文已取（见下）
  - `GET /repos/openmeterio/openmeter/contents/openmeter/meter/meter.go` → `MeterAggregation` 枚举实测值：SUM / COUNT / AVG / MIN / MAX / UNIQUE_COUNT / LATEST；另有 `WindowSizeMinute`
  - `GET /repos/openmeterio/openmeter/contents/openmeter/meter/meter.go`（同文件 `Meter` 结构体原文）→
    ```go
    type Meter struct {
        models.ManagedResource; models.Metadata; models.Annotations
        Key           string `mapstructure:"slug"`
        Aggregation   MeterAggregation
        EventType     string
        EventFrom     *time.Time
        ValueProperty *string            // 事件里取哪个字段当计量值；nil = COUNT 事件数
        GroupBy       map[string]string  // 任意分组维度
    }
    ```
  - `GET /repos/openmeterio/openmeter/contents/openmeter/llmcost/llmcost.go` → `Price` 结构体原文（见下）；`ModelPricing` 含 `InputPerToken` / `OutputPerToken` / `CacheReadPerToken` / `CacheWritePerToken` / `ReasoningPerToken`（均为 `alpacadecimal.Decimal`）；`PriceSource` 枚举 = `manual` | `system`
  - `GET /repos/openmeterio/openmeter/contents/openmeter/llmcost/sync/fetcher_modelsdev.go` → 实测常量 `const modelsDevAPIURL = "https://models.dev/api.json"`；`modelsDevCost` 结构 = `{Input, Output, CacheRead, CacheWrite, Reasoning} *float64`
  - `GET /repos/openmeterio/openmeter/git/trees/main?recursive=1` → `openmeter/llmcost/{llmcost,adapter,normalize,service}.go`、`openmeter/llmcost/sync/{fetcher,fetcher_modelsdev,normalizer,reconciler,sync}.go`、`api/v3/handlers/llmcost/{get_price,list_prices,create_override,delete_override,list_overrides,convert,handler}.go`、`openmeter/ent/db/llmcostprice.go`
  - `GET /repos/openmeterio/openmeter/contents/openmeter/llmcost/adapter/price.go` → 实测 **308 行 / 约 11 KB**，方法实测：`ListPrices`(21) / `GetPrice`(69) / **`ResolvePrice`(93)** / `CreateOverride`(141) / `DeleteOverride`(188) / `ListOverrides`(222) / `UpsertGlobalPrice`(253)；`ResolvePrice` 查询与排序逻辑原文已取（见适配点第 9 条）
  - `GET /repos/openmeterio/openmeter/contents/openmeter/llmcost/service/service.go` → size=**约 5 KB**；`GET /repos/openmeterio/openmeter/contents/openmeter/llmcost/sync/reconciler.go` → size=**约 7 KB**（两者均存在，确认"价格写入 + 外部价源对账"链路真实存在）
- **解决哪一层**：用量计量 + 积分换算 + 成本对账（账本）
- **适配点**（逐条对应 mulpub）
  1. **meter 定义**（`openmeter/meter/meter.go`）：把 mulpub 现在的 `ModelUsageDaily` 自由表升级为"**计量项 = 聚合函数 + 事件流**"的声明式定义。SUM 可以覆盖"按 token 计费"，COUNT 覆盖"按张/按次"，LATEST/UNIQUE_COUNT 覆盖"按会话/按设备"。这正好对上 prompt 里"按模型/按 token/按秒/按张 计量"的四种口径。
  2. **grant 烧耗顺序**（`openmeter/credit/README.md` 原文）："Usage is burnt in deterministic order: 1. lower numeric priority first; 2. earlier expiry first; 3. earlier creation first." —— **这就是"余额不足自动切模型"该有的语义**：不是"积分不够就报错"，而是"按优先级把该烧的 grant 烧完，grant 全烧完才判定不足"。mulpub 现在 `officialCreditMonthly` 是一个扁平数值，**没有 grant、没有优先级、没有过期**，这是真实缺口。
  3. **recurring grant 自我续期**：README 明确 "Recurring grants replenish their own balance on their recurrence" —— 对应 mulpub 的"按月赠送积分"（standard 1600/月、video 300/月）。**年付按月等额发放**（plan-matrix 注释里"年付总量恒为 12×月付量"）正是 recurring grant 的标准语义。
  4. **余额是派生状态，不是账本**：README 原句 "Credit balances are derived state. They are not money and they are not an accounting ledger. See [Ledger](../ledger/README.md) for accounting state." —— 这句话直接否定了"在 `ModelUsageDaily` 上累加一个余额列"的做法。
  5. **账本账户种类**（`openmeter/ledger/README.md` 原表）：`customer_fbo`（客户储值）、`customer_receivable`（应收）、`customer_accrued`（已确认未确认收入）、`wash`（外部支付/现金边界）、`earnings`（已确认收入）、`brokerage`（汇率对手方）、`breakage`（过期作废积分）。**`wash` 就是对账锚点**，`breakage` 就是"赠送积分过期"的会计科目 —— mulpub 送 1600/月/年付，用户不用就作废，这笔钱在财务上必须有科目，否则"亏本"无法量化。
  6. **一分钟时间分辨率**（README 明写是 domain constraint 而非实现细节）：mulpub 若照抄需把 `ModelUsageBatch` 的时间粒度对齐到分钟。
  7. **【重点澄清：按张 / 按秒 支持到什么程度】** `Meter` 结构体实测的 `ValueProperty` + `GroupBy` 决定了**计量维度是开放的**：
     - **按张（图片/视频条数）**：`ValueProperty` 留空 + `Aggregation=COUNT`，或指向事件里的 `count` 字段做 SUM ⇒ **完全支持**
     - **按秒（视频生成时长）**：`ValueProperty` 指向事件里的 `duration_seconds` 字段 + `Aggregation=SUM` ⇒ **完全支持**
     - **按 token**：`ValueProperty` 指向 `prompt_tokens` / `completion_tokens` ⇒ 支持
     - **按模型/按会员档分组**：`GroupBy` 是 `map[string]string`，如 `{"model":"gpt-4o","tier":"standard"}` ⇒ 支持
     ⇒ **结论：OpenMeter 的 meter 是通用聚合机制，"按模型/按 token/按秒/按张"四种口径全部落在同一个 `Meter` 声明上，不需要四套表。**
  8. **【重点澄清：`llmcost` 的适用边界】** `openmeter/llmcost/llmcost.go` 的 `Price` 结构体实测：
     ```go
     type Price struct {
         models.ManagedModel
         ID string; Namespace *string          // nil = 全局价；非 nil = 按 namespace 覆盖
         Provider Provider; ModelID string; ModelName string
         Pricing ModelPricing                   // input/output/cache_read/cache_write/reasoning 的 per-token 价
         Currency string                        // "always USD for now"
         Source PriceSource                     // manual | system
         SourcePrices SourcePricesMap
         EffectiveFrom time.Time                // ← 价格版本化
         EffectiveTo   *time.Time               // nil = 当前生效
         Metadata models.Metadata
     }
     ```
     - **`llmcost` 只覆盖 token 维度**（input/output/cache/reasoning 的 per-token 价）⇒ **"按张""按秒"的金额换算 `llmcost` 不管**，只能用 meter 计量后接自定义定价规则（mulpub 侧自己写）。**这条边界必须说清，否则会误以为"接了 llmcost 就自动按张计费"。**
     - **价格是"版本化记录"而非可覆盖单行**（`EffectiveFrom`/`EffectiveTo`）⇒ **这就是"积分换算必须与具体模型成本挂钩"的可落地形式**：每一笔消耗必须绑定**当时生效的价格版本**，否则模型调价后历史账全部算错。mulpub 的 `ModelUsageBatch` 必须落 `price_id` / `price_effective_from`，而不是只落 `model_name`。
     - **`Namespace *string` = 覆盖机制** ⇒ **mulpub 的"会员档位倍率"直接建模为 namespace 覆盖**：全局价 × 1.0，standard namespace × k，pro namespace × k'。这就是"内置模型运营功能：倍率配置"的开源数据模型参照。
     - **`PriceSource` = manual | system**，`system` 由 sync job 从外部源 reconcile 产生 ⇒ mulpub 可照抄"人工价 + 自动价"双轨。
     - **公开价格源 `https://models.dev/api.json`**（实测常量）⇒ mulpub 不必手工维护单价表，可定时拉取后落自己的 `Price` 表（并保留 `SourcePrices` 的多源快照用于对账）。这与候选 3 的 LiteLLM `model_prices_and_context_window.json`（2.83 MB）**互为独立来源，交叉比对能查出谁更准**。
     - **【落地路径：价格解析算法已经存在，可直接照抄】** `openmeter/llmcost/adapter/price.go` 实测 **308 行**，公开方法含 `ListPrices` / `GetPrice` / **`ResolvePrice`** / `CreateOverride` / `DeleteOverride` / `ListOverrides` / `UpsertGlobalPrice`；`openmeter/llmcost/service/service.go`（约 5 KB）、`openmeter/llmcost/sync/reconciler.go`（约 7 KB）。`ResolvePrice` 的查询与排序逻辑（实测原文）等于 mulpub "按模型成本换算积分"的核心算法：
       ```
       WHERE (namespace = :ns OR namespace IS NULL)      -- 先试会员档(namespace)覆盖，再退全局价
         AND provider = :provider AND model_id = :model_id
         AND effective_from <= :at
         AND (effective_to IS NULL OR effective_to > :at) -- 价格版本的时间窗
       ORDER BY namespace DESC NULLS LAST, effective_from DESC  -- namespace 覆盖优先，其次最新生效
       ```
       ⇒ **一条查询同时实现了"会员档倍率覆盖"与"价格版本化"两件事**：mulpub 侧只要有 `Price` 表的 `namespace` / `effective_from` / `effective_to` 三组字段，就能用同样的 OR + ORDER 逻辑解析出某次消耗该按哪条价算。**这是本轮最可直接落地的一条**（`service.go` 与 `reconciler.go` 负责"写入/对账价源"，优先级次之）。
- **引入成本**：**中高**。Go 服务，3393 个 .go 文件，**与现有 FastAPI/SQLAlchemy/Python 栈完全不搭**；自带 PostgreSQL 依赖，且 `openmeter/entitlement/balanceworker/` 是事件驱动 worker（需消息通道）。**不引入服务**，只读代码。真正的引入成本是"读懂并翻译成 SQLAlchemy"的工时。
- **风险**：Apache-2.0 无传染性（这是它相对 Lago 的决定性优势）。风险在于**它的领域模型比 mulpub 需要的重得多**（invoice/discount/tax/lineengine 全套），照抄容易把 ops-center 的 `models.py` 从 40 张表推到 100 张表。必须只取 `meter/` + `credit/` + `ledger/` 三个子目录的语义。
- **建议**：**借鉴实现**（数据模型 + 语义定义），**不引入服务、不引入 worker**。落地清单（按优先级）：
  1. **建版本化价格表**（抄 `openmeter/llmcost/llmcost.go` 的 `Price`）：字段 = `provider` / `model_id` / `pricing(input|output|cache_read|cache_write|reasoning per token)` / `currency` / `namespace`（会员档倍率覆盖）/ `source(manual|system)` / **`effective_from` + `effective_to`（版本化）** / `metadata`；价格源用 `https://models.dev/api.json` 定时同步 + 人工覆盖双轨。
  2. **每笔用量落 `price_id`**：`ModelUsageBatch` 加 `price_id` + `usage_cost_cents` + `allocation_cost_cents`（双口径），杜绝"改价后历史账算错"。
  3. **建 grant 表 + 三级 burn 顺序**（抄 `openmeter/credit/`）：优先级 → 过期 → 创建时间；`recurring grant` 承接"按月赠送 1600 积分"。
  4. **meter 声明化**（抄 `openmeter/meter/meter.go` 的 `ValueProperty` + `GroupBy`）：按 token / 按秒 / 按张三种口径共用一套定义。
  5. **建账本**（抄 `openmeter/ledger/README.md` 的账户种类）：至少要有 `wash`（对账锚点）与 `breakage`（赠送积分过期作废）。
- **置信度**：**高**（目录树、README 正文、`Meter`/`Price`/`ModelPricing` 结构体原文、枚举值、models.dev 拉取常量均为实测原文）

### 2. getlago/lago（+ 子模块 getlago/lago-api） — 「订阅 + 钱包积分 + 优惠码」三件套的数据模型；注意 main 分支只是编排层

- **证据**
  - `GET /repos/getlago/lago` → stars=10708，language=Go，default_branch=main，pushed_at=2026-10-22T16:04:57Z，license=AGPL-3.0
  - `GET /repos/getlago/lago/commits?per_page=1` → 2026-10-21，`chore(deps): bump github.com/klauspost/compress in /events-processor`
  - `GET /repos/getlago/lago/git/trees/main?recursive=1` → total_entries=**207**，truncated=false。**内容只有** `events-processor/`（Go）、`connectors/`、`extra/`、`docker/`、`traefik/`、`scripts/`、`docs/` —— **没有 Rails 应用代码**
  - `GET /repos/getlago/lago/contents/.gitmodules` → 正文：`[submodule "api"] path = api / url = git@github.com:getlago/lago-api.git`；`[submodule "front"] path = front / url = git@github.com:getlago/lago-front.git`
  - `GET /repos/getlago/lago-api` → stars=441，language=Ruby，default_branch=main，pushed_at=2026-10-23T00:20:12Z，license=AGPL-3.0
  - `GET /repos/getlago/lago-api/git/trees/main?recursive=1` → total_entries=**9220**，truncated=false
  - `GET /repos/getlago/lago-api/contents/app/models/wallet.rb` → size=**约 7 KB**，方法与关联实测（见下）
  - `GET /repos/getlago/lago-api/contents/app/models/coupon.rb` → `enum :status` / `enum :expiration` / `enum :coupon_type` / `enum :frequency`；`has_many :coupon_targets` → `plans` / `billable_metrics`
  - `GET /repos/getlago/lago-api/contents/app/models/plan.rb` → `enum :interval`；`monetize :amount_cents`；`validates :pay_in_advance`；`def yearly_amount_cents`；`def validate_code_unique`；`def has_trial?`
  - `GET /repos/getlago/lago/contents/docker-compose.yml` → 服务实测：`postgres(getlago/postgres-partman:15.0-alpine)`、`redis:7-alpine`、`api(getlago/api:v1.55.0)`、`front`、`api-worker`、`api-clock`、`pdf(getlago/lago-gotenberg:7.8.2)`
  - `GET /repos/getlago/lago/git/trees/main?recursive=1` → `extra/` 下含 `clickhouse/config.d/`、`kafka-connect/clickhouse-kafka-connect-v1.3.4/`、`kafka-connect/debezium-connector-postgres/`、`redis/sentinel.dev.conf`
  - `GET /repos/getlago/lago/license` → 正文首行 "GNU AFFERO GENERAL PUBLIC LICENSE  Version 3, 19 November 2007"
- **解决哪一层**：积分账户 / 订阅生命周期 / 优惠码
- **适配点**
  1. **`wallet.rb` 的字段划分是"积分账户"的成品答案**（实测关联/方法）：`belongs_to :customer`、`:organization`、`:payment_method (optional)`、`:billing_entity (optional)`；`has_many :wallet_transactions`（流水）、`:recurring_transaction_rules`（**自动续充规则**）、`:wallet_targets`、`:billable_metrics (through: :wallet_targets)`（**积分可挂在哪些计量项上**）、`:alerts` / `:triggered_alerts`（`UsageMonitoring::Alert`）；`enum :status`；`scope :expired`；`scope :with_positive_balance -> { where("balance_cents > 0") }`；`scope :ready_to_be_refreshed`；`def paid_top_up_min_credits` / `paid_top_up_max_credits`；`def limited_to_billable_metrics?`；`def unique_code_per_customer`。
     —— 对应 mulpub：`recurring_transaction_rules` = 会员周期发放；`wallet_targets` = **积分只允许消耗在哪些内置模型/功能上**（这正是"用户自带 key 不消耗积分"的建模位）；`unique_code_per_customer` = 兑换码防重复领。
  2. **`balance_cents` 用整数**（Lago 全线 `monetize :amount_cents`）—— 对应官方微信支付铁律"金额必须用整数（分），杜绝浮点"（见候选 9）。mulpub 的积分若是整数（credit 本来就该是整数），照抄这个纪律。
  3. **`plan.rb` 的 `interval` 枚举 + `pay_in_advance` + `yearly_amount_cents`** —— 直接对应 plan-matrix 的"月付/年付"两档。Lago 的 `yearly_amount_cents`（monthly→×12、quarterly→×4、semiannual→×2、else ×52）是**年付换算的通用实现**，比 mulpub 在注释里手写"年付总量恒为 12×月付量"更可测（可加单测）。
  4. **`plan_rate_card.rb`** = 费率卡（按计量项分档定价），是"倍率配置"的天然位置。
  5. **`coupon.rb` 的 `enum :frequency` + `coupon_targets`** —— 优惠码绑到"哪些 plan / 哪些计量项"；mulpub 的兑换码若要区分"充多少送多少"，可照抄。
  6. **`wallet_transaction.rb` / `wallet_transaction_consumption.rb` / `credit.rb` / `credit_note.rb`** = 积分流水 + 消费 + 贷记单（退款补发）。
- **引入成本**：**高（且不可接受）**。整跑起来要 PostgreSQL + Redis + Kafka + ClickHouse + Debezium Kafka Connect + gotenberg（PDF）—— `extra/` 里的 connector jar 是**内嵌二进制**（`clickhouse-kafka-connect-v1.3.4.jar`、`debezium-connector-postgres-3.3.1.Final.jar`）。单台 ECS 扛不住这个栈。
- **风险**：
  - **AGPL-3.0**：若只"读代码自己重写"不构成衍生作品（法律上通常如此），但**若直接跑起来给用户提供网络服务**（AGPL §13 的网络交互条款）就有义务开源你的修改版。mulpub 是闭源商业产品 ⇒ **绝对不能把 Lago 作为服务引入**。
  - **公开仓只是编排层**：main 分支 207 个文件里没有一行 Rails 业务代码，核心在子模块 `getlago/lago-api`（另仓，441★）。任何"clone lago 就能跑"的判断都是错的。
  - Ruby/Rails 栈，与 mulpub 的 Node + Python 双栈都不匹配。
- **建议**：**仅借鉴数据模型**（`wallet.rb` / `plan.rb` / `coupon.rb` / `wallet_transaction.rb` 四个文件的字段与关联设计），**不引入、不部署、不复制 AGPL 代码**。实现时按 mulpub 的 SQLAlchemy 2.0 async 风格重写为独立创作。
- **置信度**：**高**（子模块结构、各模型字段、compose 服务均为实测）

### 3. BerriAI/litellm — 模型单价表 + 预算过滤 + 路由策略，同为 Python

- **证据**
  - `GET /repos/BerriAI/litellm` → stars=61859，language=Python，default_branch=main，pushed_at=2026-10-23T03:43:37Z，license=NOASSERTION
  - `GET /repos/BerriAI/litellm/commits?per_page=1` → 2026-10-22，sha=f2118fc7，`fix(security): stop trusting the compromised eMudhra root CA (#47670)`
  - `GET /repos/BerriAI/litellm/git/trees/main?recursive=1` → total_entries=**17460**，truncated=false
  - `GET /repos/BerriAI/litellm/license` → 正文实测（见下）
  - `GET /repos/BerriAI/litellm/contents/model_prices_and_context_window.json` → size=**约 2898 KB**（约 2.83 MB）
  - `GET /repos/BerriAI/litellm/contents/litellm/router_strategy/budget_limiter.py` → 正文已取（见下）
  - `GET /repos/BerriAI/litellm/contents/litellm/proxy/auth/budget_throttle.py` → 三个函数实测：`budget_throttle_percentage()`、`should_throttle_budget_exceeded(valid_token)`、`throttled_limit(limit, pct)`
  - `GET /repos/BerriAI/litellm/contents/litellm/proxy/hooks/model_max_budget_limiter.py` 存在
  - `GET /repos/BerriAI/litellm/git/trees/main?recursive=1` → `litellm-proxy-extras/litellm_proxy_extras/migrations/` 下 20+ 条 spend/budget 表迁移，含 `20260401000000_add_budget_limits`、`20260630190000_add_budget_fallbacks_to_litellm_verification_token`、`20251204124859_add_end_user_spend_table`
- **解决哪一层**：积分换算（模型单价） + 余额不足自动切模型
- **适配点**
  1. **单价表是"积分换算挂成本"最直接的可抄物**：`model_prices_and_context_window.json`（2.83 MB）以模型名为键给出 input/output 单价与上下文窗口。mulpub 的 `ModelPreset` + `OfficialKey` 目前**没有"每百万 token 单价"字段**，`officialCreditMonthly` 是拍脑袋的固定值（1600/月）—— 这是"运营方亏本"的直接成因。**这张表（或它的 schema）是本轮最该抄的东西。**
  2. **"预算过滤是路由策略之一"**（`budget_limiter.py` 正文原句）："it will accept healthy deployments and then filter out deployments that have exceeded their budget limit. This means you can use this with weighted-pick, lowest-latency, simple-shuffle, routing etc" —— 对应 mulpub 的"余额不足自动切模型"：**不要写成 `if (credits < cost) switchModel()` 的 if-else 链**，而是"**候选集 = 所有可用内置模型 → 过滤掉预算/积分不足的 → 在剩下的里按策略选**"。这与 plan-matrix 里的 `modelTier 0/1` 是同一件事的两种写法，LiteLLM 的写法可扩展到 N 个备选。
  3. **软/硬预算两级**（`budget_throttle.py` 的 `throttled_limit(limit, pct)` + `should_throttle_budget_exceeded`）：达到 100% 硬拒，达到 pct% 软告警。这正好是"会员用完积分前提醒"的实现位。
  4. **spend 落库与回填脚本**（`db_scripts/backfill_daily_tool_spend.sql`、`partition_spend_logs.sql`、`backfill_key_total_spend_from_spend_logs.sql`）：mulpub 的 `ModelUsageDaily` 若要长期留存，**分区 + 回填脚本**是绕不开的，这几个 SQL 可作模板。
- **引入成本**：**低**。Python，MIT 主体（`enterprise/` 目录另计），**可直接 pip 装到 ops-center 同一虚拟环境**。但 LiteLLM proxy 模式需要 Postgres（spend logs）+ Redis（budget 计数），且它是 **gateway 形态**（所有模型调用必须过它），这与 mulpub 现在"桌面端直连官方 key"的网络形态冲突。
- **风险**：
  - **许可证分裂**：LICENSE 正文实测为"enterprise/ 目录内容适用 enterprise/LICENSE，其余为 MIT"。若误用 `enterprise/` 下的代码即失去 MIT 保护。
  - 依赖膨胀：LiteLLM 会拖入大量 provider SDK（openai/anthropic/bedrock/vertex/…），与 ops-center 现有 `requirements.txt` 的"带上下界的依赖锁定清单"（`httpx`/`python-jose`/`cryptography`）风格冲突。
  - 上游商业化：LiteLLM 持续把高级能力（virtual key 管理、预算治理）往 enterprise 挪。
  - 2.83 MB 的单价表**没有版本化语义**：模型改名/调价后无法知道某个历史账单是按哪版单价算的 —— mulpub 若用它，**必须把"计价版本"快照进 `ModelUsageBatch`**，否则无法对账。
- **建议**：**借鉴实现**。①抄 `model_prices_and_context_window.json` 的 schema（模型名 → input/output 单价 + 上下文窗口）到 `ModelPreset`；②抄 `budget_limiter.py` 的"过滤器 + 策略"分层，把切模型从 if-else 改成策略组合；③**不引入 LiteLLM proxy**，只按需引入 `litellm` 作为**计价与路由的纯库**使用（`completion_cost()` 之类纯函数），或干脆自己实现这张表。
- **置信度**：**高**（单价表大小、函数签名、license 正文、迁移文件名均为实测）

### 4. killbill/killbill — 订阅生命周期的 DDL 事实标准

- **证据**
  - `GET /repos/killbill/killbill` → stars=5815，language=Java，default_branch=master，pushed_at=2026-10-22T13:40:39Z，created_at=2012-10-21，license=Apache-2.0
  - `GET /repos/killbill/killbill/commits?per_page=1` → 2026-10-22，sha=3548b023，`Merge pull request #2329 from killbill/forward-port-2318`
  - `GET /repos/killbill/killbill/git/trees/master?recursive=1` → total_entries=**2908**，truncated=false
  - `GET /repos/killbill/killbill/license` → 正文首行 "Apache License  Version 2.0, January 2004"
  - `GET /repos/killbill/killbill/contents/subscription/src/main/resources/org/killbill/billing/subscription/ddl.sql` → 表结构已取（见下）
  - `GET /repos/killbill/killbill/contents/invoice/src/main/resources/org/killbill/billing/invoice/ddl.sql` → 表结构已取
  - `GET /repos/killbill/killbill/contents/payment/src/main/resources/org/killbill/billing/payment/ddl.sql` → 表清单实测：`payment_attempts` / `payment_attempt_history` / `payment_methods` / `payments` / `payment_transactions` / `payment_transaction_history` / **`invoice_payment_control_plugin_auto_pay_off`**
  - `GET /repos/killbill/killbill-dunning` → **404**（dunning 不在本仓）
- **解决哪一层**：订阅生命周期 + 支付幂等 + 欠费控制
- **适配点**（DDL 实测字段）
  1. **`subscriptions` 表**：`id`、`bundle_id`、`external_key`（幂等键）、`category`、`start_date`、`bundle_start_date`、**`charged_through_date`**（"已扣费到哪一天"）、`migrated`、`account_record_id`、`tenant_record_id`。
     → `charged_through_date` 是 mulpub 最该抄的一个字段：年付/续费场景下"这个会员周期还剩多少有效期、已发放了多少积分"必须有一个**权威截止日**字段，不能靠 `created_at + plan.interval` 现算（跨月补发、升级、补偿都会算错）。
  2. **`subscription_events` + `subscription_event_history`**（事件溯源 + 审计）：`event_type`、`user_type`、`effective_date`、`subscription_id`、`plan_name`、`phase_name`、`price_list_name`、`billing_cycle_day_local`、`quantity`、`is_active`；history 表多一个 `change_type`。
     → 对应 mulpub 的 `ConfigAuditLog` 与 `RuntimeConfigVersion` 的思路，但粒度是"订阅事件"而非"配置变更"。**续费、降级、退款、补偿都应写成 event 而不是 update 行**。
  3. **`invoice_items.linked_item_id`** + **`invoice_payments.linked_invoice_payment_id`** + **`invoice_payments.payment_cookie_id`**：退款单/冲正单通过 `linked_*` 指向原单，**不覆盖原记录**。mulpub 的 `payment-event-outbox.js` 已有发件箱，但**账目侧是否也用"冲正而不覆盖"**需要对齐。
  4. **`invoice_tracking_ids`**（invoice_id ↔ 外部 tracking id）：外部支付单号与内部账目的映射表，正是"对账"要用的。
  5. **`invoice_payment_control_plugin_auto_pay_off`**：一个**独立的自动扣款开关表**。mulpub 若做"自动续费/自动扣款"，这个开关必须独立成表（不能是 subscription 上的一个 bool），因为它要被对账/客服/风控多方读。
  6. **`payment_attempts` 与 `payment_transactions` 分离**：attempt（一次尝试）与 transaction（一次实际资金/账务动作）分离，是重试与幂等的标准拆法。
- **引入成本**：**高**。Java + Maven + MySQL 专用 DDL（`/*! CHARACTER SET utf8 COLLATE utf8_bin */`、MyISAM/InnoDB 注释），与 PostgreSQL + SQLAlchemy async 完全不搭；完整引入还要 catalog/entitlement/invoice/payment/overdue/tenant 一整套。**只抄 DDL 语义，不引入代码。**
- **风险**：Apache-2.0 无风险（这是它相对 Lago/Permify 的优势）。真实风险是**过度设计**：Kill Bill 面向的是"多租户 + 多种产品目录 + 复杂价格表 + 欠费催缴"，mulpub 只有三档会员 + 固定赠送积分 + 微信 Native 支付，引入完整模型会把 `identity_orders` 一张表撑成七八张。**边界要自己划。**
- **建议**：**借鉴实现（数据模型）**。只取四项：①`charged_through_date` 权威截止日；②订阅事件表（生效事件 + 历史表）替代行内 update；③`linked_*` 冲正链；④自动扣款开关独立成表。**不引入 Java 服务。**
- **置信度**：**高**（DDL 原文逐字段实测）

### 5. opencost/opencost — 「按 token / 按秒 / 按倍率」的成本核算模型 + 阿里云定价 provider

- **证据**
  - `GET /repos/opencost/opencost` → stars=6789，language=Go，default_branch=**develop**（不是 main），pushed_at=2026-10-23T02:02:03Z，license=Apache-2.0
  - `GET /repos/opencost/opencost/commits?per_page=1` → 2026-10-23，sha=ccde23cf，`Warn when scrapes hang (#4138)`
  - `GET /repos/opencost/opencost/git/trees/develop?recursive=1` → total_entries=**1206**，truncated=false
  - `GET /repos/opencost/opencost/license` → 正文首行 "Apache License  Version 2.0, January 2004"
  - `GET /repos/opencost/opencost/contents/README.md` → 第 28 行原文："**AI inference cost tracking** for vLLM-based deployments (llm-d and compatible): cost per million tokens (input/output), KV cache-corrected pricing, shared infrastructure attribution, REST APIs and Prometheus metrics"；第 36-44 行："Quick install on any Kubernetes 1.20+ cluster" + "the standalone Kubernetes manifest files have been removed. Please use Helm for all installations"
  - `GET /repos/opencost/opencost/contents/pkg/inferencecost/types.go` → 类型定义已取（见下）
  - `GET /repos/opencost/opencost/contents/pkg/cloud/alibaba/provider.go` → size=**约 57 KB**，含 `AlibabaPricing` / `AlibabaPricingDetails{hourlyPrice, priceUnit, currencyCode}` / `AlibabaPricingTerms{billingMethod}` / `DownloadPricingData()` / `RefreshCustomPricing()`
  - `GET /repos/opencost/opencost/git/trees/develop?recursive=1` → `pkg/inferencecost/{calculator,collector,exporter,queryservice,aggregate,runner,env,apitypes}.go`、`docs/inference-cost-tracking.md`、`modules/pricing/public/aws/{pricelistapi,spotapi}.go`、`pkg/cloud/aws/athena*.go`
- **解决哪一层**：成本核算 / 积分换算 / 成本对账
- **适配点**（`pkg/inferencecost/types.go` 实测字段）
  - `CostBasis` 枚举 = **`usage` | `allocation`**：同一笔消耗有两个口径 —— "按实际用量算的成本" vs "按分摊算的成本"。mulpub 必须有这两个口径：`UsageTotalCost`（真实花掉的钱，用来对账）与 `AllocationTotalCost`（分摊到用户的成本，用来算积分扣多少）。**现在 mulpub 只有"用户扣了多少积分"，没有"平台实际花了多少钱"，这正是亏本无法发现的根因。**
  - `AllocationMethod` 枚举 = **`compute_time` | `prefix_caching_off` | `multiplier`**：
    - `compute_time` = **按秒**（对应 prompt 的"按秒计量"，视频生成类）
    - `multiplier` + `OutputTokenCostMultiplier float64` = **倍率**（对应"内置模型运营功能：倍率配置"）
    - `prefix_caching_off` = 缓存命中修正（mulpub 暂不需要，但同一模型多备选时值得留位）
  - `InferenceCost` 字段实测：`PromptTokens` / `GenerationTokens` / `TotalTokens` / `InputProcessingTime` / `OutputProcessingTime` / `CachedTokens` / `EffectiveInputTokens` / `CacheSavingsFraction` / `InputCost map[CostBasis]float64` / `OutputCost map[CostBasis]float64` / `AllocationTotalCost` / `UsageTotalCost` / `CostPerMillionTokens map[CostBasis]float64` / `InputCostPerMillionTokens` / `OutputCostPerMillionTokens` / `Timestamp`。
  - `InferenceCostProperties`：`ModelName` / `ModelVersion` / `Namespace` / `Cluster` / `Pod` / `Controller` / `ControllerKind` / `Container` / `WorkloadType`。
  - → **这张结构体就是 mulpub `ModelUsageBatch` 应该长成的样子**：加 `usage_cost_cents` 与 `allocation_cost_cents` 两列 + `model_version` + `pricing_tier`，就能从"记录用了多少 token"升级到"记录这次消耗让平台花了多少钱、按什么单价折算的"。
  - `pkg/cloud/alibaba/provider.go`：有**阿里云**定价 provider（`AlibabaPricingDetails.hourlyPrice / priceUnit / currencyCode`）⇒ "AWS Cost Explorer 类方案的开源替代"这个问题，OpenCost 确实覆盖了多云账单拉取，且**恰好覆盖 mulpub 所在的阿里云**。
- **引入成本**：**高（作为服务）/ 低（作为模型）**。作为服务：OpenCost 的 K8s 部分要 Helm 装在 K8s 1.20+ 集群上，**独立 manifest 已被官方删除**；还需 Prometheus（`PROMETHEUS_SERVER_ENDPOINT`）。mulpub 是**单台 ECS + Docker**，没有 K8s ⇒ **作为服务引入直接不可行**。作为模型：读 `pkg/inferencecost/types.go` + `calculator.go` 翻译成 Python，工作量小。
- **风险**：Apache-2.0 无风险。真实风险是**把 K8s 成本分摊的思路套到 LLM 上会过度**：OpenCost 的 allocation 面向"共享集群算谁该付多少"，mulpub 的"分摊"是"用户消耗了内置模型，平台亏了多少"—— 语义相近但数据来源完全不同（一个来自 K8s metrics，一个来自模型调用返回的 usage）。照抄会引入"为什么这个用户分摊了 ECS 费用"的困惑。
- **建议**：**借鉴实现（数据模型 + 计价口径）**。①把 `usage` / `allocation` 双口径搬进 `ModelUsageBatch`；②把 `AllocationMethod` 的 `compute_time` / `multiplier` 搬进倍率配置；③阿里云 provider 只作为"以后要拉 ECS 账单做对账"时的参考代码，不部署。
- **置信度**：**高**（类型定义逐字段实测、README 原文实测）

### 6. langfuse/langfuse — 自建 LLM 成本观测的参考实现（核心 MIT 可自由商用；ee/ 是自定义商业协议，自托管不配 EE 密钥即只跑核心）

- **证据**
  - `GET /repos/langfuse/langfuse` → stars=36218，language=TypeScript，default_branch=main，pushed_at=2026-10-23T02:45:23Z，license=NOASSERTION
  - `GET /repos/langfuse/langfuse/commits?per_page=1` → 2026-10-22，sha=c83198b0，`feat(tracing): show requested skill loads and file paths (#19239)`
  - `GET /repos/langfuse/langfuse/git/trees/main?recursive=1` → total_entries=**9335**，truncated=false
  - `GET /repos/langfuse/langfuse/license` → 正文实测（见下）
  - `GET /repos/langfuse/langfuse/contents/packages/shared/prisma/migrations/20240625103957_observations_add_calculated_cost_columns/migration.sql` → 原文：`ALTER TABLE "observations" ADD COLUMN "calculated_input_cost" DECIMAL(65,30), ADD COLUMN "calculated_output_cost" DECIMAL(65,30), ADD COLUMN "calculated_total_cost" DECIMAL(65,30), ADD COLUMN "internal_model_id" TEXT;`
  - `GET /repos/langfuse/langfuse/contents/packages/shared/clickhouse/migrations/canonical/0031_add_usage_pricing_tier_columns.up.sql` → 原文：`ADD COLUMN usage_pricing_tier_id Nullable(String)` / `usage_pricing_tier_name Nullable(String)`
  - `GET /repos/langfuse/langfuse/contents/docker-compose.yml` → 服务实测：`langfuse-web`、`langfuse-worker`、`clickhouse:25.12`、`minio`、`redis:7`、`postgres:17`
  - `GET /repos/langfuse/langfuse/contents/ee/LICENSE` → size=**约 3 KB**，**全文已取**（见下）
  - `GET /repos/langfuse/langfuse/contents/ee/src/ee-license-check/index.ts` → 全文实测：
    ```ts
    export const isEeAvailable: boolean =
      env.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION !== undefined ||
      env.LANGFUSE_EE_LICENSE_KEY !== undefined;
    ```
  - `GET /repos/langfuse/langfuse/git/trees/main?recursive=1` → `ee/`、`web/src/ee/`、`worker/src/ee/` 合计 **129 个文件**；门控特性目录实测：`web/src/ee/features/{admin-api,audit-log-viewer,billing,multi-tenant-sso,sfdc-sync,sso-settings,ui-customization,verified-domains}`、`worker/src/ee/{cloudSpendAlerts,cloudUsageMetering,dataRetention,meteringDataPostgresExport,usageThresholds,fipsMode.ts}`
  - `GET /repos/langfuse/langfuse/git/trees/main?recursive=1` → `worker/src/scripts/upsertDefaultModelPrices.ts`、`worker/src/scripts/createDefaultModelPricesJson.ts`、`web/src/features/dashboard/components/ModelCostTable.tsx`、`ModelUsageChart.tsx`（**均在 MIT 核心路径下，不在 ee/ 内**）
- **解决哪一层**：LLM 成本与用量可观测（自建/自托管）
- **【许可证定性：自定义商业协议，不是 FSL】** `ee/LICENSE` 原文关键句：
  > "Langfuse is an open core project. Langfuse's core is permissively licensed (MIT license). Certain parts of the periphery of Langfuse are **commercially licensed and governed by this Enterprise License**."
  > "the below license and its licensed materials... the core of Langfuse as it is defined in its license in the directory "/LICENSE" (as opposed to this file "ee/LICENSE") **which can be used and run without infringing the below license** and its licensed materials."
  > "This software... may only be used, if you (and any entity that you represent) have agreed to, and are in compliance with, the applicable agreement... as agreed by you and Langfuse GmbH or ClickHouse, Inc... **and otherwise have a valid Langfuse Enterprise License**."
  > "Notwithstanding the foregoing, **you may copy and modify the Software for development and testing purposes, without requiring a subscription.**" / "it is forbidden to copy, merge, publish, distribute, sublicense, and/or sell the Software."
  ⇒ **三点结论**：
  1. **不是 Functional Source License（FSL），也不是自定义"源码可见"条款** —— 是一份**纯商业许可**：ee/ 代码在**没有 Langfuse Enterprise License 时连"复制修改"都不允许**（仅 dev/test 例外），且明文禁止 copy/merge/publish/distribute/sublicense/sell。
  2. **核心（`/LICENSE`，MIT Expat）可自由使用、修改、部署、商用** —— 顶层 LICENSE 正文实测："All content that resides under the "ee/", "web/src/ee/", and/or "worker/src/ee/" directories... is licensed under the license defined in "ee/LICENSE"... Content outside of the above mentioned directories... is available under the "MIT Expat" license."
  3. **`isEeAvailable` 决定 EE 代码路径是否启用**：自托管时**不设** `LANGFUSE_EE_LICENSE_KEY`、**不设** `NEXT_PUBLIC_LANGFUSE_CLOUD_REGION` ⇒ `isEeAvailable === false` ⇒ **EE 特性不激活**。
  ⇒ **【回答「可本地自建的 LLM 成本追踪能否成立」：成立，且有机制保证】** 成本观测链路的全部代码（`observations.calculated_total_cost`、`usage_pricing_tier_id`、`ModelCostTable.tsx`、`ModelUsageChart.tsx`、`upsertDefaultModelPrices.ts`）**全部在 MIT 核心路径下，不在 `ee/` 内**；自托管不配 EE 密钥即可完整运行。**但**：`usageThresholds`（用量阈值/余额告警）、`cloudSpendAlerts`、`cloudUsageMetering`、`meteringDataPostgresExport`、`billing`（发票/优惠码/计费页）、`audit-log-viewer`、`admin-api`、`multi-tenant-sso` **均在 EE 内** ⇒ **mulpub 想要的"积分不足预警"和"把计量数据导回自己的 PostgreSQL 做对账"，在 Langfuse 里是 EE 能力，要么买许可要么自己实现。** 这不构成"不能自建成本追踪"，但意味着 **Langfuse 只能解决"看"，不能解决"告警"与"对账出库"**。
- **适配点**
  1. **观测表带成本列**（实测 DDL）：`observations` 表有 `calculated_input_cost` / `calculated_output_cost` / `calculated_total_cost`（DECIMAL(65,30)）+ `internal_model_id`。
     → mulpub 的 `ModelUsageDaily`/`ModelUsageBatch` 应在**写入用量时就落成本**，而不是事后离线算。事后算 = 单价改了就对不上历史账。
  2. **定价层级（pricing tier）是一等公民**（`usage_pricing_tier_id` / `usage_pricing_tier_name`）：同一模型不同调用场景可以有不同单价（批量/峰值/普通）。mulpub 的"内置模型运营功能：倍率配置"在 Langfuse 里就是 tier 表。**这个字段 mulpub 现在完全没有。**
  3. **模型单价注册脚本**（`upsertDefaultModelPrices.ts` + `createDefaultModelPricesJson.ts`）：单价表有明确的" upsert "生命周期（新增/改名/调价），可与候选 3 的 LiteLLM 单价表互为对照 —— 两家独立维护的单价表，**交叉比对能查出谁更准**，这是很有价值的对账手段。
  4. **成本看板已有现成形态**：`ModelCostTable.tsx` / `ModelUsageChart.tsx` —— ops-center/frontend 的"内置模型运营"页面可以直接对着抄视图结构。
- **引入成本**：**高**。自托管要 **ClickHouse + PostgreSQL + Redis + MinIO + worker + web 六个服务**（实测 compose）。mulpub 的 ops-center 是单台 ECS 上的 FastAPI + Vue，**塞不进 ClickHouse + MinIO + worker**。且 Langfuse 是 TypeScript/Next.js，与 ops-center/frontend 虽同为 TS 但组件体系不同。
- **风险**：
  - **许可证分裂（已实测 `ee/LICENSE` 全文）**：`ee/`、`web/src/ee/`、`worker/src/ee/` 适用**自定义商业协议（非 FSL，也不是普通"源码可见"条款）** —— 无 Enterprise License 时连"复制修改"都不允许（仅 dev/test 例外），且明文禁止 copy/merge/publish/distribute/sublicense/sell；其余为 MIT Expat。**必须避开 ee/ 目录。**
  - **关键能力被 EE 门控**（实测 ee/ 共 129 个文件 + 目录清单）：计费/发票/优惠码页、**用量阈值告警（`worker/src/ee/usageThresholds`）**、云花费告警（`cloudSpendAlerts`）、**计量数据导出到 PostgreSQL（`meteringDataPostgresExport`）**、审计日志、SSO、多租户 —— 这几项恰是 mulpub 最想要的"余额不足预警"和"对账出库"。⇒ **Langfuse 只能当"成本看板"，不能当"告警与对账系统"。**
  - 单一供应商绑定：Langfuse 已被 ClickHouse 收购（版权行即证据），其 ClickHouse 依赖是**架构级**的，不是可选插件。
  - 上游商业化：自托管版功能持续向 EE 收缩。
- **建议**：**借鉴实现（数据模型 + 看板形态）**，**不部署**。若确实需要自托管观测，**更轻的替代是 OTel GenAI 语义约定 + 自建 ClickHouse 替代品**（见候选 11 与劝退节）；但如果只是要"看到每个模型花了多少钱"，mulpub 现有 `ModelUsageDaily` 加三列成本就够，不需要 Langfuse 级别的 tracing。**若坚持要部署：必须走 MIT 核心**（不配 `LANGFUSE_EE_LICENSE_KEY`、不配 `NEXT_PUBLIC_LANGFUSE_CLOUD_REGION`，使 `isEeAvailable === false`），**并接受"阈值告警与 PG 导出自己写"这个代价。**
- **置信度**：**高**（DDL 原文、compose 服务清单、顶层 license 正文、`ee/LICENSE` 全文、`ee-license-check` 源码均为实测）

### 7. apache/casbin（+ apache/casbin-pycasbin） — 最轻的 RBAC/域隔离方案，与 FastAPI 同栈

- **证据**
  - `GET /repos/casbin/casbin` → **301 Moved Permanently**；`GET -L /repos/casbin/casbin` → 真实归属 **apache/casbin**，stars=20463，language=Go，default_branch=master，pushed_at=2026-10-21T00:39:29Z，license=Apache-2.0
  - `GET /repos/apache/casbin/commits?per_page=1` → 2026-10-21，sha=c35c93d2，`fix: update golangci-lint config for v2.15 and fix lint issues`
  - `GET /repos/apache/casbin/git/trees/master?recursive=1` → total_entries=**350**（`model/` `config/` `persist/` `examples/`）
  - `GET /repos/apache/casbin/contents/examples/rbac_model.conf` → 正文：`r = sub, obj, act` / `g = _, _` / `m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act`
  - `GET /repos/apache/casbin/contents/examples/rbac_with_domains_model.conf` → 正文：`r = sub, dom, obj, act` / `g = _, _, _` / `m = g(r.sub, p.sub, r.dom) && r.dom == p.dom && r.obj == p.obj && r.act == p.act`
  - `GET /repos/casbin/pycasbin` → **301**；`GET -L` → **apache/casbin-pycasbin**，stars=1776，language=**Python**，default_branch=master，pushed_at=2026-10-20T17:49:24Z，license=Apache-2.0
- **解决哪一层**：权限模型
- **适配点**
  - `ACCESS-CONTROL-MATRIX.md` 描述的是"角色 × 资源 × 动作"矩阵 —— 这就是 Casbin 的 `rbac_model.conf`（`sub, obj, act`）。**矩阵文件可以近乎机械地转成 policy CSV**，这是最省事的一条路。
  - **"资源归属"用 `rbac_with_domains` 直接落地**（实测模型正文）：`g(r.sub, p.sub, r.dom)` —— 把 **项目/租户**当 domain，`g` 记录"user:X 是 project:Y 的 owner"。桌面端登录后请求资源时带 project id，Casbin 一次判定"此人在此项目内是否有此权限"。这正好覆盖 `Project` 表 + 资源归属的场景，且**不需要引入任何服务或额外中间件**（pycasbin 是纯 Python 库，进程内判定）。
  - `persist/adapter.go` / `persist/adapter_filtered.go` / `persist/batch_adapter.go`（实测路径）⇒ 策略存储可插拔：现有 PostgreSQL 只需实现一个 Adapter，或先用 `file-adapter` 起步。
- **引入成本**：**低**。`pip install casbin`，纯 Python 库，无外部服务，无 DB 迁移，与 FastAPI/SQLAlchemy 无冲突。**这是本轮唯一可以直接 pip 装进 ops-center 的授权库。**
- **风险**：Apache-2.0，无 AGPL/SSPL 传染。风险在于 **Casbin 表达力强但可读性弱**——`.conf` 模型的 matcher 是 DSL，团队里没人熟的话容易写出没人敢改的策略；另外 Casbin 的 policy 存文本行，**与 `ConfigAuditLog` 的审计**需要自己接（Casbin 不自带变更审计）。
- **建议**：**直接引入** `casbin`（pycasbin）。策略存 PostgreSQL（自写 Adapter），模型用 `rbac_with_domains`。**注意**：不要用 Casbin 表达"积分扣减""成本对账"这类业务规则 —— 那是 OPA/业务代码的活。
- **置信度**：**高**（两仓均为实测，模型 conf 原文已取）

### 8. openfga/openfga — 资源级（Zanzibar 式）授权，唯一支持 SQLite 的关系型方案

- **证据**
  - `GET /repos/openfga/openfga` → stars=6025，language=Go，default_branch=main，pushed_at=2026-10-22T19:45:09Z，license=Apache-2.0
  - `GET /repos/openfga/openfga/commits?per_page=1` → 2026-10-20，sha=22c4d5dd，`chore: fix errcheck lint issues (#3349)`
  - `GET /repos/openfga/openfga/git/trees/main?recursive=1` → total_entries=**704**，truncated=false
  - `GET /repos/openfga/openfga/git/trees/main?recursive=1` → `assets/migrations/postgres/`（**6 个文件**：`001_initialize_schema.sql` … `006_add_collate_index.sql`，无 007）、`assets/migrations/mysql/`（**9 个文件** = `001`–`008` 共 8 个 `.sql` + 1 个 `collation_migrations.md`）、**`assets/migrations/sqlite/`（2 个文件：`005_initialize_schema.sql` + `006_add_store_ulid_index.sql`）** —— 结论依据是 sqlite 那 2 个
  - `GET /repos/openfga/openfga/contents/pkg/server/commands/` → `check.go`、`batch_check_command.go`、`list_objects.go`、`list_objects_shadow.go`、`expand.go`
  - `GET /repos/openfga/openfga/contents/docs/list_objects/example/example.md` → 模型 DSL 原文（见下）
  - `GET /repos/openfga/openfga/license` → 正文首行 "Apache License  Version 2.0, January 2004"
- **解决哪一层**：权限模型（资源级）
- **适配点**
  - 实测 DSL 原文（可直接改写为 mulpub 的授权模型）：
    ```
    type user
    type group
      relations
        define member: [user, group#member]
    type folder
      relations
        define viewer: [user]
    type document
      relations
        define parent: [folder]
        define editor: [user]
        define viewer: [user, user:*, group#member] or editor or viewer from parent
    ```
    → mulpub 映射：`user` = 桌面端登录用户（Logto sub）、`folder` = 项目、`document` = 项目下的资源（发布任务/素材/模型配置）。**"viewer from parent" 就是"资源继承项目权限"** —— mulpub 的资源归属场景可以一行 DSL 表达完，Casbin 的 `g` 链式继承要写多行 policy。
  - `list_objects` / `list_objects_shadow` → "**列出某用户能访问的所有项目**" 是桌面端登录后首屏要的。Casbin 只能"逐个资源问能不能"，列清单要自己写循环。
  - **SQLite 支持是决定性优势**（实测有 `assets/migrations/sqlite/`）：mulpub 的 ops-center 虽有 PostgreSQL，但**桌面端登录服务**那侧若要用关系型授权，SQLite 是零运维选项。
- **引入成本**：**中**。Go 服务（要单独部署一个二进制）+ 需要一个关系库（PostgreSQL/MySQL/SQLite 均可）。**对单台 ECS 是可以接受的**（一个二进制 + 复用现有 PostgreSQL），但比 Casbin 多一个运行时。
- **风险**：Apache-2.0 无传染。风险是**引入服务后的可用性/延迟/一致性成本**（每次权限判定一次网络往返），以及**授权模型改版要迁移历史 tuple**（`002_add_authorization_model_version.sql` / `004_add_authorization_model_serialized_protobuf.sql` / `005_add_conditions_to_tuples.sql` 三条迁移就是模型演进史的痕迹）。另：Permify（同为 Zanzibar 式）实测是 **AGPL-3.0** ⇒ **不用 Permify**。
- **建议**：**条件引入**。判据很明确：**若需求止于"角色 × 资源 × 动作"+"项目内继承"⇒ 用 Casbin（低成本、进程内）；只有当出现"像 Google Docs 那样把项目分享给外部用户并支持多人协作/群组"的需求 ⇒ 才上 OpenFGA。** 现阶段 mulpub 的 `ACCESS-CONTROL-MATRIX.md` 描述的是矩阵，不是关系图 ⇒ **当前不上 OpenFGA**。
- **置信度**：**高**

### 9. wechatpay-apiv3/wechatpay-skills — 微信支付官方的「查单 / 退款幂等 / 接入质检」规则原文

- **证据**
  - `GET /repos/wechatpay-apiv3/wechatpay-skills` → stars=370，language=Python，default_branch=main，pushed_at=2026-10-13T13:45:57Z，license=MIT
  - `GET /repos/wechatpay-apiv3/wechatpay-skills/git/trees/main?recursive=1` → total_entries=**31**，truncated=false
  - `GET /repos/wechatpay-apiv3/wechatpay-skills/contents/wechatpay-payment-integration/references/流程规则与测试用例/通用-没收到回调或回调出错须查单/规则.json` → **原文已取**（见下）
  - `GET /repos/wechatpay-apiv3/wechatpay-skills/contents/wechatpay-payment-integration/references/流程规则与测试用例/退款-非成功须查单并原单重试/规则.json` → **原文已取**
  - `GET /repos/wechatpay-apiv3/wechatpay-skills/contents/wechatpay-payment-integration/references/接入质量检查清单.md` → **原文已取**
  - `GET /repos/wechatpay-apiv3/wechatpay-skills/license` → spdx=MIT，正文 "MIT License"
- **解决哪一层**：支付通道（幂等 / 查单 / 对账 / 续费）
- **适配点**（**官方规则原文，这是本轮最直接可落地的一条**）
  - **查单节奏（对账与幂等的可执行规范）**：
    > "查单以下单成功时间为起点，在订单失效（超过 time_expire）之前按节奏进行，达到项目设定的次数或超过 time_expire 后停止。**建议的节奏：默认依次间隔 5秒、30秒、1分钟、3分钟、5分钟、10分钟、30分钟查单**；已有定时任务的，也可以**每 30 秒扫描最近 10 分钟内创建且未支付的订单，同一订单查 10 次。**"
    > "查单由项目后台在这次下单之后自己发出……包括不限于这里列举的情况：处理回调的代码遇到异常时查单；定时任务扫描未支付订单并查单；下单后放入延时队列，回调到了就把这一单移出队列，到期仍在队列里就查单"
    > 反例："定时任务的方法里有查单，但**调度默认不启动、要另行配置才跑，不算已经接上**"
    → mulpub 的 `payment-event-outbox.js` 已有发件箱，**但发件箱只保证"事件一定发出去"，不保证"订单状态最终收敛"**。必须补一个**后台查单任务**：每 30 秒扫最近 10 分钟内 `status=pending` 的订单，逐单调 `/v3/pay/transactions/out-trade-no/{out_trade_no}` 查询，直到 `SUCCESS`/`CLOSED`/`NOTPAY` 终态。**这条是"会员付费后积分没到账"类工单的根治办法。**
  - **退款幂等**：
    > "申请退款没有得到成功应答时……项目要先查询这一笔退款，确认是否已经受理" / "查到退款单不存在，说明没有受理，项目要用**原商户退款单号和原参数重新申请**" / "**一分钟内一直查不到明确结果时，项目也要用原商户退款单号和原参数重新申请**"
    → mulpub 若要支持"会员退款/赠送积分回收"，**必须**实现"用原 `out_refund_no` 重试"而不是"生成新单号重试"（生成新号 = 用户可能收到两次退款）。
  - **接入质检三条铁律（官方原文）**：
    > 铁律一（高可用）："调用微信支付 API 超时了，代码会自动重试还是直接报错？……**用户快速点击两次提交，会不会创建两笔业务单？**" / "微信异步通知一直没来，系统有没有**定时主动查询**服务端状态？"
    > 铁律二（资金安全）："**金额计算必须使用整数（单位：分），杜绝浮点精度丢失。**" / "系统有没有**每天自动拉取微信账单和本地业务流水做比对**？"
    > 铁律三（零信任）："私钥是通过环境变量加载的，还是硬编码在代码里？"
    → 直接对应 mulpub 的三个待办：**①防重复下单**（幂等键）、**②定时查单**、**③每天拉微信账单对账**（这正是 prompt 问的"续费/自动扣款/对账"）。
  - **`scripts/extract_and_sign.sh` / `extract_and_sign.ps1`** —— 官方给的签名自测脚本，可用于验证 mulpub 自研的 APIv3 签名实现。
- **引入成本**：**极低**。MIT 许可、31 个文件、纯文档 + 3 个脚本。**不是代码依赖，是规则依赖。**
- **风险**：无协议风险。真实风险是**它不是 SDK，是给 AI 编码助手的 skill 文档** —— 内容是对官方《开发指引》的提炼，仓库自己也写明"标注『官方原文』或『自行归纳』，归纳项不得当作官方强制要求"。因此：**规则要当"设计参考"而非"合同条款"**，关键行为仍应以微信支付官方文档为准。另外该仓 2026-10-13 才推最后一批内容，**新近度需要持续观察**。
- **建议**：**直接采用（作为规范）**。把"查单节奏 + 退款原单号重试 + 三条铁律"转成 mulpub 的验收清单，写进 `publish-api-payment.js` 的实现要求与 `test/member-commerce-migrations.test.js` 同级的测试项。**不引入任何代码。**
- **置信度**：**高**（规则 JSON 与质检清单均为官方仓实测原文）

### 10. 支付 SDK 三选：官方 wechatpay-java / 官方 alipay-easysdk / 社区 better-wechatpay —— 结论：签名与验签必须自建

- **证据**
  - `GET /repos/wechatpay-apiv3/wechatpay-java` → stars=1546，language=Java，default_branch=main，pushed_at=2025-04-11T13:38:29Z，license=Apache-2.0
  - `GET /repos/wechatpay-apiv3/wechatpay-java/commits?per_page=1` → **2025-04-11**，sha=1dab7bec，`bump version to 0.2.17 (#361)` —— **默认分支已停更约 18 个月**
  - `GET /repos/wechatpay-apiv3/wechatpay-java/git/trees/main?recursive=1` → total_entries=1047，其中 `src/main/java` 下 **726** 个 `.java`（含 `WechatPay2Credential`/`WechatPay2Validator`/`RSAAutoCertificateProvider`/`AeadAesCipher`/`RSASigner`/`RSAVerifier`/`PrivacyEncryptor`）
  - `GET /orgs/wechatpay-apiv3/repos?per_page=50` → **官方全家桶共 10 个仓**：`wechatpay-java`(2025-04)、`wechatpay-go`(2025-07)、`wechatpay-php`(2026-09)、`wechatpay-apache-httpclient`(2025-02)、`wechatpay-guzzle-middleware`(2026-09)、`wechatpay-postman-script`(2025-05)、`CertificateDownloader`(2023-08)、`transferbatch-demo-java`(2024-11)、`wechatpay-skills`(2026-10)、`wechatpay-global-skills`(2026-06) —— **其中没有任何一个是 Node SDK 或 Python SDK**（后两个 skills 仓是给 AI 编码助手用的知识包，不是 SDK）
  - `GET /repos/alipay/alipay-easysdk` → stars=1195，language=Java，default_branch=master，pushed_at=2024-06-14，license=MIT
  - `GET /repos/alipay/alipay-easysdk/commits?per_page=1` → **2023-05-16**，sha=0b0f31d7，`Merge branch 'dev'` —— **默认分支停更 3 年 5 个月**
  - `GET /repos/alipay/alipay-easysdk/git/trees/master?recursive=1` → total_entries=676，顶层目录实测仅 `csharp/ java/ kernel/ php/ tea/ composer.json` —— **无 `python/`、无 `ts/`**（仓库 description 声称"java、c#、php、ts 等"，与实际目录**不一致**）
  - `GET /repos/alipay/alipay-easysdk/contents/CHANGELOG` → 末条实测："2023-05-16 Version: 2.2.3 / 1. 兼容新老证书切换"
  - `GET /repos/alipay/alipay-easysdk/license` → 正文 "MIT License  Copyright (c) 2020 Ant Small and Micro Financial Services Group Co., Ltd."
  - `GET /repos/vikingmute/better-wechatpay` → stars=325，language=TypeScript，default_branch=main，pushed_at=2026-03-12T06:46:15Z，license=MIT
  - `GET /repos/vikingmute/better-wechatpay/git/trees/main?recursive=1` → total_entries=184，含 `docs/native-payment.md`、`docs/jsapi-payment.md`、`docs/h5-payment.md`、`docs/error-codes.md`、`docs/debug-mode.md`
  - `GET /repos/binarywang/WxJava` → stars=33162，language=Java，default_branch=develop，pushed_at=2026-10-17T03:51:42Z，license=Apache-2.0；`commits?per_page=1` → **2026-10-10**，`【企业微信】支持客服事件 rejectSwitch 字段解析`；`git/trees/develop?recursive=1` → 6471 entries，`weixin-java-pay` 模块下 `service/impl/` 含 `BaseWxPayServiceImpl`/`EntPayServiceImpl`/`MerchantTransferServiceImpl`/`MarketingFavorServiceImpl` 等
  - `GET /repos/binarywang/WxJava/contents/weixin-java-pay/pom.xml` → 实测：`<artifactId>weixin-java-pay</artifactId>`、`<name>WxJava - PAY Java SDK</name>`、`<version>4.8.6.B</version>`、父 artifactId=`wx-java`；依赖含 `weixin-java-common`、`bcpkix-jdk18on`（**BouncyCastle —— APIv3 的 RSA 签名/验签与 AEAD 解密密码学**）、`httpclient5`、`jodd-http`
  - `GET /repos/binarywang/WxJava/git/trees/develop?recursive=1` → APIv3 配套类实测存在：`weixin-java-pay/.../config/WxPayConfig.java`、`WxPayConfigHolder.java`、`VerifierBuilder.java`、`WxPayHttpProxy.java`；`service/impl/` 下有 `BaseWxPayServiceImpl` 等 20+ 个 service impl
- **解决哪一层**：支付通道
- **适配点 / 关键结论**
  1. **【明确无法自建的缺口】微信支付没有官方 Node SDK，也没有官方 Python SDK。** 官方 org 全家桶（实测 10 个仓）实测只有 Java / Go / PHP / Apache HttpClient / Guzzle 中间件 / Postman 脚本 / 证书下载器 / 两个 skills 知识包，**没有 Node SDK、没有 Python SDK**。mulpub 的支付代码在 **Node**（`packages/api-publish-engine/src/auth/payment-*.js`），ops-center 在 **Python** ⇒ **两个栈都没有官方 SDK 可用**。
  2. **官方 SDK 全部停更**：`wechatpay-java` 默认分支最后提交 2025-04-11；`alipay-easysdk` 最后提交 2023-05-16（且 CHANGELOG 也停在同一天，版本 2.2.3）。**"用官方 SDK"在 2026 年这个时间点已经名存实亡** —— 不是"你选错了"，是**官方不再维护**。
  3. **APIv3 签名/验签/回调解密本质上就是几百行代码**：`RSASigner`（SHA256withRSA 签名）、`RSAVerifier`（验签）、`AeadAesCipher`（AEAD_AES_256_GCM 回调解密）、`RSAAutoCertificateProvider`（平台证书自动下载轮换）。这四件事在 Node 里用 `node:crypto` 原生可做（`createSign('RSA-SHA256')` + `createVerify` + `createDecipheriv('aes-256-gcm')`）。**这是"缺口"但也是"能自建"**，且 mulpub 已经自建了（`payment-schema.js` 证明建表已落地）。
  4. **社区 SDK 的最优解**：`vikingmute/better-wechatpay`（MIT，TypeScript，2026-03 仍活跃，184 文件，文档覆盖 Native/JSAPI/H5 + 错误码 + 调试模式）—— **是当前 Node 侧唯一像样的选择**。但它是**社区**不是官方 ⇒ 证书轮换、商户号校验、回调验签这些安全关键路径要自己复核。
  5. **【wechatpay-java 停更 18 个月 ⇒ 同能力的活跃替代是 WxJava，但仅在 Java 侧成立】**
     - 停更事实：`wechatpay-java` 默认分支最后提交 **2025-04-11**（`bump version to 0.2.17`），版本停在 0.2.x。
     - 活跃替代实测：`binarywang/WxJava` 默认分支最后提交 **2026-10-10**（就在本次调研当天前两周），Apache-2.0，`weixin-java-pay` 是**独立可发布的 Maven artifact**（`artifactId=weixin-java-pay`，`version=4.8.6.B`，父 `wx-java`），只额外依赖 `weixin-java-common` + `bcpkix-jdk18on`（BouncyCastle 提供 APIv3 的 RSA 签名/验签与 AEAD 回调解密）+ `httpclient5`。
     - 能力等价性实测：`weixin-java-pay` 里有 `config/WxPayConfig.java`、`WxPayConfigHolder.java`、`VerifierBuilder.java`、`WxPayHttpProxy.java` 与 `service/impl/BaseWxPayServiceImpl` 等 20+ 个 service impl ⇒ **APIv3 的签名/验签/证书/通知解析能力齐备**，与 `wechatpay-java` 同层级且在维护。
     - **但对 mulpub 仍不推荐引入**：`weixin-java-pay` 是**微信全生态 SDK**（`weixin-java-mp`/`-cp`/`-miniapp`/`-channel`…，全仓 6471 文件、pay 相关 770 个 java 文件），mulpub 只需要"Native 下单 + 查单 + 退款 + 通知验签"四件事；且 **mulpub 的支付代码在 Node（`packages/api-publish-engine/src/auth/payment-*.js`）与 Python（ops-center），两端都用不了 Java artifact**。
     - ⇒ **WxJava 的正确用法是"读，不引"**：把它的 `BaseWxPayServiceImpl` / `WxPayConfig` 当作**官方口径的封装参考**（尤其"证书自动轮换 + 通知验签 + 幂等号生成"三处的正确做法），翻译成 Node `node:crypto` 的实现。
  6. **支付宝侧**：官方 easysdk 无 Python/TS 且停更 ⇒ 支付宝也必须**自研 HTTP + RSA2 签名 + AES 解密**。**mulpub 走微信 Native 支付（`payment-schema.js` 建的是微信 Native 表），支付宝当前不是必需项**，建议直接不做，除非业务上要覆盖 iOS/安卓内购。
- **引入成本**：
  - `better-wechatpay`：**低**（MIT、TypeScript、纯 npm 包），但引入后仍要**自行实现查单任务与对账**（SDK 只管 API 调用）。
  - 官方 Java SDK：**不适用**（Java 栈，与 mulpub 双栈都不匹配）。
- **风险**：
  - 社区 SDK 的供应链风险（325★，单一维护者）。
  - **不要用停更的官方 SDK 产生"我们用了官方 SDK 所以安全"的错觉** —— 停更意味着新的支付产品/证书策略/验签方式变更不会被跟进。
  - 微信支付**没有官方 Node SDK 这一点本身**是长期风险：API 变更要自己盯文档。
- **建议**：
  - **不引入** `wechatpay-java`（默认分支停更于 2025-04-11，版本停在 0.2.x；且 Java 栈、766 个 java 文件全量能力过剩）。
  - **不引入** `alipay-easysdk`（停更 3.5 年 + 无 Python/TS + README 与目录不一致）。
  - **不引入** `binarywang/WxJava`（虽 2026-10-10 仍活跃、Apache-2.0、是 `wechatpay-java` 停更后的**同能力活跃替代**，但重量级、全生态覆盖，且 Java 栈与 mulpub 的 Node/Python 双栈都不匹配 ⇒ **读其 `weixin-java-pay` 的 APIv3 封装作为实现参考，不引入 artifact**）。
  - **可考虑引入** `vikingmute/better-wechatpay`（Node 侧唯一可用），**但仅作为 API 调用的便捷层**；**签名/验签/证书轮换/查单/对账必须自己掌控并按候选 9 的官方规则验收**。
  - **明确记录缺口**：微信支付官方无 Node/Python SDK；支付宝官方 SDK 无 Python/TS 且停更 ⇒ **支付通道的签名/验签/回调解密在 mulpub 内部是"自建且需长期维护"的组件**，必须有人负责盯官方文档。
- **置信度**：**高**（停更日期、目录内容、org 仓清单均为实测；`better-wechatpay` 未逐行读实现，故对其内部正确性置信度为**中**）

### 11. VictoriaMetrics/VictoriaMetrics — 单机 ECS 上最轻的指标/日志/告警底座

- **证据**
  - `GET /repos/VictoriaMetrics/VictoriaMetrics` → stars=17893，language=Go，default_branch=master，pushed_at=2026-10-23T02:56:22Z，license=Apache-2.0
  - `GET /repos/VictoriaMetrics/VictoriaMetrics/commits?per_page=1` → 2026-10-22，sha=7b932666，`app/vmselect: fix the default time range for /admin/tenants (#11802)`
  - `GET /repos/VictoriaMetrics/VictoriaMetrics/git/trees/master?recursive=1` → total_entries=**10764**，truncated=false
  - `GET /repos/VictoriaMetrics/VictoriaMetrics/git/trees/master?recursive=1` → `app/` 下实测：`victoria-metrics/`（单节点 TSDB）、`vmagent/`（采集）、`vmalert/`（告警，兼容 Prometheus 规则）、`vmselect/`、以及日志侧 `victoria-logs/`、`vlstorage/`、`vlselect/`、`vlagent/`、`vlinsert/`、`vlogscli/`，另有多租户侧 `vmauth/` 与备份侧 `vmbackup/`、`vmbackupmanager/`、`vmctl/`
  - `GET /repos/VictoriaMetrics/VictoriaMetrics/license` → 正文首行 "Apache License  Version 2.0, January 2004"
- **解决哪一层**：可观测性与告警
- **适配点**
  - `victoria-metrics`（单节点 TSDB）+ `vmagent`（抓 FastAPI `/metrics`）+ `vmalert`（Prometheus 规则）= **指标 + 告警**，三个二进制、无依赖服务。
  - `vlagent`/`vlstorage`/`vlselect` = **日志**（Loki 兼容查询），能吃掉 uvicorn 的 JSON 日志。
  - `vmauth` = **多租户 + 访问控制**，若 ops-center 要对外暴露指标端点，可用 `vmauth` 做 basic/token auth 限流。
  - **与 mulpub 的直接结合点**：`ModelUsageDaily` 是业务表不是指标。若把"每日内置模型成本"、"积分发放总量"、"会员续费率"以 Prometheus 指标暴露（`model_cost_cents_total{model=..., day=...}`），就能用 `vmalert` 配"单日成本超阈值告警"—— 这比在 ops-center 里自己写定时器查库更标准。
  - 相比 Prometheus：VictoriaMetrics 的 `victoria-metrics` 单体 + `vmagent` 在**资源占用**上明显更省（官方以 resource-efficient 为主诉求），适合单台 ECS。
- **引入成本**：**低**。纯 Go 静态二进制，无外部依赖（存储就是本地目录），Docker 一条命令起。**不与 FastAPI/SQLAlchemy 冲突，是旁路组件。**
- **风险**：Apache-2.0 无风险。风险在于**团队熟悉度**（Prometheus 规则语法兼容但 VictoriaMetrics 有自己的扩展语法与 `vmui`），以及**单机无高可用**（VM 的集群版 `vmselect`/`vmstorage` 对单台 ECS 是过度投入）。
- **建议**：**直接引入**（或与之等价的 Prometheus + Alertmanager）。具体：①`victoria-metrics` + `vmagent` + `vmalert` 三件套；②`/metrics` 端点用 `prometheus-fastapi-instrumentator`（Python 侧）暴露；③**必配三条告警**：单日模型成本超阈值、积分发放量与消耗量失衡、ops-center `/health` 失败。
- **置信度**：**高**（目录结构实测）；**未取证**：具体告警规则样例与最低资源占用数字（未实测官方 benchmark，**不写具体数字**）

### 12. pure-admin/vue-pure-admin — Element Plus 同栈的运营后台模板，只借鉴不替换

- **证据**
  - `GET /repos/pure-admin/vue-pure-admin` → stars=20703，language=**Vue**，default_branch=main，pushed_at=2026-10-12T06:10:23Z，license=MIT，description="全面ESM+Vue3+Vite+Element-Plus+TypeScript编写的一款后台管理系统（兼容移动端）"
  - `GET /repos/pure-admin/vue-pure-admin/commits?per_page=1` → 2026-10-12，sha=fae75ad1，`perf: 优化退出登录逻辑`
  - `GET /repos/pure-admin/vue-pure-admin/git/trees/main?recursive=1` → total_entries=**847**，truncated=false
  - `GET /repos/pure-admin/vue-pure-admin/contents/package.json` → 依赖实测：`element-plus ^2.14.7`、`vue ^3.5.43`、`pinia ^4.0.3`、`vue-router ^5.4.0`
  - `GET /repos/pure-admin/vue-pure-admin/git/trees/main?recursive=1` → 关键路径实测：`src/store/modules/permission.ts`、`src/views/system/role/{index.vue,form.vue,utils/{hook.tsx,rule.ts,types.ts}}`、`src/views/system/user/form/role.vue`、`src/views/permission/button/{index.vue,perms.vue}`、`src/views/permission/page/index.vue`（`perms.vue` 是 `button/` 的子文件，不是 `permission/` 同级）
  - `GET /repos/pure-admin/vue-pure-admin/license` → spdx=MIT
- **解决哪一层**：后台底座
- **适配点**
  - **栈完全对齐**：ops-center/frontend 就是 Vue 3 + Element Plus。pure-admin 的 `element-plus ^2.14.7` 与 `vue ^3.5.43` 版本可直接对齐，**不需要像 Vben Admin（Ant Design Vue）或 Soybean Admin（Naive UI）那样做换肤式重写**。
  - **可借鉴的具体三处**：
    1. **三级权限模型落地形态**（`src/views/permission/` 实测目录）：`button/`（按钮级）、`page/`（页面级）、`perms.vue` —— 把"菜单可见性"与"按钮可点性"分成两套 key。对应 mulpub 的 `ACCESS-CONTROL-MATRIX.md` 落地到前端。
    2. **角色管理表单**（`src/views/system/role/utils/{hook.tsx,rule.ts,types.ts}`）：`types.ts` 分离类型定义、`rule.ts` 分离校验规则、`hook.tsx` 分离交互逻辑 —— **这种三文件拆分法可以直接套到 ops-center 的"内置模型运营功能"页面**（倍率配置表 / 成本看板 / 备选模型降级配置），避免把表单、校验、请求全塞进一个 `.vue`。
    3. **`src/store/modules/permission.ts`（Pinia store）**：前端权限态的单一来源。mulpub 现在的 `entitlement.js`（权益令牌）在前端也应有一个对应的 store 收敛。
  - **明确不是"整体替换"**：pure-admin 是模板（含大量 demo 页面、mock 数据、演示用 store），**把它当底座 = 重写 ops-center/frontend 的全部业务页面**，且要清理 demo 依赖，净收益可能为负。**它的价值是"抄结构"，不是"换底座"。**
- **引入成本**：**低（只抄文件）/ 高（整体引入）**。整体引入意味着重写所有页面 + 清理 mock + 适配已有 API，**不建议**。抄 3-5 个文件的结构：**接近零成本**。
- **风险**：MIT 无风险。风险在于**照抄模板代码导致 ops-center/frontend 变成"框架的延伸"** —— 模板的路由约定、请求封装、权限 key 命名会渗透进业务代码，之后想换就难。**只抄目录组织方式，不要引入它的 `utils/request`、它的 store 骨架。**
- **建议**：**借鉴实现**。具体：①抄 `permission/` 的按钮/页面二级权限 key 划分；②抄 `views/system/role/utils/` 的 types/rule/hook 三文件拆分法，应用到"内置模型运营"页面；③**不整体替换**。
- **置信度**：**高**（依赖版本、目录路径均为实测）；**未取证**：`src/store/modules/permission.ts` 的完整实现（只做了关键词匹配，**未逐行读**）

### 13. 兑换码数据模型：saleor/saleor（三表模型）+ l4rm4nd/VoucherVault（反面基线）

- **证据**
  - `GET /repos/saleor/saleor` → stars=23464，language=Python，default_branch=main，pushed_at=2026-10-22T14:35:30Z，license=BSD-3-Clause
  - `GET /repos/saleor/saleor/git/trees/main?recursive=1` → total_entries=**5240**，truncated=false
  - `GET /repos/saleor/saleor/contents/saleor/discount/models.py` → size 对应 **693 行**；实测类与字段：
    - `class Voucher(ModelWithMetadata, ModelWithExternalReference)`（line 122）→ `usage_limit = models.PositiveIntegerField(null=True, blank=True)`（127）、`start_date`（128）、`end_date`（129）、`discount_value_type`（138）
    - `class VoucherCode(models.Model)`（line 261）→ **`code = models.CharField(max_length=255, unique=True, db_index=True)`（263）、`used = models.PositiveIntegerField(default=0)`（264）**
    - `class VoucherCustomer(models.Model)`（line 312）
  - `GET /repos/l4rm4nd/VoucherVault` → stars=513，language=HTML，default_branch=**main**，pushed_at=2026-10-09T07:49:17Z，license=GPL-3.0
  - `GET /repos/l4rm4nd/VoucherVault/commits?per_page=1` → 2026-10-09，sha=00fb9373，`chore(release): v1.30.3 [skip ci]`
  - `GET /repos/l4rm4nd/VoucherVault/contents/myapp/models.py` → 实测：`class Item`：`id = UUIDField(primary_key=True)`、`type`、`name`、**`redeem_code = models.CharField(max_length=255)`（明文）**、`code_type`、`pin`、`issuer`、`issue_date`、`expiry_date`、`value = DecimalField(max_digits=10, decimal_places=2)`、`value_type`、**`is_used = models.BooleanField(default=False)`（单个布尔，无计数、无锁）**、`user = ForeignKey(User)`；`class Transaction`：`item = ForeignKey(Item, related_name="transactions")`、`date`、`description`、`value`；`class ItemShare`：`item`、`shared_with_user`、`shared_at`、`shared_by`
  - `GET /repos/l4rm4nd/VoucherVault/license` → 正文 "GNU GENERAL PUBLIC LICENSE  Version 3, 29 June 2007"
  - API 异常记录：`GET /repos/l4rm4nd/VoucherVault/git/trees/master?recursive=1` 返回 **404 Not Found**（该仓默认分支实为 `main`，且 `contents` 端点逐层可用）—— 故其结构证据改由 `contents` 端点取得
- **解决哪一层**：兑换码 / 礼品卡 / 优惠码
- **适配点**
  1. **Saleor 的三表拆分是正确答案**（实测）：`Voucher`（**规则**：限额/有效期/折扣类型） + `VoucherCode`（**码本体**：`code` unique + `used` 计数器）+ `VoucherCustomer`（**谁领了**：一人一券）。mulpub 现在的 `RedemptionCode` 是单表，**规则、码、领取人混在一起** ⇒ 无法表达"一个规则发一批码"（运营批量生成场景），也无处记"同一用户是否已领过"（防刷位）。
  2. **`used = PositiveIntegerField(default=0)` 是核销计数的标准形态**（实测）。mulpub 若要"一个码可兑换 N 次"，字段应是计数器而非布尔。
  3. **VoucherVault 是"反面基线"**（实测其缺陷）：`redeem_code` **明文存储**（可枚举、可爆破）、`is_used` 是**单个布尔**（无并发保护：两个并发请求读到 `is_used=False` 都会通过）、`Transaction` 表**只记流水不记核销动作的状态机**。**它证明了"兑换码的开源实现普遍在事务正确性上是弱的"** —— 核销事务必须自建：唯一索引 + `SELECT ... FOR UPDATE` + 条件更新 `UPDATE ... SET used=used+1 WHERE id=? AND used < limit`（受影响行数为 0 即失败）。
  4. **防刷位**：Saleor 的 `VoucherCustomer`（一人一券）+ Lago coupon 的 `unique_code_per_customer` 指向同一件事。mulpub 的 `publish-api-redeem-code-admin.js` 若无"每用户每码限一次"的约束，代码会被分享盗用。
  5. **哈希存储**：若 mulpub 要防枚举，存 `sha256(code)` 而非明文（VoucherVault 明确没做，这是它不足）。
- **引入成本**：**不引入**。Saleor 是完整电商平台（BSD-3 但引入即侵入），VoucherVault 是 Django 单体应用（**GPL-3.0**，若改造后分发有传染风险）。**只抄字段划分**。
- **风险**：
  - Saleor：BSD-3-Clause 协议友好，但整体引入侵入性极大（**明确排除**）。
  - VoucherVault：GPL-3.0 ⇒ **不可复制代码**，只可参考思路（且其思路本身有缺陷）。
  - **无一个开源候选在核销事务上是"可直接引入的成品"** —— 这是本维度的**明确缺口**。
- **建议**：**借鉴实现（数据模型）**。①`RedemptionCode` 拆成 `RedemptionRule` / `RedemptionCode` / `RedemptionClaim` 三表（对齐 Saleor）；②`used` 改计数器；③核销走"唯一索引 + 行锁 + 条件更新"；④码改哈希存储；⑤加"每用户每码一次"约束。**不引入 Saleor / VoucherVault。**
- **置信度**：**高**（两仓字段级实测）；**未取证**：Saleor `VoucherCustomer` 的完整字段（只确认了类存在与行号 312，未读其字段）

---

## 三、不确定项与未覆盖

1. **Metronome 的开源 SDK 状态未取证**。本轮未查 `metronomehq/*` 或 `metronome-oss/*` 的仓库是否存在与其 SDK 覆盖范围。判断依据是 Metronome 主产品闭源、其 SDK 只解决"往 Metronome 打用量事件"而非"自己算钱"，与 mulpub "要自己控制成本以免亏本"的方向相反，**但这一判断未用 API 证据验证**，需补查后确认。
2. **ClickHouse 事件建模未单独取证**。本轮通过 Langfuse（`packages/shared/clickhouse/migrations/canonical/`）与 Lago（`extra/clickhouse/`、`kafka-connect/clickhouse-kafka-connect-v1.3.4/`）间接确认了"事件 → ClickHouse"是主流做法，但**未对 `ClickHouse/ClickHouse` 本体做 metadata + 目录树取证**，也未量化 ClickHouse 在单台 ECS 上的运维代价。
3. **OpenMeter 的 `meter` 模块没有 README**（`GET /contents/openmeter/meter/README.md` 返回 **404 Not Found** —— 该文件不存在，`openmeter/meter/` 目录下无任何 README）。`MeterAggregation` 枚举与 `Meter` 结构体字段（`ValueProperty`/`GroupBy`）是从 `meter.go` **源码**取到的，**结论成立，但"无官方文档佐证"这一事实本身就是结论的一部分**（OpenMeter 的 meter 语义只能靠读码，不能靠读文档）。
4. **OpenMeter 的 ledger 分录表结构未下钻**。只取到 `openmeter/ledger/README.md` 的账户种类表与"不可变分录账本"描述，**未取 `ledger` 的建表 DDL**，`entries`/`transactions`/`transaction_groups` 的字段级设计未验证。
4b. ~~**OpenMeter 的 `llmcost` 侧只验证了价格模型，未验证计价执行链**~~ —— **已在本轮补证，见正文候选 1 适配点第 9 条**：`openmeter/llmcost/adapter/price.go`（**308 行**，含 `ListPrices` / `GetPrice` / **`ResolvePrice`** / `CreateOverride` / `DeleteOverride` / `ListOverrides` / `UpsertGlobalPrice`）、`openmeter/llmcost/service/service.go`（约 5 KB）、`openmeter/llmcost/sync/reconciler.go`（约 7 KB）三处均已确认存在，`ResolvePrice` 的查询与排序逻辑已逐行取到。**仍存疑的只剩一点**：`alpacadecimal.Decimal` 的精度行为（小额 token 价的四舍五入/截断策略）未逐行读实现 —— 这一点对"积分换算不亏本"关键（是否会出现"单次调用四舍五入后成本归零"），落地前应实测。
4c. **【新增】"按张/按秒"没有对应的开源 per-unit 价格模型**。已确认 OpenMeter 的 `llmcost` 只覆盖 token 维度（input/output/cache_read/cache_write/reasoning per token），"按张（图片）""按秒（视频生成时长）"**只能用 meter 计量 + 自定义定价规则**。本轮**未找到**任何专门做 per-image / per-second LLM 计价的开源小库 ⇒ 该口径的换算规则需 mulpub 自建（可参考 opencost 的 `AllocationMethod=compute_time` 与 `multiplier` 语义）。
5. **LiteLLM `model_prices_and_context_window.json` 的字段结构未逐项核对**（只确认 size=约 2898 KB），**未验证它是否有"每百万 token 单价"字段**、是否有历史版本；也**未验证** `litellm.completion_cost()` 纯函数的准确度。
6. **Kill Bill 的 dunning（欠费催缴）实现未取证**：`GET /repos/killbill/killbill-dunning` → 404，说明不在本仓，但**未找到它真正的仓地址**，因此"续费失败后如何降级/停服"的实现未验证。
7. **`vikingmute/better-wechatpay` 的实现未逐行读**（只取到 metadata + 184 文件目录树 + 文档列表）。**其回调验签、证书轮换、幂等处理的正确性未验证**，置信度仅"中"。
7b. **【新增】Langfuse 的 EE 门控是"按目录"而非"按功能开关"**。已实测 `isEeAvailable` 的判定逻辑与 129 个 ee 文件的目录清单，**但未逐个验证每条业务路径是否都受该开关保护**（例如 `web/src/ee/features/billing` 的页面在无 EE 密钥时是"隐藏"还是"点开报错"未验证）。落地前需实测一次无密钥自托管启动，确认核心功能可用。
7c. **【新增】`wechatpay-skills` 的规则覆盖哪些产品线未验证**。该仓 `SKILL.md` 与"产品角色版本与验签方式的确认.md"表明规则**按产品/商户角色/API 版本分档**，本轮只取到了"通用"档的查单/退款/质检三份，**Native 下单、H5、JSAPI、委托代扣/自动续费等具体产品的规则未取证** —— 而"自动扣款/续费"正是 mulpub 需要的部分，**必须补查**。
7d. **【新增】`wechatpay-skills` 仓内只有 21 个 blob，**没有 `assets/` 目录**，但其文档（`SKILL.md`、`references/文档检索与问答.md`、`references/接入质量检查清单.md`、`references/APIv3签名验签本地测试.md`、`references/产品角色版本与验签方式的确认.md`）大量引用 `<SKILL目录>/assets/微信支付官网文档/...` 与 `./assets/wechatpay-docs-guide.md`（实测原文如 "默认「答疑与排障」查 `<SKILL目录>/assets/微信支付官网文档/` 全库"、"先读 `<SKILL目录>/assets/wechatpay-product-overview.md`"）⇒ **这些被引用的官方文档知识库在仓内不存在（通过 skill marketplace 另行分发），无法用本仓证据核对其出处**。
   ⇒ **对本报告结论的影响**：候选 9 引用的三份内容（`规则.json` × 2、`接入质量检查清单.md`）**正文本身是自包含的、可直接采用**，但**它们所援引的官方文档链接无法在本仓验证** ⇒ 落地时**须以微信支付官方《开发指引》原文二次核对**后再作为验收依据，不要把本仓文档当合同条款。
8. **Alipay 侧整体未深入**：未查支付宝是否有其他官方或半官方 Python 仓、是否值得接（结论偏向"当前不做"，基于 mulpub 已选微信 Native）。
9. **「按张/按秒」的计量实现已由 4c 收敛**：OpenCost 的 `AllocationMethod=compute_time` 覆盖"按秒"，"按张（图片）"在 `CostBasis` 层面仅隐含，**未找到专门做 per-image / per-second LLM 计价的开源小库**（与 4c 同源，结论一致：需自建）。本条只补充一点：**OpenCost 的 `compute_time` 是"按 vLLM 推理时长分摊成本"，不是"按用户购买的视频秒数计费"**，语义不同，不可直接套用。
10. **ops-center 现有 `RedemptionCode` / `ModelUsageDaily` 的实际 DDL 未逐字段读**（本轨道不拥有 mulpub 代码仓），因此"现有表缺哪些字段"是**基于 prompt 给出的表名清单与代码级描述推断**，未在代码里逐条核对。落地前应以实际 `models.py` 为准。
11. **Metronome / PostHog / Cube 等事件建模候选整体未评估**（本轮只覆盖了 13 个候选 + 劝退清单）。
12. **`PURE` 以外的后台底座（Ant Design Pro、Vue Vben Admin、Soybean Admin）的角色/权限实现未下钻** —— 结论基于"技术栈不匹配（Ant Design Vue / Naive UI ≠ Element Plus）"这一**架构层判断**，未读其权限模块源码。

---

## 四、本文档明确劝退的项目

以下项目都做过 metadata / license 取证，**结论一律是不引入**。不劝退但没进正文候选的（如 Medusa、Vendure、ERPNext、Refine、Helicone、OpenLLMetry、Phoenix、OPA、Permify）也一并列出，附劝退理由。

### 4.1 整体替换自研运营后台 —— 全部劝退

| 项目 | 实测证据 | 劝退理由 |
|---|---|---|
| **appsmithorg/appsmith** | stars=41108，TypeScript，default_branch=release，pushed=2026-10-23，license=Apache-2.0 | 低代码平台，**引入即把 ops-center 变成"在 Appsmith 里搭的页面"**，而 mulpub 的 40 张表 + 权益矩阵 + 采集风控不是低代码能表达的东西；且 Appsmith 自带 DB 抽象，会与 SQLAlchemy 模型争夺真相源 |
| **nocobase/nocobase** | stars=24672，TypeScript，default_branch=main，pushed=2026-10-23，license=NOASSERTION；`GET /contents/LICENSE.txt` 正文首行为 **"NocoBase License Agreement"（Updated Date: February 24, 2026），非 OSI 开源** | **许可证不是开源协议**，含商业授权与采购条款（正文要求"购买商业 license 和 services"）。**协议层面直接排除** |
| **directus/directus** | stars=38621，TypeScript，default_branch=main，pushed=2026-10-22，license=NOASSERTION；`GET /contents/license` 正文首行 **"# Monospace Sustainable Core License, Version 1.0"** | **不是开源协议**（BSL 类 sustainable-use），有使用规模限制。同样排除 |
| **ToolJet/ToolJet** | stars=41119，HTML，default_branch=main，pushed=2026-10-23，license=**AGPL-3.0** | 低代码 + AGPL，网络服务场景有开源义务；且它需要自己的 DB 抽象层 |
| **Budibase/budibase** | stars=28342，TypeScript，default_branch=master，pushed=2026-10-22；`GET /repos/Budibase/budibase/license` → 正文实测（`LICENSE`）："Each Budibase package has its own license, please check the license file in each package." / "You can consider Budibase to be **GPLv3 licensed overall**." / "The apps that you build with Budibase **do not package any GPLv3 licensed code, thus do not fall under those restrictions**." ⇒ spdx 记为 NOASSERTION，**实际是「逐包授权、整体按 GPLv3 计」** | 同类低代码，**协议风险与 Appsmith/ERPNext 同类（GPL 系），但其官方明确"自建应用不传染"**；真正的劝退理由是**架构侵入同 Appsmith**（低代码平台接管 ops-center 的页面与数据抽象），不是协议 |
| **medusajs/medusa** | stars=36861，TypeScript，default_branch=**develop**，pushed=2026-10-23，license=NOASSERTION；`GET /contents/LICENSE` 正文："Except for the Enterprise Edition materials identified in ENTERPRISE-LICENSE.md, the repository is licensed under the MIT License" | 完整电商内核（商品/订单/区域/促销/库存），**会员积分场景要用它得自建 80% 的模型**；且它会接管 mulpub 的 PostgreSQL 商业化闭环（`identity_orders` / `identity_payment_customers`）。**数据模型可读，整体引入排除**。**与 vendure 的对照**：两者协议都落到 GPL 系（medusa = MIT 主体 + `ENTERPRISE-LICENSE.md` 的 EE 物料；vendure = GPLv3 社区版 / VCL 商业版双轨），**但劝退理由在两者身上都是体量与侵入性，不是协议** —— 只有 NocoBase（自定义商业协议）、Directus（MSCL，非开源）、ToolJet（AGPL）、Phoenix（ELv2）、Permify（AGPL）、VoucherVault（GPL）是"因协议而排除" |
| **vendurehq/vendure** | `GET /repos/vendure-ecommerce/vendure` → 301 → `vendurehq/vendure`，stars=8533，TypeScript，default_branch=master，pushed=2026-10-22；`GET /repos/vendurehq/vendure/license` → 正文实测（`LICENSE.md`）**双协议**："This software is available under two different licenses: * GNU General Public License version 3 (GPLv3) as Vendure Community Edition * Vendure Commercial License (VCL)"，且 "The default Vendure license, without a valid Vendure Commercial License agreement, is the Open-Source GPLv3 license." ⇒ spdx 记为 NOASSERTION，**实际默认落到 GPLv3** | 同 Medusa，插件式电商内核（**协议维度与 ERPNext/Appsmith 同类，但劝退理由同样是体量与侵入性，不是协议**），**为"三档会员 + 固定积分"付出整套电商抽象不划算** |
| **frappe/erpnext**（ERPNext 订阅模块） | `GET /repos/frappe/erpnext` → stars=40468，language=Python，default_branch=develop，pushed_at=2026-10-23T04:38:31Z，**license=GPL-3.0**；`GET /repos/frappe/erpnext/license` → 正文实测 "GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007"；`GET /contents/pyproject.toml` → `name = "erpnext"`、`requires-python = ">=3.14"`、`[tool.bench.frappe-dependencies] frappe = ">=17.0.0-dev,<18.0.0"`（**方向是 erpnext 依赖 frappe 框架，不是反过来**）；`GET /repos/frappe/erpnext/git/trees/develop?recursive=1` → total_entries=**7269**，顶层模块实测含 `accounts` `buying` `crm` `stock` `manufacturing` `hr` `payroll` `projects` 等 | **劝退理由落在"架构体量"，不是协议。** 协议层面要说清：`frappe/frappe`（框架本体）实测 license 正文为 **"The MIT License / Copyright (c) 2016-2021 Frappe Technologies Pvt. Ltd."** ⇒ **框架是 MIT**；`frappe/erpnext`（业务应用）实测是 **GPL-3.0**，且它是**依赖** MIT 框架的上层应用（`[tool.bench.frappe-dependencies] frappe = ">=17.0.0-dev,<18.0.0"`）。所以"用 Frappe 框架（MIT）自写一个只含会员/积分的 Frappe app"在协议上可行。**但体量上不划算**：ERPNext 7269 个文件、覆盖 accounts/buying/crm/stock/manufacturing/hr/payroll/projects 全套会计与业务域，其中"订阅"语义是"按发票周期扣服务费"（服务续订），与 mulpub 的"按月发放积分 + 余额扣减 + 成本对账"不是同一套语义；而 Frappe 的 docType 元数据模型会与 ops-center 现有的 SQLAlchemy 表模型形成**两套真相源**。⇒ **排除，理由是体量与双真相源，不是 GPL。**（对比：候选 13 的 Saleor 是 BSD-3、劝退理由是体量/侵入性而非协议；候选 2 的 Lago 则不同 —— 它"作为服务"的选项**同时**因 **AGPL-3.0 §13 网络服务条款**（核心在子模块另仓、跑起来即向用户提供网络服务）**与运维体量**（PG+Redis+Kafka+ClickHouse+Debezium）被排除，只有"候选层面借鉴数据模型"这一条路可行。本文档"因协议而排除"的完整名单以本表 medusa 行为准） |
| **refinedev/refine** | `GET /repos/refine-web/refine` → **404 Not Found**；`GET /repos/refinedev/refine` → stars=35931，TypeScript，default_branch=main，pushed=2026-09-10，license=MIT | **是 React 框架**，ops-center/frontend 是 Vue 3 ⇒ 栈不匹配，零可复用代码。**排除**（另注：原 `refine-web/refine` 路径已 404，查新路径才拿到数据） |
| **ant-design/ant-design-pro** | stars=38883，TypeScript，default_branch=master，pushed=2026-10-22，license=MIT | React + Ant Design，栈不匹配 |
| **vbenjs/vue-vben-admin（Vue Vben Admin）** | stars=33656，TypeScript，default_branch=main，pushed=2026-10-22，license=MIT | Vue3 但用 **Ant Design Vue / shadcn**，与 ops-center 的 **Element Plus** 不同 ⇒ 抄任何页面都要重写样式与组件层。比 pure-admin 差一个栈位 |
| **soybeanjs/soybean-admin** | stars=15152，TypeScript，default_branch=main，pushed=2026-10-21，license=MIT | Vue3 但用 **Naive UI**（与 vben 的 Ant Design Vue 同类问题），与 ops-center 的 **Element Plus** 不同 ⇒ 栈不匹配 |

### 4.2 需要额外基础设施 / 运维代价过高 —— 明确排除

| 项目 | 实测证据 | 运维代价与结论 |
|---|---|---|
| **openmeterio/openmeter（作为服务）** | 5598 entries / 3393 个 .go；`openmeter/entitlement/balanceworker/` 事件驱动 worker | 需要独立 Go 服务 + PostgreSQL + 事件通道 + 1 分钟时间分辨率的计量窗口。**单台 ECS 不划算 ⇒ 只借代码不部署** |
| **getlago/lago（作为服务）** | `GET /contents/docker-compose.yml` 实测服务：postgres(partman:15.0-alpine) / redis:7 / api / front / api-worker / api-clock / pdf(gotenberg:7.8.2)；`extra/` 目录含 `clickhouse/`、`kafka-connect/clickhouse-kafka-connect-v1.3.4/`、`kafka-connect/debezium-connector-postgres-3.3.1.Final.jar`、`redis/sentinel.dev.conf` | **运维代价：PostgreSQL + Redis + Kafka + ClickHouse + Debezium + gotenberg，六类组件、内嵌 jar 二进制**。且 AGPL-3.0 网络服务条款 + 核心在子模块另仓。**明确排除部署** |
| **langfuse/langfuse（作为服务）** | `GET /contents/docker-compose.yml` 实测：langfuse-web / langfuse-worker / clickhouse:25.12 / minio / redis:7 / postgres:17 | **运维代价：ClickHouse + PostgreSQL + Redis + MinIO(S3) + worker + web，六个服务**。单台 ECS 跑不动。**明确排除部署，只借 DDL 与看板形态** |
| **opencost/opencost（作为服务）** | README 实测："Quick install on any Kubernetes 1.20+ cluster" + "the standalone Kubernetes manifest files have been removed. Please use Helm"；还需 `PROMETHEUS_SERVER_ENDPOINT` | **运维代价：需要 K8s 集群 + Helm + Prometheus**。mulpub 是单台 ECS 无 K8s ⇒ **作为服务不可行**，只借 `pkg/inferencecost` 模型 |
| **openfga/openfga（作为服务）** | 704 entries；`assets/migrations/{postgres,mysql,sqlite}/` | 运维代价可接受（一个 Go 二进制 + 复用 PG/SQLite），**但当前需求用 Casbin 即可满足 ⇒ 暂不引入** |

### 4.3 同类但方向不对 —— 排除

| 项目 | 实测证据 | 排除理由 |
|---|---|---|
| **Permify/permify** | stars=5967，Go，default_branch=master，pushed=2026-10-23，license=**AGPL-3.0** | 与 OpenFGA 同定位（Zanzibar 式细粒度授权），但 **AGPL-3.0** 且功能重合 ⇒ 选 OpenFGA（Apache-2.0） |
| **open-policy-agent/opa** | stars=12394，Go，default_branch=main，pushed=2026-10-23，license=Apache-2.0 | 通用策略引擎（Rego），**为"积分扣多少""能否降级"写 Rego 收益为负** —— 这类规则要可测、可解释、随业务改。**排除；业务规则留在 Python 代码里** |
| **Helicone/helicone** | stars=6233，TypeScript，default_branch=main，pushed=2026-10-20，license=Apache-2.0 | LLM 观测同类（网关代理型），与 Langfuse 相比对 mulpub 的"成本换算"没有增量；且代理形态与桌面端直连官方 key 的网络形态冲突。**排除** |
| **traceloop/openllmetry** | stars=7500，Python，default_branch=main，pushed=2026-10-19，license=Apache-2.0 | 纯 OTel instrumentation（Python 侧采集），**解决"数据出口"不解决"成本换算"**；仍需后端（OTel Collector + 时序库）⇒ 一样重。**排除；若未来要接 OTel 可再议** |
| **Arize-ai/phoenix** | stars=11957，Python，default_branch=main，pushed=2026-10-23；`GET /repos/Arize-ai/phoenix/license` → 正文首行实测 **"Elastic License 2.0 (ELv2)"** ⇒ spdx 记为 NOASSERTION，**实际是 ELv2：source-available、非 OSI 开源**，限制"不得作为托管/商业化服务对外提供" | 自托管 LLM 观测，同 Langfuse 赛道但对"积分换算"无专门建模；**且 ELv2 的"不得作为托管服务对外提供"对闭源商业产品是硬约束**（若部署后给付费用户用，条款上就踩线）。**排除，协议与赛道双重理由** |
| **open-telemetry/semantic-conventions** | stars=674，Jinja，default_branch=main，pushed=2026-10-22，license=Apache-2.0 | 是**规范/schema**，不是可运行系统（语言标为 Jinja 即模板仓）。**不是候选，只是标准** —— 若将来接 OTel，GenAI 语义约定是字段命名的事实标准，值得作为命名参考 |
| **subforge（prompt 提到的 "Subforge"）** | `GET /search/repositories?q=subforge+in:name` 实测 **total_count = 65**，返回的前 10 个（按 stars 降序，stars 最高仅 104）全部是：`deusjin/subforge`（Rust 字幕 CLI）、`yumiaura/SubForge`（字幕/翻译前端）、`henry1786580051-lang/SubForge`（AI 双语字幕工作台）、`bitxwave/subforge`（singbox 配置转换）、`GobiCowboy/SubForge`（字幕工作台）、`thdlrt/SubForge`（AI 字幕）、`travisdk/SubForge`（单音合成器）、`LosLiSang/subforge`（本地翻译） | **prompt 里的 "Subforge" 在 GitHub 上不指向任何订阅/计费项目**，全部是同名的字幕/代理/合成器项目（stars 最高的也才 104）。**判定：prompt 笔误或指向私有/未公开项目，GitHub 上无可对标对象** |

### 4.4 关于「自建 vs 引入」的明确立场（不骑墙）

1. **授权（Casbin vs OpenFGA vs OPA）：引入 Casbin（pycasbin），不上 OpenFGA，不用 OPA。** 判据是 mulpub 现有 `ACCESS-CONTROL-MATRIX.md` 是**矩阵**不是**关系图**；矩阵直接映射 Casbin 的 `sub,obj,act`，而 `rbac_with_domains` 的 domain 正好承载"项目内资源归属"。引入 Casbin 的成本是**一次 pip install**，不上它的成本是**手写一套等价判定**。
2. **用量计量与积分账户：不引入 OpenMeter 也不引入 Lago，自建，但按 OpenMeter 的语义建模。** 立场依据是两边都要求**额外服务**（OpenMeter 要事件 worker，Lago 要 Kafka+ClickHouse+Debezium），而 mulpub 的用量已经在 `ModelUsageDaily`/`ModelUsageBatch` 落库。**引入服务换来的是一套与业务库并行的真相源，而 mulpub 的当务之急是让现有表能表达"这次消耗平台花了多少钱"。** 这件事**不需要新服务**，需要的是加三列 + 一张 grant 表 + 一张账本表。
3. **成本观测：不引入 Langfuse 也不引入 Helicone/Phoenix。** 理由是观测的价值随 trace 深度走（是否要 trace LLM 内部步骤、eval、prompt 管理）；mulpub 当前的核心诉求是"**别亏本**"，这个诉求用**业务表里的成本列 + vmalert 告警**就能满足，成本远低于部署 ClickHouse+MinIO。**判据：先做可算账，再做可观测。**
4. **支付通道：不引入任何聚合支付系统（沿用上一轮结论），也不引入官方 SDK（实测已停更），自研签名/验签/回调解密这一薄层（约 200 行），Node 侧可选用社区 better-wechatpay 降低 API 调用样板量。** 立场依据是三条实测事实：①官方 org 无 Node/Python SDK；②官方 Java SDK 停更 18 个月、支付宝官方 SDK 停更 3 年 5 个月；③APIv3 签名/验签/AEAD 解密本质是密码学原语调用。**同时必须补上官方 skills 仓给出的查单/退款幂等/对账规则（候选 9），这是"用了 SDK 也不会自动给你"的部分。**
5. **运营后台：不整体替换任何低代码或模板底座。** mulpub 的 ops-center 已经是**有商业化闭环的成品**（40 张表 + 权益矩阵真源 + 事务性发件箱 + 采集风控），换底座的收益为负。**只抄 pure-admin 的目录组织与权限 key 划分（因为它与 Element Plus 同栈）。**
6. **可观测性：引入 VictoriaMetrics 三件套（victoria-metrics + vmagent + vmalert），因为它是单台 ECS 上最省的组合。** 若团队已熟 Prometheus，则 Prometheus + Alertmanager 等价可选，但 VictoriaMetrics 的资源占用更适合当前规模。

---

*本文件所有 `GET /...` 端点与实测值均在 2026-10-23 通过 `api.github.com` 拉取，鉴权使用 `GITHUB_PAT`。未使用的镜像站与 AI 生成营销站一律未引用。*

---

## 交付说明（Delivery Protocol）

### Summary
在「运营后台 / 会员计费 / 积分 / 用量计量」这一维度上，对 13 个开源候选做了 api.github.com 逐项取证（metadata + license 正文 + 默认分支最后提交 + 目录树 + 关键文件内容），落成一份含维度小结表、13 节候选详情、12 项不确定项与 4 类劝退清单的报告。核心结论是：**不引入任何整体替换型后台/电商/低代码平台，也不引入聚合支付系统**；真正可直接引入的只有 `apache/casbin-pycasbin`（授权）与 `VictoriaMetrics`（指标/告警），其余以「数据模型与幂等范式借鉴」方式落地（OpenMeter 的 meter/grant/Price 版本化价格、Lago 的 wallet、LiteLLM 的单价表与预算路由、Kill Bill 的 `charged_through_date`、Saleor 的兑换码三表、微信支付官方的查单/退款幂等规则），并明确记录了「微信支付官方无 Node/Python SDK ⇒ 签名验签必须自建」与「按张/按秒无开源 per-unit 价格模型」两个必须自建的缺口。

### Changed files
- `01-docs/research/mulpub-credit-cost-2026-10-25/tracks/track-ops.md`（本文件，唯一交付物；新建后经两轮迭代补齐）
- 进度看板（沙箱内产物，未入库）（追加 track-ops 进度条目）
- 取证工作区（沙箱内，未入库） 下的临时取证脚本与 JSON 快照（`gh.sh` `meta.sh` `meta2.sh` `*.json`），仅供复查，非交付物

### Notes
- **取证实操纪律已遵守**：全部数字来自 `api.github.com`（`GITHUB_PAT` 鉴权，拉取时间 2026-10-23）；未引用任何 GitHub 镜像站或 AI 生成的营销站；star 数一律来自 `GET /repos/{o}/{r}` 而非记忆；每个候选 ≥2 条独立 API 证据；查不到的项一律写进「不确定项」而非编造。
- **本轮修正的 6 处证据缺口**（上一版被 verifier 指出，已全部补实测证据并改写正文）：① Langfuse `ee/LICENSE` 全文 —— 结论是**自定义商业协议而非 FSL**，核心 MIT 可自建、EE 特性由 `isEeAvailable` 开关门控；② OpenMeter 的 meter 是否支持「按张/按秒」—— 结论是 `ValueProperty` + `GroupBy` 支持四种口径同机制，且 `llmcost` **只覆盖 token 维度**；③ `wechatpay-java` 停更后的同能力活跃替代是 `binarywang/WxJava` 的 `weixin-java-pay`（2026-10-10 活跃、Apache-2.0、独立 artifact），但**栈不匹配故仍只读不引**；④ `frappe/erpnext`(GPL-3.0) 与 `frappe/frappe`(MIT) 的协议与依赖方向已实测，ERPNext 的劝退理由改为**架构体量**而非协议；⑤ `vikingmute/better-wechatpay` 的证据强度已标注为"中"；⑥ `licenses` 与 `default_branch` 的实际值已逐仓核对（`casbin/casbin`→`apache/casbin`、`casbin/pycasbin`→`apache/casbin-pycasbin`、`refine-web/refine`→`refinedev/refine`、`vendure-ecommerce/vendure`→`vendurehq/vendure`、`l4rm4nd/VoucherVault` 默认分支是 `main` 而非 `master`、`opencost` 默认分支是 `develop`、`medusa` 默认分支是 `develop`）。
- **明确记录的两处 API 异常**（便于复查时避开）：`GET /repos/l4rm4nd/VoucherVault/git/trees/master?recursive=1` 返回 404（该仓默认分支实为 `main`），改用 `contents` 端点逐层取证；`GET /repos/refine-web/refine` 返回 404（仓库已迁移）。
- **最重要的三条可执行结论**：① mulpub 的 `officialCreditMonthly`（free=30 / standard=1600）与模型成本**无任何映射**，是亏本的直接成因 —— 落地动作是引入「版本化 `Price` 表（EffectiveFrom/To）+ namespace 倍率覆盖 + `ModelUsageBatch` 落 `price_id`」；② 「余额不足自动切模型」应实现为「候选集过滤 + 策略选择」而非 if-else 链；③ 支付侧必须补官方规则里的**后台查单任务**（每 30 秒扫最近 10 分钟未支付订单、同一订单查 10 次）与**退款原单号重试**，发件箱只保证事件发出、不保证订单状态收敛。
- **复核状态**：本轨道已由独立 Verifier 复核（自行重打 api.github.com，未采信本报告结论）⇒ **结论 PASS**，13 个候选的 metadata / 最后提交 / license 正文 / 目录树计数 / 关键代码引用逐条对上，多处引文逐字一致。随后按 Verifier 指出修正了 5 处描述精度瑕疵（已全部改文案，未改动任何事实结论）：①`vbenjs/vue-vuen-admin` → `vbenjs/vue-vben-admin`；②pure-admin 的 `perms.vue` 实际在 `src/views/permission/button/` 下；③openfga 迁移计数改为 postgres 6 个 / mysql 9 个（8 sql + 1 md）/ sqlite 2 个（原先误把最大编号当条数）；④官方 org 仓数 9 → **10**（补 `wechatpay-global-skills`）；⑤subforge 搜索改为 **total_count=65**、前 10 个全是字幕/翻译/代理/合成器类。另按 Verifier 提示把两处「未取证」升级为已补证：`openmeter/meter/README.md` 实为 **404（文件不存在）**；`llmcost` 计价执行链三路径（`adapter/price.go` 308 行含 `ResolvePrice`、`service/service.go`、`sync/reconciler.go`）已确认存在并写入正文适配点第 9 条。
- **第二轮复核修正（Verifier 独立重打 api.github.com 逐条验证，结论 PASS、零回归）**：①`vbenjs/vue-vuen-admin` → `vbenjs/vue-vben-admin`；②pure-admin 的 `perms.vue` 实际在 `src/views/permission/button/` 下；③openfga 迁移计数由"postgres 007 条 / mysql 008 条"改为实测 **postgres 6 个（001–006，无 007）/ mysql 9 个（001–008 共 8 个 .sql + 1 个 `collation_migrations.md`）/ sqlite 2 个**；④官方 org 仓数 9 → **10**（补 `wechatpay-global-skills`，2026-06-12）；⑤subforge 搜索改为 **total_count=65**、前 10 个全为字幕/翻译/代理/合成器类（stars 最高 104）。同时把两处「未取证」升级为已补证：`openmeter/meter/README.md` 实为 **404（该文件不存在）**；`llmcost` 计价链三路径（`adapter/price.go` 308 行含 `ResolvePrice`、`service/service.go` 约 5 KB、`sync/reconciler.go` 约 7 KB）已确认存在，`ResolvePrice` 的 ent 查询被逐行转写进正文候选 1 适配点第 9 条。
- **第三轮复核修正（3 处 license 漏标 + 1 处记录，已全部按 `/license` 正文改写）**：①`vendurehq/vendure` — `LICENSE.md` 正文实测为**双协议**（"GNU General Public License version 3 (GPLv3) as Vendure Community Edition" / "Vendure Commercial License (VCL)"，且 "The default Vendure license, without a valid Vendure Commercial License agreement, is the Open-Source GPLv3 license."）⇒ spdx 记 NOASSERTION，**实际默认落到 GPLv3**；②`Arize-ai/phoenix` — 正文首行实测 **"Elastic License 2.0 (ELv2)"**（source-available、非 OSI，限制"不得作为托管服务对外提供"，对闭源商业产品是硬约束）；③`Budibase/budibase` — 正文实测 "Each Budibase package has its own license..." / "You can consider Budibase to be **GPLv3 licensed overall**" / "The apps that you build with Budibase **do not package any GPLv3 licensed code, thus do not fall under those restrictions**" ⇒ **逐包授权、整体按 GPLv3 计、自建应用不传染**。三处均**只改文案、未动结论**（三者本就在劝退表、均判不采用），并已把 medusa/vendure 的"协议 vs 体量"对照表述与"因协议而排除"清单统一对齐。
- **第三轮复核（FAIL）修正：文件结构回归 + 一处内部矛盾**。上一轮我用脚本批量改文时触发了一个**静默的结构性写入错误**：`s.find()` 未命中返回 `-1` 却未断言 ⇒ 切片得到**空串** ⇒ `str.replace('', new, 1)` 把新文本插到了**文件第 1 行**（末尾无换行 ⇒ H1 标题被粘连进同一行，文档失去标题），同时 §三 里真正的第 9 项**从未被替换**（触发原因是搜索串用了 `「」` 而文件里是直引号 `"`）。本轮已按三步修好并加断言：①删除第 1 行孤儿行；②在文件最前补回**独立成行**的 H1（现第 1 行 约 1 KB，`grep -c '^# '` = 1）；③用**直引号原文**在 §三 正文位置（line 493）替换第 9 项，"按 vLLM 推理时长分摊成本 / 不是按用户购买的视频秒数计费"这句话现已真正出现在 §三 正文中。**新文本"已由 4c 收敛"全文出现 1 次、旧文本残留 0 次。**
  另修**一处内部矛盾**：同一张劝退表内，medusa 行（第 513 行）列的是 **6 项**"因协议而排除"（含 Phoenix/ELv2），而 ERPNext 行（第 515 行）列的是 **5 项**且用了"唯一"二字 ⇒ 已把 ERPNext 行改为不再重复列举、改为"**本文档『因协议而排除』的完整名单以本表 medusa 行为准**"，并把该行原"候选 2 的 Lago 是 AGPL-3.0、劝退理由也是体量/侵入性而非协议"改写为"**Lago『作为服务』的选项同时因 AGPL-3.0 §13 网络服务条款与运维体量被排除，只有『候选层面借鉴数据模型』这一条路可行**"（与候选 2 风险段"绝对不能把 Lago 作为服务引入"一致）。
  本轮结构回归：14,409 中文字 / 578 行 / H1=1 且在第 1 行 / 二级标题 5 / 候选节 13 / 13 候选七字段全齐 / 18 个目录树计数全在位 / 9 项高风险协议标注全在位 / 不确定项 1–12 + 4b/4c/7b/7c/7d 连续 / 占位符 0。
- **未做也不建议做的事**：没有对 mulpub 现有 `models.py` / `plan-matrix.js` 做代码级 diff（本轨道不拥有该仓），因此"现有表缺哪些字段"是基于 prompt 给出的表名与代码级描述推断，落地前应以实际代码为准。

