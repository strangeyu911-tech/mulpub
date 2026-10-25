# inline-notice-green 执行记录

| 远程同步 | 由门禁推导 |
| --- | --- |

## 变更标题

内联文字提示统一为绿色提示条（inline-notice-green）

## 变更类型与隔离声明

- 类型：运行时代码变更（apps/desktop/src 样式 + 组件 + i18n）
- 隔离：在隔离 worktree `mp-inline-notice-green`（分支 `inline-notice-green`）完成，
  未在共享主工作区直接修改运行时路径。共享根仅用于只读 git 取证。

## 需求与验收标准

用户提供参考截图：绿色内联提示条（浅绿底、绿描边、左侧对勾、右侧关闭 ×），一行文字。
要求把项目里「一行或两行文字的内联文字提示」（明确排除弹窗/浮层 toast）改成这个绿色样式。

验收标准：

1. 内联文字提示统一呈现绿色参考样式；
2. 不改变弹窗（UiModal / el-alert / ElMessage）与浮层 toast 的既有样式；
3. 颜色一律来自 tokens.css 语义槽，禁止就地 hex/rgba 字面量；
4. 暗色模式必须有对应覆盖（spec「主题令牌必须自带暗色覆盖」）；
5. zh/en locale 成对更新，无新增硬编码中文；
6. 相关既有测试全绿，且新增组件契约测试。

## 方案对比

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| A. 逐文件改色 | 在每处存量提示的就地 CSS 里换绿色值 | 否。会留下 4-5 份重复配色，正是本项目反复付代价的「第二套真相」；且存量里已有三套不同的绿（#ecfdf3/#f0fdf4/#d1fae5） |
| B. 抽共享组件 + token | 新增 `UiInlineNotice.vue` 与 `--color-inline-notice-*` 槽位，存量同类提示迁移过来 | 是。符合 spec「反馈原语统一」与「token 单一来源」 |

## 实现清单

新增：

- `apps/desktop/src/components/UiInlineNotice.vue` —— 内联提示条唯一实现。
- `apps/desktop/src/components/icons/CheckIcon.vue` —— 24 网格线性对勾图标。
- `apps/desktop/src/components/UiInlineNotice.test.js` —— 14 条契约测试。

修改（4 处存量提示迁移到新组件）：

- `CacheCleanupSection.vue` —— 清理成功提示；失败提示从「成功绿」改到 danger 语义槽
  （原 `#067647/#ecfdf3` 是成功绿被失败复用，属配色错误）。
- `LogsSettings.vue` —— 反馈提交成功提示；删除无消费方的 `.feedback-success` 副本。
- `UpdateNotification.vue` —— 「已是最新版本」；删除 `.ui-toast*` 副本。
- `AccountProxyDialog.vue` —— 「当前代理」；删除 `.proxy-status` 自绘配色。
- `styles/inline-notice-tokens.css`（新增）—— 5 个 `--color-inline-notice-*` 槽，亮暗成对。
- `main.js` —— 在 tokens.css 之后引入上述文件。
- locales 成对新增 4 个 key：`settings.cache.clearedToastClose`、`settings.feedback.successClose`、
  `update.latestVersionClose`、`accountsPage.proxyConfigured`。

`styles/tokens.css` 最终与主干**零 diff**：新增的 5 个槽位一度写在里面，使文件从 498 行
涨到 507 行，触发 `check-max-lines` 的 NEW_OVER_LIMIT（500 行门禁）。按门禁处方拆到
独立文件，`tokens.css` 回到 498 行。

未改动（保持原样，理由记录在案）：

- `s2v-options-toast`（CreateView 底部）—— 已用 `--banner-success-*` 语义槽，且是 1.6s
  自动消失的瞬时提示，无关闭钮/对勾，与参考形态不同；套用会改变其存在时长语义。
- `PipelineBackgroundToast` / `fr-toast` —— 浮层/全屏 toast，用户明确排除。
- `provider-warning-banner` / `bgm-skipped-notice` / `s2v-selection-banner` —— 警告/信息语义横幅，
  改用成功绿会丢失语义色区分。

## 关键实现决策（详见组件注释与测试，此处只留结论与理由）

1. **live region 常驻，v-if 只切内层**：若 v-if 挂在带 `role=status/aria-live=polite` 的根节点，
   关闭时整个 region 被移出 DOM，之后不再被读屏播报（OfflineIndicator 的 QM-6 i2 同款教训）。
2. **空态不占位用 `:empty` + `display:none`，不用 `display:contents`**：后者会把宿主元素
   移出可访问性树，live region 随之失效（deep-review i1，Chromium/Firefox 均如此）。
   元素必须始终留在 DOM 与可访问性树中。
3. **样式契约判据禁 hex 也禁就地 rgba**：只禁 hex 时，`rgba(4,181,75,.12)` 这类品牌绿派生色
   会绕过去（deep-review i3）。判据先剥块注释再扫，避免注释里的禁用说明自咬。
