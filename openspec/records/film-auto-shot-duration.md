---
record: film-auto-shot-duration
task: 落地 M0′.3 —— 出片消费逐镜镜长（规划期算出的逐镜时长此前算了但没被出片消费）
date: 2026-10-25
branch: film-auto-shot-duration
delivered_by_pr: 4471
---

# M0′.3　出片消费逐镜镜长（2026-10-25）

## 本次执行记录：出片消费逐镜镜长（film-auto-shot-duration，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `/workspace/mp-worktrees/mp-film-shot-duration`（NFS，**非 C 盘**）+ 裸分支 `film-auto-shot-duration`；文档：PRD + 本执行记录，同 PR 落地 |
| 第一性原因（QM-5 ①） | ✅ | 规划期按每镜台词算出的时长（`durationMs` / `durationSec` / `durationRawSec`，v7 批次一落的）**算了但没有任何消费方** ⇒ 出片一直用用户选的整档 `shot.seconds` ⇒ 台词短的镜被撑成整档、后半段空场。基线注释里那句「消费方可以继续只读 seconds；需要更细的时长就读 durationMs」描述的是一个**并不存在的消费方** |
| 逃逸分析（QM-5 ②） | ✅ | ① 既有测试「每镜都带 durationMs / durationSec / durationSource」只断言**规划期**的字段存在性 ⇒ **没断言「谁读了它」** ⇒ 字段可以是**死字段**而全套测试仍绿；② `auto-runner.test.js`「逐镜把 seconds 传给生成函数」**把旧行为当成了正确行为**固化下来；③ `video-gen.test.js` 的帧数断言把 **stage 级**当成逐镜口径 |
| 修复 + 回归保护（QM-5 ④） | ✅ | A45–A47 三条（见 §验收）+ 新模块纯函数 4 条；本地 **125/125** 绿；**变异 8 组全部被抓住**（抽模块前 4 组 + 抽模块后 M-A 不吸附 5 红 / M-B 去掉 `effectiveSeconds` 3 红 / M-C 回落链顺序反转 2 红 / M-D 改回 `shot.seconds` 1 红） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 消费方契约写进**字段名与语义**（`effectiveSeconds` 恒为「档位表之一」，消费方不必知道来源）；② **来源差异在生产端吸收**（统一从 `rawSec` 吸附，不把「来源不同 ⇒ 量纲不同」推给消费方）；③ 回落链**只写一遍**（`resolveShotSeconds` 一个 helper，四个调用点共用）；④ **存量行为用测试钉住**（A46/A47 各有一条「没有该字段 ⇒ 行为不变」）⇒「纯增量」这条性质**可回归**；⑤ 新增用例**追加到既有测试文件**（不新建 ⇒ 零 CI 分片风险） |
| 行尾与 diff 对账 | ✅ | **两口径一致**：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐字一致**（11 个文件）。⚠ **合计数与本记录自身的增删互为自指**（改这一行就会改变它）⇒ **精确合计与逐文件读数以 PR 评论的合并前实跑为准**；这里只给**不自指**的部分。逐文件（不含本记录）：PRD +128/−11、`auto-plan.js` +15/−24、`auto-project.js` +19/−1、`auto-runner.js` +6/−2、`video-gen.js` +5/−2、`shot-effective-seconds.js` +126（新增）、`auto-plan-duration.test.js` +196、`auto-project.test.js` +32、`auto-runner.test.js` +64、`video-gen.test.js` +26。⚠ **删除数归因（40 行删除，逐条可核）**：`auto-plan.js` −24 = 被搬进新模块的**时长决策块**（`resolveShotDurationMs(...)` 调用块 20 行 + 档位表解析 4 行）；`auto-runner.js` / `video-gen.js` 各 −2 = 两处 `seconds:` 旧表达式（各 1 行）；`auto-project.js` −1 = 被替换的 `seconds:` 那行（改为「改整档时清镜长」）；PRD −11 = 4 处订正**替换**掉的老表述（版本号 1 + §0.2 1 + 六层地基图 2 + §3.2.3 4 + §3.2.6 1 + `isConnectFailure` 边界 2 = 11）⇒ 其中 2 行是**替换**（`UND_ERR_SOCKET` 边界申报**保留**，不是删除） |
| 接线棘轮 | ✅ | **未新增测试文件** ⇒ 三个测试文件都是**既有文件追加用例** ⇒ 接线棘轮**不适用**（无需在 workflow 里点名）；实测 `node scripts/check-unwired-tests.js` rc=0（PASS：全部测试均已接线或按欠账登记） |
| 逐文件行数门禁（`check-max-lines`） | ✅ | 本轮**被门禁当场抓过一次**并按正解处置：初版提交后报 `NEW_OVER_LIMIT: auto-plan.js 517 行 >= 500` ⇒ 回头量基线才发现**改动前已 497 行**（离上限只差 3）⇒ 按仓内纪律**抽模块、不抬基线**（新增 `shot-effective-seconds.js` 126 行；`auto-plan.js` 516 → **488**，余量 12）⇒ 复跑 rc=0 |
| ESLint | ✅ | CI 同款命令 `eslint electron/ src/ --quiet` ⇒ **rc=0**（0 error）。⚠️ 教训来源：本仓上一片曾因「本地门禁清单里没有 eslint」而在首轮 CI 才红 ⇒ 此后凡改 Electron/Vue 代码，eslint 必进本地清单 |
| 本地门禁（10 道） | ✅ | `check-max-lines` / `check-gate-record-debt` / `check-no-brand-residue` / `check-doc-abs-paths --all` / `check-text-encoding-integrity` / `check-unwired-tests` / `classify-docs-only --base --head` / `check-pr-exec-record --base --head --mode=enforce` / `check-record-qm5-rows --base` / `check-locale-sync --symmetry` ⇒ **全 rc=0**（rebase 到新 main 后重跑 7 道，其余 3 道先前已绿） |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 本片**未触渲染面**：改动全在 electron 服务层（`film-engineering/*`）+ 两份 Markdown ⇒ 无 Vue / 样式 / 像素基线变更 ⇒ QM-1（打包）与 QM-4（视觉基线）**不适用**（不是「跳过」） |
| QM-6 CCG 双模型外部评审 | ⚠️ 未执行（如实记录） | 本沙箱**无 `codeagent-wrapper`**、无 `~/.claude/.ccg/config.toml` ⇒ 无法执行双模型外部评审。**不以内部自审冒充通过**。替代证据：① 变异反证 **8 组全部被抓住**；② 独立复核会话（Verifier，`456251738357834`）逐条回源码核对 ⇒ 结论见下节；③ 本记录 QM-5 五步 + 两轮自查。⚠️ 本变更集**未命中** `HIGH_RISK_SURFACES`（未改凭证加解密 / 登录态串行锁 / 云端账号校验 / 判据自指面 / workflow） |
| 独立复核 | ✅ **首轮 FAIL ⇒ 四项全部处置 ⇒ 修复后由生产者自造端到端探针复验 PASS** | Verifier 会话 `456251738357834`（只读复核，全程 `git status` 为空）**首轮判 FAIL**，抓出一个**真阻断**：**B1 `effectiveSeconds` 从未到达出片消费端**（`auto-project.js:211-233` 的**落盘白名单**不透传 ⇒ 规划期算出 8、落盘后 `undefined`、出片仍按 10 ⇒ **本 PR 在自动模式是 no-op**）；另有 B2（PRD 四处把未验证写成已验证）/ B3（根因误诊）/ B4（测试无法区分「接线」与「死字段」）。⇒ **四项全部处置**：落盘白名单透传 + 改整档时清镜长 + 补**走真链路**的端到端断言 + PRD/记录逐处订正。⇒ 复核方已核实：抽模块逐字等价（384 组输入零差异）、存量行为逐字一致、A47 真锁消费端、无恒真断言、变异读数与本记录一致。⚠ **修复后的端到端复验读数（生产者自造探针，不依赖复核方）**：<br>`[plan.shots[0]] effectiveSeconds=8` → `[project.shots[0]] effectiveSeconds=8`（传输层活着）→ `[出片收到的 seconds] [{"index":0,"seconds":8}]` ⇒ **期望 8 / 实得 8 ⇒ PASS** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并前把这行状态列写成 `PASS` 会被判「预写不存在的证据」而红。旧载体 `.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json` 按「旧载体冻结」政策**零改写**；`CHANGELOG.md` 按 `changelog-record-carrier` 合同**零改动**（台账搬运由 `scripts/aggregate-changelog.js` 统一做） |

