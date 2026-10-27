# PRD — 会员批量发布档位门禁（P0-4，v3.3）

> **状态**：🟢 已实现（2026-10-27）
> **范围**：桌面批量发布 UI + 云 `/api/v1/batch-publish` 数量判据
> **上游机制**：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.3 §4.2/§7.2/§10
> **数值真源**：`packages/api-publish-engine/src/auth/plan-matrix.js`（`batchSizePerRun` 1/10/-1）
> **执行记录**：`openspec/records/member-tier-p0-batch-entitlement.md`

---

## 1. 背景

P0-1~P0-3 已把绑定账号数落成客户端硬限制。P0-4 处理批量发布的两个历史缺陷：

1. **UI 读错真源**：`useBatchPublish.checkBatchAccess()` 读旧 `licenseStore.isPro`。纯订阅的标准/专业用户 `isPro=false`，会被 UI 误拦，明明买了标准/专业却不能用批量。
2. **服务端先扣后判**：`/batch-publish` 先 `_authorizeImmediateEntry` 扣 `cloud_publish` 额度，再 `assertPlanCapabilitiesForRequest` 判 `batch_size_per_run`。超批量请求返回 402，但额度已经扣掉。

P0-4 的目标：**纯订阅用户可批量；被拒不扣额**。

## 2. 数据契约

| 字段 | 免费 | 标准 | 专业 | 语义 |
|---|---:|---:|---:|---|
| `limits.batch_size_per_run` | 1 | 10 | -1 | 单次批量上限；`-1` = 不限 |

**两个计量面，别混：**

- **桌面本地批量**：按**文章条数**（`articles.length`）。免费 1 条 ⇒ 批量模式无意义，直接关闭；标准最多 10 篇；专业不限。
- **云 `/batch-publish`**：一次请求是「一篇文章 × N 个平台」，按 `platforms.length` 计。免费 1 ⇒ 一次只能打 1 个平台；标准最多 10 个平台；专业不限。

> 这是同一契约在不同入口的自然投影，不是两套上限。PRD 明确写死，避免后续把「10 篇文章」和「10 个平台」互相套用。

## 3. UI 逻辑（桌面）

### 3.1 `checkBatchAccess()`

```
batchMode=false → 直接返回
limit = batchSizePerRunOf(getEntitlement())
if limit !== null && limit >= 0 && limit <= 1:
  batchMode = false
  notifyWarning('publishPage.batchSizeExceeded', { limit })
```

- `0`/`1` 都视为「本档不提供批量」：1 条没有批量意义。
- `null`（entitlement/limits 缺失）→ 放行（缺失即放行）。
- `-1` → 放行。
- `>1` → 放行，由 `addArticle` / 提交前按上限收口。

### 3.2 `addArticle()`

```
limit = batchSizePerRunOf(getEntitlement())
if limit !== null && limit >= 0 && articles.length >= limit:
  notifyWarning('publishPage.batchSizeExceeded', { limit })
  return false
articles.push(createArticleItem()); return true
```

- 返回 `false` 表示未添加，调用方可据此不报「已添加」。
- 标准档第 11 篇被拒；专业 `-1` 不拦。

### 3.3 `seedArticlesFromDrafts()`

热门选题批量交接可能一次装载多篇。达到上限时：

- 只装载前 `limit` 篇；
- 弹 `publishPage.batchSizeExceeded`；
- 返回实际装载数（不是输入数）。

### 3.4 提交前二次收口

`runBatchPublish.handleBatchPublish()` 在登录门之后、字段校验之前再判一次：

```
limit = getBatchLimit()
if limit !== null && limit >= 0 && articles.length > limit:
  notifyWarning('publishPage.batchSizeExceeded', { limit })
  return
```

防「旧草稿交接 / 直接改 articles / 未来新增入口」绕过 `addArticle`。

### 3.5 文案

| key | 中文 | 英文 |
|---|---|---|
| `publishPage.batchSizeExceeded` | 当前档位单次最多批量 {limit} 条，升级后可提高上限 | Your plan allows up to {limit} items per batch. Upgrade to raise the limit. |

> 该 key 已存在（`publish-page/zh.js:25` / `en.js`），本 PR 不新增文案。

## 4. 服务端逻辑（云 `/batch-publish`）

### 4.1 正确顺序

```
parse body
resolve media
assertPlanCapabilitiesForRequest(provider, req, { platforms, batchSize: platforms.length })
  ├─ 越界 → 402 BATCH_SIZE_EXCEEDED / PLATFORM_LIMIT_EXCEEDED，直接 return
  └─ 通过 → _authorizeImmediateEntry(req, platforms.length)  ← 这里才扣 cloud_publish
        └─ 通过 → batchPublish(...)
```

