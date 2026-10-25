# Tasks: heartbeat-window-witness

> 顺序即依赖：1 的采集器回报是 2 的触发条件；3 的两档共用 2 的 witness 读数；4 的驱动反证必须跑在 1-3 落地之后。
> 每条勾上都必须留"先红后绿"的指认：哪个分支拆掉，哪一条用例红。

## 1. 采集器回报窗口截断（判据的"我看见了多少"）

- [x] 1.1 `makeGhCollector` 返回值增 `truncated`（`runs.length >= perPage`，**不写死 100**）；`qopts.event`
      支持第二趟查询，event 取值必须过 `EVENT_RE` 才拼进查询串
- [x] 1.2 行为锁 H24：填满报满 / 差一条报否 / `perPage` 可配时读数跟着走（三个方向都在一条用例里，
      因为"恒 false"与"恒 true"是两个相反的失明方向）
- [x] 1.3 变异 m27（`truncated` 写死 false）指名红 H24 —— **本条在补 H24 之前实测是 MISSED**，
      驱动头部第 8 条硬约束就是它换来的

## 2. 第二趟取证（witness）

- [x] 2.1 `judge`：主窗口零心跳时先发 witness（带 `event=schedule`），三种答案分别落
      `OK/LATE`、`NEVER_RAN`、`PENDING_FIRST|NEVER_COMPLETED`；witness 失明 ⇒ `SCANNER_FAULT`
- [x] 2.2 行与首行的降级读数：`采集窗口=满/否`、`心跳来源=witness`、首行 `witness=` 计数
      （judge 面与命令行面**两个投影各一条断言**：H17）。现场补记：命令行面那一格**第一版恒 0**
      （`main()` 从不回填 `counts.witness`），是这条新断言当场抓出来的 ⇒ 变异 m31 钉的就是那个坏形态
- [x] 2.3 行为锁 H17（窗口满 + witness 有心跳 ⇒ OK 且出声）、H20（witness 也零条 ⇒ NEVER_RAN）、
      H21（witness `ok:false` ⇒ rc=2 且点名）、H22（witness 只在需要时发、必须带 `event=schedule`、
      主查询必须不带）、H23（窗口未满不得报"满"）、H25（witness **抛错** ⇒ rc=2，与 H21 分守两条分支）
- [x] 2.4 变异 m20（witness 丢 event）/ m21（失明塌回 NEVER_RAN）/ m22（抛错被吞）/
      m28（窗口读数恒否）/ m29（来源标签不写）/ m30（judge 计数进错桶）/ m31（命令行计数退回恒 0）
      各指名红对应锁。实测红集比声明宽的两条（m20 另红 H6/H18/H19、m2 另红 8 条）**如实打印不认领**，
      理由与 m3 那条同源——共用实现被打掉时连带是必然的，把它们全登记进 `expect` 只会让变异脆断在别人的改动上

## 3. 在途两档（同一把周期时钟）

- [x] 3.1 `pendingScheduleAttempts`（schedule 且 `status≠completed`，采纳 QM-6 i4 后返回条目带 `status`）；与 `heartbeatStamps` 共用
      `validateRunShape` + `scanSchedule`（m7 锚点歧义换来的收敛，见 design §3）
- [x] 3.2 `age ≤ 阈值` ⇒ `PENDING_FIRST`（rc 0）；`age > 阈值` ⇒ `NEVER_COMPLETED`（rc 1）；不新增常量
- [x] 3.3 行为锁 H18（30h ⇒ PENDING_FIRST 且 rc=0）、H19（40h ⇒ NEVER_COMPLETED 且 rc=1，
      同一夹具两侧各断言一次）、H6 改写（原来"queued ⇒ NEVER_RAN"那一句与文件头第 4 条成因
      只在"没查卡了多久"时一致）
- [x] 3.4 变异 m23（两档整块塌回 NEVER_RAN，指名 H6/H18/H19）/ m24（PENDING_FIRST 算进 FAIL）/
      m25（NEVER_COMPLETED 从 FAIL 摘掉）/ m26（新档不领自己的桶 ⇒ 落进 faults，rc 被抬成 2）

## 4. 驱动与既有锁

- [x] 4.1 `SUITES` 下界按现读数改（LOCKS 16 ⇒ 25 ⇒ 27 ⇒ 28 ⇒ 29 ⇒ 30）；对照两套（watch 13、budget 26）照旧，终跑三套收集
      `30 / 13 / 26` 逐条打印
- [x] 4.2 m1/m2/m8 三条既有变异**重锚**到共用收集器与新查询串上（本刀的实现改动让它们命中 0/2 次，
      驱动 fail-closed 先报错再改锚——不得为了跑绿而放宽锚点判据）。m8 的旧锚点
      `runs?per_page=${perPage}` 在本刀引入 `qs` 变量后就已失效，是锚点体检脚本一次性报出来的
- [x] 4.3 终跑 `SUMMARY CAUGHT=42 MISSED=0 PROBLEM=0 TOTAL=42 ATTEMPTED=42 / RESULT=OK`（32 = 第一轮评审前，35/37/40 = 各轮采纳途中；四个数都是当场跑出来的，逐次不覆盖，见 §6）
      （活数，引用前重跑；`ALLOWED_MISSED` 仍为空 ⇒ 本刀不允许任何 MISSED）
