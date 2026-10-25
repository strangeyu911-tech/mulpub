"""model_usage_events 事件表补列迁移（存量库幂等）。

背景：SQLite 的 `create_all` **只建新表、不会给既有表补新列**
（与 `services/prompt_eval_migration.py` / `model_preset_service.ensure_model_preset_columns`
同一条纪律）。本次新增 `duration_seconds` / `item_count` / `char_count` 三列
⇒ 存量库上若不补列，`model_usage_events` 的写入会报
`no such column: duration_seconds` ⇒ 官方算力的**事件级成本归集全线失败**。

⚠ **只加列、不重建表**：重建表要搬运营可能已有的用量数据 ⇒ 不可逆 ⇒ 不做。
⚠ 幂等：列已存在就跳过 ⇒ 每次启动都跑是安全的。
"""
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

# (列名, DDL 片段) —— DDL 片段必须与 models_credit.ModelUsageEvent 的列定义**同口径**
# （INTEGER + NOT NULL DEFAULT 0）⇒ 补列后的存量行读出来是 0 而不是 NULL
ADDED_COLUMNS = [
    ("duration_seconds", "INTEGER NOT NULL DEFAULT 0"),
    ("item_count", "INTEGER NOT NULL DEFAULT 0"),
    ("char_count", "INTEGER NOT NULL DEFAULT 0"),
]


async def ensure_model_usage_event_columns(db: AsyncSession) -> None:
    """幂等补列：`model_usage_events` 的三个非 token 维度列。"""
    tables = {
        r[0]
        for r in (
            await db.execute(
                sa.text("SELECT name FROM sqlite_master WHERE type='table'")
            )
        ).fetchall()
    }
    if "model_usage_events" not in tables:
        # 表还不存在 ⇒ `create_all` 会按最新模型建出来 ⇒ 不需要补列
        return
    cols = {
        r[1]
        for r in (
            await db.execute(sa.text("PRAGMA table_info(model_usage_events)"))
        ).fetchall()
    }
    changed = False
    for name, ddl in ADDED_COLUMNS:
        if name in cols:
            continue
        await db.execute(sa.text(f"ALTER TABLE model_usage_events ADD COLUMN {name} {ddl}"))
        changed = True
    if changed:
        await db.commit()