4. **失败提示不复用成功绿**：缓存清理失败原先用 `#067647/#ecfdf3`（成功绿），已改到 danger 槽。

## 色值取证（参考截图逐像素取样，非目测）

从用户截图 `局部截取_20261026_000751.png` 用 System.Drawing 逐像素取样：

- 提示条底色 `#D9F4E4`、边框/对勾主色 `#04B54B`、高度约 46px、圆角约 8px、左右内边距约 12px。
- 文字档不用 `#04B54B`：它在 `#D9F4E4` 上对比仅约 2.0:1（低于 WCAG AA 正文 4.5:1），
  取加深的 `#076B33`（约 5.6:1）；边框与图标沿用 `#04B54B`（非文本阈值为 3:1，实测约 3.3:1）。
- 暗色档同构：底 `#052E16`、描边/图标 `#4ADE80`、文字 `#86EFAC`（约 9.1:1）。

对比度由 `UiInlineNotice.test.js` 用与 `check-trial-banner-contrast.js` 同一套 WCAG 公式逐档断言。

## 质量节拍自检

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 会话隔离 | ✅ | worktree `mp-inline-notice-green`；`pre-code-edit-guard` 在共享根正确 BLOCKED |
| TDD | ✅ | 先写测试再实现；抓到 2 个真实缺陷（vitest 路径解析、空 `aria-label` 仍渲染属性） |
| 相关测试 | ✅ | UiInlineNotice 14 + CacheCleanupSection 5 + AccountProxyDialog 6 + accounts 全域 200 = 全绿 |
| token 契约 | ✅ | `src/styles` 8 个契约文件 60 条全绿 |
| Gate 10 前端一致性 | ✅ | `check-frontend-consistency.js` PASS（windowConfirm 0 / rendererIpcDirect 0 / appleAlias 0） |
| Gate 14 色字面量 | ✅ | 当前 125 / 基线 129（下降 4，无新增） |
| Gate 15 Vue style parse | ✅ | 244 个 .vue / 193 个样式块 PASS |
| Gate 7 i18n | ✅ | `--keys` 2334 key 全存在 / `--cjk` 无新增 / `--symmetry` drift=0 |
| Gate 11 ESLint | ✅ | 改动与新增文件 `--quiet` 全绿 |
| 未接线组件 | ✅ | 未接线=3 / 基线=3，无新增未登记 |
| 视觉基线 | ✅ | 视觉注册表未引用本次改动的任何类名，无基线需更新 |
| 逐文件行数门禁 | ✅ | `check-max-lines.js` 无新增超大文件；`tokens.css` 与主干零 diff |
| CCG 深度评审 | ✅ | 3 轮共 12 条争议逐条裁决；4 条 upheld 全部修复并配变异反证，8 条 dismissed 均给出可核实依据 |
| CI（PR #4476 首轮） | ❌→✅ | 首轮 3 红，根因是 `tokens.css` 从 498 行涨到 507 行触发 500 行门禁；按门禁处方拆出 `inline-notice-tokens.css` 后本地全绿 |

### 变异反证记录（每条 upheld 都必须有）

| 变异 | 结果 |
| --- | --- |
| v-if 移回根节点（i1 轮1） | 2 条测试红 |
| hover 底改回就地 rgba（i3 轮1） | 1 条测试红 |
| 播报槽改回 `display:contents`（i1 轮2） | 1 条测试红 |

## QM-1 打包验证

未执行。本次改动仅涉及渲染层 Vue 组件与 CSS token，未触碰
`apps/desktop/electron/` 或 `packages/rpa-engine/`，按 QM-1 触发条件不适用。

## 残留风险

- 暗色对比度是按 token 值计算论证的，未经真实浏览器截图验证；CI Gate 7c 是最终判据。
- 参考截图的对勾是「实心圆 + 白勾」，本实现用线性描边勾（与项目既有 Lucide 图标族一致）。
  若用户要的是实心圆底勾，需再迭代。
- `UiInlineNotice.test.js` 用 `readFileSync` 读组件与 tokens.css 源码做样式契约断言，
  组件移动路径会让这些用例失败（届时同步改路径即可，属显式代价而非隐藏耦合）。

## CHANGELOG 条目

### 内联文字提示统一为绿色提示条（inline-notice-green）

设置页缓存清理结果、用户反馈提交结果、「已是最新版本」、账号代理「当前代理」四处内联文字提示，
统一改为绿色内联提示条：浅绿底 + 绿描边 + 左侧对勾 + 右侧关闭钮。

实现上新增共享组件 `UiInlineNotice` 与 `--color-inline-notice-*` 语义槽（亮/暗成对），
存量各处自绘的绿色提示样式（三套不同绿值）随之删除。缓存清理**失败**提示原本复用了成功绿，
本次改到危险色语义槽，避免「失败了却显示绿色」。
