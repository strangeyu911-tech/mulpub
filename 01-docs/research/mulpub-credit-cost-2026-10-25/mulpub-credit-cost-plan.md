# mulpub 积分成本方案

> **目标**：让「积分」从展示性数字变成**可计量、可对账、不亏本**的账本。
> **方法**：全部结论来自 mulpub 代码实证（`Colinchui007/mulpub`，2026-10-23 快照），带 `file:line`。
> **立场**：不骑墙。每一处都给出明确取舍与实施顺序。
> **前置阅读**：本方案修正了上一版开源调研报告里"缺价格表"的说法——**价格字段是有的**，
> 真实病灶在别处，见 §2。

---

## 0. 一页速览

### 0.1 病灶一句话

> **成本记录了、额度定义了、扣减逻辑写好了，但三者没有接上线——积分目前是"展示性数字"，不参与任何扣费决策。**

### 0.2 四个断点（全部带代码位置）

| # | 断点 | 证据 | 后果 |
|---|---|---|---|
| **断点 1** | **积分额度从不扣**（次数配额在扣，积分没扣） | `consumeFeature` 定义在 `packages/api-publish-engine/src/auth/postgres-identity-repository.js:378`，DDL 与原子 CAS 扣减（`:298-307`）全部就绪，**调用方在 `publish-api-server.js:587/605`，但只扣 `cloud_publish`（`:639`/`:665`）** | `official_credit_monthly` **从未被扣**（只在 `plan-matrix.js:214` 进入 quota 快照）。次数配额是接线的，**积分额度是纯展示** |
| **断点 2** | **没有换算器** | `apps/desktop/electron/services/model-provider-manager.js:371` 注释原文：「**单价换算属 ModelPriceCard 后续立项**，这里不做本地估算避免伪数据」 | 项目自己知道缺一张价格卡，但**还没立项**。token → 成本 → 积分这条链不存在 |
| **断点 3** | **成本归不到用户** | `ops-center/backend/services/usage_service.py:87` 上报项只带 `client_id`（设备稳定哈希），`model_usage_daily` 表**无 `user_id` 字段** | **按用户扣积分的前提不满足**。一人多设备散成多行，一机多账号混在一行 |
| **断点 4** | **口径与信任边界有洞** | ① `cost` 由桌面端算并上报，服务端 `_nonneg_float` 只校验非负，**不校验 cost 与 tokens 是否自洽**（`usage_service.py:55`）<br>② `OfficialKey.cost_per_1k_tokens` 是**单一混合单价**，不分 input/output/cache/reasoning<br>③ **无价格版本化** ⇒ 改价后历史 `cost` 不可复算 | 数值不可信、精度不足、账目不可审计 |

### 0.3 已有资产（**不要重写**）

| 资产 | 位置 | 状态 |
|---|---|---|
| 权益矩阵唯一真源（三档 + 年付 + PLAN_RANK 降级保护 + 运营 overrides） | `packages/api-publish-engine/src/auth/plan-matrix.js` | ✅ 可用 |
| 权益令牌 RSA-SHA256 签名 + `device_id` 绑定 + 时钟容差 + 72h 宽限 | `apps/desktop/electron/services/identity/entitlement.js`、`packages/api-publish-engine/src/auth/entitlement.js` | ✅ 可用 |
| 额度扣减的原子 CAS（`used = used + EXCLUDED.used WHERE used + EXCLUDED.used <= quota_limit`） | `postgres-identity-repository.js:298-307` | ✅ 可用，**待接线** |
| 成本归集地基（`model_provider_logs` → `usage-reporter` → `model_usage_daily`，batch_id 幂等） | `apps/desktop/electron/services/usage-reporter.js` | ✅ 可用 |
| 用量治理器（准入/归还分离、代次推进、429 冷却、额度窗口） | `apps/desktop/electron/services/api-usage-governor.js`、`token-budget-windows.js` | ✅ 可用，**是本方案的现成依托** |
| 单价与配额字段 | `ops-center/backend/models.py` 的 `OfficialKey.cost_per_1k_tokens` / `alert_threshold_cost` / `rate_per_minute` / `daily_limit` | ⚠️ 需升级为版本化价格卡 |
| 桌面端 `user.sub`（Logto subject）可得 | `apps/desktop/electron/services/identity/auth-service.js:194,232,241,456` | ✅ 可用，**上报链路没带** |

### 0.4 目标与四期路线

| 期 | 目标 | 补的断点 | 能不能单独上线 |
|---|---|---|---|
| **Phase 0** | 对齐计量口径（零成本、零风险） | 断点 4 的一半 | ✅ 纯规范对齐，不改行为 |
| **Phase 1** | 价格卡 + 事件级用量 + user_id 打通 | 断点 2、3、4 | ✅ 影子计算，不影响线上 |
| **Phase 2** | 积分账户 + 不可变账本 + 扣减接线 | 断点 1 | ⚠️ 需灰度开关 |
| **Phase 3** | 防亏本护栏 + 运营看板 | 全部 | ✅ 护栏可独立开 |

---

## 0.5 与 10-08 / 10-11 定案的对照（含我自己的两处订正）

> **这一节是本版的重写理由。** 第一版方案我**只从代码注释反推**口径，没读
> `01-docs/` 里的定案文档，结果**重复发明了已有设计**（`ModelPriceCard` 连表名都一样），
> 同时**漏掉了已论证过的结论**。本版以定案为准重写。
> 参考：`01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md`（含 v1.2 修正版定价表）、
> `01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md`、
> `01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`、
> `01-docs/PRD-REMOVE-BUYOUT-AND-PRICING-2026-10-17.md`。

### ⚠️ 我自己说错的两处（先纠正，因为后面的决策基于它）

| # | 我上一轮说的 | 定案实际 | 影响 |
|---|---|---|---|
| **1** | 「定案是 standard **1000**」 | **1600**。1000 是 v1.0/v1.1 按**旧价 ¥29/¥79** 的推导；**v1.2 已按新价 ¥59/¥499 重算成 1600/2200**（§6.1b 硬约束「年付积分 = 月付 × 12」推出来的） | 用户当时是照着我的错误陈述选的。**「标准版 1000」这个数字需要重新确认**（见 §0.6） |
| **2** | 「不结转 ⇒ 年付占比 38.5%，**超出 35% 目标**」 | **35% 是月付目标**；**年付的约束是 ≤40%**（§6.1b 明写「年付成本 ≤ 40% 是这条约束的代价」），**38.5% 在定案内已校验通过** | 「不结转」在**成本上是安全的**（最大敞口 = 12×M，正好是定案算的数）。代价是失去「结转」带来的**预期**成本优化（定案预估实际消耗占比 20–30% vs 38.5%），即多让利 |

### 完整对照表

