---
record: promo-yearly-rule
task: 恢复限购 3 次并让年付保持原价（附归一化缺陷修复）
date: 2026-10-27
---

> ⚠️ **本文档 §1–§9（含顶部门禁表）是 v1.1 的执行记录（历史）**：那版把年付改成「月付实收 × 10」并删除限购，
> 已被用户否决。**现行语义以 §10（v1.2）为准**；§1–§9 保留是为了留下「v1.1 为什么改错」的
> 可追溯证据，不要按其结论实现。

## 本次执行记录：恢复限购 3 次 + 年付保持原价（promo-yearly-rule，2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + 文档：隔离 worktree `<仓库父目录>\mp-worktrees\mp-promo-yearly-rule`，裸分支 `promo-yearly-rule`（`git worktree list` 可查）；基于 `origin/main` `fd20c886a`；共享根保持 main、本 PR 未在共享根落盘 |
| 第一性原因（QM-5 ①） | PASS | 见 §1：不是「限购不够严」，而是**定价不变量（年付 = 月付 × 10）被破坏** |
| 逃逸分析（QM-5 ②） | PASS | 见 §2：初版的定价不变量、前端字段透传、测试绕过三处同时失效 |
| 修复 + 回归保护（QM-5 ④） | PASS | 见 §3 / §4 |
| 防止再次发生（QM-5 ⑤） | PASS | 见 §6：派生而非配置 + 逐档 ×10 断言 + 配置自检 |
| 行尾与 diff 对账 | PASS | 全部改动文件为 CRLF；`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件比对：22 个文件一致，仅 `openspec/records/standard-plan-promo.md` 差 1 行（该文件**原末尾无换行符**，追加段落使末行被计为「改写」，属 EOF 伪差异，非 EOL 风格变化）；`git diff --check` 无空白错误 |
| 接线棘轮 | PASS | 3 个引擎测试文件由 `node --test`/`run-tests.js` 直接发现；3 个前端 vitest 文件由 `vitest run` 直接发现；无新增未接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`（仅 `electron/services/identity/entitlement-service.js` 的纯数据归一化）与 `packages/rpa-engine/`；无视觉基线变更 |
| QM-6 双模型外部评审 | 已执行（v1.3 自扮演收口） | 见 §11.4：`sh scripts/deep-review.sh` 评审 `origin/main...3b29bfa9d`，critic=claude / proposer=opencode，7 条 finding / 6 条争议全部 `dismissed`；写回 `2f703…json` 与回填 `c237…json` 均为 `status=self_play_resolved / tier=external / performedBy=self-play / evidence=PR #4560 #issuecomment-6444626390` |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注 `(#NNNN)` 推导，本行不需要事后改写 |

### 1. 第一性原因

**套利不是用户投机，是定价不变量被破坏的症状。**

初版把促销实现成「只降月付、年付锁死 59000」：

```
12 个月月付 = 29 × 12 = 348 元
年付       = 590 元        ⇒ 348 < 590（差 242 元）
```

「年付 = 月付 × 10」这条用户既定规则在原价（590 / 5900）成立，一旦只动月付就变成 20 倍关系，
**系统自己制造了套利空间**。初版用「每人限购 3 单」去堵，是在给症状打补丁：套利窗口仍在
（3 单的等效价值差 = 3 × 242 元），却引入计数 SQL、`exhausted` 状态、售罄文案与一整套
per-user 测试。

正解是把不变量放回定价：年付实收 = 月付实收 × 10 ⇒ 促销期 290。此时
`12 × 29 = 348 > 290`，囤月付比年付贵 58 元（正好是「付 10 个月用 12 个月」），套利动机消失，
限购这一层状态整层可以删掉。

