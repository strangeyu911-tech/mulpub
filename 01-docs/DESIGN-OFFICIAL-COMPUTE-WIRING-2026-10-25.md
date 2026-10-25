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

> ⚠️ **本设计的当前状态：尚不可直接开工。**
> 第 2 轮对抗复评在**本设计的已合并版本**上又查出 **26 条实现符合性缺口 + 17 条新的可复现失效路径
> （其中 8 条 CRITICAL）**；且第 1 轮发现的回归验收结果是「完全修好 17 / 部分修 24 / 未修 49」。
> ⇒ **实施前必须先关闭 §13.2 的 12 条阻断项 + §11 的未决项。**
> 详见文末 **§13「第 2 轮对抗复评结论与本设计的当前完成度」**。

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
                                      ├─ 算成本（model_price_cards → **cost_micros，微元**）
                                      ├─ 算积分（ceil(cost_micros / credit_unit_price_micros × 倍率)）
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
- `tokens_in` / `tokens_out` / `cost` **主路径已是数据库聚合的真实值**（`:123-125` 累加、`:145-147` 上报）；
  **仅兜底桶**写死为 0（`:109`、`:169-171`）⇒ 真正缺的是 `user_id`，不是这三个数

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
| `authSubject` | string | ✅ | **携带 Logto `sub`**（= `auth_subject.auth_subject`），**不是** `identity_users.id`（后者是 `crypto.randomUUID()` 生成的内部 id，`002_logto_identity.sql:7` / `:16`）。⚠️ **端点内解析**：api-publish-engine 用 `postgres-identity-repository.findBySubject('logto', sub)` 解析出 `identity_users.id` 后再调 `consumeCredit`（账本 FK 指向 `identity_users.id`，`credit-schema.js:23`）⇒ **sub→id 的解析只发生在引擎侧**；ops-center **不查 Postgres**、不认识 `identity_users`（守 §3.1） |
| `amount` | integer | ✅ | 扣减积分（**正整数**；`amount <= 0` ⇒ `CREDIT_AMOUNT_INVALID`） |
| `costCents` | integer | ✅ | 上游真实成本（**分**；非负整数）。⚠️ **ops-center 手里是「微元」⇒ 必须换算**：源列 `model_usage_events.cost_micros`（微元）⇒ 换算规则见 **§3.3.1 跨库单位换算** |
| `priceId` | string | — | 价目卡 id（版本化价格，禁 UPDATE） |
| `reason` | string | — | 人类可读原因（进账本 `reason` 列） |
| `refType` | string | — | ⚠️ **必须是常量 `'usage_event'`**（不可配、不可省）：DB 唯一索引是**部分索引**，只覆盖 `ref_type='usage_event'`（`credit-schema.js:56-58` / `008_credit_ledger.sql:78-80`）⇒ 传别的值 ⇒ 索引 WHERE 不成立 ⇒ 并发重复扣分**不再被 DB 拦** |
| `refId` | string | ✅ | **幂等键**：对应 `model_usage_events.id`。⛔ **空值必须 400 拒绝**：既有 `consumeCredit` **没有** `if (refId)` 守卫（`grantCredit` 有，`credit-repository.js:78`）⇒ `refId=''` 与**任何**一次空 refId 的扣分共用查重键 `(usage_event,'')` ⇒ **第二次起静默「已扣」但实际不扣** ⇒ 静默免费算力。<br>⚠️ **查重不含 `user_id`**（`credit-repository.js:145-149` 的预查只按 `(ref_type, ref_id, entry_type)`）⇒ `refId` 必须**全局唯一且不可复用**（建议 `events.id` 用 UUID，不用自增整数） |
| `periodStart` / `periodEnd` | ISO8601 | ✅ | 发放周期边界 |

**响应体**：

| 字段 | 说明 |
|---|---|
| `account` | 扣后账户快照（**camelCase**：`balance` / `grantedTotal` / `spentTotal` / `periodStart` / `periodEnd` —— 与 `credit-repository.js:357-366` 的既有返回一致） |
| `entry` | 账本分录（**camelCase**：`id` / `amount` / `balanceAfter`） |
| `duplicated` | `true` ⇒ 该 `refId` 已扣过，**本次未重复扣**（幂等命中） |

**错误码**：

| 码 | HTTP | 含义 | ops-center 的处置 |
|---|---|---|---|
| `CREDIT_BALANCE_EXHAUSTED` | **409**（既有 `CreditError.status` 硬编码 409，**不是 402**） | 余额不足 | ⚠️ **此处语义唯一**：扣分发生在**发货后** ⇒ 409 ⇒ **挂起该用量事件**（`pending_charge`）+ 告警（§3.4）⇒ **不是**「不发货」——发货前的余额拦截由 §5.1 ⑤' 的**额度预检**负责（那时上游根本没被调用） |
| `CREDIT_AMOUNT_INVALID` | **400** | `amount` 非正整数。⚠️ **既有实现抛的是 `TypeError`（不是 `CreditError`）** ⇒ 端点须在**入口**自己校验并转成 400 | **不发货**，告警（属内部契约错误） |
| `CREDIT_PERIOD_INVALID` | 400 | 周期边界不合法。⚠️ **仓内当前无此错误码**（`grep` 零命中）⇒ 需**新增**（见 §11 U-9） | **不发货**，告警 |
| `CREDIT_SERVICE_UNAVAILABLE` | 503 | 扣分服务不可用。⚠️ **仓内当前无此错误码**（`grep` 零命中）⇒ 需**新增**（见 §11 U-9） | 挂起 + 告警（§3.4） |
| `CREDIT_REF_INVALID` | 400 | `refId` 为空 / `refType` 不是常量 `'usage_event'`。⚠️ **仓内无此码** ⇒ 需**新增**（见 §11 U-9） | 挂起 + 告警（内部契约错误） |
| `CREDIT_AUTH_INVALID` | 401 / 403 | 服务间凭据缺失或无权调用扣分端点。⚠️ **仓内无此码** ⇒ 需**新增**（见 §11 U-9） | 挂起 + 告警 |
| 未知 | 5xx | — | **不发货**，重试上限内重试；超限 ⇒ 挂起 + 告警 |

