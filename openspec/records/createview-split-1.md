---
record: createview-split-1
task: 复评仓内 CreateView 拆分方案的「不做」结论并定案第一刀（ConfigProfile 域），产出可实施规格
date: 2026-10-25
branch: createview-split-1
---

| 远程同步 | 由门禁推导 |

## 变更类型与隔离

**纯文档变更**：新增复评 PRD + openspec 规格（proposal/design/tasks/specs）+ 定案文档指针节。
**零运行时代码变更** ⇒ 不触碰 `CreateView.vue`、不触碰 `locales/` ⇒ 无像素回归风险、无测试回归风险。

隔离分支 `createview-split-1`（裸 task 名，无斜杠），独立 worktree 位于
**仓库父目录的 `mp-worktrees/` 下**（非系统盘），基线 `origin/main@558fbb72`。
⇒ 符合「运行时代码/CI 变更用隔离分支/worktree」纪律；本片虽无运行时代码，仍按隔离执行。

## 为什么先复评而不是直接开工

开工前全树搜 `01-docs/` 的定案文档 ⇒ 找到仓内既有拆分方案
`FRONTEND-FILE-SPLIT-PLAN-2026-10.md`（v3/v4）：目标结构、拆分顺序、红线、浮层合同、执行纪律
均已定案，且**里程碑 2 已收尾**（第 1/2/3 步落地，第 4/5/6/7 步以实测数据判「不做」）。

⚠️ **本轮最初按仓外分析底稿选域，差点重做一件仓内已否决的事** —— 这是本片最重要的一条纪律复现：
**动手前必须全树搜 `01-docs/` 的定案文档**（仓外底稿只是线索，不是定案）。

## 复评数据（全部当场实测，无推算值）

| 项 | 2026-10-10 定案基线 | 2026-10-25 实测 | 变化 |
|---|---|---|---|
| CreateView.vue 行数 | 4896（收口点） | **5563** | **+667**（diff +928 / −261） |
| ConfigProfile 冲突频率 | 7/50（含 s2vConfig，14%） | **1/50（2%）** | **−86%** |
| QuickRender 冲突频率 | 2/50 | **0/50** | 仍无收益 |
| `data` 键数 | — | **122** | `data.size > 80` 余量 **42 键** |
| CJK 预检 | — | **PASS（基线 1330 / 当前 1095 / 无新增）** | locale 补全量 = 0 |

**增量归因**：顶层选项 diff ⇒ `methods` 新增 15 / 删除 9、`computed` 新增 26 / 删除 7
⇒ 30 项新增里 **22 项属数字人域**；而数字人域**早已被拆**
（`useAvatarCatalog` 138 行 + `useAvatarClone` 398 行）⇒ CreateView 侧剩**桥接层**
⇒ **不是新的拆分候选** ⇒ 那 667 行**分散在多个域，没有出现新的「重域」**。

**触点的诚实边界**：本次触点用「域标识符全文出现次数」口径，**与定案文档不同源**（同域差 6.5 倍）
⇒ **只做同次测量内的相对排序，不与定案的 108/174 直接对比**；
**同源的冲突频率才是主证据**。另：28/50 的 commit 未归类到任何域 ⇒ 命中率为**下界**。

## 复评结论

| 定案 §2.9 的步 | 原结论 | 本次结论 |
|---|---|---|
| 4 QuickRender | 不做 | ✅ 维持不做（冲突 0/50） |
| 5 `useS2vConfig` | 不做 | ✅ 维持不做（相对触点最重，且要迁出 `s2vConfig` 本体） |
| **5 ConfigProfile** | 不做 | ⚠️ **重新成为候选**（冲突 7/50 → 1/50，原依据 ② 已失效） |
| 6–7 壳层化 | 放弃 | ✅ 维持放弃 |

⇒ **第一刀 = ConfigProfile 域**（`useConfigProfiles` composable），
**只做 composable、不连带拆三弹窗**（拆弹窗会触发定案 §2.4 浮层互斥合同硬门禁 ⇒ 风险面从「最高」降到「中」）。

## 关键执行约束（已写进规格，实现时不得打折）

