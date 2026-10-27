# PRD — 自定义自动化配额（P1-4，v1.0）

> **状态**：🟢 已实现（2026-10-28）
> **上游机制**：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.8 §4.3/§6.2/§10
> **数值真源**：`packages/api-publish-engine/src/auth/plan-matrix.js`
> **执行记录**：`openspec/records/member-tier-p1-4-automation.md`

---

## 1. 背景

v3.1 机制把自定义自动化定为功能+配额轴：免费 0；标准 10 条工作流 / 50 条·日；专业 50 条 / 500 条·日。此前 `workflow-service` 只有全局 `MAX_CUSTOM=50`，`workflow-schema` 只有全局 `maxDailyItems=200`，没有档位消费点——免费用户可保存自定义工作流并运行。

P1-4 目标：

1. **工作流条数**：免费 0；标准 10；专业 50。
2. **每日执行条数**：免费 0；标准 50；专业 500。
3. 客户端可见错误 + 主进程权威判定双层。

## 2. 数据契约

| 档位 | `maxWorkflows` | `automationDailyItems` | `features.automation_workflow` |
|---|---|---|---|
| 免费 | 0 | 0 | 无 |
| 标准 | 10 | 50 | 有 |
| 专业 | 50 | 500 | 有 |

`limits.max_workflows` / `limits.automation_daily_items` 随签名快照下发。

## 3. 工作流条数

`workflow-service.saveTemplate` / `importTemplate`：

```
读取 entitlement.limits.max_workflows
  ├─ 缺失/非法 → 回落全局 MAX_CUSTOM=50（不误拦旧快照）
  ├─ 0 → 新增返回 reason='plan-limit'，data={limit:0,current}
  └─ N → current >= N → reason='limit'（0 时 plan-limit），不落盘
```

- overwrite 已有模板不算新增，不受条数限制。
- `listTemplates()` 返回 `limits: { max_custom, current }`，供 UI 显示。
- 内置模板只读，不计入 custom 条数。

## 4. 每日执行条数

`workflow-runner.startRun`：

```
planLimit = entitlement.limits.automation_daily_items（缺失 → null）
  ├─ planLimit === 0 → 返回 { ok:false, error:'plan-daily-limit' }
  ├─ usedToday >= planLimit → { ok:false, error:'dailyItemLimit' }
  └─ effectiveDaily = min(config.guardrails.dailyItemLimit, planLimit)
       checkGuardrails 用 effectiveDaily 截断
```

- 计数走 `workflow-ledger.countToday()`（全局每日条目账本）。
- 工作流自身 guardrail 与套餐上限取更严者：标准 50 不能再把 guardrail 设为 500。
- 专业 500 允许 `workflow-schema.LIMITS.maxDailyItems` 提升到 500（原 200 会先把专业卡死）。

## 5. 客户端提示

| key | 中文 | English |
|---|---|---|
| `automation.wfTemplateLimit` | 自定义自动化工作流已达当前套餐上限，请升级后重试 | Custom automation workflows have reached your plan limit. Please upgrade and retry. |

保存模板失败时按 `reason` 映射：

- `name:duplicate` → `automation.wfTemplateDuplicate`
- `plan-limit` / `limit` → `automation.wfTemplateLimit`
- 其它 → `automation.errSaveFailed`

## 6. 边界

| 场景 | 行为 |
|---|---|
| 免费保存第 1 个工作流 | `plan-limit`，不落盘 |
| 标准已有 10 个，保存第 11 个 | `limit`，不落盘 |
| 标准已有 9 个，保存第 10 个 | 成功 |
| 专业 50 个 | 第 51 个 `limit` |
| 免费运行工作流 | `plan-daily-limit`，不采集/不排期 |
| 标准当日已执行 50 条 | `dailyItemLimit` |
| 专业当日 500 条 | 第 501 条 `dailyItemLimit` |
| limits 缺失/非法 | 回落全局 50 / guardrail（fail-open） |
| overwrite 已有模板 | 允许，不增加条数 |

## 7. 验收标准

- [ ] 免费保存模板：`reason=plan-limit`，custom 数量不变。
- [ ] 标准第 11 个：`reason=limit`；第 10 个成功。
- [ ] 专业第 51 个：`reason=limit`。
- [ ] 免费运行：`error=plan-daily-limit`，不调用采集/排期。
- [ ] 标准每日 50 条上限：第 51 条 `dailyItemLimit`。
- [ ] 专业 500 条配置可通过 schema 校验。
- [ ] limits 缺失时回落全局值。
- [ ] 既有 workflow-service / workflow-runner 测试不回归。

## 8. 非目标

- 不做简单自动化任务（`automationScheduler` 的 MAX_TASKS=20）的档位拆分；本切片只覆盖复合工作流。
- 不改工作流执行引擎的调度/并发。
- 不做「工作流条数」的客户端预检（主进程 reason 已可读）；后续可按需补。

## 9. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| 矩阵 | `plan-matrix.test.js` | 0/10/50、0/50/500、feature |
| 模板 | `workflow-service.test.js` | 免费 plan-limit、标准 10 上限、缺失回落 |
| 运行 | `workflow-runner.test.js` | 免费 plan-daily-limit、标准 10 更严、既有 20 上限 |
| 接线 | `phase3-services` | setEntitlementProvider 绑定 |
| 静态 | locale/max-lines/doc-abs | 文案与文件门禁 |
