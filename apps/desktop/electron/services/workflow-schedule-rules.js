// @ts-check
/**
 * workflow-schedule-rules.js — 排期规则（静默时段 / 工作日 / 时区）
 *
 * 规则只在 enabled=true 时生效；默认关闭，避免升级后改变既有任务节奏。
 * 时间判断按 IANA 时区做，不依赖进程本地时区。
 */

const DEFAULT_SCHEDULE_RULES = Object.freeze({
  enabled: false,
  timezone: 'Asia/Shanghai',
  weekdays: Object.freeze([1, 2, 3, 4, 5]),
  quietHours: Object.freeze({ start: '23:00', end: '07:00' }),
})

const WEEKDAY_LABELS = Object.freeze(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
const formatterCache = new Map()

function isPlainObject (v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function normalizeScheduleRules (raw) {
  const r = isPlainObject(raw) ? raw : {}
  const weekdays = Array.isArray(r.weekdays)
    ? Array.from(new Set(r.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))).sort((a, b) => a - b)
    : DEFAULT_SCHEDULE_RULES.weekdays.slice()
  const quiet = isPlainObject(r.quietHours) ? r.quietHours : {}
  return {
    enabled: r.enabled === true,
    timezone: typeof r.timezone === 'string' && r.timezone.trim() ? r.timezone.trim() : DEFAULT_SCHEDULE_RULES.timezone,
    weekdays,
    quietHours: {
      start: normalizeTime(quiet.start, DEFAULT_SCHEDULE_RULES.quietHours.start),
      end: normalizeTime(quiet.end, DEFAULT_SCHEDULE_RULES.quietHours.end),
    },
  }
}

function normalizeTime (value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  return String(value)
}

function isValidTime (value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false
  const [h, m] = value.split(':').map(Number)
  return h <= 23 && m <= 59
}

function isValidTimezone (timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch (_) {
    return false
  }
}

function validateScheduleRules (rules) {
  const errors = []
  if (!rules.enabled) return errors
  if (!isValidTimezone(rules.timezone)) {
    errors.push({ field: 'scheduleRules.timezone', reason: 'invalid', params: { timezone: rules.timezone } })
  }
  if (rules.weekdays.length === 0) {
    errors.push({ field: 'scheduleRules.weekdays', reason: 'empty' })
  }
  if (rules.quietHours.start === rules.quietHours.end) {
    errors.push({ field: 'scheduleRules.quietHours', reason: 'sameTime' })
  }
  if (!isValidTime(rules.quietHours.start) || !isValidTime(rules.quietHours.end)) {
    errors.push({ field: 'scheduleRules.quietHours', reason: 'invalidTime' })
  }
  return errors
}

function localParts (timestamp, timezone) {
  let fmt = formatterCache.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    })
    if (formatterCache.size >= 50) formatterCache.clear()
    formatterCache.set(timezone, fmt)
  }
  const parts = {}
  for (const p of fmt.formatToParts(new Date(timestamp))) parts[p.type] = p.value
  const weekdayMap = {
    Mon: 1, Tuesday: 2, Tue: 2, Wednesday: 3, Wed: 3, Thursday: 4, Thu: 4,
    Friday: 5, Fri: 5, Saturday: 6, Sat: 6, Sunday: 7, Sun: 7, Monday: 1,
  }
  return {
    weekday: weekdayMap[parts.weekday] || 1,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

function inQuietHours (minutes, quiet) {
  const [sh, sm] = quiet.start.split(':').map(Number)
  const [eh, em] = quiet.end.split(':').map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  if (start === end) return false
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

/**
 * 把候选时刻顺延到下一个满足规则的分钟；最多找 14 天。
 * @param {number} candidateMs
 * @param {object} rules normalizeScheduleRules 的结果
 * @param {(ms:number)=>object} [partsFn] 测试注入
 */
function nextAllowedSlot (candidateMs, rules, partsFn) {
  if (!rules || rules.enabled !== true) return candidateMs
  const step = 60 * 1000
  const max = candidateMs + 14 * 24 * 60 * step
  const getParts = partsFn || ((ms) => localParts(ms, rules.timezone))
  for (let at = candidateMs; at <= max; at += step) {
    const p = getParts(at)
    if (!rules.weekdays.includes(p.weekday)) {
      at += (24 * 60 - p.minutes) * step - step
      continue
    }
    if (inQuietHours(p.minutes, rules.quietHours)) {
      const [sh, sm] = rules.quietHours.start.split(':').map(Number)
      const [eh, em] = rules.quietHours.end.split(':').map(Number)
      const start = sh * 60 + sm
      const end = eh * 60 + em
      const delta = start < end
        ? end - p.minutes
        : (p.minutes >= start ? 1440 - p.minutes + end : end - p.minutes)
      if (!Number.isFinite(delta) || delta <= 0) continue
      at += Math.max(1, delta) * step - step
      continue
    }
    return at
  }
  return null
}

module.exports = {
  DEFAULT_SCHEDULE_RULES,
  WEEKDAY_LABELS,
  normalizeScheduleRules,
  validateScheduleRules,
  nextAllowedSlot,
  inQuietHours,
  localParts,
  isValidTime,
}
