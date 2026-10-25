# Spec: heartbeat-window-witness

> 本 delta 细化 `schedule-heartbeat-lock`（PR #4305）的 Requirement 1/2：那两条把
> 「没跑过」与「我不知道」分成了两档，本 delta 补上第三格——「我扫到的窗口里没有」，
> 并把「cron 兑现了但那一次还没跑完」从 `NEVER_RAN` 里拆出来。

## Requirement 5：`NEVER_RAN` 必须由第二趟取证支撑，不得由主窗口的缺席支撑

- 主查询（不带 event 过滤、`per_page` 上限）零条 completed schedule run 时，判据 **MUST** 再发一次
  带 `event=schedule` 的 witness 查询；只有 witness 也报零条 schedule run，才允许落 `NEVER_RAN`。
- witness 查询的**坐标必须与主查询不同**（服务端按 event 过滤），否则等于拿同一个截断窗口自证。
- 主窗口是否被填满，必须作为独立读数回报并打印（`采集窗口=满/否`）；`truncated` 的判据是
  「本次取到的条数是否顶到 `perPage`」，**MUST NOT** 写死 100（`perPage` 可配）。
- 由 witness 取得的心跳，输出 **MUST** 说话：行上 `心跳来源=witness`、首行 `witness=<n>`。
  judge 面计数与命令行面计数是两个投影，各须有自己的断言。

#### Scenario: 繁忙作业把自家 schedule run 挤出窗口
- **WHEN** `dep-audit.yml` 的最近 100 条 run 全是 `pull_request`（窗口只覆盖 13.4 小时），
  而按 `event=schedule` 查得到 4 条 completed schedule run（最近一条 144 小时前，阈值 176 小时）
- **THEN** `OK`，行上带 `心跳来源=witness 采集窗口=满`，首行 `witness=1`；**不得**出现 `NEVER_RAN`

#### Scenario: witness 也证明零条
- **WHEN** 主窗口有 push run，witness 查询返回空数组
- **THEN** `NEVER_RAN`、退出码 1，明细行打印 `witness_schedule_run=0`（这一次是被证明的，不是被假设的）

#### Scenario: 第二趟取证自己失明
- **WHEN** witness 查询返回 `ok:false`，或采集器在该趟**抛错**
- **THEN** `SCANNER_FAULT`、退出码 **2**，且文案点名是 witness 那一趟（两条分支各一条锁：`!ok` 与 `throw`）；
  **MUST NOT** 塌回 `NEVER_RAN`，也 **MUST NOT** 放行成 `OK`

## Requirement 6：在途的 schedule run 按该行自己的阈值切成两档

- witness 里存在 `event=schedule` 且 `status≠completed` 的 run 时，取最近一次起跑时刻与该行的
  `阈值_hours`（= 周期 + 宽限，与 LATE 用**同一把时钟**）比较：
  `age ≤ 阈值` ⇒ `PENDING_FIRST`（出声、退出码 0）；`age > 阈值` ⇒ `NEVER_COMPLETED`（退出码 1）。
- **MUST NOT** 为这一族新增独立常量或新宽限：新增"排队宽限"等于再造一次阈值口径漂移。
- `PENDING_FIRST` **MUST NOT** 被计入 FAIL；`NEVER_COMPLETED` **MUST NOT** 被并入 `PENDING_FIRST`；
  两者都 **MUST NOT** 落进 `faults` 桶（新档必须在 CLI 计数循环里显式领自己的桶）。

#### Scenario: 巡检作业首跑看见自己
- **WHEN** `schedule-heartbeat.yml` 唯一一条 schedule run 就是此刻正在跑的这条（1 小时前起跑，阈值 32 小时）
- **THEN** `PENDING_FIRST`、退出码 0，明细行说明「cron 已兑现、那一次尚未 completed，不计欠账」

#### Scenario: 排队超过预算
- **WHEN** 同一条 in_progress 的 schedule run 已起跑 40 小时（阈值 32 小时）
- **THEN** `NEVER_COMPLETED`、退出码 **1**，并打印 `上次尝试=40.0h 阈值_hours=32.0`

