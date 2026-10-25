const assert = require('assert')
const path = require('path')
const test = require('node:test')

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations/postgresql')

// 010 订阅段链。体例与 004/005/006/008 完全一致：单向（迁移 → SCHEMA）比对、
// 去注释、忽略空白；防漂移锁的形状刻意照抄 008，避免「口径各写各的」。

test('010 订阅段链迁移与开发态 SCHEMA 一致', async (t) => {
  await t.test('迁移文件可发现且事务外壳合法', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '010_subscription_segments.sql')
    assert.ok(target, '缺少 010_subscription_segments.sql')
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS identity_subscription_segments/)
  })

  await t.test('迁移正文逐语句在开发态 SCHEMA 中存在（防漂移）', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '010_subscription_segments.sql')
    assert.ok(target, '缺少 010_subscription_segments.sql')

    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
    const ddlStatements = normalizeMigrationSql(target.sql)
      .replace(/--[^\r\n]*/g, '')
      .split(';')
      .map(normalizeStatement)
      .filter(Boolean)
      .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
    assert.ok(ddlStatements.length > 0, '010 迁移正文未解析出任何 DDL 语句')
    const schemaStatements = new Set(SCHEMA.map(normalizeStatement))
    for (const statement of ddlStatements) {
      assert.ok(
        schemaStatements.has(statement),
        `010 迁移与开发态 SCHEMA 漂移，SCHEMA 缺少语句：${statement.slice(0, 60)}`,
      )
    }
  })

  await t.test('开发态 SCHEMA 覆盖段表且 readiness 关系表包含它', async () => {
    const calls = []
    const pool = { async query(text) { calls.push(text); return { rows: [] } } }
    const { PostgresIdentityRepository, REQUIRED_SCHEMA_RELATIONS, SCHEMA } = require('../src/auth/postgres-identity-repository')
    await new PostgresIdentityRepository({ pool }).initialize()
    const sql = calls.join('\n')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_subscription_segments/)
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_subscription_segments_one_active/)
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_identity_subscription_segments_user/)
    assert.ok(
      REQUIRED_SCHEMA_RELATIONS.includes('identity_subscription_segments'),
      'identity_subscription_segments 未纳入 REQUIRED_SCHEMA_RELATIONS',
    )
    assert.ok(
      SCHEMA.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS identity_subscription_segments')),
      'identity_subscription_segments 未纳入开发态 SCHEMA',
    )
  })

  await t.test('段表是 SCHEMA 里最后一张表 ⇒ 关系清单末位必须与之一致', async () => {
    const { REQUIRED_SCHEMA_RELATIONS, SCHEMA } = require('../src/auth/postgres-identity-repository')
    const lastSchemaTable = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(
      [...SCHEMA].reverse().find((statement) => /CREATE TABLE IF NOT EXISTS \w+/.test(statement)),
    )[1]
    assert.strictEqual(
      REQUIRED_SCHEMA_RELATIONS[REQUIRED_SCHEMA_RELATIONS.length - 1],
      lastSchemaTable,
      'REQUIRED_SCHEMA_RELATIONS 末位与 SCHEMA 最后一张表不一致',
    )
  })

  await t.test('readiness 清单不得被清空、也不得漏掉核心表', async () => {
    // ⚠ 这条是「副本漂移」的**防复发**锁：010 加表时，仓库里曾有两处**手抄**的
    //   readiness 表清单（postgres-identity-repository.test.js 内）⇒ 真源加了新表、
    //   副本没加 ⇒ 假池子少回一张表 ⇒ assertReady 判 BUSINESS_DATABASE_SCHEMA_NOT_READY
    //   ⇒ **既有测试凭空变红，而根因是副本漂移不是实现坏了**。
    //   那两处已改为「从 REQUIRED_SCHEMA_RELATIONS 派生」⇒ 本锁守住真源本身不被削弱。
    const { REQUIRED_SCHEMA_RELATIONS } = require('../src/auth/postgres-identity-repository')
    assert.ok(
      REQUIRED_SCHEMA_RELATIONS.length >= 16,
      `readiness 清单被清空（现 ${REQUIRED_SCHEMA_RELATIONS.length} 张）`,
    )
    for (const core of [
      'identity_users',
      'identity_subscriptions',
      'identity_entitlement_snapshots',
      'identity_orders',
      'identity_redeem_codes',
      'identity_subscription_segments',
    ]) {
      assert.ok(
        REQUIRED_SCHEMA_RELATIONS.includes(core),
        `readiness 清单漏掉核心表：${core}`,
      )
    }
  })

  await t.test('本迁移是纯增量：不改任何既有表（规格 A17）', async () => {
    // ⚠ 原写法是「断言新建的 010 文件里不含 ALTER TABLE identity_subscriptions」
    //   ⇒ 近乎恒真（010 本来就不会含）⇒ 复核 D-10 判它「没牙齿」。
    //   ⇒ 改成对**整份迁移**扫：任何 ALTER / DROP / RENAME / TRUNCATE 都判红
    //   ⇒ 语义变成「本片只加表，不碰既有结构」（这才是 A17 真正要守的东西）。
    const { discoverMigrations } = require('../src/auth/postgres-migrations')
    const target = discoverMigrations(MIGRATIONS_DIR).find((item) => item.name === '010_subscription_segments.sql')
    assert.doesNotMatch(target.sql, /\bALTER\s+TABLE\b/i, '本迁移改了既有表（应只加表）')
    assert.doesNotMatch(target.sql, /\bDROP\s+(TABLE|INDEX|COLUMN)\b/i, '本迁移删了东西')
    assert.doesNotMatch(target.sql, /\bRENAME\b/i, '本迁移改了对象名')
    assert.doesNotMatch(target.sql, /\bTRUNCATE\b/i, '本迁移清空了数据')
  })

  await t.test('迁移建的每张表都必须进 readiness 清单（从迁移派生，无魔数）', async () => {
    // ⚠ 复核 D-10：原判据用 `length >= 16` 这个魔数当代理 ⇒ 弱。
    //   ⇒ 改成**从迁移目录派生**：迁移里 CREATE TABLE 的每一张表都必须在
    //   REQUIRED_SCHEMA_RELATIONS 里 ⇒ 漏加一张即判红，且**自动跟上未来的迁移**。
    const fs = require('node:fs')
    const { discoverMigrations } = require('../src/auth/postgres-migrations')
    const { REQUIRED_SCHEMA_RELATIONS } = require('../src/auth/postgres-identity-repository')
    const created = new Set()
    for (const item of discoverMigrations(MIGRATIONS_DIR)) {
      for (const match of item.sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)) {
        created.add(match[1])
      }
    }
    assert.ok(created.size > 0, '未从迁移里解析出任何表')
    for (const table of created) {
      assert.ok(
        REQUIRED_SCHEMA_RELATIONS.includes(table),
        `迁移建了 ${table}，但它未进 REQUIRED_SCHEMA_RELATIONS ⇒ 生产缺表时 readiness 发现不了`,
      )
    }
  })
})

