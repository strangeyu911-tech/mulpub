---
record: official-compute-wiring-final
task: 官方算力扣减接线落地形态定案（D-①/D-②/D-③）—— 改向 PRD、openspec change、新建设计文档
date: 2026-10-25
branch: official-compute-wiring-final
---

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档变更（docs-only）**：8 个文件全部落在 `01-docs/**` 与 `openspec/**`（脚本白名单内）。隔离方式 = **远端独立分支 `official-compute-wiring-final`**（裸 task 名，无 `team/` 前缀、无斜杠），**未直推 main**。⚠️ 沙箱 git smart-http 握手卡死（`.git` 恒 81K，重试无效）⇒ 走 **GitHub contents API** 写文件（每文件一个 commit）；**本地不建工作树、不碰 main**。 |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=true`**。⚠️ **诚实标注取证方式**：沙箱 git 通路不可用 ⇒ 在本地构造**等价 base/head 仓库**（base 提交 = main 上这 6 个文件的 blob，head 提交 = 改动后版本）跑**仓内原脚本**（判据本体一字未改）；该脚本只读 `git merge-base` + `git diff --name-status` 的**路径清单** ⇒ 等价性成立。**另用 GitHub compare API 独立复核路径清单，两侧逐条一致**。 |
| 行尾 / 编码对账 | ✅ | 8 个文件 **CRLF 计数全 0**；`grep -c $'\xef\xbf\xbd'` **全 0**。⚠️ **本轮实测逮到 1 处损坏并已修**：新写的 `spec.md` 里「退款」二字被写成 U+FFFD 替换字符（写入通道问题，非内容问题）⇒ 已定位并修复后复验为 0。 |
| 品牌残留 | ✅（范围受限） | `node scripts/check-no-brand-residue.js` → **`PASS`（扫描 9 个 tracked 文件，无品牌残留；已豁免第三方签名服务域名）**。⚠️ **覆盖范围说明**：这 9 个是**本地等价仓库的全集**（8 个本 PR 改动文件 + 1 个门禁脚本本身）⇒ **本地覆盖面远小于 CI 的全仓扫描**；全仓覆盖随 CI 判据。 |
| 文档同步检查 | 随 CI | `bash scripts/check-docs-sync.sh --base=main --head=HEAD` 随 CI `Doc Sync Gate`；**本地 git 通路不可用 ⇒ 未实跑**（如实标注，不冒充通过）。 |
| 执行记录存在性 | ✅ | 本文件（`openspec/records/official-compute-wiring-final.md`）。frontmatter 为**现行形态**（`record` / `task` / `date` / `branch` 四字段，**不带** `sync_status` / `sync_reason` / `sync_backfill_owner`）；状态列写 `\| 远程同步 \| 由门禁推导 \|`，**不手写 PENDING/PASS**。 |
| 迁移编号 | ✅ | **本 change 不新增迁移文件**（D-① 供给侧零迁表）⇒ 编号问题归零。实测 `migrations/postgresql/` 占用 = `002/003/004/005/006_payment_orders/008_credit_ledger/009_redeem_code_issued_to` ⇒ `006` 已占、`007` 已被 `compute-key-envelope-migration` 预定、`008`/`009` 已占 ⇒ **D-③ 落地时新迁移从 `010` 起**；真实约束是 **FK 建表顺序 = 文件名 `localeCompare` 序**，不是「撞号」。 |
| 保留门禁（docs-only 豁免项） | N/A | **QM-1 打包 / QM-2 代码必检项 / QM-4 视觉 / TDD（无代码）** 全部不适用 —— **本 PR 未改任何运行时代码**。 |
| QM-6 CCG 双模型外部评审 | **未执行** | 本环境无可用外部评审通道（`ccg-deep-review.js` 全盘不存在；`claude` / `opencode` / `codex` / `codeagent-wrapper` 均不可用）⇒ **如实记为未执行，不以自审冒充通过**。本片为**前提级订正 + 定案落文档**，风险面是「文档口径漂移」而非「运行时代码缺陷」。 |
| 远程同步 | 由门禁推导 | |

## 本片做了什么（一句话）

把官方算力链路**从「搬表」改向为「接线」**——三个定案（代理落 ops-center / 扣分走一次 HTTP / 账户模型缺口立项）落进 PRD、openspec change 与新建设计文档。

## 本片的实质变更（不是文档搬运）

| # | 变更 | 性质 |
|---|---|---|
| 1 | **前提级订正**：Phase 1（`credit-cost-accounting-phase1`，2026-10-23 合入）已把算力计费域铺成两个进程两个库，且 ops-center 早就在代调上游 ⇒ **「把 `official_keys` 搬进 Postgres」的前提被推翻** | 推翻既有设计方向 |
| 2 | **三个定案落文档**：D-① 代理落 ops-center（供给侧零迁表）、D-② 扣分走 `POST /api/v1/credit/consume` 一次 HTTP（不直连 Postgres、不建 key-broker）、D-③ 账户双轨 + `expires_at` 缺口独立立项 | 新增决策 |
| 3 | **两个既有决策标记失效**：① 官方 Key 迁 AES-256-GCM + KMS（`PRD` §4.4-1）—— 随 D-① 失效；② `compute-key-envelope-migration` 整条 change —— 其存在理由「Node 侧要解官方 Key」不成立 | 失效标注（**非论证被推翻**） |
| 4 | **PRD §4.3 流程图重画**：原图把「服务端」当一个整体 ⇒ 拆成 ops-center（供给+算成本+记用量）与 api-publish-engine（扣分）两个服务；「预扣-结算-退款」改为「**发货前扣分 + 发货后挂起补扣**」（上游已计费 ⇒ 退款是错的，补扣才对） | 实质修正 |
| 5 | **新建设计文档** `01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（553 行）：端到端流程、失败矩阵、数据校验清单、功能逻辑、交互逻辑、显示项、提示文字（zh/en 成对 9 条）、验收 12 条、未决项 7 条 | 新增 |
| 6 | **openspec spec 整体改写**：从「Key 池物理归属 / 切读失败语义 / 迁移四层校验 / 回滚路径」改为「代理物理归属 / 扣分通道契约 / 扣分失败语义 / 降级同向 / 用量归属与时序 / 缺价处理 / 迁移编号 / 账户模型边界」 | 契约改写 |
| 7 | **tasks 从 8 组「迁表」任务改写为 8 组「接线」任务**（第 0 组前提重核标记闭合） | 任务改写 |

