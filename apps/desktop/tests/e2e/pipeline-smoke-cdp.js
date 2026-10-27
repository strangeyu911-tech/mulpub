/**
 * pipeline-smoke-cdp.js — 通过 CDP 驱动「已启动的 Multi-Publish 应用」跑单条流水线冒烟
 *
 * 适用：需要真实 LLM/图片/视频/TTS provider 的流水线。应用必须已启动并暴露
 * `--remote-debugging-port`（默认 9279），且已登录、已配置 provider。
 *
 * 用法：
 *   node tests/e2e/pipeline-smoke-cdp.js --pipeline podcast-repurpose
 *   node tests/e2e/pipeline-smoke-cdp.js --pipeline animation --params '{"text":"..."}'
 *   node tests/e2e/pipeline-smoke-cdp.js --pipeline documentary-montage --json out.json
 *
 * 退出码：0 PASS / 1 FAIL / 2 参数/连接/装配错误。
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { PIPELINE_SMOKE_MANIFEST } = require('../../scripts/pipeline-smoke/manifest')

const DEFAULT_CDP_PORT = 9279
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000
const DEFAULT_TEXT = '一段用于流水线冒烟测试的短视频文案。\n第二句用于验证分镜和字幕。'

function parseJson (text, label) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('INVALID_JSON: ' + label + ' ' + (error && error.message ? error.message : String(error)))
  }
}

function parseArgs (argv) {
  const options = {
    pipeline: null,
    params: {},
    inputDir: process.env.E2E_INPUTS || path.join(os.tmpdir(), 'story2video', 'e2e-inputs'),
    json: null,
    cdpPort: Number(process.env.CDP_PORT || DEFAULT_CDP_PORT),
    timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--pipeline') options.pipeline = argv[++i]
    else if (arg === '--params') options.params = parseJson(argv[++i], '--params')
    else if (arg === '--params-file') options.params = parseJson(fs.readFileSync(argv[++i], 'utf8'), '--params-file')
    else if (arg === '--input-dir') options.inputDir = argv[++i]
    else if (arg === '--json') options.json = argv[++i]
    else if (arg === '--cdp-port') options.cdpPort = Number(argv[++i])
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i])
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('未知参数: ' + arg)
  }
  return options
}

function manifestEntry (pipeline) {
  return PIPELINE_SMOKE_MANIFEST.find((entry) => entry.pipeline === pipeline) || null
}

function buildParams (pipeline, options = {}) {
  const entry = manifestEntry(pipeline)
  if (!entry) throw new Error('UNKNOWN_PIPELINE: ' + pipeline)
  const inputDir = options.inputDir || process.env.E2E_INPUTS || path.join(os.tmpdir(), 'story2video', 'e2e-inputs')
  const params = { ...(entry.defaultParams || {}) }
  for (const input of entry.inputs || []) {
    params[input.key] = path.join(inputDir, input.file)
  }
  if (pipeline === 'podcast-repurpose') {
    params.transcript = params.transcript || DEFAULT_TEXT
  } else if (['animation', 'documentary-montage', 'hybrid'].includes(pipeline)) {
    params.text = params.text || DEFAULT_TEXT
  }
  return {
    ...params,
    ...(options.params || {}),
    checkpointPolicy: 'none',
    autoAdvance: true,
    background: true,
  }
}

function realpathOrSelf (file) {
  try { return fs.realpathSync.native(file) } catch (_) { return path.resolve(file) }
}

function inputPaths (params) {
  const set = new Set()
  for (const key of ['video', 'audio', 'image']) {
    const value = params && params[key]
    if (typeof value === 'string' && value.trim()) set.add(realpathOrSelf(value))
  }
  return set
}

/**
 * 优先从最终阶段子树取产物；跳过输入文件，避免把 source 当 output。
 * 契约：render/report/compose/finalize/export 是产出阶段。
 */
function isNonEmptyFile (file) {
  try {
    // 只接受绝对路径：相对路径无法确定是相对脚本 cwd 还是应用 cwd，fail closed。
    if (!path.isAbsolute(file)) return false
    const stat = fs.statSync(file)
    return stat.isFile() && stat.size > 0
  } catch (_) {
    return false
  }
}

function findOutput (context, inputs = new Set(), depth = 0, seen = new Set()) {
  if (!context || typeof context !== 'object' || depth > 10 || seen.has(context)) return null
  seen.add(context)
  for (const stageKey of ['render', 'report', 'compose', 'finalize', 'export']) {
    const stage = context[stageKey]
    if (!stage || typeof stage !== 'object') continue
    for (const key of ['videoPath', 'outputPath', 'audioPath']) {
      const value = stage[key]
      if (typeof value === 'string' && value.trim() && isNonEmptyFile(value) && !inputs.has(realpathOrSelf(value))) {
        return value
      }
    }
  }
  for (const key of ['videoPath', 'outputPath', 'audioPath']) {
    const value = context[key]
    if (typeof value === 'string' && value.trim() && isNonEmptyFile(value) && !inputs.has(realpathOrSelf(value))) {
      return value
    }
  }
  return null
}

function statusOf (snapshot) {
  if (!snapshot) return null
  if (snapshot.status && typeof snapshot.status === 'object') return snapshot.status.status || null
  if (typeof snapshot.status === 'string') return snapshot.status
  return null
}

