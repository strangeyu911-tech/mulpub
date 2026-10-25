'use strict'

/**
 * 客户端 IP 取值 + 两套限流器的分桶/封顶契约。
 *
 * 覆盖三件事（都是第 3 轮红队 / 一致性审查查出的真问题）：
 *  1) **分桶键必须是真实客户端 IP**：按 socket 分桶时，生产拓扑（nginx → 127.0.0.1:3030、
 *     引擎只绑回环）下引擎看到的来源恒为 127.0.0.1 ⇒ **全站所有用户共用一个桶**。
 *     取 XFF **最右**元素（nginx 追加的真实 IP）。
 *  2) **桶数量必须封顶**：失败一次就新建一个桶 ⇒ 用海量不同 userId/IP 能撑爆进程内存。
 *  3) **迁移文件名不合规必须 fail-closed**：`1000_x.sql` 原先被**静默丢弃**（不执行也不报错）。
 */

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { clientIpFromRequest } = require('../src/client-ip')
const { RateLimiter } = require('../src/rate-limiter')
const { RedeemFailureLimiter } = require('../src/auth/redeem-rate-limit')
const { discoverMigrations, MigrationError } = require('../src/auth/postgres-migrations')
const { clampLogPagination } = require('../src/log-pagination')
const { TestPublishApiServer: PublishApiServer } = require('./test-publish-api-server')

function request (port, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('clientIpFromRequest：取 X-Forwarded-For 的**最右**元素（nginx 追加的真实 IP）', () => {
  assert.strictEqual(
    clientIpFromRequest({ headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.9' } }),
    '203.0.113.9'
  )
  // 客户端自带伪造 XFF 时，最右仍是 nginx 追加的那个 ⇒ 伪造甩不到别人头上
  assert.strictEqual(
    clientIpFromRequest({ headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' } }),
    '198.51.100.7'
  )
  // 空白要清掉
  assert.strictEqual(
    clientIpFromRequest({ headers: { 'x-forwarded-for': '  10.0.0.1 ,  203.0.113.9  ' } }),
    '203.0.113.9'
  )
})

test('clientIpFromRequest：没有 XFF 时回退到 socket；都没有时返回 null（不是 "unknown"）', () => {
  assert.strictEqual(clientIpFromRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1')
  assert.strictEqual(clientIpFromRequest({ headers: {} }), null)
  assert.strictEqual(clientIpFromRequest(null), null)
  // 取不到时不得凭空造一个 IP（会把所有请求并进同一个桶）
  assert.strictEqual(clientIpFromRequest({ headers: { 'x-forwarded-for': '   ' } }), null)
})

test('全局粗桶：按**真实客户端 IP** 分桶（不同 XFF 不共享额度）', async () => {
  const server = new PublishApiServer({ dryRun: true, maxRpm: 2 })
  await server.start(0)
  const port = server._server.address().port
  try {
    // 同一客户端：第 3 次被拦
    const a1 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '203.0.113.10' })
    const a2 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '203.0.113.10' })
    const a3 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '203.0.113.10' })
    assert.notStrictEqual(a1.status, 429, '第 1 次不该被限流')
    assert.notStrictEqual(a2.status, 429, '第 2 次不该被限流')
    assert.strictEqual(a3.status, 429, '同一客户端第 3 次应被限流（maxRpm=2）')

    // 另一个客户端：自己的桶（**不共享**）⇒ 这正是「全站共用一个桶」被修掉的证据
    const b1 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '203.0.113.20' })
    assert.notStrictEqual(b1.status, 429, '不同客户端不应共享同一个桶')
  } finally {
    await server.stop()
  }
})

test('全局粗桶：客户端键数封顶（大量不同 IP 不能撑爆内存）', () => {
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000, maxClients: 3 })
  try {
    for (let i = 0; i < 20; i++) limiter.check(`10.0.0.${i}`)
    assert.ok(
      limiter.clientCount() <= 3,
      `客户端键数必须封顶（实际 ${limiter.clientCount()}，上限 3）`
    )
  } finally {
    limiter.stop()
  }
})

test('兑换限流器：桶数量封顶（海量不同 userId 不能撑爆内存）', () => {
  const limiter = new RedeemFailureLimiter({ userMaxFailures: 5, maxBuckets: 3 })
  try {
    for (let i = 0; i < 20; i++) {
      limiter.acquire(`user-${i}`, `10.0.0.${i}`)
      limiter.recordFailure(`user-${i}`, `10.0.0.${i}`)
    }
    const counts = limiter.bucketCounts()
    assert.ok(counts.users <= 3, `用户桶数必须封顶（实际 ${counts.users}，上限 3）`)
    assert.ok(counts.ips <= 3, `IP 桶数必须封顶（实际 ${counts.ips}，上限 3）`)
  } finally {
    limiter.stop()
  }
})