#### Scenario: 阈值两侧各一条断言
- **WHEN** 同一夹具分别取 30 小时与 40 小时
- **THEN** 30 小时 ⇒ `PENDING_FIRST`；40 小时 ⇒ `NEVER_COMPLETED`（取向由本条与既有 H3 分别钉住，不得合并）

## Requirement 7：读形状校验只许有一份实现

- `heartbeatStamps` 与 `pendingScheduleAttempts` **MUST** 共用同一份读形状校验与时间戳收集实现
  （`validateRunShape` + `scanSchedule(runs, statusKeep)`），各档只声明自己的 `status` 取向。
- 校验顺序保持既有语义：先对**所有** run 校验必需字段（不分 event），再按 event/status 过滤，
  最后只对被挑中的那条解析 `created_at`。
- 判据：变异驱动对"必需字段校验"只允许存在**一个锚点**（命中 2 次即拒绝动手）。

#### Scenario: 采集器字段名与 API 漂移
- **WHEN** 任一趟返回的 run 缺 `status`
- **THEN** 抛「缺必需字段 status（采集器与 API 契约漂移）」⇒ `SCANNER_FAULT`、退出码 2，
  两趟取证走的是同一份校验，不存在"只守了主查询"

## Requirement 8：第二趟取证自身的覆盖度与采集预算都必须可见

> 本 requirement 是 QM-6 外部评审两条 Warning 的落点（采纳后当场发现同一族还有第三格，一并写在这里）。

- witness 查询**自己**也可能被 `perPage` 截断。判据 SHALL 把这一事实回报并打印（`witness采集窗口=满`），
  在 `OK`、`LATE` 与 `NEVER_RAN` 三种出口上**都**出声——只在 OK 行出声会让"迟到的那条其实是换坐标查到的"
  这一格从日志里消失。
  档位结论不受 witness 截断影响的前提**必须被写明**：GitHub 的 runs 列表按 `created_at` 降序返回，
  截断只砍得掉更旧的 run；这句话是本档不被误读成"第二次失明"的依据，不得只留在口头。
- 采集总成本 SHALL 有一条**不倒挂**的机械判据：`timeout-minutes × 60 ≥ 判据域作业数 × 2 趟 × COLLECT_TIMEOUT_MS`
  （H27）。该判据每次跑打印自己的三个数，并对"判据域退化"（作业数低于下界）同样红——
  否则作业数掉到 0 会让不等式恒成立，读起来像"预算充裕"。
- **不得**用"把超时值调大"或"给 witness 加限流"来交这条预算：前者制造新的未对账常量，后者会让
  第二趟在真需要它的现场缺席。今天的实测是 `声明 600s ≥ 最坏 240s（6 条作业）`，余量有据；
  余量耗尽时的正解是翻页聚合（见遗留 3）。

#### Scenario: witness 也顶到了上限
- **WHEN** 主窗口被 100 条 `pull_request` 填满，witness 按 `event=schedule` 也返回 100 条（其中最新一条 40 小时前、阈值 176 小时）
- **THEN** `OK`，行上同时出现 `心跳来源=witness`、`采集窗口=满`、`witness采集窗口=满`

#### Scenario: 迟到的那条也是换坐标查到的
- **WHEN** 同上但 witness 最新一条在 200 小时前
- **THEN** `LATE`，且**同样**带 `心跳来源=witness` 与 `witness采集窗口=满`（变异 m34：把 LATE 行的标签摘掉必须红）

#### Scenario: 采集成本涨过声明的预算
- **WHEN** 单趟硬超时或作业数增长使 `作业数 × 2 × 单趟超时 > timeout-minutes × 60`
- **THEN** H27 当场红并打印两侧数字（它测的不是"今天够不够"，是"够不够会不会悄悄不成立"）

## Requirement 9：两档在途也必须说出"结论来自第二趟"，且 event 的空串不等于缺席

> 本 requirement 的两个落点都是**采纳动作自己逼出来的**：i3 只说了"witness 的截断没检查"，
> 顺着这条改下去才发现 `LATE` 与两档在途原本也不出声（第二落点），以及空串与哨兵同形（i6）。

- 承载"这一行的结论由哪一趟取证给出"的字段 **MUST** 只有一个，三种出口共用它；标签按出口选词：
  `OK`/`LATE` 打 `心跳来源=witness`（确实取到了心跳），`PENDING_FIRST`/`NEVER_COMPLETED` 打
  `证据来源=witness`（取到的是未完成的 run，**没有心跳**，打"心跳来源"等于造出一条假证据）。
