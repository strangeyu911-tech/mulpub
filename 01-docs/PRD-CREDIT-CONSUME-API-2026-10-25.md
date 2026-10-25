# PRD：官方算力扣分端点 `POST /api/v1/credit/consume`（Phase 2 · 第 1 刀）

> **文档性质**：实现规格（PRD）。**契约的真源**——本文件描述的请求/响应/错误码/校验，
> 与仓内实现 `packages/api-publish-engine/src/auth/publish-api-credit-consume.js`
> **逐条对应**（每次改动都要同步本文件）。
> **落地形态定案**：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（D-①/D-②/D-③、§3.3 通道契约、§6.4 扣分校验、§13.2 阻断项）。
> **计量口径真源**：`01-docs/usage-metering-spec.md`（§3「单位一律用整数微元」）。
> **状态**：✅ 已实现（见 §7 验收标准与执行记录 `openspec/records/credit-phase2-wiring.md`）。

---

## 0. TL;DR

| 项 | 结论 |
|---|---|
| 端点 | `POST {businessApiUrl}/api/v1/credit/consume` |
| 调用方向 | **ops-center → api-publish-engine（单向）**；桌面端**不直接**调本端点 |
| 鉴权 | **服务间**：ops-center 持 Logto M2M token（`engine_admin_token`）⇒ engine 侧认 `authType === 'logto'` + scope `admin:users` |
| 幂等键 | `(ref_type='usage_event', ref_id=用量事件 id, entry_type='spend')`；`refType` 是**常量**、不可配 |
| 金额单位 | wire 上 `costCents` = **分**（账本侧口径）；供给侧 `cost_micros` = **微元**；换算 `ceil(cost_micros / 10000)` |
| 积分量 | `amount` = **积分**，由 ops-center 的 `credit_price_service.compute_credit_cost` 算好传入；**本端点不重算** |
| 失败语义 | **一律 fail-closed**：余额不足 409、缺凭据 403、仓储不可用 503、入参非法 400 |
| 本片不含 | 额度预检读端点 / 选 Key / 算成本 / 用量事件落库 / 积分发放 / 补扣调度 / 桌面端接线（见 §8） |

---

## 1. 背景与范围

### 1.1 为什么要这个端点

Mulpub 的官方算力链路目前**只差最后一根线**：供给侧（Key 池 / 价格卡 / 成本计算 / 用量归集）全在
ops-center，**账本侧**（积分账户 + 不可变账本）全在 api-publish-engine 的 Postgres。

定案 D-② 把两者的连接方式定为「**ops-center 算完成本后，一次 HTTP 调 engine 扣分**」
——不直连 Postgres、不建 key-broker（理由见定案 §3.1 / §3.2）。

本端点就是那根线的**服务端**。没有它，ops-center 算出来的成本**无处可扣**，
`identity_credit_ledger` 里永远不会出现 `entry_type='spend'` 的分录。

### 1.2 本片做什么 / 明确不做什么

| ✅ 本片做 | ⛔ 本片不做（及原因） |
|---|---|
| 扣分端点的**契约**（请求/响应/错误码/校验） | **额度预检读端点**（定案 §13.2 B-1）⇒ 端点形态属 U-13「须人工过目」（新增对外端点 = 改暴露面） |
| 端点的**服务端实现** + 单测 | **选 Key / 算成本 / 用量事件落库**（ops-center 3.1–3.6）⇒ 依赖 U-12（视频/图像价格卡待拍板）与事件表加列 |
| 端点的**服务间鉴权**（复用既有 M2M 通道） | **积分发放链路**（定案 §13.2 B-6）⇒ `grantCredit` 生产调用方为 0，发放语义依赖 #4454 的赠送量口径与会员周期发放策略 |
| 仓储层的**并发幂等**补齐（23505 → 幂等命中） | **挂起补扣与调度宿主**（定案 §13.2 B-10）⇒ U-14 待拍板（ops-center 侧实测无定时宿主） |
| ops-center 侧的**转发客户端**（含单位换算单一真源） | **预扣 / 竞态窗口**（定案 §13.2 B-2）⇒ 需设计级决策（预扣 / 限流 / 接受风险） |
| PRD / 设计文档状态 / 执行记录 / spec 同步 | **桌面端接线**（tasks 4.x）⇒ 依赖 ops-center 3.x 与读余额端点 |

> ⚠️ **「本片不做」不等于「不需要」**：本端点上线后，官方算力链路会**恒定走到
> `CREDIT_BALANCE_EXHAUSTED`（409）**——因为账户余额恒为 0（发放链路未落地）。
> 这是**刻意的 fail-closed**：宁可不服务，也不在发放缺失的情况下白送算力。

---

## 2. 端点契约

