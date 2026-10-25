# Spec: createview-config-profile-extract-impl

## Requirement 1：配置档案域的实现必须保持既有行为逐字不变

- 搬移必须逐字保持：**4 道校验**（名称非空 / 流水线已选静默返回 / 重名二次确认 / 服务端同名判定）、
  **1 道并发守卫**（`requestId` 单调递增，**成功、错误、`finally` 三处**都要判过期丢弃）、
  **快照逐项类型判定**（数组与对象深拷贝、其余同 `typeof` 才赋值、`undefined`/`null` 跳过）。
- 提示文案与**时长**必须逐字保持：既有实现中 `saved` / `applied` / `renamed` / `deleted` 四条
  **不传时长 ⇒ 用默认 1600ms**（`showS2VOptionsToast(text, durationMs = 1600)`）⇒ 搬移不得擅自补时长。
- 面向用户文案**必须留在壳侧**（`deps.messages.*` 惰性提供 zh/en 三元组）：
  ① 渲染端硬编码中文门禁只扫非测试源文件 ⇒ 新文件带中文会被判「新增硬编码」；
  ② 惰性求值保证语言切换后文案跟随。

#### Scenario: 搬移时给无时长的提示补了 2200ms

- **WHEN** 搬移代码时把 `showS2VOptionsToast(msg)` 改写成 `showS2VOptionsToast(msg, 2200)`
- **THEN** 判不通过 —— 既有实现的默认时长是 **1600ms**，补时长是行为变更，必须逐字保持

## Requirement 2：新增 composable 必须是实例级 + 显式 deps，状态留壳

- composable 必须是**实例级**（每次调用返回独立对象，deps 由闭包捕获）；
  **不得**使用仓内既有三批 composable 的模块级单例形态，**不得**引入 `window.__*` 全局兜底。
- 状态**必须留在壳的 `data()`** ⇒ `data.size` 不变 ⇒ 既有「`data.size > 80`」契约继续成立。
- 桥接两条兼容契约必须成立：整体赋值**整体替换**、原地变异**返回同一响应式对象**（非 spread 副本）。
  ⇒ 落地方式：读写经 `deps.get` / `deps.set`（指向壳的响应式对象），**禁止**在 composable 内造副本。

#### Scenario: 状态被搬进 composable 的 ref

- **WHEN** 新 composable 把配置档案状态搬进自己的 ref 并挂进 `data()`
- **THEN** 判不通过 —— ① Vue 3 中 ref 放进 `data()` 不会解包；② 状态移出会消耗 `data.size` 余量（本仓余量仅 42 键）

## Requirement 3：跨域共用的方法必须留壳

- 被**两个域**共用的方法（如 `_applyS2VSnapshotObject` 同时服务配置档案套用与「恢复上次选项」历史域）
  **必须留壳**，由 composable 经显式 deps 调用 ⇒ 不得为了「搬干净」而改动历史域路径。
- 代理层是**过渡机制**：每个代理方法最终要随「→ 计划删除 PR 编号」映射表逐个撤除；
  代理残留数不得超过当前未完成步数。

#### Scenario: 为搬得干净而把跨域方法也搬走

- **WHEN** 实现把 `_applyS2VSnapshotObject` 一并搬进 composable
- **THEN** 判不通过 —— 它被「恢复上次选项」历史域共用，搬走会改动那条路径（本仓有「整体还原」类事故先例）

## Requirement 4：两份手工同步的清单必须配机械锁

- 凡是「一份清单 + 一份实现」需要人工同步的地方（壳侧代理清单 ⇄ composable `return` 清单、
  白名单 ⇄ 登记表、路由表 ⇄ 处理器表），**必须配一条机械锁**（读两侧源码比对集合关系），
  而不是依赖评审眼力。
- 机械锁要**双向**：漏导出（代理 ⊄ 导出）与死导出（导出 ⊄ 代理）都要红。
- 代理/转发层统一用 `(...args) { return target.X(...args) }` 形态 ⇒ 缺导出时表现为 **TypeError**（响亮）
  而不是静默返回 `undefined`（哑）。
- 锁本身必须做**变异验证**：故意让两侧不一致，锁必须红。

#### Scenario: 代理清单与导出清单手工同步，首版漏了一个导出

- **WHEN** 壳侧代理由脚本批量插入、composable 的 `return` 清单手写，首版漏导出某个方法
- **THEN** 判不通过 —— 必须有机械锁在 CI 上当场红；这类缺陷只有旧测试恰好覆盖到该方法时才会暴露
