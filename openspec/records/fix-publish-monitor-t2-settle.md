---
record: fix-publish-monitor-t2-settle
task: 修 publish-monitor 测试 T2 的「等待条件弱于断言条件」竞态——慢 CI runner 上假红
date: 2026-10-25
---

## 本次执行记录：publish-monitor T2 的等待条件与断言条件对齐（fix-publish-monitor-t2-settle，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **测试文件变更**（非运行时代码）⇒ 仍按隔离 worktree 落地：worktree `/workspace/mp-fix`，裸分支 `fix/publish-monitor-t2-settle`，基线 `origin/main` = `9bdc5e7ca`（#4403 的合并提交）|
| 第一性原因（QM-5 ①） | ✅ | **等待条件弱于断言条件**：T2 等「第二跳已发出」（`requests.length >= 2`），却断言「回调已发生」（`callback.mock.calls[0][0].status`）|
| 逃逸分析（QM-5 ②） | ✅ | 逃逸路径已定位到**两跳的时序差**：`requests.push()` 发生在**服务端收到请求**那一刻（测试用回显 HTTP server），而回调发生在**客户端把响应读回并判定之后**（`publish-monitor.js:66`）⇒ 两者之间隔着一次真实 HTTP 往返 |
| 修复 + 回归保护（QM-5 ④） | ✅ | settle 谓词改成 `requests.length >= 2 && callback.mock.calls.length > 0` ⇒ 与断言同源；断言**一字未放宽**（见 §2）|
| 防止再次发生（QM-5 ⑤） | ✅ | 注释里写明「为什么等 requests 不够」与「为什么不能改成固定 sleep」；口径与同文件 T1 / T7 既有写法对齐（等 callback）|
| 行尾与 diff 对账 | ✅ | 见 §3 |
| 接线棘轮 | N/A | **未新增** `*.test.js`（改的是既有测试文件）⇒ 无「新增测试没被 workflow 点名」的洞 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无 `src/` 或 `electron/` 运行时代码改动）|
| QM-6 CCG 双模型外部评审 | ⛳ **未执行** | 本机无 `codeagent-wrapper` ⇒ 如实写「未执行」，**不以自审冒充通过**。本次是单文件、单行的测试判据修正，评审面窄但仍缺一道外部眼睛，记为遗留 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）|

### 遗留（不假装已闭合）

- **QM-6 外部双家族评审未执行**（本机无 `codeagent-wrapper`）。
- **本 PR 不修「这轮 CI 为什么红」的另一半**：主干上 `b5d69517`（#4393 的合并提交）的 `Electron CI` 因这条测试红了，
  而**同一次 run 的第二趟（分片并行那趟）10477/10477 全绿** ⇒ 已判定是**既有 flake**、不是本次合并引入的回归
  （#4393 及其后 5 个合并都没有碰 `apps/desktop/electron/services/` 下的任何文件）。
  ⇒ 主干那一版仍然带着一条红行，需要**另一次合并**把本修复带上去才能消掉；
  本 PR 自身合并后，主干 tip 的 `electron-tests` 才是绿的。
- 本 PR **不直接编辑** `CHANGELOG.md` / `01-docs/learnings.md`（台账由 `scripts/aggregate-changelog.js` 在发版时搬运）。

## 1. 现场（可重取）

- 主干合并提交 `b5d6951718e4f4000cffc48e117007a306e6541a`（#4393）的 `Electron CI` run **40159383516** 红。
- 红的是作业 `electron-tests`，步骤 `Unit tests (Vitest, non-Electron, single-worker deterministic)`。
- 日志里 vitest 的摘要（run 40159383516 的 job 121067613122 的 log）：

```
⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯
 FAIL  electron/services/publish-monitor.test.js > publish-monitor — B 站专用分派的装配锁 > T2 pollUrl 真的是列表端点来源：改 CHECK_URLS 的 bilibili
TypeError: Cannot read properties of undefined (reading '0')
 ❯ electron/services/publish-monitor.test.js:118:36
  118|       expect(callback.mock.calls[0][0].status).toBe('published')
 Test Files  1 failed | 586 passed | 2 skipped (589)
      Tests  1 failed | 10029 passed | 15 skipped (10045)
```

- **同一次 run 的第二趟（分片并行那趟）全绿**：`Test Files 588 passed | 1 skipped (589)` / `Tests 10477 passed | 4 skipped (10481)`
  ⇒ **同一个提交、同一个测试文件，一趟红一趟绿** ⇒ 竞态，不是确定性回归。
