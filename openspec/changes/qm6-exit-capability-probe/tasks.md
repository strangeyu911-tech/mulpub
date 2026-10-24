# Tasks: qm6-exit-capability-probe

> 顺序即依赖：1 的谓词是 2 的结论生成器的输入；3 的契约锁必须读 1 的导出面。
> 每条勾上都带"当场跑出来的那条读数"，不写"应该没问题"。
> **落点与动笔时的两处偏差**（写在勾旁边，不改 §1/§2 的原意）：
> ① 三格谓词不住在探针本体，而是独立模块 `scripts/qm6-exit-capabilities.js`（理由见 design §1）；
> ② 行为真跑取 `require(vendorDriver)` 而不是 `vm` 编译（理由见 design §1.2）。

## 1. 三格出口的现读谓词（`scripts/qm6-exit-capabilities.js`）

- [x] 1.1 恢复 #4067 被撤销的那一格：导出纯谓词 `externalReviewCapable(src)`
      —— **两条同时成立**才算在位：解除谓词被 `function` 定义（注释里提一句不算）+ 驱动把期望后端写进裁决模板
      读数 `externalReview=true`（A1 两版夹具答案不同；n4 把判据放宽成"文本里出现过名字"时 A1 指名红）
- [x] 1.2 新增 `upheldExitCapable(src)`：`verdict === 'upheld'` 那条 push 之前有没有解除臂
      读数 `upheld=false`（A2 无守卫判 false/有守卫判 true；A3 对注释行数不敏感；A4 别处的 `return` 不得替它顶罪）
- [x] 1.3 新增 `toolSignatureCapable(src)`：`ccg-review-writeback.js` 里除 `performedBy === expected` 之外
      有没有第二条通往"写"的路径 —— 读数 `toolSignature=false`（A5 两版夹具；n5 恒 true 时 A5 红）
- [x] 1.4 三个谓词（含行为档 `upheldExitBehavioral`、交叉比较 `crossCheckUpheld`、聚合 `readCapabilities`、
      生成器 `conclusionLine`）都从 `module.exports` 出去；A12 按名字逐个问，不接受"文件还在所以没事"
      （n6 重演 #4062 那种"从导出面摘掉一个名字"，实测 A12 指名红）
- [x] 1.5 仓内写回器源码的读取入口在探针侧是 `readWritebackSource()`，读不到 ⇒ rc=2 并点名
      "工具署名出口取不到数"；聚合层对越界返回值（`undefined`/`null`）当场抛错（A7、n9）

## 2. 结论行由读数生成

- [x] 2.1 `conclusionLine(caps)` 按 design §2 的三档拼接；探针 stdout 那句由它生成
      现场整句：`验证层三个停止出口里只有 ③(maxRounds→self-play) 可达（要把分数抬到 8 才另有出口）；`
      `高危域条目：填齐外部复核三格后可解除（vendor 已能表达）；诚实标 upheld ⇒ 永久阻断（机制缺口，非本 PR 缺陷）；`
      `工具署名：自扮演收口永拿不到 tier=external（须人工补字段或全驳回）`
      （n8 把生成器改成无视入参 ⇒ A8 红；n10 把句子写死回旧文案 ⇒ A10 红）
- [x] 2.2 `--json` 档的 stdout 只能是 JSON（人读行改道 stderr），新增 `exitCapabilities`（含
      `upheldBehavioral`）、`capabilitySource`、`upheldCrossCheck`、`conclusion` 四组读数（P1 走 `--json` 解析）
- [x] 2.3 行为真跑档：`require(vendorDriver)` 后拿 `blockingFromAdjudication` 喂两份合成裁决各调一次
      —— A 份无凭证必须计阻断（不阻断即抛错，n16 摘掉这道防呆时 A13 红）；B 份**同时**带
      `externalReview`（vendor 今天真读的那份）与 `resolution`（假想未来臂会读的那份）两形状 ⇒ 读数 `false`。
      ⚠ 本条第一版只写了 `resolution`，而 vendor 从不消费它 —— 是 QM-6 第一轮评审 i2/i5 逼出来的形状错误，
      读数虽对但不是量出来的（见 design §1.2b）
