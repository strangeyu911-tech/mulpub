# 本次执行记录：编辑器字数上限按所选平台就地生效（ux-audit-platform-content-limit，2026-10-26）【混合 PR】

- 分支：`ux-audit-platform-content-limit`（worktree：`<仓库父目录>/mp-worktrees/mp-ux-audit-platform-content-limit`，非 C 盘）
- 基线核对：建树后 `git rev-parse HEAD` == `origin/main`（`4a6a6eafd`）当场相等才开工
- 判定：docs-only=false（改了 `apps/desktop/src/**`）
- 审计来源：4.7 的 ②③；① 已随 #4424 合并（`01-docs/PRD-CODEPOINT-LENGTH-2026-10-25.md`）
- 产品契约：`01-docs/PRD-PLATFORM-CONTENT-LIMIT-DISPLAY-2026-10-26.md`

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：隔离 ✅ | TDD 先红后绿 ✅ | 变异反证 ✅ | lint ✅ | 行数熔断 ✅（Publish.vue 净增 0 行）| 品牌残留 ✅ | locale ✅（本批未新增键）| 记录门禁 ✅ | QM-6 ⛔ pending | 远程同步 PR #4498

## 一、QM-5 ① 第一性原因

`Publish.vue` 的 `<ArticleEditor>` 从不传 `max-chars` ⇒ prop 取应用级默认 `APP_ARTICLE_CONTENT_MAX`。而**真正约束用户的是注册表里所选平台的 `contentMax`**（快手 480 / 头条 100000 …），派生入口 `minContentBudget(platforms, title)` 早就存在并已被发布校验使用。于是界面显示与发布校验用的是两个数：显示说「还差得远」，校验说「超了」——用户只能靠试错发现真实上限。

顺带查出一个**独立的既有显示缺陷**：`ArticleEditor` 对 `maxChars` 无任何归一，红测当场复现五档垃圾分母（`null → "7/ 字"`、`0 → "7/0 字"`、`-5 → "7/-5 字"`、`"abc" → "7/abc 字"`、`NaN → "7/NaN 字"`）。这条在本批接线后必然被触发（`minContentBudget` 未选平台时返回 `null`），所以归一化不是可选加固，而是接线的前提。

## 二、QM-5 ② 逃逸分析

- **单测层**：`ArticleEditor.test.js` / `Publish.title-counter.test.js` 都只断言**标题**计数与既有默认分母，没有任何用例断「编辑器分母 == 所选平台预算」；对非法 `maxChars` 完全无覆盖 ⇒ 垃圾分母不可见。
- **像素层**：`/publish` 编辑器计数文案在同一行内变化，6% 全页阈值对它失明。
- **审查层**：审计把 4.7 记成「统一单位」（已被 w10 否证）后改记为「②显示 ③补上限」，但没有把「②是**接线**问题（真源已有）还是**新建表**问题」写清；实测是真源已有、调用点漏接。

## 三、QM-5 ③ 系统性漏洞

一个已有单一真源的约束，只在**校验路径**被消费、没在**展示路径**被消费，而仓内没有任何东西问「展示用的上限是不是同一个表达式算出来的」。这类「同决策两处实现、只有一处被接」正是本仓记过的「装饰性链路 / 注册≠注入≠生效」同族。

## 四、QM-5 ④ 修复与回归保护

- `ArticleEditor.vue`：新增 `effectiveMaxChars`（有限正数才生效，否则回落默认），三处消费点（分母、红态判据、`textarea :maxlength`）全部改用它。
- `Publish.vue`：绑 `:max-chars="minContentBudget(selectedPlatforms, article.title) ?? APP_ARTICLE_CONTENT_MAX"`；具名导入并回上一行 ⇒ 该文件 `git diff --numstat` = **2/2，净增 0**（它是指名还账、零增长容差）。
- 锁：`components/ArticleEditor.max-chars.test.js`（14 条）——A 组行为锁（真挂载：显式上限生效 / 不是默认值 / 5 档非法值回落 / 红态随预算移动 / Markdown maxlength 同步），B 组结构合同（在 `<ArticleEditor>` 开标签属性段内取 `:max-chars`、断言取自 `minContentBudget` 且有兜底、断言两个具名项来自 `publish-contract` 的具名导入）。
  - 夹具自证两处：`editorMode` 是组件内部 ref 不是 prop ⇒ 必须点 `.mode-btn` 切 Markdown，传 prop 会让用例在没有 textarea 处等错东西；取段函数取不到开标签即抛，不得读成合规。

