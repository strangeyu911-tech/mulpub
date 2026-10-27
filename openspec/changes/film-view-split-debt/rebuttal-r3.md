# 决策层评审 · 第 3 轮回应（7 条，摘要）

> 本轮 proposer 首次跑通（方案 3298 字符），但返回的 edits 校验失败（`edits[6].before` 在原文找不到 ⇒ 引擎判「方案将原封不动」而拒绝收敛）。
> 7 条问题的处置已**落到方案 v4 正文**，不另设长表；下面只留结论与指向。

| # | 严重度 | 结论 | 落到哪里 |
|---|--------|------|---------|
| i1 | Critical（security，copy-token 明文） | **部分成立** | 我原文「掩码会改用户拿到的 token」表述不严谨。已在方案 §接口面 末段改成两层：掩码**显示**=改 UI（本批不动 DOM/视觉基线）；掩码**传输**=剪贴板拿到 `***`（功能直接坏）。同时承认「事件通路本身是一个新增拦截面」，并写明风险模型（只覆盖本抽屉已渲染的 `resolvedRefs`、不过 IPC、不落日志）。第 4 轮再次提出同一问题，见 `rebuttal-r4.md` i1。 |
| i2 | Warning（B 内 `b` 未定义） | **成立** | B 的外层 `v-for="b in batches"` 与内层一起搬；方案 §接口面 已加一句写明「两层一起搬，`b` 才有定义」。 |
| i3 | Warning（`preview` 缺默认值） | **拒绝，给理由** | `required: true` + 无默认值是有意的：漏传要**当场红**（dev 警告 + 新增的「缺 preview ⇒ `Missing required prop`」判据），而不是渲染成空提示词（静默降级）。 |
| i4 | Warning（A/B 样式块是否一致） | **成立，已实测** | 两份 `.fe-vg*` 各 **13 条规则 + 1 行注释**，逐字同源；父视图删 29 行后对 `fe-vg*`/`fe-detail*` 0 命中（`grep` 证据）。 |
| i5 | Warning（销账是否入执行清单） | **成立** | `tasks.md` §3 与记录「行数与销账」行都写了：`--prune` 单键清账 + `挂账=93`/`墓碑=7` 复查。 |
| i6 | Warning（A 是否真的引入 composable） | **成立** | A 内 `import { useFilmVideoGen }` + `onBeforeUnmount(() => dispose())`，并有「卸载后 dispose 计数 == 1」的判据。 |
| i7 | Info（锚点缺锁） | **成立** | `FilmProductionPanel.test.js` 增加源码级哨兵：`(sh, si)` / `in b.shots` / `:key="sh.shotId || si"` 三段必须在位。 |