### 2.1 地址与方法

```
POST {businessApiUrl}/api/v1/credit/consume
Content-Type: application/json
Authorization: Bearer {engine_admin_token}   ← Logto M2M token（持 admin:users scope）
```

- 非 POST 方法**不被本端点处理** ⇒ 落通用 404（与仓内既有路由「方法不匹配就落空」的写法一致）。
- 请求体上限 1 MiB（沿用 engine 既有 `MAX_JSON_BODY_BYTES`）⇒ 超限 413 `BODY_TOO_LARGE`。

### 2.2 鉴权（服务间）

| 项 | 规则 |
|---|---|
| 凭据 | ops-center 侧 `settings.engine_admin_token`（Logto M2M token）——**复用**既有 `engine_admin_token`（与 `/api/v1/admin/member/grant` 同一套）⇒ **不新增部署配置面、不新增授权面** |
| engine 侧判定 | ① `_requiredScope` 对本 URL 返回 `admin:users`（**不得**落到 POST 默认的 `publish:submit`）② handler 内硬判 `req.auth.authType === 'logto'` |
| ⛔ api_key 一律拒绝 | 静态主密钥分支**不校验 `requiredScope`** ⇒ 放行 api_key 即「任何持 `publish:submit` 的 key 都能扣任意用户的积分」（定案 §13.2 B-8）⇒ handler 内硬判 `authType === 'logto'` 是**第二道防线** |
| ⛔ 不得透传用户 Bearer | ops-center 不是那个身份 |
| ⛔ 不查用户套餐/权益 | 扣分端点只负责「扣」，不负责「准不准用」；准入在 ops-center 侧 |

> **U-1 的结论**：服务间鉴权**复用既有机制**（Logto M2M token + `admin:users` scope），
> **不是新建守门机制** ⇒ 不需要「谁来守门」级别的人工过目。
> 依据：仓内既有先例 `ops-center/backend/services/member_grant_service.py`
> （`/admin/member/grant` 只认带 `admin:users` scope 的 logto 身份，静态主密钥被显式拒绝）。

### 2.3 请求体

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `authSubject` | string | ✅ | **目标用户的 Logto `sub`**（**不是** `identity_users.id`——后者是内部 UUID）。**端点内解析**：`findBySubject('logto', sub)` → `identity_users.id`（账本 FK 指向它）。ops-center **不查 Postgres**（守定案 §3.1） |
| `amount` | integer | ✅ | 扣减积分，**正整数**。`amount <= 0` ⇒ 400 `CREDIT_AMOUNT_INVALID`（`amount=0` 也非法：缺价 / 非 token 场景会算出 0） |
| `costCents` | integer | ✅ | 上游真实成本，**单位分**、**非负整数**。由 ops-center 按 `ceil(cost_micros / 10000)` 换算而来（§3.2） |
| `priceId` | string | — | 价目卡 id（版本化价格，禁 UPDATE）。缺省 `''` |
| `reason` | string | — | 人类可读原因（进账本 `reason` 列）。缺省 `''` |
| `refType` | string | — | **必须是常量 `'usage_event'`**（不可配、不可省；缺省时端点补齐）。⚠️ DB 唯一索引是**部分索引**，只覆盖 `ref_type='usage_event'` ⇒ 传别的值 ⇒ 并发重复扣分不再被 DB 拦（定案 §13.2 B-9） |
| `refId` | string | ✅ | **幂等键** = `model_usage_events.id`（**必须全局唯一**，建议 UUID）。⛔ **空值必须 400**（§3.1） |
| `periodStart` | ISO8601 | ✅ | 发放周期起 |
| `periodEnd` | ISO8601 | ✅ | 发放周期止（**必须 > `periodStart`**） |

### 2.4 响应体

| 字段 | 说明 |
|---|---|
| `account` | 扣后账户快照（**camelCase**）：`balance` / `grantedTotal` / `spentTotal` / `periodStart` / `periodEnd` |
| `entry` | 账本分录（**camelCase**）：`id` / `entryType` / `amount` / `balanceAfter` / `createdAt` |
| `duplicated` | `true` ⇒ 该 `refId` 已扣过，**本次未重复扣**（幂等命中） |

```jsonc
// 200
{
  "account": { "balance": 88, "grantedTotal": 200, "spentTotal": 12,
               "periodStart": "2026-10-01T00:00:00.000Z", "periodEnd": "2026-11-01T00:00:00.000Z" },
  "entry":   { "id": 42, "entryType": "spend", "amount": 12, "balanceAfter": 88, "createdAt": "..." },
  "duplicated": false
}
```

### 2.5 错误码表

