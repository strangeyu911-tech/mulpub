/**
 * check-design-nav.test.js —— 设计稿导航契约（§12）门禁的回归锁。
 *
 * 本文件是 `scripts/check-design-nav.js` 的锁，也是那把锁**自己的锁**：
 * 判据必须能证伪（把产品改坏 → 判红），否则它只是一段会永远发绿的代码。
 *
 * 用 node:test（node 内置），不依赖任何第三方包 —— 它住在 quality-gate.yml 的
 * `changes` job 里，而那个 job 不装依赖。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const checker = require('./check-design-nav.js')

const REPO_ROOT = path.resolve(__dirname, '..')
const PRODUCT = path.join(REPO_ROOT, checker.REL_PRODUCT)

// ---------------------------------------------------------------------------
// 夹具：一个最小但**合法**的设计稿产物
// ---------------------------------------------------------------------------

function screen(id, num, name) {
  return `<section class="screen" id="${id}"><div class="frame"><div class="app">x</div></div>` +
    `<div class="caption"><b>${num}</b><span>${name}</span><i>副标题</i></div></section>`
}

function navHtml(links) {
  return `<nav class="deck-nav">\n${links.map(([href, text]) => `    <a href="#${href}">${text}</a>`).join('\n')}\n  </nav>`
}

function buildHtml({ screens, links }) {
  return `<!doctype html><html><body>\n${navHtml(links)}\n${screens.join('\n')}\n</body></html>`
}

/** 一份全过的基准产物：3 屏，其中 2 屏同编号（20）不同状态。 */
function goodFixture() {
  return buildHtml({
    screens: [screen('s-a', '01', '甲页'), screen('s-b', '20', '乙页'), screen('s-b-empty', '20', '乙页 · 空态')],
    links: [['s-a', '01 甲页'], ['s-b', '20 乙页'], ['s-b-empty', '20 乙页 · 空态']],
  })
}

function codesOf(html) {
  return checker.check(html).violations.map((v) => v.code)
}

// ---------------------------------------------------------------------------
// 1. 基准夹具：全过（证明判据不是恒红）
// ---------------------------------------------------------------------------

test('基准夹具必须全过 —— 判据恒红等于没有判据', () => {
  const r = checker.check(goodFixture())
  assert.deepStrictEqual(r.violations, [], '合法产物被判红：' + JSON.stringify(r.violations))
  assert.strictEqual(r.stats.links, 3)
  assert.strictEqual(r.stats.screens, 3)
  assert.strictEqual(r.stats.uniqueTexts, 3)
  assert.strictEqual(r.stats.groups, 1)
})

// ---------------------------------------------------------------------------
// 2. 逐条契约：每条违规都必须被点名
// ---------------------------------------------------------------------------

test('D1 死链：指向不存在屏的链接必须被点名', () => {
  const html = buildHtml({
    screens: [screen('s-a', '01', '甲页')],
    links: [['s-a', '01 甲页'], ['s-ghost', '01 幽灵页']],
  })
  const codes = codesOf(html)
  assert.ok(codes.includes('DEAD_LINK'), '死链未被点名：' + JSON.stringify(codes))
})

test('D2 文字唯一：两条相同文字必须被点名', () => {
  const html = buildHtml({
    screens: [screen('s-a', '01', '甲页'), screen('s-b', '01', '甲页')],
    links: [['s-a', '01 甲页'], ['s-b', '01 甲页']],
  })
  const codes = codesOf(html)
  assert.ok(codes.includes('DUPLICATE_TEXT'), '重复文字未被点名：' + JSON.stringify(codes))
})

test('D3 一一覆盖：屏没进导航 / 同一屏挂两次都要被点名', () => {
  const miss = buildHtml({
    screens: [screen('s-a', '01', '甲页'), screen('s-b', '02', '乙页')],
    links: [['s-a', '01 甲页']],
  })
  assert.ok(codesOf(miss).includes('SCREEN_NOT_IN_NAV'), '漏加屏未被点名')

  const twice = buildHtml({
    screens: [screen('s-a', '01', '甲页')],
    links: [['s-a', '01 甲页'], ['s-a', '01 甲页']],
  })
  const codes = codesOf(twice)
  assert.ok(codes.includes('SCREEN_IN_NAV_TWICE'), '重复挂屏未被点名：' + JSON.stringify(codes))
  assert.ok(codes.includes('DUPLICATE_TEXT'), '重复挂屏同时必然文字重复')
})

test('D4 文字=caption：导航文字与屏 caption 标题不逐字相等必须被点名', () => {
  const html = buildHtml({
    screens: [screen('s-a', '01', '甲页')],
    links: [['s-a', '01 甲页 · 工作台']], // caption 标题是「01 甲页」
  })
  const codes = codesOf(html)
  assert.ok(codes.includes('TEXT_CAPTION_MISMATCH'), '文字≠caption 未被点名：' + JSON.stringify(codes))
})

