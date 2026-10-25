# mulpub 可参考开源项目全景调研报告

> **调研对象**：`Colinchui007/mulpub`（多平台内容发布桌面应用，pnpm monorepo，14444 个 tree 条目，326 MB）
> **调研范围**：市面上可应用到 mulpub 的开源项目，按 mulpub 的**实际能力地图**分五个维度扫描
> **调研方式**：5 条独立调研轨道并行取证 + 逐条对抗性复核 + 负责人独立交叉核查
> **快照时间**：2026-10-23（star 数与活跃度均为该日实测值）
> **报告定位**：给项目负责人做**引入 / 借鉴 / 对照 / 劝退**的决策依据

---

## 0. 决策摘要

> 只读这十条也能拿到核心判断。

**① 不要整体引入任何第三方平台——这是本报告最重要的结论。**
mulpub 的采集风控层（限流/熔断/冷却池/健康检查/行为模拟/身份绑定）、商业化闭环（三档权益矩阵 + RSA 签名权益令牌 + 微信 Native 支付 + 事务性发件箱 + PostgreSQL）、视频渲染管线（Remotion 7 场景 22 组件）、改写与知识库（16 个模块含知识自演化）**都已经自研且相当成熟**。所有"整体替换型"方案（Medusa / Saleor / Vendure / ERPNext / Appsmith / NocoBase / Directus / ToolJet / Budibase）全部劝退，理由是架构侵入性与体量，**不是协议**（协议排除的是另一批，见 ⑤）。真正值得引入的只有三类：**小而专的可直接替换的库**、**可借鉴的数据模型或幂等范式**、**可对照评估的同类项目**。

**② 桌面壳不换。** Playwright（无 Rust 绑定）、Remotion（走 CDP 的 Node + Chromium）、`stealth-preload` 反检测（依赖 Electron 专属 Chromium）三处构成硬阻断。换 Tauri/Wails 后 Node sidecar 仍在——运行时省不掉反而多一份，IPC 与浏览器自动化链路要重写。Tauri 值得借鉴的是**更新元数据契约**，不是壳本身。

**③ 三个性价比最高的"直接引入"**（小、协议干净、指向明确）：
- **`@electron/fuses`** —— 官方 fuse 把 ASAR 完整性校验从"运行时自研脚本"前移到"加载前 + 二进制强制"，自研 `check-asar.js` 降级为第二道防线。9 个 fuse 全名已逐文件核实。
- **`rebrowser/rebrowser-patches`** —— 补上 `playwright-extra` / `puppeteer-extra-plugin-stealth` 都不修的 CDP 层泄漏（两者均停在 2023-03-01）。Node 与 Python 两侧都有官方 drop-in。
- **OpenMeter 的 meter / grant / ledger 三件套数据模型** —— 见 ④，这是积分体系的关键。

**④ 积分体系最大的缺口不是算法，是"口径"。**
`plan-matrix.js` 的 `officialCreditMonthly`（free=30 / standard=1600）是**固定额度，与模型单价零映射**——积分"怎么发"已经设计好了，但"凭什么发这个数"没有数据支撑。OpenTelemetry GenAI 语义约定已把 `prompt_tokens` / `completion_tokens` 标记为 deprecated，并明确 **usage counter 才是成本口径，per-operation 直方图不得用于成本计算**。同时 OpenMeter 的 `Price` 结构体给出了**版本化价格 + Namespace 倍率覆盖**的现成范式，LiteLLM 的 296.8 万字节价目表给出了价格表的数据形态。**本次最高优先级。**

**⑤ 协议红线比技术选型更致命——至少 14 个高星项目对闭源商业分发不可用。**
`MediaCrawler`（**NON-COMMERCIAL LEARNING LICENSE 1.1**）、`ChatTTS`（AGPL + 权重 CC BY-NC）、`F5-TTS`（代码 MIT 但**权重 CC-BY-NC**）、`fish-speech`（**年营收 50 万美元门槛 + 禁 Hosted Service**）、`index-tts`（**MAU 1 亿 / 营收 10 亿门槛 + 禁止用于改进其他 AI 模型**）、`lago` / `permify`（AGPL）、`hashicorp/vault`（BSL）、`phoenix`（ELv2）、`Signal-Desktop`（AGPL）、`browserless`（SSPL §13）、`undetected-chromedriver`（GPL）、`firecrawl`（AGPL）、`DrissionPage`（非开源 + 非商业 + **授权可撤销**）。完整清单见 §5。

**⑥ 三个"看起来是开源、其实不是"的坑——star 数高不代表能引入。**
- `DrissionPage` 12535★：**不是开源许可证**，是"源码可见 + 非商业用途"私定授权，且第 8 行明写"违反任意一项条款授权自动失效"——连开发期参考使用都不在授权内。
- `NocoBase` / `Directus`：**非 OSI 开源**（自定义商业协议 / Monospace Sustainable Core License），有规模与采购限制。
- `MediaCrawler` 67735★：**非商用许可**，且它**是纯采集实现，没有任何发布代码**——把它当"多平台发布参考"是本轮最容易犯的错。

**⑦ 平台发布不用再找"整体方案"。** mulpub 已是 API → RPA → 风控三段式（`api-publish-engine/publish/` 35 文件 + `rpa-engine` + `emit-gate` / `risk-signals` / `risk-suspender`）。开源能补的只是**平台协议细节**：`ReaJason/xhs`（小红书 Web 端真发布，含分片上传）、`biliup`（B 站投稿）、`social-auto-upload`（15.7k★，平台覆盖对照基准）。

**⑧ 两个必须自建的缺口（开源补不上）。**
1. **微信 / 支付宝官方 SDK 无 Node / Python 版本** —— 官方 `wechatpay-java` 停更于 2025-04、`alipay-easysdk` 停更于 2023-05 ⇒ **签名 / 验签 / 回调解密必须自建**（约 200 行）。
2. **"按张 / 按秒"这类非 token 维度没有现成的 per-unit 价格模型** —— OpenMeter 的 `llmcost` 只覆盖 token 口径。
（第三个缺口：微博 / 快手 / 贴吧采集侧无合规开源替代，`MediaCrawler` 只能读代码取思路。）

**⑨ 两条需要向外部问的问题，不能自己拍。**
- `camoufox-js` 从 0.11.5（2026-07-27）锁死至今，跨到 0.12.0（07-31）属 **minor 跳变可能不兼容**——上游连发 6 版却没升，是"不敢"不是"忘了"。要放宽 pin 到 `~0.11.5` 并**问上游兼容性**。
- `playwright-extra`（v4.3.6）与 `puppeteer-extra-plugin-stealth`（v2.11.2）**双双停在 2023-03-01**，且只做 JS 注入不修 CDP 泄漏。

**⑩ 记住这个分层结论：「仓库活」≠「有可安装的现代版本」。**
`wechatpy` 仓库 2026-03 仍在提交，但**正式版停在 2020-11-22、PyPI 停在 2021-11-11、v2 只到 alpha26** ⇒ 结论是"没有可 pip install 的现代正式版"，不是"生态已死"。评估任何依赖都要分两层看。

---

## 1. 范围、方法与证据纪律

### 1.1 为什么按"能力地图"切维度，而不是按"技术栈"切

用户问的是"市面所有能应用到项目中的开源项目"。但 mulpub 的技术栈（Electron + Vue + FastAPI + Playwright）几乎覆盖了整个开发生态——**按技术栈切会得到一份毫无决策价值的清单**。所以本轮先从代码里反推出 mulpub 的**真实能力地图**，再按能力点找对标项目。

能力地图的实证来源（全部来自 `GET /repositories/1261397559` 的 tree + blob API 实测）：

| 层 | 关键事实 |
|---|---|
| 桌面壳 | `apps/desktop/electron/` 22 文件（扁平结构）+ 6 个 preload + `ipc-guard-exemptions.json`（IPC 白名单治理）+ `stealth-preload.js`（反检测 preload） |
| 客户端治理 | `check-asar.js` / `check-integrity.js`（ASAR 完整性）+ `sidecar-lock.json` / `media-tools-lock.json`（版本锁定）+ `THIRD-PARTY-NOTICES.md` + `licenses/` |
| 采集 | `collection-engine/src/` 已有**自研风控层**：rate-limiter / circuit-breaker / cool-down-pool / health-monitor / content-cache / audit-logger / behavior-simulator / identity-binder / collection-strategy；6 个 platform-adapters |
| 发布 | `api-publish-engine/src/`：publish(35) / auth(28) / adapters(21) / cloud-accounts(8) / signer(5) / upload/providers(4)；`rpa-engine` 选择器 + 签名 + 直连桥接 |
| 改写 | `rewrite-engine/src/` 16 个模块，含 `knowledge-evolution` / `knowledge-context-builder` / `rewrite-quality-evaluator` / `sensitive-filter` / `strategy-manager` |
| 视频 | `remotion-composer` 7 场景 22 组件 + `media-profiles` + `props-validator`；`story2video-engine` 字幕断句/对齐/素材库；`video-clone-engine` similarity / clone-report / replication-level |
| 商业化 | `api-publish-engine/src/auth/`：`plan-matrix.js`（三档 free/standard/pro + 年付 + PLAN_RANK + overrides）、`entitlement.js`（RSA-SHA256 权益令牌 + device_id 绑定）、`payment-schema.js`（微信 Native 支付）、`payment-event-outbox.js`（事务性发件箱）、`postgres-*`（PostgreSQL） |
| 运营后台 | `ops-center/backend/models.py` 40 张表，含 `ModelUsageDaily` / `ModelUsageBatch`（用量计量）、`PromptEvalCase/Run/ProviderKey/Scene`（评测体系）、`FeatureFlag` / `RuntimeConfigVersion` / `ClientDegradationEvent` |
| 认证 | 桌面端 `@logto/client` + `logto-auth/jwks/runtime/webhook`；`entitlement.js` 自签权益令牌 |

**这个能力地图直接决定了结论形态**：绝大多数维度**不是空白**，所以问题不是"引入什么框架"，而是"**在已有实现上补哪一块**"。

### 1.2 五条调研轨道

| 轨道 | 维度 | 候选数 | 交付体量 |
|---|---|---|---|
| A | 桌面应用壳、分发与客户端安全 | 10 | 65.6 KB |
| B | 浏览器自动化、反检测与内容采集 | 12 | 94.9 KB |
| C | AI 编排层、模型网关、评测与认证授权 | 12 | 75.2 KB |
| D | 视频 / 音频生产链与多平台发布 | 12 | 72.1 KB |
| E | 运营后台、会员计费、积分与用量计量 | 13 | 112.4 KB |
| — | **合计** | **59** | **420.2 KB** |

每个候选固定给出四类端点的原始实测值 + 关键文件行数 + 代码内容 + 引入成本 + 风险 + 建议 + 置信度。

### 1.3 取证纪律（13 条，已内化到每一次判定）

1. 所有数字来自 `api.github.com` 实测；**不引用镜像站**（github.es / gitgub.com / git.tdem.in）、**不引用 AI 营销站**、**不凭记忆写 star 数**。
2. 任何仓库先打一次 `GET /repos/{owner}/{repo}`；404 = 不存在或已改名，直接剔除并记录。
3. `default_branch` 未必是 main/master；code search 索引的是 default_branch，不是 master。
4. **活跃度只能用默认分支最后提交判定**——`pushed_at` 统计所有分支/tag 的推送，会虚高。
5. 许可证以 `GET /repos/{o}/{r}/license` **正文**为准；metadata 的 `spdx_id` 与 README 声明都可能与正文不一致。
6. 判断"是否真支持某能力"**不用 `search/code`**（0 hits 可能是未建索引的假阴性），改用 `git/trees/{default_branch}?recursive=1` 看结构 + `contents/{path}` 读内容。
7. 警惕「宣称 ≠ 实现」：看关键文件实际行数与实现的方法数。
8. 警惕「公开仓只是编排层」：有 `@HttpExchange` / `@FeignClient` 转发但无对应 `@RequestMapping` 提供 ⇒ 执行层在别处。
9. 私有 / 受限仓库走 `GET /user/repos` + 数字 id（`GET /repositories/{id}`）。
10. code search 限流 30 次/分，调用间隔 sleep 2~3 秒。
11. **查不到就写「未取证」**，宁可少写一个候选，不可写错一个。
12. 每个候选至少 2 条独立 API 证据。
13. **包名 ≠ 仓库名**（见 §8.1）；**301 别名 ≠ 404**（见 §8.2）。

### 1.4 本报告的已知局限（请连同结论一起读）

