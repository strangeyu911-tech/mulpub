# Proposal: 排期规则（P1-10）

## Why

只有 35–40 分钟间隔还不够：用户不希望半夜发、周末发，或希望按某个时区的工作日发。现有 `cadence` 只管间隔，`guardrails.dailyItemLimit` 只管每日总量，缺「什么时候允许发」这一层。

## What Changes

- `scheduleRules` 配置：
  - `enabled`（默认 false，升级不改变既有任务）；
  - `timezone`（IANA，默认 Asia/Shanghai）；
  - `weekdays`（1=周一…7=周日，默认周一至周五）；
  - `quietHours.start/end`（HH:mm，支持跨午夜）。
- `workflow-schedule-rules.js`：
  - `normalizeScheduleRules` / `validateScheduleRules`；
  - `nextAllowedSlot` 按 IANA 时区逐分钟顺延，最多找 14 天；
  - 静默时段跨午夜、工作日过滤。
- `createPacer` 接受 `scheduleRules`，首条和后续每条都顺延到允许窗口；`estimatePlan` 同步。
- UI 在节奏区新增开关、时区下拉、工作日 chips、静默起止。
- 与现有 `guardrails.dailyItemLimit` 合并使用，不另造每日上限。

## Non-goals

- 不做节假日/农历/调休日历。
- 不改已入队条目的 publishAt；规则只影响新排期。
- 不做按平台不同时区（工作流级时区）。

## Impact

- 默认关闭，旧任务行为不变。
- 时区非法/工作日为空/静默起止相同/非法 HH:mm 会在保存时拒绝。
- 顺延可能导致计划跨度变长，预览会反映。
