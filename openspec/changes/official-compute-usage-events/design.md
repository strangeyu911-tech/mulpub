# Design — official-compute-usage-events

> 本文只记**决策与理由**；规格（做什么）在 `proposal.md` + `01-docs/PRD-OFFICIAL-COMPUTE-USAGE-EVENTS-2026-10-25.md`。

## 1. 为什么事件流要与日桶流**并存**（而不是替换）

| | 日桶 | 事件 |
|---|---|---|
| 回答的问题 | 「今天这个客户端调了多少次」 | 「**这一次**调用花了多少」 |
| 粒度 | (日期, provider, category, action) | 一次调用一条 |
| 成本 | 客户端透传的**估算值** | 服务端按价格卡算 |
| 用途 | 运营看板 | 成本归集 / 扣积分 |
| 体量 | 小 | 大（每次调用一条） |

替换掉日桶 ⇒ 看板要么变慢要么变形；只留事件 ⇒ 看板查询要自己聚合。
⇒ **两条流并存，各自的水印独立**。

## 2. 为什么水印必须**独立**（决策 2）

两条流读**同一张** `model_provider_logs`。
若共用一个水印键：日桶流推进了水印 ⇒ 事件流下次 `WHERE id > watermark` 就**看不到那些行** ⇒ 事件永久丢失（且两边都不报错）。
⇒ 事件流用独立键 `opsCenterUsageEventReport`。

⚠ 这是一个「**两条流互相饿死**」的形态，症状是「少了一半数据、没有任何报错」。

## 3. 维度提取：**权威来源优先**，抽不到就是 0

各适配器返回体形状不同（OpenAI 兼容 / 图像 `images[]` / TTS 只有音频 / 视频只有 `taskId`），
所以维度提取是**多来源**的。优先级：

```
duration_seconds : result.usage.total_seconds（官方口径，权威）
                > result.duration_seconds / duration / seconds
                > params.duration（请求侧兜底）
item_count      : result.imageCount / count / n  > result.images.length  > params.n
char_count      : result.usage.characters / result.characters  > params.text.length（TTS 计费单位就是输入字符数）
spec            : params.spec > params.resolution > params.size > params.quality
```

⚠ **抽不到就是 0，不猜、不填默认值**。
理由：填一个猜出来的值比 0 更坏 —— 0 会让服务端报「缺价格」（**可见**），
而猜出来的值会让成本**算错且看不出来**（不可见）。

⚠ 形状假设集中在**一个纯函数**里（`usage-dimensions.js`）⇒ 可被单测逐条钉死；
不放在 `model-provider-manager` 里（那个文件一行都不能涨）。

## 4. 成本由服务端算，客户端**不报**成本

客户端报的 `cost` 只作为 `client_reported_cost_micros` **留档对拍**，不参与计算。
理由：客户端成本是本地估算（官方代理场景才透传），用它算账 = 用估算当账。

## 5. 缺价必须**被点名**（不静默当免费）

`compute_cost_micros` 对 0 价卡/无卡的处理是「计入 `missing_units` 并跳过」⇒ 成本 0。
⇒ 本刀把 `missing_units` 提到**响应体**（`missing_price`）与服务端**日志**里。

⚠ 为什么这条要紧：`compute_cost_micros` 的注释明写「0 价卡一旦入库，回算会静默命中它 ⇒ 成本算成 0 ⇒ 既不告警、又被当成「免费」」。
⇒ **「成本是 0」必须可区分于「成本是 0 因为免费」**。

## 6. BYOK：缺省方向是「不扣」

桌面端当前的 provider 调用**全部**用用户自己配置的 Key ⇒ `byok = 1` ⇒ 服务端**不扣官方积分**。
⚠ 缺省若是 0 ⇒ 用户自己的 Key 消耗会被当成官方算力 ⇒ **给用户错扣积分**（错扣比不扣更糟）。
⇒ 桌面端 `byok` 缺省 1、存量列默认 1、`ModelUsageEvent.byok` 默认 0（仅在显式声明官方算力时才为 0）。

## 7. SQLite 的 `create_all` **不改已有表**

⇒ 加列必须配**幂等 ALTER**（两处：桌面端 `store/model-provider-logs-schema.js`、
ops-center `services/credit_usage_event_migration.py`），且 ALTER 与 `create_all` **同批部署**
（否则部署后首次写入就报 `no such column`）。

⚠ 与既有纪律同源：「DDL 有多份副本时 `IF NOT EXISTS` 不会加列」。

## 8. 两处**抽模块**（不是抬基线）+ 一个**两门禁冲突**的解法

| 文件 | 门禁读数 | 处置 |
|---|---|---|
| `electron/services/store-schema.js` | 主干 **499** / 上限 500 ⇒ **零余量** | 表 DDL + 补列迁移抽到 `store/model-provider-logs-schema.js` ⇒ **489** |
| `electron/services/model-provider-manager.js` | `targets` = 1284、**容差 0** ＋ require 扇出 **只降不升**（= 66） | **两条同时约束 ⇒ 不能在这里抽模块**（抽了 +1 require ⇒ 扇出红；不抽 ⇒ 行数红） |

⇒ **解法（CI 首轮实测出来的）**：把**维度判定挂到存储层**
（`store/model-log-store.js` ⇒ `usage-dimensions.js` 纯函数）——
存储层不在这两个指标里 ⇒ **两条门禁都不碰**；
manager 只交出原料 `params`/`result`，并压缩 `_writeLog` 的注释回到 **1284 行**（= target ⇒ 不算超）。

⇒ 副产品：**「这张表有哪些列」归存储层**，比放在 manager 里更合职责。

⇒ 纪律：改基线 = 改「谁来守门」⇒ 须人工过目；**降债优于抬基线**。
⚠ 而这次连「降债」都做不到（两条门禁互锁）⇒ **解法是换归属，不是换基线**。

## 9. 事件上报端点的鉴权

`POST /api/v1/usage/events` 走 `require_catalog_key`（与日桶同款，静态 `X-Catalog-Key`）。
⚠ **不复用** `official_credit` scope（那是会员能力 scope，与服务间凭据不是一回事）。

## 10. 错误码

本刀**不新增业务错误码**：
- 参数非法 ⇒ 400（与日桶同款 `ValueError` → `HTTPException(400)`）
- 鉴权失败 ⇒ 401/403（沿用 `require_catalog_key`）
- 缺价 ⇒ **不是错误码**，是**成功响应里的 `missing_price` 字段** + 日志
  （理由：缺价是**数据配置问题**，不是本次请求出错 ⇒ 用 4xx 会让客户端无谓重试）。