- **静态取证为主**：没有运行任何一个项目，所有"引入成本低/中/高"是基于依赖面与架构侵入性的推断，不是实测。
- **star 数是 2026-10-23 快照**，复核方抽查时已有 1 星漂移，属正常。
- **未做运行时验证**：性能、兼容性、真实中文效果均未实测（尤其 TTS 中文质量、whisperX 对齐模型体积）。
- **沙箱网络限制**：部分外网资源（npm registry 之外的 CDN、模型下载站）不可达，个别文件大小未独立核实。
- **mulpub 现状描述来自代码级实证**，但复核方明确指出"决策前应以实际 `models.py` 与运行时行为为准"——本报告的 mulpub 现状描述是**代码级**而非**运行时**的。

---

## 2. 全局能力对标总表

> 合并五个轨道的维度小结。这是全报告的骨架——**每行的"首选推荐"都可回溯到 §3 对应小节**。

### 2.1 桌面壳 / 分发 / 客户端安全

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| 桌面壳 | Electron 自研壳 22 文件 + 6 preload + `src/` 1030 文件 | **不换壳，保留 Electron** | Tauri 2.x（仅对照） | 不换。Playwright / Remotion / stealth-preload 三处硬阻断 |
| 运行时加固 / ASAR 完整性 | 自研 `check-asar.js` + `check-integrity.js` | **`electron/fuses`（`@electron/fuses`）** | Signal-Desktop 的 fuse 组合 | **直接引入**：官方 fuse 把校验前移且二进制强制，自研降级为第二道防线 |
| macOS 公证 | 未取证 | **`electron/notarize`** | electron/forge | 直接引入：`afterSign` 钩子约 10 行接入现有 electron-builder |
| Windows 代码签名 | 未取证 | electron/forge maker 矩阵 + VS Code 签名服务范式 | — | 借鉴实现：签名凭据不进 CI，走独立签名机 |
| 敏感数据本地存储 | 未取证（`auth-preload` / `auth-qrcode-preload` 涉及凭据） | **`Brooooooklyn/keyring-node`（`@napi-rs/keyring`）** | Electron 内置 `safeStorage` | 直接引入 keyring；`safeStorage` 在 Linux 退化为明文 `basic_text`，不可存 token |
| 崩溃上报 | 未取证 | **Electron 内置 `crashReporter`（Crashpad）** | getsentry/sentry-electron | 直接引入内置版接自建 ECS 端点；自建 Sentry 服务端已转 FSL-1.1，不建议 |
| 自动更新 + 灰度/回滚 | 已用 `electron-updater` | **继续用 electron-updater（generic provider + 阿里云 OSS）** | tauri-apps/plugins-workspace 的 updater 契约 | 借鉴实现：照搬"服务端决定推哪个版本" + 更新包签名校验 |
| 跨平台打包分发 | 已用 `electron-builder` | electron-builder 现状 + 官方 notarize | AppImage/appimagetool、winget-cli | 借鉴实现：macOS 公证、AppImage 工具链、MSIX 路线 |
| 应用骨架 / 脚手架 | 自研 | electron-vite 家族 | electron/forge template | 仅供对照：现有规模已超任何模板，只取构建管线（3 目标 + bytecode） |

### 2.2 浏览器自动化 / 反检测 / 内容采集

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| **CDP 层泄漏修补** | stealth 插件停在 2023-03-01，只做 JS 注入不修 CDP 泄漏 | **`rebrowser/rebrowser-patches`（MIT）** | nodriver（AGPL，仅借鉴） | **直接引入**：Node/Python 两侧都有官方 drop-in，**本维度投入产出比最高** |
| **TLS / JA3 指纹伪装** | axios / httpx **都不做 TLS 指纹模拟** | **`lexiforest/curl_cffi`（MIT）** | Scrapling（内部已封装 curl_cffi） | 直接引入：纯 Python 单包，不碰现有调用面，可在"平台 API 直连"路径灰度 |
| 引擎级指纹伪装 | `@askjo/camofox-browser` 自 2026-08-02 锁 `camoufox-js@0.11.5` 至今 | `daijro/camoufox`（MPL-2.0） | — | **对冲而非硬升**：放宽 pin 为 `~0.11.5` + 问上游；过渡期用 `identity-binder.js` 保证指纹自洽 |
| 选择器自愈 / 改版容错 | `platform-selectors.js` 静态硬编码，改版即断 | `D4Vinci/Scrapling`（BSD-3） | — | 借鉴实现：移植其相似度重定位算法到 JS，落到选择器旁路 |
| 微博 / 快手 / 贴吧 采集 | 采集侧只有 6 个 adapter（发布侧有） | **无合规开源替代** | MediaCrawler（非商用，仅读思路） | **明确缺口，只能自研** |
| 公众号整号历史 + RSS + 代理反风控 | `wechatmp` adapter 存在，但无整号翻页 / RSS / 代理池 | `rachelos/we-mp-rss`（LICENSE 正文 MIT） | wechat-download-api（AGPL） | 作为**独立服务**引入，不并入桌面端；输出走 RSS 交给 feedparser |
| RSS / Atom 解析 | 无 | **`kurtmckee/feedparser`（BSD-2, Python）** | `@rowanmanning/feed-parser`（MIT, JS） | 直接引入：与 we-mp-rss 组合，可吃知乎/B站/微博的 RSS 镜像 |
| 通用网页正文抽取 | 无专门方案，直接取 DOM | **`adbar/trafilatura`（Apache-2.0）** | `@mozilla/readability`（JS） | 直接引入（Python 侧）+ JS 侧用 readability 补 |
| 账号会话池 / 代理轮换 | 有账号维度冷却，**缺 IP 维度代理池** | crawlee 的 `SessionPool` + `ProxyRotator` 范式 | `jhao104/proxy_pool`（MIT） | 借鉴实现（Crawlee）+ 直接引入（proxy_pool 作独立 API 服务） |
| 无 GUI 远程浏览器 | 桌面端自带 Electron，采集本地跑 | `steel-dev/steel-browser`（Apache-2.0） | browserless（SSPL，劝退） | 暂不自建；未来拆 `api-publish-engine` 为云服务时再评估 |

### 2.3 AI 编排 / 模型网关 / 评测 / 认证

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| 模型网关 / 路由 / 降级 | 自研 `ai-router` + `OfficialKey` / `ModelPreset` | **借鉴 `maximhq/bifrost` 的 `failure_class` 分类与 retry/fallback 分层** | litellm | 不整体引入网关；**在自研 ai-router 里移植 Bifrost 的错误分类表**（quota / credential / model_access / rate_limit / transient / caller_fault）即覆盖"余额不足自动降级" |
| **模型成本核算** | `ModelUsageDaily` / `ModelUsageBatch` | **借鉴 `pydantic/pydantic-ai` 的 `_genai_prices.py` 计价范式** | litellm 价目表（296.8 万字节） | 在 ops-center 加 `ModelPrice` 维表（输入/输出/缓存/推理 四类单价），**替换目前写死的 27.1% 成本占比** |
| **积分换算 / 亏本防护** | 官方注释「成本占比 27.1%」 | **`open-telemetry/semantic-conventions-genai` 的 token 计量语义约定** | langfuse 的 `Price` / `PricingTier` | **本次最高优先级**：现有 `prompt_tokens`/`completion_tokens` 已被 OTel 标记 deprecated；OTel 明确「usage counter 才是成本口径」 |
| LLM 编排抽象 | 自研 ai-writer / rewrite-engine（16 模块） | `pydantic/pydantic-ai`（局部借鉴，MIT） | — | 不建议整体替换；`FallbackModel` / `_genai_prices.py` / `pydantic_evals` 三块可单点借鉴 |
| 结构化输出约束 | `rewrite-paragraph-preserve` 质量门禁 | **`567-labs/instructor`（直接引入）** | pydantic-ai 的 `output.py` | 可小而专地直接引入：`Mode` 20+ 种 + `llm_validator`；⚠️ `Mode.TOOLS_STRICT` 对国内 provider 兼容性未取证，须先走 JSON_SCHEMA 模式 |
| 提示词管理 / 版本化 | `PromptEvalCase/Run/Scene/ProviderKey` | **借鉴 `langfuse/langfuse` 的 `model Prompt` 表结构** | promptfoo 断言体系 | 抄数据模型：`name+version` 唯一键 + `labels`(production/latest) + `tags` + `commitMessage` + `type` |
| 提示词评测 / A-B | `PromptEvalRun` 只有结果，无断言库 | **`promptfoo/promptfoo`（直接引入，Node 侧）** | pydantic-evals（Python 侧） | 60 个断言文件含 `cost` / `similar` / `factuality` / `trajectory`，可接进现有 vitest CI |
| 可观测与成本追踪 | `ModelUsageDaily` / `DiagnosticsDaily` | **OTel GenAI 语义约定（规范，非库）** | openlit | 先对齐字段命名与口径，不必上 APM |
| AI 驱动测试 / 质量门禁 | `ai-autonomous-tester`（54 文件）+ vitest + stryker + playwright | `web-infra-dev/midscene`（借鉴） | browserbase/stagehand（未深查） | 借鉴"自然语言 → Gherkin → 断言"链路，不引入依赖 |
| 认证（桌面端登录） | `@logto/client` + logto-* 系列 | **保留 Logto** | better-auth（含 `packages/electron`） | 保留现状；Logto 是 MPL-2.0 作独立服务无传染性，配套齐全（phrases / connectors / experience） |
| 后台 RBAC + 资源级权限 | `plan-matrix.js`（PLAN_RANK 不可被运营改）+ `ACCESS-CONTROL-MATRIX.md` | **`apache/casbin` + `apache/casbin-pycasbin`** / `openfga/openfga` | opa | 只抄模型与策略分离的建模；casbin-pycasbin 与 FastAPI 同栈可直接引入 |

### 2.4 视频 / 音频生产链与多平台发布

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|
| 视频合成引擎 | `remotion-composer` 7 场景 + 22 组件 + `media-profiles.ts` | **不换** | MoviePy | 不换引擎，仅借鉴 MoviePy 的 ffmpeg 编排范式 |
| 字幕断句 | `subtitle-rules.json`（双实现单源）+ `subtitle-phrase-boundary.ts` + `subtitle-unit-guard.ts` | **不换**（设计已优于通用开源） | VideoLingo 语义切点 | 借鉴：LLM 语义切点 + 连接词切分，补齐"按句法而非按标点" |
| **字幕时间轴对齐** | `subtitle-aligner.ts`（词级 + Levenshtein 窗口 + fail-open）+ `audio-aligner/core.py`（faster-whisper + silencedetect 吸附） | **`m-bain/whisperX`** | stable-ts（**已归档**） | **唯一实质缺口**：Whisper 自身中文词级时间戳不准；whisperX 用 wav2vec2 强制对齐（zh 模型在默认表内） |
| 相似度 / 复刻度 | `similarity.js`（结构 0.35 / 文案 0.25 / 风格 0.25 / 时长 0.15，DTW + IoU，L0/L1/L2 阈值 + 证据门控） | **不换**（时间轴级度量，与开源不同轴） | `idealo/imagededup` | imagededup 补的是**画面/素材感知相似**这一维，是补充不是替换 |
| 素材库 / 模板库治理 | `template-library.ts`（7 内置）+ `bgm-library.ts`（10 条 Pixabay CDN，注释标 CC0/CC-BY） | MoneyPrinterTurbo `material.py` 作对照 | PySceneDetect 的许可台账范式 | 缺口：模板/BGM **缺许可字段与版本锁定**（BGM 是可变 CDN URL，无 sha256） |
| **画幅自适应 / 封面** | `_base/aspect-ratio.js`（225 行）+ `cover-cropper.js`（`fit:'cover', position:'centre'`） | **`jwagner/smartcrop.js`** | PySceneDetect（选帧） | 缺口明确：`position:'centre'` 会切掉主体 → 内容感知裁切是可直接替换的小而专的库 |
| 中文 TTS | **已有且成熟**（6 家云端供应商适配器 + `tts-voice-clone-service.js` **1783 行**音色克隆） | **不换云端**；补自托管/离线降级 | kokoro（Apache-2.0 代码+权重，82M）/ CosyVoice（Apache-2.0 代码，权重未取证） | 缺口不是"没有 TTS"，而是：① 无本地/离线降级（云端故障即断链）② 云端按量计费与并发上限 ③ **权重/音色资产无许可台账** |
| AI 视频生成 | 已有 comfyui 等供应商适配器 | 官方 API（火山引擎方舟 Seedance） | ComfyUI + WanVideoWrapper | 优先官方 API；**ComfyUI 是 GPL-3.0，不链接、只作外部服务调用** |
| 多平台发布 | publish(35) + rpa-engine + wechat_publisher，已三段式 | `social-auto-upload`（对照）+ `ReaJason/xhs`（API 参考） | `biliup` | 现状已是三段式；开源能补的是**平台协议细节**，不是架构 |
| 媒体工具链治理 | 已有 `sidecar-lock.json` / `media-tools-lock.json` / `licenses/` | **mulpub 领先** | — | 对照项目多数没有等价实现，可反向输出 |

