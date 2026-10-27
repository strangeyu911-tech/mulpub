---
record: explainer-approval-gates
task: AI 讲解视频补齐上游的人工审批门（五道门 + 类型化载荷 + 批准/驳回 + G1 渲染引擎显式选择）
date: 2026-10-25
branch: explainer-approval-gates
---

## 本次执行记录：人工审批门（explainer-approval-gates，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（Electron 主进程 + Vue 渲染层）：隔离 worktree（NAS 非 C 盘路径）+ 裸分支 `explainer-approval-gates`；主仓未改一行工作区文件 |
| 第一性原因（QM-5 ①） | PASS | 上游 OpenMontage 的 `pipeline_defs/animated-explainer.yaml`（blob `bd17a1975214077c74b6ebc8fb68ad18eaf331ed`）里 `human_approval_default: true` 的阶段**恰好 5 个**；本仓 `pipeline-engine.js` 的 explainer `stageDefs` **8 个阶段全是 `checkpointRequired: false`** ⇒ 机制整段缺失，不是某处漏接。仓内 `packages/python-backend/.../animated-explainer.yaml` 是上游的**过期副本**（把 assets 写成 false）且桌面端从不读 YAML ⇒ 不是真源 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链：① 上游 yaml 只被当「阶段名 + 顺序 + playbook 默认值」的来源，没有把 `checkpoint_required` / `human_approval_default` 落到 `stageDefs`；② 本仓唯一的 checkpoint 消费者是影视工程的 `cost_confirm` 入口闸，与 explainer 无关；③ `CreateView.vue` 的 `showOrchestrationCheckpoint` 是**只读进度弹窗**（`pipelineRunStatus.checkpoint` 只用于显示），**没有任何批准/驳回出口** ⇒ 「看着像有门」实则拦不住任何东西；④ 仓内已有 `pipeline-engine.js` 的 `confirmStageGate` + `checkpointRequired` 机制，**有能力但没接线** ⇒ 测试全绿、CI 全绿也不构成保护 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 `apps/desktop/electron/services/explainer/explainer-approval-gates.js`（门定义 + 类型化载荷 + 批准/驳回）；新增测试 `explainer-approval-gates.test.js`（23 例，含 4 条**契约锁**：五门 `checkpointRequired` 值、`pipelineEngine._runs` 跨模块访问、locale 条数、渲染层默认策略）；`pipeline-engine.js` **只改 5 个字符串值**（零行增长）；新增 3 个 IPC + preload 暴露面 + publisher 导出 + 渲染层组件。**本地实测**：eslint 全量（CI 同款）rc=0；explainer 目录 201/201 + 本文件 23/23 + `preload.test.js` 383/383；**变异验证 4/4 全部被抓住**（改回某门 `checkpointRequired` / 去掉 G1 runtime 必填校验 / 删 locale 一条 focus / 别的生产文件加一处 `pipelineEngine._runs`），每个变异恢复后基线 rc=0。**第四轮补**：新增 `apps/desktop/electron/services/explainer/explainer-gate-reuse.test.js`（9 例，覆盖「门批准后复用产物」）+ `explainer-stages.js` 的 `withGateReuse` 包装层；**变异验证 4/4 全部被抓住**（去掉复用短路 / `=== true` 改成 `!== true` / 拿错产物 / 门阶段清单少一个），每个变异用**唯一锚点**注入并**自检已生效**，恢复后基线 rc=0。**第五轮补**：新增 `explainer-render-runtime-intent.js`（渲染意图纯函数）+ 同名测试（8 例）+ **接线锁**（只扫代码行，断言「真的 require / 真的调用 / 判据恰好一份且形态精确 / `requested` 取自意图」）；`explainer-review-stages.js` 接线并把 `render_runtime_requested` 语义统一为「本次请求的 runtime = 渲染意图（恒有值）」；**变异验证 5/5 全部被抓住**（删掉接线 / 加第二份 inline 判据 / 去掉 `source` 检查 / 改回 `.trim()` / `requested` 硬编码），每个变异用**唯一锚点**注入、注入后 `diff` 自检已生效、用**绝对路径**恢复并 `cmp` 逐字节核对，恢复后基线 rc=0 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **口径只在主进程**：门集合、载荷形状（上游 `checkpoint.schema.json` 逐字）、runtime 写回 proposal 的组装逻辑全在主进程模块，渲染层不硬编码门名单、不拼 contextPatch；② **零容差主文件不加行**：`pipeline-engine.js`（target 2776 / 现 2776 / 容差 0）与 `container.setup.js`（499 / 上限 500 且门禁口径 `lines >= limit`）都不动，驳回与门载荷读取挂到有余量的 `ipc-handlers/pipeline.js`（410 → 446）；③ **契约锁钉住退化面**（见上一行）；④ **禁止静默默认**：G1 未显式选渲染引擎 ⇒ 批准被拒（`INVALID_RENDER_RUNTIME`），「高亮推荐」不等于「已选中」 |
| 行尾与 diff 对账 | PASS | 提交后**逐文件内容级核对**（`git show HEAD:<f> | cmp -s - <f>`）ALL MATCH；`pipeline-engine.js` 的 diff 形状 = 5 增 5 删（同一行改值），行数 2776 → 2776 **未变**；`CreateView.vue` 5359 → 5420（target 5656 / 零容差，余 236 行）；`ipc-handlers/pipeline.js` 410 → 446（上限 500）；新增文件与 locale 改动的 `git diff --numstat` 两口径一致；全部改动文件 U+FFFD 计数 = 0 |
| 接线棘轮 | PASS | 新增测试落在 `apps/` 下 ⇒ 由 vitest 按 workspace 自动收集（`scripts/check-unwired-tests.js` 的 `WORKSPACE_COVERED` 含 `apps/`）⇒ 不属于「没人点名」那一类 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面：本次改的是 Electron 主进程流程 + 新增弹窗组件，未改既有页面布局/样式基线；新组件为独立文件，无像素基线可比 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper` ⇒ 如实记「未执行」，不以自审冒充通过；改以「契约锁 + 变异验证」补位（见「逃逸分析」与「遗留」） |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属 |

### 首轮 CI 红的处置（2026-10-25 第二轮）

首轮 `QG Static` 红（eslint `no-unreachable`）。本地复核连抓四个问题并逐个修掉：

1. **`syncApprovalGate()` 被插在 catch 块之后** ⇒ try/catch 全路径都 return ⇒ 不可达。
   修法：移进 try 块内、状态刷新之后并 `await`。
2. **新测试用 CJS 的 `require('vitest')`** ⇒ vitest 4 报「cannot be imported in a CommonJS
   module」⇒ 整个文件 0 用例。修法：照抄仓内既有范式（`import` + `createRequire`），
   并显式补出 ESM 里不存在的 `__filename` / `__dirname`。
3. **`_runs` 跨模块锁判据太宽**（用「两个词分别出现」判）⇒ 误报既有文件。修法：只认具体形态
   `pipelineEngine._runs` + 剥注释 + 排除测试文件 + 加反向断言（本模块确实访问了它）。
4. **主干自红**：`check-gate-record-debt.js` 判 7 篇「声明的来源 PR 与主干事实不符」。
   **对照实验**：干净 `origin/main` 检出上跑同一命令 ⇒ 同样红、同样 7 篇 ⇒ 主干级存量、与本片无关。
   根因：`b3ed49d4`（#4301，一个 `fix(toutiao)` 的**代码** PR）把这 7 篇记录文件夹带进了主干。
   ⚠️ **我一度按判据输出的真值把那 7 篇的 `delivered_by_pr` 对齐为 4301（只改 frontmatter 一行）**
   ⇒ 下一轮 CI 立刻红在 `check-gate-record-debt.test.js` 的两条断言
   （「真仓上不得出现规范键与主干事实不符」列出这 7 篇；另一条 `declared 4301 / actual 4235`）
   ⇒ **该测试把这 7 篇的声明值当不变量锁住** ⇒ 改声明 = 改不变量 ⇒ **已完全回滚**，
   本片对这 7 个文件**最终零改动**（diff 不含它们）。
   ⇒ **教训**：「主干自红顺手修」即便只改一行**声明字段**，也可能撞上**判据自身的测试不变量**
   ⇒ 声明字段类 ≠ 可以随手改；**动手前先看该字段有没有被测试当不变量钉住**。
   ⇒ 顺带定位到主干的真 bug 形态：该测试第 124 条用例明写
   「**印出的『实际带入』必须逐篇等于 merge-ledger 账本算出的归属（不许有第二份口径）**」
   ⇒ 脚本印的「实际带入」与 merge-ledger 的归属口径不一致 ⇒ **该修的是主干的脚本口径，不是这 7 篇声明**。

⚠️ **本地门禁清单补一条**：`eslint` 不在其中（依赖没装好时我漏跑了）⇒ 以后凡改 Electron/Vue
代码，`pnpm exec eslint electron/ src/ --quiet` 必须进本地清单。

### 第二轮 CI 红的处置（2026-10-25 第三轮）

第二轮 CI 红在 `QG Changes`（`Gate Result` 被它连累）⇒ 根因是**我上一轮对那 7 篇记录的
「顺手修」**（见上一节第 4 条）⇒ **已完全回滚**，本片对这 7 个文件最终零改动。

⚠️ 回滚后的本地读数与**干净 `origin/main` 的对照读数逐字相同**（`node --test scripts/check-gate-record-debt.test.js`
⇒ 同样 3 条用例红：真仓改前/改后对账 / 回填 PR 端到端 / 输出契约）⇒ **本片零影响**；
这 3 条在主干上本来就红（脚本印的「实际带入」与 merge-ledger 账本的归属口径不一致）⇒ **留给主干修**。

### 端到端复跑抓出的真缺陷：门批准后**阶段重跑**（2026-10-25 第四轮）

⚠️ **先纠正一处误判**：本片中途曾记「五道门没有触发」——**那是误判**。端到端复跑的日志里
`ApprovalGateService Created approval gate gate_1…gate_4` 与 4 条「审批门已批准」清清楚楚：
**proposal / script / scenes / assets 四道门都真实触发了**（暂停 → 批准 → 继续）。
误判来自只看了「阶段推进」那几行就下了结论 ⇒ **「没看到」与「没发生」必须分开**。

真正的缺陷是**门批准之后发生的事**：

| 现象 | 证据（端到端复跑日志） |
|------|---------------------|
| 门放行后**从当前阶段重跑** | `stage end … stage=assets success=true duration_ms=12817` → `Created approval gate gate_4` → `stage start … stage=assets` → `stage end … stage=assets success=true duration_ms=12752` ⇒ **素材完整生产了两遍（10 图 + 10 TTS × 2）** |
| proposal / script / scenes 看似「秒回」 | 重入耗时 216ms / 98ms / 8ms（首次 504 / 526 / 414ms）⇒ **是本地 Provider 桩的缓存假象**，真实 provider 下同样会再调一次模型 |

⇒ 两个真缺陷：

1. **重复消耗**：门放行 ⇒ 该阶段的昂贵副作用重做一遍（素材生产 / 模型调用）。
2. **用户在 G1 门里的选择被冲掉**：`confirmStageGate` 把选中的
   `proposal.production_plan.render_runtime` 写回 `run.context.proposal`；而重跑 proposal 会用
   新的 LLM 输出**重新归一化**（`explainer-artifacts.js`：`plan.render_runtime = runtimeFromLlm || 'remotion'`）
   ⇒ **用户选的渲染引擎被重置成默认值** ⇒ P3「选项写回产物本体 ⇒ 下游零改动自动生效」的设计**当场失效**
   ⇒ 且默认值是**更贵**的 Remotion 路径。

#### 修法：执行器层「门批准后复用产物」（`explainer-stages.js`）

新增 `withGateReuse(executor)` 包装层，判据是
`stage.gateCleared === true`（刚被门放行）**且** `context[stage.name]` 已存在 ⇒ 直接复用产物。

⚠️ **为什么必须放在执行器层、不能放引擎层**：film-engineering 的 `film_generate_videos` 是**另一种门**
（成本确认入口闸：第一次执行只产「等待态清单」、**零 provider 调用**，批准后**必须**重入才真生成）
⇒ 引擎层「有产物就跳过」会让它**永远不生成视频** ⇒ 两种门语义并存 ⇒ 只能在 explainer 这一层区分。
⇒ 该包装**只套在 5 个门阶段**上（`EXPLAINER_GATE_STAGE_TYPES`），research / editing / compose 行为不变。

⚠️ **「断点续跑」不受影响**：应用重启后从 checkpoint 恢复时**不会**带 `gateCleared` ⇒ 仍然照常重跑。

**回归保护**：新增 `apps/desktop/electron/services/explainer/explainer-gate-reuse.test.js`（9 例）⇒
① 复用短路 / ② 无产物时不误跳过 / ③ 无 `gateCleared` 时照常执行 / ④ G1 场景下
`render_runtime` 保持用户选的值 / ⑤ **注册路径**（真实注册表）上「门阶段被包装、非门阶段不被包装」/
⑥ **契约锁**：门阶段清单与**运行时** `stageDefs` 里 `checkpointRequired === true` 的集合**逐字一致**
（补上既有锁「点名 5 个」的盲区：挡不住「第 6 个阶段被悄悄设成门」）。
⚠️ 另有一条**归一化侧锁**：`buildProposalPacket` 缺 `render_runtime` 时补成 `'remotion'`
⇒ 把「重跑会冲掉选择」的那一半也钉住。

**变异验证 4/4 全部被抓住**（每个变异都用**唯一锚点**注入并**自检已生效**，恢复后基线 rc=0）：
去掉复用短路 / 把 `=== true` 改成 `!== true`（首次执行也短路）/ 拿错产物（`context[stage.name]` → `context`）/
门阶段清单少一个（去掉 assets）。

⚠️ **变异验证过程本身抓到一个「假阴性」形态**（值得记）：最初用 `s.replace(old, new, 1)` 注入
`stage.gateCleared === true` 时，**该串在文件里出现两次**（一次在注释里）⇒ 替换打到了**注释**、
**代码根本没变** ⇒ 锁不红，而那其实是**正确读数**（变异没打进去）。
⇒ 纪律：① 变异锚点必须**唯一**（带代码上下文）；② 每次注入后**必须自检「代码真的变了」**；
③ 「锁不红」先问「变异打进去了吗」，再问「锁有没有牙齿」。

⚠️ 顺带加固了一条**弱锁**：原「`gateCleared` 是唯一触发条件」那条源码正则锁，
**注释里的同形文本就能满足它**（实测：把代码行改成 `!== true` 后它仍绿）⇒ 改为**只扫代码行**
（行首 strip 后不以 `*` / `//` / `/*` 开头）⇒ 判据的输入形状与被测对象对齐。