### 3.3.1 跨库单位换算（**必读**：两个库的单位不同）

| 侧 | 库 | 列 / 字段 | 单位 | 依据 |
|---|---|---|---|---|
| 供给侧（算成本） | ops-center / SQLite | `model_usage_events.cost_micros` | **微元**（1e-6 元） | `models_credit.py:190` |
| 供给侧（单价） | ops-center / SQLite | `model_price_cards.unit_price_micros` | **微元** / unit | `models_credit.py:116` |
| 供给侧（积分单价） | ops-center / SQLite | `credit_price_config.credit_unit_price_micros` | **微元 / 积分**（默认 `CREDIT_UNIT_MICROS = 10000`） | `models_credit.py:61/142` |
| 供给侧（算积分） | ops-center / Python | `compute_credit_cost(cost_micros, credit_unit_price_micros, multiplier)` | 积分（**ceil**） | `credit_price_service.py:136-145` |
| **账本侧（记成本）** | api-publish-engine / Postgres | `identity_credit_ledger.cost_cents` | **分** | `credit-schema.js:44`、`008_credit_ledger.sql:50` |
| **账本侧（入参）** | api-publish-engine / JS | `consumeCredit({ costCents })` | **分**（非负整数） | `credit-repository.js:133/142` |

⚠️ **口径真源是「微元」**：`01-docs/usage-metering-spec.md` §3 明写「**单位一律用整数微元（1e-6 元）**」，
并给出理由 —— LLM 每千 token 单价天然**亚分**，整数「分」存不下 ⇒ 只能存 0（**静默当免费**）或 1（**放大 3.3 倍**）。
⚠️ 仓内 `ops-center/backend/scripts/seed_credit_price_cards.py:103-108` 的 `LEGACY_COLUMNS`
也把 `unit_price_cents` / `credit_unit_price_cents` 显式列为**待改名的旧 schema** ⇒ **勿照抄「分」口径的旧名**。

**换算规则（本设计定案）**

```
① 积分量 amount    = ceil(cost_micros × multiplier / credit_unit_price_micros)   ← ops-center 侧算，**权威**
② wire 字段 costCents = ceil(cost_micros / 10000)                               ← 微元 → 分
```

- ② 的**向上取整**是刻意的：账本成本列是**审计与对账依据**，记 0 等于「静默免费」、记低等于系统性偏低
  ⇒ **宁可略高，不可记 0**。
- ⚠️ **① 与 ② 不是同一个量**：② 只给账本留审计痕迹，**绝不能用 ② 反算 ①**
  ⇒ 反算会在单位混用时放大 10000 倍（§6.3）。
- ⚠️ **账本列名口径是否统一到微元，属待拍板项（§11 U-11）**：改列名要重做**已应用**的迁移
  `008_credit_ledger.sql` ⇒ checksum 变更 ⇒ **破坏性**，agent 不得自行决定。

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
- `ref_id` = `model_usage_events.id`（ops-center 侧生成，**必须 UUID**）
- ⚠️ **两道已知缺口（实施时必须补，否则幂等不闭合）**：
  1. **查重不含 `user_id`**（`credit-repository.js:145-149`）⇒ 撞上别人的 `refId` 会命中他人分录
     ⇒ `refId` 必须**全局唯一**。
  2. **仓储层查重是 read-then-write、非原子**（`credit-repository.js:145-149`）⇒ 并发下两道同 `refId`
     可能双双穿过查重 ⇒ **DB 部分唯一索引是最后一道防线**，而它只覆盖 `ref_type='usage_event'`
     ⇒ `refType` 必须是常量（见 §3.3）。
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
   ⚠️ **两个端点仓内都不存在**（`ops-center/backend/routers/usage.py` 只有 `ingest` 与 `summary`；
      「档位等效单价」**仓内无实现、无数据源**——`officialCreditMonthly` 是**总量**不是单价）
      ⇒ **阻断项 B-8**（§13.2）

② 桌面端：POST ops-center {opsCenterUrl}/api/v1/compute/execute
   body: { userId, tier, spec, prompt, ... , idempotencyKey }

③ ops-center：鉴权（服务间 + 用户 Bearer 校验）→ 校验档位与配额

④ ops-center：选 Key
   ├─ 按 tier_access 过滤 → 按 priority ASC 排序 → 取第一个可用
   ├─ 检查 rate_per_minute / daily_limit
   └─ 无可用 Key ⇒ 熔断降级：切 fallback（聚合 API）或拒绝

⑤ ops-center：算成本（预估）
   └─ model_price_cards 取当前生效价（缺价 ⇒ 告警 + 拒绝，不许按 0）

