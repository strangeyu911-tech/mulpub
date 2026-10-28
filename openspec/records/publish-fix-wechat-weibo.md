---
record: publish-fix-wechat-weibo
task: 修复微信公众号、微博的发布失败（B 站图文无通道，不在本片）
date: 2026-10-21
---

# 公众号与微博发布失败（publish-fix-wechat-weibo，2026-10-21）

> 分支 `publish-fix-wechat-weibo`（worktree `<worktree-root>/mp-worktrees/mp-publish-fix-wx-wb`），起点 `7f3ebb6` = 当时 origin/main。

## 现场

2026-10-21 14:28 那次多平台批量发布，`app-2026-10-21.log` 记录：

```
[ERROR] Executor Publish failed for wechat_mp: 微信公众号草稿保存未被平台确认（点击保存后 30 秒内既未跳转、也未出现「保存完成」提示）
[ERROR] Executor Publish failed for weibo: weibo no publish_url
[ERROR] Executor Publish failed for bilibili: bilibili 仅支持视频发布（api 轨只有视频链），当前任务为图文/无 video_path
```

三件事性质不同：

| 平台 | 根因 | 本片处置 |
| --- | --- | --- |
| 微博 | `config/platforms.yaml` 的 weibo 段**整段没有 `publish_url`**；选择器是旧版 DOM（微博已改版 React + woo 设计系统，旧判据全部 0 命中） | **已修** |
| 微信 | 两层：① 保存草稿走「行为层失败 → 合成 click」，微信后台忽略不可信事件（`appReq:0`/`xhr=none`）；② 保存按钮选择器命中的是隐藏元素，`:has-text` 兜底又选中了内容容器 | **已修** |
| B 站 | 图文没有发布通道（api 轨只有视频链，RPA 分支是视频投稿页） | 不在本片（能力边界，需专栏通道，属新功能） |

## 微博：真机取证 → 选择器重写

取证方式：用应用自己的 RPA 会话（`account-f2667801`，已登录）触发一次发布，在它填表阶段从 CDP 读页面结构。因为旧 `content_textarea` 判据必然落空，流程走不到「点发送」，不会误发。

实测结构（`<tmp>/weibo-dom-probe.json`）：

```
发布框  <textarea class="_input_1rz8r_8" placeholder="有什么新鲜事想分享给大家？">   ← 可见
发送    <button class="woo-button-main ... woo-button-primary ...">发送</button>      ← 可见
旧判据  .publisher_text textarea / .W_input / textarea[node-type="textEl"] /
        a[node-type="submit"] / .W_btn_b  → 全部 0 命中
```

落点：

- `config/platforms.yaml`：weibo 补 `publish_url: https://weibo.com/`（微博没有独立写文章入口，登录态下发布框就在首页）
- `packages/rpa-engine/src/platform-selectors.js`：`content_textarea` 首选 `textarea[placeholder*="有什么新鲜事"]`，`publish_btn` 首选 `button:has-text("发送")` / `.woo-button-primary`，旧判据保留在后做兼容
- 新锁 `packages/rpa-engine/tests/weibo-selectors-live-dom.test.js`（5 例）：新版判据必须在候选链最前（`_resolveSelector` 按顺序试，旧判据在前就是每次白等超时）、旧判据不得删除、**不得把 CSS Modules 哈希类名（`_input_1rz8r_8`）写进选择器**、图文任务不被视频选择器覆盖

## 微信：两层根因，都已修

### 第一层：点击不可信

保存草稿原本走「行为层失败 → `el.click()`」。微信后台**忽略不可信的合成 click**：

```
[click] 行为层失败，回落原生合成 click sel=a#js_sync_save...
[click] ... -> BUTTON||保存为草稿  probe={"ocLog":[],"appReq":[],"appReqN":0}
save done without mediaId (saved=false ... xhr=none)
```

按钮找到了、点了，但页面**一条请求都没发**。回退链补一档 CDP 可信点击（行为层 → `_clickViaCdp` → 合成 click）：

- 可信点击成功后**只读一次描述串，不补点**（会重复提交）
- 宿主没有 `_clickViaCdp`、它抛错或未命中，才落回合成 click 并 **warn 出声**（此前 `_click` 恒返回 true，假绿）
- 顺带修 `_clickViaCdp` 两个遗留缺陷：debugger attach **归属判断**（此前无条件 detach，会拆掉他方会话）、点击后**还原**被临时置 `pointer-events:none` 的遮挡层（`__mpPe` 只写不读）

### 第二层：按钮定位就是错的（更根本）

