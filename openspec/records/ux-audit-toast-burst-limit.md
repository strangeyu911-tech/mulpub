---
record: ux-audit-toast-burst-limit
task: UX 审计阶段 4.6（2026-10-19 收窄后）—— 通知连发限频
date: 2026-10-25
---

## 本次执行记录：给 toast 加连发限频，并把"礼貌级做不到"连证据一起写清（ux-audit-toast-burst-limit，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合档（渲染层行为） | 入口 `scripts/session-init.sh ux-audit-toast-burst-limit`；worktree 取径**从 `git worktree list` 读**（同族上一刀踩过"按分支名拼路径"，本刀当场改正并写进记忆）；起点 `HEAD == origin/main`，`rev-parse --abbrev-ref HEAD` == 分支名。差量文件集实测 5 个：`apps/desktop/src/utils/notify-burst.js`（新）、`apps/desktop/src/utils/notify-burst.test.js`（新，8 条）、`apps/desktop/src/composables/useNotify.js`（改）、`apps/desktop/src/composables/useNotify.burst.test.js`（新，5 条接线锁）、`scripts/toast-burst-mutate.cjs`（新，反证驱动）+ 本记录 + PRD。不触 `apps/desktop/electron/`、不触 `packages/rpa-engine/`、不触 `.github/workflows/`、不触 `scripts/check-*`、不触凭证/登录态面 ⇒ **不属 `HIGH_RISK_SURFACES`** |
| 第一性原因（QM-5 ①） | ✅ | 症状：批量类操作失败时逐条弹 toast（批量发布 N 账号各失败一次、批量采集逐条报错），N 条同质通知叠在同一位置，后面的盖住前面的 —— 用户看到的效果不是信息变多，而是**界面被自己的通知遮挡**，读屏被连续抢占。第一性落点不是某个调用方，而是共用出口 `useNotify.notify()` 的展示分支：`const show = {…}[level]; if (show) show()` —— **没有任何上限**，而 `ElMessage` 是全局堆叠的，所以"N 次调用 = N 条可见"。引入点是该出口被写成"直连宿主"的那一天（`useNotify.js` 建档时就没有节流层） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：既有 `useNotify.test.js` 12 条断言的是"level → ElMessage 方法"映射，每例只弹 1 条 ⇒ 对"N 条叠屏"完全免疫；集成/视觉层：像素判定域视图不产生批量 toast ⇒ 看不见；审查层：审计 4.6 原文把这条写成了「补 `role=status`/`aria-live`」，即**把病因归错成"没播报"而不是"播报过量"**，2026-10-19 才由实测更正（ElMessage 根节点已硬编码 `role="alert"`）。另有一条落点：`notify()` 有 20+ 调用点（`TagSuggester` / `useBatchPublish` / `useProviderCrud` / `CreatorMonitor` / `Accounts` …），任何"在调用方循环里少弹"的修法必然漏 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=**测试场景缺失**（不是质量不足）：仓里对"通知出口"只有映射正确性锁，没有任何**数量维度**的锁；而同仓早已给别的出口写了同类"叠屏/刷屏"防线（`task-queue` 的通道串行、`publish-progress` 的单一订阅面），toast 是唯一没有上限的广播面。具体落点：`apps/desktop/src/composables/useNotify.js` 的 `show` 映射 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 唯一实现 `apps/desktop/src/utils/notify-burst.js`：`BURST_WINDOW_MS=3000`（与 ElMessage 默认 duration 同量级，保证"窗口滑过"与"上一条已消失"大致同步）、`BURST_LIMIT=6`、`createBurstGuard(now)` 返回 decide；七条语义各有一条锁（见 ③）。② 接线挂在**每次 `useNotify()` 调用**（组件 setup 期一次），不是模块级全局 —— 模块级会让无关组件的通知预算互相吃掉（A 面板弹满 ⇒ B 面板的失败提示直接消失），那比叠屏更坏；**代价如实写**：两个组件同时爆发仍可能叠出 `2×limit` 条，全局条数不是本判据的域。③ 抑制分支三条硬要求：不调用 ElMessage、**日志照上报**（`reportNotify` 不被跳过 —— 抑制的是遮挡，不是"这件事没发生过"）、`console.warn` 出声并带累计抑制数（"限频生效"与"限频把通知全吞了"在用户侧完全同形，必须留可归因痕迹）；`notify()` 返回值语义不变（调用方契约不破）。④ 空文案路径（未命中 key）在限频判断**之前**返回 ⇒ 不计进窗口，否则"什么都没弹"会被算成"已经弹了 6 条"。⑤ 行为锁 **13 条**：`notify-burst.test.js` 8 条（放行上限 / 超限抑制 / 窗口滑过恢复 / 抑制不占额度 / 档位可注入 + 非法回落且出声 / 时钟回拨不绕过 / 实例隔离 / 返回形状 / 常量值域），`useNotify.burst.test.js` 5 条**接线锁走真实消费者**（本仓「注册≠注入≠生效」家族：只测纯函数会留下"判据全绿但生产调用点没接"的空间）。夹具关键一条：guard 挂在每次 `useNotify()` 调用上 ⇒ 用例间必须 `vi.resetModules()` + 动态 import，否则第 1 例填满窗口、其余测到的是"余温"，红绿与实现无关。⑥ 回归：既有 `useNotify.test.js` 12 条**全过且未改动** —— 这同时是"实例级而非模块级"那个决定的直接证据（模块级会让这套既有测试随机变红）。三套合跑 **25 passed** |
| 变异反证 | ✅ | 驱动入仓 `scripts/toast-burst-mutate.cjs`，**七刀本机实跑 `CAUGHT=7/7`**、基线趟 `rc=0 Tests 25 passed`、逐刀 md5 还原一致、收尾复跑被测套件 `rc=0`（30.9s 整轮）。B1 限频分支改恒假 → 接线锁「窗口内前 limit 条真的展示」；B2 抑制时提前 `return text` 跳过 `reportNotify` → 「抑制不等于丢事件」；B3 注释掉 `console.warn` → 「抑制必须出声」；B4 被抑制也 `stamps.push` → 「抑制不占用额度」；B5 过期判据改恒真（时钟回拨把整窗清空 ⇒ 绕过限频）→ 「时钟回拨」；B6 非法档位不再回落（`limit=0` 变全抑制，读起来像"已配置"）→ 「非法值回落默认」；B7 计数退回 `globalThis` 共享 → 「每个 guard 实例各自计数」。锚点一律单行（w/crlf 上含 `\n` 的锚点会点不中） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 判据落在**共用出口**而非调用方，`notify-burst.js` 是唯一实现，`useNotify` 是唯一接线点（新增第四个 toast 出口必须走它，否则接不到限频 —— 该形状由接线锁的行为用例守，不靠注释）；② **不读 `process.env`**：渲染端读任意 env 被 Vite 注成空对象桩（本仓产物级实测 `var x={}`），写成 env 旋钮等于造一条恒不生效的死开关 ⇒ 档位是常量 + 测试期显式入参；③ 非法值一律回落 + 出声（对齐 publish-frequency-policy / task-queue 的既有纪律）；④ 反证驱动随 PR 交付且可一行重跑 `node scripts/toast-burst-mutate.cjs`；⑤ 「礼貌级」这一半**没有假装做掉**：PRD §1 给出可重跑的宿主取证命令（`message.vue_…_lang.mjs:113` 无条件 `role:"alert"`；`message.d.ts` 里 role/aria/polite/assertive 出现 0 次），并写明两条可行路都被审计更正明文禁止（改宿主渲染 DOM = 伪造结构；再加一个 live region = 双重播报）。这一半是**宿主限制 + 组件层决策项**，不是本批遗漏 |
| Gate 7 CJK 扫描当场拦下的一处（本批自己的错，如实记） | ✅ | 第一版把抑制日志写成中文串（`'[notify] 连发限频：窗口内已满 '` 等 5 处串片段），`node .github/scripts/check-locale-sync.js --cjk` 在**提交前**当场 FAIL 并逐行点名（`useNotify.js:61` ×3、`notify-burst.js:50` ×2）。修法不是 `--update-baseline`（明文禁止掩盖新增），也不是给它开 locale 键（诊断日志不是用户可见文案，开键就是 AGENTS 禁止的死键）：改为仓库既有惯例的英文诊断（现场对照 `src` 里的 `[electron-bridge] permission error, falling back:`、`[content-categories] load failed, keeping defaults:`），并同步改掉断言中文串的两处测试与反证驱动锚点。改后 `CJK scan PASS（基线 1330 条，当前 1095 条，无新增硬编码）`，且七刀重跑仍 `CAUGHT=7/7` |
| 行尾与 diff 对账 | ✅ | 两处 CRLF 面：`useNotify.js` 的编辑与 `01-docs/UX-AUDIT-2026-10-17.md` 阶段 4.6 那一行的就地状态标注（1 删 3 增，删的就是被改写的那一行本身）。对账：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐文件相等**（`UX-AUDIT 3/1`），未整文件统一回写；新建 4 份文件为 LF。改后复跑 `check-no-brand-residue` PASS（扫描 12679 个 tracked 文件）与 `check-locale-sync --cjk` PASS（基线 1330 / 当前 1095，无新增）。未触碰 `CHANGELOG.md` / `01-docs/learnings.md` 两个热写面（台账由聚合器在发版时搬运，本批条目写在本记录的 `## CHANGELOG 条目` 小节） |
| QM-1 打包 / QM-4 视觉 | N/A | 差量不含 `apps/desktop/electron/**`、`packages/rpa-engine/**`、任何 `.vue` / `.css` ⇒ 无打包面。像素判定域视图不产生批量 toast，且本批零文案/零样式改动 ⇒ `test:visual:pixel` 输出不变。判据是文件类别而非"我觉得不影响"，如判断错误由 `QG Visual` 当场暴露 |
| QM-6 CCG 双模型外部评审 | ⏳ **判为 DUAL、外部复核未跑 ⇒ 本 PR 不自动合并** | 判定层当场实跑，两次读数都记下来（第一次是我自己差点把"没判"读成"不用判"）：`node scripts/ccg-review-decider.js --staged` 在未暂存时打印 **「⚠ 未判定：暂存区无变更，且未给 --base —— 这不是『无需审查』，是『没判』」**（rc 非零路径，判据自己拒绝出结论）；补上 `--base=origin/main` 后 **审查模式判定 = DUAL**，并落盘 `.ccg/reviews/7d5106974a1ff90a….json`。同一次跑还打印一条**敏感词告警**：「文档行命中敏感词 1 处（**不计入模式判定**，请人工确认是否真凭证）」，点名的是本记录 Gate 7 那一行的表格文字 —— 那是判据把中文表格当凭证词扫描的**假阳性**，且它明文声明不计入模式判定，故不改判据、不缩敏感词表，只在此如实转述。pre-commit 会把本次判定产物自动 stage 进提交（**不得**删除或改写它来买绿，那正是本仓「装饰性门禁」的第 N 种落点）。外部双模型评审**尚未执行** ⇒ `deepReview.status` 保持 pending，`check-pr-exec-record.js --mode=enforce` 会判「CCG 深度审查欠账 1 条」并阻断自动合并（与 #4418 / #4420 同一格、同一处置）。另两条机制事实：CI 侧 Gate 2c2 以 `--mode=advisory` 运行 ⇒ 「QG Changes 绿」不等于「QM-6 已闭合」；而本机 `scripts/ccg-gate.js` 探针找不到 `run_skill.js` 时会打印「已跳过」并返回 0，**没有产物**时 enforce 又会空洞地报 OK —— 所以本 PR 的 QM-6 资格只能由真跑外部评审取得，不得由工具沉默推定 |
| 反证驱动的 CI 接线状态（登记为待人工，不隐藏） | ⏳ | 按本仓新口径「实测 ≤ 约 30s 的反证驱动应进每次 PR」，本驱动整轮 **30.9s** 已达标，接进去是正解；但它要改 `.github/workflows/quality-gate.yml`，而 workflow 文件本身属高危面（"谁来守门"须人工过目）。因此本批**不接线**并把它登记进任务 #23 同族清单（该任务已记三个只手动跑的 `contract-mutate`）。在接线之前，这份反证的效力来源是"随 PR 交付、任何人一行命令可重跑"，不是一次性口头声明 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

