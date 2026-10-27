# 本次执行记录：9 篇执行记录的 CHANGELOG 小节标题归一（changelog-heading-normalize，2026-10-27）【docs-only】

- 分支：`changelog-heading-normalize`（worktree：`<仓库父目录>/mp-worktrees/mp-changelog-heading-normalize`，非 C 盘；建树后 `git rev-parse HEAD` == `origin/main`（`1941dacfe`）才动手）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**commit 之后**取证）
- 发现来源：审计 4.3 第三批（PR #4520）复核自家记录时顺带查出——我自己两条在飞 PR（#4500 / #4501）的记录写成 `## 八、CHANGELOG 条目`，据此回扫全仓

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：判定 docs-only ✅（见下）| 行尾两口径一致 ✅ | 品牌残留 ✅ | 本机绝对路径 ✅ | 文档同步 ✅ | 聚合器 A/B 现场 ✅ | 远程同步 由门禁推导

## 一、缺陷

`scripts/aggregate-changelog.js` 定位每篇执行记录里待搬运小节用的是**单条严格正则**：

```js
const CHANGELOG_SECTION_RE = /^##[ \t]+CHANGELOG 条目[ \t]*$/;
```

它是**唯一识别键**。标题带序号前缀（`## 6. CHANGELOG 条目` / `## 六、CHANGELOG 条目` / `## 9. …`）时，`parseRecordSections()` 返回 `changelog: null` —— **不抛错、不计入 `malformed`、不计入 `missing`**（`missing` 只统计"整篇没有 CHANGELOG 小节"的文件，"有小节但标题不被认"这一格对它结构性隐形）。后果是这 9 条变更说明**永远不会进 `CHANGELOG.md`**，而发版收口时 `release-gate.mjs` 看的是聚合器读数，读数里根本没有它们的位置。

清点现场（`openspec/records/*.md`，按 `git ls-tree origin/main` 枚举，**878** 个文件）：

- 规范小节 **111** 篇；
- 非规范 **13** 行，逐条判归后分三类：
  - **9 篇 = 真欠账**：小节体首行是台账级 H1（`# …`），确实是一条待发版搬运的条目 → 本批归一；
  - **2 篇 = 旧体制说明，不动**：`member-tier-contract.md`（`## CHANGELOG 条目（暂移到执行记录：热文件冲突说明）`）与 `fix-settings-roundtrip.md`（`## 附：合并后由 docs-only 回填 PR 使用的 CHANGELOG 条目原文`）。这两篇是聚合器体制（2026-10-05 之后）落地**之前**的产物，小节体首行**不是** H1，而是"为什么不进 CHANGELOG"的说明段。归一它们会把一段散文当成台账条目搬进 CHANGELOG，属制造新错，因此刻意保留原样；
  - **2 行 = 假命中**：`## 本次执行记录：… + CHANGELOG 条目（…）【docs-only】` 是**记录标题**，不是小节标题（`backfill-2898-record.md` / `hotfile-docs-error-message-audit.md`）。枚举判据必须显式排除这一形态，否则"非规范 13"会被当成 13 条欠账。

被归一的 9 篇及其条目首行（逐条判归，每条都核过"该首行文本是否已在 `CHANGELOG.md` 出现"= 全部 false）：

| 记录 | 原标题 | 条目首行（截断） |
|---|---|---|
| `ci-scheduler-parity-budget.md` | `## 6. CHANGELOG 条目` | 主干红可归因：parity 的 python 子进程现在自带时长打点… |
| `dashboard-collector-channel.md` | `## 六、…` | feat(dashboard): 账号粉丝采集的契约层与接线 —— 取不到就报错… |
| `dashboard-collector-runtime.md` | `## 七、…` | feat(dashboard): 账号粉丝采集通道的执行体 —— 隐藏窗口… |
| `dashboard-fan-followers.md` | `## 七、…` | docs(dashboard): 补齐账号粉丝数的采集通道规格… |
| `dashboard-followers-ui.md` | `## 六、…` | feat(dashboard): 账号粉丝上屏 —— 三态分开… |
| `ux-audit-accounts-load-failure.md` | `## 6. …` | fix(采集/账号): 账号页首屏启动链的失败必须可见… |
| `ux-audit-collection-batch-default.md` | `## 7. …` | fix(采集页): 批量「目标平台」默认值改由平台目录数据流驱动… |
| `ux-audit-locale-pair-gate.md` | `## 6. …` | Gate 7 新增 locale zh/en 键集对称档… |
| `wechat-pay-orders-page.md` | `## 9. …` | 会员中心「订单与账单」展示真实订单 |

## 二、修法与判据

**只改标题行**，正文一字不动：9 个文件各 `1\t1`（`git diff --numstat`），共 9 行。判归条件写死在执行脚本里：小节体**首行必须是台账级 H1**（`/^#\s+\S/`），否则抛错拒绝归一；标题已是规范形态则跳过。因此这次批量改写不可能把"旧体制说明段"误搬成条目。

未采用的两种"更省事"的修法，以及为什么不用：

