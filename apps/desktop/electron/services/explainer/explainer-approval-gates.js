'use strict'

/**
 * AI 讲解视频（animated-explainer）的人工审批门。
 *
 * ⚠ 上游真源（逐字，不凭印象）：
 *   - `pipeline_defs/animated-explainer.yaml`（OpenMontage，blob bd17a1975214077c74b6ebc8fb68ad18eaf331ed）
 *   - `schemas/checkpoints/checkpoint.schema.json`（P1 已 1:1 落地于
 *     `apps/desktop/electron/services/explainer/schemas/checkpoints/checkpoint.schema.json`）
 *
 *   上游 `human_approval_default: true` 的阶段**恰好 5 个**：proposal / script / scene_plan / assets / publish。
 *   本仓阶段名 `scenes` ↔ 上游 `scene_plan`；其余同名。
 *
 * ⚠ 仓内 `packages/python-backend/.../definitions/animated-explainer.yaml` 是上游的**过期副本**
 *   （把 assets 写成 human_approval_default: false），且桌面端从不读 YAML ⇒ **不是真源**。
 *
 * ⚠ 门载荷严格按上游 checkpoint schema 逐字 1:1（`additionalProperties: false` ⇒ 不得新增顶层字段）；
 *   本片自定义信息全部落在 `metadata` / `review`（schema 允许 object 扩展）。
 *
 * ⚠ 本模块是**唯一**跨模块访问 `pipelineEngine._runs` 私有成员的地方：
 *   `apps/desktop/electron/services/pipeline-engine.js` 处于点名还账清单（target 2776 / 现 2776 / 容差 0），
 *   加任何一行都会让主干红；`container.setup.js` 也只剩 1 行且门禁口径是 `lines >= limit`（500 即红）。
 *   ⇒ 驳回与门载荷读取都挂到 `ipc-handlers/pipeline.js`（410 / 上限 500）这一层。
 *   机械锁：`explainer-approval-gates.test.js` 断言全仓除本文件外没有 `_runs` 的跨模块访问。
 */

/** 上游 checkpoint.schema.json 的 version const */
const CHECKPOINT_VERSION = '1.0'

/** 五道门（本仓阶段名 → 上游阶段名） */
const GATE_STAGES = ['proposal', 'script', 'scenes', 'assets', 'publish']

/** 本仓阶段名 → 上游 stage 名 */
const UPSTREAM_STAGE_NAMES = {
  proposal: 'proposal',
  script: 'script',
  scenes: 'scene_plan',
  assets: 'assets',
  publish: 'publish',
}

/**
 * 五道门的定义。
 * ⚠ `reviewFocus` / `successCriteria` **逐字抄自上游 yaml**（blob bd17a197），供数据层对账与未来同步；
 *   用户看到的中文对照在 locale（`pipelines.approvalGate.*`）⇒ 两份各自演进，条数由机械锁守住。
 * ⚠ `autoChecks` = 可机械核对的 success_criteria；`manualChecks` = 只能人判的 review_focus。
 *   —— **不把「人判」伪装成自动断言**（上游把两类混写在 success_criteria 里）。
 */
