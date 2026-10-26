// @ts-check
/**
 * upload-waiter-cdp-mixin.js — 上传链的 CDP 交互片段（从 upload-waiter.js 下沉）
 *
 * 为什么再拆一层（2026-10-26）：逐文件行数门禁 limit=500，
 * upload-waiter.js 在接入视频号/头条上传回落链后到 594 行。
 * 这三个方法只依赖 this.* 与 log，纯 CDP 交互，按本仓 mixin 范式再下沉一层。
 */
'use strict'

const log = require('./logger')

const uploadWaiterCdpMixin = {
  /**
   * 2026-10-23：视频号上传区是**纯拖拽区**（点击不弹原生选择器，实测两次 no fileChooserOpened）。
   * 用 CDP Input.dispatchDragEvent 把真实文件路径拖进去（dragData.files 支持绝对路径）。
   */
  /**
   * 2026-10-24（竞品 shipinghaoRun 逐字对照）：视频号页面是 wujie 微前端，
   * 上传框在 document.querySelector('.wujie_iframe').shadowRoot 内：
   *   const videoDom = shadowm.shadowRoot.querySelector('.upload')
   *   const inputDom = videoDom.querySelector('input[type="file"]')
   *   manualDispatchFileEvent({dom: inputDom, element: HTMLInputElement, elementKey: 'files', value: files.files, event: 'change'})
   * 即：用 HTMLInputElement.prototype 的原生 files setter 写值，再派发 change。
   */
  /**
   * 2026-10-24：JS 写入 files 被平台拒（isTrusted）⇒ 改用 CDP 真实鼠标点击 + 文件选择器拦截。
   * Input.dispatchMouseEvent 是浏览器级输入，isTrusted=true，等价真人点击。
   */
  async _clickThenChooser (win, x, y, filePath) {
    const path2 = require('path')
    const dbg = win.webContents.debugger
    let attached = false
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true }
      await dbg.sendCommand('Page.enable')
      await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
      const opened = new Promise((resolve) => {
        const h = (_e, method, params) => { if (method === 'Page.fileChooserOpened') { dbg.removeListener('message', h); resolve(params) } }
        dbg.on('message', h)
        setTimeout(() => { try { dbg.removeListener('message', h) } catch (_e0) { void 0 } ; resolve(null) }, 6000)
      })
      for (const type of ['mousePressed', 'mouseReleased']) {
        await dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
      }
      const ev = await opened
      if (!ev || !ev.backendNodeId) { log.warn('RpaView', 'click-chooser: no fileChooserOpened'); return false }
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [path2.resolve(filePath)], backendNodeId: ev.backendNodeId })
      log.info('RpaView', 'click-chooser: set files via backendNodeId=' + ev.backendNodeId)
      return true
    } catch (eC) {
      log.warn('RpaView', 'click-chooser failed: ' + (eC && eC.message ? eC.message.slice(0,120) : ''))
      return false
    } finally {
      if (attached) { try { dbg.detach() } catch (_e1) { void 0 } }
    }
  },

  async _uploadViaWujie (win, filePath) {
    const fs2 = require('fs')
    const path2 = require('path')
    const abs = path2.resolve(filePath)
    // wujie-ready-wait：页面未初始化时 .wujie_iframe 还不存在，直接灌文件会静默失败。
    try {
      const readyExpr = 'new Promise(function(res){var n=0;var t=setInterval(function(){n++;var h=document.querySelector(".wujie_iframe");if(h&&h.shadowRoot){clearInterval(t);res(true)}else if(n>40){clearInterval(t);res(false)}},200)})'
      const ready = await Promise.race([
        win.webContents.executeJavaScript(readyExpr, true),
        new Promise(function (res) { setTimeout(function () { res(false) }, 9000) })
      ])
      log.info('RpaView', 'wujie-ready-wait: ready=' + ready)
      if (!ready) return false
    } catch (_eR) { log.warn('RpaView', 'wujie-ready-wait failed'); return false }
    const b64 = fs2.readFileSync(abs).toString('base64')
    const name = path2.basename(abs)
    const expr = '(function(){' +
      'var host=document.querySelector(".wujie_iframe");' +
      'if(!host||!host.shadowRoot)return {ok:false,why:"no-wujie-shadow"};' +
      'var up=host.shadowRoot.querySelector(".upload");' +
      'if(!up)return {ok:false,why:"no-upload"};' +
      'var input=up.querySelector(\'input[type="file"]\');' +
      'if(!input)return {ok:false,why:"no-input"};' +
      'var bin=atob("' + b64 + '");var arr=new Uint8Array(bin.length);' +
      'for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);' +
      'var f=new File([arr],' + JSON.stringify(name) + ',{type:"video/mp4"});' +
      'var dt=new DataTransfer();dt.items.add(f);' +
      'var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"files");' +
      'if(d&&d.set){d.set.call(input,dt.files)}else{input.files=dt.files}' +
      'input.dispatchEvent(new Event("change",{bubbles:true}));' +
      'var r=up.getBoundingClientRect();' +
      'var pb=[].slice.call(host.shadowRoot.querySelectorAll("button")).some(function(b){return (b.innerText||"").indexOf("发表")>=0});' +
      'return {ok:true,w:Math.round(r.width),h:Math.round(r.height),n:f.size,publishBtnAfter:pb};' +
    '})()'
    try {
      const r = await Promise.race([
        win.webContents.executeJavaScript(expr, true),
        new Promise(function (_res, rej) { setTimeout(function () { rej(new Error('wujie-upload timeout 20s')) }, 20000) })
      ])
      log.info('RpaView', 'wujie-upload: ' + JSON.stringify(r))
      if (r && r.publishBtnAfter === true) { this._uploadConfirmed = true; log.info('RpaView', 'wujie-upload: publishBtnAfter=true -> upload confirmed by page') }
      return !!(r && r.ok)
    } catch (eW) {
      log.warn('RpaView', 'wujie-upload failed: ' + (eW && eW.message ? eW.message.slice(0,120) : ''))
      return false
    }
  },

  async _dropViaCdp (win, filePath, selector) {
    // 一次性问清：本页有哪些 shadow host（上传区必挂在其中之一）
    try {
      const _hosts = await Promise.race([win.webContents.executeJavaScript("(function(){var out=[];var all=document.querySelectorAll('*');for(var i=0;i<all.length&&out.length<12;i++){var e=all[i];if(e.shadowRoot){out.push((e.tagName||'')+'.'+String(e.className||'').slice(0,40)+'#'+(e.id||''))}}return out})()", true), new Promise(function (res) { setTimeout(function () { res(['probe-timeout']) }, 6000) })])
      log.info('RpaView', 'shadow-hosts: ' + JSON.stringify(_hosts))
    } catch (_eH) { log.warn('RpaView', 'shadow-hosts probe failed') }
    // wujie-first restored（2026-10-24 01:04 实测 ok:true, n=255745）：竞品选择器在本页有效。
    try { if (await this._uploadViaWujie(win, filePath)) { log.info('RpaView', 'cdp-drop: wujie-first ok'); return true } } catch (_eWf) { void 0 }
    const path = require('path')
    const dbg = win.webContents.debugger
    let attached = false
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true }
      await dbg.sendCommand('DOM.enable')
      // pierce: true —— 视频号发布页的上传区在 iframe(micro/content/post/create) 内，主文档查不到。
      const doc = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
      // 文字锚点（2026-10-23 截图）：上传区里有「上传时长8小时内…」/「添加视频」，比类名稳。
      let useSel = selector
      try {
        const marked = await win.webContents.executeJavaScript('(function(){var a=[].slice.call(document.querySelectorAll("div,section"));for(var i=0;i<a.length;i++){var t=a[i].innerText||"";if(t.indexOf("上传时长")>=0||t.indexOf("添加视频")>=0||t.indexOf("点击上传")>=0){a[i].setAttribute("data-mp-drop","1");return "marked"}}return "none"})()', true)
        if (marked === 'marked') useSel = '[data-mp-drop="1"]'
      } catch (_e12) { /* 锚点失败沿用原选择器 */ }
      let q = await dbg.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: useSel })
      // frameId fallback：pierce 对 iframe 不一定生效，改按 frameId 逐帧查。
      if(!q || !q.nodeId){
        try {
          const ft = await dbg.sendCommand('Page.getFrameTree')
          const flat = []
          const walk = (n) => { if(!n) return; flat.push(n.frame); if(n.childFrames) n.childFrames.forEach(walk) }
          walk(ft.frameTree)
          for(const f of flat){
            if(!f || !f.id) continue
            try {
              const fd = await dbg.sendCommand('DOM.getDocument', { depth: -1, frameId: f.id })
              const fq = await dbg.sendCommand('DOM.querySelector', { nodeId: fd.root.nodeId, selector: useSel })
              if(fq && fq.nodeId){ q = fq; log.info('RpaView', 'cdp-drop: hit in frame ' + String(f.url||'').slice(0,80)); break }
            } catch (_e14) { /* 该帧不可查，继续 */ }
          }
        } catch (_e15) { /* 无 frame tree，沿用 pierce 结果 */ }
      }
      if (!q || !q.nodeId) { log.warn('RpaView', 'cdp-drop: target not found ' + selector); return false }
      // boxModelPrimary：穿透 iframe 后的节点只能用 CDP 取几何；JS 的 document.querySelector 在
      // 主文档执行，查不到 iframe 内的元素。取不到时回落到视口中心。
      let x = 400, y = 300, rect = null
      try {
        const box = await dbg.sendCommand('DOM.getBoxModel', { nodeId: q.nodeId })
        const c = box && box.model && box.model.content
        if (c && c.length >= 8) {
          // 2026-10-26：CDP 对 NaN 报 Invalid parameters，且错误指向下游命令 ⇒ 先算再校验。
          rect = { via: 'boxModel', x: Math.round((c[0] + c[2] + c[4] + c[6]) / 4), y: Math.round((c[1] + c[3] + c[5] + c[7]) / 4) }
          if (isFinite(rect.x) && isFinite(rect.y)) { x = rect.x; y = rect.y }
        }
      } catch (_e13) { /* 回落视口中心 */ }
      log.info('RpaView', 'cdp-drop: target rect ' + JSON.stringify(rect) + ' -> (' + x + ',' + y + ')')
      // 2026-10-23：CDP 报 `Invalid parameters` —— dragData.items 不能是空数组，
      // 必须至少一项；文件本体走 files（绝对路径）。
      const _abs = path.resolve(filePath)
      // minimalDragData：CDP 对 title/baseURL 的空串敏感，只保留必需字段。
      const data = {
        items: [{ mimeType: 'text/plain', data: '' }],
        files: [_abs],
        dragOperationsMask: 1
      }
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await dbg.sendCommand('Input.dispatchDragEvent', { type, x, y, data })
      }
      log.info('RpaView', 'cdp-drop: dispatched ' + path.basename(filePath) + ' -> ' + selector)
      return true
    } catch (e) { log.warn('RpaView', 'cdp-drop failed: ' + e.message); return false }
    finally { if (attached) { try { dbg.detach() } catch (_) { /* ignore */ } } }
  },
}

module.exports = { uploadWaiterCdpMixin }
