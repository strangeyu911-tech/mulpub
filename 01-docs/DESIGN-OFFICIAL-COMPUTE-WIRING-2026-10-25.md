# DESIGN：官方算力扣减接线 —— 落地形态定案（2026-10-25）

> **文档性质**：落地形态定案（DESIGN）。**不是提案，是已拍板的结论。**
> **决策人**：运营方（2026-10-25 明确「都按推荐定案」）。
> **上游文档**：`01-docs/PRD-OFFICIAL-COMPUTE-STOPGAP-2026-10-09.md` §4（第二阶段规划）、
> `01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md`（计费模型分层）、
> `01-docs/usage-metering-spec.md`（计量口径规范，**口径真源**）、
> `openspec/changes/official-keys-postgres-migration/design.md` **D19**（前提订正）。
> **状态**：定案 ✅ ｜ **代码实现**：未开始（见 §10 分期）

---

## 0. 结论（TL;DR）

### 三个定案

| # | 定案 | 一句话 |
|---|---|---|
| **D-①** | **官方算力代理落在 ops-center** | Key 池 / 价格卡 / 用量事件表 / Fernet 解密 / httpx 客户端**全在 ops-center** ⇒ 供给侧**零迁表** |
| **D-②** | **扣分通道 = ops-center → api-publish-engine 一次 HTTP** | ops-center 算完成本后调 `POST /api/v1/credit/consume` 扣分；**不直连 Postgres**、**不建 key-broker** |
| **D-③** | **账户模型缺口立项**（双轨 + `expires_at`） | `identity_credit_accounts` 是**单周期**账户，装不下定案要求的双轨 ⇒ 加列/加表（**独立 change**） |

### 一句话形态

```
桌面端 ──► ops-center 官方算力端点 ──┬─ 选 Key（official_keys）
                                      ├─ 调上游（httpx）
                                      ├─ 算成本（model_price_cards → cost_cents）
                                      ├─ 算积分（ceil(cost_cents / 单价 × 倍率)）
                                      ├─ 记用量（model_usage_events，带 user_id）
                                      └─► api-publish-engine POST /api/v1/credit/consume
                                              └─ identity_credit_accounts + identity_credit_ledger
```

### 明确不再做的事

| 不做 | 原因 |
|---|---|
| 把 `official_keys` 迁到 Postgres | D-① 下供给侧**不需要**跨库；迁移会制造跨库读点、引入双写/切读/回滚复杂度 |
| 建 `official_key_envelopes` 表 | 那是「代理放 api-publish-engine」路线的专属产物；D-① 下不需要 |
| 官方 Key 迁到 AES-256-GCM + KMS | 解密留在 Python 侧即可；**不为官方 Key 引入 KMS 依赖**（KMS 是给用户云账号凭证用的） |
| Node ↔ Python 密文互通对拍 | 同上 ⇒ **F3 死结自动消失** |
| 改 `model_usage_daily`（日聚合表） | Phase 1 取舍 8 已定：日聚合表不动，用户级归属由 `model_usage_events` 承载 |

---

## 1. 为什么从「搬家」改到「接线」

### 1.1 证据链

2026-10-23 合入的 **Phase 1**（`openspec/records/credit-cost-accounting-phase1.md`）已经把算力计费域铺成**两个进程两个库**：

| 资产 | 进程 | 库 | 来源 |
|---|---|---|---|
| `official_keys` | ops-center | SQLite | 既有 |
| `model_price_cards` / `credit_price_config` | ops-center | SQLite | **Phase 1 新建** |
| `model_usage_events`（`cost_cents` / `credit_cost`，**带 `user_id`**） | ops-center | SQLite | **Phase 1 新建** |
| `model_usage_daily`（日聚合，**无 `user_id`**） | ops-center | SQLite | 既有（Phase 1 取舍 8：**不动**） |
| `identity_credit_accounts` / `identity_credit_ledger` | api-publish-engine | Postgres | **Phase 1 新建** |

Phase 1 两条取舍原文：

> **取舍 8** · 日聚合表 `model_usage_daily` 不动，新增事件表承载 user_id 粒度｜改既有表唯一键会破坏存量数据与既有看板；**事件表为下一期扣减接线预留**
> **取舍 9** · 账本与账户都**物理新增**，**不接 `consumeFeature`**｜`consumeFeature` 的 amount 语义是**次数**（正整数）；积分是**金额**，两者语义不同，**接线留给下一期**

