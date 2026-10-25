import { describe, it, expect } from 'vitest'

import {
  REDEEM_CODE_ALPHABET,
  REDEEM_CODE_DIGITS,
  REDEEM_CODE_MAX_LENGTH,
  REDEEM_CODE_PATTERN,
  normalizeRedeemInput,
} from './constants'
import zh from '@/locales/member-center/zh.js'
import en from '@/locales/member-center/en.js'

/**
 * 兑换码输入契约（PRD P0-1）。
 *
 * 锁三件事：
 *  1) **输入归一化**（自动大写 + 自动 4-4-4 分隔）—— 免得用户从聊天记录抄码时
 *     因为漏一个连字符 / 大小写被服务端打回「格式不正确」。
 *  2) **码型与服务端同型**（4-4-4、排除易混淆字符 I/L/O/0/1）。
 *  3) **文案不得再说「16 位」** —— 码是 12 个字符（4-4-4），旧文案写 16 位是错的。
 */
describe('member-center/兑换码输入契约', () => {
  it('归一化：自动大写 + 自动 4-4-4 分隔', () => {
    expect(normalizeRedeemInput('abcd')).toBe('ABCD')
    expect(normalizeRedeemInput('abcdefgh')).toBe('ABCD-EFGH')
    expect(normalizeRedeemInput('abcdefghjkmn')).toBe('ABCD-EFGH-JKMN')
    // 粘贴带横线 / 带空格都要吃下
    expect(normalizeRedeemInput('ABCD-EFGH-JKMN')).toBe('ABCD-EFGH-JKMN')
    expect(normalizeRedeemInput('abcd efgh jkmn')).toBe('ABCD-EFGH-JKMN')
  })

  it('归一化：超长输入截断到 12 位（不多发、不多显示）', () => {
    expect(normalizeRedeemInput('ABCDEFGHJKMNEXTRA')).toBe('ABCD-EFGH-JKMN')
  })

  it('归一化：易混淆字符 I/L/O/0/1 **不被悄悄替换**（要交给本地校验去拒并给可读原因）', () => {
    expect(normalizeRedeemInput('IBCD-EFGH-JKMN')).toBe('IBCD-EFGH-JKMN')
    expect(REDEEM_CODE_PATTERN.test(normalizeRedeemInput('IBCD-EFGH-JKMN'))).toBe(false)
    expect(normalizeRedeemInput('ABCD-EFGH-JKM1')).toBe('ABCD-EFGH-JKM1')
    expect(REDEEM_CODE_PATTERN.test(normalizeRedeemInput('ABCD-EFGH-JKM1'))).toBe(false)
  })

  it('字母表与服务端同型：显式排除 I/L/O/0/1', () => {
    expect(REDEEM_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789')
    for (const ch of ['I', 'L', 'O', '0', '1']) {
      expect(REDEEM_CODE_ALPHABET).not.toContain(ch)
    }
  })

  it('码型是 4-4-4：12 个字符 + 2 个连字符 = 14 位', () => {
    expect(REDEEM_CODE_DIGITS).toBe(12)
    expect(REDEEM_CODE_MAX_LENGTH).toBe(14)
    expect('ABCD-EFGH-JKMN'.length).toBe(REDEEM_CODE_MAX_LENGTH)
    expect(REDEEM_CODE_PATTERN.test('ABCD-EFGH-JKMN')).toBe(true)
    expect(REDEEM_CODE_PATTERN.test('ABCDEFGHJKMN')).toBe(false)
    expect(REDEEM_CODE_PATTERN.test('ABCD-EFGH-JKM')).toBe(false)
  })

  it('归一化输出：字符都在字母表里时，归一化结果**一定能**通过码型校验', () => {
    for (const raw of ['abcd-efgh-jkmn', 'ABCD EFGH JKMN', 'abcdefghjkmn']) {
      expect(REDEEM_CODE_PATTERN.test(normalizeRedeemInput(raw))).toBe(true)
    }
  })

  it('文案说的是 12 位（4-4-4 共 12 个字符），不是 16 位', () => {
    expect(zh.redeemHint).toContain('12 位')
    expect(zh.redeemHint).not.toContain('16 位')
    expect(en.redeemHint).toContain('12-character')
    expect(en.redeemHint).not.toContain('16-character')
  })
})
