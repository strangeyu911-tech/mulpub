# 订阅段链模型（Subscription Segments）—— 跨档压制的计价与生效模型

> **状态**：**规格已定，尚未实现。** 本文只定义模型、数据契约与验收判据；
> 任何「已实现 / 已生效」的表述都不适用于本文。
> 落地切片见 §11，诚实边界见 §12。
>
> **本文经过一轮独立对抗性复核**：复核方结论是初稿「不能直接拿去实施」，
> 抓出 **3 条阻塞级**（保剩余规则无处落地 / R1 写入顺序撞自建索引 / 配额窗口的事实基础写错）
> 与 **6 条写错**、**8 条漏项** ⇒ **已逐条处置**，处置清单见
> `openspec/records/subscription-segments.md` §5。
>
> **本文解决什么问题**：`01-docs/PRD-REDEEM-CODE-ISSUED-TO-2026-10-24.md` §16 第 1 项
> 「**跨档压制的计价**」—— pro 用户兑换「standard 365 天」码之后，低档权益应该
> 排队、生效、计价。
>
> **跨文档关系（显式点名，避免两份互补合同之间长出没人管的缝）**：
> - 本文是**订阅域**的模型真源（段链 = 事实源）。
> - `PRD-REDEEM-CODE-ISSUED-TO-2026-10-24.md` 是**兑换码签发与核销**的流程真源（码的形状、限流、签发闸）。
> - 两者在「码面档位 × 时长 → 一段订阅」这一处交接，交接契约见本文 §3.4 与 §5.1。

---

## 1. 事实基础：现状的三个缺陷（逐条带真源行号）

> 全部条目为读主干源码核实（主干 tip `a87d2d713`），不是从文档转述。

### 1.1 缺陷 A：时长直加 ⇒ 低档码在高档账号上变成高档延期券（**套利面**）

真源：`packages/api-publish-engine/src/auth/postgres-commerce-store.js`
- `:112-116` `downgradeSuppressed`：已有档位 rank **严格高于**请求档位 ⇒ 保现有档位（只压档位）。
- `:130-133` `base` / `periodEnd`：`base = 现有 current_period_end`，`periodEnd = base + durationDays`。
  ⇒ **时长无条件直加**。

⇒ 合起来的效果：pro 用户兑一张 standard 365 天码 ⇒
**订阅行仍是 pro、有效期 +365 天** ⇒ 一张 ¥590 的码交付了 ¥1190 的 pro 权益。

叠加渠道侧：运营中心签发表单的天数上限是 3650（`ops-center/frontend/src/views/RedemptionCodes.vue:113`）
⇒ 可签 10 年码，且**签发端没有任何「档位 × 时长」闸**。

### 1.2 缺陷 B：高档码抢占 ⇒ 旧档位的**剩余时长被丢弃**（不是顺延）

同一真源，`:130-133` 的 `base` 取的是 `existing.current_period_end`，
而 `UPSERT_SUBSCRIPTION`（`:12-22`）是 `ON CONFLICT (id) DO UPDATE SET plan = EXCLUDED.plan, ...`
⇒ **整个周期被覆盖**，不是接续。

⇒ 例：标准版还剩 300 天，用户兑一张 pro 365 天码 ⇒
新周期 = [今天, 今天+365] ⇒ **那 300 天标准版凭空消失**。
用户体感是「我升个级，我原来的时间没了」。

### 1.3 缺陷 C：权益只能表达「一段」⇒ 没有「排队」这个概念

真源：`migrations/postgresql/002_logto_identity.sql:22-32`
```sql
CREATE TABLE IF NOT EXISTS identity_subscriptions (
    id TEXT PRIMARY KEY,            -- 实际取值恒为 `sub-${userId}` ⇒ 一行一用户
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    provider_reference TEXT UNIQUE,
    ...
);
```
⇒ **一行一用户**（`id` 恒为 `sub-${userId}`），且 `provider_reference` 是 UNIQUE
（约束名 `identity_subscriptions_provider_reference_key`，见 `postgres-commerce-store.js:26`）。
⇒ 这张表**装不下段链**：既没有「段」的概念，也没有「下一段」的指针。

### 1.4 现有的「档位序保护」值得保留，但它的语义是「压档位」而不是「压时长」

`downgradeSuppressed` 这条保护**方向是对的**（低档码不得覆盖高档权益），
本文的模型**继承**它，并把它从「压档位」升级为「压整段（档位 + 时长）」。

---

## 2. 模型：订阅段链

### 2.1 一句话

> **订阅 = 一条由若干「段」首尾相接组成的时间轴；每一段自带「档位」与「时长」；
> 段链是订阅的唯一事实源，当前生效段是链上被结算推进到的那一段。**

### 2.2 段（segment）的字段语义

| 字段 | 含义 | 谁写 |
|---|---|---|
| `plan` | **该段的档位**（`standard` / `pro`） | 签发时定，终生不变 |
| `duration_days` | **该段的面值时长**（天数） | 签发时定，终生不变 |
| `remaining_ms` | 该段被挤下时**剩余的时长（毫秒）**。`NULL` = 从未生效过 ⇒ 长度取 `duration_days` | **仅在 demote 时写一次**，之后只读 |
| `seq` | 该段在链上的位置（**每用户单调递增**） | 插入时定；插到链中间时**其后各段整体后移** |
| `period_start` / `period_end` | 该段的**实际**起止 | 结算推进时写实（排队中的段为空） |
| `status` | `queued` / `active` / `consumed` | 插入与推进时改 |
| `source_kind` / `source_reference` | 段的来源与**幂等键**（见 §3.2） | 插入时定，终生不变 |

**不变式（必须恒成立）**：

- **I1（时间轴）**：按 `seq` 排序后，链上相邻两段首尾相接：`seg[k].period_end == seg[k+1].period_start`。
  「下一段」的时刻由上一段**实际结束**时刻决定，不由签发时刻决定。
- **I2（单活）**：任一用户**至多一个** `status='active'` 的段（机械锁：部分唯一索引）。
  ⚠ **写入顺序必须「先 demote 旧 active、再 activate 新段」** —— 反过来会撞这条索引（见 §5.1 的 D-1）。
- **I3（面值不可变）**：`plan` 与 `duration_days` 一经写入永不修改。
  ⇒ 同档「合并」**不是**把两段的时长加进一行，而是**在链上把两段排成相邻**
  ⇒ 用户可见效果等同于「延长」，而原始面值两段都在表里可审计。
  ⚠ **`remaining_ms` 不是面值**：它是「被挤下那一刻还剩多少」，与 `duration_days` 是**两个不同的量**，
  **不得互相覆盖或折算**（`duration_days` 是天、毫秒算术差最多一天 ⇒ 只用 `remaining_ms` 做剩余口径）。
- **I4（链有界）**：每用户的段数有**硬上界**（§4 V11）⇒ 链不会无限长，结算推进量也有上界。
- **I5（投影一致）**：`identity_subscriptions`（现表）是**当前生效段的物化投影**，
  不是事实源；任何时刻「投影的 plan / period」必须等于「当前生效段的 plan / period」。
- **I6（链序唯一）**：`(user_id, seq)` 唯一 ⇒ **「链上顺序」有唯一定义且可索引**
  （⚠ 不要用 `created_at` 排序代替：插入到链中间时 `created_at` 序 ≠ 链序）。

> ⚠ **本表不含 `next_segment_id` 链表指针**（初稿有，复核后删）：链序改由 `seq` 单独承载
> ⇒ 少一份「链序真源」，也避免了「指针说一套、序号说另一套」的口径分裂。
> 代价是插入到链中间要**重排 `seq`**（链长有上界 ⇒ 重排量可忽略，见 §4 V11）。

### 2.3 插入规则（跨档挤位）—— 本模型的核心

设当前生效段为 `C`（`C` 不存在 ⇒ 当前无有效订阅，档位为 `free`）。
新到段 `N` 的插入位置由 `rank` 决定（`rank` 真源：`packages/api-publish-engine/src/auth/plan-matrix.js:32`
的 `PLAN_RANK = { free: 0, standard: 1, pro: 2 }`）：

| 情形 | rank 比较 | 插入位置 | 用户可见效果 | 理由 |
|---|---|---|---|---|
| **R1 高档抢占** | `rank(N) > rank(C)` | 插到 **`C` 之前**，`N` 成为新的生效段；`C` 及其后续段**整体顺延**（不截断、不丢弃） | **立即升档**；旧档剩余时长**保留**，排在后面 | 高档码 = 升级语义；顺延保证「升级不吞时长」（修缺陷 B） |
| **R2 同档续叠** | `rank(N) == rank(C)` | 插到 **`C` 之后**（原 `C` 的下一段之前） | 当前档位的有效期**立即延长** `N.duration_days` | 同档 = 续叠语义；插在 `C` 正后方 ⇒ 与「延长」等价，且**优先于**其它排队段 |
| **R3 低档压制** | `rank(N) < rank(C)` | 插到 **链尾** | 当前权益**不变**；`C` 及其后续段走完后，`N` 生效 | 低档码 = 降级兜底语义；排队等位，不抢占 |
| **R4 无有效订阅** | 无 `C` | 成为链首并立即生效 | 开通该档位 | 冷启动 |

