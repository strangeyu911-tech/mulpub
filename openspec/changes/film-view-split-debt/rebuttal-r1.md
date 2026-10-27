# 决策层评审 · 第 1 轮回应（8 条）

> critic = claude（`SINGLE → DUAL` 判定后由判定器给 DUAL）；维度分 completeness 7 / consistency 6 / clarity 6 / feasibility 5 / security 8；Critical 2。
> 本轮 proposer（opencode）**未能完成修订**：输入 10706 字符 > 其后端上限 7800（实测边界 (8125, 8145]，非文档承诺、同步 exit 1 无输出）。
> ⇒ 按引擎自身给的对策执行：**方案瘦身**（v2 只留评审对象，4867 字符）+ 逐条人工回应（本文件），然后重跑。

| # | 严重度 | 结论 | 处置与证据 |
|---|--------|------|-----------|
| i1 | Critical | **成立** | ① §四 prop 列已显式标注 `preview` = 父的 `promptPreview`（不搬家）；② §三 预算改成**精确算式**：删除 221+108+29=358、新增 12、预计 404；验收口径写 **≤500**，不再用 `≈445`；③ §二 表改为「模板行（精确区间）／脚本原文行」两列，不再把原行号当新文件行数。 |
| i2 | Warning | **成立** | ① prop 命名统一为 `preview` 并在 §四 注明等于 `promptPreview`；② §七⑥ 增加**位置核查**：`vitest run src/plugins/element-plus.test.js`（只断 ≥4）+ 逐文件 `git grep -c v-loading`，确认两处落在 C、总数仍 4 —— 光有计数确实不足以保行为一致。 |
| i3 | Critical | **成立，且顺手修一个现存缺陷** | §五③ 明确：B 的 `pdDispose()` 随 B 进 `onBeforeUnmount`；**A 也必须调 `dispose()`** —— 核实 `useFilmVideoGen.js:268/276` **确实导出 `dispose`**，而父视图今天**只调 `pdDispose()`**、从未调它 ⇒ 现存轮询 `clearInterval` 泄漏。A 卸载时调用后，Vue 的父子卸载顺序（子先于父）天然对齐。 |
| i4 | Warning | **成立** | §七⑦ 列出三个测试文件名，并给出机械依据：`check-unwired-tests.js` 的 `WORKSPACE_COVERED = ["apps/", "packages/", "ops-center/"]` ⇒ `apps/desktop/src/**/*.test.js` 由 vitest 自动收集，不需要 workflow 逐文件提名（该门禁只管 `scripts/`、`.github/scripts/` 这类无人收集的测试）。 |
| i5 | Warning | **成立** | 同 i1②：去掉所有 `~`；模板与脚本分行列；目标行数由「≈445」改为硬判据「≤500」。 |
| i6 | Info | **采纳并写明** | §四 末条：C 的 `shot` prop 就是现在模板直接渲染的 `shotDetail` 对象（仅展示），**不新增数据通路**；`copy-token` 只回传该对象里已存在的 `ref.token` 字符串，父侧 `copyRefToken` 行为逐字不变。 |
| i7 | Info | **采纳并写成硬约束** | §五④：B 内必须**逐字保留** `v-for="(sh, si) in b.shots"`（`list-stable-keys` 的机械匹配点），同时把该表项的 `file` 改指新路径。 |
| i8 | Warning | **采纳并写死键名** | §五⑤：`max-lines-baseline.json` 删除键 `apps/desktop/src/views/FilmEngineeringView.vue`（值 605），`check-max-lines` 需打印 `挂账=93` 且逐文件读数里不再出现该文件超限条目。 |

## 对「不成立的批评」的说明

本轮 8 条**全部成立**，无拒绝项。唯一需要纠正的是**评审流程本身**：第 1 轮未能收敛的原因不是方案有 2 个 Critical 未回应，
而是 proposer 后端长度上限（7800 字符）把整份方案 + 角色提示一起拒了；方案瘦身后重跑，回应已在上表逐条落位。
