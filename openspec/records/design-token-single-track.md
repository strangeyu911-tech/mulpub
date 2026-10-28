# 执行记录：设计令牌双轨收敛第一步（design-token-single-track）

| 远程同步 | 由门禁推导 |
|---|---|

- 本 PR：#4483（状态列不手写状态词；合并后收口由 scripts/lib/merge-ledger.js 按主干历史推导，见 AGENTS「旧载体冻结」与 change gate-record-sync-derived-status）

- 分支：`design-token-single-track`（隔离 worktree；目录名沿用创建时的任务名，见文末「命名说明」）
- 日期：2026-10-26 ｜ 审计条目：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 3.5（audit-26）
- 变更性质：CSS 令牌定义层 + 两道锁 ⇒ 运行时代码变更，必须经 PR + CI

| 步骤 | 状态 | 证据 |
|---|---|---|
| 根因（QM-5 ①） | ✅ | 两套令牌名各写各的字面值；`--radius-*`(tokens.css) vs `--r-*`(cohere) 值逐字相同，`--space-*` vs `--spacing-*` 只在 5 档等值、其余为真实刻度冲突。消费者数当场实测（见 PRD §1 表）。 |
| 逃逸分析（QM-5 ②） | ✅ | 单元：`tokens.slots.test.js` 有"圆角/间距快照不变"，但它**按 CSS 文本字面值**取值，对"另一个文件里还有一份同义令牌"结构性看不见；集成/视觉：像素门禁只看渲染结果，两侧值恰好相等时**没有回归可看**；审查：AGENTS 已为正文形态/协议判据/CJS-ESM 立"单一实现+锁"的规矩，唯独令牌这一维没有。 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=**流程缺失（无单一真源约束）**：任何局部诉求都可以只在 `cohere-design-system.css` 里回写一个 px，双轨复活且无门禁可读。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① radius：`--r-*` 7 档改为 `var(--radius-*)`；spacing：`--spacing-{2,3,4,6,8}` 5 档改为 `var(--space-{sm,md,lg,xl,xxl})`（存活方一律取消费者更多的一侧）。② 新增 `design-token-single-track.test.js` 6 条：漂移锁 / 零回归冻结表 / 反向别名（悬空引用）/ 冲突清单（只能缩小 + 逐条当场成立 + **规模下界**）/ 存量棘轮（实测上界 + 打印读数 + 遍历条数下界）/ 令牌未被删除的存在锁。③ 把既有 `tokens.slots.test.js` 的快照从"按字面文本断言"升级为"**按解析 var 后的生效值断言**"（`resolveVars`，最多 3 层、解析不出原样返回）—— 这一步是别名能落地的前提，且它让快照锁在将来仍能挡住"改刻度"。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 漂移锁让"重新写死 px"当场红；② 棘轮上界随第二阶段逐批下调，成为可见的进度条；③ 冲突清单把"值不等所以不能合"显式化，禁止用"统一取一边"把设计决策偷渡进收敛批；④ 快照锁改判生效值，双轨与别名两种形态都受同一把锁约束。 |

## 反证与实测读数

- `vitest run src/styles` → `Test Files 9 passed (9)`（新增 6 条 + 既有快照锁解析后仍绿）
- 棘轮现场读数：`--r-xs=23 --r-sm=33 --r-md=4 --r-lg=7 --r-xl=1 --r-pill=12 --r-full=13`（每次跑打印，调小上界在日志里可见）
- `pnpm --filter @multi-publish/desktop build:vue` → `✓ built in 10.21s`，rc=0
- 变异驱动 `scripts/design-token-alias-mutate.cjs` → **CAUGHT=6/6**（T1 改回字面 px / T2 反向别名 / T3 掏空冲突清单 / T3b 陈旧登记 / T4 棘轮遍历域塌空 / T5 摘掉快照的 var 解析），基线趟 rc=0、还原后复跑 rc=0、逐刀同一份 original 快照 + md5 还原
- 零回归的判据形态：T5 之所以是一刀，是因为"我把快照改成读生效值"这件事本身必须被证明有牙 —— 摘掉解析 ⇒ 别名立刻让快照不等 ⇒ 红