**R2 的插入位置为什么不是链尾**（这是最容易写错的一格）：
若同档新段排到链尾，而链上已有排队段 `B`，链会变成 `[C, B, N]`
⇒ 用户会先从 `C` 掉到 `B` 的档位、之后才回到 `N` 的档位 ⇒ **档位来回跳**。
插到 `C` 正后方 ⇒ `[C, N, B]` ⇒ 连续同档 ⇒ 视觉上就是「延长了」。

**R1 的顺延为什么不能是「丢弃」**：`C` 的剩余时长是用户已经付费/已兑换到的权益。
丢弃它就是缺陷 B（现状）。顺延则总时长不丢、只是顺序变。

**⚠ R1 必须额外保住「C 的**剩余**时长」，而不是「C 的**原**时长」**（本条是规则集里最容易写错的一格）：

`C` 若**已结算过**（`period_end` 已有值），它被挤下时它的剩余是 `C.period_end - now`，
**不是** `C.duration_days`（那是它的面值总量，包含已经用掉的那部分）。

⇒ 若在 `C` 重新生效时按 `C.period_start = N.period_end; C.period_end = C.period_start + C.duration_days` 重算，
**用户会把已过期的那些天再拿一遍**（白赚）。实测推演：标准版还剩 300 天时兑 pro 一年码，
按原时长重算 ⇒ 用户白得 65 天（已过期的部分被退还）。

⇒ **正确做法（毫秒级口径，不做天数取整）**：挤下 `C` 时，若 `C` 已结算 ⇒
```
C.remaining_ms = C.period_end - now          // 保住剩余（毫秒级精度）
C.period_start = NULL                        // 两个时刻一起清
C.period_end   = NULL                        // 否则「排队中的段为空」这条语义会破
// C 重新生效时（§2.4）：
C.period_start = 上一段.period_end
C.period_end   = C.period_start + (C.remaining_ms ?? C.duration_days * 86400000)
```
⇒ 若 `C` **未结算过**（排队中、`period_end` 为空）⇒ 无剩余可保 ⇒ `remaining_ms` 留 `NULL`，
长度取 `duration_days`。

⚠ **必须有承载它的列**：若不落 `remaining_ms` 而只在伪码里算，
「重新生效时按什么算长度」就无据可依（初稿正是此处自相矛盾：伪码仍按 `duration_days` 重算，
⇒ 规格明令禁止的「白赚 65 天」照旧发生）。⇒ **DDL 必须含 `remaining_ms`（§3.1）。**

⚠ **只有 R1 会改变已有段的位置**（R2 插在 `C` 之后、R3 插在链尾，都不动别人的位置）
⇒ ⇒ **只有 R1 需要这条保剩余规则**。
⚠ 且只有**当前生效段**可能已结算（它后面的段都还没结算）⇒ ⇒ **只有 `C` 一段需要调整**。

**R1/R2/R3 合起来的一句话规则**：
> **新段永远插在「当前生效段」或「当前生效段正后方」，除非它的档位比当前低 —— 那就排到队尾。**

### 2.4 结算推进（惰性）

推进器挂在 `packages/api-publish-engine/src/auth/subscription-service.js` 的 `settleExpiry`
（主干 `:142`），由同文件的 `getSubscriptionView`（主干 `:176`）调用 ⇒ **零新增定时任务**。

推进算法（伪码）：

```
settleExpiry(userId):
  在事务内取 advisory xact 锁 'sub:' + userId        // ⚠ 结算路径必须取这把锁（见 §6.3 的 D-2）
  chain = 该用户的全部段（按 seq 升序）
  if chain 为空:
      走现状路径（把过期订阅置 expired + 写 free 快照 + graceUntil 宽限）
  active = chain 上 status='active' 的那一段（I2 保证唯一）
  advanced = 0                                        // 本次推进了几段
  loop（最多 K 步，K = 单次结算推进上限，见 §4 V11）:
      if active.period_end 为空:                      // 首次生效：落实际起止
          active.period_start = now
          len = active.remaining_ms ?? active.duration_days * 86400000   // ⚠ 见 I3
          active.period_end  = now + len
      if active.period_end > now: break               // 仍是当前有效段
      next = chain 中 seq 紧接 active 之后的段
      if next 存在:
          active.status = 'consumed'
          next.status = 'active'
          next.period_start = active.period_end       // I1：首尾相接
          next.period_end  = next.period_start + (next.remaining_ms ?? next.duration_days * 86400000)
          重算快照 = 下一段档位的 entitlement payload；写快照
          写投影（identity_subscriptions = 下一段）
          advanced += 1
          active = next
      else:
          active.status = 'consumed'
          写投影 expired；写 free 快照 + graceUntil 宽限（沿用现状 7 天宽限）
          advanced += 1
          break
  if advanced > 1: 发**一条**汇总通知（「期间已切换 N 档，当前 X」）   // ⚠ 不要一段一条（见 §4 V12）
  else if advanced == 1: 发单段通知（「会员已到期，已自动切换到 X」）
```

**推进器只做「把已经到点的段让位」，不做「提前生效」** ⇒ 未到期的段永不被动。

⚠ **「推进」与「切换」是两件事**：段到点后**下一段立即成为 active**（这就是「切换」），
而**配额窗口不跟着换**（窗口是自然月，见 §6.4）⇒ 用户在同一个月内换档时，
配额上限换档、已用量**不清零**（现状行为，不变）。

### 2.5 面值与计价口径（本文对 §16 第 1 项的定案）

| 口径 | 定义 | pro 用户兑 standard 365 天码的结果 | 套利可能性 |
|---|---|---|---|
| **A（现状）** | 时长直加、档位保留 | pro 再 +365 天 ⇒ 交付 ¥1190 权益 | **有**（2 倍） |
| **B（价值折算）** | 按 pro 的日价把 standard 码折算成 pro 天数 | pro +181 天 | 无，但「standard 码值多少天」需要一张折算表，且与售价口径必须同源 |
| **C（本文定案）** | **档位 + 时长 = 面值**，按码面档位计价、档位决定生效时段 | 排队一段 standard 365 天，等 pro 段结束后生效 | **无**（结构上不可能） |

**定案 = C**。理由：

1. **C 让套利在结构上不可能**，而不是靠一张折算表去堵。
   折算表（B）必须与售价同源、同步更新；漏更新一次就是一次敞口。
2. **C 不需要新概念**：档位与时长本来就在码上（`identity_redeem_codes.plan` + `duration_days`）。
3. **C 顺带修掉缺陷 B**（升级不吞时长），而 B 不修它。
4. **C 对渠道公平**：卖 ¥590 的 standard 码，买家拿到的就是 365 天的 standard 权益（价值 ¥590），
   不多不少。A 口径下渠道其实占了平台的便宜（平台多付 ¥600/张），这不可持续。

**C 口径下的「值不值」问答口径（对用户与渠道都要能一句话说清）**：

> **一张码买到的是「某档位 × 某时长」，不是「某时长的当前档位」。**
> 档位决定权益强度，时长决定这段权益有多长。两者都不打折。

---

## 3. 数据模型

### 3.1 新表：`identity_subscription_segments`

> **迁移编号纪律**（`AGENTS.md`「迁移编号的唯一性纪律」 + `migrations/postgresql/009_redeem_code_issued_to.sql` 头部注释）：
> - 主干现状占用 `002 003 004 005 006 008 009`；**`007` 已被 `compute-key-envelope-migration` change 预留**
>   （见 009 的注释）⇒ **本表用 `010`**（`010` 尚未被占用；037 个在飞 PR 已逐一核对，无人加迁移文件）。
> - 台账锁的是**完整文件名 + checksum** ⇒ 同号不同名不撞台账，但**迁移按文件名字典序执行**
>   ⇒ 被 FK 引用方必须排在引用方之前：`002_logto_identity.sql`（`identity_users`）< `010_...` ✅。
> - **加文件与执行必须同批部署**（`allowPending:false` ⇒ 拆两个 PR 中间每次启动都硬失败）。
> - ⚠ **本文件必须与运行时 `SCHEMA` 数组逐字成对**（`postgres-identity-repository.js` 的 SCHEMA 数组是仅非生产执行的
>   bootstrap 路径；那里写 `CREATE TABLE IF NOT EXISTS` ⇒ 对已存在的表是 no-op）。
>   ⚠ 本表是**新表** ⇒ bootstrap 侧用 `CREATE TABLE IF NOT EXISTS` 即可（无需 ALTER），
>   但**两处必须逐字一致**，否则开发库与生产库结构漂移。

