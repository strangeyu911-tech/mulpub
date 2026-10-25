---
record: heartbeat-window-witness
task: 心跳判据补第二趟取证（witness）——「扫到的窗口里没有」不得读成「从来没跑过」，并把「cron 兑现了但那一次还没跑完」拆成两档
date: 2026-10-25
---

## 本次执行记录：心跳判据的第二趟取证——窗口截断不得被读成 NEVER_RAN（heartbeat-window-witness，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档中的"判据本体"那一半：改 `scripts/check-schedule-heartbeat.js`（判据）+ 同名行为锁 + 同名变异驱动，**不动** workflow/名单/注册表（上一刀已接线，本刀只是让它把话说准）。入口 worktree `mp-heartbeat-window-witness`，裸分支 `heartbeat-window-witness`，起点 `7c97f1f88`。中高风险前置门：`openspec/changes/heartbeat-window-witness/{proposal,design,tasks,specs/heartbeat-window-witness/spec}.md` 四件先落，其中 design §1 就是对本 PR 前身（#4305）那条回读评论的勘误 |
| 第一性原因（QM-5 ①） | ✅ | 不是"判据阈值不对"，是**采集坐标与结论不同源**。主查询读的是 `runs?per_page=100`（最近 100 条 run，不分 event），而结论说的是"有没有 completed 的 **schedule** run"。被 PR 触发很勤的作业（`dep-audit.yml` 同时挂 `pull_request`），100 条窗口实测只回溯 **13.4 小时**（最新 2026-10-25T02:56:16Z、最旧 2026-10-24T13:34:15Z，全部 `pull_request`）⇒ 它自己的 schedule run 被挤出窗口，判据把「我没看见」读成「它从来没跑过」。**引入点是上一刀本身**（`schedule-heartbeat-lock`，PR #4305，`git log -1 --format=%H -- scripts/check-schedule-heartbeat.js`），当时的意图是把"取不到数"与"取到且新鲜"分档，但"取到了、窗口不够长"这一格在四档里没有位置——不是漏写分支，是当时还没有繁忙作业来撞它 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：H1-H16 全部用**注入式单趟夹具**（`runsOf = () => ({ok:true, runs})`），"窗口被填满"这一形态在夹具里根本不可表示 ⇒ 结构性免疫；集成层：上一刀的现场回读是把 `NEVER_RAN … 采集条数=100` **逐字粘进评论**后，把它解释成"有 run 但从未有 completed 的 schedule run"的证据（信号在场、解释反了）；视觉/E2E 层：与本面无关；审查层：QM-6 那一轮评审 7 条里没有这条——它审的是判据的**分档语义**，而假阳性来自**采集层**。四类逃逸的共同点：没有任何一层在看"取到的条数是否顶到了上限" |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=测试场景缺失 + 审查盲区，且落点很具体：**存在性判据必须自带覆盖度读数**。凡按"最近 N 条"取样的判据，`N 条` 与"真的只有 N 条"在返回值里同形——这与 AGENTS 点名的「凡按目录里有什么迭代的门禁，永远看不见该有什么」是同一族，只是维度从"文件集"换成"分页窗口"。修法不是加白名单也不是放宽阈值，是把"窗口满/未满"升成一等读数，并把"看不见"转成一次**换坐标的重取**（witness） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 采集器返回 `truncated`（`runs.length >= perPage`，**绑 perPage 不绑死 100**），行上打印 `采集窗口=满/否`；② 主窗口零心跳时发一次**带 `event=schedule` 的 witness 查询**（换坐标才是重取，拿同一个截断窗口自证等于没查），三种答案分别落 `OK/LATE`（有心跳，且 `心跳来源=witness` 必须出声）、`NEVER_RAN`（witness 也零条 ⇒ 被证明而非假设）、`PENDING_FIRST/NEVER_COMPLETED`；③ 在途两档**共用该行自己的阈值**（周期 + 宽限），不新增常量：`age ≤ 阈值` ⇒ `PENDING_FIRST`（rc=0，自指那一格由它承接）、`age > 阈值` ⇒ `NEVER_COMPLETED`（rc=1，文件头第 4 条成因不得被放走）；④ witness 自己失明（`ok:false` 与 **抛错**两条分支）一律 `SCANNER_FAULT` rc=2，各有一条锁（H21 / H25），不塌回也不放行；⑤ 回归锁 `scripts/check-schedule-heartbeat.test.js` **30 条**（新增 H24-H30 + H17 两条 witness 投影断言 + H6 改写），全部注入式零出站；⑥ 采纳外部评审后补的两格：witness **自己的**窗口饱和也要报（`witness采集窗口=满`，H26/m32/m34），以及采集预算不得倒挂的引信锁（`timeout-minutes ≥ 作业数 × 2 趟 × 单趟硬超时`，H27/m33） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 变异驱动从 20 条扩到 **42 条**，新增 22 条逐格指名（m20-m41），`ALLOWED_MISSED` 仍为空 ⇒ 任何 MISSED 都是失败；② 驱动头部新增第 8 条硬约束（"新增档位时先问这一格读数由谁产，再问有没有一条锁只看这个读数"），来源是 m27 补 H24 **之前**实测 MISSED 那次；③ 命令行面 `witness=` 恒 0 这个**本刀自己制造又被自己抓到**的坏形态，被 m31 按原样钉住（"退回这个坏写法必须红"），不是靠注释提醒；④ 两份逐字相同的读形状校验收敛成一份（design §3）——驱动 m7 锚点命中 2 次并拒绝动手，是重复实现的机械症状，这条从"自觉"变成"锚点唯一性"这一格在守；⑤ 勘误落回上一刀那条回读评论（就地追加，不删原文），让下一个读它的人拿到的是现值；⑥ 外部评审的两条 Warning 落成代码 + 锁而不是欠账（H26/m32/m34 与 H27/m33），且采纳 i3 的过程中**实测到同一族的第二格**——LATE 出口原本不出声，一并修掉并由 m34 钉住；第三轮再落三条（H28/m36 空串不得静默退化成主查询、H29/m39 `perPage` 越界必须拒、m37/m38 两档在途各带 `状态=`），驳回的四条逐条给可重取反证；第四轮又落两条——i1（Critical，**成立**：在途档裸调用，未完成的 run 时间戳坏了会把异常抛出 `judge()`，补 `try/catch` + H30/m40）与 i2（预算只在 PR 侧可见，`采集最坏秒数=` 进首行、与 H27 同公式，m41 钉住），驳回四条各给指针（遗留 3、遗留 8、五条锚点漂移被驱动当场拒绝、Requirement 10 第三段） |
| 行尾与 diff 对账 | ✅ | 三个被改文件都是 `i/lf w/crlf attr/text=auto`，全部经"按当场 eol 逐行写回"的补丁脚本落地（`kb-splice` 系），改后 cr==lf==行数（判据 388/388、锁 422/422、驱动 466/466），且逐行断言"每个 CR 后面紧跟 LF"。两口径 numstat 见下方「现场读数」，逐文件相等、删除数不为 0 的每一行都属真实删除（重锚与改写）。新建 5 份 openspec/记录文件写成 LF（同仓既有惯例，`text=auto` 入库归一） |
| 接线棘轮 | ✅ | 本刀**没有新增测试文件**（只改既有三个），`scripts/check-unwired-tests.js` 的域不变；既有接线照旧：行为锁在 `quality-gate.yml:709`（Gate 2b14）与 `.github/workflows/schedule-heartbeat.yml:62` 各点名一次，判据本体在 `schedule-heartbeat.yml:58` 每日跑。变异驱动仍不入 CI（与上一刀同口径：`*.mutation.js` 不在 `check-unwired-tests.js` 的 `*.test.*` 域内，实跑分钟级、进 required 会把仓库锁死） |
| QM-1 打包 / QM-4 视觉 | N/A | 差量文件集实测只有 `scripts/check-schedule-heartbeat{,.test,.mutation}.js` 与 `openspec/` 五份文档——不触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 UI 文件，也没有新的视觉注册项 |
| QM-6 CCG 双模型外部评审 | **五轮跑完、逐条处置完毕，产物由工具署名 `tier=external`** | 本刀改的是 `scripts/check-` 前缀 ⇒ 收口矩阵的高危面，`closureNote` 不够格。实跑：`sh scripts/deep-review.sh` 五轮（heads `4d4f715b`→`0ac9a0f9`→`2a34a1ff`→`aabb6278`→`f08ed786`），critic=`claude` 每轮真交付 6-7 条、proposer=`opencode` 跨家族校验通过；**当场落代码 + 锁 7 项**（含第四轮一条成立的外部 **Critical**：在途档裸调用会把异常抛出 `judge()`），其余驳回项逐条给可重取坐标。终态产物 `.ccg/reviews/7c64faf4….json`：`status=self_play_resolved / tier=external / tierBasis=adjudicated-self-play / blocking=[] / confidenceWeight=0.6`，`evidence` 指向本 PR 评论 `#issuecomment-6394731179`（逐字收录第五轮 critique 原文 + 5 条四格处置）。**裁决那一档是自扮演，外部模型只交付了 critique**——这句写在处置小节里，不在这里换个说法 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

