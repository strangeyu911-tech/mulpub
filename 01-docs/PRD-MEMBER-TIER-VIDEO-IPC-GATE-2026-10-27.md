# PRD — 视频创作 IPC 硬门禁（P1-1b，v1.0）

> **状态**：🟢 已实现（2026-10-27）
> **上游**：`01-docs/PRD-MEMBER-TIER-VIDEO-GATE-2026-10-27.md` §9 非目标；`01-docs/MECHANISM-MEMBER-TIERS.md` v3.5
> **执行记录**：`openspec/records/member-tier-p1-1b-video-ipc.md`

---

## 1. 背景

P1-1 已在客户端关闭视频创作入口（`/create`、采集页、热门选题），但主进程 IPC 仍只要求登录，程序化调用 `pipeline:start` / `pipeline:startOrchestrated` 可绕过 UI 免费消耗本机算力/模型额度。P1-1b 在主进程 choke point 强制 `video_create` feature，形成客户端 + IPC 双层门禁。

## 2. 通道划分

| 通道 | 门禁 | 理由 |
|---|---|---|
| `pipeline:start` | `video_create` | 新建流水线（含直连非编排流水线） |
| `pipeline:startOrchestrated` | `video_create` | 新建编排流水线（采集/热门选题/创作页主路径） |
| `render:start` | `video_create` | 快速渲染：图片轮播成片 |
| `render:start-ai-video` | `video_create` | 快速渲染：AI 视频生成 |
| `story2video:batch:create` | `video_create` | 批量创建视频项目 |
| `pipeline:pause` / `resume` / `cancel` / `status` / `advance` / `fetch` | 登录即可（不变） | 允许免费档收尾/取消已有任务，避免「降级后卡死」 |
| `render:cancel` / `render:validate-props` / `render:list-compositions` / `render:get-composition` | 登录即可（不变） | 只读/取消，不是新建 |
| `story2video:batch:status` / `cancel` | 登录即可（不变） | 查询/取消，不是新建 |

> `pipeline:start` 同时覆盖 `film-engineering` 等其它视频流水线；它们都属于「视频创作」功能面，`video_create` 统一把关。

## 3. 判定逻辑

`license-access-control.js` 的 `CHANNEL_FEATURE_MAP` 新增 5 个启动通道映射：

```js
'pipeline:start': 'video_create',
'pipeline:startOrchestrated': 'video_create',
'render:start': 'video_create',
'render:start-ai-video': 'video_create',
'story2video:batch:create': 'video_create',
```

执行顺序（`createAccessControlledIpcMain`）：

```
isTrustedSender(event)            → 否则 UNTRUSTED_SENDER
requiredLevel (authenticated)     → 否则 AUTH_REQUIRED
dev mode (app.isPackaged === false) → 跳过 feature（本地开发/测试）
identityService.requireEntitlement('video_create', { onlineOnly: false })
  ├─ 成功 → handler
  └─ 失败/缺失 → ENTITLEMENT_REQUIRED（code -3）
```

> feature 是**生产包硬门禁**；开发/未打包模式保持原短路，避免本地验证被会员权益阻塞。

## 4. 错误与提示

| 场景 | 返回 |
|---|---|
| 未登录 | `{ code: -3, errorCode: 'AUTH_REQUIRED', message: '当前许可证无权访问该功能…' }` |
| 已登录但无 `video_create` | `{ code: -3, errorCode: 'ENTITLEMENT_REQUIRED', message: '当前账号没有所需权益…请升级或开通…' }` |
| 不可信来源 | `{ code: -3, errorCode: 'UNTRUSTED_SENDER', message: '未授权的调用来源' }` |
| 有权益 | 原 handler 返回值不变 |

`messageParams.channel` 只用于诊断，用户文案不暴露内部通道名。

## 5. 边界

| 场景 | 行为 |
|---|---|
| 免费档直接 invoke `pipeline:start` | 拒绝，handler 不执行 |
| 免费档直接 invoke `render:start-ai-video` | 拒绝 |
| 免费档直接 invoke `story2video:batch:create` | 拒绝 |
| 免费档取消/暂停已有 run | 允许（收尾通道） |
| 标准/专业（features 含 video_create） | 放行 |
| entitlement 缺失/旧快照（IPC 硬门禁） | `requireEntitlement` 拒绝（fail-closed）；客户端 P1-1 仍 fail-open。两层语义不同：入口层防误伤，IPC 层防绕过。 |
| 开发模式 `app.isPackaged=false` | 跳过 feature（与既有 `cloud_publish` 同口径） |
| 其他视频写操作（`story2video:generate-scene-*` 等） | 本切片不改；如后续需要，按同一模式纳入 |

## 6. 验收标准

- [ ] `CHANNEL_FEATURE_MAP` 含 5 个启动通道 → `video_create`。
- [ ] 免费/无权益：5 个通道均返回 `code=-3, errorCode=ENTITLEMENT_REQUIRED`，handler 不执行。
- [ ] 标准/专业有权益：5 个通道放行，handler 执行一次。
- [ ] `pipeline:pause/resume/cancel/status` 仍为登录即可，不要求 `video_create`。
- [ ] `render:cancel` / `story2video:batch:status` 仍为登录即可。
- [ ] 开发模式短路保持（`app.isPackaged=false` 跳过 feature）。
- [ ] 既有 `cloud_publish` 门禁不回归。
- [ ] QM-1 打包/启动验证通过。

## 7. 测试计划

| 层 | 文件 | 内容 |
|---|---|---|
| 静态映射 | `license-access-control.test.js` | map 含 5 通道 + `pipeline:pause` 不要求 feature |
| 行为拒绝 | 同上 | `it.each` 5 通道：无权益返回 -3 / handler 未执行 |
| 行为放行 | 同上 | `it.each` 5 通道：有权益 handler 执行 |
| 既有门禁 | 同上 | `cloud_publish` / 登录态用例不回归 |
| 打包 | QM-1 | asar 清单、require 链、8 秒启动 + stderr 三层判据 |

## 8. 非目标

- 不改 `story2video:generate-scene-*` / `story2video:recompose-project` 等「已有项目内编辑」通道（后续按需）。
- 不改 `auto-pipeline:start`（归 P1-4 自动化配额）。
- 不改服务端配额/计费。
