# PRD：复合型全自动化工作流（auto-workflow-composer）

> **文档版本**：v1.0（2026-10-26）
> **配置契约版本**：1（`workflow config schema v1`；字段增删需升版本并写迁移说明）
> **状态**：已实现（MVP）
> **关联 change**：`openspec/changes/auto-workflow-composer/`
> **关联代码**：
> - 主进程：`apps/desktop/electron/services/workflow-*.js`
> - 渲染层：`apps/desktop/src/features/automation/`、`apps/desktop/src/views/AutomationView.vue`
> - IPC：`apps/desktop/electron/ipc-handlers/automation.js`、`preload/automation.js`
> **前置文档**：`01-docs/PRD-AUTOMATION-CONTENT-CATEGORY-2026-10-03.md`（本期扩展其 `action` 配置面）

---

## 1. 背景与目标

### 1.1 现状

现有「自动化」模块已支持触发器（应用启动 / 每天 / 每周 / 每隔 N 分钟）、失败策略（跳过 / 中断）与「全自动流水线」动作。但该动作的 `config` 是自由对象：只能表达 URL / RSS 采集 → 改写 → 创作 → 发布，无法回答用户真正要问的六件事：

1. 内容从哪来（热门选题？关注博主？知乎收藏夹？抖音爆款？）
2. 怎么改写（默认策略还是指定策略）
3. 产出什么（图文 / 视频 / 播客）
4. 视频走哪条流水线
5. 同账号批量发布之间隔多久
6. 发到哪几个已添加账号

### 1.2 目标

把上述六段拼成一个**可保存、可复用、可审计**的复合工作流：

- 一次配置 → 定时或手动触发 → 自动采集 → 去重 → 改写 → 生成 → 按节奏排期 → 到点发布；
- 每条内容独立状态、独立失败、独立重试；
- 内置模板覆盖典型场景，支持另存为「我的模板」与导入/导出；
- 所有「少跑了 / 没发出去 / 被跳过」都有可读原因，不静默。

### 1.3 非目标（本期不做）

| 不做 | 原因 |
|------|------|
| 抖音爆款来源 | 仓库内无该数据源，`viral_library` 也没有「行业」维度；先隐藏，P1 再做 |
| 自由画布式 DAG 编排 | 六段线性流水线已覆盖目标场景；画布会把校验、状态机、UI 成本放大一个量级 |
| 云端调度 | 工作流依赖本机浏览器会话（RPA）与本地模型配置；云端无法执行 |
| 同平台多账号分别配置节奏 | **已支持**：发布目标按「平台 + accountId」去重，每个账号独立排队与节奏；不再回落平台默认账号 |
| 平台侧定时（除头条） | 平台侧定时能力注册表当前只有头条取证通过；其余平台走本地持久队列（见 §7.6） |

---

## 2. 用户故事

1. 作为自媒体运营者，我想把「知乎某个收藏夹里的新文章」自动做成「故事讲述视频」，按 35–40 分钟间隔批量发到 B站/抖音/视频号/YouTube，这样我每天不用手动搬运。
2. 作为内容编辑，我想让「关注博主的新作品」自动改写成图文发到知乎/微博，并且已经发过的不要重复发。
3. 作为内容负责人，我想把一套配置存成模板，导出给同事导入，模板里不能带我的账号凭证。
4. 作为谨慎的用户，我想在第一次跑新模板时先审核一条，确认没问题再全自动。
5. 作为成本敏感的用户，我想限制每次最多跑几条、每天最多几条，超了就停并告诉我原因。

---

## 3. 功能范围

### 3.1 P0（本期）

- 来源：热门选题（11 类、最新/热度排序、最多 30 条）、关注博主（最多 50 个 follow、每位最多 20 条）、知乎收藏夹（最多 20 个夹、每次最多 50 条）
- 改写：默认策略 / 指定策略（策略列表来自 `rewriteEngineService.listStrategies()`）
- 内容类型：图文 / 视频 / 播客（RSS）
- 视频流水线：仅「文案可直接启动」的 7 条
- 发布账号：从「账号管理」里已添加的自媒体账号中多选，支持同平台多个账号、跨平台自由组合；每个账号按 `platform + accountId` 独立排队，不回落平台默认账号
- 节奏：同账号 5–1440 分钟随机区间（默认 35–40），不同账号/平台可并行
- 发布时机：立即排队 / 指定起发时间
- 模板：5 个内置只读模板 + 自定义模板（最多 50 个）+ 导出/导入 JSON
- 去重：来源键 + 内容指纹双键，180 天 / 5000 条账本
- 护栏：单次最多 50、每日最多 200、单条重试 0–3
- 审核：工作流级开关；打开后生成完停在 `awaiting_review`，运行记录里「确认发布」
- 运行记录：最近 50 次，条目级状态与错误
- 失败策略：skip / abort（沿用现有任务级配置）

### 3.2 P1（后续）

- 抖音爆款来源（需先定义数据源与行业枚举）
- 博主发现项状态回写（本期保持 `pending`，靠账本去重）
- 模板市场/团队共享（本期只有 JSON 导入导出）

