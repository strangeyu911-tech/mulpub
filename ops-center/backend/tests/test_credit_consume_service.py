"""Tests for ops-center 官方算力扣分转发（engine /api/v1/credit/consume）。

覆盖：
  · 单位换算（微元 → 分，**向上取整**）的边界；
  · 端点未配置 / 空 refId / 成功 / engine 拒收 / 网络不可达 的处置；
  · ⛔ 请求体形状（`refType` 常量、`costCents` 已是分、Bearer 是 M2M token）。
"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_cc_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_cc_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"

from config import settings  # noqa: E402
from services import credit_consume_service  # noqa: E402
from services.credit_consume_service import (  # noqa: E402
    CREDIT_REF_TYPE,
    CreditConsumeError,
    consume_credit,
    micros_to_cents,
)


@pytest_asyncio.fixture(autouse=True)
async def reset_engine_config():
    settings.engine_admin_base_url = ""
    settings.engine_admin_token = ""
    yield
    settings.engine_admin_base_url = ""
    settings.engine_admin_token = ""


class _FakeResp:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class _FakeClient:
    """记录请求形状的假 httpx 客户端。"""

    def __init__(self, response=None, raises=None):
        self._response = response
        self._raises = raises
        self.calls = []
        self.closed = False

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self._raises is not None:
            raise self._raises
        return self._response

    async def aclose(self):
        self.closed = True


# ── 单位换算 ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "cost_micros,expected",
    [
        (0, 0),
        (1, 1),        # 0.0001 分 ⇒ 向上取整成 1（记 0 等于「静默免费」）
        (9999, 1),
        (10000, 1),     # 恰好 1 分
        (10001, 2),
        (25000, 3),     # 2.5 分 ⇒ 3
        (123456, 13),
    ],
)
def test_micros_to_cents_向上取整(cost_micros, expected):
    assert micros_to_cents(cost_micros) == expected


@pytest.mark.parametrize("bad", [-1, 1.5, "100", None, True])
def test_micros_to_cents_非法输入(bad):
    with pytest.raises(ValueError):
        micros_to_cents(bad)


# ── 端点未配置 / refId 空 ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_未配置_engine_凭据_503():
    with pytest.raises(CreditConsumeError) as exc:
        await consume_credit(
            auth_subject="user-sub", amount=1, cost_micros=10000, ref_id="evt-1",
            period_start="2026-10-01T00:00:00.000Z", period_end="2026-11-01T00:00:00.000Z",
        )
    assert exc.value.status == 503
    assert exc.value.code == "ENGINE_ADMIN_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_空_refId_入口就拒_不发出请求(monkeypatch):
    settings.engine_admin_base_url = "http://engine.test"
    settings.engine_admin_token = "m2m-token"
    fake = _FakeClient(_FakeResp(200, {"ok": True}))
    monkeypatch.setattr(credit_consume_service, "_new_client", lambda: fake)
    with pytest.raises(CreditConsumeError) as exc:
        await consume_credit(
            auth_subject="user-sub", amount=1, cost_micros=10000, ref_id="",
            period_start="2026-10-01T00:00:00.000Z", period_end="2026-11-01T00:00:00.000Z",
        )
    assert exc.value.status == 400
    assert exc.value.code == "CREDIT_REF_INVALID"
    assert fake.calls == [], "空 refId 不得发出请求（否则会与任何空 refId 的扣分共用查重键）"


# ── 成功路径 ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_成功_请求体形状与单位换算(monkeypatch):
    settings.engine_admin_base_url = "http://engine.test/"
    settings.engine_admin_token = "m2m-token"
    fake = _FakeClient(_FakeResp(200, {"account": {"balance": 88}, "entry": {"id": 1}, "duplicated": False}))
    monkeypatch.setattr(credit_consume_service, "_new_client", lambda: fake)

    result = await consume_credit(
        auth_subject="user-sub", amount=12, cost_micros=25000, ref_id="evt-1",
        period_start="2026-10-01T00:00:00.000Z", period_end="2026-11-01T00:00:00.000Z",
        price_id="price-1", reason="官方算力消耗",
    )
    assert result == {"account": {"balance": 88}, "entry": {"id": 1}, "duplicated": False}
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["url"] == "http://engine.test/api/v1/credit/consume"
    assert call["headers"] == {"Authorization": "Bearer m2m-token"}
    body = call["json"]
    assert body["authSubject"] == "user-sub"
    assert body["amount"] == 12
    # ⛔ 单位换算在客户端收口：微元 25000 ⇒ 3 分（ceil），不是 2
    assert body["costCents"] == 3
    assert body["costCents"] == micros_to_cents(25000)
    # ⛔ refType 是常量，调用方无从覆盖
    assert body["refType"] == CREDIT_REF_TYPE == "usage_event"
    assert body["refId"] == "evt-1"
    assert body["periodStart"] == "2026-10-01T00:00:00.000Z"
    assert body["periodEnd"] == "2026-11-01T00:00:00.000Z"
    assert fake.closed is True, "客户端必须关闭"


# ── 失败路径 ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_engine_拒收_透传状态与错误码(monkeypatch):
    settings.engine_admin_base_url = "http://engine.test"
    settings.engine_admin_token = "m2m-token"
    fake = _FakeClient(_FakeResp(409, {"error": "CREDIT_BALANCE_EXHAUSTED"}))
    monkeypatch.setattr(credit_consume_service, "_new_client", lambda: fake)
    with pytest.raises(CreditConsumeError) as exc:
        await consume_credit(
            auth_subject="user-sub", amount=12, cost_micros=25000, ref_id="evt-1",
            period_start="2026-10-01T00:00:00.000Z", period_end="2026-11-01T00:00:00.000Z",
        )
    assert exc.value.status == 409
    assert exc.value.code == "CREDIT_BALANCE_EXHAUSTED"


@pytest.mark.asyncio
async def test_engine_返回非_JSON_退化为通用错误码(monkeypatch):
    settings.engine_admin_base_url = "http://engine.test"
    settings.engine_admin_token = "m2m-token"
    fake = _FakeClient(_FakeResp(500, None))
    monkeypatch.setattr(credit_consume_service, "_new_client", lambda: fake)
    with pytest.raises(CreditConsumeError) as exc:
        await consume_credit(
            auth_subject="user-sub", amount=12, cost_micros=25000, ref_id="evt-1",
            period_start="2026-10-01T00:00:00.000Z", period_end="2026-11-01T00:00:00.000Z",
        )
    assert exc.value.status == 500
    assert exc.value.code == "ENGINE_ADMIN_ERROR"


@pytest.mark.asyncio
async def test_网络不可达_502(monkeypatch):
    import httpx

    settings.engine_admin_base_url = "http://engine.test"
    settings.engine_admin_token = "m2m-token"
    fake = _FakeClient(raises=httpx.ConnectError("boom"))
    monkeypatch.setattr(credit_consume_service, "_new_client", lambda: fake)
    with pytest.raises(CreditConsumeError) as exc:
        await consume_credit(
            auth_subject="user-sub", amount=12, cost_micros=25000, ref_id="evt-1",
            period_start="2026-10-01T00:00:00.000Z", period_end="2026-11-01T00:00:00.000Z",
        )
    assert exc.value.status == 502
    assert exc.value.code == "ENGINE_ADMIN_UNREACHABLE"
    assert fake.closed is True, "异常路径也必须关闭客户端"
