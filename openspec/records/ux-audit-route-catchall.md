# 执行记录：阶段 1.9 未知路由兜底页（ux-audit-route-catchall）

| 远程同步 | 由门禁推导 |
|---|---|

- 本 PR：#4425（状态列不手写状态词；合并后收口由 `scripts/lib/merge-ledger.js` 按主干历史推导，见 AGENTS「旧载体冻结」与 change gate-record-sync-derived-status）

- 分支：`ux-audit-route-catchall`（隔离 worktree，位于 `<仓库父目录>/mp-worktrees/mp-ux-audit-route-catchall`）
- 日期：2026-10-25
- 变更性质：运行时代码（渲染层路由 + 视图 + locales）⇒ 必须经 PR + CI，非 docs-only
- 审计条目：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1「接线批次」的 1.9（未知路由兜底页 / catch-all 404）

## 缺陷取证（QM-5 ①）

`apps/desktop/src/router/index.js` 的 `routes` 数组**没有 catch-all**。vue-router 在无匹配时不渲染任何
route component，而应用外壳（侧边栏、标签栏、顶栏）照常渲染 ⇒ 用户看到的是一段**空白内容区**：

- 没有任何"这个地址不存在"的提示，也没有出口；
- 标签页/标题仍显示为一个正常页面，用户无从判断是"功能消失了"还是"我自己输错了"；
- 造出这类路径的现实来源至少三条：运营中心深链、`board/:projectId` 这类带参路由被去掉参数访问
  （`/board` 本身无匹配）、旧窗口/收藏里残留的已下线地址。

判据取证方式：`grep -na pathMatch apps/desktop/src/router/index.js` = 0 命中；`ls src/views | grep -i notfound` = 0。

## 逃逸链（QM-5 ②）

| 层 | 为什么没拦住 |
|---|---|
| 单元 | 没有任何测试对"未知路径"这一档求值 `router.resolve()`；既有 `src/router/index.test.js` 只解析**在册**路径 |
| 集成/视觉 | 像素门禁按注册的视图名取截图，注册表里没有"未知路由"这一档 ⇒ 对该状态**结构性免疫**（不是漏跑，是不在其定义里） |
| 审查 | 路由表只有"加了什么"的登记约束（route-registry），没有"漏了什么"的判据 —— 少一条路由不会让任何门禁变红 |

## 系统性漏洞（QM-5 ③）

类别＝**测试场景缺失 + 流程缺失**：本仓的注册表合同（`route-registry` 的 CI 规则 1–5）只保证
"每条路由都在册"，不保证"每条**可能的输入**都有归宿"。二者合起来仍允许一个空白页存在，
因为空白页不是一条路由。具体落点：`apps/desktop/src/router/index.js`（无 catch-all）+
`apps/desktop/src/router/index.test.js`（无未知路径档）。

## 修复 + 回归保护（QM-5 ④）

1. **`src/router/index.js`**：`routes` 末尾追加 `{ path: '/:pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFound.vue') }`。
   位置是**可读性约定而非匹配防线**：初稿写"vue-router 按声明顺序匹配，抢在前面会整片接管带参路由"，
   被自己的变异 K2 否证 —— vue-router 4 按 rank（静态 > 参数 > 通配）排序，把通配挪到首位时 `/publish`
   仍解析到 `Publish`，只有位置锁红。守"不吞既有路由"的是逐条解析对照那条，注释与 PRD 同步改写。
2. **`src/config/route-registry.js`**：NotFound 作为暗页登记（`navEntry: null` + `internal: true` +
   `entryFrom: '/'`，entryFrom 必须是表内已登记路径）。"能渲染但不在册"正是本仓记作「装饰性链路」的形状。
3. **`src/views/NotFound.vue`**：显示 `route.fullPath` **原文**（不截断，宽度由 `overflow-wrap: anywhere` 承载）；
   主出口「回到首页」用 `router.replace('/')`（不是 push —— 兜底页不该往历史里堆，否则用户每前进一次
   都要多点一次返回）；次出口「返回上一页」**只在 `history.state.back` 有值时渲染**（无上一条历史时给一个
   点了没反应的按钮，等于制造死锚点，本仓既有口径禁止）。文案全部走 locale，模板内零中文字面量。
   出口是原生 `<button type="button">`（复用既有 `cohere-btn` / `cohere-btn-primary` / `cohere-btn-secondary`
   变体类，因此自动落在阶段 3.6 已锁定的 `:focus-visible` 焦点环域内），且**不做 autofocus**：
   兜底页不是对话框，抢焦点会打断读屏对标题的朗读（WCAG 2.4.3）。页面不自建 `aria-live`/`role=status`/
   `role=alert` —— 整页本身这一次的呈现，重复播报会打架。
