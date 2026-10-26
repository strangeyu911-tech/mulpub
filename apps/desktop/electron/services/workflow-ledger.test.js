/**
 * workflow-ledger.test.js — 去重账本与每日额度计数
 *
 * 主线：① 双键任一命中即视为已发 ② 账本损坏时 fail-open 但不覆盖真源
 * ③ TTL / 条数上限有界 ④ 每日计数按本地日期
 */
const { createWorkflowLedger } = require('./workflow-ledger')

function fakeStore (initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getSetting: (k) => (map.has(k) ? map.get(k) : null),
    setSetting: (k, v) => { map.set(k, v) },
    _dump: () => Object.fromEntries(map.entries()),
  }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-26T10:00:00+08:00')

describe('workflow-ledger · 去重', () => {
  it('记录后按 sourceKey 或 fingerprint 任一命中都能查到', () => {
    const store = fakeStore()
    const ledger = createWorkflowLedger({ store, now: () => NOW })
    ledger.record({ sourceKey: 'zhihuFavlist:zhihu:1', fingerprint: 'fp-1', runId: 'r1', title: '标题' })

    expect(ledger.findSeen({ sourceKey: 'zhihuFavlist:zhihu:1', fingerprint: 'other' })).toMatchObject({ runId: 'r1' })
    expect(ledger.findSeen({ sourceKey: 'other', fingerprint: 'fp-1' })).toMatchObject({ runId: 'r1' })
    expect(ledger.findSeen({ sourceKey: 'other', fingerprint: 'fp-2' })).toBeNull()
  })

  it('持久化到 settings 后新实例仍能读到（重启不重复发）', () => {
    const store = fakeStore()
    const a = createWorkflowLedger({ store, now: () => NOW })
    a.record({ sourceKey: 's1', fingerprint: 'f1', runId: 'r1', title: 't' })
    const b = createWorkflowLedger({ store, now: () => NOW })
    expect(b.findSeen({ sourceKey: 's1', fingerprint: 'f1' })).not.toBeNull()
    expect(b.size()).toBe(1)
  })

  it('账本 JSON 损坏 → 返回空且下一次写入不静默覆盖原值', () => {
    const store = fakeStore({ workflow_dedupe_ledger: '{not-json' })
    const ledger = createWorkflowLedger({ store, now: () => NOW })
    expect(ledger.size()).toBe(0)
    const r = ledger.record({ sourceKey: 's1', fingerprint: 'f1', runId: 'r1' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ledger-unreadable')
    expect(store.getSetting('workflow_dedupe_ledger')).toBe('{not-json')
  })

  it('TTL 180 天：过期条目不参与去重，并在写入时被清理', () => {
    const old = new Date(NOW - 181 * DAY).toISOString()
    const store = fakeStore({
      workflow_dedupe_ledger: JSON.stringify([
        { sourceKey: 'old', fingerprint: 'old-fp', runId: 'r0', title: 'old', createdAt: old },
      ]),
    })
    const ledger = createWorkflowLedger({ store, now: () => NOW })
    expect(ledger.findSeen({ sourceKey: 'old', fingerprint: 'old-fp' })).toBeNull()
    ledger.record({ sourceKey: 'new', fingerprint: 'new-fp', runId: 'r1' })
    expect(ledger.size()).toBe(1)
  })

  it('条数上限：超过 maxEntries 时丢弃最旧记录', () => {
    const store = fakeStore()
    const ledger = createWorkflowLedger({ store, now: () => NOW, maxEntries: 3 })
    for (let i = 0; i < 5; i++) {
      ledger.record({ sourceKey: 's' + i, fingerprint: 'f' + i, runId: 'r' + i, createdAt: new Date(NOW + i).toISOString() })
    }
    expect(ledger.size()).toBe(3)
    expect(ledger.findSeen({ sourceKey: 's0', fingerprint: 'f0' })).toBeNull()
    expect(ledger.findSeen({ sourceKey: 's4', fingerprint: 'f4' })).not.toBeNull()
  })
})

describe('workflow-ledger · 每日额度', () => {
  it('只统计本地当天写入的条目', () => {
    const store = fakeStore()
    const ledger = createWorkflowLedger({ store, now: () => NOW })
    ledger.record({ sourceKey: 'yesterday', fingerprint: 'y', runId: 'r0', createdAt: new Date(NOW - DAY).toISOString() })
    ledger.record({ sourceKey: 'today-1', fingerprint: 'a', runId: 'r1', createdAt: new Date(NOW).toISOString() })
    ledger.record({ sourceKey: 'today-2', fingerprint: 'b', runId: 'r1', createdAt: new Date(NOW + 1000).toISOString() })
    expect(ledger.countToday()).toBe(2)
  })
})
