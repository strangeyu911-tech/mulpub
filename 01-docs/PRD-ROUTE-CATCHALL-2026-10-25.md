# PRD：未知路由兜底页（阶段 1.9，ux-audit-route-catchall）

- 关联审计：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1「接线批次」1.9；O2「把已经建好的功能接上电」
- 执行记录：`openspec/records/ux-audit-route-catchall.md`
- 日期：2026-10-25
- 范围：渲染层（`apps/desktop/src`）。不动主进程、不动 IPC、不动数据库、不动 `.github/workflows/`

## 1. 问题定义

### 1.1 现场行为

`apps/desktop/src/router/index.js` 的 `routes` 数组没有 catch-all（取证：`grep -na pathMatch` = 0 命中）。
vue-router 在"无任何匹配"时不渲染 route component，而应用外壳（侧边栏 / 标签栏 / 顶栏 / 状态栏）照常渲染。
于是未登记路径的用户可见结果是：**一段空白内容区 + 一切看起来正常的chrome**。

### 1.2 为什么这是体验缺陷而不是技术洁癖

| 触发来源 | 现实案例 | 用户当时的心智 |
|---|---|---|
| 运营中心深链 | 后台下发的菜单/公告里带了尚未发布或已改名的路径 | "功能坏了"／"后台在骗我" |
| 带参路由被去掉参数 | `/board/:projectId` 存在，但 `/board` 无匹配（用户手动改地址栏回退一级） | "这个页面空了，是不是项目被删了" |
| 旧窗口/收藏残留 | 迭代中改名或下线过的路由，地址仍留在用户的浏览器式历史里 | "昨天还在的" |

三条共同点：**系统知道自己不认识这个地址，但没有把这句话告诉用户**。
这违反 Nielsen #1（系统状态可见性）与 #9（错误识别、诊断与恢复）—— 而且这里连"识别"都没发生。

### 1.3 与既有机制的关系（不重复造）

- 本仓的 `route-registry`（CI 规则 1–5）保证"每条路由都在册"，但它**不保证"每条可能的输入都有归宿"**。
  二者合起来仍允许空白页存在：空白页不是一条路由，所以没有任何一条规则会去问它。本批补的正是这一格。
- 离线横幅（阶段 1.7）、账号加载失败可见（#4403）与本条同属"故障必须可见"家族，判据不同层：
  那两条管网络/数据，本条管**导航目的地**。

## 2. 目标与非目标

**目标**
1. 任何未登记路径都落到一个有名字、有内容、有出口的页面（`NotFound`）。
2. 用户在该页能：看清自己想去哪儿、一步回到首页、（能返回时）一步返回上一页。
3. 兜底位置与在册性由机械锁守住，不靠注释提醒。

**非目标（明确不做，防"顺手扩面"）**
- 不做埋点统计"哪些地址被 miss"（属阶段 5.6 导航行为度量，需先有埋点通道）。
- 不改侧边栏/标签页对"未知路由是否建标签"的既有策略（本批只保证内容区有归宿）。
- 不做 i18n 之外的多语言、不做主题外的视觉重设计。
- 不把 NotFound 注册为像素基线视图：它的内容随 `fullPath` 变化，天然不可复现，
  进像素判定域会引入需要钉时钟的动态值（本仓「KNOWN_DYNAMIC 必须为空」的既有约束）。

## 3. 功能规格

### 3.1 数据与校验

| 项 | 口径 | 理由 |
|---|---|---|
| 回显内容 | `route.fullPath`（含 path + query + hash） | 用户要核对的就是这几个字符；只显 path 会把 `?tab=x` 这类关键信息藏掉 |
| 取值安全 | `route && typeof route.fullPath === 'string' ? route.fullPath : ''` | 宿主对象在读不到时不得产出 `undefined` 文本；缺席一律按空串渲染 |
| **不截断** | 原样输出，宽度由 CSS 折行承载（`overflow-wrap: anywhere; word-break: break-all`） | 两条理由：① 截断对"核对地址"是净损失；② 本仓展示口径正在收敛到 Unicode 码点（PR #4424），兜底页不该自带第五份截断实现 |
| 返回能力判定 | `state.back` **且** `router.resolve(back).name !== 'NotFound'`（评审 i1：连访两个错地址时 back 指向的也是 404，那不是出口；resolve 抛错按 false），并把 `route.fullPath` 挂成 computed 依赖 | `history.state` 是普通对象、**不响应式**：不挂依赖时该值在挂载那一刻被冻结，之后用户再怎么前进/后退，按钮的有无都停在首帧读数 |
| 回首页动作 | `router.replace('/')` | push 会把兜底页写进历史；用户每前进一次都要多点一次"返回"，且深链场景会累积一串空白页 |
| 返回动作 | `router.go(-1)` | 与"上一页"语义一致；仅在判定为可返回时渲染该按钮 |

### 3.2 交互流程