function probeVideo (file) {
  const output = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_name',
    '-of', 'csv=p=0',
    file,
  ], { encoding: 'utf8', timeout: 30000 })
  const lines = String(output).trim().split(/\r?\n/).filter(Boolean)
  const durationLine = lines.find((line) => Number.isFinite(Number(line)) && Number(line) > 0)
  const duration = Number(durationLine)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('PROBE_FAILED: duration=' + lines.join('|'))
  return { duration, codecs: lines.filter((line) => line !== durationLine) }
}

async function run (options = {}) {
  const startedAt = Date.now()
  const pipeline = options.pipeline
  if (!pipeline) throw new Error('缺少 --pipeline')
  if (!manifestEntry(pipeline)) throw new Error('UNKNOWN_PIPELINE: ' + pipeline)
  const params = buildParams(pipeline, options)
  const { chromium } = require(process.env.PLAYWRIGHT_REQUIRE || 'playwright')
  let browser
  let page
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + (options.cdpPort || DEFAULT_CDP_PORT))
    const contexts = browser.contexts()
    for (const context of contexts) {
      for (const candidate of context.pages()) {
        const hasApi = await candidate.evaluate(() => Boolean(window.electronAPI && window.electronAPI.pipelineStartOrchestrated)).catch(() => false)
        if (hasApi) { page = candidate; break }
      }
      if (page) break
    }
    if (!page) throw new Error('CDP_PAGE_NOT_FOUND: 未找到带 electronAPI 的页面')
  } catch (error) {
    if (browser) await browser.close().catch(() => {})
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'CDP_CONNECT_FAILED',
      error: error && error.message ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      artifact: null,
      probe: null,
    }
  }

  let runId = null
  try {
    const started = await page.evaluate(({ name, payload }) => {
      return window.electronAPI.pipelineStartOrchestrated(name, payload)
    }, { name: pipeline, payload: params })
    runId = (started && started.data && started.data.runId) || (started && started.runId) || null
    if (!runId) throw new Error('START_FAILED: ' + JSON.stringify(started).slice(0, 500))
  } catch (error) {
    await browser.close().catch(() => {})
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'START_FAILED',
      error: error && error.message ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      artifact: null,
      probe: null,
    }
  }

  let snapshot = null
  const deadline = Date.now() + (options.timeoutMs || DEFAULT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    try {
      snapshot = await page.evaluate((id) => window.electronAPI.pipelineGetRunContext(id), runId)
      if (snapshot && snapshot.data) snapshot = snapshot.data
    } catch (_) { /* page may be navigating; retry */ }
    const status = statusOf(snapshot)
    if (['completed', 'failed', 'cancelled'].includes(status)) break
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  const status = statusOf(snapshot)
  const context = (snapshot && snapshot.context) || {}
  const artifact = findOutput(context, inputPaths(params))
  let probe = null
  let reasonCode = null
  let errorMessage = null
  if (status === 'failed') {
    reasonCode = 'EXECUTION_FAILED'
    errorMessage = String((snapshot && (snapshot.error || (snapshot.status && snapshot.status.error))) || 'pipeline failed')
  } else if (status === 'cancelled') {
    reasonCode = 'EXECUTION_CANCELLED'
  } else if (status !== 'completed') {
    reasonCode = 'EXECUTION_TIMEOUT'
    errorMessage = '超过 ' + Math.round((options.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000) + 's 未完成'
    await page.evaluate((id) => window.electronAPI.pipelineCancelRun(id), runId).catch(() => {})
  } else if (!artifact) {
    reasonCode = 'NO_ARTIFACT'
    errorMessage = 'completed 但未找到非输入产物'
  } else {
    try {
      probe = probeVideo(artifact)
    } catch (error) {
      reasonCode = 'PROBE_FAILED'
      errorMessage = error && error.message ? error.message : String(error)
    }
  }

  await browser.close().catch(() => {})
  const report = {
    schemaVersion: 1,
    pipeline,
    status: reasonCode ? 'FAIL' : 'PASS',
    reasonCode,
    error: errorMessage,
    runId,
    durationMs: Date.now() - startedAt,
    artifact,
    probe,
  }
  if (options.json) {
    const target = path.resolve(options.json)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8')
    report.jsonPath = target
  }
  return report
}

async function main (argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help || !options.pipeline) {
    console.log('用法: node tests/e2e/pipeline-smoke-cdp.js --pipeline <name> [--params <json>] [--json <path>] [--cdp-port 9279]')
    return options.help ? 0 : 2
  }
  const report = await run(options)
  console.log('PIPELINE=' + report.pipeline)
  console.log('STATUS=' + report.status)
  if (report.runId) console.log('RUN_ID=' + report.runId)
  console.log('DURATION_MS=' + report.durationMs)
  if (report.artifact) console.log('ARTIFACT=' + report.artifact)
  if (report.probe) console.log('PROBE=' + JSON.stringify(report.probe))
  if (report.reasonCode) console.log('REASON=' + report.reasonCode + (report.error ? ' ' + report.error : ''))
  if (report.jsonPath) console.log('JSON=' + report.jsonPath)
  if (report.status === 'PASS') return 0
  if (['CDP_CONNECT_FAILED', 'START_FAILED'].includes(report.reasonCode)) return 2
  return 1
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error('[pipeline-smoke-cdp] FAILED: ' + (error && error.message ? error.message : String(error)))
    process.exitCode = 2
  })
}

module.exports = {
  buildParams,
  findOutput,
  inputPaths,
  main,
  manifestEntry,
  parseArgs,
  probeVideo,
  run,
  statusOf,
}
