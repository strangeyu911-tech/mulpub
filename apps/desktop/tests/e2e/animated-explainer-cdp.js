#!/usr/bin/env node
// @ts-check
/**
 * animated-explainer-cdp.js — 「AI 讲解视频」流水线的 CDP 端到端运行器
 *
 * 用 Chrome DevTools Protocol（原生 WebSocket，不用 Playwright 的 connectOverCDP：
 * 本仓 Electron 43 上 connectOverCDP 侧握手会稳定超时，理由见 lib/cdp-client.js 头注）
 * 直接驱动**已启动的桌面端**，跑完 animated-explainer 的 8 个阶段并校验成片。
 *
 * 覆盖的阶段（apps/desktop/electron/services/pipeline-engine.js 的 stageDefs）：
 *   research → proposal → script → scenes → assets → editing → compose → publish
 *
 * 两种驱动模式：
 *   --mode=api（默认）：CDP → window.electronAPI.pipelineStartOrchestrated(...)
 *                       直接触发编排，与仓库既有 E2E（tests/e2e/video-model-pipelines.js）同款。
 *   --mode=ui ：CDP → DOM 操作真实界面（选流水线卡片 → 填主题 → 点启动），
 *                       额外覆盖前端表单校验与登录门这条链路。
 *
 * Provider：默认指向本地桩（tests/e2e/lib/local-provider-hub.js），
 * LLM 走 OpenAI 兼容端点、图片走 Stable Diffusion WebUI 兼容端点，均免 API Key。
 *
 * 用法：
 *   node apps/desktop/tests/e2e/animated-explainer-cdp.js \
 *     --cdp-port=9222 --vite-port=5174 \
 *     --llm-base-url=http://127.0.0.1:8787/v1 \
 *     --image-base-url=http://127.0.0.1:7860 \
 *     --out-dir=/tmp/explainer-out --runs=2
 *
 * 退出码：0 = 全部轮次都产出了可播放成片；1 = 有轮次失败（报告里带原因）。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const { CdpClient, sleep } = require('./lib/cdp-client')
// ffprobe 必须用仓库自己的解析（media-tool-paths）：Windows runner 的 PATH 上没有 ffprobe，
// 预置包 ffmpeg-ffprobe-static 才有；直接 spawn 'ffprobe' 在 CI 上必 ENOENT。
const { findFfprobe } = require('../../electron/services/media-tool-paths')

const DEFAULT_CDP_PORT = 9222
const DEFAULT_VITE_PORT = 5174
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/** 解析 --key=value / --key value 两种写法 */
function parseArgs (argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      args[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[body] = next
      i++
    } else {
      args[body] = 'true'
    }
  }
  return args
}

function log (...parts) {
  console.log('[explainer-cdp]', ...parts)
}

/** ffprobe 取成片规格（拿不到就返回 probe-failed，不让校验步骤整体失败） */
async function probeVideo (file) {
  const ffprobe = findFfprobe()
  if (!ffprobe) return { ok: false, error: 'ffprobe 不可用（未找到可执行文件）' }
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-show_entries', 'format=duration,size',
      '-of', 'json', file,
    ], { timeout: 20000 })
    const data = JSON.parse(stdout)
    const video = (data.streams || []).find(s => s.codec_type === 'video') || {}
    const audio = (data.streams || []).find(s => s.codec_type === 'audio') || {}
    const format = data.format || {}
    return {
      ok: true,
      videoCodec: video.codec_name || null,
      width: video.width || null,
      height: video.height || null,
      hasAudio: Boolean(audio.codec_name),
      audioCodec: audio.codec_name || null,
      durationSeconds: format.duration ? Number(Number(format.duration).toFixed(2)) : null,
      sizeBytes: format.size ? Number(format.size) : null,
    }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

/** 成片视频的合法扩展名（compose 产物） */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv'])

/**
 * 从运行快照里递归找第一个真实存在的**视频**路径。
 *
 * 只认视频扩展名是必需的：compose 的产物结构里同时挂着图片（imagePath）与
 * 分段视频（videoPath），若把 'path' 这类泛用键也当作成片，会先命中
 * `.../img_0000.png` ⇒ 报告里出现「成片是 PNG」这种假阳性。
 */
