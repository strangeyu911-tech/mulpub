---
record: subscription-segments-s1
task: 订阅段链 S1 —— 新表 + 迁移 010 + 开发态 SCHEMA 成对 + 段链仓储原语（含 D-1 结构保证）
date: 2026-10-25
branch: subscription-segments-s1
delivered_by_pr: 4464
---

# 订阅段链 S1（表 + 仓储层）

规格：`01-docs/PRD-SUBSCRIPTION-SEGMENTS-2026-10-25.md`（PR #4460 已并入主干）。
本片 = 规格 §11 的 **S1 表与仓储**，**不改任何既有用户可见行为**（三处存量缺陷的修复在 S2/S3）。

## 1. 本轮改了什么

| 文件 | 性质 | 内容 |
|---|---|---|
| `migrations/postgresql/010_subscription_segments.sql` | 新增 | 段链表 + 单活部分唯一索引 + 链序索引 |
| `packages/api-publish-engine/src/auth/subscription-segments-schema.js` | 新增 | 开发态 SCHEMA 数组（与迁移**逐字成对**） |
| `packages/api-publish-engine/src/auth/subscription-segments.js` | 新增 | 段链仓储原语 + 23505 约束冲突分类 |
| `packages/api-publish-engine/src/auth/postgres-commerce-store.js` | 修改（+8 行） | 把段链原语 mixin 进**事务类**（写段与写投影/快照同事务） |
| `packages/api-publish-engine/src/auth/postgres-identity-repository.js` | 修改（+8 行） | SCHEMA 追加段链语句 + 关系清单追加段表（**末位**） |
| `packages/api-publish-engine/test/subscription-segments-migrations.test.js` | 新增 | 迁移漂移锁 + 语义约束锁（**18 例**） |
| `packages/api-publish-engine/test/subscription-segments-store.test.js` | 新增 | 仓储原语行为锁 + 结构锁（**30 例**） |
| `01-docs/PRD-SUBSCRIPTION-SEGMENTS-2026-10-25.md` | 修改 | DDL 与实现同步（三处收紧，见 §3） |

## 2. 关键设计决定（为什么这么写）

### 2.1 D-1 从「约定」变成「结构上无法违反」

规格 §5.1 的 D-1 铁律是「先 demote 旧生效段、再 activate 新段」，理由是自建的
「每用户至多一个 active 段」**部分唯一索引**在每条语句结束时立即检查 ⇒ 写反了就是 23505 ⇒
每次高档兑换都 500。

⇒ 本片**不给仓储层提供「插入 active 段」这个动作**：
只有 `insertQueuedSegment`（status 恒为字面量 `'queued'`）与 `activateSegment`
（**只接受 queued → active**）⇒ 「先 demote 再 activate」无法被写反。
⇒ 硬要违反（还有生效段时再激活一条）⇒ 撞部分唯一索引 ⇒ 被分类成
`SEGMENT_MULTIPLE_ACTIVE`（409 + 措辞点明 D-1），**不静默**。

### 2.2 23505 必须分类，不能一律当「幂等命中」

把「同一笔授权重复落段」（幂等命中）与「链序冲突」「两个生效段」都当成幂等成功
⇒ 调用方会以为**已经发放过** ⇒ 最贵的错。
⇒ `classifyUniqueViolation` 按**约束名模式**分类（不写死 Postgres 自动命名）：
来源键 ⇒ `SEGMENT_SOURCE_CONFLICT`（409，幂等命中）；单活索引 ⇒ `SEGMENT_MULTIPLE_ACTIVE`；
链序 ⇒ `SEGMENT_SEQ_CONFLICT`；**未识别 ⇒ `SEGMENT_UNIQUE_CONFLICT`（不得当幂等命中）**。

### 2.3 写段必须是**事务内**动作

段链是事实源 ⇒ 写段与写 `identity_subscriptions` 投影、写权益快照必须同事务
⇒ 原语挂在**事务类**（`this.client`）而不是仓储池级 ⇒ rollback 一起回滚。
（接线锁：断言事务类上确实有这 8 个方法 —— 叶子模块单测全绿 ≠ 已接线。）

