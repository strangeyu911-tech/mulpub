# 激活码兑换 · 整体方案（PRD）

> 版本：v2（2026-10-24，v2 = 三个决策定案 + 首轮实施落地）
> 本文件是 `openspec/records/redeem-code-issued-to.md` 那次实施的设计依据。
> 范围：桌面应用端兑换 + 运营中心签发与管理 + 安全设计
> 仓库：`Colinchiu007/mulpub`（基线 `main`，2026-10-24）
> 事实来源：本文所有"现状"条目均来自**本轮逐行读取源码**核实，标注 `文件:行号`。
> 标注「文档称」的条目来自 `01-docs/`，已与代码交叉验证。
> **已做独立核查**（10 条关键断言 + 反向抽查），核查记录与自查出的 2 处自身错误见 §12。

---

## 0. 结论摘要（先看这个）

**1. 这个功能 90% 已经存在，不要重做。** 服务端核销/签发/列表/吊销、运营中心兑换码管理页、桌面端会员中心兑换卡——全部已实现并已合并上线。本轮的真正工作是**补齐语义化与安全加固**，不是从零搭。

**2. "激活码需要加密解密"这个需求，前提是错的，落地会是安全倒退。** 详见 §3。简短版本：

> 激活码的安全**不来自密码学，来自"码里没有任何信息"**。
> 一旦把「档位 + 时长」加密进码里（做成自解密载荷），就必须把解密密钥放进客户端 ⇒ 密钥可提取 ⇒ 可伪造 ⇒ 回到「任意串换永久 Pro」的老漏洞。
> **这个仓已经因为同一个错误栽过三次。**

**3. 真正还没做好的，按性价比排序：**

| 优先级 | 缺口 | 位置 |
|---|---|---|
| P0 | 运营侧「1 个月 / 3 个月」无预设（现在填裸天数，易填错） | ops 签发弹窗 |
| P0 | 运营侧套餐显示原始英文 `standard`/`pro` | `RedemptionCodes.vue:24,97` |
| P0 | 桌面端文案写「16 位激活码」，实际是 12 位（14 字符含连字符） | `zh.js:11` / `en.js:11` |
| P0 | 桌面端无本地格式前置校验，任意串打服务端 | `MemberCenter.vue:227-229` |
| P1 | 兑换**失败无针对性限流**（仓里有全局 IP 级限流器：**生产开着**（`MAX_RPM=100`）但不区分端点/成败，**且按 socket 分桶 ⇒ 生产拓扑下全站共用一个桶**） | engine 路由层 |
| P1 | 签发 / 吊销 / 手动开通**三类花钱动作无审计**（只有 reveal 有） | `publish-api-redeem-code-admin.js` |
| P1 | 签发结果无一键复制 / CSV 导出（200 个码没法交付） | ops 签发结果弹窗 |
| P2 | 无批次交付追踪（不知道这批卖出去多少） | 需新接口 |
| P2 | 码无"发放对象"字段，泄漏无从溯源 | 需新列 |
| P2 | 桌面端不显示"低档码被压制"的结果差异（**store 没透传该字段 + 视图没有分支，两层都要改**） | `stores/member.js:126-131` + `MemberCenter.vue:270-290` |

**3.5 三个决策已定案（2026-10-24，运营方拍板）**

| 决策 | 结论 | 本轮落地 |
|---|---|---|
| 档位显示名 | **沿用仓内命名**（标准版 / 专业版） | ✅ 运营中心前端加 `PLAN_LABELS` 显示映射；`plan` 值不变 |
| `issued_to`（发放对象） | **做** | ✅ 迁移 009 + 运行时 SCHEMA + 仓储 + 服务层 + 运营 API + ops 转发层 + 运营前端 |
| 限流严格程度 | **先上温和档** | ✅ 同一用户 60 秒内失败 ≥ 5 次 / 同一 IP 10 分钟内失败 ≥ 200 次 **或** 最近 60 秒内失败 ≥ 60 次 ⇒ 429 |


**4. 最重要的一条产品边界（先定死，否则后面全乱）：**

> **在线支付成功 → 服务端直接开通权益，不发码。**
> **激活码 → 只用于「线下/赠送/代运营/批量采购」等无即时支付通道的场景。**
>
> 两者共用同一个 `applySubscription()` 落账路径，但**码只服务"没有即时收款通道"的交易**。
> 理由：支付成功后再发一张码，等于凭空造出"码的库存、批次、发放、对账"四层复杂度，而收益是零。
> 现状代码已经这么做了（`subscription-payment.js:216` 回调直接调 `applySubscription`），本方案沿用。

---

## 1. 现状盘点（实测）

### 1.1 服务端 —— `packages/api-publish-engine`

| 能力 | 端点 | scope | 出处 |
|---|---|---|---|
| 核销 | `POST /api/v1/redeem` | `profile:write` | `publish-api-server.js:938,464` |
| 批量签发 | `POST /api/v1/admin/member/redeem-codes` | `admin:users` | `publish-api-server.js:1427` |
| 列表（默认掩码） | `GET /api/v1/admin/member/redeem-codes` | `admin:users` | `publish-api-server.js:1428` |
| 吊销 | `POST /api/v1/admin/member/redeem-codes/disable` | `admin:users` | `publish-api-server.js:1429` |
| 手动开通 | `POST /api/v1/admin/member/grant` | `admin:users` | `publish-api-server.js:1426` |
| 价目目录 | `GET /api/v1/plans` | `profile:read` | `publish-api-server.js:930,463` |

**鉴权边界（重要）**：`/api/v1/admin/member/*` 只认 `authType === "logto"` 的身份，
**拒绝静态主密钥**（`publish-api-redeem-code-admin.js:24`）。这一条要保住。

**码的生成**（`subscription-service.js:38-44`）：

```js
const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'   // :13  31 字符，排除 I/L/O/0/1
const REDEEM_CODE_PATTERN  = /^[...]{4}-[...]{4}-[...]{4}$/       // :14  4-4-4 = 12 字母
function generateRedeemCode() {                                    // :38
  const pick = () => Array.from({ length: 4 },
    () => REDEEM_CODE_ALPHABET[crypto.randomInt(REDEEM_CODE_ALPHABET.length)]).join('')
  return `${pick()}-${pick()}-${pick()}`
}
```

- 组合空间 = 31¹² ≈ **7.88 × 10¹⁷**
- 即使 10⁶ 次/秒穷举，也需约 **2.5 万年**
- 生成与校验的字母表**严格同型**（pattern 里的字符类 = 生成用的 31 字符，同一份常量）

**核销逻辑**（`subscription-service.js:259-318`）：

```
事务内：
  lockRedeemCode(code)        → SELECT ... FOR UPDATE          (postgres-commerce-store.js:61-67)
  status==='used'  → 同人则返回幂等视图，他人则 409
  status!=='active'→ 409 已停用
  expires_at 已过  → 410
  applySubscription({plan, durationDays, ...})                     (:88-169)
  markRedeemCodeUsed(code, userId)                                (:69-79)
  createNotification(...)                                         (:295-303)
```

**并发安全（双保险）**：
- 码维度：`FOR UPDATE` 行锁 + 条件更新 `WHERE status='active'`
- 用户维度：`pg_advisory_xact_lock(hashtextextended('sub:'+userId))`（`postgres-commerce-store.js:100`）
  —— 防止「两个不同的码同时兑给同一人时 `current_period_end` 读-改-写丢期」

**跨档续叠保护**（`postgres-commerce-store.js:112-116`）：
低档码只加时长、**不改档位**（`downgradeSuppressed=true`），高档码整期升级。
这是"用户已有 pro 期间兑一张 standard 码"不会把剩余 pro 期整体降级的保证。

**表结构**（`migrations/postgresql/004_member_commerce.sql:23-36`）：

```sql
CREATE TABLE identity_redeem_codes (
  code          TEXT PRIMARY KEY,
  plan          TEXT NOT NULL CHECK (plan IN ('standard','pro')),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),   -- 90 天然合法
  batch         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','disabled')),
  used_by       TEXT REFERENCES identity_users(id),
  used_at       TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,          -- 码的"使用截止日"（≠ 兑换后会员天数）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.2 运营中心 —— `ops-center/`

| 位置 | 内容 |
|---|---|
| `frontend/src/views/RedemptionCodes.vue` | 兑换码管理页：筛选 + 列表 + 签发弹窗 + 签发结果弹窗 + 作废 |
| `frontend/src/views/MemberGrants.vue` | 手动开通订阅 |
| `frontend/src/api/redemptionCodes.js` | API 转发封装 |
| `backend/services/redeem_batch_service.py` | **纯转发层**——ops 后端不生成、不存储任何兑换码 |
| `backend/services/member_grant_service.py` | 手动开通转发层 |

设计原则已写进代码注释（`RedemptionCodes.vue:5-7`）：
> 签发由服务端 `api-publish-engine` 统一落库（`identity_redeem_codes`），本页面只负责发起签发与展示结果——ops 后端不生成、不存储任何兑换码。

**这条原则要保住**：一旦 ops 也存一份码，就出现两个真源，吊销/对账必然漂移。

### 1.3 桌面端 —— `apps/desktop/`

| 位置 | 内容 |
|---|---|
| `src/views/MemberCenter.vue:118-148` | 兑换卡 UI（输入框 + 提交按钮 + 结果行） |
| `src/views/MemberCenter.vue:218-295` | 核销逻辑 + 三态结果（success / info / error） |
| `src/stores/member.js:120-133` | `redeemCode()`，返回 `idempotent` + `hasActiveSubscription` **两个独立字段** |
| `src/api/identity.js:35-39` | IPC 契约注释 |
| `electron/services/identity/member-api-service.js:25-27` | 路径白名单：**只放 POST**（放 GET 等于允许用 query 传码 → 进 access log 与浏览器历史） |
| `src/locales/member-center/zh.js:10-21` / `en.js` | 文案成对（Gate 7） |

**已处理好的语义**（这些不要动）：
- 三态区分：首次成功 / 幂等重放（订阅仍有效）/ 幂等重放（订阅已过期）
  —— 服务端在第三种情况返回 **HTTP 200 + `subscription: null`**，只判 `code===0` 会给用户发假承诺
- 未登录本地短路（`requireSubject: true`）
- IPC body 白名单只放 `code` 一个字段
- 兑换卡常驻订阅页上方，订单页空态 `navigate('redeem')` → 落到订阅页（`MemberCenter.vue:196-200`）

### 1.4 已被刻意删除的"本地加密"方案 —— 安全设计的历史证据

这一节是本文档最重要的论据来源。

| 被删的东西 | 为什么删 | 出处 |
|---|---|---|
| `license:activate` 本地激活通道 | `licenseManager.activate()` 只做 `trim()`，**任意非空串**（含 `"   "`）都能拿到 `type=pro` + `expiresAt=null` **永久** + 8 项全功能 | `apps/desktop/electron/services/license-manager.js:36-38`；`UpgradeModal.vue:54-62`；`stores/license.js:28-33` |
| 桌面端 HMAC 签发模块 `redemption-codes.js`（`MP-RAND-RAND-SIG`） | "签发得出来、兑不了"（正式包拒收兑换）⇒ 等于第二套权威，死代码 | `openspec/records/remove-dead-redemption-codes.md`（PR #3565, 2026-10-14） |
| 硬编码 HMAC 种子 `\|\| "mp-redemption-seed-v1"` | 密钥硬编码 ⇒ 任何人拿到包即可伪造 | `01-docs/decision-log.md:421` |

**三次事故，同一个根因：把「码 → 权益」的映射逻辑放进了本地。**

---

## 2. 术语与档位映射（动手前先定死）

| 你的说法 | 仓内档位 id | 仓内显示名 | 单价（`plan-matrix.js`） | 备注 |
|---|---|---|---|---|
| 基础会员 | `standard` | **标准版** | ¥59/月、¥499/年 | ⚠️ 与「免费版」易混 |
| 高级会员 | `pro` | **专业版** | ¥119/月、¥999/年 | |
| （无） | `free` | 免费版 | ¥0 | 不可签发（服务端拒 `free`） |
| 1 个月 | — | — | — | ⇒ `duration_days = 30` |
| 3 个月 | — | — | — | ⇒ `duration_days = 90` |

**⚠️ 术语冲突警告**：仓内「基础」一词已被占用且含义相反——
`modelTier: 0` 叫「基础模型层级」，`free` 档叫「免费版」。
`standard` 是**付费中间档**，不是「基础档」。

**建议**：代码/接口/表里继续用 `standard` / `pro`（不动，避免污染既有契约与迁移），
**只在 UI 文案层**做映射，并且**展示为仓内既有的「标准版/专业版」**——
因为 `plan-matrix.js:62,83` 的 `label` 已经是「标准版」「专业版」，
会员中心的购买区用的也是这套（`Subscription.vue:79-82`）。
若强行改成「基础/高级」，同一产品里会出现两套档位名，客服和用户都会混。

> **决策项（需你拍板）**：UI 显示"标准版/专业版"（与既有购买区一致）
> 还是"基础会员/高级会员"（与你的渠道话术一致）？
> 我的建议是**前者**，理由是同一产品内档位名必须唯一；渠道话术可以在营销物料里另行映射。

**时长语义**（`duration_days`）：30 天 = 1 个月，90 天 = 3 个月。
注意这是**按天计**，不是"自然月"——3 个月码 = 90 天，不保证对齐到同一个日号。
这一点在运营签发时必须写进提示文案（当前 ops 页面已提示"按天计"，✅）。

---

## 3. 核心架构判断：为什么**不要**给激活码加"加密解密"

这是本次需求里最需要先说清楚的一点，因为**照着做会引入漏洞**。

### 3.1 你的需求里隐含了一个假设

> "激活码的生成和检验，需要实现加密和解密。要从安全性考虑，如何防止破解本地算法。"

这句话隐含：**激活码应当是一段自解释的密文**，里面装着「档位 + 时长」，用密钥解密出来就知道该给什么权益。

### 3.2 这个假设正是历史漏洞的根源

| 时间 | 做法 | 后果 |
|---|---|---|
| 2026-10-07 前 | 本地 `activate(key)` 里写死"码 → pro 永久" | 任意非空串换永久 Pro。**修法是把整条本地路径删掉**，不是"把算法加密得更强" |
| 2026-10-14 前 | 本地 HMAC 签发 + 验签（`MP-RAND-RAND-SIG`） | 密钥在客户端 ⇒ 可提取 ⇒ 可伪造。**修法是删掉整个模块** |
| v2.3.43 | HMAC 种子硬编码在源码里 | 拿到包即可造码。**修法是改成 `\|\| ''`，让签名功能直接失效** |

三次的共同点：**只要"码 → 权益"的映射存在于本地，本地就是攻击面**。
给映射加密码，只是把"读代码就能看懂"变成"读代码+逆向密钥"——**门槛提高了，但门还在**。
而删掉本地映射，门就没了。

### 3.3 正解：码 = 无信息的随机 token，权益 = 服务端的一行状态

```
激活码  = 31 字符字母表上随机取 12 位（不加密、不签名、不含任何权益信息）
          ↓  只是一把「查表的钥匙」
