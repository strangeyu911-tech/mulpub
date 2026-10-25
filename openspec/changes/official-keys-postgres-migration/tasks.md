# Tasks：official-compute-credit-wiring（官方算力扣减接线）

> **范围改向**：2026-10-25 由「官方 Key 池迁入 Postgres」改向为「官方算力扣减接线」。
> **定案**：`design.md` **D20**；落地形态唯一展开处：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`。
> ⚠️ **原 1–8 组按「迁表」写，全部作废**，改向后的任务组见下。

---

## 0. 前提重核（✅ **已闭合 2026-10-25**）

- [x] 0.1 **决定代理放在哪个进程** → **✅ ops-center（D-①）**。
      理由：Key 池 / 价格卡 / 事件表 / Fernet 解密 / httpx 全在 ops-center ⇒ 不迁表、不建信封、不碰 F3。
- [x] 0.2 **重写范围** → **✅ 本文件 + `proposal.md` + `design.md` D20 + `specs/official-keys-postgres/spec.md` 已全部改向**；
      `compute-key-envelope-migration` 已在其 `proposal.md` 顶部加**前提失效声明**。
      ⚠️ **该 change 的归档与否待人工确认**（改目录结构 = 须人工过目）。
- [x] 0.3 **账户模型缺口立项** → **✅ D-③**：独立 change + 独立评审（改 `user_id` 主键 = 破坏性变更）；
      不阻塞接线，阻塞双轨能力上线。**新迁移从 `010` 起**。
- [x] 0.4 **订正迁移编号** → **✅ 已订正**：`007` **已释放**（原「被 `compute-key-envelope-migration` 预定」
      只是规格层预留，而该 change 前提已失效 ⇒ 磁盘与规格**都不再占 007**，实测 `migrations/postgresql/` 无 `007_*.sql`）；
      实测占用 `002/003/004/005/006_payment_orders/008_credit_ledger/009_redeem_code_issued_to` ⇒ **新迁移从 `010` 起**。
      ⚠️ **本 change 不新增迁移**（供给侧零迁表）⇒ 编号问题归零。
- [x] 0.5 **确认编号现状** → **✅ 已实测**（见 0.4）；且真实约束是 **FK 建表顺序 = 文件名 `localeCompare` 序**，不是「撞号」。

---

## 1. 规格层（契约先落地，代码后动）

- [x] 1.1 **扣分端点契约**：`POST /api/v1/credit/consume` 的请求/响应/错误码表
      （见 `DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §3.3）写入 `specs/official-keys-postgres/spec.md`。
      → **✅ 2026-10-25 已落地**：`01-docs/PRD-CREDIT-CONSUME-API-2026-10-25.md`（**契约真源**：逐字段校验 + 错误码表 + 跨库单位换算 + 提示文字）
      ＋ `specs/official-keys-postgres/spec.md` 的 Requirement 增补；实现 `packages/api-publish-engine/src/auth/publish-api-credit-consume.js`。
- [x] 1.2 **服务间鉴权方案定案（U-1）**：⚠️ **若需在 api-publish-engine 新增独立于用户 Bearer 的服务凭据校验** ⇒
      属「**谁来守门**」级别 ⇒ **须人工过目，agent 不得自行改**。
      → **✅ 2026-10-25 关闭（走「复用既有」分支，不需人工过目）**：仓内**已有**服务间通道 ——
      `ops-center/backend/services/member_grant_service.py` 用 Logto M2M token（`engine_admin_token`）
      调 `/api/v1/admin/member/grant`（engine 侧只认带 `admin:users` scope 的 logto 身份，静态主密钥被显式拒绝）
      ⇒ 扣分端点**复用同一套**：`engine_admin_token` + `admin:users` scope + handler 内硬判 `authType === 'logto'`
      ⇒ **不新增独立服务凭据校验、不新增 scope、不新增部署配置面** ⇒ 不落入「谁来守门」级别。
      ⚠️ 连带关掉定案 §13.2 **B-8**（越权扣任意用户积分）：api_key 分支**不校验 `requiredScope`**
      ⇒ 端点必须**硬拒非 logto 身份**（已由 `credit-consume-api.test.js` 的「api_key 被拒 ⇒ 403 且不得触达仓储」锁住）。
