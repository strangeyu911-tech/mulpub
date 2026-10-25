# PRD：官方算力计费体系 —— 安全止血与多供应商混合供给（第一阶段）

> **版本**：v1.0（2026-10-09）
> **状态**：已实现（本 PR）＋ 规划中（第二阶段）
> **作者**：接管 Agent（承接 `01-docs/HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md` 交接与 `01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md` 研究报告）
> **分支**：`official-compute-stopgap`
> **代码基线**：`Colinchiu007/mulpub` @ `8b3d3e91f`（main，2026-10-09）

---

## 1. 背景与问题定义

### 1.1 三份前序文档的结论链

1. **研究报告**（`DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md`）：完成定价测算（v1.2：标准 ¥59/¥499、专业 ¥79/¥699，赠送 30/1600/2200 积分，年付 = 月付 × 12），列出 G1-G12 缺口与 Week-0 三项快赢。
   ⚠️ **该口径已被 2026-10-25 的赠送量重解取代**（唯一真源：`01-docs/usage-metering-spec.md` §4.1）——
   专业档现为 **¥119/月、¥999/年付、赠送 3330**；上表的 **2200 / ¥79 / ¥699 是旧价时代的遗留值**
   （真源原文：「2200 是旧价 ¥79 时代按 27.8% 反解的遗留值，涨价后占比掉到 18.5%、年付 26.4% ⇒ 白送 13.6 个点」）。
   ⇒ 本 PRD 保留 10-08 的**历史结论**，但**实施口径一律以 `usage-metering-spec.md` §4.1 为准**。
2. **定价落地**（PR #3178）：定价矩阵已按 v1.2 写入 `plan-matrix.js` 并附契约测试——**研究报告 §6.4A 的改价工作不再需要**。
3. **交接文档**（`HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md`）：确认「积分扣减引擎不存在、官方算力供给不存在、成本账恒为 0」三大事实；安全审计列出 S1-S7；推荐「方案 A：平台能力优先 + 安全止血」。

### 1.2 本 PR 解决的问题（方案 A 动作 3-6）

| # | 问题 | 严重度 | 现状证据（修复前） |
|---|---|---|---|
| **S1** | 任意字符串可获永久 Pro（本地激活路径） | 🔴 | `license-manager.js` `activate()` 只 `trim()` 即写 `type=pro + expiresAt=null`。IPC 层已在 #3085 对正式包拒收，但开发构建内该路径可达且方法本身无守卫 |
| **S2** | 权益门禁对非 Logto 身份静默放行 | 🔴 | `publish-api-server.js` `_assertEntitlementFeature`/`_consumeEntitlementFeature` 对 `api_key`/匿名返回 `true`/`null`——未来 compute 路由复用即零成本白嫖（评审 R7 判 CRITICAL） |
| **S4** | 成本账恒为 0 | 🟠 | `model-provider-manager.js` `_writeLog()` 不传 `tokens_in/tokens_out/cost/model` → `model_provider_logs` 四列恒 NULL → `usage-reporter` 聚合恒 0 → **无法回答「这个用户/模型花了多少钱」** |
| **S6** | 日志脱敏缺口 | 🟡 | 裸 `token`（无 `access_`/`refresh_` 前缀）、`sid`/`session`/`pwd` 漏网；无手机号正则 |

### 1.3 不做什么（明确出范围）

- **不动定价矩阵**：v1.2 已落地，无存量用户，零成本窗口期已用完。
- **不建积分扣减引擎**：依赖 K5（usage 列共享冲突）、K6（`used` 只增不减）、K7（无任务调度器）三个前置，属第二阶段独立立项。
- **不做服务端代调**：依赖 S3 加密死结拍板（推荐复用 AES-256-GCM 信封体系），用户已补充的关键运营需求（见 §4）将其纳入第二阶段设计输入。
- **不改 `payment-manager` 的本地订单流**：只把授权来源切到服务端格式对齐，订单生命周期不动。

---

## 2. 已实现：四项安全止血（本 PR 代码变更）

### 2.1 S1 — 激活码格式守卫

**变更**：`apps/desktop/electron/services/license-manager.js`

- 新增 `LICENSE_KEY_PATTERN`：`/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/`——与 `packages/api-publish-engine/src/auth/subscription-service.js` 的 `REDEEM_CODE_PATTERN`（4-4-4 段、字母表无易混淆 O/I/0/1）对齐，允许有/无连字符。
- `activate()` 在 trim 之后、写库之前校验格式；不匹配 → `log.warn` + 返回 `false`，**不写任何授权状态**。

**行为矩阵**：