### 2.5 运营后台 / 会员计费 / 积分 / 用量计量

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| 用量计量（token/秒/张/次数） | `ModelUsageDaily`/`Batch` 落 PostgreSQL，**无统一 meter 定义** | **`openmeterio/openmeter`（Apache-2.0）** 的 `openmeter/meter`（`ValueProperty`+`GroupBy` 四种口径同机制） | lago `events-processor` | 借鉴 meter 定义模型 + grant 烧耗顺序，**不引入服务** |
| 积分账户 / 余额 / 发放 | `officialCreditMonthly` 由权益令牌下发，**无可查询的积分账户表，无 grant 概念** | OpenMeter `openmeter/credit/`（grant/balance/burnphase） | lago `wallet.rb` | **自建 grant 表**，烧耗顺序直接抄 OpenMeter 三级排序 |
| **积分换算必须挂模型成本** | `officialCreditMonthly` 是**固定额度，与模型单价无任何映射** | OpenMeter `openmeter/llmcost/llmcost.go` 的 `Price`（**版本化价格 + Namespace 倍率覆盖**）+ `models.dev/api.json` 公开价格源 | opencost `pkg/inferencecost/types.go`；LiteLLM 价目表 | **自建 `Price` 版本化价格表**（EffectiveFrom/To + namespace 覆盖），`ModelUsageBatch` 落 `price_id` 而非只落 `model_name`；**缺口需自建** |
| 余额不足自动切模型 | `modelTier` 0/1 + `ModelPreset`/`OfficialKey` 已有降级位 | **litellm `router_strategy/budget_limiter.py`**（部署级预算过滤 + 路由策略组合） | OpenMeter grant 优先级 | 借鉴"预算过滤是路由策略之一"的设计，**别把切模型写成 if-else** |
| 成本对账 / 账本 | **无账本**，只有 `ModelUsageDaily` 汇总表 | OpenMeter `openmeter/ledger/README.md`（不可变分录账本，account kinds 含 `wash`/`breakage`） | Kill Bill `invoice_payments` | 借鉴账户种类划分，**账本必须自建** |
| 会员订阅生命周期 / 续费 | `subscription-service.js` + `identity_payment_customers` 映射表 | `killbill/killbill`（Apache-2.0）`subscription/ddl.sql` | lago `plan.rb` / `subscription.rb` | 借鉴 `charged_through_date` + 事件溯源表；**不引入 Java 栈** |
| 支付幂等 / 查单 / 对账 | `payment-event-outbox.js`（事务性发件箱） | **`wechatpay-apiv3/wechatpay-skills`（官方 MIT 规则原文）** | Kill Bill `payment_transactions` | **直接按官方查单节奏实现**（5s/30s/1m/3m/5m/10m/30m）；⚠️ 现有 outbox 只保证事件发出、**不保证订单状态收敛** |
| 官方支付 SDK | 自研 `payment-schema.js`（微信 Native） | 官方 wechatpay 全家桶（**已停更**）/ `binarywang/WxJava`（2026-10 仍活跃，Apache-2.0）/ better-wechatpay | — | 官方无 Node/Python SDK ⇒ **签名/验签/回调解密必须自建**（约 200 行） |
| 兑换码 / 礼品卡 | `RedemptionCode` 表 + `publish-api-redeem-code-admin.js` | **`saleor/saleor` 的 `Voucher`+`VoucherCode`+`VoucherCustomer` 三表模型** | — | 借鉴三表拆分 + `used` 计数器 + 一人一券；**核销事务自建** |
| LLM 成本观测（自建） | 无独立观测面 | **langfuse 核心 MIT 可自建已验证**（`isEeAvailable` 机制实测） | opencost inferencecost | 成本看板可自建；但**阈值告警与 PG 导出在 EE** ⇒ 告警/对账出库须自写；**6 个服务，部署代价高** |
| RBAC / 资源归属 | `AdminUser` + `ACCESS-CONTROL-MATRIX.md` | **`apache/casbin` + `apache/casbin-pycasbin`** | openfga/openfga | 直接引入 casbin-pycasbin |
| 运营后台底座 | 自研（FastAPI + Vue + Element Plus + PostgreSQL） | `pure-admin/vue-pure-admin`（同栈模板） | — | **只借鉴不替换** |

---

## 3. 五个维度分述

> 每节结构：现状 → 候选 → **关键取舍**（为什么首选 A 不选 B/C）→ 落地建议。
> 候选的完整证据（四类端点实测值 + 关键文件行数）见附录索引对应的轨道交付物。

### 3.1 轨道 A｜桌面应用壳、分发与客户端安全

**现状**：Electron 自研壳已相当完整——`bootstrap.js` / `window.js` / `shutdown.js` / `startup-compat.js` + 6 个 preload + `ipc-guard-exemptions.json`（IPC 白名单治理）+ `stealth-preload.js`（反检测 preload）。客户端治理已有 `check-asar.js` / `check-integrity.js`（ASAR 完整性）、`sidecar-lock.json` / `media-tools-lock.json`（sidecar 与媒体工具版本锁定）、`THIRD-PARTY-NOTICES.md` + `licenses/`（第三方许可清单）。

**关键取舍：为什么不换壳。**
- Playwright **没有官方 Rust 绑定**——Tauri 下浏览器自动化要么换语言栈，要么继续养 Node sidecar。
- Remotion 走 **CDP 驱动的 Node + Chromium**，换壳后仍需 Node 运行时。
- `stealth-preload` 反检测依赖 **Electron 专属的 Chromium 补丁**，Tauri 用系统 WebView 则整个反检测方案失效。
⇒ 结论：**换壳后 Node sidecar 仍在，安装体积与内存占用不降反升（多一个运行时），同时要重写 IPC、安全校验、浏览器自动化链路。** Tauri/Wails/Neutralino 全部不推荐。

**候选与取舍**：
- **`electron/fuses`**（55★，MIT，官方组织）——首选而非 Signal-Desktop，是因为 **fuse 是 Electron 官方的一等概念**：`electron/forge` 的 `packages/plugin/fuses/src/FusesPlugin.ts`（实测 66 行）证明它已是打包系统的一等公民，而非某项目的私有 hack。9 个 fuse 的全名已从 `src/config.ts` 逐文件提取核实：`RunAsNode` / `EnableCookieEncryption` / `EnableNodeOptionsEnvironmentVariable` / `EnableNodeCliInspectArguments` / **`EnableEmbeddedAsarIntegrityValidation`** / **`OnlyLoadAppFromAsar`** / `LoadBrowserProcessSpecificV8Snapshot` / `GrantFileProtocolExtraPrivileges` / `WasmTrapHandlers`。后两个正是 mulpub 自研 `check-asar.js` 的能力，但**由二进制在加载前强制，运行时脚本绕不过**。
  - ⚠️ **Apple Silicon 坑**：arm64 包翻 fuse 必须传 `resetAdHocDarwinSignature: true`，否则签名失效、**app 拒绝启动**。
  - ⚠️ **Linux 不开**：Signal 的 `scripts/fuse-electron.mjs`（实测 55 行）里 `EnableEmbeddedAsarIntegrityValidation` 是 `darwin\|\|mas\|\|win32`，**Linux 明确不开**——mulpub 的 `check-asar.js` 在 Linux 需单独评估。
  - ⚠️ fuse wire 是**位置相关**格式，Electron 大版本增删 fuse 需回归验证（`strictlyRequireAllFuses: true` 即为此设计）。
- **`Signal-Desktop`**（16608★，**AGPL-3.0**）——只借鉴不抄代码。价值在于 `scripts/after-pack.mjs`（21 行）+ `scripts/after-sign.mjs`（18 行，注释写明 "This must be the last step"）这套**最小可用编排范式**，以及"加固前先问 Signal 做了吗"的对照基线。**协议高风险已标注。**
  - 值得注意：**mulpub 的 sidecar 版本锁定与许可清单在这点上领先于 Signal**——Signal 公开仓中未见等价实现。
- **`@electron/notarize`**（193★，MIT）——macOS 公证是 mulpub 明确缺的一环。未公证的包首次打开被 Gatekeeper 拦截（需右键打开或 `xattr -d com.apple.quarantine`），**对"国内用户 + 大量非技术用户"是直接的转化率损耗**。
  - ⚠️ 实质成本是**基础设施缺口不是代码缺口**：公证必须在 macOS 机器执行（需 Xcode 13+ 的 `xcrun notarytool`），CI 要一台 macOS runner；且需要付费 Apple Developer 账号——**证书是外部采购依赖，开源实现补不上**。
  - 顺序不可反：打包 → flip fuses（带 `resetAdHocDarwinSignature`）→ codesign → **验签**（`src/check-signature.ts` 先验签再公证）→ notarize → staple。
- **`@napi-rs/keyring`**（仓库 `Brooooooklyn/keyring-node`，MIT）——**选它而不是 Electron 内置 `safeStorage`，因为 `safeStorage` 在 Linux 会退化为明文 `basic_text`**（官方文档自述），不可用于存 token。keyring 预编译、Linux 走 secret-service。
  - ⚠️ 落地分层：refresh token / 长效凭据 → keyring（Linux 用 `store:'secret-service'` + 失败降级到 `safeStorage` 并在设置页提示）；非敏感偏好 → 继续走现有配置存储，**不要滥用钥匙串**。
- **崩溃上报**——首选 Electron 内置 `crashReporter`（Crashpad）接自建 ECS 端点，**不建议自建 Sentry 服务端**。
  - ⚠️ 这里有个常见误读需要澄清：`getsentry/sentry` 协议确实是 **FSL 1.1（Functional Source License, Version 1.1, Apache 2.0 Future）**——但**`getsentry/sentry-electron` 是纯 MIT**。FSL 允许商业使用与生产部署，禁止的是"作为竞品托管服务"，并承诺两年内转 Apache-2.0。mulpub 不自建 Sentry 服务端，所以**协议影响很小**；把结论写成"Sentry 有协议风险"是不准确的。
- **自动更新**——继续用 `electron-updater` 的 generic provider 指向阿里云 OSS 静态托管。**借鉴 Tauri updater 的"服务端决定推哪个版本"语义 + 更新包签名校验**，补上 electron-updater 缺的那一环。`ArekSredzki/electron-release-server` 的 `Channel` / `Flavor` / `Version` / `Asset` 四层数据模型值得抄，但**该仓默认分支已停更**，建议按四层结构在 ECS 上自己写一个更小的服务。

**落地建议**：① 引入 `@electron/fuses`（`afterPack` 钩子，保留自研校验做第二道防线）→ ② 引入 `@napi-rs/keyring` 并分层迁移凭据 → ③ 引入 `@electron/notarize`（需先备 macOS runner）→ ④ 引入内置 `crashReporter`（`uploadToServer` 默认 false + 启动时征求同意）→ ⑤ 借鉴 Tauri 契约自建灰度/回滚元数据。

### 3.2 轨道 B｜浏览器自动化、反检测与内容采集

**现状**：`collection-engine` 已有完整自研风控层（限流 / 熔断 / 冷却池 / 健康检查 / 内容缓存 / 审计日志 / 行为模拟 / 身份绑定 / 采集策略）+ 6 个平台 adapter；`rpa-engine` 有静态选择器 + 发布签名 + 头条直连桥接；`api-publish-engine` 有 21 个 adapter + 35 个 publish 模块。

**关键取舍：本维度的四个"直接引入"，都指向 mulpub 现有的**空档**而不是替换。**
- **`rebrowser/rebrowser-patches`（MIT）是本维度投入产出比最高的一项**——因为 `playwright-extra`（v4.3.6）与 `puppeteer-extra-plugin-stealth`（v2.11.2）**双双停在 2023-03-01，且只做 JS 注入不修 CDP 层泄漏**（`Runtime.Enable` / `navigator.webdriver` / 栈名泄漏）。rebrowser 提供了 Node 与 Python 两侧的官方 drop-in（`rebrowser-playwright` 1.64.101）。
- **`curl_cffi`（MIT）补的是一个真实存在的能力空洞**：`collection-engine` 用 axios（Node）、`python-backend` 用 httpx，**两者都不做 TLS 指纹模拟**，JA3 与真实浏览器不一致。curl_cffi 是纯 Python 单包，**不碰现有 axios/httpx 调用面**，可只在"平台 API 直连"路径灰度接入。
- **选择器自愈借鉴 Scrapling（BSD-3）而非直接引入**——Scrapling 是 Python 的，mulpub 的 `platform-selectors.js` 是 JS，引入等于引入一个 Python 运行时依赖；借鉴其"相似度重定位"算法移植成 JS 更划算。
- **代理池直接引入 `jhao104/proxy_pool`（MIT）作为独立 API 服务**——因为 mulpub 现有的是**账号维度**冷却（`cool-down-pool.js` / `identity-binder.js`），**缺 IP 维度**。