### ⭐ 同型排查：这条链路上还有别的「白名单式丢失」吗（复核方第 7 问）

**排查方法**：脚本化对比 `auto-plan.js` 的 `shots.map` 产出字段 vs `auto-project.js` 的落盘白名单。

```
plan 侧 shot 字段（16）：index, shotId, beatIndex, title, imagePrompt, videoPrompt, endFramePrompt,
                        characterNames, seconds, durationMs, durationSec, durationSource,
                        durationRawSec, capacitySec, durationWarnings, status
落盘白名单（18）：      …… + effectiveSeconds（本片新增）
⚠ plan 产出但未落盘：  durationMs, durationSec, durationSource, durationRawSec, capacitySec, durationWarnings
```

⇒ 逐个查这 6 个字段**落盘后有没有消费方**：

| 字段 | 落盘后有消费方吗 | 结论 |
|---|---|---|
| `durationMs` / `durationSec` / `durationSource` / `durationRawSec` | ❌ 无 | **存量死字段**（v7 批次一落的）；测试注释写「便于调用方展示吸附落差」⇒ **那个调用方并不存在** ⇒ 已登记为遗留项 |
| `capacitySec` | ❌ 无 | 只在 `shot-duration.js` 的计算里用（`auto-plan.js` 传入）⇒ 落盘后无消费方 ⇒ 无影响 |
| `durationWarnings` | ❌ 无 | ⚠ 但**用户看得见**——v7 对抗评审 i1 已把逐镜警告**聚合成 plan 级**（`plan.warnings`）⇒ 逐镜那份只是明细 ⇒ 落盘与否**不影响用户可见性** |

