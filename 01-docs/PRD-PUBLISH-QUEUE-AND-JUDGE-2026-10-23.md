# PRD：发布队列频控与发布判据（2026-10-23）

> 本文沉淀 2026-10-22~23 真机排查结论，补齐「发布频率控制」「发布成功判据」「用户可见反馈」三块的规格。

## 1. 背景与要解决的问题

真机出现「`publish:batch ok` 有 taskId，但任务从不执行、无报错、无日志」的现象，累计误导排查 20+ 轮。
最终定位：**任务在 `TaskQueue._executeTask` 内被发布频率守卫拦截，进入 `_delayed` 长等待**，而该分支原本**不写任何日志**。

## 2. 频控机制（数据校验与流程）

### 2.1 两档校验

| 档位 | 键 | 含义 | 判定字段 |
|---|---|---|---|
| `platform` | `platform` | 同一平台全局最小间隔 | `platformMinMs` |
| `account` | `platform:accountId` | 同一账号最小间隔（优先） | `accountMinMs` |

### 2.2 日配额

| 字段 | 说明 |
|---|---|
| 表 | `publish_daily_count(owner_subject, key, day_key, count, rollback_count, updated_at)` |
| `count` | 已**实际提交到平台**的次数；未提交失败会幂等回补（下限 0） |
| `rollback_count` | 回滚尝试次数，只增不减（防风上限） |
| `day_key` | 本机运营日 `YYYY-MM-DD` |
| 保留 | 最近 7 天 |

### 2.3 拦截时的判定对象

```js
const verdict = guard.check(platform, accountId)
// => { allowed:false, bucket:'account'|'platform'|'daily', reason:'interval'|'daily_quota',
//      remainingMs:number, daily:{used,max,dayKey} }
```

**数据校验要求**：`remainingMs` 必须为正整数；异常（负值/非有限数/超过 24h）一律按 0 处理并记 warn，避免任务无限等待。

## 3. 流程（一次发布的完整链路）

```
publish:batch
  → taskQueue.add(task)                 // 入队
  → _processNext()                      // 驱动
      → _executeTask(task)
          → 占槽 _running.set / _runningByChannel++
          → guard.check(...)            // 同步判定
              ├─ allowed=false ⇒ 写 _delayed + setTimeout(remainingMs) ⇒ return（不调 executor）
              └─ allowed=true  ⇒ 调用 executor
                  → [exec] enter → register → emit → createPublisher
                  → RPA 填表 → 点击发布 → 判据核验
```

## 4. 可观测性（强制）

每条关键分支**必须**输出结构化日志，字段名固定：

| 场景 | 日志 |
|---|---|
| 驱动入口 | `[queue] enter paused=<bool> queue=<n> running=<n> delayed=<n>` |
| 开始执行 | `[queue] exec task=<id> platform=<p>` |
| 被频控拦截 | `[queue] blocked bucket=<b> reason=<r> remainingMs=<n> daily={"used":n,"max":n,"dayKey":"..."}` |
| 进入延迟队列 | `[queue] delayed task=<id> waitMs=<n>` |
| 执行器分步 | `[exec] enter / register / emit / publisher task=<id>` |

> 只允许用项目 logger（`require('./services/logger').info/warn/error`）。**`console.*` 不会写入 `app-YYYY-MM-DD.log`**，用它打点等于没有打点。

## 5. 交互逻辑与提示文字

### 5.1 入队前预检（新增要求）

`publish:batch` 在返回 taskIds 之前必须检查守卫：

| 情况 | 返回 | 提示文字 |
|---|---|---|
| 可用 | `code:0` | — |
| 账号间隔未到 | `code:2001` | 「该账号距上次发布不足 N 分钟，预计 HH:mm 后可再次发布」 |
| 日配额用尽 | `code:2002` | 「该账号今日发布次数已达上限（N/N），将于次日 00:00 恢复」 |

**禁止**接受任务后再静默等待——用户会以为已发布。

### 5.2 等待中状态显示

任务列表行需显示：`等待频控 · 剩余 MM:SS · 原因：账号间隔`

### 5.3 失败提示

`publish verification timeout` 必须区分两种：
- 判据不命中（页面已重置但列表未见作品）⇒ 「发布结果待确认，请到平台作品列表核对」
- 平台明确拒绝 ⇒ 展示平台原文

## 6. 发布成功判据（按平台）

| 平台 | 判据 | 证据字段 |
|---|---|---|
| 抖音 | DOM 成功态 | `mode:'dom'` |
| 小红书 | 草稿箱出现该标题（IndexedDB `draft-database-v1`） | `evidence:'idb-title-match'` |
| 视频号 | **作品列表出现该标题**（`channels.weixin.qq.com/platform/post/list`） | `evidence:'post-list-dom'` |
| 今日头条 | 作品列表接口命中 | `mode:'artifact'` |

**原则**：判据必须是「用户可见结果」，不是「页面发生了什么变化」。视频号发布后页面会重置为壳页，任何基于 URL/文案变化的判据都必然超时。

## 7. 验收标准

1. 频控拦截时日志出现 `[queue] blocked …`，含 `bucket/reason/remainingMs/daily`
2. 频控等待上限 15 分钟，超时强制重新判定
3. `publish:batch` 对不可发状态返回明确错误码与提示文字
4. 四平台判据按上表实现，且失败时不误报成功

## 8. 视频上传类平台的「先点后选」约束（2026-10-23 真机补充）

头条与视频号都属于「上传控件延迟出现」的形态，实现上必须遵循同一顺序：

| 步骤 | 头条 | 视频号 |
| --- | --- | --- |
| 1 | 打开视频上传页 `profile_v4/xigua/upload-video` | 打开 `platform/post/create` |
| 2 | **点「添加视频」**（否则页面上没有 `input[type=file]`） | 点封面区触发选择器 |
| 3 | `setFileViaCdp` 设视频文件 | `setFileViaCdp` 设封面图 |
| 4 | 等上传完成信号（进度消失/出现文件名） | 等缩略图出现 |
| 5 | 填标题正文 → 点「发」 | 填描述 → 点「发表」 |

**禁止**：跳过步骤 2 直接查 `input[type=file]`。查不到时会静默跳过整段上传，后续所有步骤落空，最终只报一个与根因无关的错误（头条：`发布结果缺少平台作品 ID`；视频号：`publish verification timeout`）。

**判据**：日志必须出现 `[toutiao] add-video CLICKED` / 视频号封面设置成功；若为 `NO_BTN` 或无日志，视为上传未发生，应立即 fail-fast，不得继续点击发布按钮。

**为什么重要**：发布按钮点击是**副作用动作**，白点一轮就是一次真实提交尝试，会消耗账号的发布间隔窗口（60–80 分钟）。

### 8.2 视频方向决定发布轨（2026-10-23 真机定论）

头条视频的 API 轨**明确拒绝竖版**，真机日志（23:29:09）原文：

```
phase-failed error="竖版视频暂不支持 API 发布，请使用 RPA 发布"
```

因此发布轨的选择必须以**视频方向**为一等输入：

| 视频方向 | 头条发布轨 | 依据 |
| --- | --- | --- |
| 竖版（9:16，height > width） | **RPA** | API 轨硬拒绝；RPA 已跑通「上传 → 填表 → 发布 → 确认」全流程 |
| 横版（16:9，width >= height） | 可走 API | 抓包实证的 5 步链路（getAuthKey → apply → 分片 → commit） |

**产品约束**：

1. 路由层不得按「平台 + 有视频」二元判断，必须结合 `probeVideoInfo` 的 `width/height`；
2. 若方向未知（探测失败），**默认 RPA**（fail-safe：RPA 两条方向都能走，API 只接受横版）；
3. 用户可见提示文案沿用平台原文语义：「竖版视频暂不支持 API 发布，请使用 RPA 发布」，并在任务详情里注明已自动改走 RPA。

**反面教材**：曾按「平台有视频 ⇒ 走 API」一刀切路由，结果竖版任务 100% 在 prepare 阶段失败，且失败被记成「发布失败」而非「轨选择错误」。

### 8.4 点击后校验（防「点了但不是那个按钮」）

**背景（2026-10-23 两次真机事故）**：

| 平台 | 日志表现 | 真因 | 用户可见结果 |
| --- | --- | --- | --- |
| 视频号 | `publishing...` 有日志、`verifying...` 也有 | 选择器 `button:has-text("发表")` 是**子串匹配**，先命中首页「发表视频」入口 | 创作者中心与草稿箱**均为空** |
| 今日头条 | `publishing...` + `confirm dialog clicked: 确定` 都有 | 封面弹窗 `no-next` 失败后**未关闭**，发布点击命中遮罩 | 作品列表**无新内容** |

⇒ 共同点：**日志证明「发生了点击」，不证明「点到了正确元素」**。

**强制规则**：

1. **选择器必须精确**：可点击控件一律用 `:text-is`（精确文案），禁止 `:has-text`（子串）。确需包含匹配时，必须同时排除同前缀的兄弟控件（如「发表视频」「定时发布」）。
2. **弹窗必须先于点击关闭**：任何「打开弹窗 → 失败 → 返回」的路径，返回前必须执行关闭（取消/关闭/×），并在日志中记录 `closed=<文案|none>`。
3. **点击后立即校验落点**：点击发布后 1.5 秒内读取 `win.webContents.getURL()`；若 URL 偏离预期（如视频号应在 `post/create`，却变成通知中心/首页），立即记录 `publish click may have hit the wrong element url=<实际>`，不得静默进入验证阶段。
4. **验收只认用户可见结果**：创作者中心 / 作品列表 / 草稿箱。HTTP 2xx、`publishing...` 日志、确认弹窗点击**都不构成发布成功证据**。

**反例（必须记住）**：曾以「捕获到 3 条 HTTP 201」推断发布成功，用户核对创作者中心与草稿箱**均为空**，证明该推断错误。2xx 只能证明「某个请求被受理」，不能证明「作品已发布」。

## 8.5 视频号 API 链：与竞品实现的逐项对照（2026-10-23）

竞品实现取自 `00-vendor-originals/refproduct/main-dist-index.cjs`（压缩代码，以下为原文摘录）。

| 步骤 | 竞品 | 本项目 | 一致性 |
| --- | --- | --- | --- |
| 1 取鉴权 | `POST channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params`，body `{timestamp,_log_finder_id,rawKeyBuff}` | 同 | ✅ |
| 2 申请上传 | `PUT finderassistancea.video.qq.com/applyuploaddfs`，`X-Arguments: apptype=251&filetype&weixinnum&filekey&filesize&taskid&scene=2` | 同 | ✅ |
| 3 分片 | `PUT finderassistanced.video.qq.com/uploadpartdfs?PartNumber&UploadID`，`scene=0` | 同 | ✅ |
| 4 完成 | `POST finderassistancea.video.qq.com/completepartuploaddfs?UploadID`，body `{TransFlag:'0_0',PartInfo}`，`scene=2` | 同 | ✅ |
| 5a 视频登记 | `POST .../post/post_clip_video`，body 含 `clipOriginVideoInfo{width,height,duration,fileSize}`、`traceInfo{traceKey,uploadCdnStart,uploadCdnEnd}`、`targetWidth/targetHeight`、`type:4`、`scene:7` | **缺** | ❌ |
| 5b 发布 | `POST .../post/post_create` 或 `post_draft` | 同 | ✅ |

### 数据校验（本条链路的判定口径）

- Step1 成功判据：`errCode===0` 且 `data.authKey` 非空；**响应不含 `cdnHost`**（实测），故主机必须用常量。
- Step2/4 成功判据：HTTP 2xx 且响应可 JSON 解析；失败时错误信息须带 `[host=…]` 以便归因。
- Step3 成功判据：每片 2xx；分片大小 8 MiB。
- Step5 成功判据：`errCode===0` 且返回体含 `postId/contentId/id` 之一；**仅有 2xx 不算成功**（见 8.1/8.4）。

### 待验证与后续

