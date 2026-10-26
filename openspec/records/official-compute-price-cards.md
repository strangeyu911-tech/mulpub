---
record: official-compute-price-cards
task: 官方算力 MiniMax 价格卡 —— 6 张真卡入库（方案稿 8 张按「仓内可选 + 官方价可确认」收窄），并补上「同模型多档价 ⇒ 缺维度即报错」的防错账守卫
date: 2026-10-25
---

## 本次执行记录：官方算力 MiniMax 价格卡（official-compute-price-cards，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 混合 PR（数据面 + 后端服务 + 文档） | worktree `mp-worktrees/mp-official-compute-price-cards`、裸分支 `official-compute-price-cards`；`classify-docs-only` ⇒ docs-only=false |
| 第一性原因（QM-5 ①） | 通过 | 回源码逐条核对三件事：① `model_price_cards` 表 / 版本化价格服务 / 幂等种子脚本**都在**，但 `seed/model_price_cards.seed.json` 的 `priced` 段**只有 5 张**（deepseek / doubao-llm 的 token 卡）⇒ **MiniMax 官方算力的成本恒 0**；② 三个非 token 维度**能真拿到**（视频 `usage.total_seconds`（H3 v2 原样透出）/ 图像 `params.n` / 语音 `params.text.length`）⇒ **不建卡就白建**；③ H3 的 `768P` 与 `2K` **共享 (provider, model, action, unit) 四个维度只差 `spec`** ⇒ 现有「同 unit 取 `effective_from` 最新一条」的选卡逻辑**会静默挑一张** |
| 逃逸分析（QM-5 ②） | 已封 | **① 口径写错 ⇒ 官方算力恒缺价且卡看着完全正常**（provider_id / action_type / model_id / spec 四条全部来自桌面端，写错任一条就永远命中不到）⇒ 被**读桌面端真源**的机械锁挡住；**② 缺 spec ⇒ 静默挑一张 ⇒ 成本偏差 37.5%–60%** ⇒ 被守卫挡住；**③ `per_char` 单位错 ⇒ 错账 1000 倍** ⇒ 被单价口径锁挡住（判据侧自带期望值）；**④ 8 张里那 4 张「建了也走不到」的没登记** ⇒ 后来人会以为「漏建了 4 张」⇒ 已逐条登记进 `pending`（含「为什么不能建」+「将来要建它需要先做什么」） |
| 修复 + 回归保护（QM-5 ④） | 通过 | 服务端：`seed/model_price_cards.seed.json` **+6 张 priced / +5 条 pending**（文本级插入，差量 **+148 / −0**，其余字节零改动）；`load_effective_cards` 加**歧义守卫**（缺 `spec` 且同 `model_id` 下有 ≥2 个不同 `spec` ⇒ 那批卡**全部不参与匹配** ⇒ 落进 `missing_units` ⇒ 缺价告警；**通用卡 `spec=''` 不受影响**）；`usage_event_service` 收集 `ambiguous_specs` ⇒ **缺价的两种真因可分辨**（补 spec vs 建卡），且 `missing_detail` **进返回值**（限量 20 条）⇒ 调用方可消费 |
| 防止再次发生（QM-5 ⑤） | 通过 | ① **口径锁读桌面端真源**（解析 `model-provider-seeds.js` / `minimax-h3-v2.js`）⇒ 桌面端改 provider / 分辨率形态，锁当场红；② **单价期望值判据侧自带**（官方价 → 微元换算写在判据里，**不读被测卡**）⇒ 卡被改时锁红；③ 守卫复用**既有缺价通道**（`missing_units` + 告警 + `unbillable`）⇒ **不新增第二条失败路径**；④ `ambiguous_specs` 让两种缺价**可分辨**⇒ 运营不会去建一张不该建的卡；⑤ **变异验证 5/5**（见下） |
| 行尾与 diff 对账 | 通过 | 两口径 numstat 逐文件相等（`git diff <merge-base> HEAD --numstat` 与 `--ignore-cr-at-eol --numstat`）；`seed.json` 删除行 **= 0**（文本级插入，非整体重写）；U+FFFD 全文扫描 = 0 |
| 接线棘轮 | 通过 | 新增 `ops-center/backend/tests/test_minimax_price_cards.py`（**12 例**）走 **pytest 全量**（`ops-center CI` 的 `pytest tests/`）⇒ **必然被 CI 跑到**；`check-unwired-tests.js` 的 `TEST_SUFFIXES = [".test.js", ".test.mjs", ".test.sh", ".test.ps1"]` **不含 `.py`** 且 `ops-center/` 在其排除域内 ⇒ **无需登记白名单**（白名单只针对**新增桌面端测试文件**的分片风险） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面与界面（本刀是**数据面 + 后端选卡逻辑**，**无用户可见界面**；提示文字只有种子脚本 stdout 与缺价告警日志，形态未改） |
| QM-6 CCG 双模型外部评审 | **未执行** | 本机无 `codeagent-wrapper` ⇒ 如实写未执行；降级证据 = 仓内断言 + **5/5 变异全被抓住** + 逐条源码对账（不冒充外部评审通过） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 遗留（不假装已闭合）