test('迁移文件名不合规 ⇒ fail-closed 报错，不再静默丢弃', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-migration-name-'))
  try {
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'BEGIN;\nSELECT 1;\nCOMMIT;\n')
    assert.strictEqual(discoverMigrations(dir).length, 1, '合规文件必须被正常发现')

    // 编号超过三位 ⇒ 原实现会**静默丢弃**（不执行、不报错）⇒ 一条迁移被无声忽略
    fs.writeFileSync(path.join(dir, '1000_four_digits.sql'), 'BEGIN;\nSELECT 1;\nCOMMIT;\n')
    assert.throws(
      () => discoverMigrations(dir),
      (error) => error instanceof MigrationError && error.code === 'MIGRATION_FILE_NAME_INVALID',
      '编号超过三位的迁移文件必须报错（而不是被静默丢弃）'
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('审计列表：分页可读（?limit=&offset=），limit 夹到 [1,200]、offset 越界返回空数组', async () => {
  const server = new PublishApiServer({ dryRun: true })
  await server.start(0)
  const port = server._server.address().port
  try {
    for (let i = 0; i < 60; i++) {
      await server._auditLog.log({ type: 'publish', platform: 'zhihu', title: 'T' + i, status: 'success' })
    }
    const page1 = JSON.parse((await request(port, 'GET', '/api/v1/logs?limit=10&offset=0')).body)
    const page2 = JSON.parse((await request(port, 'GET', '/api/v1/logs?limit=10&offset=10')).body)
    assert.strictEqual(page1.logs.length, 10, '第 1 页必须能读到 10 条')
    assert.strictEqual(page2.logs.length, 10, '第 2 页必须能读到 10 条（此前第 51 条之后不可读）')
    const ids1 = page1.logs.map((e) => e.id)
    const ids2 = page2.logs.map((e) => e.id)
    assert.strictEqual(ids1.filter((id) => ids2.includes(id)).length, 0, '两页内容不得重叠')

    // limit 下界：0 / 负数 ⇒ 夹到 1（不是 0 条、也不是全部）
    const zero = JSON.parse((await request(port, 'GET', '/api/v1/logs?limit=0')).body)
    assert.strictEqual(zero.logs.length, 1, 'limit=0 必须夹到 1')
    // limit 上界：999 ⇒ 夹到 200
    const big = JSON.parse((await request(port, 'GET', '/api/v1/logs?limit=999')).body)
    assert.ok(big.logs.length <= 200, `limit 必须在 [1,200]（实际 ${big.logs.length}）`)
    // offset 越界 ⇒ 空数组（不是 500）
    const beyond = JSON.parse((await request(port, 'GET', '/api/v1/logs?offset=9999')).body)
    assert.strictEqual(beyond.logs.length, 0, 'offset 越界必须返回空数组')
    // stats 仍按全量（分页不影响统计口径）
    assert.ok(beyond.stats.total >= 60, 'stats.total 必须仍是全量')
  } finally {
    await server.stop()
  }
})

test('分页夹紧：越界的合法数字夹到边界（不是回落默认值），非法值才回落默认', () => {
  // 下界：0 / 负数 ⇒ 1（⚠️ 不能回落成默认 50 ⇒ 那样下界形同虚设）
  assert.deepStrictEqual(clampLogPagination({ limit: 0 }), { limit: 1, offset: 0 })
  assert.deepStrictEqual(clampLogPagination({ limit: -5 }), { limit: 1, offset: 0 })
  // 上界：999 ⇒ 200
  assert.deepStrictEqual(clampLogPagination({ limit: 999 }), { limit: 200, offset: 0 })
  // 缺省 / 非法 ⇒ 默认 50 / 0
  assert.deepStrictEqual(clampLogPagination({}), { limit: 50, offset: 0 })
  assert.deepStrictEqual(clampLogPagination({ limit: 'abc', offset: 'xyz' }), { limit: 50, offset: 0 })
  assert.deepStrictEqual(clampLogPagination(undefined), { limit: 50, offset: 0 })
  // offset 负数 ⇒ 0
  assert.deepStrictEqual(clampLogPagination({ offset: -3 }), { limit: 50, offset: 0 })
})

// ── 2026-10-25 独立复评补的 3 条锁（每条都对应一个真缺陷）────────────────

// F1（MAJOR）：粗桶的键在本 PR 之后 = **客户端完全可控的 XFF 最右元素**
// ⇒ 容器若是普通对象，`this._clients['__proto__']` 读到继承来的 `Object.prototype`
// ⇒ 判定「桶已存在」⇒ 拿到的却是 `timestamps` 为 undefined 的真身
// ⇒ `undefined.filter(...)` 抛 TypeError ⇒ `publish-api-server.js` 的
// `http.createServer(...)` 对 `_handle` **没有 .catch** ⇒ **引擎进程直接退出**
// ⇒ **一个请求头即可 DoS**。受影响键名不止 `__proto__`（constructor/toString/…）。
test('F1：原型污染型键名（__proto__ 等）必须是普通桶，**不得打崩进程**', () => {
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000, maxClients: 100 })
  try {
    for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      assert.strictEqual(limiter.check(key), true, `键 ${key} 第一次必须放行（不得抛）`)
      assert.strictEqual(limiter.check(key), true, `键 ${key} 第二次必须放行（未超上限）`)
      assert.strictEqual(limiter.check(key), false, `键 ${key} 第三次必须被限流（maxRequests=2）`)
    }
    // 这些键必须是**各自独立**的桶（不是共用一个）
    assert.ok(limiter.clientCount() >= 5, `每个键都应是独立桶（实际 ${limiter.clientCount()}）`)
  } finally {
    limiter.stop()
  }
})

