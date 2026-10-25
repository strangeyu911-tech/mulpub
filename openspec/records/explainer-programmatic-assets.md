---
record: explainer-programmatic-assets
task: 让「AI 讲解视频」的场景能声明素材需求，并让声明的「示意图 / 代码片段」真的被生产出来并进入成片
date: 2026-10-25
branch: explainer-programmatic-assets
---

## 本次执行记录：程序化素材（场景素材声明 + diagram/code_snippet 生产 + 全链路接线）（explainer-programmatic-assets，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码（新增程序化素材模块 + 改 scenes 提示词 / assets 阶段 / asset_manifest / compose 合成层 + 改 E2E 夹具）⇒ 隔离 worktree `/workspace/mp-worktrees/mp-explainer-programmatic-assets`、裸分支 `explainer-programmatic-assets`，基线 = P5a 合并后的 main tip `98dd95e02295fae689a3cb10921dae737c157c0c` |
| 第一性原因（QM-5 ①） | ✅ | P5a 把 cut type 判定改成「**素材声明优先**」（`scene.required_assets[].type` 权威），但 `buildScenePlanPrompt` **从不让 LLM 输出 `required_assets`** ⇒ 那条判据在真实流水线里**从来没生效过**，实际一直靠「文本线索 + 叙事兜底」在猜；且即便声明了，也**没有任何生产端**会把它变成素材（assets 阶段只出 AI 生图 + 旁白）⇒ 「按声明判 cut type」与「程序化素材」两头都空 |
| 逃逸分析（QM-5 ②） | ✅ | ① **上游机制被当成「已经有」**：上游 `animated-explainer` 的 assets 阶段 `optional_tools` 含 `math_animate`/`diagram_gen`/`code_snippet`/`music_gen`，本仓 Python 侧也有**完整实现**（`providers/image/math_animate.py` 269 行真跑 ManimCE）⇒ 读起来像「能力齐了」；② **实查通路后才发现是「注册≠注入≠生效」**：`serviceBus.callPythonSkill()` 打的是 `POST /api/skills/<name>`，而 Python 后端**没有任何 `/api/skills/*` 路由**（`server.py` 路由清单里没有，`ToolRegistry` 也从未挂到 HTTP 上）⇒ **桌面端根本调不到那四个工具**；③ **上游那套依赖三个外部二进制**（`manim` / `@mermaid-js/mermaid-cli` / `pygments`+`pillow`）⇒ **用户机器装不齐 ⇒ 照搬即「名义存在、实际不可达」**；④ **判据的「域」漏了程序化素材**：`asset_manifest` 的 `type` 枚举**本来就含** `diagram`/`code_snippet`（上游 1:1 落地），但 `buildAssetManifest` 只认 `image`/`narration`/`video` ⇒ 这两个类型**永远产不出来** |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① **新增** `services/explainer/explainer-programmatic-assets.js`：素材声明解析（支持的进 requests；不支持的登记 `PROGRAMMATIC_TOOL_UNSUPPORTED`；缺字段登记 `PROGRAMMATIC_REQUEST_INVALID`）+ `diagram_gen`/`code_snippet` 两个渲染器（ffmpeg drawbox/drawtext，**零外部二进制**）+ 批量生产；② **提示词扩**（`buildScenePlanPrompt` 要求输出 `required_assets` + 给出选型规则，默认 `image_selector` ⇒ 行为与今天一致）；③ **归一化收紧**（`buildScenePlan` 丢弃缺 `type`/`description` 的声明并登记）；④ **assets 阶段接线**（`createAssetsExecutor` 在 `buildAssetManifest` 之前生产程序化素材）；⑤ **manifest 登记**（`buildAssetManifest` 接受 `ctx.programmaticAssets`，`type` 用上游枚举 ⇒ **不扩 schema**）；⑥ **compose 侧消费**（`buildAssetsIndex` 收集程序化资产 → `buildCut`：程序化素材当**视觉主体** `cut.source`，AI 生图降为**背景层** `cut.backgroundImage`，`code_snippet` 额外给 `cut.steps` 终端打字机步骤）；⑦ **新增** `explainer-programmatic-assets.test.js`（**22 例**）；⑧ **修掉一个被测试逮住的真缺陷**：「该镜有资产吗」的判据在程序化资产登记**之前**判 ⇒ 程序化资产没能替代 AI 生图 ⇒ 误报 `SCENE_WITHOUT_ASSET`（error 级 ⇒ 白做）；⑩ **顺带修 P5a 遗留链路的存量红**（**与本片无关、但挡住合并**）：`title-card-renderer` 的两条真渲染用例在 **Windows CI runner** 上失败，stderr 唯一一行 `Fontconfig error: Cannot load default config file: No such file: (null)`⇒ **Windows 没有系统 fontconfig 配置** ⇒ ffmpeg 的 drawtext 初始化失败；而带 `:alpha=` 的 drawtext 尤其如此（不带 alpha 的同款渲染在同一台 runner 上**通过** ⇒ 本片链路无恙）。⇒ 修法（**改实现不改判据**）：`font-resolver` 新增 `buildFontconfigEnv()`，**复用已有的 `buildFontconfigForSharp()`**（同一份最小 fonts.conf 生成逻辑 ⇒ 单一真源）⇒ ffmpeg 与 sharp 共用同一份注入 ⇒ `title-card-renderer` 与本片的程序化素材渲染器都受益；⑨ **修掉一个被 E2E 逮住的真缺陷**：`cut.source` 在合成器里只是**媒体兜底分支**（`Explainer.tsx:563` 起那串 `if (cut.type === ... && cut.<字段>)`）⇒ **卡片类组件抢先匹配** ⇒ 素材在盘上却**全程不上屏**（首轮 E2E 抽帧证实：那一镜是文字卡，不是示意图）⇒ 修法：示意图改走**媒体型 cut**（`cut.type='anime_scene'` + `cut.images=[png]` + `animation='static'` + 不加粒子/暗角）⇒ 该图才成为**视觉主体**；**这一段接线必须放在 `switch` 之后**（`anime_scene` 分支会覆写 `cut.images`/`cut.particles`） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **不扩任何 1:1 schema**（`asset_manifest` 的 `type` 枚举上游已含 `diagram`/`code_snippet`）⇒ P1 的 sha256 门禁不受影响；② **降级必须可见**：`PROGRAMMATIC_TOOL_UNSUPPORTED` / `PROGRAMMATIC_ASSET_FAILED` 逐条进 `asset_manifest.metadata.issues` 与 `final_review.metadata.issues` ⇒ 不静默；③ **字体解析不出来 ⇒ 判失败**（不产出豆腐块图，解析器**可注入** ⇒ 该格可测）；④ **ffmpeg 调用同款纪律**：`-nostdin` 必给（否则 ffmpeg 永久等待 stdin）、`stdio:['ignore','pipe','pipe']`、内部超时 8s < 调用方超时、失败信息带 argv + stderr 尾巴；⑤ **复用既有单一真源**：`escapeDrawtextText` / `resolveFfmpegBinary` / `wrapText`（title-card-renderer）+ `buildDrawtextFontOption` / `resolveContentCjkFont`（font-resolver）⇒ **不自己找字体、不自己转义**；⑥ **默认行为不变**：没声明 ⇒ 零变化（默认 `image_selector`） |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（`git diff --numstat` vs `git diff --shortstat` 必须一致，删除数归因见提交信息） |
| 接线棘轮 | ✅ | 新增 `apps/desktop/electron/services/explainer/explainer-programmatic-assets.test.js` 落在 vitest include 的 `electron/services/**/*.test.js` 白名单内（**无需改 vitest.config.js**）；`scripts/check-unwired-tests.js` 实测 PASS |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | QM-1：改动落在 `apps/desktop/electron/services/explainer/**`（运行时代码）⇒ 由 CI 的 `build` job（windows-latest + electron-builder，required check）兜底。QM-4：**零 UI 变更**（素材声明由 LLM 自动产出、程序化素材自动生成，**无新增控件/文案/i18n 键**）⇒ 无视觉面；`check-locale-sync --cjk` 不受影响 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道（`codeagent-wrapper` 不可用）；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`）；合并证据写在 PR 评论里 |

### 本地验证读数

- **vitest 200/200 全绿**（explainer 目录 9 个文件：既有 178 + 新增 22）
- **变异验证 6 组全部被抓住**（逐条打回原形必红）：
  ①「不支持的类型静默跳过」⇒ 2 红；②「程序化素材不优先（回到 AI 生图优先）」⇒ 1 红；
  ③「`code_snippet` 不给 `steps`」⇒ 1 红；④「程序化资产不算该镜有资产」⇒ 1 红；
  ⑤「去掉字体检查（会出豆腐块）」⇒ 2 红；⑥「渲染失败不登记 issue」⇒ 1 红
- **真渲染读数**（真 ffmpeg）：示意图 PNG **60,764 B**（标题 + 4 个节点框 + 连接线，中文正常无豆腐块）；
  代码片段 PNG **17,723 B**（标题栏 + 行号 + 代码行，注释行单独着色）
- 桩的守卫（`local-provider-hub.test.js` + `animated-explainer-cdp.test.js`）**32/32 全绿**
  ⇒ 提示词扩**没有打断**按提示词路由的桩（路由特征串「你是视频分镜师」保留）

### 抽模块（不是抬基线）

⚠ 本片两处改动把既有文件顶过了 500 行硬上限（`check-max-lines.js` 的 `NEW_OVER_LIMIT` 对新代码是硬拦）：

| 文件 | 处理 |
|---|---|
| `explainer-prod-stages.js`（528 行） | 「scenes 阶段提示词 + 输出解析」抽成 **`explainer-scene-plan-prompt.js`**（103 行）⇒ 回 467 行 |
| `explainer-remotion-props.js`（527 → 510 行） | ① `buildTerminalSteps` 挪进 **`explainer-programmatic-assets.js`**；② 「程序化素材 → cut 字段」的映射抽成 **`explainer-programmatic-cut.js`**（86 行）⇒ 回 **482** 行 |

⇒ 债务预算 `filesOver500` 因此**自动回到基线 95**（未改基线数值）。

### CI 阻塞与处置（透明记录）

- 首轮 CI：`QG Desktop Shards (1/2)` 红在**桩的路由特征串守卫** ⇒ 根因是**把提示词常量抽到新文件后，守卫的扫描域没跟着更新** ⇒ 补上（守卫的「域」搬家必须同步）。
- 次轮 CI：`QG Desktop Shards (2/2)` 红在 `title-card-renderer` 的两条真渲染用例 ⇒ **与本片零关系**（本片的真渲染用例在同一台 Windows runner 上**全部通过**；该文件本片一行未碰）⇒ 根因是 Windows runner 缺 fontconfig ⇒ 已在「修复 ⑩」里改实现修掉（CI 里那两条用例就是验证器）。

### E2E 端到端验收读数（真实跑通）

- 流水线 **8 阶段全 `completed`**，`render_runtime_used='remotion'`、`render_runtime_requested=null`、`render_fallback_reason=null`（**未回落**）
- 成片：**1920×1080 / h264+aac / 87.3 秒 / 21,561,448 B**；**mean_volume −23.2 dB**（真人旁白，远高于数字静音 −91 dB）
- **程序化素材在真实流水线里产出**：`asset-scene-4-diagram.png` **43,623 B**（3 个节点、中文正常无豆腐块、主题色与 Remotion 合成器一致）
- ⚠ **首轮 E2E 暴露的缺陷**：素材产出了但**成片里看不见**（见「修复 ⑨」）⇒ 第二轮改接线后再跑才真正上屏
- 耗时 **23~32 分钟**（Remotion 1080p 渲染本身占绝大部分；程序化素材单张仅 0.1~0.3 秒）
- ★ **第二轮 E2E 才真正上屏**：第一轮素材**产出了但成片里看不见**（「`cut.source` 只是媒体兜底分支，
  卡片类组件抢先匹配」）⇒ 修法是示意图改走**媒体型 cut**（`anime_scene` + `cut.images`）⇒
  抽帧复核：那一镜是**整屏示意图**（标题 + 3 个节点框 + 连接线），且**词级高亮字幕**照常在下方。

### 遗留（不假装已闭合）

- **`math_animate` / `music_gen` / `video_selector` 本版未实现** ⇒ 场景声明了会**如实登记** `PROGRAMMATIC_TOOL_UNSUPPORTED` 并回落（功能名义存在、实际未接）⇒ 后续 P6 的候选。
- **素材声明由 LLM 产出 ⇒ 可能不准**（讲稿说"流程"但 LLM 填了 `image_selector` ⇒ 不生成图）⇒ 本版**不做**声明纠错（属 P3 审批门的关注点：人审"这一镜该用什么素材"）。
- **画布硬编码 1280×720**（`Explainer` 本身也硬编码 1920×1080）⇒ 竖屏/动态尺寸属 P5c。
- **代码片段图不含完整语法高亮**（ffmpeg drawtext 无着色能力）⇒ 只做「注释行 vs 代码行」两类着色 ⇒ 视觉比上游 Pygments 朴素。
- **不改变 AI 生图的触发** ⇒ 声明了程序化素材的镜次**仍会生一次 AI 图**，但该图**不参与画面**（程序化素材是主体）⇒ **这一次生图是浪费的**；「按声明跳过生图」需改内置 `story2video_generate_assets` 的输入契约 ⇒ 未做。
- **上游那四个 Python 工具仍无 HTTP 通路**（`/api/skills/*` 不存在）⇒ 本版走桌面端 Node + ffmpeg 等价物；**若将来打通 Python 通路**，可把 `math_animate` 等接进来（P6）。

## CHANGELOG 条目

# feat(视频创作): AI 讲解视频支持程序化素材 —— 场景可声明素材需求，示意图/代码片段真的被生产并进入成片（explainer-programmatic-assets）
