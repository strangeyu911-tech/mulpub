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

---

# 增补：PR-2（接线片）——2026-10-25 实施

> 前置：PR-1（#4456，merge SHA `2ead9970f`）已合并，交付了**判定器 + 行为锁 + 依赖**。
> 本片把 `QG Coverage` 接到分片采到的覆盖率产物上 —— **改的是 required context 的判定依据**，
> 按纪律须人工过目；**用户已授权由我拍板**（2026-10-25），拍板结论与理由见下。

## 一、三处拍板结论（用户授权由我决定）

| # | 问题 | 决定 | 理由 |
|---|---|---|---|
| 1 | `QG Coverage` 里那条 `ensure-electron` 步骤删不删？ | **删**（连同 `build:preload` / `build:paginator` 重建步） | 本作业**不再跑桌面测试** ⇒ 不需要 Electron 二进制、不需要重建构建产物（那两步是「跑桌面测试」的前置，`desktop-shards` 里同样有）。⚠ 仍需 `pnpm install`：判定器要 require 桌面端阈值真源（依赖 `vitest/config` 与 `@vitejs/plugin-vue`），判定器自身还需要根 devDep `istanbul-lib-coverage`。 |
| 2 | jobId / 显示名保不保？ | **保持 `coverage` / `QG Coverage` 不变** | 它是 **required context** ⇒ 改名或删除 ⇒ **全仓 PR 永久 BLOCKED**（required check 永不产生）。 |
| 3 | `electron-tests`（实测 47.4 分钟）这一片动不动？ | **不动**，归 P3-3 | 它是 **Electron 主进程侧**的测试，不是覆盖率那条线；混进来会让本片的变量变多、归因变脏。 |

## 二、本片改了什么

| 位置 | 改动 | 为什么 |
|---|---|---|
| `desktop-shards` 作业 | 分片命令行追加 `--coverage`、`--coverage.reporter=json`、`--coverage.thresholds.{statements,branches,functions,lines}=0` | ① 开启 v8 采集；② 产 **istanbul 形状**（`blob` reporter 产 V8 原始格式、合并器读不了）；③ **中和阈值** —— 实测 vitest 的 `--shard` 模式**照样按全局阈值判**（`resolveThresholds` 无 shard 分支）⇒ 不中和则两片各按 55% 判、必红。阈值由合并后统一判一次。 |
| `desktop-shards` 作业 | 新增上传步骤：`name: coverage-shard-${{ strategy.job-index }}`、`path: apps/desktop/coverage/coverage-final.json`、`if-no-files-found: error` | ⚠ artifact 名**不能含斜杠**（matrix 值是 `1/2`）⇒ 用 `strategy.job-index`。**产物没生成必须当场红** —— 静默上传空产物会让下游把「没有覆盖率」读成「覆盖率 0」或干脆没产物，两种都不可判。 |
| `QG Coverage` 作业 | `needs: [changes, desktop-shards]`；`if` 改为**四个合取子句**；步骤换成「安装依赖 → 下载 artifact → 跑判定器」 | 见下「四子句各自的作用」。 |
| `workflow-contract.test.js` | 三处锁同步（详见 §三） | 改判定依据必须同步把守它的锁。 |

### `if` 的四个合取子句（缺一不可）

| 子句 | 作用 | 缺了会怎样 |
|---|---|---|
| `always()` | 分片失败时本作业**仍然要跑** | 它会被**跳过** ⇒ 而「跳过的 required check」在 GitHub 眼里**算通过** ⇒ **等于把覆盖率门禁悄悄关掉**。跑起来后拿不到产物 ⇒ **这一档明确变红**（三条路径，见 §五之三）。 |
| `needs.changes.result == 'success'` | changes 自己失败时不跑 | 门禁红了不用再叠一层红（噪音）。 |
| `needs.changes.outputs.docs-only != 'true'` | 纯文档 PR 不跑 | 纯文档 PR 本来就没有桌面覆盖率要判。 |
| `github.event_name == 'pull_request'` | push 侧不跑 | 沿用 #4457 的口径（push 侧验的是 `origin/main` 当前状态，与 PR 侧的 merge preview **不是同一棵树**）。 |

