# PRD：表单标签关联合同（label association contract）

- 版本：v1（2026-10-27）
- 归属：UX 审计 `01-docs/UX-AUDIT-2026-10-17.md` 阶段 4 · 4.3「孤岛 label」
- 已交付实现：PR #4500（`AiWriterPanel.vue`）、PR #4501（`ViralFormDialog.vue`）、PR #4520（`ModelProviders.vue`）、PR #4522（EP 转发面实测，本 PRD 的组件资格表来源）
- 状态：**部分实现**。11 处 `el-input`/原生控件的通道已确认可用并已收编三批；`el-switch` / `el-select` / `el-input-number` 三类**无可用通道**，属未决（见 §6）

## 1. 问题与用户可见后果

一个没有 `for`、也不包裹控件的 `<label>` 是**孤岛 label**。它不是样式问题，是规范级失效：HTML 里 `<label for>` 的合法目标只有 labelable 元素（`button/input/meter/output/progress/select/textarea`），指到 `<div>` 不报错、不降级、**就是没有关联**。用户侧三条后果，逐条可指：

1. 读屏/键盘用户走到该输入框时只听到「编辑框，无名称」——填什么全凭位置猜；
2. 点标签不聚焦，鼠标用户失去一整块点击热区（表单标签本来是最自然的点击目标）；
3. 密码类字段没有可访问名 ⇒ 浏览器/密码管理器的自动填充语义与实际字段脱钩。

严重度与页面成色相关而非与控件类型相关：`ModelProviders.vue`（API Key / Base URL / 应用 ID）与 `PublishFrequencySettings.vue`（发布频率数值项）都是"填错就影响真实行为"的表单，这两类的孤岛优先级最高。

## 2. 三条合法通道（本仓只承认这三条）

| 通道 | 形状 | 适用 | 反例（禁止） |
|---|---|---|---|
| A `for` + `id` | `<label for="x">` + 控件 `id="x"` | 目标必须是 labelable 元素本身 | `for` 指到组件根 `<div>`（EP 系控件实测全部丢弃 `id`，见 §3） |
| B 包裹式 | `<label>…<input/>…</label>` | 单个控件 | 包裹一个选项组（组内多个控件时组名会只挂到第一个） |
| C `role="group"` + `aria-labelledby` | 标签给 `id`，分组容器 `aria-labelledby` 指回标签 | **选项组**（一组按钮/单选/复选） | 给组标签写 `for`——那会把整组的名字只挂到组里第一个按钮上，**组名反而丢失** |

**没有 D 条**：给 `el-switch` / `el-select` / `el-input-number` 写 `aria-labelledby` **不构成关联**（§3 实测：属性停在根 `<div>`）。

## 3. 组件资格表（实测，不是推断）

取证手法：`mount(控件, { attrs: { id, "aria-labelledby" } })` 后读**根节点与内层真实控件**的落点，结果写 `os.tmpdir()` 文件留痕（本仓 test-setup 会吞 stdout，靠 `console.log` 的探针会"全绿而什么都没测到"）。锁文件：`apps/desktop/src/element-plus-label-attr-forwarding.test.js`（PR #4522）。EP 版本取本机 `node_modules`，升级后落点变化会逐条变红。

| 控件 | `id` 落点 | `aria-labelledby` 落点 | 通道 A | 通道 C |
|---|---|---|---|---|
| 原生 `input/textarea/select/button` | 原样 | 原样 | ✅ | ✅ |
| `ElInput` | 根与内层**都丢弃** | 内层 `<input>` | ❌ | ✅（唯一被证实走通的 EP 控件） |
| `ElSwitch` | 丢弃 | **只停在根 `<div>`** | ❌ | ❌ |
| `ElSelect` | 丢弃 | **只停在根 `<div>`** | ❌ | ❌ |
| `ElInputNumber` | **未测得** | **未测得** | 未知 | 未知 |

`ElInputNumber` 那一档必须照原样写"未测得"：它在 jsdom 下 `mount` 即抛（EP 自身 `input-number.vue` 的 mounted 钩子对未定义的内部引用调 `setAttribute`），**既不得读成"可用"也不得读成"不可用"**。要取证需在与生产一致的真实浏览器（dev server + CDP）上跑。

