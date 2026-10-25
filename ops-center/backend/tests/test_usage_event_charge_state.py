"""事件级用量「扣分状态机」的契约测试。

为什么单独成文件：`test_usage_event_service.py` 测的是**事件入库与成本计算**；
本文件测的是**「这笔该不该扣、能不能扣」**⇒ 两者是不同的关注点，混在一起会让失败难定位。

⚠ **本文件里最重要的一条是安全锁**（`test_client_source_is_never_chargeable`）：
客户端上报的事件里 `user_id` 是**客户端自称**的（上报端点只认静态 `X-Catalog-Key`，
**没有任何用户身份**）⇒ 若拿它去扣分 ⇒ 恶意客户端上报**别人的 sub** ⇒ **扣别人的积分**。
⇒ 这一条必须**单独**被变异验证抓住（去掉来源判定 ⇒ 立刻红）。
"""
import os
import sys

import pytest
import pytest_asyncio
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models_credit import (  # noqa: E402
    CHARGE_SOURCE_CLIENT,
    CHARGE_SOURCE_SERVER,
    CHARGE_STATUS_FREE,
    CHARGE_STATUS_NOT_APPLICABLE,
    CHARGE_STATUS_PENDING,
    CHARGE_STATUS_SETTLED,
    CHARGE_STATUS_UNBILLABLE,
    ModelPriceCard,
    ModelUsageEvent,
)
import models_credit  # noqa: F401  (注册 ORM)

from services import usage_event_service  # noqa: E402
from services.credit_price_service import compute_period_bounds  # noqa: E402
from services.usage_event_service import resolve_charge_state  # noqa: E402


# ────────────────────────── ① 纯函数：状态判定 ──────────────────────────

def test_byok_is_not_applicable():
    """BYOK（用户自带 Key）⇒ 官方算力不担成本 ⇒ 不需要扣。"""
    status, err = resolve_charge_state(
        byok=True, has_missing_price=False, credit_cost=500,
        user_id="sub-1", source=CHARGE_SOURCE_SERVER,
    )
    assert status == CHARGE_STATUS_NOT_APPLICABLE
    assert err == ""


def test_missing_price_is_unbillable():
    """缺价 ⇒ 算不出成本 ⇒ 扣了也是乱扣 ⇒ 永久失败（待人工补卡）。"""
    status, err = resolve_charge_state(
        byok=False, has_missing_price=True, credit_cost=0,
        user_id="sub-1", source=CHARGE_SOURCE_SERVER,
    )
    assert status == CHARGE_STATUS_UNBILLABLE
    assert err == "MISSING_PRICE"


def test_missing_user_is_unbillable():
    """不知道扣谁 ⇒ 扣不了。"""
    status, err = resolve_charge_state(
        byok=False, has_missing_price=False, credit_cost=500,
        user_id="", source=CHARGE_SOURCE_SERVER,
    )
    assert status == CHARGE_STATUS_UNBILLABLE
    assert err == "MISSING_USER"


def test_zero_cost_is_free():
    """成本 0（上游免费）⇒ 无需扣。

    ⚠ 也不能去扣：engine 会拒 `costCents=0`（`CREDIT_AMOUNT_INVALID`，#4458）。
    """
    status, err = resolve_charge_state(
        byok=False, has_missing_price=False, credit_cost=0,
        user_id="sub-1", source=CHARGE_SOURCE_SERVER,
    )
    assert status == CHARGE_STATUS_FREE
    assert err == ""


def test_server_source_with_price_is_pending():
    """服务端来源 + 算得出成本 ⇒ 待扣。"""
    status, err = resolve_charge_state(
        byok=False, has_missing_price=False, credit_cost=500,
        user_id="sub-1", source=CHARGE_SOURCE_SERVER,
    )
    assert status == CHARGE_STATUS_PENDING
    assert err == ""


# ────────────────────── ② 安全锁：客户端来源**永不**可扣 ──────────────────────

def test_client_source_is_never_chargeable():
    """⚠⚠ **安全锁**：客户端上报的事件**永远不进扣分队列**。

    客户端自称的 `user_id` 不可信 ⇒ 拿它扣分 = 允许恶意客户端扣别人的积分。
    ⇒ 本条必须被变异验证抓住（去掉来源判定 ⇒ 立刻红）。
    """
    status, err = resolve_charge_state(
        byok=False, has_missing_price=False, credit_cost=500,
        user_id="别人的-sub", source=CHARGE_SOURCE_CLIENT,
    )
    assert status != CHARGE_STATUS_PENDING, "客户端来源的事件绝不能是 pending（会被拿去扣分）"
    assert status == CHARGE_STATUS_UNBILLABLE
    assert err == "UNTRUSTED_IDENTITY"


def test_client_source_cannot_bypass_by_claiming_server():
    """来源判定只看**入参** ⇒ 客户端无法通过自称绕过（写库那层另有来源标记约束）。"""
    status, _ = resolve_charge_state(
        byok=False, has_missing_price=False, credit_cost=500,
        user_id="sub-1", source="whatever-the-client-says",
    )
    assert status != CHARGE_STATUS_PENDING


# ────────────────────────── ③ 入库：状态真的写进行里 ──────────────────────────

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
        await conn.run_sync(models_credit.Base.metadata.create_all)
    yield session_factory
    await engine.dispose()


