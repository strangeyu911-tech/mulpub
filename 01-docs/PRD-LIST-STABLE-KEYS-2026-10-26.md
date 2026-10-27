# PRD：列表稳定键收敛第二批（审计 4.8 `:key` 半边）

- 日期：2026-10-26
- 分支：`ux-audit-stable-keys-2`
- 审计来源：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 4 · 4.8（「38 处 index 作 `:key` 改稳定键」）
- 首批：2026-10-20 分支 `ux-audit-stable-keys`（该轮把清点读数修正为 **43 处**，落 1 处真缺陷 + 2 处卫生项 + 1 处启发式假阳；其 PR 未合并，本批**不复用它的工作树**，只复用其判归方法）

## 1. 问题：index 作 `:key` 到底坏在哪

Vue 用 `:key` 判定「这个节点是不是原来那个」。用下标当键时，键的含义是**位置**而不是**身份**，于是：

- 删掉列表第 0 项后，原第 1 项拿到键 `0`，Vue 就把**原来渲染第 0 项的那个 DOM 节点**原地改内容交给它；
- 该节点上凡是**模型不拥有的状态**都跟着位置走而不是跟着项走 —— 焦点与光标位置、输入框撤销栈、IME 合成中的半截拼音、被 JS 直接改过的 `style`、子组件内部局部态、`<TransitionGroup>` 位移动画的起点；
- 轮询/推送型列表（每次整体替换快照）与**头部裁剪**型列表（`logs.slice(-500)`、`unshift` + `slice(0,20)`）会让**所有**下标整体位移，于是每一轮刷新都等价于一次全列表重排。

用户侧症状形如：「删掉上面一行，我正在打的下一行光标没了／半截拼音没了」「日志滚动时行内的展开状态串到别的行上」。

## 2. 本批的判归：只改「身份字段可证存在」且「会局部变化」的站点

两条判据必须同时成立：

1. **列表会局部变化**（删除中间项 / 轮询整体替换 / 头部裁剪 / 网格长度变化 / `<TransitionGroup>`）。静态骨架屏与「`v-if` 守卫下一次性整体赋值 + 纯文本项」不满足 ⇒ 不改（index 键与稳定键渲染等价，改动只增加像素回归面）。
2. **所选身份字段可证存在**——判据取「该字段已被同一模板消费，或在数据生产端被显式写入」。凭字段名猜测会造出恒 `undefined` 的键（Vue 退化成无键）或**重复键**（`Duplicate keys found during update`，复用行为不可预期）。

这一条当场排掉三族看起来能改的站点，正解都是**给行入列时补 `uid`**（数据形状变更，另案）：

| 排除项 | 事实 |
| --- | --- |
| `views/CreateHistory.vue` 的 `renders` / `pipelines` | 逐行读过：模板读取的是 `outputPath / composition / name / status / completedAt / startedAt / createdAt / stages / pausedStage`，**从未读 `r.id` 或 `p.id`** |
| `views/video-creation/QuickRenderMaterials.vue` 四族素材、`views/film-auto/FilmAutoPanel.vue` 的 `r.path + i` / `p + i` | 元素是 `{name, dataUrl, size}` 或裸路径串，入列**无去重** ⇒ 同一文件选两次可完全同值；现写法把下标拼进键虽会串味，但至少不撞键 |
| `views/CreateView.vue` 的 `s2vBatchTexts` | 元素是裸字符串且合法值就是空串，全 `''` 会立刻撞键 |

## 3. 本批收口的 9 处（逐条判据）

| # | 文件 | 原键 → 新键 | 身份字段出处（可证存在） | 为什么会局部变化 |
| --- | --- | --- | --- | --- |
| 1 | `components/AnnouncementBanner.vue` | `'ann-' + i` → `dismissKey(a)` | 同文件 `dismissKey()` 已是**持久化到 localStorage 的「已忽略」Set** 的键口径 | 关闭一条公告后中间项直接消失；键与「已忽略」判据本就是两套口径 |
| 2 | `components/BoardStageIndicator.vue` | `i` → `stage.name \|\| stage` | 同模板 `friendlyName(stage.name \|\| stage)` | `stages` 由 `stores/backlot.js` 收 IPC 推送整体替换；`ReplayTimeline` 拖时间轴也换整份数组 |
| 3 | `components/SceneCard.vue` | `i` → `take.id \|\| take.thumbnail \|\| take.url \|\| take` | 兄弟视图 `ContactSheetView.vue:54` 对**同一个** `scene.takes` 用 `:key="take.id"`；本模板已在读 `take.thumbnail \|\| take.url \|\| take` | `displayedTakes = takes.slice(0,3)`，`takes` 随 live board 推送整体替换 |
| 4 | `views/AutoPipelineView.vue`（URL 芯片） | `i` → `u` | 元素本身就是 URL 串；入列前 `if (!config.urls.includes(u))` 保证唯一 | 芯片带 `×`，`removeUrl(i)` → `splice(i,1)` |
| 5 | `views/AutoPipelineView.vue`（阶段卡） | `i` → `stage.id` | 生产端 `electron/services/full-auto-pipeline.js:199` `stages: STAGES.map((id) => ({ id, ... }))`，快照 `:717/:775` 用 `{...s}` 保留 | 1.5s 轮询 `currentRun.value = snapshot` |
| 6 | `views/Calendar.vue` | `i` → `day.dateStr` | computed 里逐元素写入 `dateStr`；选中态判据本就是 `selectedDate === day.dateStr` | 翻页/换年时网格长度在 35/42 之间变化 |
| 7 | `views/PromptEvalView.vue`（缩略图） | `i` → `img.url` | 入列时 `url: URL.createObjectURL(file)`，每个 blob URL 天然唯一 | `removeImage(index)` → `splice(index,1)` |
| 8 | `features/collection/BatchCollectPanel.vue`（收藏列表行） | `it.url + idx` → `it.url` | 勾选态 `zhihuFavChecked` 这个 Set **就是按 `it.url` 存**；把 `idx` 拼进键纯属噪声 | 筛选/重新加载后整批替换 |
| 9 | `views/FilmEngineeringView.vue`（批次内镜头行） | `si` → `sh.shotId \|\| si` | 同一文件 `:108` 已用 `:key="s.shotId"`；本行 `:395` 就在截断显示 `sh.shotId`；`(sh.shotId \|\| "")` 说明存在空值 ⇒ 保留 `si` 兜底 | 批量出片逐条改状态，行内有「重试」按钮 |

