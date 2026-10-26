# 会员中心修复 + 用户反馈闭环（member-center-fixes）

> 状态：实施中 ｜ 提出：2026-10-26 ｜ 依据：`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`（v4）+ 2026-10-26 代码复核
> 本文是**动手前**的方案（PRD 级）。执行记录见 `openspec/records/member-center-fixes.md`。

## 0. 一句话

修掉三个「看起来做完了、实际没生效」的真实缺陷，补齐额度页与概览的展示正确性，并把「用户反馈」从设置页搬进会员中心「帮助与支持」，让用户在遇到问题时**当场能提交、能带诊断、运营能看到**。

---

## 1. 背景：为什么现在要做

2026-10-26 对主干做了逐文件复核（不是照抄 10-19 的方案文档），发现三类问题：

### 1.1 三个 P0：功能实际是死的

| # | 缺陷 | 证据 | 用户看到什么 |
|---|---|---|---|
| P0-1 | `is_current` 被 store 白名单吞掉 | `stores/member.js` 的 `normalizeSession` 只返回 `{id, deviceId, deviceName, createdAt, lastSeenAt}`，**无 `is_current`**；`AccountSecurity.vue` 的 `hasCurrentDevice` 读的正是它 | 「当前设备」徽章**永不出现**；反而**始终**显示「未能识别当前设备」中性提示 |
| P0-2 | 深链进 `?section=account` 不加载设备 | `MemberCenter.vue` 的 `onMounted` 只设 `activeKey`，`loadSessions()` 只写在 `activate()`（仅导航点击触发） | 刷新/深链进来，设备列表是**假空态**「暂无设备」 |
| P0-3 | 页面内点「升级 Pro」不切 tab | `goToSubscription()` 走 `router.push(?section=subscription)`，但**没有** `watch(route.query.section → activeKey)`；同路径仅 query 变化不重挂组件 | 点了升级，URL 变了、**界面纹丝不动** |

**三者共同根因**：测试都 mock 掉 store 或只断言「函数被调用」，没有断言「效果发生」。P0-1 逃逸在 store 归一化层，P0-3 逃逸在「断言 push 调用而非 tab 切换」。

### 1.2 两个 P1：展示不正确

| # | 缺陷 | 证据 |
|---|---|---|
| P1-a | 额度页绕过本地化 helper | `labels.js` 已有 `quotaLabelOf` / `quotaValueText`，locale 也有 `memberCenter.quota.cloud_publish_monthly` 等键，但 `UsageQuota.vue` **没 import**，自己 `String(value)` ⇒ 用户看到 `cloud_publish_monthly 1500`、`-1` |
| P1-b | 概览升级提示对 Pro 用户照常显示 | `Overview.vue` 的 `upgradeHint` 是**无条件**渲染（文案「解锁全平台发布…」）⇒ Pro 用户被告知「你还没解锁」 |

### 1.3 一个能力缺口

`HelpSupport.vue` 全文只有「版本号 + 一句提示」，**零可操作项**。而反馈链路其实**三层都已存在**：

- 桌面：`electron/services/feedback.js`（`submitFeedback`，含日志归档 zip）→ `feedback:submit` IPC → `preload/system.js`
- 运营中心后端：`POST /api/v1/feedback`（`X-Catalog-Key` 鉴权）+ `GET /api/v1/feedback`（admin 分页）+ 详情 + 附件下载
- 运营中心前端：`views/UserFeedback.vue` + 菜单「用户反馈」（adminOnly）

**缺口只在两处**：① 会员中心没有入口；② 反馈没有「分类 / 来源」，运营无法分诊、也无法区分「会员中心来的」和「设置页来的」。

---

## 2. 范围

### 2.1 做

- P0-1 / P0-2 / P0-3 修复 + 回归测试（断言效果，不断言调用）
- P1-a 额度页接本地化 helper + 新建测试
- P1-b 概览升级提示按档位收敛；订阅页补「降档联系客服」说明
- P2 无障碍/死类：`aria-label="actions"` 本地化、`.member-center-single` 补定义
- **H-1** 会员中心「帮助与支持」内置反馈表单（分类 / 内容 / 联系方式 / 诊断信息一键复制+附带 / 附日志 / 三态反馈）
- **H-2** 桌面主进程透传 `category` / `source` / `diagnostics`
- **H-3** 运营中心：反馈表增 `category` / `source`（幂等迁移）+ 列表返回与分类筛选 + 前端新增「分类」列与筛选器、详情展示分类/来源

