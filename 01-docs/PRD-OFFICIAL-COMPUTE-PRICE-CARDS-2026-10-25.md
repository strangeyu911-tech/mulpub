# PRD — 官方算力 MiniMax 价格卡（R5-4a）

> 状态：**已实现并验证**（本 PR 内）
> 日期：2026-10-25　分支：`official-compute-price-cards`
> 上游：R5-1（#4463 事件级用量通道）→ R5-2（#4470 扣分状态机）
> 依据：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §6.2 / §6.3、
> `01-docs/usage-metering-spec.md`、仓内实读（每条结论带落点）

---

## 一、这一刀解决什么

R5-1 接通了「一次 provider 调用 ⇒ 落一条 `model_usage_events`」，R5-2 接通了
「这笔该不该扣 ⇒ 状态机」。**但成本算出来一直是 0**，因为**价格卡是空的**：

- `model_price_cards` 表在、版本化价格表的服务在、幂等种子脚本在；
- 但 `seed/model_price_cards.seed.json` 的 `priced` 段**只有 5 张**（deepseek / doubao-llm 的 token 卡）；
- MiniMax 的全部条目躺在 `pending` 段 ⇒ **官方算力的每一次调用都命中不到卡**
  ⇒ 成本恒 0 + 每次都报「缺价格」。

⇒ **缺价不是缺陷，是「还没有价」**。这一刀就是**把 MiniMax 的价变成可入库的真卡**，
并补上「同模型多档价」这件事的**防错账守卫**。

---

## 二、现状实读（每条可回源码核对）

| 事实 | 落点 | 读数 |
|---|---|---|
| 价格卡表 | `ops-center/backend/models_credit.py:67` `ModelPriceCard` | 字段齐（provider/model/action/unit/spec/tier/单价/采购形状/生效期） |
| 积分单价 | 同文件 `:128` `CreditPriceConfig` | `CREDIT_UNIT_MICROS = 10000`（1 积分 = 1 分 = ¥0.01） |
| 种子脚本 | `ops-center/backend/scripts/seed_credit_price_cards.py` | **只插不改**（改价 = 插新行 + 补旧行 `effective_to`） |
| 种子数据 | `ops-center/backend/seed/model_price_cards.seed.json` | `priced` 5 条 / `pending` 18 条 |
| 事件级取卡 | `services/usage_event_service.py:239` | **已传**真实 `model` / `spec` / `quality_tier` ✅ |
| 日桶回算取卡 | `services/credit_cost_backfill_service.py:125` | 传 `model=""`（**日桶表结构上没有 model/spec 维度**） |
| 非 token 维度映射 | `services/credit_price_service.py:64` `USAGE_FIELD_TO_UNIT` | `duration_seconds→per_second` / `item_count→per_image` / `char_count→per_char` ✅ |
| 三个维度**能不能真拿到** | `apps/desktop/electron/services/usage-dimensions.js` | 视频秒数 = `usage.total_seconds`（H3 v2 原样透出）；图像张数 = `params.n \|\| 1`；语音字符数 = `params.text.length` ⇒ **三个都能拿到** ✅ |

---

## 三、口径：方案稿的 8 张 → 实际建 6 张（**收窄，逐条有据**）

`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` 与
`/workspace/output/ROUND5-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` 列了 8 张 MiniMax 卡。
按「**列入即承诺行为**」+「**未知必须 fail-closed，不填暂定数字**」两条纪律逐条复核后，
**只有 6 张能建**：

| 方案稿的 8 张 | 处置 | 依据 |
|---|---|---|
| H3 2K ¥0.80/秒 | ✅ **建** | 仓内可选（`model-provider-seeds.js` 的 `minimax` provider） |
| H3 768P ¥0.50/秒 | ✅ **建** | 同上 |
| H3-Highspeed 768P ¥0.40/秒 | ⛔ **不建** | 官方**有价且已核对**，但**仓内没有这个模型档位**（适配器模型表只有 `MiniMax-H3` / `MiniMax-H3-Max`）⇒ 建了也**永远走不到** |
| H3-Lite 768P ¥0.26/秒 | ⛔ **不建** | 同上 |
| H3-Lite 480P ¥0.16/秒 | ⛔ **不建** | 同上 |
| image-01 ¥0.025/张 | ✅ **建** | `minimax-image` 与 `minimax-multimodal` **两个入口** ⇒ 建 2 张 |
| image-01-live ¥0.025/张 | ⛔ **不建** | 桌面端适配器**强制固定 `image-01`**（忽略调用方传入的 model）⇒ 永远走不到 |
| speech-2.8-turbo ¥2.00/万字符 | ✅ **建** | `minimax-tts` 与 `minimax-multimodal` **两个入口** ⇒ 建 2 张 |
| speech-2.8-hd ¥3.50/万字符 | ⛔ **不建** | **仓内未暴露**该模型（`minimax-tts` 的 models 已被收窄成只有 `speech-2.8-turbo`） |
| — | ⛔ **不建** | **MiniMax-H3-Max**：**仓内可选**（`minimax.js` 的模型表有它），但**官方定价页与 V2 文档对这两个型号的描述互斥** ⇒ 价格不可确认 ⇒ 未知不建 |

