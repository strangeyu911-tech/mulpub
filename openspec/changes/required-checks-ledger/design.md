# 设计：required 清单的对账面与「恒 skipped」探测

> 本文件只写**决策与被实测到的边界**。所有数字都是当场取的活数，引用时重跑（命令在各节末尾）。

## D1 落点：派生与判定合成一份零依赖真源，CLI 只做参数与出口码

`scripts/lib/required-checks.js`（零第三方依赖，且**不 require `node:child_process`**——实测：本模块只 `node:fs` / `node:path`）
导出 `deriveWorkflowChecks(repoRoot)`、`producersOf(derived, ctx)`、`readRegistry(repoRoot)`、`readDebt(repoRoot)`、
`validateDebt`、`classifyWindow` / `judgePresence`、`judge(input)`、`platformSets({fetcher, repo})`；
`scripts/check-required-checks.js` 只做 CLI（`--repo=` / `--report` / `--json` / `--mode=advisory|enforce`）、
唯一 spawn 出口 `ghJson(args, spawnImpl)` 与打印。

**为什么把 spawn 留在 CLI 且让它可注入**（外部评审 i1 的直接后果）：判据本体一旦自己 spawn `gh`，
它就无法在"无 gh / 无令牌"的环境里被单测跑，而"取不到数"与"没有违规"这两档必须能被分别构造出来验证。
注入面存在的第二个理由是**出站形态必须可被测**：`ghJson` 收 argv 数组、`shell:false`，
外部输入（`--repo=` 解析后的值、workflow 文件名）只作为**单个数组元素**进 endpoint 并先 `encodeURIComponent`；
这条由 `scripts/check-required-checks.test.js` 用假 spawn 逐字断言（"不经 shell"这件事不能只靠读源码相信）。

**为什么先问"能不能不手抄"**：上一刀（`ci-judge-surface-coverage`）实测踩过"同一条事实有两份手抄清单、各漏一次 ⇒ CI 两轮红"。
本刀的 producer 映射**必须派生**（下面 D2）；**唯一允许手抄的是"我们打算要求哪些 check 是 required"**——
因为那本身就是被审计对象（平台侧被偷偷加/删时，得有一份仓内的"应当如此"才能算出差集）。这份手抄的漂移由双向判据兜，见 D3。

## D2 producer 派生：`jobs:` 区间内，`name:` 优先、job id 兜底；`on:` 块必须排除

实测（一次性探针 `scripts/tmp-required-probe.cjs`，跑在 18 份 workflow 上，`jobNameDecls=26 / distinctNames=41`）：

| context | 派生结果 |
| --- | --- |
| `QG Static` | `quality-gate.yml` job `static-gates`（显式 `name:`） |
| `QG Unit Tests` | `quality-gate.yml` job `unit-tests`（显式 `name:`） |
| `Gate Result` | `quality-gate.yml` job `gate-result`（显式 `name:`） |
| `QG Coverage` | `quality-gate.yml` job `coverage`（显式 `name:`） |
| `GUI Gate Result` | `gui-test.yml` job `gui-gate-result`（显式 `name:`） |
| `文档同步检查` | `doc-gate.yml` job `doc-sync`（显式 `name:`） |
| `单元测试 + Lint` | `doc-gate.yml` job `ci-tests`（显式 `name:`） |
| `债务熔断检查` | `debt-guard.yml` job `debt-guard`（显式 `name:`） |
| `electron-tests` | `electron-ci.yml:71` job **id**（无 `name:`） |
| `build` | `build.yml` job **id**（无 `name:`） |

⇒ 只认 `name:` 会把后两条判成"无产出者"，所以必须两条都认。

**现值（2026-10-27 本刀实现后复测，`node -e` 探针取 `deriveWorkflowChecks`）**：`files=18 decls=60 distinctNames=56 selfFault=null`。
其中**两个名字有多个产出者**：`changes`（job id，被 `build.yml` / `electron-ci.yml` / `gui-test.yml` / `quality-gate.yml` 四份共用）
与 `Changes`（显式 `name:`，`build.yml` + `electron-ci.yml`）。这决定了索引形态必须是 **名 → 产出者数组**：
按"名 → 唯一产出者"存会把后到的覆盖掉（第一版就是这样，`decls=57` 而 `size=56` 那一条差额就是被吞掉的第二个产出者），
而下游窗口探测一旦只看第一个产出者的 run 历史，另一个产出者真跑出的结论会**整批看不见**——
本仓登记面此刻恰好不含这两个名字（`QG Changes` 与 `Changes` 不同名），所以吞掉不改变现读结果，
但那是"下一个登记的人踩"的形状，已由 `required-checks.test.js` 的真实仓断言钉住（同名两产出者 ⇒ 数组必须给出两条）。

**探针与实现期间实测到的三条解析边界（都写进判据，都各有一条用例）**：
① 空行不结束 `jobs:` 区间（第一版把空行当区间尾 ⇒ `jobs` 里第一条空行之后全部丢失，28 个派生名里 quality-gate 的 job 一个都没有）。
② **注释行不结束区间也不当 job 名**：实测 `doc-gate.yml:96` 就有一行**零缩进**的 `# ===== 说明 =====`。此刻它躺在所有 job 之后所以无害，
但"两个 job 之间夹一行顶格注释"会静默吃掉后面的全部 job，而下游只会报"这条 required 没有产出者"——读者被告知的是"缺产出者"，真相是"解析断了"。
③ **按文件做退化检查**：某文件声明了 `jobs:` 却一条 job 都没认出 ⇒ 直接 selfFault 并点名该文件（现值 18 份文件每份都 ≥1 条，所以这条不会假红）。
只靠"全局集合为空"或"触发器名混入"两道退化检查抓不到②这类**局部截断**，因为残缺集合非空、也不含触发器名。
另外缩进锚必须按层：`name:` 只认恰好 4 空格（steps 的 6/8 空格 `- name:` 与 `with:` 里嵌套的 `name:` 都不是 check 名，实测有反控用例）。

**探针当场暴露的陷阱（写进规格，因为它的方向是假红）**：按"两空格缩进的 key"找 job 的朴素解析，会把
`on:` 下的触发器一起收进来——`build.yml` 实跑得 `["pull_request","push","workflow_dispatch","changes","build","release"]`、
`clock-shift-oracle.yml` 得 `["schedule","workflow_dispatch","clock-shift-oracle"]`。
真触发器名是封闭集 `{push, pull_request, workflow_dispatch, schedule, repository_dispatch, workflow_call, workflow_run}`，
所以判据两条都要有：① 解析先框 `jobs:` 顶层区间（遇到下一列 0 缩进的非空 key 即出区间）；② 派生结果断言**不含**上述触发器名，
命中即报"解析退化"走 rc=2，**不得**继续拿这个集合去判"谁没有产出者"。

## D3 对账面：双向差集，两句话各自指名

登记面 `scripts/required-checks.json`：

```
{ "required": [ { "context": "…", "producedBy": { "workflow": "…yml", "job": "…" }, "mechanisms": ["ruleset","classic"], "why": "…" } ] }
```

判据读平台两套机制取并集（**必须按 id 单独取 ruleset**：`/rulesets` 列表接口的 `rules` 字段恒为空，实测过），与登记面对账：

- **平台有、登记无** ⇒ 红：有人在平台侧加了 required，而仓内没有任何文件说明它是什么、谁产出它。
- **登记有、平台无** ⇒ 红：闸被摘了。（这一格是"偷偷摘闸"唯一的机械出口。）
- **登记里的 `producedBy` 与派生结果不一致** ⇒ 红：改名/搬家会让"谁产出这条"变成猜测。
- `mechanisms` 只做**如实记录**，不参与判定（一条 required 走哪套机制不影响它是否守门；判定只看并集）。

## D4 探测域：**producer workflow 自己的最近 run（push ∪ pull_request）**，不是 main push

### D4.1 立项时那个域是错的，本刀实测把它否证了

初稿写"看该 workflow 最近 N 次 **main push** 上这条 job 的结论"。实现完取现值时发现两件事：

1. `doc-gate.yml` 的触发器实测是 `pull_request` + `workflow_dispatch`，**根本没有 push 触发器**
   ⇒ 它产出的两条 required（`文档同步检查`、`单元测试 + Lint`）在 main push 上永远不存在，
   按 main-push 域会被判成"required 却从不在合并路径上"——**10 条里 2 条假违规**。
2. `QG Coverage` 在同一条域下判"恒 skipped"，而按正确域复测它是 `produced`（见 D5 的撤账）。

根因是范畴错误：**required status check 挡的是"合并"，所以它的结论只可能出现在 PR 的 check suite 里**；
main push 上有没有产出与它是否守门无关。所以窗口 = 该 producer workflow 最近的 run，事件集合 `{push, pull_request}`
（两者都是"合并路径上"的形态；`schedule` / `workflow_dispatch` 的 run 里 job 结论与第三方合并无关，收了会把
"只在夜间跑"的作业读成合规）。扫描面 `MAX_SCAN = 50` 条该 workflow 的 run 再按事件过滤——**过滤放客户端**，
因为 `event=` 查询参数只收单值，而"取到 0 条"必须是**扫够了**才允许成立的结论。

