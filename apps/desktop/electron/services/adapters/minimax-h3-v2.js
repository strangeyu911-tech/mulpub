// @ts-check
/**
 * minimax-h3-v2.js — MiniMax **H3 / v2 端点**的请求构造与响应解析（纯函数，不碰网络）
 *
 * ## 为什么单独成模块
 *
 * 现有 `minimax.js` 是 **v1 形状**（`POST /video_generation` + body 顶层 `prompt` +
 * `GET /query/video_generation?task_id=` + `file_id` 取回产物）。
 * H3 走的是**另一个端点族**：body 的提示词在 `content[]` 数组里、查询用**路径参数**、
 * 产物直接给 `content.url`、并且**回一个 `usage` 块**（`total_seconds` 等）。
 *
 * 这段「怎么把本仓的调用参数翻译成 v2 请求体 / 怎么把 v2 响应翻译成本仓的返回形状」
 * 有**多条分支**（画幅来源、时长来源、帧来源、缺 usage 的诚实边界），
 * 塞进 `minimax.js` 会把 v1 的既有实现糊成一坨 ⇒ 抽成纯函数模块：
 * 每条分支都能**单独钉死**（配套单测），v1 行为一行不动。
 *
 * ## 官方形状（platform.minimax.io 视频生成 API v2）
 *
 * - 创建：`POST {BASE}/v2/video_generation`
 *   body：`{ model, content[], resolution?, duration?, ratio?, callback_url?, aigc_watermark? }`
 *   `content[]` 元素：`{ type: 'text'|'image_url'|'video_url'|'audio_url', text?, image_url?: { url }, role? }`
 *   `role` ∈ `first_frame` / `last_frame` / `reference_image` / `reference_video` / `reference_audio` / `base_video`
 *   响应：`{ task_id }`
 * - 查询：`GET {BASE}/v2/query/video_generation/{task_id}`
 *   响应：`{ task: { id, model, status, error?, content?: { url, prompt? }, resolution, duration,
 *                   usage?: { total_seconds, input_seconds, output_seconds, input_image_count }, ratio, task_type } }`
 *   `status` ∈ `queued` / `running` / `succeeded` / `failed` / `cancelled`
 *
 * ## 三条「不复制官方枚举」的原则
 *
 * 1. **模型族只做方向性判定**（`MiniMax-H3` 前缀）⇒ 官方以后加 `MiniMax-H3-X` 也能自动生效，
 *    不用改本文件。**不**在这里硬编码官方完整的 model 枚举。
 * 2. **取值域（resolution / duration 的合法区间）不复制** ⇒ 交给上游拒。
 *    只拦**已知的错配**（v1 老档位 512P/720P/1080P 在 v2 不存在），
 *    因为那是「把 v1 的值发给 v2 端点」这一类**确定性错误**，值得在本地给一句人话。
 * 3. **画幅来源走仓内单一真源** `readAspectRatio`（`_base/aspect-ratio.js`）⇒
 *    不自造 `aspect_ratio` / `aspectRatio` / `ratio` 的优先级。
 *
 * ## 边界
 *
 * - `usage` **原样透出**（不取整、不补默认值）⇒ 上游没给就是没给；
 *   官方口径是「按 `usage.total_seconds` 计费，而不是按请求的 duration」
 *   （帧网格 + 输入素材会让两者不等）⇒ 补一个猜出来的值就是错账。
 * - 产物 `content.url` **是限时链接**（官方任务窗口 7 天）⇒ 本仓既有下载流程负责落盘。
 */

const { readAspectRatio } = require('./_base/aspect-ratio')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

/** H3 族模型前缀（方向性判定，不复制官方完整枚举） */
const H3_MODEL_PREFIX = 'MINIMAX-H3'

/** v2 支持的画幅集合（官方枚举，见 PRD §3.3） */
const H3_RATIOS = Object.freeze(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])

/** v1 的老分辨率档位：v2 端点没有这些值 ⇒ 方向性拦截（不枚举 v2 的合法值） */
const V1_ONLY_RESOLUTIONS = Object.freeze(['512P', '720P', '1080P'])

/** 参考素材允许的 URL 形态（官方：公网 URL / mm_file://file_id / data: URI） */
const REF_URL_PATTERN = /^(?:https?:\/\/|mm_file:\/\/|data:)/i