⇒ **6 张 priced + 5 条 pending**（5 条 pending 把上面每个「不建」的理由**写清楚**，
含「为什么不能建」与「将来要建它需要先做什么」）。

⚠️ **两条必须知情的后果**（不假装已闭合）：

1. **官方算力走 `MiniMax-H3-Max` ⇒ 缺价拒绝服务**（不是静默按 0 记）。
2. **官方算力走 `minimax-multimodal` 的 video / llm 能力（`MiniMax-Hailuo-2.3` / `MiniMax-M2.7`）⇒ 同样缺价拒绝服务**。
   ⇒ 这直接是 **R5-3（Key 池路由）的一条硬约束**：**官方算力路由只选「有生效价格卡」的 (provider, model, action)**，
   否则用户会撞上「有卡外的模型」。

---

## 四、6 张卡的逐字段口径

### 4.1 定位维度（**最易错，且错了整条链静默失效**）

事件的三个定位字段**全部来自桌面端**：

| 价格卡字段 | 事件的来源 | 桌面端真源 |
|---|---|---|
| `provider_id` | `row.provider_id` | `model_providers.id`（如 `minimax` / `minimax-image` / `minimax-tts` / `minimax-multimodal`） |
| `action_type` | `row.category`（`action_type = category`） | `model_providers.category`（`video` / `image` / `tts` / `multimodal`） |
| `model_id` | `row.model` | 用户实际选的模型（`MiniMax-H3` / `image-01` / `speech-2.8-turbo`） |
| `spec` | `row.spec` | `params.resolution` ⇒ **大写 P**：`768P` / `2K` |

⇒ **这四条全部有机械锁**（见 §六 ①）。

### 4.2 6 张卡

| # | id | provider_id | model_id | action_type | unit | spec | 单价（微元） | 积分 |
|---|---|---|---|---|---|---|---|---|
| 1 | `minimax-h3-768p` | `minimax` | `MiniMax-H3` | `video` | `per_second` | `768P` | **500000** | 50 / 秒 |
| 2 | `minimax-h3-2k` | `minimax` | `MiniMax-H3` | `video` | `per_second` | `2K` | **800000** | 80 / 秒 |
| 3 | `minimax-image-01` | `minimax-image` | `image-01` | `image` | `per_image` | `''` | **25000** | **3 / 张**（ceil 2.5） |
| 4 | `minimax-multimodal-image-01` | `minimax-multimodal` | `image-01` | `multimodal` | `per_image` | `''` | **25000** | 3 / 张 |
| 5 | `minimax-tts-speech-2-8-turbo` | `minimax-tts` | `speech-2.8-turbo` | `tts` | `per_char` | `''` | **200** | 20 / 千字符 |
| 6 | `minimax-multimodal-speech-2-8-turbo` | `minimax-multimodal` | `speech-2.8-turbo` | `multimodal` | `per_char` | `''` | **200** | 20 / 千字符 |

⚠️ **三条单价口径（每条都有机械锁）**：

- `per_second` = **微元 / 秒**（¥0.50/秒 ⇒ 500000；¥0.80/秒 ⇒ 800000）。
- `per_image` = **微元 / 张**（¥0.025/张 ⇒ 25000 ⇒ `ceil(25000/10000)` = **3 积分**，不是 2.5）。
- `per_char` = **微元 / 字符**（¥2.00/万字符 = 2,000,000 微元 / 10,000 字符 = **200 微元/字符**）
  ⇒ ⚠️ **误按「微元/千字符」理解 ⇒ 错 1000 倍**；误按「元/千字符」填 200000 ⇒ 错 100 倍。

### 4.3 其它字段

`currency=CNY`｜`proc_discount=1.0`｜`credit_multiplier=1.0`｜`billed_by=billed_by_usage`
（MiniMax 按量付费，无窗口配额）｜`source=vendor_doc`（官方公开价）｜`effective_from=2026-10-25T00:00:00`
｜`effective_to=""`（当前生效）｜`quality_tier=std`。

