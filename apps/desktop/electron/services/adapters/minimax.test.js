// @ts-check
/**
 * minimax.test.js — MiniMax Video Adapter 测试
 *
 * 验证：构造、validateConfig、能力协商、generateVideo、getVideoStatus、错误处理、testConnection、网络错误
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() })

const { MiniMaxAdapter } = require('./minimax')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')
const { ADAPTER_VERSION } = require('./_base/base')

function createFetchResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    body: null,
  }
}

function createFetchMock(responses = []) {
  const calls = []
  const mock = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    return responses.shift() || createFetchResponse({})
  })
  mock.calls = calls
  return mock
}

describe('MiniMaxAdapter — MiniMax Video', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch; vi.clearAllMocks() })

  describe('构造与配置', () => {
    it('接受 credentials + options 分离参数', () => {
      const adapter = new MiniMaxAdapter({
        id: 'minimax', apiKey: 'mm-key', baseUrl: 'https://api.minimax.chat/v1',
      }, { timeout: 120000 })
      expect(adapter.id).toBe('minimax')
      expect(adapter.credentials.apiKey).toBe('mm-key')
    })
    it('默认 baseUrl', () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      expect(adapter.credentials.baseUrl).toBe('https://api.minimaxi.com/v1')
    })
    it('版本号匹配 ADAPTER_VERSION', () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      expect(adapter.version).toBe(ADAPTER_VERSION)
    })
  })

  describe('validateConfig', () => {
    it('有 apiKey 时返回 valid', () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      expect(adapter.validateConfig().valid).toBe(true)
    })
    it('无 apiKey 时返回 invalid', () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: '' })
      expect(adapter.validateConfig().valid).toBe(false)
    })
  })

  describe('能力协商', () => {
    it('支持 generateVideo / getVideoStatus', () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      expect(adapter.supports('generateVideo')).toBe(true)
      expect(adapter.supports('getVideoStatus')).toBe(true)
      expect(adapter.capabilities()).toContain('generateVideo')
    })
  })

  describe('generateVideo', () => {
    it('POST /video_generation 返回 { taskId, model }，默认参数正确', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 'mm-task-1' })])
      global.fetch = fetchMock

      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.generateVideo({ prompt: '海浪' })

      expect(result.taskId).toBe('mm-task-1')
      expect(result.model).toBe('MiniMax-Hailuo-2.3')

      expect(fetchMock.calls[0].url).toContain('/video_generation')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.prompt).toBe('海浪')
      expect(body.model).toBe('MiniMax-Hailuo-2.3')
      // 默认参数
      expect(body.duration).toBe(6)
      expect(body.resolution).toBe('768P')
      expect(body.prompt_optimizer).toBe(true)
      // 未传 first_frame_image 为 undefined
      expect(body.first_frame_image).toBeUndefined()
      expect(fetchMock.calls[0].opts.headers['Authorization']).toBe('Bearer k')
    })

    it('自定义 model', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't1' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.generateVideo({ prompt: 'x', model: 'T2V-01' })
      expect(result.model).toBe('T2V-01')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.model).toBe('T2V-01')
    })

    it('自定义 duration=10', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't1' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x', duration: 10 })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.duration).toBe(10)
    })

    it('自定义 resolution=1080P', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't1' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x', resolution: '1080P' })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.resolution).toBe('1080P')
    })

    it('firstFrameImage 映射到 first_frame_image（图生视频）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't1' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({
        prompt: 'x',
        firstFrameImage: 'https://cdn.example.com/first.png',
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.first_frame_image).toBe('https://cdn.example.com/first.png')
    })

    it('prompt_optimizer 始终为 true', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't1' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x' })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.prompt_optimizer).toBe(true)
    })

    it('无 prompt 抛错', async () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await expect(adapter.generateVideo({})).rejects.toThrow(/prompt.*required/i)
    })

    it('401 → AUTH_FAILED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ base_resp: { status_msg: 'Bad key' } }, 401)])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'bad' })
      try {
        await adapter.generateVideo({ prompt: 'x' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
    })

    it('429 → RATE_LIMITED', async () => {
      global.fetch = createFetchMock([createFetchResponse({ message: 'rate' }, 429)])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      try {
        await adapter.generateVideo({ prompt: 'x' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.RATE_LIMITED)
      }
    })
  })

  describe('getVideoStatus', () => {
    it('GET /query/video_generation?task_id={taskId} 返回状态', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        status: 'Success',
        file_id: 'file-123',
        progress: 100,
      })])
      global.fetch = fetchMock

      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.getVideoStatus('mm-task-1')

      expect(result.status).toBe('completed')
      expect(result.progress).toBe(100)
      // videoUrl 使用配置的 baseUrl（minimaxi）+ file_id
      expect(result.videoUrl).toContain('file_id=file-123')
      expect(result.videoUrl).toContain('https://api.minimaxi.com/v1/files/retrieve')
      expect(fetchMock.calls[0].url).toContain('/query/video_generation')
      expect(fetchMock.calls[0].url).toContain('task_id=mm-task-1')
    })

    it('Preparing → processing', async () => {
      global.fetch = createFetchMock([createFetchResponse({ status: 'Preparing', progress: 0 })])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.getVideoStatus('t1')
      expect(result.status).toBe('processing')
      expect(result.progress).toBe(0)
    })

    it('Queueing → processing', async () => {
      global.fetch = createFetchMock([createFetchResponse({ status: 'Queueing', progress: 10 })])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.getVideoStatus('t1')
      expect(result.status).toBe('processing')
      expect(result.progress).toBe(10)
    })

    it('Processing → processing', async () => {
      global.fetch = createFetchMock([createFetchResponse({ status: 'Processing', progress: 30 })])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.getVideoStatus('t1')
      expect(result.status).toBe('processing')
      expect(result.progress).toBe(30)
    })

    it('Fail → failed', async () => {
      global.fetch = createFetchMock([createFetchResponse({ status: 'Fail', progress: 0 })])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.getVideoStatus('t1')
      expect(result.status).toBe('failed')
      expect(result.videoUrl).toBe('')
    })

    it('无 taskId 抛错', async () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await expect(adapter.getVideoStatus('')).rejects.toThrow(/taskId.*required/i)
    })
  })

  describe('listModels', () => {
    it('返回 6 个预定义模型（4 个 v1 + 2 个 H3/v2）', async () => {
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const models = await adapter.listModels()
      expect(models).toHaveLength(6)
      const ids = models.map(m => m.id)
      expect(ids).toEqual([
        'MiniMax-Hailuo-2.3',
        'MiniMax-Hailuo-02',
        'T2V-01',
        'I2V-01',
        'MiniMax-H3',
        'MiniMax-H3-Max',
      ])
    })

    it('不发起 HTTP 请求（静态列表）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.listModels()
      expect(fetchMock.calls).toHaveLength(0)
    })
  })

  describe('testConnection', () => {
    it('请求成功返回 true', async () => {
      global.fetch = createFetchMock([createFetchResponse({ task_id: 't' })])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.testConnection()
      expect(result.success).toBe(true)
    })
  })

  describe('网络错误分类', () => {
    it('ETIMEDOUT → TIMEOUT', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ETIMEDOUT') })
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      try {
        await adapter.generateVideo({ prompt: 'x' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.TIMEOUT)
      }
    })
    it('ECONNREFUSED → NETWORK_ERROR', async () => {
      global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      try {
        await adapter.generateVideo({ prompt: 'x' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.NETWORK_ERROR)
      }
    })
  })

  // ── v2（H3）分支（官方算力 R5-3）───────────────────────────────
  describe('MiniMax H3（v2 端点）', () => {
    const H3 = 'MiniMax-H3'

    it('H3 模型 ⇒ 打 v2 基址（baseUrl 同域换版本），body 是 content[] 数组', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 'h3-task-1' })])
      global.fetch = fetchMock

      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.generateVideo({ prompt: '海浪', model: H3, ratio: '16:9' })

      expect(result.taskId).toBe('h3-task-1')
      expect(result.model).toBe(H3)
      expect(fetchMock.calls[0].url).toBe('https://api.minimaxi.com/v2/video_generation')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.model).toBe(H3)
      expect(body.content).toEqual([{ type: 'text', text: '海浪' }])
      expect(body.ratio).toBe('16:9')
      // v1 的顶层 prompt / prompt_optimizer 不该出现在 v2 body 里
      expect(body.prompt).toBeUndefined()
      expect(body.prompt_optimizer).toBeUndefined()
    })

    it('国际站 baseUrl ⇒ v2 也打国际站（域名不换）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k', baseUrl: 'https://api.minimax.io/v1' })
      await adapter.generateVideo({ prompt: 'x', model: H3, ratio: '16:9' })
      expect(fetchMock.calls[0].url).toBe('https://api.minimax.io/v2/video_generation')
    })

    it('首帧 ⇒ content 带 image_url/role=first_frame，ratio 恒 adaptive', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({
        prompt: 'x',
        model: H3,
        ratio: '16:9',
        firstFrameImage: 'data:image/png;base64,AAAA',
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.content).toHaveLength(2)
      expect(body.content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,AAAA' },
        role: 'first_frame',
      })
      expect(body.ratio).toBe('adaptive')
    })

    it('宽高 ⇒ 推导画幅（影视工程调用面只给 width/height）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x', model: H3, width: 720, height: 1280 })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.ratio).toBe('9:16')
    })

    it('v2 轮询走路径参数（不是 v1 的 query），并透出 usage/resolution', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ task_id: 'h3-task-1' }),
        createFetchResponse({
          task: {
            status: 'succeeded',
            content: { url: 'https://cdn.example.com/out.mp4' },
            resolution: '768P',
            duration: 8,
            usage: { total_seconds: 8.7, input_seconds: 0, output_seconds: 8.7, input_image_count: 1 },
          },
        }),
      ])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x', model: H3, ratio: '16:9' })
      const result = await adapter.getVideoStatus('h3-task-1')

      expect(fetchMock.calls[1].url).toBe('https://api.minimaxi.com/v2/query/video_generation/h3-task-1')
      expect(result.status).toBe('completed')
      expect(result.videoUrl).toBe('https://cdn.example.com/out.mp4')
      expect(result.usage.total_seconds).toBe(8.7)
      expect(result.resolution).toBe('768P')
    })

    it('v2 轮询缺 usage ⇒ usage 为 null（不补默认值：补猜出来的值就是错账）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ task_id: 't' }),
        createFetchResponse({ task: { status: 'succeeded', content: { url: 'https://cdn.example.com/out.mp4' } } }),
      ])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x', model: H3, ratio: '16:9' })
      const result = await adapter.getVideoStatus('t')
      expect(result.usage).toBeNull()
    })

    it('v2 任务失败 ⇒ status=failed 且带 error（不抛，轮询方据此收口）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ task_id: 't' }),
        createFetchResponse({ task: { status: 'failed', error: { code: 1026, message: 'sensitive content' } } }),
      ])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x', model: H3, ratio: '16:9' })
      const result = await adapter.getVideoStatus('t')
      expect(result.status).toBe('failed')
      expect(result.error.message).toBe('sensitive content')
      expect(result.videoUrl).toBe('')
    })

    it('v2 任务取消 ⇒ status=cancelled', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ task_id: 't' }),
        createFetchResponse({ task: { status: 'cancelled' } }),
      ])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: 'x', model: H3, ratio: '16:9' })
      const result = await adapter.getVideoStatus('t')
      expect(result.status).toBe('cancelled')
    })

    it('v2 402 余额不足 ⇒ QUOTA_EXCEEDED 且带出官方消息', async () => {
      global.fetch = createFetchMock([
        createFetchResponse({ error: { type: 'insufficient_balance_error', message: 'insufficient balance' } }, 402),
      ])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      try {
        await adapter.generateVideo({ prompt: 'x', model: H3, ratio: '16:9' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.QUOTA_EXCEEDED)
        expect(e.message).toContain('insufficient balance')
      }
    })

    it('v2 422 内容审核 ⇒ CONTENT_POLICY（重试无用，要能进改写路径）', async () => {
      global.fetch = createFetchMock([
        createFetchResponse({ error: { type: 'unprocessable_entity_error', message: 'video description contains sensitive content' } }, 422),
      ])
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      try {
        await adapter.generateVideo({ prompt: 'x', model: H3, ratio: '16:9' })
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.CONTENT_POLICY)
        expect(e.message).toContain('sensitive content')
      }
    })

    it('v1 老模型仍走 v1（顶层 prompt + v1 基址），行为未变', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ task_id: 't1' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      await adapter.generateVideo({ prompt: '海浪', model: 'MiniMax-Hailuo-2.3' })
      expect(fetchMock.calls[0].url).toBe('https://api.minimaxi.com/v1/video_generation')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.prompt).toBe('海浪')
      expect(body.prompt_optimizer).toBe(true)
      expect(body.content).toBeUndefined()
    })
  })

  describe('getVideoStatus 的入参形态', () => {
    it('callAdapter 的对象形态 { videoId, taskId } 可用（原实现会把对象拼进 URL ⇒ 轮询必失败）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ status: 'Success', file_id: 'f1' })])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.getVideoStatus({ videoId: 'mm-task-1', taskId: 'mm-task-1' })
      expect(result.status).toBe('completed')
      expect(fetchMock.calls[0].url).toContain('task_id=mm-task-1')
      expect(fetchMock.calls[0].url).not.toContain('object')
    })
  })

  describe('v1 → v2 回落（进程重启后本地记录已丢）', () => {
    it('v1 端点不认识这个 task ⇒ 回落试 v2', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ base_resp: { status_code: 1004, status_msg: 'task not exist' } }),
        createFetchResponse({
          task: { status: 'succeeded', content: { url: 'https://cdn.example.com/out.mp4' }, usage: { total_seconds: 5 } },
        }),
      ])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      const result = await adapter.getVideoStatus('h3-task-1')
      expect(fetchMock.calls).toHaveLength(2)
      expect(fetchMock.calls[0].url).toContain('/v1/query/video_generation')
      expect(fetchMock.calls[1].url).toContain('/v2/query/video_generation/h3-task-1')
      expect(result.status).toBe('completed')
      expect(result.usage.total_seconds).toBe(5)
    })

    it('v1 鉴权失败 ⇒ 不回落（换端点也是同样结果，不多发请求）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ error: { message: 'login fail' } }, 401)])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      try {
        await adapter.getVideoStatus('t1')
        expect.fail('Should throw')
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.AUTH_FAILED)
      }
      expect(fetchMock.calls).toHaveLength(1)
    })

    it('两端都不认识 ⇒ 抛出合并后的错误（不吞掉任何一边的原因）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ base_resp: { status_code: 1004, status_msg: 'task not exist' } }),
        createFetchResponse({ error: { message: 'invalid task_id' } }, 404),
      ])
      global.fetch = fetchMock
      const adapter = new MiniMaxAdapter({ id: 'minimax', apiKey: 'k' })
      try {
        await adapter.getVideoStatus('h3-task-1')
        expect.fail('Should throw')
      } catch (e) {
        expect(e.message).toContain('task not exist')
        expect(e.message).toContain('invalid task_id')
      }
      expect(fetchMock.calls).toHaveLength(2)
    })
  })
})
