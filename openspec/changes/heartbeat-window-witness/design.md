# Design: 第二趟取证（witness）与在途两档

## §1 勘误：PR #4305 回读评论里的两处归因

那一刀我自己写的结论，落地当天就被日巡检的第一条红否证了一半，必须**就地更正而不是删评论**
（评论是历史事实快照，删掉等于把"我错过"这件事也删掉）：

| 当时写的 | 现场实测 | 后果 |
| --- | --- | --- |
| 「`schedule-heartbeat.yml` 每天必红，成因是**自指**：巡检作业从没跑过，所以永远 `NEVER_RAN`」 | 自指只发生在**首跑那一刻**（当时它唯一的 schedule run 就是正在跑的这条）。有第一条 completed run 之后同一判据就转 `OK` | 归因方向对、**时效错**：它不解释"每天"。真凶是 §2 的窗口截断，而它红的是**别的作业** |
| 「`dep-audit.yml` 是一条**真欠账**（weekly 作业零条 schedule run）」 | 按 `event=schedule` 查得到 **4 条** completed schedule run，最近一条 2026-10-19；主窗口 100 条全是 `pull_request`、只覆盖 13.4 小时 | **假阳性**。这条才是"每天必红"那一句的真实所指，且它至今仍在红 |

两条合起来说明一件事：**上一刀把"取不到数"与"取到且新鲜"分了两档，却没有第三档给"取到了但窗口不够长"。**
不是漏写分支——是当时还没有一个繁忙作业来撞它。

## §2 三档决策表（每档都要能单独被红/被绿）

| witness 结果 | 档位 | 退出码 | 首行读数 | 为什么这么判 |
| --- | --- | --- | --- | --- |
| 查到 ≥1 条 completed schedule run | `OK` / `LATE`（按 age 与阈值） | 0 / 1 | `心跳来源=witness`、`采集窗口=满` | 心跳确实存在，只是主窗口看不见。**降级必须说话**，否则下一次假阳性没人知道该查窗口 |
| 零条 schedule run（completed 与在途都没有） | `NEVER_RAN` | 1 | `witness_schedule_run=0` | 这一次是被**证明**的，不是被假设的（`dep-audit-refresh.yml` 真形） |
| 有 schedule run 但没有 completed 的，`age ≤ 阈值` | `PENDING_FIRST` | 0 | `pending=`、`上次尝试=…h` | cron 已兑现，只是那一次还在跑。红它 = 巡检作业第一天咬自己 |
| 同上但 `age > 阈值` | `NEVER_COMPLETED` | 1 | `never_completed=` | 文件头第 4 条成因（runner 长期排队永不 completed）。一律放行 = 把这一条成因放走 |
| witness 取不到数 / 抛错 | `SCANNER_FAULT` | 2 | `faults=` | 工具的失明不得落成运维事实（rc=1），也不得放行成通过（rc=0）。两条分支各有一条锁（H21 走 `!ok`、H25 走 `throw`） |

`PENDING_FIRST` 与 `NEVER_COMPLETED` **共用该行自己的阈值**（周期 + 宽限），不新增常量：
新增一个"排队宽限"就是再造一次阈值口径漂移，而上一刀已经把阈值取值钉成实测数（×1.04 间隔、5.68h 漂移）。

## §3 为什么把两份校验抽成一份

`pendingScheduleStamps` 是新写的，最初照抄了 `heartbeatStamps` 的读形状校验。驱动下一轮就跑不动了：
**m7 的锚点命中 2 次 ⇒ 拒绝动手**。这不是驱动的毛病——

- 两份逐字相同的校验，对变异判据是**歧义锚点**（改哪一份？）；
- 对下一个改判据的人是**改一侧忘另一侧**（新字段进 `REQUIRED_RUN_FIELDS`，两循环各写一遍）；
- 对覆盖判断是**假宽**：一条用例只可能红在其中一份上，另一份永远没人守。

正解是收敛实现（`validateRunShape` + `scanSchedule(runs, statusKeep)`，原名 `scheduleStamps`），而不是给 m7 拆成两条变异。
顺序严格照旧：先对**所有** run 校验形状，再按 event/status 挑，最后只对被挑中的那条解析 `created_at`
——非 schedule 的 run 时间戳坏了不该把整档抬成失明（这条由 m1/m2 重锚后的红集变化当场验算过）。

## §4 取数命令（可原样重跑，不是注释里的死数）

```
gh api "repos/<repo>/actions/workflows/dep-audit.yml/runs?per_page=100" \
  --jq '[.workflow_runs[]|{created_at,status,event}] | (.[0].created_at, length)'
gh api "repos/<repo>/actions/workflows/dep-audit.yml/runs?per_page=100&event=schedule" \
  --jq '[.workflow_runs[]|select(.status=="completed")|.created_at]'
```

第一条给"窗口右端到哪儿"，第二条给"换坐标后有几条心跳"。两趟都是**同一判据的采集器**在跑的形态，
所以量出来的差别就是判据看得见的差别。

## §5 被否证的替代方案

| 方案 | 否证它的读数 |
| --- | --- |
| `per_page` 抬到 1000 | 只把截断从 14 小时推到几天；GitHub 单次上限 100 页 × `per_page` 还要翻页，采集成本与超时预算线性上涨，而"看不见"这一格仍在 |
| 主查询直接带 `event=schedule`（只查这一种） | 丢掉"有 push run 但 cron 从未兑现"这一现场信息（上一刀 m8 专门为此立锁）；判据侧的 event 过滤退化成死码 |
| 放宽阈值到"两个周期 + 宽限" | 与上一刀实测口径冲突（间隔最大 ×1.04），把"漏一天"的发现推到第三天 |
| 用 git 历史给"刚加的 cron"宽限 | 心跳作业 checkout 无 `fetch-depth`，`git log --diff-filter=A` 量到的是**浅边界日期**而不是 cron 添加日期 ⇒ 会把"从没排过"读成"刚加三天" |
| 一律放行在途 run | 文件头第 4 条成因永不响——那是本判据立项的理由之一 |