- **放宽正则**为 `^##[ \t]*(?:[0-9]+|[一二三四五六七八九十]+)[.、] ?CHANGELOG 条目$`：能让 9 篇立刻被认出来，但那是**把约定漂移固化成受保护形态**——下一次写成 `### CHANGELOG 条目` 或 `## CHANGELOG 条目（续）` 仍然静默丢失，而放宽后的判据再也不会出声。本仓对计数/形态型判据的既有口径是"补东西而非调阈值"。
- **登记成欠账清单**：等于让这 9 条变更说明继续不落地，只为省一次改标题。

## 三、读数（聚合器自己的现场，同一次树两档）

| 计数 | 改前 | 改后 | 期望 |
|---|---|---|---|
| `records` | 895 | 895 | 不变（我没增删记录文件） |
| `missing` | 766 | **757** | 恰好 −9 |
| `landed` | 82 | **91** | 恰好 +9 |
| `malformed` | 6 | 6 | 不变（没制造新的坏形态） |
| `duprisk` | 0 | **0** | 不变 ⇒ 这 9 条与已落地内容**无重名/重复风险** |

`duprisk=0` 是这批能否安全恢复的关键一格：聚合器自带重复检测，若某条已被别的形态落进台账，它会报出来。`--dry-run` 不写盘，所以以上读数对 `CHANGELOG.md` 零副作用（真搬运由发版流程执行 `--write`）。

其余门禁：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径一致（9 行，无行尾被改写）；`check-no-brand-residue.js` ✅；`check-doc-abs-paths.js` ✅；`check-gate-record-debt.js` OK；`check-docs-sync`（doc-gate）✅。

## 四、QM-5 五步对照

1. 第一性原因：小节标题的**字符串形态**是聚合器的唯一识别键，而"带序号"这一写法来自记录模板里相邻小节的编号风格（同一篇里 `## 一、缺陷` `## 二、…` 都是序号，写到 CHANGELOG 那节就顺手编号了）。
2. 逃逸链：单元测试（无——聚合器的正则测试只测规范形态）→ 集成（`--dry-run` 的 `missing` 语义不覆盖这一格）→ CI（`release-gate` 看聚合器读数，而读数里没它）→ 审查（没人逐篇核对小节标题）。
3. 系统性漏洞：`aggregate-changelog.js` 把"认不出"实现成了"当作没有"——识别失败**不出声**。这与本仓反复出现的「装饰性门禁」同型，只是方向相反：不是恒绿的锁，是恒真的跳过。
4. 修复 + 回归保护：本批为存量归一；防再犯的机械锁与"识别失败必须出声"的改造另案（见 §五），因为它要动 `scripts/` 与 `.github/workflows/`，属混合 PR。
5. 预防：记忆已入库（`project-changelog-heading-recognition-key.md`），口径是"新写记录时该标题逐字为 `## CHANGELOG 条目`，落盘后用 `parseRecordSections(...).changelog` 的**类型**自证被识别（`string` 才算，`null` 的 `typeof` 也是 `object`，所以探针必须打印实际值不能只看 truthy）"。

## 五、遗留（不假装已闭合）

1. **防再犯锁（混合 PR）**：`scripts/check-changelog-heading.js` 枚举 `openspec/records/*.md`，对"标题含 `CHANGELOG 条目` 但不命中规范正则、且小节体首行是台账级 H1"的文件点名并 rc=1；另两格（旧体制说明段、记录标题行）必须显式分类，不得静默计入也不得判红。同 PR 把聚合器的 `changelog: null` 改为**出声**（`formatReport` 增加 `unrecognizedSection=` 一档）。接进 `quality-gate.yml` Gate 2b（`shell: bash`，fail-fast）。
2. `member-tier-contract.md` / `fix-settings-roundtrip.md` 两篇旧体制记录要不要补一条规范条目，属"这条变更当年是否已经人工写进台账"的判断，需逐条人工核对后另案。
3. 本仓另有 2 行**记录标题**含 `CHANGELOG 条目` 字样，任何未来判据都必须先排除 `^## 本次执行记录` 形态——我的第一版枚举没排除，于是把欠账读成 13 条（真值 9 条）。

## CHANGELOG 条目

# 9 篇执行记录的 CHANGELOG 小节标题归一，发版时不再静默丢条目

CHANGELOG 台账聚合器靠小节标题的字面形态识别每篇执行记录里"该搬进 CHANGELOG 的那一节"，标题写成 `## 6. CHANGELOG 条目` / `## 六、CHANGELOG 条目` 这类带序号的形态时它不是报错、而是**当作这一篇没有条目**，于是 9 条变更说明（账号粉丝采集四条、采集页两条修复、主干红归因、locale 对称门禁、会员订单页）自写下起永远不会进台账，而 `--dry-run` 的三个计数里没有任何一格会因此变红。本批把这 9 篇的标题逐字归一，聚合器现场读数随之为 `missing 766→757`、`landed 82→91`、`duprisk=0`（确认与已落地内容不重复）。另有 2 篇是聚合器体制落地前的"为什么不进 CHANGELOG"说明段，正文不是台账条目，刻意保持原样。