## 过程中的两处自我更正

1. **仓库根算错级数**：`countConsumers` 里 `path.resolve(DIR, '..', '..', '..')` 从 `src/styles` 上溯 3 级得到的是 `apps/`，那里没有 `apps/desktop/src` 这个 pathspec ⇒ `git grep` 以"命令失败"抛出，读起来像判据红、实际是路径算错。修成上溯 4 级并加一条"目录不存在即抛错并打印算出的根"的前置检查（不许把工具的失配读成"存量超标"）。
2. **别名会让既有快照锁先红，而它红得对**：`tokens.slots.test.js` 按字面文本取 `--spacing-8`，别名后读到的是 `var(--space-xxl)` ⇒ 红。正解不是把期望改成那个 var 串（那是把锁改成跟随实现），而是让锁**解析 var 后断言生效值** —— 期望值 32px 一个字都没动。

## 本批刻意不做的（防"顺手扩面"）

- 不合并刻度冲突档（2/6/80 与 4/20/40/64）：会改可见留白，须与视觉基线刷新同批，属设计决策。
- 不动消费者（第二阶段按文件批次换名 + 像素门禁），不动颜色族双轨。

## 命名说明

- worktree 目录名是本任务最初登记的名字（当时计划做的是「死观测字段门禁」），分支已用 `git branch -m` 改为本记录标题所指的 `design-token-single-track`。目录名与分支名不一致只影响观感；判据（执行记录按分支名取文件、pre-commit 按当前分支声明）都以分支名为准。

## CHANGELOG 条目

# 设计令牌双轨收敛第一步：圆角与间距的等值档位改为单一真源别名（零视觉回归）

`--r-*` 与 `--radius-*`、`--spacing-*` 与 `--space-*` 原本在两份样式文件里各写字面 px 值，
同名不同值时表现为"偶发的圆角/间距不一致"且 CSS 不报错。本批把值逐字相同的 12 个档位
（radius 7 档 + spacing 5 档）改成指向存活名的 `var()` 别名，存活方按当场实测消费者数选定；
值不同的档位（2/6/80 vs 4/20/40/64）保留字面值并登记为冲突清单，不在本批偷渡设计决策。
配套 6 条锁（漂移锁、零回归冻结表、反向别名、冲突清单下界、存量棘轮、存在锁），
并把既有令牌快照从"按字面文本断言"升级为"按解析 var 后的生效值断言"；
变异驱动 6 刀全部 CAUGHT，`src/styles` 全绿、`build:vue` rc=0。

## 外部评审逐条处置（2026-10-26，critic=claude / proposer=opencode，DUAL 320 行）

四条全部 upheld，理由与落点同 PRD §8。三条在此记录为**判据级**事实：

1. **棘轮只量一族 = 一半没牙**（i1）。补上 spacing 侧时立刻撞到真实值差：`--spacing-2` 实测 127，而我表里写 124 —— 因为那次测量是在**滞后 234 个提交的共享根**上做的。判据自己把一次测量口径错误变成了红。
2. **文本级判据会被注释顶掉**（i2 + 自纠）。装配锁第一版写作 `/import\s+['"]\.\/styles\/cohere-design-system\.css['"]/.test(MAIN)`（全文搜索），变异 T7 把该 import 改成注释后**测试照绿**（rc=0，零失败行）—— 注释里的同名串满足了全文正则，这正是本仓记过的「禁令按语义/位置切，不要按字符串是否出现切」的反向形态。正解：按行匹配且要求行首是 `import`、行尾无残留（现实现见测试内 `loaded(file)`，同一处注释已把这条教训写进代码现场）。
3. **自洽的常量表不是证据**（i3）。冻结表 24 项现在与 `git show origin/main` 的改动前 blob 逐项比对；T8 用"两侧对称改成 17px"取被禁形态本身，只有 git 复现能抓它。合并之后该 blob 不再含字面值，用例打印 `[TOKEN-BASELINE] …（本批已合并）⇒ 退化为快照锁负责` 而不是静默通过。

### 评审后复跑读数

