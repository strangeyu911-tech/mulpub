// @ts-check
/**
 * explainer-remotion-props — 把「叙事分镜 + 剪辑决策」合成 **Remotion 渲染指令**（composition_data）
 *
 * ## 为什么有这一层
 *
 * 上游 OpenMontage 的 `animated-explainer` 是**两段式**（`skills/pipelines/explainer/scene-director.md:71-74` 原文）：
 * > 「...and chart/card variants below are **downstream Remotion `cut.type` templates**, ... description;
 * > **the Edit stage converts that intent into `cut.type`**」
 *
 * ⇒ `scene_plan.scenes[].type` 是**叙事型**（9 种：`talking_head/broll/animation/character_scene/
 *   diagram/text_card/transition/generated/screen_recording`），
 *   而 Remotion 的 `cut.type` 是**渲染型**（12 种：`text_card/stat_card/hero_title/callout/comparison/
 *   bar_chart/line_chart/pie_chart/kpi_grid/progress_bar/anime_scene/terminal_scene/screenshot_scene`）
 *   ⇒ **两套词表不同，中间必有一层映射**（上游把它放在 Edit 阶段）。
 *
 * ## 为什么不改 schema
 *
 * ⚠ `edit_decisions.schema.json` / `scene_plan.schema.json` 是 P1 **1:1 落地**的上游 schema，
 * 且 `scripts/sync-openmontage-schemas.js` 按 sha256 锁 14/14 一致 ⇒ 改任一字段都会让那条门禁红。
 * ⚠ 而且上游**自己**的 schema 与运行路径就不一致（`cut` 是 `additionalProperties:false` 且无 `type`，
 *   但 `tools/video/video_compose.py:790` 真读 `cut.get("type")`）⇒ 照抄 schema 也会抄错。
 * ⇒ 而上游 `video_compose.py:1954` 有**两个入参**：
 *   `composition_data = inputs.get("edit_decisions") or inputs.get("composition_data")`
 *   ⇒ **上游原生支持「直接传一份 composition_data」**
 * ⇒ 所以本模块走**上游第二个通道**：不动任何 1:1 schema，在 compose 阶段合成渲染指令。
 *
 * ## 渲染意图从哪来（不扩 schema 的前提下）
 *
 * ① `scene.required_assets[].type`（schema 里是自由 string）—— 上游 assets 阶段的工具集里就有
 *    `diagram_gen` / `code_snippet` / `math_animate` ⇒ 场景要什么素材就写在这里 ⇒ 直接决定 cut.type；
 * ② `scene.type`（叙事型）—— 兜底映射；
 * ③ `scene.description` / `information_role` 的文本线索（数据/对比/引语/代码）—— 二次细化。
 *
 * ## 上游权威依据
 *
 * - `skills/core/remotion.md:47-63`（cut type → 必填 props 字段表）
 * - `remotion-composer/SCENE_TYPES.md`、`AGENT_GUIDE.md:419`（type 清单）
 * - `skills/pipelines/explainer/scene-director.md:71-74`（两段式设计）
 * - `tools/video/video_compose.py:790`（运行时真读 `cut.type`）
 */

'use strict'

const { asText, asArray, asObject, asNumber } = require('./explainer-artifacts')
const { applyProgrammaticAsset } = require('./explainer-programmatic-cut')
// ⚠ 字幕切分**复用仓内单源**（`story2video-segmentation` 的离线分句，规则读 subtitle-rules.json）
//   ⇒ 不在本片另造一套分句规则。
const { splitTextToSubtitles } = require('../story2video-segmentation')
// ⚠ 文本抽取（数字指标 / 对比两栏 / 图表数据点 / 画面文字）单独成模块
//   ⇒ 合成层文件不越 500 行上限（**抽模块，不抬基线**）。
const {
  extractStat,
  extractComparison,
  extractChartData,
  pickDisplayText,
} = require('./explainer-remotion-text')

