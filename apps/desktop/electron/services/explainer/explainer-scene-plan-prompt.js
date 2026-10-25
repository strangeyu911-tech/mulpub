// @ts-check
/**
 * explainer-scene-plan-prompt — scenes 阶段的**提示词**与**输出解析**（分镜规划）
 *
 * ## 为什么单独一个模块
 *
 * ⚠ `explainer-prod-stages.js` 是「场景/素材/剪辑」三个阶段的执行器，**已贴 500 行硬上限**
 *   （`check-max-lines.js` 的 `NEW_OVER_LIMIT` 对新代码是硬拦）
 *   ⇒ 「提示词 + 解析」这一簇与「阶段编排」是**两件事** ⇒ 抽出来，而不是把上限抬上去。
 *
 * ## 提示词里为什么要问「素材需求」
 *
 * P5a 的 cut type 判定把「**素材声明**」放在第一优先级
 * （`scene.required_assets[].type` ⇒ 权威），
 * 但**场景从来不带素材声明** ⇒ 那条判据从来没生效过。
 * ⇒ 本模块的提示词要求 LLM 显式声明 `required_assets`
 *   （`type` 取上游 assets 工具集：`image_selector`/`diagram_gen`/`code_snippet`/`math_animate`/`music_gen`/`video_selector`），
 *   **默认 `image_selector`** ⇒ 不声明时行为与之前**完全一致**。
 *
 * ⚠ `type` 仍是**自由 string**（上游 schema 允许未来扩展）⇒ 未知 type 不判死，
 *   由下游登记「本版未实现」⇒ 降级可见。
 */

'use strict'

const { parseJsonArtifact } = require('./explainer-artifacts')

const MAX_SCENES = 30
const DEFAULT_SCENE_DURATION = 6
const MIN_SCENE_TEXT_LENGTH = 4

function buildScenePlanPrompt (script, options = {}) {
  return {
    system: [
      '你是视频分镜师。把旁白文案拆分为若干视频场景，输出严格的 JSON。',
      '输出格式：{"scenes": [{"id": "scene-1", "type": "broll", "description": "画面主体与动作的一句话描述",',
      '"duration": 6, "script_section_id": "对应旁白章节 id", "shot_intent": "这一镜为什么存在",',
      '"shot_language": {"shot_size": "medium", "camera_movement": "static", "lens_mm": 50,',
      '"lighting_key": "natural", "depth_of_field": "medium", "color_temperature": "neutral"},',
      '"texture_keywords": ["clean"]}],',
      '"required_assets": [{"type": "image_selector", "description": "这一镜需要什么素材", "source": "generate"}]}',
      '字段说明：type 只能是 ' + [
        'talking_head', 'broll', 'animation', 'character_scene', 'diagram',
        'text_card', 'transition', 'generated', 'screen_recording',
      ].join(' | ') + ' 之一；',      'shot_size ∈ extreme_wide|wide|medium_wide|medium|medium_close|close_up|extreme_close_up|over_shoulder|insert|establishing；',
      'camera_movement ∈ static|pan_left|pan_right|tilt_up|tilt_down|dolly_in|dolly_out|tracking_left|tracking_right|crane_up|crane_down|handheld|steadicam|whip_pan|orbital|zoom_in|zoom_out|rack_focus；',
      'lens_mm ∈ 14|24|35|50|85|135|200；',
      'lighting_key ∈ high_key|low_key|natural|golden_hour|blue_hour|tungsten_warm|neon|silhouette|rim_lit|volumetric|overcast_soft；',
      'depth_of_field ∈ shallow|medium|deep；color_temperature ∈ cool|neutral|warm|mixed。',
      'required_assets 说明（**素材需求声明**）：每个场景都要给出它需要的素材，type 取 ' + [
        'image_selector', 'diagram_gen', 'code_snippet', 'math_animate', 'music_gen', 'video_selector',
      ].join(' | ') + ' 之一，source 取 generate|source|provided 之一；',
      '选型规则：讲流程/结构/关系 ⇒ diagram_gen；讲代码/命令/API ⇒ code_snippet（description 里写上代码正文，多行）；',
      '讲公式/定理/数学推导 ⇒ math_animate；需要背景音乐 ⇒ music_gen；需要视频素材 ⇒ video_selector；',
      '其余一律 image_selector（description 写画面主体，不要写文字）。',
      '不要输出 markdown 代码块标记，不要任何解释文字。场景数量不超过 ' + MAX_SCENES + ' 个。',
    ].join('\n'),
    user: '旁白文案（每段前标注章节 id）：\n' + String(script || '').trim(),
  }
}

/** 行级兜底：把旁白文案按段落拆成场景（LLM 解析失败时保证流水线可继续） */
function fallbackScenes (script, options = {}) {
  const duration = Number(options.duration)
  const sceneDuration = Number.isFinite(duration) && duration >= 1 ? duration : DEFAULT_SCENE_DURATION
  const blocks = String(script || '')
    .split(/\n\s*\n|\r?\n/)
    .map(block => block.trim())
    .filter(block => block.length >= MIN_SCENE_TEXT_LENGTH)
  if (blocks.length === 0) return null
  return blocks.slice(0, MAX_SCENES).map((text, index) => ({
    id: 'scene-' + (index + 1),
    type: 'broll',
    description: '以纪实风格呈现「' + text.slice(0, 40) + '」的解说画面，构图清晰，光线自然。',
    duration: sceneDuration,
  }))
}

/** 从 LLM 输出里抽出场景数组（容忍围栏 / 说明文字） */
function parseScenesArray (text) {
  const parsed = parseJsonArtifact(text)
  if (Array.isArray(parsed)) return parsed
  if (parsed && Array.isArray(parsed.scenes)) return parsed.scenes
  const source = String(text || '')
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const candidate = JSON.parse(source.slice(start, end + 1))
      if (Array.isArray(candidate)) return candidate
    } catch (error) { /* fallthrough */ }
  }
  return null
}

module.exports = {
  MAX_SCENES,
  DEFAULT_SCENE_DURATION,
  MIN_SCENE_TEXT_LENGTH,
  buildScenePlanPrompt,
  fallbackScenes,
  parseScenesArray,
}
