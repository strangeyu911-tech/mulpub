# Design: 发布后效果回流与自动复核

## 1. 归因链

```
workflow_publish_queue entry
  → deps.enqueue() 返回 taskId（TaskQueue.add 的返回值）
  → 发布成功后 tracked_content.publish_history_id = taskId
  → performance_snapshot.tracked_content_id = tracked_content.id
```

只认这条链；没有 taskId 的队列条目、没有 tracked_content 的作品、没有快照的作品都不计入。

## 2. 汇总口径

- 每个 `tracked_content` 只取 `captured_at` 最新的**一份**快照；累计计数跨快照求和会重复。
- 窗口：`captured_at >= now - windowDays`；窗口外快照忽略。
- `views = Σ latest.views`；`interactions = Σ(likes+comments+favorites+shares)`。
- `avgViews = views / samples`；`engagementRate = interactions / views`（views=0 → 0）。
- `samples = 有窗口内快照的 tracked_content 数`。

## 3. 配置

```js
guardrails.performance = {
  enabled: false,
  windowDays: 7,       // 1..90
  minSamples: 3,       // 1..100
  minViews: 0,         // >=0
  minEngagementRate: 0 // 0..1
}
```

启用时校验范围；旧配置归一化为默认值。

## 4. 运行流程

采集 → 护栏截断得到 selected → **效果复核** → 预算预检 → 处理条目。

复核：
1. 未启用 → 放行。
2. provider 缺失/异常/无 store → `performance-unavailable`，fail-closed（用户明确启用却不能判断）。
3. 样本 < minSamples → `insufficient-samples` 放行。
4. avgViews < minViews → `performance-below-views`。
5. engagementRate < minEngagementRate → `performance-below-engagement`。
6. 失败：`run.error=reason`、`run.summary.performanceGuard=detail`、finish failed，不创建条目。

## 5. 显示

运行详情 summary 有 `performance` 时显示：
`发布后效果：{samples} 条作品，平均播放 {views}，互动率 {rate}`。
无数据显示不渲染，不显示 0 冒充。

## 6. 测试

- 纯函数：最新快照、窗口过滤、0 样本、阈值。
- 配置：默认关闭、越界拒绝。
- 队列：派发记录 taskId。
- provider：只统计当前 workflow 的 taskId；无 taskId 返回 0。
- runner：低于阈值暂停、不排期。
- editor：启用后写字段。