| 输入 | 修复前 | 修复后 |
|---|---|---|
| `"a"` / `"随便什么字符串"` / `"!!!"` | ✅ 永久 Pro | ❌ 拒绝，状态保持 free |
| `"12345"`（12 位以内纯数字） | ✅ 永久 Pro | ❌ 拒绝 |
| `"ABCD-EFGH-JKMN"`（服务端格式） | ✅ | ✅（格式通过≠码有效，真实核销在服务端 `/api/v1/redeem`） |
| `"ABCD-EFGH-JKMN"` 且服务端已核销 | ✅ | ✅ 本地格式通过；**服务端核销状态以服务端为准** |
| 正式包（`app.isPackaged !== false`） | ❌ #3085 已拒 | ❌ 不变（IPC 层守卫仍在） |

**联动**：`payment-manager.js` `completePayment()` 原以 `'PAY-PRO-<uuid>'` 作为 key 调 `activate()`——UUID 不符合格式，现会返回 `false`。改为：订单状态照常流转为 `paid`，授权日志改为「deferred to server-side redemption」，不因激活失败回滚订单。

**边界与残留风险**：客户端校验本质可绕过（改一行代码）。本守卫封的是「手滑/瞎猜即可激活」的暴露面；根治（正式包一律服务端核销）已在 #3085 落地正式包路径，开发构建保留本地路径属调试需要。

### 2.2 S2 — Logto 专属 feature fail-closed

**变更**：`packages/api-publish-engine/src/publish-api-server.js`

- 新增模块常量：

```js
const LOGTO_ONLY_FEATURES = new Set(["cloud_publish"]);
```

- `_assertEntitlementFeature(req, feature)`：
  - `feature` 为空 → 放行（原语义，读接口无 feature 要求）。
  - **非 Logto 身份 + 属集内 feature → 抛 `ENTITLEMENT_IDENTITY_REQUIRED`（HTTP 403）**。
  - 非 Logto 身份 + 非属集 feature → 保持放行（API Key 老用户兼容）。
  - Logto 身份 → 走原有 entitlement provider 校验。
- `_consumeEntitlementFeature(req, feature, amount)`：同向 fail-closed——属集内 feature 对非 Logto 身份抛同款 403；原实现对 `plan/execute` 的调用点返回 `null` 被当成功继续执行，等于免费。

**为何是集合而非全局收紧**：`cloud_publish` 是目前唯一「订阅权益」语义的 feature；API Key 的既有 scope 治理（`_authorizeApiKeyScheduledOwner` 等）是另一条合法路径。全局收紧会打破 legacy api_key 发布链路（集成回归已覆盖：`legacy api_key 发布链路语义未变`）。

**新增 feature 登记纪律**：未来任何消费型 feature（如 `official_credit`、compute 类）必须加入 `LOGTO_ONLY_FEATURES`，否则会继承「非 Logto 静默放行」旧语义。

### 2.3 S4 — 成本观测管道接通

**变更**：`apps/desktop/electron/services/model-provider-manager.js`

`_writeLog()` 增加第 6 参 `context`（成功路径传入 `{ params, result }`），从中提取：

| 字段 | 来源 | 落库行为 |
|---|---|---|
| `model` | `params.model`（请求侧） | 字符串直接落；无则 NULL |
| `tokens_in` | `result.usage.prompt_tokens \|\| result.usage.input_tokens` | 四舍五入取整；无则 NULL |
| `tokens_out` | `result.usage.completion_tokens \|\| result.usage.output_tokens` | 同上 |
| `cost` | `result.cost`（仅当响应自带，官方代理场景） | 数值直落；BYOK 直连场景**留 NULL，不做本地估算** |

**设计决策**：cost 不在客户端按单价表估算。理由：① 桌面端无 `cost_per_1k_tokens` 数据源（单价属运营敏感信息，不下发）；② 伪数据比无数据更危险——对账层会把估算值当真实值。真实成本归集的落地路径是第二阶段的 `ModelPriceCard` + 服务端账单回填（研究报告 §4.1），本次只保证 **usage 原料从今天开始积累**。

**下游受益**：`usage-reporter.js` 的聚合（`tokens_in/tokens_out/cost` 求和）从「恒 0」变为「有数据」；`ops-center` 的 `model_usage_daily` 上报开始携带真实 token 数。

**兼容性**：错误路径的 `_writeLog` 调用不传 context（无响应可解析）；store 无 `addProviderLog` 或抛错时静默跳过（原语义不变，测试覆盖）。

### 2.4 S6 — 日志脱敏补正（双端对齐）

**变更**：`apps/desktop/electron/services/logger.js`（桌面端）+ `packages/api-publish-engine/src/log-redact.js`（引擎侧），两份 SECRET_PATTERNS 同步补：

1. 键值对集合扩展：`token`（裸键）、`sid`、`session`、`pwd` 加入 quoted 与 unquoted 两组正则。
2. 新增中国大陆手机号正则：`/\b(?:1[3-9]\d)\d{8}\b/g` → `***`。

