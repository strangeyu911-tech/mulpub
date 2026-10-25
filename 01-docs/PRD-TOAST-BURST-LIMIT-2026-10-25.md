# PRD — 通知连发限频（UX 审计阶段 4.6 的可达半边）

- 变更名：`ux-audit-toast-burst-limit`
- 日期：2026-10-25
- 关联：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 4.6（含 2026-10-19 第三轮更正）、`01-docs/ARCH-notify-log-standard.md` §3.3
- 类型：渲染层行为修复（`apps/desktop/src/composables/useNotify.js` + 新纯函数模块 `apps/desktop/src/utils/notify-burst.js`），**不改 DOM 结构、不改文案、不改样式**

---

## 一、审计原文与本轮的边界

阶段 4.6 原文是「toast 容器补 `role="status"` / `aria-live`（audit-60）」，2026-10-19 已被实测更正**收窄**为：

> ElMessage 根节点已硬编码 `role="alert"`，缺的是「按类型分礼貌级」与「连发限频」，**不得**再叠加第二个 live region 造成双重播报。

本轮把收窄后的两半分别处理，且**不假装两半都做了**：

| 半 | 本轮 | 依据 |
| --- | --- | --- |
| 连发限频 | **已做** | 完全落在我们自己的通知出口（`useNotify.notify` 的 `show` 映射），宿主 API 无关 |
| 按类型分礼貌级 | **未做，且当前做不到** | 实测：`node_modules/element-plus/es/components/message/src/message.vue_vue_type_script_setup_true_lang.mjs:113` 无条件写 `role: "alert"`；`node_modules/element-plus/es/components/message/src/message.d.ts` 里 `role` / `aria` / `polite` / `assertive` **出现 0 次**（grep 实测，空即未暴露）。⇒ 宿主没给入口。两条可行路都被明文禁止：改宿主渲染后的 DOM（脆弱且等于伪造结构）、再加一个 live region（双重播报）。故这一半属**宿主限制**，需要组件层决策（自研 toast 容器或等上游支持），不在本批"顺手做掉" |

> 为什么要把"做不到"写成产品文档而不是一句 TODO：本仓反复出现"把没做的当成做了"的验收事故。这里的判据是**可读的宿主源码**，任何人可重跑上面两条 grep 复核。

---

## 二、症状与根因

**症状**：批量类操作（批量发布 N 个账号、批量采集逐条报错、批量重排）失败时**逐条**弹 toast，N 条同质通知叠在同一位置，后面的完全盖住前面的。用户看到的效果不是"信息变多"，而是**界面被自己的通知遮挡**，且读屏会被连续抢占。

**根因**：`useNotify.notify()` 的展示分支

```js
const show = { success: () => ElMessage.success(text), info: () => ElMessage.info(text), ... }[level]
if (show) show()
```

**没有任何节流/上限**，且每条都会调一次。`ElMessage` 本身是全局堆叠的，所以"N 次调用 = N 条可见"。

**为什么不能只在调用方循环里少弹**：`notify()` 有 20+ 个调用点（`TagSuggester` / `useBatchPublish` / `useProviderCrud` / `CreatorMonitor` / `Accounts` …），逐个改必然漏；判据必须落在**共用出口**（同「聚合外部搜索源的展示面必须把门禁挂在共用出口而非单个调用点」那条口径）。

---

## 三、实现

### 3.1 唯一实现：`apps/desktop/src/utils/notify-burst.js`

```
BURST_WINDOW_MS = 3000      // 与 ElMessage 默认 duration(3000) 同量级
BURST_LIMIT     = 6         // 一个窗口内最多 6 条可见
createBurstGuard(now) -> decide(opts?) -> { allow, inWindow, suppressedCount }
```

语义（每条都有对应行为锁，见 §5）：

