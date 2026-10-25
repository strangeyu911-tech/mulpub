---
branch: ux-audit-error-action
stage: 1.10b
date: 2026-10-25
---

# 执行记录：错误卡片的一键直达（阶段 1.10b）

## 一、变更类型与隔离声明

- 运行时代码变更（`apps/desktop/src/components/AiWriterPanel.vue`、`src/utils` 之外无新增模块、`locales/rewrite-page/*`）
  ⇒ 在隔离 worktree 完成：`<仓库父目录>/mp-worktrees/ux-audit-error-action`，分支 `ux-audit-error-action`，起点 `558fbb720`。
- 依赖就绪：`scripts/start-mp-task.ps1 -TaskName ux-audit-error-action`（`ok: true`）。
- 规模刻意控制：本切片源码级变更行数远小于 1.10 主切片（主切片 426/724 行进 DUAL 档，见
  `openspec/records/ux-audit-help-support.md` §七）。判据只数 `codeExtensions` 的变更行、文档不计，
  所以「把文档写详细」不会把 PR 推进 DUAL 死路。

## 二、立项取证与一次自我否证

| 判据 | 读数 | 结论 |
|---|---|---|
| `utils/user-facing-error.js::formatUserError` 返回形状 | `{ errorCode, message, matched }`，三级判定 | 错误码**本来就算出来了** |
| `AiWriterPanel.vue` 的五处赋值 | 一律 `panelError.value = formatUserError(…).message` | **errorCode 在最后一米被丢弃** ⇒ 缺的是动作位，不是新文案 |
| `git grep -n "goToProviders" AiWriterPanel.vue` | `function goToProviders() { router.push("/model-providers"); emit("close") }`，配置横幅 :28 已在用 | **通道已存在** |

第三条否证掉了我自己上一轮写下的方案：原计划在 1.10 记录 §8 里做「code → `requestSettingsDialog` 动作位」，
那会造出第二条到达模型设置的路径（一条 push 路由、一条开设置弹窗），正是 AGENTS 反复警告的"两份口径"。
改为复用 `goToProviders`，并把它写成机器判据（测试 6 断言动作绑的就是 `goToProviders`）。

## 三、TDD 现场

- 红（实现前）：`Test Files 1 failed / Tests 6 failed (6)`，读数
  `错误卡片必须给出直达动作…: expected false to be true`。
- 第一次跑的**假红**：`SyntaxError: Need to install with app.use function` —— 夹具漏装 i18n 插件。
  这是 harness 坏了，不是功能缺失，所以先修夹具（`global: { plugins: [i18n] }`）再看红，
  修完红集变成 5 条且全指"动作不存在"+ 1 条通过（字符串契约），才承认那是真红。
- 第二次假红（同一类）：`成功后错误区应已清除: expected true to be false`。
  根因是我把 `aiRewrite` 的成功形状写成 `{code:0,data:{result}}`，而真实契约是
  `{code:0,data:{success:true,result}}`（`AiWriterPanel.vue:399`）—— 组件判进失败分支。
  **正解是改夹具对齐真实语义，不是放宽断言**（AGENTS「夹具不得替对方剥壳」的同族）。
- 绿（实现后）：`Tests 6 passed (6)`，且既有 `AiWriterPanel.test.js` 全量同跑仍绿（`panelError` 字符串契约未破）。

## 四之二、QM-6 第一轮外部深审（critic=claude，轮 1/3，mode=DUAL）

引擎读数「变更 728 行 > 200 行阈值」；8 条问题、4 条进裁决，**四条全部 upheld**，逐条处置：

| # | 主张 | 处置 |
|---|---|---|
| i1 | PRD 承诺「无码不给动作」却**零用例覆盖 message-only 载荷**；且 `res.data.error` / `res.message` 两个非 catch 分支直接手写 `panelErrorCode`/`panelError`，绕过被 PRD 称作配对不变式实现的 helper ⇒ 同一不变式实际四处实现，其中两处无测 | 新增 `setPanelErrorText(text)` 收编两处手写分支（源码里不再有第四、第五处直接赋值）；补两条用例：同一实例内带码错误→无码错误（文本换掉、动作必须消失），以及**分别穿过 `:427` 与 `:430` 两个分支**；反证加 **E8** |
| i2 | 三个文件以 `\ No newline at end of file` 结束、vue 末行多一个空行 | **实测成立且比我原来的记录更严重**：文件尾是 `\n\r`，即一个**孤立 CR**，`git ls-files --eol` 当场报 `i/-text` —— AGENTS 记过触发 `-text`（整文件 CRLF 入 blob）的正是 lone CR/NUL。已修为单一 LF 收尾，两口径 numstat 对三个文件都是 `0/1`（一致）、loneCR=0。也顺带**订正 §五**：我上一轮写「统一到 LF 才是回到同源」只对了一半，真正该做的判据是**别留孤立 CR 且保持两口径一致**，不是猜哪种行尾"更对" |
| i3 | 全文件级 `not.toMatch` 与 200 字符邻近度启发式：该组件还承载标题/润色/摘要，未来任一功能合法用 `window.open` 就会让本套件无端变红；且它并不能证明"按钮通道就是复用" | 收窄到动作块本身；仓内该禁令已有全域执行体 `apps/desktop/src/href-scheme-contract.test.js`，不在这里重复一份会漂移的口径；"必须复用"改成**正面**结构断言（块内必须出现 `@click="goToProviders"`）。如实写：邻近度只能证明同块，不能证明函数同一 |
| i4 | G4（zh/en 成对）零机械保障；vue-i18n 缺键会渲染 key 原文，正是 PRD §3 自己强调的失败模式 | 新增从源码取 `rewritePage.*` 键、逐键断言 zh/en 都在（键数下界 >0 防解析退化）；反证加 **E7**。**不拿「CI 有 Gate 7」免责**：Gate 7 实测只比根级 `zh.js/en.js`，对拆分文件结构性失明（见记忆「locale 成对门禁对拆分文件失明」），更不检查"码表指向的键是否存在" |

