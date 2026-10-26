# PRD — 会员绑定账号数上限（P0，v3.1）

> **状态**：🟢 已实现（2026-10-26）
> **范围**：`apps/desktop` 账号管理（主进程 IPC + 渲染层）
> **上游机制**：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.2 §4.1/§7/§10
> **数值真源**：`packages/api-publish-engine/src/auth/plan-matrix.js`（`PLAN_MATRIX_VERSION = 2026-10-25`）
> **执行记录**：`openspec/records/member-tier-p0-accounts.md`

---

## 1. 背景与目标

### 1.1 背景

会员档位机制 v3.1 把「主计量轴」从平台数迁到**绑定账号数**：免费 5 / 标准 20 / 专业 100。此前 `plan-matrix.js` 只有 `maxPlatforms`，没有 `maxAccounts`；`account:add` 也没有任何档位校验，免费用户可以无限添加账号。平台数上限本身还是死代码（服务端判据收到数组 → `NaN` → 永不拦），因此「5 个账号」必须重新做成一条**客户端可执行**的判据。

### 1.2 目标

1. 在 `plan-matrix.js` 增加 `maxAccounts`（5/20/100），随 entitlement `limits.max_accounts` 下发。
2. 主进程 `account:add` 与 `auth:open-login`（新账号保存路径）在达到上限时拒绝，返回专属错误码与 `{current, limit}`。
3. 账号页点「添加账号」时，若已达上限，不打开登录弹窗，改弹「账号数量已达上限」提示，并提供「查看套餐」入口。
4. 重新登录（带 `accountId`）不占新名额，不受上限影响。
5. 同步把 `maxPlatforms` 全档设为 `-1`（平台不再分档）、`aiWriteMonthly` 全档 `-1`（AI 写稿不限次数）、`videoMonthly` 标准/专业 `-1`（视频只做功能开关）、免费设备数改 1。

### 1.3 非目标

- 不做服务端账号数校验（本地账号库不在服务端；账号上限是**商业约束**，不是安全边界）。
- 不做每日发布条数硬限（见机制文档 D5）。
- 不做账号加购包（D13）。
- 不做团队席位/多用户（D1）。
- 不做云端账号恢复时的配额裁剪（`maxCloudAccounts` 仍只下发，P1 接线）。

---

## 2. 术语与真源

| 术语 | 含义 |
|---|---|
| 绑定账号 | 用户在本机账号库中添加的平台账号（`/api/accounts` 返回的行）；一个平台可以有多个账号 |
| `maxAccounts` | 档位允许的**绑定账号总数**上限；不是平台数，也不是云同步账号数 |
| `limits.max_accounts` | entitlement 下发给客户端的数值键；缺失/非法 = 无信息（放行），`-1` = 不限 |
| 客户端硬限制 | 主进程 IPC + UI 双重拦截；换设备/改本地库可绕过，不冒充服务端强制 |

**数值真源**：`plan-matrix.js` 的 `BASE_MATRIX.free/standard/pro.maxAccounts`。客户端不得硬编码 5/20/100；UI 文案里的数字来自 `identityStore.entitlement.limits.max_accounts`。

---

## 3. 数据契约

### 3.1 矩阵字段

| 字段 | free | standard | pro | 校验 |
|---|---:|---:|---:|---|
| `maxAccounts` | 5 | 20 | 100 | 整数 ≥ 0；不接受 `-1`（三档都是有限值） |
| `maxPlatforms` | -1 | -1 | -1 | `-1` 在白名单内；平台轴退役 |
| `maxCloudAccounts` | 0 | 20 | 100 | 0 = 不提供；整数 |
| `maxDevices` | 1 | 3 | -1 | `-1` = 不限 |
| `aiWriteMonthly` | -1 | -1 | -1 | `-1` = 不限次数 |
| `videoMonthly` | 0 | -1 | -1 | 0 = 视频不提供；`-1` = 可用且不限条数 |

### 3.2 entitlement 下发形状

