---
record: ui-design-nav-gate
task: 把设计稿导航契约从「只有文字约束」变成「有机检闸」—— 外部评审 i4 残余闭环（新增独立门禁脚本并挂进 CI）
date: 2026-10-26
---

## 本次执行记录：设计稿导航契约门禁落地（ui-design-nav-gate，2026-10-26）

### 一、这修的是什么

上一轮（PR #4468）修掉了设计稿导航的 13 处状态屏文字重复，并把规则写进规格书 §12。
但那条规则**只有文字约束、没有机械闸** —— 外部评审 i4 当时判**成立**，处置只做到「脚本就绪 +
规格书约束 + 实测读数」，脚本**没进 CI**，在执行记录里如实留成了「未闭合」。

本轮把它闭合。用户在三个方案里选了 **A：新增独立门禁脚本并挂进 CI**。

**闸门一落地就抓出两处残留缺陷** —— 这是它值得进 CI 的直接证据，不是我事后给自己找活干：

| 屏 | 导航原文字 | caption 标题 | 性质 |
|---|---|---|---|
| `#s-home` | `02 首页` | `02 首页 · 工作台` | 导航**漏了状态后缀**。与上轮修的 10 组完全同型，只是它没撞上别的同名链接，所以上一轮「重复组=0」的读数没把它暴露出来 |
| `#s-comments` | `11 私信评论` | `11 私信与评论` | 导航残留**旧侧边栏文案**（`apps/desktop/src/locales/sidebar/zh.js` 的 `comments: '私信评论'`），与设计稿的页面命名不一致 |

⇒ 上轮那句「47 条文字两两不同」为真，但它只是**必要条件**。文字唯一并不保证「文字与它指向的那一屏对得上」——
这两处正是被「唯一性」漏掉、被「文字 = caption」抓住的。

### 二、六条硬契约（D1–D6），全部机检

规格书 §12 原表是给人读的规则；本轮把它落成六条**机器逐条判定**的契约：

| 代号 | 契约 | 判定口径 | 违规码 |
|------|------|----------|--------|
| D1 | 无死链 | 每条导航链接的锚点必须等于某个真实屏的 `id` | `DEAD_LINK` |
| D2 | 文字唯一 | 全部链接文字两两不同 | `DUPLICATE_TEXT` |
| D3 | 一一覆盖 | 每个屏恰好在导航里出现一次（漏挂 / 重复挂都红） | `SCREEN_NOT_IN_NAV` / `SCREEN_IN_NAV_TWICE` |
| D4 | 文字 = caption | 导航文字**逐字等于**目标屏 caption 的「编号 + 屏名」 | `TEXT_CAPTION_MISMATCH` |
| D5 | 同页同号 | 同编号组内各屏屏名的基名（`·` 之前）必须相同 | `GROUP_BASE_NAME_MISMATCH` |
| D6 | 组内互异 | 同编号组内各屏屏名必须互不相同 | `GROUP_DUPLICATE_NAME` |

**两条口径写进代码注释，防止后人重犯**（都是实测踩过的坑）：

1. **比唯一性时不许剥状态后缀再比。** 剥掉后「20 自动化任务」与「20 自动化任务 · 空态」会被判成重复，
   正好把本稿最核心的「主态 / 状态屏」分层抹平。外部评审 i8 当初就栽在这个误报上。
2. **核查对象必须是仓内产物** `01-docs/ui-reference/design-2026-10/index.html`，**不是**设计源工作副本。
   两份不同步时，核设计源得出的「没问题」对仓内稿不成立。

两条都写成了**可证伪的测试用例**（见 §六），不是注释里的劝告。

### 三、为什么两处都改导航、不改 caption

**`#s-home`（`02 首页` → `02 首页 · 工作台`）**
- 屏 caption、规格书 §7 逐屏清单、屏内页头三处都写「首页 · 工作台」
- 而且「工作台」在真实应用里是**真概念**：`apps/desktop/src/App.vue:167` 有「**工作台壳态**（首页虚拟标签，
  SPA 渲染）」，`shell-mode-6a/6b.test.js` 也在测它
⇒ caption 是对的，导航漏了后缀。

**`#s-comments`（`11 私信评论` → `11 私信与评论`）**
- 屏 caption、规格书 §7 清单、屏内 `<h2>`、屏内副标题四处都是「私信与评论」
- 只有导航一处是「私信评论」，而它恰好等于旧侧边栏文案（`locales/sidebar/zh.js`）
⇒ 导航是残留的旧文案。