- [x] 2.3b 正控 `externalReviewReceiptLive(fn)`：高危域条目 + 那份 `externalReview` 凭证必须**真的**被 vendor 解除；
      正控不成立 ⇒ 行为档返回 `'unavailable'` 而不是 `false`（拒绝在空夹具上给结论）。
      本机读数 `正控(凭证是否被 vendor 消费)=true`；锁 A16（含键名逐个点名、`performedBy` 不得是 self-play、
      `evidenceRef` 必须过 vendor 的形状判据）；变异 n19/n20 各指名红一条
- [x] 2.3c 结构谓词的解除臂词表加上 `externalReview`（vendor 今天唯一的凭证词汇）；
      A2 因此加第三种"在位"夹具（`if (i.externalReview) { return; }`），n21 摘掉该词项时 A2 指名红
      —— 没有这条夹具，词表里那一项就是"写了但没人量"的装饰
- [x] 2.4 行为真跑与结构谓词**互不代替**：`crossCheckUpheld` 不一致 ⇒ 进 `problems` ⇒ rc=1 并点名
      "结构读法失效"，**不自动翻转结论**（design §1.3；n14 把比较改成恒 ok 时 A14 指名红）
- [x] 2.5 vendor 缺席（CI runner 那一档）：结构谓词仍跑（输入换成夹具源码），行为档出声
      `behavioral=skipped(no-vendor)` 且 `ok:true`（缺席不得判偏离，A14）；探针本体仍 rc=2 点名失明（P4）
- [x] 2.6 补一道"两路全瞎"的守卫（动笔时没有这一条，实施中识别出来）：探针走到交叉这步就意味着 vendor 在位，
      此时行为档仍是 `unavailable` ⇒ 记一条 `problems`（rc=1）。
      现场读数：`结构=false 行为=false ⇒ 两路一致：这条出口不在位`；
      P11 用"摘掉导出名"的 vendor 夹具真跑出 rc=1 并点名行为档，n18 摘掉守卫时 P11 指名红
- [x] 2.3d **`require` 之前必须先问"这份驱动能不能被安全加载"**（2026-10-24 现场追加，design §1.2 记完整来路）：
      本机 vendor 驱动被另一个会话改写成末尾裸 `process.exit(main())`，那次 require 把别人的整条评审流水线
      跑进本进程并 exit 掉探针 —— `--json` 的 stdout 变成「判定记录按 diff 内容寻址命中…」，
      且那次误执行**覆写了本 PR 变更集里的一份 `.ccg/reviews/*.json` 判定产物**
      （`pending/tier=unknown` → `skipped_by_mode`，按 HEAD 精确还原后本刀未再复现）。
      新增 `driverLoadability(driverSrc)` → `ok / no-exports / executes-on-require / unreadable` 四种成因分开报，
      判据只盯"调用 `main()` 那一句在不在 `require.main` 守卫里"（**不**按"文件里出现过 `process.exit`"判 ——
      函数体内 `process.exit(2)` 做缺依赖早退是合法的，两份真实现场都有那一处，按字符串存在性判会把正常形态整个排除）。
      `BEHAVIORAL_SKIP_REASONS` 由读数器一侧唯一持有，探针不抄第二份表
- [x] 2.3e **可加载性判据方向反转**（第 7 轮评审 i3；design §1.2 第 3/4 条记完整来路）：
      旧的窄黑名单只认 `process.exit(main())` 一种坏形态，实测漏掉 `main.apply` / `main.call` /
      `const c = main(); process.exit(c)` / 裸 `main();` 四种**真会执行**的写法 ⇒ 改成
      「先剥安全区（守卫整段 / shebang·注释·串·正则 / 函数体），再在顶层区找 main 调用」。
      新增成因 `unparsable-driver`（剥不动 ⇒ 保守侧，但**要修的对象是探测器自己**，与"看见裸调用"不得合并）；
      `BEHAVIORAL_SKIP_REASONS` 随之三档，探针文案分两支各自点名
