// @ts-check
/**
 * explainer-narration-track — 按**上游 edit_decisions 的分段语义**合成旁白轨
 *
 * ## 为什么必须有这一层（本轮读代码时抓到的第三个、也是最严重的缺陷）
 *
 * ⚠ 上游 `edit_decisions.audio.narration` 的形状是
 *   `{segments:[{asset_id, start_seconds, end_seconds}]}` —— **只有 asset_id，没有文件路径**
 *   （`schemas/artifacts/edit_decisions.schema.json` 的 `audio.narration.segments.items`）。
 * ⚠ 而 Remotion 合成器（`packages/remotion-composer/src/Explainer.tsx:885`）只认
 *   `audio.narration.src`（一个**具体文件**）⇒ **segments 形态的 props 渲染出来是静音片**。
 * ⚠ 上游自己也不把 segments 交给合成器：它的做法是
 *   「视觉走 Remotion + 音频单独混轨 + 事后 mux」（`tools/video/video_compose.py` 的
 *   `_mux_external_audio` + `hyperframes_compose.py:1057` 读 segments）。
 * ⇒ **P5a 只做「Remotion 出画面」这一半 ⇒ 成片没有旁白**
 *   ⇒ 那是把一条有解说的成片换成无声片，比不做更糟。
 *
 * ⇒ 本模块补上上游那**另一半**：按 segments 的 `start_seconds` 把各段旁白放到时间轴上，
 *   合成一条旁白轨，供 compose 阶段 mux 到 Remotion 画面上。
 *
 * ## 为什么不改 Remotion 合成器
 *
 * 合成器是「逐字搬上游」的资产，改它等于偏离上游；
 * 而上游的架构本来就是「视觉渲染 + 混轨 + mux」⇒ 本模块走同一条路。
 *
 * ## ffmpeg 口径（与仓内既有约束一致）
 *
 * ⚠ 打包的 ffmpeg 有 `REQUIRED_FILTERS` 白名单（`apps/desktop/scripts/stage-media-tools.js`），
 *   **`adelay` / `loudnorm` 不在里面** ⇒ 不用它们。
 * ⚠ 间隙静音用 `anullsrc`（在白名单里）**作为输入**参与 `concat`，
 *   并用 `aformat` 把各输入统一到同一采样率/声道/采样格式
 *   （`concat` filter 要求所有输入参数一致，否则直接报错）。
 * ⚠ 整条轨**一次 ffmpeg 调用**拼出来 ⇒ 不产生中间文件 ⇒ 失败时不留半成品。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execTool } = require('./explainer-media-probe')
const { findFfmpeg, findFfprobe } = require('../media-tool-paths')

/** 旁白轨的时长上限（防未探测到时长时无限增长） */
const DEFAULT_TRACK_SECONDS = 1800
/** ffmpeg 单次调用超时 */
const FFMPEG_TIMEOUT_MS = 180000
/** 间隙小于这个秒数就不补静音（避免为零长片段） */
const MIN_GAP_SECONDS = 0.02

/**
 * 探测音频文件的采样率与声道布局。
 *
 * ⚠ `concat` filter 要求**所有输入**的采样率/声道/采样格式一致
 *   ⇒ 静音段必须按旁白本身的参数生成，否则 concat 直接报错。
 *
 * @param {string} filePath
 * @returns {Promise<{sampleRate: number, channelLayout: string}>}
 */
async function probeAudioFormat (filePath) {
  const ffprobe = findFfprobe()
  const fallback = { sampleRate: 44100, channelLayout: 'stereo' }
  if (!ffprobe) return fallback
  const result = await execTool(ffprobe, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels,channel_layout',
    '-of', 'json',
    filePath,
  ], 30000)
  if (!result.ok) return fallback
  try {
    const parsed = JSON.parse(result.stdout)
    const stream = (parsed.streams || [])[0] || {}
    const sampleRate = Number(stream.sample_rate)
    const channels = Number(stream.channels)
    const layout = String(stream.channel_layout || '')
    return {
      sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : fallback.sampleRate,
      channelLayout: layout || (channels === 1 ? 'mono' : channels === 2 ? 'stereo' : fallback.channelLayout),
    }
  } catch (_) {
    return fallback
  }
}

