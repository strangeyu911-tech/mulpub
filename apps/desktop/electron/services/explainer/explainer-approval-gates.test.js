// @vitest-environment node
// @ts-check
/**
 * explainer-approval-gates.test.js — AI 讲解视频的人工审批门（上游 animated-explainer 的
 * checkpoint / human_approval 语义）
 *
 * ## 覆盖什么
 *
 * ① **门集合**：上游 `human_approval_default: true` 的阶段恰好 5 个（proposal / script /
 *    scene_plan / assets / publish），本仓阶段名 `scenes` ↔ 上游 `scene_plan`。
 * ② **门载荷**：严格按上游 `checkpoint.schema.json`（用仓内校验器实跑，`additionalProperties:false`
 *    ⇒ 多一个顶层字段就红）；`status` 恒为 `awaiting_human`。
 * ③ **产物映射**：artifacts 用**上游 artifact 名**（proposal_packet / script / scene_plan /
 *    asset_manifest / publish_log）；产物缺失时**不编造**（artifacts 为空 + metadata.note 说明）。
 * ④ **驳回**：记录意见并**停住**（run 保持 paused、**不推进**）。
 * ⑤ **批准**：G1 必须**显式**给渲染引擎（缺省即拒绝 ⇒ 禁止静默默认），且选择被**写回
 *    proposal 本体**的 production_plan.render_runtime（compose/edit 链路的读点）。
 * ⑥ **契约锁**（防止机制悄悄退化）：
 *    - pipeline-engine.js 的 5 门 `checkpointRequired === true`，且 research/editing/compose 仍为 false；
 *    - `_runs` 的**跨模块**访问只允许出现在本模块（pipeline-engine.js 处于零容差点名还账清单）；
 *    - locale 的 focus / autoChecks **条数**与本模块的 GATE_DEFS 逐条对应（防中英文漂移）；
 *    - 渲染层默认审批模式是 `none`（零回归：默认不打断既有「一键出片」）。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
// ESM 环境里 __dirname / __filename 不存在 ⇒ 显式补出（契约锁要用「本文件路径」排除自身）
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const gates = require('./explainer-approval-gates')
const { validate } = require('./artifact-schema-validator')

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
}

/** 造一个最小的 pipelineEngine 桩（只需要 _runs 与 confirmStageGate）。 */
function makeEngine(run) {
  const calls = { confirm: [], advance: 0 }
  const engine = {
    _runs: new Map([[run.id, run]]),
    calls,
    async confirmStageGate(runId, contextPatch) {
      calls.confirm.push({ runId, contextPatch })
      Object.assign(run.context, contextPatch)
      run.checkpoint = null
      run.status = 'running'
      return { success: true, runId }
    },
    async _autoAdvanceRun() {
      calls.advance += 1
      return { success: true }
    },
  }
  return engine
}

function makeRun(stageName, context) {
  return {
    id: 'run-1',
    pipeline: 'animated-explainer',
    status: 'paused',
    currentStage: 1,
    orchestrationMode: 'orchestrator',
    params: { checkpointPolicy: 'guided' },
    context: context || {},
    checkpoint: {
      type: 'stage',
      stageName,
      stageIndex: 1,
      required: true,
      currentStage: 1,
      context: context || {},
      savedAt: new Date().toISOString(),
    },
    stages: [{ name: stageName, status: 'paused' }],
  }
}

/** 剥掉行注释与块注释行（判据只该看代码，不该被注释喂输入）。 */
function stripComments(text) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return ''
      // 先保护 URL 里的 '//'（'://' → ':/'），再剥行注释
      const guarded = line.replace(/:\/\//g, ':/')
      const idx = guarded.indexOf('//')
      return idx >= 0 ? guarded.slice(0, idx) : guarded
    })
    .join('\n')
}

