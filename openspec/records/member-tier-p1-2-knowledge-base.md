# member-tier-p1-2-knowledge-base 执行记录

> 分支 `member-tier-p1-2-knowledge-base` ｜ worktree `mp-member-tier-p1-2-knowledge-base`（D 盘隔离区）
> 上游：`01-docs/PRD-MEMBER-TIER-KNOWLEDGE-BASE-2026-10-27.md`；`01-docs/MECHANISM-MEMBER-TIERS.md` v3.6

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

## 一、一句话

P1-2：`knowledgeBase` 矩阵开关派生出 `features.knowledge_base`；`/knowledge-base` 改走 `KnowledgeBaseGateView`，免费档显示升级锁定页，标准/专业渲染原知识库页。

## 二、产出

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/plan-matrix.js` | `knowledgeBase` 三档开关（false/true/true）；features 派生 `knowledge_base` |
| `packages/api-publish-engine/test/plan-matrix.test.js` | 免费不含 / 标准与专业含 `knowledge_base` 断言 |
| `apps/desktop/src/views/KnowledgeBaseGateView.vue` | `/knowledge-base` 薄包装：`featureKey=knowledge_base` + `KnowledgeBasePage` slot |
| `apps/desktop/src/views/KnowledgeBaseGateView.test.js` | 1 例：featureKey/title/slot 接线 |
| `apps/desktop/src/router/index.js` | `/knowledge-base` 改为懒加载 `KnowledgeBaseGateView.vue` |
| `apps/desktop/src/config/route-registry.js` | view 同步为 `KnowledgeBaseGateView.vue` |
| `apps/desktop/src/locales/member-center/{zh,en}.js` | 新增 `knowledgeBaseTitle` |
| `apps/desktop/tests/e2e/helpers/ipc-mock.js` | pro 夹具补 `knowledge_base`（避免视觉/E2E 误判锁定页） |
| `01-docs/PRD-MEMBER-TIER-KNOWLEDGE-BASE-2026-10-27.md` | 新增 P1-2 详细 PRD |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.6：知识库矩阵、风险 R3、P1-2 状态 |

## 三、数据契约

- `knowledgeBase`：免费 false；标准/专业 true（非数值、不可 overrides）。
- `features.knowledge_base`：仅标准/专业声明；免费无。
- 客户端 `hasFeature`：缺失/空 features → null（放行）；非空不含 → false（锁定）。
- 本切片是**客户端入口层**；`knowledge-library:*` IPC 硬门禁未做，登记为 P1-2b。

## 四、测试读数

| 项 | 读数 |
|---|---|
| `plan-matrix.test.js` | **22 passed** |
| `KnowledgeBaseGateView` + `KnowledgeBaseHotsyncUi` + `KnowledgeBasePage.viral-queue` | **13 passed / 3 files** |
| `api-publish-engine` 全量 | **504 passed / 47 files** |
| `check-route-registry` | PASS（36 路由 / 36 登记 / 22 菜单 / 11 暗路由） |
| `check-locale-sync --pair-base origin/main` | PASS |
| eslint | 待跑 |
| `check-max-lines` / `check-doc-abs-paths` | 待跑 |

## 五、QM-1

- 本 PR 未改 `apps/desktop/electron/` 或 `packages/rpa-engine/`，QM-1 **N/A**。
- 渲染层默认（entitlement 缺失）仍直接渲染 KnowledgeBasePage；锁定页只在明确免费档出现。QG Visual 负责像素回归。

## 六、QM-4（视觉）

- 复用 `MemberFeatureGate` 的整页锁定态，无新增全局样式。
- 默认知识库页 DOM 不变；免费锁定态是新增分支，QG Visual 随 PR 跑全量。

## 七、QM-6（深度评审）

- 待提交时由 CCG 门禁判定；若判定需要评审，按 `scripts/deep-review.sh` 执行并回写本节。

## 八、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | `knowledge-library:*` IPC 的 `knowledge_base` 硬门禁（防程序化绕过） | P1-2b 评估 |
| 2 | 视频创作已有客户端 + IPC 门禁（P1-1/P1-1b） | 已完成 |
| 3 | 定时/自动化/积分/设备数 | P1-3~P1-6 |

## CHANGELOG 条目

# 知识库会员门禁：免费档入口关闭，标准/专业可用

- `plan-matrix` 新增 `knowledgeBase` 开关，派生 `features.knowledge_base`（免费无 / 标准+专业有）
- `/knowledge-base` 改为 `KnowledgeBaseGateView` 整页门禁；免费显示升级锁定页且不挂载知识库页
- 复用 `MemberFeatureGate` 三态与 P1-1 文案；新增 `memberCenter.knowledgeBaseTitle`
- E2E/视觉 pro 夹具补 `knowledge_base`
- 测试：plan-matrix 22 例 + 知识库页面 13 例 + API 全量 504 例
