# 订单列表分页（member-center-orders-paging）

> 状态：实施中 ｜ 提出：2026-10-26 ｜ 依据：`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md` §11 遗留项 + 2026-10-26 复核

## 0. 一句话

把「订单超过 50 条就被静默截断」改成**明示总数 + 可继续加载**：服务端接受 `limit`/`offset` 并返回 `total`/`hasMore`，桌面端「订单与账单」底部给「加载更多」（用户裁决：选 A 方案，不做页码跳转）。

---

## 1. 背景：现状为什么不合理

`packages/api-publish-engine/src/publish-api-server.js`：

```js
if (method === "GET" && url === "/api/v1/me/orders") {
  this._json(res, 200, { orders: await commerceRepository.listOrders(userId, { limit: 50, offset: 0 }) });
  return;
}
```

三个问题叠加：

| # | 问题 | 后果 |
|---|---|---|
| 1 | `limit: 50` **硬编码** | 客户端无法指定页大小 |
| 2 | **不返回 `total` / `hasMore`** | 客户端不知道还有没有更多 |
| 3 | 前端没有分页 UI | 用户以为「我一共只有 50 笔」，且**没有任何提示**被截断 |

**注意：上限本身是对的，不该去掉。** 订单表只增不减，一次拉全量会造成全表扫 + 大响应体 + 一次性渲染几百个节点，并给「反复拉全量」留出 DoS 面。要修的是**静默**，不是**上限**。

---

## 2. 范围

### 2.1 做

- 服务端 `GET /api/v1/me/orders` 支持 `limit` / `offset`，返回 `total` / `hasMore`
- 仓储层新增 `countOrders(userId)`
- 桌面 IPC `wechat-pay:list-orders` 接受并透传分页参数、透出 `total`/`hasMore`
- 渲染层「加载更多」按钮 + 「共 N 笔」+ 「已显示全部 N 笔」
- 错误态与空态保持既有语义（失败 ≠ 空态）

### 2.2 不做（Non-goal）

- ❌ 页码跳转（用户裁决选「加载更多」）
- ❌ 订单搜索/筛选（另开任务）
- ❌ 单设备下线（另开任务）
- ❌ 服务端游标分页（keyset）——本期 offset 足够；订单量级（百级）下 OFFSET 无性能问题，等量级上来再换

---

## 3. 详细设计

### 3.1 服务端契约

**请求**：`GET /api/v1/me/orders?limit=<int>&offset=<int>`

| 参数 | 规则 | 非法时 |
|---|---|---|
| `limit` | 整数，1–100，默认 **20** | 非整数/越界 ⇒ **钳制**到边界（`<1→1`、`>100→100`、非数字→默认 20） |
| `offset` | 整数，≥0，默认 0 | 非整数/负数 ⇒ 0 |

**为什么钳制而不是 400**：分页参数是**展示细节**，不该因为一个越界值就让用户看不到订单。钳制是有界且安全的（上限 100），400 则会把「翻页」变成「报错」。

**响应**：

```json
{
  "orders": [ ... ],
  "total": 137,
  "hasMore": true
}
```

- `total`：该用户全部订单数（不受分页影响）
- `hasMore = offset + orders.length < total`

### 3.2 仓储层

```js
async countOrders(userId) {
  const result = await this.pool.query('SELECT COUNT(*) AS count FROM identity_orders WHERE user_id = $1', [userId])
  return Number(result.rows[0] && result.rows[0].count) || 0
}
```

**为什么 `Number(...)`**：`pg` 对 `COUNT(*)` 返回 `bigint`，Node 侧拿到的是**字符串**（如 `"137"`）。不转换会让 `hasMore` 变成字符串比较，`"10" < "9"` 为真——静默错页。

### 3.3 桌面 IPC（`wechat-pay:list-orders`）

payload：`{ limit?: number, offset?: number }`

