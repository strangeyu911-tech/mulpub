// @ts-check
import { describe, it, expect } from 'vitest'
import { readAutomationDailyItems, createWorkflowPlanLimit } from './workflow-plan-limit.js'

describe('workflow-plan-limit — 每日执行条数权益读取', () => {
  it('读取 0/50/500；缺失或非法返回 null', () => {
    expect(readAutomationDailyItems({ limits: { automation_daily_items: 0 } })).toBe(0)
    expect(readAutomationDailyItems({ limits: { automation_daily_items: '50' } })).toBe(50)
    expect(readAutomationDailyItems({ limits: { automation_daily_items: 500 } })).toBe(500)
    expect(readAutomationDailyItems({ limits: { automation_daily_items: -1 } })).toBeNull()
    expect(readAutomationDailyItems(null)).toBeNull()
    expect(readAutomationDailyItems({ limits: { automation_daily_items: '' } })).toBeNull()
    expect(readAutomationDailyItems({ limits: { automation_daily_items: 'many' } })).toBeNull()
  })

  it('provider 未注入时返回 null（不误拦旧快照）', () => {
    const reader = createWorkflowPlanLimit()
    expect(reader.planDailyLimit()).toBeNull()
  })

  it('provider 抛错/返回空时 fail-open', () => {
    const reader = createWorkflowPlanLimit()
    reader.setEntitlementProvider(() => { throw new Error('identity down') })
    expect(reader.planDailyLimit()).toBeNull()
    reader.setEntitlementProvider(() => null)
    expect(reader.planDailyLimit()).toBeNull()
  })
})