### 现场读数（全部当场重取，活数）

- 行为锁：`node --test scripts/check-schedule-heartbeat.test.js` ⇒ `# tests 30 / pass 30 / fail 0`
- 增量不破坏：`node --test scripts/check-schedule-failure-watch.test.js` ⇒ `# tests 13 / pass 13 / fail 0`；
  `node --test scripts/check-coverage-budget.test.js` ⇒ `# tests 26 / pass 26 / fail 0`
- 变异驱动终跑：`node scripts/check-schedule-heartbeat.mutation.js` ⇒ `SUMMARY CAUGHT=42 MISSED=0 PROBLEM=0 TOTAL=42 ATTEMPTED=42` + `RESULT=OK`，
  三条被改锚点（m1/m2/m8）重锚后仍逐条指名；`未预期但红` 只出现在 m2/m20/m23/m3/m17 那几条，如实打印不认领
- 真仓现跑（`node scripts/check-schedule-heartbeat.js --repo Colinchiu007/mulpub`，now=2026-10-25T03:25:59Z，
  **rc=1**；rc 一律取自不落管道的调用——同一条命令接了 `| head -10` 之后 `$?` 是 head 的 0，
  本仓点名的"链式管道吃 rc"在同一次取证里又踩到一次，改判前必须重取），rebase 到 `9c2632534` 之后重跑的读数：

  ```
  SCHEDULE-HEARTBEAT now=2026-10-25T06:42:00.697Z workflows=6 late=0 never=1 faults=0 thin=2 pending=0 never_completed=0 witness=2 slack_hours=8(default) 采集最坏秒数=240 判定=FAIL
  NEVER_RAN dep-audit-refresh.yml … completed_schedule_run=0 采集条数=3 witness_schedule_run=0 采集窗口=否
  OK dep-audit.yml … last=2026-10-19T08:08:10.000Z age_hours=142.6 阈值_hours=176.0 心跳样本=4 采集条数=100 心跳来源=witness 采集窗口=满
  OK schedule-heartbeat.yml … last=2026-10-24T09:03:09.000Z age_hours=21.6 阈值_hours=32.0 心跳样本=1 采集条数=2 采集窗口=否
  ```

  这三行是本刀的**全部三条主张**：① 假阳性消失且降级出声（`心跳来源=witness 采集窗口=满`）；
  ② 剩下的那条红是**被证明**的（witness 也报零条 schedule run，而不是"我窗口里没看见"）；
  ③ 自指是一次性的（巡检作业现在 `OK`，因为 10-24 那次已经 completed）。