- `vitest run src/styles` → `Test Files 9 passed (9)`；棘轮打印 12 个废弃名存量；基线打印 24 项逐项通过
- 变异驱动 → **CAUGHT=9/9**（T1–T8 + T3b；`[MUTATE] 基线趟 rc=0 失败行=0` → 逐刀 → `[MUTATE] 还原后复跑 rc=0` → `[MUTATE] 汇总 CAUGHT=9/9`）
- 第一轮实跑是 **CAUGHT=7/9**，两条失败各属不同档，必须分开记：`ERROR T4` = **驱动自身**锚点失配（改刀面后旧锚串不存在，不是锁没牙）；`NOT_CAUGHT T7` = **锁真没牙**（装配锁的全文正则被注释里的同名串满足）。两处都已修并复跑转 CAUGHT。

### 引擎高危域标签与本次 diff 不符（如实记录，不代改产物）

自扮演裁决把 i1/i4 标成 `highRiskDomains:["auth"]` 并写入 `requiresExternalReview`，但本批改动集只有两份样式文件、`main.js` 一行 import 核对、一条测试与一个驱动 —— 对两份改动文件 `grep -na auth` 零命中（rc=1）。这是 AGENTS.md 记过的**两个轴**：收口矩阵读的是路径前缀（`HIGH_RISK_SURFACES`），引擎的域标签是另一套按行归因的启发式，判据不读前者。因此本批不据此声称"高危面已满足"，也不改写引擎产物里的 `status`/`tier`/`highRiskDomains`；QM-6 的外部闭合仍按 DUAL 档进人工清单（任务 #19）。

### 第二轮外部评审（同一分支补跑，critic=claude）与逐条处置

8 条问题、5 条争议（minScore=4 ⇒ 又走自扮演出口）。逐条实测后：**四条成立并已在本批修**，一条属流程落点：

| # | 指控（要点） | 裁决 | 落点 |
|---|---|---|---|
| i1 | **Critical**：上一轮为 i3 加的 git 基线锁，其退化分支条件是 `Object.keys(derived).length === 0`，而 blob 里还有几十个未参与的令牌 ⇒ 该分支永不成立；本批合并后 12 个已别名化的名字全部走 "读不到" 分支 ⇒ **永久红**，而 PRD/记录都写着"合并后打印退化说明" | upheld | 判据改成**按名逐个判**：新增 `readVarRefs`（同一根块坐标、只收 `var()` 侧），该名在 blob 里已是 var 引用 ⇒ 记 `mergedAway`（合法让位，交快照锁）；既非字面也非引用 ⇒ 记"采集断了，不得当通过"。并加 `compared===0 ⇒ mergedAway>0` 的下界，把"一个都没读到"和"全已合并"分开。现场：`[TOKEN-BASELINE] 逐项比对通过（比对 24 项 = git 值；已合并让位 0 项）` |
| i2 | `git show` 抛错被 catch 后 `return` ⇒ CI（浅克隆/无 origin/main 引用）里这条实际不执行，读起来像通过 | upheld | 该分支改打 `[TOKEN-BASELINE] UNVERIFIED :: …` 并显式说明"取不到基准"，与"通过"分档；同时如实声明它仍不阻断（浅克隆环境下这条就是测不到，**不假装**它覆盖了 CI） |
| i3 | 判据域没有独立锚：整条 spacing 族可从 `ALIASES` 删掉而 `rows.length === ALIASES.length` 是自参照、照样绿 | upheld | 新增独立名录 `ALIAS_ROSTER`（12 个废弃名逐个字面写出），棘轮先与它 `toEqual` 再逐族给成员下界（radius ≥7、spacing ≥5） |
| i4 | (a) 冲突清单被 `>=5` 与 `<=5` 双向钉死 ⇒ 合法收敛（5→4）必须改测试常量，与"清单只能缩小"自相矛盾；(b) `expect(UPPER_BOUND[dep]).toBeTruthy()` 使"某名已迁完=0"被误判成漏登记 | upheld | (a) 删掉上界那根钉，改由**逐条当场校验**（两侧都得是字面值且真不等）承担拦新增；(b) 判存在改 `hasOwnProperty(...)toBe(true)` |
| i5 | PRD §1 的实测表自相矛盾（`--r-*` 合计写 83、逐格求和 93；`--spacing-6` 写 18 而锁界是 12），无法判断哪个是真值 | upheld | 按棘轮现场读数重写该表（93；127/69/20/12/2），并把口径改成"**存活方由 `[TOKEN-RATCHET]` 打印值决定，本文不再手抄合计**" —— 原先 83/172/278+ 三个手抄数正是矛盾源 |

