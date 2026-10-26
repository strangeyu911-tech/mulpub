import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invokeNamespace } from './electron-bridge'
import {
  createHiflyAudioTts,
  createHiflyCover,
  createHiflyVideoByAudio,
  createHiflyVideoByImage,
  createHiflyVideoBySing,
  createHiflyVideoByTemplate,
  deleteHiflyWork,
  getHiflyCredit,
  listHiflyCoverStyles,
  listHiflyLivelyTemplates,
  translateHiflyVideo,
} from './hifly-extra'

/**
 * 渲染层 API 的通道契约测试（change: hifly-full-api-ui）。
 *
 * 为什么必须有这个文件：`ipc-exposure-contract` 只验证「api 文件在 SCAN_DOMAIN 内、
 * 方法名写字面量」，它**不验证每个导出真的走了对的通道**。而这一层最容易出的错
 * 恰恰是「复制粘贴改漏一个名字」——比如 `createBySing` 写成 `createByImage`，
 * 类型检查、lint、契约测试全都发现不了，只有真跑才会把用户的图当成音频提交。
 *
 * 覆盖：11 个导出逐个断言 (namespace, method)；异常与空返回的统一降级。
 */

vi.mock('./electron-bridge', () => ({ invokeNamespace: vi.fn() }))

beforeEach(() => {
  invokeNamespace.mockReset()
  invokeNamespace.mockResolvedValue({ code: 0, data: {} })
})

describe('hifly-extra renderer API — 通道契约', () => {
  // 11 个导出的 (ns, method) 一一对应。通道名写错会在这里当场红。
  const CASES = [
    ['getHiflyCredit', getHiflyCredit, 'credit', {}],
    ['listHiflyLivelyTemplates', listHiflyLivelyTemplates, 'livelyTemplates', { page: 1 }],
    ['listHiflyCoverStyles', listHiflyCoverStyles, 'coverStyles', { page: 1 }],
    ['createHiflyCover', createHiflyCover, 'createCover', { template: 't', content: 'x' }],
    ['deleteHiflyWork', deleteHiflyWork, 'deleteWork', { taskId: 't1' }],
    ['createHiflyVideoByAudio', createHiflyVideoByAudio, 'createByAudio', { fileId: 'f' }],
    ['createHiflyVideoByTemplate', createHiflyVideoByTemplate, 'createByTemplate', { template: 't' }],
    ['translateHiflyVideo', translateHiflyVideo, 'translate', { videoFileId: 'v' }],
    ['createHiflyVideoBySing', createHiflyVideoBySing, 'createBySing', { imageFileId: 'i' }],
    ['createHiflyVideoByImage', createHiflyVideoByImage, 'createByImage', { imageFileId: 'i' }],
    ['createHiflyAudioTts', createHiflyAudioTts, 'audioTts', { voice: 'v' }],
  ]

  it.each(CASES)('%s 走 hiflyExtra/%s', async (_name, fn, method, input) => {
    const res = await fn(input)
    expect(invokeNamespace).toHaveBeenCalledWith('hiflyExtra', method, input)
    expect(res).toEqual({ code: 0, data: {} })
  })

  // credit 是唯一无参导出：必须显式传 {}，不能传 undefined——
  // 主进程的形状校验会把 undefined 当成「参数不是对象」而拒。
  it('getHiflyCredit 显式传空对象', async () => {
    await getHiflyCredit()
    expect(invokeNamespace).toHaveBeenCalledWith('hiflyExtra', 'credit', {})
  })

  // 主进程抛错（通道未注册、sender 校验失败）不能让异常穿过渲染层，
  // 否则调用方拿到的不是信封而是 rejected promise，各处都要各自 try/catch。
  it('invokeNamespace 抛错 ⇒ 返回统一信封，不抛', async () => {
    invokeNamespace.mockRejectedValue(new Error('No handler registered'))
    const res = await getHiflyCredit()
    expect(res.code).not.toBe(0)
    expect(res.message).toContain('No handler registered')
  })

  // 返回 undefined（bridge 在 window.electronAPI 缺失时会这样）也要降级成信封，
  // 否则调用方 `res.code` 会 TypeError。
  it('invokeNamespace 返回 undefined ⇒ 统一信封', async () => {
    invokeNamespace.mockResolvedValue(undefined)
    const res = await listHiflyLivelyTemplates({})
    expect(res.code).not.toBe(0)
    expect(res.message).toBe('HIFLY_EXTRA_UNAVAILABLE')
  })

  // 所有 11 个导出都要有同样的降级行为（不是只有 credit 一个）。
  it('11 个导出在异常时都返回信封', async () => {
    invokeNamespace.mockRejectedValue(new Error('boom'))
    for (const [, fn] of CASES) {
      const res = await fn({})
      expect(res.code).not.toBe(0)
      expect(typeof res.message).toBe('string')
    }
  })
})