/** 缺省时长（秒）。与 v1 的 6 秒一致，且落在官方 4–15 区间内。 */
const DEFAULT_DURATION = 6

/** 缺省分辨率。768P 对 H3 与 H3-Max 都合法。 */
const DEFAULT_RESOLUTION = '768P'

/**
 * 该模型是否走 v2 端点（H3 族）。
 * @param {string} model
 * @returns {boolean}
 */
function isH3Model (model) {
  if (typeof model !== 'string') return false
  return model.trim().toUpperCase().startsWith(H3_MODEL_PREFIX)
}

/**
 * 推导 v2 基址。
 *
 * **不内置任何官方域名**（国内/国际站域名在第三方资料里互相矛盾，赌错就是 401/解析失败）⇒
 * 只做「同域换版本」推导：
 *   `https://api.minimaxi.com/v1` → `https://api.minimaxi.com/v2`
 *   `https://api.minimax.io/v1`  → `https://api.minimax.io/v2`
 *   `https://api.minimaxi.com`    → `https://api.minimaxi.com/v2`
 * ⇒ 用户配哪个站就打到哪个站，**跨站不需要改代码**。
 *
 * 显式配置 `credentials.baseUrlV2` 优先（用于代理/网关等非「同域换版本」的场景）。
 *
 * @param {object} credentials
 * @returns {string}
 */
function resolveV2BaseUrl (credentials) {
  const creds = (credentials && typeof credentials === 'object') ? credentials : {}
  const explicit = typeof creds.baseUrlV2 === 'string' ? creds.baseUrlV2.trim() : ''
  if (explicit) return explicit.replace(/\/+$/, '')
  const base = typeof creds.baseUrl === 'string' ? creds.baseUrl.trim() : ''
  if (!base) return ''
  if (/\/v2$/i.test(base)) return base.replace(/\/+$/, '')
  if (/\/v1$/i.test(base)) return base.replace(/\/v1$/i, '/v2')
  return base.replace(/\/+$/, '') + '/v2'
}

/**
 * 由宽高推导画幅（宽高比化简后必须落在官方集合内，否则返回空串）。
 * 影视工程的 `buildShotSubmitPayload` 只给 `width/height`（1280x720 / 720x1280），
 * 不给画幅 ⇒ 这是本仓调用面能表达画幅的**唯一现成通道**。
 *
 * @param {*} width
 * @param {*} height
 * @returns {string} 画幅（如 '16:9'）；推不出返回 ''
 */
function deriveRatioFromSize (width, height) {
  const w = Math.round(Number(width))
  const h = Math.round(Number(height))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return ''
  const gcd = (a, b) => (b ? gcd(b, a % b) : a)
  const g = gcd(w, h) || 1
  const ratio = `${w / g}:${h / g}`
  return H3_RATIOS.includes(ratio) ? ratio : ''
}

/**
 * 解析画幅。
 *
 * 优先级：显式画幅（`readAspectRatio` 单一真源）→ 由宽高推导 → 有帧则 adaptive → 报错。
 *
 * ⚠ **有帧时恒为 `adaptive`**：官方对图生视频的 ratio 是「由图决定、恒为 adaptive」，
 * 传别的值会被**接受但忽略**（官方原话：最糟的三种结果之一，因为没有任何提示）⇒
 * 适配器统一发 `adaptive`，避免出现「看起来传了画幅、实际没生效」的静默失效。
 *
 * @param {object} params
 * @param {{ hasFrame: boolean }} opts
 * @returns {string}
 */
function resolveRatio (params, opts) {
  const explicit = readAspectRatio(params)
  if (explicit) {
    if (!H3_RATIOS.includes(explicit)) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        `不支持的画幅「${explicit}」，MiniMax H3 支持：${H3_RATIOS.join(' / ')}`,
        { providerId: 'minimax' },
      )
    }
    return opts && opts.hasFrame ? 'adaptive' : explicit
  }
  const derived = deriveRatioFromSize(params && params.width, params && params.height)
  if (derived) return opts && opts.hasFrame ? 'adaptive' : derived
  if (opts && opts.hasFrame) return 'adaptive'
  throw new ProviderError(
    ERROR_CODES.INVALID_CONFIG,
    'MiniMax H3 文生视频必须指定画幅（ratio 或 aspect_ratio），支持：' + H3_RATIOS.filter(r => r !== 'adaptive').join(' / '),
    { providerId: 'minimax' },
  )
}

