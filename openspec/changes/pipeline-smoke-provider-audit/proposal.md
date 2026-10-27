# 变更提案：pipeline-smoke-provider-audit

## 为什么

`pipeline-e2e-smoke` 的 `READY` 只检查接线、驱动、工具、输入，**没有检查应用里是否真的配置了模型 provider**。实测应用 SQLite 中只有 `minimax-image` 一个可用 provider（加密 key 长度>0），但审计仍把 `animated-explainer`、`avatar-spokesperson`、`character-animation`、`localization-dub`、`story2video-compose` 标为 `READY`，属于「静态条件满足 ≠ 能真正生成」的误报。

## 变更内容

1. 新增 `apps/desktop/scripts/pipeline-smoke/provider-readiness.js`
   - 只读打开 `%APPDATA%/@multi-publish/desktop/multi-publish.db`（或 `--providers-db`）；
   - 读取 `id/category/enabled/is_default/config` 与 `api_key`/`api_key_enc` 长度；
   - **不解密、不输出 API Key**；只有 `enabled=1` 且有 key 的 provider 计入能力集；
   - `parseCapabilities()` 合并 `category` 与 `config.capabilities` / `config.capability_models`；
   - `capabilitiesFromInventory()` 汇总可用能力。
2. `audit.js` 增加 `--with-providers` / `--providers-db <path>`
   - 能力集注入 `auditAll({ providerCapabilities })`；
   - 每条流水线的 `capabilities` 与可用能力集求差，缺能力 → `BLOCKED(MISSING_PROVIDER)`，reason 点名缺失能力；
   - 报告新增 `providerChecked: true`，CLI 打印 `PROVIDERS db=... usable=N caps=...`。
3. `pipeline-smoke-audit.test.js` +4 例：能力解析、inventory 汇总、缺能力阻断、能力齐全 READY。
4. PRD 增补增量 3 契约与实测结果。

## 不做什么

- 不解密 API Key、不发起模型调用、不验证额度/网络/模型名有效性。
- 不改变默认 `audit` 行为；只有显式 `--with-providers` 才做 provider 检查。
- 不自动修复 provider 配置；缺能力仍由用户在应用「模型设置」中处理。

## 验收

- `--with-providers` 在只有 `image` 能力时：`total=15 ready=5 blocked=9 broken=0 excluded=1`；
- `animated-explainer` / `avatar-spokesperson` / `character-animation` / `localization-dub` / `story2video-compose` 均 `BLOCKED(MISSING_PROVIDER)`，reason 点名缺失能力；
- 无 provider DB / DB 损坏 → CLI 退出码 2，不静默通过；
- 能力齐全（image/video/llm/tts/speech_recognition）时，有驱动的流水线恢复 `READY`；
- 单测覆盖解析、汇总、缺能力、齐全四类；文档无绝对路径。