**⇒ 「下一期扣减接线」就是本条线，而 Phase 1 已把它的形态框定了。**

### 1.2 第二个关键事实：ops-center 早就在代调上游模型

`ops-center/backend/services/prompt_eval_generation_service.py:140-159`：

```python
client = http or httpx.AsyncClient(timeout=120)
url = f"{base_url}/images/generations"          # 或 minimax 的 /image_generation
headers = {"Authorization": f"Bearer {api_key}"}
resp = await client.post(url, json=payload, headers=headers)
```

⇒ ops-center 现成具备：**异步 HTTP 客户端**、**Key 解密（Fernet）**、**价格卡**、**成本核算**、**用量事件表（`user_id` 粒度）**。
⇒ **「官方算力代理放 ops-center」的地基是现成的，不需要新造任何基础设施。**

### 1.3 第三个事实：桌面端上报还缺 `user_id`

`apps/desktop/electron/services/usage-reporter.js`：

- 用量 POST 到 **ops-center** `POST /api/v1/usage/ingest`（`X-Catalog-Key` 鉴权，`:183`）
- 载荷**只有 `client_id`**（`:136`、`:160`），**无 `user_id`**
- `tokens_in` / `tokens_out` / `cost` **恒为 0**（`:109`、`:171`）

⇒ 这正是 Phase 1 点名的缺陷（「`model_usage_daily` 只按 `client_id` 聚合、**无 `user_id`** ⇒ 成本无法归到用户」）的**上游成因**。
⇒ **官方算力链路上线必须同时修这一条**（§7.4）。

---

## 2. 定案一：官方算力代理落在 ops-center

### 2.1 职责边界

| 归 ops-center | 归 api-publish-engine | 归桌面端 |
|---|---|---|
| 官方 Key 池 CRUD 与选 Key | 积分账户 / 账本 | 质量档选择、预计消耗展示 |
| 上游调用（httpx） | 扣分（`consumeCredit`） | 发起生成请求 |
| 成本核算（`model_price_cards`） | 权益快照 / 订单 | 用量上报（**须补 `user_id`**） |
| 用量事件落库（`model_usage_events`） | 迁移台账 | 失败/降级提示 |
| 熔断与 fallback 判定 | — | — |

### 2.2 为什么是 ops-center（4 条理由）

1. **供给侧资产全在这儿**（Key + 价格卡 + 事件表）⇒ 供给侧**零跨库读点**、**零双写**、**零切读期**。
2. **解密留在 Python** ⇒ 官方 Key 保持 Fernet，**不需要跨语言对拍**，**不需要 KMS**。
3. **原子性天然**：选 Key → 调上游 → 算成本 → 记用量，**同一进程同一事务边界内**完成。
4. **ops-center 已有代调上游的先例**（§1.2）⇒ 不是新建能力，是**沿用既有模式**。

### 2.3 被推翻的旧决定（及推翻理由）

| 旧决定 | 出处 | 现状 |
|---|---|---|
| `official_keys` 迁 Postgres | `official-keys-postgres-migration` D13 | **撤销**（前提被 Phase 1 推翻） |
| 建 `official_key_envelopes` 表 | `compute-key-envelope-migration` 第 3 组 | **前提失效**（其存在理由是「Node 侧要自己解官方 Key」） |
| 官方 Key 重加密进 AES-256-GCM + KMS | `PRD-OFFICIAL-COMPUTE-STOPGAP` §4.4-1（2026-10-11 拍板） | **随前提失效**（同上） |

> ⚠️ **「决策失效」≠「决策被推翻」**：§4.4-1 在 2026-10-11 是**正确**的（当时默认代理放 api-publish-engine）。
> 它随前提一起失效，不是因为论证有错。**引用它时必须带上这个前提条件。**

---

## 3. 定案二：扣分通道 = ops-center → api-publish-engine 一次 HTTP

### 3.1 为什么不直连 Postgres

ops-center 直连 Postgres 会引入：第二个数据库连接池、第二个凭据面、跨库一致性边界、
以及**绕过 `identity_credit_accounts` 的 `CHECK` 约束与原子 CAS 扣减语义**。
⇒ **扣减必须走仓储层**（`consumeCredit` 已在 `postgres-identity-repository.js` / `credit-repository.js` 实现，
含事务、`balance >= amount` 的 CAS、CHECK 兜底）。

### 3.2 为什么不建 key-broker

