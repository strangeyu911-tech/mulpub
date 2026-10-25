# Change: createview-config-profile-extract-impl

## Why

`apps/desktop/src/views/CreateView.vue` 在 main 上 **5562 行**，被仓内门禁 `check-max-lines` 的
`targets` **零容差**点名（目标 5656 ⇒ 余量仅 94 行）⇒ 再加功能就会顶红「债务熔断检查」
（required 上下文 ⇒ 连带 `Gate Result` 红 ⇒ 冻住全仓 PR）。

已归档的 `createview-config-profile-extract` change 已把**第一刀定案为 ConfigProfile 域**
（复评显示定案 §2.9 的「不做」其**依据②（冲突频率 7/50）的前提已变** ⇒ 实测 1/50，−86%）。
本 change 执行该定案的**实现**。

## What Changes

- 新增 `apps/desktop/src/views/video-creation/composables/useConfigProfiles.js`（373 行）：
  配置档案 **CRUD + 套用 + 重命名 + 删除 + 路由套用**的 21 个域内专有方法；
  **实例级**（每次组件实例化一份，deps 闭包捕获）+ **显式 deps 9 项**；
  **状态留在壳的 `data()`**（`data.size` 不变）⇒ 不引入模块级单例与 `window.__*` 全局兜底。
- 改 `apps/desktop/src/views/CreateView.vue`：**净减 202 行**（5562 → 5361）；
  留壳 4 个跨域共用方法（`_applyS2VSnapshotObject` / `normalizeS2VRestoredEnums` /
  `restoreS2VLastOptions` / `_applyS2VSnapshot`）；新增 19 个同名代理（过渡层）与 `created()` 实例化。
- 新增 `apps/desktop/src/views/CreateView.config-profile-composable.test.js`（501 行 / 24 例）：
  Part A 单元（4 道校验 + 1 并发守卫 + 桥接同引用 + legacy 枚举归一化）、
  Part B **壳接线证明**（mount 真实 CreateView）、**结构锁 3 条**（代理清单 ⇄ composable return 清单）。
- PRD `01-docs/PRD-CREATEVIEW-SPLIT-REVIEW-2026-10-25.md` 追加 §6 实现章
  （含**与 design 的 6 条偏差订正**）。

## Impact

- **运行时**：行为**零变化**（4 道校验 + 并发守卫 + 提示文案与时长逐字保持；template 一行未改 ⇒ 界面零变更）。
- **不抽状态** ⇒ `data.size` 不变 ⇒ `s2v-panel-contract.parent-keys` 契约仍成立。
- **不做**：代理层撤除、三弹窗组件化、`useS2vConfig`、QuickRender、视觉回归（均已登记为遗留）。