| 项 | 定案（10-08 / 10-11） | 我第一版方案 | 本版处置 |
|---|---|---|---|
| 赠送量 standard | **1600**（v1.2） | 引用了 1600，但口头误述为 1000 | **以 1600 为准**；改 1000 需显式拍（§0.6） |
| 赠送量 pro | **2200**（按 ¥79 推导；现价 ¥119 ⇒ 实际占比 18.5%） | 引用 2200 | 保持 2200；**涨价后未按公式重算**，已在 §0.6 登记 |
| 年付赠送 | 月付 × 12（标准 19200 / 专业 26400） | 未提 | 补 |
| 年付发放与结转 | §5.2 建议「按季发放 + 跨季结转」 | 只说"月发" | **用户拍板不结转** ⇒ 保留月发月清，代价已登记 |
| 积分双轨 | 会员额度（日释放 + 月清零）+ 充值积分（永久有效、单价递减三档包） | **只有单轨** | **用户拍板做** ⇒ 本版加批次 FIFO 模型（§3.2） |
| 扣减优先级 | 先扣即将过期 → 再扣本月剩余 → 最后扣充值积分 | 未提 | 补进账本模型 |
| 赠送量放开前置 | **防亏三道闸**（成本账 / fallback / tier_access）全通才放开 | 只写了"护栏" | 补：三闸地基现状已核实（§1.4） |
| 价格卡字段 | §4.1 十三字段（`model_id`/`action_type`/`spec`/`quality_tier`/`proc_discount`/`currency`…） | 只有 9 字段，`unit` 命名自造 | **本版已对齐**（PR #4322 已改） |
| 采购形状 | B 按量付费 / A 有总额度套餐 / C 窗口配额，基准优先级 **B > A**，**C 只作参考不入基准** | 无 | **本版已加** `billed_by` 字段 + `is_pricing_baseline_usable()` 判定 |
| 未知值口径 | 记 UNKNOWN + **fail-closed，不填暂定数字** | 有缺价告警 | 补明确表述 |
| 视频无原料 | **请求侧记账 + 回执兜底**双写 | 假设"从响应拿 token" | **Phase 2**（`generation_requests` 表） |
| 积分 feature | 「`official_credit` **连 features 数组里都没有**」 | 未提 | **Phase 2 前置**（不补则 `consumeFeature` 必 403） |
| 用户只选质量档 | §4.4 tier + 运营可配 fallback 链 | 未提 | Phase 2 |
| 降级同向降扣费 | 定论 | 只提了 multiplier | Phase 2 |
| 消耗判据 | 上游**真返回有效产出** | 只说"结算" | Phase 2 |
| 扣费边界 | **只有「生成」扣积分，「操作」不扣** | 未提 | Phase 2 |
| 宣传口径 | **p75 成本场景 + 20% 安全垫**，保证宣传值 ≤ 实际值 | 未提 | Phase 2 |
| 买断变现口子 | 10-08 §2.3 提到 | 未提 | **已解决**（10-17 `buyout-removal`，`license-manager.js` 已无本地写 pro 的路径） |

## 0.6 三个产品决策（本轮拍板）

| # | 决策 | 结论 | 落点 | 代价 / 影响 |
|---|---|---|---|---|
| **D1** | standard 赠送量 | **1000**（依我上轮陈述）⇒ ⚠️ **需复确认，建议改回 1600** | `plan-matrix.js` 的 `officialCreditMonthly` | 见下方「D1 为什么建议 1600」 |
| **D2** | 年付结转 | **不结转** | 周期末清零（`expire` 分录） | **成本上安全**（年最大 = 12×M = 38.5% ≤ 定案的 40% 上限）。**代价**：失去结转带来的预期成本优化（定案预估 20–30%）⇒ 年付用户平均多让利约 ¥100/年。**年付卖点只能写「锁定当前价格 + 权益不变」，不能写「年付送更多积分」**（同定案） |
| **D3** | 充值积分双轨 | **做** | 积分账户 + 账本加**批次过期**语义（§3.2） | 账本要支持：会员额度批次（按周期过期）＋ 充值批次（**永不过期**）；扣减按 **FIFO by 过期时间**（定案 §5.1 的优先级） |

### D1 为什么建议改回 1600（三个数摆开算）

先纠正我自己的第三个错误方向：**成本占比越低 = 给用户的额度越少 = 运营方毛利越高 = 少让利，不是多让利**。
我上一轮把 1000 说成「比目标多让 ¥6/月」是**反的**。

再纠正一个口径：**定案 v1.2 实际守的不是「月付 35%」，而是「年付成本 ≤ 40%」**——
因为「年付积分 = 月付 × 12」是用户指定的硬约束，1600 是从 `M ≤ 1663` 解出来的
（`0.12M ≤ 499×0.40`），**月付 27.1% 是随之推导出来的结果，不是独立目标**。
§6.1b 里那句「目标 35%」是 v1.0/v1.1 的旧口径。

| 赠送量 M | 月付成本 | 月付占比 | 年付积分 | 年付成本 | 年付占比 | 是否满足定案两条硬约束 |
|---|---|---|---|---|---|---|
| **1000** | ¥10 | **16.9%** | 12000 | ¥120 | **24.0%** | ✅ 满足，但**远低于**目标 ⇒ 白让利 |
| **1600（定案 / 代码现状）** | ¥16 | **27.1%** | 19200 | ¥192 | **38.5%** | ✅ **恰好是定案解** |
| 2065（若要月付真达 35%） | ¥20.65 | 35.0% | 24780 | ¥247.8 | **49.6%** | ❌ **违反「年付 ≤ 40%」** |

⇒ **1600 是三个数里唯一同时满足定案两条硬约束的那个**（月付 27.1% 是推导值，年付 38.5% ≤ 40%）。
⇒ **1000 会让每个年付用户每年少消耗 ¥72 的官方算力**（12000 vs 19200 积分），
按年付用户数直接乘就是年度成本差；而**宣传口径**（10-08 定案：宣传值 ≤ 实际值）此时也要跟着下调。
⇒ **建议保持 1600（= 代码现状，本 PR 不用动这一行）**；若你仍要 1000，改动是
`plan-matrix.js` 一行 + `plan-matrix.test.js` 的数值断言 + 成本占比注释 + 宣传数字，四处要同步。

> **D1 待复确认的唯一原因**：用户是在我**误述「定案是 1000」**之后选的。定案 v1.2 的数是 **1600**，代码现状也是 **1600**。
> 若用户确认 1000 ⇒ 改 `plan-matrix.js` 一行 + 同步 `plan-matrix.test.js` 的数值断言 + 更新成本占比注释；
> 若确认 1600（定案）⇒ **代码不动**，只改我方案文档里的表述。

---

## 1. 现状盘点：钱是怎么流的（以及断在哪）

```
桌面端
  ├─ provider adapter (40+ 供应商 × llm/image/video/tts/stt/music)
  │    └─ 只返回 usage {prompt_tokens, completion_tokens, total_tokens}，不算成本
  │       ⚠️ minimax-llm.js:138  usage: data.usage || {prompt_tokens:0, completion_tokens:0, total_tokens:0}
  │
  ├─ model-provider-manager.js:358-390  _writeLog()
  │    ├─ tokensIn  = usage.prompt_tokens ?? usage.input_tokens
  │    ├─ tokensOut = usage.completion_tokens ?? usage.output_tokens
  │    └─ cost      = result.cost != null ? result.cost : null
  │         ⚠️ 370-371 原文：「官方代理场景透传；BYOK 直连场景留 NULL——
  │              单价换算属 ModelPriceCard 后续立项，这里不做本地估算避免伪数据」
  │
  ├─ model_provider_logs (本地 SQLite/sql.js)
  │    └─ store/model-log-store.js:34-46  INSERT，cost 由调用方传入
  │
  └─ usage-reporter.js（30 分钟周期 + 5s 首报，水印 lastId）
       ├─ 按 (usage_date, provider_id, category, action) 聚合   ⚠️ 无 user_id
       ├─ cost 直接累加日志里的值                                  ⚠️ 客户端算的，服务端不校验
       └─ POST {opsCenter}/api/v1/usage/ingest
              body: { items[], batch_id: `${clientId}:${lastId}:${maxId}`, synced_at }
                          ↑ 幂等键：client_id + batch_id

服务端
  ├─ ops-center/backend/routers/usage.py → services/usage_service.py
  │    ├─ ingest_usage()  _validate_item() 只校验类型与非负     ⚠️ 不校验 cost ↔ tokens 自洽
  │    ├─ 批次去重：ON CONFLICT (client_id, batch_id) DO NOTHING
  │    └─ 桶累加：ON CONFLICT (usage_date, client_id, provider_id, action) DO UPDATE SET x = x + EXCLUDED.x
  │         ⇒ model_usage_daily（成本 = 观测数据，Float 累加）
  │
  └─ api-publish-engine（商业化，服务端唯一真源）
       ├─ plan-matrix.js  档位 → features[] + quota{}
       │    └─ quota.official_credit_monthly = 30 / 1600 / 2200   （free/standard/pro）
       ├─ postgres-identity-repository.js:378  consumeFeature(feature, amount)
       │    ├─ amount 必须是**正整数**  ⇒ 语义是「次数」，不是「金额」
       │    ├─ quotaKey = `${feature}_monthly`，limit 来自 entitlement.quota
       │    └─ consumeEntitlementUsage() 原子 CAS，超额抛 ENTITLEMENT_QUOTA_EXHAUSTED (429)
       │    ⚠️ 调用方只有 publish-api-server.js:639/665，扣的是 cloud_publish（次数）；
       │       official_credit_monthly 从未被扣 —— 这就是断点 1
       └─ member_grant_service.py  admin 手动开通订阅（standard/pro，free 不可开通）
            ⚠️ 这是「开通会员」不是「发积分」，两者语义不同，不要混
```

