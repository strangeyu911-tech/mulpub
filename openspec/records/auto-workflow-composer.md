---
record: auto-workflow-composer
task: 复合型全自动化工作流 —— 来源/改写/内容/流水线/节奏/多平台/模板 + 运行记录
date: 2026-10-26
---

## 本次执行记录：复合型全自动化工作流（auto-workflow-composer，2026-10-26）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：隔离 worktree（仓库父目录下 `mp-worktrees/mp-auto-workflow-composer`，非 C 盘）+ 裸分支 `auto-workflow-composer`；共享根保持 main |
| QM-5 ① 第一性原因 | N/A | 本次为新功能，不是 Bug 修复 |
| QM-5 ② 逃逸分析 | N/A | 同上 |
| QM-5 ④ 修复 + 回归保护 | N/A | 同上 |
| QM-5 ⑤ 防止再次发生 | N/A | 同上 |
| 行尾与 diff 对账 | PASS | `git diff --check` 无空白错误；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 待提交前复核 |
| 接线棘轮 | PASS | 新增 9 个测试文件 + 2 个既有页面测试扩展，均被 `quality-gate.yml` 的 `QG Unit Tests` 以 `vitest run` 全量收集；`automation-ipc-wiring.test.js` 覆盖新通道注册 |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1：`electron-builder --win --dir` 成功；`node scripts/qm1-scheduled-publish-verify.cjs` 三阶段全 PASS（asar 清单 / 打包后可 require / 启动 8 秒存活且 stderr 为空）；QM-4：无新增/修改可视基线组件，视觉回归由 CI `QG Visual` 覆盖 |
| QM-6 CCG 双模型外部评审 | PASS（self-play 裁决，置信 0.6） | `ccg-deep-review` 跑完 critic=claude / proposer=opencode 跨家族评审：8 条发现，逐条 prosecution/defense/verdict/rationale 已落盘；最终 0 阻断，状态 `self_play_resolved`。证据：`.ccg/reviews/3c13b5e0d700360beceb5146794603c8b80596c0.json`（最终全量记录）。**不冒充人工外部复核**：i2/i4/i5 的 highRiskDomains 经裁决降为 0 的依据写在 `.adversarial/ccg-deep-3c13b5e0/adjudication.json` |
| 远程同步 | 由门禁推导 | 本行不手工改写；合并后按 squash 尾注 `(#NNNN)` 由 `scripts/lib/merge-ledger.js` 推导 |

### 验证证据

- `npx vitest run electron/services/workflow* electron/services/automation* src/views/AutomationView.test.js src/views/AutomationView.notify-registration.test.js` → **14 files / 132 tests passed**
- `npx vitest run electron/bootstrap/phase1-context.test.js electron/bootstrap/phase3-services.test.js electron/bootstrap/phase5-ipc.test.js electron/core/container.setup.creator.test.js` → **4 files / 87 tests passed**
- `npx vitest run src/views/AutomationView.test.js src/views/AutomationView.notify-registration.test.js` → **17 tests passed**
- `pnpm run build:vue` → built successfully（AutomationView chunk 32.02 kB）
- `npx eslint <17 个变更文件>` → 0 error
- `pnpm run check:ts` → 本仓既有 `packages/shared-utils` / `packages/video-clone-engine` 类型错误，**本次新增文件零错误**（失败清单里无 `workflow-*` / `Automation*` / `podcast-episode-host`）

### 遗留（不假装已闭合）

- **本地发布队列依赖应用常驻**：关闭应用会错过排期；已做 UI 明示与 24h 内补发。彻底解需把平台侧定时取证扩到 14 个平台（当前仅头条）。
- **播客出期宿主初始化依赖播客页**：首次用工作流发播客前需打开「播客 RSS 频道」页完成配置；宿主未初始化时给可操作错误。
- **博主发现项状态不回写**：处理完仍为 `pending`，靠账本去重；P1 接 `markCollected/finalizeCollected`。
- **同平台多账号**：本期只用平台默认账号。
- **抖音爆款**：按产品决策本期隐藏（无数据源/行业枚举）。
- **QM-6**：为 `self-play` 裁决（置信权重 0.6），非人工外部复核；8 条发现全部有逐条处置记录，最终 0 阻断。
- **主 PRD 未编辑**：`01-docs/PRD.md` 存在多副本/换行损坏；本期以独立 PRD 落地并在旧自动化 PRD 顶部加指针。

## CHANGELOG 条目

# feat(automation): 复合型全自动化工作流（来源→改写→生成→节奏→多平台，含模板/去重/运行记录，auto-workflow-composer）

- 「自动化」新增任务类型「复合工作流」：来源（热门选题/关注博主/知乎收藏夹）、改写策略、内容类型（图文/视频/播客）、单条视频流水线、发布平台、同账号 5–1440 分钟随机间隔（默认 35–40）。
- 新增 5 个只读内置模板与「我的模板」（另存、导出/导入 JSON），模板不含账号凭证。
- 新增来源键 + 内容指纹双键去重账本（180 天 / 5000 条），命中即跳过且不消耗模型额度。
- 新增持久发布队列：到点经 TaskQueue 发布；重启 24h 内补发并标迟到、超过标错过；派发失败最多 3 次。
- 多目标排期失败时回滚已写入队列的前几个目标，避免「条目失败但队列里还留着 → 重跑重复发」。
- 新增单次/每日/单条重试三道护栏与「发布前审核」开关；运行记录提供条目级状态与错误原文。
- 旧 `fullAutoPipeline` 任务行为不变；`compositeWorkflow` 配置非法时逐字段出声，不静默保存。

## learnings

### lesson: 批量间隔不能塞进「最小间隔守卫」

现有 `PublishIntervalGuard` 是 `[min, 1.4×min]` 单边抖动 + 最小间隔拦截，表达不了「35–40 分钟随机窗口」。把 35–40 硬映射成 `min=35` 会让实际间隔落在 35–49 分钟。正确做法是独立的 `createPacer`：每个 `platform:accountId` 独立维护 `lastAt`，`gap = randInt(min,max)`。

### lesson: 平台侧定时能力只有头条，别把「定时发布」当通用能力

`platform-schedule-capability.json` 里 14/15 平台是 `unsupported`。任何「批量定时到多平台」的设计必须先读这张表，否则会在第二个平台创建时被 `assertSchedulableInput` 拦住。工作流因此改用本地持久队列，并诚实标注「应用需保持运行」。

### lesson: 去重必须在花钱之前

视频生成与 TTS 是分钟级、计费动作。去重放在生成之后，等于用真金白银发现「这是旧文」。`workflow-runner` 把账本查询放在 `processItem` 第一步，并用「来源键 + 内容指纹」双键覆盖「同一条被重复采集」与「改标题重发」两种形态。

### lesson: 持久化 JSON 损坏要 fail-closed，不要「读空 → 覆盖」

账本与队列读不出来时，最容易写成「按空处理，然后写入新值」——这会把用户 180 天的去重记录或待发队列一次性清空。实现里 `ledger-unreadable` / `queue-unreadable` 直接拒绝写入并向上报错，运行宁可失败也不带着失明的去重继续发。