```json
{
  "plan": "free",
  "features": ["cloud_publish", "ai_write", "official_credit"],
  "quota": { "cloud_publish_monthly": 150, "ai_write_monthly": -1, "video_create_monthly": 0, "official_credit_monthly": 30 },
  "limits": {
    "max_platforms": -1,
    "daily_publish": 5,
    "concurrent_tasks": 1,
    "max_devices": 1,
    "max_accounts": 5,
    "max_cloud_accounts": 0,
    "batch_size_per_run": 1,
    "model_tier": 0,
    "plan_rank": 0
  }
}
```

> `daily_publish` 仍保留为内部防失控阈值，**不作为套餐卖点，也不做每日发布硬限**。

### 3.3 错误码

| 错误码 | 值 | 使用场景 | 返回 |
|---|---:|---|---|
| `ACCOUNT_LIMIT_EXCEEDED` | -30 | 绑定账号数达到档位上限 | `{ code: -30, errorCode: 'ACCOUNT_LIMIT_EXCEEDED', message, data: { current, limit } }` |

`data.current` 是当前已绑定数，`data.limit` 是本档上限；UI 只用这两个数填文案，不解析 `message`。

---

## 4. 数据校验

### 4.1 主进程判据（`accountLimitResponse`）

| 输入 | 处理 | 理由 |
|---|---|---|
| `identityService` 缺失 / 无 `getState` | 放行 | 身份未启用（兼容模式）不得误拦 |
| `entitlement` 为 null | 放行 | 快照未就绪；`addAccount` 本身会失败并报真实错误 |
| `limits` 缺失 / 非对象 | 放行 | 缺失即放行，避免字段漂移把付费用户整片拦死 |
| `max_accounts` 缺失 / null / `''` | 放行 | 同上 |
| `max_accounts = -1` | 放行 | 不限 |
| `max_accounts = 0` | 第 1 个就拒 | 0 是合法「本档不提供」，不是缺失 |
| `max_accounts` 为正整数 | `current >= limit` 时拒 | 边界闭区间：5/5 拒，4/5 放 |
| `max_accounts` 为数字字符串 `'5'` | 按 5 判 | 兼容 JSON / 环境变量来源 |
| `max_accounts = NaN` / 非数字 / 负数（非 -1） | 放行 | 非法值不产生比服务端更严的限制 |
| `AccountManager.listAccounts()` 抛错 | 放行 + WARN 日志 | 计数失败不得冒充「达到上限」；新增本身也会失败并报真实原因 |
| `listAccounts()` 返回非数组 | 按 0 计 | 防御后端异常形状 |
| 两个登录窗口并发 | 串行锁 `withAccountLimitLock` | 预检通过 ≠ 保存时仍通过；保存前二次判据在锁内执行 |

### 4.2 渲染层判据（`accountLimitState`）

| 输入 | 处理 |
|---|---|
| `entitlement` / `limits` 缺失 | `limit: null, atLimit: false`（放行） |
| `max_accounts = -1` | `limit: null, atLimit: false` |
| `currentCount` 非有限数 | 按 0 计，不拦截 |
| `currentCount` 数字字符串 | 按数值判 |
| `current >= limit` | `atLimit: true` |

> 判据本体在 `apps/desktop/src/features/member/plan-limits.js`，纯函数、可单测；UI 不自己写一套 `>=`。

---

## 5. 功能逻辑

### 5.1 新增账号（账号页 → 登录弹窗 → 保存）

```
用户点「添加账号」
  → 渲染层 accountLimitState(entitlement, totalAccounts)
      ├─ atLimit=true → 打开「账号数量已达上限」弹窗（不打开登录弹窗）
      └─ atLimit=false → 打开 AccountLoginDialog
            → 选平台/登录方式 → submit
            → IPC auth:open-login { platform }
                 ① 校验登录用户（getOwnerSubject）
                 ② 校验 platform
                 ③ 新账号预检 accountLimitResponse('auth:open-login')
                      ├─ 拒绝 → 返回 -30，不打开登录页
                      └─ 通过 → authViewManager.openLogin(platform)
                 ④ 登录成功/取消/超时分支
                 ⑤ 新账号保存前：withAccountLimitLock
                      ├─ 二次判据拒绝 → 返回 -30，不保存
                      └─ 通过 → AccountManager.saveCapturedAccount()
                 ⑥ 广播 auth:completed，刷新账号列表
```

