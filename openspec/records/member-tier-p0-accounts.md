# member-tier-p0-accounts 执行记录

> 分支 `member-tier-p0-accounts` ｜ worktree `mp-member-tier-p0-accounts`（D 盘隔离区）
> 上游：`01-docs/MECHANISM-MEMBER-TIERS.md` v3.2 §10 P0；`01-docs/PRD-MEMBER-TIER-ACCOUNT-LIMIT-2026-10-26.md`

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 远程同步 PR #（合并后由门禁推导）

## 一、一句话

把「绑定账号数」从机制文档落成可执行门禁：`maxAccounts` 5/20/100 进矩阵与 entitlement；`account:add` / `auth:open-login` 主进程先判后加；账号页到上限点「添加账号」弹专属提示，不打开登录弹窗。

## 二、产出

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/plan-matrix.js` | 新增 `maxAccounts` 5/20/100 与 `limits.max_accounts`；`maxPlatforms` 全档 -1；`aiWriteMonthly` 全档 -1；`videoMonthly` 0/-1/-1；`maxDevices` 1/3/-1；`maxCloudAccounts` 0/20/100；`PLAN_MATRIX_VERSION` 升至 `2026-10-26` |
| `packages/api-publish-engine/src/auth/postgres-identity-repository.js` | `consumeFeature` 支持 `limit === -1`：不写 usage 表、返回 `{used:0, limit:-1, remaining:null}`；null quota 安全访问 |
| `apps/desktop/src/features/member/plan-limits.js` | 新增 `maxAccountsOf` / `canAddAccount` / `accountLimitState`；接线状态注释更新 |
| `apps/desktop/electron/ipc-handlers/account.js` | 新增 `maxAccountsLimit` / `accountLimitResponse` / `withAccountLimitLock`；`account:add` 与 `auth:open-login`（预检 + 保存前二次判据）接线；重新登录豁免 |
| `apps/desktop/electron/core/error-codes.js` | 新增 `ACCOUNT_LIMIT_EXCEEDED = -30` |
| `apps/desktop/src/features/accounts/components/AccountAddAction.vue` | 新增「添加账号」按钮 + 上限弹窗组件（避免 Accounts.vue 超过零增长目标） |
| `apps/desktop/src/views/Accounts.vue` | 接入 `AccountAddAction`；平台卡片入口复用 `open()` 判据；删除旧的内联弹窗 |
| `apps/desktop/src/locales/accounts-page/{zh,en}.js` | 新增 `accountLimitTitle/Body/Upgrade` 三条成对文案 |
| `packages/api-publish-engine/test/plan-matrix.test.js` | 更新 v3.1 矩阵断言（maxAccounts / 平台 -1 / AI -1 / 视频 -1 / 设备 1 / 云账号 100） |
| `apps/desktop/src/features/member/plan-limits.test.js` | 新增绑定账号判据 4 组；平台判据改为独立 legacy 夹具 |
| `apps/desktop/electron/ipc-handlers/account-limit.test.js` | 新增 6 例：拒绝/放行/entitlement 缺失/预检/重新登录豁免/保存前二次判据 |
| `apps/desktop/src/views/Accounts.test.js` | 新增 3 例：触顶弹窗、未触顶正常打开、查看套餐跳转 |
| `packages/api-publish-engine/test/subscription-service.test.js` | 视频上限断言 300 → -1 |
| `01-docs/PRD-MEMBER-TIER-ACCOUNT-LIMIT-2026-10-26.md` | 新增详细 PRD（数据校验/流程/逻辑/交互/显示项/提示文字/异常/验收/测试/风险） |
| `01-docs/MECHANISM-MEMBER-TIERS.md` | v3.1 → v3.2：P0 状态回写、平台轴退役、缺陷 A/K 闭环 |
| `01-docs/pricing-strategy.md` | §1/§2 矩阵同步 v3.1（绑定账号、设备 1、AI/视频 -1） |
| `01-docs/ACCESS-CONTROL-MATRIX.md` | §3.6 增补绑定账号上限的客户端硬限制说明 |

## 三、数据契约与校验

- `maxAccounts`：整数 ≥ 0，不接受 -1（三档都是有限值）；`limits.max_accounts` 随 `/api/v1/me` 与签名快照下发。
- 缺失即放行：`identityService` / `entitlement` / `limits` / `max_accounts` 缺失、空串、NaN、非数字 → 不拦。
- `-1` = 不限；`0` = 第 1 个就拒；正数按闭区间 `current >= limit` 拒。
- `listAccounts()` 抛错 → 放行 + WARN（不冒充「达到上限」）；返回非数组按 0 计。
- 并发：`withAccountLimitLock` 串行化「计数 + 保存」；`auth:open-login` 预检 + 保存前二次判据。
- 重新登录（带 `accountId`）不占新名额，不受上限影响。

## 四、测试与门禁读数

| 项 | 读数 |
|---|---|
| `packages/api-publish-engine` 全量 `npm test` | **504 passed / 47 files** |
| `postgres-identity-repository.test.js`（consumeFeature -1 新增用例） | **15 passed** |
| 受影响桌面测试（Accounts 125 + account 82 + account-limit 6 + plan-limits 13） | **226 passed / 4 files** |
| entitlement / identity store / usePlatformSelection | **66 passed / 3 files** |
| `check-locale-sync --pair-base origin/main` | **PASS** |
| `check-max-lines --base=origin/main` | **PASS（Accounts.vue 1576 ≤ 1578）** |
| `eslint`（改动文件） | **rc=0** |
| `check:ts` | 仅既有无关报错；本 PR 新增 `state.entitlement` 一处已用 `/** @type {any} */` 收口 |

## 五、QM-1（改 `apps/desktop/electron/` + 渲染层）

- 构建：`pnpm exec electron-builder --win --x64 --dir --publish never` → **rc=0**，产物 `dist-electron/win-unpacked`。
- asar 清单：`electron/ipc-handlers/account.js`、`electron/core/error-codes.js` 均在 `app.asar` 内。
- require 链：`asar extract` 后 `require('@multi-publish/rpa-engine')` → **require-chain OK**。
- 启动：`Multi-Publish.exe` 8 秒存活 **alive=true**，stderr **0 字节**（`ELECTRON_RUN_AS_NODE` 显式置空；`ELECTRON_USER_DATA_DIR` 指向临时目录）。

## 六、QM-4（视觉）

- 改动为「默认隐藏的条件态弹窗」：账号页默认视图 DOM/布局未变；未新增全局样式（样式 scoped 在 `AccountAddAction.vue`）。
- 未跑像素基线：条件态需构造 5/5 账号，默认截图不会出现；已在 UI 组件测试覆盖弹窗渲染与按钮跳转。**如需视觉基线，另开专项补条件态截图。**

## 七、QM-6（深度评审）

- 驱动：`sh scripts/deep-review.sh`，判定 `DUAL`（变更 >200 行且命中 `packages/api-publish-engine/src/auth/` 敏感路径），critic=claude / proposer=opencode。
- 轮次：3 轮 critic（7 条 → 8 条 → 8 条），最后一轮最低维度分 3。
- 裁决：`i3`（`videoMonthly = -1` 但 `consumeFeature` 拒绝 `limit < 0`）**成立并已修**：`consumeFeature` 对 `-1` 直接返回不限，不写 usage 表；补 `postgres-identity-repository.test.js` 用例。
- 其余：`i1`（`UNLIMITED_ALLOWED` 未含 videoMonthly）为假（数组本就含该键）；`i2/i6` 是评审读取自身 `status:pending` 记录产生的元发现；`i3`（“客户端硬限制”不是安全边界）与 `i4`（锁无超时）为文档术语/已有 30s 后端超时；`i5` 是 `ce9d…` 仅 .ccg 变更的 skip 记录，不代表本 PR。
- 最终代码级阻断：**0 条**；剩余为元发现/文档表述。`.adversarial/ccg-deep-*/adjudication.json` 为本地裁决留档，PR 评论补公开证据。

## 八、记忆沉淀

- 内置记忆：`~/.dsh/memory/Mulpub/member-tier-account-limit.md`（判据三条纪律 + 两个保存入口 + 串行锁 + 零增长目标）
- 外部记忆：本记录 + `PRD-MEMBER-TIER-ACCOUNT-LIMIT-2026-10-26.md` + `01-docs/learnings.md` 聚合器条目（由聚合器写入）
- EverOS：`project=mulpub` 写入 episode/atomic_fact，写入后 `everos_search` 回读哨兵词

## 九、未落地

| # | 项 | 归属 |
|---|---|---|
| 1 | 免费设备 1 的会话判据 | P1（矩阵已改值，未接线） |
| 2 | 云同步账号 0/20/100 服务端校验 | P1 |
| 3 | 批量 UI 读 entitlement、`/batch-publish` 先判后扣 | P0 剩余（独立 PR） |
| 4 | 视频/知识库/定时/自动化功能开关 | P1 |
| 5 | 官方积分 grant/consume | P1 |

## CHANGELOG 条目

# 会员绑定账号数上限落地：免费 5 / 标准 20 / 专业 100，主进程与 UI 双拦

- 新增 `maxAccounts` 与 `limits.max_accounts`，随 entitlement 下发；免费 5、标准 20、专业 100
- `account:add` 与 `auth:open-login`（新账号保存路径）在主进程先判后加；到上限返回 `ACCOUNT_LIMIT_EXCEEDED`（-30）与 `{current, limit}`；重新登录不受限
- 账号页点「添加账号」到上限时弹「账号数量已达上限」，提供「查看套餐」；不打开登录弹窗
- 并发窗口用串行锁 + 保存前二次判据兜住；计数失败/entitlement 缺失按「缺失即放行」处理
- `consumeFeature` 支持 `limit === -1` 的不限语义，避免 AI/视频 -1 配额在 P1 接线时 503
- 平台数不再分档（全档 -1）；AI 写稿全档不限次数（按积分/BYOK）；视频创作只做功能开关（0/-1/-1）；免费设备数改为 1
- 同步更新 PRD、机制文档 v3.2、pricing-strategy、ACCESS-CONTROL-MATRIX 与 6 组回归测试
