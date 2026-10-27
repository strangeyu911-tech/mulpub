#!/usr/bin/env node
/**
 * 本地流水线真实执行器（pipeline-smoke execute）。
 *
 * 仅支持不需要外部模型 provider 的本地流水线：
 *   - talking-head：口播视频 + 文案 → 分句 → SRT → FFmpeg 烧录
 *   - framework-smoke：ffmpeg/ffprobe + testsrc 冒烟视频
 *
 * 用法：
 *   node apps/desktop/scripts/pipeline-smoke/execute.js --pipeline talking-head
 *   node apps/desktop/scripts/pipeline-smoke/execute.js --pipeline talking-head --json artifacts/pipeline-smoke/talking-head.json
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { resolveReportPath } = require('./paths')
const { PIPELINE_SMOKE_MANIFEST } = require('./manifest')

let cachedProductionDeps = null
function loadProductionDeps () {
  if (cachedProductionDeps) return cachedProductionDeps
  try {
    cachedProductionDeps = {
      PipelineEngine: require('../../electron/services/pipeline-engine').PipelineEngine,
      StageExecutor: require('../../electron/services/stage-executor').StageExecutor,
      registerAllPipelineStages: require('../../electron/services/pipeline-stage-registrars').registerAllPipelineStages,
      findFfprobe: require('../../electron/services/media-tool-paths').findFfprobe,
    }
    return cachedProductionDeps
  } catch (error) {
    throw new Error('INFRA_MISSING: ' + (error && error.message ? error.message : String(error)))
  }
}

// 支持集合从清单派生，避免 execute.js 与 manifest 各维护一份名单。
const SUPPORTED_LOCAL_PIPELINES = new Set(
  PIPELINE_SMOKE_MANIFEST
    .filter((entry) => entry.driver === 'builtin:local-executor' || entry.driver === 'builtin:framework-smoke')
    .map((entry) => entry.pipeline)
)
const DEFAULT_INPUT_DIR = path.join(os.tmpdir(), 'story2video', 'e2e-inputs')

function quietLog () {
  return { info () {}, warn () {}, error () {}, notify () {} }
}

const LOCAL_PARAM_BUILDERS = Object.freeze({
  'talking-head': (inputDir) => ({
    video: path.join(inputDir, 'talkinghead-source.mp4'),
    text: '这是口播冒烟测试第一句。\n这是第二句字幕。',
    autoAdvance: true,
    checkpointPolicy: 'none',
  }),
  'framework-smoke': () => ({ autoAdvance: true, checkpointPolicy: 'none' }),
})

function buildLocalParams (pipeline, options = {}) {
  const builder = LOCAL_PARAM_BUILDERS[pipeline]
  if (!SUPPORTED_LOCAL_PIPELINES.has(pipeline) || !builder) {
    throw new Error('UNSUPPORTED_PIPELINE: ' + pipeline)
  }
  const inputDir = options.inputDir || process.env.E2E_INPUTS || DEFAULT_INPUT_DIR
  return builder(inputDir)
}

function isArtifactPathAllowed (file) {
  const resolved = path.resolve(file)
  const roots = [os.tmpdir(), path.join(process.cwd(), 'artifacts')]
  return roots.some((root) => {
    const base = path.resolve(root)
    return resolved === base || resolved.startsWith(base + path.sep)
  })
}

function createLocalEngine (options = {}) {
  const log = options.logger || quietLog()
  const { PipelineEngine, StageExecutor, registerAllPipelineStages } = loadProductionDeps()
  const engine = new PipelineEngine({ log })
  engine.stageExecutor = new StageExecutor({ serviceBus: {}, log })
  const failures = registerAllPipelineStages(engine)
  if (failures.length > 0) {
    const detail = failures.map((item) => item.name + ': ' + item.error).join('; ')
    throw new Error('STAGE_REGISTRATION_FAILED: ' + detail)
  }
  return engine
}

function extractArtifact (context) {
  if (!context || typeof context !== 'object') return null

  // 只看最终阶段子树，避免把 upload/source 等输入路径误判为产物。
  // 契约：每个产出阶段把自己的产物放在 render/report/compose/finalize/export 下。
  const FINAL_STAGE_KEYS = ['render', 'report', 'compose', 'finalize', 'export']
  for (const stageKey of FINAL_STAGE_KEYS) {
    const stage = context[stageKey]
    if (!stage || typeof stage !== 'object') continue
    for (const key of ['videoPath', 'outputPath', 'audioPath']) {
      if (typeof stage[key] === 'string' && stage[key].trim()) return stage[key]
    }
  }
  for (const key of ['videoPath', 'outputPath', 'audioPath']) {
    if (typeof context[key] === 'string' && context[key].trim()) return context[key]
  }
  return null
}

function probeVideo (file) {
  const { findFfprobe } = loadProductionDeps()
  const ffprobe = findFfprobe()
  if (!ffprobe) throw new Error('ffprobe 不可用')
  const output = execFileSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_name,width,height',
    '-of', 'json',
    file,
  ], { encoding: 'utf8', timeout: 30000 })
  const parsed = JSON.parse(output)
  const duration = Number(parsed?.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('probe 未返回有效 duration')
  }
  return {
    duration,
    codecs: Array.isArray(parsed.streams) ? parsed.streams.map((stream) => stream.codec_name).filter(Boolean) : [],
  }
}

function stageSummary (results) {
  if (!Array.isArray(results)) return []
  return results.map((item) => ({
    stage: item && item.stage ? item.stage : 'unknown',
    success: !(item && item.success === false),
    error: item && item.error ? item.error : null,
  }))
}

async function runLocalPipeline (pipeline, params = {}, options = {}) {
  const startedAt = Date.now()
  if (!SUPPORTED_LOCAL_PIPELINES.has(pipeline)) {
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'UNSUPPORTED_PIPELINE',
      error: '不支持的本地流水线: ' + pipeline,
      durationMs: 0,
      stages: [],
      artifact: null,
      probe: null,
    }
  }
  if (pipeline === 'talking-head') {
    const video = params && (params.video || params.videoPath)
    if (typeof video !== 'string' || !video || !fs.existsSync(video)) {
      return {
        schemaVersion: 1,
        pipeline,
        status: 'FAIL',
        reasonCode: 'MISSING_INPUT',
        error: '缺少可读的 talking-head 源视频: ' + String(video || ''),
        durationMs: 0,
        stages: [],
        artifact: null,
        probe: null,
      }
    }
  }
  let engine
  let probe
  try {
    engine = options.engine || (options.createEngine ? options.createEngine() : createLocalEngine({ logger: options.logger }))
    probe = options.probe || probeVideo
  } catch (error) {
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'EXECUTION_SETUP_FAILED',
      error: error && error.message ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      stages: [],
      artifact: null,
      probe: null,
    }
  }
  let result
  try {
    result = await engine.startOrchestrated(pipeline, {
      ...params,
      autoAdvance: true,
      checkpointPolicy: 'none',
    })
  } catch (error) {
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'EXECUTION_THREW',
      error: error && error.message ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      stages: [],
      artifact: null,
      probe: null,
    }
  }

  const durationMs = Date.now() - startedAt
  if (!result || result.success !== true) {
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: (result && result.errorCode) || 'STAGE_FAILED',
      error: result && result.error ? result.error : '流水线执行失败',
      runId: result && result.runId ? result.runId : null,
      durationMs,
      stages: stageSummary(result && result.results),
      artifact: null,
      probe: null,
    }
  }

  const artifact = extractArtifact(result.context)
  if (artifact && !isArtifactPathAllowed(artifact)) {
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'ARTIFACT_OUTSIDE_ALLOWED_ROOTS',
      error: '产物路径不在允许目录（临时目录/artifacts）: ' + artifact,
      runId: result.runId || null,
      durationMs,
      stages: stageSummary(result.results),
      artifact,
      probe: null,
    }
  }
  if (!artifact || !fs.existsSync(artifact) || fs.statSync(artifact).size <= 0) {
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'NO_ARTIFACT',
      error: '流水线成功但未找到有效产物',
      runId: result.runId || null,
      durationMs,
      stages: stageSummary(result.results),
      artifact: artifact || null,
      probe: null,
    }
  }

  let probed
  try {
    probed = probe(artifact)
  } catch (error) {
    return {
      schemaVersion: 1,
      pipeline,
      status: 'FAIL',
      reasonCode: 'PROBE_FAILED',
      error: error && error.message ? error.message : String(error),
      runId: result.runId || null,
      durationMs,
      stages: stageSummary(result.results),
      artifact,
      probe: null,
    }
  }

  return {
    schemaVersion: 1,
    pipeline,
    status: 'PASS',
    reasonCode: null,
    error: null,
    runId: result.runId || null,
    durationMs,
    stages: stageSummary(result.results),
    artifact,
    probe: probed,
  }
}

function parseArgs (argv) {
  const options = { pipeline: null, inputDir: null, json: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--pipeline') options.pipeline = argv[++i]
    else if (arg === '--input-dir') options.inputDir = argv[++i]
    else if (arg === '--json') options.json = argv[++i]
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('未知参数: ' + arg)
  }
  return options
}

async function main (argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help || !options.pipeline) {
    console.log('用法: node apps/desktop/scripts/pipeline-smoke/execute.js --pipeline <talking-head|framework-smoke> [--input-dir <dir>] [--json <path>]')
    return options.help ? 0 : 2
  }
  if (!SUPPORTED_LOCAL_PIPELINES.has(options.pipeline)) {
    console.error('[pipeline-smoke] UNSUPPORTED_PIPELINE: ' + options.pipeline)
    return 2
  }
  const params = buildLocalParams(options.pipeline, { inputDir: options.inputDir || undefined })
  const report = await runLocalPipeline(options.pipeline, params)
  console.log('PIPELINE=' + report.pipeline)
  console.log('STATUS=' + report.status)
  console.log('RUN_ID=' + (report.runId || '-'))
  console.log('DURATION_MS=' + report.durationMs)
  if (report.artifact) console.log('ARTIFACT=' + report.artifact)
  if (report.probe) console.log('PROBE=' + JSON.stringify(report.probe))
  if (report.error) console.log('ERROR=' + report.error)
  if (options.json) {
    const target = resolveReportPath(options.json)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log('JSON=' + target)
  }
  return report.status === 'PASS' ? 0 : 1
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error('[pipeline-smoke] FAILED: ' + (error && error.stack ? error.stack : String(error)))
    process.exitCode = 2
  })
}

module.exports = {
  SUPPORTED_LOCAL_PIPELINES,
  buildLocalParams,
  createLocalEngine,
  extractArtifact,
  isArtifactPathAllowed,
  main,
  probeVideo,
  runLocalPipeline,
}
