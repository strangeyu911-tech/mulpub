# Design: createview-config-profile-extract

## 1. 为什么不建 change 就直接实现（范围边界的理由）

仓内定案 §五 的执行纪律里，有两条把「实现」和「验证」绑在一起：

- **§五-2**：全量 `vitest` 必须通过；
- **§五-3**：拆分落地后必须跑 `npm run test:visual:pixel`（QM-4 像素回归）。

⇒ 像素回归需 Electron + 浏览器环境，**不在本变更的执行环境内**。
⇒ 故本 change 只交付**规格**（PRD + 本 design），实现另开 change。
⇒ 这也符合定案 §五-5「单 PR ≤ 1500 行移动」的**分步**精神：规格与实现分批，
每批各自可独立审、独立回滚。

## 2. 第一刀的范围（spec 定稿，实现时按此执行）

| 项 | 内容 |
|---|---|
| 搬走 | `useConfigProfiles` composable：配置档案 CRUD + 套用 + 重命名 + 删除 + 路由套用（AST 口径 22 项 / 约 245 行） |
| 不搬走 | ① `useS2vConfig`（相对触点最重，**维持不做**）② **ConfigProfile 三弹窗组件化**（触发 §2.4 浮层硬门禁，本刀不做）③ 历史域删除确认三方法（§2.10 已判跨域过深留壳） |
| 落点 | `apps/desktop/src/views/video-creation/composables/useConfigProfiles.js`（定案 §2.1 已指定，**不新建目录**） |
| 规模 | 新文件 ≤ 499 行（预估 ≈ 220–280 行）；单 PR 移动量 ≤ 1500 行（§五-5） |

## 3. 状态处置：本刀**不抽 `data()` 里的状态**（与既有三批 composable 不同）

### 3.1 硬约束与依据

`s2v-panel-contract.parent-keys.test.js` 断言 `expect(parent.data.size).toBeGreaterThan(80)`
⇒ 当前 `data` 键数 **122**（AST 口径实测）⇒ **余量 42 键**。

既有三批（`useBgmLibrary` / `useTtsVoices` / `useBatchCreate`）都把状态**移出** `data()`
⇒ **每抽走一个 `data` 键，余量就少 1**。
若沿用既有做法把 25 个配置档案状态键搬进 composable ⇒ `data.size` 落到 **97**（余量 42 → 17）
⇒ 后续刀次更快撞线。

⇒ **本刀：状态全部留在壳的 `data()`**，composable 经**显式 deps** 读；写回经 deps 的写入器
写回**同一个响应式对象**（**禁止 spread 副本**）。

### 3.2 为什么不用「模块级单例」形态

模块级单例把「组件卸载」与「状态生命周期」解耦 —— 定案 §2.8 实测的 Teleport 跨用例污染根因
（`useBatchCreate` 提取时暴露，§2.10 靠 Teleport 清场基建兜住）。

本刀状态留壳 ⇒ **天然无此问题** ⇒ 不得引入 `window.__*` 全局兜底
（`useBatchCreate` 有此形态，属**遗留**，**不得照抄**）。

⇒ 本刀将是仓内**第一个实例级** composable。

## 4. 桥接的两条兼容契约（定案 §2.3 原文，本刀必须显式满足）

1. **整体对象赋值**（`vm.s2vConfig = {...}`）经 setter **整体替换** ref.value；
2. **原地变异**（`vm.list.push(x)`）要求 getter **返回 ref 内对象本身**（非 spread 副本），
   否则 `{...spread}` 丢失响应式。

⚠️ Vue 3 中 ref 放进 `data()` **不会被解包** ⇒ **禁止**把 composable ref 直接挂进 `data()`。

## 5. 数据校验：4 道校验 + 1 道并发守卫，搬移时逐字保持

| 校验 | 既有行为 |
|---|---|
| 名称非空 | `name.trim()` 为空 ⇒ toast「请输入配置名称」并 `return`（**不发请求**） |
| 流水线已选 | `selectedPipeline?.name` 为空 ⇒ 直接 `return`（**不发请求、不提示**，静默） |
| 重名二次确认 | 同 `(pipelineId, name)` 已存在 ⇒ 置 `overwriteNeeded` + toast「已存在同名配置，再次点击保存将覆盖它」并 `return`；**第二次点击**才真覆盖 |
| 并发守卫 | `s2vConfigProfileListRequestId` 单调递增；返回时 `requestId !== 当前值` ⇒ 丢弃过期结果（**加载/错误/列表三处都要判**） |
| 快照套用 | `_applyS2VSnapshot` 按 key 逐项比 `typeof target[key]` 判定是否拷贝（数组/对象走深拷贝，其余同类型才赋值，`undefined`/`null` 跳过） |

