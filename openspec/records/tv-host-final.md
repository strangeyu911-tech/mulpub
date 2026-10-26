# tencent_video 上传主机恢复为竞品实证值

## 背景
竞品代码（`00-vendor-originals/refproduct/main-dist-index.cjs`）原文：
`$http.put("https://finderassistancea.video.qq.com/applyuploaddfs", …)`，且其 `X-Arguments`
（`apptype=251&filetype=&weixinnum=&filekey=&filesize=&taskid=&scene=`）与本项目 `buildXArguments` 逐字一致。
此前"逆向主机过期"的结论**有误**：直连探测未带鉴权头，返回 404/Parse Error 属探测方法无效。

## 变更
- `CDN_HOST_CANDIDATES` 首项改为 `https://finderassistancea.video.qq.com`
- `uploadpartdfs` 真实运行时使用 `https://finderassistanced.video.qq.com`（注入客户端时保持相对路径，测试不受影响）
- 保留 `cdnHost` 运行时解析作为覆盖项（若平台后续下发则优先）

## 验证
- `shipinhao-video` 单测 15 passed
| 项 | 状态 |
| --- | --- |
| 远程同步 | 由门禁推导 |
# tencent_video 上传主机恢复为竞品实证值
## 背景
竞品代码（`00-vendor-originals/refproduct/main-dist-index.cjs`）原文：
`$http.put("https://finderassistancea.video.qq.com/applyuploaddfs", …)`，且其 `X-Arguments`
（`apptype=251&filetype=&weixinnum=&filekey=&filesize=&taskid=&scene=`）与本项目 `buildXArguments` 逐字一致。
此前"逆向主机过期"的结论**有误**：直连探测未带鉴权头，返回 404/Parse Error 属探测方法无效。
## 变更
- `CDN_HOST_CANDIDATES` 首项改为 `https://finderassistancea.video.qq.com`
- `uploadpartdfs` 真实运行时使用 `https://finderassistanced.video.qq.com`（注入客户端时保持相对路径，测试不受影响）
- 保留 `cdnHost` 运行时解析作为覆盖项（若平台后续下发则优先）
## 验证
- `shipinhao-video` 单测 15 passed
| 项 | 状态 |
| --- | --- |
# 今日头条 API 直发打通（csrf 真因：`xigua_csrf_token`）
## 背景
头条视频发布长期卡在 `403 {"code":403,"msg":"invalid csrf token"}`。
此前尝试过：页面内 XHR、真实 Chromium、`msToken`/`a_bogus`、`x-secsdk-csrf-token`、
`passport_csrf_token`、`passport_csrf_token_default`、`csrf_session_id` 多候选轮试 —— 全部 403。
## 根因（三组对照实验）
在**真 Chromium**（Playwright，cookie 注入，UA=Chrome/149）里对同一端点做对照：
| 请求头 | 结果 |
| --- | --- |
| 不带 `x-csrf-token` | `403 invalid csrf token` |
| 带 `passport_csrf_token`（32 字符） | `403 invalid csrf token` |
| 带 **`xigua_csrf_token`（24 字符）** | **`HTTP 200`** |
变量只有一个：`x-csrf-token` 的取值来自哪个 cookie。
`xigua_csrf_token` 是页面 JS 写入的会话 cookie，`document.cookie` 可见，但 Electron 的
`session.cookies.get()` 在部分场景取不到 —— 必须在**页面上下文**里读。
## 变更
| 文件 | 变更 |
| --- | --- |
| `apps/desktop/electron/services/toutiao-page-publish.js` | 先在页面读 `document.cookie` 取 `xigua_csrf_token`，再把它拼进 XHR 的 `x-csrf-token` 头 |
| `apps/desktop/electron/services/toutiao-page-publish.test.js` | **新增**回归锁（4 例，vitest） |
| `packages/api-publish-engine/src/publish/platforms/toutiao-video.js` | 新增 `getVideoThumb(vid)`（竞品 `getVideoCover$1` 等价实现），封面链增加「视频自带缩略图」回落 |
| `apps/desktop/electron/services/rpa-view-manager.js` | API 轨前先开真实发布页，把 `webContents` 交给 `pagePost`；预热 40s |
| `apps/desktop/electron/services/api-platform-adapter.js`（app 侧） | 转发 publish options（原实现丢弃 csrf/pagePost） |
## Bug 反哺（QM-5 五步）
### ① 第一性原因
引入点 `4b16cfb05`（首次注入 `passport_csrf_token`）。更上游的设计假设是
「cookie 名里带 csrf 的就是 csrf 令牌」，**没有对照抓包里那个 24 字符头**。
`git log -S "passport_csrf_token"` 可复现。
### ② 测试逃逸链
| 层级 | 为什么没拦住 |
| --- | --- |
| 单元测试 | `toutiao-page-publish.js` **没有任何测试**（`*page-publish*test*` = 0） |
| 集成测试 | 依赖真实页面 + 真实平台，无 mock 层 |
| E2E | 有真机验证，但日志只打印 `status`，**不打印请求头取值来源**；且曾把「URL 变了」误判成功 |
| Code Review | 令牌来源是**假设**，无抓包证据支撑 |
### ③ 系统性漏洞
`apps/desktop/electron/services/toutiao-page-publish.js` 无回归锁；
验收判据只取 `status`，不取「请求构造输入」（token 名 / 长度）。
### ④ 回归保护测试
文件：`apps/desktop/electron/services/toutiao-page-publish.test.js`（新增，4 例）
模式：单元测试（webContents 为假对象，零外发）
断言：
1. 第一步 executeJavaScript 必须读 `xigua_csrf_token`，且**不得**出现 `passport_csrf_token`
2. 第二步脚本必须包含 `x.setRequestHeader("x-csrf-token", <token>)`
3. 非 200 原样返回，不伪装成功
4. 缺参早退返回 null
**变异反证**：把 `xigua_csrf_token` 改回 `passport_csrf_token` → 测试 1 failed / 3 passed；
恢复后 4 passed。锁有效。
### ⑤ 预防措施
- 回归锁接入 `apps/desktop` vitest（CI `electron-tests` 覆盖）
- 验收口径固化为「日志必须打印 token 来源与长度」（`tokenLen=`），不再只看 status
- PRD 8.42/8.43 记录完整证据链，避免后人再走 `passport_csrf_token` 的弯路
## 验证
```
[16:44:14] tokenLen=24
[16:44:15] page-publish status=200 (reused page)
[16:44:15] PublishVideo status=200
           {"data":{"ItemId":"7700647183619555859","ItemType":2,"Code":0,"Message":"SUCCESS"}}
```
平台侧核实（`GET /mp/agw/creator_center/list?type=0`）：
```
count=10
- id=7700647183619555859  title=被误解的明朝：西方史料里的另一个大明   ← 命中
```
| 项 | 状态 |
| --- | --- |
## CHANGELOG 条目
# 今日头条发布打通：`xigua_csrf_token` 是 `x-csrf-token` 的唯一正解
头条视频发布长期 403（invalid csrf token）。三组对照实验定位到唯一变量：
`x-csrf-token` 必须取 **`xigua_csrf_token`**（24 字符），不是 `passport_csrf_token`（32 字符）。
修复后 `PublishVideo` 返回 `Code:0 / ItemId:7700647183619555859`，并在平台作品列表核实到同 ID 同标题。
新增 4 例回归锁 + 变异反证。
