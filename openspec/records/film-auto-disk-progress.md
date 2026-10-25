---
record: film-auto-disk-progress
task: 修 M0 取证暴露的存量缺陷③（出片进度恒显 0/N），并为①②写下可执行规格
date: 2026-10-25
branch: film-auto-disk-progress
---

# 存量缺陷③：出片进度恒显 0/N（已修）+ ①②的可执行规格（已写）

## 1. 背景

M0 取证（PRD §3.2）暴露三个**存量缺陷**（今天就在让用户拿到缺镜成片 / 以为没在干活）：

| # | 缺陷 | 状态 |
|---|---|---|
| ① | 批内并发 2 × provider 串行受理 ⇒ 提交卡满 120s ⇒ 单镜 failed | ⏳ 规格已写（§3.2.5.2），实现待下一片 |
| ② | 客户端超时 ≠ 服务端停止 ⇒ 重投放大队列（单镜最多投 78 个请求）⇒ 雪崩 | ⏳ 规格已写（§3.2.5.2），实现待下一片 |
| ③ | **逐镜状态在批次收口时才回写** ⇒ 面板执行期间恒显 0/M | ✅ **本片已修** |

⚠️ **①②必须成套落地**：单独把「超时后不立即重投」拿出来 ⇒ 原本靠重投掩盖的「队列已饱和」
会**立刻**变成「快速缺镜」⇒ **用一种坏换另一种坏** ⇒ 规格里已把这条写死。

## 2. 本片做了什么

**新增读数 `doneCountOnDisk`**（磁盘为真）⇒ 面板进度不再恒显 0。

| 文件 | 改动 |
|---|---|
| `apps/desktop/electron/services/film-engineering/auto-runner.js` | 新增 `countShotsOnDisk(project, opts)`：数**本轮**各批目录里已存在的 `shot_NNN.mp4`（目录推导复用 `autoRunIdFor` / `locateShot` / `shotFileName` ⇒ 与落盘真源**同源**，不新增第二套路径推导） |
| `apps/desktop/electron/ipc-handlers/film-engineering-auto.js` | `projectView` 返回体加 `doneCountOnDisk`（**不动** `reconcileCounters` 的字段集 ⇒ 不撞 parity 锁） |
| `apps/desktop/src/views/film-auto/auto-progress-counters.js`（新） | 纯函数 `resolveProgressCounters`：一次产出 `displayDone` / `closeDone` / `diskDone` 三个值 |
| `apps/desktop/src/views/film-auto/useFilmAutoRun.js` | 轮询 / 事件 / 重开项目**三处**显示口径统一为 `displayDone`；**收口判定仍用 `closeDone`** |
| `apps/desktop/electron/services/film-engineering/auto-runner.test.js` | +3 例（磁盘计数 / 轮次隔离 / 非法输入） |
| `apps/desktop/src/views/film-auto/auto-frontend-utils.test.js` | +4 例（显示口径 / **收口口径不被磁盘污染** / 收口后一致 / 非法输入归 0） |

## 3. ★ 两条口径纪律（本片最要紧的东西）

| 口径 | 取值 | 用途 |
|---|---|---|
| `displayDone` | `max(台账 done, 磁盘已落盘)` | **仅用于显示** |
| `closeDone` | **台账 done** | **仅用于收口判定**（`done + failed >= total`） |

⛔ **磁盘有片 ≠ 该镜成功**（可能是上一轮残留、或该镜最终判失败）⇒
拿磁盘口径做收口判定 ⇒ 会在产物还在落盘时**提前收口**。

⇒ 落地形态：两个口径由**同一个纯函数**一次产出、**分别命名** ⇒
「用错口径」变成一次显眼的取值，而不是一条隐式约定。
⚠ 前端原有两处同名不同义的 `doneCount`（显示 vs 收口判定）已**消歧**（`counters.displayDone` / `counters.closeDone`）。

## 4. 验证

| 项 | 读数 |
|---|---|
| 单测 | 后端 20 + 前端 13 = **33/33 绿**（本地实跑） |
| 变异 V1 | 取消轮次隔离（永远数首轮 `b<N>` 目录）⇒ **红 1 条**（轮次隔离用例） |
| 变异 V2 | 显示口径改成「只取磁盘」（污染收口口径）⇒ **红 1 条**（收口口径用例） |
| 恢复后基线 | 33/33 绿 |
| U+FFFD | 6 个改动文件均 0 |

## 5. 诚实边界

- 本片**只修 ③**；①②的实现**不在本片**（规格写在 PRD §3.2.5.2，含数据校验 / 流程 / 功能逻辑 /
  交互逻辑 / 显示项 / 提示文字 / 验收 A34–A36）；
- 本片**未新增提示文字**：`runSummary` 在执行期读作「已落盘 N / M」已通顺；
  「产物正在落盘，进度以磁盘为准」这句**待做**（需区分「执行中」与「已收口」两种语义，验收 A33）；
- 「同批目录复用」时上一轮残留片仍会被计入 ⇒ 与既有 `syncProjectFromDisk`（同样以磁盘为真）**同源**
  ⇒ 口径一致，不新增第二种真相；已在代码注释里写明；
- 性能：每次 `auto-status` 轮询做 N 次 `existsSync`（360 镜 = 360 次 stat）⇒ 可接受。

## 6. 门禁

见 PR 评论与 CI。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |
