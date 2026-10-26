"""MiniMax 官方价格卡的口径锁 + 「缺维度即报错」守卫。

⚠️ **为什么必须单独成文件**：
   `test_credit_price_service.py` 测的是**纯函数口径**（单价语义 / 换算）；
   `test_usage_event_service.py` 测的是**生产路径**（维度映射 → 算成本 → 落库），
   但它**自造卡、自造事件**（`model="H3"` / `spec="768p"`）⇒ **内部自洽 ⇒ 测不出真实口径**。
   本文件锁的是**「卡与桌面端真实形态对得上」**这件仓内没人测的事：
   卡的 `provider_id` / `action_type` / `model_id` / `spec` **必须**与桌面端
   `model-provider-seeds.js` + `minimax-h3-v2.js` 的**实际取值**逐字一致
   ⇒ 否则卡建得再对也**永远命中不了**（或命中错的那张）。

本文件锁住五件事：
1. **口径锁**：每张 MiniMax 卡的 (provider_id, action_type, model_id) 在桌面端**真实存在**；
   且 `action_type` **等于**该 provider 的 `category`（事件里 `action_type = category`）。
2. **spec 形态锁**：桌面端 `params.resolution` 的取值是**大写 P**（`768P` / `2K`）⇒ 卡必须同形。
3. **单价口径锁**：`per_char` 的单价是**微元 / 字符**（不是微元 / 千字符）⇒ 差 1000 倍。
4. **精确命中**：事件带真实 spec ⇒ 命中**那一张**卡（768P ≠ 2K）。
5. **缺维度即报错**：事件**不带 spec** ⇒ **缺价告警**（不静默挑一张 ⇒ 那是拿别的规格的价冒充）。
"""
import json
import os
import re
import sys

import pytest
import pytest_asyncio
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Base  # noqa: E402
from models_credit import (  # noqa: E402
    UNIT_PER_CHAR,
    UNIT_PER_IMAGE,
    UNIT_PER_SECOND,
    ModelPriceCard,
    ModelUsageEvent,
)
import models_credit  # noqa: F401  (注册 ORM)

from services import usage_event_service  # noqa: E402
from services.credit_price_service import compute_cost_micros, token_counts_from_event  # noqa: E402

OPS_CENTER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(os.path.dirname(OPS_CENTER))
SEEDS_JS = os.path.join(
    REPO_ROOT, "apps", "desktop", "electron", "services", "model-provider-seeds.js"
)
H3_V2_JS = os.path.join(
    REPO_ROOT, "apps", "desktop", "electron", "services", "adapters", "minimax-h3-v2.js"
)
SEED_JSON = os.path.join(OPS_CENTER, "seed", "model_price_cards.seed.json")


# ────────────────────────── 桌面端真实形态（口径真源） ──────────────────────────

def _desktop_provider_catalog():
    """从 `model-provider-seeds.js` 抽出 ``{provider_id: {"category":…, "models":[…]}}``。

    ⚠️ **解析的是仓内真源**（不是自己抄一份）⇒ 桌面端改了 provider，锁会立刻红。
    ⚠️ 这是**内容级锁**：正则读的是**源码文本**，所以桌面端把 `id:` 改名也会被逮到。
    ⚠️ **必须按对象切块**（用 `id:` 到下一个 `id:` 之间）再在块内取字段
    —— 否则 `.*?` 跨对象匹配会把**下一个** provider 的 category/models 抓过来。
    """
    src = open(SEEDS_JS, encoding="utf-8").read()
    # 按 `id: 'xxx'` 切块：每块属于一个 provider
    starts = [(m.start(), m.group(1)) for m in re.finditer(r"id:\s*'([^']+)'", src)]
    catalog = {}
    for i, (pos, pid) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
        block = src[pos:end]
        cat_m = re.search(r"category:\s*'([^']+)'", block)
        if not cat_m:
            continue
        models_m = re.search(r"models:\s*\[([^\]]*)\]", block, re.S)
        models = re.findall(r"'([^']+)'", models_m.group(1)) if models_m else []
        catalog[pid] = {"category": cat_m.group(1), "models": models}
    return catalog


def _seed_cards():
    data = json.load(open(SEED_JSON, encoding="utf-8"))
    return [c for c in data["priced"] if c["provider_id"].startswith("minimax")]


# ────────────────────────── ① 口径锁 ──────────────────────────

