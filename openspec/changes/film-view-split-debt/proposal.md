# change: film-view-split-debt（方案 v3）

基线 `origin/main` @ `6918533fb`；行号以此为准。行级明细 `design-details.md`，评审回应 `rebuttal-r1.md`/`rebuttal-r2.md`（人读）。

## 目标

`FilmEngineeringView.vue` 现 750 行（门禁口径），上限 = 挂账 605 + 容差 200 = 805。拆三块后该文件 **≤ 500 行**（硬限），并**删除**其在 `max-lines-baseline.json` 的条目。

## 为什么

`vgPhase`（六态）/`pdPhase`（七态）/详情抽屉三块互不依赖，只共用一个宿主文件：改一个要通读 750 行；余量 55 行改几处就吃光，下一个加字段的人只剩「抬挂账」一条路。

## 拆块（实测行号）

| 块 | 模板行 | 行数 | 脚本原文行 | 新文件（`views/film-engineering/`） |
|----|--------|------|-----------|-----------------------------------|
| A 视频生成 | 242–323 | 82 | 459–489 | `FilmVideoGenPanel.vue` |
| B 全量出片 | 325–419 | 95 | 491–554 | `FilmProductionPanel.vue` |
| C 详情抽屉 | 184–227 | 44 | 454–455、610–613、644–650 | `FilmShotDetailDrawer.vue` |

样式（实测）：父视图删 **29 行**（`fe-vg*` 14 + 详情区 12 + 3 个共用单行）；A/B 各带 **13 条 `.fe-vg*` 规则 + 1 行注释**，C 带 **12 条**。

## 预算（实测，不用理论估算）

父视图 **750 → 457 行**（`check-max-lines` 逐文件读数）；A=177 / B=241 / C=106 行。销账后 `挂账=93`、`墓碑=7`。

## 接口面

`preview`：`Function`、**必填、刻意不给默认值** —— 缺了 Vue 立刻 dev 警告、组件测试当场红；默认成空函数会把「没传」渲染成空提示词（假绿）。它永远是父的 `promptPreview`。

`open` 由**父视图持有**（`v-model:open`）：入口按钮在分镜库工具条上，且既有行为测试断言的正是 `wrapper.vm.productionPanelOpen === true`。

| 组件 | props | emits | expose |
|------|-------|-------|--------|
| A | `open`(Bool)、`selected-payload`(Fn = 父 `selectedShotsPayload()`)、`selected-count`(Num)、`preview`(Fn) | `goto-models`、`update:open` | `resetError()` |
| B | `open`(Bool)、`selected-ids`(Arr)、`selected-count`(Num)、`preview`(Fn) | `goto-models`、`update:open` | `onOpened()` |
| C | `open`(Bool)、`shot`(Obj = 父 `shotDetail`，仅展示)、`loading`(Bool = 父 `detailLoading`，源自 `useFilmEngineering()`)、`preview`(Fn) | `update:open`、`copy`(kind)、`copy-token`(串) | — |

⚠ `open` 之所以不放子组件：既是既有白盒断言的锚点，也让「打开面板」这件事只有一处真源。

⚠ B 的外层 `v-for="b in batches"` 与内层**一起搬**（`b` 才有定义）；内层的 `(sh, si)` 与 `b.shots` 两段逐字保留。

`copy-token` 回传的 `ref.token` 不是凭据：模板中早已 `<code>{{ ref.token }}</code>` 明文渲染、旁边就是复制按钮（形如 `@ROKO`）；父侧 `copyRefToken` 行为逐字不变 ⇒ 不新增数据通路与暴露面，故不做掩码（掩码会改用户拿到的 token）。

## 已核实

1. `useFilmVideoGen.js`/`useFilmProduction.js` 只 import `vue` + `@/api/electron-bridge` + shared-utils；`grep -E "useFilmEngineering|useRoute|inject\("` 均 0 命中 ⇒ A/B 各持实例与父持一份等价。**A/B 内各自 `import { useFilmVideoGen }` / `useFilmProduction` 并在 `onBeforeUnmount` 调 `dispose()`**（不是「父帮它们调」）。
2. `useFilmVideoGen` 导出 `dispose()`（:268/:276），父视图今天**只调 `pdDispose()`** ⇒ 现存轮询泄漏；A 卸载时调它，顺手修掉（记录单独 bullet）。
3. A/B 的 `.fe-vg*` 各 13 条规则 + 1 行注释（逐字同源）；父视图删 29 行后对 `fe-vg*`/`fe-detail*` 选择器 **0 命中**（`grep` 已确认）。
4. 销账用 `check-max-lines --prune <单键>` 执行（**不用** `--update`，它会连带把别人的存量漂移登记成新基线）；跑完输出 `挂账=93`、`墓碑=7`（该键在 `pruned` 里记 457 行）。

## 五处必须做对

1. `promptPreview` 原地不动、prop 下传：`text-length-convergence.test.js` 两条硬判据（登记文件 0 命中 ⇒ 红；新文件命中 ⇒ 红），加 `ALLOWED` = 扩清单（禁止）；也不迁 `truncate()`（例外理由要求与像素基线同批）。
2. `v-loading` 双证：`element-plus.test.js` 只断 ≥ 4 ⇒ 另加逐文件 `git grep -c v-loading`，确认两处落进 C、总数仍 4。
3. 清理归属：**父视图不再调用任何 `dispose`**（`pdDispose()` 已从父的 `onBeforeUnmount` 删除）；A、B 各自在 `onBeforeUnmount` 调自己那份（子先于父卸载 ⇒ 不互相覆盖）。
4. B 内**逐字保留** `v-for="(sh, si) in b.shots"`（`list-stable-keys` 机械匹配点），表项 `file` 改指 B。
5. 销账：删键 `apps/desktop/src/views/FilmEngineeringView.vue`（605）；门禁须打印 `挂账=93` + `无新增超大文件`。

## 不做

分镜库 tab（52–127）、剧本套用 tab（129–176，`roleEntries` 被父的配置档案快照/dirty 共读）；不迁截断实现；不改 i18n/DOM/class/`element-plus.js`；不抬任何门禁数。

## 验收

① 父 ≤ 500 行 ② `挂账=93` 且该文件无超限条目 ③ `FilmEngineeringView.test.js` 零断言改动全绿（基线 4 文件/41 例） ④ `list-stable-keys` ⑤ `text-length-convergence` ⑥ `element-plus` + 位置双证 ⑦ 三个新测试各「挂载 + 一条关键态」：A `open()` 后 idle 态出现 `fe-video-aspect`；B `open()` 触发 `planProduction` 后 plan-ready 缺省态；C `open=true` 渲染 `fe-detail-copy` ⑧ `check-visual-coverage` + QM-4 ⑨ 行尾两口径/U+FFFD+NUL/ESLint/locale 三档/品牌残留/文档路径/`check-gate-record-debt` ⑩ 记录含 `远程同步` 行 + bullet（含「含 videoGen dispose 泄漏修复」）

## 风险

漏转发 ⇒ 既有行为测试当场红；样式不全 ⇒ QM-4 对照；三块分三次独立提交，每步先跑既有全绿。
