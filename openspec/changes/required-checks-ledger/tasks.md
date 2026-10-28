# 任务：required 清单对账面 + 「是否产出终态结论」探测

> 勾选规则：勾的同时在同一条附**逐字读数**（命令 + 输出首行）；未做的拆成下面新的未勾项；有意偏差写"偏差 + 理由 + 指针"。

## 1. 取证与口径（先量后写）

- [x] 1.1 现读两套机制的 required 清单并写进 design D3/D5。读数：ruleset 23749994 按 id 取 + classic protection 各一次，
  并集 10 条；**本刀实现后判据现读 `drift=0`**（登记面逐字等于平台并集），取证命令 `node scripts/check-required-checks.js --report`
- [x] 1.2 派生 producer 正式版进 lib。现值 `files=18 decls=60 distinctNames=56 selfFault=null`，
  10 条登记全部有产出者且派生集不含 `on:` 触发器名（`required-checks.test.js` 真实仓自洽用例）
- [x] 1.3 **这条的初稿口径被实测否证**：原写"按 producer 的 main push 历史取窗口实测 `QG Coverage` 的 skipped 形状"。
  按正确域（push ∪ pull_request）复测 ⇒ `QG Coverage form=produced`（run `40466480976` 上 `failure`），
  push 侧 skipped 是 `ci-push-heavy-job-dedupe` 的明文决定 ⇒ 撤欠账、`MAX_DEBT` 退回 0、留档见 `required-check-debt.json` 的 `_否证记录` 与 design D5
- [x] 1.4 读数随条附见上

## 2. 判据本体（TDD）

- [x] 2.1 派生锁：`jobs:` 区间、`name:`/job id 两条来源、触发器名反例（`required-checks.test.js` 用例 1–4）
- [x] 2.2 双向差集两条（平台多 / 登记多）+「登记产出者不在派生集合里」+「多产出者命中其一即对」
- [x] 2.3 四档 + 失明档各断言退出码与动作不同（`always-skipped` / `absent` / `no-run` 各自违规，`selfFault` 走 rc=2）
- [x] 2.4 欠账四条（空 reason、超上限、陈旧键、文件缺席按零欠账）+ 留档键不计数 + `MAX_DEBT=0` 双向钉
- [x] 2.5 实现 `scripts/lib/required-checks.js`（零第三方依赖、**不 require `node:child_process`**）
  + `scripts/check-required-checks.js`（唯一 spawn 出口 `ghJson(args, spawnImpl)`，`shell:false`、argv 数组、`--repo=` 形态校验作用于解析后的值）
- [x] 2.6 数据文件：登记面 10 条 + 欠账面零条（`_comment` + `_否证记录`）
- [x] 2.7 真实仓现读一次（2026-10-27，用户令牌档）：
  `REQUIRED-CHECKS-SCAN required=10 derived=56 multi=0 drift=0 dead=0 noRun=0 unproven=0 debtAck=0 verdict=PASS`；
  10 条全 `produced`；成本 45 次 `gh api` / 65 秒（写进 design D4.3）
- [x] 2.8 【新增，i7/i5 的后果】派生三条边界各有锁：空行不结束区间（M-J）、顶格注释不结束区间（M-K）、
  按文件的退化检查（声明 `jobs:` 却 0 条 ⇒ 点名文件）、缩进锚按层排除 steps/`with:` 的 `name:`
- [x] 2.9 【新增，实测吞产出者的那个 bug】派生索引 MUST 是「名 → 产出者数组」：
  真实仓 `Changes` 有 2 个产出者、`changes` 有 4 个，用例逐字断言；退化成唯一映射即红（M-L）
- [ ] 2.10 【未做，如实】`no-run` 档在本仓现读下没有实例（10/10 produced），它的反证只能靠夹具注入（4.x 已覆盖）；
  若哪天真出现一条 `no-run`，处置是修那条 workflow 的触发器，不是抬上限

## 3. 接线

- [x] 3.1 `Gate 2b17` 进 `changes` job、`shell: bash`、advisory；`.github/scripts/check-workflow-structure.js`
  现读 `files=18 violations=0`，`check-step-failfast.js` 现读 `48 个多命令步骤全部 fail-fast`
- [x] 3.2 接线锁落在 `scripts/check-required-checks.test.js` 末条（**偏差**：不另开 `.wiring.test.js` 文件——
  三条命令与 `shell: bash`、`--mode=advisory` 属同一族判据，拆文件会让"注释不算接线"的剥注释逻辑抄两份）
- [x] 3.3 反失明：首行自带 `required= / derived= / scanned` 分母；派生集合为空、扫描面到顶、窗口只有未定论读数三处一律 selfFault
- [x] 3.4 `.gitignore` 加 `!scripts/check-required-checks.js`（`scripts/*.js` 默认忽略新建脚本）；
  `check-unwired-tests.js` 现读 `检查域内测试文件 143 个 / OK: 全部测试均已接线或按欠账登记`

## 4. 变异反证（design D7 的 M-A…M-R，逐条实跑、红集互不相同）

