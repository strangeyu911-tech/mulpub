// @vitest-environment node
// @ts-check
/**
 * explainer-gate-reuse.test.js —— 门批准后「复用已产出的产物，不重跑」
 *
 * ## 为什么需要这一层（P3 收口时由端到端复跑抓出）
 *
 * P3 给 explainer 的 5 个阶段开了人工审批门。门在**阶段产出之后**触发
 * （引擎 `_executeStage` 末尾），而 `confirmStageGate` 放行后走 `_autoAdvanceRun`
 * ⇒ **从当前阶段重跑**。实测后果（E2E 日志）：
 *
 *   ① **重复消耗**：assets 阶段完整生产了两遍（10 图 + 10 TTS × 2，各 12.8 秒）；
 *   ② **用户在 G1 门里的选择被冲掉**：`confirmStageGate` 把选中的
 *      `proposal.production_plan.render_runtime` 写回 `run.context.proposal`，
 *      而重跑 proposal 会用新的 LLM 输出**重新归一化**
 *      （`explainer-artifacts.js`：`plan.render_runtime = runtimeFromLlm || 'remotion'`）
 *      ⇒ 用户选的渲染引擎被重置成默认值
 *      ⇒ P3「选项写回产物本体 ⇒ 下游零改动自动生效」的设计**当场失效**。
 *
 * ## 为什么必须放在**执行器层**、不能放引擎层
 *
 * film-engineering 的 `film_generate_videos` 是**另一种门**（成本确认入口闸：
 * 第一次执行只产「等待态清单」、**零 provider 调用**，批准后**必须**重入才真生成）
 * ⇒ 引擎层「有产物就跳过」会让它**永远不生成视频**。
 * ⇒ 两种门语义并存 ⇒ 只能在 explainer 这一层区分。
 *
 * ## 与既有契约锁的分工
 *
 * `explainer-approval-gates.test.js` 的那条锁**点名** 5 个门阶段为 true、3 个非门为 false
 * ⇒ 本文件这条锁补上它的盲区：**「恰好」是这 5 个**（不多不少）
 * ⇒ 挡住「第 6 个阶段被悄悄设成人工门」。
 */

import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
// ESM 环境里 __dirname / __filename 不存在 ⇒ 显式补出（契约锁要用「本文件路径」排除自身）
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const stages = require('../explainer-stages')
const artifacts = require('./explainer-artifacts')
const { PipelineEngine } = require('../pipeline-engine')

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

/** 读 explainer 流水线的**运行时** stageDefs（真源，不是源码正则）。 */
function explainerStageDefs () {
  // getPipeline 只读模块级 PIPELINES 常量 ⇒ 不依赖实例状态
  const pl = PipelineEngine.prototype.getPipeline.call({}, 'animated-explainer')
  expect(pl, '取不到 animated-explainer 流水线定义').toBeTruthy()
  return pl.stageDefs
}

/** 造一个只记录注册表的假 pipelineEngine（用于拿「注册后的执行器」）。 */
function makeFakeEngine () {
  const registered = new Map()
  return {
    stageExecutor: {},
    log: { info () {}, warn () {}, error () {}, notify () {} },
    registered,
    registerStageExecutor (type, fn) { registered.set(type, fn) },
  }
}