## QM-6 真外部评审（critic=claude / proposer=opencode，跨家族校验通过）4 条逐条处置

跑法：`CCG_ARL_DIR=<Qoder 技能根>/adversarial-review-loop/scripts sh scripts/deep-review.sh`（默认候选路径里 `~/.claude/skills/...` 在本机不存在，必须显式指引擎目录）。判定 DUAL、变更 363 行 > 200 阈值；评审产出 9 条问题、维度最低分 4、待裁决 4 条。

| # | 级别 | 主张 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 | **Critical** | 反证驱动的归因是 `out.includes(红点名)`，而 vitest 连**通过**用例名也回显 ⇒ 归因零效力；具体到 B4（被抑制也占额度）它不会红在「抑制不占用额度」，只会把「窗口内前 limit 条放行」的 `inWindow` 顶到 7。因此记录里「实跑 CAUGHT=7/7」与提交的驱动代码不一致，反证效力存疑。另两处：收尾复跑漏了 `useNotify.burst.test.js`；汇总行把「逐刀 md5 还原」绑在收尾 rc 上 | **upheld（三条全部成立）** | ① 驱动重写 v2：只从 `×`/`FAIL` 失败行取用例名，并在开头用样例**自证解析器分得清 ✓ 与 ×**，自证不过则整轮 rc=2 拒绝出结论；② 收尾复跑覆盖三套；③ 汇总行改绑真实的 `restored` 标志；④ **先明说哪句不是真的**：v1 报的 `CAUGHT=7/7` 不可信 —— 修正归因后首跑实测 **`CAUGHT=6/7`、B4 NOT_CAUGHT**，评审预言的漏检形态原样复现；⑤ 补强而非放宽：给「抑制不占用额度」加 `expect(last.inWindow).toBe(BURST_LIMIT)` 与 `suppressedCount=50` 两条断言（正确实现 6/50、B4 变异下变 56）⇒ 现在红在该命名的用例上，重跑得 `CAUGHT=7/7`、`rc=0` |
| i2 | Warning | 「批量循环共用同一 useNotify 实例」这个核心假设没有任何锁，只在 PRD 里断言；若某调用点在循环里每次新建实例，limit 永不触发且测试全绿 —— 正是 PRD 自己点名要防的家族 | **upheld** | 新增 `it.each` 结构锁（`useBatchPublish.js` / `useProviderCrud.js` / `Accounts.vue` 每文件 `useNotify()` 调用**恰好一次**）；现场计数：三文件各 1 次，`CreatorMonitor.vue` 实测 0 次（它不走该出口，故不登记）。口径写明：这是**必要条件不是充分条件**，不得读成"已证明同实例" |
| i3 | Warning | 测试文件头注释写「guard 是模块级单例」，与实现（每次 `useNotify()` 新建）和 PRD（刻意不做全局）正面矛盾，会诱导维护者把实现改成模块级 | **upheld** | 注释就地改正为实现事实 + 一句"为什么刻意不做全局"，并说明 `vi.resetModules()` 只是无害双保险 |
| i4 | Warning | `burstGuard()` 在解析 `show` 之前扣额度：未知 level 的静默调用会占满 6 个槽位，随后真实错误 toast 被误抑制 —— 本次改动**自己引入的回归** | **upheld** | 改为"确实要展示才扣额度"：先解析 `show`，未知 level 直接 report + return（保持改动前"什么都不弹"的行为），`burstGuard()` 移到其后。补一条行为锁「未知 level 不占窗口额度」（30 次静默调用后真实 error 仍可展示） |
| — | 引擎附注 | `highRiskDomains: ["crypto"]` | **判为假阳性，不改判据** | 本批差量是 `notify-burst.js` / `useNotify.js` / 两份测试 / 一个驱动 + 三份文档，无一行密码学代码；该标签来自引擎侧高危域标签（与本矩阵的路径前缀是**两个轴**，AGENTS 已记为矩阵未覆盖的第二格）。如实登记，不据此声称"已外部复核"，也不据此加重裁决 |

