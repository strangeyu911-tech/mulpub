---
record: qm6-exit-capability-probe
task: 把三格收口出口的可达性变成常驻读数，并让"这份读数被人删掉"当场能被发现了
date: 2026-10-23
---

## 本次执行记录：收口出口能力探针（qm6-exit-capability-probe，2026-10-23）

> **本刀不拆闸。** 用户 2026-10-23 裁决：按 `qm6-zero-human-closure`（PR #4304）写的顺序走 ——
> **探测器先于拆闸**。所以三格读数里有两格今天仍然报"墙在这儿"，那是**读数应当如此**，不是本 PR 没做完。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`scripts/` 判据本体 + 探针接线 + `quality-gate.yml` 一步 + `ccg-convergence-exit/tasks.md` 前滚恢复）。入口 `scripts/session-init.sh qm6-exit-capability-probe`（工作目录名 `mp-ccg-upheld-closure-exit`），起点 `HEAD == origin/main`，`rev-parse --abbrev-ref HEAD` == 裸分支名；四件套 `openspec/changes/qm6-exit-capability-probe/{proposal,design,tasks,specs/…/spec}.md` 先落 |
| 第一性原因（QM-5 ①） | ✅ | **不是"探针不够聪明"，是一次静默撤销让它开始说假话。** 2026-10-20 两笔相邻合并：`4d7c32535`（PR **#4067**，14:36+08）把探针改成**现读** vendor 能否表达外部复核、旧「不可达」结论不再写死；5 小时后 `8fdd617b2`（PR **#4062**，一个 s2v 错误码修复，19:47+08）携带评审前的旧副本 squash 落地，**把 #4067 在三个文件里的改动整段删空**（`git show --stat 8fdd617b2` 当场读数：探针 `+1/−21`、探针测试 `−25`、`ccg-convergence-exit/tasks.md` `−31`；且 `git log -S"externalReviewCapable"` 在这两个提交上各命中一次 = 一加一删）。今天 `git log 4d7c32535..HEAD -- <该 tasks 文件>` 只有 `8fdd617b2` 一笔 ⇒ 撤销是**唯一**的后续修改，恢复即取 #4067 那一版原文 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：**没有逃逸路径可言——那条会红的断言与被删的实现是同一批文件里的同一次删除**，`node --test` 看不到"少了一个用例"（它只数跑掉的用例数，不数"本该有用例"）；CI 层：`Gate 2b6` 照跑探针测试，9 条全绿，红的必要条件（谓词缺失）不产生任何失败；判据层：探针自己那格 `--json` 仍报 `verdict=AS_EXPECTED / problems=[]`，而它的 stdout 结论句是**假的**（vendor 当场可读：`/function externalReviewSatisfied/` = true）；审查层：diff 里 22 行删除挂在一个 s2v 标题下，评审的人没有理由去查"这个文件是不是别人的" |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=测试机制缺失（不是代码缺陷）：**"检测某能力存在"的锁，不得与它守护的实现同文件、同批可删。** 这是本仓「装饰性门禁」家族的新落点：前几种是"锁恒真""捕获不判定""断言对方源码出现过某读法"，这一种是**"锁与实现同生命周期 ⇒ 撤销即失明，且失明长得像通过"**。第二条同型缺口：结论字符串写死在 stdout 里，**生成它的那份读数是可选的** —— 所以#4067 恢复回来也仍会再次说谎，直到结论变成读数的一元函数 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `scripts/qm6-exit-capabilities.js`：三条**纯谓词** `externalReviewCapable` / `upheldExitCapable` / `toolSignatureCapable`，返回值是**三档** `true / false / 'unknown'`，`unknown` 与 `false` 绝不合并（"vendor 把函数改名了"和"这条出口确实不存在"是两件事）；`readCapabilities` 对越界返回值**当场抛错**，`conclusionLine(readings)` 生成结论。② 探针改为 `require` 该模块并只输出**生成出来的**结论行；三处被撤销回来的写死句全部删除。③ 前滚恢复 `openspec/changes/ccg-convergence-exit/tasks.md`（取 #4067 原文，一字未改），并在同一文件**追加 §10.7 现状补记**（历史原文不改写，只声明现状，含"今天 P9 与 §10.4 的 P9 编号复用、语义不同"这条以免误导）。④ 契约锁住在**第三个文件** `scripts/qm6-exit-capabilities.test.js`：**20 条**（A1-A20），A1-A5 每条谓词一对夹具（两版实现答案必须不同）、A6 失明档不得输出结论句、A7 越界返回值必抛、A8 结论每句可追溯到某个布尔（三向各翻转一次）、A9 真源码档**只断言"读得出"并把读数打出来**（刻意不把今天那两面墙钉成契约——那会让将来真加出口的 PR 被自己的锁咬住）、A10 探针必须接读数器且不得再出现那句旧结论、A11 接线锁（按**剥掉注释后**的可执行正文点名）、A12 导出面 + `git ls-files` 追踪态（判忽略看回显模式不看 rc，`!` 反选也返回 0）、**A13-A15 行为档**（真调 `blockingFromAdjudication`，两版实现答案必须不同；"无凭证那份必须阻断"这道防呆单独测；交叉比较的两条不 ok/一致档逐个钉；探针必须把行为档与比较都接上）。⑤ **行为档已落地**（动笔时规划的 `vm` 编译被否证，实际用 `require`，理由见 design §1.2）：`upheldExitBehavioral` + `crossCheckUpheld` 两路互不代替，不一致 ⇒ rc=1；另补一道"vendor 在位但行为档取不到数"的守卫堵"两路全瞎仍报一致"（P11 真跑证明，n18 摘掉守卫即红） |
| 变异反证 | ✅ | 驱动 `scripts/qm6-exit-capabilities.mutation.js`，五靶子（读数器 / 探针 / workflow 接线 / 探针测试的白名单 / **驱动自身**），终跑 **`SUMMARY CAUGHT=28 MISSED=0 PROBLEM=0 TOTAL=28 ATTEMPTED=28`**、`RESULT=OK`，两套收集数 `20 / 11`；`ALLOWED_MISSED` 留空。六条现场收获：① **n3 首跑 MISSED**，根因不是变异没写对而是**我自己那条夹具没牙**——把 6 行注释插在"解除臂与 push 之间"，任何窗口读法都还看得见那条臂 ⇒ 改成插在"if 与解除臂之间"之后 n3 才 CAUGHT（这条记进 A3 的注释，防它再被"顺手改回去"）。② n11（摘掉探针与读数器之间的 require 行）红集含**跨靶子的三条 P1/P3/P4**：探针起不来 ⇒ 它自己的测试也红，如实打印不认领为设计。③ n15/n17（行为档失明族）的红集**同时**含 P1/P3：那两条把行为档变成 `unavailable` 之后，新守卫按设计让探针 rc=1，于是"期望 rc=0"的既有测试一起红 —— 这是**防御重叠**不是设计错误，如实列在"未预期但红"里，不改期望值去迁就。④ `msanity`（把 A5 的期望值改成明显错的数）必须红 ⇒ 它测的不是锁的牙，是驱动有没有真的在读 TAP。⑤ **QM-6 第一轮评审 i2/i5 逼出一个我自己看不见的形状错误**（详见"QM-6 处置"）：行为档 B 份夹具写的 `resolution` 三格 vendor **从不消费**，"带凭证仍阻断"是在空形状上测量 ⇒ 补正控 `externalReviewReceiptLive` + 双形状夹具 + A13/A16 + 变异 n19/n20；n21 则把"词表里加了 `externalReview` 但无人量"这一格钉住（A2 补第三种在位夹具）。⑥ 加正控后 `if (typeof fn !== 'function') return 'unavailable';` 这一句在两个函数里各有一份 ⇒ **n15 的锚点命中数从 1 变 2，被驱动的命中数断言当场抓住**（不是它坏了，是我改的实现让锚点变模糊）；处置是把锚点带上函数头，而不是把命中数要求放宽。**靶子数的演进链（不拿旧数冒充新基线）**：28（第一刀）→ 34（第四格补花括号形态 + n34）→ 42（副作用差量与沙箱：A23/A24 + n37-n41）→ 50（本支：判据反转的 n43-n49 + `expectGreen` 执行体的 n42）；每一档的终跑读数写在各节「现场读数」里，最新一档见「第 5-7 轮 follow-up」 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **检出处与实现处分离**：能力谓词与契约锁分住两个文件，且契约锁由 `Gate 2b6` 的**可执行正文**独立点名（A11 自证这条接线在位，防止"接线被顺手摘掉"）；② 结论字符串不再允许是字面量 —— 任何一条分句都必须能追溯到一个布尔，两个方向（写死成可达 / 写死成不可达）各有变异红；③ 三档返回值 + 越界即抛，把"实现坏了"和"没有出口"在读数上分开；④ 恢复被撤销的 `tasks.md` 原文并**追加**而非改写现状节，把"编号复用、语义不同"这种会误导下一个会话的细节写进去；⑤ 本次事故的坐标（两个 commit sha、三处 −31/−25/+1−21 的 stat、可重取命令）逐条写进执行记录与本 PR，让"下一次谁把某个能力文件整段删掉"能被同样方式当场归因 |
| 行尾与 diff 对账 | ✅ | 五处 CRLF 面改动（`ccg-convergence-probe.js`、`ccg-convergence-probe.test.js`、`quality-gate.yml`、`ccg-convergence-exit/tasks.md`、`.gitignore`）全部用"按当场 eol 逐行写回"的脚本插入，未统一回写；写前先算 cr/lf 并要求"每个 CR 紧跟一个 LF"且**末行必须已有行尾**，不合即拒绝动手。写后逐文件验 CR 守恒：探针 `256→257`（+1 行守卫）、探针测试 `242→258→292`（先 +16 的 P10、再 +34 的 P11，两次各自校验）。两口径对账（`git diff --cached --numstat` 对照 `--ignore-cr-at-eol --numstat`，13 个文件）：**逐文件完全相同，drift=0** —— 探针 `52/4`、探针测试 `76/1`、workflow `5/0`、`.gitignore` `3/0`、`ccg-convergence-exit/tasks.md` `55/0`。上一版记录里那条"tasks.md 差 1 行"已消失，成因如实记在这里以免被读成"漂移被修好了"：那次差异是恢复出来的 #4067 原文**末行没有行尾**、本次写入时补了行尾，`git diff` 把它记成一删一增；本轮取的是"末行必须已有行尾"这一档，所以两口径一致，**不是判据变宽**。新建的 `qm6-exit-capabilities*.{js,md}` 六个文件是 LF（同仓新建脚本惯例），blob 侧 `i/lf w/lf`，不涉行尾转换 |
| QM-1 打包 / QM-4 视觉 | N/A | 差量文件集实测只有 `scripts/qm6-exit-capabilities{,.test,.mutation}.js`、`scripts/ccg-convergence-probe{,.test}.js`、`.github/workflows/quality-gate.yml`、`.gitignore`、两个 `openspec/` 目录下的 md 与本记录 —— 不触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | ✅ 已闭合（本支现头那篇产物的 `tier` **由工具经水位出口署名**；第一刀的 `tier` 由会话手写，两段分别见「QM-6 处置」与「续跑：第 4-7 轮」） | 三轮真跑：critic=`claude` / proposer=`opencode`（真源 `scripts/ccg-review-backends.list`），第 3 轮收敛 `status=self_play_resolved`、`blocking=[]`、六条逐条驳回并公开处置；写回器拒签读数 `reason=backend-mismatch`（五条合取只欠 `performedBy`）⇒ `tier=external` + `evidence=PR #4326 评论` 由会话手写并在 `closureNote` 里逐字声明。**follow-up 续跑到第 7 轮**：`30a4cce9a` 上五条逐条填裁决全 `dismissed` ⇒ 复用存档跳过模型调用 ⇒ 写回器一次通过合取与水位五件，签成 `tier=external / tierBasis=adjudicated-self-play / evidence=PR #4413 评论`；第 4/5 轮的裁决文件未填、产物随 squash 退出变更集 ⇒ 那两轮只算「发现项被后续实现吸收」，不读成闭合 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