- [x] 1.3 ~~**`official_credit` feature 补登（U-3）**~~ → **✅ 前提已失效，动作取消**：
      Phase 1 记录说 `official_credit` 不在 features 数组，但 **`plan-matrix.js:223` 现在会 push 它**
      （`if (matrix.officialCreditMonthly !== 0) features.push('official_credit')`；免费 30 / standard 1600 / pro 3330 三档都 > 0）
      ⇒ 「扣分端点拿不到 feature 授权」**不成立** ⇒ **不要动 plan-matrix 的 features**（那是定价/权益变更，须人工过目）。
      ⇒ 真正的缺口在**别处**：feature 门禁与「服务身份」互斥（见 0ter 组 B-8）。
- [ ] 1.4 **官方算力端点契约**：`POST /api/v1/compute/execute` 的入参、`idempotencyKey` 归属、返回形状。

---

## 2. api-publish-engine 侧：扣分端点

- [x] 2.1 新增 `POST /api/v1/credit/consume` 路由（`publish-api-server.js`），**复用** `credit-repository.js` 的 `consumeCredit`。
      → **✅ 2026-10-25 已落地**：`src/auth/publish-api-credit-consume.js`（**独立模块** + mixin 挂载）
      ＋ `publish-api-server.js` **只占 6 行**（该文件有逐文件行数**点名目标** 1574、**容差 0** ⇒ 新逻辑一律不进主文件）
      ＋ `bin/publish-api` 装配 `creditRepository`（**复用 identity 仓储的 pg 连接池**，不另开池）。
- [x] 2.2 `_requiredFeature(req)`（**单参**，`publish-api-server.js:475`；调用点 `:808`）为该端点返回正确 feature。
      ⚠️ **不再依赖 1.3**（该任务前提已失效）。
      → **✅ 2026-10-25 已落地（**有意偏离**：不挂 plan feature）**：扣分端点是**服务间**调用，
      调用方是 M2M、**没有用户套餐** ⇒ 挂 feature 会去校验**服务账号**的权益（主体错了）⇒ 误授权。
      ⇒ 改用**正确的两把锁**：`_requiredScope` 对本 URL 返回 `admin:users`（⛔ 不落到 POST 默认的 `publish:submit`）
      ＋ handler 内硬判 `req.auth.authType === 'logto'`（⛔ api_key 一律拒）。
      ⇒ 「准不准用官方算力」的准入归 ops-center 侧（额度预检 / 算力端点），**不归扣分端点**。
- [ ] 2.3 **错误码映射**：`CREDIT_BALANCE_EXHAUSTED`（**409**，`CreditError.status` 硬编码，`credit-repository.js:26`）/
      `CREDIT_AMOUNT_INVALID`（400，端点入口自校验）/ `CREDIT_PERIOD_INVALID`（400）/
      `CREDIT_SERVICE_UNAVAILABLE`（503）/ `CREDIT_REF_INVALID`（400）/ `CREDIT_AUTH_INVALID`（401|403）。
      ⚠️ **后四个码仓内均不存在 ⇒ 需新增**（见 U-9）。
      ⚠️ 409 的语义**唯一**：扣分在**发货后** ⇒ 409 ⇒ **挂起补扣**（不是「不发货」）。
      → **✅ 2026-10-25 已落地**：错误码集合**与定案 §3.3 完全一致**（**不新增第 8 个码**；body 不是对象归 `CREDIT_USER_INVALID`）。
      实现见 `publish-api-credit-consume.js` 的 `CREDIT_ERROR_STATUS`；逐码有测试。
      ⚠️ **U-9 仍需人工过目**（新增对外错误码属「改契约」）：本片按定案把 5 个新码**实现**了，
      但**是否对外正式公布**要人点头。
