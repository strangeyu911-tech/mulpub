# PRD — 会员视频创作功能门禁（P1-1，v1.0）

> **状态**：🟢 已实现（2026-10-27）
> **上游机制**：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.4 §4.3/§6.2/§10
> **数值真源**：`packages/api-publish-engine/src/auth/plan-matrix.js`
> **执行记录**：`openspec/records/member-tier-p1-video-gate.md`

---

## 1. 背景

v3.1 机制把视频创作从「成片条数/分辨率档位」改成**功能开关**：免费不可用，标准/专业可用，不设成片条数上限。服务端 `plan-matrix` 已派生 `video_create`（`videoMonthly !== 0`），但客户端没有任何消费点，免费用户仍可进入 `/create` 并使用采集页、热门选题的就地视频创作。

P1-1 目标：**免费入口关闭；标准/专业可用。**

## 2. 功能契约

| 档位 | `features` 是否含 `video_create` | 视频创作 |
|---|---|---|
| 免费 | 否（只有 `cloud_publish` / `ai_write` / `official_credit`） | 不可用，显示升级锁定页 |
| 标准 | 是 | 可用 |
| 专业 | 是 | 可用 |

`video_create` 由服务端派生，客户端不自行按 `plan` 字符串硬编码；只读 `entitlement.features`。

## 3. 客户端判据

新增 `apps/desktop/src/features/member/plan-features.js`：

```js
hasFeature(entitlement, 'video_create')
// true  = 明确有
// false = features 非空且明确不含
// null  = entitlement / features 缺失或空数组 → 放行（缺失即放行）
```

**为什么空数组也放行**：identity store 的 `normalizeState` 会把缺失的 `features` 归一成 `[]`；若把 `[]` 判成未授权，一次旧快照字段漂移会把全体付费用户锁在功能外。这是与 `plan-limits` 相同的 fail-open 纪律。

## 4. 入口与交互

### 4.1 `/create` 整页门禁

- 路由 `/create` 的组件从 `CreateView.vue` 改为 `CreateGateView.vue`（薄包装层）。
- `CreateGateView` 把 `feature-key="video_create"` 与标题 `memberCenter.videoCreateTitle` 交给 `MemberFeatureGate`。
- 锁定态**不挂载** `CreateView`：避免免费用户先看到流水线列表、再被挡；也避免无意义的 `pipeline:list` / 渲染状态 IPC。

### 4.2 `MemberFeatureGate` 三态

| 状态 | 条件 | 显示 |
|---|---|---|
| `checking` | 尚无 entitlement 且 `load()` 未完成 | 居中 spinner + `memberCenter.featureGateChecking` |
| `locked` | `hasFeature(...) === false` | 锁图标 + 标题 + `featureLockedBody` + `featureLockedHint` + `featureLockedCta` |
| `allowed` | `true` / `null` | 渲染默认 slot（`CreateView`） |

CTA「查看套餐」→ `/member-center?section=subscription`。

### 4.3 就地视频创作入口

除 `/create` 外，还有两个**不跳页**的视频创作入口，必须用同一判据拦截：

| 入口 | 文件 | 行为 |
|---|---|---|
| 采集页「去发布 → 视频创作」 | `useCollectionVideoCreation.startVideoCreation` | `hasFeature === false` → 打开进度浮层、置 `failed`、显示 `collection.videoCreate.upgradeRequired`，不调用 `pipelineStartOrchestrated` |
| 热门选题「生成视频」 | `useHotTopicsGenVideo.startGenerateVideo` | 同上；显示 `hotTopics.genVideoUpgradeRequired`，不调用 `pipelineStartOrchestrated` |

两个 composable 通过 `getEntitlement` 注入读取权益；未传时返回 `null`（测试/旧调用放行），生产视图传 `() => identityStore.entitlement`。

## 5. 提示文字

| key | 中文 | 英文 |
|---|---|---|
| `memberCenter.featureGateChecking` | 正在检查会员权益… | Checking membership… |
| `memberCenter.featureLockedBody` | 「{feature}」是标准版及以上功能，升级后即可使用。 | "{feature}" is available on Standard and Pro plans. Upgrade to unlock it. |
| `memberCenter.featureLockedHint` | 升级标准版或专业版后自动解锁，无需重新登录。 | It unlocks automatically after upgrading. No need to sign in again. |
| `memberCenter.featureLockedCta` | 查看套餐 | View plans |
| `memberCenter.videoCreateTitle` | 视频创作 | Video creation |
| `collection.videoCreate.upgradeRequired` | 视频创作是标准版及以上功能，升级后即可使用。 | Video creation is available on Standard and Pro plans. Upgrade to unlock it. |
| `hotTopics.genVideoUpgradeRequired` | 视频创作是标准版及以上功能，升级后即可使用。 | Video creation is available on Standard and Pro plans. Upgrade to unlock it. |