### 2. 逃逸分析

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | 初版判据全部围绕「3 单上限」写（第 4 单原价、count 0/2/3/4），**没有任何一条断言「年付 = 月付 × 10」**。测试锁住的是补丁本身，而不是它要保护的定价性质。 |
| 集成/接口 | `/api/v1/plans` 只断言 `priceMonthlyCents=2900` 与「年付不动 59000」——后者被写成了**期望**，把不变量破坏固化成了契约。 |
| 代码评审 | 「年付不动」在初版决策表里是 D4 明写的一条，评审按决策表核对，缺一条「促销期年付该是多少」的算术复核。 |
| 前端测试 | `Subscription.promo.test.js` 直接往 store 塞 plans，绕过 `entitlement-service.normalizePlanEntry` 与 `stores/identity.js` 的两次归一化 —— 而这两处当时都只解构 4 个字段，`promotion` / `listPrice*` 在真实链路上被静默丢弃（角标与续费预告永远没有数据）。测试绿、功能死。 |
| 手工验证 | 沙箱无商户凭据，两次都只验证「月付扫码金额 = 29」，没有跑年付单。 |

### 3. 修复

| # | 改动 | 文件 |
|---|---|---|
| 1 | `resolvePrice({ plan, period, now, config })`：删 `promoPurchaseCount` / 限购判断 / `exhausted`；促销适用 = 开关开 ∧ now∈窗口 ∧ plan==='standard'（month/year 都适用）；`year` 实收 = 月付实收 × 10 | `src/auth/promo-resolver.js` |
| 2 | 配置删 `maxPurchasesPerUser`；新增 `listPriceYearlyCents` 校验（年付实收必须严格低于年付标价）；装配接口收两个标价 | `src/auth/promo-resolver.js` |
| 3 | 目录新增 `listPriceYearlyCents`，`priceYearlyCents` 改为**实收**语义（促销期 29000）；`getPlanCatalog` 删 `promoPurchaseCount` | `src/auth/plan-matrix.js` |
| 4 | 下单删计数查询；`promotionId` 只按 `pricing.promotion` 判断；provider 继续收 `payableCents` | `src/auth/subscription-payment.js` |
| 5 | 删仓储 `countPromoPurchases`（`SELECT count(*) ...`） | `src/auth/payment-order-store.js`、`src/auth/postgres-commerce-store.js` |
| 6 | `/api/v1/plans` 不再按用户查计数（同一份目录给所有人） | `src/auth/publish-api-commerce.js` |
| 7 | `promoActive()` 不再传计数 | `src/auth/subscription-service.js` |
| 8 | 预检明细打印月付/年付实收，去掉「每人上限」 | `scripts/payment-preflight.js` |
| 9 | 前端删 `exhausted` 分支、「活动价已用完，¥59/月」文案与 `promoBuyCtaOf`；保留角标 | `PlanPriceTag.vue`、`Subscription.vue`、`labels.js` |
| 10 | **链路修复**：主进程归一化与渲染 store 透传 `promotion` / `listPriceMonthlyCents` / `listPriceYearlyCents`（否则角标只在单测里存在） | `electron/services/identity/entitlement-service.js`、`src/stores/identity.js` |
| 11 | locales 的 `memberCenter.planPromoExhausted` **保留不删**（不再渲染） | `locales/member-center/{zh,en}.js`（未改动） |

### 4. 回归保护（新增/改写的判据）

| 文件 | 例数 | 锁住什么 |
|---|---|---|
| `test/promo-resolver.test.js` | 38 | 月付窗口四边界；年付 29000 与「年付 = 月付 × 10」（四个时点同时验证折后价与让利）；窗口外 59000/5900；无 count 入参（重复询价恒定 / 多传 count 不生效 / 源码无残留 / promotion 仅三个键）；pro 月付与年付都不打折；配置非法 9 类（含年付标价校验）；env 装配 |
| `test/plan-catalog-promo.test.js` | 14 | 实收语义 2900/29000、两个 list 标价、promotion、**逐档 ×10 不变量**（促销/原价/无配置三种目录）、目录不读 per-user 计数、窗口外恢复、overrides 联动与两条非法配置 |
| `test/subscription-payment-promo.test.js` | 12 | 月付三列、年付三列（59000/30000/29000）、provider 收实收、**连续 5 单全促销价且仓储 `countPromoPurchases` 一调用就抛错**、继续支付、结算 2900/29000 通过、标价回调拒绝、缺失拒绝、非促销单 |
| `Subscription.promo.test.js`（vitest） | 7 | 角标/剩余天数、年付 ¥290、不划线、**无「活动价已用完」**（含 legacy `exhausted:true` 输入）、续费预告、无硬编码 2900/29000 |
| `entitlement-service.test.js` / `stores/identity.test.js` | 20 / 24（含新增 2 + 2） | `promotion` 与两个 list 价穿透两次归一化；非法形状整组丢弃 |