**本地实测**：eslint 全量（CI 同款）rc=0；explainer 目录 + `pipeline-engine.test.js` 共 **12 文件 / 305 例**全绿；
新增文件 9/9。

### 端到端复跑抓出的第二个真缺陷：G1 门「显式选渲染引擎」不生效（2026-10-26 第五轮）

**现象**：G1 门把用户选中的渲染引擎写回了产物本体
（`buildApprovalContextPatch` → `proposal.production_plan.render_runtime` + `proposal.metadata.render_runtime_source = 'user_confirmed'`），
但 **compose 执行器根本不读那个字段** ⇒ 它无条件先试 Remotion（`tryRenderWithRemotion`）⇒
⇒ **用户在 G1 门里选 ffmpeg，成片仍是 Remotion 出的**。
⇒ 即「P3 §21 里『选项写回产物本体 ⇒ 下游零改动自动生效』」这条设计假设**在消费端不成立**。

⚠⚠️ **这里要诚实记一个读数陷阱**：第一轮复跑（15:26 起跑）的报告里 `renderRuntimeUsed = 'remotion'`，
看着正好是本缺陷的现场证据 —— **但那一轮跑的是旧代码**（渲染意图纯函数 15:44 才落盘，
`explainer-review-stages.js` 的接线 19:59 才落盘）⇒ ⇒ **那个读数不能当本缺陷的证据**。
⇒ 真证据在**代码层**：compose 执行器里没有读 `proposal.production_plan.render_runtime` 的分支。
⇒ ⇒ **纪律**：「复跑读数」必须先确认**跑的是哪一版代码**（用文件 mtime 对照起跑时刻），
否则会把**旧代码的读数**当成新逻辑的判据 —— 这与「用旧读数判新代码」是同一类错误。