function findVideoPath (node, depth = 0, exists = fs.existsSync) {
  if (!node || typeof node !== 'object' || depth > 8) return null
  for (const key of ['videoPath', 'outputPath', 'path']) {
    const value = node[key]
    if (typeof value === 'string' && value && VIDEO_EXTENSIONS.has(path.extname(value).toLowerCase()) && exists(value)) {
      return value
    }
  }
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (value && typeof value === 'object') {
      const found = findVideoPath(value, depth + 1, exists)
      if (found) return found
    }
  }
  return null
}

class ExplainerCdpRunner {
  constructor (options) {
    // 审批模式：'guided' ⇒ 五道人工审批门真的会在阶段产出后停下来等人批（由环境变量注入，避免改运行器）
    this.options = { ...options, approvalMode: (options && options.approvalMode) || process.env.E2E_APPROVAL_MODE || '' }
    this.client = null
  }

  async connect () {
    const origin = 'http://127.0.0.1:' + this.options.vitePort
    this.client = await CdpClient.attach(this.options.cdpPort, origin, {
      retries: 30,
      backoffMs: 2000,
    })
    log('CDP 已连接：', origin)
  }

  close () {
    if (this.client) this.client.close()
    this.client = null
  }

  /** 页面内求值（带 JSON 化，避免复杂对象跨 CDP 边界时丢字段） */
  async evalJson (expression) {
    const raw = await this.client.evaluate('(async () => { return JSON.stringify(await (' + expression + ')) })()')
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch (_) { return raw }
  }

  /** 确认桌面端可用（开发模式下访问级别为 admin，免登录） */
  async probeRuntime () {
    const expression = '(async () => ({' +
      ' version: await window.electronAPI.getVersion(),' +
      ' services: (await window.electronAPI.servicesGetStatus()) || null' +
      '}))()'
    const info = await this.evalJson(expression)
    log('运行时探针：', JSON.stringify(info).slice(0, 400))
    return info
  }

  /** 把本地桩写进模型设置：LLM → OpenAI 兼容端点；图片 → SD 兼容端点 */
  async configureProviders () {
    // 回环地址的本地端点免 API Key（model-provider-manager 的 canUseWithoutApiKey
    // 按「base_url 在回环上」判定，见 model-provider-local-no-key.test.js）。
    // 远端端点仍需 Key —— 显式传 --llm-api-key 才会带上。
    const llmUpdates = {
      base_url: this.options.llmBaseUrl,
      models: ['local-explainer'],
      enabled: true,
    }
    if (this.options.llmApiKey) llmUpdates.api_key = this.options.llmApiKey
    const llm = await this.evalJson(
      '(async () => window.electronAPI.modelProviderUpdate("ollama", ' + JSON.stringify(llmUpdates) + '))()'
    )
    const image = await this.evalJson(
      '(async () => window.electronAPI.modelProviderUpdate("local-diffusion", {' +
      ' base_url: ' + JSON.stringify(this.options.imageBaseUrl) + ',' +
      ' enabled: true }))()'
    )
    log('provider 配置：ollama=' + JSON.stringify(llm).slice(0, 200))
    log('provider 配置：local-diffusion=' + JSON.stringify(image).slice(0, 200))
    if (!llm || llm.code !== 0) throw new Error('LLM provider 配置失败: ' + JSON.stringify(llm))
    if (!image || image.code !== 0) throw new Error('图片 provider 配置失败: ' + JSON.stringify(image))

    const state = await this.evalJson('(async () => ({' +
      ' llm: await window.electronAPI.modelProviderGet("ollama"),' +
      ' image: await window.electronAPI.modelProviderGet("local-diffusion")' +
      '}))()')
    const llmData = state && state.llm && state.llm.data
    const imgData = state && state.image && state.image.data
    log('provider 读回：llm configured=' + (llmData && llmData.is_configured) +
      ' base_url=' + (llmData && llmData.base_url) +
      ' | image configured=' + (imgData && imgData.is_configured) +
      ' base_url=' + (imgData && imgData.base_url))
    if (!llmData || llmData.is_configured !== true) {
      throw new Error('LLM provider 未生效（is_configured 非 true）：' + JSON.stringify(llmData))
    }
    if (!imgData || imgData.is_configured !== true) {
      throw new Error('图片 provider 未生效（is_configured 非 true）：' + JSON.stringify(imgData))
    }
    return state
  }

