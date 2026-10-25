// @ts-check
/**
 * usage-dimensions.test.js — 官方算力成本归集用的「用量维度」提取。
 *
 * ⚠ 这条链的失败形态极隐蔽：抽不到维度 ⇒ 服务端 `cards.get(unit)` 恒 None
 *   ⇒ **成本恒为 0 且全量报「缺价格」** ⇒ 看起来像「免费」，不报任何错。
 * ⇒ 所以形状假设必须被逐条钉死。
 */
import { describe, it, expect } from 'vitest'

const { extractUsageDimensions } = require('./usage-dimensions')

describe('extractUsageDimensions — 权威来源优先', () => {
  it('官方 usage.total_seconds 优先于请求侧 duration', () => {
    const d = extractUsageDimensions({
      params: { duration: 5 },
      result: { usage: { total_seconds: 10 } },
    })
    expect(d.duration_seconds).toBe(10)
  })

  it('响应无 usage 时回落到请求侧 duration', () => {
    const d = extractUsageDimensions({ params: { duration: 8 }, result: {} })
    expect(d.duration_seconds).toBe(8)
  })

  it('抽不到就是 0（不猜、不填默认值）', () => {
    const d = extractUsageDimensions({ params: {}, result: {} })
    expect(d).toEqual({ spec: '', duration_seconds: 0, item_count: 0, char_count: 0 })
  })
})

describe('extractUsageDimensions — 三个维度各自的来源', () => {
  it('duration_seconds：兼容 result.duration / result.seconds', () => {
    expect(extractUsageDimensions({ result: { duration: 6 } }).duration_seconds).toBe(6)
    expect(extractUsageDimensions({ result: { seconds: 7 } }).duration_seconds).toBe(7)
  })

  it('item_count：优先显式计数，其次 images 数组长度', () => {
    expect(extractUsageDimensions({ result: { imageCount: 3 } }).item_count).toBe(3)
    expect(extractUsageDimensions({ result: { images: [1, 2] } }).item_count).toBe(2)
    expect(extractUsageDimensions({ params: { n: 4 } }).item_count).toBe(4)
  })

  it('char_count：usage.characters 优先，其次 TTS 请求侧文本长度', () => {
    expect(extractUsageDimensions({ result: { usage: { characters: 500 } } }).char_count).toBe(500)
    expect(extractUsageDimensions({ params: { text: '你好世界' } }).char_count).toBe(4)
  })

  it('spec：按 resolution / size / quality 的顺序取', () => {
    expect(extractUsageDimensions({ params: { resolution: '768p' } }).spec).toBe('768p')
    expect(extractUsageDimensions({ params: { size: '1024' } }).spec).toBe('1024')
    expect(extractUsageDimensions({ params: { quality: 'hd' } }).spec).toBe('hd')
  })
})

describe('extractUsageDimensions — 脏输入不许变成假数字', () => {
  it('0 / 负数 / NaN / 布尔 / 空串一律不计入', () => {
    const d = extractUsageDimensions({
      params: { duration: 0, n: -3, text: '' },
      result: { duration: NaN, count: true },
    })
    expect(d.duration_seconds).toBe(0)
    expect(d.item_count).toBe(0)
    expect(d.char_count).toBe(0)
  })

  it('小数向上取整成整秒（计费单位是秒，不能是 9.4 秒）', () => {
    expect(extractUsageDimensions({ result: { duration: 9.4 } }).duration_seconds).toBe(9)
    expect(extractUsageDimensions({ result: { duration: 9.6 } }).duration_seconds).toBe(10)
  })

  it('params / result 缺失或非对象时不抛', () => {
    expect(() => extractUsageDimensions(undefined)).not.toThrow()
    expect(() => extractUsageDimensions({ params: 'x', result: 42 })).not.toThrow()
    expect(extractUsageDimensions({ params: 'x', result: 42 })).toEqual({
      spec: '', duration_seconds: 0, item_count: 0, char_count: 0,
    })
  })
})
