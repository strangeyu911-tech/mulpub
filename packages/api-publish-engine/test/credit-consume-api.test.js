'use strict'

/**
 * 官方算力扣分端点 `POST /api/v1/credit/consume` 的契约测试。
 *
 * 契约真源：`01-docs/PRD-CREDIT-CONSUME-API-2026-10-25.md`
 * 落地形态定案：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md` §3.3 / §6.4
 *
 * 覆盖三组：
 *   ① 入参校验纯函数（`validateCreditConsumeBody`）—— 逐条钉住错误码与判定顺序；
 *   ② 端点 HTTP 行为（真起 server + 真发请求）—— 鉴权 / fail-closed / 错误码 / 幂等 / 审计；
 *   ③ 仓储层并发同 refId ⇒ DB 唯一索引冲突 ⇒ 翻译成幂等命中（余额扣减随事务回滚）。
 *
 * runner：`node:test` + `assert` ⇒ 判定器按文件内容认出 direct 分支（无需登记 VITEST_FILES）。
 */

const assert = require('assert')
const http = require('http')
const test = require('node:test')

const { TestPublishApiServer: PublishApiServer } = require('./test-publish-api-server')
const {
  validateCreditConsumeBody,
  CREDIT_ERROR_STATUS,
  CREDIT_REF_TYPE,
} = require('../src/auth/publish-api-credit-consume')
const { PostgresCreditRepository } = require('../src/auth/credit-repository')

// ── 测试夹具 ────────────────────────────────────────────────────────────

const VALID_BODY = Object.freeze({
  authSubject: 'user-sub',
  amount: 12,
  costCents: 34,
  priceId: 'price-1',
  reason: '官方算力消耗',
  refType: 'usage_event',
  refId: 'evt-1',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
})