### 1.1 当前"积分"实际是什么

| 用户以为 | 系统实际 |
|---|---|
| 会员每月发 N 积分，用官方模型按成本扣积分 | 会员每月发 N 积分，**这个 N 只是一个展示数字**；`official_credit_monthly` 从没被扣过（次数配额 `cloud_publish` 倒是在扣） |
| 积分是钱 | 积分是**额度上限的占位符**，`consumeFeature` 的语义是"功能次数" |
| 成本可查 | 成本只对**官方代理场景**有值；BYOK 场景 cost = NULL（设计如此，正确） |
| 用量按用户统计 | 用量按 **client_id（设备哈希）** 统计，**与用户无关** |

**结论：现在这套系统是"次数配额制"（且未接线），不是"积分计费制"。**
上一轮会话里"两档会员 + 积分换算"的方案，在代码里的落地形态是**固定额度 + 未接线的扣减**。

---

## 2. 目标模型

### 2.1 概念定义（先把词说清楚）

| 概念 | 定义 | 单位 | 存放 |
|---|---|---|---|
| **Cost（成本）** | 调用官方模型供应商的真实花费 | **分**（整数） | `model_usage_events.cost_cents` |
| **Credit（积分）** | 对外计费单位，**是成本的分面额** | 整数 | `identity_credit_ledger.amount` |
| **Credit Unit Price（积分单价）** | 1 积分值多少分 | 分/积分 | `credit_price_config.credit_unit_price_cents` |
| **Grant（发放）** | 周期性发给用户的积分 | 整数 | ledger `entry_type='grant'` |
| **Spend（消耗）** | 调用扣掉的积分 | 整数 | ledger `entry_type='spend'` |
| **Balance（余额）** | 可用积分 | 整数 | `identity_credit_accounts.balance` |
| **Quota（次数配额）** | 功能调用次数上限（防刷） | 次 | `identity_entitlement_usage`（**保留现有表，不动**） |

> ⚠️ **关键区分：次数配额 ≠ 积分余额。** 两者必须分表。
> 混在一张表会得到"发了 1600 积分，用户发 1600 篇就超限"这种荒谬语义。
> 现有 `identity_entitlement_usage` 继续管"能发几篇/能生成几条视频"这类**防刷上限**，
> 新的积分账本管"官方算力花了多少"。

### 2.2 换算公式

```
credit_cost = ceil(cost_cents / credit_unit_price_cents)     # 向上取整，不亏本
```

**积分单价怎么定（运营可配，这是"科学换算"的落点）：**

```
目标毛利 g  →  目标成本 = 售价 × (1 - g)
             →  月度发放积分 = 目标成本(分) / credit_unit_price_cents
```

**用你现有的真实数字代入**（standard 档，plan-matrix.js:74 与其注释）：

```
售价        = ¥59/月 = 5900 分
目标毛利率  = 72.9%（注释里的 27.1% 成本占比）
目标成本    = 5900 × 27.1% = 1599 分 ≈ ¥16
credit_unit_price_cents = 1（1 积分 = 1 分 = ¥0.01）
  ⇒ 月度发放 = 1599 / 1 = 1599 积分  →  现有配置 1600 ✓ 完全吻合
```

**这个吻合很重要**，它证明：
1. 现有 `1600` 的推导逻辑本身是自洽的（按 1 分/积分、成本占比 27.1% 反推）；
2. **真正的问题不是"1600 算错了"，而是这个 1600 是"可发额度上限"而不是"按实际消耗扣减"**；
3. 改造后**不需要改 1600 这个数**，只需要把它从"上限"变成"发放量"，并让扣减按实际成本走。

**升级路径**（未来按更细的模型定价时）：
```
credit_unit_price_cents = 1        # 现在：所有模型统一 1 分/积分
  ↓ 若要做差异化定价（贵模型多扣积分）
credit_unit_price_cents = { tier: 1, premium: 2, video: 20 }   # 见 §3.2 的 price card
```

### 2.3 信任边界（这一条决定方案成不成立）

| 数据 | 谁产生 | 谁记账 | 为什么 |
|---|---|---|---|
| `tokens_in/out/cache/reasoning` | 供应商响应（桌面端读） | **服务端** | 供应商账单是唯一真相，客户端 token 数可被篡改但**服务端会用价格卡重算成本**，篡改 token 会直接体现为成本异常 |
| `cost` | ❌ **不再由客户端上报** | **服务端**算 | 项目自己的注释已定调：「不做本地估算避免伪数据」。现状是客户端透传 provider 的 cost，服务端不校验——**这一层要收紧** |
| `credit_cost` | ❌ 客户端不碰 | **服务端**算 | 客户端算积分 = 客户端算钱 = 不可接受 |
| `price_id` | 服务端选 | 服务端 | 版本化价格，保证历史可复算 |

> **过渡期怎么办？** Phase 1 期间桌面端仍会上报 `cost`（改造成本），但服务端**以自己算的为准**，
> 同时保留客户端值做**对拍**：两值偏差 > 5% 时告警。这是发现"客户端 cost 不可信"的最短路径。

---

## 3. 数据模型

### 3.1 新增 4 张表