## 6. 数据校验与边界

| 场景 | 判据 | 结果 |
|---|---|---|
| entitlement 缺失 | `hasFeature → null` | 放行（旧快照/身份服务未启用） |
| `features` 缺失 / 空数组 | `null` | 放行（同上） |
| `features` 非空且不含 `video_create` | `false` | 锁定 |
| `features` 含 `video_create` | `true` | 放行 |
| 升级后不刷新页面 | `getEntitlement` 每次实时读 store；`allowed` computed | 自动解锁 |
| 降级后停留在 `/create` | `allowed` computed 变 false | 立即切锁定页 |
| 免费用户直接输入 `/create` URL | 路由加载 `CreateGateView` | 锁定页（不能绕过） |
| 免费用户从采集页启动 | composable 判据 | 失败态 + 升级提示，不启动 |
| 免费用户从热门选题启动 | composable 判据 | 失败态 + 升级提示，不启动 |
| 付费但 `licenseStore.isPro=false`（纯订阅） | 只看 entitlement features | 可用（不再受旧买断标记影响） |

## 7. 流程

```
进入 /create
  └─ CreateGateView
       └─ MemberFeatureGate(featureKey=video_create)
            ├─ entitlement 已有？── 是 → allowed? ─┬─ true/null → 渲染 CreateView
            │                                      └─ false → 锁定页
            └─ 否 → identityStore.load()
                 ├─ 成功 → 重新判 allowed
                 └─ 失败/无信息 → null → 渲染 CreateView（fail-open）

采集页 / 热门选题点视频创作
  └─ startVideoCreation / startGenerateVideo
       ├─ hasFeature === false → 打开浮层 + failed + 升级文案；return false
       └─ true/null → 原启动流程
```

## 8. 验收标准

- [ ] 免费档直接访问 `/create`：显示锁定页（标题、说明、查看套餐），不渲染 `CreateView`。
- [ ] 免费档点侧边栏「视频创作」：落到同一锁定页。
- [ ] 免费档从采集页「视频创作」：不启动流水线，进度浮层显示升级文案。
- [ ] 免费档从热门选题「生成视频」：不启动流水线，失败态显示升级文案。
- [ ] 标准/专业档：`/create` 正常渲染 `CreateView`，采集页/热门选题正常启动。
- [ ] entitlement 缺失或 features 空：放行，不误拦旧快照。
- [ ] 升级后无需刷新：`getEntitlement` 实时读取，锁定页自动解锁。
- [ ] CTA 跳 `/member-center?section=subscription`。
- [ ] 既有 CreateView / Collection / HotTopics 测试不回归。

## 9. 非目标（本切片）

- 不新增主进程 `pipeline:start` 的 `video_create` 硬门禁：本切片是**客户端入口层**，与账号上限 P0 的客户端硬限制同一层；主进程 IPC 级防绕过作为 P1-1b 单独评估（需同步改 `license-access-control` feature map 与测试）。
- 不改视频成片条数、分辨率、去水印（v3.1 已明确不做档位）。
- 不改 `videoMonthly` 数值；只消费 `features.video_create`。

## 10. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| 纯判据 | `plan-features.test.js` | 缺失/null、空数组、免费 false、标准 true、精确 key |
| 组件 | `MemberFeatureGate.test.js` | 锁定/放行/缺失 fail-open/CTA |
| 路由包装 | `CreateGateView.test.js` | featureKey + title + slot 接线 |
| 采集页 | `useCollectionVideoCreation.test.js` | 免费档拒绝、不调 pipelineStart |
| 热门选题 | `HotTopics.test.js` | 免费档拒绝、不调 pipelineStart |
| 静态 | `check-route-registry` | `/create` view 与 router import 一致 |
| 回归 | CreateView / Collection / HotTopics 既有用例 | 默认（entitlement 缺失）不回归 |
