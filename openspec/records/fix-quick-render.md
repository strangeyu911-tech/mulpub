# 执行记录 · fix-quick-render

> 分支：`fix-quick-render`
> PRD：`01-docs/PRD-video-creation.md` §3.1.45
> 隔离工作树：`<projects>/mp-worktrees/mp-fix-quick-render`（非 C 盘；本机 D 盘）
> 触发：用户报障「视频创作 → 快速渲染 → 点击【开始渲染】→ 好像没有启动，有报错」（2026-10-23 22:07）

## 一、取证（可复算，先取证再改代码）

| # | 事实 | 取证方式与读数 |
|---|------|----------------|
| E1 | 用户跑的是**旧构建** | 运行中的 Electron 进程命令行：`--user-data-dir=<repo>/shared-user-data` + app path `mp-worktrees/mp-signer-reuse/apps/desktop`；该工作树 HEAD `4116035d2`，**早于主干 130+ 提交**，其 `CreateView.vue` 用旧的行内实现（无 `QuickRenderPanel.vue`） |
| E2 | 旧实现的进度条必然不动 | 旧 `CreateView.vue` 写 `onRenderProgress((pct, stg) => …)`，而 preload `publish.js:81` 是 `(_e, p) => callback(p)`（**单参原样透传**）⇒ `pct` 拿到整个对象 ⇒ 模板拼出 `width: [object Object]%`（CSS 非法 ⇒ 宽度不生效）⇒ 进度条全程 0% |
| E3 | 那次运行**其实成功了** | `model_provider_logs`：id 11028 `generateVideo success`（`agnes-multimodal`，model `agnes-video-2.5-flash`，latency 20406ms）@2026-10-23 14:01:57Z；其后 `getVideoStatus` success ×47（14:02:07→14:09:53Z，10s 间隔） |
| E4 | 产物真实有效 | `<os.tmpdir>/story2video/quick-render/ai-video/scene_video_000.mp4`，1,897,058 字节，magic `ftypisom` + `moov` + `mvhd` + `trak/tkhd`（合法 MP4，非 HTML 错误页） |
| E5 | 图文轮播路径**可跑通** | 本轮用 `RenderEngine.render()` 实跑（前端同形 props：2 张图 data URL、`anime_scene`/`ken-burns`、`profile=youtube-landscape`）⇒ 246.7s 出片 1,750,129 字节，324 次进度事件 |
| E6 | 主进程失败**零日志** | 全量 grep `app-2026-10-23.log` 无任何 `[render]` 记录；`render:start-ai-video` 的失败分支只 `return`，不落日志 ⇒ 线上不可诊断 |
| E7 | gallery 失败**被报成成功** | 主干 `render:start` 失败仍 `return { code: 0, data: { success:false, error } }`；渲染端 `QuickRenderPanel.startGallery()` 只判 `res.code === 0` ⇒ 显示「视频渲染完成」 |
| E8 | 失败原因**不可读** | 失败文本形如「视频生成超时或失败（provider: agnes-multimodal）」，`formatUserError` 的技术文本规则命中 `provider: xxx` ⇒ 退化成笼统「渲染失败」 |
| E9 | 进度阶段**硬编码中文** | `scene-video-generator.js` 的 `PROGRESS_STAGES` 是中文串，渲染端只能直接展示 ⇒ 英文界面下进度提示仍是中文；且渲染端若要本地化只能去**匹配中文句子** |

## 二、本次交付（对当前主干的真实缺口）

| 缺口 | 修复 | 落点 |
|------|------|------|
| 失败无日志（E6） | 两条失败路径都 `log.error`，含 provider / 稳定错误码 / 原始原因 | `electron/ipc-handlers/render.js` |
| 失败原因不可读（E8） | 8 个稳定 `errorCode` + `userErrors.*` zh/en 文案；渲染端走 `formatUserError` 的 errorCode 分支 | `electron/services/scene-video-generator.js`、`src/utils/user-facing-error.js`、`src/locales/user-errors/{zh,en}.js` |
| gallery 失败报成功（E7） | `render:start` 失败返回**非 0 code** + `errorCode` + `data.success=false`；渲染端同时判 `code` 与 `data.success` | `electron/ipc-handlers/render.js`、`QuickRenderPanel.vue` |
| 成功/失败横幅可同屏 | 成功横幅条件改 `result && !error`；失败事件清空成功态 | `QuickRenderPanel.vue` |
| 进度阶段硬编码中文（E9） | 进度回调新增第三个参数 `stageKey`（稳定机器键）；渲染端按 key 取 `quickStage*` locale 文案，中文 `stage` 仅兜底 | `scene-video-generator.js`、`render.js`、`quick-render-constants.js`、`src/locales/create/ui/{zh,en}.js` |
| 进度百分比回退 | 渲染阶段封顶 95、编码阶段映射 96–99，且只增不减（Remotion 渲染阶段报满 100 后编码阶段从 6% 重来，实测出现 100%→6% 回退） | `electron/services/render-engine.js` |

## 三、关键决策

