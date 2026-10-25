const assert = require('assert')
const test = require('node:test')

const {
  SEGMENT_MAX_DURATION_DAYS,
  ONE_ACTIVE_INDEX,
  classifyUniqueViolation,
  SubscriptionSegmentMethods,
} = require('../src/auth/subscription-segments')
const { PostgresCommerceTransaction } = require('../src/auth/postgres-identity-repository')

/** 假事务 client：记录调用，可按需排入结果。 */
function fakeClient() {
  const calls = []
  return {
    calls,
    queue: [],
    async query(text, values) {
      calls.push({ text, values })
      if (this.queue.length) {
        const next = this.queue.shift()
        // 排队的若是 Error ⇒ 必须**抛**（模拟驱动抛错），不能当成返回值
        // ⇒ 否则被测代码的 catch 分支根本走不到，判据会假绿。
        if (next instanceof Error) throw next
        return next
      }
      return { rows: [], rowCount: 0 }
    },
  }
}

function txWith(client) {
  const tx = new PostgresCommerceTransaction(client)
  return tx
}

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('预期抛错但没有')
}

test('段链仓储原语', async (t) => {
  await t.test('接线：原语已混入事务类（叶子模块单测全绿 ≠ 已接线）', async () => {
    for (const name of [
      'listSubscriptionSegments',
      'getActiveSubscriptionSegment',
      'nextSegmentSeq',
      'insertQueuedSegment',
      'demoteActiveSegment',
      'activateSegment',
      'consumeActiveSegment',
      'shiftSegmentSeq',
    ]) {
      assert.strictEqual(
        typeof PostgresCommerceTransaction.prototype[name],
        'function',
        `事务类缺少段链原语：${name}（模块未被混入）`,
      )
    }
    assert.ok(SubscriptionSegmentMethods, 'SubscriptionSegmentMethods 未导出')
  })

  await t.test('读链按 seq 升序（链序真源是 seq，不是 created_at）', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-1', seq: 1 }] })
    const rows = await txWith(client).listSubscriptionSegments('u-1')
    const call = client.calls[0]
    assert.match(call.text, /FROM identity_subscription_segments/)
    assert.match(call.text, /ORDER BY seq ASC/)
    assert.doesNotMatch(call.text, /ORDER BY created_at/)
    assert.deepStrictEqual(call.values, ['u-1'])
    assert.strictEqual(rows[0].id, 'seg-1')
  })

  await t.test('当前生效段查询带 active 过滤（至多一个由部分唯一索引保证）', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-9', status: 'active' }] })
    const row = await txWith(client).getActiveSubscriptionSegment('u-1')
    assert.match(client.calls[0].text, /status = 'active'/)
    assert.strictEqual(row.id, 'seg-9')
  })

  await t.test('链尾下一个 seq 从 max(seq)+1 推导', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ next_seq: 4 }] })
    const seq = await txWith(client).nextSegmentSeq('u-1')
    assert.match(client.calls[0].text, /COALESCE\(MAX\(seq\), 0\) \+ 1/)
    assert.strictEqual(seq, 4)
  })
})