**为什么双端都要改**：桌面端 logger 是终端日志真源；引擎侧 `log-redact` 被 `publish-api-server` 的访问日志/错误日志使用。两端口径历史上就是对齐维护的（桌面端注释明写「对齐 api-publish-engine log-redact」），单改一端会让同一敏感值在一端打码、另一端落盘原文。

**误伤评估**：`token` 裸键在日志中几乎总是凭证语境（`token=xxx`）；`session`/`sid` 同理。手机号正则仅命中 13x-19x 完整 11 位且带词边界，长数字串（如时间戳毫秒值 13 位）不被命中。

---

## 3. 测试与验证

### 3.1 新增/修改的回归测试（TDD：先 RED 后 GREEN）

| 测试文件 | 新增用例 | 覆盖 |
|---|---|---|
| `apps/desktop/tests/license-manager.test.js` | 「activate rejects arbitrary garbage strings」「activate accepts service-issued redemption code format」 | S1 正/负用例；存量用例 key 换为服务端格式（测试意图不变） |
| `apps/desktop/tests/payment-manager.test.js` | 「completePayment uses service-format license key (S1 联动)」 | 订单流转不因激活格式拒绝而失败 |
| `apps/desktop/tests/license-manager-bak.test.js` | key 换为合法格式 | 备份恢复链路不受影响 |
| `apps/desktop/electron/services/model-provider-call-adapter.test.js` | 「S4：adapter 返回 usage 时透传」「S4：无 usage 时保持 NULL」「S4：模型名进入日志」 | S4 三态 |
| `apps/desktop/electron/services/logger.test.js` | 「裸 token/sid/session/pwd 键与手机号不落盘原文」 | S6 桌面端 |
| `packages/api-publish-engine/test/log-redact.test.js` | 「redacts bare token」「redacts sid/session/pwd」「redacts CN mobile」 | S6 引擎侧 |
| `packages/api-publish-engine/test/publish-api-entitlement-guard.test.js`（新建） | 门禁契约 7 断言 + 集成回归 1 断言 | S2 全态（Logto 放行 / api_key 403 / 匿名 403 / 非 Logto feature 兼容 / legacy 链路不变） |

### 3.2 本地验证结果

- 桌面侧相关文件：`license-manager` ×3、`payment-manager`、`license IPC` ×2、`model-provider-call-adapter`、`logger`、`usage-reporter`、`model-provider-manager` 关联文件 **全绿**。
- 引擎侧：`log-redact` 13/13、`publish-api-entitlement-guard` 全过 + 全量 `run-tests.js`（见 PR 执行记录）。
- QM-1 打包验证：因本次改动涉及 `apps/desktop/electron/`，PR 执行记录附 electron-builder 产物验证（见 `openspec/records/official-compute-stopgap.md`）。

---

## 4. 第二阶段规划：运营中心多供应商套餐混合供给（用户补充需求的产品化）

> **需求原话**：「将来产品上线运营的时候，给其他用户使用的官方内置模型，应该在运营中心中设置，我可能会购买多个模型供应商的套餐，然后混合在一起给用户提供。」
>
> 本节将该需求展开为可评审的产品/技术方案骨架，作为第二阶段（官方算力供给链路）的 PRD 输入。**本 PR 不实现本节功能。**

### 4.0 落地形态定案（2026-10-25，运营方已拍板）