| 码 | HTTP | 含义 | ops-center 的处置 |
|---|---|---|---|
| `CREDIT_AUTH_INVALID` | **403** | 服务间凭据缺失或无权调用（api_key 身份、非 logto 身份） | 挂起 + 告警（内部契约错误） |
| `CREDIT_USER_INVALID` | **400** | `authSubject` 缺失/超长，或端点内解析不出 `identity_users.id` | 挂起 + 告警（内部契约错误） |
| `CREDIT_REF_INVALID` | **400** | `refId` 为空 / 越界，或 `refType` 不是常量 `'usage_event'` | 挂起 + 告警（内部契约错误） |
| `CREDIT_AMOUNT_INVALID` | **400** | `amount` 非正整数；`costCents` 非负整数之外；**`amount>0` 但 `costCents===0`** | **不发货** + 告警 |
| `CREDIT_PERIOD_INVALID` | **400** | 周期边界缺失 / 非法 / `end <= start` | **不发货** + 告警 |
| `CREDIT_BALANCE_EXHAUSTED` | **409** | 余额不足（既有 `CreditError.status` 硬编码 409，**不是 402**） | ⚠️ **此处语义唯一**：扣分发生在**发货后** ⇒ 409 ⇒ **挂起该用量事件**（`pending_charge`）+ 告警 ⇒ **不是**「不发货」（发货前的余额拦截由额度预检负责） |
| `CREDIT_SERVICE_UNAVAILABLE` | **503** | 扣分服务不可用（仓储未装配 / 身份仓储不可用 / DB 异常） | 挂起 + 告警（重试上限内重试） |
| `INVALID_JSON_BODY` / `BODY_TOO_LARGE` | 400 / 413 | 请求体解析失败 / 超限（engine 既有语义，透传） | 挂起 + 告警 |
| 未知 | **500** | 内部错误（不伪装成业务码） | 不发货，重试上限内重试；超限 ⇒ 挂起 + 告警 |

> ⚠️ **错误码的来源**：上表 7 个 `CREDIT_*` 码中，`CREDIT_AUTH_INVALID` / `CREDIT_USER_INVALID` /
> `CREDIT_REF_INVALID` / `CREDIT_AMOUNT_INVALID` / `CREDIT_PERIOD_INVALID` / `CREDIT_SERVICE_UNAVAILABLE`
> **仓内原本不存在**（`grep` 零命中）⇒ 本片新增（定案 §11 U-9）。
> `CREDIT_BALANCE_EXHAUSTED` 是既有码（`credit-repository.js` 的 `CreditError`）。
> **本片不新增第 8 个码**：body 不是对象时归 `CREDIT_USER_INVALID`（连要扣谁都不知道时，
> 其余字段的报错没有意义）⇒ 错误码集合与定案 §3.3 **完全一致**。

---

## 3. 数据校验清单

### 3.1 入参校验（端点入口，逐字段）

| # | 字段 | 校验 | 失败码 | 备注 |
|---|---|---|---|---|
| 1 | body | 必须是**对象**（非 null / 非数组） | `CREDIT_USER_INVALID` | body 不是对象 ⇒ 目标用户必然缺失 ⇒ 归最根本的一类 |
| 2 | `authSubject` | string、trim 后非空、长度 ≤ 128 | `CREDIT_USER_INVALID` | 端点内再解析成 `identity_users.id`；解析不到 ⇒ 同一码 |
| 3 | `refId` | string、trim 后非空、长度 ≤ 128 | `CREDIT_REF_INVALID` | ⛔ **空值必须拒**：既有 `consumeCredit` 无 `refId` 守卫 ⇒ `refId=''` 与**任何**一次空 refId 的扣分共用查重键 ⇒ 第二次起静默「已扣」但实际不扣 ⇒ **静默免费算力** |
| 4 | `refType` | 缺省/null ⇒ 补 `'usage_event'`；给了但 ≠ `'usage_event'` ⇒ 拒 | `CREDIT_REF_INVALID` | **常量，不可配** |
| 5 | `amount` | **正整数**（`Number.isInteger` 且 > 0） | `CREDIT_AMOUNT_INVALID` | `amount=0` 也非法 |
| 6 | `costCents` | **非负整数** | `CREDIT_AMOUNT_INVALID` | 与 `amount` 共用「要算的数」这一类码 |
| 7 | `amount` + `costCents` 组合 | `amount > 0` ⇒ `costCents ≥ 1` | `CREDIT_AMOUNT_INVALID` | ⛔ **扣了分却把账本成本记成 0 ⇒ 审计痕迹缺失**（「记 0 等于静默免费」，定案 §3.3.1）。正确的 ops-center 公式下 `amount>0 ⇒ cost_micros>0 ⇒ ceil 后 ≥1` ⇒ 该组合**不可达** ⇒ 命中即说明调用方算错了 ⇒ 拒（fail-closed） |
| 8 | `periodStart` / `periodEnd` | 均为 string、可解析为日期、**`end > start`** | `CREDIT_PERIOD_INVALID` | 边界相等也拒（`end <= start`） |

