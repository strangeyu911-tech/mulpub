# 决策层评审 · 第 4 轮回应（8 条）

> critic 维度分：completeness 6 / consistency 5 / clarity 6 / feasibility 5 / security 4；Critical 2。
> 第 4 次仍未收敛的原因**依旧是 proposer 后端 7800 字符上限**（本轮任务提示 8536 > 7800）。四轮实测：方案 4867→3861→3298→4000 字符时，合成提示 10706→9077→(通过)→8690；方案每多 700 字符就重新越界 ⇒ **这个引擎在这条路径上对「方案+意见」的合成长度没有可用工作点**。以下仍按引擎给的对策做：方案只留评审对象、逐条人工回应。

| # | 严重度 | 结论 | 处置与证据（全部以**实测**为准） |
|---|--------|------|-----------------------------|
| i1 | Critical | **部分成立** | 事件通路**确实是**新增的一个拦截面（子→父），我此前写「不新增通路」不严谨。风险模型写清楚：`copy-token` 只在**本抽屉已渲染的** `shot.resolvedRefs` 上触发（不枚举其他分镜）；它是组件事件、不过 IPC、不落日志、不持久化；父侧处理器与拆分前**同一份** `copyRefToken`（`navigator.clipboard.writeText`）。**不做掩码**的两个理由分别成立但要分开说：① 掩码**显示**=改 UI，本批不动 DOM/视觉基线；② 掩码**传输**=剪贴板里拿到 `***`，功能直接坏。已写进方案 §接口面末段。 |
| i2 | Critical | **成立** | 数字打架是我写错：父视图删的是 **29 行**（`fe-vg*` 14 + 详情区 12 + 3 个共用单行），而 A/B 各自带 **13 条 `.fe-vg*` 规则 + 1 行注释**、C 带 **12 条**。方案 §拆块/§已核实 已统一成这组实测数，并把预算换成**实测结论 457 行**（不再用理论 `+15`）。 |
| i3 | High | **部分成立** | 三处 props **代码里都写了 `required: true`**（方案表格没标出来）。已把表内标成 `Fn!` 并在 rebuttal 附完整声明：`preview: { type: Function, required: true }`（A/B/C 同）。 |
| i4 | Warning | **拒绝，给理由** | `selected-payload`(Fn) 与 `selected-ids`(Arr) 语义不同（一个是「取载荷的函数」，一个是「id 数组」），强行同名会让调用方误以为同型；`resetError()`/`onOpened()` 是各自唯一需要的入口；C 无 `goto-models` 因为它是**只读**抽屉、没有任何跳模型设置的入口 —— 补齐「每个组件都有同样三个 emit」才是为一致性牺牲语义。已在方案表格上方注明这条约定。 |
| i5 | Warning | **成立** | 方案 §五③ 改成明确句：**父视图不再调用任何 `dispose`**（`pdDispose()` 已从父的 `onBeforeUnmount` 删掉，A/B 各自的 `onBeforeUnmount` 持有自己那份），Vue 卸载顺序子先于父 ⇒ 不存在「互相覆盖」。 |
| i6 | Warning | **成立** | 不再给理论预算：**实测父视图 457 行**（门禁口径，`check-max-lines` 逐文件读数），A=177 / B=241 / C=106 行；销账后 `挂账=93`、`墓碑=7`。 |
| i7 | Info | **成立** | 新增一条「缺 `preview` 就报警」的测试（`FilmVideoGenPanel.test.js`：不传 `preview` ⇒ `console.warn` 命中 `Missing required prop`），把 `required: true` 从「代码里写了」变成「有判据盯着」。提交顺序：A→B→C 各自独立提交，每步先跑基线 4 文件 41 例。 |
| i8 | Info | **成立** | 拆分后 4 处 `v-loading` 实测位置：`FilmEngineeringView.vue:105`（分镜列表）/ `FilmShotDetailDrawer.vue`（抽屉）/ `PatternAnalysisPanel.vue:13` / `PerformanceInsights.vue:81`；A、B **零新增**（`git grep` 已确认）⇒ `element-plus.test.js` 的 ≥4 下界仍成立。 |