- 2026-10-23 13:52 起验证「主机修正后 Step5 是否可直接成功」。
- 若 Step5 因缺少视频登记而失败，则补 `post_clip_video`：其 `traceInfo` 需记录上传开始/结束时间戳（`getTimeStamp(10)`），`targetWidth/Height` 在竖版时按 `width<=height` 分支取 1080 或 1920 上限。

## 8.6 今日头条：上传已通、提交被封面阻断（2026-10-23 14:24 真机）

### 实测时间线（账号 7ae99805，真文案《被误解的明朝》）

| 时间 | 事件 | 判读 |
| --- | --- | --- |
| 14:24:25 | `add-video NO_BTN` | 「添加视频」按钮未出现，改走 file input 直传 |
| 14:26:52 | `file uploaded` | **视频确实上传成功**（历史首次在该分支达成） |
| 14:26:52 | `title input hasTitle=true selectorCount=4` | 标题框已出现并填写成功 |
| 14:27:16 | `cover dialog closed after failure: none` | 封面弹窗被尝试关闭（未找到取消键） |
| 14:27:17 | `cover path failed: no-next` | **「下一步」持续不可点** |
| 14:27:17 | `publishing...` | 执行了发布点击 |
| 14:27:19 | `publish confirm dialog clicked: CONFIRMED_IN_MODAL:确定` | 点到的是**弹窗内的「确定」**，非发布确认 |
| 14:27:46 | `artifact 未命中：no-endpoint-hit` | **没有任何发布请求发出** |
| 14:28:00 | `publish failed … 缺少平台作品 ID` | 判定失败 |

### 结论（数据校验）

- **上传链路已修通**：`file uploaded` + `title input hasTitle=true` 两条同时成立，可证明视频已附着。
- **提交未发生**：`_startPublishNetworkCapture` 已启用（禁用模式 0 处），但捕获到 **0 条**发布请求 ⇒ 不是判定器抓不到，是请求没发出。
- **最可能的阻断点**：封面未设置成功（`no-next`）。头条很可能要求封面必填，缺封面时发布按钮为禁用态，点击不产生请求。
- **`CONFIRMED_IN_MODAL:确定` 不可作为提交证据**：该「确定」来自弹窗作用域（`modals[s].querySelectorAll`），而上一行正是封面弹窗失败，二者时间相邻（1 秒内）。

### 下一步取证（已排程 15:45）

- 新增 `cover dialog shape: <控件清单> :: <弹窗文字>` 日志：在「下一步」不可点时 dump 弹窗内全部 `button/div[role=button]/span/a` 的文本与 `disabled` 态，以及弹窗整体文案。
- 判据：若出现 `请上传封面/请选择封面/尺寸不符` 等文案 ⇒ 按提示补输入；若按钮全为 `dis=true` ⇒ 需先完成前置选择；若无按钮 ⇒ 弹窗结构与预期不符，需重新采集选择器。

### 交互与提示文字（当前实现）

- 失败提示：`封面设置失败，已关闭弹窗继续发布`（warn 级，不阻塞主流程）
- 关窗尝试顺序：`取消` → `关闭` → `×`，均未命中时记录 `none`
- 关窗后固定等待 800ms 再继续，避免点击落在遮罩上。
### 8.1 完成证据分级（2026-10-23 真机教训）

判定「上传完成」时，证据必须按强度分级，**弱证据不得单独作为完成依据**：

| 级别 | 例子 | 可作为完成依据 |
| --- | --- | --- |
| 语义完成文案 | 上传成功 / 上传完成 / 上传完毕 / 检测为高清 | ✅ |
| 强结构 | `video` 元素可见且 `currentSrc` 为 blob/https，或时长 > 0 | ✅ |
| 弱 DOM 形状 | `[class*=progress]`、容器类名、进度条残留 | ❌ 单独不可用 |
| **静态 UI 文案** | 设置封面 / 添加视频 / 重新上传 | ❌ **上传前就存在** |

**失败案例**：`doneCopy` 正则里混入「设置封面」，该按钮在上传前即渲染 ⇒ 恒真 ⇒ `upload.ok=true` ⇒ 前置门禁放行 ⇒ 在视频未附加的情况下点击发布，白耗 60–80 分钟账号窗口。

**自查问句**：这个信号在**上传开始之前**会不会已经存在？若会，它就不能作为完成证据。
### 8.3 响应证据判定（页面判据失效时的兜底）

**适用场景**：发布动作已执行、平台已受理，但作品列表页读不到结果（导航不生效、内容在子 iframe、页面结构变更）。

**判据定义**：发布点击后捕获到的网络响应中，存在**同时满足**下列三条的记录，即判定发布成功，`evidence='publish-response'`、`mode='network'`：

| 条件 | 规则 |
| --- | --- |
| 状态码 | `200 <= status < 300` |
| 端点语义 | 命中 `publish` / `submit` / `create` |
| 端点排除 | **不得**命中 `media` / `upload` / `chunk` / `part` / `authkey` / `getauth` |

**为什么必须排除上传类端点**：视频发布会先做分片上传，每个分片都可能返回 201。若不加排除，第一个分片就会把任务判成「发布成功」——这是**假成功**，比失败更危险。

**真机依据（2026-10-23）**：视频号一次发布捕获 `n=3` 条响应，状态全为 `201`；同期页面判据始终 `post-list-timeout`（`url` 停在 `/platform/post/create`）。

**优先级**：页面判据命中时优先用页面证据（可拿到列表可见性）；页面判据超时才走响应判定。

**记录要求**：命中时必须打印 `publish 响应证据命中 endpoint=<前120字> status=<码>`，便于事后核对是哪一条请求被采信。
## 8.7 登录态双存储：凭证库 vs 浏览器 session（2026-10-23 实测）
### 现象
用户重新扫码登录视频号后，程序仍报未登录。四次测量：
| # | 测量 | 读数 |
| --- | --- | --- |
| 1 | App 侧凭证库 cookie 长度 | `cookieLen 142 → 284`（**登录已生效**） |
| 2 | CDP 页面 URL | `https://channels.weixin.qq.com/login.html` |
| 3 | CDP `context.cookies(...)` | **0 条** |
| 4 | 页内 `POST helper_upload_params` | `errCode=300334`（登录前为 `300342`） |
### 结论（数据校验）
- 登录态写入**应用凭证库**（加密存储 / 账号分区），而 RPA 发布页读取的是 **Electron 浏览器 session 的 cookie**。
- 二者之间没有同步桥 ⇒ 页面永远判定未登录，API 轨的 Step1 也拿不到 `authKey`。
- 错误码变化（`300342 → 300334`）本身即是「登录确实落在别处」的反证。
### 修复（PR #4321）
- 在 `rpa-view-manager.js` 解析出 cookie 字符串后，按 cookie 名逐条调用
  `session.defaultSession.cookies.set({ url, name, value, domain, path })`。
- 域名映射：`tencent_video → .weixin.qq.com`；`toutiao → .toutiao.com`。
- 成功日志：`cookie inject -> browser session: N cookies platform=… domain=…`。
- 失败仅 warn，不阻塞发布（fail-open：注入失败时退回原有行为，不应让整条发布中止）。
### 交互与提示文字
- 成功：INFO 级一行，含注入条数、平台、域名。
- 失败：内部 warn，不向用户提示，避免把内部通道问题暴露为产品错误。
- 用户侧无新增按钮或文案；登录仍走既有「账号管理 → 重新登录」。
### 为什么头条当时不加此修复
- 头条 14:24 的运行已达成 `file uploaded` + `title input hasTitle=true`，说明其会话有效。
- 验证窗口前 15 分钟内不引入变量，是今天确立的纪律。
## 8.11 视频号：真正卡点是「视频没有附上」（截图实证，2026-10-23）
### 截图证据
`<临时目录>/mp-rpa-diag/tencent_video-verify-*.png`（代码自动留存）：
| 区域 | 画面 |
| --- | --- |
| 页面 | 「视频管理 / 发表动态」，左下头像 + 退出登录 ⇒ **已登录** |
| 短标题 | 「被误解的明朝：西方史料里的另一个」 ⇒ **已写入** |
| 视频描述 | 显示占位符「添加描述」 ⇒ **空** |
| 视频上传区 | 虚线框 + 「+」+ 上传说明 ⇒ **没有视频** |
| 弹窗 | **没有任何可见弹窗** |
### 由此推翻的两个错误判断
1. **「切换视频号」不是遮挡层**：它是左下账号菜单里的**隐藏项**，被探针按 `[class*=modal]` 采集到。
   ⇒ 之前三轮针对它的补丁（点取消 / 强制隐藏 / 程序化点击）**目标不存在**。
2. **「desc filled readback=189」不可信**：真实输入框仍为空，说明写入作用在了非真实编辑器节点上。
### 真正的阻塞
`upload-waiter` 的日志序列是：
```
uploading file...   →   uploading file...   →   uploading file...
（然后直接跳到 title input / desc filled）
```
⇒ `_resolveSelector` **没有匹配到可用的 file input**，循环重试后（retry 用尽）继续往下走，因此
`_setFileInput` 与拖拽回退**从未被调用**。发布按钮不存在（`programmatic publish click: not-found`）
也正因如此。
### 已加的诊断
```
[tencent_video] file inputs on page: <accept>|<class> ; …   或  NONE
```
### 判据与对应修法
| 诊断结果 | 修法 |
| --- | --- |
| `NONE` | 页面无 `input[type=file]` ⇒ 走「点击上传框触发原生选择器」或纯 `DragEvent('drop')` |
| 有 `accept=.mp4` 但 class 不匹配 | 放宽/修正选择器 |
| 多个候选 | 按 `accept` 过滤出视频那个 |
### 产品侧提示文字建议
当上传步骤未获得「视频已附上」的证据时，应提示用户：
「视频未能上传成功，请重试或改用网页端发布」，而不是继续走发布流程并报「缺少作品 ID」。
## 8.12 与逆向成果对照：视频号端点集差异（2026-10-23）
### 成果侧（`mtm-platform-apis.md` L468–495，498 端点清单中的视频号部分）
```
/cgi-bin/mmfinderassistant-bin/auth/auth_data
/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params
/cgi-bin/mmfinderassistant-bin/helper/helper_parse_mp_link
/cgi-bin/mmfinderassistant-bin/post/post_create
/cgi-bin/mmfinderassistant-bin/post/post_list
/cgi-bin/mmfinderassistant-bin/post/get-finder-post-trace-key
/cgi-bin/mmfinderassistant-bin/statistic/post_list
```
### 我方现状（`packages/api-publish-engine/src/publish/platforms/shipinhao-video.js`）
| 步骤 | 我方实现 | 成果里是否存在 |
| --- | --- | --- |
| Step1 取 authKey | `helper/helper_upload_params` | ✅ 存在（同一端点） |
| Step2 申请上传 | `PUT {cdn}/applyuploaddfs` | ❌ **清单里没有** |
| Step3 分片 | `{cdn}/uploadpartdfs` | ❌ 没有 |
| Step4 完成 | `{cdn}/completepartuploaddfs` | ❌ 没有 |
| Step5 发布 | `post_create` / `post_draft` | ✅ 存在 |
### 推论
1. `helper_upload_params` 的响应里**没有 `cdnHost`**（真机日志 `step1Keys=errCode,errMsg,data`，`data` 仅含
   `authKey/uin/appType/videoFileType/...`），而三条 `*dfs` 路径在任一候选主机上均 404。
   ⇒ **我方假设的上传协议形状很可能不成立**，不是"主机写错"，是"路径不存在"。
