# Spec: workflow-podcast-host

## ADDED Requirements

### Requirement: 工作流播客宿主无需先打开播客页

podcast IPC 注册时必须把惰性 host 工厂登记到 `podcast-episode-host` service；工作流通过 service 的 `getSharedEpisodeHost()` 取得宿主。

#### Scenario: 未访问播客页
- **WHEN** 应用启动后直接运行播客工作流
- **THEN** `getSharedEpisodeHost()` 调用已登记工厂构造宿主
- **AND** 出期继续，不报「宿主未初始化」

#### Scenario: 手动出期复用
- **WHEN** 播客页随后手动出期
- **THEN** 复用同一宿主实例
- **AND** 频道忙标记/取消登记不分裂

#### Scenario: 第二个工厂
- **WHEN** 另一个模块尝试登记不同工厂
- **THEN** 返回 false，不替换已有 shared host 来源

### Requirement: 惰性构造

不得在应用启动时立即构造宿主（media tool 路径可能尚不存在）。

#### Scenario: 启动
- **THEN** 注册 IPC 只登记工厂，不解析 ffmpeg/ffprobe
