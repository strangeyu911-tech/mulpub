'use strict';

/**
 * Container setup 分片：复合自动化工作流 + 自动化任务调度器（2026-10-26）
 *
 * 为什么从 container.setup.js 拆出来：主表已逼近 500 行硬限，而工作流需要
 * workflowRuntime / runner / queue / service 四个共享同一 store 的注册项。
 * 与 creator 分片同一处方：拆兄弟模块，不 `--update` 挂账。
 *
 * 注册顺序有依赖（容器惰性求值，get 未注册名会抛）：
 *   workflowRuntime → workflowRunner / workflowQueue → workflowService
 *   automationScheduler 依赖 workflowRunner + fullAutoPipeline
 */

function registerWorkflowServices(container) {
  // 四者必须共享同一个 workflowRuntime 实例：分别 get 会让账本/队列各建一份，
  // 去重与「到点派发」立即失效。
  container.register('workflowRuntime', function(c) {
    const { createWorkflowRuntime } = require('../services/workflow-runtime');
    return createWorkflowRuntime({
      store: c.get('store'),
      log: c.get('logger'),
      hotTopicsService: c.get('hotTopicsService'),
      creatorStore: c.get('creatorStore'),
      rewriteEngineService: c.get('rewriteEngineService'),
      pythonBridge: c.get('pythonBridge'),
      pipelineEngine: c.get('pipelineEngine'),
      taskQueue: c.get('taskQueue'),
      urlCollector: c.get('urlCollector'),
      podcastHostProvider: () => {
        const host = require('../services/podcast-episode-host');
        return typeof host.getSharedEpisodeHost === 'function' ? host.getSharedEpisodeHost() : null;
      },
    });
  });
  container.register('workflowRunner', function(c) { return c.get('workflowRuntime').runner });
  container.register('workflowQueue', function(c) { return c.get('workflowRuntime').queue });
  container.register('workflowService', function(c) {
    const { createWorkflowService } = require('../services/workflow-service');
    return createWorkflowService({
      store: c.get('store'),
      runner: c.get('workflowRunner'),
      queue: c.get('workflowQueue'),
    });
  });
  // 自动化任务调度器（2026-10-03）：定时 / 应用启动触发，后台执行。
  // 执行器复用 fullAutoPipeline；通知出口由 bootstrap 用 setNotify 注入。
  container.register('automationScheduler', function(c) {
    const { AutomationScheduler } = require('../services/automation-scheduler');
    return new AutomationScheduler({
      log: c.get('logger'),
      store: c.get('store'),
      pipeline: c.get('fullAutoPipeline'),
      workflowRunner: c.get('workflowRunner'),
    });
  });
}

module.exports = { registerWorkflowServices };
