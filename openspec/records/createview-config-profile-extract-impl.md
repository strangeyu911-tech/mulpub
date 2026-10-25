---
record: createview-config-profile-extract-impl
task: CreateView 拆分第一刀：配置档案域抽成 useConfigProfiles composable（实例级 + 显式 deps，状态留壳）
date: 2026-10-25
branch: createview-config-profile-extract-impl
---

## 本次执行记录：CreateView 拆分第一刀（配置档案域 → useConfigProfiles，<slug>，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：worktree `/workspace/mp-worktrees/mp-createview-config-profile-impl`（NAS，非 C 盘）+ 裸分支 `createview-config-profile-extract-impl`，base = `origin/main@e4057d7a` |
| 第一性原因（QM-5 ①） | PASS | 缺口真源 = `CreateView.vue`（main 上 5562 行）被 `check-max-lines` 的 `targets` **零容差**点名（5656 ⇒ 余量仅 94 行）；仓内定案 `01-docs/FRONTEND-FILE-SPLIT-PLAN-2026-10.md` §2.9 曾判「第 5 步不做」，2026-10-25 复评显示其**依据②（冲突频率 7/50）的前提已变**（实测 1/50，−86%）⇒ 第一刀定为 ConfigProfile 域 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链：①仓内已有 `views/video-creation/composables/` 基建但**没有**配置档案域的实现 ⇒ 缺口不被任何既有契约覆盖；②既有测试只覆盖「行为」不覆盖「**壳侧代理清单 ⇄ composable return 清单**」这份**两份手工同步的清单** ⇒ 首版漏导出 `buildPipelineConfigSnapshot` ⇒ 4 条既有测试直接红（`TypeError: this.configProfiles.buildPipelineConfigSnapshot is not a function`） |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：composable return 补 `buildPipelineConfigSnapshot`；**新增结构锁 3 条**（代理数=19 / 代理名 ⊆ return 名 / return 名 ⊆ 代理名）机械锁住两份清单；回归：新测试 `CreateView.config-profile-composable.test.js` **24/24 绿**（含 4 道校验 + 1 并发守卫 + 桥接同引用 + 壳接线 3 条 + 结构锁 3 条）；既有回归 **315/315 绿**（6 文件，含 `CreateView.test.js` / `config-profile-handoff` / `s2v-panel-contract.parent-keys`） |
| 防止再次发生（QM-5 ⑤） | PASS | ①「两份清单手工同步」改由**结构锁**承担（读源码比对，未来删/改名任一侧都当场红）；②代理方法一律 `(...args) { return this.configProfiles.X(...args) }` 形态，缺导出表现为 TypeError 而非静默降级；③**文案零中文字面量**纪律落地为机制：新文件 CJK 命中 0，`--cjk` 门禁读数「基线 1330 / 当前 1091 / 无新增硬编码」 |
| 行尾与 diff 对账 | PASS | `CreateView.vue` 5562 → 5361 行（**净减 202**，targets 零容差 ⇒ 只减不增安全）；新文件 `useConfigProfiles.js` 373 行（< 499）、`CreateView.config-profile-composable.test.js` 501 行（< 1500）；两口径 numstat 一致（删除数归因 = 搬走的 21 个方法 + 4 个 API import） |
| 接线棘轮 | PASS | 新测试落在 `apps/desktop/src/views/` ⇒ `apps/desktop/vitest.config.js` 的 `include` 含 `src/**/*.test.{js,ts}`（白名单已覆盖，无需登记）；**「新增叶子模块单测全绿 ≠ 已接线」**已由 Part B「壳接线证明」3 条覆盖（mount 真实 CreateView：代理转发到 composable、状态仍在壳 `data()`、列表加载真打到 API 层） |
| QM-1 打包 / QM-4 视觉 | N/A | 本刀**不抽模板、不改任何 `.vue` 模板与样式** ⇒ 界面零变更 ⇒ 无像素基线需刷新（`CreateView` 亦无像素基线文件）；`useConfigProfiles` 落在 `src/views/video-creation/composables/`（非 `electron/services/**`）⇒ 走 vitest 风格 ✔ |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper` ⇒ 如实记「未执行」，不自审冒充通过；替代：4 组**变异验证**（M1 去掉名称校验 / M2 去掉并发守卫判定 / M3 `get` 返回 spread 副本破坏桥接契约 / M4 composable 少导出）**4/4 全部被抓住**，每步还原后基线绿 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；合并后 main push 的回读证据写在 PR 评论里，不写回本文件 |

### 遗留（不假装已闭合）

- **代理层未撤除**：19 个壳侧同名代理仍在 `CreateView.vue`（过渡机制）。每个代理须登记「→ 计划删除 PR 编号」映射后逐个撤除；本刀**不**做撤除（撤除需另起 change，且要与「代理残留数 ≤ 当前未完成步数」指标同步）。
- **`_applyS2VSnapshotObject` 仍在壳内**：它与「恢复上次选项」历史域（`restoreS2VLastOptions`）共用 ⇒ 跨域过深，**本刀明确留壳**；composable 经 `deps.applySnapshotObject` 调用它（编排型快照的整对象恢复通道）。同理 `normalizeS2VRestoredEnums` 留壳。
- **`useS2vConfig` 与 QuickRender 域维持不做**（复评结论：前者相对触点最重，后者冲突频率 0/50）。
- **未做视觉回归**（QM-4）：本刀界面零变更，且 `CreateView` 无像素基线；后续刀次若涉及模板，必须与像素回归同批。

## CHANGELOG 条目

# refactor(createview): 配置档案域抽成 useConfigProfiles composable（CreateView 拆分第一刀）

- CreateView 的「保存配置 / 我的配置 / 应用 / 重命名 / 删除」整条配置档案链搬进独立 composable，主文件净减 202 行（5562 → 5361），缓解逐文件行数门禁的零容差压力。
- 行为零变化：名称校验、跨流水线拒绝、重名二次确认、并发守卫、快照套用与枚举归一化全部逐字保持；界面与提示文案不动。
- 形态与仓内既有 composable 不同：实例级 + 显式依赖，状态留在组件 `data()`，不引入模块级单例与全局兜底。

## learnings

### lesson: two-hand-synced-lists-need-a-mechanical-lock

**现场**：给 CreateView 抽 composable 时，壳侧 19 个同名代理用脚本批量插入，composable 的 `return` 清单手写 —— 两份清单**没有任何机制保证一致** ⇒ 首版漏导出 `buildPipelineConfigSnapshot` ⇒ 4 条既有测试红在 `TypeError: this.configProfiles.buildPipelineConfigSnapshot is not a function`。

**根因**：**两份手工同步的清单**是这类改造的固有产物；而「代理转发到不存在的导出」表现为**运行时 TypeError**（不是静默降级），只有当旧测试恰好覆盖到那个方法才会暴露。

**可复用的 N 条**：

1. 凡是「**一份清单 + 一份实现**」手工同步的地方（如代理表 ↔ 导出表、白名单 ↔ 登记表、路由表 ↔ 处理器表），**必须配一条机械锁**（读两侧源码比对集合关系），而不是靠评审眼力。
2. 机械锁要**双向**：漏导出（代理 ⊄ 导出）与死导出（导出 ⊄ 代理）都要红 —— 单向只抓一半。
3. 锁本身也要变异验证：故意让两侧不一致，锁必须红。
4. 代理/转发层统一用 `(...args) { return target.X(...args) }` 形态 ⇒ 缺导出时是 **TypeError**（响亮）而不是静默返回 undefined（哑）。
