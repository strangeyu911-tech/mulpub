# PRD：MiniMax H3（v2 端点）适配器（官方算力 R5-3）

> **文档性质**：实现规格（PRD）。**契约真源**——本文件描述的请求形状、选路规则、校验、
> 错误映射与返回形状，与仓内实现
> `apps/desktop/electron/services/adapters/minimax-h3-v2.js`（纯函数）+ `minimax.js`（挂载点）
> **逐条对应**（每次改动都要同步本文件）。
> **上游契约**：`01-docs/DESIGN-OFFICIAL-COMPUTE-WIRING-2026-10-25.md`（R5-3 切片：官方算力接线第 5 轮）。
> **用量维度真源**：`apps/desktop/electron/services/usage-dimensions.js`（PR #4463 已合入）。
> **状态**：✅ 已实现（见 §10 验收标准与执行记录 `openspec/records/credit-phase2-h3-v2.md`）。

---

## 0. TL;DR

| 项 | 结论 |
|---|---|
| 触发条件 | `params.model` 是 **H3 族**（`MiniMax-H3` 前缀，含 `MiniMax-H3-Max`）⇒ 走 v2 端点；否则走既有 v1 |
| 创建端点 | `POST {BASE}/v2/video_generation`，`BASE` = **baseUrl 同域换版本**推导（`.../v1` ⇒ `.../v2`）⇒ **代码不内置任何官方域名** |
| 请求体 | `{ model, content[], resolution, duration, ratio }`（提示词在 `content[]` 数组里，**不是**顶层 `prompt`） |
| 查询端点 | `GET {BASE}/v2/query/video_generation/{task_id}`（**路径参数**，不是 v1 的 `?task_id=`） |
| 产物 | `task.content.url`（**限时链接**；v1 的 `file_id` + `/files/retrieve` 路径不适用于 v2） |
| **用量来源** | `task.usage` **原样透出**（`total_seconds` / `input_seconds` / `output_seconds` / `input_image_count`）⇒ 官方算力成本归集拿得到「这一次真花了多少秒」 |
| 状态映射 | `queued`/`running` ⇒ `processing`；`succeeded` ⇒ `completed`；`failed` ⇒ `failed`；`cancelled` ⇒ `cancelled`；未知 ⇒ `processing` |
| 错误体 | v2 是 **OpenAI 风格** `{ error: { type, message, http_code } }`（v1 是 `base_resp.status_msg`）⇒ 两种都认 |
| 本片不含 | 官方 Key 池路由（`byok=0` 的来源）/ MiniMax 价格卡（U-12）/ 事件落库后的扣分触发（R5-2） |

---

## 1. 背景与范围

### 1.1 为什么要有这一刀

官方算力接线的 R5-3 切片写着「MiniMax H3 V2 适配器 + 官方 Key 池路由」。
本片只做**前半截**：让桌面端能真正调用 MiniMax H3，并把官方返回的
**真实用量**（`usage.total_seconds`）送进成本归集。

没有这一刀，H3 用量在成本侧是**恒 0**：桌面端只能从请求参数猜时长
（`params.duration`），而官方明确「**按 `usage.total_seconds` 计费，不按请求的 duration**」
（内部帧网格 + 输入素材会让两者不等）⇒ 用请求参数当成本 = 算错账。

### 1.2 与 PR #4463 的关系

#4463（已合并，`06154452`）落地了桌面端 `usage-dimensions.js`：
它从「请求参数 + 适配器响应」里抽 `spec` / `duration_seconds` / `item_count` / `char_count`，
读取口径是 `usage.total_seconds` → `result.duration` → `params.duration`（**权威来源优先**）。

⇒ **本片就是那个「权威来源」的生产者**：适配器把官方 `task.usage` 原样放进返回体的 `usage` 字段，
`usage-dimensions` 就能读到真实的 `total_seconds` ⇒ 成本不再靠猜。

⇒ 本片**不重复实现** `usage-dimensions` 的抽取逻辑（那是单一真源，别处已有）。

### 1.3 本片做 / 明确不做

