// @ts-check
/**
 * minimax.js — MiniMax Video Adapter
 *
 * MiniMax API 关键特性：
 * - 认证: Bearer token
 * - generateVideo: POST /video_generation，请求体含 model/prompt/duration/resolution/first_frame_image/prompt_optimizer
 * - getVideoStatus: GET /query/video_generation?task_id={taskId}
 * - 异步任务模式：generateVideo 返回 task_id，通过 getVideoStatus 轮询
 * - completed 时通过 file_id 调用 /files/retrieve 获取下载 URL
 *
 * 实现的方法（capabilities）：
 *   - generateVideo()    提交视频生成任务
 *   - getVideoStatus()   查询任务状态
 *   - listModels()       静态预定义列表
 *   - testConnection()   通过最小请求验证
 *
 * ── v2（H3）分支（2026-10-25，官方算力 R5-3）──────────────────────────────
 * 上面的形状是 **v1**。MiniMax H3 走**另一个端点族**（v2）：
 *   - 创建 `POST {BASE}/v2/video_generation`，提示词在 body 的 `content[]` 数组里；
 *   - 查询 `GET {BASE}/v2/query/video_generation/{task_id}`（**路径参数**，不是 query）；
 *   - 产物直接给 `content.url`（**限时链接**），并**回 `usage` 块**（`total_seconds` 等）
 *     —— 这块 usage 就是官方算力成本归集要的「真实秒数」（官方口径：按 usage 计费，
 *     不按请求的 duration；帧网格 + 输入素材会让两者不等）。
 *
 * **v1 路径逐字保留**（只换了位置，见 `_getVideoStatusV1`）；v2 的形状知识全部在
 * `minimax-h3-v2.js`（纯函数，配套单测逐条钉死），本文件只做「选路 + 挂载」：
 *   - **选路**：`model` 是 H3 族（`MiniMax-H3` 前缀）⇒ 走 v2；否则走 v1。
 *   - **v2 基址**：**同域换版本**推导（`.../v1` ⇒ `.../v2`）⇒ 用户配国内站还是国际站都跟着走，
 *     代码里**不内置任何官方域名**（第三方资料里国内/国际域名互相矛盾，赌错就是 401/解析失败）。
 *   - **轮询选路**：先看「本进程创建时记下的 v2 任务」；记不下（进程重启）时，
 *     只有 v1 端点**回答「不认识这个 task」**才回落试 v2（鉴权/限流/余额类错误不回落，
 *     换一个端点也是同样结果）。
 */

const { BaseAdapter } = require('./_base/base')
const { ProviderError, ERROR_CODES, fromHttpStatus } = require('./_base/provider-error')
const {
  isH3Model,
  resolveV2BaseUrl,
  buildCreateBody,
  parseTaskResponse,
  extractErrorMessage,
  isTaskUnknownError,
} = require('./minimax-h3-v2')

const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'
const DEFAULT_TIMEOUT = 120000
const DEFAULT_MODEL = 'MiniMax-Hailuo-2.3'

// 静态预定义模型列表
const MINIMAX_MODELS = [
  { id: 'MiniMax-Hailuo-2.3', name: 'Hailuo 2.3', description: '最新模型，支持 768P/1080P' },
  { id: 'MiniMax-Hailuo-02', name: 'Hailuo 02', description: '支持 512P/768P/1080P + 首尾帧' },
  { id: 'T2V-01', name: 'T2V-01', description: '文生视频基础模型，720P' },
  { id: 'I2V-01', name: 'I2V-01', description: '图生视频基础模型' },
  // ── H3 族走 v2 端点（`MiniMax-H3` 前缀 ⇒ 适配器自动选路）──
  { id: 'MiniMax-H3', name: 'H3', description: '全模态视频模型（v2 端点），768P/2K，4–15 秒' },
  { id: 'MiniMax-H3-Max', name: 'H3 Max', description: 'H3 加速版（v2 端点），480P/768P，5–15 秒' },
]

class MiniMaxAdapter extends BaseAdapter {
  /**
   * @param {object} credentials
   * @param {string} credentials.apiKey - MiniMax API Key（必填）
   * @param {string} [credentials.baseUrl] - 自定义端点
   * @param {string} [credentials.baseUrlV2] - H3（v2 端点）基址；缺省时由 baseUrl「同域换版本」推导
   * @param {object} [options]
   */
  constructor(credentials, options = {}) {
    super(credentials, options)
    this.credentials.baseUrl = this.credentials.baseUrl || DEFAULT_BASE_URL
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT
    this.options.maxRetries = this.options.maxRetries || 2
    // 本进程创建过的 v2 任务（taskId → true）⇒ 轮询时不必再猜端点。
    // ⚠ 只在**同一进程**内有效：应用重启后这里是空的 ⇒ 轮询走「v1 不认识才回落 v2」。
    this._v2Tasks = new Map()
  }

