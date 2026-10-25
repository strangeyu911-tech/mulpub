# Tasks: createview-config-profile-extract-impl

> 本 change = **第一刀的实现**（设计已由已归档的 `createview-config-profile-extract` 定案，
> 规格见 `01-docs/PRD-CREATEVIEW-SPLIT-REVIEW-2026-10-25.md` §6 追加章）。
> `scripts/openspec-sync-check.js` 要求 active change 的 tasks **无未完成项**
> ⇒ 本清单只列**本轮实际完成并可取证**的事项。

## 1 隔离与基线

- [x] 1.1 独立 worktree `/workspace/mp-worktrees/mp-createview-config-profile-impl`（NAS，非 C 盘）+
      裸分支 `createview-config-profile-extract-impl`，base = `origin/main@e4057d7a`
- [x] 1.2 开工前核对：在飞 open PR 43 条**无一**改 `CreateView.vue` / 配置档案域 ⇒ 无撞车
- [x] 1.3 依赖就绪（pnpm 11 workspace 包软链重指向本 worktree，解决「相对路径软链解析到旧版 packages」）

## 2 实现

- [x] 2.1 新增 `apps/desktop/src/views/video-creation/composables/useConfigProfiles.js`（373 行，**零中文字面量**）
- [x] 2.2 **实例级**形态：`useConfigProfiles(deps)` 每次调用返回独立对象；**显式 deps 9 项**；
      未引入模块级单例、未引入 `window.__*`
- [x] 2.3 状态**全部留在壳的 `data()`**（`data.size` 不变）⇒ 桥接两条契约经 `get`/`set` 天然成立
- [x] 2.4 搬走 21 个域内专有方法；**留壳 4 个跨域共用方法**（`_applyS2VSnapshotObject` /
      `normalizeS2VRestoredEnums` / `restoreS2VLastOptions` / `_applyS2VSnapshot`）
- [x] 2.5 壳侧 19 个同名代理（模板 16 + 旧测试 2 + 路由套用 1），形态统一 `(...args) { return this.configProfiles.X(...args) }`
- [x] 2.6 `created()` 建实例 + 注入 deps（`get`/`set`/`getDefaults`/`toast`/`pipelineName`/
      `isOrchestratedPipeline`/`cloneForIpc`/`applySnapshotObject`/`messages`）
- [x] 2.7 移除 `@/api/publisher` 的 4 个只被搬走方法使用的 import；新增 composable import
- [x] 2.4b 逐字保持 4 道校验 + 1 道并发守卫（含**三处** requestId 判定）+ 4 条提示的**默认 1600ms** 时长

## 3 测试

- [x] 3.1 新增 `apps/desktop/src/views/CreateView.config-profile-composable.test.js`（501 行 / 24 例）
- [x] 3.2 Part A 单元：4 道校验 + 服务端同名 + 并发守卫 + 排序 + 加载失败 + 套用三态 +
      legacy 枚举归一化 + 桥接同引用 + 时间格式化
- [x] 3.3 Part B **壳接线证明** 3 条（mount 真实 CreateView：代理转发、状态留壳、列表真打到 API 层）
- [x] 3.4 **结构锁** 3 条（代理数 / 代理 ⊆ return / return ⊆ 代理）—— 机械锁住两份手工同步的清单
- [x] 3.5 既有回归 **315/315 绿**（6 文件，含 `CreateView.test.js` 与 `s2v-panel-contract.parent-keys`）
- [x] 3.6 变异验证 **4/4 全部被抓住**（M1 名称校验 / M2 并发守卫 / M3 桥接同引用 / M4 结构锁），每步还原后基线绿

## 4 门禁与文档

- [x] 4.1 `check-locale-sync.js --cjk` **PASS**（基线 1330 / 当前 1091 / **无新增硬编码**）
- [x] 4.2 `check-max-lines.js` **PASS**（无新增超大文件；`CreateView.vue` 5562 → 5361，净减 202）
- [x] 4.3 PRD 追加实现章（§6：落点与形态 / 搬走留壳清单 / 桥接契约 / 数据校验 / 流程 /
      交互与显示项 / 12 条提示文字落点 / **6 条与 design 的偏差订正** / 风险 / 验收判据）
- [x] 4.4 执行记录 `openspec/records/createview-config-profile-extract-impl.md`
- [x] 4.5 缺陷复盘（QM-5 ①②④⑤ 四行齐全）：「两份手工同步的清单必须配机械锁」

## 5 不做（明确登记，不假装已闭合）

- [x] 5.1 **不撤除代理层**：19 个代理仍在壳上（过渡机制）；撤除须另起 change，并与
      「代理残留数 ≤ 当前未完成步数」指标同步
- [x] 5.2 **不拆三弹窗**（浮层 owner/释放/断言合同，另起 change）
- [x] 5.3 **不拆 `useS2vConfig` / QuickRender**（复评结论：前者相对触点最重，后者冲突频率 0/50）
- [x] 5.4 **不做视觉回归（QM-4）**：本刀 template 一行未改 ⇒ 界面零变更；`CreateView` 亦无像素基线