```sql
-- ① 价格卡：版本化的模型单价。同一 provider+model 可有多条（按 effective_from/to 切分）
CREATE TABLE IF NOT EXISTS model_price_cards (
    id                TEXT PRIMARY KEY,              -- 例：'minimax-M2.7-2026Q4'
    provider_id       TEXT NOT NULL,                 -- 与 ModelPreset.id 对齐
    model             TEXT NOT NULL,                 -- 模型 ID（可空串=该 provider 通用价）
    category          TEXT NOT NULL DEFAULT 'llm',    -- llm/image/video/tts/stt/music
    unit              TEXT NOT NULL,                 -- 'token_in'|'token_out'|'token_cache_read'
                                            | 'token_cache_write'|'token_reasoning'
                                            | 'request'|'second'|'image'|'second_audio'
    unit_price_cents  INTEGER NOT NULL,              -- 单价：分 / unit（按 unit 语义）
    effective_from    TIMESTAMPTZ NOT NULL,
    effective_to      TIMESTAMPTZ,                   -- NULL = 当前生效
    credit_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1,  -- 积分倍率：贵模型可多扣
    source            TEXT NOT NULL DEFAULT 'manual',     -- manual | models_dev | vendor_doc
    note              TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_price_card UNIQUE (provider_id, model, category, unit, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_price_cards_lookup
    ON model_price_cards (provider_id, model, category, unit, effective_from DESC);

-- ② 积分单价配置：全局，运营可配（决定 1 积分值多少钱）
CREATE TABLE IF NOT EXISTS credit_price_config (
    id                        INTEGER PRIMARY KEY DEFAULT 1,
    credit_unit_price_cents  INTEGER NOT NULL DEFAULT 1,   -- 1 积分 = 1 分
    target_margin_pct         NUMERIC(5,2) NOT NULL DEFAULT 72.90,  -- 目标毛利率，仅提示用
    grant_multiplier_default  NUMERIC(6,3) NOT NULL DEFAULT 1,
    effective_from            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note                      TEXT NOT NULL DEFAULT '',
    CONSTRAINT ck_credit_config_singleton CHECK (id = 1)
);

-- ③ 积分账户：余额（可由账本汇总校验，但保留物化列供快速读）
CREATE TABLE IF NOT EXISTS identity_credit_accounts (
    user_id             TEXT PRIMARY KEY REFERENCES identity_users(id) ON DELETE CASCADE,
    balance            INTEGER NOT NULL DEFAULT 0,     -- 可用积分
    granted_total      INTEGER NOT NULL DEFAULT 0,     -- 累计发放
    spent_total        INTEGER NOT NULL DEFAULT 0,     -- 累计消耗
    period_start       TIMESTAMPTZ NOT NULL,
    period_end         TIMESTAMPTZ NOT NULL,           -- 下次发放边界（月初）
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_credit_balance_nonneg CHECK (balance >= 0)
);

-- ④ 积分账本：不可变分录（append-only）。account kinds 借鉴 OpenMeter 的划分
CREATE TABLE IF NOT EXISTS identity_credit_ledger (
    id                BIGSERIAL PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    entry_type        TEXT NOT NULL,   -- 'grant'|'spend'|'refund'|'expire'|'adjust'
    amount            INTEGER NOT NULL,-- grant/spend 为正数，方向由 entry_type 决定
    balance_after     INTEGER NOT NULL,-- 该分录后的余额（对账用）
    reason            TEXT NOT NULL DEFAULT '',
    ref_type          TEXT NOT NULL DEFAULT '',  -- 'usage_event'|'redeem_code'|'subscription'|'admin'
    ref_id            TEXT NOT NULL DEFAULT '',  -- 关联单据 ID
    price_id          TEXT NOT NULL DEFAULT '',  -- 用到的价格卡（可复算）
    cost_cents        INTEGER NOT NULL DEFAULT 0, -- 对应真实成本（分）
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_period
    ON identity_credit_ledger (user_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_ref
    ON identity_credit_ledger (ref_type, ref_id);
-- 幂等：同一笔消耗只能入账一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_spend
    ON identity_credit_ledger (ref_type, ref_id)
    WHERE ref_type = 'usage_event' AND entry_type = 'spend';
```

### 3.2 事件级用量（断点 3 的解法）

现有 `model_usage_daily` 是**日聚合**——粒度太粗，扣积分必须知道"这次调用"。
新增事件级表，`daily` 改为从事件汇总（保留 `daily` 作为看板缓存，不破坏现有查询）。

```sql
CREATE TABLE IF NOT EXISTS model_usage_events (
    id                BIGSERIAL PRIMARY KEY,
    event_id          TEXT NOT NULL UNIQUE,      -- 客户端生成的去重键（见下）
    usage_date        TEXT NOT NULL,              -- YYYY-MM-DD
    user_id           TEXT NOT NULL DEFAULT '',   -- Logto subject（未登录为空）
    client_id         TEXT NOT NULL DEFAULT '',   -- 设备哈希
    provider_id       TEXT NOT NULL,
    category          TEXT NOT NULL DEFAULT 'llm',
    model             TEXT NOT NULL DEFAULT '',
    action            TEXT NOT NULL,
    byok              INTEGER NOT NULL DEFAULT 0, -- 1=用户自带 Key（不扣积分）
    status            TEXT NOT NULL DEFAULT 'success',
    latency_ms        INTEGER NOT NULL DEFAULT 0,
    tokens_in         INTEGER NOT NULL DEFAULT 0,
    tokens_out        INTEGER NOT NULL DEFAULT 0,
    tokens_cache_read INTEGER NOT NULL DEFAULT 0,
    tokens_cache_write INTEGER NOT NULL DEFAULT 0,
    tokens_reasoning  INTEGER NOT NULL DEFAULT 0,
    price_id          TEXT NOT NULL DEFAULT '',
    cost_cents        INTEGER NOT NULL DEFAULT 0,  -- 服务端算
    credit_cost       INTEGER NOT NULL DEFAULT 0,  -- 服务端算
    client_reported_cost_cents INTEGER,           -- 客户端透传值，仅对拍用
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_date
    ON model_usage_events (user_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_usage_events_provider_date
    ON model_usage_events (provider_id, usage_date);
```

**去重键设计**（防重试翻倍，延续现有 `batch_id` 的思路但细化到事件级）：
```
event_id = sha256(user_id | client_id | provider_id | model | action
                   | tokens_in | tokens_out | client_local_seq | started_at_bucket)
```
桌面端为每次调用生成 `client_local_seq`（单调序号，进程内 + 持久化），配合时间桶即可在重试场景下稳定去重。

### 3.3 扣减：两段式（预授权 → 结算）

**为什么不能直接扣**：成本在**响应回来之后**才知道（token 数在 usage 里）。
但"余额不足要拦住"必须在**调用之前**生效。

```
① 预授权（调用前，同步）
   按 provider+model 的最坏情况估算本次最大消耗
   max_credit = ceil(max_tokens × price / credit_unit_price)
   → 从 balance 冻结（frozen += max_credit），不足则 402/429 拒绝
② 结算（响应后，异步）
   实际 credit_cost = ceil(cost_cents / credit_unit_price)
   → balance += (max_credit - credit_cost)   退回差额
   → ledger 写 'spend' 分录（amount = credit_cost）
   → 事件表写 model_usage_events
```

**这个模式不是新发明的**——`api-usage-governor.js` 已经在用同一套「准入与归还分离 + 代次推进」，
`token-budget-windows.js` 是它的额度窗口实现。**沿用既有设计，不引入新范式**，这是本方案风险最低的原因。

**预授权额度从哪来？**
```
max_credit = min(
   provider 的单次上限（新增配置，防超长上下文打爆余额）,
   balance 剩余,
   plan 档位单次上限（pro 可比 free 高）
)
```

### 3.4 `consumeFeature` 的处置

**保留但改名语义**——不动现有表和逻辑（`ai_write_monthly` / `video_create_monthly` / `cloud_publish_monthly` 是**次数配额**），
但把 `official_credit_monthly` **从 quota 里摘出去**：

```js
// plan-matrix.js:210-215 现状
quota: {
  cloud_publish_monthly: cloudPublishMonthly,
  ai_write_monthly: matrix.aiWriteMonthly,
  video_create_monthly: matrix.videoMonthly,
  official_credit_monthly: matrix.officialCreditMonthly,   // ← 摘掉
},
```
改为：
```js
quota: {
  cloud_publish_monthly: cloudPublishMonthly,
  ai_write_monthly: matrix.aiWriteMonthly,
  video_create_monthly: matrix.videoMonthly,
  // official_credit_monthly 不再走 quota —— 积分余额由 identity_credit_accounts 管理
},
credit: {
  monthly: matrix.officialCreditMonthly,    // 月度发放量
  unitPriceCents: 1,                          // 由服务端配置下发，客户端不硬编码
},
```

> ⚠️ **注意 `officialCreditMonthly` 的 UNLIMITED 语义**：它当前在 `UNLIMITED_ALLOWED` 列表里
> （plan-matrix.js:107（NUMERIC_KEYS）、:111-113（UNLIMITED_ALLOWED）），允许 `-1` 表示不限。积分改成余额制后，**`-1` 应改为 `null`**
> 表示"该档不发放积分"，否则 `-1` 进 `balance` 会击穿 `CHECK (balance >= 0)`。
> 这一处必须改，否则 pro 档一旦配成 `-1` 就会写坏账。