/** Remotion 渲染型 cut type（上游 `skills/core/remotion.md` 的 12 种 + 2 个场景型） */
const REMOTION_CUT_TYPES = [
  'text_card', 'stat_card', 'hero_title', 'callout', 'comparison',
  'bar_chart', 'line_chart', 'pie_chart', 'kpi_grid', 'progress_bar',
  'anime_scene', 'terminal_scene', 'screenshot_scene',
]

/** overlay 类型（上游 `AGENT_GUIDE.md:419`） */
const REMOTION_OVERLAY_TYPES = ['section_title', 'stat_reveal', 'hero_title', 'provider_chip']

/**
 * 叙事型 scene.type → 渲染型 cut.type 的**兜底**映射。
 * 权威的判定顺序是「required_assets[].type」⇒ 这里只是没有素材声明时的回落。
 */
const NARRATIVE_TYPE_FALLBACK = {
  text_card: 'text_card',
  transition: 'text_card',
  diagram: 'text_card',
  animation: 'anime_scene',
  talking_head: 'anime_scene',
  character_scene: 'anime_scene',
  broll: 'anime_scene',
  generated: 'anime_scene',
  screen_recording: 'screenshot_scene',
}

/** 素材类型关键词 → 渲染型 cut.type（上游 assets 工具集：diagram_gen / code_snippet / math_animate） */
const ASSET_TYPE_TO_CUT = [
  // ⚠ **显式图表名必须排在泛化词之前**：说「柱状图」就该出 bar_chart，不能被「占比/分布」抢成 pie_chart
  { match: /bar[_-]?chart|柱状|条形|柱图/i, cut: 'bar_chart' },
  { match: /line[_-]?chart|折线|趋势图/i, cut: 'line_chart' },
  { match: /pie[_-]?chart|donut|饼图|环形/i, cut: 'pie_chart' },
  { match: /kpi[_-]?grid|kpi|metric|指标|看板|dashboard/i, cut: 'kpi_grid' },
  { match: /chart|graph|plot|图|图表|数据/i, cut: 'bar_chart' },
  { match: /progress|进度|完成度/i, cut: 'progress_bar' },
  { match: /code|snippet|代码|终端|terminal/i, cut: 'terminal_scene' },
  { match: /screenshot|截图/i, cut: 'screenshot_scene' },
  { match: /diagram|示意|流程/i, cut: 'text_card' },
  { match: /stat|number|数字|指标/i, cut: 'stat_card' },
  { match: /quote|引语|金句|tip|提示|对比|compare/i, cut: 'callout' },
]

/** 文本线索 → 渲染型 cut.type（没有素材声明时的二次细化） */
const TEXT_HINT_TO_CUT = [
  { match: /对比|相比|前后|A\s*\/?\s*B|versus|vs\b/i, cut: 'comparison' },
  // ⚠ 显式图表名优先（与素材规则同一条纪律）
  { match: /柱状图|条形图|柱图|bar\s*chart/i, cut: 'bar_chart' },
  { match: /折线图|趋势图|line\s*chart/i, cut: 'line_chart' },
  { match: /饼图|环形图|pie\s*chart/i, cut: 'pie_chart' },
  { match: /进度|完成度/i, cut: 'progress_bar' },
  { match: /引语|金句|名言|quote|注意|小心|警告|坑|提示|建议|技巧|tip/i, cut: 'callout' },
  { match: /占比|构成|比例|份额|分布/i, cut: 'pie_chart' },
  { match: /\d+\s*%|\d+\s*(万|亿|倍|人|天|年|月|个)/i, cut: 'stat_card' },
  { match: /图表|柱状|饼图|折线|趋势|占比|分布/i, cut: 'bar_chart' },
  { match: /引语|金句|名言|quote/i, cut: 'callout' },
  { match: /代码|报错|终端|shell|终端输出/i, cut: 'terminal_scene' },
  { match: /截图|界面|页面/i, cut: 'screenshot_scene' },
]

