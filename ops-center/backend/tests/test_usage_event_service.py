"""事件级用量上报的**接线**契约测试 —— 维度映射 + 入库 + 幂等 + 服务端算成本。

⚠️ 为什么必须单独成文件（不是并进 `test_credit_price_service.py`）：
   那个文件测的是**纯函数口径**；本文件测的是**生产路径**
   （`token_counts_from_event` → `compute_cost_micros` → `load_effective_cards`
   → `ModelUsageEvent` 落库）。
   ⚠️ 既有单测全绿却没抓到「视频/图像成本恒 0」，正是因为它测的是**另一条**路径
   ⇒ 恒真自检的典型形态：**要判据看着生产路径，别看着自造的样本**。

本文件锁住四件事：
1. **三个非 token 维度能抽出 unit**（视频按秒 / 图像按张 / 语音按字符）
   —— 缺这条 ⇒ `cards.get(unit)` 恒 None ⇒ 成本恒 0 且全报「缺价格」。
2. **音频的秒数走另一个 unit**（`per_second_audio` ≠ `per_second`）⇒ 分卡计价。
3. **事件入库幂等**（`event_id` 唯一约束）⇒ 重试重报不重复计数。
4. **成本由服务端按价格卡算**（客户端不报成本）+ **缺价必须被点名**（不静默当免费）。
"""
import os
import sys

import pytest
import pytest_asyncio
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Base  # noqa: E402
from models_credit import (  # noqa: E402
    UNIT_1K_TOKENS_IN,
    UNIT_PER_CHAR,
    UNIT_PER_IMAGE,
    UNIT_PER_SECOND,
    UNIT_PER_SECOND_AUDIO,
    ModelPriceCard,
    ModelUsageEvent,
)
import models_credit  # noqa: F401  (注册 ORM)

from services.credit_price_service import token_counts_from_event  # noqa: E402
from services import usage_event_service  # noqa: E402


# ────────────────────────── ① 纯函数：维度映射 ──────────────────────────

def test_duration_maps_to_per_second_unit():
    """视频的秒数必须能抽出 `per_second` —— 这是价格卡的 unit 字面量。

    ⚠️ 断言用**常量**而不是字面量 `"per_second"`：写死字面量的话，
    两侧一起漂移就发现不了（相对断言恒真）。
    """
    counts = token_counts_from_event({"duration_seconds": 10, "action_type": "video"})
    assert counts == {UNIT_PER_SECOND: 10}


def test_item_count_maps_to_per_image_unit():
    counts = token_counts_from_event({"item_count": 3, "action_type": "image"})
    assert counts == {UNIT_PER_IMAGE: 3}


def test_char_count_maps_to_per_char_unit():
    counts = token_counts_from_event({"char_count": 1200, "action_type": "tts"})
    assert counts == {UNIT_PER_CHAR: 1200}


def test_audio_duration_uses_a_different_unit_than_video():
    """音频的秒数走 `per_second_audio`，**不**与视频的 `per_second` 混用。

    ⚠️ 混用 ⇒ 音频按视频价计费（少扣）⇒ 属于「错误长得像正确」。
    """
    audio = token_counts_from_event({"duration_seconds": 8, "action_type": "audio"})
    video = token_counts_from_event({"duration_seconds": 8, "action_type": "video"})
    assert audio == {UNIT_PER_SECOND_AUDIO: 8}
    assert video == {UNIT_PER_SECOND: 8}
    assert UNIT_PER_SECOND_AUDIO != UNIT_PER_SECOND


def test_zero_dimensions_are_omitted():
    """全 0 的维度不能进 counts（否则 `cards.get(unit)` 命中 0 价卡的边界）。

    ⚠️ `compute_cost_micros` 里 `if not count: continue` 会跳过 0
    ⇒ 这里断言「不进 counts」是为了让映射层与计算层的语义一致。
    """
    counts = token_counts_from_event(
        {"duration_seconds": 0, "item_count": 0, "char_count": 0, "tokens_in": 0}
    )
    assert counts == {}


def test_token_and_non_token_dimensions_coexist():
    """token 维度与非 token 维度同时存在时**都要在**（不能互相挤掉）。"""
    counts = token_counts_from_event(
        {"tokens_in": 1000, "duration_seconds": 6, "action_type": "video"}
    )
    assert counts == {UNIT_1K_TOKENS_IN: 1000, UNIT_PER_SECOND: 6}


def test_same_unit_from_two_fields_accumulates():
    """两个字段落到同一 unit 时**累加**（不是后者覆盖前者）。"""
    counts = token_counts_from_event(
        {"duration_seconds": 10, "char_count": 100, "action_type": "video"}
    )
    assert counts[UNIT_PER_CHAR] == 100
    assert counts[UNIT_PER_SECOND] == 10


# ────────────────────────── ② DB：事件入库 ──────────────────────────

@pytest_asyncio.fixture
async def db_env():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield session_factory
    await engine.dispose()