- **状态留在壳的 `data()`**：25 个配置档案状态键**一个都不移出**
  ⇒ `data.size` 仍 **122**、余量 42 键不被消耗
  ⇒ 沿用既有三批「把状态搬进 composable」的做法会让余量掉到 17 ⇒ **不做**。
- **本刀是仓内第一个实例级 composable**：既有三批是模块级单例（把「组件卸载」与「状态生命周期」解耦，
  定案 §2.8 实测的 Teleport 跨用例污染根因）；状态留壳 ⇒ 天然无此问题
  ⇒ **不得引入 `window.__*` 全局兜底**（那是遗留形态）。
- **桥接两条兼容契约**：整体赋值经 setter 整体替换；原地变异要求 getter 返回**同一引用**（禁止 spread 副本）。
- **提示文字**：新文件**零中文字面量**（CI Gate 7 `--cjk` 拦渲染端新增硬编码）；
  既有方法体的中文 fallback 已被 i18n 迁移清偿 ⇒ locale 补全量 = 0；
  ⚠️ `--cjk` 基线**按行号存储** ⇒ 搬走 245 行会让行号偏移 ⇒ 实现 PR 须**重生成基线**并证明无新增命中。
- **数据校验 4 道 + 并发守卫 1 道**（名称非空 / 流水线已选 / 重名二次确认 / 并发守卫 / 快照逐项类型判定）
  逐条保持；**显示项与交互零变更**（不抽模板 ⇒ toast 2200ms 等全部不动）。
- **测试**：壳侧同名代理 ⇒ 旧测试 288/288 零改动；新 composable 配独立新测试；
  ⚠️ **新增测试文件会改变 vitest 分片分配** ⇒ 预期「时限偏紧用例被挪进更慢 shard」这一形态。
- **在飞 PR 避让**：在飞 40 条**无一改 `CreateView.vue`**；
  `#4387`/`#4378` 改的是 `S2vConfigPanels.vue` 与 `composables/tts-voices-*` ⇒ 本刀不触达。

## 为什么本片不含实现

仓内定案 §五-3 要求拆分落地后跑 **QM-4 像素回归**（需 Electron + 浏览器环境），
**不在本变更执行环境内** ⇒ 实现必须与像素回归同批完成，
否则等于把「未验证的重构」先合入主干。

⇒ 故本片交付**规格**，实现另开 change（`createview-config-profile-extract-impl`）。
⇒ 按 `openspec-sync-check` 的「active change 的 tasks 无未完成项」判据，
本 change 的 tasks **只列本轮实际完成并可取证**的事项，**实现项不进 tasks**（不勾未做的事）。

## 交付物

- `01-docs/PRD-CREATEVIEW-SPLIT-REVIEW-2026-10-25.md`（复评报告 + 第一刀定案：
  数据校验 / 流程 / 交互 / 显示项 / 提示文字 / 风险清单 / 验收判据 / 与既有文档的关系）
- `openspec/changes/createview-config-profile-extract/`（proposal / design / tasks / specs）
- `01-docs/FRONTEND-FILE-SPLIT-PLAN-2026-10.md` 加一节指针（**不改其既有结论性内容**）

## 验证

| 项 | 判据 | 结果 |
|---|---|---|
| openspec 变更完整性 | `node scripts/openspec-sync-check.js` | 见本次提交 |
| 执行记录欠账 | `node scripts/check-gate-record-debt.js` | 见本次提交 |
| 记录行集 | `node scripts/check-record-qm5-rows.js` | 见本次提交 |
| 文档绝对路径 | `node --test scripts/check-doc-abs-paths.test.js` | 见本次提交 |
| 逐文件行数门禁 | `node .github/scripts/check-max-lines.js` | 见本次提交 |
| 债务预算 | `node scripts/check-debt-budget.js` | 见本次提交 |

## 待办 / 未纳入

- **第一刀实现未做** ⇒ 另开 change 执行（见 design.md §10）。
- `useS2vConfig` 域、ConfigProfile 三弹窗组件化、历史域删除确认三方法 —— **均维持不动**，
  理由逐条写进复评 PRD。
- 仓外分析底稿（在本会话工作区内，**仓内无对应文件**）**降级为分析底稿**：
  其「6 域按功能切」的划分与仓内域划分**不同源** ⇒ 触点不可比；
  其价值是提供了本片的复评数据与 `data.size` 余量推导。