key-broker 会把「同一事务内扣减」永久降级为最终一致；本场景**不需要**broker 能力（只有 ops-center 一个调用方）。

### 3.3 通道契约

**方向**：ops-center → api-publish-engine（**单向**；桌面端不直接调扣分接口）

**端点**：`POST {businessApiUrl}/api/v1/credit/consume`

**鉴权**：
- 复用 api-publish-engine 既有服务间鉴权（**待定：见 §11 未决项 U-1**）
- ⚠️ **不得**用桌面端的 `X-Catalog-Key`（那是 ops-center 自己的目录密钥，口径不同）
- ⚠️ **不得**把用户 Bearer 透传给服务间调用（ops-center 不是那个身份）

**请求体**（字段名对齐 `credit-repository.js` 的 `consumeCredit`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `userId` | string | ✅ | 桌面端用户标识（Logto `sub`） |
| `amount` | integer | ✅ | 扣减积分（**正整数**；`amount <= 0` ⇒ `CREDIT_AMOUNT_INVALID`） |
| `costCents` | integer | ✅ | 上游真实成本（**分**；非负整数） |
| `priceId` | string | — | 价目卡 id（版本化价格，禁 UPDATE） |
| `reason` | string | — | 人类可读原因（进账本 `reason` 列） |
| `refType` | string | — | 默认 `usage_event` |
| `refId` | string | ✅ | **幂等键**：对应 `model_usage_events.id` |
| `periodStart` / `periodEnd` | ISO8601 | ✅ | 发放周期边界 |

**响应体**：

| 字段 | 说明 |
|---|---|
| `account` | 扣后账户快照（`balance` / `granted_total` / `spent_total` / `period_start` / `period_end`） |
| `entry` | 账本分录（`id` / `amount` / `balance_after`） |
| `duplicated` | `true` ⇒ 该 `refId` 已扣过，**本次未重复扣**（幂等命中） |

**错误码**：

| 码 | HTTP | 含义 | ops-center 的处置 |
|---|---|---|---|
| `CREDIT_BALANCE_EXHAUSTED` | 402 | 余额不足 | **不发货**，回传用户「积分不足」 |
| `CREDIT_AMOUNT_INVALID` | 400 | `amount` 非正整数 | **不发货**，告警（属内部契约错误） |
| `CREDIT_PERIOD_INVALID` | 400 | 周期边界不合法 | **不发货**，告警 |
| `CREDIT_SERVICE_UNAVAILABLE` | 503 | 扣分服务不可用 | **不发货**（fail-closed，见 §3.4） |
| 未知 | 5xx | — | **不发货**，重试上限内重试；超限 ⇒ 挂起 + 告警 |

### 3.4 失败语义（fail-closed）

> **宁可少赚，不可白送算力。**

| 时点 | 扣分失败 | 处置 |
|---|---|---|
| **发货前** | 余额不足 / 服务不可用 | **不调上游**，不消耗成本，不产生用量事件 ⇒ 用户看到明确提示 |
| **发货中**（上游已调用、产出未回） | 扣分服务挂 | 重试 ≤ 3 次（指数退避）⇒ 仍失败 ⇒ **挂起该用量事件**（状态 `pending_charge`）+ 告警，**不丢账** |
| **发货后**（已产出） | 扣分服务挂 | 同上 ⇒ 挂起 + 告警；**不向用户收钱但记账**（成本已真实发生）⇒ 人工/定时对账补扣 |

⚠️ **「已产出但扣分失败」不允许自动退款**：成本已真实发生（上游已计费）⇒
正确处置是**补扣**而非**退款** ⇒ 这要求用量事件有 `pending_charge` 状态与对账入口（§7.5）。

### 3.5 幂等

- 幂等键 = `(ref_type, ref_id, entry_type='spend')`（`credit-repository.js:145-155` 的既有实现）
- `ref_id` = `model_usage_events.id`（ops-center 侧生成）
- ⇒ **重试安全**：同一用量事件重复扣分只会成功一次，第二次返回 `duplicated: true`
- ⚠️ **前置**：ops-center 侧 `model_usage_events.id` 必须在**调上游之前**就生成并落库
  （否则上游已计费但事件未落 ⇒ 重试会生成新 id ⇒ 重复扣分）

---

## 4. 定案三：账户模型缺口立项

### 4.1 现状（实测）

`migrations/postgresql/008_credit_ledger.sql:28-38`：

