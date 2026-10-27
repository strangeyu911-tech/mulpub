# Proposal: 按平台/账号内容适配（P1-9，文本层）

## Why

同一篇内容发到知乎、微博、B站时，标题长度、正文截断、标签习惯不同。当前只能全平台共用一份 article，容易出现标题被平台截断、标签缺失。

## What Changes

- `content.adaptation` 配置：
  - `enabled`；
  - `byPlatform[platform]` 与 `byAccount[accountId]` profile；
  - profile：`titleMaxLength`（0=不限）、`bodyMaxLength`（0=不限）、`titleSuffix`、`tags`。
- 账号 profile 优先于平台 profile。
- `workflow-adaptation.js` 做确定性文本变换；runner 在 `schedulePublish` 前按 target 生成 `targetArticle`，队列中每个目标拿到自己的标题/正文/标签。
- UI：内容区新增「按平台适配标题/正文/标签」；只为已选账号平台显示行；字段含标题上限、正文上限、标题后缀、追加标签。
- 校验：未知平台、越界字数、后缀超长、标签过多、启用但无 profile 均拒绝。

## Non-goals / 边界

- **封面/视频比例不在本期伪实现**：媒体变体裁剪需要发布器/视频流水线支持，当前 UI 明确写「只改文本，不改封面/视频比例」。留待媒体管线接入后单独实现。
- 不做按平台改写风格（策略仍全局）。
- 不做 HTML 结构感知截断；正文按字符截断并加省略号。

## Impact

- 配置向后兼容：旧配置 adaptation 默认 `{enabled:false}`。
- 队列 article 新增 `adaptation` 元数据，发布器可观测；文本字段已是适配后的值。
- 审核保存的 `_article` 是基础稿，排期时才按目标适配。
