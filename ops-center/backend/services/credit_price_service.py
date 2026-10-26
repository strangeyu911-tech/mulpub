"""Credit price service — 版本化价格卡加载与服务端成本/积分换算.

**信任边界（本模块是这条边界的执行点）**：
成本**一律由服务端按价格卡算**。桌面端上报的 cost 字段只作为对拍样本存进
`model_usage_events.client_reported_cost_micros`，不参与任何计费决策。
理由：客户端算钱 = 客户端说了算。`model-provider-manager.js:371` 的注释已经
定过调（「单价换算属 ModelPriceCard 后续立项，这里不做本地估算避免伪数据」），
本模块就是那个「后续立项」的落点。

**换算口径**：
    cost_micros  = Σ(token_count / 1000 × unit_price_micros)     （微元）
    credit_cost  = ceil(cost_micros / credit_unit_price_micros × multiplier)

向上取整是刻意的：宁可少收 1 积分，不可多付 1 分成本。

**缺价格卡的处理**：命中不到价格卡时 cost 记 0，但**必须产生告警**——
静默按 0 会让成本统计失真，亏了都不知道。`missing_units` 由调用方落日志。
"""
from __future__ import annotations

import datetime
import math
from typing import Dict, Iterable, List, Optional, Tuple

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from models_credit import (
    CREDIT_UNIT_MICROS,
    BILLING_BASELINE_PRIORITY,
    BILLED_BY_QUOTA,
    BILLED_BY_WINDOW,
    CreditPriceConfig,
    ModelPriceCard,
    NON_TOKEN_UNITS,
    TOKEN_UNITS,
    UNIT_1K_TOKENS_CACHE_READ,
    UNIT_1K_TOKENS_CACHE_WRITE,
    UNIT_1K_TOKENS_IN,
    UNIT_1K_TOKENS_OUT,
    UNIT_1K_TOKENS_REASONING,
    UNIT_PER_CHAR,
    UNIT_PER_IMAGE,
    UNIT_PER_SECOND,
    UNIT_PER_SECOND_AUDIO,
)

ALL_UNITS = TOKEN_UNITS + NON_TOKEN_UNITS

# 桌面端上报字段 → 内部 unit 口径（口径对齐 10-08 §4.1 的 unit 命名）
TOKEN_FIELD_TO_UNIT = {
    "tokens_in": UNIT_1K_TOKENS_IN,
    "tokens_out": UNIT_1K_TOKENS_OUT,
    "tokens_cache_read": UNIT_1K_TOKENS_CACHE_READ,
    "tokens_cache_write": UNIT_1K_TOKENS_CACHE_WRITE,
    "tokens_reasoning": UNIT_1K_TOKENS_REASONING,
}

# ⚠ **非 token 维度的上报字段映射**（本次新增，2026-10-25）。
# ⚠ 缺这张表 ⇒ `per_second` / `per_image` / `per_char` 三种 unit **永远拿不到数量**
#   ⇒ `compute_cost_micros` 里 `cards.get(unit)` 恒为 None
#   ⇒ 视频/图像/TTS 的成本**恒为 0 且全量报「缺价格」**（错误长得像「免费」）。
# ⚠ 这与「日桶级与事件级映射漂移」是同一族缺陷：**同一条成本路径上两处映射不一致 ⇒ 静默算成 0**。
USAGE_FIELD_TO_UNIT = {
    "duration_seconds": UNIT_PER_SECOND,
    "item_count": UNIT_PER_IMAGE,
    "char_count": UNIT_PER_CHAR,
}

# ⚠ **音频的秒数走另一个 unit**（`per_second_audio` ≠ `per_second`）：
#   视频按秒、音频生成也按秒，但两者单价不同 ⇒ 必须分卡计价。
#   桌面端上报的 `category` 取值域含 `audio`（model-log-store 的类别注释：
#   llm/tts/image/video/audio）⇒ 用它分流。
# ⚠ 分流**只影响 duration**：`item_count`/`char_count` 与类别无关。
AUDIO_CATEGORIES = ("audio", "music", "voice")


