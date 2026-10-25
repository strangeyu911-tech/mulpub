# PRD — CreateView.vue 拆分方案复评与第一刀定案（2026-10-25）

> **本文是 `01-docs/FRONTEND-FILE-SPLIT-PLAN-2026-10.md`（仓内定案 v3/v4）的复评补充**，
> 不替代它。定案文档的 §2.1–§2.6 / §五 全部继续有效，本文只做两件事：
> ① **用 2026-10-25 的新数据复评 §2.9 的「第 4/5 步不做」结论**；
> ② 在结论变化时，给出**第一刀的可执行定案**。
> 涉及的行为契约、浮层合同、测试纪律、CI 契约一律以定案文档为准，本文不重复定义、也不放宽。

---

## 1. 背景：为什么需要复评

定案文档 §2.9（2026-10-10，`main@96f5a68f6`）以**实测数据**给出收口结论：

| 步 | 域 | 触点总数 | 模板引用 | 近 50 次改动的域命中率 | 结论 |
|---|---|---|---|---|---|
| 3 | 批量创作 | 114 | 36 | 4/50 | 缓做 → 已于 §2.10 完成 |
| 4 | QuickRender | ~49 | 20 | 2/50 | **不做**（收益最低） |
| 5 | useS2vConfig + ConfigProfile | **s2vConfig 108 + Profile 174** | 33 | **7/50** | **不做**（成本最高） |
| 6–7 | 壳层化 | — | — | — | 连带放弃 |

**第 5 步「不做」的两条依据**（缺一不可）：

1. **成本最高** —— `s2vConfig 108 触点 + Profile 174 触点`，§2.2 原文标注「全案最重域、状态桥接机制首个实战验证点」；
   且 `useS2vConfig` 需要把 `s2vConfig` 本体迁出（108 处跨域写点经 deps 转发，运行时开销与出错面最大）；
2. **收益不足** —— 冲突频率 7/50，与已拆的 TTS 域（8/50）相当 ⇒ 「TTS 域已完成拆分后，该域的冲突压力已被其他批次分摊」。

**复评的必要性**：这两条依据都是**时点快照**。自 2026-10-10 收口至今（2026-10-25），
`CreateView.vue` 又被 6 个 PR 改动（排队可见性 / 数字人声音克隆 / AI 讲解视频画面模式 /
Agnes Video 快速渲染 / a11y 键盘可达性 / 飞影数字人声音克隆）⇒ **两条依据的前提都可能已变**。

> **判读纪律**：「既有决策随前提失效」≠「既有论证有错」。
> 定案文档 §2.9 在 2026-10-10 的前提下**是正确的**；本文只回答「前提是否已变」。

---

## 2. 复评数据（2026-10-25 实测，基线 `origin/main@558fbb72`）

### 2.1 文件规模演进（实测行数，`git show <rev>:… | wc -l`）

| 版本 | 行数 | 说明 |
|---|---|---|
| `01a6f92b3`（第 1+2 步完成） | 5586 | BGM + TTS 域抽出 |
| `e11565b0a`（TTS 域抽出） | 5056 | 净 −530 |
| `c576b2dea`（§2.10 批量域抽出） | **4896** | **里程碑 2 收口点** |
| `41c871160` / `44690c826` / `cb3038ec3`（i18n 三批） | 4898 / 4881 / 4881 | i18n 迁移把中文换成 locale key |
| `origin/main@558fbb72`（当前） | **5563** | **净 +667（相对收口点）** |

`git diff c576b2dea..HEAD -- CreateView.vue` ⇒ **新增 928 行 / 删除 261 行**。

### 2.2 增量归因：新增项几乎全是「数字人域」（而该域已被拆过）

顶层选项差异（AST 口径，逐项 diff）：

- `methods` **新增 15 项 / 删除 9 项**：`loadAvatarCatalog`、`loadAvatarClones`、`refreshAvatarCatalog`、
  `toggleAvatarClonePanel`、`handleAvatarChange`、`mergedAvatarOptions`、`avatarText`、`avatarErrorText`、
  `avatarLoadFailedText`、`avatarCachedFailedText`、`avatarCloneInvalidKey`、`applyHistoryFilterFromRoute`、
  `isExplainerPipeline`、`clearS2VLegacyBgm`、`s2vBgmLibrarySummaryText`
- `computed` **新增 26 项 / 删除 7 项**：`avatarClones`、`avatarOptions`、`avatarProviderOptions`、
  `avatarProviderName`、`avatarProviderMissing`、`avatarError`、`avatarLoading`、`avatarCachedError`、
  `avatarCloneApi`、`avatarCloneCreating`、`avatarCloneCreateError`、`avatarCloneVoiceCreating`、
  `avatarCloneVoiceCreateError`、`avatarCloneVoiceCreatedName`、`avatarCloneVoiceSelectionId`、
  `avatarSubtitlePayload`、`avatarSubtitleSupported`、`avatarVoiceOptions`、`isAvatarPipeline`、
  `canCancelFromProgressModal`、`pipelineProgressResultReady`、`s2vLegacyBgmBlockedState`、
  `s2vLegacyBgmStatus`、`story2videoTextMaxChars`、`story2videoTextWarnPercent`