补上可信点击后复跑，日志出现了决定性的落点证据：

```
[clickTrusted] a#js_sync_save, a[data-actio -> TRUSTED@630,369
[click] CDP 可信点击生效 ... -> DIV|mp-body |Touchannel
```

点击坐标 630,369 是**页面中心**，落点描述是 `DIV|mp-body` —— 点的是正文容器。于是再从编辑页取真实结构（`appmsg_edit_v2&action=edit` 底部工具条）：

```
保存为草稿  <span id="js_submit" class="btn btn_input btn_primary r">保存为草稿</span>  ← 可见 98×36
发表        <span id="js_send" ...>发表</span> / <button class="mass_send">
预览        <span id="js_preview" ...>预览</span>

旧判据实测：a#js_sync_save 0 个、a[data-action="save"] 0 个、#js_save 0 个；
.weui-desktop-btn_primary 命中 3 个（退出登录 / 前往实名 / 去设置）**全部不可见**
```

也就是说旧选择器**一个都没命中**，只剩 `:has-text("保存")` 在兜底，而它选中了「包含该文案的大容器」。修法：

- `SAVE_BUTTON_SELECTOR` 首位改为稳定 id `#js_submit`
- `:has-text` 兜底限定在 `span` 上（按钮本体是 span），且排到最后
- 新增 4 条选择器锁，其中一条明确禁止 `.weui-desktop-btn_primary:has-text`（实测只命中不可见元素）

### 真机闭环（16:40，worktree 代码 + dev server，实跑一次存草稿）

```
[click] 行为层失败，先试 CDP 可信点击 sel=#js_submit, span#js_submit, span:has-text("保存为草稿"), ...
[clickTrusted] #js_submit, span#js_submit, -> TRUSTED@896,705
[click] CDP 可信点击生效 sel=#js_submit ... -> BUTTON||
[wechat_mp] done
publish done platform=wechat_mp url=...&appmsgid=100000236&token=***&lang=zh_CN
[NOTIFY] PublisherRouter rpa-publish-ok {"platform":"wechat_mp","accountId":"e0026c4e","mode":"dom", ...}
[NOTIFY] PublishProgress phase-success {"platform":"wechat_mp", ... "percent":100}
```

点击落在保存按钮区域内（848,687 + 98×36 ⇒ 中心 897,705），URL 带回 `appmsgid=100000236`，任务判成功。

## 2026-10-28 第一次 rebase 说明（同一修复的落点归并）

微博的 `publish_url` 与「图文入口指向首页」这两处，与同批的 `fix-publish-cover-url`（PR #4074）**同值同处**。
两个 PR 各带一份会在 `config/platforms.yaml` 的 weibo 段产生重复键，因此本 PR rebase 时**丢弃自己的那一份**，
由 #4074 承担（单一真源）；`scripts/verify-platform-onboarding.test.js` 的 weibo 块行数快照随之走 #4074 的取值
（本 PR 不再改该快照）。本 PR 实际承载的是微博**选择器**与**微信保存点击**两条修复。
丢弃前实测：本 PR 的 weibo 块 +4 行（14→18）而快照仍写 14 ⇒ `verify-platform-onboarding` 红（`not ok 11`）；
丢弃后该测试 **21/21 pass**。

## 2026-10-28 第二次 rebase 说明（与主干已落地的同类实现归并）

第二次 rebase 时主干已包含 **PR #4081「公众号保存草稿点不动（可信点击 + 请求/拒绝分判 + 草稿箱反查）」**，
它对 `rpa-behavior-mixin.js` 的改动是**同一处修复的更新版本且更完整**：
`has-text` 谓词跳过行为层（CDP `DOM.querySelector` 不认文本谓词）→ 可信点击优先于合成 click →
`owned-detach`（只拆自己 attach 的会话）→ 遮挡层 `pointerEvents` **还原**（还多一档「他方持有时走主世界
`executeJavaScript` 还原」）。本分支当年那版实现（含 `rpa-behavior-mixin.click-fallback.test.js` 7 例）
与之逐条重叠，取舍如下（**保主干、丢重复，不两边各留一份**）：

- 丢弃：`apps/desktop/electron/services/stealth/rpa-behavior-mixin.js` 的改动、`rpa-view-helpers.test.js` 的改动、
  新增的 `rpa-behavior-mixin.click-fallback.test.js`。理由：主干的实现是超集，且它自带 17 例锁；
  两版并存会在 `_click` 分流与 `_clickViaCdp` 的 detach/还原语义上产生二义。
