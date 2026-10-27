import { describe, it, expect } from 'vitest'

const {
  auditAll,
  computeExitCode,
  createWiringEngine,
  defaultDriverExists,
  resolveReportPath,
  summarize,
  validateOnly,
} = require('../../scripts/pipeline-smoke/audit')
const {
  PIPELINE_SMOKE_MANIFEST,
  PIPELINE_SMOKE_EXCLUDED,
} = require('../../scripts/pipeline-smoke/manifest')
const { buildFixturePlan, ensureFixture } = require('../../scripts/pipeline-smoke/make-fixtures')
const { PIPELINE_DEFINITIONS } = require('../services/pipeline-engine')

const ALL_DEFINITIONS = PIPELINE_DEFINITIONS
const DEFINITIONS_WITH_STAGES = ALL_DEFINITIONS.filter(
  (pipeline) => Array.isArray(pipeline.stageDefs) && pipeline.stageDefs.length > 0
)

function fakeEngine (unwired = []) {
  return { listUnwiredStageTypes: () => unwired }
}

function baseOptions (overrides = {}) {
  return {
    definitions: ALL_DEFINITIONS,
    manifest: PIPELINE_SMOKE_MANIFEST,
    excluded: PIPELINE_SMOKE_EXCLUDED,
    engine: fakeEngine(),
    env: {},
    inputDir: 'C:/fake-inputs',
    driverExists: () => true,
    inputExists: () => true,
    toolExists: () => true,
    ...overrides,
  }
}

describe('pipeline-smoke 清单完整性', () => {
  it('覆盖全部带 stageDefs 的流水线，且 screen-demo 显式排除', () => {
    const names = PIPELINE_SMOKE_MANIFEST.map((item) => item.pipeline)
    expect(new Set(names).size).toBe(names.length)
    for (const pipeline of DEFINITIONS_WITH_STAGES) {
      expect(names).toContain(pipeline.name)
    }
    expect(names).not.toContain('screen-demo')
    expect(PIPELINE_SMOKE_EXCLUDED.map((item) => item.pipeline)).toContain('screen-demo')
  })

  it('每条清单项都有 driver/defaultParams/expectedArtifact/timeoutSec 字段', () => {
    for (const item of PIPELINE_SMOKE_MANIFEST) {
      expect(item).toHaveProperty('pipeline')
      expect(item).toHaveProperty('driver')
      expect(item).toHaveProperty('defaultParams')
      expect(['video', 'audio', 'json', 'none']).toContain(item.expectedArtifact)
      expect(item.timeoutSec).toBeGreaterThan(0)
    }
  })
})