- [x] 2.3f 反转过程中自己复测到的两格"保守过头"（不写进反证账就不算修完）：
      ① 状态机对**字符数组**用 `a.indexOf('*/')` ⇒ 块注释永远找不到闭合 ⇒ 一切含块注释的文件 bail；
      ② shebang 首行的 `/` 被当正则起点 ⇒ 跨行不闭合即 bail ⇒ 真实 vendor（`#!/usr/bin/env node`）整体退化。
      两格各配夹具（A21 的注释块夹具与两条 shebang 夹具），并各配一条变异（n48 插值段一起剥、n49 不处理 shebang）
- [x] 2.6b 2.6 那道守卫**分两档**（同一次现场逼出的收窄，不是放宽）：`executes-on-require` / `unreadable`
      是按设计的跳过 ⇒ 如实打 `behavioral=skipped(<成因>)`、不改退出码；`no-exports` / `require-failed` / 正控不成立
      是真失明 ⇒ 照旧进 `problems`（rc=1）。两档不得塌成一句"没有 vendor"：
      "装了但不敢跑"与"这台机器没装"修法相反（A14 各有一条断言钉住，n31 把成因塌回 `no-vendor` 时指名红）

## 3. 撤销检出：独立文件的契约锁（这一组是本刀的立项动机）

- [x] 3.1 新建 `scripts/qm6-exit-capabilities.test.js`（20 条 A1–A20）：`require` 读数器并断言导出面在位（A12）
- [x] 3.2 每条谓词各配一对夹具（design §1.1 表），断言两版实现**答案不同**；同形当场红（A1/A2/A5）
- [x] 3.3 结论生成器两条反方向锁：写死成"可达"要红（n8/n10 两条变异分别覆盖）、写死成"不可达"也要红；
      `unknown` 档必须有独立文案（A6/A8）
- [x] 3.4 接线自检：新锁与探针都必须被 `quality-gate.yml` 的**可执行正文**点名（A11；n12 摘掉那一行时 A11 红）
- [x] 3.5 恢复 `openspec/changes/ccg-convergence-exit/tasks.md` 被 #4062 删掉的 31 行（§9/§10），
      并在文件里补 §10.7 现状补记：该文件曾被整段撤销、现由第 3 组契约锁防复发；历史不改写
- [x] 3.6 **锁的前提必须收敛到仓库内的东西**（2026-10-24 现场追加，design §1.4）：
      A9 原来写"vendor 文件在位 ⇒ 三格必须读得出"，这条的前提是本机那份**未提交**的 vendor 补丁；
      补丁被另一会话改写后，它红的内容是"我的机器前提变了"，而不是"判据量出了什么"。
      现改成两个方向的**蕴含式**：驱动声明了被声明物 ⇒ 必须读得出；没声明 ⇒ 必须是 `unknown`
      且结论句自带"读不出"。`toolSignature` 那一格仍无条件断言（输入是仓内文件，可复现）。
      新增 A21：`driverLoadability` 四种成因各配夹具（含"函数体内 `process.exit(2)` 属合法早退"这条正控，
      防止把唯一正常的形态判成禁止加载）+ 成因表逐档点名（`no-exports` 必须在表外，否则 P11 那条 rc=1 失效）；
      A12 导出面增列 `driverLoadability` 并断言成因表是 `Set`（探针不得再抄第二份）；
      A15 增**顺序锁**：`driverLoadability(` 必须排在 `require(driverFile)` 之前、
      `BEHAVIORAL_SKIP_REASONS.has(` 必须排在"决定 rc"那一句之前 —— 只断言"两个调用都在文件里"放过不了"顺序反了"

## 4. 接线与常驻化

- [x] 4.1 `quality-gate.yml` 的 **Gate 2b6**（原本已跑 `ccg-convergence-probe.test.js`）同批点名新契约锁；
      编号按 `git grep -ho "Gate 2b[0-9]+"` 现读后选定，未新增编号即未新增撞车面
- [x] 4.2 `.gitignore` negation 三个新脚本（`scripts/*.js` 默认忽略面）；`check-unwired-tests` 通过、不新增欠账登记
      （见第 6 组批跑读数）