⇒ ⭐ **结论**：这条链路上**没有第二个「用户可见的死字段」** ⇒ 本片只需透传 `effectiveSeconds` 一个
⇒ ⇒ 那个「死字段」不是「一串」，而是**一个**（外加 4 个无人消费的存量字段）⇒ **范围是收敛的**。

### 遗留（不假装已闭合）

- **A33**（进度提示区分「执行中 / 已收口」）与 **M0.4**（音轨能力表）未做 ⇒ 下一片。
- **M0′.3.1**（12 秒档三处入口）未做 ⇒ 12 秒档仍不可达。
- **`plannedDurationSec` 与出片实际总时长**的口径差 ≤ 一个档位/镜 ⇒ M1 统一。
- **仓内两套档位表**（规划期 [5,8,10,12] vs 用户可选 [5,8,10]）⇒ 本片只如实记录，未统一。
- ⚠ **`durationMs` / `durationSec` / `durationRawSec` / `durationSource` 四个字段至今仍未落盘**
  （v7 批次一落的**存量死字段**）⇒ 本片只修 `effectiveSeconds` 这一条通路，其余**不代改**（改了会动 project.json 形状）。
- ⚠ **人工改整档后不会重跑容量校验**：容量 fail-closed（台词念不完即规划失败）**只在规划期跑**；
  人工把整档调大（如 5 → 10 秒）后，台词可能念不完而**没有任何拦阻** ⇒ 这是**既有行为**
  （改 `seconds` 本来就不校验容量），本片不引入、也不代改。
- ⚠ **全量出片路径不在本片范围**：其分镜来自 kit 的 `shot-library.json`（**无** `seconds` / `effectiveSeconds`）
  ⇒ 那条路径**拿不到**逐镜镜长 ⇒ 仍按 stage 级整档走。
- ⚠ **生产与剧本路径的 3 处 `generateShotVideo` 调用点**（`production-runner.js` /
  `film-engineering-production.js` / `film-engineering.js`）同因不在本片范围。

## 1. 本次产出

| # | 任务 | 状态 | 落点 |
|---|---|---|---|
| 1 | 规划期给每镜产出 `effectiveSeconds`（**原始推算值吸附到可选档位**后的秒数） | ✅ 已落地 | `film-engineering/auto-plan.js` |
| 2 | 自动模式出片**消费** `effectiveSeconds` | ✅ 已落地 | `film-engineering/auto-runner.js`（批执行 + 单镜重生成，两处） |
| 3 | 全量出片路径**逐镜**消费 `effectiveSeconds` | ✅ 已落地 | `film-engineering/video-gen.js`（stage 执行 + 降级串行，两处） |
| 4 | 回归保护（A45–A47） | ✅ 已落地 | `auto-plan-duration.test.js` / `auto-runner.test.js` / `video-gen.test.js` |
| 5 | **抽模块**：逐镜镜长的**唯一决策点** | ✅ 已落地 | 新建 `film-engineering/shot-effective-seconds.js`（126 行） |
| 6 | ⭐ **传输层**：落盘白名单透传 `effectiveSeconds` | ✅ 已落地 | `film-engineering/auto-project.js`（`createProject` 的逐字段白名单 + `touchShot`） |
| 7 | 人工改整档时**清掉**逐镜吸附镜长 | ✅ 已落地 | `film-engineering/auto-project.js`（`touchShot`） |
| 8 | **端到端断言**（走真落盘链路） | ✅ 已落地 | `auto-plan-duration.test.js`（`planAutoShots` → `createProject` → `runAutoBatch`） |