---

## 五、★「缺维度即报错」守卫（本刀的核心）

### 5.1 问题

H3 的 `768P` 与 `2K` **共享 (provider, model, action, unit) 四个维度，只差 `spec`**。
而 `load_effective_cards` 原本的选卡逻辑是「同 unit 命中多条时取 `effective_from` 最新的一条」
⇒ **调用方没传 `spec` 时，会静默挑一张**：

- 挑中 `768P`（¥0.50/秒）而实际出了 `2K`（¥0.80/秒）⇒ **少收 37.5% 的成本**；
- 挑中 `2K` 而实际出了 `768P` ⇒ **多收 60%**。

⇒ **错账是不可见的，缺价告警是可见的** ⇒ 宁可缺价。

### 5.2 守卫

`load_effective_cards` 里新增一条：调用方**没传 `spec`**，而同一 `model_id` 下存在
**≥2 个不同 `spec`** 的卡 ⇒ **这批卡一个都不参与匹配** ⇒ 落进 `missing_units` ⇒ **缺价告警**。

⚠️ **通用卡（`spec` 为空串）不受影响** —— 它的语义就是「一价通吃」⇒
守卫若把通用卡也排掉，所有「一卡通吃」的 provider 都会假性缺价。

### 5.3 可观测：缺价的两种真因必须分开报

「缺维度」（补上 `spec` 即可）与「没建卡」（要建卡）**处置完全不同** ⇒ 分开报：

- `missing_detail[i].ambiguous_specs` = `["minimax/MiniMax-H3/2K", "minimax/MiniMax-H3/768P"]`
  ⇒ 运营知道该去**补 spec**；
- 没有 `ambiguous_specs` ⇒ 是**没建卡** ⇒ 运营该去**建卡**。

⇒ 且 `missing_detail` 现在**进返回值**（限量 20 条，与日志同量）⇒
调用方（未来的官方算力代理）能据此给用户可操作的提示。

### 5.4 连带结论（必须写进 R5-3 的硬约束）

**日桶回算（`model_usage_daily`）结构上没有 model/spec 维度** ⇒
对「同模型多档价」的场景**结构性不可用** ⇒ 守卫会让它**缺价**（正确）。
⇒ **官方算力成本账必须走事件级**（`model_usage_events` 有 model/spec/duration_seconds）。
⇒ 日桶这条路仍服务「单一混合价」的 provider（deepseek / doubao-llm）⇒ 不受影响。

---

## 六、数据校验清单（每条都有可跑的判据）

| # | 校验 | 判据形态 |
|---|---|---|
| ① | 每张卡的 (provider_id, action_type, model_id) 在**桌面端真实存在** | 解析 `model-provider-seeds.js` 真源 ⇒ 桌面端改了 provider，锁立刻红 |
| ② | `action_type` **等于**该 provider 的 `category` | 同上（事件里 `action_type = category`） |
| ③ | 视频卡 `spec` 是**大写 P**（`768P` / `2K`） | 解析 `minimax-h3-v2.js` 的 `DEFAULT_RESOLUTION` ⇒ 钉住生产形态 |
| ④ | `per_second` 单价 = 官方 ¥0.50 / ¥0.80 每秒 | 判据侧自带期望值（不读被测卡） |
| ⑤ | `per_image` 单价 = 官方 ¥0.025 每张 | 同上 |
| ⑥ | `per_char` 单价 = 官方 ¥2.00 每万字符 ⇒ **200 微元/字符** | 同上（判据侧自带换算，不读被测卡） |
| ⑦ | 事件带真实 `spec` ⇒ **精确命中那一张** | 生产路径真跑（真卡 + 真形态事件） |
| ⑧ | 事件**不带 `spec`** ⇒ **缺价告警 + 点名歧义** | 同上（`ambiguous_specs` 非空 + `charge_status=unbillable`） |
| ⑨ | 通用卡（`spec=''`）**不受守卫影响** | 同上 |
| ⑩ | priced 里**无 0 价卡**、id 唯一、唯一约束维度不重复 | 种子脚本既有断言 + 本片新增 |

---

## 七、功能逻辑

1. **种子灌卡**：幂等（卡 id 存在且单价一致 ⇒ 跳过；单价不同 ⇒ **报错退出**，绝不静默改价）。
2. **改价流程**：**只插不改** —— 改价 = 插新行（`effective_from` 更新）+ 给旧行补 `effective_to`。
   ⇒ 历史成本**可复算**。