### 现场读数（全部当场重取，活数）

- 契约锁：`node --test scripts/qm6-exit-capabilities.test.js` ⇒ `# tests 20 / pass 20 / fail 0`
- 探针既有锁（含本刀新增的 P9 反向夹具、P10 行为档取数、P11 行为档失明）：`node --test scripts/ccg-convergence-probe.test.js` ⇒ `# tests 11 / pass 11 / fail 0`
- 探针本体：`node scripts/ccg-convergence-probe.js` ⇒ rc=0，新增第 ⑤ 行
  `⑤ upheld 出口交叉验证：结构=false 行为=false 正控(凭证是否被 vendor 消费)=true ⇒ 两路一致：这条出口不在位`，结论行变成
  `…只有 ③(maxRounds→self-play) 可达（要把分数抬到 8 才另有出口）；高危域条目：填齐外部复核三格后可解除（vendor 已能表达）；诚实标 upheld ⇒ 永久阻断（机制缺口，非本 PR 缺陷）；工具署名：自扮演收口永拿不到 tier=external（须人工补字段或全驳回）`
  —— 同一台机器、同一份 vendor，**改之前它打印的是"self-play 对 crypto 项无条件计阻断 ⇒ 不可达"**，那句是假的
- `--json` 档新增四组读数：`exitCapabilities={externalReview:true,upheld:false,toolSignature:false,upheldBehavioral:false,receiptLive:true,unknown:0}`、
  `capabilitySource={driver:…,writeback:scripts/ccg-review-writeback.js}`、`upheldCrossCheck={ok:true,note:"两路一致：这条出口不在位"}`、`conclusion=…`
  —— `receiptLive` 是正控读数：它证明本探针写的那份凭证**确实被 vendor 的某个分支消费**；为 false 时行为档一律报 `unavailable` 而不报 `false`
- 变异驱动（在**干净基线**上跑，驱动的脏基线闸因此也被实跑过一次）：`SUMMARY CAUGHT=28 MISSED=0 PROBLEM=0 TOTAL=28 ATTEMPTED=28 / RESULT=OK`，收集数 `qm6-exit-capabilities.test.js=20 ccg-convergence-probe.test.js=11`
- workflow 结构：`files=17 violations=0`；`check-step-failfast`、`check-unwired-tests`、`check-text-encoding-integrity`、`check-doc-abs-paths`、`openspec-sync-check`（`387 tasks, 100 active changes, 243 archives`）逐条 rc=0（终版数字见合并前回读）
- 本机门禁批跑（15 条逐条 rc，2026-10-23 本 worktree；重取＝在仓根逐条点名跑下面列出的那 15 个 `scripts/` / `.github/scripts/` 判据）：
  **14 条 rc=0**，1 条 rc=2 —— `scripts/check-schedule-heartbeat.js` 在无 `GITHUB_REPOSITORY` 的本地 shell 里
  按设计走"采集器不可用"档（`SCANNER_FAULT 采集器不可用：GITHUB_REPOSITORY 不可用或形状不合：undefined`），
  那是上一刀（#4305）定的三档退出码在本地如实失明，**不是本 PR 引入**，也不得靠"本地把它跳过"交差：
  它由自己的 16 条注入式用例（`check-schedule-heartbeat.test.js` ⇒ `# tests 16 / pass 16`）与 workflow 侧的 env 承担。
  其余读数：workflow-structure `files=17 violations=0`；step-failfast OK；unwired-tests OK；
  test-egress-guard `枚举测试面=18 已接守卫=14 欠账=4/4`；microtask-spin `1633 个测试文件 0 处自旋`；
  doc-abs-paths `counts=1161 domain=5500 files=561 canJudge=true` PASS；
  record-qm5-rows `记录=358 欠账登记=27 未登记缺行=0`；gate-record-debt OK（213 篇整块无 `远程同步` 行属历史缺口，可见项不拦截）；
  text-encoding `判据域 11730，现场问题 2，基线登记 6`（无新增）；no-brand-residue `12078 个 tracked 文件` PASS；
  hot-carrier `MODE=advisory 命中热写面=0 判定=PASS`；changelog-growth `598 -> 598 条，字节 3134113 -> 3134113`；
  openspec-sync `387 tasks, 100 active changes, 243 archives`；schedule-failure-watch `workflows=17 scheduled=5 list=10 未覆盖=0 判定=OK`
