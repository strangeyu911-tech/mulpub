"""model_usage_events 事件表补列迁移（存量库幂等）。

背景：SQLite 的 `create_all` **只建新表、不会给既有表补新列**
（与 `services/prompt_eval_migration.py` / `model_preset_service.ensure_model_preset_columns`
同一条纪律）。本次给事件表加了两批列：
  ① 非 token 维度列（2026-10-25 R5-1）：duration_seconds / item_count / char_count
  ② 扣分状态机列（2026-10-25 R5-2）：charge_status / charge_period_start / charge_period_end /
     pending_charge_at / retry_count / charge_error / charged_at
⇒ 存量库若不补列，`model_usage_events` 的写入会报 `no such column: …`
⇒ **官方算力的成本归集与扣分全线失败**。

⚠ **只加列、不重建表**：重建表要搬运营可能已有的用量数据 ⇒ 不可逆 ⇒ 不做。
⚠ **幂等**：列已存在就跳过 ⇒ 每次启动都跑是安全的。
⚠ **DDL 片段必须与 `models_credit.ModelUsageEvent` 的列定义同口径**
（NOT NULL + DEFAULT ⇒ 补列后的存量行读出来是默认值而不是 NULL）。
"""
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

#: (列名, DDL 片段) —— 顺序与 models_credit 里的声明一致，便于对账。
ADDED_COLUMNS = [
    # ① 非 token 维度列（R5-1）
    ("duration_seconds", "INTEGER NOT NULL DEFAULT 0"),
    ("item_count", "INTEGER NOT NULL DEFAULT 0"),
    ("char_count", "INTEGER NOT NULL DEFAULT 0"),
    # ② 扣分状态机列（R5-2）
    ("charge_status", "VARCHAR NOT NULL DEFAULT 'not_applicable'"),
    ("charge_source", "VARCHAR NOT NULL DEFAULT 'client'"),
    ("charge_period_start", "VARCHAR NOT NULL DEFAULT ''"),
    ("charge_period_end", "VARCHAR NOT NULL DEFAULT ''"),
    ("pending_charge_at", "VARCHAR NOT NULL DEFAULT ''"),
    ("retry_count", "INTEGER NOT NULL DEFAULT 0"),
    ("charge_error", "VARCHAR NOT NULL DEFAULT ''"),
    ("charged_at", "VARCHAR NOT NULL DEFAULT ''"),
]


async def ensure_model_usage_event_columns(db: AsyncSession) -> None:
    """幂等补列：`model_usage_events` 的维度列与扣分状态机列。"""
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
