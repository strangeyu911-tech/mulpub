'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SubscriptionService } = require('../src/auth/subscription-service')

test('SubscriptionService._grantCreditsForApplied：注入仓储时发积分，未注入时跳过', async () => {
  const calls = []
  const svc = Object.create(SubscriptionService.prototype)
  svc.creditRepository = { grantCredit: async (input) => { calls.push(input); return { duplicated: false } } }
  await svc._grantCreditsForApplied('u1', {
    plan: 'standard',
    periodStart: '2026-10-28T00:00:00.000Z',
    periodEnd: '2026-11-27T00:00:00.000Z',
    subscription: { id: 'sub-u1' },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].amount, 1500)
  assert.equal(calls[0].refType, 'subscription_period')

  const noRepo = Object.create(SubscriptionService.prototype)
  assert.equal(await noRepo._grantCreditsForApplied('u1', { plan: 'standard' }), null)

  const failing = Object.create(SubscriptionService.prototype)
  failing.creditRepository = { grantCredit: async () => { throw new Error('db down') } }
  const failed = await failing._grantCreditsForApplied('u1', {
    plan: 'standard', periodStart: '2026-10-28T00:00:00.000Z', periodEnd: '2026-11-27T00:00:00.000Z',
  })
  assert.equal(failed.granted, false)
  assert.equal(failed.reason, 'grant-failed')
})

test('SubscriptionService._grantFreeMonthlyCredits：免费档按自然月发 30，refId 月内幂等', async () => {
  const calls = []
  const svc = Object.create(SubscriptionService.prototype)
  svc.now = () => new Date('2026-10-28T10:00:00.000Z')
  svc.creditRepository = { grantCredit: async (input) => { calls.push(input); return {} } }
  await svc._grantFreeMonthlyCredits('u1')
  assert.equal(calls[0].amount, 30)
  assert.equal(calls[0].refType, 'subscription_period')
  assert.equal(calls[0].refId, 'subscription:sub-u1:2026-10-01T00:00:00.000Z')
})