2. 成果清单是参考产品实际调用过的端点集合，`*dfs` 一条都没有 ⇒ 参考产品**不做自拼 `applyuploaddfs`**。
### 可立即改进的一项（不需要新逆向）
`post/post_list` 是**只读**端点，可作为发布校验口。当前校验走作品页（SPA 懒加载，实测
`works-page-timeout`），改用它可以把"作品是否出现"变成一次结构化查询。
### 下一步（需要一次页面侧证据）
在真实浏览器会话里**手动上传一个视频**并抓包，读出页面自己发出的上传请求（host + path + 请求头），
以它为准重写 Step2–4；**不要再用 `applyuploaddfs` 这个猜测**。
### 红线遵守
- 只使用只读端点做验证（`post_list` / `auth_data`）；
- 不在日志/文档中写入任何 cookie、authKey、token 值（本文只写字段名）。
## 8.13 与逆向成果对照：今日头条视频发布端点（2026-10-23）
### 成果侧（`mtm-platform-apis.md` L296–363）
```
https://mp.toutiao.com/ugc/publish/video/v1/get_token/     ← 取上传/发布令牌
https://mp.toutiao.com/ugc/publish/video/v4/commit/       ← 提交发布
https://mp.toutiao.com/profile_v4/xigua/upload-video      ← 发布页
https://mp.toutiao.com/mp/agw/creator_center/list         ← 作品列表（只读）
```
### 我方（`packages/api-publish-engine/src/publish/platforms/toutiao-video-publish.js`）
```
/xigua/api/upload/GetPublishAuth
/xigua/api/upload/PublishVideo
/ixigua/api/upload/GetPosterList/
```
我方这套是**从前端 bundle 逐字抄的**（文件头注释引用了 `a.ZP.requestJsonNew("/xigua/api/upload/PublishVideo", Y, !0)`），
成果那套是**参考产品运行期实际调用的**。两者并存说明平台有新/旧两条链。
### 现状与判据
| 事实 | 含义 |
| --- | --- |
| RPA 轨：`exact 发布 click: clicked` → `NO_DIALOG` → **无 publish 请求** → 无作品 | 点击未触发提交 |
| RPA 轨：两段式恢复后（移除多余首点）仍然 `responses=0` | 两段式假设**也未成立** |
| API 轨：`GetPublishAuth` / `PublishVideo` 未被使用（运行时走了 RPA） | API 轨在头条上**没有启用** |
### 下一步（按判据强度排序）
1. **优先试成果里的 `ugc/publish/video/v4/commit/` 链**：它来自参考产品的真实调用集合，
   比我方从 bundle 推断的 `PublishVideo` 更可信。
2. 校验一律用只读端点 `mp/agw/creator_center/list`（已在 `toutiao-artifact.js` 的 `LIST_ENDPOINTS` 中）。
3. **不要再用「多点几次」的方式尝试**：两段式与精确点击两条路都已证伪。
### 红线
- 只用只读端点做验证；
- 文档/日志只写字段名与路径，不写 cookie/token 值。
## 8.14 视频号上传主机探测结论（2026-10-23 19:00，实测）
### 探测
```
DNS  finderassistancea.video.qq.com -> 36.155.248.44      （解析正常）
HEAD https://finderassistancea.video.qq.com/            -> 404（根路径，正常）
PUT  https://finderassistancea.video.qq.com/applyuploaddfs -> 404（无鉴权请求体 {}）
```
### 结论
1. **主机可达**（DNS 与 TLS 均正常）⇒ 不是我方网络问题。
2. **`/applyuploaddfs` 路径在该主机上不存在**（404 而非 401/403，说明不是鉴权拦截）。
3. 这与 `mtm-platform-apis.md` 的端点清单一致（清单里没有 `*dfs`），
   与《参考产品-完整拆解》§5.8 的**字符串级对照**冲突。
### 对 §5.8 的修正
§5.8 的判据是「原生层二进制里出现 `finderassistancea.video.qq.com/applyuploaddfs` 字符串」。
**字符串存在 ≠ 该路径在 2026 年仍在线**。这与任务书 §5 记录的三处同型错误一致
（凭"名字像"/"相邻索引"/"二进制里有这个字符串"下结论）。
### 因此
- 不要再在 `*dfs` 路径上投入（我方 Step2–4 需要按真实抓包重写）；
- 主机回落（`ec898dabc`）仍应保留：它把请求从 `baseURL` 拉到正确域名，属于必要但不充分；
- **下一步必须**：真实浏览器手动上传一次，抓页面自己发出的上传请求（host + path + headers + body），
  以它为准重写 Step 2–4。这是唯一能闭合的路径。
### 已同步的产品行为
无超时导致「静默挂起」的问题已修（`bfb6a0a48`，60s 默认超时）——
上传失败会以显式错误呈现，而不是无声消失。
## 8.15 视频号端点探针矩阵（2026-10-23 19:06，无鉴权请求实测）
| # | 目标 | 方法 | 结果 | 判读 |
| --- | --- | --- | --- | --- |
| 1 | `finderassistancea.video.qq.com/applyuploaddfs` | POST/PUT `{}` | **404** | 路径不存在 |
| 2 | `finderassistanced.video.qq.com/applyuploaddfs` | POST `{}` | **404** | 路径不存在 |
| 3 | `finder.video.qq.com/applyuploaddfs` | POST `{}` | 无效状态行 | 非 HTTP/1.1 或需特定协议 |
| 4 | `channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params` | POST `{}` | **200** + `{"errCode":300330,"errMsg":"request failed"}` | **端点存在**，300330 = 未登录/会话无效 |
| 5 | `channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_create` | POST `{}` | **200** | 端点存在 |
### 判读
1. **API 宿是 `channels.weixin.qq.com`**（4/5 命中，且 300330 是明确的鉴权错误码而非 404）。
2. **视频 CDN 宿上不存在 `*dfs` 路径**（1/2 皆 404）⇒ 我方 Step2–4 的路径形状在 2026 年已失效。
3. 因此 `applyuploaddfs` 不是"主机写错"，而是**该协议段已下线/迁移**。
### 下一步的唯一闭合动作
在真实浏览器会话里手动上传一个视频并抓包，记录页面自己发出的**上传请求**（host + path + method + headers + body 前 200 字节），
以它为准重写 Step2–4。**在此之前不要再改主机或路径常量**。
### 产品提示（对用户可见）
当上传阶段拿不到「视频已附上」的证据时，界面应明确提示：
「视频未能上传成功，请重试或改用网页端发布」，而不是继续走发布并报「缺少作品 ID」。
## 8.16 工程规则：静默失败禁止（silent-failure ban）
### 动因（2026-10-23 一天之内四次同型）
| # | 现象 | 真因 |
| --- | --- | --- |
| 1 | API 轨一行日志都没有 | 适配器未传 `logger`，`this.logger` 为 `undefined` |
| 2 | 上传步骤无声跳过 | `dbg.attach()` 写在 `try` **之外**，异常逃逸 |
| 3 | 上传挂起不报错 | `createHttpClient({timeout: undefined})` ⇒ 无超时 |
| 4 | 文件选择器"跑了但没结果" | `if (!params) return false` **没有日志** |
四次的共同点：**代码执行了，但没有留下任何可诊断的痕迹**。排查成本远高于修复成本。
### 规则
1. **每一个提前返回都必须带原因**：
   `return false` 之前必须有 `log.warn(... '<阶段> <原因>')`；纯布尔返回视为缺陷。
2. **任何 `await` 外部资源（debugger / 网络 / 浏览器）必须被 try 包裹，并在调用处再包一层**。
   只包一层不够——今天两次都是"helper 内包了、调用处没包"或反之。
3. **禁止 `timeout: undefined`**：HTTP 客户端必须显式给默认值（本项目取 60s）。
4. **每个平台链必须注入 logger**：缺 logger 时构造期就应 fail-closed 或写 `console` 兜底，
   不能让"没有日志"成为默认状态。
5. **文档/日志只写字段名与路径，不写 cookie/token/authKey 值**（红线，沿用 §8.12）。
### 验收方式
- 单测：对每个 `return false` 分支断言"至少调用了一次 logger"；
- 真机：任意一次失败运行，日志中必须能读到**阶段名 + 原因**，不允许出现"某步骤完全无输出"。
## 8.17 视频号上传通道矩阵（2026-10-23，逐条实测）
| # | 通道 | 实现 | 实测结果 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | CDP `DOM.setFileInputFiles` | `_setFileInput` | 页面仍空；`input[type=file]` 时有时无，三次 `NONE` | ❌ 不可用 |
| 2 | JS `DataTransfer` 赋值 | `_setFileInputViaJs` | 同上，框架清空 `files` | ❌ 不可用 |
| 3 | CDP 文件选择器拦截 | `_uploadViaFileChooser` | `no fileChooserOpened within 8s`（点击**不弹原生选择器**） | ❌ 不可用 |
| 4 | CDP 真实拖放 | `_dropViaCdp`（`Input.dispatchDragEvent` + `dragData.files`） | 首版类名选择器 `target not found`；改**文字锚点**（「上传时长」/「添加视频」/「点击上传」）后待验证 | 🔄 进行中 |
### 输入证据（为什么选这四条）
- 截图：上传区是**虚线框 + 「+」**，说明是拖拽/点击区，非常规 input；
- 日志：`file inputs on page: NONE` 与"有 input 但设值无效"交替出现 ⇒ 异步挂载 + 受控组件；
- `no fileChooserOpened` ⇒ 点击不触发原生文件对话框。
### 失败时的产品行为（必须）
上传阶段未取得「视频已附上」证据时，不得继续发布；应提示：
「视频未能上传成功，请重试或改用网页端发布」。
### 与逆向成果的关系
- 参考产品（`ref-slices-v2.txt`）给出的是**纯 API 三段式**，不含浏览器上传器实现；
- 参考产品（DLL 字符串）同样只有 URL；
- ⇒ 浏览器上传器这条路**没有逆向成果可直接复用**，只能靠页面自身证据（截图/日志/锚点）推导。
## 8.18 今日头条：上传成功、点击不提交（2026-10-23 20:17 实证）
### 完整日志序列（账号 `45261bb5`）
```
20:14:42  uploading file...
20:17:09  file uploaded                 ✅ 上传成功（约 2.5 分钟）
20:17:17  publishing...
20:17:20  confirm dialog probe: NO_DIALOG   ✅ 平台未拒绝
20:17:30  verifying...
20:17:56  artifact 未命中：no-endpoint-hit / works-page-timeout
20:18:10  publish signal lacked platform ID; endpoint=.../manage/content/video responses=0
20:18:10  publish failed: 发布结果缺少平台作品 ID
```
### 判读
| 环节 | 结论 |
| --- | --- |
| 上传 | ✅ 正常（`file uploaded`），排除文件/封面上传问题 |
| 账号 | ✅ 平台不拒绝（`NO_DIALOG`），排除资质问题 |
| **提交** | ❌ `responses=0` —— 点击后**没有产生任何发布请求** |
| 作品 | ❌ 视频列表 0 条 |
⇒ 阻塞点被收敛为唯一一处：**点击动作没有触发页面的提交逻辑**。
### 已证伪的两条假设
| 假设 | 做法 | 结果 |
| --- | --- | --- |
| 点击目标不对 | 按文本精确点「发布」 | `clicked` 但无请求 |
| 需要两段式点击 | 移除多余首点、保留原两段式 | 仍 `responses=0` |
### 下一步（两条，按成本排序）
1. **启用 API 轨**：`config/platforms.yaml` 的 `toutiao.publishMode` 由 `dom-only` 改为 `api-then-dom`
   （该平台 `has_api: true`，适配器已有 `GetPublishAuth` → `PublishVideo` 链，但**此前从未执行过**）。
   注：配置在应用启动时读取，**改完必须重启**才生效。