def test_minimax_cards_exist_in_seed():
    """MiniMax 的 priced 卡必须存在（本文件的其余用例都以它们为基准）。"""
    cards = _seed_cards()
    assert cards, "seed.json 的 priced 段里没有 MiniMax 的卡"


def test_every_minimax_card_matches_a_real_desktop_provider():
    """每张卡的 (provider_id, action_type, model_id) 必须在**桌面端真实存在**。

    ⚠️ 这条是**最容易被忽略、且一旦错了就整条链静默失效**的形态：
    价格卡按 `(provider_id, action_type)` 定位，而事件的这两个字段
    分别来自桌面端的 `model_providers.id` 与 `model_providers.category`
    ⇒ **卡里写错任何一个 ⇒ 这张卡永远命中不到 ⇒ 官方算力恒「缺价」**。
    """
    catalog = _desktop_provider_catalog()
    assert catalog, "解析桌面端 provider 清单失败（seeds.js 结构变了？）"
    for card in _seed_cards():
        pid = card["provider_id"]
        assert pid in catalog, f"卡 {card['id']} 的 provider_id={pid!r} 在桌面端不存在"
        # 事件里 action_type = category ⇒ 卡里的 action_type 必须等于 category
        assert card["action_type"] == catalog[pid]["category"], (
            f"卡 {card['id']} 的 action_type={card['action_type']!r} ≠ "
            f"桌面端 provider {pid!r} 的 category={catalog[pid]['category']!r}"
        )
        # model_id 必须在该 provider 的 models 列表里
        assert card["model_id"] in catalog[pid]["models"], (
            f"卡 {card['id']} 的 model_id={card['model_id']!r} 不在桌面端 provider "
            f"{pid!r} 的 models={catalog[pid]['models']} 里"
        )


def test_video_spec_uses_desktop_resolution_form():
    """视频卡的 `spec` 必须与桌面端 `resolution` 的**实际取值形态**逐字相同。

    ⚠️ 桌面端 `minimax-h3-v2.js` 的缺省分辨率是 **`768P`（大写 P）** ⇒ 卡写 `768p` 就**永远匹配不上**
    （`_dim_ok` 的 spec 比较是**大小写敏感**的）。
    """
    src = open(H3_V2_JS, encoding="utf-8").read()
    m = re.search(r"DEFAULT_RESOLUTION\s*=\s*'([^']+)'", src)
    assert m, "读不到桌面端 DEFAULT_RESOLUTION（minimax-h3-v2.js 结构变了？）"
    desktop_form = m.group(1)
    assert desktop_form == "768P", f"桌面端缺省分辨率形态变了：{desktop_form!r}"
    video_cards = [c for c in _seed_cards() if c["action_type"] == "video"]
    assert video_cards, "没有 MiniMax 视频卡"
    for card in video_cards:
        assert card["spec"] in ("768P", "2K"), (
            f"卡 {card['id']} 的 spec={card['spec']!r} 不是桌面端的取值形态（大写 P）"
        )


# ────────────────────────── ② 单价口径锁（判据侧自带期望值） ──────────────────────────

def test_per_char_price_is_micros_per_character_not_per_thousand():
    """`per_char` 的单价必须是**微元 / 字符**。

    ⚠️ 官方 speech-2.8-turbo = ¥2.00 / **万字符** = 2,000,000 微元 / 10,000 字符
    = **200 微元 / 字符**。
    ⚠️ 若按「微元 / 千字符」理解 ⇒ 填 200 时单价变成 200,000 微元/字符 ⇒ **错 1000 倍**。
    ⇒ 判据侧**自带一份期望值**（200），不读被测卡 ⇒ 卡的单价被改时锁会红。
    """
    official_cny_per_10k_chars = 2.00
    expected_micros_per_char = int(round(official_cny_per_10k_chars * 1_000_000 / 10_000))
    assert expected_micros_per_char == 200
    tts_cards = [c for c in _seed_cards() if c["unit"] == UNIT_PER_CHAR]
    assert tts_cards, "没有 MiniMax 语音卡"
    for card in tts_cards:
        assert card["unit_price_micros"] == expected_micros_per_char, (
            f"卡 {card['id']} 的 per_char 单价 {card['unit_price_micros']} ≠ "
            f"{expected_micros_per_char} 微元/字符"
        )