| ✅ 本片做 | ⛔ 本片不做（及原因） |
|---|---|
| H3（v2）**请求形状**与**响应解析**（纯函数模块 + 逐条单测） | **官方 Key 池路由**（`byok=0` 的来源）⇒ 依赖 ops-center `POST /api/v1/compute/execute`，而它依赖 R5-4 的价格卡（U-12 未拍板）⇒ 无价卡必然「缺价 ⇒ 拒绝服务」 |
| **v1/v2 选路**（按 model 族）与**基址推导**（同域换版本） | **MiniMax 价格卡**（8 张）⇒ U-12 须人工拍板（运营方定价决策），agent 不得单方面插价目卡 |
| 顺手修掉 `getVideoStatus` 的**既有入参形态缺陷**（见 §5.6） | **事件落库 → 触发扣分**的接线 ⇒ 属 R5-2（扣分端点已由 #4458 做掉，剩触发那一段） |
| 提示词/画幅/时长/分辨率的**诚实边界**（缺什么就报什么，不猜） | **桌面端 UI 改造**（画幅选择器、模型下拉）⇒ 本片只让既有调用面（`width/height`、`ratio`）能正确表达画幅；新增 UI 属产品迭代 |

---

## 2. 官方 v2 契约

### 2.1 创建

```
POST {BASE}/v2/video_generation
Authorization: Bearer {apiKey}
Content-Type: application/json
```

| 字段 | 类型 | 本片取值 | 说明 |
|---|---|---|---|
| `model` | string | `params.model` | H3 族（如 `MiniMax-H3` / `MiniMax-H3-Max`） |
| `content` | array | **必填** | 元素：`{ type: 'text', text }` / `{ type: 'image_url', image_url: { url }, role }` |
| `resolution` | string | `params.resolution`（缺省 `768P`） | 本片**不复制官方取值域**（见 §5.4） |
| `duration` | number | `params.duration` → 由 `numFrames/frameRate` 推导 → 缺省 `6` | 官方内部按帧网格取整 |
| `ratio` | string | 见 §5.3 | t2va 必填且**不能**是 `adaptive`；i2va **恒** `adaptive` |
| `aigc_watermark` | boolean | **仅在调用方显式给出时透传** | 不设默认值 ⇒ 不改变官方默认行为 |

响应：`{ task_id }`（**没有** `base_resp` 包裹；v1 才有）。

### 2.2 查询

```
GET {BASE}/v2/query/video_generation/{task_id}
```

> ⚠ 官方 API reference 是**路径参数**形态。第三方资料也见过 `?task_id=` 的写法
> （同一任务的另一种调用形态）⇒ 本片按**官方 API reference** 实现路径参数形态。

响应：

```jsonc
{
  "task": {
    "id": "…", "model": "MiniMax-H3",
    "status": "succeeded",            // queued | running | succeeded | failed | cancelled
    "error": { "code": 1026, "message": "…" },   // 失败/取消时才有
    "content": { "url": "https://…/out.mp4" },   // ⚠ 限时链接
    "resolution": "768P", "duration": 8, "ratio": "16:9",
    "task_type": "t2va",
    "usage": {                          // ⭐ 成本归集的真源
      "total_seconds": 8.7, "input_seconds": 0, "output_seconds": 8.7, "input_image_count": 1
    }
  }
}
```

### 2.3 错误体

v2 的错误体是 **OpenAI 风格**（v1 是 `base_resp.status_msg`）：

```jsonc
{ "type": "error", "error": { "type": "bad_request_error", "message": "content must include a non-empty text item (2013)", "http_code": 400 }, "request_id": "…" }
```

| HTTP | 官方 `error.type` | 语义 |
|---|---|---|
| 400 | `bad_request_error` | 参数非法（如 content 缺 text 项） |
| 401 | `authorized_error` | Key 无效 |
| 402 | `insufficient_balance_error` | 余额不足 |
| 422 | `unprocessable_entity_error` | **内容审核不通过**（不是参数错；同提示词重试必然还是 422） |
| 429 | `rate_limit_error` | 限流 |
| 500 / 529 | `server_error` / `overloaded_error` | 上游故障 |

