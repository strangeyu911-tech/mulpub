# 本次执行记录：表单标签关联合同 PRD 落地（ux-audit-label-contract-doc，2026-10-27）【docs-only】

- 分支：`ux-audit-label-contract-doc`（worktree：`<仓库父目录>/mp-worktrees/mp-ux-audit-label-contract-doc`，非 C 盘；建树后 `git rev-parse HEAD` == `origin/main`（`fff27c847`）才动手）
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（commit 后取证）→ 见下
- 产物：`01-docs/PRD-LABEL-ASSOCIATION-CONTRACT-2026-10-27.md`

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：docs-only 判定 ✅ | 行尾两口径一致 ✅ | 品牌残留 ✅ | 本机绝对路径 ✅ | 文档同步 ✅ | 记录债务 ✅ | 远程同步 由门禁推导

## 一、为什么现在写这份 PRD

审计 4.3 已连做三批（#4500 / #4501 / #4520）+ 一批前置取证（#4522），做法散在四条 PR 的执行记录与测试注释里，且其中两条**已被实测推翻**（"EP 控件走 aria-labelledby 通道"只对 `ElInput` 成立）。下一个会话若只读那些记录，会把作废的方案再执行一遍。这份 PRD 的作用是把**合同**收敛到一处：三条合法通道、每种组件的资格（实测）、id 取值规则、分层锁各证什么、存量清单、施工 SOP、验收标准、以及"哪些格子今天没有执行体"。

## 二、当场读数（活数，引用时现跑）

- 扫描域：`apps/desktop/src` 下 `.vue`，**206 个文件、读不到=0**；判据=既无 `for`/`:for`、不包裹 labelable 控件、且自身 `id` 未被同文件某控件的 `aria-labelledby` 指回。
- `origin/main@fff27c847` 存量 **162 处 / 30 文件**；大户：`S2vConfigPanels` 19、`Publish` 16、`CreateView` 13、`ModelProviders` 13、`WorkflowEditor` 12、`ViralFormDialog` 11、`AiWriterPanel` 10、`PublishFrequencySettings` 10。
- 与上一轮读数的差异**必须一起解释**：#4520 那批时域是 199 个 `.vue` / 137 处，本轮是 206 / 162。两条原因：① 三个在飞 PR（#4500/#4501/#4520，合计 −32）尚未合并，主干仍带那些孤岛；② 主干新落地了别人的文件，把 `WorkflowEditor.vue`(12)、`AutomationTaskDialog.vue`(6) 这类**新持有者**带进了域内。只报"162 > 137 变差了"是错的归因——域变了，且我的三批没并进去。

## 三、PRD 里刻意写进去的三条"负结论"

1. **没有第四条通道**。`el-switch` / `el-select` / `el-input-number` 写 `aria-labelledby` 不构成关联（属性停在根 `<div>`）。把它们当中性"控件"补属性会产出一批看着像修好、实际无效的接线。
2. **`ElInputNumber` 是"未测得"**，不是"不可用"。它 jsdom mount 即抛；要取证需真实浏览器 + CDP。把未知写成结论是本仓反复出过的错。
3. **覆盖面上界只能放静态清单层**。挂载用例到不了 `v-if`/对话框分支，用它的通过率度量覆盖面会把"夹具不可达"读成"接线失败"，反之把"夹具能到"读成"全仓合规"。

## 四、门禁缺口如实声明

`check-label-association.js` 全域棘轮尚未接进 CI（基线须由合并后的主干重取，且属"改谁来守门"需人工过目）。所以今天守这类回归的只有**每批自带的文件级锁**；跨文件的新增孤岛没有执行体。PRD §9 明写这一点，避免"有 PRD 就有门禁"的误读。

## 五、QM-6

纯文档变更，按 AGENTS.md 不强制双模型外部评审；未产生也不冒充评审产物。

## CHANGELOG 条目

# 新增《表单标签关联合同》PRD，把三批实现与一次被实测推翻的计划收敛成一处

设置页与表单里"标签和控件没关联"（孤岛 label）此前分四条 PR 处理，做法散在执行记录与测试注释里，其中"给 Element Plus 控件补 aria-labelledby"这条方案经 mount 实测被推翻——只有 ElInput 会把它转发到内层真实 input，ElSwitch/ElSelect 只停在根 div（挂在非 labelable 元素上等于没有可访问名），ElInputNumber 在 jsdom 下连 mount 都会抛、属"未测得"。这份 PRD 固定三条合法通道（for+id、包裹式、选项组 role=group+aria-labelledby）、每种组件的资格表、id 取值规则（禁止随机值、禁止撞 data-testid）、分层锁各证什么与各看不见什么、当场存量读数（162 处 / 206 个 vue 文件，含与上轮差异的归因）、施工 SOP 与验收标准，并明写全域孤岛棘轮尚未接进 CI 这一缺口。
