# Design: 播客宿主下沉

## 1. 问题链

```
workflow-runtime.createPodcast
  → deps.podcastHostProvider()
  → getSharedEpisodeHost()   // 只有播客页 getEpisodeHost() 调过才非 null
```

## 2. 方案

`podcast-episode-host.js`：

```js
let sharedEpisodeHost = null
let sharedHostFactory = null
function setSharedEpisodeHostFactory (factory) {
  if (sharedHostFactory && sharedHostFactory !== factory) return false
  sharedHostFactory = factory
  return true
}
function getSharedEpisodeHost () {
  if (!sharedEpisodeHost && sharedHostFactory) sharedEpisodeHost = sharedHostFactory()
  return sharedEpisodeHost
}
```

`podcast.js`：注册时调用 `setSharedEpisodeHostFactory(getEpisodeHost)`，并保留模块导出供测试/兼容。
`container.setup.workflow.js`：provider 只 require service，调用 `getSharedEpisodeHost()`，不直接依赖 IPC 模块。

## 3. 时序

1. 应用启动注册 IPC handlers → `sharedGetEpisodeHost` 被赋值（不构造宿主）。
2. 工作流跑播客 → provider 调 `getEpisodeHost()` → 首次构造 host，登记 shared host。
3. 播客页后续手动出期 → 复用同一 host（频道忙标记/取消互斥）。

## 4. 失败

| 场景 | 行为 |
| --- | --- |
| handlers 尚未注册 | provider 返回 null，runtime 报宿主未初始化 |
| 频道/托管未配置 | host 返回既有可操作错误 |
| 构造 host 抛错 | provider 抛错，runtime 包装为播客发布失败，不静默 |

## 5. 测试

- `podcast.test.js`：模块导出 `getEpisodeHost` 且调用不抛。
- 现有 podcast IPC/出期测试保持通过。
- QM-1：确认打包后 require 链可用。
