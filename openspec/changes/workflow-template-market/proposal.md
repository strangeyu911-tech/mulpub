# Proposal: 模板市场 / 团队共享 + 版本迁移（P1-7）

## Why

模板已经是自动化任务复用的基础，但当前导出包只有 `version:1` 裸对象，没有格式标识、没有旧配置迁移，也没有导入预览；跨机器/跨团队分发时，旧模板可能静默丢字段，账号 ID 也可能被带进别人机器。

## What Changes

- 模板导出升级为 v2 包：`format=mulpub-workflow-template`、`version=2`、`exportedAt`、`name/description/config`。
- 新增 `workflow-template.js`：
  - `migrateTemplatePayload` 支持 v1（含无 version 裸对象）→ v2；
  - `migrateLegacyConfig` 补齐 source/rewrite/content/publish/cadence/guardrails/review/dedupe；
  - platform-only targets → `{platform, accountId:''}`；
  - 所有导出/导入配置剥离 accountId，模板不携带本机账号。
- `workflow-service`：
  - 自定义模板读取时自动迁移并标 `version:2`；
  - `importTemplate(payload, opts)` 支持 `dryRun` 预览、`rename` 自动重名后缀、`overwrite` 覆盖；
  - `exportTemplate` 输出 v2 包；
  - 预览返回 summary、conflict、suggestedName、migratedFrom。
- UI：任务弹窗模板区新增「导出模板 / 导入模板」；导入成功后 toast 模板名；失败显示原因。
- 版本迁移：v1 导入自动迁移；未来版本拒绝并提示升级应用。

## Non-goals

- 不做云端模板市场/账号体系；团队共享走 JSON 文件。
- 不做模板评分/下载量/审核。
- 不把本机账号 ID 写进模板；应用模板后仍需用户选账号。

## Impact

- 旧自定义模板在读取时迁移，不丢字段；写回时统一 v2。
- 导入重名默认报冲突；显式 `rename` 才自动加后缀，避免静默覆盖。
- 导出包可跨机器分发，但账号仍需本机选择。
