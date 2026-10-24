---
record: fix-clickable-roles-plan-space
task: 主干红收口 —— member-center 订阅页方案行的键盘可达性（补齐 Space + 登记条件绑定站点），修 #4414 / #4415
date: 2026-10-25
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src）；合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：主干红收口 —— 方案行补齐 Space 并登记条件绑定站点（fix-clickable-roles-plan-space，2026-10-25）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 主干红定位 | ✅ | main tip `558fbb72`，run `40118636909`，失败作业 `QG Coverage`(120945804661) / `QG Desktop Shards (2/2)`(120945804721) / `Gate Result`(120952610297)。取 6,042,074 字节 `--log-failed`，按 `String.fromCharCode(27)` 剥 ANSI 后唯一真因：`src/clickable-roles.contract.test.js` 两条断言，现场读数 `[clickable-roles] 站点=76 已补全=42 仍缺=31（去重键） widget角色=2`、`未登记=1 陈旧=0`，待登记键 `/views/member-center/Subscription.vue\|li\|canBuyPlan(plan.id) && openPay({ plan: p` |
| 变更类型与隔离 | ⚠️ **偏离，如实登记** | 规范要 `apps/desktop/` 变更走独立 worktree（D 盘）。本机 D 盘可用仅 ~60M（`df`：`821G 821G 64M 100% /d`），新建 worktree 实测约 700MB，且切到当前 main 的检出差量实测 `1340 files / +160598`（半路 ENOSPC 会把工作树留在半更新态，本仓发生过）。故整条分支**在对象层构造**：`read-tree origin/main` → `update-index` 换 2 个 blob → `git diff --cached --name-status origin/main` 必须恰好 2 个文件否则拒绝 → `write-tree` → `commit-tree -p 558fbb72`。**未创建/未触碰任何工作树，也未写共享根 index**。commit `9824308b466d76f5a04c6af01b655c98e9473702` |
| 红先于绿 | ✅ | 红就是主干现状（`未登记=1`），本记录上方读数即其现场；本批不新增判据，只补实现与登记 |
| TDD 顺序 | ⚠️ **未跑本机套件，如实登记** | 未执行 `vitest run src/clickable-roles.contract.test.js` —— 缺可运行的当前-main 工作树（见上一行）。红→绿判据交给 CI 的 `QG Coverage` / `QG Desktop Shards (2/2)`，而这两格正是当前红的格子，因此 CI 是本修复的**直接判据**而非兜底。仍红时按 PR 正文请求：贴读数，**不得**改用放宽阈值收口 |
| 静态验证（做到的部分） | ✅ | 改动以硬断言驱动：`@keydown.enter` 原文唯一命中、`@keydown.space` 原本不存在、改完恰好 2 行键盘处理（`vue_keydown_lines=2` 逐行打印核对）、台账 `ledger_entries=31`（主干实测 30）、待登记键**直接抄自 job 日志**不手敲；测试文件复制成 `.mjs` 后 `node --check` 通过；`Subscription.vue` 经仓库自带 `@vue/compiler-sfc` `parse` + `compileTemplate` ⇒ **parse errors=0 / template compile errors=0**，且编译产物里 `enter`、`space` 两个键都在（证明处理器真被发出，不是写了个不生效的属性） |
| 阈值与豁免纪律 | ✅ | **一个阈值都没动**。上界断言是 `expect(LEDGER.length).toBeLessThanOrEqual(31)` 与 `gapKeys.length <= LEDGER.length`；主干台账实数 30 ⇒ 登记后 31=31 两处仍合规。未新增 `skip`、未缩扫描域、未改 `STATIC_ROLE_RE` 的"只认静态 role"语义（那是 :609 要求人认账的前提） |
| 为什么必须两件事同做 | ✅ | 镜像断言「键盘处理必须逐字镜像鼠标处理」遍历域是 `for (const s of fixed)`，而 `fixed` 要求**静态** `role="button"` ⇒ 条件绑定站点永远进不了该断言。只登记不补 Space＝登记动作把该站点从全部探测器视野里摘掉（豁免名单在这里是"关掉探测器"，不是"承认欠账"）。该口径已入库：记忆 `project-mulpub-ledger-exemption-hides-real-gap` |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/`，也未改 `packages/rpa-engine/`；改动是渲染层模板事件修饰符与一条测试台账 |
| QM-4 视觉回归 | N/A | 未改样式、结构、文案与像素可见属性（只加 `@keydown.*` 处理器与 `.prevent` 修饰符，编译后不产生 DOM 变化）⇒ 判定域内基线不受影响。若 CI 像素门仍报 `settings`/`member-center` 相关差异，按既有口径不更新基线、直接贴读数 |
| 文档同步 | ✅ | 本记录 + PR 正文（含取证、偏离声明、修法理由）；`.vue` 与 `.test.js` 的注释同步说明"条件绑定 + Space 缺失"这一格为何必须成对 |

| 远程同步 | 由门禁推导 |

- 保留门禁：主干红定位 ✅ | 阈值未放宽 ✅ | 文档同步 ✅ | 远程同步 PR #4416

## 一、这一批的三处可复用事实

1. **条件绑定让站点退出"逐字镜像"断言的遍历域**：登记 = 关掉探测器，因此登记必须与真实补齐同 PR（判据本体 :345-347 / :549 / :604-609 逐行核对，不是从文案猜的）。
2. **两个数都叫"台账规模"但不是同一个量**：`gapKeys.length`（缺口数，日志里的 31）≠ `LEDGER.length`（台账数，实数 30）。我第一轮据此断言"登记会撞上界、必须同 PR 再清一处"，是把前者当成了后者 —— 分开当场量一次即可推翻，代价是一次错误结论。
3. **主干红会让 PR 侧一条 run 都不调度**：PR 处于 `CONFLICTING/DIRTY` 时 `actions/runs?head_sha=` 与 `commits/<sha>/check-runs` 均为 0（不是排队、不是拥塞）。所以"没有检查"的第一判据是 `gh pr view --json mergeable`，不是重推或 rerun。

## 二、遗留（不在本批做）

- `member-center` 订阅页的结构性正解是把"买这个方案"提为行内真 `<button>`（`:role` 改静态或撤掉 li 的 role/tabindex），那会改变可见控件结构与焦点顺序，属产品裁决；届时本条登记项按 :104 先例的销账条件删除。
- `check-pr-exec-record.js` 取证混源（变更集按 ref、产物内容按文件系统）：`--head` 指向非当前检出时会把"工作树里没有这个文件"报成"产物解析不动"。属 `scripts/check-*` 高危面，另片处理（本 PR 不受其影响：判据读的是主干台账，我用 `git cat-file` 独立数过 30 条）。
