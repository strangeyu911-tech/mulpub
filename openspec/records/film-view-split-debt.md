# 影视工程视图拆分 · 行数销账执行记录

> 记录载体：`openspec/records/film-view-split-debt.md`（分支名 `film-view-split-debt`）
> 方案：`openspec/changes/film-view-split-debt/proposal.md`（v4）；任务：同目录 `tasks.md`；行级清单 `design-details.md`
> 评审回应：同目录 `rebuttal-r1.md` ~ `rebuttal-r4.md`

## 本次执行记录：把三块面板拆出 `FilmEngineeringView.vue`（film-view-split-debt，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码**（`apps/desktop/src/**` + `.github/scripts/max-lines-baseline.json` + `openspec/**`）⇒ 走**隔离 worktree**：`scripts/start-mp-task.ps1 -TaskName film-view-split-debt`（依赖自检 11 项通过），裸分支同名、非 C 盘。共享根停在 main、零 tracked 改动 |
| 第一性原因（QM-5 ①） | ✅ | 上一批（PR #4537）只把方法论分区搬走，`FilmEngineeringView.vue` 仍 **750 行**、挂账 605 + 容差 200 = 805 ⇒ 余量 55 行。该文件里住着**三台互不依赖的状态机**（`vgPhase` 六态 / `pdPhase` 七态 / 详情抽屉）：改一个要通读 750 行；余量吃光后，下一个要加字段的人只剩「抬挂账」一条路 —— 而那是本仓反复禁止的动作 |
| 逃逸分析（QM-5 ②） | ✅ | ① 三块面板**没有数据依赖**，只共用一个宿主文件（`useFilmVideoGen`/`useFilmProduction` 的 import 只有 `vue` + `@/api/electron-bridge` + shared-utils，`grep` 确认不读 `useFilmEngineering`/`useRoute`/`inject`）；② 三处**耦合锁**会在拆分时被误伤：`text-length-convergence` 的例外清单（搬走 `promptPreview` ⇒ 条目陈旧 + 新文件违规，双红）、`list-stable-keys` 的机械锚点（`in b.shots`）、`element-plus` 的 `v-loading` 下界（≥4）；③ 既有行为测试是**挂载型**且有一条白盒断言 `wrapper.vm.productionPanelOpen` ⇒ 开关若搬进子组件，那条断言就失去对象；④ `useFilmVideoGen.dispose()` **从来没被调用过**（父视图只调了 `pdDispose()`）⇒ 面板关闭后轮询可能继续跑 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① **A** `FilmVideoGenPanel.vue`（177 行）：六态 + `useFilmVideoGen()` + `onBeforeUnmount → dispose()`（**顺手修掉上述现存泄漏**）；② **B** `FilmProductionPanel.vue`（241 行）：七态 + `useFilmProduction()` + `dispose()`；③ **C** `FilmShotDetailDrawer.vue`（106 行）：只读展示，`copy`/`copy-token` 走 emit 回父；④ **父视图 750 → 457 行**，`open` 开关留在父（`v-model:open`，白盒断言锚点），`onBeforeUnmount` 只留虚拟滚动 sentinel；⑤ 三个组件都收 `preview`（= 父 `promptPreview`，**刻意不搬家**：迁移 `truncate()` 会改可见宽度、与像素基线刷新同批才允许） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 三个新组件各一份契约测试（**11 例**）：A 挂载即渲染 / 载荷来自父 / 卸载调 `dispose` / **缺 `preview` 触发 Vue `Missing required prop` 警告**；B `open=false` 不渲染计划态 / `onOpened()` 用父传 ids 触发 plan / 锚点两段逐字在位 / 卸载调 `dispose`；C 渲染复制按钮与 token / `shot=null` 不印空壳 / `copy` 与 `copy-token` 各 emit 正确载荷；② 既有四把锁**零断言改动**全绿（`FilmEngineeringView.test.js` 行为 / `list-stable-keys` 站点搬家 / `text-length-convergence` 例外未陈旧未扩张 / `element-plus` v-loading ≥4）；③ 销账用 `check-max-lines --prune <单键>`（**不用** `--update`：那会把别人的存量漂移登记成新基线） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；新增/修改文件统一 CRLF；全文 **U+FFFD = 0、NUL = 0** |
| 行数与销账 | ✅ | `FilmEngineeringView.vue` **750 → 457 行**（门禁口径）；`check-max-lines` 输出 `挂账=93`、`墓碑=7`、`无新增超大文件`；该键已进 `pruned`（记 457 行） |
| 视觉覆盖 | ✅ | `check-visual-coverage` OK（进域注册表 5 张 / 视图并集 56 / 缺 69 已登记 69、上界 69）；拆出的组件不是独立注册视图，DOM 与 class 逐字未变 ⇒ 视觉基线不需刷新 |
| 品牌残留 / 文档绝对路径 / i18n | ✅ | `check-no-brand-residue` PASS（13417 tracked）；`check-doc-abs-paths --all` PASS（无新增本机绝对路径）；`check-locale-sync` 三档 PASS（2520 个在用 key 均成对） |
| ESLint | ✅ | 改动文件 `eslint --quiet` 无输出 |
| 决策层评审（质量节拍） | ⚠ 未收敛（**环境所致**，已逐条人工回应） | `plan-review.sh` 跑了 **4 轮**：critic 每轮 7–8 条、Critical 1–2 条，全部为**文档精度**类；**proposer(opencode) 每轮都因后端 7800 字符上限被拒**（合成提示 10706 / 9077 / — / 8690 字符）。方案从 4867 → 3298 → 4000 字符逐轮瘦身仍无可用工作点 ⇒ 这条路径对「方案 + 意见」的合成长度**不存在**能跑通的值。按引擎自身给的对策执行：方案只留评审对象 + `rebuttal-r1..r4.md` 逐条回应（其中 2 条给证据拒绝，其余全部采纳并落到代码/文档） |
| 远程同步 | 由门禁推导 | 见下方 bullet（推送时机由「本地门禁全绿」推导，不手工填时间） |
| 全量测试 | ✅ | 见「读数」段 |