```sql
-- 订阅段链：订阅的唯一事实源（见 01-docs/PRD-SUBSCRIPTION-SEGMENTS-2026-10-25.md §2）
BEGIN;

CREATE TABLE IF NOT EXISTS identity_subscription_segments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('standard', 'pro')),
    duration_days INTEGER NOT NULL CHECK (duration_days > 0 AND duration_days <= 36500),
    -- 段在链上的位置（每用户单调递增）；插到链中间时其后各段整体后移。
    -- ⚠ 链序的唯一真源就是这一列（I6）⇒ 读链必须 ORDER BY seq，**不得**用 created_at 代替。
    seq BIGINT NOT NULL CHECK (seq > 0),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'consumed')),
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    -- 被挤下时剩余的时长（毫秒）。NULL = 从未生效过 ⇒ 长度取 duration_days。
    -- ⚠ 这是「剩余」不是「面值」（I3）⇒ 不得覆盖 duration_days，也不得两者折算。
    remaining_ms BIGINT CHECK (remaining_ms IS NULL OR remaining_ms >= 0),
    -- 段的来源：幂等键。source_reference 全局唯一 = 「同一笔授权最多落一段」。
    source_kind TEXT NOT NULL CHECK (source_kind IN ('redeem', 'payment', 'grant')),
    source_reference TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 幂等键：唯一约束**必须即时**（冲突当场暴露），不得 DEFERRABLE。
    CONSTRAINT uq_identity_subscription_segments_source_reference UNIQUE (source_reference),
    -- 链序：唯一约束**必须 DEFERRABLE** —— 单条 `UPDATE ... SET seq = seq + 1` 会**逐行**撞唯一约束
    --（行 5→6 时 6 还在）⇒ 段链插到链中间必然 23505；DEFERRABLE 把检查推迟到 COMMIT，
    -- ⚠ **DEFERRABLE 只推迟「检查」，不推迟「可见性」**：同一事务内的读者**看得到中间态**
    --   （那一瞬有重复 seq）⇒ shift 之后**不得再读链**；只有事务外的读者看不到中间态。
    -- ⚠ 与之相对，「至多一个 active」的部分唯一索引**保持即时**（那是 D-1 的错，要当场暴露）。
    CONSTRAINT uq_identity_subscription_segments_user_seq UNIQUE (user_id, seq) DEFERRABLE INITIALLY DEFERRED,
    -- 段时刻：要么两个都空（排队中），要么两个都有且终点晚于起点（已落过实际起止）。
    CHECK ((period_start IS NULL AND period_end IS NULL) OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end > period_start)),
    -- 排队中的段**不得**带时刻（规格 §2.2「排队中的段为空」这条语义在 DB 层的承载）。
    CHECK (status <> 'queued' OR (period_start IS NULL AND period_end IS NULL))
);

-- I2：任一用户至多一个 active 段（防「两个同时生效」）
-- ⚠ 写入顺序必须「先 demote 旧 active，再 activate 新段」⇒ 否则插新段时本索引立刻 23505（§5.1 D-1）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_subscription_segments_one_active
    ON identity_subscription_segments (user_id) WHERE status = 'active';

-- 读链入口：按用户 + 链序
CREATE INDEX IF NOT EXISTS idx_identity_subscription_segments_user
    ON identity_subscription_segments (user_id, seq);

COMMIT;
```

⚠ **2026-10-25（S1 实施时）的五处收紧，规格与实现已同步**：
① 段时刻 CHECK 从「允许半截」收紧为「**要么都空、要么都有且 end > start**」
   （半截段 = 写崩了留下的残骸，不该被允许）；
② 两个 UNIQUE **显式命名**（`uq_..._source_reference` / `uq_..._user_seq`）
   ⇒ 23505 能按约束名精确分类（幂等命中 vs 链序冲突 vs 单活冲突），不必猜 Postgres 的自动命名；
③ `(user_id, seq)` 加 **DEFERRABLE INITIALLY DEFERRED**（见上面注释：否则段序后移必 23505）；
④ `seq` 加 **CHECK (seq > 0)**（配合应用层「只允许正位移」⇒ 链序不会被推到非正数）；
⑤ 加 **CHECK (status <> 'queued' OR 两个时刻都空)**（把「排队中的段为空」这条语义落到 DB 层）。

⚠ **DDL 的两处上界口径不同，是有意的**：
- **段表 CHECK 上界 = 36500**（宽松，只防时间戳溢出）；
- **签发 / 授予端输入上界 = 3650**（与 UI 一致，`RedemptionCodes.vue:113` / `MemberGrants.vue:15`）。
⇒ 理由：签发端历史上**只有 UI 限、API 不限** ⇒ 生产里可能已存在 > 3650 的存量码
（`identity_redeem_codes.duration_days` 的 CHECK 只有 `> 0`，无上界）⇒
段表若也卡 3650，那些码**永久不可兑 = 已付费资产报废** ⇒ 段表放宽到 36500 兜住存量。
⚠ **存量 > 36500 的码怎么办 = 需运营方拍板**（见 §12 B9）。

### 3.2 来源与幂等键（**「幂等锁」挂在这里，不要挂在会 churn 的投影上**）

| 列 | 作用 | 依赖它防住什么 |
|---|---|---|
| `id`（PK） | 段的标识，取值 `seg-${uuid}` | — |
| `(user_id, seq)` UNIQUE | 链序唯一 | 两个段占同一位置 |
| `source_reference` UNIQUE | **一段 = 一笔授权** | **段链的幂等锁**：同一笔兑换/购买/授予重放**不会写出第二段** |
| `user_id` WHERE status='active' 部分唯一索引 | 至多一个 active | 两个段同时生效 |

**三条来源路径的赋值规则（初稿没写 ⇒ 复核判定为漏项）**：

| `source_kind` | `source_reference`（幂等键） | 产生路径 | 备注 |
|---|---|---|---|
| `redeem` | `redeem:<激活码>` | 兑换（`subscription-service.js:259-293`） | 码大写归一后拼；与现状 `order.providerReference` 同值 |
| `payment` | `wechat:<identity_orders.id>` | 微信支付回调（`subscription-payment.js:216`） | ⚠ 口径必须与现状一致，否则支付对账脚本查不到（见 §12 B7） |
| `grant` | `grant:<grantOrderId>` | 后台授予（`subscription-service.js:328-345`） | 沿用现状 grant 订单的 id |

⚠ **`identity_orders` 表本身没有 `provider_reference` 列**
（`004_member_commerce.sql:6-18` + `006` 的四条 ALTER 都没有）⇒
现状那个 `order.providerReference` 是**JS 字段**，它的值最终写进的是
**`identity_subscriptions.provider_reference`**（`postgres-commerce-store.js:13-14` 的列清单 + `:144` 的实参）。
⇒ 本模型的 `source_reference` 是**段表自己的**幂等键，**不要**假设 `identity_orders` 上有同名列。

⚠ **「幂等锁」不能继续挂在投影表上**：现状的「不重复授权」靠
`identity_subscriptions.provider_reference` 的 UNIQUE 收敛成 409
（`subscription-payment.js:209-210` 的注释明写这一点）⇒ 但段链下投影会**随生效段切换而 churn**
⇒ 一旦当前生效段来自别处，旧授权的引用就从投影上消失 ⇒ 那把锁就没了。
⇒ **必须把「不重复授权」改挂在段表的 `source_reference` 上**，并把冲突**显式收敛成 409**（不是裸 23505）。
⚠ 段表**不承载金额**：金额仍然只记在 `identity_orders`（`amount` / `currency` / `channel`）。

### 3.3 `identity_subscriptions` 降级为投影（**不改它的 schema**）

| 项 | 决定 | 理由 |
|---|---|---|
| 表结构 | **不改** | 既有读路径（`getActiveSubscription` / 快照 / 用量）零改动 ⇒ 回归面最小 |
| 语义 | 从「订阅事实」改为「**当前生效段的物化投影**」（`plan` / `status` / `current_period_start` / `current_period_end` = 当前段的 plan / start / end） | 事实源唯一（段表） |
| `provider_reference` | 继续写当前生效段来源的引用，**但它会随生效段切换而 churn** | ⚠ **它不再承担「不重复授权」的职责** —— 那把锁改挂在段表 `source_reference` 上（§3.2）⇒ 现状 23505 收敛逻辑（`postgres-commerce-store.js:146-152`）保留但语义变了 |
| 过期判定 | **从「投影表 end」迁移到「段链推进」** | 见 §6.2 的逐处清单；不做这件事就会出现「段链认为过期、投影认为没过期」的口径分裂 |

⚠ **投影 `provider_reference` churn 的连带影响（初稿漏了，复核抓出）**：
仓内 `packages/api-publish-engine/scripts/payment-reconcile.js:50-57`（severity **BLOCKING**，标题「已支付但没发权益」）
与 `:65-74`（反向孤儿）**都直接读 `identity_subscriptions.provider_reference`**：
```sql
AND NOT EXISTS ( SELECT 1 FROM identity_subscriptions s
                  WHERE s.provider_reference = 'wechat:' || o.id)
```
⇒ 用户在微信付过款、但当前生效段来自一张兑换码 ⇒ 投影引用变成 `redeem:XXXX`
⇒ 对账脚本判「已支付但没发权益」⇒ **为合法订单报 BLOCKING 计费告警**。
⇒ **这两条 SQL 必须改成查段表**：
```sql
AND NOT EXISTS ( SELECT 1 FROM identity_subscription_segments s
                  WHERE s.source_reference = 'wechat:' || o.id)
```
⇒ ⚠ 这是**必须同批落地**的改动（与 §6.2 的 M 点同一片），否则上线即产生假告警。

### 3.4 与「码」的交接契约（本文 × 兑换码 PRD 的唯一接缝）

| 码面字段 | 段面字段 | 规则 |
|---|---|---|
| `identity_redeem_codes.plan`（`standard`/`pro`） | `segments.plan` | **逐字相同**；码面档位即段档位（面值的第一半） |
| `identity_redeem_codes.duration_days` | `segments.duration_days` | **逐字相同**（面值的后一半） |
| `identity_orders.channel='redeem'` | `segments.source_kind='redeem'` + `segments.source_reference = 'redeem:' + code` | 与现状 `order.providerReference`（**JS 字段**，最终写进 `identity_subscriptions.provider_reference`）同值。⚠ **`identity_orders` 表上没有 `provider_reference` 列** ⇒ 别去找它 |
| `identity_redeem_codes.code`（`used_by`） | 段表的 `created_at` + 订单表 | 兑换审计仍以订单表与码表为准，段表不重复存码面 |