  /** 走 DOM 驱动真实界面 */
  async startViaUi (topic) {
    log('UI 模式：进入「视频创作」页并操作界面')
    // 导航：**不能只改 location.hash**。实测（2026-10-23）：把 hash 改成 '#/create' 后
    // location.href 确实变了，但视图仍停在首页 —— 壳层没有响应这次 hash 变更；
    // 真实用户路径是点侧边栏的「视频创作」入口，那才会挂载 CreateView。
    // 因此这里以侧边栏入口为主，hash 赋值只作为兜底。
    const navigated = await this.evalJson('(async () => {' +
      ' const entry = document.querySelector(\'[data-testid="mp-primary-create"]\');' +
      ' if (entry) { entry.click(); return "sidebar"; }' +
      ' location.hash = "#/create"; return "hash";' +
      '})()')
    log('导航方式：', navigated)
    await this.client.waitFor(
      '!!document.querySelector(\'[data-pipeline-id="animated-explainer"]\')',
      { timeout: 90000, interval: 1000, label: 'pipeline-card' }
    )
    const clicked = await this.evalJson('(async (approvalMode) => {' +
      ' const card = document.querySelector(\'[data-pipeline-id="animated-explainer"]\');' +
      ' if (!card) return { ok: false, reason: "no-card" };' +
      ' card.click();' +
      ' await new Promise(r => setTimeout(r, 1200));' +
      ' const area = document.querySelector(".input-area textarea.form-textarea");' +
      ' if (!area) return { ok: false, reason: "no-textarea" };' +
      ' area.value = ' + JSON.stringify(topic) + ';' +
      ' area.dispatchEvent(new Event("input", { bubbles: true }));' +
      ' await new Promise(r => setTimeout(r, 800));' +
      ' if (approvalMode) {' +
      '   const sel = document.querySelector(\'[data-testid="explainer-approval-mode-select"]\');' +
      '   if (sel) { sel.value = approvalMode; sel.dispatchEvent(new Event("change", { bubbles: true }));' +
      '     sel.dispatchEvent(new Event("input", { bubbles: true })); }' +
      ' }' +
      ' await new Promise(r => setTimeout(r, 400));' +
      ' const btn = document.querySelector(\'[data-testid="start-story2video"]\');' +
      ' if (!btn) return { ok: false, reason: "no-button" };' +
      ' const disabled = btn.disabled === true;' +
      ' btn.click();' +
      ' return { ok: true, disabled }' +
      '})(' + JSON.stringify(this.options.approvalMode || '') + ')')
    log('UI 操作结果：', JSON.stringify(clicked))
    if (!clicked || clicked.ok !== true) throw new Error('UI 驱动失败: ' + JSON.stringify(clicked))
    if (clicked.disabled === true) throw new Error('启动按钮处于禁用态（主题未写入或流水线不可用）')
    return clicked
  }

