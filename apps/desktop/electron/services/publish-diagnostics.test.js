// @ts-check
/**
 * publish-diagnostics — 行为锁 + 接线锁
 *
 * ## 为什么必须有这份锁（2026-10-28 下沉当天实测）
 *
 * 这两项诊断能力原在 `rpa-view-platforms.js` 内（`_dumpPublishDom` / `_weiboPublishEvidence`），
 * 因行数门禁点名还账而整段下沉到 `publish-diagnostics.js`。下沉过程中暴露了**两个真缺陷**，
 * 两条都只有锁才能防复发：
 *
 * 1. **`article` 未定义**：`_verifyPublishSuccess(win, platform, config, responsePromise,
 *    networkCapture, context)` 里调 `_weiboPublishEvidence(win, article)`，而 `article`
 *    在该作用域里根本不存在 —— ESLint `no-undef` 抓到（QG Static 红），但**运行时**更糟：
 *    微博兜底一旦被走到就抛 ReferenceError，等于把「假失败」换成「抛异常」。
 *    ⇒ 见 `_verifyPublishSuccess 微博产物证据` 那组行为锁：拿掉 `context` 里的 content
 *    或用回裸 `article`，它们当场红。
 * 2. **宿主方法未守卫**：`this._dumpPublishDom(...)` 在只 mock 了少数方法的实例上不存在
 *    （`xhs-draft-false-success.test.js` / `xhs-draft-only-hard-evidence.test.js` 各自
 *    用部分 mock 跑 `_publish_generic`），于是「诊断」把发布主链的测试全打红。
 *    ⇒ 见「接线锁」：诊断必须以**模块函数**形式被调用，不得再长回宿主方法。
 *
 * describe/it/expect/vi 由 vitest 全局注入（与同目录其它测试同）。
 */
const fs = require('node:fs')
const path = require('node:path')

const diagnostics = require('./publish-diagnostics')
const { dumpPublishDom, weiboPublishEvidence, dumpOnSaveFailure } = diagnostics

const PLATFORMS_SRC = fs.readFileSync(path.join(__dirname, 'rpa-view-platforms.js'), 'utf8')

function makeWin (url = 'https://weibo.com/') {
  return {
    webContents: {
      executeJavaScript: vi.fn(async () => '{"url":"https://weibo.com/"}'),
      getURL: () => url,
      getTitle: () => '微博',
    },
  }
}

describe('publish-diagnostics — dumpPublishDom', () => {
  it('失败不抛：页面读不到时只记 warn（诊断不许反过来打断发布）', async () => {
    const win = makeWin()
    win.webContents.executeJavaScript = vi.fn(async () => { throw new Error('render gone') })
    await expect(dumpPublishDom(win, 'weibo')).resolves.toBeUndefined()
  })

  it('把结构摘要写进日志：只读采集一次，日志里带平台与 DIAG 标记', async () => {
    const logger = require('./logger')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const win = makeWin()
    await dumpPublishDom(win, 'weibo')
    const lines = warn.mock.calls.map((c) => String(c[1])).join('\n')
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(lines).toContain('[weibo] DIAG dom-dump')
    warn.mockRestore()
  })
})

describe('publish-diagnostics — weiboPublishEvidence', () => {
  function hostWith (impl) {
    return { _waitForCondition: vi.fn(impl) }
  }

  it('探针取自 title 前 10 字与 content 前 12 字（两条都进脚本）', async () => {
    const host = hostWith(async () => true)
    const win = makeWin()
    const article = { title: '一二三四五六七八九十', content: '正文正文正文正文正文正文正文' }
    await weiboPublishEvidence(host, win, article)
    const script = String(host._waitForCondition.mock.calls[0][1])
    expect(script).toContain(article.title.slice(0, 10))
    expect(script).toContain(article.content.slice(0, 12))
    expect(script).toContain('刚刚')
  })

  it('命中返回 true，未命中返回 false（判据是页面是否真有自己那条，不是「有没有等到」）', async () => {
    const win = makeWin()
    const article = { title: '一二三四五六七八九十', content: '正文正文正文正文正文正文正文' }
    await expect(weiboPublishEvidence(hostWith(async () => true), win, article)).resolves.toBe(true)
    await expect(weiboPublishEvidence(hostWith(async () => false), win, article)).resolves.toBe(false)
  })

  it('标题与正文都过短 ⇒ 直接 false 且**不触碰页面**（片段太短会命中别人的微博）', async () => {
    const host = hostWith(async () => true)
    await expect(weiboPublishEvidence(host, makeWin(), { title: '短', content: '短' })).resolves.toBe(false)
    expect(host._waitForCondition).not.toHaveBeenCalled()
  })

  it('点击/等待本身抛错 ⇒ 返回 false，不得把诊断失败读成成功', async () => {
    const host = hostWith(async () => { throw new Error('boom') })
    const article = { title: '一二三四五六七八九十', content: '正文正文正文正文正文正文正文' }
    await expect(weiboPublishEvidence(host, makeWin(), article)).resolves.toBe(false)
  })

  it('入参是 {title, content} 上下文即可（不要求整篇文章对象）', async () => {
    const host = hostWith(async () => true)
    await expect(weiboPublishEvidence(host, makeWin(), { title: '一二三四五六七八九十', content: '正文正文正文正文正文正文正文' }))
      .resolves.toBe(true)
  })
})