⑤' ops-center：**额度预检（只读，不扣分）**
   └─ 读账户余额 ⇒ 余额不足 ⇒ **不调上游**，回「积分不足」
   ⚠️ **这是 fail-closed 的落点**：预检**只读**，不建表、不加迁移、不引入 reserve/settle 模型
   ⛔ **阻断项 B-2**：**当前没有可用的读余额通道**——
      `credit-repository.js:53` 的 `getAccount` **无任何路由**（`publish-api-server.js` 全文 1566 行
      `credit` **零命中**），且 `PostgresCreditRepository` **生产零实例化**
      ⇒ 契约里**只有 consume 一个端点**，预检**无端点、无契约、无任务**
   ⛔ **阻断项 B-3**：**赠送量从未进入积分账户**——`grantCredit`（`credit-repository.js:73`）**生产调用方 0**
      ⇒ 账本 `entry_type='grant'` 无写入方 ⇒ 账户行不存在或 `balance=0`
      ⇒ 预检**恒判「余额不足」** ⇒ 每个官方算力请求都被拒

⑥ ops-center：**先落 model_usage_events（status=pending）** ⇒ 拿到 events.id
   ⚠️ 必须在调上游之前落库（幂等键来源，§3.5）
   ⛔ **阻断项 B-4**：**事件表当前「有表无写方」**——`ModelUsageEvent`（`models_credit.py:149`）在
      `ops-center/backend/` 全树**只有类定义、无任何 INSERT/UPDATE**；现有上报路径写的是**日聚合表**
      `model_usage_daily`（`usage_service.py:133/150-161`）⇒ 事件写入路径**需新建**

⑦ ops-center：调上游（httpx + 官方 Key）

⑧ ops-center：算实际成本
   └─ cost_micros = f(实际 tokens, 生效价)              ← **微元**
      credit_cost = ceil(cost_micros / credit_unit_price_micros × 倍率)   ← **积分（权威）**
   ⛔ **阻断项 B-5**：**视频 / 图像 / TTS / ASR 的成本恒为 0**——
      `compute_cost_micros` 只遍历 `token_counts`（`credit_price_service.py:112`），
      而 `TOKEN_FIELD_TO_UNIT`（`:47-53`）**只有 5 类 token** ⇒ 非 token unit 不产生任何 unit
      ⇒ `cost_micros = 0` ⇒ `credit_cost = 0` ⇒ `amount=0` 被 `consumeCredit` 拒（`credit-repository.js:259`）
      ⇒ **每一次都白送**，且 `has_missing_price` 为 False ⇒ 「缺价 ⇒ 拒绝服务」**在主力场景不触发**
      ⇒ 需与 **U-12（价格卡是否入库）** 一并拍板

⑨ ops-center：**发货后实扣** —— 调 api-publish-engine POST /api/v1/credit/consume
   body: { authSubject, amount: credit_cost, costCents, priceId, refId: events.id, periodStart, periodEnd }
   ⚠️ `costCents` 由 `cost_micros` **÷10000 向上取整**换算而来（§3.3.1）⇒ **它不是 amount 的来源**
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
| 额度预检判定余额不足 | **否**（发货前已拦） | 否 | **否** | 「积分不足，请充值或切换 BYOK」 |
| 预检通过但实扣时余额被并发抢走 | 是 | **待补扣** | 是（status=pending_charge） | 「生成成功，积分结算中」（**不谎报已扣**） |

---

## 6. 数据校验清单

### 6.1 请求入参（ops-center 侧）

| 字段 | 校验 | 失败处置 |
|---|---|---|
| `authSubject`（扣分时） | 非空、长度 ≤ 128；**端点内** `findBySubject('logto', sub)` 能解析出 `identity_users.id` | 404 `CREDIT_USER_INVALID`（**仓内无此码**，见 §11 U-9） |
| `tier` | ∈ {standard, hd, cinema} | 400 |
| `spec` | 属于该 tier 的允许集合 | 400 |
| `prompt` | 非空、长度 ≤ 档位上限 | 400 |
| `idempotencyKey` | 非空、≤ 128、**同键重复 ⇒ 返回上次结果** | 409 或直接返回上次结果 |
| `amount`（扣分时） | **正整数**（`amount=0` 也非法 —— 视频/图像场景会算出 0，见 §5.1 ⑧） | `CREDIT_AMOUNT_INVALID` |
| `costCents`（扣分时） | **非负整数**，单位**分**（由 `cost_micros` 换算，§3.3.1） | `TypeError`（既有实现）⇒ 端点入口转 400 |
| `refId`（扣分时） | **非空** + 全局唯一 | 400 `CREDIT_REF_INVALID`（**仓内无此码**，见 §11 U-9） |
| `refType`（扣分时） | **必须等于常量** `'usage_event'` | 400 `CREDIT_REF_INVALID` |
| `periodStart`/`periodEnd` | `start < end` | `CREDIT_PERIOD_INVALID` |

### 6.2 Key 池（选 Key 时）

