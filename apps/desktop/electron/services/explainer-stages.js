// @ts-check
/**
 * explainer-stages - animated-explainer（AI 讲解视频）流水线的自定义阶段执行器
 *
 * 注册与 animated-explainer 流水线配套的 8 个 STAGE_TYPES：
 *   - explainer_research:          主题 → research_brief artifact（P2a）
 *   - explainer_proposal:          → proposal_packet artifact（P2a）
 *   - explainer_script:            → script artifact（P2a）
 *   - explainer_scenes:            → scene_plan artifact（结构化镜头语言，P2b）
 *   - explainer_generate_assets:   → asset_manifest artifact（复用 story2video_generate_assets，P2b）
 *   - explainer_editing:           → edit_decisions artifact（真剪辑决策，P2b）
 *   - explainer_compose:           → render_report + final_review artifact（P2b）
 *   - explainer_publish:           → publish_log artifact（P2b）
 *
 * ## 为什么 compose / publish 用**专属** type
 *
 * 内置 `compose` / `publish`（`stage-executor.js`）是 story2video 等 5 条流水线共用的
 * ⇒ 改它们的输出形态会破坏那 5 条线。
 * ⇒ explainer 用 `explainer_compose` / `explainer_publish` 两个独立 key
 *   （`execute` 是「自定义 executor 优先」，key 不重叠 ⇒ 零侵入）。
 * ⇒ `pipeline-engine.js` 里只**换 type 字符串**（行数不变）⇒ 不撞点名还账的零容差天花板。
 *
 * 注册方式：在 container.setup.js 中调用 registerExplainerStages(pipelineEngine)
 */

'use strict'

const preprodPrompts = require('./explainer/explainer-preprod-stages')
const prodStages = require('./explainer/explainer-prod-stages')
const reviewStages = require('./explainer/explainer-review-stages')

const {
  createResearchExecutor,
  createProposalExecutor,
  createScriptExecutor,
} = preprodPrompts

const EXPLAINER_STAGE_TYPES = {
  RESEARCH: 'explainer_research',
  PROPOSAL: 'explainer_proposal',
  SCRIPT: 'explainer_script',
  SCENES: 'explainer_scenes',
  GENERATE_ASSETS: 'explainer_generate_assets',
  EDITING: 'explainer_editing',
  COMPOSE: 'explainer_compose',
  PUBLISH: 'explainer_publish',
}

/**
 * ⚠ **人工审批门阶段**（P3）：上游 `human_approval_default: true` 恰好 5 个阶段
 *   —— proposal / script / scene_plan / assets / publish
 *   ⇒ 映射到本仓阶段名 = proposal / script / scenes / assets / publish。
 *   ⚠ 这份清单必须与 `pipeline-engine.js` 里 explainer stageDefs 的
 *     `checkpointRequired: true` **逐字一致**（契约锁会对拍）⇒ 两处不许各自漂移。
 */
const EXPLAINER_GATE_STAGE_TYPES = [
  EXPLAINER_STAGE_TYPES.PROPOSAL,
  EXPLAINER_STAGE_TYPES.SCRIPT,
  EXPLAINER_STAGE_TYPES.SCENES,
  EXPLAINER_STAGE_TYPES.GENERATE_ASSETS,
  EXPLAINER_STAGE_TYPES.PUBLISH,
]

