// @ts-check
/**
 * explainer-programmatic-cut — 把**程序化素材**接进 Remotion 的 cut 字段
 *
 * ## 这一层解决什么
 *
 * 程序化素材（PRD §19.4.6）产出了一张图（示意图 / 代码片段图），
 * 但「素材在盘上」**不等于**「画面上看得到」——
 * 合成器的 `SceneRenderer` 是一串 `if (cut.type === 'xxx' && cut.<某字段>)`
 * （`packages/remotion-composer/src/Explainer.tsx:563` 起），
 * ⇒ **卡片类组件会抢先匹配** ⇒ `cut.source` 压根不被读 ⇒ **素材全程不上屏**
 * （本轮 E2E 实测踩到：那一镜是文字卡，示意图在盘上但没人看见）。
 *
 * ⇒ 本模块负责把「素材类型」映射成「合成器真的会把它画出来」的 cut 字段：
 * - `diagram` ⇒ **媒体型 cut**（`anime_scene` + `cut.images`）⇒ 该图**整屏**成为这一镜的视觉主体；
 * - `code_snippet` ⇒ `terminal_scene` 的**打字机**步骤（上游原生渲染型）
 *   ⇒ 代码正文由组件逐字打出；`steps` 为空时回落**媒体兜底**（`cut.source`）。
 *
 * ## 两条踩坑写在这里，防止后来人重犯
 *
 * 1. ⚠ **必须放在 `buildCut` 的 `switch` 之后**：`anime_scene` 分支会**覆写**
 *    `cut.images` / `cut.particles` ⇒ 放前面会被冲掉。
 * 2. ⚠ **示意图不做 ken-burns、不加粒子、不压暗角**（`animation='static'` / `particles=''` /
 *    `vignette=false`）⇒ 否则图上的字会被推拉/光斑/暗角弄花，**看不清**。
 */

'use strict'

const { asText } = require('./explainer-artifacts')
const { buildTerminalSteps } = require('./explainer-programmatic-assets')

/** 合成器里「会抢先匹配、从而吃掉 `cut.source`」的卡片类渲染型 */
const CARD_CUT_TYPES = new Set([
  'text_card', 'stat_card', 'callout', 'comparison', 'hero_title',
  'terminal_scene', 'screenshot_scene', 'bar_chart', 'line_chart', 'pie_chart',
  'kpi_grid', 'progress_bar',
])

/**
 * 把程序化素材接进 cut（**就地修改** cut）。
 *
 * @param {object} cut buildCut 产出的 cut
 * @param {object} scene 对应的 scene（取 `shot_intent` 等）
 * @param {object} options
 * @param {string} [options.programmaticPath] 程序化素材路径
 * @param {string} [options.programmaticType] 素材类型（`diagram` / `code_snippet`）
 * @param {string} [options.codeSnippetText] 代码正文（打字机步骤的来源）
 * @returns {object} 同一个 cut
 */
function applyProgrammaticAsset (cut, scene, options = {}) {
  const programmaticPath = asText(options.programmaticPath)
  if (!programmaticPath) return cut
  const obj = scene && typeof scene === 'object' ? scene : {}

  // ⚠ 兜底：媒体分支读的是 `cut.source` ⇒ 无论如何都填上
  cut.source = programmaticPath

  if (asText(options.programmaticType) === 'code_snippet') {
    // ⚠ **代码片段 ⇒ 终端打字机**（上游原生 `terminal_scene` 渲染型）
    //   合成器的守卫是 `cut.type === 'terminal_scene' && cut.steps`
    //   ⇒ 缺 steps 会**静默**走兜底分支 ⇒ 必须给出 steps。
    const steps = buildTerminalSteps(asText(options.codeSnippetText))
    if (steps.length) {
      cut.steps = steps
      cut.terminalTitle = asText(obj.shot_intent) || 'Terminal'
    }
    // ⚠ steps 为空 ⇒ `cut.source`（代码片段图）作为媒体兜底 ⇒ 仍可见
    return cut
  }

  // ⚠ **示意图 ⇒ 整屏显示该图**：卡片类组件会盖住 `cut.source`
  //   ⇒ 改用**媒体型** cut（`anime_scene` + `cut.images`）
  cut.type = 'anime_scene'
  cut.images = [programmaticPath]
  // ⚠ 图上的字要看得清 ⇒ 不推拉、不加粒子、不压暗角
  cut.animation = 'static'
  cut.particles = ''
  cut.particleIntensity = 0
  cut.vignette = false
  return cut
}

module.exports = {
  CARD_CUT_TYPES,
  applyProgrammaticAsset,
}
