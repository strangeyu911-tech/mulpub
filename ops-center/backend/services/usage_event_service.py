"""事件级用量上报（官方算力成本归集的地基）。

为什么要有这一层（与日桶 `usage_service` 的分工）：
- 日桶 `model_usage_daily` 回答「这个客户端这天调了多少次」⇒ **看板用**，成本是客户端透传的估算值。
- 事件级 `model_usage_events` 回答「**这一次调用**花了多少钱」⇒ **扣积分用**，成本由服务端按价格卡算。
  （`models_credit.ModelUsageEvent` 的类注释早就写明了这个分工。）

⚠ **本模块存在的理由**：此前 `model_usage_events` **零写入方** ⇒ 扣分端点拿不到权威事实。

三条不可让步的口径：
1. **幂等**：`event_id` 是唯一约束（`uq_model_usage_event_id`）⇒ 重试重报不重复计数。
   `event_id` 空值 **硬拒**（否则幂等键失效 ⇒ 重复上报会重复计数）。
2. **成本由服务端算**：`price_id` / `cost_micros` / `credit_cost` 一律由价格卡算出，
   客户端只报**用量维度**（duration/item_count/char_count/tokens），**不报成本**。
   ⇒ 客户端报的成本只作为 `client_reported_cost_micros` 留档对拍，不参与计算。
3. **缺价不静默当免费**：命中不到价格卡 ⇒ `cost_micros=0` 但**必须被点名**
   （响应里的 `missing_units` + 服务端日志）⇒ 否则「成本恒 0」看起来像「免费」。
"""
import datetime
import json
import logging
from typing import Dict, List, Optional

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models_credit import (
    CHARGE_SOURCE_CLIENT,
    CHARGE_SOURCE_SERVER,
    CHARGE_STATUS_FREE,
    CHARGE_STATUS_NOT_APPLICABLE,
    CHARGE_STATUS_PENDING,
    CHARGE_STATUS_SETTLED,
    CHARGE_STATUS_UNBILLABLE,
    ModelUsageEvent,
)
from services.credit_price_service import (
    compute_cost_micros,
    compute_credit_cost,
    compute_period_bounds,
    get_credit_unit_price_micros,
    load_effective_cards,
    summarize_missing_price,
    token_counts_from_event,
)

log = logging.getLogger("ops-center.usage-event")

MAX_EVENT_ITEMS = 500
MAX_EVENT_ID_LEN = 128
_MAX_STR_LEN = 200

# 上报字段 → ModelUsageEvent 列（字符串列统一截断，避免超长入库存爆）
_STR_FIELDS = {
    # ⚠ `user_id` 必须收：**事件表有这一列**，而桌面端上报的 user_id（Logto sub）
    #   是按用户维度归集成本的前提 ⇒ 漏收 ⇒ 事件行的 user_id 恒为空
    #   ⇒ 既看不到「谁用掉的算力」，也永远判不出「可扣」。
    "user_id": 128,
    "client_id": 64,
    "provider_id": 100,
    "category": 32,
    "action_type": 32,
    "model": 120,
    "spec": 64,
    "quality_tier": 32,
    "action": 64,
    "status": 32,
}

# 非负整数字段
_INT_FIELDS = (
    "latency_ms",
    "tokens_in",
    "tokens_out",
    "tokens_cache_read",
    "tokens_cache_write",
    "tokens_reasoning",
    "duration_seconds",
    "item_count",
    "char_count",
)


def _now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


def _nonneg_int(raw, field: str) -> int:
    if raw is None or str(raw).strip() == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError(f"{field} 必须是整数")
    if isinstance(raw, float) and not raw.is_integer():
        raise ValueError(f"{field} 必须是整数")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{field} 必须是整数")
    if n < 0:
        raise ValueError(f"{field} 不能为负数")
    return n