### 5. 变异反证（改坏实现 → 必须红；还原 → 必须绿）

命令：PowerShell 读原文件 → 字面替换 → 跑对应测试 → 还原 → 再跑。
实测结果（2026-10-27，本 worktree）：

| # | 变异 | 命中判据 | 改坏后 | 还原后 |
|---|---|---|---|---|
| M1 | 年付回到「锁死标价」（`priceCents * 10` → `listPriceCents`） | promo-resolver 年付 29000 | 红 ✅ | 绿 ✅ |
| M2 | 年付按 12 个月计（`× 10` → `× 12`） | promo-resolver「年付 = 月付 × 10」 | 红 ✅ | 绿 ✅ |
| M3 | 重新引入 `if (promoPurchaseCount >= 3) return base` | promo-resolver 源码无计数残留 | 红 ✅ | 绿 ✅ |
| M3b | 只把 `promoPurchaseCount` 加回函数签名（不加分支） | promo-resolver 源码无计数残留 | 红 ✅ | 绿 ✅ |
| M3c | **同时**加签名与 `>= 3` 分支（真实限购回归） | promo-resolver「多传 count 不生效」 | 红 ✅ | 绿 ✅ |
| M4 | 目录 `priceYearlyCents` 回到矩阵标价 | plan-catalog 促销期年付 29000 | 红 ✅ | 绿 ✅ |
| M5 | 目录按 `promoPurchaseCount >= 3` 变价 | plan-catalog 不读 per-user 计数 | 红 ✅ | 绿 ✅ |
| M6 | 删年付标价校验（`&&` 前加 `false`） | promo-resolver 年付配置非法抛错 | 红 ✅ | 绿 ✅ |
| M7 | 下单永不落 `promotion_id` | subscription-payment promotion_id 落库 | 红 ✅ | 绿 ✅ |
| M8 | provider 收 `listPriceCents`（多收 30 元） | subscription-payment provider 收实收 | 红 ✅ | 绿 ✅ |
| M9 | 角标回到 `promotion.exhausted === false` 条件 | 前端促销角标渲染 | 红 ✅ | 绿 ✅ |
| M10 | 按钮文案恢复「活动价已用完」 | 前端无「活动价已用完」 | 红 ✅ | 绿 ✅ |
| M11 | 主进程归一化丢弃 `promotion`（初版真实缺陷） | 主进程透传 promotion | 红 ✅ | 绿 ✅ |
| M12 | 前端年付价改读 `listPriceYearlyCents` | 前端年付 ¥290 | 红 ✅ | 绿 ✅ |

> 结论：**14 次变异（M3 的 3 个变体）全部被对应判据捕获**，且还原后全部复绿。M3c 尤其重要：它证明
> 「限购回归」不是靠源码字符串偶然而已，行为判据本身也会红；M11 证明链路透传有锁，
> 不会再出现「单测绿而角标死」的形态。

### 6. 防止再次发生

1. **派生而非配置**：年付实收只可能是「月付实收 × 10」，没有第二个年付促销常量可以写错。
2. **逐档不变量断言**：目录测试对三档 × 三种状态断言 `priceYearlyCents === priceMonthlyCents × 10`。
3. **两端断言**：解析器在窗口四个时点同时取月付与年付，折后价与让利都必须严格 ×10。
4. **配置自检**：`priceCents × 10 >= listPriceYearlyCents` 在装配期抛 `PROMO_CONFIG_INVALID`。
5. **链路锁**：`promotion` 必须穿过主进程与渲染 store 的归一化，否则角标判据红。

### 7. 测试结果（本 worktree 实测）

| 套件 | 结果 |
|---|---|
| `packages/api-publish-engine` 三个促销测试文件 | **64/64 通过**（38 + 14 + 12） |
| `packages/api-publish-engine` 支付/计划相关 7 个文件（payment-api、subscription-payment、promo-redeem-guard、plan-matrix、payment-promo-ops、payment-preflight、payment-promo-schema） | **113/113 通过** |
| `packages/api-publish-engine` 全量（`node scripts/run-tests.js`） | 503 通过 / 1 失败：`test/scripts-gitignore-guard.test.js`（**既有环境问题**：该文件依赖 vitest globals，直跑报 `describe is not defined`/worker 5s 超时；在改动前的另一 worktree `mp-standard-plan-promo` 复现同样失败，与本 PR 改动无关） |
| `apps/desktop` 会员中心 + store | **86/86 通过**（Subscription 28 + Subscription.promo 7 + labels 27 + identity store 24） |
| `apps/desktop` 身份服务 | **28/28 通过**（entitlement-service 20 + plans-catalog 8） |