---

## 4. 数据校验清单（逐条可机械判）

| # | 校验 | 落点 | 失败语义 |
|---|---|---|---|
| V1 | `duration_days` 是整数且 `> 0` | DB CHECK + 仓储层 | 沿用 `DURATION_INVALID` / 400（`postgres-commerce-store.js:94-96` 已有） |
| V2 | 段表 `duration_days <= 36500`；**签发/授予端输入上界 = 3650**（与 UI 一致） | DB CHECK + 签发/授予服务层 + 仓储层 | `DURATION_OUT_OF_RANGE` / 400。⚠ **两处上界不同是有意的**（§3.1 末段）：签发端历史上只有限 UI、API 不限 ⇒ 生产可能已有 > 3650 的存量码 ⇒ 段表放宽兜住存量。⚠ **授予路径也必须校验**（现状只查 `> 0`：`subscription-redeem-batch.js:130-132`、`subscription-service.js:325-327`、`publish-api-redeem-code-admin.js:65,83` 直接透传请求体）⇒ 否则落段时撞 CHECK 违例 **23514 ⇒ 裸 500**（不是 400） |
| V3 | `plan ∈ ('standard','pro')` | DB CHECK + 仓储层 | 未知档位（rank = -1）**不参与比较**（沿用 `postgres-commerce-store.js:112-116` 的既有守卫） |
| V4 | 每用户至多一个 `active` 段 | 部分唯一索引（§3.1） | 撞索引 ⇒ **必须先查是不是写入顺序错了**（§5.1 D-1：先 insert 新 active 会撞）⇒ 正常业务不该撞；真撞 ⇒ 内部状态错误，**fail closed**（不静默覆盖） |
| V5 | **一笔授权最多一段** | `source_reference` UNIQUE | 撞索引 ⇒ **收敛成幂等命中**（409 / 重复投递返回既有结果），**不是裸 23505**。⚠ 现状支付路径靠投影的 `provider_reference` UNIQUE 收敛（`subscription-payment.js:209-210`）⇒ 段链下必须改挂段表，且**三条来源路径都要有对应的重放视图**（§6.1） |
| V6 | 链序唯一：`(user_id, seq)` | UNIQUE（§3.1） | 撞 ⇒ 插入位置算错，**报错不写入** |
| V7 | 单次结算推进的段数上界 | 推进循环的步数上限 | 超出 ⇒ **截断推进 + 记异常**，**不无限推进**（防止一次结算发 N 条通知、写 N 次快照） |
| V8 | 兑换**与授予**路径的时长必须落在 V1/V2 内 | 两个服务层 | 400 + 可读原因（不是 500、不是裸 23514） |
| V9 | 段的 `period_end > period_start` | DB CHECK + 写入时保证 | 越界 ⇒ fail closed |
| V10 | `identity_subscriptions` 的 `provider_reference` UNIQUE 冲突 | 现状已收敛（`:146-152`） | `ORDER_REFERENCE_CONFLICT` / 409（保持现状；⚠ 但它**不再**承担幂等职责，见 V5） |
| **V11** | **每用户段数上界**（如 50） | 签发/兑换/授予服务层 + 段表 CHECK 或计数判据 | 超限 ⇒ 400「权益段过多」（**必须给可读原因**，不能是裸 500）。⚠ 现状**成功兑换不限次数**（限流只计失败：`publish-api-redeem.js:89-93`），全局桶只按 IP ⇒ 一个账号可无限段 ⇒ 链会无限长、结算事务会无限大 |
| **V12** | **单次结算最多推进 K 段**（如 20）+ **多段推进合并成一条通知** | 结算推进器 | 超出 ⇒ 截断推进并在**下一次结算继续**（状态可恢复）；通知**合并**成一条（「期间已切换 N 档，当前 X」）⇒ 现状只发 1 条，段链下可能连发 N 条 |
| **V13** | `remaining_ms >= 0`；`remaining_ms` 与 `duration_days` **不得互相覆盖** | DB CHECK + 应用层 | 越界 ⇒ fail closed。⚠ `remaining_ms` 是「剩余」、`duration_days` 是「面值」⇒ 两者是两个量（I3） |

---

## 5. 流程

### 5.1 兑换流程（改写后）

```
POST /api/v1/redeem  { code }
  1. 格式校验（REDEEM_CODE_PATTERN）→ 400
  2. 事务内：
     a. lockRedeemCode(code) FOR UPDATE            // 同一把码行锁（现状）
     b. 码状态分支：used+本人 ⇒ 幂等重放视图（§6.1）；used+他人 ⇒ 409；disabled ⇒ 409；过期 ⇒ 410
     c. 取 advisory xact 锁 'sub:'+userId          // 与结算推进同一把（§6.3）
     c'. **先推进段链**（等价于先跑一次 settleExpiry 的推进部分）⇒ 拿到「**当前真正生效的段** C」
        ⚠ 兑换路径现状**不调用** `settleExpiry` ⇒ 不做这一步，
        **「已过期但未结算」的段会被当成当前段** ⇒ 插入位置按陈旧段算 ⇒ **不报错、只权益错位**
        （§6.2 M13）
     d. 读段链 → 定位当前生效段 C（无 ⇒ C = null，档位视为 free）
     e. **插入规则**（§2.3）：rank 比较 ⇒ 算出插入位置
        - R1：N 插到 C 前 ⇒ **先把 C 降级为 queued、再把 N 提为 active**（⛔ 顺序不可颠倒，见 D-1）
           ⚠ R1 时 C 若已结算 ⇒ 先记 `C.remaining_ms = C.period_end - now`，
           再清 `C.period_start` / `C.period_end`（§2.3 的保剩余规则）
        - R2：N 插到 C 后 ⇒ N.status='queued'
        - R3：N 插到链尾 ⇒ N.status='queued'
        - R4（无 C）：N 成为链首 ⇒ N.status='active'
        ⚠ **C.status 从 active 改 queued 是「降级为排队」，不是「取消」** ⇒ C 的时长一分不丢
     f. 若 N 成为 active（即 R1/R4）⇒ **立即**重算快照（按 N 的档位）+ 写投影
        ⚠ R1 场景下旧档位的剩余时长**不因这次抢占而消失**（缺陷 B 已修）
        ⚠ **当场落 N 的实际时刻**：`N.period_start = now`、`N.period_end = now + N.duration_days`
        ⇒ 否则 N 的时刻要等下一次惰性结算才落 ⇒ 响应里的 `periodEnd` 会是 null，
        且重放路径的 `alive` 判定（`subscription-service.js:220` 的 `new Date(null)` = 1970）
        会把「已生效」读成「未生效」⇒ **首次与重放返回体不一致**
     g. 写订单（identity_orders，plan = **码面档位**，amount = 0，channel = 'redeem'）
        —— 订单记**请求档位**，段与快照记**生效档位**，两者分列才能解释
           「为什么订单是 standard 而权益是 pro」（沿用现状 `:154-158` 的做法）
     h. markRedeemCodeUsed(code, userId)
     i. 发通知（按分支给不同文案，§9）
  3. 返回：既有键集合**一字不减**，新增段信息字段（§8）
```

> ⛔ **D-1 写入顺序铁律（R1 专用，违反即 500）**
>
> 本模型自建了「每用户至多一个 active 段」的**部分唯一索引**（§3.1）⇒
> Postgres 在**每条语句结束时**立即检查它 ⇒ **若先 `INSERT` 新段且其 `status='active'`，
> 而旧段 C 此刻还是 `'active'` ⇒ 同一 `user_id` 上两行 active ⇒ 23505 ⇒ 整个事务回滚
> ⇒ 表现为「**每次高档码兑换都失败（500）**」，且会被 V4 判成「内部状态错误」。
>
> ⇒ **必须「先 shift 后 insert，再 demote，最后 activate」**（同事务内，四步顺序不可颠倒）：
> ```
> 1) shiftSegmentSeq(userId, C.seq, +1)   -- ① 让位：C 及其后续段整体后移，空出 C.seq
> 2) insertQueuedSegment(N, seq = C.seq)   -- ② 占位：新段恒为 queued（D-1 的结构保证）
> 3) demoteActiveSegment(C)               -- ③ 降级：剩余由本行 period_end 自算，不接受调用方传值
> 4) activateSegment(N, {periodStart, periodEnd})  -- ④ 生效
> ```
>
> ⛔ **为什么「shift 必须在 insert 之前」**（独立复核实测出来的，原伪码写反了）：
>   链序唯一约束是 `DEFERRABLE INITIALLY DEFERRED` ⇒ **冲突推迟到 COMMIT 才报**。
>   若先 `INSERT N (seq=C.seq)` 再 `UPDATE 后续段 SET seq=seq+1 WHERE seq >= C.seq`
>   ⇒ **那条后移会把刚插入的 N 一起后移** ⇒ C 与 N 落到同一个 seq
>   ⇒ 违例在 **COMMIT 时**抛出 ⇒ **逃出语句级的分类器** ⇒ 裸 23505 没有 status ⇒ **500**
>   ⇒ 正是本节要消灭的「每次高档兑换都 500」。
>   ⇒ **正确顺序：先 shift（把 C 及其后续整体后移、腾出 C.seq），再 insert 到空出的 C.seq。**
>
> ⚠ 「单条 `UPDATE … SET status = CASE …` 同时改两行」这条备选**在 S1 的原语集里表达不了**
>   （原语不提供「插入 active 段」这个动作）⇒ 已弃用，别照抄。
> ⇒ ⚠ **DEFERRABLE 只推迟「检查」，不推迟「可见性」**：**同一事务内的读者看得到中间态**
>   （那一瞬有重复 seq）⇒ **shift 之后不得再读链**（只有事务外的读者看不到中间态）。
> ⇒ ⚠ **验收必须覆盖这一格**（§10.1 A22）：只测「造数据撞索引」测不到它。