**判定顺序**（先命中先返回）：`body` → `authSubject` → `refId` → `refType` → `amount` → `costCents` → `period`。
理由：连要扣谁都不知道时，其余字段的报错没有意义。

**判定实现位置**：**端点入口**（`validateCreditConsumeBody`，纯函数）。
⛔ **不得依赖仓储层**——`consumeCredit` 抛的是 `TypeError`（无 HTTP 状态），且 `refId` 根本没有守卫。

### 3.2 跨库单位换算校验

| 侧 | 库 | 列 / 字段 | 单位 |
|---|---|---|---|
| 供给侧（算成本） | ops-center / SQLite | `model_usage_events.cost_micros` | **微元** |
| 供给侧（单价） | ops-center / SQLite | `model_price_cards.unit_price_micros` | **微元**/unit |
| 供给侧（积分单价） | ops-center / SQLite | `credit_price_config.credit_unit_price_micros` | **微元**/积分（默认 `CREDIT_UNIT_MICROS = 10000`） |
| 供给侧（算积分） | ops-center / Python | `compute_credit_cost(cost_micros, credit_unit_price_micros, multiplier)` | **积分**（ceil） |
| **账本侧（记成本）** | api-publish-engine / Postgres | `identity_credit_ledger.cost_cents` | **分** |
| **账本侧（入参）** | api-publish-engine / JS | `consumeCredit({ costCents })` | **分**（非负整数） |

**换算规则（本 PRD 定案）**

```
① 积分量 amount    = ceil(cost_micros × multiplier / credit_unit_price_micros)   ← ops-center 侧算，**权威**
② wire costCents   = ceil(cost_micros / 10000)                                   ← 微元 → 分
```

- ② 的**向上取整**是刻意的：账本成本列是**审计与对账依据**，记 0 等于「静默免费」、记低等于系统性偏低 ⇒ **宁可略高，不可记 0**。
- ⛔ **① 与 ② 不是同一个量**：② 只给账本留审计痕迹，**绝不能用 ② 反算 ①** ⇒ 反算会在单位混用时放大 10000 倍。
- ⛔ **换算收在 ops-center 客户端的单一真源函数** `micros_to_cents()`：两个库单位不同而**公式本身不会算错**
  （微元 ÷ 微元/积分 = 积分，比值对）⇒ 缺陷不会在测试里暴露；只有**命名**会骗人 ⇒ 实现者会自作主张再换算一次
  ⇒ 金额差 10000 倍，且两处都是正整数、都会入库 ⇒ **不报错、静默错账**。
  ⇒ 客户端**不接受**「已经是分」的入参 ⇒ 调用方**无法**绕过。

### 3.3 仓储层校验（沿用既有实现）

| 校验 | 实现位置 | 失败 |
|---|---|---|
| 账户存在 | ⛔ **不建账户**：`ensureAccount` **不在扣分路径上**（它 upsert 建零余额账户、从不返回 400）⇒ 账户不存在 ⇒ 扣不动 ⇒ 409 | 409 `CREDIT_BALANCE_EXHAUSTED` |
| `amount` 正整数 | `_assertGrant` | `TypeError`（端点入口已拦，不会到这里） |
| 余额充足 + 并发安全 | `_applyBalance` 带 `balance >= amount` 的原子 CAS | 409 `CREDIT_BALANCE_EXHAUSTED` |
| 余额非负 | `CHECK (balance >= 0)` | 触发即回滚（最后一道防线） |
| 分录类型白名单 | `CHECK (entry_type IN (...))` | 触发即回滚 |
| 幂等 | `(ref_type, ref_id, entry_type='spend')` 查重 | 返回 `duplicated: true` |
| **并发唯一冲突** | `uq_identity_credit_ledger_spend`（部分索引） | 23505 ⇒ **翻译成幂等命中**（本片新增） |

### 3.4 审计

| 项 | 值 |
|---|---|
| 触发 | 每次扣分成功（含幂等命中） |
| `ownerSubject` | **目标用户的 `authSubject`**（⇒ 出现在用户的算力明细里） |
| `type` | `credit_consume` |
| `title` | `消耗 {amount} 积分` |
| `status` | `success` / `duplicated` |
| `details` | `callerSubject`（M2M 主体）/ `amount` / `costCents` / `priceId` / `refType` / `refId` / `periodStart` / `periodEnd` / `duplicated` |