## 三、五处契约锁的改法（**都不是放松，是换锚点 / 加反向锁 / 收窄清单**）

> ⚠ **订正（独立复核 + CI 实测）**：原稿写「三处」是**漏数**。实际要动 **五处**：
> **workflow-contract 内四处**（①②③④）+ **仓内「域内 job 登记表」一处**（⑤）。
> ⚠ ⑤ 是 CI 首次跑就红的那条 —— 它**不在** `workflow-contract.test.js` 里，
> 而在 `.github/scripts/desktop-test-prereq-jobs.json`（判据 `check-desktop-test-prereqs.js`）。
> ⇒ 本仓的「改一处要同步另一处」是**跨文件**的，靠读代码列不出来 ⇒ 只能靠**跑仓内自己的完整门禁清单**。

| 锁 | 原形态 | 改法 | 为什么不是放松 |
|---|---|---|---|
| ① 重型作业清单 | `coverage.needs == ['changes']`；`if` 恰好两个合取子句 | 改成 `needs == ['changes','desktop-shards']`；`if` 四个子句；**加四条反向锁**：QG Coverage 的命令里**不得出现桌面包/桌面路径**（不依赖具体写法）、不得再出现 `test:coverage` / `vitest run` / `--shard=`，**必须**调用合并判定器；上传名与下载 pattern 必须一一对应；上传的 `if-no-files-found` 必须是 `error` | 旧锁守的是「它自己跑全量」这个**旧形态** ⇒ 形态变了锁要跟着变，否则锁变装饰。新的反向锁守的是**新形态的不变量**（不重复跑、必须合并、产物必须真上传）。 |
| ①之二 **片数守卫（新）** | （无） | 判定器加 `--expect-shards=N`；`QG Coverage` 传 `--expect-shards=2`；**契约锁把 N 与 `desktop-shards` 矩阵腿数对拍** | ⭐ 独立复核抓出来的**假绿**：分片挂一半时 `download-artifact` **不报错**（少的那片是静默的）⇒ 判定器会拿半份数据当全局读数 ⇒ 半份读数偏低但**也可能**跨过阈值 ⇒ 判成「达标」。⇒ 片数必须**恰好**匹配，少/多都走失明。⚠ 数字不许漂 ⇒ 契约锁与矩阵腿数对拍（腿数变了却没改这里 ⇒ 当场红）。 |
| ② 覆盖率采集串行锁 | 锁 `apps/desktop` 的 `test:coverage` 脚本含 `--maxWorkers=1` / `--no-file-parallelism` | **两处都守**（不是「换锚点」）：CI 路径锚到 `desktop-shards` 的分片命令行（并**加** json reporter 与**四条**阈值中和旗标）；开发者路径**保留**对 `test:coverage` 脚本的锁 | ⚠ **订正**：原稿写「PR-2 之后 `test:coverage` 在 CI 里已无调用方 ⇒ 锁它就是锁死脚本」—— 只对了一半。它**仍是开发者手动跑覆盖率的入口** ⇒ 它的串行不变量也不该没人守 ⇒ 只挪不补 = 让开发者路径失守。⇒ 两处都守，比原来**更严**。 |
| ③ Electron 准备清单 | `NEEDS_PREP = ['coverage','desktop-shards','unit-tests']` | 去掉 `coverage` | 前提是**机械可判**的：收集谓词（步骤 run 块里同时出现桌面端路径与测试关键字）认不出它了 ⇒ 一旦有人把桌面测试加回 coverage 作业，它会重新被收集 ⇒ `collected` 与清单不再相等 ⇒ `deepEqual` 当场红。⚠ 但这条只在谓词认得出的**几种字面形态**上成立（独立复核指出）⇒ 真正的兜底是**另一条**锁（build 配对 ⇒ `MISSING_BUILD`）与 ① 的宽反向锁。 |
| ④ 桌面全量消费者覆盖面 | 数字下界 `rows.length >= 3` | 改成**具名清单**（`electron-ci.yml:electron-tests` + `quality-gate.yml:desktop-shards` 逐个点名），数字下界退成 2 | ⚠ **只把 3 改成 2 不够** —— 那只会让「覆盖面悄悄少一个」变成合法。具名清单下，删掉任何一个消费者都当场红。 |
| ⑤ **域内 job 登记表**（原稿漏了，CI 首次跑就红） | `.github/scripts/desktop-test-prereq-jobs.json` 的 `required` 有 4 条，含 `quality-gate.yml#coverage` | **删掉 `coverage` 那条**（3 条）；测试侧 `FIXED_JOB_KEYS` 同步收窄为 3 条 | 登记表自述「**清单只能缩小**」；`coverage` 不再跑桌面 vitest ⇒ 它**已不在域内** ⇒ 条目变陈旧 ⇒ 判据按设计判红（`STALE_REQUIRED`）⇒ 这是**登记表自己**要求的动作，不是放松。⚠ 连带：测试侧那份「域内集合必须恰好是这几条」的人工过目清单也要同步收窄（否则它会与登记表不一致）。 |

