---
record: ui-design-nav-labels
task: 修正设计稿顶部导航的状态屏链接文字（外部评审 i8 的实际修复）—— 13 处导航文字去掉状态后缀导致 10 组完全相同
date: 2026-10-25
---

## 本次执行记录：设计稿导航状态屏链接文字修正（ui-design-nav-labels，2026-10-25）

### 一、这修的是什么

上一版设计稿（PR #4444，47 屏）顶部有 47 个锚点链接。装配时把标题里的**状态后缀**
（`· 空态` / `· 失败态` / `· 加载态` / `· 工作台` / `· 经典模式`）剥掉了，
于是同一页面的多个状态屏在导航里**共用同一个链接文字**。

**实测（修复前，主干上的产物）**：

| 读数 | 值 |
|------|-----|
| 导航链接数 | 47 |
| **唯一文字数** | **35** |
| **完全相同的文字组** | **10** |
| 最严重的一组 | 「20 自动化任务」× 3（主态 / 空态 / 失败态） |

后果：读者在导航里点「20 自动化任务」，跳到的是哪一屏**取决于点的是第几个同名链接**——
导航失去了区分能力。

### 二、根因：核验对象错了（不是「设计有问题」）

这条缺陷是**外部评审（critic=claude）i8 提出的**。当时的裁决把它**驳回**了，
理由写的是「实测 47 个导航链接文字**全部唯一**」。

**那个「实测」核的是设计源里的 `mp-full.html`，不是仓内产物 `index.html`。**
两者在那一刻是不同步的：`mp-full.html` 已经在评审后修过（assemble.js 的导航注入已带后缀），
而仓内 `index.html` 是**评审前装配的那一版**。

⇒ 驳回的理由本身有实测支撑，但**核验对象不是最终交付物** ⇒ 结论无效。
这与本轮反复出现的同一条教训是同一件事：**「源文件对」≠「产物对」**，
验收必须打在**最终产物**上。

本 PR 落地后已补上**产物级**校验（见 §四），并把规则写进规格书 §12。

### 三、修法

**只改 13 个 `<a>` 的文字**，带状态后缀，与设计源 `assemble.js` 的行为对齐：

```
- <a href="#s-automation-empty">20 自动化任务</a>
+ <a href="#s-automation-empty">20 自动化任务 · 空态</a>
```

**diff 范围**：13 行增 / 13 行删（`index.html`）+ 规格书新增 §12。**零其它改动** ——
屏内容、Hero 配置、样式、截图全部未动。

另外在规格书新增 **§12 设计稿导航**，把规则写死给实现者：

| 规则 | 内容 |
|------|------|
| 编号 | 同页多状态**共用编号**（编号表达「第几页」） |
| 标题 | 状态屏标题**必须带状态后缀** |
| 唯一性 | **47 个链接文字两两不同**（硬约束，非风格偏好） |
| 对应关系 | 链接文字 = 屏 caption 标题；锚点 = 屏 id |

### 四、外部评审逐条处置

本轮外部评审：critic=`claude`（引擎同时派了 proposer=`opencode`，本轮差量判定档为 **SINGLE** ⇒ 引擎只派单模型）。
critic 产出 **6 条**意见（correctness 4 / security 8 / performance 9 / maintainability 5，最低分 4）。
其中 **5 条**（Critical/Warning）进裁决模板逐条填 prosecution / defense / verdict / rationale；
**1 条**（Info）引擎不列入待裁模板，但**逐条写明处置** —— 外部意见不允许「消失」。
**高危域 1 条**（i2）⇒ 已填满 `externalReview` 三格（performedBy / evidenceRef / reviewedAt）。

**公开外部证据**：critic 原始输出逐字 + 逐条裁决 + 可核取证坐标，已发布为 PR 公开评论：
https://github.com/Colinchiu007/mulpub/pull/4468#issuecomment-6398771166

| 条目 | 级别 / 维度 | 裁决 | 可核理由 |
|------|-------------|------|---------|
| **i1** | Critical / correctness | **dismissed** | 三个子项都不构成缺陷：sha 挂父提交是 pre-commit 既定行为；pending 入库是评审链的中间态且本轮已闭环写回；changedLines=0 是「只计源码行」口径下的正确值（本次差量全是文档资源）。 |
| **i2** | Warning / correctness | **upheld** | 指控的**问题**成立（记录当时没给公开链接，读者无法独立核验「外部评审跑过」这件事）。 |
| **i3** | Warning / maintainability | **dismissed** | 241 / 13-13 / changedLines=0 是三个不同口径（整个差量 / 单文件行级 / 源码行），各自有出处，不是矛盾。 |
| **i4** | Warning / correctness | **upheld** | 成立。 |
| **i5** | Warning / maintainability | **dismissed** | 内容寻址命名是仓内既定机制（判定器生成，2200+ 份同形态），改成可读名会破坏「记录 ↔ 差量」对应关系，而该对应关系正是深审按差量取记录的依据。 |
| **i6** | Info / maintainability | **upheld** | 已修：规格书头部标注修订日期（文件名沿用初版日期，不牵动两处已入库的历史执行记录）。 |

各条的完整 prosecution / defense / rationale 见 PR 公开评论与 `.adversarial/ccg-deep-86f8b485/adjudication.json`。

**逐条取证坐标**（可复算）：

