---
record: ci-required-checks-ledger
task: 给 required check 清单建仓内对账面，并探测「required 却恒不产出终态结论」的门禁
date: 2026-10-28
delivered_by_pr: 4580
---

## 本次执行记录：required 清单仓内对账面 + 「恒 skipped」探测（ci-required-checks-ledger，2026-10-28）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码刀：worktree `<仓库父目录>/mp-worktrees/mp-ci-required-checks-ledger`，裸分支 `ci-required-checks-ledger`；共享根全程停在 main |
| 第一性原因（QM-5 ①） | ✅ | required 清单只存在 GitHub 侧（ruleset 与 classic protection 两套并存，`/rulesets` 列表的 `rules` 恒空），仓内无对账面 ⇒ 「被加了什么」「被摘了什么」「谁产出它」三格无人可答 |
| 逃逸分析（QM-5 ②） | ✅ | 逃过的正是「平台侧被改」这一类：单测跑不到平台状态，故本刀把判据做成可注入（`platformSets({fetcher})`）并用 29 条变异证明每把锁有牙；立项时那个「按 main push 取窗口」的域被当场实测否证（`quality-gate.yml` 的 push `paths-ignore` 含 `openspec/**`），写进 design D4.1 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `node --test scripts/lib/required-checks.test.js` ⇒ `# tests 24 / pass 24 / fail 0`；`node --test scripts/check-required-checks.test.js` ⇒ `# tests 18 / pass 18 / fail 0`。`node scripts/check-required-checks.js --report` 的仓内侧恒为 `required=10 derived=56 drift=0`；`dead` / `unproven` 两格随 CI 在飞数量浮动——本行写定当刻现读 `dead=0 unproven=6 verdict=UNPROVEN`（窗口 6 条 run 全部未跑完，这是 D12.2 修好之后的**正确**出口；修之前同样条件是 `dead=1`，即一条凭空违规） |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据 + 两把回归锁 + 变异驱动全部接进 `quality-gate.yml` 的 `changes` 作业（Gate 2b17，`shell: bash` fail-fast，首档 advisory）；`node scripts/check-unwired-tests.js` ⇒ 检查域 144 个测试文件全部接线（活数，随主干增长，重取同一条命令） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相等（design 99/10、tasks 15/6、AGENTS 11/5、`.gitignore` 6/0 等，rebase 后按最终基线重取）；`.gitignore` 冲突按主干新口径解（`gitignore-scripts-root` 已移除 `scripts/*.js` 整目录通配），我这两条逐文件反选随之删除 |
| 接线棘轮 | ✅ | Gate 2b17 点名判据本体与两把回归锁；反向锁在 CLI 测试里（改到注释里就红）；`node .github/scripts/check-workflow-structure.js` ⇒ `files=18 violations=0` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`，无渲染面改动 |
| QM-6 CCG 双模型外部评审 | 部分（见「遗留」） | 实现轴**两枚 dual 产物都已签**（现读 `TIER-COVERAGE dual-closed total=2 external=2 [external(自扮演+公开复核+高危派生)=2]`）。① `.ccg/reviews/3fe4171….json`（被审提交 `43f08e4ad`）：critic=claude 交付 8 条（3C/3W/2Info，最低分 4）⇒ 塌进自扮演档，6 条逐条裁决全 `dismissed`，高危域那条经真外部复核（claude 独立复判，session `19af1b7a-5cd3-494d-91dd-22b4fa1f58bd`）解除 ⇒ `tier=external basis=adjudicated-self-play-honored evidence=…#issuecomment-6458507326`。② `.ccg/reviews/6c1cee63….json`（D12 那笔，判 dual 的原因是 diff 里 `GH_TOKEN:` 字面量命中敏感内容正则）：critic=claude 交付 8 条、最低分 4，6 条全 `dismissed`，高危那条另跑独立复核（`codeagent-wrapper --backend claude`，rc=0，载荷 3624 字节，Session-ID `d0f9713e-ee82-4c7e-892c-926c1f38950b`，判 dismissed 且补出一条双方都没写的失效模式）⇒ 证据 `…#issuecomment-6460289623`。设计轴：见下条 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写 |

### 遗留（不假装已闭合）