- [x] 4.3 本机门禁批跑 15 条：`check-workflow-structure`(`files=17 violations=0`) / `check-step-failfast`(OK) /
      `check-test-egress-guard`(面=18 已接=14 欠账=4/4) / `check-test-microtask-spin`(1633 文件 0 处) /
      `check-doc-abs-paths`(counts=1161 domain=5500 canJudge=true PASS) / `check-record-qm5-rows`(358 记录 未登记缺行=0) /
      `check-gate-record-debt`(OK) / `check-text-encoding-integrity`(无新增) / `check-no-brand-residue`(PASS) /
      `check-no-hot-carrier-edit`(advisory 命中=0) / `check-changelog-growth`(598→598) / `openspec-sync-check`(387 tasks) /
      `check-schedule-failure-watch`(判定=OK) / 两个新套件(15、11) —— **14 条 rc=0，1 条 rc=2**：
      `check-schedule-heartbeat.js` 在本地无 `GITHUB_REPOSITORY` 时按设计走采集器不可用档（上一刀定的三档退出码，非本 PR 引入）；
      行尾两口径 numstat 逐文件相同、`drift=0`（13 个文件，读数在执行记录）
- [x] 4.4 探针侧三条锁改由**自建 vendor 夹具**跑（P10 / P11 / 新增 P12），因此在 CI runner 上也执行：
      P10 无臂夹具两路都判不在位 ⇒ rc=0，加臂夹具两路都判在位 ⇒ rc=0（这一格以前只能等真 vendor 补上臂才量得到）；
      P11 可加载但摘掉导出面 ⇒ `behavioralSkip=no-exports`、rc=1、点名行为档，A/B 只装回导出面即回 0；
      P12 顶层裸执行 ⇒ 断言 marker 文件**不存在**（探针真的没 require 它）、`behavioralSkip=executes-on-require`、
      交叉文案带上该成因、rc 仍由 ladder 决定；对照组把守卫加回来 ⇒ 行为档立刻落到定值；
      另配**负控**：按 CLI 直接跑那份未守卫驱动必须写得出 marker，否则"没执行"与"marker 从来写不出来"同形。
      夹具自身的**有效性**由这三条断言共同承担，不另写"锚点齐不齐"的自检：任一形状锚点漂移 ⇒ 探针 rc=2 且 stdout 无 JSON
      ⇒ P10 的 `assert.ok(base.j)` 当场红（红在"夹具坏了"而不是"判据发现缺陷"，文案里带 stdout 前 200 字以便归因）；
      而 marker 负控保证"没执行"这句是被证明的，不是探针根本没跑到那一行

## 5. 变异反证驱动 `scripts/qm6-exit-capabilities.mutation.js`

- [x] 5.1 靶子三类：读数器本体（CAPS）/ 探针本体（PROBE）/ workflow 接线行（WF）；
      套件下界 `qm6-exit-capabilities.test.js=21`、`ccg-convergence-probe.test.js=12`（第四格之后；曾为 20/11）
- [x] 5.2 `ALLOWED_MISSED` 留空；每条变异指名要红的用例；`expectGreen` 的声明被否证即 PROBLEM
      现场（演进链，两笔都是当时当场在干净基线上跑的，不互相顶替）：
      2026-10-24 前三格 ⇒ `CAUGHT=28 MISSED=0 PROBLEM=0 TOTAL=28 ATTEMPTED=28 / RESULT=OK`；
      2026-10-24 第四格（n28-n33）⇒ `CAUGHT=34 MISSED=0 PROBLEM=0 TOTAL=34 ATTEMPTED=34 / RESULT=OK`，
      收集数 `qm6-exit-capabilities.test.js=21 ccg-convergence-probe.test.js=12`
- [x] 5.2b **n33 首跑判 PROBLEM 而不是红**（这条必须留在案上）：安装脚本把 `from` 改成"从靶子文件当场取整行"，
      而 `to` 仍是我手写的半截 ` && false` ⇒ 整行被替换成一句语法坏，驱动当场报
      `PROBLEM n33 变异把语法改坏了：… :199`。红得对，但**红的不是我要证那一格**：
      语法坏 ⇒ 套件 LOADFAIL ⇒ 任何断言都轮不到执行。正解是把 `to` 也写成完整一行
      （`  if (caps.upheldBehavioral === 'unavailable' && false) problems.push(`），反证方向不变（A15 + P11 各指名一条红）。
      这一格与 5.5 那条"锚点自反"是同族：**反证工具产出的"红"必须先确认它红在我要问的那一格上**

