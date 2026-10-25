// @vitest-environment node
// @ts-check
/**
 * explainer-remotion-render.test.js — Remotion 渲染的**产物有效性**判定
 *
 * ## 为什么要有这个模块（读代码时发现的缺陷）
 *
 * ⚠ 原实现的「CLI 报失败但 mp4 有效 ⇒ 仍算成功」这条恢复路径是**死代码**：
 *   - `RenderEngine.render()` **从不 reject**，CLI 非零退出时 resolve `{success:false}`
 *     且**不带 outputPath** ⇒ 调用方拿不到路径；
 *   - `RenderEngine.getStatus()` 只返回 `{ready, composerExists, nodeModulesExist, composerDir}`
 *     ⇒ **永远不含 outputPath** ⇒ 「从 status 里捞路径」这条路根本不存在。
 *   ⇒ 结果：Remotion 其实出了片，流水线仍判定失败并**静默回落**到 ffmpeg 图片轮播。
 *
 * ## 本文件锁住什么
 *
 * ① **产物有效性优先于退出码**（上游实测形态：CLI TimeoutError 但 mp4 完全有效）；
 * ② 产物确实无效 ⇒ 判失败（**不许**把「没产物」当成功）；
 * ③ 产物路径由本片**显式指定**（否则事后无从得知该去哪儿找）；
 * ④ runId 进路径前**必须消毒**（`render()` 用 `shell: true` spawn ⇒ 空格会拆坏命令行）。
 *
 * ⚠ **单测不依赖 ffmpeg**：CI runner 没有 ffmpeg ⇒ 产物探测用**注入的 probe**。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {
  resolveRemotionOutputPath,
  waitForArtifact,
  evaluateArtifact,
  resolveRenderedArtifact,
} = require('./explainer-remotion-render')

/** 注入的产物探测：valid=true ⇒ 有视频流且时长>0 */
function fakeProbe (valid, extra = {}) {
  return async () => ({
    valid_container: valid,
    duration_seconds: valid ? 11.05 : 0,
    resolution: valid ? '1920x1080' : '',
    fps: valid ? 30 : null,
    has_audio: true,
    codec: valid ? 'h264' : '',
    file_size_bytes: valid ? 1022813 : 0,
    issues: valid ? [] : ['产物里没有视频流'],
    ...extra,
  })
}

function tmpFile (name, content = 'x') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-remotion-test-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