### D4.2 四档读数 + 一档失明（逐档动作不同，不得合并）

| 档 | 条件 | 判定 |
| --- | --- | --- |
| `produced` | 窗口内该 job **出现过终态结论**，且至少一次不是 `skipped` | 通过 |
| `always-skipped` | 出现过终态结论，但窗口内**每一次**都是 `skipped` | **违规**（required 却永不产出结论，本刀立项的那格病） |
| `absent` | 取到 ≥1 条该 workflow **已跑完**（`status=completed`）的 push/PR run，而它的作业清单里根本没有这个名字 | **违规**（派生说它在该文件里、已完成的现场却不认识它：多半是 job 改名/删除或形态差异） |
| `no-run` | 扫描面内（未触及 `MAX_SCAN`）该 workflow **没有一条 push/PR run** | **违规**，且文案必须点名"扫了几条、最近一条是什么事件" |
| `selfFault` | 取不到数（无 gh、403、非零、不可解析）、`fetched` 没被显式证明、窗口内只有未定论读数（`null` / in_progress）、或扫到 `MAX_SCAN` 仍无样本 | **rc=2 未证实**，绝不读成"没问题" |

四条要记住的口径：
- **`fetched` 必须由调用方显式给 `true`**。「我没证明取到了数」与「取到了、一条都没有」动作相反（修取数 vs 修那条检查），
  缺省即 selfFault。这是外部评审 i5 指出的"读数与窗口关系没说清"落到实处的那一格。
- **`conclusion === null` 不是结论**（GitHub 对 in_progress / queued 的 job 给 `null`；实测窗口里就有）。
  只见到未定论 ⇒ selfFault；`skipped` 与 `null` 混在一起时，已有的 `skipped` 判 `always-skipped`，未被 null 洗白。
- **「名字不在清单里」也不是结论**（2026-10-28 首档 CI 之后补的第四条口径，原判据表缺这一格）。
  GitHub 对**没跑完的 run** 只给部分作业清单，排在后面的作业还没长出来 ⇒ 缺席证据只能由 `status=completed`
  的 run 给出；在飞的 run 与 `status` 本身没给的 run 一律计入未定论。反例现场见 D12.2。
- **多产出者聚合优先级**：任一产出者失明 ⇒ selfFault；任一产出者真跑出非 skipped ⇒ produced；
  有 run 却不认识这个名字 ⇒ absent；全都没跑 ⇒ no-run；余下 ⇒ always-skipped。
  次序写成"先真结论、后坏消息"，理由与吞掉第二个产出者是同一格：**一个产出者的 no-run 不得洗白另一个的恒 skipped**。

### D4.3 现值与成本（活数，引用时重跑 `node scripts/check-required-checks.js --report`）

2026-10-27 本机实测（用户令牌档，能读平台清单）：
`REQUIRED-CHECKS-SCAN required=10 derived=56 multi=0 drift=0 dead=0 noRun=0 unproven=0 debtAck=0 verdict=PASS`，
10 条全部 `form=produced`；`drift=0` 同时意味着**双向差集为空**——仓内登记面逐字等于平台两套机制的并集。
成本：45 次 `gh api`（6 个 producer workflow × (1 次 run 列表 + 6 次 jobs) + 3 次平台清单），本机 65 秒。
落点 `changes` 作业预算 5 分钟，可容纳；但**必须如实知道**：这是"每次 PR 都出网 65 秒"，属本刀新增的 CI 侧成本，
也是 D6 把首档定成 advisory 的第二条理由。
取数面的两条口径（D10 R2-i7 / R3-i8 采纳落点）：**缓存只在一次跑内按 workflow 去重**（`windowFor` 的 `cache`，
同名多产出者共享同一份窗口；跨 run 不缓存——平台状态必须当场读，缓存它等于给自己发一张过期免检牌）；
**每次调用带硬超时** `GH_TIMEOUT_MS = 20000`（`MP_REQCHECK_GH_TIMEOUT_MS` 可覆盖，非法值回落并出声）且**不自动重试**——
本锁的动作出口本来就是"没取到 ⇒ 未证实"，重试只是花更多时间掩盖它。GitHub 侧的速率限制不在本刀处理：
45 次/PR 远低于认证档配额，真被打限时 `gh` 非零退出 ⇒ 走 `selfFault`（rc=2 未证实），方向是保守侧。

## D5 存量欠账：现读**零条**，上限 `MAX_DEBT = 0`；立项时那条已被实测否证并原样留档

**先写否证，因为它改的就是本刀的立项理由。** 立项时我在 `required-check-debt.json` 里登记过一条 `QG Coverage`，
理由是「实测最近 6 次 main push 上该作业全部 skipped」。那句话**作为那句话是真的**（`gh api` 现场可复算），
但作为「required 却永不产出结论」的证据是**错的**——取数域只看了 main push（见 D4.1）。按正确域复测：
`QG Coverage form=produced`，窗口里 run `40466480976` 上它是 `failure`，PR 档照常发火；
而它在 push 侧 skipped 是 **2026-10-25 change `ci-push-heavy-job-dedupe` 的明文决定**
（`quality-gate.yml:1705` 起那段注释：PR 侧验 merge preview、push 侧不是同一棵树 ⇒ 重复劳动）。
处置：撤登记、`MAX_DEBT` 由 1 退回 **0**、原错误说法保留在 `required-check-debt.json` 的 `_否证记录` 里并标注不实，
由 `required-checks.test.js` 断言这段留档存在（只删登记不写原因，下一个会话会重新长出同一条）。
**连带结论**：用户手上那条待裁决（"QG Coverage 是不是假闸"）**问题不成立**——它既不是假闸，也不是需要三选一处置的缺陷。

欠账面的三条形状（与上一刀豁免清单同口径）：

- 值是**非空 reason 字符串**，且必须写清重取命令与证据坐标；空串/对象/`true` 一律红。
- 键**必须仍是登记面里的 context**（`validateDebt` 直接测：不再是 required 的名字 ⇒ "陈旧登记"红），
  所以"错配"不是未定义行为而是红（外部评审 i6 指的那一格实际已有实现与用例）。
- `_` 前缀的键（`_comment` / `_否证记录`）**不计数**，因此"留档"与"欠账"是两个面，写说明不会把上限吃满。

**`MAX_DEBT` 为什么必须是代码常量、不能是债文件里的一个字段**（外部评审 i2 建议加 `maxDebt` 字段，这条被实测否证）：
放进 `required-check-debt.json` 就等于让**同一次编辑**既能新增欠账、又能把上限一起抬——那是"放宽谁来守门"最省事的形态，
而机械闸门唯一能拦住它的地方就是让上限与差量分家。现在的锁定是双向的：
`validateDebt` 在判据里数条数并与 `MAX_DEBT` 比（红文案 `欠账条数 N > 上限 0`），
`required-checks.test.js` 再钉一条 `Object.keys(debt).length === RC.MAX_DEBT`（把上限调大而不加欠账、或加欠账而不抬上限，都当场红）。
读判据首行的 `debtAck=` 能在现场看见"有几条违规是被欠账承认掉的"——现读 0。

## D6 接线与档位：`changes` job、bash fail-fast、advisory 起步；转 enforce 的前置条件写成整数与命令

`Gate 2b17` 落在 `quality-gate.yml` 的 `changes` job（该 job 无 `if:` 门控 ⇒ docs-only 不会被短路，这是"吃白名单输入的门禁必须住在这里"的既有口径），
`shell: bash`（一个 `run:` 块里多条命令必须 fail-fast，PowerShell 不拦中间失败是 AGENTS 明文教训），
三条命令各管一件事：两把回归锁 + 判据本体 `--report --mode=advisory`。

**先 advisory**，两条实测理由：① 本判据出网读 GitHub 平台状态，runner 侧 `gh api` 瞬断与**令牌 scope 不足**是新增失败面
（本仓实测过闸门被 TLS 瞬断打成 `SELF_FAULT exit=4`）；② 每次 PR 增加约 45 次 API 调用 / 数十秒（D4.3 本机实测 65 秒）。
第一刀就阻断等于把与代码无关的抖动接进 required。

转 enforce 的前置条件（把外部评审 i4/i8 说的"若干次 / 阈值没给数"落成整数；每条都给现取命令）：

- **⓪ CI 档能读到平台清单**。**2026-10-28 已由第一次真实 CI 跑回答，答案是「读不到」**：
  run `40626699654` / job `122613218719` 的 Gate 2b17 步骤日志原文
  `UNPROVEN 平台清单取不到：classic protection 取不到：gh: Resource not accessible by integration (HTTP 403) (gh rc=1)`
  ＋ `MODE=advisory verdict=UNPROVEN rc=2`，而同一步的仓内侧读数照常是 `required=10 derived=56 drift=0` ⇒
  **登记面对账这一半在 CI 里能用，平台侧那一半要人工加权限**。现值：`quality-gate.yml` 全文没有 `permissions:` 键，
  仓库的 `default_workflow_permissions` 实测读回 `null`（未显式设定）⇒ 作业令牌对 `branches/main/protection` 是 403，
  用户令牌档本机现读能读。正解**不是**把判据改成不看平台侧，而是人工给作业加 `permissions: administration: read`
  （原写 `write`，按 403 的性质收窄为 read；属改令牌权限，人工裁决）。
  ⚠ 这条的前置还有一格是本轮补上的：那一步原本连令牌都没拿到（`gh rc=4`「set the GH_TOKEN environment variable」），
  已补 `env: GH_TOKEN: ${{ github.token }}`——没有它，⓪ 会被误读成"平台拒绝"，而真实成因是"根本没出示凭证"。