### 5.2 重新登录（已有账号）

`auth:open-login` 带 `accountId` 时走 `updateCapturedAccount`，**不创建新账号、不占新名额**，因此不受 `maxAccounts` 限制。即使当前账号数已超上限（降级后），仍允许重新登录已有账号，保证「不能新增但能修复已有账号」。

### 5.3 旧通道 `account:add`

仍保留，供旧调用方使用；同样在 `withAccountLimitLock` 内先判后加。新 UI 不再走这条通道，但主进程不能假设调用方一定走新通道。

### 5.4 串行锁

`withAccountLimitLock(fn)` 是模块级 Promise 链：同一时刻只允许一个「计数 + 新增」走完。它只包住「判据 + 保存」，不包住用户登录等待（否则一个用户打开登录页会把所有人锁死）。保存前二次判据解决「预检通过后别人加满」的竞态。

---

## 6. 交互逻辑

### 6.1 账号页主按钮

- 位置：账号页顶部操作区，`data-testid="account-add"`，文案「添加账号」。
- 点击：
  - 未达上限 → 打开 `AccountLoginDialog`（原有行为）。
  - 已达上限 → 打开 `UiModal`「账号数量已达上限」，不打开登录弹窗，不触发任何登录 IPC。
- 按钮**不置灰**：用户需要看到「为什么不能加」和升级入口；置灰会让用户以为按钮坏了。

### 6.2 平台卡片「添加」入口

`addAccountForPlatform(platform)` 同样先判 `accountLimit.atLimit`；达到上限时弹同一个上限弹窗，不预填平台、不打开登录弹窗。

### 6.3 上限弹窗

| 元素 | 内容 | 行为 |
|---|---|---|
| 标题 | 「账号数量已达上限」 | — |
| 正文 | 「当前套餐最多绑定 {limit} 个账号（已绑定 {current} 个）。升级后可绑定更多账号。」 | 数字来自 `accountLimit` |
| 次按钮 | 「取消」 | 关闭弹窗 |
| 主按钮 | 「查看套餐」 | 关闭弹窗并 `router.push('/member-center?section=subscription')` |
| 关闭方式 | 右上角 × / Esc / 遮罩 | 关闭弹窗 |

### 6.4 会员中心跳转

统一跳 `/member-center?section=subscription`（订阅与方案）。不新开窗口，不弹第二个升级 modal。

---

## 7. 显示项

| 位置 | 显示项 | 数据来源 | 备注 |
|---|---|---|---|
| 账号页顶部 | 「添加账号」按钮 | 静态文案 | 不显示 N/M，避免页面噪音 |
| 上限弹窗 | 当前已绑定 / 本档上限 | `limits.max_accounts` + `accountStore.accounts.length` | 例：5/5 |
| 上限弹窗 | 升级后可绑定数 | 文案不写死具体档位数字 | 避免「标准 20 / 专业 100」随运营改配漂移 |
| 主进程错误 | `data.current` / `data.limit` | `AccountManager.listAccounts()` + entitlement | 供其它调用方/日志使用 |

> 不在账号列表页常驻显示「已用 3/5」：本期只做触顶提示；常驻配额条放 P1 会员中心用量页统一做。

---

## 8. 提示文字

### 8.1 渲染层（zh/en 成对）

| key | zh | en |
|---|---|---|
| `accountsPage.accountLimitTitle` | 账号数量已达上限 | Account limit reached |
| `accountsPage.accountLimitBody` | 当前套餐最多绑定 {limit} 个账号（已绑定 {current} 个）。升级后可绑定更多账号。 | Your plan allows up to {limit} accounts ({current} currently bound). Upgrade to add more. |
| `accountsPage.accountLimitUpgrade` | 查看套餐 | View plans |
| `accountsPage.cancel` | 取消 | Cancel |

