# 导入可回滚 + 模板结构体检 + 视图拆分执行记录

> 记录载体：`openspec/records/kit-import-rollback-and-template-health.md`（分支名 `kit-import-rollback-and-template-health`）
> 方案：`openspec/changes/kit-import-rollback-and-template-health/proposal.md`；任务：同目录 `tasks.md`
> 契约：`apps/desktop/electron/film-kit/SCHEMA.md` §11.2 / §11.6 / §11.7 / §十三；PRD：`01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md` §9.e

## 本次执行记录：导入可回滚 + 模板结构体检 + 视图拆分（kit-import-rollback-and-template-health，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码**（`apps/desktop/electron/**` + `apps/desktop/src/**` + `film-kit/SCHEMA.md` + `01-docs/**` + `openspec/**`）⇒ 走**隔离 worktree**：`scripts/start-mp-task.ps1 -TaskName kit-import-rollback-and-template-health`，裸分支同名、非 C 盘。共享根 `<共享根>` 全程停在 main、**零 tracked 改动** |
| 第一性原因（QM-5 ①） | ✅ | 三件事各有独立成因：① 上一版导入是**不可逆**的 —— ⑥ 立刻删掉 `.bak`，用户选错包后没有任何退路，而确认文案自己写着「旧资产不可自动找回」；② 「能导入」被当成了「能规划出带约束的提示词」—— auto 规划把模板 `prompt` 当**结构化模板**复用（场景头 / `[CHARACTER: …]` 行 / 被识别的块），三者全缺的包**能导能跑**但提示词里约束是空的，而体检此前只回答「合格/不合格」；③ `FilmEngineeringView.vue` 已 **802 行**、贴着 `check-max-lines` 上限（605 挂账 + 200 容差），继续往里加东西就是每次靠容差过关 |
| 逃逸分析（QM-5 ②） | ✅ | ① 「成功 ⇒ `.bak` 删掉」这条**被既有测试锁着**（`kit-import-swap.test.js` 原用例）—— 锁住的是被推翻的设计，所以不可逆这件事「有测试保护」；② `recovery_state=BAK_LEFT` 一旦被复用成「上一版备份」，残留就从异常变常态 ⇒ 恢复指引常驻 ⇒ 真出事时用户已习惯性忽略；③ 若在 ⓪a（开工前）就清旧备份，本次导入随后失败时用户唯一退路已被抹掉；④ `counts`/`compare` 若在「没量到」时降级成 `0`，界面会把「读不准」印成「资产是空的」（构造性零）；⑤ 体检与规划的模板结构口径若各写一份正则，两套判据必然漂移；⑥ 拆分组件最容易的回归是**拆了没挂**（页面空白），而源码级契约不会自己发现 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① **P0 可回滚**：⑥ 步从「删本次 `.bak`」改为「**保留**为上一版 + 清理**更早**的备份（精确清单 + 自底向上 `rmdir`，R0）」，返回 `previousBackup{path,stamp}` / `staleRemoved` / `staleWarning`；`kit-import.js` 删掉已成死代码的「删 `.bak` 失败 ⇒ BAK_LEFT」分支；`film-engineering-import.js` 成功信封透传两字段；② **P1 模板结构**：`script-adapt.js` 抽出并导出 `analyzeTemplatePrompt`，`buildTemplatePromptParts` **改为复用它**（单一真源）；`kit-inspect.js` 产出 `templateStructure` + 两条不阻断告警；③ **P2 对比**：`currentCountsOf(service)` 在主进程取当前计数并注入，形状不齐 / 命中 500 上限一律降级 `null`；④ **P3 版本**：`readManifestVersion` **直读 manifest**（不依赖整包可加载）+ `expectedAssetVersion` / `versionMismatch`；⑤ **渲染端**：报告新增三段（版本 / 模板结构 / 对比）+ `type=info` 的「上一版已保留」提示 + `type=warning` 的「更早备份未清」提示；⑥ **拆分**：方法论分区整块移到 `FilmDoctrinePanel.vue`，`FilmEngineeringView.vue` **802 → 750 行** |
| 防止再次发生（QM-5 ⑤） | ✅ | 新增/改写 **21 条机械锁**：① `script-adapt.test.js` +5（含**同源锁**：`analyzeTemplatePrompt` 与 `buildTemplatePromptParts` 必须同一份判断）；② `kit-inspect.test.js` +6（模板结构四计数 / 两条告警出现与不出现 / `compare` 形状不全 ⇒ `null` / 版本不符 ⇒ `versionMismatch`）；③ `film-engineering-inspect.test.js` 入参断言改 `['currentCounts','kitDir']` + 主进程取数；④ `kit-import-swap.test.js` 块 1/2/3 重写 + 新增「连续两次 ⇒ 最多 1 份」+「成功 ⇒ 恰好 1 份且**不**记为 `BAK_LEFT`」；⑤ `kit-import.test.js` 块 4 重写为「成功 ⇒ 回传上一版且目录里真的是旧资产」+ 新增「**导入失败 ⇒ 更早的备份与旧 kit 都逐字未动**」（锁「清理不在 ⓪a」这条时序决定）；⑥ `kit-import-scan.test.js` +2（同 `(dev,ino)` + `nlink=1` ⇒ **不拒**；+ `nlink=2` ⇒ 仍拒，靠 fs 替身注入，与宿主文件系统语义无关）；⑦ `kit-schema-contract.test.js`：告警 7 值逐值一致 + 报告新字段在位 + 「`BAK_LEFT` 已退役」+「`nlink > 1` 前置门」四条新断言；⑧ `FilmAssetManager.test.js` +7（三段报告渲染 / `null` ⇒ 不渲染 / 备份提示不升级成残留 / `staleWarning` 必须可见）；⑨ `film-engineering-methodology.test.js`：方法论断言改扫子组件 + **父视图必须真的挂载并传参、旧分区标记必须已从父视图消失** |
| 硬链判据的实证修正 | ✅ | 本机实测（NTFS，300 轮 × 每轮 7 个不同文件）出现 **480 次**「同目录不同文件 `(dev,ino)` 完全相同、`nlink` 皆 1」；真硬链实测 `(dev,ino)` 相同且 `nlink = 2` ⇒ 只凭 `(dev,ino)` 判会**误拒合法包**（`HARDLINK_REJECTED` 假阳性，`kit-import.test.js` 锁接管用例曾因此偶发红）。判据加 `nlink > 1` 前置门：能报 `nlink` 的文件系统判据不变，报不出的降级为漏判（= §11.2 已声明的 `hardlink_check=best-effort`，不新增承诺） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **两口径逐行一致**（23 个修改文件 + 3 个新增文件全部 CRLF、末尾留换行）；`01-docs` / `SCHEMA.md` / 新增 `.vue` / `openspec/**` 全文 **U+FFFD = 0、NUL = 0** |
| 行数门禁 | ✅ | `check-max-lines`：`FilmEngineeringView.vue` 802 → **750**（< 760 目标线、远离 805 上限）；新增 `FilmDoctrinePanel.vue` 90 行、`kit-inspect.js` +102（均远低于 500）；`testLimit=1500` 无新增超限 |
| i18n 成对 | ✅ | `assetManager.*` 22 → **31 键**（文案 +7、告警 +2）；`filmKitImport.*` 22 → **23 键**（删 `recoverBak`、加 `backupKept` / `staleWarning`）；`check-locale-sync --pair-base origin/main --cjk --keys` 三档全绿（2450 个在用 key 均在 zh/en 存在） |
| 品牌残留 / 文档绝对路径 | ✅ | `check-no-brand-residue` PASS（扫描 13334 个 tracked 文件）；文档一律 `<...>` 占位，无本机绝对路径 |
| 视觉覆盖 | ✅ | `check-visual-coverage` OK（进域注册表 5 张 / 视图并集 56 / 缺 69 已登记 69、上界 69）；新增组件不是独立注册视图，不改判定域 |
| ESLint | ✅ | 改动文件 `eslint --quiet` 无输出（0 error 0 warning） |
| 远程同步 | 由门禁推导 | 见下方 bullet（推送时机由「本地门禁全绿」推导，不手工填时间） |
| 全量测试 | ✅ | 影视工程域 **42 文件 / 720 例**、本批直接改动 8 文件 **134 例**、渲染端相关 **59 例**（含 `FilmAssetManager` 21 例）全部 0 failed；CI 跑全量（含渲染端与装配锁）。读数见「读数」段 |