- **同一把时钟下的改前/改后对照**（不是引用昨天的 CI 日志）：把主干那份判据 blob 取到仓库外的临时目录，
  连它 `require` 的同域依赖一起放好，再指同一个 `--root` 跑一次真采集：

  ```
  git show 9c2632534:scripts/check-schedule-heartbeat.js   → <TMP>/kb-ab/old-judge.js
  git show 9c2632534:scripts/check-schedule-failure-watch.js → <TMP>/kb-ab/（满足它的 ./require）
  node <TMP>/kb-ab/old-judge.js --repo <repo> --root <本 worktree>   # now=2026-10-25T03:28:07Z ⇒ rc=1
  … workflows=6 late=0 never=2 faults=0 thin=2                       # 没有 witness/采集窗口 这两格（旧版没这读数）
  … NEVER_RAN dep-audit.yml … completed_schedule_run=0 采集条数=100   # 截断假阳性（顶到上限那条）
  … OK schedule-heartbeat.yml … last=2026-10-24T09:03:09.000Z age_hours=18.4   # 旧版今天也判 OK ⇒ 自指是一次性的
  ```

  对照结论：**旧版 `never=2`、新版 `never=1 + witness=1`**，差的那一条恰是 `dep-audit.yml`；
  补一句口径说明（否则下面 04:43 那条 `witness=2` 会被读成前后矛盾）：采纳 QM-6 i3 之后，`witness=` 计的是
  **「这一行的结论由第二趟定案」**，所以在途两档与「witness 也证明零条」的 `NEVER_RAN` 都算进来；
  03:25 那次跑的是采纳前的实现，那时只数「心跳来自第二趟」，所以同一批作业报 `witness=1`。
  而 `schedule-heartbeat.yml` 在两版下**都是 OK** ⇒ 上一刀评论里"每天必红"那句挂在自指上是归因错了，
  真实每天红的是截断那一条。（顺带一格：这次第一次跑忘了 `--root`，旧版直接 `rc=2 SCANNER_FAULT`
  而不是"静默全绿"——判据域为空必须失明那条在旧版就有效，这次是被它自己拦住了一次。）
