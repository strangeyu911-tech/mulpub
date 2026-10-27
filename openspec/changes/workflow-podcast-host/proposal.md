# Proposal: 播客宿主下沉（P1-13）

## Why

复合工作流的播客出期通过 `podcastHostProvider` 取 `podcast-episode-host` 的 shared host；shared host 只在播客页 IPC handler 的 `getEpisodeHost()` 第一次被调用时登记。用户不先打开播客页，工作流播客任务会报「宿主未初始化」。

## What Changes

- `podcast-episode-host.js` 提供 `setSharedEpisodeHostFactory` / `getSharedEpisodeHost`：handler 登记惰性工厂，工作流侧通过 service 读取；同源重复登记允许，第二个来源拒绝。
- `ipc-handlers/podcast.js` 在注册时登记 `getEpisodeHost` 工厂（仍惰性构造）。
- `container.setup.workflow.js` 的 `podcastHostProvider` 继续从 service 取 `getSharedEpisodeHost()`，不直接依赖 IPC 模块。
- 仍复用**同一个**宿主实例（频道忙标记/取消登记不分裂）；播客页手动出期与工作流出期互斥不变。

## Non-goals

- 不改变播客出期链、计费确认闸门、频道锁语义。
- 不在应用启动时立即构造宿主（会提前解析 ffmpeg/ffprobe，打包前可能不存在）；保持惰性。
- 不做无频道配置的自动建频道。

## Impact

- 工作流播客任务无需先访问播客页。
- 若频道/托管未配置，宿主仍返回可操作错误（与之前一致）。
- shared host 只构造一次，手动/工作流互斥。
