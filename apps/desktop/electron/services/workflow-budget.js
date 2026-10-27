// @ts-check
/**
 * workflow-budget.js — 工作流预算护栏与估算台账
 *
 * 口径必须诚实：这里记的是**按配置的每项预估算出的预算占用**，不是供应商账单。
 * 没有真实 usage 时不得把估算写成「实际花费」。
 */

const KEY = 'workflow_budget_ledger'
const MAX_ENTRIES = 2000
const TTL_DAYS = 180

function isPlainObject (v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function normalizeBudget (raw) {
  const b = isPlainObject(raw) ? raw : {}
  const maxCost = Number(b.maxCost)
  const estimatedCostPerItem = Number(b.estimatedCostPerItem)
  return {
    enabled: b.enabled === true,
    maxCost: Number.isFinite(maxCost) && maxCost >= 0 ? maxCost : 0,
    currency: b.currency === 'USD' ? 'USD' : 'CNY',
    estimatedCostPerItem: Number.isFinite(estimatedCostPerItem) && estimatedCostPerItem >= 0 ? estimatedCostPerItem : 0,
  }
}

function validateBudget (budget) {
  const errors = []
  if (!budget.enabled) return errors
  if (!(budget.maxCost > 0)) errors.push({ field: 'guardrails.budget.maxCost', reason: 'outOfRange', params: { min: 0.01 } })
  if (!(budget.estimatedCostPerItem > 0)) errors.push({ field: 'guardrails.budget.estimatedCostPerItem', reason: 'outOfRange', params: { min: 0.01 } })
  return errors
}

function parse (raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && typeof e === 'object').map((e) => ({
        runId: String(e.runId || ''),
        workflowId: String(e.workflowId || ''),
        cost: Number(e.cost) || 0,
        estimated: e.estimated !== false,
        currency: e.currency === 'USD' ? 'USD' : 'CNY',
        createdAt: String(e.createdAt || ''),
      }))
      : []
  } catch (_) {
    return []
  }
}

function prepareRunBudget ({ budget, itemCount, store, now, ledger, workflowId }) {
  if (!budget || budget.enabled !== true) return { ok: true, skipped: true }
  if (Math.max(0, Number(itemCount) || 0) === 0) return { ok: true, skipped: true }
  if (!ledger && (!store || typeof store.getSetting !== 'function')) return { ok: false, reason: 'budget-unavailable' }
  const instance = ledger || createWorkflowBudget({ store, now, maxCost: budget.maxCost, currency: budget.currency, workflowId })
  const estimatedCost = Math.round(Math.max(0, itemCount) * budget.estimatedCostPerItem * 100) / 100
  const can = instance.canSpend(estimatedCost)
  if (!can.ok) return { ok: false, reason: can.reason === 'budget-exceeded' ? 'budget-exceeded' : (can.reason || 'budget-check-failed') }
  return { ok: true, ledger: instance, cost: estimatedCost }
}

function createWorkflowBudget (deps = {}) {  const store = deps.store
  const now = typeof deps.now === 'function' ? deps.now : Date.now
  const currency = deps.currency === 'USD' ? 'USD' : 'CNY'
  const maxCost = Math.max(0, Number(deps.maxCost) || 0)
  const workflowId = String(deps.workflowId || '')
  let entries = parse(store && store.getSetting(KEY))
  const cutoff = now() - TTL_DAYS * 24 * 60 * 60 * 1000
  entries = entries.filter((e) => {
    const t = Date.parse(e.createdAt)
    return Number.isFinite(t) ? t >= cutoff : false
  }).slice(-MAX_ENTRIES)

  function total () {
    return entries
      .filter((e) => !workflowId || e.workflowId === workflowId)
      .reduce((sum, e) => sum + (Number(e.cost) || 0), 0)
  }

  function summary () {
    return { currency, maxCost, spent: Math.round(total() * 100) / 100, entries: entries.length }
  }

  function canSpend (amount) {
    const cost = Math.max(0, Number(amount) || 0)
    if (!(cost > 0)) return { ok: false, reason: 'cost-invalid' }
    const remaining = Math.max(0, maxCost - total())
    return remaining >= cost
      ? { ok: true, remaining, cost }
      : { ok: false, reason: 'budget-exceeded', remaining, cost }
  }

  function record ({ runId, workflowId, cost, estimated = true }) {
    const value = Number(cost)
    if (!Number.isFinite(value) || value < 0) return { ok: false, reason: 'cost-invalid' }
    entries.push({ runId: String(runId || ''), workflowId: String(workflowId || ''), cost: value, estimated: estimated !== false, currency, createdAt: new Date(now()).toISOString() })
    entries = entries.slice(-MAX_ENTRIES)
    try {
      store.setSetting(KEY, JSON.stringify(entries))
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: 'persist-failed', message: e && e.message ? e.message : String(e) }
    }
  }

  return { summary, canSpend, record, total }
}

function recordRunBudget (entry, runId, workflowId) {
  if (!entry) return { ok: true, skipped: true }
  return entry.ledger.record({ runId, workflowId, cost: entry.cost })
}

module.exports = { KEY, normalizeBudget, validateBudget, prepareRunBudget, recordRunBudget, createWorkflowBudget }
