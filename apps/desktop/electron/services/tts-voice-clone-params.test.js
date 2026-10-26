import { describe, expect, it } from 'vitest'

const {
  CLONE_VOICE_PARAM_RANGES,
  isSafeCloneVoiceParams,
  normalizeEditParamsRequest,
} = require('./tts-voice-clone-params')

/**
 * 音色参数校验的纯函数测试（change: hifly-voice-edit）。
 *
 * 为什么单独测这两个函数而不是只测 service：
 * 它们是**写盘前的最后一道闸**——registry 是持久化面，
 * 一条脏 params 会让下次读取把**整条音色**判非法而从列表里消失
 * （`isSafeCloneVoice` 对 params 有独立校验）。也就是说这里漏一个边界，
 * 用户丢掉的是整个音色，不只是参数。
 *
 * 官方契约（真实 Token 侧证）：三个值都必须是**字符串**，数字会被拒。
 */

describe('CLONE_VOICE_PARAM_RANGES — 官方边界', () => {
  it('rate 0.5~2.0 / volume 0.1~2.0 / pitch 0.1~2.0', () => {
    expect(CLONE_VOICE_PARAM_RANGES.rate).toEqual({ min: 0.5, max: 2.0 })
    expect(CLONE_VOICE_PARAM_RANGES.volume).toEqual({ min: 0.1, max: 2.0 })
    expect(CLONE_VOICE_PARAM_RANGES.pitch).toEqual({ min: 0.1, max: 2.0 })
  })

  it('是冻结的（防止运行时被改写）', () => {
    expect(Object.isFrozen(CLONE_VOICE_PARAM_RANGES)).toBe(true)
    expect(Object.isFrozen(CLONE_VOICE_PARAM_RANGES.rate)).toBe(true)
  })
})

describe('isSafeCloneVoiceParams — 写盘闸门', () => {
  it('空对象合法（三项都可选）', () => {
    expect(isSafeCloneVoiceParams({})).toBe(true)
  })

  it('三项齐全且都在界内 ⇒ 合法', () => {
    expect(isSafeCloneVoiceParams({ rate: '1.0', volume: '1.0', pitch: '1.0' })).toBe(true)
  })

  it('边界值本身合法（0.5 / 2.0 / 0.1）', () => {
    expect(isSafeCloneVoiceParams({ rate: '0.5' })).toBe(true)
    expect(isSafeCloneVoiceParams({ rate: '2.0' })).toBe(true)
    expect(isSafeCloneVoiceParams({ volume: '0.1' })).toBe(true)
    expect(isSafeCloneVoiceParams({ pitch: '2.0' })).toBe(true)
  })

  // 越界一档就要挡：写进去后整条音色会从列表消失
  it('越界 ⇒ 非法', () => {
    expect(isSafeCloneVoiceParams({ rate: '0.49' })).toBe(false)
    expect(isSafeCloneVoiceParams({ rate: '2.01' })).toBe(false)
    expect(isSafeCloneVoiceParams({ volume: '0.09' })).toBe(false)
    expect(isSafeCloneVoiceParams({ pitch: '2.1' })).toBe(false)
  })

  // 官方要字符串；数字形态会被服务端拒，存进 registry 也是脏数据
  it('数字类型 ⇒ 非法（官方要字符串）', () => {
    expect(isSafeCloneVoiceParams({ rate: 1.0 })).toBe(false)
  })

  it('未知键 ⇒ 非法（不静默丢弃前端拼错的字段）', () => {
    expect(isSafeCloneVoiceParams({ speed: '1.0' })).toBe(false)
  })

  it('空串 / 空白 / 非有限数 ⇒ 非法', () => {
    expect(isSafeCloneVoiceParams({ rate: '' })).toBe(false)
    expect(isSafeCloneVoiceParams({ rate: '   ' })).toBe(false)
    expect(isSafeCloneVoiceParams({ rate: 'abc' })).toBe(false)
    expect(isSafeCloneVoiceParams({ rate: 'NaN' })).toBe(false)
  })

  it('非对象 / 数组 / null ⇒ 非法', () => {
    expect(isSafeCloneVoiceParams(null)).toBe(false)
    expect(isSafeCloneVoiceParams([])).toBe(false)
    expect(isSafeCloneVoiceParams('rate=1')).toBe(false)
    expect(isSafeCloneVoiceParams(undefined)).toBe(false)
  })
})

describe('normalizeEditParamsRequest — IPC 入参归一', () => {
  const service = {
    _normalizeRequest: (input) => (input && input.voiceId
      ? { providerId: 'hifly', model: 'hifly', voiceId: input.voiceId }
      : null),
  }

  it('单参数也合法（其余可选）', () => {
    const r = normalizeEditParamsRequest(service, { voiceId: 'v_1', rate: '1.2' })
    expect(r).toEqual({
      providerId: 'hifly', model: 'hifly', voiceId: 'v_1', params: { rate: '1.2' },
    })
  })

  it('三项都给 ⇒ params 齐全且保持字符串', () => {
    const r = normalizeEditParamsRequest(service, {
      voiceId: 'v_1', rate: '0.8', volume: '1.5', pitch: '1.1',
    })
    expect(r.params).toEqual({ rate: '0.8', volume: '1.5', pitch: '1.1' })
  })

  // 一个参数都不给 ⇒ 空操作，必须判非法，不能当成「什么都不改」的成功
  it('一个参数都不给 ⇒ null', () => {
    expect(normalizeEditParamsRequest(service, { voiceId: 'v_1' })).toBe(null)
  })

  it('voiceId 形态非法 ⇒ null（与 safeIdentifier 同界）', () => {
    expect(normalizeEditParamsRequest(service, { voiceId: 'bad id!', rate: '1.0' })).toBe(null)
    expect(normalizeEditParamsRequest(service, { voiceId: '', rate: '1.0' })).toBe(null)
    expect(normalizeEditParamsRequest(service, { voiceId: 'a'.repeat(257), rate: '1.0' })).toBe(null)
  })

  it('任一参数越界 ⇒ 整体 null（不做部分接受）', () => {
    expect(normalizeEditParamsRequest(service, { voiceId: 'v_1', rate: '9' })).toBe(null)
    expect(normalizeEditParamsRequest(service, { voiceId: 'v_1', rate: '1.0', pitch: '0' })).toBe(null)
  })

  it('参数是数字 ⇒ null（官方要字符串）', () => {
    expect(normalizeEditParamsRequest(service, { voiceId: 'v_1', rate: 1.0 })).toBe(null)
  })

  it('service 拒绝基础请求 ⇒ null', () => {
    expect(normalizeEditParamsRequest(service, { rate: '1.0' })).toBe(null)
  })
})
