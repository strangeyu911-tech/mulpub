#!/usr/bin/env node
/**
 * 视频创作流水线 E2E 冒烟就绪审计（只读，不调用外部模型）。
 *
 * 用法：
 *   node apps/desktop/scripts/pipeline-smoke/audit.js
 *   node apps/desktop/scripts/pipeline-smoke/audit.js --json artifacts/pipeline-smoke/report.json
 *   node apps/desktop/scripts/pipeline-smoke/audit.js --strict
 *   node apps/desktop/scripts/pipeline-smoke/audit.js --only story2video-compose --only cinematic
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const { PipelineEngine, PIPELINE_DEFINITIONS } = require('../../electron/services/pipeline-engine')
const { StageExecutor } = require('../../electron/services/stage-executor')
const { registerAllPipelineStages } = require('../../electron/services/pipeline-stage-registrars')
const { resolvePipelineModelRequirements } = require('../../electron/services/pipeline-model-preflight')
const { findFfmpeg, findFfprobe } = require('../../electron/services/media-tool-paths')
const { PIPELINE_SMOKE_MANIFEST, PIPELINE_SMOKE_EXCLUDED } = require('./manifest')
const { resolveReportPath } = require('./paths')
const { readProviderInventory, capabilitiesFromInventory } = require('./provider-readiness')

const APP_DESKTOP_DIR = path.resolve(__dirname, '..', '..')
const DEFAULT_INPUT_DIR = path.join(os.tmpdir(), 'story2video', 'e2e-inputs')

const ALLOWED_BUILTIN_DRIVERS = new Set(['builtin:framework-smoke', 'builtin:local-executor'])

const STATUS = Object.freeze({
  READY: 'READY',
  BLOCKED: 'BLOCKED',
  BROKEN: 'BROKEN',
  EXCLUDED: 'EXCLUDED',
})

function quietLog () {
  return { info () {}, warn () {}, error () {}, notify () {} }
}

/** 用生产注册器装配真实 StageExecutor，返回 engine + 注册失败清单。 */
function createWiringEngine () {
  const log = quietLog()
  const engine = new PipelineEngine({ log })
  engine.stageExecutor = new StageExecutor({ serviceBus: {}, log })
  const failures = registerAllPipelineStages(engine)
  return { engine, failures }
}

function defaultDriverExists (driver) {
  if (!driver || driver.startsWith('builtin:')) return true
  const resolved = path.resolve(APP_DESKTOP_DIR, driver)
  // 防目录穿越：清单是仓库内文件，驱动只能是 apps/desktop 下的相对路径。
  return (resolved === APP_DESKTOP_DIR || resolved.startsWith(APP_DESKTOP_DIR + path.sep)) &&
    fs.existsSync(resolved)
}

function defaultInputExists (file, inputDir) {
  return fs.existsSync(path.resolve(inputDir, file))
}

function defaultToolExists (tool) {
  if (tool === 'ffmpeg') return Boolean(findFfmpeg())
  if (tool === 'ffprobe') return Boolean(findFfprobe())
  return false
}

function reasonText (code, detail) {
  const suffix = detail ? '：' + detail : ''
  switch (code) {
    case 'NO_DRIVER': return '该流水线尚无 E2E 驱动，需在 tests/e2e/ 新增' + suffix
    case 'MISSING_INPUT': return '缺少 E2E 输入文件（E2E_INPUTS）' + suffix
    case 'MISSING_MEDIA_TOOL': return '未找到 ffmpeg/ffprobe' + suffix
    case 'MISSING_ENV': return '缺少必需环境变量' + suffix
    case 'MISSING_PROVIDER': return '缺少可用模型能力（请到应用「模型设置」配置并启用）' + suffix
    case 'UNWIRED_STAGE': return '存在未接线的阶段类型' + suffix
    case 'MANIFEST_UNKNOWN_PIPELINE': return '清单登记了 PIPELINE_DEFINITIONS 中不存在的流水线' + suffix
    case 'MANIFEST_COVERAGE_GAP': return '带 stageDefs 的流水线未登记到冒烟清单' + suffix
    case 'DUPLICATE_MANIFEST_ENTRY': return '同一流水线在清单中重复登记' + suffix
    case 'MISSING_STAGE_DEFS': return '流水线没有 stageDefs，无法冒烟' + suffix
    case 'DRIVER_MISSING': return '清单登记的驱动文件不存在' + suffix
    case 'INVALID_BUILTIN_DRIVER': return '不支持的 builtin 驱动' + suffix
    case 'CAPABILITY_RESOLUTION_FAILED': return '模型能力推导失败' + suffix
    case 'STAGE_REGISTRATION_FAILED': return '阶段注册器执行失败' + suffix
    default: return code + suffix
  }
}