```
用户到达未登记路径
   → 外壳正常渲染（侧栏/标签/顶栏不变，保持"我还在应用里"的定位感）
   → 内容区渲染 NotFound：
        标题「页面不存在」
        成因说明（链接写错 / 功能已下线 / 旧窗口带来的地址）
        「你想访问的地址」+ 原样路径（可折行、可选中复制）
        [回到首页]（主）        [返回上一页]（仅可返回时出现）
        提示：左侧菜单入口（不复述键位，键位真源在 electron/services/hotkeys.js）
   → 点[回到首页] → replace('/')，兜底页不留在历史里
   → 点[返回上一页] → go(-1)
```

焦点与键盘：出口是原生 `<button type="button">`，Tab 一屏内可达、Enter/Space 天然生效；
按钮复用既有 `cohere-btn-primary` / `cohere-btn-secondary` 变体类，因此自动落在阶段 3.6
已锁定 `:focus-visible` 焦点环的判定域内（新增自定义按钮类会被那条合同漏掉，这是刻意避免的）。
**不做 autofocus**：兜底页不是模态，抢焦点会打断读屏对标题的朗读（WCAG 2.4.3 焦点顺序）。

### 3.3 显示项与提示文字（zh / en 成对，键在 `src/locales/not-found/`）

| key | zh | 用途 |
|---|---|---|
| `notFound.title` | 页面不存在 | h1，整页唯一标题 |
| `notFound.description` | 这个地址在本应用里没有对应的页面。可能是链接写错、功能已下线，或从旧窗口带过来的地址。 | 一句成因，给用户"不是我的错"的定位 |
| `notFound.pathLabel` | 你想访问的地址 | 路径回显的标签 |
| `notFound.actionHome` | 回到首页 | 主出口 |
| `notFound.actionBack` | 返回上一页 | 次出口（条件渲染） |
| `notFound.hint` | 也可以用左侧菜单直接进入账号、发布、创作等页面；找回这些入口比修地址更快。 | 出口之外的第二条路。**不得写键位**（评审 i4：真源是 `electron/services/hotkeys.js` 的 `CmdOrCtrl+Alt+字母`，数字档不存在；抄进文案即第二份事实，由 `NotFound.test.js` 的键位禁令锁守） |

en 侧同结构（见 `src/locales/not-found/en.js`）。模板内**零中文字面量**，由
`check-locale-sync.js --cjk` 与本文件自带的模板扫描共同守（现场：`CJK scan PASS（基线 1330 条，当前 1095 条，无新增硬编码）`）。

### 3.4 无障碍判定

- 唯一 `h1`；文案走 locale，读屏得到的是本地化文本而不是 i18n key；
- 无 `aria-live` / `role="status"` / `role="alert"`：整页就是这一次的呈现，再加 live region 会重复播报；
- 路径回显用 `<code>` 包裹并在段落里，读屏按普通文本朗读，不做成语义地标。

## 4. 验收标准

- AC1 `router.resolve('/nope')` 等未登记路径得到 `name === 'NotFound'` 且 `matched.length > 0`。
- AC2 既有路由（含 `/board/:projectId`、`/publish/history`、redirect 项）解析结果不因本批改变。
- AC3 `NotFound` 在 `route-registry` 在册：`internal: true`、`navEntry: null`、`view: 'NotFound.vue'`、
  `path` 与 router 逐字一致、`entryFrom` 指向表内已登记路径（CI 规则 1/2/4/5 全项）。
- AC4 catch-all 位于 `router.options.routes` **末位**（位置错误必须变红）。
- AC5 页面显示 `fullPath` 原文；路径再长也不截断，且不产生孤立代理项。
- AC6 无上一条历史时**不渲染**返回按钮；有时点击得到 `go(-1)`；回首页得到 `replace('/')` 且 `push` 未被调用。
- AC7 文案 zh/en 成对；模板无中文字面量；不新增像素注册表项。
- AC8 回归锁两套 + 变异驱动逐刀 CAUGHT；`build:vue` rc=0；消费者并集全跑绿。

## 5. 风险与回滚

- 风险 1（**已按变异实测更正**）：本 PR 初稿写"catch-all 若被挪到具体路由之前会整片接管 `/board/:projectId`"，
  机制不对 —— vue-router 4 按 **rank**（静态 > 参数 > 通配）排序后匹配，与声明顺序无关。驱动 K2 把通配挪到首位时
  `/publish` 仍解析到 `Publish`，只有位置约定锁红。因此：真正防"吞掉既有路由"的是 AC2（逐条真实路由解析对照），
  AC4 降级为**可读性/可维护性约定**（不称自己是防线），路由表注释与测试文件头同步改写。
  这条留在这里的意义：错的是"顺手写下的机制解释"，被自己的反证抓到，而不是被评审抓到。
- 风险 2：新增"暗页"若没登记进 registry，会成为一个能渲染但不在册的页面（本仓「装饰性链路」同型）。
  → 由 AC3 与 CI 的 `check-route-registry.js` 双重守。
- 风险 3：`history.state.back` 是宿主语义，单测里用替身读写字段。真机上若某 Electron 版本
  对 hash history 的 state 处理不同，最坏退化是"返回按钮不出现"，主出口仍在，不构成功能阻断。
- 回滚：删 router 末行 + registry 一条 + locales 一个分区目录 + 一个视图文件 + 两套测试 + 一个驱动，互不牵连。