> ✅ **本节三个定案已由运营方于 2026-10-25 明确「都按推荐定案」。**
> **详细落地形态见 `01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（本节的唯一展开处）。**

| # | 定案 | 结论 | 对本节的影响 |
|---|---|---|---|
| **D-①** | 官方算力代理放在哪 | **ops-center**（Key 池 / 价格卡 / 用量事件表 / Fernet 解密 / httpx 全在这儿） | §4.3 的「服务端」**明确拆成两个服务**；§4.2 F1/F2 的表**留在 ops-center 的 SQLite**，**不迁 Postgres** |
| **D-②** | 扣分通道 | **ops-center → api-publish-engine 一次 HTTP**（`POST /api/v1/credit/consume`） | §4.3 流程图重画；**不直连 Postgres**、**不建 key-broker** |
| **D-③** | 账户模型缺口 | **立项**（双轨 + `expires_at`），**独立 change** | §4.4 新增第 8 条；**不阻塞** D-①/D-② 接线 |

**⚠️ 本节两处内容随定案失效（属「决策随前提失效」，不是论证被推翻）：**

| 条目 | 原内容（2026-10-11 拍板） | 现状 | 理由 |
|---|---|---|---|
| §4.4-1 | 官方 Key 迁进 AES-256-GCM 信封体系（复用 `cloud-accounts/envelope-crypto.js`，**Node 侧** + KMS），待办「Node 必须能解开 Python 写的密文」 | **随 D-① 失效** | 该待办的前提是「Node 侧要自己解官方 Key」；D-① 下**解密留在 Python 侧** ⇒ 不需要跨语言对拍，**官方 Key 也不需要 KMS**（KMS 是给用户云账号凭证用的） |
| §4.4-3 | `migrations/postgresql/` 现占用 002-005，新表迁移从 006 起 | **订正为**：`006` 已占（`006_payment_orders.sql`）、**`007` 已释放**（原「被 `compute-key-envelope-migration` 预定」只是规格层预留，而该 change 前提已失效 ⇒ 磁盘与规格**都不再占 007**，实测 `migrations/postgresql/` 无 `007_*.sql`）、`008_credit_ledger.sql`/`009_redeem_code_issued_to.sql` 已占 ⇒ **新迁移从 `010` 起** | 编号实测（2026-10-25）；且真实约束是 **FK 建表顺序 = 文件名 `localeCompare` 序**，不是「撞号」 |

### 4.1 角色与核心概念

| 概念 | 定义 | 存储 |
|---|---|---|
| **供应商套餐（Provider Plan）** | 运营方向某供应商采购的一份额度合同：如「可灵 ¥3000 套餐、含 2000 秒 720P」。有总额度、已用量、有效期、单价口径 | ops-center 新表 `provider_plans` |
| **供给池（Supply Pool）** | 同一质量档背后的一组可调度套餐集合，如「影视档池 = 可灵套餐A + 智谱套餐B + 聚合API」 | ops-center 新表 `supply_pools` + `pool_members` |
| **调度策略（Routing Policy）** | 从池中挑套餐的规则：优先级 / 加权轮询 / 成本最低优先 / 剩余额度比例 | `supply_pools.routing_policy` |
| **质量档（Tier）** | 用户侧唯一可见概念（standard / hd / cinema），沿用研究报告 §4.4「用户只选质量档，不选模型」 | 已有设计，沿用 |
| **熔断开关（Kill Switch）** | 运营中心 P0 能力：一键把某套餐/供应商摘出所有池，流量自动落到池内其他成员 | 复用 `OfficialKey.is_active` + 新增池级摘除 |

**与研究报告的衔接**：研究报告 §3.4 的「套餐成本摊销（保底期/接近耗尽/濒危/耗尽四段）」落在 `provider_plans` 的剩余比例字段上；§八 P0-1「模型熔断开关」即本设计的 Kill Switch；§八 P1-8「套餐/聚合 API 切换」即池内成员的 `enabled` 位。

### 4.2 运营中心功能清单（第二阶段 Phase 1）

**F1 套餐管理页**
- 字段：供应商、采购渠道、套餐类型（订阅制/按量，并细分 coding plan / API 套餐 / 会员制——决定能否商用）、总额度（按计量单位：tokens / 张 / 秒 / 次 / 字符）、**已用量（自动累计，与总额度是两个独立字段，禁止混填）**、**计量口径**（额度按什么扣：是否含缓存读/写、缓存读是否打折）、有效期、等效单价（套餐总价 ÷ 总额度，月内固定）、采购折扣系数（研究报告 §3.3 的防亏参数）、**速率限制（并发 / RPM / TPM / 每 N 小时次数）**、状态（active/exhausted/expired/reference_only）。
- **三种计费形状必须分别落库**（2026-10-11 依运营方上游实况补充并定案；形状判别规则与分层设计见 `01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md`）：
  - **A 订阅套餐型（有总额度）**（例：可灵 ¥3000 套餐包 2000 秒）：实付金额（注明含税/未税）、套餐总额度、计量单位、计量口径、有效期起止、已用量、折扣来源（年付/预付/销售议价）、是否续费。
  - **B 按量付费型（中转站）**：账户余额、按模型的单价表（输入/输出 每百万 tokens，或按次/按秒）、**倍率**（中转站常见「官方价 × N」口径）、结算币种与汇率口径（若以 USD 结算）、近 30 天实付与用量（用于**校验报价是否兑现**——中转站标称单价与实际扣费常有出入）。
  - **C 窗口配额型（无总额度承诺）**（2026-10-11 新增；例：MiniMax coding plan，**只有 5 小时与周窗口限制**）：**窗口结构**（窗口长度 + 每窗口限额 + 限额单位）、已过窗口数、实测用量。**该形状没有「总额度」可填**；限额未知时记 `UNKNOWN`（**不得编造**，见设计文档 §7）。
  - **三者等效单价算法不同**：A ＝ 实付金额 ÷ 套餐总额度；B ＝ 周期实付金额 ÷ 周期实际用量；**C ＝ 已付金额 ÷ 实测用量（依赖使用强度的估算，必须带置信度）**。`provider_plans` 需以 `billing_shape` 判别字段同时容纳三种形状，或拆表（见 §4.4-6）。
- **定价基准来源优先级**（2026-10-11 新增，运营方确认）：**B 类 > A 类 > C 类**。C 类只能估算且随使用强度变化（用到窗口上限 10% 与 90% 差 9 倍）⇒ **只作成本参考，不得作定价基准**。另：形状数量**有界为 3 类**，新增形状的唯一理由是「约束性质不同」而非「供应商不同」（判别规则见设计文档 §4.1）。
- **供给资格（eligibility）三判据**（2026-10-11 新增，来自首条样本实测——一份「个人自用 coding plan」被当作候选供给源，三条全不满足，详见 `01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md` §8.3）：只有三条同时成立才能进供给池——① **条款允许商用/供给**（自用、coding plan 通常禁止转售或供第三方）；② **有可观测且够用的速率上限**（大额度 + 紧速率的套餐，瓶颈在速率，买更多额度解决不了）；③ **有效期覆盖运营期**。任一不满足 ⇒ 状态置 `reference_only`，**只能计入成本测算的参考单价，不得进池**；页面须显示逐条判据结果与未通过原因。
- 校验：总额度 > 0；**「总额度」若与导入的用量合计吻合则判可疑并要求复核**（额度与已用量几乎不可能相等；首条样本即把已用量当额度填报，会让单价低估一到几个数量级，见交接口径文档 §2.4-1 与 §8.1）；有效期不可与同供应商同类型套餐完全重叠（防重复计价）；折扣系数 ∈ (0, 1]；**按量型账户余额 ≤ 0 必须在页面上红标**（否则线上会静默失败）；**套餐到期前 7 天告警 + 到期自动摘出全部供给池**（防线上静默失败）。
- **计量口径缺失即不得参与定价比较**（2026-10-11 新增）：实测同一数字在「含缓存读 / 仅输入输出 / 缓存读按 10% 折算」三种口径下的单价可差约 40 倍（样本缓存读占 97.5%，输入 : 缓存读 ≈ 1 : 40.8）。
- 数据校验失败提示逐字段给出（例：「有效期与『可灵 2026Q4 按量套餐』重叠，请先停用旧套餐」）。

**F2 供给池配置页**
- 每个质量档一个池；池成员 = 套餐 × 权重 × 优先级 × 启用位。
- 池规则显示：调度策略（下拉：priority / weighted / cheapest_first / proportional）、耗尽行为（fallback 到聚合 API / 拒绝并提示）、熔断联动（供应商级熔断自动摘除其全部成员）。
- 交互逻辑：拖拽排序即优先级；权重滑杆 1-100；改动即时生效但需二次确认（影响线上调度）。

**F3 熔断与告警**
- 一键摘除：供应商级 / 套餐级两级；摘除后 ≤1s 内全网生效（交接文档 B-Phase2 交付定义⑤）。
- 告警三线：套餐剩余 <20%（研究报告「濒危」段）→ 运营通知；单套餐日消耗异常（偏离 7 日均值 ±3σ）→ 运营通知；池内全部成员不可用 → 自动 fallback 聚合 API + 熔断降级提示用户。

### 4.3 调度与扣费逻辑（桌面端 ↔ 服务端分工）

**（2026-10-25 按 D-①/D-② 重画 —— 原图把「服务端」当成一个整体，与定案不符）**

```
用户在桌面端选质量档 + 规格
  → 桌面端展示「本次预计消耗 N 积分」（按档位等效单价 × 规格，研究报告 §9.2）
  → 桌面端 POST {opsCenterUrl}/api/v1/compute/execute
        body: { userId, tier, spec, prompt, ..., idempotencyKey }
        ⚠️ 幂等键由桌面端生成；同键重复 ⇒ 返回上次结果，不重复扣费、不重复调上游

  ── 以下全部在 ops-center（同一个进程、同一个 SQLite）──
  → ① 选 Key：tier_access 过滤 → priority **ASC** 排序 → 检查 rate_per_minute / daily_limit
        ├─ 无可用 Key ⇒ 熔断降级：切 fallback（聚合 API）或拒绝
        └─ 密文解不开 ⇒ 跳过该 Key + **告警**（不许静默跳过）
  → ② 算预估成本：model_price_cards 取当前生效价
        └─ 缺价格卡 ⇒ **拒绝服务 + 告警**（Phase 1 取舍 6：不许静默按 0）
  → ③ **先落 model_usage_events（status=pending）** ⇒ 拿到 events.id
        ⚠️ 必须在调上游之前落库（events.id 是扣分的幂等键来源）
  → ④ **额度预检（只读）** ⇒ 余额不足 ⇒ **不调上游**（fail-closed 落点）
        ⚠️ **必须在 ⑤ 之前**（本图上一版把它排在 ⑤ 之后 ⇒ 预检拦不住上游调用 ⇒ 变成白送成本）
        ⛔ 当前**没有读余额通道**（`getAccount` 无路由）⇒ 阻断项，见设计文档 §13.2 B-1
  → ⑤ 调上游（httpx + 官方 Key）
  → ⑥ 算实际成本：cost_micros = f(实际 tokens, 生效价)          ← **微元**
        credit_cost = ceil(cost_micros / credit_unit_price_micros × multiplier)   ← **积分（权威）**
        ⛔ 视频/图像/TTS/ASR **算不出成本**（只有 5 类 token 有 unit）⇒ 阻断项，见 §13.2 B-4
  → ⑦ 调 api-publish-engine POST {businessApiUrl}/api/v1/credit/consume（**发货后实扣**）
        body: { authSubject, amount: credit_cost, costCents, priceId, refId: events.id, periodStart, periodEnd }
        ⚠️ `costCents` 由 `cost_micros` ÷10000 向上取整换算而来（设计文档 §3.3.1），**不是 amount 的来源**
        ├─ 成功 ⇒ events.status=charged
        ├─ 余额不足（409）⇒ events.status=pending_charge + 告警（**不丢账**）
        └─ 服务不可用 ⇒ events.status=pending_charge + 告警（**不丢账**）
  → ⑧ 写 generation_requests 台账（研究报告 §4.2），expected vs actual 差异 >15% 进对账报表