- [x] 2.4 **幂等回归测试**：同 `refId` 重复调用只扣一次、第二次 `duplicated: true`、不新增分录。
      → **✅ 2026-10-25 已落地**：`credit-consume-api.test.js` 的「幂等命中 ⇒ 200 且 `duplicated: true`」
      ＋「并发同 `refId` ⇒ 唯一索引冲突被翻译成幂等命中，**余额只扣一次、只留一条分录**」
      （假 pool 显式建模「查重强制未命中」的竞态窗口 + 23505 + 按事务 undo 链回滚）。
- [x] 2.5 **并发回归测试**：并发同用户扣减，余额不负、只允许一个成功（`balance >= amount` 的 CAS）。
      → **✅ 2026-10-25 已落地**：`credit-consume-api.test.js` 的「并发同用户、不同 `refId` ⇒ 只允许一个成功
      （另一个 409 `CREDIT_BALANCE_EXHAUSTED`）、余额不负、只留一条分录」。
      ⚠️ 顺带修掉**假 pool 自身的回滚模型错误**：原先按「BEGIN 时的快照」回滚 ⇒ 会把**别的**并发事务已提交的扣减也还原
      ⇒ 余额读数偏大 ⇒ 假红 ⇒ 改成**按事务记录自己的 undo 链**（真库 READ COMMITTED 的语义）。

---

## 3. ops-center 侧：官方算力端点

- [ ] 3.1 **选 Key**：按 `tier_access` 过滤 → **`priority` ASC**（⚠️ 不是 DESC）→ 检查 `rate_per_minute` / `daily_limit`。
      ⚠️ `get_active_keys_for_tier` **生产引用数为 0** ⇒ **必须真正接线**，不能只写函数。
- [ ] 3.2 **解密失败处置**：跳过该 Key + **告警**（不许静默跳过）。
- [ ] 3.3 **算成本**：`model_price_cards` 取当前生效价；**缺价 ⇒ 拒绝服务 + 告警**（不许静默按 0）。
- [ ] 3.4 **先落 `model_usage_events`（`status=pending`）再调上游** ⇒ 取得 `events.id`（幂等键来源）。
- [ ] 3.5 **调上游**：复用 `prompt_eval_generation_service.py` 的 httpx 模式（`Bearer` 头 + 超时）。
- [ ] 3.6 **算实际成本**：`cost_micros`（**微元**）+ `credit_cost = ceil(cost_micros / credit_unit_price_micros × multiplier)`
      （**1 积分 = 10000 微元**；`credit_unit_price_micros` 的兜底下限是 `CREDIT_UNIT_MICROS`，**不是 1**）。
      ⚠️ **只读**：上游 `credit_price_service.compute_cost_micros` **只遍历 token 五类**（`TOKEN_FIELD_TO_UNIT`）⇒
      **视频/图像/TTS/ASR 算不出成本 ⇒ `amount=0` ⇒ 每次白送**（阻断项 B-4 / U-12 待拍板）。
- [ ] 3.7 **调扣分端点**：失败 ⇒ 发货前不发货 / 发货后置 `pending_charge` + 告警。
      → **◐ 部分落地（2026-10-25）**：**客户端**已就绪 —— `ops-center/backend/services/credit_consume_service.py`
      （复用既有 M2M 凭据；**单位换算收在单一真源** `micros_to_cents()`；`refType` 写死常量；空 `refId` 入口就拒）
      ＋ 18 例 pytest。
      ⛔ **未落地**：「发货前不发货 / 发货后置 `pending_charge` + 告警」——它依赖 3.1–3.6（选 Key / 算成本 / **事件落库**）
      与 5.x（状态机 + 补扣宿主，U-14 待拍板）⇒ 归后续片。

---

## 4. 桌面端接线

