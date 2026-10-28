// @ts-check
const PERFORMANCE_DEFAULTS = Object.freeze({
  enabled: false,
  windowDays: 7,
  minSamples: 3,
  minViews: 0,
  minEngagementRate: 0,
})
const PERFORMANCE_LIMITS = Object.freeze({ minWindowDays: 1, maxWindowDays: 90, maxSamples: 100, maxViews: 1000000000 })

function normalizePerformance (raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const windowDays = Number(p.windowDays)
  const minSamples = Number(p.minSamples)
  const minViews = Number(p.minViews)
  const minEngagementRate = Number(p.minEngagementRate)
  return {
    enabled: p.enabled === true,
    windowDays: Number.isInteger(windowDays) ? windowDays : PERFORMANCE_DEFAULTS.windowDays,
    minSamples: Number.isInteger(minSamples) ? minSamples : PERFORMANCE_DEFAULTS.minSamples,
    minViews: Number.isFinite(minViews) ? minViews : PERFORMANCE_DEFAULTS.minViews,
    minEngagementRate: Number.isFinite(minEngagementRate) ? minEngagementRate : PERFORMANCE_DEFAULTS.minEngagementRate,
  }
}

function validatePerformance (p) {
  const errors = []
  if (!p || p.enabled !== true) return errors
  if (!Number.isInteger(p.windowDays) || p.windowDays < PERFORMANCE_LIMITS.minWindowDays || p.windowDays > PERFORMANCE_LIMITS.maxWindowDays) {
    errors.push({ field: 'guardrails.performance.windowDays', reason: 'outOfRange', params: { min: PERFORMANCE_LIMITS.minWindowDays, max: PERFORMANCE_LIMITS.maxWindowDays } })
  }
  if (!Number.isInteger(p.minSamples) || p.minSamples < 1 || p.minSamples > PERFORMANCE_LIMITS.maxSamples) {
    errors.push({ field: 'guardrails.performance.minSamples', reason: 'outOfRange', params: { min: 1, max: PERFORMANCE_LIMITS.maxSamples } })
  }
  if (!Number.isFinite(p.minViews) || p.minViews < 0 || p.minViews > PERFORMANCE_LIMITS.maxViews) {
    errors.push({ field: 'guardrails.performance.minViews', reason: 'outOfRange', params: { min: 0, max: PERFORMANCE_LIMITS.maxViews } })
  }
  if (!Number.isFinite(p.minEngagementRate) || p.minEngagementRate < 0 || p.minEngagementRate > 1) {
    errors.push({ field: 'guardrails.performance.minEngagementRate', reason: 'outOfRange', params: { min: 0, max: 1 } })
  }
  return errors
}

module.exports = { PERFORMANCE_DEFAULTS, PERFORMANCE_LIMITS, normalizePerformance, validatePerformance }