```sql
CREATE TABLE IF NOT EXISTS identity_credit_accounts (
    user_id        TEXT PRIMARY KEY REFERENCES identity_users(id) ON DELETE CASCADE,
    balance        INTEGER NOT NULL DEFAULT 0,
    granted_total  INTEGER NOT NULL DEFAULT 0,
    spent_total    INTEGER NOT NULL DEFAULT 0,
    period_start   TIMESTAMPTZ NOT NULL,
    period_end     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_identity_credit_balance_nonneg CHECK (balance >= 0),
    ...
);
```

### 4.2 缺口清单

| # | 定案要求 | 现状 | 判定 |
|---|---|---|---|
| G-1 | **双轨**：会员额度（日释放 + 月清零） / 充值积分（永久有效） | `identity_credit_accounts` 是**单周期**账户，`user_id` 是**主键** ⇒ **一个用户只能有一个周期** | ❌ **装不下** |
| G-2 | **FIFO 按过期时间扣减** | **无 `expires_at` 字段** | ❌ **无字段支撑** |
| G-3 | 会员额度日释放 | 无「日释放」状态字段 | ❌ 缺 |
| G-4 | 充值积分永久有效 | 无「永不过期」表达 | ❌ 缺 |
| G-5 | 账户与分录的 `period_start/period_end` 语义 | 已有一致 | ✅ 可复用 |

### 4.3 目标模型（**待实现，本 change 不含**）

**方向（不是最终 DDL，实施前须再走一轮设计评审）**：

- 账户行**从「一用户一行」改为「一用户 × 一轨一行」**
  - `source_type` ∈ {`membership`（会员额度）, `recharge`（充值积分）}
  - `expires_at`（`membership` 轨 = 周期末；`recharge` 轨 = NULL 表示永久）
  - 主键从 `user_id` 改为 `(user_id, source_type)`（或引入 `account_id`）
- 扣减改为 **FIFO**：按 `expires_at` 升序（NULL 最后）跨轨取余额
- 账本分录需能表达「这笔从哪条轨扣的」⇒ 账本可能需要 `account_id` 维度

⚠️ **这条会改 `identity_credit_accounts` 的主键 ⇒ 属于破坏性 schema 变更** ⇒
必须**新建迁移**（`migrations/postgresql/` 现有占用见 §9.3）⇒ **独立 change，独立评审**。

### 4.4 与 D-① / D-② 的关系

D-③ **不阻塞** D-① / D-② 的**接线**（`consumeCredit` 当前的单周期模型能跑），
但**阻塞**「会员额度日释放 + 充值积分永久有效 + FIFO 过期扣减」这三条**产品能力**的上线。

⇒ **处置**：**独立立项**，与官方算力接线**并行推进**；接线阶段用当前单周期模型跑通，
待 D-③ 落地后做一次**账目迁移**（把单周期余额拆成双轨余额）⇒ 该迁移需与 Phase 1 的
`reconcileAccount(userId)` 对账能力配合。

---

## 5. 端到端流程

### 5.1 主流程（官方算力模式）

```
① 桌面端：用户选质量档（standard/hd/cinema）+ 规格
   └─ 调 GET /api/v1/usage/estimate（或本地按档位等效单价估算）
      → 展示「本次预计消耗 N 积分」

② 桌面端：POST ops-center {opsCenterUrl}/api/v1/compute/execute
   body: { userId, tier, spec, prompt, ... , idempotencyKey }

③ ops-center：鉴权（服务间 + 用户 Bearer 校验）→ 校验档位与配额

④ ops-center：选 Key
   ├─ 按 tier_access 过滤 → 按 priority ASC 排序 → 取第一个可用
   ├─ 检查 rate_per_minute / daily_limit
   └─ 无可用 Key ⇒ 熔断降级：切 fallback（聚合 API）或拒绝

⑤ ops-center：算成本（预估）
   └─ model_price_cards 取当前生效价（缺价 ⇒ 告警 + 拒绝，不许按 0）

⑥ ops-center：**先落 model_usage_events（status=pending）** ⇒ 拿到 events.id
   ⚠️ 必须在调上游之前落库（幂等键来源，§3.5）

⑦ ops-center：调上游（httpx + 官方 Key）

⑧ ops-center：算实际成本
   └─ cost_cents = f(实际 tokens, 生效价) ；credit_cost = ceil(cost_cents / 单价 × 倍率)

⑨ ops-center：调 api-publish-engine POST /api/v1/credit/consume
   body: { userId, amount: credit_cost, costCents, priceId, refId: events.id, periodStart, periodEnd }
   ├─ 成功 ⇒ events.status=charged
   └─ 失败 ⇒ events.status=pending_charge + 告警（§3.4）

⑩ ops-center：更新事件（实际 tokens / 实际成本 / status）

⑪ 桌面端：渲染结果 + 显示本次实际消耗
```

