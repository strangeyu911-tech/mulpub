# 资产体检报告 + 导入入口归位执行记录

> 记录载体：`openspec/records/kit-asset-health-report.md`（分支名 `kit-asset-health-report`）
> 方案：`openspec/changes/kit-asset-health-report/proposal.md`；任务：同目录 `tasks.md`
> 契约：`apps/desktop/electron/film-kit/SCHEMA.md` §十三；PRD：`01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md` §9.d

## 本次执行记录：资产体检报告 + 入口归位（kit-asset-health-report，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码**（`apps/desktop/electron/**` + `apps/desktop/src/**` + `film-kit/SCHEMA.md` + `01-docs/**` + `openspec/**`）⇒ 走**隔离 worktree**：`scripts/start-mp-task.ps1 -TaskName kit-asset-health-report`（依赖自检 11 项通过），**裸分支** `kit-asset-health-report`，非 C 盘。共享根全程停在 main、**零 tracked 改动** |
| 第一性原因（QM-5 ①） | ✅ | 用户审阅 PR-3b 后指出两处设计缺陷：① 导入入口挂在 `FilmEngineeringView.vue`（= Hub 的 classic「项目案例」）页面顶部，而导入**替换的是「自动」标签的规划模板库**（`listTemplateShots()` → `planAutoShots({templateShots})`，空了直接报 `AUTO_NO_TEMPLATES`）⇒ 入口位置与真实依赖方向相反，且资产本就被三个标签共用、不属于任何一个；② 既有校验只回答「合格/不合格」，用户导入前**看不到会得到什么**（几个场景/分镜/任务模板、参考图能解析多少、哪些会被忽略）⇒ 只能「导了才知道」，缺的是**可预期性**而不是校验强度 |
| 逃逸分析（QM-5 ②） | ✅ | ① 既有测试锁的是「顶部挂载了资产导入入口」——**它锁的正是被推翻的旧设计**，所以这个错位一直「有测试保护」；② 体检是**只读**操作，但仓库里所有「只读」承诺都只写在注释里（无任何机械锁），一个 `fs.writeFileSync` 混进来不会被发现；③ `counts` 若在「没量到」时返回 `0`，界面会把「读不到」渲染成「资产是空的」——本仓反复禁止的**构造性零**在新接口上又开了一次口子；④ 体检与导入的授权档位若只改一侧（preload 公开而主进程 authenticated），「只读可公开」就是空话 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① **入口归位**：新增 `FilmAssetManager.vue` 挂到 Hub **页头**（三个标签共用），删除 `FilmEngineeringView.vue` 里的旧挂载与 import（净 -2 行）、删除 `FilmKitImportBar.vue`（入口只有一份）；② **只读体检**：新增 `services/film-engineering/kit-inspect.js`（两遍读：宽松拿统计 + 严格判 `importable`）+ `ipc-handlers/film-engineering-inspect.js`（入参为空 + sender 硬断言 + **不写审计不建锁**）；③ **clients 接线**：`index.js` / `preload/film-engineering.js` / `preload/access-control.js`（`inspectKit` **public**，与 `importKit` 刻意成对相反）/ `src/api/publisher.js`；④ **渲染端**：`useFilmKitImport.js` 增 `inspectAssets()/inspection`，报告与确认**同一屏**，`importable=false` 时确认按钮禁用；⑤ **统计为 null 时渲染占位不印 0**；⑥ `scanKit` 增 `skipHash`（体检不为「看一眼」付 256MB 全量哈希） |
| 防止再次发生（QM-5 ⑤） | ✅ | **11 条机械锁**：① `kit-inspect.test.js`「⛔ 只读铁律」——以**记录写调用的 fs 替身**跑一遍，`writeFile/writeSync/mkdir/unlink/rm/rmdir/rename/copyFile/utimes` 调用数必须为 **0**（不靠人读代码）+ 源目录递归快照逐字节比对；② 同文件「不合格包同样零写入」（失败路径也不许写）；③ `film-engineering-inspect.test.js`「不写审计」——体检后 `film-kit-import.log` 与 `.import-lock` 都不得存在；④ `FilmEngineeringHubView.test.js`「资产区**不在**任何 tabpanel 内」+「切标签后仍只有一个」+「页头有资产区」；⑤ `FilmEngineeringView.test.js`**反向锁**「挂载后既无旧导入条也无资产区」；⑥ `FilmAssetManager.test.js`「`importable=false` ⇒ 确认按钮禁用且点了也不导入」；⑦ 同文件「`counts=null` ⇒ 显示未能读取，不得渲染一排 0」；⑧ `preload.test.js`**成对**两条（`inspectKit` 必须 public / `importKit` 必须非 public，且**两侧档位一致**）；⑨ `kit-schema-contract.test.js` §十三：告警 code 逐值与代码一致 + reason 闭集在位 + 报告字段在位；⑩ `kit-import-scan.test.js`：`skipHash` 下不调 hashFile、**默认路径仍产出真实 SHA-256**（守写路径的两条对账）；⑪ IPC 契约 11 例（sender 断言 / 入参为空 / 取消 / UNC / 非目录 / 报告信封） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；新增/修改文件统一 CRLF 且末尾保留换行；全文 **U+FFFD = 0**、**NUL 字节 = 0** |
| 接线棘轮 | ✅ | 3 个新增测试文件命中 vitest include（`electron/services/**` / `electron/ipc-handlers/**` / `src/**`）⇒ 自动收集，无需改 workflow |
| 装配锁（⚠ 本仓专有坑） | ✅ | 新接 IPC 必须跑**整面装配锁**：`tests/ipc-handlers.test.js` + `electron/ipc-handlers/performance-loop.test.js` **35 例全绿**。PR-3b 曾因「模块导出形态与同族不一致」让整条 IPC 注册面在装配时抛 `TypeError: require(...) is not a function`（17 条装配锁全红，而本地单测因直接 import 而测不到）⇒ 本次 `film-engineering-inspect.js` 从一开始就用「模块本身可调用 + 具名导出」 |
| QM-1 打包 / QM-4 视觉 | ✅（QM-1） | **QM-1**：`pnpm run build:vue` rc=0（28.53s）；`electron-builder --dir` rc=0 ⇒ `dist-electron/win-unpacked`，**asar 158,115,393 字节**；**归属自证 9/9**——`film-engineering:inspect-kit` ×8 / `filmEngineering.inspectKit` ×3 / `fe-asset-manager` ×3 / `assetManager` ×23 / `MISSING_V7_ASSET` ×6 / `importable` ×13 / `requiredMissing` ×4 / `ignoredTopLevel` ×6，且**反向断言** `fe-kit-import-bar` **×0 命中**（证明旧导入条确实已从渲染端移除，而不只是「新代码加上了」）。**QM-4** 见 CI 的 `QG Visual` 读数（本批改了 Hub 页头 ⇒ 视觉基线可能需随新设计更新） |
| QM-6 CCG 评审 | ⏳ | 决策层（方案）+ 验证层（实现）在提交前跑，逐条闭环后回写本表 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并后 main push 的回读证据写在 **PR 评论**里，不写回本文件 |

