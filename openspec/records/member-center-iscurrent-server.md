# member-center-iscurrent-server 执行记录

> 分支：`member-center-iscurrent-server` ｜ 方案依据 `01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`（v4）P1-4
> 前序：PR #4461（is_current 主进程打标 + CCG 钩子差集）

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 远程同步 PR #4470

## 背景

PR #4461 落地的是「主进程按 X-Device-Id 比对打 `is_current`」——那是在**服务端没有该字段**时的短期路径。本次把真源收敛到服务端：`/api/v1/me/sessions` 自己下发 `is_current`，主进程降级为兜底。

## 改动一：服务端原生下发 `is_current`

`packages/api-publish-engine/src/publish-api-server.js` 的 sessions handler：

```js
const currentDeviceId = this._deviceIdFrom(req);
const sessions = (await commerceRepository.listActiveSessions(userId)).map((row) => ({
  ...row,
  is_current: currentDeviceId !== null && row.device_id === currentDeviceId,
}));
```

三态语义（与主进程兜底、渲染层中性态三方一致）：
- **命中** ⇒ 恰好一行 `true`
- **无头 / 未知设备** ⇒ 全 `false`（合法态，渲染层显示「未能识别当前设备」，不回退顺序猜测，C1-13）
- `_deviceIdFrom` 已带 `^[A-Za-z0-9._:-]{16,128}$` 校验，复用即可，不另立正则

## 改动二：主进程降级为兜底打标者

`apps/desktop/electron/ipc-handlers/identity.js` 的 `markCurrentSession`：

- 行上**已有** `is_current`（布尔）⇒ 原样采用。服务端是真源——它看到了本地不知道的会话事实；**包括「服务端说全 false」**，此时不得因本地能比对上就改判
- 行上**没有**该字段（旧服务端 / 异常响应）⇒ 本地按 `device_id` 比对 `entitlementService.deviceId` 补标

这样真源收敛到服务端，同时保留对旧服务端的兼容（灰度期间新旧服务端混跑不会错）。

## 改动三：测试

**服务端**（`test/member-commerce-api.test.js`）：新增 is_current 三态断言（命中 / 无头 / 未知设备）。fixture 的 `listActiveSessions` 从 1 行改 2 行——第二行 `device-short`（11 字符，永不过服务端 16-128 正则）用来证明「只标一行」而非「全标」。

**主进程**（`electron/ipc-handlers/identity.test.js`）：新增 4 例（服务端已给就采用 / 服务端全 false 不改判 / 无字段则本地兜底 / 混合形态只补缺失的）。

## 踩坑（都已写成注释或记录）

1. **测试 helper 的 `body` 参数传 `{}` 会让 GET 请求带 body** ⇒ Node 服务端对这种畸形请求回 `400` + 仅 `connection: close` 头（`clientError` 兜底），而服务端 access log 里**完全没有这次请求**——两侧对数才发现请求从未进入 handler。GET 必须传 `null`。
2. **CRLF 文件用 Node 脚本替换时锚点会匹配不上**（`edit` 工具静默失败、`includes` 也 false），需先把 `\r\n` 归一成 `\n` 再替换、写完再转回。AGENTS.md 10.9 的「工具修改静默失败」再次应验。
3. **共享根直接改 `packages/` 下受管文件会被还原**（本次第一次尝试即如此，`git status` 显示无改动）。运行时代码必须进 worktree。
4. **为压行数把分支并入 `else if` 链会丢掉 `return`**，造成响应重复写（`ERR_HTTP_HEADERS_SENT`，测试当场红）。这是「为过门禁破坏逻辑」的反面教材——压不动就说明那是合理下限，应走门禁给出的另一条路（说明理由后上调）。
5. worktree 里 `node --test test/` 有 42 个文件失败，A/B（stash 后重跑）证明基线同样全失败——是环境问题（非本次改动）；`verify-worktree-deps.js` 通过，最终以 CI 读数为准。
6. `check-max-lines.test.js` 的 `not ok 36`（core.excludesFile 改域）是存量失败，A/B 证实与本次无关（基线同一条失败且更多）。

## 行数门禁目标上调（用户裁决）

`publish-api-server.js` 被 `check-max-lines.js` 的 **targets** 点名（零增长容差），本 PR 使其从 1580 → 1582 行（净增 2），触发 `TARGET_GREW`。

**已尝试压到 1580 但失败**：把 sessions 分支并入 `else if` 链可少 2 行，却丢掉 `return` ⇒ 穿透到 revoke 分支重复写响应（`ERR_HTTP_HEADERS_SENT`，测试当场红）。证明 2 行是该逻辑的合理下限。

**经用户裁决**：targets 1580 → **1590**，理由写入 `max-lines-baseline.json` 顶部注释（沿用该文件既有的「【日期 上调理由】」惯例）：is_current 服务端打标是方案 P1-4 的必要收口；真源收敛后主进程与渲染层不再各自打标/猜顺序，总体复杂度下降。`register.files` 侧起点不同（1356），本 PR 未触碰其上限，故**不同步**上调。

## CHANGELOG 条目

### 会员中心：设备「当前设备」标记改由服务端下发，客户端降级为兜底（member-center-iscurrent-server）

- 「当前设备」的权威判断移到服务端（按请求携带的设备标识逐行比对后随列表下发），主进程不再主动改写，只在服务端未提供该字段时兜底补标
- 三种情况的行为不变：能识别时标出唯一一行；识别不出时提示「未能识别当前设备」；服务端与本地判断不一致时以服务端为准