### 5.2 降级路径

| 场景 | 处置 | 用户可见 |
|---|---|---|
| 池内某套餐额度不足 | 切池内下一成员 | 静默（除非切到聚合 API） |
| 池内全部耗尽 | 切聚合 API（实时价） | 「当前使用备用通道」 |
| 切聚合 API 成本更高 | **同向降扣费**（降级必须同向降扣费） | 「已切换到**省钱模式**」 |
| 用户勾选「自动降级」 | 允许上述降级 | 勾选框 |
| 用户未勾选 | 池内耗尽 ⇒ **拒绝 + 提示** | 「当前档位资源紧张，请稍后重试或切换档位」 |
| Key 熔断（`is_active=0`） | 跳过该 Key | 运营后台告警 |

### 5.3 失败矩阵

| 失败点 | 是否调上游 | 是否扣积分 | 是否产生用量事件 | 用户提示 |
|---|---|---|---|---|
| 鉴权失败 | 否 | 否 | 否 | 「登录已失效，请重新登录」 |
| 档位/配额不满足 | 否 | 否 | 否 | 「当前档位不支持该规格」 |
| 无可用 Key 且无 fallback | 否 | 否 | 否 | 「当前档位资源紧张，请稍后重试」 |
| 缺价格卡 | 否 | 否 | 否（**但必须告警**） | 「服务暂不可用」（**不许静默按 0**） |
| 上游报错 / 超时 | 是 | **否**（失败不扣） | 是（status=failed） | 「生成失败，请重试」 |
| 上游成功但扣分失败 | 是 | **待补扣** | 是（status=pending_charge） | 「生成成功，积分结算中」（**不谎报已扣**） |
| 扣分返回余额不足 | 是 | 否 | 是（status=charge_rejected） | 「积分不足，请充值或切换 BYOK」 |

---

## 6. 数据校验清单

### 6.1 请求入参（ops-center 侧）

| 字段 | 校验 | 失败处置 |
|---|---|---|
| `userId` | 非空、长度 ≤ 128、存在于 `identity_users` | 400 `CREDIT_USER_INVALID` |
| `tier` | ∈ {standard, hd, cinema} | 400 |
| `spec` | 属于该 tier 的允许集合 | 400 |
| `prompt` | 非空、长度 ≤ 档位上限 | 400 |
| `idempotencyKey` | 非空、≤ 128、**同键重复 ⇒ 返回上次结果** | 409 或直接返回上次结果 |
| `amount`（扣分时） | **正整数** | `CREDIT_AMOUNT_INVALID` |
| `costCents`（扣分时） | **非负整数** | `TypeError`（既有实现） |
| `periodStart`/`periodEnd` | `start < end` | `CREDIT_PERIOD_INVALID` |

### 6.2 Key 池（选 Key 时）

| 校验 | 依据 |
|---|---|
| `is_active = 1` | 熔断位 |
| `tier_access` 含目标档位 | `get_active_keys_for_tier` 的语义（⚠️ 该函数**生产引用数为 0**，实现时须同步接线） |
| `expires_at` 未过期 | **字符串字典序比较**（现状是 String，不是 date ⇒ 迁移时若改类型须同步改比较逻辑） |
| `rate_per_minute` / `daily_limit` 未超 | 限流器 |
| 优先级排序 | **`priority` ASC**（⚠️ **不是 DESC**） |
| Key 密文可解 | Fernet `decrypt` 失败 ⇒ 跳过该 Key + 告警（**不许静默跳过**） |

### 6.3 价格与成本

| 校验 | 失败处置 |
|---|---|
| 当前生效价存在（`effective_to IS NULL`） | **拒绝服务 + 告警**（Phase 1 取舍 6：缺价格卡必须告警，不许静默按 0） |
| `cost_cents` 为非负整数 | 500 + 告警 |
| `credit_cost = ceil(cost_cents / credit_unit_price_cents × multiplier)` | 单价 ≤ 0 ⇒ 除零兜底（Phase 1 已实现） |
| `client_reported_cost_cents` 与服务端值比对 | 差异进对拍报表（**不自动改账**） |

