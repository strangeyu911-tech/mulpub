# PRD — 字数与截断按 Unicode 码点统一（UX 审计阶段 4.7 ①）

- 变更名：`ux-audit-codepoint-length`
- 日期：2026-10-25
- 关联：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 4.7（评审 w10 修正后的口径）、AGENTS「文本空白归一化」「文本结构断言」

## 一、症状与根因（当场实测，不是推断）

`String.prototype.length` 数的是 **UTF-16 码元**，`String.prototype.slice` 按码元切。一个 emoji 占 2 个码元，一面国旗（`🇯🇵` = 两个 regional indicator）占 4 个。本批实测三条：

```
'a'.repeat(19) + '🎉尾巴'  →  .length=23，.slice(0,20) = "aaaaaaaaaaaaaaaaaaa\ud83c"   尾部孤立高位代理
'🇯🇵 flag'                  →  .length=9 ，[...s].length=7 ，.slice(0,2) = "🇯"          半面国旗
'抖音好物分享 🎉🎉 爆款'      →  .length=14，码点=12                                       字数虚高 2
```

后果分两类，都是用户可见的：

1. **截断把字形切半** → 渲染成豆腐块/问号。本产品的标题、备注、错误摘要里 emoji 与国旗是常态（社媒文案），不是边角。
2. **字数口径不统一** → 同一份内容在不同页面显示不同字数。

审计 4.7 原文经评审 w10 修正为：**展示口径统一为 Unicode 码点（一处实现）**，并明确否证了"统一单位"的旧写法（百家号标题上限由平台按 UTF-8 字节强制，单位是被动事实，不由我们选）。

## 二、真源清点（收敛前）

全仓 `apps/desktop/src` 内三种口径并存，`git ls-files` + 逐文件读取得出：

| 形态 | 处数 | 位置 |
| --- | --- | --- |
| `.slice(0, N) + 省略号` | 13 | `film-canvas/ShotNode.vue`、`PublishProgressTaskRow.vue`×2、`useCollectionDrafts.js`、`usePipelineHistory.js`、`QuickCollectPanel.vue`、`gen-video-view-model.js`、`HotTopics.vue`、`ResultView.vue`、`StageProgress.vue`、`useFeatureFlag.js`、`Collection.vue`(模板)、`FilmEngineeringView.vue` |
| `Array.from(x).length`（本来对，但是各写一份） | 3 | `ConfigProfileManager.vue`×3 |
| `.length` 当字数用 | 2 | `useCopyLibrary.js`、`useCopyLibrarySources.js` 的 `wordCount` |

**没有任何一处共享实现**（`packages/shared-utils` 里既无 `text-length` 也无长度原语）。这正是"第五处会被写成第四种形态"的成因。

## 三、实现

### 3.1 唯一实现：`packages/shared-utils/src/text-length.js` + `.browser.js` 孪生

| 导出 | 语义 | 关键取舍 |
| --- | --- | --- |
| `toCodePoints(v)` | `Array.from` 的唯一封装点 | 禁止外部再写第二份 `Array.from` |
| `codePointLength(v)` | 码点计数；`null/undefined → 0`，非字符串先 `String()` | — |
| `truncate(v, max, ellipsis='…')` | **max 是正数码点数，省略号另加** | 与既有 13 处的语义逐字一致 ⇒ 迁移零宽度变化，可被既有测试验证 |
| `truncateWithin(v, max, ellipsis='…')` | **总宽（含省略号）≤ max** | 给"宽度是硬合同"的场景；`max ≤ 省略号长度`时只截断不放省略号，不得反向违约 |
| `hasDanglingSurrogate(v)` | 孤立高/低代理探针 | 供测试与排障，不参与业务判定 |

三条写进文件头的口径：

1. **按码点，不按字素簇。** `"e\u0301"` 是 2 码点 1 视觉字符，emoji 家族（ZWJ 序列、肤色修饰符）是多码点一字符。本仓刻意不上溯到 `Intl.Segmenter`：双侧可用性不一致，而平台侧限制本身按码点/字节计，码点口径**可与平台对账**。这句话必须写在源码里，否则下一个会话会把"码点"误读成"字符数"并顺手换实现。
2. **非法 `max` 收敛到 0**（`NaN`/负数/小数截断），不抛错也不出现负数切片语义。
3. **渲染端不读 `process.env` 做档位**：本仓产物级实测渲染进程读任意 env 被 Vite 注成空对象桩 ⇒ env 旋钮是恒不生效的死开关。生产用常量，测试用显式入参。

**接线**：`apps/desktop/vite.config.js` 登记 `@multi-publish/shared-utils/src/text-length → …​.browser.js`，与 `safe-http-url` / `article-body-format` / `publish-gate-help` 同先例。**未登记 alias 的后果**（同族实测过）：Vite 拉到 CJS 版 ⇒ 具名导入拿不到 ⇒ 挂载期报错，而单测域解析到 CJS 所以本地全绿。

### 3.2 迁移（截断类 16 处中收敛 14 处，2 处带理由登记；另 5 处计数站点；合计 19 站点 / 16 文件）