- [x] 4.4 真仓现跑（`node scripts/check-schedule-heartbeat.js --repo Colinchiu007/mulpub --explain`，
      rc=1）三档读数全部落在执行记录「现场读数」：`dep-audit.yml` 由 NEVER_RAN 转
      `OK … 心跳来源=witness 采集窗口=满`；`dep-audit-refresh.yml` 的 NEVER_RAN 现在带
      `witness_schedule_run=0`（被证明）；`schedule-heartbeat.yml` 实测 `OK age_hours=19.0`
      ⇒ **自指是一次性的**，这条是勘误 ② 的现场依据

## 5. 勘误与收尾

- [x] 5.1 PATCH PR #4305 的回读评论（`#issuecomment-6390615188`，2026-10-25T03:46:41Z 写回）：就地追加勘误——
      「每天必红」的成因不是自指（那是一次性的），`dep-audit.yml` 不是真欠账（是窗口截断的假阳性），
      并说明原修法「最近 25 小时内有无任意 run」为何不采纳；原结论不删（评论是历史快照）
- [x] 5.2 QM-6：本刀动的是 `scripts/check-` 判据本体 ⇒ 高危面，五轮后由工具写 `tier=external`；
      自扮演 + 公开 PR 评论复核那格由 `deep-review.sh --evidence` 署名
- [x] 5.3 执行记录 `openspec/records/heartbeat-window-witness.md`（QM-5 ①-⑤ + 现场读数 + 遗留 + CHANGELOG 条目 + learnings）
- [ ] 5.4 `check-main-red.js --pr` 读数、`merge-when-green.sh` 合并、合并后回读 main push、
      `check-branch-merged.js` 后再 `safe-worktree-remove.ps1`

## 遗留（不在本刀做，理由写进执行记录）

- `dep-audit-refresh.yml` 的首次到期自愈（cron `17 3 * * *`，作业 2026-10-24T03:38:42Z 创建，
  第一次到期 10-25T03:17Z）：不建"刚加的 cron 给宽限"的判据（浅克隆量不到添加日期）。
- 心跳判据的窗口成本：真截断的作业多起来时，正解是**翻页聚合**而不是加大单页；今天单页上限 100
  已经是 `per_page` 的合法上界，加大它只是把截断往后推。
- `PENDING_FIRST` 今天**没有真实现场**（`schedule-heartbeat.yml` 已有第一条 completed schedule run，
  实测直接 `OK`）⇒ 这一档目前只有 H18/H19 两条锁与改判前的旧读数支撑，第一次真实兑现要等下一次
  扫描落在它自己的运行窗口内。

## 6. 外部评审（QM-6）采纳项——两条 Warning 当场落成代码 + 锁

- [x] 6.1 i3（witness 自己也会被截断）：**档位不受影响**（runs 按 `created_at` 降序返回，截断砍不掉最新那条心跳/pending），
      但"witness 这一趟同样只看了最近 perPage 条"必须可见 ⇒ 新增 `row.witnessWindowFull`，
      行上打 `witness采集窗口=满`；锁 H26（两个方向 + LATE 档各一条），变异 m32 指名红 H26
- [x] 6.2 **采纳过程中实测到同一族的第二格**：`LATE` 出口原本不带 `心跳来源/采集窗口` 标签
      （只有 OK 行出声）⇒ "迟到的那条其实是换坐标查到的"在日志里消失。已补进 LATE 行，
      H26 同时断言 OK 与 LATE 两侧，变异 m34 指名红 H26。**这一格评审没有点名，是采纳动作把它逼出来的**
- [x] 6.3 i4（witness 让最坏出站量翻倍、预算未对账）：不加限流、不改超时值，
      补一条**预算不倒挂引信** H27：`timeout-minutes × 60 ≥ 作业数 × 2 趟 × COLLECT_TIMEOUT_MS`，
      每次跑打印 `[heartbeat-budget] 声明=600s 最坏=240s（作业 6 条 × 2 趟 × 单趟 20s）`；
      域退化（作业数 < 4）也红（否则不等式恒成立=假绿）。变异 m33 把单趟超时抬到 400s ⇒ H27 当场红
- [x] 6.4 i1/i2 两条 Critical **经实测驳回**（不是"看着没问题"）：`stamps` 的声明本来就是 `let`
      （判据 188 行），H17 真跑过 `stamps = wstamps` 那条赋值；首行没有任何锁要求 `thin=` 与
      `slack_hours=` 相邻（锁里 `thin=` 出现 0 次）。逐条 prosecution/defense 见「QM-6 处置」
- [x] 6.5 i5（产物仍 pending）属流程时点而非缺陷：本轮在 PR 内用 `deep-review.sh --evidence` 那格闭合，
      闭合前不合并