3. **取卡顺序**：先按 (provider, action) 取候选 ⇒ 按 model/spec/tier 过滤 ⇒
   **缺 spec 且多档价 ⇒ 全部排除** ⇒ 同 unit 命中多条时取 `effective_from` 最新。
4. **算成本**：`cost_micros = 数量 × unit_price_micros`（整数，全程无浮点）。
5. **算积分**：`credit_cost = ceil(cost_micros / credit_unit_price_micros × multiplier)`
   （`credit_unit_price_micros` 缺省回落 **10000**，不是 1 —— 回落成 1 会放大 10000 倍）。
6. **缺价**：成本记 0 **且**必须点名 ⇒ 事件落 `charge_status=unbillable` + `charge_error=MISSING_PRICE`。

---

## 八、交互逻辑与提示文字（本刀**无用户可见界面**，但有运营可见输出）

⚠️ **诚实边界**：本刀**不触碰任何用户可见界面与文案**（数据面，无 UI）。

运营/排障可见的输出有三处：

| 位置 | 提示文字（现状） | 说明 |
|---|---|---|
| 种子脚本 stdout | `ℹ️ 库里还没有 … 表 ⇒ 未灌过` / `+ 待插入 <card_id> <unit> <单价> 微元` | 现状形态，本刀**未改** |
| 种子脚本 `--check` | `+ N 条` / `- <provider> <action> 待确认` | 同上 |
| 缺价告警（log） | `usage-events: N 条事件缺价格卡（成本按 0 记账，需人工补卡）：[{…,"ambiguous_specs":[…]}]` | **本刀新增** `ambiguous_specs` 字段 |

⚠️ **给用户的文案不在本刀范围**：缺价拒绝服务时用户看到什么，属于 **R5-3（代理端点）**的交互设计
（本刀只保证服务端**如实区分**两种缺价，并把结构化诊断交出去）。

---

## 九、验收判据（可跑）

| # | 判据 | 本片读数 |
|---|---|---|
| 1 | ops-center 定向测试（5 个相关文件） | **63 passed** |
| 2 | 新增测试 | **12 例**（口径锁 5 + 生产路径 4 + 守卫本体 2 + 单价口径 3 ⇒ 实测 12） |
| 3 | **变异验证** | **5/5 全被抓住**（守卫去掉 / 单价改错 / provider 写错 / spec 大小写 / per_char 单位错） |
| 4 | 恢复后基线 | **全绿** |
| 5 | `seed.json` 差量形状 | **+148 / −0**（其余字节零改动 ⇒ 文本级插入，不是整体重写） |
| 6 | 唯一约束维度不重复 | 6 张卡两两不同（provider/model/action/unit/spec/tier/effective_from） |
| 7 | CCG 双模型外部评审 | **未执行**（本机无 `codeagent-wrapper`）⇒ 降级证据 = 仓内断言 + 5/5 变异 + 逐条源码对账 |

---

## 十、遗留边界（不假装已闭合）

1. **★ MiniMax-H3-Max 缺价** ⇒ 官方算力走 H3-Max 会**拒绝服务**（价格口径不可确认）。
2. **★ `minimax-multimodal` 的 video / llm 能力缺价**（`MiniMax-Hailuo-2.3` / `MiniMax-M2.7`）
   ⇒ 官方算力走这两条路会**拒绝服务** ⇒ **R5-3 的 Key 池路由必须只选有生效卡的组合**。
3. **Highspeed / Lite 档位**未暴露 ⇒ 将来暴露时**必须同批建卡**，否则该档位缺价拒绝服务。
4. **`image-01-live` / `speech-2.8-hd`** 未暴露 ⇒ 同上。
5. **仓内两套 spec 形态**：既有测试 `test_usage_event_service.py` 用的是**自造形态**
   （`model="H3"` / `spec="768p"` 小写），而**生产形态**是 `MiniMax-H3` / `768P`（大写）。
   ⇒ 本片的口径锁钉的是**生产形态**；既有测试**未改**（它测的是机制不是口径）⇒
   **遗留一条「假形态仍在仓内」的认知负担**，下一个人若照抄既有测试会写出错的卡。
6. **`minimax-multimodal` 的 video 能力无卡** ⇒ 它的 `MiniMax-Hailuo-2.3` 官方价未核对。
7. **日桶回算对多档价结构性不可用**（§5.4）⇒ 官方算力成本账必须走事件级。
8. **上游账单对拍**（采购折扣系数 `proc_discount`）未做 ⇒ 全部按 1.0（按官方公开价）。
9. **窗口配额类采购形态**未涉及（MiniMax 按量）⇒ 需另行建卡的是「有总额度的套餐」供应商。