**两个"看起来该引入、其实不能"的关键判定**：
- **MediaCrawler 不是发布参考。** 实测其 tree 355 个 blob，按 `publish|upload|发布|投稿` 正则匹配 **0 命中**，README 全文 grep 同样 **0 命中**——它是**纯采集实现**（下载 / 搜索 / 评论）。更关键的是它的 LICENSE 正文是 **NON-COMMERCIAL LEARNING LICENSE 1.1**，**法务上直接不可用**。
  - 附带一个有价值的发现：MediaCrawler 的小红书签名**零自有算法**——`media_platform/xhs/playwright_sign.py`（实测 72 行）第 51-65 行直接 `from xhshow import Xhshow` 调 `sign_headers_get/post`；`xhs_sign.py`（152 行）只有 `mrc()`（CRC32 变体）+ 自定义 Base64 + `get_trace_id()`。**而 mulpub 已经在用同一个 MIT 上游 `Cloxl/xhshow`**，所以这个候选在签名维度对 mulpub **无增量**，只能读它的平台适配结构（微博/快手/贴吧/知乎）。**mulpub 应直接调 xhshow 的 `CRC32.crc32_js_int()`。**
  - 行动项：确认 mulpub 锁定的 xhshow **≥ 0.2.0**（0.2.0 于 2026-06-11 发布，原生修复 GET 请求 `a3_hash` bug）。
- **DrissionPage 不是开源项目。** 12535★，LICENSE 全文 49 行已逐行读取：第 1-2 行 `Copyright (c) 2020, g1879` / `All rights reserved.`；第 4 行"允许任何人以个人身份使用或分发本项目源代码，但仅限于学习和合法非盈利目的"；第 8 行"违反任意一项条款的情形，授权**自动失效**"。它**不满足 OSI 自由要件 1/3/6**（不可撤销性），既非 copyleft 也非 permissive 也不是 CC BY-NC 标准化条款。**结论比"禁商用"更严：开发期参考使用亦不在授权内。**
- **browserless 不能自建远程浏览器服务。** SSPL §13 的触发条件与 "Service Source Code" 定义已用原文核实（§13 起于 `LICENSE-Community.txt` 第 478 行）：一旦对第三方提供该服务，"Service Source Code" 的定义把 `all programs that you use to make the Program … available as a service` 全部纳入，明文列举 **automation / management / user interfaces / application program interfaces / monitoring / backup / storage / hosting software** ⇒ mulpub 的 `api-publish-engine` / `rpa-engine` / `cloud-accounts` / `upload/providers` **全部落入，闭源不可能满足**。三级场景判定：① 自建远程浏览器服务对第三方提供 ⇒ **必然触发**；② 仅开发机本地运行、不对外提供服务 ⇒ **技术层面不触发**；③ 集成进产物分发 ⇒ 触发常规 copyleft 分发义务。**替代：steel-browser（Apache-2.0）。**

**落地建议**：① 引入 `rebrowser-patches`（两侧 drop-in）→ ② 在"平台 API 直连"路径灰度 `curl_cffi` → ③ 引入 `trafilatura`（Python）+ `@mozilla/readability`（JS）补正文抽取 → ④ 引入 `feedparser` + `we-mp-rss` 独立服务补 RSS 链路 → ⑤ 引入 `proxy_pool` 作独立 API 服务补 IP 维度 → ⑥ 借 Scrapling 相似度重定位算法做选择器自愈旁路 → ⑦ 微博/快手/贴吧采集**自研**（无合规替代）。

### 3.3 轨道 C｜AI 编排层、模型网关、评测与认证授权

**现状**：自研 `ai-router` 仓库 + `OfficialKey` / `ModelPreset` 表；`rewrite-engine` 16 个模块含知识自演化与质量评估；`ai-autonomous-tester` 54 文件（agent / providers / runners / parsers / detectors + `ai-analyzer` + `fix-engine`）；ops-center 已有 `PromptEval*` 四表与 `ModelUsage*` 两表；`plan-matrix.js` 的 PLAN_RANK 不可被运营改。

**关键取舍：本轨道最值得注意的一条是"最高优先级"的指标口径问题。**
- **OTel GenAI 语义约定**把 `prompt_tokens` / `completion_tokens` 标记为 **deprecated**，并明确**五类 token 需独立计价**、且 **"usage counter 才是成本口径，per-operation 直方图不得用于成本计算"**。mulpub 现有的 `ModelUsageDaily` / `ModelUsageBatch` 若直接照现有字段建成本表，**口径本身就是错的**。这是零成本的规范对齐，**优先级高于任何库的引入**。
- **不整体引入 LLM 网关。** mulpub 已有自研 ai-router，引入 LiteLLM / Bifrost 意味着把 Node 侧的路由层换成 Python 侧服务，架构割裂。**正确姿势是移植 Bifrost 的 `failure_class` 错误分类表**（quota / credential / model_access / rate_limit / transient / caller_fault）——这六个类别正好覆盖"余额不足自动降级"的全部触发条件，而分类表本身只有几十行。
- **不整体引入 LangGraph。** 目录树级证据：`libs/langgraph` 176、`libs/cli` **152**、`libs/sdk-py` **147**、三个 checkpoint 持久化后端 35+28+25、conformance 套件 22 ⇒ **409/621（65.9%）是 CLI + SDK + 状态持久化 + 规范套件，真正的图运行时只有 176**。引入 LangGraph ＝ 引入一整套编排平台，而不只是一个 Python 库。
- **不引入 dspy。** 目录树级证据：`dspy/teleprompt/` 共 **28 个文件**（`gepa/` 5 + `reanchor/` 3 + 顶层另有 20 个优化器模块：copro / grpo / mipro / simba / bootstrap / avatar 等）。它的闭环是"标注数据集 → 优化器自动合成 prompt → 评测"，而 mulpub 的 `PromptEvalCase` 是**人工构造的评测集**，量级与用途都撑不起这条闭环，**且会与 `rewrite-engine` 里硬编码的提示词正面冲突**。
- **保留 Logto 是正确决策。** 实测 `logto-io/logto` 14757★、MPL-2.0（文件级 copyleft，作为独立服务部署**无传染性**）、8090 个 blob 拆成 console(2171) / phrases(1861) / core(1039) / experience(618) / connectors(573) / schemas(507) 等——是一套含**多语言文案、连接器（MCP/OAuth）、可编排登录旅程**的完整 IdP，不是玩具。mulpub 已把鉴权链路（`logto-jwks` / `logto-webhook` / `business-identity` / `entitlement` 的 RSA 签名 + `kid`）做得很深，**换 IdP 的迁移成本远大于收益**。

**一个结论级风险必须说清楚**：Instructor 的 `Mode.TOOLS_STRICT` 依赖各家 provider 的 strict tool-calling 支持，**国内 provider（通义/豆包/智谱）的兼容性本轮未取证**（沙箱无 provider 凭证）——**而这正是"直接引入"建议的核心卖点**。落地要求：① 先在 `Mode.JSON_SCHEMA`（不依赖 provider strict 能力）上跑通；② 再单开 `TOOLS_STRICT` 灰度；③ 保留"strict 失败 → 回落宽松模式 + 段落结构校验"双保险（现有 `rewrite-paragraph-preserve` 门禁不撤）；④ 若国内 provider 均不支持 strict，**该建议降级为"借鉴实现"**。

**落地建议**：① 先对齐 OTel GenAI token 计量口径（零成本，最高优先级）→ ② 在 ops-center 加 `ModelPrice` 版本化价格表，替换写死的 27.1% → ③ 移植 Bifrost 错误分类表到 ai-router → ④ 引入 promptfoo 接进 vitest CI（先做 `cost` 断言控评测烧 token）→ ⑤ 引入 instructor（按上面的降级路径）→ ⑥ 抄 langfuse 的 `model Prompt` 表结构补提示词版本化 → ⑦ 引入 casbin-pycasbin 做 RBAC（与 FastAPI 同栈）。

### 3.4 轨道 D｜视频 / 音频生产链与多平台发布

**现状**：`remotion-composer` 7 种场景 22 个组件；`story2video-engine` 的字幕三件套（`subtitle-rules.json` 双实现单源 + `subtitle-phrase-boundary.ts` 成对短语登记 + `subtitle-unit-guard.ts`）；`video-clone-engine` 的多层相似度；`audio-aligner`（Python）faster-whisper 词级时间 + silencedetect 吸附；**6 家云端 TTS 适配器 + `tts-voice-clone-service.js` 1783 行音色克隆**。

**关键取舍：这一维度的"不换"比"换"多，而且理由都很硬。**
- **字幕时间轴对齐是唯一实质缺口**——mulpub 已有 `subtitle-aligner.ts`（词级时间 + Levenshtein 窗口匹配 + fail-open）**和** `audio-aligner/core.py`（faster-whisper 词级 + silencedetect 吸附），两套并行；缺的是 **wav2vec2 强制对齐**（whisperX 方案），因为 Whisper 自身中文词级时间戳不准。`stable-ts` 是备选但**已归档**。
- **相似度不换。** mulpub 的 `similarity.js` 是**时间轴级度量**（结构 0.35 / 文案 0.25 / 风格 0.25 / 时长 0.15，DTW 近似对齐 + IoU，L0/L1/L2 分层阈值 + 证据门控），与开源的**画面/素材感知相似**（`imagededup` 的感知哈希）**不同轴**——`imagededup` 是补充不是替换。
- **中文 TTS 不换云端，但要补离线降级。** 缺口不是"没有 TTS"（那 6 家云端适配器 + 1783 行音色克隆已经很完整），而是：① **无本地/离线 TTS 降级路径——云端故障即整条 Story2Video 断链**；② 云端按量计费与并发上限；③ **权重/音色资产无许可台账**。补法是 kokoro（**代码与权重同为 Apache-2.0**，82M 轻量）作离线降级路径。
- **画幅自适应/封面是最容易摘的低垂果实**：`cover-cropper.js` 用 `sharp fit:'cover', position:'centre'`——**中心裁切会切掉主体**，`smartcrop.js` 是内容感知裁切，可直接替换。
- **素材库的许可缺口**：7 个内置模板 + 10 条 Pixabay CDN 音频，注释标了 CC0/CC-BY，但**BGM 是可变 CDN URL、无 sha256、无许可字段**——这是"哪天链接换了或条款变了"型风险。

**平台发布的对照结论**：`api-publish-engine` 已是 API → RPA → 风控三段式，开源能补的是**平台协议细节**：
- **`ReaJason/xhs`** —— 小红书 Web 端**真发布**实现（含分片上传），mulpub 小红书发布的**最直接参考**。
- **`dreammis/social-auto-upload`**（15732★，MIT，2026-10-22 活跃）—— 描述原文"自动化上传视频到社交媒体：抖音、小红书、视频号、tiktok、youtube、bilibili"，与 mulpub 的发布引擎**正面对标**。价值 = 逐平台找差距（缺的平台 / 缺的发布模式 / 缺的签名），**不是引入对象**。
- **`biliup/biliup`** —— B 站投稿的成熟实现（Rust 核心 + Python 外壳）。
- ⚠️ **ComfyUI 是 GPL-3.0** —— 不链接，只作外部服务调用。

**落地建议**：① 引入 `whisperX` 补中文强制对齐 → ② 引入 `smartcrop.js` 替掉中心裁切 → ③ 引入 kokoro 作离线 TTS 降级 → ④ 引入 `imagededup` 补素材感知相似维度 → ⑤ 借 `PySceneDetect` 的 `_thirdparty/LICENSE-*` 台账范式 + `material.py` 对照，补模板/BGM 的**许可字段与版本锁定** → ⑥ 读 `ReaJason/xhs` / `biliup` / `social-auto-upload` 补平台协议细节 → ⑦ 画幅契约（竖屏成片配横图）保持单一真源，改造时先看 `_base/aspect-ratio.js`。

### 3.5 轨道 E｜运营后台、会员计费、积分与用量计量

