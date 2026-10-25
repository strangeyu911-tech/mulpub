# Proposal: official-keys-postgres-migration（官方 Key 池迁入 Postgres —— 让信封表的外键能成立）

> **状态**：待评审（Phase 1 决策层产物，**未动手**）
> 关联：`openspec/changes/compute-key-envelope-migration`（本 change 是它的第 3 组前置）
> 关联文档：`01-docs/HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md` §附录 B（Key 池物理归属，运营方 2026-10-11 拍板 D1 = A）
> 取证基线：`Colinchui007/mulpub` @ `1af2b43dd565`（main，2026-10-23）

---

## Why

> ✅ **2026-10-25 前提级订正已闭环 —— 运营方拍板：代理放 ops-center（D-①）、扣分走一次 HTTP（D-②）、账户模型缺口立项（D-③）。**
>
> **Phase 1（`credit-cost-accounting-phase1`，2026-10-23 合入）已重铺算力计费域的地基**：
> 价格卡 / 积分单价配置 / 事件级用量（**带 user_id**）建在 **ops-center 的 SQLite**，
> 积分账户 / 不可变账本建在 **api-publish-engine 的 Postgres**；
> 且取舍 8 明写「**事件表为下一期扣减接线预留**」、取舍 9 明写「**接线留给下一期**」。
> 而 ops-center **早就在代调上游模型**（`prompt_eval_generation_service.py:140-159`）。
>
> ⇒ **「把 `official_keys` 搬到 Postgres」这个前提是错的**：
> 代理放 ops-center ⇒ Key 池 / 价格卡 / 事件表 / Fernet 解密全在**同一进程同一库**
> ⇒ **不需迁任何表、不需建信封表、不碰 F3 死结**，工作量小一个数量级；
> 且 **`compute-key-envelope-migration` 整条 change 的存在前提随之不成立**（已在其 proposal 顶部声明）。
>
> **⇒ 本 change 改向为「扣减接线」**：实现官方算力端点（ops-center）+ 扣分端点（api-publish-engine）+ 一次跨服务调用。
> **详细落地形态见 `01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（D-①/D-②/D-③）。**

**（以下为改向前的历史论据，保留供追溯）——**

`compute-key-envelope-migration` 的第 3 组（表结构与迁移文件）**卡在一个硬前提上**：

> 它的 tasks 3.1 要求建表 `official_key_envelopes(key_id UNIQUE **FK → official_keys.id
> ON DELETE CASCADE**, ...)`，
> **而 `official_keys` 这张表不在 Postgres 里。**

| 事实 | 证据 |
|---|---|
| `official_keys` 定义在 ops-center | `ops-center/backend/models.py:116-136`（`class OfficialKey(Base)`，`__tablename__ = "official_keys"`） |
| ops-center 用 **SQLite** | `ops-center/backend/database.py:8-11` `sqlite+aiosqlite:///{settings.db_path}`；`config.py:47` `db_path = "data/config.db"` |
| ops-center **无 Postgres 驱动** | `ops-center/backend/requirements.txt:11` 只有 `sqlalchemy[asyncio]`，无 `asyncpg` / `psycopg` |
| Postgres 侧**无该表** | `packages/api-publish-engine/src/auth/postgres-identity-repository.js` 的 `SCHEMA` 数组共 11 张表（`identity_users` / `identity_entitlement_snapshots` / `identity_subscriptions` / `identity_entitlement_usage` / `identity_webhook_events` / `identity_user_sessions` / `identity_orders` / `identity_redeem_codes` / `identity_notifications` / `cloud_accounts` / `cloud_account_tombstones`），**无 `official_keys`** |
| 迁移目录同样没有 | `migrations/postgresql/` 只有 `002`–`006`，无 `official_keys` 建表语句 |