---

## 4. 数据模型

### 4.1 AutomationTask（扩展现有）

```jsonc
{
  "id": "at_...",
  "name": "收藏夹 → 故事视频",
  "enabled": true,
  "triggers": [{ "type": "daily", "time": "09:00" }],
  "action": {
    "type": "compositeWorkflow",      // 新增；旧任务仍为 fullAutoPipeline
    "config": { /* 见 4.2 */ }
  },
  "failurePolicy": "skip",            // skip | abort
  "maxRetries": 1,                    // 整条工作流重跑次数 0-3
  "concurrency": "background",
  "lastRunAt": "...",
  "lastStatus": "completed",
  "lastError": ""
}
```

### 4.2 WorkflowConfig

```jsonc
{
  "source": {
    "type": "zhihuFavlist",           // hotTopics | creatorMonitor | zhihuFavlist
    "categories": [],                  // hotTopics 专用，11 类多选
    "limit": 10,                       // hotTopics 1-30 / zhihu 1-50
    "sort": "latest",                  // latest | score
    "followIds": [],                   // creatorMonitor 专用
    "perCreatorLimit": 3,              // 1-20
    "folderTokens": ["token"]          // zhihuFavlist 专用
  },
  "rewrite": {
    "mode": "default",                 // default | strategy
    "strategyId": "",
    "length": "keep"                   // keep | shorten | expand
  },
  "content": {
    "type": "video",                   // article | video | podcast
    "videoPipeline": "story2video-compose",
    "podcastChannelId": ""
  },
  "publish": {
    "targets": [{ "platform": "bilibili", "accountId": "" }],
    "mode": "immediate",               // immediate | scheduled
    "startAt": ""                      // scheduled 时必填，未来 30 天内
  },
  "cadence": { "minMinutes": 35, "maxMinutes": 40 },
  "guardrails": { "maxItemsPerRun": 5, "dailyItemLimit": 20, "retryPerItem": 1 },
  "review": { "requireApproval": false },
  "dedupe": { "enabled": true }
}
```

### 4.3 WorkflowRun（持久化键 `workflow_runs`，最多 50 条）

```jsonc
{
  "id": "wf_...",
  "workflowId": "at_...",
  "workflowName": "...",
  "status": "running | completed | completed_with_errors | failed | cancelled | awaiting_review",
  "startedAt": "ISO",
  "finishedAt": "ISO",
  "error": "",
  "warnings": [{ "sourceType": "zhihuFavlist", "message": "未配置 Access Secret" }],
  "summary": {
    "collected": 10, "skipped": 2, "scheduled": 5, "published": 0,
    "failed": 1, "awaitingReview": 0, "truncated": true, "truncateReason": "maxItemsPerRun"
  },
  "items": [{
    "index": 0, "title": "...", "sourceType": "zhihuFavlist", "platform": "zhihu",
    "externalId": "...", "url": "...",
    "status": "pending | collecting | rewriting | creating | scheduling | scheduled | published | skipped | failed | awaiting_review",
    "error": "", "scheduleId": "", "publishAt": "", "videoPath": "", "episodeId": ""
  }]
}
```

### 4.4 WorkflowPublishQueue（持久化键 `workflow_publish_queue`，最多 500 条）

```jsonc
{
  "id": "wq_...", "runId": "wf_...", "workflowId": "at_...", "itemKey": "...",
  "title": "...", "platform": "bilibili", "accountId": "",
  "article": { "title": "...", "content": "...", "cover_path": "", "tags": [], "video_path": "" },
  "publishAt": "ISO",
  "status": "pending | dispatched | failed | missed | cancelled",
  "attempts": 0, "late": false, "error": "",
  "createdAt": "ISO", "dispatchedAt": ""
}
```

### 4.5 WorkflowDedupeLedger（持久化键 `workflow_dedupe_ledger`）

```jsonc
{ "sourceKey": "zhihuFavlist:zhihu:123", "fingerprint": "sha256...", "runId": "wf_...", "workflowId": "at_...", "title": "...", "createdAt": "ISO" }
```

### 4.6 自定义模板（持久化键 `workflow_templates_custom`，最多 50 条）

```jsonc
{ "id": "wft_...", "name": "...", "description": "...", "config": { /* WorkflowConfig */ }, "createdAt": "...", "updatedAt": "..." }
```

---

## 5. 数据校验规则

> 校验实现：`workflow-schema.js#validateWorkflowConfig`。返回 `{ ok, config, errors[] }`，每条错误是 `{ field, reason, params }`。渲染层把 `field/reason` 映射成可读文案（`automation.wfConfigInvalid`），**不允许只显示一句「保存失败」**。

