# PRD：编辑器字数上限按所选平台就地生效（审计 4.7 ②③）

- 日期：2026-10-26 ｜ 分支：`ux-audit-platform-content-limit`
- 上游：`01-docs/PRD-CODEPOINT-LENGTH-2026-10-25.md`（①「展示口径统一为 Unicode 码点」已随 #4424 合并）
- 真源：`packages/shared-utils/src/publish-capabilities.json` 的 `limits.contentMax` / `titleMax` / `titleMaxBytes`（15 平台），派生入口 `apps/desktop/src/features/publish/publish-contract.js` 的 `getPlatformContentLimit()` 与 `minContentBudget(platforms, title)`
- 审计来源：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 4 · 4.7 的 ②「编辑器就地显示该平台上限与真实单位」与 ③「富文本模式补上限」

## 1. 缺陷（当场实测，不是推断）

`Publish.vue` 的编辑器标签是 `<ArticleEditor data-testid="publish-editor" v-model="article.content" />` —— **从不传 `max-chars`**。而 `ArticleEditor` 的 `maxChars` prop 默认取应用级常量 `APP_ARTICLE_CONTENT_MAX`，于是：

- 用户勾了快手（注册表 `contentMax: 480`）却在编辑器里看到「1200/10000 字」，一路写到发布校验才被拦——**界面显示的上限不是真正约束他的那个上限**；
- 更糟的是 `minContentBudget()` 在「未选平台 / 未知平台」时返回 `null`。本批接线前，若直接把 `null` 绑上去，计数器会渲染成 `7/ 字`。实测改前的 `ArticleEditor` 对非法 `maxChars` **毫无防护**：`maxChars=null → "7/ 字"`、`0 → "7/0 字"`、`-5 → "7/-5 字"`、`"abc" → "7/abc 字"`、`NaN → "7/NaN 字"`（红测原样复现这五档）。

## 2. 修复

| 位置 | 改动 |
| --- | --- |
| `components/ArticleEditor.vue` | 新增单一归一入口 `effectiveMaxChars`：必须是**有限正数**，`Math.floor` 后生效；否则回落 `APP_ARTICLE_CONTENT_MAX`。三处消费点全部改用它——计数文本分母、超限红态判据 `charCount > effectiveMaxChars`、Markdown `textarea` 的 `:maxlength` |
| `views/Publish.vue` | `<ArticleEditor … :max-chars="minContentBudget(selectedPlatforms, article.title) ?? APP_ARTICLE_CONTENT_MAX" />`；具名导入并到既有一行末尾 |

三条口径：
1. **不在视图里另写一份上限表**——上限只从 `publish-capabilities.json` 经 `minContentBudget` 派生（多平台时取最小，且已扣掉「无标题平台把标题折进描述」的 `noTitleOverhead`）。
2. **归一放在组件、兜底放在调用点**：组件对任意调用方（不止 Publish）都拒绝垃圾分母；调用点的 `??` 让「没选平台」这一语义在调用处可读。
3. **Publish.vue 是指名还账、零增长容差的文件** ⇒ 绑定写进同一行、导入并回上一行，净增行 0（`git diff --numstat` = 2/2）。

## 3. 显示项与交互（用户可见）

- 计数器分母从「应用级 10000」变为「当前所选平台里最紧的那个预算」，单位文案不变（`publishPage.articleCharCount`，zh/en 成对，已存在）；
- 超限红态阈值随之下移 ⇒ 勾了 480 上限的平台时，超过 480 立即变红，而不是等到发布校验；
- 无任何新增控件、无文案新增（因此无新增 locale 键）、无样式改动；
- **像素门禁影响**：`/publish` 不在像素判定域的视图基线里；若 Gate 7b 报 `publish-form` 等基线 stale，按「基线只取同一次 CI 渲染」处理，禁止 `--update-baseline`。

## 4. ③「富文本模式补上限」做到哪一步（不假装已闭合）

| 项 | Markdown 模式 | 富文本（Quill）模式 |
| --- | --- | --- |
| 就地显示平台上限 | ✅（分母改为生效上限） | ✅（计数器本就在两支共用） |
| 超限红态 | ✅ | ✅ |
| **硬拦（不让继续输入）** | ✅ `textarea[maxlength]` | ⛔ **未做** |

富文本那一支不能直接套 `maxlength`：Quill 是 contenteditable，且 `v-model:content` 承载的是 **HTML**——按码点截断 HTML 会把标签切半（`<strong>abc` → 结构破坏，正是 AGENTS「图文正文承载形态合同」禁止的形态）。正解是挂 Quill 实例的 `text-change`，在**纯文本长度**超预算时用 `deleteText(max, len-max)` 删掉尾部字符（保留结构）。这条需要真 Quill 宿主与一组 HTML 安全性的负控，属独立成本，已建任务而非在本批用「红字提示」冒充「已补上限」。

## 5. 验收标准（本批读数）

| 项 | 读数 |
| --- | --- |
| 先写锁、未实现 | 9 failed（其中 5 条直接复现改前的垃圾分母） |
| 实现后 | `14 passed (14)`，且 `ArticleEditor.test.js`/`ArticleEditor.quill-load.test.js`/`Publish.title-counter.test.js`/`Publish.test.js` 复跑全绿 |
| 变异正控 | `rc=0 红集=(空) Tests=14 passed (14)` |
| M1 分母回到 `maxChars`（textarea） | CAUGHT :: Markdown maxlength |
| M2 归一化改成 `Number(n)`（不校验正数） | CAUGHT **7 failed**（5 档非法值 + 0/-5 等全部回来） |
| M3 摘掉 Publish 的 `:max-chars` 绑定 | CAUGHT :: 结构合同 |
| M4 摘掉 `?? APP_ARTICLE_CONTENT_MAX` 兜底 | CAUGHT :: 结构合同 |
| 还原 | 四刀均 `byte-identical` |
| 行数熔断 | ✅ 无新增超大文件；`Publish.vue` 净增 0 行 |

结构锁判据在 `<ArticleEditor>` 的**开标签属性段内**取 `:max-chars`（前向找 `>` 跳过引号内的 `>`），并断言导入项来自 `publish-contract` 的具名导入——不写「文件里出现过 minContentBudget」这种字符串判据。