- 事故坐标（可重取）：`git show --stat 8fdd617b2`、`git log -S"externalReviewCapable" --oneline -- scripts/ccg-convergence-probe.js`、
  `git log --oneline 4d7c32535..HEAD -- openspec/changes/ccg-convergence-exit/tasks.md`（只有 `8fdd617b2` 一笔）
- 那堵墙今天的证据链（不在本刀拆）：PR **#4305** 现场 `blocking=[]`、`status=self_play_resolved`、四条裁决全部 dismissed，
  写回仍报 `reason=backend-mismatch detail=performedBy="self-play" 期望 "claude"`
  ⇒ **触发条件是"收口来自哪条出口"，不是"有没有 upheld"**；这条读数否证了此前对这条链的描述，已写进 #4305 执行记录 QM-6 节

### 第四格（2026-10-24 追加：`require` 不是无害动作 + 两条锁从机器局部状态解绑）

> 触发方式是**别人改了我依赖的机器状态**，不是我发现判据不够。这类"外部事件把锁打回原形"的
> 处置纪律是：先判"红的是判据量出了缺陷，还是锁的前提没了"，前者记读数、后者改锁的**前提**，
> 两种都不得靠"把本机环境修回去"交差（那正是把锁重新变成装饰的做法）。

- **第一性原因（QM-5 ①）**：`behavioralUpheldExit()` 无条件 `require(vendor 驱动)`。
  本机那份驱动是**另一个会话的 WIP**（`~/.claude/skills/adversarial-review-loop` 是个 git 子模块，
  11:48 被写入 104/27 行），末尾从 `if (require.main === module) process.exit(main())` 变成裸
  `process.exit(main())`，整张 `module.exports` 也没了。require 即执行模块体 ⇒ **别人的整条评审流水线跑进本进程**
  并 `exit` 掉探针。现场证据：`--json` 档 stdout 变成「判定记录按 diff 内容寻址命中…」，`JSON.parse` 报
  `Unexpected token '判'`（P1/P10 两条红就是这个）；P3 的红文案直接打出那段别人的输出。
  **实际损害不止于读数**：那次误执行把本 PR 变更集里的一份判定产物 `.ccg/reviews/96dea741….json`
  从 `status=pending / tier=unknown` 覆写成 `status=skipped_by_mode` 并抹掉 `tier` 键
  （`git diff` 逐字可见，已按 HEAD 精确还原该单一文件 —— 不是宽目录 restore）。
- **逃逸分析（QM-5 ②）**：单元层无逃逸 —— P1/P3/P10/P11 四条当天就红了，红得对但**归因错**
  （读起来像"vendor 变了所以探针该改"，实际是"探针不该执行 vendor"）；
  判据层：探针本体 `rc` 被被劫持的进程覆盖，`--json` 的机器合同（stdout 只能是 JSON）被第三方破坏，
  而**没有任何一条锁在看"探针有没有执行被测量对象"**；审查层：diff 挂在"rebase 后本地判据红了"这个标题下，
  评审的人看不到"一次 require 覆写了评审产物"这件事。
- **系统性漏洞（QM-5 ③）**：类别=**测量工具把"执行被测对象"当成无害动作**，且**把机器局部状态当契约前提**。
  这是本仓「装饰性门禁」家族的又一种落点：一条锁可以既精确又是绿的，同时从未在它声称测的那一格上工作过
  （P10/P11 的成立前提是本机那份未提交补丁，在别人机器上整条早退、连红都不产生）。
- **修复 + 回归保护（QM-5 ④）**：① `driverLoadability()` 四成因分开报（`ok / no-exports / executes-on-require / unreadable`），
  判据只盯"调用 `main()` 那一句在不在 `require.main` 守卫里"；② 探针 require 前先问它，不可安全加载 ⇒ **不执行**
  并如实打 `behavioral=skipped(<成因>)`；③ 守卫分两档（按设计的跳过 vs 真失明），成因表由读数器唯一持有；
  ④ A9 改蕴含式（声明了就读得出、没声明就报"读不出"），P10/P11 改自建夹具并新增 **P12**
  （未守卫驱动一律不得被 require：断言 marker 文件不存在 + 加回守卫的对照 + "按 CLI 直跑必须写得出 marker"的负控）；
  ⑤ 夹具把"加臂 ⇒ 两路同时翻在位"这一格第一次变成**可跑**的（以前只能等真 vendor 真加臂，等于永远没测）。
- **防止再次发生（QM-5 ⑤）**：新增变异 n28-n33（摘掉判据 / 判据退回"看见 process.exit 就禁" /
  把 `no-exports` 混进跳过表 / 交叉文案塌回 `no-vendor` / 探针侧早退失效 / 摘掉成因表接线），
  每条指名要红的用例；A15 加**顺序锁**（可加载性判定必须排在 require 之前、成因表必须排在"决定 rc"之前），
  因为"两个调用都在文件里"放过得了"顺序反了"。design §1.2 与 §1.4 把"require 取代 vm"这条决定的
  **两次**现场否证都写在案，不留"当时为什么这么选"的空白。

**第四格的现场读数（2026-10-24 深夜当场重取；上面「现场读数」那节是前三格在旧基线上的事实，保留不改写 —— 这是演进链，不是覆盖）**

- 契约锁：`node --test scripts/qm6-exit-capabilities.test.js` ⇒ `# tests 21 / pass 21 / fail 0`
- 探针锁：`node --test scripts/ccg-convergence-probe.test.js` ⇒ `# tests 12 / pass 12 / fail 0`
  （P10/P11/P12 这三条现在**不依赖本机 vendor**，因此在 CI runner 上也执行 —— 那正是本格的目的）
- 探针本体 `node scripts/ccg-convergence-probe.js` ⇒ rc=0，⑤ 行现为
  `结构=false 行为=unavailable 正控(凭证是否被 vendor 消费)=unavailable 行为档跳过原因=executes-on-require ⇒ behavioral=skipped(executes-on-require)`；
  `--json` ⇒ `exitCapabilities={externalReview:"unknown",upheld:false,toolSignature:false,unknown:1,upheldBehavioral:"unavailable",receiptLive:"unavailable",behavioralSkip:"executes-on-require"}`、
  `verdict=AS_EXPECTED`、`problems=[]`
- **① 那一格今天的读数是 `unknown`**（本机那份补丁被改写之后）。这不是回归，是读数如实变了：
  三档返回值在这里第一次派上用场 —— 探针没有把"我的工具读不出"折叠成"这条出口不存在"，
  结论行自己改口成 `高危域条目：读不出（vendor 缺席或被改名，不得当成无出口）`。
  上面那节写的 `externalReview=true` 是**补丁在位时**的现场，原文保留
- 变异驱动终跑（先把靶子文件验回与 HEAD 逐字节一致再跑）：n28-n33 那一轮
  `SUMMARY CAUGHT=34 MISSED=0 PROBLEM=0 TOTAL=34 ATTEMPTED=34` / `RESULT=OK`，
  收集数 `qm6-exit-capabilities.test.js=21 ccg-convergence-probe.test.js=12`；
  ⚠️ **该读数是 i3 修法落地之前那一轮的**：修完花括号形态并追加 n34 之后靶子数是 35，
  终值在下一节"第 4 轮评审落地后"补记 —— 不拿旧数冒充新基线（本仓「证据数字必须在最终基线上重跑后再写」）；
  `未预期但红`若干条如实打印（n32/n31 连带 P1/P3、n28 连带 A15 等），不认领为设计、也不放宽期望