- ⚠️ **读日志的一个坑**：vitest 的**测试自打印**（`stdout | …` 块里的 `✓` / `✗`）与 vitest **reporter 的通过/失败标记长得一样**。
  本次差点把「测试自打印的 `✗`（它在断言「扫描失败时要保留字段详情」，那个 `✗` 是**预期输出**）」当成真失败。
  ⇒ **判真失败只看 reporter 的 `FAIL` / `⎯ Failed Tests` 块与摘要行**（`Test Files N failed | …`）。

## 2. 根因与修法

**同文件的三种等待口径**（改动前）：

| 用例 | 等待条件 | 断言条件 | 是否同源 |
|---|---|---|---|
| T1（`:89`）| `callback.mock.calls.length > 0` | `callback.mock.calls[0][0].status` | ✅ 同源 |
| **T2（`:115`）** | **`requests.length >= 2`** | **`callback.mock.calls[0][0].status`** | ❌ **不同源** |
| T3（`:133`/`:135`）| 先 `requests.length >= 2`，**再** `callback.mock.calls.length > 0` | `callback.mock.calls[0][0].status` | ✅ 同源（两次等待）|
| T6（`:170`）| `negativeWindow(100)`（显式上界）| 断言回调**不**发生 | ✅ 同源（负向结论只能给上界）|
| T7（`:183`）| `requests.some(…) && callback.mock.calls.length > 0` | `callback.mock.calls[0][0].status` | ✅ 同源 |

⇒ **只有 T2 一处是「等 A、断言 B」**。

**为什么「等第二跳发出」不够**：
- `requests.push(...)` 写在**测试自己的回显 HTTP server** 的请求回调里 ⇒ 它在**服务端收到第二跳**时就 +1；
- 而被测实现 `publish-monitor.js` 的回调在 `await checkPublishStatus(...)` **返回之后**才触发（`:66`）
  ⇒ 两者之间隔着**一次真实 HTTP 往返 + 一次响应解析**；
- ⇒ 慢 runner 上，`settle` 在第二跳刚到服务端时就放行 ⇒ 紧接着的 `task.stop()` 把轮询掐掉
  ⇒ **回调永远不会发生** ⇒ `callback.mock.calls[0]` 是 `undefined` ⇒ `undefined[0]` 抛 TypeError。

**修法**（`apps/desktop/electron/services/publish-monitor.test.js`，T2）：

```diff
-      await settle('T2 第二跳应发生', () => requests.length >= 2)
+      await settle('T2 第二跳应发生且回调应到达', () => requests.length >= 2 && callback.mock.calls.length > 0)
```

⚠️ **断言一个字没放宽**：
- 仍断言 `requests[1].url` 含 `/x/other/archives`（第二跳真的换了端点）；
- 仍断言 `callback.mock.calls[0][0].status === 'published'`（回调真的带着终态到了）；
- 回调真的不发生时，`settle` 8s 后抛 **`settle timeout: T2 第二跳应发生且回调应到达（8000ms 内未成立）`**
  ⇒ **仍然是红**，而且错误信息比原来的 `TypeError: Cannot read properties of undefined` 可读得多。

## 3. 实证复现（真模块、真 HTTP，只换等待条件）

沙箱里 `vitest` 跑不起来（`node_modules` 缺 `std-env` / `@vitest/runner`），
但**要证明的恰恰是「真实 HTTP 往返」这条时间差** ⇒ 写了一个**纯 Node、无 vitest、无 axios 依赖**的复现器
（`/workspace/scripts/repro_publish_monitor_t2.js`，不在本 PR 内）：
它用**被测实现自己的注入点**（`opts.axios`）塞一个**真 HTTP** 的最小传输层，
驱动**真实的 `createMonitorTask`**（`apps/desktop/electron/services/publish-monitor.js`，一字未改），
并把**第二跳的响应故意延迟 400ms**（模拟慢 CI runner）。

两个场景只差**等待条件**这一个变量：

