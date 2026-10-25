# official-keys-postgres Specification

## Purpose

官方算力供给链路的**接线契约**：官方算力代理落在 ops-center（供给侧零迁表），
积分扣减经一次 HTTP 调用落到 api-publish-engine 的不可变账本。

**本能力要解决的问题**：官方算力模式下，扣分时序必须 fail-closed（积分不足就不调上游）、
扣分必须幂等（同一用量事件只扣一次）、用量必须能归到用户（带 `user_id`）、
降级必须同向降扣费、缺价必须拒绝服务（官方场景）而不是静默按 0。

## ADDED Requirements

### Requirement: 官方算力代理的物理归属

官方算力供给侧的**执行体 SHALL 部署在 ops-center 进程内**：
Key 池（`official_keys`）、价格卡（`model_price_cards`）、积分单价配置（`credit_price_config`）、
事件级用量（`model_usage_events`）、Fernet 解密能力与上游 HTTP 客户端
SHALL 全部留在 ops-center 的 SQLite 与 Python 运行时内。

供给侧 SHALL NOT 把 `official_keys` 迁入 Postgres、SHALL NOT 建立 `official_key_envelopes` 表、
SHALL NOT 把官方 Key 重加密为 AES-256-GCM、SHALL NOT 为官方 Key 引入 KMS 依赖。

#### Scenario: 供给侧零迁表

- **WHEN** 官方算力链路被实现
- **THEN** `official_keys` SHALL 仍存放在 ops-center 的 SQLite
- **AND** SHALL NOT 出现指向该表的 Postgres 迁移文件
- **AND** 理由：代理在 ops-center ⇒ Key 池与价格卡与事件表同进程同库 ⇒ 迁表只会制造跨库读点与双写/切读/回滚复杂度，而收益为零

#### Scenario: 官方 Key 的加密形态不变

- **WHEN** 官方算力链路被实现
- **THEN** `official_keys.api_key` SHALL 保持 **Fernet** 密文不变
- **AND** SHALL NOT 出现官方 Key 的第二处 `encrypt_key(...)` 写入点
- **AND** 理由：解密留在 Python 侧 ⇒ 不存在跨语言互通问题 ⇒ 重加密与 KMS 均无必要

#### Scenario: Fernet 主密钥仍须能解出现存密文

- **WHEN** 官方算力链路在生产部署
- **THEN** `OPS_ENCRYPTION_KEY` SHALL 被确认能解出现存至少一条 Fernet 密文
- **AND** 若该 key 缺失或非 Fernet 合法格式，部署 SHALL 失败并出声
- **AND** 理由：`key_service.py:45-48` 在密钥不合法时会**静默 sha256 派生并改写** `settings.encryption_key` ⇒ 存量密文全部解不开且无显式报错

### Requirement: 扣分通道的契约

ops-center SHALL 通过**一次 HTTP 调用**向 api-publish-engine 请求扣分，
端点为 `POST {businessApiUrl}/api/v1/credit/consume`。

ops-center SHALL NOT 直连 Postgres 执行扣减，SHALL NOT 引入 key-broker 服务。

#### Scenario: 扣分请求的字段契约

- **WHEN** ops-center 发起扣分调用
- **THEN** 请求体 SHALL 携带 `authSubject`、`amount`（正整数）、`costCents`（非负整数，单位**分**）、`priceId`、`reason`、`refType`、`refId`、`periodStart`、`periodEnd`
- **AND** `authSubject` SHALL 是 Logto `sub`；服务端 SHALL 在**端点内**解析为 `identity_users.id` 后再执行扣减（账本 FK 指向 `identity_users.id`）
- **AND** `refId` SHALL 等于本次用量事件的 id，且 SHALL **全局唯一**
- **AND** `refType` SHALL 等于常量 `'usage_event'`（DB 唯一索引是**部分索引**，只覆盖该值）
- **AND** `costCents` SHALL 由 ops-center 侧的 `cost_micros`（**微元**）按 **÷10000 向上取整**换算而来；SHALL NOT 用 `costCents` 反算 `amount`
- **AND** 响应 SHALL 返回 `account`（扣后账户快照）、`entry`（账本分录）、`duplicated`（幂等命中标志）

#### Scenario: refId 为空必须被拒绝

- **WHEN** 扣分请求的 `refId` 为空串
- **THEN** 端点 SHALL 在**入口**返回 400（`CREDIT_REF_INVALID`）
- **AND** SHALL NOT 依赖仓储层兜底（既有 `consumeCredit` **没有** `if (refId)` 守卫）
- **AND** 理由：空 `refId` 与任何一次空 `refId` 的扣分共用查重键 `(usage_event,'')` ⇒ 第二次起静默「已扣」但实际不扣 ⇒ 静默免费算力