- 途中一次真实失效（不掩盖）：**n33 首跑判 PROBLEM 而不是红** —— 安装脚本把 `from` 改成"当场取整行"，
  而 `to` 仍是我手写的半截 ` && false` ⇒ 整行被替换成语法坏、套件 LOADFAIL，驱动报
  `变异把语法改坏了：…:199`。这条红**不在我要问的那一格上**，所以不写进反证账；
  改成完整一行后 n33 才成为"摘掉接线 ⇒ A15 + P11 各指名一条红"（同 5.2b）
- **n32 有外部副作用（本刀新发现的驱动盲区，登记为遗留 9）**：把探针的早退改成 `if (false)` 之后，
  那一轮变异在本机**真的**把未守卫的 vendor 流水线跑了进来 —— 现场证据是判定产物
  `.ccg/reviews/4d4ed2d4….json` 被覆写（`pending/tier=unknown` → `self_play_pending`、`tier` 键消失）
  以及 `.adversarial/` 下多出目录。驱动的还原范围只含靶子文件，管不到这些产物；
  每次跑到 n32 之后都要 `git checkout HEAD -- <那一个文件>` 精确还原（本轮已还原两次：`96dea741…`、`4d4ed2d4…`）
- enforce 读数：`修订本分支记录 1 篇` ⇒ 记录面 OK；第四格差量**不命中** `.github/workflows/`
  （没动 workflow）⇒ 本 PR 命中的高危面前缀为**零格**，出口②（带轮次标记与逐条处置的 `closureNote`）在本格合法；
  唯一欠账是新 dual 产物 `4d4ed2d4….json`（`mode=dual / status=pending`）⇒ 见「QM-6 处置」第 4 轮
- 行尾两口径对账（`--numstat` 对照 `--ignore-cr-at-eol --numstat`）：第四格 11 个文件 **drift=0**；
  合并后整支 17 个文件也 `drift=0`。第四格动的四个 js 全在 CRLF 面上，一律"按当场 eol 逐行写回"，
  并断言 CR 增量 == 新增行数（LF 面上该等式不成立，见记忆「补丁脚本的字符/外壳陷阱」第 11 条）

### 第 5-7 轮 follow-up（2026-10-25 追加：判据方向反转，以及我自己驳回理由里那句错话）

**QM-5 ① 第一性原因**：加载安全判据 `driverLoadability` 是一条**只认一种坏形态的黑名单** ——
`MAIN_INVOCATION` 精确匹配 `process.exit(main())`，`MAIN_GUARDED` 精确匹配"守卫 + 那一句"。
黑名单的宽度 = 已知坏形态的枚举，**枚举之外一律放行**。第 7 轮评审 i3 说"正则严格 ⇒ 会把合法形态误判成禁止执行"，
我在裁决里回了一句「apply / call / 两行式 / 裸调用只会落到保守侧，**不存在误放行**」—— 这句话我**没测过**，
它是从"我的正则只匹配那一种形状"反推出来的。把形态逐个喂回判据的实测读数：

| 顶层形态 | 旧判据读数 | 应当 |
| --- | --- | --- |
| `process.exit(main())` | executes-on-require | 一致（唯一被认出的那一种） |
| `process.exit(main.apply(null, []))` | **ok ⇒ 探针会 require** | 禁止 |
| `process.exit(main.call(null))` | **ok ⇒ 探针会 require** | 禁止 |
| `const c = main(); process.exit(c)` | **ok ⇒ 探针会 require** | 禁止 |
| 裸 `main();` | **ok ⇒ 探针会 require** | 禁止 |
| 守卫块里先 `setup()` 再 exit | **executes-on-require**（误判保守） | 可加载（require 时守卫块根本不执行） |

⇒ 四种真会执行的形态全部放行，而放行的后果正是本刀立项要消灭的那次事故（2026-10-24：探针替别人
跑完整条评审流水线，并覆写了本 PR 变更集里的一份 `.ccg/reviews/*.json` 判定产物）；
同时一种合法形态被误判成禁止。两侧都错，且错的方向相反。

**QM-5 ② 逃逸链**：单元层 A21 当时的夹具形状 = 实现形状（只测那一种坏形态），黑名单漏掉的形态
在测试里**结构性不可表示**；集成层 P12 同形同因；审查层是**我自己** —— 把未实测的推断当结论写进裁决。

**QM-5 ③ 系统性漏洞**：判据方向本身。任何"认危险/认安全"的守卫只要写成**危险侧的枚举**，
新增形态就默认放行；写成**安全侧的枚举**（先证明这一段不会执行，其余一律拒绝）才会把新形态默认关在门外。

**QM-5 ④ 修复 + 回归保护**：判据反转为「先剥安全区，再在剩下的顶层区找 `main` **被调用**」
（依次剥：守卫整段 / shebang·注释·串·正则 / 任何 `function` 的花括号体；模板串正文剥、`${}` 插值段**递归保留**），
任一形态剥不动 ⇒ 新档 `unparsable-driver`。回归锁在 `scripts/qm6-exit-capabilities.test.js` 的 A21：
六种执行形态各一条"必须禁止加载"，守卫块内的同形各一条"必须回到 ok"，注释/串/正则/函数体内的
假调用各一条"不得算执行路径"；`sandboxEnv`/`greenViolations` 之外，靶子 `n43`-`n49` 逐段摘掉剥离动作，
每段一条指名红。`expectGreen` 那条采纳项另加 `greenViolations` 独立函数 + A25 直接调它 + `n42` 把它改成恒空。

**QM-5 ⑤ 防再发**：① design §1.2 第 3/4 条把"黑名单 ⇒ 枚举外放行"与"保守侧出口必须可归因"记成来路；
② learnings 新增一条 lesson（**驳回评审意见时写下的事实句，也要和采纳项一样实测**）；
③ 本支实测到的两格"保守过头"（对**字符数组**用 `a.indexOf('*/')` 恒 -1；shebang 首行的 `/` 被当正则起点）
说明**保守做过头等于把锁换成另一个方向的失明** ⇒ `unparsable-driver` 独立成档，不并入 `executes-on-require`。

**现场读数（本支，活数）**

- 判据反转前后的同一组形态读数即上表；探针脚本写在系统临时目录下一个一次性文件里（`<TMP>/kb-i3-shapes.cjs`，不入仓），
  等价形态已全部转成 A21 的**仓内夹具** —— 入仓的是夹具不是脚本
- 反转过程中自己复测到的两处 bail（都不是评审提的）：`stripCommentsAndStrings` 里
  `a.indexOf('*/')` 对字符数组恒返回 -1 ⇒ 一切含块注释的文件一律 `unparsable-driver`；
  shebang 首行 ⇒ **所有**带 shebang 的驱动整体退化（真实 vendor 正首行就是 `#!/usr/bin/env node`）。
  两条各配夹具（A21）与靶子（`n48` 把 `${}` 插值段当正文一起剥、`n49` 不再处理 shebang），均实测指名红
- 两套锁：`qm6-exit-capabilities.test.js=25`、`ccg-convergence-probe.test.js=12`，合跑 `37/37` 绿
- 变异驱动终跑（靶子 50 条，`--allow-dirty` 那一条闸也被实跑：本轮的"原始内容"就是这份未提交状态，文案如实点名三个靶子文件）：
  **`SUMMARY CAUGHT=50 MISSED=0 PROBLEM=0 TOTAL=50 ATTEMPTED=50` / `RESULT=OK`**，收集数
  `qm6-exit-capabilities.test.js=25 ccg-convergence-probe.test.js=12`；`未预期但红=14` 条如实打印（红的是别条用例的防御重叠，不是本条靶子的期望），不认领为设计也不放宽期望。
  ⚠ 这一轮**之前**有一次作废的跑：我在跑的过程中改了执行记录，`checkSideEffects` 当场把它报成
  `PROBLEM id=side-effects`（`RESULT=FAIL`）—— 那是**我自己并发写仓库**造成的真副作用，不是靶子留下的；
  判据不区分这两种来源（它只能说"靶子之外有新脏文件"），所以正解是**跑驱动期间不写仓库**，
  而不是给差集加白名单。这一格连同修法写进遗留 9 的"残留"旁边（同一决策面）