⚠ **纯增量**：`shot.seconds`（用户所选档位）、`shot.durationSec` / `durationRawSec` / `durationSource`（来源链解析结果）
**语义全部不动** ⇒ 既有消费方零影响；存量项目（没有 `effectiveSeconds`）**出片行为逐字不变**。

## 2. QM-5 Bug 反思循环（5 步）

### 2.1 找到第一性原因

**现象**：用户选 10 秒档、某镜台词 50 字（推算 6.25s ⇒ 吸附到 8 秒档）⇒
**出片仍按 10 秒走** ⇒ 后 4 秒是空场。

**第一性引入点（初版判断）**：`auto-plan.js` 的逐镜时长增量（v7 批次一 F2/F34）只写了
`durationMs` / `durationSec` / `durationSource` / `durationRawSec`，
**但没有任何消费方去读它们** ⇒ 出片仍走 `shot.seconds`。

> ⚠⚠ **这个判断被独立复核实测推翻并改判（2026-10-25 晚）**：
> 真因**不是**「规划期算了没人读」，而是 **`auto-project.js` 的落盘白名单不透传**。
> 出片消费端读的是 **`project.shots`**，而 `plan.shots` 的唯一下游就是
> `createProject` 的 `plan.shots.map(...)` **逐字段白名单** ⇒
> ⇒ **白名单里没有的字段，在传输层被丢掉** ⇒ 消费端恒读到 `undefined`。
> ⇒ 且**既有的** `durationMs` / `durationSec` / `durationRawSec` / `durationSource`
> **同样死在白名单上** ⇒ 它们才是真正的**存量死字段**。
> ⇒ ⚠ **我初版只加「生产者字段」+「消费者读取」，中间隔着的传输层没动**
> ⇒ ⇒ **复现了同一个死字段形态**（自己总结的教训原样重演）。
⇒ 注释里那句「消费方可以继续只读 seconds；需要更细的时长就读 durationMs」
**描述的是一个并不存在的消费方** ⇒ 字段加了、链路没接。

### 2.2 追溯测试逃逸（为什么没被测出来）

| 既有覆盖 | 实际断言了什么 | 为什么漏 |
|---|---|---|
| `auto-plan-duration.test.js`「每镜都带 durationMs / durationSec / durationSource」 | **规划期**的字段存在性与取值 | ⭐ **只断言「字段算出来了」，没断言「出片用了它」** ⇒ 字段可以是**死字段** |
| `auto-runner.test.js`「逐镜把 project.json 的 prompt/seconds 传给生成函数」 | 传的是 `shot.seconds` | ⭐ 它**把旧行为当成了正确行为**固化下来 |
| `video-gen.test.js` 的提交载荷断言 | 帧数按 stage 级 `seconds` 映射 | 同上：**把 stage 级当成逐镜口径** |
| （**初版 A46**）出片收到的 `seconds` = 该镜 `effectiveSeconds` | **在 `project.shots` 上手工塞** `effectiveSeconds = 8` | ⭐⭐ **恰好绕开唯一丢字段的地方**（`createProject` 的落盘白名单）⇒ **125 个测试对真实链路完全失明** |

⇒ **形态（初版）**：新增字段的测试只覆盖「生产端」，不覆盖「消费端」⇒
字段**可以完全不被消费**而全套测试仍绿。
⇒ **形态（复核后修正）**：只覆盖「生产端 + 消费端」**仍然不够** ——
**生产端与消费端之间还隔着传输层**（本片是 `createProject` 的落盘白名单），
而那一步**没人测** ⇒ ⇒ 字段可以在传输层被吞掉，而**首尾两端**的断言都绿。
⇒ ⇒ 与「新增叶子模块单测全绿 ≠ 已接线」同型，且**更隐蔽**：
叶子模块接上了，但**没接在链路上**。
⇒ 这与我记忆里那条「新增叶子模块单测全绿 ≠ 已接线」**同型**（只是方向相反：这次是叶子字段没人接）。

### 2.3 识别系统性漏洞

1. **字段没有「消费方契约」**：规划期产出多少字段，出片层就该声明消费哪些；
   没人声明 ⇒ 没人接。⇒ 本次用**一个显式字段 + 四处同一口径的回落链**把契约写死。
