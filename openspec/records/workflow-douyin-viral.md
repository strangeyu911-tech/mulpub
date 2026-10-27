---
record: workflow-douyin-viral
task: 抖音爆款库来源 + 行业枚举（P1-6）
date: 2026-10-27
---

## 本次执行记录：抖音爆款库来源（workflow-douyin-viral，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + DB 迁移 + 文档：隔离 worktree `mp-worktrees/mp-workflow-reliability-v2`，分支 `workflow-douyin-viral`；基于 `origin/main` |
| QM-5（Bug 反哺） | N/A | 新来源功能；旧数据 industry 为空是显式数据质量门禁，不做静默回填 |
| 行尾与 diff 对账 | PASS | `git diff --check` 无空白错误 |
| 接线棘轮 | PASS | schema/source/store/UI 测试均扩展；`check-max-lines` 无新增超大文件 |
| QM-1 打包 | PASS | `electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS（asar/exe、require、8 秒存活 stderr 空） |
| QM-6 CCG | PASS | 两轮 `ccg-review.ps1 -Mode Deep`；第二轮 5 条逐条裁决，i4/i5 已修复，i2 高危域 externalReview 见 PR #4547 issuecomment-6439180919 |
| 远程同步 | 由门禁推导 | 合并后按 squash 尾注由 merge-ledger 推导 |

### 验证证据

- 受影响测试（workflow 12 文件 + 迁移/搜索/爆款库 5 文件）：**129 tests passed**
- UI 定向测试（WorkflowEditor / ViralFormDialog / ViralLibraryTable）：**41 tests passed**
- `pnpm run build:vue` → success
- QM-1 复跑：`electron-builder --win --dir` + `qm1-scheduled-publish-verify.cjs` 三阶段 PASS
- `node .github/scripts/check-max-lines.js` → 无新增超大文件
- i4 修复：缺标题/正文的爆款现在输出 `N 条爆款缺少标题或正文，已跳过` warning，不再静默丢弃

### 数据源定义

- 来源是 `viral_library` 中 `platform=douyin` 的已采集内容，不实时抓抖音。
- 行业枚举共享文件：`apps/desktop/shared/viral-industries.json`。
- 旧数据 industry=''，不会被 `douyinViral` 来源选中；需在爆款库补行业。

### 遗留（不假装已闭合）

- 采集链路未自动推断行业；行业由录入/采集侧填写。
- 只定义抖音，不包含其他平台爆款。

## CHANGELOG 条目

# feat(automation): 抖音爆款库来源 + 行业枚举（P1-6）

- 爆款库新增 industry 列与迁移；工作流新增 `douyinViral` 来源，按行业/最低点赞筛选。
- 爆款库表单/列表新增行业字段；共享行业枚举文件。
- 明确不实时抓抖音，无数据时先到爆款库采集。

## learnings

### lesson: 「没有数据源」不等于「不能做来源」

把已存在的爆款库定义为数据源，并补行业维度，比假装实时抓抖音更诚实。来源名、空态文案与 PRD 必须明确「读的是已采集库」，避免用户误以为实时热榜。