/**
 * 把 `edit_decisions.audio.narration.segments` 解析成「带文件路径的时间轴条目」。
 *
 * ⚠ **asset_id → 路径**这一步是上游 compose 阶段的责任（上游 `video_compose.py`
 *   用 `asset_manifest` 建 `asset_lookup` 再解析 cuts 的 `source`）⇒ 本模块照做。
 *
 * @param {Array<object>} segments 上游 narration segments
 * @param {object} assetLookup asset_id → asset（含 path）
 * @returns {{items: Array<{path: string, startSeconds: number, endSeconds: number}>, missing: Array<string>}}
 */
function resolveNarrationSegments (segments, assetLookup) {
  const items = []
  const missing = []
  const list = Array.isArray(segments) ? segments : []
  for (const raw of list) {
    const segment = raw && typeof raw === 'object' ? raw : {}
    const assetId = String(segment.asset_id || '')
    const asset = assetLookup && assetId ? assetLookup[assetId] : null
    const filePath = String((asset && asset.path) || '')
    if (!assetId || !filePath) {
      if (assetId) missing.push(assetId)
      continue
    }
    const startSeconds = Number(segment.start_seconds)
    if (!Number.isFinite(startSeconds) || startSeconds < 0) continue
    const endSeconds = Number(segment.end_seconds)
    items.push({
      path: filePath,
      startSeconds,
      endSeconds: Number.isFinite(endSeconds) && endSeconds > startSeconds ? endSeconds : startSeconds,
    })
  }
  items.sort((a, b) => a.startSeconds - b.startSeconds)
  return { items, missing }
}

/**
 * 合成旁白轨。
 *
 * @param {object} options
 * @param {Array<object>} options.segments 上游 `audio.narration.segments`
 * @param {object} options.assetLookup asset_id → `{path}`
 * @param {string} options.outputPath 输出的音频轨路径
 * @param {number} [options.totalSeconds] 目标总时长（不足则补静音尾巴）
 * @param {string} [options.ffmpegPath] 覆盖 ffmpeg 路径（测试用）
 * @returns {Promise<{ok: boolean, path: string, issues: Array<object>, reason: string}>}
 */
