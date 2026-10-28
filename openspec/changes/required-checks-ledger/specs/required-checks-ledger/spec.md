# 「required」名单 MUST 有仓内对账面，且每条 MUST 被探"是否真的产出过结论"

## ADDED Requirements

### Requirement: 每个 required check 的产出者 MUST 由 `.github/workflows/**` 派生，MUST NOT 手抄，且派生 MUST 排除 `on:` 触发器

`check-required-checks.js` 所用的 producer 映射（check 名 → 哪些 workflow 的哪些 job 产出它）MUST 由解析 workflow 正文得到：
job 的显式 `name:` 优先，无 `name:` 时取 job id。解析 MUST 先框出顶层 `jobs:` 区间，
且断言派生结果 MUST NOT 含 `push` / `pull_request` / `workflow_dispatch` / `schedule` / `repository_dispatch` / `workflow_call` / `workflow_run`
——命中即"解析退化"，MUST 走未证实档，MUST NOT 拿退化后的集合去判"某条 required 没有产出者"。
索引形态 MUST 是**名 → 产出者数组**（同一名字可有多个产出者，实测 `changes` 被 4 份 workflow 共用、`Changes` 被 2 份共用）；
MUST NOT 退化成"名 → 唯一产出者"，因为那只保留一个产出者的 run 历史，另一个产出者的结论会整批看不见。
`jobs:` 区间的结束判据 MUST 只认"零缩进的非空**非注释**行"；注释行既不结束区间也不得被当 job 名。
另有两道退化检查 MUST 存在：① 某文件声明了 `jobs:` 却一条 job 都没认出 ⇒ 点名该文件并走未证实档（全局集合非空也拦得住局部截断）；
② 缩进锚 MUST 按层（`name:` 只认恰好 4 空格），使 steps 的 `- name:` 与 `with:` 里嵌套的 `name:` 不被收成 check 名。

理由：上一刀（`ci-judge-surface-coverage`）实测"同一条事实有两份手抄清单、各漏一次 ⇒ CI 两轮红"；
而探针现场（18 份 workflow）已暴露朴素两空格缩进解析会把 `build.yml` 的 `["pull_request","push","workflow_dispatch", …]` 当成 job 列表，
且实现期第一版把**空行**当区间尾（`derived` 里 quality-gate 的 job 一个都不剩）。

#### Scenario: 只有 job id、没有 `name:` 的 check MUST 仍被认到有产出者

- **WHEN** required 名单含 `electron-tests`（`electron-ci.yml:71` 的 job id）或 `build`（`build.yml` 的 job id），两者都无显式 `name:`
- **THEN** 派生 MUST 认出其产出者，MUST NOT 报"没有产出者"

#### Scenario: 触发器名混进 job 集时 MUST 出声而不是继续判定

- **WHEN** 解析退化导致 `push` / `schedule` 之类进入派生 job 集
- **THEN** MUST 以未证实档（rc=2）退出并点名退化，MUST NOT 输出"某 required 无产出者"这种基于退化集合的结论

### Requirement: 平台侧 required 清单与仓内登记面 MUST 双向对账，登记面 MUST 只能人工改

判据 MUST 现读两套机制（ruleset MUST 按 id 单独取——列表接口的 `rules` 恒为空；classic branch protection 另取一次）并取**并集**，
与 `scripts/required-checks.json` 对账：平台有而登记无 ⇒ 违规；登记有而平台无 ⇒ 违规；登记里的 `producedBy` 与派生结果不一致 ⇒ 违规。
`mechanisms` 字段只作如实记录，MUST NOT 参与判定。

#### Scenario: 有人在平台侧摘掉一条 required MUST 当场红

- **WHEN** `Gate Result` 从 classic protection 清单里被删除，而仓内登记仍声称它是 required
- **THEN** MUST 违规并点名"登记要求、平台没有"，MUST NOT 因"少一道闸不会让任何检查变红"而静默通过

#### Scenario: 平台侧新增一条 required 而仓内无人知道 MUST 红

- **WHEN** 有人在 GitHub 上把某作业加进 required，而 `required-checks.json` 没有这一条
- **THEN** MUST 违规并点名该名字，正解是补登记（写清由谁产出、为什么要求），**不是**把判据改宽

### Requirement: 每条 required MUST 被探"是否产出过终态结论"，探测域 MUST 是 producer workflow 自己的 push ∪ pull_request run