另有 3 条 Info（`resolveVars` 的 depth 参数从未递增、驱动硬编码 `pnpm.CMD` 在非 Windows 不可用、`countConsumers` 逐名 spawn 且不剥注释/字符串、`git grep` 只搜已跟踪文件）**未在本批闭合**，如实记为欠账：前一条属实现细节（当前 12 档别名深度均为 1，环检测由 `i<3` 计数兜住但报错不指向环），后两条与 i4/任务 #23 同族（驱动跨平台化 + 计数口径）。

### 引擎最终读数（裁决填完后复跑）

```
提交判定: DUAL（变更 320 行 > 200 行阈值）
跨家族校验: proposer=opencode critic=claude 通过
♻ 复用存档 critique（6 条）+ 已填完的裁决 —— 跳过模型调用
🔴 自扮演裁决判定存在阻断项 4 条
   - [Warning] i1  high_risk_requires_external
   - [Warning] i2  self_play_upheld
   - [Warning] i3  self_play_upheld
   - [Warning] i4  high_risk_requires_external
ENGINE_RC=1
```

产物落 `.ccg/reviews/799296ef4ca6a7ffd2bb4c5d182db6fa2b06237a.json`，`deepReview.status = self_play_blocked`、`performedBy = self-play`、`confidenceWeight = 0.6`。**这条不是笔误也不是可以顺手改绿的字段**：`blockingFromAdjudication` 的规则是「高危域一律要求外部复核」+「自扮演下任何 upheld 即阻断」，而四条指控全部成立（三条已机械化、一条登记为流程欠账）——所以在没有真实外部复核的前提下，本 PR 的 QM-6 **不可能**由 agent 合法闭合。落点：`check-pr-exec-record.js --mode=enforce` 据此判欠账，PR 保持 open 等人工；CI 侧该判据仍以 `--mode=advisory` 运行，因此 **CI 绿不构成 QM-6 已过**。

## 第三轮：CI「债务熔断检查」判红与处置（2026-10-26）

合并前 CI 读数里 `债务熔断检查` = fail（其余 required 为 pass/pending）。本地按 `.github/workflows/debt-guard.yml` 的两步逐个复现，先分清是哪一步：

- `node scripts/check-debt-budget.js` → ✅ 五项指标全在基线内（rc=0，domain=13015）。**不是聚合棘轮报的**，别去找 debt-baseline。
- `node .github/scripts/check-max-lines.js` → ❌ 两条，且**都是本批自己造成的**：
  - `TARGET_GREW: cohere-design-system.css 现 1699 行已超过点名目标 1698 行（超 1）` —— 该文件在 `targets` 里被点名还账，按口径**零增长容差**；
  - `NEW_OVER_LIMIT: tokens.css 502 行 >= 500，新代码不得引入超大文件` —— 该文件 base 时 499 行，离 500 只剩 1 行余量，本批的解释性注释块把它顶了过去。

**根因与"代码规模"无关**：我为了说明"哪些档位做了别名、哪些是真实刻度冲突"，在两份文件**顶部各新起了一段多行注释**（tokens 3 行 / cohere 2 行），而这两份文件恰好都是行数熔断的点名对象。一条注释的成本在普通文件里是 0，在点名文件里是**行**。

**处置口径**（沿用既有惯例，三条都没破）：压自己的新增；不动 `limit`；不动 `targets`；不挂墓碑。调大基线必须与真实清理同 PR，本批没有可配的清理量，所以任何"把 1698 改成 1700"的写法都是把还账目标改成欠账额度。

做法是把注释**并入语义位置本就在的那一行**，而不是新起一段：