| 字段 | 规则 | reason | 用户可见文案（zh） |
|------|------|--------|--------------------|
| `source.type` | 必须是 hotTopics / creatorMonitor / zhihuFavlist | `unknown` | 来源类型不合法 |
| `source.categories` | 至少 1 个；必须属于 11 类 | `empty` / `unknownCategory` | 请至少选择一个热门类别 / 存在未知类别 |
| `source.limit`（热门） | 整数 1–30 | `outOfRange` | 数量必须在 1–30 之间 |
| `source.limit`（收藏夹） | 整数 1–50 | `outOfRange` | 数量必须在 1–50 之间 |
| `source.followIds` | 非空、去重、≤50 | `empty` / `tooMany` | 请至少填写一个博主 / 最多 50 个博主 |
| `source.perCreatorLimit` | 整数 1–20 | `outOfRange` | 每位博主最多 1–20 条 |
| `source.folderTokens` | 非空、去重、≤20 | `empty` / `tooMany` | 请至少填写一个收藏夹 / 最多 20 个收藏夹 |
| `rewrite.mode` | default / strategy | — | — |
| `rewrite.strategyId` | mode=strategy 时非空 | `empty` | 请选择改写策略 |
| `content.type` | article / video / podcast | `unknown` | 请选择内容类型 |
| `content.videoPipeline` | video 时必填且在 7 条白名单内 | `empty` / `unsupported` | 请选择视频流水线 / 该流水线不能从文案直接启动 |
| `content.podcastChannelId` | podcast 时必填 | `empty` | 请选择播客频道 |
| `publish.targets` | 非播客时至少 1 个；每个目标必须带非空 `accountId`；平台必须在 15 个白名单；按平台+账号去重；≤30 | `empty` / `unsupported` / `tooMany` | 请至少选择一个发布账号 / 平台不支持 / 目标过多 |
| `publish.mode` | immediate / scheduled；播客只能 immediate | `podcastImmediateOnly` | 播客不支持定时起发 |
| `publish.startAt` | scheduled 时必须可解析、晚于当前、≤30 天 | `invalid` / `notFuture` / `beyondHorizon` | 起发时间无效 / 必须是未来时间 / 最多提前 30 天 |
| `cadence.minMinutes` | 整数 5–1440 | `outOfRange` | 间隔必须在 5–1440 分钟 |
| `cadence.maxMinutes` | 整数 5–1440；≥min | `outOfRange` / `minGreaterThanMax` | 间隔必须在 5–1440 分钟 / 下限不能大于上限 |
| `guardrails.maxItemsPerRun` | 整数 1–50 | `outOfRange` | 单次最多 1–50 条 |
| `guardrails.dailyItemLimit` | 整数 1–200 | `outOfRange` | 每日最多 1–200 条 |
| `guardrails.retryPerItem` | 整数 0–3 | `outOfRange` | 单条重试 0–3 次 |

**保存时与运行时的双重校验**：保存走 `validateAutomationTask`（含 `workflow-config` 聚合错误）；运行前 `workflowRunner.startRun` 再校验一次，防止持久化被手改。

---

## 6. 流程

### 6.1 主流程（一次运行）

```
触发器到点 / 手动「立即运行」
   ↓
校验配置 → 读去重账本（不可读则 fail-closed 终止）
   ↓
检查每日额度（用尽 → run=failed, error=dailyItemLimit）
   ↓
采集来源（失败 → warning + 空结果；空结果且有 warning → run=failed）
   ↓
按 maxItemsPerRun / 每日剩余额度截断（记录 truncated + reason）
   ↓
逐条：去重（双键）→ 采集正文（如需要）→ 改写 → 生成（视频/播客）
   ↓
审核开关？ → 是：item=awaiting_review，run=awaiting_review，等 approveRun
              → 否：按平台+账号计算下一个排期 → 写入持久发布队列 → item=scheduled
   ↓
运行结束：completed / completed_with_errors / failed / cancelled
   ↓
发布队列每 30 秒 tick：到点 → TaskQueue.add（与手动发布同通道）→ 发布历史
```

### 6.2 条目状态机

| 当前 | 事件 | 下一状态 |
|------|------|----------|
| pending | 开始采集正文 | collecting |
| collecting | 采集成功 | rewriting |
| collecting | 采集失败且重试耗尽 | failed |
| rewriting | 改写成功 | creating（视频/播客）或 scheduling（图文） |
| rewriting | 改写失败且重试耗尽 | failed |
| creating | 视频/播客成功 | scheduling / published（播客） |
| creating | 生成失败且重试耗尽 | failed |
| scheduling | 所有目标排期成功 | scheduled |
| scheduling | 任一目标失败 | failed |
| pending | 账本命中 | skipped |
| scheduling | requireApproval=true | awaiting_review（在生成后直接进入） |
| awaiting_review | approveRun | scheduled |

### 6.3 失败策略

- `skip`（默认）：单条失败记 `failed`，继续下一条；run=`completed_with_errors`（有成功条目时）或 `failed`（全失败）。
- `abort`：首条失败立即停止；未处理条目保持 `pending`；run=`failed`。

### 6.4 重试

- 任务级 `maxRetries`（0–3）：整条工作流重跑；账本保证已排期条目不重复发。
- 条目级 `guardrails.retryPerItem`（0–3）：对采集/改写/生成/排期各自重试。
- `ledger-unreadable` 不重试（重试只会重复烧钱）。

---

## 7. 功能逻辑

### 7.1 来源归一化

