# member-tier-p1-1b-video-ipc 执行记录

> 分支 `member-tier-p1-1b-video-ipc` ｜ worktree `mp-member-tier-p1-1b-video-ipc`（D 盘隔离区）
> 上游：`01-docs/PRD-MEMBER-TIER-VIDEO-IPC-GATE-2026-10-27.md`；`01-docs/MECHANISM-MEMBER-TIERS.md` v3.5

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

## 一、一句话

P1-1b：在主进程 IPC 层强制 `video_create`，堵住免费档绕过 UI 直接调用视频创作启动通道的路径；收尾/取消通道保持登录即可。

## 二、产出

| 文件 | 变更 |
|---|---|
| `apps/desktop/electron/ipc-handlers/license-access-control.js` | `CHANNEL_FEATURE_MAP` 新增 `pipeline:start` / `pipeline:startOrchestrated` / `render:start` / `render:start-ai-video` / `story2video:batch:create` → `video_create`；从 `LOGIN_ONLY_FEATURE_MAP` 移除启动项，保留 pause/resume/cancel/status/advance/fetch 与 render 收尾项 |
| `apps/desktop/electron/ipc-handlers/license-access-control.test.js` | map 静态断言；5 通道 `it.each` 拒绝（-3 / handler 不执行）与放行（handler 执行）；既有 cloud_publish 用例不回归 |
| `01-docs/PRD-MEMBER-TIER-VIDEO-IPC-GATE-2026-10-27.md` | 新增 P1-1b 详细 PRD |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.5：视频创作 IPC 状态、缺陷 H、P1-1b 状态 |

## 三、通道口径

| 通道 | 门禁 |
|---|---|
| `pipeline:start` | `video_create` |
| `pipeline:startOrchestrated` | `video_create` |
| `render:start` | `video_create` |
| `render:start-ai-video` | `video_create` |
| `story2video:batch:create` | `video_create` |
| `pipeline:pause/resume/cancel/status/advance/fetch` | 登录即可（收尾/查询） |
| `render:cancel/validate-props/list-compositions/get-composition` | 登录即可（取消/只读） |
| `story2video:batch:status/cancel` | 登录即可（查询/取消） |

错误：无权益返回 `{ code: -3, errorCode: 'ENTITLEMENT_REQUIRED' }`，handler 不执行。开发/未打包模式仍跳过 feature（与既有 `cloud_publish` 同口径）。

## 四、测试读数

| 项 | 读数 |
|---|---|
| `license-access-control.test.js` | **48 passed** |
| `license-access-control` + `pipeline` + `render` 三文件 | **156 passed / 3 files** |
| `check-locale-sync --pair-base origin/main` | PASS |
| `check-max-lines` | PASS（无新增超大文件） |
| `check-doc-abs-paths --all` | PASS |
| eslint（改动文件） | 待跑 |

## 五、QM-1（Electron 打包与启动）

本 PR 改了 `apps/desktop/electron/`，QM-1 必跑。

| 项 | 证据 |
|---|---|
| 构建 | `pnpm exec electron-builder --win --dir --publish never`；产物 `dist-electron/win-unpacked/Multi-Publish.exe` + `resources/app.asar` |
| asar 清单 | 15452 条目；`logger` 8 条；`@multi-publish/rpa-engine` 12 条 |
| require 链 | 解包到 `%TEMP%\\mp-qm1-p1-1b-app` 后 `require('.../@multi-publish/rpa-engine')` → **rpa-engine require OK** |
| 启动存活 | 8 秒窗口 `alive=True` |
| stderr | **0 bytes**（三层判据第③层通过） |
| 环境告警 | 父环境存在 `ELECTRON_RUN_AS_NODE=1`；已显式剔除后再启动（否则 Electron 会以 Node 模式静默退出，假绿） |

## 六、QM-4（视觉）

- 本 PR 不改渲染层 DOM/CSS；视觉回归 N/A；QG Visual 仍随 PR 跑全量。

## 七、QM-6（深度评审）

- 待提交时由 CCG 门禁判定；若判定需要评审，按 `scripts/deep-review.sh` 执行并回写本节。

## 八、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | `story2video:generate-scene-*` / `recompose-project` 等已有项目内编辑通道 | 后续按需 |
| 2 | `auto-pipeline:start` 自动化配额 | P1-4 |
| 3 | 知识库 `knowledge_base` feature | P1-2 |
| 4 | 定时任务/自动化/积分/设备数 | P1-3~P1-6 |

## CHANGELOG 条目

# 视频创作 IPC 硬门禁：免费档无法绕过 UI 启动创作

- `pipeline:start` / `pipeline:startOrchestrated` / `render:start` / `render:start-ai-video` / `story2video:batch:create` 在 IPC 层强制 `video_create`
- 无权益返回 `ENTITLEMENT_REQUIRED`（code -3），handler 不执行；收尾/取消/查询通道保持登录即可
- QM-1：Electron unpacked 构建、asar 清单、rpa-engine require 链、8 秒启动 + stderr 0 全部通过
- 测试：access-control 48 例；access-control + pipeline + render 156 例
