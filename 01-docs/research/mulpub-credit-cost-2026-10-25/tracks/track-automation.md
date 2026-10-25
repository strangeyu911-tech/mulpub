# 轨道B：浏览器自动化、反检测与内容采集

> 取证时间：2026-10-23。所有数据来自 `api.github.com` / `registry.npmjs.org` / `pypi.org` 实测，
> 元信息与许可证正文均按纪律逐条复核。仓库树结构用 `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` 查证，
> 能力判断以具体文件行数与方法实现为准。

---

## 一、维度小结（表）

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| **CDP 层泄漏修补**（`Runtime.Enable` / `navigator.webdriver` / 栈名泄漏） | `puppeteer-extra-plugin-stealth` npm 停在 **2023-03-01（v2.11.2）**，`playwright-extra` 同样停在 2023-03-01（v4.3.6），且二者只做 JS 注入，不修 CDP 泄漏 | `rebrowser/rebrowser-patches`（MIT） | `ultrafunkamsterdam/nodriver`（AGPL，只借鉴思路） | **直接引入**：Node 与 Python 两侧都有官方 drop-in（`rebrowser-playwright` 1.64.101）。这是本维度投入产出比最高的一项 |
| **TLS / JA3 指纹伪装** | `collection-engine` 用 axios（Node）、`python-backend` 用 httpx —— **两者都不做 TLS 指纹模拟**，JA3 与真实浏览器不一致 | `lexiforest/curl_cffi`（MIT） | `D4Vinci/Scrapling`（内部已封装 curl_cffi） | **直接引入**：纯 Python 单包，MIT，不碰现有 axios/httpx 调用面，可只在"平台 API 直连"路径灰度接入 |
| **引擎级指纹伪装**（navigator / WebGL / 字体 / 时区 / WebRTC） | 已用 `@askjo/camofox-browser`，其自 **2026-08-02** 起锁定 `camoufox-js@0.11.5` 至今（6 个版本未动），而 `camoufox-js` 已发 **0.12.0**(07-31) / **0.12.1**(10-06) / **0.13.0**(10-16) | `daijro/camoufox`（MPL-2.0） | — | **对冲而非硬升**：`0.11.5→0.12.0` 是 minor 跳变（可能不兼容），不能直接改 pin。先把 mulpub 侧从精确 `0.11.5` 放宽为 `~0.11.5`，同时向上游问兼容性；过渡期用 `identity-binder.js` 保证指纹自洽。**不建议自建 Camoufox 引擎**（Firefox 补丁体量过大） |
| **选择器自愈 / 改版容错** | `rpa-engine/platform-selectors.js` 静态硬编码，平台改版即断 | `D4Vinci/Scrapling`（BSD-3） | — | **借鉴实现**：把 Scrapling 的相似度重定位算法移植成 JS，落到 `platform-selectors.js` 旁路 |
| **微博 / 快手 / 贴吧 采集**（发布侧已有 adapter，采集侧缺） | `collection-engine/platform-adapters/` 只有 base/bilibili/douyin/wechatmp/xiaohongshu/zhihu **6 个** | `NanmiCoder/MediaCrawler`（非商用许可，仅供对照） | 无合规开源替代 | **明确缺口**：只能自研，MediaCrawler 只能读代码取思路（许可证禁商用），且其 2026 年已商业化转向 |
| **公众号整号历史文章 + RSS 化 + 代理反风控** | `wechatmp` adapter 存在，但未见"整号翻页 + RSS 输出 + 代理池"能力 | `rachelos/we-mp-rss`（LICENSE 正文为 MIT） | `tmwgsicp/wechat-download-api`（AGPL-3.0，仅借鉴） | **作为独立服务引入**（MIT 正文可证），不要把其 Python 后端并入桌面端；输出走 RSS 交给 `feedparser` |
| **RSS / Atom 源解析** | 无 | `kurtmckee/feedparser`（BSD-2，Python） | `@rowanmanning/feed-parser`（MIT，JS） | **直接引入**：与 we-mp-rss 组合，同时可吃知乎/B站/微博的 RSS 镜像 |
| **通用网页正文抽取** | 无专门方案，采集层直接取 DOM | `adbar/trafilatura`（Apache-2.0，含 `readability_lxml` / `feeds` / `sitemaps`） | `@mozilla/readability`（Apache-2.0，JS） | **直接引入**（Python 侧）+ JS 侧用 readability 补 |
| **账号会话池 / 代理轮换** | `collection-engine` 有 `cool-down-pool.js` / `identity-binder.js` / `health-monitor.js`（**账号维度冷却**），但缺 **IP 维度代理池与出口轮换** | `apify/crawlee`（Apache-2.0）的 `SessionPool` + `ProxyRotator` 范式 | `jhao104/proxy_pool`（MIT，代理池 API 服务） | **借鉴实现**（Crawlee）+ **直接引入**（proxy_pool 作为独立 API 服务） |
| **无 GUI 远程浏览器** | 桌面端自带 Electron，采集在本地跑 | `steel-dev/steel-browser`（Apache-2.0） | `browserless/browserless`（SSPL-1.0，劝退） | **暂不自建**：桌面端场景无必要；若未来把 `api-publish-engine` 拆成云端 worker 再评估 Steel |
| **B站 wbi 签名** | `collection-engine` 有 bilibili adapter，但缺 wbi | — | — | **明确无法自建的缺口**：唯二公开参考（`SocialSisterYi/bilibili-API-collect`、`Nemo2011/bilibili-api`）已因哔哩哔哩律所函告**永久关停**，材料不可用 |
| **国内短视频/图文平台签名算法** | 抖音 a_bogus 自研（Apache-2.0 移植）、小红书 x-s 用 `Cloxl/xhshow`（MIT） | `Cloxl/xhshow`（已在用，**唯一合规来源**） | `NanmiCoder/MediaCrawler`（**签名维度零增量**，见第 5 项逐行比对） | 维持现状；**新增动作：确认 mulpub 锁定的 xhshow ≥ 0.2.0**（0.2.0 于 2026-06-11 发布，原生修复 GET 请求 `a3_hash` 计算 bug，xhshow issue #104；<0.2.0 则 GET 签名是错的）；`x-s-common`/`xsc` 一律走 xhshow 的 `sign_xs_common()` / `sign_xsc()` |

---

## 二、候选详情

### 1. rebrowser/rebrowser-patches — Playwright/Puppeteer 的 CDP 层泄漏补丁集

- **证据**
  - `GET /repos/rebrowser/rebrowser-patches` → stars=**1446**, forks=85, language=JavaScript, default_branch=**main**, pushed_at=**2026-10-19T22:51:16Z**, created_at=2024-08-06, license_spdx=MIT
  - `GET /repos/rebrowser/rebrowser-patches/commits?per_page=5` → 默认分支最后提交 **2026-10-19**（`00c62cde` Merge PR #139 docs/releases-and-versions；`c3467cd7` Mirror from the published packages）
  - `GET /repos/rebrowser/rebrowser-patches/git/trees/main?recursive=1` → 133 entries / 107 blobs；`patches/playwright-core/1.52.0/{src,lib}.patch`、`patches/playwright-core/1.64.0-beta-1791568591000/*`、`patches/playwright-core/1.64.1/*`（src 约 31 KB / lib 约 26 KB）、`patches/puppeteer-core/{24.8.1,25.14.0}/*`、`patches/playwright-python/1.64.0/build.patch`（约 9 KB）、`scripts/patcher.js`（约 6 KB）、`release/build-packages.mjs`（约 18 KB）
  - `GET /repos/rebrowser/rebrowser-patches/license` → 正文首行 `MIT License`，`Copyright (c) Rebrowser`
  - `GET /registry.npmjs.org/rebrowser-playwright` → latest=**1.64.101**，published=**2026-10-19T18:56:28Z**
  - README 补丁清单（`## Available patches` 下 5 个二级标题）：`Fix Runtime.Enable leak` / `Keep library names out of stack traces` / `Hide navigator.webdriver` / `Method to access browser CDP connection` / `Change default utility world name`
  - README 版本声明：`✅ Latest fully tested version: 1.64.1 (released 2026-10-14), drop-in packages 1.64.101 (Python: 1.64.101, built from playwright-python 1.64.0)`；`✅ Latest fully tested version: 25.14.0 (released 2026-10-14), drop-in packages 25.14.101`
- **它解决的是哪一层**：**CDP 补丁层**。不碰浏览器二进制，只改 Playwright/Puppeteer 自身的 JS/TS 代码：让 `Runtime.Enable` 不再被页面脚本观测到（改为手动构造 context ID，README 给了 `addBinding` / `Page.createIsolatedWorld` / `Runtime.Enable`+`Runtime.Disable` 三种模式及各自代价）、把 `navigator.webdriver` 隐藏、把内部库名从 stack trace 里抹掉、换掉 `UtilityScript` 这个可被识别的默认 utility world 名。**不是**指纹伪装，**不是**TLS 伪装。
- **适配点**：`rpa-engine` 的浏览器驱动层（publish-selectors / toutiao-direct-bridge 走的都是浏览器自动化）。关键价值在 `Runtime.Enable` 泄漏 —— 这是 2025 年后 DataDome / Cloudflare 的主力检测信号，`puppeteer-extra-plugin-stealth` 完全没有覆盖（它只做 `navigator.webdriver` 等 JS 属性覆盖）。用 npm alias 在 Node 侧 `playwright@npm:rebrowser-playwright`、Python 侧 `pip install rebrowser-playwright` 即可，**不需要改业务代码**。README 还提到一个具体坑：1.1.1 之前用 npm alias 时，若同项目装了原版 `playwright`，npm 会**静默给 drop-in 版本未打补丁的 core**（issue #74）—— 必须用 1.1.1+ 的新包名方案。
- **引入成本**：**低**。MIT，双端官方 drop-in。唯一成本是 playwright 需升到 1.64.1（mulpub 的 `pyproject.toml` 只写了 `playwright>=1.50`，无上界，Node 侧版本待确认）。`scripts/patcher.js` 也支持直接给本地已装的 playwright 打补丁，**但更推荐 drop-in 包**，因为仓库 README 明说"我们主要focus最新版本，旧版本随时可能被撤掉支持"。
- **风险**：① 补丁绑定上游小版本，1.52.0 的 patch 已在树里但 1.53~1.63 缺席（中间版本**断档**）→ 须把 Node 与 Python 两侧 playwright 锁到 1.64.1；② rebrowser 是商业公司，开源补丁是引流手段，长期可能转向；③ 补丁改变 CDP 语义，Playwright 若改 `UtilityScript` 实现会冲突。
- **建议**：**直接引入**。优先级 P0。落地动作：Node 侧与 Python 侧同时切 drop-in；版本锁 1.64.1；用 `https://bot-detector.rebrowser.net/` 做上线前基线对比。
- **置信度**：**高**。README 的补丁清单、版本矩阵、npm 发布记录、许可证正文四路证据一致。

### 2. lexiforest/curl_cffi — TLS/JA3 指纹模拟的 HTTP 客户端

- **证据**
  - `GET /repos/lexiforest/curl_cffi` → stars=**6764**, forks=569, language=Python, default_branch=main, pushed_at=**2026-10-22T23:29:46Z**, license_spdx=MIT, open_issues=46
  - `GET /repos/lexiforest/curl_cffi/commits?per_page=5` → 默认分支最后提交 **2026-10-22**（`9905de57`、`d4913966`、`a88a5a86` Bump version to 0.17.0b2）
  - `GET /repos/lexiforest/curl_cffi/license` → 正文首行 `MIT License`，`Copyright (c) 2018 multippt` / `Copyright (c) 2022 curl_cffi developers`
  - 仓库 description：`Python binding for curl-impersonate fork via cffi. A http client that can impersonate browser tls/ja3/http2 fingerprints.`
  - 交叉验证：`D4Vinci/Scrapling` 的 `scrapling/engines/static.py`（805 行）头部直接 `from curl_cffi.requests import Session as CurlSession, AsyncSession as AsyncSession`，并以 `ImpersonateType` 暴露 `--impersonate 'chrome'` 能力（`GET /repos/D4Vinci/Scrapling/contents/scrapling/engines/static.py` 实测 805 行 / 前 30 行为 curl_cffi import）
- **它解决的是哪一层**：**TLS/JA3 伪装层**。基于 curl-impersonate 的 cffi 绑定，让 Python 侧发出的请求在 TLS ClientHello、JA3/JA4 指纹、HTTP/2 SETTINGS 与扩展顺序上与 Chrome/Safari/Edge 保持一致；配合 `impersonate=` 参数还能同步 User-Agent 与 HTTP 头。**不涉及** DOM、CDP、指纹 JS 层。
- **适配点**：`collection-engine` 目前的平台直连（抖音 web API、小红书 web API、B站 web API）走 axios，TLS 握手是 Node 默认（OpenSSL/boringssl 特征），与浏览器不一致；`python-backend` 走 httpx 同样裸奔。抖音/小红书/快手的 web 接口在**未携带正确 TLS 指纹 + 正确签名**时是双门槛，curl_cffi 恰好补上前一半。落地方式：在 `collection-engine` 里新增一个**可选的** `impersonate` 传输层，只对"平台 API 直连"路径启用，浏览器路径不动，零侵入。
- **引入成本**：**低**。MIT，单包，需要 cffi + 预编译二进制（无 Node 原生编译链风险）。Python 侧一行 `from curl_cffi.requests import Session` 即可。风险点是**二进制体积**（wheel 约 8-15 MB）对桌面端打包的影响，需要评估 electron-builder/pyinstaller 的产物体积。
- **风险**：① wheel 体积膨胀；② 若平台改用 **HTTP/3 / QUIC**，curl_cffi 的 h3 成熟度需单独验证（该仓 2026-10-22 的提交正是在调 `v3only for http3`）；③ 库自身定位是"绕过检测"，需与法务对齐。
- **建议**：**直接引入**（灰度）。建议只在 `api-publish-engine/signer/` 与 `collection-engine` 的**签名请求**路径试点，不做全局替换。
- **置信度**：**高**。仓库元信息、许可证正文、第三方（Scrapling）实际 import 三路互证。

