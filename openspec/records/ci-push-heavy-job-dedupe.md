---
record: ci-push-heavy-job-dedupe
task: 主干 push 侧的重型门禁去重 —— 修 electron-ci 桌面步骤的 25.3 分钟空等，并让 push 侧不再重复跑第三遍全量覆盖率
date: 2026-10-25
branch: ci-push-heavy-job-dedupe
---

## 本次执行记录：主干 push 侧的重型门禁去重（ci-push-heavy-job-dedupe，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **CI 配置 + 工具脚本变更**（`scripts/electron-ci-desktop-step.js` 及其测试、`.github/workflows/quality-gate.yml`、`.github/scripts/workflow-contract.test.js` + 1 份执行记录）。隔离方式：沙箱内**独立 clone**（与用户主工作区物理分离）+ 独立分支 `ci-push-heavy-job-dedupe`（裸 task 名）。基线 = 合并后的 main tip（`3deac93`），合并前已 rebase 到最新 main（`9eccf3cf`）。 |
| 第一性原因（QM-5 ①） | ✅ | **不是「CI 慢」，是进程在空等**：main push 的 `Electron CI / electron-tests` 作业里，桌面全量那一步的墙钟是 **45.0 分钟**，而脚本自报的逐片 `elapsed` 只有 **19.7 分钟**。根因：整步预算用 `sleep(2700000)` 实现，`sleepDefault` 造的是**普通定时器**；Node 事件循环只要还有一个 pending timer 就不会退出 ⇒ 测试跑完后进程仍挂到 45 分钟预算到期才退出 ⇒ **每次 push 白等 25.3 分钟**（那段窗口里既没排队也没跑测试）。<br>⇒ **为什么以前没人发现**：同一次作业里 `QG Desktop Shards (1/2)` 同样跑桌面全量，只用 21.4 分钟且**无任何空档**（它走 PowerShell，没有 Node 定时器）⇒ 差异只可能来自本脚本，而脚本的**自报耗时**又是准的（19.7 分钟）⇒ 读脚本输出看不出问题，**只有读作业的 step 时间戳才看得出**。 |
| 逃逸分析（QM-5 ②） | ✅ | ① **日志层看不出**：脚本自己打印的 `elapsed=1180237ms` 是真实耗时，**完全正常** ⇒ 没有任何错误信号；② **"CI 慢"的直觉会把它归错因**（会怀疑 runner 慢、测试多、并发不够）——实测排队只有约 3 分钟，瓶颈是**作业内部的时间空档**；③ **覆盖率是全局比率**，删/改高覆盖模块会让门禁变红（既有教训），所以「哪一段没被覆盖」类猜想也不成立。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | **刀 A（修真实 bug，不改测试行为）**：保留 `STEP_BUDGET_MS=2700000` 与现有 shard/预算语义，只清 deadline timer 的生命周期泄漏 —— ① `sleepDefault` 的 timer 加 `unref()`（兜底：即使漏取消也不阻止进程退出）；② `runStep` 收敛后主动 `deadlineTimer.cancel()`（主修法）。⚠️ 只做 ① 不做 ② 有副作用：若那一刻事件循环里只剩这个 timer，进程会**立刻退出**（unref 的 timer 不保活）⇒ 可能发生在 report 还没写出去之前 ⇒ 两者必须都在。<br>**刀 B1（去掉 push 侧重复的第三遍全量**覆盖率**）**：`QG Coverage` 在 `pull_request` 侧完整保留（覆盖率验的是 **merge preview** ⇒ 仍是合并前的完整守门），在 **push 侧不再跑**（`if: … && github.event_name == 'pull_request'`）。<br>⚠️ **别把 push 侧的「桌面全量」也当成重复**：`.github/workflows/electron-ci.yml:138` 的既有设计写明那一步「**PR 上跳过**（同一批桌面测试已由 QG desktop-shards 分片执行），**仅在 main push 运行**，保留『单 worker 串行确定性模式』的 CI 覆盖与**第二次独立运行的 flake 检出**」⇒ ⇒ **它不是重复，是专门检出 flake 的第二次独立运行** ⇒ **必须保留，只能修快**（刀 A 精确命中的就是它的空等）。真正重复的是**第三遍的覆盖率全量**（刀 B1 去掉的正是它）。<br>⇒ **回归保护**：三条判据（`p.timer.hasRef() === false` / 注入带 cancel 计数的 sleep / 端到端子进程行为锁「`runStep` 返回后进程须立即退出」）+ workflow 契约锁（`coverage` 必须 PR 侧必跑、push 侧不得跑、不得含 `always()`）。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 修法旁写明**为什么两条要一起做**（只 unref 会导致过早退出）⇒ 后人不会为了"简化"删掉 `cancel()`；② 注释里写明**别把它读成「测试慢」**并给出对照组（`QG Desktop Shards` 同量任务 21.4 分钟无空档）⇒ 防止下次又从错的方向查；③ 锁住 `coverage` 的**双向语义**（PR 侧必跑 / push 侧不跑）⇒ 任何人想恢复或改这条 `if`，都会先撞到锁、必须先想清楚取舍；④ 覆盖率预算 registry 那格的 `provenance` 描述的是「从 main push 的 QG Coverage 作业读耗时」⇒ push 侧不跑后**采样面变窄**（PR 侧仍可采），已在本记录的「遗留」里如实登记。 |
| 行尾与 diff 对账 | ⏳ | 提交后以 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径核对 |
| 接线棘轮 | ✅ | 刀 A 的判据**就地加进既有**的 `scripts/electron-ci-desktop-step.test.js`（**未新增测试文件** ⇒ 不改 CI 分片分配）；刀 B1 的锁**就地改**既有的 `.github/scripts/workflow-contract.test.js`（不新建文件、不动 `max-lines-baseline.json` 的任何登记值） |
| QM-1 打包 / QM-4 视觉 | QM-4 N/A / QM-1 未执行 | **QM-4 视觉**：N/A（只改 CI 编排与工具脚本，不改任何运行时模板/样式 ⇒ 像素基线不受影响）。**QM-1 打包**：⛔ **本环境未执行**（沙箱无 Windows runner / Electron 二进制）⇒ 由 CI 的 `electron-tests` 覆盖 |
| QM-6 CCG 双模型外部评审 | ⛔ 未执行 | 本机无 `codeagent-wrapper`（仓外验证层引擎）⇒ **如实记「未执行」，不以自审冒充通过**。替代证据：**变异验证**（四处修法逐个退回旧实现形态，逐一确认判据变红）+ **端到端子进程行为锁** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`）。合并后 main push 的回读证据写在 **PR 评论**里，不写回本文件 |

## 根因的当场实测读数（全部来自 API 原始读数，非推算）

出处：tip `6e2b89c3`（#4394 合并后的主干）上 `Electron CI` run `40133795018` 的
`electron-tests` 作业（job id `120990994686`）。

| 读数 | 值 | 出处 |
|---|---|---|
| `electron-tests` 作业总墙钟 | `21:21:08Z → 22:08:17Z` = **47.1 分钟** | job 的 `started_at`/`completed_at` |
| 桌面全量那一步的墙钟 | `21:22:18Z → 22:07:18Z` = **45.0 分钟** | step「Unit tests (Vitest, non-Electron…)」 |
| 脚本自报逐片耗时 | `elapsed=1180237ms`（1/2）/ `elapsed=1033085ms`（2/2） | 作业日志的 `[electron-ci-step]` 行 |
| ⇒ **空等窗口** | **45.0 − 19.7 = 25.3 分钟**（与 `2700000ms` 预算分秒不差） | 上两行相减 |
| 同一作业里 `QG Desktop Shards` 的同量任务 | 21.4 分钟，**无空档** | 同批 push 作业读数 |
| `QG Coverage` 作业墙钟 | `21:23:34Z → 22:08:54Z` = **45.3 分钟** | quality-gate run `40133794923` 的 job `120991534855` |

⚠️ **一个决定方案形态的发现**：`QG Coverage`(45.3 min) 与 `electron-tests`(47.1 min) **几乎同时起止**
⇒ 二者**并行**而非串行 ⇒ ⇒ **单独修刀 A 不会缩短 settle 周期**（关键路径仍被 QG Coverage 的 45.3 分钟兜住），
⇒ **刀 A 与刀 B1 必须在同一个 PR 里一起合**；中间那轮若先合刀 A，settle 周期几乎不变。

## 刀 B 的方案取舍（为什么是 B1，而不是别的）

| 候选 | 结论 | 依据 |
|---|---|---|
| **B1**：push 侧跳过 `QG Coverage`，PR 侧完整保留 | ✅ **采用** | PR 侧覆盖率验的是 **merge preview**（base⊕head）⇒ 合并前的完整守门**一点没动**；push 侧那遍验的其实是「origin/main 当前状态」⇒ 与 PR 侧不是同一棵树 ⇒ 属**重复** |
| **B2**：让 `QG Desktop Shards` 产覆盖率、`QG Coverage` 合并两片 artifact | ⛔ **已被实测证伪** | 真实 `coverage-final.json` 对比：statements/lines/functions 全量与合并后相等，但 **branches 全量 `0/91904` ≠ 合并 `0/91888`（少 16）**；差异落在 `CreateHistory.vue`(249→245) 与 `CreateView.vue`(3198→3186) 两个 `.vue` ⇒ **分片覆盖率 merge 不保持 SFC branchMap 结构并集** ⇒ 分母偏小会让百分比偏大 ⇒ **门槛放松方向 ⇒ 不可采用** |
| **B3**：`QG Coverage` 改 matrix 分片 | ⛔ 不可行 | required context 名会变成 `QG Coverage (1/2)` ⇒ required 的 `QG Coverage` 缺失 ⇒ PR 永久 BLOCKED |
| **B4**：`QG Coverage` 只跑桌面端以外的覆盖率 | ⛔ 不可行 | 覆盖率 `include` 基本全是桌面端 ⇒ 覆盖率会塌到阈值以下 |
| **B5**：push 侧 coverage 改跑「非桌面端」子集 | ⛔ 同 B4 | 同上 |

## 本地验证的 Fresh 证据（沙箱内实跑）

| 验证 | 命令 | 结果 |
|---|---|---|
| 刀 A 判据 | `node --test scripts/electron-ci-desktop-step.test.js` | **15/15 绿**（既有 12 + 新增 3） |
| 变异 A | 去 `unref` + 去 `cancel` | **2 条红**（判据 13 + 端到端 15）⇒ 锁有牙齿 |
| 变异 B | 只去 `unref`（保留 `cancel`） | **1 条红**（判据 13） |
| 变异 C | 只去 `sleepDefault` 定义里的 `cancel`（保留 `unref`） | 0 失败 ⇒ **变异打偏**（没打到 `runStep` 的调用点）⇒ 不作证据 |
| 变异 D | 直接去掉 `runStep` 里的 `deadlineTimer.cancel()` 调用 | **判据 14 红** ⇒ 补做后确认判据 14 有牙齿 |
| 恢复核对 | 每次变异后按绝对路径恢复 | 0 失败 + 与备份**逐字节一致** |
| workflow 契约 | `node --test .github/scripts/workflow-contract.test.js` | **46/46 绿**（刀 B1 的锁随这条 test 一起进） |
| 刀 B1 锁的变异验证 | 逐个改 `coverage` 的 `if` 再跑同一条 | **5 组全被抓住**：① 删掉 `event_name` 条件（push 侧也跑）② 条件反转（`!=`）③ 加 `\|\| true`（字符串层面看不出 push 侧会跑）④ 换成 `push_request`（**PR 侧也不跑 = 降标准**）⑤ 摘掉 docs-only 短路 —— 每组都让那条 test 红；恢复后 0 失败且与备份**逐字节一致**<br>⚠️ 第 ②④ 组第一版**变异打偏**（替换串在文件里出现 4 处 ⇒ 断言拦住注入）⇒ 换成唯一锚点（整条 `if`）后重做才拿到有效读数 |
| 仓内门禁 | `check-max-lines` / `check-debt-budget` / `check-gate-record-debt` / `check-pr-exec-record` / `check-doc-abs-paths` / U+FFFD | 见 PR 评论里的收口读数 |

## 遗留（不假装已闭合）

- ⚠️ **刀 B1 的窄缺口（如实披露）**：push 侧不再跑覆盖率 ⇒ **主干当前状态的覆盖率体检从「每次 push」变成「每个 PR 的 merge preview」** ⇒ 合并之后、下一个 PR 之前的那段窗口里，主干覆盖率若漂移，**要到下一个 PR 的 PR 侧 coverage 才被发现**；若此后不再提 PR，则可能长期未发现。⇒ 恢复路径：① 恢复 push 侧 `coverage` job（改回一行 `if`）；② 或禁止并发合并（本仓合并波本就要求一个一个来，见既有纪律）。
- ⚠️ **覆盖率预算 registry 的采样面变窄**：`scripts/gate-timeout-registry.json` 里 `coverage` 那格的 `provenance.source` 描述的是「从 main push 的 `QG Coverage` 作业读耗时」⇒ push 侧不跑后，**该来源不再产生新样本**（PR 侧仍可采，但样本形状含 merge preview 准备，略长于纯 push）。⇒ 现状安全（`samples=51 ≥ minSamples`、`collectedAt=2026-10-24` 距今 1 天、`staleDays` 未到）⇒ 但**样本册的采集途径需要在下次复测时改写**（从 PR 侧采），否则到期时会因「无样本可采」而误判。
- ⚠️ **B1 降的是 push 侧的重复验证强度**，不是降低门禁标准：PR 侧覆盖率门禁**一字未改**、required context 集合**一字未改**（`QG Coverage` 仍是 required，只是它由 PR 侧提供）。
- ⛔ **QM-1 打包验证与 QM-6 外部双模型评审均未在本地执行**（环境不具备），依赖 CI 兜底。
- ⚠️ **刀 A 的收益需要合并后才会显现**：本地无法复现 Windows runner 上「两片并行 + 共享预算」的真实形状 ⇒ 合并后用仓内的复测入口 `node scripts/electron-ci-shard-audit.js` 读新形状的逐片墙钟，并对比 `electron-tests` 作业的 step 时间戳是否从 45.0 分钟降到约 20 分钟。

## CHANGELOG 条目

# fix(ci): 主干 push 侧去掉重复的第三遍全量覆盖率，并修掉桌面步骤 25.3 分钟的进程空等

- fix(ci): 桌面全量步骤的整步预算定时器不再让进程空等 ⇒ 每次 push 白等 25.3 分钟（实测：step 墙钟 45.0 分钟 vs 脚本自报 19.7 分钟）被消除；修法是 `unref()` 兜底 + 收敛后 `cancel()` 主修（两者缺一不可）。⚠️ push 侧那一步**不是重复**（`electron-ci.yml:138` 明写它是「第二次独立运行的 flake 检出」，PR 侧本来就跳过）⇒ **保留、只修快**。
- ci: `QG Coverage` 在 push 侧不再跑（PR 侧完整保留，覆盖率验的仍是 merge preview）⇒ 主干 push 的 settle 周期由约 48 分钟压到约 22–28 分钟；窄缺口（主干覆盖率体检改为随下一个 PR 一起发现）已在执行记录中披露。
- 动机：push 侧那遍**覆盖率**验的是「origin/main 当前状态」，与 PR 侧的 merge preview **不是同一棵树** ⇒ 属重复；而它是 push 侧 settle 周期的主因（与 `electron-tests` 并行，两边都接近 45 分钟）。

## learnings

### lesson: 「作业总耗时」与「脚本自报耗时」不一致时，空的那段不是「慢」，是**没在跑**

- **现场**：`electron-tests` 作业 47.1 分钟，其中桌面那一步墙钟 45.0 分钟，而脚本打印的逐片 `elapsed` 只有 19.7 分钟 ⇒ **25.3 分钟的空档**。
- ⭐ **判据**：任何「CI 慢」的排查，第一步不是看测试数量或 runner 排队，而是**把 job 的 step 时间戳与脚本自报耗时对齐**。两者之差 = 进程在空等。
- ⭐ **泛化**：Node 里「`setTimeout` 造的长预算」是一类**看不见的保活源** —— 事件循环只要有 pending timer 就不退出 ⇒ 测试早已跑完，进程仍挂着。修法两条（`unref` 兜底 + 收敛后 `cancel` 主修）缺一不可：只 `unref` 会让「事件循环里只剩这个 timer」时**提前退出**。
- 配套：**写复测入口比写注释有用**（本仓 `scripts/electron-ci-shard-audit.js` 是 #4398 留下的）⇒ 下次复核刀 A 的收益用它读，不要凭印象。

### lesson: **并行**的两条重作业决定了 settle 周期 ⇒ 修其中一条不缩短周期

- **现场**：`QG Coverage`(45.3 min) 与 `electron-tests`(47.1 min) 在同一次 push 里**几乎同时起止** ⇒ 它们是并行的。
- ⇒ 单独修 `electron-tests`（47.1 → 约 22）**不会**让 settle 周期下降（关键路径被 45.3 分钟那条兜住）⇒ **两刀必须同一个 PR 一起合**；中间那轮先合其中一刀，settle 周期几乎不变。
- ⭐ **泛化**：看「哪条作业最长」不足以定方案 —— 要看**关键路径**（并行作业里最长的那条），且**改完之后谁变成新的关键路径**要一并算。
- 同族：**分片合并覆盖率不是全量**（实测 branches 分母少 16，落在两个 `.vue` 的 branchMap 上）⇒ 「合并两片 artifact 省掉第三遍」这条路看着省事，实测被证伪 ⇒ 覆盖率是**阈值门禁**，分母偏小 = 门槛放松 = 危险方向。

### lesson: 降强度的方案必须把**窄缺口与恢复路径**写进记录，而不是只写「收益」

- **本片**：push 侧不跑覆盖率 ⇒ PR 侧的完整守门**没动**，但「主干当前状态」的体检从每次 push 变成随下一个 PR ⇒ 这个窗口期就是窄缺口。
- ⇒ 记录里必须写：**缺口是什么**（哪段时间里什么问题不会被发现）+ **恢复路径**（改回一行 `if` / 禁止并发合并）⇒ 否则下一个人只看到「省了 26 分钟」，不知道换来了什么。
- 配套：**registry / 样本册的采集来源被这次改动掐断**时，要在同一处登记（否则到期时会以「无样本可采」的形式误判成过期）。
