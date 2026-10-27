/**
 * 订阅段链（010）的**真库**行为验证 —— 可选手动工具，**不进 CI**。
 *
 * ⚠ **为什么它不在 CI 里跑**：CI runner 没有 PostgreSQL ⇒ 本脚本在 CI 上必然失败
 *   ⇒ 把它塞进测试发现路径 = 「一个从不跑的测试」⇒ 典型的假绿形态（仓内已有先例：
 *   `check-unwired-tests` 那条「漏登记 ⇒ 从未执行」的坑）。
 *   ⇒ 本脚本的定位是「**有真库时手工跑一遍**」，读数落在执行记录里。
 *
 * 它验什么（规格/实现里**曾经只靠推理**的三条 DDL 行为断言）：
 *   ① 部分唯一索引（每用户至多一个 active 段）：**语句末尾**当场拦截？
 *      错误里的 `constraint` 是不是**索引名**（分类器的匹配键）？
 *   ② `(user_id, seq)` 的 DEFERRABLE：冲突**推迟到 COMMIT**？COMMIT 阶段的 23505
 *      能否被事务包装层（`postgres-commerce-store.js`）归一成 409（而不是裸 23505/500）？
 *   ③ demote 的「剩余自算」与时刻 CHECK 的相容性；毫秒级精度。
 *
 * 跑法（需要一个可写的真 PostgreSQL）：
 *   BUSINESS_DATABASE_URL='postgres://user@host:5432/db' node scripts/verify-segment-ddl.js
 *   # 本地 socket 形态也支持：
 *   BUSINESS_DATABASE_URL='postgres://postgres@/dbname?host=/tmp/pgsock&port=5433' node scripts/verify-segment-ddl.js
 *
 * ⚠ 脚本会**建表并写入测试行**（表名 `identity_subscription_segments`）⇒ 只对**本地/测试库**跑，
 *   **不要**指向生产库。跑完请自行清理。
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const MIGRATION = path.resolve(__dirname, '../../../migrations/postgresql/010_subscription_segments.sql')
const DATABASE_URL = process.env.BUSINESS_DATABASE_URL || ''
if (!DATABASE_URL) {
  console.error('需要 BUSINESS_DATABASE_URL（见文件头）')
  process.exit(2)
}

const results = []
function check(id, ok, detail) {
  results.push({ id, ok, detail })
  console.log(`${ok ? '  PASS' : '  FAIL'} ${id} —— ${detail}`)
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const {
    PostgresIdentityRepository,
  } = require('../src/auth/postgres-identity-repository')
  const { classifyUniqueViolation } = require('../src/auth/subscription-segments')

  // ── 0. 建表：跑仓里真迁移 + 最小 identity_users ──────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS identity_users (
    id TEXT PRIMARY KEY, auth_provider TEXT NOT NULL DEFAULT 'logto',
    auth_subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    display_name TEXT, avatar_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (auth_provider, auth_subject))`)
  await pool.query(`INSERT INTO identity_users (id, auth_subject) VALUES ('u-live','live-subject') ON CONFLICT DO NOTHING`)
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
  await pool.query('DROP TABLE IF EXISTS identity_subscription_segments')
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'))
  console.log(`真迁移已执行（表结构来自 ${path.basename(MIGRATION)}）\n`)

  const repo = new PostgresIdentityRepository({ pool })

  console.log('=== ① 部分唯一索引：当场拦截 + 错误里 constraint 是索引名？ ===')
  {
    // 先有一条 active 段
    await repo.commerceTransaction(async (tx) => {
      await tx.insertQueuedSegment({
        userId: 'u-live', plan: 'pro', durationDays: 365, seq: 1,
        sourceKind: 'redeem', sourceReference: 'redeem:LIVE-A',
      })
      await tx.activateSegment('seg-first', {
        periodStart: new Date(Date.now() - 65 * 86400000).toISOString(),
        periodEnd: new Date(Date.now() + 300 * 86400000).toISOString(),
      }).catch(() => {})
    })
  }
  {
    // 用可控 id 造第一条 active
    await pool.query(`DELETE FROM identity_subscription_segments WHERE user_id='u-live'`)
    await pool.query(`INSERT INTO identity_subscription_segments
      (id,user_id,plan,duration_days,seq,status,source_kind,source_reference)
      VALUES ('seg-live-1','u-live','pro',365,1,'active','redeem','redeem:LIVE1')`)
    let raw = null
    try {
      await repo.commerceTransaction(async (tx) => {
        // ⚠ 必须用**插入返回的真实 id**（seg-<uuid>），不能用自己编的 id
        const inserted = await tx.insertQueuedSegment({
          userId: 'u-live', plan: 'standard', durationDays: 30, seq: 2,
          sourceKind: 'redeem', sourceReference: 'redeem:LIVE2',
        })
        await tx.activateSegment(inserted.id, {
          periodStart: new Date().toISOString(),
          periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        })
      })
    } catch (error) {
      raw = error
    }
    check('①a 激活第二个生效段 ⇒ 当场被拦（不是等 COMMIT）', Boolean(raw),
      raw ? `错误码=${raw.code} status=${raw.status}` : '竟然成功了')
    check('①b 错误语义码 = SEGMENT_MULTIPLE_ACTIVE', raw && raw.code === 'SEGMENT_MULTIPLE_ACTIVE',
      raw ? `code=${raw.code}（分类器按 constraint 名匹配）` : '—')
    check('①c 驱动给的 constraint = 索引名（分类器的匹配键）',
      raw && raw.constraint === 'idx_identity_subscription_segments_one_active',
      raw ? `constraint=${raw.constraint}` : '—')
    // 附带读数：activate 一个**不存在**的 id 报什么（口径可分辨性）
    let missing = null
    try {
      await repo.commerceTransaction(async (tx) => {
        await tx.activateSegment('seg-does-not-exist', {
          periodStart: new Date().toISOString(),
          periodEnd: new Date(Date.now() + 86400000).toISOString(),
        })
      })
    } catch (e) { missing = e }
    check('①d activate 不存在的段 ⇒ 报 SEGMENT_NOT_QUEUED（与「不是 queued」同码）',
      missing && missing.code === 'SEGMENT_NOT_QUEUED',
      missing ? `code=${missing.code} —— ⚠ 「id 不存在」与「id 不是 queued」不可分辨（可改进项）` : '—')
  }

  console.log('\n=== ② (user_id,seq) DEFERRABLE：推迟到 COMMIT + 包装层能否接住 ===')
  {
    let stmtError = null
    let commitError = null
    try {
      await repo.commerceTransaction(async (tx) => {
        await tx.insertQueuedSegment({
          userId: 'u-live', plan: 'standard', durationDays: 30, seq: 9,
          sourceKind: 'redeem', sourceReference: 'redeem:SEQ1',
        })
        try {
          await tx.insertQueuedSegment({
            userId: 'u-live', plan: 'standard', durationDays: 30, seq: 9,
            sourceKind: 'redeem', sourceReference: 'redeem:SEQ2',
          })
        } catch (e) {
          stmtError = e
        }
      })
    } catch (e) {
      commitError = e
    }
    check('②a 同 seq 的第二条 INSERT 在语句末尾**不**报错（已推迟）', stmtError === null,
      stmtError ? `语句就报了：${stmtError.code}` : '语句通过 ⇒ 推迟生效')
    check('②b 违例在 COMMIT 阶段抛出', Boolean(commitError), commitError ? `COMMIT 抛 ${commitError.code}` : '没抛')
    check('②c 包装层把它归一成 409（不是裸 23505/500）',
      commitError && commitError.status === 409 && commitError.code === 'COMMERCE_UNIQUE_CONFLICT',
      commitError ? `code=${commitError.code} status=${commitError.status} pgCode=${commitError.pgCode}` : '—')
    check('②d 错误对象仍带 constraint（段链侧可二次分类）',
      commitError && commitError.constraint === 'uq_identity_subscription_segments_user_seq',
      commitError ? `constraint=${commitError.constraint}` : '—')
    check('②e 段链分类器能把它细分成语义码',
      commitError ? classifyUniqueViolation(commitError.constraint).code === 'SEGMENT_SEQ_CONFLICT' : false,
      commitError ? `classifyUniqueViolation(...) = ${classifyUniqueViolation(commitError.constraint).code}` : '—')
  }

  console.log('\n=== ③ demote 的「剩余自算」+ 与时刻 CHECK 的相容性 ===')
  {
    await pool.query(`DELETE FROM identity_subscription_segments WHERE user_id='u-live'`)
    await pool.query(`INSERT INTO identity_subscription_segments
      (id,user_id,plan,duration_days,seq,status,period_start,period_end,source_kind,source_reference)
      VALUES ('seg-live-d','u-live','pro',365,1,'active', NOW() - INTERVAL '65 days',
              NOW() + INTERVAL '300 days','redeem','redeem:LIVED')`)
    const before = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (period_end - NOW()))*1000 AS ms FROM identity_subscription_segments WHERE id='seg-live-d'`)
    let row = null
    let err = null
    try {
      row = await repo.commerceTransaction(async (tx) => {
        return await tx.demoteActiveSegment('seg-live-d')
      })
    } catch (e) {
      err = e
    }
    check('③a demote 与时刻 CHECK 相容（同一条 UPDATE 清空两个时刻）', !err && Boolean(row),
      err ? `被拒：${err.code} ${err.message}` : `成功，remaining_ms=${row.remaining_ms}`)
    const expected = Math.floor(Number(before.rows[0].ms))
    const drift = row ? Math.abs(row.remaining_ms - expected) : -1
    check('③b 剩余是毫秒级、与 period_end 的真实差值一致（误差 < 1s）', row && drift < 1000,
      row ? `remaining_ms=${row.remaining_ms} vs 期望≈${expected}（差 ${drift}ms）` : '—')
    check('③c demote 后两个时刻确实被清空、status=queued',
      row && row.status === 'queued' && row.period_start === null && row.period_end === null,
      row ? `status=${row.status} start=${row.period_start} end=${row.period_end}` : '—')
    // 半截段 / queued 带时刻 / seq<=0 三条 CHECK
    for (const [id, label, sql, values] of [
      ['③d', '半截段（只有起点）被 CHECK 拒',
        `INSERT INTO identity_subscription_segments (id,user_id,plan,duration_days,seq,status,period_start,source_kind,source_reference)
         VALUES ($1,'u-live','pro',365,20,'active',NOW(),'redeem','redeem:H1')`, ['seg-half2']],
      ['③e', 'queued 段带时刻被 CHECK 拒',
        `INSERT INTO identity_subscription_segments (id,user_id,plan,duration_days,seq,status,period_start,period_end,source_kind,source_reference)
         VALUES ($1,'u-live','pro',365,21,'queued',NOW(),NOW()+INTERVAL '1 day','redeem','redeem:Q1')`, ['seg-q2']],
      ['③f', 'seq=0 被 CHECK 拒',
        `INSERT INTO identity_subscription_segments (id,user_id,plan,duration_days,seq,status,source_kind,source_reference)
         VALUES ($1,'u-live','pro',365,0,'queued','redeem','redeem:N1')`, ['seg-neg2']],
    ]) {
      let failed = null
      try { await pool.query(sql, values) } catch (e) { failed = e }
      check(id, Boolean(failed) && failed.code === '23514',
        failed ? `被拒 SQLSTATE=${failed.code}` : '插进去了 ⇒ CHECK 没生效')
    }
  }

  await pool.query("DELETE FROM identity_subscription_segments WHERE user_id='u-live'")
  await pool.query("DELETE FROM identity_users WHERE id='u-live'")
  await pool.end()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== 汇总：${results.length - failed.length}/${results.length} 条通过 ===`)
  if (failed.length) {
    for (const f of failed) console.log(`  ❌ ${f.id}: ${f.detail}`)
    process.exitCode = 1
  }
}

main().catch((e) => { console.error('脚本异常：', e); process.exitCode = 1 })
