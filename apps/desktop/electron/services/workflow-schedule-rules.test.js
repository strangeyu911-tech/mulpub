// @ts-check
const { normalizeScheduleRules, validateScheduleRules, nextAllowedSlot, inQuietHours } = require('./workflow-schedule-rules')

describe('workflow-schedule-rules · 归一化与校验', () => {
  it('默认关闭、默认时区/工作日/静默时段', () => {
    const r = normalizeScheduleRules()
    expect(r.enabled).toBe(false)
    expect(r.timezone).toBe('Asia/Shanghai')
    expect(r.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(r.quietHours).toEqual({ start: '23:00', end: '07:00' })
  })

  it('去重排序工作日，非法时间不再静默回退而是交给校验', () => {
    const r = normalizeScheduleRules({ enabled: true, weekdays: [5, 1, 5, 9], quietHours: { start: '25:00', end: '07:00' } })
    expect(r.weekdays).toEqual([1, 5])
    expect(r.quietHours.start).toBe('25:00')
    expect(validateScheduleRules(r).some((e) => e.reason === 'invalidTime')).toBe(true)
  })

  it('启用后拒绝非法时区/空工作日/相同静默起止', () => {
    const bad = normalizeScheduleRules({ enabled: true, timezone: 'Not/AZone', weekdays: [], quietHours: { start: '07:00', end: '07:00' } })
    const errors = validateScheduleRules(bad)
    expect(errors.map((e) => e.field)).toEqual(expect.arrayContaining([
      'scheduleRules.timezone', 'scheduleRules.weekdays', 'scheduleRules.quietHours',
    ]))
  })
})

describe('workflow-schedule-rules · 静默/工作日顺延', () => {
  it('跨午夜静默：23:30 顺延到次日 07:00', () => {
    const rules = normalizeScheduleRules({ enabled: true, timezone: 'UTC', weekdays: [1, 2], quietHours: { start: '23:00', end: '07:00' } })
    const candidate = Date.UTC(2026, 9, 26, 23, 30)
    expect(new Date(nextAllowedSlot(candidate, rules)).toISOString()).toBe('2026-10-27T07:00:00.000Z')
  })

  it('周末顺延到周一 00:00（静默关闭）', () => {
    const rules = normalizeScheduleRules({ enabled: true, timezone: 'UTC', weekdays: [1], quietHours: { start: '23:00', end: '23:01' } })
    const candidate = Date.UTC(2026, 9, 31, 12, 0) // 2026-10-31 Saturday
    expect(new Date(nextAllowedSlot(candidate, rules)).toISOString()).toBe('2026-11-02T00:00:00.000Z')
  })

  it('未启用时原样返回；inQuietHours 跨午夜判断正确', () => {
    const candidate = Date.UTC(2026, 9, 26, 23, 30)
    expect(nextAllowedSlot(candidate, normalizeScheduleRules())).toBe(candidate)
    expect(inQuietHours(23 * 60 + 30, { start: '23:00', end: '07:00' })).toBe(true)
    expect(inQuietHours(6 * 60 + 59, { start: '23:00', end: '07:00' })).toBe(true)
    expect(inQuietHours(7 * 60, { start: '23:00', end: '07:00' })).toBe(false)
    expect(inQuietHours(12 * 60, { start: '23:00', end: '07:00' })).toBe(false)
  })
})
