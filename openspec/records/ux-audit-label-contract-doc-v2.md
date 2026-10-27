---
change: ux-audit-label-contract-doc-v2
branch: ux-audit-label-contract-doc-v2
date: 2026-10-27
type: 纯文档变更（docs-only 快速通道）
---

# 执行记录：标签关联合同 PRD 补录「二次复测 + 测试宿主假造转发」（ux-audit-label-contract-doc-v2）

| 项 | 值 |
| --- | --- |
| 变更类型 | 纯文档（`01-docs/PRD-LABEL-ASSOCIATION-CONTRACT-2026-10-27.md`），走 docs-only 快速通道 |
| 判定 | docs-only=true（在 commit 之后取证） |
| 远程同步 | 由门禁推导 |

- 保留门禁：变更类型与隔离声明 ✅（docs-only，就地编辑 + PR 落地） | 判定 ✅（docs-only=true） | 行尾对账 ✅（`--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径同为 39/0 + 77/0） | 品牌残留 ✅（`check-no-brand-residue.js` PASS，扫描 13334 个 tracked 文件） | 文档同步 ✅（只改 PRD 与新建本篇记录，无搬运型文档门禁命中面） | 远程同步 PR #4530

## 一、为什么开这一篇（不是"补点注释"，是补两条会让下一个会话判错的现场）

PR #4524 合并后，`01-docs/PRD-LABEL-ASSOCIATION-CONTRACT-2026-10-27.md` 是标签关联的唯一基线文档。
在按它施工 `PublishFrequencySettings.vue`（PR #4529）时，动手前的复测产出两类**新事实**，
原 PRD 里没有、且缺了会把后来者带偏：

1. **EP 的 props 声明与实际转发相反**。`element-plus/es/components/input/src/input.mjs` 里 `id` 是声明过的 prop，
   注释原文 `@description native input id`；而实测四档（模板静态 `id=`、`:model-value` + `id=`、
   `mount(ElInput,{attrs:{id}})`、`mount(ElInput,{props:{id}})`）后**没有任何元素带该 id**
   （`document.querySelectorAll('[id=…]')` 命中 0）。
   只读类型声明会得出"`for`+`id` 可用"的相反结论 —— 这正是 PRD §3 判据纪律要禁的那类外推，
   而这次反例的诱惑力在于**证据长得像官方的**（库自己写的注释）。
2. **测试宿主本身会假造转发**。`apps/desktop/test-setup.js` 的全局 stub
   `'el-input': { template: '<input class="el-input" />' }` 把任何属性（含真体丢弃的 `id`）透传给原生 `<input>`，
   于是「给 `el-input` 写 `for`+`id`」这种在生产里规范级无效的接线，用该 stub 做挂载断言**会照样通过**。
   这是「装饰性门禁」的新落点：**夹具形状对、语义不对**。

## 二、PRD 改了什么

新增两节，**不改** §3 资格表的任何读数（资格表历来取真组件，未被全局 stub 污染）：

- **§3.1 二次复测**：四档写法 × 三列读数（内层 `id` / 内层 `aria-labelledby` / 全文件 id 命中数）成表；
  并写死两条配套现场 —— `ElInputNumber` 的确切抛错串
  （`Cannot read properties of undefined (reading 'setAttribute')`，写死是为了让下次复测能区分
  "还是同一个障碍"与"EP 修了、探针写法变了"）、以及 `data-testid` 会转发而 `id` 不会
  （禁止由"邻近属性在测试里查得到"推断"`for` 在生产里成立"）。
- **§3.2 测试宿主会假造转发**：两条硬约束 ——
  ① 凡挂载级断言要度量宿主转发面，必须显式覆盖全局 stub（`global.stubs = { 'el-input': ElInput }`）；
  ② **必须带正控**（断言渲染出的确是真 EP 结构，本项目取 `.el-input__inner`；等价取法
  `root.classList.contains('el-input') && root.tagName === 'DIV'`，因为全局 stub 的根就是 `<input>`）。
  并写明没有正控的后果：将来有人把 stub 换回全局那份，测试仍然全绿 —— 那就是"锁还在、已经不测东西"。
  末句显式划定本节边界（不改动资格表），避免被读成"资格表也可能被 stub 污染过"。

## 三、取证（docs-only 保留门禁）

- 行尾对账、品牌残留、`classify-docs-only` 读数在下方保留门禁行回填；新增文案不含竞品品牌名，
  引用 EP 时写的是库自身文件路径与实测读数，不含本机绝对路径（`element-plus/es/...`、`apps/desktop/test-setup.js`
  都是仓内/依赖内相对路径，不触发 Gate 12c）。
- 交叉引用只指**本仓实际存在的文件与 PR**：`PublishFrequencySettings.label-association.test.js`（#4529 新增）、
  `apps/desktop/src/element-plus-label-attr-forwarding.test.js`（#4522 已登记）、PRD §3 / §7 小节号。
  不写"参见某未合并文档的某节"这类会随归档漂移的锚点。

## 四、不在本批范围（不得读成已完成）

1. `test-setup.js` 的全局 `el-input` stub 本身**没有改** —— 它服务大量既有测试，改它（例如让 stub 丢掉 `id`
   以贴近真宿主）属"改测试基础设施"，需要单独一批并跑全量桌面测试；本批只把"必须覆盖 + 必须带正控"写成合同。
2. `ElInputNumber` 在真实浏览器（dev server + CDP）上的转发面仍未取证；PRD §3 那一档继续写"未测得"。
3. 存量孤岛读数仍按 PRD §6 的规矩「引用时现跑」，本批不往文档里钉一个新快照。

## CHANGELOG 条目

# 标签关联合同 PRD 补录：EP 的 id 声明与实际转发相反、测试全局 stub 会假造转发

按该合同施工时发现两条会让后来者判错的事实，补进 PRD §3.1/§3.2。其一：Element Plus 2.14.2 把 `id` 声明为
prop（注释原文 `native input id`），但四种挂载写法实测后**没有任何元素带上该 id**，而 `aria-labelledby` 与
`data-testid` 会转发到内层 `<input>` —— 只读类型声明会得出"`for`+`id` 可用"的相反结论。其二：仓内测试全局
stub `'el-input': { template: '<input class="el-input" />' }` 把真体丢弃的 `id` 原样透传，于是生产里规范级无效的
`for`+`id` 接线在挂载测试中会照样通过；PRD 因此新写两条硬约束——挂载级关联断言必须显式覆盖为真组件，
并带一条"必须看到真 EP 结构"的正控，否则将来 stub 换回全局那份时锁还在、已不测任何东西。
另写死 `ElInputNumber` 在 jsdom 下 mount 的确切抛错串，使下次复测能区分"障碍依旧"与"EP 已修"。
