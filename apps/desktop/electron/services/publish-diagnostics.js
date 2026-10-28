// @ts-check
/**
 * publish-diagnostics — 发布链「页面结构留证 / 产物证据」两类只读诊断
 *
 * ## 为什么单独成文件（不是随手抽函数）
 *
 * `rpa-view-platforms.js` 已被 `.github/scripts/max-lines-baseline.json` 的 `targets`
 * 点名还账（零增长容差）。同一文件在 2026-10-26 已因同一原因把视频号「发表」点击链
 * 下沉到 `tencent-publish-hooks.js`——本模块沿用同一条口径：新增诊断能力放兄弟模块，
 * 主链只留一行调用。
 *
 * ## 安全边界（改这个文件前必须先读）
 *
 * - **只读**：不点、不填、不提交；两个入口都**永不抛错**（诊断不能反过来打断发布）。
 * - `dumpPublishDom` 会把页面正文前 160 字打进日志，仅用于「选择器全落空」这一刻的
 *   现场定性，调用点必须限定在发布链已经要失败/已经落空的分支里。
 * - 与 `rpa-dom-dump.js` 的分工：那个是**默认关闭**的落盘取证通道（MP_DOM_DUMP=1，
 *   不采内容）；本模块是**始终生效**的日志摘要，用于「失败也说不清页面长什么样」的场景。
 */

const log = require('./logger')

/**
 * 把页面**真实结构**摘要打进日志（正文/按钮/文件输入 + 正文前 160 字）。
 *
 * 为什么必须有：平台改版时旧选择器会静默全落空，日志只剩「not found」，无从知道该改成什么。
 * 2026-10-20 微博即为此：URL 已正确导航到 weibo.com、页面有 238 个可交互元素，
 * 但 .publisher_text/.W_input/textarea[node-type] 三条正文候选与三个发布按钮候选全部超时——
 * 没有这份 dump 就只能继续猜。
 *
 * @param {object} win BrowserWindow / WebContentsView 外壳
 * @param {string} platform 平台 id
 * @returns {Promise<void>} 失败静默（只记 warn）
 */
async function dumpPublishDom (win, platform) {
  try {
    const info = await win.webContents.executeJavaScript(`(function(){
      var vis=function(e){try{var r=e.getBoundingClientRect();return r.width>4&&r.height>4}catch(_){return false}};
      var pick=function(e){return {t:e.tagName,c:String(e.className||'').slice(0,36),id:String(e.id||'').slice(0,20),ph:String(e.getAttribute('placeholder')||e.getAttribute('data-placeholder')||'').slice(0,20),v:vis(e)}};
      var areas=[].slice.call(document.querySelectorAll('textarea,[contenteditable="true"]')).slice(0,10).map(pick);
      var btns=[].slice.call(document.querySelectorAll('button,a,[role="button"],div,span')).filter(function(e){
        var t=(e.innerText||'').trim(); return t && t.length<=8 && vis(e) && /发布|发送|发微博|写微博|发帖|投稿|写文章/.test(t);
      }).slice(0,12).map(function(e){var o=pick(e);o.tx=(e.innerText||'').trim().slice(0,10);return o});
      var inputs=[].slice.call(document.querySelectorAll('input[type="file"]')).slice(0,5).map(pick);
      return JSON.stringify({url:location.href,areas:areas,btns:btns,inputs:inputs,body:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,160)});
    })()`)
    log.warn('RpaView', '[' + platform + '] DIAG dom-dump ' + String(info).slice(0, 1600))
  } catch (e) {
    log.warn('RpaView', '[' + platform + '] DIAG dom-dump failed: ' + e.message)
  }
}

/**
 * 微博发布产物证据（只读，不点不填）。
 *
 * 判据：时间线里某个「刚刚」标记之后的 400 字符内，出现本次标题前 10 字或正文前 12 字。
 * 用「刚刚」是因为它只出现在刚发布的条目上；同时必须命中本次内容，避免把别人的「刚刚」
 * 当成自己的。等待 15s（真机实测插入耗时约 3–8s）。
 *
 * @param {object} host RpaViewManager 实例（只借用 `_waitForCondition`）
 * @param {object} win 窗口外壳
 * @param {{title?: string, content?: string}} articleOrContext 文章或其上下文（只需 title/content）
 * @returns {Promise<boolean>} 命中为 true；任何异常按 false（不得把诊断失败读成成功）
 */
async function weiboPublishEvidence (host, win, articleOrContext) {
  try {
    const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    const title = strip(articleOrContext && articleOrContext.title)
    const content = strip(articleOrContext && articleOrContext.content)
    const probes = []
    if (title.length >= 6) probes.push(title.slice(0, 10))
    if (content.length >= 12) probes.push(content.slice(0, 12))
    if (probes.length === 0) return false
    const ok = await host._waitForCondition(win, 'function(){' +
      'var t=(document.body&&document.body.innerText)||"";' +
      'var probes=' + JSON.stringify(probes) + ';' +
      'var i=t.indexOf("刚刚");' +
      'while(i!==-1){' +
      '  var seg=t.slice(i,i+400);' +
      '  for(var k=0;k<probes.length;k++){if(probes[k]&&seg.indexOf(probes[k])!==-1)return true}' +
      '  i=t.indexOf("刚刚",i+1);' +
      '}' +
      'return false;', 15000, 800)
    if (ok) log.info('RpaView', '[weibo] publish evidence found in timeline (刚刚 + 本次内容)')
    return Boolean(ok)
  } catch (e) {
    log.warn('RpaView', '[weibo] publish evidence probe failed: ' + e.message)
    return false
  }
}

/**
 * 保存草稿失败时按失败形态决定是否留证。
 *
 * 只有「点击了但请求没发出」(`save-request-not-sent`) 与「按钮不可用」
 * (`save-button-unavailable`) 两种 detail 才是**页面结构变了**的证据；
 * 其它失败（超时、弹层拦截）已有的日志足够定位，不再额外 dump。
 *
 * @param {object} win 窗口外壳
 * @param {{detail?: string}} saved saveWechatMpDraft 的失败返回
 * @returns {Promise<void>}
 */
async function dumpOnSaveFailure (win, saved) {
  const detail = saved && saved.detail
  if (detail === 'save-request-not-sent' || detail === 'save-button-unavailable') {
    await dumpPublishDom(win, 'wechat_mp')
  }
}

module.exports = { dumpPublishDom, weiboPublishEvidence, dumpOnSaveFailure }
