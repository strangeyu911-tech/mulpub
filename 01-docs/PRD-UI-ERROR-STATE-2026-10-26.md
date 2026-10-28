# PRD · 错误态三态统一第一步（审计 3.7 · UiErrorState）

日期：2026-10-26 ｜ 分支：`ux-audit-error-state` ｜ 关联审计：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 3.7、audit-44（emoji 当图标）、audit-47（空态无下一步）、审计正文 line 371（取数失败静默）

## 1. 问题与现场实测（数字全部当场重取，不抄审计原文）

审计行 3.7 写的是"替换 **5 处**自绘错误块"。本批开工前用机械扫描重测（`src/error-state-convergence.test.js` 的 `scanBespokeBlockErrors`，单一实现）：

| 量 | 实测 | 取法 |
|---|---|---|
| `apps/desktop/src/views/**/*.vue` 文件数 | **64** | `walkVue()` 递归 |
| 模板里"整块自绘错误态"（`<div|section>` 且 `class` 含独立 `error` 词元）站点 | **35 处 / 20 个文件** | 同一实现 |
| 其中带**重试出口**的 | 9 处 | 同上 + 附近文本判据 |
| 其中写了 `role="alert"` 的 | 4 处 | 同上 |

⇒ **审计的"5 处"少了一个数量级**。后果不是"数字不准"：按 5 处排期会把"绝大多数失败不被播报"当成小问题。`role="alert"` 缺失的站点，读屏用户只知道"列表空了"，不知道"这次是失败"——这正是 line 371 记的 Home 型静默失败的同一条根。

## 2. 本批范围（做哪一片、为什么是这一片）

做**带重试出口的整块错误态**，共 **7 处 / 6 个文件**：

| 视图 | 旧形态 | 迁移后 | 保留的锚点 |
|---|---|---|---|
| `PerformanceInsights.vue` | `div.pi-error` + `el-button link` | `<UiErrorState :title :hint :retry-text @retry>` | `data-testid="pi-error"` |
| `ProjectLibrary.vue` | `div.error-state` + `UiButton>重试` | 同上 | `test-id="project-library-error"` |
| `ContactSheetView.vue` | `div.cs-error` + `UiButton>重试` | 同上 | `test-id="contact-sheet-error"` |
| `CreateHistory.vue`（渲染记录） | `div.history-error` | 同上 | `test-id="renders-error"`、`class="history-error"` |
| `CreateHistory.vue`（流水线记录） | `div.history-error.pipeline-history-error` | 同上 | `test-id="pipelines-error"`、原 class 双份保留 |
| `video-creation/PipelineSelector.vue` | `div.error-state` + **`<span class="error-icon">⚠️</span>**（audit-44）+ 自造 `button.retry-btn` | 同上（图标改 `el-icon`，读屏容器 `aria-hidden`） | `test-id="pipeline-selector-error"` |
| `video-creation/QuickRenderPanel.vue` | `div.result-banner.error` | 同上 | `test-id="quick-error"`（原 `data-testid="quick-error"` 继续可用） |

刻意**不做**的两件事，都写清理由而不是默默留下：

1. `ReplayTimeline.vue` 退回未迁。原因：它的测试夹具是 `mountComponent(component)` **裸跑、不装 i18n**，在该视图里引入 `$t` 会把 12 条用例打成 `_ctx.t is not a function`。正解是先补夹具（属测试基建改动，与本批的 UI 语义混在一起会让"谁改了什么"说不清），故登记为欠账。
2. 旧自绘块的 **CSS 规则一律没删**（`.pi-error`、`.cs-error` 等仍在各视图 `<style>` 里）。它们现在只是"落点钩子"，与组件自身样式**叠加**。所以本批**不声明"零视觉回归"**——像素判定交给 CI 的 `QG Visual`（基线只能取自同一次 CI 渲染的既有口径），本机不拿截图消化。

## 3. 组件行为合同（`UiErrorState.vue`）

| 项 | 规定 | 为什么不是"看着顺手的写法" |
|---|---|---|
| 播报 | 根节点 `role="alert"`，**禁止**再写 `aria-live` | `role=alert` 已隐含 assertive；两处都写会让同一段文案被朗读两遍。与本仓 4.6 的 toast 结论同源（ElMessage 根节点本来就带 `role="alert"`，"补 role"是错的修法） |
| 标题 | `title` 必填，用户可见 | 失败必须有一句话说明"哪件事失败了"，不能只有图标 |
| 提示 | `hint` 可选；缺省时**不产出**空 `<p>` 节点 | 空节点会被读屏念成空白停顿，也让像素门禁多出不可解释的差异 |
| 重试 | `retryText` 缺省 ⇒ **不渲染按钮**；有值 ⇒ `<button type="button">` 恰好发一次 `retry` | 视图里错误块常嵌在筛选表单内；缺省 `type` 等于 submit，点"重试"会顺带提交表单 |
| 次级出口 | `#actions` 插槽（如"查看帮助"） | 审计 audit-47：13/39 处状态区无任何下一步；把出口做成插槽而不是硬编码文案，才不会被 zh/en 成对门禁打回 |
| 图标 | `el-icon` + `WarningFilled`，容器 `aria-hidden="true"`，**容器文本必须为空** | emoji 当图标（audit-44）会被逐字念出，且像素门禁对图标失明（0.4% 天花板） |
| 焦点 | 重试键必须有 `:focus-visible` 的 `outline`；**禁止** `transition: all` | 3.6 实测：`transition: all` 会把 `outline-*` 纳入淡入，按 Tab 的瞬间焦点环看不见 |
| 颜色 | 只用令牌（`--color-danger` / `--color-danger-soft` / `--color-focus-ring` / `--space-*` / `--radius-*`），**零裸 hex** | 审计 4.2 的存量面是"只可缩小"；新组件不得再加 579 处里的一笔 |
| 锚定 | **两个**锚点 prop：`testId`（容器）与 `retryTestId`（重试键本身）→ `data-testid` | 迁移必须保住远处用例与像素门禁赖以锚定的 id。⚠️ 第二轮外部评审实测：**容器保住了不等于按钮保住了** —— `QuickRenderPanel` 原重试键挂着 `data-testid="quick-retry"`，第一版迁移把它整块替换后锚点静默丢失，且全仓当下没有消费者 ⇒ 不会以测试失败的形式浮现。已补 `retryTestId` 并新增一条由 `origin/main` 改动前 blob 派生的锚点判据（37 个锚点逐个要求仍在），A/B 实测有牙：摘掉即红并点名该 id |
| 文案 | 模板零中文字面量，全部走 props；共享文案落 `locales/error-states/{zh,en}.js` 的 `errorStates` | CI Gate 7 的 zh/en 成对 + `--cjk` 前置到单测，不等 CI 才发现 |