/**
 * 归一化参考素材 URL。
 * ⛔ 裸 base64 **不猜 MIME**（猜错 = 发出一个「能提交但图裂了」的请求）⇒ 直接拒绝并说人话。
 *
 * @param {*} value
 * @returns {string} 归一后的 URL；没有值返回 ''
 */
function normalizeRefUrl (value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!REF_URL_PATTERN.test(trimmed)) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      '参考素材必须是完整 URL（http/https）、mm_file://file_id 或 data: URI；不支持裸 base64（无法判定 MIME）',
      { providerId: 'minimax' },
    )
  }
  return trimmed
}

/**
 * 构造 v2 的 `content[]`。
 *
 * ⚠ 官方要求**任何模式都至少有一个非空 text 项**（否则 400 / code 2013）⇒ 本地先拦。
 *
 * @param {object} params
 * @returns {Array<object>}
 */
function buildContent (params) {
  const p = (params && typeof params === 'object') ? params : {}
  const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : ''
  if (!prompt) {
    throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.prompt is required', { providerId: 'minimax' })
  }
  const content = [{ type: 'text', text: prompt }]
  const first = normalizeRefUrl(p.firstFrameImage) || normalizeRefUrl(p.image)
  if (first) content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' })
  const last = normalizeRefUrl(p.lastFrameImage)
  if (last) content.push({ type: 'image_url', image_url: { url: last }, role: 'last_frame' })
  return content
}

/**
 * 解析时长（秒）。
 * 优先级：显式 `duration` → 由 `numFrames/frameRate` 推导 → 缺省 6。
 * ⚠ 官方内部按帧网格取整（17n+5 @24fps）⇒ 实际产出秒数由上游说了算，
 *    本仓**不冒充**知道它 ⇒ 真实秒数以轮询返回的 `usage.total_seconds` 为准。
 *
 * @param {object} params
 * @returns {number}
 */
function resolveDuration (params) {
  const p = (params && typeof params === 'object') ? params : {}
  const explicit = Number(p.duration)
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit)
  const frames = Number(p.numFrames !== undefined ? p.numFrames : p.num_frames)
  const fps = Number(p.frameRate !== undefined ? p.frameRate : p.frame_rate)
  if (Number.isFinite(frames) && frames > 0 && Number.isFinite(fps) && fps > 0) {
    return Math.max(1, Math.round(frames / fps))
  }
  return DEFAULT_DURATION
}

/**
 * 解析分辨率。
 * ⛔ v1 老档位（512P/720P/1080P）在 v2 端点不存在 ⇒ 本地拦（确定性错误，值得一句人话）。
 * ⚠ v2 的合法取值域**不复制**（官方会自己拒），避免官方改档位后本地变成第二份真源。
 *
 * @param {object} params
 * @returns {string}
 */
function resolveResolution (params) {
  const p = (params && typeof params === 'object') ? params : {}
  const raw = typeof p.resolution === 'string' ? p.resolution.trim() : ''
  if (!raw) return DEFAULT_RESOLUTION
  if (V1_ONLY_RESOLUTIONS.includes(raw.toUpperCase())) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `MiniMax H3（v2 端点）不支持 v1 的分辨率档位「${raw}」，请改用 768P 或 2K`,
      { providerId: 'minimax' },
    )
  }
  return raw
}

/**
 * 构造 v2 创建请求体。
 *
 * @param {object} params
 * @param {string} model
 * @returns {{ model: string, content: Array<object>, resolution: string, duration: number, ratio: string, aigc_watermark?: boolean }}
 */
function buildCreateBody (params, model) {
  const p = (params && typeof params === 'object') ? params : {}
  const content = buildContent(p)
  const hasFrame = content.length > 1
  const body = {
    model,
    content,
    resolution: resolveResolution(p),
    duration: resolveDuration(p),
    ratio: resolveRatio(p, { hasFrame }),
  }
  // aigc_watermark：只在调用方显式给出时透传（不设默认值 ⇒ 不改变官方默认行为）
  if (p.aigcWatermark !== undefined || p.aigc_watermark !== undefined) {
    body.aigc_watermark = !!(p.aigcWatermark !== undefined ? p.aigcWatermark : p.aigc_watermark)
  }
  return body
}

