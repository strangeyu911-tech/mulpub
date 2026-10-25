## ADDED Requirements

### Requirement: 分片覆盖率产物的合并判定

系统 SHALL 提供一个判定器，把 N 份 istanbul 格式的覆盖率产物合并成一张全局覆盖率映射，并按 **vitest 原生阈值语义**判定全局阈值。
判定器 SHALL NOT 硬编码阈值数字 —— 阈值真源 SHALL 是 `apps/desktop/vitest.config.js` 的 `test.coverage.thresholds`。

#### Scenario: 合并是并集而非稀释

- **WHEN** 同一文件被两个分片**互补**覆盖（片 A 命中第一条语句、片 B 命中第二条语句）
- **THEN** 合并后的全局 statements 百分比 SHALL 等于**两条语句都被命中**的读数（100%），SHALL NOT 等于任一单片读数（50%）

#### Scenario: 合并口径与全量口径一致

- **WHEN** 同一批测试分别以「两片分片」与「单次全量」两种方式产出覆盖率
- **THEN** 两片合并后的四项读数 SHALL 与全量产物的四项读数**逐字相同**

#### Scenario: 阈值真源唯一

- **WHEN** 判定器被调用
- **THEN** 阈值 SHALL 读自 `apps/desktop/vitest.config.js`；判定器源码 SHALL NOT 出现那四个阈值数字（注释除外）

#### Scenario: 判定依据可替换（离线/单测）

- **WHEN** 判定器被传入一个 `--config` 指向的替代阈值真源
- **THEN** 判定 SHALL 按该替代真源的阈值执行（同一份覆盖率产物在宽松阈值下达标、在严格阈值下判红）

### Requirement: 阈值判定语义与 vitest 原生一致

判定器 SHALL 采用与 vitest 相同的阈值语义：
`threshold >= 0` ⇒ 最低百分比（红的条件是 `pct < threshold`）；
`threshold < 0` ⇒ 最大未覆盖数（红的条件是 `uncovered > -threshold`）。
错误文案 SHALL 与 vitest 同形：`ERROR: Coverage for <key> (<pct>%) does not meet global threshold (<threshold>%)`。

#### Scenario: 低于百分比阈值判红

- **WHEN** 合并后的 statements 百分比低于配置的最低百分比阈值
- **THEN** 判定器 SHALL 以「阈值未达」退出（退出码 1），并输出 vitest 同形的错误文案

#### Scenario: 未覆盖数超限判红

- **WHEN** 阈值为负数（表示最大未覆盖数）且实际未覆盖数超过其绝对值
- **THEN** 判定器 SHALL 以「阈值未达」退出（退出码 1），并输出点名未覆盖数与上限的错误文案

### Requirement: 失明与通过必须可区分

判定器 SHALL 用三态退出码区分结论：**0 = 达标**、**1 = 阈值未达**、**2 = 失明（不可判定）**。
凡「读不到阈值真源 / 读不到任何分片产物 / 产物形状不认识 / 合并失败 / 合并结果为空 / 覆盖率读数不是有限数字」，
SHALL 一律走退出码 **2**，SHALL NOT 被当成达标。

#### Scenario: 形状不认识的产物不得读成 100%

- **WHEN** 某份产物的内容不是一个 istanbul 覆盖率对象（例如是一个任意键值对）
- **THEN** 判定器 SHALL 以退出码 2 退出，SHALL NOT 把它读成「零语句的文件 ⇒ 覆盖率 100% ⇒ 达标」

#### Scenario: 空产物不得读成通过

- **WHEN** 某份产物里没有任何文件条目
- **THEN** 判定器 SHALL 以退出码 2 退出，SHALL NOT 因为「没有任何未覆盖项」而判达标

#### Scenario: 读不到任何分片产物

- **WHEN** 指定的产物路径都不存在，或指定目录里找不到任何覆盖率产物
- **THEN** 判定器 SHALL 以退出码 2 退出