### 5.2 结算流程（惰性）

见 §2.4 的伪码。触发点：`getSubscriptionView`（会员中心打开 / 权益查询）⇒ **无新增定时任务**。

### 5.3 付费续期流程（**行为不变，只换写法**）

```
购买同档（pro 买 pro）⇒ 等价于 R2 ⇒ 当前档位有效期延长 ⇒ **与现状用户可见行为一致**
购买高档（standard 账号买 pro）⇒ 等价于 R1 ⇒ 立即升档，且旧档剩余时长顺延保留
   ⚠ **与现状不同**：现状会吃掉旧档剩余时长（缺陷 B）⇒ 这一处是**行为变更**，需在发布说明里写明
购买低档（pro 账号买 standard）⇒ 等价于 R3 ⇒ 排队，等 pro 段走完生效
   ⚠ **与现状不同**：现状是「压档位 + 直加时长」⇒ 这一处也是**行为变更**
```

---

## 6. 功能逻辑

### 6.1 幂等：**三条来源路径**都要有重放视图

现状契约（**不得破坏**）：本人重放返回体必须与首次核销**键集合完全一致**
（`subscription-service.js:211` 的注释写明：Task 6 原样 spread 给客户端，缺字段即破坏前端契约）。

段链下的新增语义：

| 情形 | 语义 | 返回 |
|---|---|---|
| 码已 used + 本人 + **该段仍在链上** | 幂等命中 | **既有键集合一字不减** + 新增的段字段反映「这一段在链上的位置与状态」 |
| 码已 used + 本人 + **该段已被结算消费**（段已走完） | 幂等命中，段已兑现 | 同上，但段的 `status='consumed'` ⇒ 前端据此显示「已使用完毕」而非「排队中」 |

⚠ **幂等的三条硬约束**：
1. **不得产生第二段**（段表 `source_reference` UNIQUE 兜底，V5）。
2. **重放视图不得因为「结算又推进了一段」而键集合漂移** ⇒ 新增字段的**存在性**恒定，
   只是**值**可能变（`queued` → `consumed`）⇒ 前端必须容忍（§8 说明）。
3. ⛔ **不只有兑换有重放**：**支付回调与后台授予也必须有对应的幂等视图**
   —— 现状只有兑换有（`_idempotentRedeemView`），支付/授予靠「撞 UNIQUE ⇒ 409」兜。
   ⚠ 段链下 UNIQUE 挪到了段表 ⇒ **支付重复投递时撞段表 UNIQUE ⇒ 必须收敛成 409 / 幂等命中**，
   **不能抛裸 23505 ⇒ 500**（现状就是收敛成 409：`subscription-payment.js:209-210`）。
   ⇒ **三条来源路径的重放语义必须一致**（键集合一致 + 值可变 + 冲突收敛成 409）。

### 6.2 过期判定的逐处迁移清单（**不做这件事就会口径分裂**）

现状用「`identity_subscriptions.current_period_end > now`」判活的位置（主干行号）：

| # | 位置 | 现状 | 段链下 |
|---|---|---|---|
| M1 | `postgres-commerce-store.js:101-107` `applySubscription` 的 `existing` 查询 | `status='active' AND current_period_end > $2` | 改为「读段链取当前生效段」；投影表**不再**用于判活 |
| M2 | `postgres-commerce-store.js:130` `base` | `existing.current_period_end` | 改为「当前生效段的 period_end」；⚠ **不再**用它直加时长（那是缺陷 A） |
| M3 | `postgres-commerce-store.js:52-54` `EXPIRE_SUBSCRIPTION` SQL 常量 + `:82-85` / `:203-206` 两个 `expireSubscription` 方法 | `UPDATE ... SET status='expired' WHERE current_period_end <= NOW()` | 改为「推进段链」；无下一段时才把投影置 `expired` |
| M4 | `subscription-service.js:178` `getSubscriptionView` | `getActiveSubscription` | 改为「读当前生效段 + 窗口 end」（§8） |
| M5 | `subscription-service.js:217-220` `_idempotentRedeemView` 的 `alive` | `active.current_period_end > now` | 改为「当前生效段未走完」 |
| M6 | `subscription-service.js:291` / `:345`（+ 支付路径 `:231`）三处 `entitlementPayloadFor` 回调 | **这三处只是「按生效档位现算快照」的 payload 工厂**，⚠ **它们里面没有任何 rank 比较** —— 档位序比较与压制判定在 `postgres-commerce-store.js:112-116` | 三处都保持「按**生效档位**现算」（现状已有的保护）。⚠ 但**它们只是「快照按谁算」的出口，不是「谁生效」的判定点** ⇒ 段链下「谁生效」由插入规则决定（§2.3），快照工厂必须改成**按新写规则算出的生效档位**传进来 |
| M7 | 用量窗口 | `identity_entitlement_usage.period_start/end` | 配额窗口 = **当前生效段的窗口**（段边界切换 ⇒ 用量窗口随之重置） |
| **M8** | `postgres-commerce-store.js:193-196` **`getActiveSubscription` 仓储方法本身** | `SELECT * ... WHERE status='active' ORDER BY current_period_end DESC LIMIT 1` —— ⚠ **它不过滤过期**（`subscription-service.js:218` 的注释明写「`getActiveSubscription` 不过滤过期」） | **改为「读段链的当前生效段」**。⚠ 这是 **M1 的孪生点但不是同一点**：M1 是 `applySubscription` 里**内联**的那条 SQL，M8 是**共享仓储方法**（`getSubscriptionView` / `getUsageView` / `_idempotentRedeemView` 三处都走它）。**只改 M1 不改 M8 ⇒ 三个读取点继续拿陈旧投影** |
| **M9** | `subscription-service.js:150` 宽限基准 | `Date.parse(expired.current_period_end)` —— 段链下 `expired` 变成「被消费掉的那一段」 | 改为「**链尾**（最后一段）的结束时刻」起算 7 天宽限。⚠ 否则「链中间某段到期」会被误当成「订阅到期」⇒ 用户提前失去宽限期 |
| **M10** | `subscription-service.js:86-95` `toSubscriptionDto` | `periodEnd: toIsoOrNull(row.current_period_end)` | 该 DTO 被 `:244` 的幂等重放响应复用 ⇒ 其 `periodEnd` 语义要跟着改成**窗口 end**（口径 ②，§8），否则重放视图与首次核销**同一字段两种口径** |
| **M11** | `subscription-service.js:248` 幂等重放响应的 `periodEnd` | `alive ? toIsoOrNull(active.current_period_end) : null` | 同上：改成窗口 end（口径 ②）。⚠ 这与 §6.1「重放键集合必须一致」不冲突 —— **键集合不变，值可以变**（当前档位窗口会随时间推移） |
| **M12** | `subscription-service.js:191` `getUsageView` | 读 `getActiveSubscription` 取 plan | 随 M8 一并改；**段切换后用量视图的配额上限必须跟着换档**（否则用户已降档却仍按高档上限显示） |
| **M13** | **三个写段路径**：兑换 `subscription-service.js:259-293`（事务 `:265`、`applySubscription` `:278`）+ 后台授予 `:328-345`（`applySubscription` `:332`）+ **微信支付回调 `subscription-payment.js:216`** | 三条路径现状**都不调用** `settleExpiry` ⇒ 插入规则所依据的「当前生效段」可能是**已过期但未结算**的段 | **兑换前必须先推进段链**（或等价地先算出「当前真正生效的段」），再套 R1–R4。⚠ 否则「拿一个已过期的段当基准」算出来的插入位置是错的 —— 且这种错**不会报错**，只会让用户权益错位 |

⚠ **M1/M5 是最危险的两处**：若只改写入不改读取，段链推进后「段已过期」而「投影仍 active」
⇒ 用户到期后仍按旧档位计配额 ⇒ **权限泄漏**（这正是现状 `settleExpiry` 注释里点名的失败形态：
「订阅已 expired + 快照仍为 pro」的永久权限泄漏）。**M1/M5 必须与 M3 同批落地。**

### 6.3 并发

- **同一把锁**：`pg_advisory_xact_lock(hashtextextended('sub:'+userId, 0))`
  （现状 `postgres-commerce-store.js:100` **只在 `applySubscription` 里用**）。
  ⚠ **现状的结算路径 `settleExpiry → tx.expireSubscription`（`:82-85`）不取任何锁**
  ⇒ 段链下**必须让结算推进也取这把锁**（这是**新增要求**，不是「现状已有」）：
  否则「兑换正在插入段」与「结算正在推进段」并发 ⇒ 丢段/错位。
  ⇒ 三个写段路径（兑换 `:259-293` / 授予 `:328-345` / 支付 `subscription-payment.js:216`）
  与结算推进**共用同一把锁**。