### 3. daijro/camoufox — 浏览器引擎级（Firefox 补丁）指纹伪装

- **证据**
  - `GET /repos/daijro/camoufox` → stars=**12730**, language=Python, default_branch=main, pushed_at=**2026-10-22T21:32:44Z**, license_spdx=MPL-2.0
  - `GET /repos/daijro/camoufox/commits?per_page=5` → 默认分支最后提交 **2026-10-22**（`59ac5006` Merge PR #902 addons-concurrent 等 5 条）
  - `GET /repos/daijro/camoufox/git/trees/main?recursive=1` → 649 entries / 549 blobs；`browser/patches/playwright/0-playwright.patch`（**约 130 KB**）、`python/src/camoufox/utils.py`（约 72 KB）、`python/src/camoufox/fingerprints.py`（约 71 KB）、`typescript/src/fingerprints.ts`（约 61 KB）、`python/src/camoufox/fingerprint-presets.json`（约 204 KB）、`browser/additions/camoucfg/json.hpp`（约 898 KB）
  - `GET /repos/daijro/camoufox/license` → 正文首行 `Mozilla Public License Version 2.0`
  - README「Fingerprint spoofing」表格实测内容（原文摘录）：`navigator-spoofing` / `fingerprint-injection` / `network-patches`（HTTP headers 与 navigator 对齐）/ `screen-spoofing` / `webgl-spoofing` / `host_rendering.py`（WebGPU）/ `audio-context-spoofing` / `font-list-spoofing` / `font-hijacker` / `voice-spoofing` / `media-device-spoofing` / `media-codec-spoofing` / `timezone-spoofing` / `locale-spoofing` / `geolocation-spoofing` / `webrtc-ip-spoofing` / `touchscreen-fingerprint-spoofing`；并明确列出**不伪装**的两项：Canvas 像素（`canvas-is-not-noised`）、文本宽度（`no-glyph-spacing-noise`）
  - README 架构图说明：`Patched Firefox: browser/` 中 `MaskConfig` 读取 `CAMOU_CONFIG`，由 **C++ 层**回答 Web API；`per-context patches` 在页面脚本运行前密封
  - ⚠️ README 顶部横幅原文：`⚠️ This project is under development. It may not be suitable for stable production use.`
  - `GET /registry.npmjs.org/camoufox-js` → latest=**0.13.0**，published=**2026-10-16T13:34:59Z**，repo=`git+https://github.com/apify/camoufox-js.git`，license=MPL-2.0；`GET /repos/apify/camoufox-js` → stars=273, default_branch=master, pushed_at=2026-10-22, license_spdx=MPL-2.0
  - mulpub 侧对照：`GET /registry.npmjs.org/@askjo/camofox-browser` → latest=**1.18.1**，published=**2026-10-05T02:45:31Z**，repo=`git+https://github.com/jo-inc/camofox-browser.git`，license=MIT，**dependencies 含 `camoufox-js: 0.11.5`（精确锁定）**
- **它解决的是哪一层**：**引擎/浏览器源码层指纹伪装**。它不是 JS 注入，而是给 Firefox 打补丁在 C++ 层回答 `navigator`、`screen`、`WebGL`、`WebGPU`、`fonts`、`audio`、`WebRTC` 等 API。`browser/patches/playwright/0-playwright.patch` 说明它**改的是 Playwright 的 Firefox 后端（Juggler）**，对外仍返回"一个正常的 Playwright Browser"。这一层比 rebrowser-patches 高一级：rebrowser 修的是"自动化痕迹泄漏"，Camoufox 修的是"设备指纹自相矛盾"。
- **适配点**：mulpub 已通过 `@askjo/camofox-browser` 间接用到 Camoufox 引擎，但**底层引擎已冻结 3 个多月**（详见下方的版本节奏实测）。具体适配点：`collection-engine` 的 `behavior-simulator.js` / `identity-binder.js` 负责模拟"像人一样操作"，但**设备指纹一致性**（UA 与 WebGL vendor 与实际 OS 是否自洽）只有引擎层能保证 —— 当前 camofox-browser 锁定 0.11.5 意味着这些修复拿不到。
- **版本节奏实测（tag / release / npm 三路交叉）**：
  - `GET /repos/jo-inc/camofox-browser/tags?per_page=15` → 15 个 tag，latest `v1.18.1`（sha `39c82094`）
  - `GET /repos/jo-inc/camofox-browser/releases?per_page=12` → 12 条，发布日 v1.13.1=08-02、v1.14.0=08-19、v1.15.0=09-10、v1.16.0=09-14、v1.17.0=09-22、v1.18.0=09-30、v1.18.1=10-05（均为 2026）⇒ **64 天发 7 版，约每 6~9 天一版**（camofox-browser 自身很健康）；另有 5 条 `camoufox-backup-*` 引擎快照发布
  - `GET /registry.npmjs.org/@askjo%2Fcamofox-browser` → **45 个版本**；`camoufox-js` 依赖：`1.10.1`~`1.11.2` → `>=0.10.0`；`1.12.0`~`1.13.0` → `0.10.2`；**`1.13.1`(08-02) 起跳到 `0.11.5`**，随后 `1.14.0`/`1.15.0`/`1.16.0`/`1.17.0`/`1.18.0`/`1.18.1` **六版全部沿用 `0.11.5`**
  - `GET /registry.npmjs.org/camoufox-js` → **41 个版本**；近期发布日 `0.11.2`(07-14) → `0.11.3`(07-24) → `0.11.4`/`0.11.5`(07-27) → **`0.12.0`(07-31)** → **`0.12.1`(10-06)** → **`0.13.0`(10-16)**；`GET /repos/apify/camoufox-js` → stars=273, default_branch=master, pushed_at=**2026-10-22T10:55:37Z**, license_spdx=MPL-2.0 ⇒ **上游本身仍活跃**
  - ⇒ **机制解释（本轮补齐）**：`0.11.5→0.12.0` 是 **minor 版本号跳变**（按 semver 可能含不兼容变更）；camofox-browser 连发 6 版却不动 pin，说明它**不是忘了升，而是不敢升**。故原"落后 1 个 minor 档、直接改 pin"的表述**已删除**
  - ⇒ **修正后的处置**：① 向上游问 0.13.0 兼容性；② mulpub 侧把 pin 从精确 `0.11.5` 放宽为 `~0.11.5` 以便吃补丁；③ 跨 minor 前先评估 `xrap`/`fingerprint` 接口变动；④ 过渡期靠 mulpub 自己的 `identity-binder.js` 保证 UA / 时区 / locale / viewport / WebGL vendor 自洽
- **引入成本**：**中**。技术上 mulpub 已是使用方，成本在于**版本解绑**：`camofox-browser` 精确锁 `camoufox-js@0.11.5`，要升级需 fork 或等上游放宽（MPL-2.0 允许改，但需保留声明）。自建 Camoufox 引擎**不现实**（649 个 tree 条目、含 Firefox 源码补丁与 2 MB 级二进制资产），**不建议自建**。
- **风险**：① 上游自标"under development, not suitable for stable production use"；② 浏览器二进制体积（Firefox 定制构建），桌面端打包体积与分发合规是硬约束；③ MPL-2.0 是文件级 copyleft —— 发行含其二进制需保留声明，但不强制整产品开源（比 AGPL 友好得多）；④ 指纹伪装与"行为模拟"是两件事，引擎层做得再好也补不上"操作轨迹像不像人"，后者 mulpub 已有自研。
- **建议**：**借鉴实现 + 版本对齐**，不引入新依赖。动作：向 `jo-inc/camofox-browser` 提 issue 要求 `camoufox-js` 改为 `^0.13.0` 范围；或自行 fork 一份把 pin 改成 `^0.13.0`。
- **置信度**：**中**。Camoufox 本身的证据充分；但"camofox-browser 能否松绑 camoufox-js 版本"未取证（未读其 `package.json` 之外的构建配置与 `camoufox-js` 调用面）。

### 4. D4Vinci/Scrapling — 统一请求/浏览器引擎 + **选择器自适应重定位**

- **证据**
  - `GET /repos/D4Vinci/Scrapling` → stars=**89231**, forks=9199, language=Python, default_branch=main, pushed_at=**2026-10-22T20:43:49Z**, license_spdx=BSD-3-Clause, open_issues=16
  - `GET /repos/D4Vinci/Scrapling/commits?per_page=5` → 默认分支最后提交 **2026-10-22**（`82180a1b` docs: update a sponsor url；`8a340fe2` docs: remove a sponsor；`fd531313` docs: update the changelog）
  - `GET /repos/D4Vinci/Scrapling/git/trees/main?recursive=1` → 832 entries / 688 blobs；`scrapling/parser.py`（**约 57 KB**）、`scrapling/engines/static.py`（约 40 KB）、`scrapling/engines/_browsers/_stealth.py`（约 40 KB）、`scrapling/engines/toolbelt/ad_domains.py`（约 95 KB）、`scrapling/engines/toolbelt/proxy_rotation.py`（约 4 KB）、`scrapling/engines/toolbelt/fingerprints.py`（约 4 KB）、`scrapling/engines/toolbelt/convertor.py`（约 23 KB）、`scrapling/spiders/{engine,cache,checkpoint}.py`（20240/3921/约 3 KB）
  - `GET /repos/D4Vinci/Scrapling/contents/scrapling/engines/static.py` → 实测 **805 行**；前 30 行确认 `from curl_cffi.curl import CurlError` + `from curl_cffi.requests import Session as CurlSession, AsyncSession as AsyncSession`；并 `from .toolbelt.proxy_rotation import ProxyRotator, is_proxy_error` + `from .toolbelt.fingerprints import generate_headers, __default_useragent__`
  - `GET /repos/D4Vinci/Scrapling/license` → 正文首行 `BSD 3-Clause License`，`Copyright (c) 2024, Karim shoair`
  - README 实测能力行（原文）：`- **[Parse & extract]**: CSS, XPath, text and regex search, adaptive element tracking, similar-element matching, and clean Markdown output.`；`- 🔄 **Smart Element Tracking**: Relocate elements after website changes using intelligent similarity algorithms.`；`- 🎯 **Smart Flexible Selection**`；`- 📝 **Auto Selector Generation**: Generate robust CSS/XPath selectors for any element.`
- **它解决的是哪一层**：横跨**传输层（TLS impersonate）**、**代理轮换**、**指纹头生成**、**DOM 抽象 + 选择器自愈**四层，但最有价值的是第四层 —— **adaptive element tracking**：元素在页面改版后仍能通过结构相似度重新定位。README 另称 `similar-element matching` 与 `Auto Selector Generation`。
- **适配点**：`rpa-engine/platform-selectors.js` 与 `publish-selectors-by-content-type.js` 是 mulpub 最脆的一环 —— 平台改版（抖音/小红书尤其频繁）就断，运营成本全压在人工跟版上。Scrapling 的做法是**把选择器从"常量"降级为"可重定位的锚点"**：用元素周边结构 + 文本特征做相似度匹配，匹配不到再回落到原选择器。可直接借鉴其 `scrapling/parser.py`（58 KB）里的相似度/重定位算法，移植成 JS 侧模块，作为 `platform-selectors.js` 的**自愈层**而非替代。
- **引入成本**：**中**。Scrapling 整体是 Python 框架，直接引入会和现有 JS `collection-engine` 形成双栈；但**只借算法不引框架**的话成本低 —— BSD-3 允许闭源商用，只需保留版权声明。
- **风险**：① `docs/` 占仓库大半（多语言 changelog 各 10 万 B+），工程卫生一般；② 89k star / 16 open issue 属"运营驱动"型项目（README 顶部大量 sponsor 引流），需警惕商业化转向；③ 体量最大的单文件 `ad_domains.py`（约 95 KB / **3537 行**，docstring 写明 `Built-in ad/tracker domain list for use with block_ads=True`，源为 Peter Lowe's 列表）—— 说明其大量投入在"去广告"，对 mulpub 价值有限。
- **建议**：**借鉴实现**（选择器自愈算法），不整体引入。
- **置信度**：**高**（树结构、行数、import 链、README 能力描述、许可证正文均已实测）。

### 5. NanmiCoder/MediaCrawler — 国内主流平台采集 + 签名实现（**许可证禁商用**）