#### Scenario: 幂等键保证重复调用不重复扣费

- **WHEN** 同一 `refId` 的扣分请求被重复发起
- **THEN** 服务端 SHALL 至多扣减一次
- **AND** 重复请求 SHALL 返回 `duplicated: true` 且不产生新分录
- **AND** 理由：幂等键为 `(ref_type, ref_id, entry_type='spend')` ⇒ 重试安全

#### Scenario: 扣分端点必须绑定服务身份

- **WHEN** 任何请求调用扣分端点
- **THEN** 服务端 SHALL 校验**服务间凭据**；SHALL NOT 仅凭 `publish:submit` 这类默认 scope 放行
- **AND** 理由：默认 scope 下任何持 api_key 的调用方可扣**任意** `authSubject` ⇒ 越权扣分

#### Scenario: 服务间凭据不得与用户凭据混用

- **WHEN** ops-center 调用扣分端点
- **THEN** SHALL NOT 使用桌面端的 `X-Catalog-Key`（那是 ops-center 自身的目录密钥）
- **AND** SHALL NOT 把用户 Bearer 透传为服务间凭据
- **AND** 若需在 api-publish-engine 新增服务凭据校验，该改动 SHALL 经人工过目后方可实施

### Requirement: 扣分失败的语义

扣分 SHALL 遵循 **fail-closed**：**宁可少赚，不可白送算力**。

#### Scenario: 发货前扣分失败

- **WHEN** 扣分在调用上游之前失败（余额不足或扣分服务不可用）
- **THEN** SHALL NOT 调用上游
- **AND** SHALL NOT 产生上游成本
- **AND** SHALL 向用户返回明确提示

#### Scenario: 余额不足的终态唯一

- **WHEN** 扣分调用返回 409（`CREDIT_BALANCE_EXHAUSTED`）
- **THEN** 该用量事件 SHALL 置为 `pending_charge`（挂起补扣）
- **AND** SHALL NOT 置为「不发货」终态 —— 扣分发生在**发货后**，上游成本已发生
- **AND** 「不发货」只适用于**发货前**的额度预检（那时上游未被调用）

#### Scenario: 已产出后扣分失败

- **WHEN** 上游已返回有效产出、但扣分调用失败
- **THEN** 该用量事件 SHALL 被置为 `pending_charge` 并产生告警
- **AND** SHALL NOT 执行「退款」语义
- **AND** 理由：上游已计费 ⇒ 成本真实发生 ⇒ 正确处置是**补扣**而非退款
- **AND** 补扣 SHALL 具备定时对账入口（**任务宿主待定**：先例**只在 Node 侧**、`ops-center` 侧实测为零 ⇒ 见设计文档 §11 的 U-5 / U-14）

### Requirement: 降级与扣费同向

当官方算力链路发生上游降级时，扣费 SHALL **同向调整**。

#### Scenario: 降级方向由运行时事实决定

- **WHEN** 官方 Key 池耗尽，需要切到 fallback 通道
- **THEN** 扣费方向 SHALL 由**该通道的实际单价**决定，不得预设方向
- **AND** 若 fallback 更贵，SHALL 同步提高扣费，且界面文案 SHALL NOT 宣称「更便宜」
- **AND** 理由：价格卡唯一键含 `provider_id` ⇒ 同模型不同通道可有不同价；「同向降扣费」若被窄化成「只管更便宜」⇒ 更贵时无规定 ⇒ 多扣且文案说更便宜

#### Scenario: 降级到更便宜的上游

- **WHEN** 池内成员耗尽、切换到成本更低的备用通道
- **THEN** 本次扣费 SHALL 同步下调
- **AND** 用户可见话术 SHALL 为正向表述（如「省钱模式」），SHALL NOT 使用「降级」「降质」等负面词

#### Scenario: 用户未勾选自动切换

- **WHEN** 用户未勾选「自动切换」且池内成员耗尽
- **THEN** SHALL 拒绝本次请求并返回提示
- **AND** SHALL NOT 擅自降级

### Requirement: 用量事件的用户级归属与写入时序

官方算力链路产生的事件级用量 SHALL 携带 `user_id`，且 SHALL 在**调用上游之前**落库。

#### Scenario: 桌面端上报必须带 user_id

- **WHEN** 桌面端上报用量
- **THEN** 载荷 SHALL 包含 `user_id`（Logto `sub`）与 `client_id`
- **AND** `tokens_in` / `tokens_out` / `cost` SHALL 填真实值
- **AND** 理由：现状只带 `client_id` ⇒ 成本无法归到用户 ⇒ 账本无法核对
  （⚠️ **口径订正 2026-10-25**：tokens 主路径已是真实聚合值、**仅兜底桶为 0**；`cost` 在 BYOK 直连路径为 NULL）