**闭合状态：引擎自己判为阻断，本 PR 等人工，不得由会话买通。** 填完四条裁决后用零模型调用短路重跑（`CCG_ARL_DIR=… sh` 同级 + `node …/ccg-deep-review.js --sha eb3ac6ce…`，复用存档 critique），引擎输出：

```
♻ 复用存档 critique（9 条）+ 已填完的裁决 —— 跳过模型调用
🔴 自扮演裁决判定存在阻断项 4 条
   - [Critical] i1  high_risk_requires_external
   - [Warning]  i2/i3/i4  self_play_upheld
```

并把判定产物的 `status` 从 `self_play_pending` 改写为 **`self_play_blocked`**（该字段是**引擎写的，不是我写的** —— 本次 diff 里 `.ccg/reviews/eb3ac6ce….json` 的修改可复核）。`check-pr-exec-record.js --mode=enforce` 随之仍报「CCG 深度审查欠账 2 条」（`7d51069…status=pending`、`eb3ac6ce…status=self_play_blocked`），两者都不在闭环白名单 `{cleared, needs_revision, self_play_resolved}` 内。

**为什么 `self_play_resolved` 在这里拿不到**：四条全部 upheld，而引擎对"自扮演 + upheld"一律计阻断；i1 还额外被打了 `highRiskDomains=["crypto"]` 标签走"高危域不得自扮演豁免"。该标签本身判为**假阳性**（本批差量无一行密码学代码），但**即使摘掉它，i2-i4 的 `self_play_upheld` 仍然阻断** —— 所以不能把"不闭合"归因于那一个错标签，也不能因此去改判据。

