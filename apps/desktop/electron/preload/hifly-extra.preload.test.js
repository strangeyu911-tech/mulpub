import { describe, expect, it, vi } from 'vitest'

const { createHiflyExtraApi } = require('./hifly-extra')

/**
 * preload 层的通道契约测试（change: hifly-full-api-ui）。
 *
 * 这层只有 33 行，但它是渲染层与主进程之间唯一的字面量映射：
 * 方法名走错一个通道，主进程收到的是不存在的 handler 名，
 * 报错是 Electron 原生的 "No handler registered"，用户侧完全无法理解。
 */

function makeIpcRenderer () {
  return { invoke: vi.fn(async () => ({ code: 0, data: null })) }
}

/**
 * 11 个方法的三元组：[方法名, 通道名, 期望入参]。
 *
 * 为什么带第三列：credit 是无参签名 () => invoke(channel, {})，它会忽略
 * 调用方传的入参、恒定发 {}。若统一按透传入参断言，那一条必然红——
 * 而这是设计的正确行为（主进程的形状校验拒 undefined，所以必须显式给 {}）。
 * 把期望值写进表里，比在循环里加 if 特例更不容易看漏。
 */
const CASES = [
  ['credit', 'hifly-extra:credit', {}],
  ['livelyTemplates', 'hifly-extra:lively-templates', { probe: 1 }],
  ['coverStyles', 'hifly-extra:cover-styles', { probe: 1 }],
  ['createCover', 'hifly-extra:create-cover', { probe: 1 }],
  ['deleteWork', 'hifly-extra:delete-work', { probe: 1 }],
  ['createByAudio', 'hifly-extra:create-by-audio', { probe: 1 }],
  ['createByTemplate', 'hifly-extra:create-by-template', { probe: 1 }],
  ['translate', 'hifly-extra:translate', { probe: 1 }],
  ['createBySing', 'hifly-extra:create-by-sing', { probe: 1 }],
  ['createByImage', 'hifly-extra:create-by-image', { probe: 1 }],
  ['audioTts', 'hifly-extra:audio-tts', { probe: 1 }],
]

describe('createHiflyExtraApi — preload 通道映射', () => {
  it.each(CASES)('%s 走 %s', async (method, channel, expected) => {
    const ipcRenderer = makeIpcRenderer()
    const api = createHiflyExtraApi(ipcRenderer).hiflyExtra
    await api[method]({ probe: 1 })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel, expected)
  })

  it.each(CASES.filter(([m]) => m !== 'credit'))('%s 原样转发入参', async (method) => {
    const ipcRenderer = makeIpcRenderer()
    const api = createHiflyExtraApi(ipcRenderer).hiflyExtra
    const input = { a: 1, b: { c: [2, 3] } }
    await api[method](input)
    expect(ipcRenderer.invoke.mock.calls[0][1]).toEqual(input)
  })

  it('credit 忽略入参、恒定发空对象', async () => {
    const ipcRenderer = makeIpcRenderer()
    const api = createHiflyExtraApi(ipcRenderer).hiflyExtra
    await api.credit({ noise: 'ignored' })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('hifly-extra:credit', {})
  })

  it('挂在 hiflyExtra 命名空间下，且只暴露这 11 个方法', () => {
    const api = createHiflyExtraApi(makeIpcRenderer())
    expect(Object.keys(api)).toEqual(['hiflyExtra'])
    expect(Object.keys(api.hiflyExtra).sort()).toEqual(CASES.map(([m]) => m).sort())
  })

  it('不暴露通用 invoke', () => {
    const api = createHiflyExtraApi(makeIpcRenderer())
    expect(api.invoke).toBeUndefined()
    expect(api.hiflyExtra.invoke).toBeUndefined()
  })

  it('两次调用返回互不相同的命名空间对象', () => {
    const ipcRenderer = makeIpcRenderer()
    const a = createHiflyExtraApi(ipcRenderer).hiflyExtra
    const b = createHiflyExtraApi(ipcRenderer).hiflyExtra
    expect(a).not.toBe(b)
  })
})