**修法**（三处）：

1. **新增纯函数** `apps/desktop/electron/services/explainer/explainer-render-runtime-intent.js`
   ⇒ `resolveRenderRuntimeIntent(proposal)`：只有
   **「`metadata.render_runtime_source === 'user_confirmed'`」** **且** **「`production_plan.render_runtime === 'ffmpeg'`」**
   两条**同时**成立才返回 `'ffmpeg'`；否则返回 `'remotion'`（P5a 的既有行为 ⇒ 零回归）。
   - ⚠ **为什么必须看 `source`**：归一化会把缺省/LLM 给的 runtime 补成 `'remotion'`；
     若只看值，**LLM 恰好给 `'ffmpeg'` 也会改掉 P5a 的既有行为** ⇒ 静默回归。
   - ⚠ **逐字比较、不 `trim`**：两个字段都由本仓单一真源逐字写入；带空白的值**不是**枚举成员 ⇒ 判据不成立
     ⇒ **规范化是写入层的责任，消费端的宽容等于给判据开后门**。
   - ⚠ 单独成模块还有第二个理由：`explainer-review-stages.js` 离 500 行上限只差几行
     ⇒ 语义放新模块、主文件只做接线。
2. **compose 执行器接线**（`explainer-review-stages.js`）：显式 ffmpeg ⇒ **不试 Remotion**
   （试了等于作废用户的选择）⇒ 直接走 ffmpeg 轮播。⚠ 这**不是回落** ⇒ **不写** `render_fallback_reason`。
   ⚠ **单一真源**：判据只在纯函数一处实现 —— 中途曾在同一文件里并存「纯函数 + inline 判据」两份
   ⇒ **重复声明把整个文件变成语法错误**（`SyntaxError: Identifier 'userPickedFfmpeg' has already been declared`）
   ⇒ **该文件一度加载不了** ⇒ 接线锁后来把「恰好一份且形态精确」钉住。