const GATE_DEFS = {
  proposal: {
    gateIndex: 1,
    titleKey: 'pipelines.approvalGate.title.proposal',
    /** 上游 produces：proposal_packet + decision_log（本仓把 decision_log 合进 proposal_packet） */
    artifactNames: ['proposal_packet', 'decision_log'],
    /** run.context 里该阶段产物的键 = 本仓 stage 名 */
    contextKey: 'proposal',
    reviewFocus: [
      'Concept options are genuinely different (structure, hook, audience)',
      'Each concept is grounded in research findings, not generic',
      'Production plan reflects actual tool availability from preflight',
      'Cost estimate is itemized and honest',
      'Quality/cost tradeoffs are clearly presented',
      'Alternative production paths shown at different price points',
      '"Concept differentiation from reference (if reference-driven)"',
    ],
    successCriteria: [
      'Schema-valid proposal_packet with at least 3 concept_options',
      'selected_concept references a valid concept_id',
      'cost_estimate has itemized line_items with per-tool costs',
      'approval.status is "approved" or "approved_with_changes" before proceeding',
    ],
    // 上游第 4 条描述的是「门决议本身」（本仓 P2a 已把 approval.status 强制为 pending，由本门写入），
    // **不是**可自动核对的检查项 ⇒ 不计入 autoChecks。
    autoChecks: [
      'Schema-valid proposal_packet with at least 3 concept_options',
      'selected_concept references a valid concept_id',
      'cost_estimate has itemized line_items with per-tool costs',
    ],
    manualChecks: [
      'Concept options are genuinely different (structure, hook, audience)',
      'Each concept is grounded in research findings, not generic',
      'Production plan reflects actual tool availability from preflight',
      'Cost estimate is itemized and honest',
      'Quality/cost tradeoffs are clearly presented',
      'Alternative production paths shown at different price points',
      '"Concept differentiation from reference (if reference-driven)"',
    ],
  },
  script: {
    gateIndex: 2,
    titleKey: 'pipelines.approvalGate.title.script',
    artifactNames: ['script'],
    contextKey: 'script',
    reviewFocus: [
      'Word count within +/-10% of duration target from selected concept',
      'Enhancement cue density: 1 per 8-10 seconds',
      'Narrative arc: hook -> setup -> build -> climax -> landing',
      'Speaker directions present for TTS',
      'Voice performance plan includes concrete pacing, pause, emphasis, and sample cues',
      'Script incorporates research data points and cited facts',
    ],
    successCriteria: [
      'Schema-valid script with enhancement_cues per section',
      'Total duration matches selected concept target within 10%',
    ],
    autoChecks: [
      'Schema-valid script with enhancement_cues per section',
      'Total duration matches selected concept target within 10%',
    ],
    manualChecks: [
      'Word count within +/-10% of duration target from selected concept',
      'Enhancement cue density: 1 per 8-10 seconds',
      'Narrative arc: hook -> setup -> build -> climax -> landing',
      'Speaker directions present for TTS',
      'Voice performance plan includes concrete pacing, pause, emphasis, and sample cues',
      'Script incorporates research data points and cited facts',
    ],
  },
  scenes: {
    gateIndex: 3,
    titleKey: 'pipelines.approvalGate.title.scenes',
    artifactNames: ['scene_plan'],
    contextKey: 'scenes',
    reviewFocus: [
      'Full script duration covered with no gaps',
      'Visual variety: no 3+ consecutive scenes of same type',
      'Asset feasibility - every required_asset uses a tool from the production plan',
      'Playbook adherence - transitions, colors, pacing rules',
    ],
    successCriteria: [
      'Schema-valid scene_plan with required_assets per scene',
      'At least 3 different scene types used',
    ],
    autoChecks: [
      'Schema-valid scene_plan with required_assets per scene',
      'At least 3 different scene types used',
    ],
    manualChecks: [
      'Full script duration covered with no gaps',
      'Visual variety: no 3+ consecutive scenes of same type',
      'Asset feasibility - every required_asset uses a tool from the production plan',
      'Playbook adherence - transitions, colors, pacing rules',
    ],
  },
  assets: {
    gateIndex: 4,
    titleKey: 'pipelines.approvalGate.title.assets',
    artifactNames: ['asset_manifest'],
    contextKey: 'assets',
    reviewFocus: [
      'All asset files exist on disk',
      'Narration covers all script sections',
      'Narration assets apply the approved voice performance plan and sample settings',
      'Total cost within approved budget from proposal_packet',
      'Image style consistency across all generated visuals',
    ],
    successCriteria: [
      'Schema-valid asset_manifest with all required assets generated',
      'All file paths resolve to existing files',
    ],
    autoChecks: [
      'Schema-valid asset_manifest with all required assets generated',
      'All file paths resolve to existing files',
    ],
    manualChecks: [
      'All asset files exist on disk',
      'Narration covers all script sections',
      'Narration assets apply the approved voice performance plan and sample settings',
      'Total cost within approved budget from proposal_packet',
      'Image style consistency across all generated visuals',
    ],
  },
  publish: {
    gateIndex: 5,
    titleKey: 'pipelines.approvalGate.title.publish',
    artifactNames: ['publish_log'],
    contextKey: 'publish',
    reviewFocus: [
      'SEO metadata complete and keyword-rich',
      'Chapter markers present',
      'Export package structured correctly',
    ],
    successCriteria: [
      'Schema-valid publish_log',
      'Export directory contains video, metadata, and thumbnail concept',
    ],
    autoChecks: [
      'Schema-valid publish_log',
      'Export directory contains video, metadata, and thumbnail concept',
    ],
    manualChecks: [
      'SEO metadata complete and keyword-rich',
      'Chapter markers present',
      'Export package structured correctly',
    ],
  },
}