---

## 3. 选路与基址

### 3.1 选路：按 model 族

```
isH3Model(model) ⇒ model 去空白后大写前缀命中 'MINIMAX-H3'
```

- ⛔ **不硬编码官方完整 model 枚举** ⇒ 官方以后加 `MiniMax-H3-Turbo` 也自动生效。
- 其它模型一律走 **v1**（既有行为一行不动）。

### 3.2 基址：**同域换版本**推导

```
resolveV2BaseUrl(credentials):
  1. credentials.baseUrlV2（显式）      → 原样（去尾斜杠）
  2. credentials.baseUrl 尾部是 /v2      → 原样
  3. credentials.baseUrl 尾部是 /v1      → 把 /v1 换成 /v2
  4. credentials.baseUrl 无版本段        → 追加 /v2
  5. 什么都没有                            → 空串（调用方报错，**不猜域名**）
```

| 用户配的 baseUrl | 推导出的 v2 基址 |
|---|---|
| `https://api.minimaxi.com/v1` | `https://api.minimaxi.com/v2` |
| `https://api.minimax.io/v1` | `https://api.minimax.io/v2` |
| `https://api.minimaxi.com` | `https://api.minimaxi.com/v2` |

> ⚠ **为什么代码里不内置官方域名**：国内站/国际站域名在第三方资料里互相矛盾
> （`api.minimaxi.com` / `api.minimaxi.cn` / `api.minimax.cn` / `api.minimax.io` 四种说法都出现过）⇒
> **赌错就是 401 或 DNS 失败**。「同域换版本」让**用户配哪个站就打到哪个站**，跨站不需要改代码。

### 3.3 轮询时的选路

`getVideoStatus(taskId)` **拿不到 model**（`callAdapter` 传的参数对象里只有 `{ videoId, taskId }`）⇒ 三级判定：

1. **本进程创建过的 v2 任务**（`this._v2Tasks`，创建时立刻登记）⇒ 直接走 v2。**这是 99.9% 的路径。**
2. 否则先走 v1；**只有 v1 端点回答「不认识这个 task」时**才回落试 v2。
3. 两端都不认识 ⇒ 抛出**合并**后的错误（两边的原因都在消息里，不吞掉任何一边）。

「不认识这个 task」的判别**不用错误文案**，用**状态码位数**：

- MiniMax 业务码（`base_resp.status_code`）是 **4 位**（1004/2056…）⇒ 端点回答了「不认识」⇒ 可回落；
- HTTP 状态码是 **3 位** ⇒ 其中只有 **404** 属于「不认识」；
- 鉴权（401）/ 限流（429）/ 余额（402）/ 5xx ⇒ **不回落**（换一个端点也是同样结果，多发请求只是放大上游压力）。

---

## 4. 数据校验清单

| # | 校验点 | 触发条件 | 行为 | 错误码 |
|---|---|---|---|---|
| V1 | `params.prompt` 非空 | 任何模式 | 本地拒（官方对「content 缺 text」返 400/2013） | `INVALID_CONFIG` |
| V2 | 画幅在官方集合内 | 显式画幅非 `adaptive` 且不在集合 | 本地拒并报出支持集合 | `INVALID_CONFIG` |
| V3 | 文生视频必须能定出画幅 | 无帧 + 无显式画幅 + 宽高推不出 | 本地拒（官方要求 t2va 的 ratio 必填） | `INVALID_CONFIG` |
| V4 | 参考素材是完整 URL / `mm_file://` / `data:` | 值不以这三种开头 | 本地拒（**不猜裸 base64 的 MIME**） | `INVALID_CONFIG` |
| V5 | 分辨率不是 v1 老档位 | `512P`/`720P`/`1080P` | 本地拒（v2 端点没有这些档位） | `INVALID_CONFIG` |
| V6 | 有 v2 基址 | `resolveV2BaseUrl` 返回空串 | 本地拒（提示填 baseUrl） | `INVALID_CONFIG` |
| V7 | 响应里有 `task` | 查询响应缺 `task` | 抛错（**不**静默当成 `processing`） | `PROVIDER_ERROR` |
| V8 | 响应里有 `task_id` | 创建响应缺 `task_id` | 抛错 | `PROVIDER_ERROR` |