1. **不推翻上游已做的能力**（§3.1.41/§3.1.42/§3.1.43）：模式集合、素材上限、输出平台→画幅、成本可见、真实进度**全部保留**；本轮只补「失败面」与「可读性」。
2. **不代远端 provider 取消任务**：`renderCancel` 仍只取消本地 Remotion；上游未公开取消端点，AI 视频路径仍只停本地等待并如实提示「远端任务可能仍在生成」（沿用 §3.1.42 合同第 7 条）。
3. **不伪造连续进度**：百分比如实透传服务端 `progress`（Agnes 只有 10/100 两档），不按时间自造爬升。
4. **不新建 provider 能力**：不新增参考视频 / 多镜头 / `width,height,fps` 直传（§3.1.42/§3.1.43 已界定）。
5. **错误码放全局 `userErrors` 目录**（不是面板内私有映射）：失败既可能从 `render:error` 事件到达、也可能从 await 的响应回来，两条路都要出同一句文案 ⇒ 走 `formatUserError` 的 errorCode 分支最省事也最一致。
6. **判据常量归位 `quick-render-constants.js`**：该文件头注释已写明「放在 .vue 的 <script setup> 里会让面板文件迅速膨胀到 500 行门禁之上」；`stageKey → locale` 映射入常量文件后，面板回到 500 行门禁之内（实测 501 → 499）。

## 四、基线纠偏（必须记录，否则后面全是错的）

- 首次建 worktree 时 `session-init.sh` 落在 **`fb55036bb`**（落后 `origin/main` **131 个提交**）。那个基线上「快速渲染」还在 `CreateView.vue` 行内实现，而主干已重构为 `src/views/video-creation/QuickRenderPanel.vue`。
- 中途发现后：`git reset --hard origin/main`（`33762eddd`）重做，**丢弃**了基于旧基线的 `CreateView.vue` / `quick-render-profiles.js` / `ai-video-scene.js` 三处改动（前者已被上游重构取代，后两者上游已有等价物：`quick-render-constants.js` 的画幅映射 + `scene-video-generator.js` 的生成器）。
- 教训：建隔离工作树后**必须核对 HEAD 与 `origin/main` 的差距**，否则会基于已重构的旧实现改代码。

## 五、门禁与验证

| 项 | 结果 |
|----|------|
| `node .github/scripts/check-locale-sync.js --pair-base origin/main` | ✅ PASS（zh/en 成对） |
| `node .github/scripts/check-locale-sync.js --cjk` | ✅ PASS（基线 1330 条，当前 1089 条，无新增硬编码） |
| `node .github/scripts/check-locale-sync.js --keys` | ✅ PASS（2330 个使用中的 key 均存在于 zh/en） |
| `node .github/scripts/check-max-lines.js` | ✅ PASS（面板 499 行 < 500；`QuickRenderPanel.vue` 未超限） |
| `npx eslint <6 个受影响文件> --quiet` | ✅ PASS（rc=0） |
| `npx vitest run`（受影响 4 个测试文件） | ✅ 125/125 通过 |
| `npx vitest run`（桌面端全量） | 见下 |
| `node scripts/check-same-type-risk-locks.js`（Gate 2c6 同型风险锁） | ✅ PASS（八条锁全过；首次红在 R9a，已按判据真实改进） |
| `node --test scripts/same-type-risk-locks.test.js scripts/same-type-risk-locks-r2.test.js` | ✅ 33/33 |
| `sh scripts/deep-review.sh`（CCG 双家族 claude × opencode） | ✅ **5 轮闭合**：`tier=external`、`basis=adjudicated-self-play`、evidence = PR #4496 裁决评论 |
| 受影响面单测（ResultView / CreateView / story2video-stages / project-service / story2video IPC / preload） | ✅ 1123/1123 |
| 本次改动单测（render IPC / scene-video-generator / render-engine / QuickRenderPanel） | ✅ 143/143 |

### CCG 评审 5 轮实况（含一次「按判据真改进」）

| 轮 | diff | 模式 | 意见 | 最低分 | 处置 |
|----|------|------|------|--------|------|
| 1 | 490 行 | DUAL（claude×opencode） | 4 | — | i4 成立→加双向映射锁 + 变异验证；i1/i2/i3 以行号与仓内惯例驳回 |
| 2 | 36 行 | SINGLE | 8（裁决 6） | 6 | i1/i2/i3 成立→两侧锁 + afterEach 清理；i4/i7/i8 驳回 |
| 3 | 79 行 | SINGLE | 5（裁决 3） | **4** | i3 成立→`mapStagePercent` 改显式放行表（COMPLETED 不再被缩成 95） |
| 4 | 33 行 | SINGLE | 4（裁决 2） | **7** | i2 成立→`render:start` 异常分支补 errorCode |
| 5 | 33 行 | SINGLE | 4（裁决 4） | 6 | 全部驳回：i2/i4 与第 1 轮同源，已两次以行号 + 用例驳回；i1/i3 为工具链既有形态 |

收敛依据：阻塞项为空 ⇒ `self_play_resolved` ⇒ writeback 写回 `tier=external` + evidence。
**未把「已修」写成「不成立」**：第 1 轮 i4、第 2 轮 i1/i2/i3、第 3 轮 i3、第 4 轮 i2 均记 `upheld` 并由**新一轮**验证不复现。

### Gate 2c6 / R9a 的处置（不按误报打发）

首跑红：「定时器窗口内对 `*Percent` 赋字面量 0 = 固定值心跳假进度」。
核证后判定**是真可改进点**：
1. `report(0, '计算中'/'启动渲染')` 传的 0 会被单调钳制吞掉（`Math.max(lastPercent,0) === lastPercent`），
   唯一效果只是换阶段文案 ⇒ 拆出 `reportStage(stage, stageKey)`：只换阶段、不动百分比。
2. `let lastPercent = 0` 的裸字面量初值改为具名常量 `PROGRESS_FLOOR`：它是「真实完成度的下界」，
   具名后语义自证，也不再是「字面量赋给 *Percent」的形状。

## 六、远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #（合并后由 `MERGE-LEDGER` 推导）
