// @ts-check
/**
 * plan-limits.test.js — 档位 limits 客户端判定（v2.0 机制 C1.3 / C7 C 批；v3.1 主计量轴）
 *
 * 这组测试锁的是三条纪律：缺失即放行、-1 表示不限、非法值不产生比服务端更严的限制。
 * 它们全部是「反方向会静默拦死付费用户」的那类错误，因此在纯函数层钉死。
 */
import { describe, it, expect } from 'vitest'
import {
  UNLIMITED,
  readLimit,
  maxPlatformsOf,
  dailyPublishOf,
  batchSizePerRunOf,
  concurrentTasksOf,
  maxDevicesOf,
  maxCloudAccountsOf,
  maxAccountsOf,
  canAddPlatform,
  canAddAccount,
  canBatchSize,
  canPublishToday,
  platformLimitState,
  accountLimitState,
} from './plan-limits'

const FREE = {
  plan: 'free',
  limits: {
    max_platforms: -1, daily_publish: 5, concurrent_tasks: 1,
    max_devices: 1, max_accounts: 5, max_cloud_accounts: 0, batch_size_per_run: 1, model_tier: 0, plan_rank: 0,
  },
}
const STANDARD = {
  plan: 'standard',
  limits: {
    max_platforms: -1, daily_publish: 50, concurrent_tasks: 3,
    max_devices: 3, max_accounts: 20, max_cloud_accounts: 20, batch_size_per_run: 10, model_tier: 1, plan_rank: 1,
  },
}
const PRO = {
  plan: 'pro',
  limits: {
    max_platforms: -1, daily_publish: 1000, concurrent_tasks: 10,
    max_devices: -1, max_accounts: 100, max_cloud_accounts: 100, batch_size_per_run: -1, model_tier: 2, plan_rank: 2,
  },
}
// 平台数已不再是档位轴（v3.1），但判据本身仍要被测：用独立夹具锁旧语义。
const LEGACY_PLATFORM_LIMIT = { plan: 'legacy', limits: { max_platforms: 5 } }

describe('plan-limits — 读取', () => {
  it('按档位返回服务端下发的数值', () => {
    expect(maxPlatformsOf(FREE)).toBe(UNLIMITED)
    expect(maxPlatformsOf(STANDARD)).toBe(UNLIMITED)
    expect(maxPlatformsOf(PRO)).toBe(UNLIMITED)
    expect(dailyPublishOf(STANDARD)).toBe(50)
    expect(concurrentTasksOf(STANDARD)).toBe(3)
    expect(maxDevicesOf(FREE)).toBe(1)
    expect(maxAccountsOf(FREE)).toBe(5)
    expect(maxAccountsOf(STANDARD)).toBe(20)
    expect(maxAccountsOf(PRO)).toBe(100)
    expect(maxCloudAccountsOf(FREE)).toBe(0)
    expect(batchSizePerRunOf(STANDARD)).toBe(10)
  })

  it('entitlement / limits 缺失一律返回 null（缺失即放行，不推算出更严的限制）', () => {
    for (const input of [null, undefined, {}, { plan: 'free' }, { limits: null }, { limits: 'oops' }]) {
      expect(maxPlatformsOf(input)).toBeNull()
      expect(maxAccountsOf(input)).toBeNull()
      expect(canAddPlatform(input, 999)).toBe(true)
      expect(canAddAccount(input, 999)).toBe(true)
      expect(canBatchSize(input, 999)).toBe(true)
      expect(canPublishToday(input, 999)).toBe(true)
    }
  })

  it('非法值不参与判定：NaN / 非数字 / 空串按缺失处理', () => {
    const bad = { limits: { max_platforms: 'many', max_accounts: '', daily_publish: NaN, batch_size_per_run: '' } }
    expect(readLimit(bad.limits, 'max_platforms')).toBeNull()
    expect(readLimit(bad.limits, 'max_accounts')).toBeNull()
    expect(maxPlatformsOf(bad)).toBeNull()
    expect(maxAccountsOf(bad)).toBeNull()
    expect(dailyPublishOf(bad)).toBeNull()
    expect(canBatchSize(bad, 100)).toBe(true)
  })
})

