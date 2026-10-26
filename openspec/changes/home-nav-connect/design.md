# Design: home-nav-connect

## 1. 路由与参数

### 1.1 账号添加深链

```
/accounts?action=add-account
```

- 只在 `action === 'add-account'`（精确匹配）时触发。
- 触发后立即 `router.replace`，从 query 中删除 `action`，保留 `tab` 等其它合法参数。
- 目的：刷新/后退不重复弹层；用户关闭浮层后地址栏是干净的账号页 URL。

实现：`features/accounts/useAccountAddDeepLink.js`

```
useAccountAddDeepLink({ route, router, showAddDialog })
```

- `watch(() => route.query.action, ..., { immediate: true })`
- `router.replace(...).catch(reportError)`，失败不影响浮层已打开状态。

### 1.2 发布记录状态深链

```
/publish/history?status=all|success|failed|pending
```

- `all` 与缺省等价；选「全部」时从 URL 删除 `status`。
- 非法值归一化为 `''`，不抛错。
- 状态标签点击使用 `router.replace`，不增加浏览器历史。

实现：`composables/usePublishHistoryStatusFilter.js`

```
normalizePublishStatusFilter(value): '' | 'success' | 'failed' | 'pending'
usePublishHistoryStatusFilter({ route, router }): { statusFilter, statusTabs }
```

双向同步：

1. `route.query.status` → `statusFilter`（`watch`）
2. `statusFilter` → `router.replace`（`watch`），仅当与当前 query 归一化结果不同才写，避免回环。

## 2. 状态标签复用既有状态真源

`PublishHistory.vue` 已有 `normalizedStatusGroup(record)`（来自 `usePublishRecordActions`）：
- `success` / `completed` / `published` → `success`
- `failed` / `error` → `failed`
- 其它 → `pending`

标签只是把 `statusFilter` 设为 `'' | 'success' | 'failed' | 'pending'`，不新增第二套映射。

UI 使用原生 `<button aria-pressed>` + `role="group"`，不是 `tablist`：该控件不切换面板，只改变筛选条件。复用既有 `.history-tabs` / `.history-tab` 视觉，补 `.history-status-tabs` 容器间距。

## 3. 首页入口

### 3.1 统计卡

四张卡从 `div` 改为原生 `button`：

| 卡 | 目标 |
| --- | --- |
| 总发布 | `/publish/history?status=all` |
| 成功 | `/publish/history?status=success` |
| 失败 | `/publish/history?status=failed` |
| 已绑定账号 | `/accounts` |

原生按钮天然支持 Enter/Space，无需手写键盘处理。样式复用 `.mp-home-stat-card`，新增 `home-navigation.css` 补齐按钮 reset、focus-visible 与 hover 可点反馈。

### 3.2 快捷入口

第 6 项从「私信评论」`/comments` 改为「视频创作」`/create`，图标 `ChatDotRound` → `VideoCamera`。位置与其它五项不变。

### 3.3 近期动态链接

复用 `composables/usePublishHistoryContentLink`（发布记录页同一实现）：

- 输入：`{ t, recordTitle, resultValue, actionMessage }`
- 输出：`isCardClickable` / `cardLinkUrl` / `cardClickHint` / `openCardLink`
- 可点条目渲染为 `<a>`，点击 `preventDefault` → `tabStore.createTab`
- 无链接条目渲染为 `div`，`title` 给出四态原因

`resultValue` 与 `PublishHistory.vue` 保持同一实现（只接受 `record.result[key]` 的 string/number）。

## 4. 发布页入口组件

`features/publish/components/PublishHistoryEntry.vue`：

- 原生 `button` + `UiButton` 视觉类（`cohere-btn cohere-btn-secondary`）
- 图标 `Tickets`，文案 `publishPage.publishHistory`
- `data-testid="publish-open-history"`
- 点击 `router.push('/publish/history')`

抽成组件的原因：`Publish.vue` 被行数门禁点名零增长（target 1775，当前 1773），只有 2 行余量；组件化后 Publish.vue 只增加 import 与标签各 1 行。

## 5. 错误处理

| 失败点 | 处理 |
| --- | --- |
| `router.replace` 拒绝 | `reportError` 记录；页面内筛选/浮层状态已生效，不回滚 |
| `historyList` 失败 | 首页沿用既有空态；发布记录页沿用既有错误态 |
| 作品链接解析失败 | 返回 `source: 'none'`，条目不渲染为链接 |
| `tabStore.createTab` 返回空 | 回退 `window.open`；再失败写 `actionMessage` |
| 非法 `status` / `action` | 归一化为默认值，不抛错 |

## 6. 测试策略

- 纯函数/composable：`usePublishHistoryStatusFilter.test.js`、`useAccountAddDeepLink.test.js`
- 组件行为：`Home.test.js`、`Accounts.test.js`、`PublishHistory.test.js`、`PublishHistoryEntry.test.js`
- 接线锁：`Publish.history-entry-wiring.test.js`（SFC 必须 import 并渲染入口组件）
- i18n：既有 `locales/structure-lock.test.js` 自动覆盖 zh/en 键集合；新增键必须成对

## 7. 取舍记录

- **状态筛选不显示数量**：只加载部分记录，显示局部数量会误导为全量统计。
- **发布页入口不做浮层**：历史是页面级去向，浮层会与未保存编辑态争抢焦点。
- **近期动态不新增按钮**：整行 `<a>` 已是可访问控件；再放「打开」按钮会让每行多一个焦点站。
- **不服务端筛选**：本 change 不扩 API；沿用既有 20 页补扫上限与截断提示。
