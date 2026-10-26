# 会员中心「实际没生效」缺陷复盘 + 反馈闭环（2026-10-26）

> 分支 `member-center-fixes` ｜ PR #4484 ｜ 方案 `openspec/changes/member-center-feedback-and-fixes/proposal.md`

## 一、本轮最重要的一条教训：**DoD 勾选不等于功能生效**

上一轮（#4395/#4428/#4448/#4461/#4474）把方案 v4 的 P0/P1 全部「收口」并勾选，但 2026-10-26 逐文件复核发现**三个缺陷在代码层真实存在**，且都属于「看起来做完了、实际没生效」：

| 缺陷 | 根因 | 为什么测试没拦住 |
|---|---|---|
| `is_current` 徽章从未显示 | `stores/member.js` 的 `normalizeSession` 白名单不含 `is_current` | `AccountSecurity.test.js` **mock 掉整个 store** 直接注入 `is_current`，从未经过归一化层 |
| 深链 `?section=account` 假空态 | `onMounted` 只设 `activeKey`，`loadSessions()` 只在导航点击 | 无「深链进入后有数据」用例 |
| 「升级 Pro」死按钮 | 缺 `watch(route.query.section → activeKey)`；同路径仅 query 变化不重挂 | 测试只断言 `router.push` **被调用**，不断言 tab 真的切了 |

**两类逃逸模式，值得单独记住**：

1. **mock 掉了被测层**：组件测试 mock 整个 store，等于把「数据从 IPC 到组件的归一化」整层删掉。跨层字段（服务端 → 主进程 → store → 组件）必须在**最靠近数据入口的那一层**也有断言。
2. **断言调用而非效果**：`expect(routerPush).toHaveBeenCalledWith(...)` 只证明「意图发生了」，不证明「用户看到变化」。凡被测性质是「会生效 / 会切换 / 会显示」，判据就必须落在**渲染结果或最终状态**上（AGENTS.md「取证口径」同一条）。

## 二、`create_all` 不会给存量表加列（SQLite）

运营中心 `user_feedback` 增 `category` / `source` 时踩到：SQLAlchemy 的 `Base.metadata.create_all` **只在建表时生效**，已存在的表不会补列。线上库是 SQLite 且早已建表 ⇒ 直接加字段会让写入报 `no such column: user_feedback.category`，反馈功能在**已部署环境全红、在全新环境却全绿**。

正解：幂等 `ALTER TABLE ... ADD COLUMN`（先读 `PRAGMA table_info`，缺哪列补哪列），在 lifespan 里 `init_db()` 之后调用。本仓已有同型实现（`model_preset_service.py` / `prompt_eval_migration.py`）。

**通用形态**：任何「给已有 ORM 模型加列」的改动，都要问一句「存量库怎么拿到这一列」。只测全新库会得到假绿。

## 三、行数门禁新红线：新代码不得引入 ≥500 行文件

`Subscription.vue` 加降档说明后 512 行，触发 `NEW_OVER_LIMIT`（与「挂账文件零增长」是两条不同规则）。**没有抬限额**，按门禁建议拆分：

1. 降档样式迁到 `styles/member-center.css`（会员中心视觉规则本就集中在那里）
2. 注释压缩
3. `planRankOf` 抽到 `labels.js`（与 `planLabelOf` 同类纯函数）

⇒ 494 行，rc=0。**教训**：给接近门禁线的组件加内容前，先看一眼行数；能抽的纯函数先抽。

## 四、复用优先：反馈链路三层本来就存在

用户要求「运营中心增加菜单新功能」，实际勘察发现**三层都已存在**：

- 桌面 `electron/services/feedback.js`（含日志归档 zip）→ `feedback:submit` IPC
- 运营中心 `POST /api/v1/feedback`（`X-Catalog-Key`）+ `GET`（admin 分页）+ 详情 + 附件
- 运营中心前端 `views/UserFeedback.vue` + 菜单「用户反馈」

**正确的增量是**：把入口搬到用户会遇到问题的地方（会员中心「帮助与支持」），并补**分诊字段**（category / source）。如果没先勘察就动手，会造出第二套反馈表和第二个上报通道——那是最贵的重复。

**教训**：接到「新增 X」的需求，先 grep 三层（桌面/服务端/运营端）确认有没有既有实现；有则做增量，没有才新建。

## 五、产品裁决留档

- **降档：不支持自助**。UI 只写「如需降档，请联系客服」，**纯文案、无按钮**。按钮会暗示「点了能降」，是假承诺；测试锁住形状（`[data-testid^="plan-downgrade"]` 必须为 0）。
- **反馈分诊**：未知分类落 `other` 而非 400——分类是分诊辅助，客户端版本旧于服务端时不该让整条反馈丢掉。

## 六、门禁读数

| 项 | 读数 |
|---|---|
| member-center 全量（13 文件） | 160 passed |
| 主进程 feedback + logs | 10 passed |
| 运营中心 feedback API（pytest） | 6 passed |
| locale Gate 7 `--keys` | PASS（2356 keys） |
| `check-max-lines.js` | rc=0 |
