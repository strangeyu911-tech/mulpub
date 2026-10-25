// @ts-check
/**
 * explainer-remotion-render — Remotion 渲染的**产物有效性**判定（成败判据落在产物上，不在退出码上）
 *
 * ## 为什么单独一个模块
 *
 * ⚠ **仓内既有事实**：Remotion 渲染实测「CLI 抛 TimeoutError 但 mp4 完全有效」
 *   （1920×1080 / 30fps / h264+aac / 502 帧 / 2.9MB，抽帧是真实画面）。
 * ⇒ 只读退出码的一方会把一次成功报成失败。
 *
 * ⚠ **原实现的恢复路径是死代码**（读代码时发现，本轮修掉）：
 *   - `RenderEngine.render()` **从不 reject**，CLI 非零退出时 resolve `{success:false, error:...}`，
 *     **且不带 outputPath** ⇒ 调用方拿不到产物路径；
 *   - `RenderEngine.getStatus()` 只返回 `{ready, composerExists, nodeModulesExist, composerDir}`
 *     ⇒ **永远不含 outputPath** ⇒ 「从 status 里捞路径」这条路不存在；
 *   ⇒ 结果：Remotion 其实出了片，P5a 仍判定失败并**静默回落**到 ffmpeg 图片轮播。
 *
 * ## 修法（只动本片，不动共享的 render-engine.js）
 *
 * ① compose 阶段**显式指定 outputPath** 传给 `render()` ⇒ P5a 知道该去哪儿找产物；
 * ② 渲染返回后**以产物有效性判定成败**：
 *    - `success === true` ⇒ 直接用（仍做一次存在性确认）；
 *    - `success === false` ⇒ **有界等待**产物落盘（CLI 超时退出后渲染子进程可能仍在写盘），
 *      再用 ffprobe 判「有视频流 + 时长 > 0」⇒ 有效即**按 Remotion 成功**处理；
 * ③ 产物确实无效 ⇒ 才回落 ffmpeg，并由 compose 阶段如实登记 `render_fallback_reason`。
 *
 * ⚠ **为什么不动 `render-engine.js`**：它是 story2video quick-render 等共用模块，
 *   改它的成败语义会波及那些线；本片只需要「自己指定路径 + 自己判产物」⇒ 局部改、零外溢。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { probeContainer } = require('./explainer-media-probe')

/** 失败后等待产物落盘的上限（CLI 超时退出后，渲染子进程可能仍在写盘） */
const DEFAULT_ARTIFACT_WAIT_MS = 30000
/** 等待轮询间隔 */
const DEFAULT_POLL_INTERVAL_MS = 1000

/**
 * 产物落盘后的**稳定判据**：文件大小连续两次轮询不变 ⇒ 认为写完了。
 * ⚠ 不能只看「文件存在」——ffmpeg/mp4 写一半时 ffprobe 也能读出 moov，读数会失真。
 */
const STABLE_SIZE_ROUNDS = 2

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Remotion 成片的落盘路径（与内置 compose 的 `os.tmpdir()/story2video/**` 约定一致）。
 *
 * ⚠ **必须由本片显式指定**：`RenderEngine.render()` 不传 outputPath 时会自己生成
 *   `remotion_<timestamp>.mp4`（时间戳在调用瞬间产生）⇒ 调用方事后无从得知路径。
 *
 * @param {string} runId 流水线 runId
 * @returns {string} mp4 绝对路径
 */
function resolveRemotionOutputPath (runId) {
  // ⚠ runId 进路径前**必须消毒**：`RenderEngine.render()` 用 `shell: true` spawn，
  //   命令行是拼接的 ⇒ 路径里有空格/引号会把命令拆坏。
  const safeRunId = String(runId || 'run').replace(/[^A-Za-z0-9_-]/g, '_') || 'run'
  const dir = path.join(os.tmpdir(), 'story2video', 'explainer', safeRunId)
  return path.join(dir, 'explainer_output.mp4')
}

/**
 * 等待产物落盘并稳定。
 *
 * @param {string} outputPath
 * @param {{timeoutMs?: number, intervalMs?: number}} [options]
 * @returns {Promise<{found: boolean, size: number}>}
 */
async function waitForArtifact (outputPath, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : DEFAULT_ARTIFACT_WAIT_MS
  const intervalMs = Number(options.intervalMs) > 0
    ? Number(options.intervalMs)
    : DEFAULT_POLL_INTERVAL_MS
  const deadline = Date.now() + timeoutMs
  let lastSize = -1
  let stableRounds = 0
  while (Date.now() <= deadline) {
    if (fs.existsSync(outputPath)) {
      const size = (() => {
        try { return fs.statSync(outputPath).size } catch (_) { return 0 }
      })()
      if (size > 0 && size === lastSize) {
        stableRounds += 1
        if (stableRounds >= STABLE_SIZE_ROUNDS) return { found: true, size }
      } else {
        stableRounds = 0
      }
      lastSize = size
    }
    await sleep(intervalMs)
  }
  return { found: false, size: lastSize }
}