2. ⭐ **`durationSec` 的语义随来源变**（`formula`/`tier` 是档位值，`tts`/`user` 是连续值）
   ⇒ **同一个字段在不同分支下类型/量纲不同** ⇒ 谁按「它是个秒数」直接用都可能出错
   （连续值 5.3 交给 `pickFilmFrameCount` ⇒ 落进「≤8 ⇒ 201 帧 ⇒ **8 秒**」⇒ **镜长被放大**）。
   ⇒ 本次的处理：**统一从 `rawSec` 吸附** ⇒ 与来源无关 ⇒ 结果恒为档位表之一。
3. ⭐ **「同一口径」要落到代码，而不只是落到文档**：先在四个消费点各写一遍回落链
   ⇒ 后面抽模块时把它**收敛成一个 helper**（`resolveShotSeconds`）⇒ 四个调用点共用。
   ⚠ **范围要写清**：全仓 `generateShotVideo` 共 **7 处**调用点，另 3 处属生产/剧本路径
   （分镜来自 kit，**拿不到**逐镜镜长）⇒ 准确说法是「**本片覆盖的四个调用点**同一口径」。
4. ⭐⭐ **「生产者 → 消费者」之间可能隔着第三段链路，而那一段没人测**：
   本片的链路是 `plan.shots` → `createProject` → `project.shots` → `auto-runner`，共**三段**；
   我初版只测了首尾两段 ⇒ ⇒ **中间那一段（落盘白名单）把字段吞了，而全套测试仍绿**。
   ⇒ 判据：**「字段被算出来」+「消费端读了它」**这两条**中间**必须有断言，
   或者直接写一条**走真链路**的端到端断言。

### 2.4 修复 + 回归保护测试

| 编号 | 判据 | 落点 |
|---|---|---|
| **A45** | 每镜 `effectiveSeconds` ∈ **规划期档位表**（默认 [5,8,10,12]；⚠ 自动路径因容量 fail-closed 先拦 ⇒ 实际只到 {5,8,10}）；用户选 10 秒档 + 50 字台词 ⇒ `effectiveSeconds === 8` 且 `< shot.seconds` | `auto-plan-duration.test.js` |
| **A46** | ⭐ **经真链路**（`planAutoShots` → `createProject` 落盘 → `runAutoBatch`）出片**收到**的 `seconds` = 该镜 `effectiveSeconds`；没有该字段 ⇒ 回落 `shot.seconds`（存量行为不变） | `auto-plan-duration.test.js`（端到端）+ `auto-runner.test.js`（回落链） |
| **A47** | 全量出片路径**在镜带 `effectiveSeconds` 时**逐镜消费（8 秒档 ⇒ **201 帧**，非 stage 级 10 秒 ⇒ 241 帧）；⚠ 真实 kit 分镜**没有**该字段 ⇒ 实际仍按 stage 级（边界如实记录） | `video-gen.test.js` |

⇒ **每条都配了变异对照**（注进去必红、还原后必绿）。
⚠ 下表是**最终形态**（含传输层修复）的一组读数；抽模块前/中那几组的读数更低，
因为当时**端到端断言还不存在** ⇒ ⇒ ⭐ **这本身就是「回归网变密」的证据**。

| 变异 | 读数 |
|---|---|
| M-A `computeEffectiveSeconds` 不吸附（直接返回 `rawSec`） | **7 红** |
| M-B `resolveShotSeconds` 去掉 `effectiveSeconds` | **4 红** |
| M-C 回落链顺序反转（`shot.seconds` 优先） | **3 红** |
| M-D `auto-runner` 改回 `shot.seconds`（不再走 helper） | **2 红** |
| ⭐ **M-E（关键·复核方指定）落盘白名单不透传 `effectiveSeconds`** | **4 红**（端到端断言抓住） |
| ⭐ **M-F 改整档 `seconds` 时不清 `effectiveSeconds`** | **1 红** |

⇒ 抽模块前/中那三组（`effectiveSeconds` 回落成用户档位 1 红 / 吸附目标改成只有用户所选档位 3 红 /
`auto-runner` 回落链去掉 `effectiveSeconds` 4 红 / `video-gen` 生产路径去掉逐镜消费 5 红）
在最终形态下**读数更高**（因为断言变密了）⇒ ⇒ 回归网**只增不减**。

⚠ **一次变异脚本超时被中断 ⇒ 本地盘停在变异态 ⇒ 下一轮「备份」备份的是污染版
⇒ 连基线都红（8 红）却一度以为是实现坏了**。
⇒ 修法：**变异后从真源重新同步**，不要从本地备份还原；
且**还原后逐字节核对**（`cmp`）—— 比对的对象必须是**真源**。