describe('门批准后重入 ⇒ 复用已产出的产物（withGateReuse）', () => {
  it('gateCleared=true 且 context 已有该阶段产物 ⇒ 直接复用，不重跑执行器', async () => {
    const spy = vi.fn(async () => ({ success: true, output: { fresh: true } }))
    const wrapped = stages.withGateReuse(spy)
    const cached = { production_plan: { render_runtime: 'ffmpeg' } }
    const out = await wrapped({
      runId: 'r1',
      stage: { name: 'proposal', gateCleared: true },
      context: { proposal: cached },
    })
    expect(spy, '门批准后重入不得重跑执行器').not.toHaveBeenCalled()
    expect(out.success).toBe(true)
    // 引用相等 ⇒ 复用的就是产物本体（下游读点拿到的对象不变）
    expect(out.output).toBe(cached)
  })

  it('gateCleared=true 但 context 里没有该阶段产物 ⇒ 照常执行（不得误跳过）', async () => {
    const spy = vi.fn(async () => ({ success: true, output: { fresh: true } }))
    const wrapped = stages.withGateReuse(spy)
    await wrapped({
      runId: 'r1',
      stage: { name: 'proposal', gateCleared: true },
      context: {},
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('没有 gateCleared（首次执行 / 应用重启后断点续跑）⇒ 照常执行', async () => {
    const spy = vi.fn(async () => ({ success: true, output: { fresh: true } }))
    const wrapped = stages.withGateReuse(spy)
    await wrapped({
      runId: 'r1',
      stage: { name: 'proposal' },
      context: { proposal: { production_plan: { render_runtime: 'ffmpeg' } } },
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('G1 渲染引擎选择：门批准后重入不得把它冲掉', () => {
  it('归一化侧：proposal 缺 render_runtime 时会被补成默认的 remotion（= 重跑冲掉选择的那一半）', () => {
    const packet = artifacts.buildProposalPacket({
      concept_options: [{ id: 'c1', title: '主线' }],
      selected_concept: { concept_id: 'c1' },
      production_plan: {},
    }, {})
    expect(packet.production_plan.render_runtime).toBe('remotion')
  })

  it('复用路径：门批准时写回的 render_runtime 在重入后仍是用户选的值', async () => {
    // 门批准 ⇒ 用户在 G1 选了 ffmpeg ⇒ 写回 proposal 本体
    const afterApproval = { production_plan: { render_runtime: 'ffmpeg' } }
    // 若走重跑路径，产物会被重新归一化 ⇒ render_runtime 变回 'remotion'
    const rerunWouldProduce = { production_plan: { render_runtime: 'remotion' } }
    const spy = vi.fn(async () => ({ success: true, output: rerunWouldProduce }))

    const out = await stages.withGateReuse(spy)({
      runId: 'r1',
      stage: { name: 'proposal', gateCleared: true },
      context: { proposal: afterApproval },
    })

    expect(spy, '选了 ffmpeg 就不该再重跑 proposal').not.toHaveBeenCalled()
    expect(out.output.production_plan.render_runtime).toBe('ffmpeg')
  })
})

describe('注册路径：只有有门的阶段被包装（真实注册表）', () => {
  it('门阶段在注册后走复用短路；非门阶段不短路', async () => {
    const engine = makeFakeEngine()
    const res = stages.registerExplainerStages(engine)
    expect(res.success).toBe(true)

    // 门阶段（proposal）：gateCleared + context 有产物 ⇒ 复用
    const cached = { production_plan: { render_runtime: 'ffmpeg' } }
    const gateOut = await engine.registered.get('explainer_proposal')({
      runId: 'r1',
      stage: { name: 'proposal', gateCleared: true },
      context: { proposal: cached },
    })
    expect(gateOut.output, 'proposal 应当走复用短路').toBe(cached)

    // 非门阶段（research）：同样条件下**不**短路 ⇒ 真执行器跑了（没有 aiGenerator ⇒ 失败）
    const nonGateOut = await engine.registered.get('explainer_research')({
      runId: 'r1',
      stage: { name: 'research', gateCleared: true },
      context: { research: { topic: 'x' } },
    })
    expect(nonGateOut.success, 'research 不是门阶段 ⇒ 必须真执行（无 LLM 桩时应失败）').toBe(false)
    expect(nonGateOut.output).toBeUndefined()
  })
})

describe('契约锁（防止两处漂移）', () => {
  it('门阶段清单与运行时 stageDefs 里 checkpointRequired=true 的集合逐字一致', () => {
    const defs = explainerStageDefs()
    const nameByType = new Map(defs.map(d => [d.type, d.name]))
    const gateNames = stages.EXPLAINER_GATE_STAGE_TYPES.map(t => nameByType.get(t))
    expect(gateNames.every(Boolean), '门阶段清单里的 type 必须在 stageDefs 中存在').toBe(true)

    const runtimeGateNames = defs
      .filter(d => d.checkpointRequired === true)
      .map(d => d.name)
      .sort()

    // ⚠ 与 explainer-approval-gates.test.js 的分工：那条锁**点名** 5 个为 true、3 个为 false
    //   ⇒ 抓不到「第 6 个阶段被悄悄设成门」。本条锁「**恰好**是这 5 个」⇒ 补上该盲区。
    expect(gateNames.slice().sort()).toEqual(runtimeGateNames)
  })

  it('门阶段清单恰好 5 个（上游 human_approval_default: true 的阶段数）', () => {
    expect(stages.EXPLAINER_GATE_STAGE_TYPES.length).toBe(5)
  })

  it('withGateReuse 只在「刚被门放行」时短路（gateCleared 是唯一触发条件）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'apps/desktop/electron/services/explainer-stages.js'), 'utf8')
    // ⚠⚠ **只扫「代码行」**（行首 strip 后不以 * / // / /* 开头的行）。
    //   本文件里 explainer-stages.js 的**注释里也写着 `stage.gateCleared === true`**
    //   ⇒ 若直接对整份源码做 toMatch，**注释里的同形文本就能满足这条锁**
    //   ⇒ 实测：把代码行改成 `!== true` 后，未剥注释的锁仍绿 ⇒ 弱锁、变异打不死。
    //   ⇒ 判据的输入必须与被测对象的形状对齐（被测对象 = **代码行**）。
    const codeLines = src.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'))
      .join('\n')
    expect(codeLines).toMatch(/stage\.gateCleared\s*===\s*true/)
    // ⚠ 反向断言：不得出现「无条件复用」或「按 checkpointPolicy 判断」之类的旁路条件
    expect(codeLines).not.toMatch(/checkpointPolicy/)
  })
})