- [x] 5.3 必含项逐条对上：恒 true（n1）/ 恒 false（n2）/ 结论写死（n10）/ 从导出面摘掉（n6）/
      摘掉 workflow 点名行（n12）/ 把 vendor 缺席伪装成"不在位"这一族（n15+n17+n18：分别覆盖
      "真跑路径整体不执行""调用在位但结果被常数覆盖""两路全瞎时守卫缺失"）
      未做的第 5.3 原句里那一种"把缺席档改成 `skip`"：本刀的缺席档不是 `skip` 而是 rc=2 且仍打印仓内读数（P4 守），
      要把它改成 skip 已由 P4 的产物断言拦住，故不再单列一条变异 —— 这是有意偏差，不是遗漏
- [x] 5.4 终跑读数已写入执行记录（活数，见 `openspec/records/qm6-exit-capability-probe.md`）
- [x] 5.5 **驱动自身的基线卫生**（QM-6 第二轮评审 i2 [Critical] 成立并当场修复，不是驳回）：
      本驱动原地覆盖受 git 管理的源文件，而 `finally` 只覆盖"抛错"这一条路 —— 被信号杀掉时盘上留在
      "改坏的那一份"，下一次运行会把它的字节当成原始内容（本仓实测过一次，见记忆「变异驱动的还原基线可以是脏的」）。
      落三条：① `assertCleanBaseline` 开工前逐个靶子 `git status --porcelain`，脏即拒绝并点名精确路径
      （取不到读数按未证实处理，不得当成"干净"）；② 原始字节写 sidecar 到 `os.tmpdir()` 并**写后回读逐文件比对**，
      新增 `--restore` 作为异常终止后的可执行出口（不是"请自行恢复"这种散文）；
      ③ CLI 解析抽成 `parseCli`：未知旗标与 `--restore` 混用一律拒绝，脏基线只有显式 `--allow-dirty` 一条出口且照旧打警告。
      锁：A17（临时真仓库跑真 git 读数：干净 true / 改过 false / 取不到读数抛错）+ A18（parseCli 五种输入逐档）
      + A19（顺序锁：拿锁 → 证干净 → 存 sidecar → 才动文件，且 finally 必须"先还原再放锁"，锚点缺失即红）
      + A20（单实例锁：并发第二轮当场拒绝、锁内写 pid、释放后能重拿、二次释放幂等、**不自动破锁**）；
      变异 n22/n23/n24/n25/n26/n27 各指名一条红。
      **这一组也是本刀第一次把驱动自己列为靶子（MUT）**，随即被自己的机制咬到两次，都记在案：
      ① 锚点字面量写在 M 表里 ⇒ "命中恰 1 次"读到 2 次（n22 首跑）⇒ 正解是把表里的字面量拆成两段拼接，不放宽命中数；
      ② 同一条理由让 **n26 首跑 MISSED** —— A19 的全文 `indexOf` 先命中 M 表里那串锚点文本，于是"摘掉拿锁"在它眼里仍存在
      ⇒ 正解是把搜索域收敛到 `function runAll` 那一段（A19 现在就这么做），并把该锚点也拆成两段。
- [x] 5.5b 单实例锁的理由与边界：两个驱动并发不只是 sidecar 互相覆盖（固定文件名，后写覆盖先写 ⇒ `--restore` 会还原成
      另一轮的基线），更会同时改写同一批靶子；被 SIGKILL 留下陈旧锁时**一律拒绝而不是自动破锁**——
      自动破锁等于把"两个进程互踩基线"这一整类重新打开，宁可让人先看一眼（拒绝文案里写了归因所需的 pid 与处置）
