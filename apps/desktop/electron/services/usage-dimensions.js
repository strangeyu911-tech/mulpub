// @ts-check
/**
 * usage-dimensions — 从「请求参数 + 适配器响应」里抽出官方算力成本归集需要的用量维度。
 *
 * 为什么单独成模块：这段判定有**多套来源形状**（各家适配器返回体不一样），
 * 塞在 `model-provider-manager._writeLog` 里会变成一坨没法单独测的 if。
 * 抽成纯函数 ⇒ 形状假设可以被**逐条钉死**（配套单测），而不是靠人肉读。
 *
 * ⚠ **权威来源优先**：官方 API 自己回的 `usage` 块（MiniMax H3 v2 的
 *   `usage { total_seconds, input_seconds, output_seconds, input_image_count }`）
 *   永远排第一；请求侧参数（`params.duration` / `params.text` / `params.n`）是**兜底**，
 *   因为「请求要 10 秒」与「实际出了 10 秒」在多数场景相等，但不是恒等。
 * ⚠ 抽不到就是抽不到 ⇒ 返回 0（**不猜、不用默认值填充**）——
 *   填一个猜出来的值比 0 更坏（成本会算错，而且看不出来）。
 *
 * ⚠ 本模块**不计算成本**：成本一律由 ops-center 按价格卡算（客户端报成本只用于对拍）。
 */

/** 取第一个「有限且 > 0 的数」；没有就返回 0。 */
function positiveNumber (...values) {
  for (const v of values) {
    if (v === undefined || v === null) continue
    if (typeof v === 'boolean') continue
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || n <= 0) continue
    return n
  }
  return 0
}

/** 取第一个非空字符串。 */
function firstString (...values) {
  for (const v of values) {
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (s) return s
  }
  return ''
}

/**
 * 抽出用量维度。
 *
 * @param {object} [input]
 * @param {object} [input.params] - 请求侧参数（`model-provider-manager` 传 `context.params`）
 * @param {object} [input.result] - 适配器响应（`context.result`）
 * @returns {{spec: string, duration_seconds: number, item_count: number, char_count: number}}
 */
function extractUsageDimensions (input) {
  const params = (input && typeof input.params === 'object' && input.params) || {}
  const result = (input && typeof input.result === 'object' && input.result) || {}
  const usage = (result.usage && typeof result.usage === 'object' && result.usage) || {}

  // ── 规格（价格卡按 spec 精确匹配；缺它 ⇒ 同模型多档价可能命中错卡）──
  const spec = firstString(
    params.spec,
    params.resolution,
    params.size,
    params.quality,
    usage.spec,
    result.spec,
    result.resolution,
  )

  // ── 秒数（视频/音频按秒计价）──
  const durationSeconds = positiveNumber(
    usage.total_seconds,
    usage.totalSeconds,
    result.duration_seconds,
    result.durationSeconds,
    result.duration,
    result.seconds,
    params.duration,
    params.durationSec,
  )

  // ── 张数（图像按张计价）──
  let itemCount = positiveNumber(
    usage.output_image_count,
    usage.outputImageCount,
    result.imageCount,
    result.image_count,
    result.count,
    result.n,
    params.n,
    params.count,
  )
  if (!itemCount && Array.isArray(result.images) && result.images.length > 0) {
    itemCount = result.images.length
  }

  // ── 字符数（语音按字符计价）──
  let charCount = positiveNumber(
    usage.characters,
    usage.total_chars,
    usage.totalChars,
    usage.char_count,
    result.characters,
    result.char_count,
    result.charCount,
  )
  if (!charCount && typeof params.text === 'string' && params.text.length > 0) {
    // TTS 的计费单位就是输入文本字符数 ⇒ 请求侧是权威来源
    charCount = params.text.length
  }

  return {
    spec,
    duration_seconds: Math.round(durationSeconds),
    item_count: Math.round(itemCount),
    char_count: Math.round(charCount),
  }
}

module.exports = { extractUsageDimensions }