---

## 4. 实施计划（4 期，每期可独立上线与回滚）

### Phase 0｜口径对齐（零成本，1~2 人日，纯规范）

**做什么**：不改任何行为，只把字段命名和计量口径对齐到 OTel GenAI 语义约定，
并把已废弃的 `prompt_tokens`/`completion_tokens` 换成推荐口径。

**为什么先做这个**：它是后面所有计算的地基，且**零风险**。

| 动作 | 位置 |
|---|---|
| 采集侧改用 `input_tokens` / `output_tokens`（`prompt_tokens` 已被 OTel 标 deprecated） | `model-provider-manager.js:373-374`（`usage.prompt_tokens ?? usage.input_tokens`）——**兼容读取两个，只在写事件表时用新名** |
| 五类 token 独立采集：`input` / `output` / `cache_read` / `cache_write` / `reasoning` | 新增 `model_usage_events` 五列 |
| 确认"usage counter 才是成本口径，per-operation 直方图不得用于成本计算" | `model_usage_daily.latency_buckets` 是直方图，**不得**参与成本；仅 `latency_ms` 作 SLA 指标 |
| 文档化单位约定：**成本一律用整数分**，不用 Float | `model_usage_daily.cost` 当前是 `Float` → 事件表用 `cost_cents INTEGER`；daily 表保留 Float 但标注为"展示用聚合" |

**产出**：`01-docs/` 下一份《用量计量口径规范》，含字段对照表（现行 → OTel 口径 → 落库列）。

**验证**：跑一次现有上报，确认 `tokens_in/tokens_out` 已有值（若恒为 NULL，说明上游 adapter 没透传 usage，需单独修——这是 Phase 1 的前置）。

---

### Phase 1｜价格卡 + 事件级用量 + user_id 打通（5~10 人日）

**目标**：把成本从"客户端透传"变成"服务端按价格卡算"，并让成本**能归到用户**。

#### 1.1 价格卡录入（运营侧）

```sql
-- 示例：minimax M2.7 文本模型（单位：分 / 1K token）
INSERT INTO model_price_cards
 (id, provider_id, model, category, unit, unit_price_cents, effective_from, source, note)
VALUES
 ('minimax-M2.7-2026Q4','minimax','M2.7','llm','token_in',  20, '2026-10-01','vendor_doc','输入 ¥0.002/1K'),
 ('minimax-M2.7-2026Q4','minimax','M2.7','llm','token_out', 60, '2026-10-01','vendor_doc','输出 ¥0.006/1K');
```
> 提醒：`model_price_cards` 有 `effective_from`，**改价 = 插新行 + 旧行补 `effective_to`**，
> **不要 UPDATE 单价**——否则历史 `cost_cents` 不可复算，账目失去审计能力。

#### 1.2 桌面端改造：上报带 user_id、只报 tokens

**文件**：`apps/desktop/electron/services/usage-reporter.js`

现状（`:118-136`）：
```js
const key = [usageDate, row.provider_id, row.category || 'llm', row.action].join('\u0000')
...
items.push({ usage_date, client_id: this._getClientId(), provider_id, category, action, ... })
```

改为：
```js
// ① 聚合键加 user_id（同一用户多设备不再散成多行）
const key = [usageDate, userId, row.provider_id, row.category || 'llm', row.action].join('\u0000')

// ② 每项带上 user_id 与 byok 标记
items.push({
  usage_date: b.usage_date,
  user_id: b.user_id,                    // 新增：Logto subject，未登录为 ''
  client_id: this._getClientId(),
  provider_id: b.provider_id,
  byok: b.byok ? 1 : 0,                   // 新增：用户自带 Key ⇒ 不扣积分
  model: b.model,                         // 新增：算成本必须要具体模型
  ...
  tokens_in / tokens_out / tokens_cache_read / tokens_cache_write / tokens_reasoning,
  cost: b.cost,                           // 保留但改名 client_reported_cost_cents，仅对拍
})
```

**user_id 从哪来**：`auth-service.js:194` 已有 `user.sub`，
`entitlement-service.js:232` 的 `sync({ subject, accessToken })` 已在传。
**在 reporter 初始化时注入一个 `getUserId()` 即可**，不新开鉴权路径。

**byok 标记从哪来**：provider 配置里有官方 Key 与用户自带 Key 两类（`OfficialKey` 表 vs 用户自填）。
`model-provider-manager.js` 调 adapter 时手里有 provider 配置，**在 `_writeLog` 里一并落库**最省事。

#### 1.3 服务端：ingest 时算成本

**文件**：`ops-center/backend/services/usage_service.py`

现状（`:24-106`）`_validate_item` 只做类型/非负校验，`:135-148` 直接累加。

改为：
```python
async def _price_and_cost(db, provider_id, model, category, tokens) -> tuple[str, int, int]:
    """返回 (price_id, cost_cents, credit_cost)。找不到价格卡 → cost=0 且标记待补。"""
    cards = await _load_effective_cards(db, provider_id, model, category)
    cost_cents = 0
    used_price_ids = []
    for unit, count in tokens.items():
        card = pick(cards, unit)
        if not card:
            continue                      # ⚠️ 缺价 ⇒ 不计成本，但必须告警（见 §7）
        cost_cents += int(count / 1000 * card.unit_price_cents)
        used_price_ids.append(card.id)
    credit_cost = ceil(cost_cents / unit_price_cents)
    return "+".join(used_price_ids), cost_cents, credit_cost
```

**关键约束**：
- **服务端算 cost，客户端的 cost 只做对拍**（偏差 > 5% 告警）
- **缺价格卡时不静默按 0**——按 0 会让成本统计失真。必须：① 落一条 `price_missing` 告警 ② 在看板上显式标红
- `model_usage_daily` 保留现有 upsert 逻辑（看板不受影响），新增 `model_usage_events` 明细写入

#### 1.4 影子期（Phase 1 完成后跑 7~14 天）

**同时算两个口径，不改线上行为**：
```
A. 现状口径：客户端上报的 cost 直接累加到 model_usage_daily.cost
B. 新口径：  服务端按价格卡算 cost，写到 model_usage_events.cost_cents
```
**对账脚本**（每天跑）：
```sql
-- 同一天、同 provider 的两口径差异
SELECT d.usage_date, d.provider_id,
       d.cost                       AS 旧口径_客户端浮点,
       SUM(e.cost_cents)/100.0       AS 新口径_服务端_元,
       COUNT(*)                     AS 事件数
FROM model_usage_daily d
JOIN model_usage_events e ON e.usage_date = d.usage_date AND e.provider_id = d.provider_id
GROUP BY 1,2
HAVING ABS(d.cost - SUM(e.cost_cents)/100.0) > 0.01
ORDER BY ABS(d.cost - SUM(e.cost_cents)/100.0) DESC;
```
**收敛标准**：两口径偏差 < 1% 且所有 provider 都能查到价格卡，才进 Phase 2。

---

### Phase 2｜积分账户 + 账本 + 扣减接线（8~15 人日）

#### 2.1 账本写入（append-only）

```python
# 结算阶段
async def settle_credit(user_id, event_id, cost_cents, credit_cost, price_id):
    async with db.begin():
        # 1) 原子扣余额（乐观锁 + CHECK）
        await db.execute(text("""
            UPDATE identity_credit_accounts
               SET balance = balance - :c, spent_total = spent_total + :c, updated_at = NOW()
             WHERE user_id = :u AND balance >= :c
        """), {"c": credit_cost, "u": user_id})
        # 2) 没扣到 ⇒ 余额不足（并发下另一个请求已扣完）
        if rowcount == 0:
            raise CreditExhausted()
        # 3) 写分录（唯一索引保证幂等）
        await db.execute(text("""
            INSERT INTO identity_credit_ledger
              (user_id, entry_type, amount, balance_after, reason, ref_type, ref_id,
               price_id, cost_cents, period_start, period_end)
            VALUES (:u,'spend',:c,(SELECT balance FROM identity_credit_accounts WHERE user_id=:u),
                    :reason,'usage_event',:eid,:pid,:cost,:ps,:pe)
        """), {...})
```

