# kit-asset-health-report：资产导入入口归位（Hub 页级）+ 导入前「资产体检报告」

## Why

上一批（PR-3b · F-J 资产导入写路径，PR #4325）已上线，但用户审阅后指出**两处设计缺陷**，本 change 修这两处。

### 缺陷一：入口位置与真实依赖方向相反（信息架构错配）

**现状**：`FilmKitImportBar` 挂在 `FilmEngineeringView.vue` 第 6 行 —— 页面最顶部，在所有子标签之上。
而该视图在 Hub 里是 **classic（项目案例）** 标签的内容 ⇒ 导入入口**只出现在「项目案例」标签**。

**真实依赖方向**（代码事实，非推断）：

| 证据 | 落点 |
|------|------|
| 「自动」规划取模板分镜：`service.listTemplateShots()` | `ipc-handlers/film-engineering-auto.js:183` |
| 模板为空即拒绝规划：`AUTO_NO_TEMPLATES: '没有可用模板分镜（film-kit 未加载或为空）'` | `services/film-engineering/auto-plan.js` |
| 模板分镜来源 = film-kit 的 `shot-library.json` | `kit-loader.js`（`kit.shots`） |
| 画布吃 `doctrine` / `shotGrammar`；classic 吃 `shot-library` / `promptLibrary` | `kit-loader.js` 返回的 kit 字段 |

⇒ **导入替换的是「自动」标签赖以规划的模板库**，入口却挂在「学习经典案例」的只读区。
PR-3b 当时写的理由（`FilmKitImportBar.vue` L5-6 原注释）是
「项目案例是**看**资产的地方，导入是同一件事的另一半；自动是只读规划区，写操作不入只读区」——
这句话把「**看**资产的界面」当成了「**该写**资产的位置」，并据此倒推出「auto 不能放写操作」，
而 auto 恰恰是**最直接的消费者**。

**进一步**：资产被三个标签**共用**（auto 用 templateShots、canvas 用 doctrine/grammar、classic 用 shot-library），
它本来就不是任何一个标签的私有物 ⇒ 入口应落在**三个标签共享的页级位置**，而不是塞进某一个标签。

### 缺陷二：只保证「结构合法」，不保证「语义可用」，且用户导入前看不到会得到什么

现有校验其实有三层（比 PRD 记载的更深，逐条核过）：

| 层 | 保证 | 落点 |
|----|------|------|
| L1 文件 | 白名单 9 项齐全、单文件 ≤32MB / 整包 ≤256MB、无软链/断链/越界/隐藏名、JSON 魔数 | `kit-import-scan.js` |
| L2 结构 | `schemaVersion===1`、`filmMeta.title/logline/characters`、`scenes[].id/name`、`shot.shotId/sceneId/prompt/model/refTokens`、提示词三分、**shots↔scenes 引用一致性**、references / shot-grammar / compliance / palette 各自校验 | `kit-loader.js`（`requireAssets:true`） |
| L3 内容 | 只有 prompt 长度上限 | —— |

⇒ 用户**导入前完全看不到**「我会得到什么」（几个场景 / 几个分镜 / 几个任务模板 / 参考图能解析多少 / 哪些会被忽略），
只能「导了才知道」。这不是校验强度问题，是**可预期性**问题。

⚠ 本轮**只做可预期性（A 档）**，不新增内容级判据（见 §不做）。

## What Changes

### 1. 入口归位：Hub 页级「资产管理」

- **新增** `apps/desktop/src/components/FilmAssetManager.vue` —— Hub **页头**的资产区：
  - 一行摘要（当前生效资产来自哪一级 / 场景·分镜·模板数），数据取既有 `film-engineering:status`；
  - 一个「导入我的资产…」按钮 + 一行说明（整体替换，不是合并）。
- **修改** `apps/desktop/src/views/FilmEngineeringHubView.vue` —— 在 `.fh-header` 内挂 `<FilmAssetManager />`
  （**不进入任何 tabpanel** ⇒ 三个标签都能看到）。
- **修改** `apps/desktop/src/views/FilmEngineeringView.vue` —— **移除** `FilmKitImportBar` 挂载与 import（净 -2 行）。
- **删除** `apps/desktop/src/components/FilmKitImportBar.vue` 的「只在 classic 出现」的旧定位注释；
  该组件本身改造为 `FilmAssetManager` 的内部实现（保留确认框 / 不可中断模态 / 恢复指引告警 / 残留告警 / 审计告警）。

> **决策 D1**：不保留双入口。两处入口会带来「一处显示导入中、另一处还能点」的状态不一致，
> 而写路径的状态一致性比入口发现性更贵。

> **决策 D2**：进入 Hub 页头 ⇒ 引入 `embedded` 之外的第二处挂载点，`FilmKitImportBar` 原有 props
> （`onImported`）保留语义，由 Hub 把刷新交给各 panel（见 D6）。

### 2. 导入前「资产体检报告」（只读，不落盘）

- **新增** `apps/desktop/electron/services/film-engineering/kit-inspect.js`
  - `inspectKit({ kitDir, fs })` —— **只读**：不建锁、不写审计、不写任何文件；
  - 内部顺序：① `scanKit`（形状/白名单/体积）→ ② `loadFilmKit({requireAssets:false})`（拿统计 + `assetWarnings`）
    → ③ `loadFilmKit({requireAssets:true})`（判「能否导入」）；
  - 产出见 §数据契约。
- **新增** IPC `film-engineering:inspect-kit`（`ipc-handlers/film-engineering-inspect.js`）
  - **入参为空**（路径只能来自 handler 内部的原生对话框，与 importKit 同口径）；
  - sender 授权硬断言（主框架 + 协议白名单 + hash 路由前缀 `/film-engineering`）；
  - UNC / 非目录在 handler 层就拒。
