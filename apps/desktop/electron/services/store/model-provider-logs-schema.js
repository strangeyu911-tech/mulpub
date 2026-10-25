// @ts-check
/**
 * model-provider-logs-schema — `model_provider_logs` 表的建表 SQL 与幂等补列迁移。
 *
 * ⚠ **为什么独立成文件**（2026-10-25）：`store-schema.js` 在主干上正好 **499 行**
 *   （上限 500、零余量）⇒ 任何净增都会触发 `NEW_OVER_LIMIT`（新代码不得引入超大文件）。
 *   ⇒ 按仓内纪律「**不许再长的文件 ⇒ 抽模块，不抬基线**」，
 *   把这张表的 DDL + 迁移整体搬到这里，`store-schema.js` 只引用它。
 *
 * ⚠ 本次新增的四列 + byok 的意义：
 *   - `spec` / `duration_seconds` / `item_count` / `char_count`
 *     ⇒ 官方算力成本归集需要的**用量维度**（视频按秒 / 图像按张 / 语音按字符）。
 *     缺它们 ⇒ 服务端 `cards.get(unit)` 恒 None ⇒ **成本恒 0 且全报「缺价格」**。
 *   - `byok`（1 = 用户自带 Key）⇒ 服务端据此决定**是否扣官方积分**
 *     （给用户错扣比不扣更糟 ⇒ 缺省必须是 1）。
 */
'use strict'

/** 建表 SQL（含本次新增的五列）。 */
const MODEL_PROVIDER_LOGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS model_provider_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id   TEXT NOT NULL,
    category      TEXT NOT NULL,
    model         TEXT,
    action        TEXT NOT NULL,
    status        TEXT NOT NULL,
    latency_ms    INTEGER,
    tokens_in     INTEGER,
    tokens_out    INTEGER,
    cost          REAL,
    error_message TEXT,
    created_at    TEXT DEFAULT '',
    spec          TEXT,
    duration_seconds INTEGER,
    item_count      INTEGER,
    char_count      INTEGER,
    byok            INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (provider_id) REFERENCES model_providers(id)
  )`

/** 需要补的列（列名, DDL）。`byok` 的默认是 1（历史调用全是用户自己的 Key）。 */
const ADDED_COLUMNS = [
  ['spec', 'ALTER TABLE model_provider_logs ADD COLUMN spec TEXT'],
  ['duration_seconds', 'ALTER TABLE model_provider_logs ADD COLUMN duration_seconds INTEGER'],
  ['item_count', 'ALTER TABLE model_provider_logs ADD COLUMN item_count INTEGER'],
  ['char_count', 'ALTER TABLE model_provider_logs ADD COLUMN char_count INTEGER'],
  ['byok', 'ALTER TABLE model_provider_logs ADD COLUMN byok INTEGER NOT NULL DEFAULT 1'],
]

function execSchemaSql (db, sql) {
  if (typeof db.execOrThrow === 'function') return db.execOrThrow(sql)
  return db.exec(sql)
}

/**
 * 幂等补列：存量库的 `model_provider_logs` 补上新增的五列。
 * ⚠ SQLite 不支持 `ADD COLUMN IF NOT EXISTS` ⇒ 先 PRAGMA table_info 检查再 ALTER。
 *
 * @param {any} db
 */
function migrateModelProviderLogsSchema (db) {
  const cols = db.prepare('PRAGMA table_info(model_provider_logs)').all()
  const colNames = cols.map(c => c.name)
  for (const [name, sql] of ADDED_COLUMNS) {
    if (!colNames.includes(name)) {
      execSchemaSql(db, sql)
    }
  }
}

module.exports = {
  MODEL_PROVIDER_LOGS_TABLE_SQL,
  ADDED_COLUMNS,
  migrateModelProviderLogsSchema,
}
