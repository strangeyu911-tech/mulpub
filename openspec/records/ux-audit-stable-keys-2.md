# 本次执行记录：列表稳定键第二批（ux-audit-stable-keys-2，2026-10-26）【混合 PR】

- 分支：`ux-audit-stable-keys-2`（worktree：`<仓库父目录>/mp-worktrees/mp-ux-audit-stable-keys-2`，非 C 盘，基线为当时 `origin/main`）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（改了 `apps/desktop/src/**`）
- 审计来源：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 4 · 4.8；产品契约：`01-docs/PRD-LIST-STABLE-KEYS-2026-10-26.md`

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：变更类型与隔离 ✅ | TDD 先红后绿 ✅ | 变异反证 ✅（当场实跑）| 行尾/编码对账 ✅ | 品牌残留 ✅（本地实跑）| locale CJK + key ✅（本地实跑）| 行数熔断 ✅（本地实跑）| QM-6 ⛔ 未闭合（见 §六）| 远程同步 PR #4493

## 一、QM-5 ① 第一性原因

`:key` 在 Vue 里决定「节点 ↔ 条目」的对应关系。这批站点把该对应关系交给了**位置**（`i` / `idx` / `si` / `'ann-' + i` / `it.url + idx`）。位置一旦变化（删中间项、轮询整体替换、头部裁剪导致全体下标位移、日历网格 35↔42 格变化），原属于 A 项的 DOM 节点就被拿去渲染 B 项；凡是**模型不拥有**的状态（焦点、光标、输入框撤销栈、IME 合成半截拼音、被脚本直接写的 `style`、子组件局部态、`<TransitionGroup>` 动画起点）都跟着位置走。

引入点不是一次提交，而是「用下标当键」这一写法在多个视图各自成文；公告横幅那处尤其特殊——它同文件已有一个**持久化的「已忽略」Set，键口径是 `dismissKey(a)`**，等于同一份数据里同时存在身份口径和位置口径两套。

## 二、QM-5 ② 逃逸分析

- **单测层**：没有任何用例断言「删除/重排后，渲染某项的还是同一个 DOM 节点」。既有组件测试断言的是文本与模型值——那些在下标键下**照样正确**，因此结构性免疫。
- **像素层**：全页 6% 阈值对「键表达式」零信息量（键不进 DOM），完全失明。
- **审查层**：审计把 4.8 记成「38 处计数任务」，按计数做完就算完；真缺陷（会局部变化的列表）与中性写法（静态骨架屏）混在一个计数里。首批已确立「启发式只用于缩小候选集，定罪必须逐个读现场」，本批把它具体化为第二条硬判据（见 §三）。

## 三、判归规则（本批最重要的自限）

1. **只有会局部变化的列表才是缺陷**：静态骨架屏（`v-for="i in 6" :key="i"`、`UiSkeleton.vue` 三处）与「`v-if` 守卫下一次性整体赋值 + 纯文本项」不改 —— 两类键渲染等价，改动只增加像素回归面。
2. **身份字段必须可证存在**：判据取「该字段已被同一模板消费，或在生产端被显式写入」。这一条当场排掉三族看起来能改的站点，它们需要的是 `uid`（数据形状变更，另案）：
   - `CreateHistory.vue` 的 `renders`/`pipelines`：逐行读过，模板读的是 `outputPath/composition/name/status/completedAt/startedAt/createdAt/stages/pausedStage`，**从未读 `id`**；
   - `QuickRenderMaterials.vue` 四族素材与 `FilmAutoPanel.vue` 的 `r.path + i`/`p + i`：元素无 id 且入列**无去重**，用值拼键可撞；
   - `CreateView.vue` 的 `s2vBatchTexts`：元素是裸字符串、合法值可为空串，全 `''` 立刻撞键。
3. **允许 `稳定值 || 下标` 的兜底位，禁止 `下标 || 稳定值`**：后者下标仍在主键位，等于没改。该区分由锁持有并被 G1/G2 绿控钉住「不过度收紧」。

## 四、QM-5 ④ 实现（9 处，净增行 0）

| 文件 | 原键 → 新键 | 可证出处 | 局部变化形态 |
| --- | --- | --- | --- |
| `components/AnnouncementBanner.vue` | `'ann-' + i` → `dismissKey(a)` | 同文件持久化 Set 的键口径 | 关闭中间条后其余项位移 |
| `components/BoardStageIndicator.vue` | `i` → `stage.name \|\| stage` | 同模板 `friendlyName(stage.name \|\| stage)` | backlot IPC 推送整体替换 |
| `components/SceneCard.vue` | `i` → `take.id \|\| take.thumbnail \|\| take.url \|\| take` | `ContactSheetView.vue:54` 对同一 `scene.takes` 用 `take.id` | `takes.slice(0,3)` 随推送替换 |
| `views/AutoPipelineView.vue` | `i` → `u`（URL 芯片） | 入列前 `includes` 去重 | `removeUrl(i)` → `splice` |
| `views/AutoPipelineView.vue` | `i` → `stage.id`（阶段卡） | `full-auto-pipeline.js:199` `STAGES.map((id) => ({ id, … }))` | 1.5s 轮询整替 |
| `views/Calendar.vue` | `i` → `day.dateStr` | computed 写入 `dateStr`，选中态本就比它 | 翻页时网格 35↔42 |
| `views/PromptEvalView.vue` | `i` → `img.url` | 入列 `URL.createObjectURL(file)` | `removeImage(index)` → `splice` |
| `features/collection/BatchCollectPanel.vue` | `it.url + idx` → `it.url` | 勾选态 Set 就按 `it.url` 存 | 筛选/重载整替 |
| `views/FilmEngineeringView.vue` | `si` → `sh.shotId \|\| si` | 同文件 `:108` 已用 `s.shotId`；本行 `:395` 就在显示它（且可空 ⇒ 留兜底） | 批量出片逐条改状态 |

