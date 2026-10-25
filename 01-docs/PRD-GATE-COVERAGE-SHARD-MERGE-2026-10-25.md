# PRD — 分片覆盖率合并判定器（`gate-coverage-shard-merge`）

> 2026-10-25｜P3「主干 push 轻量化」的第一片（**PR-1**）｜分支 `feat/gate-coverage-shard-merge`
> 状态：**本片只交付「可独立验证的判定器 + 行为锁 + 依赖 + 接线」**；
> 「把它接进 `QG Coverage`、让 shards 产覆盖率」是**下一片（PR-2）**，且**须人工过目**（改「谁来守门」）。

---

## 一、为什么需要它（动因）

`QG Coverage` 是 branch protection 的 **required context**（经典 4 项之一），它自己跑一遍**全量桌面测试**：

```
pnpm --filter @multi-publish/desktop test:coverage -- --coverage.reporter=text-summary
# apps/desktop/package.json:49 = vitest run --coverage --maxWorkers=1 --no-file-parallelism
```

实测单趟 **40–47 分钟**（合并波读数：`QG Coverage` 48 分钟里 45 分钟是它自己在跑）。

而 `desktop-shards` **已经把同一套桌面套件分两片跑在两个 runner 上**（合计约 20–25 分钟）：

```yaml
# .github/workflows/quality-gate.yml · desktop-shards
strategy: { matrix: { shard: ['1/2', '2/2'] } }
```

⇒ **同一套覆盖率被跑了两遍**：一遍分片（**不产覆盖率**），一遍全量（产覆盖率）。
⇒ 合并吞吐被主干回灌串行卡住（实测合并波上限 ≈ 1.5 个/小时）。

**正解的方向**：让 `desktop-shards` 的两片**各自产覆盖率**，再由一个判定器**合并**后判全局阈值 ⇒
`QG Coverage` 不再自己重跑一遍。

---

## 二、本片的范围（重要：只做「可独立交付」的一半）

| | 本片（PR-1） | 下一片（PR-2，**须人工过目**） |
|---|---|---|
| 交付 | 合并判定器 `scripts/merge-coverage-shards.js` + 行为锁 + 依赖 + 接线进 `static-gates` | shards 加 `--coverage --coverage.reporter=json` + 传 artifact + `QG Coverage` 改 `needs: [changes, desktop-shards]` 并下载合并判阈 |
| 改「谁来守门」？ | **否**（新工具，不改任何作业的判据） | **是**（`QG Coverage` 的判定依据从「自己跑全量」变成「合并分片」）⇒ 按纪律须人工过目 |
| 风险 | 低：新增工具 + 自测；现有门禁一行未改 | 高：覆盖率门禁的口径迁移 |

> ⛔ **本片不改 `.github/workflows/quality-gate.yml` 里任何作业的判定逻辑**，只**在 `static-gates` 里加一行 `node --test`**。
> ⇒ PR-1 可在 CI 全绿后自动合并；PR-2 必须由人过目后再实施。

---

## 三、技术前提（全部实测，非推断）

| # | 事实 | 证据 |
|---|---|---|
| T1 | `vitest --shard` 模式**照样按全局阈值判**，没有 shard 豁免 | 实跑 shard 1/2：`ERROR: Coverage for statements (33.33%) does not meet global threshold (50%)` ⇒ 源码 `vitest/dist/chunks/coverage.*.js` 的 `resolveThresholds` 无 shard 分支 |
| T2 | ⇒ 分片侧**必须显式中和阈值**：`--coverage.thresholds.{statements,branches,functions,lines}=0` | 同上；否则两片必红 |
| T3 | 覆盖率产物必须用 **`--coverage.reporter=json`**（istanbul 形状） | `--coverage.reporter=blob` 产 V8 原始格式（`{result:[{scriptId,…}]}`），**不能**直接喂 `istanbul-lib-coverage`；`--merge-reports` 读的是**测试结果** blob，**不产覆盖率** |
| T4 | `istanbul-lib-coverage@3.2.2` **没有** `checkCoverage`；合并是实例方法 `createCoverageMap(a).merge(b)` | 实跑：`typeof lib.checkCoverage === 'undefined'` |
| T5 | 合并是**并集**（不是稀释） | 实跑真产物：单片 33.33% / 两片合并 **66.66%** / 全量产物 **66.66%** ⇒ 合并口径与全量**逐字相同**（见 §五） |
| T6 | vitest 原生阈值语义：`threshold >= 0` ⇒ 最低百分比（红条件 `pct < threshold`）；`threshold < 0` ⇒ 最大未覆盖数（红条件 `uncovered > -threshold`） | `vitest/dist/chunks/coverage.*.js` 的 `checkThresholds`；文案 `ERROR: Coverage for <key> (<pct>%) does not meet global threshold (<threshold>%)` |

