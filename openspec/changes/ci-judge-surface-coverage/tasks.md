# 任务：判据闭包派生高危面

## 1. 闭包真源

- [x] 1.1 新建 `scripts/lib/judge-closure.js`：只 require node 内置（`node:fs` / `node:path`）；
      导出 `ENTRY_PREFIXES`、`isTestArtifactName`、`isJudgeEntryName`、`computeJudgeClosure(rootDir, {log})`
- [x] 1.2 入口集排除 `*.test.*`（第一版探针的错必须被用例钉住：`check-x.test.js` 不得算入口）
- [x] 1.3 只跟字面量相对 `require`；测试文件不展开；环保护（已访问即跳过）
- [x] 1.4 读数自证：返回 `{entries, files, libFiles, dynamicRequireLike, unresolved}`，
      `dynamicRequireLike` 只统计"看起来是动态拼接"的出现次数，**不承诺覆盖**

## 2. 判据侧接线（`check-pr-exec-record.js`）

- [x] 2.1 `isHighRiskSurface(rel, closure)` = 前缀命中 ∥（`rel ∈ closure.files` 且未豁免）
- [x] 2.2 闭包算不出 ⇒ `selfFault`（未证实）档，不得读成"不在高危面"；与既有
      `后端清单取不到读数` 同档、同形状出声
- [x] 2.3 一次判定只算一次闭包（注入缓存对象），配一条"不得每文件重算"的行为锁
- [x] 2.4 豁免单点：`scripts/judge-surface-waivers.json` 起始 `{}`；只有派生判据读它

## 3. 清点判据（`scripts/check-judge-surface-coverage.js`）

- [x] 3.1 规模下界：入口 / 闭包 / lib 三个数各自断言，退化即红（禁止"零违规"与"没扫到"同形）
- [x] 3.2 豁免四条：reason 非空字符串、条数 `<= MAX_WAIVERS(0)`、键必须仍在闭包内、闭包外不得有豁免项
- [x] 3.3 空转条目锁：`HIGH_RISK_SURFACES` 每条按自带口径求命中，命中 0 即红（`fingerprint` 须复用 `exts`）
- [x] 3.4 取不到读数一律按未证实（红），退出码分档 `0 合规 / 1 发现违规 / 2 判据自身故障`
- [x] 3.5 读数行自带分母：`JUDGE-SURFACE entries= files= lib= waived= dead-prefix= …`

## 4. 接线与文档

- [x] 4.1 `quality-gate.yml` 的 `changes` job 新增一步（bash、fail-fast），并登记新测试文件
- [x] 4.2 `check-unwired-tests.js` 域内必须看得见两份新测试（不接线即红）
- [x] 4.3 `AGENTS.md` QM-6 段：新增一条"高危面由闭包派生、豁免起始为空只能缩小、摩擦如实报"
- [x] 4.4 规格 delta `specs/ci-judge-surface-coverage/spec.md`（4 条 Requirement）
- [ ] 4.5 执行记录 `openspec/records/qm6-lib-judge-surface.md`（含 QM-5 五步、摩擦读数、活数标注）

## 5. 验证与收尾

- [x] 5.1 变异反证 M1–M10 逐条实跑，红集互不相同并如实标注防御重叠（见 design D9）
- [ ] 5.2 QM-6：本 PR 命中高危面（`scripts/check-` + 闭包自身）⇒ 真跑双模型，逐条处置后
      由 **`#4453` 落地的仓内派生档**签字（不手写 `tier`）
- [ ] 5.3 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` rc=0 的逐字读数
- [ ] 5.4 PR —— 改「谁来守门」⇒ **交人工批准合并**，agent 不自合
- [ ] 5.5 合并后产物取证 + main push 回读（读数写进 PR 评论，不写回仓库文件）
- [ ] 5.6 R1–R7 清理 worktree + 记忆收敛（含"按名增补被自己的取证否证⇒翻成闭包派生"这条方法论）

## 交付证据（勾账时同次补，活数以当场重跑为准）

- 1.1–1.4：`scripts/lib/judge-closure.js` + `scripts/lib/judge-closure.test.js`（12 条，含
  「第一版探针把 `check-x.test.js` 当入口」那条自己版本的后置锁）。
- 2.1–2.4：`scripts/check-pr-exec-record.js` 的 `makeJudgeSurfaceContext` / `summarizeJudgeSurface` /
  `highRiskPrefixOf(file, judgeSurface)`；锁在 `scripts/check-pr-exec-record-judge-surface.test.js`（11 条）。
  既有 `check-pr-exec-record.test.js` **154/154** 未减（16 处夹具 seed `scripts/`，见 design D21）。
- 3.1–3.5：`scripts/check-judge-surface-coverage.js` + 同名测试（8 条）。当场读数：
  `entries=47 files=69 lib=19 dynamic=6 unresolved=0 waived=0 derived-only=21 dead-prefix=0 verdict=PASS`。
- 4.1–4.2：`quality-gate.yml` 的 `changes` 作业新增 `Gate 2b16`（bash、三行）并在 `Gate 2c2` 追加派生面接线锁；
  `check-workflow-structure.js` files=18 / violations=0、`workflow-contract.test.js` 46/46、
  `check-step-failfast.js` 47 步全 fail-fast、`check-unwired-tests.js` 待提交后按 `git ls-files` 复跑为准。
- 4.3：`AGENTS.md` QM-6 段新增一整条（含「第二档来源」「豁免只能缩小」「三档退出码不得混档」「摩擦与 8.5 折扣」）。
- 5.1：M1–M13 **全部 CAUGHT**（逐条指名红集与"哪些只在单侧红"的归因见 design §D22）；
  驱动开工前与收工后各断言一次 `git status --porcelain` 为空，并逐条用 sha256 复验还原。