- **★ MiniMax-H3-Max 缺价** ⇒ 官方算力走 H3-Max 会**拒绝服务**（官方定价页与 V2 文档对这两个型号的**描述互斥** ⇒ 价格不可确认 ⇒ 未知不建卡）。
- **★ `minimax-multimodal` 的 video / llm 能力缺价**（`MiniMax-Hailuo-2.3` / `MiniMax-M2.7`）⇒
  **R5-3（Key 池路由）必须只选「有生效价格卡」的 (provider, model, action)**，否则用户会撞上「有卡外的模型」。
- **H3-Highspeed / H3-Lite 档位未暴露**（官方有价：¥0.40 / ¥0.26 / ¥0.16 每秒）⇒
  将来暴露时**必须同批建卡**，否则该档位缺价拒绝服务。
- **`image-01-live` / `speech-2.8-hd` 未暴露** ⇒ 同上。
- **仓内两套 spec 形态**：既有 `tests/test_usage_event_service.py` 用的是**自造形态**
  （`model="H3"` / `spec="768p"` 小写），而**生产形态**是 `MiniMax-H3` / `768P`（大写 `P`）
  ⇒ 本片的口径锁钉的是**生产形态**；既有测试**未改**（它测的是机制不是口径）
  ⇒ 遗留一条「照抄既有测试会写出错的卡」的认知负担。
- **上游账单对拍**（`proc_discount` 采购折扣系数）未做 ⇒ 全部按 1.0（按官方公开价）。
- **日桶回算对「同模型多档价」结构性不可用**（`model_usage_daily` 表结构上没有 model/spec 维度）
  ⇒ 守卫会让它缺价（正确）⇒ **官方算力成本账必须走事件级**。
- **缺价拒绝服务的用户文案**属 R5-3 的交互设计；本刀只保证服务端**如实区分两种缺价**并把结构化诊断交出去。

## CHANGELOG 条目

# feat(官方算力): MiniMax 价格卡入库 —— 官方算力的成本第一次算得出来，并堵上「同模型多档价会被静默挑错」的错账口子

- 官方算力（MiniMax H3 视频 / image-01 图像 / speech-2.8-turbo 语音）的**单价卡**正式入库
  ⇒ 此前每一次调用都命中不到卡、成本恒 0、每次都报「缺价格」；现在服务端能按官方公开价算出真实成本与积分。
- 同一个模型有多个分辨率档时（768P / 2K）**必须带上规格**才计价；没带就**如实报缺价**，
  而不是偷偷挑一个档位的价算 —— 后者会让成本账偏差 37.5%–60%，而缺价是看得见的。
- 缺价现在会**说清是哪一种**：是「没带规格」还是「还没建卡」⇒ 运营不用去建一张不该建的卡。
- MiniMax-H3-Max 等**价格口径官方未确认**的型号**暂不建卡** ⇒ 走这些型号会**明确拒绝服务**（而不是默默按 0 记账）。

## learnings

