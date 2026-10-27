# 把判据闭包本身当成「谁来守门」的面：高危面由 require 图派生，豁免才降级

## Why（全部当场读数，重取命令在文末）

2026-10-26 上一刀（PR #4453）把收口判定搬进 `scripts/lib/ccg-external-review-honor.js`。
收尾自审时用 `highRiskPrefixOf` 量自己的改动集，发现清单**只认路径前缀**，而判据的实质内容大量住在
前缀看不见的地方。第一版设计写的是"把这几个文件按名字加进清单" —— **那个设计被自己的取证否证了**：
按名字补就是打地鼠，因为清单里 `scripts/lib/ccg-review-` 那条的 `why` 原文已经记着
「跨家族轴 X2-9 实测这条此前落在清单外」—— **同一个坑上一轮踩过一次并补了一格**，
这一轮的 19 个漏网文件就是补完之后又长出来的。

现场读数（修正后的探针；第一版把 `check-x.test.js` 也当成入口，虚报成 90/113/18/21 ——
测试可达性混进生产分类域，正是本片要防的那一格的**我自己版本**）：

| 量法 | 读数 |
|---|---|
| 判据入口（`scripts/` 下 `check-*` / `ccg-review-*` / `deep-review*`，排除 `*.test.*`） | **47** |
| 沿相对 `require` 传递可达的仓内脚本（同样排除测试） | **67** |
| 其中 `scripts/lib/` 下 | **17** |
| 这 67 个里不在任何高危前缀上的 | **19** |
| 若改判据的入口清单少一个前缀 | 闭包立刻缩水 ⇒ 必须由规模下界当场红 |

**实现期在同一棵树上重取，上面四个数全部变大**（`node scripts/check-judge-surface-coverage.js --report`）：
入口 **47** / 可达 **69** / 其中 `scripts/lib/` **19** / 不在任何前缀上 **21**。两个原因各带一条实测：
① 上表那张探针只跟 `require('./x')`，而 `require(path.join(__dirname, 'lib', 'gate-timeout-registry.js'))`
这种**分段字面量**在静态上同样可定 —— 漏掉它的后果是 `gate-timeout-registry.js`（每条 gate 的超时预算登记）
整个不在面上，而它是 `check-coverage-budget.js` 的唯一入边；现已把这种形态收进闭包（+2 文件）。
② 原写「动态拼接的 require 当前实测为 0」——**那句没测过**，是从"我没看见"推的。当场数出来是 **6 处**
（`require(path.join(root, …))`、`require(f)`、`require(file)` 三种形态），其中变量参数那两类静态上确实定不下来，
如实留在 `dynamic=` 读数里而不是假装覆盖。同一次重取还暴露 `unresolved=3` 全是**注释里的示例写法**造出来的假信号
（`scripts\$REC`、`scripts\lib\x`、`scripts\z.js`）；散文不是依赖边，已按整行剥注释，
于是「unresolved>0」从恒噪声变成一条真会指到漏网的判据。

漏网名单里包含三件最要命的东西：`scripts/lib/main-red.js`（「主干红就停合并」的判定本体，
入口 `check-main-red.js` 在清单上、被它 require 的真源不在）、
`scripts/classify-docs-only.js`（docs-only 判定本体 = 决定哪些门**根本没跑**）、
以及本刀刚立的三份真源（honor / exec-record-statuses / ccg-delivery-digest）。

## What Changes —— 反转默认方向

1. **新增 `scripts/lib/judge-closure.js`**：从判据入口做 require 闭包（只跟相对 `require`，
   测试文件既非入口也不作节点展开），返回入口数与可达文件集。
2. **高危面由派生决定**：`isHighRiskSurface(rel)` = 命中原有前缀 **或** 落在判据闭包内 **且未被豁免**。
   默认方向是 **fail-closed**：新写一份被 `check-*` require 的 lib，自动就是高危面 ——
   要让它不算，必须写进 `scripts/judge-surface-waivers.json` 并给出 reason。
