---
record: pipeline-smoke-artifact
task: 流水线 E2E 冒烟增量 7——localization-dub 产物提取（sync 阶段）修复并真实 PASS
date: 2026-10-28
---

## 本次执行记录：localization-dub 产物提取（pipeline-smoke-artifact，2026-10-28）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码 + 测试 ⇒ 隔离 worktree（D 盘非 C）、裸分支 `pipeline-smoke-artifact` |
| 第一性原因（QM-5 ①） | ✅ | `findOutput` 只认 `render/report/compose/finalize/export` 五个阶段；`localization-dub` 的成品在 `sync.videoPath`，导致 completed 后误报 `NO_ARTIFACT`。 |
| 逃逸分析（QM-5 ②） | ✅ | 单测只覆盖 render/report，没有覆盖 sync；manifest 只声明 pipeline 名，没有产物键契约。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `findOutput` 增加 `sync` 阶段；新增 `findOutput 识别 localization sync.videoPath` 单测；真实 run `mvr2w1kp_vofb` PASS。 |
| 防止再次发生（QM-5 ⑤） | ✅ | 单测锁 sync；分析报告记录各流水线产物键。 |
| 行尾与 diff 对账 | ✅ | 见验收证据 |
| 接线棘轮 | ✅ | 测试位于既有 `pipeline-smoke-cdp.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未改 renderer/样式 |
| QM-6 CCG 双模型外部评审 | ✅ | self_play_resolved / 	ier=external；8 条争议全部 dismissed；证据 PR #4577 issuecomment-6451800279 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件

### 一、改动

- `apps/desktop/tests/e2e/pipeline-smoke-cdp.js`：`findOutput` 的阶段白名单加 `sync`。
- `apps/desktop/electron/tests/pipeline-smoke-cdp.test.js`：+1 例（8 passed）。
- 分析报告/技能：真实验证矩阵更新为 11 PASS + 3 个选择/契约阻塞。

### 二、验收证据

- `pnpm exec vitest run electron/tests/pipeline-smoke-cdp.test.js` → **8 passed**
- `localization-dub`：`STATUS=PASS`，`RUN_ID=mvr2w1kp_vofb`，`DURATION_MS=6217`，`PROBE={"duration":2.304,"codecs":["h264","aac"]}`

### 三、边界

- `sync` 只加在产物提取层；不改变流水线执行语义。
- `animated-explainer`（research schema）、`avatar-spokesperson`（缺 avatarId）、`film-engineering`（缺 selectedShotIds）仍不是可自动跑通的状态。

## CHANGELOG 条目

# localization-dub 产物提取修复（pipeline-smoke-artifact）

`findOutput` 增加 `sync` 阶段，localization-dub 真实 PASS；冒烟矩阵更新为 11 条真实 PASS + 3 条选择/契约阻塞。

## learnings

### lesson: artifact-stage-whitelist

需要 provider 的流水线成品不一定在 render/report；`localization-dub` 在 `sync.videoPath`。产物提取白名单必须与每条流水线的 final stage 契约同步，否则 completed 也会误报 NO_ARTIFACT。
