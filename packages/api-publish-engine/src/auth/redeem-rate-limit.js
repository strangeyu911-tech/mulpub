'use strict'
/**
 * redeem-rate-limit.js — 兑换失败限流（温和档）。
 *
 * ## 为什么需要它
 *
 * 兑换码是 31 字符字母表上的随机 12 位（组合空间 ≈ 7.88×10^17），**穷举不现实**。
 * 但 `REDEEM_CODE_NOT_FOUND` 会明确告诉调用方「这个码不存在」⇒ 可被用来
 * **定向探测某个具体码是否存在**（社交工程拿到的码、批量泄漏的码列表）。
 * 同时它也是最容易被用来骚扰的端点。
 *
 * ## 与仓里既有的 `src/rate-limiter.js` 的关系（⚠️ 前提已按生产实际更正）
 *
 * 那个是**全站粗桶**：① 不区分端点（兑换与发布共用一个计数器）；② **不区分成败**
 * （成功请求同样计数）；③ 单进程内存态（多实例部署时每个实例各算各的）。
 * ⇒ 对兑换场景基本无效：低速率定向探测抓不到；正常流量反而先占满额度。
 *
 * ⚠️ **它不是「默认关闭」**（初稿这里写错过，2026-10-24 实测更正）：
 * 生产 compose 是 `MAX_RPM=${MAX_RPM:-100}`，`deploy/logto/api.env.example` 也是 `MAX_RPM=100`
 * ⇒ **全站粗桶在生产是开着的**。
 *
 * ⚠️ **更要紧的一条：粗桶的分桶键此前是 socket 优先**（`publish-api-server.js` 的全局限流位），
 * 而生产拓扑是 nginx → `127.0.0.1:3030`、引擎只绑回环
 * ⇒ 引擎看到的来源地址**恒为 127.0.0.1** ⇒ **全站所有用户共用同一个 100 次/分钟的桶**。
 * 实测：即便客户端伪造 XFF 也无效，第 6 个请求就被粗桶 429。
 *
 * ⇒ 因此**本模块的兑换限流在生产拓扑下会被这个前置粗桶部分遮蔽**（实际生效面小于设计预期）。
 *
 * ✅ **该问题已在本 PR 一并修掉**（2026-10-25）：粗桶的分桶键改为**真实客户端 IP**
 * （X-Forwarded-For 最右），与本模块**同源**（`src/client-ip.js` 是唯一真源，两套限流共用）。
 * ⚠️ 本段原先写的是「该条不在本 PR 的改动范围（全局限流位未动）… 登记为下一轮的最高优先级」
 * —— **那句话已随本 PR 的改动过期**，写在这里是为了让后来者知道：
 * **粗桶已经改过了，不要重复做，也不要把它回退成 socket 优先。**
 *
 * ## 本模块的口径（端点级 + 失败计数）
 *
 *   - 同一用户：60 秒内**失败** ≥ 5 次 ⇒ 429
 *   - 同一 IP：10 分钟内**失败** ≥ 200 次，**或**最近 60 秒内失败 ≥ 60 次 ⇒ 429
 *     （两个条件是 **OR**：任一达标即拦 ⇒ 慢速但总量很大的「节流规避」形态也拦得住）
 *     （阈值刻意很高：实测 2 个账号/3 分钟就能打满低阈值 ⇒ 会锁死整个共享出口）
 *   - **只计失败**，成功不计数；一次成功还会**清零**该用户的失败计数
 *   - 命中时只回 429，**不透露剩余次数**（否则限流器本身可被探测）
 *
 * ## 为什么用户维度要「预占」额度（并发绕过）
 *
 * 若限流判定是「先看计数、再执行、失败后才计数」，那么**并发请求会全部通过**：
 * 20 个并发请求在同一瞬间都读到计数为 0 ⇒ 全部进入 ⇒ 限流形同虚设。
 * 这是典型的 TOCTOU。
 *
 * ⇒ 本模块用**预占（pending）**堵：请求进入时先占一个「待定失败」额度，
 * **失败时转正为失败、成功时释放**。有效占用 = 失败数 + 待定数。
 * ⇒ 并发 20 个失败请求时，只有前 5 个能进（阈值 5），其余当场被拦。
 *
 * ⚠️ `acquire()` 必须**同步完成检查与预占**（内部无 await）——
 * Node 单线程下，同步块不会被并发请求交错 ⇒ 这就是原子性的来源。
 *
 * ## IP 维度为什么要加「速率」条件（避免误伤共享出口）
 *
 * 公司 NAT / 校园网 / 家庭网关下，很多正常用户共用同一个出口 IP。
 * 若只用一个**低阈值总量条件**判定，那些用户**各失败一两次**就足以把
 * **同出口的所有正常用户**一起锁在门外。
 *
 * ⇒ IP 档用**两个条件取或**：① **10 分钟内失败 ≥ 200 次**（总量）
 *   **或** ② **最近 60 秒内失败 ≥ 60 次**（速率）：
 *   - 单 IP 快速探测 ⇒ 速率达标 ⇒ **触发**
 *   - 慢速但总量很大 ⇒ 总量达标 ⇒ **也触发**（否则「节流规避」能完全绕开 IP 档）
 *   - 共享出口慢速偶发失败 ⇒ 两个都不达标 ⇒ **不触发** ⇒ 不误伤
 *
 * ## 诚实边界
 *
 * 计数是**进程内内存态**：多实例部署时每个实例各算各的 ⇒ 实际阈值是「阈值 × 实例数」。
 * 与仓内既有 `rate-limiter.js` 同一形态。要跨实例精确，需要 Redis 之类的共享存储，
 * 本期不做（**先上温和档**，观察一周真实数据再决定是否收紧或上共享存储）。
 */