- 保留门禁：行尾对账 ✅ · 编码完整性（U+FFFD + NUL）✅ · 品牌残留 ✅ · 文档同步 ✅ | 远程同步（合并后由门禁推导；证据见 PR 评论）

## 一、两处设计缺陷与处置

| # | 缺陷 | 证据 | 处置 |
|---|------|------|------|
| 1 | 入口位置与依赖方向相反 | 「自动」规划取模板：`ipc-handlers/film-engineering-auto.js:183` `service.listTemplateShots()`；空即 `AUTO_NO_TEMPLATES`（`auto-plan.js`）；模板来源 = `kit.shots`（`kit-loader.js`）。而入口在 classic 标签的页面顶部 | 入口移到 Hub 页头（`FilmAssetManager.vue`）；删除 classic 内旧挂载；删 `FilmKitImportBar.vue` |
| 2 | 导入前看不到会得到什么 | 既有校验只有「合格/不合格」，无统计、无缺项清单、无忽略项 | 只读体检（`kit-inspect.js`）+ 报告与确认同屏 |

**为什么当初会做错**（写下来避免重犯）：PR-3b 的理由是「项目案例是**看**资产的地方，导入是同一件事的另一半；
自动是只读规划区，写操作不入只读区」—— 这句话把「**看**资产的界面」当成了「**该写**资产的位置」，
并据此倒推出「auto 不能放写操作」，而 auto 恰恰是最直接的消费者。
**「界面在哪」与「数据被谁消费」是两个问题，不能用一个回答另一个。**

## 二、实现清单（文件级）

**新增**
- `apps/desktop/electron/services/film-engineering/kit-inspect.js`（只读体检：`inspectKit` + `INSPECT_REASON` + `WARN_CODE` 闭集）
- `apps/desktop/electron/ipc-handlers/film-engineering-inspect.js`（`film-engineering:inspect-kit`；入参为空 + sender 硬断言 + 不写审计）
- `apps/desktop/src/components/FilmAssetManager.vue`（Hub 页级资产区：入口 + 体检报告 + 确认 + 不可中断模态 + 恢复/残留/审计告警）
- 3 个测试文件（`kit-inspect.test.js` 11 例 / `film-engineering-inspect.test.js` 11 例 / `FilmAssetManager.test.js` 13 例）

