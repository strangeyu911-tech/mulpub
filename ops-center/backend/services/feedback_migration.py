"""幂等迁移：为存量 user_feedback 表补充分诊列。

为什么需要：SQLAlchemy 的 `create_all` **不会**给已存在的表加列——线上库
（SQLite）在本次改动前就建好了 user_feedback，只有新建库才会带上 category/source。
不补这一步，老部署上写入会报 `no such column: user_feedback.category`。

沿用本仓既有模式（model_preset_service / prompt_eval_migration 同型）：
先读 PRAGMA table_info，缺哪列补哪列，重复执行安全。
"""
from __future__ import annotations

import logging

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_COLUMNS = (
    ("category", "VARCHAR(32) DEFAULT ''"),
    ("source", "VARCHAR(32) DEFAULT ''"),
)


async def ensure_feedback_columns(db: AsyncSession) -> None:
    rows = (await db.execute(sa.text("PRAGMA table_info(user_feedback)"))).all()
    if not rows:
        # 表还不存在（init_db 尚未 create_all）⇒ 交给建表路径，不在这里 ALTER
        return
    existing = {row[1] for row in rows}
    added = []
    for name, ddl in _COLUMNS:
        if name in existing:
            continue
        await db.execute(sa.text(f"ALTER TABLE user_feedback ADD COLUMN {name} {ddl}"))
        added.append(name)
    if added:
        await db.commit()
        logger.info("user_feedback 补充列: %s", ", ".join(added))
