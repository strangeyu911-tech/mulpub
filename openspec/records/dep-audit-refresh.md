---
record: dep-audit-refresh
task: 在 #4452 的基线刷新载体上登记 deepmerge 新公告（GHSA-gcqx-w48m-w2h4，上游无修复版），解全仓 PR 的「依赖漏洞审计」连红
date: 2026-10-28
---

## 本次执行记录：登记 deepmerge 公告（GHSA-gcqx-w48m-w2h4）并收口 #4452（dep-audit-refresh，2026-10-28）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混含 `scripts/dep-audit-baseline.json`（数据面）⇒ 按完整门禁处理；改动只在隔离 worktree（`mp-worktrees/mp-dep-4452`，裸分支 `dep-audit-4452`），共享根（仓库根 `.`）保持 main、零落盘 |
| 第一性原因（QM-5 ①） | ✅ | 见 §1：公告库新增一条 `npm/GHSA-gcqx-w48m-w2h4`，而基线里没有对应条目 ⇒ 门禁按 `NEW_ADVISORY` 硬阻断；#4452 原 diff 只是 JSON 缩进整理（`scripts/dep-audit-baseline.json` 5 增 5 删），未登记该条 |
| 逃逸分析（QM-5 ②） | ✅ | 见 §2：公告由 `pnpm audit` 实时拉取，基线只能人手写；本条公告的修复版 `>=4.3.2` 上游未发布，机器 `--update` 也无法预填承诺 ⇒ 只能人工判 `no-fix-available` |
| 修复 + 回归保护（QM-5 ④） | ✅ | 基线新增 1 条（17 → 18 条），`node scripts/check-dep-audit.js` rc=1 → **rc=0**；回归锁 `scripts/check-dep-audit.test.js` **77/77 通过**（含「非 upgrade-tracked 条目不得带 targetVersion」与「入库基线自洽」两条） |
| 防止再次发生（QM-5 ⑤） | ✅ | 见 §4：note 内写明复核条件（deepmerge latest > 4.3.1 / 出现新调用点），条目本身受顶层 `reviewBy=2026-12-31` 到期约束；不改判据本体、不改白名单 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等（`scripts/dep-audit-baseline.json` 12 增 0 删、`openspec/records/dep-audit-refresh.md` 143 增 0 删，本轮零删除）；详见 §5 |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（只动 `scripts/` 数据文件与 `openspec/records/`） |
| QM-6 CCG 双模型外部评审 | ⚠ 未执行（按门禁出口②收口） | 未跑 `sh scripts/deep-review.sh`（单次 >15 分钟，后端实测可用：`--check-deps` 通过、claude+opencode 在 PATH、wrapperReady=true）。pre-commit 自动生成的判定记录 `.ccg/reviews/e5c05eae….json` 被判 `mode=dual`，触发依据是「命中 auth/数据库/加密：敏感内容 1 处」；复核其 stats：`sensitivePathHits=[]`、`ccgSensitiveContentHits=0`，计入的只有 `sensitiveContentHits=1` + `docSensitiveContentHits=2`，命中原文是 `pnpm audit` / `pnpm update deepmerge` 两条命令字面 ⇒ **词面误命中（假阳性）**。本 PR 不命中 `HIGH_RISK_SURFACES`（`scripts/check-` / `scripts/ccg-review-` / `.github/workflows/` 三条前缀均不匹配）⇒ 按门禁出口②写 `closureNote`（含「第 1 轮」轮次标记 + 逐条处置）并把 `status` 置 `self_play_resolved`，`tier` 维持 `unknown` 未声明 external。**分工声明**：该收口由 Team Lead 裁决、用户授权「仅非高危面可按出口②逐条取证收口」后执行，不是 agent 自行放行 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史（squash 尾注 `(#4452)`）推导归属 |

## 1. 现象与实测读数

进入本轮时，全仓 PR 的 `依赖漏洞审计` 一律红。本地在 worktree 里实跑（`NPM_AUDIT_REGISTRY=https://registry.npmjs.org`）：

```
=== 依赖漏洞审计门禁 ===
命中分布: npm=14 npm-opscenter=2 pip=2 命中=18 挂账=17
❌ NEW_ADVISORY: npm/GHSA-gcqx-w48m-w2h4 (deepmerge low, 修复版本 >=4.3.2, 路径 apps__desktop) —— 升级依赖，或在基线登记 decision + note
EXITCODE=1
```

⇒ `命中=18 / 挂账=17`，缺口恰好 1 条：基线缺 `deepmerge` 这条公告。这是**全仓性**阻断——门禁的 `dep-audit.yml` 对每个 PR 跑全量扫描，与本 PR 改了什么无关（该机制事实已由 `openspec/records/dep-audit-baseline-refresh-2026-10-24.md` §2 逐条取证，本轮复核仍成立）。