- **修改** `preload/film-engineering.js`（`inspectKit()` 空参）、`preload/access-control.js`
  （登记 `filmEngineering.inspectKit` 为 **public**：只读、无落盘、路径由用户原生选择 ⇒ 与既有
  `film-engineering:*` 只读通道同档）、`src/api/publisher.js`（桥接）。
- **修改** 渲染端 composable `useFilmKitImport.js` —— 增加 `inspectAssets()` 与 `inspection` 状态；
  流程改为 **选目录 → 体检 → 展示报告 → 用户确认 → 才调 importKit**。

> **决策 D3**：体检**不写审计**。审计契约（`SCHEMA.md` §11.5）写明「审计 = 写路径的痕迹」；
> 把只读体检也写进去会稀释「每次替换都有痕」这个读数的含义。

> **决策 D4**：体检跑**两遍读**（宽松 + 严格）。只跑严格模式的话，资产不合格时用户只能拿到一句
> 「不符合要求」，看不到自己包里**其实有什么** —— 那恰恰是最需要告诉他/她的信息。

> **决策 D5**：`ok`（体检本身跑通 ≠ 资产合格）与 `data.importable`（能否导入）**必须分开表达**。
> 合成一个字段会让「目录读不到」被读成「资产不合格」，两种成因对应完全不同的用户动作。

### 3. 契约与文档

- `apps/desktop/electron/film-kit/SCHEMA.md` —— 新增「**十二、资产体检契约**」：
  报告字段逐条、`importable=false` 时的 `reason` 取值、告警 `code` 闭集、与 §11 导入契约的关系。
- `01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md` —— 新增 **§9.d**（体检报告的功能逻辑 / 数据校验 /
  交互 / 显示项 / 提示文字全量 / 验收判据 / 不做），并修正 §9.c.4 里「入口在项目案例标签顶部」的旧口径。
- `openspec/records/kit-asset-health-report.md` —— 执行记录（含 `| 远程同步 | 由门禁推导 |` 表行 + bullet）。

## 数据契约（体检报告）

```jsonc
{
  "code": 0,
  "data": {
    "importable": true,              // 严格模式是否通过（能否导入）
    "blockingReason": null,          // 不可导入时：reason 闭集值（复用 §11.4 的 18 值）
    "blockingMessage": null,         // 不可导入时：人话原因
    "counts": {
      "scenes": 162, "shots": 153, "shotsWithResult": 0,
      "references": 332, "referencesResolvable": 332,
      "templateTasks": 4, "templateFiles": 8,
      "fileCount": 9, "totalBytes": 2987163
    },
    "langs": ["en", "zh"],
    "requiredMissing": [],           // 缺的必填文件名（人类可读）
    "ignoredTopLevel": ["images"],   // 白名单外、不会被拷入的顶层条目
    "assetWarnings": []              // 宽松模式告警（缺 v7 增强等），不阻断
  }
}
```

**告警 `code` 闭集**（本轮只聚合既有来源，不新增判据）：

| code | 含义 | 来源 |
|------|------|------|
| `MISSING_V7_ASSET` | 缺 v7 增强资产（含 `prompts/tasks`） | `loadFilmKit` 的 `assetWarnings` |
| `EMPTY_TASK_LIBRARY` | `prompts/tasks` 存在但没有任务目录 | 同上 |
| `UNRESOLVED_REFERENCE` | 参考条目无可解析 URL 的数量 > 0 | 体检统计 |
| `IGNORED_TOP_LEVEL` | 顶层有白名单外条目（如 `images/`），不会拷入 | 体检统计 |
| `SHOTS_WITH_RESULT` | 分镜已带成片链接（导入后仍视为「已生成」） | 体检统计 |

## 明确不做（本轮）

❌ **内容级判据**：提示词模板占位符契约、枚举值落闭集校验、空壳/残留（`TODO`/`lorem`）检测
❌ **标准骨架导出**：给用户一份可导入的标准资产包骨架
❌ **本地自检命令**：导入前脱离 UI 跑一遍
❌ 导入拆成两套写路径（复用既有 `importKit`，只在它前面加只读体检）
❌ 改动 `importKit` 的任何安全语义（锁 / 白名单 / R0 / 哈希对账 / 审计）
❌ 标签改名（`?tab=classic` 是既有路由契约）

> 以上四项（A 档之外的 B/C/D/E）已在评估中确认价值，但**独立成批**：内容级判据会改变「什么叫合格」，
> 标准骨架是新的用户交付物，两者都要各自的安全与兼容论证，不与本次「挪位置 + 只读报告」混批。

## Impact

- **Affected specs**: `film-auto-mode`（Hub 结构 D1/D2 —— 页头新增资产区）、`film-pipeline-v2` §9（导入入口口径）
- **Affected code**（实测行数见 tasks）:
  - 新增：`services/film-engineering/kit-inspect.js`、`ipc-handlers/film-engineering-inspect.js`、
    `src/components/FilmAssetManager.vue`
  - 修改：`FilmEngineeringHubView.vue`、`FilmEngineeringView.vue`、`FilmKitImportBar.vue`、
    `useFilmKitImport.js`、`preload/film-engineering.js`、`preload/access-control.js`、`src/api/publisher.js`、
    `ipc-handlers/index.js`、`locales/film-engineering/{zh,en}.js`
  - 契约/文档：`SCHEMA.md`、PRD §9.d、执行记录
- **不涉及**：`kit-import*.js` 的写路径实现、锁/审计/换入逻辑、任何门禁判据阈值
- **QM-1**：改 `apps/desktop/electron/**` ⇒ 需本地打包验证；**QM-4**：改渲染端视图 ⇒ 视觉基线