- **设计轴评审未盖章**：两份完整循环共 6 轮（每轮 critic=claude 交付 8 条；proposer 第一轮 opencode 被输入守卫拒，之后换 codex —— 实测 `BACKEND_INPUT_LIMIT` 只覆盖 opencode），Critical 尾数 4 → 2，最低分 4 → 5–6，仍不满足「无 Critical 且无未解决 High」。第三轮那条 Critical 指向「文档如实写了未收敛」本身，是不动点。需人裁决的五条见 `openspec/changes/required-checks-ledger/design.md` D11.1。
- **⓪ 已实测，答案是「读不到」**（2026-10-28 首档真跑，run 40626699654 / job 122613218719）：那一步打印
  `classic protection 取不到：gh: Resource not accessible by integration (HTTP 403)` ⇒ **作业令牌没有读分支保护/规则集的权限**。
  正解是人工给那一步加 `permissions: administration: read`（属改令牌权限）；本刀不自加，也拒绝给整份文件加顶层
  `permissions:`（那会同时改掉其它作业的令牌范围）。⓪ 未过 ⇒ D6 的 ①「连续 5 次 PASS」结构性拿不到（平台侧恒 403 ⇒ 恒 UNPROVEN），
  次序必须先开权限再谈阈值。另有一条前置是这次才看见的：**那一步原本连令牌都没出示**（`gh rc=4`），
  先补 `env: GH_TOKEN: ${{ github.token }}` 才拿得到"403"这个真读数——否则 ⓪ 会被误读成"平台拒绝"。
- **`依赖漏洞审计` 这条红不是本 PR 引入的**（现读 `verdict=NEW_RED` 里唯一一条，`mainFail=0`）：新公告
  `npm/GHSA-gcqx-w48m-w2h4`（deepmerge low，修复下界 4.3.2）未进基线，本机不含任何依赖改动
  （diff 里 `package.json`/锁文件命中 0）。归因证据：另一支与本刀无关的在飞 PR（head `e76b79942`）
  打的是同一行 `NEW_ADVISORY`，而 `dep-audit.yml` 的 run 列表里 2026-10-27 21:16 UTC 那次还是 `success`、
  23:21 起连红 ⇒ 公告发布落在这一小时内；基线 `scripts/dep-audit-baseline.json` 现读不含该 GHSA（grep 命中 0）。
  处置是 `dep-audit-refresh.yml` 明确留给人的那一格（机器只 `--update` 预填，`decision`/`note` 是风险判断），
  所以本刀不代填、也不为绕过它而改判据；由 `依赖漏洞审计` 的作者/维护方另行收账。
- **判据自身的一处缺陷由本片自己的读数抓到并已修**（写在这里是因为它是"设计看不见的那一格"）：
  `classifyWindow` 原先只看"这个名字在不在作业清单里"，不看"这条 run 跑完了没有"，
  而窗口整批在飞时 GitHub 只给部分清单 ⇒ 一条 required 被凭空判成违规（`dead=1`），
  且几分钟后自愈（重取即 PASS）。会消失的假红教人忽略红色。修法与四条口径见 design D12.2，
  指名变异 M-X（摘 lib 侧判据）与 M-X2（摘采集层的 `status`）。
- **本刀是 advisory**：`QG Changes` 全绿 ≠ required 清单已被守住。转 enforce 的三个量化前置写在 design D6，各带现取命令。
- **判据交互缺口（本刀现场实测，值得单独一刀）**：`check-pr-exec-record.js` 的 `judgeBackendMismatch` 自扮演豁免只认 `status === 'self_play_resolved'`（第 1590 行），而第三档「高危派生闭环」的状态词是 `self_play_blocked` ⇒ 只要评审跑时用过 `--critic`/`--proposer` 覆盖，honor 签过名的记录仍会被判「后端不符」。本刀靠**不带覆盖复跑**绕过（`reviewBackends.overridden=false` 时该判据第 1601 行本就不比对），但这是绕，不是修。放宽那条豁免按代码注释属改豁免政策、须人工过目，故只登记不自改。
  两格别混：**#4516（现读 `state=OPEN`，未进主干）** 把署名资格从「一条都不认账」换成六格补救证书，它解的是 `upheld` 那一格（本刀在当前基线上确实仍受「有 upheld 即无出口」约束，故把那条认账项从差量里真摘除而非改判语）；它**不解**上面这条 `backendMismatch` × 派生状态词的相撞。等它落地后重看这一格。