3. **`render_runtime_requested` 语义统一** = **本次请求的 runtime = 渲染意图**（恒有值）：
   显式选 ffmpeg ⇒ `'ffmpeg'`（**非回落** ⇒ 不带回落原因）；缺省 / 显式 remotion / Remotion 失败回落 ⇒ `'remotion'`
   （回落时另带 `render_fallback_reason`）⇒ 消费方据此区分「用户要的就是 ffmpeg」与「想要 remotion 却回落了」。

**回归保护**：

- 纯函数单测 8 例（用户显式 ffmpeg / 显式 remotion / **LLM 自己给 ffmpeg 仍 remotion** / 缺省 / 畸形输入 / **逐字**）
- ⭐ **接线锁**（补「叶子模块单测全绿 ≠ 已接线」这个盲区）：读 `explainer-review-stages.js` 源码
  （**只扫代码行**，先剥注释 ⇒ 否则注释里的同形文本能满足断言）⇒ 断言
  ① 真的 `require` 了该模块 ② 真的**调用**了（调用点形态，不是字符串提及）
  ③ `userPickedFfmpeg` 的声明**恰好一份且形态精确**（`= renderIntent === 'ffmpeg'`）
  ④ `render_runtime_requested` **取自 `renderIntent`**（不得硬编码）