describe('plan-limits — 绑定账号（v3.1 主计量轴）', () => {
  it('免费档第 6 个账号被拒绝，第 5 个仍允许', () => {
    expect(canAddAccount(FREE, 4)).toBe(true)
    expect(canAddAccount(FREE, 5)).toBe(false)
    expect(canAddAccount(FREE, 6)).toBe(false)
  })

  it('标准 20 / 专业 100 边界按闭区间判定', () => {
    expect(canAddAccount(STANDARD, 19)).toBe(true)
    expect(canAddAccount(STANDARD, 20)).toBe(false)
    expect(canAddAccount(PRO, 99)).toBe(true)
    expect(canAddAccount(PRO, 100)).toBe(false)
  })

  it('-1 表示不限；缺失/非法 currentCount 不得静默拦截', () => {
    const unlimited = { limits: { max_accounts: -1 } }
    expect(canAddAccount(unlimited, 999)).toBe(true)
    expect(canAddAccount(FREE, undefined)).toBe(true)
    expect(canAddAccount(FREE, NaN)).toBe(true)
    expect(canAddAccount(FREE, 'many')).toBe(true)
    // 数字字符串仍按数值判定（兼容 IPC/JSON 序列化）
    expect(canAddAccount(FREE, '5')).toBe(false)
    expect(canAddAccount(FREE, '4')).toBe(true)
  })

  it('accountLimitState 给出可填进 i18n 的参数', () => {
    expect(accountLimitState(FREE, 3)).toEqual({ limit: 5, current: 3, atLimit: false })
    expect(accountLimitState(FREE, 5)).toEqual({ limit: 5, current: 5, atLimit: true })
    expect(accountLimitState(PRO, 99)).toEqual({ limit: 100, current: 99, atLimit: false })
    expect(accountLimitState(null, 2)).toEqual({ limit: null, current: 2, atLimit: false })
    expect(accountLimitState({ limits: { max_accounts: -1 } }, 999)).toEqual({ limit: null, current: 999, atLimit: false })
  })
})

describe('plan-limits — 平台数（保留判据，不再作为档位轴）', () => {
  it('第 6 个平台被拒绝，第 5 个仍允许', () => {
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, 4)).toBe(true)
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, 5)).toBe(false)
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, 6)).toBe(false)
  })

  it('-1 表示不限（pro 永不拒绝）', () => {
    expect(canAddPlatform(PRO, 0)).toBe(true)
    expect(canAddPlatform(PRO, 999)).toBe(true)
  })

  it('selectedCount 非有限数时放行（undefined/NaN 不得变成「一律拦截」，CCG i7）', () => {
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, undefined)).toBe(true)
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, NaN)).toBe(true)
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, 'many')).toBe(true)
    // 数字字符串仍按数值判定（兼容 IPC/JSON 序列化）
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, '5')).toBe(false)
    expect(canAddPlatform(LEGACY_PLATFORM_LIMIT, '4')).toBe(true)
  })

  it('platformLimitState 给出可填进 i18n 的参数', () => {
    expect(platformLimitState(LEGACY_PLATFORM_LIMIT, 3)).toEqual({ limit: 5, selected: 3, atLimit: false })
    expect(platformLimitState(LEGACY_PLATFORM_LIMIT, 5)).toEqual({ limit: 5, selected: 5, atLimit: true })
    expect(platformLimitState(PRO, 99)).toEqual({ limit: null, selected: 99, atLimit: false })
    expect(platformLimitState(null, 2)).toEqual({ limit: null, selected: 2, atLimit: false })
  })
})

describe('plan-limits — 批量与日发', () => {
  it('单次批量条数按档位上限判定（免费档只能单篇）', () => {
    expect(canBatchSize(FREE, 1)).toBe(true)
    expect(canBatchSize(FREE, 2)).toBe(false)
    expect(canBatchSize(STANDARD, 10)).toBe(true)
    expect(canBatchSize(STANDARD, 11)).toBe(false)
    expect(canBatchSize(PRO, 500)).toBe(true)
  })

  it('日发布按「已发 + 本次」合计判定（边界为闭区间）', () => {
    expect(canPublishToday(FREE, 4, 1)).toBe(true)
    expect(canPublishToday(FREE, 5, 1)).toBe(false)
    expect(canPublishToday(FREE, 3, 2)).toBe(true)
    expect(canPublishToday(FREE, 4, 2)).toBe(false)
    expect(canPublishToday(PRO, 999, 1)).toBe(true)
    // pro 的日发是有限高值 1000（防除零），不是 -1 无限
    expect(canPublishToday(PRO, 1000, 1)).toBe(false)
  })
})