/**
 * ⚠ **门批准后重入 ⇒ 复用已产出的产物，不重跑**（P3 收口）
 *
 * 背景：P3 给 explainer 的 5 个阶段开了人工审批门。门在**阶段产出之后**触发
 *   （引擎 `_executeStage` 末尾），而 `confirmStageGate` 放行后走 `_autoAdvanceRun`
 *   ⇒ **从当前阶段重跑**。实测（E2E 日志）：assets 因此完整生产了两遍
 *   （10 图 + 10 TTS × 2）。
 *
 * 两个真缺陷（本包装层同时修掉）：
 *   ① **重复消耗**：assets 阶段的素材、LLM 阶段的模型调用都会白做一遍；
 *   ② **用户在 G1 门里的选择被冲掉**：`confirmStageGate` 把选中的
 *      `proposal.production_plan.render_runtime` 写回 `run.context.proposal`，
 *      而重跑 proposal 会用新的 LLM 输出**重新归一化**
 *      ⇒ `render_runtime` 被重置成默认值（`explainer-artifacts.js` 的
 *      `plan.render_runtime = runtimeFromLlm || 'remotion'`）
 *      ⇒ P3「选项写回产物本体 ⇒ 下游零改动生效」的设计**当场失效**。
 *
 * ⚠ **为什么必须放在执行器层、不能放引擎层**：
 *   film-engineering 的 `film_generate_videos` 是**另一种门**（成本确认入口闸：
 *   第一次执行只产「等待态清单」、**零 provider 调用**，批准后**必须**重入才真生成）
 *   ⇒ 引擎层「有产物就跳过」会让它**永远不生成视频**。
 *   ⇒ 两种门语义并存 ⇒ 只能在 explainer 这一层区分。
 *
 * 判据：`stage.gateCleared === true`（刚被门放行）**且** `context[stage.name]` 已存在
 *   ⇒ 复用产物。
 *   ⚠ 「应用重启后从 checkpoint 断点续跑」**不会**带 `gateCleared`
 *   ⇒ 仍然照常重跑（既有行为不变）。
 *
 * @param {Function} executor - 原阶段执行器
 * @returns {Function} 包装后的执行器
 */
function withGateReuse (executor) {
  return async (args) => {
    const stage = args && args.stage
    const context = args && args.context
    if (stage && stage.gateCleared === true && context && context[stage.name] !== undefined) {
      return { success: true, output: context[stage.name] }
    }
    return executor(args)
  }
}

/**
 * 注册 animated-explainer 流水线的自定义阶段执行器
 * @param {object} pipelineEngine - PipelineEngine 实例（需已注入 serviceBus）
 * @returns {{success: boolean, error?: string, registered?: string[]}}
 */
function registerExplainerStages (pipelineEngine) {
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    return {
      success: false,
      error: 'PipelineEngine.stageExecutor not configured (ServiceBus missing)',
    }
  }

  const registered = []

  const executors = [
    [EXPLAINER_STAGE_TYPES.RESEARCH, createResearchExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.PROPOSAL, createProposalExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.SCRIPT, createScriptExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.SCENES, prodStages.createScenePlanExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.GENERATE_ASSETS, prodStages.createAssetsExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.EDITING, prodStages.createEditingExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.COMPOSE, reviewStages.createComposeExecutor(pipelineEngine)],
    [EXPLAINER_STAGE_TYPES.PUBLISH, reviewStages.createPublishExecutor(pipelineEngine)],
  ]

  for (const [stageType, executor] of executors) {
    // ⚠ 只包装**有门**的阶段 ⇒ 无门阶段（research / editing / compose）行为完全不变
    const effective = EXPLAINER_GATE_STAGE_TYPES.includes(stageType)
      ? withGateReuse(executor)
      : executor
    pipelineEngine.registerStageExecutor(stageType, effective)
    registered.push(stageType)
  }

  return { success: true, registered }
}

module.exports = {
  EXPLAINER_STAGE_TYPES,
  EXPLAINER_GATE_STAGE_TYPES,
  withGateReuse,
  // 三个前生产阶段的提示词已抽到 explainer/explainer-preprod-stages.js
  // 五个生产阶段的实现已抽到 explainer/explainer-prod-stages.js + explainer/explainer-review-stages.js
  // （explainer-stages.js 只做**注册**，不堆实现）
  buildResearchPrompt: preprodPrompts.buildResearchPrompt,
  buildProposalPrompt: preprodPrompts.buildProposalPrompt,
  buildScriptPrompt: preprodPrompts.buildScriptPrompt,
  buildScenePlanPrompt: prodStages.buildScenePlanPrompt,
  parseScenesArray: prodStages.parseScenesArray,
  fallbackScenes: prodStages.fallbackScenes,
  linkScenesToSections: prodStages.linkScenesToSections,
  adaptScenesForAssets: prodStages.adaptScenesForAssets,
  registerExplainerStages,
}