**现状（这一轨道的"现状"是本次调研最反直觉的部分）**：mulpub 的商业化**已经落地且相当成熟**——三档会员（free / standard / pro）+ 年付、`PLAN_RANK` 档位序不可被运营 overrides 改（改错会让跨档续叠的降级保护静默失效）、RSA-SHA256 签名的权益令牌（`kid` + `sub` + `device_id` 绑定 + 时钟容差）、微信 Native 支付闭环（`payment-schema.js` 与 `migrations/postgresql/006_payment_orders.sql` 逐字一致 + 漂移锁）、**事务性发件箱**、PostgreSQL 商业化表。实测会员数值：standard ¥59/月、¥499/年，官方注释"成本占比 27.1%（¥59 × 27.1% ≈ ¥16）"，`officialCreditMonthly` free=30 / standard=1600。

**关键取舍：这一维度的结论全部是"借鉴数据模型"，不是"引入服务"。**
- **用量计量 / 积分账户 / 成本对账三个缺口，答案是同一个项目**：`openmeterio/openmeter`（Apache-2.0，2400★，2026-10-22 活跃）。它的 `openmeter/meter`（`ValueProperty` + `GroupBy` ⇒ **token/秒/张/次数四种口径同机制**）、`openmeter/credit/`（grant/balance/burnphase ⇒ **grant 优先级 + 三级烧耗顺序**）、`openmeter/ledger/README.md`（**不可变分录账本**，account kinds 含 `wash` / `breakage`）三块正好覆盖 mulpub 的三个缺口。
  - ⚠️ **但 `llmcost` 只覆盖 token 维度**——`Price` 结构体是 `EffectiveFrom` / `EffectiveTo` 版本化 + `Namespace` 倍率覆盖 + `PriceSource=manual|system`，配 `sync/fetcher_modelsdev.go` 拉 `https://models.dev/api.json` 公开价源。**"按张 / 按秒"没有 per-unit 价格模型，需自建。**
- **"余额不足自动切模型"应该是一个路由策略，不是 if-else。** 借鉴 litellm 的 `router_strategy/budget_limiter.py`：**部署级预算过滤 + 路由策略组合**——把"预算/余额"建模成路由策略的一种，而不是在业务代码里写分支。mulpub 已有 `modelTier` 0/1 与 `ModelPreset` / `OfficialKey` 降级位，缺的是这个策略层的抽象。
- **兑换码抄 saleor 的三表模型**（`Voucher` + `VoucherCode` + `VoucherCustomer`）：三表拆分 + `used` 计数器 + 一人一券，**核销事务自建**。反面基线是 `l4rm4nd/VoucherVault`（GPL + 逐表授权混乱）。
- **支付侧有一个容易被忽略的缺口**：`payment-event-outbox.js` 只保证**事件发出**，**不保证订单状态收敛**。官方 `wechatpay-skills` 仓给出了查单节奏原文（**5s / 30s / 1m / 3m / 5m / 10m / 30m**，或每 30 秒扫最近 10 分钟未支付订单、同一订单查 10 次）、退款原单号原参数重试、三条铁律（金额用整数分 / 每天拉微信账单比对 / 防重复下单）。**按官方节奏实现即可。**
- **LLM 成本观测自建可行但代价高。** langfuse 的 `ee/LICENSE`（约 3 KB）已取全文：**核心是 MIT Expat 可自由商用，`ee/` 目录是自定义商业协议**；`ee/src/ee-license-check/index.ts` 的 `isEeAvailable = NEXT_PUBLIC_LANGFUSE_CLOUD_REGION !== undefined \|\| LANGFUSE_EE_LICENSE_KEY !== undefined` ⇒ **自托管不配 EE 密钥即只跑 MIT 核心**。但实测 129 个 ee 文件中 `usageThresholds`（余额告警）、`meteringDataPostgresExport`（对账出库）、`billing` **均为 EE** ⇒ **Langfuse 只能"看"，不能"告警/出库"**；且它要 6 个服务，部署代价高。
- **整体替换型后台全部劝退**——Appsmith / Budibase（架构侵入）、NocoBase（自定义商业协议）、Directus（MSCL 非开源）、ToolJet（AGPL）、Medusa / Vendure（体量 + 侵入；注意这两个的劝退理由**不是**协议——medusa = MIT 主体 + EE 物料，vendure = GPLv3 社区版 / VCL 商业版双轨）、ERPNext（7269 文件全套 accounts/buying/crm/stock/hr/payroll）。
  - 唯一"因协议而排除"的是：**NocoBase / Directus / ToolJet / Phoenix(ELv2) / Permify(AGPL) / VoucherVault(GPL)**。

**落地建议**：① 对齐 OTel 计量口径 + 建 `ModelPrice` 版本化价格表（**最高优先级**）→ ② 自建 grant 表（抄 OpenMeter 三级烧耗顺序）+ 引入 grant 概念 → ③ 把余额/预算建模成路由策略层 → ④ 按官方查单节奏实现订单状态收敛 → ⑤ 抄 saleor 三表模型做兑换码 → ⑥ 引入 casbin-pycasbin → ⑦ 引入 VictoriaMetrics（单机 ECS 上最轻的指标/告警底座）→ ⑧ LLM 成本看板用 langfuse MIT 核心自建，但**告警与对账出库自己写**。

---

## 4. 引入优先级路线图（Top 10，按 ROI 排序）

> 排序依据：① 是否解除当前的实际风险/亏损点 ② 引入成本（依赖面、架构侵入、基础设施）③ 协议风险 ④ 是否有明确可落地的工程动作。
> 工作量为档位估算（**小**=1~3 人日 / **中**=3~10 人日 / **大**=10 人日+），并给出估算依据。

| 排名 | 项目 | 对应能力点 | 建议动作 | 为什么现在做 | 工作量 | 主要风险 | 前置条件 |
|---|---|---|---|---|---|---|---|
| **1** | **OTel GenAI 语义约定 + OpenMeter `Price` 模型** | 积分换算 / 成本核算 | 先对齐口径，再建 `ModelPrice` 维表 | **这是唯一一处"不解决就会持续亏本"的地方**：`officialCreditMonthly` 是固定额度、与模型单价零映射；而 OTel 已把现有 `prompt_tokens`/`completion_tokens` 标记 deprecated，并明确 usage counter 才是成本口径。口径错了，后面所有成本看板都是错的 | **中**（3~10 人日）<br>依据：OTel 规范对齐 1~2 天 + `ModelPrice` 表 + `ModelUsageBatch` 加 `price_id` 字段 + 回填历史 3~5 天 | ① 现有 `ModelUsageDaily`/`Batch` 的 token 字段若来源不统一，历史数据需标记为不可信 ② 国内模型单价无公开价源，需自维护 | 无（零外部依赖） |
| **2** | `rebrowser/rebrowser-patches` | CDP 层泄漏修补 | **直接引入**（Node + Python 双侧 drop-in） | stealth 双插件停在 2023-03-01 且只做 JS 注入不修 CDP 泄漏；采集/发布的对抗成本直接体现在成功率上 | **小**（1~3 人日）<br>依据：改两个 import + 跑一轮采集回归 | rebrowser 与 stealth 插件可能**互相覆盖同一处注入**，需 A/B 验证 | 先在采集侧灰度，保留回滚开关 |
| **3** | `@electron/fuses`（`electron/fuses`） | ASAR 完整性 / 运行时加固 | **直接引入**（`afterPack` 钩子） | 官方 fuse 把校验从"运行时脚本"前移到"加载前 + 二进制强制"，运行时脚本绕不过；这是防篡改的质变而非增量 | **小**（1~3 人日）<br>依据：加钩子 + 三平台打包验证 | ① fuse wire 位置相关，Electron 大版本增删 fuse 需回归 ② **arm64 翻 fuse 必须传 `resetAdHocDarwinSignature`，否则 app 拒绝启动** ③ Linux 不开（参照 Signal 的 `darwin\|\|mas\|\|win32`） | 保留自研 `check-asar.js` / `check-integrity.js` 作第二道防线 |
| **4** | OpenMeter 的 `meter` / `credit` / `ledger` **数据模型** | 积分账户 / 余额 / 对账账本 | **自建表，抄模型** | mulpub 现有权益令牌下发固定额度，**没有可查询的积分账户表，也没有 grant 概念**——用户余额不可查、不可审计、不可对账。OpenMeter 的 grant/balance/burnphase 正好补这三个缺口 | **中**（3~10 人日）<br>依据：3 张表 + 烧耗排序逻辑 + 与 `entitlement.js` 的对接 | ① 引入 grant 概念意味着权益令牌要从"下发额度"改为"查余额" ② 烧耗顺序错了会导致超发 | 需先定"额度发放"与"消耗"的边界 |
| **5** | `jwagner/smartcrop.js` | 画幅自适应 / 封面 | **直接引入**（替换中心裁切） | `cover-cropper.js` 用 `sharp fit:'cover', position:'centre'`，**中心裁切会切掉主体**——这是用户直接可见的内容质量问题，且与项目已记录的画幅契约痛点同源 | **小**（1~3 人日）<br>依据：换算法 + 跑一遍各平台封面回归 | 内容感知裁切结果不稳定（不同图给不同构图），需与现有 `_base/aspect-ratio.js` 单一真源对齐 | 保留 `aspect-ratio.js` 为画幅单一真源 |
| **6** | `lexiforest/curl_cffi` | TLS / JA3 指纹伪装 | **直接引入**（灰度在"平台 API 直连"路径） | axios / httpx **都不做 TLS 指纹模拟**，JA3 与真实浏览器不一致——这是纯能力空洞，不需要换任何现有调用面 | **小~中**（1~5 人日）<br>依据：单包引入 + 一条路径灰度 + 采集成功率对比 | ① curl_cffi 走的是 TLS 指纹模拟，**不是**浏览器指纹，仍需与 camoufox 配合 ② 需按平台分别验证 | 只在平台 API 直连路径启用，浏览器路径不动 |
| **7** | `Brooooooklyn/keyring-node`（`@napi-rs/keyring`） | 敏感数据本地存储 | **直接引入**（分层迁移） | Electron 内置 `safeStorage` 在 **Linux 退化为明文 `basic_text`**，不可用于存 token；而 mulpub 有 `auth-preload` / `auth-qrcode-preload` 涉及凭据 | **小**（1~3 人日）<br>依据：单包 + 两处凭据读写改造 | ① Linux 桌面环境可能无 secret-service ② 需保留降级路径与用户提示 | 先确认 Linux 用户占比与桌面环境分布 |
| **8** | `promptfoo/promptfoo` | 提示词评测 / A-B | **直接引入**（接进 vitest CI） | `PromptEvalRun` 表**只有结果、没有断言库**——跑完不知道对不对。60 个断言文件含 `cost` / `similar` / `factuality` / `trajectory`，Node 侧与现有 vitest 同栈 | **中**（3~10 人日）<br>依据：接入 CI + 补 5~10 条业务断言 | ⚠️ **评测本身要烧 LLM token**，须先做 `cost` 断言与预算上限，否则"用评测烧钱" | 先在 1~2 个 `PromptEvalScene` 上试点 |
| **9** | `adbar/trafilatura` + `@mozilla/readability` + `kurtmckee/feedparser` | 正文抽取 / RSS | **直接引入** | 采集层现在直接取 DOM，没有正文抽取与 RSS 能力；这三个都是**小而专、协议干净**（Apache-2.0 / BSD-2），组合后能吃知乎/B站/微博的 RSS 镜像 | **小**（1~3 人日）<br>依据：三包引入 + 抽取质量抽样 | RSS 源的稳定性与反爬策略各不相同，需按源单独评估 | 配合 `we-mp-rss` 独立服务使用 |
| **10** | `apache/casbin` + `apache/casbin-pycasbin` | RBAC / 资源归属 | **直接引入**（pycasbin 与 FastAPI 同栈） | `ACCESS-CONTROL-MATRIX.md` 存在但 `AdminUser` + `plan-matrix.js` 的 PLAN_RANK 说明权限与档位序是两套东西；Casbin 的**模型/策略分离**能把这套矩阵规范化 | **中**（3~10 人日）<br>依据：模型文件 + `enforce()` 接入 + 迁移存量策略 | ① 存量权限逻辑迁移有回归风险 ② Casbin 的表达能力边界未实测 | 与 §3.3 的授权模型 DSL 取舍一并决策 |

### 4.1 次级项（11~16 位，条件触发时再上）

