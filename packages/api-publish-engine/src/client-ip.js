'use strict'
/**
 * client-ip.js — 取请求的「真实客户端 IP」（限流分桶用）。
 *
 * ## 为什么需要这一个文件（单一真源）
 *
 * 仓里有**两套**限流：① 全站粗桶（`src/rate-limiter.js`，挂在 `publish-api-server.js`
 * 的全局限流位，**不分端点、不分成败**）② 兑换端点级限流
 * （`src/auth/redeem-rate-limit.js`，**按失败计数**）。
 *
 * 两者都必须按「**同一个真实客户端 IP**」分桶，否则就会出现
 * 「端点级限流按真实 IP 生效、全站粗桶按回环地址生效」的**口径分裂**。
 *
 * ## 为什么取 X-Forwarded-For 的**最右**元素
 *
 * 生产拓扑（`deploy/logto/nginx/auth.iart.work.conf.new`）：nginx 把 `/api/v1/` 反代到
 * `127.0.0.1:3030`，而**引擎只绑回环** ⇒ 引擎看到的 `req.socket.remoteAddress`
 * **恒为 `127.0.0.1`** ⇒ 若按 socket 分桶，**全站所有用户共用同一个桶**：
 * 一个人打满额度，**所有正常用户一起被限**（第 3 轮红队实测：即便客户端伪造 XFF 也无效，
 * 第 6 个请求就被粗桶 429）。
 *
 * nginx 用 `$proxy_add_x_forwarded_for`：它把**自己看到的真实客户端 IP 追加到已有 XFF 的末尾**
 * ⇒ **最右元素才是可信的那个**。取最左则客户端自带一个伪造 XFF 就能把计数打到别人头上。
 *
 * ⚠️ 直连（不经反代）时 XFF 完全由客户端控制 ⇒ 可被伪造来绕开 IP 桶。
 * 那是**有意取舍**：生产必然经 nginx（引擎只绑回环、外网不可直连），
 * 「用不可信的 XFF」比「用恒为 127.0.0.1 的 socket」危害小得多；
 * 且用户维度（同一账号 60 秒 5 次失败）不受 IP 维度被绕开的影响。
 *
 * @param {object} req  Node 的 IncomingMessage（只要 headers / socket 就够）
 * @returns {string|null} 客户端 IP；**取不到时返回 null**（调用方决定兜底成什么）
 */
function clientIpFromRequest (req) {
  if (!req) return null
  const headers = req.headers || {}
  // Node 会把重复的同名 header 用 ", " 合并（set-cookie 除外）⇒ 这里拿到的是字符串。
  const forwarded = headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1] // 最右 = 真实客户端
  }
  const address = req.socket && req.socket.remoteAddress
  return typeof address === 'string' && address ? address : null
}

module.exports = { clientIpFromRequest }