- **① 连续 5 次** main push / PR 上 `verdict=PASS`（不是 `UNPROVEN`），且 `dead=0`。重取：
  `gh run list --workflow=quality-gate.yml --limit 20` 逐 run 看 `QG Changes` 步骤日志里的 `REQUIRED-CHECKS-SCAN` 行。
- **② rc=2 占比 < 10%**，分母取**最近 20 次**判据运行；且残留的 rc=2 必须能归因到同一类取数面。
  重取：`gh run list --workflow=quality-gate.yml --limit 20 --json databaseId,conclusion` + 逐步 grep `verdict=`。
- **③ 不做 `--simulate-enforce`**（i4 的另一半建议），理由写在 D8 第 5 条：判定域是 producer workflow 的 run 历史，
  **与本次 PR 的差量无关**（除该 PR 自己改了 `.github/workflows/**`、登记面或欠账面），所以同一时刻所有在飞 PR 得到**同一个** verdict。
  "最近 N 个在飞 PR 有几个会红"这个数只可能是 `0` 或 `N`，模拟模式测不出新信息。

任何一条不成立就保持 advisory；把 advisory 翻成 enforce 属改「谁来守门」，**另开 PR 且人工过目**。

## D7 反证计划（每条变异都要指名红，红集互不相同；被禁形态本身要各测一次）

> 下表的「期望」列已按 **2026-10-27 实跑读数**改写；计划值与实测的差异逐条记在 D7.2。
> 载体是变异驱动 `scripts/check-required-checks.mutation.js`：每条变异登记**实测红集**
> （用例名 + 消息子串），**少红、多红、消息对不上都判该行红**——只对名字不够，
> 多条变异会点着同一把锁（当场实测：M-E 同时红 `lib#14` 与 `lib#24`；M-F2 红 5 条，跨过 lib/cli 两侧；
> M-P / M-P2 都红 `cli#4`），
> 消息子串才是把它们分开的第二维。
>
> 编号约定：`lib#N` = `scripts/lib/required-checks.test.js` 第 N 条用例（24 条），
> `cli#N` = `scripts/check-required-checks.test.js` 第 N 条用例（18 条）。
> **重取编号**（D11 R3-i7 采纳项，外部审计不必相信本文）：
> `grep -n '^test(' scripts/lib/required-checks.test.js` 与同形命令按输出顺序从上往下数即得 `lib#N`/`cli#N`。
> ⚠ 序号是按**文件内出现顺序**数的，所以新增用例一律**追加到文件末尾**——插到中间会让本表所有
> `lib#N`/`cli#N` 引用整体位移，而变异驱动只按**用例名**对账，绝不会有东西替这些错位报警（D10 实测：
> 两条新锁先插在中间、后被移到末尾，正是为了保住这张表的坐标）。

| 靶子 | 改法 | 实测红集（用例 + 消息指纹） |
| --- | --- | --- |
| M-A | 派生时不框 `jobs:` 区间（删掉区间守卫） | `lib#5`（`jobs 用四空格缩进的文件必须报退化`）——**不是**计划里的 `lib#3`，见 D7.2 |
| M-B | 只认 `name:`、去掉 job id 兜底 | `lib#1`（`Cannot read properties of undefined (reading 'workflow')`）+ `lib#19`（`派生规模退化`） |
| M-C | 差集只留"平台有而登记无"单向 | `lib#9`（`平台要求而仓内未登记的 check：其它`）——违规数组里**没有**被摘掉的那条，见 D7.2 |
| M-D | 窗口域退回"只看 push 事件" | `cli#10`（`把域缩回"只看 push"`）+ `cli#12`（`每条 run 取一次 jobs`） |
| M-E | `absent` 与 `no-run` 合并成一档 | `lib#14`（`'no-run' !== 'absent'`）——是 `strictEqual`，不是 `equal`，见 D7.2 |
| M-F | `judge` 把 `selfFault`（取不到读数）读成合规 | `lib#13`（`实得 rc=0`）+ `cli#11`（`form=selfFault`）+ `cli#15`（`超时档必须被念出来`）——新加的超时锁也抓住这一格，见 D10 R1-i1 |
| M-F2 | `judgePresence` 把 `selfFault` 读成 `produced` | `lib#14`（`扫到上限仍没样本`）+ `lib#15`（`任一产出者取不到数`）+ `cli#11`（`form=produced`）+ `cli#15`（`超时档必须被念出来`） |
| M-G | `MAX_DEBT` 抬到 1 但不放欠账 | `lib#20`（`抬上限＝人工放宽谁来守门`） |
| M-H | 欠账项 `reason: ""` 不再判违规 | `lib#16`（`抬上限是在放宽「谁来守门」）`）——红的**不是**"空 reason"那条，见 D7.2 |
| M-I | 删掉 Gate 2b17 的接线 | `cli#13`（`未接线（注释里提一句不算）`） |
| M-J | 空行结束 `jobs:` 区间（退回第一版实现） | `lib#23`（`空行后的 job 丢了：a,A`——**指名这一格的独立锁**）+ `lib#6`（`注释后的 job 丢了：a,A`，与 M-K 同名同消息）+ `lib#19`（`派生规模退化`） |
| M-K | 顶格注释结束 `jobs:` 区间 | `lib#6`（`注释后的 job 丢了：a,A`）——与 M-J **同名同消息**，见 D7.3 |
| M-L | 派生索引退回"名 → 唯一产出者"（覆盖式） | `lib#7`（`"workflow":"electron-ci.yml"`）+ `lib#19`（`派生对同名多产出者的读数变了`） |
| M-M | `fetched` 缺省视作 true（把失明读成"没跑"） | `lib#14`（`没证明取到数就是失明`） |
| M-M1 | 取数失败兜成"一条 run 都没扫到" | `cli#11`（`form=no-run`）+ `cli#15`（`超时档必须被念出来`） |
| M-N | 把 `conclusion === null`（in_progress/queued）当终态结论 | `lib#14`（`in_progress/queued 不是结论`） |
| M-O | 平台并集为空时继续按差集判"十道闸都被摘" | `lib#22`（`仓内登记而平台没有的 check：A`） |
| M-P | `ghJson` 退回 `shell:true` | `cli#4`（`shell:true 会把数组重新拼成一条命令串`） |
| M-P2 | `ghJson` 把 endpoint 拼成一条串（`shell` 仍为 false） | `cli#4`（`输入必须原样留在数组元素里`） |
| M-Q | 登记面读不到返回空集合而不抛错 | `lib#17`（`Missing expected exception.`）+ `cli#9`（`REQUIRED-CHECKS-SCAN required=0`） |
| M-R | 403 与 404 合并（都当"该机制为空"） | `lib#21`（`平台并集为空（两套机制都没读到任何 required 上下文）`）+ `cli#8`（`UNPROVEN 平台清单取不到`） |
| M-S | `REPO_SHAPE` 退回旧写法（点段 `..` 又能进 endpoint） | `cli#14`（`点段必须整串拒绝`）——D10 R3-i1 采纳项 |
| M-T | `ghJson` 不传 `timeout`（挂死的 gh 吃掉整个作业预算） | `cli#15`（`不传 timeout 就没有任何硬超时`）——D10 R3-i8 采纳项 |
| M-T2 | 把「超时」并回「gh 不可用」一句 | `cli#15`（`gh 不可用：ETIMEDOUT`）——与 M-T 同红一把锁，**靠消息分开**（两支的 `status` 都是 null、`stderr` 都空，只有 `error.code` 可分辨） |
| M-U | `readDebt` 不再过滤 `_` 前缀 | `lib#20`（`欠账条数 2 != MAX_DEBT 0`）——现读真实欠账文件有 2 个 `_` 键，摘掉过滤就把留档算进上限 |

### D7.1 实跑读数（2026-10-27）

驱动：`node scripts/check-required-checks.mutation.js`（本机 Node v22.23.1；`--only=<id>` 单跑一条，`--list` 列台账）。
末行读数：

```
SUMMARY TOTAL=24 MUTATIONS=21 CONTROLS=3 ATTEMPTED=24 NAMED=21 CONTROL-READINGS=S0-CONTROL-SYNTAX=PROBLEM S0b-CONTROL-LOADFAIL=LOADFAIL S1-CONTROL-NEGATIVE=NORED OVERLAP-UNDECLARED=0 RESULT=OK
```

**2026-10-28 重跑（D10 采纳项落地后，这是引用时应使用的现值；上面那行是 10-27 的历史读数，保留以说明演进）**：

```
SUMMARY TOTAL=28 MUTATIONS=25 CONTROLS=3 ATTEMPTED=28 NAMED=25 CONTROL-READINGS=S0-CONTROL-SYNTAX=PROBLEM S0b-CONTROL-LOADFAIL=LOADFAIL S1-CONTROL-NEGATIVE=NORED OVERLAP-UNDECLARED=0 RESULT=OK
```