2. **抓一次真实提交请求**：在浏览器里人工点一次发布，记录请求体，再按形状实现。
### 产品提示
当 `responses=0` 且无作品 ID 时，提示语应为：
「发布未提交成功，请重试或改用网页端发布」，而不是笼统的「缺少作品 ID」。
## 8.19 逆向文档与 bundle 实证的三处冲突（2026-10-23 20:30）
对《视频号发布链深挖-浏览器上传器》逐条与 `refproduct/main-dist-index.cjs` 原文核对，发现三处必须以代码为准：
| # | 文档写法 | bundle 原文 | 采信与理由 |
| --- | --- | --- | --- |
| 1 | ⑤ `completepartuploaddfs` = **PUT** | `W = .../completepartuploaddfs?UploadID=${enc}`；`yield $http$1.post(W, K, {...})` | **POST**。文档表格把方法写错，代码是可执行证据 |
| 2 | ⑦ 发布提交 = **`finderNewLifeCreate`**（当作端点） | `platformNames.ShiPinHao → "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate"`，是**页面 URL**；真正的提交是 `post_${pubType==1?'create':'draft'}` | **`post_create` / `post_draft`**；`finderNewLifeCreate` 只是发布页地址 |
| 3 | ⑥ `post_clip_video` 只是"新增一跳" | 有完整 body：`url / timeStart / cropDuration / width / height / x / y / clipOriginVideoInfo{width,height,duration,fileSize} / traceInfo{traceKey,uploadCdnStart,uploadCdnEnd} / targetWidth / targetHeight / type:4 / timestamp / _log_finder_uin / _log_finder_id / rawKeyBuff / pluginSessionId / scene:7 / reqScene:7`，header `referer: .../platform/post/create` | **body 可直接实现**；我方当前链**缺此步** |
### 判据纪律
1. **逆向文档是二手材料，bundle 是一手证据**——两者冲突时以能跑的代码为准；
2. 方法名（GET/POST/PUT）必须回原文核对 `$http.*` 调用，不能只看文档表格；
3. 凡是"端点"结论，要区分 **HTTP 端点** 与 **页面 URL**（后者不能当接口调用）。
### 对实现的直接影响
- 已按 (1) 把 `completepartuploaddfs` 回退为 POST（`b0e4d413d`）；
- (2) 说明我方 `post_create` 的选择是对的，无需改动；
- (3) 是**真实缺口**：上传完成后、发布之前应调用 `post_clip_video`，否则平台可能认为视频未完成处理。
### 仍未闭合
- `post_clip_video` 的 `url` 取自 `completepartuploaddfs` 返回体的哪个字段（候选：`DownloadURL` / `VideoUrl`）——需真机响应确认；
- ⑦ 的 `videoCover/title/description/isOriginal/locationKeyword` 归属为 **INFERRED**，未在原文中逐个定位到 `post_create` 的 body 构造处。
## 8.20 视频号上传区在 iframe 内：四种查询策略的实测结论（2026-10-23 20:45）
### 事实
`content frame found: https://channels.weixin.qq.com/micro/content/post/create`
发布页的**上传区不在主文档**，而在上述 iframe 内。这解释了为什么主文档上的
`document.querySelector`、`input[type=file]`、文字锚点全部落空。
### 四种策略逐一实测
| # | 策略 | 代码 | 实测结果 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | 主文档 `DOM.querySelector` | `getDocument({depth:-1})` | `target not found` | ❌ 看不到 iframe 内 |
| 2 | `pierce: true` | `getDocument({depth:-1, pierce:true})` | 三次仍 `target not found` | ❌ pierce 只覆盖 shadow DOM，不穿透 iframe |
| 3 | `DOM.getDocument({frameId})` | `Page.getFrameTree` 逐帧查 | 未单独验证（已被 4 取代） | ⚠️ 理论可行 |
| 4 | **`Page.createIsolatedWorld` + `Runtime.evaluate`** | 在每帧内执行 JS，返回 `getBoundingClientRect()` | 进行中 | ✅ **唯一能"在 iframe 内执行脚本"的正规入口** |
### 关键认知
- CDP 里**跨 frame 执行脚本**只有一条正路：`Page.createIsolatedWorld({frameId})` 拿 `executionContextId`，再 `Runtime.evaluate({contextId, expression})`；
- `Runtime.evaluate` **不带 contextId 时只在主 world 执行**，即使传了 frameId 也不会进入 iframe；
- 坐标必须由**帧内**的 `getBoundingClientRect()` 给出，主文档算出来的坐标对 iframe 内元素无意义。
### 对实现的约束（写入代码注释）
1. 上传相关的**任何** DOM 查询都必须先枚举 frame；
2. 每一帧单独 try/catch —— 跨域帧注入会抛错，不能中断整条链；
3. 命中帧要打日志（frame url 前缀 + rect），否则无法区分"没找到"与"找到了但拖不进去"。
### 尚未验证
`createIsolatedWorld` 对 `micro/content/post/create` 是否可注入（跨域策略）；
若不可注入，则浏览器上传器这条路在本机**不可达**，只能走 API。
## 8.21 跨帧注入已验证成功（2026-10-23 21:10，真机）
### 实测日志
```
21:10:38  [tencent_video] uploading file...
21:10:53  frame-scan: frames=2
            https://channels.weixin.qq.com/platform/post/create
            https://channels.weixin.qq.com/micro/content/post/create
21:11:01  cdp-drop: target not found [class*=upload],...
```
### 判读（三分支已收敛到一支）
| 分支 | 判据 | 本次结果 |
| --- | --- | --- |
| 帧不可见 | 无 `frames=` 行 | ❌ 不成立——打印出 2 帧 |
| 注入被拒 | `frame-scan: inject failed …` | ❌ 不成立——无该行 |
| **注入成功但未命中** | 有 `frames=`、无 `hit` | ✅ **就是这一支** |
⇒ `Page.createIsolatedWorld` + `Runtime.evaluate` 在 `micro/content/post/create` 帧内**可以执行**；
`pierce`/`querySelector` 那条路（8.20 表 1/2）确实无效，但**跨帧 JS 这条路是通的**。
### 剩余唯一问题：锚点不准
脚本在帧内按以下三类条件找元素，均未命中：
1. 可见文字含「上传时长」/「添加视频」/「点击上传」；
2. class 含 `upload` / `dragger` / `drop` / `uploader`；
3. 任意 `div,section,span,button`。
### 下一步（一步即可定位）
在帧内打印诊断而非只返回布尔：
```
body.innerText.slice(0,300)      // 页面到底渲染了什么
document.querySelectorAll('input[type=file]').length
document.body.children.length
```
据此重选锚点；若 `innerText` 为空 ⇒ 该帧尚未完成渲染，应在 `uploading file...` 之后**等待帧内出现非空 body** 再扫描。
### 结论
浏览器上传器**不是不可达**——它只是"元素还没找到"。这是本轮最实质的进展。
## 8.22 2026-10-23 全天逆向成果的落地评估（逐条）
对当日 7 个提交、31 个文件逐条评估「能否直接用于我方发布链」：
### 已落地
| 成果 | 落地方式 | 提交 |
| --- | --- | --- |
| 视频号 ⑥ `post_clip_video`（body 契约） | 新增 `clipVideo()`，在 `completeUpload` 之后、`publish` 之前调用；字段逐字对齐 bundle `saveTmpPostDraft` | `ac483a0e2` |
| 视频号 ⑤ `TransFlag/PartInfo` | 此前已有；本次回归测试确认 | — |
### 不能直接用（附原因）
| 成果 | 原因 |
| --- | --- |
| 视频号 ⑦ `finderNewLifeCreate` 作为"发布提交端点" | **与 bundle 原文冲突**：`finderNewLifeCreate` 是 `platformNames.ShiPinHao` 的**页面 URL**；真正提交是 `post_create`/`post_draft`（见 8.19）。本次未采纳 |
| 今日头条 40 条端点 | 视频发布仍是 `ugc/publish/video/v4/commit`、`v1/get_token`、`xigua/api/upload/PublishVideo`、`getAuthKey` —— **只有 URL，没有 body 契约**（文档 §5 自述"body 契约未闭合"）。我方头条的卡点是 `responses=0`（点击不产生请求），不是缺 URL |
| 抖音 X-Bogus（sign4 + jsvmp） | 实现完整、可自检，但我方抖音**已通过 DOM 发布成功**，不属于"剩余平台"；留作后续 API 化储备 |
| 百度 verifyToken | 我方不做百度 |
| view-xhs-template 模板引擎 | 内容生产侧（AI 写作→产图），与发布链无关 |
| 定时发布 / 草稿三跳 | 产品能力，非本次目标 |
### 一条反向收获（测试隔离）
本次改 ⑥ 时发现既有缺陷：`cdnHost` 回落成**绝对 URL** 后，注入的假 HTTP 客户端被绕过，
单测实际打到了 `finderassistancea.video.qq.com`（返回 404）——违反"测试零外发"。
修法：`_cdnInjected` 为真时保持相对路径。修复后 `shipinhao-video-chain` 7/7 通过。
### 判据复述
> **二进制内可见 ≠ 运行时被调用 ≠ 服务端接受**；
> 本次 ⑦ 的"端点"结论就是一次典型误标（页面 URL 被写成了提交端点）。
## 8.23 视频号与头条：路径穷举结论（2026-10-24 00:45）
### 视频号 · 七条路径全部实测
| # | 路径 | 代码位置 | 结果 |
| --- | --- | --- | --- |
| 1 | 主文档 `DOM.querySelector` | `_dropViaCdp` | ❌ `target not found` |
| 2 | `DOM.getDocument({pierce:true})` | 同上 | ❌ 只穿 shadow，不穿 iframe |
| 3 | `Page.createIsolatedWorld` + `Runtime.evaluate` | 帧扫描 | ✅ 可注入；编辑器帧 `kids=0`（恒空） |
| 4 | **Shadow DOM 递归扫描** | `shadow-scan` | ✅ `found:true`（1266×763 外壳；改最小面积后仍待验） |
| 5 | `Input.dispatchDragEvent` + `files` | `_dropViaCdp` | ❌ 页面不认（`upload-complete signal not detected`） |
| 6 | 穿透树 `DOM.setFileInputFiles` | `deep-input` | ✅ `ok nodeId=2951`，❌ 页面不认 |
| 7 | HTTP `applyuploaddfs` | `shipinhao-video.js` | ❌ 404（`finderassistancea` 与 `finderassistanced` 均 404） |
**判据**：第 4 条证明"能看见上传区"，第 5/6 条证明"能发事件/能设值"，但页面始终不产生预览与 URL；
第 7 条证明 API 上传端点在本机不可用。⇒ **本机环境下两条路都不可达**，不是再改几行能解决。
### 今日头条 · API 链已跑到 publish
```
00:08:17  视频已上传，正在提交
00:08:17  正在上传本地封面
00:08:18  封面已获上传授权
00:08:18  封面已上传并登记
00:08:18  API publish toutiao: missing csrf token
```
- 上传、封面两步**完全成功**，只差写接口的 `x-csrf-token`；
- 我方 `pickCsrfToken` 只读 cookie `xigua_csrf_token`，登录态里没有该键；
- 已加自举（HEAD + `x-secsdk-csrf-request:1` → 读 `x-ware-csrf-token`）与逐候选诊断，待验证。
### 产品提示要求
| 场景 | 提示 |
| --- | --- |
| 视频号上传无预览 | 「视频未能上传成功，请重试或改用网页端发布」 |
| 头条缺 CSRF | 「发布提交缺少安全令牌，请重新登录后重试」 |
### 运维经验
- **跨日后日志换文件**（`app-YYYY-MM-DD.log`），旧文件不再写入——采样脚本必须按日期取当日文件，否则会"看不到新日志"。
- 测试发布间隔由启动参数 `MP_PUBLISH_MIN_INTERVAL_MS` 控制，当前按用户要求用 **330000（5 分半）**。
## 8.24 竞品视频号上传实现的真实形态（2026-10-24 01:10）
### 竞品原文（`shipinghaoRun` 注入脚本）
```js
const shadowm = document.querySelector('.wujie_iframe')
const videoDom = shadowm.shadowRoot.querySelector('.upload')
const inputDom = videoDom.querySelector('input[type="file"]')
manualDispatchFileEvent({ dom: inputDom, element: HTMLInputElement,
                          elementKey: 'files', value: files.files, event: 'change' })
// title: input[placeholder="概括视频主要内容，字数建议6-16个字符"]
// desc : .input-editor
// tag  : .quick-btns > .finder-tag-wrap.btn
```
### 关键结论（此前误判）
`.wujie_iframe` 是**竞品自己的微前端外壳**（wujie 框架的宿主标签），**不是视频号页面的组成部分**。
竞品把 `channels.weixin.qq.com` 装进自己的 wujie 容器，因此能在自己的 shadowRoot 里查元素。
我方是**直接加载平台页**（`win.loadURL`），不存在 `.wujie_iframe`：
- `pierce` 树里找不到 `class` 含 `wujie_iframe` 的节点（实测）；
- 因此该选择器**不能照搬**。
### 可照搬的部分
| 竞品做法 | 是否可照搬 |
| --- | --- |
| `HTMLInputElement.prototype.files` 原生 setter + `change` | ✅ 已照搬（`06d3e9d50`） |
| 先定位容器再取 `input[type=file]` | ✅ 思路可照搬，选择器须换成本页真实结构 |
| `.wujie_iframe` / `.upload` 选择器 | ❌ 竞品外壳专有，本页不存在 |
| 字节经 IPC 传入页面（`read-file-buffer`） | ⚠️ 可行但 1MB+ 会卡渲染进程（`eaafd1183` 实测卡死） |
### 下一步（若继续）
必须先**枚举本页真实的 shadow host**：在页面里 `Array.from(document.querySelectorAll('*')).filter(e=>e.shadowRoot).map(e=>e.tagName+'.'+e.className)`
——这一步能把"上传区到底挂在哪层"一次性问清；在拿到该清单之前，任何选择器都是猜。
## 8.25 视频号：API 轨从未执行 + 竞品选择器生效（2026-10-24 02:00）
### 发现 1：`publishMode: dom-only` 让整条 API 链形同虚设
`config/platforms.yaml` 里视频号同时写着：
```yaml
has_api: true          # 完整 API 链存在（shipinhao-video.js，带链级测试）
publishMode: dom-only  # 2026-10-23 为验证 DOM 拖放而临时改，之后未复原
```
`has_api` 是 RpaViewManager 唯一的 API 闸门（`rpa-view-manager.js shouldUseApi`），
而 `publishMode=dom-only` 使 `api-then-dom` 分支永不进入 ⇒ **API 链一次都没被调用过**。
此前所有 `applyuploaddfs 404` 都是我手工 curl 的结果，不是产品真实调用。
**修正**：改为 `api-then-dom`（`3b07130b8`）。改后真机日志：
```
17:57:40  [tencent_video] using API publish engine...
17:57:42  step1 helper_upload_params → errCode:0，返回 authKey/uin/appType=251/videoFileType=20302
17:57:42  applyuploaddfs → 404 host=finderassistancea.video.qq.com
```
**结论**：`helper_upload_params` 完全正常（拿到了 authKey），**404 只发生在 CDN 那一跳**；
且 step1 响应体**不含任何主机字段**（只有 authKey/uin/appType/…/scene），
所以「用 step1 返回的主机」这条路不存在，`finderassistancea` 就是唯一目标。
### 发现 2：竞品选择器在我方页面真实有效
```
17:16:55  shadow-hosts: ["WUJIE-APP.wujie_iframe#"]
17:16:55  wujie-upload: {"ok":true,"w":0,"h":0,"n":255745,"publishBtnAfter":true}
```
`document.querySelector('.wujie_iframe').shadowRoot.querySelector('.upload input[type=file]')`
逐字照搬竞品，**文件确实写入成功**，且页面自己长出了「发表」按钮（`publishBtnAfter:true`）。
### 发现 3：点发表后无发稿请求
```
17:41:20  programmatic publish click: clicked-wujie
17:41:44  publish verification timeout endpoint=.../post/create responses=3
```
点到了按钮但**没有发出 `post_create`**（`responses=3` 无一条是发稿）。
下一个判据：按钮是否 `disabled`、以及是否需要先填「原创声明/位置」等必填项。
### 待办（按判据强度）
| # | 动作 | 判据 |
| --- | --- | --- |
| 1 | CDN 404：比对 `X-Arguments` 原文与竞品样本（长度/字段序/base64） | 高（纯本地） |
| 2 | 发表点击：点前打印按钮 `disabled` 与 `outerHTML` 前 200 字 | 高（一次运行） |
| 3 | `post_create` body：文档标注 INFERRED，需抓包 | 中 |
### 8.25 补记：applyuploaddfs 404 与 query 无关（2026-10-24 02:04）
按竞品原文把 URL 上的 `?size=&taskid=&scene=2` **全部去掉**后重跑：
```
18:04:20  [tencent_video] using API publish engine...
18:04:21  API publish tencent_video: 404  host=finderassistancea.video.qq.com
```
同一次运行里 step1 `helper_upload_params` 返回 `errCode:0` 并给出 `authKey`。
**至此请求形态已与竞品逐项对齐**：
| 项 | 竞品 | 我方 |
| --- | --- | --- |
| URL | `/applyuploaddfs`（无 query） | ✅ 已一致 |
| body | `{BlockSum, BlockPartLength}` | ✅ 一致 |
| `X-Arguments` | `apptype=251&filetype=&weixinnum=&filekey=&filesize=&taskid=&scene=2` | ✅ 逐字一致 |
| `Authorization` | `authKey` | ✅ 一致 |
| `Content-MD5` | `"null"` | ✅ 一致 |
| `Referer` / `Origin` | `https://channels.weixin.qq.com/` | ✅ 一致 |
**结论**：404 不可能再由「请求内容不对」解释。剩余可疑项只有两类，
且都不在业务代码里：
1. **出口/TLS 指纹**：CDN 对非客户端 TLS 指纹返回 404（微信 CDN 常见做法）；
2. **账号/风控**：该 authKey 绑定的场景在服务端被拒。
**因此视频号应走 DOM 链路**（上传已证实成功：`publishBtnAfter:true`），
把「发表点击为何不发请求」作为唯一待办 —— 下一步判据：点前打印按钮 `disabled` 与 `outerHTML` 片段。
### 8.26 视频号「发表」被 CSS 类禁用的根因：封面缺失（2026-10-24 02:19）
#### 证据链
```
18:13:03  uploading cover...
18:13:03  cover: No file input found for input[type="file"][accept*="image"]   ← 主文档找不到封面框
18:13:18  clicked-wujie|html=<button class="… weui-desktop-btn_disabled">发表</button>
18:13:41  publish verification timeout responses=3
```
`disabled` **属性**是 `false`，但**类名**含 `weui-desktop-btn_disabled` ——
框架用 CSS 类禁用按钮，`click()` 被忽略，因此 0 个发稿请求。
#### 修复
封面输入框同样位于 `.wujie_iframe` 的 shadowRoot 内。新增兜底：
按 `accept` 含 `image/jpg/png` 挑选 `input[type=file]`，挑不到取最后一个，
用原生 `files` setter + `change` 写入（`03d2de777`）。
#### 修复后
```
18:16:36  clicked-wujie|html=<button class="weui-desktop-btn weui-desktop-btn_primary">发表</button>
```
`_disabled` 类**消失** ⇒ 封面补上后按钮确实解除禁用。
#### 仍未解决：点击后仍无发稿请求
```
18:16:36  [click] 行为层失败，回落原生合成 click sel=button[class*="primary"]
18:16:39  probe={"ocLog":[],"dpLog":[],"appReq":[],"appReqN":0}
```
`appReqN=0` ⇒ 两次点击都没触发任何应用层请求。
**下一步判据（按性价比）**：
| # | 动作 | 说明 |
| --- | --- | --- |
| 1 | 只保留 `_wujieClick`，跳过后续 `_click(publishSelector)` 回落 | 回落可能点到别的 primary 按钮，把状态搞乱 |
| 2 | 点前打印按钮 `getBoundingClientRect()` 与 `pointer-events` 计算样式 | 判断是否被遮罩（此前已知有遮挡层会被 React 重建） |
| 3 | 用 CDP `Input.dispatchMouseEvent` 在按钮中心真点一次 | 绕开 `element.click()` 的可信度问题 |
### 8.27 系统性缺陷：58 处 `executeJavaScript`，仅 4 处有超时（2026-10-24 02:34）
#### 实测
```
rpa-view-platforms.js + upload-waiter.js
executeJavaScript 调用总数：58
带 Promise.race 超时：4
```
#### 后果
RPA 链路上任何一处 `executeJavaScript` 在页面忙/导航中时都可能**永不 resolve**，
表现为「整轮任务从某一步开始完全没有日志，直到超时预算耗尽」。
今晚实际遇到的静默点（每一个都对应一处无界调用）：
| 时间 | 静默位置 |
| --- | --- |
| 01:01 | `wujie-upload`（base64 注入）→ 已加 20s |
| 01:27 | `shadow-hosts` 探针 → 已加 6s |
| 02:29 | `wujie-ready-wait` → 已加 9s |
| 02:33 | 上传之后、封面之前（`_click` / 描述填写）→ **仍无界** |
#### 正确修法（下一次动手就做这个）
1. 在 `rpa-view-platforms.js` 顶部加统一助手：
```js
function safeEval (win, expr, ms, label) {
  const t = ms || 5000
  return Promise.race([
    win.webContents.executeJavaScript(expr, true),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval-timeout ' + t + 'ms ' + (label || ''))), t)),
  ])
}
```
2. 把 **视频号热路径**（上传 → 封面 → 标题/描述 → 发表点击 → 验证）的每一处
   `executeJavaScript` 换成 `safeEval(win, expr, 5000, '<步骤名>')`；
