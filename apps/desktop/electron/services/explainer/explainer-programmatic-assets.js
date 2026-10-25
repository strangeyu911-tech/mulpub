// @ts-check
/**
 * explainer-programmatic-assets — 程序化素材（**示意图 / 代码片段图**）的生产与降级
 *
 * ## 这一层解决什么
 *
 * P5a（PRD §18）把「画面」对齐上游：Remotion 程序化动画。
 * 但它的 cut type 判定把「**素材声明**」放在第一优先级
 * （`scene.required_assets[].type` ⇒ 权威），而**真实流水线里场景从来不带素材声明**
 * ⇒ 那条判据**从来没生效过** ⇒ 实际一直靠「文本线索 + 叙事兜底」在猜。
 *
 * 本层（PRD §19）补上这条链的**生产端**：
 * `场景声明 required_assets` → **真的产出素材** → 进 `asset_manifest` → compose 消费。
 *
 * ## 为什么落在桌面端主进程（而不是调 Python 侧那四个工具）
 *
 * ⚠ **桌面端到 Python 工具没有活通路**：`serviceBus.callPythonSkill()` 打的是
 *   `POST /api/skills/<name>`，而 Python 后端**没有任何 `/api/skills/*` 路由**
 *   （`server.py` 的路由清单里没有；`ToolRegistry` 也从未被挂到 HTTP 上）
 *   ⇒ 「注册 ≠ 注入 ≠ 生效」的又一例。
 * ⚠ **上游那套依赖三个外部二进制**（`manim` / `@mermaid-js/mermaid-cli` / `pygments`+`pillow`）
 *   ⇒ **用户机器装不齐 ⇒ 功能名义存在、实际不可达**。
 * ⇒ 故本层走**桌面端 Node + ffmpeg**（与已合入的 `title-card-renderer` 同构：
 *   同一套 ffmpeg 解析口径、同一套字体真源、同一套文本转义）。
 *
 * ⚠ **本层是「等价物」而非「逐字搬运上游」**：产物形态与引用模型与上游一致
 *   （进 `asset_manifest`、按 `scene_id` 关联），实现机制不同（ffmpeg drawtext/drawbox）。
 *
 * ## 降级必须可见（不静默）
 *
 * 声明了但做不出来 ⇒ **登记 issue** ⇒ 回落 AI 生图 / 文字卡
 * ⇒ 用户与排查者能看出「这一镜本来要程序化素材，实际没用上」。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { escapeDrawtextText, resolveFfmpegBinary, wrapText } = require('../title-card-renderer')
const { buildDrawtextFontOption, buildFontconfigEnv, resolveContentCjkFont } = require('../font-resolver')

const execFileAsync = promisify(execFile)

/** 本层支持的程序化素材类型（上游 assets 工具集里可在本仓落地的部分） */
const SUPPORTED_PROGRAMMATIC_TYPES = Object.freeze({
  diagram_gen: Object.freeze({ assetType: 'diagram', kind: 'diagram' }),
  code_snippet: Object.freeze({ assetType: 'code_snippet', kind: 'code' }),
})

/**
 * 上游声明过、但**本层不实现**的类型。
 * ⚠ 必须显式登记（而不是静默跳过）⇒ 否则「声明了却没生成」这件事没有任何痕迹。
 */
const KNOWN_UNSUPPORTED_TYPES = Object.freeze([
  'math_animate',
  'music_gen',
  'video_selector',
])

/** 画布尺寸（与 P5a 成片规格一致；P5c 动态尺寸后再统一收口） */
const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720

/** 主题色：与 Remotion 合成器的 `ExplainerProps.theme` 同色 ⇒ 程序化素材与程序化动画视觉一致 */
const THEME = Object.freeze({
  background: '0x0F172A',
  surface: '0x111C33',
  text: '0xF8FAFC',
  muted: '0x94A3B8',
  accent: '0x4FC3F7',
})

