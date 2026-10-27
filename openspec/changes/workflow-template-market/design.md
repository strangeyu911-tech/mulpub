# Design: 模板市场 / 团队共享 + 版本迁移

## 1. 包格式

```json
{
  "format": "mulpub-workflow-template",
  "version": 2,
  "name": "团队模板",
  "description": "可选",
  "config": { "...": "workflow config" },
  "exportedAt": "2026-10-27T12:00:00.000Z"
}
```

- `format` 防止把任意 JSON 当模板；
- `version` 是迁移唯一依据；
- `exportedAt` 只做审计，不参与校验；
- `name` 1–40 字符；`description` 最多 200 字符；`config` 必须通过 `validateWorkflowConfig(..., {allowEmptyAccounts:true})`。

## 2. v1 → v2 迁移

| 字段 | 规则 |
| --- | --- |
| `source` | 缺省 `type:'hotTopics'`，数组缺省 `[]`，其余字段交给 schema 默认值 |
| `rewrite` | 缺省 `mode:'default'`、`length:'keep'` |
| `content` | 缺省 `type:'article'` |
| `publish` | 缺省 `mode:'immediate'`；targets 字符串 → `{platform, accountId:''}` |
| `cadence/guardrails` | 缺省字段交给 schema 默认值 |
| `review/dedupe` | `requireApproval=false`、`enabled=true` |
| 未知字段 | 丢弃，避免旧脏字段污染新模板 |

迁移后统一走 `validateWorkflowConfig`；迁移不负责合法性。

## 3. 账号隔离

`normalizeTargets` 与 `sanitizeTemplateConfig` 强制 `accountId:''`：
- 导出：模板不应携带本机账号；
- 导入：即使对方包里带了 accountId，也清空；
- 应用模板后由用户重新选账号。

## 4. 导入流程

1. 读取文件（UTF-8 JSON）。
2. `migrateTemplatePayload`：解析/格式/版本/名称校验。
3. `validateWorkflowConfig`：配置合法性。
4. 构造预览：`{name, conflict, suggestedName, migratedFrom, summary}`。
5. `dryRun` 直接返回，不写 settings。
6. 冲突处理：
   - 默认返回 `name:duplicate` + preview；
   - `rename:true` 使用 `uniqueName` 生成「原名（导入 2）」；
   - `overwrite:true` 更新同 id 模板。
7. 保存后返回 `{ok, template, preview}`。

## 5. UI 交互

- 模板下拉选中后「导出模板」可用；内置模板也可导出。
- 「导入模板」是隐藏 file input 的 label，选择 `.json` 后自动执行。
- 成功：`notifySuccess('automation.wfTemplateImported', {name})` 并刷新下拉。
- 失败：
  - 版本过新 → 「模板版本过新，请升级应用后再导入」；
  - 其他 → 「模板导入失败：文件不是有效的模板 JSON」。
- 导入不会自动应用模板，用户需再点「应用」。

## 6. 错误与边界

| 场景 | 返回 |
| --- | --- |
| JSON 坏 | `invalid-json` |
| 非对象/缺 config | `invalid-shape` |
| 缺 name / 超长 | `name:empty` / `name:tooLong` |
| 版本 >2 | `unsupported-version` |
| format 不符 | `unsupported-format` |
| 配置非法 | `invalid-config` + errors |
| 重名未指定策略 | `name:duplicate` + preview |
| 自定义模板达 50 | `limit` |

## 7. 测试

- `workflow-template.test.js`：v1 迁移、v2 格式、账号剥离、未来版本、命名。
- `workflow-service.test.js`：导出 v2、dryRun 不落盘、rename、旧自定义模板迁移。
- `useTemplateTransfer.test.js`：导入成功/版本过新/导出下载。
- build、locale symmetry、max-lines、QM-1。
