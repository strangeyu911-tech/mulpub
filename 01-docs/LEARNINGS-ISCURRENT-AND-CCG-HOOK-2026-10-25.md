# is_current 契约与 CCG 钩子差集（2026-10-25，PR #4461 已合并）

> 分支 `member-center-iscurrent` ｜ 方案依据 `01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md`（v4）P1-4 + 评审 C1-13
> 执行记录：`openspec/records/member-center-iscurrent.md`

## 一、`is_current` 会话契约（三层）

**问题**：渲染层用 `index === 0` 判「当前设备」——猜服务端返回顺序。服务端一改排序，徽章就指向别人的设备，而「退出其他设备」的安全判断依据随之出错。

**实现**：
1. 主进程 `electron/ipc-handlers/identity.js`：`memberApiHandler` 增加 `normalize` 钩子（`markCurrentSession(data, deviceId)`），`identity:sessions` 通道按 `device_id` 比对 `entitlementService.deviceId` 逐行打 `is_current`。该 deviceId 早已随 `X-Device-Id` 上行、服务端拿得到，是唯一不靠猜的做法。
2. 渲染层 `AccountSecurity.vue`：弃用 `index === 0`，改读 `session.is_current`。
3. **C1-13 边界**：全 false 是合法态（当前设备未 upsert 或不在列表）⇒ 显示「未能识别当前设备」中性态，**不回退顺序猜测**。

**三个坑（都已写进注释）**：
- **不显式传 `method`**：`memberApiHandler('/api/v1/me/sessions')` 若传 `'GET'`，payload 会多出 `method`/`body` 两个键，改变既有 IPC 响应形状（存量 `toEqual` 断言当场红）。
- **`normalize` 抛错要原样返回**：别让一个打标失败把整条读通道变成错误响应。
- **契约防御**：`sessions` 非数组时原样透传，不把契约破坏读成空列表（空列表会让 UI 说"你没有其他设备"，而真相是响应形状变了）。

## 二、CCG pre-commit 钩子差集修法（防跨会话污染）

**问题实证**：钩子把 `.ccg/reviews/` 下**盘上所有**未跟踪/已改动的判定记录 stage 进本次提交。PR #4395 夹带 3 个快照，其中 `8a221675….json` 的 sha 字段指向 `b642881c`（rebase 前的 merge-base = 他人提交）。

**实现**（`scripts/hooks/pre-commit`）：
- 门禁**之前**对未跟踪侧拍快照 → 门禁后 `comm -23` 取差集 → 只 stage 差集
- 只拍未跟踪侧：modified 侧记录已在 index，stage 它们不构成"夹带他人未提交产物"；少拍一侧也保住了 spawn 预算锁
- 快照扫描失败时**降级为全集语义并出声**，不静默降级

**四个坑**：
1. **快照必须拍在门禁之前**。拍在门禁之后 = 把门禁刚写的记录也算进基线 ⇒ 差集恒为空 ⇒ auto-stage 静默失效（文件生成了但 staged=0，钩子无任何报错）。
2. **别重复定义 `RECORD_PATHSPEC`**。`scripts/check-precommit-spawn-budget.js` 的段锚点 `startRe = /^[ \t]*RECORD_PATHSPEC=/` 要求恰好命中 1 次，重复即 `SECTION_ANCHOR_UNRESOLVED`（fail closed）。
3. **差集真实多一次 git 调用**，`recordPathspecMentions` 预算从 3 → 4。这属「改谁来守门」，必须用户裁决（本次已裁决）。
4. **候选域由 pathspec 形状决定，与"谁产生"无关**：`:(glob)*` 不跨 `/`，故 `.ccg/reviews/inner/*.json` 永不在候选域——曾误改成"门禁产生的嵌套记录也该入库"，实测失败后确认原断言才对。

## 三、测试 fixture 假绿的三种形态（教训）

1. **预置的未跟踪文件若在 base 提交时被钩子 stage 过**，就变成「受跟踪且干净」，第二轮扫不到 ⇒ 场景永远绿。解法：base 提交用 `--no-verify`，且让他人遗留记录在 base **之后**才创建。
2. **钩子对「未检测到代码文件修改」会提前跳过质量节拍检查** ⇒ 永远走不到 CCG stage 块。fixture 必须造代码文件修改（如 `apps/desktop/src/a.js`）。
3. **跑 `.git/hooks/pre-commit`（可能是旧安装版）与跑 `scripts/hooks/pre-commit`（源）结果可能不同**——验证污染复现时要跑源文件。

## 四、结果

- 钩子 scenario **50 断言全绿**（新增 scenario21：他人遗留不得夹带）
- identity IPC 19 + AccountSecurity 10 + member-center 全套 + MemberCenter + member store + ProfileMenu = **166 全绿**
- locale Gate 7 `--keys` PASS（2330 keys）
- merge SHA `c109a1c9903d6e2bd9dc8a7eeec390c03435998a`；`check-branch-merged` rc=0（lost=0；2 个 drift 归因为他人会话后续改 locale）
