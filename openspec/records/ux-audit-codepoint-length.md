---
record: ux-audit-codepoint-length
task: UX 审计阶段 4.7 ① —— 字数与截断统一为 Unicode 码点（一处实现）
date: 2026-10-25
---

## 本次执行记录：把 13 处按 UTF-16 码元的截断/计数收敛成一份码点原语，并配一道防回退锁（ux-audit-codepoint-length，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合档（渲染层 + packages） | 入口 `scripts/session-init.sh ux-audit-codepoint-length`；worktree 路径从 `git worktree list` 读（不是按分支名拼 —— 同族上一刀刚踩过，本刀全程用脚本返回的真实路径）；起点 `HEAD == origin/main`；`rev-parse --abbrev-ref HEAD` == 分支名；依赖就绪含 `verify-worktree-deps.js`。差量：新增 `packages/shared-utils/src/text-length.js` + `.browser.js` + 两份测试（`src/__tests__/text-length.test.js`、`text-length-parity.test.js`）、新增 `apps/desktop/src/text-length-convergence.test.js`、改 `apps/desktop/vite.config.js` 与 **13 个生产源文件**、本记录 + PRD。不触 `.github/workflows/`、不触 `scripts/check-*`、不触凭证/登录态 ⇒ **非高危面** |
| 第一性原因（QM-5 ①） | ✅ | `String.prototype.length`/`slice` 按 **UTF-16 码元**而非"一个字"工作：emoji 占 2、国旗（两个 regional indicator）占 4。当场实测三条：`'a'.repeat(19)+'🎉尾巴'` 的 `slice(0,20)` 得到尾部为**孤立高位代理** `\ud83c` 的串；`'🇯🇵 flag'.slice(0,2) === '🇯'`（半面旗）；`'抖音好物分享 🎉🎉 爆款'` 是 `.length=14` 而码点=12。引入点不是某次提交，而是**该原语从未存在过**：`git ls-files packages/shared-utils/src` 里没有任何长度/截断模块，于是每个写截断的人各自抄一种形态（实测三种形态 13+3+2 处） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：涉及截断的用例夹具**清一色是 ASCII** ⇒ "切断代理对"这一整类缺陷对测试结构性免疫（与 AGENTS「文本结构断言：纯 `toContain` 对整篇压成一行免疫」同族，只是失效维度换成了字符编码）；`wordCount` 的两处既有测试只断言"有值/取自 content.length"，不校验口径；视觉层：豆腐块出现在超长文案被截断的那一刻，基线截图用的是短文案；审查层：单文件里 `slice(0,60)+'…'` 看着完全正常，跨 13 个文件的口径分裂不在一个视野里 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=**流程缺失（无单一实现 + 无防再犯锁）**：AGENTS 已为同类问题立过规矩（正文承载形态 `formatArticleBody` 单一实现、href 协议 `safe-http-url` 单一实现、CJS/ESM 靠 parity 锁同源），**唯独文本长度/截断这一维没有**，所以它不是"这次写错"而是"下一次一定还会写错"。具体落点：`apps/desktop/src/**` 里 13 处独立实现，且 `ConfigProfileManager.vue` 已经自己写了第三种形态（`Array.from(x).length`，对但没有共享化 ⇒ 第五处会另写成 `[...x].length` 或 `Intl.Segmenter`） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 唯一实现 `text-length.js`（CJS）+ `.browser.js`（ESM 孪生）：`toCodePoints` / `codePointLength` / `truncate`（max=正数码点数、省略号另加 ⇒ 与既有 13 处语义逐字一致，迁移零宽度变化）/ `truncateWithin`（总宽硬合同，`max ≤ 省略号长度`时只截断不放省略号）/ `hasDanglingSurrogate`（探针）。文件头写死三条口径：按**码点不按字素簇**（`e\u0301` 是 2 码点、ZWJ 家族是多码点一字符，刻意不上 `Intl.Segmenter` —— 双侧可用性不一致，而平台限制按码点/字节计，码点可与平台对账）；非法 `max` 收敛到 0；**不用 `process.env` 做档位**（渲染端 env 被 Vite 注成空对象桩 ⇒ 死开关，本仓实测过）。② alias 接线：`apps/desktop/vite.config.js` 登记 `…/text-length → …​.browser.js`，与 `safe-http-url` / `article-body-format` / `publish-gate-help` 同先例；未登记的后果（同族实测）是 Vite 拉 CJS ⇒ 具名导入拿不到 ⇒ 挂载期报错，而单测解析到 CJS 所以本地全绿。③ 迁移 **19 个站点 / 16 个文件**（评审 i3 打回的原数字「11 处 = 9+2+3」自相矛盾，此处按 `git diff` 的 `+` 行逐条重数）：14 处截断（含把 `/^.{0,24}$/` 前置守卫那条并进 `truncate`，以及判据扩宽后新抓到的 `SceneCard.vue` / `CreateHistory.vue` / `CreateViewHistory.vue` 三处）+ 2 处 `wordCount` 计数 + 3 处 `Array.from` 名称长度校验；2 处带理由登记例外（`Collection.vue` 在模板表达式里、改它要动模板结构；`FilmEngineeringView.vue` 在像素判定域内，改可见宽度须与基线刷新同批）。④ 行为锁 **8 条**（`text-length.test.js`）：码点 vs 码元逐形态给值**并用 `.length` 自证夹具确实有差异**、截断不留孤立代理（含"旧写法确实留"的夹具自证）、`truncate` 与 `truncateWithin` 的宽度合同分开锁、非法 `max` 收敛、探针分抓高/低位代理。⑤ **CJS↔ESM parity 锁**：10 个输入向量 × 8 个档位逐条要求两份实现输出相等，并断言导出面键集相等（解析退化成空集合时该断言当场红）。⑥ **防回退锁 8 条**（`text-length-convergence.test.js`，评审 i2/i4 后补的两条见下）：只按风险语法位置切，形态集为 `.slice|.substring(0, 表达式) + 省略号字面量` 与 `.concat(省略号)`（右参允许 `max - 1`，第一版只认标识符字符会放过它）；扫描域下界 `>300` 且取到 0 直接抛错；例外清单只能缩小、**每条必须当场仍有命中**（陈旧即红）且 reason 长度 >20；≥15 个生产文件必须真的 import 该实现；**新增 A：站点台账 19 条逐条回查**（`x.length` / `Array.from` 这两族全域命中数以千计、按形态禁不了，改按站点钉住，退回即锚点找不到而红）；**新增 B：导入接线锁**（每个导入名必须有调用点 ⇒ 死导入红；本地不得有同名 `function|const|let|var|class` 声明 ⇒ 重复声明红）。`.length` 当计数与"省略号来自变量"两族**刻意不声称已覆盖**，理由写进文件头注释。实跑：`8 passed`（本文件）+ 全域行为/parity 锁合计 `25 passed` |
| 变异反证 | ✅ **6 刀全部 CAUGHT**（独立驱动 `scripts/codepoint-length-mutate.cjs`，已实跑；第一轮只有 3/6，两条 NOT_CAUGHT 打的是我自己的证据分配，逐刀读数与修法见下节《变异反证逐刀读数》） | 基线趟 `rc=0 失败行=0`；M1 死导入 / M2 撞车谓词改恒不匹配 / M6 死导入谓词改恒空集 / M3 站点退回码元截断 / M4 形态判据永不命中 / M5 台账循环换空集合，各红且**指名对应用例**；还原后复跑 `rc=0`、逐刀 md5 还原=true |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 原语进 `packages/shared-utils` 并登记 alias，`src/**` 里再无第二份实现；② **防回退锁进 vitest 收集域**（`apps/desktop/src/*.test.js`），无需改 workflow 即可在每个 PR 跑 —— 这是本批能自动合并的原因，也说明"要接 CI 不必先动 workflow"；③ 例外清单只能缩小 + 陈旧即红 ⇒ 登记不是豁免出口而是排队；④ 文件头把"按码点不按字素簇"的**理由**写死，防止下一个会话把两者当同义词顺手换实现；⑤ PRD §3.3 明写两件事没做（平台侧字节上限、审计 4.7③ 富文本补上限），不留隐式承诺 |
| 行尾与 diff 对账 | ✅ | 迁移由一次性脚本完成：**逐处断言锚点命中数=1、写盘后回读校验"旧写法残留=0 且新写法在位"，任一处不匹配则整体不写**（当场 12 文件、补 12 条 import、回读不符=0）。脚本自身落系统临时目录（占位写作 `<临时目录>`）不入库；执行时踩到一次跨运行时路径坑（Git Bash 的 `/tmp` 与 node 解析的临时目录不是同一处，第一次按 bash 路径调 `node` 报 MODULE_NOT_FOUND，改用 node 侧可见的绝对路径后正常），已按既有记忆复跑。`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相等（`vite.config.js` 6/0、`useNotify` 域外各文件均为纯新增/等量改写）⇒ 未改写行尾 |
| QM-1 打包 / QM-4 视觉 | N/A（QM-4 待 CI 判定） | 差量不含 `apps/desktop/electron/**`、`packages/rpa-engine/**` ⇒ 无打包面。像素：ASCII 文案下截断结果**逐字不变**，故不预期基线漂移；本批不改任何 `.vue` 的模板结构与样式，改的是 JS 表达式。该判断的最终证据是 CI `QG Visual` 的实跑，不据本机推断宣布无回归 |
| QM-6 CCG 双模型外部评审 | ✅ 已跑（DUAL，跨家族 critic=claude / proposer=opencode）→ **4 条全部成立，本 PR 不自动合并，等人工** | decider 判 `DUAL`（变更 422 行 > 200 阈值）。引擎第一轮实跑产出 7 条 critique、4 条进入裁决；我逐条填 prosecution/defense/verdict/rationale 后由引擎自结算，读数：`🔴 自扮演裁决判定存在阻断项 4 条（i1/i2/i3/i4 均 self_play_upheld）`。**没有手填任何 `status`/`tier`**，产物由引擎自己改写。四条处置见下节《外部评审逐条处置》，其中 i1 不止是风格问题 —— 它同时是本次 CI `build` 与 `QG Changes` 变红的根因。 |

## 外部评审逐条处置（2026-10-25，critic=claude，4 条全部 upheld）

| # | 指控（要旨） | 裁决 | 当场证据与处置 |
|---|---|---|---|
| i1 | 12 个生产文件整行复制 `{ truncate, truncateWithin, codePointLength }`，各文件实际只用其一 ⇒ 死导入；且收敛锁的「≥9 个文件真的 import」只数 import 字样出现，死导入照样凑数 | **upheld（且比指控更重）** | 按「导入名在本文件是否有调用点」清点 = **25 个死导入**（不是 24）。同一个根因还造成第二个后果：`useCopyLibrary.js` 本来就有 `function truncate (value, limit)`，我把同名符号导进去 ⇒ `pnpm --filter @multi-publish/desktop build:vue` 当场红 `Identifier "truncate" has already been declared (71:9)`，CI 的 `build` / `QG Changes` / `electron-tests` / `gui-test` 同步红。处置：修 25 个死导入；删本地同名实现，4 处**落库字段钳制**改为 `truncate(v, N, '')`（按码点钳制、不追加省略号 ⇒ 落库语义逐字保持，省略号只属于展示层）；新增**导入接线锁**（每个导入名必须有调用点、本地不得有同名 `function/const/let/var/class` 声明、`importers >= 15`），对本案两种形态各红一次。修后 `build:vue` rc=0、`✓ built in 16.10s` |
| i2 | 防回退锁只认 `.slice(0,X) + 字面量` 一种形态；本批真实修过的另两族（`x.length` 当字数、`Array.from(x).length`）完全不在判据内，`substring`/`.concat`/`slice(0, max - 1)` 也能绕过；AC4「新增同类写法必须变红」是过度声明 | **upheld** | 形态集当场扩为 `.slice\|.substring(0, [\w.$[\]()\s+\-*]+)` 后接 `+ 字面量` 或 `.concat(字面量)`；**先用同一判据对全域跑一次计数**（OLD=2、NEW=5），新增 3 条逐条核对为**同一缺陷**并随本批迁移（`SceneCard.vue` `p.substring(0,80)+'...'`、`CreateHistory.vue` `name.substring(0,10)+'...'`、`CreateViewHistory.vue` `text.slice(0,max-1)+'…'`）⇒ **例外清单没有变大，仍是 2 条**。`.length` / `Array.from` 两族**刻意不声称已覆盖**（全域 `.length` 命中数以千计且绝大多数合法，按形态禁只会造一条恒红的锁），改由新增 `MIGRATED_SITES` 台账 **19 条逐站点回查**代偿：站点退回码元 ⇒ 锚点找不到 ⇒ 红。AC4 文案与文件头注释按实际能力改写，并把"不覆盖的两族 + 代偿"写死 |
| i3 | PRD §3.2 与执行记录的处数自相矛盾（记录写「迁移 11 处 = 9+2+3」而 9+2+3=14），且与 diff 不符 | **upheld** | 用 `git diff -U0 origin/main...HEAD` 取 `+` 行、按共享实现调用串逐条清点 = **19 个站点 / 16 个文件**（14 截断 + 2 `wordCount` + 3 `Array.from`）。PRD §3.2 标题、迁移条目、AC3 与执行记录同处全部改为该口径，并把"原数字自相矛盾、由评审 i3 打回"写在原位（不偷偷替换） |
| i4 | 锁里写 `expect(offenders.length).toBeGreaterThan(0)`，而例外清单的唯一合法终点是空集 ⇒ 收尾必须手改断言，并产生"为保 >0 而保留一条不必要例外"的逆向激励 | **upheld** | 该断言删除；反失明职责改由**成对正/负控**承担：4 条合成被禁样本必须为 true（slice+单字符、substring+三点、右参 `max - 1`、concat），4 条合法写法必须为 false（数组 slice、纯 slice 不接字面量、`.join('-')`、`.map(render)`）。每次新建 `RegExp` 实例，不复用带 `g` 的共享实例调 `.test()`（有状态 `lastIndex` 会让第二次调用假阴 —— 本仓既有教训）。本文件实跑 `8 passed` |

## 变异反证逐刀读数（2026-10-25，驱动 `scripts/codepoint-length-mutate.cjs`）

基线趟：`rc=0 失败行=0`（先证明"没被注入时是绿的"，否则 CAUGHT 计数无从谈起）。归因只取失败行
（`×` / `✖` / `FAIL`）里的用例名，通过行（`✓`）里的同名回显一律不算；驱动开局自检一次探针，
自检不过直接 `rc=2` 拒绝汇报 CAUGHT —— 这是被评审 i1 打回后定下的口径，不再靠"输出里出现过这个名字"。

| 刀 | 注入内容（取被禁形态本身） | 结果 |
|---|---|---|
| M1 | 往 `StageProgress.vue` 重新塞一个死导入（`truncateWithin` 之外再导 `codePointLength`，但无人调用） | CAUGHT，指名「导入必须被真正调用」 |
| M2 | 把撞车谓词改成恒不匹配（锁变成装饰） | CAUGHT，指名「撞车谓词必须认得本案历史文本」 |
| M6 | 把死导入谓词改成恒空集 | CAUGHT，同条（锁与探针同源，必须一起红） |
| M3 | 把 `PublishProgressTaskRow.vue` 一处已迁移站点退回 `text.slice(0, 120) + '…'` | CAUGHT，指名「已迁移站点必须逐条仍然按码点」 |
| M4 | 把形态判据的正则改成永不命中 | CAUGHT，指名「反失明锚点」 |
| M5 | 把台账循环的集合换成 `[]`（逐条检查变成不执行） | CAUGHT，同 M3 |

还原后复跑 `rc=0`，逐刀写回后 md5 与原字节一致，汇总 `CAUGHT=6/6`。

### 第一轮的 3/6 才是这一轮的信息量所在

第一轮只抓到 3/6，两条 NOT_CAUGHT 的原因都不是"锁没牙"，而是**我分配给它的证据测不到它**：

1. **M2 NOT_CAUGHT**：判据本体正控探针里自带了一份正则拷贝（`NAME_RE`），于是把**锁里**的撞车谓词削弱成
   恒不匹配时，探针照绿 —— 锁与探针各测各的，这属于本仓「装饰性门禁」的同型（判据存在、但它的读数
   不来自被执行的那份实现）。正解不是给 M2 换一条更容易红的期望，而是把两个谓词收敛成
   `deadImports` / `collidedDecls` **单一实现**并让探针调用它们：同源之后一起红，另补 M6 专打第二个谓词。
2. **M5 NOT_CAUGHT**：`totalSites` 从台账数组算，而不是从遍历算。把 `for (const … of MIGRATED_SITES)` 换成
   `of []` 后 `missing` 恒空、下界仍读到 19 ⇒ 两条判据全程静默。正解是加
   `expect(visited).toBe(MIGRATED_SITES.length)`：**"我数了台账"与"我逐条量了台账"是两件事。**

两处都没有靠"改宽期望"把驱动做绿。这条元教训与 `MEMORY` 里「变异没红我分配给它的那条锁 ⇒ 该锁保护面
比说明窄；补一条新变异而不是删弱锁」一致，落点新增一格：**探针拷贝判据时，锁的退化对探针不可见。**

### 这轮评审的元教训（写下来，因为它打的是我自己的验证装置）

- **本地验证域里根本没有 `vite build`，才是 i1 能活到 CI 的原因。** 单测全绿 + 组件测试全绿 + 棘轮全绿，都不能表示模块图能被 rollup 解析：重复声明是构建期错误，不是运行期错误。本仓已有同族先例（`vi.mock` 的 Proxy 让拼错的具名导入隐形、只有 `vite build` 红），这次是同一课的第二次落点，只是触发物换成了"同形 import 复制"。**口径：改 `src/**` 的导入形态，收尾必须跑一次 `pnpm --filter @multi-publish/desktop build:vue`，并把它写进执行记录当证据。**
- 三处数字（13 / 11 / 9+2+3）在两份文档里各写各的、没人回读 diff —— 这是"更正只落叙述、未落清单"的同型。正解不是更小心，而是**把清点交给命令**：站点台账现在是锁里的 19 条常量，文档写错会被台账读数当场比出来。
- 一条判据的"合法终点"必须是它能绿的状态。`offenders > 0` 把欠账存在性写成通过条件，等于要求这项工作永远不完工。
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

## CHANGELOG 条目

# 字数与截断统一按 Unicode 码点（UX 审计阶段 4.7 ①）

`String.prototype.length`/`slice` 按 UTF-16 码元工作：emoji 占 2、国旗占 4。实测 `'…'.slice(0,20)` 会在尾部留下**孤立高位代理**（渲染成豆腐块）、`'🇯🇵 flag'.slice(0,2)` 得到半面国旗、含 emoji 的标题字数虚高。全仓 16 处「截断 + 追省略号」（原判据只认 `.slice(0,N)+字面量`，扩宽形态后又抓出 3 处同缺陷）、3 处各自手写的 `Array.from(x).length`、2 处拿 `.length` 当字数，三种口径并存且**没有共享实现**。现新增 `packages/shared-utils/src/text-length.js`（+ ESM 孪生与 vite alias，同 `safe-http-url` / `article-body-format` 先例），导出 `codePointLength` / `truncate`（正文 N 码点、省略号另加，与既有语义逐字一致 ⇒ 迁移零宽度变化）/ `truncateWithin`（总宽硬合同）/ `hasDanglingSurrogate`，并迁 14 处截断 + 5 处计数（共 19 个站点、16 个文件）、带理由登记 2 处例外。配三道锁：8 条行为锁（含"旧写法确实会留孤立代理"的夹具自证）、CJS↔ESM 逐向量 parity 锁、`apps/desktop/src` 防回退棘轮（只按风险语法位置切、扫描域非空下界、例外只能缩小且陈旧即红、≥9 个生产文件必须真引用）。防回退锁第一次运行就抓到第 13 处 `useFeatureFlag.js:113`，证明"人工 grep 定域"不可靠。详见 `01-docs/PRD-CODEPOINT-LENGTH-2026-10-25.md`。