| 校验 | 依据 |
|---|---|
| `is_active = 1` | 熔断位 |
| `tier_access` **等级码 ≤ 用户档位等级**（**整数等级码**，不是「含目标档位」的集合；真实判据是 `tier_access <= user_tier`）（⚠️ `get_active_keys_for_tier` **生产引用数为 0**，实现时须同步接线）<br>⚠️ **量纲必须对齐（否则三档各错一级）**：`tier_access` 是 **1-based**（`models.py:127`：1=all / 2=standard+ / 3=pro only）；而 `plan-matrix.js` 的 `modelTier` 是 **0-based**（free 0 / standard 1 / pro 2，经 `:245` 的 `limits.model_tier` 下发）⇒ **`user_tier = modelTier + 1`**。直接拿 `model_tier` 当 `user_tier` ⇒ free 档一条 Key 都选不到、standard 档拿不到 `tier_access=2` 的 Key、pro 档拿不到 `tier_access=3` 的 Key |
| `expires_at` 未过期 | **字符串字典序比较**（现状是 String，不是 date ⇒ 迁移时若改类型须同步改比较逻辑） |
| `rate_per_minute` / `daily_limit` 未超 | 限流器 |
| 优先级排序 | **`priority` ASC**（⚠️ **不是 DESC**） |
| Key 密文可解 | Fernet `decrypt` 失败 ⇒ 跳过该 Key + 告警（**不许静默跳过**） |

### 6.3 价格与成本

| 校验 | 失败处置 |
|---|---|
| 当前生效价存在（⚠️ **判据是 `effective_to` 为空串** `''`（`default=""`），**不是 `IS NULL`**；代码判据 `if card.effective_to and card.effective_to <= moment`） | **拒绝服务 + 告警**（Phase 1 取舍 6：缺价格卡必须告警，不许静默按 0） |
| `cost_micros` 为非负整数（**微元**） | 500 + 告警 |
| `credit_cost = ceil(cost_micros / credit_unit_price_micros × multiplier)` | ⚠️ **兜底下限是 `CREDIT_UNIT_MICROS`(10000)，不是 1**（`credit_price_service.py:262/264` 的 `max(CREDIT_UNIT_MICROS, …)`；`:144` 的 `max(1, …)` 只是第二层）⇒ 读配置读到 0 时**退回基准 10000**，**不是退到 1** ⇒ 自行实现成「退到 1」会**扣分放大 10000 倍** |
| `client_reported_cost_micros` 与服务端值比对 | 差异进对拍报表（**不自动改账**）。⚠️ 该列**全仓无写入方**（桌面端官方算力链路上**没有客户端上报**，服务端自己算）⇒ 对拍能力**形同虚设**（§13.2 阻断项 B-9） |
| **非 token unit（视频/图像/TTS/ASR）** | ⛔ `TOKEN_FIELD_TO_UNIT` 只有 5 类 token ⇒ 这些 unit **算不出成本** ⇒ `amount=0` ⇒ 见 §5.1 ⑧ 与 U-12 |

### 6.4 扣分（api-publish-engine 侧，沿用既有实现）

| 校验 | 实现位置 | 失败 |
|---|---|---|
| 账户存在 | ⚠️ **删**：`ensureAccount` **不在扣分路径上**，且它 upsert 建零余额账户、**从不返回 400** ⇒ 真出现 FK 违例是 500 | 500 |
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

### 7.2 降级必须同向降扣费（方向由运行时事实决定，不预设）

降级到更便宜的上游 ⇒ 扣费**必须同步下调**；话术包装为「**省钱模式**」（正向表述）。
⚠️ 反向同理：升级到更贵的路径 ⇒ 扣费同步上调，且**须用户事前同意**（勾选框）。

### 7.3 BYOK

- BYOK **只免算力积分**，**功能配额仍受档位约束**（避免成熟用户全 BYOK + 买最低档）
- 用户**只选质量档**，不选具体模型；背后 fallback 链由运营方配置

### 7.4 `user_id` 归属（**必须与接线同批修**）

| 现状 | 目标 |
|---|---|
| `usage-reporter.js` 只发 `client_id` | **发 `user_id`（Logto `sub`）+ `client_id`** |
| `tokens_in`/`tokens_out`/`cost` **主路径已是真值**（仅兜底桶为 0） | **保持真值**（服务端另算，客户端值只作对拍样本） |
| 缺 `user_id` ⇒ 成本归不到用户 | 有 `user_id` ⇒ `model_usage_events` 具备用户级归属 |

⚠️ **不修这条 ⇒ 官方算力链路无法把成本归到用户 ⇒ 账本无法核对 ⇒ 整条线不成立。**

### 7.5 挂起与对账

- 用量事件状态机：`pending` → `charged` / `failed` / `pending_charge` / `charge_rejected`
- `pending_charge` 的事件需要**定时对账任务补扣**
  ⚠️ **任务宿主尚未解决**（交接文档 K7）⇒ **跨轨裁决**：调度器先例**只在 Node 侧存在**
  （`packages/api-publish-engine/src/scheduled-publish.js:93` 的 `setTimeout` 递归定时器）；
  **ops-center（Python）侧实测为零**（`requirements.txt` 无 APScheduler / celery / rq；
  `routers/scheduler.py` 是「发布调度器**契约校验**」，不是定时宿主；`main.py` 只在启动时建表）
  ⇒ **补扣任务要写 ops-center 的 SQLite ⇒ Node 侧的先例不能直接用** ⇒ 宿主待定，见 **U-14**

### 7.6 计费口径真源