### 6.4 扣分（api-publish-engine 侧，沿用既有实现）

| 校验 | 实现位置 | 失败 |
|---|---|---|
| 账户存在 | `ensureAccount(userId, periodStart, periodEnd)` | 400 |
| `amount` 正整数 | `_assertGrant` | `CREDIT_AMOUNT_INVALID` |
| 余额充足 + 并发安全 | `_applyBalance` 带 `balance >= amount` 的原子 CAS | `CREDIT_BALANCE_EXHAUSTED` |
| 余额非负 | `CHECK (balance >= 0)` | 触发即回滚（最后一道防线） |
| 分录类型白名单 | `CHECK (entry_type IN (...))` | 触发即回滚 |
| 幂等 | `(ref_type, ref_id, entry_type='spend')` 查重 | 返回 `duplicated: true` |

---

## 7. 功能逻辑（关键规则）

### 7.1 计费边界

- **只有「生成」扣积分，「操作」不扣**（沿用研究报告既有决策）
- 判据 = **上游是否真的返回有效产出**，不是用户点没点取消
- 失败 / 超时 / 空产出 ⇒ **不扣**

### 7.2 降级必须同向降扣费

降级到更便宜的上游 ⇒ 扣费**必须同步下调**；话术包装为「**省钱模式**」（正向表述）。
⚠️ 反向同理：升级到更贵的路径 ⇒ 扣费同步上调，且**须用户事前同意**（勾选框）。

### 7.3 BYOK

- BYOK **只免算力积分**，**功能配额仍受档位约束**（避免成熟用户全 BYOK + 买最低档）
- 用户**只选质量档**，不选具体模型；背后 fallback 链由运营方配置

### 7.4 `user_id` 归属（**必须与接线同批修**）

| 现状 | 目标 |
|---|---|
| `usage-reporter.js` 只发 `client_id` | **发 `user_id`（Logto `sub`）+ `client_id`** |
| `tokens_in`/`tokens_out`/`cost` 恒 0 | **填真实值**（服务端另算，客户端值只作对拍样本） |
| 缺 `user_id` ⇒ 成本归不到用户 | 有 `user_id` ⇒ `model_usage_events` 具备用户级归属 |

⚠️ **不修这条 ⇒ 官方算力链路无法把成本归到用户 ⇒ 账本无法核对 ⇒ 整条线不成立。**

### 7.5 挂起与对账

- 用量事件状态机：`pending` → `charged` / `failed` / `pending_charge` / `charge_rejected`
- `pending_charge` 的事件需要**定时对账任务补扣**
  ⚠️ **任务宿主尚未解决**（全仓无 cron/APScheduler，交接文档 K7）⇒ 与 Phase 1 同源问题，须一并立项

### 7.6 计费口径真源

`01-docs/usage-metering-spec.md` 是**口径唯一真源**（五类 token、整数分、版本化价格、信任边界、缺价不许静默）。
本设计**不重新定义口径**，只引用。

---

## 8. 交互逻辑 / 显示项 / 提示文字

### 8.1 桌面端显示项

| 位置 | 显示项 | 数据来源 | 规则 |
|---|---|---|---|
| 会员中心「我的算力」卡 | 剩余积分 | `account.balance` | 整数，**不带小数** |
| 同上 | 本月剩余天数 | `account.period_end` − 今天 | 归零后显示「下个周期」 |
| 同上 | 约可生成（4 行换算） | 档位等效单价 | **必须带浮动说明**（文案不得承诺精确值） |
| 生成前确认弹窗 | 质量档下拉 | standard / hd / cinema | **pro 档位对 standard 用户禁用 + 升级引导** |
| 同上 | 「背后模型：运营方配置中」 | — | **不展示具体模型名** |
| 同上 | 本次预计消耗 | 档位等效单价 × 规格 | 标注「预计」，浮动范围提示 |
| 同上 | 剩余额度 | `account.balance` | 低于阈值变色 |
| 同上 | 自动切换勾选框 | 用户偏好 | 默认**不勾选** |
| 生成中 | 实时扣减提示 | — | **扣分未成功时不得显示「已扣除」** |
| 生成完成 | 本次实际消耗 | `entry.amount` | 与预计不一致时给一句说明 |

### 8.2 提示文字（zh / en **必须成对**，CI Gate 7 强制）