> ⚠ **不复制官方取值域**：`resolution` / `duration` 的**合法区间**不落地成校验表 ⇒
> 官方改档位后本地不会变成第二份真源。只拦**已知的错配**（V5 那种「把 v1 的值发给 v2」）。

---

## 5. 功能逻辑

### 5.1 创建（v2）

```
generateVideo(params):
  prompt 缺失 ⇒ 抛 INVALID_CONFIG
  model = params.model || 'MiniMax-Hailuo-2.3'
  isH3Model(model) ⇒ _generateVideoV2(params, model)
  否则 ⇒ v1 既有实现（一行不动）

_generateVideoV2:
  base = resolveV2BaseUrl(credentials);  base 为空 ⇒ 抛 INVALID_CONFIG
  body = buildCreateBody(params, model)         ← §5.2 / §5.3 / §5.4
  POST {base}/video_generation
  data.task_id 缺失 ⇒ 抛 PROVIDER_ERROR
  this._v2Tasks.set(task_id, true)               ← 轮询选路用（§3.3）
  return { taskId, model }
```

### 5.2 `content[]` 构造

| 来源键 | 角色 | 优先级 |
|---|---|---|
| `params.prompt` | `type:'text'`（**必填**） | — |
| `params.firstFrameImage` | `type:'image_url'`, `role:'first_frame'` | 1 |
| `params.image` | 同上（`asset-generator` 的通用键） | 2（兜底） |
| `params.lastFrameImage` | `type:'image_url'`, `role:'last_frame'` | — |

> `firstFrameImage` 的值形态与仓内既有约定一致：影视工程的 `resolveShotReferenceInput`
> 注入的是 **`data:` URI**（带正确 MIME）⇒ v2 的 `image_url.url` 可直接吃。

### 5.3 画幅（ratio）

来源优先级（**走仓内单一真源** `readAspectRatio`，不自造键优先级）：

1. 显式画幅（`aspect_ratio` > `aspectRatio` > `ratio`）
2. 由 `width/height` 化简推导（`1280x720` ⇒ `16:9`；`720x1280` ⇒ `9:16`）
3. 有帧 ⇒ `adaptive`
4. 都没有 ⇒ 报错（V3）

**有帧时恒为 `adaptive`**：官方对图生视频的 ratio 是「由图决定、恒为 adaptive」，
传别的值会被**接受但忽略**（官方原话：最糟的三种结果之一，因为没有任何提示）⇒
适配器统一发 `adaptive`，避免出现「看起来传了画幅、实际没生效」的静默失效。

> 为什么要有第 2 条：影视工程的 `buildShotSubmitPayload` 只给 `width/height`
> （`16x9` ⇒ 1280x720、`9x16` ⇒ 720x1280），**不给画幅** ⇒ 这是本仓调用面能表达画幅的唯一现成通道。

### 5.4 时长与分辨率

| 项 | 优先级 | 缺省 |
|---|---|---|
| `duration` | `params.duration` → `round(numFrames/frameRate)` → 缺省 | `6` |
| `resolution` | `params.resolution` | `768P`（对 H3 与 H3-Max 都合法） |

> ⚠ **真实秒数不由本仓决定**：官方内部按帧网格取整（`17n+5` @24fps）⇒ 请求 8 秒可能出 8.7 秒。
> ⇒ 成本一律以轮询回来的 `usage.total_seconds` 为准（§1.1）。

### 5.5 轮询（v2）

```
_getVideoStatusV2(taskId):
  GET {base}/query/video_generation/{encodeURIComponent(taskId)}
  parseTaskResponse(data) ⇒ { status, rawStatus, videoUrl, progress,
                               usage, resolution, duration, ratio, taskType, model, error }
```