  /** 验证配置：apiKey 必填 */
  validateConfig() {
    const errors = []
    if (!this.credentials.apiKey) errors.push('apiKey is required')
    if (!this.credentials.baseUrl) errors.push('baseUrl is required')
    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  }

  /** 构造请求头 — Bearer 认证 */
  _headers() {
    return {
      'Authorization': `Bearer ${this.credentials.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /**
   * 构造完整 URL（支持 query 参数）
   * @param {string} path
   * @param {object} [queryParams]
   * @param {string} [baseUrl] - 覆盖默认基址（v2 用推导出的基址）
   */
  _url(path, queryParams = {}, baseUrl = this.credentials.baseUrl) {
    const base = String(baseUrl || '').replace(/\/$/, '')
    let url = `${base}${path}`
    const entries = Object.entries(queryParams).filter(([_, v]) => v !== undefined && v !== null)
    if (entries.length > 0) {
      const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      url += `?${qs}`
    }
    return url
  }

  /**
   * 统一 fetch 包装 — 处理超时和错误转换
   */
  async _request(path, opts = {}) {
    const url = this._url(path, opts.query || {}, opts.baseUrl || this.credentials.baseUrl)
    const headers = { ...this._headers(), ...(opts.headers || {}) }
    const fetchOpts = { ...opts }
    delete fetchOpts.query
    delete fetchOpts.baseUrl

    try {
      const response = await fetch(url, { ...fetchOpts, headers })

      if (!response.ok) {
        let errorBody
        try { errorBody = await response.json() } catch (_) {
          try { errorBody = await response.text() } catch (__) { errorBody = {} }
        }
        // v1 的业务错误在 base_resp.status_msg；v2 是 OpenAI 风格（error.message）⇒ 两种都认
        const message = extractErrorMessage(errorBody) || `HTTP ${response.status}`
        throw fromHttpStatus(response.status, message, { providerId: this.id, url })
      }

      return response
    } catch (e) {
      if (e instanceof ProviderError) throw e
      const msg = e.message || String(e)
      if (msg.includes('ETIMEDOUT') || msg.includes('timeout') || msg.includes('aborted')) {
        throw new ProviderError(ERROR_CODES.TIMEOUT, msg, { providerId: this.id })
      }
      if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network')) {
        throw new ProviderError(ERROR_CODES.NETWORK_ERROR, msg, { providerId: this.id })
      }
      throw new ProviderError(ERROR_CODES.NETWORK_ERROR, msg, { providerId: this.id })
    }
  }

  /**
   * v2 专用请求包装。
   *
   * 官方 v2 的 **422 = 内容审核不通过**（不是参数错误）：同一提示词重试必然还是 422 ⇒
   * 归成 PROVIDER_ERROR 会让上游一直重试到超时。归到 CONTENT_POLICY 才能让仓内
   * 既有的「内容改写 + 重试」路径接管（`ERROR_CODES.CONTENT_POLICY`）。
   */
  async _requestV2(path, opts = {}, baseUrl) {
    try {
      return await this._request(path, { ...opts, baseUrl })
    } catch (e) {
      if (e instanceof ProviderError && Number(e.context && e.context.statusCode) === 422) {
        throw new ProviderError(
          ERROR_CODES.CONTENT_POLICY,
          e.message || 'MiniMax 内容审核不通过',
          { ...(e.context || {}), providerId: this.id },
        )
      }
      throw e
    }
  }

  /** v2 基址（同域换版本推导；显式 baseUrlV2 优先） */
  _v2BaseUrl() {
    return resolveV2BaseUrl(this.credentials)
  }

  /**
   * 提交视频生成任务
   * @param {object} params
   * @param {string} params.prompt - 生成提示词（必填）
   * @param {string} [params.model='MiniMax-Hailuo-2.3'] - 模型 ID
   * @param {number} [params.duration=6] - 视频时长（6 或 10 秒）
   * @param {string} [params.resolution='768P'] - 分辨率（512P/720P/768P/1080P）
   * @param {string} [params.firstFrameImage] - 图生视频首帧 URL 或 base64
   * @returns {Promise<{taskId: string, model: string}>}
   */
  async generateVideo(params) {
    if (!params || !params.prompt) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.prompt is required')
    }

    const model = params.model || DEFAULT_MODEL
    // ── H3 族 ⇒ v2 端点（形状完全不同，逻辑在 minimax-h3-v2.js）──
    if (isH3Model(model)) {
      return this._generateVideoV2(params, model)
    }
    const body = {
      model,
      prompt: params.prompt,
      duration: params.duration || 6,
      resolution: params.resolution || '768P',
      first_frame_image: params.firstFrameImage || undefined,
      prompt_optimizer: true,
    }

    const resp = await this._request('/video_generation', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = await resp.json()

    // MiniMax 业务错误：HTTP 200 + base_resp.status_code != 0（如额度用尽 status_code=2056，
    // 真实复现 2026-08-11：图片 Key 调视频 API 返回「已达到 Token Plan 用量上限」，此前被误报为
    // Missing task_id）。必须在读取 task_id 之前解析，给出可读错误并映射 QUOTA_EXCEEDED。
    const baseResp = data && data.base_resp
    if (baseResp && Number(baseResp.status_code) !== 0) {
      const message = baseResp.status_msg || ('MiniMax 视频生成失败（status_code=' + baseResp.status_code + '）')
      const isQuota = /额度|用量|token|quota|balance|exhausted|insufficient|超过|上限|升级/i.test(String(message))
      throw new ProviderError(
        isQuota ? ERROR_CODES.QUOTA_EXCEEDED : ERROR_CODES.PROVIDER_ERROR,
        message,
        {
          providerId: this.id,
          // P1：MiniMax 的业务错误是 HTTP 200 + base_resp.status_code。
          // statusCode 保留历史字段，httpStatus/providerCode 分开两个维度。
          statusCode: Number(baseResp.status_code),
          httpStatus: 200,
          providerCode: Number(baseResp.status_code),
        },
      )
    }

    const taskId = data.task_id
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'Missing task_id in response', { providerId: this.id })
    }

    return { taskId, model }
  }

  /**
   * v2（H3）提交：body 是 `content[]` 数组，不是顶层 prompt。
   * @param {object} params
   * @param {string} model
   * @returns {Promise<{taskId: string, model: string}>}
   */
  async _generateVideoV2(params, model) {
    const base = this._v2BaseUrl()
    if (!base) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'MiniMax H3 需要 v2 端点基址：请在服务商设置里填写 baseUrl（程序会推导同域的 /v2 基址）',
        { providerId: this.id },
      )
    }
    const body = buildCreateBody(params, model)
    const resp = await this._requestV2('/video_generation', {
      method: 'POST',
      body: JSON.stringify(body),
    }, base)
    const data = await resp.json()

    const taskId = data && data.task_id
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'Missing task_id in response', { providerId: this.id })
    }
    // 记下「这是 v2 任务」⇒ 轮询不必再猜端点（进程内）
    this._v2Tasks.set(String(taskId), true)
    return { taskId: String(taskId), model }
  }

  /**
   * 查询视频任务状态
   * @param {string|object} taskIdOrParams - 任务 ID 字符串，或 callAdapter 统一参数对象 { videoId, taskId }
   * @returns {Promise<{status: string, videoUrl: string, progress: number}>}
   */
  async getVideoStatus(taskIdOrParams) {
    // callAdapter 统一以 params 对象调用（{ videoId, taskId }）；直接调用时传字符串，两种都兼容
    // （与 agnes-video.js 同款约定）。⚠ 原实现只认字符串 ⇒ 经 callAdapter 调用时会把对象
    //    拼进 URL（`[object Object]`）⇒ 轮询必然失败；本片一并修掉，字符串形态行为不变。
    const rawTaskId = (taskIdOrParams && typeof taskIdOrParams === 'object')
      ? (taskIdOrParams.videoId || taskIdOrParams.taskId || taskIdOrParams.id)
      : taskIdOrParams
    if (!rawTaskId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'taskId is required')
    }
    const taskId = String(rawTaskId)

    // 本进程创建过的 v2 任务 ⇒ 直接走 v2
    if (this._v2Tasks.has(taskId)) {
      return this._getVideoStatusV2(taskId)
    }

    try {
      return await this._getVideoStatusV1(taskId)
    } catch (v1Error) {
      // 回落 v2：**只**在 v1 端点「不认识这个 task」时（不是鉴权/限流/余额类错误）⇒
      // 换一个端点也是同样结果时就不该多发一次请求。
      if (!isTaskUnknownError(v1Error)) throw v1Error
      try {
        const result = await this._getVideoStatusV2(taskId)
        this._v2Tasks.set(taskId, true)
        return result
      } catch (v2Error) {
        const detail = v2Error && v2Error.message ? v2Error.message : String(v2Error)
        throw new ProviderError(
          v1Error.code || ERROR_CODES.PROVIDER_ERROR,
          `${v1Error.message}（v2 端点也失败：${detail}）`,
          { ...(v1Error.context || {}), providerId: this.id },
        )
      }
    }
  }

  /**
   * v1 轮询（**既有实现逐字保留**，只从 getVideoStatus 挪到这里以便包一层回落）。
   * @param {string} taskId
   */
  async _getVideoStatusV1(taskId) {
    const resp = await this._request('/query/video_generation', {
      method: 'GET',
      query: { task_id: taskId },
    })
    const data = await resp.json()

    // 查询同样可能返回 base_resp 业务错误（额度/鉴权），先解析再映射状态
    const baseResp = data && data.base_resp
    if (baseResp && Number(baseResp.status_code) !== 0) {
      const message = baseResp.status_msg || ('MiniMax 视频任务查询失败（status_code=' + baseResp.status_code + '）')
      const isQuota = /额度|用量|token|quota|balance|exhausted|insufficient|超过|上限|升级/i.test(String(message))
      throw new ProviderError(
        isQuota ? ERROR_CODES.QUOTA_EXCEEDED : ERROR_CODES.PROVIDER_ERROR,
        message,
        {
          providerId: this.id,
          // P1：MiniMax 的业务错误是 HTTP 200 + base_resp.status_code。
          // statusCode 保留历史字段，httpStatus/providerCode 分开两个维度。
          statusCode: Number(baseResp.status_code),
          httpStatus: 200,
          providerCode: Number(baseResp.status_code),
        },
      )
    }

    // MiniMax 状态映射
    const statusMap = {
      'Preparing': 'processing',
      'Queueing': 'processing',
      'Processing': 'processing',
      'Success': 'completed',
      'Fail': 'failed',
    }
    const status = statusMap[data.status] || 'processing'
    // completed 时通过 file_id 调用 /files/retrieve 获取下载 URL（使用配置的 baseUrl）
    const videoUrl = (data.file_id && `${this.credentials.baseUrl.replace(/\/$/, '')}/files/retrieve?file_id=${data.file_id}`) || ''
    const progress = data.progress !== undefined ? Number(data.progress) : (status === 'completed' ? 100 : 0)

    return { status, videoUrl, progress }
  }

  /**
   * v2 轮询：`GET {BASE}/v2/query/video_generation/{task_id}`（**路径参数**）。
   *
   * 返回体额外带 `usage`（官方计费口径的真实秒数，原样透出）与 `resolution`/`duration`
   * ⇒ 桌面端 `usage-dimensions.js` 直接读得到 ⇒ 官方算力成本归集拿得到「这一次花了多少秒」。
   *
   * @param {string} taskId
   */
  async _getVideoStatusV2(taskId) {
    const base = this._v2BaseUrl()
    if (!base) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'MiniMax H3 需要 v2 端点基址：请在服务商设置里填写 baseUrl（程序会推导同域的 /v2 基址）',
        { providerId: this.id },
      )
    }
    const resp = await this._requestV2(
      `/query/video_generation/${encodeURIComponent(String(taskId))}`,
      { method: 'GET' },
      base,
    )
    const data = await resp.json()
    return parseTaskResponse(data)
  }

  /** 返回静态预定义模型列表 */
  async listModels() {
    return MINIMAX_MODELS.map(m => ({ ...m }))
  }

  /** 测试连接 — 通过最小请求验证 */
  async testConnection() {
    const validation = this.validateConfig()
    if (!validation.valid) {
      return { success: false, error: new ProviderError(ERROR_CODES.INVALID_CONFIG, validation.errors.join(', ')) }
    }
    try {
      await this._request('/video_generation', {
        method: 'POST',
        body: JSON.stringify({ model: DEFAULT_MODEL, prompt: 'test' }),
      })
      return { success: true }
    } catch (e) {
      if (e instanceof ProviderError && (e.code === ERROR_CODES.RATE_LIMITED || e.code === ERROR_CODES.PROVIDER_ERROR)) {
        return { success: true }
      }
      return { success: false, error: e }
    }
  }
}

module.exports = { MiniMaxAdapter, MINIMAX_MODELS }