## 关键设计取舍

| # | 取舍 | 理由 |
|---|---|---|
| 1 | **「决策失效」必须带前提条件** | PRD §4.4-1 与 `compute-key-envelope-migration` 都是**在各自前提下正确的**决策，随前提一起失效 ⇒ 写「已作废」会误导后来人以为论证有错 |
| 2 | **docs-only 判定用「等价输入跑真脚本 + API compare 交叉核对」** | 沙箱 git 通路不可用；脚本只读路径清单 ⇒ 等价性可证；再用独立通路核对 ⇒ 不靠单一读数 |
| 3 | **执行记录写完整表而非精简 5 行** | 本片虽是 docs-only，但含「推翻既有设计方向」的实质变更 ⇒ 完整留痕比压缩更重要 |
| 4 | **账户模型（双轨）独立立项而非顺手做** | 改 `identity_credit_accounts` 主键 = 破坏性 schema 变更 ⇒ 必须独立评审 |
| 5 | **归档 `compute-key-envelope-migration` 留给人工确认** | 归档会变更 `openspec/changes/` 目录结构 ⇒ 属「改结构」级别，agent 不得自行做 |

## 未决项（已写入设计文档 §11）

U-1 服务间鉴权机制（**须人工过目**）｜U-2 官方算力端点路径与幂等键归属｜U-3 `official_credit` 不在 features 数组（**须人工过目**）｜U-4 `get_active_keys_for_tier` 生产引用数为 0｜U-5 定时对账任务宿主（全仓无 cron/APScheduler）｜U-6 账户双轨 DDL｜U-7 官方 Key 运维迁移（**已关闭**：Fernet 保持不变）

## 验证结果（实测读数）

```
$ node scripts/classify-docs-only.js --base=origin/main --head=HEAD
docs-only=true
files=8
01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md
01-docs/PRD-OFFICIAL-COMPUTE-STOPGAP-2026-10-09.md
openspec/changes/compute-key-envelope-migration/proposal.md
openspec/changes/official-keys-postgres-migration/design.md
openspec/changes/official-keys-postgres-migration/proposal.md
openspec/changes/official-keys-postgres-migration/specs/official-keys-postgres/spec.md
openspec/changes/official-keys-postgres-migration/tasks.md
openspec/records/official-compute-wiring-final.md

$ for f in <8 个文件>; do grep -c $'\xef\xbf\xbd' $f; done
0 0 0 0 0 0 0 0        # U+FFFD 计数
0 0 0 0 0 0 0 0        # CRLF 计数

$ node scripts/check-no-brand-residue.js
[no-brand-residue] PASS（扫描 9 个 tracked 文件，无品牌残留；已豁免第三方签名服务域名）
# ⚠️ 9 = 8 个本 PR 改动文件 + 1 个门禁脚本本身（本地等价仓库的全集）
#    ⇒ 本地覆盖面远小于 CI 全仓扫描；全仓覆盖随 CI 判据
```

## 下一片（不在本 PR）

- **实现**：`official-compute-credit-wiring` 的 tasks 1–7（官方算力端点 + 扣分端点 + 桌面端接线 + 状态机 + 运营可观测 + 部署文档 + 端到端三方对账）
- **独立 change**：账户双轨模型（D-③，改主键 ⇒ 独立评审）
- **待人工确认**：服务间鉴权（U-1）、`official_credit` feature 补登（U-3）、`compute-key-envelope-migration` 归档与否