- 两次跑都是 **100% `NAMED`**：每条变异都点着至少一条**指名**红，且红集与台账**逐条相等**（少红、多红、消息对不上都算失守）。
- **3 个控制项读出设计好的档位**（控制项的读数**不混进**变异的判定直方图，汇总行分开印）：
  `S0-CONTROL-SYNTAX=PROBLEM`（改坏成语法错 ⇒ 判"我改坏了文件"，不得读成"锁没牙"）、
  `S0b-CONTROL-LOADFAIL=LOADFAIL`（require 期抛错 ⇒ 整片红）、
  `S1-CONTROL-NEGATIVE=NORED`（只改注释 ⇒ 一条红都不出，证明红来自行为而非"文件被碰过"）。
  驱动的**自身**故障（md5 不符 / 锚点未命中 / NOOP）**不得**满足任何一档控制项。
- **MISSED 三档（锁没牙 / 冗余防御 / 本机不可证）无成员**：25 条变异无一 MISSED。
  这一栏为空是**实测结论**，不是"还没查"。
- **未声明重叠 0**；唯一一对同名同消息的重叠是 `M-J × M-K`，已在驱动里用 `overlaps` 显式声明并写明理由
  （`OVERLAP-PAIR-DECLARED M-J × M-K pairs=1`）。**这条声明在 D10 之后仍然成立**——新增的 `lib#23`
  让 M-J 有了指名自己的独立锁，但 `lib#6` 那条夹具按真实文件形状写（空行紧挨顶格注释），
  它的消息对两条变异确实相同，所以声明留着才是诚实陈述（D10 R2-i4 的处置口径）。
- **还原完整性**：跑完 `git status --porcelain` 与跑前逐字相同，三个靶子的 md5 与基线一致
  （`scripts/lib/required-checks.js` `8734e2af…`、`scripts/check-required-checks.js` `8bd86641…`、
  `.github/workflows/quality-gate.yml` `81e42a2f…`）。变异驱动自己还原文件，**不靠人工回滚**。

### D7.2 计划与实测的差异（逐条更正）

| 靶子 | 计划写的 | 实测 | 为什么不一样 |
| --- | --- | --- | --- |
| M-A | 红在「`on:` 触发器不得进 job 集」（`lib#3`） | 红在 `lib#5` | `lib#3` 断言的是**否定式**（"触发器名不得进 job 集"），而触发器名被排除这件事**双处实现**：`L100` 的 job-id 路径本就过滤 `TRIGGER_NAMES`，`L114` 的泄漏守卫只是兜底。删掉 `jobs:` 区间守卫后 `hasJobs` 恒假 ⇒ `L109` 的**按文件**退化检查永不触发 ⇒ `lib#5` 先红；`L100` 的过滤还在 ⇒ 触发器名仍进不了 job 集 ⇒ `lib#3` 保持绿。**结论：`lib#3` 对"区间守卫被摘"这一格结构性免疫**，抓住它的是 `lib#5`。（`lib#3` 要真能独立抓这一格，得把 `L100` 的过滤也摘掉——那是另一条变异，本刀没排。） |
| M-B | 红在「`electron-tests`/`build` 有产出者」 | `lib#1` 消息是 `Cannot read properties of undefined (reading 'workflow')` | 摘掉 job-id 兜底后 `first(d,'electron-tests')` 返回 `undefined`，**先炸在取值上**而不是"少了产出者"上。真实仓那条另红在 `lib#19`（派生规模变化）。 |
| M-C | 红在「登记有而平台无 ⇒ 闸被摘」 | 红在 `lib#9`，但消息（违规数组的 JSON dump）里**只有**「平台要求而仓内未登记」那条 | `lib#9` 断言的是"违规数组里**存在** `仓内登记而平台没有`"。被摘掉那半后该条违规消失、断言失败，失败消息 dump 出来的数组里剩的是**另一半**违规 ⇒ 用例名与红文案对不上是正常的（红文案是 dump，不是断言目标）。 |
| M-E | 预期是 `'no-run' == 'absent'` | 实测 `'no-run' !== 'absent'` | 该断言用的是 `assert.strictEqual` ⇒ Node 的消息是 `!==` 形态。**预期值写错会让台账永远对不上**，故以实测为准。 |
| M-F | 红在"selfFault ⇒ rc=2" | 实测**两条**：`lib#13` + `cli#11` | lib 侧判 `judge`，CLI 侧另有一条"取数失败不得被兜成 no-run"的锁 ⇒ 同一次变异点着两把锁。**计划只点了一把 ⇒ 计划漏记，不是实现多红。** |
| M-F2 | 计划未单列 | 三条：`lib#14` + `lib#15` + `cli#11` | `judgePresence` 那一层把 `selfFault` 改成 `produced`，先被 `lib#14`（分类五档）抓住，再被 `lib#15`（多产出者聚合）抓住，CLI 侧还有一条。 |
| M-H | 红在"空 reason 不成立" | 红在 `lib#16`，但红文案是「欠账条数 1 > 上限 0」 | 摘掉空 reason 的判据后，那条欠账**不再算违规却仍在计数** ⇒ 先撞上的是**上限**那档。台账用这条文案当指纹，等于钉住"空 reason 那条违规确实不在数组里"。 |
| M-J | 红在真实仓自洽（`derived` 规模退化） | 实测 `lib#23` + `lib#6` + `lib#19` | 夹具那条（`lib#6`）与 M-K **同名同消息** ⇒ 只看它不可分辨；D10 R2-i4 补的 `lib#23` 是 M-J 指名自己的独立锁。 |
| M-K | 红在"注释不得结束 jobs 区间"用例 | 同上，`lib#6` | 与 M-J 共享同一条红 ⇒ 见 D7.3 的显式声明。 |
| M-M | 红在"没证明取到数就是失明"与 CLI 那条 | 实测只红 `lib#14` | CLI 那条锁（`cli#11`）守的是**取数失败被兜成 no-run**（那是 M-M1 的改法），不是 `fetched` 缺省 ⇒ 计划多写了一条。 |
| M-N | 红在"只有未定论读数 ⇒ selfFault"与"skipped+null 混合仍判恒 skipped" | 实测只红 `lib#14` | 第二条锁在真实仓读数下**不成立**（仓内没有 skipped+null 混合的样本），它由 `lib#14` 顺带覆盖 ⇒ 计划点名了仓库里读不到的那条。 |
| M-R | 红在两条各自：404 走 note、403 走未证实并出 UNPROVEN-HINT | 实测**两条**：`lib#21` + `cli#8` | 与 M-F 同型：计划只点了一把锁，实测点着两把。 |

### D7.3 唯一一对重叠（M-J × M-K）：显式声明而不是放宽判据

两条变异都作用在**同一个位置**——夹具里"空行"与"顶格注释"相邻，任缺一条守卫都在同一处截断 `jobs:` 区间 ⇒
**同一条锁以同名同消息**（`lib#6` / `注释后的 job 丢了：a,A`）抓住两条变异 ⇒ 只看名字**不可分辨**。
区分靠**红集**：M-J 额外红 `lib#19`（真实仓的 `jobs:` 块里有空行，而零缩进注释全在最后一个 job 之后 ⇒
真实仓那条只对"空行结束区间"敏感），M-K 不红。
**D10 R2-i4 之后这一格有了更直接的出口**：新增 `lib#23`（夹具只有空行、没有顶格注释）⇒ 摘掉空行守卫
当场红在 `lib#23`，摘掉注释守卫不红它。`overlaps` 声明**仍然保留**——`lib#6` 那条夹具按真实文件形状写
（实测 `doc-gate.yml` 95 行空行、96 行零缩进注释），它的消息对两条变异确实相同，删掉声明等于假装这格不存在。

处置：**在驱动里显式声明重叠并写明理由**（`overlaps: { with: 'M-K', reason: … }`），
驱动按**同名同消息**做配对级检查 ⇒ 声明过的打印 `OVERLAP-PAIR-DECLARED M-J × M-K pairs=1`，
未声明的打印 `OVERLAP-PAIR-UNDECLARED` 并把整批判红。
**不许**用"放宽成只要有一条红就算过"来消解——那会同时放过"少红"这一格。


## D8 刻意不做（写清，避免下一个人以为已覆盖）

1. **不碰 GitHub 侧配置**：加/摘 required、改 ruleset 都属改谁来守门，须人工。本刀只让"平台与登记不一致"变红。
2. **不判"结论对不对"**：作业跑了但断言恒真，这把尺看不见（归 `check-unwired-tests`、变异反证与 `Gate 2b16` 那族管）。
3. **不做 schedule 版**：没有 PR 的时段平台侧被改动不会立刻出声，本刀接受"下一次 PR 时发现"，schedule 版作为具名欠账登记（先例：`clock-shift-oracle.yml`）。
4. **不把 `mechanisms` 做成判据**：一条 required 挂在哪套机制不影响它是否守门；拿它判定会造出"改了机制名就假红"的面。
5. **不做 `--simulate-enforce`**（外部评审 i4 的建议，被实测否证其价值）：判定域是 producer workflow 的 run 历史，
   与本次 PR 的差量无关（除非该 PR 自己改 `.github/workflows/**` / 登记面 / 欠账面）。
   所以"最近 N 个在飞 PR 有几个会红"只可能是 `0` 或 `N`——模拟模式给出的信息量等于直接看一次 `verdict=`。
   真要防的是"翻转那一次没人看数"，那条由前置条件 ⓪–② 的现取命令负责。
