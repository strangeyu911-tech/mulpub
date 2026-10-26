# member-center-orders-paging 执行记录

> 分支 `member-center-orders-paging` ｜ 方案：`openspec/changes/member-center-orders-paging/proposal.md`
> 前序：#4484（会员中心三 P0 + 反馈闭环），本项为其 PRD 中记录的 Non-goal

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 远程同步 PR #（合并后由门禁推导）

## 一、改了什么

### 服务端

- `publish-api-server.js`：`GET /api/v1/me/orders` 接受 `limit`/`offset`，返回 `{ orders, total, hasMore }`
- **新增** `src/auth/page-params.js`：分页参数解析（纯函数）
  - `limit` 1–100 默认 20、`offset` ≥0 默认 0
  - **非法值钳制而非 400**：分页是展示细节，不该因一个越界参数让用户看不到订单；钳制同时有界（上限 100），不会退化成「一次拉全量」
- `postgres-commerce-store.js`：新增 `countOrders(userId)`
  - **必须 `Number(...)`**：pg 的 `COUNT(*)` 是 bigint，Node 侧拿到字符串（`"137"`），不转会让 `hasMore` 变成字符串比较（`"10" < "9"` 为真）⇒ 静默错页

### 桌面主进程

- `ipc-handlers/wechat-pay.js`：`wechat-pay:list-orders` 接受 `{ limit, offset }`
  - **主进程再钳制一次**（不信任渲染层）
  - `memberRequest` 增 `query` 透传
  - 透出 `total` / `hasMore`
  - **降级**：旧服务端不返回这两个字段时本地推导（`total = offset + rows.length`、`hasMore = rows.length === limit`），保证「能翻页就翻」
  - 投影仍是**白名单八字段**（`provider_order_id` 等供应商列不因分页放松）
- `preload/wechat-pay.js`：`wechatPayListOrders(payload)` 透传

### 渲染层

- `OrdersBilling.vue`：
  - 标题右侧「共 N 笔」`orders-total`
  - 列表底部「加载更多」`orders-load-more`（加载中显示「正在加载…」）
  - `loadMore()` **追加**而非替换，按 `id` 去重（分页期间新增订单会让 offset 漂移）
  - `offset` 用「已加载条数」而非页码——去重后条数可能少于累计值，用条数才不会跳过订单
  - 全部加载完且**确实翻过页**时显示「已显示全部 N 笔」（一屏装得下的短列表不提示，避免噪音）
  - 追加失败显示 `orders-load-more-error`，**不清空已有列表**（否则用户以为订单丢了）
- locale：`ordersTotal` / `ordersLoadMore` / `ordersLoadingMore` / `ordersAllLoaded` / `ordersLoadMoreError`（zh/en 成对）

## 二、测试

| 层 | 文件 | 结果 |
|---|---|---|
| 分页参数（纯函数） | `packages/api-publish-engine/test/page-params.test.js`（新建，7 例） | 7 passed |
| 服务端端点 | `member-commerce-api.test.js`（新增 4 组分页断言） | passed |
| IPC 处理层 | `electron/ipc-handlers/wechat-pay.list-orders.test.js`（新建，4 例） | 4 passed |
| 渲染层 | `OrdersBilling.test.js`（新增 5 例分页用例） | 12 passed |
| member-center 全量 | `src/views/member-center/` + `MemberCenter.test.js` | 149 passed（12 文件） |

**新增用例覆盖的关键行为**：
1. `limit=2&offset=0` → 2 条 + `total=3` + `hasMore=true`
2. `limit=2&offset=2` → 1 条 + `hasMore=false`
3. `limit=999` → 钳制 100，**不 400**
4. 无参数 → 默认 20
5. IPC 上行带 `query`、下行透 `total/hasMore`；非法参数主进程钳制
6. 旧服务端无字段时本地兜底
7. 投影白名单八字段（供应商列不外泄）
8. 「加载更多」按 offset 追加 + 按 id 去重
9. 加载完隐藏按钮并提示「已显示全部」
10. 追加失败保留已有列表 + 可读错误

## 三、踩坑

1. **行数门禁 `TARGET_GREW`（1594 > 1590）**：`publish-api-server.js` 是被 targets 点名的文件（零增长容差）。**没有抬限额**，而是把分页参数解析抽成 `src/auth/page-params.js`（纯函数、可单测）⇒ 1589 行，rc=0。
2. **`COUNT(*)` 是 bigint**：不转 number 会让 `hasMore` 变字符串比较，静默错页。
3. **「已显示全部」的判定条件**：最初写 `orders.length > PAGE_SIZE`，测试当场红——短列表永远不满足。正解是「用户**真的翻过页**」（`pagedOnce`），既准确又不制造噪音。
4. **模块导出形状**：`wechat-pay.js` 导出的是 `{ registerWeChatPayHandlers, pickCheckoutBody }` 而非 default，测试初次 `mod.default || mod` 拿到对象 → `registerHandlers is not a function`。

## 四、门禁读数

| 项 | 读数 |
|---|---|
| `check-locale-sync --cjk` | PASS（无新增硬编码） |
| `check-locale-sync --keys` | PASS（2361 keys） |
| `check-locale-sync --symmetry` | PASS（drift=0） |
| `check-locale-sync --py-cjk` | PASS |
| `check-max-lines` | rc=0（`publish-api-server.js` 1589 ≤ 1590） |

## CHANGELOG 条目

# 订单列表支持分页：不再有「第 51 笔订单凭空消失」

- 服务端订单接口接受 `limit`/`offset` 并返回总数与「是否还有更多」；非法分页参数按下界/上限钳制而不是报错
- 桌面端「订单与账单」显示「共 N 笔」，底部提供「加载更多」；追加时按订单号去重，失败不清空已加载列表
- 旧版服务端未返回总数时客户端本地推导，保证仍可继续翻页