/**
 * 温和档默认参数：用户 60 秒 5 次失败；IP 10 分钟 200 次失败**或** 60 秒内 60 次。
 *
 * ⚠️ IP 阈值为什么这么高（对抗性审查实测出来的）：原先用「10 分钟 30 次 + 60 秒内 10 次」，
 * 实测**2 个普通账号 / 约 3 分钟**就能打满 ⇒ **同出口 IP 的全部正常用户被锁 10 分钟**。
 * 共享出口（公司 NAT / 校园网 / 家庭网关）下，几十个用户各失败一两次就会误伤整个出口。
 * ⇒ IP 档收紧到「只有明显的高速攻击才触发」：需要同一 IP 在 60 秒内失败 60 次
 * （即平均每秒 1 次持续一分钟），正常用户群体不可能达到。
 *
 * ⚠️ **诚实边界**：即便如此，极端情况下（同一出口真的在高速攻击）共享用户仍可能被限。
 * 这是「IP 维度阻断」的固有代价。本期按用户拍板的「温和档」取向，取「宁可放过、
 * 不误伤」的一侧。彻底解法是共享存储 + 分布式计数 + 按出口 IP 识别 NAT 集群，属后续议题。
 */
const DEFAULT_USER_WINDOW_MS = 60 * 1000
const DEFAULT_USER_MAX_FAILURES = 5
const DEFAULT_IP_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_IP_MAX_FAILURES = 200
/** IP 档的速率条件：最近这么多毫秒内失败次数达到该值才触发（防共享出口误伤）。 */
const DEFAULT_IP_BURST_WINDOW_MS = 60 * 1000
const DEFAULT_IP_BURST_FAILURES = 60

/** 清理间隔：与最短窗口同量级即可，不必更频繁。 */
const CLEANUP_INTERVAL_MS = 60 * 1000