### 2.2 不做（明确 Non-goal）

- ❌ 降档功能：**产品明确不支持**。UI 只写「如需降档请联系客服」，不提供操作入口
- ❌ 订单分页（服务端 50 条上限仍在，另开任务）
- ❌ 单设备下线（服务端无端点）
- ❌ 反馈的「回复/工单流转」：运营仍只读，状态列保留 `new`，不做流转状态机
- ❌ 视觉回归覆盖会员中心（另开任务）

---

## 3. 详细设计

### 3.1 P0-1：`is_current` 归一化补齐

**改动**：`apps/desktop/src/stores/member.js` 的 `normalizeSession`

```js
is_current: source.is_current === true,
```

**为什么用 `=== true` 而不是 `Boolean(...)`**：`is_current` 是「服务端/主进程的明确判定」，任何非 `true` 的值（`"true"` 字符串、`1`、`undefined`）都**不应**被解释成「这台是当前设备」——那会把「不确定」升格成「确定」，正是 C1-13 要防的方向。保守取值只会退回中性态（合法态），不会误标别人的设备。

**同时**：`member.test.js` 增字段级断言（红→绿）：
- 服务端给 `is_current: true` → store 里保留 `true`
- 给 `false` → 保留 `false`
- 不给 → `false`（默认保守）
- 给 `"true"` 字符串 → `false`（类型严格）

### 3.2 P0-2：深链首屏加载

**改动**：`MemberCenter.vue`

抽出一个纯函数：

```js
function loadForSection(key) {
  if (key === 'messages') return memberStore.loadNotifications()
  if (key === 'account') return memberStore.loadSessions()
  return undefined
}
```

- `activate(key)` → `activeKey.value = key; loadForSection(key)`
- `onMounted` 深链命中后 → `loadForSection(activeKey.value)`

**幂等性**：`memberStore` 的 `loadSessions` / `loadNotifications` 内部走 `runExclusive`，重复调用只是多一次请求，不产生状态错乱；深链只在挂载时跑一次。

### 3.3 P0-3：URL → state 反向同步

**改动**：`MemberCenter.vue` 新增

```js
watch(() => route.query.section, (section) => {
  if (typeof section !== 'string') return
  if (!MEMBER_SECTIONS.some((s) => s.key === section)) return
  if (section === activeKey.value) return   // 防回环：state→URL 刚写过
  activeKey.value = section
  loadForSection(section)
})
```

**防回环**：`watch(activeKey)` 写 URL 时会再次触发本 watch，靠 `section === activeKey.value` 早退切断。

**测试必须断言效果**（不是断言 `routerPush`）：

```js
// 模拟路由 query 变化（replace 后 route.query.section 变成 subscription）
await router.replace('/member-center?section=subscription')
await nextTick()
expect(wrapper.get('[data-testid="member-center-subscription"]').exists()).toBe(true)
```

### 3.4 P1-a：额度页本地化

**改动**：`UsageQuota.vue`

```js
import { quotaLabelOf, quotaValueText } from './labels'
...
.map(([key, value]) => ({
  key,
  label: quotaLabelOf(t, key),
  value: quotaValueText(t, value),
}))
```

模板：`{{ entry.label }}` / `{{ entry.value }}`。

**未知 key 行为**：`quotaLabelOf` 原样返回 key（不开天窗、不显示空白），`quotaValueText` 对对象 `JSON.stringify`、`-1` → 「不限」。

### 3.5 P1-b：升级提示与降档说明

- `Overview.vue`：`<p v-if="!isProActive" class="member-center-upgrade-hint">` —— Pro 用户不再看到「解锁…」
- `Subscription.vue`：在价目卡下方增加一句**说明**（非按钮）：

```html
<p class="member-center-downgrade-hint">{{ t('memberCenter.planDowngradeHint') }}</p>
```

locale（zh）：`如需降档，请联系客服协助处理。`
locale（en）：`To downgrade your plan, please contact support.`

**为什么不做成按钮**：按钮会暗示「点了能降」，而实际没有该能力——那是假承诺。文案只陈述事实与下一步。

### 3.6 H-1：帮助与支持 · 反馈表单

#### 3.6.1 显示项（自上而下）