- 14 处 `.slice/.substring + 省略号` → `truncate` / `truncateWithin`（按上表语义逐字对应，含 `useFeatureFlag.js` 那条带 `/^.{0,24}$/` 前置守卫的写法）。
- 2 处 `wordCount: … || it.content.length` → `codePointLength(it.content)`。**这条会改变显示数字**（含 emoji 时变小）—— 变小才是正确口径，且审计 4.7① 要的就是这个。
- 3 处 `Array.from(name).length` → `codePointLength(name)`，行为零变化，目的是消灭"第五份写法"。
- 2 处留在例外清单并写明原因（`Collection.vue` 在模板里、改动要动模板结构；`FilmEngineeringView.vue` 在像素判定域内，改可见宽度须与基线刷新同批）。

### 3.3 未做的两件事（不得被读成已做）

1. **平台侧字节上限不改**：AGENTS 的 `formatArticleBody` 契约与各平台内容限制表由发布链持有，本批只统一**展示**口径；把展示改成码点不等于把校验改成字节安全，两者判据不同。
2. **富文本模式补上限（审计 4.7③）** 是独立切片，本批不做。

## 四、显示项 / 交互 / 提示文字

| 面 | 变化 |
| --- | --- |
| 截断后的文案 | ASCII 内容逐字不变；含 emoji/国旗时不再出现半字代理（原为豆腐块） |
| 字数展示（`wordCount`） | 含 emoji 时数字变小（码元 → 码点）。这是纠错，不是回归；无新增文案 |
| 新增文案 | **零**。不新增 locale 键（AGENTS 死键禁令） |
| 样式/结构 | 无 DOM、无 CSS 改动 |
| 门禁提示文字 | 防回退锁的红文案必须给**站点清单 + 修法**，且带"扫描域非空"反失明断言（见 §5） |

## 五、防回退锁（`apps/desktop/src/text-length-convergence.test.js`）

把"一次收敛"变成"持续合同"。四条判据形状都是本仓明文要求的：

1. **只按风险语法位置切**：判据是「`.slice(0, X)` 之后紧跟字符串字面量拼接」，不按"文件里出现过 slice"切 ⇒ `text.slice(0, at)`（按索引分段）这类合法用法一律放行。
2. **扫描域非空下界 + 空域抛错**：`git ls-files` 取 `apps/desktop/src/**`，`>300` 个源文件为下界，取到 0 直接抛错 —— 不抛就会把"什么都没扫"读成"零违规通过"。**本文件第一版就踩了这个坑**：`execFileSync` 未传 `cwd`，从 `apps/desktop` 用仓库相对 pathspec ⇒ 0 匹配、rc=0、零报错，被自己的下界断言当场抓红。
3. **例外清单只能缩小 + 不得陈旧**：登记项若当场已无命中即红（逼下一个把 `Collection.vue` 修掉的人同次销账），每条必须带 >20 字的实质理由。
4. **接线与正向对偶**：≥9 个生产源文件必须真的 import 该共享实现；另加一条"共享实现确实挡得住代理对切半"的行为正控 —— 只有禁令没有正控，锁就只是在禁形式。

## 六、验证（本机全部实跑）

- `packages/shared-utils`：`text-length.test.js` 8 条 + `text-length-parity.test.js`（10 向量 × 8 档位的 CJS/ESM 行为对账 + 导出面清点）→ **14 passed**。
- `apps/desktop`：`text-length-convergence.test.js` 6 条 + `useFeatureFlag.test.js` → **23 passed**。
- 12 个被迁移文件的既有测试面：`vitest run` 10 个套件 → **277 passed**（未改任何既有断言 ⇒ 迁移对 ASCII 文案逐字无影响的可执行证据）。
- 判据是**当场发现漏网**的：防回退锁第一次跑就抓到第 13 处（`useFeatureFlag.js:113`），该处不在我先前 grep 的清单里 —— 这条是本锁有效性的直接证据，也说明"人工 grep 定域"仍不可靠。

## 七、验收标准

AC1 新增两文件（CJS + ESM 孪生）+ 两份测试全绿；AC2 `vite.config.js` alias 已登记；AC3 截断类 16 处中 14 处迁移（另有 5 处计数站点）、2 处带理由登记且例外清单有非空与陈旧双向判据；AC4 防回退锁在**新增同类写法时必须变红**（由"违规只允许出现在例外清单里"承担）；AC5 PR CI 的 `QG Desktop Shards` / `QG Coverage` / `Gate Result` 绿；AC6 不触 `.github/workflows/` 与 `scripts/check-*` ⇒ 非高危面，CI 绿后按 AGENTS 自动合并。

## 八、残余风险

1. 例外 2 处仍是码元截断（理由见 §3.2）；在它们被修掉之前，锁会把它们计为"已登记欠账"，不会静默消失。
2. `wordCount` 只改了两个消费者；若还有别处按码元统计字数（例如服务端 `python-backend` 的统计），不在本批域内。
3. 平台侧字节上限与展示码点口径之间仍有间隙：这是 w10 修正承认的被动事实，正解是就地显示该平台真实单位（审计 4.7②），未在本批。