- **`.adversarial/` 被 `.gitignore:543` 忽略**（历史 315 个文件是 force-add 的）⇒ 六轮设计轴 + 两轮实现轴的 critique/adjudication 原文都只在盘上，仓内不可追溯；本文只承诺重取命令。要不要按历史惯例入库，交人工（D11.1 第 4 条）。
- **不做 schedule 版探测器**：没有 PR 的时段平台侧被改动不会立刻出声，接受「下一次 PR 时发现」（先例 `clock-shift-oracle.yml`）。
- **不建模 matrix 后缀名**：登记面刻意只收聚合作业（`Gate Result` / `GUI Gate Result`）；若有人登记带分片后缀的名字，`absent` 会红并点名。
- **一条我必须认的错**：中途一笔提交正文写着「已摘掉他人会话的判定产物 `f652efe….json`」，实测那笔只改 2 个文件、并未删除（`git ls-files` 命中 1）。属「声明与产物不符」：没有靠改写提交掩盖，而是在重造变更集（5 笔 → 1 笔 `43f08e4ad`）时真正摘除它及全部中间快照产物，并把更正写进 commit 正文、PR 正文与本记录。

### 取证坐标（活数，引用时现跑）

```
node scripts/check-required-checks.mutation.js
  SUMMARY TOTAL=32 MUTATIONS=29 CONTROLS=3 ATTEMPTED=32 NAMED=29 OVERLAP-UNDECLARED=0 RESULT=OK
  还原完整性只看 `git status --porcelain` 跑前后逐字一致（靶面清单随变异增加而变，md5 不写进本文——
  它们随每笔提交自变，写死就是下一次读数的陷阱）
node scripts/check-judge-surface-coverage.js --report → entries=51 files=74 derived-only=22 verdict=PASS
node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce
  TIER-COVERAGE dual-closed total=2 external=2 [external(自扮演+公开复核+高危派生)=2]；TRANSITION-CHECK 转变=无转变；JUDGE-SURFACE selfFault=no
node scripts/check-required-checks.js --report（仓内侧恒为）required=10 derived=56 drift=0
node scripts/check-main-red.js --pr 4580（verdict 随 head 与主干态浮动，不写死；最近一次实测 head `d3e1835e3`
  时 `mainFail=0 newRed=1`，唯一新增红是上面那条与本刀无关的「依赖漏洞审计」）
```

## CHANGELOG 条目

# feat(gates): required 清单的仓内对账面与「恒 skipped」探测（ci-required-checks-ledger）

- 新增 `node scripts/check-required-checks.js`：把 GitHub 侧 required 清单（ruleset 与分支保护两套机制的并集）与仓内登记面双向对账，并探测「被登记为 required、却在合并路径上每一次都不产出终态结论」的门禁；退出码闭集 0 合规 / 1 发现违规 / 2 判据自身取不到数，三档不得混。
- 产出者映射由 `.github/workflows/**` 派生（显式 `name:` 优先、job id 兜底），手抄的只有「我们打算要求哪些 check 是 required」这份被审计对象本身；登记与派生不一致、或平台侧被加/摘，当场红并指名。
- 探测域是产出者 workflow 自己的最近 run（push ∪ pull_request），不是全局 main push —— 纯文档合并后 `quality-gate.yml` 按设计没有 push run，拿全局窗口会把「今天没被触发」读成「永不产出」。
- 存量欠账起始零条，上限常量只能人工改；立项时那条（`QG Coverage` 恒 skipped）已被当场实测否证并原样留档，防止同一个结论被重新长出。
- 档与退出码分清：advisory 恒返回 0 但必须念出 `MODE=advisory verdict=… rc=…`（判据自身取不到数也一样，首档 CI 实测过它阻断整步、连带把其后 21 个 gate 读成 skipped 的代价）；缺席证据只能由**已跑完**的 run 给出，未完成的 run 计入未定论，否则窗口整批在飞时会凭空长出一条会自愈的假红。

