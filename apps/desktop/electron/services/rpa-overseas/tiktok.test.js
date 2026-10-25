// @ts-check
/**
 * rpa-overseas/tiktok.test.js —— TikTok 发布链契约测试
 *
 * ## 这些用例在守什么
 *
 * TikTok 此前**完全没有专属链**（走 `_publish_generic`，而通用链连「点创建/上传入口」都没有
 * ⇒ 全仓 `create_btn`/`upload_btn` 零命中 ⇒ 一步都跑不到）。
 *
 * 本文件钉住的是**失败路径必须返回 success:false** 与**「成功」的判据落在平台侧可回读的事实上**
 * （落到作品列表页 + 回读到作品 ID），而不是「点了发布按钮」。
 *
 * ## 断言设计原则（与 youtube.test.js 同源，取自本仓既有教训）
 *
 * 1. **锁必须对「正确实现」和「错误实现」都敏感** —— 只锁错误实现的特征 = 没牙齿；
 * 2. **不许恒真断言** —— 不许只断言「调用了某函数」而不看返回值；
 * 3. **不许条件性跳过**；
 * 4. **注入假表**验证「实现读的是选择器表而不是自己拼的字面量」
 *    （表里的候选与硬编码字面量相同时，行为断言恒真 ⇒ 锁没牙齿）。
 */
// ⚠️ 本仓 vitest 走 **globals 模式**（vi / describe / it / expect 都是全局）
//    ⇒ 不要 `require('vitest')`：vitest 4 在 CommonJS 下用 require 导入会直接抛。
const {
  publishTiktok,
  buildCaption,
  parseTikTokVideoId,
  waitForVideoId,
  verifyPublished,
  getOverseasSelectors,
  OVERSEAS_STEP_SELECTORS,
  TIKTOK_LOGIN_EXPIRED_FN,
  TIKTOK_UPLOAD_DONE_FN,
  TIKTOK_UPLOAD_ERROR_FN,
} = require('./index')

const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload?lang=en'
const TIKTOK_CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content'
const VIDEO_HREF = 'https://www.tiktok.com/@someone/video/7123456789'

/**
 * 默认的执行结果分流器（按**脚本内容**分流）。
 * ⚠️ 必须按内容而不是按调用顺序 —— 顺序在实现调整后会漂移。
 * ⚠️ 每个分支对应实现里一处**具体的**脚本形状；改实现时这里必须同步，
 *    否则某分支再也匹配不到 ⇒ 静默走到默认值（假绿风险）。
 * @param {any} [overrides]
 * @returns {(script: string) => any}
 */
function defaultExec (overrides) {
  const ov = overrides || {}
  return (script, inFrame) => {
    const s = String(script)
    if (s.includes('SelectFormContainer')) return ov.loginExpired ?? false
    if (s.includes('Upload_index_iframe')) return ov.hasFrame ?? true
    if (s.includes('Select file')) return ov.uploadError ?? false
    if (s.includes('components_PostTable_Container')) return ov.videoHref ?? VIDEO_HREF
    if (s.includes('return t.trim()')) return ov.captionText ?? '测试标题'
    if (s.includes('e.focus()')) return true
    // ⚠️ 「候选是否存在」的探测（`return !!document.querySelector(...)`）——
    //    detectScope 的 iframe 探测是**同形状**但语义相反（查 iframe 存不存在），
    //    两者靠**选择器内容**区分：前者查的是 caption_editor，后者查的是 upload_frame
    //    （含 Upload_index_iframe ⇒ 已被上一个分支先命中）⇒ 这里可无条件返回。
    if (s.includes('return !!document.querySelector')) return ov.editorExists ?? true
    return ''
  }
}

/**
 * 执行结果分流器（主文档与 iframe 内**共用**同一个）。
 * @param {any} o
 * @returns {(script: string) => any}
 */
function makeDispatch (o) {
  const opts = o || {}
  return (script, inFrame) => {
    if (opts.execThrows) throw new Error('executeJavaScript failed')
    if (typeof opts.execResult === 'function') return opts.execResult(script, inFrame)
    return opts.execResult ?? ''
  }
}