class CostResult:
    """一次调用的成本计算结果。"""

    __slots__ = ("cost_micros", "price_ids", "missing_units", "multiplier")

    def __init__(self, cost_micros: int, price_ids: List[str], missing_units: List[str], multiplier: float):
        self.cost_micros = cost_micros
        self.price_ids = price_ids
        self.missing_units = missing_units
        self.multiplier = multiplier

    @property
    def price_id(self) -> str:
        """本次调用命中的价格卡 ID（多张用 '+' 连接），空串表示未命中任何价格卡。"""
        return "+".join(self.price_ids)

    @property
    def has_missing_price(self) -> bool:
        return bool(self.missing_units)


class PriceCard:
    """生效中的价格卡（内存表示）。"""

    __slots__ = ("id", "unit", "unit_price_micros", "multiplier", "billed_by")

    def __init__(self, card_id: str, unit: str, unit_price_micros: int, multiplier: float,
                 billed_by: str = "billed_by_usage"):
        self.id = card_id
        self.unit = unit
        self.unit_price_micros = int(unit_price_micros)
        self.multiplier = float(multiplier)
        self.billed_by = billed_by


def compute_cost_micros(
    cards: Dict[str, PriceCard],
    token_counts: Dict[str, int],
) -> CostResult:
    """纯函数：按生效价格卡把 token 消耗换算成成本（**微元**）。

    单价语义是「**微元** / 1000 unit」——与 `official_keys.cost_per_1k_tokens`
    的既有口径一致（都是每千 token 的价），便于运营对照。

    ⚠️ **0 价卡按「缺价」处理**（不是「免费」）：`unit_price_micros <= 0` 的卡
    会被计入 `missing_units` 并跳过计算。理由：0 价卡一旦入库，回算会静默命中它
    ⇒ 成本算成 0 ⇒ 既不告警、又被当成「免费」⇒ 成本统计系统性偏低且无信号。
    ⇒ 真正的守卫在写入侧（管理端 API 与种子脚本都拒 0 价卡），这里是第二道防线。

    :param cards: unit → PriceCard
    :param token_counts: unit → 数量
    """
    cost_micros = 0
    price_ids: List[str] = []
    missing: List[str] = []
    multiplier = 1.0
    for unit, count in token_counts.items():
        if not count:
            continue
        card = cards.get(unit)
        if card is None or card.unit_price_micros <= 0:
            # ⚠️ 0 价卡与「没有卡」同义 ⇒ 一律走缺价通道（绝不当免费）
            missing.append(unit)
            continue
        # 整数微元计算：先乘后除，避免浮点误差累积。
        # ⚠️ **单价语义按 unit 区分**（10-08 §4.1）：
        #    `1k_tokens_*` 的单价是「微元 / 1K token」⇒ 除以 1000；
        #    `per_image` / `per_second` / `per_char` / `per_second_audio`
        #    的单价是「微元 / 个」⇒ **不除**。
        #    早期版本对所有 unit 一律 /1000 ⇒ 非 token 维度会算错 1000 倍。
        if unit in TOKEN_UNITS:
            cost_micros += int(count * card.unit_price_micros / 1000)
        else:
            cost_micros += count * card.unit_price_micros
        price_ids.append(card.id)
        # 倍率取命中的最大者（多个 unit 时以最贵那个为准，避免低估）
        multiplier = max(multiplier, card.multiplier)
    return CostResult(cost_micros, price_ids, missing, multiplier)


def compute_credit_cost(cost_micros: int, credit_unit_price_micros: int, multiplier: float = 1.0) -> int:
    """纯函数：成本（**微元**）→ 积分消耗。向上取整。

    :param credit_unit_price_micros: 1 积分值多少微元（默认 10000，即 1 积分 = 1 分）
    :param multiplier: 价格卡的积分倍率（贵模型多扣积分）
    """
    if cost_micros <= 0:
        return 0
    unit_price = max(1, int(credit_unit_price_micros))
    return int(math.ceil(cost_micros * float(multiplier) / unit_price))


def is_pricing_baseline_usable(cards: Dict[str, PriceCard]) -> bool:
    """该组价格能否作**定价基准**（10-11 §6 的来源优先级）。

    · B 类按量付费（billed_by_usage）⇒ 首选基准
    · A 类有总额度的套餐（billed_by_quota）⇒ 次选
    · C 类窗口配额（billed_by_window）⇒ **仅作参考，不入基准**

    ⇒ 只要命中的卡里有一张是 C 类，整组**不可入基准**（保守侧：宁可不用基准，
      也不要拿一个依赖使用强度的估算值去定价）。
    """
    if not cards:
        return False
    for card in cards.values():
        if card.billed_by not in BILLING_BASELINE_PRIORITY:
            return False
    return True


