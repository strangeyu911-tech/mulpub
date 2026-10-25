// @ts-check
/**
 * model-log-store.test.js — `model_provider_logs` 的写入契约（**存储层**）。
 *
 * ⚠ 为什么单测落在这里而不是 manager 层：
 *   官方算力的**用量维度**（spec / 秒数 / 张数 / 字符数）与 **byok** 标记的判定
 *   **归属存储层**（它是「这张表有哪些列」的事）⇒ manager 只负责交出原料
 *   （`params` / `result`）。
 *   ⇒ 所以「维度真的进了表」这条断言必须落在**存储层**，
 *   否则 manager 层只能断言「原料交出去了」，不能断言「列被写对了」。
 *
 * ⚠ 这条链的失败形态极隐蔽：维度没进表 ⇒ 服务端 `cards.get(unit)` 恒 None
 *   ⇒ **成本恒为 0 且全量报「缺价格」**（错误长得像「免费」）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import initSqlJs from 'sql.js'

let SQL
let db
let store

beforeAll(async () => {
  SQL = await initSqlJs()
})

beforeEach(async () => {
  db = new SQL.Database()
  const { SCHEMA_SQL } = await import('../store-schema')
  for (const sql of SCHEMA_SQL) db.exec(sql)
  const mixin = await import('./model-log-store')
  store = Object.assign({
    _ready: true,
    db: {
      prepare: (sql) => ({
        run: (...args) => {
          const stmt = db.prepare(sql)
          stmt.run(args)
          return { changes: 1 }
        },
      }),
    },
  }, mixin.default || mixin)
})

afterEach(() => {
  if (db) db.close()
})

function readRow (id) {
  const r = db.exec('SELECT spec, duration_seconds, item_count, char_count, byok, tokens_in FROM model_provider_logs WHERE provider_id = ?', [id])
  if (!r.length) return null
  const cols = r[0].columns
  const vals = r[0].values[0]
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]))
}

const BASE = {
  provider_id: 'minimax',
  category: 'video',
  model: 'H3',
  action: 'generateVideo',
  status: 'success',
  latency_ms: 12000,
  tokens_in: 0,
  tokens_out: 0,
  cost: null,
  error_message: null,
}

describe('model-log-store.addProviderLog — 用量维度入列', () => {
  it('从 result.usage.total_seconds 抽出秒数并写入', () => {
    store.addProviderLog({ ...BASE, result: { usage: { total_seconds: 10 } } })
    const row = readRow('minimax')
    expect(row.duration_seconds).toBe(10)
  })

  it('从请求侧参数抽出 spec / 张数 / 字符数', () => {
    store.addProviderLog({ ...BASE, params: { resolution: '768p', n: 3, text: '你好' } })
    const row = readRow('minimax')
    expect(row.spec).toBe('768p')
    expect(row.item_count).toBe(3)
    expect(row.char_count).toBe(2)
  })

  it('抽不到维度时写 NULL（不写 0、不写猜出来的值）', () => {
    store.addProviderLog({ ...BASE })
    const row = readRow('minimax')
    expect(row.spec).toBeNull()
    expect(row.duration_seconds).toBeNull()
    expect(row.item_count).toBeNull()
    expect(row.char_count).toBeNull()
  })

  it('byok 缺省是 1（用户自带 Key ⇒ 官方算力不扣积分）', () => {
    store.addProviderLog({ ...BASE })
    expect(readRow('minimax').byok).toBe(1)
  })

  it('显式 byok=0 才算官方算力', () => {
    store.addProviderLog({ ...BASE, byok: 0 })
    expect(readRow('minimax').byok).toBe(0)
  })

  it('entry 里已带维度时优先于自动抽取（显式值不被覆盖）', () => {
    store.addProviderLog({ ...BASE, duration_seconds: 7, result: { usage: { total_seconds: 10 } } })
    expect(readRow('minimax').duration_seconds).toBe(7)
  })

  it('既有列不受影响（tokens / latency 仍按原样落库）', () => {
    store.addProviderLog({ ...BASE, tokens_in: 120, result: { usage: { prompt_tokens: 120 } } })
    const row = readRow('minimax')
    expect(row.tokens_in).toBe(120)
  })
})
