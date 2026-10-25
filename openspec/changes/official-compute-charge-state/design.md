# Design — official-compute-charge-state

> 规格（做什么）在 `proposal.md` + `01-docs/PRD-OFFICIAL-COMPUTE-CHARGE-STATE-2026-10-25.md`；
> 本文只记**决策与理由**。

## 1. 状态判定为什么是**纯函数**（而不是散在入库流程里）

状态判定有 6 个分支、且**将来会被两个入口共用**（客户端上报入口 + 将来的代理入口）。
⇒ 写成纯函数 `resolve_charge_state(...) -> (status, error)`：
- **可单独测**（不碰 DB、不碰 HTTP）⇒ 11 条验收里 7 条是纯函数断言；
- **不会漂移**（两个入口共用一份）⇒ 复制粘贴导致的语义分裂被结构挡住。

⚠ **反面做法**：把判定内联进入库循环 ⇒ 代理入口落地时要么复制一段（漂移），
要么改公开入口（把客户端入口变成「可传 source」⇒ **调用方可以自称 server** ⇒ 安全红线破）。

## 2. ★ 安全红线：来源判定必须在**服务端**、且**缺省向安全侧**

`POST /api/v1/usage/events` 只认静态 `X-Catalog-Key` ⇒ 请求体里的 `user_id` 是**客户端自称**的。

⚠ **若直接拿它扣分**：恶意客户端上报别人的 sub ⇒ **扣别人的积分**。

⇒ 三道防线：
1. `charge_source` 列**缺省 `client`**（安全侧）⇒ 忘写来源 = 不扣，而不是扣；
2. 判定里 `source != 'server'` ⇒ 一律 `unbillable` + `UNTRUSTED_IDENTITY`；
3. 客户端自称任何字符串都**绕不过**（判定只看入参的 `source` 字段，不看 `user_id` 的内容）。

⚠ **为什么不是「签个名」**：那需要平台下发带签名的凭证（未落地）⇒ 本刀不做，
先让「不可信 ⇒ 不扣」这条**默认安全**的规则立住。

## 3. 五个状态为什么**不合并**

`not_applicable`（钱由用户出）/ `free`（上游没收钱）/ `unbillable`（算不出或不可信）
三者**都不扣**，但语义不同 ⇒ 合并成一个标记后，统计与对拍就分不清「白送了多少」、
「算错了多少」、「不可信多少」⇒ **主动选择与失败兜底必须分旗**（同族的通用纪律）。

⚠ 具体原因码放 `charge_error`（`MISSING_PRICE` / `MISSING_USER` / `UNTRUSTED_IDENTITY`）
⇒ 状态保持「该不该扣」这一个意思，原因码负责细分。

## 4. 周期为什么**随事件落库**

`charge_period_start/end` = 事件发生时的自然月边界（UTC，与 `identity_entitlement_usage` 同期口径）。

⚠ 留到扣分时再算 ⇒ **补扣可能跨月** ⇒ 那时算出来的周期与「额度所属周期」错位
（DESIGN §13.2 B-2 记的跨周期补扣问题）⇒ 周期必须**随事件一起定下来**。

## 5. 补扣执行体为什么**这一刀不做**

执行体 = 读 `pending` 事件 → 调扣分端点。
⚠ 当前 `pending` **恒为空**（客户端来源不可信 ⇒ 全部 `unbillable`）⇒
写出来是**恒空转的死代码**（"新增叶子模块单测全绿、生产引用数为 0"的同款缺陷）。

⇒ **判据**：写一个机制之前先问「**它的输入现在有吗**」。
⇒ 没有输入的机制 = 「等一段时间再重试」里的「等」——**没有随时间变化的恢复信号** ⇒ 纯空转。

⇒ 等 D-①（官方算力代理落地）或平台签名凭证落地 ⇒ 有可扣对象了 ⇒ 再写执行体 + 选宿主（U-14）。

## 6. 桌面端为什么用**后绑定**而不是构造参数

reporter 在 **phase1** 构造，identityService 在 **phase3** 才建（`identity-service-factory.js`）
⇒ 构造时拿不到 subject。

⇒ 仓内已有**同款后绑定先例**（phase3 里挂同一个 `ownerSubjectProvider`）：
`store.setOwnerSubjectProvider` / `accountManager.setOwnerSubjectProvider` /
`runStateStore.setOwnerProvider` / `taskQueue.setOwnerSubjectProvider` / `scheduler.setOwnerSubjectProvider`
⇒ **照同样做法**，不发明新机制。

## 7. 门禁与迁移

⚠ SQLite 的 `create_all` **不改已有表** ⇒ 补列必须配**幂等 ALTER**，且**与建表同批部署**
（否则部署后首次写入就报 `no such column`）。

⚠ **判据侧必须自带一份期望清单**：迁移测试若读「被测代码的补列清单」当期望值 ⇒
**自指断言**（清单少一列 ⇒ 断言也跟着少查一列 ⇒ 永远绿）。
⇒ 本刀的实测：变异「迁移少补一列」**第一版没被抓住** ⇒ 已修为
「判据侧字面清单 + 断言两者一致 + 断言表里有全部期望列」⇒ 复跑抓住 ✓