/** G1（proposal 门）可选的渲染引擎；remotion 为推荐项。 */
const RENDER_RUNTIME_OPTIONS = [
  { value: 'remotion', recommended: true },
  { value: 'ffmpeg', recommended: false },
]

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function listApprovalGateStages() {
  return GATE_STAGES.slice()
}

function isApprovalGateStage(stageName) {
  return typeof stageName === 'string' && Object.prototype.hasOwnProperty.call(GATE_DEFS, stageName)
}

function getApprovalGateDef(stageName) {
  return isApprovalGateStage(stageName) ? GATE_DEFS[stageName] : null
}

/**
 * 把该阶段的产物整理成上游 `artifacts` 类型化 map。
 * ⚠ 产物缺失时**不编造**：该键直接不出现，并在 metadata.note 里如实说明。
 */
function collectGateArtifacts(stageName, context) {
  const def = getApprovalGateDef(stageName)
  const artifacts = {}
  if (!def) return artifacts
  const produced = isPlainObject(context) ? context[def.contextKey] : null
  if (!isPlainObject(produced)) return artifacts
  const primary = def.artifactNames[0]
  artifacts[primary] = produced
  // decision_log 在上游是独立产物；本仓把它合进 proposal_packet ⇒ 只有产物里自带时才另列。
  if (def.artifactNames.length > 1 && isPlainObject(produced.decision_log)) {
    artifacts.decision_log = produced.decision_log
  }
  return artifacts
}

/**
 * 组装门载荷（严格按上游 checkpoint.schema.json 的字段集）。
 * @param {object} args
 * @param {string} args.stageName 本仓阶段名
 * @param {string} args.runId
 * @param {object} args.context run.context
 * @param {string} [args.policy] checkpoint_policy（guided / manual_all / auto_noncreative）
 * @param {string} [args.now] ISO 时间戳（可注入，便于测试）
 * @returns {object} 上游 checkpoint 形状
 */
function buildApprovalGatePayload(args) {
  const stageName = args && args.stageName
  const def = getApprovalGateDef(stageName)
  if (!def) {
    const error = new Error('不是审批门阶段: ' + String(stageName))
    error.errorCode = 'NOT_AN_APPROVAL_GATE'
    throw error
  }
  const context = isPlainObject(args.context) ? args.context : {}
  const artifacts = collectGateArtifacts(stageName, context)
  const artifactNames = Object.keys(artifacts)
  const payload = {
    version: CHECKPOINT_VERSION,
    project_id: String((args && args.runId) || ''),
    pipeline_type: 'animated-explainer',
    stage: stageName,
    status: 'awaiting_human',
    timestamp: (args && args.now) || new Date().toISOString(),
    checkpoint_policy: (args && args.policy) || 'guided',
    human_approval_required: true,
    human_approved: false,
    artifacts,
    review: {
      focus: def.reviewFocus.slice(),
      success_criteria: def.successCriteria.slice(),
      auto_checks: def.autoChecks.slice(),
      manual_checks: def.manualChecks.slice(),
    },
    // 本仓无单价表 ⇒ 金额恒 0；真实金额随 P4 的预算闸落地。
    cost_snapshot: {
      total_spent_usd: 0,
      total_reserved_usd: 0,
      budget_remaining_usd: 0,
    },
    metadata: {
      gate_index: def.gateIndex,
      gate_total: GATE_STAGES.length,
      gate_title_key: def.titleKey,
      upstream_stage: UPSTREAM_STAGE_NAMES[stageName],
      artifact_names: artifactNames,
      cost_note: '单价未知：本仓暂无模型单价表，金额恒为 0',
    },
  }
  if (artifactNames.length === 0) {
    payload.metadata.note = '该阶段产物缺失，门载荷不含 artifacts'
  }
  if (stageName === 'proposal') {
    // G1 特有：渲染引擎二选一。⚠ 默认**不带选中值**——「高亮推荐」≠「已选中」，
    // 否则等于静默默认（用户没确认也按 remotion 跑）。
    payload.metadata.render_runtime_options = RENDER_RUNTIME_OPTIONS.map((o) => ({
      value: o.value,
      recommended: o.recommended,
    }))
  }
  return payload
}

