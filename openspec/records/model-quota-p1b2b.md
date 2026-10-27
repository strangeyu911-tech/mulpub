---
record: model-quota-p1b2b
task: P1b-2b 兜底弹窗 + App 根层 + useModelQuotaFallback
date: 2026-10-27
branch: model-quota-p1b2b
---

## 本次执行记录：P1b-2b 兜底弹窗 + App 根层（model-quota-p1b2b，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1b2b`（D 盘，非 C）+ 裸分支 `model-quota-p1b2b`；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | P1b-2a 只有设置入口，`model-quota:required` 事件没有渲染端消费者：Coordinator 未来发出请求时，用户看不到弹窗、无法回传 decision，任务只能超时取消。 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸链：① composable 层：没有 `currentRequest` 状态机与 `modelQuotaDecide` 回传；② UI 层：没有 `ModelQuotaFallbackDialog`，事件无出口；③ App 层：根层未挂载，非当前路由页面收不到；④ 语义层：Coordinator 把 `remember + cancel` 写成 `policy=byok`，与 PRD §7.2「取消不写 policy」相反。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `useModelQuotaFallback.test.js` 5 例（订阅/成功清空/失败保留/settings/卸载退订）；`ModelQuotaFallbackDialog.test.js` 5 例（隐藏/信息/官方禁用/取消/remember+settings）；`model-quota-coordinator.test.js` 新增 2 例（cancel+remember 不写、settings+remember 写 byok）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① `requestId` 一次性 + 成功清空防重复点击；② 卸载必须 unsubscribe 有专门用例；③ 官方不可用按钮禁用 + 原因可见；④ PRD §7.2 remember 语义有 2 例锁定；⑤ P1b-2b/P1b-2c 边界写入 PRD/tasks，避免把生产接线误报为已完成。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` exit 0；`pnpm exec electron-builder --win --dir --publish never` exit 0；asar `require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 8 秒存活、stderr 0 字节。 |
| QM-2 代码必检项 | ✅ | `eslint` 变更文件 exit 0；无硬编码密钥、无 `eval`、无生产 `console.log`；渲染层走 `src/api/model-quota.js`；`check-frontend-consistency` 预期 PASS。 |
| QM-4 视觉 | ✅（默认隐藏） | 无 request 时 Dialog 不渲染 DOM；App 根层只增加一个空 Teleport，视觉基线不变。有 request 的交互由组件单测覆盖。 |
| QM-6 CCG 评审 | 由 pre-commit 判定 | 本 PR 若触发 deep review，按仓内 `deep-review` 流程执行；不以自审冒充通过。 |
| 单测 | ✅ | P1b-2b 定向 19 例全绿（composable 5 + dialog 5 + coordinator 9）。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等。 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词；合并后由 merge-ledger 推导。 |

## CHANGELOG 条目

# feat(model): P1b-2b 模型额度兜底增加全局弹窗与选择状态机

新增 `useModelQuotaFallback`（订阅 `model-quota:required`、维护 request、回传 official/settings/cancel）与 `ModelQuotaFallbackDialog`（provider/model/错误类型/积分/余额/cap、官方禁用原因、记住选择、ESC/遮罩取消），在 `App.vue` 根层挂载；选择「去更新模型设置」直接落到设置 → 模型。修正 Coordinator `remember + cancel` 误写 `policy=byok`，改为仅 `remember + settings` 写入。

## learnings

### lesson: event-driven-dialog-must-own-request-lifecycle

**问题**：只做弹窗组件、不维护 `currentRequest` 时，事件到达后无法判断「当前该回传哪个 requestId」，重复点击会重复 decide。
**根因**：`model-quota:required` 是一次性请求，UI 只存展示字段、不存生命周期状态，就无法保证 requestId 一次性与卸载退订。
**修复**：composable 统一维护 `currentRequest/deciding/failed`，成功即清空，卸载取消订阅；组件只消费状态。
**推广**：所有「main 发一次性请求、renderer 回 decision」的弹窗，都必须有 request 生命周期 composable，不能把状态散在组件里。