### 8.2 主进程错误 message

```
当前套餐最多绑定 {limit} 个账号（已绑定 {current} 个），请升级后重试
```

> 主进程 message 只作为兜底/日志；UI 正常路径用 `errorCode` + 本地化文案，不直接展示中文 message。

### 8.3 日志

| 事件 | level | 字段 |
|---|---|---|
| `account:add` 触顶 | WARN | `channel=account:add stage=account-limit current=5 limit=5` |
| `auth:open-login` 预检触顶 | WARN | `channel=auth:open-login stage=account-limit current=5 limit=5` |
| `auth:open-login` 保存前触顶 | WARN | 同上 |
| 计数失败 | WARN | `stage=limit-check-skipped message=...` |

---

## 9. 异常与边界

| 场景 | 行为 |
|---|---|
| 后端不可用，`listAccounts` 抛错 | 放行判据，让 `addAccount` 报真实错误；日志 WARN，不返回「达到上限」 |
| entitlement 快照未就绪 | 放行；不阻塞正常用户 |
| 用户已超限（降级/运营改配） | 保留已有账号，不能新增；重新登录已有账号不受限；UI 触顶弹窗 |
| 同一账号重复添加 | 原有「此账号已添加过」逻辑优先；上限判据在保存前执行，重复账号不会占新名额（由 AccountManager 去重） |
| 两个登录窗口并发 | 串行锁 + 保存前二次判据；第二个窗口返回 -30，不保存 |
| 用户打开登录页后取消 | 原有 cancelled 分支，不触发保存、不占名额 |
| `max_accounts = 0` | 第 1 个就拒（当前三档都不是 0，但判据支持） |
| 账号数刚好等于上限 | 拒（闭区间 `current >= limit`） |
| 账号数超过上限 | 拒；不自动删除多余账号 |
| 设备数（免费 1） | 本期只改矩阵值，不接线；P1 做会话数判据。不要在本 PR 宣称「免费只能登 1 台已生效」 |

---

## 10. 兼容与迁移

- **无数据库迁移**：`maxAccounts` 只进 JSONB entitlement payload 与 `limits`，向后兼容。
- **旧快照**：没有 `max_accounts` 的旧快照按「缺失即放行」处理；用户下次 `sync()` 后自动获得新字段。
- **旧客户端**：不读 `max_accounts`，行为不变；新客户端才拦截。服务端不需要版本协商。
- **存量超限用户**：不删除、不锁定已有账号；只阻止新增。客服话术：「已有账号可继续使用，新增需升级或删除多余账号」。
- **平台轴退役**：`maxPlatforms` 全档 `-1`，旧客户端若仍读该字段会看到「不限」；发布页平台选择不再提示第 6 个平台。该行为是产品决策，不是 bug。

---

## 11. 验收标准

- [ ] `plan-matrix` 三档 `maxAccounts` = 5/20/100；`limits.max_accounts` 随 `/api/v1/me` 与签名快照下发。
- [ ] 免费用户已绑定 5 个账号时，`account:add` 返回 `-30 / ACCOUNT_LIMIT_EXCEEDED / {current:5, limit:5}`，且 `AccountManager.addAccount` 未被调用。
- [ ] 免费用户已绑定 4 个账号时，`account:add` 正常放行。
- [ ] 免费用户已绑定 5 个账号时，`auth:open-login` 不打开登录页，返回 -30。
- [ ] 重新登录（带 `accountId`）在 5/5 时仍放行，且走 `updateCapturedAccount`。
- [ ] 打开登录页后账号被另一窗口加满，保存前二次判据返回 -30，`saveCapturedAccount` 未被调用。
- [ ] entitlement 缺失时放行，不误拦。
- [ ] 账号页点「添加账号」：5/5 时弹「账号数量已达上限」，不打开登录弹窗；4/5 时正常打开。
- [ ] 上限弹窗「查看套餐」跳 `/member-center?section=subscription`。
- [ ] 中英文案成对，`check-locale-sync` 通过。
- [ ] `maxPlatforms` 全档 `-1`；`aiWriteMonthly` 全档 `-1`；`videoMonthly` 0/-1/-1；`maxDevices` 1/3/-1；`maxCloudAccounts` 0/20/100。
- [ ] 定向测试全绿；QM-1 打包与启动验证通过。

