# 本次执行记录：富文本正文输入硬拦按发布校验口径收口（ux-audit-rich-input-hardstop，2026-10-27）【混合 PR】

- 分支：`ux-audit-rich-input-hardstop`（worktree：`<仓库父目录>/mp-worktrees/mp-ux-audit-rich-input-hardstop`，非 C 盘；建树后 `git rev-parse HEAD` == `origin/main`（`858194776`）才动手；deps 经 `pnpm install --frozen-lockfile` + `node scripts/verify-worktree-deps.js` OK）
- 审计来源：阶段 4 · 4.7 ③「富文本模式的输入硬拦」后半

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：隔离 ✅ | 先红后绿 ✅ | 反证 CAUGHT ✅ | 消费者并集 30 passed ✅ | lint ✅ 0 error | 行数熔断 ✅ | 品牌/绝对路径/记录债务 ✅ | QM-6 ⛔ 待人工

## 一、缺陷

`apps/desktop/src/components/ArticleEditor.vue` 的正文上限只在 **Markdown 模式**真正生效：`<textarea :maxlength="maxChars">`（第 36 行）。而默认模式是富文本 `QuillEditor content-type="html"`，`maxlength` 对 contenteditable **完全无效**，超限只让计数器变红（第 45 行）。用户侧后果：在富文本里可以无限写，写完点发布才被拒——**错误出现在别处，且已经付出的编辑时间不可回收**。

## 二、⛔ 审计的措辞与仓内已编码口径冲突，照做会造出一个假修复（本记录最重要的一条）

审计 4.7 ③ 写的是「按**纯文本**长度删尾部」。我先照它写了一版纯文本口径的实现，然后去核发布校验的真实现：

- `publish-contract.js::validatePlatformContent`（`:397`）用的是 `Array.from(combined).length`，`combined` 来自 `String(article.content)`；
- 富文本模式下 `article.content` 就是 Quill 回写的 **HTML 字符串**；
- 预裁函数 `truncateByChars`（`:262`）同样按原始字符串码点裁。

⇒ 真实预算**包含标签自身**。若按纯文本拦，用户在编辑器里"没超"，发布仍被拒——这条硬拦拦不到真正失败的那条线，是把缺陷换了个位置。

处置：实现改为**与校验逐字同一表达式**的原始码点口径（`contentCodePointLength`），并把判据本体写成一条用例：裁完之后必须真的能让 `validatePlatformContent` 放行（同时断言前置条件"超量本该被拒"，否则这条用例可以在什么都没发生时通过）。审计措辞与实现的差异如实留在此处，不假装审计一开始就是这么写的。

连带发现（**未修，属产品裁决**）：富文本模式下计数器显示的是含标签的码点数，用户看到的 `1200/1000` 里有 200 是标签。展示语义该不该改成纯文本，是产品决定；改成纯文本会**同时**要求发布校验改口径，否则展示与校验分家（本仓记过这条：展示与校验必须共用同一个阈值函数）。

## 三、实现

- 新原语 `src/components/article-editor-hard-stop.js`：
  - `contentCodePointLength(c)` ≡ `Array.from(String(c ?? '')).length`，与校验同源，禁止再写第二份；
  - `truncateContentToLimit(content, maxChars)`：只删尾部；**切点必须安全**（不落在标签内部、不落在实体内部、不切半个代理对）；切完**补齐未闭合标签**；限内**原样返回**。
  - 两条由用例抓出来的真缺陷：① 第一版只在**切片**上判上限，补上 `</p>` 之后实测 `100004 > 100000` ⇒ 判据改作用在**最终产物**上；② 实体/标签边界需要**回退**（`cut -= 1` 循环），否则会产出 `&am` 这类劈开的实体。
- `ArticleEditor.vue`：`richContent` 的 setter 由 `emit('update:modelValue', val)` 改为 `emit('update:modelValue', truncateContentToLimit(val, props.maxChars))`（diff 4/1）。
- 未做也不做：给 `QuillEditor` 写 `maxlength`（对 contenteditable 无效，写了是假装修好——由结构锁禁止）；把超限正文退回纯文本/Markdown（2026-10-15 百家号"正文塌成一段"是同族错法）。

## 四、锁（`ArticleEditor.hard-stop.test.js`，9 条）