> ⚠️ 业务字段装在 `details` 里：`AuditLog.log` 只认固定字段表，直接传 `amount`/`refId` 会被**静默丢弃**。
> ⚠️ 审计写失败**不**反过来让扣分失败（分录已入账；审计是留痕，不是账务）⇒ 记 `CREDIT_AUDIT_LOG_FAILED` 错误日志。

---

## 4. 端到端流程

### 4.1 正常路径（本片覆盖到的部分）

```
ops-center（官方算力链路）
  │  算出 cost_micros（微元）与 amount（积分）
  │  micros_to_cents(cost_micros) ⇒ costCents（分，向上取整）
  │  refId = model_usage_events.id（UUID，全局唯一）
  ├─► POST {businessApiUrl}/api/v1/credit/consume
  │     Authorization: Bearer {engine_admin_token}（M2M）
  │     body: { authSubject, amount, costCents, priceId, reason, refType:'usage_event', refId, periodStart, periodEnd }
  │
  │   api-publish-engine
  │     ① 鉴权：_requiredScope ⇒ admin:users；handler 硬判 authType==='logto'
  │     ② 入参校验（§3.1，入口）
  │     ③ authSubject → findBySubject('logto', sub) → identity_users.id
  │     ④ consumeCredit{userId, amount, costCents, refType, refId, periodStart, periodEnd}
  │          查重 → 命中 ⇒ duplicated:true（不重复扣）
  │          未命中 ⇒ UPDATE ... WHERE balance >= amount（原子 CAS）
  │                     扣不动 ⇒ 409 CREDIT_BALANCE_EXHAUSTED（不写分录）
  │                     扣得动 ⇒ INSERT 分录 ⇒ COMMIT
  │                     并发同 refId ⇒ 23505 ⇒ ROLLBACK ⇒ 翻译成幂等命中
  │     ⑤ 审计（details 带业务字段）
  │     ⑥ 200 { account, entry, duplicated }
  │
  ├─► ops-center：events.status = 'charged'
```

### 4.2 失败矩阵（本端点这一段）

| 失败点 | 上游是否已调 | 是否扣分 | 是否产生用量事件 | ops-center 处置 |
|---|---|---|---|---|
| 鉴权失败（403） | 否 | 否 | 否 | 挂起 + 告警（内部契约错误） |
| 入参非法（400） | 否 | 否 | 否 | **不发货** + 告警（内部契约错误） |
| 目标用户解析不到（400） | 否 | 否 | 否 | 挂起 + 告警（内部契约错误） |
| 扣分服务不可用（503） | **可能已调** | 否 | 是 | 挂起 + 告警（重试上限内重试） |
| 余额不足（409） | **可能已调** | 否 | 是 | **挂起 `pending_charge`** + 告警 ⇒ **不谎报已扣** |
| 未知内部错误（500） | **可能已调** | 否 | 是 | 重试上限内重试；超限 ⇒ 挂起 + 告警 |

> ⚠️ **「已产出但扣分失败」不允许自动退款**：成本已真实发生（上游已计费）⇒ 正确处置是**补扣**而非退款
> ⇒ 要求用量事件有 `pending_charge` 状态与对账入口（**本片不含**，归 U-14）。

### 4.3 幂等与并发时序

| 场景 | 现象 | 本片的处置 |
|---|---|---|
| 同一 `refId` **串行**重试 | 第二次查重命中 | 返回 `duplicated: true`，**不重复扣** |
| 同一 `refId` **并发** | 两道请求的查重**都未命中**（read-then-write 非原子）⇒ 都走到 INSERT ⇒ 一道撞 `uq_identity_credit_ledger_spend` | 23505 ⇒ **翻译成幂等命中**（`duplicated: true`）；**冲突方的余额扣减随事务回滚** ⇒ 只扣一次、只留一条分录 |
| 撞的**不是** spend 索引 | 别的唯一约束冲突 | **原样抛出**（不得吞成幂等命中）⇒ 500 |
| `refId` 跨用户撞号 | 查重**不含 `user_id`** ⇒ 命中他人分录 | ⛔ 靠约定防：`refId` 必须**全局唯一**（建议 UUID）⇒ 本片不强制（DB 无此约束） |

---

## 5. 功能逻辑

### 5.1 计费边界

- **只有「生成」扣积分，「操作」不扣**（沿用既有决策）。
- 判据 = **上游是否真的返回有效产出**，不是用户点没点取消。
- 失败 / 超时 / 空产出 ⇒ **不扣**。
- ⚠️ **但「上游超时」不等于「上游没计费」**：上游可能已计费但响应没回来 ⇒ 本设计**无法从客户端侧区分**
  ⇒ ⛔ **无供应商账单对拍通道 ⇒ 该类成本不可观测、不可追回**（U-16，不在本仓能力范围）
  ⇒ 运营侧**不能假设「不扣 = 没花钱」**。

