# 本次执行记录：ffmpeg 失败分档——挂起被杀不得写成渲染失败（fix-title-card-renderer-runner-red，2026-10-27）【混合 PR】

- 分支：`fix-title-card-renderer-runner-red`（worktree：`<仓库父目录>/mp-worktrees/mp-fix-title-card-renderer-runner-red`，非 C 盘；基线 `858194776` == `origin/main`；deps `pnpm install --frozen-lockfile` OK）
- 动因：任务 #31 那条 Windows runner 红挂了数日、状态一直是「归属待定」。本记录交付的是**让它可归因**的那一步。

| 远程同步 | 由门禁推导 |
|---|---|

- 保留门禁：隔离 ✅ | 先红后绿 ✅ | 分档行为锁 ✅ | 反失明锁 ✅ | QM-1 打包 ✅（electron-builder --win --dir rc=0，app.asar 151,039,196 字节）| eslint/熔断/品牌/绝对路径 见下 | QM-6 ⛔ 待人工

## 一、根因（从 CI 现场回读，run `40441556381` / job `121985347119`）

两条红（`含 ffmpeg 滤镜特殊字符的文案不得让渲染炸掉`、`带单引号的文案必须真渲染出内容`）各耗时 **16228ms / 16229ms**，而 `title-card-renderer.js:396` 的 `execFileAsync` 内部 `timeout: 8000`，重试源为 `[gradientSource, solidSource]` **两轮** ⇒ 16.2s = 2 × 8s，即**两轮都是被 SIGKILL 的挂起**，不是滤镜报错。

但抛出的文案里**只有 `| argv:`、没有 `| stderr:` 段**——旧实现在 stderr 为空时把整段省略（`stderrText ? ' | stderr: ' + stderrText : ''`）。被 SIGKILL 的进程 stderr 天然来不及写出 ⇒ 「挂起」与「语法错」在日志里**完全同形**，这就是它被记成「归属待定」的机制。

## 二、修法

`describeRenderFailure(error, argv)` 抽成模块级函数并导出，按 **`error.killed` / `error.signal`** 分两档：

- 挂起档：`ffmpeg 未在预算内返回，已被 SIGKILL 杀掉（这是**挂起**，不是滤镜报错；stderr 缺席是这一档的预期形态）`，尾部带 `killed=true signal=SIGKILL`；
- 滤镜档：保留原 `renderTitleCard: ffmpeg 渲染失败:` 文案；
- **两档都**在 stderr 缺席时显式打 `stderr: <空>`——缺席本身是证据，省略就会让工具的失明被读成"没问题"。

判据取 Node 置位的 `killed/signal`，**不按耗时猜**（耗时只能提示"像超时"，不能证明）。

## 三、锁与读数（当场实跑）

新增 4 条 `describeRenderFailure` 分档用例：挂起档、滤镜档、**反失明档**（`stderr` 三种缺席形态都必须打 `<空>`）、**接线档**（源码必须走该函数，内联拼接的老写法回来即红）。

- 绿：`Tests 27 passed (27)`（`--reporter=verbose` 逐条有耗时，实际渲染 3 条 88–107ms，**无 skip**——防"全绿其实是恒真跳过"）。
- 先红：`git show HEAD:` 把模块退回改前 blob ⇒ `Failed Tests 4`（正是新增的 4 条）；还原后 `cmp` 证明字节级一致。
- QM-1：`electron-builder --win --dir --publish never` rc=0，产物 `app.asar` 151,039,196 字节。builder 另打了两条 `file source doesn't exist`（本 worktree 未跑 `dist/fonts` 与 `.playwright-browsers` 资产准备）——如实记：这是**新 worktree 的资产缺失**，不是本改动引入；**本片的 8s 启动 stderr 三层判据未跑**（改动仅主进程错误文案构造，但那不等于跑过启动验证）。

## 四、这一片解决了什么、没解决什么

解决：以后这条红在日志里会直接写"挂起 + 被哪个信号杀 + 第几轮"，并带 `FONTCONFIG`/argv 现场，归因不再靠猜。
**未解决（仍留在 #31）**：① 挂起的**真因**（收窄到两处：`buildFontconfigEnv` 注入的 `FONTCONFIG_FILE` 是否指向 runner 的 8.3 短名路径 `C\:/Users/RUNNER~1/…`，以及短名路径下 freetype 加载）；本机 23/23 全绿 ⇒ 这是一维环境差异，须按「可本机配置就先本机复现」的口径处理；② **预算倒挂锁**：`attempts(2) × 8000 = 16s` 与 shard 用例超时的关系目前只是"侥幸没撞线"（CI 上 16.2s 仍打出了断言而非 Test timed out），必须显式钉成 `2 × RENDER_TIMEOUT_MS + slack < 用例 timeout`，并把两个常量导出，否则下次 shard 收紧超时会把 ffmpeg 现场整个吃掉。