### 2.5 防止再次发生的具体系统性措施

| # | 措施 | 落点 |
|---|---|---|
| 1 | **消费方契约写进字段名**：`effectiveSeconds` 语义单一（永远是「可选档位之一」），消费方不需要知道来源 | `auto-plan.js` + 四个消费点 |
| 2 | **来源差异在生产端吸收**：吸附只从 `rawSec` 做 ⇒ 不把「来源不同 ⇒ 量纲不同」的坑推给消费方 | `auto-plan.js` |
| 3 | **回落链四处同口径**：`effectiveSeconds → shot.seconds → project.seconds → 5` | `auto-runner.js` ×2 / `video-gen.js` ×2 |
| 4 | **存量行为用测试钉住**（A46/A47 各有一条「没有该字段 ⇒ 行为不变」）⇒ 纯增量这条性质**可回归** | 三个测试文件 |
| 5 | ⭐⭐ **传输层契约显式化**：新增字段必须**同时**出现在「生产者」「**传输层白名单**」「消费者」三处 ⇒ 三处缺一即死字段 | `auto-plan.js` / `auto-project.js` / `auto-runner.js` + `video-gen.js` |
| 6 | ⭐ **端到端断言走真链路**：不许在**下游边界手工塞字段**来「证明消费端读到了」⇒ 必须走 `planAutoShots` → `createProject` → `runAutoBatch` | `auto-plan-duration.test.js` |
| 7 | ⭐ **改整档时清掉逐镜吸附镜长**（用户显式选择优先于系统推导）⇒ 保住「镜长只减不增」 | `auto-project.js`（`touchShot`） |

## 3. 验证证据

| 项 | 读数 |
|---|---|
| 本地相关测试 | **146/146** 全绿（`auto-plan` 49 + `auto-plan-duration` **26** + `auto-runner` 27 + `video-gen` 25 + `auto-project` **19**） |
| 变异 | **6 组全部被抓住**（最终形态，见 §2.4）；抽模块前/中另有 4 组也已验证 |
| 行数 | `auto-plan.js` 516 → **488**（抽模块后，门禁计数 489，余量 12） |
| 本地门禁 | **10 道**全 `rc=0`（清单见本文件开头的「本地门禁（10 道）」行；⚠ 早先写「9 道（见 §5）」是**引用断链**，已改） |

## 4. 过程中被真实语义逮住的一个坑

⚠ **模块级观测窗口跨用例污染**（与 #4446 的「跨任务污染」同源）：
我新加的 `auto-runner` 用例**继承了上一组用例留下的「饱和」状态**
⇒ 触发真等（最长 5 分钟）⇒ 用例挂满 10s 超时。
⇒ 修法：每例前 `resetProviderSaturation('minimax')` + 注入 `_testSleep` 兜底。
⇒ ⭐ 这条同时说明：**「模块级单例」在测试与生产两侧都要有明确的生命周期边界**
（生产侧 = `auto-start` 重置，已在 #4446 落地；测试侧 = `beforeEach` 重置）。

## 5. 诚实边界

- ⚠ **本片只解决「镜长虚高」**（台词短的镜被撑长）；
  **不解决**「台词念不完」—— 那个由 M0′.2 的容量 fail-closed 在**规划期**拦（超容差即规划失败）。
- ⚠ **吸附容差内的轻微超出仍可能念不完**：`snapToTier` 明确接受「内容比档位多 toleranceSec 以内」
  ⇒ 既有设计明确接受的形态，本片不动。
- ⚠ **`plannedDurationSec` 与出片实际总时长可能相差 ≤ 一个档位/镜**（汇总用 `durationMs`，出片用吸附后的
  `effectiveSeconds`）⇒ 已登记为 M1 的时长预估口径待统一项。
- ⚠ **12 秒档仍未放开**（`AUTO_SHOT_SECONDS = [5, 8, 10]`）⇒ M0′.3.1 遗留项，本片不动。
- ⚠ **A33（进度提示区分执行中/已收口）与 M0.4（音轨能力表）未做** ⇒ 已登记为下一片。
- ⚠ **仓内有两套档位表**：规划期档位表（`shot-duration.js` 的 `DEFAULT_TIERS`）= **[5,8,10,12]**，
  用户可选档位（`AUTO_SHOT_SECONDS`）= **[5,8,10]** ⇒ **`effectiveSeconds` 可能算出 12**（用户选不了）。
  出片端 `pickFilmFrameCount(12)` = 289 帧（存在 ⇒ 链路自洽），
  但「用户能不能选 12」与「规划期该不该算到 12」是**两个问题** ⇒ 本片只如实记录，不统一。