### 5.2 幂等语义

- 幂等键 = `(ref_type='usage_event', ref_id, entry_type='spend')`。
- `refId` = `model_usage_events.id`（ops-center 侧生成，**必须 UUID**）。
- ⛔ **前置**：ops-center 侧 `model_usage_events.id` 必须在**调上游之前**就生成并落库
  （否则上游已计费但事件未落 ⇒ 重试会生成新 id ⇒ 重复扣分）。
  **本片不含事件落库**（归 ops-center 3.4）⇒ 本片的幂等保证以「调用方已按此约定生成 `refId`」为前提。

### 5.3 并发语义

- 余额扣减用 `UPDATE ... WHERE balance >= amount`（原子 CAS）⇒ 并发下只有一个能扣成功，另一个拿到 0 行 ⇒ 409。
- **扣减与写分录必须在同一事务内** ⇒ 不会出现「余额扣了但分录没写」或「分录写了但余额没扣」。
- 并发同 `refId` 的重复扣分由 DB 部分唯一索引兜住（仓储层查重非原子）⇒ 23505 翻译成幂等命中。

### 5.4 身份链

| 环节 | 值 |
|---|---|
| wire 字段 | `authSubject` = **Logto `sub`**（= `auth_subject.auth_subject`） |
| 解析位置 | **端点内**（`findBySubject('logto', sub)` → `identity_users.id`）——账本 FK 指向 `identity_users.id` |
| ops-center 侧 | **不查 Postgres**、不认识 `identity_users`（守定案 §3.1） |
| 调用方身份 | M2M（`req.auth.subject` = M2M 客户端 id）⇒ **只进审计 `details.callerSubject`** |

> ⚠️ **已知遗留（沿用既有行为，本片不改）**：`_ensureRequestIdentity` 会对**任何 logto 主体**
> （含 M2M 服务账号）走一遍 `ensureBusinessUser` ⇒ 服务账号在 `identity_users` 里会有一行。
> 既有 `/api/v1/admin/member/grant` 是**同样的行为** ⇒ 本片沿用，不改（改它要动共享的鉴权路径）。

### 5.5 单位口径

见 §3.2。**本端点不重算 `amount`、不反算、不换算**——它只负责「按给定金额扣」。

### 5.6 fail-closed 原则

> **宁可少赚，不可白送算力。**

| 场景 | 处置 |
|---|---|
| 仓储未装配 / 身份仓储不可用 | **503**（不"先扣了再说"） |
| 鉴权不通过 | **403**（不放行任何 api_key） |
| 入参非法 | **400**（不放行半缺字段的请求） |
| 余额不足 | **409**（不写分录；由 ops-center 挂起补扣） |
| 未知内部错误 | **500**（不伪装成业务码） |

### 5.7 可观测性

| 能回答的问题 | 靠什么 |
|---|---|
| 这笔扣了多少、扣给谁 | `identity_credit_ledger` 分录（`entry_type='spend'`） |
| 幂等键是什么 | 分录的 `ref_type` / `ref_id` |
| 真实成本多少 | 分录的 `price_id` / `cost_cents`（**分**） |
| 谁发起的扣分 | 审计 `details.callerSubject`（M2M 主体） |
| 余额对不对 | `reconcileAccount(userId)`（账本汇总 vs 账户物化列） |

⛔ **本片回答不了**：「官方算力这条链路发了货有没有扣到钱」——
因为 `model_usage_events` **当前零生产写者**（归本片之外的 ops-center 3.4）⇒ 对拍恒空 ⇒ 恒真通过（定案 §13.2 B-11）。

---

## 6. 交互逻辑 / 显示项 / 提示文字

### 6.1 ops-center 侧（本片的调用方）

| 交互 | 规则 |
|---|---|
| 何时调 | **发货后**（上游已返回有效产出）⇒ 扣分失败不回滚产出，改走挂起 |
| 重试 | 客户端**不重试**（引擎侧已幂等）⇒ 人工/定时重试须**复用同一个 `refId`** |
| 409 的处置 | 置 `pending_charge` + 告警 ⇒ **不向用户收钱但记账**（成本已真实发生） |
| 5xx 的处置 | 重试 ≤ 3 次（指数退避）⇒ 仍失败 ⇒ `pending_charge` + 告警 |
| 4xx 的处置 | **内部契约错误** ⇒ 不重试、不发货、告警（修代码，不是重试能解决的） |
| `refId` 的生成 | **调上游之前**生成（UUID、全局唯一）⇒ 重试复用同一个 |

### 6.2 桌面端显示项（本片**不能**提供什么）