### 4.2 判据

- `batch_size_per_run = 1`：`platforms.length > 1` → 402 `BATCH_SIZE_EXCEEDED`，**不扣额**。
- `batch_size_per_run = 10`：11 个平台 → 402，不扣额；10 个平台 → 放行并扣 10。
- `batch_size_per_run = -1`：不判批量，放行。
- `limits` 缺失 / 非数字 → 放行（缺失即放行，旧快照兼容）。

### 4.3 错误响应

```json
{ "error": "BATCH_SIZE_EXCEEDED" }
```

HTTP 402。前端只依赖 `error` 码；不解析自然语言。

## 5. 异常与边界

| 场景 | 行为 |
|---|---|
| entitlement 缺失（旧快照/未登录） | UI 放行；服务端 `resolveLimits` 无数值信息 → 放行 |
| 纯订阅 standard/pro（`licenseStore.isPro=false`） | UI 读 entitlement 的 10/-1，允许批量 |
| 标准档第 11 篇文章 | `addArticle` 拒绝 + 提示；提交前二次判据兜底 |
| 免费档点批量开关 | 立即关闭批量模式 + 提示「单次最多 1 条」 |
| 云批量 2 平台 / 免费 | 402 `BATCH_SIZE_EXCEEDED`，`consumeFeature` 0 次 |
| 云批量 11 平台 / 标准 | 402，`consumeFeature` 0 次 |
| 云批量 10 平台 / 标准 | 放行，扣 10 |
| 云批量 100 平台 / 专业 | 放行，`-1` 不判 |
| `batch_size_per_run=0`（未来档位） | UI 拒绝所有批量；服务端 `platforms.length > 0` 即 402 |
| 并发/重复提交 | 仍受原有 `batchPublishing` 锁；本 PR 不改 |

## 6. 验收标准

- [ ] 标准/专业纯订阅用户（`licenseStore.isPro=false`）打开批量模式不被关闭。
- [ ] 免费档打开批量模式被关闭，并提示 `publishPage.batchSizeExceeded`（limit=1）。
- [ ] 标准档 `addArticle` 第 11 次返回 `false`，文章数保持 10。
- [ ] 热门选题交接超过上限时只装载上限条数并提示。
- [ ] `handleBatchPublish` 在 articles 超限时不创建批次（`batchCreate` 未被调用）。
- [ ] `/batch-publish` 免费档 2 平台返回 402 `BATCH_SIZE_EXCEEDED`，`consumeFeatureCalls=0`。
- [ ] `/batch-publish` 标准档 10 平台放行并扣 10；11 平台拒绝且不扣。
- [ ] `batch_size_per_run=-1` 不拦。
- [ ] `limits` 缺失时放行，不误拦旧快照。
- [ ] 既有批量发布、Publish 页、plan-limits 测试不回归。

## 7. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| UI composable | `useBatchPublish.test.js` | 标准/免费/专业/缺失；addArticle 上限；提交前复核 |
| 页面 | `Publish.test.js` | 批量模式、批量提交、既有交互不回归 |
| 服务端 | `publish-permission-recheck.test.js` | 402 不扣额；正常批量扣减 |
| 纯判据 | `plan-capabilities.test.js` | `batch_size_per_run` 边界 1/10/-1 |
| 矩阵 | `plan-matrix.test.js` | 1/10/-1 下发 |

## 8. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 桌面按文章数、云按平台数的口径被误读 | 后续改错上限 | PRD §2 写死；测试分别覆盖 |
| entitlement 缺失放行 | 旧快照暂时不拦 | 缺失即放行是既定纪律；下次 sync 自动生效 |
| 纯订阅用户 entitlement 未及时刷新 | 仍看到免费上限 | `getEntitlement` 每次判据实时读取，不缓存 |
| 回滚 | — | 回滚本 PR；无数据库迁移 |

## 9. 代码索引

| 结论 | 文件 |
|---|---|
| UI 档位判据 | `apps/desktop/src/composables/useBatchPublish.js` |
| 提交前二次收口 | `apps/desktop/src/composables/runBatchPublish.js` |
| 页面注入 entitlement | `apps/desktop/src/views/Publish.vue` |
| 纯函数 | `apps/desktop/src/features/member/plan-limits.js`（`batchSizePerRunOf` / `canBatchSize`） |
| 服务端顺序 | `packages/api-publish-engine/src/publish-api-server.js` `/api/v1/batch-publish` |
| 服务端判据 | `packages/api-publish-engine/src/auth/plan-capability-guard.js` + `plan-capabilities.js` |