- `videoUrl` = `task.content.url`（**限时链接**；既有下载流程负责落盘）。
- `usage` = `task.usage` **原样**（不取整、不补默认值）。**上游没给就是没给** ⇒
  `usage-dimensions` 拿不到就报 0，而不是被一个猜出来的值污染。
- 失败/取消**不抛错**，而是 `status:'failed'` / `'cancelled'` + `error` 字段 ⇒
  既有轮询方（`asset-generator` / `film-engineering` / `digital-human-stages`）读的是 `status`，
  抛错反而会被它们当成「还没出结果」而继续轮询到超时。

### 5.6 顺手修掉的既有缺陷：`getVideoStatus` 的入参形态

`callAdapter` 统一以**一个对象**调用适配器方法（`{ videoId, taskId }`），
而 MiniMax 原实现签名是 `getVideoStatus(taskId)`（要**字符串**）⇒
经 `callAdapter` 调用时会把对象拼进 URL（`task_id=%5Bobject%20Object%5D`）⇒ **轮询必然失败**。

修法**照抄仓内既有先例** `agnes-video.js`（同一份约定、同一段写法）：

```js
const rawTaskId = (taskIdOrParams && typeof taskIdOrParams === 'object')
  ? (taskIdOrParams.videoId || taskIdOrParams.taskId || taskIdOrParams.id)
  : taskIdOrParams
```

字符串形态**行为不变**；对象形态由「必然失败」变成「正确工作」。

### 5.7 错误映射

| 场景 | 结果 |
|---|---|
| v2 错误体 `error.message` | 透出**官方原文**（不再只剩 `HTTP 402`） |
| 402 | `QUOTA_EXCEEDED`（余额不足 = 额度问题） |
| 401/403 | `AUTH_FAILED` |
| 429 | `RATE_LIMITED` |
| **422** | **`CONTENT_POLICY`**（官方语义：内容审核不通过；同提示词重试必然还是 422 ⇒ 归 `PROVIDER_ERROR` 会让上游一直重试到超时。归 `CONTENT_POLICY` 才能让仓内既有的「内容改写 + 重试」路径接管） |

---

## 6. 端到端流程

```
① 用户/流水线选模型 MiniMax-H3
   ↓
② callAdapter('generateVideo', { prompt, model, width/height?, firstFrameImage?, duration?, resolution? })
   ↓
③ 适配器：isH3Model ⇒ v2 分支
   ├─ buildCreateBody：content[] / ratio / duration / resolution
   ├─ POST {base}/v2/video_generation ⇒ { task_id }
   └─ 登记 _v2Tasks[task_id]
   ↓
④ callAdapter('getVideoStatus', { videoId, taskId })  ← 每 10 秒一次
   ↓
⑤ 适配器：_v2Tasks 命中 ⇒ GET {base}/v2/query/video_generation/{task_id}
   ↓
⑥ 解析 ⇒ { status, videoUrl, usage, resolution, … }
   ├─ status != completed ⇒ 调用方继续等
   └─ status == completed ⇒ 调用方下载 content.url 并落盘
   ↓
⑦ 调用方返回结果给 manager ⇒ _writeLog 记录 result
   ↓
⑧ usage-dimensions.extractUsageDimensions({ params, result })
   ⇒ duration_seconds = usage.total_seconds（真实秒数，不再靠猜）
   ↓
⑨ model_provider_logs 一行 ⇒ usage-reporter.reportEvents()
   ⇒ POST /api/v1/usage/events（服务端按价格卡算成本）
```

> ⚠ **第 ⑨ 步在 U-12 关闭前会「缺价」**：MiniMax H3 的价格卡还没有（须人工拍板）⇒
> 服务端会点名缺价。**这是刻意的 fail-closed**（宁可报缺价，也不按 0 价记账）。

---

## 7. 交互逻辑 / 显示项

### 7.1 桌面端调用面的既有形状（本片不新增字段）

