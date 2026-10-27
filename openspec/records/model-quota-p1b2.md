---
record: model-quota-p1b2
task: P1b-2a 设置 IPC/preload + ModelQuotaPolicyCard
date: 2026-10-27
branch: model-quota-p1b2
---

## 本次执行记录：P1b-2a 设置 IPC/preload + 策略卡片（model-quota-p1b2，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1b2`（D 盘，非 C）+ 裸分支 `model-quota-p1b2`；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | P1b-1 只有后端决策器，渲染端没有任何策略读写通道；用户无法选择 ask/official/byok，也无法设置单任务积分上限，Coordinator 的设置键在生产中永远读默认值。 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸链：① IPC 层：没有 `model-quota:*` handler，渲染端调用会得到 Electron 原生 "No handler registered"；② preload 层：没有 `modelQuota` API，UI 无法跨 contextBridge；③ 权限层：新通道未登记 public/authenticated，可能把写操作误暴露；④ UI 层：没有策略卡片，设置不可达。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `model-quota.test.js` 9 例（默认值/已保存值/合法写入/非法值/decide 枚举/switch-back/store 缺失/官方状态降级/写失败回滚）；`ModelQuotaPolicyCard.test.js` 5 例（隐藏态/官方可用/读取失败可见/保存/cap 边界）；`model-quota-labels.test.js` 5 例；preload/access 既有套件补 5 个方法断言。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① `set-policy` 非法值断言“不写 store”；② `get-policy` 官方状态失败降级不断言抛错；③ preload 方法数/总键数硬锁同步更新；④ public 通道映射测试锁 `model-quota:get-policy` 为 public；⑤ 卡片隐藏态有专门用例，避免 P2 前空承诺。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` exit 0（2555 modules）；`pnpm exec electron-builder --win --dir --publish never` exit 0；asar 命中 `electron/services/logger.js`；`require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 8 秒存活、stderr 0 字节。 |
| QM-2 代码必检项 | ✅ | `eslint` 变更文件 exit 0；无硬编码密钥、无 `eval`、无生产 `console.log`；IPC 全部 `withSenderCheck`；`set/decide/switch-back` 不在 public 列表；渲染层走 `src/api/model-quota.js`，`check-frontend-consistency` PASS（rendererIpcDirect 0 / 基线 0）；`ipc-exposure-contract.test.js` 已登记 `model-quota.js`，20/20 PASS。 |
| QM-4 视觉 | N/A（当前不可见） | 卡片仅在 `officialStatus.available=true` 或 policy≠ask 时显示；P2 前官方恒不可用，默认 ask 下整卡隐藏，没有新增可见界面。组件单测覆盖隐藏/显示/保存三态。 |
| QM-6 CCG 评审 | 由 pre-commit 判定 | 本 PR 若触发 deep review，按仓内 `deep-review` 流程执行；不以自审冒充通过。 |
| 单测 | ✅ | P1b-2a 定向 7 文件 460 例全绿（IPC 9 + 渲染桥 5 + preload/access/card/labels/ModelProviders 既有+新增）。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等。 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词；合并后由 merge-ledger 推导。 |

## P1b-2b 依赖交接

| P1b-2b 项 | 依赖 P1b-2a 的导出 |
|---|---|
| `ModelQuotaFallbackDialog.vue` | `modelQuotaDecisionPayload` 由 IPC `get-policy` 同形返回；`model-quota-labels.js` 的 state/reason key；locale `modelQuota.dialog.*` 待补 |
| `useModelQuotaFallback.js` | `src/api/model-quota.js` 的 `onModelQuotaRequired` 订阅 + `modelQuotaDecide` 回传；卸载时必须调用返回的 unsubscribe |
| `App.vue` 根层挂载 | `ModelQuotaPolicyCard` 的 `visible` 规则已验证；Dialog 需独立 `v-if`，不得复用卡片的隐藏条件 |
| Coordinator 生产接线 | `modelQuotaCoordinator` / `modelQuotaSwitchBack` 两个 IPC 注入点已预留，bootstrap 装配时传入即可 |
| 业务域接入 | `modelSourceOverrides` 由 P1b-1 提供；`modelQuotaSwitchBack` 需注入真实 run 生命周期 |

## CHANGELOG 条目

# feat(model): P1b-2a 模型额度兜底增加设置 IPC 与策略卡片

新增 `model-quota:get-policy` / `set-policy` / `decide` / `switch-back` 四条 IPC（`withSenderCheck` + public 读/authenticated 写），preload 暴露 `modelQuota*` 与 `onModelQuotaRequired`，`ModelProviders` 顶部挂载 `ModelQuotaPolicyCard`（三档策略 + 单任务积分上限 + 官方状态；官方不可用且 policy=ask 时隐藏）。P1b-2a 不含弹窗/App 根层挂载/Coordinator 生产实例化/业务域接入。

## learnings

### lesson: preload-method-count-tests-are-signals-not-noise

**问题**：新增 5 个 preload 方法后，`preload.test.js` 的 3 个硬编码计数（system 方法数、总键数、SYSTEM_METHODS 长度）同时红。
**根因**：这些计数是“防止方法没接上”的机械锁；新增桥接必须同次更新计数并补 invoke 转发断言，否则新方法可能只长了名字、没长通道。
**修复**：同次把 147/347/132 三个计数、5 个 SYSTEM_METHODS、4 个 invoke case 一起改；并补 `model-quota:get-policy` 的 public 通道映射断言。
**推广**：preload 计数红不是“测试太脆”，而是接线缺口告警；正确动作是同步更新计数 + 转发断言，而不是放宽断言。
