# 给「required 检查清单」建一份仓内对账面，并探出「required 却永不产出结论」那一格

> ⚠️ **2026-10-27 实现期订正**：本提案初稿的现场二把 `QG Coverage` 写成「required 却永不产出结论」，
> **那是误诊**，动因是取数域只看了 main push。required status check 挡的是**合并**，结论只可能出现在 PR 的 check suite 里；
> 按正确域（producer workflow 最近 push ∪ pull_request run）复测它是 `produced`（PR 上有 `failure` 记录），
> 而它在 push 侧 skipped 是 change `ci-push-heavy-job-dedupe` 的明文决定。下方现场二与第 3、4 条已按实测重写；
> 判据本身照建（它现在测的是这件真实存在的事），现读结果是本仓**零条**该病。详见 design.md D4.1 / D5。

## 为什么（先给现场，再谈方案）

**现场一：required 清单只存在 GitHub 侧，仓内一个字都没有。**
本会话在 `origin/main = c2d6709b2` 上现读，两套机制**并存**且内容不同：

| 机制 | 取证命令 | 读数 |
| --- | --- | --- |
| ruleset `main-ci-gate`(id 23749994) | `gh api repos/<o>/<r>/rulesets/23749994` | `QG Static / QG Unit Tests / electron-tests / 文档同步检查 / 债务熔断检查 / 单元测试 + Lint / GUI Gate Result` |
| classic branch protection | `gh api repos/<o>/<r>/branches/main/protection` | `Gate Result / build / QG Unit Tests / QG Coverage` |

并集 10 条（`QG Unit Tests` 两边都在）。只查其中一套会得出**假结论**——这条本仓已记过（`/rulesets` 列表接口的 `rules` 恒为空，必须按 id 单独取）。
而"清单里现在有哪些名字"这件事，在仓库里**没有任何文件承载**：AGENTS 明写「仓库侧 required 清单仍在平台侧、仓内无对账面」，
`openspec/changes/ci-judge-surface-coverage` 的未闭合清单也把它列成残余。

**现场二：一条 required 检查可以永远不产出终态结论，而 GitHub 照样算它通过。**
`skipped` 满足 required ⇒ 一个看起来在守的门可以**从不看任何东西**，而且**不会自我暴露**——没人会去查一条"绿"的 required 检查到底跑没跑。
本刀实现后按正确域现读：本仓 10 条 required **全部 `produced`**，即**这一格此刻是干净的**（`dead=0 noRun=0`）。
所以这一刀交付的不是"抓到一条病"，而是"让下一次引入这种病必须红"——连同现场二那句被否证的初稿一起留档，
正是这条判据存在的理由：**没被测量过的"应该在守"就是装饰性门禁**。
本仓对同型问题已有解法（`HIGH_RISK_SURFACES` 的**空转条目锁**：命中 0 个文件的前缀比没有这条更坏），
但那把锁管的是"路径前缀有没有命中文件"，管不到"required 名字有没有产出结论"。

**为什么现在做**：#4486 那刀把"谁来守门"的输入面收成了单一真源（判据 require 闭包），本刀是它的另一半——
**守门清单本身**现在仍然没有对账面、没有死条目检查。顺序不能反：先有派生与登记面，才谈得上把平台侧改动变成会红的事。

## 做什么（四件，都有执行体）

1. **派生，不手抄**：从 `.github/workflows/**` 派生「每个 check 名由哪个 workflow 的哪个 job 产出」。
   口径：job 的显式 `name:` 优先，没有 `name:` 的取 job id（实测：`QG Static` 来自 `quality-gate.yml` 的 `static-gates` 的 `name:`，
   而 `electron-tests` / `build` **只有 job id**）。派生必须**先框出 `jobs:` 区间**——朴素按两空格缩进找 job 会把
   `on:` 的触发器当成 job（探针现场把 `push/pull_request/workflow_dispatch/schedule` 混进 job 列表），
   于是"这个 check 没有产出者"会变成假红。这条陷阱由探针当场暴露，写进规格并配反例断言。
2. **登记面 `scripts/required-checks.json`**：登记「本仓打算要求哪些 check 是 required、每条由谁产出、声称走哪几套机制」。
   判据做**双向差集**：平台有而登记无 ⇒ 红（有人在平台侧加了闸，仓内无人知道）；登记有而平台无 ⇒ 红（闸被摘了）。
   登记面**只能由人工改**（改它就是在改谁来守门）；把某个名字从登记面删掉以配合平台侧的私改，会被"平台有而登记无"那一格当场抓住。