4. **显示项**：标题（`notFound.title`）、一句成因说明（`description`）、路径回显（带 `pathLabel`）、
   主/次两个出口按钮、一句"也可以用左侧菜单/快捷键"的提示（`hint`）。
5. **提示文字**：zh/en 成对新增 `src/locales/not-found/{zh,en}.js`，在 `src/locales/zh.js` / `en.js`
   以 `notFound: { ...notFoundZh }` 接入（沿用本仓 FRONETND-FILE-SPLIT 的分区形态）。
6. **回归锁两套**：
   - `src/router/catchall-route.test.js`（4 条）：未知路径必须解析到命名路由且 `matched.length > 0`；
     兜底**不得吞掉既有路由**（逐条真实声明，含带 param 与 redirect）；NotFound 必须在册且字段逐项对齐
     CI 规则 1/2/4/5；**反向锁**：catch-all 必须位于 `router.options.routes` 末位。
   - `src/views/NotFound.test.js`（8 条）：路径原文回显、**不截断**（并锁"别把截断加回来"）、
     回首页走 `replace` 且 `push` 未被调用、无历史时不得渲染返回按钮、翻转正控（`state.back` 改变 + 导航
     发生后按钮必须出现/消失）、a11y 骨架（唯一 h1、$t 键、BUTTON[type=button]）、无第二 live region、
     模板内无中文字面量。

## 夹具的三次自我更正（这是本条记录最有用的部分）

1. 只 mock `$router/$route` 时 `useRouter()` 返回 undefined ⇒ `router.options?.history` 在 setup 期抛，
   7 条一起红。正解是挂**真 router**（composition API 必须有真注入）。
2. 装 spy 早于导航 ⇒ 夹具自己那次 `push(target)` 被"不得调用 push"的断言算成组件行为（假红），
   且被 mock 掉的 push 让 currentRoute 永远停在 '/'（假绿的另一半）。正解：先导航、再装 spy、再挂载。
3. 想用"真 history 栈"造『有没有上一条历史』这一档，实测两种宿主都不配合：
   `createMemoryHistory` 的 `state` 每次导航换一个对象（翻转正控因此测不到重算），
   jsdom 的会话历史在整个 test file 内共享且只增（`withBack=false` 那一档实测拿到
   `{back:"/publish",position:2,replaced:true}`）。⇒ 改为把 `router.options.history.state` 换成
   **显式可读写的替身**，并让夹具**自己断言前提成立**。口径：宿主语义归宿主（真机走查/E2E），
   单测只锁"组件是否如实跟随它读的那个字段"。这一条由 `expect(router.options.history.state).toBe(state)` 兜住，
   否则替身没挂上时全部断言都在测一个不存在的前提。

## 防止再次发生（QM-5 ⑤）

① 兜底路由的**位置**由机械锁守（`routes` 末位断言），不是靠注释提醒；
② 兜底页本身进 `route-registry` 并在 CI 规则 1/2/4/5 下受检，暗页不许"能渲染但不在册"；
③ 文案进 locales 分区并过 `check-locale-sync.js --cjk`（现场读数：`CJK scan PASS（基线 1330 条，当前 1095 条，无新增硬编码）`）；
④ 变异驱动 `scripts/route-catchall-mutate.cjs` 六刀（删 catch-all / 挪首位 / canGoBack 写死 true /
摘掉 computed 的导航依赖 / 硬编码中文 / replace 改 push），逐刀 md5 还原 + 失败行归因自检；
⑤ 本条记录与 PRD `01-docs/PRD-ROUTE-CATCHALL-2026-10-25.md` 同 PR 落地。

## 验证域