---

## 四、判据设计

### 4.1 阈值真源唯一

阈值真源 = **`apps/desktop/vitest.config.js` 的 `test.coverage.thresholds`**（现行值 `statements:55 / branches:40 / functions:60 / lines:55`）。

判定器**不硬编码**这四个数字 ⇒ 阈值一改，判定自动跟着走 ⇒ **不引入第二口径**。
（自测里用 `--config <夹具>` 换判定依据，夹具不 require vite ⇒ 任何环境可跑。）

### 4.2 退出码三态

| rc | 含义 | 场景 |
|---|---|---|
| **0** | 达标 | 合并后四项都过阈值 |
| **1** | 阈值未达 | 合并成功但某项不达标 ⇒ 报 vitest 原生同形文案 |
| **2** | **失明** | 读不到阈值 / 读不到产物 / 形状不认识 / 合并失败 / 合并结果为空 / `pct` 不是数字 |

> ⛔ 「没测成」**绝不能读成「通过」** —— 这是本仓反复出现过的假绿形态。

### 4.3 ⚠ 三处必须显式堵住的假绿（2026-10-25 实测）

| # | 洞 | 实测形态 | 堵法 |
|---|---|---|---|
| H1 | `createCoverageMap({任意键:'任意值'})` **不抛错**，把那个键当成「零语句的文件」 | 读数变成 `total:0 / pct:100` ⇒ 阈值判定**全绿** | 合并前**逐份校验 istanbul 形状**（`statementMap`/`fnMap`/`branchMap` + `s`/`f`/`b`） |
| H2 | 空的 coverage map ⇒ 摘要 `pct` 是**字符串** `"Unknown"` | `"Unknown" < 55` 在 JS 里是 **false** ⇒ 判定**全绿** | 合并后必须**至少一个文件**，且四项 `pct` 必须是**有限数字** |
| H3 | 「读不到分片产物」若被当成「0 个文件」 | 同 H2 ⇒ 全绿 | 单独走失明通道（rc=2） |

⇒ 这三处都写进了行为锁的 **④ 失明 ≠ 通过**（4 种形态各一条断言）。

---

## 五、验证证据（真产物，不是手搓夹具）

### 5.1 真 vitest 产物的「合并 == 全量」对账

微型工程（`vitest@4.1.9` + `@vitest/coverage-v8@4.1.9`，两个源文件、两个测试文件）：

| 口径 | statements | branches | functions | lines |
|---|---|---|---|---|
| 分片 1 单独 | 33.33% | 0% | 25% | 33.33% |
| 分片 2 单独 | 33.33% | 0% | 25% | 33.33% |
| **两片合并（本判定器）** | **66.66%** | **0%** | **50%** | **66.66%** |
| **全量产物（本判定器）** | **66.66%** | **0%** | **50%** | **66.66%** |
| **全量产物（vitest 自己报的）** | **66.66** | **0** | **50** | **66.66** |

⇒ ① **合并口径 == 全量口径**（逐字相同）；
⇒ ② **本判定器 == vitest 自己**（同一份产物，逐字相同）；
⇒ ③ **单看任一片都会低估**（33.33% vs 66.66%）⇒ 这就是「不能拿单片判全局阈值」的机器证据。