- **链上插入的原子性**：插入 + 改 `seq` + 改状态 + 写投影 + 写快照
  **必须在同一事务**（沿用现状 `applySubscription` 的三连写纪律）。
- **两笔不同码并发兑换**：串行化 ⇒ 第二笔看到第一笔的结果 ⇒ 插入位置正确。

### 6.4 快照与用量

- 快照（`identity_entitlement_snapshots.payload`）= **当前生效段档位**的 entitlement payload。
  段切换 ⇒ 快照重算。
- 用量（`identity_entitlement_usage`）：**配额窗口 = UTC 自然月，与订阅周期无关。**
  真源：`packages/api-publish-engine/src/auth/postgres-identity-repository.js:410-411`
  ```js
  const periodStartDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const periodEndDate   = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  ```
  ⇒ **段切换只换 `quota_limit`，不换窗口、不清 `used`**
  （现有 ON CONFLICT 已支持：`postgres-identity-repository.js:311-316`
  `SET used = used + EXCLUDED.used, quota_limit = EXCLUDED.quota_limit`，
  且 `WHERE used + EXCLUDED.used <= EXCLUDED.quota_limit` 使降档后超额时正确 fail-closed 返回 429）。

> ⛔ **反例（本规格初稿写错过，代价是把套利从「时长」搬到「配额」）**
> 若把配额窗口改成「当前生效段的窗口」⇒ 窗口边界 = 段边界 ⇒ 每段一个全新窗口、`used` 从 0 起算
> ⇒ **用户攒 N 张码就拿 N 倍月配额**（PK 是 `(user_id, feature, period_start)`，每段一个 `period_start`）
> ⇒ 这与本模型要消灭的时长套利**同型**，只是换了个位置。
> ⇒ 且会打破 `migrations/postgresql/008_credit_ledger.sql:26-27` 写明的既有不变式
> （「period_start/period_end 是发放周期边界（**月初对齐**），与 `identity_entitlement_usage` 的周期口径一致，
> 便于两者对账」）。
> ⇒ **配额窗口保持自然月，是一条不可动的红线。**

---

## 7. 交互逻辑

### 7.1 会员中心读路径

```
会员中心（Subscription.vue）打开
  ⇒ GET 会员视图
      ⇒ 服务端：settleExpiry（惰性推进）→ 读当前生效段 + 窗口 end + 队列
      ⇒ 返回：
         plan / status / periodStart / periodEnd（既有键，语义见 §8）
         + currentPlanPeriodEnd（窗口 end，新增）
         + currentSegmentId（新增）
         + queuedSegments[]（新增，链上未生效段的有序列表）
```

### 7.2 兑换后的三种反馈（**必须区分，否则用户会说「兑换成功但会员没变」**）

| 场景 | 触发 | 用户可见结果 | 文案键 |
|---|---|---|---|
| **开通**（R4） | 此前无有效订阅 | 档位立即变为该档位 | `redeemSuccess`（沿用） |
| **升级**（R1） | 码面档位高于当前 | 档位立即变为该档位；**旧档剩余时长顺延保留**（会员中心「后续权益」可见） | `redeemSuccessUpgraded`（新增） |
| **续叠**（R2） | 码面档位等于当前 | 档位不变，有效期延长 | `redeemSuccessExtended`（新增） |
| **排队**（R3） | 码面档位低于当前 | **档位不变**；出现「排队中」区块，说明何时切换 | `redeemSuccessQueued`（新增） |

⚠ **R3 是本模型最大的产品风险**：用户点了兑换、看到「成功」，但会员档位没变。
⇒ **必须**在同一屏给出「排队中 + 预计生效时间 + 原因（当前档位更高）」，
**不允许**只弹一句「兑换成功」（那会被读成「没生效」）。

### 7.3 排队期间的展示

- 会员中心新增「**后续权益**」区块（位置：套餐卡下方、兑换区上方）。
- 列表项：档位名 + 时长 + **预计**生效时间 + 状态标签。
- ⚠ **「预计」与「实际」必须区分**：未结算的段的 `period_start` 为空 ⇒ 展示值是**按链顺推的推算值**
  ⇒ 标签必须写「预计」；段被结算后才显示实际时间 ⇒ 标签改成「已生效」。
- 队列为空 ⇒ 区块**不渲染**（不是渲染一个空壳）。

---

## 8. 显示项清单

| # | 显示项 | 数据来源 | 语义 | 备注 |
|---|---|---|---|---|
| D1 | 当前档位 | 当前生效段的 `plan` | 与既有 `plan` 字段一致 | 不变 |
| D2 | 有效期至 | **当前档位连续窗口的 end** | ⚠ **不是**当前段的 end | 见下方「D2 的三个口径」 |
| D3 | 后续权益列表 | 链上 `status='queued'` 的段 | 有序 | 空则不渲染 |
| D4 | 每条排队项的「预计生效时间」 | 按链顺推的 `period_start` | 推算值 | 标签「预计」 |
| D5 | 每条排队项的档位与时长 | 段的 `plan` / `duration_days` | 面值 | — |
| D6 | 兑换结果四态提示 | 插入规则的结果 | 见 §7.2 | — |
| D7 | 到期通知（切档 vs 降级） | 结算推进的分支 | 两种文案 | §9 |

### ⚠ D2 的三个口径（**必须一次说清，否则实现时必然写错**）

设链 = `[pro(生效中, 剩 100 天), standard(排队, 365 天)]`：

| 口径 | 值 | 用途 |
|---|---|---|
| ① 当前**段**的 end | pro 段结束时刻 | **结算判定**用（投影表存这个） |
| ② 当前**档位连续窗口**的 end | 从当前段起、**连续同档**的段的最后一个 end | **对外显示**用（= 100 天后） |
| ③ **链尾**的 end | 全部段走完的时刻（含排队段） | 「你一共还有多少权益」 |

- **R2（同档续叠）后**，链 = `[pro, pro(新), standard]` ⇒
  口径 ② = pro 段 end + 新段时长 ⇒ **「有效期至」延长** ✅（与现状的用户可见行为一致 ⇒ 不构成回归）
  口径 ① = pro 段 end（不变）⇒ 若对外显示 ①，用户会觉得「兑换没反应」❌
  ⇒ **对外必须用 ②**。
- **R3（低档排队）后**，链 = `[pro, standard]` ⇒ 口径 ② 仍 = pro 段 end（不变）✅
  ⇒ 「有效期至」不变，但「后续权益」多一条 ⇒ 与 §7.2 的排队文案互相印证。

⇒ **实现要求**：对外的 `periodEnd`（既有键）必须改为**口径 ②**；
**投影表 `current_period_end` 保持口径 ①**（结算判定用）⇒ 两个口径都要有名字，**不许混用**。

---

## 9. 提示文字清单（zh / en 成对）

> 位置：`apps/desktop/src/locales/member-center/{zh,en}.js`（既有兑换文案键在 `memberCenter.*` 命名空间下）。
> ⚠ **zh/en 必须成对**（仓内有 `check-locale-sync` 门禁）。
>
> ⚠ **「会员已到期」类通知文案不在 locale 里**（初稿写错过，复核抓出）：
> 通知的 title/body 是**服务端写死的中文**，落 `identity_notifications`
> （`subscription-service.js:165-171` / `postgres-commerce-store.js:171-177`），桌面端从库里渲染
> ⇒ 桌面端 locale 键**永远不会被用到** ⇒ ⛔ **不要为通知文案新增 locale 键**
> （`git grep "notify\." -- apps/desktop/src/locales` 实测 0 命中）。
> ⇒ 通知文案必须与既有「会员已到期」同处、同体例（服务端字符串，中文单语）。

| 键 | 中文 | English |
|---|---|---|
| `redeemSuccessUpgraded` | 兑换成功，已升级为 {plan}，有效期至 {end}。原 {prevPlan} 的剩余时长已保留，将在之后继续生效 | Redeemed successfully. Upgraded to {plan}, valid until {end}. Your remaining {prevPlan} period is preserved and will resume afterwards |
| `redeemSuccessExtended` | 兑换成功，{plan} 有效期已延长 {days} 天，至 {end} | Redeemed successfully. Your {plan} subscription is extended by {days} days, valid until {end} |
| `redeemSuccessQueued` | 兑换成功。当前为 {currentPlan}，该激活码的 {queuedPlan} 权益已排队，预计 {start} 生效，至 {end}。当前档位不变 | Redeemed successfully. You are on {currentPlan}; the {queuedPlan} entitlement is queued and is expected to start on {start}, valid until {end}. Your current plan is unchanged |
| `memberCenter.upcomingTitle` | 后续权益 | Upcoming entitlements |
| `memberCenter.upcomingEmptyHint` | 兑换低档激活码可在此查看排队中的权益 | Redeem a lower-tier code to see queued entitlements here |
| `memberCenter.upcomingItemExpected` | 预计 {start} 生效 | Expected to start on {start} |
| `memberCenter.upcomingItemActive` | {start} 已生效 | Started on {start} |
| （**服务端通知体**，不进 locale）`期间已切换 {n} 档，当前 {plan}，有效期至 {end}` | — |
| （**服务端通知体**，不进 locale）`会员已到期，已自动切换到 {plan}，有效期至 {end}` | — |

