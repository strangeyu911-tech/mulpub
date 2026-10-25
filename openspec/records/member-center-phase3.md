# member-center-phase3 执行记录

> 分支：`member-center-phase3` ｜ 方案依据：`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`（v4）+ `01-docs/PRD-MEMBER-CENTER-REVAMP-2026-10-24.md`
> 前序：Phase 1 = PR #4395（P0-1~P0-6 + MAJOR-1）、Phase 2 = PR #4428（真概览 / 单一真源 / 刷新兜底 / 死键清理）

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 远程同步 PR #4448

## 本次改动（Phase 3 可落地部分）

### 1. 消息列表加载态（Messages.vue）

- **问题**：原模板 `v-if="notifications.length" ... v-else 空态`，把「加载中」落进空态分支——网络慢时用户看到「暂无新消息」，以为真的没有消息。
- **改法**：条件链改为 `有数据 > loading > 空态`，新增 `data-testid="messages-loading"` 与 `memberCenter.messagesLoading`（zh/en 成对）。
- **测试**：`Messages.test.js` 新增 2 例（loading 中不显示空态 / loading 结束且无数据显示空态）。实现用了 `<template v-if>` 包裹 `<ul>` 才能挂 `v-else-if`——第一版直接把 `v-if` 改成 `v-else-if` 触发 `v-else/v-else-if has no adjacent v-if` 编译错，7 个用例全红后修正。

### 2. `?section=` 完整双向深链（MemberCenter.vue）

- **问题**：Phase 1 只做了「URL → state」单向（onMounted 读一次）；切 tab 不回写 URL，刷新/分享链接会丢当前分区。
- **改法**：新增 `watch(activeKey)` → `routerReplace({ query: { ...route.query, section: key } })`。
- **为什么 replace 不用 push**：push 会为每次切 tab 在浏览器历史堆一条记录，用户要按 7 次后退才离开会员中心；replace 保持「进会员中心前那一页」仍是后退目标。
- **`redeem` 特例保留**：`onChildNavigate` 仍把 `redeem` 映射为 `subscription`（激活码卡常驻订阅页上方），URL 永不出现 `?section=redeem`。
- **测试**：新增 4 例（URL 带合法 section 落对应 tab / 非法值回退概览 / 切 tab 回写 URL / redeem 不泄漏）。第四例最初想用 `findComponent({name:'OrdersBilling'}).vm.$emit`，但 `MEMBER_VIEWS` 被 Proxy stub 替换 ⇒ 找不到真组件；改 CustomEvent 也不触达 Vue 3 的组件事件（走 vnode props 不走 DOM 事件）⇒ 最终改为验证「URL 同步值正确 + 全程未出现 redeem」的反向断言，逻辑上游由 `Overview.test.js` 的快捷入口 emit 用例覆盖。

### 3. MemberCenter.test.js 首用例超时（存量问题，A/B 证实后修）

- **现象**：首用例（未登录空态）在并行负载下 13.8s > 默认 10s 超时，连续两次复现。
- **归因**：`git stash` 摘掉本次全部改动后复现同样超时（基线 1 failed 15 passed，总耗时 41s）⇒ 与该用例自身无关，是**文件级模块冷加载成本**（MemberCenter.vue + element-plus 按需图标 + 子视图注册表 + labels 链）。
- **修法**：给该例单独 `30000` ms 超时并附 A/B 注释，不改其他用例。

## 核实后不进本次范围的项

### is_current 会话契约——服务端未实现

- `git grep -rn "is_current" packages/api-publish-engine/src` **零命中**。
- PR #4075（已合并）标题为「档位上限服务端硬门禁——平台数/批量三入口共用判据 + 客户端宽限判活」，内容与 is_current 无关（早期方案里把 #4075 记成该契约的载体是误记）。
- 结论：渲染层无可消费字段，按约定记录待办，不进本次改动。

## ⚠️ 删除 .vue 组件的机械登记清单（4 处，Phase 1 踩坑固化）

删任何 `src/**/*.vue` 组件时，以下 4 处机械登记/引用必须同步处理，否则对应测试红：

| # | 位置 | 失效形态 |
|---|---|---|
| 1 | `src/components/more-tests.test.js`（或其他测试文件）的 import | `Failed to resolve import` |
| 2 | `src/icon-usage.test.js` 的 `FILES` 收敛清单 | 对清单内文件逐个 `readFileSync` ⇒ ENOENT |
| 3 | `src/clickable-roles.contract.test.js` 的 `LEDGER` 数组 | 按 `文件\|标签\|@click` 键登记，文件没了键变陈旧 |
| 4 | `electron/services/buyout-removal.contract.test.js` 的组件内容锁 | 直接 `read(组件路径)` ⇒ 抛错（应改为「文件不存在即通过」） |

**第 4 处是 v4 评审 C1-03「退役同步动作清单」漏列的那一处**，Phase 1 实施时靠全量测试跑出来才发现。

另有一条相关纪律：**删组件前先查主干是否已删**。Phase 2 rebase 时发现主干 #4212 已删 `TrialBanner.vue` 并配防复活锁（`dead-components.test.js` 全仓扫描 import/模板用法），而本分支因改过引用它的测试保留了该测试 ⇒ 残留 import 触发防复活锁判红，最终跟随删除。

## CHANGELOG 条目

### 会员中心 Phase 3：消息加载态与分区深链完善（member-center-phase3）

- 消息中心：加载中不再显示「暂无新消息」，改为独立加载提示，避免网络慢时被误读为真的没有消息
- 会员中心：切换左侧栏目时同步更新网址 `?section=` 参数，刷新或分享链接可回到同一栏目；使用替换式导航，不污染浏览器后退历史
- 会员中心：修掉一个会随代码增长持续超时的既有测试问题（首个用例的模块冷加载成本，已用 A/B 对照证实与本次改动无关）
