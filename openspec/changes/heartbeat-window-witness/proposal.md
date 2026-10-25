# Proposal: 心跳判据的第二趟取证——窗口截断不得被读成「从来没跑过」（heartbeat-window-witness）

> 本 change 收的是上一刀（`schedule-heartbeat-lock`，PR #4305）落地后**第一次日巡检自己报出来的两条红**。
> 现场与归因都在 PR #4305 的回读评论里（`#issuecomment-6390615188`）——那条评论当时把成因写成
> 「自指：巡检作业从没跑过所以永远 NEVER_RAN」，并顺带把 `dep-audit.yml` 列成一条真欠账。
> **两处都归错了**，本 change 同时勘误（见 design §1）：自指确实存在但是一次性的，天天必红的那条来自**采集窗口截断**。

## Why

判据主采集读的是 `GET /actions/workflows/<file>/runs?per_page=100`，即**最近 100 条 run**，不分 event。
对本仓多数作业，这 100 条覆盖好几周，窗口绰绰有余；但对被 PR 触发的作业（`dep-audit.yml` 同时挂在
`pull_request` 上），窗口只覆盖 13.4 小时。2026-10-25 现场（当场重取，命令见 design §4）：

- `dep-audit.yml` 的最近 100 条**全是 `pull_request`**，窗口只回溯到 13.4 小时前
  （最新 2026-10-25T02:56:16Z、最旧 2026-10-24T13:34:15Z）；
- 同一作业按 `event=schedule` 查，得到 **4 条 completed 的 schedule run**，最近一条 2026-10-19T08:08:10Z，
  weekly 周期、阈值 176h、实测 age **139.0h** ⇒ 真实档位是 **OK**；
- 判据当时打印的是 `NEVER_RAN … completed_schedule_run=0`，**每天红一次**。

这就是本仓点过名的那一型：**「扫到的窗口里没有」不等于「从来没跑过」**（`截断的输出不构成证据`、
`零命中先证明坐标是旧的`）。上一刀把"取不到数"与"取到且新鲜"分成了两档，却没把
"取到了但窗口不够长"当成第三档——因为当时还没有繁忙作业来撞它。

第二条红是**巡检作业自己**：`schedule-heartbeat.yml` 每天 04:30 UTC 跑一次，扫描那一刻它唯一的
schedule run 就是**此刻正在跑的这条**（`status=in_progress`）。旧判据对 `queued/in_progress` 一律
`NEVER_RAN` ⇒ 首跑必假红一次。但不能就此一律放行——"runner 长期排队永不 completed"正是判据文件头
**刻意要抓的第 4 条成因**。两种情况形状相同、结论相反，区别只有一个问题：**卡了多久**。

## 打算做什么（Details）

1. **两趟取证**：主窗口无心跳时，不直接落 `NEVER_RAN`，先发一次**带 `event=schedule` 的 witness 查询**
   （换坐标去问，而不是拿同一个截断窗口自证）。witness 查到心跳 ⇒ 判 `OK` 并把降级**写在读数里**
   （`心跳来源=witness`、`采集窗口=满`）；witness 明确零条 ⇒ `NEVER_RAN` 这次是**被证明的**，不是被假设的；
   witness 自己取不到数或抛错 ⇒ `SCANNER_FAULT`（rc=2），既不塌回 `NEVER_RAN` 也不放行成 `OK`。
2. **在途另成两档，用同一把周期时钟切**：witness 里有 schedule run 但没有 completed 的，按最近一次起跑
   时刻与该行自己的阈值比：`age ≤ 阈值` ⇒ `PENDING_FIRST`（出声、不阻断）；`age > 阈值` ⇒
   `NEVER_COMPLETED`（红，rc=1）。**不新增常量**——新增一个"排队宽限"就等于再造一次阈值口径漂移。
3. **`conclusion=failure` 仍算心跳**（上一刀定的口径不变）：本判据问"跑没跑"，"跑失败"归报警那一刀管。
4. 采集器把 `truncated`（本次读数是否顶到 `per_page`）作为**返回值的一格**回报，CLI 首行打印 `witness=` 计数；
   两个投影（judge 面与命令行面）各有一条断言——本刀实测到命令行面那格**第一版恒 0**，
   是新增断言当场抓出来的（变异 m31 钉住）。
5. 共用收集器：`heartbeatStamps` 与 `pendingScheduleAttempts`（原名 `pendingScheduleStamps`，采纳 QM-6 i4 后
   改带 status 返回条目）的读形状校验抽成一份（`validateRunShape` +
   `scanSchedule(runs, statusKeep)`）。理由不是"顺手收敛"：两份逐字相同的校验让既有变异 m7 的锚点
   命中 2 次、驱动拒绝动手——**歧义锚点是重复实现的机械症状**（记在 design §3）。

## 不做什么

- **不做 fs/子进程级隔离**，与上一刀探测器那支的裁决同理：本刀只加"第二趟查询"，不引入新的执行面。
- **不为 `dep-audit-refresh.yml` 开豁免**：那条是**真**欠账（cron 2026-10-24T03:38Z 才加进作业，
  第一次到期在 10-25 03:17Z 之后），巡检会随第一次成功 run 自愈。用 git 历史给它做"宽限"被否证：
  心跳作业的 checkout 没有 `fetch-depth`，`git log --diff-filter=A` 量到的是浅边界日期而不是添加日期。
- **不放宽阈值/加大 per_page 了事**：把 `per_page` 抬到 1000 只是把截断从 14 小时推到几天，
  繁忙仓库照样撞；而放宽阈值是把"漏一天"的发现时间推后，与上一刀实测口径直接冲突。

## 验收

- 25 条行为锁（H1-H25，含本刀新增 H24/H25 与 H17 的两条 witness 投影断言）全绿；
- 变异驱动 `CAUGHT=MISSED=PROBLEM=0` 读数齐全（`ALLOWED_MISSED` 仍为空 ⇒ 不允许任何 MISSED）；
- 对真仓现跑：`dep-audit.yml` 由 `NEVER_RAN` 转 `OK 心跳来源=witness 采集窗口=满`；
  `schedule-heartbeat.yml` 由 `NEVER_RAN` 转 `PENDING_FIRST`；`dep-audit-refresh.yml` 仍 `NEVER_RAN`
  （真欠账，逐条写进执行记录遗留）；
- 两把既有互咬锁（`check-schedule-failure-watch` 13 条、`check-coverage-budget` 26 条）照旧全绿。