统一条目形状：`{ sourceType, platform, externalId, title, content, summary, url, coverImage, publishedAt, needsCollect, needsGeneration, meta }`

- **热门选题**：只有话题名，`needsGeneration=true`；改写阶段用 `mode=create` 从话题名生成正文；`sort=latest` 按 `fetchedAt` 倒序，`score` 按评分倒序。
- **关注博主**：读 `creator_follows` → `creator_discoveries`（`collect_state=pending`），`needsCollect=true`（有 URL 无正文）。
- **知乎收藏夹**：官方 API，摘要作为初始内容，`needsCollect=true`；运行期用 `urlCollector.collect` 抓正文。

### 7.2 去重

- **来源键**：`sourceType:platform:externalId`，缺 externalId 用 `sourceType:url:<url>`，再缺用 `sourceType:title:<归一化标题>`。
- **内容指纹**：标题+正文去 HTML 标签、折叠空白、转小写后 SHA-256。
- 任一命中 → `skipped`，`error=duplicate:<runId>`；不消耗改写/生成/发布资源。
- 账本 TTL 180 天、上限 5000 条；JSON 损坏 → **拒绝写入并终止运行**（`ledger-unreadable`），绝不覆盖原值。

### 7.3 改写

- `mode=default`：`rewriteEngineService.rewrite({ mode: 'expand'|'create', content, userSettings:{} })`；无有效信号时引擎回退保真策略。
- `mode=strategy`：额外传 `strategyId`。
- 改写引擎失败时回退 Python `/aggregation/rewrite`；两者都不可用 → 条目失败，错误「没有可用的改写引擎」。
- 热门选题（无正文）走 `mode=create`，正文=话题名；其他走 `mode=expand`。

### 7.4 生成

- **图文**：跳过生成。
- **视频**：`pipelineEngine.startOrchestrated(pipeline, { text, autoAdvance:true, background:true, checkpointPolicy:'none' })`；轮询 `getRunContext` 最长 30 分钟；从 compose 阶段输出取 `videoPath`。
- **播客**：调用共享出期宿主 `publishFromScript({ channelId, title, copy:{content}, billingConfirmed:true })`；宿主未初始化时返回可操作错误「请先打开播客 RSS 频道页完成频道配置」。宿主与播客页共用同一实例，避免频道忙标记互不可见。

### 7.5 节奏（按平台+账号）

- `createPacer` 为每个 `platform:accountId` 维护独立 `lastAt`；首条 = `max(起发时间, 当前)`；后续 = `max(lastAt + random(min,max) 分钟, 当前)`。
- 平台间并行：同一时刻多个平台可以同时发。
- 生成耗时超过计划时间 → 顺延到当前时刻，不排到过去。
- 预览按下限估算（对用户最保守），显示摘要与首尾跨度。

### 7.6 发布队列

- 为什么不用 `scheduler.create`：平台侧定时注册表当前只有头条 `api` 模式取证通过，其余 14 个平台 `unsupported`；直接调用会在第二个平台就被阻断。
- 本队列到点调用 `taskQueue.add`（与 `publish:batch` 同一条通道），因此自动受 `PublishIntervalGuard` 的账号/平台/日配额保护。
- tick 间隔 30 秒；`setInterval().unref()`，不阻止应用退出。
- 重启恢复：`publishAt + 24h < now` → `missed`（不补发）；否则立即补发并标 `late=true`。
- 派发失败：同一条最多 3 次，之后 `failed` 并保留错误；不做无限重试。
- **派发幂等**：tick 到点后先把条目置 `dispatching` 并落盘，再调用 `taskQueue.add`；成功后置 `dispatched`。若进程在 enqueue 后、标记 dispatched 前崩溃，重启时该条会停在 `dispatching`，超过 10 分钟租约后标 `failed` + `error=dispatch-uncertain` + `needsReview=true`，**不自动重发**，由用户在队列面板人工确认/重试。
- **队列状态回写运行记录**：队列每次状态变化（`dispatching/dispatched/failed/missed/dispatch-uncertain/retry-requested`）回调 `workflowRunner.applyQueueEvent`，更新对应条目的 `queueStatus/queueError/queueAttempts/queueAt`；`failed/missed/dispatch-uncertain` 同时把条目置 `failed`，运行摘要从 scheduled 扣减、failed 增加。
- **人工重试**：队列面板对 `failed/missed/dispatch-uncertain` 提供「重试」，`queue.retry(id)` 重置为 `pending`（attempts=0、清错误），等下一 tick 重新派发；不提供自动无限重试。
- **多目标排期回滚**：一条内容排到多个平台时，若第 N 个目标入队失败，前 N-1 个已写入队列的条目会被撤回（`queue.remove`），避免「条目记失败但队列里还留着它，重跑后重复发布」。
- 队列 JSON 损坏 → `queue-unreadable`，拒绝写入、不覆盖原值。

### 7.10 账号预检

