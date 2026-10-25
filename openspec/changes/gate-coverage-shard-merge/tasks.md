# Tasks — gate-coverage-shard-merge

> 本 change = **PR-1（可独立交付的一半）**。PR-2（shards 产覆盖率 + `QG Coverage` 改判定依据）**须人工过目**，不在本 change 内。

## 1. 技术前提（全部实测，非推断）

- [x] 确认 `vitest --shard` 模式**照样按全局阈值判**（无 shard 豁免）⇒ 分片侧必须显式中和阈值
- [x] 确认覆盖率产物形状：必须 `--coverage.reporter=json`（istanbul）；`blob` 是 V8 原始格式、`--merge-reports` 是测试结果 blob
- [x] 确认 `istanbul-lib-coverage@3.2.2` 无 `checkCoverage` ⇒ 阈值由脚本自己判
- [x] 确认合并是**并集**（真产物对账：单片 33.33% ⇒ 两片合并 66.66% == 全量 66.66%）
- [x] 确认 `fnMap` 每项的键名是 **`loc`**（不是 `decl`）⇒ 写错会在合并同文件时抛 `Cannot destructure property 'start'`

## 2. 实现

- [x] `scripts/merge-coverage-shards.js`：合并 N 份产物 + 按 vitest 原生语义判阈 + 三态退出码（0/1/**2**）
- [x] 逐份**形状校验**（`statementMap`/`fnMap`/`branchMap` + `s`/`f`/`b`）⇒ 堵住「形状不认识 ⇒ 读数 100% ⇒ 全绿」
- [x] 合并后**非空 + `pct` 必须是有限数字** ⇒ 堵住「空 map ⇒ `pct='Unknown'` ⇒ 比较恒不成立 ⇒ 全绿」
- [x] 阈值真源 = `apps/desktop/vitest.config.js`；`--config` / `--thresholds` / `--dir` 三种覆盖入口

## 3. 行为锁（含变异反证）

- [x] `scripts/merge-coverage-shards.test.js`：7 例（并集 / 未达 / 负阈值 / 失明四形态 / 单一真源 / `--config` 可换 / 变异反证）
- [x] 变异反证两条：① 去掉「合并」⇒ `files` 从 2 变 1；② 把失明的 `exit(2)` 改成 `exit(0)` ⇒ 失明被读成通过
- [x] 变异体放在 `/tmp` ⇒ 必须显式给 `NODE_PATH` 才能解析到仓内 `node_modules`（否则读数与真实路径不可比）

## 4. 接线与依赖

- [x] 根 `package.json` 加 `istanbul-lib-coverage@3.2.2` devDependency
- [x] `pnpm install --lockfile-only` ⇒ `pnpm-lock.yaml` **只 +3 行**（该包已在 lockfile 里，是 `@vitest/coverage-v8` 的传递依赖）
- [x] `.gitignore` 加 `!scripts/merge-coverage-shards.js`（`scripts/*.js` 整目录忽略 ⇒ 漏这条＝提交里没有它）
- [x] `quality-gate.yml` 的 `static-gates` 作业加 `node --test scripts/merge-coverage-shards.test.js`（满足未接线测试棘轮）

## 5. 文档

- [x] `01-docs/PRD-GATE-COVERAGE-SHARD-MERGE-2026-10-25.md`
- [x] `openspec/records/feat-gate-coverage-shard-merge.md`（执行记录）

## 6. 交付

- [ ] 推送分支 → 开 PR → CI 全绿 → squash 合并
- [ ] PR-2（**须人工过目**）：shards 加 `--coverage --coverage.reporter=json --coverage.thresholds.*=0` + artifact +
      `QG Coverage` 改 `needs` 并下载合并判阈 + 三处 CI 契约锁同步 + `gate-timeout-registry.json` 重采样

## 6. PR-2（接线片）

- [x] `desktop-shards` 分片命令行追加覆盖率旗标（`--coverage` / `--coverage.reporter=json` / 四项阈值中和）
- [x] `desktop-shards` 新增覆盖率产物上传（`coverage-shard-<job-index>`、`if-no-files-found: error`）
- [x] `QG Coverage` 改 `needs: [changes, desktop-shards]` + 四个合取子句的 `if` + 步骤换成「下载 → 合并判定」
- [x] 同步三处契约锁：① `coverage.needs`/`if` + 三条反向锁 ② 覆盖率串行锁换锚点到分片命令行
      ③ `NEEDS_PREP` 去掉 `coverage`（前提机械可判）④ 桌面全量消费者覆盖面改**具名清单**
- [x] 判定器读阈值真源失败时的报错信息补全最可能原因（依赖未装 / ESM / 真源抛错）
- [x] 端到端本地验证：真 vitest 产物 + 真源阈值 + 生产命令形态（单片 FAIL rc=1 / 合并 PASS rc=0）
- [x] 真源 `require` 路径实测通过（Node 22.19；`vitest/config` 与 `@vitejs/plugin-vue` 均有 CJS 入口）
- [ ] 合并后：按实测重测 `scripts/gate-budget.js` 的分片预算（覆盖率插桩让分片变慢）
- [ ] 合并后：改采集途径并**重采样** `scripts/gate-timeout-registry.json` 的 `coverage` 格
      （旧来源「main push 的 QG Coverage」自 #4457 起已不产生样本；本片又改了作业形态）

### PR-2 补做（独立复核后追加）

- [x] **域内 job 登记表同步收窄**：删掉 `.github/scripts/desktop-test-prereq-jobs.json` 里的
      `quality-gate.yml#coverage` 条目；测试侧 `FIXED_JOB_KEYS` 同步收窄为 3 条
      （⚠ 原稿只列了三处锁 ⇒ 漏了这一处 ⇒ CI 首次跑就红）
- [x] **判定器加片数守卫** `--expect-shards=N`（少/多都走失明 rc=2）+ 行为锁 ⑦/⑦-2（含变异反证）
- [x] **契约锁把 `--expect-shards` 与分片矩阵腿数对拍**（数字不许漂）
- [x] **覆盖率串行锁两处都守**（CI 路径 + 开发者路径 `test:coverage` 脚本的锁加回来）
- [x] **反向锁加宽**：QG Coverage 的命令里不得出现桌面包/桌面路径（不依赖具体写法）
- [x] **四条阈值中和旗标逐条锁**（原只锁 statements 一项）
- [x] **本地门禁改跑仓内自己的完整清单**（static-gates 的 55 行 / 66 个测试目标），
      并用**干净 origin/main 同环境对照**判定「本地红是不是我的锅」
- [x] **文档订正**：失败机制（三条路径）、风险算术（64% ≠ 逼近贴脸线）、push 侧代价与取舍理由
