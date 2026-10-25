# PRD：官方算力事件级用量通道（R5-1）

> 状态：**已实现**（PR 待提）　日期：2026-10-25　分支：`official-compute-usage-events`
> 归属：官方算力第 5 轮接线的**第一刀**（供给侧的成本归集地基）
> 上游依据：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`、
> `01-docs/usage-metering-spec.md` §4、`openspec/records/official-compute-wiring-final.md`
> 方案稿：`/workspace/output/ROUND5-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（第 5 轮总方案，本刀是其中 D1/D2/D3）

---

## 〇、一句话

把「一次 provider 调用」变成一条**服务端可算成本的事件**，让「这一次花了多少钱」有权威事实可查——
否则扣积分只能是估算，估算错了没人知道。

---

## 一、为什么现在做（缺口是真的，逐条回源码核对过）

| # | 缺口 | 证据（落点） | 后果 |
|---|---|---|---|
| G-1 | `ModelUsageEvent` 没有秒/张/字符三个维度 | `ops-center/backend/models_credit.py` `ModelUsageEvent` | 视频/图像/TTS **无法按实际用量计价** |
| G-2 | `token_counts_from_event` 只映射 5 类 token | `services/credit_price_service.py` 的 `TOKEN_FIELD_TO_UNIT` | `per_second`/`per_image`/`per_char` 拿不到数量 ⇒ `cards.get(unit)` 恒 None ⇒ **成本恒 0 且全量报「缺价格」** |
| G-3 | 上报链路只写日桶 | `routers/usage.py` `/usage/ingest` → `services/usage_service.py` 只 upsert `ModelUsageDaily` | `ModelUsageEvent` **零写入方** ⇒ 扣分端点拿不到权威事实 |
| G-4 | 桌面端日志表没有维度列 | `apps/desktop/electron/services/store-schema.js` `model_provider_logs` | 桌面端**采不到**秒/张/字符 |
| G-5 | 桌面端没有任何上报这三者的通道 | `electron/services/usage-reporter.js` 只有日桶流 | 同上 |

⚠ **这四条缺口的失败形态是同一个**：**成本算成 0，但不报任何错**（错误长得像「免费」）。
⇒ 所以本刀的重点不是「加几个字段」，而是**把每一环都钉死并各自可验**。

---

## 二、定案

### 2.1 两条流并存，各管一件事

| 流 | 端点 | 落表 | 粒度 | 成本来源 | 用途 |
|---|---|---|---|---|---|
| 日桶（已有） | `POST /api/v1/usage/ingest` | `model_usage_daily` | (日期, provider, category, action) 一个桶 | **客户端透传的估算值** | 运营看板 |
| **事件（本次新增）** | `POST /api/v1/usage/events` | `model_usage_events` | **一次调用一条** | **服务端按价格卡算** | 成本归集 / 扣积分 |

⚠ **两条流读同一张本地表、共用会互相饿死** ⇒ 事件流用**独立水印键**
（`opsCenterUsageEventReport`），日桶仍是 `opsCenterUsageReport`。

### 2.2 口径表（**唯一真源**：`services/credit_price_service.py`）

| 上报字段 | unit | 单价语义 | 适用 |
|---|---|---|---|
| `tokens_in` / `tokens_out` / `tokens_cache_read` / `tokens_cache_write` / `tokens_reasoning` | `1k_tokens_*` | 微元 / 1K token | LLM |
| `duration_seconds` | `per_second` | 微元 / 秒 | 视频 |
| `duration_seconds`（category=audio/music/voice） | `per_second_audio` | 微元 / 秒 | 音频生成 |
| `item_count` | `per_image` | 微元 / 张 | 图像 |
| `char_count` | `per_char` | 微元 / 字符 | 语音 |

⚠ **音频的秒数必须与视频分卡**（`per_second_audio` ≠ `per_second`）⇒ 混用会按视频价给音频计费（少扣）。

### 2.3 幂等与拒收

| 规则 | 理由 |
|---|---|
| `event_id` 空 ⇒ **400 硬拒** | 它是幂等键，空值 ⇒ 重报重复计数 |
| `event_id` = `${clientId}:${本地行 id}` | 本地自增主键 ⇒ 稳定且唯一 ⇒ 重试重报不重复 |
| 服务端唯一约束 `uq_model_usage_event_id` | 第二道防线（客户端也会算） |
| 负数维度 ⇒ 400 硬拒 | 否则算出负成本 |

### 2.4 成本由服务端算（客户端不报成本）

- 客户端只报**用量维度**，**不报成本** ⇒ 成本一律由 `load_effective_cards` + `compute_cost_micros` + `compute_credit_cost` 算出。
- 客户端透传的成本值只作为 `client_reported_cost_micros` **留档对拍**，**不参与计算**。