6. **不建模 matrix 后缀名**（`QG Desktop Shards (1/2)` 这类）：jobs API 的 `name` 带分片后缀，与登记面的裸名不同形。
   现读不碰它是因为登记面刻意只收**聚合作业**（`Gate Result` / `GUI Gate Result`），这也是仓库把分片名排除出 required 的既有理由；
   若哪天有人把带后缀的名字登记进来，`absent` 会红并点名——那是"发现"而不是"漏"，但**不得**为此把判据改成前缀匹配。
7. **不代改令牌权限 / 分支保护**：见 D6 前置条件 ⓪。403 的正解是人工加 `permissions`，不是把判据改成不看平台侧。

## D9 外部评审（设计轴）逐条处置

评审产物：`.adversarial/ccg-plan-design-required-checks-ledger-claude/critique-v1.md`（critic=claude，8 条：3 Critical / 3 Warning / 2 Info，最低维分 security=4）。
**处置口径**：采纳"要防的那一格"，不照抄"提的修法"；每条给实测。第 1 轮的 proposer 轴（opencode）因载荷 9958 字符超上限 7800 未收敛，
按引擎自己的建议把方案拆小重跑（见本节末）。

| 条 | 判定 | 依据与落点 |
| --- | --- | --- |
| i1 Critical 命令注入 | **部分否证 + 采纳其一半** | 否证：lib 不 spawn（实测 `grep child_process scripts/lib/required-checks.js` = 0 命中，只 require `node:fs`/`node:path`），平台读数经 `platformSets({fetcher})` 注入。采纳：CLI 的 spawn 形态必须可测 ⇒ `ghJson(args, spawnImpl)` 收 argv 数组、`shell:false`，`--repo=` 的形态白名单**作用在解析后的值**（默认档从 gh 取回的名字同样过闸）；落 D1 + 两条用例（M-P）。建议里的"shell-quote 规则"不采纳——不经 shell 就没有 quoting 问题，加引号处理反而是把 shell 请回来。 |
| i2 Critical 上限无法机械锁定 | **否证** | 锁定在判据代码里：`validateDebt` 数条数并与 `MAX_DEBT` 比并红，`required-checks.test.js` 钉 `keys === MAX_DEBT` 双向。审稿给的另一个选项（"移入判据代码并在出口打印"）正是现有实现。为什么不放文件字段：放债文件里＝同一次编辑既加欠账又抬上限，那是最省事的放宽形态；`debtAck=` 已在首行打印。落 D5。 |
| i3 Critical 数据文件缺席未定义 | **采纳（一半已在实现里）** | lib 已有行为：登记面缺席/非法 JSON/缺 `required`/条目缺 `context`/`producedBy`/`why` ⇒ **抛错**（不返回空集合，否则"零漂移"与"没登记面"同形）；欠账文件缺席 ⇒ 零欠账（安全方向）；workflow 目录读不到/为空 ⇒ selfFault。缺的是**规格没写**且 CLI 的异常→rc 映射没定 ⇒ 补 spec 一条 Requirement + CLI 三处 catch 统一 `SELF-FAULT rc=2`（参数错、文件读不到、gh 抛错）。落 M-Q。 |
| i4 Warning enforce 前置无量化 | **采纳，但只采纳"给整数"那一半** | D6 写成 ⓪–②：CI 能读到平台清单 / 连续 5 次 PASS / 最近 20 次里 rc=2 占比 <10%，各带现取命令。`--simulate-enforce` 否证其信息量（见 D8 第 5 条：verdict 与 PR 差量无关 ⇒ 只会是 0 或 N）。 |
| i5 Warning 窗口与"实际扫了几条"矛盾 | **采纳，且它暴露了真缺陷** | 原设计同时写了 `no-run`（byDesign）与"扫到 0 条走 selfFault"，而 lib 里两者不可区分——两条出口在实现上会撞。修法不是补文案，是把"取到数"变成显式前提（`fetched===true`）并把 `no-run` 重定义为"扫够了且真没有"，同时 `scanned` 与 `MAX_SCAN` 到顶各自成档。落 D4.2 + M-M/M-N。 |
| i6 Warning 债务键映射隐式 | **否证** | 已实现并有用例：`validateDebt` 对不在 required 并集内的键报"陈旧登记"（lib `!required.includes(k)`），测试「欠账四条」第三条指名。`_` 前缀键不计数，所以"留档"不会吃上限。 |
| i7 Info 解析退化在注释/嵌套下失效 | **采纳，并扩到两处它没说的地方** | ① 顶格注释确实会结束区间：实测 `doc-gate.yml:96` 有零缩进 `#` 注释（此刻躺在所有 job 之后所以无损，但形状是哑雷）⇒ 注释行跳过 + M-K 用例；② 它没说的：加**按文件**的退化检查（声明 `jobs:` 却 0 条 ⇒ 点名该文件），因为局部截断既不使全局集合为空也不引入触发器名，两道旧退化检查都抓不到；③ 嵌套 `name:`（steps 的 6/8 空格、`with:` 里的 `name:`）由缩进锚 `^ {4}name:` 排除，有反控用例。 |
| i8 Info rc=2 占比无测量机制 | **采纳为"给命令"，不采纳为"另建台账"** | 分母就是 `QG Changes` 步骤日志里的 `verdict=` 行，命令写在 D6 ②。自建"最近 20 次运行"台账要往仓库里塞一个自增写面（本仓刚因热写面冲突把 `CHANGELOG`/`learnings` 收成聚合器单写），且它记录的仍是同一句话 ⇒ 不做。 |

## D10 设计轴第二轮评审（3 轮 × 8 条）逐条处置

评审产物：`.adversarial/ccg-plan-design-required-checks-ledger-v2-claude/`（critic=claude，proposer=codex；三轮各 8 条，Critical 2→3→4，最低维分 5→5→4；第三轮分数回退触发回滚，裁决 **blocked**，入口 rc=1）。
**产物只在盘上**：实测 `.gitignore:543` 忽略 `.adversarial/`（`git check-ignore -v` 命中该条），所以本文与执行记录里的每条引用都以「重取命令」为准，不承诺仓内可查。

**这一轮为什么跑得起来（上一轮为什么跑不起来）**：被拒的是 `callReviser`（proposer 侧）而不是 critic——`model-call.js` 的 `BACKEND_INPUT_LIMIT` 只给 opencode 设 7800 字符，claude/codex 无守卫；而修订载荷 = 方案全文 + critique JSON + schema 提示 + 角色提示，上一轮实测 9958 = 方案 5638 + 固定开销 ≈4320 ⇒ 用 opencode 时方案预算只剩 ≈3400 字符。处置**不是砍方案**（那会把评审对象削掉），而是把 proposer 换成 **codex**（无输入守卫）。跨家族仍成立：`FAMILY_MAP` 里 `codex: [openai]` 与 `claude: [anthropic]` 交集为空，`familyCheck` 判 ok。驱动打印的 `proposer=codex(undefined)` 是**显示层缺陷**（它读 `fam.resolved`，而 `familyCheck` 返回 `proposerFamily`/`criticFamily`）——判定用的是家族数组，不是没查到。
**为什么换个文件名再评**：决策层产物 slug 只用方案文件名 + critic（`ccg-plan-<basename>-<critic>`），`design.md` 在多个 change 里同名会覆盖别人的现场；本仓 `plan-review.sh` 的碰撞守卫实测拦下这条路（`MP_ALLOW_PLAN_COLLISION=1` 会覆盖 tracked 产物，不用）。故被评审副本命名为唯一名。
**评审对象没被改写**：回滚后引擎把"分数最好的一版"写进 `plan-reverted.md`，实测与 `openspec/changes/.../design.md` 逐字节相同（md5 `f3a54e9483cd2b1a5ff9e5aaa9718934`）；proposer 的编辑只活在 `plan-v2/v3.md`，没进主干。