`01-docs/usage-metering-spec.md` 是**口径唯一真源**（五类 token、**整数微元**、版本化价格、信任边界、缺价不许静默）。
⚠️ 其单位是**微元**（§3「**单位一律用整数微元（1e-6 元）**」）⇒ 本设计里的成本列一律用 `*_micros`；
「分」只出现在**账本侧** `identity_credit_ledger.cost_cents`（跨库换算见 §3.3.1）。
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
| `01-docs/usage-metering-spec.md` §4.1 | 赠送量与年付守线（**唯一真源**；standard 1600 / pro **3330**，年付守线 ≤40%）<br>（⚠️ 旧写法指向 `PRD-REMOVE-BUYOUT-AND-PRICING-2026-10-17.md` —— 该文件实测**零命中**「积分 / credit / 赠送 / 0.01」⇒ **引用断链**）<br>常量侧出处：`packages/api-publish-engine/src/auth/plan-matrix.js:45` |
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

⇒ `006` 已占、`008`/`009` 已占；⚠️ **`007` 已被释放**——原「被 `compute-key-envelope-migration` 预定」是**规格层预留**，
  该 change 在同一次合并里被判前提失效（D-①）⇒ 磁盘与规格**都不再占 007**（实测 `migrations/postgresql/` 无 `007_*.sql`）
⇒ **新迁移从 `010` 起**（FK 建表顺序 = 文件名 `localeCompare` 序，**不是撞号**）
⇒ ⚠️ **加文件与执行必须同批部署**（`assertReady` 用 `allowPending:false`）

---

## 10. 验收标准

### 10.1 本设计（文档层）

- [x] **§13.2 的 12 条阻断项逐条关闭**（**开工前置条件**）
- [ ] §13.5 的四类台账（73 + 23 + 26 + 17 条）**逐条过**
- [ ] §11 的未决项（U-1、U-8、U-9、U-11、U-12、U-13、U-14）**逐条关闭**
- [ ] 「决策失效」的条目都**带前提条件**（不裸写「已作废」）
- [ ] 所有引用的 `file:line` **当场实测**（不推算）
- [ ] 中文写入后 `grep -c $'\xef\xbf\xbd'` = 0
- ⚠️ **「三个定案在 PRD §4 与两个 change 目录中口径一致」这一条已撤回**：第 2 轮查出**多处不一致**
  （402 vs 409、007 占号口径、tokens 恒 0、「整数分」vs「整数微元」、PRD 流程图顺序、`official_credit` 前提），
  本轮已统一其中 6 处，**剩余随 §13.5 台账逐条处理** ⇒ 该条改为「**台账清零后**才可勾选」

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
| **U-3** | `official_credit_monthly` **实测已在 plan-matrix 的 `quota` 下发** ⇒ 「扣分端点拿不到 feature 授权」**不成立** | 降级为普通条目 | **关闭**（若要为「扣分」单设 feature 才需人工过目） |
| **U-4** | `get_active_keys_for_tier` **生产引用数为 0** | 选 Key 逻辑无现成调用点 | 实现时**必须接线**，不能只写函数 |
| **U-5** | 定时对账任务的**任务宿主**。⚠️ **原表述「仓内已有调度器先例」未限定进程，是错的**（第 2 轮裁决，见 §13.3）：先例**只在 Node 侧**（`packages/api-publish-engine/src/scheduled-publish.js:93`）；**ops-center（Python）侧实测为零**（`requirements.txt` 无 APScheduler/celery/rq；`routers/scheduler.py` 是发布调度器**契约校验**，不是定时宿主） | 阻塞 `pending_charge` 补扣（§13.2 B-10） | 补扣要写 ops-center 的 SQLite ⇒ **Node 侧先例不可直接用** ⇒ 宿主需**重新选型**，见 **U-14** |
| **U-6** | D-③ 账户模型（双轨 + `expires_at`）的具体 DDL | 阻塞双轨能力上线 | **独立 change + 独立评审**（改主键 = 破坏性变更） |
| **U-7** | 官方 Key 的**运维迁移**（存量 Key 从 Fernet 到新形态） | D-① 下**不需要**（Fernet 保持不变） | **关闭**（前提失效） |
| **U-8** | `compute-key-envelope-migration` **归档与否**（其前提已失效） | 归档会把**已失效的契约**写进主规格 | **须人工过目**（改目录结构） |
| **U-9** | `CREDIT_PERIOD_INVALID` / `CREDIT_SERVICE_UNAVAILABLE` / **`CREDIT_REF_INVALID`** / **`CREDIT_AUTH_INVALID`** / **`CREDIT_USER_INVALID`** —— **五个码仓内全部不存在**（`grep` 零命中） | 扣分端点的错误码不完整 | 实现时**新增**这五个码（或复用既有语义） |
| **U-11** | **账本侧成本列的单位口径**：`identity_credit_ledger.cost_cents` 保持**分**（本设计已按 §3.3.1 写死换算规则），**vs** 改列名为 `cost_micros` 与供给侧统一 | 改列名要重做**已应用**的迁移 `008_credit_ledger.sql` ⇒ **checksum 变更 ⇒ 破坏性** ⇒ `allowPending:false` 会让 identity 仓储启动期硬失败 | **须人工过目**（agent 不得自行改已应用迁移） |
| **U-12** | **视频 / 图像 / TTS / ASR 的价格卡是否入库**：`model_price_cards.seed.json` 的 `_meta.rule` 明写「**已知才入库；待确认只登记不入库**」⇒ 这些 unit 现在**没有价格卡** | 不拍板 ⇒ 该场景**要么恒缺价（按 §6.3 拒绝服务 ⇒ 官方算力视频不可用）**，**要么按 §5.1 ⑧ 算出 `amount=0`（每次白送）**（§13.2 B-4） | **须人工拍板**（需要定价数据 —— 运营方的事） |
| **U-13** | **额度预检的读余额通道形态**：新增只读端点（如 `GET /api/v1/credit/account`）／`consume` 端点加 `dryRun`／其它 | 没有它，fail-closed 的落点不存在（§13.2 B-1） | **须人工过目**（新增对外端点 = 改暴露面） |
| **U-14** | **补扣任务的调度宿主**（ops-center 侧实测无定时宿主，见 U-5 / §13.3） | `pending_charge` 无补扣入口 ⇒ 挂起 = 永久白送（§13.2 B-10） | **须人工拍板**（GitHub Actions cron 出网受限 / 外部调度器 / ops-center 自建轮询 —— 三选一） |
| **U-10** | 迁移文件名**须被 `MIGRATION_PATTERN` 认领**（`/^\d{3}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/`） | **只认 3 位数字**；4 位号/2 位号/非法名会被 `filter` **静默丢弃**（fail-open）⇒ `allowPending:false` 也发现不了 | 落任何迁移前**逐个核对文件名能被该正则认领**；本仓**零门禁**检查目录里 .sql 是否全被认领 ⇒ 需人工核 |