test('F1：真实 HTTP 层——伪造 XFF 头不得打崩引擎（进程存活且仍有响应）', async () => {
  const server = new PublishApiServer({ dryRun: true, maxRpm: 100 })
  await server.start(0)
  const port = server._server.address().port
  try {
    const res = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '__proto__' })
    assert.ok(res.status < 500, `伪造 XFF 不得导致 5xx（实际 ${res.status}）`)
    // 引擎必须还活着（不是「进程退出后请求失败」）
    const after = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '203.0.113.30' })
    assert.ok(after.status < 500, `进程必须仍能响应后续请求（实际 ${after.status}）`)
  } finally {
    await server.stop()
  }
})

// F11（MINOR）：PRD §15.1 的核心口径是「取 XFF **最右**」，
// 但原用例每个请求只发**一个** IP ⇒ 最左 == 最右 ⇒ 变异成「取最左」也测不出来。
// ⇒ 这里发**多段** XFF，把口径钉在真实 HTTP 路径上。
test('F11：多段 XFF 时必须落在**最右**那个 IP 的桶上（不是最左）', async () => {
  const server = new PublishApiServer({ dryRun: true, maxRpm: 2 })
  await server.start(0)
  const port = server._server.address().port
  try {
    // 客户端自带伪造值在左端 + 真实 IP 在右端 ⇒ 必须按右端分桶
    const a1 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '1.2.3.4, 203.0.113.77' })
    const a2 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '1.2.3.4, 203.0.113.77' })
    const a3 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '1.2.3.4, 203.0.113.77' })
    assert.notStrictEqual(a1.status, 429, '第 1 次不该被限流')
    assert.notStrictEqual(a2.status, 429, '第 2 次不该被限流')
    assert.strictEqual(a3.status, 429, '同一真实 IP 第 3 次应被限流（maxRpm=2）')

    // 反证：另一个**左端**伪造值 + 同一个右端 ⇒ 仍落在同一个桶（按最左分桶就会是两个桶）
    const c1 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '9.9.9.9, 203.0.113.77' })
    assert.strictEqual(c1.status, 429, '按最左分桶的话这条会是新桶（200）；按最右才是同一桶（429）')

    // 反证：右端不同 ⇒ 另一个桶（不共享额度）
    const d1 = await request(port, 'GET', '/api/v1/plans', { 'x-forwarded-for': '1.2.3.4, 203.0.113.88' })
    assert.notStrictEqual(d1.status, 429, '右端不同 ⇒ 另一个桶（不应共享额度）')
  } finally {
    await server.stop()
  }
})

// F8（MINOR）：`?limit=`（空串）经 query 解析后是 `''`，而 `Number('') === 0`
// ⇒ 若直接用 `Number.isFinite` 判定，空串会被当成「合法的 0」⇒ 夹到下界 1
// ⇒ **返回 1 条而不是默认 50 条**，与 PRD §15.4 的「空 ⇒ 回落默认」不符。
test('F8：分页参数的空串算「没传」⇒ 回落默认（不是夹到下界 1）', () => {
  assert.deepStrictEqual(clampLogPagination({ limit: '' }), { limit: 50, offset: 0 })
  assert.deepStrictEqual(clampLogPagination({ limit: '   ' }), { limit: 50, offset: 0 })
  assert.deepStrictEqual(clampLogPagination({ offset: '' }), { limit: 50, offset: 0 })
  // 但「合法的 0」仍然夹到下界 1（空串与 0 是两回事）
  assert.deepStrictEqual(clampLogPagination({ limit: 0 }), { limit: 1, offset: 0 })
  assert.deepStrictEqual(clampLogPagination({ limit: '0' }), { limit: 1, offset: 0 })
  // 非整数 ⇒ 向下取整（limit 是「条数」）
  assert.deepStrictEqual(clampLogPagination({ limit: '2.5' }), { limit: 2, offset: 0 })
  assert.deepStrictEqual(clampLogPagination({ limit: 200.9 }), { limit: 200, offset: 0 })
})
