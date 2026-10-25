"""Model usage API — 桌面端用量上报 + 运营看板汇总。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import require_admin, require_catalog_key
from services import usage_event_service, usage_service

router = APIRouter(tags=["usage"])


@router.post("/api/v1/usage/ingest")
async def ingest_usage(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(require_catalog_key),
):
    """桌面端脱敏聚合用量上报（X-Catalog-Key 鉴权，无需登录）。

    2026-10-15：鉴权由函数体内的私有守卫改为依赖声明 `Depends(require_catalog_key)`。
    注意**仅接受静态 key**（非 Bearer 双通道）—— 桌面端 `usage-reporter.js` 发的就是
    `X-Catalog-Key`；PRD 里此前写的「Bearer(Logto JWT) 优先」与本实现不符，已随本 PR 修正。
    """
    try:
        return await usage_service.ingest_usage(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/api/v1/usage/events")
async def ingest_usage_events(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(require_catalog_key),
):
    """**事件级**用量上报（官方算力成本归集的地基）。

    与上面的 `/usage/ingest`（日桶、看板用）的分工：
    - `/usage/ingest` → `model_usage_daily`：一天一个桶，成本是客户端透传的估算值；
    - `/usage/events` → `model_usage_events`：**一次调用一条**，成本由**服务端按价格卡算**。

    ⚠ 客户端只报**用量维度**（tokens / duration_seconds / item_count / char_count），
      **不报成本** —— 成本一律由服务端算（`price_id` / `cost_micros` / `credit_cost`）。
    ⚠ 幂等键 = `event_id`（唯一约束）⇒ 重试重报不重复计数；`event_id` 空值 ⇒ **400 硬拒**。
    ⚠ 缺价格卡 ⇒ 成本按 0 记，但**在响应的 `missing_price` 里点名**（不静默当免费）。
    """
    try:
        return await usage_event_service.ingest_usage_events(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/v1/usage/summary")
async def get_usage_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await usage_service.usage_summary(db, days=days)