## 2. 本条公告的事实（逐条取证，不写推断）

| 事实 | 取值 | 取证命令/来源 |
|---|---|---|
| 公告 id / 标题 | `GHSA-gcqx-w48m-w2h4` —— deepmerge mergeObject() allows prototype poisoning of returned objects | `pnpm audit --prod --json` 原始响应 |
| 严重度 | `low`（CVSS v3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`） | 同左 + OSV `api.osv.dev/v1/vulns/GHSA-gcqx-w48m-w2h4` |
| 漏洞区间 | `>=4.2.0 <=4.3.1` | `pnpm audit` 的 `vulnerable_versions` |
| 公告声称的修复下界 | `>=4.3.2` | `pnpm audit` 的 `patched_versions` |
| 本仓实际解析版本 | `4.3.1` | `pnpm why deepmerge` |
| 依赖链 | `@multi-publish/desktop` → `puppeteer-extra-plugin-stealth@2.11.2` → `puppeteer-extra-plugin-user-preferences@2.4.1` → `deepmerge@4.3.1`（全仓 1 个版本，无共存） | 同上 + `pnpm audit` findings 路径 `apps__desktop>puppeteer-extra-plugin-stealth>puppeteer-extra-plugin-user-preferences>deepmerge` |
| **上游是否存在 4.3.2** | **不存在**：`dist-tags` 只有 `latest: 4.3.1`；`versions` 末位 `4.3.1` | `npm view deepmerge dist-tags --json` / `npm view deepmerge versions --json` |
| OSV 侧同一条公告 | `aliases=[CVE-2026-93753]`、`CWE-1321`、`LOW`、`published 2026-09-18`、`github_reviewed 2026-10-27`、affected `introduced 4.2.0 / last_affected 4.3.1`（**无 fixed 事件**） | `https://api.osv.dev/v1/vulns/GHSA-gcqx-w48m-w2h4` |

⇒ **关键判据**：公告要求的修复版本 `>=4.3.2` 在 npm registry 上**根本不存在**，OSV 也未给任何 `fixed` 事件。
因此 `decision` 只能是 `no-fix-available`；写成 `upgrade-tracked` 等于给一个不存在的版本写 `targetVersion`（假挂账），
到期只会换来一条永远闭不上的 `DECISION_OVERDUE`（判据见 `scripts/check-dep-audit.js:1056-1073`）。

## 3. 本 PR 做了什么（以及明确没做什么）

**做了**：在 `scripts/dep-audit-baseline.json` 的 `advisories` 新增 1 条（按 `(source+id).localeCompare` 排序插在 `GHSA-g2v6-…` 与 `GHSA-r28c-…` 之间）：

```json
{
  "source": "npm",
  "id": "GHSA-gcqx-w48m-w2h4",
  "module": "deepmerge",
  "severity": "low",
  "patched": ">=4.3.2",
  "roots": ["apps__desktop"],
  "decision": "no-fix-available",
  "note": "……（含 pnpm why 链、npm view dist-tags、OSV ranges、调用面判断、收敛动作与复核条件）"
}
```

变更后实测（同一命令、同一 registry）：

```
=== 依赖漏洞审计门禁 ===
命中分布: npm=14 npm-opscenter=2 pip=2 命中=18 挂账=18
✅ 无新增已知漏洞公告，基线与现实一致且结论完整。
EXITCODE=0
```

**没有做的事**（避免把结论读大）：
- 没有改 `.github/workflows/**`、`CI_IGNORED_PATHS`、任何 `scripts/check-*` 判据本体、闭环状态白名单；
- 没有动其他 PR 的分支，也没有改 `.quality-gates.md` / `gate-record-debt-ledger.json`（旧载体已冻结）；
- 没有把 `deepmerge` 升到 `4.3.2`（该版本不存在，做不到），也没有写 `accepted-risk` —— 结论是「确无修复版」，不是「风险已接受」；
- 没有跑 `sh scripts/deep-review.sh`（双模型深度审查）。CCG 生成的 dual 判定经复核属**词面误命中**，按门禁出口②（非高危面 + `closureNote` 带轮次与逐条处置）收口，取证见门禁表 QM-6 行与 §6。**更正**：本条初稿写的「本机无 `codeagent-wrapper`」是错的 —— 真机 `sh scripts/deep-review.sh --check-deps` 实测通过（`codeagent-wrapper` = `/c/Users/邱领/.claude/bin/codeagent-wrapper.exe`，claude + opencode 均在 PATH）。没跑的真实原因是耗时（单次 >15 分钟）而本条无代码面，不是后端缺失。