| 位置 | 显示项 | 数据来源 | 本片状态 |
|---|---|---|---|
| 会员中心「我的算力」卡 | 剩余积分 | `account.balance` | ⛔ **无读通道**（`getAccount` 无路由）⇒ **显示「—」**，不显示 0（0 会被读成「余额被清零」而不是「读不到」） |
| 同上 | 本月剩余天数 | `account.periodEnd` − 今天 | ⛔ 同上（读端点属 U-13） |
| 同上 | 约可生成 | 档位等效单价 | ⛔ **「档位等效单价」仓内无实现、无数据源**（`officialCreditMonthly` 是**总量**不是单价）⇒ **不显示**（不猜数） |
| 生成前确认弹窗 | 本次预计消耗 | 档位等效单价 × 规格 | ⛔ 同上 ⇒ **显示「—」** |
| 生成完成 | 本次实际消耗 | `entry.amount` | ⛔ **本片只回给 ops-center**；桌面端要经 ops-center 透传 ⇒ 归 tasks 4.x |

> ⛔ **本片刻意不做桌面端改动**：显示项依赖读余额端点（U-13）与档位单价口径（不在本仓），
> 提前接会产出「恒为 0 / 恒为「—」」的假数据。

### 6.3 提示文字（zh / en **必须成对**）

> 本端点是**服务间**调用，**自身不产生用户可见文案**。
> 下表是**本端点的错误码 ⇒ 桌面端最终文案**的映射（文案真源在定案 §8.2；本片只保证错误码语义与之对齐）。

| 本端点错误码 | 桌面端场景 | 中文 | English |
|---|---|---|---|
| `CREDIT_BALANCE_EXHAUSTED`（409） | 额度预检判余额不足（**上游未被调用**） | `积分不足，当前剩余 {balance} 积分。本次需要 {required} 积分。` | `Not enough credits. You have {balance}, this request needs {required}.` |
| `CREDIT_BALANCE_EXHAUSTED`（409） | **发货后**实扣失败 ⇒ 已挂起 | `生成成功，积分结算中，稍后可在算力明细中查看。` | `Done. Credits are being settled; you can check the details later.` |
| `CREDIT_SERVICE_UNAVAILABLE`（503） | 扣分服务挂 + **已产生用量** | `服务暂不可用，本次用量已记录，积分将在恢复后补扣。` | `Service temporarily unavailable. This usage was recorded; credits will be charged once the service recovers.` |
| `CREDIT_SERVICE_UNAVAILABLE`（503） | 扣分服务挂 + **未产生用量** | `服务暂不可用，本次未产生用量，也未扣除积分，请稍后重试。` | `Service temporarily unavailable. No usage was recorded and no credits were charged; please retry later.` |
| `CREDIT_AMOUNT_INVALID` / `CREDIT_REF_INVALID` / `CREDIT_USER_INVALID` / `CREDIT_PERIOD_INVALID`（400） | **内部契约错误**（不该发生） | `服务暂不可用，本次未产生用量，也未扣除积分，请稍后重试。` | `Service temporarily unavailable. No usage was recorded and no credits were charged; please retry later.` |
| `CREDIT_AUTH_INVALID`（403） | **内部契约错误**（不该发生） | 同上 | 同上 |

**文案纪律**（沿用定案 §8.2，本端点不新增）：
- ⛔ **不许承诺结算时限**（「约 {seconds} 秒内完成」承诺了一个尚不存在的调度宿主 ⇒ U-14 关闭前一律不许出现具体秒数）。
- ⛔ **不许在扣分未成功时显示「已扣除」**。
- ⛔ **失败文案必须明示「本次未扣除积分」**。
- ⛔ **「已记录本次用量」必须区分「已产生用量」与「未产生用量」**。

---

## 7. 验收标准

### 7.1 端点（可机械判）

| # | 验收 | 判据 |
|---|---|---|
| A-1 | M2M 服务凭据 + 合法入参 ⇒ 200，响应体含 `account`/`entry`/`duplicated` | `credit-consume-api.test.js` |
| A-2 | **api_key 身份被拒** ⇒ 403 `CREDIT_AUTH_INVALID`，且**不得触达仓储** | 同上 |
| A-3 | 仓储未装配 ⇒ 503 `CREDIT_SERVICE_UNAVAILABLE` | 同上 |
| A-4 | 入参非法（`refId` 空 / `amount=0` / `period` 非法）⇒ 400 且错误码对应，**不得触达仓储** | 同上 |
| A-5 | 目标用户解析不到 ⇒ 400 `CREDIT_USER_INVALID` | 同上 |
| A-6 | 余额不足 ⇒ 409 `CREDIT_BALANCE_EXHAUSTED` | 同上 |
| A-7 | 幂等命中 ⇒ 200 且 `duplicated: true` | 同上 |
| A-8 | 扣分留审计，业务字段在 `details` 里 | 同上 |
| A-9 | 非 POST 方法不被本端点处理（落通用 404） | 同上 |
| A-10 | **并发同 `refId`** ⇒ 23505 被翻译成幂等命中，**余额只扣一次、只留一条分录** | 同上 |
| A-11 | 非 spend 索引的唯一冲突**不被吞成幂等命中** | 同上 |
| A-12 | 余额不足 ⇒ 不写分录、余额不变 | 同上 |