describe('explainer-remotion-render', () => {
  describe('resolveRemotionOutputPath', () => {
    it('产物路径落在 tmpdir/story2video/explainer 下，且文件名固定', () => {
      const p = resolveRemotionOutputPath('run_abc123')
      expect(p.startsWith(path.join(os.tmpdir(), 'story2video', 'explainer'))).toBe(true)
      expect(path.basename(p)).toBe('explainer_output.mp4')
    })

    it('runId 里的空格/引号必须被消毒（render() 用 shell:true spawn，路径含空格会拆坏命令行）', () => {
      const p = resolveRemotionOutputPath('bad id"; rm -rf /')
      expect(p).not.toContain(' ')
      expect(p).not.toContain('"')
      expect(p).not.toContain(';')
      expect(path.basename(p)).toBe('explainer_output.mp4')
    })

    it('runId 缺省时也要给出可用路径（不许返回 undefined）', () => {
      const p = resolveRemotionOutputPath(undefined)
      expect(typeof p).toBe('string')
      expect(p.length).toBeGreaterThan(0)
    })
  })

  describe('waitForArtifact', () => {
    it('文件不存在 ⇒ 有界等待后如实报「没找到」', async () => {
      const missing = path.join(os.tmpdir(), 'explainer-remotion-not-exist-' + Date.now() + '.mp4')
      const result = await waitForArtifact(missing, { timeoutMs: 60, intervalMs: 20 })
      expect(result.found).toBe(false)
    })

    it('文件已存在且大小稳定 ⇒ 判为已落盘', async () => {
      const file = tmpFile('ready.mp4', 'stable-content')
      const result = await waitForArtifact(file, { timeoutMs: 3000, intervalMs: 20 })
      expect(result.found).toBe(true)
      expect(result.size).toBeGreaterThan(0)
    })
  })

  describe('evaluateArtifact', () => {
    it('文件不存在 ⇒ 不可用，且给出可读原因', async () => {
      const missing = path.join(os.tmpdir(), 'explainer-remotion-missing-' + Date.now() + '.mp4')
      const verdict = await evaluateArtifact(missing, { probe: fakeProbe(true) })
      expect(verdict.usable).toBe(false)
      expect(verdict.reason).toContain('不存在')
    })

    it('探测判容器无效 ⇒ 不可用（不许把坏产物当成功）', async () => {
      const file = tmpFile('broken.mp4', 'not-a-real-mp4')
      const verdict = await evaluateArtifact(file, { probe: fakeProbe(false) })
      expect(verdict.usable).toBe(false)
      expect(verdict.reason).toContain('无效')
    })

    it('探测判容器有效 ⇒ 可用', async () => {
      const file = tmpFile('ok.mp4', 'pretend-mp4')
      const verdict = await evaluateArtifact(file, { probe: fakeProbe(true) })
      expect(verdict.usable).toBe(true)
      expect(verdict.reason).toBe('')
    })
  })

  describe('resolveRenderedArtifact —— 成败判据是产物有效性，不是退出码', () => {
    it('★ CLI 报失败但产物有效 ⇒ 判成功且标记 recovered（原实现在这条上是死代码）', async () => {
      const file = tmpFile('recovered.mp4', 'valid-mp4-bytes')
      const verdict = await resolveRenderedArtifact({
        outputPath: file,
        renderReportedSuccess: false,
        renderError: '渲染进程退出码: 1',
        probe: fakeProbe(true),
      })
      expect(verdict.usable).toBe(true)
      expect(verdict.recovered).toBe(true)
      expect(verdict.reason).toContain('退出码')
    })

    it('CLI 报成功且产物有效 ⇒ 判成功且不算 recovered', async () => {
      const file = tmpFile('ok.mp4', 'bytes')
      const verdict = await resolveRenderedArtifact({
        outputPath: file,
        renderReportedSuccess: true,
        probe: fakeProbe(true),
      })
      expect(verdict.usable).toBe(true)
      expect(verdict.recovered).toBe(false)
    })

    it('CLI 报失败且产物无效 ⇒ 判失败，并保留原始错误（供 fallback_reason 如实上报）', async () => {
      const file = tmpFile('bad.mp4', 'garbage')
      const verdict = await resolveRenderedArtifact({
        outputPath: file,
        renderReportedSuccess: false,
        renderError: '渲染进程退出码: 137',
        probe: fakeProbe(false),
        waitMs: 60,
        pollIntervalMs: 20,
      })
      expect(verdict.usable).toBe(false)
      expect(verdict.recovered).toBe(false)
      expect(verdict.reason).toContain('137')
    })

    it('CLI 报失败且根本没有产物 ⇒ 判失败（不许把「没产物」当成功）', async () => {
      const missing = path.join(os.tmpdir(), 'explainer-remotion-none-' + Date.now() + '.mp4')
      const verdict = await resolveRenderedArtifact({
        outputPath: missing,
        renderReportedSuccess: false,
        renderError: 'Remotion 渲染引擎未就绪',
        probe: fakeProbe(true),
        waitMs: 60,
        pollIntervalMs: 20,
      })
      expect(verdict.usable).toBe(false)
      expect(verdict.reason).toContain('未就绪')
    })

    it('CLI 报成功但产物无效 ⇒ 判失败（成功码不豁免产物有效性）', async () => {
      const file = tmpFile('lies.mp4', 'empty-but-present')
      const verdict = await resolveRenderedArtifact({
        outputPath: file,
        renderReportedSuccess: true,
        probe: fakeProbe(false),
        waitMs: 60,
        pollIntervalMs: 20,
      })
      expect(verdict.usable).toBe(false)
    })
  })
})
