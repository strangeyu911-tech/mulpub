// @ts-check
/**
 * explainer-review-stages — compose / publish 两个阶段的执行器（产出上游 review 类 artifact）
 *
 * ## 为什么单独一个模块
 *
 * `explainer-prod-stages.js` 已承载 scenes / assets / editing（贴 limit 500），
 * compose / publish 含 IO 探测（ffprobe / 抽帧 / 响度）⇒ 拆开（**抽模块，不抬基线**）。
 *
 * ## 为什么 compose / publish 用专属 type
 *
 * 内置 `compose` / `publish`（`stage-executor.js` 的 `STAGE_TYPES.COMPOSE` / `PUBLISH`）
 * 是 story2video 等 5 条流水线共用的 ⇒ 改它们的输出形态会破坏那 5 条线。
 * ⇒ explainer 用 `explainer_compose` / `explainer_publish` 两个独立 key
 *   （`execute` 是「自定义 executor 优先」，key 不重叠 ⇒ 零侵入）。
 *
 * ## 内层调用必须把 stage.options 原样带过去
 *
 * 内置 compose 读 `stage.options` 的 18 个白名单 key（transition / imageEffect / resolution /
 * fps / format / bgmPath / voiceVolume / defaultSceneDuration …）⇒ 丢了就静默用默认值。
 * ⚠ 且**行数不变**的改法（`pipeline-engine.js` 里只换 type 字符串）才不会撞点名还账的零容差天花板。
 *
 * ## 成败判据是**产物有效性**，不是进程退出码
 *
 * 仓内既有事实：Remotion 渲染实测「CLI 抛 TimeoutError 但 mp4 完全有效」。
 * ⇒ 这里以 ffprobe 可读 + 抽帧有效 + 音轨非静音为准。
 */

'use strict'

const path = require('path')
const {
  validateArtifact,
  asText,
  asArray,
  asObject,
  asNumber,
} = require('./explainer-artifacts')
const { resolveSceneSource } = require('./explainer-prod-stages')
const { getComposerDir } = require('../path-utils')
const {
  buildRenderReport,
  buildFinalReview,
  buildPublishLog,
  checkPublishLogCriteria,
} = require('./explainer-prod-review')
const {
  probeContainer,
  sampleFrames,
  measureLoudness,
} = require('./explainer-media-probe')
const { buildRemotionProps } = require('./explainer-remotion-props')
const {
  resolveRemotionOutputPath,
  resolveRenderedArtifact,
} = require('./explainer-remotion-render')
const {
  buildNarrationTrack,
  muxNarration,
} = require('./explainer-narration-track')
const { stageRemotionMedia, mirrorPublicDir } = require('./explainer-remotion-media')

/**
 * asset_manifest → 内置 compose 消费的**旧形态** `{scenes:[...]}`（消费点适配）。
 *
 * ⚠ **为什么必须适配**：内置 compose（`story2video-compose-engine.js`）读的是
 *   `scene.imagePath` / `scene.audioPath` / `scene.duration`（:979/:984/:1104），
 *   而本片把 assets 阶段的产物换成了上游 `asset_manifest`（`{version, assets:[...]}`）
 *   ⇒ 直接喂过去 ⇒ 内置 compose 报「Invalid assetManifest: missing scenes or image/audio pairs」。
 *
 * ⚠ **适配放在消费点，不改产物**：`context.assets` 仍是**纯 artifact**（不含 `scenes` 字段
 *   —— asset_manifest 的 schema 是 `additionalProperties:false`，多一个字段就 schema 判红）。
 *
 * ⚠ `duration` 取**旁白资产的真实时长**（duration_seconds）⇒ 内置 compose 因此按
 *   **实际 narration 时长**对齐画面（上游 Audio drift 要求），而不是按计划时长。
 *
 * @param {object} manifest asset_manifest artifact
 * @param {object} scenePlan scene_plan artifact
 * @param {object} script script artifact（取旁白文本）
 * @returns {Array<object>} 旧形态场景数组
 */