| 区块 | 元素 | 说明 |
|---|---|---|
| 标题 | 「帮助与支持」卡片 | 沿用现有 `helpTitle` |
| 说明 | 一句引导 | 「遇到问题？告诉我们，我们会尽快处理。」 |
| 分类 | `el-select`，6 选 1，**必填** | 账号与登录 / 支付与订单 / 发布失败 / AI 功能 / 界面与体验 / 其他 |
| 内容 | `textarea`，**必填**，10–1000 字 | 实时字数 `已输入 N / 1000`；<10 字时提交按钮禁用并提示 |
| 联系方式 | `input`，可选，≤100 字 | 占位符「邮箱 / 微信 / QQ（选填）」 |
| 诊断信息 | 折叠区 + 「复制」按钮 | 复用 `identity:diagnostic-report`；复制成功提示「已复制」 |
| 附带诊断 | `checkbox`，**默认勾选** | 勾选后把诊断文本拼进 message 末尾的结构化块 |
| 附最近日志 | `checkbox`，**默认不勾** | 复用现有 `includeLogs`（最多 30 个日志文件、25MB 上限） |
| 提交 | 主按钮 | 三态：`提交反馈` / `提交中…` / 成功后 `已提交` |
| 结果 | 状态条 | 成功：「已收到，感谢反馈」；失败：可读原因 + 重试 |

#### 3.6.2 数据校验（客户端，先于请求）

| 字段 | 规则 | 失败表现 |
|---|---|---|
| category | 必须是 6 类之一 | 下拉不可为空；未选时按钮禁用 |
| message | `trim()` 后长度 ∈ [10, 1000] | 按钮禁用 + 字数条变红提示「至少 10 字」 |
| contact | ≤ 100 字；允许空 | 超出截断并提示 |
| diagnostics | ≤ 4000 字（超出截断，避免挤占 message 上限） | 静默截断并在预览里标注「已截断」 |
| 总 message | 拼装后 ≤ 10000 字（服务端 `MAX_MESSAGE_LENGTH`） | 客户端先截断正文而非让服务端 400 |

#### 3.6.3 提交报文（拼装规则）

`message` 字段按以下结构拼装（**人类可读、运营可直接看懂**）：

```
【分类】支付与订单
【联系方式】user@example.com
【诊断信息】
<诊断文本，≤4000 字>
---
<用户正文>
```

无联系方式则省略该行；不附诊断则省略诊断块（连分隔线一起）。

#### 3.6.4 提交流程（端到端）

```
HelpSupport.vue
  → invoke('feedback:submit', { message, category, source: 'member-center', includeLogs })
  → ipc-handlers/logs.js  feedback:submit
  → services/feedback.js  submitFeedback({ message, category, source, includeLogs })
  → multipart POST  <opsCenterUrl>/api/v1/feedback
       headers: X-Catalog-Key
       fields : message, category, source, client_id, app_version, platform
       file   : log_archive (可选 zip)
  → ops-center routers/feedback.py  ingest_feedback
  → services/feedback_service.create_feedback
  → SQLite user_feedback (category, source)
  → 运营中心 /feedback 页面可见（分类列 + 筛选）
```

#### 3.6.5 提示文案（全部进 locale，zh/en 成对）

| key | zh |
|---|---|
| `memberCenter.feedbackTitle` | 问题反馈 |
| `memberCenter.feedbackHint` | 遇到问题？告诉我们，我们会尽快处理。 |
| `memberCenter.feedbackCategory` | 问题分类 |
| `memberCenter.feedbackCategoryPlaceholder` | 请选择分类 |
| `memberCenter.feedbackCategoryAccount` | 账号与登录 |
| `memberCenter.feedbackCategoryPayment` | 支付与订单 |
| `memberCenter.feedbackCategoryPublish` | 发布失败 |
| `memberCenter.feedbackCategoryAi` | AI 功能 |
| `memberCenter.feedbackCategoryUi` | 界面与体验 |
| `memberCenter.feedbackCategoryOther` | 其他 |
| `memberCenter.feedbackMessage` | 问题描述 |
| `memberCenter.feedbackMessagePlaceholder` | 请描述你遇到的问题、期望的结果，以及复现步骤（至少 10 字） |
| `memberCenter.feedbackMessageTooShort` | 至少输入 10 个字 |
| `memberCenter.feedbackMessageCount` | 已输入 {count} / {max} |
| `memberCenter.feedbackContact` | 联系方式 |
| `memberCenter.feedbackContactPlaceholder` | 邮箱 / 微信 / QQ（选填） |
| `memberCenter.feedbackDiagnostics` | 诊断信息 |
| `memberCenter.feedbackDiagnosticsHint` | 诊断信息不含账号密码，可放心附带。 |
| `memberCenter.feedbackCopyDiagnostics` | 复制诊断信息 |
| `memberCenter.feedbackCopied` | 已复制 |
| `memberCenter.feedbackCopyFailed` | 复制失败，请手动选择文本 |
| `memberCenter.feedbackAttachDiagnostics` | 附带诊断信息 |
| `memberCenter.feedbackAttachLogs` | 附上最近日志（最多 30 个文件） |
| `memberCenter.feedbackSubmit` | 提交反馈 |
| `memberCenter.feedbackSubmitting` | 提交中… |
| `memberCenter.feedbackSuccess` | 已收到，感谢你的反馈。 |
| `memberCenter.feedbackFailed` | 提交失败，请稍后重试。 |
| `memberCenter.feedbackUnavailable` | 当前无法连接反馈服务，请稍后再试或联系客服。 |