⇒ **30 项新增里有 22 项属数字人域**。但数字人域**早已被拆过**：
`video-creation/composables/useAvatarCatalog.js`（138 行）+ `useAvatarClone.js`（398 行）
（由 `digital-human-multiprovider` #4293 / `voice-clone-multiprovider` #4317 引入）
⇒ CreateView 侧剩下的是**桥接层**（全文含 `avatar` 的行 211 行 = 3%）⇒ **不是新的拆分候选**。

⇒ **结论 1**：这 667 行**分散在多个域**，**没有出现新的「重域」**。
数字人域的增量是**桥接**，不是可搬走的逻辑。

### 2.3 冲突频率（★ 主证据，与定案文档 §2.9 同源可比）

口径：**近 50 次改动 `CreateView.vue` 的 commit**，逐个 diff 出被改的方法/计算名，
按其所属域计一次命中（一个 commit 命中多个域则各计一次）。

| 域 | 2026-10-10（定案 §2.9） | **2026-10-25（本次实测）** | 变化 |
|---|---|---|---|
| TTS 音色 | 8/50（16%） | 6/50（12%） | −2 |
| 流水线启动 | — | **6/50（12%）** | 最高 |
| **数字人** | — | **5/50（10%）** | 已拆，仅桥接 ⇒ 非候选 |
| 编排轮询 | — | 4/50（8%） | — |
| **s2vConfig** | （与 Profile 合计 7/50） | **3/50（6%）** | — |
| BGM | — | 2/50（4%） | 已拆 |
| **ConfigProfile** | （与 s2vConfig 合计 7/50） | **1/50（2%）** | **−86%** |
| 批量创作 | 4/50（8%） | 1/50（2%） | 已拆 |
| 历史记录 | — | 1/50（2%） | — |
| QuickRender | 2/50（4%） | **0/50（0%）** | 仍无收益 |
| 未归类到任何域的 commit | — | 28/50 | 见 §2.4 边界 |

⇒ **ConfigProfile 的冲突压力从 7/50 降到 1/50（−86%）** ⇒ 定案 §2.9 的依据 ②（收益不足）**已失效**。

### 2.4 触点（⚠ 口径与定案文档不同源，**只做同次测量内的相对排序**）

本次口径 = 「该域的标识符（方法名/计算名 + 该域涉及的 `data` 键）在整个文件里的出现次数」。

| 域 | 项 | 毛行 | 标识符数 | 触点（本次口径） |
|---|---|---|---|---|
| 流水线启动 | 65 | 962 | 126 | 1436 |
| 编排轮询 | 33 | 737 | 69 | 1073 |
| **s2vConfig** | 40 | 469 | 71 | **706** |
| TTS 音色 | 53 | 200 | 60 | 395 |
| BGM | 32 | 126 | 35 | 351 |
| 数字人 | 35 | 118 | 50 | 322 |
| 历史记录 | 23 | 328 | 34 | 209 |
| **ConfigProfile** | 1+ | 13+ | 4+ | **120** |
| 批量创作 | 27 | 27 | 27 | 108 |
| QuickRender | 0 | 0 | 0 | 0 |

⚠️ **诚实边界**：本口径与定案 §2.9 的「s2vConfig 108 / Profile 174」**不同源**（本次的 `s2vConfig` 706 与其 108
差 6.5 倍，原因是本口径把每个 `s2vConfig.xxx` 引用都计入，而域归组也会把邻近逻辑并入）
⇒ **不得把两列数字直接对比**，只做**同一次测量内的相对排序**：
**`s2vConfig` 是当前最重的未抽域；`ConfigProfile` 已落到与「已拆的批量创作」同一量级。**

⇒ **结论 2**：`useS2vConfig` **仍然不做**（相对触点最重、且要迁出 `s2vConfig` 本体 ⇒
跨域写点经 deps 转发 ⇒ 运行时开销与出错面最大 ⇒ 定案 §2.2 原文的判断至今成立）。

---

## 3. 复评结论