- 保留（本分支真正独有、主干没有的）：
  ① `wechat-mp-draft-mediaid.js` 的保存按钮选择器改为**稳定 id `#js_submit` 优先**、`:has-text` 兜底限定在
     `span` 上（真机：`a#js_sync_save` / `a[data-action="save"]` / `#js_save` 全 0 命中，
     `.weui-desktop-btn_primary` 命中的三个元素全部不可见）；
  ② 微博选择器的 placeholder / woo 稳定类候选（与主干 #4074 之前的取证同源，合并为一份并补两条候选）；
  ③ 新增真机判据锁 `packages/rpa-engine/tests/weibo-selectors-live-dom.test.js`（5 例）；
  ④ 上述选择器的 4 条实现锁（追加在既有 `wechat-mp-draft-mediaid.test.js` 尾部，主干的 23 例原样保留）。
- 冲突解决逐处：`platform-selectors.js`（两侧同源取证 → 取并集，主干首项 `button.woo-button-main:has-text("发送")`
  保留，补 `.woo-button-primary` 与两条正文候选）；`wechat-mp-draft-mediaid.test.js`（取主干版 + 追加本分支 4 例，
  并补 `SAVE_BUTTON_SELECTOR` 到解构导入）；`rpa-view-helpers.test.js` / `rpa-behavior-mixin.js`（取主干版）。
- 复跑读数：`apps/desktop` → `wechat-mp-draft-mediaid.test.js` **27 passed**、`rpa-view-helpers.test.js` **17 passed**；
  `packages/rpa-engine` 全量 **290 passed / 10 文件**（含 weibo 5 例）。## 执行记录

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时（electron 主进程 + packages/rpa-engine + config）；隔离 worktree `mp-publish-fix-wx-wb` + 裸分支，起点 `7f3ebb6` |
| 第一性原因 | PASS | 微博：缺 publish_url + 旧版选择器全落空（真机 0 命中）；微信：回退链缺可信点击档（实机 `appReq:0`） |
| 逃逸分析 | PASS | 既有测试只覆盖「行为层失败 → isolated 合成 click」这一条，从未断言点击**是否被页面接受**；微博选择器无任何真机判据，改版后全仓测试仍全绿 |
| 修复 + 回归保护 | PASS | 新增 `rpa-behavior-mixin.click-fallback.test.js` 7 例、`weibo-selectors-live-dom.test.js` 5 例；既有的回退链用例按新链路拆成「可信命中 / 可信未命中」两条 |
| 测试 | PASS | 第二次 rebase 落定后复跑：`apps/desktop` → `wechat-mp-draft-mediaid.test.js` **27 passed**（主干 23 + 本分支 4 条选择器锁）、`rpa-view-helpers.test.js` **17 passed**（主干版）；`packages/rpa-engine` 全量 **290 passed / 10 文件**（含 `tests/weibo-selectors-live-dom.test.js` 5 例） |
| ESLint | PASS | 改动文件 0 error（修掉了 `no-useless-assignment` 两处） |
| 真机验证 | 微信 PASS / 微博 部分 | 微信：实跑存草稿成功（落点 896,705、URL 带 `appmsgid=100000236`、`phase-success` percent=100）；微博：DOM 结构已按真机取证，但**未真发**（发一条微博是对外动作，未获授权） |
| QM-1 打包 | 由 CI 实证 | 本 PR 的 `Build & Release` job 在 `package-relevant=true` 时执行 `electron-builder --win --x64 -p never` + `check-asar-test-files.js`（app.asar / resources 两通道），以该 run 读数为准；本次会话的 worktree 与 pnpm store 同在 D 盘，未重复本地产包 |
| QM-6 双模型评审 | 未执行（tier 缺席，如实登记） | 本机无 `codeagent-wrapper`，`sh scripts/deep-review.sh` 未跑；触及点击基础设施（所有平台共用）属需要外部轴复核的面 —— 不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 收口由 scripts/lib/merge-ledger.js 按主干历史推导（squash 尾注 (#4168)），合并前不写状态词 |

## 未闭合（不假装已修好）

- **微博未真发验证**：选择器与 URL 已按真机 DOM 更新，但仍需一次真实发布确认「发送」能成功、且标题合并进正文（微博 `titleMode=caption`）的格式正确。
- B 站图文专栏通道：另立需求。
- 验证过程在公众号草稿箱留下了两条测试草稿（标题含「DOM取证-可删」「批量删除修复验证-可删」），需手动删除；微博侧未产生任何内容。