## 3. 实施期发现的两个**规格漏洞**（已修规格 + 已补锁）

| # | 漏洞 | 后果 | 修法 |
|---|---|---|---|
| **L1** | 规格 DDL 里的 `UNIQUE (user_id, seq)` **没有 DEFERRABLE** | 单条 `UPDATE ... SET seq = seq + 1` 会**逐行**撞唯一约束（行 5→6 时 6 还在）⇒ **段链插到链中间必然 23505** ⇒ R1/R2 两条规则直接不可实现 | 约束加 `DEFERRABLE INITIALLY DEFERRED`（冲突推迟到 COMMIT，**中间态不外泄**）；⚠ 「至多一个 active」的部分唯一索引**保持即时**（D-1 的错要当场暴露） |
| **L2** | 规格 DDL 的段时刻 CHECK 允许**半截段**（只有起点没有终点） | 半截段 = 写崩了的残骸，却能落库 ⇒ 链的不变量（首尾相接）从数据层失守 | 收紧为「**要么都空、要么都有且 end > start**」 |

⇒ 规格 DDL 已同步（§3 段），并补了「两个 UNIQUE 显式命名」的说明（23505 分类需要稳定约束名）。

## 4. 判据与验证

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更：在**隔离 worktree** `/workspace/mp-worktrees/mp-redeem-takeover` 内编辑，分支 `subscription-segments-s1`（裸 task 名，无斜杠） |
| 第一性原因（QM-5 ①） | N/A | 本片是**新增功能**（S1），不改既有行为；三处存量缺陷（套利 / 升级吞剩余时长 / 无排队概念）的修复在 S2/S3 |
| 逃逸分析（QM-5 ②） | N/A（同上） | **但实施期确实逃过了两处** ⇒ 落在 §3 的 L1/L2（已修规格 + 补锁） |
| 系统性漏洞（QM-5 ③） | ✅ | 缺口不是「某个用例没写」，而是**规格与可实现性脱节**：D-1 的铁律只写在散文里、数据层没承载 ⇒ 落到「结构上无法违反」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 迁移漂移锁 **18** 例 + 仓储行为/结构锁 **30** 例；**变异验证 15/15 全部被抓住**（含独立复核自己发现的盲区） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 规格 DDL 与实现同源（改实现必改规格，本片已做）；② 「结构上无法违反」替代散文约定；③ 23505 分类有独立锁（含「未识别约束名不得当幂等命中」） |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致（见下方 §5） |
| 接线棘轮 | ✅ | 新增两个 `*.test.js` 在 `packages/api-publish-engine/test/` ⇒ 被 `scripts/run-tests.js` **按目录自动发现**（runner 归属按文件内容判定 ⇒ 无需登记）；另有「事务类上确实有这 8 个方法」的接线锁 |
| QM-1 打包 / QM-4 视觉 | N/A | 无 UI 改动（视觉回归不适用） |
| QM-6 外部评审 | ✅ | 独立 Verifier 对本片 diff 做了对抗性复核（结论与处置见 §6） |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`）。⚠ **本篇只留这一行**（`check-gate-record-debt` 判「新增重复行」：同一篇里出现第 2 行 `| 远程同步 |` 即红） |

## 5. 验证读数

- 迁移漂移锁：`node --test test/subscription-segments-migrations.test.js` ⇒ **18/18 绿**
- 仓储行为/结构锁：`node --test test/subscription-segments-store.test.js` ⇒ **30/30 绿**
- 变异验证：**15 条**（去 DEFERRABLE / 删单活索引 / 放宽时刻 CHECK / 幂等键改延后 /
  插入路径放开 status / 降级不清时刻 / 未识别约束名当幂等命中 / 摘掉 mixin /
  **降级改回收调用方传值** / **允许负位移** / **幂等键不 trim** / **去掉 seq>0** /
  **去掉排队段时刻 CHECK** / **★ CASE 绕过（复核自己发现的盲区）** / **去掉 COMMIT 阶段 23505 归一**）
  ⇒ **15/15 全部被对应的锁抓住**，且每条都按内容恢复（sha256 核对）
- ⚠ 变异 harness 有**两次**锚点打偏（缩进对不上 / 目标文本已随改动变化）⇒ harness 判定
  「打偏、未执行」并整体报红 ⇒ 修锚点后重跑。**「变异没红」先分清是「锁没牙齿」还是
  「变异没生效」**（顺序不能反）——本轮两处都是后者。
- 全量回归：`packages/api-publish-engine` 的 `node scripts/run-tests.js` ⇒ **160 绿 / 2 红**；
  那 2 个（`cloud-accounts-keyring-hardening` / `plugin-loader-runtime-path`）**在干净
  `origin/main` 检出上复跑同样红** ⇒ **主干级存量 / 环境差异，与本片零关系**（零回归）
- ⭐ **真库验证（2026-10-27 补做，15/15 全过）**：本轮在沙箱装了 **PostgreSQL 15**，用**仓里真实的
  `pg` 驱动 + 本仓真实的仓储原语**（不是复制品）跑了一遍 ⇒ 三条曾「只靠推理」的 DDL 行为断言全部变成实测读数：

  | 断言 | 实测读数 | 结论 |
  |---|---|---|
  | 部分唯一索引在**语句末尾**当场拦截、驱动给的 `constraint` = **索引名** | `SEGMENT_MULTIPLE_ACTIVE` / `constraint=idx_identity_subscription_segments_one_active` | ✅ 成立（**分类器的匹配键成立**） |
  | `(user_id, seq)` 的 DEFERRABLE 把冲突**推迟到 COMMIT**，且事务包装层接得住 | 语句不报错；COMMIT 抛 → 包装层归一成 **409 `COMMERCE_UNIQUE_CONFLICT`**（`pgCode=23505` 保留）→ 二次分类得 `SEGMENT_SEQ_CONFLICT` | ✅ 成立（**D-11 的修法端到端被证**） |
  | demote 的「剩余自算」与时刻 CHECK 相容、毫秒级精度 | `remaining_ms=25919999998`（与 `period_end` 真实差值差 **1ms**）；半截段 / queued 带时刻 / `seq=0` 三条 CHECK 全按预期拒（**23514**） | ✅ 成立 |

  ⇒ 脚本落仓：`packages/api-publish-engine/scripts/verify-segment-ddl.js`（`BUSINESS_DATABASE_URL` 约定；
  **可选手动工具、不进 CI** —— CI runner 没有 PG，把它塞进测试发现路径就是「一个从不跑的测试」的假绿形态）。
  ⚠ 顺带量到一个**可改进项**：`activateSegment` **分不清「id 不存在」与「id 不是 queued」**（同报 `SEGMENT_NOT_QUEUED`）⇒ 记为 §7 B15。

## 6. 独立复核的处置（**独立 Verifier 结论：FAIL —— 抓出 13 条，其中 3 条是本片自己造成的**）

独立 Verifier（对抗性复核，方法：逐条回源码 + 跑仓内判据的同款口径 + 自己的变异电池 + 忠实模型实跑）
给出 **VERDICT: FAIL**，并明确「**这片本身可以合**（纯增量、零生产路径引用段表、它能在沙箱里跑的门禁全绿），
但**不能原样进 S2**」。复核方自己跑了 8+1 条变异，并**发现我的锁有一条没有牙齿**（D-2）。

### 6.1 三条阻塞级（全部已改）

| # | 复核发现 | 为什么是阻塞 | 处置 |
|---|---|---|---|
| **D-1** | **规格 §5.1 的 D-1 伪码自相矛盾，照抄必 500**：第 3 步 `UPDATE 后续段 SET seq=seq+1 WHERE seq >= C.seq` 会把**刚插入的 N 一起后移** ⇒ C 与 N 落到同一 seq；因链序 UNIQUE 是 `DEFERRABLE` ⇒ **违例推迟到 COMMIT** ⇒ 裸 23505 逃出语句级分类器 ⇒ 500。复核方用忠实 seq 记账模型实跑复现（规格原样 ⇒ COMMIT FAILS 23505） | S3 若照抄这段伪码，**每次高档兑换都 500** —— 正是段链模型要消灭的故障形态 | 规格 §5.1 改为**四步**：`① shiftSegmentSeq(C.seq,+1) → ② insertQueuedSegment(seq=C.seq) → ③ demoteActiveSegment(C) → ④ activateSegment(N)`，并写明**「shift 必须在 insert 之前」**的原因；弃用「单条 UPDATE CASE」备选（原语集表达不了） |
| **D-3** | **「保剩余」只到约定层**：demote 让**调用方自带** `remainingMs` ⇒ 对一条已结算行传 `null` 会被接受 ⇒ 写出 `remaining_ms = NULL` ⇒ 按规格语义（NULL = 从未生效 ⇒ 长度取 `duration_days`）⇒ **用户把已过期的那些天再拿一遍**（即规格明令禁止的「白赚 65 天」）。⚠ D-1 已被做成结构性不可违反，**D-3 却还是约定** ⇒ 不对称 | 同一个模型里两条铁律，一条结构化一条约定化 ⇒ 后者迟早被写错 | **改成由 SQL 自算**：`remaining_ms = CASE WHEN period_end IS NULL THEN NULL ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (period_end - NOW()))*1000)) END`，**调用方不再传值** ⇒ 「保剩余」与 D-1 一样**结构上无法违反** |
| **D-11** | `SEGMENT_SEQ_CONFLICT` 是**死分支**（链序约束只在 COMMIT 查，语句级 catch 看不到它）⇒ COMMIT 阶段的裸 23505 **逃出分类器** ⇒ 无 status ⇒ 500 | 同上：把「每次高档兑换 500」从模型外搬回模型内 | 在**事务包装层**（`postgres-commerce-store.js` 的 `commerceTransaction`）统一归一：23505 ⇒ `code=COMMERCE_UNIQUE_CONFLICT` + `status=409` + 保留 `pgCode`/`constraint` ⇒ 不再是 500；段链侧分类器同时认 `code==='23505'` 与 `pgCode==='23505'` |

### 6.2 其余十条（全部已改或已登记）

| # | 发现 | 处置 |
|---|---|---|
| **D-2** | D-1 的锁是**文本锁不是语义锁**：复核方注入 `CASE WHEN $6='redeem' THEN 'queued' ELSE 'active' END`（SQL 仍含 `'queued'` 字面量、参数仍是 7 个）⇒ **27/27 全绿 ⇒ 锁没抓住** | 断言改成**位置断言** `/\$5, 'queued', \$6, \$7\)/` ⇒ CASE 写法必然不匹配；并把这条变异补进电池（M14 ⇒ 现在被抓） |
| **D-4** | `shiftSegmentSeq` 接受**负位移**；DDL 的 `seq` 无 `CHECK (seq > 0)` ⇒ 可写出 seq ≤ 0 的行，之后应用层自己都拒绝再碰这条链 | 只允许**正**位移（`delta <= 0` 判 400）+ DDL 补 `CHECK (seq > 0)`；新增用例与变异（M10 / M12） |
| **D-5** | A13 要求「**DB 层也要挡**」，但 DDL 里**没有任何 trigger** ⇒ 该判据**未兑现** | 改 A13 措辞为「**应用层不提供**改写语句（源码级锁 + 变异验证）」，**DB 层欠账显式登记**（§7 B12）——不假装已兑现 |
| **D-6** | 排队段仍可带时刻（DB 不挡）⇒ 规格「排队中的段为空」这条语义在 DB 层没有承载 | DDL 补 `CHECK (status <> 'queued' OR (period_start IS NULL AND period_end IS NULL))` + 用例 + 变异（M13） |
| **D-7** | 文件头声称「撞部分唯一索引 ⇒ 分类成 `SEGMENT_MULTIPLE_ACTIVE`」，但**驱动不带 `constraint` 时会降级**为 `SEGMENT_UNIQUE_CONFLICT`（仍 fail closed、仍不当幂等命中，但 D-1 的可读诊断丢失） | 措辞降级为「**在驱动携带 `error.constraint` 时**」，并指向仓内同款坑（`credit-repository.js:35-36`） |
| **D-8** | **「中间态不外泄（事务内读者看不到）」是错的**（规格与实现各一份）⇒ DEFERRABLE 只推迟「检查」，**不推迟「可见性」** ⇒ 同一事务内的读者看得到中间态 | 两处措辞都改成「**同一事务内的读者看得到中间态 ⇒ shift 之后不得再读链**；只有事务外读者看不到」 |
| **D-9** | 幂等键对空白敏感：`'redeem:X'` 与 `'redeem:X '` 是两个键 ⇒ 同一笔授权能落两段 ⇒ **幂等锁被绕过** | 入库前 `trim()` 并写归一后的值（+ 用例 + 变异 M11） |
| **D-10** | A17 判据**近乎恒真**（只断言新建的 010 文件不含某串）；readiness 清单用 `length >= 16` 魔数当代理 | A17 改成对**整份迁移**扫（任何 `ALTER`/`DROP`/`RENAME`/`TRUNCATE` 即红 ⇒ 语义变成「本片只加表」）；魔数换成**从迁移目录派生**的锁（迁移里 `CREATE TABLE` 的每张表都必须在 readiness 清单里 ⇒ **自动跟上未来迁移**） |
| **D-12** | 「推进必须先 consume 再 activate」**无锁、无注释** ⇒ 写反即撞即时部分唯一索引（诊断会指向 D-1 而不是「推进顺序」），且下一段永远激活不上 | 方法注释写死顺序 + 用例 |
| **D-13** | `source_reference` 的「一段 = 一笔授权」语义在**调用侧**无约束 | 记录在案 ⇒ 归 S3（三条来源路径接上时的风险） |

### 6.3 复核方**判为推不通**的攻击路径（记录在案，防后来人重走）

迁移与 SCHEMA 漂移｜010 撞号与排序（实测 `localeCompare` 排序 010 在末位）｜`normalizeMigrationSql` 炸掉｜
FK 引用方排在后面｜**列级 UNIQUE 不支持 DEFERRABLE（本片用的是表级）**｜「单活冲突被误判成未识别」
（PG 对部分唯一索引报**索引名**；仓内同型生产用法 `credit-repository.js:37` + `008_credit_ledger.sql:78` 已证）｜
`insertQueuedSegment` 被塞 `status:'active'`（解构丢弃多余键）｜参数顺序错位｜SQL 注入｜
段链原语被池级连接误用｜与 `CommerceMethods` 覆盖冲突｜本 PR 引入测试回归（干净主干上复现同样 2 个失败）。

### 6.4 复核后的验证读数

- 迁移漂移锁 + 语义锁：**18/18 绿**（初版 14 ⇒ 补「readiness 清单不得被清空」后 15
  ⇒ 按 D-10 换掉 A17 恒真判据、加「从迁移派生」判据、补 seq>0 与排队段时刻两条语义锁后 18）
- 仓储行为/结构锁：**30/30 绿**（初版 27 ⇒ 按 D-3 改 demote 语义 +1、按 D-4 补负位移用例 +1、
  按 D-9 补 trim 用例 +1、按 D-11 补 COMMIT 阶段 23505 用例 +1 ⇒ 30）
- **变异验证 15/15 全部被抓住**（原 8 条 + 按复核 13 条发现补的 7 条，含复核自己发现的盲区 M14）

### 6.5 本片自己踩的第二个坑：**「本地门禁绿」是管道造出来的假绿**

首次跑本地门禁时命令是 `node scripts/check-gate-record-debt.js ... | tail -4; echo "rc=$?"`
⇒ **❌ 行在输出靠前位置被 `tail` 整段截掉**，而 **`rc=$?` 取的是 `tail` 的退出码 = 0**
⇒ 我把「管道尾的 rc」当成了判据的 rc ⇒ **假绿**（CI 上同一个 job 是红的）。

⇒ 修法（已固化为一次性跑批器 `run-gates.sh`）：**完整输出落文件 → 单独读真 rc → 再 grep 全部 ❌ 行**。
⚠ 跑批器自身第一版也犯了同族错：`grep -c PATTERN file || echo 0` 在零命中时输出成 `"0\n0"`
⇒ 把「零命中」误判成「有 ❌」⇒ **失败与「空」必须是两个值**（丢弃 grep 的 rc，只取计数）。

## 7. 诚实边界

| # | 边界 |
|---|---|
| **B1** | ~~未经真 PostgreSQL 验证~~ **已兑现（2026-10-27）**：三条 DDL 行为断言已在 **PostgreSQL 15 + 仓里真实 `pg` 驱动 + 本仓真实仓储原语** 上实测通过（15/15，脚本落仓 `packages/api-publish-engine/scripts/verify-segment-ddl.js`）。⚠ **仍未验的两处**：① **并发**（两笔兑换同时插段 / 同时结算推进）—— 沙箱无法稳定制造并发窗口；② **真库上的迁移执行链**（`runMigrations` + 台账 checksum + `allowPending:false` 的启动期行为）⇒ 这两条仍须由 S2/S3 的真库用例兑现 |
| B2 | **本片不接任何生产路径**：段链原语已挂上事务类，但**没有任何调用方**（排位规则与结算推进在 S2/S3）⇒ 上线后段链表为空，不产生任何用户可见变化 |
| B3 | **规格与实现的差异已回写规格**（§3 的 L1/L2 + 显式命名）⇒ 规格不再是「初稿原文」，读者以最新为准 |
| B4 | 约束名分类用的是**模式匹配**（`/source_reference/`、`/user/`+`/seq/`）⇒ 若将来重命名约束，需同步 `classifyUniqueViolation`（有独立锁盯着「未识别 ⇒ 不当幂等命中」） |
| B5 | 段表**上界 36500 天**、签发/授予端**上界 3650 天**（与 UI 一致）⇒ 两档口径的差异见规格 §3.1；存量超 36500 天的码如何处置 = 规格 §12 B9 待运营方拍板 |
| **B12** | **A13 的 DB 层欠账（已改措辞，未兑现）**：规格 A13 原写「应用层与 DB 层**都要挡**」，但 DDL 里**没有 trigger** 拒改 `plan`/`duration_days` ⇒ 本片只兑现了**应用层**（不提供改写语句 + 源码级锁 + 变异验证）⇒ A13 措辞已改为「应用层不提供」，**DB 层 trigger 留在 S6**（已登记，不是遗漏） |
| **B14** | **`requireUserId` 接受纯空白**（与 `requireSourceReference` 的口径不一致，复核 D-9 的小尾巴）⇒ 本片未改：userId 来自鉴权层、不是用户输入 ⇒ 影响为零；已在 §4 的变异里覆盖不到这一格（它不是缺陷，是口径不齐） |
| **B13** | **COMMIT 阶段的违例分类是「两段式」**：包装层把 23505 归一成 `COMMERCE_UNIQUE_CONFLICT`（带 `pgCode`/`constraint`）⇒ **段链专属语义码**（`SEGMENT_SEQ_CONFLICT`）要由**调用方**再分类一次才拿得到 ⇒ S2/S3 写结算推进时**必须**走 `classifyUniqueViolation` 二次分类，否则拿到的是通用码（仍 409、仍 fail closed，只是诊断粗） |
| **B15** | **`activateSegment` 分不清「id 不存在」与「id 不是 queued」**（两者同报 `SEGMENT_NOT_QUEUED`）⇒ 真库实测发现的（见 §5 的 ①d）⇒ 排查「段没激活」有两种成因却只有一个错误码 ⇒ 可改进项（不阻塞；S2/S3 接上前可拆成两个码） |

## CHANGELOG 条目

# feat(会员): 订阅段链落地第一步 —— 新表 + 仓储原语（用户可见行为不变）

- 会员订阅新增「段链」事实源表（`identity_subscription_segments`）：一段 = 一档位 × 一时长，
  段与段首尾相接组成时间轴，为「低档码排队兜底、高档码不吞旧档剩余时长」提供数据结构。
- 本步**只加表与仓储原语，不接任何生产路径** ⇒ 用户可见行为完全不变。
- 写段顺序被做成**结构上无法违反**：只能插入排队段、只能激活排队段 ⇒ 不存在「先插生效段再降级旧段」这种必然 500 的写法。