`git diff --stat` = **8 files changed, 9 insertions(+), 9 deletions(-)**。

## 五、读数（当场实跑，同一棵树上先红后绿）

| 步骤 | 读数 |
| --- | --- |
| 先写锁、未实现 | `11 failed`：9 条结构合同逐个点名站点 + 2 条行为锁（干净基线上复现，不是沿用另一棵树的读数） |
| 实现后 | `12 passed (12)` |
| 消费者并集（按读者 `git grep -l` 反查得 16 文件，含本锁） | `16 passed (16)`，用例数 248 |
| 变异驱动**正控**（不变异） | `rc=0 红集=(空) /Tests=12 passed (12)` |
| M1 `dismissKey(a)`→`'ann-' + i` | CAUGHT `1 failed` :: AnnouncementBanner |
| M2 `stage.name \|\| stage`→`i` | CAUGHT `3 failed` :: 结构合同 **+ 两条行为锁一起红**（证明行为锁确有判别力，不是搭便车） |
| M3 `sh.shotId \|\| si`→`si` | CAUGHT `1 failed` :: `in b.shots` |
| M4 `it.url`→`idx \|\| it.url`（下标挪到主键位） | CAUGHT `1 failed` :: `in zhihuFavItems` |
| M5 `take.id \|\| …`→`i` | CAUGHT `1 failed` :: `in displayedTakes` |
| G1/G2 绿控（`it.url \|\| idx`、`img.url \|\| i`） | 两条放行 |
| 每刀还原 | 全部 `byte-identical`；结束时 `git diff --stat` 仍为 9 增 9 删 |

本地文档门禁：`check-max-lines` ✅ 无新增超大文件（挂账 95/95，点名还账 20）；`check-no-brand-residue` ✅（13056 文件）；`check-locale-sync --cjk --keys` ✅（CJK 基线 1330 / 当前 1088，2361 key 双语齐备）；行尾两口径（`--numstat` vs `--ignore-cr-at-eol --numstat`）逐文件相等。

## 六、QM-6：不自行闭合（如实记）

按 `scripts/ccg-review-decider.js` 口径，本批变更源码行数（9 行实现 + 152 行测试）达 DUAL 规模。外部评审引擎（`run_skill.js` / `adversarial-review-loop` 的 `ccg-deep-review.js`）在本机两个技能根均缺失，`scripts/ccg-gate.js:294` 在找不到引擎时**返回 rc=0**（已登记为任务 #44 的上游失明）。因此没有真外部产物，`deepReview.status` **保持 pending**，不手写状态词、不改写任何评审产物。按 AGENTS.md「PR 自动合并」判据第 5 条，本 PR 全绿也**不自行动合并**，等人工一句话处置。

## 七、我自己的两处错（如实登记，都会复发）

1. **在未合并的他人分支上开了工**。同名 worktree `mp-ux-audit-stable-keys` 的 HEAD 其实是 2026-10-20 首批那条**从未合并**的分支（含 `useBatchCreate` 行身份、`ReferenceFinder._rid`），`start-mp-task.ps1` 复用了它。后果三连：① 我的 diff 会捎进别人未评审的实现；② 我把首批那份 `openspec/records/ux-audit-stable-keys.md` **整篇覆盖**（`git diff --cached` 显示 69 增 / **38 删**才暴露）；③ 我以为「上游已改好」的几处（`ReferenceFinder`）其实只是那条分支改的，主干仍是下标键。处置：精确路径 `git restore --staged --worktree` 退回该树（退回后记录文件恢复为原 50 行），另起 `ux-audit-stable-keys-2` 从 `origin/main` 干净重做，并把红/绿/变异全部在新树重取一遍（不沿用旧树读数）。
2. **`git restore --worktree` 会顺手删掉我新写并已 `git add` 的文件**（它们在 index 里但不在 HEAD 里），本批那份测试与 PRD 就是这样被删掉后重写的。口径：退回他人内容时，先把自己的新文件移出该目录，或只点名跟踪中的文件。