#### Scenario: 事件先落库再调上游

- **WHEN** ops-center 准备调用上游
- **THEN** SHALL 先落 `model_usage_events`（`status=pending`）并取得事件 id
- **AND** 该 id SHALL 作为后续扣分的 `refId`
- **AND** 理由：若上游已计费而事件未落库，重试会生成新 id ⇒ 重复扣分

### Requirement: 价格卡缺失的处理

成本核算 SHALL 以**服务端按版本化价格卡算出的值**为准；缺价 SHALL NOT 静默按 0。

#### Scenario: 当前生效价缺失

- **WHEN** 目标模型没有生效中的价格卡
- **THEN** 该次请求 SHALL 被拒绝
- **AND** SHALL 产生告警并进入运营侧的「缺价」列表
- **AND** 理由：静默按 0 会让成本统计失真 ⇒ 亏了都不知道

#### Scenario: 客户端成本仅作对拍

- **WHEN** 客户端上报了成本值
- **THEN** 服务端算出的值 SHALL 为准
- **AND** 客户端值 SHALL 仅作对拍样本，SHALL NOT 直接入账
- **AND** 差异超阈值 SHALL 进对账报表

### Requirement: 迁移编号的唯一性

Postgres 迁移文件的编号 SHALL 是跨 change 共享的单调序列。
任何迁移 change 在落库前 SHALL 现查 `migrations/postgresql/` 确认目标编号未被占，
并 SHALL 与并行中的其他迁移 change 对齐编号分配。

#### Scenario: 目标编号已被占用

- **WHEN** 拟落库的迁移文件编号已被另一个迁移文件占用
- **THEN** SHALL 改用下一个可用编号，SHALL NOT 复用或覆盖既有编号
- **AND** 规格文档中写下的旧编号 SHALL 一并更正

#### Scenario: 编号约束是 FK 建表顺序而非撞号

- **WHEN** 一个迁移文件被 FK 引用、且其文件名在字典序上大于引用方
- **THEN** 执行 SHALL 因「被引用方尚未建表」而失败
- **AND** 因此被引用方的文件名 SHALL 小于引用方
- **AND** 同前缀不同名 SHALL 可共存（迁移台账锁的是全文件名 + checksum）

#### Scenario: 加文件与执行不同批部署

- **WHEN** 一个 PR 只新增迁移文件而不执行它
- **THEN** 业务库启动 SHALL 失败（`assertReady` 用 `allowPending:false`）
- **AND** 因此「加文件」与「执行」SHALL 同批部署

### Requirement: 账户模型的边界

本 change SHALL NOT 修改 `identity_credit_accounts` 的主键与轨道模型。

#### Scenario: 双轨账户模型不在本 change 范围内

- **WHEN** 官方算力链路被实现
- **THEN** 积分账户 SHALL 继续使用当前单周期模型
- **AND** 「会员额度日释放+月清零 / 充值积分永久有效」与「FIFO 按过期时间扣减」SHALL 由**独立 change** 承载
- **AND** 该独立 change SHALL 单独评审（改主键属破坏性 schema 变更）

## MODIFIED Requirements

### Requirement: 桌面端用量上报

`UsageReporter` SHALL 从 model_provider_logs 读 `id > lastId` 记录，按上报日期+provider+category+action 聚合（calls/ok/fail/ratelimit/总耗时/tokens/cost/耗时分布桶），POST ingest，成功后水印推进（settings `opsCenterUsageReport.lastId`），失败保留重试；启动 5s 首报 + 30min 周期；无 url/key 静默跳过；不上报 error_message 等敏感内容。`addProviderLog` INSERT 补 created_at=datetime('now')。

**2026-10-25 修订（官方算力接线）**：载荷 SHALL 额外携带 **`user_id`**（Logto `sub`），
使官方算力链路的成本可归到用户（`model_usage_events` 已是 `user_id` 粒度）。

#### Scenario: 鉴权
- **WHEN** 未带/带错 X-Catalog-Key（或未配置）
- **THEN** 401（或 404）

#### Scenario: 幂等累加
- **WHEN** 同桶数据分两次上报
- **THEN** 计数累加不重复行；再次重放同 payload 计数不翻倍（聚合后 upsert）

#### Scenario: 非法输入
- **WHEN** usage_date 非 YYYY-MM-DD / 负数 / 缺 provider_id / 超过 500 条
- **THEN** 400 且提示字段

#### Scenario: 载荷携带 user_id
- **WHEN** 桌面端上报官方算力链路的用量
- **THEN** 载荷 SHALL 包含 `user_id`（Logto `sub`）与 `client_id`
- **AND** `tokens_in` / `tokens_out` / `cost` SHALL 为真实聚合值（仅兜底桶为 0）