- 探针：rc=0，`behavioralSkip=executes-on-require`，而且这个读数现在**可归因** ——
  `nonGuardedTopLevelRegion` 在真 vendor 上剥完剩 6574 字符，`findMainCall` 命中下标 6565，
  上下文就是守卫块之后那一句裸 `process.exit(main());`。
  对照两个历史读数：反转前它靠黑名单"恰好匹配"给出同一档；加 shebang 处理之前它报的是 `unparsable-driver`
  —— 三档读数的**动作相同（不 require）但成因不同**，这正是必须分档的理由

### 遗留（不假装已闭合）

1. **双路读数只覆盖 `upheld` 这一格，另外两格仍是单路。**
   - `externalReview`：vendor **也导出了** `externalReviewSatisfied`，所以这一格**可以**做与 `upheld` 同形的行为交叉
     （喂"三格齐备/缺一格"两份条目，断言答案不同）。本刀没做，因为立项动机是 `upheld` 那格的说谎形状；
     下一步接这里最省 —— 谓词、交叉函数与守卫都是现成的，只差一份夹具。
   - `toolSignature`：**这一格的边界是结构性的，不是偷懒**。唯一能真跑的路径是 `applyWriteback()`，
     它真的会改 `.ccg/reviews/<key>.json` —— 在探针里调它等于让一条常驻判据去写评审产物。
     所以它只能由"两版源码夹具 + 恒 true 变异(n5)"守，且代码注释里已就地写明这个取舍
     （`qm6-exit-capabilities.js` 的 ③ 段），不要下一个会话把它当遗漏"顺手补上"。
2. **拆闸不在本刀**：`upheldExit=false` 与 `toolSignature=false` 两格今天仍是墙。按 #4304（PR #4304，OPEN、只交付规格）的顺序合同，
   拆闸前还需要它的 D3 判据回归语料差分（"判据被改宽必须当场红"）—— 那台探测器与本刀的探测器**不是同一台**（它量"命中集是否收窄"，本刀量"出口是否存在"），不要混为一谈，也不要互相顶替。
3. **P6 白名单被我收窄**（"非内置即第三方" → "非内置且非相对"）。反向夹具 P9 证明真第三方仍被拦，但这条改动动的是**上一刀（#4067 家族）的判据**；
   如果它其实想拒的就是"任何非内置 require"，需要那个 change 的作者确认，不是我自己判定通过。
4. **vendor 侧两格是机器局部读数**：换机器 / CI runner 上 `externalReview` 会是 `unknown`（不是 false），
   `upheld` 取决于那一版驱动里有没有 `verdict === 'upheld'` 那条 if。这是 #4067 已经固化的口径
   （结论随现场变、判据不随结论变），**跨机器比较读数时不要把它当同一个量**。
   ⚠️ 本条在 2026-10-24 改过写法：原来还写着"P10/P11 的 found 分支因此不执行，缺席侧由 P1/P4 守"——
   那句话已经被现场否证并成为本刀的一处缺陷（那份 `found` 前提就是本机未提交的 vendor 补丁；
   补丁被另一会话改写之后，这两条锁既不红也不测，对事故结构性免疫）。
   现在 P10/P11/P12 由**自建夹具**跑，任何机器都执行；真 vendor 的读数只打印、不作断言前提（design §1.4、tasks 3.6/4.4）。
5. `openspec/changes/ccg-convergence-exit/tasks.md` 里 §10.4 引用的 P9/P10 与今天这两个编号不是同一件事（那两条用例随撤销一起消失；
   今天 P10 是"行为档必须真的取到数"、P11 是"行为档失明必须 rc=1"）。
   §10.7 已就地写明；如果哪天要恢复那两条用例本体，请另起编号，不要在 P9 这个名字上再换一次语义。
6. **驱动的"未预期但红"里没有一条被消解**：n15/n17 的红集含 P1/P3，是新守卫的正常后果（见"变异反证"行 ③）。
   我没有为此把 P1/P3 的期望改成"允许 rc=1"，也没有把它们从红集里摘掉 —— 那等于用放宽断言交差。
   如果将来这条守卫被证明不该存在，正确的动作是删守卫并同步删 P11 与 n18，不是留一条恒不触发的 if。
7. **`.gitignore` 的模式化反选没做（第 3 轮评审 i4）**：候选修法是加一条 `!scripts/*.test.js`（让"新写一条测试"不再依赖手动补一行）。
   本刀不做，两个理由：① 它改变**全部在飞会话**的忽略语义，属仓库配置变更（AGENTS：改守门面/白名单须人工过目）；
   ② 它与既有 `test-*.js` 规则相互作用，而 P8 那条锁的判据是"最后命中的规则必须是放行" —— 顺序一变，那条锁要跟着重做。
   重取现状：`git check-ignore --no-index -v scripts/<新文件>` 看回显的模式而不是 rc；本刀自己的三个文件由 A12 逐个钉追踪态。
8. **单实例锁与固定 sidecar 名是成对的取舍**：允许并发就必须同时改掉 `--restore` 的可寻址性（带 pid 的名字让人先猜 pid）
   和 `restoreFromSidecar` 的 root 判据；现在的形状是"一台机器一次只跑一个驱动"，陈旧锁**一律拒绝、不自动破**。
   第 3 轮 i1 提的是同一格，处置见 PR 评论。
9. **变异 n32 的外部副作用：已闭合成两道闸（本支落地；原登记为"未修，只在记录里写明"）**：
   ① `sandboxEnv()` 把 `CCG_ARL_DIR` / `HOME` / `USERPROFILE` 同指一个**空的**临时目录 ⇒ `locateVendor()`
     恒 null，真 vendor 在反证运行里根本见不到；开工前自证一次（沙箱内探针必须 rc=2 且点名"探针失明"，
     否则拒绝开跑）—— 这一格是"防"。
   ② `checkSideEffects(before, targets)` 在还原之后对整棵工作树再拍一次快照，靶子之外**新出现**的脏文件
     即 `PROBLEM id=side-effects`；git 取不到读数同样 PROBLEM（不把工具的失明读成"现场干净"）——
     这一格是"可见"。
   终跑读数里不再出现 `side-effects` 那一条（见上一节"现场读数"），而 n32 的红仍由 P12 的**自建夹具**提供，
   不依赖本机装的是什么引擎。
   ⚠ 残留一格如实留着：`sandboxEnv` 是 **env 级不是 fs 级**（函数注释已写明，第 7 轮 i5 的命名提醒），
   一份被判 `ok` 的驱动仍可在加载期往仓库可写路径落文件 —— 那一格由 ② 负责可见，不由 ① 负责阻止。
10. **`--json` 的 stdout 被第三方污染这一格，现在只有 P12 一条夹具锁**：它测的是"探针不 require 未守卫驱动"，
    没有测"如果哪天 vendor 侧出现了另一种会在加载期做别的事的形态（不 exit、但发请求/写文件）"。
    真要兜住那一格只能改成**子进程隔离 + 超时**跑行为档（本刀刻意不做：那会把 vendor 的整条评审流水线
    以"探测"的名义真的跑起来，代价与副作用都比现在大）。