**幂等**：`uq_credit_ledger_spend` 唯一索引（`ref_type='usage_event' AND entry_type='spend'`）保证
同一事件重试不会重复扣款。

#### 2.2 月度发放（订阅生效时 + 周期续期）

```python
async def grant_monthly_credit(user_id, plan, period_start, period_end):
    amount = PLAN_CREDIT_GRANT[plan]          # 30 / 1600 / 2200
    unit_price = await get_credit_unit_price()
    # 发放量 = 目标成本 / 积分单价（而不是写死）
    target_cost_cents = int(PRICE_CENTS[plan] * (1 - target_margin))
    amount = ceil(target_cost_cents / unit_price)
    # 写 ledger 'grant' + 更新 accounts
```

**发放时机**：`subscription-service.js` 的订阅生效/续期路径上挂一个 hook；
另外用**兜底补偿任务**（每天扫一遍"本月有订阅但没有 grant 分录的用户"），
防止订阅成功但发放失败导致用户白用。

#### 2.3 两段式扣减接线（预授权 → 结算）

**预授权**（调用官方模型前，桌面端）：
```js
// 在 provider 调用入口
const auth = await entitlementService.authorizeCredit({
  providerId, model, category,
  maxTokens: params.max_tokens || DEFAULT_MAX,
})
if (!auth.allowed) throw new CreditExhaustedError(auth)
// ... 调用 provider ...
// 响应回来后
await entitlementService.settleCredit({
  reservationId: auth.reservationId,
  usage: result.usage,
})
```

**服务端**：新增 `POST /api/v1/credit/authorize` 与 `POST /api/v1/credit/settle`。
预授权是**冻结**不是扣除（`frozen` 字段），结算才真正扣。
**未结算的冻结必须有 TTL 回收**（例如 10 分钟），否则异常退出会永久占住额度。

**desktop 的 `entitlement-service.js` 已有 `/api/v1/me` 同步与 72h 宽限机制**，
authorize/settle 复用同一套鉴权与错误码风格，不新开通道。

#### 2.4 扣减失败怎么办（重要：不能因计费失败阻断用户）

| 情况 | 处置 |
|---|---|
| 余额不足 | 拒绝本次调用，返回 402/429 + 明确文案（引导升级档位或等待下月） |
| 结算接口失败 | **不阻断用户**（已成功调用），落 `credit_settle_pending` 队列，指数退避重试；连续失败 > 3 次告警 |
| 服务端价格卡缺失 | 按 0 扣但**告警 + 看板标红**；不允许"按 0 扣且不告警" |
| 账本写入冲突（同事件重试） | 唯一索引拦下，视为已扣，不重复扣 |

---

### Phase 3｜防亏本护栏 + 运营看板（5~8 人日）

#### 3.1 五道护栏

| # | 护栏 | 配置位置 | 作用 |
|---|---|---|---|
| 1 | **单次调用积分上限** | `credit_price_config.max_credit_per_call` | 防一次超长上下文（100 万 token）打爆余额 |
| 2 | **单次预授权上限** | 同上，按 provider 分档 | 防价格卡配错导致巨额冻结 |
| 3 | **免费档发放量按最贵模型上界算** | 发放时计算 | free 档的 30 积分若被用在视频模型上必须亏 ⇒ 发放时按"该档允许的最高单价"反推发放量，或限制单次消耗上限 |
| 4 | **成本告警** | `OfficialKey.alert_threshold_cost`（已有）+ 新增「单用户日 credit_cost 超 p99×3」 | 现有字段已存在，只需接上计算口径 |
| 5 | **价格卡变更审计** | `model_price_cards` 的 `effective_from/to` + 变更日志表 | 改价可追溯，历史账可复算 |

> ⚠️ **护栏 3 是最容易被忽略的亏本点**：free 档 30 积分若允许调用视频模型（贵模型），
> 用户一次就能吃掉你几天的额度。**建议：积分单价统一，但单次消耗设上限**，
> 贵模型要么限制免费档可用性，要么提高其 `credit_multiplier`。

#### 3.2 运营看板要回答的四个问题

1. **这个用户这个月实际花了多少成本？** → `SUM(model_usage_events.cost_cents) WHERE user_id=?`
2. **积分发放出去了多少、实际消耗多少、还剩多少？** → ledger 三个聚合
3. **哪个 provider / 哪个模型最亏？** → `GROUP BY provider_id, model` 对比 cost 与 usage
4. **单用户有没有异常消耗？** → `credit_cost` 的 p99 / 离群检测
5. **发放出去的积分对应多少成本？占收入比例多少？** → 毛利率实时看板

---

## 5. 具体怎么用（操作手册）

### 5.1 运营日常（不需要写代码）

| 场景 | 操作 | SQL / 入口 |
|---|---|---|
| **改积分单价**（如调利润率） | 插一条新的 `credit_price_config` 记录，填 `credit_unit_price_cents` 与 `target_margin_pct` | 运营后台加个表单；或直接 SQL |
| **改某模型单价** | **插入新 price card + 给旧行补 `effective_to`**，绝不 UPDATE | 同上 |
| **调档位发放量** | 改 `plan-matrix.js` 的 `officialCreditMonthly`（**并同步 `UNLIMITED_ALLOWED` 列表的 `-1` 语义**，见 §3.4） | 代码改动，走发版 |
| **看这个月亏了多少** | 毛利率看板 | `SELECT SUM(cost_cents)/100.0, SUM(credit_cost) FROM model_usage_events WHERE usage_date >= date_trunc('month', now())` |
| **查某个用户的账** | 用户详情页 → 积分明细 | `SELECT * FROM identity_credit_ledger WHERE user_id=? ORDER BY created_at DESC` |
| **手工补发积分** | 走 admin 接口，写 `grant` 分录，**不要 UPDATE balance** | 新增 `POST /api/v1/admin/credit/grant`（参照 `member_grant.py` 的 admin 鉴权模式） |
| **兑换码核发积分** | 复用 `redeem_batch_service.py`，核销时写 `grant` 分录 + `ref_type='redeem_code'` | 现有兑换码逻辑加一个 hook |

### 5.2 开发要改的文件（清单）

| # | 文件 | 改什么 | 风险 |
|---|---|---|---|
| 1 | `packages/api-publish-engine/src/auth/plan-matrix.js:210-215` | quota 摘掉 `official_credit_monthly`，新增 `credit` 段；`UNLIMITED_ALLOWED` 里 `-1` 改 `null` 语义 | 中（影响所有权益快照） |
| 2 | `packages/api-publish-engine/src/auth/postgres-identity-repository.js` | 新增 `identity_credit_accounts` / `identity_credit_ledger` 的 repository 方法 + `SCHEMA` 追加建表 | 中 |
| 3 | `packages/api-publish-engine/src/auth/postgres-identity-repository.js:378` | `consumeFeature` **保留不动**；新增 `consumeCredit` / `grantCredit` | 低 |
| 4 | `apps/desktop/electron/services/usage-reporter.js` | 聚合键加 user_id；items 加 `user_id` / `byok` / `model` / 五类 token | 低（多传字段） |
| 5 | `apps/desktop/electron/services/model-provider-manager.js:358-390` | `_writeLog` 落 `byok` 与 `model`；新增 `client_local_seq` | 低 |
| 6 | `ops-center/backend/services/usage_service.py` | `_validate_item` 放宽（接受五类 token）；新增 `_price_and_cost`；写 `model_usage_events` | 中 |
| 7 | `ops-center/backend/models.py` | 新增 4 张表的 ORM 模型 | 低 |
| 8 | `apps/desktop/electron/services/identity/entitlement-service.js` | 新增 `authorizeCredit` / `settleCredit`（复用现有 `/api/v1/me` 鉴权与错误码风格） | 中 |
| 9 | `packages/api-publish-engine/src/auth/subscription-service.js` | 订阅生效/续期挂 `grantMonthlyCredit` hook | 中 |
| 10 | 新增 `ops-center/backend/routers/credit_admin.py` | admin 查账/补发/调价接口 | 低 |
| 11 | 新增 `ops-center/backend/scripts/settle_retry.py` | 结算失败补偿 + 月度发放兜底扫描 | 低 |