def compute_period_bounds(now: Optional[datetime.datetime] = None) -> Tuple[str, str]:
    """自然月周期边界（UTC）。与 identity_entitlement_usage 的周期口径一致。"""
    current = now or datetime.datetime.utcnow()
    start = current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start.isoformat(), end.isoformat()


def _now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


async def load_effective_cards(
    db: AsyncSession,
    provider_id: str,
    model: str,
    category: str,
    at: Optional[str] = None,
    spec: str = "",
    quality_tier: str = "",
    ambiguous_specs: Optional[List[str]] = None,
) -> Dict[str, PriceCard]:
    """加载某 provider/model/category 在时刻 `at` 生效的价格卡。

    命中优先级：**精确 model > 通用（model 为空串）**。
    同一 (provider, model, category) 下若同时存在精确价与通用价，精确价覆盖通用价。

    生效判定：`effective_from <= at` 且（`effective_to` 为空 或 `effective_to > at`）。
    同一 unit 命中多条时取 `effective_from` 最新的一条。

    ⚠️ **缺维度即报错**（同 model 多档价时，调用方必须传真实 `spec`）：
    同一个 `model_id` 下存在 **≥2 个不同 spec** 的卡，而调用方**没传 spec** 时，
    这批卡**一个都不参与匹配** ⇒ 落进 `missing_units` ⇒ **缺价告警**。
    理由：按 `effective_from` 挑一张 = **拿别的规格的价冒充**
    （H3 768P ¥0.50/秒 vs 2K ¥0.80/秒 ⇒ 差 60%），而缺价告警是可见的、错账是不可见的。
    ⇒ **通用卡（`spec` 为空串）不受影响** —— 它的语义就是「一价通吃」。
    ⚠️ 这条同时意味着：**日桶回算（`model_usage_daily` 结构上没有 model/spec 维度）
    对「同模型多档价」的场景结构性不可用** ⇒ 官方算力成本账**必须走事件级**
    （`model_usage_events` 有 model/spec/duration_seconds）。
    """
    moment = at or _now_iso()
    rows = (
        await db.execute(
            sa.select(ModelPriceCard).where(
                ModelPriceCard.provider_id == provider_id,
                ModelPriceCard.action_type == category,
            )
        )
    ).scalars().all()
    # 精确匹配维度：model_id / spec / quality_tier 三者都命中或卡上为通用值
    def _dim_ok(card) -> bool:
        if card.model_id not in (model or "", ""):
            return False
        if card.spec and spec and card.spec != spec:
            return False
        if card.quality_tier and quality_tier and card.quality_tier != quality_tier:
            return False
        return True

    candidates = [c for c in rows if _dim_ok(c)]
    # ⚠️ **缺维度即报错**：调用方没传 spec，而同 model 下有多档价 ⇒ 这批卡全都不用。
    #   （详见 docstring；`ambiguous_specs` 供调用方把「因歧义被排除」的原因报出来。）
    if not spec:
        specs_by_model: Dict[str, set] = {}
        for c in candidates:
            if c.spec:
                specs_by_model.setdefault(c.model_id, set()).add(c.spec)
        ambiguous = {mid for mid, specs in specs_by_model.items() if len(specs) >= 2}
        if ambiguous:
            kept: List[ModelPriceCard] = []
            for c in candidates:
                if c.spec and c.model_id in ambiguous:
                    if ambiguous_specs is not None:
                        ambiguous_specs.append(
                            "%s/%s/%s" % (provider_id, c.model_id or "*", c.spec)
                        )
                    continue
                kept.append(c)
            candidates = kept
    by_unit: Dict[str, Tuple[int, str, PriceCard]] = {}
    for card in candidates:
        if card.effective_from > moment:
            continue
        if card.effective_to and card.effective_to <= moment:
            continue
        # ⚠️ 列名是 `model_id`（`ModelPriceCard` 没有 `model` 属性）——
        # 写 `card.model` 会在**传入非空 model** 时 AttributeError。
        # 现状之所以没炸：回算调用点传的是 `model=""` ⇒ `and` 短路 ⇒ 右边根本不求值。
        # ⇒ 这是一条「靠短路活着的缺陷」：一旦 Phase 2 按 model 计价（传真实 model）就炸。
        precise = 1 if (model and card.model_id == model) else 0
        current = by_unit.get(card.unit)
        if current is None:
            by_unit[card.unit] = (precise, card.effective_from, PriceCard(
                card.id, card.unit, card.unit_price_micros, card.credit_multiplier or 1.0,
                card.billed_by or "billed_by_usage",
            ))
            continue
        current_precise, current_from, _current_card = current
        better = (
            precise > current_precise
            or (precise == current_precise and card.effective_from > current_from)
        )
        if better:
            by_unit[card.unit] = (precise, card.effective_from, PriceCard(
                card.id, card.unit, card.unit_price_micros, card.credit_multiplier or 1.0,
                card.billed_by or "billed_by_usage",
            ))
    return {unit: card for unit, (_, _from, card) in by_unit.items()}