| 定案 §2.9 的步 | 原结论 | **复评结论（2026-10-25）** | 依据 |
|---|---|---|---|
| 4 QuickRender | 不做 | ✅ **维持不做** | 冲突频率 0/50（本次 0/50）；触点最低 |
| 5 useS2vConfig | 不做 | ✅ **维持不做** | 相对触点最重（706）、要迁出本体 |
| **5 ConfigProfile** | 不做 | ⚠️ **重新成为候选** | 冲突频率 **7/50 → 1/50（−86%）**；相对触点落到与已拆域同量级 |
| 6–7 壳层化 | 放弃 | ✅ **维持放弃** | 依赖第 5 步；且壳层化收益/成本比最差（定案 B-5） |
| — | — | ⭐ **新增结论** | 数字人域增量是**桥接**，非候选；无新重域 |

⇒ **第一刀 = ConfigProfile 域**（`useConfigProfiles` composable），
**且只做 composable，不做三弹窗组件化**（见 §4.3）。

---

## 4. 第一刀定案

### 4.1 范围

| 项 | 内容 |
|---|---|
| **搬走** | `useConfigProfiles` composable：配置档案的 **CRUD + 套用 + 重命名 + 删除 + 路由套用**方法（AST 口径 22 项 / 约 245 行） |
| **不搬走** | ① `useS2vConfig`（相对触点最重，维持不做）② **ConfigProfile 三弹窗组件化**（§4.3）③ 历史域的删除确认三方法（定案 §2.10 已判「跨域过深留壳」） |
| **落点** | `apps/desktop/src/views/video-creation/composables/useConfigProfiles.js`（定案 §2.1 已指定该路径，**不新建目录**） |
| **规模** | 新文件 ≤ 499 行（预估 ≈ 220–280 行）；单 PR 移动量 ≤ 1500 行（定案 §五-5） |

### 4.2 状态处置：⚠ **不抽 `data()` 里的状态**（与既有三批 composable 不同）

**现状**：既有三批（`useBgmLibrary` / `useTtsVoices` / `useBatchCreate`）都把状态**移出** `data()`
进 composable 的模块级单例。

**本刀不同**：`s2v-panel-contract.parent-keys.test.js` 要求
`expect(parent.data.size).toBeGreaterThan(80)` ⇒ **当前 `data` 键数 122** ⇒
**每抽走一个 `data` 键，余量就少 1**。若沿用既有做法把 25 个配置档案状态键搬进 composable，
`data.size` 落到 **97**（余量 42 → 17）⇒ 后续刀次会更快撞线。

⇒ **本刀做法**：**状态全部留在壳的 `data()`**，composable 通过**显式 deps** 读；
需要写回时经 deps 提供的写入器写回**同一个响应式对象**（禁止 spread 副本）。
（v5 §3.1 同一结论；本 PRD 将其从「方案建议」升为「本刀硬约束」。）

⚠️ **同时，本刀必须是仓内第一个「实例级」composable**（既有三批是模块级单例）——
模块级单例把「组件卸载」与「状态生命周期」解耦（定案 §2.8 实测的 Teleport 跨用例污染根因）。
本刀状态留壳 ⇒ **天然无此问题** ⇒ 不得引入 `window.__*` 全局兜底（既有 `useBatchCreate` 有，
是遗留形态，不得照抄）。

### 4.3 为什么不连带拆三弹窗

定案 §2.4（浮层弹窗互斥合同）规定：弹窗一旦拆成独立组件即属**新增应用级模态浮层**，
必须逐个登记确定 owner + 释放兜底 + 在 `overlay-view-suspension.test.js` 同步断言，缺一不可。
⇒ 三弹窗（保存/列表/套用/删除共 4 个）拆出即触发该硬门禁。

⇒ **本刀只抽逻辑，不动模板** ⇒ 不产生新浮层 ⇒ 不触发 §2.4 ⇒ **把风险面从「最高」降到「中」**。
代价：配置档案 UI 仍留在 CreateView 模板里（`§2.2` 目标结构里的 `PipelineConfigProfileDialogs.vue` 顺延）。

### 4.4 必须遵守的仓内执行纪律（定案 §五，逐条不打折）

| # | 纪律 | 本刀的具体落点 |
|---|---|---|
| 1 | **行为零变更**；模板段抽子组件才需声明「受控行为重接线」 | 本刀**不抽模板** ⇒ 严格零变更；PR 声明「纯搬移 + import 重接」 |
| 2 | 测试策略：代理 methods 过渡 + 新测试随实现同步写 + 公共夹具 harness；全量 vitest 通过 | 壳侧保留同名方法代理（旧测试 288/288 零改动全绿）；新 composable 配独立新测试 |
| 3 | **QM-4 视觉回归** `npm run test:visual:pixel` | 本刀不改模板 ⇒ 预期无像素变化，但**仍须跑**（像素基线含折叠态摘要） |
| 4 | **CI 契约**：全量扫描类测试不因路径变化漏扫 | ⚠ **CJK 基线按 `file:line` 存储** ⇒ 搬走 245 行会让 `CreateView.vue` 行号偏移 ⇒ 基线失配 ⇒ **必须同步重生成 `locale-cjk-baseline.json`**，并证明「无新增硬编码」（新文件 CJK 命中 = 0） |
| 5 | 单 PR ≤ 1500 行移动 | 预估 ≈ 300 行 ✔ |
| 6 | 浮层合同 | 本刀不拆浮层 ⇒ 不触发 |

