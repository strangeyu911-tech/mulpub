// @ts-check
/**
 * 采集用账号解析 —— Vitest 单元测试
 *
 * 锁住三件事（2026-10-25，PR-1 第 2 刀）：
 *   1. 复用仓内既有「默认账号 → 凭证 → 分区 cookie 回退」链（不另发明第二份解析）；
 *   2. 「无账号」与「有账号但没有可用登录态」**都**判为 null（⇒ 上层零请求）；
 *   3. 解析抛错**不吞**（⇒ 上层落 error，而不是静默当成「无账号」跳过）。
 */
import { describe, it, expect, vi } from 'vitest'

const { resolveCollectAccount } = require('./collect-account')

describe('collect-account — 账号解析', () => {
  it('解析出账号且有 cookie ⇒ 返回 accountId + authData', async () => {
    const loader = vi.fn(async () => ({
      accountId: 'acct-7',
      authData: { cookies: [{ name: 'sid', value: 'x' }], localStorage: { k: 'v' } },
    }))
    const result = await resolveCollectAccount({}, 'douyin', loader)
    expect(result.accountId).toBe('acct-7')
    expect(result.authData.cookies).toHaveLength(1)
    expect(result.authData.localStorage).toEqual({ k: 'v' })
    expect(loader).toHaveBeenCalledWith({}, 'douyin', {}, undefined)
  })

  it('⛔ 没有账号（accountId 为空）⇒ null（⇒ 上层零请求、记 skipped）', async () => {
    const loader = vi.fn(async () => ({ accountId: null, authData: { cookies: [], localStorage: {} } }))
    expect(await resolveCollectAccount({}, 'douyin', loader)).toBeNull()
  })

  it('⛔ 有账号但既无 cookie 也无 localStorage ⇒ null（没有可用登录态，不拿它凑数）', async () => {
    const loader = vi.fn(async () => ({ accountId: 'acct-7', authData: { cookies: [], localStorage: {} } }))
    expect(await resolveCollectAccount({}, 'douyin', loader)).toBeNull()
  })

  it('只有 localStorage 也有登录态 ⇒ 仍算可用（不要求必须有 cookie）', async () => {
    const loader = vi.fn(async () => ({ accountId: 'acct-7', authData: { cookies: [], localStorage: { token: '1' } } }))
    const result = await resolveCollectAccount({}, 'douyin', loader)
    expect(result.accountId).toBe('acct-7')
  })

  it('⛔ 解析抛错 ⇒ 原样抛出（不得静默当成「无账号」跳过）', async () => {
    const loader = vi.fn(async () => { throw new Error('凭证文件读失败') })
    await expect(resolveCollectAccount({}, 'douyin', loader)).rejects.toThrow(/凭证文件读失败/)
  })

  it('返回形状异常（无 authData）⇒ 判为无登录态 ⇒ null', async () => {
    const loader = vi.fn(async () => ({ accountId: 'acct-7' }))
    expect(await resolveCollectAccount({}, 'douyin', loader)).toBeNull()
  })
})