function request(port, method, path, token, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method, path,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }) }
        catch (error) { reject(new Error(`响应非 JSON (${res.statusCode}): ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/** 身份仓储桩：M2M 调用方与目标用户都能解析；`ghost-sub` 解析不到。 */
function createIdentityRepositoryStub() {
  return {
    calls: [],
    async findBySubject(provider, subject) {
      this.calls.push(['findBySubject', provider, subject])
      if (subject === 'user-sub') return { id: 'identity-user-1', auth_provider: provider, auth_subject: subject, status: 'active' }
      if (subject === 'm2m-sub') return { id: 'identity-m2m', auth_provider: provider, auth_subject: subject, status: 'active' }
      return null
    },
    async create(record) { return { ...record, status: 'active' } },
  }
}

/** 积分仓储桩：行为可编排（成功 / 余额不足 / 抛未知错）。 */
function createCreditRepositoryStub(overrides = {}) {
  return {
    calls: [],
    async consumeCredit(payload) {
      this.calls.push(payload)
      if (overrides.throwError) throw overrides.throwError
      return {
        account: { balance: 88, grantedTotal: 200, spentTotal: 12, periodStart: payload.periodStart, periodEnd: payload.periodEnd },
        entry: { id: 42, entryType: 'spend', amount: payload.amount, balanceAfter: 88 },
        duplicated: Boolean(overrides.duplicated),
      }
    },
  }
}

function createVerifier() {
  return {
    verify: async (token) => {
      if (token === 'm2m-token') return { subject: 'm2m-sub', scopes: ['admin:users'] }
      if (token === 'user-token') return { subject: 'user-sub', scopes: ['profile:read'] }
      throw Object.assign(new Error('AUTH_TOKEN_INVALID'), { code: 'AUTH_TOKEN_INVALID', status: 401 })
    },
  }
}

async function withServer(options, fn) {
  const server = new PublishApiServer(options)
  await server.start(0)
  const port = server._server.address().port
  try {
    await fn(port, server)
  } finally {
    await server.stop()
  }
}

// ── ① 入参校验 ──────────────────────────────────────────────────────────

test('入参校验：合法请求通过，且 refType 被归一为常量', () => {
  const parsed = validateCreditConsumeBody({ ...VALID_BODY })
  assert.strictEqual(parsed.ok, true)
  assert.strictEqual(parsed.value.refType, CREDIT_REF_TYPE)
  assert.strictEqual(parsed.value.amount, 12)
  assert.strictEqual(parsed.value.costCents, 34)
  assert.strictEqual(parsed.value.refId, 'evt-1')
})

test('入参校验：body 不是对象 ⇒ CREDIT_USER_INVALID（不放行半缺字段的请求）', () => {
  for (const body of [null, undefined, 'x', 42, []]) {
    const parsed = validateCreditConsumeBody(body)
    assert.strictEqual(parsed.ok, false, `body=${JSON.stringify(body)} 应当被拒`)
    assert.strictEqual(parsed.error, 'CREDIT_USER_INVALID')
  }
})

test('入参校验：authSubject 缺失/空/超长 ⇒ CREDIT_USER_INVALID', () => {
  const cases = [
    { ...VALID_BODY, authSubject: undefined },
    { ...VALID_BODY, authSubject: '' },
    { ...VALID_BODY, authSubject: '   ' },
    { ...VALID_BODY, authSubject: 123 },
    { ...VALID_BODY, authSubject: 'x'.repeat(129) },
  ]
  for (const body of cases) {
    const parsed = validateCreditConsumeBody(body)
    assert.strictEqual(parsed.ok, false)
    assert.strictEqual(parsed.error, 'CREDIT_USER_INVALID')
  }
})

test('入参校验：refId 缺失/空 ⇒ CREDIT_REF_INVALID（空 refId 会静默免费算力）', () => {
  for (const body of [{ ...VALID_BODY, refId: undefined }, { ...VALID_BODY, refId: '' }, { ...VALID_BODY, refId: ' ' }]) {
    const parsed = validateCreditConsumeBody(body)
    assert.strictEqual(parsed.ok, false)
    assert.strictEqual(parsed.error, 'CREDIT_REF_INVALID')
  }
})

test('入参校验：refType 非常量 ⇒ CREDIT_REF_INVALID（DB 唯一索引只覆盖 usage_event）', () => {
  const parsed = validateCreditConsumeBody({ ...VALID_BODY, refType: 'other' })
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error, 'CREDIT_REF_INVALID')
  // 缺省时按常量补齐（不可省 ⇒ 由端点兜底）
  const omitted = validateCreditConsumeBody({ ...VALID_BODY, refType: undefined })
  assert.strictEqual(omitted.ok, true)
  assert.strictEqual(omitted.value.refType, CREDIT_REF_TYPE)
})

test('入参校验：amount 非正整数 ⇒ CREDIT_AMOUNT_INVALID（amount=0 也非法）', () => {
  for (const amount of [0, -1, 1.5, '12', null, undefined, NaN]) {
    const parsed = validateCreditConsumeBody({ ...VALID_BODY, amount })
    assert.strictEqual(parsed.ok, false, `amount=${amount} 应当被拒`)
    assert.strictEqual(parsed.error, 'CREDIT_AMOUNT_INVALID')
  }
})

test('入参校验：costCents 非负整数 ⇒ CREDIT_AMOUNT_INVALID', () => {
  for (const costCents of [-1, 1.5, '34', null, undefined]) {
    const parsed = validateCreditConsumeBody({ ...VALID_BODY, costCents })
    assert.strictEqual(parsed.ok, false, `costCents=${costCents} 应当被拒`)
    assert.strictEqual(parsed.error, 'CREDIT_AMOUNT_INVALID')
  }
})

test('入参校验：扣了分却把账本成本记成 0 ⇒ 拒（记 0 等于静默免费）', () => {
  const parsed = validateCreditConsumeBody({ ...VALID_BODY, amount: 1, costCents: 0 })
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error, 'CREDIT_AMOUNT_INVALID')
})

test('入参校验：period 非法（缺失/坏日期/end<=start）⇒ CREDIT_PERIOD_INVALID', () => {
  const cases = [
    { ...VALID_BODY, periodStart: undefined },
    { ...VALID_BODY, periodEnd: undefined },
    { ...VALID_BODY, periodStart: 'not-a-date' },
    { ...VALID_BODY, periodEnd: 'not-a-date' },
    { ...VALID_BODY, periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z' },
    { ...VALID_BODY, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z' },
  ]
  for (const body of cases) {
    const parsed = validateCreditConsumeBody(body)
    assert.strictEqual(parsed.ok, false, JSON.stringify(body) + ' 应当被拒')
    assert.strictEqual(parsed.error, 'CREDIT_PERIOD_INVALID')
  }
})

test('入参校验：判定顺序 = 目标用户 → 幂等键 → 要算的数 → 周期边界', () => {
  // 同时缺多项时，先报最根本的那一类（连要扣谁都不知道时，其余报错没意义）
  assert.strictEqual(validateCreditConsumeBody({}).error, 'CREDIT_USER_INVALID')
  assert.strictEqual(validateCreditConsumeBody({ authSubject: 'u' }).error, 'CREDIT_REF_INVALID')
  assert.strictEqual(validateCreditConsumeBody({ authSubject: 'u', refId: 'r' }).error, 'CREDIT_AMOUNT_INVALID')
  assert.strictEqual(
    validateCreditConsumeBody({ authSubject: 'u', refId: 'r', amount: 1, costCents: 1 }).error,
    'CREDIT_PERIOD_INVALID',
  )
})

test('错误码表完整：每个码都有确定的 HTTP 状态', () => {
  assert.strictEqual(CREDIT_ERROR_STATUS.CREDIT_USER_INVALID, 400)
  assert.strictEqual(CREDIT_ERROR_STATUS.CREDIT_REF_INVALID, 400)
  assert.strictEqual(CREDIT_ERROR_STATUS.CREDIT_AMOUNT_INVALID, 400)
  assert.strictEqual(CREDIT_ERROR_STATUS.CREDIT_PERIOD_INVALID, 400)
  assert.strictEqual(CREDIT_ERROR_STATUS.CREDIT_AUTH_INVALID, 403)
  assert.strictEqual(CREDIT_ERROR_STATUS.CREDIT_BALANCE_EXHAUSTED, 409)
  assert.strictEqual(CREDIT_ERROR_STATUS.CREDIT_SERVICE_UNAVAILABLE, 503)
})

// ── ② 端点 HTTP 行为 ────────────────────────────────────────────────────

test('端点：M2M 服务凭据 + 合法入参 ⇒ 200 且响应体是 account/entry/duplicated', async () => {
  const creditRepository = createCreditRepositoryStub()
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository,
  }, async (port) => {
    const res = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', VALID_BODY)
    assert.strictEqual(res.status, 200, JSON.stringify(res.body))
    assert.strictEqual(res.body.duplicated, false)
    assert.strictEqual(res.body.account.balance, 88)
    assert.strictEqual(res.body.entry.amount, 12)
    assert.strictEqual(creditRepository.calls.length, 1)
    // 端点内解析 authSubject → identity_users.id ⇒ 传给仓储的是**内部 id**，不是 sub
    assert.strictEqual(creditRepository.calls[0].userId, 'identity-user-1')
    assert.strictEqual(creditRepository.calls[0].refType, CREDIT_REF_TYPE)
    assert.strictEqual(creditRepository.calls[0].refId, 'evt-1')
  })
})

test('端点：api_key 身份被拒（防越权扣任意用户积分）⇒ 403 CREDIT_AUTH_INVALID', async () => {
  const creditRepository = createCreditRepositoryStub()
  await withServer({
    dryRun: true,
    apiKey: 'static-master-key',
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository,
  }, async (port) => {
    const res = await request(port, 'POST', '/api/v1/credit/consume', 'static-master-key', VALID_BODY)
    assert.strictEqual(res.status, 403, JSON.stringify(res.body))
    assert.strictEqual(res.body.error, 'CREDIT_AUTH_INVALID')
    assert.strictEqual(creditRepository.calls.length, 0, '被拒的请求不得触达仓储')
  })
})

test('端点：未装配积分仓储 ⇒ 503 CREDIT_SERVICE_UNAVAILABLE（fail-closed）', async () => {
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
  }, async (port) => {
    const res = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', VALID_BODY)
    assert.strictEqual(res.status, 503, JSON.stringify(res.body))
    assert.strictEqual(res.body.error, 'CREDIT_SERVICE_UNAVAILABLE')
  })
})

test('端点：入参非法 ⇒ 400 且错误码对应（且不得触达仓储）', async () => {
  const creditRepository = createCreditRepositoryStub()
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository,
  }, async (port) => {
    const badRef = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', { ...VALID_BODY, refId: '' })
    assert.strictEqual(badRef.status, 400)
    assert.strictEqual(badRef.body.error, 'CREDIT_REF_INVALID')

    const badAmount = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', { ...VALID_BODY, amount: 0 })
    assert.strictEqual(badAmount.status, 400)
    assert.strictEqual(badAmount.body.error, 'CREDIT_AMOUNT_INVALID')

    const badPeriod = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', {
      ...VALID_BODY, periodEnd: '2026-09-01T00:00:00.000Z',
    })
    assert.strictEqual(badPeriod.status, 400)
    assert.strictEqual(badPeriod.body.error, 'CREDIT_PERIOD_INVALID')

    assert.strictEqual(creditRepository.calls.length, 0, '入参非法的请求不得触达仓储')
  })
})

test('端点：目标用户解析不到 ⇒ 400 CREDIT_USER_INVALID', async () => {
  const creditRepository = createCreditRepositoryStub()
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository,
  }, async (port) => {
    const res = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', { ...VALID_BODY, authSubject: 'ghost-sub' })
    assert.strictEqual(res.status, 400, JSON.stringify(res.body))
    assert.strictEqual(res.body.error, 'CREDIT_USER_INVALID')
    assert.strictEqual(creditRepository.calls.length, 0)
  })
})

test('端点：余额不足 ⇒ 409 CREDIT_BALANCE_EXHAUSTED（挂起补扣的信号）', async () => {
  const creditRepository = createCreditRepositoryStub({
    throwError: Object.assign(new Error('积分余额不足'), { code: 'CREDIT_BALANCE_EXHAUSTED', status: 409 }),
  })
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository,
  }, async (port) => {
    const res = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', VALID_BODY)
    assert.strictEqual(res.status, 409, JSON.stringify(res.body))
    assert.strictEqual(res.body.error, 'CREDIT_BALANCE_EXHAUSTED')
  })
})

test('端点：幂等命中 ⇒ 200 且 duplicated=true', async () => {
  const creditRepository = createCreditRepositoryStub({ duplicated: true })
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository,
  }, async (port) => {
    const res = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', VALID_BODY)
    assert.strictEqual(res.status, 200, JSON.stringify(res.body))
    assert.strictEqual(res.body.duplicated, true)
  })
})

test('端点：扣分留审计（业务字段装在 details 里）', async () => {
  const creditRepository = createCreditRepositoryStub()
  const auditEntries = []
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository,
    auditLogFile: null,
  }, async (port, server) => {
    server._auditLog.log = async (data) => { auditEntries.push(data); return data }
    const res = await request(port, 'POST', '/api/v1/credit/consume', 'm2m-token', VALID_BODY)
    assert.strictEqual(res.status, 200, JSON.stringify(res.body))
    assert.strictEqual(auditEntries.length, 1, '扣分必须留痕')
    const entry = auditEntries[0]
    assert.strictEqual(entry.type, 'credit_consume')
    assert.strictEqual(entry.ownerSubject, 'user-sub')
    assert.strictEqual(entry.details.amount, 12)
    assert.strictEqual(entry.details.costCents, 34)
    assert.strictEqual(entry.details.refId, 'evt-1')
    assert.strictEqual(entry.details.callerSubject, 'm2m-sub')
  })
})

test('端点：非 POST 方法不被本端点处理（落通用 404）', async () => {
  await withServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepositoryStub(),
    creditRepository: createCreditRepositoryStub(),
  }, async (port) => {
    const res = await request(port, 'GET', '/api/v1/credit/consume', 'm2m-token')
    assert.strictEqual(res.status, 404, JSON.stringify(res.body))
  })
})

// ── ③ 仓储层：并发同 refId ⇒ 唯一索引冲突 ⇒ 幂等命中 ────────────────────

/**
 * 能模拟「并发同一 refId」与「并发同用户不同 refId」的假 pool：
 *  · `forceLookupMiss` = N ⇒ 前 N 次查重查询**强制未命中**（模拟 read-then-write 的竞态窗口）；
 *  · 同一 (refType, refId, 'spend') 第二次 INSERT ⇒ 抛 23505（DB 部分唯一索引）；
 *  · ROLLBACK ⇒ **只撤销本事务自己的改动**（逐条 undo 链）。
 *
 * ⚠️ 回滚模型必须按「本事务的改动」撤销，**不能**按「BEGIN 时的快照」回滚：
 *   后者会把**别的**并发事务已提交的扣减也一起还原 ⇒ 余额读数偏大 ⇒ 假红。
 *   （真库 READ COMMITTED 下：并发事务的 UPDATE 看到对方已提交的改动 ⇒ 自己扣不动 ⇒ 0 行。）
 */
function createConcurrentPool(initialBalance) {
  const state = { balance: initialBalance, entries: [], nextId: 1, forceLookupMiss: 0, customViolation: null }

  async function queryFor(client, text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim()
    if (sql === 'BEGIN') { if (client) client.undo = []; return { rows: [] } }
    if (sql === 'COMMIT') { if (client) client.undo = null; return { rows: [] } }
    if (sql === 'ROLLBACK') {
      if (client && client.undo) {
        for (const item of client.undo.reverse()) {
          if (item.type === 'balance') state.balance = item.prev
          else if (item.type === 'entry') {
            const at = state.entries.indexOf(item.entry)
            if (at !== -1) state.entries.splice(at, 1)
          }
        }
        client.undo = null
      }
      return { rows: [] }
    }
    if (sql.startsWith('SELECT id, amount, balance_after FROM identity_credit_ledger')) {
      if (state.forceLookupMiss > 0) { state.forceLookupMiss -= 1; return { rows: [] } }
      const hit = state.entries.find((e) => e.ref_type === params[0] && e.ref_id === params[1] && e.entry_type === 'spend')
      return { rows: hit ? [{ id: hit.id, amount: hit.amount, balance_after: hit.balance_after }] : [] }
    }
    if (sql.startsWith('SELECT balance, granted_total')) {
      return {
        rows: [{
          balance: state.balance,
          granted_total: 0,
          spent_total: 0,
          period_start: '2026-10-01T00:00:00.000Z',
          period_end: '2026-11-01T00:00:00.000Z',
        }],
      }
    }
    if (sql.startsWith('UPDATE identity_credit_accounts')) {
      const amount = Number(params[1])
      if (state.balance < amount) return { rows: [] }
      if (client) client.undo.push({ type: 'balance', prev: state.balance })
      state.balance -= amount
      return { rows: [{ balance: state.balance, granted_total: 0, spent_total: 0 }] }
    }
    if (sql.includes('INSERT INTO identity_credit_ledger')) {
      if (state.customViolation) {
        const error = new Error('duplicate key value violates unique constraint')
        error.code = state.customViolation.code
        error.constraint = state.customViolation.constraint
        throw error
      }
      const refType = params[5]
      const refId = params[6]
      const dup = state.entries.find((e) => e.ref_type === refType && e.ref_id === refId && e.entry_type === 'spend')
      if (dup) {
        const error = new Error('duplicate key value violates unique constraint')
        error.code = '23505'
        error.constraint = 'uq_identity_credit_ledger_spend'
        throw error
      }
      const entry = {
        id: state.nextId++,
        entry_type: params[1],
        amount: Number(params[2]),
        balance_after: Number(params[3]),
        ref_type: refType,
        ref_id: refId,
      }
      if (client) client.undo.push({ type: 'entry', entry })
      state.entries.push(entry)
      return { rows: [{ id: entry.id, entry_type: entry.entry_type, amount: entry.amount, balance_after: entry.balance_after }] }
    }
    return { rows: [] }
  }

  const pool = {
    state,
    async query(text, params = []) { return queryFor(null, text, params) },
    // 事务 client 各自维护 undo 链 ⇒ ROLLBACK 只撤销自己的改动
    async connect() {
      const client = { undo: null }
      return {
        async query(text, params = []) { return queryFor(client, text, params) },
        release() {},
      }
    },
  }
  return pool
}

test('仓储：并发同 refId ⇒ 唯一索引冲突被翻译成幂等命中，且余额只扣一次', async () => {
  const pool = createConcurrentPool(100)
  const repo = new PostgresCreditRepository({ pool })
  const payload = {
    userId: 'identity-user-1',
    amount: 10,
    costCents: 5,
    refType: 'usage_event',
    refId: 'evt-race',
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z',
  }

  const first = await repo.consumeCredit(payload)
  assert.strictEqual(first.duplicated, false)
  assert.strictEqual(pool.state.balance, 90)

  // 第二道请求的查重**被强制未命中**（模拟 read-then-write 的竞态窗口）
  // ⇒ 它会走到 INSERT ⇒ 撞 DB 唯一索引 ⇒ 23505
  pool.state.forceLookupMiss = 1
  const second = await repo.consumeCredit(payload)
  assert.strictEqual(second.duplicated, true, '23505 必须被翻译成幂等命中，而不是 500')
  assert.strictEqual(second.entry.id, first.entry.id, '应回读已入账的那条分录')
  assert.strictEqual(pool.state.balance, 90, '冲突方的余额扣减随事务回滚 ⇒ 只扣一次')
  assert.strictEqual(pool.state.entries.length, 1, '只应有一条分录')
})

test('仓储：非 spend 的唯一索引冲突不被吞成幂等命中（原样抛出）', async () => {
  const pool = createConcurrentPool(100)
  const repo = new PostgresCreditRepository({ pool })
  // 让 INSERT 撞的是**别的**唯一索引（grant 那条）⇒ 不得被当成「这笔已扣过」
  pool.state.customViolation = { code: '23505', constraint: 'uq_identity_credit_ledger_grant' }
  await assert.rejects(
    () => repo.consumeCredit({
      userId: 'identity-user-1',
      amount: 10,
      costCents: 5,
      refType: 'usage_event',
      refId: 'evt-1',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
    }),
    (error) => error.code === '23505' && error.constraint === 'uq_identity_credit_ledger_grant',
  )
  assert.strictEqual(pool.state.entries.length, 0, '未入账就不得留下分录')
  assert.strictEqual(pool.state.balance, 100, '事务回滚 ⇒ 余额不变')
})

test('仓储：已有同 refId 的 spend 分录 + 撞的是别的索引 ⇒ 仍原样抛出（不得读成幂等命中）', async () => {
  // 这一格才真正区分「只认 spend 索引」与「任何 23505 都当幂等」两种实现：
  // 查重被强制未命中（模拟竞态窗口）⇒ 走到 INSERT ⇒ 撞 grant 索引（不是 spend 索引）
  // ⇒ 此时**账本里确实已有**那条 spend 分录 ⇒ 若实现放宽成「任何 23505 都当幂等」，
  //    回读就会命中它并返回 duplicated:true ⇒ 把别的错误伪装成幂等成功。
  const pool = createConcurrentPool(100)
  const repo = new PostgresCreditRepository({ pool })
  pool.state.entries.push({
    id: 7, entry_type: 'spend', amount: 10, balance_after: 90,
    ref_type: 'usage_event', ref_id: 'evt-1',
  })
  pool.state.forceLookupMiss = 1
  pool.state.customViolation = { code: '23505', constraint: 'uq_identity_credit_ledger_grant' }
  await assert.rejects(
    () => repo.consumeCredit({
      userId: 'identity-user-1',
      amount: 10,
      costCents: 5,
      refType: 'usage_event',
      refId: 'evt-1',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
    }),
    (error) => error.code === '23505' && error.constraint === 'uq_identity_credit_ledger_grant',
  )
  assert.strictEqual(pool.state.balance, 100, '事务回滚 ⇒ 余额不变')
})

test('仓储：并发同用户、不同 refId ⇒ 只允许一个成功（balance >= amount 的 CAS）', async () => {
  // 两笔**不同**幂等键的并发扣减，余额只够扣一笔 ⇒ 一个成功、一个 409
  // ⇒ 锁住的是「原子 CAS」这条语义（与「同 refId 幂等」是两条不同的不变量）
  const pool = createConcurrentPool(15)
  const repo = new PostgresCreditRepository({ pool })
  const base = {
    userId: 'identity-user-1',
    amount: 10,
    costCents: 5,
    refType: 'usage_event',
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z',
  }
  const results = await Promise.allSettled([
    repo.consumeCredit({ ...base, refId: 'evt-a' }),
    repo.consumeCredit({ ...base, refId: 'evt-b' }),
  ])
  const ok = results.filter((r) => r.status === 'fulfilled')
  const failed = results.filter((r) => r.status === 'rejected')
  assert.strictEqual(ok.length, 1, '只允许一个成功')
  assert.strictEqual(failed.length, 1, '另一个必须被拒')
  assert.strictEqual(failed[0].reason.code, 'CREDIT_BALANCE_EXHAUSTED')
  assert.strictEqual(pool.state.balance, 5, '余额不负，且只扣掉一笔')
  assert.strictEqual(pool.state.entries.length, 1, '只应有一条分录')
})

test('仓储：余额不足 ⇒ CREDIT_BALANCE_EXHAUSTED 且不写分录', async () => {
  const pool = createConcurrentPool(5)
  const repo = new PostgresCreditRepository({ pool })
  await assert.rejects(
    () => repo.consumeCredit({
      userId: 'identity-user-1',
      amount: 10,
      costCents: 5,
      refType: 'usage_event',
      refId: 'evt-poor',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
    }),
    (error) => error.code === 'CREDIT_BALANCE_EXHAUSTED' && error.status === 409,
  )
  assert.strictEqual(pool.state.entries.length, 0)
  assert.strictEqual(pool.state.balance, 5)
})