---

## 12. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-25 | 初版。三个定案（D-①/D-②/D-③）落定；`official-keys-postgres-migration` 改向为「扣减接线」；`compute-key-envelope-migration` 前提失效。 |
| 2026-10-25（**第 3 轮：第 2 轮对抗复评后**） | **新增 §13**：第 2 轮评审结论（**93** 条第 1 轮发现的回归验收 + 26 条实现符合性缺口 + 17 条新失效路径）⇒ **如实标注「本设计尚不可直接开工」**；**12 条阻断项**逐条列出并映射证据；跨轨分歧（调度器先例）裁决；单位口径全量改微元 + 新增 §3.3.1 跨库单位换算；身份链定为 `authSubject`；409 语义唯一化；幂等两处缺口；档位量纲 `modelTier + 1`；积分单价下限 10000；错误码补 3 个；引用断链修正；未决项新增 U-11…U-14（**四项须人工拍板**）。<br>⚠️ **第 1 轮发现的 93 条里真正修好的只有 17 条**（此前 PR 正文误写为「83 条逐条订正」—— **83 是算术错误，实为 93**）。 |
| 2026-10-25（第二轮对抗评审后） | **修正 21 处事实性错误 + 6 处跨文档矛盾 + 30 处设计缺陷**：扣分时序改**两段式**（发货前只读预检 + 发货后实扣）；`refId` 空值硬拒 400；`userId` 统一为 `identity_users.id`；错误码与既有 `CreditError.status`（409）对齐；响应体字段名改 camelCase；`tier_access` 改为整数等级码；生效价判据改 `effective_to` 空串；`007` 号源澄清为**已释放**；未决项增至 U-10（U-3/U-5 修正）。 |

---

## 13. 第 2 轮对抗复评结论与本设计的当前完成度（2026-10-25）

> ⚠️ **本节是本设计的真实状态说明。** 读 §0～§12 之前先读这一节。
> 本节由第 2 轮评审（3 条独立轨：回归验收 / 实现对账 / 对抗复评）在**本设计的已合并版本**
> `main @ 99701282` 上跑出的结果，以及 owner 对其中关键结论的**独立复核**。

### 13.1 结论

**本设计目前不可直接开工。**

| 来源 | 规模 | 结论 |
|---|---|---|
| 第 1 轮发现的**回归验收** | **93** 条第 1 轮发现（**不是 83** —— 83 是上一轮写进 PR 正文的**算术错误**） | 完全修好 **17** / 部分修 **24** / 未修 **49** / 原发现不成立 **1** / 被另一条线覆盖 **2** |
| **实现符合性对账** | **26** 条缺口（G-01…G-26） | 文档断言与主干真实实现不符（单位口径、列名、现成能力、跨文档一致性） |
| **对抗复评** | **17** 条新的可复现失效路径 | **8 CRITICAL / 8 MAJOR / 1 MAJOR-杂项** |
| 第 1 轮「设计对抗 30 条」的复验 | 30 条 | 完全修好 **2** / 部分修好 **5** / **修错 3** / 未修 **20** |

⇒ **上一轮声称的「逐条订正」实际只真正修好 17 条。** §0～§12 里凡标为「已修」的结论，
**只有 17 条经得起回源码复核**；其余是部分修、没修，或**被修错**。
⇒ **实施前必须先关闭 §13.2 的 12 条阻断项 + §11 的未决项。**

### 13.2 阻断项（照此实现会资损 / 白送 / 全站不可用）

