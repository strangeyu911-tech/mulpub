import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import cdp from '../../tests/e2e/pipeline-smoke-cdp.js'

const {
  buildParams,
  findOutput,
  manifestEntry,
  parseArgs,
  statusOf,
} = cdp

function tempArtifact (name = 'out.mp4') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-cdp-test-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, 'x')
  return file
}

describe('pipeline-smoke-cdp — 参数与产物', () => {
  it('parseArgs 解析 pipeline/params/json/cdp-port/timeout', () => {
    const options = parseArgs([
      '--pipeline', 'podcast-repurpose',
      '--params', '{"transcript":"a"}',
      '--json', 'out.json',
      '--cdp-port', '9333',
      '--timeout-ms', '1000',
    ])
    expect(options.pipeline).toBe('podcast-repurpose')
    expect(options.params.transcript).toBe('a')
    expect(options.json).toBe('out.json')
    expect(options.cdpPort).toBe(9333)
    expect(options.timeoutMs).toBe(1000)
  })

  it('podcast 参数补齐 audio 与 transcript', () => {
    const params = buildParams('podcast-repurpose', { inputDir: 'C:/inputs' })
    expect(params.audio).toContain('podcast-source.mp3')
    expect(params.transcript.length).toBeGreaterThan(0)
    expect(params.autoAdvance).toBe(true)
    expect(params.checkpointPolicy).toBe('none')
  })

  it('animation/documentary/hybrid 参数补齐 text', () => {
    for (const pipeline of ['animation', 'documentary-montage', 'hybrid']) {
      const params = buildParams(pipeline, { inputDir: 'C:/inputs' })
      expect(params.text.length).toBeGreaterThan(0)
    }
  })

  it('未知流水线抛错', () => {
    expect(() => buildParams('not-a-pipeline', {})).toThrow('UNKNOWN_PIPELINE')
    expect(manifestEntry('podcast-repurpose').pipeline).toBe('podcast-repurpose')
  })

  it('findOutput 识别 localization sync.videoPath（译制成品在 sync 阶段）', () => {
    const output = tempArtifact('localized.mp4')
    const audio = tempArtifact('localized.mp3')
    expect(findOutput({ transcribe: {}, sync: { videoPath: output } })).toBe(output)
    expect(findOutput({ transcribe: {}, sync: { audioPath: audio } })).toBe(audio)
  })

  it('findOutput 优先 render，且排除输入文件', () => {
    const input = tempArtifact('input.mp4')
    const output = tempArtifact('output.mp4')
    const found = findOutput({ render: { videoPath: output }, upload: { videoPath: input } }, new Set([path.resolve(input)]))
    expect(found).toBe(output)
  })

  it('findOutput 跳过不存在/相对路径文件，返回 null', () => {
    expect(findOutput({ render: { videoPath: path.join(os.tmpdir(), 'mp-does-not-exist.mp4') } })).toBe(null)
    expect(findOutput({ render: { videoPath: 'relative-output.mp4' } })).toBe(null)
  })

  it('statusOf 兼容对象/字符串快照', () => {
    expect(statusOf({ status: { status: 'completed' } })).toBe('completed')
    expect(statusOf({ status: 'running' })).toBe('running')
    expect(statusOf(null)).toBe(null)
  })
})
