# 「谁来守门」的高危面 MUST 由判据 require 闭包派生，且取不到读数时 MUST 按未证实处理

## ADDED Requirements

### Requirement: 高危面 MUST 由判据入口的 require 闭包派生，MUST NOT 只由人工维护的路径前缀清单决定

`isHighRiskSurface(rel)` 的成立条件 MUST 是「命中 `HIGH_RISK_SURFACES` 的某条前缀」**或**
「`rel` 落在判据入口的 `require` 闭包内且未被豁免」。闭包 MUST 只有一份实现
（`scripts/lib/judge-closure.js`），判据与清点判据 MUST 共用它，MUST NOT 各存一份遍历。

理由：前缀清单只认路径形状，而判据的实质内容住在 `scripts/lib/` 下 ——
实测 47 个入口沿相对 `require` 可达 69 个仓内脚本（活数，`node scripts/check-judge-surface-coverage.js --report` 现取），
其中 **21 个不在任何前缀上**，
含 `scripts/lib/main-red.js`（合并闸门本体）、`scripts/classify-docs-only.js`（决定哪些门根本没跑）、
`scripts/lib/ccg-external-review-honor.js`（决定高危阻断该不该扣）。

#### Scenario: 只改一个未登记的 lib 判据文件的 PR 仍 MUST 被算成命中高危面

- **WHEN** 一份变更集只改 `scripts/lib/ccg-external-review-honor.js`（不命中任何前缀）
- **THEN** 高危面判定 MUST 为真，MUST NOT 因为"前缀清单里没有这条"而读成与守门无关

#### Scenario: 分段字面量的 `path.join` 拼装 MUST 被当作可定的依赖边

- **WHEN** 某入口写成 `require(path.join(__dirname, 'lib', 'gate-timeout-registry.js'))`
- **THEN** 该目标文件 MUST 进闭包（这种写法在静态上就是可定的，"看不见"是探针没去看）
- **AND** 它 MUST NOT 被同时记进 `dynamic=` 账（两类混记会让"这里可能有漏"那条读数失去含义）
- **AND** 含非 `__dirname` 变量的拼装（`path.join(root, …)`、`require(f)`）MUST 退回 `dynamic=` 计数，
  MUST NOT 被猜成某个具体文件

#### Scenario: 注释里的示例写法 MUST NOT 产生依赖边

- **WHEN** 散文或注释里出现 `require('./x')` 形态的字面量
- **THEN** `unresolved` 与 `dynamic` 两个读数 MUST NOT 因此非零
- **AND** 于是「`unresolved > 0`」MUST 是一条真信号（真的相对路径解析不到），MUST NOT 是恒噪声

#### Scenario: 新增一份被 `check-*` require 的 lib 文件 MUST 自动进面，无需有人记得登记

- **WHEN** 新增 `scripts/lib/new-judge.js` 且被某个 `scripts/check-*.js` 以字面量相对 `require` 引到
- **THEN** 该文件 MUST 立刻属高危面成员
- **AND** 想让它不算，MUST 走豁免出口并写出 reason（见下一条 Requirement）

#### Scenario: 闭包 MUST NOT 由测试可达性撑起

- **WHEN** 某 `scripts/lib/x.js` 只被 `*.test.js` require，不被任何非测试判据文件 require
- **THEN** `x.js` MUST NOT 进入闭包、MUST NOT 被判成高危面
- **AND** `check-x.test.js` MUST NOT 被当成入口（第一版探针把 `*.test.*` 计入，入口数由 47 虚报成 90）

### Requirement: 闭包计算失败 MUST 落进「判据自身未证实」档，MUST NOT 被读成「这条不在高危面」

判据在算不出闭包时 MUST 输出 `selfFault` 并要求人工核，MUST NOT 静默按"未命中高危面"继续判定。
`--mode=advisory` 与 `--mode=enforce` 两档都 MUST 出声。

#### Scenario: 判据根目录不可读时 MUST 按未证实出声

- **WHEN** 闭包计算抛错（目录不可读、`require.resolve` 全失败等）
- **THEN** MUST 打印 `selfFault` 级读数并以未证实档退出
- **AND** MUST NOT 出现"零未分类文件"这种与合规同形的输出

#### Scenario: 「闭包算不出」与「期望后端取不到」MUST NOT 塌成同一条红

- **WHEN** 同一次判定里两格都不成立
- **THEN** MUST 各出一条点名自己成因的读数（前者正解是「确认判据从仓根跑」，后者正解是「修清单读取」）
- **AND** 合成一句会把排障的人支使去查一份没坏的文件

#### Scenario: 规模退化 MUST 被下界拦住

- **WHEN** 闭包入口数 / 文件数 / lib 数任一低于登记下限
- **THEN** 清点判据 MUST 红并点名退化的是哪一格
- **AND** 即使此时"违规数 = 0"也 MUST NOT 通过

### Requirement: 降级出口 MUST 是带 reason 的豁免清单；登记项起始为空且只能缩小，上限常量 MUST 只由人工改

`scripts/judge-surface-waivers.json` 是唯一的降级出口：值为**非空字符串 reason**；
条数 MUST `<= MAX_WAIVERS`（本片起始 `0`，该上限 MUST 只由人工改代码来抬，MUST NOT 存在运行时通道）；键 MUST 仍在闭包内（陈旧即红）；
MUST NOT 存在指向闭包外文件的豁免项。

#### Scenario: 空 reason 的豁免 MUST 红

- **WHEN** 豁免项的值是空串、`true`、对象或缺失
- **THEN** MUST 红并点名该键，MUST NOT 按"已登记"放行

#### Scenario: 豁免清单被抬起上限 MUST 是一起人工裁决事件

- **WHEN** 有人把 `MAX_WAIVERS` 从 `0` 调大以容忍自己的新增
- **THEN** 清点判据 MUST 红（登记被放宽本身即"改谁来守门"）

### Requirement: 既有前缀清单 MUST 配一道空转条目锁：每条 MUST 至少命中一个受管文件

`HIGH_RISK_SURFACES` 的每条 MUST 按其自带口径求命中（`fingerprint` 那条 MUST 复用它自己的 `exts` 限定），
命中数为 `0` MUST 红并点名该条。

理由：每条的 `why` 里写着「实测命中 N 个」，而 N 是**登记当天**的数；前缀手误或文件搬家之后，
该条会永远命中 0 并保持恒绿 —— 一条看起来在守、实际永不发火的门禁，比缺这条更坏。

#### Scenario: 死前缀 MUST 红

- **WHEN** 某条 `prefix` 在全仓受管文件里命中 0
- **THEN** MUST 红并打印该条与前缀原文

#### Scenario: `fingerprint` 条目 MUST NOT 被裸前缀比较误判为死条目

- **WHEN** 清点判据求 `fingerprint` 那条的命中数
- **THEN** MUST 按其 `exts` 白名单过滤源码文件后计数
- **AND** 用裸前缀比较（丢掉 `exts`）MUST 让该条命中 0 并被自己的锁判红