| # | 阻断项 | 照此实现的后果 | 证据（文档侧 / 实现侧） | 状态 |
|---|---|---|---|---|
| **B-1** | **额度预检没有通道**：契约里只有 consume 一个端点；`getAccount` 无任何路由；`PostgresCreditRepository` **生产零实例化** | fail-closed 无落点：要么全站 409 拒绝（服务 100% 不可用），要么实现者自行发明一个**不在契约里**的读端点 | DESIGN §5.1 ⑤' / §3.3 ｜ `credit-repository.js:53`；`publish-api-server.js` 全文 `credit` **零命中** | ⛔ **待拍板 U-13** |
| **B-2** | **预检与实扣之间的竞态窗口 = 整个上游调用时长**；余额 100、单次 100、并发 10 ⇒ 上游计费 10 次、扣 1 次、其余永久白送，且 `CHECK (balance >= 0)` 使补扣**物理上不可能** | **无上限资损** | DESIGN §3.4 / §5.1 ｜ `credit-repository.js:294-302`（CAS 失败即抛 409）；`008_credit_ledger.sql:36` | ⛔ 需**设计级**决策（预扣 / 限流 / 接受风险） |
| **B-3** | **单位口径跨库不一致**：ops-center 侧全是**微元**，账本侧是**分**，设计文档通篇写「分」且引用了**仓内已列为 legacy 的旧列名** | 少扣 250 倍（白送 99.6%）／多扣 10000 倍（余额清零）／账本成本虚高 10000 倍；**都是正整数、都会入库 ⇒ 不报错** | DESIGN §0/§3.3/§5.1/§6.3 ｜ `models_credit.py:116/142/190`；`credit_price_service.py:11-12`；`seed_credit_price_cards.py:103-108`；`credit-schema.js:44` | ✅ **本轮已改**（§3.3.1 + §6.3 + §0/§5.1 口径统一）；⚠️ **账本列名是否也改微元 = U-11 待拍板** |
| **B-4** | **视频 / 图像 / TTS / ASR 的成本恒为 0**：`compute_cost_micros` 只遍历 token 五类 | 官方算力**主力场景每一次都白送**（`amount=0` 被拒 ⇒ 发货后才发现）；且 `has_missing_price` 为 False ⇒「缺价 ⇒ 拒绝服务」**不触发** | DESIGN §5.1 ⑧ / §6.3 ｜ `credit_price_service.py:47-53/112/142`；`credit-repository.js:259`；`model_price_cards.seed.json` 的 `_meta.rule`（「待确认只登记不入库」） | ⛔ **待拍板 U-12**（要定价数据） |
| **B-5** | **409 有两种终态**：§3.3 写「不发货」，§3.4 写「挂起补扣」——而扣分发生在**发货后** | 一种终态直接**抹掉债务**（上游成本已发生，系统内不可见） | DESIGN §3.3 错误表 / §3.4 / §5.1 ⑨ ｜ `credit-repository.js:169-171`（409 不写分录 ⇒ 账本零痕迹） | ✅ **本轮已改**（§3.3 错误表 409 行写死为「挂起补扣」；「不发货」只归 §5.1 ⑤' 预检） |
| **B-6** | **全仓 `grantCredit` 生产调用方 0** ⇒ 赠送量从未进入积分账户 ⇒ 余额恒 0 | 上线后**第一次扣分必然 409**；且「发放」在 PRD 前置 / tasks / spec 三处**都不是阻断项** | DESIGN §11 U-3 ｜ `credit-repository.js:73`；`usage-metering-spec.md:177` | ⛔ **阻断项本身已登记**，但**发放链路的落地不在本 change 范围** ⇒ 需决策 |
| **B-7** | **身份链三处互斥**：「必须是 `identity_users.id`」／「ops-center 侧校验它存在于 identity_users」／「引擎侧解析」 | 三条实现路线各自失败（FK 500 / 破 §3.1 / 契约字段名与实现不符） | DESIGN §3.3 / §6.1 ｜ `credit-repository.js:130-141`（仓储层**不做**任何身份解析）；`002_logto_identity.sql:7/16`；`business-identity.js:26/38`；`postgres-identity-repository.js:242-248` | ✅ **本轮已改**（wire 字段定为 `authSubject`＝Logto `sub`，**端点内** `findBySubject` 解析成 `identity_users.id`） |
| **B-8** | **扣分端点无身份绑定**：只禁了 `X-Catalog-Key` 与用户 Bearer 透传，**没禁 api_key**；且错误表无 401/403 | 任何持 `publish:submit` 的 api_key 可扣**任意** userId（越权扣分）；服务身份走 feature 门禁必然 403 ⇒ 落「挂起」⇒ 全量免费 | DESIGN §3.3 / §11 U-1 ｜ `publish-api-server.js:461-473`（POST 默认 scope）、`:475-483`、`:591-594`（注释原文：「未来 compute/官方算力路由是**新代码**，必须按评审 R7 显式 requireLogto」） | ⛔ **待拍板 U-1**（服务间鉴权 = 「谁来守门」级别） |
| **B-9** | **幂等键不含 `user_id`**；`refType` 可配 ⇒ DB 唯一索引（**部分索引**，只覆盖 `ref_type='usage_event'`）失效 | 显式传 `refType=''` ⇒ 并发重复扣分不再被 DB 拦；`refId` 串号 ⇒ 命中他人分录 | DESIGN §3.3 / §3.5 ｜ `credit-repository.js:145-149`（read-then-write，非原子）；`credit-schema.js:56-58` vs `:59-61` | ✅ **本轮已改**（`refType` 写死常量 + `refId` 必须全局唯一 + §3.5 补两道缺口） |
| **B-10** | **`pending_charge` 无补扣入口、无宿主、无终态**；仓内「回算/对账」能力（`credit_cost_backfill_service.py`）只读日聚合表、只写 `daily.cost`，**不碰事件表/账本、不发 HTTP** | 挂起 = **永久白送**；跨周期补扣时账户周期与分录周期错位 | DESIGN §3.4 / §7.5 ｜ `credit_cost_backfill_service.py:87-192`；`models_credit.py:166-193`（无 `pending_charge_at`/`retry_count` 列） | ⛔ **待拍板 U-14**（ops-center 侧实测**无**定时宿主） |
| **B-11** | **没有任何表/查询能回答「发了货有没有扣到钱」**：事件表**零生产写者**；`reconcileAccount` 只核余额↔账本；`client_reported_cost_micros` **全仓无写入方** | 资损**既不可发现也不可度量**；对拍恒空 ⇒ 恒真通过 | DESIGN §7.5 / §8.3 / §10.2 ｜ `models_credit.py:149`（仅类定义）；`credit-repository.js:222-253` | ✅ **本轮已改**（§6.3 / §7.5 / §13.2 如实标注「对拍列无写入方」「事件表有表无写方」） |
| **B-12** | **降级到更贵的通道 ⇒ 多扣，但文案说「省钱模式、本次消耗更低」**；spec 层还把规则窄化成只管「更便宜」 | 多扣 90 积分，且界面明说更便宜 | DESIGN §5.2 / §7.2 / §8.2 ｜ `models_credit.py:102-105`（价格卡唯一键含 `provider_id` ⇒ 同模型不同通道可不同价） | ⛔ 需改 spec 的 Requirement 表述（**改契约 = 须人工过目**） |

