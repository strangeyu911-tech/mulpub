# kit-import-rollback-and-template-health：导入可回滚 + 模板结构判据 + 资产对比/版本 + 视图拆分

## Why

上一批（`kit-asset-health-report`，PR #4523）把入口归位到 Hub 页级并加了只读体检。用户审阅后指出**四类仍可优化**的点，本批逐条落地。每条都附**代码级证据**，不是功能愿望清单。

### 一、导入是**不可逆**的，而全仓没有任何备份/导出能力

| 事实 | 落点 |
|------|------|
| 旧资产 `.bak` 在**成功路径立即删除** | `kit-import-swap.js` ⑥ 步 → `removeTreeByManifest` |
| 全仓**无**「导出当前资产」入口 | grep `export-kit` / `exportKit` / `backupKit` = 0 命中 |

⇒ 用户选错目录、或导入了「结构合法但内容不是自己要的」包，**旧资产永久消失**。体检能降低选错概率，但消除不了；而代价不可逆。现有文案「旧资产不可自动找回」是诚实的，但把风险全转嫁给用户，且**没给任何一条可行的自救路径**。

### 二、体检只数「有多少个分镜」，但 auto 规划对模板 `prompt` 有**硬结构假设**

`script-adapt.js::buildTemplatePromptParts` 依赖 `template.prompt` 的三处结构：

| 依赖 | 代码 | 缺失后果 |
|------|------|----------|
| 首行 `INT.`／`EXT.` 场景头 | `/^(INT\|EXT\|INT\.\/EXT\|INT\.\|EXT\.)/i.test(firstLine)` | 退化用剧本首行（可接受） |
| `[CHARACTER: NAME]` 行 | `tpl.split('\n').filter(l => /\[CHARACTER:/.test(l))` | **角色锚点全部丢失** ⇒ 身份一致性无从保证 |
| `\n{2,}` 空行分块 | `tpl.split(/\n{2,}/)` 再分运动/静态类 | **运动与空间约束全部丢失** |

现在的体检只统计 `counts.shots` 数量，**不检查这三处**。结果是：用户的包能导入、能规划、能出片，但提示词里的角色与运镜约束是**空的**，一切「成功」、一个错都不报。

这正是「怎么保证导入的文件能用于规划」的**实际落点**——它不在「文件齐不齐」，在「模板结构对不对」。

### 三、体检只答「新资产有什么」，不答「我会失去什么」

用户还缺一个判断：换上去以后**当前资产会少掉什么**。缺这一格，选错包的成本只能靠 P0 兜。

### 四、资产版本只有硬门槛，没有可读路径

`manifest.schemaVersion` 必须 `=== 1`。将来升版本时所有用户旧包会**整包被拒**，而失败信息只在 `blockingMessage` 的自由文本里，用户不知道该做什么。至少要让它**可读**（显示「你的包是 vN，本版本要求 v1」）。

### 五、`FilmEngineeringView.vue` 只剩 41 行余量

实测 **764 行**，挂账 605 + 容差 200 ⇒ 上限 **805**。上一批已挪走导入入口（-2 行），但下次任何改动都要先拆文件，否则 `check-max-lines` 直接红。

## What Changes

### P0 · 导入不再不可逆（保留「上一版备份」）

**改 `kit-import-swap.js::swapIn`**：⑥ 步**不再删 `.bak`**，改为返回 `previousBackup: { path, stamp }`。

**清理时机（关键设计）**：不在 ⓪a 删旧备份，而在**本次换入成功之后**删除**更早的那一份**。理由：

- ⓪a 就删 ⇒ 本次导入随后失败时，用户的旧备份已被抹掉，等于把「可回滚」在最需要它的那一刻取消；
- 成功后再删 ⇒ 任何时刻最多保留 **1 份**历史备份，且本次失败时旧备份仍在。

**语义分层（不复用 `BAK_LEFT`）**：

| 概念 | 含义 | 用户动作 |
|------|------|----------|
| `previousBackup` | **正常态**：上一次导入留下的旧资产，可回滚 | 可选：手动把目录改回 `film-kit`；或忽略 |
| `BAK_LEFT`（既有） | **异常态**：本次换入/清理失败留下的残留 | 必须先处理（见 `SCHEMA.md` §11.6） |

⚠ 把「每次都留备份」塞进 `BAK_LEFT` 会让「残留」从异常变成常态 ⇒ 恢复指引常驻、噪音化，且真出事时用户已经习惯性忽略它。**两个概念必须两个名字。**

**既有锁要更新（并说明理由）**：`kit-import-swap.test.js` 现有两条断言「成功 ⇒ `.bak` 随后删除」。
本批**设计**要求保留，因此这两条**锁该更新**（不是改动不对）。更新时保留其**原意**：
「成功路径不留下**未被记账的**残留」⇒ 改为断言「成功 ⇒ 恰好 1 份 `previousBackup`，且它被**明确回传**」。

### P1 · 体检加「模板结构」判据（单一真源）

- **改 `script-adapt.js`**：抽出并导出 `analyzeTemplatePrompt(prompt)` →
  `{ hasSceneHeading, hasCharacterLine, characterLineCount, blockCount }`；
  `buildTemplatePromptParts` **改为复用它**（两处判据必须同源，否则体检说「有角色行」而规划却抽不到）。