显示项（用户看到什么）：图标 + 一句标题 +（可选）一句提示 +（可选）一个重试按钮/自定义动作区。共享文案 zh：`重试` / `本地服务或网络可能只是一时没响应，重试通常就能恢复。`；en 成对。

## 4. 接线判据（`src/error-state-convergence.test.js`，14 条）

| 判据 | 内容 | 反向形态（同一批实测抓到的） |
|---|---|---|
| 逐站点接线 | 模板含 `<UiErrorState`；以**未注释整行** `import` 装载；旧块不得再以 `<div|section|p|span>` 开标签 + 同 class 出现；`test-id` 保留 | 迁移后 `class="pi-error"` 仍在（落在组件上）——所以"旧块已消失"的判据**只能按语法位置切**，写成 `tpl.includes('pi-error')` 会假红 |
| Options API 注册 | 文件是 `<script>`（非 `<script setup>`）⇒ 必须出现在 `components: { … UiErrorState … }` 里 | **本批实测活缺陷**：`PipelineSelector.vue` 是 Options API，只 import 不注册时 Vue 不报错，把未知标签原样渲染成**空元素**——`.error-state` 照样 `exists()===true`，屏幕上却什么都没有。`CreateHistory.vue` 同形，也被同一条抓住 |
| 死导入 / 撞车声明 | `deadImports()` 单一实现：摘掉 import 语句后标识符在文件里一次都不出现 ⇒ 判死 | `ProjectLibrary.vue` 迁完后 `UiButton` 只剩 import，正是 #4424 那类"vitest 全绿、vite build 才炸"的形态 |
| 遍历完整性 | `visited === MIGRATED_SITES.length` 且清单 ≥6 | 清单塌空 ⇒ 所有逐站点判据恒真 |
| 存量棘轮 | 逐文件读数必须与 `REGISTRY` **逐项相等**；总数 28；每次跑打印 `[ERR-RATCHET] files= total=` | 双向：新增未登记 ⇒ 红；就地减少却不改表 ⇒ 陈旧红（逼下一次批次同次销账）。⛔ 不得为"容忍自己的退化"调大表 |
| 反失明前提 | `scannedFiles > 40`、`total > 0`、`keys.length ≥ 登记文件数` | "存量=0"与"什么都没扫"必须可区分 |
| emoji 消失 | `PipelineSelector.vue` 模板零 emoji | audit-44 的具体落点 |
| locale 配对 | 模板用到的每个 `errorStates.*` 在 zh/en 两侧都有；且两份文件都接进 `locales/zh.js` / `en.js` 聚合入口 | "文件写了但没接线"= 运行时取不到，等于没修 |

## 5. 验证

- `vitest run` 8 个相关测试文件 ⇒ `Test Files 8 passed (8) / Tests 125 passed (125)`（含新组件 12 条、收敛锁 14 条）
- `vite build` ⇒ rc=0，无 `already been declared` / `could not be resolved`
- 变异驱动 `scripts/error-state-mutate.cjs` ⇒ 读数见执行记录：**CAUGHT=12/12**（E1–E12，逐刀点名归因；基线趟 rc=0、还原后复跑 rc=0）
- ⛔ 未做：本机像素回归（dev server + CI 同源基线不在本机成立）；QM-1 打包（本批未触碰 `electron/`、`packages/rpa-engine/`）