- 主进程**再钳制一次**（不信任渲染层）：`limit` 1–100 默认 20，`offset` ≥0 默认 0
- 通过 `memberApiService.request({ query: { limit, offset } })` 上行
- 透出 `total` / `hasMore`
- **降级**：若服务端未返回 `total`（旧版本服务端），本地兜底 `total = offset + orders.length`、`hasMore = orders.length === limit`——保证「能翻页就翻」，而不是整块失效

**投影仍是白名单 8 字段**（沿用现状，不因分页放松）：`id/plan/amount/currency/status/period/createdAt/paidAt`。

### 3.4 渲染层（`OrdersBilling.vue`）

状态：

| 变量 | 含义 |
|---|---|
| `orders` | 已加载的全部订单（累加） |
| `total` | 服务端总数 |
| `hasMore` | 是否还有下一页 |
| `loading` | 首屏加载中（整块骨架文案） |
| `loadingMore` | 追加加载中（按钮转圈） |
| `loadError` | 首屏/追加失败文案 |

行为：

- 挂载 & 登录后 → `load()`（offset=0，**替换**列表）
- 点「加载更多」→ `loadMore()`：`offset = orders.length`，**追加**并按 `id` 去重（防服务端数据变动导致重复行）
- `hasMore === false` 且确实翻过页（`orders.length > PAGE_SIZE`）→ 显示「已显示全部 N 笔」
- 「继续支付」成功后仍重拉**第一页**（`load()`），因为支付会改状态，重拉首页足以覆盖用户当前视野；不重置会让用户在旧分页里看到已付订单仍 pending

### 3.5 显示项与提示文案

| 位置 | 内容 | locale key |
|---|---|---|
| 卡片标题右侧 | 共 {count} 笔 | `ordersTotal` |
| 列表底部按钮 | 加载更多 | `ordersLoadMore` |
| 按钮加载中 | 正在加载… | `ordersLoadingMore` |
| 全部加载完 | 已显示全部 {count} 笔 | `ordersAllLoaded` |
| 追加失败 | 加载更多失败，请重试。 | `ordersLoadMoreError` |

zh / en 成对；渲染端不得有硬编码中文（Gate 7 renderer CJK）。

---

## 4. 验收标准（DoD）

| # | 判据 | 取证 |
|---|---|---|
| 1 | `limit=2&offset=0` → 2 条 + `total` 正确 + `hasMore=true` | 服务端测试 |
| 2 | `limit=2&offset=2` → 余下 1 条 + `hasMore=false` | 服务端测试 |
| 3 | `limit=999` → 钳制到 100，不 400 | 服务端测试 |
| 4 | 无参数 → 默认 20 | 服务端测试 |
| 5 | `countOrders` 返回 number 而非字符串 | 仓储测试 |
| 6 | IPC 透传分页并透出 `total`/`hasMore` | `wechat-pay` 处理层测试 |
| 7 | 「加载更多」追加而非替换，且按 id 去重 | `OrdersBilling.test.js` |
| 8 | 加载完显示「已显示全部 N 笔」 | `OrdersBilling.test.js` |
| 9 | 追加失败显示可读错误且不清空已有列表 | `OrdersBilling.test.js` |
| 10 | zh/en 成对 + renderer 无硬编码中文 | Gate 7 `--cjk` / `--keys` / `--symmetry` |

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 分页期间新增订单导致 offset 漂移（重复/漏行） | 按 `id` 去重；订单列表是「追加浏览」场景，漂移可接受（真要做严格一致性得上 keyset 分页，见 Non-goal） |
| 旧服务端不返回 `total` | 主进程本地兜底推导 `total`/`hasMore` |
| 用户在「加载更多」时支付成功 | 支付回调走 `load()` 重拉首页，重置分页状态 |
| `COUNT(*)` 在大表变慢 | 订单按 `user_id` 过滤，且有索引（`identity_orders.user_id`）；量级上来再考虑缓存或 keyset |