### 反证复跑（升级后 8 刀）

```
[BASELINE] 全绿 passed=9 collected=9
E1 / E2 / E3 / E4b / E5 / E6  CAUGHT（前一轮已跑）
E7  CAUGHT  删 en 侧键 → × 码表指向的 locale 键必须 zh/en 都在
E8  CAUGHT  复合刀 → × res.data.error 与 res.message 两个非 catch 分支都必须走同一个清码出口
              + × 错误清除时动作一并清除
[SUMMARY] E7/E8 复跑：CAUGHT=2 其余=0 还原失败=0
```

E7 第一版报 `ANCHOR_NOT_FOUND(hits=0)` —— 我把锚点写成单引号，而那份文件里的值是**我用双引号插进去的**；
E8 第一版报 **MISSED** —— 因为 `doRewrite` 开头还调了一次 `clearPanelError()`，
即同一不变式有**三层**实现（合取、helper、每轮起始清除），单摘任一层都没有可观测差异。
两条处置不同：E7 是驱动的锚点错（改锚点），E8 是**实现的冗余防御**（改成复合刀并把三层事实写在这里）。
**都不是**"为了让它红而编一条本来不存在的可观测行为"。


## 四、反证第一轮（实现后立刻跑，6 刀）

```
[BASELINE] 全绿 passed=6 collected=6
E1  CAUGHT  动作行恒不渲染
E2  CAUGHT  button 降级为 div
E3  CAUGHT  码表放宽到 TIMEOUT
E4b CAUGHT  同时摘掉「合取 + 清码」两层防御
E5  CAUGHT  点击不调 goToProviders
E6  CAUGHT  errorCode 再次被丢弃
[SUMMARY] 共 6 条：CAUGHT=6 其余=0 还原失败=0        （驱动 exit 0）
```

**E4 的两次失败是本批最值得留的一条**（不粉饰）：

1. 第一版 E4「`clearPanelError` 里不写 `panelErrorCode.value = ""`」⇒ **MISSED**。
2. 于是改打模板里的 `panelError &&` 合取（E4b 第一版）⇒ **还是 MISSED**。
3. 结论不是"测试漏了"，而是**该不变式由两层冗余实现，单摘任何一层都无观测差异**。
   正解是把这一刀改成**同时摘两层**（E4b 第二版），红才归因到那条配对断言上；
   而"冗余"这件事本身记在这里 —— 别把"单行变异不红"一律读成"测试太弱"，也**不许**为了给 E4 找一条红
   去编一条本来不存在的可观测行为。

## 五、行尾自伤实录（我主动制造的）

插入 37 行 LF 后，`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径都是 52/11（一致）**，
我却为"文件自洽"把整份文件统一成 CRLF ⇒ 当场变成 `723/681` vs `53/11`，即 AGENTS「行尾不是噪声」点名的
**整文件幽灵行**。已回退（统一成 LF），两口径重新一致、`git ls-files --eol` = `i/lf w/-text attr/text=auto`。
教训：**两口径一致 = 不要碰行尾**；要统一先看索引侧 `i/*`，本仓索引是 LF，工作副本 CRLF 只是 checkout 产物。
同源连带影响：变异驱动的多行锚点因混行尾两次报 `ANCHOR_NOT_FOUND(hits=0)`（E2/E4），归一行尾后自动命中。

## 六、QM 自检

- QM-1 打包：**N/A**（未动 `electron/`、未动 `packages/rpa-engine/`）。
- QM-4 视觉：未新增视图，`AiWriterPanel` 是面板内组件；动作行只在错误态出现，不属像素注册表采集的默认态。
  若 CI 侧 `QG Visual` 变红，按「基线只能取自同一次 CI 渲染」处置。
- 无障碍：动作是原生 `<button type="button">`；文案走 `t('rewritePage.goToModelSettings')`（zh/en 成对）；
  焦点环 `--color-focus-ring`；按钮**不放进** `<p role="alert">` 内，避免读屏每次错误都多播一句。
- QM-6：见 PR 评论区回读。

## 七、残余

- 其它错误呈现面（`ApprovalGateModal`、发布历史卡片、`App.vue` 的 `ElMessage.error`）本次不统一。
  toast 上的按钮能否被键盘到达、历史卡片内联动作放哪儿，都是另一类交互 ⇒ 要做就先抽共享的「错误 + 动作」契约，
  不要逐个复制（细则见 `01-docs/PRD-ERROR-CARD-ACTION-2026-10-25.md` §8）。

| 远程同步 | 由门禁推导 |
| 主干依赖 | 起点 `558fbb720` 含 `clickable-roles` 那条主干红；该红已由 `#4416` 合入 `3b90daa9c` 收口 ⇒ 本 PR re-sync 后 CI 应无该项 |