**可利用性判断（note 里标为「判断，非实测」，此处给出依据坐标）**：
`apps/desktop/electron/services/url-collector.js:436` 是 `chromium.use(require('puppeteer-extra-plugin-stealth')())` —— **零参数**实例化；
`node_modules/puppeteer-extra-plugin-user-preferences/index.js` 的两处 merge 输入分别是该插件的默认 `userPrefs: {}` 与各 stealth 插件
**静态声明**的 `userPreferences` 数据（`merge(this._opts.userPrefs, this._userPrefsFromPlugins)`）。
⇒ 渲染进程、被采集网页内容、任何用户可控对象都不进入 `merge`，本仓未构成可达的原型污染路径。
这也是判 LOW 挂账、不触发紧急升级的依据。**未做的**：没有写 PoC 复现，故这是「未构成可达路径」的静态判断，不是动态验证结论。

## 4. 防止再次发生 / 复核条件

- 条目受顶层 `reviewBy = 2026-12-31` 约束：到期前必须完成收敛或改判并给依据（机器不续期）。
- note 内写明**两条**复核触发条件：① `deepmerge` 的 latest 高于 `4.3.1`（上限解除）；② 本仓出现把外部可控对象交给 `deepmerge` 的新调用点（风险面变化）。
- 收敛动作两条任一：上游发 4.3.2 后 `pnpm update deepmerge` 刷新 lockfile；或随 puppeteer-extra 链换掉 `puppeteer-extra-plugin-user-preferences` 这个宿主插件。
- 未新增机器判据（本轮属数据登记，不改「谁来守门」；新增判据的动因与登记表流程见 AGENTS.md「前提锁」一节）。

## 5. 判据与对账读数

| 判据 | 读数 |
|---|---|
| `NPM_AUDIT_REGISTRY=https://registry.npmjs.org node scripts/check-dep-audit.js` | **rc=0**，`命中=18 挂账=18`，✅ 无新增公告 |
| `node --test scripts/check-dep-audit.test.js` | **77 pass / 0 fail** |
| `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | **rc=0**：`OK: 本 PR 携带执行记录或带原因的豁免`；`新增记录 1 篇 / 修订本分支记录 0 篇`；`TIER-COVERAGE dual-closed total=1 external=0 … unknown(字段缺席)=1（unknown 可见不拦）`；`TRANSITION-CHECK 转变=无转变`。**此处刻意不引用「变更文件 N 个」这类随 rebase 漂移的计数**（本 PR 中途 rebase 到新 main，该计数从 3 变 4 —— 引用它等于写一条会自己变假的可核证据）。收口前该判据曾 rc=1，唯一理由是 pre-commit 自动生成的 `.ccg/reviews/e5c05eae….json`（`mode=dual, status=pending`）欠深度审查 —— 复核为词面误命中后按出口②收口，见门禁表 QM-6 行 |
| `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | `docs-only=false`（混含 `scripts/` 数据面）⇒ 走完整门禁，不看 skipping |
| `MP_BASE_REF=$(git rev-parse origin/main) node .github/scripts/check-max-lines.js`（债务熔断同级判据） | **rc=0**，`✅ 无新增超大文件，挂账清单与现实一致`，`domain=13656`（与 CI 同域）。**rebase 前**同一门禁在 CI 上红：`❌ TARGET_BUMP_HEADROOM: packages/api-publish-engine/src/publish-api-server.js 目标 1590 ≠ 当前 1581 行`，而本 PR 从未触碰 `packages/**`。归因=**base 过期**：PR 的 merge-base 是 `7fd9f5ab4`，main 已前进到 `88640e1c0`（落后 111 笔），CI 用旧 base 计算棘轮差量，把主干自己把该目标抬到 1590 的那次改动静默算到了本 PR 头上（本机旧 base 下 `domain=12881`、新 base 下 `domain=13656`，两次读数差异是同一件事的指纹）。处置=`git rebase origin/main` 后同命令转绿，未改任何他人文件 |
| 行尾对账 | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径相等；本轮无删除行 |
| 排序自洽 | 新条目按 `(source+id).localeCompare` 落在 `GGHSA-g2v6` 之后、`GHSA-r28c` 之前；无重复键（18 条 key 去重后仍 18） |
| `node --test scripts/check-doc-abs-paths.test.js`（CI Gate 12c） | **53 pass / 0 fail**。本轮该判据曾红，原因是本篇记录「变更类型与隔离」行里写了两个**裸盘符绝对路径**（worktree 与共享根），CI 报 `openspec/records/dep-audit-refresh.md：2 处 > 基线 0`。处置=**改成相对形态**（`mp-worktrees/mp-dep-4452` 与仓库根 `.`），**没有**跑 `--write-baseline` 放宽基线（那等于改守门件）；判据只拦裸盘符形态，故其它命令原文（`pnpm audit` / `pnpm update deepmerge`）不需改动 |