- 运行前（schema 校验之后、采集之前）调用 `accountProvider` 读取 `listAccounts()`；对每个非播客 target 按 `platform + accountId` 匹配。
- 账号不存在 → `account-unavailable`，`accounts[]` 带 `reason=missing`；账号状态为 `expired/inactive/disabled` → `account-unavailable`，带对应 reason；读取账号列表抛错 → `account-check-failed`。三种情况都**不采集、不改写、不排期、不消耗额度**。
- UI 侧对 `expired/inactive/disabled` 账号禁用复选框并显示状态文案（登录已过期/未启用）；保存时再次校验，防止绕过 UI 直接调用。
- 账号列表来自「账号管理」的 `listAccounts()`，任务只引用账号 ID，不复制凭证。

### 7.11 生成中断续跑

- `startRun` 建好条目后把未处理源条目写入内部字段 `run._sources` 并立即持久化；每处理完一条清空对应槽位并 `persist(run)`，运行结束删除 `_sources`。
- 应用启动时在发布队列恢复之后异步调用 `workflowRunner.resumeInterruptedRuns()`：扫描 `status=running` 且有 `_sources` 的运行，只续跑 `pending/collecting/rewriting/creating` 条目。
- `scheduling` 条目可能已部分入队，无法判断哪些目标已写；续跑时置 `failed + resume-scheduling-uncertain`，**不自动重发**，由用户人工确认。
- `_sources[i]` 缺失的 pending 条目置 `failed + resume-source-missing`，不消耗生成额度。
- 续跑失败只写 `WorkflowRunner` 通知，不阻塞主窗口；已 `scheduled/published/failed/skipped` 的条目保持原状，不重复。
- 这解决的是「30 分钟硬超时/进程崩溃后已完成的进度不丢」，不是把生成改成独立队列；生成仍在应用内异步执行，但可跨重启续跑。

### 7.12 抖音爆款库来源

- 数据源定义：**已采集到 `viral_library` 且 `platform=douyin` 的内容**，不是实时抓抖音热榜；没有数据时先到爆款库采集。
- `viral_library` 新增 `industry` 列；建表、store-schema 迁移、creator-schema 迁移三处同步，旧数据为空串。
- 行业枚举：美妆/穿搭/美食/母婴/家居/数码/职场/情感/教育/健身/旅行/财经/其他；共享文件 `apps/desktop/shared/viral-industries.json`，后端 fallback 内置同值。
- 来源配置：`type=douyinViral`，`industry` 必填，`limit` 1–50，`minLikes` 0–10,000,000，`sort=score` 按点赞 / `latest` 按入库时间。
- 归一化：`needsCollect=false`、`needsGeneration=false`，正文直接进入改写/排期；`meta` 带 industry/likes/collections/comments/author。
- 爆款库表单/列表新增行业；旧数据无行业不会被新来源选中（数据质量门禁）。
- 服务未装配时返回 warning「爆款库服务未装配」，不拖垮其他来源；过滤为空时 items=[]，由运行摘要显示 0。

### 7.13 模板市场 / 团队共享与版本迁移

- 模板包格式 v2：`format=mulpub-workflow-template`、`version=2`、`name`（1–40 字）、`description`（≤200 字）、`config`、`exportedAt`；团队共享走 JSON 文件，不做云端市场。
- 账号隔离：导出与导入都把 `publish.targets[].accountId` 强制清空，模板只保存平台建议；应用模板后用户必须重新选本机账号。
- 版本迁移：
  - v1（含无 version 裸对象）自动补齐 source/rewrite/content/publish/cadence/guardrails/review/dedupe；
  - platform-only targets 迁移为 `{platform, accountId:''}`；
  - 未来版本返回 `unsupported-version` 并提示升级应用，不静默导入。
- 导入校验：`invalid-json` / `invalid-shape` / `name:empty` / `name:tooLong` / `unsupported-format` / `unsupported-version` / `invalid-config`（逐条 errors）/ `name:duplicate` / `limit`（自定义模板上限 50）。
- 冲突策略：默认重名报错并返回 preview；`rename:true` 自动生成「原名（导入 N）」；`overwrite:true` 显式覆盖同 id 模板。`dryRun:true` 只预览不落盘。
- UI：模板下拉选中后可「导出模板」；「导入模板」选择 JSON 后自动迁移/校验/导入；成功 toast 模板名，失败区分「版本过新」与「文件不是有效模板 JSON」；导入不自动应用。
- 旧自定义模板读取时自动迁移到 v2，写回统一 v2；迁移失败的单条模板跳过，不拖垮整个列表。

### 7.14 账号选择体验

- 发布账号区按平台分组；账号是发布单元，同平台可多选。
- 搜索：按账号名称/平台/备注/状态/ID 过滤，大小写不敏感；无结果显示「没有匹配的账号」。
- 批量：『全选当前结果』只添加当前过滤后可用账号，跳过过期/未启用；『清空已选』清空全部 targets（包括搜索前已选的不可见账号）。
- 健康汇总：显示「可用 N 个 · 不可用 M 个」；不可用账号仍展示状态且 disabled。
- 最近使用：localStorage `workflow_recent_accounts` 保存最近 10 个账号 ID，展示最近 5 个可用账号；点击 chip 可直接勾选/取消；隐私模式读写失败静默降级。
- 搜索/全选/清空均为纯渲染层操作，不改变发布前预检与账号状态判定。