def _validate_event(item: dict) -> dict:
    """校验并归一化单条事件。"""
    if not isinstance(item, dict):
        raise ValueError("事件项必须是对象")
    event_id = str(item.get("event_id") or "").strip()
    if not event_id:
        # ⛔ 空 `event_id` 硬拒：它是幂等键，空值会让重报重复计数。
        raise ValueError("event_id 不能为空")
    if len(event_id) > MAX_EVENT_ID_LEN:
        raise ValueError("event_id 过长")

    provider_id = str(item.get("provider_id") or "").strip()
    if not provider_id:
        raise ValueError("provider_id 不能为空")

    category = str(item.get("category") or item.get("action_type") or "llm").strip()[:32]
    action_type = str(item.get("action_type") or category).strip()[:32]

    usage_date = str(item.get("usage_date") or "").strip()
    if usage_date:
        try:
            datetime.date.fromisoformat(usage_date)
        except ValueError:
            raise ValueError("usage_date 必须是合法的 YYYY-MM-DD 日期")
    else:
        usage_date = datetime.datetime.utcnow().date().isoformat()

    out: Dict[str, object] = {
        "event_id": event_id,
        "usage_date": usage_date,
        "provider_id": provider_id[:100],
        "category": category,
        "action_type": action_type,
        "status": str(item.get("status") or "success").strip()[:32],
        "byok": 1 if item.get("byok") else 0,
        "created_at": _now_iso(),
    }
    for field, limit in _STR_FIELDS.items():
        out[field] = str(item.get(field) or "").strip()[:limit]
    for field in _INT_FIELDS:
        out[field] = _nonneg_int(item.get(field), field)

    client_cost = item.get("client_reported_cost_micros")
    if client_cost is not None and str(client_cost).strip() != "":
        out["client_reported_cost_micros"] = _nonneg_int(
            client_cost, "client_reported_cost_micros"
        )
    return out


def resolve_charge_state(
    *,
    byok: bool,
    has_missing_price: bool,
    credit_cost: int,
    user_id: str,
    source: str,
) -> tuple:
    """判定一条事件的**扣分状态**（纯函数，**无 IO**）。

    :returns: ``(charge_status, charge_error)``

    ⚠ **判定顺序有讲究**（每一步都排除了前面更根本的原因）：
      ① BYOK            → ``not_applicable``：用户自带 Key，官方算力不担成本
      ② 缺价            → ``unbillable`` + ``MISSING_PRICE``：算不出成本，扣了也是乱扣
      ③ 无用户          → ``unbillable`` + ``MISSING_USER``：不知道扣谁
      ④ 成本为 0        → ``free``：上游免费，无需扣（engine 也会拒 ``costCents=0``）
      ⑤ 来源不可信      → ``unbillable`` + ``UNTRUSTED_IDENTITY``：**安全红线**（见下）
      ⑥ 其余            → ``pending``：待扣分执行体来扣

    ⚠⚠ **第 ⑤ 步是安全红线，不是业务规则**：
      客户端上报的事件里 ``user_id`` 是**客户端自称**的
      （上报端点只认静态 ``X-Catalog-Key``，**没有任何用户身份**）⇒ **不可信**。
      若拿它去扣分 ⇒ 恶意客户端上报**别人的 sub** ⇒ **扣别人的积分**。
      ⇒ **只有 ``source == 'server'``（ops-center 自己写、身份已认证）的事件才允许进扣分队列。**

    ⚠ **本函数是状态的唯一真源**：客户端入口与将来的代理入口**共用**它
    ⇒ 判定逻辑只有一份 ⇒ 不会出现「两处实现漂移」。
    """
    if byok:
        return CHARGE_STATUS_NOT_APPLICABLE, ""
    if has_missing_price:
        return CHARGE_STATUS_UNBILLABLE, "MISSING_PRICE"
    if not str(user_id or "").strip():
        return CHARGE_STATUS_UNBILLABLE, "MISSING_USER"
    if int(credit_cost or 0) <= 0:
        return CHARGE_STATUS_FREE, ""
    if source != CHARGE_SOURCE_SERVER:
        return CHARGE_STATUS_UNBILLABLE, "UNTRUSTED_IDENTITY"
    return CHARGE_STATUS_PENDING, ""