| 条 | 判定 | 依据与落点 |
| --- | --- | --- |
| R1-i1 Critical 变异重叠未声明 | **否证 + 采纳可追溯那一半** | 驱动的重叠判据是「红名集与消息集是否完全相同」，整集相同而未声明 ⇒ `OVERLAP-UNDECLARED` 且 `RESULT=FAIL`；实测 `OVERLAP-UNDECLARED=0`。M-P/M-P2 同红 spawn 出口那把锁，但消息不同（`shell:true 会把数组重新拼成一条命令串` vs `输入必须原样留在数组元素里，不拼串`），按消息维可分。采纳的呈现问题：台账只报"N/N NAMED"看不出每条红落在哪 ⇒ 记录与 PR 评论必须抄**逐行读数**（`[M-x] verdict=NAMED reds=k` + `red#n name=/msg=`，驱动本就逐条打印），引用时现跑。 |
| R1-i2 Critical 403 被读成静默放行 | **否证** | advisory 恒 rc=0，但 `verdict=UNPROVEN rc=2` 与 `unproven=` 分母都在首行念出来；CLI 对含 403 的 UNPROVEN 另打一行 `UNPROVEN-HINT`，点名"多半是 GITHUB_TOKEN 缺 administration 档，不是平台没要求"。锁：cli「平台清单 403 ⇒ rc=2 未证实 + 出声指路」、lib「404 与 403 动作不同」。建议的 rc=3 **不采纳**：退出码是闭集 0/1/2（加一档要改两个合并入口与既有锁），而它要防的那一格已由 HINT 承担。 |
| R1-i3 / R2-i8 / R3-i2 M-A 锁点写错 | **否证（主干文本已是对的）** | 本文 D7 表现行写的就是 `lib#5` 并标"不是计划里的 lib#3"，D7.2 解释 `lib#3` 为何结构性免疫（触发器名被排除是双处实现，摘掉区间守卫后 `L100` 的过滤还在）。critic 读到的是 proposer 改后副本里被改回旧值的那句；回滚后未进入最终文本。 |
| R1-i4 Warning controls 未覆盖 fetched 独立性 | **否证** | 三枚 controls 量的是"尺自身"（语法坏⇒PROBLEM、require 抛错⇒LOADFAIL、负控⇒NORED），不承担功能判据；fetched 独立性由 lib「窗口分类五档」+ 变异 M-M/M-M1 抓，实测红集含该锁。 |
| R1-i5 Warning 转 enforce 无自动跟踪 | **否证** | 与 D9 i8 同口径：D6 给整数与现取命令；自建"最近 N 次运行"台账是热写面（本仓刚把 `CHANGELOG`/`learnings` 收成聚合器单写）。 |
| R1-i6 Info `_` 前缀不计数缺变异 | **采纳** | 新增变异 **M-U**：摘掉 `readDebt` 的 `_` 过滤 ⇒ 实测红在 lib「欠账清单起始为空、上限为 0」，消息 `欠账条数 2 != MAX_DEBT 0` 指名。顺带量到真实欠账文件此刻有 **2 个** `_` 键——摘掉过滤就是把留档算进上限，这条断言确实有牙。 |
| R1-i7 Info D8 第 5 条例外未写清 | **否证** | 该例外**已在文中**：D8 第 5 条原文写着"判定域是 producer workflow 的 run 历史，与本次 PR 的差量无关（**除非该 PR 自己改 `.github/workflows/**` / 登记面 / 欠账面**）"，括号就是这条例外。critic 要的口径与现存文本同义 ⇒ 不改，只在此留这句取证，防止下一个会话把它当遗漏"顺手补"。 |
| R1-i8 Info 未测恶意 `--repo` 的数组完整性 | **采纳（一半已在实现里）** | spawn 出口锁已断言 `'q.yml; rm -rf /'` 原样留在一个元素里；本刀补同一条上的逗号 + 换行形态（`a,b\nc` 仍是一个元素）。 |
| R2-i1 Critical workflow 缺 `permissions` | **采纳一半，拒绝一半** | 拒绝"给 `quality-gate.yml` 加顶层 `permissions:`"——它改的是该文件**所有作业**那份令牌的范围，属「谁来守门」，须人工过目。采纳"读数必须说出能不能读"：403 HINT 已覆盖，且 D6 ⓪ 把"runner 令牌能否读保护/规则集"写成转 enforce 的前置条件并给出现取命令。 |
| R2-i2 Critical `--repo=../secret` 遍历 | **采纳** | 与 R3-i1 同一格，落 `REPO_SHAPE`（见下）。 |
| R2-i3 Critical 未证实可被误判为通过 | **否证** | 未证实从不被念成合规：首行同时给 `verdict=` 与 `unproven=`，advisory 不阻断是 D6 明示的档位选择，enforce 档把 rc=2 原样交回。 |
| R2-i4 Warning M-J/M-K 共享一红 ⇒ 解析层未分离 | **采纳** | 新增 lib 锁「空行不得结束 jobs 区间」，夹具**只有空行、没有顶格注释** ⇒ 摘空行守卫红在这把新锁，摘注释守卫红在「顶格注释不得结束 jobs 区间」（那条保留真实形状：实测 `doc-gate.yml` 95 行是空行、96 行是零缩进 `# ===== 说明 =====`）。M-J 台账加这条红。`M-J × M-K` 的**声明保留**：混合夹具那条消息对两条变异确实相同——这是诚实陈述，不靠放宽判据把它消掉（正是 D7.3 的既有口径）。 |
| R2-i5 Warning 上限与文件无加载期同步 | **否证** | `validateDebt` 数非 `_` 键并与 `MAX_DEBT` 比；lib 那条直接拿**真实仓**文件断言 `keys === MAX_DEBT`，M-U 证明它会红。 |
| R2-i6 Warning 多产出者失明不点名 | **否证** | `judgePresence` 每个返回值都带 `windows`（逐产出者的 `workflow/form/runs/scanned/lastRun/error`）；`--report` 行打 `detail`（含 workflow 名），`--json` 打逐产出者行。实测形态：`A form=selfFault … :: A：q.yml 的 run 窗口没取到`。 |
| R2-i7 Info 成本/限流未写 | **采纳** | D4.3 补：实测约 45 次调用 / 本机 65 秒；缓存只在**一次跑内**按 workflow 去重（跨 run 不缓存——平台状态必须当场读）；本刀另加单次硬超时（见 R3-i8）。 |
| R3-i1 Critical `..` 通过白名单 | **采纳** | 实测成立：旧写法 `/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/` 对 `a/..` 返回真。改为"段首段尾必须是非点字符"的构造：`..`/`.foo` 被拒，`my.repo` 照常放行。新增 cli 锁「形态白名单还须挡住点段」+ 变异 **M-S**（白名单退回旧写法）⇒ 实测红在该锁，消息 `点段必须整串拒绝`。如实记一句：critic 说这"与文中'显式拒绝 ..'的声称矛盾"——实测本文**从未**写过该声称（grep 0 命中），那句出自 proposer 改后副本。 |
| R3-i3 / R3-i7 接口契约未写 | **采纳** | 见 D10.1（签名照实现逐字取，改实现必须同改此表）。 |
| R3-i4 endpoint 拼接契约 | **采纳** | D10.1 写明 `ghJson(args)` 的数组语义；"endpoint 之外不得有多余元素"由 cli 那条编码锁断言。 |
| R3-i5 Critical 派生依赖 `/rulesets` 的 `rules` 恒空 | **否证** | 派生**不依赖**列表的 `rules`：lib 锁断言"必须按 id 逐个取详情"（夹具里两份 ruleset 各取一次）；并集为空时另有 lib 锁断言按**未证实**（rc=2）并点名"不得把取不到读成十道闸都被摘"，摘掉 404/403 分档即 M-R 红。API 形态变化会红、会指名，不是静默退化。 |
| R3-i6 Warning "21 named 0 overlap" 与声明矛盾 | **否证** | 读数原文是 `OVERLAP-UNDECLARED=0`，另有 `OVERLAP-PAIR-DECLARED M-J × M-K`，两句并存不矛盾。执行记录不再简写成"0 overlap"。 |
| R3-i8 Warning 超时/重试未 tie 进契约 | **采纳** | `ghJson` 加 `timeout: GH_TIMEOUT_MS = 20000`（`MP_REQCHECK_GH_TIMEOUT_MS` 可覆盖；非法值回落默认**并出声**——静默回落等于让"我明明设了"永远查不出来）。文案必须分两支，依据是当场量到的形状（本机 Node v22.23.1、`shell:false`）：超时 ⇒ `status=null / signal=SIGTERM / error.code=ETIMEDOUT / stderr 空`；没装 ⇒ `status=null / signal=null / error.code=ENOENT / stderr 空`。**两支只有 `error.code` 可分辨**，并成一句就把"这一轮取数挂了"指使人去重装 gh。锁：cli「gh 取数必须有硬超时，且超时与没装不得共用一句文案」；变异 **M-T**（摘 timeout）与 **M-T2**（并回一句）——两条都红同一把锁，靠消息分开（`不传 timeout…` vs `gh 不可用：ETIMEDOUT`）。**不自动重试是刻意选择**：本锁的动作出口本来就是"没取到 ⇒ 未证实"，重试只是花更多时间掩盖它。 |

### D10.1 接口契约（签名从实现逐字取；改实现必须同改此表）