function assetManifestToLegacyScenes (manifest, scenePlan, script) {
  const assets = asArray(asObject(manifest).assets)
  const scenes = asArray(asObject(scenePlan).scenes)
  const sections = asArray(asObject(script).sections)

  const byScene = new Map()
  for (const asset of assets) {
    const obj = asObject(asset)
    const sceneId = asText(obj.scene_id)
    if (!sceneId) continue
    if (!byScene.has(sceneId)) byScene.set(sceneId, {})
    const bucket = byScene.get(sceneId)
    const type = asText(obj.type)
    if (type === 'image') bucket.imagePath = asText(obj.path)
    else if (type === 'narration' || type === 'audio') {
      bucket.audioPath = asText(obj.path)
      bucket.duration = asNumber(obj.duration_seconds, 0)
    }
  }

  return scenes.map((scene) => {
    const obj = asObject(scene)
    const sceneId = asText(obj.id)
    const bucket = byScene.get(sceneId) || {}
    const sectionId = asText(obj.script_section_id)
    const section = sections.find(s => asText(asObject(s).id) === sectionId)
    return {
      scene_id: sceneId,
      text: section ? asText(asObject(section).text) : '',
      imagePath: bucket.imagePath || null,
      audioPath: bucket.audioPath || null,
      duration: bucket.duration || 0,
    }
  })
}

/**
 * 合成产物 + 两个 artifact 的合并（抽成纯函数以便单测）。
 *
 * ⚠ **必须保留 compose 原始输出**（videoPath / fileSize / segmentCount / duration）：
 *   下一个阶段是内置 publish 阶段，它从 `context.compose` 读 videoPath 去找成片
 *   ⇒ 只输出两个 artifact 会让 publish 拿不到片（**静默失败**：不发布也不报错）。
 */
function composeOutputWithArtifacts (rawOutput, renderReport, finalReview) {
  return { ...asObject(rawOutput), render_report: renderReport, final_review: finalReview }
}

/** asset_manifest → 「按 scene_id 的图片索引」（anime_scene 要多条图，manifest 每条只有一个 path） */
function buildAssetsIndex (manifest) {
  const index = {}
  for (const asset of asArray(asObject(manifest).assets)) {
    const obj = asObject(asset)
    const sceneId = asText(obj.scene_id)
    const assetPath = asText(obj.path)
    if (!sceneId || !assetPath) continue
    if (!index[sceneId]) index[sceneId] = { imagePath: '', images: [] }
    if (asText(obj.type) === 'image') {
      index[sceneId].images.push(assetPath)
      if (!index[sceneId].imagePath) index[sceneId].imagePath = assetPath
    }
  }
  return index
}

/**
 * 把阶段上下文合成 Remotion 渲染指令（上游 `composition_data`）。
 *
 * ⚠ **场景来源必须走 `resolveSceneSource`**（与下面 legacy 适配同一个真源）：
 *   本仓 scenes 阶段的产物落在 `context[stage.name]` = **`context.scenes`**，
 *   而上游的名字是 `context.scene_plan` ⇒ 直接读 `context.scene_plan` 恒为 undefined
 *   ⇒ 分镜拿不到 ⇒ props 合成必然 NO_SCENES ⇒ **Remotion 路径永远走不通**
 *   （P2b 已经在 legacy 适配那条路上踩过同一个坑，这里必须复用它的解法）。
 *
 * @param {object} context 阶段上下文
 * @returns {{ok: boolean, props: object|null, issues: Array}}
 */
function buildExplainerRemotionProps (context) {
  return buildRemotionProps({
    scenePlan: resolveSceneSource(context).plan,
    editDecisions: asObject(context.editing),
    script: asObject(context.script),
    assetsByScene: buildAssetsIndex(context.assets),
  })
}

/**
 * 用 Remotion 渲染（上游 animated-explainer 的表现层）。
 *
 * ⚠ **走上游的第二个入参**：`tools/video/video_compose.py:1954`
 *   `composition_data = inputs.get("edit_decisions") or inputs.get("composition_data")`
 *   ⇒ 上游原生支持「直接传一份 composition_data」⇒ 本片**不动任何 1:1 schema**，
 *   而是在 compose 阶段合成渲染指令（叙事分镜 + 剪辑决策 → Remotion props）。
 * ⚠ **成败判据是产物有效性，不是退出码**（上游实测：CLI 抛 TimeoutError 但 mp4 有效）。
 * ⚠ **失败回落 ffmpeg 轮播**（Remotion 未装 / Chrome Headless Shell 缺失时仍要能出片），且**如实记录**。
 */