- [x] 4.1 M-D（`EVENTS` 退回只含 `push`）实跑：红 2 条，指名 `探测域含 pull_request…` 与 `窗口按 workflow 缓存…`；还原 `md5sum -c` 通过
- [x] 4.2 M-A…M-U 全部逐条实跑并记红集（红集逐条写进 design D7 表；计划与实测的 12 处差异逐条更正于 D7.2）。
  实跑读数（驱动 `scripts/check-required-checks.mutation.js`）——**当前基线是 2026-10-28 D12 那一行**，
  D10 采纳项落地后新增 4 个变异（M-S/M-T/M-T2/M-U）与 3 把锁（lib#23、cli#14、cli#15）；
  D12（首档真跑照出的两格）再新增 4 个变异（M-V/M-W/M-X/M-X2）与 4 把锁（lib#24、cli#16、cli#17、cli#18）：
  `SUMMARY TOTAL=32 MUTATIONS=29 CONTROLS=3 ATTEMPTED=32 NAMED=29 CONTROL-READINGS=S0-CONTROL-SYNTAX=PROBLEM S0b-CONTROL-LOADFAIL=LOADFAIL S1-CONTROL-NEGATIVE=NORED OVERLAP-UNDECLARED=0 RESULT=OK`
  演进链（不得拿旧数当现值）：2026-10-27 `TOTAL=24 MUTATIONS=21 NAMED=21` → 10-28 D10 后 `TOTAL=28 MUTATIONS=25 NAMED=25` → 10-28 D12 后 `TOTAL=32 MUTATIONS=29 NAMED=29`。
  —— **29/29 变异全部 NAMED**（每个变异的红集逐条命中，且不多不少一条额外红）。
  三个对照读数：S0 语法破坏 ⇒ `PROBLEM`、S0b 装载失败 ⇒ `LOADFAIL`、S1 阴性对照 ⇒ `NORED`
  （阴性对照红 ⇒ 说明是「没变异」也被判红，驱动自身失明；本次不红 ⇒ 判绿有牙）。
  **MISSED 三档（锁没牙 / 冗余防御 / 本机不可证）本轮无成员** —— 这是**实测结论**（21 个变异全部产出了指名红），
  不是「还没查」；若日后新增变异出现 MISSED，按三档分清并如实标注，不得留空。
  唯一一对重叠 M-J × M-K 已在驱动里显式声明并由驱动自检：`OVERLAP-PAIR-DECLARED M-J × M-K pairs=1`、
  未声明重叠 `OVERLAP-UNDECLARED=0`（重叠不许靠放宽判据消解，见 design D7.3）。
  实跑后还原完整性：驱动按 md5 逐字节还原被变异的靶面，靶面清单随变异增加而变（现为
  `scripts/lib/required-checks.js`、`scripts/check-required-checks.js`、`scripts/lib/required-checks.test.js`、
  `scripts/check-required-checks.test.js`、`.github/workflows/quality-gate.yml`），
  **不把 md5 写进本文**——它们随每笔提交自变，写死就是下一次读数的陷阱。重取：
  `git status --porcelain` 跑前后逐字一致（本轮实跑后为 0 个受管文件脏）。

## 5. QM-6 与收口

- [ ] 5.1 设计轴评审收敛：**两份完整循环共 6 轮跑完，仍未盖章 ⇒ 按 D11.1 交人工裁决**（不是"还没跑"）。
  跑次与轨迹：第 1 轮 proposer=opencode 被载荷守卫拒（9958 > 7800）；实测该守卫只覆盖 opencode，
  于是第 2 份改用 **proposer=codex**（无输入守卫，跨家族 openai↔anthropic 经 `familyCheck` 通过）+ critic=claude：
  循环一 Critical 2→3→4、最低分 5→5→4 ⇒ `blocked`；处置落 D10 后循环二 Critical 3→2→2、最低分 6→6→5 ⇒ 仍 `blocked`。
  **放行条件"无 Critical 且无未解决 High"在文档类对象上是移动靶**：循环二 R3-i1 把 D10.2 里
  "本刀未收敛"这句诚实自述本身判成 Critical ⇒ 不动点，不靠再改文档消除（D11.1 第 1 条交人工）。
  两轮 48 条逐条实测处置在 design **D10 / D11**（采纳项已落实现与本文：`REPO_SHAPE` 点段守卫、
  `ghJson` 硬超时与「超时/没装」分档、lib#23 空行独立锁、变异 M-S/M-T/M-T2/M-U、D10.1 契约表含真实构造、
  D11 R3-i7 的编号重取命令）；否证条目每条给行号或实测读数。
  重取：`sh scripts/plan-review.sh <唯一名副本> --critic claude --proposer codex`
  ⚠ 必须带 `dir_path=<本片 worktree>`——本刀实测漏传一次，评审跑在共享根上、writeBack 键到了 main 的 sha
  （误产物已用 `scripts/safe-delete.js` 送回收站，产物目录复制回本片）。
  产物 `.adversarial/ccg-plan-design-required-checks-ledger-v{2,3}-claude/` 实测被 `.gitignore` 忽略 ⇒ 证据只在盘上。