---

## 12. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| 矩阵契约 | `packages/api-publish-engine/test/plan-matrix.test.js` | maxAccounts 5/20/100；maxPlatforms -1；aiWrite -1；video -1；devices 1/3/-1；cloud 0/20/100 |
| 客户端纯函数 | `apps/desktop/src/features/member/plan-limits.test.js` | maxAccountsOf / canAddAccount / accountLimitState；缺失即放行；-1；数字字符串；边界 |
| 主进程 IPC | `apps/desktop/electron/ipc-handlers/account-limit.test.js` | account:add 拒绝/放行/entitlement 缺失；auth:open-login 预检、重新登录豁免、保存前二次判据 |
| 渲染层 | `apps/desktop/src/views/Accounts.test.js` | 触顶弹窗、未触顶正常打开、查看套餐跳转 |
| 既有回归 | `account.test.js` / `Accounts.test.js` / `plan-matrix.test.js` | 原 82 / 125 / 22 例不得回归 |

---

## 13. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 账号上限被绕过（换设备/改本地库） | 免费用户可超限 | 接受为商业约束；不做防破解；监控异常账号数 |
| 旧快照无 `max_accounts` | 老用户暂时不拦 | 缺失即放行；下次 sync 自动生效 |
| `listAccounts` 慢/失败 | 新增账号变慢或误判 | 失败放行；不阻塞；日志 WARN |
| 并发窗口绕过 | 两个窗口各加一个 | 串行锁 + 保存前二次判据 |
| 平台轴退役引发老用户困惑 | 免费用户突然能用全部平台 | 产品决策；发版说明写清「平台不再分档，账号数成为主计量」 |
| 回滚 | — | 回滚本 PR 即可；矩阵字段向后兼容，无迁移 |

---

## 14. 未落地 / 后续

| # | 项 | 归属 |
|---|---|---|
| 1 | 免费设备数 1 的会话判据 | P1（`maxDevices` 已改值，未接线） |
| 2 | 云同步账号 0/20/100 的服务端校验 | P1 |
| 3 | 账号页常驻「已用 N/M」配额条 | P1（会员中心用量页统一） |
| 4 | 视频/知识库/定时/自动化功能开关 | P1 |
| 5 | 官方积分 grant/consume | P1 |
| 6 | 批量 UI 读 entitlement、`/batch-publish` 先判后扣 | P0 剩余（独立 PR） |
| 7 | 发布页「添加账号」tab 流的 UI 预检 | P2（当前 tab 流只做重新登录，不创建新账号） |

---

## 附录：代码索引

| 结论 | 文件 |
|---|---|
| 矩阵字段 | `packages/api-publish-engine/src/auth/plan-matrix.js` |
| entitlement 透传 | `apps/desktop/electron/services/identity/entitlement-service.js` |
| 客户端纯函数 | `apps/desktop/src/features/member/plan-limits.js` |
| 主进程判据 | `apps/desktop/electron/ipc-handlers/account.js`（`maxAccountsLimit` / `accountLimitResponse` / `withAccountLimitLock`） |
| 错误码 | `apps/desktop/electron/core/error-codes.js`（`ACCOUNT_LIMIT_EXCEEDED: -30`） |
| 账号页交互 | `apps/desktop/src/views/Accounts.vue`（`accountLimit` / `openAddDialog` / `goUpgrade` / 上限 `UiModal`） |
| 文案 | `apps/desktop/src/locales/accounts-page/{zh,en}.js` |
