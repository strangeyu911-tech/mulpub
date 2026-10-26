# 单设备下线（member-center-session-revoke）

> 状态：实施中 ｜ 提出：2026-10-26 ｜ 依据：`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md` §11.5「仍然未做」

## 0. 一句话

在「账号与安全」的设备列表里，每行加一个「下线」按钮，让用户能**只作废某一台设备**的会话，而不是只能「一次全踢」。

---

## 1. 现状与缺口

现在只有一个按钮「退出其他设备」，服务端只有：

```js
UPDATE identity_user_sessions SET revoked_at = NOW()
WHERE user_id = $1 AND revoked_at IS NULL
  AND device_id IS DISTINCT FROM $2   -- $2 = 当前设备
```

**实际后果**：用户有 5 台设备，发现其中一台旧笔记本可疑，只能把「除当前这台外的 4 台」全部踢掉——家里台式、平板、手机都要重新登录一遍。

**缺失**：按会话作废的单设备端点（服务端、仓储、IPC、UI 四层都没有）。

---

## 2. 范围

### 2.1 做

- 服务端 `POST /api/v1/me/sessions/revoke`（body `{ sessionId }`）
- 仓储 `getSession(userId, sessionId)` / `revokeSession(userId, sessionId)`
- 桌面 IPC `identity:sessions-revoke-one` + preload `identitySessionsRevokeOne`
- member store `revokeSession(sessionId)` + 渲染层每行「下线」按钮
- locale 文案（zh/en 成对）

### 2.2 不做（Non-goal）

- ❌ 批量多选下线（逐行操作已覆盖主场景）
- ❌ 「下线并拉黑设备」（需要设备指纹体系，另立项）
- ❌ 会话历史/审计视图

---

## 3. 详细设计

### 3.1 为什么是 `POST /me/sessions/revoke` 而不是 `POST /me/sessions/{id}/revoke`

本仓的会员接口白名单（`member-api-service.js`）对「带路径参数」的路径有**双层锁**：前缀 + `paramPattern`，且**参数里不允许出现 `/`**（防路径穿越）。`{id}/revoke` 会让参数含 `/`，需要改造白名单机制。

而同目录已有 `revoke-others`、`notifications/read` 这类「动词后缀 + body 带参」的先例。**沿用同一形态**：路径固定、目标 id 放 body，既不打穿白名单，也和既有风格一致。

### 3.2 请求/响应契约

**请求**

```
POST /api/v1/me/sessions/revoke
Headers: Authorization: Bearer <token>, X-Device-ID: <当前设备>
Body   : { "sessionId": "ses-<32位小写hex>" }
```

**sessionId 形状**：会话主键由 `sessionRecordId(userId, deviceId)` 确定性派生 ⇒ `ses-` + sha256 前 32 位小写 hex。正则 `/^ses-[a-f0-9]{32}$/`。

**响应**

| 场景 | HTTP | body |
|---|---|---|
| 成功 | 200 | `{ "revoked": 1 }` |
| sessionId 形状不合法 | 400 | `{ "error": "SESSION_ID_INVALID" }` |
| 缺 `X-Device-ID` | 400 | `{ "error": "DEVICE_ID_REQUIRED" }` |
| 目标就是当前设备 | 400 | `{ "error": "CANNOT_REVOKE_CURRENT_DEVICE" }` |
| 会话不存在 / 不属于该用户 / 已作废 | 404 | `{ "error": "SESSION_NOT_FOUND" }` |

### 3.3 两条安全红线

**红线 1：归属校验用 SQL 条件，不先查后改**

```sql
SELECT ... FROM identity_user_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
UPDATE identity_user_sessions SET revoked_at = NOW()
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id
```

- 拿**别人**的 session id 来请求 → 查不到 → **404**（不是 403）
- **为什么 404 而不是 403**：403 等于确认「这个 id 真实存在、只是不属于你」，是一个**存在性探针**。404 让「不存在」与「不属于你」不可区分。

**红线 2：默认不允许踢掉当前设备**

- 服务端拿 `X-Device-ID`（已有正则校验的 `_deviceIdFrom`），若目标会话的 `device_id` 与之相同 → **400 CANNOT_REVOKE_CURRENT_DEVICE**
- 否则用户点错一下就把自己踢下线，本地 token 立刻失效，体验是「应用突然要求重新登录」且没有任何解释
- 渲染层同时把当前设备那行的按钮置灰（双重防护：UI 不让点 + 服务端拒绝）

