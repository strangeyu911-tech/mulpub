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
- [x] 0.4 **订正迁移编号** → **✅ 已订正**：`007` 被 `compute-key-envelope-migration` 预定；
      实测占用 `002/003/004/005/006_payment_orders/008_credit_ledger/009_redeem_code_issued_to` ⇒ **新迁移从 `010` 起**。
      ⚠️ **本 change 不新增迁移**（供给侧零迁表）⇒ 编号问题归零。
- [x] 0.5 **确认编号现状** → **✅ 已实测**（见 0.4）；且真实约束是 **FK 建表顺序 = 文件名 `localeCompare` 序**，不是「撞号」。

---

## 1. 规格层（契约先落地，代码后动）

- [ ] 1.1 **扣分端点契约**：`POST /api/v1/credit/consume` 的请求/响应/错误码表
      （见 `DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §3.3）写入 `specs/official-keys-postgres/spec.md`。
- [ ] 1.2 **服务间鉴权方案定案（U-1）**：⚠️ **若需在 api-publish-engine 新增独立于用户 Bearer 的服务凭据校验** ⇒
      属「**谁来守门**」级别 ⇒ **须人工过目，agent 不得自行改**。
- [ ] 1.3 **`official_credit` feature 补登（U-3）**：Phase 1 记录明说 `official_credit` **不在 features 数组**
      ⇒ 扣分端点拿不到 feature 授权 ⇒ 补进 plan-matrix 的 features + 档位映射
      （属定价/权益变更 ⇒ **须人工过目**）。
- [ ] 1.4 **官方算力端点契约**：`POST /api/v1/compute/execute` 的入参、`idempotencyKey` 归属、返回形状。

---

## 2. api-publish-engine 侧：扣分端点

- [ ] 2.1 新增 `POST /api/v1/credit/consume` 路由（`publish-api-server.js`），**复用** `credit-repository.js` 的 `consumeCredit`。
- [ ] 2.2 `_requiredFeature(url, method)` 为该端点返回正确 feature（依赖 1.3）。
- [ ] 2.3 **错误码映射**：`CREDIT_BALANCE_EXHAUSTED`（402）/ `CREDIT_AMOUNT_INVALID`（400）/
      `CREDIT_PERIOD_INVALID`（400）/ `CREDIT_SERVICE_UNAVAILABLE`（503）。
- [ ] 2.4 **幂等回归测试**：同 `refId` 重复调用只扣一次、第二次 `duplicated: true`、不新增分录。
- [ ] 2.5 **并发回归测试**：并发同用户扣减，余额不负、只允许一个成功（`balance >= amount` 的 CAS）。

---

## 3. ops-center 侧：官方算力端点

- [ ] 3.1 **选 Key**：按 `tier_access` 过滤 → **`priority` ASC**（⚠️ 不是 DESC）→ 检查 `rate_per_minute` / `daily_limit`。
      ⚠️ `get_active_keys_for_tier` **生产引用数为 0** ⇒ **必须真正接线**，不能只写函数。
- [ ] 3.2 **解密失败处置**：跳过该 Key + **告警**（不许静默跳过）。
- [ ] 3.3 **算成本**：`model_price_cards` 取当前生效价；**缺价 ⇒ 拒绝服务 + 告警**（不许静默按 0）。
- [ ] 3.4 **先落 `model_usage_events`（`status=pending`）再调上游** ⇒ 取得 `events.id`（幂等键来源）。
- [ ] 3.5 **调上游**：复用 `prompt_eval_generation_service.py` 的 httpx 模式（`Bearer` 头 + 超时）。
- [ ] 3.6 **算实际成本**：`cost_cents` + `credit_cost = ceil(cost_cents / credit_unit_price_cents × multiplier)`。
- [ ] 3.7 **调扣分端点**：失败 ⇒ 发货前不发货 / 发货后置 `pending_charge` + 告警。

---

## 4. 桌面端接线

- [ ] 4.1 **`usage-reporter.js` 补 `user_id`**（Logto `sub`）+ 真实 `tokens_in` / `tokens_out` / `cost`（现状三者恒 0）。
- [ ] 4.2 官方算力模式的调用路径（质量档 + 规格 → `/api/v1/compute/execute`）。
- [ ] 4.3 **`idempotencyKey` 由桌面端生成**；用户点「重试」时**复用同一个键**。
- [ ] 4.4 **显示项**（见设计文档 §8.1）：剩余积分、本月剩余天数、约可生成、本次预计消耗、剩余额度。
- [ ] 4.5 **提示文字**（zh / en **成对**，CI Gate 7 强制）：见设计文档 §8.2 的 9 条文案。

---

## 5. 用量事件状态机与挂起对账

- [ ] 5.1 事件状态机：`pending` → `charged` / `failed` / `pending_charge` / `charge_rejected`。
- [ ] 5.2 `pending_charge` 的**补扣入口**（人工可触发）。
- [ ] 5.3 **定时对账任务宿主（U-5）**：⚠️ 全仓无 cron/APScheduler ⇒ **与 Phase 1 同源问题，须一并立项**
      （否则 `pending_charge` 只能人工补）。
- [ ] 5.4 `client_reported_cost_cents` 与服务端值比对 ⇒ 差异进对账报表（阈值 15%）。

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
      （`identity_credit_ledger` 只存 `cost_cents` 整数，不存密文）。
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