test('插入段：结构上只能写排队段', async (t) => {
  await t.test('插入语句的 status 恒为字面量 queued（没有插入 active 的入口）', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-x', status: 'queued' }] })
    await txWith(client).insertQueuedSegment({
      userId: 'u-1',
      plan: 'standard',
      durationDays: 365,
      seq: 1,
      sourceKind: 'redeem',
      sourceReference: 'redeem:ABCD-EFGH-JKMN',
    })
    const call = client.calls[0]
    assert.match(call.text, /INSERT INTO identity_subscription_segments/)
    // ⚠ **位置断言**（复核 D-2）：只断言「文本里出现过 'queued'」是**文本锁**，
    //   挡不住 `CASE WHEN $6='redeem' THEN 'queued' ELSE 'active' END` 这种绕过
    //   （变异 M1b 实测 27/27 全绿 ⇒ 锁没牙齿）。
    //   ⇒ 断言「status 槽（第 6 位）恒为字面量 'queued'」⇒ CASE 写法必然不匹配。
    assert.match(call.text, /\$5, 'queued', \$6, \$7\)/)
    // 插入路径**不接受**调用方指定的 status ⇒ D-1「先 demote 再 activate」结构上无法违反。
    assert.strictEqual(call.values.length, 7)
    assert.deepStrictEqual(call.values.slice(1), ['u-1', 'standard', 365, 1, 'redeem', 'redeem:ABCD-EFGH-JKMN'])
  })

  await t.test('段 id 缺省自生成 seg-<uuid>', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-x' }] })
    await txWith(client).insertQueuedSegment({
      userId: 'u-1', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: 'grant:x',
    })
    assert.match(client.calls[0].values[0], /^seg-[0-9a-f-]{36}$/)
  })

  await t.test('参数非法一律 400（不是裸 500）', async () => {
    const cases = [
      [{ userId: '', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: 'g' }, 'SEGMENT_USER_REQUIRED'],
      [{ userId: 'u-1', plan: 'vip', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: 'g' }, 'SEGMENT_PLAN_INVALID'],
      [{ userId: 'u-1', plan: 'pro', durationDays: 0, seq: 1, sourceKind: 'grant', sourceReference: 'g' }, 'DURATION_INVALID'],
      [{ userId: 'u-1', plan: 'pro', durationDays: 1.5, seq: 1, sourceKind: 'grant', sourceReference: 'g' }, 'DURATION_INVALID'],
      [{ userId: 'u-1', plan: 'pro', durationDays: SEGMENT_MAX_DURATION_DAYS + 1, seq: 1, sourceKind: 'grant', sourceReference: 'g' }, 'DURATION_INVALID'],
      [{ userId: 'u-1', plan: 'pro', durationDays: 30, seq: 0, sourceKind: 'grant', sourceReference: 'g' }, 'SEGMENT_SEQ_INVALID'],
      [{ userId: 'u-1', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'unknown', sourceReference: 'g' }, 'SEGMENT_SOURCE_KIND_INVALID'],
      [{ userId: 'u-1', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: '  ' }, 'SEGMENT_SOURCE_REFERENCE_REQUIRED'],
    ]
    for (const [payload, expected] of cases) {
      const error = await captureError(txWith(fakeClient()).insertQueuedSegment(payload))
      assert.strictEqual(error.code, expected, `入参 ${JSON.stringify(payload)} 的错误码不对`)
      assert.strictEqual(error.status, 400)
    }
  })
})