async function buildNarrationTrack (options = {}) {
  const issues = []
  const outputPath = String(options.outputPath || '')
  const { items, missing } = resolveNarrationSegments(options.segments, options.assetLookup)
  if (missing.length) {
    issues.push({
      code: 'NARRATION_ASSET_MISSING',
      message: '有 ' + missing.length + ' 个旁白段引用的 asset_id 在 asset_manifest 里找不到：' + missing.slice(0, 3).join(', '),
    })
  }
  if (!items.length) {
    return { ok: false, path: '', issues, reason: '没有可用的旁白音频段' }
  }
  const usable = items.filter(item => fs.existsSync(item.path))
  if (!usable.length) {
    issues.push({ code: 'NARRATION_FILE_MISSING', message: '旁白段引用的音频文件都不存在' })
    return { ok: false, path: '', issues, reason: '旁白音频文件不存在' }
  }
  if (usable.length !== items.length) {
    issues.push({
      code: 'NARRATION_FILE_MISSING',
      message: (items.length - usable.length) + ' 个旁白音频文件不存在，已跳过',
    })
  }

  const ffmpeg = options.ffmpegPath || findFfmpeg()
  if (!ffmpeg) {
    return { ok: false, path: '', issues, reason: 'ffmpeg 不可用，无法合成旁白轨' }
  }

  const format = await probeAudioFormat(usable[0].path)
  const totalSeconds = Number(options.totalSeconds) > 0
    ? Math.min(Number(options.totalSeconds), DEFAULT_TRACK_SECONDS)
    : DEFAULT_TRACK_SECONDS

  // ---- 组装输入列表：静音间隙用 anullsrc（白名单滤镜）现生成，参与同一次 concat ----
  const inputs = []
  const labels = []
  const filterParts = []
  let cursor = 0
  let inputIndex = 0
  const pushInput = (inputArgs, filterExpr) => {
    const idx = inputIndex
    inputs.push(...inputArgs)
    filterParts.push('[' + idx + ':a]' + filterExpr + '[a' + idx + ']')
    labels.push('[a' + idx + ']')
    inputIndex += 1
  }
  const aformat = 'aformat=sample_fmts=fltp:sample_rates=' + format.sampleRate + ':channel_layouts=' + format.channelLayout

  for (const item of usable) {
    const gap = item.startSeconds - cursor
    if (gap > MIN_GAP_SECONDS) {
      pushInput(
        ['-f', 'lavfi', '-t', gap.toFixed(3), '-i', 'anullsrc=r=' + format.sampleRate + ':cl=' + format.channelLayout],
        aformat
      )
    }
    pushInput(['-i', item.path], aformat)
    cursor = Math.max(cursor, item.startSeconds)
  }
  // 尾巴补静音（旁白结束到成片结束）⇒ 混音后总长与画面一致
  const tail = totalSeconds - cursor
  if (tail > MIN_GAP_SECONDS) {
    pushInput(
      ['-f', 'lavfi', '-t', tail.toFixed(3), '-i', 'anullsrc=r=' + format.sampleRate + ':cl=' + format.channelLayout],
      aformat
    )
  }

  const filter = filterParts.join(';') + ';' +
    labels.join('') + 'concat=n=' + labels.length + ':v=0:a=1[aout]'

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  } catch (_) { /* ignore */ }

  const result = await execTool(ffmpeg, [
    '-hide_banner', '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[aout]',
    '-c:a', 'aac', '-b:a', '128k',
    '-t', totalSeconds.toFixed(3),
    outputPath,
  ], FFMPEG_TIMEOUT_MS)

  if (!result.ok || !fs.existsSync(outputPath)) {
    issues.push({
      code: 'NARRATION_TRACK_FAILED',
      message: '旁白轨合成失败：' + String(result.stderr || result.error || '').trim().slice(0, 300),
    })
    return { ok: false, path: '', issues, reason: '旁白轨合成失败' }
  }
  return { ok: true, path: outputPath, issues, reason: '' }
}

/**
 * 把旁白轨 mux 到画面上（上游 `_mux_external_audio` 的等价物）。
 *
 * ⚠ **只取画面的视频流**（`-map 0:v:0`）：Remotion 出的片自带一条**静音** aac 轨，
 *   直接沿用会让旁白被静音轨顶掉。
 *
 * @param {object} options
 * @param {string} options.videoPath 画面（Remotion 产物）
 * @param {string} options.audioPath 旁白轨
 * @param {string} options.outputPath 输出成片
 * @param {string} [options.ffmpegPath]
 * @returns {Promise<{ok: boolean, reason: string, issues: Array<object>}>}
 */
async function muxNarration (options = {}) {
  const issues = []
  const { videoPath, audioPath, outputPath } = options
  const ffmpeg = options.ffmpegPath || findFfmpeg()
  if (!ffmpeg) return { ok: false, reason: 'ffmpeg 不可用，无法混音', issues }
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { ok: false, reason: '画面文件不存在：' + String(videoPath || '(空)'), issues }
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    return { ok: false, reason: '旁白轨不存在：' + String(audioPath || '(空)'), issues }
  }
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  } catch (_) { /* ignore */ }
  const result = await execTool(ffmpeg, [
    '-hide_banner', '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k',
    outputPath,
  ], FFMPEG_TIMEOUT_MS)
  if (!result.ok || !fs.existsSync(outputPath)) {
    issues.push({
      code: 'NARRATION_MUX_FAILED',
      message: '旁白混流失败：' + String(result.stderr || result.error || '').trim().slice(0, 300),
    })
    return { ok: false, reason: '旁白混流失败', issues }
  }
  return { ok: true, reason: '', issues }
}

module.exports = {
  DEFAULT_TRACK_SECONDS,
  MIN_GAP_SECONDS,
  probeAudioFormat,
  resolveNarrationSegments,
  buildNarrationTrack,
  muxNarration,
}