| 项目 | 触发条件 |
|---|---|
| `m-bain/whisperX` | 若中文词级时间戳质量实测不达标则必须上（对齐模型约 1.2GB，需评估分发） |
| `hexgrad/kokoro` | 若要建本地/离线 TTS 降级路径（代码与权重同为 Apache-2.0，82M） |
| `idealo/imagededup` | 若要做素材库去重 / 复刻度补一维 |
| `jhao104/proxy_pool` | 若账号池进入规模运营、需要 IP 维度轮换 |
| `rachelos/we-mp-rss` | 若要做公众号整号历史 + RSS 化（**作独立服务**，不并入桌面端） |
| `D4Vinci/Scrapling` 的重定位算法 | 若平台改版频率高到静态选择器维护成本不可接受（**移植算法，不引 Python 依赖**） |

### 4.2 需要向外部问、不能自己拍的两件事

1. **`camoufox-js` 0.11.5 → 0.12.0 的兼容性**：mulpub 的 `camofox-browser` 自 2026-08-02 锁 `camoufox-js@0.11.5` 至今（上游已发 0.12.0 / 0.12.1 / 0.13.0）。0.12.0 是 **minor 跳变可能不兼容**，上游连发 6 版却没敢升——**是"不敢"不是"忘了"**。动作：放宽 pin 为 `~0.11.5` + **问上游** + 过渡期用 `identity-binder.js` 保证指纹自洽。
2. **Apple Developer 账号申请**（国内团队的门槛与周期本轮未取证）+ **macOS runner**（公证必须 macOS 机器执行）。

---

## 5. 协议与合规红线（跨轨道汇总）

> mulpub 是**闭源商业分发产品**。以下项目**协议层面不可用**，无论技术多契合。
> 这是本报告最需要被执行者记住的一节——它比技术选型更容易造成不可逆损失。

### 5.1 因协议直接排除（不得进入依赖树）

| 项目 | 协议（实测正文） | 排除理由 | 替代 |
|---|---|---|---|
| **`NanmiCoder/MediaCrawler`**（67735★） | **NON-COMMERCIAL LEARNING LICENSE 1.1** | ⛔⛔ **禁止商业使用**。且它是**纯采集实现、无任何发布代码** | 自研 |
| **`2noise/ChatTTS`**（39920★） | 代码 **AGPL-3.0** + 权重 **CC BY-NC 4.0** | 双重不可用；README 明写权重 "should not be used for any commercial or illegal purposes" | kokoro / CosyVoice |
| **`SWivid/F5-TTS`**（15438★） | 代码 MIT，但**权重 CC-BY-NC** | 官方 README 的 License 段明写预训练模型为 CC-BY-NC（因训练数据 Emilia） | 同上 |
| **`fishaudio/fish-speech`**（33365★） | FISH AUDIO COMMUNITY LICENSE 1.0 | ① 年营收 **USD 500,000** 门槛 ② **禁 Hosted Service**（若未来把 TTS 作托管能力对外开放即落入）③ 协议 2026-10-13 才更新，条款仍在动 | 同上 |
| **`index-tts/index-tts`**（24656★） | bilibili Model Use License | MAU > 1 亿 或 营收 > 10 亿须单独授权；**第 2.1(c) 条禁止用 indextts2 改进任何其他 AI 模型**——直接限制 mulpub 的自研音色克隆 | 同上 |
| **`getlago/lago`**（10708★） | **AGPL-3.0** | 闭源分发传染 | **openmeterio/openmeter**（Apache-2.0） |
| **`Permify/permify`**（5967★） | **AGPL-3.0** | 与 openfga 定位几乎相同 | **`openfga/openfga`**（Apache-2.0） |
| **`QuantumNous/new-api`**（50500★） | **AGPL-3.0** | 强传染 | 移植其计费/渠道表设计思路 |
| **`zitadel/zitadel`** | **AGPL-3.0** | 换 IdP 迁移成本远大于收益 | 保留 Logto（MPL-2.0） |
| **`hashicorp/vault`** | **BSL 1.1**（正文首行 "License text copyright (c) 2020 MariaDB Corporation Ab"） | 非 OSI 开源，含竞品条款 | KMS 加密列 + 定期轮换 |
| **`Arize-ai/phoenix`** | **Elastic License 2.0** | 非 OSI 开源，含竞品条款 | langfuse 核心 MIT |
| **`signalapp/Signal-Desktop`**（16608★） | **AGPL-3.0** | 脚本不能抄进闭源产品 | 读思路 + 用 MIT 的 `@electron/fuses` / `@electron/notarize` 公开 API 重写 |
| **`browserless/browserless`**（13844★） | **SSPL-1.0** | §13 触发即须提供 Service Source Code，mulpub 的发布/采集/上传全部落入，**闭源不可能满足** | **`steel-dev/steel-browser`**（Apache-2.0） |
| **`ultrafunkamsterdam/undetected-chromedriver`**（12878★） | **GPL-3.0** | 传染性 copyleft；且已停更 15 个月、1142 个 open issue | rebrowser-patches |
| **`firecrawl/firecrawl`**（194362★） | **AGPL-3.0** | 闭源桌面应用不可链接；且定位是"通用网页→LLM Markdown" | trafilatura |
| **`g1879/DrissionPage`**（12535★） | **非开源**：源码可见 + 非商业 + **授权可撤销** | 不满足 OSI 自由要件 1/3/6；开发期参考使用亦不在授权内 | rebrowser / Playwright 原生 |
| **`tmwgsicp/wechat-download-api`** | **AGPL-3.0** | 传染 | **`rachelos/we-mp-rss`**（MIT 正文） |
| **`ToolJet/ToolJet`**（41119★） | **AGPL-3.0** | 低代码 + AGPL | 纯审计（Vue）模板 |
| **`nocobase/nocobase`**（24672★） | **非 OSI**：NocoBase License Agreement（2026-02-24） | 自定义商业协议 + 采购条款 | 保持自研 |
| **`directus/directus`**（38621★） | **非 OSI**：Monospace Sustainable Core License 1.0 | 有使用规模限制 | 同上 |
| **`l4rm4nd/VoucherVault`** | GPL-3.0 | 协议 + 逐表授权混乱 | **saleor 三表模型** |
| **`ComfyUI`** | **GPL-3.0** | 不链接 | 只作外部服务调用 |

### 5.2 协议可用但有附加约束（抄模型不抄代码）

| 项目 | 约束 | 正确用法 |
|---|---|---|
| **`langfuse/langfuse`**（36219★） | 核心 MIT Expat；**`ee/` `web/src/ee/` `worker/src/ee/` 为自定义商业协议**；`isEeAvailable` 机制保证不配 EE 密钥即只跑核心。但 **`usageThresholds`（余额告警）/ `meteringDataPostgresExport`（对账出库）/ `billing` 均为 EE** | 抄 `model Prompt` / `Price` / `PricingTier` **数据模型**；告警与出库自己写 |
| **`BerriAI/litellm`**（61859★） | 核心 MIT；**`enterprise/` 目录另有授权** | 抄价目表形态与 `budget_limiter` 策略设计 |
| **`Infisical/infisical`** | 核心 MIT + `ee/` 另授权 | 只借鉴"分级/审批/轮换/共享"的数据模型 |
| **`getlago/lago`** 的子模块 | main 分支只是编排层 | 警惕"看起来完整、实际拆分"的形态 |

### 5.3 停更红线（默认分支最后提交，不是 `pushed_at`）

| 项目 | 最后提交 | 判读 |
|---|---|---|
| `SGrondin/bottleneck` | **2020-07-21** | 停更 6 年——曾是标准限流库，现在死了。**若报告称其"活跃"即为失实** |
| `lancopku/pkuseg-python` | 2022-06-08 | 停更 4 年；且 `pushed_at` 虚高 5 个月 |
| `atom/node-keytar`（`zeit/keytar`） | 2022-03-02 | **已 archived**；原生模块在新 Node/Electron 上编译失败是常态 → 替代 `@napi-rs/keyring` |
| `minio/minio` | 2026-02-12 | **已 archived** + AGPL ⇒ "自建 S3 兼容存储给 electron-updater"方案作废 → **直接用阿里云 OSS**（S3 兼容 + CDN） |
| `ArekSredzki/electron-release-server` | 2024-04-22 | 停更；数据模型可读，代码别抄 |
| `stable-ts` | — | **已 archived** |
| `google-research/big_vision` | 2025-05-19 | 慢 |
| `openai/CLIP` / `wechatpy/wechatpy` | 2026-03 | 慢 |
| `FunAudioLLM/CosyVoice` / `Portkey-AI/gateway` | 2026-05-25 | 慢（两者均活跃但节奏放缓） |
| `AppImage/AppImageKit` | 2026-07-26 | **宣称 ≠ 实现**：README 仍写 "packaged with a recent version of AppImageKit"，但**仓库已只剩 4 个文档文件**；工具本体已迁到 `AppImage/appimagetool` + `AppImage/type2-runtime` ⇒ **直接依赖 appimagetool 的 Release 二进制，不要从 AppImageKit 源码构建** |
| `berstend/puppeteer-extra` | **2023-03-01** | `pushed_at` 2024-07-18 是其他分支/tag 造成的假象 |
| `lm-sys/RouteLLM` | 2024-08-10 | 停更近两年（协议是 Apache-2.0，问题在维护） |
| `coveooss/spillway` | 2026-08-25 | **已 archived** |

---

## 6. 明确劝退清单（按维度汇总）

> 完整的逐项实测证据在附录索引对应的轨道交付物 §四。下列为按"劝退理由类型"归并后的速查。

### 6.1 因架构侵入 / 体量劝退（协议没问题，问题是会接管 mulpub 已有的一切）

| 项目 | 体量/侵入点 | 什么条件下值得重新考虑 |
|---|---|---|
| Appsmith / Budibase / ToolJet | 低代码平台接管 ops-center 的页面与数据抽象；与 SQLAlchemy 模型争夺真相源 | mulpub 运营后台真的要做"拖拽搭页面"时 |
| Medusa / Vendure / ERPNext | 完整电商内核（商品/订单/区域/促销/库存 / 7269 文件全套）；会接管 PostgreSQL 商业化闭环 | mulpub 真的要卖实物商品时（现在不卖） |
| NocoBase / Directus | 自定义 / MSCL 协议 | —— |
| LangGraph | 引入即引入一整套编排平台（CLI + 远程 SDK + 状态持久化后端 + conformance 套件 = 409/621） | mulpub 需要多 agent 编排与状态持久化时 |
| dspy | 闭环是"标注数据集→优化器合成 prompt→评测"，mulpub 是人工评测集；且与 rewrite-engine 硬编码提示词正面冲突 | mulpub 攒够标注数据时 |
| browser-use | 范式不匹配：mulpub rpa-engine 是确定性脚本编排，browser-use 是 LLM 决策驱动的 agent 循环 —— 引入会带来不可复现性与 token 成本，且与 rpa-engine 的重放/幂等语义冲突 | mulpub 需要"自然语言驱动发布"的新形态时 |
| Crawlee / crawl4ai / firecrawl | 定位是"通用网页 → LLM-ready Markdown"，对国内短视频/图文平台（需登录态 + 平台签名 + 评论区分页）无覆盖 | mulpub 要做 LLM 爬取服务时 |
| Tauri / Wails / Neutralino | 三处硬阻断（Playwright 无 Rust 绑定 / Remotion 走 CDP 的 Node+Chromium / stealth-preload 依赖 Electron 专属 Chromium） | mulpub 不再需要 Node 运行时时（短期无望） |
| electron-builder → electron-forge 替换 | 换构建系统要重写打包配置 + 签名 + 发布脚本 | 要上 Microsoft Store（MSIX）时再单独评估 |
| Vault | mulpub 的密钥量级（官方模型 key + 用户自带 key）用"KMS 加密列 + 定期轮换"即可，上 Vault 是重大过度工程 | 密钥规模/合规要求质变时 |
| Logto → 其他 IdP 替换 | 鉴权链路（jwks / webhook / business-identity / entitlement 的 RSA+kid）已做得很深 | —— |

### 6.2 因协议劝退

见 §5.1（21 个项目）。

### 6.3 因定位错配 / 能力不匹配劝退

| 项目 | 实测事实 | 为什么不匹配 |
|---|---|---|
| `lm-sys/RouteLLM` | 停更近两年 | "按质量/成本自动选模型"的现役替代品未找到可信候选 → **列为缺口** |
| `ollama/ollama` | 全仓**路径**匹配 `fallback\|budget\|router\|quota\|credit` = 0（仅证明无同名文件，非内容级排除） | 只解决"本机跑一个模型"；可作为 ai-router 的下游 provider，不是选型对象 |
| `vllm` | 8412 blob | 自托管推理，与 mulpub 的"云端模型 + 积分计费"模型不匹配 |
| `DeepEval` / `Ragas` / `Helicone` / `OpenLLMetry` / `Stagehand` | 仅取元信息与一两次提交记录 | 未深查目录树，不做正面推荐 |
| `open-policy-agent/opa` | 7985 blob | 策略引擎体量大，mulpub 的权限矩阵用 Casbin 模型/策略分离足够 |