- `tokens.css`：删除顶部 3 行，内容并进间距阶梯那行既有注释（净 -3 ⇒ 498 行）；
- `cohere-design-system.css`：删除顶部 2 行，内容并进 `/* 圆角 */` 那行既有注释（净 -2 ⇒ 1696 行 ≤ 目标 1698）。

信息一条没少（别名口径、零回归理由、两侧无等值对应的档位与实际数值 4/20/40/64 对 2/6/80、冲突清单的文件落点、"不得在此重新写死 px"）。顺带修掉一处真实缺陷：**原注释在文件顶部，而它描述的东西在 40 行之外**——读 `tokens.css` 的人在 `:root` 开头看到一段与间距阶梯无关位置挂着的说明，那种注释在下次改动时最容易整块丢失。

### 复跑读数（全部当场实跑）

- `node .github/scripts/check-max-lines.js` → ✅「无新增超大文件，挂账清单与现实一致」；`超限文件` 读数由 95 回到 **94**，与同一次跑的 `挂账=94` 相等（修复前是 95 对 94，即有一条超限文件不在挂账清单里——那正是"新代码引入"的形状）
- `node --test .github/scripts/check-max-lines.test.js` → 36 pass / 0 fail（CI 同一步紧跟执行）
- `vitest run src/styles` → `Test Files 9 passed (9)` / `Tests 68 passed (68)`；棘轮打印 12 个废弃名存量；`[TOKEN-BASELINE] 逐项比对通过（比对 24 项 = git 值；已合并让位 0 项）`
- 变异驱动 → **CAUGHT=9/9**（`[MUTATE] 基线趟 rc=0 失败行=0` → 逐刀 → `[MUTATE] 还原后复跑 rc=0`）。本轮特意重跑而不是引用上一轮读数，是因为要验一件事：T6/T7/T8 的**锚点若落在我刚改写的那两行注释上**，改动会让驱动报 `ERROR`（锚点失配＝驱动自身缺陷）而不是 `NOT_CAUGHT`。实测九刀锚点均不在注释上，读数与上一轮一致。
- 行尾对账：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐字相同（cohere `+1/-3`、tokens `+1/-4`）⇒ 本次只改内容未改行尾。附带事实：这两份工作副本本是**全 CRLF**，而我上一批新增的 5 行是 LF；并入既有行后 LF 行数归零（`crlf=498/1696, lf-only=0`），blob 侧仍是 LF，无迁移。

## 第四轮：CI 存量棘轮判红与处置（2026-10-28，rebase 到主干后）

rebase 到 `fbd0e3926` 后，`QG Desktop Shards (1/2)` 红在**本 PR 自己的棘轮锁**上，不是外部原因：

```
FAIL src/styles/design-token-single-track.test.js > 存量棘轮：两侧被废弃名都要被量
AssertionError: --r-sm 的消费者数超过登记上界 ⇒ 有新代码在用废弃名: expected 37 to be less than or equal to 33
```

### 第一性原因：上界是**作者当时那一刻**的快照，而主干在四周里持续增长

逐名实测（`countConsumers` 同一实现，域 `apps/desktop/src` 去测试文件）在**本 PR 自己的 rebase 基** `88640e1c0` 上就已经是这样：

| 废弃名 | 登记上界 | 基 `88640e1c0` 实测 | 前置判定 |
|---|---|---|---|
| `--r-xs` | 23 | 23 | 恰好等于 |
| `--r-sm` | 33 | **37** | 已超 4 |
| `--r-md` | 4 | **12** | 已超 8 |
| `--r-lg` | 7 | **9** | 已超 2 |
| `--r-xl` | 1 | 1 | 恰好等于 |
| `--r-pill` | 12 | **17** | 已超 5 |
| `--r-full` | 13 | **14** | 已超 1 |
| `--spacing-2` | 127 | 127 | 恰好等于 |
| `--spacing-3` | 69 | 69 | 恰好等于 |
| `--spacing-4` | 20 | 20 | 恰好等于 |
| `--spacing-6` | 12 | 12 | 恰好等于 |
| `--spacing-8` | 2 | 2 | 恰好等于 |

