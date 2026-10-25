import { describe, it, expect, vi } from 'vitest'
import { createBurstGuard, BURST_WINDOW_MS, BURST_LIMIT } from './notify-burst'

// 阶段 4.6「连发限频」的行为锁（审计原文经 2026-10-19 实测更正后收窄的两半之一）。
// 另一半「按类型分礼貌级」不在本批：实测 ElMessage 的根节点 role 恒为 "alert"
// （node_modules/element-plus/es/components/message/src/message.vue_…_lang.mjs:113），
// 且 message.d.ts 未暴露任何 role/aria 选项 ⇒ 在宿主 API 上做不到，而审计更正明文禁止
// 再叠第二个 live region。故本批只做可达的那一半，并把不可达的一半连证据一起写进记录。

function clockAt (start) {
  let t = start
  const now = () => t
  const advance = (ms) => { t += ms }
  return { now, advance }
}

describe('createBurstGuard：窗口内可见 toast 条数上限', () => {
  it('窗口内前 limit 条放行，第 limit+1 条被抑制', () => {
    const { now, advance } = clockAt(0)
    const g = createBurstGuard(now)
    for (let i = 0; i < BURST_LIMIT; i++) {
      advance(1)
      expect(g(`消息${i}`).allow, `第 ${i + 1} 条应放行`).toBe(true)
    }
    advance(1)
    const r = g('超限那条')
    expect(r.allow).toBe(false)
    expect(r.inWindow).toBe(BURST_LIMIT)
  })

  it('窗口滑过后重新获得额度（不是"永久熔断"）', () => {
    const { now, advance } = clockAt(1000)
    const g = createBurstGuard(now)
    for (let i = 0; i < BURST_LIMIT; i++) { advance(1); g('m' + i) }
    advance(BURST_WINDOW_MS) // 整窗滑出
    expect(g('窗口后再一条').allow).toBe(true)
  })

  it('抑制不占用额度：连续被抑制不会把窗口永久钉满', () => {
    const { now, advance } = clockAt(0)
    const g = createBurstGuard(now)
    for (let i = 0; i < BURST_LIMIT; i++) { advance(1); g('m' + i) }
    let last
    for (let i = 0; i < 50; i++) last = g('sup' + i)
    // 这条断言是让"被抑制也占额度"这一刀**红在本用例上**的关键（v1 只有后面的 advance+allow，
    // 而那 50 次抑制的时刻与最后一条已放行同刻，窗口滑过后会被一并弹出 ⇒ 变异从 allow 那格漏掉，
    // 只把"前 limit 条放行"用例的 inWindow 顶到 7 —— QM-6 外部评审 i1 判为 Critical，2026-10-25）。
    expect(last.inWindow, '被抑制的不得往窗口里塞时刻').toBe(BURST_LIMIT)
    expect(last.suppressedCount).toBe(50)
    advance(BURST_WINDOW_MS)
    expect(g('恢复后第一条').allow).toBe(true)
  })

  it('可注入 windowMs / limit（非法值回落默认，不静默变成 0 或 Infinity）', () => {
    const c = clockAt(0)
    const tight = createBurstGuard(c.now)
    // limit=2 ⇒ 第 1、2 条放行，第 3 条抑制（假时钟停在 0，窗口不会自己滑过）
    expect(tight({ windowMs: 500, limit: 2 }).allow).toBe(true)
    expect(tight({ windowMs: 500, limit: 2 }).allow).toBe(true)
    expect(tight({ windowMs: 500, limit: 2 }).allow).toBe(false)
    // 档位真的生效（不是恒等于默认）：把 limit 放宽到 3，同窗内第三条就该放行
    const wide = createBurstGuard(c.now)
    wide({ windowMs: 500, limit: 3 }); wide({ windowMs: 500, limit: 3 })
    expect(wide({ windowMs: 500, limit: 3 }).allow).toBe(true)
    expect(wide({ windowMs: 500, limit: 3 }).allow).toBe(false)

    // 非法档位必须出声并回落，而不是"limit=0 ⇒ 全抑制"或"NaN ⇒ 恒放行"
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const g2 = createBurstGuard(() => 0)
      expect(g2({ limit: 0 }).allow).toBe(true)
      expect(g2({ windowMs: -1 }).allow).toBe(true)
      expect(g2({ limit: 'many' }).allow).toBe(true)
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it('时钟回拨（NTP/休眠）不得把整窗清空从而绕过限频', () => {
    let t = 100000
    const g = createBurstGuard(() => t)
    for (let i = 0; i < BURST_LIMIT; i++) g('m' + i)
    t = 1000 // 回拨
    expect(g('回拨后一条').allow).toBe(false)
  })

  it('每个 guard 实例各自计数（不得用模块级全局状态跨页面/跨测试串味）', () => {
    const c = clockAt(0)
    const a = createBurstGuard(c.now)
    const b = createBurstGuard(c.now)
    for (let i = 0; i < BURST_LIMIT; i++) { c.advance(1); a('x' + i) }
    c.advance(1)
    expect(a('x').allow).toBe(false)
    expect(b('独立实例').allow).toBe(true)
  })

  it('返回形状稳定：始终含 allow 与 inWindow，被抑制时含 suppressedCount（供日志用，不供 UI 用）', () => {
    const c = clockAt(0)
    const g = createBurstGuard(c.now)
    for (let i = 0; i <= BURST_LIMIT; i++) { c.advance(1); g('m' + i) }
    const r = g('再来一条')
    expect(typeof r.allow).toBe('boolean')
    expect(typeof r.inWindow).toBe('number')
    expect(typeof r.suppressedCount).toBe('number')
    expect(r.suppressedCount).toBeGreaterThan(0)
  })
})

describe('判据常量的口径', () => {
  it('默认窗口与上限是正整数，且写在注释里的理由不得成为唯一出处（这里锁值域）', () => {
    expect(Number.isInteger(BURST_WINDOW_MS)).toBe(true)
    expect(BURST_WINDOW_MS).toBeGreaterThanOrEqual(1000)
    expect(BURST_WINDOW_MS).toBeLessThanOrEqual(10000)
    expect(Number.isInteger(BURST_LIMIT)).toBe(true)
    expect(BURST_LIMIT).toBeGreaterThanOrEqual(2)
    expect(BURST_LIMIT).toBeLessThanOrEqual(12)
  })
})
