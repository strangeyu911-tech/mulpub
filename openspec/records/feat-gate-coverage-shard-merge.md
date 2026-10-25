---
record: feat-gate-coverage-shard-merge
task: 分片覆盖率合并判定器 —— 合并 desktop-shards 各片产物、按 vitest 原生语义判全局阈值（PR-1，可独立交付）
date: 2026-10-25
branch: feat/gate-coverage-shard-merge
---

## 本次执行记录：分片覆盖率合并判定器（feat-gate-coverage-shard-merge，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **工具 + CI 接线**（新增脚本 / 加 1 行 `node --test` / 加 1 个 devDep）⇒ 不走 docs-only 通道。隔离 worktree `/workspace/mp-p3`，裸分支 `feat/gate-coverage-shard-merge`，基线 `origin/main` = `cd83a925ab`（#4446 的合并提交） |
| 第一性原因（QM-5 ①） | ✅ | **同一套覆盖率被跑了两遍**：`QG Coverage`（required context）自己跑全量桌面测试（`vitest run --coverage --maxWorkers=1 --no-file-parallelism`，实测单趟 40–47 分钟），而 `desktop-shards` 已把同一套分两片跑在两个 runner 上（合计 20–25 分钟）**却不产覆盖率** ⇒ 合并吞吐被主干回灌串行卡死（合并波实测上限 ≈ 1.5 个/小时） |
| 逃逸分析（QM-5 ②） | ✅ | ① **旧设计稿判断错**：曾写「P3-1 不动判定层」⇒ 读代码后发现 `workflow-contract.test.js` 有**三处必动锁**（`coverage` 作业的 `needs`、`NEEDS_PREP` 里 `coverage` 的豁免、`test:coverage` 脚本锁）⇒ 已把 P3 拆成两片；② **旧 spike 结论作废**：曾测得「shard 不判阈值」⇒ 实测 `vitest --shard` **照样按全局阈值判**（`resolveThresholds` 无 shard 分支）⇒ 分片侧必须显式 `--coverage.thresholds.*=0`；③ **「可加载 ≠ 能用」**：手搓的覆盖率夹具形状对，但真 vitest 产物的 `fnMap` 每项键名是 `loc`（不是 `decl`）⇒ 合并同文件时抛 `Cannot destructure property 'start' of 'undefined'` |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `scripts/merge-coverage-shards.js`（合并 + 按 vitest 原生语义判阈 + **三态退出码 0/1/2**）+ `scripts/merge-coverage-shards.test.js`（**7 例**，含**变异反证 ×2**）。**7/7 绿**；变异反证：① 去掉「合并」⇒ `files` 由 2 变 1（被 ① 抓住）；② 把失明的 `exit(2)` 改成 `exit(0)` ⇒ 失明被读成通过（被 ④ 抓住） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **三处假绿被显式堵住并各有断言**（见下「假绿三洞」）；② 阈值**只有一个真源**（桌面端包的 `vitest.config.js`），脚本不硬编码（自测里剥注释后按真源实际值逐个查）；③ 判定器接进 `static-gates`（`QG Static`）⇒ 满足仓内「未接线测试棘轮」（`check-unwired-tests.test.js` **39/39 绿**） |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 相等（见「改动面」一节）；新增/改动文件行尾全 `w/lf`；U+FFFD 扫描 **0 处**（`check-text-encoding-integrity.test.js` **5/5 绿**） |
| 接线棘轮 | ✅ | 新增 `scripts/merge-coverage-shards.test.js` **已被 `quality-gate.yml` 的 `static-gates` 显式点名**（`node --test`）⇒ `scripts/check-unwired-tests.test.js` **39/39 绿**（该门禁按 git 域扫描每个 `*.test.*`，未被 workflow 点名即判红） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（新增的是 Node 脚本 + CI 接线；无界面、无打包产物） |
| QM-6 CCG 双模型外部评审 | ⚠️ **未执行** | 本机无 `codeagent-wrapper` ⇒ 如实写「未执行」，**不以自审冒充通过**。自审部分已做：变异反证 ×2 + 真产物对账（见下） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；合并后 main push 的回读证据写在 PR 评论里 |

### 假绿三洞（本片实测抓到的，不是推演）

| # | 洞 | 实测形态 | 堵法 |
|---|---|---|---|
| H1 | `createCoverageMap({任意键:'任意值'})` **不抛错**，把该键当成「零语句的文件」 | 读数 `total:0 / pct:100` ⇒ 阈值判定**全绿** | 合并前**逐份校验 istanbul 形状**（`statementMap`/`fnMap`/`branchMap` + `s`/`f`/`b`） |
| H2 | 空 coverage map ⇒ 摘要 `pct` 是**字符串** `"Unknown"` | `"Unknown" < 55` 在 JS 里是 **false** ⇒ 判定**全绿** | 合并后必须**至少一个文件**；四项 `pct` 必须是**有限数字** |
| H3 | 「读不到分片产物」被当成「0 个文件」 | 同 H2 ⇒ 全绿 | 单独失明通道（rc=2） |