判据纪律（本 PRD 最重要的一条）：**宿主属性归属不得由"同为表单控件"外推**。本仓曾把"ElInput 会转发 aria-labelledby"外推成"EP 控件都会"，据此写下两批计划；按上表实测后计划作废。任何"给某组件加关联属性"的方案，动手前先 mount 一次打印三层落点，并把该实测钉成锁。

### 3.1 二次复测（2026-10-27，PR #4529 动手前）：上表成立，但有两处必须补充的现场

在 `PublishFrequencySettings.vue` 收编前，为确认"哪个字段有救"，用**四种写法**当场复测 `ElInput`（EP 2.14.2，探针用例跑完即删）：

| 复测写法 | 内层 `<input>` 的 `id` | 内层 `aria-labelledby` | 全文件 `querySelectorAll('[id=…]')` 命中 |
|---|---|---|---|
| 模板静态 `<el-input id="x">` | 空串 | `null` | **0** |
| 模板 `<el-input :model-value="v" id="x">`（同页另有 `data-testid`） | 空串 | — | **0**（而 `data-testid` 落在内层 `<input>` 上） |
| `mount(ElInput, { attrs: { id: 'x' } })` | 空串 | `null` | **0** |
| `mount(ElInput, { props: { id: 'x' } })` | 空串 | `null` | **0** |

三条要补进正文的现场：

1. **声明与字节不同源，且这次的反差是陷阱而不是提示**。`element-plus/es/components/input/src/input.mjs` 里 `id` 是**声明过的 prop**，注释原文 `@description native input id`。只看 props 表 / `input.d.ts` 会得出"`for`+`id` 可用"的结论，实测四档全部为空串。**所以资格表的判据只能是 mount 后的 DOM 事实，不能是类型声明**（与 §7「施工切片 SOP」第 1 条同向，此处是把该条打在"声明长得像证据"这一格上的实例）。
2. **`ElInputNumber` 的"未测得"有确切错误串**：jsdom 下 `mount` 抛 `Cannot read properties of undefined (reading 'setAttribute')`。写死这一句是为了让下一次复测能判断"还是同一个障碍"还是"EP 修了、只是探针写法变了"。
3. **`data-testid` 会转发而 `id` 不会** —— 两者都是"看起来一样的字符串属性"，因此**不能**用"`data-testid` 在测试里能查到"来推断"`for` 在生产里能成立"。这类"邻近属性可转发 ⇒ 目标属性也可转发"的推理，就是 §3 判据纪律点名禁止的外推。

## 3.2 测试宿主本身会假造转发（本 PRD 的装饰性门禁补录）

`apps/desktop/test-setup.js` 给**所有**测试装了 Element Plus 全局 stub，其中一条是：

```js
'el-input': { template: '<input class="el-input" />' },
```

它把**任何**属性原样透传到那个原生 `<input>` 上——包括真 `ElInput` 会整条丢弃的 `id`。后果必须逐字读清楚：

> 用这个 stub 做挂载级标签关联断言时，「给 `<el-input>` 写 `for`+`id`」这种在生产里**规范级无效**（§3 实测四档命中 0）的接线，会**照样通过**，而且比真宿主更干净、更快。

这是本仓「装饰性门禁」的一个新落点：**夹具形状对、语义不对**（同型先例见 AGENTS.md「契约夹具不得替对方剥壳」「mock 要对齐语义不只对齐形状」）。两条硬约束：

1. 凡挂载级断言要度量**宿主转发面**（`for` / `aria-labelledby` / `aria-describedby` / `controls` / `owns`），必须显式覆盖全局 stub：`global.stubs = { 'el-input': ElInput }`（用真组件当 stub 定义）。
2. **并带一条正控**：断言渲染出的确实是真 EP 的结构（本项目取 `.el-input__inner`；另一种等价取法是 `root.classList.contains('el-input') && root.tagName === 'DIV'`，因为全局 stub 的根就是 `<input>`）。没有正控时，将来有人把 stub 换回全局那份，测试仍然全绿——那就是"锁还在、已经不测东西"。

