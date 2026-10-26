// @ts-check
/**
 * pipeline-executor-wiring.test.js — 视频创作流水线「阶段执行器接线完整性」回归锁
 *
 * ## 背景（2026-10-26）
 *
 * `StageExecutor.execute()` 过去对**未注册**的 stage.type 静默降级：
 *   `return { success: true, output: null, checkpoint: true }`
 * 于是只要某条流水线的 stageDefs 引用了没有接线的阶段类型，整条流水线会
 * 「成功结束但什么都没做」，而所有既有测试仍然是绿的。
 *
 * ## 本文件锁三件事
 *
 * 1. `PIPELINE_DEFINITIONS` 中每条带 stageDefs 的流水线，其每个 `stage.type`
 *    都必须被 `container.setup.js` 使用的**同一批** registerXStages 注册到执行器集合；
 * 2. `PipelineEngine.listUnwiredStageTypes()` 对所有内置流水线返回空数组；
 * 3. 未知 stage.type 必须 **失败**（`errorCode = PIPELINE_STAGE_EXECUTOR_MISSING`），
 *    不得再静默成功；而 `manual_checkpoint` 仍按原语义成功。
 *
 * ## 为什么用真实注册器而不是 mock
 *
 * 「接线完整性」测的是**生产装配函数的副作用**。用 mock 执行器等于把被测对象换掉，
 * 只能证明测试自己会注册。这里调用的是 container.setup.js 里逐字相同的一批
 * registerXStages，并在装配完成后向真实 StageExecutor 查询已注册类型。
 */

'use strict'

import { describe, it, expect } from 'vitest'

const { PipelineEngine, PIPELINE_DEFINITIONS } = require('../services/pipeline-engine')
const { STAGE_TYPES } = require('../services/stage-executor')
// 单一真源（2026-10-26）：生产装配与回归锁共用同一份注册器清单，
// 不再测试内镜像 container.setup.js、也不再正则解析源码。
const { PIPELINE_STAGE_REGISTRARS, registerAllPipelineStages } = require('../services/pipeline-stage-registrars')

function createQuietLog () {
  return { info () {}, warn () {}, error () {}, debug () {} }
}

/** 创建一个带真实 StageExecutor 的 PipelineEngine（serviceBus 只需非空）。 */
function createEngine () {
  return new PipelineEngine({ serviceBus: {}, log: createQuietLog() })
}

/** 调用全部生产注册器；任一注册器返回失败即收集（不静默吞掉）。 */
function registerAllProductionStages (engine) {
  return registerAllPipelineStages(engine).map(({ name, error }) => name + ': ' + error)
}