### 7.7 护栏

- 单次上限：采集后截断，`summary.truncated=true`、`truncateReason=maxItemsPerRun`。
- 每日额度：`ledger.countToday()` 按本地日期统计；剩余不足时按剩余放行；为 0 时整轮失败 `dailyItemLimit`。
- 条目重试：见 §6.4。

### 7.8 审核

- `review.requireApproval=true`：生成完不排期，条目 `awaiting_review`，运行 `awaiting_review`。
- 运行记录里「确认发布」→ `approveRun` 按当前时间为每个目标重新计算排期并写入队列；失败条目单独标记。
- 审核开关不改变去重：未审核的条目不写账本，避免「审核没通过却永久跳过」。

### 7.9 模板

- 内置 5 个只读模板：知乎收藏夹→故事视频、关注博主→图文、热门选题→图文、热门选题→解释视频、知乎收藏夹→播客。
- 自定义模板：名称 1–40 字符、同名拒绝、最多 50 个；保存前走同一套配置校验。
- 导出 JSON：`{ version:1, name, description, config }`；导入时 `version` 必须为 1，配置重新校验。
- 模板只保存配置与**平台建议**，不保存账号 ID/凭证；`accountId` 在模板里允许为空，应用模板后必须选择具体账号。

---

## 8. 交互逻辑

### 8.1 页面结构

「自动化」页：

1. 页头：标题 + 副标题 + 「运行记录」文字按钮 + 「新建任务」主按钮。
2. 资源提示条：后台执行会占用模型额度与浏览器资源，可能与手动发布竞争平台限流。
3. 队列告警条：当队列存在 `failed` 或 `missed` 条目时显示黄条「发布队列有 N 条派发失败、M 条已错过，请打开运行记录处理」+「查看队列」按钮；无问题时不显示。
4. 任务表：名称（含启停开关）/ 触发方式 / 动作摘要 / 失败策略 / 上次运行 / 操作（立即运行、编辑、删除）。
5. 无任务：空态文案「还没有自动化任务。点击「新建任务」，让采集到发布自动跑起来。」
6. 读取失败：红条「任务列表读取失败，可能是未登录或存储不可用。为避免覆盖真源，本次未写入任何改动。」

### 8.2 新建/编辑弹窗

字段顺序：任务名称 → 任务类型 → （复合工作流时）模板区 → 工作流配置（5 段）→ 触发器 → 失败策略 → 重试次数 → 错误条 → 取消/保存。

- **任务类型**：单选「复合工作流（来源 → 改写 → 生成 → 发布）」/「URL / RSS 直发（旧任务）」；默认复合。切换为旧任务时隐藏工作流配置，保存 `action.type=fullAutoPipeline`。
- **模板区**：下拉（内置模板 / 我的模板分组）+「应用模板」；模板名称输入 +「另存为我的模板」；提示「模板只保存平台建议，不保存账号 ID；应用后请选择具体账号。」
- **工作流配置**：5 段，见 §8.3。
- **触发器**：沿用现有复选框 + 时间/星期/间隔输入；至少一种，类型不可重复。
- **失败策略**：跳过继续 / 中断；各带一行说明。
- **重试次数**：0–3。
- **错误条**：字段级错误显示为「配置不合法：<field>（<reason>）」；空名称/无触发器/无星期分别显示既有文案。
- **保存中**：按钮禁用；成功后 toast「任务已创建 / 任务已保存」并关闭弹窗刷新列表。

### 8.3 工作流配置 5 段

| 段 | 显示项 | 交互 | 提示文案要点 |
|----|--------|------|--------------|
| 1 来源 | 来源类型下拉；热门类别 chips；数量；排序；博主 ID 输入；每位博主上限；收藏夹 token 输入 | 类别多选；ID/token 逗号分隔；数量数字输入 | 「至少选一个类别才会产出内容」「需先在设置 → 知乎 API 配置 Access Secret」 |
| 2 改写 | 默认/指定策略单选；策略下拉 | 选「指定策略」才显示下拉 | 「默认策略会在没有有效信号时回退到保真改写」 |
| 3 内容 | 图文/视频/播客单选；视频流水线下拉；播客频道输入 | 类型切换联动显示 | 「只列出文案可直接启动的流水线」「播客会生成一期并写入 RSS」 |
| 4 发布 | 已添加账号多选（按平台分组，显示账号名/状态）；发布时机下拉；起发时间 datetime-local；已选账号数 | 账号复选框多选；同平台可多选；scheduled 才显示时间 | 「账号来自账号管理；同一平台可多选」「本地队列：应用需保持运行；重启后 24h 内过期项补发并标记迟到」 |
| 5 节奏与护栏 | 同账号间隔 min–max；单次上限；每日上限；审核开关；去重开关 | 数字输入/复选框 | 「每个账号各自独立排队」「审核打开后停在待审核」 |

### 8.4 预览

