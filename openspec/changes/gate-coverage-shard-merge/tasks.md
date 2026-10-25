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