- 首行 `witness=` 计的是"有多少行的结论来自第二趟"，因此**必须**把在途两档与"witness 也证明零条"的
  `NEVER_RAN` 一并算进来；judge 面与命令行面两个投影各有一条断言（H17 / H18）。
- 采集器的"不带 event 过滤"**只能由 `q.event === undefined` 表达**。显式传空串是调用方写坏，
  **MUST** 返回 `ok:false` 并点名原因，**MUST NOT** 静默退化成主查询——
  "想问第二趟、实际问的是第一趟"恰恰是本判据第一个真实假阳性的形状。

#### Scenario: 首跑在途那一行
- **WHEN** 主窗口被 push run 填满、witness 里有一条 1 小时前起跑的 `in_progress` schedule run
- **THEN** `PENDING_FIRST`、rc=0，行上带 `证据来源=witness`，首行 `pending=1 never_completed=0 witness=1`

#### Scenario: 排队超预算那一行
- **WHEN** 同上但那条 run 已起跑 40 小时（阈值 32 小时）
- **THEN** `NEVER_COMPLETED`、rc=1，行上同样带 `证据来源=witness`（变异 m35：把标签摘掉必须两条一起红）

#### Scenario: 调用方传了空 event
- **WHEN** `runsOf('a.yml', { event: '' })`
- **THEN** `ok:false` 且一次出站都不发；而 `runsOf('a.yml')`（不传）照旧合法且查询串里没有 `event=`
  —— 两者必须**不同形**（变异 m36：退回"空串当没传"必须红）

## Requirement 10：witness 的三条失明分支各自受保护，且预算读数与判据同源

> 这一条由 QM-6 第四轮评审的两项采纳换来：i1（Critical，真的）与 i2（预算只在 PR 侧可见）。

- `judge()` 里对 witness 返回值的**每一次解析**都必须自带保护，包括"两趟共用同一份校验"这种看似 redundant 的位置：
  `completed` 档与 `pending` 档**触发的输入集不同**（前者把未完成的 run 过滤掉、从不解析它的 `created_at`；
  后者恰恰只解析未完成的）⇒ 上一趟的 `try/catch` 结构上兜不住这一趟。三条分支各一条锁、各一条变异：
  `!ok`（H21）、采集抛错（H25）、在途读数形状不合（H30 / m40）。三条都落 `SCANNER_FAULT` 退出码 2，
  **MUST NOT** 外抛异常，**MUST NOT** 塌回 `NEVER_RAN`。
- 最坏采集成本（`域内作业数 × 2 趟 × COLLECT_TIMEOUT_MS`）**MUST** 在两个地方以同一个公式现算：
  PR 侧的预算锁 H27，以及判据每天真跑时打印的首行 `采集最坏秒数=`（m41 打掉后者必须红）。
  只在锁里算，等于现场对自己的成本永远是瞎的——那正是本判据立项要消灭的形状。
- `runsOf` 不是可信输入面：它的返回值在进入档位判定前**必须**整体过 `validateRunShape`
  （非数组 / 非对象 / 缺必需字段 / 时间戳不可解析四种各自出声）。多余的字段被忽略而不是被消费，
  因此注入 `verdict` 之类的键不具备通路——这一句是驳回"注入任意 verdict"那种说法的依据，
  写下来是为了让下一个改这里的人知道判据在哪。

#### Scenario: 未完成的 run 时间戳坏了
- **WHEN** 主窗口被 push run 填满，witness 返回一条 `{status:'in_progress', created_at:'not-a-date'}`
- **THEN** `SCANNER_FAULT`、rc=2，明细点名「witness 在途读数形状不合」；**不得**看到未捕获异常，
  **不得**报 `NEVER_RAN`，也不得报 `PENDING_FIRST`（这条 run 的时间根本不可信）

#### Scenario: 真跑那一次自己说成本
- **WHEN** 判据对真仓跑一次（6 条带 schedule 的作业、单趟硬超时 20s）
- **THEN** 首行含 `采集最坏秒数=240`，数值由 `作业数 × 2 × 单趟超时` 现算，不写死