点「预览排期」→ 调 `previewPlan`（按下限估算）→ 显示「<摘要>；首尾跨度约 N 分钟」。配置非法时按钮无结果或提示（实现上返回 `ok:false`，由保存时统一报错）。

### 8.5 运行记录抽屉

- 列表：工作流名、状态徽标（运行中/已完成/部分失败/失败/已取消/待审核）、开始时间、摘要「采集 N · 已排期 N · 跳过 N · 失败 N」。
- 队列面板：顶部固定显示「发布队列」摘要「排队 N · 派发中 N · 失败 N · 错过 N」；失败/错过/派发不确定条目逐一显示标题、错误与「重试」按钮，重试回到 pending 等下一 tick。
- 展开：条目行（状态、标题、队列状态徽标、排期时间、错误）；队列状态徽标为 `排队中/派发中/已交给发布器/派发失败/已错过/派发不确定`；来源 warning 黄条。
- 待审核：行内「确认发布」按钮（主按钮）；运行中：`取消运行`。
- 空态：「还没有运行记录。任务运行后会在这里显示每条内容的处理结果。」

### 8.6 状态与空态矩阵

| 场景 | 显示 |
|------|------|
| 任务列表为空 | 空态文案 + 新建按钮 |
| 列表读取失败 | 红色告警条，不显示空态（避免把「读不到」误当「没有」） |
| 保存失败 | 弹窗内错误条；不关闭弹窗 |
| 运行中 | 任务行「运行中」chip；再点立即运行提示「上一轮还在运行，已跳过本次触发」 |
| 无账号/无模板 | 下拉为空但可手填；保存时配置校验给出字段错误 |
| 播客宿主未初始化 | 条目错误「播客出期宿主未初始化：请先打开「播客 RSS 频道」页完成频道配置后重试」 |

### 8.7 显示项与本地化

- 所有新增用户可见文案必须写入 `apps/desktop/src/locales/automation/{zh,en}.js`，zh/en 成对（CI Gate 7）。
- 平台/来源/内容类型标签由主进程 `getWorkflowMeta()` 下发；账号列表由 `listAccounts()` 读取（含同平台多账号与状态），渲染层不再手抄平台或账号枚举。
- 时间显示：列表用 `YYYY-MM-DD HH:mm`；运行抽屉用本地化 `toLocaleString()`。

---

## 9. 关键提示文字（摘要）

| key | zh |
|-----|----|
| `wfScheduleWarn` | 工作流使用本地发布队列：应用需保持运行（可最小化到托盘）。关闭应用会错过排期；重启后 24 小时内的过期项会自动补发并标记「迟到」。 |
| `wfReviewHint` | 打开后：生成完停在「待审核」，在运行记录里确认后才排期；关闭后全自动直发。 |
| `wfTemplateHint` | 模板只保存平台建议，不保存账号 ID；应用后请选择具体账号。 |
| `wfPipelineHint` | 只列出「文案可直接启动」的流水线；需要先导入素材的口播 / 电影感 / 剪辑工厂不在其中。 |
| `wfChannelHint` | 播客不是平台内容类型：会生成一期节目并写入 RSS，由小宇宙 / Apple / Spotify 自动抓取。 |
| `wfFoldersHint` | 需先在「设置 → 知乎 API」配置 Access Secret；收藏夹只给摘要，正文会在运行期抓取。 |

---

## 10. 与现有模块的接线

| 现有模块 | 用途 | 接线点 |
|----------|------|--------|
| `AutomationScheduler` | 触发器与任务生命周期 | `_executeWithPolicy` 新增 `compositeWorkflow` 分支 → `workflowRunner.startRun` |
| `AutomationTask` | 任务校验/持久化 | `normalizeAction` 校验并保留 `compositeWorkflow` |
| `hotTopicsService` | 热门选题 | `workflow-runtime` 适配 `fetchTopics` |
| `creatorStore` | 博主发现项 | `getFollow` + `listDiscoveries(state=pending)` |
| `ZhihuFavlistService` + `zhihu-credential` | 收藏夹 | `getFavlistContents` + `resolveSecret` |
| `urlCollector` | 正文采集 | `collect(url)` |
| `rewriteEngineService` / `pythonBridge` | 改写 | `rewrite()`，失败回退 Python |
| `pipelineEngine` | 视频生成 | `startOrchestrated` + `getRunContext` 轮询 |
| `podcast-episode-host` | 播客出期 | 共享宿主 `publishFromScript` |
| `TaskQueue` | 到点发布 | `taskQueue.add`（与 `publish:batch` 同通道） |
| `PublishIntervalGuard` | 账号级最小间隔 | TaskQueue 执行前自动调用，工作流无需重复实现 |
| `publish-history` | 发布结果 | 由 TaskQueue/发布链路照常写入 |
| `settings`（SQLite） | 任务/模板/运行/队列/账本 | `getSetting/setSetting` |

---

## 11. 可观测性与运维

