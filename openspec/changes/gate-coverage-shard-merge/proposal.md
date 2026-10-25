## Why

`QG Coverage` 是 branch protection 的 **required context**（经典 4 项之一），它自己跑一遍**全量桌面测试**
（`vitest run --coverage --maxWorkers=1 --no-file-parallelism`），实测单趟 **40–47 分钟**。

而 `desktop-shards` **已经把同一套桌面套件分两片跑在两个 runner 上**（合计约 20–25 分钟），但**分片不产覆盖率**。

⇒ **同一套覆盖率被跑了两遍**：一遍分片（不产覆盖率）、一遍全量（产覆盖率）。
⇒ 每次合并都往 CI 池子里灌一整套 push 重作业 ⇒ **合并吞吐 ≈ 1.5 个/小时**（合并波必须一个一个来的实测上限）。

正解方向：让 `desktop-shards` 的两片**各自产覆盖率**，再由一个判定器**合并**后判全局阈值。

## What Changes

- **本 change 只交付 PR-1（可独立交付的一半）**：
  - 新增合并判定器 `scripts/merge-coverage-shards.js`：合并 N 份 istanbul 覆盖率产物，按 **vitest 原生阈值语义**判全局阈值；
  - 新增行为锁 `scripts/merge-coverage-shards.test.js`（7 例，含**变异反证**）；
  - 根 `package.json` 加 devDependency `istanbul-lib-coverage@3.2.2`（**已在 lockfile 里** ⇒ 锁文件只 +3 行）；
  - `.gitignore` 加 `!scripts/merge-coverage-shards.js` 反选（`scripts/*.js` 是整目录忽略）；
  - `quality-gate.yml` 的 `static-gates` 作业加一行 `node --test scripts/merge-coverage-shards.test.js`（满足「未接线测试棘轮」）。
- **本 change 不改任何作业的判定逻辑** ⇒ 不改「谁来守门」⇒ PR-1 可在 CI 全绿后自动合并。
- **PR-2（下一片，须人工过目）**：shards 产覆盖率 + 传 artifact + `QG Coverage` 改 `needs` 并下载合并判阈
  ⇒ 改的是 **required context 的判定依据**。

## Capabilities

### New Capabilities

- `gate-coverage-shard-merge`: 分片覆盖率产物的**合并判定**语义 —— 阈值真源唯一（`apps/desktop/vitest.config.js`）、
  阈值语义与 vitest 原生一致、**失明三态**（达标 / 未达 / 不可判定）、以及三处必须显式堵住的假绿形态。

## Impact

- **新增**：`scripts/merge-coverage-shards.js`、`scripts/merge-coverage-shards.test.js`
- **改动**：`package.json`（+1 devDep）、`pnpm-lock.yaml`（+3 行）、`.gitignore`（+1 反选）、
  `.github/workflows/quality-gate.yml`（**只加一行 `node --test`**，不动任何作业的判定逻辑）
- **不动**：`apps/desktop/vitest.config.js`（阈值真源本身）、`desktop-shards` 作业、`QG Coverage` 作业、`CHANGELOG.md`
- **风险面**：
  1. **失明被读成通过** ⇒ 已用三态退出码（0/1/**2**）+ 4 种失明形态的断言堵住；
  2. **形状不认识的产物被判成 100%** ⇒ 已加逐份形状校验（实测 `createCoverageMap({任意键:'任意值'})` **不抛错**且读数 100%）；
  3. **阈值漂移** ⇒ 判定器不硬编码阈值，阈值真源唯一；
  4. **新增测试被漏接线** ⇒ 已接进 `static-gates`（仓内「未接线测试棘轮」`scripts/check-unwired-tests.js` 要求）。