参照实现：`apps/desktop/src/components/PublishFrequencySettings.label-association.test.js`（PR #4529）的挂载锁，以及其执行记录 §三。

**本节不改动 §3 资格表**：资格表的所有读数都取**真组件**，未被全局 stub 污染；本条只约束"用挂载层去复现资格表结论"时的夹具装配。


## 4. id 的取值规则（数据校验面）

1. **必须唯一**，且不得与同文件内任何 `data-testid` 撞名——撞名时 `getElementById` 与 `for` 会指到别的元素，比缺失更坏。
2. **不得用 `Math.random()`**：随机值在同页多实例下可撞车，而浏览器取文档首个匹配，撞车后果是把我的标签挂到别人的控件上。
3. 优先用**语义名**（`mp-api-key`、`vfd-cover-url`）。
4. 同页多处同义字段（如新增/编辑两个对话框绑定同一组 `form.*`）时，必须**加区分后缀**并保持成对写死在同一处（本仓用"标签所在行号"后缀，如 `mp-name-441`），不得共用。
5. 自定 id 的合法来源还包括框架实例级 id（Vue 3.5 `useId()`），禁止手写计数器。
6. **禁止"为关联而造 id 到非 labelable 元素上"**：给组件根 `<div>` 加 id 再写 `for`，浏览器不报错但关联不存在，这类写法在像素门禁与单测里都看不见。

## 5. 锁的分层（每条都要说清它证什么、不证什么）

| 层 | 判据 | 覆盖什么 | 结构性看不见什么 |
|---|---|---|---|
| 挂载负控 | 凡渲染出的 `label[for]` 必须解析到**存在且 labelable** 的元素，且 `control.labels` 反查命中该 label | "接线接错了"（悬空锚点、指到 div、id 重复） | 到不了的分支（`v-if` / tab 门控 / 对话框未打开）⇒ **不得用它度量覆盖面** |
| 静态清单锁 | `for` 集合与逐条点名的清单 `toEqual`，**不多不少** | 漏接线、新增孤岛 | 属性的**语义**是否被浏览器接受（要配合挂载层） |
| 零孤岛静态扫描 + **规模下界** | 扫描域内孤岛数必须等于登记值，且 `scanned ≥ N` | "整个文件没扫到"被读成合规 | 需要人维护清单，只能缩小 |
| 完整性锁 | 被接线的控件行仍带 `v-model` / `class=` 等既有属性 | 批量加属性时吃掉中间内容（本仓真实发生过一次，是负控报出来的） | 与接线无关的其他改动 |
| 例外计数锁 | `{key, count, why}` 逐条点名 + 处数相等 | 豁免扩大、豁免未随补齐销账 | —— |

覆盖面上界**必须放在静态清单层**：夹具到不了 `v-if` 门控分支时，给挂载用例写覆盖率下界会把"夹具不可达"误读成"接线失败"。

## 6. 存量清单与欠账（当场读数，引用时现跑）

判据：`既无 for/:for，也不包裹 labelable 控件，且自身没有 id 被同文件某控件的 aria-labelledby 指回`。扫描域 = `apps/desktop/src` 下 `.vue`，**206 个文件、读不到=0**。

- `origin/main@fff27c847`：**162 处 / 30 文件**。
- 大户（≥10）：`S2vConfigPanels.vue` 19、`Publish.vue` 16、`CreateView.vue` 13、`ModelProviders.vue` 13、`WorkflowEditor.vue` 12、`ViralFormDialog.vue` 11、`AiWriterPanel.vue` 10、`PublishFrequencySettings.vue` 10。
- 在飞三批（#4500/#4501/#4520）合并后预计 −32 ⇒ **约 130**。这三个数各自成立的前提是"分支未合并"，合并后必须重取。
- **无可用通道的 12+2 处**：`PublishFrequencySettings.vue` 的 6 个 `el-input-number` + 1 个 `el-switch` + 1 个 `el-select` + 2 个 `el-input`（其中 2 个可走通道 C），以及 #4520 留下的 2 个 `el-select`。`el-input` 那两处可立刻按通道 C 收编；其余三类**需要先做组件层判归**（候选方案：EP 自身的 `aria-label` prop、把控件包进 `<label>`、改用原生控件、或在控件外侧提供可见且可聚焦的说明锚点），这是产品/组件决定，不得由机械补属性冒充修好。