⚠️ `overwriteNeeded` / `requestId` 都是壳 `data` 键 ⇒ 随实例生命周期 ⇒ 天然无跨用例污染。

## 6. 流程与交互（用户视角，搬移后逐字不变）

1. **保存**：点「保存配置」→ 保存弹窗 → 输入名称 → 「保存」
   - 名称为空 ⇒ 提示「请输入配置名称」，停留弹窗
   - 未选流水线 ⇒ **静默无提示、不请求**
   - 重名 ⇒ 提示「已存在同名配置，再次点击保存将覆盖它」⇒ 需**再次点击**才覆盖
   - 成功 ⇒ 提示「配置已保存」；失败 ⇒ 提示失败原因
2. **列表**：「我的配置」⇒ 按 `updatedAt` 倒序；加载失败保留旧列表 + 错误提示
3. **套用**：「应用」⇒ 二次确认（覆盖当前已调整的选项）⇒ 套用快照
   - 不属于当前流水线 ⇒ 拒绝并给可读提示；已被删除 ⇒ 如实提示，不静默当作「没选配置」
4. **重命名 / 删除**：各自独立确认弹窗；删除后提示已删除
5. **路由套用**：URL 带 `configProfile` ⇒ 自动套用并提示「已应用配置」；无参数 ⇒ 不套用不提示

⚠️ **显示项与交互零变更**：本刀**不抽模板** ⇒ 弹窗、按钮、提示位置、toast 时长（2200ms）全部不动。

## 7. 提示文字落点

- **不得在新文件里写任何中文字面量**（CI Gate 7 `--cjk` 拦渲染端新增硬编码）。
- 既有方法体的中文 fallback 已在 i18n 迁移（#3330「fallback 参数清偿 43 处」）中清偿；
  `check-locale-sync.js --cjk` 当前读数 **基线 1330 / 当前 1095 / 无新增** ⇒ **locale 补全量 = 0**。
- 若实现中发现残留中文 ⇒ 一律走 `translateWithLocaleFallback(key, zh, en)`，
  并把 zh/en 补进 `locales/create/{zh,en}.js` 的 `configProfile` 命名空间（现有 20+ 键，缺什么补什么，**成对**）。
- ⚠️ **`--cjk` 基线按 `file:line` 存储** ⇒ 搬走 245 行会让 `CreateView.vue` 行号偏移 ⇒ 基线失配
  ⇒ 实现 PR **必须同步重生成** `locale-cjk-baseline.json`，且**必须证明「无新增硬编码」**（新文件 CJK 命中 = 0）。
  ⚠️ `--update-baseline` **禁用于掩盖新增硬编码**（脚本自述）⇒ 重生成的前提就是上述证明。

## 8. 测试策略（定案 §五-2）

- **壳侧保留同名方法代理** ⇒ 旧测试 `CreateView.test.js` **288/288 零改动全绿**；
- **新 composable 配独立新测试文件**（不迁旧测试）⇒ 覆盖 §5 的 4 道校验 + 1 个并发守卫 + 1 个原地变异响应式用例；
- ⚠️ **新增测试文件会改变 vitest 分片分配**（CI `--shard=2/2`）⇒ 实现 PR 须预期
  「时限偏紧的用例被挪进更慢的 shard」这一形态，必要时**只放宽该用例的时限**（不改断言语义、不改 skip 守卫）。

## 9. 代理退出机制（定案 §2.3）

每个代理方法登记「→ 计划删除 PR 编号」映射表；「代理残留数 ≤ 当前未完成步数」作为可检查指标。
⚠️ 代理宿主命名**禁用 `_`/`$` 前缀**（Vue 3 中走 ctx 通道、语义含糊）。

## 10. 后续 change 预告（不在本 change 执行）

**`createview-config-profile-extract-impl`**：执行本 design §2–§9 的实现，交付
`useConfigProfiles.js` + 壳侧代理 + 新测试 + CJK 基线重生成，
并在同批完成 **QM-4 像素回归**与**全量 vitest**。

## 11. 在飞 PR 避让（2026-10-25 实测）

在飞 40 条 PR **无一改 `CreateView.vue`** ⇒ 本刀不产生整文件冲突。
`#4387` / `#4378` 改的是 `video-creation/S2vConfigPanels.vue` 与 `composables/tts-voices-*`
⇒ **本刀不触达这些文件** ⇒ 与它们无重叠。