### 关键设计决定（连同理由一起记下来，避免下一批把它当「遗漏」改回去）

1. **清理时机在成功之后，不在 ⓪a**：⓪a 就删 ⇒ 本次导入随后失败时用户唯一退路已被抹掉。
2. **`previousBackup` 与 `BAK_LEFT` 必须分两个名字**：前者正常态（无需动作），后者异常残留（要动手）。
   混用 ⇒ 恢复指引常驻 ⇒ 真警报被习惯性忽略。渲染端用 `type=info` / `type=warning` 在视觉上再分一层。
3. **模板结构判据用 `recognizedBlockCount` 而非块数**：纯散文 split 也是 1 块，只有「块标题被识别」才决定约束进不进产物。
4. **模板结构告警不阻断**：极简模板可能是刻意的 —— 体检给代价，不替用户决策。
5. **`currentCounts` 只能由主进程取**：让 renderer 传「当前有多少分镜」等于让它自证差异；`listTemplateShots(500)` 命中上限即降级 `null`（拿不准不猜，假差异比没有更坏）。
6. **版本读数不依赖整包可加载**：`schemaVersion` 不符时整包加载本来就失败，而那正是最需要显示版本的时刻。
7. **P0 改了既有锁并写明理由**：原「成功 ⇒ `.bak` 删」与新设计相反 ⇒ 属「锁该更新」，保留原意（不留未记账残留）而不是删掉它。
8. **硬链判据加 `nlink > 1` 前置门**：`ino` 在 Windows 上不是唯一文件号（实测 480 次碰撞）⇒ 误拒合法包比漏判更坏，且漏判方向早有 `best-effort` 声明。
9. **拆分必须配「父视图真的挂上了」的断言**：拆了没挂 = 页面空白，而这在源码级契约里不会自己暴露。