11. **可加载性判据仍是启发式，不是 AST 解析**（第 5 轮 i5 提出；第 7 轮 i3 把方向反转之后仍然成立）：
    现在的形状是**删除式**的 —— 只剥掉已证明不执行的部分（守卫整段 / 函数体 / 注释 / 串 / 正则），
    剥不动就整体走保守侧（`unparsable-driver`），所以错判只落在"少一路读数且出声"那一侧。
    已知的两格保守过头（都会让行为档整列退化成一路，都靠 A21 夹具显形）：字符数组上的 `indexOf('*/')`
    恒 -1、shebang 首行被当正则起点。已知的放过侧残余：`matchBraces` 是朴素计数，
    守卫块/插值里若出现"串内的括号"会配错边界 —— 方向仍是保守，但不等于无成本。
    箭头函数体（`const f = () => { main(); }`）**不被剥** ⇒ 判 `executes-on-require`（保守，可接受）。
    评审建议"改成 tokenize / 解析 AST"仍未采纳，理由同前：把探测器升级成解析器，引入的失败面大于消除的
    （本仓没有第二个可复用的 JS 解析器，`vm` 那条路本刀已被否证）。真正的修法在 **vendor 侧导出
    "我可否被安全加载"这张表** —— 属 #4304 拆闸那一刀的接口设计，不是探测器该自己发明的东西。
    现状可重取：A21 的形态夹具（无守卫 / 一层花括号 / 块内先 setup / `apply` / `call` / 两行式 / 裸调用 /
    插值里的调用 / shebang / 注释·串·正则内的假调用）+ `n43`-`n49` 七条靶子逐段摘。
12. **行为档今天仍是"没有真读数"，而且成因换了**：本机 vendor 那份驱动现在被结构判据判
    `executes-on-require`（它顶层确实是裸 `process.exit(main());`，`findMainCall` 命中在守卫块之后那一处）
    ⇒ 真引擎那一路今天仍然只有夹具版。要让它变成真读数，得 vendor 侧把末尾改成带守卫的形态 ——
    那是**别人未提交的 WIP**（2026-10-24 已被另一会话改写过一次），本刀不去改它，
    也不把"夹具能跑"冒充成"真引擎跑过"（AGENTS 里"读不出不得读成不存在"的同型）。



13. **跑反证驱动期间不得写仓库**（本支实测到的操作面副作用，不是代码缺陷）：
    `checkSideEffects` 的判据是「靶子之外有没有新出现的脏文件」，它对来源**不区分** ——
    我在一次全量跑的中途改了执行记录，那轮当场 `PROBLEM id=side-effects` + `RESULT=FAIL`
    （它点名的文件就是我正在写的那篇记录，读数见上一节）。
    这是**该要的**行为：n32 那一类事故的特征与"有人并发写仓库"完全同形，宁可被自己绊一次，
    也不要给差集加白名单、或把判据改成"只认 `.ccg` 路径"（那等于把闸拆成能漏的形状）。
    正解是流程纪律：驱动开跑之前把所有编辑落盘，跑期间不碰工作树；被自己绊到的那一轮**作废重跑**，
    不拿它的 `CAUGHT=` 当终值。

## QM-6 处置（跑完后逐条写在这里：哪条链、哪个后端、存档在哪，都要能一句话重取）

**链与后端**：`sh scripts/deep-review.sh`（仓内入口 → 引擎 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`），
critic=`claude` / proposer=`opencode`（真源 `scripts/ccg-review-backends.list` 两行现读），跨家族校验通过。
存档：`.adversarial/ccg-deep-<head8>/`（被 `.gitignore:510` 排除，不在仓内），判定产物 `.ccg/reviews/34d072ae….json`。

**轮次（本刀共三轮真跑，含本轮）**

| 轮 | 被评审的提交 | critic 交付 | 待裁决 | minScore | 结局 |
| --- | --- | --- | --- | --- | --- |
| 1 | `662f740fc`（加正控之前） | 8 条 | 6 条（含 1 条 crypto 高危域） | 2 | 未填裁决 ⇒ `self_play_pending`，写回器拒签 `reason=not-closed` |
| 2 | `ba2a9d17b`（双路读数 + 正控已落地） | 8 条 | 7 条（高危域 0 条） | 3 | 同上 pending；**该轮 i2 判成立 ⇒ 当场修驱动基线卫生并重跑第 3 轮** |
| 3 | `32f869578`（含单实例锁） | 7 条 | 6 条（高危域 0 条） | 3 | 六条逐条驳回并填裁决 ⇒ 复用存档跳过模型调用 ⇒ `✅ 自扮演裁决未发现阻断项`，`status=self_play_resolved`、`blocking=[]`、`findings=6` |

**第 3 轮六条的处置**：`i1`（固定文件名/并发）·`i2`（vendor 本机补丁 ⇒ 跨 runner 不可复现）·`i3`（正控夹具是合成的）·
`i4`（.gitignore 逐文件反选）·`i5`（结论文案是硬编码中文字面量）·`i6`（驱动原地改写受管文件）—— 六条全部 `dismissed`，
prosecution / defense / verdict / rationale 四格逐条写全，**逐字原文与 finding 原文公开在 PR #4326 的评论里**
（`https://github.com/Colinchiu007/mulpub/pull/4326#issuecomment-6372031270`）。
其中 `i6` 是第 2 轮那条成立项的同一格（修复已在提交里，残留只有"SIGKILL 落在 write 与 finally 之间"这一不可由工具自身消灭的一格，
已配 `--restore` 可执行出口）；`i4` 的修法（模式化反选）落在**仓库配置**层面，本刀不做，登记为遗留 3。


**第 1/2 轮逼出来的两处真缺陷（不是驳回项）**

1. `i2/i5（第 1 轮）`——行为档 B 份夹具只写了 `resolution` 三格，而 vendor 从不消费这份键 ⇒ "带凭证仍阻断"是在空形状上测量。
   修复：`externalReviewReceiptLive` 正控 + 双形状凭证 + A13/A16 + 变异 n19/n20/n21（详见"变异反证"行 ⑤）。
2. `i2（第 2 轮，Critical，判**成立**）`——驱动原地覆盖受 git 管理的源文件，`finally` 只覆盖抛错路径；
   被信号杀掉后盘上留在改坏的那一份，而**下一次运行会把这份污染当成原始内容写回去**。
   修复：脏基线拒绝 + sidecar（原子写 + 写后回读）+ `--restore` 可执行出口 + `parseCli` 不静默吞旗标；
   第 3 轮 `i1（Critical）` 的并发那一半继续加单实例锁（A20 + n26/n27，陈旧锁**不自动破**）。

**第 3 轮逐条处置**：见下（跑完当场补，每条含 prosecution / defense / verdict / rationale 四格，
原文同时落 `.adversarial/ccg-deep-32f86957/adjudication.json` 与本 PR 评论）。

**工具署名这一格（本刀自己测的那面墙，此处是现场第二次实测，且这次量到了"只欠一格"）**：
第三轮收敛后写回器当场读数

```
[ccg-review-writeback] 未写回 reason=backend-mismatch spoke=closed-status|findings-present|nonempty-findings detail=performedBy="self-play" 期望 "claude"
```

五条合取里 `spoke=` 只点名了**三条成立**（closed-status / findings-present / nonempty-findings），
拒签原因精确落在 `performedBy` 一格 —— 自扮演出口下它恒为 `self-play`，**与有没有 upheld、blocking 是否为空都无关**。
这条读数把此前"成立⇒阻断⇒拒签"的描述进一步收窄为"收口来自自扮演出口⇒拒签"。
所以本产物的 `tier=external` 与 `evidence` **由会话手写**（代用，不是工具产物），
`closureNote` 里逐字声明这一点并附上述读数，`evidence` 取上面那条 PR 评论 URL（形态判据在写回脚本里自检过一次）。

**停手依据**：本刀三轮真跑，已达 `openspec/changes/qm6-review-loop-budget`（#4297）定的轮次上限 ⇒ 不再续轮、
不自动合并以外的手段放宽判据；第 3 轮六条全部有逐字处置与可重取证据，遗留三条登记在下一节。