## 四、端到端验证（本地实测，非推断）

**真产物 + 真源阈值 + 生产命令形态**（`node scripts/merge-coverage-shards.js --dir <目录>`）：

| 口径 | 读数 | 退出码 |
|---|---|---|
| 单看一片 | `shards=1 files=2 statements=50% branches=100% functions=50% lines=50% thresholds={statements:55,branches:40,functions:60,lines:55} verdict=FAIL` | **1**（未达） |
| **合并两片** | `statements=100% branches=100% functions=100% lines=100% … verdict=PASS` | **0** |
| ⭐ **全量跑（旧口径，对照组）** | `shards=1 files=2 statements=100% branches=100% functions=100% lines=100% … verdict=PASS` | **0** |

⇒ ⭐ **新口径与旧口径逐项逐字相同**（连 `files` 都一致）⇒ 阈值比较是**同口径**（分母相同、分子相同）
⇒ **本片消掉的是「重复劳动」，不是降低门禁标准**（这一条是本片能不能合的关键判据）。

⇒ ① 合并口径 == 全量口径；② **单看任一片都会低估**（50% vs 100%）⇒ 这是「不能拿单片判全局阈值」的机器证据；
③ 阈值取自**真源**（55/40/60/55，脚本不硬编码）；④ 错误文案与 vitest 原生同形。

**真源 require 路径也实测过**：`require('apps/desktop/vitest.config.js')` 在 Node 22.19 下**成功**（真源要 `vitest/config` + `@vitejs/plugin-vue`，
两者在 npm 上都有 CJS 入口：`vitest/config → dist/config.cjs`、`@vitejs/plugin-vue@5.2.4 → dist/index.cjs`）⇒ 判定器的**默认路径**在 CI 可用。

## 四之二、⚠ 已知代价：push 侧的分片也在采覆盖率，但没人消费

`desktop-shards` 在 **push 与 PR 两侧都跑** ⇒ 插桩开销两边都付，而 push 侧的产物**没有消费者**
（`QG Coverage` 的 `event_name == 'pull_request'` 让它在 push 侧跳过）。

- **为什么不伤 push 关键路径**：push settle = **各作业取最长**（不是求和）⇒ push 侧的长杆是
  `electron-tests`（实测 47.4 分钟）⇒ 分片从 22 涨到 ~28 分钟**不会**改变 push settle。
  ⇒ 代价是**runner 分钟**（Windows 按 2 槽位计），不是关键路径时间。