```
scripts/lib/required-checks.js（零第三方依赖，不 spawn）
  deriveWorkflowChecks(repoRoot) -> { selfFault: string|null, files, count, decls, producers: Map<string, producer[]> }
  producersOf(derived, context)  -> producer[]                     // 同名多产出者全部返回
  readRegistry(repoRoot)         -> { required: entry[], selfFault: null }   // 缺席/非法 JSON/缺 context|producedBy|why ⇒ 抛错
  readDebt(repoRoot)             -> { [context]: reason }          // 文件缺席 ⇒ {}；`_` 前缀键在此处剥掉
  validateDebt({debt, required, max}) -> { violations: string[], counted: number }
  classifyWindow({workflow, runs, fetched, scanned}, ctx)
      -> { workflow, form: produced|always-skipped|no-run|absent|selfFault, runs, detail?, windows? }
      // fetched !== true 或 runs 非数组 ⇒ 直接 selfFault；runs=0 且 scanned >= MAX_SCAN ⇒ 也是 selfFault
  judgePresence({windows: window[]}, ctx) -> { form, runs, detail?, windows }
      // 任一产出者 selfFault ⇒ 整体 selfFault（先坏消息后好消息，不得被另一个的 produced 洗白）
  judge({derived, registry, platform, debt, debtViolations, presence})
      -> { head, rc: 0|1|2, verdict, violations, unproven, drift, dead, noRun, multi }
  platformSets({fetcher, repo}) -> { union, selfFault, notes, sources: {classic, rulesets} }
      // fetcher 注入：CI 用真 gh，单测用夹具；"取不到"与"取到但为空"在接缝处就是两档
scripts/check-required-checks.js（CLI：只做参数、取数、打印、出口码）
  // D11 R3-i2：白名单的真实构造照抄于此，文字描述不可重抄（重抄就是漂移）。
  // 段首段尾必须是非点字符 ⇒ `.` / `..` / `.foo` 进不来，段内的点照常放行（`my.repo` 是合法仓库名）。
  const SEG = '[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?'
  const REPO_SHAPE = new RegExp('^' + SEG + '/' + SEG + '$')
  ghJson(args: string[], spawnImpl?) -> object
      // 唯一 spawn 出口：['api', ...args]、shell:false、timeout=GH_TIMEOUT_MS；error.code 分档文案
  ghTimeoutMs(env) -> number       // 默认 20000；非法/越界 ⇒ 回落并 console.warn 一次
  resolveRepo(explicit, fetch) -> string    // 白名单作用在**解析后的值**上（默认档从 gh 取回的名字同样过闸）
  windowFor(repo, workflow, cache, fetch) -> { workflow, runs|null, fetched, scanned, lastRun?|error }
  main(argv, {fetch, repoRoot, log}) -> 0|1|2   // 任何异常 ⇒ SELF-FAULT rc=2，不得读成合规
```

### D10.2 这一轮没解决什么（如实）

1. **Critical 数逐轮递增（2→3→4）**说明 critic 在 proposer 改后的版本里不断找到新格，而不是上一格修完就收敛。因此本刀按 `blocked` 裁决**不盖章**：D10 的采纳项全部落进实现与本文后再重跑一轮拿章。
2. 决策层评审的是文档，D10 里所有以"已实现"为据的否证，只在**当轮红集与读数以现跑为准**时成立；下一个会话改判据时必须重跑 `node scripts/check-required-checks.mutation.js` 并抄走逐行读数。
3. 规模变了：变异 21⇒**25**（新增 M-S/M-T/M-T2/M-U），回归锁 lib 22⇒**23**、cli 13⇒**15**（驱动的 `minTests` 下界同步抬起）。这些是活数，引用时现取。

## D11 设计轴第三轮（proposer=codex 的第二份完整跑，3 轮 × 8 条）逐条处置与升级交接

产物：`.adversarial/ccg-plan-design-required-checks-ledger-v3-claude/`（评审对象＝含 D10 的本文件副本，28405 字符）。
轨迹：轮 1 Critical 3 / 最低分 6 ⇒ 轮 2 Critical 2 / 6 ⇒ 轮 3 Critical 2 / **5**（分数回退触发回滚），裁决仍 **blocked**（rc=1）。
比上一份完整跑（Critical 2→3→4、分 5→5→4）好：最低分从 4 抬到 5–6，Critical 尾数从 4 降到 2 —— D10 的采纳项确实收窄了面。
**两条落盘事故如实记**：① 这一轮我漏传 `dir_path`，评审跑在**共享根**（main）上，writeBack 建出 `.ccg/reviews/9f94e08fb….json`（键在 main 的 sha 上，与本片无关）——已用 `scripts/safe-delete.js` 送回收站删除，并把 `.adversarial/…-v3-claude/` 整目录复制回本片；共享根那份副本因"目录一律拒绝递归删除"的守卫留在原地（被 `.gitignore` 忽略，git 看不见）。② `.adversarial/` 实测被忽略（历史 315 个文件是 force-add），所以**两轮评审产物都不是仓内可查的证据**，本文只承诺"重取命令"。

| 条 | 判定 | 依据与落点 |
| --- | --- | --- |
| R1-i1 Critical 可注入 `spawnImpl` 等于可换 gh | **否证** | 判据把"测试接缝"当成攻击面：能改注入参数的主体已经能改被调用方本体。实测 `ghJson` 默认走 `spawnSync`，注入只发生在单测里（cli#4/#5 正是靠它断言 `shell:false` 与数组完整性）。要防的"生产路径没走真 gh"这一格由 cli#13 接线锁守（Gate 2b17 必须在可执行正文里点名判据本身）。 |
| R1-i2 Critical 重叠依赖文件形状 | **采纳一半** | 声明不撤（D7.3 的既有口径）；但把依赖写小：`lib#23` 之后 M-J 已有独立锁（D10 R2-i4），`lib#6` 只是**额外**共享一红。形状漂移的后果由驱动自己承担——锚点命中数≠1 即 `PROBLEM`，不会静默变成"没红"。 |
| R1-i3 / R1-i8 Critical 变异尺 `RESULT=OK` 与评审 `blocked` 无对账 | **否证 + 采纳其问出的那一格** | 两把尺量的对象不同：变异尺问"这些锁有没有牙"，设计轴问"这份方案现在能不能动手"。`RESULT=OK` 不构成"评审通过"，反之亦然，所以没有"对账"可言。采纳的是它暴露的呈现问题：本文与执行记录必须把两个读数**并排写**（本轮起：`NAMED=25/RESULT=OK` 与 `裁决=blocked` 同时出现在 D7.1 与本节），避免下一个人把其中一个读成另一个的豁免。 |
| R1-i4 Warning 45 次调用可能吃满作业预算 | **否证（现文已有预算对照）** | D4.3 写的实测是 65 秒 / 5 分钟预算；且调用数是**上界确定**的：每个 producer workflow 一次 run 列表（`MAX_SCAN=50` 是**单次** per_page，不是 50 次调用）+ 窗口内至多 6 次 jobs ⇒ 与 workflow 数成正比、与 PR 差量无关。真超预算的表现是步骤超时，不是静默少判。 |
| R1-i5 Warning `ghJson` 不校验 args 其它元素 | **否证** | 除 `repo`（走 `resolveRepo` 白名单）与 `workflow`（走 `encodeURIComponent`，cli#5 锁）外的元素都是**内部构造**：`'repos/'` 前缀、`run.id`（来自 API 的数字）、`per_page=RC.MAX_SCAN`（常量）。所以"其它元素也是用户输入"这个前提不成立。 |
| R1-i6 Warning `platformSets` 没有 `fetched` 旗标 | **否证** | 它的失明出口是 `selfFault` 字段 + 取数抛错即早退（lib#21 断言 404/403 分档），"取到但为空"由 lib#22 单独成档（并集为空 ⇒ rc=2 未证实，不得读成"十道闸都被摘"）。`fetched` 是**窗口**侧的概念（run 列表可能"扫到 0 条"），平台清单没有"扫了几条"这一维，套同名旗标是范畴错误。 |
| R1-i7 Info 文件只含 `_` 键时行为未定义 | **否证** | 已定义且有锁：`readDebt` 剥 `_` 前缀 ⇒ 只剩 `{}` ⇒ `validateDebt` 计 0 条 ⇒ 零欠账（安全方向）。lib#20 拿真实文件（现读 2 个 `_` 键、0 条欠账）钉这条，M-U 证明摘掉过滤即红。 |
| R2-i1 / R2-i6 Warning M-A 锁点、24 条里 7 条预测偏 | **否证（这是纪律本身，不是缺陷）** | D7.2 存在的理由就是"计划值与实测不一致要逐条更正"——记 7 处偏差是**交付物**，把它读成"预测能力差"会诱导下一个会话把偏差改成事后编的"一开始就猜对了"，那才是造假。预测与实测分栏保留。 |
| R2-i3 Warning `a/..` 到第二轮才被抓 | **采纳其事实，不采纳其暗示的修法** | 事实成立：第一轮 critic 没抓到这格，是 R3-i1（上一份跑）提出、本刀修的。不暗示"评审能替代判据"——它能红靠的是后来补的 cli#14 + M-S；把"外部评审总会抓到"当前提就是装饰性门禁的起点。 |
| R2-i7 / R3-i3 Warning ⓪ 人工令牌权限无人跟踪 | **采纳为"具名欠账"，不采纳为"自动执行"** | 加 `permissions: administration: write` 属改"谁来守门"，本仓规则要求人工（AGENTS「不碰 GitHub 侧配置」）。可机械化的部分是**让它一直可见**：转 enforce 的前置条件 ⓪ 写在 D6 且首行打印 `unproven=`，永久 advisory 的成因在读数里能一眼看出。已登记为 §6.2 的具名欠账，不自建台账。 |
| R2-i8 Warning schedule 版只登记不实现 | **否证（这是刻意不做）** | D8 第 3 条写明接受"下一次 PR 时发现"，先例 `clock-shift-oracle.yml`；把它读成遗漏会诱导随手补一个无人守门的定时作业。 |
| R3-i1 Critical "方案自认 blocked，所以未盖章" | **不采纳为缺陷；采纳为终止条件** | 这条是把本文件的诚实自述重新判成 Critical：只要"未收敛"写在文档里，critic 就能永远指着它说"你看它自己承认了"。⇒ 这是**不动点**，不靠再改文档闭合。按既有出口停手并交人工（见本节末）。 |
| R3-i2 Critical D10.1 未给精确正则 | **采纳** | 契约表里补 `REPO_SHAPE` 的真实构造（`SEG` + `new RegExp('^' + SEG + '/' + SEG + '$')`），说明"段首段尾非点字符"才是挡住 `..` 的机制——否则下一个人照文字描述重抄一份就会漂移。 |
| R3-i6 Info args 未冻结/深拷贝 | **否证** | `ghJson` 把调用方数组**展开进新数组**（`['api', ...args]`），spawn 之后调用方再改自己那份也影响不到已构造的 argv；"再冻结一次"不增加任何一格防护。 |
| R3-i7 Info `lib#N`/`cli#N` 无映射表 | **采纳** | 给一句话重取命令（按文件内出现顺序数），而不是维护一份会与测试漂移的映射表——映射表是第二份事实，编号约定那条注释已经说明"新增用例必须追加到末尾"就是为了保住坐标。 |
| R3-i8 Info 显示缺陷 `proposer=codex(undefined)` | **记为仓外欠账** | 缺陷在仓外引擎（`ccg-deep-review.js` 读 `fam.resolved`，而 `familyCheck` 返回 `proposerFamily`/`criticFamily`），判定未受影响。仓外文件不在本仓评审链的可改面内，改它=影响所有会话且技能升级会漂移 ⇒ 只登记不修。 |