⇒ 三条各有断言（行为锁 ④ 的 4 种形态）。

### ★ 真产物对账（不是手搓夹具）

微型工程真跑 `vitest@4.1.9` + `@vitest/coverage-v8@4.1.9`（两个源文件 / 两个测试文件）：

| 口径 | statements | branches | functions | lines |
|---|---|---|---|---|
| 分片 1 单独 | 33.33% | 0% | 25% | 33.33% |
| 分片 2 单独 | 33.33% | 0% | 25% | 33.33% |
| **两片合并（本判定器）** | **66.66%** | **0%** | **50%** | **66.66%** |
| **全量产物（本判定器）** | **66.66%** | **0%** | **50%** | **66.66%** |
| **全量产物（vitest 自己报的）** | **66.66** | **0** | **50** | **66.66** |

⇒ ① **合并口径 == 全量口径**（逐字相同）；② **本判定器 == vitest 自己**（同一份产物逐字相同）；
③ **单看任一片都会低估**（33.33% vs 66.66%）⇒ 这是「不能拿单片判全局阈值」的机器证据。

### ★ 本次踩到的两个坑（自己引入、自己抓出）

**坑一：注释里的路径字面量让 CI 契约锁把作业误判成「跑桌面测试的作业」。**

- 现象：我在 `quality-gate.yml` 的 `static-gates` 里加了一行 `node --test scripts/merge-coverage-shards.test.js` ⇒
  `workflow-contract.test.js` 从 **46/46 绿** 变 **45/46 红**（对照实验：在干净 `origin/main` 检出上跑同一命令 ⇒ 46/46 ⇒ **是我引入的**）。
- 根因：那条锁用**内容级启发式**收集「可能 `require('electron')`」的作业 ——
  「步骤 run 块里**同时**出现桌面端路径与测试关键字 ⇒ 该作业必须先备好 Electron 二进制」。
  我在注释里写了桌面端包的 `vitest.config.js` 路径 ⇒ **第一个条件**由假变真 ⇒ `static-gates` 被收进那个清单。
  ⚠ 而本步骤跑的是脚本自测、**根本不加载 Electron** ⇒ 是**误判**。
- 处置：改写注释措辞（路径字面量留在 PRD 与脚本头里，不留在 workflow 注释里）⇒ 恢复 46/46。
- 泛化：**内容级启发式锁的输入是「整个 run 块的文本」⇒ 注释与路径字面量都会成为判据输入**。
  ⇒ 写注释时要知道自己在给判据喂输入；这里也暴露该启发式本身偏脆（误判方向是「多要求一步准备」，
  属安全侧，但会让无关改动撞红）。

**坑二：变异体写在 `/tmp` ⇒ 依赖解析不到仓内 `node_modules` ⇒ 读数不可比。**

- 现象：变异反证第一次跑出来是「空输出 + 退出码 2」。
- 根因：变异体副本在 `/tmp` ⇒ `require('istanbul-lib-coverage')` 沿 `/tmp` 向上找不到仓内 `node_modules`
  ⇒ 走了「失明」分支 ⇒ **读数与真实路径不可比**（这正是「变异打偏 ≠ 锁没牙齿」的又一形态）。
- 处置：跑变异体时显式给 `NODE_PATH=<仓根>/node_modules` ⇒ 读数与真脚本同口径。

### 本机门禁读数

| 门禁 | 命令 | 结果 |
|---|---|---|
| 行为锁 | `node --test scripts/merge-coverage-shards.test.js` | **7/7 pass** |
| CI 契约锁 | `node --test .github/scripts/workflow-contract.test.js` | **46/46 pass**（对照：干净 `origin/main` 同为 46/46） |
| 未接线测试棘轮 | `node --test scripts/check-unwired-tests.test.js` | **39/39 pass** |
| 编码完整性 | `node --test scripts/check-text-encoding-integrity.test.js` | **5/5 pass** |
| 文档绝对路径 | `node --test scripts/check-doc-abs-paths.test.js` | **53 例 52 pass / 0 fail** |
| 品牌残留 | `node scripts/check-no-brand-residue.js` | ✅ PASS（扫描 12885 个 tracked 文件） |
| 逐文件行数门禁 | `node .github/scripts/check-max-lines.js` | ✅ 无新增超大文件（超限 94 / 挂账 94 / 墓碑 6 / 点名还账 20） |
| 债务预算 | `node scripts/check-debt-budget.js` | ✅ 所有债务指标在基线内 |
| openspec 变更完整性 | `node scripts/openspec-sync-check.js` | ✅ `OK: 387 tasks, 116 active changes, 246 archives` |
| QM-5 行集棘轮 | `node scripts/check-record-qm5-rows.js` | ✅ 行集齐全、欠账清单无新增无陈旧 |
| 执行记录欠账 | `node scripts/check-gate-record-debt.js` | ✅ OK（配对 131 组 / 违例 0） |

### 改动面