⇒ 十条超界里 **一条都不是本 PR 写的**：radius 族的 5 个上界是作者四周前按当时的树量的，之后主干持续有代码在用废弃名（这条锁当时还只在未合并的分支上，主干侧没有任何力量拦新消费者）。rebase 之后唯一新增的增长是 `apps/desktop/src/views/NotFound.vue`（#4425 的未知路由兜底页，本 PR 的基之后才落地）用掉了 5 个 spacing 档位共 7 处（`spacing-2×2 spacing-3×2 spacing-4 spacing-6 spacing-8`）。

### 处置：**不动任何上界**，把超出的消费者改写成规范名（值等价 ⇒ 零视觉回归）

三条被否掉的写法：① 把 `UPPER_BOUND` 抬到实测值 —— 那就是把"棘轮"改成"进度条"，等于放宽锁（本 PR 的存在意义正是零增长约束，抬上限自相矛盾）；② 删锁/加豁免 —— 更直接地取消判据；③ 只改 NotFound.vue —— 只能把 spacing 一族拉回，radius 一族仍超 20 处，CI 照样红。

实际做法：按**超出的精确数量**（不是"顺手全改"）把废弃名消费者换成规范名 —— radius 族 `--r-sm`×4、`--r-md`×8、`--r-lg`×2、`--r-pill`×5、`--r-full`×1，共 **20 处**；spacing 族只改 NotFound.vue 那 7 处（`--spacing-{2,3,4,6,8}` → `--space-{sm,md,lg,xl,xxl}`）。改动文件 6 个：`cohere-design-system.css`（9 行）、`page-controls.css`（2）、`page-skins-data.css`（5）、`premium-components.css`（2）、`premium-design-system.css`（2）、`NotFound.vue`（5）。

**为什么这是安全的（不是"改视觉来换绿"）**：这批替换的对象在本批第一步就已证明**两侧字面值逐字相同**（记录 §「零回归锁：别名建立前两侧字面值必须逐字相同」+ `FROZEN_PAIRS`），因此 `var(--r-md, 12px)` → `var(--radius-md, 12px)` 解析结果恒等；`--spacing-1` / `--spacing-5` 这类**刻度冲突档一处没动**（它们在 `CONFLICTS` 里，改动会改可见留白）。

**与上文「本批刻意不做的：不动消费者」的关系**：那条针对的是"第二阶段按文件批次换名"这种**主动扩面**；本轮是被点名上界已经超了、不还这 20 处就无法合入，属于**还账**而非扩面，且数量被锁在"恰好把读数压回上界"。

### 复跑读数（全部当场实跑）

- `vitest run src/styles/design-token-single-track.test.js` → **8 passed / rc=0**，棘轮打印：
  `[TOKEN-RATCHET] 废弃名存量：--r-xs=23 --r-sm=33 --r-md=4 --r-lg=7 --r-xl=1 --r-pill=12 --r-full=13 --spacing-2=127 --spacing-3=69 --spacing-4=20 --spacing-6=12 --spacing-8=2`
  —— 12 个读数**全部恰好等于各自上界**（零余量：再多一处用废弃名就红，与"上界只能下调"的进度条语义一致）
- 变异驱动 `node scripts/design-token-alias-mutate.cjs` → `[MUTATE] 基线趟 rc=0` → 九刀逐条 `CAUGHT` → `[MUTATE] 还原后复跑 rc=0` → **`[MUTATE] 汇总 CAUGHT=9/9`**（上文第二轮记的 6/6 是当时只有六刀；T6/T7/T8 是第二轮外部评审后加的）
- `node .github/scripts/check-max-lines.js` → ✅「无新增超大文件，挂账清单与现实一致」（`cohere-design-system.css` 本轮 `+9/−9` 净 0，仍 1696 ≤ 目标 1698；`tokens.css` 未触碰）
- `node scripts/check-debt-budget.js` → ✅ 五项指标全在基线内
- `pnpm exec eslint electron/ src/ --quiet` → **rc=0**
- `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` → **OK**（`新增记录 1 篇`）
- `node scripts/check-locale-button-name-sync.js` → PASS（本批不新增用户可见文案）
