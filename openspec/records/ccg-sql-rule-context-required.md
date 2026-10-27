---
change: ccg-sql-rule-context-required
branch: ccg-sql-rule-context-required
date: 2026-10-27
type: 门禁判据变更（scripts/ccg-review-* 高危面）——提案，须人工过目
---

# 执行记录：QM-6 判定器的 SQL 形态要求 SQL 上下文（ccg-sql-rule-context-required）

| 项 | 值 |
| --- | --- |
| 变更类型 | `scripts/ccg-review-decider.js`（判据本体）+ 其回归测试 + 本篇记录 |
| 分层 | 属「改谁来守门」——**⛔ 不得 agent 自动合并**，必须人工过目（AGENTS.md「禁止自动合并的情形」第一条同类） |
| 判定 | 混合 PR（`scripts/ccg-review-` 在 `HIGH_RISK_SURFACES` 清单内，实跑档位见下） |
| 远程同步 | 由门禁推导 |

- 保留门禁：隔离声明 ✅（独立 worktree，基线 == `origin/main`）| 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #4543

## 一、缺陷与证据（不是推测，是四条在飞切片的现场读数）

`RULES.sensitiveContents` 第 4 条原先是

```js
/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)\b/i
```

`SELECT` 与 `UPDATE` 是**裸词**。词边界由「相邻字符是否为 `\w`」决定，而 `<`、`@`、`:`、`-`、`"` 都是非词字符，
再叠加 `i` 标志 ⇒ 在 Vue/HTML 代码库里它会逐字命中两类**与数据库毫无关系**的东西：

| 命中形态 | 例子（真实出现在被改动行里） |
| --- | --- |
| `SELECT` ← HTML 标签名 / EP 组件名 / labelable 枚举 | `<select id="wev-pipeline" v-model=…>`、`el-select`、`new Set(['input','textarea','select',…])` |
| `UPDATE` ← Vue 的更新事件绑定 | `@update:model-value="value => emit('update:title', value)"`、`@update:page-size` |

四条在飞无障碍/UI 切片按**新旧两把正则各跑一遍**的实测（只统计 `.vue/.js/.ts/.py` 的变更行）：

| 分支 | 源码变更行 | 旧判据 SQL 命中 | 新判据 SQL 命中 |
| --- | --- | --- | --- |
| `ux-audit-label-prompt-eval`（#4531） | 122 | 2 | **0** |
| `ux-audit-label-freq-elinput`（#4529） | 225 | 5 | **0** |
| `ux-audit-label-native-two-tier`（#4539） | 222 | 11 | **0** |
| `ux-audit-label-batch-article-card`（#4542） | 225 | 11 | **0** |

零行涉及真 SQL 语义。由于「内容命中 ≥1 ⇒ DUAL」是与行数**无关**的独立触发，而 DUAL 在验证层必然落到
自扮演（`self_play` / `self_play_pending`）、agent 无法合法闭合，这条误判把**前端组件类改动大面积变成了不可合状态**。
按上表读数，修好后 #4531（122 行）与 #4542（149 行源码）会落到 SINGLE，#4539/#4529 仍按规模判 DUAL——
那是**正当的**规模判定，与本次要消除的词面误判是两件事。

## 二、改法与「不许连带削检测力」的锁

改为要求 SQL 上下文：

```js
/\bSELECT\s+[\w*.,()'\s]{0,120}?\bFROM\b|\bUPDATE\s+[\w.'"]{1,60}?\s+SET\b|INSERT\s+INTO|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE/i
```

`UPDATE` 一侧刻意要求 `UPDATE` 后紧跟空白 + 标识符 + 空白 + `SET`，所以 `@update:model-value` 里
`update` 之后是 `:`（不是空白）即不命中；`SELECT` 一侧要求同窗口内出现 `FROM`。

新增 4 条回归锁（`scripts/ccg-review-decider.test.js` 末节）：

1. **负控**：6 个真实 UI 形态必须 0 命中。
2. **正控**：6 条真 SQL（SELECT…FROM / UPDATE…SET / DELETE FROM / INSERT INTO / ALTER TABLE / DROP TABLE）必须命中——
   防止"为了不误报把判据改成恒不命中"。
3. **A/B 双臂同基准**：负控表里每一条都必须在**旧判据下确实命中**，否则它不是本条要修的形态、不该混进负控表。
   ⚠ 这条自检**当场抓到我自己一个错**：我最初放了 `v-model:page-size`，而它根本不含 update/select 字样、旧判据也不命中 ⇒
   红文案直接点名「不该放进负控表」，改成真实形态 `@update:page-size` 后才通过。
4. **残余必须命名**：跨行 SQL 的字面 `SELECT` 行改后不再命中——把它**写成断言**而不是留成口头保证，
   并同处锁住补偿控制：`.sql` / `migrations/` 这类**路径**由 `sensitivePaths` 独立命中，不依赖本行内容，
   且该改动仍判 `dual`。

全量回归：`node --test scripts/ccg-review-decider.test.js` → `# tests 80 / # pass 80 / # fail 0`。
**没有任何既有断言把这个假阳性钉成"正确行为"**（若有，本次必须连带改它并说明理由——这是「断言不得反向固化错误行为」的反向检查）。

## 三、为什么仍不是我自行合并

`scripts/ccg-review-` 在 `HIGH_RISK_SURFACES` 清单内：改动它等于改「谁被豁免」，AGENTS.md 明确这属人工过目；
且本片自身按实跑档位（见 PR 正文）也落 DUAL，自扮演不能闭合。
本 PR 交付的是**可直接评审的补丁 + 双向证据**，把人工成本从"设计方案"降到"过目"。

若人工认为残余（跨行 SQL）不可接受，备选是把内容形态限定到文件扩展名（`.sql/.py/.go/…`）——
但 `judge()` 的输入是**行字符串**、不带文件上下文，那需要改 `collectStaged` 的产出结构，属更大的动作，故未纳入本片。

## CHANGELOG 条目

# fix(质量门禁): QM-6 的 SQL 敏感词形态改为要求 SQL 上下文，不再把 HTML/Vue 的词面判成数据库改动（ccg-sql-rule-context-required）

- 旧判据里的裸词 SELECT / UPDATE 会命中 HTML 标签名 select（如 `<select>`、`el-select`）与 Vue 的 `@update:model-value` 绑定；由于「内容命中 >=1 即 DUAL」与改动规模无关，前端组件类改动被大面积抬成需要双模型外部评审的档位，而 DUAL 在本仓只能由真外部评审闭合。
- 四条在飞无障碍切片按新旧两把正则各跑一遍：SQL 命中从 2/5/11/11 降到 0/0/0/0，真 SQL 语句（SELECT..FROM、UPDATE..SET、INSERT INTO、DELETE FROM、ALTER TABLE、DROP TABLE）仍全部命中。
- 已知残余被写成断言而不是口头保证：跨行 SQL 的字面 SELECT 行不再命中，补偿控制是 .sql / migrations 这类路径由 sensitivePaths 独立命中。回归 80/80，且新增一条 A/B 自检要求每个负控在旧判据下确实命中（它当场抓出一格被我误放的非命中形态）。
- 本 PR 属「改谁来守门」，不自动合并，须人工过目。
