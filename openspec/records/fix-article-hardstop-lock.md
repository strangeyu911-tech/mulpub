---
record: fix-article-hardstop-lock
task: 修主干红 —— ArticleEditor 富文本硬拦锁断言的是改名前的表达式（#4525 × #4498 的语义冲突，git 层不可见）
date: 2026-10-28
branch: fix-article-hardstop-lock
---

# 执行记录：富文本硬拦锁对齐单一真源（fix-article-hardstop-lock，2026-10-28）

## 一、主干红的第一性原因（不是"某条用例写错了"）

主干 `QG Desktop Shards` 在 `7e0659bba` 起红在：

```
FAIL src/components/ArticleEditor.hard-stop.test.js > 接线：超限内容必须穿过 ArticleEditor 的富文本回写口
     > 结构锁：Markdown 侧仍走 maxlength；QuillEditor 标签上不得出现 maxlength
AssertionError: Markdown 侧的 maxlength 丢了: expected false to be true
Test Files  1 failed (1) / Tests  1 failed | 8 passed
```

锁断言的是 `:maxlength="maxChars"`，而模板里已是 `:maxlength="effectiveMaxChars"`。

**真因是两条并行 PR 的语义冲突，而 git 层看不见它**：

| 时间线 | 事实 |
| --- | --- |
| 2026-10-28 早些 | #4498（`fix(publish): 编辑器字数上限按所选平台就地生效`）把模板从 `:maxlength="maxChars"` 改成 `:maxlength="effectiveMaxChars"`（+ 垃圾分母修正） |
| 之后 | #4525（`fix(editor): 富文本正文上限真正生效`）**新增** `ArticleEditor.hard-stop.test.js`，其中一条结构锁按当时的写法断言 `maxChars` |
| squash 合并 | #4525 的分支早于 #4498，两侧**改的不是同一行** ⇒ 合并无冲突；落主干后「新锁 + 新表达式」第一次同时存在 ⇒ 当场红 |

⇒ 这正是本仓反复记的「PR 侧全绿 ≠ main 会绿」的同型：**绿只在旧基线上成立**。
`git diff --stat` / 冲突检测对这类"名字改了、引用没跟上"结构上失明。

## 二、修法（只改判据的绑定名，不改实现、不放宽语义）

- 结构锁的期望表达式从 `maxChars` 改为 `effectiveMaxChars`（单一真源就是模板里那一个绑定）。
- **语义一处没松**：仍然要求 Markdown 侧 `<textarea … :maxlength="…">` 在位、`<QuillEditor>` 标签上不得出现 `maxlength`、
  富文本回写口仍走 `truncateContentToLimit(val, props.maxChars)`（`maxChars` 是 **prop 名**，没有改名，所以第三条一字不动）。
- 没有改 `ArticleEditor.vue`：#4498 的 `effectiveMaxChars` 是有意为之（未选平台/未知平台时避免垃圾分母），
  把实现改回去等于撤销那条修复。

## 三、先红后绿（当场读数）

| 步骤 | 命令 | 读数 |
| --- | --- | --- |
| 红（改前，主干内容） | `pnpm exec vitest run src/components/ArticleEditor.hard-stop.test.js`（cwd=`apps/desktop`） | `Test Files 1 failed (1) / Tests 1 failed \| 8 passed`，红在结构锁 |

绿侧读数见本文件末尾「复跑」。

## 四、门禁

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 变更类型 | ✅ | 测试判据修正（`apps/desktop/src/components/*.test.js`）+ 本记录；未触 `electron/`、`packages/rpa-engine/` |
| QM-1 | N/A | 未改打包相关路径 |
| QM-4 | N/A | 判据文件不参与渲染，零像素变化 |
| QM-6 | N/A | 本次改动不含 `mode=dual` 产物（见下） |
| 旧载体冻结 | ✅ | 只写本篇 `openspec/records/` |

## 远程同步

| 远程同步 | 由门禁推导 | 本行不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（只认 squash 尾注 `(#NNNN)`）。main push 回读证据写在 PR 评论里，不写回本文件。 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR 见本 PR 页面（收口由门禁推导）

## 五、复跑（绿侧，当场）

`pnpm exec vitest run src/components/ArticleEditor.hard-stop.test.js src/components/ArticleEditor.max-chars.test.js`（cwd=`apps/desktop`）
⇒ **`Test Files 2 passed (2) / Tests 23 passed (23)`**（rc=0）。同时跑 max-chars 那篇是为了确认本条没有把 #4498 的垃圾分母判据顶掉。