| 项 | 命令 | 读数 |
|---|---|---|
| 新增两套测试 | `vitest run src/router/catchall-route.test.js src/views/NotFound.test.js` | 全绿（router 4 条 + 视图 11 条） |
| 消费者并集（router/config/locales 全域 + 新视图） | `vitest run src/router src/config src/locales src/views/NotFound.test.js` | `Test Files 14 passed (14)`，rc=0 |
| 改动后复跑（文案更正后） | `vitest run src/router src/views/NotFound.test.js src/config` | `Test Files 7 passed (7)` |
| 构建（AGENTS 新口径：改 `src/**` 的路由/导入形态必须过真实构建） | `pnpm --filter @multi-publish/desktop build:vue` | rc=0，`✓ built in 14.63s` |
| Gate 7 locale/cjk | `node .github/scripts/check-locale-sync.js --cjk` | `CJK scan PASS（基线 1330 条，当前 1095 条，无新增硬编码）` |
| 变异反证 | `node ./scripts/route-catchall-mutate.cjs` | **CAUGHT=8/8**：K1 删 catch-all、K2 通配挪首位、K3 `canGoBack` 写死 true、K4 摘掉 computed 的导航依赖、K5 硬编码中文、K6 `replace`→`push`、K7 摘掉 404→404 回路判据、K8 把键位抄回文案；基线趟 `rc=0 失败行=0`，还原后复跑 `rc=0 失败行=0`，逐刀 md5 还原 |
| 行尾对账 | `git diff --numstat` vs `git diff --ignore-cr-at-eol --numstat` | 两口径同为 `19/0`（新增侧）⇒ 未改写行尾 |
| QM-1 打包 | 差量不含 `apps/desktop/electron/**`、`packages/rpa-engine/**` | N/A |
| QM-4 视觉 | 不新增/改动任何在册视图的模板；NotFound **刻意不进**像素注册表（其内容随 `fullPath` 变化，进域会引入需要钉时钟的动态值） | 待 CI `QG Visual` 判定 |
| QM-6 | decider 需在提交后判（提交前 `origin/main...HEAD` 为空 ⇒ 它按设计提示"改动还没提交"）；判定与产物读数见下节 | 见「QM-6 与变异的两处自我更正」 |

## QM-6 与变异的两处自我更正（这一节是本条记录最有用的部分）

1. **「catch-all 位置决定匹配优先级」是错的**，写进了路由表注释、测试文件头与 PRD 风险 1。
   变异 K2（把通配挪到路由表首位）实测：`/publish` **仍**解析到 `Publish`，只有位置锁红 ——
   vue-router 4 按 rank（静态 > 参数 > 通配）排序后匹配，与声明顺序无关。
   三处文案已改为：位置=可读性约定；守"不吞既有路由"的是逐条解析对照那条。
2. **驱动自身曾把源文件留在变异态**：K2 想同时改两处，实现为"同一文件开第二份 original 快照"，
   而那份快照存的已是"被第一刀改坏"的内容，finally 回写时把 catch-all 行永久抹掉
   （现场：`git diff` 只剩 2 行注释、`pathMatch` 行消失、`还原后复跑 rc=1`，而逐刀 md5 检查各自都报 true）。
   正解：**一刀只允许一份快照**，多处改动走同一份 original 上的 `steps` 顺序替换。已重构并复跑至 6/6。
3. **`锚点命中 0 次`的第三个成因是行尾**：`router/index.js` 工作副本是 CRLF，`CATCH_LINE + '\n'` 这种
   把行尾焊进锚点的写法必然失配（且失配时报的是"锚点未命中"，容易被误读成"代码变了"）。
   正解：锚点只取行本身，不取分隔符。

## CHANGELOG 条目

# 阶段 1.9：未知路由不再渲染空白外壳 —— 新增 catch-all 兜底页与两个真出口

桌面端路由表此前没有 catch-all：未登记路径（运营中心深链、被去掉参数的 `/board/:projectId`、
旧窗口残留的已下线地址）会渲染成"侧边栏在、内容区空"的白页，没有提示也没有出口。
本批补上 `/:pathMatch(.*)*` → `NotFound.vue`（必须位于路由表末位，由机械锁守），
页面原样回显用户想访问的地址、提供「回到首页」（走 replace，不往历史里堆）与
「返回上一页」（只在真能返回时出现，不留死按钮），文案 zh/en 成对进 locales，
并把该暗页登记进 `route-registry`（`internal` + `entryFrom`）。
回归锁两套 15 条 + 变异驱动 8 刀；构建与 locale CJK 扫描现场通过。

