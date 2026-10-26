## Why

官方算力第 5 轮 R5-4a。R5-1（#4463）打通了事件级用量，R5-2（#4470）打通了扣分状态机，
**但成本算出来一直是 0** —— 因为**价格卡是空的**：

- `model_price_cards` 表在、版本化价格服务在、幂等种子脚本在；
- 但 `seed/model_price_cards.seed.json` 的 `priced` 段**只有 5 张**（deepseek / doubao-llm 的 token 卡）；
- MiniMax 全部躺在 `pending` ⇒ **官方算力的每一次调用都命中不到卡** ⇒ 成本恒 0 + 每次都报「缺价格」。

⚠️ 更要紧的是：**即使把卡灌进去，也还有一个会「静默算错账」的口子** ——
H3 的 `768P` 与 `2K` **共享 (provider, model, action, unit) 四个维度，只差 `spec`**，
而现选的逻辑是「同 unit 命中多条时取 `effective_from` 最新的一条」
⇒ **调用方没传 `spec` 就会静默挑一张** ⇒ 成本偏差 37.5%–60% ⇒ **错账不可见，缺价告警才可见**。

## What Changes

- **6 张 MiniMax 价格卡入库**（`seed/model_price_cards.seed.json` 的 `priced` 段）：

  | provider_id | model_id | action_type | unit | spec | 微元 |
  |---|---|---|---|---|---|
  | `minimax` | `MiniMax-H3` | `video` | `per_second` | `768P` | 500000 |
  | `minimax` | `MiniMax-H3` | `video` | `per_second` | `2K` | 800000 |
  | `minimax-image` | `image-01` | `image` | `per_image` | `''` | 25000 |
  | `minimax-multimodal` | `image-01` | `multimodal` | `per_image` | `''` | 25000 |
  | `minimax-tts` | `speech-2.8-turbo` | `tts` | `per_char` | `''` | 200 |
  | `minimax-multimodal` | `speech-2.8-turbo` | `multimodal` | `per_char` | `''` | 200 |

- **★ 口径收窄：8 张 → 6 张**（逐条有据，见 PRD §3）：
  `H3-Highspeed` / `H3-Lite`（官方有价但**仓内无此档位**）、`image-01-live`
  （适配器**强制固定** `image-01`）、`speech-2.8-hd`（**仓内未暴露**）——
  这 4 张**建了也永远走不到** ⇒ 改为登记进 `pending`（写明「为什么不能建」+「将来要建它需要先做什么」）；
  另 `MiniMax-H3-Max`（**仓内可选**但官方定价页与 V2 文档**描述互斥** ⇒ 价格不可确认）⇒ 不建。
- **★ 「缺维度即报错」守卫**（`services/credit_price_service.py::load_effective_cards`）：
  调用方**没传 `spec`** 而同 `model_id` 下有 **≥2 个不同 `spec`** 的卡 ⇒
  **这批卡一个都不参与匹配** ⇒ 落进 `missing_units` ⇒ **缺价告警**。
  ⚠️ 通用卡（`spec=''`，语义是「一价通吃」）**不受影响**。
- **缺价的两种真因分开报**（`services/usage_event_service.py`）：
  `missing_detail[i].ambiguous_specs` 列出「因 spec 歧义被排除」的卡
  ⇒ 运营据此知道该**补 spec**（而不是去建卡）；无此字段 ⇒ 是**没建卡**。
  且 `missing_detail` **进返回值**（限量 20 条）⇒ 调用方能据此给用户可操作提示。
- **口径机械锁**（新增 `tests/test_minimax_price_cards.py`）：
  解析**桌面端真源**（`model-provider-seeds.js` / `minimax-h3-v2.js`）⇒
  断言每张卡的 (provider_id, action_type, model_id) **真实存在**、`action_type` **等于**该 provider 的
  `category`、视频 `spec` 是**大写 P**；三条单价的期望值**判据侧自带**（不读被测卡）。

## Capabilities

### New Capabilities

- `official-compute-price-cards`: 官方算力 **MiniMax 价格卡**的契约 —— 定位维度口径
  （`provider_id` / `action_type` / `model_id` / `spec` 必须与桌面端逐字一致）、
  三种 unit 的单价口径（微元/秒、微元/张、**微元/字符**）、
  「同模型多档价 ⇒ 缺维度即报错」守卫、缺价两种真因的可分辨诊断。

## Impact

- **ops-center 后端**：
  - `backend/seed/model_price_cards.seed.json`（**+6 张 priced / +5 条 pending**，+148 行 / −0 行）
  - `backend/services/credit_price_service.py`（`load_effective_cards` 加歧义守卫 + `ambiguous_specs` 收集）
  - `backend/services/usage_event_service.py`（调用点收集歧义原因 + `missing_detail` 进返回值）
  - `backend/tests/test_minimax_price_cards.py`（**新增**，12 例）
- **文档**：`01-docs/PRD-OFFICIAL-COMPUTE-PRICE-CARDS-2026-10-25.md`
  （现状实读 / 8→6 收窄依据 / 6 张卡逐字段 / 守卫机制 / 10 条数据校验 / 9 条遗留边界）
- **顺带订正 R5-2 文档的 4 处事实错误**（合并后逐文件实读发现）：
  `ctx.usageReporter` → `context.usageReporter`（2 处：proposal / tasks）、
  `49/49 绿` → `52/52 绿`、裸分支名 → `official-compute-charge-trigger`。
  ⚠️ **只改这 4 处**：`records/…md` 里另有 2 处 `ctx.usageReporter` 是**正确的**
  （一处叙述「首版写错了」的历史、一处是**反断言的锚点**）⇒ 全局替换会让反断言当场红。
- **不触碰**：会员定价、扣分端点、扣分状态机、发放链路、任何用户可见界面与文案、桌面端任何代码。