### 4.5 数据校验与流程（搬移时必须逐字保持的既有契约）

配置档案域自带 4 道校验，**搬移时一条都不能弱化**：

| 校验 | 既有行为 | 搬移后必须仍成立 |
|---|---|---|
| **名称非空** | `name.trim()` 为空 ⇒ toast「请输入配置名称」并 `return`（不发起请求） | 同 |
| **流水线已选** | `selectedPipeline?.name` 为空 ⇒ 直接 `return`（不发请求、不提示） | 同 |
| **重名二次确认** | 同 `(pipelineId, name)` 已存在 ⇒ 置 `overwriteNeeded` + toast「已存在同名配置，再次点击保存将覆盖它」并 `return`；**第二次点击**才真覆盖 | 同（`overwriteNeeded` 是壳 `data` 键，随状态留壳） |
| **并发守卫** | `s2vConfigProfileListRequestId` 单调递增；请求返回时 `requestId !== 当前值` ⇒ 丢弃过期结果（加载/错误/列表三处都要判） | 同（`requestId` 是壳 `data` 键 ⇒ 天然随实例生命周期） |

**流程（用户视角）**：

1. **保存**：点「保存配置」→ 打开保存弹窗 → 输入名称 → 「保存」
   - 名称为空 ⇒ 提示「请输入配置名称」，停留在弹窗
   - 未选流水线 ⇒ 无提示、不请求（**静默**，与现状一致）
   - 重名 ⇒ 提示「已存在同名配置，再次点击保存将覆盖它」，需**再次点击**「保存」才覆盖
   - 成功 ⇒ 提示「配置已保存」；失败 ⇒ 提示失败原因（`saveFailed`）
2. **列表**：「我的配置」→ 按 `updatedAt` 倒序（加载失败时保留旧列表 + 错误提示）
3. **套用**：「应用」⇒ 二次确认（覆盖当前已调整的选项）⇒ 套用快照
   - 套用**不属于当前流水线** ⇒ 拒绝并给可读提示（`wrongPipeline`）
   - 已被删除 ⇒ 如实提示，不静默当作「没选配置」
4. **重命名 / 删除**：各有独立确认弹窗；删除后提示已删除
5. **路由套用**：URL 带 `configProfile` ⇒ 自动套用该配置并提示「已应用配置」；无参数 ⇒ 不套用不提示（用流水线默认参数）

**交互与显示项**：本刀**不动模板 ⇒ 显示项与交互零变更**（弹窗、按钮、提示位置、toast 时长 2200ms 全部逐字保持）。

**提示文字**：⚠ **不得在新文件里写任何中文字面量**（CI Gate 7 `--cjk` 拦渲染端新增硬编码）。
既有方法体的中文 fallback 已在 i18n 迁移（#3330「fallback 参数清偿 43 处」）中清偿，
`check-locale-sync.js --cjk` 当前读数 **基线 1330 / 当前 1095 / 无新增** ⇒
**本刀 locale 补全量 = 0**；若实现过程中发现残留中文 ⇒ 一律走
`translateWithLocaleFallback(key, zh, en)` 并把 zh/en 补进 `locales/create/{zh,en}.js`
（`configProfile` 命名空间现有 20+ 键，缺什么补什么，zh/en 成对）。

### 4.6 风险清单

| 风险 | 级别 | 处置 |
|---|---|---|
| 桥接把 `data` 键接坏（原地变异丢失响应式） | **高** | 桥接 getter **必须返回 `data` 内对象本身**，禁止 spread 副本；配「原地变异仍触发渲染」的用例 |
| 代理与新 composable 双路径并存 | 中 | 每个代理方法登记「→ 计划删除 PR 编号」映射表（定案 §2.3 代理退出机制） |
| CJK 基线行号失配 ⇒ Gate 7 红 | 中 | 同步重生成基线 + 证明新文件 CJK 命中 = 0 |
| 旧测试 1392 处 `w.vm.` 触点（含 415 处直接赋值）被打断 | 中 | 状态留壳 ⇒ 触点不迁移；壳侧同名代理 ⇒ 旧测试零改动 |
| 像素回归 | 低 | 不动模板；仍须跑 QM-4 |
| 与在飞 PR 冲突 | 低 | 2026-10-25 实测：**在飞 40 条 PR 无一改 `CreateView.vue`**；`#4387`/`#4378` 改的是 `video-creation/S2vConfigPanels.vue` 与 `composables/tts-voices-*` ⇒ 本刀**不触达**（本刀只动 `CreateView.vue` + 新增 composable + locale 基线） |