**⚠️ 另有一处更根本的事实（2026-10-25 实测订正）**：
`official_keys` 与 `model_usage_daily` 住在 **ops-center 进程的 SQLite**
（`ops-center/backend/models.py:116` / `:217`；`ops-center.service` 只有 `OPS_DB_PATH`，**零 Postgres 配置**），
而权益/订单/迁移台账在 **api-publish-engine 进程的 Postgres**；桌面端**分别连这两个服务**
（`config/identity-public.json` 的 `businessApiUrl` 与 `opsCenterUrl`）。
⇒ **这不是「同仓换库」，是「把两个进程都要用的表，从一个进程的库搬到另一个进程的库」**（design.md D13）。

> **同步机制已澄清（此前两次都判反了）**：独立仓 `Colinchui007/ops-center` 已于 **2026-08-10 通过 git subtree
> 并入 mulpub（PR #475）并冻结为只读归档**（tag `archived-into-multi-publish`）；
> `deploy.sh:17-24` 现在从 `mulpub.git` **sparse-checkout `ops-center/`** 部署 ⇒ **落地对象一直是 monorepo，
> 每次部署都是最新代码，不存在同步问题**。
> ⚠️ 但 `docs/ops-center-ecs-deployment.md:35` 仍写着旧话（要求「必须确认两者同步机制」）⇒ **部署文档是真漂移**，本 change 一并订正。
**⇒ 现在落那个信封迁移文件会在部署时炸**：
`relation "official_keys" does not exist` ⇒ 迁移失败 ⇒
`postgres-identity-repository.js` 的 `assertReady`（`allowPending:false`）硬失败 ⇒
`publish-api-server.js` 打 `MEMBERSHIP_UNAVAILABLE` ⇒ **会员中心整体降级**。

**本 change 解决的就是这一步**：把 `official_keys` 搬进 Postgres，成为**单真源**，
让「服务端原子读 Key 状态」与「信封表的外键」两个需求同时成立。

---

## What Changes

- **新增**：ops-center 的**官方算力执行端点** `POST /api/v1/compute/execute`
  （选 Key → 调上游 → 算成本 → 记用量 → 扣分，全部在 ops-center 进程内完成）。
- **新增**：api-publish-engine 的**扣分端点** `POST /api/v1/credit/consume`
  （复用 Phase 1 已有的 `credit-repository.js` 的 `consumeCredit`，**不新建扣减逻辑**）。
- **修改**：桌面端 `usage-reporter.js` —— 载荷**补 `user_id`**（Logto `sub`），
  `tokens_in` / `tokens_out` / `cost` **填真实值**（现状三者恒为 0 ⇒ 成本无法归到用户）。
- **修改**：`model_usage_events` 引入**状态机**（`pending` / `charged` / `failed` / `pending_charge` / `charge_rejected`）
  与**先落库再调上游**的时序（`events.id` 是扣分的幂等键来源）。
- **不改变**：`official_keys` 的**物理归属**（仍在 ops-center 的 SQLite）、**加密形态**（Fernet 不变）、
  **对外密钥 API 契约**（`GET /api/v1/secrets/*` 仍只返回掩码，客户端依旧拿不到官方 Key）。
- **不改变**：客户端**零改动**（官方算力模式是新增的供给选项，不改既有 BYOK 路径）。

## 为什么是「接线」而不是「搬家」

改向前，本 change 与 `compute-key-envelope-migration` 是这样解耦的：

```
① official-keys-postgres-migration（改向前）
   纯搬家：表 + 数据 + 连接管理 + 双写切读。
        ↓
② compute-key-envelope-migration 的第 3/4/5 组
   建信封表 + 存量重加密 Fernet → AES-256-GCM + 跨语言对拍。
        ↓
③ 服务端代理用 Node 侧信封模块解开 Key（F3 死结闭合）
```

**改向后，这条链整体消失**：

```
① 官方算力端点（ops-center）—— Key 池 / 价格卡 / 事件表 / Fernet 解密 / httpx 全在本地
        ↓  一次 HTTP
② 扣分端点（api-publish-engine）—— 复用 consumeCredit（账户 + 不可变账本）
```

**⇒ 少掉的东西**：迁表、第二个库连接、双写/切读/回滚、信封表、存量重加密、跨语言对拍、KMS 依赖、F3 死结。
**⇒ 这不是「少做一点」，是换一个数量级。**

