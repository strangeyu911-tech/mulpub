# 本次执行记录：ViralFormDialog label 关联 + 必填项 aria-required（ux-audit-label-viral-form，2026-10-26）【混合 PR】

- 分支：`ux-audit-label-viral-form`（worktree：`<仓库父目录>/mp-worktrees/mp-ux-audit-label-viral-form`，非 C 盘）
- 基线核对：建树后 `git rev-parse HEAD` == `origin/main`（`de5592004`）才开工
- 审计来源：阶段 4 · 4.3 收编第二批（第一批 = PR #4500 的 `AiWriterPanel.vue`）

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：隔离 ✅ | 先红后绿 ✅ | 清单锁 + 负控 ✅ | lint ✅ 0 error | 行数熔断 ✅（该文件 22/22 净增 0 行）| locale `--cjk --keys` ✅ | 品牌残留 ✅ | 绝对路径 ✅ | 记录债务 ✅ | QM-6 ⛔ pending

## 一、缺陷

`ViralFormDialog.vue`（知识库条目录入弹窗）11 个 `<label class="cohere-form-label">` 全部是孤岛 label：无 `for`、不包裹控件 ⇒ 读屏走到输入框只念「编辑框，无名称」，点标签不聚焦。另有一条独立缺陷：正文项带视觉 `*`（`<span style="color:var(--danger...)*"</span>`）却**没有 `aria-required`** ⇒ 必填这件事只以颜色传达，读屏与键盘用户不知道哪个字段必填（审计 4.3 明列「aria-required 补齐」）。

## 二、实现

11 对：控件 `id="vfd-<字段>"` + 标签 `for="vfd-<字段>"`；正文 textarea 另加 `aria-required="true"`。id 全部由**脚本按控件的 `v-model` 目标自动派生**（不是手抄），语义名、不用随机值。`git diff --numstat` = 22/20 类改写后仍**净增 0 行**。

字段：`vfd-title / vfd-url / vfd-content / vfd-author / vfd-platform / vfd-tagstext / vfd-cover-url / vfd-published-at / vfd-likes / vfd-collections / vfd-comments`。

## 三、锁（`ViralFormDialog.label-association.test.js`）

- **挂载负控**：`mount(visible:true)` 后，凡渲染出的 `label[for]` 都必须解析到**存在且 labelable** 的元素，且 `control.labels` 反查命中该 label。本弹窗**能渲染出来**（与 `AiWriterPanel` 不同，那批只能靠静态清单兜覆盖面）。
- **清单锁**：11 个 id 逐个存在 + `for` 集合与清单**不多不少**（新增孤岛或漏接线当场红）。
- **必填锁**：从源码找出所有「带 `*` 的 label + 紧随其后的控件」，要求该控件带 `aria-required="true"`，并断言这类标签**数量 ≥ 1**（防判据面变空而恒真）。
- **零孤岛锁** + `scanned ≥ 11` 下界。
- **id 唯一 / 不与 `data-testid` 撞名**（撞名会让 `getElementById` 与 `for` 指错对象）。

## 四、读数

先红（把文件临时退回改前 blob 再跑，同一棵树）：`3 failed`（清单、必填、零孤岛）。
恢复改动后：`Test Files 1 passed`。eslint 0 error。`check-max-lines` ✅ 无新增超大文件。`.github/scripts/check-locale-sync.js --cjk --keys` ✅（CJK 基线 1330 / 当前 1088、2363 key 双语齐备）。abs-paths ✅ / brand ✅ / record-debt ✅。行尾两口径一致（238/20 与剥 CR 同值）。

## 五、⛔ 我自己的脚本造成了一次功能回归——被这条锁当场抓住（本记录最重要的一条）

自动接线脚本里给必填项插 `aria-required` 的那条替换是：

```js
next.replace(new RegExp(`<(input|textarea|select)\\b[^>]*?\\s(class=)`), `<$1 aria-required="true" $2`)
```

替换串只回填了 `$1`（标签名）和 `$2`（`class=`），**中间那段 `[^>]*?` 被整段丢弃** ⇒ 正文那一行变成 `<textarea aria-required="true" class=...>`，**`id` 和 `v-model="form.content"` 一起没了**。这是会让用户输入的正文完全不进表单的**功能性缺陷**，不是样式问题。

发现方式不是我读代码看出来的，而是挂载负控报的：`label for="vfd-content" 指向不存在的元素`。也就是说——**「渲染出来的 for 必须解析到真实控件」这一条负控，同时是接线的正确性探针**。

