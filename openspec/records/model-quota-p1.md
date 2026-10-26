---
record: model-quota-p1
task: 模型额度/凭据错误精确识别与可操作提示（P1a）—— 统一分类器 + 产品级 userErrorCode + 适配器 httpStatus/providerCode + 精确文案 + 前往模型设置
date: 2026-10-26
branch: model-quota-p1
---

## 本次执行记录：模型额度/凭据错误精确识别（model-quota-p1，2026-10-26）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1`（D 盘，非 C）+ 裸分支 `model-quota-p1`，未直推 main；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | 现有 `ProviderError` 只到「quota/rate/transient」重试枚举；`callAdapter` 的 ProviderError 分支只返回 `{code:-1,error,message}`，没有产品级状态、`httpStatus`/`providerCode` 分离、provider 参数。用户只能看到「请检查模型设置」，且 MiniMax 业务码 1004/2056 被塞进 `context.statusCode`，展示与排障都会错位。 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸链：① 单测层：`provider-error.test.js` 只覆盖重试分类，没有产品级状态；② 集成层：`model-provider-call-adapter.test.js` 只断言 `result.error`/`message`，没有 `errorCode`/`messageParams`；③ 渲染层：`user-facing-error.test.js` 只测数值码与旧 pattern，没有 `userErrorCode`；④ 审查层：旧注释把「quota 提示」当成纯文案，未检查 provider/model 上下文。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `model-access-failure.test.js` 21 例（7 状态 + 4 额度子类 + 供应商码 + 脱敏 + retryAfter）；扩展 `provider-error.test.js` +2；`model-provider-call-adapter.test.js` +4；`user-facing-error.test.js` +8；`AiWriterPanel.error-action.test.js` +1。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 分类器是纯函数、永不抛错、未知保守；② `errorCode` 保留历史枚举、`userErrorCode` 才是精确码，旧消费方零回归；③ `model-provider-manager` 从既有 `provider-error` require 解构，`check-debt-budget` 的 `modelProviderRequireFanOut` 保持 66=66；④ 文案走 locales 成对，`check-locale-sync --keys/--symmetry/--pair-base` 全 PASS。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` 成功；`pnpm exec electron-builder --win --dir --publish never` 成功（exit 0）；`asar list` 命中 `\electron\services\logger.js`；`asar extract` 后 `require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 启动后 **8 秒仍存活**、stderr **0 字节**（三层判据第③层）。 |
| QM-2 代码必检项 | ✅ | 自审：无硬编码密钥、无 `eval`/`Function`、无 `v-html`/`dangerouslySetInnerHTML`、无生产 `console.log`、无硬编码等待；新增错误文本经 `sanitizeErrorMessage` 脱敏（`sk-` / `Bearer` / `api_key`）并截断 500 字；IPC 形状只增字段不改旧字段。 |
| QM-4 视觉 | N/A | 本 PR 不新增/修改页面视觉布局；仅错误文案与动作按钮条件。 |
| QM-6 CCG 双模型外部评审 | ✅ 已执行（自扮演多轮，未闭合 external 档） | opencode proposer + claude critic 共 3 轮、21 findings；可修项已修复：分类器移到 `adapters/_base`（层级）、补验证证据表、`fromHttpStatus` 守卫、文本 4000 字截断、`providerCodeRules` 可注入且校验、认证错误不得升级为 quota、规则深冻结、JWT/Authorization 脱敏；剩余为规范/性能取舍（共享正则、4000 字上限、小数 Retry-After），逐条裁决见 PR 评论与 `.adversarial/ccg-deep-*`。本机无外部评审通道，最终档记为 self-play，不冒充 external。 |
| 单测（P1 核心） | ✅ | `pnpm exec vitest run` 5 文件 → **161/161 passed**（`model-access-failure` / `provider-error` / `model-provider-call-adapter` / `user-facing-error` / `AiWriterPanel.error-action`）。 |
| 单测（MiniMax 适配器） | ✅ | 4 文件 → **218/218 passed**（image / tts / video / h3-v2）；`context.statusCode` 历史断言仍绿。 |
| 单测（manager 回归） | ✅ | 4 文件 → **88/88 passed**（call-adapter / resolve-default / governor / provider-run-context）。 |
| 债务熔断 | ✅ | `node scripts/check-debt-budget.js` → 全部 PASS：`maxFileLines 5359/5638`、`filesOver1000 28/29`、`filesOver500 94/95`、`modelProviderRequireFanOut 66/66`、`circularDeps 0/0`。 |
| 测试接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → 137 个测试文件全部已接线或按欠账登记；新增 `model-access-failure.test.js` 在 `apps/` 域，由 vitest workspace 自动收集。 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS（扫描 13092 个 tracked 文件）。 |
| 文档绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js --all` → PASS（6153 个受管文件，无新增本机绝对路径）。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat origin/main...HEAD` 与 `git diff --ignore-cr-at-eol --numstat origin/main...HEAD` **两口径逐行相等**（22 个文件，+N/-M 完全一致）。 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。 |