### 续跑：第 4-7 轮（本支 follow-up；含一次对自己的实测否证）

上表只到第 3 轮（PR #4326 那三段）。第四格与本支 follow-up 又跑了四轮，逐轮如实记（**别再拿"三轮"当总数引用**）：

| 轮 | 被评审的提交（squash 前的 sha） | critic 交付 | 结局 |
| --- | --- | --- | --- |
| 4 | `7e4bd0969`（第四格首版） | 8 条（2 Critical，minScore 6） | 处置落地：i1/i6（n32 外部副作用 + 还原范围管不到产物）⇒ 本支的 `sandboxEnv` + `checkSideEffects` 两道闸与遗留 9 的闭合；i2（`Object.freeze(new Set())` 拦不住 `.add`）⇒ 冻结数组 + A21 里那条"实测 freeze 对 Set 无效"的断言；i3（半截 `to` 造成语法坏 ⇒ PROBLEM 而非红）⇒ 写进 tasks 5.2b 的安装纪律。**裁决文件未填**（`items` 全部 `verdict=null`），产物随 squash 退出变更集 ⇒ 本轮不得读成"已闭合"，只算"发现项被后续实现吸收" |
| 5 | `1151fae14`（扫描域剔掉 M 表） | 6 条（2 Critical，minScore 4） | 同上：i3/i6 落成本支的副作用差量与 PROBLEM 归因；**i1 当时按"刻意留在保守侧"驳回** —— 那句驳回里含一句未实测的事实断言，第 7 轮被自己的读数否证（见下）。裁决文件同样未填 |
| 6-7 | `30a4cce9a`（require 安全闸 + 夹具解绑） | 5 条（1 Critical / 2 High，minScore 4） | 五条逐条填 `prosecution / defense / verdict / rationale` 全 `dismissed` ⇒ 复用存档跳过模型调用 ⇒ `✅ 自扮演裁决未发现阻断项`；写回器经**水位出口**（#4308 那条第二出口）签成 `tier=external`，读数原文：`[ccg-review-writeback] 已写回 tier=external basis=adjudicated-self-play evidence=https://github.com/Colinchiu007/mulpub/pull/4413#issuecomment-6387934663 spoke=closed-status|findings-present|nonempty-findings|adjudication-conditions|delivery-changed`，产物侧 `status=self_play_resolved / tier=external / tierBasis=adjudicated-self-play / adjudicationDigest=adjudicated@2497f62c… / blocking=[] / confidenceWeight=0.6` |
| 8 | `2db477e35`（判据方向反转 + `expectGreen` 执行体，本支现头） | 7 条（2 Critical / 2 High，最低分 3） | 六条待裁决逐条填 `prosecution/defense/verdict/rationale` 全 `dismissed`，且**每条 rationale 都引用一个当场重取的读数或 file:line**（取证脚本一次性；读数：沙箱内探针 `rc=2` 且 stdout 不可解析、`driverLoadability` 在 44633 字节真 vendor 上 `7.9ms`、`n30`/`n42`/`n43`-`n49` 本支终跑全 `CAUGHT`、本笔提交 `insertions=725` 而整支对 `origin/main` 为 `2474`）⇒ 复用存档跳过模型调用 ⇒ 写回器签成 `tier=external basis=adjudicated-self-play`，`evidence=https://github.com/Colinchiu007/mulpub/pull/4413#issuecomment-6389836902`，产物侧 `blocking=[] / confidenceWeight=0.6 / findings=6` |

**水位出口在 follow-up 里被连续用满两次**（第 7 轮 `b8b47012…` 与第 8 轮 `f2281b64…`，全仓含 #4308 自己的现场共三次）：`tier` 由工具写，不由会话手写。
`delivery@` / `adjudicated@` **仍不是签名**（任何填写方一条命令可自算），真正对第三方负责的是那条 PR 评论本身 ——
点开能看见 critique 原文与逐条处置，所以那条 URL 必须是公开的、且必须与产物里的 `evidence` 逐字一致。

**第 4/5 轮裁决未填这件事**（不掩饰）：按 #4297 的轮次预算，未填裁决的轮次**不构成闭合**，
它们的发现项是靠"下一版实现把它们做掉"处置的。本支的判据反转正是第 5 轮 i1 那条驳回在两轮之后被自己否证的结果 ——
也就是说：**未填裁决不会让发现项消失，只会让"谁驳回了什么、依据什么"失去出处**。
下次跑到这一档，裁决文件必须当场填（填不出就保持 `self_play_pending` 并停下来报告），不要靠 squash 让它出变更集。

**驳回但采纳的三条（第 7 轮）**：
`i3` `main.apply` 形态 —— 我的驳回理由里有一句是错的，判据因此整体反转（上表与 design §1.2 第 3/4 条）；
`i4` `expectGreen` 没有靶子证明它还能触发 —— 新增 `greenViolations` + A25 + `n42`；
`i5` `sandboxEnv` 命名易被读成 fs 隔离 —— 函数注释补一句"**env 级，不是 fs 级**"，并写明 fs 那半边由谁兜。

## CHANGELOG 条目

# fix(gates): 收口出口的可达性改成读数，并让"能力文件被整段删掉"当场能被发现（qm6-exit-capability-probe）

- 深度审查探针不再打印写死的结论句。它现在报告三格出口的实测读数：高危域条目能否被"外部复核三格"解除、
  被判成立的评审意见有没有"已修且已验证"的出口、`tier=external` 能不能由工具自己署名。
  本机当天读数：第一格在位、后两格不在位 —— 结论随现场变，判据不随结论变。
- 修复一次静默撤销的后果：2026-10-20 一个无关的功能 PR 携带评审前的旧副本，把上一版"现读能力"的改动连同**唯一会发现它丢失的那条测试**一起删空，
  此后探针一直在打印一句与现场相反的"不可达"。现在检出处与实现处分开住、由 workflow 独立点名，删除能力文件会当场红。
- 探针新增"读不出"这一档（vendor 缺席或被改名时不再等同于"这条出口不存在"），避免把工具的失明读成世界的形状。
- 探针不再在 require 期执行不可安全加载的 vendor 驱动：驱动若在顶层裸调 `main()`，探针一律不加载并如实报
  `behavioral=skipped(executes-on-require)`。这条是合并后当场被现场逼出来的——本机 vendor 被另一个会话改写后，
  那次 require 把别人的评审流水线跑进了探针进程，还覆写了一份评审判定产物。
- 行为档那三条回归锁改由自建夹具驱动，因此在 CI runner 上也会执行；改前它们只在"本机带着一份未提交的
  vendor 补丁"时成立，对那次事故既不红也不测。
- 加载安全判据从「只认一种坏形态的黑名单」改成「先剥安全区、再在顶层区找 main 被调用」：
  `main.apply` / `main.call` / `const c = main(); process.exit(c)` / 裸 `main()` 四种真会执行顶层代码的形态
  此前全部被放行（探针会 require 它们，等于替别人跑一遍评审流水线），现在四种都判禁止加载；
  反过来，守卫块里先 `setup()` 再 exit 这种合法形态此前被误判成禁止，现在回到可加载。
- 新增成因 `unparsable-driver`：结构判据认不出这份驱动的顶层形态时如实报"探测器读不懂"，
  不再伪装成"vendor 有裸调用" —— 两档动作相同（都不 require、都出声）但要修的对象相反（改 vendor / 改探测器）。
- 反证驱动的 `expectGreen`（"某套件必须保持绿"）现在有执行体 `greenViolations`、有直接调用它的用例 A25、
  有把它改成恒空的靶子 n42；此前它只有一条历史否证记录，没有任何会当场红的证明。


## learnings

### lesson: 与实现同批可删的断言，不是检测，是陪葬