### lesson: price-card-locator-dimensions-must-be-locked-to-the-desktop-catalog

**现场**：给官方算力建 MiniMax 价格卡时，定位维度有四个（`provider_id` / `action_type` / `model_id` / `spec`），
而它们**全部来自桌面端**：`provider_id` ← `model_providers.id`、
`action_type` ← `model_providers.category`（事件里 `action_type = category`）、
`model` ← 用户实际选的模型、`spec` ← `params.resolution`。
⚠️ 仓内既有的 `tests/test_usage_event_service.py` 用的是**自造形态**（`model="H3"` / `spec="768p"` 小写），
**与生产形态（`MiniMax-H3` / `768P` 大写 P）不同** ⇒ 照抄既有测试就会写出**永远命中不到的卡**。

**根因**：价格卡是**数据**，它的定位维度与**另一套系统（桌面端）**耦合；
而桌面端那套系统**没有测试**（没人给 `model-provider-seeds.js` 与价格卡之间设过契约）⇒
两边可以各自漂移，而漂移的表征是「卡看着完全正常、但官方算力恒缺价」。

**可复用的 N 条**：

1. ⭐ **「跨系统共享的定位维度」必须有机械锁，且锁要读对方的真源**（不是自己抄一份期望值）
   ⇒ 解析 `model-provider-seeds.js` 与 `minimax-h3-v2.js` ⇒ 桌面端改了 provider / 分辨率形态，锁当场红。
2. ⭐ **既有测试里的样本形态不等于生产形态** ⇒ 凡是要跟生产对齐的断言，
   **形状必须来自生产真源**；照抄既有测试的形状会把「自造的形态」固化成「看起来有依据的口径」。
3. ⭐ **同一模型挂在多个 provider 下时，卡要按 provider 分别建**
   （本例 `speech-2.8-turbo` 同时挂在 `minimax-tts` 与 `minimax-multimodal`）⇒ 少建一张就有一条路缺价。

### lesson: same-model-multiple-specs-need-a-missing-dimension-guard

**现场**：H3 的 `768P`（¥0.50/秒）与 `2K`（¥0.80/秒）**共享
(provider, model, action, unit) 四个维度，只差 `spec`**。
而 `load_effective_cards` 原本的选卡逻辑是「同 unit 命中多条时取 `effective_from` 最新的一条」
⇒ **调用方没传 `spec` 就会静默挑一张** ⇒ 成本偏差 37.5%–60%，**且没有任何告警**。

**根因**：选卡逻辑把「多张卡命中同一个 unit」当成了「同一件事的多个版本」，
但在这条链上它其实是「**同一模型的不同规格**」⇒ **挑哪张不是版本问题，是规格问题**
⇒ 版本能靠 `effective_from` 裁决，**规格不能**。

**可复用的 N 条**：

1. ⭐ **「多张卡命中同一个 key」有两种含义：版本（可按时间裁决）与规格（必须按维度匹配）**
   ⇒ 判据：**候选卡在「调用方没给的维度」上取值不同 ⇒ 全部不参与匹配**（宁可缺价告警）。
2. ⭐ **错账不可见、缺价可见** ⇒ 两者冲突时**永远选可见的那个**
   ⇒ 「静默算错 60%」比「明确报缺价」危险得多。
3. ⭐ **通用卡（该维度为空）的语义是「一价通吃」** ⇒ 守卫**不得**把它一起排掉
   ⇒ 否则所有「一卡通吃」的 provider 都会假性缺价（本片为此单列了一条用例）。
4. ⭐ **缺价有多种真因时必须可分辨**：本例「没带 spec（补上即可）」与「没建卡（要建卡）」处置完全不同
   ⇒ 报一个笼统的「缺价格」会让运营**去建一张不该建的卡** ⇒ 本片加 `ambiguous_specs` 把两者分开。
5. ⭐ **只进日志的结构化诊断等于没有** ⇒ 调用方拿不到 ⇒ 无法据此给用户可操作提示
   ⇒ 本片把 `missing_detail` 放进返回值（限量 20 条，与日志同量）。
