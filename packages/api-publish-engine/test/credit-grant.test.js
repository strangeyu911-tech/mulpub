'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { periodMonths, resolveGrantAmount, grantSubscriptionCredits } = require('../src/auth/credit-grant')

const START = '2026-10-28T00:00:00.000Z'

test('periodMonths：30/90/365 天 → 1/3/12 个月', () => {
  assert.equal(periodMonths(START, '2026-11-27T00:00:00.000Z'), 1)
  assert.equal(periodMonths(START, '2027-01-26T00:00:00.000Z'), 3)
  assert.equal(periodMonths(START, '2027-10-28T00:00:00.000Z'), 12)
})

test('resolveGrantAmount：标准月付 1500；年付 18000；专业年付 36000；免费月付 30', () => {
  assert.equal(resolveGrantAmount('standard', START, '2026-11-27T00:00:00.000Z'), 1500)
  assert.equal(resolveGrantAmount('standard', START, '2027-10-28T00:00:00.000Z'), 18000)
  assert.equal(resolveGrantAmount('pro', START, '2027-10-28T00:00:00.000Z'), 36000)
  assert.equal(resolveGrantAmount('free', START, '2026-11-27T00:00:00.000Z'), 30)
})

test('grantSubscriptionCredits：幂等 refId + 金额写入', async () => {
  const calls = []
  const repo = {
    grantCredit: async (input) => { calls.push(input); return { account: { balance: input.amount }, duplicated: false } },
  }
  const r = await grantSubscriptionCredits({
    creditRepository: repo,
    userId: 'u1',
    plan: 'standard',
    periodStart: START,
    periodEnd: '2026-11-27T00:00:00.000Z',
    subscriptionId: 'sub-u1',
  })
  assert.equal(r.granted, true)
  assert.equal(r.amount, 1500)
  assert.equal(calls[0].refType, 'subscription_period')
  assert.equal(calls[0].refId, 'subscription:sub-u1:2026-10-28T00:00:00.000Z')
})

test('grantSubscriptionCredits：仓储缺失/免费档不发放，不抛错', async () => {
  assert.deepEqual(
    await grantSubscriptionCredits({ userId: 'u1', plan: 'standard', periodStart: START, periodEnd: START }),
    { granted: false, amount: 0, reason: 'credit-repository-unavailable' },
  )
  const repo = { grantCredit: async () => ({}) }
  assert.equal((await grantSubscriptionCredits({
    creditRepository: repo, userId: 'u1', plan: 'enterprise', periodStart: START, periodEnd: '2026-11-27T00:00:00.000Z',
  })).reason, 'no-credit-quota')
  assert.equal((await grantSubscriptionCredits({
    creditRepository: repo, userId: 'u1', plan: 'standard', periodStart: '2026-11-27T00:00:00.000Z', periodEnd: START,
  })).reason, 'period-invalid')
})