**为什么不反过来把 caption 改成「私信评论」去对齐侧边栏**：设计稿的页面命名是**系统性地**比侧边栏更细，
这是规格书 §6 里明确标注「**这是产品决策，需确认后再改 `MpSidebar.vue`**」的那一项：
`账号`→`账号矩阵`、`采集`→`素材采集`、`数据`→`表现洞察`、`私信评论`→`私信与评论`。
单独把这一页倒回去，会在命名体系内部造成新的不一致。要统一，得整组一起改，那是另一个决策。

**两处改动都在 `.frame` 之外**（导航与 caption 都是 frame 的兄弟节点）⇒ **47 张 PNG 一张都不用重出**，
本轮截图零改动。

### 四、为什么门禁住在 `changes` job 而不是 `static-gates`

判据的输入是 `01-docs/ui-reference/design-2026-10/index.html`，命中 `CI_IGNORED_PATHS` 的 `01-docs/**`。
而 `static-gates` 整个 job 带 `if: needs.changes.outputs.docs-only != 'true'` ⇒
**只改设计稿的 PR 会把它整片跳过**。

后果是具体的：那样一来「把 47 条导航改回文字重复」的 PR 能全绿合入，靠 main push 才红 ——
本仓已发生过同形事故（#3114：PR 侧 `QG Changes=pass` / `QG Static=skipping` 下合并，main 的 push 才红，
一次性卡住当时所有 open PR）。所以落点是唯一没有 job 级 `if` 的 `changes` job，且放在「非 PR 早退」之前。

这条理由与 `AGENTS.md`「进白名单前提锁」同源，已在白名单对账表里登记（见 §六）。

### 五、踩到的坑：新判据本体被 `.gitignore` 吞掉

写完判据跑测试全绿，`git status` 里却**只有 test 没有本体**。查出来是 `.gitignore:108` 的
`scripts/*.js` 把新建的 `scripts/*.js` 一律静默忽略（已跟踪的文件不受影响，所以只有**新**脚本中招）。

漏这条 negation 的症状不是报错，而是：**本机在盘、`node --test` 跑得通、`git status` 里它根本不存在**，
然后 CI 上以 `MODULE_NOT_FOUND` 红在**别人的**文件上，读起来像「判据坏了」而不是「判据没被跟踪」。

本仓同族已记到第 6 次（`#3011` / Gate 2c3 / precommit-spawn-budget / same-type-risk-locks / 掩码覆盖 /
引导按钮名 / 未接线组件），本次是第 7 次。已补 `!scripts/check-design-nav.js` 并写清理由。

**教训**：新增 `scripts/*.js` 后，验收不能只看「测试绿」，必须回看 `git status` 里本体是否真的在
`??` 列表里 —— 这也是删文件守卫（`safe-delete.js`）那条经验的同一枚硬币。