function makeItem (pipeline, status, reasonCode, detail, extra = {}) {
  return {
    pipeline,
    status,
    reasonCode: reasonCode || null,
    reason: reasonCode ? reasonText(reasonCode, detail) : null,
    stageCount: extra.stageCount || 0,
    capabilities: extra.capabilities || [],
    driver: extra.driver || null,
    driverMode: extra.driverMode || null,
    missingInputs: extra.missingInputs || [],
    missingTools: extra.missingTools || [],
    ...extra,
  }
}

function auditEntry (entry, ctx) {
  const def = ctx.definitions.find((pipeline) => pipeline.name === entry.pipeline)
  if (!def) {
    return makeItem(entry.pipeline, STATUS.BROKEN, 'MANIFEST_UNKNOWN_PIPELINE', entry.pipeline, {
      driver: entry.driver,
      driverMode: entry.driverMode,
    })
  }

  const excluded = ctx.excluded.find((item) => item.pipeline === entry.pipeline)
  if (!Array.isArray(def.stageDefs) || def.stageDefs.length === 0) {
    if (excluded) {
      return makeItem(entry.pipeline, STATUS.EXCLUDED, excluded.reason, excluded.notes, {
        stageCount: 0,
        driver: entry.driver,
        driverMode: entry.driverMode,
      })
    }
    return makeItem(entry.pipeline, STATUS.BROKEN, 'MISSING_STAGE_DEFS', entry.pipeline, {
      driver: entry.driver,
      driverMode: entry.driverMode,
    })
  }

  let capabilities = []
  try {
    capabilities = resolvePipelineModelRequirements(entry.pipeline, entry.defaultParams || {}).capabilities
  } catch (error) {
    return makeItem(entry.pipeline, STATUS.BROKEN, 'CAPABILITY_RESOLUTION_FAILED',
      error && error.message ? error.message : String(error), {
        stageCount: def.stageDefs.length,
        driver: entry.driver,
        driverMode: entry.driverMode,
      })
  }

  const base = {
    stageCount: def.stageDefs.length,
    capabilities,
    driver: entry.driver,
    driverMode: entry.driverMode,
  }

  const unwired = ctx.unwired.filter((item) => item.pipeline === entry.pipeline)
  if (unwired.length > 0) {
    const detail = unwired.map((item) => item.stage + '→' + item.type).join(', ')
    return makeItem(entry.pipeline, STATUS.BROKEN, 'UNWIRED_STAGE', detail, base)
  }

  if (!entry.driver) {
    return makeItem(entry.pipeline, STATUS.BLOCKED, 'NO_DRIVER', null, base)
  }
  if (entry.driver.startsWith('builtin:') && !ALLOWED_BUILTIN_DRIVERS.has(entry.driver)) {
    return makeItem(entry.pipeline, STATUS.BROKEN, 'INVALID_BUILTIN_DRIVER', entry.driver, base)
  }
  if (!entry.driver.startsWith('builtin:') && !ctx.driverExists(entry.driver)) {
    return makeItem(entry.pipeline, STATUS.BROKEN, 'DRIVER_MISSING', entry.driver, base)
  }

  const missingTools = (entry.requiredTools || []).filter((tool) => !ctx.toolExists(tool))
  if (missingTools.length > 0) {
    return makeItem(entry.pipeline, STATUS.BLOCKED, 'MISSING_MEDIA_TOOL', missingTools.join(', '), {
      ...base,
      missingTools,
    })
  }

  const missingInputs = (entry.inputs || [])
    .filter((input) => !ctx.inputExists(input.file, ctx.inputDir))
    .map((input) => input.file)
  if (missingInputs.length > 0) {
    return makeItem(entry.pipeline, STATUS.BLOCKED, 'MISSING_INPUT', missingInputs.join(', '), {
      ...base,
      missingInputs,
    })
  }

  const missingEnv = (entry.requiredEnv || []).filter((name) => !ctx.env[name])
  if (missingEnv.length > 0) {
    return makeItem(entry.pipeline, STATUS.BLOCKED, 'MISSING_ENV', missingEnv.join(', '), base)
  }

  if (ctx.providerCapabilities) {
    const missingCapabilities = capabilities.filter((capability) => !ctx.providerCapabilities.has(capability))
    if (missingCapabilities.length > 0) {
      return makeItem(entry.pipeline, STATUS.BLOCKED, 'MISSING_PROVIDER', missingCapabilities.join(', '), {
        ...base,
        missingCapabilities,
      })
    }
  }

  return makeItem(entry.pipeline, STATUS.READY, null, null, base)
}