## 验证证据（可复核命令与读数，回应深评 i2）

> 深评 i2 指出「diff 里没有 CI 产物/构建日志 ⇒ 161/161、打包通过这些断言不可验证」。以下为本地实跑命令与读数；推送后 CI 会再独立跑一遍，PR 评论会补 run URL。

| 命令 | 读数 |
|---|---|
| `pnpm exec vitest run`（5 个 P1 文件） | `Test Files 5 passed (5)` / `Tests 161 passed (161)` |
| `pnpm exec vitest run`（4 个 MiniMax 文件） | `Test Files 4 passed (4)` / `Tests 218 passed (218)` |
| `pnpm exec vitest run`（4 个 manager 回归文件） | `Test Files 4 passed (4)` / `Tests 88 passed (88)` |
| `pnpm run build:vue` | exit 0（Vite 2533 modules transformed） |
| `pnpm exec electron-builder --win --dir --publish never` | exit 0，产物 `apps/desktop/dist-electron/win-unpacked/Multi-Publish.exe` |
| `pnpm exec asar list ... \| Select-String logger` | 命中 `\electron\services\logger.js` |
| `node -e "require('<extract>/node_modules/@multi-publish/rpa-engine')"` | exit 0 |
| `Start-Process Multi-Publish.exe` + 8s | `alive_after_8s=True`，stderr 0 字节 |
| `node scripts/check-debt-budget.js` | 5 项全 PASS（fanout 66=66 / maxFileLines 5359<5638） |
| `node scripts/check-unwired-tests.js` | 137 个测试文件全部接线/登记 |
| `node scripts/check-doc-abs-paths.js --all` | PASS（6153 个受管文件） |
| `node .github/scripts/check-locale-sync.js --keys/--symmetry/--pair-base` | 三项全 PASS |
| `pnpm exec eslint <changed files> --quiet` | exit 0 |

### 遗留（不假装已闭合）

- **P1b 未实现**：设置读写（`modelQuotaFallbackPolicy` / `officialCreditCapPerTask`）、`model-quota-policy.js`、`model-quota-coordinator.js`、弹窗组件、任务级覆盖、检查点、IPC/preload。
- **P2 未实现**：官方算力代理 D-① `POST /api/v1/compute/execute`、余额读 U-13、价格卡 U-12、`official-compute-client.js`、`byok=0` 扣分。
- **P3 未实现**：自动档 `official`、任务积分上限、LLM 官方供给（U-1）。
- **未接入全部业务域**：本 PR 只把 `AiWriterPanel` 的错误卡动作接入；Story2Video / Film Engineering / 热榜 / 快速采集仍走各自既有提示，但主进程 `callAdapter` 已统一下发 `userErrorCode`，后续可逐域替换。
- **QM-6 自扮演多轮未闭合 external 档**：3 轮 21 findings，可修项已修复（层级/证据/守卫/截断/注入校验/认证边界/深冻结/JWT 脱敏）；剩余为规范与性能取舍，逐条裁决见 PR 评论与 `.adversarial/ccg-deep-*`。本机无外部评审通道，未冒充 `tier=external`；不把自扮演结果写成外部评审通过。
- 保留门禁：QM-1 ✅ | QM-2 ✅ | QM-4 N/A | QM-6 自扮演（external 未闭合） | 行尾 ✅ | 品牌 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