test('D5 同页同号：同编号组内基名不一致必须被点名', () => {
  const html = buildHtml({
    screens: [screen('s-a', '20', '乙页'), screen('s-b', '20', '丙页 · 空态')],
    links: [['s-a', '20 乙页'], ['s-b', '20 丙页 · 空态']],
  })
  const codes = codesOf(html)
  assert.ok(codes.includes('GROUP_BASE_NAME_MISMATCH'), '同编号组基名不一致未被点名：' + JSON.stringify(codes))
})

test('D6 组内互异：同编号组内两屏同名必须被点名', () => {
  const html = buildHtml({
    screens: [screen('s-a', '20', '乙页'), screen('s-b', '20', '乙页')],
    links: [['s-a', '20 乙页'], ['s-b', '20 乙页']],
  })
  const codes = codesOf(html)
  assert.ok(codes.includes('GROUP_DUPLICATE_NAME'), '组内重名未被点名：' + JSON.stringify(codes))
})

// ---------------------------------------------------------------------------
// 3. 口径锁：唯一性比较**不得**剥掉状态后缀（i8 的误判口径）
// ---------------------------------------------------------------------------

test('口径锁：「20 自动化任务」与「20 自动化任务 · 空态」是两个不同文字，不得判成重复', () => {
  const html = buildHtml({
    screens: [screen('s-a', '20', '自动化任务'), screen('s-b', '20', '自动化任务 · 空态')],
    links: [['s-a', '20 自动化任务'], ['s-b', '20 自动化任务 · 空态']],
  })
  const codes = codesOf(html)
  assert.ok(!codes.includes('DUPLICATE_TEXT'),
    '剥掉状态后缀再比唯一性会把「主态」与「状态屏」误判成重复 —— 这正是 i8 当初的误判口径')
})

// ---------------------------------------------------------------------------
// 4. 可证伪性：把**仓内产物**改坏，判据必须转红
// ---------------------------------------------------------------------------

test('可证伪性：剥掉仓内产物的状态后缀 ⇒ 必须报重复文字（这把闸门真的会红）', () => {
  const real = fs.readFileSync(PRODUCT, 'utf8')
  // 只动导航段里的文字，屏内容一字不改 —— 模拟「有人把状态后缀删了」
  const navAt = real.indexOf('class="deck-nav"')
  const navEnd = real.indexOf('</nav>', navAt)
  const navSeg = real.slice(navAt, navEnd)
  const brokenSeg = navSeg.replace(/ · (空态|加载态|失败态|筛选后为空|工作台|经典模式)/g, '')
  assert.notStrictEqual(brokenSeg, navSeg, '夹具没改到东西 —— 这条锁测不到东西')
  const broken = real.slice(0, navAt) + brokenSeg + real.slice(navEnd)

  const codes = codesOf(broken)
  assert.ok(codes.includes('DUPLICATE_TEXT'),
    '把状态后缀删掉后判据仍报绿 ⇒ 这把闸门是装饰（必须能证伪）')
})

test('仓内产物当前必须满足全部契约', () => {
  const real = fs.readFileSync(PRODUCT, 'utf8')
  const r = checker.check(real)
  assert.deepStrictEqual(r.violations, [],
    '仓内设计稿产物违反 §12 导航契约：' + JSON.stringify(r.violations, null, 2))
  assert.strictEqual(r.stats.links, r.stats.screens, '导航链接数与屏数应当一一对应')
  assert.strictEqual(r.stats.uniqueTexts, r.stats.links, '导航文字必须两两不同')
})

// ---------------------------------------------------------------------------
// 5. 判据自身故障：必须与「没有问题」区分开
// ---------------------------------------------------------------------------

test('判据自身故障：产物里没有导航容器 ⇒ 判 JUDGE_BROKEN，不许静默放行', () => {
  const codes = codesOf('<!doctype html><html><body><section class="screen" id="s-a"></section></body></html>')
  assert.deepStrictEqual(codes, ['JUDGE_BROKEN'])
})

test('判据自身故障：产物里一个屏都没有 ⇒ 判 JUDGE_BROKEN', () => {
  const codes = codesOf('<!doctype html><html><body><nav class="deck-nav"></nav></body></html>')
  assert.deepStrictEqual(codes, ['JUDGE_BROKEN'])
})

test('CLI 入口：产物文件不存在 ⇒ 退出码 2（不是 0，也不是 1）', () => {
  let code = null
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'check-design-nav.js'), path.join(REPO_ROOT, 'no-such-file.html')], { stdio: 'pipe' })
  } catch (e) {
    code = e.status
  }
  assert.strictEqual(code, 2, '产物缺失必须报判据自身故障（退出码 2），不得当成「没有问题」')
})

test('CLI 入口：跑仓内产物 ⇒ 退出码 0 且打印 PASS', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-design-nav.js')], { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.match(out, /\[check-design-nav\] PASS/)
  assert.match(out, /唯一文字/)
})