- 窗口截断的可重跑坐标（勘误与 design §4 用的就是这两条）：
  `gh api "repos/<repo>/actions/workflows/dep-audit.yml/runs?per_page=100"` ⇒ `100 / 最新 2026-10-25T02:56:16Z / 最旧 2026-10-24T13:34:15Z / 事件唯一值 pull_request`；
  同一路径加 `&event=schedule` ⇒ 4 条，全部 completed，最近 2026-10-19T08:08:10Z。
- 两口径 numstat（`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat`）**逐文件逐字相等**。
  三个被改脚本（受 CRLF 面影响的只有它们）：判据 146/24、驱动 186/12、锁 242/6。
  42 行删除全部属真实删除而非行尾改写：24 行是收集器重写成共用实现 + `main()` 的两处投影（witness 计数、LATE 行标签），
  12 行是 m1/m2/m8 三条变异重锚，6 行是 H6 的旧断言与注释改写。
  五份新增文档（design、proposal、spec、tasks、本记录）都是**纯新增**（删除列恒 0）；本记录自己的行数不写死，
  所以记录自身的行数不进上面那组数——写死它会让下一次补数变成一次假的行尾事故。
  `git add` 时 git 提示五份新文件 `LF will be replaced by CRLF the next time Git touches it`：
  那是 `* text=auto` 的 checkout 转换（入库 blob 是 LF），不是行尾被改；判据一律看两口径是否相等
- 提交后补跑的两条（取证顺序要求，`--head=HEAD` 必须在 commit 之后）：
  `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=false`（混合 PR，走完整门禁）；
  `node scripts/check-no-hot-carrier-edit.js --base=<merge-base> --head=HEAD` ⇒ 命中热写面 0（本 PR 不碰
  `CHANGELOG.md` / `01-docs/learnings.md` / `.quality-gates.md` / ledger，台账由聚合器搬）

### 遗留（不假装已闭合）

1. **`PENDING_FIRST` 今天没有真实现场**。巡检作业 10-24 已落下第一条 completed schedule run，
   实测直接 `OK`，所以这一档目前只有 H18/H19 两条锁 + 改判前的旧读数支撑。第一次真实兑现要等
   下一次扫描落在它自己那一次 run 的运行窗口内；届时若它不出现，先怀疑的是 witness 查询而不是这一档。
2. **`dep-audit-refresh.yml` 的红是正当的，但会自愈**：它的 `on.schedule:` 是 `17 3 * * *`，
   workflow 文件 2026-10-24T03:38:42Z 才创建，第一次到期 10-25T03:17Z（本次取数在 03:10Z，还没到）。
   **刻意不做**"给刚加的 cron 一次宽限"的判据：心跳作业的 checkout 没有 `fetch-depth`，
   `git log --diff-filter=A` 量到的是浅边界日期而不是添加日期，那样造出来的是一条会撒谎的豁免。
