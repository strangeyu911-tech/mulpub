---
record: publish-field-audit
task: 把发布页平台差异化字段的消费面对账审计落进仓库（结论原先只存在于一次会话的对话里，换机器即丢失）
date: 2026-10-25
---

## 本次执行记录：发布字段消费面审计落盘（publish-field-audit，2026-10-25）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档：新增 `docs/publish-field-consumer-audit-2026-10-25.md` 与本篇记录。worktree `<仓库父目录>/mp-worktrees/mp-publish-field-audit` + 裸分支 `publish-field-audit`，起点 `25a125214`。`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的读数在提交后取（见自测块），**未提交时它必然返回 `files=0`**，那是取证顺序不是判定失灵 |
| 为什么放在 `docs/` 而不是 `01-docs/` | ✅ | `.gitignore` 对 `/01-docs/*.md` 与 `/01-docs/**/*.md` 是逐条 `!` 放行的，新 md 放进去会**静默不入版本库**、门禁看不见。当场核过：`git check-ignore --no-index -v docs/publish-field-consumer-audit-2026-10-25.md` rc=1（不忽略），且 `docs/` 在文档同步门禁的 `PRD_PATTERN` 白名单内 |
| 数字可复现性（本篇的核心纪律） | ✅ | 本文**不把数字当权威**，而是把三条重取命令写进 §1。当场实跑：命令 ① = `override=68 implemented=33 capable=35 uiExposed=27`；命令 ② = `TOTAL=27` 并逐平台列出面板字段（抖音 3 条、小红书/视频号/头条外的一档 0 条）。**§1 的命令 ② 第一版是坏的**：它写 `Object.keys(c.PLATFORM_NAMES)`，而 `publish-capabilities.js` 根本不导出 `PLATFORM_NAMES`（导出面实测为 `PLATFORM_PUBLISH_META/NO_TITLE_PLATFORMS/…/resolvePublishChannel`，无 `PLATFORM_NAMES`），照抄会**静默打印空表**——正是本仓「解析退化成空集合而读起来像通过」的同型。已改为从注册表键枚举，并带 `TOTAL=` 计数，空集当场可见 |
| 证据分级（不转述未复核的东西） | ✅ | §2 表逐行标 `★` = 本文作者亲自跑命令读到该行；无星 = 只读探子报告、行号已给出但**未逐条重跑**，并在表前明写"引用未星条目前请重跑 §1 命令"。表末另记一次我自己的错：曾未跑命令就断言"ps1 里没有闸门调用"，被一次真 `grep -n` 否证 |
| 行尾与 diff 对账 | ✅ | 新建文件按 LF 写（`docs/` 下历史文件同形），两口径 numstat 见自测块；未触碰任何置顶型共用写面（`CHANGELOG.md` / `01-docs/learnings.md` 一律不动，按 AGENTS 它们只由聚合器写） |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` = `PASS（扫描 13793 个 tracked 文件，无品牌残留…）`；文中涉及逆向来源处一律写「参考产品」 |
| Gate 12c 绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js --all` = `counts=1161 domain=6630 files=561 canJudge=true PASS`（现场存量 1161 与基线逐文件对齐，本篇零新增）；worktree 路径写 `<仓库父目录>/mp-worktrees/...` 占位符 |
| 文档同步（doc-gate） | ✅ | 本篇 + 审计文档本身即文档面变更；未改任何运行时行为，故无"代码改了文档没跟上"的对称项 |
| QM-1 打包 / QM-2 代码必检 / QM-4 视觉 / TDD | N/A | docs-only 快速通道跳过项（判定见第一行）；**未新增判据与测试文件** ⇒ 接线棘轮 `check-unwired-tests` 的输入集未变 |
| QM-6 双模型评审 | N/A（docs-only） | 按 AGENTS docs-only 通道跳过；**不以自审替代、不谎称跑过**。注意本文件只是"把事实落盘"，真正需要外部评审的是后续 0-1 判据刀（改 `scripts/check-*`，属高危面，届时交人工） |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 提交后取终值
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | Gate 12c ✅ | 远程同步 由门禁推导

## 自测块（当场读数）

- `check-no-brand-residue` PASS（13793 文件）｜`check-doc-abs-paths --all` PASS（`counts=1161 domain=6630 files=561`）
- 审计文档 §1 命令 ① 实跑输出：`override=68 implemented=33 capable=35 uiExposed=27`
- 审计文档 §1 命令 ②（修正后）实跑输出：逐平台 10 行 + `TOTAL=27`
- 待提交后取：`classify-docs-only` 终值、两口径 numstat、`check-pr-exec-record --mode=enforce`

## 未决（不替用户定）

1. 0-2 回落守卫的取向：「拒绝发布并点名」还是「照发但显式告警」。本审计默认倾向前者（私密变公开是不可逆的对外后果），属产品裁决。
2. C 档真机取证需用户账号配合；B 站历史取证发布授权已消耗，任何真投稿型验证须重新确认。
3. B 档 35 条是整体做还是逐平台分刀（建议后者）。
