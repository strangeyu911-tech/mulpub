# tasks — kit-import-rollback-and-template-health

> 方案：`proposal.md`（同目录）。行数为实测。
> ⛔ 不动 `importKit` 的锁 / 白名单 / R0 / 哈希对账 / 审计语义；只改「`.bak` 何时删」与体检字段。

## 1. P1 模板结构判据（单一真源）

- [x] 1.1 **RED** `script-adapt.test.js`：`analyzeTemplatePrompt` 四字段逐条
  - 有 `INT.` 首行 ⇒ `hasSceneHeading: true`
  - 含 `[CHARACTER: ROKO]` ⇒ `hasCharacterLine: true` + `characterLineCount: 1`
  - 含空行分块 ⇒ `blockCount >= 2`
  - 纯散文（无场景头/无角色行/无分块）⇒ 三项皆 false / blockCount **1**
- [x] 1.2 **GREEN** `script-adapt.js`：导出 `analyzeTemplatePrompt`；`buildTemplatePromptParts` **改为复用它**
  - ⚠ 复用后必须**逐字不变**：既有 `script-adapt` 全量用例仍绿（这是「抽公用」而非「改行为」的判据）
- [x] 1.3 **RED→GREEN** `kit-inspect.test.js`：`templateStructure` 四项计数正确 + 两个新告警 code 出现/不出现
- [x] 1.4 `kit-inspect.js`：逐 shot 分析 + 告警聚合（**不阻断**）

## 2. P3 资产版本可读

- [x] 2.1 **RED→GREEN** `kit-inspect.test.js`：`assetVersion` 取 `manifest.schemaVersion`；`expectedAssetVersion===1`；版本不符时 `versionMismatch:true`
- [x] 2.2 `kit-inspect.js` 加三字段（**不改变**严格校验行为）

## 3. P2 与当前资产对比

- [x] 3.1 **RED→GREEN** `film-engineering-inspect.test.js`：注入 `currentCounts` ⇒ 报告带 `compare.current` / `compare.delta`；**不注入或 service 不可用 ⇒ `compare:null`（不印 0）**
- [x] 3.2 `film-engineering-inspect.js`：从 `deps.filmEngineeringService` 取当前计数（`listScenes`/`listShots`/`listTemplateShots` 或 status），失败静默降级为 null
- [x] 3.3 `kit-inspect.js`：接受 `currentCounts` 可选入参并算 delta

## 4. P0 导入不再不可逆（本批风险最高，最后做）

- [x] 4.1 **改既有锁（说明理由）** `kit-import-swap.test.js`
  - 原「换入成功 ⇒ `.bak` 随后删除」→ 改为「成功 ⇒ `.bak` **保留**且作为 `previousBackup` 回传」
  - 原「删 `.bak` 成功 ⇒ 不留 BAK_LEFT」→ 改为「成功 ⇒ 恰好 1 份 previousBackup，且 `recoveryState` **不**为 BAK_LEFT（两个概念不许混）」
- [x] 4.2 **RED** 新增用例
  - 连续两次导入 ⇒ 任何时刻**最多 1 份** `film-kit.bak-*`
  - 第一次导入失败 ⇒ 更早的那份备份**仍在**（证明「不在 ⓪a 删」是必要的）
  - `previousBackup.path` 指向真实存在的目录，且其内容 == 上一次的旧资产（逐字节比一个哨兵文件）
- [x] 4.3 **GREEN** `kit-import-swap.js`：⑥ 步保留 + 返回 `previousBackup` + 清理**更早**的备份（精确清单，R0）
- [x] 4.4 `kit-import.js`：成功响应透传 `previousBackup`；审计行 `recovery_state` 仍只在**异常**时填
- [x] 4.5 `film-engineering-import.js`：成功信封带 `previousBackup`
- [x] 4.6 `SCHEMA.md` §11.6/§11.7：新增「上一版备份」概念，明确与 `BAK_LEFT` 的区别；§11.8 取舍补一条

## 5. 渲染端

- [x] 5.1 **RED** `FilmAssetManager.test.js`：报告显示模板结构告警 / 版本 / 对比三段；成功后提示「上一版已备份到 {path}」
- [x] 5.2 **GREEN** `FilmAssetManager.vue` + `useFilmKitImport.js`（`previousBackup` 状态）
- [x] 5.3 i18n `locales/film-engineering/{zh,en}.js` 新键**成对**

## 6. 拆分 `FilmEngineeringView.vue`

- [x] 6.1 **RED** `FilmEngineeringView.test.js`：方法论标签仍渲染（拆出后不断功能）
- [x] 6.2 **GREEN** 新增 `src/views/film-engineering/FilmDoctrinePanel.vue`，视图行数降到 **760 以下**（给后续留余量；实测起点 764）
- [x] 6.3 `check-max-lines` 绿

## 7. 门禁与交付

- [x] 7.1 本地门禁：行尾两口径 / U+FFFD+NUL / ESLint / max-lines / locale 三档 / 品牌残留 / 文档绝对路径
- [x] 7.2 影视工程域 + 渲染端 + preload + **整面装配锁**（`tests/ipc-handlers.test.js` + `performance-loop.test.js`）
- [x] 7.3 QM-1 打包 + 归属自证（含**反向断言**：`previousBackup` 在包内可命中）；QM-4 视觉
- [x] 7.4 PR → CI 全绿 → squash 合并 → main push 回读

## 验收（可执行）

| 判据 | 命令 | 期望 |
|------|------|------|
| 模板结构判据 | `vitest run electron/services/film-engineering/script-adapt.test.js` | 全绿，且既有用例**逐字不变**仍绿 |
| 体检新字段 | `vitest run electron/services/film-engineering/kit-inspect.test.js` | 全绿（含 `compare:null` 不印 0） |
| 可回滚 | `vitest run electron/services/film-engineering/kit-import-swap.test.js electron/services/film-engineering/kit-import.test.js` | 全绿（含「最多 1 份」「失败时旧备份仍在」） |
| 装配锁 | `vitest run tests/ipc-handlers.test.js electron/ipc-handlers/performance-loop.test.js` | 全绿 |
| 视图拆分 | `node .github/scripts/check-max-lines.js` | `FilmEngineeringView.vue` < 760 且不新增超大文件 |
