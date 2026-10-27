# Design: 排期规则

## 1. 配置

```js
scheduleRules = {
  enabled: false,
  timezone: 'Asia/Shanghai',
  weekdays: [1,2,3,4,5],
  quietHours: { start: '23:00', end: '07:00' }
}
```

- 默认关闭；只有 enabled=true 才参与顺延。
- `weekdays` 去重、排序；空数组在启用时拒绝。
- `quietHours.start === end` 视为无效（启用时拒绝），不解释为 24 小时静默。
- 时区用 `Intl.DateTimeFormat` 验证，非法值拒绝。

## 2. 顺延算法

`nextAllowedSlot(candidateMs, rules)`：

1. 未启用 → 原样返回。
2. 从 candidate 开始，按 1 分钟步进，最多 14 天。
3. 用 IANA 时区取本地 weekday 与 minutes。
4. 工作日不在 weekdays → 跳过。
5. minutes 在静默窗口 → 跳过；跨午夜用 `minutes>=start || minutes<end`。
6. 首个满足的分钟返回；14 天都不满足返回 `null`，pacer 抛 `RangeError`（fail-closed），不把非法时刻静默放过。

缓存 `Intl.DateTimeFormat` 按 timezone，避免每条排期重复构造。

## 3. Pacer 集成

`createPacer({scheduleRules})`：
- 首条：`max(startAt, now)` → `nextAllowedSlot`；
- 后续：`last + gap` → `nextAllowedSlot`；
- `lastByTarget` 存顺延后的时刻，保证同账号后续间隔仍基于实际排期。

`estimatePlan` 把 `config.scheduleRules` 传给 pacer；预览与运行时同一算法。

## 4. UI

节奏区：
- checkbox「启用排期规则（静默时段 / 工作日 / 时区）」；
- 时区下拉（Asia/Shanghai、Asia/Tokyo、UTC、Europe/London、America/New_York）；
- 7 个工作日 chips，多选；
- 静默起止 `type=time`；
- 提示「静默时段内不排期，跨午夜自动顺延」「规则只影响新排期；已入队条目不会回改」。

## 5. 错误

| 场景 | 错误 |
| --- | --- |
| 时区非法 | `scheduleRules.timezone: invalid` |
| 工作日为空 | `scheduleRules.weekdays: empty` |
| 静默起止相同 | `scheduleRules.quietHours: sameTime` |
| 非法 HH:mm | 保留原值，`scheduleRules.quietHours: invalidTime` 拒绝 |

## 6. 测试

- 模块：默认值、去重、非法时区/空工作日/相同起止、跨午夜、周末顺延、未启用原样。
- pacer：静默首条顺延到 10:00。
- schema：默认关闭、启用合法、非法拒绝。
- editor：启用后写时区/静默时间。