---

## 5. 交付物与验收

| 项 | 判据 |
|---|---|
| 新 composable | `useConfigProfiles.js`，≤ 499 行，**无中文字面量**，无 `window.__*` 全局兜底 |
| 壳侧 | 同名方法代理齐全；`data` 键 **0 个**被移出；`data.size` 仍 **122** |
| 旧测试 | `CreateView.test.js` **288/288 零改动全绿** |
| 新测试 | composable 独立测试文件，覆盖 §4.5 的 4 道校验 + 1 个并发守卫用例 |
| 视觉 | QM-4 `npm run test:visual:pixel` 无差异 |
| CI | Gate 7（locale-sync 四项）绿（**含重生成 CJK 基线**）、Gate 11 eslint 绿、`check-max-lines` 绿、债务熔断绿 |
| 记录 | `openspec/records/<分支名>.md` + openspec change 四件套 |

---

## 6. 与既有文档的关系（避免重复发明）

| 文档 | 定位 | 本 PRD 的处理 |
|---|---|---|
| `01-docs/FRONTEND-FILE-SPLIT-PLAN-2026-10.md` | **仓内定案**（v3/v4），目标结构、拆分顺序、红线、浮层合同、执行纪律 | **继续有效**，本文只做复评与第一刀定案，不改其结论性内容 |
| `01-docs/PRD-CREATEVIEW-DEBT-SPLIT.md` | 早期技术债拆分 PRD（第一批已交付） | 已被定案文档取代，本文不引用其结论 |
| 仓外分析底稿（本会话工作区内的分析文件，**仓内无对应文件**，不入库） | 本轮分析底稿（含 AST 口径脚本与 6 域重归组） | **降级为底稿**：其「6 域按功能切」的划分与仓内域划分不同源，触点不可比；其价值是提供了本文 §2 的复评数据与 §4.2 的 `data.size` 余量推导 |

⚠️ **本轮的一条纪律复现**：先全树搜 `01-docs/` 的定案文档再动手。
本轮最初按仓外底稿的「6 域」选了 ConfigProfile 作为第一刀，**而仓内定案已用实测数据判定该域「不做」**；
若未先读定案文档，会重复发明并差点重做一件已被否决的事。
**本刀能成立的理由不是「底稿说该拆」，而是「复评数据表明仓内原依据的两条前提都已变」**——
这两句话必须分开，否则后人会把「复评通过」误读成「方案本来就没被否决过」。
# PRD 追加章：CreateView 拆分第一刀 —— 配置档案域实现（2026-10-25 落地）

> 本章是 `01-docs/PRD-CREATEVIEW-SPLIT-REVIEW-2026-10-25.md` 的**实现补充**：
> §1–§6 是复评与第一刀**定案**（合并于 #4431）；本章是**已落地的实现**（合并于本 change）。
> 定案章与本章若有出入，**以本章为准**，并在 §6.8 逐条写明偏差与原因。

## 6.1 落点与形态

| 项 | 落地值 |
|---|---|
| composable | `apps/desktop/src/views/video-creation/composables/useConfigProfiles.js`（373 行，< 499 硬上限） |
| 测试 | `apps/desktop/src/views/CreateView.config-profile-composable.test.js`（501 行，24 例） |
| 形态 | **实例级**：`useConfigProfiles(deps)` 每次调用返回独立对象，deps 由闭包捕获 |
| 状态 | **全部留在壳的 `data()`**（18 个配置档案键 + `s2vActiveConfigProfile`）⇒ `data.size` **不变**（既有契约 `expect(parent.data.size).toBeGreaterThan(80)` 仍成立） |
| 依赖 | 显式 deps **9 项**：`get` / `set` / `getDefaults` / `toast` / `pipelineName` / `isOrchestratedPipeline` / `cloneForIpc` / `applySnapshotObject` / `messages` |
| 禁止项 | 未引入模块级单例、未引入 `window.__*` 全局兜底、未照抄既有三批 composable 的遗留形态 |

⚠ **与既有三批 composable 的形态差异是刻意的**：既有（`useBgmLibrary` / `useTtsVoices` / `useBatchCreate`）是模块级单例，
把「组件卸载」与「状态生命周期」解耦；本刀状态留壳 ⇒ 天然无此问题 ⇒ 不得引入。

## 6.2 搬走 / 留壳清单