class RedeemFailureLimiter {
  constructor (options = {}) {
    this.userWindowMs = Number.isFinite(options.userWindowMs) ? options.userWindowMs : DEFAULT_USER_WINDOW_MS
    this.userMaxFailures = Number.isFinite(options.userMaxFailures) ? options.userMaxFailures : DEFAULT_USER_MAX_FAILURES
    this.ipWindowMs = Number.isFinite(options.ipWindowMs) ? options.ipWindowMs : DEFAULT_IP_WINDOW_MS
    this.ipMaxFailures = Number.isFinite(options.ipMaxFailures) ? options.ipMaxFailures : DEFAULT_IP_MAX_FAILURES
    this.ipBurstWindowMs = Number.isFinite(options.ipBurstWindowMs) ? options.ipBurstWindowMs : DEFAULT_IP_BURST_WINDOW_MS
    this.ipBurstFailures = Number.isFinite(options.ipBurstFailures) ? options.ipBurstFailures : DEFAULT_IP_BURST_FAILURES
    // 可注入时钟：滑窗行为（窗口过期、速率条件）必须能被**不靠等待**地测出来。
    // 真实环境用 Date.now()；测试里推进虚拟时间即可覆盖「10 分钟后窗口过期」这类分支。
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    // 桶数量上限（每个维度各一份）：失败一次就新建一个桶 ⇒ 攻击者用**海量不同的
    // userId / IP** 就能把进程内存撑爆（第 3 轮红队实测边际 679 字节/(user键+ip键)对，
    // 20k 键对 ≈ 13.5 MB，且**无上限**）。超限时按插入顺序逐出最老的桶（近似 LRU）。
    this.maxBuckets = Number.isFinite(options.maxBuckets) ? options.maxBuckets : 10000
    // key → { failures: number[], pending: number[] }（均为滑窗时间戳数组）
    this._users = new Map()
    this._ips = new Map()
    this._timer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS)
    // 清理定时器不得阻止进程退出（与仓内 rate-limiter.js 同款处理）
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref()
  }

  /**
   * **原子**地做限流判定并预占额度。
   *
   * ⚠️ 内部**不得**有 await：Node 单线程下，同步块不会被并发请求交错，
   * 这正是「并发请求无法同时通过判定」的来源。
   *
   * @returns {{ blocked: boolean, scope: 'user'|'ip'|null }}
   */
  acquire (userId, ip) {
    const now = this.now()
    if (userId) {
      const bucket = this._bucket(this._users, userId, now, this.userWindowMs)
      // 有效占用 = 已失败 + 待定（待定是「已经放行、结果未知的在途请求」）
      if (bucket.failures.length + bucket.pending.length >= this.userMaxFailures) {
        return { blocked: true, scope: 'user' }
      }
    }
    if (ip) {
      const bucket = this._bucket(this._ips, ip, now, this.ipWindowMs)
      const burst = bucket.failures.filter((ts) => ts > now - this.ipBurstWindowMs).length
      // ⚠️ 两个条件是 **OR**，不是 AND。
      // 红队实测打穿：用 AND 时，把速率压在 60 次/分以下就能让 burst 永远不达标
      // ⇒ 即便 10 分钟内累计 500+ 次失败，IP 档也**一条不拦**（实测 1770 次 0 次 429）。
      // OR 语义下：
      //   - 慢速但总量很大（节流规避）⇒ 总量条件命中 ⇒ **拦**
      //   - 高速（burst 达标）⇒ **拦**
      //   - 共享出口的偶发失败（两个条件都不达标）⇒ **不拦**（不误伤）
      if (bucket.failures.length >= this.ipMaxFailures || burst >= this.ipBurstFailures) {
        return { blocked: true, scope: 'ip' }
      }
    }
    // 通过 ⇒ 预占一个待定额度（用户维度）。失败时转正，成功时释放。
    if (userId) this._bucket(this._users, userId, now, this.userWindowMs).pending.push(now)
    return { blocked: false, scope: null }
  }

  /** 记一次失败（只对「探测型」错误调用）：待定转正为失败。 */
  recordFailure (userId, ip) {
    const now = this.now()
    if (userId) {
      const bucket = this._bucket(this._users, userId, now, this.userWindowMs)
      bucket.pending.pop()
      bucket.failures.push(now)
    }
    if (ip) {
      const bucket = this._bucket(this._ips, ip, now, this.ipWindowMs)
      bucket.failures.push(now)
    }
  }

  /** 一次成功：释放待定额度，并清掉该用户的失败计数（IP 计数不清 —— 同 IP 可能是多用户共用出口）。 */
  recordSuccess (userId) {
    if (!userId) return
    const bucket = this._bucket(this._users, userId, this.now(), this.userWindowMs)
    bucket.pending.pop()
    bucket.failures.length = 0
  }

  /**
   * 释放一次**待定**额度，但不记为失败。
   *
   * ⚠️ 这个方法的存在是因为 `acquire()` 会**预占**额度。请求若以「非探测型」错误结束
   * （已用 / 停用 / 过期 / 服务端 500），既不该记失败、也不算成功 ——
   * 但**必须**把预占还回去，否则 pending 永久累积 ⇒
   * 用户只是反复拿自己的旧码来试，也会被限流在门外。
   */
  releasePending (userId) {
    if (!userId) return
    const bucket = this._bucket(this._users, userId, this.now(), this.userWindowMs)
    bucket.pending.pop()
  }

  /** 当前计数（供测试与运营自查；不通过 HTTP 暴露）。 */
  counts (userId, ip) {
    const now = this.now()
    const user = userId ? this._bucket(this._users, userId, now, this.userWindowMs) : null
    const ipBucket = ip ? this._bucket(this._ips, ip, now, this.ipWindowMs) : null
    return {
      userFailures: user ? user.failures.length : 0,
      userPending: user ? user.pending.length : 0,
      ipFailures: ipBucket ? ipBucket.failures.length : 0,
    }
  }

  stop () {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    this._users.clear()
    this._ips.clear()
  }

  /**
   * 取（或建）一个滑窗桶。
   *
   * ⚠️ `windowMs` 必须**按维度传**：IP 桶用 ipWindowMs（10 分钟），
   * 用户桶用 userWindowMs（60 秒）。若 IP 桶误用短窗口，
   * 「10 分钟内失败 ≥ 200 次」这个总量条件**永远达不到** ⇒ IP 档静默永不触发
   * （比不实现更糟：看起来有防护，实际没有）。
   *
   * ⚠️ 这里**不能**在桶为空时 `store.delete(key)`：删除后仍返回该 bucket，
   * 调用方接下来的写入会落到一个**已经不在 store 里**的 bucket ⇒ 计数丢失。
   * 空桶由 `_cleanup()` 定期清。
   */
  _bucket (store, key, now, windowMs) {
    let bucket = store.get(key)
    if (!bucket) {
      bucket = { failures: [], pending: [] }
      store.set(key, bucket)
      this._evictOldBuckets(store)
    }
    const cutoff = now - windowMs
    bucket.failures = bucket.failures.filter((ts) => ts > cutoff)
    bucket.pending = bucket.pending.filter((ts) => ts > cutoff)
    return bucket
  }

  /**
   * 桶数量超限时逐出**最老**的桶（Map 的迭代顺序 = 插入顺序 ⇒ 近似 LRU）。
   *
   * ⚠️ 逐出会让那个 key 的计数**归零** ⇒ 逐出的代价是「该 key 多几次机会」，
   * 不是「该 key 绕过限流」⇒ 可接受（限流器是安全阀，不是安全边界）。
   * 一次逐出超出量（而不是只逐出 1 个）⇒ 摊还 O(1)，不会在洪泛下退化。
   */
  _evictOldBuckets (store) {
    const limit = this.maxBuckets
    if (!limit || store.size <= limit) return
    const excess = Math.max(store.size - limit, Math.ceil(limit * 0.1))
    let removed = 0
    for (const key of store.keys()) {
      if (removed >= excess) break
      store.delete(key)
      removed += 1
    }
  }

  /** 当前桶数量（观测用：内存占用 / 逐出是否生效）。 */
  bucketCounts () {
    return { users: this._users.size, ips: this._ips.size }
  }

  _cleanup () {
    const now = this.now()
    for (const [store, windowMs] of [[this._users, this.userWindowMs], [this._ips, this.ipWindowMs]]) {
      const cutoff = now - windowMs
      for (const [key, bucket] of store) {
        bucket.failures = bucket.failures.filter((ts) => ts > cutoff)
        bucket.pending = bucket.pending.filter((ts) => ts > cutoff)
        if (!bucket.failures.length && !bucket.pending.length) store.delete(key)
      }
    }
  }
}

