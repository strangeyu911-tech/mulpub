# Design: 账号选择 composable / schemaVersion

## 1. useAccountSelection

输入：
- `accounts: Ref<Array>`；
- `targets: Ref<Array<{platform,accountId}>>`（defineModel 的 ref）；
- `meta: Ref<{platforms}>`。

输出：`accountSearch/recentAccounts/accountGroups/filteredAccountGroups/usableCount/unusableCount/selectedCount`
+ `platformLabel/accountStatus/accountLabel/isAccountUsable/hasAccount/toggleAccount/selectAllVisible/clearAccounts`。

规则：
- `id===0` 视为有效账号（不得 truthy 判断）；
- 失效状态来自 shared `workflow-account-status.json`；
- 同平台多账号无平台级默认限制；
- 最近使用 localStorage key `workflow_recent_accounts`，失败静默。

## 2. schemaVersion

```js
const SCHEMA_VERSION = 2
config = { schemaVersion: 2, source, rewrite, content, publish, cadence, guardrails, scheduleRules, review, dedupe }
```

- `validateWorkflowConfig` 总是返回当前版本；
- 旧配置缺字段由既有 normalize 补默认值；
- 模板版本仍由 `workflow-template.js` 的 `TEMPLATE_VERSION` 管理，两者不混。

## 3. 测试

- composable：numeric 0、同平台双账号、toggle、搜索、全选只加可用。
- schema：旧配置无 schemaVersion → 2；默认配置 → 2。
- 现有 WorkflowEditor 11 项回归保持通过。