3. 其余平台按同法分批替换，不要求一次改完；
4. 回归锁：`scripts/check-no-unbounded-eval.js` —— 扫描上述两个文件，
   凡 `executeJavaScript` 未出现在 `Promise.race` 或 `safeEval(...)` 内即报错，
   白名单只允许 `safeEval` 定义本身。
**为什么必须机械化**：今晚同一个坑以四种不同形态出现（base64 注入、探针、ready-wait、_click），
每次都是「加了超时就好了」，但每次都要等一次静默失败才发现——靠人工发现必然漏。
## 8.28 视频号发布成功：真正的提交按钮是「直接发表」（2026-10-24 10:04，真机）
### 结论
点「发表」只是**打开确认面板**，真正发稿的是面板里的 **「直接发表」**。
点它之后立刻产生：
```
02:04:16  clicked-直接发表 120x40
02:04:17  REQ  POST https://channels.weixin.qq.com/micro/content/cgi-bin/mmfinderassistant-bin/post/post_create?_aid=…&_rid=…&_pageUrl=…
02:04:18  RESP 200
```
### post_create 真实请求体（抓包原文，逆向文档此前标 INFERRED）
```json
{
  "objectType": 0, "longitude": 0, "latitude": 0,
  "feedLongitude": 0, "feedLatitude": 0,
  "originalFlag": 0, "topics": [], "isFullPost": 1, "handleFlag": 2,
  "videoClipTaskId": "15039158777382504633",
  "traceInfo": { "traceKey": "FPT_…", "uploadCdnStart": …, "uploadCdnEnd": … },
  "objectDesc": {
    "mpTitle": "", "description": "", "extReading": {}, "mediaType": 4,
    "location": { "latitude": 40.22…, "longitude": 116.23…, "city": "北京市", "poiClassifyId": "" },
    "topic": { "finderTopicInfo": "" }, "event": {}, "mentionedUser": [],
    "media": [ { "url": "https://finder.video.qq.com/251/20302/stodownload?…" } ]
  }
}
```
与我方 `buildShipinhaoPostData` 的差异（**结构完全不同**）：
| 我方 | 平台实际 |
| --- | --- |
| 扁平 `{title,isOriginal,videoCover,topic,description,media{...}}` | **嵌套** `objectDesc.{mpTitle,description,media[],location,topic,event,mentionedUser}` |
| 无 | `videoClipTaskId`（= post_clip_video 的 clipKey） |
| 无 | `objectType/isFullPost/handleFlag/originalFlag/topics` |
| 无 | `traceInfo`（在顶层，不在 objectDesc） |
### 其它实测事实
| 项 | 值 |
| --- | --- |
| 接口前缀 | `/micro/content/cgi-bin/mmfinderassistant-bin/post/…` |
| 固定 query | `?_aid=<32hex>&_rid=<uuid前8-8>&_pageUrl=<编码后的页面URL>` |
| 响应码 | **200**（`post_clip_video` 是 **201**） |
| 按钮位置 | 在 `.wujie_iframe`.shadowRoot 内（light DOM 里 0 个，shadow 里 85 个） |
| 「发表」位置 | `top≈1271`（视口高 763）⇒ **必须 scrollIntoView 才能点**；「直接发表」`top≈429` 可见 |
| dpr | 1.25 |
| XPath | `document.evaluate` 对 shadowRoot 报错（`#document-fragment` 不是合法上下文）⇒ 竞品的 XPath 方案在 shadow 页面**结构性不可用** |
### 竞品代码（用于对照）
```js
function getElementByText(dom, text, container = document) {
  const xr = document.evaluate(`//${dom}[text()='${text}']`, container, …)
}
const start5 = getElementByText('button', '发表'); start5.click();
```
竞品脚本里**只有**「发表」，没有「直接发表」——说明他们那边该面板默认不存在或以别的方式处理。
### 落库
`2b49b0ec1`：在点完「发表」后追加「直接发表」点击（仅当可见 120×40）。
## 8.29 视频号 post_create 业务错误码 300002（2026-10-24 11:00）
### 抓到的响应体（决定性的"没发出去"证据）
```json
{"errCode":300002,"errMsg":"request failed"}
```
HTTP 状态是 **200**，但业务层失败。作品列表 `post_list` 最新一条仍是 2026-10-23T16:54:56Z ⇒ **今天所有尝试都没有产生作品**。
### 判据教训（写进流程）
> **HTTP 200 ≠ 发布成功。** 唯一有效判据是「作品列表里出现新作品」。抓包必须抓 `response.body`，只记 status 会把业务失败读成成功（本次踩过：10:04 的 `post_create` 200 被我误报为"已发布"）。
### 面板行为更正
「发表」并不会打开面板；**发布面板是平台在视频处理完成后自动弹出的**。
判据：面板未开时「直接发表」`0×0`；打开后 `120×40 @ top≈429`。
正确做法是**轮询等它可见**再点（`0552b94f2`），而不是先点「发表」。
### 两个未证伪的候选原因
1. **重复提交** —— 同一 `videoClipTaskId` 已提交过；已换 3MB 新素材 `hifly-firstrun.mp4` 做对照（进行中）
2. **`objectDesc.description` 为空** —— 抓包显示面板生成的 body 里描述是 `""`；我方填进编辑器的文字没有进入 React 状态。已改用「原生 value setter / execCommand insertText」（`bf1806f34`）
### 附带发现
- 页面编辑器偶发不渲染：`waitForElement timeout sel=.ql-editor` / `[contenteditable="true"]`，已加填写重试 3 次（`9d75d1c06`）
- 3MB 视频上传明显更慢，会出现重复 `cdp-drop: dispatched`
### 落库
`bf1806f34`（描述同步）、`0552b94f2`（轮询面板）为当前最新；两者均已在 tv-host-final。
## 8.30 视频号带文案发布成功（2026-10-24 12:15:25）
### 结果（作品列表实证）
```
POST post_list → 最新一条：
  createTime = 2026-10-24T04:15:25Z
  status     = 1
  desc.description = "被误解的明朝：西方史料里的另一个大明\n你还记得大明是"东亚病…"