async function tryRenderWithRemotion (options = {}) {
  const issues = []
  const { context, stage, onProgress, runId } = options
  const built = buildExplainerRemotionProps(context)
  issues.push(...asArray(built.issues))
  if (!built.ok || !built.props) {
    return { ok: false, reason: 'props 合成未通过校验', issues }
  }
  // ⚠ **渲染前再用仓内合成器校验器过一遍**（`composition-manager.validateProps`）
  //   ⇒ 形状与合成器契约不符时**在渲染前**失败，而不是起一个进程崩在 bundle 里
  //   （那时的错误信息是 React 栈，定位成本高一个量级）。
  try {
    const { CompositionManager } = require('../composition-manager')
    const verdict = new CompositionManager().validateProps('Explainer', built.props)
    if (!verdict || verdict.valid !== true) {
      const detail = asArray(verdict && verdict.errors).slice(0, 3).join('; ')
      issues.push('props 不符合合成器契约：' + (detail || '（校验器未给出原因）'))
      return { ok: false, reason: 'props 不符合合成器契约：' + detail, issues }
    }
  } catch (error) {
    // ⚠ 校验器读不出来**不阻断**（它只是加一层防御，不是唯一判据）
    issues.push('合成器契约校验未能执行（不阻断）：' + String((error && error.message) || error))
  }
  let RenderEngine
  try {
    RenderEngine = require('../render-engine')
  } catch (error) {
    return { ok: false, reason: 'Remotion 渲染器不可用：' + (error && error.message), issues }
  }
  const engine = new RenderEngine()
  const profile = asText(stage.options && stage.options.remotionProfile) || undefined
  // ⚠ **必须显式指定产物路径**：`render()` 不传时会自己生成 `remotion_<timestamp>.mp4`
  //   （时间戳在调用瞬间产生）⇒ 事后无从得知路径 ⇒ 「CLI 报失败但 mp4 有效」这条恢复路径不可能实现。
  const outputPath = resolveRemotionOutputPath(runId)
  // ⚠ **本地媒体必须先 staging 进 Remotion 的 public 目录**：
  //   合成器的图片/视频组件只认 public 目录里的**相对文件名**（绝对路径 / file:// 会被 staticFile 拒绝
  //   ⇒ 渲染期抛 TypeError ⇒ 主进程只看到「退出码 1 + React 栈」）。
  //   这正是上游 `_stage_remotion_media` 做的事（见 explainer-remotion-media.js）。
  const publicDir = path.join(path.dirname(outputPath), 'remotion-public')
  const staged = stageRemotionMedia(built.props, { publicDir })
  // ⚠ `--public-dir` 会**替换** Remotion 默认的 public 目录 ⇒ 合成器自带的 public 内容要镜像进来
  //   （上游 `_mirror_public_dir` 的同款做法）
  try {
    mirrorPublicDir(path.join(getComposerDir(), 'public'), staged.publicDir)
  } catch (_) { /* 镜像失败不影响本次渲染 */ }
  if (staged.missing.length) {
    issues.push('有 ' + staged.missing.length + ' 个媒体文件不存在，已原样传入（渲染期可能报错）：' +
      staged.missing.slice(0, 2).join(', '))
  }
  let renderResult = null
  let renderError = ''
  try {
    renderResult = await engine.render(staged.props, {
      onProgress: typeof onProgress === 'function' ? onProgress : undefined,
      profile,
      outputPath,
      publicDir: staged.publicDir,
    })
  } catch (error) {
    renderError = (error && error.message) || String(error)
  }
  if (!renderError) renderError = asText(renderResult && renderResult.error)
  // ⚠ **成败判据是产物有效性，不是退出码**（上游实测：CLI 抛 TimeoutError 但 mp4 完全有效）
  const verdict = await resolveRenderedArtifact({
    outputPath,
    renderReportedSuccess: Boolean(renderResult && renderResult.success),
    renderError,
    waitMs: asNumber(stage.options && stage.options.remotionArtifactWaitMs, 0) || undefined,
  })
  if (!verdict.usable) {
    return { ok: false, reason: verdict.reason || ('Remotion 渲染失败：' + renderError), issues }
  }
  if (verdict.recovered) {
    // ⚠ 如实留痕：CLI 报失败但产物有效（上游实测形态）⇒ 记一条，别让排查时误判成「没渲染」
    issues.push('Remotion CLI 报告失败，但产物有效，已按产物判定为成功：' + verdict.reason)
  }
  return { ok: true, videoPath: outputPath, props: built.props, issues }
}