**键表达式口径**：允许 `稳定值 || 下标` 的**兜底位**写法（第 9 处），禁止 `下标 || 稳定值`（下标仍在主键位，等于没改）。该区分由锁的判据持有，并被两条绿控（G1/G2）钉住「不过度收紧」。

## 4. 数据校验与显示影响

- 不改任何可见文案、布局、样式；键表达式不进 DOM ⇒ 渲染结果在列表不局部变化时与改前逐字相同；
- 像素门禁预期中性（无几何/颜色变化），无需刷新基线；若 Gate 7b 报某视图 stale，按「基线只取同一次 CI 渲染」的既有口径处理，禁止 `--update-baseline`；
- 逐行核对：9 处均为**同一行内**的表达式替换，`git diff --stat` 为 `8 files changed, 9 insertions(+), 9 deletions(-)`，净增行 0 ⇒ 不触碰 `check-max-lines` 的 500 行熔断与点名还债清单。

## 5. 验收标准

1. `apps/desktop/src/list-stable-keys.test.js` 全绿：10 条结构合同（9 站点 + 1 条「扫描域非空」反失明）+ 2 条真挂载行为锁。
2. 行为锁必须**可判别**：把第 2 处键退回 `i` 时两条行为锁一起变红——它证的是「DOM 节点对象身份」，不是字符串出现。
3. 变异逐刀 CAUGHT 且红文案点名到具体站点；2 条绿控必须放行；每刀还原后逐字节一致。
4. 受影响文件的既有测试（按读者反查的**消费者并集**，非「我改过的文件」）全绿。
5. 先红后绿必须**在同一棵树上**各跑一次并留读数。

## 6. 明确不做（避免边界失控）

- **不建**全仓 `index-key` 棘轮：审计文档「新门禁上线三步序」要求只可缩小的新清单先出基线快照、经人工批准、再与接线同批落地。首批同样只落组件级锁。
- **不改**静态骨架屏（`v-for="i in 6" :key="i"`、`UiSkeleton.vue` 三处）与整体替换 + 纯文本项那一族。
- **不并入**首批那条分支的未合并实现（`useBatchCreate` 行身份、`ReferenceFinder._rid` 等），两条判归各自带锁，避免把别人的未评审改动捎进本 PR。

## 7. 取证与踩坑（写给下一个会话）

- **行号与「是否已改过」必须取自我要动的那棵树**。本批最初据一份基于落后 240 提交的本地 `main` 做的分诊报告取行号，12 处里 3 处行号错位、1 处（`ReferenceFinder.vue`）那条树上早已是 `:key="ref._rid"`；更严重的是同名 worktree `mp-ux-audit-stable-keys` 的 HEAD 其实是**首批那条未合并分支**，在它上面开工等于把别人的未评审改动捎进本 PR。正解：另起 `ux-audit-stable-keys-2` 从 `origin/main` 干净落地。
- **变异驱动的输出通道必须先自证能跑**。第一版驱动用 `execFileSync` 直调 `node_modules/.bin/vitest.cmd`：Windows 下 spawn `.cmd` 需 `shell:true`，否则抛错且 `e.status === null`。它把「测试根本没起来」读成「五刀变异全被抓到、绿控也放行」，整批读数**作废**。正解：`spawnSync(process.execPath, [node_modules/vitest/vitest.mjs, 'run', …])`，并在跑任何变异之前做一次**不变异的正控**（要求 `rc=0` ∧ 红集为空 ∧ 打印 `12 passed`），正控不过即 `exit 2` 中止。
- **`git restore --staged --worktree` 会删掉本次新写并已 `git add` 的文件**（它们已在 index 里、但不在 HEAD 里）：本批退回旧树时把自己那份测试与 PRD 一起删了，只能重写。退回他人内容应只针对**他人跟踪的文件**，新文件先移开再退。
- 本批自写的「宽判据全仓重测」探针给出 0 处读数，而同判据在 `UiSkeleton.vue` 单文件命中 3 处 ⇒ 该探针已被自证为坏，0 读数不采信、不写进结论；全仓读数沿用首批的 43 处口径（两口径不得互替）。