function summarize (items) {
  const summary = { total: items.length, ready: 0, blocked: 0, broken: 0, excluded: 0 }
  for (const item of items) {
    if (item.status === STATUS.READY) summary.ready += 1
    else if (item.status === STATUS.BLOCKED) summary.blocked += 1
    else if (item.status === STATUS.BROKEN) summary.broken += 1
    else if (item.status === STATUS.EXCLUDED) summary.excluded += 1
  }
  return summary
}

function auditAll (options = {}) {
  const definitions = options.definitions || PIPELINE_DEFINITIONS
  const manifest = options.manifest || PIPELINE_SMOKE_MANIFEST
  const excluded = options.excluded || PIPELINE_SMOKE_EXCLUDED
  const wiring = options.engine
    ? { engine: options.engine, failures: options.registrationFailures || [] }
    : createWiringEngine()
  const engine = wiring.engine
  const ctx = {
    definitions,
    excluded,
    unwired: typeof engine.listUnwiredStageTypes === 'function' ? engine.listUnwiredStageTypes() : [],
    env: options.env || process.env,
    inputDir: options.inputDir || process.env.E2E_INPUTS || DEFAULT_INPUT_DIR,
    driverExists: options.driverExists || defaultDriverExists,
    inputExists: options.inputExists || defaultInputExists,
    toolExists: options.toolExists || defaultToolExists,
    providerCapabilities: options.providerCapabilities || null,
  }

  const items = []
  const seen = new Set()
  const manifestNames = new Set()

  for (const entry of manifest) {
    if (seen.has(entry.pipeline)) {
      items.push(makeItem(entry.pipeline, STATUS.BROKEN, 'DUPLICATE_MANIFEST_ENTRY', entry.pipeline))
      continue
    }
    seen.add(entry.pipeline)
    manifestNames.add(entry.pipeline)
    items.push(auditEntry(entry, ctx))
  }

  // 覆盖反查：PIPELINES 中有 stageDefs 但清单没登记的，直接 BROKEN。
  for (const def of definitions) {
    if (!Array.isArray(def.stageDefs) || def.stageDefs.length === 0) continue
    if (manifestNames.has(def.name)) continue
    if (excluded.some((item) => item.pipeline === def.name)) continue
    items.push(makeItem(def.name, STATUS.BROKEN, 'MANIFEST_COVERAGE_GAP', def.name, {
      stageCount: def.stageDefs.length,
    }))
  }

  // 显式排除项：只展示，不计入失败。
  for (const item of excluded) {
    if (manifestNames.has(item.pipeline)) continue
    const def = definitions.find((pipeline) => pipeline.name === item.pipeline)
    if (!def) {
      items.push(makeItem(item.pipeline, STATUS.BROKEN, 'MANIFEST_UNKNOWN_PIPELINE', item.pipeline))
      continue
    }
    items.push(makeItem(item.pipeline, STATUS.EXCLUDED, item.reason, item.notes, { stageCount: 0 }))
  }

  // 注册器失败是代码/装配缺陷，必须独立成 BROKEN 条目，不能被「未接线清单」掩盖。
  for (const failure of wiring.failures) {
    items.push(makeItem(failure.name || '__registration__', STATUS.BROKEN,
      'STAGE_REGISTRATION_FAILED', failure.error || 'unknown error'))
  }

  const summary = summarize(items)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    providerChecked: Boolean(options.providerCapabilities),
    summary,
    items,
  }
  return report
}