```

**⚠️ 与原图的三处差异（都是定案带来的实质变化）**：

| # | 原图 | 现图 | 原因 |
|---|---|---|---|
| 1 | 「服务端接收」= 一个服务 | **拆成 ops-center（供给+算成本+记用量）与 api-publish-engine（扣分）两个服务** | D-① / D-② |
| 2 | 「按摊销口径预扣（reserve）→ 结算（settle）→ 失败退（refund）」 | **发货前扣分（fail-closed）；发货后扣分失败 ⇒ 挂起补扣，不是退款** | 上游已计费 ⇒ 成本真实发生 ⇒ **退款是错的，补扣才对** |
| 3 | 台账写 `generation_requests` | **先落 `model_usage_events`（带 `user_id`）再调上游** | ① `events.id` 是幂等键来源；② 桌面端上报目前**只带 `client_id`、无 `user_id`**（§7.4 必修项） |

**扣费与展示原则**（全部沿用研究报告既有决策，此处汇总为第二阶段约束）：

| 约束 | 来源 |
|---|---|
| 降级必须同向降扣费 + 正向话术「省钱模式」 | 研究报告 §4.4 / §9.4 |
| 失败/超时不扣积分（判据 = 上游是否返回有效产出） | 研究报告 §3.3 |
| 会员额度日释放 + 月清零，充值积分永久有效且后扣 | 研究报告 §5.1 |
| 会员额度耗尽不硬阻断，BYOK 与平台能力保留 | 研究报告 §9.3 |
| reserve/outstanding 双守卫在单事务内（`pg_advisory_xact_lock` 先例） | 交接文档 B-Phase2 ② |

### 4.4 第二阶段前置条件（开工前必须全部满足）

1. ~~S3 加密拍板~~ → **✅ 已拍板（2026-10-11）：走选项 2**。迁移重加密进已有的 AES-256-GCM 信封体系（复用 `cloud-accounts/envelope-crypto.js`，不引新依赖）。**剩余待办**：`OPS_ENCRYPTION_KEY` → 信封主密钥的迁移脚本 + 存量 Key 重加密 + 两端互操作测试（Node 必须能解开 Python 写的密文）。
   - ⚠️ **2026-10-25 订正：本条随 D-① 失效。** 「Node 必须能解开 Python 写的密文」这个待办的**前提**是「Node 侧要自己解官方 Key」；D-①（代理落 ops-center）下**解密留在 Python 侧** ⇒
     - **不需要**跨语言互操作测试；
     - **不需要**把官方 Key 迁到 AES-256-GCM；
     - **不需要**为官方 Key 引入 KMS 依赖（`cloud-accounts/envelope-crypto.js` 的 `requireKms` 是为**用户云账号凭证**设计的，官方 Key 不属该范畴）；
     - 官方 Key **保持 Fernet 不变**（`ops-center/backend/services/key_service.py:15-48`，主密钥 `OPS_ENCRYPTION_KEY`）；
     - ⇒ **官方 Key 的加密形态改动量归零。**
   - ⚠️ 保留的硬前置（与路线无关，**仍然有效**）：`OPS_ENCRYPTION_KEY` 必须**能解出现存至少一条 Fernet 密文**
     （`key_service.py:45-48` 在密钥不合法时会**静默 sha256 派生并改写** `settings.encryption_key` ⇒ 存量密文全部解不开、且无显式报错）。
2. ~~近 30 天上游账单~~ → **🔄 进行中（2026-10-11：运营方确认可导出）**。上游为**多供应商 + 混合计费**（订阅套餐 + 按量付费中转站），数据将全量提供或提供只读接口由接手方自行拉取；交接口径见 `01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`。
3. **迁移编号核对**：`migrations/postgresql/` 现占用 002-005，新表迁移从 006 起必须先查台账锁 checksum（交接文档 K4）。
   - ⚠️ **2026-10-25 实测订正**：占用已变为 `002/003/004/005/006_payment_orders/008_credit_ledger/009_redeem_code_issued_to`
     ⇒ `006` 已占、`008`/`009` 已占；⚠️ **`007` 已被释放**（原「被信封 change 预定」是规格层预留，该 change 前提已失效；实测磁盘无 `007_*.sql`）⇒ **新迁移从 `010` 起**。
   - ⚠️ 且真实约束**不是「撞号」**，而是 **FK 建表顺序 = 文件名 `localeCompare` 序**
     （`postgres-migrations.js:6` 的 `MIGRATION_PATTERN`、`:28` 的 `.sort((l,r)=>l.name.localeCompare(r.name))`、`:102` 按序执行）
     ⇒ 被 FK 引用方的**文件名必须小于**引用方；同前缀不同名**可共存**（台账锁的是全文件名 + checksum）。
   - ⚠️ **另一条更隐蔽的约束**：`MIGRATION_PATTERN` 只认**3 位数字**（`/^\d{3}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/`）
     ⇒ 4 位号 / 2 位号 / 非法名会被 `filter` **静默丢弃**（fail-open），`allowPending:false` **也发现不了**
     ⇒ 落任何迁移前**逐个核对文件名能被该正则认领**（本仓**零门禁**检查目录里 .sql 是否全被认领 ⇒ 只能人工核）。
   - ⚠️ **加文件与执行必须同批部署**（`postgres-identity-repository.js` 的 `assertReady`（**在 `:215`，`allowPending:false` 在 `:232`**）
     ⇒ 「文件已入库未执行」会让 identity 仓储**启动期硬失败**，表现为会员中心整体降级）。
4. **任务宿主**：全仓无 cron/APScheduler；套餐用量日聚合、对账、超时回收都需要先解决任务宿主（交接文档 K7）。
5. **退款路径**：`identity_entitlement_usage.used` 只增不减（K6），预扣-结算-退款模型必须先建出减回通道且不撞 `CHECK (used >= 0)`。
6. **计费口径归一化**（2026-10-11 新增，因上游为混合计费；**同日晚增补第三类形状，故本条已由第 7 条扩展**）：订阅套餐是「总额度 + 有效期」，按量中转站是「余额 + 单价表（常含倍率）」，窗口配额型是「窗口结构 + 每窗口限额」——`provider_plans` 必须同时容纳**三种**形状，或按形状拆表（如「套餐台账」+「按量价目表」）；等效单价算法也各不相同（A＝实付 ÷ 总额度；B＝周期实付 ÷ 周期实际用量；C＝已付 ÷ 实测用量，估算）。**这一条在做表结构设计前必须先定**否则迁移返工。
7. **三种形状与未知值表达方式必须定案**（2026-10-11 补，含运营方当晚答复）：`provider_plans` 须容纳**三种**计费形状（A 有总额度套餐 / B 按量付费 / **C 窗口配额型**——MiniMax 这类只有 5 小时与周窗口限制、**不承诺总额度**）；同时须先定「未知值」的落库表达（`UNKNOWN` / `source=ASSUMED`），否则未查明的速率与计量口径会被当已知值参与定价。分层设计与判别规则见 `01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md`（三层分离；**形状数量有界为 3 类**，新增形状的唯一理由是「约束性质不同」而非「供应商不同」；**用户侧永远只有单一积分模型**）。

8. **账户模型缺口立项**（2026-10-25 新增，**D-③**）：`identity_credit_accounts` 是**单周期**账户
   （`migrations/postgresql/008_credit_ledger.sql:28-38`：`user_id` 是**主键**、`balance` / `granted_total` / `spent_total` /
   `period_start` / `period_end` / `updated_at`）⇒ **装不下**定案要求的**双轨**（会员额度日释放+月清零 / 充值积分永久有效），
   且**无 `expires_at` 字段** ⇒ **「FIFO 按过期时间扣减」目前无字段支撑**。
   - **处置**：**独立 change + 独立评审**（改 `user_id` 主键 = **破坏性 schema 变更**）。
   - **不阻塞** D-①/D-② 的接线（当前单周期模型能跑通），但**阻塞**双轨能力上线。
   - 接线阶段跑通后需做一次**账目迁移**（单周期余额 → 双轨余额），配合 Phase 1 已有的 `reconcileAccount(userId)` 对账能力。
   - 详见 `01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §4。

