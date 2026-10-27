# tasks — film-view-split-debt

> 方案 `proposal.md`（v4）；行级清单 `design-details.md`；基线 `origin/main` @ `6918533fb`。

## 1. 三个子组件（各自一台状态机 + 自己的清理钩子）

- [x] 1.1 A `FilmVideoGenPanel.vue`：六态 + `useFilmVideoGen()` + **`onBeforeUnmount → dispose()`**（修掉父视图从未调用它的现存泄漏）
- [x] 1.2 B `FilmProductionPanel.vue`：七态 + `useFilmProduction()` + `dispose()`；内层锚点 `(sh, si)` / `b.shots` 逐字保留
- [x] 1.3 C `FilmShotDetailDrawer.vue`：只读展示；`copy` / `copy-token` 走 emit 回父（子组件不碰 clipboard）
- [x] 1.4 三个组件都收 `preview`（= 父 `promptPreview`，**不搬家**：文本长度例外清单既不许陈旧也不许扩张）

## 2. 父视图改造

- [x] 2.1 `FilmEngineeringView.vue`：三块模板换成组件标签；删除重复样式族（`fe-vg*` 14 行 + 详情区 15 行）
- [x] 2.2 开关留在父（`videoPanelOpen` / `productionPanelOpen` + `v-model:open`）—— 既有白盒断言锚点
- [x] 2.3 `onBeforeUnmount` 只留虚拟滚动 sentinel（`pdDispose` 已随 B 进子组件）
- [x] 2.4 父视图 **750 → 457 行**（门禁口径），低于 500 硬限

## 3. 销账

- [x] 3.1 `check-max-lines --prune apps/desktop/src/views/FilmEngineeringView.vue`（单键清账，**不用** `--update`）
- [x] 3.2 复查：`挂账=93` / `墓碑=7` / `无新增超大文件`

## 4. 测试

- [x] 4.1 `FilmVideoGenPanel.test.js`（3 例）：idle 渲染 / 载荷来自父 / 卸载调 dispose
- [x] 4.2 `FilmProductionPanel.test.js`（4 例）：open=false 不渲染计划态 / `onOpened()` 用父传 ids plan / 锚点两段在位 / 卸载调 dispose
- [x] 4.3 `FilmShotDetailDrawer.test.js`（4 例）：渲染复制按钮与 token / `shot=null` 不渲染空壳 / copy emit / copy-token emit
- [x] 4.4 既有四把锁**零断言改动**全绿：`FilmEngineeringView.test.js`（行为）/ `list-stable-keys`（站点搬家）/ `text-length-convergence`（例外未陈旧未扩张）/ `plugins/element-plus`（v-loading 命中数）

## 5. 门禁与交付

- [x] 5.1 `check-max-lines` / `check-locale-sync` / `check-no-brand-residue` / `check-doc-abs-paths` / `check-visual-coverage` / ESLint
- [ ] 5.2 PR → CI 全绿 → squash 合并 → main push 回读
- [ ] 5.3 worktree 清理（R1–R7）

## 验收（可执行）

| 判据 | 命令 | 期望 |
|------|------|------|
| 行数销账 | `node .github/scripts/check-max-lines.js` | `挂账=93`、`墓碑=7`、`无新增超大文件` |
| 行为未变 | `vitest run src/views/FilmEngineeringView.test.js` | 与拆分前同用例数、全绿、**断言未改** |
| 站点搬家 | `vitest run src/list-stable-keys.test.js` | 全绿 |
| 例外未变 | `vitest run src/text-length-convergence.test.js` | 全绿（既未陈旧也未扩张） |
| 指令装配 | `vitest run src/plugins/element-plus.test.js` | 全绿 |
| 新组件 | `vitest run src/views/film-engineering` | 11 例全绿 |
