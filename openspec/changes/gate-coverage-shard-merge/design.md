# 设计 — 分片覆盖率合并判定器

## 1. 数据流

```
desktop-shards 1/2  ──vitest --coverage --coverage.reporter=json──► coverage-final.json (istanbul 形状)
desktop-shards 2/2  ──vitest --coverage --coverage.reporter=json──► coverage-final.json (istanbul 形状)
                                                                        │
                                        merge-coverage-shards.js ◄────┘
                                          ① 逐份形状校验
                                          ② createCoverageMap(a).merge(b)   ← 并集
                                          ③ getCoverageSummary() → 逐项比阈值
                                                                        │
                                              rc 0 达标 / 1 未达 / 2 失明
```

## 2. 阈值语义（逐字对齐 vitest）

真源：`vitest/dist/chunks/coverage.*.js` 的 `checkThresholds`。

| 阈值形态 | 含义 | 红的条件 | 本判定器的实现 |
|---|---|---|---|
| `threshold >= 0` | 最低百分比 | `pct < threshold` | `if (pct < threshold) failures.push(...)` |
| `threshold < 0` | 最大未覆盖数 | `uncovered > -threshold` | `uncovered = total - covered`；`if (uncovered > -threshold) failures.push(...)` |

读数取 `summary.data[key].pct`（全局口径）。
错误文案与 vitest 同形：`ERROR: Coverage for <key> (<pct>%) does not meet global threshold (<threshold>%)`。

⚠ `istanbul-lib-coverage@3.2.2` **没有** `checkCoverage`（合并是实例方法）⇒ 阈值必须自己判。

## 3. 三态退出码

| rc | 语义 | 触发 |
|---|---|---|
| 0 | 达标 | 合并成功且四项都过阈值 |
| 1 | 未达 | 合并成功但某项不达标 |
| **2** | **失明（不可判定）** | 读不到阈值 / 读不到产物 / 形状不认识 / 合并抛错 / 合并结果为空 / `pct` 不是数字 |

⚠ **2 不是 0**：「没测成」与「通过」是两件事。

## 4. ⚠ 三处假绿与堵法（实测得来，不是推演）

| # | 洞 | 实测形态 | 堵法 |
|---|---|---|---|
| H1 | `createCoverageMap({任意键:'任意值'})` **不抛错** | 把该键当成「零语句的文件」⇒ `total:0 / pct:100` ⇒ 阈值全绿 | 逐份校验 istanbul 形状：每个文件条目必须有 `statementMap`/`fnMap`/`branchMap`（对象）+ `s`/`f`/`b`（对象） |
| H2 | 空 coverage map | `getCoverageSummary().data[key].pct === "Unknown"` ⇒ `"Unknown" < 55` 为 **false** ⇒ 全绿 | 合并后 `files().length === 0` ⇒ 失明；且四项 `pct` 必须是**有限数字** |
| H3 | 「读不到产物」被当成「0 个文件」 | 同 H2 ⇒ 全绿 | 单独失明通道（产物不存在 / 目录读不到 / 没找到任何 `coverage-final.json`） |

⇒ 这三条各自对应行为锁 ④ 的一条断言。

## 5. 夹具形状的两个坑（写测试时踩到）

1. **`fnMap` 每项的键名是 `loc`**（不是 `decl`）
   —— `istanbul-lib-coverage` 的 `keyFromLocProp = x => keyFromLoc(x.loc)`
   ⇒ 写成 `decl` 会在**合并同文件**时抛 `Cannot destructure property 'start' of 'undefined'`。
2. **循环变量不能叫 `f`** —— `f` 是 istanbul 的**函数计数表**键；用 `f` 当循环变量会让 `f:` 那个简写属性变成**文件路径字符串**（形状看着对、内容全错）。

## 6. 行为锁与变异反证

| 例 | 锁的性质 | 对应的失效形态 |
|---|---|---|
| ① | 并集：同一文件被两片互补覆盖 ⇒ 100% | 合并若取「最后一片」⇒ 被稀释成 50% |
| ② | 未达 ⇒ rc=1 + vitest 同形文案 | 阈值判定口径漂移 |
| ③ | 负阈值 = 最大未覆盖数 | 负阈值语义写反 |
| ④ | 失明四形态全 rc=2 | H1 / H2 / H3 |
| ⑤ | 阈值单一真源（剥注释后按真源实际值逐个查） | 第二口径（脚本硬编码阈值） |
| ⑤-2 | `--config` 可换判定依据 | 阈值真源写死 |
| ⑥ | **变异反证 ×2** | 锁本身恒绿 |

⚠ ⑤ 的实现细节：**必须先剥注释再查数字** —— 否则脚本里「40–47 分钟」这类说明文字会把它自己触发（假红）。

⚠ ⑥ 的实现细节：变异体写在 `/tmp` ⇒ `require('istanbul-lib-coverage')` 解析不到仓内 `node_modules`
⇒ **必须显式给 `NODE_PATH`**，否则变异体走「失明」分支，读数与真实路径不可比（变异打偏 ≠ 锁没牙齿）。

## 7. 依赖

`istanbul-lib-coverage@3.2.2` 作为**根 devDependency**：

- 它**已在 `pnpm-lock.yaml` 里**（`@vitest/coverage-v8` 的传递依赖）⇒ 加成直接依赖后锁文件只 **+3 行**；
- 版本**钉死**（不用 `^`）⇒ 判定行为与 vitest 侧一致，不随传递依赖升级漂移；
- `nodeLinker: hoisted` ⇒ 解析到根 `node_modules/` ⇒ `scripts/` 下的脚本可直接 require。

## 8. 本 change 的边界

本 change **不**：
- 改 `QG Coverage` / `desktop-shards` 的任何判定逻辑（那是 PR-2，且须人工过目）；
- 改 `apps/desktop/vitest.config.js`（阈值真源本身）；
- 动 `scripts/gate-timeout-registry.json`（PR-2 里按 `scripts/gate-timeout-sample.js` 重采样，**数值只能重采样不能手改**）。

本 change **只**在 `quality-gate.yml` 里加**一行** `node --test` ⇒ 不改「谁来守门」。
