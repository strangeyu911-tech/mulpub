// @ts-check
'use strict'
/**
 * rpa-overseas/tiktok.js — TikTok 发布（fail-closed）
 *
 * ## 目标
 *
 * TikTok 走 **RPA**（不是官方 API）：未审核的 Content Posting API 客户端只能发 `SELF_ONLY`，
 * 且限 5 个创作者/24h、账号须私有 ⇒ RPA 是唯一能发公开视频的路径。
 *
 * ## 关键实现细节（都来自真机踩过的坑或开源实现的既定流程，不是防御性编程）
 *
 * ① **入口是 TikTok Studio，不是 `tiktok.com/upload`**
 *    （后者会跳到普通账号的上传页；Studio 才有发布按钮与作品列表）。
 *
 * ② **上传区有两种形态**：整个上传界面可能在一个 iframe 里，也可能直接渲染在主文档。
 *    参考实现用 `choose_base_locator` 二选一 ⇒ 本实现用同一套抽象（`scope`）覆盖两种形态，
 *    **改版即换形态时不必重写整条链**。
 *
 * ③ **描述框是 Draft.js（`div.public-DraftEditor-content`），不是 textarea**
 *    ⇒ 仓内已实测的同型结论（`rpa-view-helpers.js` 的 `_insertTextTrusted` 注释，2026-09-29 知乎写页）：
 *    **Draft.js/ProseMirror 类编辑器不接受 innerHTML 直写**（框架状态为空、发布空文），
 *    唯一可信注入通道是 **CDP `Input.insertText`**。
 *    ⇒ 本实现以 CDP 通道为主、innerHTML 为降级，且**每条通道都要回读校验**。
 *
 * ④ **登录态用「页面结构特征」判，不用 URL 判**
 *    过期 cookie 会在页面上留下 `class` 匹配 `tiktok-.*-SelectFormContainer.*` 的 `select`。
 *    ⚠️ CSS 选择器无法直接表达那条正则 ⇒ 候选只按 class 子串粗筛，
 *       **真正的判定在 JS 里用完整正则复核**（避免把无关 select 误判成过期）。
 *
 * ⑤ **「上传完成」的判据是「Post 按钮不再 disabled」**
 *    ——不是「文件注入没报错」。
 *    ⚠️ `_setFileInput` 的注入结果回读用的是**主文档** `querySelector`，
 *       文件输入若在 iframe 内则永远读不到（返回 -1，被当成「input 已消失 = 已接受」）
 *       ⇒ **注入结果不可作为判据**，只有页面侧状态可判。
 *
 * ⑥ **发布成功的判据是「URL 到了作品列表页」+「回读到作品 ID」**
 *    ——不是「点了发布按钮」。helper 的 `_click` 恒返回 true、不抛错 ⇒ 点击成败不可依赖返回值。
 *    作品 ID 从作品列表的 `href` 里解析 `video/(\d+)` ⇒ 是**平台侧可回读的事实**。
 *
 * ## 诚实边界
 *
 * - 本文件的全部选择器标注为 `[参考]`（来自开源实现）**未在本仓真机验证**；
 * - 因此本阶段**只证明「失败路径会正确失败」**，不证明「成功路径能真正发出去」；
 * - 隐私级别（Everyone / Only you）与定时发布**未实现**（参考实现的定时发布依赖
 *   `publish_date` 与一套日历选择器，本轮不猜）⇒ 视频按 Studio 默认隐私发布。
 */

const { getOverseasSelectors } = require('./selectors')
const {
  formatArticleBody,
  formatTags,
  truncateContent,
} = require('@multi-publish/api-publish-engine/src/content-formatter')
// ⚠️ `parseTikTokVideoId` 住在核验层（shared）而非本文件 ——
//    本文件 require shared（verifyPublished），若解析器放这里则 shared 再 require 本文件
//    ⇒ 循环依赖 ⇒ Node 部分初始化 ⇒ verifyPublished 会是 undefined。
const { verifyPublished, parseTikTokVideoId } = require('./shared')

/** TikTok Studio 上传页（`lang=en` 固定英文界面 ⇒ 文案判据才稳定） */
const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?lang=en'
/** 作品列表页（发布成功后浏览器会落到这里） */
const TIKTOK_CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content'

