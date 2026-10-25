# Tasks: createview-config-profile-extract

> 本 change 的范围 = **复评 + 第一刀规格定案**。
> `scripts/openspec-sync-check.js` 的 `ACTIVE_CHANGE_TASKS_INCOMPLETE` 判据要求 active change 的
> tasks **无未完成项** ⇒ 故本清单**只列本轮实际完成并已取证**的事项；
> **实现不在本 change**（见 design.md §10「后续 change 预告」与 proposal.md 的「Why」）。

## 1 复评（前置：读完仓内定案再动手）

- [x] 1.1 全树搜 `01-docs/` 的定案文档 ⇒ 找到 `FRONTEND-FILE-SPLIT-PLAN-2026-10.md`（v3/v4）
      与 `PRD-CREATEVIEW-DEBT-SPLIT.md` ⇒ 确认**仓内已有一套拆分规格**，本轮不重复发明
- [x] 1.2 读定案 §2.1（目标结构）/ §2.2（拆分顺序与 v4 收口）/ §2.3（红线：方法代理 + 状态桥接两层过渡）
      / §2.4（浮层互斥合同）/ §2.8（CKJ 预检）/ §2.9（复评收口的数据依据）/ §五（执行纪律）/ 附录 B·C（审查记录）
- [x] 1.3 读 `PRD-CREATEVIEW-DEBT-SPLIT.md` ⇒ 确认其结论已被定案文档取代
- [x] 1.4 判定：定案 §2.9 的「第 5 步不做」是**基于 2026-10-10 数据的时点结论** ⇒ 需复评
- [x] 1.5 盘点在飞 PR（40 条）⇒ **无一改 `CreateView.vue`**；`#4387`/`#4378` 改的是
      `S2vConfigPanels.vue` 与 `composables/tts-voices-*` ⇒ 记录避让面

## 2 复评数据（全部当场实测，无推算值）

- [x] 2.1 文件规模演进：`c576b2dea`（里程碑 2 收口，4896 行）→ `origin/main@558fbb72`（5563 行）
      ⇒ diff 为 **+928 / −261**
- [x] 2.2 增量归因：顶层选项 diff ⇒ `methods` 新增 15 / 删除 9，`computed` 新增 26 / 删除 7
      ⇒ **30 项新增里 22 项属数字人域**；而数字人域**已被拆**（`useAvatarCatalog` 138 行 +
      `useAvatarClone` 398 行）⇒ CreateView 侧剩**桥接层** ⇒ **不是新候选**
- [x] 2.3 冲突频率（★主证据，与定案 §2.9 同源可比）：近 50 次改动 `CreateView.vue` 的 commit 逐个归域
      ⇒ **ConfigProfile 1/50（2%）**，对照基线 **7/50（14%）⇒ −86%**
- [x] 2.4 触点（⚠ 口径与定案不同源 ⇒ 只做同次测量内相对排序）：`useS2vConfig` 相对最重、
      `ConfigProfile` 与已拆的批量创作同量级
- [x] 2.5 CJK 预检：`check-locale-sync.js --cjk` 当前 **PASS（基线 1330 / 当前 1095 / 无新增）**
      ⇒ 方法体中文 fallback 已被 i18n 迁移清偿 ⇒ **locale 补全量 = 0**
- [x] 2.6 `data` 键数实测 **122** ⇒ `data.size > 80` 余量 **42 键** ⇒ 推出「本刀不抽 `data` 状态」

## 3 规格定案（写入 PRD）

- [x] 3.1 复评结论表：QuickRender 维持不做 / `useS2vConfig` 维持不做 / **ConfigProfile 重新成为候选**
      / 数字人域非候选
- [x] 3.2 第一刀范围：只抽 `useConfigProfiles` composable（22 项 / 约 245 行），落点
      `video-creation/composables/useConfigProfiles.js`，**不新建目录**（定案 §2.1）
- [x] 3.3 **不连带拆三弹窗**（会触发 §2.4 浮层硬门禁 ⇒ 本刀风险面从「最高」降到「中」）
- [x] 3.4 状态处置：**状态留壳 `data()`**（`data.size` 仍 122、余量 42 不被消耗）+
      composable 走**显式 deps** + **实例级闭包**（不照抄既有三批的模块级单例 / `window.__*` 遗留形态）
- [x] 3.5 桥接两条兼容契约（整体赋值 / 原地变异返回同引用）+ 禁止把 composable ref 挂进 `data()`
- [x] 3.6 **数据校验**：名称非空 / 流水线已选 / 重名二次确认 / 并发守卫 / 快照套用逐项类型判定
- [x] 3.7 **流程**：保存 / 列表 / 套用 / 重命名 / 删除 / 路由套用 六条用户路径与各自分支
- [x] 3.8 **交互与显示项**：本刀不抽模板 ⇒ 弹窗、按钮、提示位置、toast 2200ms **零变更**
- [x] 3.9 **提示文字**：新文件零中文字面量；残留则走 locale 并在 `locales/create/{zh,en}.js` 成对补
- [x] 3.10 风险清单（含 CJK 基线 `file:line` 失配 ⇒ 须重生成基线；新增测试文件改变 vitest 分片）
- [x] 3.11 验收判据表（文件行数 / `data.size` / 旧测试 288/288 / 新测试覆盖 / QM-4 / Gate 7 / 门禁）
- [x] 3.12 与既有文档的关系表（定案文档继续有效；仓外底稿降级为分析底稿）

## 4 收口

- [x] 4.1 新增 `01-docs/PRD-CREATEVIEW-SPLIT-REVIEW-2026-10-25.md`（复评报告 + 第一刀定案）
- [x] 4.2 在定案文档加指针节，指向本复评，**不改其既有结论性内容**
- [x] 4.3 建立 openspec change 四件套（proposal / design / tasks / specs）
- [x] 4.4 执行记录 `openspec/records/createview-config-profile-extract.md`（状态列写「由门禁推导」）
- [x] 4.5 门禁自检：`openspec-sync-check` / `check-gate-record-debt` / `check-record-qm5-rows` /
      `check-doc-abs-paths` / `check-max-lines` / `check-debt-budget`
- [x] 4.6 ⭐ 纪律复现入档：**先全树搜 `01-docs/` 定案文档再动手**（本轮最初按仓外底稿选域，
      差点重做一件仓内已否决的事）
- [x] 4.7 实现另开 change（`createview-config-profile-extract-impl`），**本 change 不含实现**
      （实现须与 QM-4 像素回归同批完成）