- [ ] 4.1 **`usage-reporter.js` 补 `user_id`**（Logto `sub`）+ 真实 `tokens_in` / `tokens_out` / `cost`。
      ⚠️ **口径订正**：tokens **主路径已是真实聚合值**（`usage-reporter.js:85/123-125/145-147`），**仅兜底桶为 0**；
      `cost` 只在「官方代理响应自带 `cost`」时有值（`model-provider-manager.js:370-375`），**BYOK 直连路径为 NULL** ⇒
      「现状三者恒为 0」是**旧口径**。
      ⛔ 另注：日聚合桶**无 user 维度**（`usage-reporter.js:103` 的聚合键 + `model_usage_daily` 唯一键都没有 `user_id`）
      ⇒ 「载荷带 user_id」在**日聚合**上不可实现 ⇒ 阻断项，见设计文档 §13.2 B-11。
- [ ] 4.2 官方算力模式的调用路径（质量档 + 规格 → `/api/v1/compute/execute`）。
- [ ] 4.3 **`idempotencyKey` 由桌面端生成**；用户点「重试」时**复用同一个键**。
- [ ] 4.4 **显示项**（见设计文档 §8.1）：剩余积分、本月剩余天数、约可生成、本次预计消耗、剩余额度。
- [ ] 4.5 **提示文字**（zh / en **成对**，CI Gate 7 强制）：见设计文档 §8.2 的 9 条文案。

---

## 5. 用量事件状态机与挂起对账

- [ ] 5.1 事件状态机：`pending` → `charged` / `failed` / `pending_charge` / `charge_rejected`。
- [ ] 5.2 `pending_charge` 的**补扣入口**（人工可触发）。
- [ ] 5.3 **定时对账任务宿主（U-5 / U-14）**：⚠️ **跨进程裁决**（设计文档 §13.3）——调度器先例**只在 Node 侧**
      （`packages/api-publish-engine/src/scheduled-publish.js:93`）；**ops-center（Python）侧实测为零**
      （`requirements.txt` 无 APScheduler/celery/rq；`routers/scheduler.py` 是发布调度器**契约校验**，不是定时宿主）
      ⇒ 补扣要写 ops-center 的 SQLite ⇒ **Node 侧先例不可直接用** ⇒ 宿主**待人工拍板**（U-14）。
- [ ] 5.4 `client_reported_cost_micros`（⚠️ **列名是 `_micros`，不是 `_cents`**）与服务端值比对 ⇒ 差异进对拍报表。
      ⚠️ **阈值以口径真源为准：5%**（`usage-metering-spec.md:61`）—— 本文件与 PRD §4.3 旧写的 15% **本轮已订正**。
      ⚠️ 该列**全仓无写入方** ⇒ 对拍恒空 ⇒ 恒真通过（阻断项 B-11）。
      ⚠️ 该列**全仓无写入方** ⇒ 对拍恒空 ⇒ 恒真通过（阻断项，见设计文档 §13.2 B-11）。

---

## 6. 运营后台可观测

- [ ] 6.1 官方 Key 列表加「**能否解密**」健康列（失败 ⇒ 红标 + 告警）。
- [ ] 6.2 成本台账加「**缺价**」标记列（缺价事件显式列出）。
- [ ] 6.3 「**挂起队列**」页面（列出 `pending_charge`，可人工补扣）。
- [ ] 6.4 对账报表：expected vs actual 差异。

---

## 7. 部署与文档

- [ ] 7.1 **部署文档**登记 `OPS_ENCRYPTION_KEY` 前置：**必须能解出现存至少一条 Fernet 密文**
      （`key_service.py:45-48` 在密钥不合法时会**静默 sha256 派生并改写** `settings.encryption_key`）。
- [ ] 7.2 ⚠️ **不需要**扩充 Postgres 访问控制清单（无新增库内表）⇒
      **原 OQ1 的五条判据随 D-① 失效**，但「本库不含密钥材料密文」这一条**仍然成立**
      （`identity_credit_ledger` 只存 `cost_cents` 整数，**单位是「分」**，不存密文；
      ⚠️ 与供给侧的 `cost_micros`（**微元**）**单位不同** ⇒ 跨库边界必须有一次 **÷10000** 换算，
      规则见设计文档 §3.3.1；账本列是否也统一到微元 = **U-11 待拍板**（改已应用迁移 `008` ⇒ 破坏性））。
