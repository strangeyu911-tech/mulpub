# PRD：错误卡片的一键直达（UX 审计阶段 1.10b）

日期：2026-10-25 ｜ 分支：`ux-audit-error-action` ｜ 上游：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.10 第二半、`01-docs/PRD-HELP-SUPPORT-USABLE-2026-10-25.md` §8

## 1. 立项取证

审计原文要求「`locales/user-errors/zh.js:23` 的『参考使用说明』改为可点击落点」。实测三件事决定了这不是一句文案改写：

| 判据 | 现场读数 | 结论 |
|---|---|---|
| `apps/desktop/src/utils/user-facing-error.js` 的 `formatUserError()` 返回形状 | `{ errorCode, message, matched }`（三级判定：稳定码 → 数值码映射 → 遗留 raw pattern） | **错误码本来就算出来了**，一路带到渲染层 |
| `apps/desktop/src/components/AiWriterPanel.vue` 的取值方式 | 五处 `panelError.value = formatUserError(…).message` | **errorCode 在最后一米被丢弃**——缺的是动作位，不是新文案 |
| 面板内是否已有到模型设置的路径 | `function goToProviders() { router.push("/model-providers"); emit("close") }`，配置横幅的「前往 Provider 设置」按钮在用 | **通道已存在**，必须复用；另写一份 = 两份口径必然漂移（本仓反复记过的病） |

对照 1.10 主切片（PR #4418）：那里补的是「用户主动找帮助」的入口，这里补的是「错误发生后就地能自救」的出口。两处共用同一条 `router.push("/model-providers")`，不新增第二份协议判据、不开新窗口。

## 2. 目标 / 非目标

**目标**
- G1 改写链路的错误卡片旁边，在**有直达意义**的错误码下出现一个动作按钮，点击即落「模型设置」。
- G2 按钮是原生 `<button type="button">`：键盘（Enter/Space）与鼠标同一条路径，焦点环走 `--color-focus-ring`。
- G3 错误被清除时动作一并清除（不得残留指向已消失错误的死按钮）。
- G4 文案 zh/en 成对（`rewritePage.goToModelSettings`），不新增硬编码中文字面量。
- G5 `panelError` 对外的字符串契约不破（三处既有断言仍按字符串读），新增状态另起一个 ref。

**非目标**
- 不改 `userErrors.LLM_KEY_MISSING` 的正文（它已经是合规的用户可读文案，且被 `user-facing-error.test.js` 断言着）；本项是**在它旁边加动作**，不是把说明从文字里搬走。
- 不给配额/网络/存储/限流类错误配动作。判据不是"看起来能救"，而是"该错误码的解决路径确实就在模型设置这一页"。
- 不引入通用 i18n 富文本链接机制（那是跨 20+ 错误码的面状改造）。

## 3. 数据校验（谁能拿到动作）

| errorCode | 给动作？ | 落点 | 理由 |
|---|---|---|---|
| `LLM_KEY_MISSING` | 是 | `model-providers` 路由 | 文案本身要求「在模型设置中配置 API Key」 |
| `API_KEY_NOT_CONFIGURED` | 是 | 同上 | 同一处可解 |
| `TIMEOUT` / `NETWORK_ERROR` / `QUOTA_EXCEEDED` / `IO_ERROR` / `STORAGE_UNAVAILABLE` | **否** | — | 去设置页解决不了；给一个无关按钮等于制造第二次失败 |
| 未知码 / 无码（`res.data.error`、`res.message` 这类纯文本） | **否** | — | 无码即无判据，**不得猜** |

实现上是一张显式表 `ERROR_ACTION_LABEL_BY_CODE`，不是 `code.endsWith('MISSING')` 这类推导——AGENTS 的既有口径：错误码 → 文案 key 必须显式映射，拼错会静默渲染成 key 原文。

**码表拼错的防护是机械的而不是口头的**：`LLM_KEY_MISSING` 写成 `LLM_KEY_MISS` 时，按钮永不出现且没有任何报错——所以测试用五种"不该给动作"的码逐个断言「不给按钮」，并用 E3 变异（往表里塞 `TIMEOUT`）证明那五种断言真的在盯这张表。