describe('publish-diagnostics — dumpOnSaveFailure', () => {
  it.each(['save-request-not-sent', 'save-button-unavailable'])('detail=%s ⇒ 留证', async (detail) => {
    const win = makeWin()
    await dumpOnSaveFailure(win, { detail })
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it.each([['timeout'], ['save-unknown'], [undefined]])('detail=%s ⇒ 不额外留证（避免把诊断当常态噪音）', async (detail) => {
    const win = makeWin()
    await dumpOnSaveFailure(win, { detail })
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('publish-diagnostics — 接线锁（诊断不得再长回宿主方法）', () => {
  it('主链必须经 publish-diagnostics 调用，且不得出现 this._dumpPublishDom / this._weiboPublishEvidence', () => {
    expect(PLATFORMS_SRC).toContain("require('./publish-diagnostics')")
    expect(PLATFORMS_SRC).not.toContain('this._dumpPublishDom(')
    expect(PLATFORMS_SRC).not.toContain('this._weiboPublishEvidence(')
    // 三个调用点：正文落空 / 发布按钮落空 / 存草稿落后（wechat_mp）
    expect(PLATFORMS_SRC).toMatch(/dumpPublishDom\(win, platform\)/)
    expect(PLATFORMS_SRC).toMatch(/weiboPublishEvidence\(this, win, context\)/)
    expect(PLATFORMS_SRC).toMatch(/dumpOnSaveFailure\(win, saved\)/)
  })

  it('微博产物证据的判据必须带 content：只带 title 时正文探针恒缺席（只剩半条判据）', () => {
    expect(PLATFORMS_SRC).toMatch(/publishContext = \{ title: article\.title, content: article\.content/)
  })
})

describe('publish-diagnostics — _verifyPublishSuccess 微博产物证据（真回归：article 未定义）', () => {
  const platformsMixin = require('./rpa-view-platforms')

  /** 页面文本判据一律 false；只有微博「刚刚 + 本次内容」那条脚本命中。 */
  function makeHost () {
    return {
      _waitForCondition: vi.fn(async (win, script) => String(script).includes('刚刚')),
      _waitForElement: vi.fn(async () => false),
      _sleep: vi.fn(async () => {}),
      _emitProgress: vi.fn(),
    }
  }

  const config = { success_mode: 'url', publish_url: 'https://weibo.com/' }
  const context = { title: '微博草稿标题测试', content: '微博草稿正文测试内容足够长', publishedAt: Date.now() }

  it('走到微博兜底时必须 resolve 且判成功（原实现抛 ReferenceError: article is not defined）', async () => {
    const host = makeHost()
    const spy = vi.spyOn(diagnostics, 'weiboPublishEvidence')
    const win = makeWin()
    const res = await platformsMixin._verifyPublishSuccess.call(host, win, 'weibo', config, null, null, context)
    expect(spy).toHaveBeenCalledTimes(1)
    // 接线：传进去的必须是带 title/content 的上下文（不是 undefined / 不是裸 article）
    const passed = spy.mock.calls[0][2]
    expect(passed && passed.title).toBe(context.title)
    expect(passed && passed.content).toBe(context.content)
    expect(res.success).toBe(true)
    expect(String(res.postId || '')).toMatch(/^published-/)
    spy.mockRestore()
  })

  it('上下文缺 content 时也不得抛（只有 title 时正文探针缺席，但仍按标题认）', async () => {
    const host = makeHost()
    const win = makeWin()
    const res = await platformsMixin._verifyPublishSuccess.call(host, win, 'weibo', config, null, null, { title: context.title })
    expect(res.success).toBe(true)
  })

  it('非微博平台不得去查时间线（避免把别的平台的成功/失败串到微博判据上）', async () => {
    const host = makeHost()
    const spy = vi.spyOn(diagnostics, 'weiboPublishEvidence')
    const win = makeWin('https://weibo.com/')
    await platformsMixin._verifyPublishSuccess.call(host, win, 'xiaohongshu', config, null, null, context)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})