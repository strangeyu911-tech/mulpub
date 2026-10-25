import { describe, it, expect } from 'vitest'
import {
  toCodePoints, codePointLength, truncate, truncateWithin, hasDanglingSurrogate,
} from '../text-length'

// 阶段 4.7 ①「展示口径统一为 Unicode 码点」的判据锁（CJS 侧；ESM 孪生由
// text-length-parity.test.js 逐向量对账）。跑法：cd packages/shared-utils && pnpm test
// 关键纪律：断言必须打在**码点/码元差异真的会分岔**的输入上。只测纯 ASCII 的夹具
// 对"把代理对切成半片"这类缺陷结构性免疫 —— 与「toContain 对整篇压成一行免疫」是同一种失明。

describe('codePointLength：按码点计，不是 UTF-16 码元', () => {
  it('逐形态给值，并先用 .length 自证夹具确实有差异', () => {
    expect(codePointLength('')).toBe(0)
    expect(codePointLength('abc')).toBe(3)
    expect('🎉'.length).toBe(2)
    expect(codePointLength('🎉')).toBe(1)
    expect('🇯🇵'.length).toBe(4)
    expect(codePointLength('🇯🇵')).toBe(2)
    // 抖音好物分享=6 + 空格1 + 🎉 + 🎉 + 空格1 + 爆款2 = 12 码点（同一串的 .length 是 14，差在两个 emoji 各占 2 码元）
    expect('抖音好物分享 🎉🎉 爆款'.length).toBe(14)
    expect(codePointLength('抖音好物分享 🎉🎉 爆款')).toBe(12)
  })

  it('null/undefined 视作空串，非字符串先 String()', () => {
    expect(codePointLength(null)).toBe(0)
    expect(codePointLength(undefined)).toBe(0)
    expect(codePointLength(12345)).toBe(5)
  })

  it('toCodePoints 与 Array.from 同形，且是仓内唯一入口', () => {
    expect(toCodePoints('a🎉b')).toEqual(['a', '🎉', 'b'])
    expect(toCodePoints('')).toEqual([])
    expect(toCodePoints(null)).toEqual([])
  })
})

describe('截断不得留下孤立代理（旧写法的真缺陷现场）', () => {
  it('夹具自证：按码元切确实会切出孤立高位代理', () => {
    const s = 'a'.repeat(19) + '🎉尾巴'
    expect(hasDanglingSurrogate(s.slice(0, 20))).toBe(true)
  })

  it('新实现切点永远落在码点边界', () => {
    const s = 'a'.repeat(19) + '🎉尾巴'
    expect(hasDanglingSurrogate(truncate(s, 20, '...'))).toBe(false)
    const flag = '🇯🇵🇨🇳🇺🇸 三国旗'
    expect(hasDanglingSurrogate(flag.slice(0, 3))).toBe(true)
    expect(hasDanglingSurrogate(truncate(flag, 3, ''))).toBe(false)
  })

  it('hasDanglingSurrogate 分别抓出孤立高位与孤立低位代理，且成对的不算', () => {
    expect(hasDanglingSurrogate('\uD83C')).toBe(true)
    expect(hasDanglingSurrogate('a\uDFF9')).toBe(true)
    expect(hasDanglingSurrogate('🎉')).toBe(false)
    expect(hasDanglingSurrogate('')).toBe(false)
  })
})

describe('truncate 与 truncateWithin 的宽度合同不同，必须分开锁', () => {
  it('truncate：max 是**正文**码点数，省略号另加（与既有调用方逐字同形）', () => {
    expect(truncate('abcdef', 90, '...')).toBe('abcdef')
    expect(truncate('abcdefgh', 3, '...')).toBe('abc...')
    expect(truncate('abcdefgh', 3, '…')).toBe('abc…')
    expect(truncate('🎉🎉🎉🎉', 2, '')).toBe('🎉🎉')
    expect(codePointLength(truncate('🎉🎉🎉🎉', 2, '…'))).toBe(3)
  })

  it('truncateWithin：总宽（含省略号）不得超过 max', () => {
    expect(truncateWithin('abcdefgh', 5, '…')).toBe('abcd…')
    expect(codePointLength(truncateWithin('abcdefgh', 5, '…'))).toBe(5)
    expect(truncateWithin('abcde', 5, '…')).toBe('abcde')
  })

  it('反向锁：max 不大于省略号长度时只截断，不得产出比 max 更长的结果', () => {
    expect(truncateWithin('abcdef', 1, '…')).toBe('a')
    expect(codePointLength(truncateWithin('abcdef', 2, '...'))).toBe(2)
  })

  it('非法 max 一律收敛到 0（不抛错、不出现负数切片语义）', () => {
    expect(truncate('abcdef', NaN, '')).toBe('')
    expect(truncate('abcdef', -5, '')).toBe('')
    expect(truncate('abcdef', undefined, '…')).toBe('…')
    expect(truncate('abcdef', 2.9, '')).toBe('ab')
    expect(truncateWithin('abcdef', 'x', '…')).toBe('')
  })
})