⚠ 与第四轮的 `withGateReuse` 一起，**两个缺陷都出在「同一个语义的两端」**：
④ 修的是「**产物**被重跑冲掉」，⑤ 修的是「**消费端**压根不读」⇒
⇒ **「选项写回产物本体 ⇒ 下游零改动自动生效」这个设计，只有在「消费端确实读那个字段」时才成立** ——
⇒ **写回只是必要条件，不是充分条件**。

### 本轮端到端复跑的实测读数（2026-10-26，guided 模式 + G1 显式选 ffmpeg）

| 验收点 | 读数 | 判据 |
|---|---|---|
| 流水线走完 | `status=completed`，8 阶段全 completed，耗时 **510580ms（8.5min）** | 上轮 27.8min ⇒ 本轮**没启动 Remotion**（快 3 倍） |
| **五道门全部触发并放行** | `context` 里 `approval_proposal / approval_script / approval_scenes / approval_assets / approval_publish` **五项齐全** | ⭐ **独立于门名**的证据（不依赖 E2E 脚本的门名记录） |
| **门批准后不重跑** | assets：**16643ms → 2ms**（重入即复用产物） | 对照第四轮修复前的 12752ms（重做一遍） |
| ⭐ **G1 选 ffmpeg ⇒ 真走 ffmpeg** | `render_runtime_requested='ffmpeg'` / `render_runtime_used='ffmpeg'` / `render_fallback_reason=**None**` | 三字段合起来才是完整证据（意图 + 实际 + 非回落） |
| 成片规格 | **1280×720** / h264 + aac / 30fps / 73.93s / 6,589,400 B | 1280×720 ⇒ ffmpeg 路径（Remotion 硬编码 1920×1080）⇒ 额外旁证 |
| **音轨非静音** | `mean_volume = **-19.6 dB**`（对照数字静音 = **-91.0 dB**） | ⭐ 靠 `PYTHONPATH=/workspace/pylibs` 让 `edge-tts` 真跑起来（上轮是 `fallback silence`） |

