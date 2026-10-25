// @ts-check
/**
 * agnes-multimodal.test.js — TDD: Agnes-AI 多模态 Adapter（中国站）测试
 *
 * 覆盖：
 * - 构造与默认配置（中国站 Base URL https://api.agnes-ai.cn/v1）
 * - 能力委托：chatCompletion → AgnesLlmAdapter；generateImage → AgnesImageAdapter
 * - 视频 2.5 Flash 新协议：POST /videos（mode/seconds/size:"720P"/aspect_ratio）
 * - 任务查询：GET /agnesapi?video_id=&model_name=（model_name 必带）
 * - 503/429 有界重试；keyframe/reference 模式校验
 * - 预设契约：agnes-multimodal 种子声明 ≥2 能力 + capability_models
 *
 * 使用 fetch mock，不发起真实 HTTP 请求
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

global.__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() })

const { AgnesMultimodalAdapter, AGNES_MULTIMODAL_MODELS, pickAspectRatio, pickSeconds } = require('./agnes-multimodal')
const { PRESET_PROVIDERS, PRESET_RATE_LIMITS } = require('../model-provider-seeds')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')
const { readSaturation, resetAllProviderSaturation } = require('./_base/provider-saturation')

// ─── fetch mock 工具 ───
function createFetchResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    async arrayBuffer() { return new ArrayBuffer(0) },
    body: null,
  }
}

function createFetchMock(responses = []) {
  const calls = []
  const mock = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    const resp = responses.shift() || createFetchResponse({})
    return resp
  })
  mock.calls = calls
  return mock
}

describe('AgnesMultimodalAdapter — Agnes-AI 多模态（中国站）', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('构造与配置', () => {
    it('默认 baseUrl 为中国站统一端点', () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-agnes-test' })
      expect(adapter.credentials.baseUrl).toBe('https://api.agnes-ai.cn/v1')
      expect(adapter.credentials.apiKey).toBe('sk-agnes-test')
    })

    it('显式 baseUrl 覆盖默认值（子适配器共享同一 credentials）', () => {
      const adapter = new AgnesMultimodalAdapter({
        id: 'agnes-multimodal',
        apiKey: 'sk-test',
        baseUrl: 'https://custom.example.com/v1',
      })
      expect(adapter.credentials.baseUrl).toBe('https://custom.example.com/v1')
      expect(adapter._llm.credentials.baseUrl).toBe('https://custom.example.com/v1')
      expect(adapter._image.credentials.baseUrl).toBe('https://custom.example.com/v1')
    })

    it('缺少 apiKey 时 validateConfig 失败', () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal' })
      const result = adapter.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('apiKey is required')
    })

    it('listModels 返回静态 4 个模型（副本）：文字 + 图片 + 两个视频模型', async () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const models = await adapter.listModels()
      expect(models.map(m => m.id)).toEqual([
        'agnes-3.0-flash',
        'agnes-image-2.5-flash',
        'agnes-video-2.5-flash',
        // 非 Flash：支持更多分辨率档位与参考视频（能力见 agnes-video-models.js）
        'agnes-video-2.5',
      ])
      models[0].id = 'mutated'
      expect(AGNES_MULTIMODAL_MODELS[0].id).toBe('agnes-3.0-flash')
    })
  })

  describe('参数推导工具', () => {
    it('pickSeconds：numFrames/frameRate 推导并 clamp 到 4–12，非法输入默认 "5"', () => {
      expect(pickSeconds(121, 24)).toBe('5')
      expect(pickSeconds(48, 24)).toBe('4')
      expect(pickSeconds(999, 24)).toBe('12')
      expect(pickSeconds(0, 24)).toBe('5')
      expect(pickSeconds(undefined, undefined)).toBe('5')
      expect(pickSeconds('abc', 'def')).toBe('5')
    })

    it('pickAspectRatio：宽高推导最近支持画幅，非法输入默认 16:9', () => {
      expect(pickAspectRatio(1280, 720)).toBe('16:9')
      expect(pickAspectRatio(720, 1280)).toBe('9:16')
      expect(pickAspectRatio(1024, 1024)).toBe('1:1')
      expect(pickAspectRatio(0, 720)).toBe('16:9')
      expect(pickAspectRatio(undefined, undefined)).toBe('16:9')
    })
  })

  describe('generateVideo — v2.5 协议', () => {
    it('text 模式：POST /videos，size 固定 720P，seconds 由帧数/帧率推导', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-123', id: 'task-1' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })

      const result = await adapter.generateVideo({
        prompt: '夜色中的城市街道',
        width: 1280,
        height: 720,
        numFrames: 121,
        frameRate: 24,
      })

      expect(result).toEqual({ taskId: 'vid-123', model: 'agnes-video-2.5-flash' })
      expect(fetchMock.calls).toHaveLength(1)
      const { url, opts } = fetchMock.calls[0]
      expect(url).toBe('https://api.agnes-ai.cn/v1/videos')
      expect(opts.method).toBe('POST')
      const body = JSON.parse(opts.body)
      expect(body).toMatchObject({
        model: 'agnes-video-2.5-flash',
        prompt: '夜色中的城市街道',
        mode: 'text',
        size: '720P',
        aspect_ratio: '16:9',
        seconds: '5',
      })
      // v2.0 旧协议字段不得出现
      expect(body.num_frames).toBeUndefined()
      expect(body.frame_rate).toBeUndefined()
      expect(body.width).toBeUndefined()
      expect(body.height).toBeUndefined()
    })

    it('认证头携带 Bearer token', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-1' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-abc' })
      await adapter.generateVideo({ prompt: 'p' })
      expect(fetchMock.calls[0].opts.headers.Authorization).toBe('Bearer sk-abc')
    })

    it('能力描述驱动的本地预校验：不受支持的 size/画幅/时长在本地拒收（不发无谓请求）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })

      // Flash 固定 720P ⇒ 传 1080P 必被服务端 400，本地先拒
      await expect(adapter.generateVideo({ prompt: 'p', size: '1080P' })).rejects.toThrow(/size must be one of/)
      // 非白名单画幅
      await expect(adapter.generateVideo({ prompt: 'p', aspect_ratio: 'auto' })).rejects.toThrow(/aspect_ratio must be one of/)
      // 时长越界（不静默夹取）
      await expect(adapter.generateVideo({ prompt: 'p', seconds: 20 })).rejects.toThrow(/seconds must be between 4 and 12/)

      expect(fetchMock.calls).toHaveLength(0)
    })

    it('Flash 拒收参考视频（服务端会以 videos is not supported 拒绝，本地先拦）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.generateVideo({
        prompt: 'p',
        mode: 'reference',
        videos: [{ url: 'https://example.com/in.mp4' }],
      })).rejects.toThrow(/videos is not supported/)
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('非 Flash 模型：size 放行 1080P，参考视频可提交', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-2' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await adapter.generateVideo({
        prompt: 'p',
        model: 'agnes-video-2.5',
        size: '1080P',
        mode: 'reference',
        videos: [{ url: 'https://example.com/in.mp4', start_seconds: 0, require_audio: false }],
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.size).toBe('1080P')
      expect(body.videos).toEqual([{ url: 'https://example.com/in.mp4', start_seconds: 0, require_audio: false }])
    })

    it('参考图/参考音频上限随模型能力变化（Flash 5 张 / 标准 8 张）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const six = Array.from({ length: 6 }, (_, i) => `https://x/${i}.png`)
      const nine = Array.from({ length: 9 }, (_, i) => `https://x/${i}.png`)

      // Flash 上限 5 ⇒ 6 张即拒
      await expect(adapter.generateVideo({ prompt: 'p', mode: 'reference', images: six }))
        .rejects.toThrow(/images length must not exceed 5/)
      // 标准 2.5 上限 8 ⇒ 6 张合法，9 张才拒
      await expect(adapter.generateVideo({ prompt: 'p', model: 'agnes-video-2.5', mode: 'reference', images: nine }))
        .rejects.toThrow(/images length must not exceed 8/)
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('未知模型按最严能力处理（fail-closed）', async () => {
      const fetchMock = createFetchMock([])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.generateVideo({ prompt: 'p', model: 'mystery-model', size: '2K' }))
        .rejects.toThrow(/size must be one of/)
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('显式 model/aspect_ratio/seconds 优先；taskId 兼容 id/task_id 命名', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ id: 'task-9' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const result = await adapter.generateVideo({
        prompt: 'p',
        model: 'agnes-video-2.5-flash',
        aspect_ratio: '9:16',
        seconds: '6',
      })
      expect(result.taskId).toBe('task-9')
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.aspect_ratio).toBe('9:16')
      expect(body.seconds).toBe('6')
    })

    it('image 参数推导为 keyframe 模式并映射 first_frame', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-kf' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await adapter.generateVideo({ prompt: 'p', image: 'https://example.com/first.png' })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.mode).toBe('keyframe')
      expect(body.first_frame).toBe('https://example.com/first.png')
    })

    it('keyframe 模式缺 first_frame/last_frame 时抛 INVALID_CONFIG，不发起请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.generateVideo({ prompt: 'p', mode: 'keyframe' }))
        .rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('reference 模式：images/audios 透传', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-ref' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await adapter.generateVideo({
        prompt: '以 <Picture 1> 为参考',
        images: ['https://example.com/a.png'],
        audios: ['https://example.com/b.mp3'],
      })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.mode).toBe('reference')
      expect(body.images).toEqual(['https://example.com/a.png'])
      expect(body.audios).toEqual(['https://example.com/b.mp3'])
    })

    it('503 后重试成功（注入短退避）', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ detail: 'video_queue_full' }, 503),
        createFetchResponse({ video_id: 'vid-retry' }),
      ])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter(
        { id: 'agnes-multimodal', apiKey: 'sk-test' },
        { retryBackoffMs: [1, 1, 1, 1, 1] }
      )
      const result = await adapter.generateVideo({ prompt: 'p' })
      expect(result.taskId).toBe('vid-retry')
      expect(fetchMock.calls).toHaveLength(2)
    })

    it('400（非重试错误）立即抛出，不重试', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ detail: 'size must be 720P' }, 400)])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter(
        { id: 'agnes-multimodal', apiKey: 'sk-test' },
        { retryBackoffMs: [1, 1, 1, 1, 1] }
      )
      await expect(adapter.generateVideo({ prompt: 'p' })).rejects.toBeInstanceOf(ProviderError)
      expect(fetchMock.calls).toHaveLength(1)
    })

    it('缺少 prompt 时抛 INVALID_CONFIG', async () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.generateVideo({})).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
    })
  })

  describe('getVideoStatus — /agnesapi + model_name', () => {
    it('查询 URL 带回提交时的 model_name，completed 时从 metadata.url 取视频地址', async () => {
      const fetchMock = createFetchMock([
        createFetchResponse({ video_id: 'vid-q' }),
        createFetchResponse({
          status: 'completed',
          progress: 100,
          metadata: { url: 'https://cdn.example.com/out.mp4' },
        }),
      ])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const submit = await adapter.generateVideo({ prompt: 'p', model: 'agnes-video-2.5-flash' })
      const status = await adapter.getVideoStatus({ videoId: submit.taskId, taskId: submit.taskId })

      // providerStatus 是**加性**字段：保留服务端原始状态（queued / in_progress / completed / failed），
      // 供渲染层区分「排队中 / 生成中」（归一化后的 status 两者都是 processing，区分不出来）。
      expect(status).toEqual({ status: 'completed', videoUrl: 'https://cdn.example.com/out.mp4', progress: 100, providerStatus: 'completed' })
      const queryUrl = fetchMock.calls[1].url
      expect(queryUrl).toContain('https://api.agnes-ai.cn/agnesapi?')
      expect(queryUrl).toContain('video_id=vid-q')
      expect(queryUrl).toContain('model_name=agnes-video-2.5-flash')
    })

    it('未记录的任务默认按 agnes-video-2.5-flash 查询；queued 映射为 processing', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ status: 'queued', progress: 0 })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const status = await adapter.getVideoStatus('vid-unknown')
      expect(status.status).toBe('processing')
      expect(status.videoUrl).toBe('')
      expect(fetchMock.calls[0].url).toContain('model_name=agnes-video-2.5-flash')
    })

    it('failed 状态映射为 failed', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ status: 'failed' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const status = await adapter.getVideoStatus('vid-fail')
      expect(status.status).toBe('failed')
    })

    it('缺少 taskId 时抛 INVALID_CONFIG', async () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.getVideoStatus('')).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
    })
  })

  describe('能力委托（LLM / Image）', () => {
    it('chatCompletion 默认模型 agnes-3.0-flash，POST /chat/completions', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        id: 'chatcmpl-1',
        choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const result = await adapter.chatCompletion({
        messages: [{ role: 'user', content: '你好' }],
      })
      const { url, opts } = fetchMock.calls[0]
      expect(url).toBe('https://api.agnes-ai.cn/v1/chat/completions')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('agnes-3.0-flash')
      expect(body.messages).toEqual([{ role: 'user', content: '你好' }])
      expect(result.content).toBe('你好')
    })

    it('generateImage 默认模型 agnes-image-2.5-flash，response_format 走 extra_body', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        created: 1780000000,
        data: [{ url: 'https://cdn.example.com/img.png', b64_json: null, revised_prompt: null }],
      })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const result = await adapter.generateImage({ prompt: 'a cat', size: '2K', ratio: '16:9' })
      const { url, opts } = fetchMock.calls[0]
      expect(url).toBe('https://api.agnes-ai.cn/v1/images/generations')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('agnes-image-2.5-flash')
      expect(body.size).toBe('2K')
      expect(body.extra_body).toEqual({ response_format: 'url' })
      expect(body.response_format).toBeUndefined()
      expect(result.urls).toEqual(['https://cdn.example.com/img.png'])
    })

    // 回归保护（2026-10-02 fix-s2v-portrait-image-aspect）：Story2Video 流水线（agnes-multimodal
    // 实测路径，项目 mur2tzc8_ru1r）经 asset-generator 传 aspect_ratio 契约键，委托链必须
    // 完整保留，最终落入 Agnes 请求体 ratio 字段（历史断链：静默回退 16:9 横屏）。
    it('generateImage 委托链保留 aspect_ratio 契约键 → 请求体 ratio（2026-10-02 回归）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({
        created: 1780000000,
        data: [{ url: 'https://cdn.example.com/img.png', b64_json: null, revised_prompt: null }],
      })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const result = await adapter.generateImage({ prompt: 'a cat', size: '2K', aspect_ratio: '9:16' })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.ratio).toBe('9:16')
      expect(result.urls).toEqual(['https://cdn.example.com/img.png'])
    })
  })

  describe('预设契约（model-provider-seeds）', () => {
    it('agnes-multimodal 预设存在，声明 ≥2 能力且 capability_models 对齐', () => {
      const preset = PRESET_PROVIDERS.find(p => p.id === 'agnes-multimodal')
      expect(preset).toBeDefined()
      expect(preset.category).toBe('multimodal')
      expect(preset.base_url).toBe('https://api.agnes-ai.cn/v1')
      expect(preset.capabilities).toEqual(['llm', 'image', 'video'])
      expect(preset.capabilities.length).toBeGreaterThanOrEqual(2)
      expect(preset.capability_models).toEqual({
        llm: 'agnes-3.0-flash',
        image: 'agnes-image-2.5-flash',
        video: 'agnes-video-2.5-flash',
      })
      // capability_models 必须都在 models 列表内
      for (const modelId of Object.values(preset.capability_models)) {
        expect(preset.models).toContain(modelId)
      }
    })

    it('agnes-multimodal 预设已登记限流预算', () => {
      expect(PRESET_RATE_LIMITS['agnes-multimodal']).toBeDefined()
      expect(PRESET_RATE_LIMITS['agnes-multimodal'].rate_per_minute).toBeGreaterThanOrEqual(1)
    })
  })

  describe('审查修复回归（2026-09-16 双模型外部审查）', () => {
    it('seed:0 是合法值，不得被静默丢弃', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-seed' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await adapter.generateVideo({ prompt: 'p', seed: 0 })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.seed).toBe(0)
    })

    it('seconds 传数字时归一化为字符串（官方要求 "4"–"12"）', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-sec' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await adapter.generateVideo({ prompt: 'p', seconds: 6 })
      const body = JSON.parse(fetchMock.calls[0].opts.body)
      expect(body.seconds).toBe('6')
    })

    it('reference 模式 images > 5 抛 INVALID_CONFIG，不发起请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const images = ['https://a.png', 'https://b.png', 'https://c.png', 'https://d.png', 'https://e.png', 'https://f.png']
      await expect(adapter.generateVideo({ prompt: 'p', images }))
        .rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('reference 模式 audios > 3 抛 INVALID_CONFIG，不发起请求', async () => {
      const fetchMock = createFetchMock()
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const audios = ['https://a.mp3', 'https://b.mp3', 'https://c.mp3', 'https://d.mp3']
      await expect(adapter.generateVideo({ prompt: 'p', audios }))
        .rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('getVideoStatus 纯空白 taskId 抛 INVALID_CONFIG', async () => {
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      await expect(adapter.getVideoStatus('   ')).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONFIG })
    })

    it('progress 为非有限数值（如 "80%"）时回退状态隐含值，不透传 NaN', async () => {
      const fetchMock = createFetchMock([createFetchResponse({ status: 'in_progress', progress: '80%' })])
      global.fetch = fetchMock
      const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
      const status = await adapter.getVideoStatus('vid-nan')
      expect(status.progress).toBe(0)
      expect(Number.isFinite(status.progress)).toBe(true)
    })

    it('governor 静态表包含 agnes-multimodal（rpm 20）', () => {
      const { PROVIDER_LIMITS } = require('../governor-provider-limits')
      expect(PROVIDER_LIMITS['agnes-multimodal']).toBeDefined()
      expect(PROVIDER_LIMITS['agnes-multimodal'].rpm).toBe(20)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 视频提交的「超时分类 + 不重投」守卫（PRD §3.2.5.3 缺陷①②，2026-10-25）
//
// ⚠ 错误对象照抄**沙箱 Node 实跑出来的真实形态**：
//   客户端等待超时 ⇒ DOMException，name='AbortError'、code=20、无 cause
//   连接层失败     ⇒ TypeError('fetch failed')，真码在 cause.code
// ⇒ 用「理想形态」的 fixture 会让这些锁失去意义。
// ══════════════════════════════════════════════════════════════════════════

/** 真实形态：客户端等待超时（我们的 AbortController 放弃） */
function makeClientWaitAbort () {
  const e = new Error('This operation was aborted')
  e.name = 'AbortError'
  e.code = 20
  return e
}