test('010 段链的语义约束不可被削弱', async (t) => {
  const { SEGMENT_SCHEMA } = require('../src/auth/subscription-segments-schema')
  const table = SEGMENT_SCHEMA.find((s) => s.includes('CREATE TABLE IF NOT EXISTS identity_subscription_segments'))
  assert.ok(table, 'SEGMENT_SCHEMA 缺 identity_subscription_segments')

  await t.test('档位与来源白名单固定（面值的第一半）', async () => {
    assert.match(table, /plan TEXT NOT NULL CHECK \(plan IN \('standard', 'pro'\)\)/)
    assert.match(table, /source_kind TEXT NOT NULL CHECK \(source_kind IN \('redeem', 'payment', 'grant'\)\)/)
    assert.match(table, /status TEXT NOT NULL DEFAULT 'queued' CHECK \(status IN \('queued', 'active', 'consumed'\)\)/)
  })

  await t.test('时长上界在表上（面值的第二半）', async () => {
    assert.match(table, /duration_days INTEGER NOT NULL CHECK \(duration_days > 0 AND duration_days <= 36500\)/)
  })

  await t.test('剩余时长非负，且与面值是两个独立的量', async () => {
    assert.match(table, /remaining_ms BIGINT CHECK \(remaining_ms IS NULL OR remaining_ms >= 0\)/)
    // 面值（duration_days）与剩余（remaining_ms）不得是同一列，也不得互相折算 ⇒ 两列都在且列名不同。
    assert.match(table, /duration_days INTEGER/)
    assert.match(table, /remaining_ms BIGINT/)
  })

  await t.test('链序必须为正（配合应用层只允许正位移）', async () => {
    assert.match(table, /seq BIGINT NOT NULL CHECK \(seq > 0\)/)
  })

  await t.test('排队中的段不得带时刻（规格 §2.2「排队中的段为空」在 DB 层的承载）', async () => {
    assert.match(
      table,
      /CHECK \(status <> 'queued' OR \(period_start IS NULL AND period_end IS NULL\)\)/,
    )
  })

  await t.test('段时刻要么两个都空、要么两个都有且终点晚于起点', async () => {
    assert.match(
      table,
      /CHECK \(\(period_start IS NULL AND period_end IS NULL\) OR \(period_start IS NOT NULL AND period_end IS NOT NULL AND period_end > period_start\)\)/,
    )
  })

  await t.test('单活部分唯一索引存在（I2）', async () => {
    const index = SEGMENT_SCHEMA.find((s) => s.includes('idx_identity_subscription_segments_one_active'))
    assert.ok(index, '缺 idx_identity_subscription_segments_one_active')
    assert.match(index, /UNIQUE INDEX/)
    assert.match(index, /WHERE status = 'active'/)
  })

  await t.test('链序唯一约束必须 DEFERRABLE（否则段序后移会逐行撞唯一约束）', async () => {
    assert.match(
      table,
      /CONSTRAINT uq_identity_subscription_segments_user_seq UNIQUE \(user_id, seq\) DEFERRABLE INITIALLY DEFERRED/,
    )
  })

  await t.test('幂等键的唯一约束必须即时（不能 DEFERRABLE）', async () => {
    assert.match(
      table,
      /CONSTRAINT uq_identity_subscription_segments_source_reference UNIQUE \(source_reference\)/,
    )
    // 幂等锁靠**当场**冲突暴露 ⇒ 不得延后到 COMMIT。
    const line = table.split('\n').find((l) => l.includes('uq_identity_subscription_segments_source_reference'))
    assert.doesNotMatch(line, /DEFERRABLE/)
  })
})