⚠ **本轮 E2E 跑的是「改读数点之前」的脚本** ⇒ 报告里的 `approvalGates` 仍只有 4 条、且 assets 那条仍被记成
`scenes` ⇒ ⇒ **本轮的门名记录不可信**，但**功能与 runtime 读数不受影响**
（读数点已改成带 runId 的 `pipelineApprovalGate(runId)`，下一轮生效）。
⇒ ⇒ **这正是「读数点错了会伪装成被测机制有缺陷」的样本**：若据此断言「assets 门没触发」就是**误判**。

### 遗留（不假装已闭合）

1. **端到端复跑未做**（本片改的是**流程形态**而非产物形态，验收由单测 + 4 条契约锁 + IPC 接线覆盖）：本片改的是**流程形态**（新增人工门）而非产物形态，验收由「主进程模块单测 + 4 条契约锁 + IPC 接线」覆盖；
   但**「门真的能挡住流水线并在批准后继续」只做了模块级验证**，**没有真起应用跑一遍五道门** ⇒ 下一片必须补 E2E（开着 `guided` 真跑通 + 驳回后停住）。
2. **`manual_all` / `auto_noncreative` 两档在 UI 不提供入口**（上游枚举在主进程仍有效）：`manual_all` 会让 research / editing / compose 也暂停，而本仓只有五道门有人审 UI ⇒ 暴露它会把流水线停在没有 UI 的门里。
3. **驳回不做自动返工**：上游的 REVISE / SEND_BACK（返工 / 退回上游阶段）属 P4 的 EP 编排。
4. **成本快照金额恒 0**：本仓无单价表 ⇒ `metadata.cost_note` 写「单价未知」；真值随 P4 的预算闸落地。
5. **默认审批模式是 `none`**（偏离上游默认 `guided`）：理由是改默认值会打断所有既有「一键出片」用户；能力齐备但需显式开启（已在 PRD §21.10 登记）。
6. **门载荷里的 `review.focus` / `success_criteria` 是上游英文原文**，用户看到的是 locale 里的中文对照 ⇒ 两份各自演进，**靠「条数锁」防漂移**（措辞漂移不拦，属刻意取舍）。
7. **E2E 记录的「门名」曾读错读数点（已修）**：E2E 原先用 `pipelineStatus("animated-explainer")` 取
   「当前门」——**那个 API 不带 runId** ⇒ 拿到的是「最近一次/当前活跃运行」的 checkpoint
   ⇒ 与本 run 的门**可能不是同一个** ⇒ 实测把 **assets 门记成了 scenes** ⇒
   ⇒ ⚠ **这不是引擎的 `currentStage` 滞后，也不是「批准 A 放行 B」**：
   `confirmStageGate` 放行的是**引擎当前暂停点**（不按 stageName 找门），
   `approveStageGate` 用的 `run.checkpoint.stageName` 是**带 runId 的权威值**
   （证据：上轮报告的 `contextKeys` 含 `approval_proposal/script/scenes/assets/publish` **五项**）
   ⇒ **五道门全部真实触发并放行**。
   ⇒ **已修**：E2E 改用带 runId 的 `pipelineApprovalGate(runId)`（返回 `data.stage` = 权威阶段名，
   `code !== 0` 即「当前没门」）⇒ 并顺带采集门载荷的 `type`；报告另加**门序号**（与门名无关的独立证据）。
   ⇒ **教训**：「读数点选错」会伪装成「被测机制有缺陷」⇒ 换读数点后结论翻转时，
   **先问「我读的是不是同一个对象」**。