### 7.2 ops-center 客户端

| # | 验收 | 判据 |
|---|---|---|
| B-1 | `micros_to_cents` **向上取整**（0→0、1→1、9999→1、10000→1、10001→2、25000→3） | `test_credit_consume_service.py` |
| B-2 | 非法 `cost_micros`（负数/小数/字符串/None/bool）⇒ `ValueError` | 同上 |
| B-3 | 端点未配置 ⇒ 503 `ENGINE_ADMIN_NOT_CONFIGURED` | 同上 |
| B-4 | **空 `refId` 入口就拒** ⇒ 400 `CREDIT_REF_INVALID`，且**不发出请求** | 同上 |
| B-5 | 成功路径：请求体形状（`costCents` 已是分、`refType` 常量、Bearer 是 M2M token、客户端已关闭） | 同上 |
| B-6 | engine 拒收 ⇒ 透传状态与错误码 | 同上 |
| B-7 | engine 返回非 JSON ⇒ 退化为 `ENGINE_ADMIN_ERROR` | 同上 |
| B-8 | 网络不可达 ⇒ 502 `ENGINE_ADMIN_UNREACHABLE`，且客户端已关闭 | 同上 |

### 7.3 变异验证

11 组变异（端点鉴权 / `refId` 空值 / `refType` 常量 / `amount=0` / `costCents=0` /
身份解析 / 23505 翻译 / 非 spend 吞错 / 单位换算 / `refType` 常量（客户端）/ 空 `refId`（客户端））
⇒ **全部 CAUGHT**（执行记录落表）。

---

## 8. 遗留与未决（如实登记）

| # | 项 | 归属 | 影响 |
|---|---|---|---|
| L-1 | **额度预检读端点**（B-1 / U-13） | 须人工过目（新增对外端点 = 改暴露面） | fail-closed 的落点不存在 ⇒ 扣分只能靠 409 |
| L-2 | **预扣 / 竞态窗口**（B-2） | 需设计级决策 | 预检与实扣之间隔着整个上游调用时长 |
| L-3 | **视频/图像/TTS/ASR 成本恒为 0**（B-4 / U-12） | 须人工拍板（要定价数据） | 官方算力主力场景每次都白送 |
| L-4 | **积分发放链路**（B-6） | 赠送量口径**已定**（#4454 已合并：standard **1500** / pro **3000**，年付 ¥590/¥1190）⇒ 剩「**发放链路本身**（订阅生效 / 兑换码核销 / 运营补发）+ 会员周期发放策略」两项 | 本端点上线后余额恒 0 ⇒ 恒 409（**fail-closed，不白送**） |
| L-5 | **挂起补扣与调度宿主**（B-10 / U-14） | 须人工拍板（三选一） | 挂起 = 永久白送 |
| L-6 | **用量事件表零生产写者**（B-11） | ops-center 3.4 | 对拍恒空 ⇒ 恒真通过；「发货有没有扣到钱」不可观测 |
| L-7 | **降级到更贵却说省钱**（B-12） | 改契约 ⇒ 须人工过目 | 多扣且界面明说更便宜 |
| L-8 | **账本列名是否也改微元**（U-11） | 须人工过目（改已应用迁移 ⇒ checksum 变更 ⇒ 破坏性） | 本片按 `cost_cents`（分）+ §3.2 换算实现 |
| L-9 | **D-③ 账户模型（双轨 + `expires_at`）**（U-6） | 独立 change + 独立评审（改主键 = 破坏性） | 阻塞「会员额度日释放 + 充值积分永久有效 + FIFO 过期扣减」三条产品能力 |
| L-10 | **服务账号在 `identity_users` 里有一行** | 沿用既有行为（`/admin/member/grant` 同款） | 需改共享鉴权路径 ⇒ 本片不改 |
| L-11 | **refId 跨用户撞号** | 靠约定（全局唯一）防；DB 无此约束 | 撞号会命中他人分录（既有实现的已知缺口） |
| L-12 | **供应商账单对拍通道缺失**（U-16） | 需运营方协调 | 超时类成本不可观测、不可追回 |