### 读数

- 影视工程域（`electron/services/film-engineering`）：**42 文件 / 720 例全绿**（0 failed，307s）
- 本批直接改动的服务 / 契约 / IPC 文件：**8 文件 / 134 例全绿**
  （`script-adapt` / `kit-inspect` / `kit-import-swap` / `kit-import` / `kit-import-scan` /
  `kit-schema-contract` / `film-engineering-inspect` / `film-engineering-import`）
- 渲染端：`FilmAssetManager.test.js` **21 例**（含新增三段报告 6 例 + 备份/`staleWarning` 3 例）；
  拆分相关三文件（`film-engineering-methodology` + `FilmEngineeringHubView` + `FilmAssetManager`）**59 例**全绿
- 行数：`FilmEngineeringView.vue` **802 → 750**、`FilmDoctrinePanel.vue` **90**、
  `kit-inspect.js` +102（总长由 `check-max-lines` 输出核对，未进挂账）
- CI 侧跑的是**全量**（含渲染端全量 + 装配锁），本记录只列本地实跑读数，不以「CI 会跑」代替本地证据

### 远程同步 bullet

- **推送前**：本地门禁（行尾两口径 / U+FFFD+NUL / ESLint / max-lines / locale 三档 / 品牌残留 / 文档绝对路径 / 视觉覆盖）全绿 + 全量测试 0 failed ⇒ 才 `git push` 开 PR。
- **推送后**：`git rev-parse HEAD` 与 `git rev-parse origin/<branch>` 必须相等；CI 以 `gh pr checks` 逐项回读，任一红 ⇒ 修复后**重跑**（不放宽判据）。
- **合并后**：`main` push 的 `quality-gate` 必须 `completed/success`，且 `git log origin/main -1` 的 `--stat` 里能看到本批文件；worktree 按 R1–R7 删除。
