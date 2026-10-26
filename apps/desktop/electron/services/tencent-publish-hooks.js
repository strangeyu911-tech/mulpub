'use strict'

/**
 * tencent-publish-hooks.js — 视频号「发表」点击链（从 rpa-view-platforms.js 下沉）
 *
 * 为什么独立（2026-10-26）：该链 94 行，rpa-view-platforms.js 受 1499 行点名目标约束。
 * 语义不变：wujie shadowRoot → 原生输入事件 → 子帧 → 指针序列 → 轮询「直接发表」→ CDP 兜底。
 */

const log = require('./logger')

async function clickPublishTencent (win, logger, sleep) {
  const L = logger || log
  const wait = sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  // programmatic publish click（2026-10-23：视频号遮挡层会被 React 持续重建，坐标点击必被拦）。
  // 直接对按钮元素调用 click()，不经过命中测试，因此不受遮挡影响。
    // wait-processing（2026-10-24 抓包）：页面在 post_clip_video 后轮询 post_clip_video_result 等转码，
    // 过早点击「发表」会被内部状态忽略 ⇒ 固定等 20s 再点。
    log.info('RpaView', '[tencent_video] wait-processing 20s before publish click')
    await sleep(20000)
    log.info('RpaView', '[tencent_video] publish-click: begin')
    try {
      const pc = await win.webContents.executeJavaScript('(function(){var host=document.querySelector(".wujie_iframe");var roots=[document];if(host&&host.shadowRoot)roots.push(host.shadowRoot);var hit=null;for(var r=0;r<roots.length&&!hit;r++){var bs=[].slice.call(roots[r].querySelectorAll("button,[class*=btn],[role=button]"));for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||"").replace(/\\s+/g,"");if(t==="发表"&&!bs[i].disabled){hit=bs[i];continue}else if(t.indexOf("发表")>=0&&!hit&&!bs[i].disabled&&t.length<=6){hit=bs[i]}}}if(!hit)return "not-found";var _di=!!hit.disabled;var _cls=String(hit.className||"").slice(0,40);var _ht=String(hit.outerHTML||"").replace(/\\s+/g," ").slice(0,160);hit.click();return "clicked-wujie|disabled="+_di+"|cls="+_cls+"|html="+_ht})()', true)
      log.info('RpaView', '[tencent_video] programmatic publish click: ' + pc)
    // native-publish-click：element.click() 可信度不足（框架可能忽略），改用 Electron 原生输入事件。
    if (String(pc).indexOf('clicked-wujie') === 0) {
      try {
        const _rc = await win.webContents.executeJavaScript('(function(){var h=document.querySelector(".wujie_iframe");if(!h||!h.shadowRoot)return null;var bs=[].slice.call(h.shadowRoot.querySelectorAll("button"));var t=null;for(var i=0;i<bs.length;i++){var x=(bs[i].innerText||"").replace(/\\s+/g,"");if(x==="发表"){t=bs[i];break}}if(!t)return null;t.scrollIntoView({block:"center",inline:"center"});var r=t.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height),pe:getComputedStyle(t).pointerEvents}})()', true)
        log.info('RpaView', '[tencent_video] native click rect: ' + JSON.stringify(_rc))
        if (_rc && _rc.x > 0 && _rc.y > 0) {
          win.webContents.sendInputEvent({ type: 'mouseMove', x: _rc.x, y: _rc.y })
          await sleep(120)
          win.webContents.sendInputEvent({ type: 'mouseDown', x: _rc.x, y: _rc.y, button: 'left', clickCount: 1 })
          await sleep(60)
          win.webContents.sendInputEvent({ type: 'mouseUp', x: _rc.x, y: _rc.y, button: 'left', clickCount: 1 })
          // frame-publish-click：wujie 的 shadowRoot 是同步副本，事件到不了真实上下文。
          // 改为遍历所有子帧，在各帧自己的执行上下文里找「发表」并派发完整指针序列。
          try {
            const _frames = (win.webContents.mainFrame && win.webContents.mainFrame.framesInSubtree) ? win.webContents.mainFrame.framesInSubtree : [win.webContents.mainFrame]
            log.info('RpaView', '[tencent_video] frame-publish: frames=' + _frames.length)
            for (const _f of _frames) {
              try {
                const _r = await Promise.race([
                  _f.executeJavaScript("(function(){var bs=[].slice.call(document.querySelectorAll(\"button\"));var t=null;for(var i=0;i<bs.length;i++){var x=(bs[i].innerText||\"\").replace(/\\\\s+/g,\"\");if(x===\"发表\"){t=bs[i];break}}if(!t)return \"no-btn\";var o={bubbles:true,cancelable:true,composed:true,view:window,button:0,buttons:1};[\"pointerover\",\"pointerenter\",\"pointerdown\",\"mousedown\",\"pointerup\",\"mouseup\",\"click\"].forEach(function(n){try{t.dispatchEvent(new (n.indexOf(\"pointer\")===0?PointerEvent:MouseEvent)(n,o))}catch (e) { void 0 }});return \"sequenced:\"+(t.innerText||\"\").replace(/\\\\s+/g,\"\")})()", true),
                  new Promise(function (res) { setTimeout(function () { res('timeout') }, 5000) })
                ])
                if (_r && String(_r).indexOf('sequenced') === 0) { log.info('RpaView', '[tencent_video] frame-publish: ' + String(_r) + ' @ ' + String(_f.url || '').slice(0, 60)); break }
              } catch (_eF) { void 0 }
            }
          } catch (_eFP) { log.warn('RpaView', '[tencent_video] frame-publish failed: ' + String((_eFP && _eFP.message) || '').slice(0, 80)) }
          // pointer-sequence：坐标点击实测未进入页面（click-probe: []），
          // 改用页内完整指针事件序列（pointerdown→mousedown→pointerup→mouseup→click），
          // 这是 React 合成事件体系唯一可靠的非坐标触发方式。
          try {
            const _seq = await win.webContents.executeJavaScript('(function(){var h=document.querySelector(".wujie_iframe");if(!h||!h.shadowRoot)return "no-shadow";var bs=[].slice.call(h.shadowRoot.querySelectorAll("button"));var t=null;for(var i=0;i<bs.length;i++){var x=(bs[i].innerText||"").replace(/\\s+/g,"");if(x==="发表"){t=bs[i];break}}if(!t)return "no-btn";t.scrollIntoView({block:"center"});t.click();/* plain-click-verified：人工实测 element.click() 才能打开确认面板 */return "sequenced:"+(t.innerText||"").replace(/\\s+/g,"")})()', true)
            log.info('RpaView', '[tencent_video] pointer-sequence: ' + _seq)
          } catch (_eSq) { log.warn('RpaView', '[tencent_video] pointer-sequence failed: ' + String((_eSq && _eSq.message) || '').slice(0, 80)) }
          await sleep(1500)
          // poll-direct（2026-10-24 抓包）：发布面板由平台**自动弹出**（视频处理完成后），
          // 不需要点「发表」。正确做法：轮询等「直接发表」可见（120×40）再点。
          try {
            let _dpv = ''
            for (let _i = 0; _i < 80; _i++) {
              const _p = await win.webContents.executeJavaScript('(function(){var h=document.querySelector(".wujie_iframe");if(!h||!h.shadowRoot)return "no-shadow";var bs=h.shadowRoot.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].innerText||"").replace(/\\s+/g,"")==="直接发表"){var r=bs[i].getBoundingClientRect();return Math.round(r.width)+"x"+Math.round(r.height)}}return "none"})()', true)
              if (_p && _p !== 'none' && !String(_p).startsWith('0x')) { _dpv = _p; break }
              await sleep(3000)
            }
            log.info('RpaView', '[tencent_video] poll-direct visible=' + (_dpv || 'never'))
            if (_dpv) {
              const _c = await win.webContents.executeJavaScript('(function(){var h=document.querySelector(".wujie_iframe");var bs=h.shadowRoot.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].innerText||"").replace(/\\s+/g,"")==="直接发表"){bs[i].click();return "clicked-direct"}}return "nf"})()', true)
              log.info('RpaView', '[tencent_video] poll-direct click=' + _c)
            }
          } catch (_ePd) { log.warn('RpaView', '[tencent_video] poll-direct failed: ' + String((_ePd && _ePd.message) || '').slice(0, 80)) }
          // direct-publish（2026-10-24 实测成功）：真正发稿的是「直接发表」按钮，
          // 「发表」只是打开确认面板。顺序：点发表 → 等 1.2s → 点直接发表。
          try {
            const _dp = await win.webContents.executeJavaScript('(function(){var h=document.querySelector(".wujie_iframe");if(!h||!h.shadowRoot)return "no-shadow";var bs=h.shadowRoot.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].innerText||"").replace(/\\s+/g,"")==="直接发表"){var r=bs[i].getBoundingClientRect();if(r.width>0&&r.height>0){bs[i].click();return "clicked-direct "+Math.round(r.width)+"x"+Math.round(r.height)}}}return "direct-not-visible"})()', true)
            log.info('RpaView', '[tencent_video] direct-publish: ' + _dp)
          } catch (_eDp) { log.warn('RpaView', '[tencent_video] direct-publish failed: ' + String((_eDp && _eDp.message) || '').slice(0, 80)) }

          // click-probe：在页面挂捕获型监听，验证坐标点击是否真的落到文档上
          try {
            await win.webContents.executeJavaScript('window.__mpClickLog=[];if(!window.__mpClickHooked){window.__mpClickHooked=1;document.addEventListener("click",function(e){try{window.__mpClickLog.push(String((e.target&&e.target.tagName)||"")+"|"+String((e.target&&e.target.innerText)||"").slice(0,12))}catch (_) { void 0 }},true)}', true)
          } catch (_eP0) { void 0 }
          log.info('RpaView', '[tencent_video] native click dispatched at ' + _rc.x + ',' + _rc.y)
          await sleep(600)
          try {
            const _cl = await win.webContents.executeJavaScript('JSON.stringify(window.__mpClickLog||[])', true)
            log.info('RpaView', '[tencent_video] click-probe: ' + String(_cl).slice(0, 200))
          } catch (_eP1) { void 0 }
          // cdp-publish-click：sendInputEvent 用窗口坐标，getBoundingClientRect 用视口坐标；
          // BrowserView 有偏移时两者不等价 ⇒ 再用 CDP（视口坐标）点一次。
          try {
            const _dbg = win.webContents.debugger
            const _att = !_dbg.isAttached()
            if (_att) _dbg.attach('1.3')
            await _dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: _rc.x, y: _rc.y })
            await _dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: _rc.x, y: _rc.y, button: 'left', clickCount: 1 })
            await _dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: _rc.x, y: _rc.y, button: 'left', clickCount: 1 })
            log.info('RpaView', '[tencent_video] cdp click dispatched at ' + _rc.x + ',' + _rc.y)
            if (_att) { try { _dbg.detach() } catch (_e0) { void 0 } }
          } catch (_eCd) { log.warn('RpaView', '[tencent_video] cdp click failed: ' + String((_eCd && _eCd.message) || '').slice(0, 80)) }
        }
      } catch (_eNC) { log.warn('RpaView', '[tencent_video] native click failed: ' + String((_eNC && _eNC.message) || '').slice(0, 80)) }
    }
    } catch (_e7) { /* 失败则继续走原点击通道 */ }
}

module.exports = { clickPublishTencent }
