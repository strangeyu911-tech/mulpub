/**
 * workflow-plan.test.js — 发布节奏与护栏的纯函数
 *
 * 主线：① 35-40 分钟是「按平台+账号」独立窗口，不是全局串行
 * ② 计划时间永远不落在过去 ③ 超限截断可解释 ④ 去重键稳定可复现
 */
const {
  createPacer,
  resolveTargetKey,
  checkGuardrails,
  buildDedupeKeys,
  estimatePlan,
} = require('./workflow-plan')

const NOW = Date.parse('2026-10-26T09:00:00.000Z')
const MIN = 35
const MAX = 40

function seq (values) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('workflow-plan · 节奏规划', () => {
  it('首条按起发时间，后续每条间隔落在 [min,max] 分钟内', () => {
    const pacer = createPacer({ startAtMs: NOW + 60 * 60 * 1000, minMinutes: MIN, maxMinutes: MAX, random: seq([0, 0.999, 0.5]) })
    const a = pacer.next('bilibili:acc-1', NOW)
    const b = pacer.next('bilibili:acc-1', NOW)
    const c = pacer.next('bilibili:acc-1', NOW)
    expect(a.atMs).toBe(NOW + 60 * 60 * 1000)
    expect((b.atMs - a.atMs) / 60000).toBe(35)
    expect((c.atMs - b.atMs) / 60000).toBe(40)
  })

  it('不同平台账号各自排队，互不占用间隔', () => {
    const pacer = createPacer({ startAtMs: NOW, minMinutes: MIN, maxMinutes: MAX, random: () => 0 })
    const a1 = pacer.next('bilibili:acc-1', NOW)
    const b1 = pacer.next('douyin:acc-2', NOW)
    expect(a1.atMs).toBe(NOW)
    expect(b1.atMs).toBe(NOW)
  })

  it('生成耗时超过计划时间时，排期顺延到当前时刻而不是过去', () => {
    const pacer = createPacer({ startAtMs: NOW, minMinutes: MIN, maxMinutes: MAX, random: () => 0 })
    pacer.next('k:1', NOW)
    const later = NOW + 3 * 60 * 60 * 1000
    const next = pacer.next('k:1', later)
    expect(next.atMs).toBeGreaterThanOrEqual(later)
  })

  it('非法间隔直接抛错（不静默夹取）', () => {
    expect(() => createPacer({ startAtMs: NOW, minMinutes: 40, maxMinutes: 35 })).toThrow()
    expect(() => createPacer({ startAtMs: NOW, minMinutes: 0, maxMinutes: 35 })).toThrow()
  })

  it('targetKey 对空账号回落为 default，平台与账号都可区分', () => {
    expect(resolveTargetKey({ platform: 'zhihu', accountId: '' })).toBe('zhihu:default')
    expect(resolveTargetKey({ platform: 'zhihu', accountId: 'a1' })).toBe('zhihu:a1')
    expect(resolveTargetKey({ platform: 'weibo', accountId: 'a1' })).toBe('weibo:a1')
  })
})

describe('workflow-plan · 护栏', () => {
  it('单次上限截断：10 条配置 5 条 → 只跑 5 条并说明原因', () => {
    const r = checkGuardrails({ itemCount: 10, guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20 }, usedToday: 0 })
    expect(r.allowed).toBe(5)
    expect(r.truncated).toBe(true)
    expect(r.reason).toBe('maxItemsPerRun')
  })

  it('每日额度剩余不足时按剩余放行', () => {
    const r = checkGuardrails({ itemCount: 10, guardrails: { maxItemsPerRun: 20, dailyItemLimit: 20 }, usedToday: 18 })
    expect(r.allowed).toBe(2)
    expect(r.truncated).toBe(true)
    expect(r.reason).toBe('dailyItemLimit')
  })

  it('每日额度用尽 → allowed=0 且不可静默继续', () => {
    const r = checkGuardrails({ itemCount: 3, guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20 }, usedToday: 20 })
    expect(r.allowed).toBe(0)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('dailyItemLimit')
  })
})

describe('workflow-plan · 去重键', () => {
  it('来源键优先平台+内容 id，其次 url，最后标题', () => {
    expect(buildDedupeKeys({ sourceType: 'zhihuFavlist', platform: 'zhihu', externalId: '123', url: 'https://x', title: 't' }).sourceKey)
      .toBe('zhihuFavlist:zhihu:123')
    expect(buildDedupeKeys({ sourceType: 'hotTopics', url: 'https://x', title: 't' }).sourceKey)
      .toBe('hotTopics:url:https://x')
    expect(buildDedupeKeys({ sourceType: 'hotTopics', title: '标题' }).sourceKey)
      .toBe('hotTopics:title:标题')
  })

  it('内容指纹对空白与标签差异不敏感，对正文差异敏感', () => {
    const a = buildDedupeKeys({ sourceType: 'hotTopics', title: ' 标题 ', content: '<p>正文  内容</p>' })
    const b = buildDedupeKeys({ sourceType: 'hotTopics', title: '标题', content: '正文 内容' })
    const c = buildDedupeKeys({ sourceType: 'hotTopics', title: '标题', content: '正文 内容（改）' })
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).not.toBe(c.fingerprint)
  })
})

describe('workflow-plan · 计划预览', () => {
  it('2 个目标 × 3 条 → 每个目标 3 个排期，首条同一时刻', () => {
    const now = NOW
    const plan = estimatePlan({
      config: {
        publish: { targets: [{ platform: 'bilibili', accountId: 'a' }, { platform: 'zhihu', accountId: 'b' }] },
        cadence: { minMinutes: 35, maxMinutes: 40 },
      },
      itemCount: 3,
      now,
      random: () => 0,
    })
    expect(plan.slotsByTarget['bilibili:a']).toHaveLength(3)
    expect(plan.slotsByTarget['zhihu:b']).toHaveLength(3)
    expect(plan.slotsByTarget['bilibili:a'][0]).toBe(now)
    expect((plan.slotsByTarget['bilibili:a'][2] - plan.slotsByTarget['bilibili:a'][1]) / 60000).toBe(35)
    expect(plan.totalMinutes).toBe(70)
  })
})
