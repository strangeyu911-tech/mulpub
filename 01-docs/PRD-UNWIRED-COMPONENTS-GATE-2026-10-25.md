# PRD — 未接线组件门禁（阶段 5.3）

- 变更名：`ux-audit-unwired-components`
- 日期：2026-10-25
- 关联：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 5.3、AGENTS.md「装饰性链路」家族、「测试文件必须显式接进 CI」
- 类型：新增质量门禁（`scripts/` 工具脚本 + CI 接线），**不改任何运行时代码**

---

## 一、背景与问题陈述

### 1.1 这不是抽象洁癖，是审计 1.1 的实测形状

UX 审计阶段 1 的接线盘点给出一个统计事实：**71 条体验问题里有 11 条属同一形状**（涉及 13 个未接线对象）。共同结构是：

> 组件 / composable / 样式分支**已经实现、已经测试、已经合并**，但没有任何生产代码把它接到用户面前。

最贵的一条是暗色主题：`apps/desktop/src/composables/useTheme.js` 早已实现（persist 到 electron store、跟随 `prefers-color-scheme`、写 `documentElement` 的 `data-theme`），实测全仓 `git grep` **只命中它自己与它的测试** ⇒ 已完成的全仓 72-77 处 `[data-theme=dark]` 暗色分支、以及「深色低对比 61→0」那一整轮整改成果，在用户侧**永远不可达**。花了成本、拿到了绿灯、交付了零。

这与本仓 AGENTS.md 反复记录的「装饰性链路」是同一个缺陷，只是发生在 UI 层：既有门禁全部在问「这段代码被执行时对不对」，没有任何东西在问「这段代码有没有被执行」。

### 1.2 为什么四层既有门禁都没看见

| 层 | 为什么漏 |
| --- | --- |
| 单元测试 | 组件自己的测试**只 import 被测组件**，从不问"有没有生产调用方"。`PipelineBrowser.vue` 自带 12 条测试，看起来非常"在用"。 |
| 集成 / E2E | 只覆盖已接线路径；未接线的组件根本不在路由表里，E2E 域对它结构性免疫。 |
| 视觉回归 | 基线目录只含"已注册视图"；未接线组件没有视图入口 ⇒ 不进注册表 ⇒ 不进判定域。 |
| 代码审查 | 审查看 diff，"缺失的一个调用点"不在任何 diff 里。 |

**结论**：这个缺陷类无法被"跑得更多"发现，只能被一条**按名字清点整个组件目录**的新判据发现。

---

## 二、目标与非目标

**目标**

- G1：把「`apps/desktop/src/components/` 下每个 `.vue` 是否被生产源码引用」变成机器判据，逐 PR 执行，未登记即红。
- G2：存量欠账必须**带理由**登记后才能放行；登记 = 承认欠账，不是豁免。清单只能缩小。
- G3：判据本身不得成为装饰 —— 七道变异反证必须**每次 PR 真跑**并逐刀变红。

**非目标（明确排除，避免 scope creep）**

- N1：**不**删除任何未接线组件。是否接线是产品裁决项（门禁单方面删组件会把"用户看不到"改成"代码消失"，丢的是可发现性）。
- N2：**不**覆盖 `composables/`、`stores/`、`electron/services/`。本批域收敛到组件目录，先把一个面做扎实；composable 面因出口形态更多（解构、`storeToRefs`）需另立切片。
- N3：不判"接线得对不对"（接到错误路由上、被 `v-if="false"` 钉死）—— 那是运行态问题，静态判据做不到，不得声称做得到。

---

## 三、判据设计

### 3.1 扫描域 = git，不是磁盘

复用 `scripts/lib/git-domain.js`：域 = 被跟踪文件 ∪ 未被 `.gitignore` 排除的未跟踪文件（即 `git status` 口径，也正是 CI 检出口径）。

为什么不能用磁盘遍历：`#3876`/`#3900` 的实测事故是「别的会话留在共享根里的构建产物 / `.adversarial/` 被当成仓库内容」⇒ 本机红、CI 看不见，两个域比一份账。

### 3.2 判定域与消费者域