**现场**：`git show --stat 8fdd617b2` —— 一个标题写着 `fix(s2v): 历史记录失败卡片直出英文技术原文` 的 PR，
删掉了 `scripts/ccg-convergence-probe.js` 21 行、`scripts/ccg-convergence-probe.test.js` 25 行、
`openspec/changes/ccg-convergence-exit/tasks.md` 31 行；三个文件都属于 5 小时前合并的 #4067（CCG 收敛出口探针）。
5 天后跑探针：`verdict=AS_EXPECTED`、`problems=[]`，而 stdout 那句"self-play 对 crypto 项无条件计阻断 ⇒ 不可达"与 vendor 现状相反
（`grep -c 'function externalReviewSatisfied' vendor/ccg-deep-review.js` = 1）。

**根因**：#4067 把"检查能力是否存在"的断言写进了**它守护的那两个文件自己**。叠片（stacked branch）携带评审前的旧副本落地时，
一次删除同时移除了实现与"发现实现丢失"的断言 ⇒ 测试数从 10 变 9，而 `node --test` 从不问"本该有几条"。
撤销不产生失败，只产生"少了几条通过"，而少掉的用例在汇总里没有任何形状。

**可复用的 4 条**：

1. 任何"某能力/某接线还在不在"的检测，**必须住在与被检对象不同的文件里**；同文件的断言与实现是同一批可删物。
2. 计数型判据要能发现"变少"：本刀用 `# tests N ≥ 下界`（驱动的 suiteRun）+ A12 的导出面逐个点名断言，
   因为"少了一条用例"必须由某个**不依赖那条用例存在**的东西来报。
3. 三档返回值（true / false / unknown）不是讲究：两档制会把"实现被改名/被删"折叠成"结论是不存在"，
   而折叠后的值恰好是**下一个会话最愿意相信的那个**。
4. 恢复被撤销的历史改动时，取原文、不改写，另起一节声明现状（含编号复用造成的歧义）。
   改写它等于销毁"当初为什么这么做"的证据，而下一次撤销的判定正需要那份证据。

### lesson: 一条锁可以既是绿的、又是无用的 —— 当它的前提是"我这台机器"

**现场**：本刀 #4326 合并后 5 小时，本机 vendor 引擎被另一个会话改写（那个目录是个 git 子模块，
11:48 落了 104/27 行的 WIP），末尾的 `if (require.main === module)` 守卫和整张导出面一起没了。
后果分两层：

- 探针 `require` 了那份驱动 ⇒ **别人的整条评审流水线在本进程里跑起来并 exit 掉探针**。
  `--json` 的 stdout 变成「判定记录按 diff 内容寻址命中…」，`JSON.parse` 报
  `Unexpected token '判'` —— 报错读起来像"探针输出坏了"，不像"探针执行了不该执行的东西"。
  那次误执行还**覆写了本 PR 的一份 `.ccg` 判定产物**（`pending/tier=unknown` → `skipped_by_mode`）。
- 同一时刻 P10/P11/A9 三条锁全部变红。但红的内容是**"我的机器前提变了"**，不是"判据量出了什么"：
  它们写的是"本机有 vendor ⇒ 行为档必须取到定值"，而那个"有"其实指"本机带着那份**未提交**的补丁"。
  在一台装了上游原版 vendor 的机器上，这三条**整条早退**，连"红了"这个信号都不产生。

**根因**：两条独立但同源的错。① 测量工具把"require 被测对象"当成无害动作 —— 而 require 的语义就是执行模块体；
② 锁的成立前提写在**环境**里而不是**仓库**里。第②条比第①条更贵：第①条至少当场炸出来说话，
第②条让一条被登记为"反证已建立"的锁长期不工作，而所有人都以为它在守。

**可复用的 5 条**：

1. 写"某能力/某接线还在不在"的锁之前，先问一句**"这条锁在别人的机器上会走哪条支路"**：
   如果答案是"`return`/早退/不执行"，它就不是锁，是一段只在作者机器上跑过的散文。判据一律改成蕴含式
   （"声明了就必须读得出 / 没声明就必须报读不出"）或自建夹具（在 CI 上也会跑）。
2. **依赖宿主可执行代码之前，先判它能不能被安全加载**，且判据要盯"副作用发生的那一句"而不是
   "某个危险字符串出现过"：按 `process.exit` 存在性判会把函数体内合法的早退一起排除掉，
   于是唯一正常的形态被判成"不许测" —— 那是把锁换成另一个方向的失明。
3. 分档时不许合并成因，包括**日志文案**层面的合并："装了但不敢跑"写成 `no-vendor`，
   下一个人就会去装 vendor，而真正要修的是加载安全判据（本仓 fail-closed 兜底文案不得合并成因的同型）。
4. 反证驱动的 `from` **从被测文件当场取行**，不手抄：手抄要穿 JSON→JS→正则三层转义，本会话在同一处错过两次
   （多写一个分号、反斜杠翻倍）；而 `to` 只写半截会把"整行替换成语法坏"造成一条 PROBLEM，
   读起来像反证跑过了，实际任何断言都没轮到执行。
5. 事故复现的现场证据要**当场留档并精确还原**：被覆写的产物用 `git checkout HEAD -- <那一个文件>`，
   不用宽目录 restore；还原动作本身写进执行记录，否则下一个会话看到脏文件会以为是自己改的。

### lesson: 驳回评审意见时写下的事实句，要和采纳项一样实测

**现场**：第 7 轮评审 i3 说"`MAIN_GUARDED` 正则太严格 ⇒ 合法形态会被误判成禁止执行"。我在那条的
`defense` 里写了三句，其中一句是「`main.apply` / `main.call` / 两行式 / 裸调用只会落到**保守侧**，
**不存在误放行**」。这句我一个字都没测过 —— 它是从"我的正则只匹配那一种形状"直接反推出来的。
把四种形态逐个喂回 `driverLoadability`：`process.exit(main.apply(null, []))`、`process.exit(main.call(null))`、
`const c = main(); process.exit(c)`、裸 `main();` —— **四种全部读成 ok**，即四种都会被 require。
而 require 会执行模块体，这正是本刀立项要消灭的那次事故（探针替别人跑完整条评审流水线、覆写 `.ccg` 判定产物）。

**为什么写得出来**：驳回比采纳省力。采纳要改实现、跑测试、配靶子；驳回只要一段读起来自洽的话。
"从实现反推行为"是其中最省力也最容易错的一种 —— 实现就是被测对象，用它证明它自己的行为等于没证明。
同型错误本仓已经记过两次（把未实测的推断当结论、以一次重测宣告"已否证"），这次落在**评审裁决**这一面。

**口径（下次照做）**：

1. 裁决里每一句**关于代码行为的断言**（会/不会、读成/不读成、只会落在某侧），要么引用一条已在仓内的用例，
   要么当场跑一次并把读数原样写进 `rationale`。两者都没有，就写成"未实测，按最坏情况处置"而不是写成断言。
2. "误判只会落在保守侧"这类**方向性断言**是最高危的一句：它恰好是放行侧失明的通行证。
   凡某条驳回**只有在这句话为真时才成立**，先做一次"最坏形态实测"再落笔。
3. 采纳与驳回的验证成本不得不对称。本支的实际成本对比可以一眼看出：采纳项（补夹具 + 反转判据 + 七条靶子）
   约一小时，而那句错话省掉的实测是一次 12 行的探针脚本。
4. 闭合之后发现自己错了：**不删原文、不改判语**，在 `rationale` 里**追加**更正，并在执行记录写清
   "指控的方向是真的，错在我以为已经排除的那一侧"。`verdict` 是否翻转按事实判 ——
   本支的处置是"判据反转 + 夹具与靶子补齐"，而不是把 `dismissed` 改成 `upheld` 去给轮次记账。
5. 未填裁决的轮次（本支第 4/5 轮就是）不会让发现项消失，只会让"谁驳回了什么、依据什么"失去出处。
   下一版实现把它们做掉只是**半件**事：出处要补，要么当场填裁决，要么如实保持 `self_play_pending` 并停下来报告，
   **不得**靠 squash 让产物退出变更集来当作闭合。