- [x] 5.2 实现轴评审 `sh scripts/deep-review.sh`：**已真跑并闭合**。产物 `.ccg/reviews/3fe4171….json`
  （被审提交 `43f08e4ad`，diff 3198 行 / 判定 2236 行，critic=claude 交付 8 条 = 3C/3W/2Info，最低分 4
  ⇒ 引擎按设计塌进自扮演档，`confidenceWeight 0.6`）。6 条争议逐条裁决全 `dismissed`（每条给可核对依据）；
  其中落在 `highRiskDomains` 的那条**不得由自扮演豁免**，已做一次真外部复核（claude 独立复判，
  session `19af1b7a-5cd3-494d-91dd-22b4fa1f58bd`，给出成立条件与残余风险）并贴成公开证据
  `https://github.com/Colinchiu007/mulpub/pull/4580#issuecomment-6458507326` ⇒ 写回器签
  `tier=external basis=adjudicated-self-play-honored`。判据读数：
  `TIER-COVERAGE dual-closed total=1 external=1 [external(自扮演+公开复核+高危派生)=1]`。
  ⚠ 两条落盘现实写进记录：① 设计轴的 sha 命名记录会遮住验证层的内容寻址（实测驱动崩在
  `mode.toUpperCase()`），须把设计轴产物挪出 `.ccg/reviews/`；② `judgeBackendMismatch` 的自扮演豁免
  只认 `self_play_resolved`，不覆盖第三档的 `self_play_blocked` ⇒ 带 `--critic` 覆盖跑出来的签名记录会被
  判「后端不符」，本刀靠**不带覆盖复跑**过这一格（`reviewBackends.overridden=false` 时该判据本就不比对）——
  这是绕不是修，放宽豁免属改豁免政策、须人工，已登记为遗留项。
- [x] 5.3 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce`：**通过**，现读
  `TIER-COVERAGE dual-closed total=2 external=2 [external(自扮演+公开复核+高危派生)=2]` + `OK: 本 PR 携带执行记录或带原因的豁免`。
- [x] 5.3b 第二枚 dual 产物（D12 那笔，`.github/workflows/` 高危面）：`.ccg/reviews/6c1cee63….json`
  判定 `dual`（138 行 / 敏感内容 3 处命中——命中来自 `GH_TOKEN:` 这个字面量本身），critic=claude 真跑交付 8 条
  （最低分 4 ⇒ 塌进自扮演档），6 条逐条裁决全 `dismissed`，其中 `highRiskDomains` 那条按规矩**不得自扮演豁免**
  ⇒ 另跑一次独立复核（`codeagent-wrapper --backend claude`，rc=0，载荷 3624 字节，Session-ID
  `d0f9713e-ee82-4c7e-892c-926c1f38950b`，判 dismissed 并补出一条双方都没写的失效模式），
  公开证据 `https://github.com/Colinchiu007/mulpub/pull/4580#issuecomment-6460289623`
  ⇒ 写回器签 `tier=external basis=adjudicated-self-play-honored`。
  这一枚**没有**再撞上 `judgeBackendMismatch`：跑评审时不带 `--critic/--proposer` 覆盖，
  `reviewBackends.overridden=false` ⇒ 那条豁免缺口（5.2 记的"绕不是修"）依旧绕得开，但没被修掉。
- [x] 5.4 执行记录 `openspec/records/ci-required-checks-ledger.md`（含未闭合清单逐条点名）+ CHANGELOG 小节
- [ ] 5.5 PR：**交人工批准合并**（本刀定义"谁能算作守门"并新增门禁接线），agent 不自合
- [ ] 5.6 合并后：产物取证 + main push 回读写进 PR 评论（不回填文件）+ R1–R7 清理 + 记忆收敛

## 6. 具名欠账（不在本刀做，但必须登记）

- [ ] 6.1 schedule 版探测器：没有 PR 的时段平台侧被改动不会出声（本刀接受"下一次 PR 时发现"）
- [ ] 6.2 转 enforce：先满足 design D6 的 ⓪–② 三个现取读数。**⓪ 已有实测答案（2026-10-28 首档真跑）**：
  run 40626699654 / job 122613218719 打印 `classic protection 取不到：gh: Resource not accessible by integration (HTTP 403)`
  ⇒ **作业令牌读不到平台清单**，转 enforce 的硬前提没满足，正解是人工给那一步加 `permissions: administration: read`
  （属改令牌权限，人工裁决；本刀不自行加，也拒绝给整份文件加顶层 `permissions:`——那会同时改掉其它作业的令牌范围）。
  另一半前提照旧未闭合：`①连续 5 次 PASS` 在 ⓪ 未过之前结构性拿不到（平台侧恒 403 ⇒ 恒 UNPROVEN），
  所以 6.2 的次序是**先人工开权限，再谈 ①②**。
- [x] 6.3 【已消解，非本刀所为】原写"`QG Coverage` 的三选一处置留给人工裁决"。1.3 的复测把**问题本身**否证了：
  它不是假闸、也不需要在 main push 上跑（那是明文决定）。人工待裁决项就此撤销，改为 6.2 的令牌 scope 一条