describe('视频创作流水线 — 阶段执行器接线完整性', () => {
  it('PIPELINE_DEFINITIONS 已导出且覆盖全部内置流水线', () => {
    expect(Array.isArray(PIPELINE_DEFINITIONS)).toBe(true)
    const names = PIPELINE_DEFINITIONS.map((pipeline) => pipeline.name)
    // 15 条内置定义（screen-demo 为「开发中」占位，无 stageDefs；video-clone 走独立 IPC 引擎）
    expect(names).toContain('story2video-compose')
    expect(names).toContain('film-engineering')
    expect(names).toContain('screen-demo')
    expect(names.length).toBeGreaterThanOrEqual(15)

    // 只读契约：导出是冻结快照，调用方改不动引擎正在使用的 PIPELINES 原件。
    expect(Object.isFrozen(PIPELINE_DEFINITIONS)).toBe(true)
    expect(Object.isFrozen(PIPELINE_DEFINITIONS[0])).toBe(true)
    expect(Object.isFrozen(PIPELINE_DEFINITIONS[0].stageDefs)).toBe(true)
    expect(Object.isFrozen(PIPELINE_DEFINITIONS[0].stageDefs[0])).toBe(true)
  })

  it('每条带 stageDefs 的流水线，其 stage.type 均已被生产注册器接线', () => {
    const engine = createEngine()
    const failures = registerAllProductionStages(engine)
    expect(failures).toEqual([])

    const registered = new Set(engine.stageExecutor.listExecutorTypes())
    const missing = []
    for (const pipeline of PIPELINE_DEFINITIONS) {
      const defs = Array.isArray(pipeline.stageDefs) ? pipeline.stageDefs : []
      for (const stage of defs) {
        if (!stage || typeof stage.type !== 'string') continue
        if (!registered.has(stage.type)) {
          missing.push(pipeline.name + '.' + stage.name + ' → ' + stage.type)
        }
      }
    }
    // 失败时把缺失清单原样打印，便于一眼定位是哪条流水线断了
    expect(missing, '未接线的阶段类型:\n' + missing.join('\n')).toEqual([])
  })

  it('PipelineEngine.listUnwiredStageTypes() 对全部内置流水线返回空数组', () => {
    const engine = createEngine()
    const failures = registerAllProductionStages(engine)
    expect(failures).toEqual([])

    const unwired = engine.listUnwiredStageTypes()
    expect(Array.isArray(unwired)).toBe(true)
    expect(unwired).toEqual([])
  })

  it('stageExecutor 未配置时返回单条哨兵，而不是空数组或逐阶段假阳性', () => {
    const engine = new PipelineEngine({ log: createQuietLog() })
    expect(engine.stageExecutor).toBeFalsy()

    const unwired = engine.listUnwiredStageTypes()
    expect(unwired).toHaveLength(1)
    // 形状必须与逐阶段诊断完全一致（pipeline/stage/type/reason），不附加额外字段。
    expect(unwired[0]).toEqual({
      pipeline: '*',
      stage: '*',
      type: '*',
      reason: 'STAGE_EXECUTOR_NOT_CONFIGURED',
    })
  })

  // 2026-10-26：type 存在但不是非空字符串（0/null/数组/对象）
  // 属于配置错误，必须进诊断；只有「完全没有 type 字段」才是旧流水线的合法形态。
  it('非法 stage.type 进入诊断，无 type 字段的旧阶段仍跳过', () => {
    const engine = createEngine()
    engine.registerPipeline({
      name: 'invalid-type-probe',
      description: '非法 type 诊断探针',
      category: 'custom',
      stages: ['bad', 'legacy'],
      stageDefs: [
        { name: 'bad', type: 0 },
        { name: 'legacy' },
      ],
    })
    const unwired = engine.listUnwiredStageTypes()
    const invalid = unwired.find((item) => item.pipeline === 'invalid-type-probe' && item.stage === 'bad')
    expect(invalid).toMatchObject({ type: '[non-string:number]', reason: 'INVALID_STAGE_TYPE' })
    expect(unwired.some((item) => item.pipeline === 'invalid-type-probe' && item.stage === 'legacy')).toBe(false)
  })

  // 变异反证自动化：不注册任何执行器，断言诊断覆盖全部 stageDefs 阶段。
  // 与注册器名称/拆分方式完全解耦：只要 PIPELINES 里还有阶段定义，
  // 未接线清单就必须非空且逐条出现，判据不可能恒绿。
  it('变异反证：完全不注册执行器时 listUnwiredStageTypes 必须覆盖全部非内置阶段', () => {
    const engine = createEngine()
    // 只有内置执行器（split/compose/publish 等）时，内置类型不算未接线；
    // 这里统计「必须由 registerXStages 提供」的阶段类型。
    const builtinTypes = new Set(engine.stageExecutor.listExecutorTypes())
    const expected = PIPELINE_DEFINITIONS.flatMap((pipeline) =>
      (Array.isArray(pipeline.stageDefs) ? pipeline.stageDefs : []).map((stage) => stage.type)
    ).filter((type) => typeof type === 'string' && type.length > 0 && !builtinTypes.has(type))

    const unwired = engine.listUnwiredStageTypes()
    expect(expected.length).toBeGreaterThan(0)
    expect(unwired.length).toBe(expected.length)
    expect(unwired.some((item) => item.pipeline === 'animation' && item.type === 'videogen_concept')).toBe(true)
    expect(unwired.some((item) => item.pipeline === 'hybrid' && item.type === 'videogen_merge')).toBe(true)
  })

  // container.setup.js 不得绕过单一真源直接调用 registerXStages(engine)：
  // 一旦有人把某行加回去，生产与回归锁就可能各自注册不同清单。
  // 这里直接读生产源码做结构锁（只允许 registerAllPipelineStages(engine)）。
  it('container.setup.js 不得绕过单一真源直接注册阶段', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(path.join(__dirname, '../core/container.setup.js'), 'utf8')
    const directCalls = Array.from(
      source.matchAll(/^\s*(register[0-9A-Za-z]+Stages|registerFilmRenderStage)\(engine\);/gm)
    ).map((match) => match[1])

    expect(directCalls).toEqual([])
    expect(source).toContain('registerAllPipelineStages(engine)')
    expect(source).toContain("require('../services/pipeline-stage-registrars')")
  })

  // 2026-10-26：注册器清单已收敛到
  // `electron/services/pipeline-stage-registrars.js`（生产与测试共用同一份）。
  // 本条只做结构自检：清单非空、无重复、每项都导出可调用函数。
  // 真正的「新增模块是否接线」由上面的 stageDefs 断言负责（新流水线无执行器即红）。
  it('注册器清单是单一真源：非空、无重复、每项均可调用', () => {
    expect(PIPELINE_STAGE_REGISTRARS.length).toBeGreaterThan(0)
    const names = PIPELINE_STAGE_REGISTRARS.map((item) => item.name)
    expect(new Set(names).size).toBe(names.length)
    for (const item of PIPELINE_STAGE_REGISTRARS) {
      expect(typeof item.register).toBe('function')
    }
  })

  it('未知阶段失败会经 PipelineEngine 落库为 run.status=failed，并保留 errorCode/errorParams', async () => {
    const engine = createEngine()
    engine.registerPipeline({
      name: 'wiring-failure-probe',
      description: '接线失败传播探针',
      category: 'custom',
      stages: ['ghost'],
      stageDefs: [{ name: 'ghost', type: 'definitely_not_registered_stage' }],
    })

    const start = await engine.startOrchestrated('wiring-failure-probe', { autoAdvance: false })
    expect(start.success).toBe(true)

    const executed = await engine.executeStage(start.runId)
    expect(executed.success).toBe(false)
    expect(executed.errorCode).toBe('PIPELINE_STAGE_EXECUTOR_MISSING')

    const snapshot = engine.getRunSnapshot(start.runId)
    expect(snapshot.status.status).toBe('failed')
    expect(snapshot.errorCode).toBe('PIPELINE_STAGE_EXECUTOR_MISSING')
    expect(snapshot.errorParams).toMatchObject({
      stageName: 'ghost',
      stageType: 'definitely_not_registered_stage',
    })
  })

  it('screen-demo 是显式「开发中」占位：允许没有 stageDefs（不按接线失败处理）', () => {
    const screenDemo = PIPELINE_DEFINITIONS.find((pipeline) => pipeline.name === 'screen-demo')
    expect(screenDemo).toBeTruthy()
    expect(Array.isArray(screenDemo.stageDefs)).toBe(false)
    // 有 stages 清单但没有可执行阶段：listPipelines 需能把它标成 available=false
    const engine = createEngine()
    registerAllProductionStages(engine)
    const entry = engine.listPipelines().find((pipeline) => pipeline.name === 'screen-demo')
    expect(entry).toBeTruthy()
    expect(entry.available).toBe(false)
  })
})