- ⚠ **抽模块是被迫但正确的**：`auto-plan.js` 改动前已 497 行（离 500 行硬上限只差 3）
  ⇒ 任何净增都会触发 `check-max-lines` 的 `NEW_OVER_LIMIT`
  ⇒ 按仓内纪律**抽模块、不抬基线**（顺带把「四处各写一遍回落链」收敛成一个 helper）。

## CHANGELOG 条目

# feat(影视工程): 自动模式出片按每镜台词的实际长度出片，不再一律用用户选的整档（film-auto-shot-duration）

- 规划期按每镜台词算出的时长此前**算了但没被出片消费** ⇒ 用户选 10 秒档、某镜台词只够 6 秒时，成片仍出 10 秒，后半段是空场。现在出片按该镜**吸附到可选档位**后的实际长度走（如 8 秒），画面紧凑。
- 镜长口径在**自动模式与全量出片两条路径上统一**（此前全量出片一律用整批的档位）。
- 纯增量：用户选的档位、规划期的时长来源链、以及存量项目的出片行为**全部不变**。
- 顺带修掉一处「规划期算出的时长是死字段」的问题：现在有一个明确的字段被出片消费，并有回归测试锁住消费端（此前只有测试锁「字段算出来了」）。
- ⚠ 同时修掉**传输层**的一处断点：逐镜镜长此前在「落盘」这一步被字段白名单丢掉 ⇒ 规划期算出的镜长到不了出片端；现在它会随项目落盘，并有一条走完整链路的回归断言。
- 逐镜镜长的口径收进一个独立模块（`shot-effective-seconds.js`），四处调用点共用同一份回落链。

## learnings

### lesson: ⭐⭐ 「生产者接了 + 消费者接了」中间还可能隔着第三段链路（film-auto-shot-duration）

**现场**：逐镜镜长 `effectiveSeconds` 在规划期算出来了、在出片端也读了，
**中间隔着 `createProject` 的落盘白名单** ⇒ 字段在**传输层**被丢掉 ⇒
⇒ 规划期算出 8、落盘后 `undefined`、出片仍按 10 秒走 ⇒ **整个改动是 no-op**。
⇒ 而当时 **125 个测试全绿**。

**根因**：我测了「生产端产出」+「消费端读到」，**唯独没测两者之间那一段**。
⇒ 更隐蔽的是：初版的 A46 是在 `project.shots` 上**手工塞** `effectiveSeconds = 8`
⇒ **恰好绕开唯一丢字段的地方** ⇒ 「看起来测了消费端」。

**可复用的判据**：

1. ⭐ **新增字段必须同时出现在三处：生产者、传输层（白名单/序列化/落盘）、消费者** ⇒ 缺一即死字段。
   ⇒ 尤其要问「**这个字段从生产者到消费者，中间经过几次转换？每次转换是不是白名单式的？**」
2. ⭐ **端到端断言不许在下游边界手工塞字段** ⇒ 必须走真实链路
   （`planAutoShots` → `createProject` → `runAutoBatch`）⇒ 否则断言会「绕开缺陷」而非「抓住缺陷」。
3. ⭐ **变异验证要覆盖传输层**：注入「不透传」这个变异 ⇒ 如果全套测试仍绿 ⇒ 你的回归网有洞。
   （本片复核方指定的 M-E 就是这个变异 ⇒ 补上后 4 条用例立刻红。）

### lesson: 新增字段的测试只覆盖「生产端」，字段可以完全不被消费（film-auto-shot-duration）

**现场**：给自动模式加「出片按每镜台词实际长度走」时发现，逐镜时长字段（`durationMs` / `durationSec` /
`durationRawSec`）**在规划期早就算好了**（v7 批次一 F2/F34 落的），
但**没有任何消费方**去读它们 ⇒ 出片一直用用户选的整档 ⇒ 台词短的镜被撑长、后半段空场。

**根因**：既有测试断言的是「每镜都带 durationMs / durationSec / durationSource」
—— 只覆盖了**生产端**；**消费端**（出片用哪个值）被另一条测试**当成正确行为固化了**
（`auto-runner.test.js` 断言「逐镜把 seconds 传给生成函数」——而那个 `seconds` 正是要改的值）。

**可复用的判据**：