/**
 * 给 Remotion 出的**画面**补上旁白（上游架构：视觉渲染 + 混轨 + mux）。
 *
 * ⚠ **为什么必须有这一步**：上游 `edit_decisions.audio.narration` 只有 `segments`
 *   （`{asset_id, start_seconds}`），而 Remotion 合成器只认 `audio.narration.src`
 *   ⇒ 只把 props 交给合成器 ⇒ **成片没有旁白**（一条静音片）。
 * ⚠ 本函数照上游做：① 按 segments 的 `start_seconds` 合成一条旁白轨（间隙补静音）
 *   ② mux 到画面上（`-map 0:v:0` ⇒ 丢掉 Remotion 自带的静音轨）。
 *
 * @param {object} options
 * @param {object} options.context 阶段上下文
 * @param {string} options.videoPath Remotion 画面产物
 * @returns {Promise<{ok: boolean, videoPath: string, reason: string, issues: Array<object>}>}
 */
async function attachNarrationToVideo (options = {}) {
  const issues = []
  const context = asObject(options.context)
  const videoPath = asText(options.videoPath)
  const editDecisions = asObject(context.editing)
  const segments = asArray(asObject(asObject(editDecisions.audio).narration).segments)
  if (!segments.length) {
    return { ok: false, videoPath, reason: 'edit_decisions 里没有旁白分段（audio.narration.segments 为空）', issues }
  }
  // asset_id → 资产（上游 compose 用 asset_manifest 建 asset_lookup 再解析引用）
  const assetLookup = {}
  for (const asset of asArray(asObject(context.assets).assets)) {
    const obj = asObject(asset)
    const id = asText(obj.id)
    if (id) assetLookup[id] = { path: asText(obj.path), type: asText(obj.type) }
  }
  const dir = path.dirname(videoPath)
  const narrationPath = path.join(dir, 'explainer_narration.m4a')
  const outputPath = path.join(dir, 'explainer_output_narrated.mp4')

  // 目标总时长：优先用画面自身时长（音画等长 ⇒ 混流后不拉伸也不截断）
  const probe = await probeContainer(videoPath)
  const totalSeconds = asNumber(probe.duration_seconds, 0)

  const track = await buildNarrationTrack({
    segments,
    assetLookup,
    outputPath: narrationPath,
    totalSeconds,
  })
  issues.push(...asArray(track.issues))
  if (!track.ok) {
    return { ok: false, videoPath, reason: track.reason || '旁白轨合成失败', issues }
  }
  const muxed = await muxNarration({ videoPath, audioPath: track.path, outputPath })
  issues.push(...asArray(muxed.issues))
  if (!muxed.ok) {
    return { ok: false, videoPath, reason: muxed.reason || '旁白混流失败', issues }
  }
  return { ok: true, videoPath: outputPath, reason: '', issues }
}

/**
 * compose 阶段：Remotion 优先（程序化动画）→ 失败回落 ffmpeg 轮播 → 探测产物 → 装配两个 artifact。
 *
 * @param {object} pipelineEngine
 */
