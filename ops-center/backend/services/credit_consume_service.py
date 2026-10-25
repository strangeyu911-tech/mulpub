"""Credit consume service — 官方算力扣分转发 engine 扣分端点。

engine 侧 ``POST /api/v1/credit/consume`` 只认带 ``admin:users`` scope 的 logto 身份
（静态主密钥被显式拒绝，防花钱端点被 key 滥用），故 ops 后端必须经 M2M token 转发；
本服务不自持计费逻辑，只做「转发 + 单位换算 + 错误码透传」。

与 ``member_grant_service.py`` 同一模式（同一套 M2M 凭据、同一个 engine 基址）⇒
不新增部署配置面、不新增授权面。

单位纪律（本文件是**跨库单位换算的唯一真源**）：
    供给侧（ops-center / SQLite）：``cost_micros`` —— **微元**
    账本侧（engine / Postgres）：``identity_credit_ledger.cost_cents`` —— **分**
换算 = ``ceil(cost_micros / 10000)``，**向上取整**。

⛔ 为什么必须向上取整：账本成本列是**审计与对账依据** ⇒ 记 0 等于「静默免费」、
记低等于系统性偏低 ⇒ **宁可略高，不可记 0**（定案 §3.3.1）。

⛔ 为什么换算收在这里（而不是让每个调用方自己写）：两个库的单位不同，而**公式本身不会算错**
（微元 ÷ 微元/积分 = 积分，比值对）⇒ 缺陷不会在测试里暴露；只有**命名**会骗人 ⇒
实现者会自作主张再做一次换算 ⇒ 金额差 10000 倍，且两处都是正整数、都会入库 ⇒ **不报错、静默错账**。
⇒ 把换算收进单一函数，调用方**无法**绕过。

⛔ 另外：``costCents`` **只给账本留审计痕迹**，**绝不能用它反算 ``amount``**
（反算会在单位混用时放大 10000 倍）⇒ ``amount`` 一律由
``credit_price_service.compute_credit_cost`` 算好传入，本服务不重算、不校验、不推导。
"""
from __future__ import annotations

import httpx

from config import settings

#: 1 分 = 10000 微元（微元是本仓的**口径真源**，见 01-docs/usage-metering-spec.md §3）。
CREDIT_UNIT_MICROS = 10000

#: 幂等键的 ref_type：**常量**，不可配、不可省。
#: DB 唯一索引 ``uq_identity_credit_ledger_spend`` 是**部分索引**，只覆盖它
#: ⇒ 传别的值 ⇒ 并发重复扣分不再被 DB 拦（定案 §3.3）。
CREDIT_REF_TYPE = "usage_event"


def micros_to_cents(cost_micros: int) -> int:
    """微元 → 分（**向上取整**）。

    ⚠ 只做单位换算，**不做**任何金额推导；``amount`` 由调用方用
    ``credit_price_service.compute_credit_cost`` 算好传入。
    """
    if isinstance(cost_micros, bool) or not isinstance(cost_micros, int):
        raise ValueError("cost_micros must be a non-negative integer")
    if cost_micros < 0:
        raise ValueError("cost_micros must be a non-negative integer")
    # -(-x // d) 是整数向上取整（x >= 0 时等价于 math.ceil(x / d)）
    return -(-cost_micros // CREDIT_UNIT_MICROS)


def _new_client():
    return httpx.AsyncClient(timeout=15)


class CreditConsumeError(Exception):
    """status 为透传给前端的 HTTP 状态码，code 为机器可读错误码。"""

    def __init__(self, status: int, code: str, detail: str = ""):
        super().__init__(code)
        self.status = status
        self.code = code
        self.detail = detail


async def consume_credit(
    *,
    auth_subject: str,
    amount: int,
    cost_micros: int,
    ref_id: str,
    period_start: str,
    period_end: str,
    price_id: str = "",
    reason: str = "",
) -> dict:
    """转发一次官方算力扣分。

    :param auth_subject: 目标用户的 Logto ``sub``（**不是** ``identity_users.id``）——
        engine 侧端点内解析（定案 §3.3）；ops 不查 Postgres（守 §3.1）。
    :param amount: 扣减积分（**正整数**；由 ``compute_credit_cost`` 算好，本服务不推导）。
    :param cost_micros: 上游真实成本（**微元**）⇒ 本服务换算成 ``costCents``（分）。
    :param ref_id: 幂等键（= ``model_usage_events.id``，**必须全局唯一**且非空）。
    :param period_start: 发放周期起（ISO8601）。
    :param period_end: 发放周期止（ISO8601，> ``period_start``）。
    :raises CreditConsumeError: engine 侧拒收或不可达。
    """
    base = (settings.engine_admin_base_url or "").strip().rstrip("/")
    token = (settings.engine_admin_token or "").strip()
    if not base or not token:
        raise CreditConsumeError(503, "ENGINE_ADMIN_NOT_CONFIGURED")
    if not ref_id or not str(ref_id).strip():
        # 空 refId 会与**任何**一次空 refId 的扣分共用查重键 ⇒ 静默免费算力 ⇒ 入口就拒
        raise CreditConsumeError(400, "CREDIT_REF_INVALID")
    payload = {
        "authSubject": auth_subject,
        "amount": amount,
        "costCents": micros_to_cents(cost_micros),
        "priceId": price_id,
        "reason": reason,
        "refType": CREDIT_REF_TYPE,
        "refId": str(ref_id).strip(),
        "periodStart": period_start,
        "periodEnd": period_end,
    }
    client = _new_client()
    try:
        resp = await client.post(
            f"{base}/api/v1/credit/consume",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.HTTPError as e:
        raise CreditConsumeError(502, "ENGINE_ADMIN_UNREACHABLE", str(e))
    finally:
        await client.aclose()
    if resp.status_code >= 400:
        try:
            code = str(resp.json().get("error") or "ENGINE_ADMIN_ERROR")
        except Exception:
            code = "ENGINE_ADMIN_ERROR"
        raise CreditConsumeError(resp.status_code, code)
    return resp.json()
