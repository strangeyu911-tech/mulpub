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

from models_credit import ModelUsageEvent
from services.credit_price_service import (
    compute_cost_micros,
    compute_credit_cost,
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

    for row in validated:
        # BYOK：用户自带 Key ⇒ 官方算力不担成本 ⇒ 记 0（但仍留档，供对拍）
        if row.get("byok"):
            row["price_id"] = ""
            row["cost_micros"] = 0
            row["credit_cost"] = 0
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
    }
