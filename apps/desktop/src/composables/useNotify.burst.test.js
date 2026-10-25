import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 阶段 4.6「连发限频」的**接线锁**：必须走真实消费者 useNotify，而不是只测 createBurstGuard。
// 动因是本仓反复出现的「注册≠注入≠生效」家族——判据函数单测全绿，但生产调用点一次都没接，
// 用户侧症状（N 条同质 toast 叠成遮挡）完全不变，而没有任何东西会因此变红。
//
// 夹具的关键一条（QM-6 外部评审 i3 更正过）：guard 挂在**每次 useNotify() 调用**上
// （实现见 useNotify.js 的 `const burstGuard = createBurstGuard()`；PRD §3.2 论证过为什么
// 刻意不做模块级全局 —— 全局预算会让无关组件的失败提示直接被吃掉）。
// 因此 freshNotify() 每次新建实例本身就已经拿到新 guard；下面的 vi.resetModules() + 动态 import
// 只是**无害的双保险**，不是隔离状态的唯一手段。本文件头注释的第一版把它写成"模块级单例"，
// 与实现和 PRD 正面矛盾 —— 那种矛盾会诱导下一个维护者把实现改成模块级，所以就地改正。
// 于是同一份测试文件里 5 个 it 会共享计数。若不做处理，第 1 个用例把窗口填满后，
// 其余用例测到的都是"已经限频了"的余温——那种红/绿与实现无关，是夹具串味。
// 正解：每个用例前 vi.resetModules() + 动态 import，让 useNotify 与其 guard 都重新诞生。
const mocks = vi.hoisted(() => ({
  elMessage: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  elMessageBox: { confirm: vi.fn() },
}))

vi.mock('element-plus', () => ({ ElMessage: mocks.elMessage, ElMessageBox: mocks.elMessageBox }))
vi.mock('@/api/electron-bridge', () => ({ invoke: vi.fn() }))

import { BURST_LIMIT } from '@/utils/notify-burst'

const totalShown = () =>
  [...Object.values(mocks.elMessage)].reduce((acc, fn) => acc + fn.mock.calls.length, 0)

async function freshNotify () {
  vi.resetModules()
  const { useNotify } = await import('./useNotify')
  const bridge = await import('@/api/electron-bridge')
  bridge.invoke.mockResolvedValue({ code: 0, data: true })
  return { n: useNotify(), invokeMock: bridge.invoke }
}

describe('useNotify — 连发限频接线', () => {
  let warn
  beforeEach(() => {
    vi.clearAllMocks()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  it('窗口内前 limit 条真的展示，超出后不再调用任何 ElMessage 方法', async () => {
    const { n } = await freshNotify()
    for (let i = 0; i < BURST_LIMIT; i++) {
      n.notify('key.' + i, { level: 'info', message: '批量失败提示 ' + i })
    }
    expect(totalShown()).toBe(BURST_LIMIT)

    n.notify('key.over', { level: 'error', message: '第 ' + (BURST_LIMIT + 1) + ' 条' })
    expect(totalShown(), '超限的那条不得再弹').toBe(BURST_LIMIT)
    expect(mocks.elMessage.error).not.toHaveBeenCalled()
  })

  it('抑制不等于丢事件：日志上报对每一条都发生，包括被抑制的', async () => {
    const { n, invokeMock } = await freshNotify()
    const total = BURST_LIMIT + 3
    for (let i = 0; i < total; i++) {
      n.notify('k' + i, { level: 'warning', message: '通知 ' + i })
    }
    expect(totalShown()).toBe(BURST_LIMIT)
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(total)
  })

  it('抑制必须出声（console.warn 带累计抑制数），不得静默吞掉', async () => {
    const { n } = await freshNotify()
    for (let i = 0; i <= BURST_LIMIT; i++) {
      n.notify('w' + i, { level: 'info', message: '消息 ' + i })
    }
    const lines = warn.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('burst-limit'))).toBe(true)
    expect(lines.some((l) => /suppressed [1-9]/.test(l))).toBe(true)
  })

  it('未超限时行为与改动前一致：文案照常展示且不误报抑制', async () => {
    const { n } = await freshNotify()
    n.notify('only.one', { level: 'success', message: '保存成功' })
    expect(mocks.elMessage.success).toHaveBeenCalledWith('保存成功')
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('burst-limit'))).toHaveLength(0)
  })

  it.each([
    ['src/composables/useBatchPublish.js'],
    ['src/composables/useProviderCrud.js'],
    ['src/views/Accounts.vue'],
  ])('批量调用点 %s 每文件恰好一次 useNotify()（QM-6 i2：核心假设必须有锁，不能只写在 PRD 里）', async (rel) => {
    // 整套限频的前提是「循环里的 N 次 notify 共用同一个 guard」。若某个真实调用点在循环里
    // 每次新建 useNotify()（或经工具函数每消息取一次），每条消息都是全新 guard ⇒ limit 永不触发，
    // 用户侧叠屏症状原样保留而**任何测试都不会红** —— 正是 PRD 自己点名要防的「注册≠注入≠生效」。
    // 这里用「每文件恰好一次」作可执行代理：它是**必要条件不是充分条件**，该边界在 PRD §3.2 写明。
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../' + rel), 'utf8')
    const calls = src.match(/useNotify\(\)/g) || []
    expect(calls.length, rel + ' 里 useNotify() 的调用次数').toBe(1)
  })

  it('未知 level 不占窗口额度（QM-6 i4 指出的回归方向）', async () => {
    const { n } = await freshNotify()
    for (let i = 0; i < 30; i++) n.notify('weird' + i, { level: 'no-such-level', message: '怪 level ' + i })
    expect(totalShown()).toBe(0)
    n.notify('after', { level: 'error', message: '真实错误仍可展示' })
    expect(mocks.elMessage.error).toHaveBeenCalledWith('真实错误仍可展示')
  })

  it('空文案路径不受限频影响（守卫在限频之前，不得把"未命中 key"计进窗口）', async () => {
    const { n } = await freshNotify()
    expect(n.notify('no.such.key.at.all', { level: 'info' })).toBe('')
    expect(totalShown()).toBe(0)
  })
})