1. 维护**窗口内已放行时刻**的队列；过期判据 `t - stamps[0] >= windowMs`，只从队首弹出。
2. `stamps.length >= limit` ⇒ `allow=false`，并累加 `suppressedCount`。
3. **被抑制不占额度**：抑制既不 push 时刻也不延长窗口，否则"没显示的东西"会把窗口钉满，表现为"限频生效后通知长期不见"。
4. **时钟回拨安全**：回拨时 `t - stamps[0]` 为负 ⇒ 一条都不弹 ⇒ 不会把整窗清空后绕过限频（NTP/休眠是真实现场）。
5. **非法档位回落 + 出声**：`limit=0` 会变成"全部抑制"、`windowMs=-1` 会变成"永不抑制"，两者读起来都像"配好了"；`Number.isInteger(v) && v > 0` 不成立即回落默认并 `console.warn` 点名是哪个档位。
6. **每个 guard 实例自持状态**：不做模块级数组，否则跨页面/跨测试串味。
7. **不读 `process.env`**：渲染端读任意 env 会被 Vite 注成空对象桩（本仓产物级实测 `var x={}`），写成 env 旋钮等于造一条恒不生效的死开关。档位生产用常量、测试用显式入参。

### 3.2 接线：`useNotify.js`

- guard 挂在**每次 `useNotify()` 调用**上（组件 setup 期一次），不是模块级全局。
  理由：① 症状来源是"一个循环里逐条弹"，这些调用共用同一实例 ⇒ 实例级足够；② 模块级会让无关组件的通知预算互相吃掉（A 面板刚弹满，B 面板的失败提示直接消失），那是比叠屏更坏的新缺陷。
  **代价如实写**：两个组件同一时刻各自爆发仍可能叠出 `2×limit` 条；"全局可见条数"不是本判据的域。
- 抑制分支三条硬要求：① **日志照上报**（`reportNotify` 不被跳过 —— 抑制的是遮挡，不是"这件事没发生过"）；② `console.warn` 出声并带累计抑制数（静默吞通知正是本条要修的同型缺陷，而"限频生效"与"限频把通知全吞了"在用户侧**完全同形**）；③ `notify()` 的返回值**仍是解析后的文案**，调用方契约不变（有测试断言返回语义）。
- 空文案路径（未命中 key、非 error 级静默）**不计进窗口**：守卫在限频判断之前，否则"什么都没弹"会被算成"已经弹了 6 条"。

---

## 四、显示项 / 提示文字 / 交互口径

| 面 | 本批变化 |
| --- | --- |
| 文案 | **零改动**，不新增 locale 键（AGENTS：不得为不存在的反馈路径建死键；抑制也没有新增任何用户可见提示） |
| 视觉 | 无 DOM/样式变化；批量失败场景下 toast 叠层从 N 条降到最多 6 条 ⇒ 像素门禁判定域不受影响（判定域视图不产生批量 toast） |
| 交互 | 抑制时界面不出现任何"还有 X 条被折叠"的徽章。这是**刻意不做**：写徽章要新增 zh/en 成对文案并新增 DOM 结构，属另一切片；且徽章一旦做就要回答"点它展开什么"，本批不越界 |
| 读屏 | 未被抑制的通知仍走 ElMessage 的 `role="alert"`（宿主现状）；被抑制的不播报，其内容仅在主进程 notify 日志可见 |
| 日志（显示项之一） | `[notify] 连发限频：窗口内已满 6 条，本轮累计抑制 N 条（level=…）`；只记计数与 level，**不记用户文案**（文案已经过 `reportNotify` 落 notify:log，双记会放大日志噪声） |

---

## 五、验证

### 5.1 行为锁（先红后绿，全部实跑）