| 场景 | 中文 | English |
|---|---|---|
| 余额不足 | `积分不足，当前剩余 {balance} 积分。本次需要 {required} 积分。` | `Not enough credits. You have {balance}, this request needs {required}.` |
| 余额不足（可充值） | `积分不足，可充值后继续，或切换到你自己的 API Key。` | `Not enough credits. Top up to continue, or switch to your own API key.` |
| 资源紧张 | `当前档位资源紧张，请稍后重试或切换到其他档位。` | `This quality tier is busy right now. Please retry later or switch tiers.` |
| 服务暂不可用 | `服务暂不可用，已记录本次用量，请稍后查看。` | `Service temporarily unavailable. Your usage has been recorded; check back shortly.` |
| 扣分结算中 | `生成成功，积分结算中（约 {seconds} 秒内完成）。` | `Done. Credits are being settled (within about {seconds}s).` |
| 降级（省钱模式） | `已切换到省钱模式，本次消耗更低。` | `Switched to savings mode — this request costs less.` |
| 降级（备用通道） | `已切换到备用通道，响应可能稍慢。` | `Switched to a backup channel; it may be slightly slower.` |
| 上游失败 | `生成失败：{reason}。本次未扣除积分。` | `Generation failed: {reason}. No credits were charged.` |
| 价目缺失（运营侧） | `缺少 {model} 的生效价格，已暂停该模型调度。` | `No active price for {model}; scheduling for it is paused.` |

⚠️ **文案纪律**：
- **不许承诺精确值**（「约可生成」必须带浮动说明）
- **不许在扣分未成功时显示「已扣除」**
- **失败文案必须明示「本次未扣除积分」**（降低客诉成本）
- **降级一律正向表述**（「省钱模式」），不用「降级」「降质」等负面词

### 8.3 运营后台显示项（ops-center）

| 页面 | 显示项 | 规则 |
|---|---|---|
| 官方 Key 列表 | 供应商、密文掩码、tier_access、priority、rate_per_minute、daily_limit、expires_at、is_active | 密文**只显示掩码**，任何列表/导出不得含明文 |
| 同上 | 「**能否解密**」健康列 | 解密失败 ⇒ **红标 + 告警**，不静默跳过 |
| 同上 | 「**可被选中的档位**」 | 由 `tier_access` 反算，**只读**（避免与实际选 Key 逻辑漂移） |
| 成本台账 | 日期、模型、tokens、cost_cents、credit_cost、price_id | **服务端算的值**为主；客户端透传值只作对拍列 |
| 同上 | 「**缺价**」标记 | 缺价事件必须**显式列出**（不许静默按 0） |
| 对账报表 | expected vs actual 差异 | 差异 > 15% 进对账报表（沿用 PRD §4.3） |
| 挂起队列 | `pending_charge` 事件列表 | 可见、可人工补扣 |

### 8.4 交互逻辑要点

| 交互 | 规则 |
|---|---|
| 质量档切换 | 立即重算「预计消耗」；**档位变更不改已发起的请求** |
| 自动切换勾选 | 默认关；关闭时池内耗尽 ⇒ 拒绝 + 提示，不擅自降级 |
| 扣分失败重试 | 客户端**不重试**（服务端已幂等）；用户点「重试」⇒ 用**同一 `idempotencyKey`** |
| 重复提交 | 同一 `idempotencyKey` ⇒ 返回上次结果，**不重复扣费、不重复调上游** |
| BYOK 切换 | 切换后**本次请求不混用**两条供给链 |
| 运营侧改价 | **禁 UPDATE 单价**；改价 = 插新行 + 给旧行补 `effective_to`（价格卡不可变性） |
| 运营侧摘 Key | `is_active=0` ⇒ ≤1s 内全网生效 |

---

## 9. 与既有文档的关系

### 9.1 本设计**取代**的

| 文档 | 被取代的部分 |
|---|---|
| `openspec/changes/official-keys-postgres-migration/` | **整体改向**：从「迁表」改为「扣减接线」（D19 + 本设计） |
| `openspec/changes/compute-key-envelope-migration/` | **前提失效**：其存在理由是「Node 侧要解官方 Key」⇒ 需归档或改向（**见该 change 的 D-22 声明**） |

### 9.2 本设计**继承**的（不改）

