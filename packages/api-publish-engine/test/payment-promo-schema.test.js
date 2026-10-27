'use strict'
/**
 * 011 促销迁移的防漂移锁 + 口径锁。
 *
 * 三条结构性判据（都不看「代码里有没有那个字符串」，而看真实 DDL 形状）：
 *   ① 迁移可发现、事务外壳合法、三条 DDL 与开发态 SCHEMA **逐条一致**（去注释、忽略空白）；
 *   ② `payable_cents` 必须是「加列 → 回填 → 置 NOT NULL」三步：直接
 *      `ADD COLUMN ... NOT NULL` 会在有存量行的库上失败（迁移即中断，全站降级）；
 *   ③ **不得**出现「每用户唯一 paid 订单」索引：会员可叠加续费，唯一索引会把正常续费
 *      挡成 23505。判据按整份文件里 `UNIQUE` 与 `promotion_id`/`user_id` 同现来判，
 *      避免「换个索引名就绕过」。
 */

const assert = require('assert')
const path = require('path')
const test = require('node:test')

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations/postgresql')
const MIGRATION_NAME = '011_payment_promo.sql'

function loadMigration() {
  const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
  const migrations = discoverMigrations(MIGRATIONS_DIR)
  const target = migrations.find((item) => item.name === MIGRATION_NAME)
  assert.ok(target, `缺少 ${MIGRATION_NAME}`)
  assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
  return { target, normalizeMigrationSql }
}

function statementsOf(sql, normalizeMigrationSql) {
  const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
  return normalizeMigrationSql(sql)
    .replace(/--[^\r\n]*/g, '')
    .split(';')
    .map(normalizeStatement)
    .filter(Boolean)
    .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
}

test('011 促销迁移：可发现且与开发态 SCHEMA 一致', async (t) => {
  await t.test('三条 DDL 都在迁移里（少一条 = 生产缺列/缺回填）', () => {
    const { target } = loadMigration()
    assert.match(target.sql, /ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS payable_cents INTEGER/)
    assert.match(target.sql, /ALTER TABLE identity_orders ALTER COLUMN payable_cents SET NOT NULL/)
    assert.match(target.sql, /ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS promotion_id TEXT/)
    assert.match(target.sql, /UPDATE identity_orders SET payable_cents = amount - COALESCE\(discount_cents, 0\)/)
  })

  await t.test('迁移 → 开发态 SCHEMA 单向逐条相等（忽略注释与空白）', () => {
    const { target, normalizeMigrationSql } = loadMigration()
    const { PAYMENT_PROMO_SCHEMA } = require('../src/auth/payment-promo-schema')
    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const schemaStatements = new Set(SCHEMA.map((statement) => statement.replace(/\s+/g, ' ').trim()))
    const ddl = statementsOf(target.sql, normalizeMigrationSql)
    assert.ok(ddl.length >= 5, '迁移正文未解析出全部 DDL 语句')
    for (const statement of ddl) {
      assert.ok(
        schemaStatements.has(statement),
        `迁移与开发态 SCHEMA 漂移，SCHEMA 缺少语句：${statement.slice(0, 70)}`,
      )
    }
    for (const statement of PAYMENT_PROMO_SCHEMA) {
      assert.ok(
        schemaStatements.has(statement.replace(/\s+/g, ' ').trim()),
        'PAYMENT_PROMO_SCHEMA 未被挂进 identity 仓储的 SCHEMA 数组（开发库会缺列）',
      )
    }
  })

  await t.test('回填顺序正确：先加列 → 再回填 → 最后 NOT NULL', () => {
    const { target, normalizeMigrationSql } = loadMigration()
    const ddl = statementsOf(target.sql, normalizeMigrationSql)
    const addIndex = ddl.findIndex((s) => /ADD COLUMN IF NOT EXISTS payable_cents/.test(s))
    const backfillIndex = ddl.findIndex((s) => /UPDATE identity_orders SET payable_cents/.test(s))
    const notNullIndex = ddl.findIndex((s) => /ALTER COLUMN payable_cents SET NOT NULL/.test(s))
    assert.ok(addIndex >= 0 && backfillIndex >= 0 && notNullIndex >= 0, '三步缺一')
    assert.ok(addIndex < backfillIndex, '回填必须晚于加列')
    assert.ok(backfillIndex < notNullIndex, '置 NOT NULL 必须晚于回填（否则存量行直接失败）')
  })

  await t.test('⛔ 不得建「每用户唯一 paid 订单」索引（会挡正常续费）', () => {
    const { target } = loadMigration()
    const sql = target.sql.toUpperCase()
    assert.equal(sql.includes('UNIQUE'), false, '促销迁移不得出现任何 UNIQUE 约束/索引')
    const { PAYMENT_PROMO_SCHEMA } = require('../src/auth/payment-promo-schema')
    for (const statement of PAYMENT_PROMO_SCHEMA) {
      assert.equal(statement.toUpperCase().includes('UNIQUE'), false, '开发态 SCHEMA 同样不得建唯一索引')
    }
  })
})