/**
 * 判定一个场景该渲染成哪种 Remotion cut。
 * @param {object} scene scene_plan.scenes[] 的一项
 * @returns {{ cutType: string, reason: string }}
 */
function resolveCutType (scene, narration) {
  const obj = asObject(scene)
  const assets = asArray(obj.required_assets)
  for (const asset of assets) {
    const type = asText(asObject(asset).type)
    if (!type) continue
    for (const rule of ASSET_TYPE_TO_CUT) {
      if (rule.match.test(type)) {
        return { cutType: rule.cut, reason: 'required_assets.type=' + type }
      }
    }
  }
  // ⚠ 判定输入必须包含**旁白**：讲稿里说「85%」「对比 A 和 B」才是渲染意图的第一手来源
  //   （scene.description 是**画面描述**，不是要显示在画面上的文字）。
  const text = [asText(narration), asText(obj.description), asText(obj.information_role), asText(obj.shot_intent)].join(' ')
  for (const rule of TEXT_HINT_TO_CUT) {
    if (rule.match.test(text)) {
      return { cutType: rule.cut, reason: '文本线索命中 ' + rule.cut }
    }
  }
  const narrative = asText(obj.type)
  const fallback = NARRATIVE_TYPE_FALLBACK[narrative] || 'text_card'
  return { cutType: fallback, reason: '叙事型兜底 ' + (narrative || '(空)') }
}

/**
 * 为一个场景构造 Remotion cut（含该 cut type 的专属字段）。
 *
 * @param {object} scene scene_plan.scenes[] 的一项
 * @param {object} options
 *   - narration: 该场景的旁白文本（来自 script.sections，经 script_section_id 关联）
 *   - imagePath: 该场景的图片资产路径（AI 生图 / 标题卡产物，可为空）
 * @returns {object} Remotion cut
 */