async def _seed_card(session_factory, **overrides):
    row = dict(
        id="h3-768p",
        provider_id="minimax",
        model_id="H3",
        action_type="video",
        unit=UNIT_PER_SECOND,
        spec="768p",
        quality_tier="std",
        unit_price_micros=500_000,  # ¥0.50/秒 = 500000 微元
        currency="CNY",
        proc_discount=1.0,
        credit_multiplier=1.0,
        billed_by="billed_by_usage",
        source="vendor_doc",
        effective_from="2026-10-01T00:00:00",
        effective_to="",
    )
    row.update(overrides)
    async with session_factory() as s:
        s.add(ModelPriceCard(**row))
        await s.commit()
    return row["id"]


@pytest.mark.asyncio
async def test_event_is_stored_and_cost_is_computed_server_side(db_env):
    """一条视频事件 ⇒ 落库 + **服务端按价格卡算出成本**（客户端不报成本）。"""
    await _seed_card(db_env)
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(
            s,
            {
                "items": [
                    {
                        "event_id": "evt-1",
                        "provider_id": "minimax",
                        "category": "video",
                        "action_type": "video",
                        "model": "H3",
                        "spec": "768p",
                        "action": "generate_video",
                        "status": "success",
                        "duration_seconds": 10,
                        # 客户端**不报**成本：这里故意给一个错的 client 值
                        "client_reported_cost_micros": 1,
                    }
                ]
            },
        )
    assert res["ingested"] == 1
    assert res["missing_price"] == []

    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-1")
            )
        ).scalar_one()
        # 10 秒 × 500000 微元/秒 = 5000000 微元 = ¥5.00
        assert row.cost_micros == 5_000_000
        assert row.price_id == "h3-768p"
        assert row.duration_seconds == 10
        # 1 积分 = 10000 微元 ⇒ 5000000 / 10000 = 500 积分
        assert row.credit_cost == 500
        # 客户端透传值只留档对拍，不参与计算
        assert row.client_reported_cost_micros == 1


@pytest.mark.asyncio
async def test_duplicate_event_id_is_idempotent(db_env):
    """同一 `event_id` 重报 ⇒ 不重复计数（幂等键 = event_id）。"""
    await _seed_card(db_env)
    payload = {
        "items": [
            {
                "event_id": "evt-dup",
                "provider_id": "minimax",
                "action_type": "video",
                "model": "H3",
                "spec": "768p",
                "duration_seconds": 10,
            }
        ]
    }
    async with db_env() as s:
        first = await usage_event_service.ingest_usage_events(s, payload)
    async with db_env() as s:
        second = await usage_event_service.ingest_usage_events(s, payload)
    assert first["ingested"] == 1
    assert second["ingested"] == 0
    assert second["duplicate"] == 1

    async with db_env() as s:
        total = (
            await s.execute(select(ModelUsageEvent))
        ).scalars().all()
    assert len(total) == 1


@pytest.mark.asyncio
async def test_empty_event_id_is_rejected(db_env):
    """`event_id` 空值 ⇒ 硬拒（否则幂等键失效 ⇒ 重报会重复计数）。"""
    with pytest.raises(ValueError):
        async with db_env() as s:
            await usage_event_service.ingest_usage_events(
                s,
                {"items": [{"event_id": "", "provider_id": "minimax", "duration_seconds": 3}]},
            )


@pytest.mark.asyncio
async def test_missing_price_card_is_reported_not_silently_free(db_env):
    """没有价格卡 ⇒ 成本按 0 记，但**必须点名**（不静默当免费）。"""
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(
            s,
            {
                "items": [
                    {
                        "event_id": "evt-nocard",
                        "provider_id": "minimax",
                        "action_type": "video",
                        "model": "H3-unknown",
                        "duration_seconds": 10,
                    }
                ]
            },
        )
    assert res["ingested"] == 1
    assert UNIT_PER_SECOND in res["missing_price"]

    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-nocard")
            )
        ).scalar_one()
        assert row.cost_micros == 0
        assert row.price_id == ""


@pytest.mark.asyncio
async def test_byok_event_is_not_billed_to_official_credit(db_env):
    """BYOK（用户自带 Key）⇒ 官方算力不担成本 ⇒ 记 0，但仍留档。"""
    await _seed_card(db_env)
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(
            s,
            {
                "items": [
                    {
                        "event_id": "evt-byok",
                        "provider_id": "minimax",
                        "action_type": "video",
                        "model": "H3",
                        "spec": "768p",
                        "duration_seconds": 10,
                        "byok": 1,
                    }
                ]
            },
        )
    assert res["ingested"] == 1
    assert res["missing_price"] == []  # BYOK 不查官方卡 ⇒ 不报缺价
    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-byok")
            )
        ).scalar_one()
        assert row.cost_micros == 0
        assert row.credit_cost == 0
        assert row.byok == 1


@pytest.mark.asyncio
async def test_negative_dimension_is_rejected(db_env):
    """负数维度 ⇒ 硬拒（否则会算出负成本）。"""
    with pytest.raises(ValueError):
        async with db_env() as s:
            await usage_event_service.ingest_usage_events(
                s,
                {
                    "items": [
                        {
                            "event_id": "evt-neg",
                            "provider_id": "minimax",
                            "duration_seconds": -5,
                        }
                    ]
                },
            )