- [ ] 5.6 已知遗留（不假装已闭合）：`--allow-dirty` 那一支的"忽略旗标、永远证干净"这一变异**没有配**，
      因为 A19 只测顺序、A18 只测解析，两支都看不出"运行期是否真的走了 else 分支"——
      要抓到它必须让驱动在临时仓库里真跑一轮（本仓现有夹具形态不支持）。如实记为未覆盖，不写成"已被其它变异间接覆盖"
- [x] 5.7 第四格新增六条靶子，逐条对上它要问的那一格：
      n28 摘掉"顶层裸执行 ⇒ 禁止 require"那一格（A21 + P12）、n29 判据退回"看见 `process.exit` 就禁"（A21 的合法早退正控红）、
      n30 把 `no-exports` 混进按设计的跳过表（A21 + P11）、n31 交叉文案丢掉真实成因（A14 + P12）、
      n32 探针侧早退失效（P12）、n33 摘掉成因表接线（A15 + P11）。
      终跑（n28-n33 那一轮）`CAUGHT=34 MISSED=0 PROBLEM=0 TOTAL=34 ATTEMPTED=34 / RESULT=OK`（收集 21 / 12）；
      第 4 轮评审 i3 成立后又加了 n34（把 `MAIN_GUARDED` 退回"不认花括号"那一版被禁形态），
      靶子数变 35 ⇒ 终值在 5.9 另取，不拿这一轮冒充修完之后的基线

- [x] 5.8 现场发现的一格遗留（第 4 轮评审 i1/i6 判**成立**，修法在 5.9）：**n32 会在本机把事故重演一次** ——
      它摘掉的正是"不许 require"那道闸，于是那一轮真的把未守卫的 vendor 流水线跑起来并
      **覆写 `.ccg/reviews/*.json` 判定产物**（现场两次：`96dea741…`、`4d4ed2d4…`）；
      驱动的还原范围只含靶子文件，管不到这些产物。本轮先按 HEAD 精确还原那一个文件，
      并把它从"散文式处置"升成两道机械闸（见 5.9）。
- [x] 5.9 把 5.8 变成闸（两道都留，不互相顶替）：
      ① **跑后差量体检** —— `worktreeDirtyPaths` / `sideEffectPaths` / `checkSideEffects`：
      跑前拍快照、还原之后再拍一次，靶子之外的新增脏文件一律 `PROBLEM id=side-effects`
      （不计进 TOTAL，但照样把 RESULT 打成 FAIL）；git 取不到读数**也算** PROBLEM，不得读成"现场干净"。
      三者都是可单测的纯函数 —— 只把逻辑写在 `finally` 里，"返回恒空数组"这一格就永远测不到（n15 同型）。
      ② **反证运行态与本机 vendor 解绑** —— `suiteRun` 与开工自证都在沙箱 env 里
      （`CCG_ARL_DIR` / `HOME` / `USERPROFILE` 同指一个空临时目录 ⇒ `locateVendor()` 恒 null）。
      当场核对：42 条靶子里 **0 条**指望 P1/P3 的"有引擎"分支 ⇒ 这一手不消解任何一条既有的红。
      ② 落地后 ① 在本机已无从触发（真引擎根本见不到），**两道都留着**：
      沙箱自己被摘掉时（变异 n39 就是这个形态）① 是唯一还能看见副作用的东西。
- [x] 5.10 反证驱动**四次**用自己造的闸门拦住我，都记在案、都不靠放宽交差：
      ① n33 首跑 `to` 写成半截 ` && false` ⇒ 整行被替换成语法坏，驱动报"变异把语法改坏了"（PROBLEM 而非红集）
      —— 那条红不在我要问的那一格上，不写进反证账；② n39 的 `to` 整串写进 M 表 ⇒ "目标文本在改前已存在"
      预检在任何变异开跑之前抛错（`from` 侧的拆拼接救不了 `to` 侧）；③ n39 的 `expect` 写了不存在的用例名 A25
      ⇒ "变异不得指向不存在的东西"预检抛错；④ 一次内联 `node -e` 往 CRLF 文件里插入单行 LF
      ⇒ "行尾不合即拒写"在写盘前抛错，先修该行才继续。
      口径：**反证工具产出的"红"必须先确认它红在我要问的那一格上；驱动对自己提的要求会同时打到自己身上，
      这是它该有的样子。**
