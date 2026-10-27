---
record: gitignore-scripts-root
task: 根治 .gitignore 的 scripts/*.js 通配 —— 外部评审 i2/i4 的根因（新脚本默认不入仓，实测复发 7 次）
date: 2026-10-27
---

## 本次执行记录：`.gitignore` 的 `scripts/*.js` 通配根治（gitignore-scripts-root，2026-10-27）

### 一、这修的是什么

`.gitignore` 有一条 `scripts/*.js`，把 `scripts/` 下**所有** `.js` 默认忽略，再靠每个入库脚本补一条
`!scripts/<name>.js` 反选放行。后果不是报错，而是**新建的判据本体静默不入仓**：

> 本机在盘 → `node --test` 跑得通 → `git status` 里它根本不存在 → 直到 CI 以 `MODULE_NOT_FOUND`
> 红在**别人的**文件上，读起来像「判据坏了」而不是「判据没被跟踪」。

这不是猜的。上一轮（PR #4534）我自己就踩了：写完 `scripts/check-design-nav.js` 跑测试全绿，
`git status` 里却只有 `.test.js` 没有本体。本仓同族已记录到第 6 次
（`#3011` / Gate 2c3 / precommit-spawn-budget / same-type-risk-locks / 掩码覆盖 / 引导按钮名 / 未接线组件），
**我是第 7 次**。

外部评审（critic=claude，PR #4534）把它列为 **Critical（i2）**，同轮 i4 指出「新增一个判据要动两处人工登记」——
两条同根。当时判**成立但不在那个 PR 修**：改 `.gitignore` 是全仓共享的全局约定，会影响所有并发会话，
按 `AGENTS.md` 必须人工过目。用户随后明确指示「要根治」，本 PR 执行。

### 二、动手前先量风险（没有凭印象估）

| 读数 | 值 |
|------|-----|
| `scripts/` 直接子级 `.js`（磁盘） | **194** |
| 其中已被 git 跟踪 | **193** |
| 其中未跟踪（即被通配挡住的） | **1** —— `scripts/wait-pr-checks.js` |
| `.gitignore` 里的 `scripts/*.js` 通配 | 1 条 |
| `.gitignore` 里的 `!scripts/*.js` 反选 | 120 条 |

**关键事实：`gitignore` 只作用于未跟踪文件**，已跟踪的 193 个文件完全不受影响。
⇒ 去掉通配后，全仓只会多出 1 个文件出现在 `git status` 里，而它正好是本 PR 要入库的。
**风险 ≈ 0**，这是我能动手的前提。

**原始读数（可复算；回应外部评审 i2 —— 它要求把 `git ls-files` 证据附进记录）**

动手前（基线 `origin/main`）：

```
$ git ls-files 'scripts/*.js' | wc -l                                  → 227
$ ls scripts/*.js | wc -l                                              → 194   （直接子级）
$ git ls-files --others --ignored --exclude-standard -- 'scripts/*.js' → 1     （= scripts/wait-pr-checks.js）
```

⚠ 口径说明（两个数不是矛盾）：`git ls-files 'scripts/*.js'` 的 `*` **跨 `/`**，
所以 227 含 `scripts/lib/*.js` 等子目录；`ls scripts/*.js` 只数列直接子级的 194。
「194 磁盘 vs 193 已跟踪」这个差才是「被通配挡住」的那个文件。

改动后（本 PR 分支）：

```
$ git ls-files --others --ignored --exclude-standard -- 'scripts/*.js' → 0   ← 根治生效：无文件被隐形挡住
$ git ls-files --others --exclude-standard -- 'scripts/*.js'           → 2   ← 本 PR 新增的判据本体 + 其单测
```

**并做了 git 语义实测**（评审 i1/i8 的前提是「加回通配会排除已跟踪文件」，用一次性迷你仓库验证）：

```
把 scripts/*.js 加回 .gitignore 后，已跟踪文件仍在 index : ["scripts/already-tracked.js",
                                                        "scripts/wait-pr-checks.js"]
新写的未跟踪脚本被忽略                                    : ["scripts/brand-new.js"]
```

⇒ **gitignore 只影响未跟踪文件**。已跟踪的不受通配影响 —— 这是驳回 i1 前半句与 i8 的依据。

基线实测（`git check-ignore -v --no-index`）：

```
scripts/new-check-foo.js    -> .gitignore:108:scripts/*.js   ← 任意新脚本名都被吞
scripts/tmp-debug.js        -> .gitignore:108:scripts/*.js
scripts/check-design-nav.js -> .gitignore:281:!scripts/check-design-nav.js
```

### 三、改成了什么

**删除**：`scripts/*.js` 通配 1 条 + `!scripts/<name>.js` 反选 120 条（连同各自的注释块）+ 1 行 GBK 乱码注释。
**新增**：一段口径说明 + 两条规则：

| 规则 | 作用 |
|------|------|
| `scripts/tmp-*.js` | 给一次性脚本一个**明确的安放处**（唯一保留的 `scripts/` 忽略） |
| `!scripts/*.test.js` | 防御性例外：测试文件必须恒可跟踪。新口径下已冗余，留着防「将来有人重新引入 `scripts/` 忽略规则」 |

**保留不动**：`!scripts/plan-review.sh`、`!scripts/deep-review.sh`、`!scripts/visual-coverage-debt.json`
（`.sh` / `.json` 不在通配匹配域），以及区间内全部 **164 条其他规则**（截图/env/py/bundle…）一字未动。

**顺手修一个坏行**：`!scripts/lib/ 兜住，但脚本本体必须逐条放行…` —— 这行把中文说明混进了规则行，
是**无效规则**（git 会当成一个含空格的 pattern，不匹配任何文件）。已改成注释。
它不是本 PR 引入的，但在改动区域内且明显是格式错误，留着会让读者困惑。

**顺带入库** `scripts/wait-pr-checks.js`：它是 PR 事件投递等待器，有完整文档头
（22 个 PR 的实测统计：7/22 延迟、167s–7264s）、明确的退出码约定（0 已见产物 / 1 有 pending 或 fail /
2 超时无产物），86 行。这明显是**该入库的通用工具**，不是一次性调试脚本 —— 它被错当成临时脚本挡了这么久。
合规性已核：无本机绝对路径、无品牌词、86 行 < 500。

### 四、为什么这样就算根治

旧口径的病根是**「入库要人记」**：新文件默认不可入库，得有人记得补一条反选。
只要这个默认值还在，第 8 次、第 9 次就一定会发生 —— 补反选只是事后追认。

新口径把默认值翻过来：**默认可入库，需要挡的才写规则**。于是：

1. 「文件有没有进仓」不再需要任何人工登记 —— 新脚本自然出现在 `git status` 的 `??` 里，
   这和任何其它新文件一样，**没有专门的机制需要记住**。
2. 「新写的测试必须接线」原本就有独立的锁（`scripts/check-unwired-tests.js`），它按 **git 域**枚举，
   不读本文件 ⇒ 两边不再耦合。
3. 外部评审 i4 说的「两处人工登记」，现在只剩一处（`check-unwired-tests.js` 的接线资格登记），
   而那一处**早有 `deepEqual` 钉死**（对账表与白名单双向相等、登记表清单精确比对），漏改当场红。

⇒ i2（根因未除）与 i4（人工登记负担）同时消解。

### 五、踩到的三个坑（都记下来，避免下次重犯）

**坑 1：行尾。** 第一次改完 `git diff` 显示 **565 行全删 / 343 行全增** —— 整个文件被判成重写。
根因：`.gitignore` 是 **CRLF**，我用 `join('\n')` 写回成 LF。~~修法~~：必须从原文件探测行尾并用同一风格写回。
**判据**：改任何文本文件后，先看 `git diff --numstat`，若增删行数≈文件总行数，就是行尾被改了。

**坑 2：脚本不幂等。** 第二次在同一份已改过的文件上重跑，又删了 1 条反选 + 8 行注释。
修法：**始终以备份为输入**、输出覆盖目标（现在连跑两次结果都是 `568 → 317`，逐字相同）。

**坑 3：孤儿注释。** 第一版按「单行 + 关键词」删注释，留下一批**指向已删规则**的注释
（写着「同族/入口本体…」，下面的规则却已删掉），比删掉更令人困惑。
修法：把文件解析成「注释块 + 紧随的一条规则」作为**单元**，按规则决定整块去留。

### 五之二、根治的连带成本：8 处旧锁把「补 negation」写成了判据，必须同步适配

**这不是我预想到的，是 CI 帮我抓出来的。** 推上去后 `QG Changes` 30 秒就红：

```
not ok 11 - 本刀两个判据本体必须各自有 .gitignore negation（改名或漏登记当场红）
  error: 'scripts/qm6-tier-watermark.js 缺 .gitignore negation ⇒ 它会被 scripts/*.js 那条默认忽略静默吞掉'
```

那条锁本身**是对的**（它守的正是「本体能不能进仓」），但它把**手段**（必须有 negation）当成了判据，
而 negation 已被根治删除 ⇒ 它红在**正确的现状**上。

顺着查下去，全仓共 **8 处**依赖这个已废弃的机制。逐条改成**行为断言**（`git check-ignore` 退出码），
保留原意、去掉对旧机制的耦合：

| 文件 | 原断言 | 改法 |
|------|--------|------|
| `scripts/qm6-tier-watermark.test.js` | 必须有 `!scripts/qm6-*.js` | 改 `check-ignore` 退出码须为 1（不被忽略）+ 反向自证（`tmp-*` 必须被忽略） |
| `scripts/check-spec-purpose.test.js` | 必须有 `!scripts/check-spec-purpose.js` | 删文本断言，只留已有的 `check-ignore` 零命中 |
| `scripts/electron-ci-shard-audit.test.js` | 必须有 `!scripts/electron-ci-shard-audit.js` | 同上；`! ` 坏模式检查（语法层）保留 |
| `scripts/check-clock-shift-oracle.test.js` | 三条反选行必须存在 | 删文本断言，保留已有的 `check-ignore` 行为断言 |
| `scripts/check-unwired-components.test.js` | 两个文件必须被反选 | 改 `check-ignore` 退出码 |
| `scripts/check-branch-merged.test.js` | `check-ignore` 有输出时须命中 negation | **不只看文本**：原来用 `execFileSync` 拿输出，根治后退出码从 0→1 会直接**抛异常**，测的成了"异常"而不是契约 ⇒ 显式判退出码（0 红 / 1 对 / 其它抛错） |
| `scripts/check-blanket-fs-mock.js` | 被吞时提示「须补 negation」 | 提示改为「删掉命中它的那条规则」 |
| `scripts/check-spec-delta-coverage.test.js` | 同上（提示文案） | 同上 |
| `scripts/check-gate-record-debt.test.js` | 命中规则必须是 negation | 改成「**任何**规则命中都该红」（negation 机制没了，不再有"命中 negation 属正常"那一格） |

**教训**：把「机制」写进判据，等于让判据与机制同生共死。**判据应该断言目标状态，不是断言实现手段。**
本项目已有正确先例 —— `qm6-tier-watermark.test.js` 的 1.1.12 那条就写明
「判据取**追踪**而不是**有 negation**：negation 只是建档时的机制」，它在本轮毫发无伤。

### 六、门禁

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型 | ✅ | 非 docs-only（改 `.gitignore` 属白名单内，但 `.md` 记录 + `.js` 入库使其为混合变更）—— 以 `classify-docs-only.js` 实测为准。 |
| 隔离 worktree | ✅ | 独立 worktree `<worktrees>/mp-gitignore-scripts-root`，裸分支 `gitignore-scripts-root`。**未触碰共享主工作区**。 |
| 反向验证（bug 已根治） | ✅ | `check-ignore`：`scripts/new-check-foo.js` / `scripts/check-design-nav.js` / `scripts/wait-pr-checks.js` **均不忽略**；`scripts/tmp-debug.js` 命中 `scripts/tmp-*.js`。 |
| 反向验证（无意外冒出） | ✅ | 共享根实测：194 个 `scripts/*.js` / 193 已跟踪 / 唯一未跟踪是 `wait-pr-checks.js`（本 PR 入库）⇒ **最终 0 个意外**。 |
| diff 精确性 | ✅ | `git diff --numstat` = **20 增 / 271 删**；删除的 **120 条规则行全部**是 `scripts/*.js` 通配或 `!scripts/<x>.js` 反选，**非预期删除 0**。 |
| 行尾 | ✅ | 全文件 316 CRLF / 0 裸 LF；`git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致。 |
| 幂等 | ✅ | 同一脚本连跑两次输出逐字相同（`568 → 317`）。 |
| 保留项未动 | ✅ | `.sh` / `.json` 反选 3 条 + 区间内其他规则 164 条，逐条核对无一被删。 |
| 行数上限 | ✅ | `.gitignore` 340 行（非源码，不受 max-lines 域约束）；新入库 `wait-pr-checks.js` 100 行 / 新判据 156 行 / 其单测 132 行，均 < 500。 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → 见 PR 读数。 |
| 绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js` → 见 PR 读数（新文件已核无本机路径）。 |
| 回归锁自证 | ✅ | `node --test scripts/check-gitignore-scripts.test.js` → **8/8 pass**，含 3 条**可证伪**用例（把 `scripts/*.js` 加回 / 子目录被吞 / 删掉 `tmp-*` 豁免，各自必须点名对应违规码）。 |
| 判据本体 | ✅ | `node scripts/check-gitignore-scripts.js` → PASS（G1 false / G2 false / G3 true；现场清点 0 个隐形文件）。 |
| 对账表同步 | ✅ | `node --test scripts/classify-docs-only.test.js` → **27/27 pass**（`.gitignore` 那行从 `noGate` 改成真实门禁，双向对账仍相等）。 |
| 接线资格 | ✅ | `scripts/check-unwired-tests.js` 登记 + 钉死清单同步；该锁 `--test` 见 PR 读数。 |
| QM-6 外部双家族评审 | ✅ | 见 §七。 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导。 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 绝对路径 ✅ | 文档同步 ✅ | CHANGELOG N/A（无用户可见行为变更）| 执行记录 ✅ | 远程同步 PR #XXXX

### 七、外部评审逐条处置（Round 1 · critic=claude · 8 条）

**评审对象**：提交 `0c3f97af1`（只是 .gitignore + wait-pr-checks.js + 记录三件）。
Round 1 指出 8 条，其中 6 条进待裁模板、2 条 Info。**高危域 0 条**。
Round 1 之后我又按裁决补做了回归锁与两处缺陷修复 ⇒ 会以新 diff 再跑一轮。

| 编号 | 严重度 | 维度 | 裁决 | 处置 |
|------|--------|------|------|------|
| i1 | Critical | maintainability | **部分成立** | 指控前半句「重新加通配会静默排除**所有已跟踪**脚本」**不成立**（一次性迷你仓库实测：已跟踪文件仍在 index）；但后半句「没有东西阻止后人把通配加回来」**成立** ⇒ 本轮新增 `scripts/check-gitignore-scripts.js` + 8 例回归锁（含 3 条可证伪），并接进 `changes` job |
| i2 | Critical | correctness | **成立** | 记录确实只给了我自己算的数、没附 `git ls-files` 原始输出。已在 §二 补齐动手前/后的原始读数，并说明「227 vs 194」是 glob 是否跨 `/` 的口径差 |
| i3 | Warning | correctness | **驳回** | 判定记录 `sha` 指向父提交，是 pre-commit 的**既定行为**（此时新 commit 尚不存在，深审入口自己打印「判定记录写在父 sha 上——这是预期行为」）；被评差量由 `stagedDiffHash`（= 文件名，内容寻址）标识。本轮同形，可复算 |
| i4 | Warning | correctness | **成立** | `parseInt` 接受 `'60abc'`（→60）且不排除 `NaN`/非正数 ⇒ `timeoutMin=NaN` 时 `Date.now() < NaN` 恒假，会**立刻报"超时"退出 2**，把"参数写错了"伪装成"事件投递超时"。已改为 `Number` + `Number.isInteger` + `>0` 三重校验并报明确错误 |
| i5 | Warning | security | **成立** | `execSync('powershell … Start-Sleep')` 不可移植（Linux/macOS 无 powershell）且每次睡眠起一个整进程。已改为 `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), …)`，纯 JS 同步阻塞、跨平台、零子进程 |
| i6 | Info | maintainability | **成立** | 我在修那行畸形注释时把 `\r\n` 写成了**字面反斜杠序列**（转义多套了一层），文件里出现一条「假换行」。已改成两条真正的注释行；复核全文件 0 处字面 `\r\n` |
| i7 | Info | maintainability | **成立** | 默认值翻转没写进 `AGENTS.md`。本 PR 在执行记录 §三/§四 写清了新口径，并在 `.gitignore` 内嵌了完整说明；`AGENTS.md` 的改动留给需要时单独提，避免本 PR 再扩面（见 §九） |
| i8 | Warning | correctness | **驳回** | 要求给 `wait-pr-checks.js` 加显式白名单 `!scripts/wait-pr-checks.js`。**不需要**：它入库后是**已跟踪**态，而 gitignore 只作用于未跟踪文件（同 i1 的实测）。加白名单等于把旧口径的逐文件登记再引回来，与本次根治的目标相反 |

### 七之二、外部评审 Round 2（critic=claude · DUAL · 8 条，最低分 6）

Round 2 的 diff 已累计到 361 行 ⇒ 判定升为 **DUAL**（proposer=opencode / critic=claude 跨家族校验通过）。
维度分 correctness 7 / security 8 / performance 7 / maintainability 6（Round 1 是 5/6/7/4，明显上移）。

| 编号 | 严重度 | 裁决 | 处置 |
|------|--------|------|------|
| i1 | Critical | **成立（补强）** | 记录只给了聚合计数（193 已跟踪 / 1 未跟踪），要求逐条。已在 §二 补 `git ls-files` 原始读数（动手前 227/194/1、改动后 0/2）并说明 glob 是否跨 `/` 的口径差 |
| i2 | Warning | **成立** | `.gitignore` 第 34 行还有一行 GBK 乱码（`涓存椂鏂囦欢` = 「临时文件」），不是我引入的但在我改的文件里 ⇒ 已修。复核全文件 0 处乱码 |
| i3 | Warning | **成立** | 新判据原只做**行为**探测，「规则文本已坏但行为巧合通过」抓不到 ⇒ 加 **G4 文本面断言**（非注释规则行里不得有 `scripts` 整目录通配、必须有 `scripts/tmp-*.js`），并加一条专门的**可证伪用例**：`scripts/*.js` + `!scripts/__probe*` 让 G1/G2/G3 全过，只有 G4 能抓到 |
| i4 | Warning | **成立** | `execSync('gh ' + args)` 字符串拼接 ⇒ 改 `execFileSync('gh', argsArray)`，不经 shell |
| i5 | Info | **成立** | `.gitignore` 内嵌说明过长（340 行）⇒ 压缩到 313 行，细节指向本记录；保留「为什么 + 口径 + 两条规则」的最低必要说明（改这个文件的人必须能当场看懂，纯指向 .md 等于让人不看） |
| i6 | Warning | **成立** | 新锁无条件执行会增加 CI 耗时 ⇒ 本地实测 10 例约 13s（主要在一次性临时仓库的 git init/commit）；已接受该成本：它买的是「通配不被悄悄加回来」 |
| i7 | Info | **驳回** | 指控「周边注释指向已删除规则，形成孤儿注释」。脚本化核查：无孤儿注释（v2 的「注释块 + 规则」成组删除已覆盖）。可复算：遍历每个含 scripts 关键词的注释，看其下一条规则是否仍是 `!?scripts/…` |
| i8 | Warning | **成立** | `poll()` 把 gh 失败吞成空输出 ⇒ 「gh 本身跑不成」与「事件还没投递」被压成同一格，真故障会一路空转到超时。已改**三态**：① 解析出数组 → 用它 ② gh 明说 `no checks reported` → 继续等 ③ 其它 → **判据故障退出 2**。实测：PR #999999 现在立刻报故障，不再空转 |

### 八、交付物

- `.gitignore` —— 删 1 条通配 + 120 条 `.js` 反选（连同注释）+ 1 行乱码；新增口径说明 + `scripts/tmp-*.js` + 防御性 `!scripts/*.test.js`；修 1 行畸形规则（并把字面 `\r\n` 修成真注释）
- `scripts/check-gitignore-scripts.js` —— **新判据**：G1 新脚本不得被忽略 / G2 子目录不得被吞 / G3 `tmp-*` 定向豁免必须在；另附「未跟踪又被忽略」的现场清点
- `scripts/check-gitignore-scripts.test.js` —— 8 例回归锁（3 条可证伪 + 2 条正控 + 2 条真实仓库 + 1 条判据自身故障）
- `.github/workflows/quality-gate.yml` —— `changes` job 新增两行（在非 PR 早退之前）
- `scripts/check-unwired-tests.js` / `.test.js` —— 接线资格登记 + 钉死清单
- `scripts/classify-docs-only.test.js` —— `.gitignore` 从 `noGate` 改为真实门禁（对账表仍双向相等）
- `scripts/wait-pr-checks.js` —— 入库 + 修两处缺陷（参数校验、去 PowerShell 依赖）
- `openspec/records/gitignore-scripts-root.md` —— 本文件

### 九、未闭合

1. **其它目录的同型通配没有一起查**：本 PR 只处理 `scripts/*.js`（i2 点名的那条）+ 给它加了回归锁。
   仓内是否还有「整目录忽略 + 逐文件反选」的同型结构（例如 `apps/desktop/*.js`），
   本轮没有系统排查 ⇒ 如实留档，**不宣称「全局根治」**。
2. **`AGENTS.md` 未加一行行为说明**（评审 i7）：新口径已完整写在 `.gitignore` 内嵌注释与本记录 §三/§四，
   但团队约定文件本身没提。理由是 `AGENTS.md` 是全仓协作约定、改它属改「大家遵守的规矩」，
   与本次技术根治分开提更清楚 ⇒ 如需，另开一篇。
3. **`scripts/wait-pr-checks.js` 仍无单测**（评审 i4 的另一半）：本轮修了它的两处真缺陷（参数校验、
   去 PowerShell 依赖），但没补 `.test.js`。它是「等外部状态」的工具，单测需要 mock `gh`；
   与其硬凑，已把可单测的部分（参数校验的拒绝路径）用 CLI 实测覆盖（`--timeout-min abc` → rc=2）。

### 十、本轮沉淀的教训

**「默认值」错了，补再多例外也救不回来。** 旧口径的默认是「`scripts/` 下的 `.js` 不可入库」，
于是一个正常的新判据必须靠人记得补一条反选才能进仓 —— 这类设计每多一个使用者就多一次踩坑概率，
而每次踩坑的代价都是「CI 红在别人的文件上、被人误读成判据坏了」。
识别信号：**一个约定如果要求「每次新增都要记得在某处登记」，它迟早会漏**。

**第二条：改「规则」必须同时给「反证」。** 删掉一条通配，光证明「现在没问题」不够 ——
必须能证明「把通配加回去会被抓住」，否则下一个人一个疏忽就静默回退。
本轮的 8 例锁里有 3 例就是把文件故意改坏、断言判据必须点名对应违规码。

**第三条：`git check-ignore -v` 的输出会被 negation 规则污染。** 命中 `!xxx` 这类否定规则时它
**同样打印该规则并退出 0 或 1**，肉眼看「有输出」很容易误判成「被忽略」。判定一律看**退出码**
（0=被忽略 / 1=不忽略）或 `git status` 的 `??` / `!!`。这一轮我自己就先被它骗了一次。