| 文档 | 继承内容 |
|---|---|
| `01-docs/usage-metering-spec.md` | **口径唯一真源**（五类 token / 整数分 / 版本化价格 / 信任边界 / 缺价不许静默） |
| `01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md` | 三类计费形状（A/B/C）、定价基准优先级（B>A>C）、形状数量有界为 3 |
| `01-docs/PRD-REMOVE-BUYOUT-AND-PRICING-2026-10-17.md` | 定价与赠送量口径（1 积分 = ¥0.01） |
| `01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md` | 成本摊销（保底/接近耗尽/濒危/耗尽四段）、混合制 |
| Phase 1 执行记录 | 价格卡版本化、服务端算成本、缺价告警、原子扣减、账本不可变 |

### 9.3 迁移编号现状（实施时须重新查）

`ls migrations/postgresql/` 实测（2026-10-25）：

```
002_logto_identity.sql          006_payment_orders.sql
003_logto_webhook_events.sql    008_credit_ledger.sql
004_member_commerce.sql         009_redeem_code_issued_to.sql
005_cloud_accounts.sql
```

⇒ `006` 已占、`007` 已被 `compute-key-envelope-migration` 预定、`008`/`009` 已占
⇒ **新迁移从 `010` 起**（FK 建表顺序 = 文件名 `localeCompare` 序，**不是撞号**）
⇒ ⚠️ **加文件与执行必须同批部署**（`assertReady` 用 `allowPending:false`）

---

## 10. 验收标准

### 10.1 本设计（文档层）

- [ ] 三个定案在 `PRD-OFFICIAL-COMPUTE-STOPGAP` §4 与两个 change 目录中**口径一致**（无矛盾表述）
- [ ] 「决策失效」的条目都**带前提条件**（不裸写「已作废」）
- [ ] 所有引用的 `file:line` **当场实测**（不推算）
- [ ] 中文写入后 `grep -c $'\xef\xbf\xbd'` = 0

### 10.2 实施（后续 change，本设计不含）

- [ ] 官方算力端点在 ops-center 落地，**供给侧零迁表**（`official_keys` 仍在 SQLite）
- [ ] `POST /api/v1/credit/consume` 在 api-publish-engine 落地，鉴权非桌面端凭据
- [ ] 幂等：同 `refId` 重复扣分只成功一次
- [ ] 扣分失败 ⇒ 不发货（发货前）/ 挂起补扣（发货后）
- [ ] 降级 ⇒ **同向降扣费** + 正向话术
- [ ] `usage-reporter` 带上 `user_id` 与真实 tokens/cost
- [ ] 缺价格卡 ⇒ 拒绝服务 + 告警（**不许静默按 0**）
- [ ] 端到端真跑：成片 + 账本分录 + 用量事件三方对账一致

---

## 11. 未决项（实施前必须逐条关闭）

| # | 未决项 | 影响 | 建议 |
|---|---|---|---|
| **U-1** | ops-center → api-publish-engine 的**服务间鉴权机制** | 阻塞 D-② | 复用既有服务间凭据（若已有）；若无，需在 api-publish-engine 加**独立于用户 Bearer** 的服务凭据校验 ⇒ **属「谁来守门」级别的改动，须人工过目** |
| **U-2** | 官方算力端点的**路径与幂等键归属** | 影响桌面端接线 | 建议 `POST /api/v1/compute/execute` + `idempotencyKey` 由桌面端生成 |
| **U-3** | `official_credit` **不在 plan-matrix 的 features 数组**（Phase 1 记录明说） | **未加则扣分端点拿不到 feature 授权** | 补进 features 数组 + 档位映射（属定价/权益变更，**须人工过目**） |
| **U-4** | `get_active_keys_for_tier` **生产引用数为 0** | 选 Key 逻辑无现成调用点 | 实现时**必须接线**，不能只写函数 |
| **U-5** | 定时对账任务的**任务宿主**（全仓无 cron/APScheduler） | 阻塞 `pending_charge` 补扣 | 与 Phase 1 同源问题，须一并立项 |
| **U-6** | D-③ 账户模型（双轨 + `expires_at`）的具体 DDL | 阻塞双轨能力上线 | **独立 change + 独立评审**（改主键 = 破坏性变更） |
| **U-7** | 官方 Key 的**运维迁移**（存量 Key 从 Fernet 到新形态） | D-① 下**不需要**（Fernet 保持不变） | **关闭**（前提失效） |

---

## 12. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-25 | 初版。三个定案（D-①/D-②/D-③）落定；`official-keys-postgres-migration` 改向为「扣减接线」；`compute-key-envelope-migration` 前提失效。 |
