// @ts-check
/**
 * pipeline-stage-registrars.js — 流水线阶段注册器的**单一真源**（2026-10-26）
 *
 * 背景：
 *   接线完整性回归锁最初在测试里手工镜像 `container.setup.js` 的一串
 *   `registerXStages(engine)` 调用，再用正则读源码比对。两层都脆弱：
 *   生产新增/删除注册器、或调用被改写成多行，正则就可能漏读，测试仍然绿。
 *
 * 现在把「注册器清单 + 注册动作」收敛到本模块：
 *   - `container.setup.js` 只调用 `registerAllPipelineStages(engine)`；
 *   - `electron/tests/pipeline-executor-wiring.test.js` 直接 import 同一份
 *     `PIPELINE_STAGE_REGISTRARS`，不再镜像、不再正则解析源码。
 *
 * 顺序契约：`story2video` 保持在最前（与历史 container.setup.js 的调用顺序一致）。
 * 注册顺序不影响 StageExecutor 的 Map 查找，只影响启动日志的排列，便于对照。
 *
 * 新增流水线阶段模块时**只需要改这一个文件**，生产与回归锁同时生效。
 */

'use strict'

const { registerStory2VideoStages } = require('./story2video-stages')
const { registerExplainerStages } = require('./explainer-stages')
const { registerClipFactoryStages } = require('./clipfactory-stages')
const { registerCinematicStages } = require('./cinematic-stages')
const { registerSmokeTestStages } = require('./smoketest-stages')
const { registerTalkingHeadStages } = require('./talkinghead-stages')
const { registerDocumentaryStages } = require('./documentary-stages')
const { registerLocalizationStages } = require('./localization-stages')
const { registerVideoGenStages } = require('./videogen-stages')
const { registerPodcastRepurposeStages } = require('./podcast-repurpose-stages')
const { registerFilmEngineeringStages } = require('./film-engineering/film-engineering-stages')
const { registerFilmVideoStages } = require('./film-engineering/video-gen')
const { registerFilmRenderStage } = require('./film-engineering/film-render')

/**
 * 生产注册器清单（顺序即注册顺序）。
 * 新增项必须同时保证对应 `*-stages.js` 导出了 `registerXxxStages(pipelineEngine)`。
 */
const PIPELINE_STAGE_REGISTRARS = Object.freeze([
  { name: 'story2video', register: registerStory2VideoStages },
  { name: 'explainer', register: registerExplainerStages },
  { name: 'clip-factory', register: registerClipFactoryStages },
  { name: 'cinematic', register: registerCinematicStages },
  { name: 'framework-smoke', register: registerSmokeTestStages },
  { name: 'talking-head', register: registerTalkingHeadStages },
  { name: 'documentary-montage', register: registerDocumentaryStages },
  { name: 'localization-dub', register: registerLocalizationStages },
  { name: 'videogen', register: registerVideoGenStages },
  { name: 'podcast-repurpose', register: registerPodcastRepurposeStages },
  { name: 'film-engineering', register: registerFilmEngineeringStages },
  { name: 'film-video', register: registerFilmVideoStages },
  { name: 'film-render', register: registerFilmRenderStage },
])

/**
 * 依次执行全部生产注册器。
 *
 * 失败策略：**继续注册其余模块并收集失败**，而不是首错即停——
 * 一次启动日志里应当能看见全部缺失，而不是修一个才看见下一个。
 *
 * @param {object} pipelineEngine - PipelineEngine 实例
 * @returns {Array<{name: string, error: string}>} 失败清单；空数组表示全部成功
 */
function registerAllPipelineStages(pipelineEngine) {
  const failures = []
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    // 只描述「执行器不可用」这个事实，不猜测根因（缺 ServiceBus / 构造未初始化 /
    // 执行器被移除都会走到这里），避免错误信息误导排查方向。
    return [{ name: '*', error: 'StageExecutor not available' }]
  }
  for (const { name, register } of PIPELINE_STAGE_REGISTRARS) {
    if (typeof register !== 'function') {
      failures.push({ name, error: 'register function missing' })
      continue
    }
    try {
      const result = register(pipelineEngine)
      if (result && result.success === false) {
        failures.push({ name, error: result.error || 'unknown error' })
      }
    } catch (e) {
      failures.push({ name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return failures
}

module.exports = { PIPELINE_STAGE_REGISTRARS, registerAllPipelineStages }
