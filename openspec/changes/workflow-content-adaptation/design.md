# Design: 按平台/账号内容适配（文本层）

## 1. 数据结构

```js
content.adaptation = {
  enabled: true,
  byPlatform: {
    zhihu: { titleMaxLength: 50, bodyMaxLength: 0, titleSuffix: ' | 知乎', tags: ['知乎'] }
  },
  byAccount: {
    'acc-1': { titleMaxLength: 30 }
  }
}
```

- `titleMaxLength` 0 或 1–200；
- `bodyMaxLength` 0 或 100–100000；
- `titleSuffix` ≤40；
- `tags` ≤10 个、每个 ≤30 字。

## 2. 优先级

`byAccount[accountId]` > `byPlatform[platform]` > 无 profile（原文）。

## 3. 文本变换

| 字段 | 规则 |
| --- | --- |
| 标题 | `titleMaxLength>0`：`title.slice(0, max - suffix.length) + suffix`；否则追加 suffix |
| 正文 | `bodyMaxLength>0` 且超长：`content.slice(0, max-1) + '…'` |
| 标签 | 原 tags + profile.tags 去重，最多 10 个 |
| 元数据 | 结果带 `adaptation:{platform,accountId,titleMaxLength,bodyMaxLength}` |

变换是纯函数，不修改入参 article。

## 4. 运行链路

`workflow-runner.scheduleItem`：

```
baseArticle = record._article || buildArticle(item, type)
for target:
  targetArticle = adaptArticle(baseArticle, target, config.content.adaptation)
  schedulePublish({ target, article: targetArticle, ... })
```

- 每个目标独立 article；队列 `article` 即最终发布稿。
- 多目标回滚逻辑不变（仍按 scheduleIds 撤回）。
- 审核流程不变；审核保存基础稿，排期时再适配。

## 5. UI

- 内容区 checkbox「按平台适配标题/正文/标签」。
- 仅显示 `publish.targets` 中出现过的平台；无目标时提示先选账号。
- 每行：标题上限、正文上限、标题后缀、追加标签。
- 提示文案明确「只改文本，不改封面/视频比例」。

## 6. 错误

| 场景 | 错误 |
| --- | --- |
| 启用但无 profile | `content.adaptation: empty` |
| 未知平台 | `content.adaptation.byPlatform.X: unsupported` |
| 字数越界 | `...titleMaxLength/bodyMaxLength: outOfRange` |
| 后缀/标签超限 | `tooLong/tooMany` |
| 无目标的平台行 | 不渲染，避免空配置 |

## 7. 测试

- `workflow-adaptation.test.js`：归一化、校验、账号优先级、标题/正文/标签变换。
- `workflow-schema.test.js`：合法/空/未知平台。
- `workflow-runner.test.js`：排期 article 已适配。
- `WorkflowEditor.test.js`：启用后显示平台行并写入 titleMaxLength。