### 8. 遗留（不假装已闭合）

- **`scripts-gitignore-guard.test.js` 在 Windows 本地红**：改动前的工作树同样红；CI 侧以 Linux runner 为准。
- **历史订单 `promotion_id`**：初版用它计数，现仅作事实记录；分析口径若把它当额度占用会得出错误结论。
- **单客让利上限**：取消限购后，年付一单让利 300 元（< 12 次月付的 360 元），风险已写在 PRD §9.3。

### 9. 门禁读数

| 命令 | 读数 |
|---|---|
| `node scripts/check-gate-record-debt.js` | rc=0；`HAND-CLOSURE 人工改写=0 新增重复行=0 记录被删=0`；`远程同步行 400 条 / 执行记录 605 篇 / 已登记欠账 0 条 / 记录文件 928 篇`；末行 `OK: 两源所有未收口的 远程同步 行均已登记…` |
| `node scripts/check-doc-abs-paths.js --all` | PASS；`counts=1161 domain=6426 files=561 canJudge=true`，无新增本机绝对路径（本记录与 PRD 统一用 `<仓库父目录>` 占位） |
| `node scripts/check-no-brand-residue.js` | PASS；扫描 13509 个 tracked 文件，无品牌残留 |
| `node .github/scripts/check-max-lines.js` | rc=0；`limit=500 超限文件=93 挂账=93 墓碑=7 点名还账=20`；`testLimit=1500 测试超限=13 测试挂账=12`；「无新增超大文件，挂账清单与现实一致」 |

## 10. 二次修订（v1.2）：推翻 §1–§9，恢复限购 3 次、年付回到原价

**触发**：v1.1（§1–§9）的结论被用户否决。v1.1 把「年付 = 月付实收 × 10」当成必须无条件
成立的定价不变量，于是把年付降到 29000 并删掉限购。**错在把限购从等式里删掉了**。

### 10.1 两段必须写清的算术

**（一）限购 3 次本身就已经消灭了套利**

```
促销期月付 29 元，限购 3 次
⇒ 单客最多：29 × 3 = 87 元，覆盖 3 个月
⇒ 12 个月 × 29 = 348 元的年付路径**买不到**
⇒ 单客让利上限 = 3 × 30 = 90 元
```

v1.1 说「12 × 29 = 348 < 年付 590，所以用户会囤月付」，但它忽略了：**限购只允许买 3 次**，
3 × 29 = 87 元 / 3 个月，根本凑不出 12 个月。套利路径不存在，不需要靠年付降价去堵。

**（二）年付一旦参与促销，限购会把让利放大 10 倍**

```
同一套「最多 3 次」套在年付促销上（年付促销价 290）：
3 次年付 = 3 × 290 = 870 元，覆盖 3 年
原价 3 年 = 3 × 590 = 1770 元
让利 = 1770 - 870 = 900 元     ← 月付促销的单客让利上限只有 90 元
```

**结论：计数式限购与年付促销在数学上不能共存。** 限购的计量单位是「次」，年付一次是 12 个月，
两者量纲不匹配：3 次 × 1 年 = 3 年，让利从 90 元变 900 元（10 倍，正好是 12 ÷ 3 的量纲差）。

### 10.2 年付为什么必须留在原价

1. **量纲不匹配**（见 10.1 二）：任何「最多 N 次」的规则用在年付上，实际卖出月数是 `N × 12`。
2. **年付标价已含折扣**：590 = 59 × 10（付 10 个月用 12 个月），再叠促销＝对同一段时长打两次折。
3. **促销目标是降低首购门槛**：年付用户已愿意一次付 590，再降到 290 只会打掉高价值客户的价格锚点。
4. **可验证性**：年付恒为 59000 是静态性质，可用「窗口五时点 × 多个计数」穷举；一旦浮动，
   测试面要同时覆盖「限购 × 年付」的 12 倍放大。