/** 示意图最多几个节点（再多画面就挤了） */
const MAX_DIAGRAM_NODES = 5
/** 代码片段最多几行 */
const MAX_CODE_LINES = 12
/** ffmpeg 单次调用超时（**必须小于调用方的超时**，否则失败形态永远是「Test timed out」） */
const FFMPEG_TIMEOUT_MS = 8000

function asText (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function asObject (value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray (value) {
  return Array.isArray(value) ? value : []
}

function makeIssue (code, message, severity = 'warn') {
  return { code, message, severity }
}

/**
 * 解析一个场景的**程序化素材请求**。
 *
 * @param {object} scene scene_plan.scenes[] 的一项
 * @returns {{requests: Array<{type: string, description: string, source: string, assetType: string, kind: string}>, issues: Array<object>}}
 */
function resolveProgrammaticRequests (scene) {
  const issues = []
  const requests = []
  const obj = asObject(scene)
  for (const raw of asArray(obj.required_assets)) {
    const entry = asObject(raw)
    const type = asText(entry.type)
    const description = asText(entry.description)
    if (!type || !description) {
      issues.push(makeIssue(
        'PROGRAMMATIC_REQUEST_INVALID',
        '场景「' + (asText(obj.id) || '?') + '」有一条素材声明缺 type/description，已忽略'
      ))
      continue
    }
    const supported = SUPPORTED_PROGRAMMATIC_TYPES[type]
    if (!supported) {
      issues.push(makeIssue(
        'PROGRAMMATIC_TOOL_UNSUPPORTED',
        '场景「' + (asText(obj.id) || '?') + '」声明的程序化素材「' + type + '」本版未实现，已回落'
      ))
      continue
    }
    requests.push({
      type,
      description,
      source: asText(entry.source) || 'generate',
      assetType: supported.assetType,
      kind: supported.kind,
    })
  }
  return { requests, issues }
}

/**
 * 从描述里切出**示意图的节点标签**。
 *
 * ⚠ 只做「显式分隔符切分」（顿号/逗号/分号/换行）⇒ 描述含糊时节点就少
 *   ⇒ **不给假精确的结构**（PRD §19.9 已知限制 4）。
 */
function parseDiagramNodes (description) {
  const source = String(description || '')
  const parts = source.split(/[、，,；;。\n]+/)
  const nodes = []
  for (const part of parts) {
    const label = part.trim()
    if (!label) continue
    nodes.push(label.length > 14 ? label.slice(0, 13) + '…' : label)
    if (nodes.length >= MAX_DIAGRAM_NODES) break
  }
  if (!nodes.length) {
    const whole = source.trim()
    if (whole) nodes.push(whole.length > 14 ? whole.slice(0, 13) + '…' : whole)
  }
  return nodes
}

/**
 * 从描述里切出**代码片段的行**。
 * ⚠ 多行描述 ⇒ 逐行；单行 ⇒ 单行（不编造代码）。
 */
function parseCodeLines (description) {
  const source = String(description || '').replace(/\r\n/g, '\n')
  const lines = source.split('\n')
    .map(line => line.replace(/\t/g, '  ').trimEnd())
    .filter(line => line.trim().length > 0)
  return lines.slice(0, MAX_CODE_LINES)
}

/** 等宽字体的字符宽度近似（字号 × 0.6；只用于右对齐/留白估算） */
function monoCharWidth (fontSize) {
  return Math.round(fontSize * 0.6)
}

/**
 * 构造一条 drawtext 滤镜。
 * ⚠ `buildDrawtextFontOption()` 返回的片段**自带前导冒号** ⇒ 不能再拼 `:`。
 */
function drawText (options) {
  let filter = "drawtext=text='" + escapeDrawtextText(options.text) + "'" + buildDrawtextFontOption()
  filter += ':fontcolor=' + options.color
  filter += ':fontsize=' + options.size
  filter += ':x=' + options.x
  filter += ':y=' + options.y
  return filter
}

/**
 * 渲染**示意图**：标题 + 若干节点框（竖排 + 连接线）。
 *
 * @param {object} options
 * @param {string} options.outputPath
 * @param {string} options.description 场景声明里的图描述
 * @returns {Promise<{ok: boolean, path: string, size: number, reason: string}>}
 */
async function renderDiagramAsset (options) {
  const outputPath = asText(options.outputPath)
  const nodes = parseDiagramNodes(options.description)
  if (!nodes.length) {
    return { ok: false, path: '', size: 0, reason: '图描述为空，无法生成示意图' }
  }
  const width = CANVAS_WIDTH
  const height = CANVAS_HEIGHT
  const filters = []
  // 底色
  filters.push('drawbox=x=0:y=0:w=' + width + ':h=' + height + ':color=' + THEME.background + ':t=fill')
  // 标题
  const titleLines = wrapText(options.description, 24).slice(0, 2)
  titleLines.forEach((line, index) => {
    filters.push(drawText({ text: line, color: THEME.accent, size: 34, x: 80, y: 56 + index * 44 }))
  })
  // 节点：竖排方框 + 连接线
  const boxWidth = 760
  const boxHeight = 74
  const startY = 190
  const gap = 46
  nodes.forEach((node, index) => {
    const top = startY + index * (boxHeight + gap)
    filters.push('drawbox=x=160:y=' + top + ':w=' + boxWidth + ':h=' + boxHeight +
      ':color=' + THEME.surface + ':t=fill')
    filters.push('drawbox=x=160:y=' + top + ':w=' + boxWidth + ':h=3:color=' + THEME.accent + ':t=fill')
    filters.push(drawText({ text: node, color: THEME.text, size: 28, x: 192, y: top + 22 }))
    if (index < nodes.length - 1) {
      const lineTop = top + boxHeight
      filters.push('drawbox=x=536:y=' + lineTop + ':w=3:h=' + gap + ':color=' + THEME.muted + ':t=fill')
      filters.push('drawbox=x=528:y=' + (lineTop + gap - 10) + ':w=19:h=3:color=' + THEME.muted + ':t=fill')
    }
  })
  return runFfmpeg({
    outputPath,
    filters,
    width,
    height,
    kind: 'diagram',
    fontResolver: options.fontResolver,
    ffmpegOptions: options.ffmpegOptions,
  })
}

/**
 * 渲染**代码片段图**：标题栏 + 行号 + 代码行（注释行单独着色）。
 *
 * @param {object} options
 * @param {string} options.outputPath
 * @param {string} options.description 场景声明里的代码（可多行）
 * @returns {Promise<{ok: boolean, path: string, size: number, reason: string}>}
 */
async function renderCodeSnippetAsset (options) {
  const outputPath = asText(options.outputPath)
  const lines = parseCodeLines(options.description)
  if (!lines.length) {
    return { ok: false, path: '', size: 0, reason: '代码描述为空，无法生成代码片段图' }
  }
  const width = CANVAS_WIDTH
  const height = CANVAS_HEIGHT
  const fontSize = 26
  const lineHeight = 42
  const filters = []
  filters.push('drawbox=x=0:y=0:w=' + width + ':h=' + height + ':color=' + THEME.background + ':t=fill')
  // 标题栏
  filters.push('drawbox=x=0:y=0:w=' + width + ':h=96:color=' + THEME.surface + ':t=fill')
  filters.push('drawbox=x=0:y=93:w=' + width + ':h=3:color=' + THEME.accent + ':t=fill')
  filters.push(drawText({ text: 'code', color: THEME.accent, size: 30, x: 80, y: 32 }))
  // 代码行
  const gutterWidth = monoCharWidth(fontSize) * 4
  lines.forEach((line, index) => {
    const top = 132 + index * lineHeight
    if (top + lineHeight > height - 24) return
    const isComment = /^\s*(#|\/\/)/.test(line)
    const color = isComment ? THEME.muted : THEME.text
    filters.push(drawText({
      text: String(index + 1),
      color: THEME.muted,
      size: fontSize - 4,
      x: 80,
      y: top,
    }))
    filters.push(drawText({
      text: line.length > 52 ? line.slice(0, 51) + '…' : line,
      color,
      size: fontSize,
      x: 80 + gutterWidth,
      y: top,
    }))
  })
  return runFfmpeg({
    outputPath,
    filters,
    width,
    height,
    kind: 'code',
    fontResolver: options.fontResolver,
    ffmpegOptions: options.ffmpegOptions,
  })
}

/**
 * 把代码文本切成**终端打字机步骤**（`TerminalStep` 契约）。
 *
 * ⚠ 契约见 `packages/remotion-composer/src/components/TerminalScene.tsx:24`：
 *   `{kind: 'cmd'|'out', text, typeSpeed?, holdSeconds?}`
 *   - `cmd` ⇒ 逐字打字（`typeSpeed` 秒/字）
 *   - `out` ⇒ 整行瞬间显现
 *
 * ⚠ **步数上限**：合成器按 steps 累加帧数，步数太多会**溢出该镜的 durationInFrames**
 *   ⇒ 截断到 8 步（并把被截断的提示写进 `generation_summary` 之外的地方——本层不写产物）。
 *
 * @param {string} code 代码文本（可多行）
 * @returns {Array<{kind: string, text: string, typeSpeed?: number, holdSeconds?: number}>}
 */
function buildTerminalSteps (code) {
  const source = String(code || '').replace(/\r\n/g, '\n')
  const lines = source.split('\n')
    .map(line => line.replace(/\t/g, '  ').trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(0, 8)
  const steps = []
  for (const line of lines) {
    // ⚠ 以 `$` / `>` 开头的按**命令**处理（逐字打字），其余按**输出**处理（瞬间显现）
    const isCommand = /^\s*[$>]\s?/.test(line)
    const text = isCommand ? line.replace(/^\s*[$>]\s?/, '') : line
    if (!text) continue
    steps.push(isCommand
      ? { kind: 'cmd', text, typeSpeed: 0.035, holdSeconds: 0.3 }
      : { kind: 'out', text, holdSeconds: 0.15 })
  }
  return steps
}

/**
 * 真正调 ffmpeg 出图。
 *
 * ⚠ `-nostdin` 必给：不给它，ffmpeg 一旦去读 stdin 就会**永久等待**
 *   （父进程的 pipe 写端一直开着）⇒ 调用方只看到「超时」，看不到 ffmpeg 说了什么。
 * ⚠ 失败信息必须带 **argv + stderr 尾巴** ⇒ 否则 CI 上只能看到超时，拿不到现场。
 */
async function runFfmpeg (options) {
  const outputPath = options.outputPath
  const ffmpeg = resolveFfmpegBinary(options.ffmpegOptions || {})
  if (!ffmpeg) {
    return { ok: false, path: '', size: 0, reason: '找不到可执行的 ffmpeg（FFMPEG_PATH 可覆盖）' }
  }
  // ⚠ 字体解析不出来 ⇒ **判失败**，不产出豆腐块图（与 title-card-renderer 同一口径）
  //   ⚠ 解析器**可注入** ⇒ 单测能构造「字体缺失」这一格（否则测不到 ⇒ 假绿）
  const fontResolver = typeof options.fontResolver === 'function'
    ? options.fontResolver
    : resolveContentCjkFont
  const font = fontResolver()
  if (!font || !font.fontFile) {
    return { ok: false, path: '', size: 0, reason: '未解析到可用中文字体（不产出豆腐块图）' }
  }
  const source = 'color=c=' + THEME.background + ':s=' + options.width + 'x' + options.height + ':d=1'
  const argv = [
    '-nostdin',
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', source,
    '-vf', options.filters.join(','),
    '-frames:v', '1',
    '-f', 'image2', outputPath,
  ]
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    await execFileAsync(ffmpeg, argv, {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      // ⚠ 注入 fontconfig（与 title-card-renderer 同一份生成逻辑）：Windows runner 没有系统
      //   fontconfig 配置 ⇒ ffmpeg 的 drawtext 初始化会失败（`Cannot load default config file`）
      //   ⇒ 退出码非 0 ⇒ 渲染失败。给一份最小 fonts.conf 即可。
      env: { ...process.env, ...buildFontconfigEnv({ fontFile: font.fontFile }) },
    })
    if (!fs.existsSync(outputPath)) {
      return { ok: false, path: '', size: 0, reason: 'ffmpeg 未产出文件' }
    }
    const stat = fs.statSync(outputPath)
    if (stat.size <= 0) {
      return { ok: false, path: '', size: 0, reason: 'ffmpeg 产出空文件' }
    }
    return { ok: true, path: outputPath, size: stat.size, reason: '' }
  } catch (error) {
    const stderrText = String((error && error.stderr) || '').trim().slice(-400)
    return {
      ok: false,
      path: '',
      size: 0,
      reason: 'ffmpeg 渲染失败: ' + (error && error.message ? error.message : String(error)) +
        (stderrText ? ' | stderr: ' + stderrText : ''),
    }
  }
}

/**
 * 批量生产程序化素材。
 *
 * @param {Array<object>} scenes scene_plan.scenes[]
 * @param {object} options
 * @param {string} options.outputDir 产物目录
 * @returns {Promise<{assets: Array<object>, issues: Array<object>}>}
 *   `assets` 形态与 `asset_manifest.assets[]` 对齐（type 取上游枚举里的 diagram / code_snippet）。
 */
async function buildProgrammaticAssets (scenes, options = {}) {
  const assets = []
  const issues = []
  const outputDir = asText(options.outputDir)
  if (!outputDir) {
    issues.push(makeIssue('PROGRAMMATIC_OUTPUT_DIR_MISSING', '没有指定程序化素材的输出目录，已跳过', 'error'))
    return { assets, issues }
  }
  for (const scene of asArray(scenes)) {
    const obj = asObject(scene)
    const sceneId = asText(obj.id)
    const { requests, issues: requestIssues } = resolveProgrammaticRequests(obj)
    issues.push(...requestIssues)
    for (const request of requests) {
      const outputPath = path.join(outputDir, 'asset-' + (sceneId || 'scene') + '-' + request.assetType + '.png')
      // ⚠ 渲染器依赖（字体解析 / ffmpeg 路径）**可注入** ⇒ 单测能构造「不可用」那一格
      const renderDeps = {
        fontResolver: options.fontResolver,
        ffmpegOptions: options.ffmpegOptions,
      }
      const rendered = request.kind === 'code'
        ? await renderCodeSnippetAsset({ outputPath, description: request.description, ...renderDeps })
        : await renderDiagramAsset({ outputPath, description: request.description, ...renderDeps })
      if (!rendered.ok) {
        issues.push(makeIssue(
          'PROGRAMMATIC_ASSET_FAILED',
          '场景「' + (sceneId || '?') + '」的「' + request.type + '」素材生成失败：' + rendered.reason,
          'error'
        ))
        continue
      }
      assets.push({
        id: 'asset-' + (sceneId || 'scene') + '-' + request.assetType,
        type: request.assetType,
        path: rendered.path,
        source_tool: request.type,
        scene_id: sceneId,
        prompt: request.description,
        cost_usd: 0,
        resolution: CANVAS_WIDTH + 'x' + CANVAS_HEIGHT,
      })
    }
  }
  return { assets, issues }
}

module.exports = {
  SUPPORTED_PROGRAMMATIC_TYPES,
  KNOWN_UNSUPPORTED_TYPES,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  THEME,
  MAX_DIAGRAM_NODES,
  MAX_CODE_LINES,
  resolveProgrammaticRequests,
  parseDiagramNodes,
  parseCodeLines,
  renderDiagramAsset,
  renderCodeSnippetAsset,
  buildTerminalSteps,
  buildProgrammaticAssets,
}