/**
 * 组装批准时写进 run.context 的载荷。
 * ⚠ G1 选了渲染引擎时，必须**改写 proposal 本体**的 production_plan.render_runtime ——
 *   compose / edit 链路的读点就是 `proposal.production_plan.render_runtime`
 *   （`explainer-prod-stages.js` 的 lockedRuntime）⇒ 改产物本体即可生效，无需改下游读点。
 */
function buildApprovalContextPatch(args) {
  const stageName = args && args.stageName
  if (!isApprovalGateStage(stageName)) {
    const error = new Error('不是审批门阶段: ' + String(stageName))
    error.errorCode = 'NOT_AN_APPROVAL_GATE'
    throw error
  }
  const note = typeof (args && args.note) === 'string' ? args.note.trim() : ''
  const now = (args && args.now) || new Date().toISOString()
  const patch = {}
  patch['approval_' + stageName] = {
    stage: stageName,
    approved: true,
    approved_at: now,
    note,
  }
  const runtime = args && args.renderRuntime
  if (stageName === 'proposal') {
    if (runtime !== 'remotion' && runtime !== 'ffmpeg') {
      const error = new Error('渲染引擎取值非法: ' + String(runtime))
      error.errorCode = 'INVALID_RENDER_RUNTIME'
      throw error
    }
    patch['approval_' + stageName].render_runtime = runtime
    const proposal = args.proposalArtifact
    if (!isPlainObject(proposal)) {
      const error = new Error('缺少 proposal 产物，无法写入渲染引擎')
      error.errorCode = 'MISSING_PROPOSAL_ARTIFACT'
      throw error
    }
    const nextProposal = JSON.parse(JSON.stringify(proposal))
    const productionPlan = isPlainObject(nextProposal.production_plan)
      ? nextProposal.production_plan
      : {}
    productionPlan.render_runtime = runtime
    nextProposal.production_plan = productionPlan
    const metadata = isPlainObject(nextProposal.metadata) ? nextProposal.metadata : {}
    metadata.render_runtime_selection = runtime
    metadata.render_runtime_source = 'user_confirmed'
    nextProposal.metadata = metadata
    patch.proposal = nextProposal
  }
  return patch
}

function getRunById(pipelineEngine, runId) {
  if (!pipelineEngine || typeof pipelineEngine._runs?.get !== 'function') return null
  return pipelineEngine._runs.get(runId) || null
}

/**
 * 读取当前停在某道门的载荷（渲染层用）。
 * @returns {{success: boolean, payload?: object, error?: string, errorCode?: string}}
 */
function readApprovalGatePayload(pipelineEngine, runId) {
  if (typeof runId !== 'string' || !runId.trim()) {
    return { success: false, error: '缺少或非法 runId', errorCode: 'PIPELINE_INVALID_RUN_ID' }
  }
  const run = getRunById(pipelineEngine, runId)
  if (!run) {
    return { success: false, error: '未找到流水线运行', errorCode: 'RUN_NOT_FOUND' }
  }
  const checkpoint = run.checkpoint
  if (!isPlainObject(checkpoint)) {
    return { success: false, error: '当前流水线不处于等待确认的检查点', errorCode: 'NOT_AT_CONFIRMATION_GATE' }
  }
  const stageName = checkpoint.stageName
  if (!isApprovalGateStage(stageName)) {
    return { success: false, error: '当前检查点不是审批门', errorCode: 'NOT_AT_APPROVAL_GATE' }
  }
  try {
    const payload = buildApprovalGatePayload({
      stageName,
      runId: run.id || runId,
      context: run.context || {},
      policy: (run.params && run.params.checkpointPolicy) || 'guided',
    })
    return { success: true, payload, stage: stageName }
  } catch (error) {
    return { success: false, error: error.message, errorCode: error.errorCode || 'APPROVAL_GATE_BUILD_FAILED' }
  }
}

/**
 * 驳回当前门：记录意见并**停住**（不推进、不自动重跑）。
 * ⚠ 上游的 REVISE / SEND_BACK（返工 / 退回上游阶段）属 P4 的 EP 编排，本片不做。
 * @returns {{success: boolean, paused?: boolean, stage?: string, error?: string, errorCode?: string}}
 */
