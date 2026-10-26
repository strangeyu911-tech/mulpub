---
record: model-quota-p1-followup
task: 修复 P1a 合并后 CCG 复核发现的两套额度正则漂移与裸 billing 误判
date: 2026-10-26
branch: model-quota-p1-followup
---

## 本次执行记录：P1a 额度分类 parity/误判修复（model-quota-p1-followup，2026-10-26）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **运行时代码变更**：独立 worktree `<仓库父目录>/mp-worktrees/mp-model-quota-p1-followup`（D 盘，非 C）+ 裸分支 `model-quota-p1-followup`；依赖 `pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js` 已就绪。 |
| 第一性原因（QM-5 ①） | ✅ | ① 两套额度正则独立实现且无对拍测试，导致同一文案在 `classifyProviderFailure`（重试）与 `classifyModelAccessFailure`（用户提示）下分叉；② 两侧都把裸词 `billing` 当额度信号，`"billing portal unavailable"` 被误判 quota；③ `insufficient_quota` / `insufficient_balance` 下划线形态漏匹配。 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸链：① 单测层：两个测试文件各自只测自己的正则，没有同一 fixture 的双分类对拍；② 集成层：`callAdapter` 测试只断言单侧结果，没有验证重试/提示一致性；③ 审查层：P1a 注释写着「两套枚举由测试锁交集」，但实际没有该测试。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `model-access-parity.test.js` 16 例：额度 fixture（`usage limit` / `insufficient_quota` / `insufficient_balance` / 无分隔符 / 双空格 / `billing hard limit` / `billing exceeded quota` / 中文余额不足）两边都判 quota；非额度 fixture（`billing portal unavailable` / `billing configuration failed` / `billingportal` / `Usage exceeds budget` / `reinsufficient_quota` / `rate limit` / invalid key）都不判 quota；429 + 限流文本仍判 rate。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 两套正则的共享语义由 parity 测试锁定；② 裸 `billing` 收窄为 `billing hard limit` / `billing … exceeded|insufficient|quota`；③ PRD §13.1 与 DESIGN §3.1 同步改写，不再声称不存在的「测试锁交集」。 |
| QM-1 打包 / 启动 | ✅ | `pnpm run build:vue` exit 0；`pnpm exec electron-builder --win --dir --publish never` exit 0；asar 命中 `electron/services/logger.js`；`require('@multi-publish/rpa-engine')` exit 0；`Multi-Publish.exe` 8 秒存活、stderr 0 字节。 |
| QM-2 代码必检项 | ✅ | `eslint` 变更文件 exit 0；无硬编码密钥、无 `eval`、无生产 `console.log`；仅修改纯函数正则与测试。 |
| QM-4 视觉 | N/A | 不新增/修改页面视觉。 |
| QM-6 CCG 评审 | ✅ 已执行（合并后复核驱动） | 2026-10-26 合并后 CCG 复核（claude + opencode，只读）发现 2 MAJOR + 3 MINOR；本 PR 修 MAJOR #1（正则漂移/parity 缺失）与 #2（裸 `billing` 误判），证据见 PR #4502 评论 `issuecomment-6417605458`。本 PR 的 pre-commit 判定若要求评审，按仓内 `deep-review` 流程另行补。 |
| 单测 | ✅ | P1 核心 6 文件 **177/177 passed**；MiniMax + manager 回归 7 文件 **218/218 passed**。 |
| 行尾 / diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐行相等。 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词；合并后由 merge-ledger 推导。 |

## CHANGELOG 条目

# fix(model): P1a 额度分类补双分类 parity 契约，收窄 billing 误判

修复 P1a 合并后 CCG 复核发现的两类问题：① `classifyProviderFailure` 与 `classifyModelAccessFailure` 的额度正则独立实现且无对拍，导致 `usage limit` / `insufficient_quota` / `insufficient_balance` 在重试与用户提示两侧分叉；② 两侧裸词 `billing` 会把 `billing portal unavailable` 误判为额度不足。新增 `model-access-parity.test.js` 16 例锁定共享语义，收窄 `billing` 为 `billing hard limit` / `billing … exceeded|insufficient|quota`，补齐下划线形态。

## learnings

### lesson: two-classifier-parity-must-be-a-test-not-a-comment

**问题**：两套分类器共享同一业务语义（是否额度问题），但各自维护正则；注释声称「由测试锁交集」，实际没有该测试。
**根因**：把「语义一致性」当成文档承诺，而不是可执行断言。
**修复**：同一 fixture 同时喂给两个分类器，断言额度/非额度方向一致；注释只引用测试文件，不重复承诺。
**推广**：凡两套分类器/两套枚举共享同一业务判断，必须有一个「同一输入 → 两侧同向」的 parity 测试，不能只靠注释或单侧单测。
