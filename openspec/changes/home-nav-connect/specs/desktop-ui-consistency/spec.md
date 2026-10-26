# desktop-ui-consistency — 首页导航连通性与发布记录快捷筛选

## ADDED Requirements

### Requirement: 首页入口必须落到真实动作，而不是只落到页面

首页上语义为「执行某动作」的入口 MUST 在跳转后接续该动作。当前明确的两条：

- 「添加账号」MUST 跳到账号页并自动打开添加账号浮层；
- 「已绑定账号」MUST 跳到账号页但 MUST NOT 自动打开添加账号浮层（查看与添加是两种意图）。

#### Scenario: 首页添加账号

- **WHEN** 用户点击首页「添加账号」
- **THEN** 路由变为 `/accounts?action=add-account`，账号页打开添加账号浮层
- **AND** 参数被消费后从 URL 移除，刷新或后退不会重复弹层
- **AND** `action` 非 `add-account` 时不弹层、不改 URL

#### Scenario: 已绑定账号卡

- **WHEN** 用户点击首页「已绑定账号」统计卡
- **THEN** 路由变为 `/accounts`，不自动打开添加账号浮层

### Requirement: 首页数据卡必须可行动

首页总发布 / 成功 / 失败 / 已绑定账号四张卡 MUST 为原生可点击控件，点击后落到与数字语义一致的目标：

- 总发布 → `/publish/history?status=all`
- 成功 → `/publish/history?status=success`
- 失败 → `/publish/history?status=failed`
- 已绑定账号 → `/accounts`

#### Scenario: 点击失败卡

- **WHEN** 用户点击「失败」统计卡
- **THEN** 发布记录页加载并选中「发布失败」状态标签
- **AND** 只显示归一化状态组为 `failed` 的记录

#### Scenario: 键盘操作

- **WHEN** 焦点在统计卡上并按 Enter 或 Space
- **THEN** 与鼠标点击走同一路由出口

### Requirement: 发布记录状态筛选必须是单一实现并支持深链

发布记录页 MUST 提供「全部 / 发布成功 / 发布失败 / 处理中」四个状态快捷标签，MUST 移除同能力的状态下拉框（不得保留两套控件）。状态值 MUST 支持 `?status=success|failed|pending` 深链；`all` 与缺省等价；非法值 MUST 归一化为「全部」。

#### Scenario: 从首页失败卡进入

- **WHEN** 用户从首页失败卡跳到 `/publish/history?status=failed`
- **THEN** 「发布失败」标签为 `aria-pressed="true"`，列表只显示失败组记录

#### Scenario: 点击状态标签

- **WHEN** 用户点击「发布成功」
- **THEN** 列表即时只显示成功组记录，URL 更新为 `?status=success`
- **AND** 点击「全部」后 URL 中不再包含 `status`

#### Scenario: 非法状态值

- **WHEN** 用户访问 `/publish/history?status=not-a-status`
- **THEN** 页面回落到「全部」，不抛错、不空白

### Requirement: 首页快捷入口必须反映当前高频需求

首页快捷入口第 6 项 MUST 为「视频创作」，路由 `/create`，图标使用 Element Plus `VideoCamera` 线性图标，尺寸与颜色继承既有快捷入口样式。原「私信评论」路由与页面 MAY 保留，但 MUST NOT 继续占用该快捷位。

#### Scenario: 点击视频创作

- **WHEN** 用户点击第 6 个快捷入口
- **THEN** 路由变为 `/create`
- **AND** 图标与其它快捷入口同尺寸、同继承色，不使用 emoji

### Requirement: 首页近期动态必须能打开有公开作品链接的记录

近期动态 MUST 复用发布记录页的作品链接判据（`usePublishHistoryContentLink`）：

- 有公开作品页 → 整行渲染为 `<a>`，点击在应用内新标签打开；
- 只进草稿箱 / 平台无公开页 / 未抓到作品 ID → MUST NOT 生成链接，渲染为普通行并在 `title` 说明原因；
- `createTab` 不可用或失败 → 回退 `window.open`，由主进程外链白名单兜底。

#### Scenario: 有链接记录

- **WHEN** 某条近期动态的 `result.postId` 合法且平台有公开内容页规则
- **THEN** 该行是 `<a>`，`href` 为解析后的公开页，点击调用 `tabStore.createTab`

#### Scenario: 草稿记录

- **WHEN** 记录的 `result.draft === true`
- **THEN** 该行不可点，`title` 说明是草稿，不生成假链接

### Requirement: 发布页必须提供稳定的发布记录入口

发布页 MUST 在页头提供可见的「发布记录」入口，点击进入 `/publish/history`；该入口 MUST NOT 只在「定时发布已创建」结果卡分支中出现。

#### Scenario: 发布页页头

- **WHEN** 用户打开发布编辑页
- **THEN** 页头存在「发布记录」按钮，点击进入发布记录页
- **AND** 草稿箱视图不渲染该按钮

### Requirement: 新增文案必须 zh/en 成对且不出现渲染端中文字面量

本 change 新增的用户可见文案 MUST 写入 `src/locales` 的 zh/en 文件并成对提交；渲染端组件 MUST NOT 新增中文字符串字面量。

#### Scenario: 英文界面

- **WHEN** 界面语言切换为英文
- **THEN** 首页快捷入口显示 `Video Creation`，发布页入口显示 `Publish History`，状态标签显示 `All / Published / Failed / Processing`