def test_video_price_is_micros_per_second():
    """`per_second` 的单价是**微元 / 秒**：¥0.50/秒 ⇒ 500000；¥0.80/秒 ⇒ 800000。"""
    expected = {"768P": 500_000, "2K": 800_000}
    video_cards = [c for c in _seed_cards() if c["unit"] == UNIT_PER_SECOND]
    assert video_cards, "没有 MiniMax 视频卡"
    for card in video_cards:
        assert card["unit_price_micros"] == expected[card["spec"]], (
            f"卡 {card['id']} 的 per_second 单价与官方价不符"
        )


def test_image_price_is_micros_per_image():
    """`per_image` 的单价是**微元 / 张**：¥0.025/张 ⇒ 25000。"""
    image_cards = [c for c in _seed_cards() if c["unit"] == UNIT_PER_IMAGE]
    assert image_cards, "没有 MiniMax 图像卡"
    for card in image_cards:
        assert card["unit_price_micros"] == 25_000


# ────────────────────────── ③ 生产路径：真实形态事件能精确命中 ──────────────────────────

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


async def _seed_real_cards(session_factory):
    """把 **seed.json 里的真实卡**灌进库（不手抄 ⇒ 锁的是「真卡能否被真事件命中」）。"""
    async with session_factory() as s:
        for card in _seed_cards():
            s.add(ModelPriceCard(**card))
        await s.commit()


def _event(**over):
    row = dict(
        event_id="evt-1",
        provider_id="minimax",
        category="video",
        action_type="video",
        model="MiniMax-H3",
        spec="768P",
        action="generate_video",
        status="success",
        duration_seconds=10,
    )
    row.update(over)
    return row


@pytest.mark.asyncio
async def test_real_cards_are_hit_by_a_real_shaped_event(db_env):
    """真卡 + 真形态事件 ⇒ 精确命中**那一张**（768P），成本 = 10 秒 × 500000 微元。"""
    await _seed_real_cards(db_env)
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(s, {"items": [_event()]})
    assert res["ingested"] == 1
    assert res["missing_price"] == []
    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-1")
            )
        ).scalar_one()
        assert row.price_id == "minimax-h3-768p"
        assert row.cost_micros == 5_000_000  # 10 秒 × 500000 微元/秒
        # 1 积分 = 10000 微元 ⇒ 5000000/10000 = 500 积分
        assert row.credit_cost == 500


@pytest.mark.asyncio
async def test_2k_event_hits_the_2k_card_not_the_768p_one(db_env):
    """spec=2K ⇒ 命中 2K 那张（不是 768P）⇒ 成本 10 秒 × 800000 微元。"""
    await _seed_real_cards(db_env)
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(
            s, {"items": [_event(event_id="evt-2k", spec="2K")]}
        )
    assert res["missing_price"] == []
    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-2k")
            )
        ).scalar_one()
        assert row.price_id == "minimax-h3-2k"
        assert row.cost_micros == 8_000_000
        assert row.credit_cost == 800


@pytest.mark.asyncio
async def test_missing_spec_is_reported_as_missing_price_not_silently_picked(db_env):
    """事件**不带 spec** ⇒ 必须**缺价告警**，绝不静默挑一张（那是拿别的规格的价冒充）。

    ⚠️ 这是本刀最核心的一条：H3 的 768P 与 2K **共享
    (provider, model, action, unit) 四个维度，只差 spec** ⇒ 不带 spec 时
    挑错一张 ⇒ 成本偏差 60%（¥0.50 vs ¥0.80）⇒ 而缺价告警是**可见的**。
    """
    await _seed_real_cards(db_env)
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(
            s, {"items": [_event(event_id="evt-nospec", spec="")]}
        )
    assert res["ingested"] == 1
    # ⚠ 必须报缺价（而不是静默算出成本）
    assert res["missing_price"], "缺 spec 却没报缺价 ⇒ 静默挑了一张卡（错账）"
    assert UNIT_PER_SECOND in res["missing_price"]
    # ⚠ 且必须**点名**是「因 spec 歧义被排除」⇒ 运营才知道该补 spec 还是该建卡
    details = res.get("missing_detail") or []
    assert details, "缺价没有 missing_detail ⇒ 看不出真因"
    ambiguous = details[0].get("ambiguous_specs")
    assert ambiguous, "缺价没有点名 spec 歧义 ⇒ 看不出真因是「事件没带 spec」"
    assert any("768P" in a for a in ambiguous)
    assert any("2K" in a for a in ambiguous)
    async with db_env() as s:
        row = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-nospec")
            )
        ).scalar_one()
        # 缺价 ⇒ 成本记 0 **且**必须进「不可计费」状态（不假装免费、不假装已算清）
        assert row.cost_micros == 0
        assert row.charge_status == "unbillable"
        assert row.charge_error == "MISSING_PRICE"