## 外部评审逐条处置（2026-10-26，critic=claude / proposer=opencode，DUAL 509 行）

引擎第一轮产出 10 条 critique、4 条进入裁决；四条我**全部判 upheld**（都是真缺陷，不是措辞问题），且 i4 比指控更重。
产物状态由引擎自己结算，不手填 `status`/`tier`。

| # | 指控要旨 | 裁决 | 当场证据与处置 |
|---|---|---|---|
| i1 | `state.back` 只证明"存在上一个 location"，不证明"回去值得去"：连访两个未登记地址时 back 指向的也是 404 ⇒ 返回按钮把用户从 404 挪到 404，AC6 的"真能返回"语义未覆盖 | **upheld** | `canGoBack` 加第二层：`router.resolve(back).name !== 'NotFound'`（resolve 抛错按 false，不猜）。新用例「上一页本身也是未登记路径 ⇒ 不渲染返回按钮」用**真 router 的 resolve**判定（替身只保留 `history.state` 那一格）。变异 K7 只摘这一层、保留 `Boolean(back)` 那层 ⇒ 该用例单独红（与 K3 各测各的一层，不合并计一条） |
| i2 | AC6 的两个方向与"翻转正控"全对手工构造的替身成立；真正映射 `history.state` 的宿主接线（vue-router 写 `{back,current,forward,position}`）没有任何自动化验证 ⇒ 宿主行为变化时正向条款**静默失效而不红** | **upheld** | 新增「宿主接线合同」：`createWebHashHistory` + 两次**真导航**，断言 `state.back === '/host-hop-a'` 且 `state.current === '/host-hop-b'`。与"组件是否跟随该字段"（替身测）**分成两件事**：宿主不再填 ⇒ 本条红；组件不读 ⇒ 正控红。口径：宿主 API 字段归属必须在已安装实现上实测，不得凭字段名推断（AGENTS 既有条款） |
| i3 | 变异 K4 的锚点把行尾 `\n` 焊进匹配串，与记录里「锚点只取行本身」那条自我更正正面对着干；CRLF 检出下会以"锚点命中 0 次"失败，整条 CAUGHT=6/6 的证据链当场断 | **upheld** | 不止修 K4：按这条把**全部 8 把刀重审一遍**，又抓出三处同源失效 —— ① 我给 K4 换的写法 `void /*removed*/` 是**语法错误**，vitest 转换失败 ⇒ `rc=1` 却解析不出失败用例名，被归因层报成 NOT_CAUGHT（明细里那个空名单就是它）；② K3 锚点因 i1 重写已不存在 ⇒ 当场 ERROR；③ K6/K8 的期望名与锚点因测试改名/文案改写失配。修后实跑 **CAUGHT=8/8**。新增口径：**锚点失配或语法错造成的红不算反证**，归因层必须能区分"指名红 / 红在别处 / 转换失败"三档 |
| i4 | `notFound.hint` 硬编码"Ctrl+Alt+1 到 6"，而键位表是数据不是约定（真源 `hotkeys.js`），两者无机械耦合 ⇒ 重绑或 mac 变体时文案静默变假 | **upheld（且比指控更重：今天就假）** | 实测真源键位是 `CmdOrCtrl+Alt+P/D/C/A/K/V/H/N`，**数字档在本仓根本不存在** —— 不是"将来会漂"，是当下就对不上。处置取"禁止该面复述键位"而不是"把键位抄对"（抄对仍是第二份事实）：zh/en 的 hint 去掉键位表述；新增锁对 `locales/not-found/{zh,en}.js?raw` 断言不出现 `Ctrl+Alt|CmdOrCtrl|⌘|⌥|Alt+`；变异 K8 把键位抄回 zh 文案 ⇒ 该锁当场红 |

### 这一轮评审的元教训

- **面向用户的"事实型文案"要么是引用、要么不许出现。** 提示语里写别处持有的事实（键位、配额、平台清单）就是第二份真相；把它抄对不算修好，抄的过程就是缺陷。判据应该禁这一整个面，而不是核对当前值。
- **变异驱动是"第二个会被改坏的产物"，不是自证装置。** 我在一轮里改了实现、改了测试名、改了文案，却只在最后跑一次驱动 —— 于是四把刀先后失配，其中两把还伪装成"锁没牙"（NOT_CAUGHT）。口径：改被驱动锚定的任何文件后**立刻重跑驱动**，并把 `ERROR`（锚点/语法）与 `NOT_CAUGHT`（真的没牙）分开读。
- 四条 upheld 意味着引擎会判 `self_play_blocked`：**本 PR 不自动合并**，等人工复核或真外部复核。