**留给人工的两条出口（我不自行执行任一条）**：① 由人或有资格的第三方模型做**外部裁决**，引擎据此写 `tier=external` + 可核 `evidence`；② 人工确认四条处置成立后把 `status` 置为闭环值并留处置说明。本节表格即处置材料，逐条给了「主张 / 裁决 / 改了什么 / 哪条锁证明改到了」。

修后现场：三套合跑 **29 passed**（+4 条新锁）、驱动 v2 **`CAUGHT=7/7` / `rc=0`**、收尾复跑覆盖三套。

## CHANGELOG 条目

# 通知连发限频（UX 审计阶段 4.6 的可达半边）

批量操作失败时逐条弹 toast 会让 N 条同质通知叠在同一位置、后面的盖住前面的 —— 用户看到的是界面被自己的通知遮挡，读屏被连续抢占。根因在共用出口 `useNotify.notify()` 的展示分支没有任何上限（`notify()` 有 20+ 调用点，逐个改必然漏）。新增唯一实现 `apps/desktop/src/utils/notify-burst.js`（窗口 3000ms 内最多 6 条可见；被抑制不占额度；时钟回拨不能绕过；非法档位回落并出声；每实例自持状态），接线在**每次 `useNotify()` 调用**上而非模块级全局（全局预算会让无关组件的失败提示直接被吃掉），抑制分支仍然上报 notify 日志并 `console.warn` 记录累计抑制数。13 条行为锁（含 5 条走真实消费者的接线锁）+ 七刀变异反证本机 `CAUGHT=7/7`。另一半「按类型分礼貌级」**当前做不到并写明证据**：实测 ElMessage 根节点无条件 `role:"alert"`、`message.d.ts` 未暴露任何 role/aria 选项，而改宿主 DOM 或再加一个 live region 都被审计 2026-10-19 的更正明文禁止。详见 `01-docs/PRD-TOAST-BURST-LIMIT-2026-10-25.md`。