  /** 走编排 API 触发 */
  async startViaApi (topic) {
    const params = {
      text: topic,
      inputMode: 'text',
      // 审批模式：'guided' ⇒ 上游五道人工审批门真的会在阶段产出后停下来等人批
      checkpointPolicy: this.options.approvalMode || 'none',
      autoAdvance: true,
      background: true,
      storyboardMode: 'auto',
      style: 'clean-professional',
      resolution: this.options.resolution,
      aspectRatio: this.options.aspectRatio,
      fps: this.options.fps,
      format: 'mp4',
      subtitleEnabled: this.options.subtitleEnabled,
    }
    // 并发闸：设备上已有流水线在跑时，启动会被拒（PIPELINE_CONCURRENCY_LIMIT）。
    // 这是**正常的产品行为**，不是故障 —— 等待后重试即可，不该直接判定失败。
    const maxWaitMs = this.options.concurrencyWaitMs || 10 * 60 * 1000
    const deadline = Date.now() + maxWaitMs
    let attempt = 0
    while (true) {
      attempt++
      const result = await this.evalJson(
        '(async () => window.electronAPI.pipelineStartOrchestrated("animated-explainer", ' +
        JSON.stringify(params) + '))()'
      )
      const errorCode = result && result.data && result.data.errorCode
      if (result && result.code === 0 && result.data && result.data.success) {
        log('启动返回：', JSON.stringify(result).slice(0, 300))
        const runId = result.data.runId
        if (!runId) throw new Error('启动返回里没有 runId: ' + JSON.stringify(result))
        return runId
      }
      if (errorCode === 'PIPELINE_CONCURRENCY_LIMIT' && Date.now() < deadline) {
        const waitMs = Math.min(30000, 5000 * attempt)
        log('并发已满（' + JSON.stringify(result.data.errorParams || {}) + '），' + waitMs + 'ms 后重试')
        await sleep(waitMs)
        continue
      }
      log('启动返回：', JSON.stringify(result).slice(0, 400))
      throw new Error('启动失败: ' + JSON.stringify(result))
    }
  }

  /** 轮询运行快照直到终态 */
  async waitForRun (runId, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    let lastStage = ''
    while (Date.now() < deadline) {
      const snapshot = await this.evalJson(
        '(async () => window.electronAPI.pipelineGetRunContext(' + JSON.stringify(runId) + '))()'
      ).catch(() => null)
      const data = snapshot && snapshot.data ? snapshot.data : null
      if (data) {
        const stage = (data.status && data.status.currentStage) || data.currentStage || ''
        const status = (data.status && data.status.status) || ''
        if (stage !== lastStage) {
          lastStage = stage
          log('阶段推进 →', stage || '(等待)', '状态=' + status)
        }
        if (TERMINAL_STATUSES.has(status)) return data
      }
      if (this.options.approvalMode === 'guided') {
        const gate = await this.approveGateIfPresent(runId)
        if (gate) {
          this.approvalGates = this.approvalGates || []
          // ⚠ **加门序号**：门名取自 `checkpoint.stageName`（引擎的当前阶段口径），
          //   某些时刻它与「刚被批准的那道门」不完全对齐 ⇒ 门名不可作唯一证据；
          //   ⇒ 序号 + 门序（第 N 道门）是**与门名无关**的独立证据。
          this.approvalGates.push({ ...gate, seq: this.approvalGates.length + 1 })
          log('审批门已批准：', JSON.stringify(this.approvalGates[this.approvalGates.length - 1]))
        }
      }
      await sleep(2000)
    }
    throw new Error('等待运行结束超时（' + timeoutMs + 'ms），最后阶段=' + lastStage)
  }