---

## 7. 必须自建的缺口（开源补不上）

> 这四项是本轮调研最有价值的负面结论。**它们不是"没找到"，是"找到了也不该用"。**

### 7.1 微信 / 支付宝官方 SDK 无 Node / Python 版本 ⇒ 签名验签回调解密自建

**实测事实**：
- 官方 `wechatpay-apiv3` 全家桶 9 仓**已停更**（`wechatpay-java` 停更于 2025-04）。
- `alipay-easysdk` 停更于 **2023-05-16**。
- 社区 `binarywang/WxJava` 的 `weixin-java-pay`（v4.8.6.B，Apache-2.0，**2026-10-10 仍在提交**）**能力完整**（`WxPayConfig` / `VerifierBuilder` / `BaseWxPayServiceImpl` 齐备，依赖 `bcpkix-jdk18on` 提供 APIv3 的 RSA 验签 / AEAD 解密）——**但 Java 栈与 mulpub 的 Node / Python 双栈都不匹配**。
- ⇒ **结论：读 WxJava 的封装作参考，不引入 artifact；签名 / 验签 / 回调解密自建（约 200 行）。**

**可参考的另一个来源**：`vikingmute/better-wechatpay`（社区实现，`src/native/` `src/jsapi/` `src/h5/` `src/core/cert-manager.ts` 完整）。⚠️ 注意 code search 查 `PUB_KEY_ID` / `publicKeyId` / `transactions/native` / 甚至 `wechatpay` **全部 0 hits**——那是**仓库未建索引的假阴性**，不是"不支持"。

### 7.2 "按张 / 按秒"没有 per-unit 价格模型

OpenMeter 的 `llmcost` 只覆盖 token 维度；`Price` 结构体是版本化 + Namespace 倍率覆盖 + `PriceSource=manual|system`，配 `sync/fetcher_modelsdev.go` 拉 `https://models.dev/api.json` 公开价源。mulpub 的 `officialCreditMonthly` 要覆盖"2 条 720P 视频 / 7 张标准清晰度配图"这类**非 token 额度**，需要自建 per-unit 价格模型。

### 7.3 微博 / 快手 / 贴吧采集侧无合规开源替代

`collection-engine/platform-adapters/` 只有 6 个 adapter，**发布侧有但采集侧缺**。`MediaCrawler` 覆盖了这些平台但**许可是非商用的**⇒ **只能自研，或读其代码取思路（绕开许可）**。

### 7.4 支付订单状态收敛

`payment-event-outbox.js` 只保证**事件发出**，不保证**订单状态收敛**。官方 `wechatpay-skills` 仓给出了现成的查单节奏原文，可直接实现（见 §4 路线图与 §3.5）。

---

## 8. 查开源项目的 8 条判据（方法论，可复用）

> 这一节来自本轮的独立交叉核查。**这些坑都是实打实踩过的**，且每一条都会让读者按报告去查时查不到、或得出错误结论。

### 8.1 仓库名 ≠ 包名 —— 读者照着查会 404

npm/PyPI 生态里大量包是 **scope 包**，GitHub 仓库在**作者个人名下**。按包名拼 `owner/repo` 必然 404。

| 报告里会出现的写法 | 真实 GitHub 仓库 | 后果 |
|---|---|---|
| `napi-rs/keyring` | **`Brooooooklyn/keyring-node`**（`GET /repos/napi-rs/keyring` → **404**；npm `@napi-rs/keyring` 的 `repository.url` = `git+https://github.com/Brooooooklyn/keyring-node.git`） | 读者按包名查 → 404 → 误判"项目不存在" |
| `napi-rs/keytar` | 同上（keytar 已废弃，包名换成 keyring） | 同上 |
| `electron-userland/electron-updater` | **`electron-userland/electron-builder` 的 `packages/electron-updater` 子目录**（`GET /repos/electron-userland/electron-updater` → **404**；npm `electron-updater` 的 `repository.directory` = `packages/electron-updater`） | electron-updater 是 monorepo 子包，**不是独立仓库** |

**判据**：给一个开源候选时，必须同时给出 ① GitHub 仓库全名 ② npm/PyPI 包名 ③ 二者的对应关系（从 registry 的 `repository` 字段取）。只给一个名字，读者有一半概率查不到。

### 8.2 301 别名 ≠ 404 —— `curl` 默认不跟随重定向

`GET /repos/{old-owner}/{repo}` 对改名仓返回 **301**，并带 `Location` 头指向新路径；而 `curl` **默认不跟随**（`-L` 才跟随）⇒ 脚本化批量核查会把改名仓误判为不存在。

**实测三例**：`casbin/casbin` → 302 → `apache/casbin`；`refine-web/refine` → **404**（真改名了，正确名 `refinedev/refine`）；`vendure-ecommerce/vendure` → 301 → `vendurehq/vendure`。

**判据**：存在性判定必须带 `-L`，或直接读响应头。

### 8.3 `pushed_at` 会虚高 —— 活跃度只能用默认分支最后提交

`pushed_at` 统计**所有分支与 tag** 的推送。实测虚高案例：
- `lancopku/pkuseg-python`：`pushed_at` 2022-11-05，但默认分支最后提交 **2022-06-08**（差 5 个月）
- `berstend/puppeteer-extra`：`pushed_at` 2024-07-18，默认分支最后提交 **2023-03-01**（差 16 个月）
- `dromara/payment-spring-boot`：`pushed_at` 2026-04-18，默认分支实际停在 **2025-06-12**（差 10 个月）

**判据**：`GET /repos/{o}/{r}/commits?per_page=1&sha={default_branch}` 取 committer.date。

### 8.4 `spdx_id = NOASSERTION` 必须读 LICENSE 正文

实测 6 例，**同一个 NOASSERTION 背后可能是 MIT、Apache-2.0，也可能是非商用协议**：

| 仓库 | 正文实况 |
|---|---|
| `NanmiCoder/MediaCrawler` | **NON-COMMERCIAL LEARNING LICENSE 1.1** ⛔ |
| `getlago/lago` | AGPL-3.0 ⛔ |
| `permify/permify` | AGPL-3.0 ⛔ |
| `langfuse/langfuse` | MIT + `ee/` 目录自定义商业协议 ⚠️ |
| `BerriAI/litellm` | MIT + `enterprise/` 目录另授权 ⚠️ |
| `softonic/axios-retry` | 实为 **Apache-2.0**（metadata 判不出）✅ |

**判据**：出现 NOASSERTION 一律读正文前 6 行再下结论。

### 8.5 `code search` 的 0 hits 是假阴性

`GET /search/code` 在**新仓库 / 小仓库**可能根本没建索引。实测 `lianjx2025/better-wechatpay` 查 `PUB_KEY_ID` / `publicKeyId` / `transactions/native` / 甚至 `wechatpay` **全部 0 hits**，但 `git/trees?recursive=1` 显示 `src/native/` `src/jsapi/` `src/h5/` `src/core/cert-manager.ts` 全在，实现相当完整。

**判据**：code search 索引的是 **default_branch**（`dromara/dax-pay` 的 default_branch 是 `4.0` 而 master 是 3.x，查 3.x 会一无所获却毫无提示）；判断"有没有"用目录树，判断"完不完整"读代码内容。

### 8.6 "宣称 ≠ 实现"，行数是最诚实的信号

- `own-pay/OwnPay` 的微信 gateway **仅 145 行、仅 3 个方法**（initiate/verify/verifyWebhook），README 却宣称 "enterprise-grade / 120+ gateways / 银行级安全标准"。
- `AppImage/AppImageKit` README 第 1 行仍写 "packaged with a recent version of AppImageKit"，但**仓库已只剩 4 个文档文件**。
- `juspay/hyperswitch`（45k★）官方博客把 WeChat Pay 列进覆盖表，但 328 个 connector 里**无 wechat 直连**；67 处 `wechat` 命中全落在海外聚合商的 transformers 里。
- `dromara/dax-pay` 4.0 的公开仓只是**编排层**（`@HttpExchange` 声明式 HTTP 客户端转发到 `/channel/wechat/*`），真正的执行层在仓外。

### 8.7 "仓库活" ≠ "有可安装的现代版本"

`wechatpy` 仓库 2026-03 仍在提交，但**正式版停在 2020-11-22、PyPI 停在 2021-11-11、v2 只到 alpha26** ⇒ 结论是"没有可 pip install 的现代正式版"，不是"生态已死"。

### 8.8 凭记忆写仓库名错的概率不低

本轮独立扫描 27 个候选，**12 个 404（44%）**。任何候选名在落笔前必须打一次 `GET /repos/{o}/{r}`；npm/PyPI 生态必须从 registry 的 `repository` 字段取真实仓库名。

---

## 9. 支付方向：上一轮已验证结论（不重复调研）

> 2026-10-23 上午已完成一轮「web 网站支付系统 · 微信支付」专项调研 + `dax-pay` 深度审计（产出 `wechat-pay-open-source-survey.md` 约 15 KB / `dax-pay-wechat-audit.md` 约 21 KB）。本轮**未重复调研聚合支付系统**，直接沿用已取证结论。

**① 总原则：给网站接微信支付 → 用官方 SDK，不要上聚合支付系统。** 聚合系统整体过重。

**② `dromara/dax-pay` 4.0.0-beta9 的通道执行层不在公开仓** —— 五条独立证据链互证：
1. `daxpay-start/pom.xml` 全部 33 个 artifact **无 channel-one**
2. 微信模块 20 个 `@RequestMapping` 前缀**无 `/channel/wechat`**
3. 全仓 code search `/channel/wechat/pay` **仅 1 处命中 = 客户端声明本身**
4. `dromara` org 下 `dax-pay-channel-one` → **404**
5. 通道模块 `pom.xml` **零依赖**（wxjava 只在根 pom 的 properties）
⇒ **单独部署公开版，微信支付必然 404。** 且 `default_branch = "4.0"`，master 是 3.x ⇒ `git clone` 默认拿到的正是执行层不公开的版本。

**③ dax-pay 4.0 幂等工程质量高**（Redis 分布式锁 + **自注入保证事务边界** + **DB 层 CAS** `UPDATE ... WHERE id=? AND status IN (expectFrom)`）；终态守卫正确（FAIL/CLOSE/CANCEL 收到成功回调**不翻转**）。

**④ 最大盲区：证书/公钥轮换** —— 4.0 微信模块 `@Scheduled` **零命中**，全仓搜 `certificates` 只有支付宝的 `AlipayCertUtil`。平台证书与支付公钥**都有有效期，轮换失败 = 支付全线中断**。**无论选哪个版本，上线前都要做一次证书过期演练。**

**⑤ 3.x（master）自包含但幂等层需另行验证** —— 直接用 `WxPayServiceImpl`，签名/验签/证书在可审计范围内；代价是 `wxJavaSdk()` **每次支付操作都 new**（疑似重复下载平台证书，**标为待验证**，未读 WxJava 源码）。

**⑥ 协议陷阱**：`dromara/dax-pay` README 三处写 Apache-2.0，**LICENSE 实为 LGPL-3.0**（2026-06-23 变更）。

**⑦ 官方 SDK 停更**：`wechatpay-java` 停更于 2025-04、`dromara/payment-spring-boot` 停更于 2025-06、`alipay-easysdk` 停更于 2023-05-16 ⇒ 见 §7.1。

**⑧ 支付侧最有价值的一份"不是库"的资产**：`wechatpay-apiv3/wechatpay-skills`（官方，MIT）——查单节奏（5s/30s/1m/3m/5m/10m/30m）、退款原单号原参数重试、三条铁律（金额用整数分 / 每天拉微信账单比对 / 防重复下单）。**这是本轮唯一建议"直接按官方规则实现"的支付侧输入。**

---

## 10. 不确定项与后续调研建议

### 10.1 需要运行时验证才能定论的（附最小验证方法）