/**
 * 页面侧函数字面量（会被拼进页面执行 ⇒ 必须是合法 JS 表达式）。
 * ⚠️ 这些常量里**不得出现会被提前闭合字符串的引号**（页面脚本一律用双引号包字符串）。
 */

/** 登录过期：存在 class 匹配 `tiktok-.*-SelectFormContainer.*` 的 select */
const TIKTOK_LOGIN_EXPIRED_FN = 'function(){var ss=document.querySelectorAll("select");' +
  'for(var i=0;i<ss.length;i++){var c=String(ss[i].className||"");' +
  'if(/tiktok-.*-SelectFormContainer.*/.test(c))return true}return false}'

/** 上传完成：文本含 Post 的按钮不再带 disabled 属性 */
const TIKTOK_UPLOAD_DONE_FN = 'function(){var bs=document.querySelectorAll("div.button-group > button");' +
  'for(var i=0;i<bs.length;i++){var b=bs[i];var t=String(b.innerText||b.textContent||"");' +
  'if(!/Post|发布/i.test(t))continue;' +
  'if(b.getAttribute("disabled")===null)return true}return false}'

/** 上传出错：出现「Select file」按钮 ⇒ 需要重传（⇒ 本实现直接判失败） */
const TIKTOK_UPLOAD_ERROR_FN = 'function(){var bs=document.querySelectorAll("button");' +
  'for(var i=0;i<bs.length;i++){var a=String(bs[i].getAttribute("aria-label")||"");' +
  'if(a.indexOf("Select file")>=0)return true}return false}'

/**
 * 安全读当前 URL（窗口可能已销毁）。
 * @param {any} win
 * @returns {string}
 */
function safeUrl (win) {
  try { return String(win.webContents.getURL() || '') } catch (e) { return '' }
}

/**
 * 在「上传区作用域」内执行一段页面脚本。
 * ⚠️ `scope.frame` 非空 ⇒ 走 `_execInFrame`（iframe 内的文档）；
 *   否则走主文档。两种形态的 jsBody 形状**必须一致**（都是函数体 + return）。
 * @param {any} win
 * @param {{frame: string}} scope
 * @param {string} jsBody
 * @returns {Promise<any>}
 */
async function scopeExec (win, scope, jsBody) {
  if (scope.frame) return await this._execInFrame(win, scope.frame, jsBody)
  return await win.webContents.executeJavaScript('(function(){' + jsBody + '})()')
}

/**
 * 判定上传区形态：iframe 优先，其次主文档。
 * @param {any} win
 * @param {any} sel
 * @returns {Promise<{frame: string, kind: string}>}
 */
async function detectScope (win, sel) {
  for (const f of (sel.upload_frame || [])) {
    try {
      const has = await win.webContents.executeJavaScript(
        '(function(){return !!document.querySelector(' + JSON.stringify(f) + ')})()'
      )
      if (has === true) return { frame: f, kind: 'iframe' }
    } catch (e) { /* 换下一个候选 */ }
  }
  return { frame: '', kind: 'main' }
}

/**
 * 在作用域内读某个元素的文本（用于「写入是否真的进去了」的回读判据）。
 * @param {any} win
 * @param {{frame: string}} scope
 * @param {string} selector
 * @returns {Promise<string>}
 */
async function readScopeText (win, scope, selector) {
  const js = 'var e=document.querySelector(' + JSON.stringify(selector) + ');' +
    'if(!e)return "";var t=String(e.innerText||e.textContent||"");return t.trim()'
  const v = await scopeExec.call(this, win, scope, js)
  return typeof v === 'string' ? v : ''
}