- 运行记录：`workflow_runs` 最近 50 条；失败条目带 `error` 原文。
- 队列：`workflow_publish_queue` 最近 500 条；`dispatched/failed/missed/cancelled` 可区分。
- 日志：`WorkflowRunner` / `WorkflowQueue` / `WorkflowSource` 前缀，warn 不阻断主流程。
- 通知：工作流失败/恢复沿用 `automation:notification`，渲染层 toast，不弹模态。
- 手工排查顺序：运行记录 → 队列条目状态 → 发布历史 → 平台账号登录态 → 模型/额度。

## 12. 验收标准

1. 新建「知乎收藏夹 → 故事视频」工作流，保存后列表动作摘要显示「知乎收藏夹 · 视频 · 35-40 分钟 · B站/抖音/视频号/YouTube」。
2. 同一收藏夹再次运行：已发过的条目 `skipped`，不重复改写/生成/发布。
3. 单次上限 5、来源 10 条：只排 5 条，运行摘要 `truncated=true`、`truncateReason=maxItemsPerRun`。
4. 每日额度用尽：运行失败 `dailyItemLimit`，队列零新增。
5. 同账号 3 条、间隔 35–40：排期两两间隔落在 35–40 分钟；不同平台首条同一时刻。
6. 审核开关打开：条目停在 `awaiting_review`，点「确认发布」后进入队列。
7. 账本 JSON 损坏：运行失败 `ledger-unreadable`，原账本文件不被覆盖。
8. 队列 JSON 损坏：新增排期返回 `queue-unreadable`，原文件不被覆盖。
9. 关闭应用后有 2 小时前的待发项：重启后补发并标记 `late=true`；25 小时前的标记 `missed`。
10. 模板导出→导入：配置等价；内置模板不可删除；同名自定义模板拒绝。
11. 视频流水线只出现 7 条文案可启动项；选素材型流水线被配置校验拒绝。
12. 播客工作流不要求平台目标；未初始化宿主时错误文案可操作。

## 13. 非功能需求

| 项 | 要求 |
|----|------|
| 性能 | 1000 条账本查找 O(n) 可接受（上限 5000，单次运行 ≤50 条）；队列 tick 30s，单次扫描 ≤500 条 |
| 稳定性 | 所有持久化写入失败必须回滚内存变更并返回原因；JSON 损坏 fail-closed |
| 安全 | 模板不含凭证；工作流不新增任何出站请求（复用现有服务）；日志不打印 Access Secret |
| 兼容 | 旧 `fullAutoPipeline` 任务行为不变；`normalizeAutomationTasks` 保留动作类型 |
| 可维护 | 纯函数层（schema/plan/ledger）与 IO 层（runtime/runner/queue）分离，单测不依赖 Electron |
| i18n | zh/en 成对；渲染层不新增中文字面量 |

## 14. 风险与遗留（不假装已闭合）

1. **本地队列依赖应用常驻**：关闭应用会错过排期；已在 UI 明示并做 24h 内补发。彻底解法是把平台侧定时取证扩展到 14 个平台（当前只有头条）。
2. **播客宿主初始化依赖播客页**：首次使用工作流发播客前，需要打开一次「播客 RSS 频道」页完成频道配置；否则条目失败并给出可操作提示。P1 应把宿主构造下沉到容器。
3. **博主发现项状态不回写**：本期处理完仍为 `pending`，靠账本去重；P1 应调用 `markCollected/finalizeCollected`。
4. **主 PRD 结构损坏**：本 PRD 作为独立子 PRD；未直接编辑 `01-docs/PRD.md`（多副本/换行损坏，编辑风险高）。
5. **同平台多账号**：已支持账号级目标和独立节奏；账号来自「账号管理」，任务必须带非空 `accountId`，不再回落默认账号。
6. **抖音爆款**：本期隐藏；数据源与行业枚举未定义。
7. **队列派发失败不回写运行记录**：到点派发失败只体现在队列条目（`failed` + `error`）与日志，运行记录里的条目仍是 `scheduled`。P1 需要把队列事件回写到 run（或在运行抽屉里直接展示队列状态）。
8. **视频多条时可能触顶 30 分钟硬超时**：AutomationScheduler 的单次运行硬超时为 30 分钟；多条视频串行生成会超过。P1 需要把「生成」与「发布」解耦为可续跑的后台作业。

## 15. 附录：内置模板清单

| id | 名称 | 来源 | 内容 | 目标 | 间隔 |
|----|------|------|------|------|------|
| `zhihu-fav-story-video` | 知乎收藏夹 → 故事讲述视频 | 收藏夹 | 视频 `story2video-compose` | B站/抖音/视频号/YouTube | 35–40 |
| `creator-article-daily` | 关注博主 → 图文分发 | 博主 | 图文 | 知乎/微博 | 10–15 |
| `hot-topic-article` | 热门选题 → 图文快讯 | 热门（AI/科技） | 图文 | 头条/百家号 | 30–40 |
| `hot-topic-explainer-video` | 热门选题 → 解释视频 | 热门（AI） | 视频 `animated-explainer` | 抖音/视频号/快手 | 30–40 |
| `zhihu-fav-podcast` | 知乎收藏夹 → 播客一期 | 收藏夹 | 播客 | RSS 频道 | 60–90 |