- `apps/desktop/src/utils/notify-burst.test.js` — **8 条**：窗口内放行上限 / 超限抑制 / 窗口滑过恢复 / 抑制不占额度 / 档位可注入 + 非法回落且出声 / 时钟回拨不绕过 / 实例隔离 / 返回形状稳定 / 常量值域。
- `apps/desktop/src/composables/useNotify.burst.test.js` — **5 条接线锁**（走真实 `useNotify`，不是只测纯函数）：超限不再调用任何 ElMessage 方法 / 抑制仍上报日志 / 抑制必须出声 / 未超限时与改动前同形 / 空文案不计进窗口。夹具关键一条：guard 挂在每次 `useNotify()` 调用上，用例间用 `vi.resetModules()` + 动态 import 隔离，否则第 1 个用例填满窗口后其余测到的是"余温"，红绿与实现无关。
- 回归：既有 `useNotify.test.js` **12 条全过**（它每个用例 `useNotify()` 新建实例 ⇒ 不受新增限频影响）。这是"实例级 guard 而非模块级"这个决定的直接证据：模块级会让这套既有测试随机变红。
- 三套合跑：**25 passed**。

### 5.2 反证（`scripts/toast-burst-mutate.cjs`，七刀，本机实跑 `CAUGHT=7/7`、耗时 31s）

| 刀 | 被禁形态 | 红在哪 |
| --- | --- | --- |
| B1 | 限频分支改成恒假（判据在、行为消失） | 接线锁「窗口内前 limit 条真的展示」 |
| B2 | 抑制时提前 return，跳过日志上报 | 「抑制不等于丢事件」 |
| B3 | 注释掉 `console.warn`（静默吞） | 「抑制必须出声」 |
| B4 | 被抑制也占用额度 | 「抑制不占用额度」 |
| B5 | 过期判据改恒真 | 「时钟回拨」 |
| B6 | 非法档位不再回落 | 「非法值回落默认」 |
| B7 | 计数退回模块级全局共享 | 「每个 guard 实例各自计数」 |

每刀 `finally` 还原并**逐刀 md5 比对**，驱动最后再复跑一次被测套件确认还原为绿。

### 5.3 该驱动今天在 CI 里跑不跑？

**不跑，且原因写在这里而不是藏起来**：把它接进 `quality-gate.yml` 需要改 workflow 文件本身 —— 那属"谁来守门"，按 AGENTS 必须人工过目。实测整轮 31s，符合本仓新口径「秒级反证应进每次 PR」，因此**已登记为待人工接线项**（任务 #23 同族）。在接进去之前，这份反证的效力来源是"随 PR 交付、任何人可 `node scripts/toast-burst-mutate.cjs` 重跑"，不是一次性口头声明。

---

## 六、验收标准

- AC1 三套 vitest 合跑 25 passed，且既有 `useNotify.test.js` 无回归。
- AC2 `node scripts/toast-burst-mutate.cjs` 输出 `CAUGHT=7/7`、`rc=0`。
- AC3 抑制分支同时满足：不调用 ElMessage、调用 `reportNotify`、`console.warn` 出声、返回值不变。
- AC4 无新增 locale 键、无 `.vue`/CSS 改动 ⇒ `classify-docs-only=false`（含代码）但 QM-1 / QM-4 不适用。
- AC5 远程：PR CI 的 required checks 全绿后按 AGENTS「PR 自动合并」squash 合入（本批不触 `.github/workflows/`、不触 `scripts/check-*`、不触凭证/登录态面 ⇒ 不属高危面）。

## 七、残余风险

1. **礼貌级仍未解决**（§1 表第二行）：所有通知仍是 `assertive`，读屏会打断用户当前操作。本批只把"叠屏"这一半收敛。
2. **全局条数不设上限**：多组件同时爆发仍可能叠出 `2×limit`；实例级隔离是刻意取舍。
3. 抑制对用户**不可见**（无徽章、无汇总）。若将来要做徽章，必须同批补 zh/en 文案并回答"点它展开什么"。
4. `BURST_LIMIT=6` / `WINDOW=3000` 是工程判断值，非实测分布推导；本仓没有 toast 频次的现场数据。若上线后观察到正常批量流程被误抑制，正解是**提高 limit 并同批改本 PRD 的理由**，而不是给调用方开旁路。