@pytest.mark.asyncio
async def test_image_and_tts_events_are_costed_by_their_own_cards(db_env):
    """图像按张、语音按字符 ⇒ 命中各自的卡（不同 provider ⇒ 不同 action_type）。"""
    await _seed_real_cards(db_env)
    items = [
        _event(
            event_id="evt-img",
            provider_id="minimax-image",
            category="image",
            action_type="image",
            model="image-01",
            spec="",
            duration_seconds=0,
            item_count=1,
        ),
        _event(
            event_id="evt-tts",
            provider_id="minimax-tts",
            category="tts",
            action_type="tts",
            model="speech-2.8-turbo",
            spec="",
            duration_seconds=0,
            char_count=1000,
        ),
    ]
    async with db_env() as s:
        res = await usage_event_service.ingest_usage_events(s, {"items": items})
    assert res["missing_price"] == []
    async with db_env() as s:
        img = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-img")
            )
        ).scalar_one()
        tts = (
            await s.execute(
                select(ModelUsageEvent).where(ModelUsageEvent.event_id == "evt-tts")
            )
        ).scalar_one()
        # 1 张 × 25000 微元 ⇒ ceil(25000/10000) = 3 积分（不是 2.5）
        assert img.cost_micros == 25_000
        assert img.credit_cost == 3
        # 1000 字符 × 200 微元/字符 = 200000 微元 ⇒ 20 积分
        assert tts.cost_micros == 200_000
        assert tts.credit_cost == 20


# ────────────────────────── ④ 纯函数层：守卫本身 ──────────────────────────

@pytest.mark.asyncio
async def test_ambiguous_spec_cards_are_excluded_from_the_match_set(db_env):
    """守卫的**本体**行为：同 model 多档价 + 没传 spec ⇒ 那批卡一个都不进 `cards`。

    ⚠️ 判据必须看得见**生产调用点真正读的那份集合**（`load_effective_cards` 的返回值），
    而不是自己造一份样本 ⇒ 否则测的是「另一个函数」。
    """
    from services.credit_price_service import load_effective_cards

    await _seed_real_cards(db_env)
    async with db_env() as s:
        with_spec = await load_effective_cards(
            s, provider_id="minimax", model="MiniMax-H3", category="video", spec="768P"
        )
        no_spec = await load_effective_cards(
            s, provider_id="minimax", model="MiniMax-H3", category="video", spec=""
        )
    assert UNIT_PER_SECOND in with_spec
    assert with_spec[UNIT_PER_SECOND].unit_price_micros == 500_000
    # ⚠ 缺 spec ⇒ **没有可用的 per_second 卡**（⇒ 上层报缺价，而不是算错）
    assert UNIT_PER_SECOND not in no_spec
    # ⇒ 成本算不出 ⇒ 0 + 缺价
    result = compute_cost_micros(no_spec, token_counts_from_event(
        {"duration_seconds": 10, "action_type": "video"}
    ))
    assert result.has_missing_price
    assert result.cost_micros == 0


@pytest.mark.asyncio
async def test_generic_card_without_spec_is_not_blocked_by_the_guard(db_env):
    """⚠ **通用卡（spec 为空串）不受守卫影响** —— 它的语义就是「一价通吃」。

    ⚠️ 守卫若把通用卡也排掉 ⇒ 所有「一卡通吃」的 provider 都会假性缺价。
    """
    from services.credit_price_service import load_effective_cards

    async with db_env() as s:
        s.add(ModelPriceCard(
            id="generic-voice", provider_id="voice-x", model_id="", action_type="tts",
            unit=UNIT_PER_CHAR, spec="", quality_tier="std", unit_price_micros=200,
            currency="CNY", proc_discount=1.0, credit_multiplier=1.0,
            billed_by="billed_by_usage", source="vendor_doc",
            effective_from="2026-10-01T00:00:00", effective_to="",
        ))
        await s.commit()
    async with db_env() as s:
        cards = await load_effective_cards(
            s, provider_id="voice-x", model="", category="tts", spec=""
        )
    assert UNIT_PER_CHAR in cards
    assert cards[UNIT_PER_CHAR].unit_price_micros == 200