- [x] 5.11 n39 那次 MISSED 的根因单列一课：**结构判据的扫描域把 M 表自己算了进去**。
      A24 要求 suiteRun 的 spawn 带 `env: sandboxEnv()`，变异之后仍然命中 —— 命中的是 M 表里
      n39 自己那条被拆成两段拼接的 `from`（`[^换行]*` 跨过那个 `" + "` 把同一行读成"接线在位"）。
      即"变异真的生效、锁看着还在绿"，与 n22/n26 的锚点自反同族，但这次出在**判据域**而不是命中计数上。
      正解：新增 `driverCodeRegion()`（剥注释 + 整段剔掉 M 表；找不到边界或剔完规模异常一律抛错，
      **不允许退回整文件扫**），A23 / A24 的驱动侧结构判据全部改走它；并给"收窄扫描域"这个动作自己的
      两条退路各配**行为断言**与变异（n40 = 退回整文件扫、n41 = 剔完不验规模）——
      写成"源码里出现过 throw"就成了记录性断言，那正是本刀要消灭的东西。


- [x] 5.12 第 7 轮之后的靶子扩展（`CAUGHT` 从 42 涨到 50）：
      `n42` 摘掉 `expectGreen` 的**执行体** —— 为此把过滤逻辑抽成 `greenViolations` 独立函数，
      由 `A25` **直接调**它，而不是写"源码里有这行 filter"的记录性断言（第 7 轮 i4 采纳项）；
      `n43`-`n47` 逐个摘掉新判据的每一段剥离（函数体 / 注释与串 / 守卫段 / 正则与除号 / 守卫块的配对出口）；
      `n48` 把模板串的 `${}` 插值段当正文一起剥掉、`n49` 不再处理 shebang ⇒ 两条都指名红（A21 各配夹具）。
      另有两条"驳回但采纳"的观察落在本节：`sandboxEnv` 的注释写明**env 级不是 fs 级**（i5），
      以及 `expectGreen` 现在既有历史否证记录（m18）也有一条会当场红的靶子
## 6. 收尾

- [x] 6.1 执行记录 `openspec/records/qm6-exit-capability-probe.md`：QM-5 ①②④⑤ + 现场读数 + `## CHANGELOG 条目`
      （4.3 的两口径 numstat 与门禁批跑读数补在该记录里）
- [x] 6.2 QM-6：三轮真跑（critic=`claude` / proposer=`opencode`，真源 `scripts/ccg-review-backends.list`）。
      本刀差量命中的高危面前缀是 **`.github/workflows/` 一格**（`HIGH_RISK_SURFACES` 现读 10 条逐文件比对；
      `scripts/ccg-convergence-` / `scripts/qm6-exit-` 都不在表里 —— 事实陈述，不主张扩表）。
      第 3 轮收敛 `status=self_play_resolved`、`blocking=[]`，但写回器拒签 `reason=backend-mismatch`（五条合取只欠 `performedBy`）
      ⇒ 按 #4234 / #4305 先例人工闭环：`tier=external` + `evidence=<PR #4326 评论 issuecomment-6372031270>`，
      `closureNote` 逐字声明"由会话手写"；enforce 判据 ⇒ `TIER-COVERAGE dual-closed total=1 external=1 external-unverified=0` + `OK`
- [ ] 6.3 合并与收尾（**被主干红挡住，非本刀原因**）：`merge-when-green.sh` 读数 `verdict=STOP_MAIN_RED newRed=0 mainFail=1`；
      主干 `QG Changes` 的 `Gate 2b11` 自 `c2c0bb085` 起连红（run `40002327074` / `40009177457`），
      六条红全在 `scripts/deep-review-entry-rc.test.js`（本机同一条聚合命令 44/44 绿 ⇒ 差异落在 runner 平台），
      且本刀改动集与那一步**无文件交集**。修复已有主：在飞 #4347-#4350 ⇒ 按"修复有主就别开第三刀"不再动本分支。
      任一修复落主干后重跑 `bash scripts/merge-when-green.sh 4326 squash --delete-branch`，再按收尾清单做 main push 回读与 R1-R7 清理