### 10.3 与 §3 / §11 的逐项回滚

| # | v1.1（已推翻） | v1.2（现行） |
|---|---|---|
| 1 | `resolvePrice` 无计数入参 | `{ plan, period, now, config, promoPurchaseCount }`；`promotion.exhausted` 恢复 |
| 2 | 年付 = 月付实收 × 10（29000） | **年付恒为 59000**（任何窗口、任何计数） |
| 3 | 删 `maxPurchasesPerUser` / env | 恢复默认 3，`PROMO_STANDARD_MONTHLY_MAX_PURCHASES` 可配 |
| 4 | 删 `countPromoPurchases` | 恢复 `count(*) ... where user_id=$1 and promotion_id is not null and status='paid'` |
| 5 | `/api/v1/plans` 同一份目录 | 恢复按登录用户查计数（未登录按 0 单） |
| 6 | 删 `exhausted` 分支与售罄文案 | 恢复 `promoBuyCtaOf` + `PlanPriceTag` 的 `exhausted === false` 角标条件 |
| 7 | `priceYearlyCents` 实收语义 | `priceYearlyCents` / `listPriceYearlyCents` 都是静态 59000 |

### 10.4 保留项（不回滚）

`entitlement-service.js` 与 `stores/identity.js` 的归一化修复**保留并扩展**：
v1.1 修了 `promotion` / `listPrice*Cents` 被丢弃，但仍把 `exhausted` 过滤掉了。
v1.2 把 `exhausted` 一并透传（两层都加），否则「活动价已用完」永远不会在真实链路出现 ——
这正是 v1.1 同一类「单测绿、功能死」的缺陷，只是换了个字段。对应测试同样保留并加断言。

### 10.5 变异反证（本次实测，改坏 → 必红 → 还原 → 绿）

命令：`[System.IO.File]` 读取绝对路径 → 字面替换 → 跑三个促销测试文件 → 还原 → 再跑。

| # | 变异 | 改坏后 | 还原后 |
|---|---|---|---|
| M1 | 年付被促销污染（`period==='year'` 返回 29000） | **红：59 通过 / 12 失败** ✅ | 71 通过 / 0 失败 ✅ |
| M2 | 计数判断失效（`exhausted = false`，永远 <3） | **红：62 通过 / 9 失败** ✅ | 71 通过 / 0 失败 ✅ |
| M3 | `exhausted` 不出现（从 `buildPromotion` 删除该键） | **红：55 通过 / 16 失败** ✅ | 71 通过 / 0 失败 ✅ |
| M4 | 前端售罄分支失效（`exhausted === true` → `=== false`） | **红：1 失败 / 7 通过** ✅ | 8 通过 / 0 失败 ✅ |

### 10.6 测试结果（本 worktree 实测）

| 套件 | 结果 |
|---|---|
| 引擎三个促销测试文件 | **71/71 通过**（promo-resolver 44 + plan-catalog 13 + subscription-payment 14） |
| 引擎支付/计划相关 7 个文件 | **113/113 通过** |
| 引擎全量 `node scripts/run-tests.js` | **exit 0；Vitest 47 个文件 / 504 个测试全部通过** |
| 桌面会员中心 + identity store + entitlement-service + plans-catalog | **192/192 通过**（15 个文件） |

### 10.7 并发口径（边界，不假装已闭合）

限购按 `status='paid'` 计数（pending 不占额度，避免弃单把用户锁死）。本 PR 的判据锁的是
「**已满 3 单**后 5 个并发下单全部 5900」——即已满额度不可被并发绕过。并发**创建**多笔 pending
仍可能都拿到促销价，要彻底消除需要 DB 级预占（`promotion_slot` 唯一索引或事务级 advisory lock），
本期未做，已列入 PRD §9.3。

### 10.8 门禁读数（v1.2 实测）

