import { describe, expect, it } from 'vitest'

const { normalizeEditParamsArgs } = require('./tts-voice-clone')

/**
 * `normalizeEditParamsArgs` 的分支覆盖（change: hifly-voice-edit）。
 *
 * 为什么单测它：IPC handler 里这个函数是「修改已克隆音色参数」的**唯一入口闸**。
 * 它同时要管三件事——基础请求（providerId/model/voiceId）、三个参数的类型与范围、
 * 以及「至少给一项」。任何一条漏掉，落到的都是 registry 持久化面，
 * 而一条脏 params 会让下次读取把**整条音色**判非法（`isSafeCloneVoice` 对 params 有独立校验）
 * ——用户丢的是整个音色，不只是参数。
 *
 * 约定：返回 null = 拒绝，返回对象 = 接受并已归一（参数一律字符串）。
 */

const BASE = { providerId: 'hifly', model: 'hifly', voiceId: 'v_1' }

describe('normalizeEditParamsArgs — 拒绝路径', () => {
  it.each([null, undefined, [], 'x', 42])('非对象（%s）⇒ null', (bad) => {
    expect(normalizeEditParamsArgs(bad)).toBe(null)
  })

  // 未知字段必须拒：否则前端把 rate 写成 speed，会被静默丢掉，用户以为改成功了
  it('未知字段 ⇒ null', () => {
    expect(normalizeEditParamsArgs({ ...BASE, rate: '1.0', speed: '1.0' })).toBe(null)
  })

  // 一个参数都不给 = 空操作，不能当成功
  it('零参数 ⇒ null', () => {
    expect(normalizeEditParamsArgs(BASE)).toBe(null)
  })

  it('voiceId 缺失 / 形态非法 ⇒ null', () => {
    expect(normalizeEditParamsArgs({ providerId: 'hifly', model: 'hifly', rate: '1.0' })).toBe(null)
    expect(normalizeEditParamsArgs({ ...BASE, voiceId: 'bad id!', rate: '1.0' })).toBe(null)
    expect(normalizeEditParamsArgs({ ...BASE, voiceId: 'a'.repeat(257), rate: '1.0' })).toBe(null)
  })

  // 官方要字符串：数字会被服务端拒，存进 registry 也是脏数据
  it.each(['rate', 'volume', 'pitch'])('%s 传数字 ⇒ null', (key) => {
    expect(normalizeEditParamsArgs({ ...BASE, [key]: 1.0 })).toBe(null)
  })

  it.each(['rate', 'volume', 'pitch'])('%s 传空串 / 空白 ⇒ null', (key) => {
    expect(normalizeEditParamsArgs({ ...BASE, [key]: '' })).toBe(null)
    expect(normalizeEditParamsArgs({ ...BASE, [key]: '   ' })).toBe(null)
  })

  it.each(['rate', 'volume', 'pitch'])('%s 非数值 ⇒ null', (key) => {
    expect(normalizeEditParamsArgs({ ...BASE, [key]: 'abc' })).toBe(null)
    expect(normalizeEditParamsArgs({ ...BASE, [key]: 'NaN' })).toBe(null)
  })

  // 越界一档就拒，且**不做部分接受**：rate 合法但 pitch 越界 ⇒ 整体 null
  it.each([
    ['rate', '0.49'], ['rate', '2.01'],
    ['volume', '0.09'], ['volume', '2.1'],
    ['pitch', '0.09'], ['pitch', '2.1'],
  ])('%s=%s 越界 ⇒ null', (key, value) => {
    expect(normalizeEditParamsArgs({ ...BASE, [key]: value })).toBe(null)
  })

  it('一项合法一项越界 ⇒ 整体 null（不部分接受）', () => {
    expect(normalizeEditParamsArgs({ ...BASE, rate: '1.0', pitch: '9' })).toBe(null)
  })
})

describe('normalizeEditParamsArgs — 接受路径', () => {
  // 边界值本身合法
  it.each([
    ['rate', '0.5'], ['rate', '2.0'],
    ['volume', '0.1'], ['volume', '2.0'],
    ['pitch', '0.1'], ['pitch', '2.0'],
  ])('%s=%s 边界值合法', (key, value) => {
    expect(normalizeEditParamsArgs({ ...BASE, [key]: value })).toMatchObject({ [key]: value })
  })

  it('单参数合法（其余可选）', () => {
    expect(normalizeEditParamsArgs({ ...BASE, rate: '1.2' }))
      .toMatchObject({ voiceId: 'v_1', rate: '1.2' })
  })

  it('三项齐全 ⇒ params 齐全且保持字符串', () => {
    const r = normalizeEditParamsArgs({ ...BASE, rate: '0.8', volume: '1.5', pitch: '1.1' })
    expect(r).toMatchObject({ rate: '0.8', volume: '1.5', pitch: '1.1' })
  })

  // 前后空白要被 trim 掉：用户从别处粘贴常带空格
  it('参数带前后空白 ⇒ trim 后入 params', () => {
    expect(normalizeEditParamsArgs({ ...BASE, rate: ' 1.2 ' }).rate).toBe('1.2')
  })

  // 字符串形式的整数（"1"）合法——官方要字符串，不要求带小数点
  it('整数形态字符串合法', () => {
    expect(normalizeEditParamsArgs({ ...BASE, rate: '1' }).rate).toBe('1')
  })
})
