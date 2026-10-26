# Design: 账号级发布目标

## D1 目标身份 = `platform + accountId`

`publish.targets` 的元素仍是 `{ platform, accountId }`，但语义从「平台 + 可选账号」改为「一个具体账号」：

- `accountId` 非空是目标有效的必要条件（播客除外）。
- 去重键 `platform|accountId`，同平台不同账号是不同目标。
- 节奏 pacer 以 `platform:accountId` 为队列，同账号串行、不同账号并行。

## D2 模板只存平台建议

模板需要跨机器/跨用户分发，账号 ID 是本地数据，不能进模板。因此：

- 模板校验使用 `allowEmptyAccounts: true`，允许 `accountId` 为空。
- 模板保存/导出时把 target 的 `accountId` 置空，只保留 `platform`。
- 应用模板时：空账号 target 转为平台建议提示，不进入任务目标；已不存在的账号 target 同样丢弃并提示。
- 任务校验使用默认严格模式，空 `accountId` 直接失败。

## D3 UI 数据流

```
AutomationTaskDialog onMounted
  ├─ getWorkflowMeta()         → 平台标签/枚举
  ├─ listWorkflowTemplates()   → 模板
  └─ listAccounts()            → 账号（id/platform/name/status）
        ↓
WorkflowEditor :accounts
  ├─ 按 platform 分组渲染账号 chips
  ├─ 勾选 → targets.push({platform, accountId})
  └─ 取消 → targets.splice
        ↓
save() 前置校验：非播客至少一个 target，且每个 accountId 仍存在
        ↓
automationCreate/Update → workflow-schema 严格校验 → runner
```

## D4 旧数据迁移

读取 `compositeWorkflow` 任务时：

- 空 `accountId` 或账号已不存在的 target 从编辑态移除；
- 弹窗提示「模板建议平台：…；应用后请选择具体账号」或「部分目标账号已不存在，请重新选择」；
- 用户重新选择账号后才能保存；运行时 `validateWorkflowConfig` 也会拒绝空账号，避免静默回落默认账号。

## D5 失败与提示

| 场景 | 提示 |
|------|------|
| 未选任何账号 | 请选择至少一个发布账号（不能只选平台） |
| 账号列表为空 | 还没有已添加的自媒体账号，请先到「账号管理」添加。 |
| 账号读取失败 | 账号列表读取失败，请关闭弹窗后重试。 |
| 模板只带平台 | 模板建议平台：{platforms}；应用后请选择具体账号。 |
| 账号已删除 | 部分目标账号已不存在，请重新选择。 |