async def get_credit_unit_price_micros(db: AsyncSession) -> int:
    """读积分单价（1 积分值多少**微元**）。

    ⚠️ 缺配置行时**必须返回 `CREDIT_UNIT_MICROS`（10000）**，不能返回 1。
    早期版本这里返回 1（旧「分」口径的遗留），而 `ensure_credit_price_config` 建的是 10000
    ⇒ 两条路不一致 ⇒ **在还没有配置行的库上（新建库 / 回算先于种子），
    积分消耗被放大 10000 倍**（实测：成本 12000 微元 ⇒ 记 12000 积分而不是 2）。
    ⚠️ 单测抓不到（不走 DB）⇒ 由端到端回算测试守护。
    """
    row = (
        await db.execute(sa.select(CreditPriceConfig).where(CreditPriceConfig.id == 1))
    ).scalars().first()
    if row is None:
        return CREDIT_UNIT_MICROS
    # 运营若把值配成 0（非法）⇒ 抬回基准，而不是抬成 1（那会差 10000 倍）
    return max(CREDIT_UNIT_MICROS, int(row.credit_unit_price_micros or CREDIT_UNIT_MICROS))


async def ensure_credit_price_config(db: AsyncSession) -> None:
    """种子：确保积分单价配置存在（不覆盖运营已改的值）。"""
    existing = (
        await db.execute(sa.select(CreditPriceConfig).where(CreditPriceConfig.id == 1))
    ).scalars().first()
    if existing is not None:
        return
    db.add(CreditPriceConfig(
        id=1,
        credit_unit_price_micros=CREDIT_UNIT_MICROS,
        target_margin_pct=72.90,
        grant_multiplier_default=1.0,
        effective_from=_now_iso(),
        note="1 积分 = 1 分；目标毛利率仅作提示，不参与计算",
    ))
    await db.flush()


def token_counts_from_event(event: dict) -> Dict[str, int]:
    """从上报项抽出 unit → 数量映射（供成本计算）。

    ⚠ **现在同时抽 token 维度与三个非 token 维度**（duration_seconds / item_count / char_count）。
      只抽 token 的旧版 ⇒ 视频/图像/TTS 的成本恒 0 且全报「缺价格」。
    ⚠ **音频的秒数走 `per_second_audio`**（与视频的 `per_second` 分卡计价），
      分流依据是 `action_type` 或 `category`（桌面端取值域含 `audio`）。
    ⚠ 两个维度同时命中同一个 unit 时**累加**（不是覆盖）——例如一条事件既是视频又有图片张数。
    """
    counts: Dict[str, int] = {}
    for field, unit in TOKEN_FIELD_TO_UNIT.items():
        value = event.get(field)
        if value:
            counts[unit] = int(value)
    category = str(
        event.get("action_type") or event.get("category") or ""
    ).strip().lower()
    for field, unit in USAGE_FIELD_TO_UNIT.items():
        value = event.get(field)
        if not value:
            continue
        if field == "duration_seconds" and category in AUDIO_CATEGORIES:
            unit = UNIT_PER_SECOND_AUDIO
        counts[unit] = counts.get(unit, 0) + int(value)
    return counts


def summarize_missing_price(missing_units: Iterable[str]) -> str:
    """缺价格卡的可读描述（落日志用）。"""
    units = sorted(set(missing_units))
    if not units:
        return ""
    return ",".join(units)
