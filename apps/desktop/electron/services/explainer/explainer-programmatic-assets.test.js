// @vitest-environment node
// @ts-check
/**
 * explainer-programmatic-assets.test.js — 程序化素材（示意图 / 代码片段图）的生产与降级
 *
 * ## 覆盖什么
 *
 * ① **素材声明解析**：支持的类型（diagram_gen / code_snippet）进 requests；
 *    不支持的（math_animate 等）⇒ 登记 `PROGRAMMATIC_TOOL_UNSUPPORTED`（**不静默**）；
 *    缺 type/description ⇒ 登记 `PROGRAMMATIC_REQUEST_INVALID`。
 * ② **真渲染**：产物**真的存在且非空**（真 ffmpeg）。
 * ③ **字体缺失 ⇒ 判失败**，**不产出豆腐块图**。
 * ④ **降级可见**：渲染失败 ⇒ 登记 `PROGRAMMATIC_ASSET_FAILED`，且**该镜仍可回落**。
 * ⑤ **manifest 登记**：`type='diagram' | 'code_snippet'` 能进 `asset_manifest`（上游 schema 已允许）。
 * ⑥ **compose 消费**：程序化素材当**视觉主体**（`cut.source`），AI 生图降为**背景层**
 *    （`cut.backgroundImage`），代码片段给出**终端打字机步骤**（`cut.steps`）。
 *
 * ⚠ **ffmpeg 依赖**：CI runner **有** ffmpeg（`ffmpeg-ffprobe-static` 随包）⇒ 真渲染用例可跑；
 *   若环境无 ffmpeg ⇒ 该半**如实 skip**（纯逻辑那半始终执行 ⇒ 不是恒绿）。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { findFfmpeg } = require('../media-tool-paths')
const {
  SUPPORTED_PROGRAMMATIC_TYPES,
  KNOWN_UNSUPPORTED_TYPES,
  resolveProgrammaticRequests,
  parseDiagramNodes,
  parseCodeLines,
  renderDiagramAsset,
  renderCodeSnippetAsset,
  buildProgrammaticAssets,
  buildTerminalSteps,
} = require('./explainer-programmatic-assets')
const { buildAssetManifest } = require('./explainer-prod-artifacts')
const { buildCut } = require('./explainer-remotion-props')

const HAS_FFMPEG = Boolean(findFfmpeg())

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-programmatic-test-'))
}

function scene (overrides = {}) {
  return {
    id: 'scene-1',
    type: 'broll',
    description: '画面主体',
    start_seconds: 0,
    end_seconds: 6,
    required_assets: [],
    ...overrides,
  }
}

describe('explain 程序化素材：素材声明解析', () => {
  it('★ 声明 diagram_gen / code_snippet ⇒ 进 requests（带 assetType 与 kind）', () => {
    const { requests, issues } = resolveProgrammaticRequests(scene({
      required_assets: [
        { type: 'diagram_gen', description: '情绪调节的三段结构', source: 'generate' },
        { type: 'code_snippet', description: 'def f(x):\n  return x', source: 'generate' },
      ],
    }))
    expect(requests).toHaveLength(2)
    expect(requests[0].assetType).toBe('diagram')
    expect(requests[0].kind).toBe('diagram')
    expect(requests[1].assetType).toBe('code_snippet')
    expect(requests[1].kind).toBe('code')
    expect(issues).toHaveLength(0)
  })

  it('★ 声明上游但本版未实现的类型 ⇒ 登记 PROGRAMMATIC_TOOL_UNSUPPORTED（不静默跳过）', () => {
    const { requests, issues } = resolveProgrammaticRequests(scene({
      required_assets: [{ type: 'math_animate', description: '微积分推导', source: 'generate' }],
    }))
    expect(requests).toHaveLength(0)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('PROGRAMMATIC_TOOL_UNSUPPORTED')
    expect(issues[0].message).toContain('math_animate')
  })

  it('★ 缺 type 或 description ⇒ 登记 PROGRAMMATIC_REQUEST_INVALID 并丢弃', () => {
    const { requests, issues } = resolveProgrammaticRequests(scene({
      required_assets: [
        { type: '', description: '缺 type' },
        { type: 'diagram_gen', description: '' },
      ],
    }))
    expect(requests).toHaveLength(0)
    expect(issues).toHaveLength(2)
    expect(issues.every(i => i.code === 'PROGRAMMATIC_REQUEST_INVALID')).toBe(true)
  })

  it('没有声明 ⇒ 无请求、无 issue（行为与今天完全一致）', () => {
    const { requests, issues } = resolveProgrammaticRequests(scene())
    expect(requests).toHaveLength(0)
    expect(issues).toHaveLength(0)
  })

  it('上游词表里的未实现类型都被登记（不是漏网）', () => {
    for (const type of KNOWN_UNSUPPORTED_TYPES) {
      const { issues } = resolveProgrammaticRequests(scene({
        required_assets: [{ type, description: 'x', source: 'generate' }],
      }))
      expect(issues.some(i => i.code === 'PROGRAMMATIC_TOOL_UNSUPPORTED')).toBe(true)
    }
  })

  it('本版支持的类型表与实现一致（不许声明支持却没实现）', () => {
    expect(Object.keys(SUPPORTED_PROGRAMMATIC_TYPES).sort()).toEqual(['code_snippet', 'diagram_gen'])
  })
})

describe('explain 程序化素材：文本解析', () => {
  it('示意图节点按显式分隔符切分（顿号/逗号/分号/换行）', () => {
    const nodes = parseDiagramNodes('情绪调节、即时奖励、长期计划')
    expect(nodes).toEqual(['情绪调节', '即时奖励', '长期计划'])
  })

  it('★ 描述含糊时**不编造**节点（只给原文那一条）', () => {
    const nodes = parseDiagramNodes('一个笼统的画面描述')
    expect(nodes).toEqual(['一个笼统的画面描述'])
  })

  it('节点数有上限（再多画面就挤了）', () => {
    const nodes = parseDiagramNodes('a、b、c、d、e、f、g、h')
    expect(nodes.length).toBeLessThanOrEqual(5)
  })

  it('代码行按换行切分，空行丢弃', () => {
    expect(parseCodeLines('a\n\n  b\n')).toEqual(['a', '  b'])
  })
})

describe.skipIf(!HAS_FFMPEG)('explain 程序化素材：真渲染（无 ffmpeg 时如实 skip）', () => {
  it('★ 示意图真的产出非空 PNG', async () => {
    const dir = tmpDir()
    const out = path.join(dir, 'diagram.png')
    const result = await renderDiagramAsset({
      outputPath: out,
      description: '情绪调节、即时奖励、长期计划',
    })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(out)).toBe(true)
    expect(result.size).toBeGreaterThan(0)
  })

  it('★ 代码片段图真的产出非空 PNG', async () => {
    const dir = tmpDir()
    const out = path.join(dir, 'code.png')
    const result = await renderCodeSnippetAsset({
      outputPath: out,
      description: 'def f(x):\n    return x + 1\n# 调用\nf(1)',
    })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(out)).toBe(true)
    expect(result.size).toBeGreaterThan(0)
  })

  it('★ 字体解析不出来 ⇒ 判失败且**不产出文件**（不产出豆腐块图）', async () => {
    const dir = tmpDir()
    const out = path.join(dir, 'nofont.png')
    const result = await renderDiagramAsset({
      outputPath: out,
      description: '情绪调节',
      fontResolver: () => ({ fontFile: '', source: 'none' }),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('字体')
    expect(fs.existsSync(out)).toBe(false)
  })

  it('★ 描述为空 ⇒ 判失败（不产空图）', async () => {
    const dir = tmpDir()
    const out = path.join(dir, 'empty.png')
    const result = await renderDiagramAsset({ outputPath: out, description: '   ' })
    expect(result.ok).toBe(false)
    expect(fs.existsSync(out)).toBe(false)
  })

  it('★ 批量生产：产出资产形态与 asset_manifest 对齐（id/type/path/source_tool/scene_id）', async () => {
    const dir = tmpDir()
    const { assets, issues } = await buildProgrammaticAssets([
      scene({
        id: 'scene-7',
        required_assets: [{ type: 'diagram_gen', description: 'A、B、C', source: 'generate' }],
      }),
    ], { outputDir: dir })
    expect(assets).toHaveLength(1)
    expect(assets[0].id).toBe('asset-scene-7-diagram')
    expect(assets[0].type).toBe('diagram')
    expect(assets[0].source_tool).toBe('diagram_gen')
    expect(assets[0].scene_id).toBe('scene-7')
    expect(assets[0].cost_usd).toBe(0)
    expect(fs.existsSync(assets[0].path)).toBe(true)
    expect(issues).toHaveLength(0)
  })

  it('★ 渲染失败 ⇒ 登记 PROGRAMMATIC_ASSET_FAILED 且**不产出资产**（该镜可回落）', async () => {
    const dir = tmpDir()
    const { assets, issues } = await buildProgrammaticAssets([
      scene({
        id: 'scene-8',
        required_assets: [{ type: 'diagram_gen', description: 'A', source: 'generate' }],
      }),
    ], {
      outputDir: dir,
      // 注入「没有字体」的解析器 ⇒ 渲染必失败
      fontResolver: () => ({ fontFile: '', source: 'none' }),
    })
    expect(assets).toHaveLength(0)
    expect(issues.some(i => i.code === 'PROGRAMMATIC_ASSET_FAILED')).toBe(true)
  })
})

describe('explain 程序化素材：进入 asset_manifest 与 compose', () => {
  it('★ 程序化资产能进 asset_manifest（type 取上游枚举里的 diagram / code_snippet）', () => {
    const manifest = buildAssetManifest({ scenes: [] }, {
      scenePlan: { version: '1.0', scenes: [scene({ id: 'scene-1' })] },
      programmaticAssets: [{
        id: 'asset-scene-1-diagram',
        type: 'diagram',
        path: '/tmp/asset-scene-1-diagram.png',
        source_tool: 'diagram_gen',
        scene_id: 'scene-1',
        prompt: 'A、B、C',
        resolution: '1280x720',
      }],
    })
    const hit = manifest.assets.find(a => a.id === 'asset-scene-1-diagram')
    expect(hit).toBeTruthy()
    expect(hit.type).toBe('diagram')
    expect(hit.scene_id).toBe('scene-1')
    expect(hit.cost_usd).toBe(0)
    // ⚠ 成本求和必须仍与各资产之和一致（既有 TOTAL_COST_MISMATCH 判据会兜）
    const sum = manifest.assets.reduce((acc, a) => acc + (Number(a.cost_usd) || 0), 0)
    expect(Math.abs(sum - manifest.total_cost_usd)).toBeLessThan(0.0001)
  })

  it('★ 程序化资产可以**替代** AI 生图（该镜不再缺资产）', () => {
    const manifest = buildAssetManifest({ scenes: [{ text: '旁白' }] }, {
      scenePlan: { version: '1.0', scenes: [scene({ id: 'scene-1' })] },
      programmaticAssets: [{
        id: 'asset-scene-1-diagram',
        type: 'diagram',
        path: '/tmp/d.png',
        source_tool: 'diagram_gen',
        scene_id: 'scene-1',
        prompt: 'A',
      }],
    })
    // 该镜只有程序化资产 ⇒ 不应报「场景没有任何资产」
    const withoutAsset = manifest.metadata.issues.filter(i => i.code === 'SCENE_WITHOUT_ASSET')
    expect(withoutAsset).toHaveLength(0)
  })

  it('★ cut 消费：示意图当**视觉主体**（整屏媒体）', () => {
    const cut = buildCut(scene({
      id: 'scene-1',
      required_assets: [{ type: 'diagram_gen', description: 'A、B', source: 'generate' }],
    }), {
      narration: '这一镜讲结构',
      imagePath: '/tmp/ai.png',
      imagePaths: ['/tmp/ai.png'],
      programmaticPath: '/tmp/diagram.png',
      programmaticType: 'diagram',
    })
    expect(cut.source).toBe('/tmp/diagram.png')
    // ⚠ **必须是媒体型 cut**（见下一条）；且该图进 images ⇒ 合成器的 AnimeScene 整屏渲染它
    expect(cut.type).toBe('anime_scene')
    expect(cut.images).toEqual(['/tmp/diagram.png'])
    // ⚠ 示意图上的字要看得清 ⇒ 不做 ken-burns、不加粒子、不压暗角
    expect(cut.animation).toBe('static')
    expect(cut.particles).toBe('')
    expect(cut.vignette).toBe(false)
  })

  it('★ 素材声明 diagram_gen 时 cut 类型**不能**落在卡片类组件上（否则素材被盖住、不上屏）', () => {
    // ⚠ 合成器的 `cut.source` 只是**媒体兜底分支**：卡片类组件（text_card 等）会**抢先匹配**
    //   ⇒ 素材永远不出现（本轮 E2E 实测踩到：示意图全程不显示）。
    //   ⇒ 判据：带程序化素材的 cut，其 type 必须是**媒体型**（合成器会用 images/source 渲染它）。
    const cut = buildCut(scene({
      id: 'scene-x',
      required_assets: [{ type: 'diagram_gen', description: 'A、B', source: 'generate' }],
    }), {
      narration: '这一镜讲结构',
      programmaticPath: '/tmp/diagram.png',
      programmaticType: 'diagram',
    })
    const CARD_TYPES = ['text_card', 'stat_card', 'callout', 'comparison', 'hero_title',
      'terminal_scene', 'screenshot_scene', 'bar_chart', 'line_chart', 'pie_chart',
      'kpi_grid', 'progress_bar']
    expect(CARD_TYPES).not.toContain(cut.type)
  })

  it('★ 没有程序化素材时行为与今天一致（cut.source = AI 生图，无背景层）', () => {
    const cut = buildCut(scene({ id: 'scene-1' }), {
      narration: '这一镜讲结构',
      imagePath: '/tmp/ai.png',
      imagePaths: ['/tmp/ai.png'],
    })
    expect(cut.source).toBe('/tmp/ai.png')
    expect(cut.backgroundImage).toBeUndefined()
  })

  it('★ 代码片段 ⇒ 给出终端打字机步骤（否则合成器会静默走兜底分支）', () => {
    const cut = buildCut(scene({
      id: 'scene-2',
      required_assets: [{ type: 'code_snippet', description: '$ f(1)\n2', source: 'generate' }],
    }), {
      narration: '这一镜讲代码',
      programmaticPath: '/tmp/code.png',
      programmaticType: 'code_snippet',
      codeSnippetText: '$ f(1)\n2',
    })
    expect(Array.isArray(cut.steps)).toBe(true)
    expect(cut.steps.length).toBeGreaterThan(0)
    expect(cut.steps[0].kind).toBe('cmd')
    expect(cut.steps[0].text).toBe('f(1)')
  })

  it('★ 终端步骤：$ 开头是命令（逐字），其余是输出（瞬间）', () => {
    const steps = buildTerminalSteps('$ npm run build\ndone in 3s')
    expect(steps).toHaveLength(2)
    expect(steps[0].kind).toBe('cmd')
    expect(steps[0].text).toBe('npm run build')
    expect(steps[1].kind).toBe('out')
    expect(steps[1].text).toBe('done in 3s')
  })
})