### 读数

- 新组件契约：`src/views/film-engineering` **4 文件 / 38 例**全绿（含 A 的「缺 preview 报警」新判据）
- 既有四把锁 + 行为测试：**8 文件 / 78 例**全绿，`FilmEngineeringView.test.js` **断言一字未改**（拆分前后同为 41 例口径）
- 行数：父 **457**、A **177**、B **241**、C **106**
- `v-loading` 4 处实测：`FilmEngineeringView.vue:105`（分镜列表）/ `FilmShotDetailDrawer.vue`（抽屉）/ `PatternAnalysisPanel.vue:13` / `PerformanceInsights.vue:81`；A、B 零新增

### 远程同步 bullet

- **推送前**：本地门禁（行尾两口径 / U+FFFD+NUL / ESLint / max-lines / locale 三档 / 品牌残留 / 文档绝对路径 / 视觉覆盖）全绿 + 上述测试 0 failed ⇒ 才 `git push` 开 PR。
- **推送后**：`git rev-parse HEAD` == `git rev-parse origin/<branch>`；CI 以 `gh pr checks` 逐项回读，任一红 ⇒ 修复后**重跑**（不放宽判据）。
- **合并后**：`main` push 的 `quality-gate` 必须 `completed/success`，`git show --stat <merge sha>` 能看到本批文件；worktree 按 R1–R7 删除。
- **本批特别标注**：含一处**顺手修掉的现存泄漏** —— `useFilmVideoGen().dispose()` 此前从未被调用（父视图只调 `pdDispose()`），现由 A 的 `onBeforeUnmount` 承担；这条修复有独立判据（A 卸载后 `dispose` 计数 == 1）。