function buildCut (scene, options = {}) {
  const obj = asObject(scene)
  const narration = asText(options.narration)
  const { cutType, reason } = resolveCutType(obj, narration)
  // ⚠ `cut.text` 是**画面上要显示的文字**（上游 demo：`hero_title` 的 text 是标题本身），
  //   **不是** scene.description（那是给生图用的画面描述）。
  const text = pickDisplayText(narration, asText(obj.information_role), asText(obj.description))

  const cut = {
    id: asText(obj.id) || 'cut',
    source: asText(options.imagePath) || '',
    type: cutType,
    in_seconds: asNumber(obj.start_seconds, 0),
    out_seconds: asNumber(obj.end_seconds, asNumber(obj.start_seconds, 0)),
    reason,
  }
  if (text) cut.text = text

  switch (cutType) {
    case 'stat_card': {
      const stat = extractStat(narration) || extractStat(asText(obj.information_role))
      if (stat) {
        cut.stat = stat.value + (stat.unit || '')
        cut.subtitle = asText(obj.information_role) || stat.label
        cut.accentColor = asText(options.accentColor)
      } else {
        cut.text = text
      }
      break
    }
    case 'callout': {
      // ⚠ 判定用**原文**（旁白/描述），不是显示文字（显示文字可能已被截断）
      const raw = narration || asText(obj.description) || text
      cut.callout_type = 'info'
      if (/金句|引语|名言|quote/i.test(raw)) cut.callout_type = 'quote'
      else if (/注意|小心|警告|坑/i.test(raw)) cut.callout_type = 'warning'
      else if (/提示|建议|技巧|tip/i.test(raw)) cut.callout_type = 'tip'
      cut.title = asText(obj.shot_intent)
      break
    }
    case 'comparison': {
      const cmp = extractComparison(narration || asText(obj.description))
      if (cmp) {
        cut.leftLabel = cmp.leftLabel
        cut.rightLabel = cmp.rightLabel
        cut.leftValue = cmp.leftValue
        cut.rightValue = cmp.rightValue
        cut.title = asText(obj.shot_intent)
      } else {
        cut.text = text
        cut.callout_type = 'info'
      }
      break
    }
    case 'bar_chart':
    case 'pie_chart':
    case 'kpi_grid': {
      const data = extractChartData(narration || asText(obj.description))
      if (data.length >= 2) {
        cut.chartData = data
        cut.title = asText(obj.shot_intent) || asText(obj.information_role)
        if (cutType === 'pie_chart') {
          cut.donut = true
          cut.centerLabel = asText(obj.information_role)
        }
      } else {
        cut.text = text
        cut.callout_type = 'info'
      }
      break
    }
    case 'line_chart': {
      const data = extractChartData(narration || asText(obj.description))
      if (data.length >= 2) {
        cut.chartSeries = [{
          label: asText(obj.information_role) || 'series',
          data: data.map((p, i) => ({ x: i, y: p.value })),
        }]
        cut.title = asText(obj.shot_intent)
      } else {
        cut.text = text
        cut.callout_type = 'info'
      }
      break
    }
    case 'progress_bar': {
      const stat = extractStat(narration)
      cut.progress = stat ? Math.min(100, Math.max(0, Number(String(stat.value).replace(/,/g, '')) || 0)) : 50
      break
    }
    case 'hero_title': {
      cut.text = text
      cut.heroSubtitle = asText(obj.information_role)
      break
    }
    case 'anime_scene': {
      const images = asArray(options.imagePaths).map(p => asText(p)).filter(Boolean)
      cut.images = images.length ? images : (asText(options.imagePath) ? [asText(options.imagePath)] : [])
      cut.animation = asText(options.animation) || 'zoom-in'
      cut.particles = 'fireflies'
      cut.particleColor = asText(options.particleColor) || '#FFD98A'
      cut.particleCount = 24
      cut.particleIntensity = 0.5
      cut.vignette = true
      break
    }
    case 'terminal_scene': {
      cut.text = text
      cut.command = asText(options.command) || text.slice(0, 80)
      break
    }
    case 'screenshot_scene': {
      cut.text = text
      cut.image = asText(options.imagePath)
      break
    }
    default:
      break
  }

  // ⚠ **程序化素材的消费**（PRD §19.4.6）
  //   ⚠ **必须放在 switch 之后**：`anime_scene` 分支会**覆写** `cut.images`/`cut.particles`
  //   ⚠ **另一个必须放后面的原因**：`cut.source` 在合成器里只是**媒体兜底分支**
  //   ⇒ **卡片类组件会抢先匹配** ⇒ 素材在盘上却**全程不上屏**（E2E 实测踩到）
  //   ⇒ 详见 explainer-programmatic-cut.js。
  applyProgrammaticAsset(cut, obj, options)

  return cut
}

/**
 * 合成完整的 Remotion composition_data。
 *
 * @param {object} input
 *   - scenePlan: scene_plan artifact
 *   - editDecisions: edit_decisions artifact（提供权威时间轴）
 *   - script: script artifact（提供旁白文本）
 *   - assetsByScene: { [scene_id]: { imagePath, images[] } } 资产索引（可为空）
 * @returns {{ ok: boolean, props: object|null, issues: Array }}
 */
/**
 * 把每个 cut 的画面文字切成**词级字幕条目**（合成器契约：`{word, startMs, endMs}`）。
 *
 * ⚠⚠ **形状必须与合成器一致**：Remotion 的 `CaptionOverlay` 吃的是 `{word, startMs, endMs}`
 *   （`packages/remotion-composer/src/components/CaptionOverlay.tsx:11`），
 *   **不是** `{text, start_seconds, end_seconds}`。
 *   ⇒ 形状错了 ⇒ `fromFrame = Math.round(undefined/1000*fps)` = NaN ⇒ `<Sequence from={NaN}>`
 *   ⇒ **渲染期崩在 bundle 里**（exitCode=1 + React 栈，极难定位）⇒ 必须在本层拦住。
 *
 * ⚠ 字幕块切分**复用仓内单源**（`story2video-segmentation` 离线分句，规则读 subtitle-rules.json）
 *   ⇒ 不另造分句规则；上游 edit-director 允许「phrase style」（整句一块）。
 *
 * @param {Array<object>} cuts 已合成的 cut 列表
 * @returns {Array<{word: string, startMs: number, endMs: number}>}
 */
