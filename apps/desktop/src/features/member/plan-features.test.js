// @ts-check
/**
 * plan-features.test.js — 功能开关判据（P1-1）
 */
import { describe, it, expect } from 'vitest'
import { hasFeature } from './plan-features'

describe('plan-features — hasFeature', () => {
  it('entitlement 缺失 → null（缺失即放行）', () => {
    expect(hasFeature(null, 'video_create')).toBeNull()
    expect(hasFeature(undefined, 'video_create')).toBeNull()
  })

  it('features 缺失/空数组 → null（旧快照兼容，不误拦付费用户）', () => {
    expect(hasFeature({ plan: 'free' }, 'video_create')).toBeNull()
    expect(hasFeature({ plan: 'free', features: [] }, 'video_create')).toBeNull()
  })

  it('免费档 features 不含 video_create → false', () => {
    expect(hasFeature({
      plan: 'free',
      features: ['cloud_publish', 'ai_write', 'official_credit'],
    }, 'video_create')).toBe(false)
  })

  it('标准/专业档 features 含 video_create → true', () => {
    expect(hasFeature({
      plan: 'standard',
      features: ['cloud_publish', 'ai_write', 'video_create'],
    }, 'video_create')).toBe(true)
  })

  it('只认精确 feature key，不做前缀/模糊匹配', () => {
    expect(hasFeature({ features: ['video_create_preview'] }, 'video_create')).toBe(false)
  })
})