1. ⭐ **给任何新字段补测试时，必须有一条断言「**它被谁读了**」**，
   而不是只断言「它被算出来了」⇒ 后者允许它是**死字段**而全套测试仍绿。
   （与「新增叶子模块单测全绿 ≠ 已接线」同型，只是方向相反：那次是叶子模块没人接，这次是叶子字段没人接。）
2. ⭐ **既有测试可能把旧行为当成了正确行为** ⇒ 改契约时，
   要逐条问「这条断言锁的是**业务意图**还是**当前实现**」⇒ 锁实现的那条要**改输入**而不是删断言。
3. ⭐ **同一个字段在不同来源下量纲可能不同**（本例：`durationSec` 在 `formula`/`tier` 是档位值，
   在 `tts`/`user` 是连续值）⇒ **来源差异必须在生产端吸收**（统一从 `rawSec` 吸附），
   **不要推给消费方**——否则连续值 5.3 会被帧数映射放大成 8 秒（比原状更糟）。

### lesson: 模块级单例在测试与生产两侧都要有明确的生命周期边界（film-auto-shot-duration）

**现场**：新加的批执行用例**继承了上一组用例留下的「provider 饱和」状态**
⇒ 触发真实等待（最长 5 分钟）⇒ 用例挂满 10 秒超时，看着像「实现卡死」。

**根因**：饱和度观测窗口是**模块级**的（进程内共享）⇒ 与上一片（#4446）的「跨任务污染」**同源**：
上一轮任务留下的失败记录会让**新任务第一镜**就判饱和。

**判据**：凡是模块级单例（观测窗口、缓存、限流计数），必须同时回答两个问题：
① **生产侧**的生命周期边界在哪（本次 = `auto-start` 重置）；
② **测试侧**怎么隔离（本次 = `beforeEach` 重置 + 注入可控等待）。
⇒ 漏掉 ② 时症状是「用例莫名超时」，很容易被误判成「实现有问题」或「环境慢」。

### lesson: 要改的文件只剩 3 行余量时，先量基线再动手（film-auto-shot-duration）

**现场**：给 `auto-plan.js` 加「出片消费逐镜镜长」⇒ 提交后 `check-max-lines` 报
`NEW_OVER_LIMIT: auto-plan.js 517 行 >= 500` ⇒ 差 17 行。
⇒ 回头量基线：**改动前 497 行** ⇒ 离 500 行的硬上限**只差 3 行** ⇒ **任何净增都会红**。

**根因**：`check-max-lines` 是**逐文件**硬约束 ⇒ 一个「已经贴脸」的文件，
**每加一个字段都要付出「抽模块」的代价** ⇒ 而这件事在动手前是**可以预知**的。

**判据**：

1. ⭐ **改大文件前先量基线余量**（`wc -l` 当前文件 vs 门禁上限）⇒
   余量 < 预计增量 ⇒ **直接按「要抽模块」设计**，而不是先写完再撞墙。
   ⇒ 本仓的 500 行是**逐文件**、**容差 0** 的 ⇒ 贴脸文件的余量是**一行动作**级。
2. ⭐ **抽模块时顺手把「口径」收敛**：这次把「四处各写一遍回落链」收敛成一个 helper
   ⇒ 抽模块不只是搬代码，还消掉了「四处要同步改」这个隐患。
3. ⚠ **搬代码 ≠ 改行为**：抽模块时把 `DEFAULT_TIERS` 的 import 一起搬走 ⇒ 立刻
   `ReferenceError: DEFAULT_DURATION_TIERS is not defined` ⇒ 抽完**必须真跑**，
   「文件行数对上了」不等于「跑得起来」。

### lesson: 变异脚本中断后，本地盘会停在变异态；还原要从真源同步（film-auto-shot-duration）

**现场**：变异脚本跑到一半**超时被中断** ⇒ 本地盘的 `shot-effective-seconds.js` 停在「不吸附」变异态。
⇒ 下一轮脚本开头做「备份」⇒ **备份的是污染版** ⇒ 每个变异「还原后」都还是污染态
⇒ **连基线都红**（8 红）⇒ 一度以为是实现坏了。

**判据**：

1. ⭐ **变异/改动的还原基准必须是「真源」，不是「本地上一版」** ⇒
   每次改完从真源重新同步，再跑。
2. ⭐ **「基线红」是「环境被污染」的第一嫌疑** ⇒ 变异脚本里**基线必须单独跑一次**并记录读数，
   基线红 ⇒ 先查环境，再查实现。
3. ⭐ **还原后要逐字节核对，且比对对象是「真源」** ⇒ 对着被污染的备份 `cmp` 会给出「一致」的假象。