/**
 * 写入描述（CDP 可信通道 + 回读校验）。
 *
 * 通道：CDP `Input.insertText`（`_insertTextTrusted`）—— Draft.js 的唯一可信通道。
 *       （innerHTML 直写对 Draft.js 无效，仓内 `rpa-view-helpers.js` 的 `_insertTextTrusted`
 *        注释里有 2026-09-29 知乎写页的同型实测：框架状态为空、发布空文。）
 *
 * 判据：**回读文本必须包含我们写入的文本**。
 * ⚠️ 刻意**不**用「回读长度 > 0」—— 那会把「编辑器里的残留内容」当成写入成功
 *    （fail-open 方向：发的描述与我们写的不是一回事，却报成功）。
 * ⚠️ 也不做「写入前先看有没有内容、有就跳过」的幂等检查 —— 同理会跳过写入 ⇒ 发出残留内容。
 * @param {any} host
 * @param {any} win
 * @param {{frame: string}} scope
 * @param {any} sel
 * @param {string} text
 * @returns {Promise<{ok: boolean, strategy?: string, readBack?: string, detail?: string}>}
 */
async function fillCaption (host, win, scope, sel, text) {
  const value = String(text || '').trim()
  if (!value) return { ok: true, skipped: true, detail: 'empty' }

  const editors = Array.isArray(sel.caption_editor) ? sel.caption_editor : []
  // 包含判据用「写入文本的头一段」⇒ 不受编辑器把换行折叠成空格的差异影响
  const needle = value.split('\n').map((s) => s.trim()).filter(Boolean)[0] || value

  for (const editor of editors) {
    // 先确认该候选**存在**（存在才值得聚焦与插入）
    // ⚠️ 顺序很重要：先探存在、再聚焦、再插入 ⇒ 「这个候选不存在」不会留下任何写入。
    let exists = false
    try {
      exists = (await scopeExec.call(host, win, scope,
        'return !!document.querySelector(' + JSON.stringify(editor) + ')')) === true
    } catch (e) { /* 探测失败 ⇒ 保持 false（视为该候选不存在） */ }
    if (!exists) continue

    // 聚焦（CDP Input.insertText 作用于当前焦点元素）
    try {
      await scopeExec.call(host, win, scope,
        'var e=document.querySelector(' + JSON.stringify(editor) + ');' +
        'if(!e)return false;try{e.focus()}catch(_){}return true')
    } catch (e) { /* 聚焦失败不阻断：交给回读判据 */ }

    let inserted = false
    if (typeof host._insertTextTrusted === 'function') {
      try { inserted = (await host._insertTextTrusted(win, value)) === true } catch (e) { inserted = false }
    }
    if (!inserted) continue

    await host._sleep(800)
    const readBack = await readScopeText.call(host, win, scope, editor)
    if (readBack && readBack.indexOf(needle) >= 0) {
      return { ok: true, strategy: 'cdp-insertText', readBack: readBack.slice(0, 200) }
    }
    // ⚠️ **已经插入过** ⇒ 不得再试下一个候选：
    //    换候选再插一次 ⇒ 编辑器里留下两份文本 ⇒ 发的描述是重复的（且回读仍不匹配）。
    //    ⇒ 宁可失败，也不产出重复内容。
    return { ok: false, detail: 'caption-readback-mismatch' }
  }
  return { ok: false, detail: 'caption-editor-not-found' }
}

/**
 * 轮询回读作品 ID（发布后的正证据）。
 * @param {any} win
 * @param {any} sel
 * @param {number} timeoutMs
 * @returns {Promise<{videoId: string, href: string}|null>}
 */
async function waitForVideoId (win, sel, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 60000)
  const links = Array.isArray(sel.published_video_link) ? sel.published_video_link : []
  while (Date.now() < deadline) {
    for (const sel1 of links) {
      try {
        const href = await win.webContents.executeJavaScript(
          '(function(){var e=document.querySelector(' + JSON.stringify(sel1) + ');' +
          'return e?(e.getAttribute("href")||""):""})()'
        )
        const videoId = parseTikTokVideoId(href)
        if (videoId) return { videoId, href: String(href) }
      } catch (e) { /* 下一候选 */ }
    }
    await this._sleep(3000)
  }
  return null
}

/**
 * TikTok 发布（fail-closed）
 * @param {any} win
 * @param {any} article
 * @param {{publishVerifyTimeoutMs?: number, uploadWaitTimeoutMs?: number, selectors?: object}} [opts]
 *        超时可注入：默认值供真机使用；测试用小值（测试键里不能含不稳定量）。
 *        `selectors` 是**显式注入点**：只允许代码/测试注入，绝不从请求体取值。
 * @returns {Promise<{success: boolean, platform: string, error?: string, url?: string, videoId?: string, verified?: boolean, evidence?: object, warnings?: string[]}>}
 */
