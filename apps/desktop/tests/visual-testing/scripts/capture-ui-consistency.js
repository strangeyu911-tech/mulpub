/**
 * capture-ui-consistency.js — 五页 UI 一致性截图（2026-10-26）
 *
 * 前置：Vite dev server 已启动（默认 http://127.0.0.1:5174）。
 * 用法：node tests/visual-testing/scripts/capture-ui-consistency.js
 * 产物：tests/visual-testing/screenshots/ui-consistency/*.png（已 gitignore，仅本地验收）
 */
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const { buildInitScript } = require('../../e2e/helpers/fixture-loader')

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5174'
const OUT_DIR = path.resolve(__dirname, '../screenshots/ui-consistency')
const STUB = fs.readFileSync(path.join(__dirname, 'ui-consistency-stubs.js'), 'utf8')

const PAGES = [
  { name: 'drafts', route: '/publish?tab=drafts', ready: '[data-testid="publish-drafts-page"]' },
  { name: 'creator', route: '/collection', ready: '[data-testid="collection-tab-creator"]', action: '[data-testid="collection-tab-creator"]', actionReady: '[data-testid="creator-monitor"]' },
  { name: 'copy-library', route: '/copy-library', ready: '[data-testid="copy-library-title"]' },
  { name: 'knowledge-base', route: '/knowledge-base', ready: '.kb-page .mp-page-title' },
  { name: 'podcast', route: '/podcast', ready: '[data-testid="podcast-page-title"]' },
]

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '2560', width: 2560, height: 1328 },
]

async function capture (browser, viewport, pageDef, empty, dark = false) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Shanghai',
  })
  const page = await context.newPage()
  const init = buildInitScript() + '\nwindow.__uiEmpty = ' + (empty ? 'true' : 'false') + ';\nwindow.__uiTheme = ' + (dark ? "'dark'" : 'null') + ';\n' + STUB + '\n;'
  await page.addInitScript({ content: init })
  await page.goto(BASE_URL + '/#' + pageDef.route, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(pageDef.ready, { timeout: 20000 })
  if (pageDef.action) {
    await page.click(pageDef.action)
    await page.waitForSelector(pageDef.actionReady || pageDef.ready, { timeout: 20000 })
  }
  await page.waitForTimeout(600)
  if (dark) {
    // 主题 composable 目前只被设置页按需调用；截图脚本直接切 data-theme 验证暗色 token。
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(200)
  }
  const suffix = (empty ? '-empty' : '') + (dark ? '-dark' : '')
  const file = path.join(OUT_DIR, `${pageDef.name}${suffix}-${viewport.name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await context.close()
  return file
}

async function main () {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const files = []
  try {
    for (const pageDef of PAGES) {
      for (const viewport of VIEWPORTS) {
        files.push(await capture(browser, viewport, pageDef, false))
      }
      if (['drafts', 'creator', 'copy-library', 'podcast'].includes(pageDef.name)) {
        files.push(await capture(browser, VIEWPORTS[0], pageDef, true))
      }
    }
    // 暗色抽查：知识库表格 + 播客表单（两页覆盖表格与表单两种表面）
    files.push(await capture(browser, VIEWPORTS[0], PAGES.find((p) => p.name === 'knowledge-base'), false, true))
    files.push(await capture(browser, VIEWPORTS[0], PAGES.find((p) => p.name === 'podcast'), false, true))
  } finally {
    await browser.close()
  }
  console.log(files.join('\n'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