function computeExitCode (report, { strict = false } = {}) {
  if (!report || !report.summary) return 2
  if (report.summary.broken > 0) return 1
  if (strict && report.summary.blocked > 0) return 1
  return 0
}

function pad (value, width) {
  return String(value).padEnd(width)
}

const STATUS_COLORS = Object.freeze({
  READY: '\x1b[32m',
  BLOCKED: '\x1b[33m',
  BROKEN: '\x1b[31m',
  EXCLUDED: '\x1b[90m',
})
const RESET_COLOR = '\x1b[0m'

function colorizeStatus (status, enabled) {
  if (!enabled) return status
  const color = STATUS_COLORS[status]
  return color ? color + status + RESET_COLOR : status
}

function formatTable (report, { color = false } = {}) {
  const rows = [['PIPELINE', 'STAGES', 'CAPS', 'DRIVER', 'STATUS', 'REASON']]
  for (const item of report.items) {
    rows.push([
      item.pipeline,
      item.stageCount,
      (item.capabilities || []).join(',') || '-',
      item.driver || '-',
      colorizeStatus(item.status, color),
      item.reason || '-',
    ])
  }
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index]).length)))
  return rows
    .map((row) => row.map((cell, index) => pad(cell, widths[index])).join('  ').trimEnd())
    .join('\n')
}

function validateOnly (only, manifest, excluded) {
  const known = new Set([
    ...manifest.map((item) => item.pipeline),
    ...excluded.map((item) => item.pipeline),
  ])
  for (const name of only) {
    if (!known.has(name)) throw new Error('--only 指定了未知流水线: ' + name)
  }
}

function parseArgs (argv) {
  const options = {
    json: null,
    strict: false,
    only: [],
    inputDir: null,
    withProviders: false,
    providersDb: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') options.json = argv[++i]
    else if (arg === '--strict') options.strict = true
    else if (arg === '--only') options.only.push(argv[++i])
    else if (arg === '--input-dir') options.inputDir = argv[++i]
    else if (arg === '--with-providers') options.withProviders = true
    else if (arg === '--providers-db') {
      options.providersDb = argv[++i]
      options.withProviders = true
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('未知参数: ' + arg)
  }
  return options
}

function filterReport (report, only) {
  if (!only || only.length === 0) return report
  const allowed = new Set(only)
  const items = report.items.filter((item) => allowed.has(item.pipeline))
  return { ...report, summary: summarize(items), items }
}

async function main (argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log('用法: node apps/desktop/scripts/pipeline-smoke/audit.js [--json <path>] [--strict] [--only <pipeline>] [--input-dir <dir>] [--with-providers] [--providers-db <path>]')
    return 0
  }
  validateOnly(options.only, PIPELINE_SMOKE_MANIFEST, PIPELINE_SMOKE_EXCLUDED)
  let providerCapabilities = null
  if (options.withProviders) {
    const inventory = await readProviderInventory({ dbPath: options.providersDb || undefined })
    providerCapabilities = capabilitiesFromInventory(inventory)
    console.log('PROVIDERS db=' + inventory.dbPath +
      ' usable=' + inventory.usable.length +
      ' caps=' + ([...providerCapabilities].join(',') || '-'))
  }
  const report = filterReport(auditAll({
    inputDir: options.inputDir || undefined,
    providerCapabilities,
  }), options.only)
  console.log(formatTable(report, { color: Boolean(process.stdout.isTTY) }))
  const s = report.summary
  console.log('\nSUMMARY total=' + s.total + ' ready=' + s.ready + ' blocked=' + s.blocked + ' broken=' + s.broken + ' excluded=' + s.excluded)
  if (options.json) {
    const target = resolveReportPath(options.json)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log('JSON=' + target)
  }
  return computeExitCode(report, { strict: options.strict })
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error('[pipeline-smoke] FAILED: ' + (error && error.stack ? error.stack : String(error)))
    process.exitCode = 2
  })
}

module.exports = {
  auditAll,
  auditEntry,
  computeExitCode,
  createWiringEngine,
  defaultDriverExists,
  formatTable,
  main,
  resolveReportPath,
  summarize,
  validateOnly,
  STATUS,
}
