// @ts-check
const { normalizeBudget, validateBudget, prepareRunBudget, createWorkflowBudget } = require('./workflow-budget')

function store () {
  const map = new Map()
  return { getSetting: (k) => (map.has(k) ? map.get(k) : null), setSetting: (k, v) => map.set(k, v) }
}

describe('workflow-budget · 配置与台账', () => {
  it('默认关闭；启用后 maxCost / estimatedCostPerItem 必须 >0', () => {
    expect(normalizeBudget().enabled).toBe(false)
    const bad = normalizeBudget({ enabled: true, maxCost: 0, estimatedCostPerItem: 0 })
    expect(validateBudget(bad).map((e) => e.field)).toEqual(expect.arrayContaining([
      'guardrails.budget.maxCost', 'guardrails.budget.estimatedCostPerItem',
    ]))
  })

  it('canSpend 按已记录估算累计；超预算拒绝', () => {
    const s = store()
    const b = createWorkflowBudget({ store: s, maxCost: 10, now: () => Date.parse('2026-10-27T00:00:00Z') })
    expect(b.canSpend(6).ok).toBe(true)
    expect(b.record({ runId: 'r1', workflowId: 'w1', cost: 6 }).ok).toBe(true)
    expect(b.summary()).toMatchObject({ maxCost: 10, spent: 6, entries: 1 })
    expect(b.canSpend(5)).toMatchObject({ ok: false, reason: 'budget-exceeded' })
    expect(b.canSpend(4).ok).toBe(true)
  })

  it('非法成本不落账', () => {
    const b = createWorkflowBudget({ store: store(), maxCost: 10 })
    expect(b.record({ runId: 'r1', cost: -1 })).toMatchObject({ ok: false, reason: 'cost-invalid' })
    expect(b.summary().entries).toBe(0)
  })

  it('不同 workflow 的预算互不占用', () => {
    const s = store()
    const w1 = createWorkflowBudget({ store: s, maxCost: 10, workflowId: 'w1' })
    const w2 = createWorkflowBudget({ store: s, maxCost: 10, workflowId: 'w2' })
    w1.record({ runId: 'r1', workflowId: 'w1', cost: 9 })
    expect(w2.canSpend(9).ok).toBe(true)
    expect(w1.canSpend(2)).toMatchObject({ ok: false, reason: 'budget-exceeded' })
  })

  it('store 缺失时预算检查 fail-closed 为 budget-unavailable', () => {
    expect(prepareRunBudget({
      budget: { enabled: true, maxCost: 10, currency: 'CNY', estimatedCostPerItem: 1 },
      itemCount: 1,
      store: null,
    })).toMatchObject({ ok: false, reason: 'budget-unavailable' })
  })
})