## 五、读数（当场实跑）

先红 `9 failed`（其中 5 条直接复现改前垃圾分母）→ 实现后 `14 passed`；邻居复跑 `ArticleEditor.test.js` + `ArticleEditor.quill-load.test.js` + `Publish.title-counter.test.js` + `Publish.test.js` 全绿；`check-max-lines` ✅ 无新增超大文件。变异：正控 `rc=0 / 14 passed`；M1（textarea 分母退回 `maxChars`）CAUGHT；M2（归一化退成 `Number(n)`）**CAUGHT 7 failed**；M3（摘掉 Publish 绑定）CAUGHT；M4（摘掉 `??` 兜底）CAUGHT；四刀还原均 `byte-identical`。

## 六、QM-6

外部评审引擎在本机缺失（`ccg-gate.js:294` 找不到引擎返回 rc=0，任务 #44），无真外部产物 ⇒ `deepReview.status` 保持 pending，**不自行动合并**。

## 七、③「富文本模式补上限」未完成的部分（不冒充已闭合）

显示与红态已在两支生效；**输入硬拦只有 Markdown 模式**（`textarea[maxlength]`）。Quill 那一支的 `content` 是 HTML，按码点截断会把标签切半（正是 AGENTS「图文正文承载形态合同」禁止的形态），正解是挂 Quill 实例 `text-change`、按**纯文本长度**用 `deleteText(max, len-max)` 删尾部并配 HTML 结构安全性的负控。已另建任务，本批未做，也没有把「红字提示」说成「已补上限」。

## 八、CHANGELOG 条目

# 编辑器字数上限改为按所选平台就地显示，并修掉非正上限渲染出的垃圾分母（审计 4.7 ②③）

发布页的正文编辑器过去从不接收平台预算，显示的一直是应用级通用上限：勾了快手（单平台正文预算 480）的人会在编辑器里看到「还差得远」，一路写到发布校验才被拦，界面与校验各说一套。真正的约束值其实早就有单一真源（平台能力注册表的 `contentMax`，并经 `minContentBudget(所选平台, 标题)` 取最紧的一个、扣掉「无标题平台把标题折进描述」的开销），只是没有接到展示路径上——本批把它接进 `ArticleEditor` 的 `max-chars`，于是计数分母、超限红态阈值、Markdown 输入框的 `maxlength` 三处同时改为跟随所选平台。接线过程中实测到 `ArticleEditor` 对 `maxChars` 毫无归一：`null` 渲染成「7/ 字」、`0` 成「7/0 字」、`-5` 成「7/-5 字」、`"abc"`/`NaN` 原样上屏，而 `minContentBudget()` 在未选平台时正返回 `null`，所以组件侧的「有限正数才生效，否则回落默认值」不是可选加固而是接线前提；新增 14 条锁（真挂载的行为锁覆盖显式上限、非法值回落、红态随预算移动、Markdown maxlength 同步，另加结构合同，在 `<ArticleEditor>` 开标签属性段内解析绑定并断言取值来自单一真源且有兜底），4 刀变异逐条 CAUGHT、正控 14 passed，`Publish.vue` 是指名零增长还账文件因此绑定与导入都并回原行、净增 0 行。富文本（Quill）模式的输入硬拦本批**未做**并在 PRD 里写明原因：它的 `content` 是 HTML，按码点截断会把标签切半，正解是挂 Quill 的 `text-change` 按纯文本长度删尾部字符并配结构安全负控，另案处理。

## 五、视觉门禁 17/19 px 的处置（2026-10-27 追加；CI 同源重锚，未提阈值）