## learnings

### lesson: sha 命名的判定记录会被另一层的产物遮住

验证层（评审 diff）找记录是「先按 HEAD 的 sha、再按 diff 内容寻址」。而决策层（评审方案）的 writeBack 也按 sha 落盘 —— 于是同一个 sha 上，设计轴那份 `blocked` 记录会把实现轴的内容寻址第一跳占住，驱动直接崩在 `mode.toUpperCase()`（记录里没有 `mode` 字段）。失败是响的（没有假绿），但回补路径被挡死。正解是把设计轴记录挪出 `.ccg/reviews/`（本文这么做了），而不是给驱动加兜底。

### lesson: `grep -c $'\r'` 会退化成"数行数"

本会话实测：在某层 shell 包装里 `$'\r'` 被吞成空模式，于是「每行都含 CR」的假读数让我一度判定文件被整体改写成 CRLF。权威读法是 `git ls-files --eol`（`i/lf w/lf`）加上两口径 `git diff --numstat` 是否相等。**判行尾前先换一把不依赖转义的尺**，别用一次假读数去"修"一个不存在的问题。

### lesson: 未完成的 run 只给部分作业清单——"不在清单里"不是"不存在"

按"目录里有什么"迭代的门禁看不见"该有什么"，这条老口径在这里换了个载体：**时间维度上的部分清单**。
GitHub 对 `queued` / `in_progress` 的 run 只列出已排到/已跑完的作业，排在末尾的聚合作业（`Gate Result`）
还没长出来 ⇒ 「扫了 6 条 run 都不含这个名字」在窗口整批在飞时**必然成立**，而它读起来完全像
"这个 required 是个死闸"。当场实测的窗口构成（两次现取）：`2 completed + 3 queued + 1 in_progress` 与
`4 completed + 2 in_progress`，每条 completed 都列出该名字。

三条可迁入口径：① 任何"按外部系统返回的集合判缺席"的判据，必须同时读**该次采样的完成态**，
未完成的一律进未定论档；② 采样字段没抄全（这里指 `status` 缺席）按未定论，**不**给保守默认值——
保守方向在这类判据里恰好是"判它不存在"；③ 会自愈的假红比恒红更坏，因为它教人忽略红色，
所以文案必须把证据面念出来（"已完成 N 条 / 在飞 M 条不计入缺席"）。

### lesson: `gh pr checks --json name,status` 是未知字段，空 stdout 会被读成"零失败"

本会话写的后台看守里用了 `--json name,status,conclusion`。本机 gh 不认 `status` 这个字段名，
它打印用法、**stdout 为空**、rc 仍可能非零；看守随后从空串里筛"非 SUCCESS 的条目"，得到 0，
于是日志上写出一行完全像结论的 `NOT-SUCCESS=0`。同族的错法在记忆里已有（读错列、枚举漏 `QUEUED`），
这次的特征是**字段名不存在时报错的方式与"没有数据"同形**。

三条口径：① 计数型判据必须自己打印分母与 raw 长度（`CHECKS-RAW-LEN=0` 那一行就是它把自己救回来的地方）；
② 判"跑完没跑完"取反面 `state != COMPLETED`，不要逐个枚举进行中状态（枚举会漏新值）；
③ 探针失败要打 `PROBE-BLIND` 并继续，而不是让空读数伪装成结论。

### lesson: 内联 `node -e` 里写反引号 / `${…}` 不是"会报错"，是"会执行别的东西"

本会话第二次实测踩同一格：往 `node -e "…"` 里塞带反引号、`${{ github.token }}` 与嵌套引号的中文长段。
bash 先在双引号里做命令替换与算术展开，把 `` `Gate Result` `` 当命令执行（"command not found"），
把 `${{ github.token }}` 当 bad substitution，最后交给 node 的是一行被截碎的字符串——
报的是 `SyntaxError`，而**真正跑过的那半截已经跑过了**。
正解是把内容写成文件（Write 工具，不经 shell），再用一个只读路径的单行脚本拼接；
本轮追加 design D12 就是这么做的，并且那道"令牌字面量在写入片段里必须出现 1 次"的自检当场
抓到我算错了整份文件的出现次数——自检按片段算才算对。