### 六、门禁

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型 | ✅ | **非 docs-only**（改了 `scripts/` 与 `.github/workflows/`）：`docs-only=false`，会跑全量 CI。这是「新增门禁」的必然代价，不是夹带。 |
| 隔离 worktree | ✅ | 独立 worktree `<worktrees>/mp-ui-design-nav-gate`，裸分支 `ui-design-nav-gate`。**未触碰共享主工作区**。 |
| 判据自证（判据本体） | ✅ | `node scripts/check-design-nav.js` → PASS：链接 47 / 屏 47 / 唯一文字 47 / 死链 0 / 同编号组 10。 |
| 判据自证（回归锁） | ✅ | `node --test scripts/check-design-nav.test.js` → **14/14 pass**。 |
| **可证伪（反向）** | ✅ | 把仓内产物的状态后缀批量剥掉 ⇒ 判据转红报 `DUPLICATE_TEXT`；改前产物（`origin/main`）实测 47 链接 / 35 唯一文字 / 10 组重复 ⇒ `rc=1`。修复后 ⇒ `rc=0`。**修前红、修后绿**。 |
| TDD 次序 | ✅ | 先放测试跑红（判据不存在 ⇒ 1 fail）→ 落判据 → 再跑红（抓出 2 处真实残留 `TEXT_CAPTION_MISMATCH`）→ 修产品 → 14/14 绿。判据不是事后补的。 |
| 三方对账 | ✅ | 产物 caption 47 / 导航链接 47 / 规格书 §7 清单 47，**三向零漂移**（互查双向 0 缺失）。 |
| 白名单对账表 | ✅ | `node --test scripts/classify-docs-only.test.js` → **27/27 pass**（含「门禁必须接线进 changes job 且整份 workflow 只出现一次」）。 |
| 接线资格登记 | ✅ | `node --test scripts/check-unwired-tests.test.js` → **39/39 pass**（登记表已加 `scripts/check-design-nav.test.js`，且该测试已点名进 `changes` job）。 |
| 新脚本入仓 | ✅ | `.gitignore` 补 `!scripts/check-design-nav.js`；`git status` 里本体与测试都在 `??` 列表。 |
| 行数上限 | ✅ | `check-design-nav.js` 188 行 / `check-design-nav.test.js` 170 行（limit=500 / testLimit=1500）。 |
| 截图零改动 | ✅ | 导航与 caption 都在 `.frame` 之外 ⇒ 47 张 PNG 未重出、**字节未动**。三方对照实测（`s-home` / `s-comments` / `s-automation-empty` / `s-film-classic`）：**改动后渲染 vs 基线渲染 = 292/0/0/0 像素差**，与「同一份 HTML 渲染两次」的基线噪声（292/0/0/0）**逐项相同** ⇒ 本次改动对截图的影响为零。另：`改动后 vs 仓内 PNG` 与 `基线 vs 仓内 PNG` 的差异数字**逐数完全相同**（179354 / 44539 / 18640）⇒ 仓内 PNG 与当前渲染环境存在固有差异，与本次改动无关。 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS。 |
| 绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js` → PASS（新脚本零本机绝对路径，只用 `__dirname` 相对解析）。 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致。 |
| QM-6 外部双家族评审 | ✅ | **DUAL**（441 行 > 200 阈值）。backend 体检通过（critic=claude / proposer=opencode 裸名均解析到真实可执行文件）；跨家族校验通过。critic 产出 **7 条**（4 条进待裁 + 3 条 Info），维度分 correctness 4 / security 8 / performance 8 / maintainability 2。逐条裁决 **upheld 3（i1/i2/i4）/ dismissed 1（i3）/ info 3**；**高危域 0 条**（`requiresExternalReview=[]`，无需外部复核三格）。判定记录已写回：`status=self_play_resolved` / `tier=external` / `performedBy=claude` / `evidence=delivery@142aeb97e6d9…`（就地重算一致）。critic 原始输出逐字 + 逐条裁决 + 可核坐标见公开 PR 评论 §七。 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导。 |

- 保留门禁：非 docs-only（改动含代码/CI 面）| 行尾对账 ✅ | 品牌残留 ✅ | 绝对路径 ✅ | 文档同步 ✅ | CHANGELOG N/A（无用户可见行为变更）| 执行记录 ✅ | 远程同步 PR #4534

### 七、外部评审逐条处置（CCG DUAL · critic=claude）

**公开证据**：https://github.com/Colinchiu007/mulpub/pull/4534#issuecomment-6434529581
（评论内含 critic 原始输出**逐字**、逐条 prosecution/defense/verdict/rationale、以及可核取证坐标表。）

| 编号 | 严重度 | 维度 | 裁决 | 处置 |
|------|--------|------|------|------|
| i1 | Critical | correctness | **成立** | **本 PR 闭合**：判定记录原为 `status=pending` / `performedBy=null` / `evidence=null` / `tier=unknown`（pre-commit 写下的占位形态），评审跑完后已写回四个字段 |
| i2 | Critical | maintainability | **成立** | **不在本 PR 修**：`.gitignore` 的 `scripts/*.js` 通配是第 7 次复发的根因，根治会让 `scripts/` 下本机临时脚本出现在所有人的 `git status` 里；`.gitignore` 全仓共享、影响当前所有并发会话 ⇒ 属「改仓库全局约定」，须人工过目。见 §九 |
| i3 | Warning | correctness | **驳回** | 指控「test-runner 与 standalone 分歧未被抓」与代码事实相反：测试第 189 / 197 行用 `execFileSync` 跑真 CLI 并断言退出码 2 / 0；该 step `shell: bash`，GitHub Actions 默认 `-eo pipefail`，exit 1 必然中止。独立执行那条的增量价值是 CI 日志里的可读读数（47/47/0/10） |
| i4 | Warning | maintainability | **成立** | **与 i2 同根、同处置**。唯一无保护的是 `.gitignore` 反选（并入 i2）；其余三处登记已有 `deepEqual` 钉死（27/27、39/39），属仓内既定「登记由人做、正确性由判据锁」口径 |
| i5 | Info | correctness | 口径不同 | 830（提案粗计）/ 441（判据只计**源码行**）/ 706（`git diff --stat` 整个差量）是三个口径，各自可复算 |
| i6 | Info | correctness | 接受为改进项、保留 | 用 `.source` 重建正则是为了每次拿到**全新 `lastIndex`**（带 `g` 的正则对象有状态，复用会从第 2 次起漏匹配）。实测：`check()` 在同一进程内被连续调用 14 次，结果稳定 |
| i7 | Info | maintainability | 不采纳拆文件，接受其内核 | 本仓执行记录既定形态是「一篇承载 是什么/为什么/读数/未闭合」，2200+ 份同形；另起验证日志会两处维护、迟早不同步。内核诉求已满足：§六 每项都写成「命令 + 实测读数」而非散文式声明 |

### 八、交付物

**新增**
- `scripts/check-design-nav.js` —— 导航契约判据本体（D1–D6，退出码 0/1/2）
- `scripts/check-design-nav.test.js` —— 14 例回归锁（含可证伪用例、口径锁、判据自身故障）

**接线**
- `.github/workflows/quality-gate.yml` —— `changes` job 新增两行（`node --test` + `node`），在非 PR 早退之前
- `scripts/check-unwired-tests.js` / `.test.js` —— 接线资格登记的增项 + 钉死清单同步
- `scripts/classify-docs-only.test.js` —— 白名单对账表 `01-docs/**` 的 commands 侧扩入本判据
- `.gitignore` —— `!scripts/check-design-nav.js` 反选（否则本体静默不入仓）

**产品修正**
- `01-docs/ui-reference/design-2026-10/index.html` —— 导航 2 处文字对齐 caption（`02 首页 · 工作台`、`11 私信与评论`）
- `01-docs/ui-reference/design-2026-10/UI-DESIGN-FINAL-2026-10-24.md` —— 新增 §12.1（六条机检契约 + 两条口径）与 §12.2（门禁位置与理由）；色板表「私信评论」统一为「私信与评论」

### 九、未闭合

1. **`scripts/*.js` 忽略规则的根治**：本次按既有先例逐条补 negation（第 7 次）。
   真正的出口是改 `.gitignore` 的匹配域（例如只忽略 `scripts/tmp-*.js`），但那是改「什么算临时脚本」的
   全局约定，影响面覆盖整个 `scripts/` 目录，不该由本 PR 夹带 ⇒ 只如实记录，不改。
2. **设计稿命名体系与侧边栏的差异**：`私信与评论` / `账号矩阵` / `素材采集` / `表现洞察` 等一组命名，
   与真实侧边栏（`私信评论` / `账号` / `采集` / `数据`）系统性不同。规格书 §6 已标为「产品决策，待确认」；
   本 PR 只保证设计稿**内部**一致，不单方面改架构。

### 十、本轮沉淀的教训（补进 agent 记忆）

**「必要条件全过」不等于「契约全过」。** 上一轮把「47 条文字两两不同」当成导航的完整性判据，
读数确实为真（47/47、重复组 0），但本轮把契约扩到「文字 = 它指向那一屏的 caption」之后，
同一份产物立刻暴露出两处不一致。

**可复用的做法**：给一类东西定规则时，先分清「必要条件」和「充分条件」——
唯一性、非空、格式合法都是必要条件，它们只保证「不重复 / 不缺失 / 不畸形」，
**不保证「这条记录说的是它该说的那件事」**。要抓后者，得有一条把**两端逐字对上**的判据
（这里是「导航文字 ↔ 目标屏 caption」的双向逐字相等）。

**另一条（同轮踩到，值得单独记）：对照实验的两个样本必须放在等价的环境里。**
证明「改动不影响截图」时，我把基线 HTML 导出到了**另一个目录**再做像素比对，
得到 `s-comments` 有 1172px 差异的结论 —— 差点据此重出全部截图。
根因是那份基线 html 相对引用的 `platforms/*.svg` 在新目录里不存在，**图标全部加载失败**
（实测：导出目录 146 张图只加载成功一部分；放回同目录后 146/146 全成功）。
**判据**：做 A/B 对照前先核对两侧的资源加载数/环境读数是否相同；
把基线**放回原目录**（渲染后立即删除）比「复制资源过去」更不容易漏。
另一个信号：如果「基线与仓内产物」和「改动后与仓内产物」的差异数字**完全相同**，
那说明差异来自环境，不是改动 —— 这个等式本身就是一条很有力的证据。