8. **成片分辨率不能当「走的是哪条渲染路径」的判据**：E2E 脚本**没有传尺寸**（分辨率取流水线默认值），
   而 Remotion 路径的上游 `Root.tsx` 把尺寸硬编码成 1920×1080 ⇒ ⇒ runtime 判据只认
   `render_runtime_requested`（请求的）+ `render_runtime_used`（实际用的）两个字段。
9. **publish 门语义偏离上游**：上游 publish 门是「**发布前**确认」，本仓的 publish 阶段**已执行完**
   （日志 `stage end … stage=publish`）才建门 ⇒ 实际是「**发布后确认**」⇒ 顺序与上游相反，已登记为偏离。
10. **edge-tts 是环境依赖，不是代码依赖**：沙箱重建会丢 Python 包 ⇒ TTS 回落成静音（`fallback silence`）
    ⇒ 已把依赖固化到 `/workspace/pylibs` 并在 E2E 脚本里显式设 `PYTHONPATH` ⇒
    ⇒ **「音轨非静音」这条验收依赖环境**，用户机器上不成立。

## CHANGELOG 条目

- feat(视频创作): AI 讲解视频补齐上游人工审批门 —— 方案/脚本/分镜/素材/发布五道门产出后停下来等人确认，驳回会停在该阶段；G1 门同时呈现 Remotion 与 FFmpeg 且必须显式选择（禁止静默默认）。
- fix(视频创作): 修审批门放行后「阶段重跑」的两个真缺陷 —— 素材与模型调用被白做一遍、且 G1 门里选的渲染引擎被重新归一化冲回默认值；改为放行后**复用已产出的产物**并继续下一阶段。
- fix(视频创作): 修 G1 审批门「显式选渲染引擎」不生效 —— 选择虽已写回产物，但 compose 执行器不读那个字段 ⇒ 在 G1 门选 FFmpeg 仍出 Remotion 成片；改为按「用户确认过 + 值为 ffmpeg」判定渲染意图并接线，且统一 `render_runtime_requested` 语义（恒等于本次请求的 runtime）。

## learnings

- **「阶段名 + 顺序对齐」不等于「机制对齐」**：上游 yaml 里除了 `stages`，还有 `checkpoint_required` / `human_approval_default` / `review_focus` / `success_criteria` 四组字段决定「人在哪里介入、介入时看什么」；只搬前者会让流水线看起来一样、行为完全不同。
- **上游 yaml 的仓内副本可能是过期件**：本仓 Python 侧那份把 `assets` 写成 `human_approval_default: false`，与上游真源相反 ⇒ **取真源要现拉现核**，仓内副本只能当线索。
- **零容差主文件里的能力扩展**：正确解法是「新模块承载语义 + 有余量的层做接线 + 只改字符串」，而不是抬基线；本片 `pipeline-engine.js` 零行增长、`container.setup.js` 一行不动。
- **「高亮推荐」不等于「已选中」**：要让用户显式确认，就不能给默认值 —— 给默认值等于静默默认，而静默默认的代价是「用户没点也按最贵路径跑」。
- **门载荷是「两层」**：上游 `review_focus`（人看的）与 `success_criteria`（机判的）混写在一起 ⇒ 搬过来时要按「能不能机械核对」分开，否则会把人判项写成自动断言。
- ⭐ **「没看到」与「没发生」必须分开**：本片中途曾据「阶段推进」那几行日志记下「五道门没有触发」，
  而端到端复跑的日志里 `Created approval gate gate_1…gate_4` + 4 条「审批门已批准」证明**四道门都真实触发了**
  ⇒ **误判来自只看片段就下结论**；验证「某机制有没有发生」要找**该机制自己的事件**，而不是看流水线的间接现象。