### 5.2 行为锁（`scripts/merge-coverage-shards.test.js`，7 例）

| 例 | 锁的性质 |
|---|---|
| ① | **合并是并集**：同一文件被两片互补覆盖 ⇒ 100%（不是 50%）；不相交两文件 ⇒ `files=2` |
| ② | 阈值未达 ⇒ rc=1 + vitest 原生同形文案 |
| ③ | 负阈值 = 最大未覆盖数：未覆盖数超限才红 |
| ④ | **失明 ≠ 通过**：4 种失明形态（无产物 / 形状不认识 / 缺阈值项 / 空产物）全 rc=2 |
| ⑤ | 阈值**只有一个真源**：脚本不硬编码四个阈值（剥注释后按真源实际值逐个查）+ 默认路径指向真源 |
| ⑤-2 | `--config` 可换判定依据：夹具阈值 40 ⇒ 绿、100 ⇒ 红 |
| ⑥ | ⭐ **变异反证**：① 去掉「合并」⇒ `files` 从 2 变 1；② 把「失明」的 `exit(2)` 改成 `exit(0)` ⇒ 失明被读成通过。**两条都必须被锁抓住** |

⚠ ⑤ 的实现细节：**必须先剥注释再查数字** —— 否则脚本里「40–47 分钟」这类说明文字会把它自己触发（假红）。

---

## 六、验收

| # | 判据 | 本机读数 |
|---|---|---|
| A1 | 行为锁全绿 | `node --test scripts/merge-coverage-shards.test.js` ⇒ **7/7 pass** |
| A2 | 真产物对账（§5.1） | 四行读数逐字一致 ✓ |
| A3 | 阈值单一真源 | 剥注释后源码里**不含** 55 / 40 / 60 任一数字，也不含 `statements: <数字>` 形态 ✓ |
| A4 | 失明三态 | 4 种形态全 rc=2 ✓ |
| A5 | 依赖可解析 | 根 `package.json` devDependencies 加 `istanbul-lib-coverage@3.2.2`（**已在 lockfile 里**，`@vitest/coverage-v8` 的传递依赖 ⇒ 锁文件只 +3 行）✓ |
| A6 | 接线 | `static-gates`（`QG Static`）加 `node --test scripts/merge-coverage-shards.test.js` ⇒ 满足仓内「未接线测试棘轮」（`scripts/check-unwired-tests.js`）✓ |
| A7 | 不改「谁来守门」 | `quality-gate.yml` 里**只有一行新增的 `node --test`**，无作业级判定逻辑改动 ✓ |

---

## 七、遗留（下一片 PR-2 的活，**须人工过目**）

1. `desktop-shards` 两片加 `--coverage --coverage.reporter=json --coverage.thresholds.*=0`（T1/T2）⇒ **改矩阵作业的命令**。
2. 产物上传为 artifact（⚠ artifact 名**不能含斜杠** ⇒ `1/2` 这类 shard 名不可直接用，需 `strategy.job-index` 之类）。
3. `QG Coverage` 改 `needs: [changes, desktop-shards]` + 下载 artifact + 调本判定器 ⇒ **改 required context 的判定依据** ⇒ 人工过目。
4. 三处 CI 契约锁同步（`workflow-contract.test.js`：`coverage` 作业的 `needs`、`NEEDS_PREP` 里的 `coverage` 豁免、`test:coverage` 脚本锁）。
5. `scripts/gate-timeout-registry.json` 的 `coverage` 一格**重采样**（数值只能重采样，不能手改）。
6. **收益上限要说清**：本片只解决「覆盖率被跑两遍」；`QG Coverage` 仍要在合并后**下载并合并**两片产物，
   而 `electron-tests`（实测 47 分钟）与两个 `QG Desktop Shards` 也在同一档 ⇒ **本片不是全部**。