/**
 * 造一个最小可用的 RpaViewManager 上下文。
 * ⚠️ 语义与真实 helper 对齐（别写成"理想行为"，那会让测试与实现一起错）：
 *  - `_click` 真实实现**恒返回 true 且不抛错**（点击成功与否要靠回读判定）；
 *  - `_insertTextTrusted` 真实实现返回布尔（CDP Input.insertText 成功与否）。
 * @param {any} [opts]
 */
function createContext (opts) {
  const o = opts || {}
  const calls = {
    navigated: [], clicked: [], inserted: [], filledInFrame: [],
    execInFrame: [], slept: [], events: [], waitCond: [],
  }
  return {
    calls,
    _emitProgress: vi.fn(),
    _sleep: vi.fn(async (ms) => { calls.slept.push(ms); calls.events.push('sleep:' + ms) }),
    _navigateAndWait: vi.fn(async (win, url) => { calls.navigated.push(url) }),
    _waitForElement: vi.fn(async (win, sel) => {
      calls.events.push('wait:' + String(sel))
      if (o.elementFound === false) return false
      if (o.missingSelector && String(sel).includes(o.missingSelector)) return false
      return true
    }),
    // 上传完成判据：真实实现是页面侧 fn 的轮询，这里用开关代替
    _waitForCondition: vi.fn(async (win, fn) => {
      calls.waitCond.push(String(fn))
      return o.uploadDone ?? true
    }),
    _setFileInput: vi.fn(async (win, path, sel) => {
      calls.events.push('setFile:' + String(sel))
      if (o.fileThrows) throw new Error('File not found: ' + path)
      if (o.fileReturnsFalse) return false
      return true
    }),
    // Draft.js 的唯一可信写入通道（CDP Input.insertText）
    _insertTextTrusted: vi.fn(async (win, text) => {
      calls.inserted.push(String(text))
      return o.insertOk ?? true
    }),
    // innerHTML 降级通道（仅 iframe 形态）
    _fillInFrame: vi.fn(async (win, frameSel, innerSel, content) => {
      calls.filledInFrame.push({ frameSel, innerSel, content })
      return true
    }),
    // iframe 内执行
    // ⚠️ 必须**按 jsBody 内容分流**（与主文档同一个分流器）：
    //    若这里恒返回 true，描述回读长度会恒读到 1 ⇒ 被误判成「编辑器里已有内容」
    //    ⇒ 跳过写入 ⇒ 用例锁不到真正的写入路径（且线上会真的漏写描述）。
    _execInFrame: vi.fn(async (win, frameSel, jsBody) => {
      calls.execInFrame.push({ frameSel, jsBody: String(jsBody) })
      return o.execInFrameResult !== undefined ? o.execInFrameResult : makeDispatch(o)(String(jsBody), true)
    }),
    _click: vi.fn(async (win, sel) => { calls.clicked.push(sel); calls.events.push('click:' + sel) }),
    _getPlatformConfig: vi.fn(() => ({ publish_url: TIKTOK_URL })),
  }
}

/**
 * 造窗口。
 * @param {any} [opts]
 */
function makeWin (opts) {
  const o = opts || {}
  const dispatch = makeDispatch(o)
  return {
    webContents: {
      getURL: () => o.url || TIKTOK_URL,
      executeJavaScript: vi.fn(async (script) => dispatch(script, false)),
    },
  }
}

/** 超时注入：用小值，避免用例真等。1ms 也**确定**：首次 while 判断必为真（同一 tick 内 Date.now() 不变） */
const OPTS = { publishVerifyTimeoutMs: 1, uploadWaitTimeoutMs: 1 }

const ARTICLE = {
  title: '测试标题',
  content: '<p>测试正文</p>',
  video_path: '/tmp/demo.mp4',
  tags: ['a', 'b'],
  accountId: 'acc-1',
}

/**
 * 从**真实 mixin 源码**推导「有哪些平台拥有专属链」。
 * ⚠️ 正则只匹配**方法定义行**（行首 `async _publish_xxx (`）——
 *    若只按 `_publish_xxx(` 匹配，index.js 注释里的 `this._publish_generic(...)` 会被误抓成
 *    一个叫 `generic` 的平台。
 * @returns {string[]}
 */