function buildCaptionWords (cuts) {
  const captions = []
  for (const cut of Array.isArray(cuts) ? cuts : []) {
    const obj = asObject(cut)
    const text = asText(obj.text)
    if (!text) continue
    const blocks = splitTextToSubtitles(text)
    const words = blocks.length ? blocks : [text]
    const startMs = Math.round(Number(obj.in_seconds) * 1000)
    const endMs = Math.round(Number(obj.out_seconds) * 1000)
    const span = Math.max(1, endMs - startMs)
    words.forEach((word, index) => {
      captions.push({
        word: String(word),
        startMs: startMs + Math.round((span * index) / words.length),
        endMs: startMs + Math.round((span * (index + 1)) / words.length),
      })
    })
  }
  return captions
}

function buildRemotionProps (input = {}) {
  const issues = []
  const scenePlan = asObject(input.scenePlan)
  const editDecisions = asObject(input.editDecisions)
  const script = asObject(input.script)
  const assetsByScene = asObject(input.assetsByScene)

  const scenes = asArray(scenePlan.scenes)
  if (!scenes.length) {
    issues.push({ code: 'NO_SCENES', message: 'scene_plan 没有场景，无法合成 Remotion props' })
    return { ok: false, props: null, issues }
  }

  // 旁白文本按 script_section_id 关联（一个 section 可对应多镜）
  const narrationBySection = new Map()
  for (const section of asArray(script.sections)) {
    const o = asObject(section)
    const id = asText(o.id)
    if (id) narrationBySection.set(id, asText(o.text))
  }

  // edit_decisions 的 cut 时间轴是**权威**（按顺序与 scene 对齐）
  const decisions = asArray(editDecisions.cuts)

  const cuts = []
  scenes.forEach((scene, index) => {
    const obj = asObject(scene)
    const sceneId = asText(obj.id)
    const decision = asObject(decisions[index])
    const assets = asObject(assetsByScene[sceneId])
    const narration = narrationBySection.get(asText(obj.script_section_id)) || ''

    const cut = buildCut(obj, {
      narration,
      imagePath: asText(assets.imagePath),
      imagePaths: asArray(assets.images),
      programmaticPath: asText(assets.programmaticPath),
      programmaticType: asText(assets.programmaticType),
      codeSnippetText: asText(assets.codeSnippetText),
    })

    // 开场第一镜若是纯文字卡 ⇒ 当作**开场大标题**（对齐上游 demo：第 0 镜是 hero_title）
    if (index === 0 && cut.type === 'text_card' && !asText(assets.imagePath)) {
      cut.type = 'hero_title'
      cut.heroSubtitle = asText(obj.information_role)
    }

    // 时间轴：优先用 edit_decisions（权威），缺失才用 scene_plan
    if (Number.isFinite(Number(decision.in_seconds))) cut.in_seconds = Number(decision.in_seconds)
    if (Number.isFinite(Number(decision.out_seconds))) cut.out_seconds = Number(decision.out_seconds)
    // 转场：edit_decisions 里已定（上游 edit-director 负责转场多样性）
    if (asText(decision.transition_in)) cut.transitionIn = asText(decision.transition_in)
    if (asText(decision.transition_out)) cut.transitionOut = asText(decision.transition_out)
    if (Number.isFinite(Number(decision.transition_duration))) {
      cut.transitionDuration = Number(decision.transition_duration)
    }
    if (asText(decision.backgroundColor)) cut.backgroundColor = asText(decision.backgroundColor)
    if (asText(decision.accentColor)) cut.accentColor = asText(decision.accentColor)

    cuts.push(cut)
  })

  // overlays（上游：section_title / stat_reveal / hero_title / provider_chip）
  const overlays = []
  const first = cuts[0]
  if (first && first.type !== 'hero_title') {
    overlays.push({ type: 'hero_title', text: asText(script.title) || '讲解', in_seconds: first.in_seconds, out_seconds: first.in_seconds + 2 })
  }

  // captions（上游：字幕从 narration 音频时间戳推导）
  // ⚠ 形状必须是**词级** `{word, startMs, endMs}` ⇒ 见 buildCaptionWords 的注释
  const captions = buildCaptionWords(cuts)

  // audio（上游：narration segments + music + ducking）
  const audio = { narration: { segments: asArray(asObject(editDecisions.audio).narration).length
    ? asArray(asObject(editDecisions.audio).narration)
    : [] } }
  const music = asObject(asObject(editDecisions.audio).music)
  if (asText(music.asset_id)) {
    audio.music = {
      asset_id: asText(music.asset_id),
      volume: asNumber(music.volume, 0.08),
      fade_in_seconds: asNumber(music.fade_in_seconds, 2),
      fade_out_seconds: asNumber(music.fade_out_seconds, 3),
      ducking: asObject(music.ducking),
    }
  }

  const props = {
    version: '1.0',
    theme: {
      backgroundColor: '#0F172A',
      surfaceColor: '#111C33',
      textColor: '#F8FAFC',
      accentColor: '#4FC3F7',
    },
    cuts,
    overlays,
    captions,
    audio,
  }

  // 数据校验：cut 必须有可渲染的 type 与时间轴
  for (const cut of cuts) {
    if (!REMOTION_CUT_TYPES.includes(asText(cut.type))) {
      issues.push({ code: 'UNKNOWN_CUT_TYPE', message: 'cut ' + cut.id + ' 的 type「' + cut.type + '」不在 Remotion 支持清单内' })
    }
    if (!Number.isFinite(Number(cut.in_seconds)) || !Number.isFinite(Number(cut.out_seconds))) {
      issues.push({ code: 'CUT_TIME_INVALID', message: 'cut ' + cut.id + ' 的时间轴不合法' })
    } else if (Number(cut.out_seconds) <= Number(cut.in_seconds)) {
      issues.push({ code: 'CUT_TIME_NON_POSITIVE', message: 'cut ' + cut.id + ' 的时长非正' })
    }
  }
  if (!cuts.length) {
    issues.push({ code: 'NO_CUTS', message: '合成结果没有 cut' })
  }
  // ⚠ **字幕形状必须与合成器一致**（`{word, startMs, endMs}`）⇒ 在本层拦住，
  //   而不是让它一路走到渲染期崩在 bundle 里（那时的错误信息是 React 栈，极难定位）。
  for (const caption of captions) {
    const obj = asObject(caption)
    const hasWord = typeof obj.word === 'string' && obj.word.length > 0
    const hasStart = Number.isFinite(Number(obj.startMs))
    const hasEnd = Number.isFinite(Number(obj.endMs))
    if (!hasWord || !hasStart || !hasEnd || Number(obj.endMs) <= Number(obj.startMs)) {
      issues.push({
        code: 'CAPTION_SHAPE_INVALID',
        message: '字幕条目不符合合成器契约（需要 word/startMs/endMs）：' + JSON.stringify(obj).slice(0, 160),
      })
      break
    }
  }

  return { ok: issues.length === 0, props: issues.length ? null : props, issues, diagnostics: { cutCount: cuts.length } }
}

module.exports = {
  REMOTION_CUT_TYPES,
  REMOTION_OVERLAY_TYPES,
  NARRATIVE_TYPE_FALLBACK,
  ASSET_TYPE_TO_CUT,
  resolveCutType,
  buildCut,
  buildRemotionProps,
  buildCaptionWords,
  extractStat,
  extractComparison,
  extractChartData,
  pickDisplayText,
}
