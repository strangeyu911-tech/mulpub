# member-tier-p1-video-gate 执行记录

> 分支 `member-tier-p1-video-gate` ｜ worktree `mp-member-tier-p1-video-gate`（D 盘隔离区）
> 上游：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.4 §10 P1-1；`01-docs/PRD-MEMBER-TIER-VIDEO-GATE-2026-10-27.md`

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

## 一、一句话

P1-1：消费 `entitlement.features.video_create`，免费档在 `/create`、采集页「视频创作」、热门选题「生成视频」三个入口被拒并显示升级提示；标准/专业可用。

## 二、产出

| 文件 | 变更 |
|---|---|
| `apps/desktop/src/features/member/plan-features.js` | 新增 `hasFeature`：缺失/空 features → null（放行），非空不含 → false |
| `apps/desktop/src/features/member/plan-features.test.js` | 5 例：缺失、空数组、免费 false、标准 true、精确 key |
| `apps/desktop/src/features/member/components/MemberFeatureGate.vue` | 新增整页三态门禁（checking / locked / allowed） |
| `apps/desktop/src/features/member/components/MemberFeatureGate.test.js` | 3 例：免费锁定 + CTA、标准放行、缺失 fail-open |
| `apps/desktop/src/views/CreateGateView.vue` | `/create` 薄包装：`featureKey=video_create` + `CreateView` slot |
| `apps/desktop/src/views/CreateGateView.test.js` | 1 例：featureKey/title/slot 接线 |
| `apps/desktop/src/router/index.js` | `/create` 改为懒加载 `CreateGateView.vue` |
| `apps/desktop/src/config/route-registry.js` | `/create` view 同步为 `CreateGateView.vue` |
| `apps/desktop/src/composables/useCollectionVideoCreation.js` | 新增 `getEntitlement` 注入 + 免费档拒绝（不启动流水线） |
| `apps/desktop/src/composables/useHotTopicsGenVideo.js` | 新增 `getEntitlement` + 免费档拒绝（不启动流水线） |
| `apps/desktop/src/views/Collection.vue` / `HotTopics.vue` | 传入 `getEntitlement: () => identityStore.entitlement` |
| locales（member-center / collection / hot-topics，zh+en） | 新增 7 组门禁文案 |
| `01-docs/PRD-MEMBER-TIER-VIDEO-GATE-2026-10-27.md` | 新增 P1-1 详细 PRD |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.4：视频创作矩阵、缺陷 H、P1-1 状态 |

## 三、数据契约

- `features.video_create`：免费无；标准/专业有（服务端 `videoMonthly !== 0` 派生）。
- `hasFeature`：`null` = 无信息（放行）；`false` = 明确没有；`true` = 有。
- `features` 空数组按无信息处理：identity store 对缺失 features 归一成 `[]`，不能误伤旧快照。
- 判据只读 entitlement，不读 `plan` 字符串、不读 `licenseStore.isPro`。

## 四、测试读数

| 项 | 读数 |
|---|---|
| `plan-features` + `MemberFeatureGate` + `CreateGateView` + `useCollectionVideoCreation` + HotTopics 三文件 | **103 passed / 7 files** |
| `Collection.test.js` + `Collection.rewrite-publish-flow.test.js` + `collection-visual-case-contract.test.js` | **130 passed / 3 files** |
| `check-route-registry` | PASS（36 路由 / 36 登记 / 22 菜单 / 11 暗路由） |
| `check-locale-sync --pair-base origin/main` | PASS |
| `check-max-lines` | PASS（无新增超大文件） |
| `check-no-brand-residue` | PASS |
| `eslint`（改动文件） | rc=0 |

## 五、QM-1

- 本 PR 未改 `apps/desktop/electron/` 或 `packages/rpa-engine/`，QM-1 **N/A**。
- 渲染层默认（entitlement 缺失）仍直接渲染 CreateView；锁定页只在明确免费档出现。QG Visual 负责像素回归。

## 六、QM-4（视觉）

- 新增 `MemberFeatureGate` 整页锁定态使用主题 token（`--canvas` / `--border-light` / `--color-text-*`），无新全局样式。
- `/create` 默认态（无身份快照/付费）DOM 不变；免费锁定态是新增分支，QG Visual 若命中需补基线。

## 七、QM-6（深度评审）

- 待提交时由 CCG 门禁判定；若判定需要评审，按 `scripts/deep-review.sh` 执行并回写本节。

## 八、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | 主进程 `pipeline:start` / `pipeline:startOrchestrated` 的 `video_create` 硬门禁（防程序化绕过） | P1-1b 评估（需改 `license-access-control` feature map + 测试） |
| 2 | 知识库 `knowledge_base` feature | P1-2 |
| 3 | 定时任务/自动化配额 | P1-3 / P1-4 |
| 4 | 官方积分 grant/consume | P1-5 |
| 5 | 设备数 1/3/不限 | P1-6 |

## CHANGELOG 条目

# 视频创作会员门禁：免费档入口关闭，标准/专业可用

- 新增 `hasFeature` 功能开关判据：缺失/空 features 放行，非空明确不含才锁定
- `/create` 改为 `CreateGateView` 整页门禁；免费显示升级锁定页，标准/专业渲染原创作页
- 采集页「视频创作」、热门选题「生成视频」就地入口同步拦截，不启动流水线
- 新增 7 组 zh/en 文案；CTA 跳会员中心订阅区
- 测试：门禁/路由/采集/热门选题 103 例 + Collection 回归 130 例