| 命令 | 读数 |
|---|---|
| `node scripts/check-gate-record-debt.js` | rc=0；末行 `OK: 两源所有未收口的 远程同步 行均已登记，清单无陈旧项、记录标题无重复、记录文件登记字段无残留、旧载体与冻结基线一致` |
| `node scripts/check-doc-abs-paths.js --all` | PASS；`counts=1161 domain=6428 files=561 canJudge=true`，无新增本机绝对路径（本记录与 PRD 统一用 `<仓库父目录>` 占位） |
| `node scripts/check-no-brand-residue.js` | PASS；扫描 13512 个 tracked 文件，无品牌残留 |
| `node .github/scripts/check-max-lines.js` | rc=0；`limit=500 超限文件=93 挂账=93 墓碑=7 点名还账=20`；`testLimit=1500 测试超限=13 测试挂账=12`；「无新增超大文件，挂账清单与现实一致」 |
| 行尾对账 | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件完全一致 |

## 11. 三次修订（v1.3）：会员期限护栏 + 促销额度预占

**触发**：v1.2 的限购只在 `status='paid'` 口径下成立，仍有两个结构性缺口：

1. **多开窗口**：定价在下单时固化，计数只数已支付 ⇒ 5 个窗口各下一个 pending，5 单都按
   2900 定价，逐一支付后拿到 5 个月促销价。
2. **期限无上限**：`applySubscription` 只校验 `durationDays > 0`，兑换码/后台授予可把
   `current_period_end` 叠到任意远。

### 11.1 实现

| # | 改动 | 文件 |
|---|---|---|
| 1 | 新增共享常量/判定 `MAX_SUBSCRIPTION_HORIZON_DAYS = 1095`（= 3 × 365，按天计、跨闰年差 1 天）；`prospectiveEnd = max(现有 current_period_end, now) + durationDays > now + 1095 天` ⇒ 409 `SUBSCRIPTION_HORIZON_EXCEEDED` | `src/auth/subscription-horizon.js`（新） |
| 2 | `createCheckout` 付款前预检：超限直接 409，不落 pending、不生成二维码；「继续支付」复用旧单路径不重复校验（不新增时长） | `src/auth/subscription-payment.js` |
| 3 | `applySubscription` 兜底：与 checkout 共用同一 helper；覆盖兑换码 / 后台授予 / 支付回调，超限在写订阅/订单/快照之前拒绝 | `src/auth/postgres-commerce-store.js` |
| 4 | 促销额度 = paid + 30 分钟内 pending；新增 `countPromoPurchases(userId, { now, includePending })` 与 `createPendingOrderWithPromoQuota`（同一事务 advisory lock → 计数 → 定价 → INSERT） | `src/auth/payment-order-store.js`、`src/auth/postgres-commerce-store.js` |
| 5 | 结算兜底：已支付促销单 ≥ 上限时**仍然结算**（钱已收），返回 `promoQuotaOversold` / `paidPromoCount` / `maxPromoPurchases`，写事件 result，并由路由层记 `PROMO_QUOTA_OVERSOLD` | `src/auth/subscription-payment.js`、`src/auth/publish-api-payment.js` |
| 6 | `payment-reconcile` 新增 `promo-quota-oversold`：按用户聚合已支付促销单，`HAVING count(*) > 上限` | `scripts/payment-reconcile.js` |
| 7 | 前端：购买被 409 拒绝时展示 `memberCenter.payHorizonExceeded`；兑换被同一护栏拒绝时映射 `memberCenter.redeemErrHorizon`；zh/en 成对 | `WeChatPayDialog.vue`、`Subscription.vue`、`locales/member-center/{zh,en}.js` |

> **30 分钟的依据**：现有代码里唯一成文的 pending 超时是支付弹窗的 30 分钟硬上限
> （`apps/desktop/src/components/WeChatPayDialog.vue:87-89`，与 PRD-WECHAT-PAY §7.3 / §6.1
> 同源）；服务端没有 pending 置 failed 的定时任务。本修订不新增支付状态机，只把同一口径
> 用于额度滑窗。30 分钟后释放额度；微信二维码通常 2 小时内仍可支付，晚到的旧 pending
> 可能造成超卖，由结算兜底与对账暴露（不拒付）。

### 11.2 测试结果（本 worktree 实测）