3. **豁免清单起始为空、只能缩小**（本仓对"承认清单"的既有口径）。
4. **新增 `scripts/check-judge-surface-coverage.js`**（清点式判据）：
   ① 闭包规模下界（入口 / 文件 / lib 数各自 `>` 门槛，退化即红）；
   ② 豁免项必须有非空 reason、必须仍可达（陈旧即红）、条数不得超过上限（起始 0）；
   ③ `HIGH_RISK_SURFACES` 每条前缀必须至少命中一个受管文件（**空转条目锁**：改名/手误会让一条
   看起来在守的门禁恒绿，那比缺它更糟）；
   ④ 取不到闭包读数一律按**未证实**红，不得读成"没有未分类文件"。
5. **判据侧闭包计算失败必须是 `selfFault`（未证实），不是"这条不在高危面"** ——
   与本仓既有 `后端清单取不到读数` 同一档。
6. 接线到 `quality-gate.yml` 的 `changes` job（不被 docs-only 短路的装配面），
   并登记进 `check-unwired-tests.js` 的域内（新测试文件必须被看见）。

## 明确不做

- **不改 `ccg-review-decider.js` 的 mode 判定**（8.5 那格：小 diff 被判 `single` ⇒ 不需要闭环记录）。
  本片做完后这格漂移**可被看见**（`JUDGE-SURFACE` 读数点名哪些文件进了面），但没修它 —— 两件事别混。
- **不联网、不改 GitHub 侧 required check 清单**（那份在平台侧，仓内无对账面）。
- **不做启发式"看代码里有没有 verdict 字样"来自动分类** —— 那是把人的判断换成一个会漏的门，
  AGENTS 对这类"自动判据"有明文否证先例。默认方向反成 fail-closed 之后，人只需要在**想降级**时判断。

## 摩擦如实报

按当前闭包，21 个文件（活数，`--report` 现取）会立刻变成高危面成员。后果：改 `scripts/lib/code-mask.js`
（注释遮蔽工具，服务于扫描器）这类 PR 在**被判 `dual` 时**也要求外部复核证据（只认 `tier=external` + 可核出处，
closureNote 那一档出口在派生面上不再够用）。
判断：**接受**。理由与 `scripts/check-` 已覆盖 106 个文件同源 —— 它们都是"改了就改变谁红谁绿"的代码；
而真正的入口成本由 decider 的 mode 决定（小 diff 判 `single`，不触发双模型），所以这是**可见性收紧**
多于时长收紧。这一点必须写在 AGENTS 里，不能只在设计文档里。
⚠ 但"时长几乎不变"这句**依赖 8.5 那一格没修**（`single` 根本不要求闭环记录）——所以它是本片效果的已知折扣，
不是本片已解决的摩擦；修法会把 23–40 分钟的钩子时长加到每次改判据的提交上，属「谁来守门」，须人工单独裁决。

## Impact

- 新增：`scripts/lib/judge-closure.js`、`scripts/check-judge-surface-coverage.js`、
  `scripts/judge-surface-waivers.json`（起始 `{}`）、三份测试文件
  （`scripts/lib/judge-closure.test.js`、`scripts/check-judge-surface-coverage.test.js`、
  `scripts/check-pr-exec-record-judge-surface.test.js`）
- 改：`scripts/check-pr-exec-record.js`（`isHighRiskSurface` 接派生面 + selfFault 档 + `JUDGE-SURFACE` 读数行）、
  `scripts/check-pr-exec-record.test.js`（两条结构锁随签名迁移同步，并**加严**：新增"main 必须注入上下文"断言；
  16 处临时仓夹具 seed `scripts/`，让夹具与"判据跑在仓根"同形）、
  `.github/workflows/quality-gate.yml`（`changes` job 新增 `Gate 2b16`，`Gate 2c2` 追加派生面接线锁）、
  `.gitignore`（反选新判据本体）、`AGENTS.md` QM-6 段
- 规格：`openspec/changes/ci-judge-surface-coverage/specs/ci-judge-surface-coverage/spec.md`
- 合并方式：改「谁来守门」⇒ **交人工批准**，agent 不自合

## 重取读数（不写成现状，引用现跑）

```
node scripts/check-judge-surface-coverage.js --report
```