9. **服务间鉴权未定**（2026-10-25 新增，**U-1**）：ops-center → api-publish-engine 的扣分调用**用哪套凭据**尚未定。
   - ⚠️ **不得**用桌面端的 `X-Catalog-Key`（那是 ops-center 自己的目录密钥，口径不同）；**不得**把用户 Bearer 透传给服务间调用。
   - 若需在 api-publish-engine 新增**独立于用户 Bearer 的服务凭据校验** ⇒ 属「**谁来守门**」级别的改动 ⇒ **须人工过目，agent 不得自行改**。

### 4.5 用户可见行为（第二阶段 UI 契约，供后续设计评审）

- 会员中心「我的算力」卡：剩余积分、本月剩余天数、「约可生成」四行换算（研究报告 §9.1 的版式与浮动说明）。
- 生成前确认弹窗：质量档下拉（standard/hd/cinema，pro 档位对 standard 用户禁用并显示升级引导）、「背后模型：运营方配置中（不展示具体模型名）」、本次消耗、剩余额度、自动切换勾选框（研究报告 §9.2）。
- 三段式预警：80% 站内提示 / 50% 弹窗+加购 / 10% 强提示+加购+BYOK 入口；耗尽不阻断平台能力。
- 全部新增用户可见文案进 `apps/desktop/src/locales/zh.js` 与 `en.js` 成对（CI Gate 7 强制）。