## 五、QM-6

混合 PR；引擎在本机两个技能根缺失 ⇒ 无真外部产物，`deepReview.status` 保持 `pending`，全绿也不自合并。


## 六、追加：一条我自己造出来的"倒挂"结论（已撤回），与它掩盖的真风险

写倒挂锁时它当场判红，读数取自 `apps/desktop/vitest.config.js`：**attempts × timeout = 2 × 8000 = 16000ms > 全局 testTimeout 10000ms**。

**更正：这条"倒挂"不存在，是我的判据比较对象写错了。**本组渲染用例统一走 `itWithFfmpeg`，它显式带 `FFMPEG_RENDER_TIMEOUT_MS = 60000`，所以 16s 的内部预算**一直在真正生效的用例时限之内**；我拿全局默认值当尺子，量出了一个不存在的缺陷。上一提交（`177c20a09`）的标题写着"倒挂读数成立"，那句是错的，以本节为准（commit 不可改写，故留此更正链）。

**教训**：**判据的比较对象写错，与漏写判据是同一类错**——读数再准也推出错结论。写预算类判据前必须先回答"这一组用例**实际生效**的超时是多少"（读 `it()` 的第三个参数），而不是读全局配置就开判。

留下来的真风险是另一条（更弱但成立）：新增渲染用例若走裸 `it()` 而不是 `itWithFfmpeg`，就会落回 10s 全局超时、被框架先赢，把刚分档好的 argv / killed / FONTCONFIG 现场整个吃掉。**这一格先未落地（脚本锚点未命中时我选择复验分支状态而不是硬改），随后在同轮内已落地成锁**——见 §七——① `RENDER_ATTEMPTS × RENDER_TIMEOUT_MS < FFMPEG_RENDER_TIMEOUT_MS`；② 裸 `it(` 计数棘轮（只能缩小）+ `itWithFfmpeg 计数 > 0` 的反失明正控。

（本行的 27/未改动是 §六 当时的状态；同轮稍后落地两条锁后为 `Tests 29 passed (29)`，见 §七。）
## CHANGELOG 条目

# ffmpeg 渲染失败现在会区分「挂起被杀」和「滤镜报错」

标题卡渲染在 Windows CI 上反复红的两条用例，日志里只留下一句「ffmpeg 渲染失败」加一行 argv，看不出到底发生了什么——因为进程是被超时杀掉的，stderr 根本没来得及输出，而旧文案在 stderr 为空时把整段省略了。于是"卡住不动"和"参数写错"这两种完全不同的故障在日志里长得一模一样，这条红因此被挂着标成「归属待定」好几天。现在失败信息按 Node 置位的 killed/signal 分档：挂起会明写「未在预算内返回，已被 SIGKILL 杀掉（这是挂起，不是滤镜报错）」，并且两种情况都会在 stderr 缺席时显式打 `<空>`——缺席本身就是证据。真实原因（疑与字体配置的短名路径有关）仍未定，但下一步终于有了可归因的现场。

## 七、追加：两条预算锁的落地读数（含 cap 取早了的那次自错）

- 绿档：`Test Files 1 passed (1) / Tests 29 passed (29)`（collected 29 > 0，`node --check` 通过）。
- 反证 CAUGHT：`MP_TITLE_CARD_RENDER_TIMEOUT_MS=40000` ⇒ 总预算 80000ms 判红，文案直接点名「ffmpeg 还没被杀、vitest 先判超时，argv/killed/FONTCONFIG 现场会被吃掉」。这条同时证明判据**比的是生效时限**——env 覆写走的是模块常量，不是配置默认值。
- 自错一次并如实记：第一版把裸 `it(` 的棘轮上限取在**插入本块之前**的 24，于是我自己的两条新用例把它顶到 26 当场判红。cap 必须在改动落地后重取（现值 26，注释写明"全部属非渲染组、只能缩小"）。这与"用全局默认当尺子"是同一族的两种错：**取读数的时点/对象**错了，锁就会咬自己或咬错人。
- 第二条锁的 `BARE_IT_CAP` 与消息文本都从同一次实测生成，不留两处手工数字漂移。