**搬走 21 个方法**（域内专有）：`s2vConfigProfileDefaults` / `buildPipelineConfigSnapshot` / `s2vConfigProfileFormDirty` /
`loadS2VConfigProfiles` / `openS2VConfigProfileSave` / `closeS2VConfigProfileSave` / `saveS2VConfigProfile` /
`openS2VConfigProfileList` / `closeS2VConfigProfileList` / `s2vConfigProfileCanApply` / `requestApplyS2VConfigProfile` /
`cancelApplyS2VConfigProfile` / `confirmApplyS2VConfigProfile` / `applyS2VConfigProfileSnapshot` /
`startS2VConfigProfileRename` / `cancelS2VConfigProfileRename` / `saveS2VConfigProfileRename` /
`requestS2VConfigProfileDelete` / `closeS2VConfigProfileDelete` / `confirmS2VConfigProfileDelete` / `formatS2VConfigProfileTime`

**留壳 4 个方法（跨域共用，明确不动）**：

| 留壳方法 | 留壳理由 |
|---|---|
| `_applyS2VSnapshotObject` | 与「恢复上次选项」历史域 `restoreS2VLastOptions` **共用** ⇒ 跨域过深；composable 经 `deps.applySnapshotObject` 调用它（编排型快照的整对象恢复通道） |
| `normalizeS2VRestoredEnums` | 同上（被 `_applyS2VSnapshotObject` 两处调用） |
| `restoreS2VLastOptions` | 历史域，非配置档案域 |
| `_applyS2VSnapshot` | 只被 `_applyS2VSnapshotObject` 使用 ⇒ 随留壳侧一起不动，避免触碰历史域的恢复路径 |

**壳侧代理 19 个**（过渡层）：模板调用 16 个 + 旧测试调用 2 个（`buildPipelineConfigSnapshot` / `applyS2VConfigProfileSnapshot`）
+ 路由套用 1 个（`loadS2VConfigProfiles`，被 `_applyConfigProfileFromRoute` 的 `loadProfiles` 回调使用）。
形态统一为 `name(...args) { return this.configProfiles.name(...args) }` ⇒ **缺导出时是 TypeError（响亮）而非静默 undefined（哑）**。

## 6.3 桥接两条兼容契约（定案 §2.3）与其落地方式

| 契约 | 落地机制 | 锁在哪条用例 |
|---|---|---|
| ① 整体对象赋值（`vm.s2vConfigProfiles = [...]`）**整体替换** | `deps.set(key, value)` → `this[key] = value` → 走组件 proxy 的 set ⇒ 响应式整体替换 | 「桥接契约：原地变异返回同一引用…」 |
| ② 原地变异（`vm.s2vConfigProfiles.push(x)`）**返回 ref/响应式对象本身**（非 spread 副本） | `deps.get(key)` → `this[key]` → 组件 proxy 的 get ⇒ 返回**响应式代理本身** | 同上（断言 `host.get(...)` 与 `host.state[...]` **同一引用** `toBe`） |
| ③ Vue 3 中 ref 放进 `data()` 不会解包 ⇒ **禁止**把 composable ref 挂进 `data()` | 本刀**不搬状态** ⇒ 不存在 ref ⇒ 该禁令自动满足 | 「状态仍留在壳的 data()」 |

⚠ **状态桥接与代理是两个独立机制**：状态桥接 = `get`/`set` 读写壳的响应式对象；代理 = 19 个同名方法转发到 composable 实例。

## 6.4 数据校验（4 道校验 + 1 道并发守卫，逐字保持）

| 校验 | 既有行为 | 实现落点 | 锁 |
|---|---|---|---|
| 名称非空 | `name.trim()` 为空 ⇒ toast「请输入配置名称」+ `return`（**不发请求**） | `saveS2VConfigProfile` | 用例 1（+ 变异 M1） |
| 流水线已选 | `selectedPipeline?.name` 为空 ⇒ **静默** `return`（不发请求、不提示） | 同上 | 用例 2 |
| 重名二次确认 | 同 `(pipelineId, name)` 已存在 ⇒ 置 `overwriteNeeded` + toast「已存在同名配置，再次点击保存将覆盖它」+ `return`；**第二次点击**才真覆盖（`overwrite: true`） | 同上 | 用例 3 |
| 服务端同名判定 | `result.code === -2` 且 message 命中 `/同名\|已经存在\|already exists\|duplicate/i` ⇒ 同样进二次确认（**不当成普通失败**） | 同上 | 用例 4 |
| 服务端其它失败 | ⇒ toast「配置保存失败，请稍后重试」（2600ms），`overwriteNeeded` 保持 false | 同上 | 用例 5 |
| 并发守卫 | `s2vConfigProfileListRequestId` 单调递增；返回时 `requestId !== 当前值` ⇒ 丢弃过期结果。**三处都要判**：成功分支、错误分支、`finally`（清 loading） | `loadS2VConfigProfiles` | 用例 7（+ 变异 M2） |
| 快照套用（逐项类型判定） | 数组/对象走深拷贝；其余**同 `typeof`** 才赋值；`undefined`/`null` 跳过 | `applyS2VConfigProfileSnapshot`（legacy 分支） | 用例 13 |