## CHANGELOG 条目

# feat(model): 模型额度/凭据错误精确识别与可操作提示（model-quota-p1）

- 新增 `model-access-failure.js`：把供应商错误归一为 7 个产品级状态（`quota_exhausted` / `credential_invalid` / `rate_limited` / `transient` / `content_policy` / `provider_error` / `unknown`）与 4 个额度子类（`balance` / `plan_window` / `plan_expired` / `unknown`）；未知错误保守不兜底。
- `model-provider-manager.callAdapter` 错误返回新增 `userErrorCode`、`messageParams.provider`、`accessState`、`quotaKind`、`providerCode`、`httpStatus`、`fallbackEligible`、`askOnly`；`errorCode` 保留 `QUOTA_EXCEEDED` / `AUTH_FAILED` / `RATE_LIMITED` 历史枚举，旧消费方零回归。
- `provider-error.fromHttpStatus` 新增 `httpStatus` 维度；MiniMax 图片/TTS/视频适配器把 HTTP 200 与业务码（1004/2056）分开写入 `httpStatus` / `providerCode`，`statusCode` 保留兼容。
- 渲染端新增五条成对文案：`MODEL_QUOTA_EXHAUSTED` / `MODEL_QUOTA_PLAN_WINDOW` / `MODEL_QUOTA_PLAN_EXPIRED` / `MODEL_CREDENTIAL_INVALID` / `MODEL_RATE_LIMITED`；`formatUserError` 优先使用 `userErrorCode`，未知时回落 `errorCode`。
- `AiWriterPanel` 对额度/凭据精确码显示「前往模型设置」动作；`MODEL_RATE_LIMITED` 不给按钮（限流的解决路径不是改设置）。
- 本 PR 不含官方模型兜底、设置项、弹窗、任务级覆盖；这些仍按 D-11 等官方算力代理 D-①。

## learnings

### lesson: product-error-code-must-not-replace-legacy-error-code

**现场**：`story2video-notifications.js:131` 用 `notification.errorCode === 'QUOTA_EXCEEDED'` 判断额度通知；如果 `callAdapter` 把 `errorCode` 直接改成新的 `MODEL_QUOTA_EXHAUSTED`，这条既有链路会静默漏掉额度通知。另一侧，MiniMax 把业务码 1004/2056 写进 `context.statusCode`，如果产品级分类器直接拿 `statusCode` 当 HTTP 状态，就会把 HTTP 200 的额度错误展示成「HTTP 2056」。

**根因**：错误对象同时承载三种语义——重试分类、HTTP 传输状态、供应商业务码。三者被塞进同一个 `statusCode` 字段后，任何消费方都只能猜；而「新增精确码」如果直接替换旧码，等于让旧消费方承担迁移成本。

**可复用的 3 条**：

1. **新增产品级码必须与历史 `errorCode` 并存**：`errorCode` 保留旧枚举供既有消费方识别，`userErrorCode` 是新精确码；渲染端按 `userErrorCode → errorCode` 顺序解析。不要用「新码替换旧码」做升级。
2. **HTTP 状态与供应商业务码必须分字段**：`httpStatus` / `providerCode` 各存一份，`statusCode` 只能作兼容字段；适配器在 HTTP 200 + 业务码场景必须显式写 `httpStatus: 200`。
3. **产品级分类器与重试分类器分开实现**：前者面向用户动作（额度子类、凭据是否可自动切、预估成本），后者面向重试/熔断；两套枚举可由测试锁交集，但不要互相 require 或互相冒充。