- ⭐ **「产物后」的门与「产物前」的门是两种语义，不能共用引擎机制**：影视工程的成本确认闸是
  「第一次只产清单、零调用，批准后**必须**重入才真生成」；explainer 的五道门是「产物已出后触发，批准后**必须**跳过」。
  ⇒ 引擎层统一「有产物就跳过」会让前者**永远不生成视频** ⇒ 只能在**执行器层**按流水线区分。
- ⭐ **用户的选择会被「重跑」静默冲掉**：`confirmStageGate` 把 G1 选的 `render_runtime` 写回产物本体，
  而重跑会用新的模型输出**重新归一化**（缺省补成默认 runtime）⇒ **写回产物的设计，在有重跑语义时不成立**。
  ⇒ 凡是「用户的显式选择写回产物」的机制，必须同时确认「该产物不会在选择之后被重新生成」。
- ⭐ **变异锚点不唯一 ⇒ 变异打到了注释 ⇒ 「锁不红」是正确读数**：用 `replace(old, new, 1)` 注入
  `stage.gateCleared === true` 时，该串在文件里出现两次（一次在注释）⇒ 代码根本没变 ⇒ 锁当然不红。
  ⇒ 三条纪律：① 锚点必须**唯一**（带代码上下文）；② 注入后**自检「代码真的变了」**；
  ③ 「锁不红」先问「变异打进去了吗」，再问「锁有没有牙齿」。
- ⭐ **源码正则锁会被注释里的同形文本满足**：判「`gateCleared` 是唯一触发条件」那条锁，
  最初直接对整份源码 `toMatch` ⇒ 注释里写着的那串就能满足它（实测：代码改成 `!== true` 它仍绿）⇒ **弱锁**。
  ⇒ 判据的输入形状必须与**被测对象**对齐（被测对象 = 代码行 ⇒ 判据就只扫代码行，先剥注释）。
- ⭐⭐ **「选项写回产物本体 ⇒ 下游零改动自动生效」只是必要条件，不是充分条件**：
  还得**消费端真的读那个字段**。本片两个缺陷正好落在同一语义的两端 ——
  ④ 产物**被重跑冲掉**（写回了，随后被重新生成覆盖）；⑤ 消费端**压根不读**（写回了，但没人看）。
  ⇒ **凡是「用户的选择写回产物」的设计，验收必须落在「消费端读到的值」上**，
  而不只是「产物里那个字段被写对了」。
- ⭐ **「复跑读数」必须先确认跑的是哪一版代码**：第一轮复跑报告里 `renderRuntimeUsed='remotion'`
  看着正好是新缺陷的现场，但那份代码比纯函数早 4 小时、比接线早 4 小时 ⇒ **跑的是旧代码**
  ⇒ 那个读数**不能**当新逻辑的判据 ⇒ 用文件 mtime 对照起跑时刻才认得出。
  ⇒ 与「用旧读数判新代码」同族：**任何读数都要带「它是哪一版代码产生的」**。
- ⭐ **同一语义的两份实现会互相咬**：纯函数 + inline 判据并存 ⇒ 变量重复声明 ⇒ **整个文件语法错误**
  （一度加载不了）⇒ ⇒ **判据要落到「恰好一份且形态精确」**，而不是只查「有没有引用」。
- ⭐ **「值」与「值是谁写的」必须一起看**：只看 `render_runtime` 的值 ⇒ LLM 恰好给 `'ffmpeg'`
  也会改掉 P5a 的既有行为 ⇒ 判据必须是「**用户确认过**」**且**「值是 ffmpeg」两条同时成立。
- ⭐ **消费端的宽容（`trim`）等于给判据开后门**：带空白的值**不是**枚举成员
  ⇒ **规范化是写入层的责任**，消费端宽容会让「` ffmpeg `」这种非枚举值静默生效。
- ⭐ **「门名」不是门的可靠标识**：E2E 记「审批门已批准」时读的 `run.checkpoint.stageName`
  是引擎的**当前阶段**口径，某些时刻与「刚被批准的那道门」不对齐 ⇒ 证据要换成
  **与门名无关的独立读数**（门序号 / `context.approval_*` 记录）。