3. **窗口成本没有根治，只是变得可见**。真截断的作业多起来时正解是翻页聚合（GitHub 单页上限 100 已被
   `per_page` 取满），而不是加大单页；本刀只保证"顶到上限"会出声、并触发一次换坐标重取。
4. **witness 是"再查一次"，不是"多路并行"**。它只在主窗口零心跳时发（H22 的 `calls.length===2` 与
   "主窗口有心跳时一次都不发"两条断言钉住），所以繁忙作业的采集成本是 2 次而不是 N 次；
   但判据总耗时上限随之从 `COLLECT_TIMEOUT_MS × 作业数` 变成 `× (作业数 + 失明作业数)`，
   今天实测 6 条作业里没有一条走到 20s 上限，**没有余量证据**，真撞预算时要改的是聚合而不是超时。
5. **`conclusion` 仍是投影字段之一但不参与判定**（`JQ_RUNS` 带着它，只有 `created_at/status/event` 是必需字段）。
   保留它是为了让"跑失败"与"没跑"在日志里可分辨；如果下一刀要用它做判定，必须先回答"失败算不算一次兑现"
   并改上一刀定的口径（本刀明确不改）。
6. **`ccg-gate.js` 的「范围漂移」判据拿的是**全仓最新那份 `layer=plan` 记录**，与"我这次改的是哪个 change"无关**
   （现场：本次提交打出的漂移警告点名 8 个文件，比对源是 `.ccg/reviews/be84f449a192c39709178963be6cee9a848654d8.json`，
   `decidedAt=2026-10-20T18:35:39Z`、`plannedFiles` 75 条，全是**影视工程那条线**的方案文件）。
   任何不带 plan-review 的 follow-up 刀都会被判"超出方案范围"，而这句话本身不指向我做错了什么。
   **本刀不动它**（改它是改"谁来守门"），但它属真缺陷：判据缺一个"这条 plan 记录属于哪个 change"的归属键。
   已登记为后续任务，不在这里顺手修。
7. **敏感词告警的一条现场**：pre-commit 报「文档行命中敏感词 1 处（不计入模式判定）」，
   命中体是 design §4 的取数命令 `--jq '[.workflow_runs[]|select(.status…'`（jq 投影被认成凭证形状）。
   逐条确认**不是密钥**：那是一段只读 API 过滤表达式。判据本身已把文档行排除在模式判定之外，
   所以它只是可见性提示；留这一句是为了下一个读到同样告警的人不必再猜一次。

8. **witness 那一块的四个出口刻意留在 `judge` 里没抽函数**（第三轮评审 i3 提的"控制流过深"）。
   理由不是"没时间"：这一段刚连着改过两轮，六个出口各有**指名锁与指名变异**（H17-H29、m20-m39），
   抽函数会把红集整体重洗一遍，而那正是"锁与实现互不认账"的入口。真要抽，前提是先有一条
   **"行为不变"的对拍**（同一批 runs 喂给旧新两版，逐字段比较 `rows`），并单独一刀做。
## QM-6 处置（五轮；critique 由外部模型交付，裁决为工具署名的自扮演 + 公开复核）

