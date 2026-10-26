# Design — 官方算力 MiniMax 价格卡（R5-4a）

> 上游定案：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §6.2（Key 池/取卡校验）
> 与 §6.3（价格与成本）；价格与用量口径：`01-docs/usage-metering-spec.md`。
> 本文只写**本刀新增的判断**与**必须继承的口径**。

## 1. 定位维度：卡与事件必须逐字对齐

事件的四个定位字段**全部来自桌面端**（`usage-reporter.js` → `model_provider_logs`）：

| 事件字段 | 来源 | 桌面端真源 |
|---|---|---|
| `provider_id` | `row.provider_id` | `model_providers.id` |
| `action_type` | `row.category` | `model_providers.category`（**`action_type = category`**） |
| `model` | `row.model` | 用户实际选的模型 |
| `spec` | `row.spec` | `params.resolution`（**大写 P**：`768P` / `2K`） |

⇒ **这四条全错 ⇒ 卡永远命中不到 ⇒ 官方算力恒缺价**，而**卡本身看起来完全正常**。
⇒ 所以它们必须有**机械锁**（§4 ①–③）。

⚠️ **一处易错**：`minimax` 的**视频**、**图像**、**TTS** 是**三个不同的 provider id**
（`minimax` / `minimax-image` / `minimax-tts`），外加一个多模态的 `minimax-multimodal`
⇒ 同一模型可能从**两个** provider 走 ⇒ **卡要按 provider 分别建**（6 张里有 2 组是同一模型的两条路）。

## 2. 单价口径：三种 unit 的量纲各不相同

`credit_unit_price_micros = 10000`（1 积分 = 1 分 = ¥0.01）。

| unit | 数量来源 | 单价语义 | MiniMax 官方价 | 卡里填 |
|---|---|---|---|---|
| `per_second` | `usage.total_seconds`（H3 v2 **原样透出**） | 微元 / **秒** | ¥0.50/秒（768P）、¥0.80/秒（2K） | 500000 / 800000 |
| `per_image` | `params.n \|\| 1` | 微元 / **张** | ¥0.025/张 | 25000 |
| `per_char` | `params.text.length` | 微元 / **字符** | ¥2.00 / **万字符** | **200** |

⚠️ **`per_char` 是按「字符」而不是「千字符」**（`USAGE_FIELD_TO_UNIT` 里
`char_count → per_char`，count 是**字符数**）⇒ ¥2.00/万字符 = 2,000,000 微元 / 10,000 字符
= **200 微元/字符** ⇒ 误按「微元/千字符」填 200 ⇒ **错 1000 倍**；误按「元/千字符」填 200000 ⇒ 错 100 倍。

⚠️ **积分取整**：`credit_cost = ceil(cost_micros / 10000 × multiplier)` ⇒
单张图 25000 微元 ⇒ `ceil(2.5)` = **3 积分**（不是 2.5）⇒ 「2.5 积分/张」只能是对外宣传口径，
**账上必须按 3 记**（少收 1 积分比多付 1 分成本安全）。

⚠️ **兜底下限**：`credit_unit_price_micros` 读到 0 时**退回基准 10000**，不是 1
（`credit_price_service.py` 的 `max(CREDIT_UNIT_MICROS, …)`）⇒ 自行实现成「退到 1」会放大 10000 倍。

## 3. ★「缺维度即报错」守卫

### 3.1 形态

H3 的 `768P` 与 `2K` 共享 (provider, model, action, unit) 四个维度，**只差 `spec`**。
原选卡逻辑是「同 unit 命中多条时取 `effective_from` 最新的一条」
⇒ **调用方没传 `spec` ⇒ 静默挑一张** ⇒ 成本偏差 37.5%–60%。

### 3.2 判据

```
调用方没传 spec  且  同一 model_id 下存在 ≥2 个不同 spec 的候选卡
  ⇒ 这批卡**全部不参与匹配**
  ⇒ 该 unit 在 cards 里缺席
  ⇒ compute_cost_micros 记 missing_units
  ⇒ 事件落 charge_status=unbillable / charge_error=MISSING_PRICE
```

⚠️ **通用卡（`spec` 为空串）不受影响** —— 它的语义是「一价通吃」；
守卫若把通用卡也排掉，所有「一卡通吃」的 provider 都会假性缺价。

### 3.3 为什么选「排除」而不是「报错」

排除 ⇒ 复用既有的缺价通道（`missing_units` + 告警 + `unbillable`）⇒ **零改动算钱路径**；
而报错会在 `load_effective_cards` 里抛异常 ⇒ **一条事件能炸掉整批入库**（批量上报的形态）
⇒ 与「缺价必须被点名而不是静默按 0」的设计取向一致。

### 3.4 两种缺价必须可分辨

| 现象 | 真因 | 运营该做什么 |
|---|---|---|
| `missing_detail[i].ambiguous_specs` **非空** | 事件**没带 spec**（或带了但库里没这档） | **补 spec**（桌面端传 / 代理层问用户） |
| 无 `ambiguous_specs` | **没建卡** | **建卡** |

⇒ 之前 `missing_detail` **只进日志** ⇒ 调用方拿不到 ⇒ 未来的官方算力代理**无法**据此给用户
「请指定分辨率」这类可操作提示 ⇒ 本刀把它**进返回值**（限量 20 条，与日志同量）。

## 4. 机械锁清单（判据侧自带期望值 / 读真源）

| # | 锁 | 形态 |
|---|---|---|
| ① | 每张卡的 (provider_id, model_id) 在桌面端**真实存在** | 解析 `model-provider-seeds.js`（**按对象切块**，避免 `.*?` 跨对象） |
| ② | `action_type` **等于**该 provider 的 `category` | 同上 |
| ③ | 视频 `spec` 是**大写 P** | 解析 `minimax-h3-v2.js` 的 `DEFAULT_RESOLUTION` |
| ④ | `per_second` 单价 = 500000 / 800000 | 判据侧自带期望值 |
| ⑤ | `per_image` 单价 = 25000 | 同上 |
| ⑥ | `per_char` 单价 = 200（= 官方 ¥2.00/万字符 换算） | 判据侧自带换算，**不读被测卡** |
| ⑦ | 真卡 + 真形态事件 ⇒ **精确命中那一张** | 生产路径真跑（`ingest_usage_events`） |
| ⑧ | 事件**不带 spec** ⇒ **缺价告警 + 点名歧义** | 同上 |
| ⑨ | 通用卡不受守卫影响 | 同上 |

⚠️ ①–③ 是**内容级锁**（读桌面端源码文本）⇒ 桌面端改了 provider / 分辨率形态，锁会红
⇒ 这正是「口径必须能被别人改出来时立刻发现」的要求。

## 5. 连带结论（交给下一刀）

1. **★ R5-3（Key 池路由）的硬约束**：官方算力路由**只选有生效价格卡的
   (provider, model, action)** ⇒ 否则用户会撞上「有卡外的模型」⇒ 缺价拒绝服务。
2. **日桶回算对多档价结构性不可用**：`model_usage_daily` 表结构上没有 model/spec 维度
   ⇒ 守卫会让它缺价（正确）⇒ **官方算力成本账必须走事件级**。
3. **缺价拒绝服务的用户文案**属 R5-3 的交互设计；本刀只保证服务端**如实区分两种缺价**。