| 套件 | 结果 |
|---|---|
| `test/subscription-horizon.test.js`（新） | **15/15 通过**：1095/1096 边界、2 年 + 1 年、2 年 + 2 年、过期旧订阅按 now 起算、已有超限不回滚、checkout 零订单零二维码、兑换码/后台授予兜底、兑换码边界放行 |
| `test/subscription-payment-promo.test.js` | **19/19 通过**：新增「3 个 pending 后第 4 单 5900」「pending 30 分钟过期释放」「并发 5 单最多 3 单 2900」「超卖仍结算返回可对账字段」「原价第 4 单不误报」 |
| `test/member-commerce-repository.test.js` | **36/36 通过**：新增 `countPromoPurchases` 含 pending / paid-only 两种 SQL、`createPendingOrderWithPromoQuota` 同事务 advisory lock → 计数 → INSERT |
| `test/payment-api.test.js` / `test/payment-reconcile.test.js` | 新增 `PROMO_QUOTA_OVERSOLD` 日志与 `promo-quota-oversold` 判据；全部通过 |
| 引擎受影响 10 个文件 | **180/180 通过** |
| 引擎全量 `node scripts/run-tests.js` | **exit 0**；Vitest 47 个文件 / 504 个测试全部通过，node:test 直跑文件全部通过 |
| 桌面会员中心 4 个文件 | **73/73 通过**（含 `WeChatPayDialog` 的 `SUBSCRIPTION_HORIZON_EXCEEDED` 具体原因用例） |

### 11.3 变异反证（A/B 各四刀；改坏 → 必须红 → 还原 → 绿）

命令：PowerShell 读绝对路径 → 字面/正则替换 → 跑对应测试 → 还原 → 再跑。

| # | 变异 | 命中判据 | 改坏后 | 还原后 |
|---|---|---|---|---|
| A1 | `MAX_SUBSCRIPTION_HORIZON_DAYS` 1095 → 1096 | `subscription-horizon` 1095/1096 边界 | **红：9 通过 / 6 失败** ✅ | 15 通过 / 0 失败 ✅ |
| A2 | 边界 `endMs > limitMs` → `>=` | `subscription-horizon` 正好 1095 天通过 | **红：7 通过 / 8 失败** ✅ | 15 通过 / 0 失败 ✅ |
| A3 | checkout 预检把 `currentPeriodEnd` 恒置 null | `subscription-horizon` 已有 2 年 + 买 1 年 1096 用例 | **红：13 通过 / 2 失败** ✅ | 15 通过 / 0 失败 ✅ |
| A4 | 删掉 `applySubscription` 的 horizon helper（退回直接加天数） | `subscription-horizon` 兑换码/后台授予拒绝 | **红：12 通过 / 3 失败** ✅ | 15 通过 / 0 失败 ✅ |
| B1 | 计数 SQL 的 `OR (status = 'pending'` → `OR (status = 'paid'`（pending 不再占额度） | `member-commerce-repository` 计数 SQL 形状 | **红：33 通过 / 3 失败** ✅ | 36 通过 / 0 失败 ✅ |
| B2 | 删掉 `await tx.lockPromoQuota(userId)` | `member-commerce-repository` 预占事务顺序 | **红：34 通过 / 2 失败** ✅ | 36 通过 / 0 失败 ✅ |
| B3 | `promoQuotaOversold` 恒置 false | `subscription-payment-promo` 超卖兜底 + `payment-api` 日志 | **红：40 通过 / 2 失败** ✅ | 42 通过 / 0 失败 ✅ |
| B4 | 超卖边界 `paidPromoCount >= max` → `>` | `subscription-payment-promo` 超卖兜底 | **红：17 通过 / 2 失败** ✅ | 19 通过 / 0 失败 ✅ |

> 已知测试局限：`subscription-payment-promo` 用内存 fake 复刻额度语义，所以 B1 的
> `AND false` 变体只会在仓储 SQL 形状测试里被抓住（B1 采用可被 SQL 断言捕获的
> `OR (status = 'paid'` 变体）。真正的 PostgreSQL 并发行为依赖 `pg_advisory_xact_lock`，
> 其结构锁在 `member-commerce-repository` 的调用顺序断言里，未在 CI 起真实 PG。

### 11.4 门禁读数（v1.3）