3. **产出结论探测器**：对每条 required 名字，在**其 producer workflow 最近的 `push ∪ pull_request` run**（扫描面 `MAX_SCAN` 条、窗口 `RUN_WINDOW` 条，两个数都打印）里找它自己的**终态**结论；
   四次读数 `produced / always-skipped / absent / no-run` 动作各不相同，后三者违规；任何取不到数（含 403 令牌 scope 不足）一律 rc=2 未证实。
   `conclusion === null`（in_progress/queued）不算结论。
4. **违规存量 `scripts/required-check-debt.json`**：现读**零条**，上限常量 `MAX_DEBT = 0`（只能人工改，且"抬上限而不新增欠账"也要红）。
   被实测否证的登记（初稿那条 `QG Coverage`）MUST 原样留在文件的 `_否证记录` 里并标注不实，不做静默删除。

外加接线：`quality-gate.yml` 的 `changes` job 新增 **Gate 2b17**（无条件执行、`shell: bash` fail-fast、判据零第三方依赖）。

## 以什么档位接（这条要单独说，因为它决定这刀会不会变成新的假红源）

**Gate 2b17 先以 `--mode=advisory` 接入**，理由不是"怕吵"，是它**读的是平台状态**：
CI runner 上的 `gh api` 有瞬断/限流（本仓实测过 TLS 瞬断把闸门打成 `SELF_FAULT exit=4`），
把"取不到外部读数"直接做成阻断，等于给每个 PR 新增一条与代码无关的失败面。
所以退出码分三档且不得混档：`0 合规 / 1 发现违规 / 2 判据自身取不到读数`；advisory 档下 rc=2 与 rc=1 都出声但不阻断，
**转 enforce 必须另开 PR 并带实测影响面**（多少 PR 会红、多少次是平台抖动）——沿用 `Gate 2c2` / `Gate 2b9` 的既有先例与口径。

## 摩擦如实报

- CI 侧多一条网络出站依赖（`gh api`）。缓解不是"想办法不读"，而是：取不到 ⇒ rc=2 明说，绝不把"没读到"读成"没问题"。
- 登记面是一份需要人工维护的清单，天然会漂。所以它的判据是**双向差集**而不是"命中即可"：漂了必红，且红文案给出漂的方向。
- 探测器只查"有没有产出结论"，**不查结论对不对**——它挡不住"作业跑了但断言是恒真的"（那是另一族病，`check-unwired-tests` / 反证纪律管）。
  这一格如实写进规格，不留"有了这把尺就都管住了"的错觉。
- 它不解决"平台侧改了没人知道"的全部面：本判据在 CI 里跑，所以**没有 PR 的时段**（比如有人在 GitHub UI 上摘掉一条 required 后不推任何东西）
  不会立刻出声。要么给它配一个 schedule（本仓 `clock-shift-oracle.yml` 有先例），要么接受"下一次 PR 时才发现"。
  本刀选择：**先接受**，并把 schedule 版作为具名欠账登记——避免第一刀就同时改 CI 面与调度面。

## Impact

- 新增：`scripts/lib/required-checks.js`（零依赖派生 + 判定真源，**不 require `node:child_process`**）、
  `scripts/check-required-checks.js`（CLI 判据，唯一 spawn 出口）、
  `scripts/required-checks.json`（登记面）、`scripts/required-check-debt.json`（**现读零条欠账** + `_否证记录` 留档）、
  两份测试文件（`scripts/lib/required-checks.test.js` 22 条、`scripts/check-required-checks.test.js` 12 条）
- 改：`.github/workflows/quality-gate.yml`（`changes` job 新增 Gate 2b17，advisory）、`AGENTS.md`
  （把「required 清单只存在 GitHub 侧、仓内无对账面」这句**已被本刀否证**的话改成现值 + 指向新判据）、`.gitignore`
  （`scripts/*.js` 默认忽略新建脚本，须显式反选判据本体）
- 规格：`openspec/changes/required-checks-ledger/specs/required-checks-ledger/spec.md`
- 合并方式：本刀是在**定义"谁能算作守门"**并新增门禁接线 ⇒ 属改「谁来守门」，**交人工批准合并，agent 不自合**

## 重取读数（不写成现状，引用现跑）

```bash
node scripts/check-required-checks.js --report           # 判据自己的读数
gh api repos/<owner>/rulesets/23749994 --jq '[.rules[].parameters.required_status_checks[]?.context]'
gh api repos/<owner>/branches/main/protection --jq '.required_status_checks.contexts'
```