### 5.3 灰度与回滚

| 阶段 | 开关 | 回滚方式 |
|---|---|---|
| Phase 1 | `USAGE_EVENTS_ENABLED`（默认 off） | 关掉即停止写事件表，线上零影响 |
| Phase 2 | `CREDIT_ENFORCEMENT`（默认 **off** = 只记不扣） | 切 off → 变成"记账但不拦截"，账继续记，用户不受影响 |
| Phase 2 灰度 | 按 plan 灰度：先 free（风险最低）→ standard → pro | 按 plan 回滚 |
| Phase 2 全量 | `CREDIT_ENFORCEMENT=on` | **保留 `CREDIT_ENFORCEMENT=off` 开关至少一个版本周期** |
| Phase 3 护栏 | 每个护栏独立开关 | 单个关闭不影响其他 |

> **强烈建议**：Phase 2 完成后**至少跑一个完整月度周期**（跨月 + 年付续期 + 兑换码核销 + 退款）
> 再全量。积分是钱，账出错比晚收费贵。

---

## 6. 验证方法：怎么证明"不亏本"

### 6.1 三条对账等式（每天跑，任何一条不平就告警）

```sql
-- 等式 1：账本消耗 = 事件消耗（内部一致）
SELECT
  (SELECT COALESCE(SUM(amount),0) FROM identity_credit_ledger
    WHERE entry_type='spend' AND period_start = $1) AS ledger_spend,
  (SELECT COALESCE(SUM(credit_cost),0) FROM model_usage_events
    WHERE usage_date >= $1 AND byok = 0)                AS event_spend;
-- 要求 ledger_spend = event_spend

-- 等式 2：账户余额 = 账本汇总（账本与物化列一致）
SELECT a.balance,
       COALESCE(SUM(CASE WHEN l.entry_type='grant' THEN l.amount
                         WHEN l.entry_type='spend' THEN -l.amount
                         WHEN l.entry_type='expire' THEN -l.amount
                         ELSE 0 END),0) AS ledger_balance
FROM identity_credit_accounts a
LEFT JOIN identity_credit_ledger l ON l.user_id = a.user_id
WHERE a.user_id = $1
GROUP BY a.balance;
-- 要求 balance = ledger_balance

-- 等式 3：事件成本 ≈ 供应商账单（外部一致，对账周期跑）
-- Σ model_usage_events.cost_cents vs 官方供应商账单金额
-- 允许误差：失败调用不计费（provider 未扣费的部分），需按 provider 规则调整
```

### 6.2 亏本检测（按月）

```sql
-- 毛利率实况：收入 vs 成本
SELECT
  (SELECT SUM(price_cents) FROM subscriptions WHERE status='active') / 100.0 AS 收入_元,
  (SELECT SUM(cost_cents) FROM model_usage_events
    WHERE byok=0 AND usage_date >= date_trunc('month', now())) / 100.0        AS 官方成本_元,
  -- 若 官方成本/收入 > (1 - target_margin_pct) ⇒ 本月亏本
  (SELECT credit_unit_price_cents FROM credit_price_config WHERE id=1)       AS 积分单价_分;
```

### 6.3 客户端上报可信度（对拍）

```sql
-- 客户端上报 cost vs 服务端算 cost，偏差 > 5% 的 provider
SELECT provider_id,
       COUNT(*) AS 事件数,
       AVG(ABS(client_reported_cost_cents - cost_cents) * 1.0
           / NULLIF(cost_cents,0)) AS 平均相对偏差
FROM model_usage_events
WHERE client_reported_cost_cents IS NOT NULL AND cost_cents > 0
GROUP BY provider_id
HAVING 平均相对偏差 > 0.05;
```

### 6.4 单元测试要求（每个护栏一条）

| 测试 | 断言 |
|---|---|
| 预授权不足 | 余额 5 积分、预授权 10 ⇒ 拒绝，余额仍为 5 |
| 结算退回 | 预授权 10、实际 3 ⇒ 余额 = 原值 - 3，冻结释放 7 |
| 幂等 | 同一 `event_id` 结算两次 ⇒ 只扣一次（账本 1 条） |
| 并发 | 20 并发结算、余额 10 ⇒ 恰好扣 10，账本 10 条，余额 0，**无负数** |
| 缺价格卡 | 该 provider 无 price card ⇒ cost=0 **且产生告警**（不允许静默） |
| 发放幂等 | 同一用户同一周期重复发放 ⇒ 只发一次 |
| 退款 | refund 分录使余额回升，且 `spent_total` 不为负 |

---

## 7. 风险与已知边界

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| 1 | **客户端上报的 token 数可被篡改** | 中 | 服务端按价格卡重算成本，篡改会直接体现为成本异常；配合 §6.3 对拍 + 单用户离群检测 |
| 2 | **价格卡不全 ⇒ 成本低估 ⇒ 亏本** | **高** | 缺价必须告警 + 看板标红，**不允许静默按 0**；上线前必须把所有在用 provider 的价格卡录全 |
| 3 | **预授权冻结不释放**（调用崩溃） | 中 | 冻结 TTL（建议 10 分钟）+ 回收任务；回收逻辑必须幂等 |
| 4 | **`officialCreditMonthly = -1` 写坏账** | 中 | §3.4 已明确改 `null` 语义 + DB 层 `CHECK (balance >= 0)` 兜底 |
| 5 | **年付/退款/降档的积分处理未定义** | 中 | 本方案需补：年付按月等额发放（plan-matrix 注释已定此口径）、退款按比例回收、降档时未用积分是否结转——**这三条是产品决策，需你拍板** |
| 6 | **改价导致历史账不可复算** | 低 | price card 版本化 + 禁 UPDATE |
| 7 | **事件表数据量增长快** | 低 | 事件表按月分区 + 90 天后转冷存；`model_usage_daily` 继续做看板缓存 |
| 8 | **双轨期（次数配额 + 积分余额）用户感知混乱** | 中 | 会员中心 UI 必须明确区分"本月还剩 N 次发布"和"还剩 M 积分"；文案不要混用 |

---

## 8. 需要你拍板的三个产品决策

这三件事技术上都可实现，但**定义权在你**，我给出建议和依据：

### 决策 1：未用积分是否结转？

| 选项 | 影响 | 我的建议 |
|---|---|---|
| A. 不结转，月度清零 | 简单；但用户会"月底突击消耗"，你的成本波动大，且体验差 | ❌ |
| B. 结转，永久累积 | 用户会囤积，未来的负债风险 | ⚠️ 有上限更安全 |
| **C. 结转，但设上限（如 3 个月额度）** | 平衡体验与风险 | ✅ **建议这个** |

**依据**：现有 `plan-matrix.js` 注释已定「年付按月等额发放，年付总量因此恒为 12×月付量」——
年付用户每月都会收到额度，如果不清零，**年付用户 12 个月的额度会堆积**，成本敞口随时间线性增长。