```
=== 场景 A：旧口径（等 requests.length >= 2，随后立刻 task.stop()）===
     第二跳发出于 +10019ms；stop() 之前回调已发生 = false
     stop() 之后回调发生 = false  ⇒  ❌ 无回调 ⇒ 原断言读 callback.mock.calls[0] === undefined ⇒ TypeError

=== 场景 B：新口径（等 requests.length >= 2 && 回调已到达）===
     第二跳发出于 +10007ms；回调到达于 +10404ms ⇒ 差 397ms（回调**严格晚于**「第二跳已发出」）
     回调内容 = "published"

=== 结论 ===
  旧口径 ⇒ 回调发生=false  ❌ 必红：callback.mock.calls[0] === undefined ⇒ TypeError
  新口径 ⇒ 回调发生=true  ✅ 绿：断言读得到终态
```

⇒ **旧口径必红、新口径必绿**，且两者之间那 **397ms** 就是「第二跳已发出 → 回调已到达」的窗口
（= 一次真实 HTTP 往返 + 一次响应解析）。
⇒ 也实证了 `publish-monitor.js:64` 的 `if (cancelled) return` 是这条链上的**放大器**：
`stop()` 落在那个窗口里，in-flight 的 poll 就**按设计**不再回调 ⇒ 断言读空。
⇒ CI 上「同一个提交一趟红一趟绿」正是**窗口有没有被踩中**的区别，不是随机性。

## 4. 行尾与 diff 对账

- `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径**一致**（1 file changed, 7 insertions, 1 deletion）⇒ 无 CRLF/LF 混入。
- 删除数归因：**-1 行** = 被替换掉的那一条 `await settle(...)` 旧行（注释块是新增的 6 行）⇒ **没有删掉任何断言**。

## CHANGELOG 条目

# fix(测试): publish-monitor 的 T2 改成等「回调到达」而不是等「第二跳已发出」，慢 CI runner 上不再假红（fix-publish-monitor-t2-settle）

- B 站发布回查的装配锁用例此前「等第二跳请求发出、却断言回调已到达」，而这两件事之间隔着一次真实 HTTP 往返：慢的 CI runner 上测试会在响应回来之前就掐掉轮询，于是读到一个空回调并抛出 `Cannot read properties of undefined`——同一个提交有时红、有时绿，掩盖真正的回归。
- 现在等待条件与断言条件同源（等回调到达），断言一条没少：第二跳端点必须改变、回调必须带着「已发布」终态都仍要成立；回调真的不来时仍判红，只是错误信息从「空对象读属性」换成「等回调超时并点名等待条件」。

## learnings

### lesson: 等待条件必须与断言条件同源，否则「慢就假红」

**现场**：主干 `b5d69517`（#4393 合并提交）的 `Electron CI` run 40159383516 红了，
唯一一条失败是 `publish-monitor.test.js:118` 的 `TypeError: Cannot read properties of undefined (reading '0')`；
而**同一次 run 的第二趟 10477/10477 全绿**。

**根因**：用例的等待条件（`requests.length >= 2` ⇒ 第二跳**已发出**）与断言条件
（`callback.mock.calls[0][0].status` ⇒ 回调**已到达**）**不是同一件事**。
前者由**服务端**计数（请求一到就 +1），后者要等**客户端**把响应读回并判定完才发生
⇒ 中间隔着一次真实 HTTP 往返 ⇒ 慢 runner 上「等到了第二跳」时「回调还没发生」。

**可复用的 N 条**：

1. **等待条件必须与断言条件同源**：要断言回调，就等回调；只等一个「相关但更早」的事件（请求已发出、元素已渲染、
   日志已打印）等于把竞态留给 CI runner 的速度。同文件里 T1 / T3 / T7 已经是同源的，**只有 T2 不是** ⇒
   ⇒ **同族用例之间的「等待口径」本身就该被一起审**，否则错的那一条会被当成偶发。
2. **负向结论只能给显式上界**（等够久 ⇒ 断言「没发生」），正向结论只能等条件成立 ⇒
   这条分界在同文件里已有 `negativeWindow` 这个专门原语，本例说明**它不能被正向用例顺手借用**。
3. **改等待条件不等于放宽断言**：本次断言一行未动，只是把等待条件补齐到与断言同源；
   「等不到」依然判红（8s 后 `settle timeout` 并点名条件）⇒ **判据收紧方向是「更准」，不是「更松」**。
4. **读 CI 日志时，测试自打印的 `✓`/`✗` 与 vitest reporter 的通过/失败标记同形**
   ⇒ 判真失败只看 reporter 的 `FAIL` 行与 `⎯ Failed Tests` 块、以及摘要行 `Test Files N failed | …`。
   本次差点把「用例内部断言『扫描失败要保留字段详情』时自打印的 `✗`」当成真失败。