describe('审批门 · 门集合与上游对齐', () => {
  it('门集合恰好是上游 human_approval_default: true 的五个阶段', () => {
    expect(gates.listApprovalGateStages()).toEqual(['proposal', 'script', 'scenes', 'assets', 'publish'])
  })

  it('本仓 scenes 映射到上游 scene_plan，其余同名', () => {
    expect(gates.UPSTREAM_STAGE_NAMES).toEqual({
      proposal: 'proposal',
      script: 'script',
      scenes: 'scene_plan',
      assets: 'assets',
      publish: 'publish',
    })
  })

  it('非门阶段不被当成门', () => {
    for (const stage of ['research', 'editing', 'compose']) {
      expect(gates.isApprovalGateStage(stage)).toBe(false)
      expect(gates.getApprovalGateDef(stage)).toBeNull()
    }
  })
})

describe('审批门 · 载荷符合上游 checkpoint schema', () => {
  it('载荷通过仓内校验器（additionalProperties:false ⇒ 多字段即红）', () => {
    const payload = gates.buildApprovalGatePayload({
      stageName: 'proposal',
      runId: 'run-1',
      context: { proposal: { version: '1.0', concept_options: [] } },
      policy: 'guided',
      now: '2026-10-25T00:00:00.000Z',
    })
    const result = validate(payload, 'checkpoint')
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('status 恒为 awaiting_human，human_approval_required 为 true、human_approved 为 false', () => {
    const payload = gates.buildApprovalGatePayload({
      stageName: 'script',
      runId: 'run-1',
      context: { script: { version: '1.0', title: 't', total_duration_seconds: 10, sections: [] } },
    })
    expect(payload.status).toBe('awaiting_human')
    expect(payload.human_approval_required).toBe(true)
    expect(payload.human_approved).toBe(false)
    expect(payload.version).toBe('1.0')
    expect(payload.pipeline_type).toBe('animated-explainer')
  })

  it('artifacts 用上游 artifact 名（scenes → scene_plan，assets → asset_manifest）', () => {
    const scenes = gates.buildApprovalGatePayload({
      stageName: 'scenes',
      runId: 'r',
      context: { scenes: { version: '1.0', scenes: [] } },
    })
    expect(Object.keys(scenes.artifacts)).toEqual(['scene_plan'])
    const assets = gates.buildApprovalGatePayload({
      stageName: 'assets',
      runId: 'r',
      context: { assets: { version: '1.0', assets: [] } },
    })
    expect(Object.keys(assets.artifacts)).toEqual(['asset_manifest'])
  })

  it('产物缺失 ⇒ 不编造：artifacts 为空且 metadata.note 如实说明', () => {
    const payload = gates.buildApprovalGatePayload({ stageName: 'publish', runId: 'r', context: {} })
    expect(payload.artifacts).toEqual({})
    expect(String(payload.metadata.note)).toContain('产物缺失')
  })

  it('G1 载荷带渲染引擎选项，且**不带默认选中值**（禁止静默默认）', () => {
    const payload = gates.buildApprovalGatePayload({
      stageName: 'proposal',
      runId: 'r',
      context: { proposal: { version: '1.0' } },
    })
    expect(Array.isArray(payload.metadata.render_runtime_options)).toBe(true)
    expect(payload.metadata.render_runtime_options.map((o) => o.value)).toEqual(['remotion', 'ffmpeg'])
    expect(payload.metadata.render_runtime_options[0].recommended).toBe(true)
    expect(payload.metadata.render_runtime).toBeUndefined()
    expect(payload.metadata.render_runtime_selection).toBeUndefined()
  })

  it('非 G1 门不带渲染引擎选项', () => {
    const payload = gates.buildApprovalGatePayload({ stageName: 'script', runId: 'r', context: {} })
    expect(payload.metadata.render_runtime_options).toBeUndefined()
  })

  it('成本快照三项为 0 且 metadata 写明「单价未知」', () => {
    const payload = gates.buildApprovalGatePayload({ stageName: 'script', runId: 'r', context: {} })
    expect(payload.cost_snapshot.total_spent_usd).toBe(0)
    expect(payload.cost_snapshot.total_reserved_usd).toBe(0)
    expect(payload.cost_snapshot.budget_remaining_usd).toBe(0)
    expect(String(payload.metadata.cost_note)).toContain('单价未知')
  })
})

describe('审批门 · 驳回后停住', () => {
  it('驳回记录意见、run 保持 paused、且不推进', async () => {
    const run = makeRun('proposal', { proposal: { version: '1.0' } })
    const engine = makeEngine(run)
    const result = await gates.rejectStageGate(engine, 'run-1', { stage: 'proposal', note: '概念不够差异' })
    expect(result.success).toBe(true)
    expect(result.paused).toBe(true)
    expect(engine.calls.advance).toBe(0)
    expect(engine.calls.confirm).toEqual([])
    expect(run.status).toBe('paused')
    expect(run.context.approval_proposal).toMatchObject({
      stage: 'proposal',
      approved: false,
      note: '概念不够差异',
    })
    expect(typeof run.context.approval_proposal.rejected_at).toBe('string')
  })

  it('驳回阶段与当前门不一致 ⇒ 拒绝', async () => {
    const run = makeRun('proposal', {})
    const engine = makeEngine(run)
    const result = await gates.rejectStageGate(engine, 'run-1', { stage: 'script' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('APPROVAL_GATE_STAGE_MISMATCH')
  })

  it('不在门内（非门阶段）⇒ 拒绝', async () => {
    const run = makeRun('compose', {})
    const engine = makeEngine(run)
    const result = await gates.rejectStageGate(engine, 'run-1', { stage: 'compose' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('NOT_AT_APPROVAL_GATE')
  })

  it('runId 非法 ⇒ 拒绝', async () => {
    const result = await gates.rejectStageGate(makeEngine(makeRun('proposal', {})), '', {})
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('PIPELINE_INVALID_RUN_ID')
  })
})

describe('审批门 · 批准（runtime 写回 proposal 本体）', () => {
  it('G1 选 ffmpeg ⇒ proposal.production_plan.render_runtime 被写为 ffmpeg 并标记用户确认', async () => {
    const proposal = { version: '1.0', production_plan: { render_runtime: 'remotion' } }
    const run = makeRun('proposal', { proposal })
    const engine = makeEngine(run)
    const result = await gates.approveStageGate(engine, 'run-1', { stage: 'proposal', renderRuntime: 'ffmpeg' })
    expect(result.success).toBe(true)
    expect(engine.calls.confirm).toHaveLength(1)
    const patch = engine.calls.confirm[0].contextPatch
    expect(patch.proposal.production_plan.render_runtime).toBe('ffmpeg')
    expect(patch.proposal.metadata.render_runtime_selection).toBe('ffmpeg')
    expect(patch.proposal.metadata.render_runtime_source).toBe('user_confirmed')
    expect(patch.approval_proposal.approved).toBe(true)
  })

  it('G1 未显式给渲染引擎 ⇒ 拒绝（禁止静默默认）', async () => {
    const run = makeRun('proposal', { proposal: { version: '1.0' } })
    const engine = makeEngine(run)
    const result = await gates.approveStageGate(engine, 'run-1', { stage: 'proposal' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('INVALID_RENDER_RUNTIME')
    expect(engine.calls.confirm).toEqual([])
  })

  it('G1 渲染引擎取值非法 ⇒ 拒绝', async () => {
    const run = makeRun('proposal', { proposal: { version: '1.0' } })
    const engine = makeEngine(run)
    const result = await gates.approveStageGate(engine, 'run-1', { stage: 'proposal', renderRuntime: 'webgl' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('INVALID_RENDER_RUNTIME')
  })

  it('非 G1 门批准不需要渲染引擎', async () => {
    const run = makeRun('script', { script: { version: '1.0' } })
    const engine = makeEngine(run)
    const result = await gates.approveStageGate(engine, 'run-1', { stage: 'script', note: 'ok' })
    expect(result.success).toBe(true)
    expect(engine.calls.confirm[0].contextPatch.approval_script.approved).toBe(true)
  })

  it('G1 缺 proposal 产物 ⇒ 拒绝（不写空产物覆盖真值）', async () => {
    const run = makeRun('proposal', {})
    const engine = makeEngine(run)
    const result = await gates.approveStageGate(engine, 'run-1', { stage: 'proposal', renderRuntime: 'remotion' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('MISSING_PROPOSAL_ARTIFACT')
  })
})

describe('审批门 · 契约锁（防止机制悄悄退化）', () => {
  it('pipeline-engine.js 的五门 checkpointRequired 为 true，非门阶段仍为 false', () => {
    const src = readRepoFile('apps/desktop/electron/services/pipeline-engine.js')
    const stageBlock = (name) => {
      const idx = src.indexOf(`name: '${name}',`)
      expect(idx, `找不到阶段 ${name}`).toBeGreaterThan(-1)
      const slice = src.slice(idx, idx + 400)
      const match = slice.match(/checkpointRequired:\s*(true|false)/)
      expect(match, `阶段 ${name} 没有 checkpointRequired 字段`).toBeTruthy()
      return match[1] === 'true'
    }
    for (const name of ['proposal', 'script', 'scenes', 'assets', 'publish']) {
      expect(stageBlock(name), `${name} 门应当 checkpointRequired=true`).toBe(true)
    }
    for (const name of ['research', 'editing', 'compose']) {
      expect(stageBlock(name), `${name} 不该是门`).toBe(false)
    }
  })

  it('pipelineEngine._runs 的跨模块访问只允许出现在本模块（pipeline-engine.js 处于零容差点名还账清单）', () => {
    // ⚠ 判据只认**具体访问形态** `pipelineEngine._runs`：
    //   仓内既有文件（如 full-auto-pipeline.js）有自己的 `this._runs`，
    //   用「_runs 与 pipelineEngine 两个词分别出现」判会误报（误报比漏报更贵）。
    // ⚠ 扫之前**剥注释**：注释里提到这个形态也算命中（写注释时要知道自己在给判据喂输入）。
    const ACCESS_RE = /\bpipelineEngine\s*\.\s*_runs\b/
    const root = path.join(REPO_ROOT, 'apps/desktop/electron')
    const ALLOWED = new Set([
      path.join(root, 'services/pipeline-engine.js'),
      path.join(root, 'services/explainer/explainer-approval-gates.js'),
    ])
    const offenders = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          walk(full)
          continue
        }
        if (!entry.name.endsWith('.js')) continue
        // 测试文件本来就可以直接访问引擎实例的私有成员（它们就是在测它）⇒ 不纳入本锁的域
        if (entry.name.endsWith('.test.js')) continue
        if (ALLOWED.has(full)) continue
        const code = stripComments(fs.readFileSync(full, 'utf8'))
        if (ACCESS_RE.test(code)) offenders.push(full)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
    // 反向断言：本模块**确实**访问了它 —— 否则「访问被悄悄删掉，锁仍然绿」。
    const moduleSrc = fs.readFileSync(ALLOWED.values().next().value === path.join(root, 'services/pipeline-engine.js')
      ? path.join(root, 'services/explainer/explainer-approval-gates.js')
      : path.join(root, 'services/explainer/explainer-approval-gates.js'), 'utf8')
    expect(ACCESS_RE.test(stripComments(moduleSrc))).toBe(true)
  })

  it('locale 的 focus / autoChecks 条数与 GATE_DEFS 逐条对应（中英文各自成对）', () => {
    const countSection = (text, section, stage) => {
      const anchor = text.indexOf(`${section}: {`)
      expect(anchor, `locale 缺少 ${section}`).toBeGreaterThan(-1)
      const stageIdx = text.indexOf(`${stage}: [`, anchor)
      expect(stageIdx, `locale ${section} 缺少 ${stage}`).toBeGreaterThan(-1)
      const end = text.indexOf(']', stageIdx)
      const body = text.slice(stageIdx, end)
      return (body.match(/^\s*'/gm) || []).length
    }
    for (const lang of ['zh', 'en']) {
      const text = readRepoFile(`apps/desktop/src/locales/pipelines/${lang}.js`)
      for (const [stage, def] of Object.entries(gates.GATE_DEFS)) {
        expect(countSection(text, 'focus', stage), `${lang} focus.${stage} 条数`).toBe(def.reviewFocus.length)
        expect(countSection(text, 'autoChecks', stage), `${lang} autoChecks.${stage} 条数`).toBe(def.autoChecks.length)
      }
    }
  })

  it('渲染层默认审批模式是 none（零回归：默认不打断既有「一键出片」）', () => {
    const src = readRepoFile('apps/desktop/src/views/CreateView.vue')
    expect(/explainerApprovalMode:\s*'none'/.test(src)).toBe(true)
  })
})