CI 现场（job `121511965429`）只报暗色档 `❌ publish-form-dark.png 17 px (0.001%)`，且 Gate 7b 重采轮三套件全 0 之后**再次打印**同一条
⇒ 交集判据把它留在「真回归」侧，不是 flake。对本 PR 自己的产物跑仓库既有判据 `scripts/check-baseline-freshness.js`，
额外报出 `❌ publish-form.png 19 px (0.001%) 来源=views`——**浅色档这条 CI 从来没看过一眼**，与已登记欠账「Gate 7b round2 不重采浅色像素套」同源，
本轮它第一次被复现（不是推测）。两张 publish-form 在 `screenshots/` 与 `screenshots-round1/` 之间 md5 一致 ⇒ 渲染确定性没问题，漂移来自内容：
本 PR 让发布表单的字数上限按所选平台就地生效，上限数字与提示文字宽度变化在浅/暗两档各留下十几像素，属预期后果。

处置（QM-4 第 7 条「基线只能取自同一次 CI 渲染」）：从本 PR 的 `quality-gate-visual-reports`（artifact id `12642970662`）重锚**两张**，
注意两套文件名不同——视图套件产 `<name>.png`、像素门禁产 `<name>-current.png`：

- `base-screenshots/publish-form-dark.png` ← `screenshots/publish-form-dark-current.png`
- `base-screenshots/publish-form.png` ← `screenshots/publish-form.png`（**不带** `-current`）

自证：写完逐张回读核 sha256（两张均「字节相同=true」），再跑 `node scripts/check-baseline-freshness.js --renders=<同一 run 的 screenshots>`，
判据是「不再点名任何 publish-form」；其余 `UNCOVERED_BASELINE` 是本机只解包了部分套件所致，不作通过判据、也不得据此说门禁整体已过。
未使用 `--update-baseline`、未使用本机截图、未提阈值、未加忽略区。

另一格如实记录：本轮第一次尝试时报「写完回读逐字节不同」，**根因是我的写法错误**——`writeFileSync(目标, 源路径字符串)` 把路径本身当内容写进了基线文件
（正确姿势是 `writeFileSync(目标, readFileSync(源))`）。用一张探针文件在真实落盘路径复现后确认读写逐字节相同（sha 一致、`equal=true`），
即写入没有被任何守卫改写。归因完成后才推这张图，不在未归因前推送可疑基线。

## 六、基线重锚的第二轮（re-sync 到主干之后，取本 PR 自己的新 CI 渲染）

rebase 到 origin/main 后（保留主干更晚的 `publish-form*.png`，不反向撤销视觉系统升级那两条提交），CI 对新提交重跑视觉门禁：

```
run=40458385853  job=122037931161
06:07:17  ❌ publish-form-dark.png 17 px (0.001%) 来源=pixel-gate
06:07:17  ❌ publish-form.png     19 px (0.001%) 来源=views
06:08:37  [GATE-7B] round2 suite exits: views=0 views-supplement=0 dark=0
06:08:41  ❌ 同上两张再次打印  ⇒ ❌ 2 张视图两轮都红（确定性漂移，不因重试放行）
```

两条更正与一条归属：

1. **修正我先前说过头的一句**：浅色档并非"CI 从不看"。本 run 里 `publish-form.png`（`来源=views`）在 round2 被重新采集并点名，
   所以 views 套的两轮甄别**覆盖浅色**；真正的缺口只收窄到 `pixel-gate` 那一档的浅色重采。旧表述以本篇与 PR 评论为准更正，
   不要再引用"20 张基线只有单轮证据"的全称说法。
2. **漂移成因归属本 PR**：本批让发布表单的字数上限按所选平台就地生效，上限数字与提示文字宽度变化 ⇒ 浅/暗两档各十几像素，
   是预期后果而非画质劣化。两轮复现且数值一致 ⇒ 不是 flake，也不得靠提阈值/忽略区消化（QM-4 明令）。
3. **同源口径**：两张都取自**本 PR 本次 run** 的 `quality-gate-visual-reports`（artifact id `12713876546`）内的渲染，
   且按判据自述区分两套文件名 —— 视图套件是 `<name>.png`、像素门禁是 `<name>-current.png`：
   `publish-form.png ← screenshots/publish-form.png`、`publish-form-dark.png ← screenshots/publish-form-dark-current.png`。
   写完逐张回读核 sha256（两张均相同），未使用本机截图、未使用 `--update-baseline`。

取物过程中两条本机坑值得记：`tar -xf D:/tmp/...` 会被 GNU tar 当成 `host:path` 远程语法（`Cannot connect to D:`），
须改用 `unzip` 或 POSIX 路径 `/d/tmp/...`。