服务端 DB = identity_redeem_codes 的一行：
          plan(standard|pro) + duration_days + status + used_by + ...
          ↓
权益 = 服务端根据这行状态计算并落库（entitlement 快照）
```

这个结构下：
- **客户端没有任何"码 → 权益"的算法** ⇒ 没有"本地算法"可破解
- 攻击者改客户端、改本地缓存、改常量，**一分钱权益都开不出来**（因为权益写库发生在服务端）
- 唯一可行的攻击是攻服务端或偷库 —— 这两条已被 scope 隔离、行锁、审计覆盖
- 穷举不现实（7.88×10¹⁷ 空间）

### 3.4 结论：把"加密解密"翻译成正确的需求

你真正想要的是"**用户伪造不了码、运营看得住码、码泄漏了能止损**"。这三件事**不需要密码学**：

| 你担心的 | 正确的解法（现有能力 / 本方案新增） |
|---|---|
| 用户伪造码 | ✅ 随机码 + 服务端查库 + 零本地映射 |
| 用户重复用同一个码 | ✅ 行锁 + 条件更新 + 幂等返回 |
| 码被用户截图外传 | ✅ 一次性资源 + 作废接口 + 发放对象溯源（**新增**） |
| 运营误发高价值码 | ✅ 跨档压制 + 签发二次确认（**新增**） |
| 运营泄漏全库未用码 | ✅ 默认掩码 + reveal 留痕（**需补 scope 隔离**） |
| 用户拿旧码反复试 | ❌ **无限流**（**新增**） |

### 3.5 唯一的例外：如果你确实需要"离线可验签"

只有一种场景会需要密码学：**码要交给一个我们不控制、且需要离线验真的一方**
（例如批量发给代理商，代理商要自己确认"这是我方签发的码"）。

即便如此，正确的做法**也不是"加密"**，而是**服务端签名**：

```
码 = base64(payload) ‖ base64(Ed25519签名)
payload = { plan, durationDays, expiresAt, nonce }
私钥：只在服务端（永不进客户端）
第三方：只持公钥验签
```

**但必须接受它的边界**：
- 公钥验签只能证明"**这码是我方签发的**"，**证不了"这码还没被用"**（一次性状态在服务端）
- ⇒ 第三方**不能**据此给用户开通权益，最终仍要回调我方服务端核销
- ⇒ 这会引入**第二套真源**，而 `DESIGN-MEMBER-CENTER-P2-PAYMENT` 明确禁止"第二套权威"

**建议：除非产品明确要求"第三方离线发码/离线核销"，否则不做。**
当前没有任何场景提出这个需求 ⇒ 结论是**不做**。

---

## 4. 安全设计

### 4.1 威胁模型与现状覆盖

| # | 威胁 | 现状 | 处置 |
|---|---|---|---|
| T1 | 改本地代码换永久 Pro | ✅ 已堵（本地激活通道 2026-10-17 整体删除） | **保持零本地权益写入路径** |
| T2 | 伪造激活码 | ✅ 随机码 + 服务端查库，码内无权益信息 | 保持 |
| T3 | 穷举激活码 | ✅ 7.88×10¹⁷ 空间 | 保持 |
| T4 | 同一码重复兑换 | ✅ 行锁 + 条件 UPDATE + 幂等视图 | 保持 |
| T5 | 暴力试码（探测已存在码 / 骚扰） | ⚠️ **无针对性限流**（详见下方「限流现状」小节） | **P1 新增**（§4.2①） |
| T6 | 运营导出全库未用码 | ⚠️ 有 `reveal=true` + 审计，但**所有 `admin:users` 都能导** | **P1 新增独立 scope** |
| T7 | 签发/吊销/手动开通无痕 | ❌ **无审计**（只有 reveal 有） | **P1 新增** |
| T8 | 码泄漏后无法止损 | ⚠️ 可作废，但**不知道发给了谁** | **P2 新增 `issued_to`** |
| T9 | 码进日志/截图 | ✅ 默认掩码 + POST-only（不进 URL） | 保持 |
| T10 | 内部人直改 DB 开会员 | ⚠️ 靠 DB 权限 | 审计覆盖 §4.2 |
| T11 | 桌面端被逆向提取密钥 | ✅ **无密钥可提**（码非签名） | **这是核心资产，保持** |
| T12 | 错档/错时长发给用户 | ✅ 跨档压制（低档不覆盖高档） | 保持 + UI 二次确认 |

### 4.2 建议新增的加固（按性价比排序）

**① 兑换失败限流（P1，最高性价比）**

**限流现状（先说清，避免重复造轮子）**：仓里**有**一个限流器，但它对兑换场景基本无效：

| 事实 | 出处 |
|---|---|
| 全局 IP 级滑窗限流，窗口 60s | `packages/api-publish-engine/src/rate-limiter.js:13-27` |
| 在**所有**请求前统一执行，命中返回 429 | `publish-api-server.js:777-780` |
| **默认不启用**：`maxRpm` 缺省为 `null` ⇒ `this._rateLimiter` 为 `null` | `config-loader.js:15`；`publish-api-server.js:158` |
| **不区分端点**：兑换与发布共用同一个计数器 | `publish-api-server.js:777-780` |
| **不区分成败**：成功请求同样计数 | `rate-limiter.js:24-25` |
| **单进程内存态**：多实例部署时每个实例各算各的 | `rate-limiter.js:6` |

⇒ 三个后果：
1. 部署若**没配** `MAX_RPM` ⇒ **完全无限流**；
2. 配了 ⇒ 是"全站每分钟 N 次"的粗桶，**低速率定向探测（每秒 1 次）抓不到**；
3. 桶被正常流量占满时，**兑换失败请求反而挤不进额度**（成功请求已经把额度用掉了），
   而真正该拦的失败请求没有独立额度。

⇒ 所以需要的是**端点级、失败计数**的限流，而不是复用现有桶。

建议（engine 路由层，与 `publish-api-server.js:938` 同层）：
- 同一用户：60 秒内**失败** ≥ 5 次 ⇒ 429 + 退避
- 同一 IP：10 分钟内**失败** ≥ 200 次，**或**最近 60 秒内失败 ≥ 60 次 ⇒ 429（两个条件是 **OR**）
- **只计失败**，成功不计数（否则正常用户连兑几张码就被限）
- 命中时只回 429，**不透露剩余次数**（否则限流器本身可被探测）
- 计数存储：短期用进程内 LRU（多实例时各自计数，精度可接受）；若已部署 Redis 则用它
- ⚠️ 失败判定要覆盖四类探测行为：**格式错误** / **不存在** / **已被别人用过** / **已被作废**：
  `REDEEM_CODE_FORMAT` 也计（否则可以拿格式错的串无限刷）；
  「已被别人用过 / 已作废」也计（否则拿**泄漏的码清单**逐个试就是**免费的存在性预言机**）；
  而**过期**（买了没兑、过期了又来试）与**服务端故障**不计。

**② 拆分 scope（P1）**

现状：`/api/v1/admin/member/*` 全部是 `admin:users`（`publish-api-server.js:468`）。
⇒ 任何一个有 `admin:users` 的人都能 **reveal 全库未兑换码**。

建议拆成：
```
admin:redeem:read     列表（掩码）
admin:redeem:export   reveal 完整码
admin:redeem:write    签发 / 作废
admin:members:grant   手动开通
```
（改 scope 需同步改 `publish-api-server.js:468` 的映射与 ops 后端 token 配置）

**③ 补审计（P1）**

现状审计只有两处：`redeem_code_reveal`（:99）、`redeem_code_batch_incomplete`（:138）。
**签发成功**、**作废**、**手动开通 grant** 三类花钱动作**都没有审计**。

建议补：
```js
{ type: "redeem_code_batch_issued", batch, plan, durationDays, count, operator }
{ type: "redeem_code_disabled", code, operator }
{ type: "member_grant", userId, plan, durationDays, operator }
```
理由：**签发 500 个码 ≈ 一笔真实支出**。没有审计 = 出了事查不到人。

**④ 发放对象溯源（P2）**

`identity_redeem_codes` 加可空列：
```sql
ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS issued_to TEXT;
```
`issued_to` = 发放对象（渠道名 / 客户名 / 活动名）。
**上限 200 字符**，且过一道**危险字符闸门**（控制字符 / C1 / 零宽 / 双向覆盖与隔离 / BOM）：
它与批次号是**追查泄漏批次的取证锚点**，不能被显示欺骗（RTL 覆盖能让列表里的文字按相反顺序显示）。
⚠️ 原方案里的 `note`（运营备注）**已砍**：engine 无此概念，ops 转发层显式丢弃它。
泄漏后可按 `batch` 列出该批次的码 → **逐个**吊销（仓里只有单码吊销，没有批量作废端点）。

> ⚠️ **能力边界**：仓里**只有单码吊销**（`POST /api/v1/admin/member/redeem-codes/disable`），
> **没有批量作废端点**；`issued_to` 也**不是列表筛选条件**（列表只支持 `plan`/`status`/`batch` 过滤）。
> 「批量作废端点」与「按 `issued_to` 筛选」是下一轮的独立改动（见 §5.4 已标注「新增」的那条）。

⚠️ **迁移纪律**：新迁移放 `migrations/postgresql/009_redeem_code_issued_to.sql`
（007/008 都已被别的 change 占用 ⇒ 刻意跳号；见 §4.2 与执行记录 §4.1）
（⚠️ 目录当前已有 `002_logto_identity.sql` / `003_logto_webhook_events.sql` /
`004_member_commerce.sql` / `005_cloud_accounts.sql` / `006_payment_orders.sql`
—— **005 和 006 已被占用**，不要按"上一个是 004"来推编号）。
迁移必须**幂等可重跑**（`ADD COLUMN IF NOT EXISTS`）。

⚠️ **且不止迁移一处**：加列要**四处同改**（迁移 + 运行时 SCHEMA 数组 + INSERT + SELECT），
其中运行时 SCHEMA 数组那一处最隐蔽——`CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op，
**不会加列**。完整清单见 §6.4.2。
加**列**不影响 `REQUIRED_SCHEMA_RELATIONS` 的表清单（那三处硬编码只管表名），
但若后续要**新增表**（如批次统计表），则必须同步那三处副本 —— 见 §6.4。

**⑤ 码的"面值"只读推导，不新增字段（P2）**

3 个月标准版的名义价值 = ¥59 × 3 = ¥177。
**不要**把它存进表（会与 `plan-matrix` 改价漂移）。
运营界面**实时算**并注明口径"按月付折算，不含年付折扣"。

**⑥ 批次临期提醒（P2）**

`expires_at` 临期的码在 ops 列表高亮 + 看板角标。
（`MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md:443` 已把"兑换码临期运营侧无提醒"登记为待办）

### 4.3 明确**不做**的安全动作

| 动作 | 为什么不做 |
|---|---|
| 给码加"加密载荷" | §3。会把客户端变回攻击面 |
| 客户端内置 Ed25519 私钥 | 私钥进包 = 可提取 = 可伪造 |
| 把码做成"可离线自证"的凭证 | 一次性状态在服务端，证不了；且制造第二套真源 |
| 用码的内容当随机源（如取哈希前 12 位） | 长度固定 ⇒ 熵受限；不如直接 `crypto.randomInt` |
| 把兑换码塞进 URL query | 会进 access log / 浏览器历史。现有 POST-only 设计正是为此（`member-api-service.js:25-27`） |
| 物理删除已兑换码 | 权益已发放，删了就对不上账。现状只支持作废（`disabled`），✅ 已正确 |

---

## 5. 运营中心 UI 方案

### 5.1 签发弹窗（`RedemptionCodes.vue:90-120`）

**当前**：数量 / 套餐(英文) / 有效天数(裸数字) / 兑换码过期(ISO 字符串手填) / 批次号

**改成**：

```
┌─ 批量签发兑换码 ────────────────────────────────┐
│                                                │
│  套餐 *            [ 标准版 · ¥59/月      ▾ ]   │  ← 显示中文名+价格
│                                                │     value 仍是 standard
│  会员时长 *                                    │
│    ( ● ) 1 个月 (30 天)                         │  ← 预设单选
│    ( ○ ) 3 个月 (90 天)                         │
│    ( ○ ) 自定义 [___] 天                        │  ← 自定义默认收起
│                                                │
│  数量 *          [ 10 ▾ ]  (预设 10/50/100/200) │
│                                                │
│  名义价值         ≈ ¥177（按月付折算 ¥59×3）    │  ← 实时算，注明口径
│                                                │
│  兑换码截止使用日  [ 2027-01-31 📅 ]            │  ← date-picker，非 ISO 手填
│     ⓘ 留空 = 长期有效。指"码的使用截止日"       │
│       与上面的"会员时长"是两件事。               │
│                                                │
│  发放对象          [ 渠道/客户名/活动名       ]  │  ← 新增，写 issued_to
│  批次号            [ batch-20261024-std-90d ]  │  ← 自动建议，可编辑
│                                                │
│           [ 取消 ]      [ 签发 200 个 ]         │
└────────────────────────────────────────────────┘
```

**签发前二次确认**（新增）：
> 将签发 **200 个「标准版 · 1 个月」**兑换码，合计名义价值约 ¥11,800。
> 签发后**不可撤销**（只能逐个作废）。确认签发？

理由：现在 200 个码一点就发出去，没有回头成本提示。

### 5.2 签发结果弹窗（`RedemptionCodes.vue:122-144`）

**当前**：一个滚动 div 装所有码 + "完整码仅本次显示"。

**改成**：

```
┌─ 签发结果 ────────────────────────────────┐
│  已签发 200 个 · 批次 batch-20261024-…   │
│  [ 📋 复制全部 ]  [ ⬇ 导出 CSV ]  [ 📄 复制模板行 ] │
│                                           │
│  ABCD-EFGH-JKMN                          │
│  WXYZ-2345-JKMN                          │
│  ...                                     │
│                                           │
│  ⓘ 完整码也可在列表中打开"显示完整码"找回， │
│     该操作会被记入审计日志。                │
└───────────────────────────────────────────┘
```

- **一键复制全部**：`navigator.clipboard.writeText` + `document.execCommand` fallback
- **导出 CSV**：`﻿` UTF-8 BOM 前缀（Excel 中文不乱码），列 = 码/套餐/时长/批次/截止日
- **复制模板行**：每行一个码，方便直接贴进 IM/邮件
- 文案修正：现在的"关闭后无法再次查看"**不准确**（reveal=true 可查回）⇒ 改成上面那句

### 5.3 列表页（`RedemptionCodes.vue:58-87`）

| 列 | 现状 | 改成 |
|---|---|---|
| 兑换码 | 掩码 `ABCD-****-****` | 保持；加"复制"按钮 |
| 套餐 | `standard` / `pro` | **标准版 / 专业版** |
| 天数 | `30` | **1 个月**（30 天） |
| 批次 | 裸 batch 串 | 保持 + **可点击进批次详情** |
| 状态 | 未使用/已兑换/已作废 | 保持 |
| 使用者 | userId 裸值 | 保持（可加用户标识） |
| — | — | **新增：发放对象**（`issued_to`） |
| — | — | **新增：本批兑换率**（需 §6.1 接口） |

### 5.4 批次详情（新增）

点批次号 → 抽屉/弹窗：
- 概览：套餐 / 时长 / 签发数 / 已兑换 / 未使用 / 已作废 / **兑换率**
- 明细表：码 / 状态 / 使用者 / 兑换时间
- 操作：批量作废本批未使用码（**新增**，需 engine 支持批量 disable）

### 5.5 术语与口径对齐

- `PLAN_OPTIONS`（`:155`）保持 `['standard','pro']` 不变（值），**只加显示映射**：
  ```js
  const PLAN_LABELS = { standard: '标准版', pro: '专业版' }
  ```
  ⚠️ 后端 `SUPPORTED_PLANS = ("standard","pro")`（`redeem_batch_service.py:36`）——保持同源，不要在前端另造一份不同的档位集合。
- `MAX_BATCH` 不一致：ops 前端/后端都是 **200**（`redeem_batch_service.py:32`、`RedemptionCodes.vue:157`），
  engine 允许 **500**（`subscription-redeem-batch.js` 的 `createRedeemBatch`）。**取 ops 的 200 更安全**（更小批量更好追责），
  但要**在文档里写明**"ops 主动收窄到 200"，否则以后有人看到 engine 500 会以为是 bug。

---

## 6. 服务端与数据模型改造

### 6.1 新增：批次统计接口

```
GET /api/v1/admin/member/redeem-codes/batches?batch=<id>
  → { success, batch, plan, durationDays, total, active, used, disabled,
      issuedAt, redeemedCount, redeemRate }
```
- engine：新增 `getRedeemBatchSummary()`，**必须开新文件**（如 `subscription-redeem-batch.js`，
  用现成的 mixin 范式 `applySubscriptionRedeemBatchOps`）
- ⚠️ **`subscription-service.js` 只剩 4 行余量**：
  该文件当前 **496 行**，且**不在** `max-lines-baseline.json` 的 `files`（挂账）或 `targets`（点名）任一清单里
  ⇒ 受全局 `limit: 500` 的 `NEW_OVER_LIMIT` 规则约束（`lines >= 500` 即阻断，`.github/scripts/check-max-lines.js:268`）
  ⇒ **再加 4 行就撞门禁**。
  理由与先例同 `subscription-payment.js`（`subscription-service.js:481-486` 的注释就是为它写的：
  "那组方法 140 行会把本文件推到 632 行，顶破 filesOver500 债务基线"）。

### 6.2 新增：批次号建议值生成

engine 侧给默认批次号一个**可读格式**，比现在的
`batch-2026-10-24-a1b2c3`（`:390`）更有运营价值：
```
batch-20261024-std-90d      # 日期-档位-时长
```
保留原格式作为 fallback（自定义批次号优先）。

### 6.3 新增：时长预设常量（单一真源）

```js
// engine
const REDEEM_DURATION_PRESETS = Object.freeze([
  { key: 'month1', days: 30, label: '1 个月' },
  { key: 'month3', days: 90, label: '3 个月' },
])
```
- engine 与 ops **各持一份会漂移** ⇒ 建议由 engine 在
  `GET /api/v1/admin/member/redeem-codes/presets`（或并入 `GET /api/v1/plans`）下发
- ops 前端从接口取，不硬编码
- 自定义天数仍允许（保持现状弹性）

### 6.4 迁移纪律（来自本仓既有教训）

#### 6.4.1 本仓的 schema 管理有三套并行机制（先搞清楚再动手）

| 机制 | 位置 | 何时生效 |
|---|---|---|
| **迁移文件** | `migrations/postgresql/*.sql` | **生产**；`assertReady()` 用 `validateMigrationLedger(..., {allowPending:false})` 校验**每一份都已应用且 checksum 一致**（`postgres-identity-repository.js:216-222`） |
| **运行时 SCHEMA 数组** | `postgres-identity-repository.js:26-176`（含 `payment-schema.js`） | **仅非生产**：`initialize()` 逐条执行（`:196-203`）；生产直接抛 `PRODUCTION_AUTO_MIGRATE_FORBIDDEN` |
| **运行时表清单** | `REQUIRED_SCHEMA_RELATIONS`（`postgres-identity-repository.js:10-24`） | `assertReady()` 检查这些表**存在**，缺一个就 `BUSINESS_DATABASE_SCHEMA_NOT_READY`（`:213-217`） |

⚠️ **本仓的既有惯例 = 迁移与 SCHEMA 数组逐字成对**。
先例：`migrations/postgresql/006_payment_orders.sql:19-23` 与
`packages/api-publish-engine/src/auth/payment-schema.js:18-23` 是一对**内容相同**的
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 语句。

#### 6.4.2 给 `identity_redeem_codes` 加列 ⇒ **四处必须同改**（漏一处就分叉）

以 `issued_to` / `note` 为例：

| # | 文件 | 改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `migrations/postgresql/009_redeem_code_issued_to.sql`（**新建**） | `ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS issued_to TEXT;`（**只有这一列**；`note` 已砍） | 生产 `assertReady()` 报 `MIGRATION_PENDING` |
| 2 | `postgres-identity-repository.js` 的 `SCHEMA` 数组（`:104-116` 之后） | **同一条 ALTER 语句** | ⚠️ **最隐蔽的一个**：SCHEMA 里那张表是 `CREATE TABLE IF NOT EXISTS`（`:104`）——**对已存在的表是 no-op，不会加列**！开发库既有表将永远缺这一列 ⇒ 新 INSERT 报 `column "issued_to" does not exist` |
| 3 | `postgres-commerce-store.js:282-298` `createRedeemCodes` | INSERT 是 `unnest($1,$2,$3,$4,$5)` 批量形式 ⇒ 要加第 6 个数组参数 | 签发直接失败 |
| 4 | `postgres-commerce-store.js:310-317` `listRedeemCodes` | SELECT 列清单加 `issued_to` | 列表页拿不到发放对象 |

再往上一层，字段要能从前端走到库里，还要同步：
`subscription-service.js:380-414`（`createRedeemBatch` 收 `issuedTo`）→
`:400` 构造 records → `:420-452`（`listRedeemCodes` 映射 `issuedTo`）→
`publish-api-redeem-code-admin.js:40-51`（解析 body 的 `issuedTo`）→
ops `redeem_batch_service.py`（转发 + 校验）→ ops `RedemptionCodes.vue`（表单 + 列表列）。

#### 6.4.3 若**新增表**（本方案不建议）

`REQUIRED_SCHEMA_RELATIONS`（`postgres-identity-repository.js:10-24`）在**三处**被硬编码复制：
① readiness 断言的期望表清单 ② fail-closed 路径的关系表清单
③ 「生产迁移 ↔ 运行时表一致性」那张表名列表。

⇒ **改主清单前先 grep 它的每一个副本**，用上一张同类条目作锚点比逐个读文件快且不漏；
追加必须**按主清单的同一顺序**（有 `assert.deepStrictEqual` 逐项比对，见
`test/cloud-accounts-schema-drift.test.js:54-55`）。

> 建议：**本期不新增表**。批次统计用 `identity_redeem_codes` 上的 `GROUP BY batch` 聚合即可，
> 零迁移、零清单同步、零风险。若未来要预聚合表再单独立项。

### 6.5 兑换失败限流的落点

放在 `publish-api-server.js` 的 `/api/v1/redeem` 分支（`:938`）**之后**、`_commerceFailure` 之前，
与现有 scope 校验并列——但**不能**挂在 `publish-api-server.js:777-780` 的全局限流位上：
那个是全站粗桶（不分端点、不分成败，见 §4.2①），语义完全不同。

⚠️ **2026-10-24 第 2 轮实测更正**：那个粗桶**不是「默认关闭」**——生产 compose 是
`MAX_RPM=${MAX_RPM:-100}` ⇒ **生产是开着的**；更要紧的是它的分桶键是 **socket 优先**，
而生产拓扑是 nginx → `127.0.0.1:3030`、引擎只绑回环 ⇒ 引擎看到的来源地址**恒为 127.0.0.1**
⇒ **全站所有用户共用同一个 100 次/分钟的桶** ⇒ 本模块的兑换限流在生产拓扑下**会被这个
前置粗桶部分遮蔽**。这条不在本 PR 的改动范围（全局限流位未动），但它决定本模块的生产有效性，
已登记为下一轮最高优先级（粗桶分桶键改为 XFF 最右优先，与本模块同口径）。

⚠️ 落点的行数约束：`publish-api-server.js` 在 `max-lines-baseline.json` 里
`files=1356` / `targets=1574` ⇒ **targets 容差为 0**，**一行都不能加**
（`check-max-lines.js:250-255`：被 targets 点名的文件天花板 = targets 值，容差 0）。
⇒ 限流逻辑必须放**新文件**（如 `src/auth/redeem-rate-limit.js`），
由 `publish-api-server.js` **改动既有行**（如在 `require` 区加一行 + 在 redeem 分支调用）来接线。
注意 `files=1356` 的挂账值给了 `growthAllowance=200` 的增长空间，
但 `targets=1574` 是**零容差**——两者的约束不同，别混。

计数存储：
- 短期：进程内 LRU（多实例时各自计数，精度可接受）
- 长期：Redis（若已部署）

---

## 7. 桌面端 UI 方案

### 7.1 兑换卡升级（`MemberCenter.vue:118-148`）

**当前**：
```html
<input v-model="redeemCode" placeholder="ABCD-EFGH-JKMN" :disabled="redeeming" ...>
<button :disabled="!canSubmitRedeem" @click="submitRedeem">立即兑换</button>
```

**改成**：

```
┌─ 激活码兑换 ───────────────────────────────────────┐
│ 输入激活码兑换会员权益。一码仅可核销一次，          │
│ 与账号绑定。                                        │
│                                                   │
│  ┌────────────────────────────────────┐ ┌────────┐ │
│  │ ABCD-EFGH-JKMN                     │ │立即兑换│ │
│  └────────────────────────────────────┘ └────────┘ │
│                                                   │
│  ✓ 格式正确                          ← 实时反馈   │
└───────────────────────────────────────────────────┘
```

具体改动：

| # | 改动 | 理由 |
|---|---|---|
| D1 | **修正文案「16 位」→「12 位」**（zh/en 同步） | 实际是 12 字母（14 字符含连字符）。`zh.js:11` / `en.js:11` 现在的说法是错的 |
| D2 | 输入框 `maxlength=14` | 物理上挡住超长输入 |
| D3 | 自动 `toUpperCase()` + 自动补连字符（`ABCD` → `ABCD-`） | 用户手输体验；且服务端是 `trim().toUpperCase()` 后再匹配（`subscription-service.js:261`） |
| D4 | **提交前本地格式校验** | 现状 `canSubmitRedeem` 只查非空（`:227-229`）。`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md:111`（P1-8）已点名此缺口 |
| D5 | 格式合法时给绿色边框 + "格式正确" | 即时反馈，减少往返 |
| D6 | 粘贴支持（整段粘贴自动格式化） | 运营常从 IM/邮件整段贴 |
| D7 | 错误态保留服务端语义码映射 | 现状 `REDEEM_ERROR_KEYS`（`:232-240`）已完备，**不动** |

**D4 的契约锁（重要）**：桌面端不能 `require` 服务端文件（跨包），
所以要在桌面端建一份**镜像常量**并加**一致性测试**锁住与服务端同型。
先例：仓内已有 `buyout-removal.contract.test.js` 这类跨端契约锁。

```js
// apps/desktop/src/views/member-center/redeem-code-format.js
// 镜像 packages/api-publish-engine/src/auth/subscription-service.js:14
// ⚠️ 两份定义必须同型；改动任一处必须同时改另一处，并由 redeem-code-contract.test.js 锁住
export const REDEEM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/
```

> **备选方案**：让 `GET /api/v1/plans` 一并下发 `redeemCodePattern` 描述。
> 好处是单一真源；坏处是**首次启动没网就没有校验**。⇒ 建议**镜像常量 + 契约测试**（离线也可用，且漂移会被 CI 抓住）。

### 7.2 结果反馈强化（`MemberCenter.vue:270-290`）

现状三态已正确，缺的是**「档位压制」这一态没有单独文案**。

服务端在低档码被高档压制时返回 `downgradeSuppressed: true`（`subscription-service.js:309`），
但**桌面端全仓 `downgradeSuppressed` 零命中** —— 它既没被 store 透传，也没被视图使用。
⇒ 现状下用户看到"已开通 standard"，而实际生效仍是 pro ⇒ **误导**。

**改两层（不是一层）**：
1. `apps/desktop/src/stores/member.js:126-131` —— 归一化视图里补一个字段：
   ```js
   downgradeSuppressed: data.downgradeSuppressed === true,
   ```
   （与 `idempotent` / `hasActiveSubscription` 同处；`subscription-service.js:309` 已经把它送出来了，
   只是 store 没往下传）
2. `apps/desktop/src/views/MemberCenter.vue:270-290` —— 加第 4 个分支。

新增第 4 态：
```
tone: 'info'
text: 已续叠 30 天；当前档位（专业版）高于该码，档位保持专业版不变。
      有效期至 2026-12-24
```
配套新增 i18n key（zh/en 成对，Gate 7）。

| 场景 | tone | 文案 |
|---|---|---|
| 首次成功 | success | 已开通 标准版，有效期至 X |
| 首次成功但被压制 | info | 已续叠 N 天；当前档位（X）高于该码，档位保持不变 |
| 幂等重放（订阅仍有效） | info | 该码此前已兑换，当前订阅有效至 X |
| 幂等重放（订阅已过期） | info | 该码此前已兑换，对应订阅已到期，重放不会增加时长 |
| 服务端错误 | error | 按 `REDEEM_ERROR_KEYS` 映射（不变） |

### 7.3 兑换历史（零新增接口）

`identity_orders` 已有 `channel='redeem'` 的记录（`subscription-service.js:287`），
`GET /api/v1/me/orders` 已存在 ⇒ **兑换历史天然出现在「订单与账单」页**（`OrdersBilling.vue`）。

需要做的只是：
- 订单列表里把 `channel='redeem'` 的行显示成"激活码兑换"（而非"支付"）
- 显示该订单的 `plan` + 有效期

⇒ **本项零后端改动**，只改前端展示。

### 7.4 桌面端**不做**的事

- ❌ 不在桌面端做任何本地权益计算/校验（那是漏洞的根源）
- ❌ 不缓存未兑换码
- ❌ 不做"离线兑换"（需服务端在线确认一次性状态）
- ❌ 不在本地生成激活码（签发只在 ops-center）

---

## 8. 落地拆分

> 依赖顺序自上而下。P0 全部是**零/低后端改动**，可以先合，快速见效。

（2026-10-24 首轮已落地：**P0-2 运营侧**（**子集**：中文档位名 + 时长预设 + 发放对象输入与列表列；
**date-picker 与签发前二次确认未落地**）+ **P1-1 限流** + **P1-3 补审计** + **P2-④ issued_to**；
P0-1 桌面端、P0-3 复制导出、P1-2 scope 拆分、P2 系列仍在下一轮。）

| PR | 范围 | 后端 | 前端 | 依赖 |
|---|---|---|---|---|
| **P0-1** | 桌面端兑换卡体验：文案修正 + 本地校验 + 自动大写/分隔 + 契约测试 | — | desktop | 无 |
| **P0-2** | 运营中心签发弹窗：中文档位名 + 1月/3月预设 + date-picker + 二次确认 + 发放对象 | 迁移 009（加列） | ops | 无 |
| **P0-3** | 运营中心签发结果：一键复制 + CSV 导出 + 模板行复制 + 文案修正 | — | ops | P0-2 |
| **P1-1** | 失败限流（429 + 退避） | engine | — | 无 |
| **P1-2** | scope 拆分（`admin:redeem:read/export/write`） | engine + ops 配置 | — | 无 |
| **P1-3** | 补审计：签发 / 作废 / grant 三类 | engine | — | 无 |
| **P2-1** | 批次统计接口 + 批次详情抽屉 | engine（新文件） | ops | P0-2 |
| **P2-2** | 桌面端「档位压制」第四态文案（**store 加透传字段 + 视图加分支，两层**） | — | desktop | 无 |
| **P2-3** | 兑换历史展示（订单页 channel=redeem） | — | desktop | 无 |
| **P2-4** | 批次临期提醒 | engine | ops | P2-1 |

### 8.1 建议的先后

1. **先 P0-1 / P0-2**（各半天到一天，风险低，运营和用户立刻受益）
2. **再 P0-3**（交付效率，运营签 200 个码的刚需）
3. **然后 P1-1 / P1-2 / P1-3**（安全，一次性做完，别拆三次上线）
4. **P2 按需**

### 8.2 与支付通道的衔接（不在本方案范围，但需对齐）

微信 Native 支付设计已定稿（`01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md`），编码未开始。
本方案**不碰支付**，但要保证：
- 支付成功 → **直接开通**（`subscription-payment.js:216` 现状如此），不发码
- 兑换码 → 只服务无即时支付通道的场景
- 两者共用 `applySubscription()`，**不复制**任何落账逻辑（`subscription-payment.js:159` 的注释已明确此纪律）

---

## 9. 验收判据

### 9.1 功能

| # | 判据 | 怎么测 |
|---|---|---|
| A1 | 桌面端输入合法码 → 开通对应档位与时长 | 端到端；`res.plan` / `periodEnd` 与码面一致 |
| A2 | 桌面端输入 `abcd-efgh-jkmn`（小写）→ 能兑换 | 服务端 `toUpperCase()`；前端自动大写 |
| A3 | 桌面端输入非法格式 → **不发请求**，就地提示 | 抓包确认无 `/api/v1/redeem` 请求 |
| A4 | 同一码二次提交（订阅仍有效）→ 不加时长，明确提示"此前已兑换" | 对比 `periodEnd` 不变 |
| A5 | 同一码由他人兑换后再提交 → 明确报"已被他人使用" | 409 → `redeemErrUsed` |
| A6 | 已兑换的码不可作废 → 409 | `REDEEM_CODE_ALREADY_USED` |
| A7 | 运营签发 1 个月标准版 10 个 → 10 个码可兑换，各得 30 天 | 逐个核销 |
| A8 | 运营签发 3 个月专业版 10 个 → 各得 90 天 | 同上 |
| A9 | pro 用户兑 standard 码 → 时长 +30 天，档位仍 pro | 检查 `downgradeSuppressed=true` |
| A10 | 运营签发 200 个 → 列表可查、CSV 可导出 | — |

### 9.2 安全

| # | 判据 | 怎么测 |
|---|---|---|
| S1 | 全仓 grep 桌面端**无**任何"码 → 权益"映射 | 否定式 grep 零命中 |
| S2 | 全仓 grep 无激活码私钥/种子 | 否定式 grep 零命中 |
| S3 | 同一用户 5 次失败兑换 → 第 6 次 429 | — |
| S4 | 只有 `admin:redeem:export` 能 reveal，其他 admin 不能 | — |
| S5 | 签发 / 作废 / grant 三类动作都进审计 | 查 audit log |
| S6 | `issued_to` 能定位泄漏批次 | — |
| S7 | 兑换码不出现在任何 URL query | grep + 抓包 |

### 9.3 门禁（照抄本仓既有要求）

- 桌面端：zh/en 文案成对（Gate 7）；`QG Desktop Shards` / `QG Coverage` 绿
- ops-center：`ops-center-ci.yml` 绿
- engine：`redeem-code-admin-routing.test.js` 需同步更新（新增端点时）
- 门禁清单类改动照抄 `01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md` 的命名锁与契约锁

---

## 10. 边界：明确不做的事

| 不做 | 理由 |
|---|---|
| 给激活码加"加密载荷" | §3。这是安全倒退 |
| 客户端内置验签私钥 | 可提取 = 可伪造 |
| 支付成功后自动发码 | 凭空多出库存/批次/发放/对账四层复杂度，收益为零 |
| 物理删除已兑换码 | 权益已发放，对不上账。现状只作废 ✅ |
| 新增批次统计表 | 用 `GROUP BY batch` 聚合即可，零迁移零清单同步（§6.4） |
| 改 `standard`/`pro` 的 id | 会污染既有契约、迁移、plan-matrix |
| 把「1 个月/3 个月」做成硬约束 | 现状允许 1-3650 任意天数，有运营需要（如 7 天体验码）⇒ **预设 + 自定义**并存，不是二选一 |
| 支付宝 | 仓内已定「支付宝未排期」（`roadmap-v1.1.0.md:33`） |
| 改 `MAX_BATCH` | ops 200 / engine 500 的差异是**主动收窄**，写进文档即可 |

---

## 11. 三个决策的定案结果（2026-10-24，运营方拍板）

| # | 决策 | **定案** | 理由与落地 |
|---|---|---|---|
| 1 | 档位显示名 | **沿用仓内命名**（标准版 / 专业版） | 同一产品内档位名必须唯一；「基础」在仓内已被 `modelTier: 0`「基础模型层级」占用且含义相反。渠道话术在营销物料里做映射表，不改产品内档位名。**落地**：运营中心前端加 `PLAN_LABELS` 显示映射，`plan` 的值仍是 `standard`/`pro`（服务端契约不变）。 |
| 2 | `issued_to`（发放对象） | **做** | 它回答「这批码发给了谁」——没有它，泄漏后运营只能靠记忆排查。**能力边界**：仓里只有单码吊销，**没有批量作废端点**；`issued_to` 也**不是列表筛选条件** ⇒ 处置靠 `batch` 过滤 + 逐个吊销（批量作废列入下一轮）。**落地**：迁移 `009_redeem_code_issued_to.sql`（+ 运行时 SCHEMA 数组逐字成对 + 防漂移锁）+ 仓储 INSERT/SELECT + 服务层透传与归一化 + 运营 API + ops 转发层 + 运营前端输入与列表列。 |
| 3 | 失败限流严格程度 | **先上温和档** | 同一用户 60 秒内失败 ≥ 5 次 / 同一 IP 10 分钟内失败 ≥ 200 次 **或** 最近 60 秒内失败 ≥ 60 次 ⇒ 429（两个条件 **OR**）。只计四类探测行为：格式错 / 不存在 / **已被别人用过** / **已被作废**；**过期**与**服务端故障**不计（那是正常业务）。命中时不透露剩余次数。**落地**：`redeem-rate-limit.js`（端点级 + 失败计数 + 原子预占）+ `publish-api-redeem.js`（路由 + 限流门）。观察一周真实数据后再决定是否收紧或上共享存储。 |

### 本轮实施的三处「必须这么写」（踩过的坑，别再犯）

- **迁移编号用 009，刻意跳过 007 / 008**：008 已被在飞 PR #4322 占用，007 预留给尚未开 PR 的
  compute-key-envelope-migration change。编号机制（实测自 `postgres-migrations.js`）：台账按
  **完整文件名**记账，排序按文件名字母序 ⇒ 两个**同号不同名**的迁移不会撞台账，但**相对执行顺序
  会退化成字母序** ⇒ 有依赖关系时可能以错误顺序执行。真正让 identity 仓储**启动期硬失败**的是
  「同名文件被改」（checksum 不一致）与「文件已入库未执行」。⇒ 结论不变：**宁可跳号，不可撞号**。
- **加列要两处同改**（迁移 + 运行时 SCHEMA 数组）：SCHEMA 数组里那张表写的是
  `CREATE TABLE IF NOT EXISTS` ⇒ **对已存在的表是 no-op、不会加列** ⇒ 开发库永远缺列 ⇒
  只在开发环境复现的诡异差异。两处都用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。
- **两个大文件走「抽模块」而非抬基线**：`subscription-service.js` 496 → 458 行、
  `publish-api-server.js` 1573 → 1565 行（后者在 `targets` 点名还账清单里，**零增长容差**）。


## 12. 本文事实基础与独立核查记录

**本文所有"现状"条目均为本轮逐行读源码核实**，不是从文档转述。
在此基础上做了**一轮独立核查**（派独立核查者对 10 条关键断言 + 1 项反向抽查逐条取证，
要求"读不到就写未找到证据、禁止猜"，否定类断言要求全仓否定式 grep 并说明排除项）。

**核查结论：10 条关键断言全部成立**，其中：
- 行号类断言（N1–N10）逐条命中，**无一处行号错误**
- 反向抽查发现并修正了本文初稿的 **2 处自身错误**：

| 初稿错处 | 修正后 |
|---|---|
| 断言"兑换失败**无任何速率限制**" | 仓里**有**全局 IP 级限流器（`rate-limiter.js`），但**不区分端点与成败** ⇒ 对兑换场景基本无效，但"完全无限流"的说法是错的。⚠️ 第 2 轮进一步更正：**它不是「默认关闭」**——生产 compose `MAX_RPM=${MAX_RPM:-100}` ⇒ 生产开着；且其分桶键 socket 优先 ⇒ 生产拓扑下全站共用一个桶 |
| 新迁移编号写成 `005_*.sql` | `005_cloud_accounts.sql` / `006_payment_orders.sql` **已被占用** ⇒ 新迁移应为 `009_*.sql`（007/008 随后也被占用 ⇒ 刻意跳号；最终取 009） |

**核查过程中额外发现的两条实施级细节**（已写入正文）：
1. `subscription-service.js` 当前 **496 行**，且不在挂账/点名清单里 ⇒ 受全局 `limit:500` 的
   `NEW_OVER_LIMIT` 约束，**只剩 4 行余量** ⇒ 任何新增方法必须开新文件（§6.1）
2. 给 `identity_redeem_codes` 加列要**四处同改**，其中运行时 SCHEMA 数组那一处最隐蔽
   （`CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op，**不会加列**）⇒ §6.4.2

## 13. 第 2 轮对抗性审查：发现了什么、改了什么

第 1 轮（红队）打穿的是**功能**；第 2 轮（5 个独立方向并行）打穿的是**「修好的东西有没有被证明修好了」**。
本节记录第 2 轮的结论与处置，**实现细节见 `openspec/records/redeem-code-issued-to.md`**。

### 13.1 四条真缺陷（已修 + 变异验证）

| # | 发现 | 根因 | 处置 |
|---|---|---|---|
| 1 | 迁移防漂移锁**锁的是语句字面量**，不是「这个列」 | 判据写成「按 `ADD COLUMN IF NOT EXISTS issued_to` 子串过滤」⇒ ① 改成引号标识符（语义等价）**看不见** ② 换一列 / 换一张表**看不见** ③ 未来 010 合法加列 ⇒ **假红地雷** | 改为**列级 (表.列) 双向集合比对**：引号归一化、类型演进不在比对维度、比较域是**全部迁移**。9 组变异双向验证（该红红、该绿绿） |
| 2 | 「非探测型错误释放预占额度」**零测试覆盖** | 把「非探测型分支归还预占」改成空操作 ⇒ 25/25 用例**全绿** | 补端到端用例（连续 8 次过期 / 服务端故障 ⇒ 不得出现 429，且失败数与待定数都为 0）。变异确认**必红** |
| 3 | 部分签发失败的审计条目**内容全空** | 业务字段写在**顶层** ⇒ 审计只认固定字段表 ⇒ **静默丢弃** ⇒ `details=null` / `status="unknown"` ⇒ 与「什么都没发生」在数据上完全一样 | 业务字段装进 `details` + `status:"failed"` + `title` + `error`；**并把 batch 带进错误与 409 响应体**（已签发出去、仍可兑的码否则无从定位是哪一批） |
| 4 | 运营失败路径**零审计**、`status` 恒为 `success` | 4xx 校验失败与 5xx 都不写审计 ⇒ 「操作没生效」与「操作生效」分不清，`stats.failed` 恒为 0 | 失败动作补 `status:"failed"` 的审计条目（含权威 actor / 错误码 / HTTP 状态）；**鉴权失败不记**（未进运营动作域，且会被未鉴权流量灌成噪音） |

### 13.2 三条「证据缺失」（功能是对的，但没被钉住）

- **ops 转发层的 snake→camel 转换点是唯一的、零保护**：把「ops 层不读 snake 键」注进去，
  53 个 ops 用例**全绿**、端到端复跑 200 + `issuedTo:null` + 前端提示「已签发」
  ⇒ 补 ops 层用例钉住转换点，并让 engine 对 snake 键**报错**（fail-closed）而不是静默丢弃
- **补足失败的载荷不带 batch**：engine 的 409 响应体带 `batch`，转发层白名单里没有
  ⇒ 已签发出去、仍可兑的码不知道属于哪一批 ⇒ 补进白名单并补用例
- **运营失败原因被丢弃**：转发层的错误出口丢 `detail` ⇒ 前端只剩一个错误码 ⇒ 透传成 `message`

### 13.3 明确**不做**（登记为下一轮，不是本 PR 的债）

- **核销路径的审计**：`POST /api/v1/redeem` 不写审计是**有意的边界** ——
  审计域是**运营动作域**（按运营者过滤），而核销的**真源是 `identity_subscriptions`**
  （`identity_redeem_codes.used_by/used_at` 也记了谁在什么时候兑的）⇒ 补审计不会增加信息量，
  只会把用户动作灌进运营审计。若将来要做「对账视图」，应从库里查，不是从审计里查。
- **审计可被操作者自行删除 / 只存最近 50 条 / 默认不落盘**：平台级治理问题，
  改的是「谁来守门」，需要团队决策，不在本 PR 范围内。

---

## 14. 第 3 轮对抗性审查：端到端 / 二次红队 / 跨端契约 / 回归

第 2 轮审的是「修复本身」；第 3 轮问的是「**修完之后这套东西在真实链路上站不站得住**」。

| 轨道 | 结论 | 要点 |
|---|---|---|
| 端到端（8 个场景） | **PASS** | 真 server + 真服务层 + 真限流器 + 真审计（**只有商务仓储是桩**，真 PostgreSQL 明确列为未覆盖） |
| 二次红队（21 条攻击） | 打穿 5 类 ⇒ **已修** | 见 §14.1 |
| 跨端契约 | 2 项未闭合 ⇒ **已修** | 见 §14.2 |
| 回归面 | **PASS** | 5 条门禁逐条读数 + 对照基线（`origin/main`） |

### 14.1 二次红队打穿的 5 类（已修）

1. **过期码不计数 ⇒ 20× 速率放大 + 免费存在性预言机**（最危险）
   同一账号连打 30 次过期码 ⇒ 全部 410、失败计数 **0**、**0 次 429**；
   接上生产同值的全局粗桶后 120 次请求 = 100×410 + 20×429，计数仍是 0
   ⇒ 有效探测速率 **5 次/60 秒 → 100 次/60 秒（20×）**；且 410 与 404 可区分。
   ⇒ **过期改为计入**（代价：过期用户 60 秒内反复重试会被限流 —— 远小于 20× 探测速率）。
2. **运营侧自由文本零字符闸门、批次号连长度闸门都没有**
   ⇒ 1MB 批次标签 × 500 个码 = **单请求写入 439.5 MB**（放大 500×）；
   RTL 覆盖 / 零宽 / ANSI 全部原样落库回显 ⇒ 运营看到的批次可能与库里存的**不是同一串**。
   ⇒ 批次号加长度闸门（64）与危险字符闸门；发放对象加危险字符闸门。
3. **有效期完全不校验** ⇒ `'not-a-date'` ⇒ **500**（不是 400）；`true`/`12345` ⇒ 静默变成 1970
   ⇒ **整批码一出生就过期而 API 回 200** ⇒ 非法值与过去的时间一律 400。
4. **兑换端与吊销端不同型** ⇒ 兑换端 `trim + toUpperCase`，吊销端原样匹配大写字面量
   ⇒ 运营从聊天记录里抄来的**小写码在「吊销」框里永远 400** ⇒ **事故处置路径比暴露路径窄**
   ⇒ 吊销端复用同一套归一化（ops 转发层同步大小写不敏感）。
5. **「低档价码换高档时长」的计价口径未定**（**业务决策，不是代码缺陷**）
   实测：standard 365 天的码兑给 pro 用户 ⇒ pro 多 1 年、订单记 standard、订阅记 pro。
   ⇒ **需运营方拍板**（时长按码面档位计价，还是按生效档位计价）⇒ 登记为下一轮议题。

### 14.2 跨端契约的两处未闭合（已修）

- **429 只人话化了两个源里的一个**：引擎有 ① 兑换限流（语义码）与 ② **全局粗桶**
  （`error: "Too Many Requests"`，**不是**语义码）⇒ 桌面端落到「兑换服务暂时不可用」。
  而生产上用户**更常撞的是 ②** ⇒ API 层按 HTTP 状态兜底成语义码、视图层一并映射。
- **这个映射此前零测试覆盖**：实测把映射键名打错一个字母 ⇒ 32 个桌面端测试 + locale 门禁**全绿**
  ⇒ 补两条测试（API 层 + **挂载真实渲染层**断言用户看到的文案，而不是断言映射表键名）。

### 14.3 第 3 轮明确**不做**

- **审计可被操作者自删 / 只存 50 条 / 默认不落盘 / 落盘无轮转**：平台级治理（改「谁来守门」）
- **IP 维度在直连部署下可被伪造 XFF 中和**（生产经 nginx ⇒ 挡住）：连同**限流器键数无上限**
  （实测边际 679 字节/键对）⇒ 下一轮加键数封顶
- **一次成功清零失败计数**（一张真码可买一次额度重置）：**有意设计**，写进台账
- **限流门在服务层之前 ⇒ 连错 5 次后手里那张正确的码也换不了（429）**：60 秒窗口，可接受
- **核销路径不写审计**（真源是 `identity_subscriptions`）、**跨档压制的计价口径**：见 §13.3 与 §14.1⑤

---

### 14.4 合并上游时的一条教训：**上游重构把功能搬走 ⇒ 原改动静默失效**

主干 #4395 把激活码兑换流程从 `MemberCenter.vue` 搬到了 `member-center/Subscription.vue`
⇒ 本分支留在旧文件里的那份变成**死代码**（模板已不再引用）。
⚠️ 若只看「本分支的 diff 还在、测试还在跑」，会以为「429 文案映射」仍生效。
⇒ 是 **eslint 的未使用变量告警**把它暴露出来的 ⇒ 判据：
**凡是自己改过的函数 / 常量 / 映射表，合并上游后都要确认它还被新代码引用。**

## 15. 第 4 轮实施：把「整体方案」里剩余的可落地项做完

> 前三轮（红队 / 对抗性审查 / 一致性审查）把**第 1 轮那一刀**做扎实了；
> 本节是把整体方案（§8 落地拆分）里**当时没做、也不需要业务拍板**的项补齐。
> 需要运营方拍板的项（跨档压制的计价口径）**留在 §16 明确不做**，不夹带。

### 15.0 本轮范围与取舍

| 项 | 来源 | 本轮 | 说明 |
|---|---|---|---|
| 全局粗桶分桶键改 XFF 最右 | 第 3 轮红队 MAJOR-1 | ✅ 做 | 不做的话，兑换限流在生产**基本轮不到**（粗桶先拦） |
| 两套限流器的桶数量封顶 | 第 3 轮红队 A18 | ✅ 做 | 失败一次建一个桶 ⇒ 海量身份可撑爆内存 |
| 迁移文件名不合规 fail-closed | 第 2 轮审查 | ✅ 做 | `1000_x.sql` 原先**静默丢弃** |
| 审计列表分页 | 第 2 轮审计 | ✅ 做 | 硬上限 50 条 ⇒ 第 51 条之后 API 侧读不到 |
| 桌面端兑换卡（文案 / 自动分隔） | §8 P0-1 | ✅ 做 | 「16 位」是错的（实为 12 位） |
| 运营中心：有效期 date-picker + 签发前二次确认 | §8 P0-2 剩余 | ✅ 做 | 原来要手填 ISO 串；签发前无复核 |
| 运营中心：一键复制 / CSV 导出 / 模板行 | §8 P0-3 | ✅ 做 | 签 200 个码目前只能手抄 |
| scope 拆分（`admin:redeem:read/export/write`） | §8 P1-2 | ❌ 不做 | 需要在 logto 后台建 scope + 改客户端与部署配置，**不是代码仓能闭环的事** |
| 批次统计接口 / 批次详情抽屉 / 临期提醒 | §8 P2-1 / P2-4 | ❌ 不做 | 依赖上一项的「按批次筛选」与「按发放对象筛选」，本轮不做半截 |
| 桌面端「档位压制」第四态文案 | §8 P2-2 | ❌ 不做 | 属**既有**失真（不是本 PR 引入），且要改 store + 视图两层，另开一轮更干净 |
| 兑换历史展示（订单页 channel=redeem） | §8 P2-3 | ❌ 不做 | 桌面端订单列表本身有既有缺陷（时间列恒为「—」），先修那个 |
| 跨档压制的计价口径 | §14.1 ⑤ | ❌ 不做 | **需运营方拍板**（见 §16） |

### 15.1 全局粗桶：分桶键改为**真实客户端 IP**（XFF 最右）

**问题（实测）**：粗桶原先按 `req.socket.remoteAddress || XFF` 分桶 ⇒ 生产拓扑下
（nginx → `127.0.0.1:3030`、引擎只绑回环）引擎看到的来源**恒为 `127.0.0.1`**
⇒ **全站所有用户共用一个 100 次/分钟的桶** ⇒ 一个人打满额度，**所有正常用户一起被限**。

**口径**（与兑换限流**同源**，收敛到 `packages/api-publish-engine/src/client-ip.js`）：

1. 取 `X-Forwarded-For` 的**最右**元素（nginx `$proxy_add_x_forwarded_for` 追加的真实客户端 IP）
2. 没有 XFF 时回退 `req.socket.remoteAddress`
3. 两者都取不到 ⇒ `null`（**不凭空造 IP**，避免把所有人并进一个桶）

**为什么取最右而不是最左**：客户端可自带伪造 XFF；取最左则能把计数打到别人头上。
取最右时，伪造值在左端、被忽略 ⇒ 甩不到别人头上。
⚠️ **直连部署**（不经反代）时 XFF 完全由客户端控制 ⇒ 可被伪造来绕开 IP 桶 ——
这是**有意取舍**：生产必然经 nginx（引擎只绑回环、外网不可直连），
「用不可信的 XFF」比「用恒为 127.0.0.1 的 socket」危害小得多；
且**用户维度**（同一账号 60 秒 5 次失败）不受 IP 维度被绕开的影响。

**数据校验**：`X-Forwarded-For` 逐段 `trim()` 后取最后一段非空；空串视同没有。

⛔ **安全约束（本轮新引入的必答题）：键变成「客户端完全可控」之后，
分桶容器**必须是无原型链的**（`Map`）**。**
此前键取自 `req.socket.remoteAddress`（内核给的值）⇒ XFF 分支其实是死代码 ⇒ 键不可控；
本轮改成 XFF 最右之后，键**完全由客户端控制** ⇒ 若容器仍是普通对象：

| 键名 | 普通对象上的读数 | 后果 |
|---|---|---|
| `__proto__` | 继承来的 `Object.prototype`（truthy） | 判定「桶已存在」⇒ 拿到的 `timestamps` 是 `undefined` ⇒ `undefined.filter(...)` 抛 `TypeError` |
| `constructor` / `toString` / `valueOf` / `hasOwnProperty` | 同上（继承属性） | 同上 |

而 `publish-api-server.js` 的 `http.createServer(...)` 对 `_handle` **没有 `.catch`**
⇒ 一次未捕获异常就**打崩引擎进程** ⇒ **单个请求头即可 DoS**。

⇒ 处置：全局粗桶的容器改成 `Map`（与本轮新建的 `auth/redeem-rate-limit.js` 同款）。
⚠️ 附带一条运维纪律：**引擎的 HTTP 处理链必须补 `.catch`**（当前没有）
—— 否则任何端点里的一个未捕获异常都能打崩进程。此项**不在本轮范围**，
但它是上面那条 DoS 从「单请求崩进程」升级成「任何异常都能崩进程」的放大器，登记在 §16。

### 15.2 两套限流器：桶数量封顶

| 限流器 | 维度 | 键 | 上限 | 逐出策略 |
|---|---|---|---|---|
| 兑换限流（`redeem-rate-limit.js`） | 用户 | `userId` | **10000** | 插入顺序最老的桶 |
| 兑换限流 | IP | 客户端 IP | **10000** | 同上 |
| 全局粗桶（`rate-limiter.js`） | 客户端 | 客户端 IP | **20000** | 插入顺序最老的键 |

**逐出代价**：被逐出的键，其计数**归零** ⇒ 该身份「多几次机会」，
**不是**「绕过限流」⇒ 可接受（限流器是**安全阀**，不是安全边界）。
**一次逐出「超出量与上限 10% 的较大者」**（而不是只逐出 1 个）⇒ 摊还 O(1)，洪泛下不退化。
⚠️ 精确口径：`removeCount = max(size - 上限, ceil(上限 × 0.1))`
⇒ 键数在 `上限×0.9 ↔ 上限` 之间锯齿（不是严格贴着上限）。
（2026-10-25 独立复评 F9 实测：文档原写「一次逐出超出量」，与实现不符 ⇒ 改为按实现写。）

### 15.3 迁移文件名不合规 ⇒ fail-closed（不再静默丢弃）

**问题**：`MIGRATION_PATTERN` 是 `^\d{3}_…\.sql$` ⇒ `1000_x.sql`（编号超过三位）
**不在匹配内** ⇒ 原实现 `filter()` 把它**静默丢弃**：不执行、不报错、没有任何痕迹
⇒ 一条迁移被无声忽略 ⇒ 生产缺表/缺列，而仓里看不出任何异常。

**处置**：`discoverMigrations()` 扫描目录时，凡「文件名以数字开头、却不匹配规范」的 `.sql`
⇒ 直接抛 `MIGRATION_FILE_NAME_INVALID`，并在消息里点名文件与规范
（`迁移文件名不符合规范（编号必须是三位数字 001-999，且形如 001_xxx.sql）：1000_x.sql`）。

**为什么不直接把正则放宽成 `\d{3,}`**：迁移按**文件名字典序**执行（`localeCompare`），
而 `"1000_x.sql" < "999_x.sql"`（字典序比数字序）⇒ 放宽会让 4 位编号的文件**排在 3 位之前**
⇒ 若它有 FK 指向 999 的表 ⇒ 建表顺序错乱 ⇒ 报 `42P01 relation does not exist`。
⇒ **宁可启动失败，也不要静默少执行一条迁移。**

### 15.4 审计列表：接入分页（`GET /api/v1/logs?limit=&offset=`）

**问题**：`this._auditLog.list(undefined, undefined, owner)` ⇒ 硬上限 **50 条**
⇒ 第 51 条之后的审计在 API 侧**完全不可读**（而 `stats.total` 仍报总数 ⇒「知道有、拿不到」）。

**处置**：`limit`（默认 50，取值区间 **[1, 200]**）、`offset`（默认 0，**≥ 0**）从 query 取；
两个参数都做**数值化 + 夹紧**（实现见 `packages/api-publish-engine/src/log-pagination.js`）。
`stats` 仍按**全量**统计（总数、成功/失败数）⇒ 分页不影响统计口径。

⚠️ **夹紧不能用 `Number(x) || 默认值`**（本轮实测踩到）：`limit=0` 会被当成「没传」
⇒ `0 || 50` = 50 ⇒ **下界 1 永远不生效**（越界请求拿到了默认值而不是边界值）。
⇒ 规则：**只有「没传 / 空串 / 非数字」才回落默认**；**合法但越界的数字必须夹到边界**
（`limit=0` 或负数 ⇒ 1；`limit>200` ⇒ 200；`offset<0` ⇒ 0）。
⇒ 落点：`Number.isFinite(raw) ? raw : DEFAULT`。

⚠️ **空串必须算「没传」**（2026-10-25 独立复评 F8 实测）：`?limit=` 经 query 解析后是 `''`，
而 `Number('') === 0`（**不是 `NaN`**）⇒ 若只判 `Number.isFinite`，空串会被当成「合法的 0」
⇒ 夹到下界 1 ⇒ **返回 1 条而不是默认 50 条** ⇒ 与本节写明的「空 ⇒ 回落默认」不符。
⇒ 判定必须**先看原始值**（空串/空白串 ⇒ 缺省），再谈数值化。
⚠️ **非整数 limit 向下取整**（`?limit=2.5` ⇒ 2）：limit 是「条数」，
不取整则读数与实际返回条数对不上。

### 15.5 桌面端兑换卡：输入归一化 + 文案纠正（P0-1）

**① 文案纠正**（真 bug）：旧文案写「输入 **16 位**激活码」⇒ 实际码是 **4-4-4 共 12 个字符**
（显示上含 2 个连字符 ⇒ 共 14 位）⇒ 运营按 16 位去数/去抄。

| 文案键 | 中文 | 英文 |
|---|---|---|
| `memberCenter.redeemHint` | 输入 **12 位**激活码（形如 ABCD-EFGH-JKMN）兑换会员权益。激活码与账号绑定，一码仅可核销一次。 | Enter the **12-character** activation code (like ABCD-EFGH-JKMN) to redeem membership. Codes are bound to your account and can only be redeemed once. |

**② 输入归一化**（`normalizeRedeemInput`，`member-center/constants.js`）：

| 输入 | 归一化结果 | 理由 |
|---|---|---|
| `abcd` | `ABCD` | 服务端核销前会 `toUpperCase()`，客户端不转会让用户对着自己输入的大小写自查 |
| `abcdefgh` | `ABCD-EFGH` | 4-4-4 天然分段，边输边补连字符 |
| `ABCD-EFGH-JKMN`（粘贴） | `ABCD-EFGH-JKMN` | 粘贴带横线要吃下 |
| `abcd efgh jkmn`（粘贴） | `ABCD-EFGH-JKMN` | 粘贴带空格要吃下 |
| `ABCDEFGHJKMNEXTRA` | `ABCD-EFGH-JKMN` | 截断到 12 位，不多显示 |
| `IBCD-EFGH-JKMN` | `IBCD-EFGH-JKMN` | ⚠️ **易混淆字符不被悄悄替换**（见下） |

⚠️ **为什么 `I`/`L`/`O`/`0`/`1` 不自动纠正**：服务端字母表显式排除这 5 个（易混淆）。
若客户端把它们悄悄换成别的字符，用户会以为输对了、结果兑换时才发现不对
⇒ **保留原样**交给本地校验去拒，并给出可读原因（「不包含字母 I、L、O 与数字 0、1」）。

**③ 本地校验（已有，保留）**：`REDEEM_CODE_PATTERN` 与服务端**逐字符同型**
（4-4-4、排除 I/L/O/0/1）⇒ 不合法**不发请求**，就地提示。

**④ 契约测试**（新增 `member-center/redeem-code-input.test.js`）：锁归一化输出、
码型形状、字母表排除项、**文案不得再说「16 位」**。

### 15.6 运营中心：有效期 date-picker + 签发前二次确认（P0-2 剩余）

**① 有效期：手填 ISO 串 → date-picker**

| 项 | 之前 | 之后 |
|---|---|---|
| 控件 | `el-input`（手填 `2027-01-01T00:00:00Z`） | `el-date-picker type="datetime"` |
| 可选范围 | 任意（含过去） | `:disabled-date="isPastDate"` ⇒ **今天之前不可选** |
| 提交值 | 原样字符串 | **UTC ISO 串**（`expiresAtToIso`）⇒ 运营浏览器时区与服务端不同时**不会差几小时** |
| 空值 | `''` | `null` ⇒ 请求里**不带该字段**（不是空串、不是 `Invalid Date`） |
| 额外校验 | 无 | 提交前 `expiresAtMustBeFuture` ⇒ 过期时间**晚于当前时刻**才放行（服务端也拒，口径一致） |

**② 签发前二次确认**（`confirmGenerate`）：点「签发」不直接调接口，先弹确认框，
逐行列出**将要发生什么**：

```
套餐：标准版
会员时长：30 天
数量：10 个
发放对象：渠道A          ← 为空则**整行不出现**
批次号：B-9              ← 为空则整行不出现
兑换码过期：2027/1/1 08:00:00
```

- 按钮文案：「确认签发」/「再看看」
- 取消 ⇒ **不发请求**
- 过期时间不合法 ⇒ **就地报错**（「兑换码过期时间必须晚于当前时间」），不进确认框

**③ 签发结果：一键复制 / CSV 导出 / 模板行（P0-3）**

| 按钮 | 行为 | 细节 |
|---|---|---|
| **复制全部码** | 复制纯码列表（每行一个） | 提示「已复制 N 个兑换码」 |
| **复制 CSV** | 复制 CSV 全文（表头 + 每码一行） | 含表头，运营可直接粘进表格 |
| **复制模板行** | 复制一行表头模板 | `兑换码,发放对象,批次号,套餐,会员时长(天),兑换码过期时间` |
| **导出 CSV 文件** | 下载 `.csv` | 文件名 `兑换码-<批次>-<日期>.csv`；**带 UTF-8 BOM** ⇒ Excel 打开中文不乱码 |

**CSV 列与转义**（`redemption-code-utils.js`）：

| 列 | 来源 | 备注 |
|---|---|---|
| 兑换码 | 签发结果 | 一码一行 |
| 发放对象 | 签发结果 | 自由文本，**含逗号/引号/换行要转义**（RFC 4180）否则整张表串列 |
| 批次号 | 签发结果 | |
| 套餐 | 签发结果（`standard`→标准版 / `pro`→专业版） | 显示名映射 |
| 会员时长(天) | 签发结果 | |
| 兑换码过期时间 | 签发结果 | ⚠️ **服务端必须在返回体里带它**（本轮补上，见下）|

⚠️ **列来源必须是「签发结果」而不是「当前表单」**：结果弹窗打开时表单可能已被改过
⇒ 用表单值会导出一张「看起来对、其实不是这批码」的表。

⚠️ **「签发结果」必须真的带齐每一列**（2026-10-25 独立复评 F2 实测）：
服务端签发成功时的返回体**原先不含 `expiresAt`** ⇒ 成功路径导出的 CSV 里
「兑换码过期时间」列**恒为空** ⇒ 渠道方拿到的是一批「不知道什么时候作废」的码
（失败路径当时已补了，成功路径漏了 ⇒ 两条路径口径不一致）。
⇒ 处置：**engine 的签发返回体与 409 补足失败的响应体都带上 `expiresAt`**（归一化后的 ISO 串 / null），
前端成功路径也把请求参数并进结果（服务端没回时兜底）⇒ 两条路径现在列齐全且同源。

**剪贴板降级**：`navigator.clipboard` 在**非安全上下文**（局域网 http 部署）不可用
⇒ 降级到「临时 textarea + `document.execCommand('copy')`」⇒ 失败时明确提示
「复制失败，请手动选中文本复制」，**不静默失败**。

**④ 结果区文案修正**：
「完整兑换码仅本次显示，关闭后无法再次查看 —— 请先「复制全部码」或「导出 CSV」保存，再点完成。」

### 15.7 本轮的数据校验清单（逐条）

| 字段 | 校验 | 失败表现 |
|---|---|---|
| 兑换码（桌面端输入） | 4-4-4、字母表排除 I/L/O/0/1、归一化后 ≤ 12 位 | **不发请求**，就地提示（含「不包含 I、L、O 与 0、1」） |
| 兑换码（服务端） | 同一正则 + `trim().toUpperCase()` | 400 `REDEEM_CODE_FORMAT` |
| 发放对象 `issued_to` | 字符串、≤ 200 字符、**危险字符闸门**（控制字符/C1/零宽/双向覆盖与隔离/BOM） | 400 `ISSUED_TO_INVALID` |
| 批次号 `batch` | 字符串、≤ 64 字符、危险字符闸门 | 400 `BATCH_INVALID` |
| 有效期 `expires_at` | ISO 时间字符串、**晚于当前时刻** | 400 `EXPIRES_AT_INVALID` |
| 审计列表 `limit` / `offset` | 数值化 + 向下取整、limit ∈ [1,200]、offset ≥ 0 | **没传/空串/非数字** ⇒ 回退默认（50 / 0）；**合法但越界的数字** ⇒ 夹到边界（不报错） |
| 迁移文件名 | `^\d{3}_…\.sql$`；数字开头但不匹配 ⇒ 报错 | 抛 `MIGRATION_FILE_NAME_INVALID`（启动失败） |
| 客户端 IP | XFF 最右 → socket → null | 取不到 ⇒ 回退 `"unknown"`（全局限流专用） |

### 15.8 本轮的流程与时序

**桌面端兑换**：`输入（自动大写 + 自动补横线）` → `本地码型校验`
→ ❌ 不合法：就地提示、**不发请求** → ✅ 合法：`POST /api/v1/redeem`
→ 服务端：限流门（原子预占）→ 核销（行锁 + 条件更新）→ 成功清零失败计数 / 失败转正 / 非探测型归还预占
→ 桌面端三态文案（首次成功 / 幂等重放 / 幂等且已过期）

**运营中心签发**：`填表（套餐 / 时长 / 数量 / 发放对象 / 有效期 / 批次号）`
→ 点「签发」→ **有效期校验**（不合法 ⇒ 就地报错）
→ **二次确认框**（逐行列出将要发生什么；取消 ⇒ 不发请求）
→ `POST /api/v1/redemption-codes/batch`（ops 转发层把 `issued_to`→`issuedTo`、把有效期转 UTC ISO）
→ engine：限流/审计/落库 → 返回 `{ batch, generated, codes[], issuedTo, ... }`
→ 失败且是 `REDEEM_BATCH_INCOMPLETE` ⇒ **仍进结果弹窗**，但顶部红条提示
「请求 N 个、实际签发 M 个，请以这些为准，不要按请求数对外承诺」
→ 运营在结果弹窗里**复制 / 导出** ⇒ 关闭（完整码不再可见）

**审计查询**：`GET /api/v1/logs?limit=&offset=` ⇒ 返回该页 + **全量** `stats`。

### 15.9 本轮新增的提示文字（逐条）

| 位置 | 文字 | 触发条件 |
|---|---|---|
| 桌面端兑换输入框下方 | 输入 **12 位**激活码（形如 ABCD-EFGH-JKMN）兑换会员权益。激活码与账号绑定，一码仅可核销一次。 | 常驻 |
| 桌面端本地校验 | 激活码格式不正确，应形如 ABCD-EFGH-JKMN（不包含字母 I、L、O 与数字 0、1） | 输入不合法 |
| 运营中心有效期项 | 指兑换码本身的使用截止时间（本地时区选择，提交时按 UTC 发送）；留空表示长期有效。只能选未来的时间 —— 过期时间早于当前时刻的批次，签出来就是一批立刻作废的码。 | 常驻 |
| 运营中心签发二次确认 | 标题「确认签发」；正文逐行列出套餐 / 会员时长 / 数量 / 发放对象 / 批次号 / 兑换码过期；按钮「确认签发」「再看看」 | 点「签发」 |
| 运营中心过期时间不合法 | 兑换码过期时间必须晚于当前时间 | 过期时间 ≤ 当前时刻 |
| 运营中心结果区 | 完整兑换码仅本次显示，关闭后无法再次查看 —— 请先「复制全部码」或「导出 CSV」保存，再点完成。 | 常驻 |
| 运营中心结果区按钮 | 复制全部码 / 复制 CSV / 复制模板行 / 导出 CSV 文件 / 完成 | 结果弹窗 |
| 运营中心复制反馈 | 已复制 N 个兑换码 / 已复制 CSV 内容 / 已复制模板行 / CSV 已导出 | 对应操作成功 |
| 运营中心复制失败 | 复制失败，请手动选中文本复制 | 剪贴板两条路都失败 |
| 运营中心复制无内容 | 没有可复制的内容 | 结果为空 |
| 运营中心补足失败 | 请求 N 个，实际签发 M 个（批次 X），已列出可交付的码 | 碰撞补足失败 |

### 15.10 本轮的验收判据（补充 §9）

| # | 判据 | 怎么测 |
|---|---|---|
| B1 | 不同客户端的全局粗桶**不共享**额度 | 真 HTTP：同 `maxRpm=2`，A 用 2 次后第 3 次 429；B 的第 1 次**不** 429 |
| B2 | 限流器桶数**有上限** | 10k 身份灌入后 `bucketCounts()` ≤ 上限 |
| B3 | `1000_x.sql` **必须报错**（不是静默丢弃） | 临时目录放该文件 ⇒ `discoverMigrations` 抛 `MIGRATION_FILE_NAME_INVALID` |
| B4 | 审计列表能读到第 51 条之后 | `GET /api/v1/logs?limit=100&offset=50` |
| B5 | 桌面端输入 `abcdefghjkmn` → 归一化为 `ABCD-EFGH-JKMN` 且能兑 | 纯函数 + 视图用例 |
| B6 | 桌面端输入 `IBCD…` → **不被悄悄改写**，被本地校验拒 | 纯函数 + 视图用例 |
| B7 | 桌面端文案**不再说 16 位** | 文案契约用例 |
| B8 | 运营端过期时间**只能选未来**，提交为 UTC ISO | 纯函数用例（`expiresAtToIso` / `expiresAtMustBeFuture` / `isPastDate`）+ **流程行为用例**（`runIssueFlow`：过期时间不合法 ⇒ **不进确认框、更不发请求**） |
| B9 | 运营端签发**必须先过二次确认**，取消则不发请求 | **流程行为用例**（`runIssueFlow`：确认框被拒 ⇒ `submit` **一次都没被调用**；确认通过 ⇒ 恰好调用一次）+ 形状锁（视图走 `runIssueFlow`） |
| B10 | 运营端 CSV **转义正确**、列来源是签发结果 | 纯函数用例（含「缺列就是空列」）+ **expiresAt 列非空**用例（F2） |
| B11 | 运营端「复制全部码」在**非安全上下文**下也能复制 | **降级行为用例**（`copyTextWithFallback`：非安全上下文 ⇒ 走 `execCommand` 且**真的复制成功**、且**没有**同时走 clipboard；两条路都失败 ⇒ 明确失败不静默） |

> ⚠️ **B8 / B9 / B11 原先只落了「形状锁」**（源码里包含某个字符串），
> 而形状锁**证明不了行为**：最典型的漏网形态是「模板里留着 `@click="confirmGenerate"`，
> 但它内部直接调 submit」⇒ 形状锁照样绿，而「取消后仍然发了请求」已经发生。
> ⇒ 本轮把**规则本身**抽成**依赖注入**的纯函数（`runIssueFlow` / `copyTextWithFallback`，
> 在 `ops-center/frontend/src/views/redemption-code-utils.js`）⇒ 行为可被真用例覆盖；
> 形状锁退守为「只锁接线」，两者**不重叠**。
> （2026-10-25 独立复评 F10 实测；另附一条订正：ops-center/frontend 其实**有** `jsdom`
> 且 `@vue/test-utils` 可由根 `node_modules` 向上解析 —— 原注释「没有组件测试设施」是错的。）

### 15.10.1 第 4 轮之后补的锁（2026-10-25 独立复评驱动）

| # | 判据 | 怎么测 |
|---|---|---|
| C1 | **原型污染型键名不得打崩引擎**（`X-Forwarded-For: __proto__`） | engine 用例：5 个原型名各自独立成桶、不抛；**真实 HTTP** 层伪造头后引擎仍存活且仍有响应 |
| C2 | **分页空串算「没传」** | `clampLogPagination({limit:''})` ⇒ 50（不是 1）；`{limit:'0'}` ⇒ 1；`{limit:'2.5'}` ⇒ 2 |
| C3 | **多段 XFF 必须按最右分桶**（HTTP 层） | 发 `x-forwarded-for: 1.2.3.4, 203.0.113.77` ⇒ 落在 `203.0.113.77` 的桶上；换左端伪造值仍同一桶 |
| C4 | **CSV 的「兑换码过期时间」列必须有值** | `buildCsvFromResult` 带 `expiresAt` ⇒ 末列非空；不带 ⇒ 末列为空但**列本身必须在** |
| C5 | **兑换成功文案里档位只出现一次** | 桌面端用例：断言插值参数 `{plan}` 是显示名（不是原始 id）、`{end}` 里不含档位 |
| C6 | **运营端前端测试必须真的在 CI 里跑** | 新增 `ops-center-ci.yml` 的 `ops-center 前端测试` 作业（此前**没有任何 workflow 跑过**它 ⇒ 新增用例在 CI 里是空转的） |

---

## 16. 需要运营方拍板的事项（**不夹带进代码**）

| # | 事项 | 现状（实测） | 需要你定的口径 |
|---|---|---|---|
| 1 | **跨档压制的计价** | pro 用户兑 standard 365 天的码 ⇒ pro 的订阅 **+1 年**，订单记 standard、订阅记 pro | 时长按**码面档位**计价（standard 码只值 30 天），还是按**生效档位**计价（standard 码在 pro 账号上值 pro 的时长）？前者对运营更公平，后者对渠道更友好。**本轮不动代码**，等口径。 |
| 2 | **引擎 HTTP 处理链缺 `.catch`** | `publish-api-server.js` 的 `http.createServer(...)` 直接调 `_handle` ⇒ **任何**端点里的一个未捕获异常都会打崩进程 | 本轮已把「键可控 ⇒ 容器必须无原型链」这条堵死（§15.1），但**通用兜底**（每个请求 try/catch ⇒ 500 而不是进程死）不在本轮范围。**建议单独一轮**：这是把「单点缺陷」放大成「整站可用性」的公共放大器 |
| 3 | **三份用户手册的整体性滞后** | 本轮只订正了**激活码兑换**那一节（入口、码型、11 条提示文案）；手册其余章节仍是 2026-07/08 的旧版形态（如「许可证管理 / XOR base64 license.json」「试用横幅」——这些功能早已不存在） | 是否要单独开一轮把手册整体对齐当前实现？本轮**不做**（范围过大，且与兑换码功能无关） |

**其余「本轮不做」的项**已在 §15.0 逐条写明原因（依赖外部配置 / 属既有缺陷 / 需另开一轮），
不在此处重复。

---

## 17. 接管轮修正：一次「把别人的记录改成自己的」被门禁当场抓住

> 本节记录一次**已发生的自伤**及其修复。写在这里不是为了记流水账，
> 而是因为它引出的是一条**流程规范**（§17.4）——它比本方案任何一项功能都更容易伤到别人。

### 17.1 事实经过（一手可复现）

本 PR 的中途一版提交（`b68ab7e`）做了这样一件事：把仓里 **12 篇不属于本 PR 的执行记录**
的 frontmatter 字段 `delivered_by_pr` 统一从「各自原始 PR 号」改成 `4408`。
它的理由写得很完整、也很有说服力：「主干自红 ⇒ 这 12 篇是被 #4408 夹带进主干的 ⇒ 声明值应改成 4408」。

**该理由在事实层面不成立**（三条独立取证，每条都可机械重放）：

| # | 取证 | 读数 | 结论 |
|---|---|---|---|
| 1 | `git show 7c97f1f --name-only \| grep openspec/records` | **空** | #4408 只改了 4 个文件（`docs/ops-center-ecs-deployment.md` + `openspec/changes/official-keys-postgres-migration/{design,proposal,review-responses}.md`）⇒ **它从未把任何执行记录带进主干** |
| 2 | `scripts/lib/merge-ledger.js` 的 `addedBy`（账本唯一真源），baseRef 取 `7c97f1f` 与 `origin/main` 两个点 | 12 个路径的归属分别是 `4342 / 4343 / 4343 / 4108 / 4248 / 4140 / 4062 / 4194 / 4092 / 4345 / 4224 / 4235` | 这 12 个值**与主干上各文件原本的声明逐字相同** ⇒ 主干本就是自洽的 |
| 3 | 干净检出复跑 `node scripts/check-gate-record-debt.js`（`origin/main`@`071318d31` 与 `7c97f1f` 两个点） | **rc=0 绿**，输出里**没有**「声明的来源 PR 与主干事实不符」 | 所谓「主干自红」**不存在** |

⇒ 真因是**自己**：把 12 个原本正确的声明改成 `4408` 之后，`declared=4408` 与
`actual=4342…` 逐篇不符 ⇒ `intentMismatch` 12 条 ⇒ 门禁判红 ⇒ CI 的 `QG Changes` 红、
`Gate Result` 连坐红。

### 17.2 门禁输出里本来就有真值（为什么还是会被带偏）

`check-gate-record-debt.js` 的输出**直接印着**正确归属：

```
❌ 声明的来源 PR 与主干事实不符 12 篇（夹带记录或声明笔误，两者都必须当场看见）：
  xhs-draft-store.md —— 声明 4408 / 实际带入 4235
```

`实际带入 X` 就是 `merge-ledger.addedBy` 的取值，**是真值**。
当时没有采用它，而是另起一套 `git log --diff-filter=A` 的二次推断，得出「实际带入 4408」的相反结论
—— 而门禁输出就摆在同一屏上。

**第二个偏差**：本地复跑与 CI 结论冲突时，方向反了。
在 `b68ab7e` 这个提交上、baseRef 钉死 `7c97f1f`、用同一段脚本复跑，结果是 **12 条**（不是 0）；
CI 报 12 条、本地报 0 条，**这个矛盾本身就是「本地复跑方法有问题」的信号**，
却被当成了「CI 与本地不一致 ⇒ 本地对、CI 错」，反过来用本地结果否定 CI。

**第三个偏差**：错误结论被写成了文档（commit message + 执行记录的整节正文），
看起来像有据可依 ⇒ 后续读者会以为「#4408 夹带」是已取证的事实。

### 17.3 修复

- 12 篇 `delivered_by_pr` **恢复为 git 推出的原始归属**（等价于精确回退那一行改动）。
  **记录正文一字未改**（只改 frontmatter 的 1 行声明，共 12 行）。
- 执行记录里那节描述「顺带修掉的主干自红」的正文按事实重写。
- **功能代码零改动** ⇒ 本方案（§1–§16）的任何功能、校验、流程、提示文字**均不受影响**。

### 17.4 新增流程规范：执行记录归属字段的「取证三件套」

> 适用场景：**任何一次要改动「非本 PR 新建」的执行记录**（尤其 `delivered_by_pr` 这类归属字段）。

| # | 要求 | 为什么 |
|---|---|---|
| 1 | **先抄门禁输出的「实际带入 X」**，不许另起 `git log` 二次推断 | `merge-ledger.addedBy` 是归属的唯一真源；输出里已经有了 |
| 2 | 若要断言「主干自红」，必须附**三件套**：① 在哪个 `<SHA>` 的**干净检出**上复现 ② 复现命令 ③ 原始输出（可粘贴） | 「主干红」是**可被反驳的强主张**；没有可重放证据的主张不得用来改别人的文件 |
| 3 | 改完之后，**在同一个干净检出上再复跑一次**，确认判据转绿 | 「改完还红」说明归属判断本身错了，此时**回滚**，不许继续加改动 |

**失败形态（本次）**：三件套**一项都没有** —— 干净检出没跑、复现命令没记、原始输出没贴；
且第 1 条被违反（真值就在输出里却没用）。

### 17.5 用户手册同步（本轮一并做掉）

仓内三份用户手册（`01-docs/manual-part2.md`、`01-docs/product-manual.md`、
`01-docs/product-manual-feishu-ready.md`）里，「激活码激活（企业用户）」一节仍写着
**已经不存在的入口**（「在升级弹窗中切换到『激活码』Tab」）。
真实入口是：**会员中心 → 「订阅与方案」分区 → 页面顶部常驻的「激活码兑换」卡片**
（激活码卡片自 2026-10-24 从壳层迁入 `Subscription.vue`）。

⇒ 本轮把这三份手册该节按**当前实现**重写：入口路径、12 位码型（4-4-4）、
输入自动大写/自动补连字符、易混淆字符不自动改写、以及 §15.9 的**逐条结果文案**。
（手册的其余章节属**更早版本**的整体性滞后，不在本轮范围内 —— 已在执行记录里登记为遗留。）

---

## 附录 A：关键文件索引

| 关注点 | 文件 |
|---|---|
| 码生成 / 核销 / 签发 / 列表 / 吊销 | `packages/api-publish-engine/src/auth/subscription-service.js` |
| 仓储（行锁 / advisory lock / 续叠） | `packages/api-publish-engine/src/auth/postgres-commerce-store.js` |
| 运营路由 + 审计 | `packages/api-publish-engine/src/auth/publish-api-redeem-code-admin.js` |
| 端点与 scope 映射 | `packages/api-publish-engine/src/publish-api-server.js:463-469, 926-945, 1416-1431` |
| 档位矩阵（价格 / 配额 / rank） | `packages/api-publish-engine/src/auth/plan-matrix.js` |
| 支付回调（共用 applySubscription） | `packages/api-publish-engine/src/auth/subscription-payment.js` |
| 表结构 | `migrations/postgresql/004_member_commerce.sql:23-36` |
| 运营中心页面 | `ops-center/frontend/src/views/RedemptionCodes.vue` |
| 运营中心转发层 | `ops-center/backend/services/redeem_batch_service.py` |
| 桌面端兑换 UI | `apps/desktop/src/views/MemberCenter.vue:118-148, 218-295` |
| 桌面端 store / IPC 白名单 | `apps/desktop/src/stores/member.js:120-133`；`apps/desktop/electron/services/identity/member-api-service.js:25-27` |
| 桌面端文案 | `apps/desktop/src/locales/member-center/{zh,en}.js:10-21` |
| 运行时 SCHEMA 数组（加列必须同改） | `packages/api-publish-engine/src/auth/postgres-identity-repository.js:10-24, 104-116` |
| 限流器现状 | `packages/api-publish-engine/src/rate-limiter.js:13-27`；`publish-api-server.js:158, 777-780` |
| 行数门禁 | `.github/scripts/check-max-lines.js`；`.github/scripts/max-lines-baseline.json` |
| 本地激活删除记录 | `openspec/records/remove-dead-redemption-codes.md`；`01-docs/decision-log.md:419-437` |
| 会员中心 IA 审计（含 P1-8 本地校验缺口） | `01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md` |
| 档位机制深度分析 | `01-docs/MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md` |
| 支付 PRD（边界对齐用） | `01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md` |

### A.1 第 4 轮新增/改动的文件（§15 的落点）

| 关注点 | 文件 | 本轮改动 |
|---|---|---|
| 客户端 IP 取值（**单一真源**，两套限流共用） | `packages/api-publish-engine/src/client-ip.js` | **新增**：XFF 最右 → socket → null |
| 兑换失败限流（用户维度 + IP 维度，桶数封顶 10000） | `packages/api-publish-engine/src/auth/redeem-rate-limit.js` | **新增** |
| 全局粗桶限流（键数封顶 20000） | `packages/api-publish-engine/src/rate-limiter.js` | 改：加键数上界 + 批量逐出 |
| 审计分页参数（数值化 + 夹紧） | `packages/api-publish-engine/src/log-pagination.js` | **新增** |
| 审计分页端点接线 | `packages/api-publish-engine/src/publish-api-server.js` | 改：`/api/v1/logs` 支持 `?limit=&offset=` |
| 兑换端点限流接线 | `packages/api-publish-engine/src/auth/publish-api-redeem.js` | 改：改用 `client-ip.js` 同一口径 |
| 迁移发现（文件名不合规 ⇒ fail-closed） | `packages/api-publish-engine/src/auth/postgres-migrations.js` | 改：抛 `MIGRATION_FILE_NAME_INVALID` |
| 桌面端兑换输入归一化 + 码型常量 | `apps/desktop/src/views/member-center/constants.js` | **新增**：`normalizeRedeemInput` / `REDEEM_CODE_PATTERN` |
| 桌面端兑换卡 UI | `apps/desktop/src/views/member-center/Subscription.vue` | 改：接入归一化 + 文案「16 位」→「12 位」 |
| 桌面端兑换文案 | `apps/desktop/src/locales/member-center/{zh,en}.js` | 改：`redeemHint` 等 |
| 运营中心签发页 | `ops-center/frontend/src/views/RedemptionCodes.vue` | 改：date-picker + 二次确认 + 复制/导出 |
| 运营中心纯逻辑（校验/确认摘要/CSV/模板行） | `ops-center/frontend/src/views/redemption-code-utils.js` | **新增**（从 .vue 里抽出来 ⇒ 可单测） |
| 回归锁（engine） | `packages/api-publish-engine/test/client-ip-and-limiter-caps.test.js` | **新增**（8 例） |
| 回归锁（桌面端） | `apps/desktop/src/views/member-center/redeem-code-input.test.js` | **新增**（7 例） |
| 回归锁（桌面端接线） | `apps/desktop/src/views/member-center/Subscription.test.js` | 改（+4 例） |
| 回归锁（运营中心） | `ops-center/frontend/src/views/redemption-code-utils.test.js` | **新增**（18 例） |

## 附录 B：术语速查

| 本文档用语 | 含义 |
|---|---|
| 码面档位 | 码在库里记录的 `plan`（standard/pro） |
| 生效档位 | 用户**此刻实际持有**的档位（可能被压制保护） |
| 会员时长 | `duration_days`，兑换后获得的**天数**（30/90） |
| 码的截止使用日 | `expires_at`，码**本身**的过期时间（不兑换就作废） |
| 压制 | 低档码不覆盖高档权益，只加时长（`downgradeSuppressed`） |
| 续叠 | 新码的时长接在当前 `period_end` 之后（不是覆盖，不是重置） |