**2026-10-25 按 D-①/D-② 补充（详细版见 `01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §8）：**

| # | 补充项 | 规则 |
|---|---|---|
| 1 | **扣分未成功时不得显示「已扣除」** | 扣分失败 ⇒ 事件状态 `pending_charge` ⇒ 界面显示「**积分结算中**」，**不谎报已扣** |
| 2 | **失败文案必须明示「本次未扣除积分」** | 例：`生成失败：{reason}。本次未扣除积分。` ⇒ 降低客诉成本 |
| 3 | **降级一律正向表述** | 用「**省钱模式**」/「备用通道」，**不用**「降级」「降质」等负面词 |
| 4 | **「约可生成」必须带浮动说明** | 不得承诺精确值（Phase 1 口径：宣传值 ≤ 实际值，按 p75 成本场景 + 20% 安全垫算） |
| 5 | 运营后台「官方 Key 列表」须有「**能否解密**」健康列 | 解密失败 ⇒ **红标 + 告警**，不静默跳过 |
| 6 | 运营后台成本台账须有「**缺价**」标记列 | 缺价事件必须**显式列出**（不许静默按 0，Phase 1 取舍 6） |
| 7 | 运营后台须有「**挂起队列**」 | 列出 `pending_charge` 事件，可人工补扣 |

---

## 5. 交付定义对照（本 PR 完成度）

| 交接文档验收项 | 状态 |
|---|---|
| 方案 A-①：站内无无法兑现的积分承诺 | ✅（定价页文案已在 #3178 校正为「体验额度」口径；本 PR 不新增承诺） |
| 方案 A-③：S1 已修并有回归测试 | ✅（格式守卫 + 7 个正/负用例） |
| 方案 A-④：S2 已修并有回归测试 | ✅（fail-closed + 门禁契约测试） |
| 方案 A-⑤：S4 已修并有回归测试 | ✅（管道接通 + 3 用例；cost 真值依赖第二阶段单价卡，已明示） |
| 方案 A-⑥：S6 已修并有回归测试 | ✅（双端对齐 + 用例） |
| 用户补充需求（多供应商混合供给） | 📋 已产品化为 §4 设计骨架，列入第二阶段 |

## 6. 风险与开放问题

| # | 风险/问题 | 处置 |
|---|---|---|
| 1 | S1 客户端守卫可被绕过（本质限制） | 已在文档明示；正式包路径由 #3085 服务端核销承担 |
| 2 | S4 的 cost 列短期内仍为 NULL（BYOK 场景无单价源） | 接受；token 数先行积累，避免伪数据；第二阶段 ModelPriceCard 接管 |
| 3 | S2 的 `LOGTO_ONLY_FEATURES` 靠人工登记 | 已写入本 PRD §2.2 纪律；建议第二阶段给 plan-matrix 新 feature 加 CI 提醒 |
| 4 | 多供应商套餐的「套餐并发上限」（研究报告 §7.4 重度包限速）依赖速率治理 | 第二阶段设计时与 `rate-limiter`/`api-usage-governor` 统一口径，避免第二套限速 |
| 5 | 本 PR 未建 OpenSpec change | 按「S 复杂度且低风险直接质量节拍」口径执行（四项独立小修复，无跨模块数据变更）；第二阶段 M+ 复杂度必须走 `/opsx:propose` |
