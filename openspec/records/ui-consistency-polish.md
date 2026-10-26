---
record: ui-consistency-polish
task: 五页 UI 一致性提升（草稿 / 博主监控 / 文案库 / 知识库 / 播客 RSS）+ 播客菜单与标题改名
date: 2026-10-26
---

## 本次执行记录：五页 UI 一致性提升（ui-consistency-polish，2026-10-26）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时渲染层 + 文案 + 测试 + 文档：隔离 worktree `<repoParent>/mp-worktrees/mp-ui-consistency-polish`（非 C 盘）+ 裸分支 `ui-consistency-polish`；共享仓库根保持 main、无 tracked 改动 |
| QM-5 ① 第一性原因 | N/A | 本次为 UI 一致性改造，不是 Bug 修复 |
| QM-5 ② 逃逸分析 | N/A | 同上 |
| QM-5 ④ 修复 + 回归保护 | N/A | 同上；新增 `page-scaffold.contract.test.js` / `PublishDraftsPage.test.js` 作为改造的回归锁 |
| QM-5 ⑤ 防止再次发生 | N/A | 同上；契约测试防「页面各自写骨架样式」回潮 |
| 行尾与 diff 对账 | PASS | `git -c core.whitespace=cr-at-eol diff HEAD~1 --check` → 0；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 双口径逐文件一致（podcast locale 为仓库既有 CRLF，按 `-text` 处理） |
| 接线棘轮 | PASS | 新增 2 个测试文件 + 5 个既有测试扩展，均在 `src/**/*.test.js` 由 `vitest run` 全量收集；无「组件写好了没接线」项 |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/`、`packages/rpa-engine/`；纯渲染层 + 样式 + 文案 |
| QM-2 代码必检项 | PASS | 无硬编码密钥、无 `v-html`、无 `eval`、无 `console.log`；所有 IPC 调用未改动；新增样式只用 token |
| QM-4 视觉 | PASS | `run-pixel-tests.js` 全量浅色 **20/20 PASS**、暗色 **20/20 PASS**；五页截图 14 张（1440/2560 + 空态 + 暗色抽查），见下「视觉验收」 |
| QM-6 CCG 双模型外部评审 | PASS（self-play 裁决，置信 0.6，0 条 upheld） | `sh scripts/deep-review.sh` 实跑：critic=claude / proposer=opencode，8 条发现（0 Critical 遗留 / 4 Warning / 3 Info），i7 在轮内消解；7 条争议逐条 prosecution/defense/verdict；`0` 条高危域、`0` 条 upheld；裁决产物 `.adversarial/ccg-deep-91ba1c10/adjudication.json`，判定记录 `.ccg/reviews/d84c10c6….json` 状态 `self_play_resolved`；`node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` → OK |
| 远程同步 | 由门禁推导 | 本行不手工改写；合并后按 squash 尾注 `(#NNNN)` 由 `scripts/lib/merge-ledger.js` 推导 |

### 变更摘要

- 新增页面骨架层（5 个 CSS 文件，均 < 500 行，token-only）：
  `page-scaffold.css` / `page-controls.css` / `page-skins.css` / `page-skins-knowledge.css` / `page-skins-data.css`，由 `main.js` 在 `premium-design-system.css` 之后导入。
- 草稿页：抽出 `views/PublishDraftsPage.vue`（props `drafts`/`loading`；emit `open`/`delete`/`back`），`Publish.vue` 由 1773 行降至 1695 行（门禁 target 1775）。
- 博主监控：`Collection.vue` 的 creator tab 补上唯一缺失的 `.cohere-content`；`CreatorMonitor.vue` 接入 `mp-panel`/`mp-row`/`mp-chip`/`mp-notice`/`EmptyState`。
- 文案库：页头、`mp-segmented` 来源筛选、`mp-search`、卡片网格与空态接入骨架；空态新增「去采集」动作。
- 知识库：删除 scoped 页头/按钮覆盖（主按钮恢复品牌紫）；页签改 `mp-segmented`；表格改 `mp-table`；分页与积压提示统一。
- 播客 RSS：页头/面板/表单/按钮/结果块/分发卡片接入骨架；`PodcastHostingCard` 同步。
- 命名：左侧菜单「播客 RSS 频道」→「播客」；页面标题→「播客 RSS」；新增 `sidebar.nav.podcast`，菜单 key 仍为 `podcast`。
- `EmptyState.vue`：新增 `scaffold` 布尔 prop（默认 false）；五页启用图标底座 + 标题 + 说明 + CTA 变体，其他页面保持旧观感（白名单新增 User/Collection/Headset）。
- 视觉基线：`podcast-channel.png` / `podcast-channel-dark.png` 按新 UI 重建（旧基线记录的是改造前界面，2.82% diff 来自本次改造本身）。

### 验证证据

- `pnpm exec vitest run`（13 个相关套件）：**405 tests passed / 13 files**
  - Publish / PublishDraftsPage / CopyLibraryView / KnowledgeBaseHotsyncUi / KnowledgeBasePage.viral-queue / PodcastChannelView / Collection / CreatorMonitor / ViralLibraryTable / ViralLibraryTable.p1-display / PodcastHostingCard / sidebar-menu / page-scaffold.contract
- `pnpm run build:vue` → **built in 34.23s**（CopyLibraryView 9.28 kB / KnowledgeBasePage 32.27 kB / PodcastChannelView 34.33 kB）
- `pnpm exec eslint <17 个变更源文件>` → **0 error**
- `node .github/scripts/check-locale-sync.js --symmetry` → **PASS（pairs=61，drift=0）**
- `node .github/scripts/check-locale-sync.js --keys` → **PASS（2402 keys）**
- `node .github/scripts/check-locale-sync.js --cjk` → **PASS（基线 1330，当前 1083，无新增硬编码）**
- `node .github/scripts/check-max-lines.js` → **PASS（无新增超大文件，挂账 94 = 现实 94）**
- `node .github/scripts/check-route-registry.js` → **PASS（36 路由 / 36 登记 / 22 菜单项）**
- `node tests/visual-testing/scripts/run-pixel-tests.js` → **light 20/20 PASS**
- `THEME=dark node tests/visual-testing/scripts/run-pixel-tests.js` → **dark 20/20 PASS**

### 视觉验收（本地截图，1440×900 / 2560×1328）

脚本：`apps/desktop/tests/visual-testing/scripts/capture-ui-consistency.js`（数据 stub：`ui-consistency-stubs.js`）
产物：`apps/desktop/tests/visual-testing/screenshots/ui-consistency/`（gitignored）

| 页面 | 观察结论 |
|---|---|
| 草稿页 | 页头 24px / 副标题 13px；面板单卡承载列表；行内标题/时间/平台徽标/去发布/删除基线一致；空态为图标+标题+说明+返回 |
| 博主监控 | 补齐内容留白；面板头有数量徽标与「添加博主」；平台/能力/质量徽标按语义色收敛；空态有 CTA；行 hover / active 一致 |
| 文案库 | 胶囊筛选 + 胶囊搜索；卡片统一 16px 圆角/发丝描边/柔和投影；标题 2 行、正文 3 行、元信息底栏；空态进面板 |
| 知识库 | 品牌紫主按钮（不再红色）；页签胶囊；表格 44px 表头/56px 行高；标签 chip、分页按钮与数量文案统一 |
| 播客 RSS | 五个面板顺序清晰；表单 36px 控件/双列栅格；主按钮唯一；错误/结果块按 notice 语义；分发卡片统一子卡片样式 |
| 暗色抽查 | 知识库 + 播客无白底残留，正文对比度可读 |

### QM-6 评审发现处置（self-play 裁决，7 条争议）

| 编号 | 级别 | 发现 | 裁决 | 理由（可验证） |
|---|---|---|---|---|
| i1 | Critical | `.ccg/reviews/*.json` 不应入库 | dismissed | `.gitignore` 明确「判定记录 .ccg/reviews/*.json 才是留痕」；仓库现有 2403 个同类受管文件，`check-pr-exec-record` 依赖它们判 QM-6 欠账 |
| i2 | Critical | `.mp-panel input/select/textarea` 可能外溢 | dismissed | 全仓 `mp-panel` 仅 6 个目标组件使用；非目标页不挂该类名，规则不命中 |
| i3 | Critical | `01-docs/PRD.md` 误改 `maxLength` 断行 | dismissed（已修） | 用字节级恢复回父提交原样；`git diff HEAD~1 -- 01-docs/PRD.md` 只含新增附录 |
| i4 | Warning | 5 个 CSS 文件无条件进主包 | dismissed | 合计约 30KB 源码；构建产物 44 个 CSS / 873KB，桌面端仅启动解析一次；拆包会引入 FOUC |
| i5 | Warning | 评审 JSON 暴露后端名/内部字段 | dismissed | 与 i1 同源；无凭据/用户数据，字段结构与既有 2403 个文件一致 |
| i6 | Warning | 播客两组件删除 scoped 样式后替换不全 | dismissed | 逐 selector 对照（header/subtitle/section/form/episode/result/endpoint/hosting）；浅/暗像素 20/20 通过 |
| i8 | Warning | `mp-page-inner` 最大宽度影响非目标页 | dismissed | 全仓 `mp-page` 仅 4 个目标视图；`mp-page-inner` 只随 `mp-page` 出现 |

- 原始 8 条发现中 i7 已在评审轮内消解（未进入裁决清单）。
- 裁决产物：`.adversarial/ccg-deep-91ba1c10/adjudication.json`（7/7 条均有 prosecution / defense / verdict / rationale）。
- 判定记录：`.ccg/reviews/d84c10c65213cd9768ee93487b344728961eac690d7ec931bd92b5b866664700.json`，`deepReview.status=self_play_resolved`，`performedBy=self-play`。
- 机械对账：`node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` → `OK`。

### 记忆沉淀

| 通道 | 结果 | 取证 |
|---|---|---|
| 内置记忆（DSH 会话档） | 由 harness 自动落盘，本会话不可写外部 API；未手工伪造 | 本记录 + `.agent_context/expected-branch` 可回溯 |
| 外部记忆（gstack JSONL） | 追加 4 条 | `~/.gstack/projects/multi-publish/learnings.jsonl` 404 行、逐行 `JSON.parse` 0 坏行 |
| 外部记忆（仓库文档） | 本执行记录 + PRD + 设计规范 + `openspec/changes/ui-consistency-polish/` | 本文件与关联文档 |
| EverOS | `everos_add` → `add=accumulated, flush=extracted`（session=`mcp-20261026-multi-publish`, project=multi-publish） | 添加回执；检索接口随后返回 503（服务瞬时不可用），未把失败读成「没有记忆」 |

### 已知限制（不假装已闭合）

- `page-scaffold.contract.test.js` 只锁类名、导入顺序、无硬编码色与视图引用；它**不渲染浏览器**，像素回归仍以 `run-pixel-tests.js` 的 40 张（浅+暗各 20）为准。
- 五页之外的页面未纳入本次改造；`EmptyState` 的 `scaffold` 变体只对五页启用，默认观感未变，全量像素 40/40 证明已登记基线无回归；未登记基线的页面（如会员中心弹窗内空态）未逐张人工比对。
- 播客页频道/单集表单的校验规则全部沿用 `packages/shared-utils/src/podcast-rss.js`，本次未改任何校验码与文案；PRD 中列出的限制是**现状说明**，不是新规则。
- 暗色截图通过脚本强制 `data-theme="dark"` 验证 token；当前主题 composable 未接入应用壳层（既有状态，不在本次范围）。
- 视觉基线：`podcast-channel`（浅/暗）按新 UI 重建；另因左侧菜单「播客 RSS 频道」→「播客」会出现在**所有含侧边栏的截图**里，按 CI 渲染同步了 16 张既有基线（calendar / cloud-publish / collection-dark / create-history-dark / create-pipeline-dark / create-result-dark / intelligence / keyword-monitor / model-providers / viral-analysis 的浅/暗对应项），逐张与 CI 产物比对 0 px。其余四页在 `base-screenshots` 中没有独立基线，新增截图仅作本次人工验收证据，不入库。

## CHANGELOG 条目

# feat(ui): 五页视觉统一与播客菜单/标题改名（草稿/博主监控/文案库/知识库/播客 RSS，ui-consistency-polish）

- 新增页面骨架层（5 个 token-only CSS 文件）：统一页头、24px 标题、16px 圆角面板、列表行、按钮、分段筛选、搜索、表单、徽标、提示条与表格。
- 草稿页抽出 `PublishDraftsPage.vue`：统一页头/面板/空态，行内保留「去发布」「删除」，`Publish.vue` 净减 78 行。
- 博主监控 tab 补上内容留白；关注列表/发现列表改为面板 + 行 + 语义徽标，空态提供「添加博主」。
- 文案库改为胶囊筛选 + 胶囊搜索 + 统一卡片网格，空态提供「去采集」。
- 知识库移除 scoped 页头/红色主按钮覆盖，恢复品牌紫；页签、表格、分页、积压提示统一。
- 播客 RSS 页五个区块统一为面板；托管卡、频道表单、单集列表、发布自检、分发指引接入同一套控件；页面副标题精简为一句。
- 左侧菜单「播客 RSS 频道」更名为「播客」，页面标题改为「播客 RSS」；菜单 key 与运营中心配置不变。
- 新增页面骨架契约测试与草稿页组件测试；全量浅/暗像素门禁 20/20 通过。

## learnings

### lesson: 「视觉不统一」要先归因到骨架缺失，不要逐页调 CSS

五页各自加 `padding: 24px`、各自定义 4~10px 圆角，单页看都能接受，放在一起才显得粗糙。根因不是「这五页 CSS 写得不好」，而是**没有页面骨架层**：没有统一的页头、内容列、最大宽度、面板和行。先补一层 `mp-*` 骨架，再把页面挂上去，比逐页微调更快收敛，也更容易用契约测试钉住。

### lesson: 页面级 scoped 样式是全局设计系统的「静默覆盖层」

知识库主按钮显示为红色，不是按钮组件写错，而是 `KnowledgeBasePage.vue` 的 scoped `.cohere-btn-primary { background: var(--coral) }` 覆盖了全局品牌紫。scoped 只保证「不影响别人」，**不保证「不被页面自己改坏」**。页面级样式应只写页面独有排列，颜色/字号/圆角一律回到 token 与骨架层；契约测试里专门加了「目标页不得再含 `<style scoped>`」这一条。

### lesson: 把草稿页抽出组件同时解决两个问题

`Publish.vue` 已被 max-lines 点名（target 1775），草稿页改造若原地加样式会直接顶红。抽出 `PublishDraftsPage.vue` 后：① 草稿页拿到独立骨架；② `Publish.vue` 净减 78 行；③ 事件契约（open/delete/back）可以用 8 条组件测试直接锁住，不再需要 mount 整个发布页。

### lesson: 双主按钮是「高级感」的最大破坏项

播客托管卡里「保存托管配置」和「发布本期 Feed」原先都是实心主按钮，同屏两个同等权重的 CTA，用户无法判断下一步。收敛规则：**一个面板最多一个实心主按钮**，其余用描边次按钮；危险操作只给文字色，不填色。视觉层不是「加装饰」，而是把动作优先级重新排清楚。

### lesson: 视觉改动的证据要分层，不能只交截图

本次用四层证据：① 源码契约（类名/导入顺序/无硬编码色/五页引用）；② 组件测试（405 条）；③ 全量像素 20+20；④ 逐页截图（有数据/空态/暗色）。只有截图时，无法证明「不是只改了这两张图」；只有单测时，无法证明「看起来对」。四层缺一，验收结论都会出现过拟合。
