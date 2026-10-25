# member-center-iscurrent 执行记录

> 分支：`member-center-iscurrent` ｜ 方案依据：`01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`（v4）P1-4 + 评审 C1-13
> 前序：Phase 1 = PR #4395、Phase 2 = PR #4428、Phase 3 = PR #4448

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 远程同步 PR #4461

## 改动一：`is_current` 会话契约（方案 P1-4）

**问题**：渲染层用 `index === 0` 判「当前设备」，那是**猜服务端返回顺序**——服务端一旦改排序（按最近活跃等），徽章就指向别人的设备，而「退出其他设备」这个安全操作的判断依据随之出错。

**改法**（三层）：
1. 主进程 `ipc-handlers/identity.js` 新增 `markCurrentSession(data, deviceId)`：`identity:sessions` 通道经 `normalize` 钩子按 `device_id === entitlementService.deviceId` 逐行打 `is_current` 标。`entitlementService.deviceId` 早已存在且每个会员请求都带 `X-Device-Id` 上行，服务端拿得到，所以这是唯一不靠猜的做法。
2. 渲染层 `AccountSecurity.vue` 弃用 `index === 0`，改读 `session.is_current`。
3. **C1-13 边界**：全 false 是合法态（当前设备未 upsert 或不在列表）⇒ 显示「未能识别当前设备」中性态，**不回退顺序猜测**。

**契约防御**：`sessions` 不是数组时原样透传，不把契约破坏读成空列表（空列表会让 UI 说"你没有其他设备"，而真相是响应形状变了）。

**IPC 形状不变**：`identity:sessions` 不显式传 `method`（传了会让 payload 多出 `method`/`body` 两个键，改变既有响应形状——第一版就是这么打破存量用例的）。

**测试**：`electron/ipc-handlers/identity.test.js` 新增 6 例（命中打标/全 false 合法态/顺序无关/deviceId 缺失/非数组透传/其他通道不受影响）；`AccountSecurity.test.js` 新增 4 例（is_current 在哪行就标哪行/顺序翻转后跟着走/全 false 显示中性态/字段缺失不猜）。

## 改动二：CCG pre-commit 钩子的跨会话污染（用户裁决：方案 A）

**问题实证**：钩子把 `.ccg/reviews/` 下**盘上所有**未跟踪/已改动的判定记录 stage 进本次提交。实测 PR #4395 夹带了 3 个快照，其中 `.ccg/reviews/8a221675….json` 的 sha 字段指向 `b642881c`（rebase 前的 merge-base = 他人提交）——他人评审产物进了我的 PR。

**设计冲突（用户裁决）**：旧语义（scenario15/16/17/18/20 钉住）是「auto-stage 盘上全集」，为消灭 2026-10-12 实测的「300+ 未跟踪记录堆积」；新语义是「只 stage 本次门禁产生的」，防跨会话污染。二者不可兼得。用户选**方案 A**：改那 5 个既有场景的 fixture，让它们从「预置未跟踪记录」改为「mock 门禁在执行时产生记录」，与新语义一致。

**钩子实现**（`scripts/hooks/pre-commit`）：
- 门禁**之前**对未跟踪侧拍一份快照（只拍未跟踪侧：modified 侧的记录已在 index 里，把它们 stage 进本次提交不构成"夹带他人未提交产物"；少拍一侧也让 reviews 相关 git 调用保持旧版 3 次，不打穿 scenario16 的预算锁）
- 门禁跑完再扫一次，`comm -23` 取差集，只 stage 差集
- 快照扫描失败时**降级为全集语义并出声**（不静默降级，也不因快照失败丢弃全部记录）
- 有新区块时打印 `[reviews] 本次门禁新产生 N 条判定记录，纳入暂存（他人会话遗留的记录不动）`

**踩过的两个坑（都已写成注释）**：
1. 快照最初拍在门禁**之后** ⇒ 差集恒为空、auto-stage 静默失效（文件生成了但 staged=0，钩子无任何报错）。
2. scenario17 曾把「嵌套子目录排除」改成「门禁产生的嵌套记录也应入库」——实测失败后确认原断言才对：候选域由 pathspec 形状（`:(glob)*` 不跨 `/`）决定，与"谁产生"无关；要收嵌套成员得改 pathspec，那会把域扩大成旧 shell glob 的超集。

**测试**：新增 **scenario21**（他人遗留不得夹带 + 无新记录时 `.ccg/reviews` 层暂存为空）；改造 scenario15/16/17/18/20 的 fixture（mock 门禁写记录）。全套 **50 断言全绿**。

## 顺带更正的早前误记

- Phase 3 目标里写的「is_current 需核实 #4075 是否已实现」——已核实：`git grep is_current packages/` 零命中，#4075 实为「档位上限服务端硬门禁」，与 is_current 无关。本次按方案短期路径（主进程归一化）落地，不等服务端。

## CHANGELOG 条目

### 会员中心：设备列表「当前设备」改为可靠识别，并修掉提交时夹带他人评审记录的问题（member-center-iscurrent）

- 设备列表的「当前设备」标记不再依赖服务端返回顺序，改由本机设备标识逐行比对；无法识别时明确提示「未能识别当前设备」，不再猜测
- 提交时的判定记录归档只收本次产生的记录，不再把其他会话遗留的记录夹带进提交（此前已发生 3 次）