另有两条探针自错（写进 PRD §7，此处只列结论）：变异驱动第一版用 `execFileSync` 直调 `.cmd`，Windows 下 spawn `.cmd` 需 `shell:true`，否则 `e.status=null`，于是把「测试根本没起来」读成「五刀全 CAUGHT、绿控也放行」——**整批读数作废**，正解是 `spawnSync(process.execPath, [vitest.mjs, …])` + 跑变异前先做一次不变异正控；自写的宽判据全仓重测给出 0 处，而同判据在 `UiSkeleton.vue` 单文件命中 3 处 ⇒ 探针已自证为坏，0 读数不采信。

## 八、遗留（不假装已闭合）

1. `loading="lazy"` 那一半未做（任务 #22）：懒加载会让折叠区外的图在同一次 CI 渲染里不出现，须先取证采集器是否滚动全页，并与基线刷新同 PR。
2. §三 排除的三族需要 `uid`（数据形状变更），另案。
3. 全仓 `index-key` 棘轮未建：按「新门禁上线三步序」需人工批准基线快照。
4. `FilmAutoPanel.vue:251` 的 `p + i` 本批未动（无去重，见 §三）。

## 九、CHANGELOG 条目

# 列表稳定键第二批：9 处 `:key` 改身份键，删行/刷新后焦点与输入态不再跟错行（审计 4.8）

删掉列表中间一行后「我正在敲的那一行」光标或半截拼音跑到别的行上、日志每刷新一次行内状态就串一行——根因是 Vue 的 `:key` 用了循环下标：键的含义是**位置**而不是**身份**，于是节点上凡是模型不拥有的状态（焦点、光标、撤销栈、IME 合成、被脚本直接改的样式、子组件局部态、`<TransitionGroup>` 动画起点）都跟着位置走。本批从主干干净基线收口 9 处，且只收「身份字段可证存在（同一模板已在读，或在数据生产端显式写入）∧ 列表会局部变化」的站点：公告横幅改用与持久化「已忽略」集合同一口径的 `dismissKey(a)`、看板阶段与自动流水线阶段卡改用名称与 `stage.id`、镜头卡片与批次内镜头行改用 `take.id`/`shotId`、日历格改用 `dateStr`、评测缩略图改用 blob `url`、知乎收藏行改用其勾选态本就按它存储的 `it.url`。允许「稳定值 || 下标」的兜底位、禁止「下标 || 稳定值」。新增 `apps/desktop/src/list-stable-keys.test.js`：10 条结构合同（在开标签属性段内解析 `:key`，前向找 `>` 时跳过引号内的 `>`，不做字符串判据）+ 2 条真挂载行为锁（断言 DOM 节点对象身份跟随项身份）；5 刀变异逐条 CAUGHT、2 条绿控放行、不变异正控 12 passed，净增代码行 0。三族「看起来能改但字段无法证明存在」的站点（创作历史两张列表、快速渲染四族素材、批量文案行）需要给数据行补 `uid`，属数据形状变更另案；全仓 `index-key` 棘轮按「新门禁上线三步序」需人工批准，本批不建。另记一条：审计行 4.8 在主干上此前**没有任何已合并的收口注记**——2026-10-20 那条分支的注记随未合并的 PR 一起留在分支上，主干那行仍是原文。

## 九、CI 第一轮被打回：Gate 11 ESLint（2026-10-26 当场修）

`QG Static` 红在 **Gate 11 - ESLint (error-level gate)**，不是新写的锁、也不是像素门禁。根因是我这次改动的**副产品**：把 `:key` 从下标换成身份字段后，模板里那个下标绑定**失去了最后一个读者**，于是 `vue/no-unused-vars` 按 error 级打回三处——

| 文件 | 原声明 | 改后 |
| --- | --- | --- |
| `components/AnnouncementBanner.vue:4` | `v-for="(a, i) in visibleAnnouncements"` | `v-for="a in visibleAnnouncements"` |
| `views/Calendar.vue:24` | `v-for="(day, i) in calendarDays"` | `v-for="day in calendarDays"` |
| `features/collection/BatchCollectPanel.vue:152` | `v-for="(it, idx) in zhihuFavItems"` | `v-for="it in zhihuFavItems"` |

删之前逐处数过该下标在模板段内的其余读者：三处计数都是 **1**（只剩声明本身），所以丢弃绑定是安全的，而不是把报错消音。反例是同批的 `BoardStageIndicator.vue` 与 `FilmEngineeringView.vue`——那里的 `i` / `si` 仍承载真实位置语义（`@click="$emit('select', i)"`、`i < stages.length - 1`、`data-testid=...-+ si`），**不能**删，lint 也没报它们。

修后本机复跑：`eslint` 对这三文件 **0 error**（只剩 3 条与本次无关的既有 warning）；`list-stable-keys.test.js` + `Calendar.test.js` + `batch-collect-panel-behavior.test.js` + `AutoPipelineView.test.js` + `SceneCard.test.js` = **5 files passed**。

**这条进验收口径**：改 `:key` 的验证域必须包含 lint，因为「键不再用下标」与「下标还有别的用途」是两件事，而只有 lint 会把它报成 error。本批 §五 的验收标准里没有写它，是我漏的——锁全绿与本地文档门禁全绿都没能预告这条红。
