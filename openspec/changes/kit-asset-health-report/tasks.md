# tasks — kit-asset-health-report

> 方案：`proposal.md`（同目录）。所有行数为**实测**，不写预算值。
> ⛔ 不动写路径安全语义（锁 / 白名单 / R0 / 哈希对账 / 审计）；本轮只「挪入口 + 加只读体检」。

## 1. 服务层（TDD）

- [ ] 1.1 **RED** `kit-inspect.test.js`：先写失败用例
  - 合法包 ⇒ `ok:true` + `importable:true` + counts 逐项正确（scenes/shots/references/templateTasks/templateFiles/langs）
  - 缺必填文件 ⇒ `ok:true`（体检跑通）+ `importable:false` + `blockingReason` 非空 + `requiredMissing` 含该文件名
  - 目录不存在 / 不是目录 ⇒ `ok:false` + reason 闭集值（**不是** `importable:false`）
  - 白名单外顶层条目 ⇒ `ignoredTopLevel` 含它，且**不影响** `importable`
  - 参考条目无 URL ⇒ `UNRESOLVED_REFERENCE` 告警计数正确
  - 分镜带 `resultUrl` ⇒ `shotsWithResult` 计数正确 + `SHOTS_WITH_RESULT` 告警在
  - 缺 v7 增强（宽松模式有 `assetWarnings`）⇒ 汇总成 `MISSING_V7_ASSET`
  - **只读断言**：跑完体检后源目录**一字节未变**（递归清单 + mtime 对比），且**没有**在 userData 下产生锁/审计文件
- [ ] 1.2 **GREEN** `services/film-engineering/kit-inspect.js`：`inspectKit({kitDir, fs})` 三遍读（scan → 宽松 → 严格）
- [ ] 1.3 `INSPECT_REASON` / `WARN_CODE` 作为**导出闭集**（契约测试逐值比对 `SCHEMA.md`）

## 2. IPC 与接线

- [ ] 2.1 **RED** `film-engineering-inspect.test.js`（IPC 契约）
  - 外部网页 / 子框架 / 协议不对 / 路由不匹配 ⇒ `UNAUTHORIZED_SENDER`
  - 取消对话框 ⇒ `{ code:0, data:{ cancelled:true } }`（不算失败）
  - UNC / 非目录 ⇒ `NOT_A_DIRECTORY`
  - 成功 ⇒ `code:0` + 报告字段齐备
  - **入参为空**：renderer 传任何参数都不改变行为（路径只来自对话框）
- [ ] 2.2 **GREEN** `ipc-handlers/film-engineering-inspect.js`（导出形态与同族一致：**模块本身可调用** + 具名导出）
- [ ] 2.3 `ipc-handlers/index.js` 接线 + `preload/film-engineering.js`（`inspectKit()` 空参）
- [ ] 2.4 `preload/access-control.js` 登记 `filmEngineering.inspectKit` 为 **public**（只读、无落盘）+ 回归锁用例
- [ ] 2.5 `src/api/publisher.js` 桥接 `filmEngineeringInspectKit()`

## 3. 渲染端

- [ ] 3.1 **RED** `FilmAssetManager.test.js`：入口在 Hub 页头 / 点入口先选目录 / 体检报告逐项渲染 / `importable:false` 时**禁用**确认按钮并显示缺项 / 确认后才调 `importKit` / 导入中不可中断 / 成功但有残留时告警
- [ ] 3.2 **GREEN** `components/FilmAssetManager.vue`（摘要 + 导入按钮 + 体检报告卡片 + 确认框 + 不可中断模态 + 恢复/残留/审计告警）
- [ ] 3.3 `useFilmKitImport.js`：新增 `inspectAssets()` + `inspection` 状态；`importKitAssets()` 复用
- [ ] 3.4 `views/FilmEngineeringHubView.vue` 页头挂载；`views/FilmEngineeringView.vue` 移除旧挂载（净 -2 行）
- [ ] 3.5 **RED→GREEN** Hub 结构锁同步：`FilmEngineeringHubView.test.js` 断言「页头有资产区」「资产区**不在**任何 tabpanel 内」「classic 面板里**不再有**导入入口」
- [ ] 3.6 i18n `locales/film-engineering/{zh,en}.js` 新增键**成对**

## 4. 契约与文档

- [ ] 4.1 `SCHEMA.md` 新增「十二、资产体检契约」（字段 / `reason` 取值 / 告警 code 闭集 / 与 §11 的关系）
- [ ] 4.2 `kit-schema-contract.test.js` 扩展：体检小节存在且非空、告警 code 逐值与代码一致
- [ ] 4.3 PRD 新增 §9.d + **修正 §9.c.4 的旧入口口径**（「项目案例标签顶部」→「Hub 页头资产区」）
- [ ] 4.4 `openspec/records/kit-asset-health-report.md`（门禁表 + 远程同步表行 + bullet 两形态）

## 5. 门禁与交付

- [ ] 5.1 本地门禁：行尾两口径 / U+FFFD+NUL / ESLint / `check-max-lines` / locale 三档 / 品牌残留 / 文档绝对路径
- [ ] 5.2 桌面端相关域测试全绿（影视工程 + preload + Hub + 装配锁 `tests/ipc-handlers.test.js`）
- [ ] 5.3 ⚠ **新接 IPC ⇒ 必须跑整面装配锁**（`tests/ipc-handlers.test.js` + `performance-loop.test.js` 的 T21b/T21e）——
      PR-3b 曾因导出形态与同族不一致让整条注册面挂掉，本地单测测不到
- [ ] 5.4 QM-1 打包 + 归属自证（asar 内命中本次新增符号）；QM-4 视觉基线（Hub 页头变化）
- [ ] 5.5 CCG 决策层评审（方案）+ 验证层双家族评审（实现）；逐条闭环
- [ ] 5.6 PR → CI 全绿 → squash 合并 → main push 回读

## 验收（可执行）

| 判据 | 命令 | 期望 |
|------|------|------|
| 体检只读 | `pnpm exec vitest run electron/services/film-engineering/kit-inspect.test.js` | 全绿，含「源目录零改动 + 无锁无审计」用例 |
| 入口归位 | `pnpm exec vitest run src/views/FilmEngineeringHubView.test.js` | 页头有资产区、tabpanel 内无导入入口 |
| 装配锁 | `pnpm exec vitest run tests/ipc-handlers.test.js electron/ipc-handlers/performance-loop.test.js` | 全绿（新通道挂上且导出形态正确） |
| 不破坏既有 | `pnpm exec vitest run electron/services/film-engineering electron/ipc-handlers/film-engineering-import.test.js` | 全绿（写路径语义未变） |