### 2.5 缺价必须被点名（不静默当免费）

命中不到价格卡 ⇒ `cost_micros = 0`，但：
- 响应里有 `missing_price: [unit…]`；
- 服务端日志里点名（provider / model / 缺哪个 unit）。

⇒ 运营能看见「成本算成 0」这件事，而不是以为「免费」。

### 2.6 BYOK：用户自带 Key 不扣官方积分

- 桌面端当前的 provider 调用**全部**用用户自己配置的 Key ⇒ `byok = 1`（服务端不扣官方积分）。
- 存量行的默认也是 1 ⇒ 不会把历史调用误判成官方算力。
- ⛔ **缺省方向必须是「不扣」**：给用户错扣比不扣更糟。
- 官方 Key 池路由落地后（R5-3），官方算力那条路径会传 0。

---

## 三、流程

```
桌面端 provider 调用
   └─ model-provider-manager._writeLog
        └─ store.addProviderLog({ ...扁平行, params, result })
             ├─ store/model-log-store.js  ← **维度判定的归属**（这张表有哪些列）
             │    └─ usage-dimensions.extractUsageDimensions  ← 纯函数（权威来源优先）
             └─ 落 model_provider_logs（+ spec/duration_seconds/item_count/char_count/byok）
                  │
                  ├─ 日桶流 reportPending()   → POST /api/v1/usage/ingest   → model_usage_daily（看板）
                  └─ 事件流 reportEvents()    → POST /api/v1/usage/events    → model_usage_events（成本）
                                                          │
                                                          └─ 服务端按价格卡算 price_id / cost_micros / credit_cost
```

⚠ **为什么维度判定归存储层、而不是 manager**：
manager 同时受**两条门禁**约束 ——「点名还账」行数（target 1284、**容差 0**）与
「require 扇出」（**只降不升**的债务棘轮）⇒ 在 manager 里抽模块必然 +1 require ⇒ 扇出红；
不抽模块则行数红。⇒ **把逻辑挂到存储层，两条都不碰**（存储层不在这两个指标里）。
（这是本刀 CI 首轮实测出来的：**首版把逻辑抽到 `model-log-entry.js` ⇒ 扇出 66→67 ⇒ 债务熔断红**。）

---

## 四、功能逻辑

### 4.1 桌面端

| # | 规则 |
|---|---|
| F-0 | **维度判定的归属 = 存储层**（`store/model-log-store.js`）；manager 只交出原料 `params`/`result` |
| F-1 | `extractUsageDimensions` 的**权威来源优先**：官方 `usage.total_seconds` > 响应显式字段 > 请求侧参数 |
| F-2 | 抽不到就是 0（**不猜、不填默认值**）——填一个猜出来的值比 0 更坏（成本会算错且看不出来） |
| F-3 | 小数向上取整成整秒（计费单位是秒） |
| F-4 | 脏输入（0/负数/NaN/布尔/空串）一律不计入 |
| F-5 | `spec` 按 `params.spec` → `params.resolution` → `params.size` → `params.quality` 取 |
| F-6 | `char_count` 的 TTS 场景取请求侧 `params.text.length`（计费单位就是输入字符数） |
| F-7 | 事件流与日桶流**各自独立**推进水印；任一条失败**不推进**自己那条 ⇒ 重试不丢数据 |
| F-8 | 事件流单次最多 500 条（与服务端 `MAX_EVENT_ITEMS` 对齐） |

### 4.2 服务端

| # | 规则 |
|---|---|
| F-9 | `byok = 1` ⇒ 记 0 成本、**不查官方卡**（不报缺价）⇒ 用户自带 Key 的调用不会被误判成「缺价」 |
| F-10 | `byok = 0` ⇒ 按价格卡算；缺价 ⇒ 成本 0 + `missing_price` 点名 |
| F-11 | `usage_date` 缺省取当天（客户端可指定，按 `created_at` 的真实日期归日） |
| F-12 | 字符串列统一截断（防超长入库存爆） |

---

## 五、交互逻辑 / 显示项 / 提示文字

⚠ **本刀没有用户可见界面**（这是数据通道，不是功能页）⇒ 如实写「无」，不硬凑。

**运营侧可见的读数**（这是本刀的「显示项」）：

| 位置 | 内容 |
|---|---|
| `POST /api/v1/usage/events` 响应 | `{"ingested": N, "duplicate": M, "missing_price": [...]}` |
| ops-center 日志（WARNING 级） | 缺价事件的 `event_id / provider_id / model / missing_units` |
| 桌面端日志（info） | `reported N usage events (watermark M)` |
| 桌面端日志（warn） | `event report failed: timeout` / HTTP 码 |