### 13.3 跨轨分歧的裁决（owner）

第 2 轮有**一处跨轨分歧**，两条轨各对一半：

| 争议 | 一轨的说法 | 另一轨的说法 | **裁决** |
|---|---|---|---|
| 仓内到底有没有调度器先例 | 「先例存在」：`packages/api-publish-engine/src/scheduled-publish.js:93` 的 `setTimeout` 递归定时器 | 「没有」：`ops-center/backend/requirements.txt` 无 APScheduler/celery/rq；`routers/scheduler.py` 是**发布调度器契约校验**（`scheduler_service.create_verification_run` / `contract_check`），不是定时宿主；`main.py` 只在启动时建表 + 挂路由 | **两边都对，但必须限定进程**：调度器先例**只在 Node 侧**；**ops-center（Python）侧实测为零**。⇒ 补扣任务要写 ops-center 的 SQLite ⇒ **Node 侧的先例不能直接用** ⇒ 宿主待定（**U-14**）<br>⇒ §7.5 与 §11 U-5 已按本裁决改写（原写法「仓内已有调度器先例」**未限定进程**，是错的） |

### 13.4 本轮（第 3 轮）已就地改掉的部分

| 类别 | 改了什么 |
|---|---|
| **单位口径** | §0 / §3.3 / §5.1 / §6.3 / §7.6 全部改为**微元**；新增 **§3.3.1 跨库单位换算**（源 `cost_micros` → wire `costCents`，÷10000 向上取整；并写明「绝不能用 costCents 反算 amount」） |
| **身份链** | wire 字段 `userId`（`identity_users.id`）改为 **`authSubject`（Logto `sub`）**，端点内解析（§3.3 / §6.1） |
| **409 语义** | 唯一化为「挂起补扣」；「不发货」只归发货前的额度预检（§3.3 错误表） |
| **幂等** | `refType` 写死常量 `'usage_event'`；`refId` 必须全局唯一；§3.5 补「查重不含 user_id」「查重非原子」两道缺口 |
| **档位量纲** | §6.2 补 `tier_access`（1-based）与 `modelTier`（0-based）的偏移规则 `user_tier = modelTier + 1` |
| **积分单价下限** | §6.3 补「兜底下限是 `CREDIT_UNIT_MICROS`(10000)，不是 1」 |
| **错误码** | 错误表补 `CREDIT_REF_INVALID` / `CREDIT_AUTH_INVALID`；§11 U-9 补 `CREDIT_USER_INVALID` |
| **引用断链** | §9.2 的赠送量来源由 `PRD-REMOVE-BUYOUT-AND-PRICING-2026-10-17.md`（实测零命中）改为 `usage-metering-spec.md` §4.1 |
| **现实能力标注** | §5.1 ①②⑤'⑥⑧ 与 §6.3 / §7.5 / §13.2 标出「**当前没有**」的地方（无读端点、无发放、无事件写方、非 token unit 无成本、对拍列无写入方、预估端点不存在） |

### 13.5 仍未修的部分（**登记在案，不装作已修**）

| 类别 | 规模 | 处置 |
|---|---|---|
| 第 1 轮 93 条发现中「未修 49 + 部分修 24」 | 73 条 | 本轮**未逐条改**；逐条状态与「改法」在第 2 轮评审台账里（仓外 `openspec/records/` 之外，尚未入库）⇒ **实施前须逐条过** |
| 第 1 轮「设计对抗 30 条」中未修 20 + 修错 3 | 23 条 | 同上；其中 3 条「修错」的已在 §13.2 映射为阻断项 |
| 实现符合性缺口 26 条 | 26 条 | 本轮改了与「单位口径 / 跨文档一致性 / 现实能力标注」相关的那部分；其余（现成能力盘点、错误码对账、迁移编号等）留在台账 |
| 对抗复评 17 条新发现 | 17 条 | 8 条 CRITICAL 全部进 §13.2；MAJOR 级别的 R2C-16（桌面端 `user_id` 不可实现）、R2C-17（周期口径两套）**本轮未改** |

> ⚠️ **不要把「本轮已改」当成「本设计已完工」。**
> §13.2 的 12 条阻断项是**开工的前置条件**；§13.5 的四类是**实施前须逐条过的台账**。
