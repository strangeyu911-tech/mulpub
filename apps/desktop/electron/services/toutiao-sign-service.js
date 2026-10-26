'use strict'

/**
 * 头条签名服务（本地实现，契约对齐参考产品的 /Sign/GetSign）
 *
 * 背景（2026-10-25 逆向取证）：
 *   参考产品在 qianming.<vendor>.cn:5031 上跑一个「浏览器签名服务」：
 *     POST /Sign/GetSign
 *     { url:"", cookie: JSON.stringify({qr, body, ua}), signType:"browser", signCommand:"toutiao" }
 *     → { signature }
 *   它的 signType 是 "browser"：服务端用真实页面里的 byted_acrawler VM 现算签名。
 *
 * 本实现做同样的事，但**把「签名 + 发请求」合并成一步**（更稳）：
 *   - 维护一个持久化的真实发布页（persist:account-<id>）
 *   - 收到请求后在该页面上下文里发起 XHR（页面 secsdk 会自动注入 msToken/a_bogus/csrf）
 *   - 返回 { signature: <响应体>, status }
 * 这样调用方拿到的就是平台真实响应，不需要自己再发一次（避免签名与请求不匹配）。
 *
 * 设计约束：
 *   - 只监听 127.0.0.1，不对外暴露
 *   - 不记录任何令牌明文
 */

const http = require('http')

const DEFAULT_PORT = 5031
const PUBLISH_PAGE = 'https://mp.toutiao.com/profile_v4/xigua/upload-video'

/** 极简 JSON body 读取 */
function readJson (req) {
  return new Promise(function (resolve) {
    let buf = ''
    req.on('data', function (c) { buf += c; if (buf.length > 5 * 1024 * 1024) req.destroy() })
    req.on('end', function () {
      try { resolve(JSON.parse(buf || '{}')) } catch (_e) { resolve(null) }
    })
  })
}

/**
 * 启动签名服务。
 * @param {{log?: object, getPage?: function(): Promise<object|null>}} opts
 *   getPage 需返回一个已登录、已初始化的 BrowserWindow（或 webContents 包装）
 * @returns {Promise<{port:number, close:function():Promise<void>}>}
 */
async function startSignService (opts) {
  const o = opts || {}
  const log = o.log
  const getPage = o.getPage || (async function () { return null })

  const server = http.createServer(async function (req, res) {
    if (req.method !== 'POST' || !/\/Sign\/GetSign$/.test(req.url || '')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    const body = await readJson(req)
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad json' }))
      return
    }
    try {
      const page = await getPage()
      if (!page || !page.webContents || page.isDestroyed()) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'no page' }))
        return
      }
      const target = String(body.url || PUBLISH_PAGE)
      const payload = typeof body.body === 'string' ? body.body : JSON.stringify(body.body || {})
      const code = [
        '(function(){',
        '  return new Promise(function(resolve){',
        '    try{',
        '      var x=new XMLHttpRequest();',
        '      x.open("POST", ' + JSON.stringify(target) + ', true);',
        '      x.withCredentials=true;',
        '      x.setRequestHeader("Content-Type","application/json");',
        '      x.onload=function(){ resolve(JSON.stringify({status:x.status, body:String(x.responseText||"").slice(0,4000)})) };',
        '      x.onerror=function(){ resolve(JSON.stringify({status:0, body:"XHR_ERROR"})) };',
        '      x.send(' + JSON.stringify(payload) + ');',
        '    }catch(e){ resolve(JSON.stringify({status:0, body:"ERR:"+e.message})) }',
        '  })',
        '})()',
      ].join('\n')
      const raw = await page.webContents.executeJavaScript(code, true)
      const out = JSON.parse(String(raw))
      if (log) log.info('SignService', 'sign+send status=' + out.status)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ signature: out.body, status: out.status }))
    } catch (e) {
      if (log) log.warn('SignService', 'failed: ' + String((e && e.message) || '').slice(0, 100))
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String((e && e.message) || 'error').slice(0, 200) }))
    }
  })

  await new Promise(function (resolve, reject) {
    server.once('error', reject)
    server.listen(DEFAULT_PORT, '127.0.0.1', resolve)
  })
  const port = server.address().port
  if (log) log.info('SignService', 'listening on 127.0.0.1:' + port)

  return {
    port: port,
    close: function () {
      return new Promise(function (resolve) { server.close(function () { resolve() }) })
    },
  }
}

module.exports = { startSignService, DEFAULT_PORT }