| 文件 | 改动 |
|---|---|
| `scripts/merge-coverage-shards.js` | **新增**：合并 N 份 istanbul 产物 + 按 vitest 原生语义判阈 + 三态退出码；`--dir` / `--config` / `--thresholds` 三种入口 |
| `scripts/merge-coverage-shards.test.js` | **新增**：7 例行为锁（含变异反证 ×2） |
| `package.json` | 根 devDependencies 加 `istanbul-lib-coverage: 3.2.2`（**版本钉死**，与 vitest 侧一致） |
| `pnpm-lock.yaml` | **+3 行**（该包**已在 lockfile 里**，是 `@vitest/coverage-v8` 的传递依赖 ⇒ 加成直接依赖不引入新包） |
| `.gitignore` | 加 `!scripts/merge-coverage-shards.js`（`scripts/*.js` 是**整目录忽略** ⇒ 漏这条＝提交里根本没有它） |
| `.github/workflows/quality-gate.yml` | `static-gates` 加**一行** `node --test scripts/merge-coverage-shards.test.js` + 说明注释（**不改任何作业的判定逻辑**） |
| `01-docs/PRD-GATE-COVERAGE-SHARD-MERGE-2026-10-25.md` | **新增**：动因 / 技术前提（实测）/ 判据设计 / 真产物对账 / 验收 / 遗留 |
| `openspec/changes/gate-coverage-shard-merge/` | **新增四件套**：proposal / design / tasks / specs |

### 遗留（不假装已闭合）

- **PR-2（本片不含，须人工过目）**：`desktop-shards` 两片加 `--coverage --coverage.reporter=json --coverage.thresholds.*=0`
  + 上传 artifact（⚠ artifact 名不能含斜杠 ⇒ `1/2` 不可直接用）+ `QG Coverage` 改 `needs: [changes, desktop-shards]`
  并下载合并判阈 + 三处 CI 契约锁同步 + `scripts/gate-timeout-registry.json` 的 `coverage` 一格**重采样**
  （**数值只能重采样，不能手改**）⇒ **改的是 required context 的判定依据** ⇒ 按纪律须人工过目。
- **收益上限要说清**：本片只解决「覆盖率被跑两遍」；`QG Coverage` 仍要下载并合并两片产物，
  而 `electron-tests`（实测 47 分钟）与两个 `QG Desktop Shards` 也在同一档 ⇒ **P3 不是只靠这一片就完事**。
- **QM-6 双模型外部评审未执行**（本机无 `codeagent-wrapper`）⇒ 本片只有自审 + 变异反证。
- **`workflow-contract` 的内容级启发式偏脆**（注释里的路径字面量会翻转作业归类）⇒ 已在本片规避，
  但那道锁本身值得单独评估（不在本片范围）。

## CHANGELOG 条目

# feat(gates): 新增分片覆盖率合并判定器（P3-1 第一片）

- 新增 `scripts/merge-coverage-shards.js`：把多个 runner 上各产出的覆盖率产物合并成一张全局覆盖率，
  按 vitest 自己的阈值语义判全局阈值，**阈值真源唯一**（桌面端包的 `vitest.config.js`），判定不引入第二口径。
- 判定分三态：**达标 / 未达 / 不可判定**。凡「读不到阈值、读不到产物、产物形状不认识、合并结果为空」一律判「不可判定」
  并以退出码 2 退出 —— **「没测成」不会被读成「通过」**。
- 配套 7 条行为锁（含两条变异反证），并接进 `QG Static` 作业；本片**不改动任何既有门禁的判定逻辑**。

## learnings

### lesson: istanbul 对形状不认识的输入不抛错而是读成 100% 覆盖率

**现场**：给合并判定器写形状校验时实测到 —— `createCoverageMap({任意键:'任意值'})` **不抛错**，
它把那个键当成一个「零语句的文件」⇒ 读数 `total:0 / pct:100` ⇒ 阈值判定**全绿**。
另一个同型形态：空的 coverage map 里 `getCoverageSummary().data[key].pct` 是**字符串** `"Unknown"`，
而 `"Unknown" < 55` 在 JS 里是 **false** ⇒ 判定同样**全绿**。

**根因**：「没有未覆盖的东西」与「没有数据」在覆盖率语义里长得一模一样；库层用 `pct=100` 表示前者，
用 `"Unknown"` 表示后者 ⇒ 两种都会把「阈值比较」变成恒不成立。

**可复用的 N 条**：

1. 凡是「用某个数值做比较」的判据，**先问「这个值取不到时比较会怎样」**：`NaN` / `"Unknown"` / `undefined`
   与数字比较**恒为 false** ⇒ 「比较不成立」会被读成「达标」。
2. 合并/聚合类读数必须**先判域（有没有数据、形状认不认识）再判值** ⇒ 域判据与值判据要**分开**，
   域不成立时必须走**独立的失败通道**（本片用退出码 2），绝不能让「域为空」落进「值达标」。
3. 库层「宽容地接受垃圾输入」不是安全的默认 ⇒ 消费方必须**自己校验输入形状**，
   并把校验写成**断言**（本片每种失明形态各一条），否则这类洞会静默变成永久假绿。