| 轮 | 被审 head | 交付 | 进裁决 | 当场落代码/锁 | 驳回 | 最低分 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `4d4f715b` | 7 | 6 | i3 → `witness采集窗口` 出声（H26 / m32），采纳途中露出同族第二格 LATE 行不出声（m34）；i4 → 预算不倒挂引信（H27 / m33） | i1（`let stamps`，判据 194 行 + 真跑）／i2（首行无相邻断言）／i5（产物 pending 属流程时点）／i6（连带红如实打印不认领） | 5 |
| 2 | `0ac9a0f9` | 6 | 5 | — （该 head 随即被软重置重投取代，产物随内容寻址键一起作废） | — | 3 |
| 3 | `2a34a1ff` | 7 | 6 | i2 EVENT_RE `{0,32}` 与空串拒绝不同步 → 下界收 1 + 独立文案（H28 / m36）；i4 queued 与 in_progress 同形 → 两档各带 `状态=`（H18/H19 / m37+m38）；i6 `perPage` 越界被 GitHub 静默截断 → 构造期拒（H29 / m39） | i1（同一句 const 第四次）／i3（控制流 → 遗留 8）／i5（thresholdHours null 不可达：判据 182/184 顺序 + 打印 `.toFixed(1)` 会当场 TypeError） | 4 |
| 4 | `aabb6278` | 7 | 6 | **i1 Critical 成立**：`pendingScheduleAttempts(wit.runs)` 裸调用，未完成的 run 时间戳坏了会把异常抛出 `judge()` → 补 try/catch + 独立文案（H30 / m40）；i2 预算只在 PR 侧可见 → 首行 `采集最坏秒数=`（与 H27 同公式 / m41） | i3（限流：H22 已锁"有心跳时一次都不发"，根治在遗留 3）／i4（大函数 = 遗留 8）／i5（40 条变异的连带是覆盖充分，锚点漂移 5 次全被驱动当场拒绝）／i6（注入 verdict 无通路：`runs` 先整体过 `validateRunShape`） | 5 |
| 5 | `f08ed786`（终态） | 7 | 5 | **无新增成立项** | i1（const 第五次，同一判据 194 行否证）／i2（一条变异打断多格 = 同一不变式被多处消费，减锁会留下可测的洞）／i3（thresholdHours null 仍不可达）／i4（judge 实测 108 行 = 遗留 8）／i5（上界 240s 可算、每天自报、被 H27 拦在合并前） | 4 |

产物终态：`.ccg/reviews/7c64faf496d833343899b03e4cda5d08b380949fcd2b02b43ac1c689c57fa796.json`
⇒ `status=self_play_resolved`、`tier=external`、`tierBasis=adjudicated-self-play`、`blocking=[]`、
`confidenceWeight=0.6`、`performedBy=self-play`、`reviewBackends.critic=claude`（清单真源
`scripts/ccg-review-backends.list`，跨家族校验 proposer=opencode 通过），
`evidence=https://github.com/Colinchiu007/mulpub/pull/4432#issuecomment-6394731179`——
该评论逐字收录第五轮 critique 原文与 5 条四格处置，任何第三方可点开反驳。

**这条署名不是签名**：`adjudicationDigest` 任何填写方一条命令可自算，工具真正保证的是"本轮公开了一份可核的复核出处"。
裁决那一档由会话在引擎第三档出口里自扮演填写（`tier` 与 `evidence` 由 `scripts/ccg-review-writeback.js` 在驱动返回之后写，
不是手写）；外部模型只做了 critique，没做裁决——这一句按 AGENTS「不得说成工具产物/外部裁决」的口径写在这里。

**收敛形状**：交付量 7→6→7→7→7、最低分 5→3→4→5→4、**成立项从每轮 2-3 条衰减到第 5 轮 0 条**；
同一句 `const stamps` 被连提五次并五次以同一坐标否证，属 critic 只看 diff 不看落地文件的固定盲区，
不构成停手理由，但已计入"再多的轮也刷不出新事实"的判断——本轮之后不再自转。

## CHANGELOG 条目

# fix(gates): 心跳巡检的「没跑过」必须由第二趟取证证明——窗口截断不再读成 NEVER_RAN（heartbeat-window-witness）

- 定时作业心跳巡检不再把"最近 100 条 run 里没有 schedule run"当成"这个作业从来没跑过"：
  主窗口看不见时会再按 `event=schedule` 取证一次，并在读数里明说这次是换了坐标查到的（`心跳来源=witness`、
  `采集窗口=满`）。被 PR 触发很勤的每周作业（依赖漏洞审计门禁）从此不再每天报一条假红。
- 新增两个可区分档位：`PENDING_FIRST`（cron 已兑现、那一次还在跑 ⇒ 出声但不阻断）与
  `NEVER_COMPLETED`（排队超过这一行自己的阈值 ⇒ 红）。巡检作业第一次自己扫自己的那一天不会再假红，
  而"runner 长期排队永不完成"这类成因仍然会被点名。
- 第二趟取证自己取不到数或抛错时一律 `SCANNER_FAULT`（退出码 2）：工具的失明既不被读成"它没跑"，
  也不被读成"它跑了"。