function createComposeExecutor (pipelineEngine) {
  return async ({ runId, stage, params, context, onProgress }) => {
    const options = stage.options || {}
    // ⚠ **消费点适配**：内置 compose 读旧形态 `context.assets.scenes[]`，
    //   而本片的 assets 产物是上游 asset_manifest ⇒ 先转回旧形态再喂给它
    //   （`context.assets` 本身仍是纯 artifact，不加 scenes 字段）。
    const sceneSource = resolveSceneSource(context)
    const legacyScenes = assetManifestToLegacyScenes(
      asObject(context.assets), sceneSource.plan, asObject(context.script),
    )
    const legacyContext = legacyScenes.length
      ? { ...context, assets: { scenes: legacyScenes } }
      : context
    // ⚠ 内层调用的 stage 必须**原样带 options**（内置 compose 读它的白名单 key）
    // ⚠ **且必须带 inputFrom**：`_resolveInput`（stage-executor.js:977）按 `context[stage.inputFrom]`
    //   取输入；漏了它就会走 fallback（读 params.assets / params.text）⇒ 拿到 null
    //   ⇒ 内置 compose 报「Invalid assetManifest: missing scenes or image/audio pairs」。
    const remotion = await tryRenderWithRemotion({ context, stage, onProgress, runId })
    let output
    let fellBackToFfmpeg = false
    let fallbackReason = ''
    if (remotion.ok) {
      // ⚠ **Remotion 出的画面没有旁白**（上游架构：视觉渲染 + 混轨 + mux）
      //   ⇒ 必须补上旁白，否则交付的是一条**静音片**（比不做更糟）。
      const narrated = await attachNarrationToVideo({ context, videoPath: remotion.videoPath })
      if (narrated.ok) {
        output = { videoPath: narrated.videoPath, renderRuntime: 'remotion' }
      } else {
        // ⚠ 拿不到旁白 ⇒ **不交付静音片** ⇒ 回落 ffmpeg 轮播（那条路本来就带旁白）
        fellBackToFfmpeg = true
        fallbackReason = 'Remotion 成片无法带上旁白：' + narrated.reason
      }
    } else {
      fellBackToFfmpeg = true
      fallbackReason = remotion.reason
    }
    if (fellBackToFfmpeg) {
      const inner = await pipelineEngine.stageExecutor.execute({
        runId,
        stage: { name: 'compose', type: 'compose', options, inputFrom: 'assets' },
        params,
        context: legacyContext,
        onProgress,
      })
      if (!inner.success) return inner
      output = { ...asObject(inner.output), renderRuntime: 'ffmpeg' }
    }

    const videoPath = asText(output.videoPath) || asText(context.videoPath)

    // 产物有效性探测（IO；失败不阻断，但要记进 final_review）
    const probe = await probeContainer(videoPath)
    const frames = await sampleFrames(videoPath, {
      count: 4,
      durationSeconds: asNumber(probe.duration_seconds, 0),
    })
    const loudness = await measureLoudness(videoPath)

    const editDecisions = asObject(context.editing)
    const proposal = asObject(context.proposal)
    const renderReport = buildRenderReport(output, {
      probe,
      editDecisions,
      renderTimeSeconds: asNumber(context.compose_started_at)
        ? (Date.now() - asNumber(context.compose_started_at)) / 1000
        : 0,
      videoPath,
    })
    const renderValidation = validateArtifact('render_report', renderReport)
    if (!renderValidation.ok) {
      return {
        success: false,
        error: 'render_report 不符合上游 schema：' +
          renderValidation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }

    const finalReview = buildFinalReview({}, {
      probe,
      frames,
      loudness,
      renderReport,
      editDecisions,
      videoPath,
      lockedRuntime: asText(asObject(proposal.production_plan).render_runtime),
      // ⚠ 实际 runtime：**如实上报**（Remotion 优先，失败才回落 ffmpeg）
      actualRuntime: asText(output.renderRuntime) || 'ffmpeg',
      approvalStatus: asText(asObject(proposal.approval).status),
    })
    const reviewValidation = validateArtifact('final_review', finalReview)
    if (!reviewValidation.ok) {
      return {
        success: false,
        error: 'final_review 不符合上游 schema：' +
          reviewValidation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }

    return {
      success: true,
      output: {
        ...composeOutputWithArtifacts(output, renderReport, finalReview),
        // ⚠ 回落要**可见**（不静默降级）：用户与后续排查必须知道「想要 Remotion，实际走了 ffmpeg」
        ...(fellBackToFfmpeg
          ? { render_runtime_requested: 'remotion', render_fallback_reason: fallbackReason }
          : {}),
      },
      // ⚠ final_review.status = 'fail' 时**不把成片当完成品**（上游 schema 明写）
      //   但**不阻断流水线** —— 成片在盘上，阻断只会让用户拿不到。
      issues: asArray(asObject(finalReview.metadata).issues),
      reviewStatus: asText(finalReview.status),
    }
  }
}

/**
 * publish 阶段：跑内置发布，再登记成上游 publish_log。
 */
function createPublishExecutor (pipelineEngine) {
  return async ({ stage, params, context, onProgress }) => {
    const inner = await pipelineEngine.stageExecutor.execute({
      // ⚠ 同样必须带 inputFrom: 'compose'（内置 publish 从 context.compose 读 videoPath）
      stage: { name: 'publish', type: 'publish', options: stage.options || {}, platforms: stage.platforms, inputFrom: 'compose' },
      params,
      context,
      onProgress,
    })
    if (!inner.success) return inner

    const log = buildPublishLog(inner.output, {
      videoPath: asText(asObject(inner.output).videoPath) || asText(context.videoPath),
      platforms: asArray(stage.platforms || (stage.options || {}).platforms),
    })
    const validation = validateArtifact('publish_log', log)
    if (!validation.ok) {
      return {
        success: false,
        error: 'publish_log 不符合上游 schema：' +
          validation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }
    const issues = checkPublishLogCriteria(log)
    return { success: true, output: log, issues }
  }
}

module.exports = {
  assetManifestToLegacyScenes,
  buildExplainerRemotionProps,
  composeOutputWithArtifacts,
  createComposeExecutor,
  createPublishExecutor,
}
