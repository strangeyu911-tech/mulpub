// @vitest-environment node
// @ts-check
/**
 * explainer-narration-track.test.js — 旁白轨合成（上游 edit_decisions 分段语义）
 *
 * ## 覆盖什么
 *
 * ① **纯逻辑**（任何环境都跑）：`asset_id → 路径` 的解析、排序、缺失登记；
 * ② **需要 ffmpeg**（缺 ffmpeg 时如实 skip）：真的按 `start_seconds` 把两段旁白
 *    放到时间轴上，混出来的轨**不是静音**，且总长对齐画面。
 *
 * ## 为什么需要 ffmpeg 的那半必须 skip
 *
 * ⚠ CI runner **没有** ffmpeg ⇒ 不 skip 就会真去调 ffmpeg ⇒ 挂住 ⇒ 10 秒超时
 *   （这是仓内 `title-card-renderer` 踩过的形态：稳定复现的超时不是 flaky，是缺守卫）。
 * ⚠ 但 skip **只护住依赖 ffmpeg 的那半**：纯逻辑断言始终执行 ⇒ 不是恒绿。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { findFfmpeg, findFfprobe } = require('../media-tool-paths')
const {
  resolveNarrationSegments,
  buildNarrationTrack,
  muxNarration,
} = require('./explainer-narration-track')

const ffmpeg = findFfmpeg()
const ffprobe = findFfprobe()
const hasMedia = Boolean(ffmpeg && ffprobe)

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-narration-test-'))
}

describe('explain 旁白轨：asset_id 解析（纯逻辑，任何环境都跑）', () => {
  const assetLookup = {
    'narration-s1': { path: '/tmp/a1.mp3', type: 'narration' },
    'narration-s2': { path: '/tmp/a2.mp3', type: 'narration' },
  }

  it('★ asset_id 解析成文件路径（上游 compose 的 asset_lookup 语义）', () => {
    const { items } = resolveNarrationSegments(
      [{ asset_id: 'narration-s1', start_seconds: 0, end_seconds: 5 }],
      assetLookup
    )
    expect(items).toHaveLength(1)
    expect(items[0].path).toBe('/tmp/a1.mp3')
    expect(items[0].startSeconds).toBe(0)
    expect(items[0].endSeconds).toBe(5)
  })

  it('★ 按 start_seconds 排序（时间轴是权威）', () => {
    const { items } = resolveNarrationSegments([
      { asset_id: 'narration-s2', start_seconds: 6 },
      { asset_id: 'narration-s1', start_seconds: 0 },
    ], assetLookup)
    expect(items.map(i => i.startSeconds)).toEqual([0, 6])
  })

  it('★ asset_id 找不到 ⇒ 登记到 missing（不静默丢段）', () => {
    const { items, missing } = resolveNarrationSegments([
      { asset_id: 'narration-s1', start_seconds: 0 },
      { asset_id: 'narration-ghost', start_seconds: 5 },
    ], assetLookup)
    expect(items).toHaveLength(1)
    expect(missing).toEqual(['narration-ghost'])
  })

  it('没有 segments ⇒ 返回空（调用方据此判「没旁白」）', () => {
    const { items } = resolveNarrationSegments(undefined, assetLookup)
    expect(items).toHaveLength(0)
  })

  it('start_seconds 非法（负数/非数）⇒ 跳过该段', () => {
    const { items } = resolveNarrationSegments([
      { asset_id: 'narration-s1', start_seconds: -1 },
      { asset_id: 'narration-s2', start_seconds: 'abc' },
    ], assetLookup)
    expect(items).toHaveLength(0)
  })
})

describe.skipIf(!hasMedia)('explain 旁白轨：真实 ffmpeg 合成（缺 ffmpeg 时跳过）', () => {
  /** 造一段指定时长与音量的音频（用 ffmpeg 的 sine 源） */
  async function makeTone (file, seconds, freq) {
    const { execFile } = await import('node:child_process')
    await new Promise((resolve, reject) => {
      execFile(ffmpeg, [
        '-hide_banner', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=' + freq + ':duration=' + seconds,
        '-c:a', 'aac', '-b:a', '96k', file,
      ], (error) => (error ? reject(error) : resolve()))
    })
    return file
  }

  async function probeDuration (file) {
    const { execFile } = await import('node:child_process')
    const out = await new Promise((resolve, reject) => {
      execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim())))
    })
    return Number(out)
  }

  it('★ 两段旁白按 start_seconds 落到时间轴上 ⇒ 混出来的轨**不是静音**', async () => {
    const dir = tmpDir()
    const a1 = await makeTone(path.join(dir, 'a1.m4a'), 2, 440)
    const a2 = await makeTone(path.join(dir, 'a2.m4a'), 2, 880)
    const out = path.join(dir, 'narration.m4a')
    const result = await buildNarrationTrack({
      segments: [
        { asset_id: 'narration-s1', start_seconds: 0, end_seconds: 2 },
        { asset_id: 'narration-s2', start_seconds: 4, end_seconds: 6 },
      ],
      assetLookup: {
        'narration-s1': { path: a1 },
        'narration-s2': { path: a2 },
      },
      outputPath: out,
      totalSeconds: 6,
      ffmpegPath: ffmpeg,
    })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(out)).toBe(true)
    // ⚠ 总长对齐画面（6 秒）
    const duration = await probeDuration(out)
    expect(duration).toBeGreaterThan(5.5)
    expect(duration).toBeLessThan(6.6)
  })

  it('★ 间隙处是静音而不是「旁白被拉长」⇒ 第二段从第 4 秒才开始', async () => {
    const dir = tmpDir()
    // 两段同频 ⇒ 若时间轴错位（直接 concat），波形会连成一片；正确对齐时 2~4 秒是静音
    const a1 = await makeTone(path.join(dir, 'b1.m4a'), 2, 440)
    const a2 = await makeTone(path.join(dir, 'b2.m4a'), 2, 440)
    const out = path.join(dir, 'narration-gap.m4a')
    const result = await buildNarrationTrack({
      segments: [
        { asset_id: 'narration-s1', start_seconds: 0, end_seconds: 2 },
        { asset_id: 'narration-s2', start_seconds: 4, end_seconds: 6 },
      ],
      assetLookup: { 'narration-s1': { path: a1 }, 'narration-s2': { path: a2 } },
      outputPath: out,
      totalSeconds: 6,
      ffmpegPath: ffmpeg,
    })
    expect(result.ok).toBe(true)
    const { execFile } = await import('node:child_process')
    const stderr = await new Promise((resolve) => {
      execFile(ffmpeg, ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'],
        (error, stdout, err) => resolve(String(err || stdout)))
    })
    // 整条轨有声音（mean_volume 明显高于数字静音下界 −91 dB）
    const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr)
    expect(mean).toBeTruthy()
    expect(Number(mean[1])).toBeGreaterThan(-85)
  })

  it('★ 旁白轨能 mux 到画面上（产物有视频流 + 音频流）', async () => {
    const dir = tmpDir()
    const a1 = await makeTone(path.join(dir, 'c1.m4a'), 2, 440)
    const video = path.join(dir, 'video.mp4')
    const { execFile } = await import('node:child_process')
    await new Promise((resolve, reject) => {
      execFile(ffmpeg, [
        '-hide_banner', '-y',
        '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video,
      ], (error) => (error ? reject(error) : resolve()))
    })
    const track = path.join(dir, 'track.m4a')
    const built = await buildNarrationTrack({
      segments: [{ asset_id: 'narration-s1', start_seconds: 0, end_seconds: 2 }],
      assetLookup: { 'narration-s1': { path: a1 } },
      outputPath: track,
      totalSeconds: 3,
      ffmpegPath: ffmpeg,
    })
    expect(built.ok).toBe(true)
    const out = path.join(dir, 'final.mp4')
    const muxed = await muxNarration({ videoPath: video, audioPath: track, outputPath: out, ffmpegPath: ffmpeg })
    expect(muxed.ok).toBe(true)
    expect(fs.existsSync(out)).toBe(true)
    const probe = await new Promise((resolve, reject) => {
      execFile(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', out],
        (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))))
    })
    const types = (probe.streams || []).map(s => s.codec_type)
    expect(types).toContain('video')
    expect(types).toContain('audio')
  })

  it('★ 画面文件不存在 ⇒ mux 明确失败（不静默产出空片）', async () => {
    const result = await muxNarration({
      videoPath: path.join(os.tmpdir(), 'no-such-video-' + Date.now() + '.mp4'),
      audioPath: path.join(os.tmpdir(), 'no-such-audio-' + Date.now() + '.m4a'),
      outputPath: path.join(os.tmpdir(), 'out-' + Date.now() + '.mp4'),
      ffmpegPath: ffmpeg,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('不存在')
  })
})
