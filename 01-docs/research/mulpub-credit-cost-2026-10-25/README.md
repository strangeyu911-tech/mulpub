# Mulpub 积分成本方案 + 开源全景调研（2026-10-25）

本目录是 2026-10-24~25 的一批**成果物**入库：一份积分/算力成本落地方案 + 一份 5 轨并行
的开源全景调研（含 5 份轨道报告）。

> ⚠️ **本目录是「方案与调研」，不是「定案」**。
> 积分计费的**定案**在 `01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md`
> （及其同批的 `DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md` 等）——
> 两者冲突时**以定案为准**。本目录负责回答「怎么落地」与「有哪些现成轮子可抄」。

## 先读哪份

| 读者 | 建议顺序 |
|---|---|
| 运营 / 定价决策 | `mulpub-credit-cost-plan.md` 的 §1–§3（成本口径、赠送量推导、落地路线） |
| 研发 / 实施 | `mulpub-credit-cost-plan.md` 的 §4–§6（改动清单、运营操作手册、验收判据） |
| 想找现成轮子 | `mulpub-oss-landscape.md`（总报告，含 5 轨结论汇总与选型建议） |
| 只关心某一维度 | `tracks/track-*.md`（desktop / automation / ai / media / ops 五份轨道报告，含逐候选的 API 级取证） |

## 核心口径（与定案一致，改动前先对一遍）

- **1 积分 = ¥0.01 = 10000 微元**（`CREDIT_UNIT_MICROS`）——
  LLM 每千 token 单价天然亚分，整数「分」列只能存 0（静默当免费）或 1（放大 3.3 倍）⇒ 成本最小单位用**微元**。
- **赠送量**：standard **1600** / pro **3330** / free 30。
  pro 的 3330 是「月付目标 28%」与「年付守线 40%」的**唯一交点**
  （年付 12×3330 = ¥399.6 = ¥999 的 40.0%；月付 ¥33.3/¥119 = 28.0%）。
  2200 是**旧价 ¥79 时代**按 27.8% 反解的遗留值，涨价后占比掉到 18.5% ⇒ 白送 13.6 个点。
- **改价 = 插新行 + 给旧行补 `effective_to`**，**禁止 UPDATE 单价**（否则历史成本不可复算）。
- **缺价必须告警**；**绝不插 0 价卡**（0 价会被静默命中 ⇒ 成本算成 0 且不告警）。

## 这批成果物与已入库代码的关系

| 成果物 | 对应的代码 | 状态 |
|---|---|---|
| 成本方案 §4 改动清单 | `ops-center/backend/{models_credit.py, services/credit_price_service.py, services/credit_cost_backfill_service.py, routers/credit_pricing.py, scripts/seed_credit_price_cards.py}` | 已落地（PR #4393，含 QM-6 评审收口） |
| 成本方案 §5 操作手册 | `ops-center/backend/seed/model_price_cards.seed.json`（5 张已知价 + 18 组待确认） | 已落地 |
| 成本方案 §6 验收判据 | `ops-center/backend/tests/test_credit_{price_service,price_cards_seed,pricing_api,cost_backfill_service}.py` | 已落地 |
| 成本方案 §7「本次没做」 | 扣减接线（账户/账本双轨、FIFO 过期、充值、预授权结算、过期分录） | **未做** ⇒ 属 Phase 2 |

⚠️ **赠送量已上线、扣减接线未做** ⇒ 当前积分是「发放量」而非「按消耗扣减」，
上线前须确认这与运营预期一致（定案里赠送量本应等「防亏三道闸」接通后才对用户放量）。

## 调研报告的取证纪律

5 份轨道报告里，每个候选都要求 **≥2 条独立 API 证据**（`api.github.com` / npm / PyPI），
许可证一律以 **`/license` 正文**为准（不采信 README 的声明，也不采信 `spdx_id`——
`NOASSERTION` 背后可能是 MIT，也可能是禁止商用）。

⚠️ 报告里出现的**外部绝对路径已全部改为仓内相对路径或「沙箱内，未入库」的形态描述**——
这是仓内 `check-doc-abs-paths` 门禁的要求（文档不得含本机绝对路径）。
沙箱内的取证脚本、API 响应快照等中间产物**未入库**（不入库的是「怎么查的」，入库的是「查到什么」）。