/** 真实形态：连接层失败（undici 把真错误放进 cause，e.message 只是 "fetch failed"） */
function makeConnectFailure (code) {
  const e = new TypeError('fetch failed')
  const cause = new Error(code)
  cause.code = code
  e.cause = cause
  return e
}

describe('AgnesMultimodalAdapter — 视频提交的超时分类与重投纪律', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    resetAllProviderSaturation()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('⭐ 客户端等待超时（AbortError）⇒ 只发 1 次请求，不重投', async () => {
    const fetchMock = vi.fn(async () => { throw makeClientWaitAbort() })
    global.fetch = fetchMock
    const adapter = new AgnesMultimodalAdapter(
      { id: 'agnes-multimodal', apiKey: 'sk-test' },
      { maxVideoAttempts: 6, retryBackoffMs: [1, 1, 1, 1, 1] }
    )

    await expect(adapter.generateVideo({ prompt: 'p' })).rejects.toMatchObject({
      code: ERROR_CODES.TIMEOUT,
      context: { timeoutKind: 'client-wait' },
    })
    // ⭐ 核心断言：**一次**请求（不是 6 次）⇒ 不会往 provider 队列里灌幽灵请求
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('连接层失败（ECONNREFUSED）⇒ 会重投（请求根本没到服务端，重投是安全的）', async () => {
    const fetchMock = vi.fn(async () => { throw makeConnectFailure('ECONNREFUSED') })
    global.fetch = fetchMock
    const adapter = new AgnesMultimodalAdapter(
      { id: 'agnes-multimodal', apiKey: 'sk-test' },
      { maxVideoAttempts: 3, retryBackoffMs: [1, 1, 1] }
    )

    await expect(adapter.generateVideo({ prompt: 'p' })).rejects.toMatchObject({
      code: ERROR_CODES.NETWORK_ERROR,
      context: { timeoutKind: 'connect' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('⭐ 客户端等待超时会进饱和度观测窗口（连续 3 次 ⇒ 判饱和）', async () => {
    global.fetch = vi.fn(async () => { throw makeClientWaitAbort() })
    const adapter = new AgnesMultimodalAdapter(
      { id: 'agnes-multimodal', apiKey: 'sk-test' },
      { maxVideoAttempts: 1, retryBackoffMs: [1] }
    )

    for (let i = 0; i < 3; i++) {
      await expect(adapter.generateVideo({ prompt: 'p' })).rejects.toBeTruthy()
    }
    const s = readSaturation('agnes-multimodal')
    expect(s.consecutiveClientTimeouts).toBe(3)
    expect(s.saturated).toBe(true)
    expect(s.pendingEstimate).toBe(3)
    // 排空估计必须**随滞留数增长**（不是固定退避）
    expect(s.estimatedDrainMs).toBe(3 * s.avgServiceMs)
  })

  it('提交成功也进观测窗口（成功耗时是排空估计的样本来源）', async () => {
    const fetchMock = createFetchMock([createFetchResponse({ video_id: 'vid-ok' })])
    global.fetch = fetchMock
    const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
    await adapter.generateVideo({ prompt: 'p' })
    const s = readSaturation('agnes-multimodal')
    expect(s.saturated).toBe(false)
    expect(s.avgServiceMs).toBeGreaterThan(0)
  })

  it('视频提交走**视频专用超时**（默认 4 分钟，覆盖实测最大服务时间 218.5s）', () => {
    const adapter = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' })
    expect(adapter._videoTimeoutMs()).toBe(240000)
    const custom = new AgnesMultimodalAdapter({ id: 'agnes-multimodal', apiKey: 'sk-test' }, { videoTimeout: 90000 })
    expect(custom._videoTimeoutMs()).toBe(90000)
  })
})