- i1：判定记录里的 `sha` == `git rev-parse HEAD^`（父提交），深审入口输出「判定记录写在父 sha 上——这是预期行为」；被评差量由 `stagedDiffHash`（= 文件名，内容寻址）标识
- i2：公开外部证据（critic 原始输出逐字 + 逐条裁决）即上述 PR 评论；执行记录 §四 引用该 URL
- i3：`git diff --stat origin/main...HEAD` = 4 文件 / 180 增 / 13 删（整个差量）；index.html 单文件 = 13/13；判据 `changedLines=0` = 只计**源码行**（本次差量全是文档资源，唯一的 .json 是判定器自己的产物、被 `SELF_ARTIFACT_PATH` 排除）⇒ 三个数字是三个口径，不是矛盾
- i4：可执行校验脚本已写好并实测通过（47 链接 / 47 唯一文字 / 死链 0 / 屏 id 唯一）；**尚未挂进 CI** —— 按 AGENTS.md，新增 required check / 改 `scripts/check-*` 判据本体都属改「谁来守门」，须人工过目，已向用户提出三选一
- i5：判定记录文件名 == 记录内 `stagedDiffHash` 字段（内容寻址），仓内 2200+ 份同形态
- i6：规格书头部已有「**修订**：2026-10-25 修订」标注；文件名保留初版日期（被两份已入库历史执行记录引用）
### 五、门禁

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离声明 | ✅ | 纯文档/规格变更：`01-docs/ui-reference/design-2026-10/index.html`（13 行导航文字）+ 同目录规格书（新增 §12）。隔离 worktree `mp-ui-design-nav`，裸分支 `ui-design-nav`。**未触碰共享主工作区**。 |
| 产物级验证（修复后） | ✅ | 浏览器实测：屏 47 / 导航 47 / **唯一文字 47** / 重复组 0 / 死链 0 / JS 报错 0 / **导航跳转 47/47**。 |
| 修复前基线（可复算） | ✅ | 主干产物实测：47 链接 / 35 唯一文字 / 10 组完全相同（最严重「20 自动化任务」×3）。 |
| 差异范围 | ✅ | `git diff --stat` = 13 insertions / 13 deletions（index.html）；屏内容 / Hero 配置 / 样式 / 截图**零改动**。 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS。 |
| 绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js` → PASS。 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致。 |
| 文档同步（doc-gate） | ✅ | 无代码变更（仅 `.md` / `.html`）。 |
| CHANGELOG 收口 | N/A | 不触碰运行时代码，无用户可见行为变更。 |
| 执行记录 | ✅ | 本文件（承载面 `openspec/records/`；不写 `.quality-gates.md`、不写 ledger、不带 `sync_*` 字段）。 |
| QM-6 外部双家族评审 | ✅ | 真实后端跑通（`scripts/deep-review.sh --check-deps` 体检通过；critic=claude、proposer=opencode 裸名自检均落到真实可执行文件）。critic 产出 6 条意见（correctness 4 / security 8 / performance 9 / maintainability 5）⇒ 5 条进待裁模板逐条给出 prosecution / defense / verdict / rationale（**2 条成立已修、3 条驳回**），1 条 Info 级另写处置；**高危域 1 条（i2）已填满 `externalReview` 三格**（performedBy=claude / evidenceRef=公开 PR 评论 URL / reviewedAt=ISO）。critic 原始输出逐字 + 逐条裁决 + 可核取证坐标已发布为公开 PR 评论（§四）。 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导。 |

- 保留门禁：判定 docs-only=true | 行尾对账 ✅ | 品牌残留 ✅ | 绝对路径 ✅ | 文档同步 ✅ | CHANGELOG N/A | 执行记录 ✅ | 远程同步 PR #XXXX

### 六、交付物

- `01-docs/ui-reference/design-2026-10/index.html` —— 13 处导航文字修正（**其余内容逐字未动**）
- `01-docs/ui-reference/design-2026-10/UI-DESIGN-FINAL-2026-10-24.md` —— 新增 §12「设计稿导航」

### 七、未闭合（不假装已闭合）

1. **i4 的残余 —— 回归脚本尚未挂进 CI**：可执行校验脚本已写好并实测通过，但**没有进 CI 门禁**。
   按 AGENTS.md 的分层策略，「给 CI 新增一条 required check」与「改动 `scripts/check-*` 判据本体」
   都属**改「谁来守门」**，必须人工过目，不能由 agent 在本 PR 内夹带 ⇒ 已向用户提出三选一：
   ① 新增独立门禁脚本并挂进 CI；② 并入现有 `scripts/check-ui-wired.js`（判定域从运行时视图扩到设计稿产物）；
   ③ 不进 CI，只留脚本 + 规格书 §12 约束（靠人盯）。
   **在用户选定前，规格书 §12 的「47 个链接文字两两不同」是一条只有文字约束、没有机械闸的规则** ——
   这正是本轮反复出现的那条教训的翻版，已如实留档而不假装闭环。

### 八、本轮沉淀的教训（补进 agent 记忆）

**驳回一条评审意见前，「实测」的核验对象必须与交付物是同一份。**
本次 i8 被驳回的理由「实测 47 个链接文字全部唯一」在字面上为真 —— 但核的是设计源而非仓内产物，
而两者当时不同步 ⇒ 驳回结论无效 ⇒ 缺陷进了主干。

**可复用的做法**：评审裁决里凡写「实测 X」的，一律把「X 是从哪一份文件读出来的」一并记下；
若那份文件不是最终产物（而是源 / 工作副本 / 中间态），那条实测**只能证明源对，不能证明产物对**。
