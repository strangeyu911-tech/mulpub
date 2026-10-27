# Tasks — model-quota-fallback

> 进度以本文件为唯一来源。每组任务 ≤ 一个会话。
> **P0 只做文档**；P1/P2/P3 的代码任务在对应 PR 中勾选，本 PR 不勾。

## 1. 规格与文档（P0，本 PR）

- [x] `01-docs/PRD-MODEL-QUOTA-FALLBACK-2026-10-26.md`：三问结论、错误状态机、三档设置、任务级覆盖、数据校验 V-01~V-15、验收 AC-01~AC-20、未决 U-1~U-6
- [x] `01-docs/DESIGN-MODEL-QUOTA-FALLBACK-2026-10-26.md`：模块边界、接口契约、时序、错误分类细节、测试策略、回滚
- [x] `openspec/changes/model-quota-fallback/`：proposal / design / tasks
- [x] `01-docs/PRD.md`：追加附录（摘要 + 链接 + 【规划中】标注）
- [x] `01-docs/decision-log.md`：追加 D-041
- [x] `openspec/records/model-quota-fallback.md`：docs-only 执行记录
- [ ] CHANGELOG 未发布段 —— ⛔ 由执行记录聚合，**不要**在本 PR 直接改（`check-no-hot-carrier-edit.js` 判热写面）

## 2. P1a：错误分类 + 精确提示（本 PR 已实现）

### 2.1 TDD：先写失败测试

- [x] `apps/desktop/electron/services/model-access-failure.test.js`（新增，21 例）：401/402/429/400/500/0；OpenAI/Anthropic/Gemini/DeepSeek/MiniMax/OpenRouter 业务码；文本兜底；unknown；脱敏；retryAfter 边界
- [x] `apps/desktop/electron/services/adapters/_base/provider-error.test.js`（扩展，+2 例）：`httpStatus` / `providerCode` 字段；`statusCode` 向后兼容
- [x] `apps/desktop/electron/services/model-provider-call-adapter.test.js`（扩展，+4 例）：`errorCode` 保留历史枚举 + `userErrorCode` 精确码 + `messageParams.provider` + `askOnly`/`fallbackEligible`
- [x] `apps/desktop/src/utils/user-facing-error.test.js`（扩展，+8 例）：`userErrorCode` 优先；五条精确码中英文案；未知 userErrorCode 回落 errorCode
- [x] `apps/desktop/src/components/AiWriterPanel.error-action.test.js`（扩展，+1 例）：额度/凭据码给动作；限流不给

### 2.2 主进程实现

- [x] `apps/desktop/electron/services/model-access-failure.js`（新增）：纯函数分类器 + 脱敏 + retryAfter + 额度子类
- [x] `apps/desktop/electron/services/adapters/_base/provider-error.js`：re-export 分类器 + `fromHttpStatus` 补 `httpStatus`
- [x] `apps/desktop/electron/services/model-provider-manager.js`：`callAdapter` 补 `errorCode` / `userErrorCode` / `messageParams` / `accessState` / `quotaKind` / `providerCode` / `httpStatus` / `fallbackEligible` / `askOnly`
- [x] `apps/desktop/electron/services/adapters/minimax-image.js` / `minimax-tts.js` / `minimax.js`：补 `httpStatus:200` / `providerCode`（保留 `statusCode`）
- [ ] `apps/desktop/electron/services/adapters/minimax-h3-v2.js`：仅消费 `statusCode`，本 PR 无新增错误构造点（复核结论：无需改）

### 2.3 渲染端实现

- [x] `apps/desktop/src/utils/user-facing-error.js`：新增 `MODEL_QUOTA_*` / `MODEL_CREDENTIAL_INVALID` / `MODEL_RATE_LIMITED` 映射 + `userErrorCode` 优先
- [x] `apps/desktop/src/locales/user-errors/zh.js` / `en.js`：五条精确文案（成对）
- [x] `apps/desktop/src/components/AiWriterPanel.vue`：额度/凭据码 →「前往模型设置」；限流不给

## 2bis. P1b：设置 + 弹窗 + 任务级覆盖（P1b-1 后端 + P1b-2a 设置 IPC/卡片已实现；P1b-2b 未实现）

> P1b-1：纯函数决策器 + Coordinator + `modelSourceOverrides`；P1b-2a：IPC/preload + 策略卡片；P1b-2b：弹窗 + 业务域接入。

### 2b.1 TDD