## 6. 遗留（不假装已闭合）

- `deepmerge@4.3.1` 仍在依赖树里（上游没有修复版），本条属**无解挂账**，只能等上游或换宿主插件；
- 可利用性判为「不可达」是静态读链结论，未做动态 PoC；
- QM-6 双模型深度审查未跑（出口②收口；后端本身可用，见 §3）。若后续判定认为这 12 行数据面确需真外部评审，正解是补跑 `sh scripts/deep-review.sh` 并把 tier 升到 external，而不是继续靠 closureNote 续命。

## 远程同步

<!-- 本文件的唯一 `| 远程同步 |` 行在顶部门禁表第 20 行（状态列=「由门禁推导」）。此处不再重复写表格行：
     `scripts/check-gate-record-debt.js` 的 ROW_RE 认「以 `| 远程同步 |` 开头的行」，
     一篇记录放两行会被判 `新增重复行`（本 PR 实测踩过：结果内容 2 行、本次加 2 行 ⇒ 红）。
     收口由门禁按主干历史推导，合并前判 byDesign，不需要任何写回。 -->

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR，由门禁推导）

## CHANGELOG 条目

# fix(dep-audit): 登记 deepmerge 新公告（GHSA-gcqx-w48m-w2h4，上游无修复版），解全仓 PR 的依赖审计连红（dep-audit-refresh）

- 症状：全仓 PR 的 `依赖漏洞审计` 一律红，本地实测 `命中=18 挂账=17`，缺口是 `❌ NEW_ADVISORY: npm/GHSA-gcqx-w48m-w2h4 (deepmerge low, 修复版本 >=4.3.2, 路径 apps__desktop)` —— 门禁对每个 PR 跑全量扫描，与本 PR 改了什么无关。
- 修法：在 `scripts/dep-audit-baseline.json` 登记该条，`decision=no-fix-available`。依据是公告的修复下界 `>=4.3.2` **在 npm 上不存在**（`npm view deepmerge dist-tags` 只有 `latest=4.3.1`，OSV 的 affected ranges 到 `last_affected=4.3.1` 且无 `fixed` 事件），因此不能写成 `upgrade-tracked` 去承诺一个不存在的版本。
- 影响面：`apps/desktop` 侧 deepmerge 只经 `puppeteer-extra-plugin-stealth@2.11.2 → puppeteer-extra-plugin-user-preferences@2.4.1` 用于合并插件静态配置，零参数实例化、无外部可控输入 ⇒ 判 LOW 挂账，不触发紧急升级。
- 读数：`check-dep-audit.js` rc 1 → 0（`挂账=18`），`check-dep-audit.test.js` 77/77。

## learnings

### lesson: 「修复版本」必须去 registry 反查存在性，公告写的下界不等于有产物

**现场**：`GHSA-gcqx-w48m-w2h4` 在 `pnpm audit` 里报 `patched_versions = >=4.3.2`，而 `npm view deepmerge dist-tags` 只有 `latest = 4.3.1`、`npm view deepmerge versions` 末位也是 `4.3.1`；OSV 同一条公告只有 `introduced 4.2.0 / last_affected 4.3.1`，**没有任何 `fixed` 事件**。

**根因**：公告库（GitHub Advisory / OSV）的 `patched_versions` 是**数据录入**，不是「registry 上真有这个版本」的断言。上游可能先被要求给出下界、拖了很久才发版，于是公告的修复下界会短暂（或长期）**指向一个不存在的版本**。基线判据 `checkTargetEscapes` 只校验 `targetVersion >= patched`，它**不查这个版本是否存在** ⇒ 若照抄公告写 `upgrade-tracked + targetVersion=4.3.2`，门禁当场全绿，但承诺的版本永远装不上，到期变成一条无解的 `DECISION_OVERDUE`。

**可复用的 N 条**：

1. 登记任何 `upgrade-tracked` 之前，先跑一次 `npm view <pkg> dist-tags` / `npm view <pkg> versions`（或 `pip index versions`）确认**承诺的那个版本真的存在**；不存在就判 `no-fix-available`，并在 note 里同时给出「公告说 >=X」与「registry 最高是 Y<X」两个读数。
2. 「门禁绿了」与「账闭得上」是两件事：判据只校验版本区间的算术关系，不校验产物存在性 ⇒ 绿只证明格式合法，不证明承诺可兑现。这类缺口必须在 note 里用文字补，不能靠判据。
3. 判 `no-fix-available` 时要一并交代**为什么不用 `not-exploitable`**（前者说「没有修复产物」，后者说「在本仓不可达」）。两者可以同时成立，结论取哪一个取决于行动：本条有收敛动作（等上游 / 换宿主包），故挂 no-fix-available 并附可达性判断。