## 6.5 流程（用户视角，6 条路径，搬移后逐字不变）

1. **保存**：点「保存配置」→ 弹窗 → 输入名称 → 「保存」
   - 名称为空 ⇒ 提示「请输入配置名称」（2200ms），停留弹窗
   - 未选流水线 ⇒ **静默无提示、不请求**
   - 重名 ⇒ 提示「已存在同名配置，再次点击保存将覆盖它」（2200ms）⇒ 需**再次点击**才覆盖
   - 成功 ⇒ 提示「配置已保存」；失败 ⇒ 提示失败原因
2. **列表**：「我的配置」⇒ 按 `updatedAt` 倒序；加载失败**保留旧列表** + 错误提示（`quiet` 模式不弹 toast）
3. **套用**：「应用」⇒ **表单未脏时直接套用**（不弹确认）；表单已脏 ⇒ 二次确认（覆盖当前已调整的选项）⇒ 套用快照
   - 不属于当前流水线 ⇒ 拒绝并提示「该配置属于其他流水线，无法在当前流水线应用」（2600ms）
   - 确认瞬间流水线被切换 ⇒ 同样按跨流水线拒绝
4. **重命名**：独立确认态（行内输入）⇒ 成功后按服务端返回的 `result.data` **整体替换**该列表项
5. **删除**：独立确认弹窗 ⇒ 成功后从列表移除
6. **路由套用**：URL 带 `configProfile` ⇒ 自动套用并提示「已应用配置」；无参数 ⇒ 不套用不提示
   ⚠ 该路径**不由本 composable 实现**（由 `@/features/publish-destination/apply-config-profile-handoff` 承担），
   但它**依赖** `loadS2VConfigProfiles` 与 `applyS2VConfigProfileSnapshot` 两个代理 ⇒ 故这两者必须留在壳上。

## 6.6 交互逻辑与显示项：**零变更**

本刀**不抽模板**（`CreateView.vue` 的 template 一行未改）⇒ 弹窗、按钮、`data-testid`、提示位置、toast 时长**全部不动**。
新增 3 个 `data` 键为 **0**（`data.size` 不变）。

## 6.7 提示文字落点（12 条，逐条列出）

| 触发点 | locale key | 中文 | 英文 | 时长 |
|---|---|---|---|---|
| 名称为空 | `create.story2video.configProfile.nameRequired` | 请输入配置名称 | Enter a configuration name | 2200ms |
| 重名（本地命中 / 服务端 -2） | `create.story2video.configProfile.duplicateName` | 已存在同名配置，再次点击保存将覆盖它 | A configuration with this name already exists. Click save again to overwrite it. | 2200ms |
| 保存失败（业务错误码） | `create.story2video.configProfile.saveFailed` | 配置保存失败，请稍后重试 | Could not save the configuration. Please try again. | 2600ms |
| 保存失败（异常兜底） | 无（裸文案） | 配置保存失败 | — | 2600ms |
| 保存成功 | `create.story2video.configProfile.saved` | 配置已保存 | Configuration saved | **默认 1600ms** |
| 跨流水线拒绝 | `create.story2video.configProfile.wrongPipeline` | 该配置属于其他流水线，无法在当前流水线应用 | This configuration belongs to another pipeline and cannot be applied here. | 2600ms |
| 套用成功 | `create.story2video.configProfile.applied` | 已应用配置 | Configuration applied | **默认 1600ms** |
| 重命名成功 | `create.story2video.configProfile.renamed` | 配置已重命名 | Configuration renamed | **默认 1600ms** |
| 重命名失败（异常兜底） | 无（裸文案） | 重命名失败 | — | 2600ms |
| 删除成功 | `create.story2video.configProfile.deleted` | 配置已删除 | Configuration deleted | **默认 1600ms** |
| 删除失败（异常兜底） | 无（裸文案） | 删除失败 | — | 2600ms |
| 列表加载失败（异常兜底） | 无（裸文案） | 配置列表加载失败 | — | 2200ms |

⚠ **文案全部由 `deps.messages.*` 惰性提供（壳侧持有 zh/en 三元组）**，composable 内**零中文字面量**：
① 渲染端硬编码中文门禁（`--cjk`）只扫**非测试**源文件 ⇒ 新文件若带中文会被判「新增硬编码」；
② 惰性求值保证**语言切换后文案跟随**（不可在 `created()` 时算成常量）。

## 6.8 与 design（已归档 change）§2–§9 的偏差订正