describe('StageExecutor — 未知阶段类型必须 fail closed', () => {
  it('未知 stage.type 返回失败与稳定 errorCode，不再伪装成 manual_checkpoint 成功', async () => {
    const engine = createEngine()
    const result = await engine.stageExecutor.execute({
      runId: 'wiring-probe',
      stage: { name: 'ghost', type: 'definitely_not_registered_stage' },
      params: {},
      context: {},
    })

    expect(result.success).toBe(false)
    expect(result.checkpoint).not.toBe(true)
    expect(result.errorCode).toBe('PIPELINE_STAGE_EXECUTOR_MISSING')
    expect(result.messageParams).toMatchObject({
      stageName: 'ghost',
      stageType: 'definitely_not_registered_stage',
    })
    expect(String(result.error || '')).toContain('definitely_not_registered_stage')
  })

  // 空串 / 纯空白 / 数字 / null / 数组 / 对象等「显式写了 type 但不是合法字符串」
  // 的配置错误必须与「完全没有 type 字段」区分：前者 fail closed，后者才是旧流水线。
  it.each(['', '   ', 0, null, [], {}])('非法显式 type（%s）执行时 fail closed，不退回 manual_checkpoint', async (badType) => {
    const engine = createEngine()
    const result = await engine.stageExecutor.execute({
      runId: 'invalid-type-probe',
      stage: { name: 'bad', type: badType },
      params: {},
      context: {},
    })

    expect(result.success).toBe(false)
    expect(result.checkpoint).not.toBe(true)
    expect(result.errorCode).toBe('PIPELINE_STAGE_EXECUTOR_MISSING')
    expect(result.messageParams.stageName).toBe('bad')
  })

  // 循环引用对象无法 JSON.stringify：错误构造路径必须绝不抛异常（fail closed 优先于可读性）。
  it('循环引用对象作为 type 时仍返回失败，不抛异常', async () => {
    const circular = {}
    circular.self = circular
    const engine = createEngine()
    const result = await engine.stageExecutor.execute({
      runId: 'circular-type-probe',
      stage: { name: 'bad', type: circular },
      params: {},
      context: {},
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('PIPELINE_STAGE_EXECUTOR_MISSING')
    expect(typeof result.error).toBe('string')
  })

  it('显式 manual_checkpoint 仍按原语义成功（不误伤旧流水线）', async () => {
    const engine = createEngine()
    const result = await engine.stageExecutor.execute({
      runId: 'checkpoint-probe',
      stage: { name: 'review', type: STAGE_TYPES.MANUAL_CHECKPOINT },
      params: {},
      context: {},
    })

    expect(result.success).toBe(true)
    expect(result.checkpoint).toBe(true)
  })

  it('没有 type 字段的旧阶段仍按 manual_checkpoint 处理（向后兼容）', async () => {
    const engine = createEngine()
    const result = await engine.stageExecutor.execute({
      runId: 'legacy-probe',
      stage: { name: 'legacy-stage' },
      params: {},
      context: {},
    })

    expect(result.success).toBe(true)
    expect(result.checkpoint).toBe(true)
  })
})