**修改**
- `film-engineering-service.js` 未动（体检不依赖 service 缓存；避免把只读路径接进写路径的状态机）
- `ipc-handlers/index.js`（接线）、`ipc-handlers/license-access-control.js`（`inspect-kit` 登记 public，与 `import-kit` 成对相反）
- `preload/film-engineering.js`（`inspectKit()` 空参）、`preload/access-control.js`（`filmEngineering.inspectKit` 登记 public）
- `src/api/publisher.js`（`filmEngineeringInspectKit()` 桥接）
- `src/composables/useFilmKitImport.js`（`inspecting` / `inspection` / `inspectAssets()` / `resetInspection()` / `inspectReasonText()`）
- `src/views/FilmEngineeringHubView.vue`（页头挂资产区 + `assetVersion` 重建已挂载面板）
- `src/views/FilmEngineeringView.vue`（移除旧挂载与 import，净 -2 行）
- `kit-import-scan.js`（增 `skipHash`，默认 false ⇒ 写路径不受影响并有锁）
- `locales/film-engineering/{zh,en}.js`（`assetManager.*` **22 键**成对）
- 测试：`kit-import-scan.test.js`(+2) / `kit-schema-contract.test.js`(+5) / `preload.test.js`(+1 成对) / `FilmEngineeringHubView.test.js`(+3) / `FilmEngineeringView.test.js`(-1 旧 +1 反向)

**删除**
- `apps/desktop/src/components/FilmKitImportBar.vue` + `.test.js`（入口只有一份；逻辑并入 `FilmAssetManager.vue`）

## 三、验收判据（10 条 → 用例）

| 判据 | 用例 |
|------|------|
| ① 页头有资产区 | `FilmEngineeringHubView.test.js`「页头有资产区」 |
| ② 不在任何 tabpanel 内 | 同文件「资产区**不在**任何 tabpanel 内」 |
| ③ 切标签后只有一个 | 同文件「切到任一标签，资产区都仍然只有一个」 |
| ④ classic 内无入口 | `FilmEngineeringView.test.js`「既无旧导入条也无资产区」 |
| ⑤ 点入口只调 inspectKit | `FilmAssetManager.test.js`「只调 inspectKit，不调 importKit」 |
| ⑥ 不可导入时禁用且点了不导入 | 同文件「`importable=false` ⇒ 确认禁用 + 缺项列出」 |
| ⑦ counts=null 不印 0 | 同文件「counts=null ⇒ 显示未能读取」 |
| ⑧ 取消不算失败 | 同文件「取消目录 ⇒ 不弹报告、不算失败」 |
| ⑨ 体检零写入 | `kit-inspect.test.js`「全程不调用任何写接口，源目录逐字节不变」+「不合格包同样零写入」 |
| ⑩ IPC 侧不写审计不建锁 | `film-engineering-inspect.test.js`「不写审计」 |

## 四、诚实边界

| 边界 | 说明 | 补偿 |
|------|------|------|
| 体检不保证「质量好」 | 只回答「结构合法 + 有多少东西」，不判提示词是否好用、分镜是否可拍 | 明确不做（proposal §不做）；内容级判据属下一批 |
| 参考图可解析率只判 URL 形状 | 不联网验证 URL 是否真的可达 | 报告用词是「可解析」（形状），不是「可访问」 |
| 只读承诺靠测试守 | 「不写」是承诺不是结构 | 3 条机械锁（fs 替身写调用计数 / 快照 / 无审计文件） |
| 导入仍会重新校验 | 体检结果不缓存、不传递给写路径 | 用户改完包再点一次入口即重新体检；`importKit()` 仍空参再选目录 |
| 面板重建会丢未保存的编排 | 资产整体替换后旧状态无意义 | `:key` 重建只作用于**已挂载**面板；导入是低频操作 |

## 五、门禁跑法与读数

| 判据 | 命令 | 读数 |
|------|------|------|
| 行尾两口径 | `git diff --numstat` vs `git diff --ignore-cr-at-eol --numstat` | 见提交前现测 |
| 编码完整性 | U+FFFD + **NUL 字节**扫描 | 0 / 0 |
| 逐文件行数 | `node .github/scripts/check-max-lines.js` | 见 CI |
| locale 三档 | `node .github/scripts/check-locale-sync.js --pair-base origin/main --cjk --keys` | 见 CI |
| 品牌残留 | `node scripts/check-no-brand-residue.js` | 见 CI |
| 文档绝对路径 | `node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD` | 见 CI |
| 装配锁 | `pnpm exec vitest run tests/ipc-handlers.test.js electron/ipc-handlers/performance-loop.test.js` | **35 / 35 通过** |
| 体检域 | `pnpm exec vitest run electron/services/film-engineering/kit-inspect.test.js` | **11 / 11 通过** |
| 体检 IPC | `pnpm exec vitest run electron/ipc-handlers/film-engineering-inspect.test.js` | **11 / 11 通过** |
| 渲染端 | `pnpm exec vitest run src/components/FilmAssetManager.test.js src/views/FilmEngineeringHubView.test.js src/views/FilmEngineeringView.test.js electron/preload.test.js` | **416 / 416 通过** |
| 契约 | `pnpm exec vitest run electron/services/film-engineering/kit-schema-contract.test.js` | **12 / 12 通过** |