function rejectStageGate(pipelineEngine, runId, payload) {
  if (typeof runId !== 'string' || !runId.trim()) {
    return { success: false, error: '缺少或非法 runId', errorCode: 'PIPELINE_INVALID_RUN_ID' }
  }
  const body = isPlainObject(payload) ? payload : {}
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  const run = getRunById(pipelineEngine, runId)
  if (!run) {
    return { success: false, error: '未找到流水线运行', errorCode: 'RUN_NOT_FOUND' }
  }
  if (run.status !== 'paused' || !isPlainObject(run.checkpoint)) {
    return { success: false, error: '当前流水线不处于等待确认的检查点', errorCode: 'NOT_AT_CONFIRMATION_GATE' }
  }
  const stageName = run.checkpoint.stageName
  if (!isApprovalGateStage(stageName)) {
    return { success: false, error: '当前检查点不是审批门', errorCode: 'NOT_AT_APPROVAL_GATE' }
  }
  if (body.stage !== undefined && body.stage !== stageName) {
    return { success: false, error: '驳回的阶段与当前门不一致', errorCode: 'APPROVAL_GATE_STAGE_MISMATCH' }
  }
  const now = new Date().toISOString()
  run.context = run.context || {}
  run.context['approval_' + stageName] = {
    stage: stageName,
    approved: false,
    rejected_at: now,
    note,
  }
  // checkpoint 里的 context 快照同步更新，渲染层轮询即可读到驳回态（不需要新事件）。
  run.checkpoint = {
    ...run.checkpoint,
    context: JSON.parse(JSON.stringify(run.context)),
  }
  return { success: true, runId, paused: true, stage: stageName, rejectedAt: now }
}

/**
 * 批准当前门：组装 contextPatch 并走既有的 `confirmStageGate`（该方法是 pipeline-engine 的公开 API）。
 * ⚠ G1（proposal）必须显式给出 renderRuntime ——「高亮推荐」不等于「已选中」，
 *   缺省即视为没确认（禁止静默默认：否则用户没点也按 remotion 跑，代价是 23~32 分钟的渲染）。
 * ⚠ runtime 的落地方式是**改写 proposal 本体**的 production_plan.render_runtime ——
 *   compose / edit 链路的读点就是它（`explainer-prod-stages.js` 的 lockedRuntime）⇒ 下游零改动。
 * @returns {Promise<{success: boolean, paused?: boolean, stage?: string, error?: string, errorCode?: string}>}
 */
async function approveStageGate(pipelineEngine, runId, body) {
  if (typeof runId !== 'string' || !runId.trim()) {
    return { success: false, error: '缺少或非法 runId', errorCode: 'PIPELINE_INVALID_RUN_ID' }
  }
  const payload = isPlainObject(body) ? body : {}
  const run = getRunById(pipelineEngine, runId)
  if (!run) {
    return { success: false, error: '未找到流水线运行', errorCode: 'RUN_NOT_FOUND' }
  }
  if (run.status !== 'paused' || !isPlainObject(run.checkpoint)) {
    return { success: false, error: '当前流水线不处于等待确认的检查点', errorCode: 'NOT_AT_CONFIRMATION_GATE' }
  }
  const stageName = run.checkpoint.stageName
  if (!isApprovalGateStage(stageName)) {
    return { success: false, error: '当前检查点不是审批门', errorCode: 'NOT_AT_APPROVAL_GATE' }
  }
  if (payload.stage !== undefined && payload.stage !== stageName) {
    return { success: false, error: '批准的阶段与当前门不一致', errorCode: 'APPROVAL_GATE_STAGE_MISMATCH' }
  }
  let patch
  try {
    patch = buildApprovalContextPatch({
      stageName,
      note: payload.note,
      renderRuntime: payload.renderRuntime,
      proposalArtifact: isPlainObject(run.context) ? run.context.proposal : null,
      now: payload.now,
    })
  } catch (error) {
    return { success: false, error: error.message, errorCode: error.errorCode || 'APPROVAL_GATE_PATCH_FAILED' }
  }
  const result = await pipelineEngine.confirmStageGate(runId, patch)
  return { ...result, stage: stageName }
}

module.exports = {
  CHECKPOINT_VERSION,
  GATE_STAGES,
  GATE_DEFS,
  RENDER_RUNTIME_OPTIONS,
  UPSTREAM_STAGE_NAMES,
  listApprovalGateStages,
  isApprovalGateStage,
  getApprovalGateDef,
  collectGateArtifacts,
  buildApprovalGatePayload,
  buildApprovalContextPatch,
  readApprovalGatePayload,
  approveStageGate,
  rejectStageGate,
}