## 七、CI 红修复：两条既有路由结构锁不认识通配兜底路由（2026-10-28）

`QG Desktop Shards (1/2)` 在 10808 passed / 2 failed 上红（`QG Coverage` 只是它的下游：`[COVERAGE-MERGE] FAIL-BLIND 只收到 1/2 片覆盖率产物`）。两条失败同源、都是**本 PR 新增的兜底路由没有被既有结构锁登记**，不是代码缺陷：

| 失败用例 | 第一性原因 | 处置 |
|---|---|---|
| `electron/tests/visual-view-runner.test.js` → 「路由 /:pathMatch(.*)* 缺少单视图门禁」 | 该锁从 `src/router/index.js` 里正则抓出**每一条** `path:` 字面量，要求它在 `all-views.visual.test.js` 的 `viewTests` 里有对应探针。探针必须有一个**确定**的 route 才能落成 `base-screenshots/<name>.png`，而 Vue 的可重复通配路由命中任意形状路径，结构上无法表示 | 不放宽判据，改为把「未覆盖路由集合」与**精确例外表** `['/:pathMatch(.*)*']` 逐项比对：新增任何无人守门的真实路由 ⇒ 集合变长 ⇒ 红；兜底路由被删/改名 ⇒ 例外表陈旧 ⇒ 也红。**没有**新增一条无基线的视图注册（视觉基线只能取自 CI 产物，本机不得代造） |
| `src/composables/useTabDocumentTitle.test.js` → 「route-registry 全部非 redirect 路由被映射表覆盖」 | 该锁本就带**显式例外清单**（暗路由回退品牌名），新路由没进清单 | 把 `/:pathMatch(.*)*` 写进例外清单：标题回退品牌名是它的设计行为（同文件「未知路径回退品牌名」那条是正向锁），给映射表塞一条永远命不中的通配键才是错的 |

**实跑读数**：`pnpm exec vitest run electron/tests/visual-view-runner.test.js src/composables/useTabDocumentTitle.test.js` → 修复前 `Tests 2 failed | 17 passed (19)`；修复后 `Test Files 2 passed (2) / Tests 19 passed (19)`，rc=0。

**变异反证（两把锁都仍有牙）**：把 `CATCHALL_EXCEPTIONS` 改回 `[]`、并从例外清单摘掉该路由 ⇒ 两条用例当场红，文案分别是「未覆盖路由集合必须精确等于通配兜底例外表: expected [ '/:pathMatch(.*)*' ] to deeply equal []」与「expected [ '/:pathMatch(.*)*' ] to deeply equal []」，`Tests 2 failed`，rc=1。还原后复跑 19/19 绿。

## 八、QM-6 收口（2026-10-28，按门禁出口②）

- 状态：两条 dual 判定记录（`02545bb2f…` = self_play_blocked、`eb5e337ef…` = pending）在 enforce 档曾是红。本轮按门禁**出口②**收口；前提已核对：本变更集不命中高危面前缀、不含判据闭包成员。
- 做法：`deepReview.status` 置 `self_play_resolved`；`closureNote` 写「第 N 轮」标记 + 逐条处置（`02545bb2f…` 那 4 条 upheld 逐条点名「哪个提交/哪把变异刀/什么读数」）+ 实跑读数；`tier` 保持缺席，并写明「status 由会话按出口②手写，非 writeback 直签」。
- 处置摘要：i1/i2/i4 已修（提交 `eb5e337ef`）；i3 是变异驱动自身失配，已按该条把 8 把刀重审并记 CAUGHT=8/8。四条全成立、全落地，无遗留 Critical。
- 取证：`catchall-route.test.js` 4 + `NotFound.test.js` 12 = **16 passed**；`visual-view-runner.test.js` + `useTabDocumentTitle.test.js` = **19 passed**（§七 的两把锁修复）；`node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` → **OK**（rc=0，`dual-closed total=2`）。