- **判定域**：`apps/desktop/src/components/**/*.vue`，排除 `.test.` / `.spec.` / `__tests__/` / `.visual.` / `.contract.` / `tests/`。
- **消费者域**：`apps/desktop/src/`、`apps/desktop/electron/`、`apps/desktop/packages/` 下的 `.vue/.js/.cjs/.mjs/.ts` 源文件，同样排除测试形态。当前实测量级：`domain≈12.7k`、`components=87`、`consumers≈1257`。
- **自我引用不算已接线**：消费者遍历必须跳过组件自己的路径，否则"组件 import 自己"即永久自证清白。

### 3.3 「已接线」的四种形态（取宽松侧）

只要组件名在任何非测试源文件里以下列形态之一出现，即判已接线：

| # | 形态 | 例 |
| --- | --- | --- |
| 1 | import 路径 | `import Foo from '@/components/Foo.vue'` |
| 2 | 模板 Pascal 标签 | `<Foo :x="1" />` |
| 3 | 模板 kebab 标签 | `<ui-button />`（`kebab()` 按大小写边界切） |
| 4 | 注册字符串 | `app.component('GlobalSpinner', …)` |

**为什么判"已接线"取宽松、判"未接线"取保守**：这条判据是 required 链路的一部分，假红会把整条合并队列钉住（本仓实测过 main 连续 530 次红卡住全部 open PR 的后果）。宁可漏登记一笔债，也不给无关 PR 造假红。代价如实写出：注释里提到某组件名**会**被判成已接线 ⇒ 本门禁的假阴性面包含"注释型引用"，这是刻意选择，不是遗漏。

### 3.4 三种结论与退出码

| 结论 | 含义 | 后果 |
| --- | --- | --- |
| `UNWIRED` | 未接线**且未登记** | `rc=1` 阻断 |
| `STALE_BASELINE` | 登记项现在已接线（或路径不存在） | `rc=1` 阻断 —— 销账与改动必须同一次发生 |
| `PASS` | 每个组件要么有引用、要么带理由登记 | `rc=0` |
| 判据自身故障（空域 / git 取不到读数 / JSON 形状错） | 无法出结论 | `rc=2`，**不得读成通过** |

`assertDomainHealthy(domainSize, candidates, consumers)` 把两类失明分开：`candidates === 0` 抛（扫描域塌成空集时"零违规"读起来跟通过一模一样）、`consumers < 100` 抛（前缀指错目录时的现场）。它是**导出的纯函数**而不是 `main()` 里两行 if —— 结构锁只查文案存在，对"守卫还在注释里、条件已被改成恒假"完全免疫，这是本仓装饰性门禁的第四种落点。

### 3.5 基线文件契约

`scripts/unwired-components-baseline.json`：`{ version, note, entries: [{ path, reason }] }`。

- `reason` 必须非空且有实质内容（`loadBaseline` 逐条抛错），空手登记不算放行。
- 规模上界由测试钉住（`entries.length <= 12`），**只能缩小**；为容忍自己新增而调大 = 把判据变成摆设。
- 该文件目前不在 `CI_IGNORED_PATHS` 白名单内；即便如此判据仍接在**不被 docs-only 短路的 `changes` 作业**，理由是 AGENTS「进白名单的前提锁」：一个门禁的数据文件一旦哪天进白名单，接在 static-gates 等于给它自己关掉校验。

---

## 四、首次实跑读数（本门禁的真实产出）

```
[UNWIRED-COMPONENTS] domain=12671 components=87 consumers=1257 未接线=3 未登记=0 陈旧登记=0 基线=3
```

三条存量：

| 组件 | 状态 | 处置 |
| --- | --- | --- |
| `AnnouncementBanner.vue` | 审计 1.2 已知；接线工作在 PR #4213 | 登记，合并后同次删除 |
| `StaggeredList.vue` | 审计 66；零引用**且自身有错**（`items` 缺 key 时 `TransitionGroup` 复用节点错位） | 登记，先修契约假设再谈接线 |
| `PipelineBrowser.vue` | **本门禁新发现的第 4 例同型对象**（审计 13 个未接线对象里只列了 3 个组件） | 登记为产品裁决项 |

`PipelineBrowser.vue` 是这条门禁立项理由的最强单点证据：它自带 12 条测试，另有一个 `e2e-smoke.js` 的**文件存在性**检查，两者都让它长期看起来"在用"；但没有任何视图 import 它 ⇒ 用户永远看不到。单靠"多写测试"永远不会发现它。

---

## 五、CI 接线

