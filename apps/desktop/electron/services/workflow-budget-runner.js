// @ts-check
const { prepareRunBudget, recordRunBudget } = require('./workflow-budget')

/**
 * Runner 侧预算适配层：把「预检 + 登记」从 runner 主体挪出去，保持单文件行数。
 */
function prepareBudgetForRun ({ run, config, selectedCount, store, now, ledger, budgets }) {
  const prep = prepareRunBudget({
    budget: config.guardrails && config.guardrails.budget,
    itemCount: selectedCount,
    store,
    now,
    ledger,
    workflowId: run.workflowId,
  })
  if (!prep.ok) return { ok: false, reason: prep.reason }
  if (!prep.skipped) {
    budgets.set(run.id, { ledger: prep.ledger, cost: prep.cost })
    run.summary.budgetCost = prep.cost
  }
  return { ok: true }
}

function finishBudgetForRun (run, budgets) {
  const entry = budgets.get(run.id)
  if (!entry) return
  const recorded = recordRunBudget(entry, run.id, run.workflowId)
  if (!recorded.ok) run.warnings.push({ sourceType: 'budget', message: '预算台账写入失败：' + (recorded.reason || 'unknown') })
  budgets.delete(run.id)
}

module.exports = { prepareBudgetForRun, finishBudgetForRun }