⚠ **文案纪律**：
1. **不得承诺「已延长」而实际只是排队**（R3 场景必须用 `redeemSuccessQueued`）。
2. **不得隐藏断崖**：pro → standard 的配额断崖很大（`dailyPublish` 1000→50、
   `videoMonthly` 3000→300、`concurrentTasks` 10→3、`maxPlatforms` ∞→15、
   `officialCreditMonthly` 3000→1500）⇒ 排队文案**应当**说明档位会变，
   让用户决定是否仍要排队（**是否提供「撤销排队」不在本轮范围**，见 §12 边界 B5）。
3. **既有文案 `redeemSuccess`（`兑换成功，已开通 {plan}，有效期至 {end}`）在 R3 场景下是错的**
   （它宣称「已开通」而实际是排队）⇒ 四个分支必须**互斥**。

---

## 10. 验收判据

> **机械可判**与**需人工**必须分开写（仓内既有纪律：机器指标在无标定集前只会制造假红）。

### 10.1 机械可判（每条都要能写成用例）

| # | 判据 | 构造 |
|---|---|---|
| A1 | R1 高档抢占：standard 账号（剩 300 天）兑 pro 365 天码 ⇒ 立即生效为 pro；**standard 那 300 天仍在链上**且未被丢弃 | 段链查询断言段数与时长总和 |
| A2 | R2 同档续叠：pro 账号兑 pro 30 天码 ⇒ 档位不变、**对外有效期 end 延长 30 天** | 断言对外 `periodEnd`（口径 ②） |
| A3 | R3 低档排队：pro 账号兑 standard 365 天码 ⇒ 档位**不变**；standard 段 `status='queued'` 且在链尾 | 断言段状态与顺序 |
| A4 | R4 冷启动：无有效订阅时兑任意码 ⇒ 立即生效 | — |
| A5 | 幂等：同一码重放 ⇒ **段数不变**（不产生第二段） | 断言段表行数 + `source_reference` UNIQUE |
| A6 | 幂等视图键集合：重放返回体的键集合与首次**完全一致**（既有契约） | 键集合比对 |
| A7 | 并发：两笔不同码同时兑换 ⇒ 段链不丢段（段数 = 2，顺序正确） | 真并发（真 PostgreSQL）+ advisory 锁 |
| A8 | 结算推进：当前段到期且有下一段 ⇒ 下一段变 active、快照按下一段档位重算、投影与段一致 | 推进后逐项比对 |
| A9 | 结算推进：当前段到期且无下一段 ⇒ 投影 expired + free 快照 + `graceUntil` 宽限（沿用现状 7 天） | — |
| A10 | 口径分裂守卫：**结算后**投影的 plan/period 必须等于当前生效段的 plan/period | 断言 I5 |
| A11 | 用量窗口：段切换后新窗口 `used` 从 0 起算（旧窗口不串） | 断言 `identity_entitlement_usage` |
| A12 | 单活守卫：同一用户不可能有两个 `active` 段（撞部分唯一索引 ⇒ fail closed） | 造数据撞索引 |
| A13 | 段面值不可变：**应用层不提供**任何改写 `plan` / `duration_days` 的语句（源码级锁 + 变异验证）；`remaining_ms` 只在 demote 时写一次（由本行 `period_end` **自算**，调用方不传值 ⇒ 结构上无法声明错值），且**不得覆盖 `duration_days`**（两者是两个量，I3） | 变异验证。⚠ **DB 层尚未挡**（无 trigger 拒改 `plan`/`duration_days`）⇒ 这条欠账**已登记**，见 §12 B12 |
| A14 | 显示项：排队场景下会员中心返回 `queuedSegments` 非空且每项带**预计**生效时间 | 断言返回体 |
| A15 | 文案分支：R1/R2/R3/R4 四种结果分别命中**互斥**的文案键（互斥性用反断言锁） | 四构造 + 反断言 |
| A16 | 迁移 checksum：新增迁移文件被改动 ⇒ 迁移台账判红（现有判据自带） | — |
| A17 | 现有契约不回退：`identity_subscriptions` 表结构零变更（`git diff` 无该表 DDL） | 差量检查 |
| A18 | 既有兑换用例全绿（回归）：#4434 的 51 个用例 + 桌面端与 ops-center 的既有套件 | 跑既有套件 |
| **A19** | **R1 保住剩余时长**：standard 还剩 300 天时兑 pro 一年码 ⇒ 之后 standard 段**只跑 300 天**（不是 365）⇒ 用户总时长 = 65 + 365 + 300 = 730 天（不多不少） | 断言段链各段时长之和 |
| **A20** | **兑换前先结算**：构造「当前段已过期但未结算」的账号再兑换 ⇒ 插入位置按**结算后的**当前段算，不得按陈旧段算 | 断言插入位置与最终链序 |
| **A21** | **R1/R2/R3 不改动未受影响段的位置与时刻**：兑换后链上其它段的 `period_start/period_end` 与兑换前一致（除被挤下的 `C` 按 A19 调整） | 逐段比对 |
| **A22** | **R1 兑换不撞 23505**：pro 账号兑 pro 码（高档抢占）⇒ 事务成功、段链里只有一个 active 段 | 真库执行 + 断言无 23505。⚠ 这条**独立于 A12**（A12 是「造数据撞索引」，测不到写入顺序） |
| **A23** | **`remaining_ms` 口径**：`duration_days` 不可变、`remaining_ms` 只在 demote 时写一次；两者不得互相覆盖 | 断言字段 |
| **A24** | **配额窗口仍是自然月**：段切换后 `identity_entitlement_usage` 的 `period_start/period_end` **不变**（仍是月初对齐），只有 `quota_limit` 变 | 断言 usage 行。⚠ 这条是**反例锁**：防止有人把窗口改成段边界（那会让攒码变成攒配额） |
| **A25** | **支付重复投递**：同一笔支付回调重放 ⇒ 段数不变 + 收敛成 409/幂等命中（**不是裸 23505**） | 真库 + 断言 |
| **A26** | **支付对账脚本不被段切换误伤**：用户付费后当前生效段来自兑换码 ⇒ `payment-reconcile.js` **不报** BLOCKING | 跑脚本 + 断言输出 |
| **A27** | **链长与推进量有界**：连续兑换到上界 ⇒ 再兑换得 400（可读原因）；一次结算跨多段 ⇒ 通知**只有一条** | 造数据 |

### 10.2 需人工（**明确不许机器代判**）

- 「排队中」提示是否让用户理解「为什么会员档位没变」。
- pro → standard 断崖是否在排队场景下可接受。
- 会员中心「后续权益」区块的排版与信息密度。

---

## 11. 实施落地清单（**分片；每片自带机械判据**）

> ⚠ **切片原则**：每片都要能独立验证；**不要把「建表」「改结算」「改读取」放进同一片**
> —— 那样无法二分定位是哪一处引入了口径分裂。

| 片 | 内容 | 机械判据 | 依赖 |
|---|---|---|---|
| **S1 表与仓储** | 新表 + 迁移 `010_subscription_segments.sql` + 运行时 SCHEMA 数组成对 + 段表读写（插段/读链/推进） | A12 / A13 / A16 / A17；迁移台账绿 | — |
| **S2 结算推进** | `settleExpiry` 挂段链推进 + 投影/快照重算 + **M1/M3/M5/M7 同步迁移** | A8 / A9 / A10 / A11 | S1 |
| **S3 兑换路径改写** | 插入规则 R1–R4 + 幂等重放视图（新增段字段）+ 订单/段的写入与唯一引用 | A1 / A2 / A3 / A4 / A5 / A6 / A7 | S1、S2 |
| **S4 会员中心 UI 与文案** | 「后续权益」区块 + 四态成功文案 + 到期通知两分支 + locale 成对 | A14 / A15 | S3 |
| **S5 签发/授予端上界（**必需**，初稿标「可选」是错的）** | 三条签发/授予路径（`subscription-redeem-batch.js:130-132`、`subscription-service.js:325-327`、`publish-api-redeem-code-admin.js:65,83`）统一走 V2 上界并映射成 400；UI 上界与 API 上界一致（3650） | 签发端用例 + **越界落段不产生 23514 裸 500** | S1 |
| **S6 支付路径与对账脚本** | 支付回调写段（`subscription-payment.js:216`）+ 段 UNIQUE 冲突收敛成 409 + `payment-reconcile.js:50-74` 改查段表 | A25 / A26 | S1、S2 |
| **S7 迁移漂移锁** | `010` 迁移与运行时 `SCHEMA` 数组的**逐字一致**锁 + 新表进 `REQUIRED_SCHEMA_RELATIONS`（`assertReady` 用 `to_regclass` 逐个校验，且 `cloud-accounts-schema-drift.test.js:72-76` 断言「清单末位 == SCHEMA 里最后一张 CREATE TABLE 的表名」⇒ **只加 SCHEMA 不加清单 ⇒ 这条既有门禁当场红**） | A16 之外的**漂移锁用例** | S1 |

### 11.1 每片都必须做的验证动作（**仓内既有纪律**）

1. **变异验证**：每条机械判据都要有「注进去必红、还原后必绿」的对照；
   ⚠ 变异前先确认**变异作用在会被读到、且没有第二道守卫兜底的位置**
   （否则「变异没红」会被误判成「锁没牙齿」）。