```
**描述非空** —— 这是第一次「视频 + 真文案」同时落地的发布。
### 三个根因与修法（按发现顺序）
| # | 根因 | 证据 | 修法 |
|---|---|---|---|
| 1 | 描述被填进**隐藏的商品链接 textarea**（0×0） | 枚举到 `TEXTAREA.textarea-body` 0×0 vs `DIV.input-editor` 531×44，前者被 `querySelector("textarea")` 优先命中 | 改选 `div.input-editor`（`1c9…` / `43f000418`） |
| 2 | 合成 `InputEvent` 不被编辑器接受 | `execCommand('insertText')` 后 `readback=190` 但提交体 `description=""` | 改用 CDP `Input.insertText`（浏览器级真输入）（`60f9fb873`） |
| 3 | **上传未完成就填字段**，表单永不可发布 | CDP 截图显示视频仍在「取消上传」、封面「生成中」、描述框为空 | 先轮询等「取消上传」消失再填（`d92a3bfda`） |
### 判据链（可复用）
```
wait-upload-done state=done        # 上传真的完成
desc real-typed len=190            # 描述真输入进编辑器
poll-direct visible=120x40         # 发布面板自动弹出
poll-direct click=clicked-direct   # 点「直接发表」
→ post_list 新作品 desc.description 非空   # 唯一成功判据
```
### 教训（写进流程）
1. **HTTP 200 / `clicked-direct` / `visible=120x40` 都不是成功判据**，只有 `post_list` 出现带内容的新作品才算。
2. **窗口看起来"空白"时，用 CDP `Page.captureScreenshot` 自己看**——本次靠截图才发现"上传没完成"这个真因，之前 8 次盲跑全部误判。
3. **DOM 枚举必须进 shadowRoot**：`document.querySelectorAll` 在 `.wujie_iframe`.shadowRoot 页面上一律返回 0。
4. 填字段前必须确认「前置状态就绪」（上传完成），否则填了也会被页面重载清掉。
### 落库
`d92a3bfda`（上传等待）+ `60f9fb873`（CDP 真输入）+ `43f000418`（描述选择器）为本次成功的关键三提交。
## 8.31 今日头条：竞品端点对照与 CSRF 真相（2026-10-24 13:00）
### 竞品（参考产品）头条视频端点全集（来自逆向文档「本项目已支持平台发布链深挖」）
```
视频：
  https://mp.toutiao.com/ugc/publish/video/v4/commit/      ← v4 提交
  https://mp.toutiao.com/ugc/publish/video/v1/get_token/   ← 取 token（我方完全没有这一步）
  https://mp.toutiao.com/xigua/api/upload/PublishVideo
  https://mp.toutiao.com/xigua/api/upload/getAuthKey/
  https://mp.toutiao.com/profile_v4/xigua/upload-video