| 条 | 证什么 |
|---|---|
| 限内原样返回 | 不做无谓重写（逐字节相等） |
| 切点不落标签内 + 闭合成对 + **产物**不超限 | 结构安全与预算判据的作用域 |
| 切点不落实体内（5 个上限逐个试） | `&amp;` 不被劈成 `&am` |
| 代理对不被切成半个 | 不产出 U+FFFD |
| **同口径判据本体** | 裁完 `validatePlatformContent` 必须放行（并断言裁前必须被拒） |
| HTML 形态同样成立 | 标签占预算不得被绕过 |
| **假件正控** | mock 生效且真的 emit 过——否则"零回写"会被读成接线失败 |
| 接线行为 | 假 Quill 回写超限 HTML ⇒ 组件 emit 的正文被裁到上限、仍是 `<p>` 段落、闭合成对 |
| 结构锁 | textarea 保留 `:maxlength`；`QuillEditor` 标签内不得出现 `maxlength`；setter 必须调用 `truncateContentToLimit(val, props.maxChars)` |

夹具两条口径值得留下：`script setup` 里 import 的组件**不受** `global.components` 覆盖，必须 `vi.mock("@vueup/vue-quill")` 才接得住；`new URL(x, import.meta.url)` 在 vitest 的 SSR 模块里不保证 `file:` 协议，实测两次抛 `TypeError: The URL must be of scheme file` ⇒ 改 `path.resolve(process.cwd(), ...)` 并配一条"读到的确实是目标 SFC"的正控（防"路径读错"伪装成判据通过或失败）。

## 五、读数（当场实跑）

- 绿档（与消费者并集一起跑，验证域取消费者而非我的 diff）：`Test Files 3 passed (3) / Tests 30 passed (30)` —— `ArticleEditor.hard-stop.test.js` + `ArticleEditor.test.js` + `ArticleEditor.quill-load.test.js`。
- 先红（`ArticleEditor.vue` 退回改前 blob，同一棵树）：`Failed Tests 2`（接线行为 + 结构锁）。纯函数 6 条在退回态**仍绿**是预期的：被测模块本身是新文件，退回旧 blob 时它不存在于旧组件里，只有真接线那两条会红——这条限制如实写在这里，不夸大成"整片先红"。
- 反证（取被禁形态本身）：把 setter 退回 `val` 原样透传 ⇒ `Failed Tests 2`；每步跑完还原并 `cmp` 证明**字节级一致**。
- `eslint` 三个文件：`0 errors, 1 warning`（warning 是组件既有的 `components` 残留声明，非本次引入，不在本片扩大改动范围）。
- `.github/scripts/check-max-lines.js`：✅ 无新增超大文件（`ArticleEditor.vue` 现 215 行，未跨 500 熔断）。

## 六、QM-6

混合 PR；外部评审引擎在本机两个技能根缺失（`ccg-gate.js` 找不到 `run_skill.js` 即跳过并返回 0，任务 #44）⇒ 无真外部产物，`deepReview.status` 保持 `pending`，**本 PR 全绿也不自行合并**。

## 七、遗留

1. 计数器的**展示口径**是否改为纯文本（并连带要求发布校验同步）——产品裁决，见 §二。
2. 富文本粘贴/拖拽大段内容时被裁掉的部分**没有任何提示**：现在的行为是静默截尾。需要一条 toast/inline 提示（新文案必须 zh/en 成对进 locales），另片。
3. `Publish.vue` 传入的 `max-chars` 在 #4498（`ux-audit-platform-content-limit`）里才随平台预算变化；两片合入顺序无关，但 #4498 未合并前，富文本硬拦用的是组件默认值 `APP_ARTICLE_CONTENT_MAX`。

## CHANGELOG 条目

# 富文本正文的字数上限真正生效（原先只拦 Markdown 模式）

写文章默认在富文本模式，那里 `maxlength` 对 contenteditable 完全无效，所以"超限变红"只是提示——用户可以一直写，写完点发布才被拒，已付出的编辑时间不可回收。现在富文本回写这一刻按**与发布校验同一个计数口径**（原始字符串的 Unicode 码点数，含 HTML 标签自身）裁掉尾部：切点不会落在标签或转义字符中间，也不会把表情符号切成半个，裁完的段落标签成对补齐，仍是合法 HTML。顺带纠正一处差点被做出来的假修复——审计原文写"按纯文本长度"裁，但发布校验数的其实是含标签的原始串，照那个口径拦会拦不到真正让发布失败的那条线。展示口径（计数器把标签也算进去）是否要改成纯文本，属产品决定，已在执行记录中登记为未决。