async function publishTiktok (win, article, opts) {
  const options = opts || {}
  const publishVerifyTimeoutMs = Number.isFinite(options.publishVerifyTimeoutMs)
    ? options.publishVerifyTimeoutMs
    : 60000
  const uploadWaitTimeoutMs = Number.isFinite(options.uploadWaitTimeoutMs)
    ? options.uploadWaitTimeoutMs
    : 1800000
  const sel = (options.selectors && typeof options.selectors === 'object')
    ? options.selectors
    : getOverseasSelectors('tiktok')
  const warnings = []
  const fail = (reason) => ({
    success: false,
    platform: 'tiktok',
    error: 'tiktok ' + reason,
    verified: false,
    warnings: warnings.length ? warnings : undefined,
  })

  // ---------- 1. 导航到 TikTok Studio ----------
  this._emitProgress('tiktok', 'navigating to tiktok studio...', 5)
  let uploadUrl = TIKTOK_UPLOAD_URL
  try {
    const cfg = this._getPlatformConfig('tiktok', article)
    if (cfg && cfg.publish_url) uploadUrl = cfg.publish_url
  } catch (e) {
    warnings.push('platform config unreadable, using built-in upload url')
  }
  await this._navigateAndWait(win, uploadUrl, 3000)

  // ---------- 2. 登录态（页面结构特征，不看 URL） ----------
  let loginExpired = false
  try {
    loginExpired = (await win.webContents.executeJavaScript('(function(){return (' + TIKTOK_LOGIN_EXPIRED_FN + ')()})()')) === true
  } catch (e) {
    warnings.push('login-state probe failed: ' + (e && e.message ? e.message : String(e)))
  }
  if (loginExpired) {
    return fail('not logged in (页面出现 SelectFormContainer ⇒ cookie 过期)')
  }

  // ---------- 3. 必须有视频文件 ----------
  if (!article || !article.video_path) {
    return fail('needs video file')
  }

  // ---------- 4. 等上传区出现并判定形态 ----------
  this._emitProgress('tiktok', 'waiting for upload area...', 15)
  const areaSel = (sel.upload_frame || []).concat(sel.upload_container || []).join(', ')
  if (!await this._waitForElement(win, areaSel, 30000)) {
    return fail('upload area not found (既没有 iframe 形态也没有 div 形态)')
  }
  const scope = await detectScope.call(this, win, sel)
  warnings.push('upload area scope = ' + scope.kind)

  // ---------- 5. 注入视频文件 ----------
  // ⚠️ **不点「Select video」按钮**：那是 `<input type=file>` 的原生触发点，
  //    在 Electron BrowserWindow 里会弹出**系统文件对话框并阻塞**渲染进程。
  //    ⇒ 改为直接用 CDP `DOM.setFileInputFiles` 注入（`_setFileInput` 内部
  //      `DOM.getDocument{pierce:true}` **能穿透 iframe** 找到 iframe 内的 input）。
  //    找不到 input ⇒ 明确失败（不猜、不点按钮）。
  this._emitProgress('tiktok', 'uploading video...', 25)
  const fileSel = (sel.file_input || []).join(', ')
  try {
    const injected = await this._setFileInput(win, article.video_path, fileSel)
    if (injected === false) return fail('file input injection rejected')
  } catch (e) {
    return fail('file upload failed: ' + (e && e.message ? e.message : String(e)))
  }

  // ---------- 6. 等上传真正完成（Post 按钮不再 disabled） ----------
  // ⚠️ 判据**只认页面侧状态**：`_setFileInput` 的注入结果回读走主文档 querySelector，
  //    文件输入在 iframe 内时读不到（返回 -1 ⇒ 被当成「已接受」）⇒ 不可作为判据。
  this._emitProgress('tiktok', 'waiting for upload completion...', 45)
  const uploadDone = await this._waitForCondition(win, TIKTOK_UPLOAD_DONE_FN, uploadWaitTimeoutMs, 3000)
  if (!uploadDone) {
    // 区分「上传出错」与「上传未完成」——错误文案不同，排障方向不同
    let uploadError = false
    try {
      uploadError = (await win.webContents.executeJavaScript('(function(){return (' + TIKTOK_UPLOAD_ERROR_FN + ')()})()')) === true
    } catch (e) { /* 探测失败按未完成处理 */ }
    return fail(uploadError
      ? 'upload failed (页面出现 Select file ⇒ 上传被中断)'
      : 'upload did not complete (Post 按钮仍不可点，不放行)')
  }

  // ---------- 7. 描述 + 话题（TikTok 是无标题平台 ⇒ 标题合并进描述） ----------
  this._emitProgress('tiktok', 'filling caption...', 60)
  const caption = buildCaption(article)
  if (caption) {
    const fill = await fillCaption(this, win, scope, sel, caption)
    if (!fill.ok) {
      return fail('caption not written (回读长度为 0 ⇒ 已中止发布)')
    }
  }

  // ---------- 8. 点发布 ----------
  this._emitProgress('tiktok', 'publishing...', 85)
  const postSel = (sel.post_btn || []).join(', ')
  if (!postSel) return fail('post button selector missing')
  try {
    await this._click(win, postSel)
  } catch (e) {
    return fail('publish button click failed: ' + (e && e.message ? e.message : String(e)))
  }

  // ---------- 9. 发布成功的判据 = 落到作品列表页 ----------
  // ⚠️ `_click` 恒返回 true、不抛错 ⇒ 点击成败不可依赖返回值。
  //    页面跳转（URL 变化）是平台侧可回读的事实。
  this._emitProgress('tiktok', 'waiting for content page...', 92)
  const landed = await waitForContentPage.call(this, win, publishVerifyTimeoutMs)
  if (!landed) {
    return fail('published but content page not reached (无法证明内容已发出)')
  }

  // ---------- 10. 回读作品 ID（正证据；取不到不判失败，内容可能已发出） ----------
  const evidence = await waitForVideoId.call(this, win, sel, publishVerifyTimeoutMs)
  if (!evidence) {
    warnings.push('content page reached but video id not readable (内容可能已发出，ID 未回读到)')
  }
  const verify = await verifyPublished(win, 'tiktok', { accountId: article.accountId })

  return {
    success: true,
    platform: 'tiktok',
    verified: !!verify.verified,
    url: evidence ? evidence.href : landed,
    videoId: evidence ? evidence.videoId : undefined,
    evidence: { videoId: evidence ? evidence.videoId : '', href: evidence ? evidence.href : '', verify },
    warnings: warnings.length ? warnings : undefined,
  }
}

