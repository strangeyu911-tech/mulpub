// @ts-check
import { describe, it, expect } from 'vitest'
import {
  readMaxScheduledTasks,
  countActiveScheduledTasks,
  scheduleLimitState,
} from './schedule-quota'

describe('schedule-quota — 定时任务数量判据', () => {
  it('读取 0 / 100 / -1；缺失或非法返回 null', () => {
    expect(readMaxScheduledTasks({ limits: { max_scheduled_tasks: 0 } })).toBe(0)
    expect(readMaxScheduledTasks({ limits: { max_scheduled_tasks: '100' } })).toBe(100)
    expect(readMaxScheduledTasks({ limits: { max_scheduled_tasks: -1 } })).toBe(-1)
    expect(readMaxScheduledTasks(null)).toBeNull()
    expect(readMaxScheduledTasks({ limits: { max_scheduled_tasks: '' } })).toBeNull()
    expect(readMaxScheduledTasks({ limits: { max_scheduled_tasks: 'many' } })).toBeNull()
  })

  it('只计 pending / submitted / dispatching；终态忽略', () => {
    expect(countActiveScheduledTasks([
      { status: 'pending' }, { status: 'submitted' }, { status: 'dispatching' },
      { status: 'executed' }, { status: 'failed' }, { status: 'cancelled' },
      {}, null,
    ])).toBe(4)
  })

  it('已排期批次计入同一个池', () => {
    expect(countActiveScheduledTasks(
      [{ status: 'submitted' }, { status: 'executed' }],
      [{ status: 'scheduled' }, { status: 'done' }, null],
    )).toBe(2)
  })

  it('0 是合法上限（第 1 个即触顶）；-1 不限', () => {
    expect(scheduleLimitState({ limits: { max_scheduled_tasks: 0 } }, [])).toEqual({ limit: 0, current: 0, atLimit: true })
    expect(scheduleLimitState({ limits: { max_scheduled_tasks: 100 } }, [{ status: 'pending' }])).toEqual({ limit: 100, current: 1, atLimit: false })
    expect(scheduleLimitState({ limits: { max_scheduled_tasks: -1 } }, [{ status: 'pending' }])).toEqual({ limit: null, current: 1, atLimit: false })
    expect(scheduleLimitState(null, [{ status: 'pending' }])).toEqual({ limit: null, current: 1, atLimit: false })
  })
})