- [ ] 7.3 端到端真跑：成片 + 账本分录 + 用量事件**三方对账一致**。

---

## 8. 明确不做（Non-Goals，防止顺手扩大）

- [ ] 8.1 **不迁 `official_keys` 到 Postgres**（D-①）。
- [ ] 8.2 **不建 `official_key_envelopes` 表**、**不做存量重加密**、**不做跨语言对拍**、**不为官方 Key 引入 KMS**。
- [ ] 8.3 **不直连 Postgres 扣分**、**不建 key-broker**（D-②）。
- [ ] 8.4 **不改账户主键与轨道模型**（D-③ 属独立 change）。
- [ ] 8.5 **不改对外密钥 API 契约**（仍只返回掩码）。
- [ ] 8.6 **不实现套餐池 / 熔断 / fallback 的完整运营后台**（属另一条线；本 change 只做接线必需的最小面）。
- [ ] 8.7 **不做 reserve / settle 预扣模型**（改向后是「发货前扣分」）。
- [ ] 8.8 **不改桌面端既有 BYOK 路径**。

---

## 0bis. 第二轮对抗评审后的整改项（2026-10-25）

> 上述 1–7 组**实施前**必须先闭合本组（多为「实现时会踩」的坑）。

- [ ] 0bis.1 **`refId` 空值硬拒**：扣分端点**入口**校验 `refId` 非空 ⇒ 空值 400（**不得依赖仓储层**——`consumeCredit` 无 `if (refId)` 守卫）。
- [ ] 0bis.2 **响应体字段名用 camelCase**（`grantedTotal` / `periodStart` / `balanceAfter`），与 `credit-repository.js` 既有返回一致。
- [ ] 0bis.3 **`userId` 传 `identity_users.id`**：api-publish-engine 侧提供 `auth_subject` → `id` 的解析（它才有 `identity_users` 表）。
- [ ] 0bis.4 **错误码对齐既有实现**：`CREDIT_BALANCE_EXHAUSTED` = **409**（`CreditError.status` 硬编码）；
      `CREDIT_AMOUNT_INVALID` 由端点**入口**自己校验并转 400（仓储层抛的是 `TypeError`）；
      `CREDIT_PERIOD_INVALID` / `CREDIT_SERVICE_UNAVAILABLE` **需新增**。
- [ ] 0bis.5 **生效价判据用 `effective_to` 空串**（不是 `IS NULL`）；`tier_access` 按**整数等级码**比较。
- [ ] 0bis.6 **缺价规则两态**：官方算力场景**拒绝服务**；并**正式修订** `01-docs/usage-metering-spec.md`（BYOK 场景维持「记 0 + 告警」）。
- [ ] 0bis.7 **扣分时序按两段式**：发货前**只读**额度预检 ⇒ 不足则**不调上游**；发货后实扣。
- [ ] 0bis.8 **迁移文件名逐个核对能被 `MIGRATION_PATTERN` 认领**（只认 3 位数字；不匹配者被静默丢弃）。
- [ ] 0bis.9 **执行记录补齐两形态**：表行 + `- 保留门禁：… | 远程同步 <状态>` bullet，并补 `## CHANGELOG 条目` 小节。
- [ ] 0bis.10 **待人工过目项落地**：`compute-key-envelope-migration` 归档与否（U-8）｜服务间鉴权（U-1）｜错误码新增（U-9）。

---

## 0ter. 第 2 轮对抗复评后的阻断项（2026-10-25）