---

## 4. 运营中心改动

### 4.1 数据模型（SQLite / SQLAlchemy）

`user_feedback` 增两列（均可空、有默认，向后兼容）：

| 列 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `category` | VARCHAR(32) | `''` | 6 类枚举之一；未知/缺失落 `''`（列表显示「未分类」） |
| `source` | VARCHAR(32) | `''` | `member-center` / `settings` / `''` |

**迁移方式**：沿用本仓已有的幂等 `ALTER TABLE ... ADD COLUMN` 模式（`model_preset_service.py:587` 同型），新建 `services/feedback_migration.py`，在 `main.py` 的 `lifespan` 里 `init_db()` 之后调用。**不用 `create_all` 指望补列**——SQLite 的 `create_all` 不会给已存在的表加列。

### 4.2 服务层校验

- `category`：白名单 `{account, payment, publish, ai, ui, other}`；不在白名单 → 存 `'other'`（**不 400**：分类是分诊辅助，不该因为客户端版本旧就丢反馈）
- `source`：≤32 字，正则 `^[a-z0-9_-]*$`，不合法 → `''`
- 其余沿用现状（message 长度上限取 `settings.feedback_max_message_chars`）

### 4.3 接口

- `POST /api/v1/feedback` 增 `category: str = Form("")`、`source: str = Form("")`
- `GET /api/v1/feedback` 增 `category: str | None = Query(None)`（空/`all` 不过滤）
- 列表项增 `category`、`source`；详情同

### 4.4 前端（`UserFeedback.vue`）

- 表格新增「分类」列（宽度 120，未分类显示「未分类」灰字）
- 顶部筛选：`el-select`（全部 / 6 类）
- 详情抽屉增「分类」「来源」两行

---

## 5. 验收标准（DoD）

| # | 判据 | 取证方式 |
|---|---|---|
| 1 | `is_current: true` 能穿透 store 到组件 | `member.test.js` 字段断言 + `AccountSecurity.test.js` 集成（不 mock store） |
| 2 | 深链 `?section=account` 首屏有设备 | 组件测试：挂载时 mock store 的 `loadSessions` 被调用且列表渲染 |
| 3 | 页面内改 query 会切 tab | 测试断言 `[data-testid="member-center-subscription"]` 存在 |
| 4 | 额度页显示中文标签 | `UsageQuota.test.js`：`每月发布额度`、`不限` |
| 5 | Pro 用户看不到升级提示 | `Overview.test.js` |
| 6 | 降档只有文案无按钮 | `Subscription.test.js` |
| 7 | 反馈表单校验/拼装/三态 | `HelpSupport.test.js`（新建） |
| 8 | 主进程透传三个新字段 | `logs.test.js` / `feedback.test.js` |
| 9 | 运营中心接受并返回分类 | `ops-center/backend` pytest：create + list 过滤 |
| 10 | 前端展示分类列/筛选 | 前端 build 通过（无单测基建则人工核） |
| 11 | locale 成对 | `check-locale-sync.js --keys` |
| 12 | 行数门禁 | `check-max-lines.js` rc=0 |

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 反馈上报目标（运营中心地址）未配置 | 沿用 `submitFeedback` 既有失败分支，UI 显示 `feedbackUnavailable`，不静默 |
| 诊断信息含敏感内容 | 主进程 `buildDiagnosticReport` 已脱敏；表单再提示「不含账号密码」 |
| SQLite 存量库缺列 | 幂等 `ALTER TABLE ADD COLUMN`，启动时执行 |
| 分类枚举漂移（客户端新、服务端旧） | 服务端未知分类落 `other` 而非 400 |
| 深链 watch 回环 | `section === activeKey` 早退 |