**顺序不再有约束**：改向后**不存在**「信封表带 FK ⇒ `official_keys` 必须先在 Postgres」这条依赖。

## 影响面

| 层 | 影响 |
|---|---|
| **ops-center** | 新增官方算力端点（router / service）；`models_credit.py` 的 `ModelUsageEvent` 加状态列；`key_service.py` 复用既有 Fernet 解密（**不改**）；**不引入 Postgres 驱动**（`requirements.txt` 不变） |
| **api-publish-engine** | 新增扣分路由（`publish-api-server.js`）+ `_requiredFeature` 的新 feature；`credit-repository.js` 的 `consumeCredit` **复用不改** |
| **桌面端** | `usage-reporter.js` 补 `user_id` 与真实 tokens/cost；新增官方算力模式的调用路径 |
| **迁移** | **本 change 不新增迁移文件**（供给侧零迁表）⇒ 编号问题归零 |
| **部署** | `OPS_ENCRYPTION_KEY` 位置不变；**不需要**扩充 Postgres 访问控制清单（无新增库内表） |
| **落地对象** | **monorepo 的 `ops-center/`**（唯一开发源；`deploy.sh` 从 `mulpub.git` sparse-checkout 部署，design.md D13） |
| **跨服务边界** | ops-center → api-publish-engine **一次 HTTP**（扣分）⇒ 需服务间鉴权（**U-1，須人工过目**） |
| **不在范围** | 账户双轨模型（`identity_credit_accounts`）—— 独立 change（D-③） |

## 迁移编号

**改向后本 change 不新增迁移文件 ⇒ 编号协调问题归零。**

（历史记录：改向前本 change 与 `compute-key-envelope-migration` 都要在 `migrations/postgresql/` 加文件、编号会撞。
2026-10-25 实测占用为 `002/003/004/005/006_payment_orders/008_credit_ledger/009_redeem_code_issued_to`
⇒ `006` 已占、`007` 已被信封 change 预定、`008`/`009` 已占 ⇒ **新迁移从 `010` 起**。）

⚠️ **D-③（账户双轨）落地时需要新迁移**，届时 SHALL 现查 `migrations/postgresql/` 并遵守：
真实约束是 **FK 建表顺序 = 文件名 `localeCompare` 序**（不是「撞号」），
且**加文件与执行必须同批部署**（`assertReady` 用 `allowPending:false`）。

## 明确不做（Non-Goals）

- **不迁 `official_keys` 到 Postgres**（D-①）—— 代理在 ops-center，供给侧零迁表。
- **不建 `official_key_envelopes` 表**、**不做存量重加密**、**不做跨语言对拍**、**不为官方 Key 引入 KMS**。
- **不直连 Postgres 扣分**、**不建 key-broker**（D-②）—— 扣减必须走仓储层的原子 CAS。
- **不改账户主键与轨道模型**（D-③ 属独立 change）。
- **不改对外密钥 API 契约**：仍只返回掩码。
- **不实现套餐池 / 熔断 / fallback 的完整运营后台**（属供给链路的另一条线；本 change 只做接线必需的最小面）。
- **不做 reserve / settle 预扣模型**：改向后是「发货前扣分」，不是「预扣-结算-退款」。
- **不改桌面端既有 BYOK 路径**。

## 原未决问题（2026-10-24 已定案）

> 三个问题全部按推荐收口，**不再阻塞实施**。

