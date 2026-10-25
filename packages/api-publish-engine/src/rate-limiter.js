class RateLimiter {
  constructor(opts) {
    opts = opts || {};
    this._windowMs = opts.windowMs || 60000;
    this._maxRequests = opts.maxRequests || 100;
    // ⛔ 容器必须是 Map，**不能是普通对象**（`{}` / `Object.create(null)` 之外的写法一律不行）。
    //
    // 为什么（2026-10-25 实测，独立复评 F1）：
    //   本模块的键 = **客户端身份**，而本 PR 之后它取自 `X-Forwarded-For` 的**最右元素**
    //   （`src/client-ip.js`）⇒ **键完全由客户端控制**（此前是 `req.socket.remoteAddress`，
    //   内核给的值，XFF 分支其实是死代码）。
    //   用普通对象时，`this._clients['__proto__']` 读到的是**继承来的 `Object.prototype`**
    //   （truthy）⇒ 判定「桶已存在」⇒ 跳过的却是 `client.timestamps` 为 undefined 的真身
    //   ⇒ `undefined.filter(...)` 抛 TypeError。
    //   而 `publish-api-server.js` 的 `http.createServer(...)` 对 `_handle` **没有 .catch**
    //   ⇒ 一次未捕获异常就**打崩引擎进程**（单个请求头即可 DoS）。
    //   受影响的键名不止 `__proto__`：`constructor` / `toString` / `valueOf` /
    //   `hasOwnProperty` 同样命中继承属性。
    //
    // Map 没有原型链 ⇒ 任何字符串都是普通键。兄弟模块 `src/auth/redeem-rate-limit.js`
    // 本来就用的 Map（同款口径），这里是补齐同一件事。
    this._clients = new Map();
    // 客户端键数上限：键 = 客户端 IP ⇒ 直连部署下攻击者用大量来源 IP 就能撑爆内存。
    // 超限时按插入顺序逐出最老的键（近似 LRU）。
    this._maxClients = opts.maxClients || 20000;
    var self = this;
    this._timer = setInterval(function() { self._cleanup(); }, Math.min(this._windowMs, 60000));
    // R28 修复：清理窗口定时器需 unref，不阻止进程退出
    if (this._timer && this._timer.unref) this._timer.unref();
  }

  check(ip) {
    ip = ip || "unknown";
    var now = Date.now();
    var client = this._clients.get(ip);
    if (!client) {
      client = { timestamps: [] };
      this._clients.set(ip, client);
      this._evictOldest();
    }
    // Remove expired timestamps
    var cutoff = now - this._windowMs;
    client.timestamps = client.timestamps.filter(function(t) { return t > cutoff; });
    if (client.timestamps.length >= this._maxRequests) return false;
    client.timestamps.push(now);
    return true;
  }

  /** 键数超限时逐出最老的键（一次逐出超出量与 10% 的较大者 ⇒ 摊还 O(1)）。 */
  _evictOldest() {
    var keys = Array.from(this._clients.keys());
    if (keys.length <= this._maxClients) return;
    var removeCount = Math.max(keys.length - this._maxClients, Math.ceil(this._maxClients * 0.1));
    for (var i = 0; i < removeCount && i < keys.length; i++) this._clients.delete(keys[i]);
  }

  /** 当前客户端键数（观测用）。 */
  clientCount() {
    return this._clients.size;
  }

  _cleanup() {
    var now = Date.now();
    var cutoff = now - this._windowMs * 2;
    // Map 的迭代顺序 = 插入顺序；删除不改变其余键的相对顺序。
    var self = this;
    this._clients.forEach(function (client, ip) {
      client.timestamps = client.timestamps.filter(function(t) { return t > cutoff; });
      if (client.timestamps.length === 0) self._clients.delete(ip);
    });
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._clients.clear();
  }
}

module.exports = { RateLimiter };