探测域 MUST 是**该 check 的 producer workflow 自己最近的 run，事件集合 `{push, pull_request}`**（扫描面 `MAX_SCAN` 条再按事件过滤，
过滤放客户端而非查询参数）。MUST NOT 只看 main push：required status check 挡的是合并，结论只可能出现在 PR 的 check suite 里，
而实测 `doc-gate.yml` 根本没有 push 触发器——按 main-push 域会把它产出的两条 required 判成违规（10 条里 2 条假红，本刀实测并由该读数否证了初稿）。
MUST NOT 用"全局最近 N 次 main push"：那会把"这个 workflow 今天没被触发"读成"这条 required 永不产出"。

读数分四档 + 一档失明，逐档动作不同、MUST NOT 合并：`produced`（出现过**终态**结论且至少一次不是 `skipped`）通过；
`always-skipped`（出现过终态结论但每次都是 `skipped`）**违规**；`absent`（取到 ≥1 条 push/PR run，里面没有这个名字）**违规**；
`no-run`（扫描面内没有一条 push/PR run，且未触及 `MAX_SCAN`）**违规**且文案 MUST 点名扫了几条、最近一条是什么事件；
`selfFault` ⇒ rc=2。多产出者聚合优先级 MUST 是"先真结论、后坏消息"：任一失明 ⇒ 失明；任一 produced ⇒ produced；
有 run 而不认识该名字 ⇒ absent；全都没跑 ⇒ no-run；余下 ⇒ always-skipped。

两条不可省的取数口径：① **`fetched` MUST 由调用方显式证明**，缺省即 `selfFault`——「没证明取到数」与「取到了、一条都没有」动作相反；
② `conclusion` 为 `null`（in_progress/queued）**不是结论**，窗口内只有未定论读数 MUST 走 `selfFault`，MUST NOT 计入 produced，
也 MUST NOT 用来把已有的 `skipped` 洗白。

#### Scenario: required 却恒 skipped 的存量 MUST 被点名

- **WHEN** 某 required 的 producer workflow 窗口内每一次终态结论都是 `skipped`
- **THEN** MUST 违规并附重取命令，MUST NOT 因"GitHub 把 skipped 当满足 required"而判通过

#### Scenario: 只在 PR 上跑的 workflow MUST 算 produced

- **WHEN** producer workflow 窗口内的 run 全是 `pull_request` 事件（本仓 `doc-gate.yml` 正是这种形态）
- **THEN** MUST 判 `produced`；把域缩回"只看 push" MUST 让这条用例变红（M-D）

#### Scenario: 没有 gh / token 权限不足 / API 抖动时 MUST 走未证实档

- **WHEN** `gh api` 非零、输出不可解析、或返回 403（令牌没有读分支保护/规则集的权限）
- **THEN** MUST 以 rc=2 退出并打印失败在哪一步，403 还 MUST 额外出声指路（"多半是令牌 scope，不是平台没要求"）；
  MUST NOT 输出"0 违规"（把工具的失明读成结论是本仓「装饰性门禁」的同型）
- **AND** 同一取数面返回 404 MUST 按"该机制不存在"记 note 并当空集，MUST NOT 与 403 合并（两者动作不同）

### Requirement: 违规存量 MUST 走带 reason 的欠账清单；上限 MUST 是代码常量且现读为 0

`scripts/required-check-debt.json` 是唯一出口：值 MUST 是非空 reason（含重取命令与证据坐标）；
键 MUST 仍在登记面的 context 内（陈旧即红——"债务键与登记面错配"不是未定义行为）；
条数 MUST `<= MAX_DEBT`；`_` 前缀键（说明与留档）MUST NOT 计数。上限常量 `MAX_DEBT` MUST 住在判据代码里、
MUST NOT 做成债文件字段：放进债文件等于让同一次编辑既新增欠账又抬高上限。本条现读为 **0**（无存量违规）。

#### Scenario: 为了容忍自己新增的违规而抬上限 MUST 红

- **WHEN** 有人把 `MAX_DEBT` 从 `0` 调到 `1` 以放进自己新加的一条
- **THEN** 清点 MUST 红并点名"上限被放宽"；且**只抬上限不放欠账**也要红（`keys === MAX_DEBT` 双向钉），
  正解是修那条检查让它真产出终态结论

#### Scenario: 空 reason 的欠账 MUST 红

- **WHEN** 某欠账项的值是空串、`true`、对象或缺失
- **THEN** MUST 红并点名该键，MUST NOT 按"已登记"放行

#### Scenario: 被实测否证的欠账 MUST 原样留档并标注不实

