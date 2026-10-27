# PRD — 会员知识库功能门禁（P1-2，v1.0）

> **状态**：🟢 已实现（2026-10-27）
> **上游机制**：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.6 §4.3/§6.2/§10
> **数值真源**：`packages/api-publish-engine/src/auth/plan-matrix.js`
> **执行记录**：`openspec/records/member-tier-p1-2-knowledge-base.md`

---

## 1. 背景

v3.1 机制把知识库定为功能开关：免费不可用，标准/专业可用，不设容量档。`plan-matrix` 此前没有 `knowledge_base` feature，客户端也没有消费点，免费用户可进入 `/knowledge-base` 使用爆款库、模式分析、个人知识库。

P1-2 目标：**免费入口关闭；标准/专业可用。**

## 2. 功能契约

| 档位 | `knowledgeBase` | `features.knowledge_base` | 知识库 |
|---|---|---|---|
| 免费 | `false` | 无 | 不可用，显示升级锁定页 |
| 标准 | `true` | 有 | 可用 |
| 专业 | `true` | 有 | 可用 |

`knowledgeBase` 是矩阵里的契约开关（非数值、不可被运营 overrides 覆盖）；`knowledge_base` 由它派生，客户端只读 `entitlement.features`。

## 3. 客户端门禁

### 3.1 `/knowledge-base` 整页门禁

- 路由组件从 `KnowledgeBasePage.vue` 改为 `KnowledgeBaseGateView.vue`（薄包装）。
- `KnowledgeBaseGateView` 把 `feature-key="knowledge_base"` 与 `memberCenter.knowledgeBaseTitle` 交给 `MemberFeatureGate`。
- 锁定态不挂载 `KnowledgeBasePage`，避免免费用户先触发知识库列表/同步 IPC 再被挡。

### 3.2 复用 P1-1 的门禁组件

- `MemberFeatureGate`：checking / locked / allowed 三态；CTA → `/member-center?section=subscription`。
- `hasFeature`：`null`（entitlement/features 缺失或空数组）= 放行；`false` = 明确不含；`true` = 有。
- 客户端纪律保持「缺失即放行」，不误伤旧快照付费用户。

## 4. 提示文字

| key | 中文 | 英文 |
|---|---|---|
| `memberCenter.knowledgeBaseTitle` | 知识库 | Knowledge base |
| `memberCenter.featureLockedBody` | 「{feature}」是标准版及以上功能，升级后即可使用。 | "{feature}" is available on Standard and Pro plans. Upgrade to unlock it. |
| `memberCenter.featureLockedHint` | 升级标准版或专业版后自动解锁，无需重新登录。 | It unlocks automatically after upgrading. No need to sign in again. |
| `memberCenter.featureLockedCta` | 查看套餐 | View plans |

（`featureLocked*` 复用 P1-1 的通用文案，不新增重复 key。）

## 5. 数据校验与边界

| 场景 | 判据 | 结果 |
|---|---|---|
| entitlement 缺失 | `hasFeature → null` | 放行（旧快照/身份服务未启用） |
| features 缺失/空数组 | `null` | 放行（同上） |
| features 非空且不含 `knowledge_base` | `false` | 锁定 |
| features 含 `knowledge_base` | `true` | 放行 |
| 免费直接输入 `/knowledge-base` URL | 路由加载 Gate | 锁定页（不能绕过） |
| 升级后不刷新页面 | `getEntitlement`/computed 实时读取 | 自动解锁 |
| 降级后停留在页面 | computed 变 false | 立即切锁定页 |

## 6. 流程

```
进入 /knowledge-base
  └─ KnowledgeBaseGateView
       └─ MemberFeatureGate(featureKey=knowledge_base)
            ├─ entitlement 已有？── 是 → allowed? ─┬─ true/null → 渲染 KnowledgeBasePage
            │                                      └─ false → 锁定页
            └─ 否 → identityStore.load()
                 ├─ 成功 → 重新判 allowed
                 └─ 失败/无信息 → null → 渲染 KnowledgeBasePage（fail-open）
```

## 7. 验收标准

- [ ] 免费档直接访问 `/knowledge-base`：显示锁定页，不渲染 `KnowledgeBasePage`。
- [ ] 免费档点侧边栏「知识库」：落到同一锁定页。
- [ ] 标准/专业：正常渲染 `KnowledgeBasePage`（爆款库/模式分析/个人知识库）。
- [ ] entitlement 缺失或 features 空：放行，不误拦旧快照。
- [ ] 升级后无需刷新：锁定页自动解锁。
- [ ] CTA 跳 `/member-center?section=subscription`。
- [ ] 既有 KnowledgeBasePage / 侧边栏 / 路由登记测试不回归。

## 8. 非目标（本切片）

- 不新增 `knowledge-library:*` IPC 的 `knowledge_base` 硬门禁；与 P1-1 一样先做客户端入口层，IPC 硬门禁作为 P1-2b 按需评估。
- 不设知识库容量/条数档位（v3.1 已明确不做）。
- 不改知识库数据结构/检索逻辑。

## 9. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| 矩阵 | `plan-matrix.test.js` | free 无 `/standard 有 knowledge_base`；feature/quota 形状 |
| 组件 | `MemberFeatureGate.test.js` | 通用三态（P1-1 已覆盖） |
| 路由包装 | `KnowledgeBaseGateView.test.js` | featureKey + title + slot 接线 |
| 页面回归 | `KnowledgeBaseHotsyncUi.test.js` | 三标签/添加内容等既有行为 |
| 静态 | `check-route-registry` | `/knowledge-base` view 与 router import 一致 |
| E2E/视觉 | e2e `ipc-mock` 的 pro 夹具 | 补 `knowledge_base`，避免锁定页误判 |
