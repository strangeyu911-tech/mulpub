---
record: explainer-remotion-animation
task: 把「AI 讲解视频」的「AI 生成」模式画面从「AI 生图 + 图片轮播」改为上游 animated-explainer 的「Remotion 程序化动画」
date: 2026-10-25
branch: explainer-remotion-animation
---

## 本次执行记录：AI 生成模式对齐上游 animated-explainer（explainer-remotion-animation，2026-10-25）

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码（新增合成层 + 改 compose 阶段执行器）⇒ 隔离 worktree `/workspace/mp-worktrees/mp-explainer-remotion-animation`、裸分支 `explainer-remotion-animation`，基线 = P2b tip `62bb4ae549d12dc8a8d7d6a058e268f1547c0035`（**P2b 的最新 tip**，含 inputFrom 修复与反向锁独立成文件两个 commit） |
| 第一性原因（QM-5 ①） | ✅ | 上游 animated-explainer 的画面主体是 **Remotion 程序化动画**（`Explainer.tsx` 的 `ExplainerProps.cuts` 直接当渲染指令；12 种 cut type：text_card/stat_card/hero_title/callout/comparison/bar_chart/line_chart/pie_chart/kpi_grid/progress_bar/anime_scene/terminal_scene/screenshot_scene）；**AI 生图只是 assets 阶段的 `image_selector` 之一，可作背景层**。而本仓的画面是「每镜 AI 生图 + ffmpeg 图片轮播 + zoom-in」⇒ 不是「文字推理 LLM 生成动画类讲解视频」。且 Mulpub 早把上游 Remotion 合成器**逐字移植**了（`packages/remotion-composer/src/` 与上游几乎相同，`composition-manager.js:15` 已注册 `id:'Explainer'`，`render.js:55` 有 `renderEngine.render(props,{profile})` 入口）⇒ **缺的是接线，不是能力** |
| 逃逸分析（QM-5 ②） | ✅ | ① **「上游契约 1:1」≠「上游机制 1:1」**：P1/P2a/P2b 把 14 个 schema 与五阶段产物都对齐了，但**表现层完全没动**⇒ 契约对了、画面还是轮播。② **两套 type 词表**：上游 `scene_plan` 的 9 种**叙事型** type ≠ Remotion 的 12 种**渲染型** type ⇒ 中间必有一层映射（上游放在 Edit 阶段，`scene-director.md:71-74` 明写「the Edit stage converts that intent into `cut.type`」）。③ **照抄 schema 也会抄错**：上游自己的 `edit_decisions.schema.json` 的 cut 是 `additionalProperties:false` 且**没有 `type`**，但 `video_compose.py:790` 真读 `cut.get("type")` ⇒ 上游 schema 落后于其运行路径。④ **「上游原生支持第二个入参」被忽略**：`video_compose.py:1954` 的 `composition_data = inputs.get("edit_decisions") or inputs.get("composition_data")` ⇒ 扩展 schema 是不必要的自找麻烦。⑤ **rc≠0 ≠ 产物无效**（上游实测：CLI 抛 TimeoutError 但 mp4 完全有效）⇒ 只读 rc 会把一次成功报成失败。⑥ **回落的静默降级**：Remotion 未装时若悄悄走图片轮播，用户与排查者都看不出「这次没走动画」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `services/explainer/explainer-remotion-props.js`（合成层，纯函数，**零依赖**）：三级 cut type 判定（素材声明 → 文本线索 → 叙事兜底）+ 各 type 专属字段（照上游 `remotion.md:47-63` 字段表）+ 画面文字取法（旁白首句 → 描述 → information_role）+ props 顶层 `{version,theme,cuts,overlays,captions,audio}`（与上游 demo 样本同形）+ **五项数据校验**（NO_SCENES / UNKNOWN_CUT_TYPE / CUT_TIME_INVALID / CUT_TIME_NON_POSITIVE / NO_CUTS，**任一不过即不产出 props**）。② 改 `services/explainer/explainer-review-stages.js` 的 compose 阶段：**Remotion 优先**（`new RenderEngine().render(props,{profile})`）→ 失败回落 ffmpeg 轮播（**带 `inputFrom:'assets'`**）→ 回落**可见**（输出带 `render_runtime_requested` + `render_fallback_reason`）→ `final_review` 的 `render_runtime_used` **如实上报实际 runtime**。③ 产物探测（ffprobe/抽帧/响度）与 `render_report`/`final_review` 沿用 P2b，不重复实现。④ 新增 `explainer-remotion-props.test.js`（**21 例**） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **不动任何 1:1 schema** ⇒ P1 的 sha256 门禁不受影响（这是本片最关键的一条设计约束）。② **判定顺序写进代码注释**（素材声明压过文本线索；显式图表名压过泛化词）⇒ 防止后来者「优化」判定顺序导致 pie/bar 互换。③ **画面文字与画面描述分离**（`cut.text` ≠ `scene.description`）⇒ 防止把给生图用的描述当画面文字。④ **数据不足降级为文字卡**（不给半截图表）⇒ 防止渲染出空图表。⑤ **回落可见**（不静默降级）。⑥ **产物有效性判据**（rc≠0 时**先看已落盘的产物本身**能不能播 ⇒ ffprobe 有视频流且时长 > 0 ⇒ 判成功；**不是**看引擎状态里有没有路径 —— `getStatus()` 永远不含 outputPath，那条路是死代码）⑦ **混轨与画面是一对**（Remotion 只出画面 ⇒ 旁白必须另混一条轨再 mux ⇒ 混音失败宁可回落 ffmpeg 轮播，也不交付静音片） |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（下详） |
| **CI 首轮红（主干级 vs 本 PR 级）** | 待填 | 首次 push 后填写（本轮已推过一次 head `4257ff81`；随后因「读代码抓到三个真缺陷」补了修复 commit ⇒ **CI 需按新 head 重跑**） |
| 接线棘轮 | ✅ | 新增 `explainer-remotion-props.test.js` 落在 vitest include 的 `electron/services/**/*.test.js` 白名单内（**无需改 vitest.config.js**）；`scripts/check-unwired-tests.js` 实测 PASS |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | QM-1：改的是 `apps/desktop/electron/services/explainer/explainer-review-stages.js` 的**既有文件**（**运行时代码**）⇒ **不适用 N/A** ⇒ 由 CI 的 `build` job（windows-latest + `electron-builder --win --x64`，required check）兜底。QM-4：**零 UI 变化**（画面形态自动切换，不新增控件/文案/i18n 键）⇒ 无视觉面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`） |

### 本地验证读数

- **vitest 188/188 全绿**（9 个文件：`explainer-prod-artifacts` 63 + `explainer-remotion-props` 26 + `explainer-artifacts` 22 +
  `artifact-schema-validator` 31 + `explainer-remotion-render` 13 + `explainer-narration-track` 9 +
  `explainer-remotion-compose-wiring` 6 + `render-engine` 16 + `explainer-stage-type-isolation` 2）。
- **变异验证 4 组全部被抓住**（逐条打回原形后必红）：① 「CLI 报失败但产物有效 ⇒ 成功」改回失败 ⇒ ★ 那条红；
  ② 去掉 runId 消毒 ⇒ 消毒那条红；③ 产物无效也判成功 ⇒ 3 条红；
  ④ `resolveSceneSource(context).plan` 改回 `asObject(context.scene_plan)` ⇒ **接线锁 4 条红**。
- **Remotion 真跑通**（本机实测）：`remotion render src/index.tsx Explainer` 出片 **1920×1080 / 30fps / h264+aac / 11.051 秒 / 1,022,813 B**，
  抽 3 帧确认是**真程序化动画**（`hero_title` 卡片 / `stat_card` 「+38% 同比增速」/ `bar_chart` 带动画柱）。
  浏览器由 Remotion 自动下载到 `packages/remotion-composer/node_modules/.remotion/`（**已被 gitignore**）⇒ 用户侧开箱可用，无需改代码。
- `eslint electron/services/explainer/` rc=0
- `check-max-lines` / `check-no-hot-carrier-edit` / `check-no-brand-residue` / `check-unwired-tests` / `check-debt-budget` / `check-text-encoding-integrity` / `check-locale-sync --cjk` 全 PASS

### 新增/修改清单

| 文件 | 动作 | 行数影响 |
|---|---|---|
| `apps/desktop/electron/services/explainer/explainer-remotion-props.js` | **新增**（合成层：cut type 判定 + 各 type 字段 + props 组装 + 六项数据校验） | +约 430 |
| `apps/desktop/electron/services/explainer/explainer-remotion-props.test.js` | **新增**（26 例） | +约 290 |
| `apps/desktop/electron/services/explainer/explainer-remotion-render.js` | **新增**（产物有效性判据 + 产物路径消毒 + 有界等待） | +201 |
| `apps/desktop/electron/services/explainer/explainer-remotion-render.test.js` | **新增**（13 例） | +168 |
| `apps/desktop/electron/services/explainer/explainer-narration-track.js` | **新增**（按上游分段语义合成旁白轨 + mux） | +284 |
| `apps/desktop/electron/services/explainer/explainer-narration-track.test.js` | **新增**（9 例：5 例纯逻辑 + 4 例真 ffmpeg） | +213 |
| `apps/desktop/electron/services/explainer/explainer-remotion-compose-wiring.test.js` | **新增**（6 例：compose → Remotion 接线锁） | +134 |
| `apps/desktop/electron/services/explainer/explainer-remotion-media.js` | **新增**（本地媒体 staging：拷进 public 目录 + 改成相对文件名；上游 `_stage_remotion_media` 的等价物） | +约 175 |
| `apps/desktop/electron/services/explainer/explainer-remotion-media.test.js` | **新增**（8 例） | +约 140 |
| `apps/desktop/electron/services/explainer/explainer-review-stages.js` | 改：compose 阶段 Remotion 优先 + **混轨 mux** + **渲染前过合成器契约校验** + 如实回落 + `render_runtime_used` 如实上报 | +约 230 / −约 25 |
| `apps/desktop/electron/services/render-engine.js` | 改：Remotion CLI 子进程加 `ELECTRON_RUN_AS_NODE=1`（**缺陷⑤**；不改这一处，打包版渲染 100% 失败）+ 支持 `publicDir` ⇒ `--public-dir`（**缺陷⑥**） | +约 28 |
| `apps/desktop/electron/services/render-engine.test.js` | 改：新增 `buildRemotionSpawnEnv` 三例 | +约 20 |
| `apps/desktop/electron/services/composition-manager.js` | 改：`validateProps` 补字幕形状断言（**缺陷④**的共享防御） | +约 20 |
| `packages/remotion-composer/src/props-validator.ts` | 改：补字幕形状断言（合成器侧同一份防御） | +约 15 |
| `apps/desktop/tests/e2e/e2e-run-remotion.js` | **新增**（沙箱版 E2E 运行器：Xvfb + provider 桩 + 桌面端 + E2E 一条命令） | +约 210 |
| `01-docs/PRD-video-creation.md` | 改：新增 §18（18.1~18.11） | +约 340 |

### 本轮修掉的三个真缺陷（读代码时抓到 ⇒ 全绿也不代表功能生效）

⚠ 三个都**不报错、只静默降级** ⇒ 「单测全绿 / CI 全绿」与「功能真的生效」是两件事。
详细口径见 PRD §18.10。

| # | 缺陷 | 后果 | 修法 | 锁 |
|---|---|---|---|---|
| ① | 场景来源读 `context.scene_plan`（本仓实际是 `context.scenes`） | **Remotion 路径永远走不通**（每次回落 ffmpeg ⇒ 功能等于没做） | 改走 `resolveSceneSource(context).plan`（与 P2b 同一真源） | `explainer-remotion-compose-wiring.test.js` ★ 那条 |
| ② | 「CLI 报失败但 mp4 有效」的恢复路径是**死代码**（`render()` 从不 reject 且不带 outputPath；`getStatus()` 永远不含 outputPath） | 上游实测形态一律判成失败 ⇒ 静默回落 | compose **显式指定 outputPath** + **以产物有效性判定成败**（ffprobe）+ 失败后**有界等待**产物落盘 | `explainer-remotion-render.test.js` ★ 那条 |
| ③ | Remotion 只出**画面**；旁白是 `edit_decisions.audio.narration.segments`（只有 asset_id），而合成器只认 `audio.narration.src` | **成片没有旁白**（交付静音片，比不做更糟） | 新增 `explainer-narration-track.js`：按 segments 的 `start_seconds` 合成旁白轨（间隙 `anullsrc` 补静音）→ mux 到画面（`-map 0:v:0` 丢掉 Remotion 自带静音轨）；**混音失败 ⇒ 回落 ffmpeg 轮播**（不交付静音片）并登记 `render_fallback_reason` | `explainer-narration-track.test.js`（真 ffmpeg 验时间轴对齐 + 非静音 + mux 后有音频流） |

### E2E 真实复跑才暴露的三个缺陷（读代码看不出来）

⚠ 共同形态：**错误发生在另一个进程里** ⇒ 本仓只看到「退出码 N」或一段被截断的 React 栈。
详细口径见 PRD §18.11。

| # | 缺陷 | 后果 | 修法 | 锁 |
|---|---|---|---|---|
| ④ | 字幕给的是句级 `{text, start_seconds, end_seconds}`，而合成器 `CaptionOverlay` 吃**词级** `{word, startMs, endMs}` | `fromFrame = Math.round(undefined/1000*fps)` = **NaN** ⇒ `<Sequence from={NaN}>` ⇒ **渲染期崩在 bundle 里**（exitCode=1） | 字幕改词级（切分**复用仓内单源** `story2video-segmentation`）+ 合成层 `CAPTION_SHAPE_INVALID` fail-closed + 渲染前过 `composition-manager.validateProps` + 两处共享校验器补字幕断言 | `explainer-remotion-props.test.js`「★ 字幕必须是词级」+ `buildCaptionWords` 三例 |
| ⑤ | `spawn(process.execPath, cmd)` ⇒ Electron 主进程里 `process.execPath` 是 **Electron 可执行文件** ⇒ Electron 把 Remotion CLI 当**自己的应用**启动 ⇒ root 下 FATAL（`Running as root without --no-sandbox`，exitCode=133） | **打包版用户机器上 Remotion 渲染 100% 失败**（不是沙箱专属） | `ELECTRON_RUN_AS_NODE=1` ⇒ 同一可执行文件以纯 Node 语义运行（Electron 自带 Node ⇒ 不需要外部 node / npx） | `render-engine.test.js` 的 `buildRemotionSpawnEnv` 三例 |
| ⑥ | 本地媒体**绝对路径**在 Remotion 里不可用（只认 public 目录里的相对文件名） | 渲染期抛 `staticFile() does not support absolute paths`（exitCode=1 + React 栈） | 新增 `explainer-remotion-media.js`（上游 `_stage_remotion_media` 的等价物：复制进 public 目录 + 改成纯文件名）+ `render-engine.js` 支持 `publicDir` ⇒ `--public-dir` + 镜像合成器自带 `public/`（上游 `_mirror_public_dir` 同款）+ `file:` URI 按上游 `urlsplit` 语义还原 | `explainer-remotion-media.test.js`（8 例） |

### E2E 复跑读数（**两条路径都真跑过**）

**① Remotion 主路径**（`render_runtime_used = 'remotion'`）

| 判据 | 实测 |
|---|---|
| 流水线状态 | 8 个阶段全 `completed`（research→proposal→script→scenes→assets→editing→compose→publish） |
| `renderRuntimeUsed` | **`remotion`** |
| `renderRuntimeRequested` / `renderFallbackReason` | `null` / `null` ⇒ **未回落** |
| 成片路径 | `/tmp/story2video/explainer/<runId>/explainer_output_narrated.mp4`（**只有 Remotion 分支产出这个路径**） |
| 规格 | **1920×1080 / h264+aac / 30fps / 87.3 秒 / 23,158,829 B** |
| 响度 | **mean_volume −23.2 dB / max −2.9 dB**（真人旁白水平；数字静音约 −91 dB） |
| 抽 4 帧 | 开场大标题卡 + `section_title` overlay + 粒子层 + **词级高亮字幕**（青色高亮）⇒ **是程序化动画，不是 AI 生图轮播** |
| AI 生图定位 | 出现在**背景层**（`cut.backgroundImage`）⇒ 与上游一致 |
| 耗时 | **31 分钟**（3 GB / 无 GPU 沙箱；ffmpeg 轮播那条路 9 分钟 ⇒ **Remotion-first 的代价是时延**，已记入 PRD §18.9） |

**② 回落路径**（人为让 Remotion 不可用：`REMOTION_COMPOSER_DIR` 指向不存在的目录）

| 判据 | 实测 |
|---|---|
| 流水线状态 | 8 个阶段全 `completed` ⇒ **仍出片** |
| `renderRuntimeUsed` | **`ffmpeg`** |
| `renderRuntimeRequested` | **`remotion`** |
| `renderFallbackReason` | **非空且可读**：「Remotion 渲染失败：Remotion 渲染引擎未就绪: Cannot find module '@remotion/cli/package.json'」 |
| 成片 | 1280×720 / h264+aac / 73.93 秒 / 6,717,060 B |
| 耗时 | 9 分钟 |

⚠ **回落是「可见」的**：产物同时带 `render_runtime_requested='remotion'` + `render_fallback_reason`（非空）
⇒ 用户与排查者一眼能看出「这次没走动画、为什么」。




## CHANGELOG 条目

# feat(视频创作): AI 讲解视频「AI 生成」模式改为上游 animated-explainer 的程序化动画 —— 画面从图片轮播变成标题卡/数据卡/图表（explainer-remotion-animation）