- **为什么不加事件条件**：覆盖率旗标在分片的 argv 数组里 ⇒ 要按事件切换就得把它们移出数组
  （改成 PowerShell 变量展开）⇒ 那样**契约锁的 argv 解析层就看不见它们了** ⇒ 锁的牙齿变弱
  ⭐ 而本仓这一路的失败模式恰恰是「锁变装饰」⇒ **不为了省这点 runner 分钟去换掉锁的可见性**。
- **登记**：合并后按实测重测分片耗时（插桩前后对比），再决定要不要做事件条件。

## 五、收益与代价（**收益待实测，不预填**）

| | 现状 | 本片之后（预期） |
|---|---|---|
| PR 侧 `QG Coverage` | 自己跑全量 **40–47 分钟** | 依赖分片产物 ⇒ **≈ 分片耗时（22–20 分钟）+ 1–2 分钟安装 + 秒级合并** ⇒ **PR CI 关键路径约减半** |
| 桌面套件跑的遍数 | 2 遍（分片一遍 + 覆盖率一遍） | **1 遍** |
| `QG Coverage` 单趟耗时 | 40–47 分钟 | **个位数分钟**（⚠ **待实测**） |

⚠ **代价与风险（如实登记）**：
1. **分片会变慢**（覆盖率插桩开销，常见 +10–30%）⇒ 分片从 22.1/19.9 分钟上升。
   ⚠ **订正（独立复核）**：原稿写「逼近 45 分钟共享预算的贴脸线（0.8×45=36 分钟）」是**算错的** ——
   按 registry 实测（`desktop-shards` floor/max=22、p90=20.8、samples=57）算，22×1.3 ≈ **28.6 分 = 预算的 64%**，
   离 36 分钟贴脸线还有约 **7.4 分钟**余量，离 45 分钟硬墙约 16 分钟 ⇒ **风险不高，但必须按实测重测**。
   ⭐ 另注：registry 里 `PROVENANCE.shardMaxSuccessMin: 29.77` 是 **#3315 修复前**「两腿各跑全量」的**污染观测**
   （该文件自己的注释里写明了）⇒ 真正该跟进的是「**45 分预算是按污染观测定的**，真分片只有 22 分」，
   而不是「余量在收窄」。⇒ 合并后重测 + 重采样时一并处理。
2. **registry 的 `coverage` 格变成陈旧**（它记的 72 分钟来自「自己跑全量」的旧形态；而 push 侧自 #4457 起已不跑这一档 ⇒ **那个采样来源已经不再产生新样本**）⇒ **本片不改 registry 的数字**（只能重采样、不能手改）⇒ **登记为合并后的独立一刀：改采集途径（采 PR 侧样本）+ 重采样**。
3. **`QG Coverage` 现在依赖 `desktop-shards`** ⇒ 分片红 ⇒ 覆盖率**判红** ⇒ 比以前更严格，不是更松。
   ⚠ **三条路径的机制各不相同（独立复核指出原稿把机制写错了）**：
   | 分片怎么挂 | 谁出红 | 机制 |
   |---|---|---|
   | **全挂**（0 片上传） | **下载步** | `download-artifact` 的 pattern 命中 0 个 artifact ⇒ **动作自己就失败** ⇒ 判定器根本没跑到（原稿写「判定器走失明通道」—— 这条路走不到） |
   | **挂一部分**（2 片挂 1 片） | **判定步** | ⚠ `download-artifact` **不报错**（它只下载命中的那几个）⇒ 少的那片是**静默**的 ⇒ 判定器会拿**半份数据**当全局读数（单片读数系统性偏低，但偏低**也可能**跨过阈值 ⇒ 假绿）⇒ ⭐ **靠 `--expect-shards` 拦住**（片数必须**恰好**匹配，少/多都走失明 rc=2） |
   | 产物在但形状不对 | **判定步** | 失明通道 rc=2（读不到阈值真源 / 不是 istanbul 形状 / 合并为空 / `pct` 非有限数字） |
