# Proposal: P2 工程质量收口（账号选择 composable / schemaVersion）

## Why

- `WorkflowAccountPicker.vue` 从 P1-8 起已独立成组件，但账号分组/搜索/最近使用/健康过滤逻辑仍在组件内，无法脱离 Vue 模板单测；`platformLabel` 在 WorkflowEditor 与 picker 各有一份。
- 旧任务配置没有 `schemaVersion`，模板已有 v2 但任务配置没有显式版本；升级时只能靠 normalize 隐式补默认值。

## What Changes

- 新增 `useAccountSelection.js`：抽离账号选择纯逻辑，组件降到 59 行；导出 `hasAccountId/accountLabel/isAccountUsable` 供复用。
- 新增 `useAccountSelection.test.js`：同平台多账号、numeric 0、toggle、搜索、全选只加可用账号。
- `workflow-schema` 增加 `SCHEMA_VERSION=2`；`validateWorkflowConfig` 返回 `config.schemaVersion=2`；`buildDefaultWorkflowConfig` 同样带版本。
- 旧配置没有 `schemaVersion` 时归一化为 2（现有 normalize 已补 scheduleRules/budget 默认值），不拒绝。

## Non-goals

- 不改变 targets 的 `{platform, accountId}` 形状。
- 不做 P2 #16 账本导出 UI、#18 E2E、#19 虚拟列表；这些仍挂账。
- 不改变模板 v2 格式（`TEMPLATE_VERSION` 独立）。

## Impact

- 账号选择逻辑可独立测试；同平台多账号仍完全自由选择。
- 任务配置有显式版本，后续迁移可判 `schemaVersion < 2`。