- **WHEN** 一条已登记的欠账被复测否证（本刀实例：`QG Coverage` 的"main push 恒 skipped"取自错域，正确域下是 `produced`）
- **THEN** MUST 撤登记、MUST 在同文件保留原错误说法并写清错在哪（`_否证记录`），MUST NOT 静默删键——
  只删原因不写原因，下一个会话会把同一条重新长出来

### Requirement: 判据的出站调用 MUST 用 argv 数组且 `shell:false`，仓库标识的形态校验 MUST 作用于解析后的值

判据本体（`scripts/lib/required-checks.js`）MUST NOT require `node:child_process`：平台与 run 读数 MUST 经注入的 `fetcher` 取得，
这样"取不到数"与"没有违规"两档能在无 gh 的环境里被分别构造。唯一的 spawn 出口 MUST 满足三条并可被测试断言：
① 命令与参数以**数组**传递、`shell` 显式为 `false`；② 外部输入（仓库标识、workflow 文件名）只作为**单个数组元素**进 endpoint，
其中文件名 MUST 先 `encodeURIComponent`；③ 仓库标识 MUST 过整串锚定的 `owner/name` 形态白名单，
且校验作用在**解析后的值**上——旗标缺席时从 `gh` 取回的默认值同样过闸，不合规即走未证实档（MUST NOT 回落成"用另一个仓的读数"）。

#### Scenario: 脏的默认仓库标识 MUST 被拒而不是被用

- **WHEN** 未传 `--repo=`，而从 `gh` 取回的 `full_name` 含空格/分号/多一段斜杠
- **THEN** MUST 以 rc=2 出声并点名该值，MUST NOT 拿它拼 endpoint

#### Scenario: 把 spawn 改成经 shell 拼串 MUST 让形态锁变红

- **WHEN** `shell:true` 或把 endpoint 拼成一条命令串
- **THEN** 注入假 spawn 的行为锁 MUST 断言 `opts.shell === false` 与参数数组形状，改回拼串形态即红（M-P）

### Requirement: 登记面 / 欠账面 / workflow 目录读不到时 MUST 分档出声，MUST NOT 返回空集合

登记面缺席、JSON 非法、缺 `required` 数组、条目缺 `context` / `producedBy` / `why` ⇒ MUST 抛错，由 CLI 统一转成
`SELF-FAULT` + rc=2；MUST NOT 返回空集合（"零漂移"与"没有登记面"必须可区分）。
欠账面缺席 ⇒ 零欠账（安全方向，MUST NOT 为"文件没落盘"造一条红）；JSON 非法 ⇒ rc=2；值非非空字符串 ⇒ rc=1（内容问题，不是取数问题）。
`.github/workflows/` 读不到、集合为空、或某文件声明 `jobs:` 却派生不出 job ⇒ MUST selfFault 并点名文件。
未知旗标与非法旗标取值 MUST 走 rc=2，MUST NOT 静默按默认档跑。

### Requirement: 本判据 MUST 接在无条件执行的作业里且以 advisory 起步，转 enforce MUST 满足三个可现取的整数条件

`Gate 2b17` MUST 落在 `quality-gate.yml` 的 `changes` job（该 job 无 `if:` 门控 ⇒ docs-only 不短路），
`shell: bash`（多条命令必须 fail-fast），判据 MUST 只 require node 内置。首档 MUST 是 `--mode=advisory`；
转 enforce MUST 另开 PR（属改「谁来守门」，人工过目）并同时给出三个**现取**读数：
⓪ CI 档能读到平台清单（首行 `unproven=0` 且不出 `UNPROVEN-HINT` 的 403 指路句）；
① 连续 **5** 次 main push / PR 上 `verdict=PASS` 且 `dead=0`；
② 最近 **20** 次判据运行里 rc=2 占比 **< 10%**，残留者必须能归因到同一类取数面。
MUST NOT 用"若转阻断则最近 N 个在飞 PR 有几个会红"这类模拟：判定域是 producer workflow 的 run 历史、
与本次 PR 的差量无关（除该 PR 自己改 workflow / 登记面 / 欠账面），所以该数只可能是 `0` 或 `N`。

#### Scenario: 接线只写在注释里 MUST 红

- **WHEN** `check-required-checks.js` 只出现在 workflow 的注释散文里、没有出现在可执行正文
- **THEN** 接线锁 MUST 红（注释里提一句不算接线，本仓 `check-unwired-tests` 同口径）

#### Scenario: 无 gh 的 runner 上 MUST 出声而非崩

- **WHEN** 判据所在环境取不到平台读数
- **THEN** advisory 档 MUST 打印未证实并继续（不阻断），且**不得**同时打印"全部合规"