⛔ **本刀不新增任何面向用户的文案** ⇒ zh/en i18n **不需要新增键**（不许为了「有文案」而加）。

---

## 六、数据校验（10 条）

| # | 校验 | 触发 | 结果 |
|---|---|---|---|
| V-1 | `event_id` 非空 | 服务端 | 400 |
| V-2 | `event_id` ≤ 128 字符 | 服务端 | 400 |
| V-3 | `provider_id` 非空 | 服务端 | 400 |
| V-4 | `usage_date` 合法 `YYYY-MM-DD` | 服务端 | 400（缺省则取当天） |
| V-5 | 维度字段为非负整数（拒布尔/非整数/负数） | 服务端 | 400 |
| V-6 | `items` 是数组 | 服务端 | 400 |
| V-7 | `items` ≤ 500 | 服务端 | 400 |
| V-8 | `duration_seconds` 取整（向上） | 桌面端 | 静默取整 |
| V-9 | `char_count` 的 TTS 来源是请求侧文本长度 | 桌面端 | 静默取长度 |
| V-10 | 桌面端日志表五列的存量补列 | 桌面端启动 | 幂等 ALTER |

---

## 七、验收（14 条，全部可机械判定）

| # | 验收 | 判据 |
|---|---|---|
| A-1 | 三个非 token 维度能抽出 unit | `token_counts_from_event({duration_seconds:10}) == {per_second:10}` 等 |
| A-2 | 音频秒数走 `per_second_audio` | 与视频的 `per_second` **不相等** |
| A-3 | token 维度与非 token 维度共存不互相挤掉 | 同时在 counts 里 |
| A-4 | 零维度不进 counts | `== {}` |
| A-5 | 事件入库后成本由服务端算 | `cost_micros == 10 × 500000` |
| A-6 | 客户端报的成本不参与计算 | 传 `client_reported_cost_micros=1` 也不影响 `cost_micros` |
| A-7 | 积分换算正确 | `credit_cost == cost_micros / 10000` |
| A-8 | 同一 `event_id` 重报幂等 | 第二次 `ingested == 0`、`duplicate == 1`、总行数仍 1 |
| A-9 | `event_id` 空 ⇒ 拒 | 抛 ValueError |
| A-10 | 负数维度 ⇒ 拒 | 抛 ValueError |
| A-11 | 缺价被点名 | `missing_price` 含该 unit；行里 `cost_micros == 0` |
| A-12 | BYOK 不计官方成本 | `cost_micros == 0` 且 `missing_price` 为空 |
| A-13 | **桌面端原料真的交到了存储层**（接线锁） | `_writeLog` ⇒ `addProviderLog` 收到 `params`/`result` |
| A-14 | **存储层把维度写进了表、且 byok 缺省是 1**（存储层锁） | 落库行 `duration_seconds=10` / `spec='768p'` / `byok=1`；显式 `byok=0` 才算官方算力 |

⚠ A-13 / A-14 是**接线锁**（分两层，因为判定归属在存储层）：
- A-13 锁「manager 把原料交出去了」；
- A-14 锁「存储层把维度写对了、且 byok 缺省是 1」。
⇒ 两条合起来才覆盖「新增叶子模块单测全绿、但生产链路没接上」这个缺陷族。

---

## 八、遗留边界（8 条）

| # | 遗留 | 归属 |
|---|---|---|
| L-1 | **扣分端点 `POST /api/v1/credit/consume` 还不存在** | R5-2 |
| L-2 | **官方 Key 池路由还不存在** ⇒ 桌面端全是 BYOK ⇒ 事件成本恒 0 | R5-3 |
| L-3 | MiniMax H3 V2 适配器还不存在 ⇒ H3 的 `usage.total_seconds` 还没有来源 | R5-3 |
| L-4 | **价格卡还是空的** ⇒ 官方算力事件必然「缺价」（此时是**正确**的缺价，不是缺陷） | R5-4 |
| L-5 | 日桶路径的客户端透传成本**仍未被服务端校验/纠正** | R5-4 |
| L-6 | 事件流与日桶流都失败时**没有退避/告警升级**（只 warn 一行） | 后续 |
| L-7 | 本刀**没有**给事件流做「补扣调度」（预检/实扣/补扣是 R5-2） | R5-2 |
| L-8 | 事件表**没有**保留期/归档策略 | 后续 |

---

## 九、本刀的诚实边界

- **CCG 双模型外部评审不可用** ⇒ 本刀未做外部评审；证据是「仓内断言 + 变异验证 + 逐条源码对账」。
- **变异验证 4 组全部被抓住**（去掉非 token 映射 / 去掉音频分流 / 去掉唯一约束 / 去掉缺价点名）。
- 桌面端测试在本仓 `vitest` 配置下执行；本机用等价的最小配置跑（结论以 CI 为准）。
