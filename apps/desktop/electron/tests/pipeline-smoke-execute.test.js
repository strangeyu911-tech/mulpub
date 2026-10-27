import { describe, it, expect } from 'vitest'

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  buildLocalParams,
  extractArtifact,
  isArtifactPathAllowed,
  runLocalPipeline,
  SUPPORTED_LOCAL_PIPELINES,
} = require('../../scripts/pipeline-smoke/execute')
const { auditAll } = require('../../scripts/pipeline-smoke/audit')
const {
  PIPELINE_SMOKE_MANIFEST,
  PIPELINE_SMOKE_EXCLUDED,
} = require('../../scripts/pipeline-smoke/manifest')
const { PIPELINE_DEFINITIONS } = require('../services/pipeline-engine')

function fakeEngine (result) {
  return { startOrchestrated: async () => result }
}

function tempArtifact (name = 'talkinghead_output.mp4') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-smoke-exec-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, 'fake-video-bytes')
  return file
}

describe('pipeline-smoke execute — 参数与产物', () => {
  it('只支持已登记的本地流水线', () => {
    expect(SUPPORTED_LOCAL_PIPELINES.has('talking-head')).toBe(true)
    expect(SUPPORTED_LOCAL_PIPELINES.has('framework-smoke')).toBe(true)
    expect(() => buildLocalParams('animation')).toThrow('UNSUPPORTED_PIPELINE')
  })

  it('talking-head 参数包含可读视频与口播文案', () => {
    const params = buildLocalParams('talking-head', { inputDir: 'C:/inputs' })
    expect(params.video).toContain('talkinghead-source.mp4')
    expect(params.text.length).toBeGreaterThan(0)
    expect(params.autoAdvance).toBe(true)
    expect(params.checkpointPolicy).toBe('none')
  })

  it('extractArtifact 优先 render.videoPath，不把 upload 输入当产物', () => {
    expect(extractArtifact({ render: { videoPath: 'C:/out.mp4' } })).toBe('C:/out.mp4')
    expect(extractArtifact({ upload: { videoPath: 'C:/in.mp4' }, render: { videoPath: 'C:/out.mp4' } })).toBe('C:/out.mp4')
    expect(extractArtifact({ outputPath: 'C:/out2.mp4' })).toBe('C:/out2.mp4')
    expect(extractArtifact({ meta: { outputPath: 'C:/not-final.mp4' } })).toBe(null)
    expect(extractArtifact({})).toBe(null)
  })

  it('产物路径只允许临时目录或工作区 artifacts', () => {
    expect(isArtifactPathAllowed(path.join(os.tmpdir(), 'story2video', 'a.mp4'))).toBe(true)
    const outside = path.resolve(os.tmpdir(), '..', 'evil.mp4')
    expect(isArtifactPathAllowed(outside)).toBe(false)
  })
})

describe('pipeline-smoke execute — 结果判定', () => {
  it('不支持的流水线返回 FAIL(UNSUPPORTED_PIPELINE)，不抛异常', async () => {
    const report = await runLocalPipeline('animation', {}, {})
    expect(report.status).toBe('FAIL')
    expect(report.reasonCode).toBe('UNSUPPORTED_PIPELINE')
  })

  it('缺输入时返回 FAIL(MISSING_INPUT)，不进入引擎', async () => {
    const report = await runLocalPipeline('talking-head', { video: 'C:/does/not/exist.mp4' }, {})
    expect(report.status).toBe('FAIL')
    expect(report.reasonCode).toBe('MISSING_INPUT')
  })

  it('引擎装配失败返回 FAIL(EXECUTION_SETUP_FAILED)，不抛异常', async () => {
    const report = await runLocalPipeline('talking-head', { video: tempArtifact('input.mp4') }, {
      createEngine: () => { throw new Error('boom-setup') },
      probe: () => ({}),
    })
    expect(report.status).toBe('FAIL')
    expect(report.reasonCode).toBe('EXECUTION_SETUP_FAILED')
  })

  it('成功且产物存在/可探测时 PASS', async () => {
    const artifact = tempArtifact()
    const report = await runLocalPipeline('talking-head', { video: tempArtifact('input.mp4') }, {
      engine: fakeEngine({
        success: true,
        runId: 'run-ok',
        context: { render: { videoPath: artifact } },
        results: [{ stage: 'upload' }, { stage: 'transcribe' }, { stage: 'captions' }, { stage: 'render' }],
      }),
      probe: () => ({ duration: 4, codec: 'h264' }),
    })
    expect(report.status).toBe('PASS')
    expect(report.artifact).toBe(artifact)
    expect(report.probe.duration).toBe(4)
    expect(report.stages).toHaveLength(4)
  })

  it('引擎失败时 FAIL 且带 errorCode', async () => {
    const report = await runLocalPipeline('talking-head', { video: tempArtifact('input.mp4') }, {
      engine: fakeEngine({
        success: false,
        runId: 'run-fail',
        error: 'talking-head upload 需要可读的本地视频',
        errorCode: 'STAGE_FAILED',
        results: [{ stage: 'upload', success: false }],
      }),
      probe: () => ({}),
    })
    expect(report.status).toBe('FAIL')
    expect(report.reasonCode).toBe('STAGE_FAILED')
    expect(report.error).toContain('可读的本地视频')
  })

  it('成功但无产物时 FAIL(NO_ARTIFACT)', async () => {
    const report = await runLocalPipeline('talking-head', { video: tempArtifact('input.mp4') }, {
      engine: fakeEngine({ success: true, runId: 'run-empty', context: {}, results: [] }),
      probe: () => ({}),
    })
    expect(report.status).toBe('FAIL')
    expect(report.reasonCode).toBe('NO_ARTIFACT')
  })

  it('产物探测失败时 FAIL(PROBE_FAILED)', async () => {
    const artifact = tempArtifact()
    const report = await runLocalPipeline('talking-head', { video: tempArtifact('input.mp4') }, {
      engine: fakeEngine({ success: true, runId: 'run-probe', context: { render: { videoPath: artifact } }, results: [] }),
      probe: () => { throw new Error('ffprobe boom') },
    })
    expect(report.status).toBe('FAIL')
    expect(report.reasonCode).toBe('PROBE_FAILED')
  })
})

describe('pipeline-smoke execute — 与审计清单联动', () => {
  it('talking-head 使用 builtin:local-executor 后审计不再报 NO_DRIVER', () => {
    const entry = PIPELINE_SMOKE_MANIFEST.find((item) => item.pipeline === 'talking-head')
    expect(entry.driver).toBe('builtin:local-executor')
    const report = auditAll({
      definitions: PIPELINE_DEFINITIONS,
      manifest: PIPELINE_SMOKE_MANIFEST,
      excluded: PIPELINE_SMOKE_EXCLUDED,
      engine: { listUnwiredStageTypes: () => [] },
      env: {},
      inputDir: 'C:/inputs',
      driverExists: () => true,
      inputExists: () => true,
      toolExists: () => true,
    })
    const item = report.items.find((row) => row.pipeline === 'talking-head')
    expect(item.status).toBe('READY')
  })
})
