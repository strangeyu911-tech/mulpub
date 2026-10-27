---
record: pipeline-smoke-provider-audit
task: 流水线 E2E 冒烟增量 3——provider 就绪审计，修正 READY 误报，接入应用 SQLite 模型配置只读检查
date: 2026-10-27
---

## 本次执行记录：provider 就绪审计（pipeline-smoke-provider-audit，2026-10-27）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 开发工具 + 测试 + 文档（`apps/desktop/scripts/pipeline-smoke/**`、`apps/desktop/electron/tests/**`、`01-docs/**`、`openspec/**`）⇒ 隔离 worktree（D 盘非 C，路径以 `git rev-parse --show-toplevel` 实证）、裸分支 `pipeline-smoke-provider-audit`（`git rev-parse --abbrev-ref HEAD` 实证） |
| 第一性原因（QM-5 ①） | ✅ | 增量 1 的 `READY` 只看接线/驱动/工具/输入，未检查应用模型 provider。实测 `%APPDATA%/@multi-publish/desktop/multi-publish.db` 只有 `minimax-image`（image）一个可用 provider，但审计仍把 `animated-explainer`（llm+image）、`avatar-spokesperson`（llm+video）、`character-animation`（llm+video）、`localization-dub`（llm）、`story2video-compose`（image+video）标为 READY。根因是把「阶段能装配」当成「模型能力可用」。 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：audit 测试只 mock `toolExists/inputExists`，没有 provider 维度；②**审计层**：`capabilities` 只展示不判定；③**运行层**：真实执行前由 `pipeline-model-preflight` 拦截，但审计报告先给了 READY，误导排期；④**数据层**：应用 DB 的加密 key 长度可只读判断，无需解密。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `provider-readiness.js`（sql.js 只读、不解密 key、enabled+key 才计入）；`audit --with-providers` / `--providers-db`；缺能力 → `BLOCKED(MISSING_PROVIDER)`；`pipeline-smoke-audit.test.js` +4 例（24 例全绿）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①默认审计保持静态；②`--with-providers` 显式开启 provider 检查，DB 缺失/损坏退出码 2；③报告 `providerChecked=true` + `PROVIDERS usable=N caps=...`；④PRD 明确「READY 只代表静态条件」并新增实测表。 |
| 行尾与 diff 对账 | ✅ | 见「验收证据」的 numstat 两口径实测 |
| 接线棘轮 | ✅ | 新增测试位于 `electron/tests/`，命中既有 include 白名单；未新增目录级白名单需求 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未改 `apps/desktop/electron/**` 运行时、未改 renderer/样式/模板；仅开发脚本、测试与文档。 |
| QM-6 CCG 双模型外部评审 | ✅ | claude（critic）+ opencode（proposer）双模型审查；5 条争议全部 `dismissed`（逐条见 `.adversarial/ccg-deep-0ba2a65c/adjudication.json`），`deepReview.status=self_play_resolved`、`performedBy=self-play`；无阻断项 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件

### 一、改动清单

- `apps/desktop/scripts/pipeline-smoke/provider-readiness.js`（新增）
  - `defaultProviderDbPath()`：win32/macOS/Linux 的 `@multi-publish/desktop/multi-publish.db`；
  - `parseCapabilities(category, config)`：category + `config.capabilities` + `config.capability_models`；
  - `readProviderInventory({dbPath})`：sql.js 只读，返回 `{dbPath, providers, usable}`；
  - `capabilitiesFromInventory(inventory)`：enabled+hasKey 的 provider 能力并集。
- `apps/desktop/scripts/pipeline-smoke/audit.js`
  - `--with-providers` / `--providers-db <path>`；
  - `auditAll({ providerCapabilities })`；缺能力 → `BLOCKED(MISSING_PROVIDER)`；
  - 报告 `providerChecked`；CLI 打印 `PROVIDERS ...`。
- `apps/desktop/electron/tests/pipeline-smoke-audit.test.js`：+4 例。
- `01-docs/PRD-PIPELINE-E2E-SMOKE-2026-10-27.md`：增量 3 契约 + 实测结果。
- `openspec/changes/pipeline-smoke-provider-audit/proposal.md`（新增）

### 二、验收证据

- `pnpm exec vitest run electron/tests/pipeline-smoke-audit.test.js` → **24 passed**
- `node apps/desktop/scripts/pipeline-smoke/audit.js --with-providers`（本机）：
  - `PROVIDERS db=%APPDATA%\\@multi-publish\\desktop\\multi-publish.db usable=1 caps=image`
  - `SUMMARY total=15 ready=5 blocked=9 broken=0 excluded=1`
  - `animated-explainer` → `BLOCKED(MISSING_PROVIDER: llm)`
  - `avatar-spokesperson` / `character-animation` → `BLOCKED(MISSING_PROVIDER: llm, video)`
  - `localization-dub` → `BLOCKED(MISSING_PROVIDER: llm)`
  - `story2video-compose` → `BLOCKED(MISSING_PROVIDER: video)`
- `node --test scripts/check-doc-abs-paths.test.js` → fail 0
- `node .github/scripts/check-max-lines.js` → ✅ 无新增超大文件
- `pnpm exec eslint scripts/pipeline-smoke/*.js electron/tests/pipeline-smoke-audit.test.js` → 0 errors

### 三、边界

- 只判断「应用 DB 中是否存在 enabled + 有 key 的 provider」，不验证 key 是否有效、额度、base_url、模型名、网络。
- 不解密 API Key、不输出任何 secret；只读打开 DB。
- provider 缺失是环境问题，不是代码缺陷：默认 `audit` 仍只对 BROKEN 失败；`--strict` 可把 BLOCKED 判失败。
- `podcast-repurpose` 需要 image，本机已有该能力，但仍缺 E2E 驱动；其余 3 条 animation/documentary/hybrid 缺 LLM/VIDEO。

### 四、后续增量

1. `podcast-repurpose` 单条驱动（image 已具备）。
2. `animation` / `documentary-montage` / `hybrid` 需先配置 LLM/VIDEO provider，再补驱动。
3. 把 `--with-providers --strict` 接入发版前 checklist。

## CHANGELOG 条目

# provider 就绪审计（pipeline-smoke-provider-audit）

新增只读模型 provider 检查：`audit --with-providers` 读取应用 SQLite（不解密 key），把缺 LLM/VIDEO 等能力的流水线标为 `BLOCKED(MISSING_PROVIDER)`；修正此前 9 条 READY 的误报，本机实测 `ready=5 blocked=9 broken=0 excluded=1`。

## learnings

### lesson: ready-without-provider-is-false-green

「阶段能装配」不等于「模型能生成」。审计必须把 provider 能力纳入 READY 判据；只读 key 长度 + enabled 即可判定，不需要解密或真实调用。否则报告会把「缺 Key」误报成「可执行」，排期与验收都会失真。

### lesson: read-only-provider-audit-must-not-leak-secrets

审计只读 DB、只取 `length(api_key)` / `length(api_key_enc)`，绝不解密或打印 key；能力集只来自 enabled 且有 key 的 provider。这样既能在 CI/开发机安全运行，也不会把凭据带入日志。