/**
 * 判定某个 commerce 错误是否算「探测型失败」（计入限流）。
 *
 * 计入（探测行为）：
 *   - `REDEEM_CODE_FORMAT`   格式错 ⇒ 拿随机串乱试
 *   - `REDEEM_CODE_NOT_FOUND` 不存在 ⇒ 在探测某张具体码是否存在
 *   - `REDEEM_CODE_USED`      已被**别人**用过 ⇒ 也是在确认「这张码是真的」
 *   - `REDEEM_CODE_DISABLED`  已被运营作废 ⇒ 同样在确认
 *
 *   - `REDEEM_CODE_EXPIRED`   过期（第 3 轮红队实测后**改为计入**，理由见下）
 *   - 成功与**幂等重放**（本人重放自己已用过的码）⇒ 返回 200 + `idempotent: true`，
 *     走的是成功路径，不进这里；红队实测的「免费存在性预言机」正是靠这一点区分开的。
 *
 * ⚠️ **「过期」原先不算，第 3 轮实测后改为算**（这一条改的是判定口径，不是措辞）：
 * 实测同一账号连打 30 次过期码 ⇒ 全部 410、用户维度失败计数 **0**、**一次 429 都没有**；
 * 接上生产同值的全局粗桶（MAX_RPM=100）后 120 次请求 = 100×410 + 20×429，计数仍是 0
 * ⇒ **有效探测速率从 5 次/60 秒变成 100 次/60 秒（20×）**。
 * 且 410 与 404 **可区分**（body 的 error 码不同）⇒ 过期码成了**零成本的存在性预言机**。
 * ⇒ 代价：过期用户若在 60 秒内反复重试会被限流（第一次尝试已明确告知过期）——
 * 这个代价远小于「20× 探测速率 + 免费的预言机」。
 * ⇒ 真正**不计入**的只剩**服务端故障**（不是用户的错）。
 *
 * ⚠️ 红队实测打穿点④（200 次探测 0 计数）：原先「已用/已停用不计数」，
 * 攻击者拿**泄漏的码清单**逐个试 —— 已被别人用过的码回 409 且**不计数** ⇒
 * **免费的存在性预言机**（能确认哪些泄漏的码是真的），且完全不触发限流。
 * ⇒ 把 USED / DISABLED 纳入计数。
 */
function isProbeFailure (error) {
  if (!error) return false
  return error.code === 'REDEEM_CODE_FORMAT'
    || error.code === 'REDEEM_CODE_NOT_FOUND'
    || error.code === 'REDEEM_CODE_USED'
    || error.code === 'REDEEM_CODE_DISABLED'
    || error.code === 'REDEEM_CODE_EXPIRED'
}

module.exports = {
  RedeemFailureLimiter,
  isProbeFailure,
  DEFAULT_USER_WINDOW_MS,
  DEFAULT_USER_MAX_FAILURES,
  DEFAULT_IP_WINDOW_MS,
  DEFAULT_IP_MAX_FAILURES,
  DEFAULT_IP_BURST_WINDOW_MS,
  DEFAULT_IP_BURST_FAILURES,
}
