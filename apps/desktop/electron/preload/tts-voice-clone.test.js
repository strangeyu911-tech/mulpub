import { describe, expect, it, vi } from 'vitest'

const { createTtsVoiceCloneApi } = require('./tts-voice-clone')

/**
 * tts-voice-clone preload 通道映射测试（change: hifly-voice-edit-ui）。
 *
 * 这个文件此前覆盖率 0：preload 层只做「方法名 → 通道名」的映射，
 * 看起来「没什么可测」，但它是渲染层与主进程之间唯一的字面量绑定——
 * 名字走错一个，主进程收到的是不存在的 handler，报错是 Electron 原生的
 * "No handler registered"，用户侧完全无法理解。
 */

function makeIpcRenderer () {
  return { invoke: vi.fn(async () => ({ code: 0, data: null })) }
}

const CASES = [
  ['requirements', 'tts-voice-clone:requirements'],
  ['chooseSamples', 'tts-voice-clone:choose-samples'],
  ['list', 'tts-voice-clone:list'],
  ['add', 'tts-voice-clone:add'],
  ['deleteClone', 'tts-voice-clone:delete'],
  ['rename', 'tts-voice-clone:rename'],
  ['editParams', 'tts-voice-clone:editParams'],
]

describe('createTtsVoiceCloneApi — preload 通道映射', () => {
  it.each(CASES)('%s 走 %s', async (method, channel) => {
    const ipcRenderer = makeIpcRenderer()
    const api = createTtsVoiceCloneApi(ipcRenderer).ttsVoiceClone
    await api[method]({ probe: 1 })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel, { probe: 1 })
  })

  it.each(CASES)('%s 原样转发入参', async (method) => {
    const ipcRenderer = makeIpcRenderer()
    const api = createTtsVoiceCloneApi(ipcRenderer).ttsVoiceClone
    const input = { a: 1, b: { c: [2, 3] } }
    await api[method](input)
    expect(ipcRenderer.invoke.mock.calls[0][1]).toEqual(input)
  })

  it('只暴露 ttsVoiceClone 一个命名空间，且恰有这 7 个方法', () => {
    const api = createTtsVoiceCloneApi(makeIpcRenderer())
    expect(Object.keys(api)).toEqual(['ttsVoiceClone'])
    expect(Object.keys(api.ttsVoiceClone).sort()).toEqual(CASES.map(([m]) => m).sort())
  })

  it('不暴露通用 invoke', () => {
    const api = createTtsVoiceCloneApi(makeIpcRenderer())
    expect(api.invoke).toBeUndefined()
    expect(api.ttsVoiceClone.invoke).toBeUndefined()
  })

  it('两次调用返回互不相同的命名空间对象', () => {
    const ipcRenderer = makeIpcRenderer()
    expect(createTtsVoiceCloneApi(ipcRenderer).ttsVoiceClone)
      .not.toBe(createTtsVoiceCloneApi(ipcRenderer).ttsVoiceClone)
  })
})
