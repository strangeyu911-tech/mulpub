---
change: ux-audit-label-contract-lock-pattern
branch: ux-audit-label-contract-lock-pattern
date: 2026-10-27
type: 纯文档变更（docs-only 快速通道）
---

# 执行记录：标签关联合同补录「关联判据的正解 + QM-6 链路两条现场」（ux-audit-label-contract-lock-pattern）

| 项 | 值 |
| --- | --- |
| 变更类型 | 纯文档（`01-docs/PRD-LABEL-ASSOCIATION-CONTRACT-2026-10-27.md` 新增 §6A / §6B），走 docs-only 快速通道 |
| 隔离声明 | 文档类变更；因共享根 `main` 当时落后 `origin/main` 281 个提交，按「滞后不得就地编辑上游也在改的文件」改用独立 worktree（`mp-ux-audit-label-contract-lock-pattern`，基线 `771c8bb3b` == `origin/main`），经 PR 落地 |
| 远程同步 | 由门禁推导 |

- 保留门禁：变更类型与隔离声明 ✅ | 行尾对账 ✅（`--numstat` 与 `--ignore-cr-at-eol --numstat` 同为 182/182）| 品牌残留 ✅（`check-no-brand-residue.js` PASS，扫描 13382 个 tracked 文件）| 文档同步 ✅（`bash scripts/check-docs-sync.sh --base=main --head=HEAD` → 「仅文档/流程变更，无需额外同步」；注意该脚本会给 `--base` 值前缀 `origin/`，传 `origin/main` 会 fetch 到 `refs/heads/origin/main` 而 fatal）| 远程同步 PR #4540

## 一、为什么补这两节

不是"补点注释"。是在按合同施工 4.3 原生族切片（PR #4539）时，撞到两件**合同里没有、缺了会把后来者带偏**的事：

1. **合同 §5 只说"关联断言取 DOM 事实"，但没说最省的那条形长什么样。** 本轮写的锁用了标签名白名单
   （`input/textarea/select/button/meter/output/progress`）来判"目标是不是 labelable"。这件事浏览器已经替我们判了：
   `label.control` 指到非 labelable 元素就是 `null`、`control.labels` 就是空。白名单既冗余又更弱
   （只证标签名，证不出双向关联），而且——见第 2 条——它会主动招祸。
2. **QM-6 判定器会把"给下拉框补可访问名"判成"改动涉及数据库"。** `scripts/ccg-review-decider.js` 的
   `RULES.sensitiveContents` 里 SQL 形态是 `/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|DROP TABLE|ALTER TABLE)\b/i`；
   `<`、`-`、`"` 都是非词字符，再带 `i` ⇒ **HTML 标签名 `select` / EP 的 `el-select` 逐字命中**。
   而 `内容命中 ≥1 ⇒ DUAL` 是与行数**无关的第二条独立触发**，DUAL 在验证层必然落到自扮演、agent 无法合法闭合。
   三条在飞切片的实测（先自证探针跑起来了，见下"探针坏"那条）：

   | 切片 | diff 变更行 | SQL 形态命中 | 其中纯 `select` 字样 | 涉及真 SQL |
   | --- | --- | --- | --- | --- |
   | #4531 | 232 | 2 | 2 | 0 |
   | #4529 | 606 | 22 | 22 | 0 |
   | #4539 | 352 | 14 | 14 | 0 |

**结论口径**：新写的关联锁一律用 `label.control` / `control.labels`；需要"非 labelable 即红"的负控，
就写一个 `<div id=…>` 并断言 `label.control === null`，比枚举标签名更直接。
而被接线元素本身就是 `<select>` 时**这一族假阳性无法靠改自己的写法规避**——那是那一行的本体。
此时正解是走真外部评审或交人工处置，**不是**动 `RULES`（改谁被豁免）、拆测试、或给判据加文件类型例外。

## 二、QM-6 链路两条现场（都会让人把"没跑"读成"过了"）

1. **pre-commit 的 CCG 门禁静默跳过**：`run_skill.js` 不在 `scripts/ccg-gate.js` 的默认候选目录时，它打印
   `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁` 并**返回 0** ⇒ 代码提交没有判定产物，
   随后 `deep-review.sh` fail-closed 报 `本提交有 468 行非 .ccg 改动却没有判定记录`（`DEEP_RC=1`）。
   本机 `run_skill.js` 实测在 `<技能根>/ccg/run_skill.js` ⇒ 提交时须带 `CCG_SKILLS_DIR`。
2. **`deep-review.sh` 按"父提交 sha"解析判定记录**（`--dry-run` 原文：`判定记录按父提交 sha 命中：9b3fff33（提交时 HEAD 即父提交）`）。
   所以必须 **代码提交 → deep-review → 补充提交**。本轮先补了记录提交与 `.ccg` 产物提交，HEAD 的父提交
   变成那条纯文档提交、其判定为 `SKIP` ⇒ deep-review 打印"按决策矩阵跳过深度审查"且 rc=0，
   **看着像走完、实际什么都没审**。事后补救 `--sha <代码提交>` 只解决"记录缺失"，不解决"评审没跑"。

## 三、测量纪律（本轮自己踩到的一次假阴性）

第一次做跨切片复测时，探针写成 `git diff ... 2>/dev/null || true` 交给 `execSync`（Windows 下走 cmd.exe），
cmd.exe 不认 `/dev/null` ⇒ git **根本没执行**，三条切片全报「SQL 命中 0」。
如果照那个读数写结论，就会得出"这条假阳性不存在、不必补文档"——正好把要修的东西判没了。
处置：改用 `execFileSync('git', [...])`、去掉重定向，并给探针加**自证**（打印每档的 diff 变更行总数与一条正控）。
这与既有口径同源：**「0 命中」先证明我的坐标是旧的 / 探针是活的**。

## 四、naming 与合并顺序

新节取号 **§6A / §6B**（不是 §3.3/§3.4），因为 #4539 在飞内容里已经占用了 §3.3/§3.4 两个编号；
若本篇先合、#4539 后合，也不会出现重复锚点。这个选择本身按合同 §5 的"锚点唯一"纪律做的，不是随手编号。

## CHANGELOG 条目

# docs(无障碍合同): 关联判据改为断 label.control，并记录 QM-6 判定会把 select 标签名误判成 SQL（ux-audit-label-contract-lock-pattern）

- 标签关联合同的锁写法正解更新：不再用"标签名白名单"判目标是否 labelable，改断 `label.control` / `control.labels` 这两个浏览器给的事实——它同时证出「目标存在」「目标 labelable」「双向关联成立」，比白名单更强也更省。
- 记录一条会让人白跑一天的机制：QM-6 判定器的 SQL 敏感词形态（带 `i` 标志）会命中 HTML 的 `select` 标签名，导致"给下拉框补可访问名"这类纯无障碍修复被结构性判成"改动涉及数据库"并落入 DUAL。三条在飞切片实测 2/2、22/22、14/14 全是标签名、零行涉及真 SQL。
- 另记两条链路现场：pre-commit 的 CCG 门禁在找不到 `run_skill.js` 时会打印告警并返回 0（于是提交没有判定产物、深度审查随后 fail-closed）；`deep-review.sh` 按父提交 sha 取判定记录，所以必须紧跟代码提交跑，先补文档提交会让它读到 SKIP 记录并按设计不跑却 rc=0。