/**
 * 用 ffprobe 判产物**可用性**：有视频流 + 时长 > 0。
 *
 * ⚠ `probe` 可注入 ⇒ 单测不必依赖 ffmpeg（CI runner **没有** ffmpeg）。
 *
 * @param {string} outputPath
 * @param {{probe?: (p: string) => Promise<object>}} [options]
 * @returns {Promise<{usable: boolean, probe: object, reason: string}>}
 */
async function evaluateArtifact (outputPath, options = {}) {
  if (!outputPath || !fs.existsSync(outputPath)) {
    return {
      usable: false,
      probe: { valid_container: false, duration_seconds: 0, file_size_bytes: 0, issues: ['产物文件不存在'] },
      reason: '产物文件不存在：' + String(outputPath || '(空)'),
    }
  }
  const probeFn = typeof options.probe === 'function' ? options.probe : probeContainer
  const probe = await probeFn(outputPath)
  if (!probe.valid_container) {
    const detail = (probe.issues || []).slice(0, 2).join('; ') || '容器不可读'
    return { usable: false, probe, reason: '产物无效（' + detail + '）' }
  }
  return { usable: true, probe, reason: '' }
}

/**
 * **本片的成败判据入口**：渲染返回后，以产物有效性决定「算不算 Remotion 成功」。
 *
 * @param {object} options
 * @param {string} options.outputPath 显式指定的产物路径
 * @param {boolean} [options.renderReportedSuccess] `render()` 是否报告成功
 * @param {string} [options.renderError] `render()` 报告的错误（用于记录，不作为判据）
 * @param {number} [options.waitMs] 失败后等待产物落盘的上限
 * @param {number} [options.pollIntervalMs] 轮询间隔
 * @param {(p: string) => Promise<object>} [options.probe] 产物探测函数（可注入，便于单测）
 * @returns {Promise<{usable: boolean, probe: object, reason: string, recovered: boolean}>}
 *   `recovered` = CLI 报失败但产物有效（上游实测的形态）
 */
async function resolveRenderedArtifact (options = {}) {
  const outputPath = String(options.outputPath || '')
  const reportedSuccess = options.renderReportedSuccess === true
  const waitMs = Number(options.waitMs) > 0 ? Number(options.waitMs) : DEFAULT_ARTIFACT_WAIT_MS
  const pollIntervalMs = Number(options.pollIntervalMs) > 0
    ? Number(options.pollIntervalMs)
    : DEFAULT_POLL_INTERVAL_MS
  const probeOptions = typeof options.probe === 'function' ? { probe: options.probe } : {}

  if (reportedSuccess) {
    const verdict = await evaluateArtifact(outputPath, probeOptions)
    if (verdict.usable) return { ...verdict, recovered: false }
    // ⚠ 报成功但产物无效 ⇒ 也要走「等待 + 再判」（文件可能还在写）
    const waited = await waitForArtifact(outputPath, { timeoutMs: waitMs, intervalMs: pollIntervalMs })
    if (waited.found) {
      const retry = await evaluateArtifact(outputPath, probeOptions)
      if (retry.usable) return { ...retry, recovered: false }
      return { ...retry, recovered: false }
    }
    // ⚠ 成功码**不豁免**产物有效性：报告成功但产物无效 ⇒ 判失败，并说清是「成功码但产物无效」
    return { ...verdict, recovered: false, reason: 'Remotion 报告成功但产物无效：' + verdict.reason }
  }

  // ⚠ CLI 报失败 ⇒ **先看产物在不在**（上游实测：CLI TimeoutError 但 mp4 完全有效）
  const direct = await evaluateArtifact(outputPath, probeOptions)
  if (direct.usable) {
    return { ...direct, recovered: true, reason: 'CLI 报失败但产物有效（' + String(options.renderError || '未知错误') + '）' }
  }
  // 产物还没落盘 ⇒ 有界等待（渲染子进程可能仍在写盘）
  const waited = await waitForArtifact(outputPath, { timeoutMs: waitMs, intervalMs: pollIntervalMs })
  if (waited.found) {
    const retry = await evaluateArtifact(outputPath, probeOptions)
    if (retry.usable) {
      return { ...retry, recovered: true, reason: 'CLI 报失败但等待后产物有效（' + String(options.renderError || '未知错误') + '）' }
    }
    // ⚠ 产物在但不可用 ⇒ **必须带上原始错误**：它才是 `render_fallback_reason` 的根因
    return {
      usable: false,
      probe: retry.probe,
      recovered: false,
      reason: retry.reason + '；Remotion 渲染失败：' + String(options.renderError || '未知错误'),
    }
  }
  return {
    usable: false,
    probe: direct.probe,
    recovered: false,
    reason: 'Remotion 渲染失败：' + String(options.renderError || '未知错误'),
  }
}

module.exports = {
  DEFAULT_ARTIFACT_WAIT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  resolveRemotionOutputPath,
  waitForArtifact,
  evaluateArtifact,
  resolveRenderedArtifact,
}
