# member-center-fixes 执行记录

> 分支 `member-center-fixes` ｜ 方案：`openspec/changes/member-center-feedback-and-fixes/proposal.md`
> 前序：#4395（Phase 1）/ #4428（Phase 2）/ #4448（Phase 3）/ #4461（is_current + CCG 钩子）/ #4474（is_current 服务端收敛）

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 远程同步 PR #（合并后由门禁推导）

## 一、为什么有这一轮

2026-10-26 对主干做逐文件复核（不照抄 10-19 的方案文档），发现 **三个「看起来做完了、实际没生效」的缺陷**，其中 P0-1 直接让 #4461 + #4474 两轮工作在线上等于白做。

## 二、改了什么

### P0-1 `is_current` 被 store 白名单吞掉

- `apps/desktop/src/stores/member.js`：`normalizeSession` 补 `is_current: source.is_current === true`
- `apps/desktop/src/stores/member.test.js`：新增 4 例（true 保留 / false 保留 / 缺字段落 false / `'true'` 字符串落 false）

**为什么严格 `=== true`**：`is_current` 是明确判定，任何非布尔真值都不该被升格成「这台是当前设备」——保守取值只会退回中性态（合法态），不会误标别人的设备（C1-13）。

**逃逸原因**：`AccountSecurity.test.js` mock 掉整个 store 直接注入 `is_current`，从未经过 `normalizeSession`；`member.test.js` 对 sessions 归一化零字段断言。

### P0-2 深链 `?section=account` 首屏不加载

- `apps/desktop/src/views/MemberCenter.vue`：抽出 `loadForSection(key)`，`onMounted` 深链命中后调用，`activate()` 复用它
- `MemberCenter.test.js`：新增「深链 ?section=account 首屏加载设备并渲染该分区」

### P0-3 页面内点「升级 Pro」不切 tab

- `MemberCenter.vue`：新增 `watch(() => route.query.section)`（URL → state），靠 `section === activeKey` 早退防回环
- `MemberCenter.test.js`：`routeQuery` 改为 `reactive`，新增用例**断言订阅分区真的渲染出来**（不是断言 `router.push` 被调用）

### P1-a 额度页绕过本地化 helper

- `UsageQuota.vue`：接 `quotaLabelOf` / `quotaValueText`
- 新建 `UsageQuota.test.js`（5 例：已知键 / 未知键回退 / -1 不限 / 数字与对象 / 空态）

### P1-b 升级提示与降档

- `Overview.vue`：升级提示 `v-if="!isProActive"` + `data-testid`
- `Subscription.vue`：新增降档说明（纯文案、无按钮）
- locale：`planDowngradeHint`
- 测试：Overview 2 例、Subscription 1 例（断言「没有可点击的降档控件」+ 低档卡片 `aria-disabled`）

### P2 无障碍与死类

- `OrdersBilling.vue`：`aria-label="actions"` → `t('memberCenter.ordersColActions')`
- `styles/member-center.css`：补 `.member-center-single` 定义（模板引用两处、样式从未定义）

### H 帮助与支持 · 反馈表单 + 运营中心分诊

**桌面**
- `HelpSupport.vue`：分类下拉（6 类）/ 内容（10–1000 字，实时计数）/ 联系方式（≤100）/ 诊断信息一键复制 + 默认附带 / 附日志 / 三态结果
- `electron/services/feedback.js`：`submitFeedback` 增 `category` / `source`（白名单收窄，非法值落空串，不丢反馈）
- `electron/ipc-handlers/logs.js`：`feedback:submit` 透传两个新字段
- 新建 `HelpSupport.test.js`（10 例：禁用条件、拼装、诊断附带/取消、includeLogs、成功/失败、复制、版本号）

**运营中心后端**
- `models.py`：`UserFeedback` 增 `category` / `source`
- 新建 `services/feedback_migration.py`：幂等 `ALTER TABLE ADD COLUMN`（`create_all` 不会给存量表加列）
- `main.py`：lifespan 调用迁移
- `feedback_service.py`：`FEEDBACK_CATEGORIES` 白名单（未知落 `other` 而非 400）、`SAFE_SOURCE` 校验、创建/列表/详情返回新字段、列表支持按分类过滤
- `routers/feedback.py`：ingest 增 Form、list 增 Query
- `tests/test_feedback_api.py`：新增分类/来源/过滤用例

**运营中心前端**
- `api/feedback.js`：`listFeedback` 支持 `category`
- `views/UserFeedback.vue`：分类筛选下拉、分类列（带 tag 配色）、详情增分类/来源两行

## 三、复用了什么（没有重复造）

反馈链路**三层本来就有**：桌面 `feedback:submit` → 运营中心 `POST /api/v1/feedback`（`X-Catalog-Key`）→ 前端「用户反馈」菜单。本轮只做两件增量：① 把入口搬进会员中心；② 补分类/来源分诊字段。

## 四、踩坑与纪律

1. **行数门禁新红线**：`Subscription.vue` 加降档说明后 512 行 ≥ 500，触发 `NEW_OVER_LIMIT`（新代码不得引入超大文件）。**没有抬限额**，而是：降档样式迁到 `styles/member-center.css`、注释压缩、`planRankOf` 抽到 `labels.js`（与 `planLabelOf` 同类）⇒ 494 行，rc=0。
2. **`create_all` 不补列**：SQLite 存量库必须有幂等 `ALTER TABLE ADD COLUMN`，否则会员中心反馈在已部署环境全红。已按 `model_preset_service` 同型实现。
3. **未知分类不 400**：分类是分诊辅助，客户端版本旧于服务端时不该让整条反馈丢掉 ⇒ 落 `other`。
4. **测试断言效果而非调用**：P0-3 的旧测试只断言 `routerPush` 被调用，正是它能漏掉的原因。本轮改为断言分区真的渲染。

## 五、测试与门禁读数

| 项 | 读数 |
|---|---|
| member-center 全量（13 文件） | **160 passed** |
| 主进程 feedback + logs | **10 passed** |
| 运营中心 feedback API（pytest） | **6 passed**（含新增分类用例） |
| locale Gate 7 `--keys` | **PASS（2356 keys）** |
| 行数门禁 `check-max-lines.js` | **rc=0（无新增超大文件）** |

## CHANGELOG 条目

# 会员中心修复三个「实际没生效」的缺陷，并把问题反馈做进「帮助与支持」

- 「当前设备」标记此前被数据层白名单整字段丢掉，徽章从未显示且始终提示「未能识别当前设备」；现已在归一化层保留该字段（严格布尔），并补了字段级回归锁
- 用深链直接打开「账号与安全」时设备列表为空（假空态）；现在进入分区即加载，导航与深链走同一条加载路径
- 页面内点「升级 Pro」只改地址栏、界面不切换；已补 URL→视图的反向同步，并把测试从「断言跳转被调用」改为「断言分区真的渲染」
- 额度页此前直接显示 `cloud_publish_monthly`、`-1` 这类裸键裸值，现按本地化词表展示（未知键原样回退）
- 概览的升级提示不再对已付费用户显示；订阅页明确写出「如需降档，请联系客服」，不提供点不动的入口
- 「帮助与支持」从只有版本号的死页变为可提交问题反馈：分类、描述（10–1000 字）、可选联系方式、诊断信息一键复制与默认附带、可选最近日志，提交后由运营中心「用户反馈」按分类查看与筛选