| 调用方 | 传入形状 | 本片如何消化 |
|---|---|---|
| `film-engineering/video-gen.js` | `{ prompt, numFrames, frameRate, width, height, model, ...referencePayload }` | 画幅由 `width/height` 推导（§5.3）；时长由 `numFrames/frameRate` 推导（§5.4） |
| `asset-generator.js` | `{ prompt, model, width, height, image, numFrames, frameRate }` | 同上；`image` 作为首帧兜底（§5.2） |
| `digital-human-stages.js` | `{ prompt, model, … }` | 同上 |

### 7.2 显示项

| 项 | 值 | 来源 |
|---|---|---|
| 成片地址 | `content.url`（限时） | v2 查询响应 |
| 时长（计费口径） | `usage.total_seconds` | v2 查询响应 → `usage-dimensions` |
| 规格（价格卡匹配键） | `task.resolution`（如 `768P` / `2K`） | v2 查询响应 → `usage-dimensions` |
| 任务类型 | `task.task_type`（如 `t2va` / `i2va`） | v2 查询响应 |

> ⚠ **本片不改任何 UI**：显示项的呈现依赖价格卡（U-12）与读余额端点（U-13）⇒
> 提前接会产出「恒为 0 / 恒为「—」」的假数据（同 #4458 的判断）。

### 7.3 提示文字（zh / en **必须成对**）

本片在适配器层产生的**用户可见文案**只有错误消息。桌面端最终文案真源在桌面端 i18n 层；
本片保证**错误语义**与下表对齐（不新增文案口径）。

| 场景 | 错误码 | 中文 | English |
|---|---|---|---|
| 画幅不支持 | `INVALID_CONFIG` | `不支持的画幅「{value}」，MiniMax H3 支持：{supported}` | `Unsupported aspect ratio "{value}". MiniMax H3 supports: {supported}` |
| 文生缺画幅 | `INVALID_CONFIG` | `MiniMax H3 文生视频必须指定画幅（ratio 或 aspect_ratio），支持：{supported}` | `Text-to-video with MiniMax H3 requires an aspect ratio (ratio or aspect_ratio). Supported: {supported}` |
| 参考素材形态错 | `INVALID_CONFIG` | `参考素材必须是完整 URL（http/https）、mm_file://file_id 或 data: URI；不支持裸 base64` | `Reference media must be a full URL (http/https), mm_file://file_id, or a data: URI. Raw base64 is not supported.` |
| 分辨率档位错 | `INVALID_CONFIG` | `MiniMax H3（v2 端点）不支持 v1 的分辨率档位「{value}」，请改用 768P 或 2K` | `MiniMax H3 (v2 endpoint) does not support the v1 resolution "{value}". Use 768P or 2K.` |
| 缺 v2 基址 | `INVALID_CONFIG` | `MiniMax H3 需要 v2 端点基址：请在服务商设置里填写 baseUrl` | `MiniMax H3 requires a v2 endpoint base URL. Please set base URL in the provider settings.` |
| 余额不足 | `QUOTA_EXCEEDED` | 官方原文透出（`insufficient balance`） | Official message passed through |
| 内容审核不通过 | `CONTENT_POLICY` | 官方原文透出 | Official message passed through |

**文案纪律**：
- ⛔ **不许承诺结算时限**（U-14 关闭前没有调度宿主）。
- ⛔ **不许在失败文案里显示「已扣除积分」**（本片不涉及扣分）。
- ⚠ **官方原文透出**：上游错误消息是排查的第一手证据，不做本地改写（改写会把「余额不足」说成「未知错误」）。

---

## 8. 验收标准

### 8.1 机械可判

