# Design: 账号选择体验

## 1. 数据流

`props.accounts`（主进程注入）→ `accountGroups`（按 platform 分组）→ `filteredAccountGroups`（搜索过滤）→ 渲染。

- `accountSearch` 为空：返回原分组，不改变顺序。
- 搜索字符串 trim + lowercase；匹配字段：
  `accountLabel(acc)`（name/nickname/remark/id）、`acc.platform`、平台显示名、`acc.status`、`acc.remark`。
- 过滤后空分组移除；全部为空时显示无结果提示。

## 2. 全选与清空

- `selectAllVisible()`：遍历 `visibleAccounts`，跳过 `isAccountUsable=false` 与已选账号，push `{platform, accountId}`。
- `clearAccounts()`：清空 `model.publish.targets`（包括搜索前已选但当前不可见的账号；文案明确「清空已选」）。
- 不改变过期账号的 disabled 状态。

## 3. 最近使用

- localStorage key `workflow_recent_accounts`，值为账号 ID 数组，最多 10 个。
- 点击账号（勾选/取消）时 `rememberAccount`：把 id 移到数组首位、去重、截断 10。
- `recentAccounts` 按最近顺序映射回 `props.accounts`，只保留可用账号，展示最多 5 个。
- 读取/写入异常（隐私模式、坏 JSON）静默降级为空数组；不阻塞页面。

## 4. 健康状态

- `usableCount`：有 id 且 `isAccountUsable`。
- `unusableCount`：有 id 且不可用。
- 文案「可用 {usable} 个 · 不可用 {unusable} 个」。

## 5. 交互与提示

| 元素 | 文案 |
| --- | --- |
| 搜索框 placeholder | 搜索账号名称 / 平台 / 备注 |
| 全选按钮 | 全选当前结果 |
| 清空按钮 | 清空已选 |
| 最近使用 | 最近使用 |
| 无结果 | 没有匹配的账号 |
| 健康汇总 | 可用 N 个 · 不可用 M 个 |

## 6. 测试

- 搜索「小号」只显示知乎小号；全选只选它；清空归零。
- 健康汇总显示可用 2 / 不可用 1。
- 原有同平台多选、过期禁用、空态测试保持通过。
- build、locale symmetry、max-lines。