| # | 问题 | **定案** | 理由 |
|---|---|---|---|
| ~~OQ1~~ | **Postgres 的访问控制清单**：Fernet 密文迁进 Postgres ⇒ 密钥材料的暴露面从「一个 SQLite 文件」扩大到「一个库 + 其备份 / 只读副本 / 导出」 | ① **数据导出必须剔除 `official_keys` 表**（导出通常无权限管控，最易外流）<br>② **表级读权限**：只允许 ops-center 的 Key 管理面账号 SELECT；**禁止**新建 superuser 或超出表 owner 的宽权限账号<br>③ **属主**：与 ops-center 服务账号同权限级，不额外提权<br>④ **备份链路**：按现有 Postgres 库策略走，但**部署文档必须登记**「本库含密钥材料密文」<br>⑤ **SQLite 侧现状补测**：`stat -c %a data/config.db` 取实际权限并登记（`ops-center.service` 无 `UMask=`、无 chmod 600） | 密文从 SQLite 挪到 Postgres **不是新增攻击面**（两者都是「密文 + 主密钥 = 明文」）。差别只在**数据流向变多**。<br>⚠️ **评审指出「沿用现有权限模型」无可沿用之物** —— 全仓 `.sql` **零条 GRANT / CREATE ROLE** ⇒ 判据已从「沿用」改为**五条可核对的判据**。 |
| ~~OQ2~~ | **ops-center 的第二个连接用 `asyncpg` 还是 `psycopg[binary]`**？ | ~~**`psycopg[binary]`**~~ → **随 D-① 失效：不需要第二个连接** | ⚠️ **原提案写「`asyncpg` 无 C 扩展依赖、psycopg 需编译工具链」是错的** —— `psycopg[binary]` 那个 extra **正是为「不想编译」准备的**，两者都无需编译工具链。<br>且「与 Node 侧生态一致」也错（Node 侧用的是 `pg`，不是 asyncpg）。<br>**真实理由**：① 官方维护，长期无兼容风险；② SQLAlchemy 文档默认推荐；③ `binary` extra 带预编译 wheel，ECS 上 `pip install` 免编译；④ 补版本上下界 + 确认 `check-dep-audit.js` 门禁兼容；⑤ `psycopg` 与 `psycopg-binary` 两个包都要写入。 |
| ~~OQ3~~ | **SQLite 侧 `ensure_official_key_columns` 运行时 ALTER 的处置** | ~~**保留函数，但迁移完成后不再调用**~~ → **随 D-① 失效：无迁移 ⇒ 维持现状（保留并继续调用）** | 保留一个**不调用的**函数零成本；删掉后想恢复只能改代码发版。<br>Postgres 侧的表由**迁移文件**建，4 个补列直接含在表定义里（tasks 2.2），**不依赖运行时 ALTER**。 |

## 验收

> ⚠️ 改向后本 change 的验收**不再是「迁表正确性」**，而是「**扣减接线真的能扣、能对、能不重复扣**」。

1. **供给侧零迁表**：`ls migrations/postgresql/` 无本 change 的迁移文件；`official_keys` 仍在 ops-center 的 SQLite。
2. **官方 Key 的加密形态不变**：存量 Fernet 密文**原样可用**，未产生任何重加密记录。
3. **扣分端点可达**：`POST /api/v1/credit/consume` 返回 `account` / `entry` / `duplicated` 三字段。
4. **幂等**：同一 `refId` 重复调用**只扣一次**，第二次返回 `duplicated: true` 且不新增分录。
5. **fail-closed**：扣分失败时**上游未被调用**、无用量事件产生、用户收到明确提示。
6. **发货后扣分失败 ⇒ 挂起补扣**（不是退款）：事件状态为 `pending_charge` + 产生告警 + 出现在运营侧挂起队列。
7. **降级同向降扣费**：切到成本更低的备用通道时，本次扣费**同步下调**，且用户可见话术为正向表述。
8. **`user_id` 归属**：桌面端上报带 `user_id`；`model_usage_events` 的行可归到具体用户。
9. **先落库再调上游**：事件 id 在上游调用**之前**已存在（可由日志/时序证明）。
10. **缺价不许静默按 0**：目标模型无生效价 ⇒ 请求被拒绝 + 告警 + 进入运营侧「缺价」列表。
11. **端到端三方对账**：成片 + 账本分录 + 用量事件三者对账一致（金额、user_id、price_id）。
12. **失败文案**：用户可见文案明示「本次未扣除积分」；扣分未成功时**不显示「已扣除」**。