- **改 `kit-inspect.js`**：对 `kit.shots` 逐条分析，产出
  `templateStructure: { total, withSceneHeading, withCharacterLine, withBlocks }`。
- **新增告警 code（仍不阻断）**：

| code | 含义 |
|------|------|
| `TEMPLATE_NO_CHARACTER_LINE` | 有 N 个模板分镜缺 `[CHARACTER: …]` 行 ⇒ 角色锚点会丢 |
| `TEMPLATE_NO_BLOCKS` | 有 N 个模板分镜没有空行分块 ⇒ 运动/空间约束会丢 |

> 为什么不阻断：用户可能刻意用极简模板。体检的职责是**让他知道代价**，不是替他决定。

### P2 · 体检报告加「与当前资产对比」

- IPC 层注入 `currentCounts`（从 `service` 取当前 kit 的场景/分镜/模板数）；
- 报告加 `compare: { current: {...}, delta: { scenes, shots, templates } }`；
- `service` 不可用（未初始化/未登录）⇒ `compare: null`（**不编造 0**）。

### P3 · 资产版本可读

- 报告加 `assetVersion`（`manifest.schemaVersion`）与 `expectedAssetVersion`（代码常量 `1`）与 `versionMismatch`；
- UI 显示「资产版本 vN（本版本要求 v1）」，`versionMismatch` 时用告警色；
- 不改变严格校验行为（仍拒），只让失败**可读**。

### 拆分 · `FilmEngineeringView.vue` 拆出方法论面板

- **新增** `src/views/film-engineering/FilmDoctrinePanel.vue`：把「方法论」标签的展示段整段搬出（只读展示，逻辑最薄 ⇒ 风险最低）；
- 视图保留 `<FilmDoctrinePanel :doctrine="doctrine" />` 一行 + import。

## 数据契约（体检报告新增字段）

```jsonc
{
  "assetVersion": 1,
  "expectedAssetVersion": 1,
  "versionMismatch": false,
  "templateStructure": {
    "total": 153,
    "withSceneHeading": 153,
    "withCharacterLine": 149,
    "withBlocks": 153
  },
  "compare": {                       // service 不可用时为 null
    "current": { "scenes": 162, "shots": 153, "templates": 4 },
    "delta": { "scenes": 0, "shots": -3, "templates": 1 }
  }
}
```

导入成功响应新增：

```jsonc
{ "ok": true, "previousBackup": { "path": "…/film-kit.bak-<ts>", "stamp": "<ts>" } }
```

## 不做

❌ **导出当前资产到用户选定目录**（新写路径，需独立安全评审；本批用「保留上一版备份」覆盖同一诉求）
❌ 内容级判据的其他两项（模板占位符契约、空壳检测）——本轮只做**规划真正依赖的结构**那一项
❌ 资产版本自动迁移
❌ 改动 `importKit` 的锁 / 白名单 / R0 / 哈希对账 / 审计语义
❌ 体检性能优化（两遍读）——实测影响在毫秒-秒级

## Impact

- **Affected specs**：`film-pipeline-v2` §9.d（体检字段/告警）、`SCHEMA.md` §十一（`.bak` 语义）+ §十三（体检契约）、`film-auto-mode`（视图拆分）
- **Affected code**：
  - `services/film-engineering/kit-import-swap.js`（⑥ 步保留 `.bak` + 返回 `previousBackup` + 清理更早备份）
  - `services/film-engineering/kit-import.js`（编排层透传 `previousBackup`；成功响应带它）
  - `services/film-engineering/script-adapt.js`（导出 `analyzeTemplatePrompt`，`buildTemplatePromptParts` 复用它）
  - `services/film-engineering/kit-inspect.js`（模板结构 + 版本 + 对比）
  - `ipc-handlers/film-engineering-import.js`（成功信封透传 `previousBackup`）
  - `ipc-handlers/film-engineering-inspect.js`（注入 `currentCounts`）
  - `src/components/FilmAssetManager.vue`（报告新增三段 + 成功后提示上一版备份）
  - `src/views/FilmEngineeringView.vue` + 新增 `src/views/film-engineering/FilmDoctrinePanel.vue`
  - `locales/film-engineering/{zh,en}.js`
  - 既有测试 2 条更新（`kit-import-swap.test.js`，理由见 P0）
- **QM-1**：改 `electron/**` ⇒ 打包验证；**QM-4**：改渲染端视图 ⇒ 视觉基线

## 风险与取舍（写明以免被误读）

| 取舍 | 说明 |
|------|------|
| 磁盘占用 | 保留 1 份历史备份 ≈ 一个 kit 的体量（随包 2.8MB；用户包上限 256MB）⇒ 最坏情况占双倍空间。**上限判定只作用源目录**（既有祖父条款），备份不受 `MAX_KIT_TOTAL_BYTES` 约束 |
| 回滚是**手动**的 | 不做「一键回滚」按钮：那是第二条写路径（要重做换入/对账/审计）。本批只保证**有备份且路径可见** |
| 模板结构告警不阻断 | 用户可能刻意用极简模板；体检给代价、不替用户决定 |
| 对比依赖 service | `service` 不可用时 `compare: null`，不印 0 |