### 决策 2：降档时未用积分怎么办？

| 选项 | 我的建议 |
|---|---|
| 立即清零 | ❌ 用户体感差，容易引发投诉 |
| **按比例保留**（例如降档后保留 50%） | ✅ 建议 |
| 保留到周期末 | ⚠️ 折中 |

### 决策 3：免费档能不能用贵模型？

这是**最大的亏本口**。free 档 30 积分，若允许调用视频模型（比文本贵几十倍），
**一次就可能吃掉一整月额度**。

| 选项 | 我的建议 |
|---|---|
| free 档禁用视频/图像模型 | ✅ **强烈建议**（最省事、最安全） |
| 允许但单次消耗上限极低 | ⚠️ 可行但复杂 |
| 允许且不设限 | ❌ 必亏 |

**依据**：free 档 `modelTier: 0`（plan-matrix.js:46）已经是"基础层"的概念，
但 `videoMonthly: 0` 只挡了**次数**，没挡**成本**——只要视频模型的调用走的是别的 feature key，
成本就会漏出去。**这一条建议在 Phase 3 的护栏 3 里一并落地。**

---

## 9. 一页纸总结

```
现状：  成本记了(model_usage_daily.cost)  额度定义了(officialCreditMonthly)
        扣减写好了(consumeFeature)        但三者没接上线 → 积分是展示数字

病灶：  ① consumeFeature 零调用方        (postgres-identity-repository.js:378)
        ② 没有 ModelPriceCard            (model-provider-manager.js:370 注释自认)
        ③ 用量只按 client_id 聚合，无 user_id (usage_service.py:87)
        ④ cost 客户端算/服务端不校验 + 单一混合单价 + 无价格版本化

方案：  Phase 0 口径对齐(1~2d)  →  Phase 1 价格卡+事件级+user_id(5~10d)
        →  Phase 2 积分账户+账本+两段式扣减(8~15d)  →  Phase 3 护栏+看板(5~8d)
        合计 19~35 人日，分 4 期，每期可独立上线与回滚

红线：  ① cost 一律服务端算，客户端只报 tokens
        ② price card 版本化，禁 UPDATE（改价=插新行）
        ③ 次数配额与积分余额分表，不混
        ④ 缺价格卡必须告警，不允许静默按 0
        ⑤ 扣减失败不阻断用户（已成功的调用不能因计费失败被回滚）

待你拍板：① 未用积分是否结转  ② 降档时积分处理  ③ 免费档能否用贵模型
```

---

## 附一：三个产品决策（用户已拍板，2026-10-23）

| 决策 | 结论 | 落点 | 风险提示 |
|---|---|---|---|
| 未用积分是否结转？ | **不结转**（周期末清零） | 发放周期边界（`identity_credit_accounts.period_start/end`）+ 周期末 `expire` 分录 | ⚠️ **年付用户每月发放、12 个月累积 ⇒ 成本敞口随时间线性增长**。必须补监控指标（年付用户积分余额分布） |
| 降档时未用积分怎么办？ | **按比例保留 50%** | 降级路径写 `adjust` 分录（`ref_type='subscription'`） | 需定义"保留"是按余额比例还是按当月发放量比例（建议前者） |
| 免费档能否用贵模型？ | **free 档直接禁用视频/图像模型** | `plan-matrix.js` 的 features 派生层 + 服务端同侧判据 | ⚠️ **这是最大的亏本口**。free 档 30 积分若允许调视频模型（比文本贵几十倍），**一次就吃掉一整月额度**。`videoMonthly: 0` 只挡了次数没挡成本 |

**「不结转」带来的年付敞口（必须盯）**：
年付用户每月都收到 `officialCreditMonthly`（standard 1600 / pro 2200），
不清零 ⇒ 12 个月累积 19200 / 26400 积分 = ¥192 / ¥264 的潜在成本敞口。
按 standard ¥59/月计，年付用户一年最多可消耗 ¥192 的官方算力，
**而年付收入是 ¥499**——毛利仍正（61.5%），但比月付的 72.9% 低。
⇒ 建议配套两条：① 发放量随账户年龄衰减（如第 2 年起 70%）；
② 年付用户**不结转**但设置**年度累计上限**。

## 附二：数字校准（实测复核，修正本方案早期表述）

| 项 | 早期表述 | 实测复核 | 结论 |
|---|---|---|---|
| 断点 1 | "`consumeFeature` 全仓零调用方" | `publish-api-server.js:587/605/639/665` **有调用方**，但只扣 `cloud_publish`（次数配额） | **修正**：次数配额是接线的，**积分额度才从未被扣** |
| 缺价格表 | "缺 ModelPrice 版本化价格表" | `official_keys.cost_per_1k_tokens` **已存在** | **修正**：价格字段有，缺的是**版本化**与**与模型单价解耦**（单一混合价不分 input/output/cache） |
| 迁移编号 | 007 | `007` 已被活跃 change `compute-key-envelope-migration` 预定（其 tasks 3.1 写的仍是已占用的 006，**订正至今未落到文件**） | **本方案占 008** |
| 档位成本占比 | standard 27.1% | standard 27.1% ✓；**pro 的注释写「27.8%」是笔误**（按 ¥22/¥119 实际是 **18.5%**） | 记录在案，不影响换算 |
| 1 积分 = 1 分 | 按 standard 验证 | **两档都自洽**：standard 1600 分 ÷ 1600 积分 = 1；pro 2200 分 ÷ 2200 积分 = 1 | 口径成立，**1600/2200 这两个数本身不用改** |
| 现有表可复用性 | 假设 `model_usage_daily` 需加 user_id | 改唯一键会破坏存量数据与既有看板 | **改为新增事件表 `model_usage_events`**，日聚合表不动 |
| 两套数据库 | 未区分 | **PG**（`migrations/postgresql/`）管 `identity_*` 商业化表；**SQLite**（ops-center，SQLAlchemy `create_all`）管 `model_*` / `official_keys` | 表分布：**积分账户+账本 → PG**；**价格卡+事件表 → SQLite** |

## 附三：Phase 1 的实际落地范围（2026-10-23 已提交，PR #4322）

| 原计划 | 实际落地 | 原因 |
|---|---|---|
| 4 张新表（全在 PG） | **PG 2 张**（`identity_credit_accounts` / `identity_credit_ledger`）+ **SQLite 3 张**（`model_price_cards` / `credit_price_config` / `model_usage_events`） | 两套库的表名不重叠，必须按库分 |
| 桌面端上报带 user_id / byok / model | **本轮未做**，留下一期 | ① byok 判定要深挖官方 Key 与用户自带 Key 的分界；② **没有价格卡时服务端算出的成本全是 0** ⇒ 真正的关键路径是「价格卡 + 服务端算成本」 |
| 扣减接线 | **本轮未做**，留下一期 | 要改 1573 行的 `publish-api-server.js`，且会与在途的 `member-tier-enforce` change 撞同一位置 |
| — | **新增：按价格卡回算历史用量成本**（`credit_cost_backfill_service.py`） | 让本轮**不改桌面端也有价值**：运营配好价格卡即可立刻看到历史成本分布 |

**PR #4322 实测读数**：`node --test` 8/8 + 8/8；`pytest` 9 passed；
`check-unwired-tests` / `check-field-consumed` / `check-debt-budget` /
`check-text-encoding-integrity` / `check-no-brand-residue` / `check-no-conflict-markers` /
`check-doc-abs-paths` **全绿**。
**未完成**：`check-main-red`（需 `gh` CLI，沙箱无 ⇒ 判据自身故障 exit=4）、
**QM-6 CCG 双模型外部评审未执行**（无外部评审通道）、CI 8 项检查当时仍 pending。