  /**
   * 人工审批门：检测弹窗 → （G1）选渲染引擎 → 点「批准并继续」。
   * UI 模式下弹窗真实存在 ⇒ 走 DOM（顺带验证渲染层）；API 模式没有弹窗 ⇒ 回退 IPC（验主进程链路）。
   */
  async approveGateIfPresent (runId) {
    // ⚠ **runtime 必须选「非默认的那个」**（ffmpeg）⇒ 否则测不出「门批准后重跑把用户选择冲掉」这个缺陷
    //   （默认就是 remotion ⇒ 冲掉后仍是 remotion ⇒ 断言恒真）。
    const runtime = this.options.approvalRuntime || 'remotion'
    const runtimeTestId = runtime === 'ffmpeg'
      ? 'explainer-approval-gate-runtime-ffmpeg'
      : 'explainer-approval-gate-runtime-remotion'
    const viaUi = await this.evalJson('(async (runtimeTestId) => {' +
      ' const content = document.querySelector(\'[data-testid="explainer-approval-gate-content"]\');' +
      ' if (!content) return { ok: false, reason: "no-gate" };' +
      ' const radio = document.querySelector(\'[data-testid="' + runtimeTestId + '"]\');' +
      ' if (radio) { radio.click(); await new Promise(r => setTimeout(r, 300)); }' +
      ' const idx = document.querySelector(\'[data-testid="explainer-approval-gate-index"]\');' +
      ' const btn = document.querySelector(\'[data-testid="explainer-approval-gate-approve"]\');' +
      ' if (!btn) return { ok: false, reason: "no-approve-button" };' +
      ' if (btn.disabled) return { ok: false, reason: "approve-disabled" };' +
      ' btn.click();' +
      ' return { ok: true, gate: idx ? String(idx.textContent || "").trim() : "", runtime };' +
      '})(' + JSON.stringify(runtimeTestId) + ')').catch(() => null)
    if (viaUi && viaUi.ok) return { via: 'ui', gate: viaUi.gate || '', runtime }
    if (viaUi && viaUi.reason === 'no-gate') {
      // UI 模式没有弹窗 ⇒ 可能还没到门；API 模式 ⇒ 直接问主进程当前是不是门
      // ⚠⚠⚴ **必须用带 runId 的 `pipelineApprovalGate`**：
      //   旧写法用 `pipelineStatus("animated-explainer")`（**不带 runId**）⇒ 拿到的是
      //   「最近一次/当前活跃运行」的 checkpoint ⇒ 与本 run 的门**可能不是同一个**
      //   ⇒ 实测把 assets 门记成了 scenes ⇒ **读数点错了**（不是引擎滞后）。
      const probed = await this.evalJson(
        '(async () => window.electronAPI.pipelineApprovalGate(' + JSON.stringify(runId) + '))()'
      ).catch(() => null)
      if (!probed || probed.code !== 0) return null
      const stage = String((probed.data && probed.data.stage) || '')
      if (!stage) return null
      const gateType = String((probed.data && probed.data.payload && probed.data.payload.type) || '')
      const approve = await this.evalJson(
        '(async () => window.electronAPI.pipelineApproveStageGate(' + JSON.stringify(runId) +
        ', { stage: ' + JSON.stringify(stage) + ', renderRuntime: ' + JSON.stringify(runtime) + ' }))()'
      ).catch(() => null)
      if (!approve || approve.code !== 0) return null
      return { via: 'ipc', gate: stage, gateType, runtime }
    }
    return null
  }

  /** 跑一轮 */
  async runOnce (index, topic) {
    log('=== 第 ' + index + ' 轮开始：' + topic + ' ===')
    const startedAt = Date.now()
    let runId = null
    if (this.options.mode === 'ui') {
      await this.startViaUi(topic)
      // UI 模式下 runId 由渲染层持有；改为监听 pipeline:update 拿 runId
      runId = await this.waitForRunIdFromUpdates()
    } else {
      runId = await this.startViaApi(topic)
    }
    const snapshot = await this.waitForRun(runId, this.options.timeoutMs)
    const elapsedMs = Date.now() - startedAt
    const status = snapshot.status.status
    const result = {
      index,
      runId,
      status,
      elapsedMs,
      error: snapshot.error || null,
      errorCode: snapshot.errorCode || null,
      approvalGates: (this.approvalGates || []).slice(),
      stageStatuses: (snapshot.stages || []).map(s => ({
        name: s.name,
        status: s.status,
        error: s.error || null,
      })),
      contextKeys: Object.keys(snapshot.context || {}),
      videoPath: null,
      probe: null,
      // ⚠ **运行时证据**（compose 阶段如实上报的实际 runtime / 请求的 runtime / 回落原因）
      //   ⇒ 没有这三项，报告只能证明「出了片」，证明不了「走的是 Remotion 还是回落 ffmpeg」。
      renderRuntimeUsed: null,
      renderRuntimeRequested: null,
      renderFallbackReason: null,
    }
    {
      const composeContext = (snapshot.context || {}).compose || {}
      const promisePreservation = composeContext.final_review &&
        composeContext.final_review.checks &&
        composeContext.final_review.checks.promise_preservation
      result.renderRuntimeUsed = (promisePreservation && promisePreservation.render_runtime_used) || null
      result.renderRuntimeRequested = composeContext.render_runtime_requested || null
      result.renderFallbackReason = composeContext.render_fallback_reason || null
    }
    if (status === 'completed') {
      const videoPath = findVideoPath(snapshot.context || {})
      if (videoPath) {
        result.videoPath = videoPath
        result.probe = await probeVideo(videoPath)
        const target = path.join(this.options.outDir, 'explainer-run-' + index + path.extname(videoPath))
        fs.mkdirSync(this.options.outDir, { recursive: true })
        fs.copyFileSync(videoPath, target)
        result.copiedTo = target
        log('成片：', videoPath, '→', target)
        log('规格：', JSON.stringify(result.probe))
      } else {
        result.error = '流水线已结束但未找到成片路径'
      }
    }
    return result
  }