describe('pipeline-smoke 审计状态机', () => {
  it('完整接线且驱动/输入/工具齐全时为 READY（框架自检）', () => {
    const report = auditAll(baseOptions())
    const framework = report.items.find((item) => item.pipeline === 'framework-smoke')
    expect(framework.status).toBe('READY')
  })

  it('无驱动时判 BLOCKED(NO_DRIVER)，不是 BROKEN', () => {
    const report = auditAll(baseOptions())
    const item = report.items.find((entry) => entry.pipeline === 'talking-head')
    expect(item.status).toBe('BLOCKED')
    expect(item.reasonCode).toBe('NO_DRIVER')
  })

  it('阶段未接线时判 BROKEN(UNWIRED_STAGE)', () => {
    const report = auditAll(baseOptions({
      engine: fakeEngine([
        { pipeline: 'cinematic', stage: 'ingest', type: 'cinematic_ingest' },
      ]),
    }))
    const item = report.items.find((entry) => entry.pipeline === 'cinematic')
    expect(item.status).toBe('BROKEN')
    expect(item.reasonCode).toBe('UNWIRED_STAGE')
    expect(item.reason).toContain('cinematic_ingest')
  })

  it('登记了驱动但文件不存在时判 BROKEN(DRIVER_MISSING)', () => {
    const report = auditAll(baseOptions({
      driverExists: (driver) => driver !== 'tests/e2e/pipeline-options-matrix.js',
    }))
    const item = report.items.find((entry) => entry.pipeline === 'cinematic')
    expect(item.status).toBe('BROKEN')
    expect(item.reasonCode).toBe('DRIVER_MISSING')
  })

  it('缺输入时判 BLOCKED(MISSING_INPUT)，且不影响其他流水线', () => {
    const report = auditAll(baseOptions({
      inputExists: (file) => !String(file).includes('cinematic-source'),
    }))
    const cinematic = report.items.find((entry) => entry.pipeline === 'cinematic')
    const story2video = report.items.find((entry) => entry.pipeline === 'story2video-compose')
    expect(cinematic.status).toBe('BLOCKED')
    expect(cinematic.reasonCode).toBe('MISSING_INPUT')
    expect(story2video.status).toBe('READY')
  })

  it('缺媒体工具时判 BLOCKED(MISSING_MEDIA_TOOL)', () => {
    const report = auditAll(baseOptions({ toolExists: () => false }))
    const item = report.items.find((entry) => entry.pipeline === 'framework-smoke')
    expect(item.status).toBe('BLOCKED')
    expect(item.reasonCode).toBe('MISSING_MEDIA_TOOL')
  })

  it('清单漏登记带 stageDefs 的流水线时判 BROKEN(MANIFEST_COVERAGE_GAP)', () => {
    const manifest = PIPELINE_SMOKE_MANIFEST.filter((item) => item.pipeline !== 'hybrid')
    const report = auditAll(baseOptions({ manifest }))
    const item = report.items.find((entry) => entry.pipeline === 'hybrid')
    expect(item).toBeTruthy()
    expect(item.status).toBe('BROKEN')
    expect(item.reasonCode).toBe('MANIFEST_COVERAGE_GAP')
  })

  it('注册器失败必须判 BROKEN(STAGE_REGISTRATION_FAILED)，不能被未接线清单掩盖', () => {
    const report = auditAll(baseOptions({
      registrationFailures: [{ name: 'videogen', error: 'boom' }],
    }))
    const item = report.items.find((entry) => entry.pipeline === 'videogen')
    expect(item.status).toBe('BROKEN')
    expect(item.reasonCode).toBe('STAGE_REGISTRATION_FAILED')
    expect(item.reason).toContain('boom')
  })

  it('驱动路径不得穿越出 apps/desktop', () => {
    expect(defaultDriverExists('tests/e2e/pipeline-options-matrix.js')).toBe(true)
    expect(defaultDriverExists('../../package.json')).toBe(false)
  })

  it('清单与嵌套 inputs 均为只读（防止运行时被改写）', () => {
    expect(Object.isFrozen(PIPELINE_SMOKE_MANIFEST)).toBe(true)
    expect(Object.isFrozen(PIPELINE_SMOKE_MANIFEST[0])).toBe(true)
    expect(Object.isFrozen(PIPELINE_SMOKE_MANIFEST[0].defaultParams)).toBe(true)
    const withInputs = PIPELINE_SMOKE_MANIFEST.find((item) => item.inputs.length > 0)
    expect(Object.isFrozen(withInputs.inputs)).toBe(true)
    expect(Object.isFrozen(withInputs.inputs[0])).toBe(true)
  })

  it('--only 未知流水线立即报错，不静默返回空结果', () => {
    expect(() => validateOnly(['not-a-real-pipeline'], PIPELINE_SMOKE_MANIFEST, PIPELINE_SMOKE_EXCLUDED))
      .toThrow('未知流水线')
    expect(() => validateOnly(['cinematic'], PIPELINE_SMOKE_MANIFEST, PIPELINE_SMOKE_EXCLUDED))
      .not.toThrow()
  })

  it('--json 不得写到工作区/临时目录之外', () => {
    expect(resolveReportPath('artifacts/pipeline-smoke/report.json')).toContain('artifacts')
    expect(() => resolveReportPath('../../outside-report.json')).toThrow('只能写入')
  })

  it('未知 pipeline 判 BROKEN(MANIFEST_UNKNOWN_PIPELINE)', () => {
    const manifest = [
      ...PIPELINE_SMOKE_MANIFEST,
      { pipeline: 'not-a-real-pipeline', driver: null, defaultParams: {}, expectedArtifact: 'none', timeoutSec: 60 },
    ]
    const report = auditAll(baseOptions({ manifest }))
    const item = report.items.find((entry) => entry.pipeline === 'not-a-real-pipeline')
    expect(item.status).toBe('BROKEN')
    expect(item.reasonCode).toBe('MANIFEST_UNKNOWN_PIPELINE')
  })
})

describe('pipeline-smoke 报告与退出码', () => {
  it('summary 计数与 items 状态一致', () => {
    const report = auditAll(baseOptions())
    const expected = summarize(report.items)
    expect(report.summary).toEqual(expected)
    expect(report.summary.total).toBe(report.items.length)
  })

  it('默认模式只有 BROKEN 才退出 1，BLOCKED 不阻断', () => {
    const blockedOnly = auditAll(baseOptions())
    expect(computeExitCode(blockedOnly, { strict: false })).toBe(0)
    expect(computeExitCode(blockedOnly, { strict: true })).toBe(1)

    const broken = auditAll(baseOptions({
      engine: fakeEngine([{ pipeline: 'cinematic', stage: 'ingest', type: 'cinematic_ingest' }]),
    }))
    expect(computeExitCode(broken, { strict: false })).toBe(1)
  })
})

describe('pipeline-smoke 生产装配', () => {
  it('createWiringEngine 能完成生产注册且无失败', () => {
    const { engine, failures } = createWiringEngine()
    expect(failures).toEqual([])
    expect(engine.listUnwiredStageTypes()).toEqual([])
  })
})

describe('pipeline-smoke 合成素材', () => {
  it('生成计划覆盖清单中所有必需输入文件', () => {
    const plan = buildFixturePlan()
    const files = plan.map((item) => item.file)
    const required = PIPELINE_SMOKE_MANIFEST
      .flatMap((item) => item.inputs || [])
      .map((input) => input.file)
    for (const file of required) {
      expect(files).toContain(file)
    }
    for (const item of plan) {
      expect(item.args.length).toBeGreaterThan(0)
      expect(item.args).toContain('-y')
    }
  })

  it('已有非空文件时跳过生成（幂等）', () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-smoke-fixture-'))
    const target = path.join(dir, 'podcast-source.mp3')
    fs.writeFileSync(target, 'exists')
    const result = ensureFixture('ffmpeg-does-not-exist', dir, { file: 'podcast-source.mp3', args: ['-y'] })
    expect(result.status).toBe('SKIP_EXISTS')
    expect(result.path).toBe(target)
  })
})
