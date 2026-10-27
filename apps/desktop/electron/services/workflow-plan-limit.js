// @ts-check
/**
 * workflow-plan-limit — 自动化每日执行条数的权益读取（P1-4）。
 * 独立成模块是为了不把 workflow-runner 推过 500 行门禁。
 */

function readAutomationDailyItems (entitlement) {
  const limits = entitlement && entitlement.limits
  const raw = limits ? limits.automation_daily_items : null
  if (raw === null || raw === undefined || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

function createWorkflowPlanLimit () {
  let entitlementProvider = null
  return {
    setEntitlementProvider (provider) {
      entitlementProvider = typeof provider === 'function' ? provider : null
    },
    planDailyLimit () {
      if (!entitlementProvider) return null
      let entitlement
      try { entitlement = entitlementProvider() } catch (_) { return null }
      return readAutomationDailyItems(entitlement)
    },
  }
}

module.exports = { readAutomationDailyItems, createWorkflowPlanLimit }