- 维护者口径：判据"扫到的条数顶到上限"从此是一等读数；新增任何档位都必须同时给 judge 面与命令行面各一条断言
  （本刀实测到命令行面那格第一版恒 0）；在途两档还各带 `状态=`：queued 查 runner/配额，in_progress 查作业自己。

## learnings

### lesson: 「零命中」的结论必须连着采集坐标一起报，否则信号在场也会被读成反证

**现场**：`NEVER_RAN dep-audit.yml … completed_schedule_run=0 采集条数=100`。
上一刀（PR #4305）的回读评论里，这行是我**逐字粘进去**的，还在正文写了"weekly 那条 `采集条数=100`"，
然后把它解释成"有 run 但从未有 completed 的 schedule run"的证据。真实情况相反：
`per_page=100` 的窗口对 `dep-audit.yml` 只回溯 13.4 小时（全被 `pull_request` 占满），
而按 `event=schedule` 查有 4 条 completed run、最近一条 age 139h < 阈值 176h ⇒ 档位应为 `OK`。

**根因**：`采集条数` 当时是**装饰性读数**——它被打印出来，但不参与任何判定，也没有任何一条用例看它。
所以"顶到上限"这个事实即使写在脸上，判据与读它的人都会把它当成"作业很忙"的佐证而不是"我没看见"的告警。
**同一次误读还叠了第二个错误**：我把"每天必红"归因给巡检作业的自指，而自指只在首跑那一刻成立
（10-24 它落下第一条 completed run 之后同一判据对它转 `OK`）。频率词与成因的持续条件没有一起验算。

**可复用的 3 条**：

1. 任何"零命中/没有 X"的结论，**必须同时报采集坐标**（窗口右端、上限、过滤条件），并把
   "取到的条数 == 上限"升成一个会改变档位或至少会出声的读数。装饰性计数比没有计数更坏：
   它让读者以为已经看过现场。
2. 判据出现假阳性时，先问"能不能换**一个坐标**再取一次证"，而不是先问"能不能放宽阈值/加白名单"。
   本刀的 witness 就是换坐标（服务端按 event 过滤）而不是加超时、加大单页、放宽阈值——
   后三者都被实测否证并写进 design §5。
3. 结论里的"每天/一直/永久"这类频率词必须与成因一起被验时效。归因错成"永久"会让正确的修法
   （一次性现场该由"在途档"承接）被跳过，而真正天天红的另一条反而被登记成"真欠账"。
   公开写错的地方就地追加勘误、不删原文——原结论是历史事实快照，删掉等于把"我错过"也删掉。
4. **"改前 vs 改后"要跑在同一把时钟下，别引用昨天的日志当对照**。本刀的正解不是回到 10-24 那条 CI run
   去复述三条 `NEVER_RAN`，而是 `git show <主干 blob>` 把改前的判据取到**仓库外**临时目录（连它 `require`
   的同域依赖一起放好，否则 `./check-schedule-failure-watch.js` 解析不到），指同一个 `--root`、同一次真采集跑：
   旧版 `never=2`、新版 `never=1 + witness=1`，差集恰是 `dep-audit.yml`；同一分钟里两版对
   `schedule-heartbeat.yml` **都给 OK** ⇒ "自指造成每天红"是被这一次对照否证的，不是被我推理掉的。
   附带收获：忘了传 `--root` 时旧版直接 `rc=2 SCANNER_FAULT`（判据域为空那条失明闸真拦住了人，不是摆设）。

5. **采纳一条评审意见时，要把它的"判据形状"走完所有出口**。i3 的原话只是"witness 分支没检查 `wit.truncated`"；
   顺着这条改下去，连着露出三格：`LATE` 出口原本不带降级标签、两档在途也不带、`witness=` 计数把在途与
   "被证明的 NEVER_RAN"漏在外面。若只修被点名的那一格，日志里会留下一个"看起来已经出声"的表面，
   而三个出口的可见性仍然不一致——这与「禁令与存在性判据必须按语义位置切」是同一族：
   **按出口遍历，不按点名修**。同理，i6 的"空串与哨兵同形"也不是新坑，是 `EVENT_RE` 用 `{0,32}` 时就埋下的：
   正则的下界写成 0 就等于把"缺失"和"空值"合并成一个取值，合并的那一格永远不会有声音。
