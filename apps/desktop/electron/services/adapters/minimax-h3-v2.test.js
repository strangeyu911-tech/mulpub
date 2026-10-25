// @ts-check
/**
 * minimax-h3-v2.test.js — MiniMax H3（v2 端点）形状模块的逐条锁定
 *
 * 这个模块的每个分支都是「一次发错就白花钱 / 一次算错就错账」的位置：
 * 画幅来源、时长来源、帧来源、usage 透出、状态映射、错误回落信号。
 * ⇒ 每条分支一个用例，钉死成**可读的断言**（不是快照）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

__registerMock('../logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() })

const {
  H3_RATIOS,
  isH3Model,
  resolveV2BaseUrl,
  deriveRatioFromSize,
  resolveRatio,
  normalizeRefUrl,
  buildContent,
  resolveDuration,
  resolveResolution,
  buildCreateBody,
  mapTaskStatus,
  parseTaskResponse,
  isTaskUnknownError,
  extractErrorMessage,
} = require('./minimax-h3-v2')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

describe('minimax-h3-v2 — 模型族与基址推导', () => {
  describe('isH3Model（方向性判定，不复制官方枚举）', () => {
    it('H3 与 H3-Max 都算 H3 族', () => {
      expect(isH3Model('MiniMax-H3')).toBe(true)
      expect(isH3Model('MiniMax-H3-Max')).toBe(true)
    })
    it('未来的 H3 变体自动生效（不钉死枚举）', () => {
      expect(isH3Model('MiniMax-H3-Turbo')).toBe(true)
    })
    it('v1 老模型不算 H3 族', () => {
      expect(isH3Model('MiniMax-Hailuo-2.3')).toBe(false)
      expect(isH3Model('MiniMax-Hailuo-02')).toBe(false)
      expect(isH3Model('T2V-01')).toBe(false)
      expect(isH3Model('I2V-01')).toBe(false)
    })
    it('非字符串 / 空值不算', () => {
      expect(isH3Model('')).toBe(false)
      expect(isH3Model(undefined)).toBe(false)
      expect(isH3Model(null)).toBe(false)
      expect(isH3Model(123)).toBe(false)
    })
  })

  describe('resolveV2BaseUrl（同域换版本，不内置官方域名）', () => {
    it('国内站 v1 ⇒ 国内站 v2（域名不变）', () => {
      expect(resolveV2BaseUrl({ baseUrl: 'https://api.minimaxi.com/v1' })).toBe('https://api.minimaxi.com/v2')
    })
    it('国际站 v1 ⇒ 国际站 v2（域名不变）', () => {
      expect(resolveV2BaseUrl({ baseUrl: 'https://api.minimax.io/v1' })).toBe('https://api.minimax.io/v2')
    })
    it('没有版本段 ⇒ 追加 /v2', () => {
      expect(resolveV2BaseUrl({ baseUrl: 'https://api.minimaxi.com' })).toBe('https://api.minimaxi.com/v2')
    })
    it('已经是 /v2 ⇒ 原样（幂等）', () => {
      expect(resolveV2BaseUrl({ baseUrl: 'https://api.minimax.io/v2' })).toBe('https://api.minimax.io/v2')
    })
    it('显式 baseUrlV2 优先（代理/网关场景）', () => {
      expect(resolveV2BaseUrl({
        baseUrl: 'https://api.minimaxi.com/v1',
        baseUrlV2: 'https://gw.example.com/minimax/v2',
      })).toBe('https://gw.example.com/minimax/v2')
    })
    it('baseUrlV2 末尾斜杠被去掉（避免拼出 //）', () => {
      expect(resolveV2BaseUrl({ baseUrlV2: 'https://gw.example.com/v2/' })).toBe('https://gw.example.com/v2')
    })
    it('没有任何基址 ⇒ 空串（由调用方报错，不猜域名）', () => {
      expect(resolveV2BaseUrl({})).toBe('')
      expect(resolveV2BaseUrl(null)).toBe('')
    })
  })
})

describe('minimax-h3-v2 — 画幅', () => {
  it('deriveRatioFromSize：宽高化简后落在官方集合内', () => {
    expect(deriveRatioFromSize(1280, 720)).toBe('16:9')
    expect(deriveRatioFromSize(720, 1280)).toBe('9:16')
    expect(deriveRatioFromSize(1000, 1000)).toBe('1:1')
  })
  it('deriveRatioFromSize：推不出官方画幅 ⇒ 空串（不硬塞）', () => {
    expect(deriveRatioFromSize(1920, 800)).toBe('')
    expect(deriveRatioFromSize(0, 720)).toBe('')
    expect(deriveRatioFromSize(undefined, undefined)).toBe('')
  })

  it('显式画幅按仓内单一真源的优先级读（aspect_ratio > aspectRatio > ratio）', () => {
    expect(resolveRatio({ aspect_ratio: '9:16', aspectRatio: '1:1', ratio: '16:9' }, { hasFrame: false })).toBe('9:16')
    expect(resolveRatio({ aspectRatio: '1:1', ratio: '16:9' }, { hasFrame: false })).toBe('1:1')
    expect(resolveRatio({ ratio: '16:9' }, { hasFrame: false })).toBe('16:9')
  })
  it('有帧时恒为 adaptive（官方对非 adaptive 是「接受但忽略」⇒ 不能静默失效）', () => {
    expect(resolveRatio({ ratio: '16:9' }, { hasFrame: true })).toBe('adaptive')
    expect(resolveRatio({}, { hasFrame: true })).toBe('adaptive')
  })
  it('无画幅时由 width/height 推导（影视工程的现成调用面）', () => {
    expect(resolveRatio({ width: 1280, height: 720 }, { hasFrame: false })).toBe('16:9')
    expect(resolveRatio({ width: 720, height: 1280 }, { hasFrame: false })).toBe('9:16')
  })
  it('文生视频既无画幅也无宽高 ⇒ 报错（官方要求 ratio 必填）', () => {
    expect(() => resolveRatio({}, { hasFrame: false })).toThrow(/必须指定画幅/)
  })
  it('不支持的画幅 ⇒ INVALID_CONFIG（报出支持集合）', () => {
    try {
      resolveRatio({ ratio: '5:4' }, { hasFrame: false })
      expect.fail('Should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError)
      expect(e.code).toBe(ERROR_CODES.INVALID_CONFIG)
      expect(e.message).toContain('5:4')
      expect(e.message).toContain('16:9')
    }
  })
  it('官方画幅集合就是那七个（集合本身被钉住）', () => {
    expect(H3_RATIOS).toEqual(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
  })
})

describe('minimax-h3-v2 — 参考素材', () => {
  it('接受 http/https、mm_file、data URI', () => {
    expect(normalizeRefUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(normalizeRefUrl('mm_file://12345')).toBe('mm_file://12345')
    expect(normalizeRefUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })
  it('裸 base64 被拒（不猜 MIME ⇒ 不发出「图裂了」的请求）', () => {
    try {
      normalizeRefUrl('iVBORw0KGgoAAAANSUhEUg')
      expect.fail('Should throw')
    } catch (e) {
      expect(e.code).toBe(ERROR_CODES.INVALID_CONFIG)
      expect(e.message).toContain('base64')
    }
  })
  it('空值 ⇒ 空串（没有素材不是错误）', () => {
    expect(normalizeRefUrl('')).toBe('')
    expect(normalizeRefUrl(undefined)).toBe('')
    expect(normalizeRefUrl(null)).toBe('')
  })
})

describe('minimax-h3-v2 — content[] 构造', () => {
  it('纯文本 ⇒ 只有一项 text', () => {
    expect(buildContent({ prompt: '海浪' })).toEqual([{ type: 'text', text: '海浪' }])
  })
  it('首帧 ⇒ image_url + role=first_frame', () => {
    const content = buildContent({ prompt: '海浪', firstFrameImage: 'https://cdn.example.com/f.png' })
    expect(content).toHaveLength(2)
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn.example.com/f.png' },
      role: 'first_frame',
    })
  })
  it('image 键是 asset-generator 的通用键 ⇒ 兜底当首帧', () => {
    const content = buildContent({ prompt: 'x', image: 'https://cdn.example.com/f.png' })
    expect(content[1].image_url.url).toBe('https://cdn.example.com/f.png')
    expect(content[1].role).toBe('first_frame')
  })
  it('firstFrameImage 优先于 image', () => {
    const content = buildContent({
      prompt: 'x',
      firstFrameImage: 'https://cdn.example.com/first.png',
      image: 'https://cdn.example.com/other.png',
    })
    expect(content[1].image_url.url).toBe('https://cdn.example.com/first.png')
  })
  it('尾帧 ⇒ role=last_frame', () => {
    const content = buildContent({
      prompt: 'x',
      firstFrameImage: 'https://cdn.example.com/first.png',
      lastFrameImage: 'https://cdn.example.com/last.png',
    })
    expect(content[2].role).toBe('last_frame')
  })
  it('空 prompt ⇒ 报错（官方要求 content 必须含非空 text）', () => {
    try {
      buildContent({ prompt: '   ' })
      expect.fail('Should throw')
    } catch (e) {
      expect(e.code).toBe(ERROR_CODES.INVALID_CONFIG)
    }
  })
})

describe('minimax-h3-v2 — 时长与分辨率', () => {
  it('显式 duration 优先', () => {
    expect(resolveDuration({ duration: 8 })).toBe(8)
  })
  it('由 numFrames/frameRate 推导（影视工程只给这两个）', () => {
    expect(resolveDuration({ numFrames: 192, frameRate: 24 })).toBe(8)
    expect(resolveDuration({ num_frames: 120, frame_rate: 24 })).toBe(5)
  })
  it('都没有 ⇒ 缺省 6', () => {
    expect(resolveDuration({})).toBe(6)
    expect(resolveDuration(null)).toBe(6)
  })
  it('分辨率缺省 768P（H3 与 H3-Max 都合法）', () => {
    expect(resolveResolution({})).toBe('768P')
  })
  it('2K 透传（v2 合法档位）', () => {
    expect(resolveResolution({ resolution: '2K' })).toBe('2K')
  })
  it('v1 老档位被拦（512P/720P/1080P 在 v2 不存在）', () => {
    for (const bad of ['512P', '720P', '1080P']) {
      try {
        resolveResolution({ resolution: bad })
        expect.fail('Should throw for ' + bad)
      } catch (e) {
        expect(e.code).toBe(ERROR_CODES.INVALID_CONFIG)
        expect(e.message).toContain(bad)
      }
    }
  })
})

describe('minimax-h3-v2 — 创建请求体', () => {
  it('形状：model/content/resolution/duration/ratio', () => {
    const body = buildCreateBody({ prompt: '海浪', ratio: '16:9', duration: 8 }, 'MiniMax-H3')
    expect(body.model).toBe('MiniMax-H3')
    expect(body.content).toEqual([{ type: 'text', text: '海浪' }])
    expect(body.resolution).toBe('768P')
    expect(body.duration).toBe(8)
    expect(body.ratio).toBe('16:9')
  })
  it('aigc_watermark 只在显式给出时透传（不改变官方默认）', () => {
    expect(buildCreateBody({ prompt: 'x', ratio: '16:9' }, 'MiniMax-H3').aigc_watermark).toBeUndefined()
    expect(buildCreateBody({ prompt: 'x', ratio: '16:9', aigcWatermark: false }, 'MiniMax-H3').aigc_watermark).toBe(false)
    expect(buildCreateBody({ prompt: 'x', ratio: '16:9', aigc_watermark: true }, 'MiniMax-H3').aigc_watermark).toBe(true)
  })
  it('有帧 ⇒ ratio 恒 adaptive', () => {
    const body = buildCreateBody({
      prompt: 'x',
      ratio: '16:9',
      firstFrameImage: 'https://cdn.example.com/f.png',
    }, 'MiniMax-H3')
    expect(body.ratio).toBe('adaptive')
  })
})

describe('minimax-h3-v2 — 响应解析', () => {
  it('状态映射', () => {
    expect(mapTaskStatus('succeeded')).toBe('completed')
    expect(mapTaskStatus('failed')).toBe('failed')
    expect(mapTaskStatus('cancelled')).toBe('cancelled')
    expect(mapTaskStatus('queued')).toBe('processing')
    expect(mapTaskStatus('running')).toBe('processing')
  })
  it('未知状态 ⇒ processing（保守：继续等，不误判终态）', () => {
    expect(mapTaskStatus('something_new')).toBe('processing')
    expect(mapTaskStatus(undefined)).toBe('processing')
  })

  it('usage 原样透出（官方计费口径的真实秒数）', () => {
    const usage = { total_seconds: 8.7, input_seconds: 1, output_seconds: 7.7, input_image_count: 1 }
    const parsed = parseTaskResponse({ task: { status: 'succeeded', usage } })
    expect(parsed.usage).toBe(usage)
    expect(parsed.usage.total_seconds).toBe(8.7)
  })
  it('缺 usage ⇒ null（不补默认值：补一个猜出来的值就是错账）', () => {
    const parsed = parseTaskResponse({ task: { status: 'succeeded' } })
    expect(parsed.usage).toBeNull()
  })
  it('产物 URL 取 content.url（v2 直接给链接，不走 file_id 检索）', () => {
    const parsed = parseTaskResponse({
      task: { status: 'succeeded', content: { url: 'https://cdn.example.com/out.mp4' } },
    })
    expect(parsed.videoUrl).toBe('https://cdn.example.com/out.mp4')
    expect(parsed.progress).toBe(100)
  })
  it('resolution / duration / ratio / task_type 原样带出（供 usage-dimensions 读 spec）', () => {
    const parsed = parseTaskResponse({
      task: { status: 'succeeded', resolution: '2K', duration: 8, ratio: '16:9', task_type: 't2va', model: 'MiniMax-H3' },
    })
    expect(parsed.resolution).toBe('2K')
    expect(parsed.duration).toBe(8)
    expect(parsed.ratio).toBe('16:9')
    expect(parsed.taskType).toBe('t2va')
    expect(parsed.model).toBe('MiniMax-H3')
  })
  it('失败任务带出 error（供调用方看到真实原因）', () => {
    const parsed = parseTaskResponse({
      task: { status: 'failed', error: { code: 1026, message: 'sensitive content' } },
    })
    expect(parsed.status).toBe('failed')
    expect(parsed.error.message).toBe('sensitive content')
  })
  it('响应缺 task ⇒ 报错（不静默当成 processing）', () => {
    try {
      parseTaskResponse({})
      expect.fail('Should throw')
    } catch (e) {
      expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
    }
  })
})

describe('minimax-h3-v2 — 错误消息与回落信号', () => {
  it('extractErrorMessage：v1 的 base_resp / v2 的 error.message / 顶层 message 都认', () => {
    expect(extractErrorMessage({ base_resp: { status_msg: 'v1 业务错' } })).toBe('v1 业务错')
    expect(extractErrorMessage({ error: { message: 'v2 业务错' } })).toBe('v2 业务错')
    expect(extractErrorMessage({ message: '顶层错' })).toBe('顶层错')
    expect(extractErrorMessage('纯文本')).toBe('纯文本')
    expect(extractErrorMessage({})).toBe('')
    expect(extractErrorMessage(null)).toBe('')
  })

  it('isTaskUnknownError：4 位 MiniMax 业务码 ⇒ 可回落（端点不认识这个 task）', () => {
    const e = new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'task not exist', { statusCode: 1004 })
    expect(isTaskUnknownError(e)).toBe(true)
  })
  it('isTaskUnknownError：HTTP 404 ⇒ 可回落', () => {
    const e = new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'not found', { statusCode: 404 })
    expect(isTaskUnknownError(e)).toBe(true)
  })
  it('isTaskUnknownError：鉴权/限流/余额/5xx ⇒ 不可回落（换端点也是同样结果）', () => {
    for (const status of [401, 403, 429, 402, 500, 502]) {
      const e = new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'x', { statusCode: status })
      expect(isTaskUnknownError(e)).toBe(false)
    }
  })
  it('isTaskUnknownError：非 ProviderError ⇒ 不可回落', () => {
    expect(isTaskUnknownError(new Error('boom'))).toBe(false)
    expect(isTaskUnknownError(null)).toBe(false)
  })
})
