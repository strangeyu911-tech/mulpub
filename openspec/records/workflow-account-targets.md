---
record: workflow-account-targets
task: 复合工作流发布目标从平台选择改为账号级多选（同平台多账号）
date: 2026-10-26
---

## 本次执行记录：账号级发布目标（workflow-account-targets，2026-10-26）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：隔离 worktree `mp-worktrees/mp-workflow-account-targets`（D 盘）+ 裸分支 `workflow-account-targets`；共享根保持 main |
| QM-5 ① 第一性原因 | PASS | 首版 `WorkflowEditor.vue` 只渲染 `meta.platforms`，选中即写 `{platform, accountId:''}`；`workflow-schema` 的 publish 校验只检查平台白名单，不要求 `accountId`，于是运行时回落平台默认账号 |
| QM-5 ② 逃逸分析 | PASS | 单元层：schema 测试只断言「至少一个平台账号」，没有空/非空 accountId 用例；组件层：没有 WorkflowEditor 账号多选测试；页面层：AutomationView 测试默认配置就是空 accountId；评审层：PRD 把「同平台多账号」写成 P1，导致实现按平台建模未被质疑 |
| QM-5 ③ 系统性漏洞 | PASS | `workflow-schema.js` 把「模板」和「任务」共用同一套 publish 校验：任务需要账号、模板只需要平台建议，二者被混为一谈；UI 未接 `listAccounts()`，只能渲染平台 |
| QM-5 ④ 修复 + 回归保护 | PASS | 严格校验 `publish.targets[i].accountId`；WorkflowEditor 账号多选；AutomationTaskDialog 加载账号/模板 sanitize/保存前置校验；新增 schema、runner、WorkflowEditor、AutomationView 回归测试 |
| QM-5 ⑤ 防止再次发生 | PASS | `workflow-schema.test.js` 增加空账号拒绝 + 模板 `allowEmptyAccounts` 用例；`WorkflowEditor.test.js` 锁定同平台多账号；`AutomationView.test.js` 锁定保存 payload 必须带真实 accountId；PRD/OpenSpec 明确模板不存账号 ID |
| 行尾与 diff 对账 | PASS | `git diff --check` 无空白错误；提交前复核 numstat 两口径 |
| 接线棘轮 | PASS | 新增 `WorkflowEditor.test.js` 由 `QG Unit Tests` 的 `vitest run` 全量收集；既有 AutomationView 测试扩展 |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1：`electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS；QM-4：账号选择为既有表单控件样式，无新增可视基线组件 |
| QM-6 CCG 双模型评审 | PASS（self-play 裁决，置信 0.6） | `ccg-deep-review` 跑完 critic=claude / proposer=opencode 跨家族评审：最终 5 条发现逐条 prosecution/defense/verdict/rationale 已落盘，0 阻断，状态 `self_play_resolved`。证据：`.ccg/reviews/7f971341619e70d6b209a59f8e6e4e08e4850fa9.json`。**不冒充人工外部复核**：记录中明确标注 self-play 置信 0.6 |
| 远程同步 | 由门禁推导 | 本行不手工改写；合并后按 squash 尾注 `(#NNNN)` 由 `scripts/lib/merge-ledger.js` 推导 |

### 验证证据

- `npx vitest run electron/services/workflow electron/services/automation src/features/automation/WorkflowEditor.test.js src/views/AutomationView.test.js src/views/AutomationView.notify-registration.test.js` → **15 files / 141 tests passed**
- `pnpm run build:vue` → built successfully
- `node .github/scripts/check-locale-sync.js --cjk` → PASS（1086 条，无新增硬编码）
- `node .github/scripts/check-locale-sync.js --symmetry` → PASS（61 对，drift=0）
- `node .github/scripts/check-font-size-scale.js` → PASS
- `node scripts/check-doc-abs-paths.js --all` → PASS

### 遗留（不假装已闭合）

- 旧任务若 `accountId` 为空：编辑时清空目标并提示重新选择；不会静默回落默认账号。
- 账号状态为 expired 时仍允许勾选（显示状态），发布到点会由 TaskQueue 失败并回写条目错误。

## CHANGELOG 条目

# fix(automation): 复合工作流发布目标改为账号级多选（同平台多账号，workflow-account-targets）

- 「发布目标」由平台多选改为「已添加账号」多选：按平台分组展示账号名/状态，同一平台可选多个账号。
- 任务配置强制每个非播客目标带非空 `accountId`；空账号保存/启动直接失败，不再回落平台默认账号。
- 模板只保存平台建议，不保存账号 ID；应用/导入模板后过滤空账号与已不存在账号并提示重新选择。
- 旧任务编辑时清理空账号目标并提示；PRD、OpenSpec、使用说明同步更新。

## learnings

### lesson: 账号是发布目标的最小单位，平台只是账号属性

把「发布目标」建模成平台，等于把账号选择权交给运行时的默认账号回落。同平台多账号有不同的登录态、粉丝与限流，必须由用户显式选择 `{platform, accountId}`。

### lesson: 模板与任务不能共用同一套账号校验

模板要跨机器/跨用户分发，账号 ID 是本地私有数据。模板允许 `accountId` 为空（平台建议），任务必须非空；用 `allowEmptyAccounts` 显式区分两种语义，而不是放宽任务校验。

### lesson: 测试夹具里的空 accountId 会掩盖默认账号回落

所有既有测试都用 `accountId: ''` 且断言通过，说明测试只验证了「平台白名单」，没有验证「发布到哪个账号」。修复时先补空账号拒绝与同平台多账号 payload 断言，再改实现。