| # | 标准 | 判据 |
|---|---|---|
| A1 | H3 走 v2 端点、body 是 `content[]` | `minimax.test.js`「H3 模型 ⇒ 打 v2 基址…」 |
| A2 | v2 基址**同域换版本**、不内置域名 | `minimax-h3-v2.test.js`「resolveV2BaseUrl」5 例 |
| A3 | 画幅来源与优先级 | `minimax-h3-v2.test.js`「画幅」6 例 |
| A4 | `content[]` 构造（含首帧/尾帧/兜底键） | `minimax-h3-v2.test.js`「content[] 构造」5 例 |
| A5 | 时长/分辨率解析 | `minimax-h3-v2.test.js`「时长与分辨率」4 例 |
| A6 | 状态映射（含未知态） | `minimax-h3-v2.test.js`「状态映射」2 例 |
| A7 | **`usage` 原样透出 / 缺 usage 为 null** | `minimax-h3-v2.test.js`「usage 原样透出」「缺 usage ⇒ null」 |
| A8 | v2 错误体消息可读 + 402/422 分类 | `minimax.test.js`「v2 402 …」「v2 422 …」 |
| A9 | v1 → v2 回落只在「不认识 task」时发生 | `minimax.test.js`「v1 → v2 回落」3 例 |
| A10 | **v1 行为零回归** | `minimax.test.js` 既有 v1 用例全绿 + 新增「v1 老模型仍走 v1」 |
| A11 | 对象形态入参可用（既有缺陷已修） | `minimax.test.js`「callAdapter 的对象形态 …」 |
| A12 | 变异验证 | 见执行记录 §3（每条注入缺陷都必须被对应用例抓住） |

### 8.2 人工/实机

| # | 标准 | 状态 |
|---|---|---|
| B1 | 真机跑通一次 H3 创建 + 轮询 + 下载 | ⛔ **未做**：沙箱无 MiniMax Key ⇒ **首次联调必须确认域名、路径、字段名与错误体**（§9） |
| B2 | 真实 `usage.total_seconds` 与请求 `duration` 的差值落到成本侧 | ⛔ 依赖 B1 + R5-4 价格卡 |

---

## 9. 取证与未核实边界（如实登记）

| 项 | 依据 | 状态 |
|---|---|---|
| v2 端点路径、请求体字段、响应结构、`usage` 字段 | 官方 API reference（`platform.minimax.io/docs/api-reference/video-generation-v2-*`） | 已核对 |
| 状态枚举、错误体形状、错误码语义 | 同上 | 已核对 |
| `ratio` 三种模式的差异（t2va 必填非 adaptive / i2va 恒 adaptive / r2va 可选默认 adaptive） | 同上 | 已核对 |
| 官方计费口径是 `usage.total_seconds` 而非请求 duration | 同上 | 已核对 |
| **国内/国际站域名** | 第三方资料**互相矛盾**（`api.minimaxi.com` / `api.minimaxi.cn` / `api.minimax.cn` / `api.minimax.io`） | ⚠ **未采信任何单一说法** ⇒ 代码不内置域名，靠「同域换版本」推导（§3.2） |
| 输出 URL 有效期（限时） | 官方文档：任务窗口 7 天、输出链接限时 | 已核对（⇒ 既有下载流程必须落盘） |
| `duration` 的帧网格（`17n+5` @24fps） | 第三方技术文档 | ⚠ 未在官方 reference 中逐条复核 ⇒ 本片**不依赖**它（真实秒数一律取 `usage.total_seconds`） |
| v2 的 `model` 完整枚举 | 官方 reference 曾只列 `MiniMax-H3`；`MiniMax-H3-Max` 见于官方产品说明 | ⚠ **不采信完整枚举** ⇒ 只做前缀判定（§3.1） |
| 参考素材数量/体积上限（图片 ≤9 张、视频/音频 ≤3 段、单请求 ≤12 个文件、请求体 ≤64MB） | 第三方技术文档 | ⚠ 未在官方 reference 中逐条复核 ⇒ 本片**不实现**这些上限（交给上游拒） |

> ⛔ **本片没有任何一次实机调用**（沙箱无 MiniMax Key）⇒
> 上述「已核对」只代表**契约形状**可信，**不代表**域名/权限/价格已验证。

---

## 10. 遗留与人工决策项