### D11.1 为什么在这里停手（升级交接，五条）

设计轴已跑**两份完整循环共 6 轮**（每轮都是 critic=claude 交付 8 条），放行条件是"无 Critical 且无未解决 High"。
本轮起的结构性事实是 R3-i1：**文档如实写"未收敛"本身会被再判成 Critical**，这条不随任何文档改动消失。
因此按既有出口停手并交人工，需要人裁决的就这五条：

1. **要不要给设计轴配"轮次上限 + 到顶即交人工"的机械判据**（现在"停手"只是我的临场决定，没有东西强制它，也没有东西记录它到顶）。
2. **⓪ 令牌权限**：`quality-gate.yml` 的 `GITHUB_TOKEN` 是否能读 `branches/main/protection` 与 `rulesets`——这是转 enforce 的唯一硬前提，属改"谁来守门"，必须人工。现文只给了重取命令，没有自动执行体（刻意）。
3. **`REPO_SHAPE` 的强度**：本刀把"点段"挡在解析后的值上；要不要更严（比如只允许 `owner/name` 且从不在 CLI 接受 `--repo=`）是人选的宽严问题，不是缺陷。
4. **`.adversarial/` 被忽略 ⇒ 两轮评审产物不在仓内**：要不要把它们按历史惯例 force-add 进仓库（历史 315 个文件就是这么进来的），还是接受"证据只在盘上、靠重取命令复现"。
5. **登记面 10 条 required 与平台并集现读相等（`drift=0`）**：这条相等关系本身没有任何东西在 GitHub 侧验证——本刀只让"仓内与平台不一致"变红，摘闸/加闸仍发生在平台侧。要不要再加一刀去核对"平台侧被谁改过"（audit log 面）。

**本片不自合**（5.5）：它定义"谁能算作守门"并新增门禁接线，PR 交人工批准。

## D12 首档真实 CI 跑照出的两格（2026-10-28，落档后补）

这一节是**落地之后**加进来的：判据第一次在 CI 里真跑（run 40626699654 / job 122613218719），
照出两处只有真跑才会显形的东西。两处都按「先红后绿 + 指名变异」补；不写进 D10/D11 是因为它们
不在设计轮次里，是**接线之后**才知道的形状。

### D12.1 advisory 的 SELF-FAULT 不得阻断（违约，不是新决策）

文件头第 ③ 条本来就写着「advisory 恒 rc=0，但绝不打印全部合规」，而三个 SELF-FAULT 出口无视 mode
恒返回 2。`run:` 块是 `bash -e -o pipefail` ⇒ 非 0 即中止整步 ⇒ ①本 PR 的 required 红；
②它之后 21 个 gate 全部读成 skipped，其中包括「这条判据到底跑没跑」这个唯一证据源。首跑现场：

```
REQUIRED-CHECKS SELF-FAULT: gh: To use GitHub CLI in a GitHub Actions workflow,
set the GH_TOKEN environment variable… (gh rc=4)
##[error]Process completed with exit code 2.
```

两个成因必须分开：**接线缺**（那一步没把作业令牌交给 gh）与**取不到数不该阻断**（判据自己的档）。
前者补 `env: GH_TOKEN: ${{ github.token }}`，与 cleanup-artifacts.yml / debt-baseline-recheck.yml /
dep-audit-refresh.yml 同形；后者改为由 mode 决定（advisory 出声 `MODE=advisory verdict=SELF_FAULT rc=2`
后返回 0，enforce 照旧 2）。刻意保留的一格：**命令行本身打错**（未知旗标 / 非法 `--mode=`）仍返回 2
——那时 mode 无从得知，按默认档放行等于把「我明明传了 --mode=enforce」读成「没传」
（cli#2 与 cli#16 末段各钉一处）。

顺带改掉两条既有断言：cli#3 / cli#14 原先断言「脏值 ⇒ rc=2」，那是把**档**当成了**判据**。
脏值的可观测物是「被拒 + 出声」，退出码属于档，所以两条各拆成 advisory 与 enforce 两格断。

### D12.2 「名字不在作业清单里」不是缺席（原判据表缺的那一格）

本机现取，同一段代码、同一时段的两次读数只差本笔改动：

```
改前  REQUIRED-CHECKS-SCAN … dead=1 … Gate Result form=absent runs=6
改后  REQUIRED-CHECKS-SCAN … dead=0 unproven=6 … Gate Result form=selfFault
      「窗口 6 条 run 有 6 条未跑完（queued/in_progress 一类），作业清单尚未长全」
```

而 `gh pr checks` 里这个 job 正在跑（本次 PR 自己就有 `Gate Result fail`）。窗口构成两次现取为
`2 completed + 3 queued + 1 in_progress` 与 `4 completed + 2 in_progress`：每条 completed 都列出
`Gate Result`，未完成的只列出 1–9 条作业。⇒ 本仓 PR 高频时窗口可能整批在飞，
「还没跑到」被读成「它不存在」。危险的不是假红本身，而是它**会自己消失**（几分钟后重取就是 PASS）
——会自愈的假红教人忽略红色。

口径四条：缺席证据只能由 `status=completed` 的 run 给出；`status` 没给（旧夹具 / 探针没抄全）
按未定论；名字在未完成 run 里已有终态结论仍算 produced（判据看作业自己的读数，不看整条 run 的收尾）；
`absent` 文案必须把两侧计数念出来。采集层同步补 `windowFor` 的 `status`，并为这条接缝单立 cli#18 ——
判据在 lib 里写对、采集层没把这一维送进来时，真实路径恒走未定论档，而单元层因自造夹具看不见这件事。

### D12.3 新增的四条变异与两处台账更正

M-V 摘 advisory 那一格、M-W 摘 GH_TOKEN 接线、M-X 退回「缺席不问 run 是否跑完」、
M-X2 摘掉采集层的 status。台账更正两处（都不是放宽）：M-I 用 delete-block 删的是整步，
令牌接线同在那一步里 ⇒ 两条接线锁一起红；M-Q 把「登记面缺席」变成不抛错，而 lib#24 的①格
正是拿它当仓内侧探针 ⇒ 一起红。现读 TOTAL=32 MUTATIONS=29 CONTROLS=3 NAMED=29
OVERLAP-UNDECLARED=0 RESULT=OK。

### D12.4 外部复核留下的第三条边界（如实记，不写成已闭合）

第二枚 dual 产物 `6c1cee63…`（`.github/workflows/` 高危面）的高危阻断，由一次独立后端复核
（`codeagent-wrapper --backend claude`，rc=0，Session-ID d0f9713e-ee82-4c7e-892c-926c1f38950b）
加公开 PR 评论 `#issuecomment-6460289623` 经 `tierBasis=adjudicated-self-play-honored` 解除。
复核判 dismissed，并额外指出一条双方都没写到的失效模式：**判据读的是 main 的当下平台态，
不是预测合并态**；若某笔 PR 改了保护 / 规则集定义而平台同步有延迟，PR 上 PASS 不保证合并后仍一致。
本刀不把它做成机器动作（那属新增门禁接线），只登记为具名欠账，并与 AGENTS
「合并后回读本次合并触发的 main push」并读——那条纪律在这里第一次有了第二个理由。