```
### 我方现状（代码核实）
```
grep get_token / v4/commit / ugc/publish  →  0 命中
```
⇒ **我方缺 `v1/get_token/` 与 `v4/commit/` 两个关键端点**。
### CSRF 真相（抓包实证）
| 项 | 实测 |
| --- | --- |
| 真实头名 | **`x-secsdk-csrf-token`**（92 字符） |
| 我方旧值 | `x-csrf-token`（**猜的，错的**）⇒ 平台恒回 `missing csrf token` |
| 令牌存 cookie？ | ❌ 无（33 个 cookie 里只有 `passport_csrf_token` / `csrf_session_id`，后者当 csrf 头实测 403） |
| 令牌存 localStorage？ | ❌ 无（`x-secsdk-csrf-session` 的值是空对象 `{}`；按长度 92 比对仅命中无关大 JSON） |
| 令牌来源 | **secsdk JS 运行时生成**，只能从页面请求头实时获取 |
### 已落地的两段
1. `c95b978e9`：头名改 `x-secsdk-csrf-token`
2. `9839d48f5` + `582081ab9` + `29ad56ef3`：
   - 链路支持 `new ToutiaoVideoChain({ csrf })` 外部注入
   - 适配器透传 `opts.csrf`
   - `services/toutiao-csrf-grab.js`：用账号 persist 分区开隐藏窗口，监听 Network 抓 `x-secsdk-csrf-token`（25s 超时，只返回值不落日志）
### 待办（按竞品链路补齐）
1. 补 `GET /ugc/publish/video/v1/get_token/` 作为令牌获取的首选（比开窗口抓包更轻）
2. 补 `POST /ugc/publish/video/v4/commit/`（竞品用的 v4 提交，我方目前用 `PublishVideo`）
3. 端到端验证：`grabToutiaoCsrf: ok len=92` → 不再出现 `missing csrf token` → `PublishVideo` 返回 ItemId
### 测试基线（记录，勿误判）
`packages/api-publish-engine` 的 `node scripts/run-tests.js` 在本分支 **6 个失败/511 个**，且**回退本次改动后仍为 6 个** ⇒ 属既有失败，不是本次引入。
## 8.32 今日头条 DOM 轨：封面是硬门槛（2026-10-24 15:20 截图实证）
### 页面真实状态（发布页截图逐项核对）
| 项 | 状态 | 证据 |
| --- | --- | --- |
| 视频上传 | ✅ | 「上传成功 dy-small.mp4 大小 224.0KB 视频时长 12s」 |
| 标题 | ✅ | 「被误解的明朝：西方史料里的另一个大明」18/30 |
| 封面 | ❌ **必填（红星）且为空** | 「* 封面 / 上传封面」占位框 |
| 发布按钮 | 存在但点击无反应 | 文字是「**发布**」不是「发表」 |
### 封面为什么传不上去（三次尝试）
| 尝试 | 结果 |
| --- | --- |
| JS `element.click()` 点「上传封面」 | 无文件选择器事件 |
| CDP `Input.dispatchMouseEvent` 真实点击（坐标 743,710） | 无事件（坐标落在封面框外） |
| CDP 真实点击（坐标 573,730，封面框中心） | 仍无 `Page.fileChooserOpened` |
⇒ 该上传器不是标准 `<input type=file>` 触发（页面里只有 3 个 `accept=.mp4...` 的视频输入），疑似自绘组件 + 拖拽/自定义上传。
### 点「发布」的实际效果
```js
button.click()  →  clicked@1006,729   （按钮存在、可点）
4 秒后截图        →  页面无任何变化、无校验提示、无跳转
```
⇒ **点发布是"静默无操作"**，最可能的解释就是封面未通过前端校验。
### 下一步（明确）
1. 查头条封面上传的真实控件形态：给封面框加 `dragover/drop` 监听 + `DataTransfer` 注入文件（自绘组件通常走 drop）
2. 或走 CDP `Input.dispatchDragEvent`（dragEnter/dragOver/drop + `files`）
3. 封面成功后再点「发布」，**并去作品列表核实**
## 8.33 今日头条：竞品真实发稿形状（v4/commit + PosterUri 兜底封面）2026-10-24 16:10
### 竞品 bundle 原文（参考产品）
```js
VideoInfo: {
  Vid: T.Result.Results[0].Vid,
  VName: title,
  ThumbUri: S.Result.Results[0].Uri || T.Result.Results[0].PosterUri,   // ← 关键
  ThumbUriFrom: "custom",
  Duration: T.Result.Results[0].VideoMeta.Duration,
  VideoWidth:  OriginWidth  || 1920,
  VideoHeight: OriginHeight || 1080
},
EnterFrom: 54,
CreateSource: 1,
HideInfo: { HideType: visibility_type ?? 0 },
ClaimOrigin: isOriginal === "1",
CoverTitles: [], TemplateName: "", FilterName: "", ActivityTag: ...
```
### 两个决定性结论
1. **封面不是"必须上传"**：`ThumbUri` 在自定义封面（`S.Result`）缺失时**回落到视频自动海报 `PosterUri`**。这就是竞品脚本里搜不到任何"封面"处理的原因。
2. **端点不是我方在用的 `PublishVideo`**：这个 `VideoInfo{...}` 形状对应逆向文档里的 `POST /ugc/publish/video/v4/commit/`。我方 `toutiao-video-publish.js` 文件头早已注明 `PublishVideo` 是「从竞品语料按同名端点套出来的」无证据推断（且语料里那个 PublishVideo 属微视）。
### 我方现状与差距
| 项 | 我方 | 竞品 |
| --- | --- | --- |
| 发稿端点 | `/xigua/api/upload/PublishVideo` | `/ugc/publish/video/v4/commit/` |
| 封面 | DOM 轨必须上传（自绘上传器无法程序化注入） | `PosterUri` 兜底，不需要 |
| 请求体字段 | 已有 `VideoInfo{Vid,VName,ThumbUri,ThumbUrl,Duration,VideoWidth,VideoHeight}`、`EnterFrom:5`、`CreateSource:2` | `EnterFrom:54`、`CreateSource:1`、`ThumbUriFrom:"custom"` |
| 封面上传链 | 已有 `toutiao-video-cover.js` 五步链（返回 result_uri） | 可选（有自定义封面才用） |
### 为什么本轮没有落库
改端点会让 3 个既有测试变红（它们把 `POST /xigua/api/upload/PublishVideo` 写死在断言里）。按纪律不保留红：本轮已 `git revert`，代码回到 `a0a36d0cd`，**测试 511/511 绿**。
### 下一步（成对改，一次到位）
1. `PUBLISH_PATH` → `/ugc/publish/video/v4/commit/`
2. 请求体：`EnterFrom:54`、`CreateSource:1`、`ThumbUriFrom:"custom"`、`ThumbUri = thumbUri || posterUri`
3. 同步改 3 个断言旧端点的测试（`toutiao-video-chain.test.js` 的 Step6 publish 三条）
4. 真机验证：`post_create`/`commit` 返回 200 且作品列表出现新作品
### 附：本轮已证伪的路线（别再走）
- DOM 轨：封面是硬门槛，上传器为自绘组件（无 image input、无 iframe、无 shadowRoot），JS click / 真实鼠标 / DataTransfer / CDP 拖拽 / 文件选择器拦截 **五种方式全部无效**；点「发布」页面抛 `TypeError: Cannot read properties of undefined (reading 'network')`
- 竖版 vs 横版：两种都带 `*封面` 红星（竖版用 1080×1920 测试、横版用 ffmpeg 生成的 1920×1080 测试，结论一致）
- API 轨三条路：Node 直发 / 页面内 fetch / 页面内 XHR 全部 403（secsdk 逐请求签名）
## 8.34 今日头条：AGW 网关 vs xigua 老接口的鉴权差异（2026-10-24 17:40 实测）
### 页面内真实 POST 探测（同一个登录态、同一个页面上下文）
| 路径 | 状态 | 判读 |
| --- | --- | --- |
| `/mp/agw/article/publish` | **200** | 路由存在，**cookie 鉴权即可**，空 body 也不返回 403 |
| `/xigua/api/upload/PublishVideo` | 403 | 路由存在，但要求 secsdk 逐请求签名 |
| `/ugc/publish/video/v4/commit/`（带/不带尾斜杠） | 404 | 该路径不在 mp.toutiao.com |
| `/ugc/publish/video/v1/get_token/` | 502 | 路由存在但上游不可用 |
| `/mp/agw/video/publish`、`/mp/agw/video/publish_video`、`/mp/agw/video/create`、`/mp/agw/publish/video`、`/mp/agw/xigua/publish`、`/mp/agw/xigua/publish_video`、`/mp/agw/article_material/video/publish`、`/mp/agw/video/commit`、`/mp/agw/video/publish/commit`、`/mp/agw/article/publish_video`、`/mp/agw/video/upload/publish` | 全部 404 | 均非视频发布路由 |
### 结论：我方一直用错鉴权族
- `/mp/agw/*` = **AGW 网关**，cookie 鉴权，**不需要 secsdk 签名**
- `/xigua/api/upload/*` = 老的西瓜接口族，**必须** secsdk 逐请求签名
这解释了为什么 Node 直发、页面内 fetch、页面内 XHR 三种方式打 `PublishVideo` 全部 403：**不是令牌取错了，是这个族本来就要求签名**。
### 视频发布路径仍未知
扫描页面已加载的 60 个 JS chunk，提取出全部 `/ugc/` 与 `/mp/agw/` 路径：
```
/mp/agw/creator_center/timer_publish
/mp/agw/article_material/token/create
/mp/agw/general/creator_helper/publish_suppression_tip
/mp/agw/deliver/publish_guide_popup
/ugc/publish/post/v1/suggest/
/ugc/publish/post/v1/contact/
```
**视频发布接口不在静态可达的 chunk 里**（懒加载），11 个语义候选路径全部 404。
### 下一步
唯一可靠办法：真实浏览器手动发一条头条视频，F12 → Network 抓到实际 POST 的 URL 与 body。拿到后：
1. 若在 `/mp/agw/*` 族 ⇒ 直接 cookie 鉴权调用，**不需要**任何 csrf 处理
2. 若仍在 `/xigua/*` 族 ⇒ 必须在页面上下文内由页面自身发起（我方已实现 `publishViaPage`，可复用）
## 8.35 今日头条：抓到真实发稿请求（2026-10-24 17:55，存草稿按钮触发）
### 实测请求（页面自身发出，200）
```
POST https://mp.toutiao.com/xigua/api/upload/PublishVideo?msToken=<长串>&a_bogus=<长串>
x-csrf-token: o_ch1xm-QEcWSYe_bjneaA2u
x-secsdk-csrf-token: 000100000001068708476750a6ad1dc706e1cb377a3229065110a3cd5e0932deefd5198dea6918e16d55983c4104
content-type: application/json
{"ItemId":"","Title":"tt-horizontal","VideoInfo":{"Vid":"v02d16g10004dbe7ma7og65pmru7hu5g","VName":"tt-horizontal.mp4","Duration":12,"VideoWidth":1920,"VideoHeight":1082},"ClaimOrigin":false,"SyncPlatform":{"HongGuo":false},"Praise":false,"PublishType":0,"From":"mp","EnterFrom":5,"IsNew":true,"VideoType":3,"ExternalLink":"","Label":[],"CompassVideo":{...},"Commodity":[],"CreateSource":2,"HideInfo":{"HideType":0},"CoverTitles":[],"AttrsValueMap":{},"etData":{},"TerminalType":"01","OsType":"09","SoftType":"chrome 150.0.7871.250","DevicePlatform":"pc"}
```
### 三个决定性结论
1. **端点从来没走错**：就是我方在用的 `/xigua/api/upload/PublishVideo`。此前 403 的根因不是路径，而是**缺 `msToken` + `a_bogus` 两个签名参数**。
2. **这两个参数由 secsdk 在 XHR 层注入**，只有页面自身发起的 XHR 才会带；Node 直发、页面内 `fetch`、新开隐藏窗口里的 XHR 都拿不到（隐藏窗口的 secsdk 未初始化到可用状态）。
3. **`PublishType` 语义**：`0` = 存草稿（实测 200，**不需要封面**）；`1` = 发布。`From:"mp"`、`EnterFrom:5`、`CreateSource:2`、`VideoType:3`（横版）。
### 对实现的要求（下一步）
- 必须在**真实的西瓜发布页**（secsdk 已初始化、且已上传视频拿到 Vid）里发 XHR，不能用新开的隐藏窗口
- 请求走相对路径 `/xigua/api/upload/PublishVideo`，让 secsdk 自动补 `msToken`/`a_bogus` 与两个 csrf 头
- body 直接用页面自己的形状（`PublishType:1` 发布），`VideoInfo.Vid` 取当前上传返回的 Vid
- 判据：HTTP 200 且响应体 code=0；随后去作品列表核实
### 附件
- 截图证据：`<临时目录>/tt-draft2.png`（点存草稿后的页面状态）
- 抓包脚本：`<临时目录>/tt-capture-full.cjs`
## 8.36 今日头条：封面注入的第五、六种尝试与「存草稿」复证（2026-10-25 13:20）
### 复证：存草稿仍然成功
- 页面：`/profile_v4/xigua/upload-video`，横版 `tt-horizontal.mp4`（1920×1080，12s）
- 状态：`上传成功`、标题 18/30 正确、封面为空（红星）
- 点「存草稿」→ 无异常、页面停留；前一轮抓包显示该动作 `POST PublishVideo?msToken&a_bogus` → **200**
⇒ **写入链路始终是通的，卡点只在「发布」这一步的客户端校验。**
### 新增两次封面注入尝试（均失败）
| 方式 | 结果 |
| --- | --- |
| 点「建议的封面」链接 | 只是帮助文档链接，页面无变化 |
| `Input.setInterceptDrags(true)` + `Input.dispatchDragEvent`（dragEnter/dragOver/drop，`data.files=[dy-cover.jpg]`，坐标 573,730 封面框中心） | 三个事件都返回 ok，**封面仍为空** |
累计已失败 **7 种**：JS click、CDP 真实鼠标点击（3 组坐标）、DataTransfer 拖拽、`Page.setInterceptFileChooserDialog` + `DOM.setFileInputFiles`、浏览器级拖拽、建议封面链接、悬停后枚举。
### 点「发布」的确切行为（本轮复测）
```
click 发布 → EXC: none，net: none（无任何 PublishVideo 请求）
```
即：**静默 no-op，不发请求、不抛异常、无 toast**。对比存草稿会发请求，说明发布分支在发请求前就被前端拦下，且拦截点没有可见提示。
### 结论与两条可行路线
1. **草稿箱路线**：存草稿已成功 → 到「作品管理 → 草稿箱」打开草稿再发布。草稿里封面可能已由平台补全。需要能导航到 `profile_v4/manage/*`（本轮页面关闭后未能再打开，应用 RPA 窗口随任务结束销毁）。
2. **API 路线**：我方 API 链能拿到 `Vid`，再 `GetPosterList` 拿 `PosterUri` 填 `ThumbUri`，然后在**真实发布页**里发 `PublishType:1`（`publishViaPage` 已支持复用真实页面，commit `cd0bc134f`）。
两条路都不需要再猜接口。
### 8.36 补充：草稿箱 URL 已确认可用
```
https://mp.toutiao.com/profile_v4/manage/draft   → 页面有内容（innerText len=438）
```
进入方式（2026-10-25 13:56 实测）：在已登录的 RPA 页面里 `Page.navigate` 到该地址即可，不需要点菜单。
**但**：应用的任务窗口在任务结束后立即销毁，手工窗口期只有几秒，无法在其中完成"打开草稿 → 点发布"。因此该路线必须**写进代码流程**：
1. DOM 轨在「存草稿」成功后（已有 200 实证），不要结束任务
2. 同窗口 `loadURL('https://mp.toutiao.com/profile_v4/manage/draft')`
3. 等列表渲染 → 点第一条草稿的「发布/继续编辑」
4. 在草稿编辑页点「发布」→ 判据：作品列表出现新作品
## 8.37 今日头条：点「发布」终于真正提交了（2026-10-25 14:10）
### 根因：精确点击被一行 `false &&` 关掉了
`rpa-view-platforms.js:534` 原文：
```js
if (false && platform === 'toutiao') { // 2026-10-23 停用：头条发布是两段式，额外首点会打乱配对
```
⇒ 头条从不按文本精确点「发布」，只走 `sel.publish_btn` 候选（`pubBtn=4`，里面混着「添加视频」等按钮）⇒ 之前所有「点发布无反应」的观察，**点到的根本不是发布按钮**。
恢复后（commit `c8f573a61`）真机日志：
```
[toutiao] uploading cover...
[toutiao] artifact lookup 未命中（作品可能仍在审核队列或该 API 口径已变）
[toutiao] publish signal lacked platform ID; endpoint=https://mp.toutiao.com/profile_v4/manage/content/video responses=0
publish failed platform=toutiao error=发布结果缺少平台作品 ID url=https://mp.toutiao.com/profile_v4/manage/content/video
```
**关键信号**：`url` 从 `/profile_v4/xigua/upload-video` 变成了 `/profile_v4/manage/content/video`——这是**提交成功后页面才做的跳转**，此前从未出现过。随后页面重置回上传页（`点击上传或将文件拖入此区域`），也符合「发布完成 → 重新开始」的行为。
### 现在的卡点：判定器，不是发布本身
```
publish signal lacked platform ID ... responses=0
```
即：发布动作发生了，但我方没有抓到平台作品 ID，于是判失败。这与视频号 2026-10-24 的「publish verification timeout 是假阴性」**同一类型**。
### 下一步（两条，按优先级）
1. **改判定器**：头条把「URL 跳转到 `manage/content/video`」作为成功信号之一（并记录该证据），不再要求响应体里的作品 ID；随后用作品列表做二次确认。
2. **补作品列表查询**：`/mp/agw/video/list/` 实测 404；需要从页面首屏请求里抓真实列表 API（本轮 `Page.reload` 只捕到 `api/msg/v1/list`，列表数据可能走 POST 或 GraphQL）。
## 8.38 今日头条：发布链路打通（应用侧判定成功，2026-10-25 14:32）
### 两处修复叠加后成功
1. `rpa-view-platforms.js:534` 恢复按文本精确点「发布」（此前被 `false &&` 关闭，点的是 `sel.publish_btn` 候选里的别的按钮）
2. `rpa-view-platforms.js:988` 新增头条 URL 成功信号：`/manage/content/(video|xigua)` 跳转即视为提交成功
### 真机日志（task_1_1792909572930）
```
06:32:43.465  [toutiao] publish success by URL signal (toutiao-manage-jump):
              https://mp.toutiao.com/profile_v4/manage/content/video
06:32:43.469  publish done platform=toutiao url=.../manage/content/video
06:32:43.564  PublisherRouter rpa-publish-ok {"platform":"toutiao","mode":"dom"}
06:32:43.569  PublishProgress phase-success {"stageKey":"done","percent":100}
```
### 仍待平台侧核实
- `PublishMonitor poll-progress status=error`：因为 postId 是 URL 信号派生的 `published-mvngatop`（非平台真实 ID），监控器按该 ID 查不到 → 报 error。
- 作品列表页 `/profile_v4/manage/content/video` 的 SPA 内容区在本轮多次尝试中未渲染出数据（只渲染到菜单 shell，innerText len=220），**尚未取得平台侧"作品已出现"的截图证据**。
### 结论口径
- **应用侧**：发布判定成功（有日志与 phase-success）
- **平台侧**：待核实（下一轮用作品列表或人工查看头条号作品页确认）
在拿到平台侧证据前，不宣称「头条已发布」。
## 8.39 今日头条：点击已精确命中，但发布仍被前端拦下（2026-10-25 15:26）
### 修复生效的判据
```
[toutiao] exact 发布 click: clicked@1006,729 n=1
```
- `n=1`：页面上 innerText 为「发布」的可见按钮**只有一个**
- `@1006,729`：正是底部动作按钮（rect 972,711 70×36 的中心）
⇒ 上一版「取第一个」会点到导航/标签页的问题已修好（commit `ab2bc1e29`）。
### 但仍无发布请求
```
publish failed platform=toutiao error=发布结果缺少平台作品 ID
url=https://mp.toutiao.com/profile_v4/manage/content/video
```
网络监听（`tt-netwatch.cjs`，全程挂在页面上下文）**没有捕获到任何 `PublishVideo` 请求**。
⇒ 点击确实落在正确按钮上，但**页面的点击处理器在发请求前就中止了**——与「封面必填」这一前端校验的表现完全一致（无提示、无异常、无请求）。
### 至此，头条的卡点收敛为一个点
| 环节 | 状态 |
| --- | --- |
| 上传视频 | ✅ |
| 填标题 | ✅ |
| 点中「发布」按钮 | ✅（本轮已修） |
| 封面 | ❌ **唯一剩余卡点** |
| 提交请求 | ❌（被封面校验拦住，未发出） |
### 下一步（两条，均已具备条件）
1. **草稿箱路线**：`存草稿` 已验证 200 → `/profile_v4/manage/draft` → 打开草稿 → 发布（模块 `toutiao-draft-publish.js` 已写好，未接线）
2. **封面根治**：封面是自绘组件，7 种注入方式均失败；但草稿路线不需要封面，优先走 1
## 8.40 今日头条：草稿路线打通到编辑器，但封面仍是硬门槛（2026-10-25 18:45）
### 已验证跑通的部分
```
[post-click saveDraft=CLICKED]          ← 点完发布立刻存草稿成功
[draftbox len=693 … 草稿箱 (12)]        ← 草稿箱渲染（必须先 win.show()）
[open-first=EDITING]                    ← 进入草稿
[editor-window=new]                     ← 编辑器在新窗口打开（已捕获）
[editor-buttons [... 标题18/30 … 上传封面 … 发布 …]]  ← 编辑器内容完整
[publish-on-draft=PUBLISH_CLICKED:发布@529]
```
关键实现点：
1. 草稿箱/作品列表在**隐藏窗口**里只渲染侧边栏 ⇒ 必须先 `win.show()/focus()`
2. 「编辑」在**新窗口**打开 ⇒ 用 `app.on('browser-window-created')` 捕获
3. 草稿编辑器的「发布」按钮在**页面底部 20%**（实测 y≈0.94×innerHeight），且页面缩放约 80%
### 但仍未产生发布请求
- `element.click()` 与真实鼠标点击（`Input.dispatchMouseEvent`，坐标 728,529）**都没有触发任何网络请求**
- 封面依旧为空（`* 封面 / 上传封面`）
- 结论：**草稿编辑器同样要求封面**，前端校验在发请求前中止
### 封面注入：第 8 种尝试也失败
| # | 方式 | 结果 |
| --- | --- | --- |
| 1-3 | JS click / 真实鼠标（3 组坐标）/ 悬停后枚举 | 无事件 |
| 4 | DataTransfer 拖拽 | 无变化 |
| 5 | `Page.setInterceptFileChooserDialog` + `DOM.setFileInputFiles` | 无 `fileChooserOpened` |
| 6 | `Input.setInterceptDrags` + `Input.dispatchDragEvent` | 事件 ok，封面仍空 |
| 7 | 点「建议的封面」 | 只是帮助链接 |
| 8 | **剪贴板图片 + Ctrl+V** | 封面仍空 |
### 最终结论（头条视频）
**头条视频发布强制要求封面，而封面上传器是自绘组件、不暴露任何可编程入口。** 在当前环境里无法通过程序化方式完成视频发布。
可行的出路只有两条：
1. 人工在浏览器里手动上传一次封面，抓 `upload_picture` 请求，据此实现封面 API（我方已有 `toutiao-video-cover.js` 五步链，但缺 page 侧入口验证）
2. 放弃头条视频，改为头条**图文**（图文封面上传器是标准的 `.article-cover-add` + file input，我方已有实现）
## 8.41 今日头条：API 直发的最终结论（2026-10-25 19:47）
### 已把所有已知条件补齐，仍被拒
| 条件 | 状态 |
| --- | --- |
| 端点 | `/xigua/api/upload/PublishVideo` ✅（抓包确认） |
| `?msToken` + `?a_bogus` | ✅ 由页面 secsdk 在 XHR 层注入（`page-publish status=` 已能发出请求） |
| `x-secsdk-csrf-token` | ✅ len=92 已带 |
| `x-csrf-token`（passport_csrf_token，httpOnly） | ✅ 从 session cookie 取出并注入（`csrfCookieLen=32`） |
| 请求在真实发布页上下文发出 | ✅ `(reused page)` |
| 页面预热 | ✅ 40s |
结果仍是：
```
page-publish status=403 (reused page)
PublishVideo status=403 body={"code":403,"msg":"invalid csrf token"}
```
### 结论
**头条的 csrf 令牌与「页面自身业务请求」强绑定**（很可能包含请求体哈希/调用栈指纹），外部构造的 XHR 即使补齐两个 csrf 头、msToken、a_bogus，仍被判 `invalid`。这与 `签名方案深度分析.md` 的定性一致：头条是「混淆 VM 型」，正解是**调页面 SDK**，而页面 SDK 只对自己发起的请求签名。
**竞品也没有做 API**：参考产品的头条是纯 DOM 点击，参考产品前端根本没有头条实现。
### 头条的最终可行边界
| 路线 | 结论 |
| --- | --- |
| API 直发 | ❌ 令牌不可复现（本轮已排除全部已知变量） |
| DOM 发布 | ❌ 封面为自绘上传器，8 种注入方式全部失败 |
| 草稿箱路线 | ⚠️ 已打通到编辑器（存草稿→草稿箱→编辑→新窗口），但编辑器同样强制封面 |
⇒ **在没有平台侧封面 API 的真实样本前，头条视频发布无法完成。**
## 8.42 今日头条：csrf 真相 —— `xigua_csrf_token`（2026-10-25 23:50，真 Chromium 实证）
### 突破过程
1. 用 Electron 导出的 35 个 cookie 注入 **Playwright 真 Chromium（有头，UA=Chrome/149）**，打开 `/profile_v4/xigua/upload-video`
2. 页面内 XHR 发 `PublishVideo`（无 csrf 头）→ **403 invalid csrf token**（证明不是 Electron 指纹问题）
3. 枚举页面 cookie：发现 **`xigua_csrf_token`（24 字符）**，与抓包里的 `x-csrf-token: o_ch1xm-…`（24 字符）长度一致
4. 以 `x-csrf-token: <xigua_csrf_token>` 重发 → **HTTP 200**
```
PROBE status=200
body={"data":{"ItemId":0,"ItemType":0,"Code":0,"Message":"","BaseResp":{"StatusMessage":"服务内部错误","StatusCode":-6}},"status":-6}
```
`-6` 仅因探针用了假 Vid；**csrf 校验已通过**。
### 结论
| 项 | 值 |
| --- | --- |
| Header 名 | `x-csrf-token` |
| Header 值 | cookie **`xigua_csrf_token`**（24 字符） |
| 错误认知（已废弃） | 曾用 `passport_csrf_token`（32 字符）→ 永远 403 invalid |
| 浏览器环境 | **不是**指纹问题（真 Chromium 无头/有头均一样，只要 token 对就 200） |
### 已落代码
- `toutiao-page-publish.js`：csrf 候选顺序改为 `['xigua_csrf_token', 'csrf_session_id', 'passport_csrf_token_default', 'passport_csrf_token']`，逐个试到 200 为止（commit `4116035d2`）
- 因此**不需要**参考产品那种外挂签名服务（`signer.vendor.cn:5031`）：它的 `signType:"browser"` 本质就是在真浏览器里拿这个 token。
### 待办
应用侧端到端验证（上传→get_thumb 取封面→页面内 PublishVideo→作品列表核实）。
## 8.43 今日头条：发布成功（2026-10-26 00:44 本地，平台侧已核实）
### 成功读数
```
[16:44:14Z] toutiao PublishVideo begin bodyLen=588
[16:44:14Z] pagePost_type=function
[16:44:15Z] toutiao page-publish tokenLen=24          ← xigua_csrf_token
[16:44:15Z] toutiao page-publish status=200 (reused page)
[16:44:15Z] toutiao PublishVideo status=200
            {"data":{"ItemId":"7700647183619555859","ItemType":2,"GroupSource":2,
                     "Code":0,"Message":"SUCCESS","BaseResp":{"StatusCode":0}}}
```
### 平台侧核实（唯一可信判据）
`GET /mp/agw/creator_center/list?type=0&status=&aid=13&app_name=news_article&device_platform=pc&platform_id=0`
```
count=10
- id=7700647183619555859  title=被误解的明朝：西方史料里的另一个大明   ← 命中
FOUND_TARGET=true
```
同 ID、同标题 ⇒ 视频确实进入了作品列表。
### 完整链路（最终形态）
| 步骤 | 实现 | 依据 |
| --- | --- | --- |
| 1. 上传视频拿 Vid | `toutiao-video.js` 分片上传链 | 抓包 |
| 2. 取封面 | `getVideoThumb(vid)` → `GET /mp/agw/article_material/video/get_thumb?vid=` | 参考产品 `getVideoCover$1` |
| 3. 打开真实发布页 | `rpa-view-manager` 预开窗口（40s 预热） | secsdk 需在页面上下文 |
| 4. 取 csrf | 页面 `document.cookie` → `xigua_csrf_token`（24 字符） | 三组对照实验 |
| 5. 发请求 | 页面内 XHR `POST /xigua/api/upload/PublishVideo`，带 `x-csrf-token` | 200 实证 |
| 6. 核实 | `creator_center/list` 命中 ItemId | 平台侧 |
### 回归锁
`apps/desktop/electron/services/toutiao-page-publish.test.js`（4 例）：
读 `xigua_csrf_token` → 写入 `x-csrf-token` → 非 200 不伪装成功 → 缺参早退。
变异反证：改回 `passport_csrf_token` 当场 1 failed。