| # | 项 | 归属 | 影响 |
|---|---|---|---|
| L-1 | MiniMax 8 张价格卡（R5-4） | **U-12 须人工拍板** | 无卡 ⇒ 服务端「缺价」⇒ **H3 用量恒不记成本**（fail-closed，不按 0 价记账） |
| L-2 | 官方 Key 池路由（`byok=0` 的来源） | 依赖 R5-4 | 用户自带 Key 之外，官方额度暂不可用 |
| L-3 | 事件落库 → 触发扣分 | R5-2（扣分端点已由 #4458 做掉） | 用量记上了，积分还没扣 |
| L-4 | 读余额端点 | **U-13 须人工过目** | 桌面端看不到余额 |
| L-5 | 补扣调度宿主 | **U-14 须人工拍板** | 挂起 = 永久白送 |
| L-6 | `asset-generator` 的 `image` 键与仓内 `VIDEO_REFERENCE_PARAM_BY_PROVIDER`（按 providerId 映射）不一致 | 本片已用 `image` 兜底首帧；但**影视工程**的参考图注入按 providerId 登记 ⇒ 若用户为 H3 单独建 provider，需另行登记其 id | 参考图在影视工程里可能降级为纯文本（既有降级路径会带 warning，不静默） |
| L-7 | 桌面端 UI：画幅选择器 / H3 模型入口 | 产品迭代 | 本片只让既有调用面能表达画幅 |
| L-8 | 实机联调（域名/权限/价格） | 首次联调 | §9 的「已核对」≠ 已验证 |
| L-9 | 产物链接限时 | 既有下载流程负责落盘 | 若下载失败，成片与用量都会丢 |

## CHANGELOG 条目

# feat(video): MiniMax H3 适配器接上 v2 端点 —— 官方回的真实用量第一次能进成本归集

- MiniMax H3 走的是**另一套端点**（提示词在数组里、查询用路径参数、产物直接给链接），
  原来的适配器完全不认识它 ⇒ 现在按模型自动选路，Hailuo 等老模型行为**一行未改**。
- 官方会回一块真实用量（**实际出了多少秒**）；这块数据被原样透出 ⇒
  成本不再靠「请求了多少秒」去猜（官方按帧网格取整，两者本来就不相等）。
- 顺手修掉一个既有缺陷：轮询接口只认字符串参数，而仓内统一传的是对象 ⇒
  MiniMax 的视频轮询经正常调用链**必然失败**。修法照抄仓内既有的同类适配器写法。
- 画幅、时长、分辨率**缺什么就报什么**：不猜裸 base64 的图片类型，不替官方复制取值域，
  也不把「看起来传了画幅、实际被忽略」当成功。
- 官方域名**不写死在代码里**：国内站与国际站的域名在资料里互相矛盾，
  改成「按你配的地址同域换版本」⇒ 配哪个站就打到哪个站。

## learnings

### lesson: dont-hardcode-a-domain-when-sources-disagree

**现场**：要给 MiniMax H3 接 v2 端点，就得知道基址。可官方国内站/国际站的域名在第三方资料里
有四种说法（`api.minimaxi.com` / `api.minimaxi.cn` / `api.minimax.cn` / `api.minimax.io`），
连「国内端点示例」都互相引用着不同的域名。

**根因**：**这不是一个「查清楚就能写死」的常量，而是一个「用户本来就知道」的量。**
用户已经在服务商设置里填了 baseUrl（他知道自己买的是哪一站的额度）⇒
代码再去猜一个官方域名，等于**用一个更不可靠的知识覆盖一个更可靠的知识**。

**可复用的 3 条**：

1. **当多个来源对同一个「外部标识」不一致时，不要选一个信** ⇒ 改成**推导**：
   本例是「同域换版本」（`.../v1` ⇒ `.../v2`）⇒ 用户的配置自动决定站点，跨站不用改代码。
2. **判据：这份配置本来就在用户手里吗？** 在 ⇒ 推导；不在 ⇒ 才需要固定值（并标注未核实）。
3. **「不内置」不等于「不给出路」** ⇒ 本片同时给了 `baseUrlV2` 显式覆盖口，
   让代理/网关这类「非同域」场景也有路可走。