2. **对照实验**：疑似「主干级存量红」的失败，必须在**干净 `origin/main` 检出 + 同一套依赖**上复跑同一条命令。
3. **门禁在 CI 那个树上跑**：差量型门禁要**提交后**跑；行数类门禁要按 **merge preview（base ⊕ head）** 量。
4. ⚠ **`identity_subscriptions` 所在的仓储文件**已有行数目标 ⇒ 新逻辑**不进大文件**，一律抽独立模块
   （沿用 #4434 的做法：`publish-api-credit-consume.js` 那种独立模块 + 主文件只占几行挂载点）。
5. ⚠ **迁移加文件与执行必须同批部署**（`allowPending:false` ⇒ 拆片会让 identity 仓储启动期硬失败）。

### 11.2 切片之外**不在本轮范围**的（明确不做，避免范围蔓延）

- 排队段的**撤销 / 退款**（见 §12 边界 B5）。
- 段的**转让 / 赠送**。
- 排队段的**推送提醒**（到期前 N 天提醒「你有排队中的权益」）—— 需要新增调度，现有仓内无定时任务基建。
- 折算表（B 口径）—— 若日后要切 B，需要**独立**的换算真源与售价同源约束。

---

## 12. 诚实边界

| # | 边界 | 说明 |
|---|---|---|
| **B1** | ~~本文未经真 PostgreSQL 验证~~ **已兑现（2026-10-27）** | S1 的三条 DDL 行为断言已在 **PostgreSQL 15 + 仓里真实 `pg` 驱动 + 本仓真实仓储原语** 上实测通过（**15/15**），脚本落仓：`packages/api-publish-engine/scripts/verify-segment-ddl.js`（走 `BUSINESS_DATABASE_URL`；**可选手动工具、不进 CI** —— CI runner 没有 PG，塞进测试发现路径就是「一个从不跑的测试」）。<br>⚠ **仍未验的两处**：① **并发**（两笔兑换同时插段 / 同时结算推进）—— 沙箱无法稳定制造并发窗口；② **真库上的迁移执行链**（`runMigrations` + 台账 checksum + `allowPending:false` 的启动期行为）⇒ 这两条仍须由 S2/S3 的真库用例兑现。<br>⚠ 独立对抗性复核（逐条回源码 + 用仓内真实模块跑探针 + 把伪码转写成可执行模型跑场景）抓出的阻塞项已全部修掉。 |
| **B2** | **迁移号 `010` 有竞争风险** | 已核：主干占用 002–009（007 预留）、37 个在飞 PR 无一加迁移文件。⚠ 但 `official-keys-postgres-migration` change 在飞（PR #4458 改了它的 spec/tasks）⇒ **S1 开工当天必须重查**，若被占则顺延到下一个空号（**宁可跳号，不可撞号**）。 |
| **B3** | **配额窗口 = UTC 自然月，与订阅周期无关（红线）** | 初稿误写为「配额窗口 = 当前生效段的窗口」⇒ **会把套利从「时长」搬到「配额」**（攒 N 张码 = N 倍月配额）⇒ 已按 §6.4 订正，并加反例锁 A24。真源 `postgres-identity-repository.js:410-411`。⚠ 段切换**只换 `quota_limit`，不清 `used`**（现状 ON CONFLICT 已是这个语义，`:311-316`）。 |
| **B4** | **「预计生效时间」是推算值** | 未结算的段 `period_start` 为空，展示值按链顺推 ⇒ 若前序段因人工操作/退款变短，预计值会变。⚠ 这是「预测」不是「承诺」，文案必须用「预计」。 |
| **B5** | **排队不可撤销** | 用户在 R3 场景下无法撤销排队 ⇒ 若他反悔，只能等它生效或走人工退款。**这是本模型的产品代价**，需要运营方知晓。 |
| **B6** | **R1/R3 是行为变更，不是纯新增** | 现状「高档码吃掉旧档剩余时长」与「低档码直加时长」两个行为会被改掉 ⇒ 属于**存量用户的权益口径变更**，需要发布说明。 |
| **B7** | **投影 `provider_reference` 会 churn ⇒ 支付对账脚本会误报** | 初稿写「不受影响」是**错的**：`payment-reconcile.js:50-74` 直接读 `identity_subscriptions.provider_reference` ⇒ 用户付费后当前生效段来自兑换码 ⇒ 脚本判「已支付但没发权益」⇒ **为合法订单报 BLOCKING 计费告警**。⇒ 这两条 SQL **必须**改查段表 `source_reference`（§3.3），且**必须同批落地**（S6）。另：运营中心的「用户订阅」列表若读投影，仍只看到当前段（不受影响）；要做「历史段」报表需另建查询。 |
| **B8** | **两个待拍板项已给出默认值** | §13 的两项**本文已按建议取默认**，翻转成本已逐项写明 ⇒ 不阻塞 S1/S2 开工。 |
| **B9** | **存量超长码的处置需运营方拍板** | 签发端历史上**只有限 UI（3650）、API 不限** ⇒ `identity_redeem_codes.duration_days` 的 CHECK 只有 `> 0` ⇒ 生产里可能已存在 **> 36500 天**的存量码。段表 CHECK 上界 36500 ⇒ 超过的码**兑换时会撞 CHECK ⇒ 裸 23514/500**。⇒ 需拍板：**封顶 / grandfather（允许超长码按实际天数落段）/ 退款**。**建议 grandfather**（已付费资产不报废）。 |
| **B10** | **通知文案是服务端中文，不是 locale 键** | 「会员已到期」类文案写在服务端字符串里（`subscription-service.js:165-171`），桌面端从 `identity_notifications` 渲染 ⇒ **不要新增 locale 键**（§9）。 |
| **B11** | **配额窗口的红线** | 「窗口 = 自然月」不可动（§6.4 / B3）⇒ 任何「让配额跟着段走」的优化都是**把套利换个位置**，不是优化。 |

---

## 13. 两个待拍板项（**本文已取默认，翻转成本已写明**）

### 13.1 低档码的产品定位：**「排队兜底」**（默认）

- **默认**：低档码 = 「某档位 × 某时长」的**排队券**；它不延长当前高档，也不把时长折成高档。
- **理由**：① 套利结构上不可能；② 不需要折算表（少一个会漂移的真源）；
  ③ 对渠道公平（卖什么得什么）；④ 与「时长/面值解耦」的段链模型自洽。
- **若改为「续期 pro」**（即低档码在高档账号上按高档计时长）⇒ **等于回到 A 口径** ⇒
  套利面重新打开 ⇒ 需要另立「档位 × 时长签发闸 + 折算表」两道防线。
  **翻转成本**：§2.3 的 R3 规则要删、R2 的语义要重定义、§9 的四态文案要重写、§10 的 A3 要改、
  签发端闸变成**必需**而非可选。**⇒ 不建议翻转。**

### 13.2 段链与付费续期是否共用一张段表：**共用**（默认）

- **默认**：`identity_subscription_segments` 是**唯一**事实源；付费续期也写段表；
  `identity_subscriptions` 降级为「当前生效段」的物化投影。
- **理由**：分两张表 ⇒「我现在是什么档位 / 到期没」有两个真源 ⇒ 口径必然分裂
  （本仓已多次因「两处各算各的」出事故）。共用后**结算推进器只有一个**、**权益读取只有一个口径**。
- **代价**：付费续期路径也要改（行为在同档场景下**不变**，跨档场景下会变 ⇒ 见 §5.3 与 B6）⇒ 变更面更大。
- **若改为「分表」**：则必须额外写一条**跨表仲裁规则**（两个来源冲突时谁赢），
  且这条规则会成为新的漂移点。**⇒ 不建议。**

---

## 附录 A：关键文件索引

| 用途 | 路径 |
|---|---|
| 段链模型（本文） | `01-docs/PRD-SUBSCRIPTION-SEGMENTS-2026-10-25.md` |
| 兑换码流程真源 | `01-docs/PRD-REDEEM-CODE-ISSUED-TO-2026-10-24.md`（§16 第 1 项为本模型的前身问题） |
| 档位序与权益矩阵真源 | `packages/api-publish-engine/src/auth/plan-matrix.js` |
| 订阅写入（缺陷 A/B 落点） | `packages/api-publish-engine/src/auth/postgres-commerce-store.js` |
| 结算与视图（推进器挂点） | `packages/api-publish-engine/src/auth/subscription-service.js` |
| 权益快照读取 | `packages/api-publish-engine/src/auth/postgres-identity-repository.js` |
| 迁移目录 | `migrations/postgresql/` |
| 会员中心 UI | `apps/desktop/src/views/member-center/Subscription.vue` |
| 会员中心文案 | `apps/desktop/src/locales/member-center/{zh,en}.js` |
| 运营中心签发表单 | `ops-center/frontend/src/views/RedemptionCodes.vue` |

## 附录 B：术语

| 词 | 含义 |
|---|---|
| 段（segment） | 一段「档位 × 时长」的订阅权益，是段链的最小单位 |
| 段链（chain） | 按时间轴首尾相接的段序列，订阅的唯一事实源 |
| 当前生效段（active segment） | 链上正在计权益的那一段，`status='active'` |
| 排队段（queued segment） | 已入链但尚未生效的段 |
| 窗口 end | 口径 ②：当前档位连续窗口的结束时间（对外显示用） |
| 投影 | `identity_subscriptions`：当前生效段的物化副本，不是事实源 |