## 4. 交互逻辑

```
用户点「开始改写」→ doRewrite()
  ├─ clearPanelError()            # 文本与码一起清（配对不变式）
  ├─ await aiRewrite(params)
  ├─ 成功（code===0 && data.success）→ 渲染结果，错误区与动作区都不存在
  └─ 失败 → setPanelError(payload, fallback)
        ├─ panelError      = formatUserError(payload,{fallback}).message   （既有语义不变）
        └─ panelErrorCode  = formatUserError(…).errorCode || ""            （新增）
              ↓
        模板：v-if="panelError && panelErrorActionLabel"
              → <button data-testid="panel-error-action" @click="goToProviders">{{ t(…) }}</button>
```

按钮**嵌在错误区之下、独立成一行**，不塞进 `<p role="alert">` 内部：alert 区的内容变化会被读屏整段重播，把按钮文案混进去等于每次错误都多播一句；分行也让"错误是什么"和"现在能做什么"在视觉上一眼分开。

## 5. 显示项与提示文字

| 位置 | zh | en |
|---|---|---|
| 动作按钮 | 前往模型设置 | Open model settings |

错误文本本身沿用既有 `userErrors.*`，本项不改一字。样式：`.panel-error-action-row { margin: 6px 0 0 }`；复用既有 `cohere-btn-primary` 皮肤，只补一条 `:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px }`（浅/暗两档在 `tokens.css` 各自声明，暗色自动换色）。

## 6. 判据（`AiWriterPanel.error-action.test.js`，6 条，真挂载不打桩组件）

1. `LLM_KEY_MISSING` ⇒ 错误区仍是 `role="alert"`，且旁边出现 `[data-testid=panel-error-action]`，且它是 `BUTTON`。
2. 点它 ⇒ `router.push('/model-providers')`（复用通道的**行为**证明）；同时结构锁：源码不得出现 `window.open(` 与协议正则。
3. `API_KEY_NOT_CONFIGURED` 给动作；`TIMEOUT`/`NETWORK_ERROR`/`QUOTA_EXCEEDED`/`IO_ERROR`/`STORAGE_UNAVAILABLE` 逐个断言**不给**（错误文本仍必须在）。
4. `panelError` 仍是文本节点且非空（既有契约不破）。
5. 先失败后成功 ⇒ 错误区与动作区**都**不存在（配对不变式）。
6. 按钮文案必须是 `{{ t(…) }}` 且动作必须绑 `goToProviders`（防止后来者"顺手"新开通道）。

夹具纪律两处刻意写明：`aiRewrite` 的成功形状按真实契约给（`{code:0,data:{success:true,result}}`）——第一版只给 `{code:0,data:{result}}` 时被组件判进失败分支，那是**夹具不同形**而不是产品坏；`checkConfig` 的异步落地用一次真实等待吸收，不用假时钟掩盖。

## 7. 反证（`node scripts/error-action-mutate.js`，6 刀）

E1 动作行恒不渲染 / E2 button 降级 div / E3 码表放宽到 TIMEOUT / E4 清除时不清码 / E5 点击不调 `goToProviders` / E6 `errorCode` 再次被丢弃。逐刀还原并核 md5，`collected` 不等判 `PROBE_BLIND`。实测读数写在 `openspec/records/ux-audit-error-action.md`。

## 8. 残余

- 其它错误渲染面（`ApprovalGateModal`、发布历史卡片、`App.vue` 的 `ElMessage.error(...)`）**没有**在本次统一。`ElMessage` 是瞬时 toast，加按钮属另一类交互；历史卡片是列表内联，需另设落点位置。这三处若也要动作位，应抽成共享的「错误 + 动作」呈现契约而不是逐个复制——那是独立切片，且要先解决"toast 上的按钮能否被键盘到达"。
- 本项不做 i18n 富文本链接（§2 非目标）。审计原话「『参考使用说明』改为可点击落点」在此以「错误卡旁边给出可点击的模型设置入口」兑现：用户点了就到，不再需要自己去翻设置。