落点：`.github/workflows/quality-gate.yml` 的 `changes` 作业，`Gate 2b15 - Unwired components gate (changes job)`，`shell: bash`（fail-fast，任一非零即中止）。

```
node scripts/check-unwired-components.js        # 对真仓给结论，1.5s
node --test scripts/check-unwired-components.test.js   # 13 条行为/接线锁，≈3s
node scripts/unwired-components-mutate.js       # 七刀反证真跑，≈17s
```

整步本机实测 **22s**。反证驱动**直接进每次 PR**，不复用"反证只手动跑"的既有惯例：那三个 `contract-mutate` 驱动留在手动档的理由是数百秒量级，秒级却留手动等于没有反证（下一次改判据时无任何东西会发现锁被改坏）。

编号 2b15：2b2–2b14 已被占，同号会撞名。

---

## 六、反证（七刀，全部实跑且红在指名的那条锁上）

| 刀 | 被禁形态 | 预期 |
| --- | --- | --- |
| M1 | `isWired` 退回恒 `true`（对所有输入返回同一份数据的假探针） | 判据 `rc=1` 且点名 `STALE_BASELINE` |
| M2 | 摘掉自我引用跳过 | 「自我引用不得算成已接线」红 |
| M3 | 空域守卫条件改成 `false &&`（文案还在、行为消失） | `assertDomainHealthy` 行为锁红 |
| M4 | 把一条登记改指到**已接线**组件 | 判据 `rc=1` 且点名 `STALE_BASELINE` |
| M5 | 从 workflow 摘掉判据本体（注册≠注入≠生效） | 「接线锁」红 |
| M6 | `unregistered` 恒空（未登记欠账不再阻断） | `judge` 用例红 |
| M7 | `CONSUMER_PREFIXES` 指到不存在目录（扫描域塌空却照报结论） | 「消费者域规模下界」红 |

现场读数：`CAUGHT=7/7`，且驱动**逐刀 md5 核对还原**（变异中途被打断会把源文件留在变异态，这是本仓踩过的电池事故）。

---

## 七、验收标准

- AC1 `node scripts/check-unwired-components.js` 在本 worktree 返回 `rc=0`，首行含 `domain= components= consumers=`。
- AC2 `node --test scripts/check-unwired-components.test.js` 13 条全过。
- AC3 `node scripts/unwired-components-mutate.js` 输出 `CAUGHT=7/7`，`rc=0`。
- AC4 Gate 2b15 三条命令都在**同一个步骤块**内（由接线锁断言），`.gitignore` 反选两条都在位（由反锁断言）。
- AC5 `check-unwired-tests.js` / `check-step-failfast.js` / `check-workflow-structure.js` / `check-no-brand-residue.js` 全部 `rc=0`。
- AC6 远程：PR CI 的 `QG Changes` 绿，合入后 main push 绿。

---

## 八、显示项 / 提示文字 / 交互（本批无 UI 变更，如实记录）

本批**不改**任何用户可见界面，因此：不新增 locale 键（AGENTS 禁止为不可达的反馈路径建死键）、不动视觉基线、不影响 `test:visual:pixel` 判定域。判据的现场输出即"显示项"，三条形态逐字为：

- `UNWIRED <路径>（既无引用也不在基线里 ⇒ 要么接线、要么带理由登记）`
- `STALE_BASELINE <路径>（已接线，必须同次从基线删除）`
- `PASS：components 域内每个 .vue 要么有引用，要么带理由登记（且登记项现在仍未接线）。`

红文案给的是**解法**而不是症状（接线 / 带理由登记 / 同次销账），因为这条门禁面向的是下一个改 UI 的会话，不是终端用户。

---

## 九、残余风险（不假装已闭合）

1. **宽松侧判据的假阴性**：注释型引用、字符串巧合都会被判"已接线"。它挡得住"完全没人提过它"，挡不住"提过但没真用"。
2. **域只覆盖组件目录**：`composables/`、`stores/`、`electron/services/` 同型缺陷不在本判据视野内（N2）。`useTheme` 那一条已在本切片之前的 PR 里靠人工接线修掉，不是被这条门禁抓到的。
3. **"接线到死代码"不可见**：接进一个永不渲染的分支仍判通过（N3）。
4. 基线三条中 `AnnouncementBanner` 的销账依赖 #4213 先合并；若 #4213 被放弃，这条登记会长期占位并被下一次审计重新裁决。