`Publish.vue` / `CreateView.vue` 是指名零增长文件（500 行熔断 + `TARGET_GREW`），接线必须写在既有行内。

## 6A. 关联判据的正解：断 `label.control`，不要写标签名白名单（并避开一条结构性假阳性）

§5 要求关联断言取 DOM 事实。最常被写成的形态是「取 `for` 指向的元素，再看它的标签名在不在
`input/textarea/select/button/meter/output/progress` 这张表里」。**这张表是冗余的，而且有毒**：

- 冗余：`HTMLLabelElement.control` 与 `control.labels` **本身就是浏览器给的 labelable 判定**——
  指到 `<div>` 或不存在的元素时 `control` 为 `null`、`labels` 为空。所以
  `expect(target.labels).toContain(label)` / `expect(label.control).toBe(target)` 已经同时证明了
  「目标存在」「目标 labelable」「双向关联成立」三件事，比白名单更强（白名单只证标签名，证不出关联）。
- 有毒：本仓 QM-6 判定器 `scripts/ccg-review-decider.js` 的 `RULES.sensitiveContents` 里有一条 SQL 形态
  `/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|DROP TABLE|ALTER TABLE)\b/i`。因为 `<`、`-`、`"` 都是非词字符，
  再带 `i` 标志，**HTML 标签名 `select` 与 `el-select` 逐字命中它**。于是锁里那张白名单——
  以及任何在**被改动行**里出现 `select` 字样的写法——都会把「给下拉框补可访问名」这种纯无障碍修复
  判成"改动涉及数据库"，触发 `内容命中 ≥1 ⇒ DUAL` 这条与行数无关的独立触发。

2026-10-27 跨三条在飞切片的实测（探针先自证 diff 变更行数与正控；第一次用 `2>/dev/null` 时 git 在 cmd.exe
下根本没跑、三档全报 0，那是**探针坏**不是"没命中"）：

| 切片 | diff 变更行 | SQL 形态命中 | 其中纯粹是 `select` 字样 | 涉及真 SQL 语义 |
| --- | --- | --- | --- | --- |
| #4531 PromptEvalView | 232 | 2 | 2 | **0** |
| #4529 PublishFrequencySettings | 606 | 22 | 22 | **0** |
| #4539 WorkflowEditor | 352 | 14 | 14 | **0** |

三条口径：

1. **新写的关联锁一律用 `label.control` / `control.labels`，不再引入标签名白名单**；需要"非 labelable 即红"
   的负控时，把负控目标写成 `<div id=...>` 并断言 `label.control === null`——这比在正控里枚举标签名更直接。
2. **被接线的元素本身就是 `<select>` 时，这一族假阳性无法靠改写自己的写法规避**（那一行就是 `<select …>`）。
   正确处置是走真外部评审（§6B），**不得**为了降档去动 `RULES`、拆测试或给判据加文件类型例外——
   那是在改"谁来守门"，且 `scripts/ccg-review-` 自身在 `HIGH_RISK_SURFACES` 清单内。
3. 判据按**语义位置**切而不是按字符串是否出现切（AGENTS.md 既有纪律）：要禁的是"某开标签上的某属性"，
   判据就写成在该标签属性段内匹配；解释性文字里不要原样引用被禁字面量，否则锁会打红自己的注释。

## 6B. 跑 QM-6 的两条链路现场（本仓 2026-10-27 实测，都会让人把"没跑"读成"过了"）