> ⚠️ **这 12 条是「开工前置条件」**，逐条对应设计文档 `01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §13.2。
> 第 2 轮评审（回归验收 / 实现对账 / 对抗复评 3 轨）在已合并版本上查出：
> **26 条实现符合性缺口 + 17 条新的可复现失效路径（8 条 CRITICAL）**，
> 且第 1 轮 93 条发现的回归验收结果是「完全修好 17 / 部分修 24 / 未修 49」。
> ⇒ **本 change 在这 12 条关闭前不可开工。**

- [ ] **0ter.B-1** ⛔ **额度预检没有通道**：契约里只有 consume 一个端点；`credit-repository.js:53` 的 `getAccount` 无任何路由
      （`publish-api-server.js` 全文 `credit` 零命中）；`PostgresCreditRepository` 生产零实例化
      ⇒ fail-closed 无落点。**读余额端点形态待拍板（U-13）**。
- [ ] **0ter.B-2** ⛔ **预检与实扣的竞态窗口 = 整个上游调用时长**；`CHECK (balance >= 0)` 使补扣物理上不可能
      ⇒ 并发下**无上限资损**。需设计级决策（预扣 / 限流 / 显式接受风险）。
- [ ] **0ter.B-3** ⚠️ **单位口径跨库不一致**（ops-center 微元 / 账本分）—— **本轮已在设计文档 §3.3.1 写死换算规则**；
      剩下的「账本列是否也改微元」= **U-11 待拍板**（改已应用迁移 = 破坏性）。
- [ ] **0ter.B-4** ⛔ **视频 / 图像 / TTS / ASR 的成本恒为 0**（`TOKEN_FIELD_TO_UNIT` 只有 5 类 token）
      ⇒ 官方算力主力场景**每次白送**；且「缺价 ⇒ 拒绝服务」不触发。**价格卡是否入库待拍板（U-12，需要定价数据）**。
- [ ] **0ter.B-5** ✅ **409 语义已唯一化**（设计文档 §3.3 错误表）—— 本条**已改**，此处登记以备追踪。
- [ ] **0ter.B-6** ⛔ **全仓 `grantCredit` 生产调用方 0** ⇒ 赠送量从未进入积分账户 ⇒ 余额恒 0 ⇒ 第一次扣分必然 409
      ⇒ 需决策「发放链路是否纳入本 change 的前置」。
- [ ] **0ter.B-7** ✅ **身份链已定案**（wire 字段 = `authSubject`，端点内解析）—— 本条**已改**。
- [ ] **0ter.B-8** ⛔ **扣分端点无身份绑定**（只禁了 `X-Catalog-Key` 与用户 Bearer 透传，没禁 api_key；错误表无 401/403）
      ⇒ 越权扣任意用户。**服务间鉴权待拍板（U-1）**。
- [ ] **0ter.B-9** ✅ **幂等两处缺口已标注**（`refType` 写死常量、`refId` 必须全局唯一）—— 本条**已改**；
      遗留的「仓储层查重非原子」需在实现时靠 DB 部分唯一索引兜底。
- [ ] **0ter.B-10** ⛔ **`pending_charge` 无补扣入口、无宿主、无终态**（仓内 `credit_cost_backfill_service.py` 只读日聚合表）
      ⇒ 挂起 = 永久白送。**调度宿主待拍板（U-14）**。
- [ ] **0ter.B-11** ⛔ **白送不可观测**：事件表**零生产写者**；`client_reported_cost_micros` **全仓无写入方**
      ⇒ 对拍恒空 ⇒ 恒真通过。需与 B-4 一并解决。
- [ ] **0ter.B-12** ⛔ **降级到更贵却说省钱**（spec 的 Requirement 原先只写「更便宜」）
      ⇒ **本轮已在 spec 加 Scenario「降级方向由运行时事实决定」**，但改的是既有 Requirement 的覆盖面 ⇒ **须人工过目**。

### 0ter 的其他条目（不在阻断链，但同样未修）

- [ ] **0ter.N-1** 第 1 轮 93 条发现中「未修 49 + 部分修 24」= **73 条**，本轮**未逐条改**
      ⇒ 逐条状态与改法在第 2 轮评审台账里 ⇒ **实施前须逐条过**。
- [ ] **0ter.N-2** 第 1 轮「设计对抗 30 条」中未修 20 + 修错 3 = **23 条**，同上。
- [ ] **0ter.N-3** 对抗复评的 MAJOR 级新发现 **R2C-16**（桌面端 `user_id` 在日聚合上不可实现）
      与 **R2C-17**（周期口径两套并存），本轮**未改**。