  /** UI 模式下从 pipeline:update 事件流里取 runId */
  async waitForRunIdFromUpdates () {
    await this.client.evaluate('(function () {' +
      ' window.__mpPipelineEvents = [];' +
      ' if (!window.__mpPipelineHooked) {' +
      '   window.__mpPipelineHooked = true;' +
      '   window.electronAPI.onPipelineUpdate(function (s) { window.__mpPipelineEvents.push(s) });' +
      ' }' +
      ' return true })()')
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const runId = await this.client.evaluate(
        '(function () { const e = window.__mpPipelineEvents || []; return e.length ? e[0].runId : null })()'
      )
      if (runId) return runId
      await sleep(500)
    }
    throw new Error('UI 模式下 120s 内未收到 pipeline:update 事件')
  }
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const options = {
    cdpPort: Number(args['cdp-port'] || DEFAULT_CDP_PORT),
    vitePort: Number(args['vite-port'] || DEFAULT_VITE_PORT),
    llmBaseUrl: args['llm-base-url'] || 'http://127.0.0.1:8787/v1',
    llmApiKey: args['llm-api-key'] || '',
    imageBaseUrl: args['image-base-url'] || 'http://127.0.0.1:7860',
    topic: args.topic || '拖延症不是懒：拖延背后的情绪调节机制',
    outDir: args['out-dir'] || path.join(require('os').tmpdir(), 'explainer-cdp-out'),
    runs: Math.max(1, Number(args.runs || 1)),
    timeoutMs: Number(args['timeout-ms'] || 20 * 60 * 1000),
    concurrencyWaitMs: Number(args['concurrency-wait-ms'] || 10 * 60 * 1000),
    mode: args.mode === 'ui' ? 'ui' : 'api',
    // ⚠ G1 选的渲染引擎。**必须选非默认的那个**（ffmpeg）⇒ 否则测不出
    //   「门批准后阶段重跑 ⇒ 把用户选择冲回默认值」这个缺陷（默认 remotion ⇒ 冲掉后仍相同 ⇒ 断言恒真）。
    approvalRuntime: args['approval-runtime'] || process.env.E2E_APPROVAL_RUNTIME || 'remotion',
    resolution: args.resolution || '1920x1080',
    aspectRatio: args['aspect-ratio'] || '16:9',
    fps: Number(args.fps || 30),
    subtitleEnabled: args['subtitle-enabled'] === 'true',
  }

  const runner = new ExplainerCdpRunner(options)
  const report = { startedAt: new Date().toISOString(), options, runs: [] }
  let exitCode = 0
  try {
    await runner.connect()
    await runner.probeRuntime()
    await runner.configureProviders()
    for (let i = 1; i <= options.runs; i++) {
      try {
        report.runs.push(await runner.runOnce(i, options.topic))
      } catch (error) {
        report.runs.push({ index: i, status: 'error', error: String(error && error.message ? error.message : error) })
        exitCode = 1
      }
    }
  } catch (error) {
    report.fatal = String(error && error.stack ? error.stack : error)
    exitCode = 1
  } finally {
    runner.close()
    report.finishedAt = new Date().toISOString()
    fs.mkdirSync(options.outDir, { recursive: true })
    const reportPath = path.join(options.outDir, 'explainer-cdp-report.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
    log('报告已写入：', reportPath)
  }

  const ok = report.runs.filter(r => r.status === 'completed' && r.videoPath).length
  log('结果：成功 ' + ok + ' / 共 ' + report.runs.length + ' 轮')
  process.exit(exitCode || (ok === report.runs.length ? 0 : 1))
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[explainer-cdp] 未捕获异常：', error)
    process.exit(1)
  })
}

module.exports = { ExplainerCdpRunner, findVideoPath, probeVideo, parseArgs }
