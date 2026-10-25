## ADDED Requirements

### Requirement: 主进程可达的创作者后台采集通道

系统 SHALL 提供一条在**主进程内闭环**的账号级数据采集通道：打开（复用）隐藏窗口 → 注入该账号登录态 → 导航到平台创作者后台 → 执行平台抽取脚本 → 返回结构化数据。

该通道 SHALL 由 `RpaViewManager` 暴露为 `collect` 入口，并 SHALL 复用 `rpa-view-session.js` 已有的窗口池（按 `platform + accountId` 复用、带 TTL 回收）与账号 cookie 注入能力，不得新造窗口管理机制。

该通道 SHALL NOT 经渲染进程中转：不得新增 preload API，不得新增 `rpa:fetchData` 之类的 IPC 通道。

采集逻辑 SHALL 落在独立的新文件 `apps/desktop/electron/services/rpa-view-collector.js`；`apps/desktop/electron/services/rpa-view-platforms.js` SHALL 保持**零改动**（该文件在门禁「点名还账」清单内、target 容差为 0）。

#### Scenario: 主进程能取到采集执行体

- **WHEN** 主进程构造 `DataSyncService`
- **THEN** 该服务 SHALL 持有注入进来的采集执行体（`rpaViewManager`），且 SHALL NOT 在 `packages/shared-utils` 内 require desktop 的 electron 模块

#### Scenario: 采集复用窗口池而非每次新开窗口

- **WHEN** 对同一 `(platform, accountId)` 连续采集两次
- **THEN** 第二次 SHALL 复用窗口池中的既有窗口，不新建隐藏窗口

#### Scenario: 采集不新增渲染进程暴露面

- **WHEN** 盘点本 change 的改动面
- **THEN** preload 的 API 集合 SHALL 与改动前逐字相同（不新增任何方法）

### Requirement: 采集结果必须 fail-loud（禁止假 0）

采集结果 SHALL 通过以下校验，任何一项不成立 SHALL 抛错，**绝不**返回带数值的部分结果：

1. **字段存在性**：抽取脚本未命中目标元素 ⇒ 抛 `COLLECT_FIELD_MISSING`；
2. **数值合法性**：命中但值不是有限非负数 ⇒ 抛 `COLLECT_VALUE_INVALID`；
3. **平台归属**：返回的 `platform` 与请求平台不一致 ⇒ 抛 `COLLECT_PLATFORM_MISMATCH`。

抽取脚本 SHALL NOT 保留 `parseInt(x || '0')` 之类的数值兜底——「元素缺失」与「值确实是 0」必须能被区分。

采集失败 SHALL 只产出带 `error` 的记录，SHALL NOT 在该记录里写入任何数值字段。

#### Scenario: 元素缺失时不产生任何数值

- **WHEN** 抽取脚本未命中目标元素
- **THEN** 采集 SHALL 抛 `COLLECT_FIELD_MISSING`，且该次采集的记录里 SHALL NOT 出现 `followers` / `views` 等任何数值字段

#### Scenario: 元素存在但值不可解析时也抛错

- **WHEN** 目标元素存在但其文本不是可解析的数字
- **THEN** 采集 SHALL 抛 `COLLECT_VALUE_INVALID`，SHALL NOT 把它折成 `0`

#### Scenario: 真的是 0 时能区分出来

- **WHEN** 目标元素存在且其值确为 `0`
- **THEN** 采集 SHALL 成功返回数值 `0`，且该记录 SHALL NOT 带 `error`

### Requirement: 采集必须受节流与并发上限约束

系统 SHALL 同时实施三层约束：

1. **TTL 缓存**：沿用既有 `TTL_DEFAULT`（1 小时）；
2. **同平台最小采集间隔**：距该平台上次采集未达最小间隔时 SHALL 返回缓存且**零请求**；
3. **全局采集并发**：同一时刻 SHALL 至多有 1 个采集在途。

最小采集间隔 SHALL 可配置；缺省值 SHALL 为 30 分钟（**建议值**，平台风控真实阈值无公开数据）。

#### Scenario: 最小间隔内不重复请求平台

- **WHEN** 同一平台在最小采集间隔内被再次请求
- **THEN** 系统 SHALL 返回既有缓存，SHALL NOT 向平台发起任何请求（断言网络层零调用）

#### Scenario: 并发上限为 1

- **WHEN** 同时请求 5 个平台的采集
- **THEN** 任一时刻在途的采集 SHALL 不超过 1 个

#### Scenario: 失败不得触发重试轰炸

- **WHEN** 某平台采集失败
- **THEN** 系统 SHALL NOT 自动重试该平台采集

### Requirement: 采集必须绑定账号，缺失时零请求

采集 SHALL 绑定具体 `accountId`（平台创作者后台是账号级登录态）。该平台无已登录账号时，系统 SHALL 记 `skipped(no-account)` 并 SHALL NOT 发起任何请求，SHALL NOT 取默认账号凑数。

多账号平台 SHALL 采集仓内既有约定选定的那个账号，并在采集记录中写明 `accountId` 供界面标注。

#### Scenario: 无已登录账号时不请求平台

- **WHEN** 某平台没有任何已登录账号
- **THEN** 该平台 SHALL 被记为 `skipped(no-account)`，且 SHALL NOT 向平台发起请求

#### Scenario: 记录写明采集所用的账号

- **WHEN** 某平台采集成功
- **THEN** 该记录 SHALL 包含所用的 `accountId`

### Requirement: 账号级粉丝的呈现与口径标注

界面 SHALL 展示账号级粉丝数，遵循三态纪律（取不到就不显示数字）：

| 态 | 显示 |
| --- | --- |
| 有可信值 | 数字 |
| 从未成功采集过 | 「—」＋「尚未采集粉丝数据」 |
| 采集失败 | 「—」＋「粉丝数据暂时无法获取（{reason}）」 |

粉丝位 SHALL 单独标注**账号级**口径。作品级指标（阅读 / 点赞 / 评论，来自发布后回采）与账号级指标（粉丝，来自创作者中心）SHALL NOT 在未标注的情况下混读。

提示文案 SHALL 以 zh / en 成对形式落在 `apps/desktop/src/locales/dashboard/{zh,en}.js`。

#### Scenario: 有可信值时显示数字并标注账号级

- **WHEN** 某平台的粉丝采集成功且值为 12000
- **THEN** 粉丝位 SHALL 显示 `12000`，且该位 SHALL 带账号级口径标注

#### Scenario: 从未采集过时显示占位而不是 0

- **WHEN** 某平台没有任何粉丝采集记录
- **THEN** 粉丝位 SHALL 显示「—」并给出「尚未采集粉丝数据」，SHALL NOT 显示 `0`

#### Scenario: 采集失败时给出原因

- **WHEN** 某平台粉丝采集失败
- **THEN** 粉丝位 SHALL 显示「—」并给出含原因的提示，SHALL NOT 显示 `0`

#### Scenario: 账号级与作品级指标各自标注

- **WHEN** 平台卡同时展示作品级阅读数与账号级粉丝数
- **THEN** 两类指标 SHALL 各自带口径标注，用户 SHALL NOT 需要猜测某个数字是账号级还是作品级