**为什么服务端必须先查一次再改**：单条 SQL 无法区分「不存在」「已作废」「是当前设备」三种 0 行结果；而三种的响应不同（404 / 404 / 400）。所以 `getSession` → 判定 → `revokeSession`。**并发窗口可接受**：即使两次请求同时通过判定，第二次 UPDATE 因 `revoked_at IS NULL` 返回 0 行，仍是幂等安全。

### 3.4 桌面链路

```
AccountSecurity.vue 每行「下线」
  → memberStore.revokeSession(sessionId)
  → invoke('identitySessionsRevokeOne', { sessionId })
  → ipcMain 'identity:sessions-revoke-one'
  → memberApiHandler('/api/v1/me/sessions/revoke', 'POST', { requireSubject: true, buildBody })
  → memberApiService.request({ path, method:'POST', body:{ sessionId } })
  → 服务端
```

**`memberApiHandler` 需要新增 `buildBody` 钩子**：现有实现对 POST **写死** `body = { code }`（为激活码设计），会把 `sessionId` 丢掉。加一个可选的 `buildBody(payload)`，默认行为不变（不传仍走 `{ code }`）。

### 3.5 渲染层交互

| 元素 | 规则 |
|---|---|
| 「下线」按钮 | 每个**非当前**设备行右侧；当前设备行渲染为禁用态 + `title` 说明「当前设备不能下线」 |
| 点击 | 立即禁用该行按钮 + 文案变「下线中…」 |
| 成功 | 该行从列表消失（重新 `loadSessions`），顶部提示「已下线：<设备名>」 |
| 失败 | 保留列表，`role="alert"` 显示可读文案；按钮恢复可点 |
| 权限错误 | 复用 `resolveMemberErrorKey` 的权限语义（提示重新登录） |

**为什么成功后重拉而不是本地删行**：本地删行只是「看起来下线了」；服务端可能因并发返回 0 行。重拉以服务端为准（与 `revokeOtherSessions` 既有做法一致）。

### 3.6 文案（zh/en 成对）

| key | zh | en |
|---|---|---|
| `sessionsRevokeOne` | 下线 | Sign out |
| `sessionsRevokingOne` | 下线中… | Signing out… |
| `sessionsRevokeOneSuccess` | 已下线：{device} | Signed out: {device} |
| `sessionsRevokeCurrentForbidden` | 当前设备不能下线 | You can't sign out the current device |
| `sessionsRevokeNotFound` | 该设备已下线或不存在 | That device is already signed out |

---

## 4. 验收标准（DoD）

| # | 判据 | 取证 |
|---|---|---|
| 1 | 成功下线自己的非当前设备 → 200 + `revoked:1` | 服务端测试 |
| 2 | 下线别人的会话 → **404**（不是 403） | 服务端测试 |
| 3 | 下线当前设备 → 400 `CANNOT_REVOKE_CURRENT_DEVICE` | 服务端测试 |
| 4 | sessionId 形状不合法 → 400 `SESSION_ID_INVALID` | 服务端测试 |
| 5 | 缺 `X-Device-ID` → 400 `DEVICE_ID_REQUIRED` | 服务端测试 |
| 6 | IPC 白名单放行该路径且 body 只带 `sessionId` | 处理层测试 |
| 7 | 当前设备行按钮禁用、非当前行可点并调用 store | `AccountSecurity.test.js` |
| 8 | 成功后重拉列表、失败保留列表并提示 | `AccountSecurity.test.js` |
| 9 | zh/en 成对 + renderer 无硬编码中文 | Gate 7 四档 |

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 用户误踢自己 | 服务端 400 + UI 禁用双层防护 |
| 存在性探针 | 归属不符一律 404 |
| 并发重复点击 | UPDATE 带 `revoked_at IS NULL`，第二次 0 行；UI 按钮即时禁用 |
| 旧服务端没有该端点 | 走既有错误分支，提示「稍后重试」；不静默 |
| 白名单打穿 | 路径固定不带参数，目标 id 放 body（沿用 `revoke-others` 形态） |
