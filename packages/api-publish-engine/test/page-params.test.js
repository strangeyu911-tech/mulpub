const { test } = require('node:test')
const assert = require('node:assert')

const { DEFAULT_LIMIT, MAX_LIMIT, pageParams } = require('../src/auth/page-params')

test('无 query → 默认 limit/offset', () => {
  assert.deepStrictEqual(pageParams({ url: '/api/v1/me/orders' }), { limit: DEFAULT_LIMIT, offset: 0 })
})

test('正常分页参数原样采纳', () => {
  assert.deepStrictEqual(pageParams({ url: '/api/v1/me/orders?limit=5&offset=10' }), { limit: 5, offset: 10 })
})

test('limit 超上限钳制到 MAX_LIMIT（不因越界 400）', () => {
  assert.deepStrictEqual(pageParams({ url: '/api/v1/me/orders?limit=999' }), { limit: MAX_LIMIT, offset: 0 })
})

test('limit 非正数/非数字回落默认值', () => {
  assert.strictEqual(pageParams({ url: '/api/v1/me/orders?limit=0' }).limit, DEFAULT_LIMIT)
  assert.strictEqual(pageParams({ url: '/api/v1/me/orders?limit=-3' }).limit, DEFAULT_LIMIT)
  assert.strictEqual(pageParams({ url: '/api/v1/me/orders?limit=abc' }).limit, DEFAULT_LIMIT)
})

test('offset 负数/非数字落 0', () => {
  assert.strictEqual(pageParams({ url: '/api/v1/me/orders?offset=-5' }).offset, 0)
  assert.strictEqual(pageParams({ url: '/api/v1/me/orders?offset=xyz' }).offset, 0)
})

test('小数被拒（Number.isInteger 而非 parseInt 截断）', () => {
  assert.strictEqual(pageParams({ url: '/api/v1/me/orders?limit=5.5' }).limit, DEFAULT_LIMIT)
})

test('req 缺失/畸形 url 不抛错', () => {
  assert.deepStrictEqual(pageParams(undefined), { limit: DEFAULT_LIMIT, offset: 0 })
  assert.deepStrictEqual(pageParams({ url: '' }), { limit: DEFAULT_LIMIT, offset: 0 })
})