async def ingest_usage_events(db: AsyncSession, body: dict) -> dict:
    """事件级用量入库 + 服务端按价格卡算成本。

    :param body: ``{"batch_id": "...", "items": [ ... ]}``
    :return: ``{"ingested": N, "duplicate": M, "missing_price": [...]}``
    """
    items = body.get("items", []) if isinstance(body, dict) else []
    if not isinstance(items, list):
        raise ValueError("items 必须是数组")
    if len(items) > MAX_EVENT_ITEMS:
        raise ValueError(f"单次上报不能超过 {MAX_EVENT_ITEMS} 条")
    validated = [_validate_event(i) for i in items]
    if not validated:
        return {"ingested": 0, "duplicate": 0, "missing_price": []}

    unit_price = await get_credit_unit_price_micros(db)
    ingested = 0
    duplicate = 0
    missing_price: List[str] = []
    missing_detail: List[Dict[str, object]] = []

    # 发放周期在**事件发生时**算好并落库（自然月 / UTC）。
    # ⚠ 为什么不留到扣分时再算：补扣可能跨月 ⇒ 那时算出来的周期会与「额度所属周期」错位
    #   （DESIGN §13.2 B-2 记录的跨周期补扣问题）⇒ 周期必须**随事件一起定下来**。
    period_start, period_end = compute_period_bounds()

    for row in validated:
        row["charge_period_start"] = period_start
        row["charge_period_end"] = period_end
        # ⚠ **本入口是客户端上报** ⇒ 事件里的 user_id 是**客户端自称**的
        #   （上报端点只认静态 X-Catalog-Key，**无任何用户身份**）⇒ **不可信**。
        #   ⇒ 这批事件**永远不进扣分队列**（fail-closed），只用于成本归集与对拍。
        #   真正可扣的事件由 ops-center 自己写（代理上游、身份已认证）⇒ charge_source='server'。
        row["charge_source"] = CHARGE_SOURCE_CLIENT
        # BYOK：用户自带 Key ⇒ 官方算力不担成本 ⇒ 记 0（但仍留档，供对拍）
        if row.get("byok"):
            row["price_id"] = ""
            row["cost_micros"] = 0
            row["credit_cost"] = 0
            row["charge_status"] = CHARGE_STATUS_NOT_APPLICABLE
            row["charge_error"] = ""
        else:
            cards = await load_effective_cards(
                db,
                provider_id=str(row["provider_id"]),
                model=str(row["model"]),
                category=str(row["action_type"] or row["category"]),
                spec=str(row["spec"]),
                quality_tier=str(row["quality_tier"]),
            )
            counts = token_counts_from_event(row)
            result = compute_cost_micros(cards, counts)
            row["price_id"] = result.price_id
            row["cost_micros"] = result.cost_micros
            row["credit_cost"] = compute_credit_cost(
                result.cost_micros, unit_price, result.multiplier
            )
            if result.has_missing_price:
                # ⚠ 缺价必须**被点名**：静默算 0 看起来像「免费」。
                missing_price.extend(result.missing_units)
                missing_detail.append(
                    {
                        "event_id": row["event_id"],
                        "provider_id": row["provider_id"],
                        "model": row["model"],
                        "missing_units": list(result.missing_units),
                    }
                )
            # ── 扣分状态（唯一真源：resolve_charge_state）──
            row["charge_status"], row["charge_error"] = resolve_charge_state(
                byok=bool(row.get("byok")),
                has_missing_price=result.has_missing_price,
                credit_cost=int(row.get("credit_cost") or 0),
                user_id=str(row.get("user_id") or ""),
                source=str(row.get("charge_source") or CHARGE_SOURCE_CLIENT),
            )
            if row["charge_status"] == CHARGE_STATUS_PENDING:
                row["pending_charge_at"] = _now_iso()

        try:
            # ⚠ 不用 `async with db.begin()`：前面的 `load_effective_cards` 是 SELECT，
            #   已 autobegin 一个事务 ⇒ 再 `begin()` 会报
            #   「A transaction is already begun on this Session」。
            #   这里走 add + commit（同一事务里批量落库，语义等价）。
            db.add(ModelUsageEvent(**row))
            await db.commit()
            ingested += 1
        except IntegrityError:
            # `event_id` 唯一约束命中 ⇒ 之前已入库（重试重报）⇒ 幂等跳过
            await db.rollback()
            duplicate += 1
            continue

    if missing_detail:
        log.warning(
            "usage-events: %d 条事件缺价格卡（成本按 0 记账，需人工补卡）：%s",
            len(missing_detail),
            json.dumps(missing_detail[:20], ensure_ascii=False),
        )

    return {
        "ingested": ingested,
        "duplicate": duplicate,
        "missing_price": sorted(set(missing_price)),
        # 待扣条数（可观测：事件落库后有多少笔等着补扣执行体去扣）
        "charge_pending": sum(
            1 for r in validated if r.get("charge_status") == CHARGE_STATUS_PENDING
        ),
        # 不可计费条数（可观测：算不出成本 / 身份不可信 ⇒ 不会去扣）
        "charge_unbillable": sum(
            1 for r in validated if r.get("charge_status") == CHARGE_STATUS_UNBILLABLE
        ),
    }
