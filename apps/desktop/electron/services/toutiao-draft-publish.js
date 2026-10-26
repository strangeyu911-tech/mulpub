'use strict'

/**
 * 头条视频「草稿箱发布」路线（2026-10-25 实证）
 *
 * 背景（PRD 8.35 / 8.36）：
 * - 视频发布页的「封面」是必填（红星），但它的上传器是自绘组件：
 *   JS click / 真实鼠标 / DataTransfer / CDP 文件选择器拦截 / 浏览器级拖拽 共 7 种方式全部无效。
 * - 点「发布」= 静默 no-op（不发请求、不抛异常、无提示），因为前端在发请求前就卡在封面校验。
 * - 但点「存草稿」实测 `POST /xigua/api/upload/PublishVideo?msToken&a_bogus` → 200，
 *   且草稿箱地址 https://mp.toutiao.com/profile_v4/manage/draft 可直接打开（innerText len=438）。
 * - ⇒ 绕开封面校验的可行路线：先存草稿，再从草稿箱把这条草稿发出去。
 *
 * 本模块只做 UI 操作，不碰任何签名。
 */

const DRAFT_BOX_URL = 'https://mp.toutiao.com/profile_v4/manage/draft'

function sleep (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

/**
 * 在已打开的头条视频发布页里点「存草稿」。
 * @param {object} win BrowserWindow
 * @param {object} log logger
 * @returns {Promise<string>} CLICKED / NOT_FOUND / NO_WIN
 */
async function saveDraft (win, log) {
  if (!win || win.isDestroyed()) return 'NO_WIN'
  const code = '(function(){var bs=[].slice.call(document.querySelectorAll("button"));' +
    'for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||"").replace(/\\s+/g,"");' +
    'var r=bs[i].getBoundingClientRect();if(t==="存草稿"&&r.width>0){bs[i].click();return "CLICKED"}}' +
    'return "NOT_FOUND"})()'
  try {
    const r = await win.webContents.executeJavaScript(code)
    if (log) log.info('RpaView', '[toutiao-draft] saveDraft=' + r)
    return String(r)
  } catch (e) {
    if (log) log.warn('RpaView', '[toutiao-draft] saveDraft threw ' + String((e && e.message) || '').slice(0, 60))
    return 'THREW'
  }
}

/**
 * 打开草稿箱并把第一条草稿发出去。
 * 每一步都写日志，失败时不抛异常（返回结构化结果供上层判定）。
 * @param {object} win BrowserWindow
 * @param {object} log logger
 * @param {{waitMs?:number}} [opts]
 * @returns {Promise<{ok:boolean, step:string, detail?:string}>}
 */
async function publishFirstDraft (win, log, opts) {
  const o = opts || {}
  if (!win || win.isDestroyed()) return { ok: false, step: 'no-win' }
  try {
    // 2026-10-25 实测：隐藏窗口里草稿箱/作品列表只渲染侧边栏，正文不渲染（疑似后台节流）。
    // 先把窗口显示并聚焦，再导航，正文才会渲染出来。
    try {
      if (win.isMinimized && win.isMinimized()) win.restore()
      if (win.show) win.show()
      if (win.focus) win.focus()
      if (win.webContents && win.webContents.focus) win.webContents.focus()
    } catch (_eShow) { void 0 }
    await win.loadURL(DRAFT_BOX_URL)
    await sleep(Number(o.waitMs) || 9000)

    const probe = await win.webContents.executeJavaScript(
      '(function(){var t=(document.body.innerText||"").replace(/\\s+/g," ");' +
      'var btns=[];document.querySelectorAll("button,a,span").forEach(function(b){' +
      'var x=(b.innerText||"").replace(/\\s+/g,"");var r=b.getBoundingClientRect();' +
      'if(r.width>0&&x&&x.length<8&&/发布|继续编辑|编辑/.test(x))btns.push(x)});' +
      'return JSON.stringify({len:t.length,head:t.slice(0,200),btns:Array.from(new Set(btns)).slice(0,8)})})()'
    )
    if (log) log.info('RpaView', '[toutiao-draft] draftbox ' + String(probe).slice(0, 260))
    let info = {}
    try { info = JSON.parse(String(probe)) } catch (_e) { void 0 }

    if (!info.len) return { ok: false, step: 'empty-draftbox' }

    // 2026-10-25 实测：点「编辑」会在**新窗口**打开草稿编辑器，原窗口停在列表页。
    // 这里挂 browser-window-created 捕获新窗口，后续在它上面点「发布」。
    let editorWin = null
    try {
      const { app } = require('electron')
      const onCreated = (_e, w) => { editorWin = w }
      app.on('browser-window-created', onCreated)
      setTimeout(() => { try { app.removeListener('browser-window-created', onCreated) } catch (_e2) { void 0 } }, 30000)
    } catch (_eApp) { void 0 }
    // 找第一条草稿的「继续编辑」（草稿箱里最稳的入口）
    const click = await win.webContents.executeJavaScript(
      '(function(){var els=[].slice.call(document.querySelectorAll("button,a,span"));' +
      'for(var i=0;i<els.length;i++){var x=(els[i].innerText||"").replace(/\\s+/g,"");' +
      'var r=els[i].getBoundingClientRect();' +
      'if(r.width>0&&(x==="继续编辑"||x==="编辑")){els[i].click();return "EDITING"}}return "NO_EDIT_BTN"})()'
    )
    if (log) log.info('RpaView', '[toutiao-draft] open-first=' + click)
    if (click !== 'EDITING') return { ok: false, step: 'no-edit-button', detail: String(probe).slice(0, 200) }

    // 等新窗口出现并加载
    for (let i = 0; i < 20 && !editorWin; i++) await sleep(500)
    const target = (editorWin && !editorWin.isDestroyed()) ? editorWin : win
    if (log) log.info('RpaView', '[toutiao-draft] editor-window=' + (target === win ? 'same' : 'new'))
    await sleep(12000)
    // 草稿编辑页再点「发布」
    // 诊断：记录草稿编辑页上所有可见按钮/可点元素的文本，便于定位真正的发布入口
    const editorPageProbe = await target.webContents.executeJavaScript(
      '(function(){var out=[];document.querySelectorAll("button,a,span,div").forEach(function(b){' +
      'var t=(b.innerText||"").replace(/\\s+/g,"");var r=b.getBoundingClientRect();' +
      'if(r.width>0&&r.height>0&&t&&t.length<10&&out.indexOf(t)<0)out.push(t)});' +
      'return JSON.stringify(out.slice(0,25))})()'
    )
    if (log) log.info('RpaView', '[toutiao-draft] editor-buttons ' + String(editorPageProbe).slice(0, 300))
    const pub = await target.webContents.executeJavaScript(
      '(function(){var bs=[].slice.call(document.querySelectorAll("button"));var cand=[];' +
      'for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||"").replace(/\\s+/g,"");' +
      'var r=bs[i].getBoundingClientRect();if(r.width>0&&t==="发布"&&r.top>window.innerHeight*0.8){cand.push({el:bs[i],t:t,y:r.top+r.height/2})}}' +
      'if(!cand.length)return "NO_PUBLISH_BTN";' +
      'cand.sort(function(a,b){return b.y-a.y});cand[0].el.click();' +
      'return "PUBLISH_CLICKED:"+cand[0].t+"@"+Math.round(cand[0].y)})()'
    )
    if (log) log.info('RpaView', '[toutiao-draft] publish-on-draft=' + pub)
    return { ok: String(pub).indexOf('PUBLISH_CLICKED') === 0, step: String(pub) }
  } catch (e) {
    if (log) log.warn('RpaView', '[toutiao-draft] failed ' + String((e && e.message) || '').slice(0, 80))
    return { ok: false, step: 'threw', detail: String((e && e.message) || '').slice(0, 120) }
  }
}

module.exports = { saveDraft, publishFirstDraft, DRAFT_BOX_URL }
