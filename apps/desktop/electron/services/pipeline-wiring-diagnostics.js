/**
 * 流水线接线诊断（从 pipeline-engine.js 抽出，控制单文件行数）。
 *
 * 2026-10-26 pipeline-executor-wiring：
 *   - `listUnwiredStageTypes(engine, pipelines)` 供 `PipelineEngine` 委托调用；
 *   - `buildPipelineDefinitions(pipelines)` 产出深克隆 + 深冻结的只读快照。
 */

const { describeStageType } = require('./stage-executor');

/**
 * 深克隆普通对象/数组（用于只读导出前隔离原引用）。
 * 只处理数组与普通对象；函数/原始值原样返回。
 * 带 WeakMap 环检测：遇到已访问对象返回克隆后的同一引用（保持环结构）。
 */
function cloneDeep(value, seen) {
  if (Array.isArray(value)) {
    const visited = seen || new WeakMap();
    if (visited.has(value)) return visited.get(value);
    const out = [];
    visited.set(value, out);
    value.forEach((item) => out.push(cloneDeep(item, visited)));
    return out;
  }
  if (value && typeof value === 'object') {
    const visited = seen || new WeakMap();
    if (visited.has(value)) return visited.get(value);
    const out = {};
    visited.set(value, out);
    Object.getOwnPropertyNames(value).forEach((key) => { out[key] = cloneDeep(value[key], visited) });
    return out;
  }
  return value;
}

/**
 * 递归冻结：对象/数组的每一层都 Object.freeze。
 * ⚠ 只对**已深克隆**的树使用，绝不能直接作用于生产对象。
 * 带 WeakSet 环检测，避免环状结构导致栈溢出。
 */
function deepFreeze(value, seen) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    const visited = seen || new WeakSet();
    if (visited.has(value)) return value;
    visited.add(value);
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key], visited));
    Object.freeze(value);
  }
  return value;
}

/** 深克隆 + 深冻结的只读流水线定义快照。 */
function buildPipelineDefinitions(pipelines) {
  return deepFreeze(cloneDeep(pipelines));
}

/**
 * 列出「stageDefs 引用了、但执行器未注册」的阶段。
 * 空数组才表示全部内置流水线阶段均已接线；`stageExecutor` 未配置时返回
 * 单条 `pipeline='*'` 哨兵（`STAGE_EXECUTOR_NOT_CONFIGURED`），绝不返回空数组。
 */
function listUnwiredStageTypes(engine, pipelines) {
  const executorReady = Boolean(
    engine.stageExecutor && typeof engine.stageExecutor.hasExecutor === 'function'
  );
  if (!executorReady) {
    return [{
      pipeline: '*',
      stage: '*',
      type: '*',
      reason: 'STAGE_EXECUTOR_NOT_CONFIGURED',
    }];
  }
  const unwired = [];
  const inspect = (pipeline) => {
    // stageDefs 缺失（undefined）= 显式占位流水线（如 screen-demo），跳过；
    // 存在但不是数组 = 配置损坏，必须上报。
    if (pipeline.stageDefs === undefined) return;
    if (!Array.isArray(pipeline.stageDefs)) {
      unwired.push({
        pipeline: pipeline.name,
        stage: '*',
        type: describeStageType(pipeline.stageDefs),
        reason: 'INVALID_STAGE_DEFS_FORMAT',
      });
      return;
    }
    for (const stage of pipeline.stageDefs) {
      // 无 type 字段是旧流水线的正常形态（按 MANUAL_CHECKPOINT 处理），跳过；
      // type 存在但不是非空字符串 = 配置错误，必须进诊断。
      if (!stage || stage.type === undefined) continue;
      if (typeof stage.type !== 'string' || !stage.type) {
        unwired.push({
          pipeline: pipeline.name,
          stage: stage.name,
          type: describeStageType(stage.type),
          reason: 'INVALID_STAGE_TYPE',
        });
        continue;
      }
      if (!engine.stageExecutor.hasExecutor(stage.type)) {
        unwired.push({ pipeline: pipeline.name, stage: stage.name, type: stage.type });
      }
    }
  };
  pipelines.forEach(inspect);
  if (engine._customPipelines) {
    Array.from(engine._customPipelines.values()).forEach(inspect);
  }
  return unwired;
}

module.exports = { buildPipelineDefinitions, listUnwiredStageTypes };