1. **pre-commit 的 CCG 门禁会静默跳过**。若 `run_skill.js` 不在 `scripts/ccg-gate.js` 的默认候选目录里，
   它打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁` 并**返回 0**，于是那条代码提交
   **没有判定产物**；随后 `sh scripts/deep-review.sh` 因 fail-closed 报
   `本提交有 N 行非 .ccg 改动却没有判定记录`（`DEEP_RC=1`）。本机 `run_skill.js` 实测落在
   `<技能根>/ccg/run_skill.js` ⇒ 提交前需带 `CCG_SKILLS_DIR=<该目录>`。
   **"门禁跳过了且 rc=0"不等于"门禁判过了"。**
2. **`deep-review.sh` 按"父提交 sha"解析判定记录**（`--dry-run` 原文：`判定记录按父提交 sha 命中：9b3fff33（提交时 HEAD 即父提交）`）。
   因此它必须**紧跟在代码提交之后**跑：先补一个纯文档/纯 `.ccg` 提交，HEAD 的父提交就变成那条低风险提交，
   其记录为 `SKIP` ⇒ deep-review 打印"按决策矩阵跳过深度审查"并 rc=0，**看着像走完、实际什么都没审**。
   顺序规则：`代码提交 → deep-review → 补充提交`；事后补救可用 `node scripts/ccg-review-decider.js --base=origin/main --sha <代码提交>`
   补出 sha 键记录（判定由工具产出，人不写 `status`/`tier`），但那只解决"记录缺失"，不解决"评审没跑"。

## 7. 施工切片 SOP（每条都对应一次真实踩坑）

1. 一片 ≤ 200 源码行（DUAL 规模会必然落到自扮演而无法合法闭合）。
2. 先量 `git show HEAD:` 的存量，接线写在既有行内 ⇒ `git diff --numstat` 两口径一致且净增 0 行。
3. 用**最小锚点**插入属性：禁止 `[^>]*?` 这类通配吃掉中间内容再只回填两端（本仓真实把 `id` 与 `v-model="form.content"` 一起删掉过，是挂载负控报出来的）。
4. 批量脚本必须自己打印「未接线（逐条说明）」清单，并让每条豁免的理由来自**实测的元素类型**——"脚本没匹配上"不是豁免理由（本仓把一处原生 `<input>` 误登记为例外，复核才抓出）。
5. 正则要同时认 `v-model:` 与 `v-model.` 修饰符形态（漏了点号形态会静默少接 3 处）。
6. 反证必须**取被禁形态本身**：把负控翻成"值恰好同形"的写法跑成全绿，证不出锁守哪一格（本仓犯过一次，第二次改用 `toBeNull()` → `toBe("probe-lbl")` 才 CAUGHT）。
7. 新增文案一律 zh/en 成对进 locales；本类改动理想情况不新增文案。

## 8. 验收标准

- 功能：目标表单内每个可见标签与控件的关联**由 DOM 事实成立**（`control.labels` 命中），不是源码字符串对得上。
- 交互：鼠标点标签可聚焦/切换该控件（通道 A/B）；选项组的组名对读屏可达（通道 C）。
- 显示项：无新增文案、无布局变化；视觉判定域内的页面若被改动，基线必须按"同一次 CI 渲染"刷新，禁止用本机截图或 `--update-baseline` 消化。
- 数据校验：id 唯一、不与 `data-testid` 撞名、无随机值；例外清单逐条带理由与处数。
- 可验证：`eslint` 0 error（表达式替换必须跑 lint——`vue/no-unused-vars` 会抓到失去读者的下标绑定）；先红后绿两档读数写入执行记录；至少一把取被禁形态的反证 CAUGHT。

## 9. 门禁现状与缺口（不假装已闭合）

- 全域孤岛棘轮 `check-label-association.js` **尚未接进 CI**：它属"改谁来守门"，且基线必须由合并后的主干重取，需人工过目。在那之前，本类改动只有"每批自带的文件级锁"在守，跨文件的回归没有执行体。
- 计数型判据只能按文件存量登记；`WorkflowEditor.vue` / `AutomationTaskDialog.vue` 等是本轮新出现的持有者，属未开工面。
- 像素门禁对标签关联**结构性失明**（关联不改变像素），不得以"视觉全绿"当验收证据。