- [x] 6.6 采纳后重跑（终值）：行为锁 **30** 条、驱动 **42** 条 `CAUGHT=42 MISSED=0 PROBLEM=0`、真仓读数复现一致
- [x] 6.7 采纳 i3 时的**第二落点**（评审没点名的那半）：两档在途的结论完全来自第二趟取证，原本读数里既没有
      `证据来源=witness` 也没有 `witness采集窗口`，`witness=` 计数也不把它们算进来 ⇒ 现在三种出口共用同一个承载字段
      （`heartbeatSource`），标签按出口选词：有心跳打「心跳来源」、在途打「证据来源」——硬套任一种都会造出假证据
      或把已到手的降级成旁证。锁 H18/H19 各加一条，变异 m35 指名红这两条；m29 的红集因此从 1 条变 4 条
      （一个字段承载三处读数，这既是收敛的收益也是它的代价，必须被四条锁各守一侧）
- [x] 6.8 采纳 i6：`{event: ''}` 与「不传 event」在实现里**逐字同形**（实测两条 URL 完全相同、都 `ok:true`），
      等于「想指定 witness 那一趟，却因为写坏取值被静默换成主查询」——正是本刀要消灭的形状 ⇒ 显式空串一律拒，
      「不带过滤」只由 `undefined` 表达。锁 H28（含四类坏值 + 「被拒时一次出站都不发」），变异 m36 指名红 H28

- [x] 6.9 第三轮评审 i4（queued 与 in_progress 同形）：`scanSchedule` 返回条目 `{ts,status}`，
      两档在途的行各带 `状态=`，且 NEVER_COMPLETED 的文案直接说出两种状态各自的查法；
      锁 H18/H19 各加一条，变异 m37（PENDING_FIRST 丢状态）与 m38（NEVER_COMPLETED 丢状态）**各测一行**
- [x] 6.10 第三轮评审 i6（`perPage` 可配到 500）：GitHub 对越界是**静默截到 100**，
      于是"条数 >= perPage"永不成立、`truncated` 恒说"否"——比没有读数更坏 ⇒ 构造期即拒；
      锁 H29（含"恰好 100 仍报满"与"小于上限合法"两个方向），变异 m39 指名红 H29
- [x] 6.11 第三轮评审 i2（`EVENT_RE` 的 `{0,32}` 与空串拒绝不同步）：正则下界收到 1，
      空串由**独立一条**文案拒（并进"形状不合"会把人支使去改一个没写错的正则——兜底文案不得合并成因）；
      变异 m36 重锚后指名红 H28
- [x] 6.12 第三轮四条驳回（逐条给可重取反证，见「QM-6 处置」）：i1 的"原为 const"（判据里那一行本就是
      `let stamps`，且 H17/H20/H26/H29 都真跑过赋值路径）；i3 控制流深度（四个出口各有指名锁与指名变异，
      抽函数属可维护性改进、不改语义，登记为遗留 7）；i5 的 `thresholdHours` 为 null（该分支在周期推不出时
      已 `continue` 落 SCANNER_FAULT，走不到这里——H19 断言的 `阈值_hours=32.0` 就是它非 null 的现场）；
      i7 引用 PR 评论与仓库名（AGENTS 规定取证锚点恰恰是分支名与 PR 号，且 `check-doc-abs-paths` PASS）
- [x] 6.13 第四轮 i1（**Critical，成立**）：`pendingScheduleAttempts(wit.runs)` 原本是裸调用 ⇒ 一条
      `{status:'in_progress', created_at:'not-a-date'}` 会让异常一路抛出 `judge()`，用户看到的是崩，
      而不是「我不知道」这一档。补 `try/catch` 并单独一条文案「witness 在途读数形状不合」；
      锁 H30（含"坏形状只进 faults 桶"的四桶断言），变异 m40 指名红 H30。
      **教训**：两趟共用同一份校验 ≠ 一处保护就够——`completed` 档过滤掉的输入，正是在途档要解析的那批
- [x] 6.14 第四轮 i2：`采集最坏秒数=` 进首行，与 H27 用**同一个公式**现算；锁 H27 增一条运行面断言
      （期望值按当场域数现算，不写死 240），变异 m41 指名红 H27。今天实测 `采集最坏秒数=240`
      （6 条作业 × 2 趟 × 单趟 20s），声明预算 600s ⇒ 有余量，且余量每次跑都自报
- [x] 6.15 第四轮驳回四条，逐条给可重取反证与指针：
      i3（限流/缓存/批量）——witness 只在零心跳时发（H22 两条断言：有心跳时 `calls.length===1`），
      可见性缺口由 6.14 补，根治在遗留 3（翻页聚合）；
      i4（judge 是大函数）——就是遗留 8 原文，抽函数需要一条「行为不变」的对拍作前提；
      i5（40 条变异维护成本高）——成本是真的，但本 PR 内 m1/m2/m8/m29/m36 五条锚点漂移全部被驱动
      **当场拒绝**（抛错、不落盘、不报 CAUGHT），这就是"不许用放宽判据换绿灯"的现场；
      i6（注入 verdict）——`runs` 在进入判定前整体过 `validateRunShape`，多余字段被忽略而非消费，
      档位由行自己的字段算出，注入面不存在；该口径已写进 Requirement 10 第三段