test('段状态流转：每一步都有守卫', async (t) => {
  await t.test('降级：剩余由本行自算（不接受调用方传值）、清空两个时刻、且只对生效段生效', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-1', status: 'queued', remaining_ms: 1000 }] })
    const row = await txWith(client).demoteActiveSegment('seg-1')
    const call = client.calls[0]
    assert.match(call.text, /SET status = 'queued'/)
    // ⚠ 剩余**由 SQL 自算**（复核 D-3）：调用方若能传 null，已结算行的保剩余就被静默丢弃
    //   ⇒ 用户把已过期的那些天再拿一遍（规格明令禁止的「白赚 65 天」）。
    assert.match(call.text, /remaining_ms = CASE/)
    assert.match(call.text, /WHEN period_end IS NULL THEN NULL/)
    assert.match(call.text, /GREATEST\(0, FLOOR\(/)
    assert.match(call.text, /EXTRACT\(EPOCH FROM \(period_end - NOW\(\)\)\)/)
    assert.match(call.text, /period_start = NULL, period_end = NULL/)
    assert.match(call.text, /WHERE id = \$1 AND status = 'active'/)
    // ⚠ 参数只有 id ⇒ 调用方**无法**声明 remaining（推导出来的，不是声明出来的）
    assert.deepStrictEqual(call.values, ['seg-1'])
    assert.strictEqual(row.remaining_ms, 1000)
  })

  await t.test('降级：段不是生效态 ⇒ 报错，不静默当无事发生', async () => {
    const error = await captureError(txWith(fakeClient()).demoteActiveSegment('seg-1'))
    assert.strictEqual(error.code, 'SEGMENT_NOT_ACTIVE')
    assert.strictEqual(error.status, 409)
  })

  await t.test('激活：只接受排队段，并写入起止时刻', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-1', status: 'active' }] })
    await txWith(client).activateSegment('seg-1', {
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2027-01-01T00:00:00.000Z',
    })
    const call = client.calls[0]
    assert.match(call.text, /SET status = 'active'/)
    assert.match(call.text, /period_start = \$2, period_end = \$3/)
    assert.match(call.text, /WHERE id = \$1 AND status = 'queued'/)
    assert.deepStrictEqual(call.values, ['seg-1', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'])
  })

  await t.test('激活：终点必须晚于起点', async () => {
    const error = await captureError(txWith(fakeClient()).activateSegment('seg-1', {
      periodStart: '2027-01-01T00:00:00.000Z',
      periodEnd: '2026-01-01T00:00:00.000Z',
    }))
    assert.strictEqual(error.code, 'SEGMENT_PERIOD_INVALID')
    assert.strictEqual(error.status, 400)
  })

  await t.test('激活：段不是排队态 ⇒ 报错', async () => {
    const error = await captureError(txWith(fakeClient()).activateSegment('seg-1', {
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2027-01-01T00:00:00.000Z',
    }))
    assert.strictEqual(error.code, 'SEGMENT_NOT_QUEUED')
    assert.strictEqual(error.status, 409)
  })

  await t.test('消费：只对生效段生效', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-1', status: 'consumed' }] })
    await txWith(client).consumeActiveSegment('seg-1')
    assert.match(client.calls[0].text, /SET status = 'consumed'/)
    assert.match(client.calls[0].text, /WHERE id = \$1 AND status = 'active'/)
  })

  await t.test('消费：段不是生效态 ⇒ 报错', async () => {
    const error = await captureError(txWith(fakeClient()).consumeActiveSegment('seg-1'))
    assert.strictEqual(error.code, 'SEGMENT_NOT_ACTIVE')
  })

  await t.test('链序后移：从 fromSeq 起整体 +delta', async () => {
    const client = fakeClient()
    client.queue.push({ rowCount: 3, rows: [] })
    const count = await txWith(client).shiftSegmentSeq('u-1', 2, 1)
    const call = client.calls[0]
    assert.match(call.text, /SET seq = seq \+ \$3/)
    assert.match(call.text, /WHERE user_id = \$1 AND seq >= \$2/)
    assert.deepStrictEqual(call.values, ['u-1', 2, 1])
    assert.strictEqual(count, 3)
  })

  await t.test('链序后移：只允许正位移（负位移会把 seq 推到 ≤0，整条链再也读不动）', async () => {
    for (const delta of [0, -5, 1.5]) {
      const error = await captureError(txWith(fakeClient()).shiftSegmentSeq('u-1', 2, delta))
      assert.strictEqual(error.code, 'SEGMENT_SEQ_INVALID', `位移量 ${delta} 的错误码不对`)
      assert.strictEqual(error.status, 400)
    }
  })

  await t.test('幂等键入库前要归一（trailing 空格会绕开幂等锁）', async () => {
    const client = fakeClient()
    client.queue.push({ rows: [{ id: 'seg-x' }] })
    await txWith(client).insertQueuedSegment({
      userId: 'u-1', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: '  grant:x  ',
    })
    assert.strictEqual(client.calls[0].values[6], 'grant:x')
  })

  await t.test('COMMIT 阶段抛出的 23505（包装层形态）也要被识别', async () => {
    // 链序约束是 DEFERRABLE ⇒ 只在 COMMIT 查 ⇒ 语句级 catch 看不到它
    // ⇒ 事务包装层把它换成 COMMERCE_UNIQUE_CONFLICT + pgCode=23505 ⇒ 这里必须照样分类。
    const client = fakeClient()
    client.queue.push(Object.assign(new Error('duplicate key'), {
      code: 'COMMERCE_UNIQUE_CONFLICT', status: 409, pgCode: '23505',
      constraint: 'uq_identity_subscription_segments_user_seq',
    }))
    const error = await captureError(txWith(client).insertQueuedSegment({
      userId: 'u-1', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: 'grant:x',
    }))
    assert.strictEqual(error.code, 'SEGMENT_SEQ_CONFLICT')
    assert.strictEqual(error.status, 409)
  })
})

test('唯一约束冲突必须被分类成可读语义（不得当成幂等命中）', async (t) => {
  await t.test('来源唯一冲突 ⇒ 幂等命中语义（409）', async () => {
    const client = fakeClient()
    client.queue.push(Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_identity_subscription_segments_source_reference' }))
    const error = await captureError(txWith(client).insertQueuedSegment({
      userId: 'u-1', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: 'grant:x',
    }))
    assert.strictEqual(error.code, 'SEGMENT_SOURCE_CONFLICT')
    assert.strictEqual(error.status, 409)
  })

  await t.test('单活部分唯一索引冲突 ⇒ 写入顺序错误（409，措辞点明 D-1）', async () => {
    const client = fakeClient()
    client.queue.push(Object.assign(new Error('duplicate key'), { code: '23505', constraint: ONE_ACTIVE_INDEX }))
    const error = await captureError(txWith(client).activateSegment('seg-2', {
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2027-01-01T00:00:00.000Z',
    }))
    assert.strictEqual(error.code, 'SEGMENT_MULTIPLE_ACTIVE')
    assert.strictEqual(error.status, 409)
    assert.match(error.message, /先 demote/)
  })

  await t.test('链序唯一冲突 ⇒ 内部状态错误（409）', async () => {
    const classified = classifyUniqueViolation('uq_identity_subscription_segments_user_seq')
    assert.strictEqual(classified.code, 'SEGMENT_SEQ_CONFLICT')
  })

  await t.test('未识别的约束名 ⇒ 不得当成幂等命中', async () => {
    const classified = classifyUniqueViolation('some_other_unique_constraint')
    assert.strictEqual(classified.code, 'SEGMENT_UNIQUE_CONFLICT')
    assert.notStrictEqual(classified.code, 'SEGMENT_SOURCE_CONFLICT')
  })

  await t.test('非 23505 原样上抛（不吞错）', async () => {
    const client = fakeClient()
    client.queue.push(Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }))
    const error = await captureError(txWith(client).insertQueuedSegment({
      userId: 'u-1', plan: 'pro', durationDays: 30, seq: 1, sourceKind: 'grant', sourceReference: 'grant:x',
    }))
    assert.strictEqual(error.code, 'ECONNRESET')
  })
})