- [x] `apps/desktop/electron/services/model-quota-policy.test.js`（新增）：12 条决策优先级逐条；三档 × 7 状态 × official 可用/不可用 × 余额/预估组合；credential 永远 ask；cap 边界
- [x] `apps/desktop/electron/services/model-quota-coordinator.test.js`（新增）：并发去重；requestId 一次性；超时 cancel；checkpoint 调用顺序；埋点字段
- [x] `apps/desktop/electron/services/provider-run-context.test.js`（扩展）：`modelSourceOverrides` 读写/清理；既有 quota 熔断不变
- [x] `apps/desktop/src/views/model-quota-labels.test.js`（新增）：state/quotaKind/reason → locale key
- [x] `apps/desktop/electron/ipc-handlers/model-quota.test.js`（新增）：读写/非法值/未就绪降级
- [x] `apps/desktop/src/components/model-quota/ModelQuotaPolicyCard.test.js`（新增）：隐藏态/官方可用/保存/cap 边界

### 2b.2 实现

- [x] `apps/desktop/electron/services/model-quota-policy.js`（新增）：纯函数决策器 + 设置归一
- [x] `apps/desktop/electron/services/model-quota-coordinator.js`（新增）：并发/设置/事件/检查点/埋点
- [x] `apps/desktop/electron/services/provider-run-context.js`：扩展 `modelSourceOverrides`
- [x] `apps/desktop/electron/ipc-handlers/model-quota.js`（新增）：4 条渲染端通道 + `withSenderCheck`（`model-quota:required` 为 main→renderer 事件）
- [x] `apps/desktop/electron/preload/system.js`：暴露 `modelQuota` API（任务书写 `preload/index.js`，实际工厂在 `system.js`）
- [x] `apps/desktop/src/api/model-quota.js`（新增）：渲染层统一桥接，组件不直调 `window.electronAPI`
- [ ] `apps/desktop/electron/bootstrap/*.js`：实例化 Coordinator 并注入 run 生命周期（P1b-2b）
- [x] `apps/desktop/src/components/model-quota/ModelQuotaPolicyCard.vue`（新增）
- [ ] `apps/desktop/src/components/model-quota/ModelQuotaFallbackDialog.vue`（新增，App.vue 根层，P1b-2b）
- [ ] `apps/desktop/src/composables/useModelQuotaFallback.js`（新增，P1b-2b）
- [x] `apps/desktop/src/views/model-quota-labels.js`（新增）
- [x] `apps/desktop/src/views/ModelProviders.vue`：挂载 `ModelQuotaPolicyCard`（仅当 `officialStatus.available` 或政策已设置时显示）
- [x] `apps/desktop/src/locales/model-quota/zh.js` / `en.js`（新增，成对）
- [ ] Story2Video / 图片轮播 / 数字人 / Film Engineering：统一弹窗 + 检查点写 `modelSourceOverrides`（P1b-2b）
- [ ] 改写 / 热榜 / 快速采集 / 提示词引擎：只接错误码与「去更新设置」（LLM 官方供给未定）
- [ ] 模型设置「测试连接」：展示分类结果，不触发官方兜底

## 3. P2：官方算力接线（与 D-① 同批）

- [ ] ops-center `POST /api/v1/compute/execute`（D-①）
- [ ] 余额读端点（U-13）
- [ ] 价格卡（U-12）
- [ ] `apps/desktop/electron/services/official-compute-client.js`（新增）：只调 ops-center，不读官方 Key
- [ ] `usage-reporter` / `model_provider_logs`：官方调用 `byok=0`
- [ ] 扣分：复用 `POST /api/v1/credit/consume`；幂等键 `runId:stageId:attempt`
- [ ] 官方调用失败不换回 BYOK；`MODEL_OFFICIAL_*` 错误码
- [ ] 集成测试：mock official client；真实联调（需 D-① 环境）

## 4. P3：自动档全量 + LLM 官方供给（若 U-1 决定做）

- [ ] `official` 档全量开放 + 任务积分上限 + 埋点看板
- [ ] LLM 官方供给（U-1）
- [ ] 自动档灰度与回滚开关

## 5. 门禁

- [ ] `node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（P0 应为 `docs-only=true`）
- [ ] `node scripts/check-no-brand-residue.js`
- [ ] `bash scripts/check-docs-sync.sh --base=main --head=HEAD`
- [ ] `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce`
- [ ] CI 全绿后 squash 合并
