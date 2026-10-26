# Design: 复合型全自动化工作流（auto-workflow-composer）

## 1. 分层

```
渲染层  AutomationView / AutomationTaskDialog / WorkflowEditor / WorkflowRunsDrawer
   │ IPC automation:templates:* / automation:preview-plan / automation:runs:*
主进程  workflow-service（模板/预览/运行门面）
        workflow-runner（运行编排，纯依赖注入）
        workflow-source（来源归一化）
        workflow-plan（节奏/护栏/去重键，纯函数）
        workflow-ledger（去重账本，settings 持久化）
        workflow-publish-queue（到点派发，settings 持久化）
        workflow-runtime（把现有服务适配成 runner 依赖）
        workflow-schema（配置契约与内置模板，纯函数）
   │
现有服务 hotTopicsService / creatorStore / ZhihuFavlistService / rewriteEngineService /
        urlCollector / pipelineEngine / podcast-episode-host / taskQueue
```

## 2. 关键决策

### D1 扩展现有 AutomationTask，而不是新实体

复用触发器、失败策略、任务列表、后台通知与 owner/生命周期；只把 `action` 从「自由 config」升级为「强校验 config」。避免两套调度器。

### D2 运行 = 运行 → 条目，而不是「一条流水线」

用户示例天然是多条内容。条目级状态机让「第 3 条失败不影响第 4 条」「跳过重复条目」「单条重试」可落地。

### D3 去重必须先于生成

视频生成 3–30 分钟、TTS 计费；先花完钱再发现是旧文是最坏的形态。账本命中在 `processItem` 第一步。

### D4 双键去重

来源键（`sourceType:platform:externalId` → url → 标题）+ 内容指纹（标题+正文 SHA-256）。理由：URL 会带参数变化，标题会被改；单键都会漏。

### D5 发布节奏 = 按平台+账号的随机窗口

`createPacer` 维护每个 target 的 `lastAt`；`gap = randInt(min,max)`；`at = max(lastAt+gap, now)`。不同 target 独立，因此平台间并行、账号内串行。预览按下限估算。

### D6 为什么不用 scheduler.create

平台侧定时注册表只有头条 `api` 模式取证通过；其余 14 个平台 `unsupported`，`assertSchedulableInput` 会在创建时抛错。工作流改用本地持久队列，到点调用 `taskQueue.add`（与 `publish:batch` 同通道，自动受 `PublishIntervalGuard` 保护）。代价是应用需常驻，已在 UI 明示并做 24h 补发。

### D7 播客共享出期宿主

`podcast-episode-host` 持有频道忙标记与取消登记。工作流另建实例会导致「工作流出期时手动又出一次」。通过模块级 `setSharedEpisodeHost/getSharedEpisodeHost` 复用；播客页惰性创建时登记。未初始化时给可操作错误。

### D8 视频流水线白名单

只允许文案可直接启动的 7 条（story2video-compose / animated-explainer / documentary-montage / animation / avatar-spokesperson / character-animation / hybrid）。素材型流水线（talking-head / cinematic / clip-factory / localization-dub / podcast-repurpose）不进下拉框，避免「保存成功、运行才发现跑不起来」。

### D9 fail-closed 的持久化

账本/队列 JSON 损坏时拒绝写入并返回 `ledger-unreadable`/`queue-unreadable`，绝不覆盖原值。运行直接失败并提示，而不是带着失明的去重继续发。

### D10 模板只存配置

不存账号凭证；`accountId` 空 = 平台默认账号。导出 JSON 显式 `version:1`，导入重新校验。

## 3. 数据结构

见 PRD §4（任务/配置/运行/队列/账本/模板）。

## 4. 并发与超时

- 同一任务不并发（沿用 AutomationScheduler `_running`）。
- 条目串行处理；视频生成单条最长 30 分钟；队列 tick 30 秒。
- 工作流运行本身受 AutomationScheduler 30 分钟硬超时；视频多条时可能触顶（P1 需改为运行与发布解耦、后台续跑）。

## 5. 失败与恢复

| 场景 | 行为 |
|------|------|
| 来源失败 | warning + 空结果；全空且有 warning → run=failed |
| 单条改写/生成失败 | 按 retryPerItem 重试；耗尽后 skip 或 abort |
| 账本不可读 | 立即失败，零发布 |
| 队列不可读 | 新增排期失败，原文件保留 |
| 应用重启 | 队列 tick：24h 内补发并标 late；超过标 missed |
| 队列派发失败 | 3 次后 failed，保留错误 |
| 审核未通过 | 不写账本，不排期 |

## 6. 安全

- 不新增出站请求；复用现有服务与其 SSRF/限流保护。
- 日志不打印 Access Secret；错误信息只保留可展示文案。
- 模板导入不执行任何代码，只做 JSON 解析 + 字段校验。