/**
 * 组装描述文本：TikTok 是无标题平台（标题合并进描述）。
 * @param {any} article
 * @returns {string}
 */
function buildCaption (article) {
  const a = article || {}
  const title = String(a.title || '').trim()
  const body = formatArticleBody('tiktok', String(a.content || '')).trim()
  const tags = formatTags('tiktok', Array.isArray(a.tags) ? a.tags : [])
  const parts = []
  if (title) parts.push(title)
  if (body) parts.push(body)
  if (tags.length) parts.push(tags.join(' '))
  const joined = parts.filter(Boolean).join('\n')
  return truncateContent('tiktok', joined)
}

/**
 * 轮询等待落到作品列表页（URL 判据）。
 * @param {any} win
 * @param {number} timeoutMs
 * @returns {Promise<string>} 返回到达时的 URL；超时返回空串
 */
async function waitForContentPage (win, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 60000)
  while (Date.now() < deadline) {
    const url = safeUrl(win)
    if (url && url.indexOf('/tiktokstudio/content') >= 0) return url
    await this._sleep(2000)
  }
  return ''
}

module.exports = {
  publishTiktok,
  fillCaption,
  buildCaption,
  parseTikTokVideoId,
  waitForVideoId,
  waitForContentPage,
  scopeExec,
  detectScope,
  TIKTOK_UPLOAD_URL,
  TIKTOK_CONTENT_URL,
  TIKTOK_LOGIN_EXPIRED_FN,
  TIKTOK_UPLOAD_DONE_FN,
  TIKTOK_UPLOAD_ERROR_FN,
}
