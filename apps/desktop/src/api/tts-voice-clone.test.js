import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invokeNamespace } from './electron-bridge'
import {
  addTtsVoiceClone,
  chooseTtsVoiceCloneSamples,
  deleteTtsVoiceClone,
  editTtsVoiceCloneParams,
  getTtsVoiceCloneRequirements,
  listTtsVoiceClones,
  renameTtsVoiceClone,
} from './tts-voice-clone'

/**
 * tts-voice-clone 渲染层 API 的通道契约测试（change: hifly-voice-edit-ui）。
 *
 * 覆盖率此前为 0。这层最容易出的错是「复制粘贴改漏一个方法名」——
 * 类型检查、lint、契约测试都发现不了，只有真跑才会把 delete 发到 rename 的通道上。
 *
 * 重点测 `editTtsVoiceCloneParams`：它是本次新增的唯一方法（change: hifly-voice-edit-ui），
 * 走错通道的话「改音色参数」会静默失败——因为它返回的是 { code, message } 信封，
 * 通道错时拿到的是 Electron 的 reject，被本层兜成 -1，调用方只会看到「失败」。
 */

vi.mock('./electron-bridge', () => ({ invokeNamespace: vi.fn() }))

beforeEach(() => {
  invokeNamespace.mockReset()
  invokeNamespace.mockResolvedValue({ code: 0, data: {} })
})

const CASES = [
  ['getTtsVoiceCloneRequirements', getTtsVoiceCloneRequirements, 'requirements'],
  ['chooseTtsVoiceCloneSamples', chooseTtsVoiceCloneSamples, 'chooseSamples'],
  ['listTtsVoiceClones', listTtsVoiceClones, 'list'],
  ['addTtsVoiceClone', addTtsVoiceClone, 'add'],
  ['deleteTtsVoiceClone', deleteTtsVoiceClone, 'deleteClone'],
  ['renameTtsVoiceClone', renameTtsVoiceClone, 'rename'],
  ['editTtsVoiceCloneParams', editTtsVoiceCloneParams, 'editParams'],
]

describe('tts-voice-clone renderer API — 通道契约', () => {
  it.each(CASES)('%s 走 ttsVoiceClone/%s', async (_name, fn, method) => {
    const res = await fn({ probe: 1 })
    expect(invokeNamespace).toHaveBeenCalledWith('ttsVoiceClone', method, { probe: 1 })
    expect(res).toEqual({ code: 0, data: {} })
  })

  // editParams 是本 change 新增的方法，单独锁一次它的通道名
  it('editTtsVoiceCloneParams 走 editParams（不是 rename/add）', async () => {
    await editTtsVoiceCloneParams({ voiceId: 'v_1', rate: '1.2' })
    expect(invokeNamespace).toHaveBeenCalledWith('ttsVoiceClone', 'editParams', { voiceId: 'v_1', rate: '1.2' })
  })

  it('invokeNamespace 抛错 ⇒ 返回统一信封，不抛', async () => {
    invokeNamespace.mockRejectedValue(new Error('No handler registered'))
    const res = await editTtsVoiceCloneParams({ voiceId: 'v_1', rate: '1.2' })
    expect(res.code).not.toBe(0)
    expect(typeof res.message).toBe('string')
  })

  it('invokeNamespace 返回 undefined ⇒ 统一信封', async () => {
    invokeNamespace.mockResolvedValue(undefined)
    const res = await getTtsVoiceCloneRequirements({})
    expect(res.code).not.toBe(0)
    expect(typeof res.message).toBe('string')
  })
})