| # | 待验项 | 最小验证方法 |
|---|---|---|
| 1 | Instructor `Mode.TOOLS_STRICT` 对通义/豆包/智谱的兼容性 | 三家 provider 各跑 10 条 `rewrite-paragraph-preserve` 真实样本，统计 strict 成功率与失败模式 |
| 2 | 中文 TTS 实际质量对比（kokoro / CosyVoice vs 现有 6 家云端） | 同一批 50 条故事脚本，按当前 `tts-calibration.js` 的口径盲评 |
| 3 | whisperX 中文强制对齐的收益与模型体积代价 | 取 10 条真实成片，对齐时间戳与现有 `subtitle-aligner.ts` 的人工校验结果比对 |
| 4 | rebrowser-patches 与 stealth 插件**是否互相覆盖同一处注入** | 两组各跑 100 次采集，比对 `navigator.webdriver` / 栈名 / CDP 指纹三项的检出率 |
| 5 | smartcrop.js 的裁切结果稳定性 | 200 张历史封面盲测"主体是否被切" |
| 6 | promptfoo 评测与用户 token 的分账 | 配 `cost` 断言 + 独立 provider key，验证预算上限能真正拦住 |
| 7 | Camoufox 0.12.0 的兼容性 | 向 `daijro/camoufox` 问 minor 跳变的破坏性变更清单 |
| 8 | 各支付/发布平台的实际成功率与风控阈值 | 需要测试账号发真内容，**核查方不发起**（会留痕） |
| 9 | opencost / OpenMeter 的阿里云定价 provider 覆盖面 | 读 provider 目录，对照 mulpub 实际用的机型与计费方式 |

### 10.2 本轮未覆盖的维度（明确边界，不假装穷尽）

- **移动端 / 小程序**：mulpub 现有形态是桌面应用 + 运营后台，未评估。
- **内容质量 / 选题 / 标题生成**的垂直类项目（只覆盖了改写与评测的横向基础设施）。
- **向量检索 / RAG 引擎**本身（`rewrite-engine` 的知识库自演化已自研，本轮只覆盖了评测与提示词版本化）。
- **端侧模型 / 量化推理**（只覆盖了云端模型的成本核算与路由）。
- **企业级 SSO / 组织架构**（mulpub 是个人产品 + 运营后台，`Logto` 已够）。
- **出海 / 多语言**的支付与合规（`vue-i18n` 已在用，但支付/税务的国际化未查）。

### 10.3 建议下一轮优先查的三个方向

1. **OpenTelemetry Collector 的 genai processor** —— 本轮只查了语义约定，Collector 侧可能有更省事的成本聚合实现。
2. **桌面端本地限流 / 降级策略库** —— mulpub 有 `ClientDegradationEvent` 表，客户端侧降级策略的开源方案本轮未查。
3. **提示词仓库化（prompt-as-code）**（`Agenta` / `prompttools` 等）—— mulpub 已有 `RuntimeConfigVersion` / `RuntimeClientAck` 的"配置版本 + 客户端确认"雏形，与提示词版本化高度耦合。

---

## 附录 A｜证据索引（抽样）

> 完整证据索引见各轨道交付物的「证据」小节与附录 A（每个候选含四类端点的原始实测值）。
> 下表是负责人**独立复核过的**关键条目——这些是我在轨道交付物之外自己重新调 API 取证的。

| 断言 | 端点 | 实测值 | 复核结论 |
|---|---|---|---|
| `electron/fuses` 含 `EnableEmbeddedAsarIntegrityValidation` / `OnlyLoadAppFromAsar` | `GET /repos/electron/fuses/contents/src/config.ts` | 7 个 fuse 全名：RunAsNode / EnableCookieEncryption / EnableNodeOptionsEnvironmentVariable / EnableNodeCliInspectArguments / **EnableEmbeddedAsarIntegrityValidation** / **OnlyLoadAppFromAsar** / GrantFileProtocolExtraPrivileges / LoadBrowserProcessSpecificV8Snapshot / WasmTrapHandlers | ✅ 属实 |
| `getsentry/sentry` 已转 FSL | `GET /repos/getsentry/sentry/license` | 正文首行 **"Functional Source License, Version 1.1, Apache 2.0 Future"**；45631★，br=master | ✅ 属实（但 `sentry-electron` 是纯 MIT） |
| `lm-sys/RouteLLM` 的 `/license` | `GET /repos/lm-sys/RouteLLM/license` | **HTTP 200**，spdx=Apache-2.0，正文 **201 行** | ⚠️ 轨道C 原稿写"404、许可证未取证"是错的，已订正 |
| `ollama/ollama` 活跃度与协议 | `GET /repos/ollama/ollama` | stars=**184361**，spdx=**MIT**，默认分支最后提交 **2026-10-22** | ⚠️ 原稿 Summary 写"已停更且无协议"是臆造，已订正 |
| `stanfordnlp/dspy` 的 `teleprompt/` | `GET /repos/stanfordnlp/dspy/git/trees/main?recursive=1` | **28 个文件** | ⚠️ 原稿写 8，已订正 |
| `promptfoo/promptfoo` 的 `src/assertions/` | `GET /repos/promptfoo/promptfoo/git/trees/main?recursive=1` | **60 个 .ts** | ⚠️ 原稿写 40，已订正 |
| `NanmiCoder/MediaCrawler` 协议 | `GET /repos/NanmiCoder/MediaCrawler/license` | 正文首行 **"NON-COMMERCIAL LEARNING LICENSE 1.1"** | ⛔ 非商用 |
| `getlago/lago` 协议 | `GET /repos/getlago/lago/license` | **AGPL-3.0**；10708★，br=main，最后提交 2026-10-21 | ⛔ 闭源分发风险 |
| `permify/permify` 协议 | `GET /repos/permify/permify/license` | **AGPL-3.0**；5967★，最后提交 2026-10-09 | ⛔ |
| `openmeterio/openmeter` | `GET /repos/openmeterio/openmeter` | 2400★，Apache-2.0，br=main，最后提交 2026-10-22 | ✅ 协议干净的首选用量计量候选 |
| `dreammis/social-auto-upload` | `GET /repos/dreammis/social-auto-upload` | 15732★，MIT，br=main，最后提交 2026-10-22 | ✅ 平台发布对照基准 |
| `netease-youdao/EmotiVoice` | `GET /repos/netease-youdao/EmotiVoice` | 8540★，Apache-2.0，最后提交 2026-09-03 | ✅ 中文 TTS 候选 |
| `Brooooooklyn/keyring-node` | `GET /repos/Brooooooklyn/keyring-node` + npm registry | 106★，MIT，最后提交 2026-10-21；npm `@napi-rs/keyring` 2.1.2（2026-10-19） | ✅ **注意包名 ≠ 仓库名** |
| `apache/casbin` 改名 | `GET /repos/casbin/casbin` | 302 → `apache/casbin`，20463★，br=master | ⚠️ 别名不是 404 |
| `refinedev/refine` 改名 | `GET /repos/refine-web/refine` | **404**（真改名）→ `refinedev/refine`，35931★ | ⚠️ |
| `SGrondin/bottleneck` 停更 | `GET /repos/SGrondin/bottleneck/commits?per_page=1` | 最后提交 **2020-07-21** | ⛔ 停更 6 年 |
| `coveooss/spillway` | `GET /repos/coveooss/spillway` | **archived=true**，39★ | ⛔ 已归档 |
| `minio/minio` | `GET /repos/minio/minio` | **archived=true**，AGPL-3.0，最后提交 2026-02-12 | ⛔ "自建 S3 存更新包"方案作废 |

## 附录 B｜覆盖矩阵

| 轨道 | 本报告对应章节 | 贡献的核心内容 | 交付物 | 复核结果 |
|---|---|---|---|---|
| A 桌面壳 / 分发 / 客户端安全 | §2.1、§3.1、§4(#3 #7)、§5.1、§6.1 | 不换壳的三处硬阻断；fuses 9 个 fuse 全名；macOS 公证缺口；keyring vs safeStorage 的 Linux 退化；崩溃上报的 FSL 澄清 | `track-desktop/deliverable.md` 65.6 KB / 10 候选 | **PASS** |
| B 浏览器自动化 / 反检测 / 采集 | §2.2、§3.2、§4(#2 #6 #9)、§5.1、§6.1 | CDP 泄漏的真实空档；TLS/JA3 缺失；MediaCrawler 的"纯采集 + 非商用"双重判定与签名零自有算法；DrissionPage 的非开源定性；browserless SSPL §13 三级判定 | `track-automation/deliverable.md` 94.9 KB / 12 候选 + 13 劝退 | 复核 FAIL 1 轮后**已按清单订正**（wechatpy 分层结论、301 假 404 排查、Crawlee 路径） |
| C AI 编排 / 网关 / 评测 / 认证 | §2.3、§3.3、§4(#1 #8 #10)、§5.2、§6.1 | OTel 计量口径 deprecated 警告（最高优先级）；Bifrost 错误分类表；LangGraph 409/621 的构成；dspy 28 个优化器；Logto 保留理由；Instructor TOOLS_STRICT 结论级风险 | `track-ai/deliverable.md` 75.2 KB / 12 候选 | 复核 FAIL 后**已按 12 处清单逐条订正 + 补 §3.1 八项落账**（负责人抽查 4 处，复核方全对） |
| D 视频 / 音频 / 发布 | §2.4、§3.4、§4(#5)、§5.1、§6.3 | 字幕对齐是唯一实质缺口；相似度不同轴；TTS 缺口是"无离线降级"而非"没有 TTS"；中心裁切的内容感知替代；MediaCrawler 无发布代码的实测 | `track-media/deliverable.md` 72.1 KB / 12 候选 | **PASS** |
| E 运营后台 / 计费 / 积分 | §2.5、§3.5、§4(#4)、§5.1、§5.2 | 积分缺 grant/账户/账本三件套；ModelPrice 版本化价格表；预算过滤应是路由策略；outbox 不保证订单收敛；langfuse 的 EE 边界实测；整体替换型后台全劝退 | `track-ops/deliverable.md` 112.4 KB / 13 候选 | **PASS** |
| **负责人独立核查** | §1.1、§5.3、§8、附录 A | 能力基线（代码级）；31 个候选的独立扫描与 owner 名纠错；**仓库名≠包名**三例；**301 别名**三例；**pushed_at 虚高**三例；**NOASSERTION 读正文**六例 | `owner/owner-verification.md` | — |
| **上一轮支付专项** | §7.1、§9 | dax-pay 执行层不在公开仓的 5 条证据；幂等三层防护；证书轮换盲区；官方查单节奏 | 上一轮产出 | 已取证 |

## 附录 C｜交付物索引

| 文件 | 内容 |
|---|---|
| `mulpub-oss-reference-report.md` | **本报告**（决策依据） |
| `tracks/track-desktop/deliverable.md` | 轨道A 完整调研稿（10 候选 × 7 字段 + 劝退节 + 404/重定向清单） |
| `tracks/track-automation/deliverable.md` | 轨道B 完整调研稿（12 候选 + 13 劝退 + §5.1/§5.2 两个许可证专章） |
| `tracks/track-ai/deliverable.md` | 轨道C 完整调研稿（12 候选 + §3.1 八项落账 + 协议风险总览表） |
| `tracks/track-media/deliverable.md` | 轨道D 完整调研稿（12 候选 + 补充候选速览 + 四类处置归总） |
| `tracks/track-ops/deliverable.md` | 轨道E 完整调研稿（13 候选 + 四类劝退小节 + 明确立场不骑墙） |

> **读法建议**：先读本报告的 §0 决策摘要与 §4 路线图（够做决策）；要落地某个具体项时再翻对应轨道的候选详情（每条含完整 API 实测值与关键文件行数）；§5 与 §8 是执行者必须知道的红线与方法论，建议单独存档。

---

## 附：本次调研的三个"自伤"教训（记录给未来的自己）

1. **输出路径写错一层，整个团队白跑。** 第一版 plan 里让 worker 写 `track-desktop/deliverable.md`（相对路径），而 worker 的工作目录已经是 取证工作区（沙箱内，未入库），引擎检查的却是 `outputs/track-desktop/deliverable.md` —— **多套一层，5 条轨道全部判定"未交付"**。修正：改用从工作目录可推算的 `../../outputs/<task_id>/deliverable.md`，并加"**分批落盘**"纪律（先写骨架再补全）。
2. **用 steer 校正正在跑的 worker，会把它正在执行的工具调用打断。** 第一轮我用 steer 把"现状校正"发给 5 个 worker，它们的 bash 调用直接返回 `Operation aborted`，随即被判失败。修正：**把校正写进初始 prompt，而不是中途打断。**
3. **裁决通道的参数在某些宿主上会失真。** `team decision` 连续 5 次返回同一个校验错误（数组被转成对象、布尔被转成字符串），换嵌套形状、换扁平形状、换 `mcp_invoke` 通道全部失败。修正：**不要在通道上死磕**——素材齐了就把综合接过来自己做，综合质量反而更高（能融进独立核查层）。

---