| 命令 | 读数 |
|---|---|
| `node scripts/check-gate-record-debt.js` | rc=0；末行 `OK: 两源所有未收口的 远程同步 行均已登记，清单无陈旧项、记录标题无重复、记录文件登记字段无残留、旧载体与冻结基线一致` |
| `node scripts/check-doc-abs-paths.js --all` | PASS；`counts=1161 domain=6433 files=561 canJudge=true`，无新增本机绝对路径 |
| `node scripts/check-no-brand-residue.js` | PASS；扫描 13519 个 tracked 文件，无品牌残留 |
| `node .github/scripts/check-max-lines.js` | rc=0；`limit=500 超限文件=93 挂账=93 墓碑=7 点名还账=20`；`testLimit=1500 测试超限=13 测试挂账=12`；「无新增超大文件，挂账清单与现实一致」 |
| `node .github/scripts/check-locale-sync.js --pair-base origin/main` | PASS；zh/en 成对 |
| `node .github/scripts/check-locale-sync.js --cjk` | PASS；基线 1330 / 当前 1083 / 无新增硬编码 |
| `sh scripts/deep-review.sh`（QM-6） | **已执行**：`origin/main...3b29bfa9d`（3672 行上下文），critic=claude / proposer=opencode；7 条 finding、6 条争议项，维度最低分 3 ⇒ 自扮演逐条裁决 **i1–i6 全部 dismissed**（`adjudication.json` 见 `.adversarial/ccg-deep-3b29bfa9/`）。写回 `2f703…json`：`status=self_play_resolved / tier=external / performedBy=self-play / evidence=https://github.com/Colinchiu007/mulpub/pull/4560#issuecomment-6444626390 / tierBasis=adjudicated-self-play`。同一 `deepReview` 已回填到 v1.2 轮 `c237…json`。公开评论：`#issuecomment-6444626390`。 |
| `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | rc=0；`TIER-COVERAGE dual-closed total=3 external=3`；无 dual 欠账；末行 `OK: 本 PR 携带执行记录或带原因的豁免` |

## CHANGELOG 条目

# fix(payment): 恢复限购 3 次并让年付保持原价（附归一化缺陷修复）

- 标准版促销恢复为**仅月付**：第 1/2/3 单 2900（标价 5900、discount 3000），第 4 单起 5900，
  且 `promotion.exhausted=true` 在前端**下单前**显示「活动价已用完，¥59/月」。
- **年付在任何窗口下都是 59000**：不参与促销、无 discount、无 promotion；
  计数式限购的计量单位是「次」，年付一次 12 个月，两者量纲不匹配（3 次 × 1 年 = 3 年，让利 90 → 900）。
- 恢复 `countPromoPurchases`（`count(*) ... status='paid'`）与 `resolvePrice` 的
  `promoPurchaseCount` 入参、`maxPurchasesPerUser`（默认 3）、目录的 per-user `exhausted`。
- 保留并扩展促销字段的归一化修复：`promotion` / `listPrice*Cents` 之外，`exhausted` 也必须
  穿过主进程与渲染 store 的两次归一化，否则售罄提示在真实链路永远不出现。

## learnings

### lesson: 先把限购放回等式，再谈「定价不变量」

**现场（两次翻车）**：初版「月付 29 / 年付 590 + 限购 3 次」被误判成「套利（12×29=348 < 590）」，
v1.1 于是把年付降到 290 并删掉限购。实际上 **3 × 29 = 87 元只能买 3 个月**，348 元的年付路径
根本不存在；删掉限购后，若年付再参与促销，同一套「3 次」限购会变成 3 年 870 元（原价 1770），
让利从 90 元放大到 900 元 —— 限购与年付促销在量纲上不能共存。

**根因**：把「年付 = 月付 × 10」当成无条件不变量，却漏掉了另一个约束（限购次数）已经在
限制月付路径的总量。**任何「套利」结论都必须把全部约束（价格、限购、周期长度）同时写进等式**，
只比较单价会得出相反的错误结论。

**可复用的 3 条**：

1. 算套利前先列出全部约束：单价 × 可购次数 × 每次覆盖月数。少写一个约束，结论就会反转。
2. 限购的计量单位必须与被限购商品的计量单位一致；「次数」× 「年」= 12 倍放大，是本能的量纲错误。
3. 「服务端字段驱动」的 UI，透传测试要覆盖**每一个**渲染用到的字段（含 `exhausted` 这类布尔值）；
   少透传一个字段，单测仍然全绿，功能在真实链路永远不出现。