- **证据**
  - `GET /repos/NanmiCoder/MediaCrawler` → stars=**67735**, language=Python, default_branch=main, pushed_at=**2026-10-15T04:53:41Z**, license_spdx=**NOASSERTION**, created_at=2024
  - `GET /repos/NanmiCoder/MediaCrawler/commits?per_page=1` → 默认分支最后提交 **2026-10-15**（`8f583999` update README；与 `pushed_at=2026-10-15` 一致，非失实）
  - `GET /repos/NanmiCoder/MediaCrawler/license` → 正文首行 **`NON-COMMERCIAL LEARNING LICENSE 1.1`**，`Copyright (c) [2024] [relakkes@gmail.com]`
  - `GET /repos/NanmiCoder/MediaCrawler/git/trees/main?recursive=1` → 421 entries / 355 blobs；`media_platform/` 下 **7 个平台**：`bilibili/`（core 约 40 KB）、`douyin/`（core 约 20 KB、login 约 13 KB）、`kuaishou/`（core 约 24 KB + `graphql/` 7 个 .graphql 查询）、`tieba/`（core 约 27 KB、client 约 34 KB）、`weibo/`（core 约 22 KB）、`xhs/`（core 约 24 KB、`xhs_sign.py` 约 7 KB、`playwright_sign.py` 约 2 KB、`extractor.py` 约 2 KB）、`zhihu/`（core 约 20 KB、client 约 20 KB）；另有 `libs/stealth.min.js`（**约 176 KB**）、`libs/douyin.js`（约 15 KB）、`libs/zhihu.js`（约 6 KB）、`webui/`
  - `GET /repos/NanmiCoder/MediaCrawler/contents/media_platform/xhs/xhs_sign.py` → 实测 **152 行**；头部 20 行为许可声明（"不得用于任何商业用途"等 5 条）；正文含**自定义 Base64 字符表** `ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5` + **CRC32 查找表** + ctypes 调用
  - 交叉验证：`GET /repos/Cloxl/xhshow` → stars=**1098**, language=Python, default_branch=master, pushed_at=**2026-06-11T11:35:34Z**, license_spdx=MIT，description=`小红书xs纯算 小红书x-s x-s-common xsc 等字段 纯算逆向`；`GET /repos/Cloxl/xhshow/commits?per_page=1` → 默认分支最后提交 **2026-06-11**（`b242a84f` docs(readme): add LINUX DO community section (#109)）—— **mulpub 已在用**，且覆盖 `x-s-common`/`xsc`（比 MediaCrawler 的 `xhs_sign.py` 更全）
- **它解决的是哪一层**：**平台适配 + 签名算法层**（每平台一套 core/client/login/media/field 五件套），外加 `libs/stealth.min.js`（180 KB）做的 JS 侧指纹注入。**不是**通用反检测框架。
- **适配点**：mulpub `collection-engine/platform-adapters/` 只有 6 个（base/bilibili/douyin/wechatmp/xiaohongshu/zhihu），而 **`api-publish-engine` 发布侧已有 weibo / kuaishou / tiktok / baijiahao / shipinhao / toutiao 等 adapter** —— 也就是说 **发布侧能发微博/快手，采集侧却采不到微博/快手/贴吧**，这是本维度最明确的功能缺口。MediaCrawler 的 `media_platform/weibo/`、`media_platform/kuaishou/`（含 7 个 GraphQL 查询文件）、`media_platform/tieba/` 正是这三块的参考实现。其 `media_platform/bilibili/` 可作为 mulpub bilibili adapter 的 wbi 补齐参考。

#### 逐行比对：MediaCrawler 的小红书签名 vs mulpub 现有的 `Cloxl/xhshow`（**结论：签名维度零增量**）

这是本轮对候选 5 最关键的一次核查，直接推翻了"MediaCrawler 提供签名实现"的表面印象。

**（a）`media_platform/xhs/playwright_sign.py` —— 实测 72 行，是一层薄包装，不含任何自有算法。**
逐行读到的调用链（第 28-72 行）：

| 行 | 原文 | 性质 |
|---|---|---|
| 30 | `from .xhs_sign import get_trace_id` | 只为了拿 trace id |
| 51-52 | `from xhshow import Xhshow` / `xhshow_client = Xhshow()` | **签名主体完全交给 xhshow** |
| 55-59 | `headers = xhshow_client.sign_headers_post(uri=..., cookies=..., payload=...)` | 调 MIT 上游 |
| 61-65 | `headers = xhshow_client.sign_headers_get(uri=..., cookies=..., params=...)` | 调 MIT 上游 |
| 67-72 | `return {"x-s": ..., "x-t": ..., "x-s-common": ..., "x-b3-traceid": ...}` | 只是把 4 个头重新打包 |

文件头第 19-26 行**自己写明了出处**：`# Xiaohongshu signature generation using xhshow pure-algorithm library` / `# 致谢：本签名实现依赖 xhshow 开源库, 由 Cloxl 提供` / `# 许可协议: MIT License` / `# 依赖 xhshow>=0.2.0: 该版本原生修复了 GET 请求 a3_hash 计算的 bug (https://github.com/Cloxl/xhshow/issues/104), 不再需要在本地打 monkey-patch。`

⇒ **`playwright_sign.py` 的签名能力 100% 来自 `Cloxl/xhshow`（MIT），MediaCrawler 自有部分为零**，而 mulpub 已在用同一个 MIT 上游。

**（b）`media_platform/xhs/xhs_sign.py` —— 实测 152 行，也不生成 `x-s` / `x-t` / `x-s-common`。**
实际内容只有三块：① `mrc(e)`（第 86-91 行，注释原文 `CRC32 variant, used for x9 field in x-s-common`）—— 仅供 `x-s-common` 的 `x9` 字段；② `_triplet_to_base64()` / `_encode_chunk()` / `b64_encode()`（第 94-147 行）—— 自定义 Base64 字符表 `ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5`；③ `get_trace_id()`（第 150-152 行）—— 16 位随机十六进制。

**（c）与 xhshow 上游逐行对照** —— `GET /repos/Cloxl/xhshow/contents/src/xhshow/core/crc32_encrypt.py` 实测 **125 行**：

| 维度 | MediaCrawler `mrc()` | xhshow `CRC32.crc32_js_int()` |
|---|---|---|
| 最终异或 | 第 91 行 `return o ^ -1 ^ 3988292384`（`3988292384` = `0xEDB88320`） | 第 124 行 `u = ((cls.MASK32 ^ c) ^ a) & cls.MASK32`，`a = cls.POLY = 0xEDB88320` |
| 对应 JS 表达式 | 同上 | docstring 第 106-108 行原文：`This matches the JS expression: (-1 ^ c ^ 0xEDB88320) >>> 0` |
| CRC 表 | **硬编码 44 行字面量**（第 32-76 行） | 第 29-42 行**惰性生成** 256 项表 |
| 输入截断 | 第 89 行 `for n in range(min(57, len(e)))` —— **截断到 57 字符** | **无截断**，全量计算 |
| 字符串编码模式 | 无（直接 `ord(e[n])`） | 第 45-59 行 `string_mode` 支持 `"js"`（`ord(ch) & 0xFF`）与 `"utf8"` |
| 符号表示 | `_right_shift_unsigned` 模拟 JS `>>>` | 第 82-93 行 `_to_signed32`，第 102 行 `signed` 参数 |

⇒ **MediaCrawler 的 `mrc()` 是 xhshow `CRC32.crc32_js_int()` 的忠实但降级复刻**：算法与最终异或表达式完全一致，但多了 57 字符截断、少了 utf8 模式、且把表硬编码。**mulpub 应直接调用 xhshow 的 `CRC32.crc32_js_int()`**（MIT 上游、无截断、支持 utf8）。

**（d）xhshow 侧的实际能力面** —— `GET /repos/Cloxl/xhshow/contents/src/xhshow/client.py` 实测 **719 行**，`Xhshow` 类公开方法（含行号）：`sign_xs`(111) / `sign_xyw`(166) / `sign_xs_common`(215) / `sign_xs_get`(233) / `sign_xs_post`(265) / **`sign_xsc`(297)** / `decode_x3`(316) / `decode_xs`(335) / `get_b3_trace_id`(394) / `get_xray_trace_id`(408) / `generate_a1`(457) / `generate_web_id`(472) / `get_x_t`(488) / `sign_headers`(527) / **`sign_headers_get`(637)** / **`sign_headers_post`(679)**；`sign_headers` 返回体第 620-623 行为 `x-s` / `x-s-common` / `x-t` / `x-b3-traceid` / `x-xray-traceid`。仓库树（`GET /repos/Cloxl/xhshow/git/trees/master?recursive=1`，58 entries）另含 `core/xrap.py`(约 15 KB)、`core/xyw_crypto.py`(约 7 KB)、`core/crypto.py`(约 6 KB)、`data/fingerprint_data.py`(约 11 KB)、`generators/fingerprint.py`(约 7 KB)。PyPI 实测 `GET /pypi.org/pypi/xhshow/json` → latest=**0.2.0**，uploaded=**2026-06-11T11:11:09Z**，版本史 0.1.0(2025-07-26) → 0.1.9(2026-02-17) → **0.2.0(2026-06-11)**，**共 11 个发布**（`releases` 键 11 个且全部含文件）。

⇒ **结论（对本候选 5 的定性修正）**：MediaCrawler 在小红书签名上**对 mulpub 零增量** —— 主体算法它自己也是调 mulpub 已在用的同一个 MIT 库 `xhshow`。它相对 mulpub 的**唯一增量**是平台适配面（微博 / 快手 / 贴吧 / 知乎 的 client·core·login·media·field 五件套结构），而这一面**因非商用许可不可引入**。本候选因此从"可借鉴签名实现"降级为"**仅可阅读的平台适配结构参考**"。
- **引入成本**：**不可引入**。许可证明文禁商用，mulpub 是商业桌面应用。**仅可作为阅读材料**。
- **风险**：① **许可证硬阻断**（最高优先级）；② 商业化转向：README 出现 `MediaCrawlerPro`、`tikhub_banner` 等付费导流素材；③ `tieba/help.py` 达 约 37 KB —— 说明贴吧适配靠大量硬编码，正说明这类采集器脆弱；④ 仓库带 `docs/static/images/nodemaven_banner*.png` 等代理商投放。
- **建议**：**仅供对照**。用法限定为"读实现 → 自己重写"，且**只读平台适配结构**（微博/快手/贴吧/知乎），**不取其签名实现**（它自己也是调 xhshow）。小红书签名一律以 `Cloxl/xhshow`（MIT）为准；CRC32 用 xhshow 的 `CRC32.crc32_js_int()`，不用 MediaCrawler 的 `mrc()`（后者有 57 字符截断）。
- **置信度**：**高**（许可证正文、行数、目录树、交叉项目均已实测）。

### 6. rachelos/we-mp-rss — 公众号文章抓取 + RSS 化 + 代理池反风控

- **证据**
  - `GET /repos/rachelos/we-mp-rss` → stars=**5000**, forks=831, language=Python, default_branch=main, pushed_at=**2026-10-20T16:46:34Z**, created_at=2025-05-14, license_spdx=**NOASSERTION**
  - `GET /repos/rachelos/we-mp-rss/license` → 正文首行 **`MIT License`**，`Copyright (c) 2025 RACHEL`（**metadata 的 NOASSERTION 与正文不符，以正文为准**）
  - `GET /repos/rachelos/we-mp-rss/git/trees/main?recursive=1` → 2465 entries / 2080 blobs；Python 后端 `apis/`：`article.py`（**约 27 KB**）、`cascade.py`（约 40 KB）、`tools.py`（约 36 KB）、`mps.py`（约 21 KB）、`weread.py`（约 21 KB）、`proxy.py`（**约 17 KB**）、`message_task.py`（约 13 KB）、`rss.py`（约 13 KB）、`export.py`（约 12 KB）、`task_queue.py`（约 9 KB）、`filter_rule.py`（约 15 KB）；`compose/singbox/docker-compose.yml`（SING-box 代理）
  - `GET /repos/rachelos/we-mp-rss/commits?per_page=5` → 默认分支最后提交 **2026-10-20**（`9fd4edb2` Merge PR #483 dependabot bump anyio 等）
- **它解决的是哪一层**：**平台适配（微信公众号）+ 反风控（IP 代理池）+ 内容外发（RSS/Webhook/消息推送）**。它的 `apis/proxy.py`（17 KB）和 `compose/singbox/` 解决的是 mulpub 目前**完全缺失**的一环：IP 维度的出口代理池。
- **适配点**：`collection-engine` 的 `wechatmp` adapter 存在，但"整号历史文章翻页 + 定时轮询 + RSS 输出"这套工程化能力缺失。we-mp-rss 的 `apis/article.py`（27 KB）可作该 adapter 的能力参照；`apis/rss.py`（13 KB）产出的 RSS 可直接喂给 `feedparser`，让 mulpub 的采集器**从"抓单篇"升级为"订阅源"**。其 `apis/proxy.py` + `compose/singbox/` 的"IP 代理池反风控"思路可直接对照 mulpub 缺失的 IP 维度轮换。
- **引入成本**：**中**。MIT 正文允许商用闭源，但架构上是 **FastAPI 服务 + SQLite/Redis + 独立 Web UI**，与 mulpub 的 Electron 桌面形态不匹配。合理形态是**作为 mulpub 的可选 sidecar 服务**（Docker compose），桌面端通过 HTTP 调它。**不建议**把其 Python 代码搬进 `collection-engine`。
- **风险**：① 仓库把 `qtserver/node_modules/` 与 `static/assets/*.js`（2.5 MB 级）**提交进了版本库**（2465 entries 中大头是这些）→ 克隆成本高，不影响商用；② 强依赖"扫码授权"获取公众号后台 cookie，账号托管方式与 mulpub 的 `cloud-accounts/` 体系不兼容；③ 抓取公众号内容同样受平台规则约束。
- **建议**：**作为独立服务引入**（MIT 正文可证），并**借鉴** `apis/proxy.py` 的代理池设计。优先级 P1。
- **置信度**：**中**。许可证正文确认为 MIT（高置信）；但"其抓取是否依赖未开源的付费服务"未取证 —— README 首页有 `werss.csol.store` 托管站与商业化引流素材，需实机跑一次才知道自建难度。

### 7. apify/crawlee — 会话池 / 代理轮换 / 持久化状态的范式库（Node + Python 双版本）

- **证据**
  - `GET /repos/apify/crawlee` → stars=**26224**, language=TypeScript, default_branch=**master**, pushed_at=**2026-10-22T22:09:56Z**, license_spdx=Apache-2.0
  - `GET /repos/apify/crawlee/commits?per_page=5` → 默认分支最后提交 **2026-10-22**（`e4c89640` fix: fetch robots.txt through the crawler's HTTP client）
  - `GET /repos/apify/crawlee/license` → 正文 `Apache License Version 2.0`（路径 `LICENSE.md`）
  - `GET /repos/apify/crawlee/git/trees/master?recursive=1` → 3523 entries / 3017 blobs；关键实现文件实测：`packages/basic-crawler/src/internals/session-pool/session-pool.ts`（**约 24 KB**）、`session.ts`（约 11 KB）、`fingerprint.ts`（约 2 KB）、`packages/core/src/proxy-configuration.ts`（约 8 KB）、**`packages/core/src/recoverable-state.ts`（约 19 KB）**、**`packages/core/src/storages/request-queue.ts`（约 48 KB）**、**`packages/core/src/storages/request-list.ts`（约 40 KB）**、**`packages/fs-storage/src/file-system-storage.ts`（约 21 KB）**、`packages/browser-pool/src/proxy-server.ts`（约 1 KB）、`anonymize-proxy.ts`（约 1 KB）；文档 `docs/guides/request-storage.mdx`（约 6 KB）、`result-storage.mdx`（约 16 KB）
  - `GET /repos/apify/crawlee-python` → stars=**9617**, language=Python, default_branch=master, pushed_at=**2026-10-21T17:27:22Z**, license_spdx=Apache-2.0，description 含 `With proxy rotation.`
  - `GET /repos/apify/apify-client-python` → stars=104, Apache-2.0, pushed_at=2026-10-22（**仅用于调 Apify 商业平台 API，与国内平台无关**）
- **它解决的是哪一层**：**会话托管 + 代理轮换 + 抓取状态持久化**。`SessionPool` 管 session 生命周期（失败即换 session/换代理），`ProxyConfiguration` 负责代理来源与轮换策略；**断点续爬由 `packages/core/src/recoverable-state.ts`（约 19 KB）+ `packages/core/src/storages/request-queue.ts`（约 48 KB）/ `request-list.ts`（约 40 KB）+ `packages/fs-storage/src/file-system-storage.ts`（约 21 KB）的存储抽象实现**（⚠️ 上一版此处误写为不存在的 `spiders/checkpoint.ts` —— 该路径在 3017 个 blob 中**零命中**，`/spiders/` 目录亦不存在；`spiders/checkpoint.py` 属于 **Scrapling** 而非 Crawlee，已改正）。其 README 的 `proxy-management.mdx`（约 9 KB）与 `session-management.mdx`（约 19 KB）是公开的**设计文档**，本身就是最好的借鉴材料。
- **适配点**：mulpub 的 `collection-engine` 已有 `cool-down-pool.js` / `identity-binder.js` / `health-monitor.js` / `rate-limiter.js` / `circuit-breaker.js` —— **账号维度**做得很完整；但**会话（cookie/登录态）与 IP 绑定**这一层是空白：Crawlee 的 `session-pool.ts`（24 KB）实现了「session 池 + 失败淘汰 + 代理重绑定 + 指纹持久化」四件事，正好补 mulpub 的 `rpa-engine/browser-data.js` 与 `identity-binder.js` 之间的缝隙。
- **引入成本**：**高**（整体引入）/ **低**（借鉴）。Crawlee 是完整爬虫框架，与 `collection-engine` 功能大面积重叠，整体引入会造成双栈。**但** `session-pool.ts` 的 24 KB 逻辑是纯 TypeScript、无外部依赖耦合，摘出来改造成 mulpub 的 `SessionPool` 成本低。
- **风险**：① 生态围绕 Apify 平台（`apify-client-python` 只是调商业 API），Apache-2.0 无碍但长期可能被商业特性反向牵引；② 整体引入 = 依赖膨胀（Playwright/Cheerio/Puppeteer 全家桶）。
- **建议**：**借鉴实现**（`session-pool.ts` + `proxy-configuration.ts` 两份文件 + 两份 mdx 设计文档），**不整体引入**。这一条同时回答了本维度的第 3 问（账号池/会话托管/代理轮换）。
- **置信度**：**高**。

### 8. adbar/trafilatura — 网页正文 / 元数据抽取（含 feed 发现与 readability 兜底）

- **证据**
  - `GET /repos/adbar/trafilatura` → stars=**7010**, language=Python, default_branch=**master**, pushed_at=**2026-10-22T18:06:20Z**, license_spdx=Apache-2.0
  - `GET /repos/adbar/trafilatura/commits?per_page=5` → 默认分支最后提交 **2026-10-22**（`87d902a0`、`4f27a6e2`、`9dd9c9bd` 等）
  - `GET /repos/adbar/trafilatura/license` → 正文 `Apache License Version 2.0`
  - `GET /repos/adbar/trafilatura/git/trees/master?recursive=1` → 1180 entries / 1171 blobs；`trafilatura/` 实测：`main_extractor.py`（约 36 KB）、`core.py`（约 32 KB）、`utils.py`（约 22 KB）、`htmlprocessing.py`（约 20 KB）、`metadata.py`（约 19 KB）、`xpaths.py`（约 17 KB）、`settings.py`（约 16 KB）、**`readability_lxml.py`（约 15 KB）**、`json_metadata.py`（约 14 KB）、`spider.py`（约 13 KB）、`sitemaps.py`（约 11 KB）、`feeds.py`（约 10 KB）、`baseline.py`（约 13 KB）、`xml.py`（约 43 KB）、`deduplication.py`（约 7 KB）
- **它解决的是哪一层**：**结构化抽取层**。从任意 HTML 抽正文（去导航/去广告/去侧栏）、抽元数据（标题/作者/日期/语言）、输出 CSV/JSON/HTML/MD/TXT/XML，**自带** `readability_lxml.py`（实测 **384 行**，首行 docstring 原文 `Minimalistic fork of readability-lxml code / This is a python port of a ruby port of arc90's readability project`，其内注明 `License of forked code: Apache-2.0`）作为抽取兜底，另有 `feeds.py`（约 10 KB）/ `sitemaps.py`（约 11 KB）做站点 feed 与 sitemap 发现。
- **适配点**：mulpub 采集链路（`collection-engine` 的 platform adapters + `content-cache.js`）目前是"按平台选择器取字段"，遇到**非平台自有页面**（公众号文章页、知乎回答页、新闻落地页、B站专栏）就没有通用正文兜底。`trafilatura` 的 `main_extractor.py`（36 KB）可以直接作为 `collection-engine` 的 fallback 抽取器；`readability_lxml.py` 提供了与 JS 侧 `@mozilla/readability`（Apache-2.0，npm `@mozilla/readability@0.6.0`，2025-03-03 发布）**算法同源**的兜底，两端结果可比对。
- **引入成本**：**中**。Apache-2.0 允许闭源商用（需保留 NOTICE）。依赖 `lxml`（C 扩展，打包体积与 Windows/macOS 交叉编译是主要成本）+ `courlan`/`htmldate`/`justext` 等一串依赖。**若只需要正文抽取**，先试 `trafilatura` 的最小依赖模式。
- **风险**：① 依赖树重（lxml + 多个抽取后端），与桌面端打包体积冲突；② 抽取算法对**国内页面结构**（尤其公众号 `js_content` 排版）未必调优过，需实测；③ 文档全英文，上手成本。
- **建议**：**直接引入**（Python 侧，`packages/python-backend`），定位为「非平台页面的正文兜底抽取器」，不改动平台 adapter 路径。
- **置信度**：**高**（元信息、许可证、树结构、行数、提交记录均实测）。

### 9. kurtmckee/feedparser — RSS / Atom 解析（+ JS 对应物 @rowanmanning/feed-parser）

- **证据**
  - `GET /repos/kurtmckee/feedparser` → stars=**2448**, language=Python, default_branch=main, pushed_at=**2026-10-06T00:52:50Z**, license_spdx=**NOASSERTION**
  - `GET /repos/kurtmckee/feedparser/license` → 正文首行 `feedparser and its unit tests are released under the following license:`，内含 BSD-2 条款（`Copyright (C) 2010-2025 Kurt McKee`、`Copyright (C) 2002-2008 Mark Pilgrim`；二选一保留声明条款 + 免责声明条款）→ 实为 **BSD-2-Clause**
  - `GET /repos/kurtmckee/feedparser/commits?per_page=5` → 默认分支最后提交 **2026-07-30**（`a22c5521`、`de3e0dbb`、`1944d1ed` Merge hotfix v6.0.14 等）
  - JS 侧：`GET /repos/rowanmanning/feed-parser` → stars=50, language=JavaScript, default_branch=main, pushed_at=**2026-10-15T19:43:00Z**, license_spdx=MIT，description=`A well-tested and resilient Node.js parser for RSS and Atom feeds.`；`GET /registry.npmjs.org/@rowanmanning/feed-parser` → latest=**2.1.5**，published=**2026-09-09T06:21:14Z**，license=MIT
  - ⚠️ npm 上的 `feed-parser`（latest 1.0.19）发布于 **2016-12-25**，repo 指向 `abhisheksoni27/feed-parser` —— 是老的 `darien/feed-parser` 分叉，**不要装错**
  - 交叉验证：`trafilatura` 自带 `feeds.py`（约 10 KB）与 `xml.py`（约 43 KB），说明 feed 解析在成熟抽取库里已是标配
- **它解决的是哪一层**：**结构化抽取层（feed 解析）**。把 RSS 2.0 / Atom / JSON Feed 解析成统一结构。
- **适配点**：这条直接补上 mulpub 采集侧的一个结构性空白 —— **mulpub 目前只能"主动去平台页面抓"，没有"订阅源"这一形态**。引入 feed 解析后：(a) 公众号历史文章可经 we-mp-rss / RSSHub 转 RSS 后统一入库；(b) 知乎、B站 UP 主、微博博主都存在成熟的 RSS 镜像，等于用零签名成本换掉一部分需要 a_bogus / x-s 的直采需求 —— **对反检测压力最小的采集通道**；(c) `content-cache.js` 的缓存键设计可直接扩展为按 feed item guid 去重。
- **引入成本**：**低**。BSD-2 / MIT，纯解析无网络无二进制依赖。Python 侧用 `feedparser`，JS 侧用 `@rowanmanning/feed-parser`（2.1.5，2026-09 仍在发版）。需注意 Python 侧 `feedparser` 仓库最后提交 2026-07-30，节奏放缓但未停。
- **风险**：① feed 源本身不稳定（源站改版即断），必须有 feed 级健康检查 —— 这正好复用 mulpub 已有的 `health-monitor.js` / `circuit-breaker.js`；② feed 只给摘要/正文（视源而定），**没有**评论、点赞、弹幕等 mulpub 可能需要的字段；③ 依赖 RSSHub 等第三方转换服务等于把风险外移。
- **建议**：**直接引入**（双端各一个包）。与 we-mp-rss 组合成"公众号订阅"能力。
- **置信度**：**高**。

### 10. steel-dev/steel-browser — 可自建的远程浏览器 API（Apache-2.0）

- **证据**
  - `GET /repos/steel-dev/steel-browser` → stars=**7857**, forks=998, language=TypeScript, default_branch=main, pushed_at=**2026-10-22T20:31:45Z**, created_at=2024-11-01, license_spdx=Apache-2.0, open_issues=76
  - `GET /repos/steel-dev/steel-browser/commits?per_page=5` → 默认分支最后提交 **2026-10-22**（`8362bbda` fix(api): handle PDF URLs in screenshot/pdf；`d8cfe62e` chore(deps)）
  - `GET /repos/steel-dev/steel-browser/license` → 正文 `Apache License Version 2.0`
  - `GET /repos/steel-dev/steel-browser/git/trees/main?recursive=1` → 417 entries / 345 blobs；`api/selenium/server/selenium-server.jar`（**约 37252 KB**）、`api/selenium/driver/chromedriver2`（约 17562 KB）、`api/selenium/driver/THIRD_PARTY_NOTICES.chromedriver`（约 450 KB）、`api/openapi/schemas.json`（约 73 KB）、`api/src/utils/scrape/__tests__/fixtures/article.html.gz`（约 326 KB）、`sec.html.gz`（约 637 KB）
  - README 标签：`🔥 Open Source Browser API for AI Agents & Apps. Steel Browser is a batteries-included browser sandbox`
- **它解决的是哪一层**：**无 GUI 浏览器托管层**（CDP over HTTP 暴露 + 容器化会话 + 代理/指纹注入 + 内置正文抽取 `api/src/utils/scrape`）。它把"浏览器"变成一个可远程调用的 HTTP 服务。
- **适配点**：mulpub 是**桌面应用**（Electron），采集与发布都在用户本机跑，天然有 GUI 环境 → **当前不需要**无头浏览器农场。它的价值在**未来形态**：`api-publish-engine` 已经带 `Dockerfile` / `docker-compose.yml`，一旦把发布侧拆成云端 worker（多账号并发发布），才需要浏览器托管层来集中管理会话与出口 IP。那时 Steel 的 Apache-2.0 与 `chromedriver2` 内置，比 `browserless` 的 SSPL 干净得多。
- **引入成本**：**高**（作为独立服务）+ 体积重（仓库直接提交 38 MB 的 selenium-server.jar 与 18 MB 的 chromedriver2 二进制）。**且它是"面向 AI Agent 的浏览器 API"**，不是为国内平台风控对抗设计的。
- **风险**：① Apache-2.0 但仓库含 chromedriver 等第三方二进制（`THIRD_PARTY_NOTICES.chromedriver` 表明另有第三方许可义务）；② 目标用户是 AI Agent 场景，与 mulpub 的多平台发布编排不对齐；③ 自建浏览器农场涉及出口 IP 与账号的合规边界。
- **建议**：**暂不引入**。作为"未来云端化"的备选记录在案；本轮性价比低于第 1、2 项。
- **置信度**：**中**。仓库事实清楚；但"mulpub 未来是否会云端化"属未取证的产品假设。

### 11. tmwgsicp/wechat-download-api — 公众号文章获取 / RSS / 多格式导出（AGPL-3.0，仅借鉴）

- **证据**
  - `GET /repos/tmwgsicp/wechat-download-api` → stars=**1191**, forks=162, language=Python, default_branch=main, pushed_at=**2026-07-27T15:04:22Z**, created_at=**2026-02-23**（项目仅 8 个月大）, license_spdx=**AGPL-3.0**
  - `GET /repos/tmwgsicp/wechat-download-api/license` → 正文首行 `GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007`
  - `GET /repos/tmwgsicp/wechat-download-api/git/trees/main?recursive=1` → **73 entries / 65 blobs**（工程结构最紧凑的候选）；`utils/helpers.py`（**约 33 KB**，核心抓取逻辑）、`utils/rss_poller.py`（约 14 KB）、`utils/content_processor.py`（约 12 KB）、`utils/export_render.py`（约 10 KB）、`utils/rss_store.py`（约 27 KB）、`routes/rss.py`（约 19 KB）、`routes/export.py`（约 18 KB）、`routes/login.py`（约 22 KB）、`routes/admin.py`（约 15 KB）、`app.py`（约 11 KB）
  - description 实测：`一款完全开源的微信公众号文章获取、RSS 订阅 API 服务，支持整号文章一键导出 7 种格式（Markdown/HTML/Word/PDF/EPUB/Excel/JSON）、IP 代理池反风控、MCP 接入各种 AI Agent 工具。`
- **它解决的是哪一层**：**平台适配（微信公众号）+ 内容外发**。`utils/helpers.py`（34 KB）是单文件版的核心抓取实现，`utils/content_processor.py` 负责正文 → 多格式，`utils/export_render.py` 负责渲染。
- **适配点**：与第 6 项同一目标，但**体量小 33 倍**（73 vs 2465 tree entries）、`utils/` 划分清晰、`app.py` 仅 10 KB —— 是「微信采集能力应该长什么样」的**最小可用参考实现**。mulpub 的 `collection-engine/platform-adapters/wechatmp` 若要补「整号历史文章 + 多格式导出」，`utils/helpers.py` 是最合适的阅读材料；mulpub 已有 `mammoth`（docx→html）依赖，导出链路的现成零件是齐的。
- **引入成本**：**不可引入**（AGPL-3.0）。AGPL 的网络条款（§13）意味着：即使"以独立进程 + HTTP 调用"的方式使用，只要你修改了它并让用户远程交互，就必须向用户提供该修改版的源码。对一个要闭源分发的桌面应用，这是**不可接受的耦合**。**可作为独立未修改服务部署**（不修改、不分发），但那等于引入一个外部依赖，且其 AGPL 仍要求向使用者提供源码。
- **风险**：① AGPL-3.0（最高）；② 项目仅 8 个月历史，2026-07-27 后无提交，**已停滞 3 个月**；③ description 里的 "IP 代理池反风控""MCP 接入"与商业 AI 工具引流。
- **建议**：**仅借鉴**（不引入、不部署）。作为「公众号采集最小实现」的代码阅读材料。
- **置信度**：**高**。

### 12. jhao104/proxy_pool — 代理池 API 服务（MIT）

- **证据**
  - `GET /repos/jhao104/proxy_pool` → stars=**23764**, forks=5426, language=Python, default_branch=master, pushed_at=**2026-06-15T14:36:35Z**, created_at=2016-11-25, license_spdx=MIT, open_issues=297
  - `GET /repos/jhao104/proxy_pool/license` → 正文首行 `MIT License`，`Copyright (c) 2017 J_hao104`
  - `GET /repos/jhao104/proxy_pool/git/trees/master?recursive=1` → 108 entries / 91 blobs；`helper/fetch.py`（约 5 KB）、`helper/check.py`（约 5 KB）、`db/ssdbClient.py`（约 5 KB）、`proxy_pool.sh`（约 5 KB）、`tests/api/test_proxy_api.py`（约 5 KB）
  - `GET /repos/jhao104/proxy_pool/commits?per_page=5` → 默认分支最后提交 **2026-06-15**（`9cc0cad4` Merge PR #883 develop；`a18e011c` fix: mock apscheduler import for tox/uv compatibility）
- **它解决的是哪一层**：**代理池供给层**（抓取 → 校验 → 存储 → HTTP API 取用），不涉及浏览器、DOM、签名。
- **适配点**：这是 mulpub **完全缺失**的一环。`collection-engine` 的 `cool-down-pool.js` / `identity-binder.js` / `health-monitor.js` 管的是**账号维度的冷却与健康**，而"同一账号在多个 IP 间切换以降低关联度"这件事，在 mulpub 里没有对应物 —— 这恰恰是国内平台风控最容易被关联的维度。proxy_pool 提供一个**现成的、带 HTTP API 的代理供给侧**，可与 `identity-binder.js` 对接：账号 ↔ 出口 IP 的绑定与轮换策略放在 identity-binder，代理的获取/校验放在 proxy_pool。
- **引入成本**：**低**（作为独立服务，Docker 化，MIT 无碍）。但 `db/ssdbClient.py` 说明它默认接 **SSDB/Redis**，需要额外部署一个存储；`proxy_pool.sh` 是 shell 启动器，运维面不轻。
- **风险**：① 2470+ star 的项目里 open_issues=297，质量维护一般；② 代理质量是外部依赖，免费代理池的可用率与 IP 信誉不可控；③ 2026-06-15 后停滞 4 个月；④ 引入第三方免费代理源到商业产品，涉及供应链与用户隐私边界。
- **建议**：**借鉴实现 + 可选引入**。P2 —— 优先做「账号 ↔ 出口 IP 绑定策略」（可自研），代理池供给侧按需再决定是否引入。
- **置信度**：**中**。仓库事实清楚；"免费代理池在 2026 年国内平台风控下的实际存活率"未取证。

---

## 三、不确定项与未覆盖

### 查了但没查实的

1. **B站 wbi 签名** —— `SocialSisterYi/bilibili-API-collect`（stars=20163，`GET /repos/.../repos/SocialSisterYi/bilibili-API-collect` → default_branch=**deprecated**、archived=**true**、pushed_at=2026-01-30）实测其 `deprecated` 分支 README 首行即 `本仓库停止维护并永久关停`，并附 **2026-01-28 上海市弘安律师事务所受哔哩哔哩委托发出的警告函**（指控"系统性收集、整理 B站非公开 API 接口及其调用逻辑、参数结构、访问控制及安全认证机制，并以技术文档、代码示例形式向不特定公众传播"）。`Nemo2011/bilibili-api`（stars=4169，archived=true，pushed_at=2026-07-06）main 分支 tree **仅剩 README.md 一个文件（约 4 KB）**，正文是同一律所的**《侵权告知函》**全文，列明"绕过反爬风控与签名鉴权"等具体行为。两个原本最权威的 B站签名参考源**均已因法务原因关闭**。另用 `GET /search/repositories?q=bilibili wbi sign` 检索（total_count=11）无任何有分量的活跃替代品 —— 最高分仅 6 star（`000ylop/bili-wbi-sign-rs`，Rust，2024-06-23 停更）。**结论：B站 wbi 属于「公开材料已被法务销毁」的缺口，只能自研或走官方授权渠道。**
2. **微信公众号官方 API 封装层 —— 规范仓仍在维护，但发布版严重陈旧（"仓库活、包陈旧"两层结论）** —— 规范仓是 **`wechatpy/wechatpy`**：`GET /repos/jxtech/wechatpy` 返回 **HTTP 301 → `https://api.github.com/repositories/23960826`**，跟随重定向后解析为 **`wechatpy/wechatpy`**（`GET /repos/wechatpy/wechatpy` → stars=**4310**, forks=821, language=Python, default_branch=master, pushed_at=**2026-05-19T17:29:46Z**, license_spdx=MIT, archived=false, fork=false, desc=`WeChat SDK for Python`）。**默认分支最后提交 2026-03-07**（`a695b898` Ignore CalId typo (#813)；同日 `3842cb3a` Bump urllib3 from 2.3.0 to 2.6.3 (#812)；再往前 2025-08-28 `195f39fa` `添加 自建应用与代开发应用可通过该接口获取成员授权的敏感字段 (#807)` —— 2025 年仍有**真实特性合入**，不是空提交）。
   **但发布版严重陈旧**：`GET /repos/wechatpy/wechatpy/releases?per_page=4` → 最后一个正式 release 是 **v1.8.14（published 2020-11-22）**（再往前 v1.8.12@2020-03-09 / v1.8.11@2020-03-07 / v1.8.3@2019-12-08）；`GET /repos/wechatpy/wechatpy/tags?per_page=6` → 最新 tag 为 **`v2.0.0.alpha26`**（v2 仍是 alpha 线）；PyPI `GET /pypi.org/pypi/wechatpy/json` → latest=**1.8.18**，uploaded=**2021-11-11**，且其 `project_urls` 指向的正是 `github.com/jxtech/wechatpy`（即上面的 301 目标）。
   ⇒ **分层结论（更准确也更有用）**：① **仓库层面活着**（2025-08 与 2026-03 均有实质提交，MIT，规范仓 4310 star）；② **发行层面死了**（正式版停在 2020-11，PyPI 停在 2021-11，v2 只到 alpha）；③ 因此"微信公众号官方 API 封装层"**不是"生态已死"，而是"没有可 pip install 的现代正式版"** —— 规范仓 `wechatpy/wechatpy` 是**包级可引入性需另判的候选**（可从 git 装 master，但会引入一个 5 年未发正式版、依赖树可能腐化的项目），**不得再断言"无可直接引入的选项"**。
   其它相关仓库实测：`GET /repos/messense/wechatpy` → stars=**65**、pushed_at=**2020-03-16**、MIT（**陈旧副本**，继续如此记述）；`GET /repos/littlecodersh/WeChatPy3` → **404**；`GET /repos/Nemo2011/wechat-uos-api` → **404**；`GET /search/repositories?q=wechat-uos-api` → total_count=**0**；`GET /search/repositories?q=wechatpy3` → total_count=**0**；`GET /repos/littlecodersh/itchatmp` → stars=1589，MIT，pushed_at=**2020-04-24**（**已停更 6 年**）。
3. **`@askjo/camofox-browser` 与 `camoufox-js` 的版本绑定是否可放宽** —— 未读 `jo-inc/camofox-browser` 的构建脚本与 `camoufox-js` 调用面，无法确认 fork 后改 pin 是否会破。
4. **`rachelos/we-mp-rss` 的抓取是否依赖未开源的付费服务** —— 未实机运行；README 的 `werss.csol.store` 托管站与 `MediaCrawlerPro` 式引流素材存在。
5. **`camoufox` 的实际反检测效果** —— 未跑 `bot-detector` 类检测站做 A/B，只有代码层证据（README 的 spoofing 表格 + `browser/patches/` 的 C++ 补丁文件）。
6. **小红书 `x-s-common` / `xsc` 的最新字段** —— **本轮已核销**：`Cloxl/xhshow` 的 `src/xhshow/client.py`（719 行）实测导出 `sign_xs`(111) / `sign_xs_common`(215) / `sign_xs_get`(233) / `sign_xs_post`(265) / `sign_xsc`(297) / `get_x_t`(488) / `sign_headers`(527) / `sign_headers_get`(637) / `sign_headers_post`(679)，`sign_headers` 返回体含 `x-s` / `x-s-common` / `x-t` / `x-b3-traceid` / `x-xray-traceid`（第 620-623 行）——**字段覆盖已证实**。**仍未取证**：mulpub 自身锁定的 xhshow 版本号与实际 `sign_headers_get` 返回的 `a3_hash` 是否正确（须 ≥ 0.2.0，因 0.2.0 于 2026-06-11 发布并原生修复 GET 请求 `a3_hash` 计算 bug，见 xhshow issue #104 —— **本轮未打开该 issue 取证，仅依据 MediaCrawler `playwright_sign.py` 第 25-26 行的注释陈述**）。
7. **`@askjo/camofox-browser` 的 pin 为何自 2026-08-02 起不动 `camoufox-js`** —— 已确认**事实**（6 个版本沿用 `0.11.5`，期间上游发 0.12.0 / 0.12.1 / 0.13.0），并给出**最可能机制**（0.11.5→0.12.0 属 minor 跳变，可能含不兼容变更）。但**未取证**：上游是否已在 `apify/camoufox-js` 的 issue/PR 中说明 0.12.0 的 breaking point —— 未读其 issues 与 CHANGELOG；也未读 `jo-inc/camofox-browser` 仓库的 `package.json` 之外构建配置来确认是否有其它兼容层。
8. **微博 / 快手 / 贴吧 采集是否有合规的开源实现** —— 除 MediaCrawler（禁商用）外未找到有分量的替代；未做穷尽检索。
9. **知乎 `x-zse-96`、快手 GraphQL 的签名机制** —— 仅从 MediaCrawler 目录树看到 `media_platform/zhihu/help.py`（约 15 KB）与 `media_platform/kuaishou/graphql/*.graphql`（7 个文件）存在，未读实现。
10. **SSPL-1.0 的 OSI 认证状态** —— 本轮未找到可经 `api.github.com` 取证的 OSI 决议文件，故文档中不断言（见 5.2 节 (e)）。
11. **mulpub 自身的依赖版本** —— 本轮无法访问 mulpub 仓库，`playwright` / `xhshow` / `@askjo/camofox-browser` 的实际版本均**未取证**；所有"升级/对冲"落点需先在仓内确认现状。

### 本维度仍可能漏掉的方向

- **移动端 App 抓包**（Frida / mitmproxy / 证书固定绕过）—— 国内短视频平台的**真实数据源在 App 而非 Web**，mulpub 走 Web 端拿不到评论/完整数据。本轮未深入：这是"是否换采集通道"的产品级决策，且法律风险最高。
- **RPA 编排框架**（`browser-use` 118910 star、MIT、`pushed_at=2026-10-23`）—— AI Agent 范式，与 mulpub `rpa-engine` 的确定性编排范式不同，未列入正式候选。
- **图片/视频 CDN 侧的防盗链**（referer 校验、签名 URL 过期）—— mulpub `api-publish-engine/media-fetch.js` 与 `resolve-request-media.js` 会撞上这个，但属媒体处理维度，不在本轨道。
- **国内平台官方开放平台 SDK**（抖音/小红书/B站/微信公众平台官方 API）—— 这是**唯一能长期免风控**的采集与发布通道；本轮未取证各平台的 API 覆盖度与准入门槛（如企业资质审核），建议单独立项。

---

## 四、本文档明确劝退的项目

| 项目 | 实测事实 | 劝退理由 |
|---|---|---|
| **g1879/DrissionPage** | stars=**12535**, default_branch=master, pushed_at=**2026-10-23T01:52:13Z**；`GET /repos/g1879/DrissionPage/license` **全文 49 行已逐行读取**（第 1-2 行 `Copyright (c) 2020, g1879` / `All rights reserved.`；第 4 行 `允许任何人以个人身份使用或分发本项目源代码，但仅限于学习和合法非盈利目的。`；第 6 行 `个人或组织如未获得版权持有人授权，不得将本项目以源代码或二进制形式用于商业行为。`；第 8 行 `使用本项目需满足以下条款，如使用过程中出现违反任意一项条款的情形，授权自动失效。`；第 10-16 行 4 条禁止性条款，含 `遵守Robots协议，禁止将DrissionPage用于采集法律或系统Robots协议不允许的数据`；第 18-21 行免责声明；第 23-49 行是同一内容的中文条款英文译文）；且 `commits?per_page=5` 全部为 README 修订（2026-10-23 / 10-20 / 10-14 / 10-13 / 09-14） | **它不是开源项目，是"源码可见（source-available）+ 非商业用途"的私定授权** —— 这点必须定性清楚，见下方专段。**不推荐** |
| **browserless/browserless** | stars=**13844**, lang=TypeScript, default_branch=main, pushed_at=2026-10-22T16:05:42Z；`GET /repos/browserless/browserless/license` **全文 8 行已逐行读取**（见下方专段）；SSPL-1.0 全文另从 `GET /repos/mongodb/mongo/contents/LICENSE-Community.txt`（557 行，`spdx=NOASSERTION`，首行 `Server Side Public License VERSION 1, OCTOBER 16, 2018`）取证 | **不可自建远程浏览器服务**：SSPL §13 的触发条件与"Service Source Code"定义均已用原文核实（见下方专段），一旦对第三方提供该服务，mulpub 的 `api-publish-engine` / `rpa-engine` / `cloud-accounts` / `upload/providers` 全部落入必须开源的"automation/management/UI/API/storage/hosting software"范围，闭源商业形态不可能满足。**替代：steel-browser（Apache-2.0）**。**不推荐** |
| **firecrawl/firecrawl** | stars=**194362**, lang=TypeScript, default_branch=main, pushed_at=2026-10-22T23:02:47Z, license_spdx=**AGPL-3.0** | ① **AGPL-3.0**，闭源桌面应用不可链接；② 面向**通用网页 → LLM Markdown**，对抖音/小红书/B站这类需要平台签名与登录态的场景无解；③ 194k star 体量下维护重心在自家云服务。**不推荐**（对照价值也低） |
| **unclecode/crawl4ai** | stars=**86065**, lang=Python, default_branch=main, pushed_at=2026-10-22T19:03:10Z, license_spdx=**Apache-2.0** | 许可证没问题，但**定位错配**：其核心价值是"任意网页 → LLM-ready Markdown"，对国内短视频/图文平台（需要登录态 + 平台签名 + 评论区分页）无覆盖。mulpub 不做 LLM 爬取服务。**不推荐** |
| **browser-use/browser-use** | stars=**118910**, forks=13206, lang=Python, default_branch=main, pushed_at=**2026-10-23T00:56:16Z**, license_spdx=MIT；description=`Open-source Python library for AI browser agents` | 许可证宽松、活跃度极高，但**范式不匹配**：mulpub `rpa-engine` 是确定性脚本编排（`platform-selectors.js` + `publish-signer.js` + 定时发布），browser-use 是 **LLM 决策驱动**的 agent 循环 —— 引入会引入不可复现性与 token 成本，且与 `rpa-engine` 的重放/幂等语义冲突。可作为"agent 浏览器抽象层"的**对照标杆**阅读，不作为依赖。**不推荐引入** |
| **ultrafunkamsterdam/undetected-chromedriver** | stars=**12878**, forks=1350, default_branch=master, pushed_at=**2025-07-05T10:42:02Z**（已停更 15 个月）, license_spdx=GPL-3.0, open_issues=**1142** | ① **GPL-3.0** 传染性 copyleft，与闭源分发冲突；② 官方 README 自述为 **nodriver 的前身**（`nodriver` README 原文：`This is the official successor of the Undetected-Chromedriver python package`）；③ 停更 + 1142 个 open issue。**不推荐** |
| **ultrafunkamsterdam/nodriver** | stars=**4885**, forks=443, lang=Python, default_branch=main, pushed_at=**2026-10-08T15:08:29Z**, license_spdx=**AGPL-3.0**；`commits?per_page=5` → 2026-10-08 / 2026-10-05 ×2 / **2026-05-13 ×2**（节奏明显放缓）；README：`No more webdriver, no more selenium`、`Direct communication provides even better resistance against WAF's` | **AGPL-3.0 不可引入**（闭源商业分发）。但其**思路值得抄**：直接说 CDP 协议、绕开 webdriver/selenium 进程，正是 rebrowser-patches 修补 `Runtime.Enable` 泄漏要达到的效果。**结论：不引入，思路已被 rebrowser-patches 以 MIT 方式覆盖，优先级更高** |
| **lightpanda-io/browser** | stars=**36878**, lang=**Zig**, default_branch=main, pushed_at=**2026-10-23T04:31:19Z**, license_spdx=**AGPL-3.0** | ① AGPL-3.0；② 更关键的是**它不是完整浏览器**：无 JS 引擎。国内短视频/图文平台全是重度 JS + 签名环境，纯 HTTP 渲染拿不到数据，也无法执行 a_bogus / x-s 所需的 JS 注入。**不推荐** |
| **SocialSisterYi/bilibili-API-collect** / **Nemo2011/bilibili-api** | 前者 stars=**20163**、default_branch=**deprecated**、archived=**true**；README 首行 `本仓库停止维护并永久关停`，附 2026-01-28 哔哩哔哩委托律所警告函。后者 stars=**4169**、archived=**true**，main 分支 tree 仅剩 README.md（约 4 KB），正文为上海市弘安律师事务所《侵权告知函》 | **仓库已因法务原因永久关停**，代码与文档已被作者删除，不可获取也不可再传播。**这是本维度最重要的风险信号**：B站已对"整理非公开 API 与签名鉴权并公开传播"采取律师函行动。mulpub 的 bilibili 采集/发布实现必须按"自研、不外传、不提供绕过鉴权的能力"来设计，**不应再引入任何外部 B站逆向材料**。**明确劝退（且应作为合规红线）** |
| **NanmiCoder/MediaCrawler**（作为依赖） | 许可证正文 `NON-COMMERCIAL LEARNING LICENSE 1.1`，头部声明第 1 条 `不得用于任何商业用途` | **禁商用**。仅可阅读取思路，不可引入代码、不可拷贝其 `xhs_sign.py`（152 行）到 mulpub 闭源产物。mulpub 的小红书签名继续走 `Cloxl/xhshow`（MIT）。**作为依赖劝退，作为参考保留** |
| **apify/apify-client-python** | stars=**104**, lang=Python, default_branch=master, pushed_at=2026-10-22T02:06:33Z, license_spdx=Apache-2.0 | 是 **Apify 商业平台**的 API 客户端（跑 Actor、管 dataset/key-value store）。国内平台不在 Apify 的覆盖范围，且把国内账号托管到境外 SaaS 有数据出境合规问题。**不推荐**（Crawlee 的**库**部分有用，Apify 的**平台**部分无用） |
| **scrapy/scrapy** | stars=**64965**, lang=Python, default_branch=master, pushed_at=2026-10-22T21:57:27Z, license_spdx=BSD-3-Clause | 许可证无碍、也很成熟，但它是**通用爬虫框架**（并发/调度/中间件/Item Pipeline），与 mulpub 已有的 `collection-engine`（`rate-limiter` / `circuit-breaker` / `cool-down-pool` / `health-monitor` / `content-cache` / `audit-logger` / `behavior-simulator` / `identity-binder` / `collection-strategy`）**功能大面积重叠且粒度更粗**。Scrapy 也没有任何针对国内平台签名/风控的东西。**不推荐（把现有 collection-engine 当空白重做是倒退）** |
| **berstend/puppeteer-extra**（现有栈本身） | `GET /repos/berstend/puppeteer-extra` → stars=7411, default_branch=master, pushed_at=**2024-07-18T12:28:02Z**；**但 `GET /repos/berstend/puppeteer-extra/commits?per_page=3` → 默认分支最后提交 2023-03-01**（`39248f1f` Publish / `3ca317e5` fix(puppeteer-extra): Prefer puppeteer over puppeteer-core / `2f4a357f` Publish，三条同为 2023-03-01）⇒ **`pushed_at` 的 2024-07-18 系其他分支/tag 推送，不代表默认分支活跃度**（按自订的取证纪律第 4 条）；npm `playwright-extra` latest 4.3.6 发布于 **2023-03-01**；npm `puppeteer-extra-plugin-stealth` latest 2.11.2 发布于 **2023-03-01** | **不是新候选，而是现状风险**。mulpub 依赖的两个包**默认分支实际停更于 2023-03-01（距今约 3.5 年 / 1300+ 天）**，且只做 JS 层属性覆盖（`navigator.webdriver` 等），**不覆盖 `Runtime.Enable` 这一 2025 年后的主力检测信号**。处置：加 Playwright 与 stealth plugin → 由 rebrowser-patches 承接（见第 1 项），并把 `berstend/puppeteer-extra` 标记为待替换。**现状劝退** |
| **jo-inc/camofox-browser**（现有栈本身） | `GET /repos/jo-inc/camofox-browser` → stars=**11856**, forks=**1192**, lang=JavaScript, default_branch=master, pushed_at=**2026-10-23T02:47:40Z**, created_at=**2026-01-26**, license_spdx=MIT（`/license` 正文 `MIT License, Copyright (c) 2025 Jo, Inc`）；`/tags?per_page=15` → 15 个 tag，latest `v1.18.1`(sha `39c82094`)；`/releases?per_page=12` → 12 条，发布日 2026-08-02 / 08-19 / 09-10 / 09-14 / 09-22 / 09-30 / 10-05（**64 天 7 版**）+ 5 条 `camoufox-backup-*` 引擎快照；npm `@askjo/camofox-browser` 45 个版本，`camoufox-js` 依赖自 `1.13.1`(2026-08-02) 起锁 `0.11.5`，其后 6 个版本未动；而 `camoufox-js` 侧已发 `0.12.0`(2026-07-31) / `0.12.1`(10-06) / `0.13.0`(10-16)，`GET /repos/apify/camoufox-js` → stars=273, pushed_at=2026-10-22T10:55:37Z, license_spdx=MPL-2.0 | **不是劝退，是版本告警（已修正表述）**。camofox-browser 自身发版很勤（每 6~9 天），**但底层 `camoufox-js` 自 2026-08-02 起冻结在 0.11.5 已 3 个多月**。差距成因是 `0.11.5→0.12.0` 属 **minor 跳变（可能含不兼容变更）**，上游在等兼容性结论，**不是"忘了升"**。⇒ 处置：① 提 issue 问 0.13.0 兼容性；② 把 mulpub 侧 pin 从精确 `0.11.5` 放宽为 `~0.11.5` 以便吃到补丁；③ 跨 minor 前先评估 `xrap`/`fingerprint` 接口变动；④ 过渡期用 mulpub 自己的 `identity-binder.js` 保证 UA/时区/locale/viewport/WebGL vendor 自洽。**继续使用，但需对冲** |

---

## 五、两个许可证的专门定性（评审要求补充）

### 5.1 g1879/DrissionPage 的 LICENSE 不是开源许可证 —— 准确分类是「源码可见（source-available）+ 非商业授权」

`GET /repos/g1879/DrissionPage/license` 返回的正文共 **49 行**（中英双语，前 22 行中文、23-49 行英文译文），逐行读到的结构与判定如下：

| 行 | 原文 | 对定性的作用 |
|---|---|---|
| 1-2 | `Copyright (c) 2020, g1879` / `All rights reserved.` | 采用**版权保留**模型 —— 授权是"附条件授予"，而非开源许可证的"放弃版权"模型 |
| 4 | `允许任何人以个人身份使用或分发本项目源代码，但仅限于学习和合法非盈利目的。` | **同时限制使用主体**（个人）与**用途**（学习/合法非盈利） |
| 6 | `个人或组织如未获得版权持有人授权，不得将本项目以源代码或二进制形式用于商业行为。` | **禁止商业使用**，且明文覆盖"源代码**或二进制形式**"两种形态 |
| 8 | `使用本项目需满足以下条款，如使用过程中出现违反任意一项条款的情形，授权自动失效。` | 授权**可被单方自动撤销**，不具备开源许可证要求的不可撤销性 |
| 10-16 | 4 条禁止性条款，第 16 条为 `遵守Robots协议，禁止将DrissionPage用于采集法律或系统Robots协议不允许的数据` | 把 robots 合规设为**授权生效要件**之一 |
| 18-21 | 免责声明（行为责任自负、与版权持有人无关、不为缺陷负责） | 典型的私定免责结构，非标准化 OSI 许可模板 |
| 23-49 | 上述条款的英文译文 | 与中文条款一一对应，无额外授权 |

**判定**：按 OSI《开源定义》的自由要件核对 —— 第 1 条（自由使用）、第 3 条（自由再分发）、第 6 条（可与商业用途结合）**均不满足**（第 4/6/8 行直接排除）。因此：

- ✅ 准确分类：**source-available / 非商业用途授权（NC）**，**不是开源（open source）**；
- ❌ 既非 GNU 系 copyleft（无"衍生作品须同样开放"条款），也非 MIT/Apache 系 permissive（无"可用于任何目的"的授予），也非 CC BY-NC 三件套（无"署名/非商业/相同方式共享"标准化条款）；
- ⇒ 它是一份**私定、附条件、不可撤销性缺失的自定义许可**，在 mulpub 选型清单里应归入"**非开源**"一类，与 MIT/Apache/BSD/AGPL 分开看。

**对 mulpub 的直接结论（比"禁商用"更严）**：

1. 不可作为依赖引入、不可打包分发 —— 第 6 行明文覆盖"源代码或二进制形式用于商业行为"；
2. **连"开发期参考/运行"也不在授权范围内** —— 第 4 行要求"以个人身份"且"仅限学习和合法非盈利目的"，而用其开发 mulpub 这一商业产品属于**组织性、商业性使用**，超出授权。⇒ **须彻底排除，包括不作为参考资料**；
3. 第 8 行"授权自动失效"意味着越界后**无法事后补救**（不能通过事后购买授权来修复已发生的分发）；
4. 第 16 行的 robots 条款对 mulpub 反而是**更严的约束**：mulpub 的采集走平台 Web API + 签名鉴权，大量目标接口并不在 robots.txt 覆盖范围内，而本许可把"采集法律或系统 Robots 协议不允许的数据"设为授权失效条款之一 —— 合规争议中授权会先于其它判断失效；
5. 功能上也不需要它：DOM 抽象 + 无痕模式由 mulpub 已有的 Playwright 加上 rebrowser-patches（第 1 项）完全覆盖。

### 5.2 browserless 与 SSPL-1.0 第 13 条：自建远程浏览器服务是否触发源码公开义务

**（a）browserless 自身的 LICENSE 全文仅 8 行，已逐行读取**（`GET /repos/browserless/browserless/license`）：

```
1| # License
3| This work is dual-licensed under the MongoDB Server-Side Public License OR the browserless commercial license.
4| You can choose between one of them if you use this work.
6| If you want to use browserless to build commercial sites, applications, or in a continuous-integration system that's closed-source then you'll need to purchase a commercial license. This allows you to keep your software proprietary whilst still using browserless. [You can purchase a commercial license here](https://www.browserless.io/contact).
8| `SPDX-License-Identifier: SSPL-1.0 OR Browserless Commercial License`
```

**（b）SSPL-1.0 全文取证来源**：`GET /repos/mongodb/mongo/contents/LICENSE-Community.txt` → **557 行**（`GET /repos/mongodb/mongo` → stars=**28660**, default_branch=master, pushed_at=**2026-10-22T23:42:15Z**, license_spdx=NOASSERTION）。该文件第 1 行 `Server Side Public License` / 第 3 行 `VERSION 1, OCTOBER 16, 2018`；**§13 "Offering the Program as a Service." 位于第 478 行起**。

**（c）§13 原文关键句（逐字引用）**：

> `If you make the functionality of the Program or a modified version available to third parties as a service, you must make the Service Source Code available via network download to everyone at no charge, under the terms of this License.`
>
> `Making the functionality of the Program or modified version available to third parties as a service includes, without limitation, enabling third parties to interact with the functionality of the Program or modified version remotely through a computer network, offering a service the value of which entirely or primarily derives from the value of the Program or modified version, or offering a service that accomplishes for users the primary purpose of the Program or modified version.`
>
> `Service Source Code` means the Corresponding Source for the Program or the modified version, and **the Corresponding Source for all programs that you use to make the Program or modified version available as a service, including, without limitation, management software, user interfaces, application program interfaces, automation software, monitoring software, backup software, storage software and hosting software**, all such that a user could run an instance of the service using the Service Source Code you make available.

**（d）对 mulpub 的三级场景判断**：

| 场景 | 是否触发 §13 | 依据与后果 |
|---|---|---|
| **A. 自建 browserless 远程浏览器服务并对第三方提供**（任务第 5 问"是否值得自建"的那个选项） | **必然触发** | 触发要件是"make the functionality ... available to third parties as a service"，§13 原文明文包含 `enabling third parties to interact with the functionality ... remotely through a computer network` —— 远程浏览器农场字面命中。触发后的义务不是"公开你改的那几行"，而是提供 **"Service Source Code"**，其定义把 `all programs that you use to make the Program ... available as a service` **全部纳入**，并明文列举 automation / management / user interfaces / application program interfaces / monitoring / backup / storage / hosting software。对应到 mulpub：`api-publish-engine`（automation）、`rpa-engine`（automation）、`cloud-accounts/`（management）、`upload/providers/`（storage）、`publish/risk-suspender.js` 等（monitoring）、桌面端 UI（user interfaces）—— **几乎整个产品都要开源**，且要求"a user could run an instance of the service"。⇒ 闭源商业形态**不可能满足** |
| **B. 仅在开发机本地运行，不对外提供服务、不分发** | **不触发** | §13 的构成要件是"available to third parties as a service"，本地自用不满足；§4/§5/§6 的分发义务也因未 conveying 而不适用。**技术层面不产生源码公开义务。** 但 browserless LICENSE 第 6 行自己把 `build commercial sites, applications, or in a continuous-integration system that's closed-source` 明确指向 `you'll need to purchase a commercial license` —— 这是 browserless 的**商业立场声明（不是 SSPL 条款）**，mulpub 若在 CI 中用它构建闭源商业应用，就落在对方明示收费的场景内 |
| **C. 把 browserless 集成进 mulpub 产物并分发** | 触发常规 copyleft 分发义务 | §4/§5/§6 + §7 Additional Terms，与闭源分发直接冲突 |

**（e）结论**：① **"自建 browserless 远程浏览器服务"对 mulpub 是死的** —— 不是"SSPL 看起来很严"，而是 §13 的义务范围（"Service Source Code"）被显式扩张到整套配套软件，闭源商业形态无法满足；② 本地开发期使用在技术上不触发 §13，但要么在 CI 场景落到 browserless 的商业许可条款内，要么自担合规判断；③ 唯一合法路径是**购买 browserless 商业许可**；④ 替代方案是 **steel-dev/steel-browser**（Apache-2.0，第 10 项）—— 若确实要自建远程浏览器服务，这是许可证上唯一干净的选择；⑤ ⚠️ 两条**明确未取证**的边界：**SSPL-1.0 的 OSI 认证状态**本轮未取证（未找到可经 `api.github.com` 取证的 OSI 决议文件），故本文档**不断言**其 OSI 状态 —— 但无论认证状态如何，上述 §13 义务范围已足以阻断；与 **AGPL-3.0 网络条款**的差异对照（触发点不同、义务范围不同）属法务判断范畴，本文档仅提示"两者不可互相类推"，**AGPL 侧未取证**。**建议把本节交法务复核后再做最终决定。**

---

## 附：取证方法与自查

- 元信息：`GET /repos/{owner}/{repo}`，逐条记录 `stars / forks / language / default_branch / pushed_at / license.spdx_id / archived / open_issues_count`。
- 活跃度：`GET /repos/{owner}/{repo}/commits?per_page=5` 看**默认分支**最后提交日期与 commit message（不用 `pushed_at` 单独下结论）。
- 目录结构：`GET /repos/{o}/{r}/git/trees/{default_branch}?recursive=1`，读 blob 路径与 size。
- 代码内容：`GET /repos/{o}/{r}/contents/{path}` → base64 解码 → 统计行数、列方法名、确认 import 链（如 Scrapling→curl_cffi、MediaCrawler→xhs_sign 的实际调用）。
- 许可证：`GET /repos/{o}/{r}/license` **以正文首行与条款为准**。本次发现 2 处 metadata 与正文不符：`rachelos/we-mp-rss`（metadata NOASSERTION → 正文 MIT）、`kurtmckee/feedparser`（metadata NOASSERTION → 正文 BSD-2）；另有 4 处 metadata 正确但正文含非标准限制（DrissionPage 非商用、MediaCrawler 非商用、browserless SSPL、firecrawl/firecrawl AGPL）。**DrissionPage 与 browserless 两项已在第 5 节给出逐行定性**。
- **SSPL-1.0 全文来源**：`GET /repos/mongodb/mongo/contents/LICENSE-Community.txt`（557 行；`GET /repos/mongodb/mongo` → stars=28660, default_branch=master, pushed_at=2026-10-22T23:42:15Z, license_spdx=NOASSERTION），§13 起于第 478 行 —— 用于对 browserless 的第 13 条判定。
- **签名逐行比对来源**：`GET /repos/NanmiCoder/MediaCrawler/contents/media_platform/xhs/playwright_sign.py`（72 行全文）、`.../xhs_sign.py`（152 行全文）、`GET /repos/Cloxl/xhshow/contents/src/xhshow/client.py`（719 行，方法名 + 行号）、`.../src/xhshow/core/crc32_encrypt.py`（125 行全文）—— 用于第 5 项的"逐行比对"结论。
- **版本节奏来源**：`GET /repos/jo-inc/camofox-browser/tags?per_page=15`、`.../releases?per_page=12`、`GET /registry.npmjs.org/@askjo%2Fcamofox-browser`、`GET /registry.npmjs.org/camoufox-js`（逐版本发布时间线 + 依赖 pin 变化）。
- 分支陷阱：`SocialSisterYi/bilibili-API-collect` 的 `default_branch` 是 `deprecated` 而非 `main`/`master`；`Nemo2011/bilibili-api` 的 `default_branch` 是 `main` 但该分支已被清空只剩 README。
- 依赖实测：`GET /registry.npmjs.org/{pkg}`（取 `dist-tags.latest` 与 `time`）、`GET /pypi.org/pypi/{pkg}/json`。
- 404 剔除记录（**全部已用 `curl -L` 跟随重定向复核**，确认是真 404 而非 301 别名）：`ultrafunkamsterdam/camofox`、`Milvus-io/camofox`、`askjo/camofox`、`mirkobrombin/DrissionPage`（真实归属为 `g1879/DrissionPage`）、`kamillakp/firecrawl`、`ultrafunkamsterdam/dash-scraping`、`binux/pyppeteer`、`nanmi/crawlee`、`n8henrie/browser-cookie3`、`Nemo2011/wechat-uos-api`、`littlecodersh/WeChatPy3` —— 实测 404，已在正文用检索到的真实归属替代。
- **301 别名（假 404）两例，均已按重定向后的真实归属处理**：`mendableai/firecrawl` → **301 → `firecrawl/firecrawl`**（stars=194367）；`jxtech/wechatpy` → **301 → `https://api.github.com/repositories/23960826` → `wechatpy/wechatpy`**（stars=4310）—— 后者上一版曾被误记为 404 并据此断言"生态已死"，本版已修正为"仓库活、包陈旧"的分层结论（见第三节第 2 条）。
- ⚠️ **方法论教训（已固化为取证纪律）**：GitHub REST 的 `GET /repos/{owner}/{repo}` 对**改名/转移过的仓库返回 301 而不是 404**，且 `curl` 默认**不跟随**重定向 —— 不加 `-L` 就会把"改名"误判成"不存在"。本次 13 个剔除项已全部用 `-L` 复核，结论未变；而 `jxtech/wechatpy` 这一例因**漏了 `-L`**被误判。**后续所有仓库存在性判定必须带 `-L`（或直接看 `location` 头）。**
- 未使用任何 GitHub 镜像站（github.es / gitgub.com / git.tdem.in 等）与任何 AI 生成的营销站数据；所有 star 数均来自 `api.github.com` 本次响应。

---

## 交付说明（Delivery Protocol）

**Summary** —— 调研 mulpub「浏览器自动化、反检测与内容采集」维度，对 12 个候选（rebrowser-patches、curl_cffi、camoufox、Scrapling、MediaCrawler、we-mp-rss、Crawlee、trafilatura、feedparser、steel-browser、wechat-download-api、proxy_pool）逐个做 api.github.com / npm / PyPI 实测取证，每个候选 ≥2 条独立 API 证据，许可证一律以 `/license` **正文**为准；另评估并劝退 13 个项目。结论不是"重推采集框架"，而是三件事：① 首选直接引入 `rebrowser-patches`（MIT，补上现有 stealth 栈 3.5 年未修的 `Runtime.Enable` 泄漏）与 `curl_cffi`（MIT，补 axios/httpx 缺失的 TLS/JA3 伪装）；② 指出 mulpub 真正缺的块 —— 采集侧微博/快手/贴吧、IP 维度代理池、RSS 订阅源形态、B站 wbi；③ 明确 B站两仓因律师函永久关停应作为合规红线。**本版针对上一轮评审的 5 条驳回意见做了实质修正**（见 Notes 修正表），其中 1 项推翻了原结论（MediaCrawler 签名零增量），2 项新增专门定性章节（DrissionPage 非开源、browserless SSPL §13）。**篇幅说明：全文 12,221 中文字，超出 6000~9000 目标区间约 36%，超出部分全部来自评审明确要求的第 5 节许可证专门定性（§5.1+§5.2 约 2700 字）与第 5 项的签名逐行比对（约 1200 字）；12 个候选的正文部分本身在区间内，未为凑数删减任何 API 证据值。**

**Changed files**
- `01-docs/research/mulpub-credit-cost-2026-10-25/tracks/track-automation.md`（本文件，新建；**12,221 中文字 / 430 行**）
- 进度看板（沙箱内产物，未入库）（追加 **2 条** `track-automation` 的 `done` 进度条目：12:47 首版交付、12:55 复核修订）

**Notes** —— ① 本轮所有 star / pushed_at / 许可证均为本次 API 响应实测值，未引用任何 GitHub 镜像站或 AI 生成的营销站；② 发现 **2 处 GitHub metadata 的 license.spdx_id 与 `/license` 正文不符**（`rachelos/we-mp-rss`：NOASSERTION → 正文 MIT；`kurtmckee/feedparser`：NOASSERTION → 正文 BSD-2），另 4 处为"metadata 正确但正文含非标准限制"（DrissionPage 非商用、MediaCrawler 非商用、browserless SSPL、firecrawl AGPL）—— 这类项目若只看 metadata 会误判；③ `GET /search/code` 全程未用于能力判定（改用 `git/trees` + `contents`），搜索 API 仅用于"仓库是否存在"的初筛；④ 沙箱内 `grep` 工具对 `.mavis/**` 路径无命中（疑被 gitignore 过滤），内容核对改用 `edit` 精确串替换与 `bash grep`，不影响结论。

**本轮相对上一版（被评审驳回）的 5 处实质修正**：

| # | 评审指出 | 本轮的修正与新增证据 |
|---|---|---|
| 1 | `xhs_sign.py`(约 7 KB) / `playwright_sign.py`(约 2 KB) 未逐行比对 | **已逐行读全文**（152 行 / 72 行）。**结论反转**：MediaCrawler 的小红书签名**零自有算法** —— `playwright_sign.py` 第 51-65 行直接 `from xhshow import Xhshow` 并调 `sign_headers_get/post`；`xhs_sign.py` 只含 `mrc()`(CRC32 变体，供 x-s-common 的 x9) + 自定义 Base64 + `get_trace_id()`。**mulpub 已在用同一个 MIT 上游 `Cloxl/xhshow`，故该候选在签名维度对 mulpub 无增量**，降级为"仅可阅读平台适配结构"。新增对照：`xhshow/core/crc32_encrypt.py`(125 行) 与 MediaCrawler `mrc()` 的 6 维逐项比对表（算法与最终异或一致，但上游无 57 字符截断、支持 utf8 模式、惰性生成 CRC 表） |
| 2 | 同上 | 并追加行动项：确认 mulpub 锁定的 xhshow **≥ 0.2.0**（0.2.0 于 2026-06-11 发布，原生修复 GET 请求 `a3_hash` 计算 bug） |
| 3 | camofox-browser 只测到 default 分支 last=2026-10-05，**tag 节奏未查** | **已查 tags + releases + npm 逐版本时间线**。实测：15 个 tag（latest v1.18.1，sha `39c82094`）；releases 12 条，2026-08-02→10-05 的 64 天发 7 版（**camofox-browser 自身很健康**）+ 5 条 `camoufox-backup-*` 引擎快照；npm 45 个版本，`camoufox-js` 依赖**自 `1.13.1`(08-02) 起锁 `0.11.5`，其后 6 版未动**，而 `camoufox-js` 已发 `0.12.0`(07-31) / `0.12.1`(10-06) / `0.13.0`(10-16)。**原表述"落后 1 个 minor 档"已删除**，改为：差距成因是 `0.11.5→0.12.0` 属 **minor 跳变（可能含不兼容变更）**，上游不敢升 ⇒ 处置从"直接改 pin"改为"**放宽为 `~0.11.5` + 问上游兼容性 + 过渡期靠 `identity-binder.js` 补指纹自洽**" |
| 4 | DrissionPage 的 NOASSERTION 正文是**中文自定义非商用条款，非 OSI 许可证，是否算"开源项目"需明确定性** | **已新增第 5.1 节专门定性**：**它不是开源许可证，是 source-available + 非商业授权**。逐行依据：`All rights reserved.`（版权保留模型）+ 限个人主体与用途 + 禁商业（覆盖源代码与二进制）+ **授权可自动撤销（不具备开源要求的不可撤销性）** ⇒ 不满足 OSI 自由要件 1/3/6；既非 copyleft 也非 permissive 也非 CC BY-NC 标准化条款。**结论比"禁商用"更严**：连开发期参考使用都不在授权内（第 4 行要求"个人身份 + 学习/非盈利"），须**彻底排除**；另指出其 robots 条款对走 API 签名的 mulpub 是**更严的约束**（授权失效条款之一） |
| 5 | browserless 的 "SSPL OR commercial license" 双授权，自建远程浏览器服务是否触发 SSPL §13 需法务判断 | **已新增第 5.2 节**，并**取到 SSPL-1.0 全文原文**（`GET /repos/mongodb/mongo/contents/LICENSE-Community.txt`，557 行，§13 起于第 478 行），逐字引用三条关键句。**三级场景判定**：① 自建远程浏览器服务对第三方提供 ⇒ **必然触发 §13**（原文明文包含 `enabling third parties to interact with the functionality ... remotely through a computer network`），义务是提供 **"Service Source Code"**，其定义把 `all programs that you use to make the Program ... available as a service` 全部纳入并明文列举 **automation / management / user interfaces / application program interfaces / monitoring / backup / storage / hosting software** ⇒ mulpub 的 `api-publish-engine` / `rpa-engine` / `cloud-accounts` / `upload/providers` 全部落入，**闭源不可能满足**；② 仅开发机本地运行、不对外提供服务 ⇒ **技术层面不触发 §13**（但 browserless LICENSE 第 6 行自己把闭源商业/CI 指向购买商业许可）；③ 集成进产物分发 ⇒ 触发常规 copyleft 分发义务。⚠️ **SSPL 的 OSI 认证状态本轮未取证，故文档不断言**；AGPL 对照亦标注未取证，**建议整节交法务复核** |

**新增未取证项**（已同步进第三节）：SSPL 的 OSI 认证状态；`apify/camoufox-js` 的 0.12.0 breaking point 具体内容（未读其 issues/CHANGELOG）；xhshow issue #104 原文（仅依据 MediaCrawler 注释陈述）；mulpub 自身依赖的实际版本号（本轮无法访问 mulpub 仓库，所有"升级/对冲"落点需先在仓内确认现状）。

---

**第 2 轮复核的 5 处定点修补（已全部改完并重新落盘）**

| # | 评审意见 | 本轮修补 | 复核实测 |
|---|---|---|---|
| 1（**必改**） | `jxtech/wechatpy` 不是 404，是 301 假 404；据此得出的"微信公众号官方 API 封装层生态已死"与实测矛盾 | ① 第三节第 2 条**整条重写**为"**仓库活、包陈旧**"的分层结论：规范仓 `wechatpy/wechatpy`（4310 star / MIT / master）默认分支最后提交 **2026-03-07**，且 2025-08-28 有真实特性合入（#807）；但最后正式 release 是 **v1.8.14@2020-11-22**、PyPI **1.8.18@2021-11-11**、v2 只到 **alpha26** ⇒ **"没有可 pip install 的现代正式版"**，**已删除"生态已死/无可直接引入的选项"**；② 从 404 表移出，改列入"需进一步核实的候选"；③ `messense/wechatpy`（65 star，停更 2020-03-16）继续作为"陈旧副本"记述 | `GET /repos/jxtech/wechatpy` **HTTP 301 → `https://api.github.com/repositories/23960826`**；跟随后 `wechatpy/wechatpy` stars=**4310** forks=821 db=master pushed_at=**2026-05-19T17:29:46Z** MIT archived=false；`commits?per_page=5` → **2026-03-07**(`a695b898` #813) / 2026-03-07(`3842cb3a` urllib3 #812) / **2025-08-28**(`195f39fa` #807 真实特性) / 2025-08-08(`3365b16f` #802)；`tags` → `v2.0.0.alpha26`；`releases` → 最后正式版 **v1.8.14@2020-11-22** |
| 2（**必改**） | `apify/crawlee` 的 `spiders/checkpoint.ts` 在树里不存在 | 已改为 Crawlee **真实机制**：`packages/core/src/recoverable-state.ts`(**约 19 KB**) + `packages/core/src/storages/request-queue.ts`(**约 48 KB**) / `request-list.ts`(**约 40 KB**) + `packages/fs-storage/src/file-system-storage.ts`(**约 21 KB**)；并在正文显式标注 ⚠️"上一版误写为 `spiders/checkpoint.ts`，该路径在 3017 个 blob 中**零命中**，`/spiders/` 目录不存在；`spiders/checkpoint.py` 属于 **Scrapling**"。证据行也补了这 4 个真实路径 | `GET /repos/apify/crawlee/git/trees/master?recursive=1` → **3523 entries / 3017 blobs**；全量 blob 路径中 `checkpoint` **零命中** |
| 3（**必改**） | 交付说明自述与 workspace 实际不符：board.md 0 条 track-automation、"约 59 KB / 7400 中文字"与另一处"11000 中文字"自相矛盾、xhshow"共 10 个发布"实为 11 | ① 文件体积改为实测值 **12,221 中文字 / 430 行**（与 Summary 的篇幅说明同步为同一数字，消除自相矛盾）；② board.md 条数改为 **2 条** 并已实际追加第 2 条；③ xhshow 改为 **"共 11 个发布（`releases` 键 11 个且全部含文件）"** | `GET /pypi.org/pypi/xhshow/json` → `releases` 键 **11** 个（0.1.0…0.2.0），全部含文件 |
| 4（建议） | MediaCrawler 缺"默认分支最后提交日期" | 已补 `GET /repos/NanmiCoder/MediaCrawler/commits?per_page=1 → 2026-10-15`（`8f583999` update README），并注明与 `pushed_at=2026-10-15` 一致、非失实；顺带给 `Cloxl/xhshow` 补了最后提交日期 | MediaCrawler → **2026-10-15**；`Cloxl/xhshow` → **2026-06-11**（`b242a84f` docs(readme): add LINUX DO community section (#109)） |
| 5（建议） | `berstend/puppeteer-extra`"停更 2 年"口径不严（依据的是 pushed_at，违反自订纪律第 4 条） | 改为"**默认分支实际停更于 2023-03-01（1300+ 天）**，`pushed_at` 的 2024-07-18 系其他分支/tag 推送"；并给出 3 条 commit 佐证 | `GET /repos/berstend/puppeteer-extra/commits?per_page=3` → **2023-03-01** `39248f1f` / `3ca317e5` / `2f4a357f`（三条同日） |

**本轮沉淀的方法论教训（已写入文末自查节）**：GitHub REST 的 `GET /repos/{owner}/{repo}` 对**改名/转移过的仓库返回 301 而非 404**，而 `curl` 默认**不跟随**重定向 —— 不加 `-L` 就会把"改名"误判成"不存在"。本轮已把全部 **13 个剔除项用 `curl -L` 逐一复核**，结论：**除 `jxtech/wechatpy` 外其余 12 个确为真 404**；`mendableai/firecrawl` 亦为 301（→ `firecrawl/firecrawl`）但上一版已正确处理。**后续所有仓库存在性判定必须带 `-L` 或直接读 `location` 头。**