| # | design 的说法 | 实测 / 落地 | 原因 |
|---|---|---|---|
| 1 | 「基线按 `file:line` 存储 ⇒ 搬走 245 行会让行号偏移 ⇒ **必须重生成** `locale-cjk-baseline.json`」 | **不需要重生成**。实测基线形态是 `file\|\|content`（2026-09-26 迁移过），**行号无关**；`--cjk` 判据只判「新增」⇒ 搬走的 239 条存量条目消失**不报红**。实测读数：基线 1330 / 当前 1091 / **无新增硬编码** | design 引用的是**迁移前**的旧形态 ⇒ 本条为**过时结论**，按实测订正 |
| 2 | 「22 项 / 约 245 行」 | **21 个方法**搬走 + 4 个留壳；composable 373 行 | 口径差异：AST 口径的「22 项」与「方法数」不同源 |
| 3 | 「提示 toast 2200ms」 | **部分提示无显式时长 ⇒ 用默认 1600ms**（`showS2VOptionsToast(text, durationMs = 1600)`）：`saved` / `applied` / `renamed` / `deleted` 四条 | 逐字保持既有行为（首版草稿误加了 2200ms，自查抓出并修正） |
| 4 | 「套用 ⇒ 二次确认」 | **表单未脏时直接套用，不弹确认**（`requestApplyS2VConfigProfile` 里 `!s2vConfigProfileFormDirty()` 分支） | 既有实现如此 ⇒ 逐字保持，design 描述不完整 |
| 5 | 「`_applyS2VSnapshot` 逐项比 `typeof` 判定」 | 该方法**只被 `_applyS2VSnapshotObject` 使用** ⇒ 与历史域共用 ⇒ **留壳**，不搬 | 跨域共用 ⇒ 搬走会触碰「恢复上次选项」路径（风险面从「中」升到「高」） |
| 6 | 「每个代理方法登记『→ 计划删除 PR 编号』映射表」 | 本刀**未建立该映射表**（代理层整批撤除需另起 change） | 已如实登记为执行记录的「遗留」，不假装已闭合 |

## 6.9 风险清单与处置

| 风险 | 处置 |
|---|---|
| 代理清单 ⇄ composable return 清单**两份手工同步** ⇒ 漏导出 ⇒ 既有测试红（**已实测发生**：漏 `buildPipelineConfigSnapshot` ⇒ 4 条旧测试红） | 新增**结构锁 3 条**（代理数=19 / 代理 ⊆ return / return ⊆ 代理，读两侧源码比对）＋ 变异 M4 验证锁有牙齿 |
| 新增叶子模块**单测全绿 ≠ 已接线** | 测试含**Part B 壳接线证明** 3 条（mount 真实 CreateView：代理转发、状态留壳、列表真打到 API 层） |
| 新增测试文件**改变 vitest 分片分配** ⇒ 可能把「时限偏紧」的用例点着 | 新测试 24 例、耗时 ~0.3s（纯逻辑 + 1 次 mount）⇒ 影响面极小；仍需在 CI 观察 shard 分配 |
| `data.size` 下限（`> 80`）被消耗 | 本刀**不抽状态** ⇒ `data.size` 不变 ⇒ 契约 `s2v-panel-contract.parent-keys.test.js` 5/5 绿 |
| 文案被搬进新文件 ⇒ 触发 CJK 硬编码门禁 | 文案全部留在壳的 `deps.messages` ⇒ 新文件 CJK 命中 **0** ⇒ `--cjk` PASS |
| 代理层残留在主干 ⇒ 长期债务 | 登记为遗留；撤除须另起 change，并与「代理残留数 ≤ 未完成步数」指标同步 |

## 6.10 验收判据（全部为当场实测读数）

| 判据 | 期望 | 实测 |
|---|---|---|
| `CreateView.vue` 行数 | 显著下降（targets 零容差 5656） | **5562 → 5361（净减 202）** |
| 新 composable 行数 | < 500 | **373** |
| 新测试行数 | < 1500 | **501** |
| `data.size` | 不变（`> 80` 契约成立） | 不变；`s2v-panel-contract.parent-keys.test.js` **5/5 绿** |
| 新测试 | 覆盖 4 校验 + 1 守卫 + 桥接 + 接线 + 结构锁 | **24/24 绿** |
| 既有回归 | 零改动全绿 | **315/315 绿**（6 文件：CreateView.test.js / config-profile-handoff / s2v-panel-contract.parent-keys / pipeline-runtime / visual-mode / story-text-limit-wiring） |
| 变异验证 | 注入缺陷必被抓住 | **4/4 全部抓住**（M1 名称校验 / M2 并发守卫 / M3 桥接同引用 / M4 结构锁），每步还原后基线绿 |
| CJK 硬编码门禁 | 无新增 | **PASS**（基线 1330 / 当前 1091 / 无新增） |
| 逐文件行数门禁 | 无新增超大文件 | **PASS**（`✅ 无新增超大文件，挂账清单与现实一致`） |
| 界面变更 | 零变更（不抽模板） | template 一行未改 ⇒ 无像素基线需刷新 |