两条口径入库：
1. 脚本化批量改属性时，替换式**禁止用 `[^>]*?` 这类通配吃掉中间内容再只回填两端**；要么只匹配要插入位置的最小锚点（例如锚定 `<textarea` 之后紧邻处），要么匹配后**原样回写 `$&`** 并只在末尾追加属性。
2. 任何"批量加属性"的改动，必须有一条**能证明属性所在元素仍完整**的锁（这里是 `for` 解析 + `v-model` 所在控件的 `.labels` 反查），只测「属性字符串出现了」完全抓不到中间被删的东西。

另有两处小错：`.filter(Array.isArray)` 混形态列表那次已记在 #4500；本批复用同一脚本时正则只认 `v-model:` 冒号修饰符，漏了 `v-model.number` 点号形态 ⇒ 3 处被静默跳过，靠脚本自己打印的「未接线（逐条说明）」清单暴露。

## 六、QM-6

外部评审引擎在本机两个技能根缺失（`ccg-gate.js:294` 找不到引擎返回 rc=0，任务 #44）⇒ 无真外部产物，`deepReview.status` 保持 `pending`，**本 PR 全绿也不自行动合并**。

## 七、遗留

1. 孤岛 label 总数 **125 → 114（本批 11 处）**〔该两处为算术值，口径更正见本记录顶部与 PR #4520 记录 §七〕。
2. `PublishFrequencySettings.vue`（10 处）控件是 `el-input-number`：按本仓实测 Element Plus 会**丢弃 `id`**（`element-plus-attr-forwarding.test.js` 已钉住转发面），必须走「label 给 id + 控件 `aria-labelledby`」通道，且要**先实测该组件的转发落点**再动手 —— 另片。
3. `S2vConfigPanels.vue`（19 处）混合三类（标签后是 button 的、radio 包裹式的、`UiField` 已有机制的），需逐个判归，不能一把套 `for`。
4. PR #4011 的 `check-label-association.js` 棘轮仍未进主干；它合并时基线**必须从合并后主干重取**（本批又少 11 处）。

- 计数口径更正（2026-10-27，指向 PR #4520 记录 §七）：本文里的「125 → 114」是用旧探针读 `origin/main` blob 算出来的算术值（扫描域只有 187 个文件，且 3 个文件读不到时被静默跳过），不是对工作树的测量。同树两 ref 的真读数是 `HEAD=148 → 工作树=137`（域 199 个 .vue、读不到=0）。本批接线的 11 对、以及那条被挂载负控抓出的自我破坏，都不受这条更正影响。

## CHANGELOG 条目

# 知识库录入弹窗的字段标签接上控件，必填项补上可访问状态（审计 4.3 第二批）

`ViralFormDialog.vue` 的 11 个字段标签过去全是孤岛——没有 `for`、也不包裹控件，读屏走到输入框只听得到「编辑框，无名称」，点标签也不聚焦；同时正文一项的"必填"只画了一个红色星号，没有 `aria-required`，等于把必填信息只交给颜色。本批给 11 对标签与控件建立真实关联（控件 `id="vfd-*"`、标签 `for`，id 由脚本按控件 `v-model` 目标自动派生而非手抄，全部语义名、不用随机值），并给带星号的正文项补上 `aria-required="true"`。锁有五条：挂载负控（渲染出的每个 `for` 都必须解析到真实存在的 labelable 控件且 `.labels` 反查命中）、清单锁（11 个 id 与 `for` 集合必须不多不少）、必填锁（有 `*` 的标签其控件必须带 `aria-required`，并断言这类标签数量 ≥1 防判据面变空）、零孤岛锁（含扫描规模下界）、id 唯一且不与 `data-testid` 撞名。读数：把文件退回改前在同棵树上跑先得 `3 failed`，改后全绿；该文件净增 0 行；eslint 0 error；行数熔断、locale 双语、品牌残留、绝对路径、记录债务各门禁通过。**必须记住的是这条锁顺手抓住的一次自我破坏**：自动接线脚本里给必填项插属性的替换式用 `[^>]*?` 吃掉了中间内容又只回填两端，把正文那一行的 `id` 和 `v-model="form.content"` 一起删掉了——那是会让用户输入的正文完全不进表单的功能缺陷，而报出来的正是「`for="vfd-content"` 指向不存在的元素」这句负控。因此口径是：批量加属性禁止用通配吃中间内容（要么锚定最小插入点，要么匹配后原样回写再追加），且任何"批量加属性"的改动都必须有一条能证明该元素仍完整的锁，只断言"属性字符串出现了"抓不到中间被删的东西。剩余 114 处孤岛 label 分片继续，其中 `PublishFrequencySettings.vue` 的 10 处控件是 `el-input-number`——按本仓实测 EP 会丢弃 `id`，须走 `aria-labelledby` 通道并先实测转发落点，另片处理。
