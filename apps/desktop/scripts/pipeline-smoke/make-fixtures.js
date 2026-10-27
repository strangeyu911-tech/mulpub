#!/usr/bin/env node
/**
 * 生成流水线 E2E 冒烟所需的合成输入素材（ffmpeg testsrc / sine）。
 *
 * 只用于本地冒烟，不进入仓库；默认输出到 E2E_INPUTS 或 <tmp>/story2video/e2e-inputs。
 *
 * 用法：
 *   node apps/desktop/scripts/pipeline-smoke/make-fixtures.js
 *   node apps/desktop/scripts/pipeline-smoke/make-fixtures.js --force
 *   node apps/desktop/scripts/pipeline-smoke/make-fixtures.js --input-dir D:/tmp/e2e-inputs
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { findFfmpeg } = require('../../electron/services/media-tool-paths')

const DEFAULT_INPUT_DIR = path.join(os.tmpdir(), 'story2video', 'e2e-inputs')

function buildFixturePlan () {
  return [
    {
      file: 'cinematic-source.mp4',
      description: '电影感调色源（4s testsrc）',
      args: ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=24',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
    },
    {
      file: 'clipfactory-long.mp4',
      description: '长视频切片源（12s testsrc）',
      args: ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=12:size=640x360:rate=24',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
    },
    {
      file: 'localization-source.mp4',
      description: '译制源（4s 视频 + 440Hz 音频）',
      args: ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
        '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', '-pix_fmt', 'yuv420p'],
    },
    {
      file: 'talkinghead-source.mp4',
      description: '口播源（4s 视频 + 440Hz 音频）',
      args: ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
        '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', '-pix_fmt', 'yuv420p'],
    },
    {
      file: 'podcast-source.mp3',
      description: '播客音频（5s sine）',
      args: ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'libmp3lame', '-q:a', '4'],
    },
  ]
}

function ensureFixture (ffmpeg, inputDir, fixture, { force = false } = {}) {
  const target = path.join(inputDir, fixture.file)
  if (!force && fs.existsSync(target) && fs.statSync(target).size > 0) {
    return { file: fixture.file, status: 'SKIP_EXISTS', path: target }
  }
  execFileSync(ffmpeg, [...fixture.args, target], { stdio: 'ignore', timeout: 120000 })
  return { file: fixture.file, status: 'CREATED', path: target }
}

function main (argv = process.argv.slice(2)) {
  const force = argv.includes('--force')
  const dirIndex = argv.indexOf('--input-dir')
  const inputDir = dirIndex >= 0 && argv[dirIndex + 1]
    ? path.resolve(argv[dirIndex + 1])
    : (process.env.E2E_INPUTS || DEFAULT_INPUT_DIR)
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    console.error('[pipeline-smoke] 未找到 ffmpeg，无法生成冒烟素材')
    return 2
  }
  fs.mkdirSync(inputDir, { recursive: true })
  const results = []
  for (const fixture of buildFixturePlan()) {
    results.push(ensureFixture(ffmpeg, inputDir, fixture, { force }))
  }
  for (const result of results) {
    console.log(result.status + ' ' + result.file + ' -> ' + result.path)
  }
  console.log('INPUT_DIR=' + inputDir)
  return 0
}

if (require.main === module) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error('[pipeline-smoke] FAILED: ' + (error && error.stack ? error.stack : String(error)))
    process.exitCode = 2
  }
}

module.exports = { buildFixturePlan, ensureFixture, main, DEFAULT_INPUT_DIR }
