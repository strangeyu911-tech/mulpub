# 决策层评审 · 第 2 轮回应（8 条）

> critic 维度分：completeness 6 / consistency 7 / clarity 7 / feasibility 7 / security 6（较第 1 轮 5 分底抬高）。
> 再次未能收敛的原因仍是 **proposer 后端长度上限**（本轮任务提示 8923 > 7800 字符），与「有没有 2 个 Critical 没回应」无关。
> ⇒ 方案再次瘦身（v3，约 2800 字符），并把两条 Critical **就地答进方案正文**（不是只写在本文件）。

| # | 严重度 | 结论 | 处置与证据 |
|---|--------|------|-----------|
| i1 | Critical | **成立** | v3 §接口面 C 行写死：`loading: Boolean` **= 父的 `detailLoading`**（源自 `useFilmEngineering()`，父视图第 445 行解构的那个）。 |
| i2 | Critical | **不成立，给证据拒绝** | `ref.token` 是**参考 token 文本**（形如 `@ROKO`），模板里早就以 `<code>{{ ref.token }}</code>` 明文渲染、旁边就是「复制 token」按钮 —— 它已经在 DOM 上、也已经在剪贴板路径上。`copy-token` emit 只是把这串**已展示**的文本交回父视图做与今天**逐字相同**的 `navigator.clipboard.writeText`。因此：不新增数据通路、不新增暴露面、无需掩码（掩码反而会改用户拿到的 token，功能回归）。该结论已写进 v3 §接口面末段。 |
| i3 | Warning | **成立** | v3 §预算逐条重数：import 3 + 标签 3 + ref 3 + 三个转发函数 3 + `gotoModelSettings` 1 + 段落注释 2 = **15**（原先的 12 是漏了 `gotoModelSettings` 与注释行），预计 407。 |
| i4 | Warning | **成立，已实测取证** | `useFilmVideoGen.js` / `useFilmProduction.js` 的 import 只有 `vue` + `@/api/electron-bridge` + shared-utils；`grep -E "useFilmEngineering\|useRoute\|inject\("` 两文件均**0 命中** ⇒ 无父上下文隐藏依赖。已写进 v3 §已核实的前提。 |
| i5 | Warning | **成立** | v3 §验收⑦ 给出三份测试的最小断言：A=`open()` 后 idle 态出现 `fe-video-aspect`；B=`open()` 触发 `planProduction` 后 plan-ready 缺省态；C=`open=true` 渲染 `fe-detail-copy`。 |
| i6 | Info | **成立** | v3 抬头写明行号基线：`origin/main` @ `6918533fb`，本文所有行号（含 §不做 里的 52–127 / 129–176）同属该版本。 |
| i7 | Warning | **成立** | v3 §验收⑩ 要求记录里单列一条 bullet「本方含 videoGen dispose 泄漏修复」，与远程同步 bullet 并列。 |
| i8 | Info | **成立** | v3 §接口面 首句写死 `preview` 的类型/必答性：`Function`、必填、无默认值。 |

## 本轮唯一的流程事实

两次「未收敛」都不是方案被判死，而是 **proposer 后端 7800 字符硬上限**把「方案 + 意见」的合成提示拒了（同步 exit 1、无输出）。
按引擎自己给的对策执行：方案瘦身到约 2800 字符（v3），细节留 `design-details.md`（人读）。
