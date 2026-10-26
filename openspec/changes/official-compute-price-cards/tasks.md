# Tasks — official-compute-price-cards

> 进度以本文件为唯一来源。每组任务 ≤ 一个会话。

## 1. 规格与文档

- [x] `01-docs/PRD-OFFICIAL-COMPUTE-PRICE-CARDS-2026-10-25.md`：现状实读 / 8→6 收窄依据 /
      6 张卡逐字段 / 守卫机制 / 10 条数据校验 / 9 条遗留边界
- [x] `openspec/changes/official-compute-price-cards/`：proposal / design / tasks
- [ ] `CHANGELOG.md` 未发布段 —— ⛔ 由执行记录聚合，**不要**在本 PR 直接改（`check-no-hot-carrier-edit.js` 判热写面）

## 2. 现状勘查（先读已有真源，不重复造）

- [x] `model_price_cards` 表 / `CreditPriceConfig` / `compute_cost_micros` / `compute_credit_cost`
      —— 全部已在（`models_credit.py` / `credit_price_service.py`）
- [x] 幂等种子脚本 + `seed/model_price_cards.seed.json`（`priced` 5 条 / `pending` 18 条）—— 已在
- [x] 事件级取卡**已传**真实 model/spec/tier（`usage_event_service.py`）—— 不用改
- [x] 三个非 token 维度**能真拿到**（视频 `usage.total_seconds` / 图像 `params.n` / 语音 `params.text.length`）
- [x] 桌面端 MiniMax 的 provider id / category / models 清单（`model-provider-seeds.js`）
- [x] H3 v2 的 resolution 取值形态（`minimax-h3-v2.js` ⇒ **大写 P**）

## 3. 实现

### 3.1 价格卡

- [x] `seed/model_price_cards.seed.json`：**+6 张 priced**（`minimax` / `minimax-image` /
      `minimax-tts` / `minimax-multimodal` × `MiniMax-H3` / `image-01` / `speech-2.8-turbo`）
- [x] 同文件：**+5 条 pending**（H3-Highspeed / H3-Lite / image-01-live / speech-2.8-hd /
      MiniMax-H3-Max），每条写明「为什么不能建」+「将来要建它需要先做什么」
- [x] **文本级插入**（不是整体 `json.dumps` 重写）⇒ 差量 **+148 / −0**，其余字节零改动

### 3.2 守卫

- [x] `services/credit_price_service.py::load_effective_cards`：
      缺 `spec` 且同 `model_id` 下有 ≥2 个不同 `spec` ⇒ **这批卡全部不参与匹配**
      （通用卡 `spec=''` 不受影响）；新增可选参数 `ambiguous_specs` 收集被排除的卡
- [x] `services/usage_event_service.py`：调用点收集 `ambiguous_specs` ⇒ 写进 `missing_detail`
- [x] 同文件：`missing_detail` **进返回值**（限量 20 条，与日志同量）⇒ 调用方可消费

### 3.3 机械锁

- [x] `tests/test_minimax_price_cards.py`（**新增**，12 例）：
      ① 卡与桌面端 provider 逐字对齐（解析真源）② `action_type` == `category`
      ③ spec 大写 P ④ 三条单价口径（判据侧自带期望值）⑤ 生产路径精确命中
      ⑥ 缺 spec ⇒ 缺价告警 + 点名歧义 ⑦ 通用卡不受影响

## 4. 顺带订正 R5-2 文档的 4 处事实错误

- [x] `openspec/changes/official-compute-charge-state/proposal.md:50`：`ctx.usageReporter` → `context.usageReporter`
- [x] `openspec/changes/official-compute-charge-state/tasks.md:35`：同上
- [x] `openspec/changes/official-compute-charge-state/tasks.md:40`：`49/49 绿` → `52/52 绿`
- [x] `openspec/records/official-compute-charge-state.md:11`：裸分支 → `official-compute-charge-trigger`
- [x] ⚠️ **不动** `records/…md` 里另外 2 处 `ctx.usageReporter`（一处是「首版写错了」的历史叙述、
      一处是**反断言的锚点**）⇒ 全局替换会让反断言当场红

## 5. 验证

- [x] ops-center 定向 5 个文件 ⇒ **63 passed**（含本片新增 12 例）
- [x] **变异验证 5/5 全被抓住**：M1 去掉守卫 / M2 单价改错 / M3 provider 写错 /
      M4 spec 大小写错 / M5 per_char 单位错（200→200000）
- [x] 每次变异后**逐字节恢复** + 复跑基线 ⇒ 恢复后基线全绿
- [x] `seed.json` 差量形状：**+148 / −0**
- [x] 6 张卡的唯一约束维度两两不同；priced 无 0 价卡；id 唯一
- [x] 仓内门禁（见执行记录）全绿

## 6. 遗留（不假装已闭合）

- [ ] **MiniMax-H3-Max 缺价** ⇒ 官方算力走 H3-Max 会**拒绝服务**（官方定价口径互斥，不可确认）
- [ ] **`minimax-multimodal` 的 video / llm 能力缺价**（`MiniMax-Hailuo-2.3` / `MiniMax-M2.7`）
      ⇒ **R5-3 的 Key 池路由必须只选有生效卡的 (provider, model, action)**
- [ ] **Highspeed / Lite 档位**未暴露 ⇒ 将来暴露时**必须同批建卡**
- [ ] **`image-01-live` / `speech-2.8-hd`** 未暴露 ⇒ 同上
- [ ] **仓内两套 spec 形态**：既有测试用自造形态（`model="H3"` / `spec="768p"` 小写），
      生产是 `MiniMax-H3` / `768P`（大写）⇒ 本片锁的是生产形态；既有测试**未改**（它测机制不测口径）
      ⇒ 遗留一条「照抄既有测试会写出错的卡」的认知负担
- [ ] **上游账单对拍**（`proc_discount`）未做 ⇒ 全部按 1.0
- [ ] **日桶回算对多档价结构性不可用** ⇒ 官方算力成本账必须走事件级
- [ ] **缺价拒绝服务的用户文案**属 R5-3 的交互设计（本刀只保证服务端如实区分两种缺价）