test('事务包装层：COMMIT 阶段的唯一约束违例不得裸奔（复核 D-11）', async (t) => {
  await t.test('COMMIT 抛 23505 ⇒ 补上 409 与稳定错误码，不再按 500 兜', async () => {
    const client = {
      async query(text) {
        if (text === 'COMMIT') {
          throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_identity_subscription_segments_user_seq' })
        }
        return { rows: [] }
      },
      release() {},
    }
    const pool = {
      async query() { return { rows: [] } },
      async connect() { return client },
    }
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })
    const error = await captureError(repository.commerceTransaction(async () => 'ok'))
    // ⚠ 链序约束是 DEFERRABLE ⇒ 只在 COMMIT 查 ⇒ 语句级 catch 看不到它
    //   ⇒ 若包装层不归一，裸 23505 没有 status ⇒ 上层按 500 兜
    //   ⇒ 而「高档兑换每次都 500」正是段链模型要消灭的故障形态。
    assert.strictEqual(error.status, 409)
    assert.strictEqual(error.code, 'COMMERCE_UNIQUE_CONFLICT')
    assert.strictEqual(error.pgCode, '23505')
    assert.strictEqual(error.constraint, 'uq_identity_subscription_segments_user_seq')
  })
})

test('面值不可变：仓储层不提供改写 plan / duration_days 的语句', async () => {
  const source = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../src/auth/subscription-segments.js'),
    'utf8',
  )
  assert.doesNotMatch(source, /SET\s+plan\b/i, '段档位（面值的一半）不可被改写')
  assert.doesNotMatch(source, /SET\s+duration_days\b/i, '段时长（面值）不可被改写')
  assert.doesNotMatch(source, /SET\s+remaining_ms\s*=\s*remaining_ms\s*\+/i, '剩余时长不得自行增减')
})