async def _seed_card(session_factory, **overrides):
    row = dict(
        id="h3-768p",
        provider_id="minimax",
        model_id="H3",
        action_type="video",
        unit="per_second",
        spec="768p",
        quality_tier="std",
        unit_price_micros=500_000,
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
async def test_client_event_is_stored_as_unbillable_with_reason(db_env):
    """客户端上报 ⇒ 落库为 ``unbillable`` + ``UNTRUSTED_IDENTITY``，且**不进待扣队列**。"""
    await _seed_card(db_env)
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(
            s,
            {
                "items": [
                    {
                        "event_id": "evt-client",
                        "provider_id": "minimax",
                        "action_type": "video",
                        "model": "H3",
                        "spec": "768p",
                        "duration_seconds": 10,
                        "user_id": "sub-1",
                    }
                ]
            },
        )
    assert res["ingested"] == 1
    assert res["charge_pending"] == 0, "客户端事件绝不能进待扣队列"
    assert res["charge_unbillable"] == 1

    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-client")
            )
        ).scalar_one()
        assert row.charge_status == CHARGE_STATUS_UNBILLABLE
        assert row.charge_error == "UNTRUSTED_IDENTITY"
        assert row.charge_source == CHARGE_SOURCE_CLIENT
        # 成本仍然算出来（用于按用户维度归集与对拍）
        assert row.cost_micros == 5_000_000
        assert row.credit_cost == 500
        assert row.pending_charge_at == ""


@pytest.mark.asyncio
async def test_period_bounds_are_stored_at_event_time(db_env):
    """发放周期在**事件发生时**算好并落库（补扣可能跨月 ⇒ 那时算会错位）。"""
    await _seed_card(db_env)
    async with db_env() as s:
        await usage_event_service.ingest_usage_events(
            s,
            {
                "items": [
                    {
                        "event_id": "evt-period",
                        "provider_id": "minimax",
                        "action_type": "video",
                        "model": "H3",
                        "spec": "768p",
                        "duration_seconds": 10,
                        "user_id": "sub-1",
                    }
                ]
            },
        )
    start, end = compute_period_bounds()
    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-period")
            )
        ).scalar_one()
        assert row.charge_period_start == start
        assert row.charge_period_end == end


@pytest.mark.asyncio
async def test_byok_event_is_not_applicable_and_not_pending(db_env):
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
                        "user_id": "sub-1",
                        "byok": 1,
                    }
                ]
            },
        )
    assert res["charge_pending"] == 0
    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-byok")
            )
        ).scalar_one()
        assert row.charge_status == CHARGE_STATUS_NOT_APPLICABLE
        assert row.cost_micros == 0


@pytest.mark.asyncio
async def test_missing_price_event_is_unbillable_with_missing_price_reason(db_env):
    """没有价格卡 ⇒ 成本算不出 ⇒ unbillable + MISSING_PRICE（不是「免费」）。"""
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(
            s,
            {
                "items": [
                    {
                        "event_id": "evt-nocard",
                        "provider_id": "minimax",
                        "action_type": "video",
                        "model": "H3-uncarded",
                        "spec": "768p",
                        "duration_seconds": 10,
                        "user_id": "sub-1",
                    }
                ]
            },
        )
    assert "per_second" in res["missing_price"]
    assert res["charge_pending"] == 0
    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-nocard")
            )
        ).scalar_one()
        assert row.charge_status == CHARGE_STATUS_UNBILLABLE
        assert row.charge_error == "MISSING_PRICE"


# ────────────────────────── ④ 迁移：补列幂等 ──────────────────────────

#: **期望补的列（字面值）** —— 刻意**不**从被测代码的清单读。
#: ⚠ 变异验证实测：若断言写成「被测清单里的列都在表里」⇒ 那是**自指断言**
#:   （清单少一列 ⇒ 断言也跟着少查一列 ⇒ 永远绿）⇒ **锁没有牙齿**。
#:   ⇒ 判据必须有一份**自己的**期望值。
EXPECTED_MIGRATED_COLUMNS = [
    "duration_seconds",
    "item_count",
    "char_count",
    "charge_status",
    "charge_source",
    "charge_period_start",
    "charge_period_end",
    "pending_charge_at",
    "retry_count",
    "charge_error",
    "charged_at",
]


@pytest.mark.asyncio
async def test_migration_adds_charge_columns_and_is_idempotent(db_env):
    """存量库补列：十一列都在、且**跑两次不报错**（幂等）。"""
    from services.credit_usage_event_migration import (
        ADDED_COLUMNS,
        ensure_model_usage_event_columns,
    )

    # 判据侧自己的一份期望值（不是被测代码的清单）
    assert [name for name, _ in ADDED_COLUMNS] == EXPECTED_MIGRATED_COLUMNS, (
        "补列清单与判据侧的期望值不一致 —— 改清单必须同步改判据（否则锁会变成自指断言）"
    )

    async with db_env() as s:
        await ensure_model_usage_event_columns(s)
        cols = {
            r[1]
            for r in (await s.execute(sa_text("PRAGMA table_info(model_usage_events)"))).fetchall()
        }
        for name in EXPECTED_MIGRATED_COLUMNS:
            assert name in cols, f"缺列 {name}"
        # 幂等：再跑两次不抛
        await ensure_model_usage_event_columns(s)
        await ensure_model_usage_event_columns(s)


def sa_text(sql):
    import sqlalchemy as sa

    return sa.text(sql)