/**
 * v2 状态 → 本仓状态。
 * ⚠ 未知状态一律归 `processing`（保守：轮询方会继续等，而不是误判成终态）。
 *
 * @param {*} status
 * @returns {'processing'|'completed'|'failed'|'cancelled'}
 */
function mapTaskStatus (status) {
  const s = String(status || '').trim().toLowerCase()
  if (s === 'succeeded' || s === 'success') return 'completed'
  if (s === 'failed' || s === 'fail') return 'failed'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'processing'
}

/**
 * 解析 v2 查询响应。
 *
 * @param {*} data - `{ task: {...} }`
 * @returns {{
 *   status: string, rawStatus: string, videoUrl: string, progress: number,
 *   usage: object|null, resolution: string, duration: number,
 *   ratio: string, taskType: string, model: string, error: object|null
 * }}
 */
function parseTaskResponse (data) {
  const task = (data && typeof data === 'object' && data.task && typeof data.task === 'object') ? data.task : null
  if (!task) {
    throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'Missing task in response', { providerId: 'minimax' })
  }
  const status = mapTaskStatus(task.status)
  const content = (task.content && typeof task.content === 'object') ? task.content : {}
  const usage = (task.usage && typeof task.usage === 'object') ? task.usage : null
  return {
    status,
    rawStatus: String(task.status || ''),
    videoUrl: typeof content.url === 'string' ? content.url : '',
    progress: status === 'completed' ? 100 : 0,
    // ⚠ usage 原样透出：官方计费口径是 usage.total_seconds（不是请求的 duration）
    usage,
    resolution: typeof task.resolution === 'string' ? task.resolution : '',
    duration: Number.isFinite(Number(task.duration)) ? Number(task.duration) : 0,
    ratio: typeof task.ratio === 'string' ? task.ratio : '',
    taskType: typeof task.task_type === 'string' ? task.task_type : '',
    model: typeof task.model === 'string' ? task.model : '',
    error: (task.error && typeof task.error === 'object') ? task.error : null,
  }
}

/**
 * 判断这个错误是不是「**端点不认识这个 task**」。
 *
 * 用途：轮询时 v1 端点报错要不要**回落试 v2**。
 * ⛔ 鉴权（401）/ 限流（429）/ 余额（402）/ 5xx **不回落** —— 换一个端点也是同样结果，
 *    多发一次请求只是放大上游压力。
 *
 * 判别依据（不用错误文案，靠**状态码的位数**）：
 *   - MiniMax 业务码（`base_resp.status_code`）是 **4 位**（1004/2056…）⇒ 端点回答了「不认识」；
 *   - HTTP 状态码是 **3 位** ⇒ 其中只有 404 属于「不认识这个 task」。
 * ⇒ 「业务码 4 位」与「HTTP 404」合起来才是可回落信号。
 *
 * @param {*} error
 * @returns {boolean}
 */
function isTaskUnknownError (error) {
  if (!(error instanceof ProviderError)) return false
  const status = Number(error.context && error.context.statusCode)
  if (!Number.isFinite(status)) return false
  if (status >= 1000) return true
  return status === 404
}

/**
 * 从错误响应体里取可读消息。
 * v1：`base_resp.status_msg`；v2：`error.message`（OpenAI 风格）。两种都认。
 *
 * @param {*} body
 * @returns {string}
 */
function extractErrorMessage (body) {
  if (!body) return ''
  if (typeof body === 'string') return body
  if (typeof body !== 'object') return ''
  if (body.base_resp && typeof body.base_resp === 'object' && body.base_resp.status_msg) {
    return String(body.base_resp.status_msg)
  }
  if (body.error && typeof body.error === 'object' && body.error.message) {
    return String(body.error.message)
  }
  if (body.message) return String(body.message)
  return ''
}

module.exports = {
  H3_RATIOS,
  V1_ONLY_RESOLUTIONS,
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
}