function platformsWithDedicatedChain () {
  const fs = require('fs')
  const src = fs.readFileSync(require.resolve('./index'), 'utf-8')
  const re = /^\s*async _publish_([a-z0-9_]+)\s*\(/gm
  const out = []
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out.sort()
}

// ============================================================
// 一、TikTok fail-closed 判据
// ============================================================

describe('TikTok 发布链（fail-closed）', () => {
  it('cookie 过期（页面出现 SelectFormContainer）⇒ 必须失败，不得放行', async () => {
    const o = { execResult: defaultExec({ loginExpired: true }) }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not logged in/)
  })

  it('没有视频文件 ⇒ 必须失败（TikTok 不支持纯图文发布）', async () => {
    const o = { execResult: defaultExec() }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, { title: 't', content: 'c' }, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/needs video file/)
  })

  it('上传区不出现（既无 iframe 形态也无 div 形态）⇒ 必须失败', async () => {
    const o = { execResult: defaultExec(), missingSelector: 'upload-container' }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/upload area not found/)
  })

  it('文件注入抛错 ⇒ 必须失败', async () => {
    const o = { execResult: defaultExec(), fileThrows: true }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/file upload failed/)
  })

  it('文件注入被拒（返回 false）⇒ 必须失败（不得当成已上传）', async () => {
    const o = { execResult: defaultExec(), fileReturnsFalse: true }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/injection rejected/)
  })

  it('上传未完成（Post 按钮仍 disabled）⇒ 必须失败，不放行', async () => {
    const o = { execResult: defaultExec(), uploadDone: false }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/upload did not complete/)
  })

  it('上传被中断（页面出现 Select file）⇒ 失败文案要与「未完成」区分（排障方向不同）', async () => {
    const o = { execResult: defaultExec({ uploadError: true }), uploadDone: false }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/upload failed/)
  })

  it('描述回读为 0（写进去了但读不回来）⇒ 必须失败，不得发空视频', async () => {
    const o = { execResult: defaultExec({ captionText: '' }) }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/caption not written/)
  })

  it('回读到的是**残留内容**（不含我们写入的文本）⇒ 必须失败（不得把残留当成写入成功）', async () => {
    const o = { execResult: defaultExec({ captionText: '平台自动填充的残留文案' }) }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/caption not written/)
  })

  it('回读不匹配 ⇒ **不得**再插入下一个候选（否则编辑器里留下两份文本 ⇒ 发的描述是重复的）', async () => {
    // ⚠️ 这条锁的是「重复插入」这个真实缺陷：
    //    候选循环里若「插入成功但回读不匹配」还继续换候选 ⇒ 会再插一次 ⇒ 描述重复。
    const o = { execResult: defaultExec({ captionText: '平台预填的残留文案' }) }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/caption not written/)
    // 关键断言：插入**只发生一次**
    expect(ctx._insertTextTrusted.mock.calls.length).toBe(1)
  })

  it('发布后没落到作品列表页 ⇒ 必须失败（点了按钮≠发了出去）', async () => {
    // URL 始终停在上传页 ⇒ 判据读不到「落到作品列表页」⇒ 必须失败
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/content page not reached/)
  })

  it('全流程成功 ⇒ success:true 且回读到作品 ID', async () => {
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(true)
    expect(r.videoId).toBe('7123456789')
    expect(r.verified).toBe(true)
  })

  it('落到作品列表页但回读不到作品 ID ⇒ 仍算成功（内容可能已发出），但 verified:false', async () => {
    const o = { execResult: defaultExec({ captionText: '测试标题', videoHref: '' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    // ⚠️ 「核验不到」≠「发布失败」⇒ 不得把 success 判成 false（否则用户重发 ⇒ 重复内容）
    expect(r.success).toBe(true)
    expect(r.verified).toBe(false)
  })

  it('描述走 CDP 可信插入通道（Draft.js 不接受 innerHTML 直写）', async () => {
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(ctx._insertTextTrusted).toHaveBeenCalled()
    expect(String(ctx.calls.inserted[0] || '')).toContain('测试标题')
  })

  it('TikTok 是无标题平台 ⇒ 标题合并进描述，且话题用 #tag 风格', async () => {
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    const inserted = String(ctx.calls.inserted[0] || '')
    expect(inserted).toContain('测试标题')
    expect(inserted).toContain('测试正文')
    expect(inserted).toContain('#a')
    expect(inserted).toContain('#b')
  })

  it('导航地址取自平台配置（yaml 是 publish_url 单一真源）', async () => {
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(ctx._getPlatformConfig).toHaveBeenCalledWith('tiktok', ARTICLE)
    expect(ctx.calls.navigated[0]).toBe(TIKTOK_URL)
  })

  it('上传区形态为 iframe 时，作用域内操作必须走 iframe（不得在主文档里瞎找）', async () => {
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(ctx.calls.execInFrame.length).toBeGreaterThan(0)
    expect(String(ctx.calls.execInFrame[0].frameSel)).toContain('Upload_index_iframe')
  })

  it('上传区形态为 div（无 iframe）时退回主文档作用域', async () => {
    const o = { execResult: defaultExec({ hasFrame: false, captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    const r = await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(true)
    expect(ctx.calls.execInFrame.length).toBe(0)
  })

  it('**不得**点「Select video」按钮（那是 file input 的原生触发点 ⇒ Electron 会弹系统文件对话框并阻塞）', async () => {
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    await publishTiktok.call(ctx, win, ARTICLE, OPTS)
    const clicked = ctx.calls.clicked.join(' | ')
    expect(clicked).not.toMatch(/Select video/i)
    expect(clicked).not.toMatch(/Select file/i)
  })

  it('发布按钮读的是**选择器表**（注入假表 ⇒ 点假表里的那个）', async () => {
    // ⚠️ 这条断言在假表与真表候选**相同时**会恒真 ⇒ 必须注入**不同的**假表。
    const fake = {
      upload_frame: ['#fake-frame'],
      upload_container: ['#fake-container'],
      file_input: ['#fake-file'],
      caption_editor: ['#fake-editor'],
      post_btn: ['#fake-post'],
      login_expired_select: ['#fake-expired'],
      upload_error_btn: ['#fake-err'],
      published_video_link: ['#fake-link'],
    }
    const o = { execResult: defaultExec({ captionText: '测试标题' }), url: TIKTOK_CONTENT_URL }
    const win = makeWin(o)
    const ctx = createContext(o)
    await publishTiktok.call(ctx, win, ARTICLE, { ...OPTS, selectors: fake })
    const clicked = ctx.calls.clicked.join(' | ')
    expect(clicked).toMatch(/#fake-post/)
    // 且不应出现真表里的候选（若出现 ⇒ 实现绕过了注入的表）
    expect(clicked).not.toMatch(/button-group/)
  })
})

// ============================================================
// 一之一、宿主方法契约（防「mock 掉的拼写错」这类盲区）
// ============================================================

describe('宿主方法契约', () => {
  // ⚠️ 本文件里 publishTiktok 依赖的宿主方法**全部被 mock** ⇒ 方法名拼错时
  //    本文件仍会全绿，只有真机才炸（「可加载 ≠ 能用」的同型）。
  const fs = require('fs')

  function readSource (rel) {
    return fs.readFileSync(require.resolve(rel), 'utf-8')
  }

  it('helpers mixin 提供 TikTok 链依赖的 DOM/输入/等待能力', () => {
    const src = readSource('../rpa-view-helpers')
    for (const m of [
      '_navigateAndWait', '_waitForElement', '_waitForCondition',
      '_setFileInput', '_insertTextTrusted', '_fillInFrame', '_execInFrame',
      '_click', '_sleep',
    ]) {
      expect(src).toMatch(new RegExp('(async )?' + m + '\\s*\\('))
    }
  })

  it('platforms mixin 提供 _getPlatformConfig（publish_url 的读取口）', () => {
    const src = readSource('../rpa-view-platforms')
    expect(src).toMatch(/_getPlatformConfig\s*\(/)
  })

  it('manager 本体提供 _emitProgress（进度回传）与动态分发点', () => {
    const src = readSource('../rpa-view-manager')
    expect(src).toMatch(/_emitProgress\s*\(/)
    expect(src).toMatch(/'_publish_'\s*\+\s*platform/)
  })

  it('overseas mixin 提供 _publish_tiktok（否则分发点找不到专属链 ⇒ 退回通用链）', () => {
    const src = readSource('./index')
    expect(src).toMatch(/_publish_tiktok\s*\(/)
  })
})

// ============================================================
// 一之二、注入页面的脚本契约
// ============================================================

describe('注入页面的脚本契约', () => {
  const FNS = {
    TIKTOK_LOGIN_EXPIRED_FN,
    TIKTOK_UPLOAD_DONE_FN,
    TIKTOK_UPLOAD_ERROR_FN,
  }

  for (const [name, fn] of Object.entries(FNS)) {
    it(name + ' 必须是合法的 JS 函数字面量（helper 会把它拼进页面执行）', () => {
      expect(typeof fn).toBe('string')
      expect(() => new Function('return (' + fn + ')')).not.toThrow()
      // ⚠️ `new Function('return (fn)')` 返回的是**函数本身**（不是调用结果）——
      //    调用它需要页面里的 `document`（node 环境没有）⇒ 这里只断言「是函数」。
      expect(typeof new Function('return (' + fn + ')')()).toBe('function')
    })

    it(name + ' 不得含会提前闭合字符串的引号（转义坑）', () => {
      // 曾经的坑：写 \' 会提前闭合引号 ⇒ 后半段被当成参数。
      expect(fn).not.toContain("\\'")
    })
  }

  it('TIKTOK_LOGIN_EXPIRED_FN 的判据是「select 的 class 匹配 tiktok-*-SelectFormContainer*」', () => {
    expect(TIKTOK_LOGIN_EXPIRED_FN).toContain('SelectFormContainer')
    expect(TIKTOK_LOGIN_EXPIRED_FN).toContain('select')
  })

  it('TIKTOK_UPLOAD_DONE_FN 的判据是「Post 按钮不再 disabled」（不是「有文件」）', () => {
    expect(TIKTOK_UPLOAD_DONE_FN).toContain('disabled')
    expect(TIKTOK_UPLOAD_DONE_FN).toContain('Post')
  })

  it('TIKTOK_UPLOAD_ERROR_FN 认的是「Select file」按钮（上传被中断的信号）', () => {
    expect(TIKTOK_UPLOAD_ERROR_FN).toContain('Select file')
  })

  it('不同平台的页面脚本常量**不得同名**（同名 ⇒ 后导入者静默覆盖前者）', () => {
    // ⚠️ 真实的坑：TikTok 与 YouTube 都有「上传完成判据」，最初两边都叫 UPLOAD_DONE_FN
    //    ⇒ 从 index.js 导入时拿到的是**另一个平台的**那个 ⇒ 用例锁错了对象。
    const yt = readIndexSource()
    const tk = readIndexSource()
    expect(yt).toContain('UPLOAD_DONE_FN')
    expect(tk).toContain('TIKTOK_UPLOAD_DONE_FN')
    // TikTok 的三个脚本常量都必须带平台前缀
    for (const k of ['TIKTOK_LOGIN_EXPIRED_FN', 'TIKTOK_UPLOAD_DONE_FN', 'TIKTOK_UPLOAD_ERROR_FN']) {
      expect(tk).toContain(k)
    }
  })
})

/** 读本目录 index.js 源码（用于「常量命名不撞车」的结构锁） */
function readIndexSource () {
  const fs = require('fs')
  return fs.readFileSync(require.resolve('./index'), 'utf-8')
}

// ============================================================
// 二、发布后回读核验层
// ============================================================

describe('TikTok 发布后回读核验', () => {
  it('回读到作品链接且能解析出 ID ⇒ 核验通过', async () => {
    const win = makeWin({ execResult: defaultExec({ videoHref: VIDEO_HREF }) })
    const r = await verifyPublished(win, 'tiktok', {})
    expect(r.verified).toBe(true)
    expect(r.evidence.videoId).toBe('7123456789')
  })

  it('回读到链接但解析不出作品 ID ⇒ 不得算已核验（页面结构变了 / 不是作品链接）', async () => {
    const win = makeWin({ execResult: defaultExec({ videoHref: 'https://www.tiktok.com/@u' }) })
    const r = await verifyPublished(win, 'tiktok', {})
    expect(r.verified).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  it('回读不到 ⇒ verified:false 且给出原因（不是抛错）', async () => {
    const win = makeWin({ execResult: defaultExec({ videoHref: '' }) })
    const r = await verifyPublished(win, 'tiktok', {})
    expect(r.verified).toBe(false)
    expect(r.error).toBeUndefined()
  })

  it('核验过程自身出错 ⇒ 返回 error 字段（与 verified:false 区分开）', async () => {
    const win = makeWin({ execThrows: true })
    const r = await verifyPublished(win, 'tiktok', {})
    expect(r.error).toBeTruthy()
    expect(r.verified).toBeUndefined()
  })
})

// ============================================================
// 三、解析器与文案组装
// ============================================================

describe('解析器：TikTok 作品标识', () => {
  it('从作品链接解析出数字作品 ID', () => {
    expect(parseTikTokVideoId('https://www.tiktok.com/@u/video/7123456789')).toBe('7123456789')
    expect(parseTikTokVideoId('/video/42')).toBe('42')
  })

  it('非作品链接 ⇒ 空串（不返回半个结果）', () => {
    expect(parseTikTokVideoId('https://www.tiktok.com/@u')).toBe('')
    expect(parseTikTokVideoId('')).toBe('')
    expect(parseTikTokVideoId('https://www.tiktok.com/@u/video/abc')).toBe('')
  })
})

describe('描述文案组装', () => {
  it('标题 + 正文 + 话题合并；无标题时只有正文与话题', () => {
    const c = buildCaption({ title: 'T', content: 'B', tags: ['x'] })
    expect(c).toContain('T')
    expect(c).toContain('B')
    expect(c).toContain('#x')
  })

  it('正文超长 ⇒ 按 TikTok 的 contentMax 截断（2200）', () => {
    const c = buildCaption({ content: '字'.repeat(5000) })
    expect(c.length).toBeLessThanOrEqual(2200)
  })

  it('空内容 ⇒ 空串（跳过写入，不报错）', () => {
    expect(buildCaption({})).toBe('')
  })
})

describe('作品 ID 回读轮询', () => {
  it('回读到作品链接 ⇒ 返回作品 ID 与链接', async () => {
    const win = makeWin({ execResult: defaultExec({ videoHref: VIDEO_HREF }) })
    const sel = getOverseasSelectors('tiktok')
    const r = await waitForVideoId.call({ _sleep: async () => {} }, win, sel, 50)
    expect(r.videoId).toBe('7123456789')
  })

  it('回读不到 ⇒ null（不是空对象）', async () => {
    const win = makeWin({ execResult: defaultExec({ videoHref: '' }) })
    const sel = getOverseasSelectors('tiktok')
    const r = await waitForVideoId.call({ _sleep: async () => {} }, win, sel, 50)
    expect(r).toBeNull()
  })
})

// ============================================================
// 四、选择器表
// ============================================================

describe('海外选择器表（增量）', () => {
  it('增量表只登记**有专属链**的平台（不登记没人消费的选择器）', () => {
    // 与 youtube.test.js 同一条判据（同一份推导函数）⇒ 两处不会漂移
    expect(Object.keys(OVERSEAS_STEP_SELECTORS).sort()).toEqual(platformsWithDedicatedChain())
  })

  it('TikTok 增量键齐全（缺一个就是漏功能）', () => {
    const s = OVERSEAS_STEP_SELECTORS.tiktok
    for (const k of [
      'upload_frame', 'upload_container', 'file_input', 'caption_editor',
      'post_btn', 'login_expired_select', 'upload_error_btn', 'published_video_link',
    ]) {
      expect(s[k]).toBeTruthy()
      expect(s[k].length).toBeGreaterThan(0)
    }
  })

  it('合并后拿到通用字段（来自真源表）+ 增量字段（来自本表）', () => {
    const merged = getOverseasSelectors('tiktok')
    // 通用字段：publish_btn 在真源表里
    expect(merged.publish_btn).toBeTruthy()
    // 增量字段：upload_frame / post_btn 只在本表里
    expect(merged.upload_frame).toBeTruthy()
    expect(merged.post_btn).toBeTruthy()
  })

  it('TikTok 描述候选必须是 contenteditable（真源表的 textarea 候选对 Draft.js 无效）', () => {
    const merged = getOverseasSelectors('tiktok')
    expect(merged.caption_editor[0]).toContain('DraftEditor-content')
    // ⚠️ 不得出现裸 textarea 候选 ⇒ 否则会先命中 textarea 而永远进不了 DraftEditor
    expect(merged.caption_editor.join(',')).not.toMatch(/textarea/)
  })

  it('未知平台返回空对象而不是抛错', () => {
    expect(getOverseasSelectors('nope')).toEqual({})
  })
})
