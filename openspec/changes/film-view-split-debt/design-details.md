# 行级明细（人读附件，供实施与复核）

> 基线 `origin/main` @ `6918533fb`。门禁口径：`FilmEngineeringView.vue` = 750 行。

## A · `FilmVideoGenPanel.vue`

- 模板：242–323（`<el-dialog v-model="videoPanelOpen">` 六态：idle / awaiting-confirm / generating / done / cancelled / failed）82 行
- 脚本：459–489
  - `const router = useRouter()`、`videoPanelOpen`、`videoStartError`
  - `const { phase: vgPhase, chosen, busy, progress, costCheck, shotResults, finalPath, errorCode, errorText, start, confirmCost, cancelCost, retryShot, reset, dispose } = useFilmVideoGen()`
  - `openVideoPanel()`（面板内改名为 `open()`）、`onVideoStart/Confirm/Cancel/Retry/Reset/OpenFolder/SaveAs`、`vgStatusType/vgStatusLabel`
  - `gotoModelSettings()` → 改为 `emit('goto-models')`，父做 `videoPanelOpen=false; router.push('/model-providers')`
  - **新增** `onBeforeUnmount(() => vgDispose())`
- 样式：`fe-vg`/`fe-vg-row`/`-label`/`-select`/`-hint`/`-error`/`-actions`/`-shots`/`-shot`/`-shot-no`/`-shot-id`/`-shot-meta`/`-path`（735–748，14 行）

## B · `FilmProductionPanel.vue`

- 模板：325–419（`<el-dialog append-to-body>` 七态：idle / plan-ready / batching / manifest-ready / composing / done / failed）95 行
- ⚠ 逐字保留 `v-for="(sh, si) in b.shots"`（`list-stable-keys.test.js` 的 `marker: 'in b.shots'`）
- 脚本：491–554（`useFilmProduction()` 全量解构 + `openProductionPanel`→`open()`、`onProduction*`、`toggleBatch`、`pdBatchLabel/pdBatchType/pdFmtBytes/pdFmtDuration/pdAspectLabel`）
- `pdDispose()` → `onBeforeUnmount`
- 样式：同 A 的 `fe-vg*` 一份

## C · `FilmShotDetailDrawer.vue`

- 模板：184–227（`<el-drawer v-model="detailOpen">`：头部 tag、四个复制按钮、`resolvedRefs` 列表、提示词折叠）44 行
- 脚本：`detailOpen`/`expanded`（454–455）、`onOpenShot`（610–613）、`copyRefToken`（644–650 改为 `emit('copy-token', token)`）
- props：`open`(v-model)、`shot`、`loading`、`preview`
- 样式：`fe-detail-head`/`-copies`/`-section`、`fe-refs`/`fe-ref`/`-img`/`-meta`/`-name`/`-token`、`fe-prompt-box`/`-text`（717–728）+ `fe-shot-id`/`fe-pane-title`/`fe-empty`

## 父视图保留（不动）

- 模板 1–183（标题/空态/元信息/分镜库 tab/剧本套用 tab）、229–240（生成结果 dialog）、`<FilmDoctrinePanel>` 178–181
- 脚本：`useFilmEngineering()` 全量解构、`roleEntries` 与配置档案四函数、`sceneTree`/`allSelectedInScene`/`someSelectedInScene`、`formatDuration`/`promptPreview`/`onSceneClick`/`onGenerate`/`onAdapt`/`addRole`/`removeRole`、虚拟滚动 sentinel
- 样式：其余全部
